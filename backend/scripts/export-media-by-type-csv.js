#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const BASE_URL = String(process.env.BASE_URL || 'http://localhost:3000/api').trim().replace(/\/+$/, '');
const EXPORT_ROOT = process.env.EXPORT_DIR
  ? path.resolve(process.env.EXPORT_DIR)
  : path.resolve(process.cwd(), 'artifacts', 'one-time-exports', `library-types-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const MEDIA_TYPES = ['movie', 'tv_series', 'tv_episode', 'book', 'audio', 'game', 'comic_book'];
const ADMIN_EMAIL = String(process.env.RBAC_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'ci-rbac-admin@example.com').trim();
const ADMIN_PASSWORD = String(process.env.RBAC_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'Passw0rd!123').trim();
const PAGE_LIMIT = Math.max(1, Number(process.env.EXPORT_PAGE_LIMIT || 200) || 200);

class HttpClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
    this.csrfToken = '';
  }

  storeCookies(response) {
    const setCookie = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];
    for (const raw of setCookie) {
      const cookiePair = String(raw || '').split(';')[0];
      const separator = cookiePair.indexOf('=');
      if (separator === -1) continue;
      this.cookies.set(cookiePair.slice(0, separator), cookiePair.slice(separator + 1));
    }
  }

  buildCookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  async request(endpoint, { method = 'GET', body, withCsrf = false, expectStatus } = {}) {
    const headers = {};
    const cookieHeader = this.buildCookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;
    if (withCsrf) {
      if (!this.csrfToken) await this.fetchCsrfToken();
      headers['X-CSRF-Token'] = this.csrfToken;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual'
    });
    this.storeCookies(response);

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = text;
    }

    if (expectStatus && response.status !== expectStatus) {
      throw new Error(`${method} ${endpoint} expected ${expectStatus}, got ${response.status}: ${serializeForError(data)}`);
    }

    return { status: response.status, data };
  }

  async fetchCsrfToken() {
    const response = await this.request('/auth/csrf-token', { expectStatus: 200 });
    const token = response?.data?.csrfToken;
    if (!token) {
      throw new Error('GET /auth/csrf-token did not return csrfToken');
    }
    this.csrfToken = token;
    return token;
  }
}

function serializeForError(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const serialized = typeof value === 'string'
    ? value
    : Array.isArray(value) || typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
  if (/[",\n]/.test(serialized)) {
    return `"${serialized.replace(/"/g, '""')}"`;
  }
  return serialized;
}

function buildCsv(rows) {
  const keys = Array.from(rows.reduce((set, row) => {
    Object.keys(row || {}).forEach((key) => set.add(key));
    return set;
  }, new Set()));

  const lines = [keys.join(',')];
  for (const row of rows) {
    lines.push(keys.map((key) => csvEscape(row[key])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function loginOrBootstrap(client) {
  const login = await client.request('/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
  });
  if (login.status === 200) return { mode: 'login', email: ADMIN_EMAIL };

  const register = await client.request('/auth/register', {
    method: 'POST',
    withCsrf: true,
    body: {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      name: 'CSV Export Admin'
    }
  });
  if (register.status === 200) return { mode: 'register', email: ADMIN_EMAIL };

  throw new Error(
    `Unable to authenticate export user. ` +
    `Login status=${login.status}, register status=${register.status}. ` +
    `Set RBAC_ADMIN_EMAIL / RBAC_ADMIN_PASSWORD or ADMIN_EMAIL / ADMIN_PASSWORD if needed.`
  );
}

async function fetchAllItemsForType(client, mediaType) {
  const items = [];
  let page = 1;
  let totalPages = 1;

  do {
    const response = await client.request(
      `/media?media_type=${encodeURIComponent(mediaType)}&page=${page}&limit=${PAGE_LIMIT}&sortBy=title&sortDir=asc`,
      { expectStatus: 200 }
    );
    const payload = response.data || {};
    const pageItems = Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload)
        ? payload
        : [];

    items.push(...pageItems);
    totalPages = Math.max(1, Number(payload?.pagination?.totalPages || 1) || 1);
    page += 1;
  } while (page <= totalPages);

  return items;
}

async function main() {
  fs.mkdirSync(EXPORT_ROOT, { recursive: true });

  const client = new HttpClient(BASE_URL);
  const auth = await loginOrBootstrap(client);
  const summary = [];

  for (const mediaType of MEDIA_TYPES) {
    const rows = await fetchAllItemsForType(client, mediaType);
    if (!rows.length) continue;

    const filename = `${mediaType}.csv`;
    const filePath = path.join(EXPORT_ROOT, filename);
    fs.writeFileSync(filePath, buildCsv(rows), 'utf8');
    summary.push({
      media_type: mediaType,
      row_count: rows.length,
      file: filePath
    });
  }

  const summaryPath = path.join(EXPORT_ROOT, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    base_url: BASE_URL,
    export_root: EXPORT_ROOT,
    auth_mode: auth.mode,
    auth_email: auth.email,
    files: summary
  }, null, 2) + '\n', 'utf8');

  console.log(JSON.stringify({
    export_root: EXPORT_ROOT,
    files: summary
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
