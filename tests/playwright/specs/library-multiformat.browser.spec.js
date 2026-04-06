'use strict';

const { test, expect } = require('@playwright/test');
const { createFreshUserCredentials, createAuthenticatedRequestContext, postWithCsrf } = require('../helpers/auth');
const { deleteMediaByExactTitle, findExactMediaByTitle } = require('../helpers/media');

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('library multi-format browser regressions', () => {
  test('end user can create and edit a movie with multiple owned formats', async ({ page }) => {
    const credentials = await createFreshUserCredentials();
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const title = `Playwright Multi-Format ${Date.now()}`;

    await deleteMediaByExactTitle(requestContext, title).catch(() => {});

    try {
      const storageState = await requestContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await page.goto('/dashboard?tab=library-movies');
      await page.getByRole('button', { name: 'Add', exact: true }).click();

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
      await resultCard.hover();
      await resultCard.getByRole('button', { name: 'Edit', exact: true }).click({ force: true });

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
});
