#!/usr/bin/env node

'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const {
  assertScopeBrokerPolicy,
  withAuthorizedWorkerTransaction
} = require('../db/scopeBroker');

const outputPath = path.resolve(
  __dirname,
  '..',
  process.env.WORKER_SCOPE_BROKER_OUTPUT || 'artifacts/worker-scope-broker-evidence.json'
);
const ssl = ['true', '1'].includes(process.env.DATABASE_SSL)
  ? { rejectUnauthorized: false }
  : false;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 2 });
  const labels = [];
  const check = async (label, work) => {
    await work();
    labels.push({ label, pass: true });
  };

  try {
    const scopeResult = await pool.query(
      `SELECT s.id AS space_id, l.id AS library_id
         FROM spaces s
         LEFT JOIN libraries l ON l.space_id = s.id AND l.archived_at IS NULL
        WHERE s.archived_at IS NULL
        ORDER BY (l.id IS NULL), s.id, l.id
        LIMIT 1`
    );
    assert.ok(scopeResult.rows[0], 'An active workspace is required for worker-scope certification');
    const spaceId = Number(scopeResult.rows[0].space_id);
    const libraryId = scopeResult.rows[0].library_id === null
      ? null
      : Number(scopeResult.rows[0].library_id);

    await check('broker retains bounded grant-only privileges', async () => {
      await assertScopeBrokerPolicy(process.env.DATABASE_URL, { ssl });
    });
    await check('runtime cannot read private worker grants', async () => {
      await assert.rejects(
        pool.query('SELECT * FROM collectz_scope.worker_transactions'),
        (error) => error.code === '42501'
      );
    });
    await check('unscoped runtime has no worker authority', async () => {
      const result = await pool.query(
        `SELECT collectz_scope.worker_allows_global('claim','bookorbit_sync') AS global_allowed,
                collectz_scope.worker_allows_lifecycle($1,$2,'bookorbit_sync','worker:smoke') AS lifecycle_allowed`,
        [spaceId, libraryId]
      );
      assert.equal(result.rows[0].global_allowed, false);
      assert.equal(result.rows[0].lifecycle_allowed, false);
    });
    await check('claim grant is action and job-type bounded', async () => {
      await withAuthorizedWorkerTransaction(pool, {
        action: 'claim',
        workerId: 'worker:smoke',
        jobTypes: ['plex_reconciliation', 'bookorbit_sync', 'bookorbit_sync']
      }, async (client, grant) => {
        assert.deepEqual(grant.jobTypes, ['bookorbit_sync', 'plex_reconciliation']);
        const result = await client.query(
          `SELECT collectz_scope.worker_allows_global('claim','bookorbit_sync') AS allowed,
                  collectz_scope.worker_allows_global('claim','unknown_job') AS wrong_type,
                  collectz_scope.worker_allows_global('recover','bookorbit_sync') AS wrong_action`
        );
        assert.equal(result.rows[0].allowed, true);
        assert.equal(result.rows[0].wrong_type, false);
        assert.equal(result.rows[0].wrong_action, false);
      });
    });
    await check('recovery grant is distinct from claim', async () => {
      await withAuthorizedWorkerTransaction(pool, {
        action: 'recover',
        workerId: 'worker:recovery',
        jobTypes: ['bookorbit_sync']
      }, async (client) => {
        const result = await client.query(
          `SELECT collectz_scope.worker_allows_global('recover','bookorbit_sync') AS allowed,
                  collectz_scope.worker_allows_global('claim','bookorbit_sync') AS claim_allowed`
        );
        assert.equal(result.rows[0].allowed, true);
        assert.equal(result.rows[0].claim_allowed, false);
      });
    });
    await check('lifecycle grant binds worker workspace library and job type', async () => {
      await withAuthorizedWorkerTransaction(pool, {
        action: 'lifecycle',
        workerId: 'worker:lifecycle',
        jobTypes: ['bookorbit_sync'],
        spaceId,
        ...(libraryId ? { libraryId } : {})
      }, async (client) => {
        const result = await client.query(
          `SELECT collectz_scope.worker_allows_lifecycle($1,$2,'bookorbit_sync','worker:lifecycle') AS allowed,
                  collectz_scope.worker_allows_lifecycle($1,$2,'bookorbit_sync','worker:other') AS wrong_worker,
                  collectz_scope.worker_allows_lifecycle($1,$2,'plex_reconciliation','worker:lifecycle') AS wrong_type,
                  collectz_scope.worker_allows_lifecycle($3,$2,'bookorbit_sync','worker:lifecycle') AS wrong_space`,
          [spaceId, libraryId, 2147483647]
        );
        assert.equal(result.rows[0].allowed, true);
        assert.equal(result.rows[0].wrong_worker, false);
        assert.equal(result.rows[0].wrong_type, false);
        assert.equal(result.rows[0].wrong_space, false);
      });
    });
    await check('worker grant cannot be replayed after commit', async () => {
      const result = await pool.query(
        `SELECT collectz_scope.worker_allows_global('claim','bookorbit_sync') AS allowed,
                collectz_scope.worker_allows_lifecycle($1,$2,'bookorbit_sync','worker:lifecycle') AS lifecycle_allowed`,
        [spaceId, libraryId]
      );
      assert.equal(result.rows[0].allowed, false);
      assert.equal(result.rows[0].lifecycle_allowed, false);
    });

    const evidence = {
      generated_at: new Date().toISOString(),
      certification: 'durable-worker-scope-broker',
      status: 'passed',
      checks: labels
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`Durable worker scope broker smoke passed (${labels.length}/${labels.length}).`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Durable worker scope broker smoke failed: ${error.message}`);
  process.exitCode = 1;
});
