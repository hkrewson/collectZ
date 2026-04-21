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

async function seedScopedPlexIntegration({ spaceId, apiUrl, token, sectionIds }) {
  await pool.query(
    `INSERT INTO app_integrations (
       space_id,
       plex_preset,
       plex_provider,
       plex_api_url,
       plex_api_key_encrypted,
       plex_library_sections
     ) VALUES (
       $1, 'plex', 'plex', $2, $3, $4::jsonb
     )`,
    [spaceId, apiUrl, encryptSecret(token), JSON.stringify(sectionIds.map(String))]
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

async function startFakePlexServer({ title, originalTitle, year, tmdbId, runtimeMs, token, ratingKey = '1101' }) {
  const sectionsXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<MediaContainer size="1">',
    '  <Directory key="1" title="Smoke Movies" type="movie" />',
    '</MediaContainer>'
  ].join('');
  const sectionItemsXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<MediaContainer size="1">',
    '  <Video',
    `    ratingKey="${ratingKey}"`,
    `    key="/library/metadata/${ratingKey}"`,
    '    type="movie"',
    `    title="${title}"`,
    `    originalTitle="${originalTitle}"`,
    `    year="${year}"`,
    `    duration="${runtimeMs}"`,
    '    summary="Provider-family cross-source canonical reuse smoke summary"',
    '    studio="Provider Family Cross Source Studio"',
    `    guid="tmdb://${tmdbId}"`,
    '  >',
    `    <Media id="7101" duration="${runtimeMs}" videoResolution="4k" audioChannels="6" container="mkv">`,
    '      <Part id="7201" file="/movies/provider-family-cross-source.mkv" />',
    '    </Media>',
    '  </Video>',
    '</MediaContainer>'
  ].join('');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.searchParams.get('X-Plex-Token') !== token) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('unauthorized');
      return;
    }

    if (url.pathname === '/library/sections') {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(sectionsXml);
      return;
    }

    if (url.pathname === '/library/sections/1/all') {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(sectionItemsXml);
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
  if (!address || typeof address === 'string') throw new Error('Failed to start fake Plex server');

  return {
    server,
    apiUrl: `http://127.0.0.1:${address.port}`,
    token
  };
}

async function fetchScopeContext(client) {
  const scope = await client.request('/api/auth/scope', { expectStatus: 200 });
  const libraryId = Number(scope?.data?.active_library_id || 0) || null;
  let spaceId = Number(scope?.data?.active_space_id || 0) || null;
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
  return { libraryId, spaceId };
}

async function main() {
  const suffix = Date.now();
  const email = `provider-family-cross-source-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('provider-family-cross-source-canonical-reuse-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;
  let fakePlex = null;

  const canonicalTitle = 'Provider Family Cross Source Movie CSV Variant';
  const plexTitle = 'Provider Family Cross Source Movie';
  const year = 2022;
  const tmdbId = 930001;

  try {
    fakePlex = await startFakePlexServer({
      title: plexTitle,
      originalTitle: plexTitle,
      year,
      tmdbId,
      runtimeMs: 7500000,
      token: 'provider-family-cross-source-token'
    });

    userId = await createDirectUser({
      email,
      password,
      name: 'Provider-Family Cross-Source Canonical Reuse Smoke Admin',
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

    await seedScopedPlexIntegration({
      spaceId,
      apiUrl: fakePlex.apiUrl,
      token: fakePlex.token,
      sectionIds: ['1']
    });

    const canonicalInsert = await pool.query(
      `INSERT INTO media (
         title, media_type, format, year, runtime, tmdb_id, tmdb_media_type, notes, type_details, library_id, space_id, added_by, import_source
       ) VALUES (
         $1, 'movie', 'Digital', $2, 111, $3, 'movie', $4, '{}'::jsonb, $5, $6, $7, 'csv_generic'
       )
       RETURNING id`,
      [canonicalTitle, year, tmdbId, 'Imported from CSV generic source', libraryId, spaceId, userId]
    );
    const canonicalId = Number(canonicalInsert.rows[0]?.id || 0) || null;
    assert(canonicalId, 'Expected seeded canonical id');

    const importResponse = await client.request('/api/media/import-plex?sync=1', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ sectionIds: ['1'] }),
      headers: { 'Content-Type': 'application/json' }
    });

    const summary = importResponse?.data?.summary || {};
    assert(Number(summary.created || 0) === 0, `Expected no created rows after provider-family cross-source Plex sync, got ${JSON.stringify(summary)}`);
    assert(Number(summary.updated || 0) === 1, `Expected one updated row after provider-family cross-source Plex sync, got ${JSON.stringify(summary)}`);

    const mediaRows = await pool.query(
      `SELECT id, title, runtime, tmdb_id, import_source, notes, network
       FROM media
       WHERE library_id = $1
         AND media_type = 'movie'
       ORDER BY id ASC`,
      [libraryId]
    );
    const rows = mediaRows.rows || [];
    assert(rows.length === 1, `Expected one movie row after provider-family cross-source sync, found ${rows.length}`);

    const canonicalRow = rows[0] || null;
    assert(Number(canonicalRow?.id || 0) === canonicalId, 'Expected Plex sync to reuse the original canonical row');
    assert(String(canonicalRow?.title || '') === canonicalTitle, 'Expected canonical title variant to remain unchanged, proving TMDB-based reuse instead of title fallback');
    assert(Number(canonicalRow?.tmdb_id || 0) === tmdbId, 'Expected canonical TMDB id to remain stable');
    assert(Number(canonicalRow?.runtime || 0) === 125, 'Expected canonical runtime to update from Plex payload');
    assert(String(canonicalRow?.import_source || '') === 'plex', 'Expected canonical import_source to update to plex');
    assert(String(canonicalRow?.notes || '') === 'Imported from Plex section 1', 'Expected canonical notes to reflect Plex sync');
    assert(String(canonicalRow?.network || '') === 'Provider Family Cross Source Studio', 'Expected canonical network to reflect Plex sync');

    const metadataRows = await pool.query(
      `SELECT "key", "value"
       FROM media_metadata
       WHERE media_id = $1
         AND "key" IN ('plex_guid', 'plex_item_key')`,
      [canonicalId]
    );
    assert(metadataRows.rows.length === 2, 'Expected canonical row to store live Plex metadata after TMDB-based reuse');

    console.log(JSON.stringify({
      canonicalId,
      created: Number(summary.created || 0),
      updated: Number(summary.updated || 0),
      imported: Number(importResponse?.data?.imported || 0),
      matchedBy: 'provider_tmdb',
      stableIdentity: 'tmdb_id',
      canonicalTitle: canonicalRow?.title || null,
      canonicalImportSource: canonicalRow?.import_source || null,
      scopedMovieCount: rows.length
    }, null, 2));
  } finally {
    if (fakePlex?.server) {
      await new Promise((resolve) => fakePlex.server.close(() => resolve()));
    }
    await cleanupTemporaryState({ userId, libraryId, spaceId });
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
