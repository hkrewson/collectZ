const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken, requireSessionAuth } = require('../middleware/auth');
const {
  validate,
  spaceCreateSchema,
  spaceUpdateSchema,
  spaceMembershipCreateSchema,
  spaceMembershipUpdateSchema,
  spaceMembershipSuspensionSchema,
  spaceInviteCreateSchema,
  spaceTransferCreateSchema,
  generalSettingsSchema
} = require('../middleware/validate');
const { logActivity } = require('../services/audit');
const { sendInviteEmail, sendPasswordResetEmail } = require('../services/email');
const { hashInviteToken } = require('../services/invites');
const { getRequestOrigin } = require('../services/requestOrigin');
const { issuePasswordResetToken } = require('../services/passwordResets');
const {
  listLibrariesForSpace,
  syncLibraryMembershipsForSpaceUser,
  removeLibraryMembershipsForSpaceUser,
  countOwnedLibrariesInSpace,
  moveOwnedLibrariesToSpace
} = require('../services/libraries');
const {
  listAccessibleSpacesForUser,
  getAccessibleSpaceForUser,
  getSpaceMembershipForUser,
  isGlobalAdmin,
  canManageSpaceMemberships,
  canAssignSpaceRole,
  countSpaceOwners,
  listSpaceMembers
} = require('../services/spaces');
const { loadGeneralSettings, updateScopedGeneralSettings } = require('../services/integrations');
const {
  listSpaceFeatureFlags,
  getSpaceFeatureFlag,
  updateSpaceFeatureFlag,
  FEATURE_FLAGS_READ_ONLY
} = require('../services/featureFlags');

const router = express.Router();

router.use(authenticateToken);

