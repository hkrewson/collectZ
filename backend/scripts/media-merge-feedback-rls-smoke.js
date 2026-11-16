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
    { spaceId: fixture.spaceId, libraryId: fixture.libraryId },
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
  const owner = {
    actorId: Number((await pool.query(
      `INSERT INTO users (email, password, name, role, email_verified)
       VALUES ($1, $2, $3, 'user', true)
       RETURNING id`,
      [
        `merge-feedback-rls-${workspaceIndex}-${suffix}@example.invalid`,
        crypto.randomBytes(48).toString('hex'),
        `Merge feedback RLS ${workspaceIndex}`
      ]
    )).rows[0].id)
  };
  fixtures.actors.push(owner.actorId);
  owner.spaceId = Number((await pool.query(
    `INSERT INTO spaces (name, slug, created_by, is_personal)
     VALUES ($1, $2, $3, false)
     RETURNING id`,
    [`Merge feedback RLS ${workspaceIndex}`, `merge-feedback-rls-${workspaceIndex}-${suffix}`, owner.actorId]
  )).rows[0].id);
  fixtures.spaces.push(owner.spaceId);
  await pool.query(
    `INSERT INTO space_memberships (space_id, user_id, role, created_by)
     VALUES ($1, $2, 'owner', $2)`,
    [owner.spaceId, owner.actorId]
  );

  const libraries = [];
  for (let libraryIndex = 1; libraryIndex <= libraryCount; libraryIndex += 1) {
    const fixture = { actorId: owner.actorId, spaceId: owner.spaceId, mediaIds: [] };
    fixture.libraryId = Number((await pool.query(
      `INSERT INTO libraries (space_id, name, created_by)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [owner.spaceId, `Merge feedback library ${workspaceIndex}-${libraryIndex}`, owner.actorId]
    )).rows[0].id);
    fixtures.libraries.push(fixture.libraryId);
    await pool.query(
      `INSERT INTO library_memberships (user_id, library_id, role)
       VALUES ($1, $2, 'owner')`,
      [owner.actorId, fixture.libraryId]
    );
    for (const mediaIndex of [1, 2]) {
      const mediaId = Number((await pool.query(
        `INSERT INTO media (title, media_type, year, space_id, library_id, added_by, import_source)
         VALUES ($1, 'movie', 1999, $2, $3, $4, 'rls_smoke')
         RETURNING id`,
        [`Merge feedback media ${workspaceIndex}-${libraryIndex}-${mediaIndex}`, owner.spaceId, fixture.libraryId, owner.actorId]
      )).rows[0].id);
      fixture.mediaIds.push(mediaId);
      fixtures.media.push(mediaId);
    }
    libraries.push(fixture);
  }
  return libraries;
}

async function insertFeedback(scopeFixture, marker, rowFixture = scopeFixture) {
  const [pairLowId, pairHighId] = [...rowFixture.mediaIds].sort((left, right) => left - right);
  return scopedQuery(
    scopeFixture,
    `INSERT INTO media_merge_recommendation_feedback
       (pair_low_media_id, pair_high_media_id, canonical_media_id, duplicate_media_id,
        media_type, outcome, reason, context, space_id, library_id, created_by)
     VALUES ($1, $2, $1, $2, 'movie', 'rejected', $3,
             '{"source":"rls-smoke"}'::jsonb, $4, $5, $6)
     RETURNING id`,
    [pairLowId, pairHighId, marker, rowFixture.spaceId, rowFixture.libraryId, scopeFixture.actorId]
  );
}

async function main() {
  const suffix = crypto.randomBytes(8).toString('hex');
  const marker = `merge-feedback-rls-${crypto.randomUUID()}`;
  const fixtures = { actors: [], spaces: [], libraries: [], media: [] };
  const scopedFixtures = [];
  try {
    scopedFixtures.push(...await createWorkspaceFixture(fixtures, suffix, 1, 2));
    scopedFixtures.push(...await createWorkspaceFixture(fixtures, suffix, 2, 1));

    const first = scopedFixtures[0];
    const siblingLibrary = scopedFixtures[1];
    const siblingWorkspace = scopedFixtures[2];
    await insertFeedback(first, marker);
    await insertFeedback(siblingLibrary, marker);
    await insertFeedback(siblingWorkspace, marker);

    const unscoped = await pool.query(
      'SELECT count(*)::int AS count FROM media_merge_recommendation_feedback WHERE reason = $1',
      [marker]
    );
    assert(Number(unscoped.rows[0]?.count) === 0, 'Unscoped runtime SQL could read protected feedback');

    const workspaceOnly = await withAuthorizedScopeTransaction(
      pool,
      { spaceId: first.spaceId, libraryId: null },
      first.actorId,
      (client) => client.query(
        'SELECT count(*)::int AS count FROM media_merge_recommendation_feedback WHERE reason = $1',
        [marker]
      )
    );
    assert(Number(workspaceOnly.rows[0]?.count) === 0, 'Workspace-only grant could read library-owned feedback');

    for (const fixture of scopedFixtures) {
      const visible = await scopedQuery(
        fixture,
        'SELECT id, library_id FROM media_merge_recommendation_feedback WHERE reason = $1',
        [marker]
      );
      assert(visible.rows.length === 1, 'Library scope did not return exactly one feedback row');
      assert(Number(visible.rows[0].library_id) === fixture.libraryId, 'Library scope returned sibling feedback');
    }

    await expectDenied('Cross-library insert', () =>
      insertFeedback(first, `${marker}-cross-library`, siblingLibrary));

    const firstVisible = await scopedQuery(
      first,
      'SELECT id FROM media_merge_recommendation_feedback WHERE reason = $1',
      [marker]
    );
    await expectDenied('Ownership mutation', () => scopedQuery(
      first,
      'UPDATE media_merge_recommendation_feedback SET library_id = $1 WHERE id = $2',
      [siblingLibrary.libraryId, Number(firstVisible.rows[0].id)]
    ));

    await expectDenied('Unscoped parent cascade', () =>
      pool.query('DELETE FROM media WHERE id = $1', [first.mediaIds[0]]));

    console.log(JSON.stringify({
      status: 'passed',
      checks: [
        'authorized insert',
        'unscoped runtime denial',
        'workspace-only grant denial',
        'sibling library isolation',
        'sibling workspace isolation',
        'cross-library write denial',
        'immutable ownership',
        'guarded parent cascade'
      ]
    }, null, 2));
  } finally {
    const cleanupFailures = [];
    const cleanup = async (label, work) => {
      try { await work(); } catch { cleanupFailures.push(label); }
    };
    for (const fixture of scopedFixtures) {
      await cleanup('scoped feedback cleanup', () => scopedQuery(
        fixture,
        'DELETE FROM media_merge_recommendation_feedback WHERE reason = $1',
        [marker]
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
    if (cleanupFailures.length) throw new Error(`Fixture cleanup failed: ${cleanupFailures.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(`Merge-feedback RLS smoke failed: ${error.message}`);
  process.exitCode = 1;
});
