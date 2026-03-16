const DEFAULT_SPACE_NAME = 'Default Space';
const DEFAULT_SPACE_SLUG = 'default';
const DEFAULT_SPACE_DESCRIPTION = 'Default space for single-space installs';
const SPACE_MEMBERSHIP_ROLES = ['owner', 'admin', 'member', 'viewer'];
const SPACE_MANAGE_ROLES = ['owner', 'admin'];

const DEFAULT_SPACE_SELECT_SQL = `
  SELECT id, name, slug, description, created_by, is_personal, created_at, updated_at, archived_at
  FROM spaces
  WHERE lower(COALESCE(slug, '')) = $1
    AND archived_at IS NULL
  ORDER BY id ASC
  LIMIT 1
`;

async function ensureDefaultSpaceForClient(client, { createdByUserId = null } = {}) {
  const existing = await client.query(DEFAULT_SPACE_SELECT_SQL, [DEFAULT_SPACE_SLUG]);
  if (existing.rows.length > 0) return existing.rows[0];

  const inserted = await client.query(
    `INSERT INTO spaces (name, slug, description, created_by, is_personal)
     VALUES ($1, $2, $3, $4, false)
     RETURNING id, name, slug, description, created_by, is_personal, created_at, updated_at, archived_at`,
    [DEFAULT_SPACE_NAME, DEFAULT_SPACE_SLUG, DEFAULT_SPACE_DESCRIPTION, createdByUserId || null]
  );
  return inserted.rows[0];
}

async function listAccessibleSpacesForUser(client, { userId, role }) {
  const numericUserId = Number(userId);
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) return [];

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
       sm.role AS membership_role,
       COUNT(DISTINCT l.id)::int AS library_count
     FROM space_memberships sm
     JOIN spaces s
       ON s.id = sm.space_id
      AND s.archived_at IS NULL
     LEFT JOIN libraries l
       ON l.space_id = s.id
      AND l.archived_at IS NULL
     WHERE sm.user_id = $1
     GROUP BY s.id, sm.role
     ORDER BY lower(s.name) ASC, s.id ASC`,
    [numericUserId]
  );

  return result.rows;
}

async function getAccessibleSpaceForUser(client, { userId, role, spaceId }) {
  const numericUserId = Number(userId);
  const numericSpaceId = Number(spaceId);
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) return null;
  if (!Number.isFinite(numericSpaceId) || numericSpaceId <= 0) return null;

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
       sm.role AS membership_role
     FROM space_memberships sm
     JOIN spaces s
       ON s.id = sm.space_id
      AND s.archived_at IS NULL
     WHERE sm.user_id = $1
       AND s.id = $2
     LIMIT 1`,
    [numericUserId, numericSpaceId]
  );

  return result.rows[0] || null;
}

async function getSpaceMembershipForUser(client, { userId, spaceId }) {
  const numericUserId = Number(userId);
  const numericSpaceId = Number(spaceId);
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) return null;
  if (!Number.isFinite(numericSpaceId) || numericSpaceId <= 0) return null;

  const result = await client.query(
    `SELECT sm.id, sm.space_id, sm.user_id, sm.role, sm.created_by, sm.created_at, sm.updated_at
     FROM space_memberships sm
     JOIN spaces s ON s.id = sm.space_id
     WHERE sm.user_id = $1
       AND sm.space_id = $2
       AND s.archived_at IS NULL
     LIMIT 1`,
    [numericUserId, numericSpaceId]
  );
  return result.rows[0] || null;
}

function isGlobalAdmin(userRole) {
  return userRole === 'admin';
}

function canManageSpaceMemberships({ userRole, membershipRole }) {
  return SPACE_MANAGE_ROLES.includes(membershipRole);
}

function canAssignSpaceRole({ actorUserRole, actorMembershipRole, nextRole }) {
  if (!SPACE_MEMBERSHIP_ROLES.includes(nextRole)) return false;
  if (actorMembershipRole === 'owner') return ['admin', 'member', 'viewer'].includes(nextRole);
  if (actorMembershipRole === 'admin') return ['member', 'viewer'].includes(nextRole);
  return false;
}

async function countSpaceOwners(client, { spaceId }) {
  const numericSpaceId = Number(spaceId);
  if (!Number.isFinite(numericSpaceId) || numericSpaceId <= 0) return 0;
  const result = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM space_memberships
     WHERE space_id = $1
       AND role = 'owner'`,
    [numericSpaceId]
  );
  return Number(result.rows[0]?.count || 0);
}

async function listSpaceMembers(client, { spaceId }) {
  const numericSpaceId = Number(spaceId);
  if (!Number.isFinite(numericSpaceId) || numericSpaceId <= 0) return [];
  const result = await client.query(
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
    [numericSpaceId]
  );
  return result.rows;
}

module.exports = {
  DEFAULT_SPACE_NAME,
  DEFAULT_SPACE_SLUG,
  DEFAULT_SPACE_DESCRIPTION,
  SPACE_MEMBERSHIP_ROLES,
  SPACE_MANAGE_ROLES,
  ensureDefaultSpaceForClient,
  listAccessibleSpacesForUser,
  getAccessibleSpaceForUser,
  getSpaceMembershipForUser,
  isGlobalAdmin,
  canManageSpaceMemberships,
  canAssignSpaceRole,
  countSpaceOwners,
  listSpaceMembers
};
