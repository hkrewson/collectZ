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
      // Always refresh CSRF prior to mutating calls to avoid stale-token
      // failures after auth/session cookie rotation.
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

async function main() {
  const suffix = Date.now();
  const bootstrapAdminEmail = process.env.RBAC_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'ci-rbac-admin@example.com';
  const bootstrapAdminPassword = process.env.RBAC_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'Passw0rd!123';
  let activeAdminEmail = bootstrapAdminEmail;
  let activeAdminPassword = bootstrapAdminPassword;
  const admin = new HttpClient('admin');

  await admin.fetchCsrfToken();
  const registerAdmin = await admin.request('/api/auth/register', {
    method: 'POST',
    withCsrf: true,
    body: { email: bootstrapAdminEmail, password: bootstrapAdminPassword, name: 'CrossType Admin' }
  });
  if (registerAdmin.status !== 200) {
    const fallbackEmail = process.env.RBAC_ADMIN_EMAIL || process.env.ADMIN_EMAIL || bootstrapAdminEmail;
    const fallbackPassword = process.env.RBAC_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || bootstrapAdminPassword;
    await admin.fetchCsrfToken();
    const loginFallback = await admin.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      body: { email: fallbackEmail, password: fallbackPassword }
    });
    if (loginFallback.status !== 200) {
      throw new Error(
        `[admin] Unable to bootstrap admin via register (${registerAdmin.status}) ` +
        `or login (${loginFallback.status}). Set RBAC_ADMIN_EMAIL and RBAC_ADMIN_PASSWORD if needed.`
      );
    }
    activeAdminEmail = fallbackEmail;
    activeAdminPassword = fallbackPassword;
  }

  await admin.fetchCsrfToken();
  await admin.request('/api/auth/login', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 200,
    body: { email: activeAdminEmail, password: activeAdminPassword }
  });
  // Login issues fresh cookies; fetch a fresh CSRF token bound to the new session.
  await admin.fetchCsrfToken();

  const sharedTitle = `CrossType-${suffix}`;
  const year = 2001;

  const movieCreate = await admin.request('/api/media', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 201,
    body: { title: sharedTitle, year, media_type: 'movie', format: 'Digital' }
  });
  const bookCreate = await admin.request('/api/media', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 201,
    body: {
      title: sharedTitle,
      year,
      media_type: 'book',
      format: 'Digital',
      type_details: { author: 'Cross Type Author' }
    }
  });

  // Invalid type_details on create must be rejected.
  await admin.request('/api/media', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 400,
    body: {
      title: `InvalidTypeDetailsCreate-${suffix}`,
      year,
      media_type: 'book',
      format: 'Digital',
      type_details: { platform: 'PlayStation 5' }
    }
  });

  const movieId = Number(movieCreate?.data?.id);
  const bookId = Number(bookCreate?.data?.id);
  assert(Number.isFinite(movieId), 'Movie media id missing');
  assert(Number.isFinite(bookId), 'Book media id missing');
  assert(movieId !== bookId, 'Movie and book should be separate records');

  const movieList = await admin.request(`/api/media?media_type=movie&search=${encodeURIComponent(sharedTitle)}`, { expectStatus: 200 });
  const movieItems = Array.isArray(movieList?.data?.items) ? movieList.data.items : [];
  assert(movieItems.some((item) => Number(item.id) === movieId), 'Movie filter should include movie entry');
  assert(!movieItems.some((item) => Number(item.id) === bookId), 'Movie filter should not include book entry');

  const bookList = await admin.request(`/api/media?media_type=book&search=${encodeURIComponent(sharedTitle)}`, { expectStatus: 200 });
  const bookItems = Array.isArray(bookList?.data?.items) ? bookList.data.items : [];
  assert(bookItems.some((item) => Number(item.id) === bookId), 'Book filter should include book entry');
  assert(!bookItems.some((item) => Number(item.id) === movieId), 'Book filter should not include movie entry');

  // Invalid type_details on patch (without media_type in payload) must be rejected.
  await admin.request(`/api/media/${bookId}`, {
    method: 'PATCH',
    withCsrf: true,
    expectStatus: 400,
    body: {
      type_details: { platform: 'Switch' }
    }
  });

  // Valid type_details patch should succeed and persist.
  const validPatch = await admin.request(`/api/media/${bookId}`, {
    method: 'PATCH',
    withCsrf: true,
    expectStatus: 200,
    body: {
      type_details: { author: 'Updated Author', isbn: '9780316450867' }
    }
  });
  assert(String(validPatch?.data?.type_details?.author || '') === 'Updated Author', 'Book author type_details should update');
  assert(String(validPatch?.data?.type_details?.isbn || '') === '9780316450867', 'Book isbn type_details should update');

  await admin.request(`/api/media/${movieId}`, { method: 'DELETE', withCsrf: true, expectStatus: 200 });
  await admin.request(`/api/media/${bookId}`, { method: 'DELETE', withCsrf: true, expectStatus: 200 });

  console.log('Cross-type isolation checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
