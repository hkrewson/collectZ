'use strict';

const { expect } = require('@playwright/test');
const { addPlaywrightBypassCookie, getPlaywrightBypassToken } = require('./auth');

async function forcePlaywrightBypassOnAuthRequests(page) {
  const bypassToken = getPlaywrightBypassToken();
  if (!bypassToken) return async () => {};

  const handler = async (route) => {
    const headers = {
      ...route.request().headers(),
      'x-playwright-e2e-bypass': bypassToken
    };
    await route.continue({ headers });
  };

  await page.route('**/api/auth/**', handler);
  return async () => {
    await page.unroute('**/api/auth/**', handler);
  };
}

async function signInThroughUi(page, credentials) {
  await addPlaywrightBypassCookie(page.context());
  const removeForcedBypass = await forcePlaywrightBypassOnAuthRequests(page);
  await page.goto('/login');
  await expect(page.locator('button[type="submit"]')).toHaveText('SIGN IN');
  await page.getByPlaceholder('you@example.com').fill(credentials.email);
  await page.getByPlaceholder('••••••••').first().fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login$/);
  await removeForcedBypass();
}

async function openHelpSurface(page, heading) {
  await page.goto('/dashboard?tab=help');
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

module.exports = {
  signInThroughUi,
  openHelpSurface
};
