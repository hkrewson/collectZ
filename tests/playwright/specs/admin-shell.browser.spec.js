'use strict';

const { test, expect } = require('@playwright/test');
const { createSpaceFixture, deleteSpace } = require('../helpers/admin');
const { ensureSavedAdminCredentials, createAuthenticatedRequestContext, postWithCsrf } = require('../helpers/auth');
const { deleteMediaByExactTitle } = require('../helpers/media');
const { signInThroughUi } = require('../helpers/session');

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('admin shell browser regressions', () => {
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

      await expect(page.getByText('Matched on ISBN')).toBeVisible();
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

      await expect(page.getByText('Cross-type merges are not allowed')).toBeVisible();
      await expect(page.getByText('This record is Book and the matched record is Movie.')).toBeVisible();

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
    } finally {
      for (const mediaId of createdIds.reverse()) {
        await requestContext.delete(`/api/media/${mediaId}`).catch(() => {});
      }
      await requestContext.dispose();
    }
  });
});
