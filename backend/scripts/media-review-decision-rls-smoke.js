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

async function createFixture(fixture, suffix, index) {
  fixture.actorId = Number((await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified)
     VALUES ($1, $2, $3, 'user', true)
     RETURNING id`,
    [
      `review-decision-rls-${index}-${suffix}@example.invalid`,
      crypto.randomBytes(48).toString('hex'),
      `Review decision RLS ${index}`
    ]
  )).rows[0].id);
  fixture.spaceId = Number((await pool.query(
    `INSERT INTO spaces (name, slug, created_by, is_personal)
     VALUES ($1, $2, $3, false)
     RETURNING id`,
    [`Review decision RLS ${index}`, `review-decision-rls-${index}-${suffix}`, fixture.actorId]
  )).rows[0].id);
  await pool.query(
    `INSERT INTO space_memberships (space_id, user_id, role, created_by)
     VALUES ($1, $2, 'owner', $2)`,
    [fixture.spaceId, fixture.actorId]
  );
  fixture.libraryId = Number((await pool.query(
    `INSERT INTO libraries (space_id, name, created_by)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [fixture.spaceId, `Review decision RLS library ${index}`, fixture.actorId]
  )).rows[0].id);
  await pool.query(
    `INSERT INTO library_memberships (user_id, library_id, role)
     VALUES ($1, $2, 'owner')`,
    [fixture.actorId, fixture.libraryId]
  );
  fixture.mediaId = Number((await pool.query(
    `INSERT INTO media (title, media_type, space_id, library_id, added_by, import_source)
     VALUES ($1, 'book', $2, $3, $4, 'rls_smoke')
     RETURNING id`,
    [`Review decision RLS media ${index}`, fixture.spaceId, fixture.libraryId, fixture.actorId]
  )).rows[0].id);
  return fixture;
}

async function main() {
  const suffix = crypto.randomBytes(8).toString('hex');
  const marker = `rls-smoke-${crypto.randomUUID()}`;
  const fixtures = [];
  const created = [];
  try {
    for (const index of [1, 2]) {
      const fixture = {};
      fixtures.push(fixture);
      await createFixture(fixture, suffix, index);
    }

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
    const cleanupFailures = [];
    const cleanup = async (label, work) => {
      try {
        await work();
      } catch {
        cleanupFailures.push(label);
      }
    };
    for (const fixture of created) {
      await cleanup('scoped decision cleanup', () => scopedQuery(
        fixture,
        'DELETE FROM media_review_decisions WHERE id = $1 AND note = $2',
        [fixture.decisionId, marker]
      ));
    }
    const mediaIds = fixtures.map((fixture) => fixture.mediaId).filter(Number.isInteger);
    const libraryIds = fixtures.map((fixture) => fixture.libraryId).filter(Number.isInteger);
    const spaceIds = fixtures.map((fixture) => fixture.spaceId).filter(Number.isInteger);
    const actorIds = fixtures.map((fixture) => fixture.actorId).filter(Number.isInteger);
    if (mediaIds.length) await cleanup('media cleanup', () =>
      pool.query('DELETE FROM media WHERE id = ANY($1::int[])', [mediaIds]));
    if (libraryIds.length) {
      await cleanup('library membership cleanup', () =>
        pool.query('DELETE FROM library_memberships WHERE library_id = ANY($1::int[])', [libraryIds]));
      await cleanup('library cleanup', () =>
        pool.query('DELETE FROM libraries WHERE id = ANY($1::int[])', [libraryIds]));
    }
    if (spaceIds.length) {
      await cleanup('space membership cleanup', () =>
        pool.query('DELETE FROM space_memberships WHERE space_id = ANY($1::int[])', [spaceIds]));
      await cleanup('space cleanup', () =>
        pool.query('DELETE FROM spaces WHERE id = ANY($1::int[])', [spaceIds]));
    }
    if (actorIds.length) await cleanup('user cleanup', () =>
      pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [actorIds]));
    await pool.end().catch(() => {});
    if (cleanupFailures.length) {
      throw new Error(`Fixture cleanup failed: ${cleanupFailures.join(', ')}`);
    }
  }
}

main().catch((error) => {
  console.error(`Review-decision RLS smoke failed: ${error.message}`);
  process.exitCode = 1;
});
