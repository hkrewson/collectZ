#!/usr/bin/env node

'use strict';

const bcrypt = require('bcrypt');
const pool = require('../db/pool');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

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
    if (body !== undefined) headers['Content-Type'] = 'application/json';
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
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (expectStatus !== undefined && response.status !== expectStatus) {
      throw new Error(`[${this.name}] ${method} ${path} expected ${expectStatus}, got ${response.status}. Body: ${JSON.stringify(data)}`);
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

async function bootstrapAdmin(client, { fallbackEmail, fallbackPassword }) {
  const bootstrapAdminEmail = process.env.RBAC_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'ci-rbac-admin@example.com';
  const bootstrapAdminPassword = process.env.RBAC_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'Passw0rd!123';

  await client.fetchCsrfToken();
  const registerAdmin = await client.request('/api/auth/register', {
    method: 'POST',
    withCsrf: true,
    body: { email: bootstrapAdminEmail, password: bootstrapAdminPassword, name: 'Phase5 Boundary Admin' }
  });
  if (registerAdmin.status === 200) {
    return { email: bootstrapAdminEmail, password: bootstrapAdminPassword, userId: null };
  }

  await client.fetchCsrfToken();
  const loginAttempt = await client.request('/api/auth/login', {
    method: 'POST',
    withCsrf: true,
    body: { email: bootstrapAdminEmail, password: bootstrapAdminPassword }
  });
  if (loginAttempt.status === 200) {
    return { email: bootstrapAdminEmail, password: bootstrapAdminPassword, userId: null };
  }

  const directAdmin = await createDirectUser({
    email: fallbackEmail,
    password: fallbackPassword,
    name: 'Phase5 Boundary Admin',
    role: 'admin'
  });

  await client.fetchCsrfToken();
  await client.request('/api/auth/login', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 200,
    body: { email: fallbackEmail, password: fallbackPassword }
  });
  return { email: fallbackEmail, password: fallbackPassword, userId: Number(directAdmin.id) };
}

async function createDirectUser({ email, password, name, role = 'user' }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, name, role`,
    [email, passwordHash, name, role]
  );
  return result.rows[0];
}

async function deleteDirectUser(userId) {
  if (!Number.isFinite(Number(userId)) || Number(userId) <= 0) return;
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

async function cleanupSpace(spaceId) {
  if (!Number.isFinite(Number(spaceId)) || Number(spaceId) <= 0) return;

  await pool.query(
    `UPDATE users
     SET active_space_id = CASE WHEN active_space_id = $2 THEN NULL ELSE active_space_id END,
         active_library_id = CASE WHEN active_library_id IN (
           SELECT id FROM libraries WHERE space_id = $2
         ) THEN NULL ELSE active_library_id END
     WHERE active_space_id = $1
        OR active_library_id IN (SELECT id FROM libraries WHERE space_id = $2)`,
    [spaceId, spaceId]
  ).catch(() => {});

  await pool.query('DELETE FROM library_memberships WHERE library_id IN (SELECT id FROM libraries WHERE space_id = $1)', [spaceId]).catch(() => {});
  await pool.query('DELETE FROM invites WHERE space_id = $1', [spaceId]).catch(() => {});
  await pool.query('DELETE FROM space_memberships WHERE space_id = $1', [spaceId]).catch(() => {});
  await pool.query('DELETE FROM libraries WHERE space_id = $1', [spaceId]).catch(() => {});
  await pool.query('DELETE FROM spaces WHERE id = $1', [spaceId]).catch(() => {});
}

async function main() {
  const suffix = Date.now();
  const admin = new HttpClient('admin');
  const owner = new HttpClient('owner');
  const ownerEmail = `phase5-boundary-owner-${suffix}@example.com`;
  const ownerPassword = 'Passw0rd!123';
  const inviteeEmail = `phase5-boundary-invite-${suffix}@example.com`;
  const spaceSlug = `phase5-boundary-${suffix}`;
  const tempAdminEmail = `phase5-boundary-admin-${suffix}@example.com`;
  const tempAdminPassword = 'Passw0rd!123';
  let tempAdminUserId = null;
  let ownerUserId = null;
  let spaceId = null;
  let inviteId = null;

  try {
    const bootstrappedAdmin = await bootstrapAdmin(admin, {
      fallbackEmail: tempAdminEmail,
      fallbackPassword: tempAdminPassword
    });
    tempAdminUserId = Number(bootstrappedAdmin?.userId || 0) || null;
    await admin.fetchCsrfToken();

    const ownerUser = await createDirectUser({
      email: ownerEmail,
      password: ownerPassword,
      name: 'Phase5 Boundary Owner'
    });
    ownerUserId = Number(ownerUser?.id || 0);
    assert(Number.isFinite(ownerUserId) && ownerUserId > 0, 'Boundary owner user id missing');

    const createdSpace = await admin.request('/api/admin/spaces', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: {
        name: `Phase 5 Boundary Space ${suffix}`,
        slug: spaceSlug,
        description: 'Platform-vs-tenant boundary regression',
        owner_user_id: ownerUserId
      }
    });
    spaceId = Number(createdSpace?.data?.id || 0);
    assert(Number.isFinite(spaceId) && spaceId > 0, 'Boundary space id missing');

    const listSpaces = await admin.request('/api/admin/spaces', { expectStatus: 200 });
    assert((listSpaces?.data?.spaces || []).some((space) => Number(space.id) === spaceId), 'Admin spaces list should include created space');

    await admin.request(`/api/spaces/${spaceId}/members`, { expectStatus: 404 });
    await admin.request(`/api/spaces/${spaceId}/invites`, { expectStatus: 404 });

    await owner.fetchCsrfToken();
    await owner.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { email: ownerEmail, password: ownerPassword }
    });

    const ownerMembers = await owner.request(`/api/spaces/${spaceId}/members`, { expectStatus: 200 });
    assert(Number(ownerMembers?.data?.space?.id || 0) === spaceId, 'Owner member list should resolve the created space');

    const inviteResponse = await owner.request(`/api/spaces/${spaceId}/invites`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: { email: inviteeEmail, role: 'member', expose_token: true }
    });
    inviteId = Number(inviteResponse?.data?.id || 0);
    assert(Number.isFinite(inviteId) && inviteId > 0, 'Owner invite id missing');

    await admin.request(`/api/spaces/${spaceId}/invites`, { expectStatus: 404 });

    const activity = await admin.request('/api/admin/activity?limit=25&search=admin.space.create', { expectStatus: 200 });
    assert(Array.isArray(activity?.data), 'Admin activity response must be an array');

    await owner.request(`/api/spaces/${spaceId}/invites/${inviteId}/revoke`, {
      method: 'PATCH',
      withCsrf: true,
      expectStatus: 200
    });

    console.log('Tenancy platform boundary smoke passed');
  } finally {
    if (spaceId) {
      await cleanupSpace(spaceId).catch(() => {});
    }
    if (ownerUserId) {
      await deleteDirectUser(ownerUserId).catch(() => {});
    }
    if (tempAdminUserId) {
      await deleteDirectUser(tempAdminUserId).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
