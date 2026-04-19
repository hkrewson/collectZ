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

async function cleanupTemporaryState({ userId, libraryId, spaceId }) {
  if (libraryId) {
    await pool.query('DELETE FROM media_repair_history WHERE canonical_media_id IN (SELECT id FROM media WHERE library_id = $1) OR duplicate_media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_metadata WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_variants WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_genres WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_directors WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_actors WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
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

async function createMediaRow({ title, mediaType, typeDetails = {}, year = null, libraryId, spaceId, userId, importSource = 'manual' }) {
  const result = await pool.query(
    `INSERT INTO media (
       title, media_type, format, year, type_details, library_id, space_id, added_by, import_source
     ) VALUES (
       $1, $2, 'Digital', $3, $4::jsonb, $5, $6, $7, $8
     )
     RETURNING id`,
    [title, mediaType, year, JSON.stringify(typeDetails || {}), libraryId, spaceId, userId, importSource]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

async function main() {
  const suffix = Date.now();
  const email = `manual-merge-revert-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('manual-merge-revert-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Manual Merge Revert Smoke Admin',
      role: 'admin'
    });

    const scope = await ensureUserDefaultScope(userId);
    libraryId = Number(scope?.libraryId || 0) || null;
    spaceId = Number(scope?.spaceId || 0) || null;
    assert(libraryId && spaceId, 'Expected default scope for manual merge revert smoke admin');

    await client.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { email, password }
    });

    const canonicalId = await createMediaRow({
      title: 'Wool',
      mediaType: 'book',
      typeDetails: {
        isbn: '9780358447849',
        author: 'Hugh Howey'
      },
      libraryId,
      spaceId,
      userId,
      importSource: 'csv_generic'
    });

    const duplicateId = await createMediaRow({
      title: 'Wool',
      mediaType: 'book',
      typeDetails: {
        isbn: '9780358447849',
        author: 'Hugh Howey'
      },
      libraryId,
      spaceId,
      userId,
      importSource: 'manual'
    });

    const applyResponse = await client.request('/api/media/merge-apply', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: {
        canonical_id: canonicalId,
        duplicate_id: duplicateId
      }
    });

    assert(applyResponse.data?.applied === true, 'Expected manual merge apply to succeed before revert');
    assert(Number(applyResponse.data?.merge_details?.summary?.active_merge_count || 0) === 1, 'Expected one active merge after apply');

    const revertResponse = await client.request('/api/media/merge-revert', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: {
        canonical_id: canonicalId,
        duplicate_id: duplicateId
      }
    });

    assert(revertResponse.data?.reverted === true, 'Expected manual merge revert to succeed');
    assert(Number(revertResponse.data?.merge_details?.summary?.active_merge_count || 0) === 0, 'Expected active merge count to return to zero after revert');
    assert(Number(revertResponse.data?.duplicate?.id || 0) === duplicateId, 'Expected reverted duplicate to be visible again');

    console.log(JSON.stringify({
      reverted: revertResponse.data.reverted,
      activeMergeCount: Number(revertResponse.data?.merge_details?.summary?.active_merge_count || 0),
      restoredDuplicateId: Number(revertResponse.data?.duplicate?.id || 0)
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
