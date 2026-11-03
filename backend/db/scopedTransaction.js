'use strict';

function scopeId(value, optional = false) {
  if (optional && (value === null || value === undefined)) return '';
  if (!Number.isInteger(value) || value <= 0 || value > 2147483647) {
    const error = new Error('A valid database scope is required');
    error.code = 'INVALID_DATABASE_SCOPE';
    error.status = 403;
    throw error;
  }
  return String(value);
}

// Only pass scope already authorized by the request/job boundary. Settings are
// transaction context, not proof of authorization: the runtime role can set GUCs.
async function withScopedTransaction(pool, scope, work) {
  const spaceId = scopeId(scope?.spaceId);
  const libraryId = scopeId(scope?.libraryId, true);
  if (typeof work !== 'function') throw new TypeError('Transaction work must be a function');
  const client = await pool.connect();
  let discard;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query(
      `SELECT set_config('collectz.space_id', $1, true),
              set_config('collectz.library_id', $2, true)`,
      [spaceId, libraryId]
    );
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // Never return a connection with uncertain transaction state to the pool.
      discard = rollbackError;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

module.exports = { withScopedTransaction };
