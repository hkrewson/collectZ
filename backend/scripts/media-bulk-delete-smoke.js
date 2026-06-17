#!/usr/bin/env node

'use strict';

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db/pool');
const { ensureUserDefaultScope } = require('../services/libraries');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const BULK_COUNT = Number(process.env.MEDIA_BULK_DELETE_SMOKE_COUNT || 205);

class HttpClient {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
    this.csrfToken = '';
  }

  applySetCookies(headers) {
    const raw = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [];
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
    return Array.from(this.cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  async request(path, options = {}) {
    const {
      method = 'GET',
      body,
      expectStatus,
      withCsrf = false
    } = options;

    const headers = { Accept: 'application/json' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (withCsrf) {
      if (!this.csrfToken) await this.fetchCsrfToken();
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
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (expectStatus !== undefined && response.status !== expectStatus) {
      throw new Error(
        `[${this.name}] ${method} ${path} expected ${expectStatus}, got ${response.status}. Body: ${JSON.stringify(parsed)}`
      );
    }
    return { status: response.status, data: parsed };
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

async function createDirectUser({ email, password, name }) {
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, $3, 'user', true, NOW())
     RETURNING id`,
    [email, passwordHash, name]
  );
  return result.rows[0];
}

async function seedMediaRows({ userId, libraryId, spaceId, count }) {
  const result = await pool.query(
    `INSERT INTO media (title, media_type, format, added_by, library_id, space_id, import_source)
     SELECT 'Bulk Delete Smoke ' || gs::text, 'movie', 'DVD', $1, $2, $3, 'bulk_delete_smoke'
     FROM generate_series(1, $4::int) AS gs
     RETURNING id`,
    [userId, libraryId, spaceId, count]
  );
  return result.rows.map((row) => Number(row.id));
}

async function cleanup({ userId, libraryId, spaceId }) {
  if (Number.isFinite(Number(userId)) && Number(userId) > 0) {
    await pool.query('DELETE FROM media WHERE added_by = $1', [userId]).catch(() => {});
    await pool.query('DELETE FROM library_memberships WHERE user_id = $1', [userId]).catch(() => {});
    await pool.query('DELETE FROM space_memberships WHERE user_id = $1', [userId]).catch(() => {});
  }
  if (Number.isFinite(Number(libraryId)) && Number(libraryId) > 0) {
    await pool.query('DELETE FROM libraries WHERE id = $1 AND created_by = $2', [libraryId, userId]).catch(() => {});
  }
  if (Number.isFinite(Number(spaceId)) && Number(spaceId) > 0) {
    await pool.query('DELETE FROM spaces WHERE id = $1 AND created_by = $2', [spaceId, userId]).catch(() => {});
  }
  if (Number.isFinite(Number(userId)) && Number(userId) > 0) {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
  }
}

async function main() {
  assert(BULK_COUNT >= 200, `MEDIA_BULK_DELETE_SMOKE_COUNT must be at least 200, got ${BULK_COUNT}`);
  const suffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const email = `bulk-delete-smoke-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('bulk-delete');
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  try {
    const user = await createDirectUser({ email, password, name: 'Bulk Delete Smoke' });
    userId = Number(user.id);
    const scope = await ensureUserDefaultScope(userId);
    libraryId = Number(scope.libraryId);
    spaceId = Number(scope.spaceId);
    assert(libraryId > 0, 'Expected default library for smoke user');

    await client.fetchCsrfToken();
    await client.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { email, password }
    });
    await client.fetchCsrfToken();

    const ids = await seedMediaRows({ userId, libraryId, spaceId, count: BULK_COUNT });
    assert(ids.length === BULK_COUNT, `Expected ${BULK_COUNT} seeded rows, got ${ids.length}`);

    const before = await pool.query('SELECT COUNT(*)::int AS count FROM media WHERE id = ANY($1::int[])', [ids]);
    assert(Number(before.rows[0]?.count || 0) === BULK_COUNT, 'Expected all seeded rows before bulk delete');

    const response = await client.request('/api/media/bulk-delete', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { ids }
    });
    assert(response.data?.requested_count === BULK_COUNT, `Expected requested_count ${BULK_COUNT}, got ${JSON.stringify(response.data)}`);
    assert(response.data?.deleted_count === BULK_COUNT, `Expected deleted_count ${BULK_COUNT}, got ${JSON.stringify(response.data)}`);
    assert(response.data?.skipped_count === 0, `Expected skipped_count 0, got ${JSON.stringify(response.data)}`);
    assert(response.data?.failed_count === 0, `Expected failed_count 0, got ${JSON.stringify(response.data)}`);
    assert(Array.isArray(response.data?.deleted_ids) && response.data.deleted_ids.length === BULK_COUNT, 'Expected deleted_ids for all rows');

    const after = await pool.query('SELECT COUNT(*)::int AS count FROM media WHERE id = ANY($1::int[])', [ids]);
    assert(Number(after.rows[0]?.count || 0) === 0, 'Expected seeded rows to be deleted');

    const loginAfterBulk = await client.request('/api/auth/me', { expectStatus: 200 });
    const sessionUser = loginAfterBulk.data?.user || loginAfterBulk.data;
    assert(
      Number(sessionUser?.id) === userId,
      `Expected session to remain usable after bulk delete, got ${JSON.stringify(loginAfterBulk.data)}`
    );

    console.log(JSON.stringify({
      ok: true,
      requested: BULK_COUNT,
      deleted: response.data.deleted_count,
      endpoint: '/api/media/bulk-delete'
    }, null, 2));
  } finally {
    await cleanup({ userId, libraryId, spaceId });
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
