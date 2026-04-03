'use strict';

const { test, expect } = require('@playwright/test');
const { captureNamedPage } = require('../helpers/capture');
const { createSupportCaptureFixture } = require('../helpers/support');

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
