'use strict';

const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { encryptSecret } = require('../services/crypto');
const { ensureUserDefaultScope } = require('../services/libraries');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const OVERVIEW_MAX_LENGTH = 10000;

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
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
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

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body
    });
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

function buildOversizedOverview() {
  return `Alpha Flight oversized overview ${'x'.repeat(OVERVIEW_MAX_LENGTH + 750)}`;
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

async function seedScopedMetronIntegration({ spaceId, apiUrl, token, username = '' }) {
  await pool.query(
    `INSERT INTO app_integrations (
       space_id,
       comics_preset,
       comics_provider,
       comics_api_url,
       comics_api_key_encrypted,
       comics_api_key_header,
       comics_api_key_query_param,
       comics_username
     ) VALUES (
       $1, 'metron', 'metron', $2, $3, '', '', $4
     )
     ON CONFLICT (space_id) DO UPDATE SET
       comics_preset = EXCLUDED.comics_preset,
       comics_provider = EXCLUDED.comics_provider,
       comics_api_url = EXCLUDED.comics_api_url,
       comics_api_key_encrypted = EXCLUDED.comics_api_key_encrypted,
       comics_api_key_header = EXCLUDED.comics_api_key_header,
       comics_api_key_query_param = EXCLUDED.comics_api_key_query_param,
       comics_username = EXCLUDED.comics_username`,
    [spaceId, apiUrl, encryptSecret(token), username]
  );
}

async function createComicRow({ title, libraryId, spaceId, userId }) {
  const result = await pool.query(
    `INSERT INTO media (
       title, media_type, format, type_details, library_id, space_id, added_by, import_source
     ) VALUES (
       $1, 'comic_book', 'Digital', $2::jsonb, $3, $4, $5, 'manual'
     ) RETURNING id`,
    [
      title,
      JSON.stringify({
        series: 'Alpha Flight',
        issue_number: '1',
        volume: '1',
        provider_name: 'manual'
      }),
      libraryId,
      spaceId,
      userId
    ]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

async function cleanupTemporaryState({ userId, libraryId, spaceId }) {
  if (libraryId) {
    await pool.query('DELETE FROM media_metadata WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM collection_items WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
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

function decodeBasicAuth(headerValue) {
  const raw = String(headerValue || '').trim();
  if (!raw.toLowerCase().startsWith('basic ')) return null;
  try {
    const decoded = Buffer.from(raw.slice(6), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) return null;
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch {
    return null;
  }
}

async function startFakeMetronServer() {
  const token = crypto.randomBytes(16).toString('hex');
  const username = 'metron-overview-smoke';
  const issueId = 'alpha-flight-1';
  const oversizedOverview = buildOversizedOverview();
  const searchPayload = [
    {
      id: issueId,
      series: { name: 'Alpha Flight', volume: '1' },
      number: '1',
      name: 'Tundra!',
      cover_date: '1983-08-01',
      desc: oversizedOverview,
      publisher: { name: 'Marvel' },
      image: 'https://example.invalid/alpha-flight-1.jpg'
    }
  ];

  const server = http.createServer((req, res) => {
    const auth = decodeBasicAuth(req.headers.authorization);
    if (!auth || auth.password !== token || auth.username !== username) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Unauthorized' }));
      return;
    }
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/issue/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(searchPayload));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Not found' }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  return {
    server,
    apiUrl: `http://127.0.0.1:${address.port}/api/issue/`,
    token,
    username,
    issueId,
    oversizedOverview
  };
}

async function main() {
  const suffix = Date.now();
  const email = `metron-overview-smoke-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('metron-overview-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;
  let comicId = null;
  let fakeMetron = null;

  try {
    fakeMetron = await startFakeMetronServer();
    userId = await createDirectUser({ email, password, name: 'Metron Overview Smoke Admin', role: 'admin' });

    await client.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ email, password }),
      headers: { 'Content-Type': 'application/json' }
    });
    await client.fetchCsrfToken();

    const scope = await ensureUserDefaultScope(userId);
    libraryId = Number(scope?.libraryId || 0) || null;
    spaceId = Number(scope?.spaceId || 0) || null;
    assert(libraryId && spaceId, 'Expected default scope for Metron overview smoke');

    await seedScopedMetronIntegration({
      spaceId,
      apiUrl: fakeMetron.apiUrl,
      token: fakeMetron.token,
      username: fakeMetron.username
    });

    comicId = await createComicRow({
      title: 'Alpha Flight #1 - Tundra!',
      libraryId,
      spaceId,
      userId
    });
    assert(comicId, 'Expected seeded comic row');

    const searchResponse = await client.request('/api/media/enrich/comic/search', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ title: 'Alpha Flight' }),
      headers: { 'Content-Type': 'application/json' }
    });

    const match = Array.isArray(searchResponse?.data?.matches) ? searchResponse.data.matches[0] : null;
    assert(match, 'Expected one Metron match from search');
    assert(String(match.title || '').includes('Alpha Flight #1'), 'Expected Metron match title to describe Alpha Flight #1');
    assert(String(match.overview || '').length > OVERVIEW_MAX_LENGTH, 'Expected fake Metron search result to exceed overview validation cap');

    const patchPayload = {
      media_type: 'comic_book',
      title: match.title,
      year: match.year,
      release_date: match.release_date,
      poster_path: match.poster_path,
      overview: match.overview,
      type_details: {
        author: match.type_details?.author || null,
        publisher: match.type_details?.publisher || null,
        edition: match.type_details?.edition || null,
        series: match.type_details?.series || null,
        issue_number: match.type_details?.issue_number || null,
        volume: match.type_details?.volume || null,
        writer: match.type_details?.writer || null,
        artist: match.type_details?.artist || null,
        inker: match.type_details?.inker || null,
        colorist: match.type_details?.colorist || null,
        cover_date: match.type_details?.cover_date || null,
        provider_issue_id: match.type_details?.provider_issue_id || null,
        barcode_addon: null,
        isbn: match.type_details?.isbn || null
      }
    };

    const saveResponse = await client.request(`/api/media/${comicId}`, {
      method: 'PATCH',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify(patchPayload),
      headers: { 'Content-Type': 'application/json' }
    });

    const saved = saveResponse.data;
    const savedOverview = String(saved?.overview || '');
    assert(savedOverview.length === OVERVIEW_MAX_LENGTH, `Expected saved overview to clamp to 10000, got ${savedOverview.length}`);
    assert(savedOverview === fakeMetron.oversizedOverview.slice(0, OVERVIEW_MAX_LENGTH), 'Expected saved overview to equal the deterministic truncated Metron description');
    assert(String(saved?.type_details?.provider_issue_id || '') === fakeMetron.issueId, 'Expected saved comic to preserve Metron provider issue id');

    console.log(JSON.stringify({
      searchOverviewLength: String(match?.overview || '').length,
      savedOverviewLength: savedOverview.length,
      savedTitle: saved?.title || null,
      savedProviderIssueId: saved?.type_details?.provider_issue_id || null,
      truncated: savedOverview.length === OVERVIEW_MAX_LENGTH
    }, null, 2));
  } finally {
    await cleanupTemporaryState({ userId, libraryId, spaceId });
    if (fakeMetron?.server) {
      await new Promise((resolve) => fakeMetron.server.close(resolve)).catch(() => {});
    }
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
