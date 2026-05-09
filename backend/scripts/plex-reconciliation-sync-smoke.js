#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
process.env.INTEGRATION_ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY || 'plex-reconciliation-sync-smoke-key';
const { encryptSecret } = require('../services/crypto');
const { ensureUserDefaultScope } = require('../services/libraries');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const fakePlexToken = `plex-reconciliation-sync-${crypto.randomBytes(6).toString('hex')}`;
const ARTIFACT_PATH = path.resolve(__dirname, '..', '..', 'artifacts', 'plex-reconciliation', 'plex-reconciliation-sync-smoke.json');

class HttpClient {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
    this.csrfToken = '';
  }

  applySetCookies(headers) {
    const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const cookieLine of raw) {
      const firstPart = String(cookieLine).split(';')[0] || '';
      const idx = firstPart.indexOf('=');
      if (idx <= 0) continue;
      this.cookies.set(firstPart.slice(0, idx).trim(), firstPart.slice(idx + 1).trim());
    }
  }

  cookieHeader() {
    return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async request(route, options = {}) {
    const { method = 'GET', body, expectStatus, withCsrf = false, headers: extraHeaders = {} } = options;
    const headers = { Accept: 'application/json', ...extraHeaders };
    let requestBody = body;
    if (body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      requestBody = JSON.stringify(body);
    }
    if (withCsrf) {
      await this.fetchCsrfToken();
      headers['x-csrf-token'] = this.csrfToken;
    }
    const cookieHeader = this.cookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;
    const response = await fetch(`${BASE_URL}${route}`, { method, headers, body: requestBody });
    this.applySetCookies(response.headers);
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (expectStatus !== undefined && response.status !== expectStatus) {
      throw new Error(`[${this.name}] ${method} ${route} expected ${expectStatus}, got ${response.status}. Body: ${JSON.stringify(data)}`);
    }
    return { status: response.status, data };
  }

  async fetchCsrfToken() {
    const response = await this.request('/api/auth/csrf-token', { expectStatus: 200 });
    const token = response?.data?.csrfToken;
    if (!token) throw new Error(`[${this.name}] Missing CSRF token`);
    this.csrfToken = token;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSecretFree(value, label = 'payload') {
  const text = JSON.stringify(value);
  assert(!text.includes(fakePlexToken), `${label} surfaced raw Plex token`);
  assert(!/X-Plex-Token=/i.test(text), `${label} surfaced Plex token query string`);
  assert(!/\/mnt\/plex-media/i.test(text), `${label} surfaced raw media file path`);
  assert(!/192\.168\./.test(text), `${label} surfaced private IP address`);
}

async function createDirectUser({ email, password, name, role = 'admin' }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, $3, $4, true, NOW())
     RETURNING id`,
    [email, passwordHash, name, role]
  );
  await ensureUserDefaultScope(result.rows[0].id);
  return Number(result.rows[0]?.id || 0) || null;
}

async function snapshotPlexSettings() {
  const result = await pool.query(
    `SELECT plex_preset, plex_provider, plex_api_url, plex_api_key_encrypted,
            plex_library_sections, tmdb_api_key_encrypted
       FROM app_integrations
      WHERE id = 1`
  );
  return result.rows[0] || null;
}

async function applyFakePlexSettings(baseUrl) {
  await pool.query(
    `INSERT INTO app_integrations (
       id, plex_preset, plex_provider, plex_api_url, plex_api_key_encrypted,
       plex_library_sections, tmdb_api_key_encrypted, updated_at
     )
     VALUES (1, 'plex', 'plex', $1, $2, $3::jsonb, NULL, NOW())
     ON CONFLICT (id) DO UPDATE SET
       plex_preset = EXCLUDED.plex_preset,
       plex_provider = EXCLUDED.plex_provider,
       plex_api_url = EXCLUDED.plex_api_url,
       plex_api_key_encrypted = EXCLUDED.plex_api_key_encrypted,
       plex_library_sections = EXCLUDED.plex_library_sections,
       tmdb_api_key_encrypted = NULL,
       updated_at = NOW()`,
    [baseUrl, encryptSecret(fakePlexToken), JSON.stringify(['1'])]
  );
}

async function restorePlexSettings(snapshot) {
  if (!snapshot) return;
  await pool.query(
    `UPDATE app_integrations
        SET plex_preset = $1,
            plex_provider = $2,
            plex_api_url = $3,
            plex_api_key_encrypted = $4,
            plex_library_sections = $5::jsonb,
            tmdb_api_key_encrypted = $6
      WHERE id = 1`,
    [
      snapshot.plex_preset,
      snapshot.plex_provider,
      snapshot.plex_api_url,
      snapshot.plex_api_key_encrypted,
      JSON.stringify(snapshot.plex_library_sections || []),
      snapshot.tmdb_api_key_encrypted
    ]
  ).catch(() => {});
}

async function cleanup({ userId, mediaIds = [] } = {}) {
  for (const mediaId of mediaIds.filter(Boolean)) {
    await pool.query('DELETE FROM media WHERE id = $1', [mediaId]).catch(() => {});
  }
  if (userId) {
    await pool.query('DELETE FROM media WHERE added_by = $1', [userId]).catch(() => {});
    await pool.query('DELETE FROM library_memberships WHERE user_id = $1', [userId]).catch(() => {});
    await pool.query('DELETE FROM space_memberships WHERE user_id = $1', [userId]).catch(() => {});
    await pool.query("DELETE FROM spaces WHERE created_by = $1 AND lower(COALESCE(slug, '')) <> 'default'", [userId]).catch(() => {});
    await pool.query('DELETE FROM libraries WHERE created_by = $1', [userId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
  }
}

async function startFakePmsServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    requests.push({
      method: req.method,
      pathname: url.pathname,
      hasToken: url.searchParams.has('X-Plex-Token'),
      tokenMatched: url.searchParams.get('X-Plex-Token') === fakePlexToken
    });
    res.setHeader('Content-Type', 'application/json');
    if (url.searchParams.get('X-Plex-Token') !== fakePlexToken) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/library/sections') {
      res.writeHead(200);
      res.end(JSON.stringify({
        MediaContainer: {
          Directory: [{ key: '1', title: 'Movies', type: 'movie' }]
        }
      }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/library/sections/1/all') {
      const bulkLinked = Array.from({ length: 1001 }, (_, index) => {
        const number = index + 1;
        return {
          ratingKey: String(9100 + number),
          type: 'movie',
          title: `Bulk Linked Movie ${number}`,
          year: 2010,
          guid: `tmdb://${900000 + number}`,
          Media: [{ Part: [{ file: `/mnt/plex-media/bulk-linked-${number}.mkv` }] }]
        };
      });
      res.writeHead(200);
      res.end(JSON.stringify({
        MediaContainer: {
          Metadata: [
            {
              ratingKey: '9001',
              type: 'movie',
              title: 'Already Linked Movie',
              year: 2001,
              guid: 'tmdb://8001',
              Media: [{ Part: [{ file: '/mnt/plex-media/already-linked.mkv' }] }]
            },
            {
              ratingKey: '9002',
              type: 'movie',
              title: 'Existing TMDB Movie',
              year: 2002,
              guid: 'tmdb://8002',
              Media: [{ Part: [{ file: '/mnt/plex-media/existing-tmdb.mkv' }] }]
            },
            {
              ratingKey: '9003',
              type: 'movie',
              title: 'Conflict Movie',
              year: 2003,
              guid: 'tmdb://8003',
              Media: [{ Part: [{ file: '/mnt/plex-media/conflict.mkv' }] }]
            },
            {
              ratingKey: '9004',
              type: 'movie',
              title: 'Brand New Movie',
              year: 2004,
              guid: 'tmdb://8004',
              Media: [{ Part: [{ file: '/mnt/plex-media/new.mkv' }] }]
            },
            ...bulkLinked
          ]
        }
      }));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to start fake PMS server');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function waitForJobResult(client, jobId) {
  const deadline = Date.now() + 15000;
  let last = null;
  while (Date.now() < deadline) {
    last = await client.request(`/api/media/sync-jobs/${jobId}/result`, { expectStatus: 200 });
    const status = String(last.data?.status || '').toLowerCase();
    if (status === 'succeeded') return last.data;
    if (status === 'failed') {
      throw new Error(`Plex reconciliation sync job failed: ${JSON.stringify(last.data)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Plex reconciliation sync job: ${JSON.stringify(last?.data)}`);
}

async function main() {
  const snapshot = await snapshotPlexSettings();
  const fake = await startFakePmsServer();
  const suffix = Date.now();
  const email = `plex-reconciliation-sync-${suffix}@example.com`;
  const password = `Passw0rd!${crypto.randomBytes(4).toString('hex')}`;
  const client = new HttpClient('plex-reconciliation-sync');
  let userId = null;
  const mediaIds = [];
  try {
    userId = await createDirectUser({ email, password, name: 'Plex Reconciliation Sync Admin' });
    await applyFakePlexSettings(fake.baseUrl);
    await client.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { email, password }
    });
    const scope = await client.request('/api/auth/scope', { expectStatus: 200 });
    const libraryId = Number(scope.data?.active_library_id || 0) || null;
    const spaceId = Number(scope.data?.active_space_id || 0) || null;
    assert(libraryId, 'Expected active library for smoke user');
    const schedulerStatus = await client.request('/api/media/plex-reconciliation-sync/scheduler', { expectStatus: 200 });
    assert(schedulerStatus.data?.processingMode === 'scheduled_full_library_reconciliation_sync', `Unexpected scheduler status mode: ${JSON.stringify(schedulerStatus.data)}`);
    assert(schedulerStatus.data?.runtime?.enabled === false, 'Expected reconciliation scheduler to default off until explicitly enabled');

    const seedRows = await pool.query(
      `INSERT INTO media (title, media_type, format, library_id, space_id, added_by, import_source, year, tmdb_id, tmdb_media_type)
       VALUES
         ('Already Linked Movie', 'movie', 'Digital', $1, $2, $3, 'plex', 2001, 8001, 'movie'),
         ('Existing TMDB Movie', 'movie', 'Digital', $1, $2, $3, 'manual', 2002, 8002, 'movie'),
         ('Conflict Movie', 'movie', 'Digital', $1, $2, $3, 'manual', 2003, 9999, 'movie')
       RETURNING id, title`,
      [libraryId, spaceId, userId]
    );
    for (const row of seedRows.rows) mediaIds.push(Number(row.id));
    const linkedId = Number(seedRows.rows.find((row) => row.title === 'Already Linked Movie')?.id || 0);
    await pool.query(
      `INSERT INTO media_metadata (media_id, "key", "value")
       VALUES ($1, 'plex_item_key', '1:9001')`,
      [linkedId]
    );
    await pool.query(
      `WITH inserted AS (
         INSERT INTO media (title, media_type, format, library_id, space_id, added_by, import_source, year, tmdb_id, tmdb_media_type)
         SELECT 'Bulk Linked Movie ' || g, 'movie', 'Digital', $1, $2, $3, 'plex', 2010, 900000 + g, 'movie'
           FROM generate_series(1, 1001) AS g
         RETURNING id, title
       )
       INSERT INTO media_metadata (media_id, "key", "value")
       SELECT id, 'plex_item_key', '1:' || (9100 + regexp_replace(title, '^Bulk Linked Movie ', '')::int)
         FROM inserted
       RETURNING media_id`,
      [libraryId, spaceId, userId]
    );

    const beforeCount = await pool.query('SELECT COUNT(*)::int AS count FROM media WHERE library_id = $1', [libraryId]);
    const preview = await client.request('/api/media/plex-reconciliation-preview', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { sectionIds: ['1'] }
    });

    assert(preview.data?.processingMode === 'full_library_reconciliation_preview', `Unexpected processing mode: ${JSON.stringify(preview.data)}`);
    assert(preview.data?.readOnly === true, 'Expected reconciliation preview to be read-only');
    assert(preview.data?.plexWriteback === false, 'Expected Plex writeback to stay disabled');
    assert(preview.data?.importMutation === false, 'Expected import mutation to stay disabled');
    assert(preview.data?.summary?.scanned === 1005, `Expected full scan beyond the old 1000-row cap: ${JSON.stringify(preview.data?.summary)}`);
    assert(preview.data?.summary?.alreadyLinked === 1002, `Expected linked rows beyond the old 1000-row cap: ${JSON.stringify(preview.data?.summary)}`);
    assert(preview.data?.summary?.wouldUpdate === 1, `Expected one wouldUpdate row: ${JSON.stringify(preview.data?.summary)}`);
    assert(preview.data?.summary?.wouldCreate === 1, `Expected one wouldCreate row: ${JSON.stringify(preview.data?.summary)}`);
    assert(preview.data?.summary?.conflict === 1, `Expected one conflict row: ${JSON.stringify(preview.data?.summary)}`);

    const queued = await client.request('/api/media/plex-reconciliation-sync/run', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 202,
      body: { sectionIds: ['1'] }
    });
    const jobId = Number(queued.data?.job?.id || queued.data?.id || 0);
    assert(Number.isFinite(jobId) && jobId > 0, `Expected queued reconciliation sync job id: ${JSON.stringify(queued.data)}`);
    assert(queued.data?.processingMode === 'full_library_reconciliation_sync', `Unexpected queued processing mode: ${JSON.stringify(queued.data)}`);
    assert(queued.data?.readOnly === false, 'Expected queued reconciliation sync to be mutating');
    assert(queued.data?.plexWriteback === false, 'Expected queued reconciliation sync to keep Plex writeback disabled');
    assert(queued.data?.importMutation === true, 'Expected queued reconciliation sync to enable import mutation');

    const job = await waitForJobResult(client, jobId);
    assert(job?.status === 'succeeded', `Expected reconciliation sync job to succeed: ${JSON.stringify(job)}`);
    assert(job?.job_type === 'plex_reconciliation_sync', `Unexpected job type: ${JSON.stringify(job)}`);
    assert(job?.summary?.processingMode === 'full_library_reconciliation_sync', `Unexpected job summary: ${JSON.stringify(job?.summary)}`);
    assert(job?.summary?.readOnly === false, 'Expected job summary to be mutating');
    assert(job?.summary?.plexWriteback === false, 'Expected job summary Plex writeback to be false');
    assert(job?.summary?.importMutation === true, 'Expected job summary import mutation to be true');
    assert(job?.summary?.scanned === 1005, `Expected job to scan beyond the old 1000-row cap: ${JSON.stringify(job?.summary)}`);
    assert(job?.summary?.alreadyLinked === 1002, `Expected job linked rows beyond the old 1000-row cap: ${JSON.stringify(job?.summary)}`);
    assert(job?.summary?.wouldUpdate === 1, `Expected job one wouldUpdate row: ${JSON.stringify(job?.summary)}`);
    assert(job?.summary?.wouldCreate === 1, `Expected job one wouldCreate row: ${JSON.stringify(job?.summary)}`);
    assert(job?.summary?.conflict === 1, `Expected job one conflict row: ${JSON.stringify(job?.summary)}`);

    assert(job?.summary?.autoApplied?.created === 1, `Expected one auto-created row: ${JSON.stringify(job?.summary)}`);
    assert(job?.summary?.autoApplied?.updated === 1, `Expected one strong-ID update: ${JSON.stringify(job?.summary)}`);
    assert(job?.summary?.autoApplied?.skippedAlreadyLinked === 1002, `Expected all already-linked rows to stay no-op: ${JSON.stringify(job?.summary)}`);
    assert(job?.summary?.conflictReviewCount === 1, `Expected one conflict for review: ${JSON.stringify(job?.summary)}`);
    assert(Array.isArray(job?.summary?.conflictReview) && job.summary.conflictReview.length === 1, `Expected stored conflict review row: ${JSON.stringify(job?.summary)}`);
    assert(job.summary.conflictReview[0]?.reason === 'A same-title row exists, but strong identifiers disagree.', `Unexpected conflict reason: ${JSON.stringify(job.summary.conflictReview)}`);
    const afterCount = await pool.query('SELECT COUNT(*)::int AS count FROM media WHERE library_id = $1', [libraryId]);
    assert(afterCount.rows[0].count === beforeCount.rows[0].count + 1, `Expected one media row to be created, before=${beforeCount.rows[0].count} after=${afterCount.rows[0].count}`);
    const newRow = await pool.query(`SELECT id, import_source FROM media WHERE title = 'Brand New Movie' AND library_id = $1`, [libraryId]);
    assert(newRow.rows[0]?.id, 'Expected Brand New Movie to be created');
    mediaIds.push(Number(newRow.rows[0].id));
    const updatedRow = await pool.query(`SELECT import_source FROM media WHERE title = 'Existing TMDB Movie' AND library_id = $1`, [libraryId]);
    assert(updatedRow.rows[0]?.import_source === 'plex', 'Expected Existing TMDB Movie to be updated from Plex');
    const conflicts = await client.request('/api/media/plex-reconciliation-conflicts?status=open', { expectStatus: 200 });
    assert(conflicts.data?.processingMode === 'plex_reconciliation_conflict_review', `Unexpected conflict review mode: ${JSON.stringify(conflicts.data)}`);
    assert(conflicts.data?.count === 1, `Expected one open conflict review row: ${JSON.stringify(conflicts.data)}`);
    assert(conflicts.data?.reviews?.[0]?.item?.title === 'Conflict Movie', `Expected Conflict Movie review row: ${JSON.stringify(conflicts.data)}`);
    assert(!Object.prototype.hasOwnProperty.call(conflicts.data.reviews[0], 'sourceItem'), 'Conflict review readback must not expose raw source item payloads');
    const reviewId = Number(conflicts.data.reviews[0]?.id || 0);
    const unsafeAttach = await client.request(`/api/media/plex-reconciliation-conflicts/${reviewId}/resolve`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 409,
      body: { action: 'attach_existing', targetMediaId: conflicts.data.reviews[0]?.existingMediaId }
    });
    assert(String(unsafeAttach.data?.error || '').includes('TMDB identifiers conflict'), `Expected unsafe attach rejection: ${JSON.stringify(unsafeAttach.data)}`);
    const resolved = await client.request(`/api/media/plex-reconciliation-conflicts/${reviewId}/resolve`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { action: 'create_separate', notes: 'smoke create separate' }
    });
    assert(resolved.data?.processingMode === 'plex_reconciliation_conflict_resolution', `Unexpected conflict resolution mode: ${JSON.stringify(resolved.data)}`);
    assert(resolved.data?.plexWriteback === false, 'Expected conflict resolution to keep Plex writeback disabled');
    assert(resolved.data?.importMutation === true, 'Expected create_separate conflict resolution to mutate local import state');
    assert(resolved.data?.review?.status === 'resolved', `Expected resolved review row: ${JSON.stringify(resolved.data)}`);
    assert(resolved.data?.review?.resolution === 'create_separate', `Expected create_separate resolution: ${JSON.stringify(resolved.data)}`);
    const resolvedMediaId = Number(resolved.data?.review?.resolvedMediaId || 0);
    assert(resolvedMediaId > 0, `Expected resolved media id: ${JSON.stringify(resolved.data)}`);
    mediaIds.push(resolvedMediaId);
    const resolvedConflicts = await client.request('/api/media/plex-reconciliation-conflicts?status=open', { expectStatus: 200 });
    assert(resolvedConflicts.data?.count === 0, `Expected no open conflict review rows after resolution: ${JSON.stringify(resolvedConflicts.data)}`);
    const afterResolutionCount = await pool.query('SELECT COUNT(*)::int AS count FROM media WHERE library_id = $1', [libraryId]);
    assert(afterResolutionCount.rows[0].count === beforeCount.rows[0].count + 2, `Expected conflict resolution to create one more media row, before=${beforeCount.rows[0].count} after=${afterResolutionCount.rows[0].count}`);
    const attachTarget = await pool.query(
      `INSERT INTO media (title, media_type, format, library_id, space_id, added_by, import_source, year)
       VALUES ('Attach Existing Candidate', 'movie', 'Digital', $1, $2, $3, 'manual', 2005)
       RETURNING id`,
      [libraryId, spaceId, userId]
    );
    const attachTargetId = Number(attachTarget.rows[0]?.id || 0);
    mediaIds.push(attachTargetId);
    const attachReview = await pool.query(
      `INSERT INTO plex_reconciliation_reviews (
         provider, source_key, status, reason, matched_by, item_snapshot, existing_snapshot,
         existing_media_id, library_id, space_id, created_by
       )
       VALUES (
         'plex', 'plex_item_key:1:9901', 'open', 'Smoke attach-existing safe candidate.',
         'operator_selected',
         $1::jsonb,
         $2::jsonb,
         $3, $4, $5, $6
       )
       RETURNING id`,
      [
        JSON.stringify({
          title: 'Attach Existing Candidate',
          media_type: 'movie',
          year: 2005,
          sectionId: '1',
          plex_item_key: '1:9901',
          plex_guid: 'tmdb://9901'
        }),
        JSON.stringify({
          id: attachTargetId,
          title: 'Attach Existing Candidate',
          media_type: 'movie',
          year: 2005,
          import_source: 'manual'
        }),
        attachTargetId,
        libraryId,
        spaceId,
        userId
      ]
    );
    const attachReviewId = Number(attachReview.rows[0]?.id || 0);
    const attached = await client.request(`/api/media/plex-reconciliation-conflicts/${attachReviewId}/resolve`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { action: 'attach_existing', targetMediaId: attachTargetId, notes: 'smoke attach existing' }
    });
    assert(attached.data?.review?.resolution === 'attach_existing', `Expected attach_existing resolution: ${JSON.stringify(attached.data)}`);
    assert(attached.data?.review?.resolvedMediaId === attachTargetId, `Expected attach target id: ${JSON.stringify(attached.data)}`);
    assert(attached.data?.importMutation === true, 'Expected attach_existing to mutate local identity metadata');
    assert(attached.data?.plexWriteback === false, 'Expected attach_existing to keep Plex writeback disabled');
    const attachedMetadata = await pool.query(
      `SELECT "key", "value" FROM media_metadata
       WHERE media_id = $1 AND "key" IN ('plex_guid', 'plex_item_key', 'plex_section_id')
       ORDER BY "key"`,
      [attachTargetId]
    );
    const attachedMap = new Map(attachedMetadata.rows.map((row) => [row.key, row.value]));
    assert(attachedMap.get('plex_item_key') === '1:9901', `Expected attached Plex item key: ${JSON.stringify(attachedMetadata.rows)}`);
    assert(attachedMap.get('plex_section_id') === '1', `Expected attached Plex section id: ${JSON.stringify(attachedMetadata.rows)}`);
    assert(fake.requests.some((entry) => entry.pathname === '/library/sections'), 'Expected sections readback');
    assert(fake.requests.some((entry) => entry.pathname === '/library/sections/1/all'), 'Expected section library readback');
    assert(fake.requests.every((entry) => entry.hasToken && entry.tokenMatched), 'Expected fake PMS requests to authenticate');

    const evidence = {
      ok: true,
      provider: 'plex',
      processingMode: job.summary.processingMode,
      readOnly: job.summary.readOnly,
      plexWriteback: job.summary.plexWriteback,
      importMutation: job.summary.importMutation,
      schedulerDefaultEnabled: schedulerStatus.data.runtime.enabled,
      schedulerIntervalMinutes: schedulerStatus.data.runtime.intervalMinutes,
      mediaCountBefore: beforeCount.rows[0].count,
      mediaCountAfter: afterResolutionCount.rows[0].count,
      fullScanExceededOldCap: job.summary.scanned > 1000,
      previewSummary: preview.data.summary,
      autoApplied: job.summary.autoApplied,
      conflictReviewCount: job.summary.conflictReviewCount,
      conflictResolution: {
        openBefore: conflicts.data.count,
        unsafeAttachRejected: true,
        action: resolved.data.review.resolution,
        resolvedMediaId: resolved.data.review.resolvedMediaId,
        openAfter: resolvedConflicts.data.count,
        attachExistingResolvedMediaId: attached.data.review.resolvedMediaId
      },
      queuedJob: {
        id: jobId,
        status: job.status,
        jobType: job.job_type,
        processingMode: job.summary.processingMode,
        readOnly: job.summary.readOnly,
        plexWriteback: job.summary.plexWriteback,
        importMutation: job.summary.importMutation,
        summary: {
          scanned: job.summary.scanned,
          alreadyLinked: job.summary.alreadyLinked,
          wouldUpdate: job.summary.wouldUpdate,
          wouldCreate: job.summary.wouldCreate,
          conflict: job.summary.conflict,
          conflictReviewCount: job.summary.conflictReviewCount
        }
      },
      bucketSamples: {
        alreadyLinked: preview.data.buckets.alreadyLinked.slice(0, 5).map((entry) => entry.matchedBy),
        wouldUpdate: preview.data.buckets.wouldUpdate.map((entry) => entry.matchedBy),
        wouldCreate: preview.data.buckets.wouldCreate.map((entry) => entry.item.title),
        conflict: preview.data.buckets.conflict.map((entry) => entry.reason)
      },
      requests: fake.requests.map((entry) => ({
        method: entry.method,
        pathname: entry.pathname,
        hasToken: entry.hasToken,
        tokenMatched: entry.tokenMatched
      })),
      assertions: [
        'Full-library reconciliation preview classified linked, update, create, and conflict rows before sync',
        'Plex reconciliation scheduler status is visible and defaults off until enabled',
        'Reconciliation sync scanned more than 1000 Plex rows when no diagnostic limit was supplied',
        'Queued reconciliation sync job created one safe missing row and updated one strong TMDB match',
        'Already-linked rows stayed no-op and conflicting rows were stored for review',
        'Attach-existing conflict resolution rejects strong identifier conflicts',
        'Attach-existing conflict resolution can attach Plex identity metadata to a safe existing row',
        'Conflict review can create a separate local Plex-linked title without Plex writeback',
        'Sync evidence did not surface Plex tokens, token query strings, private IPs, or media file paths'
      ]
    };
    assertSecretFree(preview.data, 'reconciliation preview response');
    assertSecretFree(queued.data, 'reconciliation queued response');
    assertSecretFree(job, 'reconciliation job result');
    assertSecretFree(evidence, 'reconciliation evidence');
    fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
    fs.writeFileSync(ARTIFACT_PATH, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await restorePlexSettings(snapshot);
    await cleanup({ userId, mediaIds });
    await fake.close();
    await pool.end().catch(() => {});
  }
}

main().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => {});
  process.exit(1);
});
