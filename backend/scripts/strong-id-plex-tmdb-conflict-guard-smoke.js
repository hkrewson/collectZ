'use strict';

const http = require('http');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { runManualMediaMergeApply } = require('./repair-book-comic-duplicates');
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

async function startFakePlexServer({ title, year, tmdbId, ratingKey, token }) {
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
    `    originalTitle="${title}"`,
    `    year="${year}"`,
    '    duration="7500000"',
    '    summary="Strong-id Plex TMDB conflict smoke summary"',
    '    studio="Conflict Guard Studio"',
    `    guid="tmdb://${tmdbId}"`,
    '  >',
    '    <Media id="6001" duration="7500000" videoResolution="4k" audioChannels="6" container="mkv">',
    '      <Part id="7001" file="/movies/Strong ID Conflict Guard Movie.mkv" />',
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
  return {
    server,
    apiUrl: `http://127.0.0.1:${address.port}`
  };
}

async function seedMovieRow({ title, year, notes, runtime, tmdbId, libraryId, spaceId, userId }) {
  const result = await pool.query(
    `INSERT INTO media (
       title, media_type, format, year, runtime, tmdb_id, tmdb_media_type, notes, type_details, library_id, space_id, added_by, import_source
     ) VALUES (
       $1, 'movie', 'Blu-ray', $2, $3, $4, 'movie', $5, '{}'::jsonb, $6, $7, $8, 'manual_seed'
     )
     RETURNING id`,
    [title, year, runtime, tmdbId, notes, libraryId, spaceId, userId]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

async function fetchMovieRow(mediaId) {
  const result = await pool.query(
    `SELECT id, title, year, runtime, tmdb_id, notes, import_source
       FROM media
      WHERE id = $1
      LIMIT 1`,
    [mediaId]
  );
  return result.rows[0] || null;
}

async function findConflictingPlexMovieRow(libraryId, { title, notes, runtime }) {
  const result = await pool.query(
    `SELECT id, title, year, runtime, tmdb_id, notes, import_source
       FROM media
      WHERE library_id = $1
        AND media_type = 'movie'
        AND title = $2
        AND notes = $3
        AND runtime = $4
      ORDER BY id DESC
      LIMIT 1`,
    [libraryId, title, notes, runtime]
  );
  return result.rows[0] || null;
}

async function countLibraryMovies(libraryId, title) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM media
      WHERE library_id = $1
        AND media_type = 'movie'
        AND title = $2`,
    [libraryId, title]
  );
  return Number(result.rows[0]?.count || 0);
}

async function main() {
  const suffix = Date.now();
  const email = `strong-id-plex-tmdb-conflict-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('strong-id-plex-tmdb-conflict-guard-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;
  let fakePlex = null;

  const title = `Strong ID Plex Conflict ${suffix}`;
  const year = 2024;
  const canonicalTmdbId = 920001;
  const mergedDuplicateTmdbId = 920002;
  const conflictingImportTmdbId = 920003;
  const importRuntime = 125;
  const plexToken = 'plex-strong-id-conflict-token';
  const plexRatingKey = '991';

  try {
    fakePlex = await startFakePlexServer({
      title,
      year,
      tmdbId: conflictingImportTmdbId,
      ratingKey: plexRatingKey,
      token: plexToken
    });

    userId = await createDirectUser({
      email,
      password,
      name: 'Strong Identifier Plex TMDB Conflict Guard Smoke Admin',
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

    const scope = await fetchScopeContext(client);
    libraryId = scope.libraryId;
    spaceId = scope.spaceId;

    await seedScopedPlexIntegration({
      spaceId,
      apiUrl: fakePlex.apiUrl,
      token: plexToken,
      sectionIds: ['1']
    });

    const canonicalId = await seedMovieRow({
      title,
      year,
      notes: 'Canonical Plex TMDB conflict row should stay untouched',
      runtime: 121,
      tmdbId: canonicalTmdbId,
      libraryId,
      spaceId,
      userId
    });
    const duplicateId = await seedMovieRow({
      title: `${title} merged duplicate`,
      year,
      notes: 'Duplicate Plex TMDB conflict row merged into canonical',
      runtime: 122,
      tmdbId: mergedDuplicateTmdbId,
      libraryId,
      spaceId,
      userId
    });
    assert(canonicalId && duplicateId, 'Expected seeded canonical and duplicate movie ids');

    const mergeResult = await runManualMediaMergeApply({
      canonicalId,
      duplicateId,
      mergeEvidence: {
        action: 'manual_merge',
        source: 'strong_identifier_plex_tmdb_conflict_guard_smoke',
        rationale: 'Seed merged canonical movie before conflicting Plex import'
      }
    });
    assert(mergeResult?.attached === 1, 'Expected merged canonical movie precondition to be applied');

    const importResponse = await client.request('/api/media/import-plex?sync=1', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ sectionIds: ['1'] }),
      headers: { 'Content-Type': 'application/json' }
    });

    const summary = importResponse?.data?.summary || {};
    assert(Number(summary.created || 0) === 1, `Expected conflicting Plex TMDB import to create a new row, got ${JSON.stringify(summary)}`);
    assert(Number(summary.updated || 0) === 0, `Expected conflicting Plex TMDB import to avoid updating the canonical row, got ${JSON.stringify(summary)}`);

    const canonicalRow = await fetchMovieRow(canonicalId);
    const conflictingRow = await findConflictingPlexMovieRow(libraryId, {
      title,
      notes: 'Imported from Plex section 1',
      runtime: importRuntime
    });
    const titledMovieCount = await countLibraryMovies(libraryId, title);

    assert(canonicalRow, 'Expected canonical movie row to remain present after conflicting Plex import');
    assert(Number(canonicalRow?.tmdb_id || 0) === canonicalTmdbId, `Expected canonical movie TMDB id to remain unchanged, got ${JSON.stringify(canonicalRow)}`);
    assert(canonicalRow?.notes === 'Canonical Plex TMDB conflict row should stay untouched', `Expected canonical movie notes to remain unchanged, got ${JSON.stringify(canonicalRow)}`);
    assert(canonicalRow?.import_source === 'manual_seed', `Expected canonical movie import_source to remain manual_seed, got ${JSON.stringify(canonicalRow)}`);
    assert(conflictingRow && Number(conflictingRow.id || 0) !== canonicalId, `Expected conflicting Plex import to create a distinct row, got ${JSON.stringify(conflictingRow)}`);
    assert(Number(conflictingRow?.tmdb_id || 0) === conflictingImportTmdbId, `Expected conflicting Plex row TMDB id to persist, got ${JSON.stringify(conflictingRow)}`);
    assert(conflictingRow?.import_source === 'plex', `Expected conflicting Plex row import_source to be plex, got ${JSON.stringify(conflictingRow)}`);
    assert(titledMovieCount === 2, `Expected same-title conflicting Plex movies to remain separate rows, got count=${titledMovieCount}`);

    console.log(JSON.stringify({
      canonicalId,
      conflictingRowId: Number(conflictingRow.id || 0) || null,
      canonicalTmdbId: Number(canonicalRow?.tmdb_id || 0) || null,
      conflictingTmdbId: Number(conflictingRow?.tmdb_id || 0) || null,
      created: Number(summary.created || 0),
      updated: Number(summary.updated || 0),
      sameTitleRowCount: titledMovieCount,
      conflictGuarded: (
        canonicalRow?.import_source === 'manual_seed'
        && canonicalRow?.notes === 'Canonical Plex TMDB conflict row should stay untouched'
        && Number(conflictingRow.id || 0) !== canonicalId
        && Number(conflictingRow?.tmdb_id || 0) === conflictingImportTmdbId
        && titledMovieCount === 2
      )
    }, null, 2));
  } finally {
    if (fakePlex?.server) {
      await new Promise((resolve) => fakePlex.server.close(() => resolve()));
    }
    await cleanupTemporaryState({ userId, libraryId, spaceId });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
