#!/usr/bin/env node
'use strict';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.RBAC_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.RBAC_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';

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
    const cookieHeader = this.cookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (withCsrf) {
      if (!this.csrfToken) await this.fetchCsrfToken();
      headers['x-csrf-token'] = this.csrfToken;
    }

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
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('Set RBAC_ADMIN_EMAIL and RBAC_ADMIN_PASSWORD (or ADMIN_EMAIL/ADMIN_PASSWORD) to run cross-type checks.');
  }

  const admin = new HttpClient('admin');
  await admin.fetchCsrfToken();
  await admin.request('/api/auth/login', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 200,
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
  });

  const suffix = Date.now();
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
    body: { title: sharedTitle, year, media_type: 'book', format: 'Digital' }
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

  await admin.request(`/api/media/${movieId}`, { method: 'DELETE', withCsrf: true, expectStatus: 200 });
  await admin.request(`/api/media/${bookId}`, { method: 'DELETE', withCsrf: true, expectStatus: 200 });

  console.log('Cross-type isolation checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
