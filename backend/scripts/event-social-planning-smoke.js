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
    await pool.query('DELETE FROM event_schedule_plans WHERE event_id IN (SELECT id FROM events WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM event_meetups WHERE event_id IN (SELECT id FROM events WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM event_group_members WHERE group_id IN (SELECT eg.id FROM event_groups eg JOIN events e ON e.id = eg.event_id WHERE e.library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM event_groups WHERE event_id IN (SELECT id FROM events WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM event_attendees WHERE event_id IN (SELECT id FROM events WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM event_purchased_items WHERE event_id IN (SELECT id FROM events WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM event_artifacts WHERE event_id IN (SELECT id FROM events WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM events WHERE library_id = $1', [libraryId]).catch(() => {});
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
  const email = `event-social-planning-smoke-${suffix}@example.com`;
  const password = `${crypto.randomBytes(18).toString('base64url')}aA1!`;
  const client = new HttpClient('event-social-planning-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  try {
    userId = await createDirectUser({ email, password, name: 'Event Social Planning Smoke Admin', role: 'admin' });

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
        title: 'Social Planning Expo',
        url: 'https://example.com/social-planning-expo',
        location: 'San Diego, CA',
        date_start: '2026-07-23',
        date_end: '2026-07-26',
        notes: 'Smoke event for social planning records'
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    const eventId = Number(eventResponse?.data?.id || 0);
    assert(eventId > 0, `Expected event id, got ${JSON.stringify(eventResponse?.data)}`);

    const attendee = await client.request(`/api/events/${eventId}/attendees`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: JSON.stringify({ display_name: 'Reid', relationship: 'friend', status: 'attending', visibility: 'selected_people' }),
      headers: { 'Content-Type': 'application/json' }
    });
    const attendeeId = Number(attendee?.data?.id || 0);
    assert(attendeeId > 0, `Expected attendee id, got ${JSON.stringify(attendee?.data)}`);

    const group = await client.request(`/api/events/${eventId}/groups`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: JSON.stringify({ name: 'Artist Alley Crew', visibility: 'group', attendee_ids: [attendeeId] }),
      headers: { 'Content-Type': 'application/json' }
    });
    const groupId = Number(group?.data?.id || 0);
    assert(groupId > 0, `Expected group id, got ${JSON.stringify(group?.data)}`);
    assert(group.data.members?.[0]?.id === attendeeId, `Expected group member readback, got ${JSON.stringify(group?.data)}`);

    const meetup = await client.request(`/api/events/${eventId}/meetups`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: JSON.stringify({
        title: 'Meet outside Hall H',
        group_id: groupId,
        start_at: '2026-07-23T18:00:00.000Z',
        location: 'Hall H doors',
        vendor: 'Hall H Cafe',
        booth: 'HH-12',
        location_notes: 'Meet by the left-side doors.',
        status: 'planned',
        visibility: 'group'
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    const meetupId = Number(meetup?.data?.id || 0);
    assert(meetupId > 0, `Expected meetup id, got ${JSON.stringify(meetup?.data)}`);

    const plan = await client.request(`/api/events/${eventId}/schedule-plans`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: JSON.stringify({
        title: 'Creature Design Panel',
        start_at: '2026-07-24T16:00:00.000Z',
        location: 'Room 6BCF',
        vendor: 'Panel merch table',
        booth: '6BCF-A',
        location_notes: 'Back wall after Q&A.',
        status: 'planned',
        visibility: 'selected_people',
        source_type: 'manual'
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    const planId = Number(plan?.data?.id || 0);
    assert(planId > 0, `Expected schedule plan id, got ${JSON.stringify(plan?.data)}`);

    await client.request(`/api/events/${eventId}/meetups/${meetupId}`, {
      method: 'PATCH',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ status: 'done', vendor: 'Lobby Grill', booth: 'L-5', location_notes: 'Moved to the lower lobby.', notes: 'Met and moved to dinner.' }),
      headers: { 'Content-Type': 'application/json' }
    });

    await client.request(`/api/events/${eventId}/schedule-plans/${planId}`, {
      method: 'PATCH',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ status: 'backup', visibility: 'event_workspace', vendor: 'Artist signing table', booth: '6BCF-B', location_notes: 'Queue at the rear exit.', notes: 'Backup if Hall H line is rough.' }),
      headers: { 'Content-Type': 'application/json' }
    });

    const [attendees, groups, meetups, plans, companion] = await Promise.all([
      client.request(`/api/events/${eventId}/attendees`, { expectStatus: 200 }),
      client.request(`/api/events/${eventId}/groups`, { expectStatus: 200 }),
      client.request(`/api/events/${eventId}/meetups`, { expectStatus: 200 }),
      client.request(`/api/events/${eventId}/schedule-plans`, { expectStatus: 200 }),
      client.request(`/api/events/${eventId}/companion/today`, { expectStatus: 200 })
    ]);

    assert(attendees.data.items.length === 1, `Expected one attendee, got ${JSON.stringify(attendees.data)}`);
    assert(groups.data.items[0]?.members?.length === 1, `Expected one group member, got ${JSON.stringify(groups.data)}`);
    assert(meetups.data.items[0]?.status === 'done', `Expected updated meetup status, got ${JSON.stringify(meetups.data)}`);
    assert(meetups.data.items[0]?.vendor === 'Lobby Grill', `Expected updated meetup vendor, got ${JSON.stringify(meetups.data)}`);
    assert(meetups.data.items[0]?.booth === 'L-5', `Expected updated meetup booth, got ${JSON.stringify(meetups.data)}`);
    assert(meetups.data.items[0]?.location_notes === 'Moved to the lower lobby.', `Expected updated meetup location notes, got ${JSON.stringify(meetups.data)}`);
    assert(plans.data.items[0]?.status === 'backup', `Expected updated schedule item status, got ${JSON.stringify(plans.data)}`);
    assert(plans.data.items[0]?.visibility === 'event_workspace', `Expected updated schedule item visibility, got ${JSON.stringify(plans.data)}`);
    assert(plans.data.items[0]?.vendor === 'Artist signing table', `Expected updated schedule item vendor, got ${JSON.stringify(plans.data)}`);
    assert(plans.data.items[0]?.booth === '6BCF-B', `Expected updated schedule item booth, got ${JSON.stringify(plans.data)}`);
    assert(plans.data.items[0]?.location_notes === 'Queue at the rear exit.', `Expected updated schedule item location notes, got ${JSON.stringify(plans.data)}`);
    assert(plans.data.items[0]?.notes === 'Backup if Hall H line is rough.', `Expected updated schedule item notes, got ${JSON.stringify(plans.data)}`);
    assert(companion.data?.contract?.version === 'event-social-companion.v1', `Expected companion contract version, got ${JSON.stringify(companion.data?.contract)}`);
    assert(companion.data?.counts?.attendees === 1, `Expected companion attendee count, got ${JSON.stringify(companion.data?.counts)}`);
    assert(companion.data?.counts?.groups === 1, `Expected companion group count, got ${JSON.stringify(companion.data?.counts)}`);
    assert(companion.data?.counts?.meetups === 1, `Expected companion meetup count, got ${JSON.stringify(companion.data?.counts)}`);
    assert(companion.data?.counts?.schedule_plans === 1, `Expected companion schedule count, got ${JSON.stringify(companion.data?.counts)}`);
    assert(companion.data?.sync?.freshness === 'not_connected', `Expected not-connected companion sync state, got ${JSON.stringify(companion.data?.sync)}`);
    assert(companion.data?.sync?.personal_ics_visibility?.connected === false, `Expected disconnected UI-safe ICS visibility, got ${JSON.stringify(companion.data?.sync)}`);
    assert(companion.data?.sync?.personal_ics_visibility?.raw_url_returned === false, `Expected UI-safe ICS visibility to hide raw URL, got ${JSON.stringify(companion.data?.sync)}`);
    assert(companion.data?.sync?.personal_ics_visibility?.personal_schedule_only === true, `Expected ICS visibility to be personal schedule only, got ${JSON.stringify(companion.data?.sync)}`);
    assert(companion.data?.privacy?.personal_ics_url_returned === false, `Expected companion privacy to hide ICS URL, got ${JSON.stringify(companion.data?.privacy)}`);
    assert(companion.data?.schedule_plans?.[0]?.vendor === 'Artist signing table', `Expected companion schedule vendor readback, got ${JSON.stringify(companion.data?.schedule_plans)}`);

    console.log(JSON.stringify({
      eventId,
      attendeeCount: attendees.data.items.length,
      groupCount: groups.data.items.length,
      meetupCount: meetups.data.items.length,
      schedulePlanCount: plans.data.items.length,
      updatedMeetupStatus: meetups.data.items[0]?.status || null,
      updatedSchedulePlanStatus: plans.data.items[0]?.status || null,
      companionContract: companion.data?.contract?.version || null
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
