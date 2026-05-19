'use strict';

const { test, expect } = require('@playwright/test');
const { createSpaceFixture, deleteSpace } = require('../helpers/admin');
const { ensureSavedAdminCredentials, createAuthenticatedRequestContext, fetchCsrfToken, postWithCsrf, requestWithCsrf } = require('../helpers/auth');
const { deleteMediaByExactTitle } = require('../helpers/media');
const { signInThroughUi } = require('../helpers/session');

test.use({ storageState: { cookies: [], origins: [] } });

async function findCollectionsByName(requestContext, name) {
  const response = await requestContext.get(`/api/media/collections?search=${encodeURIComponent(name)}&limit=20`);
  if (!response.ok()) {
    const text = await response.text();
    throw new Error(`Failed to list collections for "${name}" (${response.status()}): ${text}`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.items) ? payload.items.filter((item) => String(item?.name || '') === String(name)) : [];
}

test.describe('admin shell browser regressions', () => {
  test('dashboard command center is the default dashboard landing view', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    await signInThroughUi(page, adminCredentials);
    const summaryResponse = page.waitForResponse((response) => (
      response.url().includes('/api/dashboard/summary') && response.request().method() === 'GET'
    ));
    await page.goto('/dashboard');
    const response = await summaryResponse;
    expect(response.ok()).toBeTruthy();
    const summary = await response.json();
    expect(summary?.attention_details).toBeTruthy();
    expect(Array.isArray(summary?.attention_details?.missing_cover_items)).toBeTruthy();
    expect(Array.isArray(summary?.attention_details?.missing_identifier_items)).toBeTruthy();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Needs attention sections' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Failed syncs/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Missing covers/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Missing identifiers/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Provider health' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quick actions' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Latest failures' })).toHaveCount(0);
    const recentSyncsPanel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recent syncs' }) });
    await expect(recentSyncsPanel.getByRole('button', { name: /^Import$/ })).toHaveCount(0);
    if (Number(summary?.collection?.missing_covers || 0) > 0) {
      const mediaReviewResponse = page.waitForResponse((mediaResponse) => (
        mediaResponse.url().includes('/api/media')
        && mediaResponse.url().includes('review_filter=missing_covers')
        && mediaResponse.request().method() === 'GET'
      ));
      await page.getByRole('button', { name: /Open missing covers review/i }).click();
      const reviewResponse = await mediaReviewResponse;
      expect(reviewResponse.ok()).toBeTruthy();
      await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
      await expect(page.getByText('Missing covers across all library types')).toBeVisible();
    }
  });

  test('wishlist foundation lists wanted items and converts media wants', async ({ page }) => {
    const suffix = Date.now();
    const title = `Playwright Wishlist ${suffix}`;
    const adminCredentials = await ensureSavedAdminCredentials();
    const requestContext = await createAuthenticatedRequestContext(adminCredentials);
    let wishlistId = null;

    try {
      await deleteMediaByExactTitle(requestContext, title).catch(() => {});
      const createResponse = await postWithCsrf(requestContext, '/api/wishlist', {
        title,
        object_type: 'book',
        desired_format: 'Paperback',
        desired_edition: 'First printing',
        identifiers: { isbn: `978000${String(suffix).slice(-7)}` },
        source_context: { source: 'playwright' }
      }, 201);
      const createPayload = await createResponse.json();
      wishlistId = Number(createPayload?.item?.id || 0);
      expect(wishlistId).toBeGreaterThan(0);

      await signInThroughUi(page, adminCredentials);
      const wishlistResponse = page.waitForResponse((response) => (
        response.url().includes('/api/wishlist') && response.request().method() === 'GET'
      ));
      await page.goto('/dashboard?tab=library-wishlist');
      expect((await wishlistResponse).ok()).toBeTruthy();
      await expect(page.getByRole('heading', { name: 'Wishlist', exact: true })).toBeVisible();
      await expect(page.getByText(title, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add item' })).toBeVisible();

      const convertResponse = await postWithCsrf(requestContext, `/api/wishlist/${wishlistId}/convert`, {}, 201);
      const convertPayload = await convertResponse.json();
      expect(convertPayload?.ok).toBe(true);
      expect(convertPayload?.media?.title).toBe(title);
      expect(convertPayload?.item?.status).toBe('acquired');

      const acquiredResponse = await requestContext.get(`/api/wishlist?status=acquired&search=${encodeURIComponent(title)}`);
      expect(acquiredResponse.ok()).toBeTruthy();
      const acquiredPayload = await acquiredResponse.json();
      expect(acquiredPayload?.items?.some((item) => item.id === wishlistId && item.linked_media_id === convertPayload.media.id)).toBeTruthy();
    } finally {
      if (wishlistId) {
        await requestWithCsrf(requestContext, 'DELETE', `/api/wishlist/${wishlistId}`, undefined, [200, 404]).catch(() => {});
      }
      await deleteMediaByExactTitle(requestContext, title).catch(() => {});
      await requestContext.dispose();
    }
  });

  test('capture inbox foundation receives quick captures and converts to wishlist', async ({ page }) => {
    const suffix = Date.now();
    const title = `Playwright Capture ${suffix}`;
    const photoTitle = `Playwright Photo Capture ${suffix}`;
    const clientCaptureId = `playwright-capture-${suffix}`;
    const photoClientCaptureId = `playwright-photo-${suffix}`;
    const adminCredentials = await ensureSavedAdminCredentials();
    const requestContext = await createAuthenticatedRequestContext(adminCredentials);
    let captureId = null;
    let photoCaptureId = null;
    let wantedItemId = null;
    let catalogMediaId = null;

    try {
      const createResponse = await postWithCsrf(requestContext, '/api/capture-items', {
        title,
        capture_type: 'barcode',
        object_type: 'book',
        barcode: `978000${String(suffix).slice(-7)}`,
        symbology: 'EAN-13',
        client_capture_id: clientCaptureId,
        client_source: 'playwright-browser',
        source_context: { source: 'playwright' }
      }, 201);
      const createPayload = await createResponse.json();
      captureId = Number(createPayload?.item?.id || 0);
      expect(captureId).toBeGreaterThan(0);
      expect(createPayload?.item?.client_capture_id).toBe(clientCaptureId);

      const retryResponse = await postWithCsrf(requestContext, '/api/capture-items', {
        title,
        capture_type: 'barcode',
        object_type: 'book',
        barcode: createPayload.item.barcode,
        symbology: 'EAN-13',
        client_capture_id: clientCaptureId,
        client_source: 'playwright-browser',
        notes: 'Retried from offline queue'
      });
      const retryPayload = await retryResponse.json();
      expect(retryPayload?.idempotent).toBe(true);
      expect(retryPayload?.idempotency?.replayed).toBe(true);
      expect(retryPayload?.idempotency?.status).toBe('matched');
      expect(Number(retryPayload?.item?.id || 0)).toBe(captureId);
      expect(retryPayload?.item?.notes).toBe('Retried from offline queue');

      const conflictRetryResponse = await postWithCsrf(requestContext, '/api/capture-items', {
        title: `${title} conflicting replay`,
        capture_type: 'barcode',
        object_type: 'book',
        barcode: '9780553572391',
        symbology: 'ISBN-13',
        client_capture_id: clientCaptureId,
        client_source: 'playwright-browser'
      });
      const conflictRetryPayload = await conflictRetryResponse.json();
      expect(conflictRetryPayload?.idempotent).toBe(true);
      expect(conflictRetryPayload?.idempotency?.status).toBe('needs_review');
      expect(Number(conflictRetryPayload?.item?.id || 0)).toBe(captureId);
      expect(conflictRetryPayload?.item?.barcode).toBe(createPayload.item.barcode);
      expect(conflictRetryPayload?.replay_conflicts?.some((conflict) => conflict.field === 'barcode')).toBeTruthy();
      expect(conflictRetryPayload?.item?.review_decision?.capture_replay_last_status).toBe('needs_review');

      const csrfToken = await fetchCsrfToken(requestContext);
      const uploadResponse = await requestContext.post('/api/capture-items/upload-image', {
        headers: { 'x-csrf-token': csrfToken },
        multipart: {
          title: photoTitle,
          object_type: 'book',
          notes: 'Photo capture from browser regression',
          client_capture_id: photoClientCaptureId,
          client_source: 'playwright-browser',
          image: {
            name: `capture-${suffix}.png`,
            mimeType: 'image/png',
            buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64')
          }
        }
      });
      expect(uploadResponse.status()).toBe(201);
      const uploadPayload = await uploadResponse.json();
      photoCaptureId = Number(uploadPayload?.item?.id || 0);
      expect(photoCaptureId).toBeGreaterThan(0);
      expect(uploadPayload?.item?.capture_type).toBe('photo');
      expect(uploadPayload?.item?.image_path).toContain('/uploads/');
      expect(uploadPayload?.item?.client_capture_id).toBe(photoClientCaptureId);

      const retryUploadResponse = await requestContext.post('/api/capture-items/upload-image', {
        headers: { 'x-csrf-token': csrfToken },
        multipart: {
          title: photoTitle,
          object_type: 'book',
          notes: 'Retried photo capture from browser regression',
          client_capture_id: photoClientCaptureId,
          client_source: 'playwright-browser',
          image: {
            name: `capture-retry-${suffix}.png`,
            mimeType: 'image/png',
            buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64')
          }
        }
      });
      expect(retryUploadResponse.status()).toBe(200);
      const retryUploadPayload = await retryUploadResponse.json();
      expect(retryUploadPayload?.idempotent).toBe(true);
      expect(retryUploadPayload?.idempotency?.status).toBe('matched');
      expect(Number(retryUploadPayload?.item?.id || 0)).toBe(photoCaptureId);
      expect(retryUploadPayload?.item?.image_path).toBe(uploadPayload.item.image_path);

      const ocrResponse = await postWithCsrf(requestContext, `/api/capture-items/${photoCaptureId}/ocr-text`, {
        ocr_text: 'Back cover OCR ISBN 0-553-57239-3',
        source: 'playwright'
      });
      const ocrPayload = await ocrResponse.json();
      const isbnCandidate = ocrPayload?.candidates?.find((candidate) => candidate.barcode === '9780553572391');
      expect(isbnCandidate).toBeTruthy();

      const applyOcrResponse = await postWithCsrf(requestContext, `/api/capture-items/${photoCaptureId}/apply-ocr-candidate`, {
        candidate_id: isbnCandidate.id
      });
      const applyOcrPayload = await applyOcrResponse.json();
      expect(applyOcrPayload?.item?.barcode).toBe('9780553572391');
      expect(applyOcrPayload?.item?.object_type).toBe('book');

      const catalogMediaResponse = await postWithCsrf(requestContext, '/api/media', {
        title: `${photoTitle} Catalog Match`,
        media_type: 'book',
        format: 'Paperback',
        owned_formats: ['paperback'],
        upc: '9780553572391',
        type_details: {
          isbn: '9780553572391',
          author: 'Michael P. Kube-McDowell'
        }
      }, 201);
      const catalogMediaPayload = await catalogMediaResponse.json();
      catalogMediaId = Number(catalogMediaPayload?.id || 0);
      expect(catalogMediaId).toBeGreaterThan(0);

      const lookupResponse = await postWithCsrf(requestContext, `/api/capture-items/${photoCaptureId}/lookup-matches`, { limit: 6 });
      const lookupPayload = await lookupResponse.json();
      expect(lookupPayload?.matches?.some((match) => Number(match.media_id || 0) === catalogMediaId)).toBeTruthy();
      expect(lookupPayload?.item?.review_decision?.capture_lookup_matches?.length).toBeGreaterThan(0);

      await signInThroughUi(page, adminCredentials);
      const captureResponse = page.waitForResponse((response) => (
        response.url().includes('/api/capture-items') && response.request().method() === 'GET'
      ));
      await page.goto('/dashboard?tab=library-capture');
      expect((await captureResponse).ok()).toBeTruthy();
      await expect(page.getByRole('heading', { name: 'Capture Inbox', exact: true })).toBeVisible();
      await expect(page.getByText(title, { exact: true })).toBeVisible();
      await expect(page.getByText(photoTitle, { exact: true })).toBeVisible();
      const replayConflictReview = page.getByLabel('Replay conflict review').first();
      await expect(replayConflictReview.getByText('Replay conflict', { exact: true })).toBeVisible();
      await expect(replayConflictReview.getByText('Barcode', { exact: true })).toBeVisible();
      await expect(replayConflictReview.getByText(`Current: ${createPayload.item.barcode}`)).toBeVisible();
      await expect(replayConflictReview.getByText('Replayed: 9780553572391')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Use replayed values' })).toBeVisible();
      const resolveResponse = page.waitForResponse((response) => (
        response.url().includes(`/api/capture-items/${captureId}/resolve-replay-conflict`)
        && response.request().method() === 'POST'
      ));
      await page.getByRole('button', { name: 'Keep current' }).click();
      expect((await resolveResponse).ok()).toBeTruthy();
      await expect(page.getByLabel('Replay conflict review')).toHaveCount(0);
      await expect(page.locator(`img[src*="${uploadPayload.item.image_path}"]`)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Read image text' })).toBeVisible();
      await expect(page.getByText('OCR candidates')).toBeVisible();
      await expect(page.getByRole('button', { name: /Using ISBN 9780553572391/ })).toBeVisible();
      const photoCaptureRow = page.locator('div').filter({ hasText: photoTitle }).filter({ hasText: 'Find matches' }).first();
      await expect(photoCaptureRow.getByLabel('Capture lookup matches')).toBeVisible();
      await expect(photoCaptureRow.getByText('Matches', { exact: true })).toBeVisible();
      await expect(photoCaptureRow.getByText('In library')).toBeVisible();
      await expect(page.getByRole('button', { name: 'New capture' })).toBeVisible();

      const convertResponse = await postWithCsrf(requestContext, `/api/capture-items/${captureId}/convert-wishlist`, {}, 201);
      const convertPayload = await convertResponse.json();
      expect(convertPayload?.ok).toBe(true);
      wantedItemId = Number(convertPayload?.wanted_item?.id || 0);
      expect(wantedItemId).toBeGreaterThan(0);
      expect(convertPayload?.item?.status).toBe('converted');

      const wishlistResponse = await requestContext.get(`/api/wishlist?status=active&search=${encodeURIComponent(title)}`);
      expect(wishlistResponse.ok()).toBeTruthy();
      const wishlistPayload = await wishlistResponse.json();
      expect(wishlistPayload?.items?.some((item) => item.id === wantedItemId && item.provider === 'capture')).toBeTruthy();
    } finally {
      if (captureId) {
        await requestWithCsrf(requestContext, 'DELETE', `/api/capture-items/${captureId}`, undefined, [200, 404]).catch(() => {});
      }
      if (photoCaptureId) {
        await requestWithCsrf(requestContext, 'DELETE', `/api/capture-items/${photoCaptureId}`, undefined, [200, 404]).catch(() => {});
      }
      if (wantedItemId) {
        await requestWithCsrf(requestContext, 'DELETE', `/api/wishlist/${wantedItemId}`, undefined, [200, 404]).catch(() => {});
      }
      if (catalogMediaId) {
        await requestWithCsrf(requestContext, 'DELETE', `/api/media/${catalogMediaId}`, undefined, [200, 404]).catch(() => {});
      }
      await requestContext.dispose();
    }
  });

  test('authenticated admin shell loads and docs surface is available when debug gating is satisfied', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    await signInThroughUi(page, adminCredentials);
    await page.goto('/dashboard?tab=help');
    await expect(page.getByRole('heading', { name: 'HELP ADMIN' })).toBeVisible();

    await page.goto('/api/docs');
    await expect(page).toHaveTitle(/collectZ API Docs/i);
    await expect(page.locator('#swagger-ui')).toBeVisible();
  });

  test('all spaces drawer tabs and support-session banner behave in the browser', async ({ page }) => {
    const suffix = Date.now();
    const adminCredentials = await ensureSavedAdminCredentials();
    const requestContext = await createAuthenticatedRequestContext(adminCredentials);
    const { space } = await createSpaceFixture(requestContext, suffix);
    let cleanupPending = true;

    try {
      await requestContext.delete('/api/auth/support-session').catch(() => {});
      await signInThroughUi(page, adminCredentials);
      await page.goto('/dashboard?tab=admin-spaces');
      await expect(page.getByRole('heading', { name: 'All Workspaces' })).toBeVisible();

      await page.getByRole('heading', { name: space.name }).click();
      await expect(page.getByRole('heading', { name: 'Workspace Controls' })).toBeVisible();

      await page.getByRole('tab', { name: /Members \(/ }).click();
      await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

      await page.getByRole('tab', { name: /Invitations \(/ }).click();
      await expect(page.getByRole('heading', { name: 'Invitations' })).toBeVisible();

      await page.getByRole('button', { name: 'Start Support Session' }).first().click();
      await expect(page.getByRole('heading', { name: new RegExp(`Open explicit support access for ${space.name}`) })).toBeVisible();

      await page.getByLabel('Reason').fill(`Playwright support session ${suffix}`);
      await page.getByRole('button', { name: 'Start Support Session' }).last().click();

      await expect(page.getByText('Support session active')).toBeVisible();
      await expect(page.getByText(new RegExp(`Reason: Playwright support session ${suffix}`))).toBeVisible();

      await page.getByRole('button', { name: 'End support session' }).click();
      await expect(page.getByText('Support session active')).toHaveCount(0);
    } finally {
      await requestContext.delete('/api/auth/support-session').catch(() => {});
      if (cleanupPending) {
        await deleteSpace(requestContext, Number(space.id)).catch(() => {});
      }
      await requestContext.dispose();
    }
  });

  test('integrations tabs switch and save feedback stays visible', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    await signInThroughUi(page, adminCredentials);
    await page.goto('/dashboard?tab=admin-integrations&integration=logs');
    await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();

    const sectionTabs = page.getByRole('tablist', { name: 'Integration sections' });
    await expect(sectionTabs.getByRole('tab')).toHaveText([
      'Audio',
      'Barcode',
      'Books',
      'CWA OPDS',
      'Comics',
      'PriceCharting',
      'eBay Browse',
      'Games',
      'Kavita',
      'External Logs',
      'Metrics',
      'Plex',
      'TMDB'
    ]);

    await sectionTabs.getByRole('tab', { name: 'Metrics', exact: true }).click();
    const metricsSwitch = page.getByRole('switch', { name: /Metrics Export/i });
    await expect(metricsSwitch).toBeVisible();

    const wasEnabled = await metricsSwitch.getAttribute('aria-checked');
    const toggleResponsePromise = page.waitForResponse((response) => (
      response.url().includes('/api/admin/feature-flags/metrics_enabled')
      && response.request().method() === 'PATCH'
    ));
    await metricsSwitch.click();
    const toggleResponse = await toggleResponsePromise;
    expect(toggleResponse.ok()).toBeTruthy();
    await expect(metricsSwitch).toHaveAttribute('aria-checked', wasEnabled === 'true' ? 'false' : 'true');

    const restoreResponsePromise = page.waitForResponse((response) => (
      response.url().includes('/api/admin/feature-flags/metrics_enabled')
      && response.request().method() === 'PATCH'
    ));
    await metricsSwitch.click();
    const restoreResponse = await restoreResponsePromise;
    expect(restoreResponse.ok()).toBeTruthy();
    await expect(metricsSwitch).toHaveAttribute('aria-checked', wasEnabled || 'false');
  });

  test('manual merge review previews, applies same-type candidates, and blocks cross-type pairs', async ({ page }) => {
    const suffix = Date.now();
    const adminCredentials = await ensureSavedAdminCredentials();
    const requestContext = await createAuthenticatedRequestContext(adminCredentials);
    const canonicalTitle = `Playwright Manual Merge Book ${suffix}`;
    const movieTitle = `Playwright Manual Merge Movie ${suffix}`;
    const createdIds = [];

    await deleteMediaByExactTitle(requestContext, canonicalTitle).catch(() => {});
    await deleteMediaByExactTitle(requestContext, movieTitle).catch(() => {});

    try {
      const canonicalResponse = await postWithCsrf(requestContext, '/api/media', {
        title: canonicalTitle,
        media_type: 'book',
        year: 2024,
        owned_formats: ['digital'],
        type_details: {
          author: 'Hugh Howey',
          isbn: '9780358447849',
          publisher: 'Mariner Books'
        }
      }, 201);
      const canonical = await canonicalResponse.json();
      createdIds.push(Number(canonical.id));

      const duplicateResponse = await postWithCsrf(requestContext, '/api/media', {
        title: canonicalTitle,
        media_type: 'book',
        year: 2024,
        owned_formats: ['paperback'],
        type_details: {
          author: 'Hugh Howey',
          isbn: '9780358447849',
          publisher: 'Mariner Books'
        }
      }, 201);
      const duplicate = await duplicateResponse.json();
      createdIds.push(Number(duplicate.id));

      const movieResponse = await postWithCsrf(requestContext, '/api/media', {
        title: movieTitle,
        media_type: 'movie',
        year: 1999,
        owned_formats: ['digital']
      }, 201);
      const movie = await movieResponse.json();
      createdIds.push(Number(movie.id));

      await signInThroughUi(page, adminCredentials);
      await page.goto('/dashboard?tab=admin-merges');

      await expect(page.getByRole('heading', { name: 'Merge Review' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Recommended pairs' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reject match' }).first()).toBeVisible();
      await page.getByLabel('This record id').fill(String(canonical.id));
      await page.getByLabel('Matched record id').fill(String(duplicate.id));

      const previewResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/merge-preview')
        && response.request().method() === 'POST'
        && response.status() === 200
      ));
      await page.getByRole('button', { name: 'Preview merge' }).click();
      const previewResponse = await previewResponsePromise;
      expect(previewResponse.ok()).toBeTruthy();

      await expect(page.getByText('Matched on ISBN').first()).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Compared fields' })).toBeVisible();
      await expect(page.getByRole('cell', { name: 'ISBN' })).toBeVisible();
      await expect(page.getByText('9780358447849').first()).toBeVisible();

      await page.getByLabel('Matched record id').fill(String(movie.id));
      const crossTypeResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/merge-preview')
        && response.request().method() === 'POST'
        && response.status() === 409
      ));
      await page.getByRole('button', { name: 'Preview merge' }).click();
      const crossTypeResponse = await crossTypeResponsePromise;
      expect(crossTypeResponse.status()).toBe(409);

      await expect(page.getByText('Cross-type merges are not allowed').first()).toBeVisible();
      await expect(page.getByText('This record is Book and the matched record is Movie.').first()).toBeVisible();

      await page.getByLabel('Matched record id').fill(String(duplicate.id));
      const secondPreviewResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/merge-preview')
        && response.request().method() === 'POST'
        && response.status() === 200
      ));
      await page.getByRole('button', { name: 'Preview merge' }).click();
      const secondPreviewResponse = await secondPreviewResponsePromise;
      expect(secondPreviewResponse.ok()).toBeTruthy();

      await page.getByRole('button', { name: 'Apply merge' }).click();
      const applyResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/merge-apply')
        && response.request().method() === 'POST'
        && response.status() === 200
      ));
      await page.getByRole('button', { name: 'Confirm apply' }).click();
      const applyResponse = await applyResponsePromise;
      expect(applyResponse.ok()).toBeTruthy();

      await expect(page.getByRole('heading', { name: 'Merge applied' })).toBeVisible();
      await expect(page.getByText(`Record #${canonical.id} absorbed record #${duplicate.id}`)).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Active merge events' })).toBeVisible();

      const revertResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/merge-revert')
        && response.request().method() === 'POST'
        && response.status() === 200
      ));
      await page.getByRole('button', { name: 'Revert merge' }).first().click();
      const revertResponse = await revertResponsePromise;
      expect(revertResponse.ok()).toBeTruthy();

      await expect(page.getByRole('heading', { name: 'Merge reverted' })).toBeVisible();
      await expect(page.getByText(`Record #${duplicate.id} was restored from record #${canonical.id}`)).toBeVisible();
    } finally {
      for (const mediaId of createdIds.reverse()) {
        await requestContext.delete(`/api/media/${mediaId}`).catch(() => {});
      }
      await requestContext.dispose();
    }
  });

  test('collection merge review previews, applies duplicate collections, and reverts the active event', async ({ page }) => {
    const suffix = Date.now();
    const adminCredentials = await ensureSavedAdminCredentials();
    const requestContext = await createAuthenticatedRequestContext(adminCredentials);
    const collectionTitle = `Playwright Water Monsters Set ${suffix}`;
    const itemTitleA = `Playwright Kraken ${suffix}`;
    const itemTitleB = `Playwright Octopus ${suffix}`;
    const createdMediaIds = [];

    await deleteMediaByExactTitle(requestContext, collectionTitle).catch(() => {});
    await deleteMediaByExactTitle(requestContext, itemTitleA).catch(() => {});
    await deleteMediaByExactTitle(requestContext, itemTitleB).catch(() => {});

    try {
      const sourceResponse = await postWithCsrf(requestContext, '/api/media', {
        title: collectionTitle,
        media_type: 'movie',
        year: 2024,
        owned_formats: ['digital']
      }, 201);
      const sourceTitleA = await sourceResponse.json();
      createdMediaIds.push(Number(sourceTitleA.id));

      const duplicateResponse = await postWithCsrf(requestContext, '/api/media', {
        title: collectionTitle,
        media_type: 'movie',
        year: 2024,
        owned_formats: ['digital']
      }, 201);
      const sourceTitleB = await duplicateResponse.json();
      createdMediaIds.push(Number(sourceTitleB.id));

      const itemResponseA = await postWithCsrf(requestContext, '/api/media', {
        title: itemTitleA,
        media_type: 'movie',
        year: 2020,
        owned_formats: ['digital']
      }, 201);
      const itemA = await itemResponseA.json();
      createdMediaIds.push(Number(itemA.id));

      const itemResponseB = await postWithCsrf(requestContext, '/api/media', {
        title: itemTitleB,
        media_type: 'movie',
        year: 2021,
        owned_formats: ['digital']
      }, 201);
      const itemB = await itemResponseB.json();
      createdMediaIds.push(Number(itemB.id));

      const convertResponseA = await postWithCsrf(requestContext, `/api/media/${sourceTitleA.id}/convert-to-collection`, {}, 200);
      const convertedA = await convertResponseA.json();
      const convertResponseB = await postWithCsrf(requestContext, `/api/media/${sourceTitleB.id}/convert-to-collection`, {}, 200);
      const convertedB = await convertResponseB.json();

      await postWithCsrf(requestContext, `/api/media/collections/${convertedA.collection_id}/items`, {
        media_id: itemA.id,
        position: 1
      }, 201);
      await postWithCsrf(requestContext, `/api/media/collections/${convertedB.collection_id}/items`, {
        media_id: itemA.id,
        position: 1
      }, 201);
      await postWithCsrf(requestContext, `/api/media/collections/${convertedB.collection_id}/items`, {
        media_id: itemB.id,
        position: 2
      }, 201);

      await signInThroughUi(page, adminCredentials);
      await page.goto('/dashboard?tab=admin-merges');

      await page.getByRole('tab', { name: 'Collections' }).click();
      await page.getByPlaceholder('Search duplicate collections').fill(collectionTitle);
      await expect(page.getByText(collectionTitle).first()).toBeVisible();

      const previewResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/collections/duplicate-preview')
        && response.request().method() === 'GET'
        && response.status() === 200
      ));
      await page.getByRole('button', { name: 'Review group' }).first().click();
      const previewResponse = await previewResponsePromise;
      expect(previewResponse.ok()).toBeTruthy();

      await expect(page.getByRole('heading', { name: 'Collection preview' })).toBeVisible();
      await expect(page.getByText('Matched on collection name and expected item count').first()).toBeVisible();
      await expect(page.getByText('Merged items').first()).toBeVisible();

      const applyResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/collections/merge-apply')
        && response.request().method() === 'POST'
        && response.status() === 200
      ));
      await page.getByRole('button', { name: 'Apply merge' }).click();
      await page.getByRole('button', { name: 'Confirm apply' }).click();
      const applyResponse = await applyResponsePromise;
      expect(applyResponse.ok()).toBeTruthy();

      await expect(page.getByRole('heading', { name: 'Collection merge applied' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Active collection merge events' })).toBeVisible();

      const revertResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/collections/merge-revert')
        && response.request().method() === 'POST'
        && response.status() === 200
      ));
      await page.getByRole('button', { name: 'Revert merge' }).first().click();
      const revertResponse = await revertResponsePromise;
      expect(revertResponse.ok()).toBeTruthy();

      await expect(page.getByRole('heading', { name: 'Collection merge reverted' })).toBeVisible();
    } finally {
      const collections = await findCollectionsByName(requestContext, collectionTitle).catch(() => []);
      for (const collection of collections) {
        await postWithCsrf(requestContext, `/api/media/collections/${collection.id}/convert-to-individual`, {}, 200).catch(() => {});
      }
      await deleteMediaByExactTitle(requestContext, collectionTitle).catch(() => {});
      await deleteMediaByExactTitle(requestContext, itemTitleA).catch(() => {});
      await deleteMediaByExactTitle(requestContext, itemTitleB).catch(() => {});
      for (const mediaId of createdMediaIds.reverse()) {
        await requestContext.delete(`/api/media/${mediaId}`).catch(() => {});
      }
      await requestContext.dispose();
    }
  });
});
