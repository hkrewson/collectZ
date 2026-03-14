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

module.exports = {
  DEFAULT_SPACE_NAME,
  DEFAULT_SPACE_SLUG,
  DEFAULT_SPACE_DESCRIPTION,
  ensureDefaultSpaceForClient
};
