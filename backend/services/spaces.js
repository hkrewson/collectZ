const DEFAULT_SPACE_NAME = 'Default Space';
const DEFAULT_SPACE_SLUG = 'default';
const DEFAULT_SPACE_DESCRIPTION = 'Default space for single-space installs';

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
    role === 'admin'
      ? `SELECT
           s.id,
           s.name,
           s.slug,
           s.description,
           s.created_by,
           s.is_personal,
           s.created_at,
           s.updated_at,
           COALESCE(sm.role, CASE WHEN s.created_by = $1 THEN 'owner' END, 'admin') AS membership_role,
           COUNT(DISTINCT l.id)::int AS library_count
         FROM spaces s
         LEFT JOIN space_memberships sm
           ON sm.space_id = s.id
          AND sm.user_id = $1
         LEFT JOIN libraries l
           ON l.space_id = s.id
          AND l.archived_at IS NULL
         WHERE s.archived_at IS NULL
         GROUP BY s.id, sm.role
         ORDER BY lower(s.name) ASC, s.id ASC`
      : `SELECT
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
    role === 'admin'
      ? `SELECT
           s.id,
           s.name,
           s.slug,
           s.description,
           s.created_by,
           s.is_personal,
           s.created_at,
           s.updated_at,
           COALESCE(sm.role, CASE WHEN s.created_by = $1 THEN 'owner' END, 'admin') AS membership_role
         FROM spaces s
         LEFT JOIN space_memberships sm
           ON sm.space_id = s.id
          AND sm.user_id = $1
         WHERE s.id = $2
           AND s.archived_at IS NULL
         LIMIT 1`
      : `SELECT
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

module.exports = {
  DEFAULT_SPACE_NAME,
  DEFAULT_SPACE_SLUG,
  DEFAULT_SPACE_DESCRIPTION,
  ensureDefaultSpaceForClient,
  listAccessibleSpacesForUser,
  getAccessibleSpaceForUser
};
