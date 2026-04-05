'use strict';

const { test, expect } = require('@playwright/test');
const { createSpaceFixture, deleteSpace } = require('../helpers/admin');

test.describe('admin shell browser regressions', () => {
  test('authenticated admin shell loads and docs surface is available when debug gating is satisfied', async ({ page, request }) => {
    await page.goto('/dashboard?tab=help');
    await expect(page.getByRole('heading', { name: 'HELP ADMIN' })).toBeVisible();

    const docsResponse = await request.get('/api/docs');
    expect(docsResponse.ok()).toBeTruthy();

    await page.goto('/api/docs');
    await expect(page).toHaveTitle(/collectZ API Docs/i);
    await expect(page.locator('#swagger-ui')).toBeVisible();
  });

  test('all spaces drawer tabs and support-session banner behave in the browser', async ({ page, request }) => {
    const suffix = Date.now();
    const { space } = await createSpaceFixture(request, suffix);
    let cleanupPending = true;

    try {
      await page.goto('/dashboard?tab=admin-spaces');
      await expect(page.getByRole('heading', { name: 'All Spaces' })).toBeVisible();

      await page.getByRole('heading', { name: space.name }).click();
      await expect(page.getByRole('heading', { name: 'Space Controls' })).toBeVisible();

      await page.getByRole('tab', { name: /Members \(/ }).click();
      await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

      await page.getByRole('tab', { name: /Invitations \(/ }).click();
      await expect(page.getByRole('heading', { name: 'Invitations' })).toBeVisible();

      await page.getByRole('button', { name: 'Start Support Session' }).first().click();
      await expect(page.getByRole('heading', { name: new RegExp(`Open explicit support access for ${space.name}`) })).toBeVisible();

      await page.getByLabel('Reason').fill(`Playwright support session ${suffix}`);
      await page.getByRole('button', { name: 'Start Support Session' }).last().click();

      await expect(page.getByText('Support Session Active')).toBeVisible();
      await expect(page.getByText(new RegExp(`Reason: Playwright support session ${suffix}`))).toBeVisible();

      await page.getByRole('button', { name: 'End Session' }).click();
      await expect(page.getByText('Support Session Active')).toHaveCount(0);
    } finally {
      if (cleanupPending) {
        await deleteSpace(request, Number(space.id)).catch(() => {});
      }
    }
  });

  test('integrations tabs switch and save feedback stays visible', async ({ page }) => {
    await page.goto('/dashboard?tab=admin-integrations&integration=barcode');
    await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();

    const sectionTabs = page.getByRole('tablist', { name: 'Integration sections' });
    await sectionTabs.getByRole('tab', { name: 'Games', exact: true }).click();
    await expect(page.getByText('Games', { exact: true }).nth(1)).toBeVisible();

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
