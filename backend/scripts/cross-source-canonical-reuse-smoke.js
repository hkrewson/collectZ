'use strict';

const http = require('http');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');

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

function buildBooksApiResponse({ title, author, isbn, publisher = 'Smoke Press', publishedDate = '2024-01-01' }) {
  return {
    items: [
      {
        id: `books-${isbn}`,
        volumeInfo: {
          title,
          authors: [author],
          publisher,
          publishedDate,
          industryIdentifiers: [
            { type: 'ISBN_13', identifier: isbn }
          ],
          infoLink: `https://example.invalid/books/${isbn}`
        }
      }
    ]
  };
}

async function startFakeBooksServer(entry) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname !== '/volumes') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
    const payload = q.includes(entry.isbn) || q.includes(String(entry.title || '').toLowerCase())
      ? buildBooksApiResponse(entry)
      : { items: [] };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to start fake books server');

  return {
    url: `http://127.0.0.1:${address.port}/volumes`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

async function createDirectUser({ email, password, name, role = 'user' }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, $3, $4, true, NOW())
     RETURNING id`,
    [email, passwordHash, name, role]
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

function buildMultipartCsv(csvText, filename) {
  const form = new FormData();
  form.append('file', new Blob([csvText], { type: 'text/csv' }), filename);
  return form;
}

async function fetchCanonicalRow(libraryId, title) {
  const result = await pool.query(
    `SELECT id, import_source, type_details
       FROM media
      WHERE library_id = $1
        AND media_type = 'book'
        AND title = $2
      ORDER BY id ASC
      LIMIT 1`,
    [libraryId, title]
  );
  return result.rows[0] || null;
}

async function runImportStep({ client, path, filename, csvText, expectCreated, expectUpdated }) {
  const response = await client.request(path, {
    method: 'POST',
    withCsrf: true,
    expectStatus: 200,
    body: buildMultipartCsv(csvText, filename),
    headers: {
      'x-valuation-refresh-mode': 'fixture'
    }
  });

  const summary = response?.data?.summary || {};
  const firstAuditRow = Array.isArray(response?.data?.auditRows) ? response.data.auditRows[0] || null : null;

  assert(Number(summary.created || 0) === expectCreated, `[${path}] expected created=${expectCreated}, got ${JSON.stringify(summary)}`);
  assert(Number(summary.updated || 0) === expectUpdated, `[${path}] expected updated=${expectUpdated}, got ${JSON.stringify(summary)}`);

  return {
    summary,
    audit: firstAuditRow
  };
}

async function main() {
  const suffix = Date.now();
  const email = `cross-source-reuse-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('cross-source-canonical-reuse-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;
  let fakeBooks = null;

  const title = 'Cross Source Canonical Book';
  const isbn = '9781401207927';
  const author = 'Smoke Author Cross Source';

  try {
    fakeBooks = await startFakeBooksServer({ title, author, isbn });

    userId = await createDirectUser({
      email,
      password,
      name: 'Cross Source Canonical Reuse Smoke User'
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

    await pool.query(
      `INSERT INTO app_integrations (
         space_id, books_preset, books_provider, books_api_url, books_api_key_header, books_api_key_query_param
       ) VALUES (
         $1, 'googlebooks', 'googlebooks', $2, '', 'key'
       )
       ON CONFLICT (space_id)
       DO UPDATE SET
         books_preset = EXCLUDED.books_preset,
         books_provider = EXCLUDED.books_provider,
         books_api_url = EXCLUDED.books_api_url,
         books_api_key_header = EXCLUDED.books_api_key_header,
         books_api_key_query_param = EXCLUDED.books_api_key_query_param`,
      [spaceId, fakeBooks.url]
    );

    const generic = await runImportStep({
      client,
      path: '/api/media/import-csv?sync=1',
      filename: 'cross-source-generic.csv',
      expectCreated: 1,
      expectUpdated: 0,
      csvText: [
        'title,media_type,format,author,isbn,publisher',
        `"${title}","book","Hardcover","${author}","${isbn}","Smoke Press"`
      ].join('\n')
    });
    const rowAfterGeneric = await fetchCanonicalRow(libraryId, title);
    assert(rowAfterGeneric?.id, 'Expected canonical row after generic import');
    assert(rowAfterGeneric?.import_source === 'csv_generic', `Expected csv_generic source after generic import, got ${JSON.stringify(rowAfterGeneric)}`);

    const calibre = await runImportStep({
      client,
      path: '/api/media/import-csv/calibre?sync=1',
      filename: 'cross-source-calibre.csv',
      expectCreated: 0,
      expectUpdated: 1,
      csvText: [
        'title,authors,isbn,publisher,pubdate,format,tags',
        `"${title}","${author}","${isbn}","Smoke Press","2024-01-01","EPUB","book"`
      ].join('\n')
    });
    const rowAfterCalibre = await fetchCanonicalRow(libraryId, title);
    assert(rowAfterCalibre?.id === rowAfterGeneric.id, `Expected calibre import to reuse canonical row ${rowAfterGeneric.id}, got ${JSON.stringify(rowAfterCalibre)}`);
    assert(rowAfterCalibre?.import_source === 'csv_calibre', `Expected csv_calibre source after calibre import, got ${JSON.stringify(rowAfterCalibre)}`);

    const delicious = await runImportStep({
      client,
      path: '/api/media/import-csv/delicious?sync=1',
      filename: 'cross-source-delicious.csv',
      expectCreated: 0,
      expectUpdated: 1,
      csvText: [
        'Item Type,Title,Creator,ISBN,Edition,Format,Release Date',
        `"Book","${title}","${author}","${isbn}","Collector''s Edition","Hardcover","2024-01-01"`
      ].join('\n')
    });
    const rowAfterDelicious = await fetchCanonicalRow(libraryId, title);
    assert(rowAfterDelicious?.id === rowAfterGeneric.id, `Expected delicious import to reuse canonical row ${rowAfterGeneric.id}, got ${JSON.stringify(rowAfterDelicious)}`);
    assert(rowAfterDelicious?.import_source === 'csv_delicious', `Expected csv_delicious source after delicious import, got ${JSON.stringify(rowAfterDelicious)}`);

    const mediaCount = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM media
        WHERE library_id = $1
          AND media_type = 'book'
          AND title = $2`,
      [libraryId, title]
    );
    const scopedCount = Number(mediaCount.rows[0]?.count || 0);
    assert(scopedCount === 1, `Expected one canonical book row after cross-source imports, found ${scopedCount}`);

    console.log(JSON.stringify({
      generic: {
        created: Number(generic.summary.created || 0),
        updated: Number(generic.summary.updated || 0),
        matchedBy: generic.audit?.matched_by || null
      },
      calibre: {
        created: Number(calibre.summary.created || 0),
        updated: Number(calibre.summary.updated || 0),
        matchedBy: calibre.audit?.matched_by || null
      },
      delicious: {
        created: Number(delicious.summary.created || 0),
        updated: Number(delicious.summary.updated || 0),
        matchedBy: delicious.audit?.matched_by || null
      },
      canonicalId: Number(rowAfterGeneric.id),
      canonicalImportSource: rowAfterDelicious.import_source,
      scopedCount
    }, null, 2));
  } finally {
    if (fakeBooks) {
      await fakeBooks.close().catch(() => {});
    }
    await cleanupTemporaryState({ userId, libraryId, spaceId });
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
