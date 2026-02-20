const express = require('express');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validate, roleUpdateSchema, inviteCreateSchema, generalSettingsSchema } = require('../middleware/validate');
const { logActivity } = require('../services/audit');
const { loadGeneralSettings } = require('../services/integrations');
const crypto = require('crypto');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticateToken, requireRole('admin'));

// ── General settings ──────────────────────────────────────────────────────────

router.put('/settings/general', validate(generalSettingsSchema), asyncHandler(async (req, res) => {
  const current = await loadGeneralSettings();
  const theme = req.body.theme || current.theme;
  const density = req.body.density || current.density;

  const result = await pool.query(
    `INSERT INTO app_settings (id, theme, density)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET theme = EXCLUDED.theme, density = EXCLUDED.density
     RETURNING theme, density`,
    [theme, density]
  );
  await logActivity(req, 'admin.settings.general.update', 'app_settings', 1, { theme, density });
  res.json(result.rows[0]);
}));

// ── Users ─────────────────────────────────────────────────────────────────────

router.get('/users', asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC'
  );
  res.json(result.rows);
}));

router.patch('/users/:id/role', validate(roleUpdateSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  const targetBefore = await pool.query('SELECT id, email, role FROM users WHERE id = $1', [id]);
  if (targetBefore.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const result = await pool.query(
    'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, name, role',
    [role, id]
  );
  await logActivity(req, 'admin.user.role.update', 'user', Number(id), {
    email: result.rows[0]?.email || targetBefore.rows[0].email,
    previousRole: targetBefore.rows[0].role,
    nextRole: result.rows[0]?.role || role
  });
  res.json(result.rows[0]);
}));

router.delete('/users/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  const target = await pool.query('SELECT id, email, role FROM users WHERE id = $1', [id]);
  if (target.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
  await logActivity(req, 'admin.user.delete', 'user', Number(id), {
    email: target.rows[0].email,
    role: target.rows[0].role
  });
  res.json({ message: 'User deleted' });
}));

// ── Invites ───────────────────────────────────────────────────────────────────

router.post('/invites', validate(inviteCreateSchema), asyncHandler(async (req, res) => {
  const { email } = req.body;
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const result = await pool.query(
    'INSERT INTO invites (email, token, expires_at, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
    [email, token, expiresAt, req.user.id]
  );
  await logActivity(req, 'admin.invite.create', 'invite', result.rows[0].id, {
    email: result.rows[0].email,
    expiresAt: result.rows[0].expires_at
  });
  res.status(201).json(result.rows[0]);
}));

router.get('/invites', asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT id, email, token, used, expires_at, created_at FROM invites ORDER BY created_at DESC'
  );
  res.json(result.rows);
}));

// ── Activity log ──────────────────────────────────────────────────────────────
// Supports optional query filters: action, userId, from, to, q, limit

router.get('/activity', asyncHandler(async (req, res) => {
  const limitRaw = Number(req.query.limit || 100);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;
  const offsetRaw = Number(req.query.offset || 0);
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

  const conditions = [];
  const params = [];

  if (req.query.action) {
    params.push(req.query.action);
    conditions.push(`action = $${params.length}`);
  }

  if (req.query.userId) {
    const uid = Number(req.query.userId);
    if (Number.isFinite(uid)) {
      params.push(uid);
      conditions.push(`user_id = $${params.length}`);
    }
  }

  if (req.query.from) {
    params.push(req.query.from);
    conditions.push(`created_at >= $${params.length}`);
  }

  if (req.query.to) {
    params.push(req.query.to);
    conditions.push(`created_at <= $${params.length}`);
  }

  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    conditions.push(`details::text ILIKE $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  params.push(offset);

  const result = await pool.query(
    `SELECT id, user_id, action, entity_type, entity_id, details, ip_address, created_at
     FROM activity_log
     ${where}
     ORDER BY id DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );
  res.json(result.rows);
}));

module.exports = router;
