'use strict';

const { test, expect } = require('@playwright/test');
const { createSpaceFixture, deleteSpace } = require('../helpers/admin');
const { ensureSavedAdminCredentials, createAuthenticatedRequestContext } = require('../helpers/auth');
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
    await expect(page.getByRole('heading', { name: 'Platform Integrations' })).toBeVisible();

    const sectionTabs = page.getByRole('tablist', { name: 'Integration sections' });
    await expect(sectionTabs.getByRole('tab')).toHaveText([
      'External Logs',
      'Metrics'
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
});
