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
      expect(created.signer_name).toBe('Playwright Signer');
      expect(created.signatures?.[0]?.signer_name).toBe('Playwright Signer');
      expect(created.signatures?.[0]?.proof_path).toBe('https://example.test/signature-proof.jpg');

      const patchResponse = await patchWithCsrf(userRequestContext, `/api/art/${created.id}`, {
        signed: true,
        signer_name: 'Updated Playwright Signer',
        signer_role: 'Writer',
        signed_on: '2026-04-27',
        signed_at: 'Updated Signing Table',
        signature_notes: 'Updated provenance note.'
      }, 200);
      const patched = await patchResponse.json();
      expect(patched.signatures).toHaveLength(1);
      expect(patched.signatures[0].signer_name).toBe('Updated Playwright Signer');
      expect(patched.signatures[0].signed_on).toBe('2026-04-27');
      expect(patched.signature_notes).toBe('Updated provenance note.');

      const csrfToken = await fetchCsrfToken(userRequestContext);
      const uploadResponse = await userRequestContext.post(`/api/art/${created.id}/upload-signature-proof`, {
        multipart: {
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

      const promoteResponse = await requestWithCsrf(userRequestContext, 'POST', `/api/art/${created.id}/signatures/${secondary.signature.id}/primary`);
      expect(promoteResponse.ok()).toBeTruthy();
      const promoted = await promoteResponse.json();
      expect(promoted.signature.is_primary).toBe(true);
      expect(promoted.art.signer_name).toBe('Second Playwright Signer');

      const detailResponse = await userRequestContext.get(`/api/art/${created.id}`);
      expect(detailResponse.ok()).toBeTruthy();
      const detail = await detailResponse.json();
      expect(detail.signatures).toHaveLength(2);
      expect(detail.signer_name).toBe('Second Playwright Signer');
      expect(detail.signatures[0].owner_type).toBe('art');
      expect(detail.signatures[0].is_primary).toBe(true);

      const removeResponse = await requestWithCsrf(userRequestContext, 'DELETE', `/api/art/${created.id}/signature-proof`);
      const removed = await removeResponse.json();
      expect(removed.removed).toBe(false);
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
