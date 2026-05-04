'use strict';

const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const KAVITA_SMOKE_KEY = `kavita-smoke-${crypto.randomBytes(8).toString('hex')}`;
const KAVITA_SMOKE_BEARER = `kavita-bearer-${crypto.randomBytes(8).toString('hex')}`;

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
    const {
      method = 'GET',
      body,
      expectStatus,
      withCsrf = false,
      headers: extraHeaders = {}
    } = options;

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

async function startFakeKavitaServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'POST' && url.pathname === '/api/Plugin/authenticate') {
      if (url.searchParams.get('apiKey') !== KAVITA_SMOKE_KEY || url.searchParams.get('pluginName') !== 'collectZ') {
        res.writeHead(401);
        res.end(JSON.stringify({ message: 'unauthorized' }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify({
        id: 7,
        username: 'kavita-smoke',
        token: KAVITA_SMOKE_BEARER,
        kavitaVersion: '0.8-smoke'
      }));
      return;
    }

    if (req.headers.authorization !== `Bearer ${KAVITA_SMOKE_BEARER}`) {
      res.writeHead(403);
      res.end(JSON.stringify({ message: 'forbidden' }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/Library/libraries') {
      res.writeHead(200);
      res.end(JSON.stringify([
        { id: 11, name: 'Smoke Books', type: 2, lastScanned: '2026-05-03T00:00:00Z' },
        { id: 12, name: 'Smoke Comics', type: 1, lastScanned: '2026-05-03T00:00:00Z' }
      ]));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/Series/all-v2') {
      res.writeHead(200);
      res.end(JSON.stringify([
        { id: 101, libraryId: 11, libraryName: 'Smoke Books', name: 'Smoke Novel', localizedName: 'Smoke Novel', sortName: 'Smoke Novel', pages: 320, format: 3 },
        { id: 202, libraryId: 12, libraryName: 'Smoke Comics', name: 'Smoke Issue', localizedName: 'Smoke Issue', sortName: 'Smoke Issue', pages: 24, format: 1 }
      ]));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ message: 'not found' }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to start fake Kavita server');
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function cleanupTemporaryState({ userId, libraryId, spaceId }) {
  if (libraryId) {
    await pool.query('DELETE FROM media_metadata WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM library_memberships WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM libraries WHERE id = $1', [libraryId]).catch(() => {});
  }
  if (spaceId) {
    await pool.query('DELETE FROM app_integrations WHERE space_id = $1', [spaceId]).catch(() => {});
    await pool.query('DELETE FROM space_memberships WHERE space_id = $1', [spaceId]).catch(() => {});
    await pool.query('DELETE FROM spaces WHERE id = $1', [spaceId]).catch(() => {});
  }
  if (userId) {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
  }
}

async function main() {
  const suffix = Date.now();
  const email = `kavita-smoke-${suffix}@example.com`;
  const password = `Passw0rd!${crypto.randomBytes(6).toString('hex')}`;
  const client = new HttpClient('kavita-connection-smoke');
  const fake = await startFakeKavitaServer();
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Kavita Smoke Admin',
      role: 'admin'
    });

    await client.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ email, password }),
      headers: { 'Content-Type': 'application/json' }
    });
    client.csrfToken = '';

    const scope = await client.request('/api/auth/scope', { expectStatus: 200 });
    libraryId = Number(scope?.data?.active_library_id || 0) || null;
    spaceId = Number(scope?.data?.active_space_id || 0) || null;

    const saveResponse = await client.request('/api/admin/settings/integrations', {
      method: 'PUT',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({
        kavitaBaseUrl: fake.baseUrl,
        kavitaApiKey: KAVITA_SMOKE_KEY,
        kavitaTimeoutMs: 5000
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(saveResponse.data?.kavitaBaseUrl === fake.baseUrl, `Expected saved Kavita base URL, got ${JSON.stringify(saveResponse.data)}`);
    assert(saveResponse.data?.kavitaApiKeySet === true, 'Expected saved Kavita API key to be redacted as set');
    assert(!('kavitaApiKey' in saveResponse.data), 'Kavita API key must not be returned in settings response');

    const testResponse = await client.request('/api/admin/settings/integrations/test-kavita', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' }
    });

    assert(testResponse.data?.ok === true, `Expected Kavita test ok response, got ${JSON.stringify(testResponse.data)}`);
    assert(testResponse.data?.libraryCount === 2, `Expected two libraries, got ${JSON.stringify(testResponse.data)}`);
    assert(Array.isArray(testResponse.data?.seriesSample) && testResponse.data.seriesSample.length === 2, `Expected series sample, got ${JSON.stringify(testResponse.data)}`);
    assert(String(testResponse.data?.seriesSample?.[0]?.openUrl || '').includes('/library/11/series/101'), `Expected Kavita series open URL, got ${JSON.stringify(testResponse.data?.seriesSample)}`);

    console.log(JSON.stringify({
      provider: testResponse.data.provider,
      authenticated: testResponse.data.authenticated,
      libraryCount: testResponse.data.libraryCount,
      seriesSampleCount: testResponse.data.seriesSample.length,
      openUrlPresent: Boolean(testResponse.data.openUrl),
      secretReturned: 'kavitaApiKey' in testResponse.data
    }, null, 2));
  } finally {
    await client.request('/api/admin/settings/integrations', {
      method: 'PUT',
      withCsrf: true,
      body: JSON.stringify({ kavitaBaseUrl: '', clearKavitaApiKey: true }),
      headers: { 'Content-Type': 'application/json' }
    }).catch(() => {});
    await cleanupTemporaryState({ userId, libraryId, spaceId });
    await new Promise((resolve) => fake.server.close(resolve)).catch(() => {});
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
