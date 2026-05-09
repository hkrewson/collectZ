#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
process.env.INTEGRATION_ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY || 'plex-rating-writeback-smoke-key';
const { encryptSecret } = require('../services/crypto');
const { ensureUserDefaultScope } = require('../services/libraries');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const fakePlexToken = `plex-rating-writeback-${crypto.randomBytes(6).toString('hex')}`;
const ARTIFACT_PATH = path.resolve(__dirname, '..', '..', 'artifacts', 'plex-ratings', 'plex-rating-writeback-smoke.json');

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
      key: url.searchParams.get('key') || null,
      rating: url.searchParams.get('rating') || null,
      identifier: url.searchParams.get('identifier') || null,
      hasRatedAt: url.searchParams.has('ratedAt'),
      hasToken: url.searchParams.has('X-Plex-Token'),
      tokenMatched: url.searchParams.get('X-Plex-Token') === fakePlexToken,
      unexpectedFilePath: '/mnt/plex-media/should-not-surface.mkv',
      unexpectedPrivateIp: '192.168.1.50'
    });
    res.setHeader('Content-Type', 'application/json');
    if (url.searchParams.get('X-Plex-Token') !== fakePlexToken) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (url.pathname === '/:/rate'
      && req.method === 'PUT'
      && url.searchParams.get('identifier') === 'com.plexapp.plugins.library'
      && url.searchParams.get('key') === '7101'
      && url.searchParams.get('rating') === '9') {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'unexpected fake PMS request' }));
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

async function main() {
  const fake = await startFakePmsServer();
  const snapshot = await snapshotPlexSettings();
  const suffix = crypto.randomBytes(6).toString('hex');
  const email = `plex-rating-writeback-${suffix}@example.com`;
  const password = `Passw0rd!${crypto.randomBytes(4).toString('hex')}`;
  const client = new HttpClient('plex-rating-writeback');
  let userId = null;
  const mediaIds = [];
  try {
    userId = await createDirectUser({ email, password, name: 'Plex Rating Writeback Admin' });
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

    const movie = await pool.query(
      `INSERT INTO media (title, media_type, format, library_id, space_id, added_by, import_source, user_rating)
       VALUES ('Rating Writeback Movie', 'movie', 'Digital', $1, $2, $3, 'manual', 4)
       RETURNING id`,
      [libraryId, spaceId, userId]
    );
    const movieId = Number(movie.rows[0].id);
    mediaIds.push(movieId);
    await pool.query(
      `INSERT INTO media_metadata (media_id, "key", "value")
       VALUES ($1, 'plex_item_key', '1:7101')`,
      [movieId]
    );

    const beforeCount = await pool.query('SELECT COUNT(*)::int AS count FROM media WHERE library_id = $1', [libraryId]);
    const writeback = await client.request('/api/media/write-plex-rating', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { mediaId: movieId, rating: 9 }
    });

    assert(writeback.data?.processingMode === 'rating_writeback', `Unexpected mode: ${JSON.stringify(writeback.data)}`);
    assert(writeback.data?.plexWriteback === true && writeback.data?.readOnlyPlex === false, 'Expected explicit Plex writeback flags');
    assert(writeback.data?.request?.method === 'PUT', `Expected PUT request: ${JSON.stringify(writeback.data)}`);
    assert(writeback.data?.request?.path === '/:/rate', `Expected rate path: ${JSON.stringify(writeback.data)}`);
    assert(writeback.data?.request?.rating === 9, `Expected rating 9: ${JSON.stringify(writeback.data)}`);

    const updated = await pool.query('SELECT user_rating FROM media WHERE id = $1', [movieId]);
    assert(Number(updated.rows[0]?.user_rating) === 9, `Expected user_rating 9: ${JSON.stringify(updated.rows[0])}`);

    const afterCount = await pool.query('SELECT COUNT(*)::int AS count FROM media WHERE library_id = $1', [libraryId]);
    assert(beforeCount.rows[0].count === afterCount.rows[0].count, `Expected no media rows created, before=${beforeCount.rows[0].count} after=${afterCount.rows[0].count}`);

    const metadata = await pool.query(
      `SELECT "key", "value" FROM media_metadata
        WHERE media_id = $1
          AND ("key" LIKE 'plex_rating_writeback_%' OR "key" IN ('plex_user_rating', 'plex_rating_source_rating_key', 'plex_rating_updated_at'))
        ORDER BY "key"`,
      [movieId]
    );
    const metadataMap = new Map(metadata.rows.map((row) => [row.key, row.value]));
    assert(metadataMap.get('plex_rating_writeback_rating') === '9', `Expected rating metadata: ${JSON.stringify(metadata.rows)}`);
    assert(metadataMap.get('plex_rating_writeback_rating_key') === '7101', `Expected rating key metadata: ${JSON.stringify(metadata.rows)}`);
    assert(metadataMap.get('plex_rating_writeback_status') === 'success', `Expected success metadata: ${JSON.stringify(metadata.rows)}`);
    assert(metadataMap.get('plex_user_rating') === '9', `Expected plex_user_rating metadata: ${JSON.stringify(metadata.rows)}`);
    assert(fake.requests.length === 1, `Expected one fake PMS writeback: ${JSON.stringify(fake.requests)}`);
    assert(fake.requests[0].method === 'PUT', `Expected PUT request: ${JSON.stringify(fake.requests)}`);
    assert(fake.requests[0].pathname === '/:/rate', `Expected /:/rate request: ${JSON.stringify(fake.requests)}`);
    assert(fake.requests[0].key === '7101', `Expected key 7101: ${JSON.stringify(fake.requests)}`);
    assert(fake.requests[0].rating === '9', `Expected rating 9: ${JSON.stringify(fake.requests)}`);
    assert(fake.requests[0].identifier === 'com.plexapp.plugins.library', `Expected identifier: ${JSON.stringify(fake.requests)}`);
    assert(fake.requests[0].hasToken && fake.requests[0].tokenMatched, 'Expected fake PMS request to authenticate');

    const evidence = {
      ok: true,
      provider: 'plex',
      processingMode: 'rating_writeback',
      mediaCountBefore: beforeCount.rows[0].count,
      mediaCountAfter: afterCount.rows[0].count,
      mediaId: movieId,
      userRating: Number(updated.rows[0]?.user_rating),
      metadataRating: metadataMap.get('plex_rating_writeback_rating'),
      requests: fake.requests.map((entry) => ({
        method: entry.method,
        pathname: entry.pathname,
        key: entry.key,
        rating: entry.rating,
        identifier: entry.identifier,
        hasRatedAt: entry.hasRatedAt,
        hasToken: entry.hasToken,
        tokenMatched: entry.tokenMatched
      })),
      assertions: [
        'Explicit rating writeback called Plex /:/rate with PUT',
        'No new media rows were created during rating writeback',
        'Writeback response and evidence stayed token-safe'
      ]
    };
    assertSecretFree(evidence, 'rating writeback evidence');
    fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
    fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
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
