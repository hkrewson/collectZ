#!/usr/bin/env node

'use strict';

const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { ensureUserDefaultScope } = require('../services/libraries');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function request(path, { method = 'GET', token = '', body = undefined, expectStatus = undefined } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (expectStatus !== undefined && response.status !== expectStatus) {
    throw new Error(`${method} ${path} expected ${expectStatus}, got ${response.status}: ${JSON.stringify(data)}`);
  }
  return { status: response.status, data };
}

async function createSmokeUser({ suffix, verified = true }) {
  const password = `MobileSmoke-${suffix}!`;
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, $3, 'user', $4, CASE WHEN $4 THEN NOW() ELSE NULL END)
     RETURNING id, email`,
    [`mobile-auth-smoke-${verified ? 'verified' : 'unverified'}-${suffix}@example.com`, passwordHash, 'Mobile Auth Smoke', verified]
  );
  const userId = Number(result.rows[0]?.id || 0);
  const scope = await ensureUserDefaultScope(userId);
  await pool.query(
    `UPDATE users
        SET active_library_id = COALESCE($2, active_library_id),
            active_space_id = COALESCE($3, active_space_id)
      WHERE id = $1`,
    [userId, scope.libraryId || null, scope.spaceId || null]
  );
  if (scope.spaceId) {
    await pool.query(
      `INSERT INTO space_memberships (space_id, user_id, role, created_by)
       VALUES ($1, $2, 'owner', $2)
       ON CONFLICT (space_id, user_id) DO NOTHING`,
      [scope.spaceId, userId]
    );
  }
  if (scope.libraryId) {
    await pool.query(
      `INSERT INTO library_memberships (user_id, library_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (user_id, library_id) DO NOTHING`,
      [userId, scope.libraryId]
    );
  }
  return { userId, email: result.rows[0].email, password, ...scope };
}

async function cleanup(users) {
  for (const user of users.filter(Boolean)) {
    await pool.query('DELETE FROM mobile_auth_sessions WHERE user_id = $1', [user.userId]).catch(() => {});
    if (user.libraryId) {
      await pool.query('DELETE FROM capture_items WHERE library_id = $1', [user.libraryId]).catch(() => {});
      await pool.query('DELETE FROM library_memberships WHERE library_id = $1', [user.libraryId]).catch(() => {});
      await pool.query('DELETE FROM libraries WHERE id = $1', [user.libraryId]).catch(() => {});
    }
    if (user.spaceId) {
      await pool.query('DELETE FROM space_memberships WHERE space_id = $1', [user.spaceId]).catch(() => {});
      await pool.query('DELETE FROM spaces WHERE id = $1', [user.spaceId]).catch(() => {});
    }
    await pool.query('DELETE FROM users WHERE id = $1', [user.userId]).catch(() => {});
  }
}

async function main() {
  console.log(`Running mobile auth smoke against ${BASE_URL}`);
  const suffix = Date.now();
  const verifiedUser = await createSmokeUser({ suffix, verified: true });
  const unverifiedUser = await createSmokeUser({ suffix, verified: false });

  try {
    await request('/api/mobile/auth/login', {
      method: 'POST',
      body: { email: verifiedUser.email, password: 'wrong-password' },
      expectStatus: 401
    });

    const unverifiedLogin = await request('/api/mobile/auth/login', {
      method: 'POST',
      body: { email: unverifiedUser.email, password: unverifiedUser.password }
    });
    assert([200, 403].includes(unverifiedLogin.status), `unverified mobile login returned unexpected status ${unverifiedLogin.status}`);

    const login = await request('/api/mobile/auth/login', {
      method: 'POST',
      body: {
        email: verifiedUser.email,
        password: verifiedUser.password,
        device_name: 'iOS Smoke Scanner',
        platform: 'ios',
        app_version: 'smoke'
      },
      expectStatus: 200
    });
    assert(login.data?.accessToken, 'mobile login missing accessToken');
    assert(login.data?.refreshToken, 'mobile login missing refreshToken');
    assert(Array.isArray(login.data?.scope) && login.data.scope.includes('capture:write'), 'mobile login missing capture:write');

    const accessToken = login.data.accessToken;
    const refreshToken = login.data.refreshToken;

    const me = await request('/api/auth/me', { token: accessToken, expectStatus: 200 });
    assert(me.data?.email === verifiedUser.email, 'mobile access token could not read /api/auth/me');

    const session = await request('/api/mobile/auth/session', { token: accessToken, expectStatus: 200 });
    assert(session.data?.capabilities?.provider_enrichment === false, 'mobile session should not advertise provider enrichment');
    assert(session.data?.capabilities?.media_import === false, 'mobile session should not advertise media import');

    await request('/api/capture-items', { token: accessToken, expectStatus: 200 });
    const capture = await request('/api/capture-items', {
      method: 'POST',
      token: accessToken,
      body: {
        capture_type: 'barcode',
        object_type: 'movie',
        barcode: '012345678905',
        symbology: 'upca',
        client_capture_id: `mobile-auth-smoke-${suffix}`,
        client_source: 'ios-scanner',
        source_context: {
          source: 'scanner',
          client_source: 'ios-scanner',
          platform: 'ios'
        }
      },
      expectStatus: 201
    });
    assert(capture.data?.item?.client_source === 'ios-scanner', 'mobile capture did not preserve client source');

    await request('/api/media/import-barcode', {
      method: 'POST',
      token: accessToken,
      body: { barcode: '012345678905' },
      expectStatus: 403
    });
    await request('/api/admin/users', { token: accessToken, expectStatus: 403 });

    const refreshed = await request('/api/mobile/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      expectStatus: 200
    });
    assert(refreshed.data?.accessToken && refreshed.data.accessToken !== accessToken, 'mobile refresh did not rotate access token');
    assert(refreshed.data?.refreshToken && refreshed.data.refreshToken !== refreshToken, 'mobile refresh did not rotate refresh token');
    await request('/api/mobile/auth/session', { token: refreshed.data.accessToken, expectStatus: 200 });
    await request('/api/mobile/auth/session', { token: accessToken, expectStatus: 401 });

    await pool.query(
      `UPDATE mobile_auth_sessions
          SET expires_at = NOW() - INTERVAL '1 minute'
        WHERE user_id = $1`,
      [verifiedUser.userId]
    );
    await request('/api/mobile/auth/session', { token: refreshed.data.accessToken, expectStatus: 401 });

    const relogin = await request('/api/mobile/auth/login', {
      method: 'POST',
      body: { email: verifiedUser.email, password: verifiedUser.password },
      expectStatus: 200
    });
    await request('/api/mobile/auth/logout', {
      method: 'POST',
      token: relogin.data.accessToken,
      body: { refreshToken: relogin.data.refreshToken },
      expectStatus: 200
    });
    await request('/api/mobile/auth/session', { token: relogin.data.accessToken, expectStatus: 401 });
    await request('/api/mobile/auth/refresh', {
      method: 'POST',
      body: { refreshToken: relogin.data.refreshToken },
      expectStatus: 401
    });

    console.log('Mobile auth smoke passed');
  } finally {
    await cleanup([verifiedUser, unverifiedUser]);
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error(error.stack || error.message || error);
  await pool.end().catch(() => {});
  process.exit(1);
});
