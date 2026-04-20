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

async function cleanupTemporaryState({ userId, libraryIds = [], spaceIds = [] }) {
  const uniqueLibraryIds = [...new Set((libraryIds || []).map((value) => Number(value || 0)).filter(Boolean))];
  const uniqueSpaceIds = [...new Set((spaceIds || []).map((value) => Number(value || 0)).filter(Boolean))];

  for (const libraryId of uniqueLibraryIds) {
    await pool.query('DELETE FROM media_merge_recommendation_feedback WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_repair_history WHERE canonical_media_id IN (SELECT id FROM media WHERE library_id = $1) OR duplicate_media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_metadata WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM collection_items WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM library_memberships WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM libraries WHERE id = $1', [libraryId]).catch(() => {});
  }

  for (const spaceId of uniqueSpaceIds) {
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

async function seedRow({ title, notes, providerItemId, libraryId, spaceId, userId }) {
  const result = await pool.query(
    `INSERT INTO media (
       title, media_type, format, notes, type_details, library_id, space_id, added_by, import_source
     ) VALUES (
       $1, 'book', 'Digital', $2, $3::jsonb, $4, $5, $6, 'manual_seed'
     )
     RETURNING id`,
    [
      title,
      notes,
      JSON.stringify({
        author: 'Scope Isolation Smoke Author',
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

async function applyMerge(canonicalId, duplicateId) {
  const applyResponse = await runManualMediaMergeApply({
    canonicalId,
    duplicateId,
    mergeEvidence: {
      action: 'manual_merge',
      source: 'scope_isolation_smoke',
      rationale: 'Seed merged scope-A canonical before isolated re-sync proof'
    }
  });
  assert(applyResponse?.attached === 1, `Expected direct merge helper to attach duplicate ${duplicateId} into canonical ${canonicalId}`);
}

function buildCsvImportBody({ title, notes, providerItemId }) {
  return [
    'title,media_type,format,author,notes,provider_name,provider_item_id,calibre_entry_id',
    `"${title}","book","Digital","Scope Isolation Smoke Author","${notes}","cwa_opds","${providerItemId}","${providerItemId}"`
  ].join('\n');
}

async function runScopedImport(client, { title, notes, providerItemId, filename }) {
  const form = new FormData();
  form.append('file', new Blob([buildCsvImportBody({ title, notes, providerItemId })], { type: 'text/csv' }), filename);

  const response = await client.request('/api/media/import-csv?sync=1', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 200,
    body: form
  });
  const summary = response?.data?.summary || {};
  const firstAuditRow = Array.isArray(response?.data?.auditRows) ? response.data.auditRows[0] || null : null;

  assert(Number(summary.created || 0) === 0, `Expected scoped re-sync to avoid creates, got ${JSON.stringify(summary)}`);
  assert(Number(summary.updated || 0) === 1, `Expected scoped re-sync to update one row, got ${JSON.stringify(summary)}`);
  assert(firstAuditRow?.matched_by === 'provider_item_id', `Expected scoped re-sync to match by provider_item_id, got ${JSON.stringify(firstAuditRow)}`);

  return {
    created: Number(summary.created || 0),
    updated: Number(summary.updated || 0),
    matchedBy: firstAuditRow?.matched_by || null
  };
}

async function fetchRow(mediaId) {
  const result = await pool.query(
    `SELECT id, library_id, space_id, title, notes, import_source
       FROM media
      WHERE id = $1
      LIMIT 1`,
    [mediaId]
  );
  return result.rows[0] || null;
}

async function countLibraryBooks(libraryId) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM media
      WHERE library_id = $1
        AND media_type = 'book'`,
    [libraryId]
  );
  return Number(result.rows[0]?.count || 0);
}

async function main() {
  const suffix = Date.now();
  const email = `manual-merge-scope-isolation-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('manual-merge-scope-isolation-resync-smoke');
  let userId = null;
  let scopeALibraryId = null;
  let scopeASpaceId = null;
  let scopeBLibraryId = null;

  const sharedProviderItemId = 'urn:uuid:scope-shared-entry';

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Manual Merge Scope Isolation Smoke User',
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

    const scopeA = await fetchScopeContext(client);
    scopeALibraryId = scopeA.libraryId;
    scopeASpaceId = scopeA.spaceId;

    const canonicalId = await seedRow({
      title: `Scope A Canonical ${suffix}`,
      notes: 'Scope A canonical seed',
      providerItemId: 'urn:uuid:scope-canonical-entry',
      libraryId: scopeALibraryId,
      spaceId: scopeASpaceId,
      userId
    });
    const duplicateId = await seedRow({
      title: `Scope A Duplicate ${suffix}`,
      notes: 'Scope A duplicate seed',
      providerItemId: sharedProviderItemId,
      libraryId: scopeALibraryId,
      spaceId: scopeASpaceId,
      userId
    });
    assert(canonicalId && duplicateId, 'Expected scope A canonical and duplicate ids');

    await applyMerge(canonicalId, duplicateId);

    const libraryB = await client.request('/api/libraries', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: JSON.stringify({
        name: `Scope Isolation Library ${suffix}`,
        description: 'Secondary library for scope isolation smoke'
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    scopeBLibraryId = Number(libraryB?.data?.id || 0) || null;
    assert(scopeBLibraryId, `Expected secondary library id, got ${JSON.stringify(libraryB?.data)}`);

    const scopeBRowId = await seedRow({
      title: `Scope B Existing ${suffix}`,
      notes: 'Scope B untouched marker',
      providerItemId: sharedProviderItemId,
      libraryId: scopeBLibraryId,
      spaceId: scopeASpaceId,
      userId
    });
    assert(scopeBRowId, 'Expected scope B overlapping-id row');

    await client.request('/api/libraries/select', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ library_id: scopeALibraryId }),
      headers: { 'Content-Type': 'application/json' }
    });

    const scopeAImport = await runScopedImport(client, {
      title: `Scope A Reimported ${suffix}`,
      notes: 'Imported into Scope A',
      providerItemId: sharedProviderItemId,
      filename: 'scope-a-resync.csv'
    });

    const scopeARowAfterImport = await fetchRow(canonicalId);
    const scopeBRowAfterScopeAImport = await fetchRow(scopeBRowId);
    assert(scopeARowAfterImport?.import_source === 'csv_generic', `Expected scope A canonical import_source to update, got ${JSON.stringify(scopeARowAfterImport)}`);
    assert(scopeARowAfterImport?.notes === 'Imported into Scope A', `Expected scope A canonical notes to update, got ${JSON.stringify(scopeARowAfterImport)}`);
    assert(scopeBRowAfterScopeAImport?.import_source === 'manual_seed', `Expected scope B row to stay untouched after scope A re-sync, got ${JSON.stringify(scopeBRowAfterScopeAImport)}`);
    assert(scopeBRowAfterScopeAImport?.notes === 'Scope B untouched marker', `Expected scope B notes to stay untouched after scope A re-sync, got ${JSON.stringify(scopeBRowAfterScopeAImport)}`);

    await client.request('/api/libraries/select', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ library_id: scopeBLibraryId }),
      headers: { 'Content-Type': 'application/json' }
    });

    const scopeBImport = await runScopedImport(client, {
      title: `Scope B Reimported ${suffix}`,
      notes: 'Imported into Scope B',
      providerItemId: sharedProviderItemId,
      filename: 'scope-b-resync.csv'
    });

    const scopeARowAfterScopeBImport = await fetchRow(canonicalId);
    const scopeBRowAfterImport = await fetchRow(scopeBRowId);
    assert(scopeARowAfterScopeBImport?.notes === 'Imported into Scope A', `Expected scope A canonical to remain unchanged after scope B re-sync, got ${JSON.stringify(scopeARowAfterScopeBImport)}`);
    assert(scopeBRowAfterImport?.import_source === 'csv_generic', `Expected scope B row import_source to update, got ${JSON.stringify(scopeBRowAfterImport)}`);
    assert(scopeBRowAfterImport?.notes === 'Imported into Scope B', `Expected scope B notes to update, got ${JSON.stringify(scopeBRowAfterImport)}`);

    const scopeACount = await countLibraryBooks(scopeALibraryId);
    const scopeBCount = await countLibraryBooks(scopeBLibraryId);
    assert(scopeACount === 1, `Expected one book in scope A after merge and re-sync, got ${scopeACount}`);
    assert(scopeBCount === 1, `Expected one book in scope B after isolated re-sync, got ${scopeBCount}`);

    console.log(JSON.stringify({
      scopeA: {
        libraryId: scopeALibraryId,
        canonicalId,
        created: scopeAImport.created,
        updated: scopeAImport.updated,
        matchedBy: scopeAImport.matchedBy,
        notes: scopeARowAfterImport?.notes || null,
        importSource: scopeARowAfterImport?.import_source || null,
        scopedBookCount: scopeACount
      },
      scopeB: {
        libraryId: scopeBLibraryId,
        mediaId: scopeBRowId,
        created: scopeBImport.created,
        updated: scopeBImport.updated,
        matchedBy: scopeBImport.matchedBy,
        notes: scopeBRowAfterImport?.notes || null,
        importSource: scopeBRowAfterImport?.import_source || null,
        scopedBookCount: scopeBCount
      },
      isolationPreserved: (
        scopeBRowAfterScopeAImport?.notes === 'Scope B untouched marker'
        && scopeARowAfterScopeBImport?.notes === 'Imported into Scope A'
      )
    }, null, 2));
  } finally {
    await cleanupTemporaryState({
      userId,
      libraryIds: [scopeALibraryId, scopeBLibraryId],
      spaceIds: [scopeASpaceId]
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
