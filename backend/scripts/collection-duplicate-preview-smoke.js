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
    const { method = 'GET', body, expectStatus, withCsrf = false } = options;
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (withCsrf) {
      await this.fetchCsrfToken();
      headers['x-csrf-token'] = this.csrfToken;
    }
    const cookieHeader = this.cookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
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

async function createCollection({ name, mediaType, expectedItemCount, sourceTitle, importSource, libraryId, spaceId, userId }) {
  const result = await pool.query(
    `INSERT INTO collections (
       name, media_type, expected_item_count, source_title, import_source, library_id, space_id, created_by
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8
     )
     RETURNING id`,
    [name, mediaType, expectedItemCount, sourceTitle, importSource, libraryId, spaceId, userId]
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
    await pool.query('DELETE FROM collection_items WHERE collection_id IN (SELECT id FROM collections WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM collections WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_merge_recommendation_feedback WHERE library_id = $1', [libraryId]).catch(() => {});
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

async function main() {
  const suffix = Date.now();
  const email = `collection-duplicate-preview-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('collection-duplicate-preview-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Collection Duplicate Preview Smoke Admin',
      role: 'admin'
    });

    const scope = await ensureUserDefaultScope(userId);
    libraryId = Number(scope?.libraryId || 0) || null;
    spaceId = Number(scope?.spaceId || 0) || null;
    assert(libraryId && spaceId, 'Expected default scope for collection duplicate preview smoke admin');

    await client.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { email, password }
    });

    const leftCollectionId = await createCollection({
      name: 'Water Monsters: 4-Movie Set',
      mediaType: 'movie',
      expectedItemCount: 4,
      sourceTitle: 'Water Monsters: 4-Movie Set',
      importSource: 'csv_generic',
      libraryId,
      spaceId,
      userId
    });
    const rightCollectionId = await createCollection({
      name: 'Water Monsters: 4-Movie Set',
      mediaType: 'movie',
      expectedItemCount: 4,
      sourceTitle: 'Water Monsters: 4-Movie Set',
      importSource: 'manual',
      libraryId,
      spaceId,
      userId
    });

    await addCollectionItem({ collectionId: leftCollectionId, containedTitle: 'Octopus 2: River of Fear', position: 1 });
    await addCollectionItem({ collectionId: leftCollectionId, containedTitle: 'Kraken: Tentacles of the Deep', position: 2 });
    await addCollectionItem({ collectionId: rightCollectionId, containedTitle: 'Octopus 2: River of Fear', position: 1 });

    const response = await client.request(`/api/media/collections/duplicate-preview?left_id=${leftCollectionId}&right_id=${rightCollectionId}`, {
      method: 'GET',
      expectStatus: 200
    });

    assert(response.data?.allowed === true, 'Expected duplicate collection preview to be allowed');
    assert(response.data?.preview?.summary === 'Matched on collection name and expected item count', 'Expected duplicate collection preview summary');
    assert(Array.isArray(response.data?.preview?.compared_fields), 'Expected compared_fields array');
    assert((response.data?.left?.items || []).length === 2, 'Expected left collection items in preview');
    assert((response.data?.right?.items || []).length === 1, 'Expected right collection items in preview');

    console.log(JSON.stringify({
      previewSummary: response.data.preview.summary,
      comparedFieldCount: response.data.preview.compared_fields.length,
      leftItems: response.data.left.items.length,
      rightItems: response.data.right.items.length
    }, null, 2));
  } finally {
    await cleanupTemporaryState({ userId, libraryId, spaceId });
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
