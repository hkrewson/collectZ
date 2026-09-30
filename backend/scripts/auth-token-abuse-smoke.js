#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { hashInviteToken } = require('../services/invites');
const { issuePasswordResetToken } = require('../services/passwordResets');
const { issueEmailVerificationToken } = require('../services/emailVerifications');
const { AUTH_AUDIT_DETAIL_SCHEMAS, isSensitiveAuditAction } = require('../services/authAuditContract');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'session_token';
const VERIFY_AUTH_RATE_LIMIT = process.env.VERIFY_AUTH_RATE_LIMIT === 'true';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function randomSecret(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url');
}

class HttpClient {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
    this.csrfToken = '';
  }

  applySetCookies(headers) {
    const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const cookieLine of raw) {
      const [pair] = String(cookieLine).split(';');
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }

  cookieHeader() {
    return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async request(path, { method = 'GET', body, withCsrf = false } = {}) {
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
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    this.applySetCookies(response.headers);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, data };
  }

  async fetchCsrfToken() {
    const response = await this.request('/api/auth/csrf-token');
    assert(response.status === 200 && response.data?.csrfToken, `${this.name} could not fetch CSRF token`);
    this.csrfToken = response.data.csrfToken;
  }
}

async function createUser({ email, password, name, verified = true }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, $3, 'user', $4, CASE WHEN $4 THEN NOW() ELSE NULL END)
     RETURNING id`,
    [email, passwordHash, name, verified]
  );
  return Number(result.rows[0].id);
}

async function createInvite({ email, spaceId, createdBy, state = 'active' }) {
  const token = randomSecret(32);
  const expiresAt = state === 'expired'
    ? new Date(Date.now() - 60_000)
    : new Date(Date.now() + 60 * 60 * 1000);
  const result = await pool.query(
    `INSERT INTO invites (email, token_hash, expires_at, created_by, space_id, space_role, revoked)
     VALUES ($1, $2, $3, $4, $5, 'member', $6)
     RETURNING id`,
    [email, hashInviteToken(token), expiresAt, createdBy, spaceId, state === 'revoked']
  );
  return { id: Number(result.rows[0].id), token };
}

async function login(client, email, password) {
  await client.fetchCsrfToken();
  const response = await client.request('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    withCsrf: true
  });
  assert(response.status === 200, `${client.name} login failed with ${response.status}`);
}

async function main() {
  const startedAt = new Date();
  const suffix = `${Date.now()}-${crypto.randomInt(100000, 999999)}`;
  const password = `A!${randomSecret(18)}`;
  const resetPasswords = [`B!${randomSecret(18)}`, `C!${randomSecret(18)}`];
  const invitedEmail = `auth-invite-${suffix}@example.invalid`;
  const resetEmail = `auth-reset-${suffix}@example.invalid`;
  const mismatchEmail = `auth-mismatch-${suffix}@example.invalid`;
  const verificationEmail = `auth-verify-${suffix}@example.invalid`;
  const ownerEmail = `auth-owner-${suffix}@example.invalid`;
  const fixtureUserIds = [];
  let fixtureSpaceId = null;
  let fixtureLibraryId = null;

  try {
    const ownerId = await createUser({
      email: ownerEmail,
      password,
      name: 'Auth Abuse Owner'
    });
    fixtureUserIds.push(ownerId);
    const resetUserId = await createUser({ email: resetEmail, password, name: 'Auth Abuse Reset User' });
    fixtureUserIds.push(resetUserId);
    const verificationUserId = await createUser({
      email: verificationEmail,
      password,
      name: 'Auth Abuse Verification User',
      verified: false
    });
    fixtureUserIds.push(verificationUserId);

    const space = await pool.query(
      `INSERT INTO spaces (name, slug, created_by, is_personal)
       VALUES ($1, $2, $3, false)
       RETURNING id`,
      [`Auth Abuse ${suffix}`, `auth-abuse-${suffix}`, ownerId]
    );
    fixtureSpaceId = Number(space.rows[0].id);
    const library = await pool.query(
      `INSERT INTO libraries (name, created_by, space_id)
       VALUES ('Auth Abuse Library', $1, $2)
       RETURNING id`,
      [ownerId, fixtureSpaceId]
    );
    fixtureLibraryId = Number(library.rows[0].id);
    await pool.query(
      `INSERT INTO space_memberships (space_id, user_id, role, created_by)
       VALUES ($1, $2, 'owner', $2), ($1, $3, 'member', $2), ($1, $4, 'member', $2)`,
      [fixtureSpaceId, ownerId, resetUserId, verificationUserId]
    );
    await pool.query(
      `INSERT INTO library_memberships (user_id, library_id, role)
       VALUES ($1, $4, 'owner'), ($2, $4, 'member'), ($3, $4, 'member')`,
      [ownerId, resetUserId, verificationUserId, fixtureLibraryId]
    );

    const ownerClient = new HttpClient('invite-owner');
    await login(ownerClient, ownerEmail, password);
    await ownerClient.fetchCsrfToken();

    const inviteCountBeforeCsrf = await pool.query(
      'SELECT COUNT(*)::int AS count FROM invites WHERE space_id = $1',
      [fixtureSpaceId]
    );
    const inviteCreateCsrfFailure = await ownerClient.request(`/api/spaces/${fixtureSpaceId}/invites`, {
      method: 'POST',
      body: { email: `csrf-create-${suffix}@example.invalid`, role: 'member' }
    });
    assert(inviteCreateCsrfFailure.status === 403, `Invite create without CSRF returned ${inviteCreateCsrfFailure.status}`);
    const inviteCountAfterCsrf = await pool.query(
      'SELECT COUNT(*)::int AS count FROM invites WHERE space_id = $1',
      [fixtureSpaceId]
    );
    assert(
      inviteCountAfterCsrf.rows[0].count === inviteCountBeforeCsrf.rows[0].count,
      'CSRF rejection created an invitation row'
    );

    const revokeCsrfInvite = await createInvite({
      email: `csrf-revoke-${suffix}@example.invalid`,
      spaceId: fixtureSpaceId,
      createdBy: ownerId
    });
    const inviteRevokeCsrfFailure = await ownerClient.request(
      `/api/spaces/${fixtureSpaceId}/invites/${revokeCsrfInvite.id}/revoke`,
      { method: 'PATCH' }
    );
    assert(inviteRevokeCsrfFailure.status === 403, `Invite revoke without CSRF returned ${inviteRevokeCsrfFailure.status}`);
    const revokeCsrfState = await pool.query('SELECT revoked FROM invites WHERE id = $1', [revokeCsrfInvite.id]);
    assert(revokeCsrfState.rows[0]?.revoked === false, 'CSRF rejection revoked an invitation');

    const oldSessionA = new HttpClient('old-session-a');
    const oldSessionB = new HttpClient('old-session-b');
    await login(oldSessionA, resetEmail, password);
    await login(oldSessionB, resetEmail, password);

    const csrfFailureToken = await issuePasswordResetToken({ userId: resetUserId });
    const csrfFailure = await oldSessionA.request('/api/auth/password-reset/consume', {
      method: 'POST',
      body: { token: csrfFailureToken.token, password: resetPasswords[0] }
    });
    assert(csrfFailure.status === 403, `Password reset with a session cookie and no CSRF header returned ${csrfFailure.status}`);
    const csrfTokenState = await pool.query('SELECT used FROM password_reset_tokens WHERE id = $1', [csrfFailureToken.id]);
    assert(csrfTokenState.rows[0]?.used === false, 'CSRF rejection consumed the reset token');

    const reset = await issuePasswordResetToken({ userId: resetUserId });
    const resetClients = [new HttpClient('reset-a'), new HttpClient('reset-b')];
    const resetResponses = await Promise.all(resetClients.map((client, index) => client.request('/api/auth/password-reset/consume', {
      method: 'POST',
      body: { token: reset.token, password: resetPasswords[index] }
    })));
    assert(resetResponses.filter(({ status }) => status === 200).length === 1, `Concurrent reset success count was not one: ${resetResponses.map(({ status }) => status).join(',')}`);
    assert(resetResponses.filter(({ status }) => status === 400).length === 1, `Concurrent reset rejection count was not one: ${resetResponses.map(({ status }) => status).join(',')}`);

    const winningResetIndex = resetResponses.findIndex(({ status }) => status === 200);
    const passwordState = await pool.query('SELECT password FROM users WHERE id = $1', [resetUserId]);
    assert(await bcrypt.compare(resetPasswords[winningResetIndex], passwordState.rows[0].password), 'Winning reset password was not committed');
    assert(!(await bcrypt.compare(resetPasswords[1 - winningResetIndex], passwordState.rows[0].password)), 'Losing reset password was committed');
    const sessionCount = await pool.query('SELECT COUNT(*)::int AS count FROM user_sessions WHERE user_id = $1', [resetUserId]);
    assert(sessionCount.rows[0].count === 1, `Reset should leave exactly one replacement session, found ${sessionCount.rows[0].count}`);
    for (const oldClient of [oldSessionA, oldSessionB]) {
      const me = await oldClient.request('/api/auth/me');
      assert(me.status === 401, `${oldClient.name} survived reset session revocation`);
    }
    const replay = await new HttpClient('reset-replay').request('/api/auth/password-reset/consume', {
      method: 'POST',
      body: { token: reset.token, password: `D!${randomSecret(18)}` }
    });
    assert(replay.status === 400, `Reset replay returned ${replay.status}`);

    const verification = await issueEmailVerificationToken({ userId: verificationUserId });
    const verificationResponses = await Promise.all([
      new HttpClient('verification-a').request('/api/auth/email-verification/consume', {
        method: 'POST',
        body: { token: verification.token }
      }),
      new HttpClient('verification-b').request('/api/auth/email-verification/consume', {
        method: 'POST',
        body: { token: verification.token }
      })
    ]);
    assert(verificationResponses.filter(({ status }) => status === 200).length === 1, `Concurrent verification success count was not one: ${verificationResponses.map(({ status }) => status).join(',')}`);
    assert(verificationResponses.filter(({ status }) => status === 400).length === 1, `Concurrent verification rejection count was not one: ${verificationResponses.map(({ status }) => status).join(',')}`);
    const verificationState = await pool.query(
      `SELECT u.email_verified, COUNT(s.id)::int AS session_count
       FROM users u
       LEFT JOIN user_sessions s ON s.user_id = u.id
       WHERE u.id = $1
       GROUP BY u.id`,
      [verificationUserId]
    );
    assert(verificationState.rows[0]?.email_verified === true, 'Winning verification did not verify the user');
    assert(verificationState.rows[0]?.session_count === 1, `Verification should leave one session, found ${verificationState.rows[0]?.session_count}`);

    const invite = await createInvite({ email: invitedEmail, spaceId: fixtureSpaceId, createdBy: ownerId });
    const registrationPayload = { email: invitedEmail, name: 'Concurrent Invite User', password, inviteToken: invite.token };
    const inviteResponses = await Promise.all([
      new HttpClient('invite-a').request('/api/auth/register', { method: 'POST', body: registrationPayload }),
      new HttpClient('invite-b').request('/api/auth/register', { method: 'POST', body: registrationPayload })
    ]);
    assert(inviteResponses.filter(({ status }) => status === 200).length === 1, `Concurrent invite success count was not one: ${inviteResponses.map(({ status }) => status).join(',')}`);
    assert(inviteResponses.filter(({ status }) => status === 400).length === 1, `Concurrent invite rejection count was not one: ${inviteResponses.map(({ status }) => status).join(',')}`);
    const invitedUser = await pool.query('SELECT id FROM users WHERE lower(email) = lower($1)', [invitedEmail]);
    assert(invitedUser.rows.length === 1, `Invite concurrency created ${invitedUser.rows.length} users`);
    fixtureUserIds.push(Number(invitedUser.rows[0].id));
    const inviteState = await pool.query('SELECT used, used_by FROM invites WHERE id = $1', [invite.id]);
    assert(inviteState.rows[0]?.used === true && Number(inviteState.rows[0]?.used_by) === Number(invitedUser.rows[0].id), 'Invite claim state did not commit atomically');
    const inviteMembership = await pool.query(
      'SELECT role FROM space_memberships WHERE space_id = $1 AND user_id = $2',
      [fixtureSpaceId, invitedUser.rows[0].id]
    );
    assert(inviteMembership.rows[0]?.role === 'member', 'Invite membership did not commit with the claim');

    const replayInvite = await new HttpClient('invite-replay').request('/api/auth/register', {
      method: 'POST',
      body: { ...registrationPayload, email: `auth-replay-${suffix}@example.invalid` }
    });
    assert(replayInvite.status === 400, `Invite replay returned ${replayInvite.status}`);

    for (const state of ['expired', 'revoked']) {
      const stateEmail = `auth-${state}-${suffix}@example.invalid`;
      const stateInvite = await createInvite({ email: stateEmail, spaceId: fixtureSpaceId, createdBy: ownerId, state });
      const response = await new HttpClient(`invite-${state}`).request('/api/auth/register', {
        method: 'POST',
        body: { email: stateEmail, name: `Invite ${state}`, password, inviteToken: stateInvite.token }
      });
      assert(response.status === 400, `${state} invite returned ${response.status}`);
    }
    const mismatchInvite = await createInvite({ email: mismatchEmail, spaceId: fixtureSpaceId, createdBy: ownerId });
    const mismatch = await new HttpClient('invite-mismatch').request('/api/auth/register', {
      method: 'POST',
      body: { email: `wrong-${mismatchEmail}`, name: 'Invite Mismatch', password, inviteToken: mismatchInvite.token }
    });
    assert(mismatch.status === 400, `Mismatched invite returned ${mismatch.status}`);
    const mismatchState = await pool.query('SELECT used FROM invites WHERE id = $1', [mismatchInvite.id]);
    assert(mismatchState.rows[0]?.used === false, 'Mismatched invite was consumed');

    const malformedReset = await new HttpClient('reset-malformed').request('/api/auth/password-reset/consume', {
      method: 'POST',
      body: { token: 'malformed-reset-token', password: `E!${randomSecret(18)}` }
    });
    assert(malformedReset.status === 400, `Malformed reset token returned ${malformedReset.status}`);
    for (const state of ['expired', 'revoked']) {
      const stateReset = await issuePasswordResetToken({ userId: resetUserId });
      await pool.query(
        state === 'expired'
          ? 'UPDATE password_reset_tokens SET expires_at = NOW() - INTERVAL \'1 minute\' WHERE id = $1'
          : 'UPDATE password_reset_tokens SET revoked = true WHERE id = $1',
        [stateReset.id]
      );
      const response = await new HttpClient(`reset-${state}`).request('/api/auth/password-reset/consume', {
        method: 'POST',
        body: { token: stateReset.token, password: `F!${randomSecret(18)}` }
      });
      assert(response.status === 400, `${state} reset token returned ${response.status}`);
    }

    const genericKnown = await new HttpClient('reset-request-known').request('/api/auth/password-reset/request', {
      method: 'POST',
      body: { email: resetEmail }
    });
    const genericUnknown = await new HttpClient('reset-request-unknown').request('/api/auth/password-reset/request', {
      method: 'POST',
      body: { email: `unknown-${suffix}@example.invalid` }
    });
    assert(genericKnown.status === 200 && genericUnknown.status === 200, 'Reset request enumeration responses did not share status 200');
    assert(genericKnown.data?.message === genericUnknown.data?.message, 'Reset request enumeration responses did not share the same message');

    let resetRateLimitVerified = false;
    let inviteRateLimitVerified = false;
    if (VERIFY_AUTH_RATE_LIMIT) {
      const rateClient = new HttpClient('reset-rate-limit');
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const response = await rateClient.request('/api/auth/password-reset/request', {
          method: 'POST',
          body: { email: `rate-${attempt}-${suffix}@example.invalid` }
        });
        if (response.status === 429) {
          resetRateLimitVerified = true;
          break;
        }
        assert(response.status === 200, `Reset rate-limit probe returned unexpected ${response.status}`);
      }
      assert(resetRateLimitVerified, 'Password reset request did not reach the focused authentication rate limit');

      for (let attempt = 0; attempt < 20; attempt += 1) {
        const response = await ownerClient.request(`/api/spaces/${fixtureSpaceId}/invites`, {
          method: 'POST',
          body: {},
          withCsrf: true
        });
        if (response.status === 429) {
          inviteRateLimitVerified = true;
          break;
        }
        assert(response.status === 400, `Invitation rate-limit probe returned unexpected ${response.status}`);
      }
      assert(inviteRateLimitVerified, 'Invitation mutations did not reach the focused invitation rate limit');
    }

    const secretCandidates = [
      password,
      ...resetPasswords,
      csrfFailureToken.token,
      csrfFailureToken.token_hash,
      reset.token,
      reset.token_hash,
      verification.token,
      verification.token_hash,
      revokeCsrfInvite.token,
      hashInviteToken(revokeCsrfInvite.token),
      invite.token,
      hashInviteToken(invite.token),
      mismatchInvite.token,
      hashInviteToken(mismatchInvite.token),
      ownerEmail,
      invitedEmail,
      resetEmail,
      mismatchEmail,
      verificationEmail
    ];
    for (const candidate of secretCandidates) {
      const leaked = await pool.query('SELECT COUNT(*)::int AS count FROM activity_log WHERE details::text LIKE $1', [`%${candidate}%`]);
      assert(leaked.rows[0].count === 0, 'Authentication audit details contained tested sensitive material');
    }

    const authAuditRows = await pool.query(
      `SELECT action, details
       FROM activity_log
       WHERE created_at >= $1
         AND (
           action LIKE 'auth.%'
           OR action LIKE 'space.invite.%'
           OR action LIKE 'space.member.%'
           OR action IN ('invite.claimed', 'library.transfer', 'scope.access.denied', 'security.csrf.failed', 'space.create', 'workspace.create.personal')
         )`,
      [startedAt]
    );
    for (const row of authAuditRows.rows) {
      assert(isSensitiveAuditAction(row.action), `Sensitive audit action classification missed ${row.action}`);
      const contract = AUTH_AUDIT_DETAIL_SCHEMAS[row.action];
      assert(contract, `Sensitive audit action is not cataloged: ${row.action}`);
      for (const key of Object.keys(row.details || {})) {
        assert(Object.prototype.hasOwnProperty.call(contract, key), `Audit action ${row.action} persisted unexpected key ${key}`);
      }
    }

    const replacementClient = resetClients[winningResetIndex];
    assert(Boolean(replacementClient.cookies.get(SESSION_COOKIE_NAME)), 'Winning reset did not receive a replacement session');

    console.log(JSON.stringify({
      status: 'passed',
      resetConcurrentStatuses: resetResponses.map(({ status }) => status).sort(),
      inviteConcurrentStatuses: inviteResponses.map(({ status }) => status).sort(),
      verificationConcurrentStatuses: verificationResponses.map(({ status }) => status).sort(),
      resetReplayRejected: true,
      inviteReplayRejected: true,
      csrfRejectedWithoutTokenConsumption: true,
      priorSessionsRevoked: true,
      expiredRevokedMalformedAndMismatchedRejected: true,
      enumerationResponseStable: true,
      resetRateLimitVerified: VERIFY_AUTH_RATE_LIMIT ? resetRateLimitVerified : 'not-requested',
      inviteRateLimitVerified: VERIFY_AUTH_RATE_LIMIT ? inviteRateLimitVerified : 'not-requested',
      inviteCreateCsrfNonMutationVerified: true,
      inviteRevokeCsrfNonMutationVerified: true,
      authAuditAllowlistRowsVerified: authAuditRows.rows.length,
      auditSensitiveValueLeakCount: 0
    }));
  } finally {
    if (fixtureSpaceId) {
      await pool.query('DELETE FROM invites WHERE space_id = $1', [fixtureSpaceId]).catch(() => {});
    }
    for (const userId of fixtureUserIds.slice().reverse()) {
      await pool.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]).catch(() => {});
      await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]).catch(() => {});
      await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]).catch(() => {});
      await pool.query('DELETE FROM library_memberships WHERE user_id = $1', [userId]).catch(() => {});
      await pool.query('DELETE FROM space_memberships WHERE user_id = $1', [userId]).catch(() => {});
      await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
    }
    if (fixtureLibraryId) await pool.query('DELETE FROM libraries WHERE id = $1', [fixtureLibraryId]).catch(() => {});
    if (fixtureSpaceId) await pool.query('DELETE FROM spaces WHERE id = $1', [fixtureSpaceId]).catch(() => {});
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Auth token abuse smoke failed: ${error.message}`);
  process.exitCode = 1;
});
