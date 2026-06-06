'use strict';

const { test, expect, request } = require('@playwright/test');
const {
  createAuthenticatedRequestContext,
  createFreshUserCredentials,
  ensureSavedAdminCredentials,
  getPlaywrightBypassHeaders,
  postWithCsrf
} = require('../helpers/auth');
const { deleteMediaByExactTitle, findExactMediaByTitle } = require('../helpers/media');
const { deleteEventsByExactTitle } = require('../helpers/eventsCollectibles');

test.use({ storageState: { cookies: [], origins: [] } });

const PLAYWRIGHT_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

async function openPageForRequestContext(browser, requestContext) {
  const storageState = await requestContext.storageState();
  const context = await browser.newContext({
    baseURL: PLAYWRIGHT_BASE_URL,
    storageState
  });
  const page = await context.newPage();
  return { context, page };
}

async function expectManageableFallbackWorkspace(page, excludedSpaceName) {
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Access Restricted' })).toHaveCount(0);
  if (excludedSpaceName) {
    await expect(page.getByRole('heading', { name: excludedSpaceName, exact: true })).toHaveCount(0);
  }
}

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
      await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
      await expect(page.getByText('Library item added').first()).toBeVisible();
      await expect(page.getByText(title).first()).toBeVisible();
      await page.getByRole('button', { name: 'Open item' }).first().click();
      await expect(page).toHaveURL(/tab=library-movies/);
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    } finally {
      await deleteMediaByExactTitle(requestContext, title).catch(() => {});
      await requestContext.dispose();
    }
  });

  test('workspace activity deleted rows open a saved activity snapshot', async ({ page }) => {
    const credentials = await createFreshUserCredentials();
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const title = `Playwright Deleted Activity Snapshot ${Date.now()}`;

    await deleteMediaByExactTitle(requestContext, title).catch(() => {});

    try {
      await postWithCsrf(requestContext, '/api/media', {
        title,
        media_type: 'movie',
        owned_formats: ['digital']
      }, 201);
      await deleteMediaByExactTitle(requestContext, title);

      const storageState = await requestContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await page.goto('/dashboard?tab=space-manage');

      await expect(page.getByRole('button', { name: 'Activity', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Activity', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();

      await page.getByPlaceholder('Action, user, target, or details').fill(title);
      await page.getByPlaceholder('Action, user, target, or details').press('Enter');

      await expect(page.getByText('Library item deleted').first()).toBeVisible();
      await expect(page.getByText(title).first()).toBeVisible();
      await page.getByRole('button', { name: 'View snapshot' }).first().click();
      await expect(page.getByTestId('activity-snapshot-drawer')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Activity snapshot' })).toBeVisible();
      await expect(page.getByText(title).first()).toBeVisible();
      await expect(page.getByText('Technical payload')).toBeVisible();
    } finally {
      await deleteMediaByExactTitle(requestContext, title).catch(() => {});
      await requestContext.dispose();
    }
  });

  test('workspace activity renders event social rows as readable event timeline entries', async ({ page }) => {
    const credentials = await createFreshUserCredentials();
    const requestContext = await createAuthenticatedRequestContext(credentials);
    const suffix = Date.now();
      const eventTitle = `Playwright Timeline Event ${suffix}`;
      const attendeeName = `Timeline Friend ${suffix}`;
    let attendeeId = null;

    await deleteEventsByExactTitle(requestContext, eventTitle).catch(() => {});

    try {
      const eventResponse = await postWithCsrf(requestContext, '/api/events', {
        title: eventTitle,
        url: `https://example.test/timeline-event/${suffix}`,
        location: 'Timeline Hall',
        date_start: '2026-07-24',
        date_end: '2026-07-26'
      }, 201);
      const eventPayload = await eventResponse.json();
      const eventId = Number(eventPayload?.id || 0);
      expect(eventId).toBeGreaterThan(0);

      const attendeeResponse = await postWithCsrf(requestContext, `/api/events/${eventId}/attendees`, {
        display_name: attendeeName,
        role: 'friend'
      }, 201);
      const attendeePayload = await attendeeResponse.json();
      attendeeId = Number(attendeePayload?.id || 0);
      expect(attendeeId).toBeGreaterThan(0);

      const storageState = await requestContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await page.goto('/dashboard?tab=space-manage');

      await expect(page.getByRole('button', { name: 'Activity', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Activity', exact: true }).click();
      await page.locator('label').filter({ hasText: 'Show' }).locator('select').selectOption('events');

      await expect(page.getByText('Event attendee added').first()).toBeVisible();
      await expect(page.getByText(attendeeName).first()).toBeVisible();
      await expect(page.getByText(`Attendee #${attendeeId}`).first()).toBeVisible();
      await expect(page.getByText('Event created').first()).toBeVisible();
      await expect(page.getByText(eventTitle).first()).toBeVisible();
    } finally {
      await deleteEventsByExactTitle(requestContext, eventTitle).catch(() => {});
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
      await expect(page.getByRole('heading', { name: 'Workspace Integrations', exact: true })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Kavita', exact: true })).toBeVisible();
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

      await expect(page.getByRole('heading', { name: 'Workspace Settings', exact: true })).toBeVisible();
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
      const createdSpaceName = String(createdSpacePayload?.space?.name || '').trim();
      expect(createdSpaceId).toBeTruthy();
      expect(createdSpaceName).toBeTruthy();
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

  test('workspace admin can suspend and restore a workspace member without affecting unrelated tenancy state', async ({ page, browser }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminContext = await createAuthenticatedRequestContext(adminCredentials);
    const stamp = Date.now();
    const ownerEmail = `playwright-space-suspend-owner-${stamp}@example.com`;
    const ownerPassword = 'Passw0rd!123';
    const ownerName = 'Playwright Space Suspend Owner';
    const memberEmail = `playwright-space-suspend-member-${stamp}@example.com`;
    const memberPassword = 'Passw0rd!123';
    const memberName = 'Playwright Space Suspend Member';
    let ownerContext = null;
    let memberContext = null;
    let memberBrowserContext = null;
    let memberPage = null;

    try {
      const createdSpaceResponse = await postWithCsrf(adminContext, '/api/admin/spaces/create-with-onboarding', {
        name: `Playwright Suspend Space ${stamp}`,
        slug: `playwright-suspend-space-${stamp}`,
        initial_invites: [
          {
            email: ownerEmail,
            role: 'owner',
            expose_token: true
          },
          {
            email: memberEmail,
            role: 'member',
            expose_token: true
          }
        ]
      }, 201);
      const createdSpacePayload = await createdSpaceResponse.json();
      const createdSpaceId = Number(createdSpacePayload?.space?.id || 0) || null;
      const createdSpaceName = String(createdSpacePayload?.space?.name || '').trim();
      expect(createdSpaceId).toBeTruthy();
      expect(createdSpaceName).toBeTruthy();

      const inviteResults = Array.isArray(createdSpacePayload?.invite_results) ? createdSpacePayload.invite_results : [];
      const ownerInvite = inviteResults.find((invite) => String(invite?.email || '').toLowerCase() === ownerEmail.toLowerCase()) || null;
      const memberInvite = inviteResults.find((invite) => String(invite?.email || '').toLowerCase() === memberEmail.toLowerCase()) || null;
      const ownerInviteToken = String(ownerInvite?.token || '').trim();
      const memberInviteToken = String(memberInvite?.token || '').trim();
      expect(ownerInviteToken).toBeTruthy();
      expect(memberInviteToken).toBeTruthy();

      const registrationContext = await request.newContext({
        baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
        extraHTTPHeaders: getPlaywrightBypassHeaders()
      });
      try {
        await postWithCsrf(registrationContext, '/api/auth/register', {
          email: ownerEmail,
          password: ownerPassword,
          name: ownerName,
          inviteToken: ownerInviteToken
        }, 200);
        await postWithCsrf(registrationContext, '/api/auth/register', {
          email: memberEmail,
          password: memberPassword,
          name: memberName,
          inviteToken: memberInviteToken
        }, 200);
      } finally {
        await registrationContext.dispose();
      }

      ownerContext = await createAuthenticatedRequestContext({ email: ownerEmail, password: ownerPassword });
      memberContext = await createAuthenticatedRequestContext({ email: memberEmail, password: memberPassword });

      const memberSpacesBeforeResponse = await memberContext.get('/api/spaces');
      expect(memberSpacesBeforeResponse.ok()).toBeTruthy();
      const memberSpacesBefore = await memberSpacesBeforeResponse.json();
      expect(Array.isArray(memberSpacesBefore?.spaces)).toBeTruthy();
      expect(memberSpacesBefore.spaces.some((space) => Number(space.id) === createdSpaceId)).toBeTruthy();

      const storageState = await ownerContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await page.goto('/dashboard?tab=space-manage');
      await page.getByRole('button', { name: 'People', exact: true }).click();

      const memberRow = page.getByText(memberEmail, { exact: true }).first();
      await expect(memberRow).toBeVisible();
      await memberRow.locator('xpath=ancestor::div[contains(@class,"grid")][1]/div[last()]//button[@aria-label="Member actions"]').click();

      const suspendResponsePromise = page.waitForResponse((response) => (
        response.url().includes(`/api/spaces/${createdSpaceId}/members/`)
        && response.url().includes('/suspension')
        && response.request().method() === 'PATCH'
      ));
      await Promise.all([
        page.waitForEvent('dialog').then((dialog) => dialog.accept()),
        page.getByRole('button', { name: 'Suspend access', exact: true }).click()
      ]);
      const suspendResponse = await suspendResponsePromise;
      expect(suspendResponse.ok()).toBeTruthy();
      await expect(page.getByText('Suspended', { exact: true })).toBeVisible();

      const memberSpacesAfterSuspendResponse = await memberContext.get('/api/spaces');
      expect(memberSpacesAfterSuspendResponse.ok()).toBeTruthy();
      const memberSpacesAfterSuspend = await memberSpacesAfterSuspendResponse.json();
      expect(Array.isArray(memberSpacesAfterSuspend?.spaces)).toBeTruthy();
      expect(memberSpacesAfterSuspend.spaces.some((space) => Number(space.id) === createdSpaceId)).toBeFalsy();

      ({ context: memberBrowserContext, page: memberPage } = await openPageForRequestContext(browser, memberContext));
      await memberPage.goto('/dashboard');
      await expect(memberPage.getByRole('button', { name: 'Workspace', exact: true })).toBeVisible();
      await memberPage.goto('/dashboard?tab=space-manage');
      await expectManageableFallbackWorkspace(memberPage, createdSpaceName);

      await memberRow.locator('xpath=ancestor::div[contains(@class,"grid")][1]/div[last()]//button[@aria-label="Member actions"]').click();
      const restoreResponsePromise = page.waitForResponse((response) => (
        response.url().includes(`/api/spaces/${createdSpaceId}/members/`)
        && response.url().includes('/suspension')
        && response.request().method() === 'PATCH'
      ));
      await Promise.all([
        page.waitForEvent('dialog').then((dialog) => dialog.accept()),
        page.getByRole('button', { name: 'Restore access', exact: true }).click()
      ]);
      const restoreResponse = await restoreResponsePromise;
      expect(restoreResponse.ok()).toBeTruthy();

      const memberSpacesAfterRestoreResponse = await memberContext.get('/api/spaces');
      expect(memberSpacesAfterRestoreResponse.ok()).toBeTruthy();
      const memberSpacesAfterRestore = await memberSpacesAfterRestoreResponse.json();
      expect(Array.isArray(memberSpacesAfterRestore?.spaces)).toBeTruthy();
      expect(memberSpacesAfterRestore.spaces.some((space) => Number(space.id) === createdSpaceId)).toBeTruthy();

      await memberPage.goto('/dashboard');
      await expect(memberPage.getByRole('button', { name: 'Workspace', exact: true })).toBeVisible();
      await memberPage.goto('/dashboard?tab=space-manage');
      await expect(memberPage.getByRole('heading', { name: 'Access Restricted' })).toHaveCount(0);
      await expect(memberPage.getByRole('button', { name: 'Activity', exact: true })).toBeVisible();
    } finally {
      await memberBrowserContext?.close();
      await memberContext?.dispose();
      await ownerContext?.dispose();
      await adminContext.dispose();
    }
  });

  test('workspace admin can remove a member without deleting the member-created workspace content', async ({ page, browser }) => {
    const adminCredentials = await ensureSavedAdminCredentials();
    const adminContext = await createAuthenticatedRequestContext(adminCredentials);
    const stamp = Date.now();
    const ownerEmail = `playwright-space-remove-owner-${stamp}@example.com`;
    const ownerPassword = 'Passw0rd!123';
    const ownerName = 'Playwright Space Remove Owner';
    const memberEmail = `playwright-space-remove-member-${stamp}@example.com`;
    const memberPassword = 'Passw0rd!123';
    const memberName = 'Playwright Space Remove Member';
    const title = `Playwright Removed Member Content ${stamp}`;
    let ownerContext = null;
    let memberContext = null;
    let memberBrowserContext = null;
    let memberPage = null;

    try {
      const createdSpaceResponse = await postWithCsrf(adminContext, '/api/admin/spaces/create-with-onboarding', {
        name: `Playwright Remove Space ${stamp}`,
        slug: `playwright-remove-space-${stamp}`,
        initial_invites: [
          {
            email: ownerEmail,
            role: 'owner',
            expose_token: true
          },
          {
            email: memberEmail,
            role: 'member',
            expose_token: true
          }
        ]
      }, 201);
      const createdSpacePayload = await createdSpaceResponse.json();
      const createdSpaceId = Number(createdSpacePayload?.space?.id || 0) || null;
      const createdSpaceName = String(createdSpacePayload?.space?.name || '').trim();
      expect(createdSpaceId).toBeTruthy();
      expect(createdSpaceName).toBeTruthy();

      const inviteResults = Array.isArray(createdSpacePayload?.invite_results) ? createdSpacePayload.invite_results : [];
      const ownerInvite = inviteResults.find((invite) => String(invite?.email || '').toLowerCase() === ownerEmail.toLowerCase()) || null;
      const memberInvite = inviteResults.find((invite) => String(invite?.email || '').toLowerCase() === memberEmail.toLowerCase()) || null;
      const ownerInviteToken = String(ownerInvite?.token || '').trim();
      const memberInviteToken = String(memberInvite?.token || '').trim();
      expect(ownerInviteToken).toBeTruthy();
      expect(memberInviteToken).toBeTruthy();

      const registrationContext = await request.newContext({
        baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
        extraHTTPHeaders: getPlaywrightBypassHeaders()
      });
      try {
        await postWithCsrf(registrationContext, '/api/auth/register', {
          email: ownerEmail,
          password: ownerPassword,
          name: ownerName,
          inviteToken: ownerInviteToken
        }, 200);
        await postWithCsrf(registrationContext, '/api/auth/register', {
          email: memberEmail,
          password: memberPassword,
          name: memberName,
          inviteToken: memberInviteToken
        }, 200);
      } finally {
        await registrationContext.dispose();
      }

      ownerContext = await createAuthenticatedRequestContext({ email: ownerEmail, password: ownerPassword });
      memberContext = await createAuthenticatedRequestContext({ email: memberEmail, password: memberPassword });

      await deleteMediaByExactTitle(ownerContext, title).catch(() => {});
      await deleteMediaByExactTitle(memberContext, title).catch(() => {});

      await postWithCsrf(memberContext, '/api/media', {
        title,
        media_type: 'movie',
        owned_formats: ['digital']
      }, 201);

      const memberCreatedItem = await findExactMediaByTitle(ownerContext, title);
      expect(memberCreatedItem).toBeTruthy();

      const storageState = await ownerContext.storageState();
      await page.context().addCookies(storageState.cookies || []);
      await page.goto('/dashboard?tab=space-manage');
      await page.getByRole('button', { name: 'People', exact: true }).click();

      const memberRow = page.getByText(memberEmail, { exact: true }).first();
      await expect(memberRow).toBeVisible();
      await memberRow.locator('xpath=ancestor::div[contains(@class,"grid")][1]/div[last()]//button[@aria-label="Member actions"]').click();

      const removeResponsePromise = page.waitForResponse((response) => (
        response.url().includes(`/api/spaces/${createdSpaceId}/members/`)
        && response.request().method() === 'DELETE'
      ));
      await Promise.all([
        page.waitForEvent('dialog').then((dialog) => dialog.accept()),
        page.getByRole('button', { name: 'Remove', exact: true }).click()
      ]);
      const removeResponse = await removeResponsePromise;
      expect(removeResponse.ok()).toBeTruthy();

      await expect(page.getByText(memberEmail, { exact: true })).toHaveCount(0);

      const memberSpacesAfterRemovalResponse = await memberContext.get('/api/spaces');
      expect(memberSpacesAfterRemovalResponse.ok()).toBeTruthy();
      const memberSpacesAfterRemoval = await memberSpacesAfterRemovalResponse.json();
      expect(Array.isArray(memberSpacesAfterRemoval?.spaces)).toBeTruthy();
      expect(memberSpacesAfterRemoval.spaces.some((space) => Number(space.id) === createdSpaceId)).toBeFalsy();

      ({ context: memberBrowserContext, page: memberPage } = await openPageForRequestContext(browser, memberContext));
      await memberPage.goto('/dashboard');
      await expect(memberPage.getByRole('button', { name: 'Workspace', exact: true })).toBeVisible();
      await memberPage.goto('/dashboard?tab=space-manage');
      await expectManageableFallbackWorkspace(memberPage, createdSpaceName);

      const preservedContent = await findExactMediaByTitle(ownerContext, title);
      expect(preservedContent).toBeTruthy();
    } finally {
      await deleteMediaByExactTitle(ownerContext || adminContext, title).catch(() => {});
      await memberBrowserContext?.close();
      await memberContext?.dispose();
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
