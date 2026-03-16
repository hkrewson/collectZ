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

async function bootstrapAdmin(client, { fallbackEmail, fallbackPassword }) {
  const bootstrapAdminEmail = process.env.RBAC_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'ci-rbac-admin@example.com';
  const bootstrapAdminPassword = process.env.RBAC_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'Passw0rd!123';

  await client.fetchCsrfToken();
  const registerAdmin = await client.request('/api/auth/register', {
    method: 'POST',
    withCsrf: true,
    body: { email: bootstrapAdminEmail, password: bootstrapAdminPassword, name: 'Phase5 Admin' }
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
    name: 'Phase5 Smoke Admin',
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

async function main() {
  const suffix = Date.now();
  const admin = new HttpClient('admin');
  const ownerEmail = `phase5-owner-${suffix}@example.com`;
  const ownerPassword = 'Passw0rd!123';
  const spaceSlug = `phase5-space-${suffix}`;
  const tempAdminEmail = `phase5-admin-${suffix}@example.com`;
  const tempAdminPassword = 'Passw0rd!123';
  let tempAdminUserId = null;
  let ownerUserId = null;
  let spaceId = null;

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
      name: 'Phase5 Owner'
    });
    ownerUserId = Number(ownerUser?.id || 0);
    assert(Number.isFinite(ownerUserId) && ownerUserId > 0, 'Owner user id missing');

    const createSpace = await admin.request('/api/admin/spaces', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: {
        name: `Phase 5 Space ${suffix}`,
        slug: spaceSlug,
        description: 'Server-admin control plane smoke',
        owner_user_id: ownerUserId
      }
    });
    spaceId = Number(createSpace?.data?.id || 0);
    assert(Number.isFinite(spaceId) && spaceId > 0, 'Space id missing after create');

    const listAfterCreate = await admin.request('/api/admin/spaces', { expectStatus: 200 });
    const createdSpace = (listAfterCreate?.data?.spaces || []).find((space) => Number(space.id) === spaceId);
    assert(createdSpace, 'Created space not found in admin space list');
    assert((createdSpace.owners || []).some((entry) => Number(entry.user_id) === ownerUserId), 'Assigned owner missing from admin space list');

    await admin.fetchCsrfToken();
    await admin.request(`/api/admin/spaces/${spaceId}/owner`, {
      method: 'PATCH',
      withCsrf: true,
      expectStatus: 200,
      body: { owner_user_id: ownerUserId }
    });

    await admin.fetchCsrfToken();
    const archived = await admin.request(`/api/admin/spaces/${spaceId}/archive`, {
      method: 'PATCH',
      withCsrf: true,
      expectStatus: 200,
      body: { archived: true }
    });
    assert(Boolean(archived?.data?.archived_at), 'Archive response missing archived_at');

    await admin.fetchCsrfToken();
    const deleted = await admin.request(`/api/admin/spaces/${spaceId}`, {
      method: 'DELETE',
      withCsrf: true,
      expectStatus: 200
    });
    assert(deleted?.data?.deleted === true, 'Delete response missing deleted=true');

    const listAfterDelete = await admin.request('/api/admin/spaces', { expectStatus: 200 });
    assert(!(listAfterDelete?.data?.spaces || []).some((space) => Number(space.id) === spaceId), 'Deleted space still present in admin space list');

    console.log('Admin space control smoke passed');
  } finally {
    if (spaceId) {
      await pool.query('DELETE FROM spaces WHERE id = $1', [spaceId]).catch(() => {});
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
