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
    await pool.query('DELETE FROM event_schedule_notifications WHERE event_id IN (SELECT id FROM events WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM event_schedule_sessions WHERE event_id IN (SELECT id FROM events WHERE library_id = $1)', [libraryId]).catch(() => {});
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
      body: JSON.stringify({ display_name: 'Reid', relationship: 'friend', link_current_user: true, status: 'attending', visibility: 'selected_people' }),
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

    const catalogSession = await client.request(`/api/events/${eventId}/schedule-sessions`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: JSON.stringify({
        title: 'How to Draw Dragons',
        start_at: '2026-07-24T18:00:00.000Z',
        end_at: '2026-07-24T19:00:00.000Z',
        location: 'Room 6A',
        room: '6A',
        description: 'Catalog-only drawing workshop.',
        track: 'Art',
        categories: ['Art', 'Workshop'],
        source_type: 'manual',
        source_ref: 'catalog-dragon-1',
        source_url: 'https://example.test/catalog/dragon',
        source_updated_at: '2026-06-01T12:00:00.000Z'
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    const catalogSessionId = Number(catalogSession?.data?.id || 0);
    assert(catalogSessionId > 0, `Expected schedule catalog session id, got ${JSON.stringify(catalogSession?.data)}`);

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

    const changePreview = await client.request(`/api/events/${eventId}/schedule-change-preview`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({
        schedule_plan_id: planId,
        requested_status: 'planned',
        requested_visibility: 'event_workspace'
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(changePreview.data?.contract?.version === 'event-schedule-change-preview.v1', `Expected schedule change preview contract, got ${JSON.stringify(changePreview.data)}`);
    assert(changePreview.data?.contract?.preview_only === true, `Expected preview-only schedule change contract, got ${JSON.stringify(changePreview.data)}`);
    assert(changePreview.data?.contract?.delivery_supported === false, `Expected no delivery support in preview contract, got ${JSON.stringify(changePreview.data)}`);
    assert(changePreview.data?.recipients?.summary?.attendee_count === 1, `Expected one preview attendee recipient, got ${JSON.stringify(changePreview.data)}`);
    assert(changePreview.data?.recipients?.summary?.group_count === 1, `Expected one preview group recipient, got ${JSON.stringify(changePreview.data)}`);
    assert(changePreview.data?.subject?.schedule_plan_id === planId, `Expected preview subject plan id, got ${JSON.stringify(changePreview.data)}`);
    assert(changePreview.data?.requested_change?.status === 'planned', `Expected requested preview status, got ${JSON.stringify(changePreview.data)}`);
    assert(changePreview.data?.recipients?.attendees?.[0]?.user_id === userId, `Expected preview attendee linked user id, got ${JSON.stringify(changePreview.data)}`);

    const deliveryBoundary = await client.request(`/api/events/${eventId}/schedule-notification-delivery-boundary`, {
      expectStatus: 200
    });
    assert(deliveryBoundary.data?.contract?.version === 'event-schedule-notification-delivery-boundary.v1', `Expected notification delivery boundary contract, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.contract?.scope === 'event_local', `Expected event-local delivery boundary, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.contract?.external_delivery_supported === false, `Expected external delivery disabled in boundary, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.provider_contract?.version === 'event-schedule-notification-provider-prep.v1', `Expected notification provider prep contract, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.provider_contract?.active_provider === 'event_local', `Expected event_local active provider, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.provider_contract?.external_delivery_attempts_created === false, `Expected no external delivery attempts, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.provider_contract?.delivery_attempt_record_supported === true, `Expected local delivery attempt records to be supported, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.provider_contract?.delivery_attempt_endpoint === `/api/events/${eventId}/schedule-notification-delivery-attempts`, `Expected delivery attempt endpoint, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.delivery_attempt_model?.version === 'event-schedule-notification-delivery-attempt-model.v1', `Expected delivery attempt model contract, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.delivery_attempt_model?.supported === true, `Expected delivery attempt model to be enabled for local audit records, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.delivery_attempt_model?.creates_records === true, `Expected local delivery attempt records, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.delivery_attempt_model?.relationship === 'one_attempt_per_notification_recipient_provider', `Expected recipient-provider attempt relationship, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.delivery_attempt_model?.status_values?.includes('queued'), `Expected queued attempt status, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.delivery_attempt_model?.field_contract?.provider_message_id === 'string | null', `Expected provider message id field contract, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.capabilities?.send_local_records === true, `Expected local send records supported, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.capabilities?.external_delivery === false, `Expected external delivery capability disabled, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.capabilities?.delivery_attempt_readback === true, `Expected delivery attempt readback enabled, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.delivery_providers?.some((provider) => provider.provider === 'event_local' && provider.enabled === true && provider.creates_delivery_attempts === true), `Expected event_local provider enabled with local delivery attempts, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.delivery_providers?.some((provider) => provider.provider === 'push' && provider.enabled === false && provider.requires_device_registration === true), `Expected disabled push provider prep, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.delivery_providers?.some((provider) => provider.provider === 'email' && provider.enabled === false), `Expected disabled email provider prep, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.delivery_providers?.some((provider) => provider.provider === 'platform_device' && provider.enabled === false), `Expected disabled platform device provider prep, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.supported_channels?.some((channel) => channel.channel === 'event_local' && channel.delivers_outside_app === false), `Expected event_local supported channel only, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.unsupported_channels?.some((channel) => channel.channel === 'push' && channel.supported === false), `Expected push to be explicitly unsupported, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.unsupported_channels?.some((channel) => channel.channel === 'email' && channel.supported === false), `Expected email to be explicitly unsupported, got ${JSON.stringify(deliveryBoundary.data)}`);
    assert(deliveryBoundary.data?.endpoints?.records === `/api/events/${eventId}/schedule-notifications`, `Expected notification records endpoint, got ${JSON.stringify(deliveryBoundary.data)}`);

    const notificationDraft = await client.request(`/api/events/${eventId}/schedule-notifications`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: JSON.stringify({
        schedule_plan_id: planId,
        requested_status: 'planned',
        requested_visibility: 'event_workspace',
        status: 'draft',
        recipient_attendee_ids: [attendeeId],
        message_title: 'Panel plan update',
        message_body: 'I am switching this panel back to planned.'
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(notificationDraft.data?.contract?.version === 'event-schedule-notification.v1', `Expected notification contract, got ${JSON.stringify(notificationDraft.data)}`);
    assert(notificationDraft.data?.status === 'draft', `Expected draft notification, got ${JSON.stringify(notificationDraft.data)}`);
    assert(notificationDraft.data?.delivery_supported === false, `Expected no external delivery support, got ${JSON.stringify(notificationDraft.data)}`);
    assert(notificationDraft.data?.recipients?.summary?.attendee_count === 1, `Expected one draft attendee recipient, got ${JSON.stringify(notificationDraft.data)}`);
    assert(notificationDraft.data?.recipients?.summary?.group_count === 0, `Expected no draft group recipients, got ${JSON.stringify(notificationDraft.data)}`);

    const notificationSent = await client.request(`/api/events/${eventId}/schedule-notifications`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: JSON.stringify({
        schedule_plan_id: planId,
        requested_status: 'planned',
        requested_visibility: 'event_workspace',
        status: 'sent',
        recipient_attendee_ids: [attendeeId],
        recipient_group_ids: [groupId]
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(notificationSent.data?.status === 'sent', `Expected sent notification, got ${JSON.stringify(notificationSent.data)}`);
    assert(notificationSent.data?.sent_at, `Expected sent_at for sent notification, got ${JSON.stringify(notificationSent.data)}`);
    assert(notificationSent.data?.recipients?.summary?.attendee_count === 1, `Expected one sent attendee recipient, got ${JSON.stringify(notificationSent.data)}`);
    assert(notificationSent.data?.recipients?.summary?.group_count === 1, `Expected one sent group recipient, got ${JSON.stringify(notificationSent.data)}`);
    assert(notificationSent.data?.contract?.external_delivery_supported === false, `Expected external delivery disabled, got ${JSON.stringify(notificationSent.data)}`);
    assert(notificationSent.data?.delivery_attempt_readback?.total === 2, `Expected two local delivery attempts on sent notification, got ${JSON.stringify(notificationSent.data)}`);
    assert(notificationSent.data?.delivery_attempt_readback?.succeeded === 2, `Expected two successful local delivery attempts, got ${JSON.stringify(notificationSent.data)}`);

    await client.request(`/api/events/${eventId}/schedule-sessions/${catalogSessionId}`, {
      method: 'PATCH',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ status: 'cancelled', track: 'Comics Art', categories: ['Art', 'Comics'] }),
      headers: { 'Content-Type': 'application/json' }
    });

    const [attendees, groups, meetups, plans, catalog, notifications, deliveryAttempts, notificationInbox, myNotificationInbox, companion] = await Promise.all([
      client.request(`/api/events/${eventId}/attendees`, { expectStatus: 200 }),
      client.request(`/api/events/${eventId}/groups`, { expectStatus: 200 }),
      client.request(`/api/events/${eventId}/meetups`, { expectStatus: 200 }),
      client.request(`/api/events/${eventId}/schedule-plans`, { expectStatus: 200 }),
      client.request(`/api/events/${eventId}/schedule-sessions`, { expectStatus: 200 }),
      client.request(`/api/events/${eventId}/schedule-notifications`, { expectStatus: 200 }),
      client.request(`/api/events/${eventId}/schedule-notification-delivery-attempts?notification_id=${notificationSent.data.id}`, { expectStatus: 200 }),
      client.request(`/api/events/${eventId}/schedule-notification-inbox`, { expectStatus: 200 }),
      client.request(`/api/events/${eventId}/schedule-notification-inbox?recipient=me`, { expectStatus: 200 }),
      client.request(`/api/events/${eventId}/companion/today`, { expectStatus: 200 })
    ]);

    assert(attendees.data.items.length === 1, `Expected one attendee, got ${JSON.stringify(attendees.data)}`);
    assert(attendees.data.items[0]?.user_id === userId, `Expected attendee linked to current user, got ${JSON.stringify(attendees.data)}`);
    assert(attendees.data.items[0]?.current_user_attendee === true, `Expected attendee current user readback, got ${JSON.stringify(attendees.data)}`);
    assert(groups.data.items[0]?.members?.length === 1, `Expected one group member, got ${JSON.stringify(groups.data)}`);
    assert(groups.data.items[0]?.members?.[0]?.user_id === userId, `Expected group member linked user readback, got ${JSON.stringify(groups.data)}`);
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
    assert(catalog.data.items.length === 1, `Expected one schedule catalog session, got ${JSON.stringify(catalog.data)}`);
    assert(catalog.data.items[0]?.status === 'cancelled', `Expected updated schedule catalog status, got ${JSON.stringify(catalog.data)}`);
    assert(catalog.data.items[0]?.track === 'Comics Art', `Expected updated schedule catalog track, got ${JSON.stringify(catalog.data)}`);
    assert(notifications.data.items.length === 2, `Expected two schedule notification records, got ${JSON.stringify(notifications.data)}`);
    assert(notifications.data.items[0]?.status === 'sent', `Expected latest schedule notification to be sent, got ${JSON.stringify(notifications.data)}`);
    assert(notifications.data.items[0]?.delivery_attempt_readback?.total === 2, `Expected notification list delivery attempt summary, got ${JSON.stringify(notifications.data)}`);
    assert(deliveryAttempts.data?.contract?.version === 'event-schedule-notification-delivery-attempt-readback.v1', `Expected delivery attempt readback contract, got ${JSON.stringify(deliveryAttempts.data)}`);
    assert(deliveryAttempts.data?.summary?.total === 2, `Expected two delivery attempt rows, got ${JSON.stringify(deliveryAttempts.data)}`);
    assert(deliveryAttempts.data?.summary?.succeeded === 2, `Expected two successful delivery attempt rows, got ${JSON.stringify(deliveryAttempts.data)}`);
    assert(deliveryAttempts.data?.items?.every((attempt) => attempt.provider === 'event_local' && attempt.channel === 'event_local'), `Expected event-local delivery attempts, got ${JSON.stringify(deliveryAttempts.data)}`);
    assert(deliveryAttempts.data?.items?.every((attempt) => attempt.provider_message_id === null), `Expected no provider message ids for event-local attempts, got ${JSON.stringify(deliveryAttempts.data)}`);
    assert(notificationInbox.data?.contract?.version === 'event-schedule-notification-inbox.v1', `Expected notification inbox contract, got ${JSON.stringify(notificationInbox.data)}`);
    assert(notificationInbox.data?.counts?.total === 2, `Expected two local inbox recipient records, got ${JSON.stringify(notificationInbox.data)}`);
    assert(notificationInbox.data?.counts?.unread === 2, `Expected unread local recipient records, got ${JSON.stringify(notificationInbox.data)}`);
    assert(notificationInbox.data?.counts?.mine === 1, `Expected one linked current-user inbox recipient, got ${JSON.stringify(notificationInbox.data)}`);
    assert(myNotificationInbox.data?.counts?.total === 1, `Expected one current-user filtered inbox recipient, got ${JSON.stringify(myNotificationInbox.data)}`);
    assert(myNotificationInbox.data?.items?.[0]?.current_user_recipient === true, `Expected current-user filtered inbox item, got ${JSON.stringify(myNotificationInbox.data)}`);
    const acknowledgedRecipient = await client.request(`/api/events/${eventId}/schedule-notification-inbox/${notificationInbox.data.items[0].id}`, {
      method: 'PATCH',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ read_status: 'acknowledged' }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(acknowledgedRecipient.data?.read_status === 'acknowledged', `Expected acknowledged recipient readback, got ${JSON.stringify(acknowledgedRecipient.data)}`);
    assert(companion.data?.contract?.version === 'event-social-companion.v1', `Expected companion contract version, got ${JSON.stringify(companion.data?.contract)}`);
    assert(companion.data?.counts?.attendees === 1, `Expected companion attendee count, got ${JSON.stringify(companion.data?.counts)}`);
    assert(companion.data?.counts?.groups === 1, `Expected companion group count, got ${JSON.stringify(companion.data?.counts)}`);
    assert(companion.data?.counts?.meetups === 1, `Expected companion meetup count, got ${JSON.stringify(companion.data?.counts)}`);
    assert(companion.data?.counts?.schedule_plans === 1, `Expected companion schedule count, got ${JSON.stringify(companion.data?.counts)}`);
    assert(companion.data?.counts?.schedule_catalog_sessions === 1, `Expected companion schedule catalog count, got ${JSON.stringify(companion.data?.counts)}`);
    assert(companion.data?.sync?.freshness === 'not_connected', `Expected not-connected companion sync state, got ${JSON.stringify(companion.data?.sync)}`);
    assert(companion.data?.sync?.personal_ics_visibility?.connected === false, `Expected disconnected UI-safe ICS visibility, got ${JSON.stringify(companion.data?.sync)}`);
    assert(companion.data?.sync?.personal_ics_visibility?.raw_url_returned === false, `Expected UI-safe ICS visibility to hide raw URL, got ${JSON.stringify(companion.data?.sync)}`);
    assert(companion.data?.sync?.personal_ics_visibility?.personal_schedule_only === true, `Expected ICS visibility to be personal schedule only, got ${JSON.stringify(companion.data?.sync)}`);
    assert(companion.data?.privacy?.personal_ics_url_returned === false, `Expected companion privacy to hide ICS URL, got ${JSON.stringify(companion.data?.privacy)}`);
    assert(companion.data?.offline_packet?.version === 'event-social-offline-packet.v1', `Expected offline packet version, got ${JSON.stringify(companion.data?.offline_packet)}`);
    assert(companion.data?.offline_packet?.mode === 'read_only_snapshot', `Expected read-only offline packet, got ${JSON.stringify(companion.data?.offline_packet)}`);
    assert(companion.data?.offline_packet?.supports_offline_mutations === false, `Expected offline mutations disabled, got ${JSON.stringify(companion.data?.offline_packet)}`);
    assert(companion.data?.offline_packet?.retry_policy?.refetch_before_retry === true, `Expected refetch-before-retry policy, got ${JSON.stringify(companion.data?.offline_packet)}`);
    assert(companion.data?.offline_packet?.includes?.schedule_catalog === true, `Expected schedule catalog support in offline packet, got ${JSON.stringify(companion.data?.offline_packet)}`);
    assert(companion.data?.offline_packet?.counts?.planned_sessions === 1, `Expected one planned session in offline packet, got ${JSON.stringify(companion.data?.offline_packet)}`);
    assert(companion.data?.offline_packet?.counts?.schedule_catalog_sessions === 1, `Expected one catalog session in offline packet, got ${JSON.stringify(companion.data?.offline_packet)}`);
    assert(companion.data?.offline_packet?.schedule_catalog?.[0]?.title === 'How to Draw Dragons', `Expected catalog session in offline packet, got ${JSON.stringify(companion.data?.offline_packet)}`);
    assert(companion.data?.offline_packet?.privacy?.raw_personal_ics_url_returned === false, `Expected offline packet to hide personal ICS URL, got ${JSON.stringify(companion.data?.offline_packet)}`);
    assert(companion.data?.offline_packet?.key_locations?.some((item) => item.booth === '6BCF-B'), `Expected schedule booth in offline key locations, got ${JSON.stringify(companion.data?.offline_packet?.key_locations)}`);
    assert(companion.data?.offline_packet?.key_locations?.some((item) => item.kind === 'schedule_catalog' && item.name === 'Room 6A'), `Expected catalog location in offline key locations, got ${JSON.stringify(companion.data?.offline_packet?.key_locations)}`);
    assert(companion.data?.schedule_catalog?.[0]?.source_ref === 'catalog-dragon-1', `Expected companion schedule catalog readback, got ${JSON.stringify(companion.data?.schedule_catalog)}`);
    assert(companion.data?.schedule_plans?.[0]?.vendor === 'Artist signing table', `Expected companion schedule vendor readback, got ${JSON.stringify(companion.data?.schedule_plans)}`);

    console.log(JSON.stringify({
      eventId,
      attendeeCount: attendees.data.items.length,
      groupCount: groups.data.items.length,
      meetupCount: meetups.data.items.length,
      schedulePlanCount: plans.data.items.length,
      scheduleCatalogCount: catalog.data.items.length,
      updatedMeetupStatus: meetups.data.items[0]?.status || null,
      updatedSchedulePlanStatus: plans.data.items[0]?.status || null,
      updatedScheduleCatalogStatus: catalog.data.items[0]?.status || null,
      scheduleNotificationCount: notifications.data.items.length,
      scheduleNotificationInboxCount: notificationInbox.data?.counts?.total || 0,
      linkedScheduleNotificationInboxCount: myNotificationInbox.data?.counts?.total || 0,
      notificationDeliveryBoundaryVersion: deliveryBoundary.data?.contract?.version || null,
      notificationProviderContractVersion: deliveryBoundary.data?.provider_contract?.version || null,
      notificationDeliveryAttemptModelVersion: deliveryBoundary.data?.delivery_attempt_model?.version || null,
      activeNotificationProvider: deliveryBoundary.data?.provider_contract?.active_provider || null,
      notificationExternalDeliverySupported: deliveryBoundary.data?.contract?.external_delivery_supported ?? null,
      externalDeliveryAttemptsCreated: deliveryBoundary.data?.provider_contract?.external_delivery_attempts_created ?? null,
      deliveryAttemptRecordsCreated: deliveryBoundary.data?.delivery_attempt_model?.creates_records ?? null,
      deliveryAttemptReadbackCount: deliveryAttempts.data?.summary?.total || 0,
      unsupportedNotificationChannels: (deliveryBoundary.data?.unsupported_channels || []).map((channel) => channel.channel),
      sentScheduleNotificationStatus: notificationSent.data?.status || null,
      companionContract: companion.data?.contract?.version || null,
      previewRecipientCount: changePreview.data?.recipients?.summary?.attendee_count || 0
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
