#!/usr/bin/env node

'use strict';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

class HttpClient {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
    this.csrfToken = '';
  }

  applySetCookies(headers) {
    const raw = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [];
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
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  async request(path, options = {}) {
    const {
      method = 'GET',
      body,
      expectStatus,
      withCsrf = false
    } = options;

    const headers = { Accept: 'application/json' };
    const cookieHeader = this.cookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (withCsrf) {
      if (!this.csrfToken) {
        await this.fetchCsrfToken();
      }
      headers['x-csrf-token'] = this.csrfToken;
    }

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    this.applySetCookies(response.headers);

    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (expectStatus !== undefined && response.status !== expectStatus) {
      throw new Error(
        `[${this.name}] ${method} ${path} expected ${expectStatus}, got ${response.status}. Body: ${JSON.stringify(parsed)}`
      );
    }

    return { status: response.status, data: parsed, headers: response.headers };
  }

  async fetchCsrfToken() {
    const response = await this.request('/api/auth/csrf-token', { expectStatus: 200 });
    const token = response?.data?.csrfToken;
    if (!token) {
      throw new Error(`[${this.name}] Missing CSRF token`);
    }
    this.csrfToken = token;
    return token;
  }
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function main() {
  const suffix = Date.now();
  const adminEmail = `rbac-admin-${suffix}@example.com`;
  const userEmail = `rbac-user-${suffix}@example.com`;
  const adminPassword = 'Passw0rd!123';
  const userPassword = 'Passw0rd!123';

  const admin = new HttpClient('admin');
  const user = new HttpClient('user');

  await admin.fetchCsrfToken();
  const registerAdmin = await admin.request('/api/auth/register', {
    method: 'POST',
    withCsrf: true,
    body: { email: adminEmail, password: adminPassword, name: 'RBAC Admin' }
  });
  if (registerAdmin.status !== 200) {
    const fallbackEmail = process.env.RBAC_ADMIN_EMAIL || '';
    const fallbackPassword = process.env.RBAC_ADMIN_PASSWORD || '';
    const inviteRequired = registerAdmin?.data?.error === 'An invite token is required to register';
    if (!inviteRequired || !fallbackEmail || !fallbackPassword) {
      throw new Error(
        `[admin] Unable to bootstrap admin via register (${registerAdmin.status}). ` +
        'For non-empty databases set RBAC_ADMIN_EMAIL and RBAC_ADMIN_PASSWORD.'
      );
    }
    await admin.fetchCsrfToken();
    await admin.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { email: fallbackEmail, password: fallbackPassword }
    });
  }

  await admin.fetchCsrfToken();
  const inviteResponse = await admin.request('/api/admin/invites', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 201,
    body: { email: userEmail }
  });
  const inviteToken = inviteResponse?.data?.token;
  assert(Boolean(inviteToken), 'Invite token not returned');

  await user.fetchCsrfToken();
  await user.request('/api/auth/register', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 200,
    body: { email: userEmail, password: userPassword, name: 'RBAC User', inviteToken }
  });

  await admin.fetchCsrfToken();
  const adminMedia = await admin.request('/api/media', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 201,
    body: { title: 'RBAC Admin Media', year: 2001, format: 'Digital' }
  });
  const adminMediaId = adminMedia?.data?.id;
  assert(Number.isFinite(Number(adminMediaId)), 'Admin media id missing');

  await user.fetchCsrfToken();
  await user.request(`/api/media/${adminMediaId}`, {
    method: 'PATCH',
    withCsrf: true,
    expectStatus: 403,
    body: { notes: 'should be denied' }
  });

  await user.request(`/api/media/${adminMediaId}`, {
    method: 'DELETE',
    withCsrf: true,
    expectStatus: 403
  });

  const userMedia = await user.request('/api/media', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 201,
    body: { title: 'RBAC User Media', year: 2002, format: 'Blu-ray' }
  });
  const userMediaId = userMedia?.data?.id;
  assert(Number.isFinite(Number(userMediaId)), 'User media id missing');

  await user.request(`/api/media/${userMediaId}`, {
    method: 'PATCH',
    withCsrf: true,
    expectStatus: 200,
    body: { notes: 'owner update allowed' }
  });

  await admin.fetchCsrfToken();
  await admin.request(`/api/media/${userMediaId}`, {
    method: 'PATCH',
    withCsrf: true,
    expectStatus: 200,
    body: { notes: 'admin override update allowed' }
  });

  await user.request('/api/admin/activity', { expectStatus: 403 });

  const deniedScope = await user.request('/api/media?space_id=999', { expectStatus: 403 });
  assert(
    deniedScope?.data?.reason === 'hints_not_allowed_for_role',
    `Unexpected scope denial reason: ${JSON.stringify(deniedScope?.data)}`
  );

  await admin.request('/api/admin/activity?space_id=999', { expectStatus: 200 });

  await user.request(`/api/media/${userMediaId}`, {
    method: 'DELETE',
    withCsrf: true,
    expectStatus: 200
  });

  await admin.request(`/api/media/${adminMediaId}`, {
    method: 'DELETE',
    withCsrf: true,
    expectStatus: 200
  });

  console.log('RBAC regression checks passed');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
