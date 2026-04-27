'use strict';

const { test, expect } = require('@playwright/test');
const {
  createFreshUserCredentials,
  createAuthenticatedRequestContext,
  getCurrentUser,
  requestWithCsrf
} = require('../helpers/auth');
const { signInThroughUi } = require('../helpers/session');
const { snapshotIntegrationState, restoreIntegrationState } = require('../helpers/integrations');

test.use({ storageState: { cookies: [], origins: [] } });

async function ensureHomelabEdition(requestContext) {
  const me = await getCurrentUser(requestContext);
  test.skip(String(me?.product_edition || 'platform') !== 'homelab', 'Homelab-only browser coverage');
}

async function getGeneralSettings(requestContext) {
  const response = await requestContext.get('/api/settings/general');
  if (!response.ok()) {
    throw new Error(`Failed to load general settings (${response.status()})`);
  }
  return response.json();
}

async function saveGeneralSettings(requestContext, payload) {
  const response = await requestWithCsrf(requestContext, 'PUT', '/api/admin/settings/general', payload, 200);
  return response.json();
}

test.describe('homelab shared workflow regressions', () => {
  test('homelab user keeps auth, library, import, and profile workflows', async ({ page }) => {
    const credentials = await createFreshUserCredentials();
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const updatedName = `Homelab User ${Date.now()}`;

    try {
      await ensureHomelabEdition(requestContext);
      await signInThroughUi(page, credentials);

      await page.goto('/dashboard?tab=library-movies');
      await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();

      await page.goto('/dashboard?tab=library-import');
      await expect(page.getByRole('heading', { name: 'Import Media' })).toBeVisible();
      await page.getByRole('tab', { name: 'CSV', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Choose CSV File' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Download Template' })).toBeVisible();

      await page.goto('/dashboard?tab=profile');
      await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
      const nameInput = page.locator('.field').filter({ hasText: 'Name' }).locator('input').first();
      await nameInput.fill(updatedName);

      const saveProfilePromise = page.waitForResponse((response) => (
        response.url().includes('/api/profile')
          && response.request().method() === 'PATCH'
      ));
      await page.getByRole('button', { name: 'Save Changes' }).click();
      const saveProfileResponse = await saveProfilePromise;
      expect(saveProfileResponse.ok()).toBeTruthy();
      await expect(page.getByText('Profile updated')).toBeVisible();
      await expect(nameInput).toHaveValue(updatedName);
      await expect(page.getByText(updatedName, { exact: true }).first()).toBeVisible();
    } finally {
      await requestContext.dispose();
    }
  });

  test('homelab admin keeps valid settings and integrations workflows', async ({ page }) => {
    const credentials = await createFreshUserCredentials({ role: 'admin', name: 'Playwright Homelab Shared Admin' });
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const originalSettings = await getGeneralSettings(requestContext);
    const integrationSnapshot = await snapshotIntegrationState(requestContext);
    const nextTheme = originalSettings?.theme === 'dark' ? 'light' : 'dark';
    const barcodeUrl = `https://api.barcodelookup.com/v3/products?homelab=${Date.now()}`;

    try {
      await ensureHomelabEdition(requestContext);
      await signInThroughUi(page, credentials);

      await page.goto('/dashboard?tab=admin-settings');
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
      const themeSelect = page.locator('select').first();
      await expect(themeSelect).toHaveValue(originalSettings.theme);

      const themeSavePromise = page.waitForResponse((response) => (
        response.url().includes('/api/admin/settings/general')
          && response.request().method() === 'PUT'
      ));
      await themeSelect.selectOption(nextTheme);
      const themeSaveResponse = await themeSavePromise;
      expect(themeSaveResponse.ok()).toBeTruthy();
      await expect(page.getByText('Theme updated')).toBeVisible();

      await page.reload();
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await expect(page.locator('select').first()).toHaveValue(nextTheme);

      await page.goto('/dashboard?tab=admin-integrations&integration=barcode');
      await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
      const barcodeApiUrlInput = page.locator('.space-y-4.min-w-0').locator('input:visible').first();
      await barcodeApiUrlInput.fill(barcodeUrl);

      const saveIntegrationPromise = page.waitForResponse((response) => (
        response.url().includes('/api/admin/settings/integrations')
          && response.request().method() === 'PUT'
      ));
      await page.getByRole('button', { name: 'Save BARCODE' }).click();
      const saveIntegrationResponse = await saveIntegrationPromise;
      expect(saveIntegrationResponse.ok()).toBeTruthy();
      await expect(page.getByText('BARCODE settings saved')).toBeVisible();
      await expect(barcodeApiUrlInput).toHaveValue(barcodeUrl);
    } finally {
      await saveGeneralSettings(requestContext, originalSettings).catch(() => {});
      await restoreIntegrationState(requestContext, integrationSnapshot).catch(() => {});
      await requestContext.dispose();
    }
  });
});
