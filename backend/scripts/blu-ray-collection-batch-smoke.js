'use strict';

const assert = require('assert');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db/pool');
const { ensureUserDefaultScope } = require('../services/libraries');
const { createPersonalAccessToken } = require('../services/personalAccessTokens');
const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');

const BASE_URL = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

async function request(path, token, { method = 'GET', body = null, statuses = [200] } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  assert(statuses.includes(response.status), `${method} ${path} returned ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function createContext() {
  const suffix = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  const hash = await bcrypt.hash(`BatchSmoke-${suffix}`, 12);
  const user = await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, 'Blu-ray batch smoke', 'user', true, NOW()) RETURNING id`,
    [`bluray-batch-${suffix}@example.test`, hash]
  );
  const userId = Number(user.rows[0].id);
  const scope = await ensureUserDefaultScope(userId);
  await pool.query(`UPDATE users SET active_space_id = $2, active_library_id = $3 WHERE id = $1`, [userId, scope.spaceId, scope.libraryId]);
  await pool.query(`INSERT INTO space_memberships (space_id, user_id, role, created_by) VALUES ($1,$2,'owner',$2) ON CONFLICT DO NOTHING`, [
    scope.spaceId,
    userId
  ]);
  await pool.query(`INSERT INTO library_memberships (user_id, library_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [
    userId,
    scope.libraryId
  ]);
  const token = await createPersonalAccessToken({ userId, name: 'Blu-ray collection batch smoke', scopes: ['media:read', 'media:write'] });
  return { suffix, userId, token: token.token, spaceId: scope.spaceId, libraryId: scope.libraryId };
}

async function cleanup(context) {
  if (!context) return;
  await withAuthorizedScopeTransaction(pool, { spaceId: context.spaceId, libraryId: context.libraryId }, context.userId, async (client) => {
    await client.query(`DELETE FROM media WHERE import_source IN ('capture_review', 'capture_lookup') AND added_by = $1`, [context.userId]);
    await client.query(`DELETE FROM capture_batches WHERE space_id = $1 AND library_id = $2`, [context.spaceId, context.libraryId]);
  }).catch(() => {});
  await pool.query('DELETE FROM personal_access_tokens WHERE user_id = $1', [context.userId]).catch(() => {});
  await pool.query('DELETE FROM library_memberships WHERE library_id = $1', [context.libraryId]).catch(() => {});
  await pool.query('DELETE FROM libraries WHERE id = $1', [context.libraryId]).catch(() => {});
  await pool.query('DELETE FROM space_memberships WHERE space_id = $1', [context.spaceId]).catch(() => {});
  await pool.query('DELETE FROM spaces WHERE id = $1', [context.spaceId]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id = $1', [context.userId]).catch(() => {});
}

async function main() {
  let context;
  try {
    context = await createContext();
    const clientBatchId = `smoke:${context.suffix}`;
    const created = await request('/api/capture-batches', context.token, {
      method: 'POST',
      statuses: [201],
      body: {
        client_batch_id: clientBatchId,
        source_collection_key: 'smoke-library',
        source_url: 'https://www.blu-ray.com/community/collection.php?u=smoke'
      }
    });
    assert.match(created.batch.id, /^[0-9a-f-]{36}$/i);
    const batchId = created.batch.id;
    const replay = await request('/api/capture-batches', context.token, {
      method: 'POST',
      statuses: [200],
      body: { client_batch_id: clientBatchId }
    });
    assert.strictEqual(replay.batch.id, batchId, 'batch creation must be idempotent');

    const pageBody = {
      page: 1,
      total_pages: 1,
      expected_item_count: 3,
      items: [
        {
          item_key: `owned-${context.suffix}`,
          product_id: `owned-${context.suffix}`,
          title: `Batch Owned ${context.suffix}`,
          release_title: `Batch Owned ${context.suffix} 4K Ultra HD`,
          url: `https://www.blu-ray.com/movies/Batch-Owned/${Date.now()}/`,
          status: 'Owned',
          ownership_basis: 'collection_page',
          format: '4K Ultra HD',
          year: 2026,
          page: 1,
          position: 1,
          enrichment_status: 'enriched',
          extension_version: '0.3.0',
          identifiers: { upc: '012345678905', asin: 'B012345678', imdb_id: 'tt1234567' },
          page_metadata: {
            release_title: `Batch Owned ${context.suffix} 4K Ultra HD`,
            edition: 'SteelBook',
            media_format: '4K Ultra HD + Blu-ray',
            country: 'United States',
            release_details: {
              studio: 'Example Studio',
              year: '2026',
              runtime: '120 min',
              rating: 'Rated PG-13',
              release_date: 'Nov 26, 2026'
            },
            specs: { video: '2160p', audio: 'Dolby Atmos' }
          }
        },
        {
          item_key: `owned-pending-${context.suffix}`,
          product_id: `owned-pending-${context.suffix}`,
          title: `Batch Owned Pending ${context.suffix}`,
          release_title: `Batch Owned Pending ${context.suffix} Blu-ray`,
          url: `https://www.blu-ray.com/movies/Batch-Owned-Pending/${Date.now() + 1}/`,
          status: 'Owned',
          ownership_basis: 'collection_page',
          format: 'Blu-ray',
          year: 2025,
          page: 1,
          position: 2,
          enrichment_status: 'enriched',
          extension_version: '0.3.2',
          identifiers: { upc: '012345678912', imdb_id: 'tt1234568' },
          page_metadata: {
            release_title: `Batch Owned Pending ${context.suffix} Blu-ray`,
            media_format: 'Blu-ray',
            country: 'United States',
            release_details: { year: '2025' }
          }
        },
        {
          item_key: `unknown-${context.suffix}`,
          product_id: `unknown-${context.suffix}`,
          title: `Batch Unknown ${context.suffix}`,
          url: `https://www.blu-ray.com/movies/Batch-Unknown/${Date.now() + 1}/`,
          status: null,
          format: 'Blu-ray',
          year: 2025,
          page: 1,
          position: 3,
          enrichment_status: 'failed',
          enrichment_error: 'detail_http_429'
        }
      ]
    };
    await request(`/api/capture-batches/${batchId}/items`, context.token, { method: 'POST', statuses: [201], body: pageBody });
    await request(`/api/capture-batches/${batchId}/items`, context.token, { method: 'POST', statuses: [201], body: pageBody });
    const collectingDetail = await request(`/api/capture-batches/${batchId}`, context.token);
    const ownedItem = collectingDetail.items.find((item) => item.item_key === `owned-${context.suffix}`);
    const remainingOwnedItem = collectingDetail.items.find((item) => item.item_key === `owned-pending-${context.suffix}`);
    await request(`/api/capture-batches/${batchId}/items/${ownedItem.id}`, context.token, {
      method: 'PATCH',
      body: { decision: 'include' }
    });
    await request(`/api/capture-batches/${batchId}/apply`, context.token, { method: 'POST', statuses: [409] });
    const stillCollecting = await request(`/api/capture-batches/${batchId}`, context.token);
    assert.strictEqual(stillCollecting.batch.status, 'collecting', 'rejected early apply must not change batch status');
    assert.strictEqual(stillCollecting.items.filter((item) => item.status === 'converted').length, 0, 'rejected early apply must not import rows');
    await request(`/api/capture-batches/${batchId}/progress`, context.token, {
      method: 'PATCH',
      body: { status: 'ready', current_page: 1, total_pages: 1, expected_item_count: 3 }
    });

    const detail = await request(`/api/capture-batches/${batchId}`, context.token);
    assert.strictEqual(detail.items.length, 3, 'duplicate page delivery must not duplicate review rows');
    assert.strictEqual(detail.batch.review_status, 'ready_with_issues');
    assert.strictEqual(detail.batch.enriched_item_count, 2);
    assert.strictEqual(detail.batch.enrichment_failed_item_count, 1);
    assert.strictEqual(detail.items.find((item) => item.id === ownedItem.id).decision, 'include');
    assert.strictEqual(ownedItem.source_context.enrichment_status, 'enriched');
    assert.strictEqual(ownedItem.source_context.identifiers.upc, '012345678905');
    assert.strictEqual(ownedItem.source_context.page_metadata.edition, 'SteelBook');
    assert.strictEqual(ownedItem.source_context.page_metadata.media_format, '4K Ultra HD + Blu-ray');
    assert.strictEqual(detail.items.find((item) => item.source_status === null).decision, 'skip');

    const retryItem = {
      ...pageBody.items[2],
      enrichment_status: 'enriched',
      enrichment_error: null,
      page_metadata: {
        release_title: `Batch Unknown ${context.suffix} Blu-ray`,
        media_format: 'Blu-ray',
        release_details: { year: '2025' }
      }
    };
    await request(`/api/capture-batches/${batchId}/items`, context.token, {
      method: 'POST',
      statuses: [201],
      body: { page: 1, total_pages: 1, expected_item_count: 2, items: [retryItem] }
    });
    const retriedDetail = await request(`/api/capture-batches/${batchId}`, context.token);
    assert.strictEqual(retriedDetail.batch.review_status, 'ready');
    assert.strictEqual(retriedDetail.batch.enriched_item_count, 3);
    assert.strictEqual(retriedDetail.batch.enrichment_failed_item_count, 0);
    assert.strictEqual(retriedDetail.items.find((item) => item.source_status === null).decision, 'skip');
    const ordinary = await request('/api/capture-items?status=all', context.token);
    assert.strictEqual(ordinary.items.length, 0, 'batch children must stay out of the ordinary Capture Inbox list');

    const applied = await request(`/api/capture-batches/${batchId}/apply`, context.token, { method: 'POST' });
    assert.strictEqual(applied.ok, true);
    assert.strictEqual(applied.results.length, 1);
    assert.strictEqual(applied.results[0].ok, true);
    const partialDetail = await request(`/api/capture-batches/${batchId}`, context.token);
    assert.strictEqual(partialDetail.batch.status, 'ready', 'partial apply must keep the batch active');
    assert.strictEqual(partialDetail.batch.applied_item_count, 1);
    assert.strictEqual(partialDetail.items.find((item) => item.id === ownedItem.id).status, 'converted');
    assert.strictEqual(partialDetail.items.find((item) => item.id === remainingOwnedItem.id).decision, 'pending');
    const activeBatches = await request('/api/capture-batches?status=active', context.token);
    assert(activeBatches.batches.some((batch) => batch.id === batchId), 'partial batch must remain in the active inbox');

    await request(`/api/capture-batches/${batchId}/items/${remainingOwnedItem.id}`, context.token, {
      method: 'PATCH',
      body: { decision: 'include' }
    });
    const finalApply = await request(`/api/capture-batches/${batchId}/apply`, context.token, { method: 'POST' });
    assert.strictEqual(finalApply.ok, true);
    const finalDetail = await request(`/api/capture-batches/${batchId}`, context.token);
    assert.strictEqual(finalDetail.batch.status, 'completed');
    assert.strictEqual(finalDetail.batch.applied_item_count, 2);
    assert.strictEqual(finalDetail.items.find((item) => item.source_status === 'Owned').status, 'converted');

    const ownership = await withAuthorizedScopeTransaction(
      pool,
      { spaceId: context.spaceId, libraryId: context.libraryId },
      context.userId,
      async (client) =>
        client.query(
          `SELECT (SELECT COUNT(*)::int FROM collection_works) AS works,
              (SELECT COUNT(*)::int FROM collection_editions WHERE source_provider = 'blu-ray.com') AS editions,
              (SELECT COUNT(*)::int FROM owned_copies) AS copies,
              (SELECT COUNT(*)::int FROM edition_source_observations) AS observations`
        )
    );
    assert.deepStrictEqual(ownership.rows[0], { works: 2, editions: 2, copies: 2, observations: 2 });
    console.log(
      JSON.stringify(
        {
          ok: true,
          migration: 153,
          batch_idempotent: true,
          duplicate_page_safe: true,
          hidden_child_rows: true,
          enriched_review_required: true,
          failed_only_retry: true,
          explicit_owned_only: true,
          independent_apply: true,
          ownership: ownership.rows[0]
        },
        null,
        2
      )
    );
  } finally {
    await cleanup(context);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
