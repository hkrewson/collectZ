'use strict';

const { test, expect } = require('@playwright/test');
const { createFreshUserCredentials, createAuthenticatedRequestContext, getCurrentUser } = require('../helpers/auth');
const { signInThroughUi, openHelpSurface } = require('../helpers/session');

test.use({ storageState: { cookies: [], origins: [] } });

async function ensureHomelabEdition(requestContext) {
  const me = await getCurrentUser(requestContext);
  test.skip(String(me?.product_edition || 'platform') !== 'homelab', 'Homelab-only browser coverage');
}

async function assertHomelabHelpSurface(page) {
  await expect(page.getByRole('button', { name: 'Guidance', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Releases', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Support', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Metrics', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Help' })).toBeVisible();
}

test.describe('homelab help edition regressions', () => {
  test('homelab user gets Help with Guidance and Releases only, and support routes redirect back to help', async ({ page }) => {
    const credentials = await createFreshUserCredentials();
    const requestContext = await createAuthenticatedRequestContext(credentials);

    try {
      await ensureHomelabEdition(requestContext);
      await signInThroughUi(page, credentials);
      await expect(page.getByRole('button', { name: 'Help', exact: true }).first()).toBeVisible();
      await openHelpSurface(page, 'Help');
      await assertHomelabHelpSurface(page);

      await page.goto('/dashboard?tab=support-inbox');
      await expect(page).toHaveURL(/tab=help/);
      await assertHomelabHelpSurface(page);
    } finally {
      await requestContext.dispose();
    }
  });

  test('homelab admin also sees Help instead of Help Admin and never gets support-only help tabs', async ({ page }) => {
    const credentials = await createFreshUserCredentials({ role: 'admin', name: 'Playwright Homelab Admin' });
    const requestContext = await createAuthenticatedRequestContext(credentials);

    try {
      await ensureHomelabEdition(requestContext);
      await signInThroughUi(page, credentials);
      await expect(page.getByRole('button', { name: 'Help', exact: true }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Help Admin', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Global', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'All Spaces', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'All Members', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Activity', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'My Space', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Integrations', exact: true })).toBeVisible();
      await openHelpSurface(page, 'Help');
      await assertHomelabHelpSurface(page);

      await page.goto('/dashboard?tab=support-inbox');
      await expect(page).toHaveURL(/tab=help/);
      await assertHomelabHelpSurface(page);

      await page.goto('/dashboard?tab=admin-spaces');
      await expect(page).toHaveURL(/tab=admin-settings/);
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

      await page.goto('/dashboard?tab=admin-users');
      await expect(page).toHaveURL(/tab=admin-settings/);
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

      await page.goto('/dashboard?tab=admin-activity');
      await expect(page).toHaveURL(/tab=admin-settings/);
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

      await page.goto('/dashboard?tab=space-manage');
      await expect(page).toHaveURL(/tab=admin-settings/);
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    } finally {
      await requestContext.dispose();
    }
  });
});
