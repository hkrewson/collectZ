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
    await pool.query('DELETE FROM event_personal_ics_sources WHERE event_id IN (SELECT id FROM events WHERE library_id = $1)', [libraryId]).catch(() => {});
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
  let body = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//collectZ smoke//sched ics//EN\r\nBEGIN:VEVENT\r\nUID:panel-1@example.test\r\nSUMMARY:Creature Design Panel\r\nDTSTART:20260724T160000Z\r\nDTEND:20260724T170000Z\r\nDTSTAMP:20260601T120000Z\r\nSEQUENCE:2\r\nLOCATION:Room 6BCF\r\nCATEGORIES:Art, Workshop\r\nDESCRIPTION:Bring sketchbook\\, questions\\, and coffee.\r\nURL:https://example.test/session/panel-1\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:signing-2@example.test\r\nSUMMARY:Artist Signing\r\nDTSTART:20260724T183000Z\r\nDTEND:20260724T190000Z\r\nLOCATION:Booth 123\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8' });
    res.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/personal.ics`,
        update(nextBody) { body = nextBody; },
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

async function main() {
  const suffix = Date.now();
  const email = `event-personal-ics-${suffix}@example.com`;
  const password = `${crypto.randomBytes(18).toString('base64url')}aA1!`;
  const client = new HttpClient('event-personal-ics-sync-smoke');
  const icsServer = await startIcsServer();
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  try {
    userId = await createDirectUser({ email, password, name: 'Event Personal ICS Smoke Admin' });
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
        title: 'Personal ICS Expo',
        url: 'https://example.com/personal-ics-expo',
        location: 'San Diego, CA',
        date_start: '2026-07-23',
        date_end: '2026-07-26'
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    const eventId = Number(eventResponse?.data?.id || 0);
    assert(eventId > 0, `Expected event id, got ${JSON.stringify(eventResponse?.data)}`);

    const savedSource = await client.request(`/api/events/${eventId}/personal-ics-source`, {
      method: 'PUT',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ feed_url: icsServer.url }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(savedSource.data.source?.has_url === true, `Expected redacted source status, got ${JSON.stringify(savedSource.data)}`);
    assert(!JSON.stringify(savedSource.data).includes(icsServer.url), 'ICS URL leaked in source response');

    const sync = await client.request(`/api/events/${eventId}/personal-ics-source/sync`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(sync.data.summary?.total === 2, `Expected two ICS items, got ${JSON.stringify(sync.data)}`);
    assert(!JSON.stringify(sync.data).includes(icsServer.url), 'ICS URL leaked in sync response');

    const plans = await client.request(`/api/events/${eventId}/schedule-plans`, { expectStatus: 200 });
    assert(plans.data.items.length === 2, `Expected two synced plans, got ${JSON.stringify(plans.data)}`);
    assert(plans.data.items.every((item) => item.source_type === 'sched_ics'), `Expected sched_ics source type, got ${JSON.stringify(plans.data)}`);
    assert(plans.data.items.some((item) => item.title === 'Creature Design Panel' && item.location === 'Room 6BCF'), `Expected parsed panel, got ${JSON.stringify(plans.data)}`);
    const panel = plans.data.items.find((item) => item.title === 'Creature Design Panel');
    assert(panel?.source_url === 'https://example.test/session/panel-1', `Expected parsed session URL, got ${JSON.stringify(panel)}`);
    assert(Array.isArray(panel?.source_categories) && panel.source_categories.includes('Workshop'), `Expected parsed categories, got ${JSON.stringify(panel)}`);
    assert(panel?.source_sequence === 2, `Expected parsed sequence, got ${JSON.stringify(panel)}`);

    await client.request(`/api/events/${eventId}/schedule-plans/${panel.id}`, {
      method: 'PATCH',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({
        status: 'backup',
        visibility: 'event_workspace',
        notes: 'Keeping as backup if the first choice is full.'
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    await client.request(`/api/events/${eventId}/personal-ics-source/sync`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' }
    });
    const resyncedPlans = await client.request(`/api/events/${eventId}/schedule-plans`, { expectStatus: 200 });
    const resyncedPanel = resyncedPlans.data.items.find((item) => item.id === panel.id);
    assert(resyncedPanel?.status === 'backup', `Expected resync to preserve user-owned status, got ${JSON.stringify(resyncedPanel)}`);
    assert(resyncedPanel?.visibility === 'event_workspace', `Expected resync to preserve user-owned visibility, got ${JSON.stringify(resyncedPanel)}`);
    assert(resyncedPanel?.notes === 'Keeping as backup if the first choice is full.', `Expected resync to preserve user-owned notes, got ${JSON.stringify(resyncedPanel)}`);

    const companion = await client.request(`/api/events/${eventId}/companion/today`, { expectStatus: 200 });
    const icsVisibility = companion.data?.sync?.personal_ics_visibility || {};
    assert(icsVisibility.connected === true, `Expected connected companion ICS visibility, got ${JSON.stringify(companion.data?.sync)}`);
    assert(icsVisibility.freshness === 'fresh', `Expected fresh companion ICS visibility, got ${JSON.stringify(companion.data?.sync)}`);
    assert(icsVisibility.manual_refresh_supported === true, `Expected manual refresh support, got ${JSON.stringify(companion.data?.sync)}`);
    assert(icsVisibility.manual_refresh_endpoint === `/api/events/${eventId}/personal-ics-source/sync`, `Expected manual refresh endpoint, got ${JSON.stringify(companion.data?.sync)}`);
    assert(icsVisibility.personal_schedule_only === true, `Expected personal schedule only marker, got ${JSON.stringify(companion.data?.sync)}`);
    assert(icsVisibility.raw_url_returned === false, `Expected raw URL marker to be false, got ${JSON.stringify(companion.data?.sync)}`);
    assert(!JSON.stringify(companion.data).includes(icsServer.url), 'ICS URL leaked in companion response');

    await client.request(`/api/events/${eventId}/personal-ics-source`, {
      method: 'DELETE',
      withCsrf: true,
      expectStatus: 200
    });
    const removedSource = await client.request(`/api/events/${eventId}/personal-ics-source`, { expectStatus: 200 });
    assert(removedSource.data.source === null, `Expected removed source, got ${JSON.stringify(removedSource.data)}`);

    console.log(JSON.stringify({
      eventId,
      sourceConnected: savedSource.data.source.has_url,
      syncedCount: sync.data.summary.total,
      schedulePlanCount: plans.data.items.length,
      companionFreshness: icsVisibility.freshness,
      urlLeaked: false
    }, null, 2));
  } finally {
    await icsServer.close().catch(() => {});
    await cleanupTemporaryState({ userId, libraryId, spaceId });
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
