'use strict';

const { test, expect } = require('@playwright/test');
const {
  createAuthenticatedRequestContext,
  createFreshUserCredentials,
  getCurrentUser
} = require('../helpers/auth');
const { signInThroughUi } = require('../helpers/session');

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('browser boundary regressions', () => {
  test('support admin stays in Core help by default and cannot browse admin or tenant library views', async ({ page }) => {
    const credentials = await createFreshUserCredentials({ role: 'support_admin', name: 'Playwright Support Admin' });

    await signInThroughUi(page, credentials);
    await page.goto('/dashboard?tab=help');
    await expect(page.getByRole('heading', { name: 'Help' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Support', exact: true })).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Admin', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Global', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();

    await page.goto('/dashboard?tab=library-movies');
    await expect(page).toHaveURL(/\/help$/);
    await expect(page.getByRole('heading', { name: 'Help' })).toBeVisible();

    await page.goto('/dashboard?tab=admin-integrations&integration=logs');
    await expect(page).toHaveURL(/\/help$/);
    await expect(page.getByRole('heading', { name: 'Help' })).toBeVisible();
  });

  test('standard user cannot reach admin surfaces through direct dashboard routes', async ({ page }) => {
    const credentials = await createFreshUserCredentials({ role: 'user', name: 'Playwright Standard User' });

    await signInThroughUi(page, credentials);
    await page.goto('/dashboard?tab=help');
    await expect(page.getByRole('heading', { name: 'Help' })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Admin', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Global', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible();

    await page.goto('/platform/workspaces');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
  });

  test('platform admin sidebar does not expose local admin integrations as a sibling nav item', async ({ page }) => {
    const credentials = await createFreshUserCredentials({ role: 'admin', name: 'Playwright Platform Admin' });
    const requestContext = await createAuthenticatedRequestContext(credentials);

    try {
      const currentUser = await getCurrentUser(requestContext);
      test.skip(currentUser?.product_edition !== 'platform', 'Platform-only sidebar boundary coverage');
    } finally {
      await requestContext.dispose();
    }

    await signInThroughUi(page, credentials);
    await page.goto('/dashboard');

    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Integrations', exact: true })).toHaveCount(0);
  });
});
