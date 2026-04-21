'use strict';

const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { buildMediaIdentityAliasKey } = require('../services/mediaIdentityAliases');

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

function buildMultipartCsv(csvText, filename) {
  const form = new FormData();
  form.append('file', new Blob([csvText], { type: 'text/csv' }), filename);
  return form;
}

async function main() {
  const suffix = Date.now();
  const email = `sparse-alias-reuse-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('sparse-metadata-alias-reuse-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Sparse Metadata Alias Reuse Smoke Admin',
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

    const canonicalInsert = await pool.query(
      `INSERT INTO media (
         title, media_type, format, notes, type_details, library_id, space_id, added_by, import_source
       ) VALUES (
         $1, 'book', 'Digital', $2, $3::jsonb, $4, $5, $6, 'manual_seed'
       )
       RETURNING id`,
      [
        'Sparse Alias Canonical Book',
        'Canonical row seeded with richer metadata',
        JSON.stringify({
          author: 'Sparse Smoke Author',
          provider_name: 'cwa_opds',
          provider_item_id: 'urn:uuid:sparse-canonical-entry',
          calibre_entry_id: 'urn:uuid:sparse-canonical-entry',
          isbn: '9780312863555'
        }),
        libraryId,
        spaceId,
        userId
      ]
    );
    const canonicalId = Number(canonicalInsert.rows[0]?.id || 0) || null;

    const duplicateInsert = await pool.query(
      `INSERT INTO media (
         title, media_type, format, notes, type_details, library_id, space_id, added_by, import_source
       ) VALUES (
         $1, 'book', 'Digital', $2, $3::jsonb, $4, $5, $6, 'manual_seed'
       )
       RETURNING id`,
      [
        'Sparse Alias Duplicate Book',
        'Duplicate row that will donate an alias',
        JSON.stringify({
          author: 'Sparse Smoke Author',
          provider_name: 'cwa_opds',
          provider_item_id: 'urn:uuid:sparse-duplicate-entry',
          calibre_entry_id: 'urn:uuid:sparse-duplicate-entry'
        }),
        libraryId,
        spaceId,
        userId
      ]
    );
    const duplicateId = Number(duplicateInsert.rows[0]?.id || 0) || null;
    assert(canonicalId && duplicateId, 'Expected seeded canonical and duplicate ids');

    const preview = await client.request('/api/media/merge-preview', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({
        canonical_id: canonicalId,
        duplicate_id: duplicateId
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(preview?.data?.allowed === true, 'Expected sparse alias smoke pair to be mergeable');

    const applyResponse = await client.request('/api/media/merge-apply', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({
        canonical_id: canonicalId,
        duplicate_id: duplicateId
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(applyResponse?.data?.applied === true, 'Expected manual merge apply to succeed');

    const aliasKey = buildMediaIdentityAliasKey('providerItemId', 'urn:uuid:sparse-duplicate-entry');
    const aliasRows = await pool.query(
      `SELECT "key", "value"
       FROM media_metadata
       WHERE media_id = $1
         AND "key" = $2`,
      [canonicalId, aliasKey]
    );
    assert(aliasRows.rows.length === 1, 'Expected canonical row to retain sparse duplicate provider identity alias');

    const sparseCsv = [
      'title,media_type,format,provider_name,provider_item_id',
      '"Sparse Alias Follow-up Payload","book","Digital","cwa_opds","urn:uuid:sparse-duplicate-entry"'
    ].join('\n');

    const importResponse = await client.request('/api/media/import-csv?sync=1', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: buildMultipartCsv(sparseCsv, 'sparse-metadata-alias-reuse.csv')
    });

    const summary = importResponse?.data?.summary || {};
    const auditRows = Array.isArray(importResponse?.data?.auditRows) ? importResponse.data.auditRows : [];
    const firstAuditRow = auditRows[0] || null;
    assert(Number(summary.created || 0) === 0, `Expected no created rows after sparse alias reuse import, got ${JSON.stringify(summary)}`);
    assert(Number(summary.updated || 0) === 1, `Expected one updated row after sparse alias reuse import, got ${JSON.stringify(summary)}`);
    assert(firstAuditRow?.matched_by === 'provider_item_id', `Expected provider_item_id match after sparse alias reuse import, got ${JSON.stringify(firstAuditRow)}`);

    const mediaRows = await pool.query(
      `SELECT id, title, notes, import_source, type_details
       FROM media
       WHERE library_id = $1
         AND media_type = 'book'
       ORDER BY id ASC`,
      [libraryId]
    );
    const rows = mediaRows.rows || [];
    assert(rows.length === 1, `Expected one book row after sparse alias reuse import, found ${rows.length}`);

    const canonicalRow = rows[0] || null;
    const typeDetails = canonicalRow?.type_details && typeof canonicalRow.type_details === 'object'
      ? canonicalRow.type_details
      : {};
    assert(Number(canonicalRow?.id || 0) === canonicalId, 'Expected sparse follow-up payload to reuse the canonical row');
    assert(String(canonicalRow?.title || '') === 'Sparse Alias Canonical Book', 'Expected canonical title to stay unchanged under sparse alias reuse');
    assert(String(typeDetails.author || '') === 'Sparse Smoke Author', 'Expected richer canonical author metadata to survive sparse follow-up import');
    assert(String(typeDetails.isbn || '') === '9780312863555', 'Expected richer canonical ISBN metadata to survive sparse follow-up import');

    console.log(JSON.stringify({
      applied: Boolean(applyResponse?.data?.applied),
      aliasStored: aliasRows.rows.length === 1,
      created: Number(summary.created || 0),
      updated: Number(summary.updated || 0),
      matchedBy: firstAuditRow?.matched_by || null,
      stableIdentity: 'provider_item_id_alias',
      canonicalTitle: canonicalRow?.title || null,
      canonicalImportSource: canonicalRow?.import_source || null,
      scopedBookCount: rows.length
    }, null, 2));
  } finally {
    await cleanupTemporaryState({ userId, libraryId, spaceId });
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
