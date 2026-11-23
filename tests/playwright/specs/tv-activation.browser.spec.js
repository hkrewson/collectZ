'use strict';

const { test, expect } = require('@playwright/test');
const { createFreshUserCredentials, postWithCsrf } = require('../helpers/auth');

test.use({ storageState: { cookies: [], origins: [] } });

test('browser sign-in preserves activation and approves only an explicit valid code', async ({ page }) => {
  const credentials = await createFreshUserCredentials({ noCache: true });
  await postWithCsrf(page.request, '/api/auth/login', { email: credentials.email, password: credentials.password }, 200);
  const start = await postWithCsrf(page.request, '/api/mobile/auth/device/start', { device_name: 'Browser test TV' }, 201);
  const code = await start.json();

  await page.context().clearCookies();
  await page.goto('/activate');
  await page.locator('input[type=email]').fill(credentials.email);
  await page.locator('input[type=password]').fill(credentials.password);
  await page.locator('button[type=submit]').click();
  await expect(page.getByRole('heading', { name: 'Connect Apple TV' })).toBeVisible();
  await expect(page).toHaveURL(/\/activate$/);

  await page.getByLabel('Code shown on Apple TV').fill('ZZZZ-ZZZZ');
  await page.getByRole('button', { name: 'Approve Apple TV' }).click();
  await expect(page.getByRole('alert')).toContainText('Check the code');

  await page.getByLabel('Code shown on Apple TV').fill(code.user_code);
  await page.getByRole('button', { name: 'Approve Apple TV' }).click();
  await expect(page.getByRole('status')).toContainText('Apple TV approved');
  // Remove the one-time code before preserving any visual evidence.
  await page.screenshot({ path: 'artifacts/tv-browser/approval.png' });
});
