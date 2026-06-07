'use strict';

const { test, expect } = require('@playwright/test');
const { createFreshUserCredentials, createAuthenticatedRequestContext } = require('../helpers/auth');
const {
  createApprovedSupportRequestFixture,
  createLibraryInActiveScope,
  createDetachedLibraryForCurrentUser,
  updateSupportSessionStateForRequestContext
} = require('../helpers/support');
const { openHelpSurface } = require('../helpers/session');

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('approved support session browser regressions', () => {
  test('support admin can start tenant access only from an approved request and gets tenant Settings only while the session is active', async ({ page }) => {
    const suffix = Date.now();
    const requesterCredentials = await createFreshUserCredentials({ role: 'user', name: 'Playwright Requester' });
    const supportAdminCredentials = await createFreshUserCredentials({ role: 'support_admin', name: 'Playwright Support Admin' });
    const requesterContext = await createAuthenticatedRequestContext(requesterCredentials);

    let fixture;
    let extraLibrary;
    let detachedLibrary;
    try {
      fixture = await createApprovedSupportRequestFixture(requesterContext, suffix);
      extraLibrary = await createLibraryInActiveScope(requesterContext, `Support Session Library ${suffix}`);
      detachedLibrary = await createDetachedLibraryForCurrentUser(requesterContext, suffix);
    } finally {
      await requesterContext.dispose();
    }

    const requestId = Number(fixture?.requestId || 0);
    const requestKey = fixture?.request?.request_key || `SUP-${String(requestId).padStart(6, '0')}`;
    const requestSubject = fixture?.request?.subject || `Approved support flow ${suffix}`;

    const supportAdminContext = await createAuthenticatedRequestContext(supportAdminCredentials);
    try {
      const storageState = await supportAdminContext.storageState();
      await page.context().addCookies(storageState.cookies || []);

      await page.goto('/dashboard');
      await openHelpSurface(page, 'Help Admin');
      await page.getByRole('tab', { name: 'Support', exact: true }).click();

      const requestCard = page.locator('button').filter({ hasText: requestKey }).first();
      await expect(requestCard).toBeVisible();
      await requestCard.click();

      await page.getByRole('button', { name: 'Start Approved Support Session' }).click();

      await expect(page.getByText('Support session active')).toBeVisible();
      await expect(page.getByText(new RegExp(`Request: ${requestKey}`))).toBeVisible();
      await expect(page.getByText(new RegExp(`Case: ${requestSubject}`))).toBeVisible();
      const nav = page.getByRole('navigation');
      await expect(nav.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toHaveCount(0);

      const switchedLibraryName = String(extraLibrary?.name || `Support Session Library ${suffix}`);
      const switchedLibraryId = String(extraLibrary?.id || '');
      const supportLibrarySelect = page.getByRole('combobox', { name: 'Support Library' });
      const switchLibraryResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/libraries/select')
        && response.request().method() === 'POST'
      ));
      await supportLibrarySelect.selectOption(switchedLibraryId);
      const switchLibraryResponse = await switchLibraryResponsePromise;
      if (!switchLibraryResponse.ok()) {
        throw new Error(`Support library switch failed (${switchLibraryResponse.status()}): ${await switchLibraryResponse.text()}`);
      }
      await expect(page.getByText(`Library: ${switchedLibraryName}`, { exact: true })).toBeVisible();

      await updateSupportSessionStateForRequestContext(supportAdminContext, {
        support_library_id: Number(detachedLibrary?.id || 0) || null
      });

      await page.reload();
      await expect(page.getByText('Support session active')).toBeVisible();
      await expect(page.getByText(new RegExp(`Request: ${requestKey}`))).toBeVisible();
      await expect(page.getByText(new RegExp(`Case: ${requestSubject}`))).toBeVisible();
      await expect(supportLibrarySelect).toHaveValue(/^\d+$/);
      await expect(supportLibrarySelect).not.toHaveValue(switchedLibraryId);
      await expect(page.getByText(new RegExp(`Library: ${switchedLibraryName}`))).toHaveCount(0);

      await nav.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(page).toHaveURL(/tab=space-manage/);
      await expect(page.getByRole('button', { name: 'Activity', exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'End support session' }).click();

      await expect(page.getByText('Support session active')).toHaveCount(0);
      await expect(page).toHaveURL(/tab=help/);
      await expect(page.getByRole('combobox', { name: 'Support Library' })).toHaveCount(0);

      await page.goto('/dashboard?tab=space-manage');
      await expect(page).toHaveURL(/tab=help/);
      await expect(page.getByRole('heading', { name: 'Help Admin' })).toBeVisible();
    } finally {
      await supportAdminContext.dispose();
    }
  });
});
