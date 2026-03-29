const express = require('express');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  validate,
  roleUpdateSchema,
  generalSettingsSchema,
  spaceCreateSchema,
  adminSpaceCreateWithOnboardingSchema,
  spaceMembershipCreateSchema,
  spaceInviteCreateSchema,
  adminSpaceOwnerAssignSchema,
  adminSpaceArchiveSchema
} = require('../middleware/validate');
const { logActivity } = require('../services/audit');
const { loadGeneralSettings } = require('../services/integrations');
const { listFeatureFlags, getFeatureFlag, updateFeatureFlag, FEATURE_FLAGS_READ_ONLY } = require('../services/featureFlags');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const { sendInviteEmail, sendPasswordResetEmail } = require('../services/email');
const crypto = require('crypto');
const { getRequestOrigin } = require('../services/requestOrigin');
const { syncLibraryMembershipsForSpaceUser } = require('../services/libraries');
const { hashInviteToken } = require('../services/invites');

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

function parseBool(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

async function createInitialSpaceInvite({ client, req, spaceId, email, role, exposeToken }) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const normalizedEmail = String(email || '').trim().toLowerCase();

  const membershipLookup = await client.query(
    `SELECT sm.id, sm.role, u.id AS user_id, u.email
     FROM space_memberships sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.space_id = $1
       AND lower(u.email) = lower($2)
     LIMIT 1`,
    [spaceId, normalizedEmail]
  );
  if (membershipLookup.rows.length > 0) {
    const existingMembership = membershipLookup.rows[0];
    return {
      email: normalizedEmail,
      role,
      created: false,
      error: `User is already a ${existingMembership.role} of this space`,
      code: 'already_member'
    };
  }

  const existingInviteLookup = await client.query(
    `SELECT id, space_role, expires_at
     FROM invites
     WHERE space_id = $1
       AND lower(email) = lower($2)
       AND used = false
       AND revoked = false
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [spaceId, normalizedEmail]
  );
  if (existingInviteLookup.rows.length > 0) {
    return {
      email: normalizedEmail,
      role,
      created: false,
      error: 'An active invite already exists for this email in the target space',
      code: 'active_invite_exists'
    };
  }

  const insert = await client.query(
    `INSERT INTO invites (email, token_hash, expires_at, created_by, space_id, space_role)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, email, used, revoked, used_by, used_at, expires_at, created_at, space_id, space_role`,
    [normalizedEmail, tokenHash, expiresAt, req.user.id, spaceId, role]
  );

  const invite = insert.rows[0];
  const inviteUrl = `${getRequestOrigin(req)}/register?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(invite.email)}`;

  await logActivity(req, 'space.invite.create', 'invite', invite.id, {
    email: invite.email,
    role,
    spaceId,
    expiresAt: invite.expires_at,
    initiatedBy: 'admin_space_onboarding'
  });

  if (exposeToken) {
    await logActivity(req, 'space.invite.token_exposed', 'invite', invite.id, {
      email: invite.email,
      role,
      spaceId,
      exposureMode: 'admin_space_onboarding'
    });
  }

  let delivery = { attempted: false, sent: false, reason: 'smtp_not_configured' };
  try {
    delivery = await sendInviteEmail({
      to: invite.email,
      inviteUrl,
      expiresAt: invite.expires_at
    });
    if (delivery.sent) {
      await logActivity(req, 'space.invite.delivered', 'invite', invite.id, {
        email: invite.email,
        role,
        spaceId,
        delivery: 'smtp',
        initiatedBy: 'admin_space_onboarding'
      });
    }
  } catch (error) {
    delivery = { attempted: true, sent: false, reason: error.message || 'smtp_send_failed' };
    await logActivity(req, 'space.invite.delivery_failed', 'invite', invite.id, {
      email: invite.email,
      role,
      spaceId,
      reason: delivery.reason,
      initiatedBy: 'admin_space_onboarding'
    });
  }

  return {
    id: invite.id,
    email: invite.email,
    role,
    created: true,
    expires_at: invite.expires_at,
    created_at: invite.created_at,
    delivery,
    ...(exposeToken ? { token, invite_url: inviteUrl } : {})
  };
}

async function getAdminSpaceById(client, spaceId) {
  const result = await client.query(
    `SELECT
       s.id,
       s.name,
       s.slug,
       s.description,
       s.created_by,
       s.is_personal,
       s.created_at,
       s.updated_at,
       s.archived_at,
       creator.email AS created_by_email,
       COUNT(DISTINCT sm.user_id)::int AS member_count,
       COUNT(DISTINCT l.id)::int AS library_count,
       COUNT(DISTINCT CASE WHEN sm.role = 'owner' THEN sm.user_id END)::int AS owner_count,
       COALESCE(
         json_agg(
           DISTINCT jsonb_build_object(
             'user_id', owner_user.id,
             'email', owner_user.email,
             'name', owner_user.name
           )
         ) FILTER (WHERE sm.role = 'owner' AND owner_user.id IS NOT NULL),
         '[]'::json
       ) AS owners
     FROM spaces s
     LEFT JOIN users creator ON creator.id = s.created_by
     LEFT JOIN space_memberships sm ON sm.space_id = s.id
     LEFT JOIN users owner_user ON owner_user.id = sm.user_id
     LEFT JOIN libraries l ON l.space_id = s.id AND l.archived_at IS NULL
     WHERE s.id = $1
     GROUP BY s.id, creator.email
     LIMIT 1`,
    [spaceId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    ...row,
    member_count: Number(row.member_count || 0),
    library_count: Number(row.library_count || 0),
    owner_count: Number(row.owner_count || 0),
    owners: Array.isArray(row.owners) ? row.owners : []
  };
}

router.get('/spaces', asyncHandler(async (_req, res) => {
  const result = await pool.query(
    `SELECT
       s.id,
       s.name,
       s.slug,
       s.description,
       s.created_by,
       s.is_personal,
       s.created_at,
       s.updated_at,
       s.archived_at,
       creator.email AS created_by_email,
       COUNT(DISTINCT sm.user_id)::int AS member_count,
       COUNT(DISTINCT l.id)::int AS library_count,
       COUNT(DISTINCT CASE WHEN sm.role = 'owner' THEN sm.user_id END)::int AS owner_count,
       COALESCE(
         json_agg(
           DISTINCT jsonb_build_object(
             'user_id', owner_user.id,
             'email', owner_user.email,
             'name', owner_user.name
           )
         ) FILTER (WHERE sm.role = 'owner' AND owner_user.id IS NOT NULL),
         '[]'::json
       ) AS owners
     FROM spaces s
     LEFT JOIN users creator ON creator.id = s.created_by
     LEFT JOIN space_memberships sm ON sm.space_id = s.id
     LEFT JOIN users owner_user ON owner_user.id = sm.user_id
     LEFT JOIN libraries l ON l.space_id = s.id AND l.archived_at IS NULL
     GROUP BY s.id, creator.email
     ORDER BY
       CASE WHEN s.archived_at IS NULL THEN 0 ELSE 1 END,
       lower(s.name) ASC,
       s.id ASC`
  );
  res.json({
    spaces: result.rows.map((row) => ({
      ...row,
      member_count: Number(row.member_count || 0),
      library_count: Number(row.library_count || 0),
      owner_count: Number(row.owner_count || 0),
      owners: Array.isArray(row.owners) ? row.owners : []
    }))
  });
}));

router.get('/spaces/:id', asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }

  const client = await pool.connect();
  try {
    const space = await getAdminSpaceById(client, spaceId);
    if (!space) {
      return res.status(404).json({ error: 'Space not found' });
    }

    const [membersResult, invitesResult, librariesResult] = await Promise.all([
      client.query(
        `SELECT
           sm.id,
           sm.space_id,
           sm.user_id,
           sm.role,
           sm.created_by,
           sm.created_at,
           sm.updated_at,
           u.email,
           u.name,
           u.role AS user_role,
           creator.email AS created_by_email
         FROM space_memberships sm
         JOIN users u ON u.id = sm.user_id
         LEFT JOIN users creator ON creator.id = sm.created_by
         WHERE sm.space_id = $1
         ORDER BY
           CASE sm.role
             WHEN 'owner' THEN 0
             WHEN 'admin' THEN 1
             WHEN 'member' THEN 2
             ELSE 3
           END,
           lower(u.email) ASC,
           sm.id ASC`,
        [spaceId]
      ),
      client.query(
        `SELECT
           i.id,
           i.email,
           i.used,
           i.revoked,
           i.used_by,
           i.used_at,
           i.expires_at,
           i.created_at,
           i.space_id,
           i.space_role,
           creator.email AS created_by_email,
           claimer.email AS used_by_email
         FROM invites i
         LEFT JOIN users creator ON creator.id = i.created_by
         LEFT JOIN users claimer ON claimer.id = i.used_by
         WHERE i.space_id = $1
         ORDER BY i.created_at DESC`,
        [spaceId]
      ),
      client.query(
        `SELECT
           l.id,
           l.name,
           l.description,
           l.space_id,
           COUNT(m.id)::int AS item_count
         FROM libraries l
         LEFT JOIN media m ON m.library_id = l.id
         WHERE l.space_id = $1
           AND l.archived_at IS NULL
         GROUP BY l.id
         ORDER BY lower(l.name) ASC, l.id ASC`,
        [spaceId]
      )
    ]);

    res.json({
      space,
      libraries: librariesResult.rows.map((library) => ({
        ...library,
        item_count: Number(library.item_count || 0)
      })),
      members: membersResult.rows,
      invites: invitesResult.rows
    });
  } finally {
    client.release();
  }
}));

router.post('/spaces', validate(spaceCreateSchema), asyncHandler(async (req, res) => {
  const { name, slug, description, owner_user_id: ownerUserIdRaw } = req.body;
  const ownerUserId = Number(ownerUserIdRaw || req.user.id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (slug) {
      const existingSlug = await client.query(
        `SELECT id
         FROM spaces
         WHERE archived_at IS NULL
           AND lower(slug) = lower($1)
         LIMIT 1`,
        [slug]
      );
      if (existingSlug.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Space slug is already in use' });
      }
    }

    const ownerLookup = await client.query(
      `SELECT id, email, name
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [ownerUserId]
    );
    if (ownerLookup.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Owner user not found' });
    }

    const created = await client.query(
      `INSERT INTO spaces (name, slug, description, created_by, is_personal)
       VALUES ($1, $2, $3, $4, false)
       RETURNING id, name, slug, description, created_by, is_personal, created_at, updated_at, archived_at`,
      [name.trim(), slug || null, description || null, req.user.id]
    );
    const space = created.rows[0];

    await client.query(
      `INSERT INTO space_memberships (space_id, user_id, role, created_by)
       VALUES ($1, $2, 'owner', $3)
       ON CONFLICT (space_id, user_id) DO UPDATE
       SET role = 'owner',
           updated_at = CURRENT_TIMESTAMP,
           created_by = EXCLUDED.created_by`,
      [space.id, ownerUserId, req.user.id]
    );
    await syncLibraryMembershipsForSpaceUser(client, {
      spaceId: space.id,
      userId: ownerUserId,
      role: 'owner'
    });

    await client.query('COMMIT');

    await logActivity(req, 'admin.space.create', 'space', space.id, {
      name: space.name,
      slug: space.slug || null,
      ownerUserId,
      ownerEmail: ownerLookup.rows[0].email
    });

    res.status(201).json({
      ...space,
      owner_user_id: ownerUserId,
      owner_email: ownerLookup.rows[0].email
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

router.post('/spaces/create-with-onboarding', validate(adminSpaceCreateWithOnboardingSchema), asyncHandler(async (req, res) => {
  const {
    name,
    slug,
    description,
    owner_user_id: ownerUserIdRaw,
    initial_invites: initialInvitesRaw,
    expose_invite_tokens: exposeInviteTokensRaw
  } = req.body;
  const ownerUserId = Number(ownerUserIdRaw || req.user.id);
  const initialInvites = Array.isArray(initialInvitesRaw) ? initialInvitesRaw : [];
  const exposeInviteTokens = parseBool(exposeInviteTokensRaw, true);

  const client = await pool.connect();
  let space;
  let ownerRecord;
  try {
    await client.query('BEGIN');

    if (slug) {
      const existingSlug = await client.query(
        `SELECT id
         FROM spaces
         WHERE archived_at IS NULL
           AND lower(slug) = lower($1)
         LIMIT 1`,
        [slug]
      );
      if (existingSlug.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Space slug is already in use' });
      }
    }

    const ownerLookup = await client.query(
      `SELECT id, email, name
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [ownerUserId]
    );
    if (ownerLookup.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Owner user not found' });
    }
    ownerRecord = ownerLookup.rows[0];

    const created = await client.query(
      `INSERT INTO spaces (name, slug, description, created_by, is_personal)
       VALUES ($1, $2, $3, $4, false)
       RETURNING id, name, slug, description, created_by, is_personal, created_at, updated_at, archived_at`,
      [name.trim(), slug || null, description || null, req.user.id]
    );
    space = created.rows[0];

    await client.query(
      `INSERT INTO space_memberships (space_id, user_id, role, created_by)
       VALUES ($1, $2, 'owner', $3)
       ON CONFLICT (space_id, user_id) DO UPDATE
       SET role = 'owner',
           updated_at = CURRENT_TIMESTAMP,
           created_by = EXCLUDED.created_by`,
      [space.id, ownerUserId, req.user.id]
    );
    await syncLibraryMembershipsForSpaceUser(client, {
      spaceId: space.id,
      userId: ownerUserId,
      role: 'owner'
    });

    await client.query('COMMIT');

    await logActivity(req, 'admin.space.create', 'space', space.id, {
      name: space.name,
      slug: space.slug || null,
      ownerUserId,
      ownerEmail: ownerRecord.email,
      initialInviteCount: initialInvites.length
    });

    const invite_results = [];
    for (const inviteInput of initialInvites) {
      try {
        const nextRole = String(inviteInput?.role || 'member').trim();
        const exposeToken = parseBool(inviteInput?.expose_token, exposeInviteTokens);
        const inviteResult = await createInitialSpaceInvite({
          client,
          req,
          spaceId: space.id,
          email: inviteInput?.email,
          role: nextRole,
          exposeToken
        });
        invite_results.push(inviteResult);
      } catch (error) {
        invite_results.push({
          email: String(inviteInput?.email || '').trim().toLowerCase(),
          role: String(inviteInput?.role || 'member').trim() || 'member',
          created: false,
          error: error.message || 'Failed to create invite',
          code: 'invite_create_failed'
        });
      }
    }

    const createdCount = invite_results.filter((invite) => invite.created).length;
    const failedCount = invite_results.length - createdCount;

    res.status(201).json({
      space: {
        ...space,
        owner_user_id: ownerUserId,
        owner_email: ownerRecord.email
      },
      owner: {
        user_id: ownerRecord.id,
        email: ownerRecord.email,
        name: ownerRecord.name || null,
        role: 'owner'
      },
      invite_results,
      summary: {
        requested: initialInvites.length,
        created: createdCount,
        failed: failedCount
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

router.post('/spaces/:id/members', validate(spaceMembershipCreateSchema), asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  const targetUserId = Number(req.body.user_id);
  const nextRole = req.body.role;
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const space = await getAdminSpaceById(client, spaceId);
    if (!space) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Space not found' });
    }

    const userResult = await client.query(
      `SELECT id, email, name, role
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [targetUserId]
    );
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Target user not found' });
    }

    const existing = await client.query(
      `SELECT id
       FROM space_memberships
       WHERE space_id = $1
         AND user_id = $2
       LIMIT 1`,
      [spaceId, targetUserId]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'User is already a member of this space' });
    }

    const inserted = await client.query(
      `INSERT INTO space_memberships (space_id, user_id, role, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, space_id, user_id, role, created_by, created_at, updated_at`,
      [spaceId, targetUserId, nextRole, req.user.id]
    );
    await syncLibraryMembershipsForSpaceUser(client, { spaceId, userId: targetUserId, role: nextRole });

    await client.query('COMMIT');

    await logActivity(req, 'admin.space.member.add', 'space_membership', inserted.rows[0].id, {
      spaceId,
      spaceName: space.name,
      targetUserId,
      targetUserEmail: userResult.rows[0].email,
      role: nextRole
    });

    res.status(201).json({
      ...inserted.rows[0],
      email: userResult.rows[0].email,
      name: userResult.rows[0].name,
      user_role: userResult.rows[0].role
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

router.post('/spaces/:id/invites', validate(spaceInviteCreateSchema), asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }

  const client = await pool.connect();
  try {
    const space = await getAdminSpaceById(client, spaceId);
    if (!space) {
      return res.status(404).json({ error: 'Space not found' });
    }

    const exposeToken = parseBool(req.body?.expose_token, false);
    const inviteResult = await createInitialSpaceInvite({
      client,
      req,
      spaceId,
      email: req.body?.email,
      role: req.body?.role,
      exposeToken
    });

    if (!inviteResult.created) {
      const status = inviteResult.code === 'already_member' || inviteResult.code === 'active_invite_exists' ? 409 : 400;
      return res.status(status).json({
        error: inviteResult.error || 'Failed to create invite',
        code: inviteResult.code || 'invite_create_failed'
      });
    }

    await logActivity(req, 'admin.space.invite.create', 'invite', inviteResult.id, {
      spaceId,
      spaceName: space.name,
      email: inviteResult.email,
      role: inviteResult.role
    });

    res.status(201).json(inviteResult);
  } finally {
    client.release();
  }
}));

router.patch('/spaces/:id/invites/:inviteId/revoke', asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  const inviteId = Number(req.params.inviteId);
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }
  if (!Number.isFinite(inviteId) || inviteId <= 0) {
    return res.status(400).json({ error: 'Invalid invite id' });
  }

  const client = await pool.connect();
  try {
    const space = await getAdminSpaceById(client, spaceId);
    if (!space) {
      return res.status(404).json({ error: 'Space not found' });
    }

    const revokeResult = await client.query(
      `UPDATE invites
       SET revoked = true
       WHERE id = $1
         AND space_id = $2
         AND used = false
         AND revoked = false
       RETURNING id, email, used, revoked, used_by, used_at, expires_at, created_at, space_id, space_role`,
      [inviteId, spaceId]
    );
    if (revokeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invite not found or already inactive' });
    }

    await logActivity(req, 'admin.space.invite.revoke', 'invite', inviteId, {
      spaceId,
      spaceName: space.name,
      email: revokeResult.rows[0].email
    });

    res.json(revokeResult.rows[0]);
  } finally {
    client.release();
  }
}));

