const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken, requireRole, requireSessionAuth, SESSION_COOKIE_OPTIONS } = require('../middleware/auth');
const { validate, registerSchema, loginSchema, profileUpdateSchema, passwordResetConsumeSchema, personalAccessTokenCreateSchema, serviceAccountKeyCreateSchema, authScopeSelectSchema } = require('../middleware/validate');
const { createSession, revokeSessionByToken, revokeSessionsForUser, getSessionUserByToken } = require('../services/sessions');
const { logActivity } = require('../services/audit');
const { issueCsrfToken, clearCsrfToken } = require('../middleware/csrf');
const { hashInviteToken } = require('../services/invites');
const { ensureUserDefaultScope, getAccessibleLibrary, listLibrariesForSpace } = require('../services/libraries');
const { listAccessibleSpacesForUser, getAccessibleSpaceForUser } = require('../services/spaces');
const {
  PERSONAL_ACCESS_TOKEN_SCOPES,
  createPersonalAccessToken,
  listPersonalAccessTokensForUser,
  revokePersonalAccessToken
} = require('../services/personalAccessTokens');
const {
  SERVICE_ACCOUNT_KEY_SCOPES,
  SERVICE_ACCOUNT_ALLOWED_PREFIXES,
  createServiceAccountKey,
  listServiceAccountKeys,
  revokeServiceAccountKey
} = require('../services/serviceAccountKeys');
const { recordAuthEvent } = require('../services/metrics');

const router = express.Router();

async function buildAuthScopePayload(req) {
  const ensuredScope = await ensureUserDefaultScope(req.user.id);
  req.user.activeSpaceId = ensuredScope.spaceId;
  req.user.activeLibraryId = ensuredScope.libraryId;

  const client = await pool.connect();
  try {
    const spaces = await listAccessibleSpacesForUser(client, {
      userId: req.user.id,
      role: req.user.role
    });
    const libraries = ensuredScope.spaceId
      ? await listLibrariesForSpace({
          userId: req.user.id,
          role: req.user.role,
          spaceId: ensuredScope.spaceId
        })
      : [];

    return {
      active_space_id: ensuredScope.spaceId,
      active_library_id: ensuredScope.libraryId,
      spaces: spaces.map((space) => ({
        id: space.id,
        name: space.name,
        slug: space.slug || null,
        description: space.description || null,
        is_personal: Boolean(space.is_personal),
        membership_role: space.membership_role || null,
        library_count: Number(space.library_count || 0)
      })),
      libraries
    };
  } finally {
    client.release();
  }
}

// ── CSRF token bootstrap ──────────────────────────────────────────────────────
router.get('/csrf-token', asyncHandler(async (req, res) => {
  const token = issueCsrfToken(res);
  res.json({ csrfToken: token });
}));

// ── Register ──────────────────────────────────────────────────────────────────

