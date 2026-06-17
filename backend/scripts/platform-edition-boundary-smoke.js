#!/usr/bin/env node

'use strict';

const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { ensureUserDefaultScope } = require('../services/libraries');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PLAYWRIGHT_E2E_BYPASS_TOKEN = String(process.env.PLAYWRIGHT_E2E_BYPASS_TOKEN || '').trim();

class HttpClient {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
    this.csrfToken = '';
  }

  applySetCookies(headers) {
    const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const cookieLine of raw) {
      const firstPart = String(cookieLine).split(';')[0] || '';
      const idx = firstPart.indexOf('=');
      if (idx <= 0) continue;
      const key = firstPart.slice(0, idx).trim();
      const value = firstPart.slice(idx + 1).trim();
      if (key) this.cookies.set(key, value);
    }
  }

  cookieHeader() {
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(path, options = {}) {
    const { method = 'GET', body, expectStatus, withCsrf = false } = options;
    const headers = { Accept: 'application/json' };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (PLAYWRIGHT_E2E_BYPASS_TOKEN) {
      headers['x-playwright-e2e-bypass'] = PLAYWRIGHT_E2E_BYPASS_TOKEN;
    }
    if (withCsrf) {
      await this.fetchCsrfToken();
      headers['x-csrf-token'] = this.csrfToken;
    }

    const cookieHeader = this.cookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    this.applySetCookies(response.headers);

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (expectStatus !== undefined && response.status !== expectStatus) {
      throw new Error(
        `[${this.name}] ${method} ${path} expected ${expectStatus}, got ${response.status}. Body: ${JSON.stringify(data)}`
      );
    }

    return { status: response.status, data };
  }

  async fetchCsrfToken() {
    const response = await this.request('/api/auth/csrf-token', { expectStatus: 200 });
    const token = response?.data?.csrfToken;
    if (!token) throw new Error(`[${this.name}] Missing CSRF token`);
    this.csrfToken = token;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function createDirectUser({ email, password, name, role = 'user' }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, $3, $4, true, NOW())
     RETURNING id, email, name, role`,
    [email, passwordHash, name, role]
  );
  const user = result.rows[0];
  await ensureUserDefaultScope(user.id);
  return user;
}

async function cleanupDirectUser(userId) {
  const numericUserId = Number(userId);
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) return;

  await pool.query('DELETE FROM media WHERE library_id IN (SELECT id FROM libraries WHERE created_by = $1)', [numericUserId]).catch(() => {});
  await pool.query('DELETE FROM invites WHERE created_by = $1 OR used_by = $1', [numericUserId]).catch(() => {});
  await pool.query('DELETE FROM library_memberships WHERE user_id = $1', [numericUserId]).catch(() => {});
  await pool.query('DELETE FROM library_memberships WHERE library_id IN (SELECT id FROM libraries WHERE created_by = $1)', [numericUserId]).catch(() => {});
  await pool.query('DELETE FROM libraries WHERE created_by = $1', [numericUserId]).catch(() => {});
  await pool.query('DELETE FROM space_memberships WHERE user_id = $1', [numericUserId]).catch(() => {});
  await pool.query("DELETE FROM spaces WHERE created_by = $1 AND lower(COALESCE(slug, '')) <> 'default'", [numericUserId]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id = $1', [numericUserId]).catch(() => {});
}

async function loginWithEmail(client, email, password) {
  await client.fetchCsrfToken();
  await client.request('/api/auth/login', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 200,
    body: { email, password }
  });
}

async function registerWithInvite(client, { email, password, name, inviteToken }) {
  await client.fetchCsrfToken();
  return client.request('/api/auth/register', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 200,
    body: { email, password, name, inviteToken }
  });
}

async function main() {
  const suffix = Date.now();
  const adminEmail = `platform-admin-${suffix}@example.com`;
  const userEmail = `platform-user-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  let adminUserId = null;
  let userUserId = null;

  const admin = new HttpClient('platform-admin');
  const user = new HttpClient('platform-user');

  try {
    const adminUser = await createDirectUser({
      email: adminEmail,
      password,
      name: 'Platform Boundary Admin',
      role: 'admin'
    });
    adminUserId = Number(adminUser.id);

    const directUser = await createDirectUser({
      email: userEmail,
      password,
      name: 'Platform Boundary User',
      role: 'user'
    });
    userUserId = Number(directUser.id);

    await loginWithEmail(admin, adminEmail, password);
    await loginWithEmail(user, userEmail, password);

    const adminSpaces = await admin.request('/api/admin/spaces', { expectStatus: 404 });
    const adminSpaceCreate = await admin.request('/api/admin/spaces/create-with-onboarding', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 404,
      body: {
        name: `Platform Boundary Managed Space ${suffix}`,
        slug: `platform-boundary-${suffix}`,
        description: 'Platform edition boundary smoke managed workspace',
        owner_user_id: adminUserId
      }
    });
    const adminSpaceInvite = await admin.request('/api/admin/spaces/1/invites', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 404,
      body: { email: userEmail, role: 'member', expose_token: true }
    });

    const adminMe = await admin.request('/api/auth/me', { expectStatus: 200 });
    const userMe = await user.request('/api/auth/me', { expectStatus: 200 });
    const authConfig = await user.request('/api/auth/config', { expectStatus: 200 });
    const userScope = await user.request('/api/auth/scope', { expectStatus: 200 });
    const userLibraries = await user.request('/api/libraries', { expectStatus: 200 });
    const userSpaces = await user.request('/api/spaces', { expectStatus: 200 });
    const firstUserSpaceId = Number(userSpaces.data?.spaces?.[0]?.id || 0) || null;
    assert(firstUserSpaceId, `Expected platform /api/spaces to return an accessible space for selection: ${JSON.stringify(userSpaces.data)}`);
    const defaultSpaceId = Number(userSpaces.data?.active_space_id || firstUserSpaceId || 0) || null;
    const selectedSpace = await user.request('/api/spaces/select', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { space_id: firstUserSpaceId }
    });
    const supportRequests = await user.request('/api/support/requests', { expectStatus: 404 });
    const staffSummary = await admin.request('/api/support/staff/summary', { expectStatus: 404 });
    const adminUsers = await admin.request('/api/admin/users', { expectStatus: 404 });
    const adminUserSummary = await admin.request(`/api/admin/users/${adminUserId}/summary`, { expectStatus: 404 });
    const adminUserRole = await admin.request(`/api/admin/users/${adminUserId}/role`, {
      method: 'PATCH',
      withCsrf: true,
      expectStatus: 404,
      body: { role: 'admin' }
    });
    const adminUserPasswordReset = await admin.request(`/api/admin/users/${adminUserId}/password-reset`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 404,
      body: { expose_token: true }
    });
    const generalSettings = await admin.request('/api/settings/general', { expectStatus: 200 });
    const mediaFeatureFlags = await user.request('/api/media/feature-flags', { expectStatus: 200 });
    const emailDelivery = await admin.request('/api/admin/settings/email-delivery', { expectStatus: 404 });
    const integrations = await admin.request('/api/admin/settings/integrations', { expectStatus: 200 });
    const priceChartingTest = await admin.request('/api/admin/settings/integrations/test-pricecharting', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 404,
      body: { title: 'Batman' }
    });
    const ebayTest = await admin.request('/api/admin/settings/integrations/test-ebay', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 404,
      body: { title: 'Batman' }
    });
    const logsTest = await admin.request('/api/admin/settings/integrations/test-logs', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 404,
      body: { logExportBackend: 'off' }
    });
    const adminActivity = await admin.request('/api/admin/activity', { expectStatus: 404 });
    const loanReminderOperations = await admin.request('/api/admin/loan-reminder-operations', { expectStatus: 404 });
    const featureFlags = await admin.request('/api/admin/feature-flags', { expectStatus: 200 });
    const serviceAccountKeys = await admin.request('/api/auth/service-account-keys', { expectStatus: 200 });
    const supportSessionStart = await admin.request('/api/auth/support-session/start', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: {
        space_id: defaultSpaceId,
        reason: 'Platform edition boundary smoke'
      }
    });
    const supportSessionEnd = await admin.request('/api/auth/support-session', {
      method: 'DELETE',
      withCsrf: true,
      expectStatus: 200
    });

    assert(adminMe.data?.product_edition === 'platform', `Expected platform admin edition, got ${JSON.stringify(adminMe.data)}`);
    assert(userMe.data?.product_edition === 'platform', `Expected platform user edition, got ${JSON.stringify(userMe.data)}`);
    assert(authConfig.data?.product_edition === 'platform', `Expected platform auth config edition, got ${JSON.stringify(authConfig.data)}`);
    assert(adminMe.data?.edition_contract?.library_model === 'multi_workspace_platform', `Expected platform /api/auth/me library model, got ${JSON.stringify(adminMe.data)}`);
    assert(adminMe.data?.edition_contract?.workspace_surface === true, `Expected platform /api/auth/me workspace surface true, got ${JSON.stringify(adminMe.data)}`);
    assert(userMe.data?.edition_contract?.additional_user_model === 'workspace_memberships', `Expected platform /api/auth/me additional user model, got ${JSON.stringify(userMe.data)}`);
    assert(authConfig.data?.edition_contract?.help_surface === 'full', `Expected platform /api/auth/config help surface contract, got ${JSON.stringify(authConfig.data)}`);
    assert(Number(userMe.data?.active_space_id || 0) > 0, `Platform /api/auth/me must keep active_space_id: ${JSON.stringify(userMe.data)}`);
    assert(Number(userScope.data?.active_space_id || 0) > 0, `Platform /api/auth/scope must keep active_space_id: ${JSON.stringify(userScope.data)}`);
    assert(Array.isArray(userScope.data?.spaces) && userScope.data.spaces.length > 0, `Platform /api/auth/scope must keep spaces: ${JSON.stringify(userScope.data)}`);
    assert(Number(userScope.data?.active_library_id || 0) > 0, `Platform /api/auth/scope must keep active_library_id: ${JSON.stringify(userScope.data)}`);
    assert(Array.isArray(userScope.data?.libraries) && userScope.data.libraries.length > 0, `Platform /api/auth/scope must keep libraries: ${JSON.stringify(userScope.data)}`);
    const spaceIntegrations = await admin.request(`/api/spaces/${defaultSpaceId}/integrations`, { expectStatus: 200 });
    assert(Number(userLibraries.data?.active_space_id || 0) > 0, `Platform /api/libraries must keep active_space_id: ${JSON.stringify(userLibraries.data)}`);
    assert(Array.isArray(userSpaces.data?.spaces) && userSpaces.data.spaces.length > 0, `Platform /api/spaces must stay mounted: ${JSON.stringify(userSpaces.data)}`);
    assert(Number(selectedSpace.data?.active_space_id || 0) === firstUserSpaceId, `Platform /api/spaces/select must keep active_space_id in its response: ${JSON.stringify(selectedSpace.data)}`);
    assert(Array.isArray(selectedSpace.data?.libraries), `Platform /api/spaces/select must keep libraries in its response: ${JSON.stringify(selectedSpace.data)}`);
    assert(typeof spaceIntegrations.data === 'object' && spaceIntegrations.data !== null, `Platform /api/spaces/:id/integrations must stay mounted: ${JSON.stringify(spaceIntegrations.data)}`);
    assert(adminSpaces.status === 404, `Platform /api/admin/spaces must be owned by cairn, not Core: ${JSON.stringify(adminSpaces.data)}`);
    assert(adminSpaceCreate.status === 404, `Platform /api/admin/spaces/create-with-onboarding must be owned by cairn, not Core: ${JSON.stringify(adminSpaceCreate.data)}`);
    assert(adminSpaceInvite.status === 404, `Platform /api/admin/spaces/:id/invites must be owned by cairn, not Core: ${JSON.stringify(adminSpaceInvite.data)}`);
    assert(supportRequests.status === 404, `Platform /api/support/requests must be owned by cairn, not Core: ${JSON.stringify(supportRequests.data)}`);
    assert(staffSummary.status === 404, `Platform /api/support/staff/summary must be owned by cairn, not Core: ${JSON.stringify(staffSummary.data)}`);
    assert(adminUsers.status === 404, `Platform /api/admin/users must be owned by cairn, not Core: ${JSON.stringify(adminUsers.data)}`);
    assert(adminUserSummary.status === 404, `Platform /api/admin/users/:id/summary must be owned by cairn, not Core: ${JSON.stringify(adminUserSummary.data)}`);
    assert(adminUserRole.status === 404, `Platform /api/admin/users/:id/role must be owned by cairn, not Core: ${JSON.stringify(adminUserRole.data)}`);
    assert(adminUserPasswordReset.status === 404, `Platform /api/admin/users/:id/password-reset must be owned by cairn, not Core: ${JSON.stringify(adminUserPasswordReset.data)}`);
    assert(typeof generalSettings.data?.theme === 'string', `Platform /api/settings/general must stay mounted: ${JSON.stringify(generalSettings.data)}`);
    assert(typeof mediaFeatureFlags.data?.flags === 'object' && mediaFeatureFlags.data.flags !== null, `Platform /api/media/feature-flags must stay mounted: ${JSON.stringify(mediaFeatureFlags.data)}`);
    assert(typeof mediaFeatureFlags.data?.flags?.events_enabled === 'boolean', `Platform /api/media/feature-flags must return boolean events_enabled: ${JSON.stringify(mediaFeatureFlags.data)}`);
    assert(typeof mediaFeatureFlags.data?.flags?.collectibles_enabled === 'boolean', `Platform /api/media/feature-flags must return boolean collectibles_enabled: ${JSON.stringify(mediaFeatureFlags.data)}`);
    assert(emailDelivery.status === 404, `Platform /api/admin/settings/email-delivery must be owned by cairn, not Core: ${JSON.stringify(emailDelivery.data)}`);
    assert(adminActivity.status === 404, `Platform /api/admin/activity must be owned by cairn, not Core: ${JSON.stringify(adminActivity.data)}`);
    assert(loanReminderOperations.status === 404, `Platform /api/admin/loan-reminder-operations must be owned by cairn, not Core: ${JSON.stringify(loanReminderOperations.data)}`);
    assert(typeof integrations.data === 'object' && integrations.data !== null, `Platform /api/admin/settings/integrations must stay mounted: ${JSON.stringify(integrations.data)}`);
    assert(typeof integrations.data?.valuationProviders === 'object' && integrations.data.valuationProviders !== null, `Platform integrations payload must keep valuation providers: ${JSON.stringify(integrations.data)}`);
    assert(typeof integrations.data?.logExportControl === 'object' && integrations.data.logExportControl !== null, `Platform integrations payload must keep log export control: ${JSON.stringify(integrations.data)}`);
    assert(typeof integrations.data?.observabilityRuntime === 'object' && integrations.data.observabilityRuntime !== null, `Platform integrations payload must keep observability runtime diagnostics: ${JSON.stringify(integrations.data)}`);
    assert(priceChartingTest.status === 404, `Platform PriceCharting diagnostic must be owned by cairn, not Core: ${JSON.stringify(priceChartingTest.data)}`);
    assert(ebayTest.status === 404, `Platform eBay diagnostic must be owned by cairn, not Core: ${JSON.stringify(ebayTest.data)}`);
    assert(logsTest.status === 404, `Platform log export diagnostic must be owned by cairn, not Core: ${JSON.stringify(logsTest.data)}`);
    assert(Array.isArray(featureFlags.data?.flags), `Platform /api/admin/feature-flags must stay mounted: ${JSON.stringify(featureFlags.data)}`);
    assert(featureFlags.data.flags.some((flag) => String(flag.key || '') === 'self_registration_enabled'), `Platform feature flags must keep self_registration_enabled: ${JSON.stringify(featureFlags.data)}`);
    assert(featureFlags.data.flags.some((flag) => String(flag.key || '') === 'metrics_enabled'), `Platform feature flags must keep metrics_enabled: ${JSON.stringify(featureFlags.data)}`);
    assert(featureFlags.data.flags.some((flag) => String(flag.key || '') === 'external_log_export_enabled'), `Platform feature flags must keep external_log_export_enabled: ${JSON.stringify(featureFlags.data)}`);
    assert(Array.isArray(serviceAccountKeys.data?.keys), `Platform /api/auth/service-account-keys must stay mounted: ${JSON.stringify(serviceAccountKeys.data)}`);
    assert(supportSessionStart.data?.support_session?.active === true, `Platform /api/auth/support-session/start must stay mounted: ${JSON.stringify(supportSessionStart.data)}`);
    assert(Number(supportSessionStart.data?.support_session?.space_id || 0) === defaultSpaceId, `Platform support session start must target the selected space: ${JSON.stringify(supportSessionStart.data)}`);
    assert(supportSessionEnd.data?.support_session === null, `Platform /api/auth/support-session must end the active support session: ${JSON.stringify(supportSessionEnd.data)}`);

    console.log('Platform edition boundary smoke passed');
  } finally {
    if (userUserId) await cleanupDirectUser(userUserId);
    if (adminUserId) await cleanupDirectUser(adminUserId);
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error(error.stack || error.message || error);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