async function requireAccessibleSpace(client, req, spaceId) {
  if (req.user?.role === 'admin' && Number(req.user?.supportSpaceId || 0) === Number(spaceId || 0)) {
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
         'admin'::varchar AS membership_role
       FROM spaces s
       WHERE s.id = $1
         AND s.archived_at IS NULL
       LIMIT 1`,
      [spaceId]
    );
    const supportSpace = result.rows[0] || null;
    if (!supportSpace) return null;
    return {
      ...supportSpace,
      actor_membership_role: 'admin'
    };
  }

  const space = await getAccessibleSpaceForUser(client, {
    userId: req.user.id,
    role: req.user.role,
    spaceId
  });
  if (!space) return null;
  const membership = isGlobalAdmin(req.user.role)
    ? null
    : await getSpaceMembershipForUser(client, { userId: req.user.id, spaceId });
  return {
    ...space,
    actor_membership_role: membership?.role || space.membership_role || null
  };
}

function canRemoveMembership({ actorUserRole, actorMembershipRole, targetRole }) {
  if (actorMembershipRole === 'owner') return ['admin', 'member', 'viewer'].includes(targetRole);
  if (actorMembershipRole === 'admin') return ['member', 'viewer'].includes(targetRole);
  return false;
}

function canManageMemberLifecycle({ actorMembershipRole, targetRole }) {
  if (actorMembershipRole === 'owner') return ['admin', 'member', 'viewer'].includes(targetRole);
  if (actorMembershipRole === 'admin') return ['member', 'viewer'].includes(targetRole);
  return false;
}

function parseBool(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

router.get('/spaces', asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const spaces = await listAccessibleSpacesForUser(client, {
      userId: req.user.id,
      role: req.user.role
    });
    res.json({
      spaces: spaces.map((space) => ({
        id: space.id,
        name: space.name,
        slug: space.slug || null,
        description: space.description || null,
        created_by: space.created_by || null,
        is_personal: Boolean(space.is_personal),
        created_at: space.created_at,
        updated_at: space.updated_at,
        membership_role: space.membership_role || null,
        library_count: Number(space.library_count || 0)
      }))
    });
  } finally {
    client.release();
  }
}));

router.post('/spaces', validate(spaceCreateSchema), asyncHandler(async (req, res) => {
  if (!isGlobalAdmin(req.user.role)) {
    return res.status(403).json({ error: 'Only global admins can create spaces' });
  }

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

    await client.query('COMMIT');

    await logActivity(req, 'space.create', 'space', space.id, {
      name: space.name,
      slug: space.slug || null,
      ownerUserId,
      ownerEmail: ownerLookup.rows[0].email
    });

    res.status(201).json({
      ...space,
      membership_role: ownerUserId === req.user.id ? 'owner' : null,
      owner_user_id: ownerUserId
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

router.patch('/spaces/:id', validate(spaceUpdateSchema), asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const accessibleSpace = await requireAccessibleSpace(client, req, spaceId);
    if (!accessibleSpace) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Space not found' });
    }
    if (!canManageSpaceMemberships({
      userRole: req.user.role,
      membershipRole: accessibleSpace.actor_membership_role
    })) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Space management denied' });
    }

    const updates = [];
    const values = [];

    if (req.body.name !== undefined) {
      values.push(req.body.name.trim());
      updates.push(`name = $${values.length}`);
    }
    if (req.body.slug !== undefined) {
      if (req.body.slug) {
        const existingSlug = await client.query(
          `SELECT id
           FROM spaces
           WHERE archived_at IS NULL
             AND lower(slug) = lower($1)
             AND id <> $2
           LIMIT 1`,
          [req.body.slug, spaceId]
        );
        if (existingSlug.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Space slug is already in use' });
        }
      }
      values.push(req.body.slug || null);
      updates.push(`slug = $${values.length}`);
    }
    if (req.body.description !== undefined) {
      values.push(req.body.description || null);
      updates.push(`description = $${values.length}`);
    }

    if (updates.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No valid space fields provided' });
    }

    values.push(spaceId);
    const result = await client.query(
      `UPDATE spaces
       SET ${updates.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, name, slug, description, created_by, is_personal, created_at, updated_at, archived_at`,
      values
    );
    await client.query('COMMIT');

    await logActivity(req, 'space.update', 'space', spaceId, {
      fields: updates.map((entry) => entry.split(' = ')[0])
    });

    res.json({
      ...result.rows[0],
      membership_role: accessibleSpace.actor_membership_role || null
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

router.get('/spaces/:id/settings/general', asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }

  const client = await pool.connect();
  try {
    const accessibleSpace = await requireAccessibleSpace(client, req, spaceId);
    if (!accessibleSpace) {
      return res.status(404).json({ error: 'Space not found' });
    }
    const settings = await loadGeneralSettings(spaceId);
    res.json(settings);
  } finally {
    client.release();
  }
}));

router.put('/spaces/:id/settings/general', validate(generalSettingsSchema), asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }

  const client = await pool.connect();
  try {
    const accessibleSpace = await requireAccessibleSpace(client, req, spaceId);
    if (!accessibleSpace) {
      return res.status(404).json({ error: 'Space not found' });
    }
    if (!canManageSpaceMemberships({
      userRole: req.user.role,
      membershipRole: accessibleSpace.actor_membership_role
    })) {
      return res.status(403).json({ error: 'Space management denied' });
    }
    const updated = await updateScopedGeneralSettings({
      spaceId,
      theme: req.body.theme,
      density: req.body.density
    });
    await logActivity(req, 'space.settings.general.update', 'space', spaceId, {
      theme: updated.theme,
      density: updated.density
    });
    res.json(updated);
  } finally {
    client.release();
  }
}));

router.get('/spaces/:id/feature-flags', asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }

  const client = await pool.connect();
  try {
    const accessibleSpace = await requireAccessibleSpace(client, req, spaceId);
    if (!accessibleSpace) {
      return res.status(404).json({ error: 'Space not found' });
    }
    if (!canManageSpaceMemberships({
      userRole: req.user.role,
      membershipRole: accessibleSpace.actor_membership_role
    })) {
      return res.status(403).json({ error: 'Space management denied' });
    }
    const flags = await listSpaceFeatureFlags(spaceId);
    res.json({ readOnly: FEATURE_FLAGS_READ_ONLY, flags });
  } finally {
    client.release();
  }
}));

router.patch('/spaces/:id/feature-flags/:key', asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  const key = String(req.params.key || '').trim();
  const { enabled } = req.body || {};
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }
  if (!key) {
    return res.status(400).json({ error: 'Feature flag key is required' });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be boolean' });
  }

  const client = await pool.connect();
  try {
    const accessibleSpace = await requireAccessibleSpace(client, req, spaceId);
    if (!accessibleSpace) {
      return res.status(404).json({ error: 'Space not found' });
    }
    if (!canManageSpaceMemberships({
      userRole: req.user.role,
      membershipRole: accessibleSpace.actor_membership_role
    })) {
      return res.status(403).json({ error: 'Space management denied' });
    }

    const previous = await getSpaceFeatureFlag(spaceId, key);
    if (!previous) {
      return res.status(404).json({ error: `Unknown feature flag: ${key}` });
    }
    const updated = await updateSpaceFeatureFlag({ spaceId, key, enabled, updatedBy: req.user?.id || null });
    await logActivity(req, 'space.feature_flag.update', 'space', spaceId, {
      key,
      previousEnabled: previous.enabled,
      nextEnabled: updated.enabled,
      envOverride: updated.envOverride
    });
    res.json(updated);
  } finally {
    client.release();
  }
}));

router.get('/spaces/:id/activity', asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }

  const client = await pool.connect();
  try {
    const accessibleSpace = await requireAccessibleSpace(client, req, spaceId);
    if (!accessibleSpace) {
      return res.status(404).json({ error: 'Space not found' });
    }

    const requestedLimit = Number(req.query.limit || 50);
    const requestedOffset = Number(req.query.offset || 0);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 100)
      : 50;
    const offset = Number.isFinite(requestedOffset)
      ? Math.max(Math.trunc(requestedOffset), 0)
      : 0;

    const params = [spaceId];
    const conditions = [
      `(
        (al.entity_type = 'space' AND al.entity_id = $1)
        OR COALESCE(al.details->>'spaceId', '') = $1::text
        OR COALESCE(al.details->>'targetSpaceId', '') = $1::text
        OR COALESCE(al.details->>'sourceSpaceId', '') = $1::text
        OR COALESCE(al.details->>'previousSpaceId', '') = $1::text
        OR (al.entity_type = 'library' AND EXISTS (
          SELECT 1 FROM libraries l WHERE l.id = al.entity_id AND l.space_id = $1
        ))
        OR (al.entity_type = 'media' AND EXISTS (
          SELECT 1 FROM media m WHERE m.id = al.entity_id AND m.space_id = $1
        ))
        OR (al.entity_type = 'collection' AND EXISTS (
          SELECT 1 FROM collections c WHERE c.id = al.entity_id AND c.space_id = $1
        ))
        OR (al.entity_type = 'event' AND EXISTS (
          SELECT 1 FROM events e WHERE e.id = al.entity_id AND e.space_id = $1
        ))
        OR (al.entity_type = 'collectible' AND EXISTS (
          SELECT 1 FROM collectibles c WHERE c.id = al.entity_id AND c.space_id = $1
        ))
        OR (al.entity_type = 'invite' AND EXISTS (
          SELECT 1 FROM invites i WHERE i.id = al.entity_id AND i.space_id = $1
        ))
      )`
    ];

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

    const result = await client.query(
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
  } finally {
    client.release();
  }
}));

router.post('/spaces/select', requireSessionAuth, asyncHandler(async (req, res) => {
  if (req.user.role === 'admin') {
    return res.status(403).json({ error: 'Global admins must use explicit support-session controls instead of generic space selection' });
  }

  const spaceId = Number(req.body?.space_id || 0);
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'space_id must be a positive integer' });
  }

  const client = await pool.connect();
  try {
    const accessibleSpace = await requireAccessibleSpace(client, req, spaceId);
    if (!accessibleSpace) {
      return res.status(404).json({ error: 'Space not found' });
    }

    const libraries = await listLibrariesForSpace({
      userId: req.user.id,
      role: req.user.role,
      spaceId
    });
    const nextLibraryId = libraries.find((library) => Number(library.id) === Number(req.user.activeLibraryId || 0))?.id
      || libraries[0]?.id
      || null;

    await pool.query(
      `UPDATE users
       SET active_space_id = $2,
           active_library_id = $3
       WHERE id = $1`,
      [req.user.id, spaceId, nextLibraryId]
    );
    req.user.scopeSpaceId = spaceId;
    req.user.activeSpaceId = spaceId;
    req.user.activeLibraryId = nextLibraryId;

    await logActivity(req, 'space.select', 'space', spaceId, {
      activeLibraryId: nextLibraryId
    });

    res.json({
      active_space_id: spaceId,
      active_library_id: nextLibraryId,
      space: accessibleSpace,
      libraries
    });
  } finally {
    client.release();
  }
}));

router.get('/spaces/:id/members', asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }

  const client = await pool.connect();
  try {
    const accessibleSpace = await requireAccessibleSpace(client, req, spaceId);
    if (!accessibleSpace) {
      return res.status(404).json({ error: 'Space not found' });
    }
    if (!canManageSpaceMemberships({
      userRole: req.user.role,
      membershipRole: accessibleSpace.actor_membership_role
    })) {
      return res.status(403).json({ error: 'Space membership access denied' });
    }

    const members = await listSpaceMembers(client, { spaceId });
    res.json({
      space: {
        id: accessibleSpace.id,
        name: accessibleSpace.name,
        slug: accessibleSpace.slug || null,
        membership_role: accessibleSpace.actor_membership_role || accessibleSpace.membership_role || null
      },
      members
    });
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
    const accessibleSpace = await requireAccessibleSpace(client, req, spaceId);
    if (!accessibleSpace) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Space not found' });
    }
    if (!canManageSpaceMemberships({
      userRole: req.user.role,
      membershipRole: accessibleSpace.actor_membership_role
    })) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Space membership management denied' });
    }
    if (!canAssignSpaceRole({
      actorUserRole: req.user.role,
      actorMembershipRole: accessibleSpace.actor_membership_role,
      nextRole
    })) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Role assignment denied' });
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
    await syncLibraryMembershipsForSpaceUser(client, { spaceId, userId: targetUserId });
    await client.query('COMMIT');

    await logActivity(req, 'space.member.add', 'space_membership', inserted.rows[0].id, {
      targetUserId,
      targetUserEmail: userResult.rows[0].email,
      role: nextRole,
      spaceId
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

router.patch('/spaces/:id/members/:memberId', validate(spaceMembershipUpdateSchema), asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  const membershipId = Number(req.params.memberId);
  const nextRole = req.body.role;
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }
  if (!Number.isFinite(membershipId) || membershipId <= 0) {
    return res.status(400).json({ error: 'Invalid member id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const accessibleSpace = await requireAccessibleSpace(client, req, spaceId);
    if (!accessibleSpace) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Space not found' });
    }
    if (!canManageSpaceMemberships({
      userRole: req.user.role,
      membershipRole: accessibleSpace.actor_membership_role
    })) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Space membership management denied' });
    }
    if (!canAssignSpaceRole({
      actorUserRole: req.user.role,
      actorMembershipRole: accessibleSpace.actor_membership_role,
      nextRole
    })) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Role assignment denied' });
    }

    const current = await client.query(
    `SELECT sm.id, sm.space_id, sm.user_id, sm.role, u.email, u.name, u.role AS user_role
            , sm.suspended_at, sm.suspended_by
       FROM space_memberships sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.id = $1
         AND sm.space_id = $2
       LIMIT 1`,
      [membershipId, spaceId]
    );
    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Space member not found' });
    }
    if (current.rows[0].role === 'owner' && nextRole !== 'owner') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Space owners cannot be demoted through tenant space management' });
    }
    const updated = await client.query(
      `UPDATE space_memberships
       SET role = $3
       WHERE id = $1
         AND space_id = $2
       RETURNING id, space_id, user_id, role, created_by, created_at, updated_at`,
      [membershipId, spaceId, nextRole]
    );
    await client.query('COMMIT');

    await logActivity(req, 'space.member.update', 'space_membership', membershipId, {
      targetUserId: current.rows[0].user_id,
      targetUserEmail: current.rows[0].email,
      previousRole: current.rows[0].role,
      nextRole,
      spaceId
    });

    res.json({
      ...updated.rows[0],
      email: current.rows[0].email,
      name: current.rows[0].name,
      user_role: current.rows[0].user_role,
      suspended_at: current.rows[0].suspended_at || null,
      suspended_by: current.rows[0].suspended_by || null
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

router.patch('/spaces/:id/members/:memberId/suspension', validate(spaceMembershipSuspensionSchema), asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  const membershipId = Number(req.params.memberId);
  const nextSuspended = Boolean(req.body?.suspended);
  const actorUserId = Number(req.user?.id || 0) || null;
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }
  if (!Number.isFinite(membershipId) || membershipId <= 0) {
    return res.status(400).json({ error: 'Invalid member id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const accessibleSpace = await requireAccessibleSpace(client, req, spaceId);
    if (!accessibleSpace) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Space not found' });
    }
    if (!canManageSpaceMemberships({
      userRole: req.user.role,
      membershipRole: accessibleSpace.actor_membership_role
    })) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Space membership management denied' });
    }

    const current = await client.query(
      `SELECT sm.id, sm.space_id, sm.user_id, sm.role, sm.suspended_at, sm.suspended_by, u.email, u.name, u.role AS user_role
       FROM space_memberships sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.id = $1
         AND sm.space_id = $2
       LIMIT 1`,
      [membershipId, spaceId]
    );
    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Space member not found' });
    }

    const target = current.rows[0];
    if (!canManageMemberLifecycle({
      actorMembershipRole: accessibleSpace.actor_membership_role,
      targetRole: target.role
    })) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: nextSuspended ? 'Suspension denied for this workspace member' : 'Restore denied for this workspace member' });
    }
    if (nextSuspended === Boolean(target.suspended_at)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: nextSuspended ? 'Workspace member is already suspended' : 'Workspace member is not suspended' });
    }

    const updated = await client.query(
      `UPDATE space_memberships
       SET suspended_at = CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END,
           suspended_by = CASE WHEN $3 THEN $4::integer ELSE NULL END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND space_id = $2
       RETURNING id, space_id, user_id, role, created_by, created_at, updated_at, suspended_at, suspended_by`,
      [membershipId, spaceId, nextSuspended, actorUserId]
    );

    if (nextSuspended) {
      await client.query(
        `UPDATE users
         SET active_space_id = CASE WHEN active_space_id = $2 THEN NULL ELSE active_space_id END,
             active_library_id = CASE WHEN active_space_id = $2 THEN NULL ELSE active_library_id END
         WHERE id = $1`,
        [target.user_id, spaceId]
      );
    }

    await client.query('COMMIT');

    await logActivity(req, nextSuspended ? 'space.member.suspend' : 'space.member.restore', 'space_membership', membershipId, {
      targetUserId: target.user_id,
      targetUserEmail: target.email,
      targetUserName: target.name || null,
      role: target.role,
      spaceId
    });

    res.json({
      ...updated.rows[0],
      email: target.email,
      name: target.name,
      user_role: target.user_role
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

router.post('/spaces/:id/members/:memberId/password-reset', asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  const membershipId = Number(req.params.memberId);
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }
  if (!Number.isFinite(membershipId) || membershipId <= 0) {
    return res.status(400).json({ error: 'Invalid member id' });
  }

  const client = await pool.connect();
  try {
    const accessibleSpace = await requireAccessibleSpace(client, req, spaceId);
    if (!accessibleSpace) {
      return res.status(404).json({ error: 'Space not found' });
    }
    if (!canManageSpaceMemberships({
      userRole: req.user.role,
      membershipRole: accessibleSpace.actor_membership_role
    })) {
      return res.status(403).json({ error: 'Space membership management denied' });
    }

    const current = await client.query(
      `SELECT sm.id, sm.space_id, sm.user_id, sm.role, u.email, u.name
       FROM space_memberships sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.id = $1
         AND sm.space_id = $2
       LIMIT 1`,
      [membershipId, spaceId]
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Space member not found' });
    }

    const target = current.rows[0];
    if (!canManageMemberLifecycle({
      actorMembershipRole: accessibleSpace.actor_membership_role,
      targetRole: target.role
    })) {
      return res.status(403).json({ error: 'Password reset denied for this workspace member' });
    }

    const exposeToken = parseBool(req.body?.expose_token, false);
    const issued = await issuePasswordResetToken({
      userId: target.user_id,
      createdBy: req.user.id
    });
    const resetUrl = `${getRequestOrigin(req)}/reset-password?token=${encodeURIComponent(issued.token)}&email=${encodeURIComponent(target.email)}`;

    await logActivity(req, 'space.member.password_reset.create', 'user', target.user_id, {
      email: target.email,
      name: target.name || null,
      spaceId,
      spaceName: accessibleSpace.name,
      membershipId,
      memberRole: target.role,
      resetTokenId: issued.id,
      expiresAt: issued.expires_at
    });
    if (exposeToken) {
      await logActivity(req, 'space.member.password_reset.token_exposed', 'user', target.user_id, {
        email: target.email,
        spaceId,
        spaceName: accessibleSpace.name,
        membershipId,
        memberRole: target.role,
        resetTokenId: issued.id,
        exposureMode: 'workspace_copy_link'
      });
    }

    let delivery = { attempted: false, sent: false, reason: 'smtp_not_configured' };
    try {
      delivery = await sendPasswordResetEmail({
        to: target.email,
        resetUrl,
        expiresAt: issued.expires_at
      });
      if (delivery.sent) {
        await logActivity(req, 'space.member.password_reset.delivered', 'user', target.user_id, {
          email: target.email,
          spaceId,
          spaceName: accessibleSpace.name,
          membershipId,
          memberRole: target.role,
          resetTokenId: issued.id,
          delivery: 'smtp'
        });
      }
    } catch (error) {
      delivery = { attempted: true, sent: false, reason: error.message || 'smtp_send_failed' };
      await logActivity(req, 'space.member.password_reset.delivery_failed', 'user', target.user_id, {
        email: target.email,
        spaceId,
        spaceName: accessibleSpace.name,
        membershipId,
        memberRole: target.role,
        resetTokenId: issued.id,
        reason: delivery.reason
      });
    }

    res.status(201).json({
      id: issued.id,
      user_id: target.user_id,
      membership_id: membershipId,
      email: target.email,
      role: target.role,
      expires_at: issued.expires_at,
      delivery,
      ...(exposeToken ? { reset_url: resetUrl, token: issued.token } : {})
    });
  } finally {
    client.release();
  }
}));

router.delete('/spaces/:id/members/:memberId', asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  const membershipId = Number(req.params.memberId);
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }
  if (!Number.isFinite(membershipId) || membershipId <= 0) {
    return res.status(400).json({ error: 'Invalid member id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const accessibleSpace = await requireAccessibleSpace(client, req, spaceId);
    if (!accessibleSpace) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Space not found' });
    }
    if (!canManageSpaceMemberships({
      userRole: req.user.role,
      membershipRole: accessibleSpace.actor_membership_role
    })) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Space membership management denied' });
    }

    const current = await client.query(
      `SELECT sm.id, sm.space_id, sm.user_id, sm.role, u.email
       FROM space_memberships sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.id = $1
         AND sm.space_id = $2
       LIMIT 1`,
      [membershipId, spaceId]
    );
    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Space member not found' });
    }

    if (!canRemoveMembership({
      actorUserRole: req.user.role,
      actorMembershipRole: accessibleSpace.actor_membership_role,
      targetRole: current.rows[0].role
    })) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Membership removal denied' });
    }

    if (current.rows[0].role === 'owner') {
      const ownerCount = await countSpaceOwners(client, { spaceId });
      if (ownerCount <= 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Each space must retain at least one owner' });
      }
    }
    const ownedLibraryCount = await countOwnedLibrariesInSpace(client, {
      spaceId,
      userId: current.rows[0].user_id
    });
    if (ownedLibraryCount > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'User owns libraries in this space',
        detail: 'Use the explicit transfer flow before removing this user from the space',
        owned_library_count: ownedLibraryCount
      });
    }

    await client.query(
      `DELETE FROM space_memberships
       WHERE id = $1
         AND space_id = $2`,
      [membershipId, spaceId]
    );
    await removeLibraryMembershipsForSpaceUser(client, {
      spaceId,
      userId: current.rows[0].user_id,
      preserveOwned: false
    });
    await client.query(
      `UPDATE users
       SET active_space_id = CASE WHEN active_space_id = $2 THEN NULL ELSE active_space_id END,
           active_library_id = CASE WHEN active_space_id = $2 THEN NULL ELSE active_library_id END
       WHERE id = $1`,
      [current.rows[0].user_id, spaceId]
    );
    await client.query('COMMIT');

    await logActivity(req, 'space.member.remove', 'space_membership', membershipId, {
      targetUserId: current.rows[0].user_id,
      targetUserEmail: current.rows[0].email,
      previousRole: current.rows[0].role,
      spaceId
    });

    res.json({ id: membershipId, removed: true });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

router.get('/spaces/:id/invites', asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }

  const client = await pool.connect();
  try {
    const accessibleSpace = await requireAccessibleSpace(client, req, spaceId);
    if (!accessibleSpace) {
      return res.status(404).json({ error: 'Space not found' });
    }
    if (!canManageSpaceMemberships({
      userRole: req.user.role,
      membershipRole: accessibleSpace.actor_membership_role
    })) {
      return res.status(403).json({ error: 'Space invite access denied' });
    }

    const invites = await client.query(
      `SELECT i.id, i.email, i.used, i.revoked, i.used_by, i.used_at,
              i.expires_at, i.created_at, i.space_id, i.space_role,
              creator.email AS created_by_email,
              claimer.email AS used_by_email
       FROM invites i
       LEFT JOIN users creator ON creator.id = i.created_by
       LEFT JOIN users claimer ON claimer.id = i.used_by
       WHERE i.space_id = $1
       ORDER BY i.created_at DESC`,
      [spaceId]
    );
    res.json({
      space: {
        id: accessibleSpace.id,
        name: accessibleSpace.name,
        slug: accessibleSpace.slug || null,
        membership_role: accessibleSpace.actor_membership_role || accessibleSpace.membership_role || null
      },
      invites: invites.rows
    });
  } finally {
    client.release();
  }
}));

router.post('/spaces/:id/invites', validate(spaceInviteCreateSchema), asyncHandler(async (req, res) => {
  const spaceId = Number(req.params.id);
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }

  const { email, role: nextRole } = req.body;
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const exposeToken = parseBool(req.body?.expose_token, false);

  const client = await pool.connect();
  try {
    const accessibleSpace = await requireAccessibleSpace(client, req, spaceId);
    if (!accessibleSpace) {
      return res.status(404).json({ error: 'Space not found' });
    }
    if (!canManageSpaceMemberships({
      userRole: req.user.role,
      membershipRole: accessibleSpace.actor_membership_role
    })) {
      return res.status(403).json({ error: 'Space invite management denied' });
    }
    if (!canAssignSpaceRole({
      actorUserRole: req.user.role,
      actorMembershipRole: accessibleSpace.actor_membership_role,
      nextRole
    })) {
      return res.status(403).json({ error: 'Invite role assignment denied' });
    }

    const result = await client.query(
      `INSERT INTO invites (email, token_hash, expires_at, created_by, space_id, space_role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, used, revoked, used_by, used_at, expires_at, created_at, space_id, space_role`,
      [email, tokenHash, expiresAt, req.user.id, spaceId, nextRole]
    );
    const invite = result.rows[0];
    const inviteUrl = `${getRequestOrigin(req)}/register?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(invite.email)}`;

    await logActivity(req, 'space.invite.create', 'invite', invite.id, {
      email: invite.email,
      role: nextRole,
      spaceId,
      expiresAt: invite.expires_at
    });
    if (exposeToken) {
      await logActivity(req, 'space.invite.token_exposed', 'invite', invite.id, {
        email: invite.email,
        role: nextRole,
        spaceId,
        exposureMode: 'space_admin_copy_link'
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
          role: nextRole,
          spaceId,
          delivery: 'smtp'
        });
      }
    } catch (error) {
      delivery = { attempted: true, sent: false, reason: error.message || 'smtp_send_failed' };
      await logActivity(req, 'space.invite.delivery_failed', 'invite', invite.id, {
        email: invite.email,
        role: nextRole,
        spaceId,
        reason: delivery.reason
      });
    }

    res.status(201).json({
      ...invite,
      delivery,
      ...(exposeToken ? { token, invite_url: inviteUrl } : {})
    });
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
    const accessibleSpace = await requireAccessibleSpace(client, req, spaceId);
    if (!accessibleSpace) {
      return res.status(404).json({ error: 'Space not found' });
    }
    if (!canManageSpaceMemberships({
      userRole: req.user.role,
      membershipRole: accessibleSpace.actor_membership_role
    })) {
      return res.status(403).json({ error: 'Space invite management denied' });
    }

    const result = await client.query(
      `UPDATE invites
       SET revoked = true
       WHERE id = $1
         AND space_id = $2
         AND used = false
         AND revoked = false
       RETURNING id, email, space_id, space_role, used, revoked, expires_at, created_at`,
      [inviteId, spaceId]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invite cannot be revoked' });
    }

    await logActivity(req, 'space.invite.revoke', 'invite', inviteId, {
      email: result.rows[0].email,
      role: result.rows[0].space_role || null,
      spaceId
    });
    res.json(result.rows[0]);
  } finally {
    client.release();
  }
}));

router.post('/spaces/:id/members/:memberId/transfer-new-space', validate(spaceTransferCreateSchema), asyncHandler(async (req, res) => {
  const sourceSpaceId = Number(req.params.id);
  const membershipId = Number(req.params.memberId);
  if (!Number.isFinite(sourceSpaceId) || sourceSpaceId <= 0) {
    return res.status(400).json({ error: 'Invalid space id' });
  }
  if (!Number.isFinite(membershipId) || membershipId <= 0) {
    return res.status(400).json({ error: 'Invalid member id' });
  }
  if (!isGlobalAdmin(req.user.role)) {
    return res.status(403).json({ error: 'Only global admins can transfer members into a new space' });
  }

  const { name, slug, description } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sourceMembership = await client.query(
      `SELECT sm.id, sm.space_id, sm.user_id, sm.role, u.email, u.name
       FROM space_memberships sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.id = $1
         AND sm.space_id = $2
       LIMIT 1`,
      [membershipId, sourceSpaceId]
    );
    if (sourceMembership.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Space member not found' });
    }
    if (sourceMembership.rows[0].role === 'owner') {
      const sourceOwnerCount = await countSpaceOwners(client, { spaceId: sourceSpaceId });
      if (sourceOwnerCount <= 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Each space must retain at least one owner',
          detail: 'Add another owner before transferring this user into a new space'
        });
      }
    }

    const existingSlug = slug
      ? await client.query(
          `SELECT id
           FROM spaces
           WHERE archived_at IS NULL
             AND lower(slug) = lower($1)
           LIMIT 1`,
          [slug]
        )
      : { rows: [] };
    if (existingSlug.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Space slug is already in use' });
    }

    const created = await client.query(
      `INSERT INTO spaces (name, slug, description, created_by, is_personal)
       VALUES ($1, $2, $3, $4, false)
       RETURNING id, name, slug, description, created_by, is_personal, created_at, updated_at, archived_at`,
      [name.trim(), slug || null, description || null, req.user.id]
    );
    const newSpace = created.rows[0];

    await client.query(
      `INSERT INTO space_memberships (space_id, user_id, role, created_by)
       VALUES ($1, $2, 'owner', $3)
       ON CONFLICT (space_id, user_id) DO UPDATE
       SET role = 'owner',
           updated_at = CURRENT_TIMESTAMP,
           created_by = EXCLUDED.created_by`,
      [newSpace.id, sourceMembership.rows[0].user_id, req.user.id]
    );

    const movedLibraryIds = await moveOwnedLibrariesToSpace(client, {
      sourceSpaceId,
      targetSpaceId: newSpace.id,
      userId: sourceMembership.rows[0].user_id
    });

    const remainingOwnedLibraryCount = await countOwnedLibrariesInSpace(client, {
      spaceId: sourceSpaceId,
      userId: sourceMembership.rows[0].user_id
    });
    if (remainingOwnedLibraryCount === 0) {
      await client.query(
        `DELETE FROM space_memberships
         WHERE id = $1
           AND space_id = $2`,
        [membershipId, sourceSpaceId]
      );
      await removeLibraryMembershipsForSpaceUser(client, {
        spaceId: sourceSpaceId,
        userId: sourceMembership.rows[0].user_id,
        preserveOwned: false
      });
    }

    const librariesInNewSpace = await client.query(
      `SELECT id
       FROM libraries
       WHERE space_id = $1
         AND archived_at IS NULL
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
      [newSpace.id]
    );
    await client.query(
      `UPDATE users
       SET active_space_id = $2,
           active_library_id = $3
       WHERE id = $1`,
      [sourceMembership.rows[0].user_id, newSpace.id, librariesInNewSpace.rows[0]?.id || null]
    );

    await client.query('COMMIT');

    await logActivity(req, 'space.member.transfer_new_space', 'space_membership', membershipId, {
      sourceSpaceId,
      targetSpaceId: newSpace.id,
      targetUserId: sourceMembership.rows[0].user_id,
      targetUserEmail: sourceMembership.rows[0].email,
      movedLibraryIds
    });

    res.status(201).json({
      source_space_id: sourceSpaceId,
      target_space: {
        ...newSpace,
        owner_user_id: sourceMembership.rows[0].user_id
      },
      moved_library_ids: movedLibraryIds,
      removed_from_source_space: remainingOwnedLibraryCount === 0
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

module.exports = router;
