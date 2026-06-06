'use strict';
const fs = require('fs');
const { test, expect, request: playwrightRequest } = require('@playwright/test');
const { AUTH_STATE_PATH, createFreshUserCredentials, createAuthenticatedRequestContext, createRequestContextFromStorageState, ensureAuthenticatedAdminStorageState, fetchCsrfToken, patchWithCsrf, postWithCsrf, requestWithCsrf } = require('../helpers/auth');
const { deleteMediaByExactTitle, findExactMediaByTitle } = require('../helpers/media');

const PLAYWRIGHT_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const PLAYWRIGHT_E2E_BYPASS_TOKEN = String(process.env.PLAYWRIGHT_E2E_BYPASS_TOKEN || '').trim();

function buildBypassHeaders() {
  return PLAYWRIGHT_E2E_BYPASS_TOKEN
    ? { 'x-playwright-e2e-bypass': PLAYWRIGHT_E2E_BYPASS_TOKEN }
    : undefined;
}

async function createSavedAdminRequestContext() {
  const seedContext = await playwrightRequest.newContext({
    baseURL: PLAYWRIGHT_BASE_URL,
    extraHTTPHeaders: buildBypassHeaders()
  });
  try {
    const adminState = await ensureAuthenticatedAdminStorageState(seedContext);
    return createRequestContextFromStorageState(adminState.storageStatePath);
  } finally {
    await seedContext.dispose();
  }
}

