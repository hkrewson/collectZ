const express = require('express');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const {
  validate,
  spaceCreateSchema,
  spaceUpdateSchema,
  spaceMembershipCreateSchema,
  spaceMembershipUpdateSchema
} = require('../middleware/validate');
const { logActivity } = require('../services/audit');
const { listLibrariesForSpace } = require('../services/libraries');
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

const router = express.Router();

router.use(authenticateToken);

async function requireAccessibleSpace(client, req, spaceId) {
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
  if (isGlobalAdmin(actorUserRole)) return true;
  if (actorMembershipRole === 'owner') return ['admin', 'member', 'viewer'].includes(targetRole);
  if (actorMembershipRole === 'admin') return ['member', 'viewer'].includes(targetRole);
  return false;
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

router.post('/spaces/select', asyncHandler(async (req, res) => {
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
    if (current.rows[0].role === 'owner' && nextRole !== 'owner' && !isGlobalAdmin(req.user.role)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only global admins can demote space owners' });
    }
    if (current.rows[0].role === 'owner' && nextRole !== 'owner') {
      const ownerCount = await countSpaceOwners(client, { spaceId });
      if (ownerCount <= 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Each space must retain at least one owner' });
      }
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
      user_role: current.rows[0].user_role
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
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

    await client.query(
      `DELETE FROM space_memberships
       WHERE id = $1
         AND space_id = $2`,
      [membershipId, spaceId]
    );
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

module.exports = router;
