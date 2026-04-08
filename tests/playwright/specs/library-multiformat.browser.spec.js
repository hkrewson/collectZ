'use strict';
const { test, expect } = require('@playwright/test');
const { createFreshUserCredentials, createAuthenticatedRequestContext, postWithCsrf } = require('../helpers/auth');
const { deleteMediaByExactTitle, findExactMediaByTitle } = require('../helpers/media');

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('library multi-format browser regressions', () => {
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

  test('add drawer uses one universal search action instead of barcode-only lookup buttons', async ({ page }) => {
    const credentials = await createFreshUserCredentials();
    const requestContext = await createAuthenticatedRequestContext(credentials);

    try {
      const storageState = await requestContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await page.goto('/dashboard?tab=library-movies');
      await page.getByRole('button', { name: 'Add', exact: true }).click();

      await expect(page.getByRole('heading', { name: /add to library/i })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Lookup', exact: true })).toHaveCount(0);

      await page.getByRole('button', { name: 'Book', exact: true }).click();
      await expect(page.getByPlaceholder('055357275X, 9780553572755, or 012345678901')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Scan', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Lookup', exact: true })).toHaveCount(0);
    } finally {
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

    try {
      await page.route('**/api/media/search-tmdb', async (route) => {
        sawTitleLookup = true;
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
      await page.getByRole('button', { name: 'Add', exact: true }).click();

      await expect(page.getByRole('heading', { name: /add to library/i })).toBeVisible();
      await page.getByPlaceholder('Movie title').fill(title);
      await page.getByPlaceholder('012345678901').fill(upc);

      const titleResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/search-tmdb')
          && response.request().method() === 'POST'
      ));
      const identifierResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/media/lookup-upc')
          && response.request().method() === 'POST'
      ));
      await page.getByRole('button', { name: 'Search', exact: true }).click();
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
    } finally {
      await requestContext.dispose();
    }
  });

  test('choosing an identifier-only movie result triggers follow-up title enrichment before apply', async ({ page }) => {
    const title = `Playwright Follow Up ${Date.now()}`;
    const alternateTitle = `${title} Identifier`;
    const upc = `065432${Date.now().toString().slice(-6)}`;
    const credentials = await createFreshUserCredentials();
    const requestContext = await createAuthenticatedRequestContext(credentials);
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

      const storageState = await requestContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await page.goto('/dashboard?tab=library-movies');
      await page.getByRole('button', { name: 'Add', exact: true }).click();

      await page.getByPlaceholder('Movie title').fill(title);
      await page.getByPlaceholder('012345678901').fill(upc);

      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByText(alternateTitle, { exact: true })).toBeVisible();

      await page.locator('button').filter({ has: page.getByText(alternateTitle, { exact: true }) }).first().click();
      await expect.poll(() => followUpLookupCount).toBe(1);
      expect(initialTitleLookupCount).toBe(1);
      expect(followUpLookupCount).toBe(1);

      await expect(page.getByPlaceholder('Movie title')).toHaveValue(alternateTitle);
      await expect(page.getByPlaceholder('2024')).toHaveValue('2023');
      await expect(page.getByPlaceholder('Action, Drama…')).toHaveValue('Sci-Fi');
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
});
