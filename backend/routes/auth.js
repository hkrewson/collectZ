const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken, SESSION_COOKIE_OPTIONS } = require('../middleware/auth');
const { validate, registerSchema, loginSchema, profileUpdateSchema, passwordResetConsumeSchema } = require('../middleware/validate');
const { createSession, revokeSessionByToken, revokeSessionsForUser } = require('../services/sessions');
const { logActivity } = require('../services/audit');
const { issueCsrfToken, clearCsrfToken } = require('../middleware/csrf');
const { hashInviteToken } = require('../services/invites');
const { ensureUserDefaultLibrary } = require('../services/libraries');

const router = express.Router();

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
      return res.status(400).json({ error: 'Invalid or expired invite token' });
    }
    if (String(invite.rows[0].email).toLowerCase() !== String(email).toLowerCase()) {
      return res.status(400).json({ error: 'Invite token is not valid for this email address' });
    }
    claimedInvite = invite.rows[0];
  } else if (existingUserCount > 0) {
    return res.status(400).json({ error: 'An invite token is required to register' });
  }

  const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existingUser.rows.length > 0) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const role = existingUserCount === 0 ? 'admin' : 'user';

  const result = await pool.query(
    'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
    [email, hashedPassword, name, role]
  );
  const activeLibraryId = await ensureUserDefaultLibrary(result.rows[0].id);

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
  await logActivity(req, 'auth.user.register', 'user', result.rows[0].id, {
    email: result.rows[0].email,
    role: result.rows[0].role,
    inviteTokenUsed: Boolean(inviteToken),
    activeLibraryId
  });
  res.json({
    user: {
      ...result.rows[0],
      active_library_id: activeLibraryId
    }
  });
}));

// ── Login ─────────────────────────────────────────────────────────────────────

router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const user = result.rows[0];
  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const activeLibraryId = await ensureUserDefaultLibrary(user.id);

  const token = await createSession(user.id, {
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || null
  });

  const { password: _, ...userWithoutPassword } = user;
  res.cookie('session_token', token, SESSION_COOKIE_OPTIONS);
  issueCsrfToken(res);
  await logActivity(req, 'auth.user.login', 'user', user.id, { email: user.email });
  res.json({
    user: {
      ...userWithoutPassword,
      active_library_id: activeLibraryId
    }
  });
}));

// ── Logout ────────────────────────────────────────────────────────────────────

router.post('/logout', asyncHandler(async (req, res) => {
  const cookieToken = req.cookies?.session_token;
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
  await logActivity(req, 'auth.user.logout', 'user', req.user?.id || null, null);
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
    await logActivity(req, 'auth.password_reset.consume.failed', 'password_reset', null, {
      email,
      reason: 'invalid_or_expired_token'
    });
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }
  const resetRow = resetLookup.rows[0];
  if (String(resetRow.email).toLowerCase() !== String(email).toLowerCase()) {
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
  res.json({ user: me });
}));

// ── Current user ──────────────────────────────────────────────────────────────

router.get('/me', authenticateToken, asyncHandler(async (req, res) => {
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

module.exports = router;
