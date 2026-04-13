const pool = require('../db/pool');
const { ensureDefaultSpaceForClient } = require('./spaces');
const { getProductEdition, resolvePersistedActiveSpaceId } = require('../config/productEdition');

function deriveSpaceMembershipRole({ userRole, isDefaultSpaceCreator = false }) {
  if (isDefaultSpaceCreator) return 'owner';
  if (userRole === 'admin') return 'admin';
  if (userRole === 'viewer') return 'viewer';
  return 'member';
}

async function canUserAccessSpace(client, { userId, spaceId }) {
  const numericUserId = Number(userId);
  const numericSpaceId = Number(spaceId);
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) return false;
  if (!Number.isFinite(numericSpaceId) || numericSpaceId <= 0) return false;

  const result = await client.query(
    `SELECT 1
     FROM space_memberships
     WHERE user_id = $1
       AND space_id = $2
       AND suspended_at IS NULL
     LIMIT 1`,
    [numericUserId, numericSpaceId]
  );
  return result.rows.length > 0;
}

async function getAccessibleLibraryRow(client, { userId, libraryId }) {
  const numericUserId = Number(userId);
  const numericLibraryId = Number(libraryId);
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) return null;
  if (!Number.isFinite(numericLibraryId) || numericLibraryId <= 0) return null;

  const result = await client.query(
    `SELECT l.id, l.space_id
     FROM library_memberships lm
     JOIN libraries l ON l.id = lm.library_id
     JOIN space_memberships sm
       ON sm.space_id = l.space_id
      AND sm.user_id = lm.user_id
      AND sm.suspended_at IS NULL
     WHERE lm.user_id = $1
       AND l.id = $2
       AND l.archived_at IS NULL
     LIMIT 1`,
    [numericUserId, numericLibraryId]
  );
  return result.rows[0] || null;
}

