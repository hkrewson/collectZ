'use strict';

const { test, expect } = require('@playwright/test');
const { createFreshUserCredentials, createAuthenticatedRequestContext } = require('../helpers/auth');
const { deleteMediaByExactTitle } = require('../helpers/media');
const { signInThroughUi } = require('../helpers/session');

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('import browser regressions', () => {
  test('end user can look up a barcode match, add it from Import Media, and find it in the library', async ({ page }) => {
    const credentials = await createFreshUserCredentials();
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const title = `Playwright Barcode Import ${Date.now()}`;
    const upc = `012345${Date.now().toString().slice(-6)}`;

    await deleteMediaByExactTitle(requestContext, title).catch(() => {});

    try {
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
                source: 'playwright-stub',
                title,
                normalizedTitle: title,
                mediaTypeGuess: 'movie',
                tmdb: {
                  id: 424242,
                  title,
                  original_title: title,
                  release_date: '2024-01-02',
                  release_year: 2024,
                  tmdb_media_type: 'movie',
                  overview: 'Seeded Playwright barcode import coverage item.',
                  genre_names: ['Drama']
                }
              }
            ]
          })
        });
      });

      await signInThroughUi(page, credentials);
      await page.goto('/dashboard?tab=library-import');
      await expect(page.getByRole('heading', { name: 'Import Media' })).toBeVisible();

      const barcodeInput = page.getByPlaceholder('012345678901');
      await barcodeInput.fill(upc);

      const lookupResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/lookup-upc')
          && response.request().method() === 'POST'
      ));
      await page.getByRole('button', { name: /Lookup/i }).click();
      const lookupResponse = await lookupResponsePromise;
      expect(lookupResponse.ok()).toBeTruthy();

      await expect(page.getByText(title, { exact: true })).toBeVisible();

      const addResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media')
          && response.request().method() === 'POST'
      ));
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      const addResponse = await addResponsePromise;
      expect(addResponse.status()).toBe(201);
      await expect(page.getByText(`Added "${title}" from barcode`, { exact: true })).toBeVisible();

      await page.goto('/dashboard?tab=library-movies');
      const searchInput = page.getByPlaceholder('Search title, director…');
      await searchInput.fill(title);
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    } finally {
      await deleteMediaByExactTitle(requestContext, title).catch(() => {});
      await requestContext.dispose();
    }
  });
});
