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

async function startFakeOpdsServer({ entryId, author }) {
  const browsePath = `/comics/${encodeURIComponent(entryId)}`;
  const downloadPath = `/download/${encodeURIComponent(entryId)}.cbz`;
  const state = {
    title: 'Galaxy Rangers v2 007',
    summary: 'First comic-heavy OPDS sync'
  };

  const buildFeedXml = () => [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    '  <id>urn:uuid:collectz-opds-comic-feed</id>',
    '  <title>collectZ OPDS Comic Feed</title>',
    '  <updated>2026-04-21T00:00:00Z</updated>',
    '  <entry>',
    `    <id>${entryId}</id>`,
    `    <title>${state.title}</title>`,
    '    <author>',
    `      <name>${author}</name>`,
    '    </author>',
    `    <identifier>${entryId}</identifier>`,
    '    <published>2024-05-01</published>',
    `    <summary>${state.summary}</summary>`,
    '    <publisher>collectZ Comics</publisher>',
    '    <category term="Comics" label="Comics" />',
    `    <link rel="alternate" type="text/html" href="${browsePath}" />`,
    `    <link rel="http://opds-spec.org/acquisition" type="application/x-cbz" href="${downloadPath}" />`,
    '  </entry>',
    '</feed>'
  ].join('\n');

  const server = http.createServer((req, res) => {
    if (req.url && req.url.startsWith('/opds/comics')) {
      res.writeHead(200, { 'Content-Type': 'application/atom+xml; charset=utf-8' });
      res.end(buildFeedXml());
      return;
    }
    if (req.url === browsePath) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body>comic browse</body></html>');
      return;
    }
    if (req.url === downloadPath) {
      res.writeHead(200, { 'Content-Type': 'application/x-cbz' });
      res.end('cbz');
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
    opdsUrl: `http://127.0.0.1:${address.port}/opds/comics`,
    setSecondPass() {
      state.title = 'Galaxy Rangers v2 007: Variant Cover';
      state.summary = 'Second comic-heavy OPDS sync';
    }
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
  const email = `cwa-opds-comic-identity-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('cwa-opds-comic-identity-reuse-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;
  let fakeOpds = null;

  const entryId = 'urn:uuid:cwa-opds-comic-identity-entry';
  const author = 'Comic Sync Smoke Author';

  try {
    fakeOpds = await startFakeOpdsServer({ entryId, author });

    userId = await createDirectUser({
      email,
      password,
      name: 'CWA OPDS Comic Identity Smoke Admin',
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

    await seedScopedCwaIntegration({
      spaceId,
      opdsUrl: fakeOpds.opdsUrl
    });

    const firstImport = await client.request('/api/media/import-cwa?sync=1', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ maxPages: 3 }),
      headers: {
        'Content-Type': 'application/json',
        'x-valuation-refresh-mode': 'fixture'
      }
    });

    fakeOpds.setSecondPass();

    const secondImport = await client.request('/api/media/import-cwa?sync=1', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ maxPages: 3 }),
      headers: {
        'Content-Type': 'application/json',
        'x-valuation-refresh-mode': 'fixture'
      }
    });

    const firstSummary = firstImport?.data?.summary || {};
    const secondSummary = secondImport?.data?.summary || {};
    assert(Number(firstSummary.created || 0) === 1, `Expected first CWA comic import to create one row, got ${JSON.stringify(firstSummary)}`);
    assert(Number(secondSummary.created || 0) === 0, `Expected second CWA comic import to avoid duplicate creation, got ${JSON.stringify(secondSummary)}`);
    assert(Number(secondSummary.updated || 0) === 1, `Expected second CWA comic import to reuse the canonical comic row, got ${JSON.stringify(secondSummary)}`);

    const importedRows = await pool.query(
      `SELECT id, title, media_type, import_source, type_details
         FROM media
        WHERE library_id = $1
          AND COALESCE(type_details->>'provider_item_id', '') = $2
        ORDER BY id ASC`,
      [libraryId, entryId]
    );
    if (importedRows.rows.length !== 1) {
      const debugRows = await pool.query(
        `SELECT id, title, media_type, import_source, library_id, type_details
           FROM media
          WHERE library_id = $1
          ORDER BY id ASC`,
        [libraryId]
      );
      throw new Error(`Expected one imported OPDS comic canonical row, found ${importedRows.rows.length}. First summary: ${JSON.stringify(firstSummary)}. Second summary: ${JSON.stringify(secondSummary)}. Library rows: ${JSON.stringify(debugRows.rows)}`);
    }

    const canonical = importedRows.rows[0];
    assert(String(canonical.media_type || '') === 'comic_book', `Expected OPDS comic import to classify as comic_book, got ${JSON.stringify(canonical)}`);
    assert(String(canonical.import_source || '') === 'cwa_opds', `Expected cwa_opds import source, got ${JSON.stringify(canonical)}`);
    assert(String(canonical.type_details?.provider_name || '') === 'cwa_opds', `Expected provider_name=cwa_opds, got ${JSON.stringify(canonical)}`);
    assert(String(canonical.type_details?.calibre_entry_id || '') === entryId, `Expected calibre_entry_id to persist OPDS identity, got ${JSON.stringify(canonical)}`);
    assert(String(canonical.type_details?.series || '') === 'Galaxy Rangers', `Expected comic series metadata to persist, got ${JSON.stringify(canonical)}`);
    assert(String(canonical.type_details?.volume || '') === '2', `Expected comic volume metadata to persist, got ${JSON.stringify(canonical)}`);
    assert(String(canonical.type_details?.issue_number || '') === '007', `Expected comic issue metadata to persist, got ${JSON.stringify(canonical)}`);
    assert(String(canonical.title || '') === 'Galaxy Rangers v2 007', `Expected repeated comic sync to keep one canonical comic row instead of forking a title-variant duplicate, got ${JSON.stringify(canonical)}`);

    const scopedComicCount = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM media
        WHERE library_id = $1
          AND media_type = 'comic_book'
          AND COALESCE(type_details->>'series', '') = 'Galaxy Rangers'
          AND COALESCE(type_details->>'issue_number', '') = '007'`,
      [libraryId]
    );

    console.log(JSON.stringify({
      firstCreated: Number(firstSummary.created || 0),
      secondCreated: Number(secondSummary.created || 0),
      secondUpdated: Number(secondSummary.updated || 0),
      matchedBy: 'provider_item_id/calibre_entry_id',
      mediaType: canonical.media_type || null,
      parsedSeries: canonical.type_details?.series || null,
      parsedVolume: canonical.type_details?.volume || null,
      parsedIssueNumber: canonical.type_details?.issue_number || null,
      canonicalId: Number(canonical.id || 0),
      canonicalImportSource: canonical.import_source || null,
      scopedComicCount: Number(scopedComicCount.rows[0]?.count || 0)
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
