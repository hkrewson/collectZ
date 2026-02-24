const express = require('express');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validate, roleUpdateSchema, inviteCreateSchema, generalSettingsSchema } = require('../middleware/validate');
const { logActivity } = require('../services/audit');
const { loadGeneralSettings } = require('../services/integrations');
const { listFeatureFlags, getFeatureFlag, updateFeatureFlag, FEATURE_FLAGS_READ_ONLY } = require('../services/featureFlags');
const { resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const crypto = require('crypto');
const { hashInviteToken } = require('../services/invites');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticateToken, requireRole('admin'));
router.use(enforceScopeAccess({ allowedHintRoles: ['admin'] }));

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

// ── Feature flags ─────────────────────────────────────────────────────────────

router.get('/feature-flags', asyncHandler(async (_req, res) => {
  const flags = await listFeatureFlags();
  res.json({ readOnly: FEATURE_FLAGS_READ_ONLY, flags });
}));

router.patch('/feature-flags/:key', asyncHandler(async (req, res) => {
  const key = String(req.params.key || '').trim();
  const { enabled } = req.body || {};

  if (!key) return res.status(400).json({ error: 'Feature flag key is required' });
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });

  const previous = await getFeatureFlag(key);
  if (!previous) return res.status(404).json({ error: `Unknown feature flag: ${key}` });

  try {
    const updated = await updateFeatureFlag({ key, enabled, updatedBy: req.user?.id || null });
    await logActivity(req, 'admin.feature_flag.update', 'feature_flag', null, {
      key,
      previousEnabled: previous.enabled,
      nextEnabled: updated.enabled,
      envOverride: updated.envOverride
    });
    res.json(updated);
  } catch (error) {
    if (error?.code === 'feature_flags_read_only') {
      await logActivity(req, 'admin.feature_flag.update.failed', 'feature_flag', null, {
        key,
        requestedEnabled: enabled,
        reason: 'read_only'
      });
    }
    throw error;
  }
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

router.post('/users/:id/password-reset', asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  const userResult = await pool.query('SELECT id, email FROM users WHERE id = $1', [userId]);
  if (userResult.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await pool.query(
    `UPDATE password_reset_tokens
     SET revoked = true
     WHERE user_id = $1
       AND used = false
       AND revoked = false`,
    [userId]
  );

  const insert = await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, expires_at, created_at`,
    [userId, tokenHash, expiresAt, req.user.id]
  );

  const email = userResult.rows[0].email;
  const resetUrl = `${req.protocol}://${req.get('host')}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  await logActivity(req, 'admin.user.password_reset.create', 'user', userId, {
    email,
    resetTokenId: insert.rows[0].id,
    expiresAt
  });
  res.status(201).json({
    id: insert.rows[0].id,
    user_id: userId,
    email,
    expires_at: insert.rows[0].expires_at,
    reset_url: resetUrl,
    token
  });
}));

router.post('/users/:id/password-reset/invalidate', asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  const userResult = await pool.query('SELECT id, email FROM users WHERE id = $1', [userId]);
  if (userResult.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const revokeResult = await pool.query(
    `UPDATE password_reset_tokens
     SET revoked = true
     WHERE user_id = $1
       AND used = false
       AND revoked = false`,
    [userId]
  );

  await logActivity(req, 'admin.user.password_reset.invalidate', 'user', userId, {
    email: userResult.rows[0].email,
    invalidatedCount: revokeResult.rowCount || 0
  });

  res.json({
    user_id: userId,
    email: userResult.rows[0].email,
    invalidated_count: revokeResult.rowCount || 0
  });
}));

// ── Invites ───────────────────────────────────────────────────────────────────

router.post('/invites', validate(inviteCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const { email } = req.body;
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const result = await pool.query(
    `INSERT INTO invites (email, token_hash, expires_at, created_by, space_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, used, revoked, used_by, used_at, expires_at, created_at`,
    [email, tokenHash, expiresAt, req.user.id, scopeContext.spaceId]
  );
  await logActivity(req, 'admin.invite.create', 'invite', result.rows[0].id, {
    email: result.rows[0].email,
    expiresAt: result.rows[0].expires_at
  });
  res.status(201).json({
    ...result.rows[0],
    token
  });
}));

router.get('/invites', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const params = [];
  const scopeClause = appendScopeSql(params, scopeContext, { libraryColumn: null });
  const result = await pool.query(
    `SELECT i.id, i.email, i.used, i.revoked, i.used_by, i.used_at,
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
// Supports optional query filters: action, entity, userId, user, from, to, q, search, limit

router.get('/activity', asyncHandler(async (req, res) => {
  const limitRaw = Number(req.query.limit || 100);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;
  const offsetRaw = Number(req.query.offset || 0);
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

  const conditions = [];
  const params = [];

  if (req.query.action) {
    params.push(req.query.action);
    conditions.push(`al.action = $${params.length}`);
  }

  if (req.query.userId) {
    const uid = Number(req.query.userId);
    if (Number.isFinite(uid)) {
      params.push(uid);
      conditions.push(`al.user_id = $${params.length}`);
    }
  }

  if (req.query.user) {
    const raw = String(req.query.user).trim();
    if (raw) {
      const asId = Number(raw);
      if (Number.isFinite(asId)) {
        params.push(asId);
        conditions.push(`al.user_id = $${params.length}`);
      } else {
        params.push(`%${raw}%`);
        conditions.push(`EXISTS (SELECT 1 FROM users u2 WHERE u2.id = al.user_id AND u2.email ILIKE $${params.length})`);
      }
    }
  }

  if (req.query.entity) {
    params.push(String(req.query.entity));
    conditions.push(`al.entity_type = $${params.length}`);
  }

  if (req.query.from) {
    params.push(req.query.from);
    conditions.push(`al.created_at >= $${params.length}`);
  }

  if (req.query.to) {
    params.push(req.query.to);
    conditions.push(`al.created_at <= $${params.length}`);
  }

  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    conditions.push(`al.details::text ILIKE $${params.length}`);
  }

  if (req.query.search) {
    const searchValue = String(req.query.search).trim();
    if (searchValue) {
      params.push(`%${searchValue}%`);
      const token = `$${params.length}`;
      conditions.push(`(
        al.action ILIKE ${token}
        OR COALESCE(al.entity_type, '') ILIKE ${token}
        OR al.details::text ILIKE ${token}
        OR EXISTS (SELECT 1 FROM users u3 WHERE u3.id = al.user_id AND u3.email ILIKE ${token})
      )`);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  params.push(offset);

  const result = await pool.query(
    `SELECT al.id, al.user_id, al.action, al.entity_type, al.entity_id, al.details, al.ip_address, al.created_at,
            u.email AS user_email
     FROM activity_log al
     LEFT JOIN users u ON u.id = al.user_id
     ${where}
     ORDER BY al.id DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );
  res.json(result.rows);
}));

module.exports = router;