router.post('/register', validate(registerSchema), asyncHandler(async (req, res) => {
  const { email, password, name, inviteToken } = req.body;

  const userCountResult = await pool.query('SELECT COUNT(*)::int AS count FROM users');
  const existingUserCount = userCountResult.rows[0]?.count || 0;

  let claimedInvite = null;
  if (inviteToken) {
    const tokenHash = hashInviteToken(inviteToken);
    const invite = await pool.query(
      `SELECT * FROM invites
       WHERE (token_hash = $1 OR token = $2)
         AND used = false
         AND revoked = false
         AND expires_at > NOW()`,
      [tokenHash, inviteToken]
    );
    if (invite.rows.length === 0) {
      recordAuthEvent('register', 'failed');
      return res.status(400).json({ error: 'Invalid or expired invite token' });
    }
    if (String(invite.rows[0].email).toLowerCase() !== String(email).toLowerCase()) {
      recordAuthEvent('register', 'failed');
      return res.status(400).json({ error: 'Invite token is not valid for this email address' });
    }
    claimedInvite = invite.rows[0];
  } else if (existingUserCount > 0) {
    recordAuthEvent('register', 'failed');
    return res.status(400).json({ error: 'An invite token is required to register' });
  }

  const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existingUser.rows.length > 0) {
    recordAuthEvent('register', 'failed');
    return res.status(409).json({ error: 'An account with that email already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const role = existingUserCount === 0 ? 'admin' : 'user';

  const result = await pool.query(
    'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
    [email, hashedPassword, name, role]
  );
  const ensuredScope = await ensureUserDefaultScope(result.rows[0].id, {
    preferredSpaceId: claimedInvite?.space_id || null
  });
  const activeLibraryId = ensuredScope.libraryId;
  const activeSpaceId = ensuredScope.spaceId;

  if (inviteToken) {
    await pool.query(
      'UPDATE invites SET used = true, used_by = $2, used_at = NOW() WHERE id = $1',
      [claimedInvite.id, result.rows[0].id]
    );
    await logActivity({ ...req, user: { id: result.rows[0].id } }, 'invite.claimed', 'invite', claimedInvite?.id || null, {
      inviteEmail: claimedInvite?.email || null,
      claimedByEmail: result.rows[0].email
    });
  }

  const token = await createSession(result.rows[0].id, {
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || null
  });

  res.cookie('session_token', token, SESSION_COOKIE_OPTIONS);
  issueCsrfToken(res);
  await logActivity({ ...req, user: { id: result.rows[0].id, role: result.rows[0].role, email: result.rows[0].email } }, 'auth.user.register', 'user', result.rows[0].id, {
    email: result.rows[0].email,
    role: result.rows[0].role,
    inviteTokenUsed: Boolean(inviteToken),
    activeLibraryId
  });
  recordAuthEvent('register', 'succeeded');
  res.json({
    user: {
      ...result.rows[0],
      active_space_id: activeSpaceId,
      active_library_id: activeLibraryId
    }
  });
}));

// ── Login ─────────────────────────────────────────────────────────────────────

router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (result.rows.length === 0) {
    recordAuthEvent('login', 'failed');
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const user = result.rows[0];
  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    recordAuthEvent('login', 'failed');
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const ensuredScope = await ensureUserDefaultScope(user.id);
  const activeLibraryId = ensuredScope.libraryId;
  const activeSpaceId = ensuredScope.spaceId;

  const token = await createSession(user.id, {
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || null
  });

  const { password: _, ...userWithoutPassword } = user;
  res.cookie('session_token', token, SESSION_COOKIE_OPTIONS);
  issueCsrfToken(res);
  await logActivity({ ...req, user: { id: user.id, role: user.role, email: user.email } }, 'auth.user.login', 'user', user.id, { email: user.email });
  recordAuthEvent('login', 'succeeded');
  res.json({
    user: {
      ...userWithoutPassword,
      active_space_id: activeSpaceId,
      active_library_id: activeLibraryId
    }
  });
}));

// ── Logout ────────────────────────────────────────────────────────────────────

router.post('/logout', asyncHandler(async (req, res) => {
  const cookieToken = req.cookies?.session_token;
  const sessionUser = cookieToken ? await getSessionUserByToken(cookieToken) : null;
  if (cookieToken) {
    await revokeSessionByToken(cookieToken);
  }
  res.clearCookie('session_token', {
    httpOnly: SESSION_COOKIE_OPTIONS.httpOnly,
    sameSite: SESSION_COOKIE_OPTIONS.sameSite,
    secure: SESSION_COOKIE_OPTIONS.secure,
    path: SESSION_COOKIE_OPTIONS.path
  });
  clearCsrfToken(res);
  const auditReq = sessionUser
    ? {
        ...req,
        user: {
          id: sessionUser.id,
          email: sessionUser.email,
          role: sessionUser.role,
          activeSpaceId: sessionUser.active_space_id ?? null,
          activeLibraryId: sessionUser.active_library_id ?? null
        },
        sessionId: sessionUser.session_id
      }
    : req;
  await logActivity(auditReq, 'auth.user.logout', 'user', sessionUser?.id || req.user?.id || null, null);
  res.json({ message: 'Logged out' });
}));

