'use strict';

const http = require('http');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
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

async function seedScopedCwaIntegration({ spaceId, opdsUrl, username = '', password = '' }) {
  await pool.query(
    `INSERT INTO app_integrations (
       space_id,
       cwa_opds_url,
       cwa_base_url,
       cwa_username,
       cwa_password_encrypted,
       cwa_timeout_ms
     ) VALUES (
       $1, $2, $3, $4, $5, 5000
     )`,
    [
      spaceId,
      opdsUrl,
      opdsUrl.replace(/\/opds(?:\/.*)?$/i, ''),
      username,
      password ? encryptSecret(password) : null
    ]
  );
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

async function startFakeOpdsServer({ entryId, title, author, isbn }) {
  const browsePath = `/books/${encodeURIComponent(entryId)}`;
  const downloadPath = `/download/${encodeURIComponent(entryId)}.epub`;
  const feedXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    '  <id>urn:uuid:collectz-opds-feed</id>',
    '  <title>collectZ OPDS Link Contract Feed</title>',
    '  <updated>2026-04-21T00:00:00Z</updated>',
    '  <entry>',
    `    <id>${entryId}</id>`,
    `    <title>${title}</title>`,
    '    <author>',
    `      <name>${author}</name>`,
    '    </author>',
    `    <identifier>${isbn}</identifier>`,
    '    <published>2021-09-15</published>',
    '    <summary>Link contract smoke entry</summary>',
    '    <publisher>collectZ Press</publisher>',
    `    <link rel="alternate" type="text/html" href="${browsePath}" />`,
    `    <link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="${downloadPath}" />`,
    '  </entry>',
    '</feed>'
  ].join('\n');

  const server = http.createServer((req, res) => {
    if (req.url && req.url.startsWith('/opds/books')) {
      res.writeHead(200, { 'Content-Type': 'application/atom+xml; charset=utf-8' });
      res.end(feedXml);
      return;
    }
    if (req.url === browsePath) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body>browse</body></html>');
      return;
    }
    if (req.url === downloadPath) {
      res.writeHead(200, { 'Content-Type': 'application/epub+zip' });
      res.end('epub');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to start fake OPDS server');

  return {
    server,
    opdsUrl: `http://127.0.0.1:${address.port}/opds/books`,
    browseUrl: `http://127.0.0.1:${address.port}${browsePath}`,
    downloadUrl: `http://127.0.0.1:${address.port}${downloadPath}`
  };
}

async function fetchScopeContext(client) {
  const scope = await client.request('/api/auth/scope', { expectStatus: 200 });
  const libraryId = Number(scope?.data?.active_library_id || 0) || null;
  let spaceId = Number(scope?.data?.active_space_id || 0) || null;
  if (!spaceId && libraryId) {
    const libraryRow = await pool.query('SELECT space_id FROM libraries WHERE id = $1', [libraryId]);
    spaceId = Number(libraryRow.rows[0]?.space_id || 0) || null;
  }
  assert(libraryId && spaceId, `Scope bootstrap failed: ${JSON.stringify(scope?.data)}`);
  return { libraryId, spaceId };
}

async function main() {
  const suffix = Date.now();
  const email = `cwa-opds-link-contract-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('cwa-opds-link-contract-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;
  let fakeOpds = null;

  const entryId = 'urn:uuid:cwa-opds-link-contract-entry';
  const title = 'CWA OPDS Link Contract Smoke Book';
  const author = 'Link Contract Smoke Author';
  const isbn = '9781476735402';

  try {
    fakeOpds = await startFakeOpdsServer({ entryId, title, author, isbn });

    userId = await createDirectUser({
      email,
      password,
      name: 'CWA OPDS Link Contract Smoke Admin',
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

    ({ libraryId, spaceId } = await fetchScopeContext(client));
    await seedScopedCwaIntegration({ spaceId, opdsUrl: fakeOpds.opdsUrl });

    const importResponse = await client.request('/api/media/import-cwa?sync=1', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ maxPages: 3 }),
      headers: {
        'Content-Type': 'application/json',
        'x-valuation-refresh-mode': 'fixture'
      }
    });

    const summary = importResponse?.data?.summary || {};
    assert(Number(summary.created || 0) === 1, `Expected first CWA import to create one row, got ${JSON.stringify(summary)}`);

    const imported = await pool.query(
      `SELECT id, tmdb_url, import_source, type_details
         FROM media
        WHERE library_id = $1
          AND media_type = 'book'
          AND COALESCE(type_details->>'provider_item_id', '') = $2
        LIMIT 1`,
      [libraryId, isbn]
    );
    assert(imported.rows[0], `Expected imported OPDS row for ${isbn}`);
    const row = imported.rows[0];
    assert(row.tmdb_url === null, `Expected OPDS import to leave tmdb_url null, got ${JSON.stringify(row)}`);
    assert(String(row.type_details?.provider_external_url || '') === fakeOpds.browseUrl, `Expected provider_external_url to keep browse/detail URL, got ${JSON.stringify(row)}`);
    assert(String(row.type_details?.provider_download_url || '') === fakeOpds.downloadUrl, `Expected provider_download_url to keep acquisition URL, got ${JSON.stringify(row)}`);
    assert(String(row.type_details?.calibre_external_url || '') === fakeOpds.browseUrl, `Expected calibre_external_url to keep browse/detail URL, got ${JSON.stringify(row)}`);
    assert(String(row.type_details?.calibre_download_url || '') === fakeOpds.downloadUrl, `Expected calibre_download_url to keep acquisition URL, got ${JSON.stringify(row)}`);

    console.log(JSON.stringify({
      created: Number(summary.created || 0),
      canonicalImportSource: row.import_source || null,
      browseUrl: row.type_details?.provider_external_url || null,
      downloadUrl: row.type_details?.provider_download_url || null,
      tmdbUrl: row.tmdb_url,
      stableIdentity: 'provider_item_id/calibre_entry_id'
    }, null, 2));
  } finally {
    if (fakeOpds?.server) {
      await new Promise((resolve) => fakeOpds.server.close(resolve));
    }
    await cleanupTemporaryState({ userId, libraryId, spaceId });
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
