'use strict';

const assert = require('assert');
const pool = require('../db/pool');
const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');
const { buildBrowserCaptureMapping, applyBrowserCaptureMapping } = require('../services/browserCaptureMapping');

function fixtureMapping(usedAmount = 14.99) {
  return buildBrowserCaptureMapping({
    contract: 'collectz.browser_capture.v1',
    extension_version: '0.1.1',
    source: 'browser_extension',
    client_source: 'browser-extension',
    adapter: 'bluray',
    url: 'https://www.blu-ray.com/movies/Dune-4K-Blu-ray/295838/',
    canonical_url: 'https://www.blu-ray.com/movies/Dune-4K-Blu-ray/295838/',
    captured_at: '2026-07-31T18:00:00.000Z',
    identifiers: {
      bluray_product_id: '295838',
      bluray_content_id: '111111',
      bluray_global_product_id: '222222',
      imdb_id: 'tt1160419',
      asin: 'B09GWCX92K',
      upc: '883929701223'
    },
    page_metadata: {
      edition: '4K Ultra HD + Blu-ray + Digital',
      media_format: '4K Ultra HD + Blu-ray + Digital',
      release_details: { year: '2021', runtime: '155 minutes', release_date: 'January 11, 2022' },
      specs: {
        video: 'Codec: HEVC / H.265 Resolution: Native 4K (2160p) HDR: HDR10',
        audio: 'English: Dolby Atmos'
      },
      pricing: { used: { amount: usedAmount, currency: 'USD', display: `$${usedAmount}` } }
    }
  });
}

