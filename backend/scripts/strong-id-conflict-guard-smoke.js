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

async function seedBookRow({ title, year, notes, isbn, providerItemId, libraryId, spaceId, userId }) {
  const result = await pool.query(
    `INSERT INTO media (
       title, media_type, year, format, notes, type_details, library_id, space_id, added_by, import_source
     ) VALUES (
       $1, 'book', $2, 'Hardcover', $3, $4::jsonb, $5, $6, $7, 'manual_seed'
     )
     RETURNING id`,
    [
      title,
      year,
      notes,
      JSON.stringify({
        author: 'Conflict Guard Smoke Author',
        isbn,
        provider_name: 'cwa_opds',
        provider_item_id: providerItemId,
        calibre_entry_id: providerItemId
      }),
      libraryId,
      spaceId,
      userId
    ]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

function buildCsvImportBody({ title, year, notes, isbn, providerItemId }) {
  return [
    'title,media_type,year,format,author,isbn,notes,provider_name,provider_item_id,calibre_entry_id',
    `"${title}","book","${year}","Paperback","Conflict Guard Smoke Author","${isbn}","${notes}","cwa_opds","${providerItemId}","${providerItemId}"`
  ].join('\n');
}

async function runConflictingImport(client, { title, year, notes, isbn, providerItemId, filename }) {
  const form = new FormData();
  form.append(
    'file',
    new Blob([buildCsvImportBody({ title, year, notes, isbn, providerItemId })], { type: 'text/csv' }),
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
  assert(Number(summary.created || 0) === 1, `Expected conflicting strong-id import to create a new row, got ${JSON.stringify(summary)}`);
  assert(Number(summary.updated || 0) === 0, `Expected conflicting strong-id import to avoid updating the canonical row, got ${JSON.stringify(summary)}`);
  assert(firstAuditRow?.match_mode === 'strong_identifier_conflict_guarded', `Expected conflicting strong-id import to record the guard path, got ${JSON.stringify(firstAuditRow)}`);
  assert(firstAuditRow?.matched_by === 'title_year_media_type', `Expected conflicting strong-id import to label the blocked title fallback candidate, got ${JSON.stringify(firstAuditRow)}`);

  return {
    created: Number(summary.created || 0),
    updated: Number(summary.updated || 0),
    matchedBy: firstAuditRow?.matched_by || null,
    matchMode: firstAuditRow?.match_mode || null
  };
}

async function fetchRow(mediaId) {
  const result = await pool.query(
    `SELECT id, title, year, notes, import_source, type_details
       FROM media
      WHERE id = $1
      LIMIT 1`,
    [mediaId]
  );
  return result.rows[0] || null;
}

async function findConflictingRowByIsbn(libraryId, isbn) {
  const result = await pool.query(
    `SELECT id, title, year, notes, import_source, type_details
       FROM media
      WHERE library_id = $1
        AND COALESCE(type_details->>'isbn', '') = $2
      ORDER BY id DESC
      LIMIT 1`,
    [libraryId, isbn]
  );
  return result.rows[0] || null;
}

async function countLibraryBooks(libraryId, title) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM media
      WHERE library_id = $1
        AND media_type = 'book'
        AND title = $2`,
    [libraryId, title]
  );
  return Number(result.rows[0]?.count || 0);
}

async function main() {
  const suffix = Date.now();
  const email = `strong-id-conflict-guard-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('strong-id-conflict-guard-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  const title = `Conflict Title ${suffix}`;
  const year = 2024;
  const canonicalIsbn = '9781401207927';
  const mergedDuplicateIsbn = '9781401207928';
  const conflictingImportIsbn = '9781401207929';

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Strong Identifier Conflict Guard Smoke User',
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

    const canonicalId = await seedBookRow({
      title,
      year,
      notes: 'Canonical merged row should stay untouched',
      isbn: canonicalIsbn,
      providerItemId: 'urn:uuid:conflict-guard-canonical',
      libraryId,
      spaceId,
      userId
    });
    const duplicateId = await seedBookRow({
      title: `${title} merged duplicate`,
      year,
      notes: 'Duplicate merged into canonical before conflict import',
      isbn: mergedDuplicateIsbn,
      providerItemId: 'urn:uuid:conflict-guard-duplicate',
      libraryId,
      spaceId,
      userId
    });
    assert(canonicalId && duplicateId, 'Expected seeded canonical and duplicate ids');

    const mergeResult = await runManualMediaMergeApply({
      canonicalId,
      duplicateId,
      mergeEvidence: {
        action: 'manual_merge',
        source: 'strong_identifier_conflict_guard_smoke',
        rationale: 'Seed merged canonical before conflicting same-title import'
      }
    });
    assert(mergeResult?.attached === 1, 'Expected merged canonical precondition to be applied');

    const importResult = await runConflictingImport(client, {
      title,
      year,
      notes: 'Conflicting same-title import should create a separate row',
      isbn: conflictingImportIsbn,
      providerItemId: 'urn:uuid:conflict-guard-import',
      filename: 'strong-id-conflict-guard.csv'
    });

    const canonicalRow = await fetchRow(canonicalId);
    const conflictingRow = await findConflictingRowByIsbn(libraryId, conflictingImportIsbn);
    const titledBookCount = await countLibraryBooks(libraryId, title);

    assert(canonicalRow, 'Expected canonical row to remain present after conflicting import');
    assert(String(canonicalRow?.type_details?.isbn || '') === canonicalIsbn, `Expected canonical ISBN to remain unchanged, got ${JSON.stringify(canonicalRow)}`);
    assert(canonicalRow?.notes === 'Canonical merged row should stay untouched', `Expected canonical notes to remain unchanged, got ${JSON.stringify(canonicalRow)}`);
    assert(canonicalRow?.import_source === 'manual_seed', `Expected canonical import_source to remain manual_seed, got ${JSON.stringify(canonicalRow)}`);
    assert(conflictingRow && Number(conflictingRow.id || 0) !== canonicalId, `Expected conflicting import to create a distinct row, got ${JSON.stringify(conflictingRow)}`);
    assert(conflictingRow?.notes === 'Conflicting same-title import should create a separate row', `Expected conflicting row notes to come from import, got ${JSON.stringify(conflictingRow)}`);
    assert(conflictingRow?.import_source === 'csv_generic', `Expected conflicting row import_source to be csv_generic, got ${JSON.stringify(conflictingRow)}`);
    assert(titledBookCount === 2, `Expected same-title conflicting books to remain separate rows, got count=${titledBookCount}`);

    console.log(JSON.stringify({
      canonicalId,
      conflictingRowId: Number(conflictingRow.id || 0) || null,
      canonicalIsbn: canonicalRow?.type_details?.isbn || null,
      conflictingIsbn: conflictingRow?.type_details?.isbn || null,
      created: importResult.created,
      updated: importResult.updated,
      matchedBy: importResult.matchedBy,
      matchMode: importResult.matchMode,
      sameTitleRowCount: titledBookCount,
      conflictGuarded: (
        canonicalRow?.import_source === 'manual_seed'
        && canonicalRow?.notes === 'Canonical merged row should stay untouched'
        && Number(conflictingRow.id || 0) !== canonicalId
        && titledBookCount === 2
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
