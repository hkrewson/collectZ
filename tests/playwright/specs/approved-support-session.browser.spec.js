'use strict';

const { test, expect } = require('@playwright/test');
const { createFreshUserCredentials, createAuthenticatedRequestContext } = require('../helpers/auth');
const { createApprovedSupportRequestFixture, createLibraryInActiveScope } = require('../helpers/support');
const { signInThroughUi, openHelpSurface } = require('../helpers/session');

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('approved support session browser regressions', () => {
  test('support admin can start tenant access only from an approved request and gets My Space only while the session is active', async ({ page }) => {
    const suffix = Date.now();
    const requesterCredentials = await createFreshUserCredentials({ role: 'user', name: 'Playwright Requester' });
    const supportAdminCredentials = await createFreshUserCredentials({ role: 'support_admin', name: 'Playwright Support Admin' });
    const requesterContext = await createAuthenticatedRequestContext(requesterCredentials);

    let fixture;
    let extraLibrary;
    try {
      fixture = await createApprovedSupportRequestFixture(requesterContext, suffix);
      extraLibrary = await createLibraryInActiveScope(requesterContext, `Support Session Library ${suffix}`);
    } finally {
      await requesterContext.dispose();
    }

    const requestId = Number(fixture?.requestId || 0);
    const requestKey = fixture?.request?.request_key || `SUP-${String(requestId).padStart(6, '0')}`;
    const requestSubject = fixture?.request?.subject || `Approved support flow ${suffix}`;

    await signInThroughUi(page, supportAdminCredentials);
    await openHelpSurface(page, 'Help Admin');
    await page.getByRole('button', { name: 'Support', exact: true }).click();

    const requestCard = page.locator('button').filter({ hasText: requestKey }).first();
    await expect(requestCard).toBeVisible();
    await requestCard.click();

    const startResponsePromise = page.waitForResponse((response) => (
      response.url().includes('/api/auth/support-session/start')
      && response.request().method() === 'POST'
    ));
    await page.getByRole('button', { name: 'Start Approved Support Session' }).click();
    const startResponse = await startResponsePromise;
    expect(startResponse.ok()).toBeTruthy();

    await expect(page.getByText('Support Session Active')).toBeVisible();
    await expect(page.getByText(new RegExp(`Request: ${requestKey}`))).toBeVisible();
    await expect(page.getByText(new RegExp(`Case: ${requestSubject}`))).toBeVisible();
    await expect(page.getByRole('button', { name: 'My Space' })).toBeVisible();

    const switchedLibraryName = String(extraLibrary?.name || `Support Session Library ${suffix}`);
    const switchedLibraryId = String(extraLibrary?.id || '');
    const switchLibraryResponsePromise = page.waitForResponse((response) => (
      response.url().includes('/api/libraries/select')
      && response.request().method() === 'POST'
    ));
    await page.getByRole('combobox', { name: 'Support Library' }).selectOption(switchedLibraryId);
    const switchLibraryResponse = await switchLibraryResponsePromise;
    if (!switchLibraryResponse.ok()) {
      throw new Error(`Support library switch failed (${switchLibraryResponse.status()}): ${await switchLibraryResponse.text()}`);
    }
    await expect(page.getByText(new RegExp(`Library: ${switchedLibraryName}`))).toBeVisible();

    await page.getByRole('button', { name: 'My Space' }).click();
    await expect(page).toHaveURL(/tab=space-manage/);
    await expect(page.getByRole('heading', { name: 'Space' })).toBeVisible();

    const endResponsePromise = page.waitForResponse((response) => (
      response.url().includes('/api/auth/support-session')
      && response.request().method() === 'DELETE'
    ));
    await page.getByRole('button', { name: 'End Session' }).click();
    const endResponse = await endResponsePromise;
    expect(endResponse.ok()).toBeTruthy();

    await expect(page.getByText('Support Session Active')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'My Space' })).toHaveCount(0);
  });
});