// ── Password reset consume (one-time token) ───────────────────────────────────
router.post('/password-reset/consume', validate(passwordResetConsumeSchema), asyncHandler(async (req, res) => {
  const { token, email, password } = req.body;
  const tokenHash = hashInviteToken(token);
  const resetLookup = await pool.query(
    `SELECT prt.id, prt.user_id, u.email
     FROM password_reset_tokens prt
     JOIN users u ON u.id = prt.user_id
     WHERE prt.token_hash = $1
       AND prt.used = false
       AND prt.revoked = false
       AND prt.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  if (resetLookup.rows.length === 0) {
    recordAuthEvent('password_reset_consume', 'failed');
    await logActivity(req, 'auth.password_reset.consume.failed', 'password_reset', null, {
      email,
      reason: 'invalid_or_expired_token'
    });
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }
  const resetRow = resetLookup.rows[0];
  if (String(resetRow.email).toLowerCase() !== String(email).toLowerCase()) {
    recordAuthEvent('password_reset_consume', 'failed');
    await logActivity(req, 'auth.password_reset.consume.failed', 'user', resetRow.user_id, {
      email,
      reason: 'email_mismatch'
    });
    return res.status(400).json({ error: 'Reset token is not valid for this email address' });
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, resetRow.user_id]);
  await pool.query(
    'UPDATE password_reset_tokens SET used = true, used_at = NOW() WHERE id = $1',
    [resetRow.id]
  );

  const revokedCount = await revokeSessionsForUser(resetRow.user_id);
  const newSessionToken = await createSession(resetRow.user_id, {
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || null
  });
  const meResult = await pool.query(
    'SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = $1',
    [resetRow.user_id]
  );
  const me = meResult.rows[0];

  res.cookie('session_token', newSessionToken, SESSION_COOKIE_OPTIONS);
  issueCsrfToken(res);
  await logActivity(req, 'auth.password_reset.consume', 'user', resetRow.user_id, {
    email: resetRow.email,
    revokedSessionCount: revokedCount
  });
  recordAuthEvent('password_reset_consume', 'succeeded');
  res.json({ user: me });
}));

// ── Current user ──────────────────────────────────────────────────────────────

router.get('/me', authenticateToken, asyncHandler(async (req, res) => {
  const ensuredScope = await ensureUserDefaultScope(req.user.id);
  req.user.activeSpaceId = ensuredScope.spaceId;
  req.user.activeLibraryId = ensuredScope.libraryId;
  const result = await pool.query(
    'SELECT id, email, name, role, created_at, updated_at, active_space_id, active_library_id FROM users WHERE id = $1',
    [req.user.id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  const row = result.rows[0];
  res.json({
    ...row,
    active_space_id: req.user.activeSpaceId ?? row.active_space_id ?? null,
    active_library_id: req.user.activeLibraryId ?? row.active_library_id ?? null
  });
}));

router.get('/scope', authenticateToken, asyncHandler(async (req, res) => {
  const payload = await buildAuthScopePayload(req);
  res.json(payload);
}));

router.post('/scope', authenticateToken, requireSessionAuth, validate(authScopeSelectSchema), asyncHandler(async (req, res) => {
  const requestedSpaceId = Number(req.body.space_id || 0) || null;
  const requestedLibraryId = Number(req.body.library_id || 0) || null;

  let nextSpaceId = requestedSpaceId;
  let nextLibraryId = requestedLibraryId;

  if (requestedLibraryId) {
    const selectedLibrary = await getAccessibleLibrary({
      userId: req.user.id,
      role: req.user.role,
      libraryId: requestedLibraryId
    });
    if (!selectedLibrary) {
      return res.status(403).json({ error: 'Library access denied' });
    }
    nextLibraryId = selectedLibrary.id;
    nextSpaceId = selectedLibrary.space_id || nextSpaceId || null;
  }

  if (nextSpaceId) {
    const selectedSpace = await pool.connect();
    try {
      const accessibleSpace = await getAccessibleSpaceForUser(selectedSpace, {
        userId: req.user.id,
        role: req.user.role,
        spaceId: nextSpaceId
      });
      if (!accessibleSpace) {
        return res.status(403).json({ error: 'Space access denied' });
      }
    } finally {
      selectedSpace.release();
    }
  }

  if (!nextSpaceId && nextLibraryId) {
    const selectedLibrary = await getAccessibleLibrary({
      userId: req.user.id,
      role: req.user.role,
      libraryId: nextLibraryId
    });
    nextSpaceId = selectedLibrary?.space_id || null;
  }

  if (nextSpaceId && !nextLibraryId) {
    const libraries = await listLibrariesForSpace({
      userId: req.user.id,
      role: req.user.role,
      spaceId: nextSpaceId
    });
    const currentLibraryInSpace = libraries.find((library) => Number(library.id) === Number(req.user.activeLibraryId || 0));
    nextLibraryId = currentLibraryInSpace?.id || libraries[0]?.id || null;
  }

  await pool.query(
    `UPDATE users
     SET active_space_id = $2,
         active_library_id = $3
     WHERE id = $1`,
    [req.user.id, nextSpaceId, nextLibraryId]
  );

  req.user.activeSpaceId = nextSpaceId;
  req.user.activeLibraryId = nextLibraryId;

  await logActivity(req, 'auth.scope.select', 'user', req.user.id, {
    activeSpaceId: nextSpaceId,
    activeLibraryId: nextLibraryId
  });

  const payload = await buildAuthScopePayload(req);
  res.json(payload);
}));

// ── Profile ───────────────────────────────────────────────────────────────────

router.get('/profile', authenticateToken, asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT id, email, name, role, created_at, updated_at, active_space_id, active_library_id FROM users WHERE id = $1',
    [req.user.id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  const row = result.rows[0];
  res.json({
    ...row,
    active_space_id: req.user.activeSpaceId ?? row.active_space_id ?? null,
    active_library_id: req.user.activeLibraryId ?? row.active_library_id ?? null
  });
}));

router.patch('/profile', authenticateToken, validate(profileUpdateSchema), asyncHandler(async (req, res) => {
  const { name, email, password, current_password: currentPassword } = req.body;
  const previous = await pool.query(
    'SELECT id, email, name, password FROM users WHERE id = $1',
    [req.user.id]
  );
  if (previous.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const updates = [];
  const values = [];

  if (name) {
    values.push(name);
    updates.push(`name = $${values.length}`);
  }

  if (email) {
    const emailCheck = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND id <> $2',
      [email, req.user.id]
    );
    if (emailCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Email is already in use by another account' });
    }
    values.push(email);
    updates.push(`email = $${values.length}`);
  }

  if (password) {
    const currentValid = await bcrypt.compare(currentPassword, previous.rows[0].password);
    if (!currentValid) {
      await logActivity(req, 'auth.profile.password_change.failed', 'user', req.user.id, {
        reason: 'current_password_incorrect'
      });
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const hashed = await bcrypt.hash(password, 12);
    values.push(hashed);
    updates.push(`password = $${values.length}`);
  }

  if (updates.length === 0) {
    return res.json({
      id: previous.rows[0].id,
      email: previous.rows[0].email,
      name: previous.rows[0].name,
      role: req.user.role
    });
  }

  values.push(req.user.id);
  const result = await pool.query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length}
     RETURNING id, email, name, role, created_at, updated_at`,
    values
  );

  let revokedSessionCount = 0;
  if (password) {
    revokedSessionCount = await revokeSessionsForUser(req.user.id, {
      keepSessionId: req.sessionId || null
    });
  }

  await logActivity(req, 'auth.profile.update', 'user', req.user.id, {
    previousName: previous.rows[0].name,
    previousEmail: previous.rows[0].email,
    nextName: result.rows[0].name,
    nextEmail: result.rows[0].email,
    passwordChanged: Boolean(password),
    revokedSessionCount
  });

  res.json(result.rows[0]);
}));

