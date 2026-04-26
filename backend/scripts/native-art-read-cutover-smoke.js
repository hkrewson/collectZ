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
  const email = `native-art-read-cutover-smoke-${suffix}@example.com`;
  const password = `Passw0rd!${crypto.randomBytes(6).toString('hex')}`;
  const client = new HttpClient('native-art-read-cutover-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Native Art Read Cutover Smoke Admin',
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
        title: 'Native Art Read Cutover Expo',
        url: 'https://example.com/native-art-read-cutover-expo',
        location: 'Chicago, IL',
        date_start: '2026-04-25'
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
        event_id: eventId,
        vendor: 'Studio Sade',
        booth: 'A12',
        price: 250,
        exclusive: true,
        notes: 'Read cutover smoke item'
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    const nativeArtPublicId = Number(artResponse?.data?.id || 0);
    assert(nativeArtPublicId > 0, `Expected native art id, got ${JSON.stringify(artResponse?.data)}`);

    const nativeArtRow = await pool.query(
      `SELECT id, source_collectible_id, title, artist, series, vendor, booth, price, exclusive
       FROM art_items
       WHERE id = $1
         AND source_collectible_id IS NULL
         AND archived_at IS NULL
       LIMIT 1`,
      [nativeArtPublicId]
    );
    const nativeArt = nativeArtRow.rows[0] || null;
    const nativeArtId = Number(nativeArt?.id || 0);
    assert(nativeArtId > 0, 'Expected art route create to create a native-only art row');

    const detailResponse = await client.request(`/api/art/${nativeArtPublicId}`, { expectStatus: 200 });
    const detail = detailResponse?.data || {};
    assert(Number(detail.id) === nativeArtPublicId, `Expected detail id ${nativeArtPublicId}, got ${detail.id}`);
    assert(Number(detail.native_art_id) === nativeArtId, `Expected native_art_id ${nativeArtId}, got ${detail.native_art_id}`);
    assert(detail.source_collectible_id === null, 'Expected new Art create to avoid source_collectible_id bridge rows');
    assert(detail.title === 'Bast', `Expected detail title Bast, got ${detail.title}`);
    assert(detail.series === 'Croyance', `Expected detail series Croyance, got ${detail.series}`);
    assert(detail.artist === 'Nigel Sade', `Expected detail artist Nigel Sade, got ${detail.artist}`);
    assert(detail.vendor === 'Studio Sade', `Expected detail vendor Studio Sade, got ${detail.vendor}`);
    assert(detail.booth === 'A12', `Expected detail booth A12, got ${detail.booth}`);

    const updatedResponse = await client.request(`/api/art/${nativeArtPublicId}`, {
      method: 'PATCH',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({
        medium: 'print',
        signed: true,
        notes: 'Updated native-only smoke item'
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    const updatedDetail = updatedResponse?.data || {};
    assert(updatedDetail.source_collectible_id === null, 'Expected native-only Art update to avoid bridge rows');
    assert(updatedDetail.medium === 'print', `Expected updated medium print, got ${updatedDetail.medium}`);
    assert(updatedDetail.signed === true, `Expected updated signed true, got ${updatedDetail.signed}`);

    const listResponse = await client.request('/api/art?q=Bast&series=Croyance&vendor=Studio&booth=A12&exclusive=true', { expectStatus: 200 });
    const listItems = Array.isArray(listResponse?.data?.items) ? listResponse.data.items : [];
    const listed = listItems.find((item) => Number(item.id) === nativeArtPublicId);
    assert(listed, `Expected list response to include native art id ${nativeArtPublicId}, got ${JSON.stringify(listResponse?.data)}`);
    assert(Number(listed.native_art_id) === nativeArtId, `Expected listed native_art_id ${nativeArtId}, got ${listed.native_art_id}`);
    assert(listed.category === null, 'Expected native art list response to avoid collectible category');
    assert(listed.item_type === 'art', `Expected listed item_type art, got ${listed.item_type}`);

    const collectibleListResponse = await client.request('/api/collectibles?q=Bast&limit=50', { expectStatus: 200 });
    const collectibleListItems = Array.isArray(collectibleListResponse?.data?.items) ? collectibleListResponse.data.items : [];
    assert(
      !collectibleListItems.some((item) => Number(item.id) === nativeArtPublicId || String(item?.subtype || item?.item_type || '') === 'art'),
      `Expected Collectibles list to exclude Art rows, got ${JSON.stringify(collectibleListResponse?.data)}`
    );

    await client.request('/api/collectibles', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 400,
      body: JSON.stringify({
        title: 'Collectible Route Art Reject',
        subtype: 'art'
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    await client.request('/api/art/categories', { expectStatus: 404 });
    await client.request(`/api/collectibles/${nativeArtPublicId}`, {
      method: 'PATCH',
      withCsrf: true,
      expectStatus: 404,
      body: JSON.stringify({ title: 'Collectible Route Should Not Patch Art' }),
      headers: { 'Content-Type': 'application/json' }
    });

    const eventFilteredResponse = await client.request(`/api/art?event_id=${eventId}`, { expectStatus: 200 });
    const eventFilteredItems = Array.isArray(eventFilteredResponse?.data?.items) ? eventFilteredResponse.data.items : [];
    const eventFiltered = eventFilteredItems.find((item) => Number(item.id) === nativeArtPublicId);
    assert(eventFiltered, `Expected event filtered art response to include ${nativeArtPublicId}`);
    assert(Number(eventFiltered.purchased_item_id || 0) > 0, 'Expected event-filtered native art row to include purchased_item_id');

    const deleteResponse = await client.request('/api/art', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: JSON.stringify({
        title: 'Native Delete Smoke',
        artist: 'Cleanup Artist'
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    const deleteArtId = Number(deleteResponse?.data?.id || 0);
    assert(deleteArtId > 0, `Expected delete smoke native art id, got ${JSON.stringify(deleteResponse?.data)}`);
    await client.request(`/api/art/${deleteArtId}`, {
      method: 'DELETE',
      withCsrf: true,
      expectStatus: 200
    });
    await client.request(`/api/art/${deleteArtId}`, { expectStatus: 404 });
    const deletedNative = await pool.query(
      `SELECT archived_at, source_collectible_id
       FROM art_items
       WHERE id = $1
       LIMIT 1`,
      [deleteArtId]
    );
    assert(deletedNative.rows[0]?.archived_at, 'Expected native-only Art delete to archive art_items row');
    assert(deletedNative.rows[0]?.source_collectible_id === null, 'Expected native-only Art delete smoke row to avoid collectible bridge');

    console.log(JSON.stringify({
      nativeArtPublicId,
      nativeArtId,
      eventId,
      listCount: listItems.length,
      eventFilteredCount: eventFilteredItems.length,
      deleteArtId,
      detailTitle: detail.title,
      detailSeries: detail.series,
      detailVendor: detail.vendor,
      detailBooth: detail.booth
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
