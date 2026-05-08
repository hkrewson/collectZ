'use strict';

const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { encryptSecret } = require('../services/crypto');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const fakeToken = `plex-now-playing-viewer-${crypto.randomBytes(8).toString('hex')}`;
const imageBody = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
  0x00, 0x48, 0x00, 0x00, 0xff, 0xd9
]);

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
      const key = firstPart.slice(0, idx).trim();
      const value = firstPart.slice(idx + 1).trim();
      if (key) this.cookies.set(key, value);
    }
  }

  cookieHeader() {
    return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async request(path, options = {}) {
    const { method = 'GET', body, expectStatus, withCsrf = false, headers: extraHeaders = {} } = options;
    const headers = { Accept: 'application/json', ...extraHeaders };
    if (withCsrf) {
      if (!this.csrfToken) await this.fetchCsrfToken();
      headers['x-csrf-token'] = this.csrfToken;
    }
    const cookieHeader = this.cookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;

    const response = await fetch(`${BASE_URL}${path}`, { method, headers, body });
    this.applySetCookies(response.headers);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const text = buffer.toString('utf8');
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = buffer;
    }
    if (expectStatus !== undefined && response.status !== expectStatus) {
      throw new Error(`[${this.name}] ${method} ${path} expected ${expectStatus}, got ${response.status}. Body: ${JSON.stringify(data)}`);
    }
    return { status: response.status, data, headers: response.headers, buffer };
  }

  async fetchCsrfToken() {
    const response = await this.request('/api/auth/csrf-token', { expectStatus: 200 });
    const token = response?.data?.csrfToken;
    if (!token) throw new Error(`[${this.name}] Missing CSRF token`);
    this.csrfToken = token;
    return token;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function createDirectUser({ email, password, name, role = 'admin' }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, $3, $4, true, NOW())
     RETURNING id`,
    [email, passwordHash, name, role]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

async function snapshotPlexSettings() {
  const result = await pool.query(
    `SELECT plex_preset,
            plex_provider,
            plex_api_url,
            plex_api_key_encrypted,
            plex_library_sections,
            plex_now_playing_display_token_hash,
            plex_now_playing_display_token_created_at,
            plex_now_playing_display_token_last_used_at,
            plex_now_playing_display_preferences
       FROM app_integrations
      WHERE id = 1`
  );
  return result.rows[0] || null;
}

async function applyFakePlexSettings(baseUrl) {
  await pool.query(
    `INSERT INTO app_integrations (id, plex_preset, plex_provider, plex_api_url, plex_api_key_encrypted, plex_library_sections, updated_at)
     VALUES (1, 'plex', 'plex', $1, $2, '[]'::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       plex_preset = EXCLUDED.plex_preset,
       plex_provider = EXCLUDED.plex_provider,
       plex_api_url = EXCLUDED.plex_api_url,
       plex_api_key_encrypted = EXCLUDED.plex_api_key_encrypted,
       plex_library_sections = EXCLUDED.plex_library_sections,
       updated_at = NOW()`,
    [baseUrl, encryptSecret(fakeToken)]
  );
}

async function restorePlexSettings(snapshot) {
  if (!snapshot) {
    await pool.query(
      `UPDATE app_integrations
          SET plex_preset = 'plex',
              plex_provider = 'plex',
              plex_api_url = NULL,
              plex_api_key_encrypted = NULL,
              plex_library_sections = '[]'::jsonb,
              plex_now_playing_display_token_hash = NULL,
              plex_now_playing_display_token_created_at = NULL,
              plex_now_playing_display_token_last_used_at = NULL,
              plex_now_playing_display_preferences = '{}'::jsonb,
              updated_at = NOW()
        WHERE id = 1`
    ).catch(() => {});
    return;
  }

  await pool.query(
    `UPDATE app_integrations
        SET plex_preset = $1,
            plex_provider = $2,
            plex_api_url = $3,
            plex_api_key_encrypted = $4,
            plex_library_sections = $5,
            plex_now_playing_display_token_hash = $6,
            plex_now_playing_display_token_created_at = $7,
            plex_now_playing_display_token_last_used_at = $8,
            plex_now_playing_display_preferences = $9::jsonb,
            updated_at = NOW()
      WHERE id = 1`,
    [
      snapshot.plex_preset,
      snapshot.plex_provider,
      snapshot.plex_api_url,
      snapshot.plex_api_key_encrypted,
      JSON.stringify(snapshot.plex_library_sections || []),
      snapshot.plex_now_playing_display_token_hash,
      snapshot.plex_now_playing_display_token_created_at,
      snapshot.plex_now_playing_display_token_last_used_at,
      JSON.stringify(snapshot.plex_now_playing_display_preferences || {})
    ]
  ).catch(() => {});
}

async function startFakePmsServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    requests.push({
      method: req.method,
      pathname: url.pathname,
      hasToken: url.searchParams.has('X-Plex-Token'),
      tokenMatched: url.searchParams.get('X-Plex-Token') === fakeToken
    });

    if (url.searchParams.get('X-Plex-Token') !== fakeToken) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/status/sessions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        MediaContainer: {
          size: 1,
          Metadata: [{
            ratingKey: '12345',
            sessionKey: '987',
            type: 'movie',
            title: 'Viewer Safe Payload',
            year: 2026,
            key: '/library/metadata/12345',
            thumb: '/library/metadata/12345/thumb/1700000000',
            art: '/library/metadata/12345/art/1700000000',
            duration: 2000000,
            viewOffset: 500000,
            User: { title: 'Local Viewer', username: 'local-viewer', id: '42', token: 'must-not-surface' },
            Player: { title: 'Living Room', product: 'Plex Web', state: 'playing', platform: 'Chrome', address: '192.168.1.24', machineIdentifier: 'must-not-surface' },
            Media: [{ Part: [{ file: '/private/media/example.mkv' }] }],
            token: 'must-not-surface'
          }]
        }
      }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/library/metadata/12345/thumb/1700000000') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end(imageBody);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
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
  const suffix = Date.now();
  const email = `plex-viewer-${suffix}@example.com`;
  const password = `${crypto.randomBytes(12).toString('base64url')}aA1!`;
  const client = new HttpClient('plex-now-playing-viewer-smoke');
  const fake = await startFakePmsServer();
  const snapshot = await snapshotPlexSettings();
  let userId = null;

  try {
    await applyFakePlexSettings(fake.baseUrl);
    userId = await createDirectUser({ email, password, name: 'Plex Now Playing Viewer Admin', role: 'admin' });
    await client.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ email, password }),
      headers: { 'Content-Type': 'application/json' }
    });
    client.csrfToken = '';

    const viewer = await client.request('/api/plex/now-playing-viewer', { expectStatus: 200 });
    assert(viewer.data?.ok === true, `Expected viewer response: ${JSON.stringify(viewer.data)}`);
    assert(viewer.data?.sessionCount === 1, `Expected one viewer session: ${JSON.stringify(viewer.data)}`);
    const session = viewer.data.sessions?.[0] || {};
    assert(session.title === 'Viewer Safe Payload', `Expected viewer title: ${JSON.stringify(session)}`);
    assert(session.progressPercent === 25, `Expected progress readback: ${JSON.stringify(session)}`);
    assert(session.posterImagePath?.startsWith('/api/plex/now-playing-image?key='), `Expected proxied poster path: ${JSON.stringify(session)}`);
    assert(!JSON.stringify(viewer.data).includes(fakeToken), 'Viewer response must not contain raw Plex token');
    assert(!JSON.stringify(viewer.data).includes('/private/media'), 'Viewer response must not contain media file paths');
    assert(!JSON.stringify(viewer.data).includes('192.168.1.24'), 'Viewer response must not contain player IP addresses');
    assert(!JSON.stringify(viewer.data).includes('machineIdentifier'), 'Viewer response must not contain machine identifiers');

    const image = await client.request(session.posterImagePath, { expectStatus: 200 });
    assert(String(image.headers.get('content-type') || '').includes('image/jpeg'), 'Expected proxied image content type');
    assert(image.buffer.length === imageBody.length, `Expected proxied image body length ${imageBody.length}, got ${image.buffer.length}`);

    const generated = await client.request('/api/admin/settings/integrations/plex-now-playing-display-token', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' }
    });
    const displayToken = generated.data?.token;
    assert(typeof displayToken === 'string' && displayToken.startsWith('cznp_'), 'Expected one-time display token');
    assert(generated.data?.displayPath?.startsWith('/now-playing?token='), `Expected display path: ${JSON.stringify(generated.data)}`);
    assert(!generated.data?.plexNowPlayingDisplayToken?.token, 'Display token status must not echo token');

    const preferences = await client.request('/api/admin/settings/integrations/plex-now-playing-display-preferences', {
      method: 'PUT',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({
        preferences: {
          showPoster: false,
          showBackdrop: false,
          showContext: false,
          showPlayer: false,
          showProgress: false,
          showUpdatedAt: false,
          showPausedSessions: false,
          textScale: 'large',
          layoutMode: 'poster_only'
        }
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(preferences.data?.plexNowPlayingDisplayPreferences?.showPoster === false, `Expected saved display preferences: ${JSON.stringify(preferences.data)}`);
    assert(preferences.data?.plexNowPlayingDisplayPreferences?.textScale === 'large', `Expected saved text scale: ${JSON.stringify(preferences.data)}`);
    assert(preferences.data?.plexNowPlayingDisplayPreferences?.layoutMode === 'poster_only', `Expected saved layout mode: ${JSON.stringify(preferences.data)}`);

    const displayClient = new HttpClient('plex-now-playing-display-token-smoke');
    const displayViewer = await displayClient.request(`/api/plex/now-playing-display?token=${encodeURIComponent(displayToken)}`, { expectStatus: 200 });
    assert(displayViewer.data?.access === 'display_token', `Expected display token access: ${JSON.stringify(displayViewer.data)}`);
    assert(displayViewer.data?.displayPreferences?.showPoster === false, `Expected display preference readback: ${JSON.stringify(displayViewer.data)}`);
    assert(displayViewer.data?.displayPreferences?.textScale === 'large', `Expected display text scale readback: ${JSON.stringify(displayViewer.data)}`);
    assert(displayViewer.data?.displayPreferences?.layoutMode === 'poster_only', `Expected display layout readback: ${JSON.stringify(displayViewer.data)}`);
    assert(displayViewer.data?.sessions?.[0]?.title === 'Viewer Safe Payload', `Expected display viewer title: ${JSON.stringify(displayViewer.data)}`);
    assert(displayViewer.data?.sessions?.[0]?.posterImagePath?.startsWith('/api/plex/now-playing-display-image?key='), `Expected display image path: ${JSON.stringify(displayViewer.data)}`);
    assert(!JSON.stringify(displayViewer.data).includes(displayToken), 'Display viewer payload must not echo display token');

    const displayImagePath = `${displayViewer.data.sessions[0].posterImagePath}&token=${encodeURIComponent(displayToken)}`;
    const displayImage = await displayClient.request(displayImagePath, { expectStatus: 200 });
    assert(String(displayImage.headers.get('content-type') || '').includes('image/jpeg'), 'Expected display proxied image content type');

    await client.request('/api/admin/settings/integrations/plex-now-playing-display-token', {
      method: 'DELETE',
      withCsrf: true,
      expectStatus: 200
    });
    await displayClient.request(`/api/plex/now-playing-display?token=${encodeURIComponent(displayToken)}`, { expectStatus: 401 });

    console.log(JSON.stringify({
      ok: true,
      viewerPath: '/api/plex/now-playing-viewer',
      displayPath: '/api/plex/now-playing-display',
      imagePath: '/api/plex/now-playing-image',
      displayImagePath: '/api/plex/now-playing-display-image',
      sessionCount: viewer.data.sessionCount,
      requests: fake.requests.map((entry) => ({
        method: entry.method,
        pathname: entry.pathname,
        hasToken: entry.hasToken,
        tokenMatched: entry.tokenMatched
      }))
    }, null, 2));
  } finally {
    await restorePlexSettings(snapshot);
    if (userId) await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
    await fake.close();
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
