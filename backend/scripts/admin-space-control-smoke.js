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

async function bootstrapAdmin(client, { fallbackEmail, fallbackPassword }) {
  const directAdmin = await createDirectUser({
    email: fallbackEmail,
    password: fallbackPassword,
    name: 'Phase5 Smoke Admin',
    role: 'admin'
  });

  await client.fetchCsrfToken();
  await client.request('/api/auth/login', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 200,
    body: { email: fallbackEmail, password: fallbackPassword }
  });
  return { email: fallbackEmail, password: fallbackPassword, userId: Number(directAdmin.id) };
}

async function main() {
  const suffix = Date.now();
  const admin = new HttpClient('admin');
  const ownerEmail = `phase5-owner-${suffix}@example.com`;
  const ownerPassword = 'Passw0rd!123';
  const inviteEmail = `phase5-invite-${suffix}@example.com`;
  const invitedOwnerEmail = `phase5-invited-owner-${suffix}@example.com`;
  const invitedOwnerPassword = 'Passw0rd!123';
  const spaceSlug = `phase5-space-${suffix}`;
  const inviteOwnerSpaceSlug = `phase5-invite-owner-space-${suffix}`;
  const tempAdminEmail = `phase5-admin-${suffix}@example.com`;
  const tempAdminPassword = 'Passw0rd!123';
  let tempAdminUserId = null;
  let ownerUserId = null;
  let invitedOwnerUserId = null;
  let spaceId = null;
  let invitedOwnerSpaceId = null;

  try {
    const bootstrappedAdmin = await bootstrapAdmin(admin, {
      fallbackEmail: tempAdminEmail,
      fallbackPassword: tempAdminPassword
    });
    tempAdminUserId = Number(bootstrappedAdmin?.userId || 0) || null;
    await admin.fetchCsrfToken();

    const ownerUser = await createDirectUser({
      email: ownerEmail,
      password: ownerPassword,
      name: 'Phase5 Owner'
    });
    ownerUserId = Number(ownerUser?.id || 0);
    assert(Number.isFinite(ownerUserId) && ownerUserId > 0, 'Owner user id missing');

    const createSpace = await admin.request('/api/admin/spaces/create-with-onboarding', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: {
        name: `Phase 5 Space ${suffix}`,
        slug: spaceSlug,
        description: 'Server-admin control plane smoke',
        owner_user_id: ownerUserId,
        initial_invites: [
          { email: inviteEmail, role: 'member', expose_token: true }
        ]
      }
    });
    spaceId = Number(createSpace?.data?.space?.id || 0);
    assert(Number.isFinite(spaceId) && spaceId > 0, 'Space id missing after create');
    assert(Number(createSpace?.data?.owner?.user_id || 0) === ownerUserId, 'Owner missing from onboarding response');
    assert(Number(createSpace?.data?.summary?.requested || 0) === 1, 'Onboarding summary requested count mismatch');
    assert(Number(createSpace?.data?.summary?.created || 0) === 1, 'Onboarding summary created count mismatch');
    assert(Number(createSpace?.data?.summary?.failed || 0) === 0, 'Onboarding summary failed count mismatch');
    assert(Array.isArray(createSpace?.data?.invite_results), 'Invite results missing from onboarding response');
    assert(createSpace?.data?.invite_results?.[0]?.email === inviteEmail, 'Onboarding invite email missing from response');
    assert(createSpace?.data?.invite_results?.[0]?.created === true, 'Onboarding invite was not created');

    const listAfterCreate = await admin.request('/api/admin/spaces', { expectStatus: 200 });
    const createdSpace = (listAfterCreate?.data?.spaces || []).find((space) => Number(space.id) === spaceId);
    assert(createdSpace, 'Created space not found in admin space list');
    assert((createdSpace.owners || []).some((entry) => Number(entry.user_id) === ownerUserId), 'Assigned owner missing from admin space list');

    await admin.fetchCsrfToken();
    const invitedOwnerSpace = await admin.request('/api/admin/spaces/create-with-onboarding', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: {
        name: `Phase 5 Invited Owner Space ${suffix}`,
        slug: inviteOwnerSpaceSlug,
        description: 'Pending owner invite smoke',
        initial_invites: [
          { email: invitedOwnerEmail, role: 'owner', expose_token: true }
        ]
      }
    });
    invitedOwnerSpaceId = Number(invitedOwnerSpace?.data?.space?.id || 0);
    assert(Number.isFinite(invitedOwnerSpaceId) && invitedOwnerSpaceId > 0, 'Invited-owner space id missing after create');
    assert(invitedOwnerSpace?.data?.owner?.pending === true, 'Invited owner should be pending in onboarding response');
    assert(invitedOwnerSpace?.data?.owner?.email === invitedOwnerEmail, 'Pending owner email missing from onboarding response');
    assert(invitedOwnerSpace?.data?.owner?.user_id === null, 'Pending owner should not have a user id yet');
    assert(invitedOwnerSpace?.data?.invite_results?.[0]?.role === 'owner', 'Invited owner role missing from onboarding invite response');
    const invitedOwnerToken = String(invitedOwnerSpace?.data?.invite_results?.[0]?.token || '').trim();
    assert(invitedOwnerToken, 'Invited owner token missing from onboarding response');

    const invitedOwnerClient = new HttpClient('invited-owner');
    await invitedOwnerClient.fetchCsrfToken();
    const invitedOwnerRegister = await invitedOwnerClient.request('/api/auth/register', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: {
        email: invitedOwnerEmail,
        password: invitedOwnerPassword,
        name: 'Phase5 Invited Owner',
        inviteToken: invitedOwnerToken
      }
    });
    assert(Number(invitedOwnerRegister?.data?.user?.active_space_id || 0) === invitedOwnerSpaceId, 'Invited owner should land in the invited workspace');

    const pendingOwnerMembership = await pool.query(
      `SELECT user_id, role
       FROM space_memberships
       WHERE space_id = $1
         AND user_id = (
           SELECT id
           FROM users
           WHERE lower(email) = lower($2)
           LIMIT 1
         )
       LIMIT 1`,
      [invitedOwnerSpaceId, invitedOwnerEmail]
    );
    invitedOwnerUserId = Number(pendingOwnerMembership.rows[0]?.user_id || 0) || null;
    assert(pendingOwnerMembership.rows[0]?.role === 'owner', 'Invited owner did not become owner on claim');

    const listAfterInvitedOwnerClaim = await admin.request('/api/admin/spaces', { expectStatus: 200 });
    const claimedOwnerSpace = (listAfterInvitedOwnerClaim?.data?.spaces || []).find((space) => Number(space.id) === invitedOwnerSpaceId);
    assert(claimedOwnerSpace, 'Invited-owner space missing from admin list after claim');
    assert((claimedOwnerSpace.owners || []).some((entry) => String(entry.email || '').toLowerCase() === invitedOwnerEmail), 'Claimed invited owner missing from admin space list');

    await admin.fetchCsrfToken();
    await admin.request(`/api/admin/spaces/${spaceId}/owner`, {
      method: 'PATCH',
      withCsrf: true,
      expectStatus: 200,
      body: { owner_user_id: ownerUserId }
    });

    await admin.fetchCsrfToken();
    const deleted = await admin.request(`/api/admin/spaces/${spaceId}`, {
      method: 'DELETE',
      withCsrf: true,
      expectStatus: 200
    });
    assert(deleted?.data?.deleted === true, 'Delete response missing deleted=true');

    const listAfterDelete = await admin.request('/api/admin/spaces', { expectStatus: 200 });
    assert(!(listAfterDelete?.data?.spaces || []).some((space) => Number(space.id) === spaceId), 'Deleted space still present in admin space list');

    console.log('Admin space control smoke passed');
  } finally {
    if (invitedOwnerSpaceId) {
      await pool.query('DELETE FROM spaces WHERE id = $1', [invitedOwnerSpaceId]).catch(() => {});
    }
    if (spaceId) {
      await pool.query('DELETE FROM spaces WHERE id = $1', [spaceId]).catch(() => {});
    }
    if (ownerUserId) {
      await deleteDirectUser(ownerUserId).catch(() => {});
    }
    if (invitedOwnerUserId) {
      await deleteDirectUser(invitedOwnerUserId).catch(() => {});
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