router.patch('/spaces/:id/owner', validate(adminSpaceOwnerAssignSchema), asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  const ownerUserId = Number(req.body.owner_user_id);
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const spaceResult = await client.query(
      `SELECT id, name, slug, archived_at
       FROM spaces
       WHERE id = $1
       LIMIT 1`,
      [spaceId]
    );
    if (spaceResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Space not found' });
    }

    const ownerLookup = await client.query(
      `SELECT id, email, name
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [ownerUserId]
    );
    if (ownerLookup.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Owner user not found' });
    }

    await client.query(
      `INSERT INTO space_memberships (space_id, user_id, role, created_by)
       VALUES ($1, $2, 'owner', $3)
       ON CONFLICT (space_id, user_id) DO UPDATE
       SET role = 'owner',
           updated_at = CURRENT_TIMESTAMP,
           created_by = EXCLUDED.created_by`,
      [spaceId, ownerUserId, req.user.id]
    );
    await syncLibraryMembershipsForSpaceUser(client, {
      spaceId,
      userId: ownerUserId,
      role: 'owner'
    });

    await client.query('COMMIT');

    await logActivity(req, 'admin.space.owner.assign', 'space', spaceId, {
      ownerUserId,
      ownerEmail: ownerLookup.rows[0].email
    });

    res.json({
      id: spaceResult.rows[0].id,
      name: spaceResult.rows[0].name,
      slug: spaceResult.rows[0].slug || null,
      archived_at: spaceResult.rows[0].archived_at || null,
      owner_user_id: ownerUserId,
      owner_email: ownerLookup.rows[0].email
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

router.patch('/spaces/:id/archive', validate(adminSpaceArchiveSchema), asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  const archived = Boolean(req.body.archived);
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const spaceResult = await client.query(
      `SELECT id, name, slug, archived_at
       FROM spaces
       WHERE id = $1
       LIMIT 1`,
      [spaceId]
    );
    if (spaceResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Space not found' });
    }
    const space = spaceResult.rows[0];
    if (space.slug === 'default') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'The default space cannot be archived or unarchived here' });
    }

    const libraryCountResult = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM libraries
       WHERE space_id = $1
         AND archived_at IS NULL`,
      [spaceId]
    );
    const libraryCount = Number(libraryCountResult.rows[0]?.count || 0);
    if (libraryCount > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Space still has active libraries',
        detail: 'Archive or move libraries before archiving this space',
        library_count: libraryCount
      });
    }

    const result = await client.query(
      `UPDATE spaces
       SET archived_at = CASE WHEN $2 THEN COALESCE(archived_at, NOW()) ELSE NULL END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, name, slug, description, created_by, is_personal, created_at, updated_at, archived_at`,
      [spaceId, archived]
    );
    if (archived) {
      await client.query(
        `UPDATE users
         SET active_space_id = CASE WHEN active_space_id = $2 THEN NULL ELSE active_space_id END,
             active_library_id = CASE WHEN active_space_id = $2 THEN NULL ELSE active_library_id END
         WHERE active_space_id = $1 OR active_space_id = $2`,
        [spaceId, spaceId]
      );
    }

    await client.query('COMMIT');

    await logActivity(req, archived ? 'admin.space.archive' : 'admin.space.unarchive', 'space', spaceId, {
      name: result.rows[0].name,
      slug: result.rows[0].slug || null
    });

    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

