'use strict';

const { executeTransaction } = require('./transactionExecutor');

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
  return executeTransaction(pool, async (client) => {
    await client.query(
      `SELECT set_config('collectz.space_id', $1, true),
              set_config('collectz.library_id', $2, true)`,
      [spaceId, libraryId]
    );
    return work(client);
  });
}

module.exports = { withScopedTransaction };
