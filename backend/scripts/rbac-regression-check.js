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
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (withCsrf) {
      if (!this.csrfToken) {
        await this.fetchCsrfToken();
      }
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

async function loginIfPossible(client, email, password) {
  await client.fetchCsrfToken();
  return client.request('/api/auth/login', {
    method: 'POST',
    withCsrf: true,
    body: { email, password }
  });
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

async function createDirectCoreScope({ userId, suffix }) {
  const space = await pool.query(
    `INSERT INTO spaces (name, slug, description, created_by, is_personal)
     VALUES ($1, $2, $3, $4, false)
     RETURNING id`,
    [
      `RBAC Space ${suffix}`,
      `rbac-space-${suffix}`,
      'Core RBAC regression bootstrap space',
      userId
    ]
  );
  const spaceId = Number(space.rows[0]?.id || 0) || null;
  assert(Number.isFinite(Number(spaceId)), 'Direct RBAC bootstrap space id missing');

  await pool.query(
    `INSERT INTO space_memberships (space_id, user_id, role, created_by)
     VALUES ($1, $2, 'owner', $2)
     ON CONFLICT (space_id, user_id) DO UPDATE
     SET role = EXCLUDED.role,
         suspended_at = NULL,
         suspended_by = NULL`,
    [spaceId, userId]
  );

  const library = await pool.query(
    `INSERT INTO libraries (name, created_by, space_id)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [`RBAC Default Library ${suffix}`, userId, spaceId]
  );
  const libraryId = Number(library.rows[0]?.id || 0) || null;
  assert(Number.isFinite(Number(libraryId)), 'Direct RBAC bootstrap library id missing');

  await pool.query(
    `INSERT INTO library_memberships (user_id, library_id, role)
     VALUES ($1, $2, 'owner')
     ON CONFLICT (user_id, library_id) DO UPDATE
     SET role = EXCLUDED.role`,
    [userId, libraryId]
  );

  await pool.query(
    `UPDATE users
     SET active_space_id = $1,
         active_library_id = $2
     WHERE id = $3`,
    [spaceId, libraryId, userId]
  );

  return { spaceId, libraryId };
}

async function setDirectActiveLibrary({ userId, libraryId }) {
  await pool.query(
    `UPDATE users
     SET active_library_id = $1,
         active_space_id = libraries.space_id
     FROM libraries
     WHERE users.id = $2
       AND libraries.id = $1`,
    [libraryId, userId]
  );
}

const assertStatusOneOf = (response, expected, label) => {
  if (!Array.isArray(expected) || expected.length === 0) {
    throw new Error(`${label}: expected status set is empty`);
  }
  if (!expected.includes(response?.status)) {
    throw new Error(
      `${label}: expected one of [${expected.join(', ')}], got ${response?.status}. Body: ${JSON.stringify(response?.data)}`
    );
  }
};

async function main() {
  const suffix = Date.now();
  const adminEmail = process.env.RBAC_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'ci-rbac-admin@example.com';
  const userEmail = `rbac-user-${suffix}@example.com`;
  const adminPassword = process.env.RBAC_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'Passw0rd!123';
  const fallbackEmail = process.env.RBAC_ADMIN_EMAIL || process.env.ADMIN_EMAIL || adminEmail;
  const fallbackPassword = process.env.RBAC_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || adminPassword;
  const userPassword = 'Passw0rd!123';
  const tempAdminEmail = `rbac-admin-${suffix}@example.com`;
  const tempAdminPassword = 'Passw0rd!123';

  const admin = new HttpClient('admin');
  const user = new HttpClient('user');
  let tempAdminUserId = null;
  let adminUserId = null;
  let userId = null;

  try {
    const existingAdminLogin = await loginIfPossible(admin, adminEmail, adminPassword);
    if (existingAdminLogin.status !== 200) {
      await admin.fetchCsrfToken();
      const registerAdmin = await admin.request('/api/auth/register', {
        method: 'POST',
        withCsrf: true,
        body: { email: adminEmail, password: adminPassword, name: 'RBAC Admin' }
      });
      if (registerAdmin.status !== 200) {
        const directAdmin = await createDirectUser({
          email: tempAdminEmail,
          password: tempAdminPassword,
          name: 'RBAC Temp Admin',
          role: 'admin'
        });
        tempAdminUserId = Number(directAdmin?.id || 0) || null;
        const tempAdminLogin = await loginIfPossible(admin, tempAdminEmail, tempAdminPassword);
        assertStatusOneOf(tempAdminLogin, [200], 'temp admin bootstrap login');
      }
    }

    const activeAdminLogin = await loginIfPossible(admin, tempAdminUserId ? tempAdminEmail : fallbackEmail, tempAdminUserId ? tempAdminPassword : fallbackPassword);
    if (!tempAdminUserId && activeAdminLogin.status !== 200) {
      throw new Error(`[admin] Unable to bootstrap admin via register or login (${activeAdminLogin.status}). Set RBAC_ADMIN_EMAIL and RBAC_ADMIN_PASSWORD if needed.`);
    }
    await admin.fetchCsrfToken();
    const scopeResponse = await admin.request('/api/auth/scope', { expectStatus: 200 });
    const adminUserLookup = await pool.query(
      `SELECT id
       FROM users
       WHERE lower(email) = lower($1)
       LIMIT 1`,
      [tempAdminUserId ? tempAdminEmail : adminEmail]
    );
    adminUserId = Number(adminUserLookup.rows[0]?.id || 0) || null;
    assert(Number.isFinite(Number(adminUserId)), 'Admin user id missing');
    let targetSpaceId = Number(scopeResponse?.data?.active_space_id || 0) || null;
    if (!targetSpaceId) {
      const createdScope = await createDirectCoreScope({ userId: adminUserId, suffix });
      targetSpaceId = Number(createdScope.spaceId || 0) || null;
      const refreshedAdminLogin = await loginIfPossible(
        admin,
        tempAdminUserId ? tempAdminEmail : fallbackEmail,
        tempAdminUserId ? tempAdminPassword : fallbackPassword
      );
      assertStatusOneOf(refreshedAdminLogin, [200], 'admin login after direct Core scope bootstrap');
      admin.csrfToken = '';
      await admin.fetchCsrfToken();
    }
    assert(Number.isFinite(Number(targetSpaceId)), 'Invite target space id missing');

    const directUser = await createDirectUser({
      email: userEmail,
      password: userPassword,
      name: 'RBAC User',
      role: 'user'
    });
    userId = Number(directUser?.id || 0) || null;
    assert(Number.isFinite(Number(userId)), 'Registered user id missing');

    const userLogin = await loginIfPossible(user, userEmail, userPassword);
    assertStatusOneOf(userLogin, [200], 'direct user login');
    const isolatedScope = await createDirectCoreScope({ userId, suffix: `user-${suffix}` });
    const isolatedSpaceId = Number(isolatedScope?.spaceId || 0) || null;
    assert(Number.isFinite(Number(isolatedSpaceId)), 'Isolated user space id missing');
    const refreshedUserLogin = await loginIfPossible(user, userEmail, userPassword);
    assertStatusOneOf(refreshedUserLogin, [200], 'user login after direct Core scope bootstrap');
    user.csrfToken = '';

    await user.fetchCsrfToken();
    const userScopeAfterTransfer = await user.request('/api/auth/scope', { expectStatus: 200 });
    const activeUserLibraryId = Number(userScopeAfterTransfer?.data?.active_library_id || 0) || null;
    const activeUserLibrary = (userScopeAfterTransfer?.data?.libraries || []).find((library) => (
      Number(library?.id || 0) === Number(isolatedScope?.libraryId || 0)
    ));
    assert(
      activeUserLibraryId === Number(isolatedScope?.libraryId || 0),
      `Direct user should land in isolated library: ${JSON.stringify(userScopeAfterTransfer?.data)}`
    );
    assert(
      Number(activeUserLibrary?.space_id || 0) === isolatedSpaceId,
      `Direct user library should belong to isolated space: ${JSON.stringify(userScopeAfterTransfer?.data)}`
    );

    const seededLibraryA = await pool.query(
      `INSERT INTO libraries (name, created_by, space_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, description, space_id, created_by, created_at, updated_at`,
      [`RBAC Library A ${suffix}`, adminUserId, targetSpaceId]
    );
    const libraryA = seededLibraryA.rows[0] || null;
    const libraryAId = Number(libraryA?.id || 0) || null;
    assert(Number.isFinite(Number(libraryAId)), 'Library A id missing');
    await pool.query(
      `INSERT INTO library_memberships (user_id, library_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (user_id, library_id) DO NOTHING`,
      [adminUserId, libraryAId]
    );

    await setDirectActiveLibrary({ userId: adminUserId, libraryId: libraryAId });

    await admin.fetchCsrfToken();
    const adminMedia = await admin.request('/api/media', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: { title: 'RBAC Admin Media', year: 2001, format: 'Digital' }
    });
    const adminMediaId = adminMedia?.data?.id;
    const adminMediaLibraryId = Number(adminMedia?.data?.library_id || 0) || null;
    assert(Number.isFinite(Number(adminMediaId)), 'Admin media id missing');
    assert(Number.isFinite(Number(adminMediaLibraryId)), 'Admin media library id missing');

    await user.fetchCsrfToken();
    const deniedPatch = await user.request(`/api/media/${adminMediaId}`, {
      method: 'PATCH',
      withCsrf: true,
      body: { notes: 'should be denied' }
    });
    assertStatusOneOf(deniedPatch, [403, 404], 'user patch admin media');

    const deniedDelete = await user.request(`/api/media/${adminMediaId}`, {
      method: 'DELETE',
      withCsrf: true
    });
    assertStatusOneOf(deniedDelete, [403, 404], 'user delete admin media');

    const userMedia = await user.request('/api/media', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: { title: 'RBAC User Media', year: 2002, format: 'Blu-ray' }
    });
    const userMediaId = userMedia?.data?.id;
    const userMediaLibraryId = Number(userMedia?.data?.library_id || 0) || null;
    assert(Number.isFinite(Number(userMediaId)), 'User media id missing');
    assert(Number.isFinite(Number(userMediaLibraryId)), 'User media library id missing');

    await admin.fetchCsrfToken();
    const libraryB = await admin.request('/api/libraries', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: { name: `RBAC Library B ${suffix}` }
    });
    const libraryBId = Number(libraryB?.data?.id);
    assert(Number.isFinite(libraryBId), 'Library B id missing');
    await setDirectActiveLibrary({ userId: adminUserId, libraryId: libraryBId });
    const libraryBMedia = await admin.request('/api/media', { expectStatus: 200 });
    const libraryBItems = Array.isArray(libraryBMedia?.data?.items) ? libraryBMedia.data.items : [];
    assert(
      !libraryBItems.some((item) => String(item.title) === 'RBAC Admin Media'),
      'Library B should not include media created in library A'
    );

    await setDirectActiveLibrary({ userId: adminUserId, libraryId: libraryAId });
    const libraryAMedia = await admin.request('/api/media', { expectStatus: 200 });
    const libraryAItems = Array.isArray(libraryAMedia?.data?.items) ? libraryAMedia.data.items : [];
    assert(
      libraryAItems.some((item) => Number(item.id) === Number(adminMediaId)),
      'Library A should include admin media'
    );
    assert(
      !libraryAItems.some((item) => Number(item.id) === Number(userMediaId)),
      'Library A should not include user media from separate library context'
    );

  const deniedNonEmptyLibraryDelete = await admin.request(`/api/libraries/${libraryAId}`, {
    method: 'DELETE',
    withCsrf: true,
    body: { confirm_name: `RBAC Library A ${suffix}` }
  });
  assertStatusOneOf(deniedNonEmptyLibraryDelete, [400, 403], 'non-empty or inaccessible library delete should be denied');

  await pool.query(
    `DELETE FROM library_memberships
      WHERE user_id = $1
        AND library_id IN (
          SELECT id FROM libraries WHERE space_id = $2
        )`,
    [userId, targetSpaceId]
  );
  await pool.query(
    `DELETE FROM space_memberships
      WHERE user_id = $1
        AND space_id = $2`,
    [userId, targetSpaceId]
  );

  const deniedCrossTenantTransfer = await admin.request(`/api/libraries/${libraryBId}/transfer`, {
    method: 'POST',
    withCsrf: true,
    body: { new_owner_user_id: Number(userId) }
  });
  assertStatusOneOf(deniedCrossTenantTransfer, [409], 'cross-tenant library transfer should be denied');

  const libraryC = await admin.request('/api/libraries', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 201,
    body: { name: `RBAC Library C ${suffix}` }
  });
  const libraryCId = Number(libraryC?.data?.id);
  assert(Number.isFinite(libraryCId), 'Library C id missing');

  await admin.request(`/api/libraries/${libraryCId}/archive`, {
    method: 'POST',
    withCsrf: true,
    expectStatus: 200,
    body: { confirm_name: `RBAC Library C ${suffix}` }
  });

  const libraryD = await admin.request('/api/libraries', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 201,
    body: { name: `RBAC Library D ${suffix}` }
  });
  const libraryDId = Number(libraryD?.data?.id);
  assert(Number.isFinite(libraryDId), 'Library D id missing');

  await admin.request(`/api/libraries/${libraryDId}`, {
    method: 'DELETE',
    withCsrf: true,
    expectStatus: 200,
    body: { confirm_name: `RBAC Library D ${suffix}` }
  });

  await user.request('/api/auth/scope', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 200,
    body: { library_id: userMediaLibraryId }
  });

  // Create a fresh media row in the currently selected user library so the
  // owner-update assertion is independent of earlier library transitions.
  const userPatchTarget = await user.request('/api/media', {
    method: 'POST',
    withCsrf: true,
    expectStatus: 201,
    body: { title: `RBAC User Patch Target ${suffix}`, year: 2003, format: 'Digital' }
  });
  const userPatchTargetId = Number(userPatchTarget?.data?.id || 0);
  assert(Number.isFinite(userPatchTargetId), 'User patch target id missing');

  await user.request(`/api/media/${userPatchTargetId}`, {
    method: 'PATCH',
    withCsrf: true,
    expectStatus: 200,
    body: { notes: 'owner update allowed' }
  });

  const deniedAdminScope = await admin.request('/api/auth/scope', {
    method: 'POST',
    withCsrf: true,
    body: { library_id: userMediaLibraryId }
  });
  assertStatusOneOf(deniedAdminScope, [403], 'admin selecting user-owned library without membership');

  await admin.fetchCsrfToken();
  const deniedAdminPatch = await admin.request(`/api/media/${userPatchTargetId}`, {
    method: 'PATCH',
    withCsrf: true,
    body: { notes: 'admin override update allowed' }
  });
  assertStatusOneOf(deniedAdminPatch, [403, 404], 'admin patching user-owned media without membership');

  await user.request('/api/admin/activity', { expectStatus: 403 });

  const deniedScope = await user.request('/api/media?space_id=999', { expectStatus: 403 });
  assert(
    deniedScope?.data?.reason === 'hints_not_allowed_for_role',
    `Unexpected scope denial reason: ${JSON.stringify(deniedScope?.data)}`
  );

  const deniedLibraryHint = await user.request(`/api/media?library_id=${libraryAId}`, { expectStatus: 403 });
  assert(
    deniedLibraryHint?.data?.reason === 'hints_not_allowed_for_role',
    `Unexpected library hint denial reason: ${JSON.stringify(deniedLibraryHint?.data)}`
  );

  const coreActivityResponse = await admin.request('/api/admin/activity?space_id=999');
  assertStatusOneOf(coreActivityResponse, [404], 'Core admin activity route should stay outside the app boundary');

  await user.request(`/api/media/${userPatchTargetId}`, {
    method: 'DELETE',
    withCsrf: true,
    expectStatus: 200
  });

  await setDirectActiveLibrary({ userId: adminUserId, libraryId: adminMediaLibraryId });
  await admin.request(`/api/media/${adminMediaId}`, {
    method: 'DELETE',
    withCsrf: true,
    expectStatus: 200
  });

  console.log('RBAC regression checks passed');
  } finally {
    if (tempAdminUserId) {
      await deleteDirectUser(tempAdminUserId).catch(() => {});
    }
    if (userId) {
      await deleteDirectUser(userId).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
