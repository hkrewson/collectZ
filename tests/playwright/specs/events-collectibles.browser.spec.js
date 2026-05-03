'use strict';

const { test, expect } = require('@playwright/test');
const {
  ensureSavedAdminCredentials,
  createFreshUserCredentials,
  createAuthenticatedRequestContext,
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
    const userCredentials = await createFreshUserCredentials();

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
  });

  test('mobile event drawer shows a compact social overview before admin sections', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminRequestContext = await createAuthenticatedRequestContext(adminCredentials);
    const userCredentials = await createFreshUserCredentials();
    const userRequestContext = await createAuthenticatedRequestContext(userCredentials);
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

      await postWithCsrf(userRequestContext, `/api/events/${eventId}/attendees`, {
        display_name: 'Reid',
        relationship: 'friend',
        link_current_user: true,
        status: 'attending',
        visibility: 'private'
      }, 201);
      const groupResponse = await postWithCsrf(userRequestContext, `/api/events/${eventId}/groups`, {
        name: 'Artist Alley Crew',
        visibility: 'group'
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

      await page.setViewportSize({ width: 390, height: 844 });
      await signInThroughUi(page, userCredentials);
      await page.goto('/dashboard?tab=library-events');
      await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
      await page.getByPlaceholder('Search title or location…').fill(eventTitle);
      await expect(page.getByText(eventTitle, { exact: true }).first()).toBeVisible();
      await page.locator('article').filter({ hasText: eventTitle }).first().click();
      await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible();

      const overview = page.getByLabel('Mobile event social overview');
      await expect(overview).toBeVisible();
      await expect(overview.getByText('People', { exact: true })).toBeVisible();
      await expect(overview.getByText('Groups', { exact: true })).toBeVisible();
      await expect(overview.getByText('Meetups', { exact: true })).toBeVisible();
      await expect(overview.getByText('Spotlight on Playwright')).toBeVisible();
      await expect(overview.getByText('Meet outside Hall H')).toBeVisible();
      await expect(overview.getByText('Reid')).toBeVisible();
      await expect(overview.getByText('Groups: Artist Alley Crew')).toBeVisible();
      await expect(overview.getByText(/Room 6DE .* Shared/)).toBeVisible();
      await expect(overview.getByText(/Hall H doors .* Hall H Cafe .* Booth HH-12 .* Group/)).toBeVisible();
      const peoplePanel = page.locator('summary').filter({ hasText: /^People/ }).locator('xpath=..').first();
      await peoplePanel.locator('summary').click();
      await expect(peoplePanel.getByText('Reid')).toBeVisible();
      await expect(peoplePanel.getByText('Private', { exact: true })).toBeVisible();
      const groupsPanel = page.locator('summary').filter({ hasText: /^Groups/ }).locator('xpath=..').first();
      await groupsPanel.locator('summary').click();
      await expect(groupsPanel.getByText('Artist Alley Crew')).toBeVisible();
      await expect(groupsPanel.getByText('Group', { exact: true })).toBeVisible();
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
    const now = Date.now();
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
      await expect(nowNext.getByText('Now', { exact: true })).toBeVisible();
      await expect(nowNext.getByText(currentTitle, { exact: true })).toBeVisible();
      await expect(nowNext.locator('span').filter({ hasText: /^Planned$/ })).toBeVisible();
      await expect(nowNext.getByText('Shared: 1 backup').first()).toBeVisible();
      await expect(nowNext.getByText('Next', { exact: true })).toBeVisible();
      await expect(nowNext.getByText(nextTitle, { exact: true })).toBeVisible();
      await expect(nowNext.getByText(/Room 6DE/)).toBeVisible();
      await expect(nowNext.getByText(/Room 7AB/)).toBeVisible();
      await expect(nowNext.getByText(`Conflicts with ${currentTitle}`).first()).toBeVisible();

      const catalogList = catalogSection.getByLabel('Schedule catalog sessions');
      const catalogFilters = catalogList.getByLabel('Catalog filters');
      await expect(catalogFilters.getByText('2 of 2')).toBeVisible();
      await catalogFilters.getByLabel('Catalog plan state filter').selectOption('none');
      await expect(catalogList.getByText(nextTitle, { exact: true })).toBeVisible();
      await expect(catalogList.getByText(currentTitle, { exact: true })).not.toBeVisible();
      await catalogFilters.getByRole('button', { name: 'Clear' }).click();
      await catalogFilters.getByRole('button', { name: 'Has shared attendance' }).click();
      await expect(catalogList.getByText(currentTitle, { exact: true })).toBeVisible();
      await expect(catalogList.getByText(nextTitle, { exact: true })).not.toBeVisible();
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
