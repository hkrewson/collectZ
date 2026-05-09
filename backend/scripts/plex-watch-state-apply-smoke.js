#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
process.env.INTEGRATION_ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY || 'plex-watch-state-apply-smoke-key';
const { encryptSecret } = require('../services/crypto');
const { ensureUserDefaultScope } = require('../services/libraries');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const fakePlexToken = `plex-watch-apply-${crypto.randomBytes(6).toString('hex')}`;
const ARTIFACT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'artifacts',
  'plex-watch-state',
  'plex-watch-state-apply-smoke.json'
);

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
    if (req.method === 'GET' && url.pathname === '/library/metadata/1001') {
      res.writeHead(200);
      res.end(JSON.stringify({
        MediaContainer: {
          Metadata: [{
            ratingKey: '1001',
            type: 'movie',
            title: 'Watch Apply Movie',
            viewCount: 1,
            lastViewedAt: 1778250000,
            duration: 7200000,
            viewOffset: 0,
            Media: [{ Part: [{ file: '/mnt/plex-media/Watch Apply Movie.mkv' }] }]
          }]
        }
      }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/library/metadata/2001/allLeaves') {
      res.writeHead(200);
      res.end(JSON.stringify({
        MediaContainer: {
          Metadata: [
            {
              ratingKey: '2001-1',
              grandparentRatingKey: '2001',
              type: 'episode',
              grandparentTitle: 'Watch Apply Show',
              parentTitle: 'Season 1',
              title: 'Watched Episode',
              parentIndex: 1,
              index: 1,
              viewCount: 1,
              viewedAt: 1778253600,
              duration: 1800000,
              viewOffset: 0
            },
            {
              ratingKey: '2001-2',
              grandparentRatingKey: '2001',
              type: 'episode',
              grandparentTitle: 'Watch Apply Show',
              parentTitle: 'Season 1',
              title: 'Paused Episode',
              parentIndex: 1,
              index: 2,
              viewCount: 0,
              duration: 1800000,
              viewOffset: 900000
            }
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

async function main() {
  const snapshot = await snapshotPlexSettings();
  const fake = await startFakePmsServer();
  const suffix = Date.now();
  const email = `plex-watch-apply-${suffix}@example.com`;
  const password = `Passw0rd!${crypto.randomBytes(4).toString('hex')}`;
  const client = new HttpClient('plex-watch-apply');
  let userId = null;
  const mediaIds = [];
  try {
    userId = await createDirectUser({ email, password, name: 'Plex Watch Apply Admin' });
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
      `INSERT INTO media (title, media_type, format, library_id, space_id, added_by, import_source)
       VALUES ('Watch Apply Movie', 'movie', 'Digital', $1, $2, $3, 'manual')
       RETURNING id`,
      [libraryId, spaceId, userId]
    );
    const movieId = Number(movie.rows[0].id);
    mediaIds.push(movieId);
    await pool.query(
      `INSERT INTO media_metadata (media_id, "key", "value")
       VALUES ($1, 'plex_item_key', '1:1001')`,
      [movieId]
    );

    const show = await pool.query(
      `INSERT INTO media (title, media_type, format, library_id, space_id, added_by, import_source)
       VALUES ('Watch Apply Show', 'tv_series', 'Digital', $1, $2, $3, 'manual')
       RETURNING id`,
      [libraryId, spaceId, userId]
    );
    const showId = Number(show.rows[0].id);
    mediaIds.push(showId);
    await pool.query(
      `INSERT INTO media_metadata (media_id, "key", "value")
       VALUES ($1, 'plex_item_key', '1:2001')`,
      [showId]
    );
    await pool.query(
      `INSERT INTO media_seasons (media_id, season_number, expected_episodes, available_episodes, watch_state, source)
       VALUES ($1, 1, 2, 2, 'unwatched', 'manual_tv_season')`,
      [showId]
    );

    const beforeCount = await pool.query('SELECT COUNT(*)::int AS count FROM media WHERE library_id = $1', [libraryId]);
    const apply = await client.request('/api/media/apply-plex-watch-state', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: {
        ratingKeys: ['1001'],
        leafRatingKeys: ['2001']
      }
    });

    assert(apply.data?.processingMode === 'watch_state_apply', `Unexpected processing mode: ${JSON.stringify(apply.data)}`);
    assert(apply.data?.plexWriteback === false, 'Expected Plex writeback to stay disabled');
    assert(apply.data?.summary?.mediaMatched === 2, `Expected two matched media rows: ${JSON.stringify(apply.data?.summary)}`);
    assert(apply.data?.summary?.mediaMetadataUpdated === 1, `Expected one movie metadata update: ${JSON.stringify(apply.data?.summary)}`);
    assert(apply.data?.summary?.seasonsUpdated === 1, `Expected one season update: ${JSON.stringify(apply.data?.summary)}`);

    const metadata = await pool.query(
      `SELECT "key", "value" FROM media_metadata WHERE media_id = $1 AND "key" LIKE 'plex_watch_%' ORDER BY "key"`,
      [movieId]
    );
    const metadataMap = new Map(metadata.rows.map((row) => [row.key, row.value]));
    assert(metadataMap.get('plex_watch_state') === 'completed', `Expected movie completed state: ${JSON.stringify(metadata.rows)}`);
    assert(metadataMap.get('plex_watch_progress_percent') === '0', `Expected movie progress metadata: ${JSON.stringify(metadata.rows)}`);

    const season = await pool.query(
      `SELECT season_number, watch_state, available_episodes, last_watched_at, source
       FROM media_seasons
       WHERE media_id = $1 AND season_number = 1`,
      [showId]
    );
    assert(season.rows[0]?.watch_state === 'in_progress', `Expected season in_progress state: ${JSON.stringify(season.rows[0])}`);
    assert(Number(season.rows[0]?.available_episodes) === 2, `Expected available episode count: ${JSON.stringify(season.rows[0])}`);
    assert(season.rows[0]?.last_watched_at, `Expected last watched timestamp: ${JSON.stringify(season.rows[0])}`);

    const afterCount = await pool.query('SELECT COUNT(*)::int AS count FROM media WHERE library_id = $1', [libraryId]);
    assert(beforeCount.rows[0].count === afterCount.rows[0].count, `Expected no media rows to be created, before=${beforeCount.rows[0].count} after=${afterCount.rows[0].count}`);
    assert(!fake.requests.some((entry) => entry.pathname === '/:/scrobble' || entry.pathname === '/:/unscrobble'), 'Smoke must not call Plex watched-state writeback paths');
    assert(fake.requests.every((entry) => entry.hasToken && entry.tokenMatched), 'Expected fake PMS requests to authenticate');

    const evidence = {
      ok: true,
      provider: 'plex',
      processingMode: apply.data.processingMode,
      mediaCountBefore: beforeCount.rows[0].count,
      mediaCountAfter: afterCount.rows[0].count,
      summary: apply.data.summary,
      movieWatchState: metadataMap.get('plex_watch_state'),
      seasonWatchState: season.rows[0]?.watch_state,
      requests: fake.requests.map((entry) => ({
        method: entry.method,
        pathname: entry.pathname,
        hasToken: entry.hasToken,
        tokenMatched: entry.tokenMatched
      })),
      assertions: [
        'Plex watched-state readback updated existing movie metadata',
        'Plex episode leaf readback updated existing TV season state',
        'No new media rows were created during watched-state apply',
        'Plex scrobble and unscrobble writeback paths were not called'
      ]
    };
    assertSecretFree(evidence, 'watch-state apply evidence');
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

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
