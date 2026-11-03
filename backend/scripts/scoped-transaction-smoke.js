'use strict';

const assert = require('node:assert/strict');
const { Pool } = require('pg');
const configuredPool = require('../db/pool');
const { withScopedTransaction } = require('../db/scopedTransaction');

async function main() {
  // One connection proves that cleanup works on reuse, rather than accidentally
  // checking a different clean connection. No application rows are modified.
  const pool = new Pool({ ...configuredPool.options, max: 1 });
  try {
    const role = await pool.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    assert.deepEqual(role.rows[0], { rolsuper: false, rolbypassrls: false });
    let pid;
    for (const fail of [false, true]) {
      const expected = new Error('Expected transaction rollback');
      try {
        await withScopedTransaction(pool, { spaceId: 2147483646, libraryId: 2147483645 }, async client => {
          const result = await client.query(`SELECT pg_backend_pid() AS pid,
            current_setting('collectz.space_id') AS space,
            current_setting('collectz.library_id') AS library`);
          pid = result.rows[0].pid;
          assert.equal(result.rows[0].space, '2147483646');
          assert.equal(result.rows[0].library, '2147483645');
          if (fail) throw expected;
        });
      } catch (error) {
        if (error !== expected) throw error;
      }
      const result = await pool.query(`SELECT pg_backend_pid() AS pid,
        nullif(current_setting('collectz.space_id', true), '') AS space,
        nullif(current_setting('collectz.library_id', true), '') AS library`);
      assert.deepEqual(result.rows[0], { pid, space: null, library: null });
    }
    console.log('PASS: transaction scope clears after commit and rollback on the same runtime connection');
  } finally {
    await pool.end();
    await configuredPool.end();
  }
}

main().catch(() => {
  // Connection errors can contain connection details; keep diagnostics secret-free.
  console.error('FAIL: scoped transaction runtime verification');
  process.exitCode = 1;
});
