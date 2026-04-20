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

function isAcceptedIsbnMatch(matchedBy) {
  return matchedBy === 'isbn' || matchedBy === 'normalization_isbn';
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

async function startFakeBooksServer(cases) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname !== '/volumes') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    const q = String(url.searchParams.get('q') || '').trim();
    const match = cases.find((entry) => q.includes(entry.isbn) || q.toLowerCase().includes(String(entry.title || '').toLowerCase()));
    const payload = match
      ? buildBooksApiResponse(match)
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
    server,
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

async function runCase({
  client,
  libraryId,
  path,
  csvText,
  filename,
  mediaType,
  title
}) {
  const firstResponse = await client.request(path, {
    method: 'POST',
    withCsrf: true,
    expectStatus: 200,
    body: buildMultipartCsv(csvText, filename),
    headers: {
      'x-valuation-refresh-mode': 'fixture'
    }
  });
  const secondResponse = await client.request(path, {
    method: 'POST',
    withCsrf: true,
    expectStatus: 200,
    body: buildMultipartCsv(csvText, filename),
    headers: {
      'x-valuation-refresh-mode': 'fixture'
    }
  });

  const firstSummary = firstResponse?.data?.summary || {};
  const secondSummary = secondResponse?.data?.summary || {};
  const firstAuditRow = Array.isArray(firstResponse?.data?.auditRows) ? firstResponse.data.auditRows[0] || null : null;
  const secondAuditRow = Array.isArray(secondResponse?.data?.auditRows) ? secondResponse.data.auditRows[0] || null : null;

  assert(Number(firstSummary.created || 0) === 1, `[${path}] expected first import to create one row, got ${JSON.stringify(firstSummary)}`);
  assert(Number(firstSummary.updated || 0) === 0, `[${path}] expected first import to avoid updates, got ${JSON.stringify(firstSummary)}`);
  assert(Number(secondSummary.created || 0) === 0, `[${path}] expected repeat import to avoid creates, got ${JSON.stringify(secondSummary)}`);
  assert(Number(secondSummary.updated || 0) === 1, `[${path}] expected repeat import to update one row, got ${JSON.stringify(secondSummary)}`);
  assert(isAcceptedIsbnMatch(secondAuditRow?.matched_by), `[${path}] expected repeat import to match by isbn, got ${JSON.stringify(secondAuditRow)}`);

  const mediaCount = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM media
      WHERE library_id = $1
        AND media_type = $2
        AND title = $3`,
    [libraryId, mediaType, title]
  );
  const count = Number(mediaCount.rows[0]?.count || 0);
  assert(count === 1, `[${path}] expected one scoped ${mediaType} row titled "${title}", found ${count}`);

  return {
    firstCreated: Number(firstSummary.created || 0),
    secondCreated: Number(secondSummary.created || 0),
    secondUpdated: Number(secondSummary.updated || 0),
      firstMatchedBy: firstAuditRow?.matched_by || null,
      secondMatchedBy: secondAuditRow?.matched_by || null,
      scopedCount: count
    };
}

async function main() {
  const suffix = Date.now();
  const email = `repeat-sync-idempotency-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('repeat-sync-idempotency-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;
  let fakeBooks = null;

  try {
    fakeBooks = await startFakeBooksServer([
      {
        title: 'Repeat Generic Book',
        author: 'Smoke Author One',
        isbn: '9781401207924'
      },
      {
        title: 'Repeat Calibre Book',
        author: 'Smoke Author Two',
        isbn: '9781401207925'
      },
      {
        title: 'Repeat Delicious Book',
        author: 'Smoke Author Three',
        isbn: '9781401207926'
      }
    ]);

    userId = await createDirectUser({
      email,
      password,
      name: 'Repeat Sync Idempotency Smoke User'
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

    const generic = await runCase({
      client,
      libraryId,
      path: '/api/media/import-csv?sync=1',
      filename: 'repeat-generic.csv',
      mediaType: 'book',
      title: 'Repeat Generic Book',
      csvText: [
        'title,media_type,format,author,isbn,publisher',
        '"Repeat Generic Book","book","Hardcover","Smoke Author One","9781401207924","Smoke Press"'
      ].join('\n')
    });

    const calibre = await runCase({
      client,
      libraryId,
      path: '/api/media/import-csv/calibre?sync=1',
      filename: 'repeat-calibre.csv',
      mediaType: 'book',
      title: 'Repeat Calibre Book',
      csvText: [
        'title,authors,isbn,publisher,pubdate,format,tags',
        '"Repeat Calibre Book","Smoke Author Two","9781401207925","Smoke Press","2024-01-01","EPUB","book"'
      ].join('\n')
    });

    const delicious = await runCase({
      client,
      libraryId,
      path: '/api/media/import-csv/delicious?sync=1',
      filename: 'repeat-delicious.csv',
      mediaType: 'book',
      title: 'Repeat Delicious Book',
      csvText: [
        'Item Type,Title,Creator,ISBN,Edition,Format,Release Date',
        '"Book","Repeat Delicious Book","Smoke Author Three","9781401207926","First Edition","Hardcover","2024-01-01"'
      ].join('\n')
    });

    console.log(JSON.stringify({
      generic,
      calibre,
      delicious
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
