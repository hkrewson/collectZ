'use strict';

const { test, expect } = require('@playwright/test');
const { ensureSavedAdminCredentials, createAuthenticatedRequestContext } = require('../helpers/auth');
const { snapshotIntegrationState, restoreIntegrationState } = require('../helpers/integrations');

async function openIntegrationsSection(page, name) {
  await page.getByRole('tablist', { name: 'Integration sections' }).getByRole('tab', { name, exact: true }).click();
  await expect(activeSectionRoot(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

function activeSectionRoot(page) {
  return page.locator('.space-y-4.min-w-0');
}

async function saveSection(page, sectionLabel) {
  const responsePromise = page.waitForResponse((response) => (
    response.url().includes('/api/admin/settings/integrations')
      && response.request().method() === 'PUT'
  ));
  await page.getByRole('button', { name: `Save ${sectionLabel}` }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
}

test.describe('integrations browser regressions', () => {
  test('admin can save barcode and games integrations and values persist after reload', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const requestContext = await createAuthenticatedRequestContext(adminCredentials);
    const snapshot = await snapshotIntegrationState(requestContext);
    const suffix = Date.now();

    try {
      await page.goto('/dashboard?tab=admin-integrations&integration=barcode');
      await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();

      await activeSectionRoot(page).locator('select:visible').first().selectOption('barcodelookup');
      const barcodeApiUrlInput = activeSectionRoot(page).locator('input:visible').first();
      const barcodeUrl = `https://api.barcodelookup.com/v3/products?pw=${suffix}`;
      await barcodeApiUrlInput.fill(barcodeUrl);
      await saveSection(page, 'BARCODE');
      await expect(page.getByText('BARCODE settings saved')).toBeVisible();

      await openIntegrationsSection(page, 'Games');
      const gamesApiUrlInput = activeSectionRoot(page).locator('input:visible').nth(0);
      const gamesClientIdInput = activeSectionRoot(page).locator('input:visible').nth(1);
      const gamesUrl = `https://api.igdb.com/v4/games?pw=${suffix}`;
      const gamesClientId = `playwright-client-${suffix}`;
      await gamesApiUrlInput.fill(gamesUrl);
      await gamesClientIdInput.fill(gamesClientId);
      await saveSection(page, 'GAMES');
      await expect(page.getByText('GAMES settings saved')).toBeVisible();

      await page.goto('/dashboard?tab=admin-integrations&integration=barcode');
      await expect(activeSectionRoot(page).locator('select:visible').first()).toHaveValue('barcodelookup');
      await expect(activeSectionRoot(page).locator('input:visible').first()).toHaveValue(barcodeUrl);

      await page.goto('/dashboard?tab=admin-integrations&integration=games');
      await expect(activeSectionRoot(page).locator('input:visible').nth(0)).toHaveValue(gamesUrl);
      await expect(activeSectionRoot(page).locator('input:visible').nth(1)).toHaveValue(gamesClientId);
    } finally {
      await restoreIntegrationState(requestContext, snapshot).catch(() => {});
      await requestContext.dispose();
    }
  });

  test('metrics integration toggle persists after reload and integrations tab layout stays stable', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const requestContext = await createAuthenticatedRequestContext(adminCredentials);
    const snapshot = await snapshotIntegrationState(requestContext);

    try {
      await page.goto('/dashboard?tab=admin-integrations&integration=barcode');
      await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();

      const sectionTabs = page.getByRole('tablist', { name: 'Integration sections' });
      await expect(sectionTabs).toBeVisible();
      await expect(sectionTabs.getByRole('tab')).toHaveText([
        'Audio',
        'Barcode',
        'Books',
        'CWA OPDS',
        'Comics',
        'Games',
        'External Logs',
        'Metrics',
        'Plex',
        'TMDB'
      ]);

      await page.goto('/dashboard?tab=admin-integrations&integration=metrics');
      const metricsSwitch = page.getByRole('switch', { name: /Metrics Export/i });
      const initialChecked = await metricsSwitch.getAttribute('aria-checked');
      const nextChecked = initialChecked === 'true' ? 'false' : 'true';

      const toggleResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/admin/feature-flags/metrics_enabled')
          && response.request().method() === 'PATCH'
      ));
      await metricsSwitch.click();
      const toggleResponse = await toggleResponsePromise;
      expect(toggleResponse.ok()).toBeTruthy();
      await expect(metricsSwitch).toHaveAttribute('aria-checked', nextChecked);

      await page.reload();
      await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
      await expect(page.getByRole('switch', { name: /Metrics Export/i })).toHaveAttribute('aria-checked', nextChecked);
    } finally {
      await restoreIntegrationState(requestContext, snapshot).catch(() => {});
      await requestContext.dispose();
    }
  });
});