// ── Personal Access Tokens ───────────────────────────────────────────────────

router.get('/personal-access-tokens', authenticateToken, requireSessionAuth, asyncHandler(async (req, res) => {
  const tokens = await listPersonalAccessTokensForUser(req.user.id);
  res.json({
    scopes: PERSONAL_ACCESS_TOKEN_SCOPES,
    tokens
  });
}));

router.post('/personal-access-tokens', authenticateToken, requireSessionAuth, validate(personalAccessTokenCreateSchema), asyncHandler(async (req, res) => {
  const expiresAt = req.body.expires_at ? new Date(req.body.expires_at) : null;
  const created = await createPersonalAccessToken({
    userId: req.user.id,
    name: req.body.name.trim(),
    scopes: req.body.scopes,
    expiresAt
  });
  await logActivity(req, 'auth.pat.create', 'personal_access_token', created.record.id, {
    name: created.record.name,
    scopes: created.record.scopes,
    expiresAt: created.record.expires_at
  });
  res.status(201).json({
    token: created.token,
    record: created.record
  });
}));

router.delete('/personal-access-tokens/:id', authenticateToken, requireSessionAuth, asyncHandler(async (req, res) => {
  const tokenId = Number(req.params.id);
  if (!Number.isFinite(tokenId) || tokenId <= 0) {
    return res.status(400).json({ error: 'Invalid token id' });
  }
  const revoked = await revokePersonalAccessToken({ userId: req.user.id, tokenId });
  if (!revoked) {
    return res.status(404).json({ error: 'Personal access token not found' });
  }
  await logActivity(req, 'auth.pat.revoke', 'personal_access_token', revoked.id, {
    name: revoked.name,
    revokedAt: revoked.revoked_at
  });
  res.json(revoked);
}));