async function ensureUserDefaultScope(userId, options = {}) {
  const numericUserId = Number(userId);
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
    throw new Error('Invalid user id');
  }

  const productEdition = getProductEdition();
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
    const activeLibrary = userRow.active_library_id
      ? await getAccessibleLibraryRow(client, {
          userId: numericUserId,
          libraryId: userRow.active_library_id
        })
      : null;

    if (spaceId) {
      const preferredAllowed = await canUserAccessSpace(client, { userId: numericUserId, spaceId });
      if (!preferredAllowed) {
        spaceId = null;
      }
    }

    if (!spaceId && activeLibrary) {
      spaceId = activeLibrary.space_id || null;
    }

    if (!spaceId && userRow.active_space_id) {
      const activeSpaceAllowed = await canUserAccessSpace(client, {
        userId: numericUserId,
        spaceId: userRow.active_space_id
      });
      if (activeSpaceAllowed) {
        spaceId = userRow.active_space_id;
      }
    }

    if (!spaceId) {
      const firstMembership = await client.query(
        `SELECT space_id
         FROM space_memberships
         WHERE user_id = $1
           AND suspended_at IS NULL
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

    const anyMemberships = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM space_memberships
       WHERE user_id = $1
         AND suspended_at IS NULL`,
      [numericUserId]
    );
    const anyMembershipCount = Number(anyMemberships.rows[0]?.count || 0);

    if (!spaceId && anyMembershipCount === 0) {
      spaceId = defaultSpace.id;
    }

    if (!spaceId) {
      await client.query(
        `UPDATE users
         SET active_space_id = NULL,
             active_library_id = NULL
         WHERE id = $1`,
        [numericUserId]
      );
      await client.query('COMMIT');
      return { spaceId: null, libraryId: null };
    }

    if (anyMembershipCount === 0) {
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
    }

    let libraryId = activeLibrary && Number(activeLibrary.space_id || 0) === Number(spaceId || 0)
      ? activeLibrary.id
      : null;

    if (!libraryId) {
      const memberships = await client.query(
        `SELECT lm.library_id
         FROM library_memberships lm
         JOIN libraries l ON l.id = lm.library_id
         JOIN space_memberships sm
           ON sm.space_id = l.space_id
          AND sm.user_id = lm.user_id
          AND sm.suspended_at IS NULL
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
      [numericUserId, resolvePersistedActiveSpaceId(spaceId, productEdition), libraryId]
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
    `SELECT l.id, l.name, l.description, l.space_id, l.created_by, l.created_at, l.updated_at,
              u.email AS created_by_email, u.name AS created_by_name,
              COUNT(m.id)::int AS item_count
     FROM library_memberships lm
     JOIN libraries l ON l.id = lm.library_id
     JOIN space_memberships sm
       ON sm.space_id = l.space_id
      AND sm.user_id = lm.user_id
      AND sm.suspended_at IS NULL
     LEFT JOIN users u ON u.id = l.created_by
     LEFT JOIN media m ON m.library_id = l.id
     WHERE lm.user_id = $1
       AND l.archived_at IS NULL
       AND l.space_id = $2
     GROUP BY l.id, u.email, u.name
     ORDER BY lower(l.name) ASC, l.id ASC`,
    [numericUserId, numericSpaceId]
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

  const result = await pool.query(
    `SELECT l.id, l.name, l.description, l.space_id, l.created_by, l.created_at, l.updated_at,
              u.email AS created_by_email, u.name AS created_by_name,
              COUNT(m.id)::int AS item_count
     FROM library_memberships lm
     JOIN libraries l ON l.id = lm.library_id
     JOIN space_memberships sm
       ON sm.space_id = l.space_id
      AND sm.user_id = lm.user_id
      AND sm.suspended_at IS NULL
     LEFT JOIN users u ON u.id = l.created_by
     LEFT JOIN media m ON m.library_id = l.id
     WHERE lm.user_id = $1
       AND l.archived_at IS NULL
     GROUP BY l.id, u.email, u.name
     ORDER BY lower(l.name), l.id`,
    [numericUserId]
  );

  return result.rows.map(toLibraryResponse);
}

async function getAccessibleLibrary({ userId, role, libraryId }) {
  const numericLibraryId = Number(libraryId);
  if (!Number.isFinite(numericLibraryId) || numericLibraryId <= 0) return null;
  const result = await pool.query(
    `SELECT l.id, l.name, l.description, l.space_id, l.created_by, l.created_at, l.updated_at
     FROM library_memberships lm
     JOIN libraries l ON l.id = lm.library_id
     JOIN space_memberships sm
       ON sm.space_id = l.space_id
      AND sm.user_id = lm.user_id
      AND sm.suspended_at IS NULL
     WHERE lm.user_id = $1
       AND l.id = $2
       AND l.archived_at IS NULL
     LIMIT 1`,
    [Number(userId), numericLibraryId]
  );
  return result.rows[0] || null;
}

async function syncLibraryMembershipsForSpaceUser(client, { spaceId, userId, ownerLibraryIds = [] }) {
  const numericSpaceId = Number(spaceId);
  const numericUserId = Number(userId);
  const productEdition = getProductEdition();
  if (!Number.isFinite(numericSpaceId) || numericSpaceId <= 0) return 0;
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) return 0;

  const ownerIds = Array.isArray(ownerLibraryIds)
    ? ownerLibraryIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
    : [];
  const ownerIdList = ownerIds.length > 0 ? ownerIds : [0];

  const result = await client.query(
    `INSERT INTO library_memberships (user_id, library_id, role)
     SELECT
       u.id,
       l.id,
       CASE
         WHEN l.id = ANY($3::int[]) THEN 'owner'
         ELSE 'member'
       END
     FROM users u
     JOIN libraries l ON l.space_id = $2
     WHERE u.id = $1
       AND l.archived_at IS NULL
     ON CONFLICT (user_id, library_id) DO UPDATE
     SET role = CASE
       WHEN EXCLUDED.role = 'owner' THEN 'owner'
       ELSE library_memberships.role
     END`,
    [numericUserId, numericSpaceId, ownerIdList]
  );
  const userScope = await client.query(
    `SELECT active_library_id
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [numericUserId]
  );
  const currentActiveLibraryId = Number(userScope.rows[0]?.active_library_id || 0) || null;
  if (!currentActiveLibraryId) {
    const firstAccessibleLibrary = await client.query(
      `SELECT l.id, l.space_id
       FROM library_memberships lm
       JOIN libraries l ON l.id = lm.library_id
       JOIN space_memberships sm
         ON sm.space_id = l.space_id
        AND sm.user_id = lm.user_id
        AND sm.suspended_at IS NULL
       WHERE lm.user_id = $1
         AND l.space_id = $2
         AND l.archived_at IS NULL
       ORDER BY lm.created_at ASC, lm.library_id ASC
       LIMIT 1`,
      [numericUserId, numericSpaceId]
    );
    if (firstAccessibleLibrary.rows.length > 0) {
      await client.query(
        `UPDATE users
         SET active_space_id = $2,
             active_library_id = $3
         WHERE id = $1
           AND active_library_id IS NULL`,
        [
          numericUserId,
          resolvePersistedActiveSpaceId(firstAccessibleLibrary.rows[0]?.space_id || null, productEdition),
          firstAccessibleLibrary.rows[0]?.id || null
        ]
      );
    }
  }
  return result.rowCount || 0;
}

async function removeLibraryMembershipsForSpaceUser(client, { spaceId, userId, preserveOwned = true }) {
  const numericSpaceId = Number(spaceId);
  const numericUserId = Number(userId);
  const productEdition = getProductEdition();
  if (!Number.isFinite(numericSpaceId) || numericSpaceId <= 0) return 0;
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) return 0;

  const removedMemberships = await client.query(
    `DELETE FROM library_memberships lm
     USING libraries l
     WHERE lm.library_id = l.id
       AND lm.user_id = $1
       AND l.space_id = $2
       AND l.archived_at IS NULL
       ${preserveOwned ? "AND lm.role <> 'owner'" : ''}
     RETURNING lm.library_id`,
    [numericUserId, numericSpaceId]
  );
  const removedLibraryIds = removedMemberships.rows
    .map((row) => Number(row.library_id))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (removedLibraryIds.length === 0) return 0;

  await client.query(
    `UPDATE users
     SET active_space_id = CASE
           WHEN active_library_id = ANY($2::int[]) THEN NULL
           ELSE active_space_id
         END,
         active_library_id = CASE
           WHEN active_library_id = ANY($2::int[]) THEN NULL
           ELSE active_library_id
         END
     WHERE id = $1`,
    [numericUserId, removedLibraryIds]
  );
  await client.query(
    `UPDATE user_sessions s
     SET support_library_id = CASE
           WHEN s.support_library_id = ANY($2::int[]) THEN NULL
           ELSE s.support_library_id
         END,
         support_previous_library_id = CASE
           WHEN s.support_previous_library_id = ANY($2::int[]) THEN NULL
           ELSE s.support_previous_library_id
         END
     WHERE s.user_id = $1
       AND (
         s.support_library_id = ANY($2::int[])
         OR s.support_previous_library_id = ANY($2::int[])
       )`,
    [numericUserId, removedLibraryIds]
  );

  const replacement = await client.query(
    `SELECT lm.library_id, l.space_id
     FROM library_memberships lm
     JOIN libraries l ON l.id = lm.library_id
     JOIN space_memberships sm
       ON sm.space_id = l.space_id
      AND sm.user_id = lm.user_id
      AND sm.suspended_at IS NULL
     WHERE lm.user_id = $1
       AND l.archived_at IS NULL
     ORDER BY lm.created_at ASC, lm.library_id ASC
     LIMIT 1`,
    [numericUserId]
  );
  if (replacement.rows.length > 0) {
    await client.query(
      `UPDATE users
       SET active_space_id = $2,
           active_library_id = $3
       WHERE id = $1
         AND active_library_id IS NULL`,
      [
        numericUserId,
        resolvePersistedActiveSpaceId(replacement.rows[0]?.space_id || null, productEdition),
        replacement.rows[0]?.library_id || null
      ]
    );
  }

  return removedMemberships.rowCount || 0;
}

