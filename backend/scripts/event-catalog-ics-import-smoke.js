'use strict';

const crypto = require('crypto');
const http = require('http');
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
      this.cookies.set(firstPart.slice(0, idx).trim(), firstPart.slice(idx + 1).trim());
    }
  }

  cookieHeader() {
    return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async request(path, options = {}) {
    const { method = 'GET', body, expectStatus, withCsrf = false, headers: extraHeaders = {} } = options;
    const headers = { Accept: 'application/json', ...extraHeaders };
    if (withCsrf) {
      if (!this.csrfToken) await this.fetchCsrfToken();
      headers['x-csrf-token'] = this.csrfToken;
    }
    const cookieHeader = this.cookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;
    const response = await fetch(`${BASE_URL}${path}`, { method, headers, body });
    this.applySetCookies(response.headers);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (expectStatus !== undefined && response.status !== expectStatus) {
      throw new Error(`[${this.name}] ${method} ${path} expected ${expectStatus}, got ${response.status}. Body: ${JSON.stringify(data)}`);
    }
    return { status: response.status, data };
  }

  async fetchCsrfToken() {
    const response = await this.request('/api/auth/csrf-token', { expectStatus: 200 });
    this.csrfToken = response?.data?.csrfToken || '';
    if (!this.csrfToken) throw new Error(`[${this.name}] Missing CSRF token`);
    return this.csrfToken;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function createDirectUser({ email, password, name }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, $3, 'admin', true, NOW())
     RETURNING id`,
    [email, passwordHash, name]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

async function cleanupTemporaryState({ userId, libraryId, spaceId }) {
  if (libraryId) {
    await pool.query('DELETE FROM event_schedule_sessions WHERE event_id IN (SELECT id FROM events WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM event_schedule_plans WHERE event_id IN (SELECT id FROM events WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM events WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM library_memberships WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM libraries WHERE id = $1', [libraryId]).catch(() => {});
  }
  if (spaceId) {
    await pool.query('DELETE FROM app_integrations WHERE space_id = $1', [spaceId]).catch(() => {});
    await pool.query('DELETE FROM space_memberships WHERE space_id = $1', [spaceId]).catch(() => {});
    await pool.query('DELETE FROM spaces WHERE id = $1', [spaceId]).catch(() => {});
  }
  if (userId) await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
}

function startIcsServer() {
  let body = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//collectZ smoke//catalog ics//EN\r\nBEGIN:VEVENT\r\nUID:catalog-panel-1@example.test\r\nSUMMARY:Creature Design Panel\r\nDTSTART:20260724T160000Z\r\nDTEND:20260724T170000Z\r\nDTSTAMP:20260601T120000Z\r\nSEQUENCE:2\r\nLOCATION:Room 6BCF, San Diego Convention Center\r\nCATEGORIES:1: PROGRAMS, Art, Workshop\r\nDESCRIPTION:Bring sketchbook\\, questions\\, and coffee.\r\nURL:https://example.test/session/panel-1\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:catalog-cancelled-2@example.test\r\nSUMMARY:Cancelled Signing\r\nDTSTART:20260724T183000Z\r\nDTEND:20260724T190000Z\r\nLOCATION:Booth 123, Exhibit Hall\r\nCATEGORIES:PROGRAMMING, Signing\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8' });
    res.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/catalog.ics`,
        update(nextBody) { body = nextBody; },
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

async function main() {
  const suffix = Date.now();
  const email = `event-catalog-ics-${suffix}@example.com`;
  const password = `${crypto.randomBytes(18).toString('base64url')}aA1!`;
  const client = new HttpClient('event-catalog-ics-import-smoke');
  const icsServer = await startIcsServer();
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  try {
    userId = await createDirectUser({ email, password, name: 'Event Catalog ICS Smoke Admin' });
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
        title: 'Catalog ICS Expo',
        url: 'https://example.com/catalog-ics-expo',
        location: 'San Diego, CA',
        date_start: '2026-07-23',
        date_end: '2026-07-26'
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    const eventId = Number(eventResponse?.data?.id || 0);
    assert(eventId > 0, `Expected event id, got ${JSON.stringify(eventResponse?.data)}`);

    const imported = await client.request(`/api/events/${eventId}/schedule-sessions/import-ics`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ feed_url: icsServer.url }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(imported.data.summary?.created === 2, `Expected two created catalog sessions, got ${JSON.stringify(imported.data)}`);
    assert(!JSON.stringify(imported.data).includes(icsServer.url), 'Catalog ICS URL leaked in import response');

    const catalog = await client.request(`/api/events/${eventId}/schedule-sessions`, { expectStatus: 200 });
    assert(catalog.data.items.length === 2, `Expected two catalog sessions, got ${JSON.stringify(catalog.data)}`);
    const panel = catalog.data.items.find((item) => item.title === 'Creature Design Panel');
    assert(panel?.source_type === 'sched_catalog_ics', `Expected catalog ICS source type, got ${JSON.stringify(panel)}`);
    assert(panel?.location === 'Room 6BCF, San Diego Convention Center', `Expected preserved location, got ${JSON.stringify(panel)}`);
    assert(panel?.room === 'Room 6BCF', `Expected inferred room, got ${JSON.stringify(panel)}`);
    assert(panel?.track === 'Art', `Expected inferred track, got ${JSON.stringify(panel)}`);
    assert(Array.isArray(panel?.categories) && panel.categories.includes('Art') && panel.categories.includes('Workshop'), `Expected normalized categories, got ${JSON.stringify(panel)}`);
    assert(!panel.categories.includes('PROGRAMS'), `Expected generic provider category to be filtered out, got ${JSON.stringify(panel)}`);
    const cancelled = catalog.data.items.find((item) => item.title === 'Cancelled Signing');
    assert(cancelled?.status === 'cancelled', `Expected cancelled status, got ${JSON.stringify(cancelled)}`);

    const reimported = await client.request(`/api/events/${eventId}/schedule-sessions/import-ics`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ feed_url: icsServer.url }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(reimported.data.summary?.created === 0, `Expected idempotent reimport, got ${JSON.stringify(reimported.data)}`);
    assert(reimported.data.summary?.updated === 2, `Expected two updated catalog sessions, got ${JSON.stringify(reimported.data)}`);

    const plans = await client.request(`/api/events/${eventId}/schedule-plans`, { expectStatus: 200 });
    assert(plans.data.items.length === 0, `Catalog import must not create personal schedule plans, got ${JSON.stringify(plans.data)}`);

    console.log(JSON.stringify({
      eventId,
      imported: imported.data.summary,
      reimported: reimported.data.summary,
      catalogCount: catalog.data.items.length,
      urlLeaked: false
    }, null, 2));
  } finally {
    await cleanupTemporaryState({ userId, libraryId, spaceId });
    await icsServer.close();
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
