#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const VERIFY_REAUTH_RATE_LIMIT = process.env.VERIFY_REAUTH_RATE_LIMIT === 'true';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class HttpClient {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
    this.csrfToken = '';
  }

  applySetCookies(headers) {
    const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const line of values) {
      const [pair] = String(line).split(';');
      const separator = pair.indexOf('=');
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }

  cookieHeader() {
    return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async request(path, { method = 'GET', body, withCsrf = false, bearer } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (withCsrf) {
      if (!this.csrfToken) await this.fetchCsrf();
      headers['x-csrf-token'] = this.csrfToken;
    }
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    this.applySetCookies(response.headers);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, data };
  }

  async fetchCsrf() {
    const response = await this.request('/api/auth/csrf-token');
    assert(response.status === 200 && response.data?.csrfToken, `${this.name} could not get CSRF proof`);
    this.csrfToken = response.data.csrfToken;
  }
}

async function login(client, email, password) {
  await client.fetchCsrf();
  const response = await client.request('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    withCsrf: true
  });
  assert(response.status === 200, `${client.name} login failed: ${response.status}`);
}

async function main() {
  const startedAt = new Date();
  const suffix = `${Date.now()}-${crypto.randomInt(100000, 999999)}`;
  const email = `reauth-${suffix}@example.invalid`;
  const password = `R!${crypto.randomBytes(24).toString('base64url')}`;
  const invalidCredentialAttempt = `W!${crypto.randomBytes(24).toString('base64url')}`;
  const passwordHash = await bcrypt.hash(password, 12);
  let userId = null;
  let spaceId = null;
  let libraryId = null;
  let rawPat = '';

  try {
    const user = await pool.query(
      `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
       VALUES ($1, $2, 'Recent Proof Fixture', 'admin', true, NOW())
       RETURNING id`,
      [email, passwordHash]
    );
    userId = Number(user.rows[0].id);
    const space = await pool.query(
      `INSERT INTO spaces (name, slug, created_by, is_personal)
       VALUES ($1, $2, $3, false) RETURNING id`,
      [`Recent Proof ${suffix}`, `recent-proof-${suffix}`, userId]
    );
    spaceId = Number(space.rows[0].id);
    const library = await pool.query(
      `INSERT INTO libraries (name, created_by, space_id)
       VALUES ('Recent Proof Library', $1, $2) RETURNING id`,
      [userId, spaceId]
    );
    libraryId = Number(library.rows[0].id);

    const current = new HttpClient('current-session');
    const sibling = new HttpClient('sibling-session');
    await login(current, email, password);
    await login(sibling, email, password);
    await current.fetchCsrf();
    await sibling.fetchCsrf();

    await pool.query(
      `UPDATE user_sessions SET reauthenticated_at = NOW() - INTERVAL '1 day' WHERE user_id = $1`,
      [userId]
    );

    const safeStatus = await current.request('/api/auth/personal-access-tokens');
    assert(safeStatus.status === 200, `Safe credential status failed: ${safeStatus.status}`);
    assert(!JSON.stringify(safeStatus.data).includes('token_hash'), 'Safe credential status exposed a stored token hash');
    const safeIntegrationStatus = await current.request('/api/admin/settings/integrations');
    assert(safeIntegrationStatus.status === 200, `Safe integration status failed: ${safeIntegrationStatus.status}`);
    assert(!JSON.stringify(safeIntegrationStatus.data).includes('_encrypted'), 'Safe integration status exposed encrypted credential storage');

    const staleIntegrationMutation = await current.request('/api/admin/settings/integrations', {
      method: 'PUT',
      body: {},
      withCsrf: true
    });
    assert(staleIntegrationMutation.status === 403 && staleIntegrationMutation.data?.code === 'recent_reauthentication_required', 'Stale integration credential mutation was not rejected');
    const staleProviderTest = await current.request('/api/admin/settings/integrations/test-books', {
      method: 'POST',
      body: { title: 'Recent proof check' },
      withCsrf: true
    });
    assert(staleProviderTest.status === 403 && staleProviderTest.data?.code === 'recent_reauthentication_required', 'Stale provider credential test was not rejected');

    const tokenCountBefore = await pool.query('SELECT COUNT(*)::int AS count FROM personal_access_tokens WHERE user_id = $1', [userId]);
    const staleCreate = await current.request('/api/auth/personal-access-tokens', {
      method: 'POST',
      body: { name: 'stale-denied', scopes: ['media:read'], expires_at: null },
      withCsrf: true
    });
    assert(staleCreate.status === 403 && staleCreate.data?.code === 'recent_reauthentication_required', 'Stale session was not rejected');
    const tokenCountAfterStale = await pool.query('SELECT COUNT(*)::int AS count FROM personal_access_tokens WHERE user_id = $1', [userId]);
    assert(tokenCountAfterStale.rows[0].count === tokenCountBefore.rows[0].count, 'Stale rejection mutated credential state');

    const csrfFailure = await current.request('/api/auth/reauthenticate', {
      method: 'POST',
      body: { password }
    });
    assert(csrfFailure.status === 403, `Reauthentication without CSRF returned ${csrfFailure.status}`);
    const invalidProof = await current.request('/api/auth/reauthenticate', {
      method: 'POST',
      body: { password: invalidCredentialAttempt },
      withCsrf: true
    });
    assert(invalidProof.status === 401, `Invalid password proof returned ${invalidProof.status}`);
    const validProof = await current.request('/api/auth/reauthenticate', {
      method: 'POST',
      body: { password },
      withCsrf: true
    });
    assert(validProof.status === 200 && validProof.data?.reauthenticated === true, 'Valid password proof failed');

    const created = await current.request('/api/auth/personal-access-tokens', {
      method: 'POST',
      body: { name: 'recent-proof', scopes: ['media:read'], expires_at: null },
      withCsrf: true
    });
    assert(created.status === 201 && created.data?.token, `Recent session could not create PAT: ${created.status}`);
    rawPat = created.data.token;

    const siblingDenied = await sibling.request('/api/auth/personal-access-tokens', {
      method: 'POST',
      body: { name: 'sibling-denied', scopes: ['media:read'], expires_at: null },
      withCsrf: true
    });
    assert(siblingDenied.status === 403, 'Sibling session reused another session proof');

    const bearerClient = new HttpClient('non-session');
    const bearerDenied = await bearerClient.request('/api/auth/reauthenticate', {
      method: 'POST',
      body: { password },
      bearer: rawPat
    });
    assert([401, 403].includes(bearerDenied.status), `Non-session reauthentication returned ${bearerDenied.status}`);

    const staleSupport = await sibling.request('/api/auth/support-session/start', {
      method: 'POST',
      body: { space_id: spaceId, library_id: libraryId, reason: 'stale proof check' },
      withCsrf: true
    });
    assert(staleSupport.status === 403, 'Stale support-session delegation was allowed');
    const siblingCookie = sibling.cookies.get(process.env.SESSION_COOKIE_NAME || 'session_token');
    const siblingState = await pool.query(
      `SELECT support_space_id FROM user_sessions WHERE token_hash = encode(digest($1, 'sha256'), 'hex')`,
      [siblingCookie]
    );
    assert(siblingState.rows[0]?.support_space_id === null, 'Rejected support delegation mutated session scope');

    const supportStarted = await current.request('/api/auth/support-session/start', {
      method: 'POST',
      body: { space_id: spaceId, library_id: libraryId, reason: 'recent proof check' },
      withCsrf: true
    });
    assert(supportStarted.status === 200 && supportStarted.data?.support_session?.active === true, 'Recent support-session delegation failed');

    let limiterVerified = false;
    if (VERIFY_REAUTH_RATE_LIMIT) {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const limited = await current.request('/api/auth/reauthenticate', {
          method: 'POST',
          body: { password: invalidCredentialAttempt },
          withCsrf: true
        });
        if (limited.status === 429) {
          limiterVerified = true;
          break;
        }
      }
      assert(limiterVerified, 'Reauthentication endpoint did not reach the authentication limiter');
    }

    const audits = await pool.query(
      `SELECT details::text AS details
         FROM activity_log
        WHERE created_at >= $1
          AND action LIKE 'auth.reauthentication.%'`,
      [startedAt]
    );
    const retainedAudit = audits.rows.map((row) => row.details || '').join('\n');
    assert(!retainedAudit.includes(password), 'Submitted password appeared in audit details');
    assert(!retainedAudit.includes(invalidCredentialAttempt), 'Rejected password appeared in audit details');
    assert(!retainedAudit.includes(rawPat), 'Returned token appeared in reauthentication audit details');

    console.log(JSON.stringify({
      status: 'passed',
      safeStatusReadback: true,
      integrationCredentialGuardVerified: true,
      staleMutationDenied: true,
      csrfNonMutationVerified: true,
      invalidPasswordDenied: true,
      currentSessionProofAccepted: true,
      siblingSessionIsolationVerified: true,
      nonSessionCredentialDenied: true,
      supportDelegationNonMutationVerified: true,
      reauthenticationRateLimitVerified: VERIFY_REAUTH_RATE_LIMIT ? limiterVerified : 'not-requested',
      sensitiveAuditLeakCount: 0
    }));
  } finally {
    if (userId) {
      await pool.query('DELETE FROM activity_log WHERE user_id = $1', [userId]).catch(() => {});
      await pool.query('DELETE FROM spaces WHERE id = $1', [spaceId]).catch(() => {});
      await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
