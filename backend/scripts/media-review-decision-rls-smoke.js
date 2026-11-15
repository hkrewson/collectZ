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

async function main() {
  const candidates = await pool.query(`
    SELECT DISTINCT ON (m.space_id)
           m.id AS media_id,
           m.space_id,
           m.library_id,
           COALESCE(sm.user_id, s.created_by) AS actor_id
      FROM media m
      JOIN spaces s ON s.id = m.space_id AND s.archived_at IS NULL
      LEFT JOIN space_memberships sm
        ON sm.space_id = m.space_id
       AND sm.suspended_at IS NULL
     WHERE m.space_id IS NOT NULL
       AND m.library_id IS NOT NULL
       AND COALESCE(sm.user_id, s.created_by) IS NOT NULL
     ORDER BY m.space_id, sm.role = 'owner' DESC, m.id
  `);
  const fixtures = candidates.rows.slice(0, 2).map((row) => ({
    mediaId: Number(row.media_id),
    spaceId: Number(row.space_id),
    libraryId: Number(row.library_id),
    actorId: Number(row.actor_id)
  }));
  assert(fixtures.length === 2, 'Two workspace fixtures are required for review-decision RLS smoke');

  const marker = `rls-smoke-${crypto.randomUUID()}`;
  const created = [];
  try {
    for (const fixture of fixtures) {
      const result = await scopedQuery(
        fixture,
        `INSERT INTO media_review_decisions
           (media_id, finding_type, action, note, library_id, space_id, created_by)
         VALUES ($1, 'missing_covers', 'dismissed', $2, $3, $4, $5)
         RETURNING id`,
        [fixture.mediaId, marker, fixture.libraryId, fixture.spaceId, fixture.actorId]
      );
      created.push({ ...fixture, decisionId: Number(result.rows[0].id) });
    }

    const unscoped = await pool.query(
      'SELECT count(*)::int AS count FROM media_review_decisions WHERE note = $1',
      [marker]
    );
    assert(Number(unscoped.rows[0]?.count) === 0, 'Unscoped runtime SQL could read protected decisions');

    for (const fixture of created) {
      const visible = await scopedQuery(
        fixture,
        'SELECT id, space_id FROM media_review_decisions WHERE note = $1 ORDER BY id',
        [marker]
      );
      assert(visible.rows.length === 1, 'Workspace scope did not return exactly one decision');
      assert(Number(visible.rows[0].id) === fixture.decisionId, 'Workspace scope returned a sibling decision');
    }

    await expectDenied('Cross-workspace insert', () => scopedQuery(
      created[0],
      `INSERT INTO media_review_decisions
         (media_id, finding_type, action, note, library_id, space_id, created_by)
       VALUES ($1, 'missing_identifiers', 'dismissed', $2, $3, $4, $5)`,
      [created[1].mediaId, marker, created[1].libraryId, created[1].spaceId, created[0].actorId]
    ));

    await expectDenied('Ownership mutation', () => scopedQuery(
      created[0],
      'UPDATE media_review_decisions SET space_id = $1 WHERE id = $2',
      [created[1].spaceId, created[0].decisionId]
    ));

    console.log(JSON.stringify({
      status: 'passed',
      checks: [
        'authorized insert',
        'unscoped runtime denial',
        'sibling workspace isolation',
        'cross-workspace write denial',
        'immutable ownership'
      ]
    }, null, 2));
  } finally {
    for (const fixture of created) {
      await scopedQuery(
        fixture,
        'DELETE FROM media_review_decisions WHERE id = $1 AND note = $2',
        [fixture.decisionId, marker]
      ).catch(() => {});
    }
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`Review-decision RLS smoke failed: ${error.message}`);
  process.exitCode = 1;
});
