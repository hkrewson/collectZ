const pool = require('../db/pool');
const { ensureDefaultSpaceForClient } = require('./spaces');

function deriveSpaceMembershipRole({ userRole, isDefaultSpaceCreator = false }) {
  if (isDefaultSpaceCreator) return 'owner';
  if (userRole === 'admin') return 'admin';
  if (userRole === 'viewer') return 'viewer';
  return 'member';
}

async function ensureUserDefaultScope(userId, options = {}) {
  const numericUserId = Number(userId);
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
    throw new Error('Invalid user id');
  }

  const preferredSpaceIdRaw = Number(options.preferredSpaceId);
  const preferredSpaceId = Number.isFinite(preferredSpaceIdRaw) && preferredSpaceIdRaw > 0
    ? preferredSpaceIdRaw
    : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userScope = await client.query(
      `SELECT id, role, active_space_id, active_library_id
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [numericUserId]
    );
    const userRow = userScope.rows[0];
    if (!userRow) throw new Error('User not found');

    const defaultSpace = await ensureDefaultSpaceForClient(client, {
      createdByUserId: numericUserId
    });

    let spaceId = preferredSpaceId;
    if (spaceId) {
      const preferred = await client.query(
        `SELECT id
         FROM spaces
         WHERE id = $1
           AND archived_at IS NULL
         LIMIT 1`,
        [spaceId]
      );
      if (preferred.rows.length === 0) {
        spaceId = null;
      }
    }

    if (!spaceId && userRow.active_library_id) {
      const activeLibrary = await client.query(
        `SELECT id, space_id
         FROM libraries
         WHERE id = $1
           AND archived_at IS NULL
         LIMIT 1`,
        [userRow.active_library_id]
      );
      if (activeLibrary.rows.length > 0) {
        spaceId = activeLibrary.rows[0].space_id || null;
      }
    }

    if (!spaceId && userRow.active_space_id) {
      const activeSpace = await client.query(
        `SELECT id
         FROM spaces
         WHERE id = $1
           AND archived_at IS NULL
         LIMIT 1`,
        [userRow.active_space_id]
      );
      if (activeSpace.rows.length > 0) {
        spaceId = activeSpace.rows[0].id;
      }
    }

    if (!spaceId) {
      const firstMembership = await client.query(
        `SELECT space_id
         FROM space_memberships
         WHERE user_id = $1
         ORDER BY
           CASE role
             WHEN 'owner' THEN 0
             WHEN 'admin' THEN 1
             WHEN 'member' THEN 2
             ELSE 3
           END,
           space_id ASC
         LIMIT 1`,
        [numericUserId]
      );
      if (firstMembership.rows.length > 0) {
        spaceId = firstMembership.rows[0].space_id;
      }
    }

    if (!spaceId) {
      spaceId = defaultSpace.id;
    }

    await client.query(
      `INSERT INTO space_memberships (space_id, user_id, role, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (space_id, user_id) DO NOTHING`,
      [
        spaceId,
        numericUserId,
        deriveSpaceMembershipRole({
          userRole: userRow.role,
          isDefaultSpaceCreator: Number(defaultSpace.created_by || 0) === numericUserId && spaceId === defaultSpace.id
        }),
        defaultSpace.created_by || numericUserId
      ]
    );

    let libraryId = userRow.active_library_id || null;
    if (libraryId) {
      const activeLibraryExists = await client.query(
        `SELECT id
         FROM libraries
         WHERE id = $1
           AND archived_at IS NULL
           AND space_id = $2
         LIMIT 1`,
        [libraryId, spaceId]
      );
      if (activeLibraryExists.rows.length === 0) {
        libraryId = null;
      }
    }

    if (!libraryId) {
      const memberships = await client.query(
        `SELECT lm.library_id
         FROM library_memberships lm
         JOIN libraries l ON l.id = lm.library_id
         WHERE lm.user_id = $1
           AND l.archived_at IS NULL
           AND l.space_id = $2
         ORDER BY lm.created_at ASC, lm.library_id ASC
         LIMIT 1`,
        [numericUserId, spaceId]
      );
      libraryId = memberships.rows[0]?.library_id || null;
    }

    if (!libraryId) {
      const created = await client.query(
        `INSERT INTO libraries (name, created_by, space_id)
         VALUES ('My Library', $1, $2)
         RETURNING id`,
        [numericUserId, spaceId]
      );
      libraryId = created.rows[0].id;
      await client.query(
        `INSERT INTO library_memberships (user_id, library_id, role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (user_id, library_id) DO NOTHING`,
        [numericUserId, libraryId]
      );
    }

    await client.query(
      `UPDATE users
       SET active_space_id = $2,
           active_library_id = $3
       WHERE id = $1`,
      [numericUserId, spaceId, libraryId]
    );

    await client.query('COMMIT');
    return { spaceId, libraryId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ensureUserDefaultLibrary(userId) {
  const scope = await ensureUserDefaultScope(userId);
  return scope.libraryId;
}

async function listLibrariesForSpace({ userId, role, spaceId }) {
  const numericUserId = Number(userId);
  const numericSpaceId = Number(spaceId);
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) return [];
  if (!Number.isFinite(numericSpaceId) || numericSpaceId <= 0) return [];

  const result = await pool.query(
    role === 'admin'
      ? `SELECT l.id, l.name, l.description, l.space_id, l.created_by, l.created_at, l.updated_at,
                u.email AS created_by_email, u.name AS created_by_name,
                COUNT(m.id)::int AS item_count
         FROM libraries l
         LEFT JOIN users u ON u.id = l.created_by
         LEFT JOIN media m ON m.library_id = l.id
         WHERE l.archived_at IS NULL
           AND l.space_id = $1
         GROUP BY l.id, u.email, u.name
         ORDER BY lower(l.name) ASC, l.id ASC`
      : `SELECT l.id, l.name, l.description, l.space_id, l.created_by, l.created_at, l.updated_at,
                u.email AS created_by_email, u.name AS created_by_name,
                COUNT(m.id)::int AS item_count
         FROM library_memberships lm
         JOIN libraries l ON l.id = lm.library_id
         LEFT JOIN users u ON u.id = l.created_by
         LEFT JOIN media m ON m.library_id = l.id
         WHERE lm.user_id = $1
           AND l.archived_at IS NULL
           AND l.space_id = $2
         GROUP BY l.id, u.email, u.name
         ORDER BY lower(l.name) ASC, l.id ASC`,
    role === 'admin' ? [numericSpaceId] : [numericUserId, numericSpaceId]
  );

  return result.rows.map(toLibraryResponse);
}

function toLibraryResponse(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    space_id: row.space_id || null,
    created_by: row.created_by || null,
    created_by_email: row.created_by_email || null,
    created_by_name: row.created_by_name || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    item_count: Number(row.item_count || 0)
  };
}

async function listLibrariesForUser({ userId, role }) {
  const numericUserId = Number(userId);
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) return [];

  const isAdmin = role === 'admin';
  const result = await pool.query(
    isAdmin
      ? `SELECT l.id, l.name, l.description, l.space_id, l.created_by, l.created_at, l.updated_at,
                u.email AS created_by_email, u.name AS created_by_name,
                COUNT(m.id)::int AS item_count
         FROM libraries l
         LEFT JOIN users u ON u.id = l.created_by
         LEFT JOIN media m ON m.library_id = l.id
         WHERE l.archived_at IS NULL
         GROUP BY l.id, u.email, u.name
         ORDER BY lower(l.name), l.id`
      : `SELECT l.id, l.name, l.description, l.space_id, l.created_by, l.created_at, l.updated_at,
                u.email AS created_by_email, u.name AS created_by_name,
                COUNT(m.id)::int AS item_count
         FROM library_memberships lm
         JOIN libraries l ON l.id = lm.library_id
         LEFT JOIN users u ON u.id = l.created_by
         LEFT JOIN media m ON m.library_id = l.id
         WHERE lm.user_id = $1
           AND l.archived_at IS NULL
         GROUP BY l.id, u.email, u.name
         ORDER BY lower(l.name), l.id`,
    isAdmin ? [] : [numericUserId]
  );

  return result.rows.map(toLibraryResponse);
}

async function getAccessibleLibrary({ userId, role, libraryId }) {
  const numericLibraryId = Number(libraryId);
  if (!Number.isFinite(numericLibraryId) || numericLibraryId <= 0) return null;
  if (role === 'admin') {
    const result = await pool.query(
      `SELECT id, name, description, space_id, created_by, created_at, updated_at
       FROM libraries
       WHERE id = $1
         AND archived_at IS NULL
       LIMIT 1`,
      [numericLibraryId]
    );
    return result.rows[0] || null;
  }
  const result = await pool.query(
    `SELECT l.id, l.name, l.description, l.space_id, l.created_by, l.created_at, l.updated_at
     FROM library_memberships lm
     JOIN libraries l ON l.id = lm.library_id
     WHERE lm.user_id = $1
       AND l.id = $2
       AND l.archived_at IS NULL
     LIMIT 1`,
    [Number(userId), numericLibraryId]
  );
  return result.rows[0] || null;
}

module.exports = {
  ensureUserDefaultScope,
  ensureUserDefaultLibrary,
  listLibrariesForSpace,
  listLibrariesForUser,
  getAccessibleLibrary
};
