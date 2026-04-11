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
  test('workspace member can open Workspace and see workspace-scoped activity entries', async ({ page }) => {
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

      await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: /Playwright Space/ })).toBeVisible();
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

  test('platform activity excludes workspace-local media actions while workspace activity retains them', async () => {
    const credentials = await createFreshUserCredentials();
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminContext = await createAuthenticatedRequestContext(adminCredentials);
    const title = `Playwright Workspace Activity Boundary ${Date.now()}`;

    await deleteMediaByExactTitle(requestContext, title).catch(() => {});

    try {
      await postWithCsrf(requestContext, '/api/media', {
        title,
        media_type: 'movie',
        owned_formats: ['digital']
      }, 201);

      const meResponse = await requestContext.get('/api/auth/me');
      expect(meResponse.ok()).toBeTruthy();
      const mePayload = await meResponse.json();
      const activeSpaceId = Number(mePayload?.active_space_id || 0) || null;
      expect(activeSpaceId).toBeTruthy();

      const workspaceActivityResponse = await requestContext.get(`/api/spaces/${activeSpaceId}/activity?search=${encodeURIComponent(title)}`);
      expect(workspaceActivityResponse.ok()).toBeTruthy();
      const workspaceActivityRows = await workspaceActivityResponse.json();
      expect(Array.isArray(workspaceActivityRows)).toBeTruthy();
      expect(workspaceActivityRows.length).toBeGreaterThan(0);

      const platformActivityResponse = await adminContext.get(`/api/admin/activity?search=${encodeURIComponent(title)}`);
      expect(platformActivityResponse.ok()).toBeTruthy();
      const platformActivityRows = await platformActivityResponse.json();
      expect(Array.isArray(platformActivityRows)).toBeTruthy();
      expect(platformActivityRows).toHaveLength(0);
    } finally {
      await deleteMediaByExactTitle(requestContext, title).catch(() => {});
      await adminContext.dispose();
      await requestContext.dispose();
    }
  });

  test('workspace admin can open Workspace integrations without platform-only logs or metrics', async ({ page }) => {
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
      await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toBeVisible();
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

  test('space admin settings keep name at the top and show real space-owned controls', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminContext = await createAuthenticatedRequestContext(adminCredentials);
    const ownerEmail = `playwright-space-settings-${Date.now()}@example.com`;
    const ownerPassword = 'Passw0rd!123';
    const ownerName = 'Playwright Space Settings';
    let ownerContext = null;

    try {
      const createdSpaceResponse = await postWithCsrf(adminContext, '/api/admin/spaces/create-with-onboarding', {
        name: `Playwright Settings Space ${Date.now()}`,
        slug: `playwright-settings-space-${Date.now()}`,
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
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();

      await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
      await expect(page.getByText('Theme', { exact: true })).toBeVisible();
      await expect(page.getByText('Events Library', { exact: true })).toBeVisible();
      await expect(page.getByText('Collectibles Library', { exact: true })).toBeVisible();
      await expect(page.getByText('Slug', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Description', { exact: true })).toHaveCount(0);

      const themeSavePromise = page.waitForResponse((response) => (
        response.url().includes('/api/spaces/')
        && response.url().includes('/settings/general')
        && response.request().method() === 'PUT'
      ));
      await page.locator('select').first().selectOption('dark');
      const themeSaveResponse = await themeSavePromise;
      expect(themeSaveResponse.ok()).toBeTruthy();
      const scopedSettingsResponse = await ownerContext.get('/api/settings/general');
      expect(scopedSettingsResponse.ok()).toBeTruthy();
      const scopedSettingsPayload = await scopedSettingsResponse.json();
      expect(scopedSettingsPayload?.theme).toBe('dark');

      const eventsSwitch = page.getByRole('switch', { name: /Events Library/i });
      const nextEventsEnabled = (await eventsSwitch.getAttribute('aria-checked')) !== 'true';
      const eventsTogglePromise = page.waitForResponse((response) => (
        response.url().includes('/api/spaces/')
        && response.url().includes('/feature-flags/events_enabled')
        && response.request().method() === 'PATCH'
      ));
      await eventsSwitch.click();
      const eventsToggleResponse = await eventsTogglePromise;
      expect(eventsToggleResponse.ok()).toBeTruthy();
      const scopedFlagsResponse = await ownerContext.get('/api/media/feature-flags');
      expect(scopedFlagsResponse.ok()).toBeTruthy();
      const scopedFlagsPayload = await scopedFlagsResponse.json();
      expect(Boolean(scopedFlagsPayload?.flags?.events_enabled)).toBe(nextEventsEnabled);
    } finally {
      await ownerContext?.dispose();
      await adminContext.dispose();
    }
  });

  test('workspace admin can create a workspace-scoped password reset copy link for a member', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminContext = await createAuthenticatedRequestContext(adminCredentials);
    const stamp = Date.now();
    const ownerEmail = `playwright-space-reset-owner-${stamp}@example.com`;
    const ownerPassword = 'Passw0rd!123';
    const ownerName = 'Playwright Space Reset Owner';
    let ownerContext = null;

    try {
      const createdSpaceResponse = await postWithCsrf(adminContext, '/api/admin/spaces/create-with-onboarding', {
        name: `Playwright Reset Space ${stamp}`,
        slug: `playwright-reset-space-${stamp}`,
        initial_invites: [{
          email: ownerEmail,
          role: 'admin',
          expose_token: true
        }]
      }, 201);
      const createdSpacePayload = await createdSpaceResponse.json();
      const createdSpaceId = Number(createdSpacePayload?.space?.id || 0) || null;
      expect(createdSpaceId).toBeTruthy();
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

      const memberCredentials = await createFreshUserCredentials({
        role: 'user',
        name: 'Playwright Workspace Member'
      });
      expect(String(memberCredentials?.email || '')).toBeTruthy();
      const adminUsersResponse = await adminContext.get('/api/admin/users', {
        headers: getPlaywrightBypassHeaders()
      });
      expect(adminUsersResponse.ok()).toBeTruthy();
      const adminUsersPayload = await adminUsersResponse.json();
      const adminUsers = Array.isArray(adminUsersPayload?.users)
        ? adminUsersPayload.users
        : (Array.isArray(adminUsersPayload) ? adminUsersPayload : []);
      const memberUser = adminUsers.find((user) => (
        String(user?.email || '').trim().toLowerCase() === String(memberCredentials.email || '').trim().toLowerCase()
      )) || null;
      expect(Number(memberUser?.id || 0)).toBeGreaterThan(0);
      await postWithCsrf(adminContext, `/api/admin/spaces/${createdSpaceId}/members`, {
        user_id: Number(memberUser.id),
        role: 'member'
      }, 201);

      ownerContext = await createAuthenticatedRequestContext({ email: ownerEmail, password: ownerPassword });
      const storageState = await ownerContext.storageState();
      await page.context().addCookies(storageState.cookies || []);

      await page.goto('/dashboard?tab=space-manage');
      await page.getByRole('button', { name: 'People', exact: true }).click();

      const memberRow = page.getByText(memberCredentials.email, { exact: true }).first();
      await expect(memberRow).toBeVisible();
      await memberRow.locator('xpath=ancestor::div[contains(@class,"grid")][1]/div[last()]//button[@aria-label="Member actions"]').click();

      const resetResponsePromise = page.waitForResponse((response) => (
        response.url().includes(`/api/spaces/${createdSpaceId}/members/`)
        && response.url().includes('/password-reset')
        && response.request().method() === 'POST'
      ));
      await page.getByRole('button', { name: 'Create copy link', exact: true }).click();
      const resetResponse = await resetResponsePromise;
      expect(resetResponse.ok()).toBeTruthy();

      await expect(page.getByText(`Password reset for ${memberCredentials.email}`, { exact: true })).toBeVisible();
      await expect(page.locator('code').filter({ hasText: '/reset-password?token=' })).toBeVisible();
    } finally {
      await ownerContext?.dispose();
      await adminContext.dispose();
    }
  });

  test('opening Workspace switches to a manageable workspace when current scope is only member-level', async ({ page }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminContext = await createAuthenticatedRequestContext(adminCredentials);
    const timestamp = Date.now();
    const ownerEmail = `playwright-space-switch-${timestamp}@example.com`;
    const ownerPassword = 'Passw0rd!123';
    const ownerName = 'Playwright Space Switcher';
    let ownerContext = null;

    try {
      const ownedSpaceResponse = await postWithCsrf(adminContext, '/api/admin/spaces/create-with-onboarding', {
        name: `Playwright Owned Space ${timestamp}`,
        slug: `playwright-owned-space-${timestamp}`,
        initial_invites: [{
          email: ownerEmail,
          role: 'admin',
          expose_token: true
        }]
      }, 201);
      const ownedSpacePayload = await ownedSpaceResponse.json();
      const ownedSpaceId = Number(ownedSpacePayload?.space?.id || 0) || null;
      const invitePayload = Array.isArray(ownedSpacePayload?.invite_results)
        ? ownedSpacePayload.invite_results.find((invite) => String(invite?.email || '').toLowerCase() === ownerEmail.toLowerCase())
        : null;
      const inviteToken = String(invitePayload?.token || '').trim();
      expect(ownedSpaceId).toBeTruthy();
      expect(inviteToken).toBeTruthy();

      const memberSpaceResponse = await postWithCsrf(adminContext, '/api/admin/spaces/create-with-onboarding', {
        name: `Playwright Member Space ${timestamp}`,
        slug: `playwright-member-space-${timestamp}`
      }, 201);
      const memberSpacePayload = await memberSpaceResponse.json();
      const memberSpaceId = Number(memberSpacePayload?.space?.id || 0) || null;
      expect(memberSpaceId).toBeTruthy();

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
      const meResponse = await ownerContext.get('/api/auth/me');
      expect(meResponse.ok()).toBeTruthy();
      const mePayload = await meResponse.json();
      const ownerUserId = Number(mePayload?.id || 0) || null;
      expect(ownerUserId).toBeTruthy();

      await postWithCsrf(adminContext, `/api/admin/spaces/${memberSpaceId}/members`, {
        user_id: ownerUserId,
        role: 'member'
      }, 201);

      await postWithCsrf(ownerContext, '/api/auth/scope', {
        space_id: memberSpaceId
      }, 200);

      const storageState = await ownerContext.storageState();
      await page.context().addCookies(storageState.cookies || []);

      await page.goto('/dashboard');
      await page.getByRole('button', { name: 'Workspace', exact: true }).click();

      await expect(page.getByRole('heading', { name: `Playwright Owned Space ${timestamp}`, exact: true })).toBeVisible();
      await expect(page.getByText('Role: admin')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Integrations', exact: true })).toBeVisible();
    } finally {
      await ownerContext?.dispose();
      await adminContext.dispose();
    }
  });
});
