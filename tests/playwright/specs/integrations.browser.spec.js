'use strict';

const { test, expect } = require('@playwright/test');
const { ensureSavedAdminCredentials, createAuthenticatedRequestContext } = require('../helpers/auth');
const { getIntegrationSettings, snapshotIntegrationState, restoreIntegrationState } = require('../helpers/integrations');
const { signInThroughUi } = require('../helpers/session');

async function openIntegrationsSection(page, name) {
  await page.getByRole('tablist', { name: 'Integration sections' }).getByRole('tab', { name, exact: true }).click();
  await expect(activeSectionRoot(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

function activeSectionRoot(page) {
  return page.locator('.space-y-4.min-w-0');
}

async function openDisclosureSection(page, title) {
  const details = activeSectionRoot(page).locator('details').filter({ hasText: title }).first();
  await expect(details).toBeVisible();
  const isOpen = await details.evaluate((node) => node.hasAttribute('open'));
  if (!isOpen) {
    await details.locator('summary').click();
  }
  return details;
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
  test('platform admin integrations expose valuation plus observability sections and log settings persist after reload', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const requestContext = await createAuthenticatedRequestContext(adminCredentials);
    const snapshot = await snapshotIntegrationState(requestContext);
    const suffix = Date.now();
    const logHost = `collector-${suffix}`;
    const logPort = '12201';

    try {
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

      await activeSectionRoot(page).locator('input[name="log_export_host"]').fill(logHost);
      await activeSectionRoot(page).locator('input[name="log_export_port"]').fill(logPort);
      await saveSection(page, 'LOGS');
      await expect(page.getByText('LOGS settings saved')).toBeVisible();

      await page.reload();
      await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
      await expect(activeSectionRoot(page).locator('input[name="log_export_host"]')).toHaveValue(logHost);
      await expect(activeSectionRoot(page).locator('input[name="log_export_port"]')).toHaveValue(logPort);
    } finally {
      await restoreIntegrationState(requestContext, snapshot).catch(() => {});
      await requestContext.dispose();
    }
  });

  test('metrics integration toggle persists after reload and platform integrations layout stays stable', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const requestContext = await createAuthenticatedRequestContext(adminCredentials);
    const snapshot = await snapshotIntegrationState(requestContext);

    try {
      await signInThroughUi(page, adminCredentials);
      await page.goto('/dashboard?tab=admin-integrations&integration=logs');
      await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();

      const sectionTabs = page.getByRole('tablist', { name: 'Integration sections' });
      await expect(sectionTabs).toBeVisible();
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
        'TMDB',
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
      await expect(page.getByRole('heading', { name: 'Runtime checks' })).toBeVisible();
      await expect(activeSectionRoot(page).getByText('/api/metrics', { exact: true })).toBeVisible();

      await page.goto('/dashboard?tab=admin-integrations&integration=logs');
      const logsRuntimeChecks = await openDisclosureSection(page, 'Runtime Checks');
      const logsRuntime = (await getIntegrationSettings(requestContext)).observabilityRuntime?.logs;
      expect(logsRuntime).toBeTruthy();
      await expect(logsRuntimeChecks.getByText(String(logsRuntime.backend), { exact: true })).toBeVisible();
      await expect(
        logsRuntimeChecks.getByText(`${logsRuntime.host}:${logsRuntime.port}`, { exact: true })
      ).toBeVisible();
    } finally {
      await restoreIntegrationState(requestContext, snapshot).catch(() => {});
      await requestContext.dispose();
    }
  });
});
