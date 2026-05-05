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
const COMIC_CHAPTER_ONE_PROVIDER_ITEM_ID = 'kavita:chapter:9702';
const COMIC_CHAPTER_TWO_PROVIDER_ITEM_ID = 'kavita:chapter:9703';
const BOOK_CHAPTER_PROVIDER_ITEM_ID = 'kavita:chapter:9701';
const SPECIAL_CHAPTER_PROVIDER_ITEM_ID = 'kavita:chapter:9799';

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

  async requestRaw(path, options = {}) {
    const {
      method = 'GET',
      expectStatus,
      headers: extraHeaders = {}
    } = options;
    const headers = { Accept: '*/*', ...extraHeaders };
    const cookieHeader = this.cookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;
    const response = await fetch(`${BASE_URL}${path}`, { method, headers });
    this.applySetCookies(response.headers);
    const body = Buffer.from(await response.arrayBuffer());
    if (expectStatus !== undefined && response.status !== expectStatus) {
      throw new Error(`[${this.name}] ${method} ${path} expected ${expectStatus}, got ${response.status}. Body length: ${body.length}`);
    }
    return { status: response.status, headers: response.headers, body };
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
  const seriesWritebacks = [];
  const chapterWritebacks = [];
  const progressReads = [];
  const readJsonBody = (req) => new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
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

    if (req.method === 'GET' && url.pathname === '/api/image/series-cover') {
      const seriesId = Number(url.searchParams.get('seriesId') || 0);
      if (seriesId === 8601 || seriesId === 8602) {
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': String(png.length)
        });
        res.end(png);
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ message: 'cover not found' }));
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

    if (req.method === 'GET' && url.pathname === '/api/Series/volumes') {
      const seriesId = Number(url.searchParams.get('seriesId') || 0);
      if (seriesId === 8601) {
        res.writeHead(200);
        res.end(JSON.stringify([
          {
            id: 9601,
            seriesId: 8601,
            minNumber: 1,
            maxNumber: 1,
            name: 'Volume 1',
            pages: 321,
            chapters: [
              {
                id: 9701,
                volumeId: 9601,
                range: '1',
                minNumber: 1,
                maxNumber: 1,
                sortOrder: 1,
                title: 'Kavita Import Sync Smoke Novel Chapter 1',
                releaseDate: '2024-04-05T00:00:00Z',
                pages: 321
              }
            ]
          }
        ]));
        return;
      }
      if (seriesId === 8602) {
        res.writeHead(200);
        res.end(JSON.stringify([
          {
            id: 9602,
            seriesId: 8602,
            minNumber: 1,
            maxNumber: 2,
            name: 'Volume 1',
            pages: 51,
            chapters: [
              {
                id: 9702,
                volumeId: 9602,
                range: '1',
                minNumber: 1,
                maxNumber: 1,
                sortOrder: 1,
                title: 'Kavita Metadata Smoke Issue #1',
                releaseDate: '2023-03-04T00:00:00Z',
                pages: 24
              },
              {
                id: 9703,
                volumeId: 9602,
                range: '2',
                minNumber: 2,
                maxNumber: 2,
                sortOrder: 2,
                title: 'Kavita Metadata Smoke Issue #2',
                releaseDate: '2023-04-05T00:00:00Z',
                pages: 26
              },
              {
                id: 9799,
                volumeId: 9602,
                range: 'S',
                sortOrder: 99,
                title: 'Kavita Metadata Smoke Special',
                releaseDate: '2023-05-06T00:00:00Z',
                pages: 1,
                isSpecial: true
              }
            ]
          }
        ]));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify([]));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/Series/metadata') {
      const seriesId = Number(url.searchParams.get('seriesId') || 0);
      if (seriesId === 8602) {
        res.writeHead(200);
        res.end(JSON.stringify({
          seriesId: 8602,
          summary: 'Current Kavita smoke summary',
          releaseYear: 2022,
          tags: ['kavita-current'],
          genres: [],
          writers: [],
          publishers: [],
          language: '',
          webLinks: [],
          writersLocked: true
        }));
        return;
      }
      if (seriesId === 8601) {
        res.writeHead(200);
        res.end(JSON.stringify({
          seriesId: 8601,
          summary: 'Current Kavita book summary',
          releaseYear: 2024,
          tags: [],
          genres: [],
          writers: [],
          publishers: [],
          language: '',
          webLinks: []
        }));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ message: 'series metadata not found' }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/Series/metadata') {
      readJsonBody(req).then((body) => {
        seriesWritebacks.push(body);
        res.writeHead(200);
        res.end(JSON.stringify({ accepted: true }));
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/Chapter/update') {
      readJsonBody(req).then((body) => {
        chapterWritebacks.push(body);
        res.writeHead(200);
        res.end(JSON.stringify({ accepted: true }));
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/Reader/get-progress') {
      const chapterId = Number(url.searchParams.get('chapterId') || 0);
      progressReads.push({ chapterId });
      if (chapterId === 9702) {
        res.writeHead(200);
        res.end(JSON.stringify({
          libraryId: 87,
          seriesId: 8602,
          volumeId: 9602,
          chapterId: 9702,
          pageNum: 11,
          bookScrollId: 'smoke-scroll-11',
          lastModifiedUtc: '2026-05-05T05:00:00Z',
          apiKey: KAVITA_SMOKE_KEY,
          bearerToken: KAVITA_SMOKE_BEARER
        }));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ message: 'progress not found' }));
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
    baseUrl: `http://127.0.0.1:${address.port}`,
    seriesWritebacks,
    chapterWritebacks,
    progressReads
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

async function createDirectSpaceAndLibrary({ userId, suffix }) {
  await pool.query("SELECT setval('spaces_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM spaces), 1), true)");
  await pool.query("SELECT setval('libraries_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM libraries), 1), true)");
  const space = await pool.query(
    `INSERT INTO spaces (name, slug, description, created_by, is_personal)
     VALUES ($1, $2, $3, $4, false)
     RETURNING id`,
    [`Kavita Workspace Smoke ${suffix}`, `kavita-workspace-smoke-${suffix}`, 'Kavita workspace isolation smoke', userId]
  );
  const spaceId = Number(space.rows[0]?.id || 0) || null;
  await pool.query(
    `INSERT INTO space_memberships (space_id, user_id, role, created_by)
     VALUES ($1, $2, 'owner', $2)`,
    [spaceId, userId]
  );
  const library = await pool.query(
    `INSERT INTO libraries (space_id, name, description, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [spaceId, 'Kavita Workspace Smoke Library', 'Kavita workspace isolation smoke', userId]
  );
  const libraryId = Number(library.rows[0]?.id || 0) || null;
  await pool.query(
    `INSERT INTO library_memberships (user_id, library_id, role)
     VALUES ($1, $2, 'owner')`,
    [userId, libraryId]
  );
  return { spaceId, libraryId };
}

async function readImportedProviderRow(libraryId, providerItemId) {
  const result = await pool.query(
    `SELECT id,
            title,
            media_type,
            year,
            release_date,
            import_source,
            poster_path,
            type_details
     FROM media
     WHERE library_id = $1
       AND type_details->>'provider_item_id' = $2`,
    [libraryId, providerItemId]
  );
  return result.rows || [];
}

function dateReadbackStartsWith(value, expectedPrefix) {
  if (!value) return false;
  if (String(value || '').startsWith(expectedPrefix)) return true;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(expectedPrefix);
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
  let secondLibraryId = null;
  let secondSpaceId = null;
  let previousLogExport = null;

  try {
    const logExportResult = await pool.query(
      `SELECT log_export_backend, log_export_host, log_export_port
         FROM app_integrations
        WHERE id = 1
        LIMIT 1`
    ).catch(() => ({ rows: [] }));
    previousLogExport = logExportResult.rows[0] || null;
    await pool.query(
      `UPDATE app_integrations
          SET log_export_backend = 'off',
              log_export_host = NULL,
              log_export_port = NULL
        WHERE id = 1`
    ).catch(() => {});

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

    const firstScope = await createDirectSpaceAndLibrary({ userId, suffix });
    spaceId = firstScope.spaceId;
    libraryId = firstScope.libraryId;
    assert(libraryId && spaceId, `Expected direct smoke scope, got ${JSON.stringify(firstScope)}`);

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
    await pool.query(
      `INSERT INTO media (title, media_type, year, release_date, format, owned_formats, type_details, library_id, space_id, added_by, import_source)
       VALUES ($1, 'comic_book', 2023, '2023-04-05', 'Digital', ARRAY['digital']::text[], $2::jsonb, $3, $4, $5, 'csv_generic')`,
      [
        'Kavita Metadata Smoke Issue #2',
        JSON.stringify({
          series: 'Kavita Metadata Smoke Issue',
          issue_number: '2',
          volume: '1-2',
          writer: 'Existing Comic Writer'
        }),
        libraryId,
        spaceId,
        userId
      ]
    );

    await client.request(`/api/spaces/${spaceId}/integrations`, {
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

    const kavitaSettings = await client.request(`/api/spaces/${spaceId}/integrations`, { expectStatus: 200 });
    assert(kavitaSettings.data?.kavitaBaseUrl === fake.baseUrl, `Expected workspace-owned Kavita URL readback, got ${JSON.stringify(kavitaSettings.data)}`);
    assert(kavitaSettings.data?.kavitaApiKeySet === true, `Expected workspace-owned Kavita key-set readback, got ${JSON.stringify(kavitaSettings.data)}`);
    assert(!Object.prototype.hasOwnProperty.call(kavitaSettings.data || {}, 'kavitaApiKey'), `Workspace Kavita readback must not expose raw API keys, got ${JSON.stringify(kavitaSettings.data)}`);

    const kavitaTest = await client.request(`/api/spaces/${spaceId}/integrations/test-kavita`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(kavitaTest.data?.ok === true, `Expected workspace-owned Kavita test to succeed, got ${JSON.stringify(kavitaTest.data)}`);

    const scopeQuery = `space_id=${spaceId}&library_id=${libraryId}`;
    const firstImport = await client.request(`/api/media/import-kavita?sync=1&pageSize=10&maxPages=2&${scopeQuery}`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' }
    });
    const secondImport = await client.request(`/api/media/import-kavita?sync=1&pageSize=10&maxPages=2&${scopeQuery}`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' }
    });
    const fanoutImport = await client.request(`/api/media/import-kavita?sync=1&pageSize=10&maxPages=2&chapterFanout=1&${scopeQuery}`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' }
    });
    const repeatFanoutImport = await client.request(`/api/media/import-kavita?sync=1&pageSize=10&maxPages=2&chapterFanout=1&${scopeQuery}`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' }
    });

    const firstSummary = firstImport.data?.summary || {};
    const secondSummary = secondImport.data?.summary || {};
    const fanoutSummary = fanoutImport.data?.summary || {};
    const repeatFanoutSummary = repeatFanoutImport.data?.summary || {};
    assert(Number(firstSummary.created || 0) === 1, `Expected first Kavita import to create one new comic row while reusing the existing non-Kavita book title, got ${JSON.stringify(firstSummary)}`);
    assert(Number(firstSummary.updated || 0) === 1, `Expected first Kavita import to update the existing non-Kavita title, got ${JSON.stringify(firstSummary)}`);
    assert(Number(secondSummary.created || 0) === 0, `Expected second Kavita import to avoid duplicate creation, got ${JSON.stringify(secondSummary)}`);
    assert(Number(secondSummary.updated || 0) === 2, `Expected second Kavita import to update/no-op both canonical rows, got ${JSON.stringify(secondSummary)}`);
    assert(firstSummary.chapterFanoutEnabled === false, `Expected default Kavita import to keep chapter fan-out disabled, got ${JSON.stringify(firstSummary)}`);
    assert(Number(firstSummary.chapterFanoutRows || 0) === 0, `Expected default Kavita import to create no chapter fan-out rows, got ${JSON.stringify(firstSummary)}`);
    assert(Number(firstSummary.libraryCount || 0) === 2, `Expected Kavita import summary to include both libraries, got ${JSON.stringify(firstSummary)}`);
    assert(Number(firstSummary.volumeDetailsAttempted || 0) === 2, `Expected Kavita import to query volume/chapter details for both rows, got ${JSON.stringify(firstSummary)}`);
    assert(Number(firstSummary.volumeDetailsFetched || 0) === 2, `Expected Kavita import to load volume/chapter details for both rows, got ${JSON.stringify(firstSummary)}`);
    assert(fanoutSummary.chapterFanoutEnabled === true, `Expected opt-in Kavita import to enable chapter fan-out, got ${JSON.stringify(fanoutSummary)}`);
    assert(Number(fanoutSummary.chapterFanoutRows || 0) === 2, `Expected opt-in Kavita import to stage two comic chapter fan-out rows, got ${JSON.stringify(fanoutSummary)}`);
    assert(Number(fanoutSummary.chapterFanoutSkippedBooks || 0) === 1, `Expected book library chapter fan-out to be skipped, got ${JSON.stringify(fanoutSummary)}`);
    assert(Number(fanoutSummary.chapterFanoutSkippedSpecials || 0) === 1, `Expected Kavita special chapter to be skipped, got ${JSON.stringify(fanoutSummary)}`);
    assert(Number(fanoutSummary.created || 0) === 1, `Expected first fan-out import to create one new issue row while reusing the existing local issue, got ${JSON.stringify(fanoutSummary)}`);
    assert(Number(fanoutSummary.updated || 0) === 3, `Expected first fan-out import to update/no-op the two canonical series rows and existing local issue, got ${JSON.stringify(fanoutSummary)}`);
    assert(Number(repeatFanoutSummary.created || 0) === 0, `Expected repeat fan-out import to avoid duplicate issue creation, got ${JSON.stringify(repeatFanoutSummary)}`);
    assert(Number(repeatFanoutSummary.updated || 0) === 4, `Expected repeat fan-out import to update/no-op both canonical rows and both issue rows, got ${JSON.stringify(repeatFanoutSummary)}`);

    const bookRows = await readImportedProviderRow(libraryId, BOOK_PROVIDER_ITEM_ID);
    const comicRows = await readImportedProviderRow(libraryId, COMIC_PROVIDER_ITEM_ID);
    const comicChapterOneRows = await readImportedProviderRow(libraryId, COMIC_CHAPTER_ONE_PROVIDER_ITEM_ID);
    const comicChapterTwoRows = await readImportedProviderRow(libraryId, COMIC_CHAPTER_TWO_PROVIDER_ITEM_ID);
    const bookChapterRows = await readImportedProviderRow(libraryId, BOOK_CHAPTER_PROVIDER_ITEM_ID);
    const specialChapterRows = await readImportedProviderRow(libraryId, SPECIAL_CHAPTER_PROVIDER_ITEM_ID);
    assert(bookRows.length === 1, `Expected exactly one canonical Kavita book row, got ${JSON.stringify(bookRows)}`);
    assert(comicRows.length === 1, `Expected exactly one canonical Kavita comic row, got ${JSON.stringify(comicRows)}`);
    assert(comicChapterOneRows.length === 1, `Expected exactly one Kavita chapter issue #1 row, got ${JSON.stringify(comicChapterOneRows)}`);
    assert(comicChapterTwoRows.length === 1, `Expected exactly one Kavita chapter issue #2 row, got ${JSON.stringify(comicChapterTwoRows)}`);
    assert(bookChapterRows.length === 0, `Expected Kavita book chapter to stay series-level only, got ${JSON.stringify(bookChapterRows)}`);
    assert(specialChapterRows.length === 0, `Expected Kavita special chapter to be skipped, got ${JSON.stringify(specialChapterRows)}`);

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
    assert(String(canonicalBookDetails.kavita_cover_url || '') === `${fake.baseUrl}/api/image/series-cover?seriesId=8601`, `Expected Kavita book cover source URL metadata, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_cover_proxy_url || '') === '/api/media/kavita-cover/8601', `Expected Kavita book cover proxy metadata, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_cover_source || '') === 'collectz_proxy', `Expected Kavita book cover source metadata, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_cover_status || '') === 'proxied', `Expected Kavita book cover status metadata, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBook.poster_path || '') === '/api/media/kavita-cover/8601', `Expected Kavita book poster path to use collectZ cover proxy, got ${JSON.stringify(canonicalBook)}`);
    assert(String(canonicalBookDetails.kavita_volume_detail_status || '') === 'loaded', `Expected Kavita book volume detail status, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_volume_count || '') === '1', `Expected Kavita book volume count metadata, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_chapter_count || '') === '1', `Expected Kavita book chapter count metadata, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_first_chapter_title || '') === 'Kavita Import Sync Smoke Novel Chapter 1', `Expected Kavita book first chapter title metadata, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_first_chapter_release_date || '') === '2024-04-05', `Expected Kavita book first chapter release date metadata, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_first_chapter_pages || '') === '321', `Expected Kavita book first chapter page metadata, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_series_url || '') === `${fake.baseUrl}/library/86/series/8601`, `Expected Kavita book series launch URL metadata without secrets, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_launch_url || '') === `${fake.baseUrl}/library/86/series/8601/book/9701`, `Expected Kavita book reader launch URL metadata without secrets, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_launch_label || '') === 'Read in Kavita', `Expected Kavita book launch label, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(String(canonicalBookDetails.kavita_launch_target || '') === 'first_chapter_reader', `Expected Kavita book launch target, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(!String(canonicalBookDetails.kavita_launch_url || '').includes(KAVITA_SMOKE_KEY), `Kavita launch URL must not include API keys, got ${JSON.stringify(canonicalBookDetails)}`);
    assert(!String(canonicalBookDetails.kavita_launch_url || '').includes(KAVITA_SMOKE_BEARER), `Kavita launch URL must not include bearer tokens, got ${JSON.stringify(canonicalBookDetails)}`);

    const canonicalComic = comicRows[0] || {};
    const canonicalComicDetails = canonicalComic.type_details || {};
    assert(String(canonicalComic.media_type || '') === 'comic_book', `Expected Kavita library type 1 to classify as comic_book, got ${JSON.stringify(canonicalComic)}`);
    assert(String(canonicalComicDetails.provider_item_id || '') === COMIC_PROVIDER_ITEM_ID, `Expected provider item id ${COMIC_PROVIDER_ITEM_ID}, got ${JSON.stringify(canonicalComic)}`);
    assert(String(canonicalComicDetails.kavita_library_id || '') === '87', `Expected Kavita comic library id metadata, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(String(canonicalComicDetails.kavita_library_type || '') === 'comic', `Expected Kavita numeric comic library type metadata, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(String(canonicalComicDetails.kavita_pages || '') === '24', `Expected Kavita comic page metadata, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(String(canonicalComicDetails.volume || '') === '1-2', `Expected Kavita comic volume mapped from volume detail, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(String(canonicalComicDetails.issue_number || '') === '1', `Expected Kavita comic issue number mapped from chapter detail, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(String(canonicalComicDetails.cover_date || '') === '2023-03-04', `Expected Kavita comic cover date mapped from chapter publication date, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(String(canonicalComicDetails.kavita_volume_detail_status || '') === 'loaded', `Expected Kavita comic volume detail status, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(String(canonicalComicDetails.kavita_first_chapter_title || '') === 'Kavita Metadata Smoke Issue #1', `Expected Kavita comic first chapter title metadata, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(String(canonicalComicDetails.kavita_chapter_titles || '').includes('Kavita Metadata Smoke Issue #1'), `Expected Kavita comic chapter title list metadata, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(String(canonicalComicDetails.kavita_cover_url || '') === `${fake.baseUrl}/api/image/series-cover?seriesId=8602`, `Expected Kavita comic cover source URL metadata, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(String(canonicalComicDetails.kavita_cover_proxy_url || '') === '/api/media/kavita-cover/8602', `Expected Kavita comic cover proxy metadata, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(String(canonicalComicDetails.kavita_cover_source || '') === 'collectz_proxy', `Expected Kavita comic cover source metadata, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(String(canonicalComicDetails.kavita_cover_status || '') === 'proxied', `Expected Kavita comic cover status metadata, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(String(canonicalComic.poster_path || '') === '/api/media/kavita-cover/8602', `Expected Kavita comic poster path to use collectZ cover proxy, got ${JSON.stringify(canonicalComic)}`);
    assert(String(canonicalComicDetails.kavita_series_url || '') === `${fake.baseUrl}/library/87/series/8602`, `Expected Kavita comic series launch URL metadata without secrets, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(String(canonicalComicDetails.kavita_launch_url || '') === `${fake.baseUrl}/library/87/series/8602/manga/9702`, `Expected Kavita comic reader launch URL metadata without secrets, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(String(canonicalComicDetails.kavita_launch_label || '') === 'Read in Kavita', `Expected Kavita comic launch label, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(String(canonicalComicDetails.kavita_launch_target || '') === 'first_chapter_reader', `Expected Kavita comic launch target, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(!String(canonicalComicDetails.kavita_launch_url || '').includes(KAVITA_SMOKE_KEY), `Kavita launch URL must not include API keys, got ${JSON.stringify(canonicalComicDetails)}`);
    assert(!String(canonicalComicDetails.kavita_launch_url || '').includes(KAVITA_SMOKE_BEARER), `Kavita launch URL must not include bearer tokens, got ${JSON.stringify(canonicalComicDetails)}`);
    const chapterOne = comicChapterOneRows[0] || {};
    const chapterOneDetails = chapterOne.type_details || {};
    const chapterTwo = comicChapterTwoRows[0] || {};
    const chapterTwoDetails = chapterTwo.type_details || {};
    assert(String(chapterOne.media_type || '') === 'comic_book', `Expected Kavita chapter #1 fan-out media type to be comic_book, got ${JSON.stringify(chapterOne)}`);
    assert(String(chapterOne.title || '') === 'Kavita Metadata Smoke Issue #1', `Expected Kavita chapter #1 title, got ${JSON.stringify(chapterOne)}`);
    assert(String(chapterOneDetails.provider_name || '') === 'kavita', `Expected Kavita chapter #1 provider, got ${JSON.stringify(chapterOneDetails)}`);
    assert(String(chapterOneDetails.provider_item_id || '') === COMIC_CHAPTER_ONE_PROVIDER_ITEM_ID, `Expected Kavita chapter #1 provider item id, got ${JSON.stringify(chapterOneDetails)}`);
    assert(String(chapterOneDetails.provider_issue_id || '') === COMIC_CHAPTER_ONE_PROVIDER_ITEM_ID, `Expected Kavita chapter #1 provider issue id, got ${JSON.stringify(chapterOneDetails)}`);
    assert(String(chapterOneDetails.kavita_parent_provider_item_id || '') === COMIC_PROVIDER_ITEM_ID, `Expected Kavita chapter #1 parent provider linkage, got ${JSON.stringify(chapterOneDetails)}`);
    assert(String(chapterOneDetails.kavita_series_provider_item_id || '') === COMIC_PROVIDER_ITEM_ID, `Expected Kavita chapter #1 series provider linkage, got ${JSON.stringify(chapterOneDetails)}`);
    assert(String(chapterOneDetails.kavita_chapter_provider_item_id || '') === COMIC_CHAPTER_ONE_PROVIDER_ITEM_ID, `Expected Kavita chapter #1 provider linkage, got ${JSON.stringify(chapterOneDetails)}`);
    assert(String(chapterOneDetails.kavita_chapter_fanout || '') === 'true', `Expected Kavita chapter fan-out marker, got ${JSON.stringify(chapterOneDetails)}`);
    assert(String(chapterOneDetails.kavita_chapter_id || '') === '9702', `Expected Kavita chapter id, got ${JSON.stringify(chapterOneDetails)}`);
    assert(String(chapterOneDetails.kavita_volume_id || '') === '9602', `Expected Kavita chapter volume id, got ${JSON.stringify(chapterOneDetails)}`);
    assert(String(chapterOneDetails.issue_number || '') === '1', `Expected Kavita chapter #1 issue number, got ${JSON.stringify(chapterOneDetails)}`);
    assert(String(chapterOneDetails.volume || '') === '1-2', `Expected Kavita chapter #1 volume number, got ${JSON.stringify(chapterOneDetails)}`);
    assert(String(chapterOneDetails.cover_date || '') === '2023-03-04', `Expected Kavita chapter #1 cover date, got ${JSON.stringify(chapterOneDetails)}`);
    assert(dateReadbackStartsWith(chapterOne.release_date, '2023-03-04'), `Expected Kavita chapter #1 release date, got ${JSON.stringify(chapterOne)}`);
    assert(String(chapterOneDetails.kavita_chapter_pages || '') === '24', `Expected Kavita chapter #1 pages, got ${JSON.stringify(chapterOneDetails)}`);
    assert(String(chapterOne.poster_path || '') === '/api/media/kavita-cover/8602', `Expected Kavita chapter #1 poster proxy, got ${JSON.stringify(chapterOne)}`);
    assert(String(chapterOneDetails.kavita_launch_url || '') === `${fake.baseUrl}/library/87/series/8602/manga/9702`, `Expected Kavita chapter #1 launch URL, got ${JSON.stringify(chapterOneDetails)}`);
    assert(String(chapterOneDetails.kavita_launch_target || '') === 'chapter_reader', `Expected Kavita chapter #1 launch target, got ${JSON.stringify(chapterOneDetails)}`);
    assert(String(chapterTwoDetails.provider_item_id || '') === COMIC_CHAPTER_TWO_PROVIDER_ITEM_ID, `Expected Kavita chapter #2 provider item id, got ${JSON.stringify(chapterTwoDetails)}`);
    assert(String(chapterTwoDetails.issue_number || '') === '2', `Expected Kavita chapter #2 issue number, got ${JSON.stringify(chapterTwoDetails)}`);
    assert(dateReadbackStartsWith(chapterTwo.release_date, '2023-04-05'), `Expected Kavita chapter #2 release date, got ${JSON.stringify(chapterTwo)}`);
    assert(String(chapterTwoDetails.writer || '') === 'Existing Comic Writer', `Expected fan-out to preserve existing non-Kavita comic issue metadata, got ${JSON.stringify(chapterTwoDetails)}`);
    assert(!String(chapterOneDetails.kavita_launch_url || '').includes(KAVITA_SMOKE_KEY), `Kavita chapter launch URL must not include API keys, got ${JSON.stringify(chapterOneDetails)}`);
    assert(!String(chapterOneDetails.kavita_launch_url || '').includes(KAVITA_SMOKE_BEARER), `Kavita chapter launch URL must not include bearer tokens, got ${JSON.stringify(chapterOneDetails)}`);
    const kavitaSeriesPreview = await client.request(`/api/media/${canonicalComic.id}/kavita-writeback-preview?${scopeQuery}`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ target: 'series', selectedFields: ['summary', 'releaseYear', 'writers'] }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(kavitaSeriesPreview.data?.previewOnly === true, `Expected Kavita metadata preview to be preview-only, got ${JSON.stringify(kavitaSeriesPreview.data)}`);
    assert(kavitaSeriesPreview.data?.preview?.mutationEnabled === false, `Expected Kavita metadata preview mutation to stay disabled, got ${JSON.stringify(kavitaSeriesPreview.data)}`);
    assert(kavitaSeriesPreview.data?.preview?.target === 'series', `Expected Kavita series metadata preview target, got ${JSON.stringify(kavitaSeriesPreview.data)}`);
    assert((kavitaSeriesPreview.data?.preview?.changedFields || []).includes('releaseYear'), `Expected Kavita metadata preview diff to include releaseYear change, got ${JSON.stringify(kavitaSeriesPreview.data)}`);
    assert((kavitaSeriesPreview.data?.preview?.skippedFields || []).some((entry) => entry.field === 'writers' && entry.reason === 'locked'), `Expected Kavita metadata preview to skip locked writers, got ${JSON.stringify(kavitaSeriesPreview.data)}`);
    assert(!JSON.stringify(kavitaSeriesPreview.data).includes(KAVITA_SMOKE_KEY), `Kavita metadata preview must not expose API keys, got ${JSON.stringify(kavitaSeriesPreview.data)}`);
    const kavitaSeriesApply = await client.request(`/api/media/${canonicalComic.id}/kavita-writeback-apply?${scopeQuery}`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ target: 'series', selectedFields: ['summary', 'releaseYear', 'writers'], confirm: true }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(kavitaSeriesApply.data?.applied === true, `Expected Kavita metadata apply to succeed, got ${JSON.stringify(kavitaSeriesApply.data)}`);
    assert(kavitaSeriesApply.data?.previewOnly === false, `Expected Kavita metadata apply not to be preview-only, got ${JSON.stringify(kavitaSeriesApply.data)}`);
    assert((kavitaSeriesApply.data?.appliedFields || []).includes('releaseYear'), `Expected Kavita metadata apply to include releaseYear, got ${JSON.stringify(kavitaSeriesApply.data)}`);
    assert(!JSON.stringify(kavitaSeriesApply.data).includes(KAVITA_SMOKE_KEY), `Kavita metadata apply must not expose API keys, got ${JSON.stringify(kavitaSeriesApply.data)}`);
    assert(fake.seriesWritebacks.length === 1, `Expected one fake Kavita series metadata write, got ${JSON.stringify(fake.seriesWritebacks)}`);
    assert(Number(fake.seriesWritebacks[0]?.seriesMetadata?.seriesId || 0) === 8602, `Expected Kavita series apply payload to target series 8602, got ${JSON.stringify(fake.seriesWritebacks[0])}`);
    assert(Number(fake.seriesWritebacks[0]?.seriesMetadata?.releaseYear || 0) === 2023, `Expected Kavita series apply payload releaseYear 2023, got ${JSON.stringify(fake.seriesWritebacks[0])}`);
    assert(fake.seriesWritebacks[0]?.seriesMetadata?.writers === undefined, `Expected locked writers to be omitted from Kavita series apply payload, got ${JSON.stringify(fake.seriesWritebacks[0])}`);
    const kavitaChapterPreview = await client.request(`/api/media/${chapterOne.id}/kavita-writeback-preview?${scopeQuery}`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ target: 'chapter', selectedFields: ['titleName', 'releaseDate'] }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(kavitaChapterPreview.data?.preview?.target === 'chapter', `Expected Kavita chapter metadata preview target, got ${JSON.stringify(kavitaChapterPreview.data)}`);
    assert(Array.isArray(kavitaChapterPreview.data?.preview?.diff), `Expected Kavita chapter preview diff, got ${JSON.stringify(kavitaChapterPreview.data)}`);
    assert(!JSON.stringify(kavitaChapterPreview.data).includes(KAVITA_SMOKE_BEARER), `Kavita metadata preview must not expose bearer tokens, got ${JSON.stringify(kavitaChapterPreview.data)}`);
    const kavitaChapterApply = await client.request(`/api/media/${chapterOne.id}/kavita-writeback-apply?${scopeQuery}`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ target: 'chapter', selectedFields: ['titleName', 'releaseDate'], confirm: true }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(kavitaChapterApply.data?.applied === true, `Expected Kavita chapter metadata apply to succeed, got ${JSON.stringify(kavitaChapterApply.data)}`);
    assert(fake.chapterWritebacks.length === 1, `Expected one fake Kavita chapter metadata write, got ${JSON.stringify(fake.chapterWritebacks)}`);
    assert(Number(fake.chapterWritebacks[0]?.id || 0) === 9702, `Expected Kavita chapter apply payload id 9702, got ${JSON.stringify(fake.chapterWritebacks[0])}`);
    assert(String(fake.chapterWritebacks[0]?.releaseDate || '').startsWith('2023-03-04'), `Expected Kavita chapter apply releaseDate, got ${JSON.stringify(fake.chapterWritebacks[0])}`);
    assert(!JSON.stringify(kavitaChapterApply.data).includes(KAVITA_SMOKE_BEARER), `Kavita metadata apply must not expose bearer tokens, got ${JSON.stringify(kavitaChapterApply.data)}`);
    const kavitaProgressReadback = await client.request(`/api/media/${chapterOne.id}/kavita-progress?${scopeQuery}`, {
      expectStatus: 200
    });
    assert(kavitaProgressReadback.data?.readOnly === true, `Expected Kavita progress readback to stay read-only, got ${JSON.stringify(kavitaProgressReadback.data)}`);
    assert(Number(kavitaProgressReadback.data?.progress?.chapterId || 0) === 9702, `Expected Kavita progress chapter id, got ${JSON.stringify(kavitaProgressReadback.data)}`);
    assert(Number(kavitaProgressReadback.data?.progress?.pageNum || 0) === 11, `Expected Kavita progress page number, got ${JSON.stringify(kavitaProgressReadback.data)}`);
    assert(!JSON.stringify(kavitaProgressReadback.data).includes(KAVITA_SMOKE_KEY), `Kavita progress readback must not expose API keys, got ${JSON.stringify(kavitaProgressReadback.data)}`);
    assert(!JSON.stringify(kavitaProgressReadback.data).includes(KAVITA_SMOKE_BEARER), `Kavita progress readback must not expose bearer tokens, got ${JSON.stringify(kavitaProgressReadback.data)}`);
    const coverReadback = await client.requestRaw(`/api/media/kavita-cover/8602?${scopeQuery}`, { expectStatus: 200 });
    assert(String(coverReadback.headers.get('content-type') || '').startsWith('image/png'), `Expected Kavita proxied cover content type, got ${coverReadback.headers.get('content-type')}`);
    assert(coverReadback.body.length > 0, 'Expected Kavita proxied cover body');

    const secondScope = await createDirectSpaceAndLibrary({ userId, suffix });
    secondSpaceId = secondScope.spaceId;
    secondLibraryId = secondScope.libraryId;
    await client.request(`/api/spaces/${secondSpaceId}/integrations`, {
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
    const secondWorkspaceImport = await client.request(`/api/media/import-kavita?sync=1&pageSize=10&maxPages=2&space_id=${secondSpaceId}&library_id=${secondLibraryId}`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' }
    });
    const secondWorkspaceSummary = secondWorkspaceImport.data?.summary || {};
    assert(Number(secondWorkspaceSummary.created || 0) === 2, `Expected overlapping Kavita ids to create rows in the second workspace only, got ${JSON.stringify(secondWorkspaceSummary)}`);
    assert((await readImportedProviderRow(libraryId, COMIC_PROVIDER_ITEM_ID)).length === 1, 'Expected original workspace Kavita comic row count to remain isolated after second workspace import');
    assert((await readImportedProviderRow(secondLibraryId, COMIC_PROVIDER_ITEM_ID)).length === 1, 'Expected second workspace to own its own Kavita comic row with overlapping provider id');
    const secondCoverReadback = await client.requestRaw(`/api/media/kavita-cover/8602?space_id=${secondSpaceId}&library_id=${secondLibraryId}`, { expectStatus: 200 });
    assert(String(secondCoverReadback.headers.get('content-type') || '').startsWith('image/png'), `Expected second workspace Kavita cover content type, got ${secondCoverReadback.headers.get('content-type')}`);

    console.log(JSON.stringify({
      provider: 'kavita',
      rows: firstImport.data?.rows,
      firstCreated: firstSummary.created,
      firstUpdated: firstSummary.updated,
      secondCreated: secondSummary.created,
      secondUpdated: secondSummary.updated,
      fanoutCreated: fanoutSummary.created,
      fanoutUpdated: fanoutSummary.updated,
      repeatFanoutCreated: repeatFanoutSummary.created,
      repeatFanoutUpdated: repeatFanoutSummary.updated,
      canonicalBookRows: bookRows.length,
      canonicalComicRows: comicRows.length,
      comicChapterRows: comicChapterOneRows.length + comicChapterTwoRows.length,
      fanoutRows: fanoutSummary.chapterFanoutRows,
      bookFanoutRows: bookChapterRows.length,
      specialFanoutRows: specialChapterRows.length,
      reusedExistingNonKavitaTitle: true,
      reusedExistingNonKavitaIssue: true,
      workspaceOwnedSettings: true,
      workspaceKavitaTestOk: true,
      overlappingWorkspaceCreated: secondWorkspaceSummary.created,
      overlappingWorkspaceComicRows: (await readImportedProviderRow(secondLibraryId, COMIC_PROVIDER_ITEM_ID)).length,
      metadataPreviewOnly: kavitaSeriesPreview.data?.previewOnly === true,
      metadataPreviewChangedFields: kavitaSeriesPreview.data?.preview?.changedFields || [],
      metadataPreviewSkippedFields: kavitaSeriesPreview.data?.preview?.skippedFields || [],
      metadataApplyFields: kavitaSeriesApply.data?.appliedFields || [],
      metadataApplyWrites: fake.seriesWritebacks.length,
      chapterMetadataApplyWrites: fake.chapterWritebacks.length,
      chapterMetadataPreviewTarget: kavitaChapterPreview.data?.preview?.target,
      progressReadOnly: kavitaProgressReadback.data?.readOnly === true,
      progressReadEndpointCalls: fake.progressReads.length,
      progressReadPage: kavitaProgressReadback.data?.progress?.pageNum,
      comicClassifiedFromLibraryType: canonicalComic.media_type === 'comic_book',
      volumeDetailsFetched: firstSummary.volumeDetailsFetched,
      comicIssueNumber: canonicalComicDetails.issue_number,
      comicChapterIssueNumbers: [chapterOneDetails.issue_number, chapterTwoDetails.issue_number],
      bookLaunchUrl: canonicalBookDetails.kavita_launch_url,
      comicLaunchUrl: canonicalComicDetails.kavita_launch_url,
      comicChapterLaunchUrl: chapterOneDetails.kavita_launch_url,
      comicCoverProxyUrl: canonicalComicDetails.kavita_cover_proxy_url,
      coverProxyContentType: coverReadback.headers.get('content-type'),
      secretReturned: false
    }, null, 2));
  } finally {
    if (previousLogExport) {
      await pool.query(
        `UPDATE app_integrations
            SET log_export_backend = $1,
                log_export_host = $2,
                log_export_port = $3
          WHERE id = 1`,
        [
          previousLogExport.log_export_backend || null,
          previousLogExport.log_export_host || null,
          previousLogExport.log_export_port || null
        ]
      ).catch(() => {});
    }
    if (spaceId) {
      await client.request(`/api/spaces/${spaceId}/integrations`, {
        method: 'PUT',
        withCsrf: true,
        body: JSON.stringify({ kavitaBaseUrl: '', clearKavitaApiKey: true }),
        headers: { 'Content-Type': 'application/json' }
      }).catch(() => {});
    }
    if (secondSpaceId) {
      await client.request(`/api/spaces/${secondSpaceId}/integrations`, {
        method: 'PUT',
        withCsrf: true,
        body: JSON.stringify({ kavitaBaseUrl: '', clearKavitaApiKey: true }),
        headers: { 'Content-Type': 'application/json' }
      }).catch(() => {});
    }
    await cleanupTemporaryState({ userId: null, libraryId: secondLibraryId, spaceId: secondSpaceId });
    await cleanupTemporaryState({ userId, libraryId, spaceId });
    await new Promise((resolve) => fake.server.close(resolve)).catch(() => {});
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
