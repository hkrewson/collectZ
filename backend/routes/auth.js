const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken, SESSION_COOKIE_OPTIONS } = require('../middleware/auth');
const { validate, registerSchema, loginSchema, profileUpdateSchema } = require('../middleware/validate');
const { createSession, revokeSessionByToken } = require('../services/sessions');

const router = express.Router();

// ── Register ──────────────────────────────────────────────────────────────────

router.post('/register', validate(registerSchema), asyncHandler(async (req, res) => {
  const { email, password, name, inviteToken } = req.body;

  const userCountResult = await pool.query('SELECT COUNT(*)::int AS count FROM users');
  const existingUserCount = userCountResult.rows[0]?.count || 0;

  if (inviteToken) {
    const invite = await pool.query(
      'SELECT * FROM invites WHERE token = $1 AND used = false AND expires_at > NOW()',
      [inviteToken]
    );
    if (invite.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired invite token' });
    }
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

  if (inviteToken) {
    await pool.query('UPDATE invites SET used = true WHERE token = $1', [inviteToken]);
  }

  const token = await createSession(result.rows[0].id, {
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || null
  });

  res.cookie('session_token', token, SESSION_COOKIE_OPTIONS);
  res.json({ user: result.rows[0] });
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

  const token = await createSession(user.id, {
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || null
  });

  const { password: _, ...userWithoutPassword } = user;
  res.cookie('session_token', token, SESSION_COOKIE_OPTIONS);
  res.json({ user: userWithoutPassword });
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
  res.json({ message: 'Logged out' });
}));

// ── Current user ──────────────────────────────────────────────────────────────

router.get('/me', authenticateToken, asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = $1',
    [req.user.id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json(result.rows[0]);
}));

// ── Profile ───────────────────────────────────────────────────────────────────

router.get('/profile', authenticateToken, asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = $1',
    [req.user.id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json(result.rows[0]);
}));

router.patch('/profile', authenticateToken, validate(profileUpdateSchema), asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
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
    const hashed = await bcrypt.hash(password, 12);
    values.push(hashed);
    updates.push(`password = $${values.length}`);
  }

  values.push(req.user.id);
  const result = await pool.query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length}
     RETURNING id, email, name, role, created_at, updated_at`,
    values
  );

  res.json(result.rows[0]);
}));

module.exports = router;
