'use strict';

const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { runManualMediaMergeApply } = require('./repair-book-comic-duplicates');

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
    await pool.query('DELETE FROM media_merge_recommendation_feedback WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_repair_history WHERE canonical_media_id IN (SELECT id FROM media WHERE library_id = $1) OR duplicate_media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
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

async function seedMovieRow({ title, year, notes, director, runtime, upc, tmdbId, libraryId, spaceId, userId }) {
  const result = await pool.query(
    `INSERT INTO media (
       title, media_type, year, format, director, runtime, upc, tmdb_id, tmdb_media_type, notes, type_details, library_id, space_id, added_by, import_source
     ) VALUES (
       $1, 'movie', $2, 'Blu-ray', $3, $4, $5, $6, 'movie', $7, $8::jsonb, $9, $10, $11, 'manual_seed'
     )
     RETURNING id`,
    [
      title,
      year,
      director,
      runtime,
      upc,
      tmdbId,
      notes,
      JSON.stringify({
        edition: 'Strong ID Movie Conflict Guard Smoke'
      }),
      libraryId,
      spaceId,
      userId
    ]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

function buildCsvImportBody({ title, year, notes, director, runtime, upc, tmdbId }) {
  return [
    'title,media_type,year,format,director,runtime,upc,tmdb_id,notes',
    `"${title}","movie","${year}","Blu-ray","${director}","${runtime}","${upc}","${tmdbId}","${notes}"`
  ].join('\n');
}

async function runConflictingImport(client, { title, year, notes, director, runtime, upc, tmdbId, filename }) {
  const form = new FormData();
  form.append(
    'file',
    new Blob([buildCsvImportBody({ title, year, notes, director, runtime, upc, tmdbId })], { type: 'text/csv' }),
    filename
  );

  const response = await client.request('/api/media/import-csv?sync=1', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 200,
    body: form
  });

  const summary = response?.data?.summary || {};
  const firstAuditRow = Array.isArray(response?.data?.auditRows) ? response.data.auditRows[0] || null : null;
  assert(Number(summary.created || 0) === 1, `Expected conflicting movie import to create a new row, got ${JSON.stringify(summary)}`);
  assert(Number(summary.updated || 0) === 0, `Expected conflicting movie import to avoid updating the canonical row, got ${JSON.stringify(summary)}`);
  assert(firstAuditRow?.match_mode === 'strong_identifier_conflict_guarded', `Expected conflicting movie import to record the guard path, got ${JSON.stringify(firstAuditRow)}`);
  assert(firstAuditRow?.matched_by === 'title_year_media_type', `Expected conflicting movie import to label the blocked title fallback candidate, got ${JSON.stringify(firstAuditRow)}`);

  return {
    created: Number(summary.created || 0),
    updated: Number(summary.updated || 0),
    matchedBy: firstAuditRow?.matched_by || null,
    matchMode: firstAuditRow?.match_mode || null
  };
}

async function fetchRow(mediaId) {
  const result = await pool.query(
    `SELECT id, title, year, notes, import_source, director, runtime, upc, tmdb_id
       FROM media
      WHERE id = $1
      LIMIT 1`,
    [mediaId]
  );
  return result.rows[0] || null;
}

async function findConflictingMovieRow(libraryId, { title, notes, upc }) {
  const result = await pool.query(
    `SELECT id, title, year, notes, import_source, director, runtime, upc, tmdb_id
       FROM media
      WHERE library_id = $1
        AND title = $2
        AND notes = $3
        AND COALESCE(upc, '') = $4
      ORDER BY id DESC
      LIMIT 1`,
    [libraryId, title, notes, upc]
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
  const email = `strong-id-movie-conflict-guard-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('strong-id-movie-conflict-guard-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  const title = `Conflict Movie ${suffix}`;
  const year = 2024;
  const canonicalUpc = '111111111111';
  const mergedDuplicateUpc = '222222222222';
  const conflictingImportUpc = '333333333333';
  const canonicalTmdbId = 910001;
  const mergedDuplicateTmdbId = 910002;
  const conflictingImportTmdbId = 910003;

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Strong Identifier Movie Conflict Guard Smoke User',
      role: 'user'
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

    const canonicalId = await seedMovieRow({
      title,
      year,
      notes: 'Canonical movie row should stay untouched',
      director: 'Conflict Guard Director',
      runtime: 123,
      upc: canonicalUpc,
      tmdbId: canonicalTmdbId,
      libraryId,
      spaceId,
      userId
    });
    const duplicateId = await seedMovieRow({
      title: `${title} merged duplicate`,
      year,
      notes: 'Duplicate movie merged into canonical before conflict import',
      director: 'Conflict Guard Director',
      runtime: 124,
      upc: mergedDuplicateUpc,
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
        source: 'strong_identifier_movie_conflict_guard_smoke',
        rationale: 'Seed merged canonical movie before conflicting same-title import'
      }
    });
    assert(mergeResult?.attached === 1, 'Expected merged canonical movie precondition to be applied');

    const importResult = await runConflictingImport(client, {
      title,
      year,
      notes: 'Conflicting same-title movie import should create a separate row',
      director: 'Conflict Guard Director',
      runtime: 125,
      upc: conflictingImportUpc,
      tmdbId: conflictingImportTmdbId,
      filename: 'strong-id-movie-conflict-guard.csv'
    });

    const canonicalRow = await fetchRow(canonicalId);
    const conflictingRow = await findConflictingMovieRow(libraryId, {
      title,
      notes: 'Conflicting same-title movie import should create a separate row',
      upc: conflictingImportUpc,
    });
    const titledMovieCount = await countLibraryMovies(libraryId, title);

    assert(canonicalRow, 'Expected canonical movie row to remain present after conflicting import');
    assert(String(canonicalRow?.upc || '') === canonicalUpc, `Expected canonical movie UPC to remain unchanged, got ${JSON.stringify(canonicalRow)}`);
    assert(Number(canonicalRow?.tmdb_id || 0) === canonicalTmdbId, `Expected canonical movie TMDB id to remain unchanged, got ${JSON.stringify(canonicalRow)}`);
    assert(canonicalRow?.notes === 'Canonical movie row should stay untouched', `Expected canonical movie notes to remain unchanged, got ${JSON.stringify(canonicalRow)}`);
    assert(canonicalRow?.import_source === 'manual_seed', `Expected canonical movie import_source to remain manual_seed, got ${JSON.stringify(canonicalRow)}`);
    assert(conflictingRow && Number(conflictingRow.id || 0) !== canonicalId, `Expected conflicting movie import to create a distinct row, got ${JSON.stringify(conflictingRow)}`);
    assert(conflictingRow?.notes === 'Conflicting same-title movie import should create a separate row', `Expected conflicting movie row notes to come from import, got ${JSON.stringify(conflictingRow)}`);
    assert(conflictingRow?.import_source === 'csv_generic', `Expected conflicting movie row import_source to be csv_generic, got ${JSON.stringify(conflictingRow)}`);
    assert(titledMovieCount === 2, `Expected same-title conflicting movies to remain separate rows, got count=${titledMovieCount}`);

    console.log(JSON.stringify({
      canonicalId,
      conflictingRowId: Number(conflictingRow.id || 0) || null,
      canonicalUpc: canonicalRow?.upc || null,
      conflictingUpc: conflictingRow?.upc || null,
      canonicalTmdbId: Number(canonicalRow?.tmdb_id || 0) || null,
      conflictingTmdbId: Number(conflictingRow?.tmdb_id || 0) || null,
      created: importResult.created,
      updated: importResult.updated,
      matchedBy: importResult.matchedBy,
      matchMode: importResult.matchMode,
      sameTitleRowCount: titledMovieCount,
      conflictGuarded: (
        canonicalRow?.import_source === 'manual_seed'
        && canonicalRow?.notes === 'Canonical movie row should stay untouched'
        && Number(conflictingRow.id || 0) !== canonicalId
        && titledMovieCount === 2
      )
    }, null, 2));
  } finally {
    await cleanupTemporaryState({ userId, libraryId, spaceId });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
