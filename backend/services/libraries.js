const pool = require('../db/pool');

async function ensureUserDefaultLibrary(userId) {
  const numericUserId = Number(userId);
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
    throw new Error('Invalid user id');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const memberships = await client.query(
      `SELECT lm.library_id
       FROM library_memberships lm
       JOIN libraries l ON l.id = lm.library_id
       WHERE lm.user_id = $1
         AND l.archived_at IS NULL
       ORDER BY lm.created_at ASC, lm.library_id ASC
       LIMIT 1`,
      [numericUserId]
    );

    let libraryId = memberships.rows[0]?.library_id || null;
    if (!libraryId) {
      const created = await client.query(
        `INSERT INTO libraries (name, created_by)
         VALUES ('My Library', $1)
         RETURNING id`,
        [numericUserId]
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
       SET active_library_id = $2
       WHERE id = $1
         AND (active_library_id IS NULL OR active_library_id <> $2)`,
      [numericUserId, libraryId]
    );

    await client.query('COMMIT');
    return libraryId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function toLibraryResponse(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    space_id: row.space_id || null,
    created_by: row.created_by || null,
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
                COUNT(m.id)::int AS item_count
         FROM libraries l
         LEFT JOIN media m ON m.library_id = l.id
         WHERE l.archived_at IS NULL
         GROUP BY l.id
         ORDER BY lower(l.name), l.id`
      : `SELECT l.id, l.name, l.description, l.space_id, l.created_by, l.created_at, l.updated_at,
                COUNT(m.id)::int AS item_count
         FROM library_memberships lm
         JOIN libraries l ON l.id = lm.library_id
         LEFT JOIN media m ON m.library_id = l.id
         WHERE lm.user_id = $1
           AND l.archived_at IS NULL
         GROUP BY l.id
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
  ensureUserDefaultLibrary,
  listLibrariesForUser,
  getAccessibleLibrary
};
