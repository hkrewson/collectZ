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
  constructor() {
    this.cookies = new Map();
  }

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
  const email = `exclusive-source-http-${suffix}@example.invalid`;
  const password = `Smoke-${crypto.randomBytes(18).toString('hex')}`;
  const marker = `Exclusive source HTTP ${suffix}`;
  let userId;
  let spaceId;
  let libraryId;
  let eventId;
  let sourceId;
  let promotedWantedItemId;
  try {
    userId = Number((await pool.query(
      `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
       VALUES ($1, $2, 'Exclusive source HTTP smoke', 'admin', true, NOW()) RETURNING id`,
      [email, await bcrypt.hash(password, 12)]
    )).rows[0].id);
    spaceId = Number((await pool.query(
      `INSERT INTO spaces (name, slug, created_by, is_personal, events_enabled)
       VALUES ($1, $2, $3, false, true) RETURNING id`,
      [marker, `exclusive-source-http-${suffix}`, userId]
    )).rows[0].id);
    await pool.query(
      `INSERT INTO space_memberships (space_id, user_id, role, created_by)
       VALUES ($1, $2, 'owner', $2)`,
      [spaceId, userId]
    );
    libraryId = Number((await pool.query(
      'INSERT INTO libraries (space_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
      [spaceId, marker, userId]
    )).rows[0].id);
    await pool.query(
      `INSERT INTO library_memberships (user_id, library_id, role) VALUES ($1, $2, 'owner')`,
      [userId, libraryId]
    );
    await pool.query(
      'UPDATE users SET active_space_id = $2, active_library_id = $3 WHERE id = $1',
      [userId, spaceId, libraryId]
    );
    eventId = Number((await pool.query(
      `INSERT INTO events (library_id, space_id, created_by, title, url, location, date_start)
       VALUES ($1, $2, $3, $4, $5, 'Test venue', CURRENT_DATE) RETURNING id`,
      [libraryId, spaceId, userId, marker, `https://example.invalid/event/${suffix}`]
    )).rows[0].id);
    sourceId = Number((await withAuthorizedScopeTransaction(
      pool,
      { spaceId, libraryId },
      userId,
      (client) => client.query(
        `INSERT INTO event_exclusive_sources
           (event_id, provider, provider_key, source_url, source_title, metadata,
            library_id, space_id, created_by)
         VALUES ($1, 'http-smoke', $2, $3, $4, '{}'::jsonb, $5, $6, $7)
         RETURNING id`,
        [eventId, suffix, `https://example.invalid/source/${suffix}`, marker, libraryId, spaceId, userId]
      )
    )).rows[0].id);

    const client = new HttpClient();
    await client.request('/api/auth/login', { method: 'POST', body: { email, password }, expected: 200 });
    const listed = await client.request(`/api/events/${eventId}/exclusive-sources`, { expected: 200 });
    assert(listed.data?.items?.length === 1, 'Exclusive source list did not return the scoped fixture');
    assert(Number(listed.data.items[0]?.id) === sourceId, 'Exclusive source list returned the wrong row');

    const reviewed = await client.request(`/api/events/${eventId}/exclusive-sources/${sourceId}`, {
      method: 'PATCH',
      csrf: true,
      body: { status: 'reviewed' },
      expected: 200
    });
    assert(reviewed.data?.item?.status === 'reviewed', 'Exclusive source review status was not committed');

    const promoted = await client.request(`/api/events/${eventId}/exclusive-sources/${sourceId}/promote`, {
      method: 'POST',
      csrf: true,
      body: { target: 'wishlist' },
      expected: 201
    });
    promotedWantedItemId = Number(promoted.data?.promoted?.id || 0) || null;
    assert(promotedWantedItemId, 'Exclusive source promotion did not return a wishlist target');
    const readback = await withAuthorizedScopeTransaction(
      pool,
      { spaceId, libraryId },
      userId,
      (db) => db.query(
        `SELECT status, promoted_wanted_item_id
           FROM event_exclusive_sources WHERE id = $1`,
        [sourceId]
      )
    );
    assert(readback.rows[0]?.status === 'promoted', 'Promotion status was not committed');
    assert(Number(readback.rows[0]?.promoted_wanted_item_id) === promotedWantedItemId, 'Promotion target was not linked');

    console.log(JSON.stringify({
      status: 'passed',
      checks: ['authenticated list', 'scoped status update', 'atomic wishlist promotion', 'committed protected readback']
    }, null, 2));
  } finally {
    const failures = [];
    const cleanup = async (label, work) => {
      try { await work(); } catch { failures.push(label); }
    };
    if (sourceId && userId && spaceId && libraryId) await cleanup('source cleanup', () =>
      withAuthorizedScopeTransaction(pool, { spaceId, libraryId }, userId, (db) =>
        db.query('DELETE FROM event_exclusive_sources WHERE id = $1', [sourceId])));
    if (promotedWantedItemId) await cleanup('wishlist cleanup', () =>
      pool.query('DELETE FROM wanted_items WHERE id = $1', [promotedWantedItemId]));
    if (eventId) await cleanup('event cleanup', () => pool.query('DELETE FROM events WHERE id = $1', [eventId]));
    if (libraryId) {
      await cleanup('library membership cleanup', () => pool.query('DELETE FROM library_memberships WHERE library_id = $1', [libraryId]));
      await cleanup('library cleanup', () => pool.query('DELETE FROM libraries WHERE id = $1', [libraryId]));
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
  console.error(`Event exclusive-source HTTP smoke failed: ${error.message}`);
  process.exitCode = 1;
});
