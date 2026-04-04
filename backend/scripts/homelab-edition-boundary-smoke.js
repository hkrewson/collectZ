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
    `INSERT INTO users (email, password, name, role)
     VALUES ($1, $2, $3, $4)
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
  await pool.query('DELETE FROM library_memberships WHERE user_id = $1', [numericUserId]).catch(() => {});
  await pool.query('DELETE FROM library_memberships WHERE library_id IN (SELECT id FROM libraries WHERE created_by = $1)', [numericUserId]).catch(() => {});
  await pool.query('DELETE FROM libraries WHERE created_by = $1', [numericUserId]).catch(() => {});
  await pool.query('DELETE FROM space_memberships WHERE user_id = $1', [numericUserId]).catch(() => {});
  await pool.query('DELETE FROM spaces WHERE created_by = $1', [numericUserId]).catch(() => {});
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

async function main() {
  const suffix = Date.now();
  const adminEmail = `homelab-admin-${suffix}@example.com`;
  const userEmail = `homelab-user-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  let adminUserId = null;
  let userUserId = null;

  const admin = new HttpClient('homelab-admin');
  const user = new HttpClient('homelab-user');

  try {
    const adminUser = await createDirectUser({
      email: adminEmail,
      password,
      name: 'Homelab Boundary Admin',
      role: 'admin'
    });
    adminUserId = Number(adminUser.id);

    const normalUser = await createDirectUser({
      email: userEmail,
      password,
      name: 'Homelab Boundary User',
      role: 'user'
    });
    userUserId = Number(normalUser.id);

    await loginWithEmail(admin, adminEmail, password);
    await loginWithEmail(user, userEmail, password);

    const adminMe = await admin.request('/api/auth/me', { expectStatus: 200 });
    const userMe = await user.request('/api/auth/me', { expectStatus: 200 });
    const userScope = await user.request('/api/auth/scope', { expectStatus: 200 });
    const userLibraries = await user.request('/api/libraries', { expectStatus: 200 });
    const profile = await user.request('/api/profile', { expectStatus: 200 });
    const releases = await user.request('/api/support/releases', { expectStatus: 200 });
    const generalSettings = await admin.request('/api/settings/general', { expectStatus: 200 });
    const integrations = await admin.request('/api/admin/settings/integrations', { expectStatus: 200 });
    const featureFlags = await admin.request('/api/admin/feature-flags', { expectStatus: 200 });

    const supportRequests = await user.request('/api/support/requests', { expectStatus: 404 });
    const docs = await admin.request('/api/docs', { expectStatus: 404 });
    const metrics = await admin.request('/api/metrics', { expectStatus: 404 });
    const spaces = await user.request('/api/spaces', { expectStatus: 404 });
    const adminSpaces = await admin.request('/api/admin/spaces', { expectStatus: 404 });

    assert(adminMe.data?.product_edition === 'homelab', `Expected homelab admin edition, got ${JSON.stringify(adminMe.data)}`);
    assert(userMe.data?.product_edition === 'homelab', `Expected homelab user edition, got ${JSON.stringify(userMe.data)}`);
    assert(userMe.data?.active_space_id === null, `Homelab /api/auth/me must hide active_space_id: ${JSON.stringify(userMe.data)}`);
    assert(profile.data?.active_space_id === null, `Homelab /api/profile must hide active_space_id: ${JSON.stringify(profile.data)}`);
    assert(userScope.data?.active_space_id === null, `Homelab /api/auth/scope must hide active_space_id: ${JSON.stringify(userScope.data)}`);
    assert(Array.isArray(userScope.data?.spaces) && userScope.data.spaces.length === 0, `Homelab /api/auth/scope must hide spaces: ${JSON.stringify(userScope.data)}`);
    assert(Number(userScope.data?.active_library_id || 0) > 0, `Homelab /api/auth/scope must keep active_library_id: ${JSON.stringify(userScope.data)}`);
    assert(Array.isArray(userScope.data?.libraries) && userScope.data.libraries.length > 0, `Homelab /api/auth/scope must keep libraries: ${JSON.stringify(userScope.data)}`);
    assert(userLibraries.data?.active_space_id === null, `Homelab /api/libraries must hide active_space_id: ${JSON.stringify(userLibraries.data)}`);
    assert(Array.isArray(userLibraries.data?.spaces) && userLibraries.data.spaces.length === 0, `Homelab /api/libraries must hide spaces: ${JSON.stringify(userLibraries.data)}`);
    assert(Number(userLibraries.data?.active_library_id || 0) > 0, `Homelab /api/libraries must keep active_library_id: ${JSON.stringify(userLibraries.data)}`);
    assert(Array.isArray(userLibraries.data?.libraries) && userLibraries.data.libraries.length > 0, `Homelab /api/libraries must keep libraries: ${JSON.stringify(userLibraries.data)}`);
    assert(Array.isArray(releases.data?.releases), `Homelab /api/support/releases must stay mounted: ${JSON.stringify(releases.data)}`);
    assert(typeof generalSettings.data?.theme === 'string', `Homelab /api/settings/general must stay mounted: ${JSON.stringify(generalSettings.data)}`);
    assert(typeof integrations.data === 'object' && integrations.data !== null, `Homelab /api/admin/settings/integrations must stay mounted: ${JSON.stringify(integrations.data)}`);
    assert(Array.isArray(featureFlags.data?.flags), `Homelab /api/admin/feature-flags must stay mounted: ${JSON.stringify(featureFlags.data)}`);
    assert(supportRequests.status === 404, `Homelab /api/support/requests must be unmounted: ${JSON.stringify(supportRequests.data)}`);
    assert(docs.status === 404, `Homelab /api/docs must be unmounted: ${JSON.stringify(docs.data)}`);
    assert(metrics.status === 404, `Homelab /api/metrics must be unmounted: ${JSON.stringify(metrics.data)}`);
    assert(spaces.status === 404, `Homelab /api/spaces must be unmounted: ${JSON.stringify(spaces.data)}`);
    assert(adminSpaces.status === 404, `Homelab /api/admin/spaces must be unmounted: ${JSON.stringify(adminSpaces.data)}`);

    console.log('Homelab edition boundary smoke passed');
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
