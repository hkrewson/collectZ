'use strict';

const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const KAVITA_SMOKE_KEY = `kavita-import-smoke-${crypto.randomBytes(8).toString('hex')}`;
const KAVITA_SMOKE_BEARER = `kavita-import-bearer-${crypto.randomBytes(8).toString('hex')}`;
const PROVIDER_ITEM_ID = 'kavita:series:8601';

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
        id: 86,
        username: 'kavita-import-smoke',
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
        { id: 86, name: 'Kavita Smoke Books', type: 2, lastScanned: '2026-05-03T00:00:00Z' }
      ]));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/Series/all-v2') {
      const pageNumber = Number(url.searchParams.get('PageNumber') || '1');
      res.writeHead(200);
      res.end(JSON.stringify(pageNumber === 1 ? [
        {
          id: 8601,
          libraryId: 86,
          libraryName: 'Kavita Smoke Books',
          name: 'Kavita Import Sync Smoke Novel',
          localizedName: 'Kavita Import Sync Smoke Novel',
          sortName: 'Kavita Import Sync Smoke Novel',
          created: '2026-05-03T00:00:00Z',
          lastChapterAdded: '2026-05-03T00:00:00Z',
          pages: 321,
          format: 3
        }
      ] : []));
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

async function countImportedRows(libraryId) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count,
            MAX(import_source) AS import_source,
            MAX(type_details->>'provider_name') AS provider_name,
            MAX(type_details->>'provider_item_id') AS provider_item_id,
            MAX(type_details->>'author') AS author
     FROM media
     WHERE library_id = $1
       AND type_details->>'provider_item_id' = $2`,
    [libraryId, PROVIDER_ITEM_ID]
  );
  return result.rows[0] || {};
}

async function main() {
  const suffix = Date.now();
  const email = `kavita-import-smoke-${suffix}@example.com`;
  const password = `Passw0rd!${crypto.randomBytes(6).toString('hex')}`;
  const client = new HttpClient('kavita-import-sync-smoke');
  const fake = await startFakeKavitaServer();
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Kavita Import Smoke Admin',
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
    assert(libraryId, `Expected active library id, got ${JSON.stringify(scope.data)}`);

    await pool.query(
      `INSERT INTO media (title, media_type, format, owned_formats, type_details, library_id, space_id, added_by, import_source)
       VALUES ($1, 'book', 'Paperback', ARRAY['paperback']::text[], $2::jsonb, $3, $4, $5, 'csv_generic')`,
      [
        'Kavita Import Sync Smoke Novel',
        JSON.stringify({ author: 'Existing Import Author' }),
        libraryId,
        spaceId,
        userId
      ]
    );

    await client.request('/api/admin/settings/integrations', {
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

    const firstImport = await client.request('/api/media/import-kavita?sync=1&pageSize=10&maxPages=2', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' }
    });
    const secondImport = await client.request('/api/media/import-kavita?sync=1&pageSize=10&maxPages=2', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' }
    });

    const firstSummary = firstImport.data?.summary || {};
    const secondSummary = secondImport.data?.summary || {};
    assert(Number(firstSummary.created || 0) === 0, `Expected first Kavita import to reuse the existing non-Kavita title, got ${JSON.stringify(firstSummary)}`);
    assert(Number(firstSummary.updated || 0) === 1, `Expected first Kavita import to update the existing non-Kavita title, got ${JSON.stringify(firstSummary)}`);
    assert(Number(secondSummary.created || 0) === 0, `Expected second Kavita import to avoid duplicate creation, got ${JSON.stringify(secondSummary)}`);
    assert(Number(secondSummary.updated || 0) === 1, `Expected second Kavita import to update/no-op the canonical row, got ${JSON.stringify(secondSummary)}`);
    assert(Number(firstSummary.libraryCount || 0) === 1, `Expected Kavita import summary to include library count, got ${JSON.stringify(firstSummary)}`);

    const canonical = await countImportedRows(libraryId);
    assert(Number(canonical.count || 0) === 1, `Expected exactly one canonical Kavita row, got ${JSON.stringify(canonical)}`);
    assert(String(canonical.import_source || '') === 'kavita', `Expected kavita import source, got ${JSON.stringify(canonical)}`);
    assert(String(canonical.provider_name || '') === 'kavita', `Expected provider_name=kavita, got ${JSON.stringify(canonical)}`);
    assert(String(canonical.provider_item_id || '') === PROVIDER_ITEM_ID, `Expected provider item id ${PROVIDER_ITEM_ID}, got ${JSON.stringify(canonical)}`);
    assert(String(canonical.author || '') === 'Existing Import Author', `Expected Kavita title reuse to preserve existing non-Kavita author metadata, got ${JSON.stringify(canonical)}`);

    console.log(JSON.stringify({
      provider: 'kavita',
      rows: firstImport.data?.rows,
      firstCreated: firstSummary.created,
      firstUpdated: firstSummary.updated,
      secondCreated: secondSummary.created,
      secondUpdated: secondSummary.updated,
      canonicalRows: canonical.count,
      reusedExistingNonKavitaTitle: true,
      secretReturned: false
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
