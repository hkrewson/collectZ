'use strict';

const { test, expect } = require('@playwright/test');
const {
  ensureSavedAdminCredentials,
  createFreshUserCredentials,
  createAuthenticatedRequestContext,
  postWithCsrf
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
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText(artWithEventTitle, { exact: true }).first()).toBeVisible();

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
