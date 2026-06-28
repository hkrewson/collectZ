'use strict';

const { test, expect } = require('@playwright/test');
const { createFreshUserCredentials } = require('../helpers/auth');
const { signInThroughUi } = require('../helpers/session');

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('browser boundary regressions', () => {
  test('support admin stays in support surfaces by default and cannot browse admin or tenant library views', async ({ page }) => {
    const credentials = await createFreshUserCredentials({ role: 'support_admin', name: 'Playwright Support Admin' });

    await signInThroughUi(page, credentials);
    await page.goto('/dashboard?tab=help');
    await expect(page.getByRole('heading', { name: 'Help Admin' })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Admin', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Global', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();

    await page.goto('/dashboard?tab=library-movies');
    await expect(page).toHaveURL(/\/help$/);
    await expect(page.getByRole('heading', { name: 'Help Admin' })).toBeVisible();

    await page.goto('/dashboard?tab=admin-integrations&integration=logs');
    await expect(page).toHaveURL(/\/help$/);
    await expect(page.getByRole('heading', { name: 'Help Admin' })).toBeVisible();
  });

  test('standard user cannot reach admin surfaces through direct dashboard routes', async ({ page }) => {
    const credentials = await createFreshUserCredentials({ role: 'user', name: 'Playwright Standard User' });

    await signInThroughUi(page, credentials);
    await page.goto('/dashboard?tab=help');
    await expect(page.getByRole('heading', { name: 'Help Center' })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Admin', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Global', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible();

    await page.goto('/platform/workspaces');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
  });
});
