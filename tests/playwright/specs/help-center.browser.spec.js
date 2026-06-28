'use strict';

const { test, expect } = require('@playwright/test');
const { createFreshUserCredentials } = require('../helpers/auth');
const { signInThroughUi, openHelpSurface } = require('../helpers/session');

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('help center browser regressions', () => {
  test('end user can read Core help guidance and release details without platform support tabs', async ({ page }) => {
    const credentials = await createFreshUserCredentials({ noCache: true });

    await signInThroughUi(page, credentials);
    await openHelpSurface(page, 'Help Center');

    await expect(page.getByRole('tab', { name: 'Guidance', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Releases', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Support', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Metrics', exact: true })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Releases', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Recent Releases' })).toBeVisible();
    await page.getByRole('button', { name: 'Details' }).first().click();
    await expect(page.getByRole('button', { name: 'Hide details' }).first()).toBeVisible();
  });
});
