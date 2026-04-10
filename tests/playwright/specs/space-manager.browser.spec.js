'use strict';

const { test, expect, request } = require('@playwright/test');
const {
  createAuthenticatedRequestContext,
  createFreshUserCredentials,
  ensureSavedAdminCredentials,
  getPlaywrightBypassHeaders,
  postWithCsrf
} = require('../helpers/auth');
const { deleteMediaByExactTitle } = require('../helpers/media');

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('space manager browser regressions', () => {
  test('space member can open My Space and see space-scoped activity entries', async ({ page }) => {
    const credentials = await createFreshUserCredentials();
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const title = `Playwright Space Activity ${Date.now()}`;

    await deleteMediaByExactTitle(requestContext, title).catch(() => {});

    try {
      await postWithCsrf(requestContext, '/api/media', {
        title,
        media_type: 'movie',
        owned_formats: ['digital']
      }, 201);

      const storageState = await requestContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await page.goto('/dashboard?tab=space-manage');

      await expect(page.getByRole('button', { name: 'My Space', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Space', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Activity', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'People', exact: true })).toHaveCount(0);

      await page.getByRole('button', { name: 'Activity', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
      await expect(page.getByText('invite.claimed', { exact: true })).toBeVisible();
    } finally {
      await deleteMediaByExactTitle(requestContext, title).catch(() => {});
      await requestContext.dispose();
    }
  });

  test('space admin can open My Space integrations without global-only logs or metrics', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminContext = await createAuthenticatedRequestContext(adminCredentials);
    const ownerEmail = `playwright-space-owner-${Date.now()}@example.com`;
    const ownerPassword = 'Passw0rd!123';
    const ownerName = 'Playwright Space Owner';
    let ownerContext = null;

    try {
      const createdSpaceResponse = await postWithCsrf(adminContext, '/api/admin/spaces/create-with-onboarding', {
        name: `Playwright Owner Space ${Date.now()}`,
        slug: `playwright-owner-space-${Date.now()}`,
        initial_invites: [{
          email: ownerEmail,
          role: 'admin',
          expose_token: true
        }]
      }, 201);
      const createdSpacePayload = await createdSpaceResponse.json();
      const invitePayload = Array.isArray(createdSpacePayload?.invite_results)
        ? createdSpacePayload.invite_results.find((invite) => String(invite?.email || '').toLowerCase() === ownerEmail.toLowerCase())
        : null;
      const inviteToken = String(invitePayload?.token || '').trim();
      expect(inviteToken).toBeTruthy();

      const registrationContext = await request.newContext({
        baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
        extraHTTPHeaders: getPlaywrightBypassHeaders()
      });
      try {
        await postWithCsrf(registrationContext, '/api/auth/register', {
          email: ownerEmail,
          password: ownerPassword,
          name: ownerName,
          inviteToken
        }, 200);
      } finally {
        await registrationContext.dispose();
      }

      ownerContext = await createAuthenticatedRequestContext({ email: ownerEmail, password: ownerPassword });
      const storageState = await ownerContext.storageState();
      await page.context().addCookies(storageState.cookies || []);

      await page.goto('/dashboard?tab=space-manage');
      await expect(page.getByRole('button', { name: 'My Space', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Integrations', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'People', exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Integrations', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Integrations', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'External Logs', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Metrics', exact: true })).toHaveCount(0);
    } finally {
      await ownerContext?.dispose();
      await adminContext.dispose();
    }
  });
});
