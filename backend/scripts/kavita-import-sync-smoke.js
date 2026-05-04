'use strict';

const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const KAVITA_SMOKE_KEY = `kavita-import-smoke-${crypto.randomBytes(8).toString('hex')}`;
const KAVITA_SMOKE_BEARER = `kavita-import-bearer-${crypto.randomBytes(8).toString('hex')}`;
const BOOK_PROVIDER_ITEM_ID = 'kavita:series:8601';
const COMIC_PROVIDER_ITEM_ID = 'kavita:series:8602';

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
        { id: 86, name: 'Kavita Smoke Books', type: 2, lastScanned: '2026-05-03T00:00:00Z' },
        { id: 87, name: 'Kavita Smoke Sequential Shelf', type: 1, lastScanned: '2026-05-03T00:00:00Z' }
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
          originalName: 'Kavita Import Sync Smoke Novel Original',
          created: '2026-05-03T00:00:00Z',
          lastChapterAdded: '2026-05-03T00:00:00Z',
          releaseDate: '2024-04-05T00:00:00Z',
          pages: 321,
          format: 3,
          coverImage: '/api/image/series-cover?seriesId=8601'
        },
        {
          id: 8602,
          libraryId: 87,
          libraryName: 'Kavita Smoke Sequential Shelf',
          name: 'Kavita Metadata Smoke Issue',
          localizedName: 'Kavita Metadata Smoke Issue',
          sortName: 'Kavita Metadata Smoke Issue 001',
          originalName: 'Kavita Metadata Smoke Issue Original',
          created: '2026-05-03T00:00:00Z',
          lastChapterAdded: '2026-05-03T00:00:00Z',
          releaseDate: '2023-03-04T00:00:00Z',
          pages: 24,
          format: 1,
          coverImage: '/api/image/series-cover?seriesId=8602'
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

async function readImportedProviderRow(libraryId, providerItemId) {
  const result = await pool.query(
    `SELECT id,
            title,
            media_type,
            year,
            release_date,
            import_source,
            type_details
     FROM media
     WHERE library_id = $1
       AND type_details->>'provider_item_id' = $2`,
    [libraryId, providerItemId]
  );
  return result.rows || [];
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
      `INSERT INTO media (title, media_type, year, release_date, format, owned_formats, type_details, library_id, space_id, added_by, import_source)
       VALUES ($1, 'book', 2024, '2024-04-05', 'Paperback', ARRAY['paperback']::text[], $2::jsonb, $3, $4, $5, 'csv_generic')`,
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
    assert(Number(firstSummary.created || 0) === 1, `Expected first Kavita import to create one new comic row while reusing the existing non-Kavita book title, got ${JSON.stringify(firstSummary)}`);
    assert(Number(firstSummary.updated || 0) === 1, `Expected first Kavita import to update the existing non-Kavita title, got ${JSON.stringify(firstSummary)}`);
    assert(Number(secondSummary.created || 0) === 0, `Expected second Kavita import to avoid duplicate creation, got ${JSON.stringify(secondSummary)}`);
    assert(Number(secondSummary.updated || 0) === 2, `Expected second Kavita import to update/no-op both canonical rows, got ${JSON.stringify(secondSummary)}`);
    assert(Number(firstSummary.libraryCount || 0) === 2, `Expected Kavita import summary to include both libraries, got ${JSON.stringify(firstSummary)}`);

    const bookRows = await readImportedProviderRow(libraryId, BOOK_PROVIDER_ITEM_ID);
    const comicRows = await readImportedProviderRow(libraryId, COMIC_PROVIDER_ITEM_ID);
    assert(bookRows.length === 1, `Expected exactly one canonical Kavita book row, got ${JSON.stringify(bookRows)}`);
    assert(comicRows.length === 1, `Expected exactly one canonical Kavita comic row, got ${JSON.stringify(comicRows)}`);

    const canonicalBook = bookRows[0] || {};
    const canonicalBookDetails = canonicalBook.type_details || {};
    assert(String(canonicalBook.import_source || '') === 'kavita', `Expected kavita import source, got ${JSON.stringify(canonicalBook)}`);
    assert(String(canonicalBook.media_type || '') === 'book', `Expected Kavita library type 2 to classify as book, got ${JSON.stringify(canonicalBook)}`);
    assert(String(canonicalBookDetails.provider_name || '') === 'kavita', `Expected provider_name=kavita, got ${JSON.stringify(canonicalBook)}`);
    assert(String(canonicalBookDetails.provider_item_id || '') === BOOK_PROVIDER_ITEM_ID, `Expected provider item id ${BOOK_PROVIDER_ITEM_ID}, got ${JSON.stringify(canonicalBook)}`);
    assert(String(canonicalBookDetails.author || '') === 'Existing Import Author', `Expected Kavita title reuse to preserve existing non-Kavita author metadata, got ${JSON.stringify(canonicalBook)}`);
    assert(String(canonicalBookDetails.kavita_library_id || '') === '86', `Expected Kavita library id metadata, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_library_name || '') === 'Kavita Smoke Books', `Expected Kavita library name metadata, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_library_type || '') === 'book', `Expected Kavita library type metadata, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_series_id || '') === '8601', `Expected Kavita series id metadata, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_original_name || '') === 'Kavita Import Sync Smoke Novel Original', `Expected Kavita original name metadata, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_sort_name || '') === 'Kavita Import Sync Smoke Novel', `Expected Kavita sort name metadata, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_format || '') === '3', `Expected Kavita format metadata, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_pages || '') === '321', `Expected Kavita page metadata, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_cover_image || '') === '/api/image/series-cover?seriesId=8601', `Expected Kavita cover image metadata, got ${JSON.stringify(canonicalBookDetails)}`);

    const canonicalComic = comicRows[0] || {};
    const canonicalComicDetails = canonicalComic.type_details || {};
    assert(String(canonicalComic.media_type || '') === 'comic_book', `Expected Kavita library type 1 to classify as comic_book, got ${JSON.stringify(canonicalComic)}`);
    assert(String(canonicalComicDetails.provider_item_id || '') === COMIC_PROVIDER_ITEM_ID, `Expected provider item id ${COMIC_PROVIDER_ITEM_ID}, got ${JSON.stringify(canonicalComic)}`);
    assert(String(canonicalComicDetails.kavita_library_id || '') === '87', `Expected Kavita comic library id metadata, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(String(canonicalComicDetails.kavita_library_type || '') === 'comic', `Expected Kavita numeric comic library type metadata, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(String(canonicalComicDetails.kavita_pages || '') === '24', `Expected Kavita comic page metadata, got ${JSON.stringify(canonicalComicDetails)}`);

    console.log(JSON.stringify({
      provider: 'kavita',
      rows: firstImport.data?.rows,
      firstCreated: firstSummary.created,
      firstUpdated: firstSummary.updated,
      secondCreated: secondSummary.created,
      secondUpdated: secondSummary.updated,
      canonicalBookRows: bookRows.length,
      canonicalComicRows: comicRows.length,
      reusedExistingNonKavitaTitle: true,
      comicClassifiedFromLibraryType: canonicalComic.media_type === 'comic_book',
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
