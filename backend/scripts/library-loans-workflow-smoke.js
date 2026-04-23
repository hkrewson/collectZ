'use strict';

const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { ensureUserDefaultScope } = require('../services/libraries');

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
      if (!this.csrfToken) await this.fetchCsrfToken();
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
      throw new Error(`[${this.name}] ${method} ${path} expected ${expectStatus}, got ${response.status}. Body: ${JSON.stringify(data)}`);
    }
    return { status: response.status, data };
  }

  async fetchCsrfToken() {
    const response = await this.request('/api/auth/csrf-token', { expectStatus: 200 });
    const token = response?.data?.csrfToken;
    if (!token) throw new Error(`[${this.name}] Missing CSRF token`);
    this.csrfToken = token;
    return token;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function createDirectUser({ email, password, name, role = 'admin' }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, $3, $4, true, NOW())
     RETURNING id`,
    [email, passwordHash, name, role]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

async function createLoanableMedia({ title, libraryId, spaceId, userId }) {
  const result = await pool.query(
    `INSERT INTO media (
       title, media_type, format, library_id, space_id, added_by, import_source
     ) VALUES (
       $1, 'book', 'Hardcover', $2, $3, $4, 'manual'
     )
     RETURNING id`,
    [title, libraryId, spaceId, userId]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

async function cleanupTemporaryState({ userId, libraryId, spaceId }) {
  if (libraryId) {
    await pool.query('DELETE FROM media_loans WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_metadata WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM collection_items WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_variants WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_genres WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_directors WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_actors WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM library_memberships WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM libraries WHERE id = $1', [libraryId]).catch(() => {});
  }
  if (spaceId) {
    await pool.query('DELETE FROM app_integrations WHERE space_id = $1', [spaceId]).catch(() => {});
    await pool.query('DELETE FROM space_memberships WHERE space_id = $1', [spaceId]).catch(() => {});
    await pool.query('DELETE FROM spaces WHERE id = $1', [spaceId]).catch(() => {});
  }
  if (userId) {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
  }
}

async function main() {
  const suffix = Date.now();
  const email = `library-loans-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('library-loans-workflow-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;
  let mediaId = null;

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Library Loans Workflow Smoke Admin',
      role: 'admin'
    });

    const scope = await ensureUserDefaultScope(userId);
    libraryId = Number(scope?.libraryId || 0) || null;
    spaceId = Number(scope?.spaceId || 0) || null;
    assert(libraryId && spaceId, 'Expected default scope for loans workflow smoke admin');

    await client.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { email, password }
    });
    await client.fetchCsrfToken();

    mediaId = await createLoanableMedia({
      title: 'Library Loans Smoke Test',
      libraryId,
      spaceId,
      userId
    });
    assert(mediaId, 'Expected loanable media row to be created');

    const created = await client.request(`/api/media/${mediaId}/loans`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: {
        borrower_name: 'Casey Reader',
        borrower_email: 'casey.reader@example.com',
        loaned_at: '2026-04-22',
        due_at: '2026-05-06',
        loan_format: 'Hardcover',
        notes: 'Front desk checkout'
      }
    });
    const loanId = Number(created.data?.id || 0) || null;
    assert(loanId, 'Expected created loan to return an id');

    const activeList = await client.request('/api/media/loans?status=active&page=1&limit=25&search=casey', {
      method: 'GET',
      expectStatus: 200
    });
    assert(activeList.data?.pagination?.total === 1, 'Expected active loans list to contain the created loan');
    assert(activeList.data?.items?.[0]?.borrower_name === 'Casey Reader', 'Expected active loans list to show borrower name');

    const updated = await client.request(`/api/media/loans/${loanId}`, {
      method: 'PATCH',
      withCsrf: true,
      expectStatus: 200,
      body: {
        borrower_name: 'Casey Updated',
        due_at: '2026-05-10',
        notes: 'Extended checkout window'
      }
    });
    assert(updated.data?.borrower_name === 'Casey Updated', 'Expected loan update to persist borrower changes');
    assert(
      updated.data?.due_at === '2026-05-10',
      `Expected loan update to persist due date changes, got ${JSON.stringify(updated.data)}`
    );

    const historyBeforeReturn = await client.request(`/api/media/${mediaId}/loans`, {
      method: 'GET',
      expectStatus: 200
    });
    assert(historyBeforeReturn.data?.active_loan?.id === loanId, 'Expected media loan history to expose the active loan');

    const returned = await client.request(`/api/media/loans/${loanId}/return`, {
      method: 'PATCH',
      withCsrf: true,
      expectStatus: 200,
      body: {
        returned_at: '2026-05-01'
      }
    });
    assert(returned.data?.returned_at === '2026-05-01', 'Expected returned loan to persist the return date');
    assert(returned.data?.status === 'returned', 'Expected returned loan status to normalize to returned');

    const activeAfterReturn = await client.request('/api/media/loans?status=active&page=1&limit=25', {
      method: 'GET',
      expectStatus: 200
    });
    const returnedList = await client.request('/api/media/loans?status=returned&page=1&limit=25', {
      method: 'GET',
      expectStatus: 200
    });
    const historyAfterReturn = await client.request(`/api/media/${mediaId}/loans`, {
      method: 'GET',
      expectStatus: 200
    });

    assert(activeAfterReturn.data?.pagination?.total === 0, 'Expected no active loans after the loan is returned');
    assert(returnedList.data?.pagination?.total === 1, 'Expected returned loans list to include the returned entry');
    assert(historyAfterReturn.data?.active_loan === null, 'Expected no active loan after return');
    assert(Array.isArray(historyAfterReturn.data?.history) && historyAfterReturn.data.history.length === 1, 'Expected media loan history to retain the returned loan record');
    assert(historyAfterReturn.data?.history?.[0]?.borrower_name === 'Casey Updated', 'Expected loan history to preserve the updated borrower name');
    assert(historyAfterReturn.data?.history?.[0]?.returned_at === '2026-05-01', 'Expected loan history to preserve the return date');

    console.log(JSON.stringify({
      created: true,
      updatedBorrower: updated.data?.borrower_name,
      returnedAt: returned.data?.returned_at,
      activeCountBeforeReturn: activeList.data?.pagination?.total,
      activeCountAfterReturn: activeAfterReturn.data?.pagination?.total,
      returnedCount: returnedList.data?.pagination?.total,
      historyCount: historyAfterReturn.data?.history?.length || 0,
      activeLoanCleared: historyAfterReturn.data?.active_loan === null
    }, null, 2));
  } finally {
    await cleanupTemporaryState({ userId, libraryId, spaceId });
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
