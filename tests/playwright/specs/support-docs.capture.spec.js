'use strict';

const { test, expect } = require('@playwright/test');
const { createFreshUserCredentials } = require('../helpers/auth');
const { captureNamedPage } = require('../helpers/capture');
const { createSupportCaptureFixture } = require('../helpers/support');
const { signInThroughUi, openHelpSurface } = require('../helpers/session');

test.describe('support docs capture flows @capture', () => {
  test('capture login surface and seeded Help Admin workspace states', async ({ page, request }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });

    await page.goto('/login');
    await expect(page.locator('button[type="submit"]')).toHaveText('SIGN IN');
    await captureNamedPage(page, 'auth-login');

    const requestId = await createSupportCaptureFixture(request, Date.now());

    await page.goto('/dashboard?tab=support-inbox');
    await expect(page.getByRole('heading', { name: 'Help Admin' })).toBeVisible();

    const requestCard = page.locator('button').filter({ hasText: `SUP-${String(requestId).padStart(6, '0')}` }).first();
    await requestCard.click();

    await expect(page.getByRole('button', { name: 'Conversation' })).toBeVisible();
    await captureNamedPage(page, 'help-admin-conversation');

    await page.getByRole('button', { name: 'Triage' }).click();
    await expect(page.getByText('Linked engineering work')).toBeVisible();
    await captureNamedPage(page, 'help-admin-triage');

    await page.goto('/dashboard?tab=admin-integrations&integration=barcode');
    await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
    await captureNamedPage(page, 'admin-integrations');
  });
});

test.describe('help center docs capture flows @capture', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('capture Help Center support and releases surfaces for end-user docs', async ({ page }) => {
    const credentials = await createFreshUserCredentials();
    const subject = `Capture help flow ${Date.now()}`;

    await page.setViewportSize({ width: 1600, height: 1000 });
    await signInThroughUi(page, credentials);
    await openHelpSurface(page, 'Help Center');

    await page.getByRole('button', { name: 'Support', exact: true }).click();
    await page.getByPlaceholder('What do you need help with?').fill(subject);
    await page.getByPlaceholder('Tell us what you tried, what you expected, and what felt off.').fill('Capture a stable Help Center support thread for support-reference documentation.');
    await page.getByRole('button', { name: 'Create help request' }).click();
    await expect(page.getByRole('heading', { name: 'Reply to Support' })).toBeVisible();
    await captureNamedPage(page, 'help-center-support');

    await page.getByRole('button', { name: 'Releases', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Recent Releases' })).toBeVisible();
    await page.getByRole('button', { name: 'Details' }).first().click();
    await captureNamedPage(page, 'help-center-releases');
  });
});
