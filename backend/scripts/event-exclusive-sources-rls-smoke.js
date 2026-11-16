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
  const actorId = Number((await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified)
     VALUES ($1, $2, $3, 'user', true) RETURNING id`,
    [`exclusive-source-rls-${workspaceIndex}-${suffix}@example.invalid`, crypto.randomBytes(48).toString('hex'), `Exclusive source RLS ${workspaceIndex}`]
  )).rows[0].id);
  fixtures.actors.push(actorId);
  const spaceId = Number((await pool.query(
    `INSERT INTO spaces (name, slug, created_by, is_personal, events_enabled)
     VALUES ($1, $2, $3, false, true) RETURNING id`,
    [`Exclusive source RLS ${workspaceIndex}`, `exclusive-source-rls-${workspaceIndex}-${suffix}`, actorId]
  )).rows[0].id);
  fixtures.spaces.push(spaceId);
  await pool.query(
    `INSERT INTO space_memberships (space_id, user_id, role, created_by)
     VALUES ($1, $2, 'owner', $2)`,
    [spaceId, actorId]
  );

  const scoped = [];
  for (let libraryIndex = 1; libraryIndex <= libraryCount; libraryIndex += 1) {
    const libraryId = Number((await pool.query(
      'INSERT INTO libraries (space_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
      [spaceId, `Exclusive source library ${workspaceIndex}-${libraryIndex}`, actorId]
    )).rows[0].id);
    fixtures.libraries.push(libraryId);
    await pool.query(
      `INSERT INTO library_memberships (user_id, library_id, role) VALUES ($1, $2, 'owner')`,
      [actorId, libraryId]
    );
    const eventId = Number((await pool.query(
      `INSERT INTO events (library_id, space_id, created_by, title, url, location, date_start)
       VALUES ($1, $2, $3, $4, $5, 'Test venue', CURRENT_DATE) RETURNING id`,
      [libraryId, spaceId, actorId, `Exclusive source event ${workspaceIndex}-${libraryIndex}`, `https://example.invalid/event/${suffix}/${workspaceIndex}/${libraryIndex}`]
    )).rows[0].id);
    fixtures.events.push(eventId);
    const wantedItemId = Number((await pool.query(
      `INSERT INTO wanted_items (title, object_type, library_id, space_id, created_by)
       VALUES ($1, 'collectible', $2, $3, $4) RETURNING id`,
      [`Exclusive source target ${workspaceIndex}-${libraryIndex}`, libraryId, spaceId, actorId]
    )).rows[0].id);
    fixtures.wantedItems.push(wantedItemId);
    scoped.push({ actorId, spaceId, libraryId, eventId, wantedItemId });
  }
  return scoped;
}

async function insertSource(scopeFixture, marker, rowFixture = scopeFixture) {
  return scopedQuery(
    scopeFixture,
    `INSERT INTO event_exclusive_sources
       (event_id, provider, provider_key, source_url, source_title, metadata,
        library_id, space_id, created_by)
     VALUES ($1, 'rls-smoke', $2, $3, $4, '{}'::jsonb, $5, $6, $7)
     RETURNING id`,
    [
      rowFixture.eventId,
      `${marker}-${rowFixture.libraryId}`,
      `https://example.invalid/source/${marker}/${rowFixture.libraryId}`,
      marker,
      rowFixture.libraryId,
      rowFixture.spaceId,
      scopeFixture.actorId
    ]
  );
}

async function main() {
  const suffix = crypto.randomBytes(8).toString('hex');
  const marker = `exclusive-source-rls-${crypto.randomUUID()}`;
  const fixtures = { actors: [], spaces: [], libraries: [], events: [], wantedItems: [] };
  const scopes = [];
  try {
    scopes.push(...await createWorkspaceFixture(fixtures, suffix, 1, 2));
    scopes.push(...await createWorkspaceFixture(fixtures, suffix, 2, 1));
    const first = scopes[0];
    const siblingLibrary = scopes[1];
    const siblingWorkspace = scopes[2];

    await insertSource(first, marker);
    await insertSource(siblingLibrary, marker);
    await insertSource(siblingWorkspace, marker);

    const unscoped = await pool.query(
      'SELECT count(*)::int AS count FROM event_exclusive_sources WHERE source_title = $1',
      [marker]
    );
    assert(Number(unscoped.rows[0]?.count) === 0, 'Unscoped runtime SQL could read exclusive sources');

    const workspaceOnly = await withAuthorizedScopeTransaction(
      pool,
      { spaceId: first.spaceId, libraryId: null },
      first.actorId,
      (client) => client.query(
        'SELECT count(*)::int AS count FROM event_exclusive_sources WHERE source_title = $1',
        [marker]
      )
    );
    assert(Number(workspaceOnly.rows[0]?.count) === 0, 'Workspace-only grant could read exclusive sources');

    for (const scope of scopes) {
      const visible = await scopedQuery(
        scope,
        'SELECT id, library_id FROM event_exclusive_sources WHERE source_title = $1',
        [marker]
      );
      assert(visible.rows.length === 1, 'Library grant did not return exactly one source');
      assert(Number(visible.rows[0].library_id) === scope.libraryId, 'Library grant returned a sibling source');
    }

    await expectDenied('Cross-library insert', () => insertSource(first, `${marker}-cross`, siblingLibrary));
    const firstVisible = await scopedQuery(
      first,
      'SELECT id FROM event_exclusive_sources WHERE source_title = $1',
      [marker]
    );
    const sourceId = Number(firstVisible.rows[0].id);
    await expectDenied('Ownership mutation', () => scopedQuery(
      first,
      'UPDATE event_exclusive_sources SET library_id = $1 WHERE id = $2',
      [siblingLibrary.libraryId, sourceId]
    ));
    await expectDenied('Cross-library promotion target', () => scopedQuery(
      first,
      'UPDATE event_exclusive_sources SET promoted_wanted_item_id = $1 WHERE id = $2',
      [siblingLibrary.wantedItemId, sourceId]
    ));
    await scopedQuery(
      first,
      'UPDATE event_exclusive_sources SET promoted_wanted_item_id = $1 WHERE id = $2',
      [first.wantedItemId, sourceId]
    );
    await expectDenied('Linked target ownership move', () =>
      pool.query(
        'UPDATE wanted_items SET library_id = $1, space_id = $2 WHERE id = $3',
        [siblingLibrary.libraryId, siblingLibrary.spaceId, first.wantedItemId]
      ));
    await expectDenied('Unscoped parent cascade', () =>
      pool.query('DELETE FROM events WHERE id = $1', [first.eventId]));

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
        'cross-library promotion denial',
        'linked target move denial',
        'guarded parent cascade'
      ]
    }, null, 2));
  } finally {
    const failures = [];
    const cleanup = async (label, work) => {
      try { await work(); } catch { failures.push(label); }
    };
    for (const scope of scopes) {
      await cleanup('source cleanup', () => scopedQuery(
        scope,
        `DELETE FROM event_exclusive_sources
          WHERE provider = 'rls-smoke' AND source_title LIKE 'exclusive-source-rls-%'`
      ));
    }
    if (fixtures.wantedItems.length) await cleanup('wishlist cleanup', () =>
      pool.query('DELETE FROM wanted_items WHERE id = ANY($1::int[])', [fixtures.wantedItems]));
    if (fixtures.events.length) await cleanup('event cleanup', () =>
      pool.query('DELETE FROM events WHERE id = ANY($1::int[])', [fixtures.events]));
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
  console.error(`Event exclusive-source RLS smoke failed: ${error.message}`);
  process.exitCode = 1;
});
