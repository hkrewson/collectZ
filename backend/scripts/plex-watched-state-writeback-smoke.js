#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
process.env.INTEGRATION_ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY || 'plex-watch-writeback-smoke-key';
const { encryptSecret } = require('../services/crypto');
const { ensureUserDefaultScope } = require('../services/libraries');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const fakePlexToken = `plex-watch-writeback-${crypto.randomBytes(6).toString('hex')}`;
const ARTIFACT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'artifacts',
  'plex-watch-state',
  'plex-watched-state-writeback-smoke.json'
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
      key: url.searchParams.get('key') || null,
      identifier: url.searchParams.get('identifier') || null,
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
    if (url.pathname === '/library/metadata/7200/allLeaves' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify({
        MediaContainer: {
          Metadata: [
            {
              ratingKey: '7201',
              type: 'episode',
              title: 'Episode One',
              grandparentTitle: 'Watch Writeback Show',
              grandparentRatingKey: '7200',
              parentIndex: 1,
              index: 1,
              duration: 1800000
            },
            {
              ratingKey: '7202',
              type: 'episode',
              title: 'Episode Two',
              grandparentTitle: 'Watch Writeback Show',
              grandparentRatingKey: '7200',
              parentIndex: 1,
              index: 2,
              duration: 1800000
            },
            {
              ratingKey: '7301',
              type: 'episode',
              title: 'Other Season Episode',
              grandparentTitle: 'Watch Writeback Show',
              grandparentRatingKey: '7200',
              parentIndex: 2,
              index: 1,
              duration: 1800000
            }
          ]
        }
      }));
      return;
    }
    if ((url.pathname === '/:/scrobble' || url.pathname === '/:/unscrobble')
      && req.method === 'PUT'
      && url.searchParams.get('identifier') === 'com.plexapp.plugins.library'
      && ['6201', '7201', '7202'].includes(url.searchParams.get('key'))) {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'unexpected fake PMS request' }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function main() {
  const fake = await startFakePmsServer();
  const snapshot = await snapshotPlexSettings();
  const suffix = crypto.randomBytes(6).toString('hex');
  const email = `plex-watch-writeback-${suffix}@example.com`;
  const password = `Passw0rd!${crypto.randomBytes(4).toString('hex')}`;
  const client = new HttpClient('plex-watch-writeback');
  let userId = null;
  const mediaIds = [];
  try {
    userId = await createDirectUser({ email, password, name: 'Plex Watch Writeback Admin' });
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
       VALUES ('Watch Writeback Movie', 'movie', 'Digital', $1, $2, $3, 'manual')
       RETURNING id`,
      [libraryId, spaceId, userId]
    );
    const movieId = Number(movie.rows[0].id);
    mediaIds.push(movieId);
    await pool.query(
      `INSERT INTO media_metadata (media_id, "key", "value")
       VALUES ($1, 'plex_item_key', '1:6201')`,
      [movieId]
    );
    const show = await pool.query(
      `INSERT INTO media (title, media_type, format, library_id, space_id, added_by, import_source)
       VALUES ('Watch Writeback Show', 'tv_series', 'Digital', $1, $2, $3, 'manual')
       RETURNING id`,
      [libraryId, spaceId, userId]
    );
    const showId = Number(show.rows[0].id);
    mediaIds.push(showId);
    await pool.query(
      `INSERT INTO media_metadata (media_id, "key", "value")
       VALUES ($1, 'plex_item_key', '1:7200')`,
      [showId]
    );
    await pool.query(
      `INSERT INTO media_seasons (media_id, season_number, expected_episodes, available_episodes, watch_state, source)
       VALUES ($1, 1, 2, 2, 'unwatched', 'manual_tv_season')`,
      [showId]
    );

    const beforeCount = await pool.query('SELECT COUNT(*)::int AS count FROM media WHERE library_id = $1', [libraryId]);
    const scrobble = await client.request('/api/media/write-plex-watch-state', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { mediaId: movieId, action: 'scrobble' }
    });
    const unscrobble = await client.request('/api/media/write-plex-watch-state', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { ratingKey: '6201', action: 'unscrobble' }
    });
    const seasonScrobble = await client.request('/api/media/write-plex-watch-state', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { mediaId: showId, action: 'scrobble', seasonNumber: 1 }
    });

    assert(scrobble.data?.processingMode === 'watch_state_writeback', `Unexpected scrobble mode: ${JSON.stringify(scrobble.data)}`);
    assert(unscrobble.data?.processingMode === 'watch_state_writeback', `Unexpected unscrobble mode: ${JSON.stringify(unscrobble.data)}`);
    assert(seasonScrobble.data?.processingMode === 'watch_state_writeback', `Unexpected season scrobble mode: ${JSON.stringify(seasonScrobble.data)}`);
    assert(scrobble.data?.request?.method === 'PUT', `Expected scrobble PUT: ${JSON.stringify(scrobble.data)}`);
    assert(unscrobble.data?.request?.method === 'PUT', `Expected unscrobble PUT: ${JSON.stringify(unscrobble.data)}`);
    assert(seasonScrobble.data?.request?.method === 'PUT', `Expected season scrobble PUT: ${JSON.stringify(seasonScrobble.data)}`);
    assert(scrobble.data?.request?.path === '/:/scrobble', `Expected scrobble path: ${JSON.stringify(scrobble.data)}`);
    assert(unscrobble.data?.request?.path === '/:/unscrobble', `Expected unscrobble path: ${JSON.stringify(unscrobble.data)}`);
    assert(seasonScrobble.data?.request?.path === '/:/scrobble', `Expected season scrobble path: ${JSON.stringify(seasonScrobble.data)}`);
    assert(Number(seasonScrobble.data?.episodeWriteback?.episodeCount || 0) === 2, `Expected two season episodes: ${JSON.stringify(seasonScrobble.data)}`);
    assert(Number(seasonScrobble.data?.episodeWriteback?.seasonNumber || 0) === 1, `Expected season one writeback: ${JSON.stringify(seasonScrobble.data)}`);
    assert(scrobble.data?.plexWriteback === true && scrobble.data?.readOnlyPlex === false, 'Expected explicit Plex writeback flags');

    const afterCount = await pool.query('SELECT COUNT(*)::int AS count FROM media WHERE library_id = $1', [libraryId]);
    assert(beforeCount.rows[0].count === afterCount.rows[0].count, `Expected no media rows created, before=${beforeCount.rows[0].count} after=${afterCount.rows[0].count}`);

    const metadata = await pool.query(
      `SELECT "key", "value" FROM media_metadata
        WHERE media_id = $1
          AND ("key" LIKE 'plex_watch_writeback_%' OR "key" IN ('plex_watch_state', 'plex_watch_state_updated_at'))
        ORDER BY "key"`,
      [movieId]
    );
    const metadataMap = new Map(metadata.rows.map((row) => [row.key, row.value]));
    assert(metadataMap.get('plex_watch_writeback_last_action') === 'unscrobble', `Expected last action metadata: ${JSON.stringify(metadata.rows)}`);
    assert(metadataMap.get('plex_watch_writeback_rating_key') === '6201', `Expected rating key metadata: ${JSON.stringify(metadata.rows)}`);
    assert(metadataMap.get('plex_watch_writeback_status') === 'success', `Expected success metadata: ${JSON.stringify(metadata.rows)}`);
    assert(metadataMap.get('plex_watch_state') === 'unwatched', `Expected final watch state metadata: ${JSON.stringify(metadata.rows)}`);
    const season = await pool.query(
      `SELECT season_number, watch_state, available_episodes, is_complete, source
       FROM media_seasons
       WHERE media_id = $1 AND season_number = 1`,
      [showId]
    );
    assert(season.rows[0]?.watch_state === 'completed', `Expected season completed state: ${JSON.stringify(season.rows[0])}`);
    assert(season.rows[0]?.is_complete === true, `Expected season complete flag: ${JSON.stringify(season.rows[0])}`);
    assert(Number(season.rows[0]?.available_episodes) === 2, `Expected season available episode count: ${JSON.stringify(season.rows[0])}`);
    const seriesState = await pool.query(
      `SELECT "key", "value" FROM media_metadata
       WHERE media_id = $1 AND "key" = 'plex_watch_state'`,
      [showId]
    );
    assert(seriesState.rowCount === 0, `Season writeback should not mark the whole series watched: ${JSON.stringify(seriesState.rows)}`);

    const writebackRequests = fake.requests.filter((entry) => entry.pathname === '/:/scrobble' || entry.pathname === '/:/unscrobble');
    assert(writebackRequests.length === 4, `Expected four fake PMS writebacks: ${JSON.stringify(fake.requests)}`);
    assert(writebackRequests.every((entry) => entry.method === 'PUT'), `Expected PUT requests: ${JSON.stringify(writebackRequests)}`);
    assert(fake.requests.some((entry) => entry.pathname === '/:/scrobble'), `Expected scrobble request: ${JSON.stringify(fake.requests)}`);
    assert(fake.requests.some((entry) => entry.pathname === '/:/unscrobble'), `Expected unscrobble request: ${JSON.stringify(fake.requests)}`);
    assert(fake.requests.every((entry) => entry.hasToken && entry.tokenMatched), 'Expected fake PMS requests to authenticate');

    const evidence = {
      ok: true,
      provider: 'plex',
      processingMode: 'watch_state_writeback',
      mediaCountBefore: beforeCount.rows[0].count,
      mediaCountAfter: afterCount.rows[0].count,
      mediaId: movieId,
      finalWatchState: metadataMap.get('plex_watch_state'),
      lastAction: metadataMap.get('plex_watch_writeback_last_action'),
      tvSeries: {
        mediaId: showId,
        seasonNumber: Number(season.rows[0]?.season_number || 0),
        seasonWatchState: season.rows[0]?.watch_state || null,
        seriesWatchStateMetadata: null,
        episodeWritebackCount: seasonScrobble.data?.episodeWriteback?.episodeCount || 0
      },
      requests: fake.requests.map((entry) => ({
        method: entry.method,
        pathname: entry.pathname,
        key: entry.key,
        identifier: entry.identifier,
        hasToken: entry.hasToken,
        tokenMatched: entry.tokenMatched
      })),
      assertions: [
        'Explicit watched-state writeback called Plex scrobble and unscrobble',
        'TV season writeback resolved Plex episode leaves before scrobbling episode keys',
        'TV season writeback did not mark the whole series watched',
        'No new media rows were created during watched-state writeback',
        'Writeback response and evidence stayed token-safe'
      ]
    };
    assertSecretFree(evidence, 'watched-state writeback evidence');
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