async function addSavedAdminCookies(page, requestContext = null) {
  const storageState = requestContext
    ? await requestContext.storageState()
    : JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8'));
  await page.context().addCookies(storageState.cookies || []);
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('library multi-format browser regressions', () => {
  test('media can keep multiple signatures while projecting one primary legacy signer', async () => {
    const credentials = await createFreshUserCredentials({ role: 'admin', noCache: true });
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const title = `Playwright Multi Signed Media ${Date.now()}`;
    let mediaId = null;

    await deleteMediaByExactTitle(requestContext, title).catch(() => {});

    try {
      const createResponse = await postWithCsrf(requestContext, '/api/media', {
        title,
        media_type: 'book',
        format: 'Hardcover',
        owned_formats: ['hardcover'],
        signed_by: 'Primary Playwright Author',
        signed_role: 'author',
        signed_on: '2026-04-26',
        signed_at: 'Original Signing Table'
      }, 201);
      const created = await createResponse.json();
      mediaId = Number(created?.id || 0) || null;
      expect(mediaId).toBeTruthy();
      expect(created.signatures).toHaveLength(1);
      expect(created.signed_by).toBe('Primary Playwright Author');

      const secondaryResponse = await postWithCsrf(requestContext, `/api/media/${mediaId}/signatures`, {
        signer_name: 'Secondary Playwright Cast',
        signer_role: 'cast',
        signed_on: '2026-04-27',
        signed_at: 'Second Signing Table'
      }, 201);
      const secondary = await secondaryResponse.json();
      expect(secondary.signatures).toHaveLength(2);
      expect(secondary.media.signed_by).toBe('Primary Playwright Author');

      const csrfToken = await fetchCsrfToken(requestContext);
      const proofResponse = await requestContext.post(`/api/media/${mediaId}/signatures/${secondary.signature.id}/proof`, {
        multipart: {
          proof_type: 'receipt',
          label: 'Book signing receipt',
          notes: 'Receipt proves the signing source.',
          proof: {
            name: 'media-signature-proof.png',
            mimeType: 'image/png',
            buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64')
          }
        },
        headers: { 'x-csrf-token': csrfToken }
      });
      expect(proofResponse.ok()).toBeTruthy();
      const proof = await proofResponse.json();
      expect(proof.signature.proof_path).toBeTruthy();
      expect(proof.signature.proofs).toHaveLength(1);
      expect(proof.proof.proof_type).toBe('receipt');
      expect(proof.proof.label).toBe('Book signing receipt');
      expect(proof.media.signed_proof_path).toBeFalsy();

      const secondProofCsrfToken = await fetchCsrfToken(requestContext);
      const secondProofResponse = await requestContext.post(`/api/media/${mediaId}/signatures/${secondary.signature.id}/proof`, {
        multipart: {
          proof: {
            name: 'media-signature-proof-extra.png',
            mimeType: 'image/png',
            buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64')
          }
        },
        headers: { 'x-csrf-token': secondProofCsrfToken }
      });
      expect(secondProofResponse.ok()).toBeTruthy();
      const secondProof = await secondProofResponse.json();
      expect(secondProof.signature.proofs).toHaveLength(2);
      const extraProof = secondProof.signature.proofs.find((entry) => !entry.is_primary);
      const metadataResponse = await patchWithCsrf(requestContext, `/api/media/${mediaId}/signatures/${secondary.signature.id}/proofs/${extraProof.id}`, {
        proof_type: 'artist_post',
        label: 'Publisher post',
        notes: 'Publisher post confirming the signature.'
      });
      expect(metadataResponse.ok()).toBeTruthy();
      const metadata = await metadataResponse.json();
      expect(metadata.proof.proof_type).toBe('artist_post');
      expect(metadata.proof.label).toBe('Publisher post');
      const removeOneProofResponse = await requestWithCsrf(requestContext, 'DELETE', `/api/media/${mediaId}/signatures/${secondary.signature.id}/proofs/${extraProof.id}`);
      expect(removeOneProofResponse.ok()).toBeTruthy();
      const removedOneProof = await removeOneProofResponse.json();
      expect(removedOneProof.signature.proofs).toHaveLength(1);

      const promoteResponse = await requestWithCsrf(requestContext, 'POST', `/api/media/${mediaId}/signatures/${secondary.signature.id}/primary`);
      expect(promoteResponse.ok()).toBeTruthy();
      const promoted = await promoteResponse.json();
      expect(promoted.media.signed_by).toBe('Secondary Playwright Cast');
      expect(promoted.media.signed_proof_path).toBeTruthy();
      expect(promoted.signatures).toHaveLength(2);

      const detailResponse = await requestContext.get(`/api/media/${mediaId}`);
      expect(detailResponse.ok()).toBeTruthy();
      const detail = await detailResponse.json();
      expect(detail.signatures).toHaveLength(2);
      expect(detail.signed_by).toBe('Secondary Playwright Cast');

      const removeProofResponse = await requestWithCsrf(requestContext, 'DELETE', `/api/media/${mediaId}/signatures/${secondary.signature.id}/proof`);
      expect(removeProofResponse.ok()).toBeTruthy();
      const proofRemoved = await removeProofResponse.json();
      expect(proofRemoved.removed).toBe(true);
      expect(proofRemoved.media.signed_proof_path).toBeFalsy();

      const archiveResponse = await requestWithCsrf(requestContext, 'DELETE', `/api/media/${mediaId}/signatures/${secondary.signature.id}`);
      expect(archiveResponse.ok()).toBeTruthy();
      const archived = await archiveResponse.json();
      expect(archived.signatures).toHaveLength(1);
      expect(archived.media.signed_by).toBe('Primary Playwright Author');
    } finally {
      await deleteMediaByExactTitle(requestContext, title).catch(() => {});
      await requestContext.dispose();
    }
  });

  test('loaned game cards open a loan-first drawer and keep the reminder action resilient', async ({ page }) => {
    const credentials = await createFreshUserCredentials({ role: 'admin', noCache: true });
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const title = `Playwright Loaned Game ${Date.now()}`;
    const overview = 'Loan-first drawer overview text';
    let mediaId = null;

    await deleteMediaByExactTitle(requestContext, title).catch(() => {});

    try {
      const createResponse = await postWithCsrf(requestContext, '/api/media', {
        title,
        overview,
        media_type: 'game',
        format: 'Disc',
        owned_formats: ['disc'],
        year: 2024
      }, 201);
      const created = await createResponse.json();
      mediaId = Number(created?.id || 0) || null;
      expect(mediaId).toBeTruthy();

      const today = new Date();
      const loanedAt = new Date(today);
      loanedAt.setDate(today.getDate() - 14);
      const dueAt = new Date(today);
      dueAt.setDate(today.getDate() - 1);

      await postWithCsrf(requestContext, `/api/media/${mediaId}/loans`, {
        borrower_name: 'Ted',
        borrower_email: 'ted@example.com',
        loaned_at: loanedAt.toISOString().slice(0, 10),
        due_at: dueAt.toISOString().slice(0, 10),
        loan_format: 'Disc',
        notes: 'Playwright reminder regression loan'
      }, 201);

      const storageState = await requestContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await page.goto('/dashboard?tab=library-games');

      const searchInput = page.getByPlaceholder('Search title, director…');
      await searchInput.fill(title);
      const resultCard = page.locator('article').filter({
        has: page.getByText(title, { exact: true })
      }).first();
      await expect(resultCard).toBeVisible();
      await resultCard.click();

      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(page.getByText(/Loaned out.*Ted.*Due/i)).toBeVisible();
      await expect(page.getByText(overview, { exact: true })).toHaveCount(0);

      const showDetailsButton = page.getByRole('button', { name: 'Show Details', exact: true });
      await expect(showDetailsButton).toBeVisible();
      await showDetailsButton.click();
      await expect(page.getByRole('button', { name: 'Hide Details', exact: true })).toBeVisible();
      await expect(page.getByText(overview, { exact: true })).toBeVisible();

      const reminderButton = page.getByRole('button', { name: 'Send Reminder', exact: true });
      const reminderResponsePromise = page.waitForResponse((response) => (
        /\/api\/media\/loans\/\d+\/reminder$/.test(response.url())
          && response.request().method() === 'POST'
      ));
      await reminderButton.click();
      const reminderResponse = await reminderResponsePromise;

      expect([200, 502, 503]).toContain(reminderResponse.status());

      if (reminderResponse.status() === 200) {
        await expect(page.getByText('Reminder sent today', { exact: true })).toBeVisible();
        await expect(page.getByText(/Last sent/i)).toBeVisible();
      } else {
        const responseBody = await reminderResponse.json().catch(() => ({}));
        const expectedMessage = responseBody?.error || 'Failed to send reminder';
        await expect(page.getByText(expectedMessage, { exact: false })).toBeVisible();
        await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: /Send Reminder|Sending…/ })).toBeVisible();
      }
    } finally {
      await deleteMediaByExactTitle(requestContext, title).catch(() => {});
      await requestContext.dispose();
    }
  });

  test('media detail uses cover art as the header backdrop when no backdrop exists', async ({ page }) => {
    const credentials = await createFreshUserCredentials();
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const title = `Playwright Cover Backdrop ${Date.now()}`;

    await deleteMediaByExactTitle(requestContext, title).catch(() => {});

    try {
      await postWithCsrf(requestContext, '/api/media', {
        title,
        media_type: 'comic_book',
        format: 'Comic Book',
        owned_formats: ['paper'],
        poster_path: '/uploads/playwright-cover-backdrop.png',
        backdrop_path: ''
      }, 201);

      const storageState = await requestContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await page.goto('/dashboard?tab=library-comics');

      await page.getByPlaceholder('Search title, director…').fill(title);
      const resultCard = page.locator('article').filter({
        has: page.getByText(title, { exact: true })
      }).first();
      await expect(resultCard).toBeVisible();
      await resultCard.locator('.poster').click();

      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      const headerBackdrop = page.getByTestId('media-detail-backdrop');
      await expect(headerBackdrop).toBeVisible();
      await expect(headerBackdrop.locator('img')).toHaveAttribute('src', /playwright-cover-backdrop\.png/);

      const backdropBox = await headerBackdrop.boundingBox();
      const posterBox = await page.locator('.poster').last().boundingBox();
      expect(backdropBox?.height).toBeGreaterThan(150);
      expect(posterBox?.y).toBeGreaterThan(backdropBox?.y || 0);
    } finally {
      await deleteMediaByExactTitle(requestContext, title).catch(() => {});
      await requestContext.dispose();
    }
  });

  test('admin sees explicit Plex writeback controls on Plex-linked media detail', async ({ page }) => {
    const credentials = await createFreshUserCredentials({ role: 'admin', noCache: true });
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const title = `Playwright Plex Writeback ${Date.now()}`;
    let mediaId = null;
    let ratingPayload = null;
    let watchPayload = null;

    await deleteMediaByExactTitle(requestContext, title).catch(() => {});

    try {
      const createResponse = await postWithCsrf(requestContext, '/api/media', {
        title,
        media_type: 'movie',
        format: 'Digital',
        owned_formats: ['digital'],
        user_rating: 8,
        year: 2026,
        type_details: {
          provider_name: 'plex',
          provider_item_id: 'playwright-plex-writeback'
        },
        import_source: 'plex'
      }, 201);
      const created = await createResponse.json();
      mediaId = Number(created?.id || 0) || null;
      expect(mediaId).toBeTruthy();

      await page.route('**/api/media/write-plex-rating', async (route) => {
        ratingPayload = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true })
        });
      });
      await page.route('**/api/media/write-plex-watch-state', async (route) => {
        watchPayload = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true })
        });
      });

      const storageState = await requestContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await page.goto('/dashboard?tab=library-movies');

      await page.getByPlaceholder('Search title, director…').fill(title);
      const resultCard = page.locator('article').filter({
        has: page.getByText(title, { exact: true })
      }).first();
      await expect(resultCard).toBeVisible();
      await resultCard.click();

      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(page.getByTestId('plex-writeback-controls')).toBeVisible();
      await expect(page.getByTestId('plex-rating-writeback-button')).toBeVisible();
      await expect(page.getByTestId('plex-watch-scrobble-button')).toBeVisible();
      await expect(page.getByTestId('plex-watch-unscrobble-button')).toBeVisible();

      await page.getByTestId('plex-rating-writeback-button').click();
      await expect.poll(() => ratingPayload).toMatchObject({ mediaId, rating: 8 });

      await page.getByTestId('plex-watch-scrobble-button').click();
      await expect.poll(() => watchPayload).toMatchObject({ mediaId, action: 'scrobble' });
    } finally {
      await deleteMediaByExactTitle(requestContext, title).catch(() => {});
      await requestContext.dispose();
    }
  });

  test('poster cards stay browse-first and open detail without inline action chrome', async ({ page }) => {
    const credentials = await createFreshUserCredentials();
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const title = `Playwright Browse First ${Date.now()}`;

    await deleteMediaByExactTitle(requestContext, title).catch(() => {});

    try {
      await postWithCsrf(requestContext, '/api/media', {
        title,
        media_type: 'movie',
        owned_formats: ['digital']
      }, 201);

      const storageState = await requestContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await page.goto('/dashboard?tab=library-movies');

      const searchInput = page.getByPlaceholder('Search title, director…');
      await searchInput.fill(title);

      const resultCard = page.locator('article').filter({
        has: page.getByText(title, { exact: true })
      }).first();

      await expect(resultCard).toBeVisible();
      await resultCard.hover();
      await expect(resultCard.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
      await expect(resultCard.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
      await resultCard.click();
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    } finally {
      await deleteMediaByExactTitle(requestContext, title).catch(() => {});
      await requestContext.dispose();
    }
  });

  test('media detail renders valuation data after a fixture-backed valuation refresh', async ({ page }) => {
    const credentials = await createFreshUserCredentials();
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const title = `Playwright Valuation ${Date.now()}`;

    await deleteMediaByExactTitle(requestContext, title).catch(() => {});

    try {
      const createResponse = await postWithCsrf(requestContext, '/api/media', {
        title,
        media_type: 'game',
        owned_formats: ['digital']
      }, 201);
      const created = await createResponse.json();

      const refreshResponse = await postWithCsrf(requestContext, `/api/media/${created.id}/valuation-refresh`, {
        async: false,
        mode: 'fixture'
      }, 200);
      const refreshPayload = await refreshResponse.json();
      expect(refreshPayload.matched).toBeTruthy();
      expect(refreshPayload.valuation?.mid).toBeGreaterThan(0);

      const storageState = await requestContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await page.goto('/dashboard?tab=library-games');

      const searchInput = page.getByPlaceholder('Search title, director…');
      await searchInput.fill(title);
      const resultCard = page.locator('article').filter({
        has: page.getByText(title, { exact: true })
      }).first();
      await expect(resultCard).toBeVisible();
      await resultCard.click();

      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(page.getByText('Valuation', { exact: true })).toBeVisible();
      await expect(page.getByText('Mid', { exact: true })).toBeVisible();
      await expect(page.getByText('PriceCharting (fixture)', { exact: true })).toBeVisible();
    } finally {
      await deleteMediaByExactTitle(requestContext, title).catch(() => {});
      await requestContext.dispose();
    }
  });

  test('end user can create and edit a movie with multiple owned formats', async ({ page }) => {
    const credentials = await createFreshUserCredentials();
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const title = `Playwright Multi-Format ${Date.now()}`;

    await deleteMediaByExactTitle(requestContext, title).catch(() => {});

    try {
      const storageState = await requestContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await page.goto('/dashboard?tab=library-movies');
      await page.getByRole('button', { name: /Add media/i }).first().click();

      await expect(page.getByRole('heading', { name: /add to library/i })).toBeVisible();
      await page.getByPlaceholder('Movie title').fill(title);
      await page.getByRole('button', { name: 'DVD', exact: true }).click();
      await page.getByRole('button', { name: 'Digital', exact: true }).click();

      const createResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media')
          && response.request().method() === 'POST'
      ));
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      const createResponse = await createResponsePromise;
      expect(createResponse.status()).toBe(201);
      const createdPayload = await createResponse.json();
      expect(createdPayload.owned_formats).toEqual(['dvd', 'bluray', 'digital']);
      expect(createdPayload.format).toBe('Blu-ray');

      await page.goto('/dashboard?tab=library-movies');
      const searchInput = page.getByPlaceholder('Search title, director…');
      await searchInput.fill(title);
      const resultCard = page.locator('article').filter({
        has: page.getByText(title, { exact: true })
      }).first();
      await expect(resultCard).toBeVisible();
      await resultCard.click();
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Edit', exact: true }).click();

      await expect(page.getByRole('heading', { name: /edit media/i })).toBeVisible();
      await page.getByRole('button', { name: 'Blu-ray', exact: true }).click();
      await page.getByRole('button', { name: '4K UHD', exact: true }).click();

      const editResponsePromise = page.waitForResponse((response) => (
        /\/api\/media\/\d+$/.test(response.url())
          && response.request().method() === 'PATCH'
      ));
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      const editResponse = await editResponsePromise;
      expect(editResponse.status()).toBe(200);
      const editedPayload = await editResponse.json();
      expect(editedPayload.owned_formats).toEqual(['dvd', 'uhd', 'digital']);
      expect(editedPayload.format).toBe('4K UHD');

      const stored = await findExactMediaByTitle(requestContext, title);
      expect(stored).not.toBeNull();
      expect(stored.owned_formats).toEqual(['dvd', 'uhd', 'digital']);
      expect(stored.format).toBe('4K UHD');
    } finally {
      await deleteMediaByExactTitle(requestContext, title).catch(() => {});
      await requestContext.dispose();
    }
  });

  test('add drawer uses one live universal search panel instead of barcode-only lookup buttons', async ({ page }) => {
    const requestContext = await createSavedAdminRequestContext();

    try {
      await addSavedAdminCookies(page, requestContext);
      await page.goto('/dashboard?tab=library-movies');
      await expect(page.locator('article').first()).toBeVisible();
      const toolbarAdd = page.getByRole('button', { name: /Add/ }).first();
      await expect(toolbarAdd).toBeVisible();
      await expect(toolbarAdd).toBeEnabled();
      await toolbarAdd.click();

      await expect(page.getByRole('heading', { name: /add to library/i })).toBeVisible();
      await expect(page.locator('[aria-label="Search panel"]')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Search', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Lookup', exact: true })).toHaveCount(0);

      await page.getByRole('button', { name: 'Book', exact: true }).click();
      await expect(page.getByPlaceholder('055357275X, 9780553572755, or 012345678901')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Search', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Scan', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Lookup', exact: true })).toHaveCount(0);
    } finally {
      await requestContext.dispose();
    }
  });

  test('edit drawer starts with collapsed search summary and reopens with Search again', async ({ page }) => {
    const requestContext = await createSavedAdminRequestContext();
    const title = `Playwright Edit Search Summary ${Date.now()}`;

    await deleteMediaByExactTitle(requestContext, title).catch(() => {});

    try {
      await postWithCsrf(requestContext, '/api/media', {
        title,
        media_type: 'movie',
        owned_formats: ['digital'],
        year: 2022,
        overview: 'Populated movie for edit search summary',
        genre: 'Drama',
        upc: '4006381333931'
      }, 201);

      await addSavedAdminCookies(page, requestContext);
      await page.goto('/dashboard?tab=library-movies');
      await expect(page.getByRole('button', { name: 'All Movies', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add media' })).toBeVisible();
      await expect(page.locator('article').first()).toBeVisible();

      const searchInput = page.getByPlaceholder('Search title, director…');
      await searchInput.fill(title);
      await expect(searchInput).toHaveValue(title);
      const resultCard = page.locator('article').filter({
        has: page.getByText(title, { exact: true })
      }).first();
      await expect(resultCard).toBeVisible();
      await resultCard.click();
      await page.getByRole('button', { name: 'Edit', exact: true }).click();

      await expect(page.getByRole('heading', { name: /edit media/i })).toBeVisible();
      await expect(page.locator('[aria-label="Search summary"]')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Search', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Search again', exact: true }).click();
      await expect(page.locator('[aria-label="Search panel"]')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Search', exact: true })).toHaveCount(0);
      await expect(page.getByPlaceholder('Movie title')).toHaveValue(title);
      await expect(page.getByPlaceholder('012345678901')).toHaveValue('4006381333931');
    } finally {
      await deleteMediaByExactTitle(requestContext, title).catch(() => {});
      await requestContext.dispose();
    }
  });

  test('add drawer combines title and identifier search results into one picker', async ({ page }) => {
    const credentials = await createFreshUserCredentials();
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const title = `Playwright Dual Search ${Date.now()}`;
    const alternateTitle = `${title} Alternate`;
    const upc = `012345${Date.now().toString().slice(-6)}`;
    let sawTitleLookup = false;
    let sawIdentifierLookup = false;
    let titleLookupCount = 0;

    try {
      await page.route('**/api/media/search-tmdb', async (route) => {
        sawTitleLookup = true;
        titleLookupCount += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 551122,
              title,
              original_title: title,
              release_date: '2024-03-02',
              release_year: 2024,
              tmdb_media_type: 'movie',
              overview: 'Title search result',
              genre_names: ['Drama']
            }
          ])
        });
      });

      await page.route('**/api/media/lookup-upc', async (route) => {
        sawIdentifierLookup = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            provider: 'playwright-stub',
            upc,
            matches: [
              {
                upc,
                title,
                normalizedTitle: title,
                tmdb: {
                  id: 551122,
                  title,
                  original_title: title,
                  release_date: '2024-03-02',
                  release_year: 2024,
                  tmdb_media_type: 'movie',
                  overview: 'Identifier search result',
                  genre_names: ['Drama']
                }
              },
              {
                upc: `${upc}9`,
                title: alternateTitle,
                normalizedTitle: alternateTitle,
                tmdb: {
                  id: 551133,
                  title: alternateTitle,
                  original_title: alternateTitle,
                  release_date: '2023-01-04',
                  release_year: 2023,
                  tmdb_media_type: 'movie',
                  overview: 'Identifier-only result',
                  genre_names: ['Sci-Fi']
                }
              }
            ]
          })
        });
      });

      const storageState = await requestContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await page.goto('/dashboard?tab=library-movies');
      const addMediaButton = page.getByRole('button', { name: 'Add media' }).first();
      await expect(addMediaButton).toBeVisible();
      await expect(addMediaButton).toBeEnabled();
      await addMediaButton.click();

      await expect(page.getByRole('heading', { name: /add to library/i })).toBeVisible();
      const titleResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/search-tmdb')
          && response.request().method() === 'POST'
      ));
      const identifierResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/lookup-upc')
          && response.request().method() === 'POST'
      ));
      await page.getByPlaceholder('Movie title').fill(title);
      await page.getByPlaceholder('012345678901').fill(upc);
      const [titleResponse, identifierResponse] = await Promise.all([titleResponsePromise, identifierResponsePromise]);
      expect(titleResponse.ok()).toBeTruthy();
      expect(identifierResponse.ok()).toBeTruthy();
      expect(sawTitleLookup).toBeTruthy();
      expect(sawIdentifierLookup).toBeTruthy();

      const mergedResult = page.locator('button').filter({ has: page.getByText(title, { exact: true }) }).first();
      await expect(mergedResult).toBeVisible();
      await expect(mergedResult.getByText('Title', { exact: true })).toBeVisible();
      await expect(mergedResult.getByText('Identifier', { exact: true })).toBeVisible();

      const identifierOnlyResult = page.locator('button').filter({ has: page.getByText(alternateTitle, { exact: true }) }).first();
      await expect(identifierOnlyResult).toBeVisible();
      await expect(identifierOnlyResult.getByText('Identifier', { exact: true })).toBeVisible();
      await expect(identifierOnlyResult.getByText('Title', { exact: true })).toHaveCount(0);

      await identifierOnlyResult.click();
      expect(titleLookupCount).toBe(1);
    } finally {
      await requestContext.dispose();
    }
  });

  test('comic books use the shared footer and page size selector instead of a full-load-only footer exception', async ({ page }) => {
    const credentials = await createFreshUserCredentials();
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const stamp = Date.now();
    const seriesName = `Playwright Comics Footer ${stamp}`;
    const titles = Array.from({ length: 30 }, (_, index) => `${seriesName} #${index + 1}`);

    try {
      for (let index = 0; index < titles.length; index += 1) {
        await postWithCsrf(requestContext, '/api/media', {
          title: titles[index],
          media_type: 'comic_book',
          owned_formats: ['paper'],
          comic_series: seriesName,
          comic_issue_number: String(index + 1)
        }, 201);
      }

      const storageState = await requestContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await page.goto('/dashboard?tab=library-comics');

      await page.locator('select').filter({ has: page.locator('option[value="25"]') }).last().selectOption('25');
      await expect(page.getByText('Page 1 / 2', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Previous page')).toBeVisible();
      await expect(page.getByLabel('Next page')).toBeVisible();
      await expect(page.locator('article').filter({ hasText: titles[0] }).first()).toBeVisible();
      await expect(page.locator('article').filter({ hasText: titles[29] })).toHaveCount(0);

      await page.getByLabel('Next page').click();
      await expect(page.getByText('Page 2 / 2', { exact: true })).toBeVisible();
      await expect(page.locator('article').filter({ hasText: titles[29] }).first()).toBeVisible();

      await page.locator('select').filter({ has: page.locator('option[value="100"]') }).last().selectOption('100');
      await expect(page.getByText('Page 2 / 2', { exact: true })).toHaveCount(0);
      await expect(page.getByLabel('Previous page')).toHaveCount(0);
      await expect(page.getByLabel('Next page')).toHaveCount(0);
      await expect(page.locator('article').filter({ hasText: titles[0] }).first()).toBeVisible();
      await expect(page.locator('article').filter({ hasText: titles[29] }).first()).toBeVisible();
    } finally {
      for (const title of titles) {
        await deleteMediaByExactTitle(requestContext, title).catch(() => {});
      }
      await requestContext.dispose();
    }
  });

  test('choosing an identifier-only movie result triggers follow-up title enrichment before apply', async ({ page }) => {
    const title = `Playwright Follow Up ${Date.now()}`;
    const alternateTitle = `${title} Identifier`;
    const upc = `065432${Date.now().toString().slice(-6)}`;
    const requestContext = await createSavedAdminRequestContext();
    let initialTitleLookupCount = 0;
    let followUpLookupCount = 0;

    try {
      await page.route('**/api/media/search-tmdb', async (route) => {
        const payload = route.request().postDataJSON();
        if (payload?.title === title) {
          initialTitleLookupCount += 1;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              {
                id: 661100,
                title,
                original_title: title,
                release_date: '2024-02-01',
                release_year: 2024,
                tmdb_media_type: 'movie',
                overview: 'Initial title result',
                genre_names: ['Drama']
              }
            ])
          });
          return;
        }

        if (payload?.title === alternateTitle) {
          followUpLookupCount += 1;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              {
                id: 661144,
                title: alternateTitle,
                original_title: alternateTitle,
                release_date: '2023-07-12',
                release_year: 2023,
                tmdb_media_type: 'movie',
                overview: 'Follow-up title enrichment result',
                genre_names: ['Sci-Fi']
              }
            ])
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([])
        });
      });

      await page.route('**/api/media/lookup-upc', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            provider: 'playwright-stub',
            upc,
            matches: [
              {
                upc,
                title: alternateTitle,
                normalizedTitle: alternateTitle,
                description: 'Identifier-only candidate'
              }
            ]
          })
        });
      });

      await page.route('**/api/media/tmdb/661144/details?mediaType=movie', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            director: 'Pat Example',
            cast: 'A. One, B. Two',
            runtime: 123,
            tmdb_url: 'https://www.themoviedb.org/movie/661144',
            trailer_url: 'https://example.com/trailer'
          })
        });
      });

      await addSavedAdminCookies(page);
      await page.goto('/dashboard?tab=library-movies');
      await expect(page.getByRole('heading', { name: 'Movies', exact: true })).toBeVisible();
      await expect(page.locator('article').first()).toBeVisible();
      await page.getByRole('button', { name: /Add/ }).first().click();

      await expect(page.getByRole('heading', { name: /add to library/i })).toBeVisible();
      const titleResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/search-tmdb')
          && response.request().method() === 'POST'
      ));
      const identifierResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/lookup-upc')
          && response.request().method() === 'POST'
      ));
      await page.getByPlaceholder('Movie title').fill(title);
      await page.getByPlaceholder('012345678901').fill(upc);
      await Promise.all([titleResponsePromise, identifierResponsePromise]);
      await expect(page.getByText(alternateTitle, { exact: true })).toBeVisible();

      await page.locator('button').filter({ has: page.getByText(alternateTitle, { exact: true }) }).first().click();
      await expect.poll(() => followUpLookupCount).toBe(1);
      expect(initialTitleLookupCount).toBe(1);
      expect(followUpLookupCount).toBe(1);

      await expect(page.getByPlaceholder('2024')).toHaveValue('2023');
      await expect(page.getByPlaceholder('Action, Drama…')).toHaveValue('Sci-Fi');
      await expect(page.locator('[aria-label="Search summary"]')).toBeVisible();
      await expect(page.locator('[aria-label="Search summary"]')).toContainText(alternateTitle);
      await expect(page.getByRole('button', { name: 'Search', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Search again', exact: true }).click();
      await expect(page.locator('[aria-label="Search panel"]')).toBeVisible();
      await expect(page.getByPlaceholder('Movie title')).toHaveValue(alternateTitle);
      await expect(page.getByText(alternateTitle, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Clear match', exact: true })).toBeVisible();
    } finally {
      await requestContext.dispose();
    }
  });

  test('end user can shift-select a visible card range in alphabetical card view', async ({ page }) => {
    const credentials = await createFreshUserCredentials();
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const batchId = Date.now();
    const searchPrefix = `Playwright Shift Range ${batchId}`;
    const titles = [
      `${searchPrefix} A`,
      `${searchPrefix} B`,
      `${searchPrefix} C`
    ];

    await Promise.all(titles.map((title) => deleteMediaByExactTitle(requestContext, title).catch(() => {})));

    try {
      for (const title of titles) {
        await postWithCsrf(requestContext, '/api/media', {
          title,
          media_type: 'movie',
          owned_formats: ['digital']
        }, 201);
      }

      const storageState = await requestContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await page.goto('/dashboard?tab=library-movies');

      const searchInput = page.getByPlaceholder('Search title, director…');
      await searchInput.fill(searchPrefix);

      const firstSelector = page.getByRole('button', { name: `Select ${titles[0]}` });
      const middleSelector = page.getByRole('button', { name: `Select ${titles[1]}` });
      const lastSelector = page.getByRole('button', { name: `Select ${titles[2]}` });

      await expect(firstSelector).toBeVisible();
      await expect(middleSelector).toBeVisible();
      await expect(lastSelector).toBeVisible();

      await firstSelector.click();
      await lastSelector.click({ modifiers: ['Shift'] });

      await expect(page.getByText('3 selected', { exact: true })).toBeVisible();
      await expect(firstSelector).toHaveAttribute('aria-pressed', 'true');
      await expect(middleSelector).toHaveAttribute('aria-pressed', 'true');
      await expect(lastSelector).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await Promise.all(titles.map((title) => deleteMediaByExactTitle(requestContext, title).catch(() => {})));
      await requestContext.dispose();
    }
  });

  test('bulk selection can escalate from the current page to all matching titles in the active library type', async ({ page }) => {
    const credentials = await createFreshUserCredentials();
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const searchPrefix = `Playwright Select All Scope ${Date.now()}`;
    const titles = Array.from({ length: 52 }, (_, index) => `${searchPrefix} ${String(index + 1).padStart(2, '0')}`);

    await Promise.all(titles.map((title) => deleteMediaByExactTitle(requestContext, title).catch(() => {})));

    try {
      for (const title of titles) {
        await postWithCsrf(requestContext, '/api/media', {
          title,
          media_type: 'movie',
          owned_formats: ['digital']
        }, 201);
      }

      const storageState = await requestContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await page.goto('/dashboard?tab=library-movies');

      const searchInput = page.getByPlaceholder('Search title, director…');
      await searchInput.fill(searchPrefix);

      const selectPageButton = page.getByRole('button', { name: /^Select page \(\d+\)$/ });
      await expect(selectPageButton).toBeVisible();
      const selectPageLabel = await selectPageButton.getAttribute('aria-label') || await selectPageButton.textContent();
      const visibleCountMatch = String(selectPageLabel || '').match(/Select page \((\d+)\)/);
      const visibleCount = Number(visibleCountMatch?.[1] || 0);
      await selectPageButton.click();

      await expect(page.getByText(`${visibleCount} selected`, { exact: true })).toBeVisible();
      const selectAllMatchingButton = page.getByRole('button', { name: /^Select all \d+ movies$/ });
      await expect(selectAllMatchingButton).toBeVisible();
      await expect(selectAllMatchingButton).toBeEnabled();
      const selectAllLabel = await selectAllMatchingButton.textContent();
      const totalCountMatch = String(selectAllLabel || '').match(/Select all (\d+) movies/);
      const totalCount = Number(totalCountMatch?.[1] || 0);
      await selectAllMatchingButton.click();

      await expect(page.getByText(`${totalCount} selected`, { exact: true })).toBeVisible();
      await expect(page.getByText(`All ${totalCount} movies selected`, { exact: true })).toBeVisible();
    } finally {
      await Promise.all(titles.map((title) => deleteMediaByExactTitle(requestContext, title).catch(() => {})));
      await requestContext.dispose();
    }
  });
});
