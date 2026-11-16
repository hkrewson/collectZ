#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const pool = require('../db/pool');
const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function scopedQuery(fixture, text, params = []) {
  return withAuthorizedScopeTransaction(
    pool,
    { spaceId: fixture.spaceId, libraryId: fixture.libraryId ?? null },
    fixture.actorId,
    (client) => client.query(text, params)
  );
}

async function expectDenied(label, work) {
  try {
    await work();
  } catch (error) {
    if (['42501', '23503'].includes(String(error.code || ''))) return;
    throw new Error(`${label} failed with unexpected database code`);
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function createWorkspaceFixture(fixtures, suffix, workspaceIndex, libraryCount) {
  const actorId = Number((await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified)
     VALUES ($1, $2, $3, 'user', true) RETURNING id`,
    [`object-relationship-rls-${workspaceIndex}-${suffix}@example.invalid`, crypto.randomBytes(48).toString('hex'), `Object relationship RLS ${workspaceIndex}`]
  )).rows[0].id);
  fixtures.actors.push(actorId);
  const spaceId = Number((await pool.query(
    `INSERT INTO spaces (name, slug, created_by, is_personal)
     VALUES ($1, $2, $3, false) RETURNING id`,
    [`Object relationship RLS ${workspaceIndex}`, `object-relationship-rls-${workspaceIndex}-${suffix}`, actorId]
  )).rows[0].id);
  fixtures.spaces.push(spaceId);
  await pool.query(
    `INSERT INTO space_memberships (space_id, user_id, role, created_by)
     VALUES ($1, $2, 'owner', $2)`,
    [spaceId, actorId]
  );

  const scopes = [];
  for (let libraryIndex = 1; libraryIndex <= libraryCount; libraryIndex += 1) {
    const libraryId = Number((await pool.query(
      'INSERT INTO libraries (space_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
      [spaceId, `Object relationship library ${workspaceIndex}-${libraryIndex}`, actorId]
    )).rows[0].id);
    fixtures.libraries.push(libraryId);
    await pool.query(
      `INSERT INTO library_memberships (user_id, library_id, role) VALUES ($1, $2, 'owner')`,
      [actorId, libraryId]
    );
    const mediaIds = [];
    for (let mediaIndex = 1; mediaIndex <= 2; mediaIndex += 1) {
      const mediaId = Number((await pool.query(
        `INSERT INTO media (title, media_type, library_id, space_id, added_by)
         VALUES ($1, 'book', $2, $3, $4) RETURNING id`,
        [`Object relationship media ${workspaceIndex}-${libraryIndex}-${mediaIndex}`, libraryId, spaceId, actorId]
      )).rows[0].id);
      fixtures.media.push(mediaId);
      mediaIds.push(mediaId);
    }
    scopes.push({ actorId, spaceId, libraryId, mediaIds });
  }
  return scopes;
}

async function insertRelationship(scope, source, target, marker) {
  return scopedQuery(
    scope,
    `INSERT INTO object_relationships
       (source_type, source_id, target_type, target_id, relationship_type, label,
        library_id, space_id, created_by)
     VALUES ('media', $1, 'media', $2, 'companion_to', $3, $4, $5, $6)
     RETURNING id`,
    [source.mediaIds[0], target.mediaIds[0], marker, source.libraryId, source.spaceId, scope.actorId]
  );
}

async function main() {
  const suffix = crypto.randomBytes(8).toString('hex');
  const marker = `object-relationship-rls-${crypto.randomUUID()}`;
  const fixtures = { actors: [], spaces: [], libraries: [], media: [] };
  const scopes = [];
  try {
    scopes.push(...await createWorkspaceFixture(fixtures, suffix, 1, 2));
    scopes.push(...await createWorkspaceFixture(fixtures, suffix, 2, 1));
    const first = scopes[0];
    const siblingLibrary = scopes[1];
    const siblingWorkspace = scopes[2];

    const firstInsert = await insertRelationship(first, first, siblingLibrary, marker);
    const relationshipId = Number(firstInsert.rows[0].id);
    await insertRelationship(siblingWorkspace, siblingWorkspace, { ...siblingWorkspace, mediaIds: [siblingWorkspace.mediaIds[1]] }, marker);

    const unscoped = await pool.query(
      'SELECT count(*)::int AS count FROM object_relationships WHERE label = $1',
      [marker]
    );
    assert(Number(unscoped.rows[0]?.count) === 0, 'Unscoped runtime SQL could read object relationships');

    const workspaceVisible = await scopedQuery(
      { ...first, libraryId: null },
      'SELECT id FROM object_relationships WHERE label = $1',
      [marker]
    );
    assert(workspaceVisible.rows.length === 1, 'Workspace grant did not return its relationship');

    const sourceLibraryVisible = await scopedQuery(
      first,
      'SELECT id FROM object_relationships WHERE label = $1',
      [marker]
    );
    const targetLibraryVisible = await scopedQuery(
      siblingLibrary,
      'SELECT id FROM object_relationships WHERE label = $1',
      [marker]
    );
    assert(sourceLibraryVisible.rows.length === 1 && targetLibraryVisible.rows.length === 1,
      'Same-workspace library grants did not preserve cross-library relationship visibility');

    const siblingVisible = await scopedQuery(
      siblingWorkspace,
      'SELECT id FROM object_relationships WHERE label = $1',
      [marker]
    );
    assert(siblingVisible.rows.length === 1, 'Sibling workspace did not see exactly its own relationship');

    await expectDenied('Cross-workspace insert', () => insertRelationship(first, first, siblingWorkspace, `${marker}-cross`));
    await expectDenied('Endpoint mutation', () => scopedQuery(
      first,
      'UPDATE object_relationships SET target_id = $1 WHERE id = $2',
      [first.mediaIds[1], relationshipId]
    ));
    await expectDenied('Source ownership move', () =>
      pool.query(
        'UPDATE media SET library_id = $1 WHERE id = $2',
        [siblingLibrary.libraryId, first.mediaIds[0]]
      ));
    await pool.query(
      'UPDATE media SET library_id = $1 WHERE id = $2',
      [first.libraryId, siblingLibrary.mediaIds[0]]
    );
    await expectDenied('Target workspace move', () =>
      pool.query(
        'UPDATE media SET library_id = $1, space_id = $2 WHERE id = $3',
        [siblingWorkspace.libraryId, siblingWorkspace.spaceId, siblingLibrary.mediaIds[0]]
      ));
    await expectDenied('Active owner delete', () =>
      pool.query('DELETE FROM media WHERE id = $1', [first.mediaIds[0]]));
    const unscopedArchive = await pool.query(
      'UPDATE object_relationships SET archived_at = CURRENT_TIMESTAMP WHERE id = $1',
      [relationshipId]
    );
    assert(unscopedArchive.rowCount === 0, 'Unscoped runtime SQL archived an object relationship');

    console.log(JSON.stringify({
      status: 'passed',
      checks: [
        'authorized cross-library insert',
        'unscoped runtime denial',
        'workspace grant visibility',
        'same-workspace cross-library visibility',
        'sibling workspace isolation',
        'cross-workspace write denial',
        'immutable endpoints and ownership',
        'source owner move denial',
        'target same-workspace move allowance',
        'target workspace move denial',
        'active owner delete denial',
        'unscoped archive denial'
      ]
    }, null, 2));
  } finally {
    const failures = [];
    const cleanup = async (label, work) => {
      try { await work(); } catch { failures.push(label); }
    };
    const workspaceScopes = Array.from(new Map(scopes.map((scope) => [scope.spaceId, scope])).values());
    for (const scope of workspaceScopes) {
      await cleanup('relationship cleanup', () => scopedQuery(
        { ...scope, libraryId: null },
        `DELETE FROM object_relationships WHERE label LIKE 'object-relationship-rls-%'`
      ));
    }
    if (fixtures.media.length) await cleanup('media cleanup', () =>
      pool.query('DELETE FROM media WHERE id = ANY($1::int[])', [fixtures.media]));
    if (fixtures.libraries.length) {
      await cleanup('library membership cleanup', () =>
        pool.query('DELETE FROM library_memberships WHERE library_id = ANY($1::int[])', [fixtures.libraries]));
      await cleanup('library cleanup', () =>
        pool.query('DELETE FROM libraries WHERE id = ANY($1::int[])', [fixtures.libraries]));
    }
    if (fixtures.spaces.length) {
      await cleanup('space membership cleanup', () =>
        pool.query('DELETE FROM space_memberships WHERE space_id = ANY($1::int[])', [fixtures.spaces]));
      await cleanup('space cleanup', () =>
        pool.query('DELETE FROM spaces WHERE id = ANY($1::int[])', [fixtures.spaces]));
    }
    if (fixtures.actors.length) await cleanup('user cleanup', () =>
      pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [fixtures.actors]));
    await pool.end().catch(() => {});
    if (failures.length) throw new Error(`Fixture cleanup failed: ${failures.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(`Object relationship RLS smoke failed: ${error.message}`);
  process.exitCode = 1;
});