router.delete('/spaces/:id', asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const spaceResult = await client.query(
      `SELECT id, name, slug, archived_at
       FROM spaces
       WHERE id = $1
       LIMIT 1`,
      [spaceId]
    );
    if (spaceResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Space not found' });
    }
    const space = spaceResult.rows[0];
    if (space.slug === 'default') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'The default space cannot be deleted' });
    }

    const libraryCountResult = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM libraries
       WHERE space_id = $1`,
      [spaceId]
    );
    const libraryCount = Number(libraryCountResult.rows[0]?.count || 0);
    if (libraryCount > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Space still has libraries',
        detail: 'Remove or transfer libraries before deleting this space',
        library_count: libraryCount
      });
    }

    await client.query('DELETE FROM invites WHERE space_id = $1', [spaceId]);
    await client.query('DELETE FROM space_memberships WHERE space_id = $1', [spaceId]);
    await client.query(
      `UPDATE users
       SET active_space_id = CASE WHEN active_space_id = $2 THEN NULL ELSE active_space_id END,
           active_library_id = CASE WHEN active_space_id = $2 THEN NULL ELSE active_library_id END
       WHERE active_space_id = $1 OR active_space_id = $2`,
      [spaceId, spaceId]
    );
    await client.query('DELETE FROM spaces WHERE id = $1', [spaceId]);
    await client.query('COMMIT');

    await logActivity(req, 'admin.space.delete', 'space', spaceId, {
      name: space.name,
      slug: space.slug || null
    });

    res.json({ id: spaceId, deleted: true });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

// ── Activity log ──────────────────────────────────────────────────────────────
// Supports optional query filters:
// action, entity, userId, user, status, reason, from, to, q, search, limit, offset

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

  if (req.query.status) {
    const raw = String(req.query.status).trim().toLowerCase();
    if (/^\d{3}$/.test(raw)) {
      params.push(Number(raw));
      conditions.push(`(
        CASE
          WHEN (al.details->>'status') ~ '^[0-9]+$' THEN (al.details->>'status')::int
          ELSE NULL
        END
      ) = $${params.length}`);
    } else if (/^[1-5]xx$/.test(raw)) {
      const prefix = Number(raw[0]) * 100;
      params.push(prefix);
      params.push(prefix + 99);
      conditions.push(`(
        CASE
          WHEN (al.details->>'status') ~ '^[0-9]+$' THEN (al.details->>'status')::int
          ELSE NULL
        END
      ) BETWEEN $${params.length - 1} AND $${params.length}`);
    } else if (raw === 'has_status') {
      conditions.push(`(al.details->>'status') IS NOT NULL`);
    }
  }

  if (req.query.reason) {
    const reason = String(req.query.reason).trim();
    if (reason) {
      params.push(`%${reason}%`);
      conditions.push(`COALESCE(al.details->>'reason', '') ILIKE $${params.length}`);
    }
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
        OR COALESCE(al.details->>'reason', '') ILIKE ${token}
        OR COALESCE(al.details->>'status', '') ILIKE ${token}
        OR al.details::text ILIKE ${token}
        OR EXISTS (SELECT 1 FROM users u3 WHERE u3.id = al.user_id AND u3.email ILIKE ${token})
      )`);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  params.push(offset);

  const result = await pool.query(
    `SELECT al.id, al.user_id, al.action, al.entity_type, al.entity_id, al.details,
            al.details->>'reason' AS details_reason,
            al.details->>'status' AS details_status,
            al.ip_address, al.created_at,
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

router.use(enforceScopeAccess({ allowedHintRoles: ['admin'] }));

router.get('/users', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT
       u.id,
       u.email,
       u.name,
       u.role,
       u.created_at,
       COALESCE(
         json_agg(
           DISTINCT jsonb_build_object(
             'space_id', s.id,
             'name', s.name,
             'slug', s.slug,
             'role', sm.role
           )
         ) FILTER (WHERE s.id IS NOT NULL),
         '[]'::json
       ) AS spaces
     FROM users u
     LEFT JOIN space_memberships sm ON sm.user_id = u.id
     LEFT JOIN spaces s ON s.id = sm.space_id AND s.archived_at IS NULL
     GROUP BY u.id
     ORDER BY u.created_at DESC`
  );
  res.json(result.rows.map((row) => ({
    ...row,
    spaces: Array.isArray(row.spaces) ? row.spaces : []
  })));
}));

