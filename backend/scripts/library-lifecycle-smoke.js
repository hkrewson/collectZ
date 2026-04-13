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

async function createSpace({ name, slug, createdBy }) {
  const result = await pool.query(
    `INSERT INTO spaces (name, slug, created_by, is_personal)
     VALUES ($1, $2, $3, false)
     RETURNING id, name, slug`,
    [name, slug, createdBy || null]
  );
  return result.rows[0];
}

async function addSpaceMembership({ spaceId, userId, role = 'member', createdBy = null }) {
  await pool.query(
    `INSERT INTO space_memberships (space_id, user_id, role, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (space_id, user_id) DO UPDATE
     SET role = EXCLUDED.role,
         suspended_at = NULL,
         suspended_by = NULL,
         updated_at = CURRENT_TIMESTAMP`,
    [spaceId, userId, role, createdBy]
  );
}

async function createLibrary({ name, spaceId, createdBy }) {
  const result = await pool.query(
    `INSERT INTO libraries (name, created_by, space_id)
     VALUES ($1, $2, $3)
     RETURNING id, name, space_id, created_by`,
    [name, createdBy || null, spaceId]
  );
  return result.rows[0];
}

async function addLibraryMembership({ userId, libraryId, role = 'member' }) {
  await pool.query(
    `INSERT INTO library_memberships (user_id, library_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, library_id) DO UPDATE
     SET role = EXCLUDED.role`,
    [userId, libraryId, role]
  );
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

async function getUserState(userId) {
  const result = await pool.query(
    `SELECT active_space_id, active_library_id
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function getSessionState(token) {
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

async function main() {
  const suffix = Date.now();
  const ownerClient = new HttpClient('owner');
  const memberClient = new HttpClient('member');
  const transferOwnerClient = new HttpClient('transfer-owner');

  let ownerId = null;
  let memberId = null;
  let transferOwnerId = null;
  let transferNewOwnerId = null;
  let archiveSpaceId = null;
  let transferSpaceId = null;

  try {
    const owner = await createDirectUser({
      email: `library-owner-${suffix}@example.com`,
      password: 'Passw0rd!123',
      name: 'Library Owner'
    });
    const member = await createDirectUser({
      email: `library-member-${suffix}@example.com`,
      password: 'Passw0rd!123',
      name: 'Library Member'
    });
    const transferOwner = await createDirectUser({
      email: `transfer-owner-${suffix}@example.com`,
      password: 'Passw0rd!123',
      name: 'Transfer Owner'
    });
    const transferNewOwner = await createDirectUser({
      email: `transfer-new-owner-${suffix}@example.com`,
      password: 'Passw0rd!123',
      name: 'Transfer New Owner'
    });
    ownerId = Number(owner.id);
    memberId = Number(member.id);
    transferOwnerId = Number(transferOwner.id);
    transferNewOwnerId = Number(transferNewOwner.id);

    archiveSpaceId = Number((await createSpace({
      name: `Archive Space ${suffix}`,
      slug: `archive-space-${suffix}`,
      createdBy: ownerId
    })).id);
    transferSpaceId = Number((await createSpace({
      name: `Transfer Space ${suffix}`,
      slug: `transfer-space-${suffix}`,
      createdBy: transferOwnerId
    })).id);

    await addSpaceMembership({ spaceId: archiveSpaceId, userId: ownerId, role: 'owner', createdBy: ownerId });
    await addSpaceMembership({ spaceId: archiveSpaceId, userId: memberId, role: 'member', createdBy: ownerId });
    await addSpaceMembership({ spaceId: transferSpaceId, userId: transferOwnerId, role: 'owner', createdBy: transferOwnerId });
    await addSpaceMembership({ spaceId: transferSpaceId, userId: transferNewOwnerId, role: 'member', createdBy: transferOwnerId });

    const archiveTarget = await createLibrary({
      name: `Archive Target ${suffix}`,
      spaceId: archiveSpaceId,
      createdBy: ownerId
    });
    const archiveReplacement = await createLibrary({
      name: `Archive Replacement ${suffix}`,
      spaceId: archiveSpaceId,
      createdBy: ownerId
    });
    const transferTarget = await createLibrary({
      name: `Transfer Target ${suffix}`,
      spaceId: transferSpaceId,
      createdBy: transferOwnerId
    });

    await addLibraryMembership({ userId: ownerId, libraryId: archiveTarget.id, role: 'owner' });
    await addLibraryMembership({ userId: ownerId, libraryId: archiveReplacement.id, role: 'owner' });
    await addLibraryMembership({ userId: memberId, libraryId: archiveTarget.id, role: 'member' });
    await addLibraryMembership({ userId: memberId, libraryId: archiveReplacement.id, role: 'member' });
    await addLibraryMembership({ userId: transferOwnerId, libraryId: transferTarget.id, role: 'owner' });
    await addLibraryMembership({ userId: transferNewOwnerId, libraryId: transferTarget.id, role: 'member' });

    await pool.query(
      `UPDATE users
       SET active_space_id = $2,
           active_library_id = $3
       WHERE id = $1`,
      [memberId, archiveSpaceId, archiveTarget.id]
    );
    await pool.query(
      `UPDATE users
       SET active_space_id = $2,
           active_library_id = $3
       WHERE id = $1`,
      [transferOwnerId, transferSpaceId, transferTarget.id]
    );

    for (const [client, email] of [
      [ownerClient, owner.email],
      [memberClient, member.email],
      [transferOwnerClient, transferOwner.email]
    ]) {
      await client.fetchCsrfToken();
      await client.request('/api/auth/login', {
        method: 'POST',
        withCsrf: true,
        expectStatus: 200,
        body: { email, password: 'Passw0rd!123' }
      });
    }

    const memberSessionToken = getSessionTokenForClient(memberClient);
    const transferOwnerSessionToken = getSessionTokenForClient(transferOwnerClient);
    assert(memberSessionToken, 'Member session token missing');
    assert(transferOwnerSessionToken, 'Transfer owner session token missing');

    await updateSessionByToken(memberSessionToken, {
      support_space_id: archiveSpaceId,
      support_library_id: archiveTarget.id,
      support_started_at: new Date().toISOString(),
      support_reason: 'archive lifecycle verification',
      support_previous_space_id: archiveSpaceId,
      support_previous_library_id: archiveTarget.id
    });
    await updateSessionByToken(transferOwnerSessionToken, {
      support_space_id: transferSpaceId,
      support_library_id: transferTarget.id,
      support_started_at: new Date().toISOString(),
      support_reason: 'transfer lifecycle verification',
      support_previous_space_id: transferSpaceId,
      support_previous_library_id: transferTarget.id
    });

    await ownerClient.fetchCsrfToken();
    await ownerClient.request(`/api/libraries/${archiveTarget.id}/archive`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { confirm_name: archiveTarget.name }
    });

    const memberStateAfterArchive = await getUserState(memberId);
    assert(Number(memberStateAfterArchive?.active_library_id || 0) === Number(archiveReplacement.id), `Archive should move affected member to replacement library: ${JSON.stringify(memberStateAfterArchive)}`);
    const memberSessionAfterArchive = await getSessionState(memberSessionToken);
    assert((Number(memberSessionAfterArchive?.support_space_id || 0) || null) === null, `Archive should clear stale support space when current support library is removed: ${JSON.stringify(memberSessionAfterArchive)}`);
    assert((Number(memberSessionAfterArchive?.support_library_id || 0) || null) === null, `Archive should clear stale support library when current support library is removed: ${JSON.stringify(memberSessionAfterArchive)}`);
    assert((Number(memberSessionAfterArchive?.support_previous_space_id || 0) || null) === null, `Archive should clear stale previous support space when previous support library is removed: ${JSON.stringify(memberSessionAfterArchive)}`);
    assert((Number(memberSessionAfterArchive?.support_previous_library_id || 0) || null) === null, `Archive should clear stale previous support library when previous support library is removed: ${JSON.stringify(memberSessionAfterArchive)}`);

    const memberMeAfterArchive = await memberClient.request('/api/auth/me', { expectStatus: 200 });
    assert(Number(memberMeAfterArchive?.data?.active_library_id || 0) === Number(archiveReplacement.id), `Archive should surface replacement library through /api/auth/me: ${JSON.stringify(memberMeAfterArchive?.data)}`);

    await transferOwnerClient.fetchCsrfToken();
    await transferOwnerClient.request(`/api/libraries/${transferTarget.id}/transfer`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { new_owner_user_id: transferNewOwnerId }
    });

    const transferOwnerStateAfterTransfer = await getUserState(transferOwnerId);
    const fallbackLibraryId = Number(transferOwnerStateAfterTransfer?.active_library_id || 0) || null;
    assert(fallbackLibraryId && fallbackLibraryId !== Number(transferTarget.id), `Transfer should move previous owner off transferred library via default-scope fallback: ${JSON.stringify(transferOwnerStateAfterTransfer)}`);
    const fallbackLibrary = await pool.query(
      `SELECT id, name, created_by, space_id, archived_at
       FROM libraries
       WHERE id = $1
       LIMIT 1`,
      [fallbackLibraryId]
    );
    assert(Number(fallbackLibrary.rows[0]?.created_by || 0) === transferOwnerId, `Fallback library should be created for previous owner when no accessible library remains: ${JSON.stringify(fallbackLibrary.rows[0] || null)}`);
    assert(Number(fallbackLibrary.rows[0]?.space_id || 0) === transferSpaceId, `Fallback library should stay anchored to accessible transfer space: ${JSON.stringify(fallbackLibrary.rows[0] || null)}`);

    const transferOwnerSessionAfterTransfer = await getSessionState(transferOwnerSessionToken);
    assert((Number(transferOwnerSessionAfterTransfer?.support_space_id || 0) || null) === null, `Transfer should clear stale current support space for previous owner: ${JSON.stringify(transferOwnerSessionAfterTransfer)}`);
    assert((Number(transferOwnerSessionAfterTransfer?.support_library_id || 0) || null) === null, `Transfer should clear stale current support library for previous owner: ${JSON.stringify(transferOwnerSessionAfterTransfer)}`);
    assert((Number(transferOwnerSessionAfterTransfer?.support_previous_space_id || 0) || null) === null, `Transfer should clear stale previous support space for previous owner: ${JSON.stringify(transferOwnerSessionAfterTransfer)}`);
    assert((Number(transferOwnerSessionAfterTransfer?.support_previous_library_id || 0) || null) === null, `Transfer should clear stale previous support library for previous owner: ${JSON.stringify(transferOwnerSessionAfterTransfer)}`);

    const transferOwnerMeAfterTransfer = await transferOwnerClient.request('/api/auth/me', { expectStatus: 200 });
    assert(Number(transferOwnerMeAfterTransfer?.data?.active_library_id || 0) === fallbackLibraryId, `Transfer should surface fallback library through /api/auth/me: ${JSON.stringify(transferOwnerMeAfterTransfer?.data)}`);

    console.log('Library lifecycle smoke passed');
  } finally {
    if (archiveSpaceId) {
      await pool.query('DELETE FROM libraries WHERE space_id = $1', [archiveSpaceId]).catch(() => {});
      await pool.query('DELETE FROM space_memberships WHERE space_id = $1', [archiveSpaceId]).catch(() => {});
      await pool.query('DELETE FROM spaces WHERE id = $1', [archiveSpaceId]).catch(() => {});
    }
    if (transferSpaceId) {
      await pool.query('DELETE FROM libraries WHERE space_id = $1', [transferSpaceId]).catch(() => {});
      await pool.query('DELETE FROM space_memberships WHERE space_id = $1', [transferSpaceId]).catch(() => {});
      await pool.query('DELETE FROM spaces WHERE id = $1', [transferSpaceId]).catch(() => {});
    }
    if (ownerId) await deleteDirectUser(ownerId).catch(() => {});
    if (memberId) await deleteDirectUser(memberId).catch(() => {});
    if (transferOwnerId) await deleteDirectUser(transferOwnerId).catch(() => {});
    if (transferNewOwnerId) await deleteDirectUser(transferNewOwnerId).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
