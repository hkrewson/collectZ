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
    body: { email: bootstrapAdminEmail, password: bootstrapAdminPassword, name: 'Support Session Admin' }
  });
  if (registerAdmin.status === 200) {
    return { userId: null };
  }

  await client.fetchCsrfToken();
  const loginAttempt = await client.request('/api/auth/login', {
    method: 'POST',
    withCsrf: true,
    body: { email: bootstrapAdminEmail, password: bootstrapAdminPassword }
  });
  if (loginAttempt.status === 200) {
    return { userId: null };
  }

  const directAdmin = await createDirectUser({
    email: fallbackEmail,
    password: fallbackPassword,
    name: 'Support Session Temp Admin',
    role: 'admin'
  });

  await client.fetchCsrfToken();
  await client.request('/api/auth/login', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 200,
    body: { email: fallbackEmail, password: fallbackPassword }
  });
  return { userId: Number(directAdmin.id) };
}

async function main() {
  const suffix = Date.now();
  const admin = new HttpClient('admin');
  const tempAdminEmail = `support-session-admin-${suffix}@example.com`;
  const tempAdminPassword = 'Passw0rd!123';
  const ownerEmail = `support-session-owner-${suffix}@example.com`;
  const ownerPassword = 'Passw0rd!123';
  const ownerName = 'Support Session Owner';
  const reason = 'Tenant troubleshooting verification';

  let tempAdminUserId = null;
  let ownerUserId = null;
  let createdSpaceId = null;

  try {
    const bootstrappedAdmin = await bootstrapAdmin(admin, {
      fallbackEmail: tempAdminEmail,
      fallbackPassword: tempAdminPassword
    });
    tempAdminUserId = Number(bootstrappedAdmin?.userId || 0) || null;

    const owner = await createDirectUser({
      email: ownerEmail,
      password: ownerPassword,
      name: ownerName,
      role: 'user'
    });
    ownerUserId = Number(owner.id);

    await admin.fetchCsrfToken();
    const createdSpace = await admin.request('/api/admin/spaces', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: {
        name: `Support Session Space ${suffix}`,
        slug: `support-session-space-${suffix}`,
        owner_user_id: ownerUserId
      }
    });
    createdSpaceId = Number(createdSpace?.data?.id || 0) || null;
    assert(Number.isFinite(createdSpaceId), 'Created support-session test space id missing');

    const beforeSupport = await admin.request(`/api/spaces/${createdSpaceId}/members`, { expectStatus: 404 });
    assert(
      String(beforeSupport?.data?.error || '').toLowerCase().includes('space not found'),
      `Expected non-support access to be denied before support session, got ${JSON.stringify(beforeSupport?.data)}`
    );

    await admin.fetchCsrfToken();
    const started = await admin.request('/api/auth/support-session/start', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { space_id: createdSpaceId, reason }
    });
    assert(started?.data?.support_session?.active === true, 'Support session should be active after start');
    assert(Number(started?.data?.support_session?.space_id || 0) === createdSpaceId, 'Support session should target the created space');
    assert(started?.data?.support_session?.reason === reason, 'Support session should retain the provided reason');

    const duringSupport = await admin.request(`/api/spaces/${createdSpaceId}/members`, { expectStatus: 200 });
    assert(Array.isArray(duringSupport?.data?.members), 'Expected support session to unlock space member access');

    await admin.fetchCsrfToken();
    const ended = await admin.request('/api/auth/support-session', {
      method: 'DELETE',
      withCsrf: true,
      expectStatus: 200
    });
    assert(ended?.data?.support_session === null, 'Support session should be cleared after end');

    const afterSupport = await admin.request(`/api/spaces/${createdSpaceId}/members`, { expectStatus: 404 });
    assert(
      String(afterSupport?.data?.error || '').toLowerCase().includes('space not found'),
      `Expected support access to be removed after session end, got ${JSON.stringify(afterSupport?.data)}`
    );

    console.log('Support session smoke passed');
  } finally {
    if (createdSpaceId) {
      await pool.query('DELETE FROM spaces WHERE id = $1', [createdSpaceId]).catch(() => {});
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
