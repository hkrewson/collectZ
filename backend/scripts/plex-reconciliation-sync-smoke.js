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
      mediaCountAfter: afterCount.rows[0].count,
      fullScanExceededOldCap: job.summary.scanned > 1000,
      previewSummary: preview.data.summary,
      autoApplied: job.summary.autoApplied,
      conflictReviewCount: job.summary.conflictReviewCount,
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