async function countOwnedLibrariesInSpace(client, { spaceId, userId }) {
  const numericSpaceId = Number(spaceId);
  const numericUserId = Number(userId);
  if (!Number.isFinite(numericSpaceId) || numericSpaceId <= 0) return 0;
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) return 0;

  const result = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM libraries
     WHERE created_by = $1
       AND space_id = $2
       AND archived_at IS NULL`,
    [numericUserId, numericSpaceId]
  );
  return Number(result.rows[0]?.count || 0);
}

async function moveOwnedLibrariesToSpace(client, { sourceSpaceId, targetSpaceId, userId }) {
  const numericSourceSpaceId = Number(sourceSpaceId);
  const numericTargetSpaceId = Number(targetSpaceId);
  const numericUserId = Number(userId);
  const productEdition = getProductEdition();
  if (!Number.isFinite(numericSourceSpaceId) || numericSourceSpaceId <= 0) return [];
  if (!Number.isFinite(numericTargetSpaceId) || numericTargetSpaceId <= 0) return [];
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) return [];

  const movedLibraries = await client.query(
    `UPDATE libraries
     SET space_id = $3
     WHERE created_by = $1
       AND space_id = $2
       AND archived_at IS NULL
     RETURNING id`,
    [numericUserId, numericSourceSpaceId, numericTargetSpaceId]
  );
  const libraryIds = movedLibraries.rows.map((row) => Number(row.id)).filter((value) => Number.isFinite(value) && value > 0);
  if (libraryIds.length === 0) return [];
  const affectedUsers = await client.query(
    `SELECT DISTINCT user_id
     FROM library_memberships
     WHERE library_id = ANY($1::int[])
       AND user_id <> $2`,
    [libraryIds, numericUserId]
  );

  await client.query(
    `UPDATE media
     SET space_id = $2
     WHERE library_id = ANY($1::int[])`,
    [libraryIds, numericTargetSpaceId]
  );
  await client.query(
    `UPDATE events
     SET space_id = $2
     WHERE library_id = ANY($1::int[])`,
    [libraryIds, numericTargetSpaceId]
  );
  await client.query(
    `UPDATE collectibles
     SET space_id = $2
     WHERE library_id = ANY($1::int[])`,
    [libraryIds, numericTargetSpaceId]
  );
  await client.query(
    `UPDATE collections
     SET space_id = $2
     WHERE library_id = ANY($1::int[])`,
    [libraryIds, numericTargetSpaceId]
  );
  await client.query(
    `DELETE FROM library_memberships
     WHERE library_id = ANY($1::int[])
       AND user_id <> $2`,
    [libraryIds, numericUserId]
  );
  for (const row of affectedUsers.rows) {
    const affectedUserId = Number(row.user_id || 0) || null;
    if (!affectedUserId) continue;
    await client.query(
      `UPDATE users
       SET active_space_id = CASE
             WHEN active_library_id = ANY($2::int[]) THEN NULL
             ELSE active_space_id
           END,
           active_library_id = CASE
             WHEN active_library_id = ANY($2::int[]) THEN NULL
             ELSE active_library_id
           END
       WHERE id = $1`,
      [affectedUserId, libraryIds]
    );
    await client.query(
      `UPDATE user_sessions s
       SET support_library_id = CASE
             WHEN s.support_library_id = ANY($2::int[]) THEN NULL
             ELSE s.support_library_id
           END,
           support_previous_library_id = CASE
             WHEN s.support_previous_library_id = ANY($2::int[]) THEN NULL
             ELSE s.support_previous_library_id
           END
       WHERE s.user_id = $1
         AND (
           s.support_library_id = ANY($2::int[])
           OR s.support_previous_library_id = ANY($2::int[])
         )`,
      [affectedUserId, libraryIds]
    );
    const replacement = await client.query(
      `SELECT lm.library_id, l.space_id
       FROM library_memberships lm
       JOIN libraries l ON l.id = lm.library_id
       JOIN space_memberships sm
         ON sm.space_id = l.space_id
        AND sm.user_id = lm.user_id
        AND sm.suspended_at IS NULL
       WHERE lm.user_id = $1
         AND l.archived_at IS NULL
       ORDER BY lm.created_at ASC, lm.library_id ASC
       LIMIT 1`,
      [affectedUserId]
    );
    if (replacement.rows.length > 0) {
      await client.query(
        `UPDATE users
         SET active_space_id = $2,
             active_library_id = $3
         WHERE id = $1
           AND active_library_id IS NULL`,
        [
          affectedUserId,
          resolvePersistedActiveSpaceId(replacement.rows[0]?.space_id || null, productEdition),
          replacement.rows[0]?.library_id || null
        ]
      );
    }
  }
  await syncLibraryMembershipsForSpaceUser(client, {
    spaceId: numericTargetSpaceId,
    userId: numericUserId,
    ownerLibraryIds: libraryIds
  });
  return libraryIds;
}

module.exports = {
  ensureUserDefaultScope,
  ensureUserDefaultLibrary,
  listLibrariesForSpace,
  listLibrariesForUser,
  getAccessibleLibrary,
  syncLibraryMembershipsForSpaceUser,
  removeLibraryMembershipsForSpaceUser,
  countOwnedLibrariesInSpace,
  moveOwnedLibrariesToSpace
};
