'use strict';

const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { encryptSecret } = require('../services/crypto');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const fakeToken = `plex-readback-${crypto.randomBytes(8).toString('hex')}`;

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
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (expectStatus !== undefined && response.status !== expectStatus) {
      throw new Error(`[${this.name}] ${method} ${path} expected ${expectStatus}, got ${response.status}. Body: ${JSON.stringify(data)}`);
    }
    return { status: response.status, data };
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
    `SELECT plex_preset, plex_provider, plex_api_url, plex_api_key_encrypted, plex_library_sections
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
            updated_at = NOW()
      WHERE id = 1`,
    [
      snapshot.plex_preset,
      snapshot.plex_provider,
      snapshot.plex_api_url,
      snapshot.plex_api_key_encrypted,
      JSON.stringify(snapshot.plex_library_sections || [])
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

    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'GET' || url.pathname !== '/media/providers') {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    if (url.searchParams.get('X-Plex-Token') !== fakeToken) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify({
      MediaContainer: {
        MediaProvider: [{
          key: 'com.plexapp.plugins.library',
          title: 'Library',
          type: 'library',
          protocol: 'plex',
          identifier: 'com.plexapp.plugins.library',
          Feature: [{ key: 'browse' }, { key: 'metadata' }],
          token: 'must-not-surface',
          url: 'http://127.0.0.1/private'
        }]
      }
    }));
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
  const email = `plex-readback-${suffix}@example.com`;
  const password = `Passw0rd!${crypto.randomBytes(6).toString('hex')}`;
  const client = new HttpClient('plex-provider-readback-smoke');
  const fake = await startFakePmsServer();
  const snapshot = await snapshotPlexSettings();
  let userId = null;

  try {
    await applyFakePlexSettings(fake.baseUrl);
    userId = await createDirectUser({ email, password, name: 'Plex Readback Smoke Admin', role: 'admin' });
    await client.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ email, password }),
      headers: { 'Content-Type': 'application/json' }
    });
    client.csrfToken = '';

    const response = await client.request('/api/admin/settings/integrations/test-plex-providers', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' }
    });

    assert(response.data?.ok === true, `Expected successful provider probe: ${JSON.stringify(response.data)}`);
    assert(response.data?.path === '/media/providers', `Expected provider path readback: ${JSON.stringify(response.data)}`);
    assert(response.data?.providerCount === 1, `Expected one provider: ${JSON.stringify(response.data)}`);
    const provider = response.data?.providers?.[0];
    assert(provider?.key === 'com.plexapp.plugins.library', `Expected library provider: ${JSON.stringify(provider)}`);
    assert(Array.isArray(provider.featureKeys) && provider.featureKeys.includes('browse'), `Expected feature keys: ${JSON.stringify(provider)}`);
    assert(!Object.prototype.hasOwnProperty.call(provider, 'token'), 'Provider readback must not expose token');
    assert(!Object.prototype.hasOwnProperty.call(provider, 'url'), 'Provider readback must not expose provider URL');
    assert(!JSON.stringify(response.data).includes(fakeToken), 'Response must not contain raw Plex token');

    const request = fake.requests.find((entry) => entry.pathname === '/media/providers');
    assert(request?.hasToken === true && request?.tokenMatched === true, `Expected token-authenticated fake PMS request: ${JSON.stringify(fake.requests)}`);

    console.log(JSON.stringify({
      ok: true,
      path: response.data.path,
      providerCount: response.data.providerCount,
      providerKeys: response.data.providers.map((entry) => entry.key),
      fakePmsRequests: fake.requests.map((entry) => ({
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
