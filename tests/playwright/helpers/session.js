'use strict';

const { expect } = require('@playwright/test');
const { addPlaywrightBypassCookie } = require('./auth');

async function signInThroughUi(page, credentials) {
  await addPlaywrightBypassCookie(page.context());
  await page.goto('/login');
  await expect(page.locator('button[type="submit"]')).toHaveText('SIGN IN');
  await page.getByPlaceholder('you@example.com').fill(credentials.email);
  await page.getByPlaceholder('••••••••').first().fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login$/);
}

async function openHelpSurface(page, heading) {
  await page.goto('/dashboard?tab=help');
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

module.exports = {
  signInThroughUi,
  openHelpSurface
};
