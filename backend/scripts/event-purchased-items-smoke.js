'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');

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
    return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
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
    await pool.query('DELETE FROM event_purchased_items WHERE event_id IN (SELECT id FROM events WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM event_artifacts WHERE event_id IN (SELECT id FROM events WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM events WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM art_items WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM collectibles WHERE library_id = $1', [libraryId]).catch(() => {});
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
  const email = `event-purchased-items-smoke-${suffix}@example.com`;
  const password = `Passw0rd!${crypto.randomBytes(6).toString('hex')}`;
  const client = new HttpClient('event-purchased-items-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Event Purchased Items Smoke Admin',
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

    const eventResponse = await client.request('/api/events', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: JSON.stringify({
        title: 'Native Art Contract Expo',
        url: 'https://example.com/native-art-contract-expo',
        location: 'Chicago, IL',
        date_start: '2026-04-25',
        date_end: '2026-04-26',
        notes: 'Smoke event for purchased item links'
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    const eventId = Number(eventResponse?.data?.id || 0);
    assert(eventId > 0, `Expected event id, got ${JSON.stringify(eventResponse?.data)}`);

    const artResponse = await client.request('/api/art', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: JSON.stringify({
        title: 'Bast',
        artist: 'Nigel Sade',
        series: 'Croyance',
        vendor: 'Studio Sade',
        booth: 'A12',
        price: 250,
        notes: 'Bridge art item for native art dual-write verification'
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    const artCollectibleId = Number(artResponse?.data?.id || 0);
    assert(artCollectibleId > 0, `Expected art collectible id, got ${JSON.stringify(artResponse?.data)}`);

    const nativeArtRow = await pool.query(
      `SELECT id, source_collectible_id, title, artist, series, vendor, booth
       FROM art_items
       WHERE source_collectible_id = $1
         AND archived_at IS NULL
       LIMIT 1`,
      [artCollectibleId]
    );
    const nativeArtId = Number(nativeArtRow.rows[0]?.id || 0);
    assert(nativeArtId > 0, 'Expected art route create to dual-write a native art row');

    const collectibleResponse = await client.request('/api/collectibles', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: JSON.stringify({
        title: 'Convention Exclusive Figure',
        category_key: 'figures_statues',
        vendor: 'Booth Forge',
        booth: 'B20',
        price: 65,
        exclusive: true
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    const collectibleId = Number(collectibleResponse?.data?.id || 0);
    assert(collectibleId > 0, `Expected collectible id, got ${JSON.stringify(collectibleResponse?.data)}`);

    const linkedArt = await client.request(`/api/events/${eventId}/purchased-items`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: JSON.stringify({ item_type: 'art', item_id: nativeArtId }),
      headers: { 'Content-Type': 'application/json' }
    });
    const linkedCollectible = await client.request(`/api/events/${eventId}/purchased-items`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: JSON.stringify({ item_type: 'collectible', item_id: collectibleId }),
      headers: { 'Content-Type': 'application/json' }
    });

    const listResponse = await client.request(`/api/events/${eventId}/purchased-items`, { expectStatus: 200 });
    const items = Array.isArray(listResponse?.data?.items) ? listResponse.data.items : [];
    assert(items.length === 2, `Expected 2 purchased items, got ${JSON.stringify(listResponse?.data)}`);
    const artLink = items.find((item) => item.item_type === 'art');
    const collectibleLink = items.find((item) => item.item_type === 'collectible');
    assert(artLink?.resolved_item?.title === 'Bast', 'Expected art purchased-item link to resolve native art details');
    assert(collectibleLink?.resolved_item?.title === 'Convention Exclusive Figure', 'Expected collectible purchased-item link to resolve collectible details');

    await client.request(`/api/events/${eventId}/purchased-items/${linkedArt.data.id}`, {
      method: 'PATCH',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ vendor_snapshot: 'Studio Sade Booth' }),
      headers: { 'Content-Type': 'application/json' }
    });

    await client.request(`/api/events/${eventId}/purchased-items/${linkedCollectible.data.id}`, {
      method: 'DELETE',
      withCsrf: true,
      expectStatus: 200
    });

    const activePurchasedItems = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM event_purchased_items
       WHERE event_id = $1
         AND archived_at IS NULL`,
      [eventId]
    );

    console.log(JSON.stringify({
      eventId,
      artCollectibleId,
      nativeArtId,
      purchasedItemCount: items.length,
      remainingActivePurchasedItems: Number(activePurchasedItems.rows[0]?.total || 0),
      artResolvedTitle: artLink?.resolved_item?.title || null,
      collectibleResolvedTitle: collectibleLink?.resolved_item?.title || null
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
