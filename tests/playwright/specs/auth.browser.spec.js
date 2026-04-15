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
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();

  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByRole('menu', { name: 'Account' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.locator('button[type="submit"]')).toHaveText('Sign in');
  await expect(page).toHaveURL(/\/login$/);
});

test('login screen exposes the forgot-password request flow', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByRole('button', { name: 'Forgot password?' })).toBeVisible();
  await page.getByRole('button', { name: 'Forgot password?' }).click();

  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByText('Let’s get you back in')).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send reset email' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to Sign In' })).toBeVisible();
});

test('login screen exposes self-registration when public registration is available', async ({ page }) => {
  await page.goto('/login');

  const authConfigResponse = await page.request.get('/api/auth/config');
  expect(authConfigResponse.ok()).toBeTruthy();
  const authConfig = await authConfigResponse.json();

  if (authConfig.register_available) {
    await expect(page.getByRole('button', { name: 'Register' })).toBeVisible();
    await page.getByRole('button', { name: 'Register' }).click();

    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByText('Name')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Register' })).toBeVisible();
  } else {
    await expect(page.getByRole('button', { name: 'Register' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/login$/);
  }
});

test('verify-email route handles invalid tokens gracefully', async ({ page }) => {
  await page.goto('/verify-email?token=invalid-token&email=test@example.com');

  await expect(page.getByText('Confirm your email')).toBeVisible();
  await expect(page.getByText('Invalid or expired verification token')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to Sign In' })).toBeVisible();
});
