'use strict';

const { test, expect } = require('@playwright/test');
const { createFreshUserCredentials } = require('../helpers/auth');
const { signInThroughUi, openHelpSurface } = require('../helpers/session');

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('help center browser regressions', () => {
  test('end user can create, reply to, close, reopen, and review support history in Help Center', async ({ page }) => {
    const credentials = await createFreshUserCredentials();
    const subject = `Playwright help flow ${Date.now()}`;
    const message = 'Need browser-level help coverage for the Help Center flow.';
    const reply = 'Adding a follow-up from the browser so this thread has realistic history.';

    await signInThroughUi(page, credentials);
    await openHelpSurface(page, 'Help Center');

    await page.getByRole('button', { name: 'Support', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ask for help' })).toBeVisible();

    await page.getByPlaceholder('What do you need help with?').fill(subject);
    await page.getByPlaceholder('Tell us what you tried, what you expected, and what felt off.').fill(message);
    await page.getByRole('button', { name: 'Create help request' }).click();

    await expect(page.getByRole('heading', { name: 'Reply to Support' })).toBeVisible();
    await expect(page.locator('button').filter({ hasText: subject }).first()).toBeVisible();

    await page.getByPlaceholder('Add more context or reply to support here.').fill(reply);
    await page.getByRole('button', { name: 'Reply' }).click();
    await expect(page.getByText(reply, { exact: true })).toBeVisible();

    const closeResponsePromise = page.waitForResponse((response) => (
      response.url().includes('/api/support/requests/')
      && response.url().includes('/status')
      && response.request().method() === 'PATCH'
    ));
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    const closeResponse = await closeResponsePromise;
    expect(closeResponse.ok()).toBeTruthy();
    await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();

    await page.getByRole('button', { name: /History/ }).click();
    await expect(page.getByText('Status changed from open to closed.')).toBeVisible();

    await page.getByRole('button', { name: 'Conversation' }).click();
    const reopenResponsePromise = page.waitForResponse((response) => (
      response.url().includes('/api/support/requests/')
      && response.url().includes('/status')
      && response.request().method() === 'PATCH'
    ));
    await page.getByRole('button', { name: 'Reopen', exact: true }).click();
    const reopenResponse = await reopenResponsePromise;
    expect(reopenResponse.ok()).toBeTruthy();
    await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();

    await page.getByRole('button', { name: 'Releases', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Recent Releases' })).toBeVisible();
    await page.getByRole('button', { name: 'Details' }).first().click();
    await expect(page.getByRole('button', { name: 'Hide details' }).first()).toBeVisible();
  });
});
