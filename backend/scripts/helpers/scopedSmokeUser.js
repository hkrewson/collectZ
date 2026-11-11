'use strict';

const bcrypt = require('bcrypt');

async function createScopedSmokeUser({ pool, email, password, name, role = 'user', slugPrefix = 'provider-smoke' } = {}) {
  if (!pool) throw new TypeError('Scoped smoke user requires a database pool');
  const passwordHash = await bcrypt.hash(password, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query(
      `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
       VALUES ($1, $2, $3, $4, true, NOW())
       RETURNING id`,
      [email, passwordHash, name, role]
    );
    const userId = Number(userResult.rows[0]?.id || 0);
    const spaceResult = await client.query(
      `INSERT INTO spaces (name, slug, description, created_by, is_personal)
       VALUES ($1, $2, 'Isolated provider smoke workspace', $3, true)
       RETURNING id`,
      [`${name} workspace`, `${slugPrefix}-${userId}`, userId]
    );
    const spaceId = Number(spaceResult.rows[0]?.id || 0);
    await client.query(
      `INSERT INTO space_memberships (space_id, user_id, role, created_by)
       VALUES ($1, $2, 'owner', $2)`,
      [spaceId, userId]
    );
    const libraryResult = await client.query(
      `INSERT INTO libraries (name, created_by, space_id)
       VALUES ('Provider Smoke Library', $1, $2)
       RETURNING id`,
      [userId, spaceId]
    );
    const libraryId = Number(libraryResult.rows[0]?.id || 0);
    await client.query(
      `INSERT INTO library_memberships (user_id, library_id, role)
       VALUES ($1, $2, 'owner')`,
      [userId, libraryId]
    );
    await client.query(
      `UPDATE users SET active_space_id = $2, active_library_id = $3 WHERE id = $1`,
      [userId, spaceId, libraryId]
    );
    await client.query('COMMIT');
    return userId;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { createScopedSmokeUser };
