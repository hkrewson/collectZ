'use strict';

const ISOLATION_LEVELS = new Set([
  'READ COMMITTED',
  'REPEATABLE READ',
  'SERIALIZABLE'
]);
const RETRYABLE_CODES = new Set(['40001', '40P01']);
const MAX_RETRIES = 2;

function normalizeOptions(options = {}) {
  const isolation = String(options.isolation || 'READ COMMITTED').trim().toUpperCase();
  if (!ISOLATION_LEVELS.has(isolation)) {
    throw new TypeError('Unsupported transaction isolation level');
  }

  const retries = options.retries ?? 0;
  if (!Number.isInteger(retries) || retries < 0 || retries > MAX_RETRIES) {
    throw new TypeError(`Transaction retries must be an integer from 0 to ${MAX_RETRIES}`);
  }

  if (options.diagnostics !== undefined && typeof options.diagnostics !== 'function') {
    throw new TypeError('Transaction diagnostics must be a function');
  }

  return { isolation, retries, diagnostics: options.diagnostics };
}

function report(diagnostics, event) {
  if (!diagnostics) return;
  try {
    diagnostics(event);
  } catch {
    // Diagnostics must never change transaction behavior.
  }
}

function durationMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}

async function executeTransaction(pool, work, options = {}) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('Transaction pool must provide connect()');
  }
  if (typeof work !== 'function') throw new TypeError('Transaction work must be a function');
  const { isolation, retries, diagnostics } = normalizeOptions(options);

  // A retry repeats work from the beginning on a new connection. Callers may
  // opt in only when work contains no non-database side effects.
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const startedAt = process.hrtime.bigint();
    let client;
    try {
      client = await pool.connect();
    } catch (error) {
      report(diagnostics, {
        outcome: 'acquire_failed',
        isolation,
        attempt,
        durationMs: durationMs(startedAt),
        errorCode: typeof error?.code === 'string' ? error.code : null,
        connectionDiscarded: false
      });
      throw error;
    }
    let began = false;
    let discard;

    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      began = true;
      const result = await work(client);
      await client.query('COMMIT');
      report(diagnostics, {
        outcome: 'committed',
        isolation,
        attempt,
        durationMs: durationMs(startedAt)
      });
      return result;
    } catch (error) {
      let rollbackFailed = false;
      if (began) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          discard = rollbackError;
          rollbackFailed = true;
        }
      } else {
        // A failed BEGIN leaves the connection state uncertain.
        discard = error;
      }

      const retrying = !rollbackFailed
        && RETRYABLE_CODES.has(String(error?.code || ''))
        && attempt <= retries;
      report(diagnostics, {
        outcome: retrying ? 'retrying' : (began && !rollbackFailed ? 'rolled_back' : 'failed'),
        isolation,
        attempt,
        durationMs: durationMs(startedAt),
        errorCode: typeof error?.code === 'string' ? error.code : null,
        connectionDiscarded: Boolean(discard)
      });
      if (!retrying) throw error;
    } finally {
      client.release(discard);
    }
  }

  throw new Error('Transaction retry loop ended unexpectedly');
}

module.exports = {
  executeTransaction
};
