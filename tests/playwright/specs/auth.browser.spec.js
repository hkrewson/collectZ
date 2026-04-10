'use strict';

const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { AUTH_CREDENTIALS_PATH, ensureSavedAdminCredentials } = require('../helpers/auth');
const { signInThroughUi } = require('../helpers/session');

test.use({ storageState: { cookies: [], origins: [] } });

test('admin can sign in and sign out through the browser UI', async ({ page }) => {
  const credentials = fs.existsSync(AUTH_CREDENTIALS_PATH)
    ? JSON.parse(fs.readFileSync(AUTH_CREDENTIALS_PATH, 'utf8'))
    : await ensureSavedAdminCredentials();

  await signInThroughUi(page, credentials);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('button[type="submit"]')).toHaveText('Sign in');
  await expect(page).toHaveURL(/\/login$/);
});
