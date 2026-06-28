#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'session_token';

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
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, $3, $4, true, NOW())
     RETURNING id, email, name, role`,
    [email, passwordHash, name, role]
  );
  return result.rows[0];
}

async function deleteDirectUser(userId) {
  if (!Number.isFinite(Number(userId)) || Number(userId) <= 0) return;
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

function getSessionTokenForClient(client) {
  return String(client?.cookies?.get(SESSION_COOKIE_NAME) || '').trim() || null;
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

async function updateSessionByToken(token, updates = {}) {
  const tokenHash = hashSessionToken(token);
  const keys = Object.keys(updates);
  if (keys.length === 0) return;
  const assignments = [];
  const values = [];
  for (const key of keys) {
    assignments.push(`${key} = $${values.length + 1}`);
    values.push(updates[key]);
  }
  values.push(tokenHash);
  await pool.query(
    `UPDATE user_sessions
     SET ${assignments.join(', ')}
     WHERE token_hash = $${values.length}`,
    values
  );
}

async function getSessionByToken(token) {
  const tokenHash = hashSessionToken(token);
  const result = await pool.query(
    `SELECT support_space_id, support_library_id, support_request_id, support_started_at, support_reason,
            support_previous_space_id, support_previous_library_id
     FROM user_sessions
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

async function createLibraryInSpace({ name, spaceId, createdBy = null }) {
  const result = await pool.query(
    `INSERT INTO libraries (name, created_by, space_id)
     VALUES ($1, $2, $3)
     RETURNING id, name, space_id`,
    [name, createdBy, spaceId]
  );
  return result.rows[0];
}

async function createDetachedSpace({ name, slug, createdBy = null }) {
  const result = await pool.query(
    `INSERT INTO spaces (name, slug, created_by, is_personal)
     VALUES ($1, $2, $3, false)
     RETURNING id, name, slug`,
    [name, slug, createdBy]
  );
  return result.rows[0];
}

