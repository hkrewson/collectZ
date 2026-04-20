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

async function seedRow({ title, providerItemId, libraryId, spaceId, userId }) {
  const result = await pool.query(
    `INSERT INTO media (
       title, media_type, format, type_details, library_id, space_id, added_by, import_source
     ) VALUES (
       $1, 'book', 'Digital', $2::jsonb, $3, $4, $5, 'manual_seed'
     )
     RETURNING id`,
    [
      title,
      JSON.stringify({
        author: 'Multi Hop Merge Smoke Author',
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

async function applyMerge(client, canonicalId, duplicateId) {
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
  assert(preview?.data?.allowed === true, `Expected merge preview to allow pair ${canonicalId}/${duplicateId}`);

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
  assert(applyResponse?.data?.applied === true, `Expected merge apply to succeed for pair ${canonicalId}/${duplicateId}`);
}

async function importByProviderItemId(client, providerItemId, filename) {
  const csv = [
    'title,media_type,format,author,provider_name,provider_item_id,calibre_entry_id',
    `"Multi Hop Reimported ${providerItemId}","book","Digital","Multi Hop Merge Smoke Author","cwa_opds","${providerItemId}","${providerItemId}"`
  ].join('\n');

  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), filename);

  const importResponse = await client.request('/api/media/import-csv?sync=1', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 200,
    body: form
  });
  const summary = importResponse?.data?.summary || {};
  const firstAuditRow = Array.isArray(importResponse?.data?.auditRows) ? importResponse.data.auditRows[0] || null : null;
  assert(Number(summary.created || 0) === 0, `Expected no created rows for provider item ${providerItemId}, got ${JSON.stringify(summary)}`);
  assert(Number(summary.updated || 0) === 1, `Expected one updated row for provider item ${providerItemId}, got ${JSON.stringify(summary)}`);
  assert(firstAuditRow?.matched_by === 'provider_item_id', `Expected provider_item_id match for provider item ${providerItemId}, got ${JSON.stringify(firstAuditRow)}`);
  return {
    created: Number(summary.created || 0),
    updated: Number(summary.updated || 0),
    matchedBy: firstAuditRow?.matched_by || null
  };
}

async function main() {
  const suffix = Date.now();
  const email = `manual-merge-multi-hop-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('manual-merge-multi-hop-identity-alias-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  const firstProviderItemId = 'urn:uuid:first-hop-entry';
  const secondProviderItemId = 'urn:uuid:second-hop-entry';
  const finalProviderItemId = 'urn:uuid:final-hop-entry';

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Manual Merge Multi Hop Alias Smoke Admin',
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

    const firstCanonicalId = await seedRow({
      title: 'Multi Hop Canonical A',
      providerItemId: firstProviderItemId,
      libraryId,
      spaceId,
      userId
    });
    const secondDuplicateId = await seedRow({
      title: 'Multi Hop Duplicate B',
      providerItemId: secondProviderItemId,
      libraryId,
      spaceId,
      userId
    });
    const finalCanonicalId = await seedRow({
      title: 'Multi Hop Canonical C',
      providerItemId: finalProviderItemId,
      libraryId,
      spaceId,
      userId
    });
    assert(firstCanonicalId && secondDuplicateId && finalCanonicalId, 'Expected three seeded ids for multi-hop smoke');

    await applyMerge(client, firstCanonicalId, secondDuplicateId);
    await applyMerge(client, finalCanonicalId, firstCanonicalId);

    const firstAliasKey = buildMediaIdentityAliasKey('providerItemId', firstProviderItemId);
    const secondAliasKey = buildMediaIdentityAliasKey('providerItemId', secondProviderItemId);
    const aliasRows = await pool.query(
      `SELECT "key", "value"
         FROM media_metadata
        WHERE media_id = $1
          AND "key" IN ($2, $3)
        ORDER BY "key" ASC`,
      [finalCanonicalId, firstAliasKey, secondAliasKey]
    );
    assert(aliasRows.rows.length === 2, `Expected final canonical to retain first and second hop aliases, got ${JSON.stringify(aliasRows.rows)}`);

    const firstImport = await importByProviderItemId(client, firstProviderItemId, 'multi-hop-first.csv');
    const secondImport = await importByProviderItemId(client, secondProviderItemId, 'multi-hop-second.csv');

    const finalRow = await pool.query(
      `SELECT id, import_source, type_details
         FROM media
        WHERE id = $1`,
      [finalCanonicalId]
    );
    const scopedCountResult = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM media
        WHERE library_id = $1
          AND media_type = 'book'`,
      [libraryId]
    );
    const scopedCount = Number(scopedCountResult.rows[0]?.count || 0);
    assert(scopedCount === 1, `Expected one scoped book row after multi-hop merges and reimports, found ${scopedCount}`);

    console.log(JSON.stringify({
      firstImport,
      secondImport,
      aliasKeys: aliasRows.rows.map((entry) => entry.key),
      finalCanonicalId,
      finalImportSource: finalRow.rows[0]?.import_source || null,
      scopedCount
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
