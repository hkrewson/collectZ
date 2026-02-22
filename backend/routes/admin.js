const express = require('express');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validate, roleUpdateSchema, inviteCreateSchema, generalSettingsSchema } = require('../middleware/validate');
const { logActivity } = require('../services/audit');
const { loadGeneralSettings } = require('../services/integrations');
const { resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
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

router.get('/users/:id/summary', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  const userResult = await pool.query(
    'SELECT id, email, name, role, created_at FROM users WHERE id = $1',
    [userId]
  );
  if (userResult.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const mediaScopeParams = [userId];
  const mediaScopeClause = appendScopeSql(mediaScopeParams, scopeContext);
  const [loginResult, additionsResult, editsResult, ratingsResult] = await Promise.all([
    pool.query(
      `SELECT MAX(created_at) AS last_login_at
       FROM activity_log
       WHERE user_id = $1
         AND action = 'auth.user.login'`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS additions_count
       FROM media
       WHERE added_by = $1${mediaScopeClause}`,
      mediaScopeParams
    ),
    pool.query(
      `SELECT MAX(updated_at) AS last_media_edit_at
       FROM media
       WHERE added_by = $1${mediaScopeClause}`,
      mediaScopeParams
    ),
    pool.query(
      `SELECT COUNT(*)::int AS rated_count
       FROM media
       WHERE added_by = $1
         AND user_rating IS NOT NULL${mediaScopeClause}`,
      mediaScopeParams
    )
  ]);

  const additionsCount = additionsResult.rows[0]?.additions_count || 0;
  const ratedCount = ratingsResult.rows[0]?.rated_count || 0;
  const contributionScore = Math.min(100, additionsCount * 10 + ratedCount * 5);

  res.json({
    user: userResult.rows[0],
    metrics: {
      lastLoginAt: loginResult.rows[0]?.last_login_at || null,
      additionsCount,
      lastMediaEditAt: editsResult.rows[0]?.last_media_edit_at || null,
      ratedCount,
      contributionScore
    }
  });
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
  const scopeContext = resolveScopeContext(req);
  const { email } = req.body;
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const result = await pool.query(
    `INSERT INTO invites (email, token, expires_at, created_by, space_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, token, used, revoked, used_by, used_at, expires_at, created_at`,
    [email, token, expiresAt, req.user.id, scopeContext.spaceId]
  );
  await logActivity(req, 'admin.invite.create', 'invite', result.rows[0].id, {
    email: result.rows[0].email,
    expiresAt: result.rows[0].expires_at
  });
  res.status(201).json(result.rows[0]);
}));

router.get('/invites', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const params = [];
  const scopeClause = appendScopeSql(params, scopeContext, { libraryColumn: null });
  const result = await pool.query(
    `SELECT i.id, i.email, i.token, i.used, i.revoked, i.used_by, i.used_at,
            i.expires_at, i.created_at, creator.email AS created_by_email,
            claimer.email AS used_by_email
     FROM invites i
     LEFT JOIN users creator ON creator.id = i.created_by
     LEFT JOIN users claimer ON claimer.id = i.used_by
     WHERE 1=1${scopeClause}
     ORDER BY i.created_at DESC`
    , params
  );
  res.json(result.rows);
}));

router.patch('/invites/:id/revoke', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const inviteId = Number(req.params.id);
  if (!Number.isFinite(inviteId) || inviteId <= 0) {
    return res.status(400).json({ error: 'Invalid invite id' });
  }

  const params = [inviteId];
  const scopeClause = appendScopeSql(params, scopeContext, { libraryColumn: null, spaceColumn: 'space_id' });
  const result = await pool.query(
    `UPDATE invites
     SET revoked = true
     WHERE id = $1
       AND used = false
       AND revoked = false${scopeClause}
     RETURNING id, email, used, revoked, expires_at, created_at`,
    params
  );
  if (result.rows.length === 0) {
    const inviteCheckParams = [inviteId];
    const inviteCheckClause = appendScopeSql(inviteCheckParams, scopeContext, { libraryColumn: null, spaceColumn: 'space_id' });
    const invite = await pool.query(`SELECT id, used, revoked FROM invites WHERE id = $1${inviteCheckClause}`, inviteCheckParams);
    if (invite.rows.length === 0) {
      return res.status(404).json({ error: 'Invite not found' });
    }
    if (invite.rows[0].used) {
      return res.status(400).json({ error: 'Invite has already been used' });
    }
    if (invite.rows[0].revoked) {
      return res.status(400).json({ error: 'Invite is already revoked' });
    }
    return res.status(400).json({ error: 'Invite cannot be revoked' });
  }

  await logActivity(req, 'admin.invite.revoke', 'invite', inviteId, { email: result.rows[0].email });
  res.json(result.rows[0]);
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
