'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { executeTransaction } = require('../db/transactionExecutor');

function fixture(failOn) {
  const calls = [];
  const clients = [];
  const pool = {
    async connect() {
      const client = {
        async query(sql, values) {
          calls.push({ client: clients.length + 1, sql, values });
          const error = failOn?.(sql, clients.length + 1, calls);
          if (error) throw error;
          return { rows: [] };
        },
        release(error) { calls.push({ client: clients.length + 1, release: true, error }); }
      };
      clients.push(client);
      return client;
    }
  };
  return { calls, clients, pool };
}

test('commits work result on the acquired client', async () => {
  const f = fixture();
  const result = await executeTransaction(f.pool, async (client) => {
    assert.equal(client, f.clients[0]);
    await client.query('SELECT 1');
    return 42;
  });
  assert.equal(result, 42);
  assert.deepEqual(f.calls.map((call) => call.sql || 'release'), [
    'BEGIN ISOLATION LEVEL READ COMMITTED', 'SELECT 1', 'COMMIT', 'release'
  ]);
  assert.equal(f.calls.at(-1).error, undefined);
});

test('connection acquisition failures are sanitized and are not retried', async () => {
  const events = [];
  let attempts = 0;
  const error = Object.assign(new Error('credential must not be logged'), { code: '08006' });
  const pool = { async connect() { attempts += 1; throw error; } };
  await assert.rejects(
    executeTransaction(pool, async () => {}, { retries: 2, diagnostics: (event) => events.push(event) }),
    /credential must not be logged/
  );
  assert.equal(attempts, 1);
  assert.equal(events[0].outcome, 'acquire_failed');
  assert.equal(events[0].errorCode, '08006');
  assert.equal(JSON.stringify(events).includes(error.message), false);
});

test('supports only explicit safe isolation levels', async () => {
  const f = fixture();
  await executeTransaction(f.pool, async () => {}, { isolation: 'serializable' });
  assert.equal(f.calls[0].sql, 'BEGIN ISOLATION LEVEL SERIALIZABLE');
  await assert.rejects(
    executeTransaction(f.pool, async () => {}, { isolation: 'READ UNCOMMITTED; DROP TABLE media' }),
    /Unsupported transaction isolation/
  );
});

test('work, query, and commit failures roll back before release', async () => {
  for (const failAt of ['work', 'query', 'commit']) {
    const f = fixture((sql) => {
      if (failAt === 'query' && sql === 'SELECT broken') return new Error('query failed');
      if (failAt === 'commit' && sql === 'COMMIT') return new Error('commit failed');
      return null;
    });
    await assert.rejects(executeTransaction(f.pool, async (client) => {
      if (failAt === 'work') throw new Error('work failed');
      if (failAt === 'query') await client.query('SELECT broken');
    }));
    assert.equal(f.calls.at(-2).sql, 'ROLLBACK');
    assert.equal(f.calls.at(-1).release, true);
    assert.equal(f.calls.at(-1).error, undefined);
  }
});

test('rollback failure discards the connection and preserves the original error', async () => {
  const rollbackError = new Error('rollback failed');
  const f = fixture((sql) => sql === 'ROLLBACK' ? rollbackError : null);
  await assert.rejects(
    executeTransaction(f.pool, async () => { throw new Error('original failure'); }),
    /original failure/
  );
  assert.equal(f.calls.at(-1).error, rollbackError);
});

test('failed begin discards the uncertain connection without issuing rollback', async () => {
  const beginError = new Error('begin failed');
  const f = fixture((sql) => sql.startsWith('BEGIN ') ? beginError : null);
  await assert.rejects(executeTransaction(f.pool, async () => {}), /begin failed/);
  assert.deepEqual(f.calls.map((call) => call.sql || 'release'), [
    'BEGIN ISOLATION LEVEL READ COMMITTED', 'release'
  ]);
  assert.equal(f.calls.at(-1).error, beginError);
});

test('retry is opt-in, bounded, and limited to safe PostgreSQL transaction errors', async () => {
  let attempts = 0;
  const serializationError = Object.assign(new Error('sensitive query text'), { code: '40001' });
  const f = fixture();
  const result = await executeTransaction(f.pool, async () => {
    attempts += 1;
    if (attempts === 1) throw serializationError;
    return 'retried';
  }, { retries: 1 });
  assert.equal(result, 'retried');
  assert.equal(attempts, 2);
  assert.equal(f.clients.length, 2);

  const noRetry = fixture();
  let ordinaryAttempts = 0;
  await assert.rejects(executeTransaction(noRetry.pool, async () => {
    ordinaryAttempts += 1;
    throw Object.assign(new Error('ordinary'), { code: '23505' });
  }, { retries: 2 }), /ordinary/);
  assert.equal(ordinaryAttempts, 1);
  await assert.rejects(executeTransaction(noRetry.pool, async () => {}, { retries: 3 }), /integer from 0 to 2/);
});

test('diagnostics expose timing and error codes without messages, SQL, or parameters', async () => {
  const events = [];
  const secret = 'must-not-appear';
  const f = fixture();
  await assert.rejects(executeTransaction(f.pool, async () => {
    throw Object.assign(new Error(secret), { code: 'XX001', detail: secret, query: secret });
  }, { diagnostics: (event) => events.push(event) }), /must-not-appear/);
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, 'rolled_back');
  assert.equal(events[0].errorCode, 'XX001');
  assert.equal(typeof events[0].durationMs, 'number');
  assert.equal(JSON.stringify(events).includes(secret), false);
  assert.equal(Object.hasOwn(events[0], 'message'), false);
});

test('diagnostic failures cannot change a successful transaction', async () => {
  const f = fixture();
  const result = await executeTransaction(f.pool, async () => 'ok', {
    diagnostics: () => { throw new Error('diagnostic sink failed'); }
  });
  assert.equal(result, 'ok');
});
