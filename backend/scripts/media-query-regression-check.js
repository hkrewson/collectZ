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

function firstNByTitle(items, count = 3) {
  return (Array.isArray(items) ? items : []).slice(0, count).map((item) => String(item?.title || ''));
}

async function main() {
  const suffix = Date.now();
  const probeToken = `query-reg-${suffix}`;
  const bootstrapAdminEmail = process.env.RBAC_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'ci-rbac-admin@example.com';
  const bootstrapAdminPassword = process.env.RBAC_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'Passw0rd!123';
  let activeAdminEmail = bootstrapAdminEmail;
  let activeAdminPassword = bootstrapAdminPassword;

  const admin = new HttpClient('admin');
  const createdIds = [];

  await admin.fetchCsrfToken();
  const registerAdmin = await admin.request('/api/auth/register', {
    method: 'POST',
    withCsrf: true,
    body: { email: bootstrapAdminEmail, password: bootstrapAdminPassword, name: 'Media Query Admin' }
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
        `[admin] Unable to bootstrap admin via register (${registerAdmin.status}) or login (${loginFallback.status}). ` +
        'Set RBAC_ADMIN_EMAIL and RBAC_ADMIN_PASSWORD if needed.'
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

  const seedRows = [
    { title: 'The Zephyr', media_type: 'movie', notes: probeToken, format: 'Digital', year: 2001 },
    { title: 'Alpha', media_type: 'movie', notes: probeToken, format: 'Digital', year: 2001 },
    { title: 'An Bravo', media_type: 'movie', notes: probeToken, format: 'Digital', year: 2001 },
    { title: 'The Zephyr', media_type: 'game', notes: probeToken, format: 'Digital', year: 2001 }
  ];

  for (const row of seedRows) {
    const created = await admin.request('/api/media', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: row
    });
    createdIds.push(Number(created?.data?.id));
  }

  const movieFilter = await admin.request(`/api/media?media_type=movie&search=${encodeURIComponent('Zephyr')}`, {
    expectStatus: 200
  });
  const movieItems = Array.isArray(movieFilter?.data?.items) ? movieFilter.data.items : [];
  assert(movieItems.some((item) => item.media_type === 'movie' && String(item.title) === 'The Zephyr'), 'Movie filter should include movie Zephyr');
  assert(!movieItems.some((item) => item.media_type === 'game' && String(item.title) === 'The Zephyr'), 'Movie filter should exclude game Zephyr');

  const gameFilter = await admin.request(`/api/media?media_type=game&search=${encodeURIComponent('Zephyr')}`, {
    expectStatus: 200
  });
  const gameItems = Array.isArray(gameFilter?.data?.items) ? gameFilter.data.items : [];
  assert(gameItems.some((item) => item.media_type === 'game' && String(item.title) === 'The Zephyr'), 'Game filter should include game Zephyr');
  assert(!gameItems.some((item) => item.media_type === 'movie' && String(item.title) === 'The Zephyr'), 'Game filter should exclude movie Zephyr');

  const sortedAsc = await admin.request(
    `/api/media?media_type=movie&search=${encodeURIComponent(probeToken)}&sortBy=title&sortDir=asc&limit=50`,
    { expectStatus: 200 }
  );
  const ascTitles = firstNByTitle(sortedAsc?.data?.items);
  assert(
    JSON.stringify(ascTitles) === JSON.stringify(['Alpha', 'An Bravo', 'The Zephyr']),
    `Ascending title sort mismatch (article-insensitive expected). Got ${JSON.stringify(ascTitles)}`
  );

  const sortedDesc = await admin.request(
    `/api/media?media_type=movie&search=${encodeURIComponent(probeToken)}&sortBy=title&sortDir=desc&limit=50`,
    { expectStatus: 200 }
  );
  const descTitles = firstNByTitle(sortedDesc?.data?.items);
  assert(
    JSON.stringify(descTitles) === JSON.stringify(['The Zephyr', 'An Bravo', 'Alpha']),
    `Descending title sort mismatch (article-insensitive expected). Got ${JSON.stringify(descTitles)}`
  );

  for (const id of createdIds.filter((value) => Number.isFinite(value))) {
    await admin.request(`/api/media/${id}`, {
      method: 'DELETE',
      withCsrf: true,
      expectStatus: 200
    });
  }

  console.log('Media query regression checks passed');
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
