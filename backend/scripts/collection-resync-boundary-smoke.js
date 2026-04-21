'use strict';

const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { ensureUserDefaultScope } = require('../services/libraries');

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

async function createCollection({ name, mediaType, expectedItemCount, sourceTitle, importSource, metadata = {}, libraryId, spaceId, userId }) {
  const result = await pool.query(
    `INSERT INTO collections (
       name, media_type, expected_item_count, source_title, import_source, metadata, library_id, space_id, created_by
     ) VALUES (
       $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9
     )
     RETURNING id`,
    [name, mediaType, expectedItemCount, sourceTitle, importSource, JSON.stringify(metadata || {}), libraryId, spaceId, userId]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

async function addCollectionItem({ collectionId, containedTitle, position }) {
  const result = await pool.query(
    `INSERT INTO collection_items (collection_id, contained_title, position, resolution_status)
     VALUES ($1, $2, $3, 'pending')
     RETURNING id`,
    [collectionId, containedTitle, position]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

async function cleanupTemporaryState({ userId, libraryId, spaceId }) {
  if (libraryId) {
    await pool.query('DELETE FROM collection_merge_history WHERE canonical_collection_id IN (SELECT id FROM collections WHERE library_id = $1) OR duplicate_collection_id IN (SELECT id FROM collections WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM collection_items WHERE collection_id IN (SELECT id FROM collections WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM collections WHERE library_id = $1', [libraryId]).catch(() => {});
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

function buildMultipartCsv(csvText, filename) {
  const form = new FormData();
  form.append('file', new Blob([csvText], { type: 'text/csv' }), filename);
  return form;
}

async function fetchCollectionRow(collectionId) {
  const result = await pool.query(
    `SELECT id, name, source_title, import_source, metadata
       FROM collections
      WHERE id = $1
      LIMIT 1`,
    [collectionId]
  );
  return result.rows[0] || null;
}

async function main() {
  const suffix = Date.now();
  const email = `collection-resync-boundary-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('collection-resync-boundary-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  const canonicalTitle = 'Ocean Nightmares Anthology';
  const duplicateImportTitle = 'Ocean Nightmares: 4-Movie Set';

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Collection Re-Sync Boundary Smoke Admin',
      role: 'admin'
    });

    const scope = await ensureUserDefaultScope(userId);
    libraryId = Number(scope?.libraryId || 0) || null;
    spaceId = Number(scope?.spaceId || 0) || null;
    assert(libraryId && spaceId, 'Expected default scope for collection re-sync smoke admin');

    await client.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ email, password }),
      headers: { 'Content-Type': 'application/json' }
    });
    await client.fetchCsrfToken();

    const canonicalCollectionId = await createCollection({
      name: canonicalTitle,
      mediaType: 'movie',
      expectedItemCount: 4,
      sourceTitle: canonicalTitle,
      importSource: 'manual',
      libraryId,
      spaceId,
      userId
    });
    const duplicateCollectionId = await createCollection({
      name: canonicalTitle,
      mediaType: 'movie',
      expectedItemCount: 4,
      sourceTitle: duplicateImportTitle,
      importSource: 'csv_generic',
      metadata: {
        detectedBy: 'title_pattern'
      },
      libraryId,
      spaceId,
      userId
    });

    await addCollectionItem({ collectionId: canonicalCollectionId, containedTitle: 'Shark of the Reef', position: 1 });
    await addCollectionItem({ collectionId: duplicateCollectionId, containedTitle: 'Tentacles from Below', position: 1 });

    const applyResponse = await client.request('/api/media/collections/merge-apply', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({
        canonical_id: canonicalCollectionId,
        duplicate_id: duplicateCollectionId
      }),
      headers: { 'Content-Type': 'application/json' }
    });

    assert(applyResponse.data?.applied === true, 'Expected collection merge apply to succeed');
    assert(Number(applyResponse.data?.result?.moved_item_count || 0) === 1, 'Expected one duplicate collection item to move into the canonical collection');

    const canonicalAfterApply = await fetchCollectionRow(canonicalCollectionId);
    const aliasEntries = Array.isArray(canonicalAfterApply?.metadata?.import_collection_aliases)
      ? canonicalAfterApply.metadata.import_collection_aliases
      : [];
    const aliasStored = aliasEntries.some((entry) => (
      String(entry?.source_title || '') === duplicateImportTitle
      && String(entry?.import_source || '') === 'csv_generic'
      && String(entry?.media_type || '') === 'movie'
    ));
    assert(aliasStored, `Expected merged canonical collection to preserve the absorbed csv alias, got ${JSON.stringify(canonicalAfterApply)}`);

    const csv = [
      'title,media_type,notes',
      `"${duplicateImportTitle}","movie","Includes: Shark of the Reef | Tentacles from Below | Leviathan Rising"`
    ].join('\n');

    const importResponse = await client.request('/api/media/import-csv?sync=1', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: buildMultipartCsv(csv, 'collection-resync-boundary.csv'),
      headers: {
        'x-valuation-refresh-mode': 'fixture'
      }
    });

    const summary = importResponse?.data?.summary || {};
    const auditRow = Array.isArray(importResponse?.data?.auditRows) ? importResponse.data.auditRows[0] || null : null;
    assert(Number(summary.collectionsDetected || 0) === 1, `Expected one collection detected on re-sync, got ${JSON.stringify(summary)}`);
    assert(Number(summary.collectionsCreated || 0) === 0, `Expected re-sync to avoid recreating a duplicate collection, got ${JSON.stringify(summary)}`);
    assert(Number(summary.collectionItemsSeeded || 0) >= 1, `Expected collection re-sync to resolve collection items onto the canonical collection, got ${JSON.stringify(summary)}`);
    assert(Number(summary.skipped_collection || 0) === 1, `Expected collection-only import row to remain collection-only, got ${JSON.stringify(summary)}`);
    assert(auditRow?.status === 'skipped_collection', `Expected collection-only audit row, got ${JSON.stringify(auditRow)}`);

    const collectionCount = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM collections
        WHERE library_id = $1
          AND media_type = 'movie'`,
      [libraryId]
    );
    const scopedCollectionCount = Number(collectionCount.rows[0]?.count || 0);
    assert(scopedCollectionCount === 1, `Expected one collection row after collection re-sync, found ${scopedCollectionCount}`);

    const canonicalItems = await pool.query(
      `SELECT COUNT(*)::int AS item_count
         FROM collection_items
        WHERE collection_id = $1`,
      [canonicalCollectionId]
    );
    const canonicalItemCount = Number(canonicalItems.rows[0]?.item_count || 0);
    assert(canonicalItemCount === 3, `Expected canonical collection to hold three items after re-sync, found ${canonicalItemCount}`);

    const newContainedItem = await pool.query(
      `SELECT 1
         FROM collection_items
        WHERE collection_id = $1
          AND contained_title = $2
        LIMIT 1`,
      [canonicalCollectionId, 'Leviathan Rising']
    );
    assert(Boolean(newContainedItem.rows[0]), 'Expected later collection-shaped re-sync to land a new contained item on the canonical collection');

    console.log(JSON.stringify({
      applied: applyResponse.data.applied,
      aliasStored,
      collectionsCreated: Number(summary.collectionsCreated || 0),
      collectionItemsSeeded: Number(summary.collectionItemsSeeded || 0),
      skippedCollectionRows: Number(summary.skipped_collection || 0),
      canonicalCollectionId,
      canonicalItemCount,
      scopedCollectionCount
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
