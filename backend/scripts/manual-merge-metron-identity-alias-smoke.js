'use strict';

const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { buildMediaIdentityAliasKey } = require('../services/mediaIdentityAliases');
const { encryptSecret } = require('../services/crypto');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

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

async function cleanupTemporaryState({ userId, libraryId, spaceId }) {
  if (libraryId) {
    await pool.query('DELETE FROM media_merge_recommendation_feedback WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_repair_history WHERE canonical_media_id IN (SELECT id FROM media WHERE library_id = $1) OR duplicate_media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_metadata WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_variants WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_seasons WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
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
  const issueId = 'duplicate-issue-001';
  const token = crypto.randomBytes(16).toString('hex');
  const username = 'metron-smoke';
  const collectionPayload = [
    {
      id: issueId,
      series: { name: 'Alias Smoke Series', volume: '9' },
      number: '11',
      name: 'Alias Reimported',
      cover_date: '2024-03-01',
      desc: 'Metron alias smoke issue summary',
      publisher: { name: 'Marvel' },
      image: 'https://example.invalid/metron-alias-smoke.jpg'
    }
  ];
  const detailPayload = {
    id: issueId,
    series: { name: 'Alias Smoke Series', volume: '9' },
    number: '11',
    name: 'Alias Reimported',
    cover_date: '2024-03-01',
    desc: 'Metron alias smoke issue summary',
    publisher: { name: 'Marvel' },
    image: 'https://example.invalid/metron-alias-smoke.jpg',
    credits: [
      { role: 'writer', creator: { name: 'Smoke Writer' } },
      { role: 'artist', creator: { name: 'Smoke Artist' } }
    ],
    isbn: null,
    upc: '111111111111'
  };

  const server = http.createServer((req, res) => {
    const auth = decodeBasicAuth(req.headers.authorization);
    if (!auth || auth.password !== token || auth.username !== username) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Unauthorized' }));
      return;
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/api/collection/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(collectionPayload));
      return;
    }

    if (req.method === 'GET' && url.pathname === `/api/issue/${issueId}/`) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(detailPayload));
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
    issueId,
    token,
    username
  };
}