async function addSpaceMembership({ spaceId, userId, role = 'owner', createdBy = null }) {
  await pool.query(
    `INSERT INTO space_memberships (space_id, user_id, role, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (space_id, user_id) DO UPDATE
     SET role = EXCLUDED.role,
         updated_at = NOW()`,
    [spaceId, userId, role, createdBy]
  );
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
  let detachedSpaceId = null;
  let libraryOneId = null;
  let libraryTwoId = null;
  let detachedLibraryId = null;

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

    const createdSpace = await createDetachedSpace({
      name: `Support Session Space ${suffix}`,
      slug: `support-session-space-${suffix}`,
      createdBy: ownerUserId
    });
    createdSpaceId = Number(createdSpace?.id || 0) || null;
    assert(Number.isFinite(createdSpaceId), 'Created support-session test space id missing');
    await addSpaceMembership({
      spaceId: createdSpaceId,
      userId: ownerUserId,
      role: 'owner',
      createdBy: ownerUserId
    });

    const libraryOne = await createLibraryInSpace({
      name: `Support Library A ${suffix}`,
      spaceId: createdSpaceId,
      createdBy: ownerUserId
    });
    const libraryTwo = await createLibraryInSpace({
      name: `Support Library B ${suffix}`,
      spaceId: createdSpaceId,
      createdBy: ownerUserId
    });
    const detachedSpace = await createDetachedSpace({
      name: `Support Session Detached ${suffix}`,
      slug: `support-session-detached-${suffix}`,
      createdBy: ownerUserId
    });
    detachedSpaceId = Number(detachedSpace.id);
    await addSpaceMembership({
      spaceId: detachedSpaceId,
      userId: ownerUserId,
      role: 'owner',
      createdBy: ownerUserId
    });
    const detachedLibrary = await createLibraryInSpace({
      name: `Support Detached Library ${suffix}`,
      spaceId: detachedSpaceId,
      createdBy: ownerUserId
    });
    libraryOneId = Number(libraryOne.id);
    libraryTwoId = Number(libraryTwo.id);
    detachedLibraryId = Number(detachedLibrary.id);

    const adminLibrarySelectDenied = await admin.request('/api/libraries/select', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 403,
      body: { library_id: libraryOneId }
    });
    assert(
      String(adminLibrarySelectDenied?.data?.error || '').toLowerCase().includes('support session'),
      `Expected generic admin library selection to require support session, got ${JSON.stringify(adminLibrarySelectDenied?.data)}`
    );

    const adminSpaceSelectDenied = await admin.request('/api/spaces/select', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 403,
      body: { space_id: createdSpaceId }
    });
    assert(
      String(adminSpaceSelectDenied?.data?.error || '').toLowerCase().includes('support-session'),
      `Expected generic admin space selection to be denied, got ${JSON.stringify(adminSpaceSelectDenied?.data)}`
    );

    const adminScopeBeforeSupport = await admin.request('/api/auth/scope', { expectStatus: 200 });
    assert(adminScopeBeforeSupport?.data?.support_session === null, `Admin scope bootstrap should not report an active support session before start: ${JSON.stringify(adminScopeBeforeSupport?.data)}`);

    const beforeSupport = await admin.request(`/api/spaces/${createdSpaceId}/members`, { expectStatus: 404 });
    assert(
      String(beforeSupport?.data?.error || '').toLowerCase().includes('space not found'),
      `Expected non-support access to be denied before support session, got ${JSON.stringify(beforeSupport?.data)}`
    );

    const adminSessionToken = getSessionTokenForClient(admin);
    assert(adminSessionToken, 'Expected admin session token to be present after login');
    await updateSessionByToken(adminSessionToken, {
      support_previous_space_id: detachedSpaceId,
      support_previous_library_id: detachedLibraryId
    });

    await admin.fetchCsrfToken();
    const started = await admin.request('/api/auth/support-session/start', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { space_id: createdSpaceId, library_id: libraryTwoId, reason }
    });
    assert(started?.data?.support_session?.active === true, 'Support session should be active after start');
    assert(Number(started?.data?.support_session?.space_id || 0) === createdSpaceId, 'Support session should target the created space');
    assert(Number(started?.data?.support_session?.library_id || 0) === libraryTwoId, 'Support session should honor the requested initial library');
    assert(Number(started?.data?.active_library_id || 0) === libraryTwoId, 'Support session start should update the active library');
    assert(started?.data?.support_session?.reason === reason, 'Support session should retain the provided reason');
    assert((Number(started?.data?.support_session?.previous_space_id || 0) || null) === null, `Support session start should normalize stale previous space pointers: ${JSON.stringify(started?.data)}`);
    assert((Number(started?.data?.support_session?.previous_library_id || 0) || null) === null, `Support session start should normalize stale previous library pointers: ${JSON.stringify(started?.data)}`);
    assert(Array.isArray(started?.data?.libraries) && started.data.libraries.length === 2, 'Support session should expose target-space libraries');
    const startedSessionState = await getSessionByToken(adminSessionToken);
    assert((Number(startedSessionState?.support_previous_space_id || 0) || null) === null, `Support session start should persist normalized previous space pointers: ${JSON.stringify(startedSessionState)}`);
    assert((Number(startedSessionState?.support_previous_library_id || 0) || null) === null, `Support session start should persist normalized previous library pointers: ${JSON.stringify(startedSessionState)}`);

    const duringSupport = await admin.request(`/api/spaces/${createdSpaceId}/members`, { expectStatus: 200 });
    assert(Array.isArray(duringSupport?.data?.members), 'Expected support session to unlock space member access');

    await admin.fetchCsrfToken();
    const switchedLibrary = await admin.request('/api/libraries/select', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { library_id: libraryOneId }
    });
    assert(Number(switchedLibrary?.data?.active_library_id || 0) === libraryOneId, 'Support library switch should update the active library');

    await updateSessionByToken(adminSessionToken, {
      support_library_id: detachedLibraryId
    });

    const meWithDriftedSupportLibrary = await admin.request('/api/auth/me', { expectStatus: 200 });
    assert(Number(meWithDriftedSupportLibrary?.data?.active_space_id || 0) === createdSpaceId, `Support-session /api/auth/me should preserve the active support space under drifted library state: ${JSON.stringify(meWithDriftedSupportLibrary?.data)}`);
    assert(Number(meWithDriftedSupportLibrary?.data?.active_library_id || 0) === libraryOneId, `Support-session /api/auth/me should normalize drifted support library state to the first valid library: ${JSON.stringify(meWithDriftedSupportLibrary?.data)}`);

    const scopeWithDriftedSupportLibrary = await admin.request('/api/auth/scope', { expectStatus: 200 });
    assert(Number(scopeWithDriftedSupportLibrary?.data?.support_session?.library_id || 0) === libraryOneId, `Support-session /api/auth/scope should normalize drifted support library state: ${JSON.stringify(scopeWithDriftedSupportLibrary?.data)}`);
    assert(Number(scopeWithDriftedSupportLibrary?.data?.active_library_id || 0) === libraryOneId, `Support-session /api/auth/scope should keep active library aligned after drift normalization: ${JSON.stringify(scopeWithDriftedSupportLibrary?.data)}`);

    await updateSessionByToken(adminSessionToken, {
      support_previous_space_id: detachedSpaceId,
      support_previous_library_id: detachedLibraryId
    });

    await admin.fetchCsrfToken();
    const ended = await admin.request('/api/auth/support-session', {
      method: 'DELETE',
      withCsrf: true,
      expectStatus: 200
    });
    assert(ended?.data?.support_session === null, 'Support session should be cleared after end');
    assert((Number(ended?.data?.active_space_id || 0) || null) !== detachedSpaceId, `Support-session end should not restore stale previous space targets: ${JSON.stringify(ended?.data)}`);
    assert((Number(ended?.data?.active_library_id || 0) || null) !== detachedLibraryId, `Support-session end should not restore stale previous library targets: ${JSON.stringify(ended?.data)}`);

    const afterEndMe = await admin.request('/api/auth/me', { expectStatus: 200 });
    assert((Number(afterEndMe?.data?.active_space_id || 0) || null) !== detachedSpaceId, `Post-support /api/auth/me should not restore a stale previous space after normalization: ${JSON.stringify(afterEndMe?.data)}`);
    assert((Number(afterEndMe?.data?.active_library_id || 0) || null) !== detachedLibraryId, `Post-support /api/auth/me should not retain a stale previous library after normalization: ${JSON.stringify(afterEndMe?.data)}`);
    assert(Number(afterEndMe?.data?.active_space_id || 0) === Number(ended?.data?.active_space_id || 0), `Post-support /api/auth/me should stay aligned with teardown scope normalization: ${JSON.stringify({ ended: ended?.data, me: afterEndMe?.data })}`);
    assert(Number(afterEndMe?.data?.active_library_id || 0) === Number(ended?.data?.active_library_id || 0), `Post-support /api/auth/me should keep library normalization aligned after teardown: ${JSON.stringify({ ended: ended?.data, me: afterEndMe?.data })}`);

    const afterSupport = await admin.request(`/api/spaces/${createdSpaceId}/members`, { expectStatus: 404 });
    assert(
      String(afterSupport?.data?.error || '').toLowerCase().includes('space not found'),
      `Expected support access to be removed after session end, got ${JSON.stringify(afterSupport?.data)}`
    );

    console.log('Support session smoke passed');
  } finally {
    if (createdSpaceId) {
      await pool.query('DELETE FROM libraries WHERE space_id = $1', [createdSpaceId]).catch(() => {});
    }
    if (detachedSpaceId) {
      await pool.query('DELETE FROM libraries WHERE space_id = $1', [detachedSpaceId]).catch(() => {});
    }
    if (createdSpaceId) {
      await pool.query('DELETE FROM spaces WHERE id = $1', [createdSpaceId]).catch(() => {});
    }
    if (detachedSpaceId) {
      await pool.query('DELETE FROM spaces WHERE id = $1', [detachedSpaceId]).catch(() => {});
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