async function main() {
  const scopeResult = await pool.query(
    `SELECT l.id AS library_id, l.space_id, sm.user_id AS actor_id
       FROM libraries l
       JOIN space_memberships sm ON sm.space_id = l.space_id
      WHERE l.archived_at IS NULL
      ORDER BY CASE sm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, l.id
      LIMIT 1`
  );
  const scope = scopeResult.rows[0];
  assert.ok(scope, 'runtime smoke requires one active library with a workspace member');
  const rollback = new Error('WORK_EDITION_OWNED_COPY_SMOKE_ROLLBACK');
  let report;

  try {
    await withAuthorizedScopeTransaction(
      pool,
      { spaceId: Number(scope.space_id), libraryId: Number(scope.library_id) },
      Number(scope.actor_id),
      async (client) => {
        const siblingLibrary = await client.query(
          `INSERT INTO libraries (space_id, name, created_by)
           VALUES ($1, $2, $3) RETURNING id`,
          [scope.space_id, `Work model sibling ${Date.now()}`, scope.actor_id]
        );
        const siblingMedia = await client.query(
          `INSERT INTO media (title, media_type, library_id, space_id, added_by)
           VALUES ($1,'movie',$2,$3,$4) RETURNING id`,
          ['Work model sibling media', siblingLibrary.rows[0].id, scope.space_id, scope.actor_id]
        );
        await client.query('SAVEPOINT sibling_scope_denial');
        await assert.rejects(
          client.query(
            `INSERT INTO collection_works (space_id, library_id, media_id, work_kind, created_by)
             VALUES ($1,$2,$3,'movie',$4)`,
            [scope.space_id, siblingLibrary.rows[0].id, siblingMedia.rows[0].id, scope.actor_id]
          ),
          (error) => error.code === '42501'
        );
        await client.query('ROLLBACK TO SAVEPOINT sibling_scope_denial');
        await client.query('SAVEPOINT cross_library_fk_denial');
        await assert.rejects(
          client.query(
            `INSERT INTO collection_works (space_id, library_id, media_id, work_kind, created_by)
             VALUES ($1,$2,$3,'movie',$4)`,
            [scope.space_id, scope.library_id, siblingMedia.rows[0].id, scope.actor_id]
          ),
          (error) => error.code === '23503'
        );
        await client.query('ROLLBACK TO SAVEPOINT cross_library_fk_denial');
        const capture = await client.query(
          `INSERT INTO capture_items (
             title, capture_type, object_type, source_context, library_id, space_id, created_by
           ) VALUES ($1,'manual_note','movie',$2::jsonb,$3,$4,$5)
           RETURNING id`,
          ['Work Edition Owned Copy smoke', JSON.stringify({ adapter: 'bluray', source: 'browser_extension' }),
            scope.library_id, scope.space_id, scope.actor_id]
        );
        const media = await client.query(
          `INSERT INTO media (title, media_type, library_id, space_id, owned_formats, added_by)
           VALUES ($1,'movie',$2,$3,ARRAY['digital']::text[],$4)
           RETURNING id`,
          ['Work Edition Owned Copy smoke', scope.library_id, scope.space_id, scope.actor_id]
        );
        const args = {
          db: client,
          mediaId: media.rows[0].id,
          mapping: fixtureMapping(),
          captureItemId: capture.rows[0].id,
          actorUserId: Number(scope.actor_id)
        };
        const first = await applyBrowserCaptureMapping(args);
        const replay = await applyBrowserCaptureMapping(args);
        assert.strictEqual(first.ownership?.work?.created, true);
        assert.strictEqual(first.ownership?.edition?.created, true);
        assert.strictEqual(first.ownership?.owned_copy?.created, true);
        assert.strictEqual(first.ownership?.observation?.created, true);
        assert.strictEqual(replay.ownership?.work?.created, false);
        assert.strictEqual(replay.ownership?.edition?.created, false);
        assert.strictEqual(replay.ownership?.owned_copy?.created, false);
        assert.strictEqual(replay.ownership?.observation?.created, false);

        const counts = await client.query(
          `SELECT
             (SELECT COUNT(*)::int FROM collection_works WHERE media_id = $1) AS works,
             (SELECT COUNT(*)::int FROM collection_editions WHERE work_id = $2) AS editions,
             (SELECT COUNT(*)::int FROM owned_copies WHERE edition_id = $3) AS copies,
             (SELECT COUNT(*)::int FROM edition_source_observations WHERE edition_id = $3) AS observations,
             (SELECT COUNT(*)::int FROM media_variants WHERE media_id = $1 AND source = 'blu-ray.com') AS variants`,
          [media.rows[0].id, first.ownership.work.id, first.ownership.edition.id]
        );
        assert.deepStrictEqual(counts.rows[0], { works: 1, editions: 1, copies: 1, observations: 1, variants: 1 });

        const changed = await applyBrowserCaptureMapping({ ...args, mapping: fixtureMapping(15.99) });
        assert.strictEqual(changed.ownership?.observation?.created, true);
        const changedCounts = await client.query(
          `SELECT COUNT(*)::int AS observations
             FROM edition_source_observations WHERE edition_id = $1`,
          [first.ownership.edition.id]
        );
        assert.strictEqual(changedCounts.rows[0].observations, 2);
        await client.query('DELETE FROM capture_items WHERE id = $1', [capture.rows[0].id]);
        const retainedObservations = await client.query(
          `SELECT COUNT(*)::int AS observations,
                  COUNT(capture_item_id)::int AS capture_links
             FROM edition_source_observations WHERE edition_id = $1`,
          [first.ownership.edition.id]
        );
        assert.deepStrictEqual(retainedObservations.rows[0], { observations: 2, capture_links: 0 });
        await client.query('DELETE FROM media WHERE id = $1', [media.rows[0].id]);
        const lifecycleCounts = await client.query(
          `SELECT
             (SELECT COUNT(*)::int FROM collection_works WHERE media_id = $1) AS works,
             (SELECT COUNT(*)::int FROM collection_editions WHERE id = $2) AS editions,
             (SELECT COUNT(*)::int FROM owned_copies WHERE edition_id = $2) AS copies,
             (SELECT COUNT(*)::int FROM edition_source_observations WHERE edition_id = $2) AS observations`,
          [media.rows[0].id, first.ownership.edition.id]
        );
        assert.deepStrictEqual(lifecycleCounts.rows[0], { works: 0, editions: 0, copies: 0, observations: 0 });
        report = {
          ok: true,
          migration: 149,
          compatibility_variant_count: 1,
          work_count: 1,
          edition_count: 1,
          owned_copy_count: 1,
          unchanged_replay_observation_count: 1,
          changed_evidence_observation_count: 2,
          observations_retained_after_capture_cleanup: 2,
          authorized_work_lifecycle_cleanup: true,
          sibling_library_rls_denied: true,
          cross_library_relationship_denied: true
        };
        throw rollback;
      }
    );
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await pool.end();
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