// ── Service Account Keys (admin-only) ────────────────────────────────────────

router.get('/service-account-keys', authenticateToken, requireSessionAuth, requireRole('admin'), asyncHandler(async (_req, res) => {
  const keys = await listServiceAccountKeys();
  res.json({
    scopes: SERVICE_ACCOUNT_KEY_SCOPES,
    allowed_prefixes: SERVICE_ACCOUNT_ALLOWED_PREFIXES,
    keys
  });
}));

router.post('/service-account-keys', authenticateToken, requireSessionAuth, requireRole('admin'), validate(serviceAccountKeyCreateSchema), asyncHandler(async (req, res) => {
  const expiresAt = req.body.expires_at ? new Date(req.body.expires_at) : null;
  const created = await createServiceAccountKey({
    ownerUserId: req.user.id,
    createdByUserId: req.user.id,
    name: req.body.name.trim(),
    scopes: req.body.scopes,
    allowedPrefixes: req.body.allowed_prefixes,
    expiresAt
  });
  await logActivity(req, 'auth.service_account.create', 'service_account_key', created.record.id, {
    name: created.record.name,
    scopes: created.record.scopes,
    allowedPrefixes: created.record.allowed_prefixes,
    expiresAt: created.record.expires_at
  });
  res.status(201).json({
    key: created.key,
    record: created.record
  });
}));

router.delete('/service-account-keys/:id', authenticateToken, requireSessionAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const keyId = Number(req.params.id);
  if (!Number.isFinite(keyId) || keyId <= 0) {
    return res.status(400).json({ error: 'Invalid service account key id' });
  }
  const revoked = await revokeServiceAccountKey({ keyId });
  if (!revoked) {
    return res.status(404).json({ error: 'Service account key not found' });
  }
  await logActivity(req, 'auth.service_account.revoke', 'service_account_key', revoked.id, {
    name: revoked.name,
    revokedAt: revoked.revoked_at
  });
  res.json(revoked);
}));

module.exports = router;
