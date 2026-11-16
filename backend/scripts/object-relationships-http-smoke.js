#!/usr/bin/env node
'use strict';

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db/pool');
const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class HttpClient {
  constructor() { this.cookies = new Map(); }
  applyCookies(headers) {
    const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const value of values) {
      const pair = String(value).split(';')[0];
      const separator = pair.indexOf('=');
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
  cookieHeader() {
    return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
  }
  async request(pathname, { method = 'GET', body, csrf = false, expected } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;
    if (csrf) {
      const tokenResponse = await this.request('/api/auth/csrf-token', { expected: 200 });
      headers['x-csrf-token'] = tokenResponse.data.csrfToken;
      headers.cookie = this.cookieHeader();
    }
    const response = await fetch(`${BASE_URL}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    this.applyCookies(response.headers);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (expected !== undefined && response.status !== expected) {
      throw new Error(`${method} ${pathname} expected ${expected}, got ${response.status}`);
    }
    return { status: response.status, data };
  }
}

async function main() {
  const suffix = crypto.randomBytes(8).toString('hex');
  const email = `object-relationship-http-${suffix}@example.invalid`;
  const password = `Smoke-${crypto.randomBytes(18).toString('hex')}`;
  let userId;
  let spaceId;
  const libraryIds = [];
  const mediaIds = [];
  let relationshipId;
  try {
    userId = Number((await pool.query(
      `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
       VALUES ($1, $2, 'Object relationship HTTP smoke', 'admin', true, NOW()) RETURNING id`,
      [email, await bcrypt.hash(password, 12)]
    )).rows[0].id);
    spaceId = Number((await pool.query(
      `INSERT INTO spaces (name, slug, created_by, is_personal)
       VALUES ($1, $2, $3, false) RETURNING id`,
      [`Object relationship HTTP ${suffix}`, `object-relationship-http-${suffix}`, userId]
    )).rows[0].id);
    await pool.query(
      `INSERT INTO space_memberships (space_id, user_id, role, created_by)
       VALUES ($1, $2, 'owner', $2)`,
      [spaceId, userId]
    );
    for (let index = 1; index <= 2; index += 1) {
      const libraryId = Number((await pool.query(
        'INSERT INTO libraries (space_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
        [spaceId, `Object relationship HTTP library ${index}`, userId]
      )).rows[0].id);
      libraryIds.push(libraryId);
      await pool.query(
        `INSERT INTO library_memberships (user_id, library_id, role) VALUES ($1, $2, 'owner')`,
        [userId, libraryId]
      );
      const mediaId = Number((await pool.query(
        `INSERT INTO media (title, media_type, library_id, space_id, added_by)
         VALUES ($1, 'book', $2, $3, $4) RETURNING id`,
        [`Object relationship HTTP media ${index}`, libraryId, spaceId, userId]
      )).rows[0].id);
      mediaIds.push(mediaId);
    }
    await pool.query(
      'UPDATE users SET active_space_id = $2, active_library_id = $3 WHERE id = $1',
      [userId, spaceId, libraryIds[0]]
    );

    const client = new HttpClient();
    await client.request('/api/auth/login', { method: 'POST', body: { email, password }, expected: 200 });
    const created = await client.request(`/api/object-relationships/media/${mediaIds[0]}`, {
      method: 'POST',
      csrf: true,
      body: {
        target_type: 'media',
        target_id: mediaIds[1],
        relationship_type: 'companion_to',
        label: `HTTP relationship ${suffix}`
      },
      expected: 201
    });
    relationshipId = Number(created.data?.relationship?.id || 0);
    assert(relationshipId, 'Object relationship create did not return an id');
    assert(Number(created.data?.relationship?.target?.owner_id) === mediaIds[1], 'Cross-library target was not preserved');

    const listed = await client.request(`/api/object-relationships/media/${mediaIds[0]}`, { expected: 200 });
    assert(listed.data?.relationships?.length === 1, 'Object relationship list did not return the created row');

    const archived = await client.request(`/api/object-relationships/media/${mediaIds[0]}/${relationshipId}`, {
      method: 'DELETE',
      csrf: true,
      expected: 200
    });
    assert(archived.data?.archived === true, 'Object relationship archive did not report success');
    const readback = await withAuthorizedScopeTransaction(
      pool,
      { spaceId, libraryId: null },
      userId,
      (db) => db.query('SELECT archived_at IS NOT NULL AS archived FROM object_relationships WHERE id = $1', [relationshipId])
    );
    assert(readback.rows[0]?.archived === true, 'Object relationship archive was not committed');

    console.log(JSON.stringify({
      status: 'passed',
      checks: ['authenticated cross-library create', 'scoped relationship list', 'scoped archive', 'committed protected readback']
    }, null, 2));
  } finally {
    const failures = [];
    const cleanup = async (label, work) => {
      try { await work(); } catch { failures.push(label); }
    };
    if (relationshipId && userId && spaceId) await cleanup('relationship cleanup', () =>
      withAuthorizedScopeTransaction(pool, { spaceId, libraryId: null }, userId, (db) =>
        db.query('DELETE FROM object_relationships WHERE id = $1', [relationshipId])));
    if (mediaIds.length) await cleanup('media cleanup', () =>
      pool.query('DELETE FROM media WHERE id = ANY($1::int[])', [mediaIds]));
    if (libraryIds.length) {
      await cleanup('library membership cleanup', () =>
        pool.query('DELETE FROM library_memberships WHERE library_id = ANY($1::int[])', [libraryIds]));
      await cleanup('library cleanup', () =>
        pool.query('DELETE FROM libraries WHERE id = ANY($1::int[])', [libraryIds]));
    }
    if (spaceId) {
      await cleanup('space membership cleanup', () => pool.query('DELETE FROM space_memberships WHERE space_id = $1', [spaceId]));
      await cleanup('space cleanup', () => pool.query('DELETE FROM spaces WHERE id = $1', [spaceId]));
    }
    if (userId) await cleanup('user cleanup', () => pool.query('DELETE FROM users WHERE id = $1', [userId]));
    await pool.end().catch(() => {});
    if (failures.length) throw new Error(`Fixture cleanup failed: ${failures.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(`Object relationship HTTP smoke failed: ${error.message}`);
  process.exitCode = 1;
});