async function main() {
  const suffix = Date.now();
  const email = `manual-merge-metron-alias-${suffix}@example.com`;
  const password = `Passw0rd!${crypto.randomBytes(6).toString('hex')}`;
  const client = new HttpClient('manual-merge-metron-identity-alias-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;
  let fakeMetron = null;

  try {
    fakeMetron = await startFakeMetronServer();
    userId = await createDirectUser({
      email,
      password,
      name: 'Manual Merge Metron Identity Alias Smoke Admin',
      role: 'admin'
    });

    await client.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ email, password }),
      headers: { 'Content-Type': 'application/json' }
    });
    await client.fetchCsrfToken();

    const scope = await client.request('/api/auth/scope', { expectStatus: 200 });
    libraryId = Number(scope?.data?.active_library_id || 0) || null;
    spaceId = Number(scope?.data?.active_space_id || 0) || null;
    if (!spaceId && libraryId) {
      const scopedLibrary = Array.isArray(scope?.data?.libraries)
        ? scope.data.libraries.find((entry) => Number(entry?.id || 0) === libraryId) || null
        : null;
      spaceId = Number(scopedLibrary?.space_id || 0) || null;
    }
    if (!spaceId && libraryId) {
      const libraryRow = await pool.query('SELECT space_id FROM libraries WHERE id = $1', [libraryId]);
      spaceId = Number(libraryRow.rows[0]?.space_id || 0) || null;
    }
    assert(libraryId && spaceId, `Scope bootstrap failed: ${JSON.stringify(scope?.data)}`);

    await seedScopedMetronIntegration({
      spaceId,
      apiUrl: fakeMetron.apiUrl,
      token: fakeMetron.token,
      username: fakeMetron.username
    });

    const canonicalInsert = await pool.query(
      `INSERT INTO media (
         title, media_type, format, year, type_details, library_id, space_id, added_by, import_source
       ) VALUES (
         $1, 'comic_book', 'Digital', 2024, $2::jsonb, $3, $4, $5, 'manual_seed'
       )
       RETURNING id`,
      [
        'Metron Alias Canonical Issue',
        JSON.stringify({
          provider_name: 'metron',
          provider_issue_id: 'canonical-issue-001',
          series: 'Alias Smoke Series',
          issue_number: '11',
          volume: '9',
          publisher: 'Marvel',
          cover_date: '2024-01-01'
        }),
        libraryId,
        spaceId,
        userId
      ]
    );
    const canonicalId = Number(canonicalInsert.rows[0]?.id || 0) || null;

    const duplicateInsert = await pool.query(
      `INSERT INTO media (
         title, media_type, format, year, type_details, library_id, space_id, added_by, import_source
       ) VALUES (
         $1, 'comic_book', 'Digital', 2024, $2::jsonb, $3, $4, $5, 'manual_seed'
       )
       RETURNING id`,
      [
        'Metron Alias Duplicate Issue',
        JSON.stringify({
          provider_name: 'metron',
          provider_issue_id: fakeMetron.issueId,
          series: 'Alias Smoke Series',
          issue_number: '11',
          volume: '9',
          publisher: 'Marvel',
          cover_date: '2024-03-01'
        }),
        libraryId,
        spaceId,
        userId
      ]
    );
    const duplicateId = Number(duplicateInsert.rows[0]?.id || 0) || null;
    assert(canonicalId && duplicateId, 'Expected seeded canonical and duplicate comic ids');

    const preview = await client.request('/api/media/merge-preview', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({
        canonical_id: canonicalId,
        duplicate_id: duplicateId
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(preview?.data?.allowed === true, 'Expected manual merge preview to allow Metron alias smoke pair');

    const applyResponse = await client.request('/api/media/merge-apply', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({
        canonical_id: canonicalId,
        duplicate_id: duplicateId
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(applyResponse?.data?.applied === true, 'Expected manual merge apply to succeed');

    const aliasKey = buildMediaIdentityAliasKey('providerIssueId', fakeMetron.issueId);
    const aliasRows = await pool.query(
      `SELECT "key", "value"
       FROM media_metadata
       WHERE media_id = $1
         AND "key" = $2`,
      [canonicalId, aliasKey]
    );
    assert(aliasRows.rows.length === 1, 'Expected canonical row to retain duplicate Metron identity alias');

    const preImportCanonical = await pool.query(
      `SELECT import_source, type_details
       FROM media
       WHERE id = $1`,
      [canonicalId]
    );
    assert(String(preImportCanonical.rows[0]?.type_details?.provider_issue_id || '') === 'canonical-issue-001', 'Expected canonical row to retain its original provider_issue_id before re-sync');

    const importResponse = await client.request('/api/media/import-comics?sync=1', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' }
    });

    const summary = importResponse?.data?.summary || {};
    assert(Number(summary.created || 0) === 0, `Expected no created rows after alias-preserved Metron reimport, got ${JSON.stringify(summary)}`);
    assert(Number(summary.updated || 0) === 1, `Expected one updated row after alias-preserved Metron reimport, got ${JSON.stringify(summary)}`);

    const mediaCount = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM media
       WHERE library_id = $1
         AND media_type = 'comic_book'`,
      [libraryId]
    );
    const canonicalRow = await pool.query(
      `SELECT import_source, type_details, upc
       FROM media
       WHERE id = $1`,
      [canonicalId]
    );
    const metronMetadataRows = await pool.query(
      `SELECT "key", "value"
       FROM media_metadata
       WHERE media_id = $1
         AND "key" = 'metron_issue_id'`,
      [canonicalId]
    );
    const count = Number(mediaCount.rows[0]?.count || 0);
    assert(count === 1, `Expected one comic row after alias-preserved Metron reimport, found ${count}`);
    assert(String(canonicalRow.rows[0]?.import_source || '') === 'metron', 'Expected canonical row import_source to update to metron');
    assert(String(canonicalRow.rows[0]?.type_details?.provider_issue_id || '') === fakeMetron.issueId, 'Expected canonical row provider_issue_id to update from Metron re-sync');
    assert(String(canonicalRow.rows[0]?.type_details?.cover_date || '') === '2024-03-01', 'Expected canonical row cover_date to update from Metron detail fetch');
    assert(String(canonicalRow.rows[0]?.upc || '') === '111111111111', 'Expected canonical row UPC to update from Metron detail fetch');
    assert(metronMetadataRows.rows.length === 1, 'Expected canonical row to store metron_issue_id metadata after alias-preserved sync');

    console.log(JSON.stringify({
      applied: Boolean(applyResponse?.data?.applied),
      aliasStored: aliasRows.rows.length === 1,
      created: Number(summary.created || 0),
      updated: Number(summary.updated || 0),
      imported: Number(importResponse?.data?.imported || 0),
      collectionEndpoint: importResponse?.data?.collectionEndpoint || null,
      canonicalImportSource: canonicalRow.rows[0]?.import_source || null,
      canonicalProviderIssueId: canonicalRow.rows[0]?.type_details?.provider_issue_id || null,
      scopedComicCount: count
    }, null, 2));
  } finally {
    if (fakeMetron?.server) {
      await new Promise((resolve) => fakeMetron.server.close(resolve)).catch(() => {});
    }
    await cleanupTemporaryState({ userId, libraryId, spaceId });
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
