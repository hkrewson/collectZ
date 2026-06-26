'use strict';

const { test, expect } = require('@playwright/test');
const { createFreshUserCredentials } = require('../helpers/auth');
const { signInThroughUi } = require('../helpers/session');

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('import browser regressions', () => {
  test('end user sees the current import surface with file and connected-service tabs but no standalone barcode tab', async ({ page }) => {
    const credentials = await createFreshUserCredentials();

    await signInThroughUi(page, credentials);
    await page.goto('/dashboard?tab=library-import');

    await expect(page.getByRole('heading', { name: 'Import Media' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Import sources' })).toBeVisible();

    await expect(page.getByRole('tab', { name: 'Calibre', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'CSV', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Delicious', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Capture Inbox', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Barcode', exact: true })).toHaveCount(0);

    await page.getByRole('tab', { name: 'CSV', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Choose CSV File', exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Delicious', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Choose Delicious CSV', exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Capture Inbox', exact: true }).click();
    await expect(page).toHaveURL(/\/library\/capture$/);
    await expect(page.getByRole('heading', { name: 'Capture Inbox', exact: true })).toBeVisible();
  });
});
