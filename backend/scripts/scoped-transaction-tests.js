'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withScopedTransaction } = require('../db/scopedTransaction');

function fixture(failOn) {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (failOn?.(sql)) throw new Error(sql);
    },
    release(error) { calls.push({ release: true, error }); }
  };
  return { calls, client, pool: { async connect() { return client; } } };
}

test('invalid or missing scope fails before acquiring a connection', async () => {
  for (const spaceId of [null, undefined, 0, -1, 1.5, '1', true, 2147483648]) {
    await assert.rejects(withScopedTransaction(null, { spaceId }, () => {}), { code: 'INVALID_DATABASE_SCOPE' });
  }
  await assert.rejects(withScopedTransaction(null, { spaceId: 1, libraryId: 0 }, () => {}), { code: 'INVALID_DATABASE_SCOPE' });
});

test('work uses the same client and scope is set locally before work', async () => {
  const f = fixture();
  const result = await withScopedTransaction(f.pool, { spaceId: 7, libraryId: 9 }, async client => {
    assert.equal(client, f.client);
    assert.match(f.calls[1].sql, /set_config\('collectz.space_id', \$1, true\)/);
    assert.deepEqual(f.calls[1].values, ['7', '9']);
    return 42;
  });
  assert.equal(result, 42);
  assert.equal(f.calls[2].sql, 'COMMIT');
  assert.equal(f.calls[3].release, true);
});

test('workspace-only scope explicitly clears the optional library context', async () => {
  const f = fixture();
  await withScopedTransaction(f.pool, { spaceId: 7 }, async () => {});
  assert.deepEqual(f.calls[1].values, ['7', '']);
});

test('callback, setting, and commit failures roll back before releasing', async () => {
  for (const failAt of ['work', 'settings', 'commit']) {
    const f = fixture(sql => (failAt === 'settings' && sql.includes('set_config')) || (failAt === 'commit' && sql === 'COMMIT'));
    await assert.rejects(withScopedTransaction(f.pool, { spaceId: 7 }, async () => {
      if (failAt === 'work') throw new Error('work');
    }));
    assert.equal(f.calls.at(-2).sql, 'ROLLBACK');
    assert.equal(f.calls.at(-1).error, undefined);
  }
});

test('rollback failure discards connection and preserves original failure', async () => {
  const f = fixture(sql => sql === 'ROLLBACK');
  await assert.rejects(withScopedTransaction(f.pool, { spaceId: 7 }, async () => { throw new Error('original'); }), /original/);
  assert.equal(f.calls.at(-1).error.message, 'ROLLBACK');
});
