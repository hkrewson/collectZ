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
  const result = await pool.query(
    `INSERT INTO space_memberships (space_id, user_id, role, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (space_id, user_id) DO UPDATE
     SET role = EXCLUDED.role,
         suspended_at = NULL,
         suspended_by = NULL,
         updated_at = CURRENT_TIMESTAMP
     RETURNING id, space_id, user_id, role`,
    [spaceId, userId, role, createdBy]
  );
  return result.rows[0];
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

async function getMembershipState(membershipId) {
  const result = await pool.query(
    `SELECT id, space_id, user_id, role, suspended_at, suspended_by
     FROM space_memberships
     WHERE id = $1
     LIMIT 1`,
    [membershipId]
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

async function login(client, { email, password }) {
  await client.fetchCsrfToken();
  await client.request('/api/auth/login', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 200,
    body: { email, password }
  });
}

async function main() {
  const suffix = Date.now();
  const password = 'Passw0rd!123';
  const spaceIds = [];
  const userIds = [];

  const suspendOwnerClient = new HttpClient('suspend-owner');
  const suspendMemberClient = new HttpClient('suspend-member');
  const removalOwnerClient = new HttpClient('removal-owner');
  const removalMemberClient = new HttpClient('removal-member');
  const transferAdminClient = new HttpClient('transfer-admin');
  const transferOwnerClient = new HttpClient('transfer-owner');

  try {
    const suspendOwner = await createDirectUser({
      email: `space-suspend-owner-${suffix}@example.com`,
      password,
      name: 'Suspend Owner'
    });
    const suspendMember = await createDirectUser({
      email: `space-suspend-member-${suffix}@example.com`,
      password,
      name: 'Suspend Member'
    });
    const removalOwner = await createDirectUser({
      email: `space-remove-owner-${suffix}@example.com`,
      password,
      name: 'Removal Owner'
    });
    const removalMember = await createDirectUser({
      email: `space-remove-member-${suffix}@example.com`,
      password,
      name: 'Removal Member'
    });
    const transferAdmin = await createDirectUser({
      email: `space-transfer-admin-${suffix}@example.com`,
      password,
      name: 'Transfer Admin',
      role: 'admin'
    });
    const transferOwner = await createDirectUser({
      email: `space-transfer-owner-${suffix}@example.com`,
      password,
      name: 'Transfer Owner'
    });
    const transferKeeperOwner = await createDirectUser({
      email: `space-transfer-keeper-${suffix}@example.com`,
      password,
      name: 'Transfer Keeper Owner'
    });
    for (const user of [suspendOwner, suspendMember, removalOwner, removalMember, transferAdmin, transferOwner, transferKeeperOwner]) {
      userIds.push(Number(user.id));
    }

    const suspendSpace = await createSpace({
      name: `Suspend Space ${suffix}`,
      slug: `suspend-space-${suffix}`,
      createdBy: suspendOwner.id
    });
    const removalSpace = await createSpace({
      name: `Removal Space ${suffix}`,
      slug: `removal-space-${suffix}`,
      createdBy: removalOwner.id
    });
    const transferSpace = await createSpace({
      name: `Transfer Source Space ${suffix}`,
      slug: `transfer-source-space-${suffix}`,
      createdBy: transferOwner.id
    });
    spaceIds.push(Number(suspendSpace.id), Number(removalSpace.id), Number(transferSpace.id));

    await addSpaceMembership({
      spaceId: suspendSpace.id,
      userId: suspendOwner.id,
      role: 'owner',
      createdBy: suspendOwner.id
    });
    const suspendMemberMembership = await addSpaceMembership({
      spaceId: suspendSpace.id,
      userId: suspendMember.id,
      role: 'member',
      createdBy: suspendOwner.id
    });
    await addSpaceMembership({
      spaceId: removalSpace.id,
      userId: removalOwner.id,
      role: 'owner',
      createdBy: removalOwner.id
    });
    const removalMemberMembership = await addSpaceMembership({
      spaceId: removalSpace.id,
      userId: removalMember.id,
      role: 'member',
      createdBy: removalOwner.id
    });
    const transferOwnerMembership = await addSpaceMembership({
      spaceId: transferSpace.id,
      userId: transferOwner.id,
      role: 'owner',
      createdBy: transferOwner.id
    });
    await addSpaceMembership({
      spaceId: transferSpace.id,
      userId: transferKeeperOwner.id,
      role: 'owner',
      createdBy: transferOwner.id
    });

    const suspendLibrary = await createLibrary({
      name: `Suspend Library ${suffix}`,
      spaceId: suspendSpace.id,
      createdBy: suspendOwner.id
    });
    const removalLibrary = await createLibrary({
      name: `Removal Library ${suffix}`,
      spaceId: removalSpace.id,
      createdBy: removalOwner.id
    });
    const transferLibrary = await createLibrary({
      name: `Transfer Library ${suffix}`,
      spaceId: transferSpace.id,
      createdBy: transferOwner.id
    });

    await addLibraryMembership({ userId: suspendOwner.id, libraryId: suspendLibrary.id, role: 'owner' });
    await addLibraryMembership({ userId: suspendMember.id, libraryId: suspendLibrary.id, role: 'member' });
    await addLibraryMembership({ userId: removalOwner.id, libraryId: removalLibrary.id, role: 'owner' });
    await addLibraryMembership({ userId: removalMember.id, libraryId: removalLibrary.id, role: 'member' });
    await addLibraryMembership({ userId: transferOwner.id, libraryId: transferLibrary.id, role: 'owner' });

    await pool.query(
      `UPDATE users
       SET active_space_id = $2,
           active_library_id = $3
       WHERE id = $1`,
      [suspendMember.id, suspendSpace.id, suspendLibrary.id]
    );
    await pool.query(
      `UPDATE users
       SET active_space_id = $2,
           active_library_id = $3
       WHERE id = $1`,
      [removalMember.id, removalSpace.id, removalLibrary.id]
    );
    await pool.query(
      `UPDATE users
       SET active_space_id = $2,
           active_library_id = $3
       WHERE id = $1`,
      [transferOwner.id, transferSpace.id, transferLibrary.id]
    );

    for (const [client, email] of [
      [suspendOwnerClient, suspendOwner.email],
      [suspendMemberClient, suspendMember.email],
      [removalOwnerClient, removalOwner.email],
      [removalMemberClient, removalMember.email],
      [transferAdminClient, transferAdmin.email],
      [transferOwnerClient, transferOwner.email]
    ]) {
      await login(client, { email, password });
    }

    const suspendMemberSessionToken = getSessionTokenForClient(suspendMemberClient);
    const removalMemberSessionToken = getSessionTokenForClient(removalMemberClient);
    const transferOwnerSessionToken = getSessionTokenForClient(transferOwnerClient);
    assert(suspendMemberSessionToken, 'Suspended member session token missing');
    assert(removalMemberSessionToken, 'Removal member session token missing');
    assert(transferOwnerSessionToken, 'Transfer owner session token missing');

    await updateSessionByToken(suspendMemberSessionToken, {
      support_space_id: suspendSpace.id,
      support_library_id: suspendLibrary.id,
      support_started_at: new Date().toISOString(),
      support_reason: 'space suspension verification',
      support_previous_space_id: suspendSpace.id,
      support_previous_library_id: suspendLibrary.id
    });
    await updateSessionByToken(removalMemberSessionToken, {
      support_space_id: removalSpace.id,
      support_library_id: removalLibrary.id,
      support_started_at: new Date().toISOString(),
      support_reason: 'space removal verification',
      support_previous_space_id: removalSpace.id,
      support_previous_library_id: removalLibrary.id
    });
    await updateSessionByToken(transferOwnerSessionToken, {
      support_space_id: transferSpace.id,
      support_library_id: transferLibrary.id,
      support_started_at: new Date().toISOString(),
      support_reason: 'space transfer verification',
      support_previous_space_id: transferSpace.id,
      support_previous_library_id: transferLibrary.id
    });

    await suspendOwnerClient.fetchCsrfToken();
    await suspendOwnerClient.request(`/api/spaces/${suspendSpace.id}/members/${suspendMemberMembership.id}/suspension`, {
      method: 'PATCH',
      withCsrf: true,
      expectStatus: 200,
      body: { suspended: true }
    });

    const suspendedMembershipState = await getMembershipState(suspendMemberMembership.id);
    assert(Boolean(suspendedMembershipState?.suspended_at), `Suspension should mark membership as suspended: ${JSON.stringify(suspendedMembershipState)}`);
    const suspendedUserState = await getUserState(suspendMember.id);
    assert((Number(suspendedUserState?.active_space_id || 0) || null) === null, `Suspension should clear active space for suspended member: ${JSON.stringify(suspendedUserState)}`);
    assert((Number(suspendedUserState?.active_library_id || 0) || null) === null, `Suspension should clear active library for suspended member: ${JSON.stringify(suspendedUserState)}`);
    const suspendedSessionState = await getSessionState(suspendMemberSessionToken);
    assert((Number(suspendedSessionState?.support_space_id || 0) || null) === null, `Suspension should clear current support space tied to removed access: ${JSON.stringify(suspendedSessionState)}`);
    assert((Number(suspendedSessionState?.support_library_id || 0) || null) === null, `Suspension should clear current support library tied to removed access: ${JSON.stringify(suspendedSessionState)}`);
    assert((Number(suspendedSessionState?.support_previous_space_id || 0) || null) === null, `Suspension should clear previous support space tied to removed access: ${JSON.stringify(suspendedSessionState)}`);
    assert((Number(suspendedSessionState?.support_previous_library_id || 0) || null) === null, `Suspension should clear previous support library tied to removed access: ${JSON.stringify(suspendedSessionState)}`);

    await removalOwnerClient.fetchCsrfToken();
    await removalOwnerClient.request(`/api/spaces/${removalSpace.id}/members/${removalMemberMembership.id}`, {
      method: 'DELETE',
      withCsrf: true,
      expectStatus: 200
    });

    const removedMembershipState = await getMembershipState(removalMemberMembership.id);
    assert(removedMembershipState === null, `Membership removal should delete target membership row: ${JSON.stringify(removedMembershipState)}`);
    const removalUserState = await getUserState(removalMember.id);
    assert((Number(removalUserState?.active_space_id || 0) || null) === null, `Membership removal should clear active space for removed member: ${JSON.stringify(removalUserState)}`);
    assert((Number(removalUserState?.active_library_id || 0) || null) === null, `Membership removal should clear active library for removed member: ${JSON.stringify(removalUserState)}`);
    const removalSessionState = await getSessionState(removalMemberSessionToken);
    assert((Number(removalSessionState?.support_space_id || 0) || null) === null, `Membership removal should clear current support space tied to removed access: ${JSON.stringify(removalSessionState)}`);
    assert((Number(removalSessionState?.support_library_id || 0) || null) === null, `Membership removal should clear current support library tied to removed access: ${JSON.stringify(removalSessionState)}`);
    assert((Number(removalSessionState?.support_previous_space_id || 0) || null) === null, `Membership removal should clear previous support space tied to removed access: ${JSON.stringify(removalSessionState)}`);
    assert((Number(removalSessionState?.support_previous_library_id || 0) || null) === null, `Membership removal should clear previous support library tied to removed access: ${JSON.stringify(removalSessionState)}`);

    await transferAdminClient.fetchCsrfToken();
    const transferResponse = await transferAdminClient.request(`/api/spaces/${transferSpace.id}/members/${transferOwnerMembership.id}/transfer-new-space`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: {
        name: `Transferred Space ${suffix}`,
        slug: `transferred-space-${suffix}`,
        description: 'Transfer lifecycle verification'
      }
    });

    const targetSpaceId = Number(transferResponse?.data?.target_space?.id || 0) || null;
    assert(targetSpaceId, `Transfer should create a target space: ${JSON.stringify(transferResponse?.data)}`);
    spaceIds.push(targetSpaceId);
    const transferUserState = await getUserState(transferOwner.id);
    assert(Number(transferUserState?.active_space_id || 0) === targetSpaceId, `Transfer should preserve new active space after source invalidation cleanup: ${JSON.stringify(transferUserState)}`);
    assert((Number(transferUserState?.active_library_id || 0) || null) === Number(transferLibrary.id), `Transfer should preserve moved library as active library after source invalidation cleanup: ${JSON.stringify(transferUserState)}`);
    const transferSessionState = await getSessionState(transferOwnerSessionToken);
    assert((Number(transferSessionState?.support_space_id || 0) || null) === null, `Transfer should clear current support space from source space: ${JSON.stringify(transferSessionState)}`);
    assert((Number(transferSessionState?.support_library_id || 0) || null) === null, `Transfer should clear current support library from source space: ${JSON.stringify(transferSessionState)}`);
    assert((Number(transferSessionState?.support_previous_space_id || 0) || null) === null, `Transfer should clear previous support space from source space: ${JSON.stringify(transferSessionState)}`);
    assert((Number(transferSessionState?.support_previous_library_id || 0) || null) === null, `Transfer should clear previous support library from source space: ${JSON.stringify(transferSessionState)}`);
    const transferOwnerMe = await transferOwnerClient.request('/api/auth/me', { expectStatus: 200 });
    assert(Number(transferOwnerMe?.data?.active_space_id || 0) === targetSpaceId, `Transfer should surface new active space through /api/auth/me: ${JSON.stringify(transferOwnerMe?.data)}`);
    assert(Number(transferOwnerMe?.data?.active_library_id || 0) === Number(transferLibrary.id), `Transfer should surface moved library through /api/auth/me: ${JSON.stringify(transferOwnerMe?.data)}`);

    console.log('Space lifecycle smoke passed');
  } finally {
    for (const spaceId of [...new Set(spaceIds)].filter(Boolean)) {
      await pool.query('DELETE FROM libraries WHERE space_id = $1', [spaceId]).catch(() => {});
      await pool.query('DELETE FROM space_memberships WHERE space_id = $1', [spaceId]).catch(() => {});
      await pool.query('DELETE FROM spaces WHERE id = $1', [spaceId]).catch(() => {});
    }
    for (const userId of [...new Set(userIds)].filter(Boolean)) {
      await deleteDirectUser(userId).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