router.get('/users/:id/summary', asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  const userResult = await pool.query(
    'SELECT id, email, name, role, created_at, active_space_id, active_library_id FROM users WHERE id = $1',
    [userId]
  );
  if (userResult.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const [loginResult, membershipResult, spacesResult] = await Promise.all([
    pool.query(
      `SELECT MAX(created_at) AS last_login_at
       FROM activity_log
       WHERE user_id = $1
         AND action = 'auth.user.login'`,
      [userId]
    ),
    pool.query(
      `SELECT
         COUNT(*)::int AS membership_count,
         COUNT(*) FILTER (WHERE role = 'owner')::int AS owner_count,
         COUNT(*) FILTER (WHERE role = 'admin')::int AS admin_count
       FROM space_memberships
       WHERE user_id = $1`,
      [userId]
    ),
    pool.query(
      `SELECT
         s.id AS space_id,
         s.name,
         s.slug,
         sm.role
       FROM space_memberships sm
       JOIN spaces s ON s.id = sm.space_id
       WHERE sm.user_id = $1
         AND s.archived_at IS NULL
       ORDER BY lower(s.name) ASC, s.id ASC`,
      [userId]
    )
  ]);

  res.json({
    user: userResult.rows[0],
    metrics: {
      lastLoginAt: loginResult.rows[0]?.last_login_at || null,
      membershipCount: Number(membershipResult.rows[0]?.membership_count || 0),
      ownerCount: Number(membershipResult.rows[0]?.owner_count || 0),
      adminCount: Number(membershipResult.rows[0]?.admin_count || 0)
    },
    spaces: Array.isArray(spacesResult.rows) ? spacesResult.rows : []
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
  const resetUrl = `${getRequestOrigin(req)}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  const exposeToken = parseBool(req.body?.expose_token, false);
  await logActivity(req, 'admin.user.password_reset.create', 'user', userId, {
    email,
    resetTokenId: insert.rows[0].id,
    expiresAt
  });
  if (exposeToken) {
    await logActivity(req, 'admin.user.password_reset.token_exposed', 'user', userId, {
      email,
      resetTokenId: insert.rows[0].id,
      exposureMode: 'admin_copy_link'
    });
  }
  let delivery = { attempted: false, sent: false, reason: 'smtp_not_configured' };
  try {
    delivery = await sendPasswordResetEmail({
      to: email,
      resetUrl,
      expiresAt: insert.rows[0].expires_at
    });
    if (delivery.sent) {
      await logActivity(req, 'admin.user.password_reset.delivered', 'user', userId, {
        email,
        resetTokenId: insert.rows[0].id,
        delivery: 'smtp'
      });
    }
  } catch (error) {
    delivery = { attempted: true, sent: false, reason: error.message || 'smtp_send_failed' };
    await logActivity(req, 'admin.user.password_reset.delivery_failed', 'user', userId, {
      email,
      resetTokenId: insert.rows[0].id,
      reason: delivery.reason
    });
  }
  res.status(201).json({
    id: insert.rows[0].id,
    user_id: userId,
    email,
    expires_at: insert.rows[0].expires_at,
    delivery,
    ...(exposeToken ? { reset_url: resetUrl, token } : {})
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

module.exports = router;
