'use strict';

const { test, expect } = require('@playwright/test');
const {
  ensureSavedAdminCredentials,
  createFreshUserCredentials,
  createAuthenticatedRequestContext,
  addPlaywrightBypassCookie,
  addSessionCookie,
  fetchCsrfToken,
  requestWithCsrf,
  postWithCsrf,
  patchWithCsrf
} = require('../helpers/auth');
const { signInThroughUi } = require('../helpers/session');
const {
  getFeatureFlags,
  updateFeatureFlag
} = require('../helpers/integrations');
const {
  deleteEventsByExactTitle,
  deleteCollectiblesByExactTitle,
  deleteArtByExactTitle
} = require('../helpers/eventsCollectibles');

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('events and collectibles browser regressions', () => {
  test('mobile art image control uses the core-tab native source picker', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminRequestContext = await createAuthenticatedRequestContext(adminCredentials);
    const userCredentials = await createFreshUserCredentials();
    const originalFlagsPayload = await getFeatureFlags(adminRequestContext);
    const originalFlags = Array.isArray(originalFlagsPayload?.flags) ? originalFlagsPayload.flags : [];
    const originalCollectiblesEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'collectibles_enabled')?.enabled);

    try {
      if (!originalCollectiblesEnabled) {
        await updateFeatureFlag(adminRequestContext, 'collectibles_enabled', true);
      }

      await page.setViewportSize({ width: 390, height: 844 });
      await signInThroughUi(page, userCredentials);
      await page.goto('/dashboard?tab=library-art');
      await expect(page.getByRole('heading', { name: 'Art' })).toBeVisible();
      await page.getByRole('button', { name: 'Add' }).click();
      await expect(page.getByRole('heading', { name: 'Add Art' })).toBeVisible();
      await expect(page.getByText('Artwork image')).toBeVisible();
      await expect(page.getByRole('button', { name: /Add image/i })).toBeVisible();
      await expect(page.getByText('Photo library, camera, or file')).toBeVisible();

      const imageInputs = page.locator('input[type="file"][accept="image/*"]');
      await expect(imageInputs).toHaveCount(1);
      expect(await imageInputs.first().getAttribute('capture')).toBeNull();
    } finally {
      if (!originalCollectiblesEnabled) {
        await updateFeatureFlag(adminRequestContext, 'collectibles_enabled', false).catch(() => {});
      }
      await adminRequestContext.dispose();
    }
  });

  test('art poster card shows numbered signed medium subtitle without badges', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminRequestContext = await createAuthenticatedRequestContext(adminCredentials);
    const userCredentials = await createFreshUserCredentials();
    const userRequestContext = await createAuthenticatedRequestContext(userCredentials);
    const artTitle = `Playwright Minimal Art Poster ${Date.now()}`;
    const originalFlagsPayload = await getFeatureFlags(adminRequestContext);
    const originalFlags = Array.isArray(originalFlagsPayload?.flags) ? originalFlagsPayload.flags : [];
    const originalCollectiblesEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'collectibles_enabled')?.enabled);

    await deleteArtByExactTitle(userRequestContext, artTitle).catch(() => {});
    try {
      if (!originalCollectiblesEnabled) {
        await updateFeatureFlag(adminRequestContext, 'collectibles_enabled', true);
      }

      await postWithCsrf(userRequestContext, '/api/art', {
        title: artTitle,
        medium: 'print',
        print_number: 150,
        print_run: 200,
        signed: true
      }, 201);

      await signInThroughUi(page, userCredentials);
      await page.goto('/dashboard?tab=library-art');

      const artCard = page.locator('article').filter({ hasText: artTitle }).first();
      await expect(artCard).toBeVisible();
      await expect(artCard.getByText('#150/200 Signed Print')).toBeVisible();
      await expect(artCard.locator('.badge')).toHaveCount(0);
    } finally {
      await deleteArtByExactTitle(userRequestContext, artTitle).catch(() => {});
      if (!originalCollectiblesEnabled) {
        await updateFeatureFlag(adminRequestContext, 'collectibles_enabled', false).catch(() => {});
      }
      await userRequestContext.dispose();
      await adminRequestContext.dispose();
    }
  });

  test('artwork entry can create and reuse a linked artist record', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminRequestContext = await createAuthenticatedRequestContext(adminCredentials);
    const userCredentials = await createFreshUserCredentials();
    const userRequestContext = await createAuthenticatedRequestContext(userCredentials);
    const suffix = Date.now();
    const artistName = `Playwright Reusable Artist ${suffix}`;
    const firstTitle = `Playwright Artist Linked Print ${suffix}`;
    const secondTitle = `Playwright Artist Linked Sketch ${suffix}`;
    const originalFlagsPayload = await getFeatureFlags(adminRequestContext);
    const originalFlags = Array.isArray(originalFlagsPayload?.flags) ? originalFlagsPayload.flags : [];
    const originalCollectiblesEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'collectibles_enabled')?.enabled);

    await deleteArtByExactTitle(userRequestContext, firstTitle).catch(() => {});
    await deleteArtByExactTitle(userRequestContext, secondTitle).catch(() => {});
    try {
      if (!originalCollectiblesEnabled) {
        await updateFeatureFlag(adminRequestContext, 'collectibles_enabled', true);
      }

      const artistResponse = await postWithCsrf(userRequestContext, '/api/art/artists', {
        name: artistName,
        aliases: 'PWRA',
        website_url: 'https://example.test/artists/reusable',
        notes: 'Created by the reusable artist regression.'
      }, 201);
      const artistPayload = await artistResponse.json();
      const artistId = Number(artistPayload?.artist?.id || 0);
      expect(artistId).toBeGreaterThan(0);

      const searchResponse = await userRequestContext.get(`/api/art/artists?q=${encodeURIComponent(artistName)}&limit=5`);
      expect(searchResponse.status()).toBe(200);
      const searchPayload = await searchResponse.json();
      expect(searchPayload.artists.some((artist) => Number(artist.id) === artistId)).toBe(true);

      const firstResponse = await postWithCsrf(userRequestContext, '/api/art', {
        title: firstTitle,
        medium: 'print',
        artist_id: artistId,
        artist_role: 'Illustrator',
        print_number: 12,
        print_run: 50
      }, 201);
      const firstPayload = await firstResponse.json();
      const firstId = Number(firstPayload?.id || firstPayload?.native_art_id || 0);
      expect(firstId).toBeGreaterThan(0);
      expect(firstPayload.artist).toBe(artistName);
      expect(firstPayload.artist_record?.id).toBe(artistId);

      const secondResponse = await postWithCsrf(userRequestContext, '/api/art', {
        title: secondTitle,
        medium: 'original',
        artist_id: artistId,
        artist_role: 'Painter'
      }, 201);
      const secondPayload = await secondResponse.json();
      expect(Number(secondPayload?.artist_id || 0)).toBe(artistId);

      const detailResponse = await userRequestContext.get(`/api/art/${firstId}`);
      expect(detailResponse.status()).toBe(200);
      const detailPayload = await detailResponse.json();
      expect(detailPayload.artist_record?.name).toBe(artistName);
      expect(detailPayload.artist_record?.aliases).toContain('PWRA');
      expect(detailPayload.artist_role).toBe('Illustrator');

      await signInThroughUi(page, userCredentials);
      await page.goto('/dashboard?tab=library-art');
      const artCard = page.locator('article').filter({ hasText: firstTitle }).first();
      await expect(artCard).toBeVisible();
      await artCard.click();
      await expect(page.getByText(artistName).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Other works' })).toBeVisible();
    } finally {
      await deleteArtByExactTitle(userRequestContext, firstTitle).catch(() => {});
      await deleteArtByExactTitle(userRequestContext, secondTitle).catch(() => {});
      if (!originalCollectiblesEnabled) {
        await updateFeatureFlag(adminRequestContext, 'collectibles_enabled', false).catch(() => {});
      }
      await userRequestContext.dispose();
      await adminRequestContext.dispose();
    }
  });

  test('mobile event drawer shows a compact social overview before admin sections', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminRequestContext = await createAuthenticatedRequestContext(adminCredentials);
    const userCredentials = await createFreshUserCredentials();
    const userRequestContext = await createAuthenticatedRequestContext(userCredentials);
    const expectedSelfName = String(userCredentials?.name || 'You').trim() || 'You';
    const suffix = Date.now();
    const eventTitle = `Playwright Mobile Social Event ${suffix}`;
    const originalFlagsPayload = await getFeatureFlags(adminRequestContext);
    const originalFlags = Array.isArray(originalFlagsPayload?.flags) ? originalFlagsPayload.flags : [];
    const originalEventsEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'events_enabled')?.enabled);

    await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});

    try {
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', true);
      }

      const eventResponse = await postWithCsrf(userRequestContext, '/api/events', {
        title: eventTitle,
        url: `https://example.test/mobile-social/${suffix}`,
        location: 'San Diego Convention Center',
        date_start: '2026-07-23',
        date_end: '2026-07-26'
      }, 201);
      const eventPayload = await eventResponse.json();
      const eventId = Number(eventPayload?.id || 0);
      expect(eventId).toBeGreaterThan(0);

      const attendeeResponse = await postWithCsrf(userRequestContext, `/api/events/${eventId}/attendees`, {
        display_name: 'Reid',
        relationship: 'friend',
        link_current_user: true,
        status: 'attending',
        visibility: 'private'
      }, 201);
      const attendeePayload = await attendeeResponse.json();
      const attendeeId = Number(attendeePayload?.id || 0);
      expect(attendeeId).toBeGreaterThan(0);
      const groupResponse = await postWithCsrf(userRequestContext, `/api/events/${eventId}/groups`, {
        name: 'Artist Alley Crew',
        visibility: 'group',
        attendee_ids: [attendeeId]
      }, 201);
      const groupPayload = await groupResponse.json();
      const groupId = Number(groupPayload?.id || 0);
      expect(groupId).toBeGreaterThan(0);
      await postWithCsrf(userRequestContext, `/api/events/${eventId}/meetups`, {
        title: 'Meet outside Hall H',
        group_id: groupId,
        start_at: '2026-07-23T18:00:00.000Z',
        location: 'Hall H doors',
        vendor: 'Hall H Cafe',
        booth: 'HH-12',
        location_notes: 'Meet by the left-side doors.',
        status: 'planned',
        visibility: 'group'
      }, 201);
      await postWithCsrf(userRequestContext, `/api/events/${eventId}/schedule-plans`, {
        title: 'Spotlight on Playwright',
        location: 'Room 6DE',
        start_at: '2026-07-23T17:00:00.000Z',
        source_type: 'manual',
        status: 'planned',
        visibility: 'event_workspace'
      }, 201);

      const sessionToken = userRequestContext.__collectzCookieJar?.get('session_token');
      expect(sessionToken).toBeTruthy();

      await page.setViewportSize({ width: 390, height: 844 });
      await addPlaywrightBypassCookie(page.context());
      await addSessionCookie(page.context(), sessionToken);
      await page.goto('/dashboard?tab=library-events');
      await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
      await page.getByPlaceholder('Search title or location…').fill(eventTitle);
      const eventCard = page.locator('article').filter({ hasText: eventTitle }).first();
      await expect(eventCard).toBeVisible();
      await eventCard.locator('p').filter({ hasText: eventTitle }).first().click();
      await expect(page.getByRole('heading').filter({ hasText: eventTitle }).first()).toBeVisible();

      const overview = page.getByLabel('Mobile event social overview');
      await expect(overview).toBeVisible();
      await expect(overview.getByText('Day-of social plan')).toBeVisible();
      await expect(overview.getByText('1 person · 1 group · 1 meetup · 1 plan')).toBeVisible();
      await expect(overview.getByText('Schedule focus')).toBeVisible();
      await expect(overview.getByText('Next meetup')).toBeVisible();
      await expect(overview.getByText('Spotlight on Playwright')).toBeVisible();
      await expect(overview.getByText('Meet outside Hall H')).toBeVisible();
      await expect(overview.getByText('Reid')).toBeVisible();
      await expect(overview.getByText('Groups: Artist Alley Crew')).toBeVisible();
      await expect(overview.getByText('Room 6DE')).toBeVisible();
      await expect(overview.getByText('Shared', { exact: true })).toBeVisible();
      await expect(overview.getByText('Hall H doors · Hall H Cafe · Booth HH-12')).toBeVisible();
      await expect(overview.getByText('Group', { exact: true })).toBeVisible();
      await overview.getByRole('button', { name: /Meetups\s+1/ }).click();
      const meetupSection = page.locator('#event-social-meetups');
      await expect(meetupSection.getByText('Meet outside Hall H')).toBeVisible();
      await overview.getByRole('button', { name: /People\s+1/ }).click();
      const peoplePanel = page.locator('summary').filter({ hasText: /^People/ }).locator('xpath=..').first();
      await expect(peoplePanel.getByText('Reid')).toBeVisible();
      await expect(peoplePanel.locator('span').filter({ hasText: 'Private' }).first()).toBeVisible();
      await expect(peoplePanel.getByText('Related groups')).toBeVisible();
      await expect(peoplePanel.getByText('Artist Alley Crew')).toBeVisible();
      await expect(peoplePanel.getByText('Next meetup')).toBeVisible();
      await expect(peoplePanel.getByText('Meet outside Hall H')).toBeVisible();
      const groupsPanel = page.locator('summary').filter({ hasText: /^Groups/ }).locator('xpath=..').first();
      await groupsPanel.locator('summary').first().click();
      await expect(groupsPanel.getByText('Artist Alley Crew')).toBeVisible();
      await expect(groupsPanel.locator('span').filter({ hasText: 'Group' }).first()).toBeVisible();
      await expect(groupsPanel.locator('p').filter({ hasText: 'Members' }).first()).toBeVisible();
      await expect(groupsPanel.locator('p').filter({ hasText: 'Reid' }).first()).toBeVisible();
      await expect(groupsPanel.locator('p').filter({ hasText: 'Shared plans' }).first()).toBeVisible();
      await page.locator('summary').filter({ hasText: /^Meetups/ }).first().click();
      const meetupRow = page.locator('details details').filter({ hasText: 'Meet outside Hall H' }).first();
      await meetupRow.locator('summary').click();
      await expect(meetupRow.getByText('Related group')).toBeVisible();
    } finally {
      await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', false).catch(() => {});
      }
      await userRequestContext.dispose();
      await adminRequestContext.dispose();
    }
  });

  test('event drawer uses add me for the signed-in attendee and keeps the generic people form for others', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminRequestContext = await createAuthenticatedRequestContext(adminCredentials);
    const userCredentials = await createFreshUserCredentials();
    const userRequestContext = await createAuthenticatedRequestContext(userCredentials);
    const expectedSelfName = String(userCredentials?.name || 'You').trim() || 'You';
    const suffix = Date.now();
    const eventTitle = `Playwright Self Attendee Event ${suffix}`;
    const originalFlagsPayload = await getFeatureFlags(adminRequestContext);
    const originalFlags = Array.isArray(originalFlagsPayload?.flags) ? originalFlagsPayload.flags : [];
    const originalEventsEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'events_enabled')?.enabled);

    await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});

    try {
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', true);
      }

      const eventResponse = await postWithCsrf(userRequestContext, '/api/events', {
        title: eventTitle,
        url: `https://example.test/self-attendee/${suffix}`,
        location: 'San Diego Convention Center',
        date_start: '2026-07-23',
        date_end: '2026-07-26'
      }, 201);
      const eventPayload = await eventResponse.json();
      const eventId = Number(eventPayload?.id || 0);
      expect(eventId).toBeGreaterThan(0);

      const sessionToken = userRequestContext.__collectzCookieJar?.get('session_token');
      expect(sessionToken).toBeTruthy();

      await page.setViewportSize({ width: 390, height: 844 });
      await addPlaywrightBypassCookie(page.context());
      await addSessionCookie(page.context(), sessionToken);
      await page.goto('/dashboard?tab=library-events');
      await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
      await page.getByRole('button', { name: 'List', exact: true }).click();
      await page.getByPlaceholder('Search title or location…').fill(eventTitle);
      const matchingEventCards = page.locator('article').filter({ hasText: eventTitle });
      await expect(matchingEventCards).toHaveCount(1);
      const eventCard = matchingEventCards.first();
      await expect(eventCard).toBeVisible();
      await eventCard.click();
      await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible();

      const peoplePanel = page.locator('summary').filter({ hasText: /^People/ }).locator('xpath=..').first();
      await expect(peoplePanel.locator('summary').getByText('Add your own attendee before managing other people')).toBeVisible();
      await expect(peoplePanel.locator('summary').getByRole('button', { name: 'Add me to this event' })).toBeVisible();
      await peoplePanel.locator('summary').first().click();
      await expect(peoplePanel.getByText('No attendees yet.')).toBeVisible();
      await expect(peoplePanel.getByText('You are not added to this event yet')).toBeVisible();
      await expect(peoplePanel.getByText(expectedSelfName)).toBeVisible();
      const addMeButtonName = 'Add me to this event';
      await expect(peoplePanel.getByPlaceholder('Name')).toBeVisible();
      await expect(peoplePanel.getByPlaceholder('Relationship')).toBeVisible();
      await expect(peoplePanel.getByText('Use this form for other people.')).toBeVisible();
      await expect(peoplePanel.getByText('Link this attendee to my app user')).toHaveCount(0);

      await peoplePanel.getByRole('button', { name: addMeButtonName }).click();
      await expect(page.getByText('You were added to this event')).toBeVisible();
      await expect(peoplePanel.getByText('No attendees yet.')).toHaveCount(0);
      await expect(peoplePanel.locator('summary').getByRole('button', { name: 'Add me to this event' })).toHaveCount(0);

      const attendeeRow = peoplePanel.locator('details').filter({ hasText: expectedSelfName }).first();
      await expect(attendeeRow.locator('summary').getByText(expectedSelfName)).toBeVisible();
      await expect(attendeeRow.locator('summary').getByText('You', { exact: true })).toBeVisible();
      await expect(attendeeRow.locator('summary').getByText('Linked to you')).toBeVisible();

      const attendeesResponse = await userRequestContext.get(`/api/events/${eventId}/attendees`);
      expect(attendeesResponse.ok()).toBeTruthy();
      const attendeesPayload = await attendeesResponse.json();
      expect(Array.isArray(attendeesPayload.items)).toBeTruthy();
      expect(attendeesPayload.items).toHaveLength(1);
      expect(attendeesPayload.items[0]?.display_name).toBe(expectedSelfName);
      expect(attendeesPayload.items[0]?.current_user_attendee).toBe(true);

      await peoplePanel.getByPlaceholder('Name').fill(expectedSelfName);
      await expect(peoplePanel.getByText(`${expectedSelfName} already exists for this event.`)).toBeVisible();
      await expect(peoplePanel.getByText('That row is already linked to you.')).toBeVisible();
      await expect(peoplePanel.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
      await peoplePanel.getByRole('button', { name: 'Add anyway' }).click();
      await peoplePanel.getByPlaceholder('Relationship').fill('cosplay twin');
      await peoplePanel.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.getByText('Attendee added')).toBeVisible();

      await peoplePanel.getByPlaceholder('Name').fill('Avery Stone');
      await peoplePanel.getByPlaceholder('Relationship').fill('friend');
      await peoplePanel.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.getByText('Attendee added')).toBeVisible();
      await peoplePanel.getByPlaceholder('Name').fill('Avery  Stone');
      await expect(peoplePanel.getByText('Avery Stone already exists for this event.')).toBeVisible();
      await expect(peoplePanel.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
      await peoplePanel.getByRole('button', { name: 'Add anyway' }).click();
      await peoplePanel.getByPlaceholder('Relationship').fill('vendor helper');
      await peoplePanel.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.getByText('Attendee added')).toBeVisible();

      const duplicateAttendeesResponse = await userRequestContext.get(`/api/events/${eventId}/attendees`);
      expect(duplicateAttendeesResponse.ok()).toBeTruthy();
      const duplicateAttendeesPayload = await duplicateAttendeesResponse.json();
      expect(duplicateAttendeesPayload.items).toHaveLength(4);
      expect(duplicateAttendeesPayload.items.filter((item) => item?.current_user_attendee)).toHaveLength(1);
    } finally {
      await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', false).catch(() => {});
      }
      await userRequestContext.dispose();
      await adminRequestContext.dispose();
    }
  });

  test('event drawer auto-creates the signed-in attendee on the first social group action', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminRequestContext = await createAuthenticatedRequestContext(adminCredentials);
    const userCredentials = await createFreshUserCredentials();
    const userRequestContext = await createAuthenticatedRequestContext(userCredentials);
    const expectedSelfName = String(userCredentials?.name || 'You').trim() || 'You';
    const suffix = Date.now();
    const eventTitle = `Playwright Group Auto Self Event ${suffix}`;
    const originalFlagsPayload = await getFeatureFlags(adminRequestContext);
    const originalFlags = Array.isArray(originalFlagsPayload?.flags) ? originalFlagsPayload.flags : [];
    const originalEventsEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'events_enabled')?.enabled);

    await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});

    try {
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', true);
      }

      const eventResponse = await postWithCsrf(userRequestContext, '/api/events', {
        title: eventTitle,
        url: `https://example.test/auto-self-group/${suffix}`,
        location: 'San Diego Convention Center',
        date_start: '2026-07-23',
        date_end: '2026-07-26'
      }, 201);
      const eventPayload = await eventResponse.json();
      const eventId = Number(eventPayload?.id || 0);
      expect(eventId).toBeGreaterThan(0);

      const sessionToken = userRequestContext.__collectzCookieJar?.get('session_token');
      expect(sessionToken).toBeTruthy();

      await page.setViewportSize({ width: 390, height: 844 });
      await addPlaywrightBypassCookie(page.context());
      await addSessionCookie(page.context(), sessionToken);
      await page.goto('/dashboard?tab=library-events');
      await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
      await page.getByRole('button', { name: 'List', exact: true }).click();
      await page.getByPlaceholder('Search title or location…').fill(eventTitle);
      const eventCard = page.locator('article').filter({ hasText: eventTitle }).first();
      await expect(eventCard).toBeVisible();
      await eventCard.click();
      await expect(page.getByRole('heading').filter({ hasText: eventTitle }).first()).toBeVisible();

      const groupsPanel = page.locator('summary').filter({ hasText: /^Groups/ }).locator('xpath=..').first();
      await groupsPanel.locator('summary').first().click();
      await groupsPanel.getByPlaceholder('Group name').fill('Artist Alley Crew');
      await groupsPanel.getByRole('button', { name: 'Add' }).click();
      await expect(groupsPanel.locator('details').filter({ hasText: 'Artist Alley Crew' }).first()).toBeVisible();

      const groupRow = groupsPanel.locator('details').filter({ hasText: 'Artist Alley Crew' }).first();
      await expect(groupRow.locator('summary').getByText('Artist Alley Crew')).toBeVisible();

      const attendeesResponse = await userRequestContext.get(`/api/events/${eventId}/attendees`);
      expect(attendeesResponse.ok()).toBeTruthy();
      const attendeesPayload = await attendeesResponse.json();
      expect(attendeesPayload.items).toHaveLength(1);
      expect(attendeesPayload.items[0]?.current_user_attendee).toBe(true);
      expect(attendeesPayload.items[0]?.display_name).toBe(expectedSelfName);

      const groupsResponse = await userRequestContext.get(`/api/events/${eventId}/groups`);
      expect(groupsResponse.ok()).toBeTruthy();
      const groupsPayload = await groupsResponse.json();
      expect(groupsPayload.items).toHaveLength(1);
      expect(Array.isArray(groupsPayload.items[0]?.members)).toBeTruthy();
      expect(groupsPayload.items[0]?.members?.some((member) => member?.display_name === expectedSelfName)).toBe(true);
    } finally {
      await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', false).catch(() => {});
      }
      await userRequestContext.dispose();
      await adminRequestContext.dispose();
    }
  });

  test('mobile event drawer can update meetup status and notes in place', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminRequestContext = await createAuthenticatedRequestContext(adminCredentials);
    const userCredentials = await createFreshUserCredentials();
    const userRequestContext = await createAuthenticatedRequestContext(userCredentials);
    const suffix = Date.now();
    const eventTitle = `Playwright Mobile Meetup Edit ${suffix}`;
    const meetupTitle = 'Quick lunch regroup';
    const originalFlagsPayload = await getFeatureFlags(adminRequestContext);
    const originalFlags = Array.isArray(originalFlagsPayload?.flags) ? originalFlagsPayload.flags : [];
    const originalEventsEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'events_enabled')?.enabled);

    await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});

    try {
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', true);
      }

      const eventResponse = await postWithCsrf(userRequestContext, '/api/events', {
        title: eventTitle,
        url: `https://example.test/mobile-meetup-edit/${suffix}`,
        location: 'San Diego Convention Center',
        date_start: '2026-07-23'
      }, 201);
      const eventPayload = await eventResponse.json();
      const eventId = Number(eventPayload?.id || 0);
      expect(eventId).toBeGreaterThan(0);

      await postWithCsrf(userRequestContext, `/api/events/${eventId}/meetups`, {
        title: meetupTitle,
        start_at: '2026-07-23T19:00:00.000Z',
        location: 'Lobby stairs',
        vendor: 'Lobby Cafe',
        booth: 'L-4',
        location_notes: 'Use the stairs nearest the escalators.',
        status: 'planned',
        visibility: 'private',
        notes: 'Initial plan'
      }, 201);

      await page.setViewportSize({ width: 390, height: 844 });
      await signInThroughUi(page, userCredentials);
      await page.goto('/dashboard?tab=library-events');
      await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
      await page.getByPlaceholder('Search title or location…').fill(eventTitle);
      await expect(page.getByText(eventTitle, { exact: true }).first()).toBeVisible();
      await page.locator('article').filter({ hasText: eventTitle }).first().click();
      await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible();

      await page.locator('summary').filter({ hasText: /^Meetups/ }).click();
      const meetupRow = page.locator('details details').filter({ hasText: meetupTitle }).first();
      await expect(meetupRow).toBeVisible();
      await meetupRow.locator('summary').click();
      await meetupRow.locator('label:has-text("Status") select').selectOption('done');
      await meetupRow.locator('label:has-text("Vendor") input').fill('Lobby Grill');
      await meetupRow.locator('label:has-text("Booth") input').fill('L-5');
      await meetupRow.locator('label:has-text("Location note") input').fill('Meet beside the lower escalators.');
      await meetupRow.getByPlaceholder('Quick note').fill('Met by the lobby stairs after the panel.');
      await meetupRow.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Meetup updated')).toBeVisible();
      await expect(meetupRow.locator('summary').getByText(/Lobby stairs .* Lobby Grill .* Booth L-5 .* Done/)).toBeVisible();

      const meetupResponse = await userRequestContext.get(`/api/events/${eventId}/meetups`);
      expect(meetupResponse.ok()).toBeTruthy();
      const meetupPayload = await meetupResponse.json();
      const updated = meetupPayload.items.find((item) => item.title === meetupTitle);
      expect(updated?.status).toBe('done');
      expect(updated?.vendor).toBe('Lobby Grill');
      expect(updated?.booth).toBe('L-5');
      expect(updated?.location_notes).toBe('Meet beside the lower escalators.');
      expect(updated?.notes).toBe('Met by the lobby stairs after the panel.');
    } finally {
      await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', false).catch(() => {});
      }
      await userRequestContext.dispose();
      await adminRequestContext.dispose();
    }
  });

  test('mobile event drawer can edit attendees groups and meetup ownership in place', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminRequestContext = await createAuthenticatedRequestContext(adminCredentials);
    const userCredentials = await createFreshUserCredentials();
    const userRequestContext = await createAuthenticatedRequestContext(userCredentials);
    const suffix = Date.now();
    const eventTitle = `Playwright Mobile Social Edit ${suffix}`;
    const originalFlagsPayload = await getFeatureFlags(adminRequestContext);
    const originalFlags = Array.isArray(originalFlagsPayload?.flags) ? originalFlagsPayload.flags : [];
    const originalEventsEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'events_enabled')?.enabled);

    await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});

    try {
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', true);
      }

      const eventResponse = await postWithCsrf(userRequestContext, '/api/events', {
        title: eventTitle,
        url: `https://example.test/mobile-social-edit/${suffix}`,
        location: 'Anaheim Convention Center',
        date_start: '2026-08-14',
        date_end: '2026-08-16'
      }, 201);
      const eventPayload = await eventResponse.json();
      const eventId = Number(eventPayload?.id || 0);
      expect(eventId).toBeGreaterThan(0);

      const reidResponse = await postWithCsrf(userRequestContext, `/api/events/${eventId}/attendees`, {
        display_name: 'Reid',
        relationship: 'friend',
        status: 'attending',
        visibility: 'private'
      }, 201);
      const reidPayload = await reidResponse.json();
      const reidId = Number(reidPayload?.id || 0);
      expect(reidId).toBeGreaterThan(0);

      const alexResponse = await postWithCsrf(userRequestContext, `/api/events/${eventId}/attendees`, {
        display_name: 'Alex',
        relationship: 'friend',
        status: 'maybe',
        visibility: 'selected_people'
      }, 201);
      const alexPayload = await alexResponse.json();
      const alexId = Number(alexPayload?.id || 0);
      expect(alexId).toBeGreaterThan(0);

      const crewResponse = await postWithCsrf(userRequestContext, `/api/events/${eventId}/groups`, {
        name: 'Artist Alley Crew',
        visibility: 'group',
        attendee_ids: [reidId]
      }, 201);
      const crewPayload = await crewResponse.json();
      const crewId = Number(crewPayload?.id || 0);
      expect(crewId).toBeGreaterThan(0);

      const breakfastResponse = await postWithCsrf(userRequestContext, `/api/events/${eventId}/groups`, {
        name: 'Breakfast Squad',
        visibility: 'private',
        attendee_ids: [alexId]
      }, 201);
      const breakfastPayload = await breakfastResponse.json();
      const breakfastId = Number(breakfastPayload?.id || 0);
      expect(breakfastId).toBeGreaterThan(0);

      await postWithCsrf(userRequestContext, `/api/events/${eventId}/meetups`, {
        title: 'Coffee regroup',
        group_id: breakfastId,
        start_at: '2026-08-14T18:00:00.000Z',
        location: 'North lobby',
        status: 'planned',
        visibility: 'group',
        notes: 'Original meetup note'
      }, 201);

      await page.setViewportSize({ width: 390, height: 844 });
      await signInThroughUi(page, userCredentials);
      await page.goto('/dashboard?tab=library-events');
      await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
      await page.getByPlaceholder('Search title or location…').fill(eventTitle);
      await expect(page.getByText(eventTitle, { exact: true }).first()).toBeVisible();
      await page.locator('article').filter({ hasText: eventTitle }).first().click();
      await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible();

      const peoplePanel = page.locator('summary').filter({ hasText: /^People/ }).locator('xpath=..').first();
      await peoplePanel.locator('summary').first().click();
      const reidRow = peoplePanel.locator('details').filter({ hasText: /^Reid/ }).first();
      await reidRow.locator('summary').click();
      await reidRow.locator('label:has-text("Name") input').fill('Reid Krewson');
      await reidRow.locator('label:has-text("Relationship") input').fill('travel buddy');
      await reidRow.locator('label:has-text("Status") select').selectOption('maybe');
      await reidRow.locator('label:has-text("Visibility") select').selectOption('event_workspace');
      await reidRow.getByPlaceholder('Quick note').fill('Met up after badge pickup.');
      await reidRow.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Attendee updated')).toBeVisible();
      await expect(reidRow.locator('summary').getByText('Reid Krewson')).toBeVisible();

      const groupsPanel = page.locator('summary').filter({ hasText: /^Groups/ }).locator('xpath=..').first();
      await groupsPanel.locator('summary').first().click();
      const crewRow = groupsPanel.locator('details').filter({ hasText: 'Artist Alley Crew' }).first();
      await crewRow.locator('summary').click();
      await crewRow.locator('label:has-text("Group name") input').fill('Artist Alley Friends');
      await crewRow.locator('label:has-text("Visibility") select').selectOption('event_workspace');
      await crewRow.getByPlaceholder('Quick note').fill('Primary artist alley coordination group.');
      await crewRow.getByLabel('Alex').check();
      await crewRow.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Group updated')).toBeVisible();
      await expect(groupsPanel.getByText('Artist Alley Friends')).toBeVisible();
      await expect(groupsPanel.getByText('Alex, Reid Krewson')).toBeVisible();

      const meetupsPanel = page.locator('summary').filter({ hasText: /^Meetups/ }).locator('xpath=..').first();
      await meetupsPanel.locator('summary').first().click();
      const meetupRow = meetupsPanel.locator('details').filter({ hasText: 'Coffee regroup' }).first();
      await meetupRow.locator('summary').click();
      await meetupRow.locator('select').nth(1).selectOption(String(crewId));
      await meetupRow.locator('select').nth(2).selectOption('event_workspace');
      await meetupRow.getByPlaceholder('Quick note').fill('Moved under the shared artist alley group.');
      await meetupRow.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Meetup updated')).toBeVisible();
      await expect(meetupRow.getByText('Artist Alley Friends', { exact: true }).first()).toBeVisible();

      const attendeesResponse = await userRequestContext.get(`/api/events/${eventId}/attendees`);
      expect(attendeesResponse.ok()).toBeTruthy();
      const attendeesPayload = await attendeesResponse.json();
      const updatedAttendee = attendeesPayload.items.find((item) => item.id === reidId);
      expect(updatedAttendee?.display_name).toBe('Reid Krewson');
      expect(updatedAttendee?.relationship).toBe('travel buddy');
      expect(updatedAttendee?.status).toBe('maybe');
      expect(updatedAttendee?.visibility).toBe('event_workspace');
      expect(updatedAttendee?.notes).toBe('Met up after badge pickup.');

      const groupsResponse = await userRequestContext.get(`/api/events/${eventId}/groups`);
      expect(groupsResponse.ok()).toBeTruthy();
      const groupsPayload = await groupsResponse.json();
      const updatedGroup = groupsPayload.items.find((item) => item.id === crewId);
      expect(updatedGroup?.name).toBe('Artist Alley Friends');
      expect(updatedGroup?.visibility).toBe('event_workspace');
      expect(updatedGroup?.notes).toBe('Primary artist alley coordination group.');
      expect((updatedGroup?.members || []).map((item) => item.display_name)).toEqual(expect.arrayContaining(['Reid Krewson', 'Alex']));

      const meetupsResponse = await userRequestContext.get(`/api/events/${eventId}/meetups`);
      expect(meetupsResponse.ok()).toBeTruthy();
      const meetupsPayload = await meetupsResponse.json();
      const updatedMeetup = meetupsPayload.items.find((item) => item.title === 'Coffee regroup');
      expect(updatedMeetup?.group_id).toBe(crewId);
      expect(updatedMeetup?.group_name).toBe('Artist Alley Friends');
      expect(updatedMeetup?.visibility).toBe('event_workspace');
      expect(updatedMeetup?.notes).toBe('Moved under the shared artist alley group.');
    } finally {
      await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', false).catch(() => {});
      }
      await userRequestContext.dispose();
      await adminRequestContext.dispose();
    }
  });

  test('mobile event drawer can update schedule plan status visibility and notes in place', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminRequestContext = await createAuthenticatedRequestContext(adminCredentials);
    const userCredentials = await createFreshUserCredentials();
    const userRequestContext = await createAuthenticatedRequestContext(userCredentials);
    const suffix = Date.now();
    const eventTitle = `Playwright Mobile Schedule Edit ${suffix}`;
    const planTitle = 'Spotlight panel backup';
    const originalFlagsPayload = await getFeatureFlags(adminRequestContext);
    const originalFlags = Array.isArray(originalFlagsPayload?.flags) ? originalFlagsPayload.flags : [];
    const originalEventsEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'events_enabled')?.enabled);

    await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});

    try {
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', true);
      }

      const eventResponse = await postWithCsrf(userRequestContext, '/api/events', {
        title: eventTitle,
        url: `https://example.test/mobile-schedule-edit/${suffix}`,
        location: 'San Diego Convention Center',
        date_start: '2026-07-23'
      }, 201);
      const eventPayload = await eventResponse.json();
      const eventId = Number(eventPayload?.id || 0);
      expect(eventId).toBeGreaterThan(0);

      const attendeeResponse = await postWithCsrf(userRequestContext, `/api/events/${eventId}/attendees`, {
        display_name: 'Reid',
        relationship: 'friend',
        link_current_user: true,
        status: 'attending',
        visibility: 'selected_people'
      }, 201);
      const attendeePayload = await attendeeResponse.json();
      const attendeeId = Number(attendeePayload?.id || 0);
      expect(attendeeId).toBeGreaterThan(0);

      await postWithCsrf(userRequestContext, `/api/events/${eventId}/groups`, {
        name: 'Panel crew',
        visibility: 'group',
        attendee_ids: [attendeeId]
      }, 201);

      await postWithCsrf(userRequestContext, `/api/events/${eventId}/schedule-plans`, {
        title: planTitle,
        start_at: '2026-07-23T22:00:00.000Z',
        end_at: '2026-07-23T23:00:00.000Z',
        location: 'Room 6DE',
        vendor: 'Panel merch table',
        booth: '6DE-A',
        location_notes: 'Back wall after the Q&A line.',
        source_type: 'manual',
        status: 'planned',
        visibility: 'private',
        notes: 'Original plan note'
      }, 201);

      await page.setViewportSize({ width: 390, height: 844 });
      await signInThroughUi(page, userCredentials);
      await page.goto('/dashboard?tab=library-events');
      await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
      await page.getByPlaceholder('Search title or location…').fill(eventTitle);
      await expect(page.getByText(eventTitle, { exact: true }).first()).toBeVisible();
      await page.locator('article').filter({ hasText: eventTitle }).first().click();
      await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible();

      const planRow = page.locator('details details').filter({ hasText: planTitle }).first();
      await expect(planRow).toBeVisible();
      await planRow.locator('summary').click();
      await planRow.locator('label:has-text("Status") select').selectOption('backup');
      await planRow.locator('label:has-text("Visibility") select').selectOption('event_workspace');
      await expect(planRow.getByText('Shared with Reid, Panel crew').first()).toBeVisible();
      await expect(planRow.getByLabel('Session presence').getByText('1 person')).toBeVisible();
      await expect(planRow.getByLabel('Session presence').getByText('1 group')).toBeVisible();
      await planRow.locator('label:has-text("Vendor") input').fill('Artist signing table');
      await planRow.locator('label:has-text("Booth") input').fill('6DE-B');
      await planRow.locator('label:has-text("Location note") input').fill('Queue at the rear exit.');
      await planRow.getByPlaceholder('Plan note').fill('Backup if the first panel is full.');
      await planRow.getByRole('button', { name: 'Preview share' }).click();
      await expect(planRow.getByLabel('Schedule change preview')).toBeVisible();
      await expect(planRow.getByText('1 person, 1 group')).toBeVisible();
      await expect(planRow.getByText(`Suggested: I'm keeping ${planTitle} as backup.`)).toBeVisible();
      const messageComposer = planRow.getByLabel('Schedule notification message');
      await expect(messageComposer).toBeVisible();
      await messageComposer.locator('label:has-text("Template") select').selectOption('meet');
      await messageComposer.locator('label:has-text("Message") textarea').fill(`Meet me by the back wall for ${planTitle}.`);
      const recipientChooser = messageComposer.getByLabel('Schedule notification recipients');
      await expect(recipientChooser).toBeVisible();
      await expect(recipientChooser.getByText('2 selected')).toBeVisible();
      await expect(recipientChooser.getByLabel('Reid')).toBeChecked();
      await expect(recipientChooser.getByLabel('Panel crew')).toBeChecked();
      await recipientChooser.getByLabel('Panel crew').uncheck();
      await expect(recipientChooser.getByText('1 selected')).toBeVisible();
      await expect(planRow.getByText('No notification will be sent from this preview.')).toBeVisible();
      await planRow.getByRole('button', { name: 'Save draft' }).click();
      await expect(page.getByText('Schedule notification draft saved')).toBeVisible();
      await expect(planRow.getByLabel('Schedule notification record')).toBeVisible();
      await expect(planRow.getByText('Draft saved')).toBeVisible();
      await expect(planRow.getByLabel('Draft notification actions')).toBeVisible();
      await planRow.getByRole('button', { name: 'Edit draft' }).click();
      await expect(page.getByText('Draft loaded for editing')).toBeVisible();
      await expect(planRow.getByRole('button', { name: 'Update draft' })).toBeVisible();
      await messageComposer.locator('label:has-text("Message") textarea').fill(`Updated draft meet-up note for ${planTitle}.`);
      await planRow.getByRole('button', { name: 'Update draft' }).click();
      await expect(page.getByText('Schedule notification draft saved')).toBeVisible();
      await expect(planRow.getByLabel('Schedule notification history').getByText(`Updated draft meet-up note for ${planTitle}.`)).toBeVisible();
      await planRow.getByRole('button', { name: 'Send draft' }).click();
      await expect(page.getByText('Schedule notification draft sent')).toBeVisible();
      await expect(planRow.getByText('Local notification sent')).toBeVisible();
      await expect(planRow.getByLabel('Schedule notification record').getByText(`Updated draft meet-up note for ${planTitle}.`)).toBeVisible();
      await expect(planRow.getByText('No push, device, or email delivery was used.')).toBeVisible();
      await expect(planRow.getByLabel('Schedule notification history')).toBeVisible();
      await expect(planRow.getByText('Notification history')).toBeVisible();
      await expect(planRow.getByLabel('Delivery attempt summary')).toBeVisible();
      await expect(planRow.getByLabel('Delivery attempt readback')).toBeVisible();
      await expect(planRow.getByLabel('Delivery attempt summary').getByText('1 local attempt')).toBeVisible();
      await expect(planRow.getByLabel('Delivery attempt readback').getByText('1 local attempt')).toBeVisible();
      await expect(planRow.getByText('Local audit only. This is not push, email, or device delivery.')).toBeVisible();
      await expect(planRow.getByText('Local record and audit only. No push, device, or email delivery.')).toBeVisible();
      await expect(planRow.getByLabel('Shared attendance').getByText('People')).toBeVisible();
      await expect(planRow.getByLabel('Shared attendance').getByText('Groups')).toBeVisible();
      await expect(planRow.getByLabel('Shared attendance').getByText('Reid', { exact: true })).toBeVisible();
      await expect(planRow.getByLabel('Shared attendance').getByText('Panel crew', { exact: true })).toBeVisible();
      const inboxPanel = page.locator('details').filter({ hasText: 'Notification inbox' }).first();
      await expect(inboxPanel).toBeVisible();
      await inboxPanel.locator('summary').click();
      await expect(inboxPanel.getByLabel('Schedule notification inbox')).toBeVisible();
      await expect(inboxPanel.getByLabel('Notification inbox filter')).toBeVisible();
      await expect(inboxPanel.getByText('1 local recipient record')).toBeVisible();
      await expect(inboxPanel.getByLabel('Schedule notification inbox').getByText(`Updated draft meet-up note for ${planTitle}.`).first()).toBeVisible();
      await expect(inboxPanel.getByText('1 linked to you')).toBeVisible();
      await inboxPanel.getByRole('button', { name: 'Mine' }).click();
      await expect(inboxPanel.getByText('1 local recipient record')).toBeVisible();
      await inboxPanel.getByRole('button', { name: 'All' }).click();
      await expect(inboxPanel.getByText('1 local recipient record')).toBeVisible();
      await expect(inboxPanel.getByText('Event-local readback only. This is not push, email, or device delivery.')).toBeVisible();
      await inboxPanel.getByRole('button', { name: 'Acknowledge' }).first().click();
      await expect(page.getByText('Notification acknowledged')).toBeVisible();
      await expect(inboxPanel.getByText('Acknowledged', { exact: true })).toBeVisible();
      await planRow.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Schedule plan updated')).toBeVisible();
      await expect(planRow.locator('summary span').filter({ hasText: /^backup$/ })).toBeVisible();

      const plansResponse = await userRequestContext.get(`/api/events/${eventId}/schedule-plans`);
      expect(plansResponse.ok()).toBeTruthy();
      const plansPayload = await plansResponse.json();
      const updated = plansPayload.items.find((item) => item.title === planTitle);
      expect(updated?.status).toBe('backup');
      expect(updated?.visibility).toBe('event_workspace');
      expect(updated?.vendor).toBe('Artist signing table');
      expect(updated?.booth).toBe('6DE-B');
      expect(updated?.location_notes).toBe('Queue at the rear exit.');
      expect(updated?.notes).toBe('Backup if the first panel is full.');
    } finally {
      await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', false).catch(() => {});
      }
      await userRequestContext.dispose();
      await adminRequestContext.dispose();
    }
  });

  test('event drawer can add edit and schedule catalog sessions', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminRequestContext = await createAuthenticatedRequestContext(adminCredentials);
    const userCredentials = await createFreshUserCredentials();
    const userRequestContext = await createAuthenticatedRequestContext(userCredentials);
    const suffix = Date.now();
    const eventTitle = `Playwright Catalog Session ${suffix}`;
    const sessionTitle = 'Creature Design Catalog Workshop';
    const originalFlagsPayload = await getFeatureFlags(adminRequestContext);
    const originalFlags = Array.isArray(originalFlagsPayload?.flags) ? originalFlagsPayload.flags : [];
    const originalEventsEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'events_enabled')?.enabled);

    await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});

    try {
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', true);
      }

      const eventResponse = await postWithCsrf(userRequestContext, '/api/events', {
        title: eventTitle,
        url: `https://example.test/catalog-session/${suffix}`,
        location: 'San Diego Convention Center',
        date_start: '2026-07-23',
        date_end: '2026-07-26'
      }, 201);
      const eventPayload = await eventResponse.json();
      const eventId = Number(eventPayload?.id || 0);
      expect(eventId).toBeGreaterThan(0);

      await page.setViewportSize({ width: 390, height: 844 });
      await signInThroughUi(page, userCredentials);
      await page.goto('/dashboard?tab=library-events');
      await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
      await page.getByPlaceholder('Search title or location…').fill(eventTitle);
      await expect(page.getByText(eventTitle, { exact: true }).first()).toBeVisible();
      await page.locator('article').filter({ hasText: eventTitle }).first().click();
      await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible();

      const catalogSection = page.locator('details').filter({ hasText: 'Catalog' }).first();
      await catalogSection.locator('summary').first().click();
      await catalogSection.locator('summary').filter({ hasText: 'Add catalog session' }).click();
      await catalogSection.getByPlaceholder('Session title').fill(sessionTitle);
      await catalogSection.getByPlaceholder('Track').fill('Art');
      await catalogSection.getByPlaceholder('Location').fill('Room 6A');
      await catalogSection.getByPlaceholder('Room').fill('6A');
      await catalogSection.getByPlaceholder('Categories, comma separated').fill('Workshop, Art');
      await catalogSection.getByPlaceholder('Session URL').fill('https://example.test/catalog/workshop');
      await catalogSection.getByPlaceholder('Description').fill('Catalog session created from the Event drawer.');
      await catalogSection.getByRole('button', { name: 'Add catalog session' }).click();
      await expect(page.getByText('Catalog session added')).toBeVisible();

      const sessionRow = page.locator('details details').filter({ hasText: sessionTitle }).first();
      await expect(sessionRow).toBeVisible();
      await sessionRow.locator('summary').click();
      await sessionRow.locator('label:has-text("Track") input').fill('Comics Art');
      await sessionRow.locator('label:has-text("Categories") input').fill('Workshop, Drawing');
      await sessionRow.locator('label:has-text("Status") select').selectOption('cancelled');
      await sessionRow.getByRole('button', { name: 'Save catalog session' }).click();
      await expect(page.getByText('Catalog session updated')).toBeVisible();
      await expect(sessionRow.locator('summary span').filter({ hasText: /^cancelled$/ })).toBeVisible();

      await sessionRow.getByLabel(`Plan state for ${sessionTitle}`).selectOption('planned');
      await expect(page.getByText('Catalog session added as planned')).toBeVisible();
      await expect(sessionRow.getByLabel(`Plan state for ${sessionTitle}`)).toHaveValue('planned');

      const sessionsResponse = await userRequestContext.get(`/api/events/${eventId}/schedule-sessions`);
      expect(sessionsResponse.ok()).toBeTruthy();
      const sessionsPayload = await sessionsResponse.json();
      const session = sessionsPayload.items.find((item) => item.title === sessionTitle);
      expect(session?.status).toBe('cancelled');
      expect(session?.track).toBe('Comics Art');
      expect(session?.categories).toEqual(['Workshop', 'Drawing']);

      const plansResponse = await userRequestContext.get(`/api/events/${eventId}/schedule-plans`);
      expect(plansResponse.ok()).toBeTruthy();
      const plansPayload = await plansResponse.json();
      const linkedPlan = plansPayload.items.find((item) => item.source_type === 'schedule_catalog' && item.source_ref === String(session.id));
      expect(linkedPlan?.title).toBe(sessionTitle);
      expect(linkedPlan?.status).toBe('planned');
      expect(linkedPlan?.visibility).toBe('private');
    } finally {
      await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', false).catch(() => {});
      }
      await userRequestContext.dispose();
      await adminRequestContext.dispose();
    }
  });

  test('event drawer shows catalog now and next sessions', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminRequestContext = await createAuthenticatedRequestContext(adminCredentials);
    const userCredentials = await createFreshUserCredentials();
    const userRequestContext = await createAuthenticatedRequestContext(userCredentials);
    const suffix = Date.now();
    const eventTitle = `Playwright Catalog Now Next ${suffix}`;
    const currentTitle = 'Now Running Catalog Panel';
    const nextTitle = 'Next Catalog Drawing Demo';
    const laterTitle = 'Later Catalog Trivia Meetup';
    const browserNow = new Date();
    browserNow.setHours(12, 0, 0, 0);
    const now = browserNow.getTime();
    const originalFlagsPayload = await getFeatureFlags(adminRequestContext);
    const originalFlags = Array.isArray(originalFlagsPayload?.flags) ? originalFlagsPayload.flags : [];
    const originalEventsEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'events_enabled')?.enabled);

    await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});

    try {
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', true);
      }

      const eventResponse = await postWithCsrf(userRequestContext, '/api/events', {
        title: eventTitle,
        url: `https://example.test/catalog-now-next/${suffix}`,
        location: 'San Diego Convention Center',
        date_start: new Date(now).toISOString().slice(0, 10),
        date_end: new Date(now + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      }, 201);
      const eventPayload = await eventResponse.json();
      const eventId = Number(eventPayload?.id || 0);
      expect(eventId).toBeGreaterThan(0);

      const currentResponse = await postWithCsrf(userRequestContext, `/api/events/${eventId}/schedule-sessions`, {
        title: currentTitle,
        start_at: new Date(now - 10 * 60 * 1000).toISOString(),
        end_at: new Date(now + 50 * 60 * 1000).toISOString(),
        location: 'Convention Center',
        room: 'Room 6DE',
        track: 'Comics',
        categories: ['Panel'],
        source_type: 'manual',
        status: 'active'
      }, 201);
      const currentPayload = await currentResponse.json();
      const currentId = Number(currentPayload?.id || 0);
      expect(currentId).toBeGreaterThan(0);

      await postWithCsrf(userRequestContext, `/api/events/${eventId}/schedule-sessions`, {
        title: nextTitle,
        start_at: new Date(now + 40 * 60 * 1000).toISOString(),
        end_at: new Date(now + 100 * 60 * 1000).toISOString(),
        location: 'Convention Center',
        room: 'Room 7AB',
        track: 'Art',
        categories: ['Workshop'],
        source_type: 'manual',
        status: 'active'
      }, 201);
      await postWithCsrf(userRequestContext, `/api/events/${eventId}/schedule-sessions`, {
        title: laterTitle,
        start_at: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now + 3 * 60 * 60 * 1000).toISOString(),
        location: 'Convention Center',
        room: 'Ballroom 20',
        track: 'Games',
        categories: ['Trivia'],
        source_type: 'manual',
        status: 'active'
      }, 201);
      await postWithCsrf(userRequestContext, `/api/events/${eventId}/schedule-plans`, {
        title: currentTitle,
        start_at: new Date(now - 10 * 60 * 1000).toISOString(),
        end_at: new Date(now + 50 * 60 * 1000).toISOString(),
        location: 'Room 6DE',
        source_type: 'schedule_catalog',
        source_ref: String(currentId),
        status: 'planned',
        visibility: 'private'
      }, 201);
      await postWithCsrf(userRequestContext, `/api/events/${eventId}/schedule-plans`, {
        title: 'Shared Catalog Backup',
        start_at: new Date(now - 10 * 60 * 1000).toISOString(),
        end_at: new Date(now + 50 * 60 * 1000).toISOString(),
        location: 'Room 6DE',
        source_type: 'schedule_catalog',
        source_ref: String(currentId),
        status: 'backup',
        visibility: 'group'
      }, 201);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.clock.setFixedTime(browserNow);
      await signInThroughUi(page, userCredentials);
      await page.goto('/dashboard?tab=library-events');
      await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
      await page.getByPlaceholder('Search title or location…').fill(eventTitle);
      await expect(page.getByText(eventTitle, { exact: true }).first()).toBeVisible();
      await page.locator('article').filter({ hasText: eventTitle }).first().click();
      await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible();

      const catalogSection = page.locator('details').filter({ hasText: 'Catalog' }).first();
      await catalogSection.locator('summary').first().click();
      const nowNext = page.getByLabel('Catalog now and next');
      await expect(nowNext).toBeVisible();
      await expect(nowNext.getByText('Now / Next')).toBeVisible();
      await expect(nowNext.locator('p').filter({ hasText: /^Now$/ })).toBeVisible();
      await expect(nowNext.getByText(currentTitle, { exact: true })).toBeVisible();
      await expect(nowNext.getByText('Planned').nth(1)).toBeVisible();
      await expect(nowNext.getByText('Shared: 1 backup').first()).toBeVisible();
      await expect(nowNext.getByLabel('Session presence').getByText('Shared: 1 backup')).toBeVisible();
      await expect(nowNext.locator('p').filter({ hasText: /^Next$/ })).toBeVisible();
      await expect(nowNext.getByText(nextTitle, { exact: true })).toBeVisible();
      await expect(nowNext.getByText(laterTitle, { exact: true })).toBeVisible();
      await expect(nowNext.getByText(/Room 6DE/)).toBeVisible();
      await expect(nowNext.getByText(/Room 7AB/)).toBeVisible();
      await expect(nowNext.getByText(/Ballroom 20/)).toBeVisible();
      await expect(nowNext.getByText(`Conflicts with ${currentTitle}`).first()).toBeVisible();

      const timeWindowFilters = nowNext.getByLabel('Catalog time window filters');
      await expect(timeWindowFilters.getByRole('button', { name: /All\s+3/ })).toBeVisible();
      await expect(timeWindowFilters.getByRole('button', { name: /Now\s+1/ })).toBeVisible();
      await expect(timeWindowFilters.getByRole('button', { name: /Next\s+1/ })).toBeVisible();
      await expect(timeWindowFilters.getByRole('button', { name: /Later Today\s+1/ })).toBeVisible();
      await expect(timeWindowFilters.getByRole('button', { name: /Planned\s+1/ })).toBeVisible();
      await timeWindowFilters.getByRole('button', { name: /Later Today\s+1/ }).click();
      await expect(nowNext.getByText(laterTitle, { exact: true })).toBeVisible();
      await expect(nowNext.getByText(currentTitle, { exact: true })).not.toBeVisible();
      await expect(nowNext.getByText(nextTitle, { exact: true })).not.toBeVisible();
      await timeWindowFilters.getByRole('button', { name: /Planned\s+1/ }).click();
      await expect(nowNext.getByText(currentTitle, { exact: true })).toBeVisible();
      await expect(nowNext.getByText(nextTitle, { exact: true })).not.toBeVisible();
      await expect(nowNext.getByText(laterTitle, { exact: true })).not.toBeVisible();
      await timeWindowFilters.getByRole('button', { name: /All\s+3/ }).click();
      await expect(nowNext.getByText(currentTitle, { exact: true })).toBeVisible();
      await expect(nowNext.getByText(nextTitle, { exact: true })).toBeVisible();
      await expect(nowNext.getByText(laterTitle, { exact: true })).toBeVisible();

      const catalogList = catalogSection.getByLabel('Schedule catalog sessions');
      const catalogFilters = catalogList.getByLabel('Catalog filters');
      await expect(catalogFilters.getByText('3 of 3')).toBeVisible();
      await catalogFilters.getByLabel('Catalog plan state filter').selectOption('none');
      await expect(catalogList.getByText(nextTitle, { exact: true })).toBeVisible();
      await expect(catalogList.getByText(currentTitle, { exact: true })).not.toBeVisible();
      await expect(catalogList.getByText(laterTitle, { exact: true })).toBeVisible();
      await catalogFilters.getByRole('button', { name: 'Clear' }).click();
      await catalogFilters.getByRole('button', { name: 'Has shared attendance' }).click();
      await expect(catalogList.getByText(currentTitle, { exact: true })).toBeVisible();
      await expect(catalogList.getByText(nextTitle, { exact: true })).not.toBeVisible();
      await expect(catalogList.getByText(laterTitle, { exact: true })).not.toBeVisible();
      await catalogFilters.getByRole('button', { name: 'Clear' }).click();
      await catalogFilters.getByRole('button', { name: 'Conflicts only' }).click();
      await expect(catalogList.getByText(nextTitle, { exact: true })).toBeVisible();
      await expect(catalogList.getByText(currentTitle, { exact: true })).not.toBeVisible();
      await catalogFilters.getByRole('button', { name: 'Clear' }).click();
      await catalogFilters.getByLabel('Catalog track filter').selectOption('Comics');
      await expect(catalogList.getByText(currentTitle, { exact: true })).toBeVisible();
      await expect(catalogList.getByText(nextTitle, { exact: true })).not.toBeVisible();
      await catalogFilters.getByRole('button', { name: 'Clear' }).click();
      await catalogFilters.getByLabel('Catalog category filter').selectOption('Workshop');
      await expect(catalogList.getByText(nextTitle, { exact: true })).toBeVisible();
      await expect(catalogList.getByText(currentTitle, { exact: true })).not.toBeVisible();
      await catalogFilters.getByRole('button', { name: 'Clear' }).click();
      await catalogFilters.getByLabel('Catalog room or location filter').selectOption('Room 7AB');
      await expect(catalogList.getByText(nextTitle, { exact: true })).toBeVisible();
      await expect(catalogList.getByText(currentTitle, { exact: true })).not.toBeVisible();
      await catalogFilters.getByRole('button', { name: 'Clear' }).click();

      await nowNext.getByLabel(`Session actions for ${nextTitle}`).getByRole('button', { name: 'Backup' }).click();
      const nextResolution = nowNext.getByLabel('Schedule conflict resolution');
      await expect(nextResolution).toBeVisible();
      await expect(nextResolution.getByText(`Conflicts with ${currentTitle}`)).toBeVisible();
      await nextResolution.getByRole('button', { name: 'Mark as backup' }).click();
      await expect(page.getByText('Catalog session kept as backup')).toBeVisible();
      await expect(nowNext.getByLabel(`Plan state for ${nextTitle}`)).toHaveValue('backup');
      await nowNext.getByLabel(`Plan state for ${currentTitle}`).selectOption('maybe');
      const currentResolution = nowNext.getByLabel('Schedule conflict resolution');
      await expect(currentResolution).toBeVisible();
      await expect(currentResolution.getByText(`Conflicts with ${nextTitle}`)).toBeVisible();
      await currentResolution.getByRole('button', { name: 'Keep both' }).click();
      await expect(page.getByText('Catalog session kept as maybe')).toBeVisible();
      await expect(nowNext.getByLabel(`Plan state for ${currentTitle}`)).toHaveValue('maybe');
      await nowNext.getByLabel(`Session actions for ${nextTitle}`).getByRole('button', { name: 'Replace with this' }).click();
      await expect(page.getByText('Catalog session planned; conflicts moved to backup')).toBeVisible();
      await expect(nowNext.getByLabel(`Plan state for ${nextTitle}`)).toHaveValue('planned');
      await nowNext.getByLabel(`Session actions for ${nextTitle}`).getByRole('button', { name: 'Leave' }).click();
      await expect(page.getByText('Catalog session marked skipped')).toBeVisible();
      await expect(nowNext.getByLabel(`Plan state for ${nextTitle}`)).toHaveValue('skipped');
      await nowNext.getByLabel(`Session actions for ${nextTitle}`).getByRole('button', { name: 'Join' }).click();
      await expect(page.getByText('Catalog session marked planned')).toBeVisible();
      await expect(nowNext.getByLabel(`Plan state for ${nextTitle}`)).toHaveValue('planned');

      const plansResponse = await userRequestContext.get(`/api/events/${eventId}/schedule-plans`);
      expect(plansResponse.ok()).toBeTruthy();
      const plansPayload = await plansResponse.json();
      const currentPlan = plansPayload.items.find((item) => item.source_type === 'schedule_catalog' && item.source_ref === String(currentId));
      const nextPlan = plansPayload.items.find((item) => item.source_type === 'schedule_catalog' && item.title === nextTitle);
      expect(currentPlan?.status).toBe('backup');
      expect(nextPlan?.status).toBe('planned');
      expect(nextPlan?.visibility).toBe('private');

      const scheduleSection = page.locator('details').filter({ hasText: 'Schedule' }).first();
      await expect(scheduleSection.getByText(`Conflicts with ${nextTitle}`).first()).toBeVisible();
      await expect(scheduleSection.getByText(`Conflicts with ${currentTitle}`).first()).toBeVisible();
    } finally {
      await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', false).catch(() => {});
      }
      await userRequestContext.dispose();
      await adminRequestContext.dispose();
    }
  });

  test('art signature provenance round-trips through the shared signature record contract', async () => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminRequestContext = await createAuthenticatedRequestContext(adminCredentials);
    const userCredentials = await createFreshUserCredentials();
    const userRequestContext = await createAuthenticatedRequestContext(userCredentials);
    const artTitle = `Playwright Signed Art ${Date.now()}`;
    const originalFlagsPayload = await getFeatureFlags(adminRequestContext);
    const originalFlags = Array.isArray(originalFlagsPayload?.flags) ? originalFlagsPayload.flags : [];
    const originalCollectiblesEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'collectibles_enabled')?.enabled);

    await deleteArtByExactTitle(userRequestContext, artTitle).catch(() => {});
    try {
      if (!originalCollectiblesEnabled) {
        await updateFeatureFlag(adminRequestContext, 'collectibles_enabled', true);
      }

      const createResponse = await postWithCsrf(userRequestContext, '/api/art', {
        title: artTitle,
        artist: 'Playwright Artist',
        medium: 'print',
        height: 18,
        width: 24,
        dimension_unit: 'cm',
        framed: true,
        print_number: 12,
        print_run: 100,
        signed: true,
        signer_name: 'Playwright Signer',
        signer_role: 'Artist',
        signed_on: '2026-04-26',
        signed_at: 'Playwright Signing Table',
        signature_proof_path: 'https://example.test/signature-proof.jpg',
        signature_notes: 'Witnessed during the shared signature provenance regression.'
      }, 201);
      const created = await createResponse.json();
      expect(created.signed).toBe(true);
      expect(created.height).toBe(18);
      expect(created.width).toBe(24);
      expect(created.dimension_unit).toBe('cm');
      expect(created.framed).toBe(true);
      expect(created.print_number).toBe(12);
      expect(created.print_run).toBe(100);
      expect(created.signer_name).toBe('Playwright Signer');
      expect(created.signatures?.[0]?.signer_name).toBe('Playwright Signer');
      expect(created.signatures?.[0]?.proof_path).toBe('https://example.test/signature-proof.jpg');

      const patchResponse = await patchWithCsrf(userRequestContext, `/api/art/${created.id}`, {
        signed: true,
        signer_name: 'Updated Playwright Signer',
        signer_role: 'Writer',
        height: 20.5,
        width: 30.25,
        dimension_unit: 'in',
        framed: false,
        print_number: 13,
        print_run: null,
        signed_on: '2026-04-27',
        signed_at: 'Updated Signing Table',
        signature_notes: 'Updated provenance note.'
      }, 200);
      const patched = await patchResponse.json();
      expect(patched.signatures).toHaveLength(1);
      expect(patched.signatures[0].signer_name).toBe('Updated Playwright Signer');
      expect(patched.height).toBe(20.5);
      expect(patched.width).toBe(30.25);
      expect(patched.dimension_unit).toBe('in');
      expect(patched.framed).toBe(false);
      expect(patched.print_number).toBe(13);
      expect(patched.print_run).toBeNull();
      expect(patched.signatures[0].signed_on).toBe('2026-04-27');
      expect(patched.signature_notes).toBe('Updated provenance note.');

      const primarySignatureId = patched.signatures[0].id;
      const csrfToken = await fetchCsrfToken(userRequestContext);
      const uploadResponse = await userRequestContext.post(`/api/art/${created.id}/signatures/${primarySignatureId}/proof`, {
        multipart: {
          proof_type: 'photo',
          label: 'Signing table photo',
          notes: 'Photo taken at the signing table.',
          proof: {
            name: 'signature-proof.png',
            mimeType: 'image/png',
            buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64')
          }
        },
        headers: { 'x-csrf-token': csrfToken }
      });
      expect(uploadResponse.ok()).toBeTruthy();
      const uploaded = await uploadResponse.json();
      expect(uploaded.signature_proof_path).toBeTruthy();
      expect(uploaded.signature.proof_path).toBeTruthy();
      expect(uploaded.signature.proofs).toHaveLength(2);
      expect(uploaded.proof.proof_type).toBe('photo');
      expect(uploaded.proof.label).toBe('Signing table photo');

      const extraProofCsrfToken = await fetchCsrfToken(userRequestContext);
      const extraProofResponse = await userRequestContext.post(`/api/art/${created.id}/signatures/${primarySignatureId}/proof`, {
        multipart: {
          proof: {
            name: 'signature-extra-proof.png',
            mimeType: 'image/png',
            buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64')
          }
        },
        headers: { 'x-csrf-token': extraProofCsrfToken }
      });
      expect(extraProofResponse.ok()).toBeTruthy();
      const extraProof = await extraProofResponse.json();
      expect(extraProof.signature.proofs).toHaveLength(3);
      const nonPrimaryProof = extraProof.signature.proofs.find((proof) => !proof.is_primary);
      expect(nonPrimaryProof?.id).toBeTruthy();
      const metadataResponse = await patchWithCsrf(userRequestContext, `/api/art/${created.id}/signatures/${primarySignatureId}/proofs/${nonPrimaryProof.id}`, {
        proof_type: 'coa',
        label: 'Certificate of authenticity',
        notes: 'COA entered after upload.'
      });
      expect(metadataResponse.ok()).toBeTruthy();
      const metadata = await metadataResponse.json();
      expect(metadata.proof.proof_type).toBe('coa');
      expect(metadata.proof.label).toBe('Certificate of authenticity');
      const removeExtraProofResponse = await requestWithCsrf(userRequestContext, 'DELETE', `/api/art/${created.id}/signatures/${primarySignatureId}/proofs/${nonPrimaryProof.id}`);
      expect(removeExtraProofResponse.ok()).toBeTruthy();
      const removedExtraProof = await removeExtraProofResponse.json();
      expect(removedExtraProof.signature.proofs).toHaveLength(2);

      const secondaryResponse = await postWithCsrf(userRequestContext, `/api/art/${created.id}/signatures`, {
        signer_name: 'Second Playwright Signer',
        signer_role: 'Colorist',
        signed_on: '2026-04-28',
        signed_at: 'Second Signing Table',
        notes: 'Secondary signature evidence.'
      }, 201);
      const secondary = await secondaryResponse.json();
      expect(secondary.signatures).toHaveLength(2);
      expect(secondary.signature.is_primary).toBe(false);

      const secondaryProofCsrfToken = await fetchCsrfToken(userRequestContext);
      const secondaryProofResponse = await userRequestContext.post(`/api/art/${created.id}/signatures/${secondary.signature.id}/proof`, {
        multipart: {
          proof: {
            name: 'secondary-signature-proof.png',
            mimeType: 'image/png',
            buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64')
          }
        },
        headers: { 'x-csrf-token': secondaryProofCsrfToken }
      });
      expect(secondaryProofResponse.ok()).toBeTruthy();
      const secondaryProof = await secondaryProofResponse.json();
      expect(secondaryProof.signature.proof_path).toBeTruthy();
      expect(secondaryProof.signature.proofs).toHaveLength(1);

      const promoteResponse = await requestWithCsrf(userRequestContext, 'POST', `/api/art/${created.id}/signatures/${secondary.signature.id}/primary`);
      expect(promoteResponse.ok()).toBeTruthy();
      const promoted = await promoteResponse.json();
      expect(promoted.signature.is_primary).toBe(true);
      expect(promoted.art.signer_name).toBe('Second Playwright Signer');
      expect(promoted.art.signature_proof_path).toBeTruthy();

      const detailResponse = await userRequestContext.get(`/api/art/${created.id}`);
      expect(detailResponse.ok()).toBeTruthy();
      const detail = await detailResponse.json();
      expect(detail.signatures).toHaveLength(2);
      expect(detail.signer_name).toBe('Second Playwright Signer');
      expect(detail.height).toBe(20.5);
      expect(detail.width).toBe(30.25);
      expect(detail.dimension_unit).toBe('in');
      expect(detail.framed).toBe(false);
      expect(detail.print_number).toBe(13);
      expect(detail.print_run).toBeNull();
      expect(detail.signatures[0].owner_type).toBe('art');
      expect(detail.signatures[0].is_primary).toBe(true);

      const removeResponse = await requestWithCsrf(userRequestContext, 'DELETE', `/api/art/${created.id}/signatures/${secondary.signature.id}/proof`);
      const removed = await removeResponse.json();
      expect(removed.removed).toBe(true);
      expect(removed.signature_proof_path).toBeNull();

      const archiveResponse = await requestWithCsrf(userRequestContext, 'DELETE', `/api/art/${created.id}/signatures/${secondary.signature.id}`);
      expect(archiveResponse.ok()).toBeTruthy();
      const archived = await archiveResponse.json();
      expect(archived.signatures).toHaveLength(1);
      expect(archived.art.signer_name).toBe('Updated Playwright Signer');
    } finally {
      await deleteArtByExactTitle(userRequestContext, artTitle).catch(() => {});
      if (!originalCollectiblesEnabled) {
        await updateFeatureFlag(adminRequestContext, 'collectibles_enabled', false).catch(() => {});
      }
      await adminRequestContext.dispose();
      await userRequestContext.dispose();
    }
  });

  test('event drawer links an autograph artifact to an Art signature record', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminRequestContext = await createAuthenticatedRequestContext(adminCredentials);
    const userCredentials = await createFreshUserCredentials();
    const userRequestContext = await createAuthenticatedRequestContext(userCredentials);
    const suffix = Date.now();
    const eventTitle = `Playwright Autograph Link Event ${suffix}`;
    const artTitle = `Playwright Autographed Art ${suffix}`;
    const autographTitle = `Playwright Autograph ${suffix}`;
    const originalFlagsPayload = await getFeatureFlags(adminRequestContext);
    const originalFlags = Array.isArray(originalFlagsPayload?.flags) ? originalFlagsPayload.flags : [];
    const originalEventsEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'events_enabled')?.enabled);
    const originalCollectiblesEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'collectibles_enabled')?.enabled);

    await deleteArtByExactTitle(userRequestContext, artTitle).catch(() => {});
    await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});

    try {
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', true);
      }
      if (!originalCollectiblesEnabled) {
        await updateFeatureFlag(adminRequestContext, 'collectibles_enabled', true);
      }

      const eventResponse = await postWithCsrf(userRequestContext, '/api/events', {
        title: eventTitle,
        url: `https://example.test/autograph-link/${suffix}`,
        location: 'Playwright Signing Hall',
        date_start: '2026-04-26'
      }, 201);
      const eventPayload = await eventResponse.json();
      expect(Number(eventPayload?.id || 0)).toBeGreaterThan(0);

      const artResponse = await postWithCsrf(userRequestContext, '/api/art', {
        title: artTitle,
        artist: 'Playwright Signature Artist',
        series: 'Signature Link Series',
        medium: 'print',
        signed: false
      }, 201);
      const artPayload = await artResponse.json();
      const nativeArtId = Number(artPayload?.native_art_id || artPayload?.id || 0);
      expect(nativeArtId).toBeGreaterThan(0);

      const artifactResponse = await postWithCsrf(userRequestContext, `/api/events/${eventPayload.id}/artifacts`, {
        artifact_type: 'autograph',
        title: autographTitle,
        description: 'Captured in the Event drawer linking regression.',
        image_path: 'https://example.test/event-autograph-proof.jpg',
        signer_name: 'Playwright Signature Artist',
        signer_role: 'Artist',
        signed_on: '2026-04-26',
        signed_at: 'Playwright Signing Table',
        proof_path: 'https://example.test/event-autograph-proof.jpg',
        signature_notes: 'This autograph should attach to the Art signature record.'
      }, 201);
      const artifactPayload = await artifactResponse.json();
      expect(artifactPayload.event_artifact_signature?.signer_name).toBe('Playwright Signature Artist');

      await signInThroughUi(page, userCredentials);
      await page.goto('/dashboard?tab=library-events');
      await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();

      await page.getByPlaceholder('Search title or location…').fill(eventTitle);
      await expect(page.getByText(eventTitle, { exact: true }).first()).toBeVisible();
      await page.locator('article').filter({ hasText: eventTitle }).first().click();
      await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible();
      await expect(page.getByText(autographTitle, { exact: true })).toBeVisible();
      await expect(page.getByText('Playwright Signature Artist · Artist · 04/26/2026 · Playwright Signing Table')).toBeVisible();

      const autographPanel = page.locator('div').filter({ hasText: autographTitle }).filter({ hasText: 'Event autograph' }).first();
      await autographPanel.getByRole('button', { name: 'Link signature' }).click();
      await autographPanel.locator('label:has-text("Target") select').selectOption('art');
      await autographPanel.getByPlaceholder('Title, artist, series, or fandom').fill(artTitle);
      await autographPanel.getByRole('button', { name: 'Search' }).click();
      await expect(autographPanel.getByText(artTitle, { exact: true })).toBeVisible();
      await autographPanel
        .locator('article')
        .filter({ hasText: artTitle })
        .getByRole('button', { name: 'Link', exact: true })
        .click();

      await expect(page.getByText(`Linked to Art #${nativeArtId}`).first()).toBeVisible();

      const detailResponse = await userRequestContext.get(`/api/art/${nativeArtId}`);
      expect(detailResponse.ok()).toBeTruthy();
      const detail = await detailResponse.json();
      expect(detail.signed).toBe(true);
      expect(detail.signatures?.[0]?.signer_name).toBe('Playwright Signature Artist');
      expect(detail.signatures?.[0]?.signed_event_id).toBe(eventPayload.id);
    } finally {
      await deleteArtByExactTitle(userRequestContext, artTitle).catch(() => {});
      await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', false).catch(() => {});
      }
      if (!originalCollectiblesEnabled) {
        await updateFeatureFlag(adminRequestContext, 'collectibles_enabled', false).catch(() => {});
      }
      await userRequestContext.dispose();
      await adminRequestContext.dispose();
    }
  });

  test('end user can create an event, link a collectible to it, and find that link in the collectible detail view', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminRequestContext = await createAuthenticatedRequestContext(adminCredentials);
    const userCredentials = await createFreshUserCredentials();
    const userRequestContext = await createAuthenticatedRequestContext(userCredentials);
    const eventTitle = `Playwright Event ${Date.now()}`;
    const collectibleTitle = `Playwright Collectible ${Date.now()}`;
    const eventUrl = `https://example.test/events/${Date.now()}`;
    const eventDate = '2026-04-10';
    const originalFlagsPayload = await getFeatureFlags(adminRequestContext);
    const originalFlags = Array.isArray(originalFlagsPayload?.flags) ? originalFlagsPayload.flags : [];
    const originalEventsEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'events_enabled')?.enabled);
    const originalCollectiblesEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'collectibles_enabled')?.enabled);

    await deleteCollectiblesByExactTitle(userRequestContext, collectibleTitle).catch(() => {});
    await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});

    try {
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', true);
      }
      if (!originalCollectiblesEnabled) {
        await updateFeatureFlag(adminRequestContext, 'collectibles_enabled', true);
      }

      await signInThroughUi(page, userCredentials);

      await page.goto('/dashboard?tab=library-movies');
      await expect(page.getByRole('button', { name: 'Events' })).toBeVisible();
      await page.getByRole('button', { name: 'Events' }).click();
      await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
      await page.getByRole('button', { name: 'Add' }).click();
      await expect(page.getByRole('heading', { name: 'Add Event' })).toBeVisible();
      await page.locator('label:has-text("Title *") input').fill(eventTitle);
      await page.locator('label:has-text("URL *") input').fill(eventUrl);
      await page.locator('label:has-text("Location *") input').fill('Playwright Convention Center');
      await page.locator('label:has-text("Start Date *") input').fill(eventDate);
      await page.locator('label:has-text("Host") input').fill('Playwright Host');

      const createEventResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/events')
          && response.request().method() === 'POST'
      ));
      await page.getByRole('button', { name: 'Save' }).click();
      const createEventResponse = await createEventResponsePromise;
      expect(createEventResponse.status()).toBe(201);
      await expect(page.getByText(eventTitle, { exact: true }).first()).toBeVisible();

      await expect(page.getByRole('button', { name: 'Collectibles' })).toBeVisible();
      await page.getByRole('button', { name: 'Collectibles' }).click();
      await expect(page.getByRole('heading', { name: 'Collectibles' })).toBeVisible();
      await page.getByRole('button', { name: 'Add' }).click();
      await expect(page.getByRole('heading', { name: 'Add Collectible' })).toBeVisible();
      await page.locator('label:has-text("Title *") input').fill(collectibleTitle);
      await page.locator('label:has-text("Fandom / Franchise") input').fill('Playwright Universe');
      await page.locator('label:has-text("Category") select').selectOption('funko');
      await page.locator('label:has-text("Linked Event") select').selectOption({ label: eventTitle });
      await page.locator('label:has-text("Vendor") input').fill('Playwright Vendor');

      const createCollectibleResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/collectibles')
          && response.request().method() === 'POST'
      ));
      await page.getByRole('button', { name: 'Save' }).click();
      const createCollectibleResponse = await createCollectibleResponsePromise;
      expect(createCollectibleResponse.status()).toBe(201);

      const collectibleSearch = page.getByPlaceholder('Search…');
      await collectibleSearch.fill(collectibleTitle);
      await expect(page.getByText(collectibleTitle, { exact: true }).first()).toBeVisible();

      await page.locator('article').filter({ hasText: collectibleTitle }).first().click();
      await expect(page.getByRole('heading', { name: collectibleTitle })).toBeVisible();
      await expect(page.getByText('Playwright Universe', { exact: true }).first()).toBeVisible();
      await expect(page.getByText(eventTitle, { exact: true }).first()).toBeVisible();
    } finally {
      await deleteCollectiblesByExactTitle(userRequestContext, collectibleTitle).catch(() => {});
      await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', false).catch(() => {});
      }
      if (!originalCollectiblesEnabled) {
        await updateFeatureFlag(adminRequestContext, 'collectibles_enabled', false).catch(() => {});
      }
      await userRequestContext.dispose();
      await adminRequestContext.dispose();
    }
  });

  test('art drawer shows purchase vendor and booth only when event context exists', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminRequestContext = await createAuthenticatedRequestContext(adminCredentials);
    const userCredentials = await createFreshUserCredentials();
    const userRequestContext = await createAuthenticatedRequestContext(userCredentials);
    const eventTitle = `Playwright Art Event ${Date.now()}`;
    const artWithoutEventTitle = `Playwright Standalone Art ${Date.now()}`;
    const artWithEventTitle = `Playwright Event Art ${Date.now()}`;
    const originalFlagsPayload = await getFeatureFlags(adminRequestContext);
    const originalFlags = Array.isArray(originalFlagsPayload?.flags) ? originalFlagsPayload.flags : [];
    const originalEventsEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'events_enabled')?.enabled);
    const originalCollectiblesEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'collectibles_enabled')?.enabled);

    await deleteArtByExactTitle(userRequestContext, artWithoutEventTitle).catch(() => {});
    await deleteArtByExactTitle(userRequestContext, artWithEventTitle).catch(() => {});
    await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});

    try {
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', true);
      }
      if (!originalCollectiblesEnabled) {
        await updateFeatureFlag(adminRequestContext, 'collectibles_enabled', true);
      }

      await signInThroughUi(page, userCredentials);

      await page.goto('/dashboard?tab=library-events');
      await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
      await page.getByRole('button', { name: 'Add' }).click();
      await expect(page.getByRole('heading', { name: 'Add Event' })).toBeVisible();
      await page.locator('label:has-text("Title *") input').fill(eventTitle);
      await page.locator('label:has-text("URL *") input').fill(`https://example.test/art-events/${Date.now()}`);
      await page.locator('label:has-text("Location *") input').fill('Playwright Gallery');
      await page.locator('label:has-text("Start Date *") input').fill('2026-04-11');
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText(eventTitle, { exact: true }).first()).toBeVisible();

      await page.getByRole('button', { name: 'Art' }).click();
      await expect(page.getByRole('heading', { name: 'Art' })).toBeVisible();
      await page.getByRole('button', { name: 'Add' }).click();
      await expect(page.getByRole('heading', { name: 'Add Art' })).toBeVisible();
      await expect(page.locator('label:has-text("Vendor") input')).toHaveCount(0);
      await expect(page.locator('label:has-text("Booth") input')).toHaveCount(0);
      await page.locator('label:has-text("Title *") input').fill(artWithoutEventTitle);
      await page.locator('label:has-text("Series") input').fill('Standalone Series');
      await page.locator('label:has-text("Artist") input').fill('Playwright Artist');
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText(artWithoutEventTitle, { exact: true }).first()).toBeVisible();

      await page.getByRole('button', { name: 'Add' }).click();
      await expect(page.getByRole('heading', { name: 'Add Art' })).toBeVisible();
      await page.locator('label:has-text("Title *") input').fill(artWithEventTitle);
      await page.locator('label:has-text("Series") input').fill('Event Series');
      await page.locator('label:has-text("Linked Event") select').selectOption({ label: eventTitle });
      await expect(page.locator('label:has-text("Vendor") input')).toBeVisible();
      await expect(page.locator('label:has-text("Booth") input')).toBeVisible();
      await page.locator('label:has-text("Artist") input').fill('Playwright Event Artist');
      await page.locator('label:has-text("Vendor") input').fill('Playwright Studio');
      await page.locator('label:has-text("Booth") input').fill('A12');
      await page.getByLabel('Framed').check();
      await page.getByLabel('Exclusive item').check();
      await page.getByLabel('Signed').check();
      await expect(page.getByLabel('Framed')).toBeChecked();
      await expect(page.getByLabel('Exclusive item')).toBeChecked();
      await expect(page.getByLabel('Signed')).toBeChecked();
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText(artWithEventTitle, { exact: true }).first()).toBeVisible();

      const artSearchForSignatures = page.getByPlaceholder('Search…');
      await artSearchForSignatures.fill(artWithEventTitle);
      await page.locator('article').filter({ hasText: artWithEventTitle }).first().click();
      await expect(page.getByRole('heading', { name: artWithEventTitle })).toBeVisible();
      await page.getByRole('button', { name: 'Edit' }).click();
      await expect(page.getByRole('heading', { name: 'Edit Art' })).toBeVisible();
      await page.getByRole('tab', { name: '2. Signatures' }).click();
      const signaturePanel = page.locator('[data-tab-panel="signatures"]');
      const signatureManager = signaturePanel.locator('[data-signature-manager]');
      await signatureManager.getByRole('button', { name: 'Add signature' }).click();
      await signatureManager.locator('#signature-new-signer').fill('Primary Playwright Artist');
      await signatureManager.locator('#signature-new-role').fill('Artist');
      await signatureManager.locator('#signature-new-date').fill('2026-04-29');
      await signatureManager.locator('#signature-new-location').fill('Playwright Signing Table');
      await signatureManager.locator('#signature-new-notes').fill('Primary drawer-managed signature.');
      await signatureManager.getByRole('button', { name: 'Add signature' }).click();
      await expect(signatureManager.getByText('Primary Playwright Artist')).toBeVisible();

      await signatureManager.getByRole('button', { name: 'Add signature' }).click();
      await signatureManager.locator('#signature-new-signer').fill('Secondary Playwright Artist');
      await signatureManager.locator('#signature-new-role').fill('Writer');
      await signatureManager.locator('#signature-new-date').fill('2026-04-30');
      await signatureManager.locator('#signature-new-notes').fill('Secondary drawer-managed signature.');
      await signatureManager.getByRole('button', { name: 'Add signature' }).click();
      await expect(signatureManager.getByText('Secondary Playwright Artist')).toBeVisible();

      const secondarySignatureRow = signatureManager.locator('[data-signature-row]').filter({ hasText: 'Secondary Playwright Artist' }).first();
      await secondarySignatureRow.getByRole('button', { name: 'Make primary' }).click();
      const promotedSignatureRow = signatureManager.locator('[data-signature-row]').filter({ hasText: 'Secondary Playwright Artist' }).first();
      await expect(promotedSignatureRow.locator('.badge').getByText('Primary', { exact: true })).toBeVisible();
      await promotedSignatureRow.getByRole('button', { name: 'Edit' }).click();
      const activeSignatureEditor = signatureManager.locator('[data-signature-editing="true"]');
      await activeSignatureEditor.locator('textarea[id$="-notes"]').fill('Edited secondary signature note.');
      await activeSignatureEditor.getByRole('button', { name: 'Save signature' }).click();
      await expect(signatureManager.getByText('Edited secondary signature note.')).toBeVisible();

      const formerPrimarySignatureRow = signatureManager.locator('[data-signature-row]').filter({ hasText: 'Primary Playwright Artist' }).first();
      page.once('dialog', (dialog) => dialog.accept());
      await formerPrimarySignatureRow.getByRole('button', { name: 'Remove signature' }).click();
      await expect(signatureManager.getByText('Primary Playwright Artist')).toHaveCount(0);
      await page.getByRole('button', { name: 'Cancel' }).click();

      const artSearch = page.getByPlaceholder('Search…');
      await artSearch.fill(artWithEventTitle);
      await expect(page.getByText(artWithEventTitle, { exact: true }).first()).toBeVisible();
      await page.locator('article').filter({ hasText: artWithEventTitle }).first().click();
      await expect(page.getByRole('heading', { name: artWithEventTitle })).toBeVisible();
      await expect(page.getByText('Playwright Studio', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('A12', { exact: true }).first()).toBeVisible();
      await expect(page.getByText(eventTitle, { exact: true }).first()).toBeVisible();
    } finally {
      await deleteArtByExactTitle(userRequestContext, artWithoutEventTitle).catch(() => {});
      await deleteArtByExactTitle(userRequestContext, artWithEventTitle).catch(() => {});
      await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', false).catch(() => {});
      }
      if (!originalCollectiblesEnabled) {
        await updateFeatureFlag(adminRequestContext, 'collectibles_enabled', false).catch(() => {});
      }
      await userRequestContext.dispose();
      await adminRequestContext.dispose();
    }
  });

  test('event detail can search, link, and edit native art purchase links', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminRequestContext = await createAuthenticatedRequestContext(adminCredentials);
    const userCredentials = await createFreshUserCredentials();
    const userRequestContext = await createAuthenticatedRequestContext(userCredentials);
    const suffix = Date.now();
    const eventTitle = `Playwright Purchase Link Event ${suffix}`;
    const artTitle = `Playwright Comic Panel Purchase ${suffix}`;
    const originalFlagsPayload = await getFeatureFlags(adminRequestContext);
    const originalFlags = Array.isArray(originalFlagsPayload?.flags) ? originalFlagsPayload.flags : [];
    const originalEventsEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'events_enabled')?.enabled);
    const originalCollectiblesEnabled = Boolean(originalFlags.find((flag) => flag?.key === 'collectibles_enabled')?.enabled);

    await deleteArtByExactTitle(userRequestContext, artTitle).catch(() => {});
    await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});

    try {
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', true);
      }
      if (!originalCollectiblesEnabled) {
        await updateFeatureFlag(adminRequestContext, 'collectibles_enabled', true);
      }

      const eventResponse = await postWithCsrf(userRequestContext, '/api/events', {
        title: eventTitle,
        url: `https://example.test/event-purchase-link/${suffix}`,
        location: 'Playwright Hall',
        date_start: '2026-04-12'
      }, 201);
      const eventPayload = await eventResponse.json();
      expect(Number(eventPayload?.id || 0)).toBeGreaterThan(0);

      const artResponse = await postWithCsrf(userRequestContext, '/api/art', {
        title: artTitle,
        artist: 'Playwright Artist',
        series: 'Purchase Link Series',
        franchise: 'Playwright Franchise',
        medium: 'comic_panel',
        vendor: 'Original Studio',
        booth: 'C4',
        price: 40,
        signed: true
      }, 201);
      const artPayload = await artResponse.json();
      expect(Number(artPayload?.native_art_id || 0)).toBeGreaterThan(0);

      await signInThroughUi(page, userCredentials);
      await page.goto('/dashboard?tab=library-events');
      await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();

      await page.getByPlaceholder('Search title or location…').fill(eventTitle);
      await expect(page.getByText(eventTitle, { exact: true }).first()).toBeVisible();
      await page.locator('article').filter({ hasText: eventTitle }).first().click();
      await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible();

      const purchaseSection = page.locator('section').filter({ hasText: 'Tracked purchases' }).first();
      await expect(purchaseSection.getByText('No tracked Art or Collectibles purchases')).toBeVisible();
      await purchaseSection.getByRole('button', { name: 'Link item' }).click();
      await purchaseSection.locator('label:has-text("Library") select').selectOption('art');
      await purchaseSection.getByPlaceholder('Title, fandom, artist, or series').fill(artTitle);
      await purchaseSection.getByRole('button', { name: 'Search' }).click();
      await expect(purchaseSection.getByText(artTitle, { exact: true })).toBeVisible();
      await expect(purchaseSection.getByText('Art · Playwright Franchise · comic panel · Playwright Artist')).toBeVisible();

      await purchaseSection
        .locator('article')
        .filter({ hasText: artTitle })
        .getByRole('button', { name: 'Link', exact: true })
        .click();
      await expect(purchaseSection.getByText(`${artTitle} linked to this event`, { exact: true })).toBeVisible();
      await expect(purchaseSection.getByText('Original Studio / C4')).toBeVisible();

      await purchaseSection.getByLabel(`Edit purchase details for ${artTitle}`).click();
      await purchaseSection.locator('label:has-text("Vendor") input').fill('Updated Studio');
      await purchaseSection.locator('label:has-text("Booth") input').fill('D8');
      await purchaseSection.locator('label:has-text("Price") input').fill('55');
      await purchaseSection.getByRole('button', { name: 'Save' }).click();
      await expect(purchaseSection.getByText('Purchase details saved', { exact: true })).toBeVisible();
      await expect(purchaseSection.getByText('Updated Studio / D8')).toBeVisible();
      await expect(purchaseSection.getByText('$55')).toBeVisible();
    } finally {
      await deleteArtByExactTitle(userRequestContext, artTitle).catch(() => {});
      await deleteEventsByExactTitle(userRequestContext, eventTitle).catch(() => {});
      if (!originalEventsEnabled) {
        await updateFeatureFlag(adminRequestContext, 'events_enabled', false).catch(() => {});
      }
      if (!originalCollectiblesEnabled) {
        await updateFeatureFlag(adminRequestContext, 'collectibles_enabled', false).catch(() => {});
      }
      await userRequestContext.dispose();
      await adminRequestContext.dispose();
    }
  });
});
