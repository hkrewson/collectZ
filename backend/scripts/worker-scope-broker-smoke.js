#!/usr/bin/env node

'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const {
  assertScopeBrokerPolicy,
  withAuthorizedWorkerTransaction
} = require('../db/scopeBroker');
const {
  createAuthorizedDurableRequestStore,
  createAuthorizedSyncJobServiceStore,
  createAuthorizedDurableWorkerStore,
  createDurableJobStore
} = require('../services/durableJobs');
const { createDurableJobWorker } = require('../services/durableJobWorker');

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
  const fixtureJobIds = [];
  const labels = [];
  const check = async (label, work) => {
    await work();
    labels.push({ label, pass: true });
  };

  try {
    const scopeResult = await pool.query(
      `SELECT s.id AS space_id, l.id AS library_id, sm.user_id AS actor_id
         FROM spaces s
         JOIN space_memberships sm ON sm.space_id = s.id
         LEFT JOIN libraries l ON l.space_id = s.id AND l.archived_at IS NULL
        WHERE s.archived_at IS NULL
        ORDER BY (l.id IS NULL), s.id, l.id, sm.user_id
        LIMIT 1`
    );
    assert.ok(scopeResult.rows[0], 'An active workspace is required for worker-scope certification');
    const spaceId = Number(scopeResult.rows[0].space_id);
    const libraryId = scopeResult.rows[0].library_id === null
      ? null
      : Number(scopeResult.rows[0].library_id);
    const actorId = Number(scopeResult.rows[0].actor_id);
    const rawStore = createDurableJobStore(pool);
    const requestStore = createAuthorizedDurableRequestStore({
      pool,
      allowedJobTypes: ['worker_scope_smoke']
    });
    const serviceStore = createAuthorizedSyncJobServiceStore({
      pool,
      observedJobTypes: ['worker_scope_legacy'],
      maintainedJobTypes: ['worker_scope_legacy']
    });
    const workerStore = createAuthorizedDurableWorkerStore({
      pool,
      allowedJobTypes: ['worker_scope_smoke', 'worker_scope_other']
    });
    const enqueueFixture = async (suffix, maxAttempts = 2) => {
      const job = await rawStore.enqueue({
        jobType: 'worker_scope_smoke',
        provider: 'worker_scope_smoke',
        spaceId,
        libraryId,
        maxAttempts,
        idempotencyKey: `worker-scope-smoke:${suffix}:${crypto.randomUUID()}`,
        targetRef: { fixture: true },
        progress: { processed: 0 }
      });
      fixtureJobIds.push(job.id);
      return job;
    };

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
    await check('observation and maintenance grants are action separated', async () => {
      await withAuthorizedWorkerTransaction(pool, {
        action: 'observe',
        workerId: 'service:observer',
        jobTypes: ['worker_scope_legacy']
      }, async (client) => {
        const result = await client.query(
          `SELECT collectz_scope.worker_allows_global('observe','worker_scope_legacy') AS observe_allowed,
                  collectz_scope.worker_allows_global('maintain','worker_scope_legacy') AS maintain_allowed,
                  collectz_scope.worker_allows_global('claim','worker_scope_legacy') AS claim_allowed`
        );
        assert.equal(result.rows[0].observe_allowed, true);
        assert.equal(result.rows[0].maintain_allowed, false);
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
    await check('authorized worker store executes the complete lifecycle', async () => {
      const queued = await enqueueFixture('lifecycle');
      const worker = createDurableJobWorker({
        store: workerStore,
        workerId: 'worker:smoke-store',
        jobTypes: ['worker_scope_smoke'],
        execute: async (job, context) => {
          assert.equal(job.id, queued.id);
          await context.reportProgress({ processed: 1 });
          return { summary: { processed: 1 } };
        }
      });
      const result = await worker.runOnce();
      assert.equal(result.claimed, true);
      assert.equal(result.job.status, 'succeeded');
      assert.deepEqual(result.job.summary, { processed: 1 });
    });
    await check('lifecycle SQL rejects mismatched job scope', async () => {
      const queued = await enqueueFixture('scope-mismatch');
      const workerId = 'worker:scope-mismatch';
      const claimed = await workerStore.claimNext({
        workerId,
        jobTypes: ['worker_scope_smoke'],
        leaseSeconds: 30
      });
      assert.equal(claimed.id, queued.id);
      const mismatched = await workerStore.renewLease({
        jobId: claimed.id,
        workerId,
        leaseSeconds: 30,
        jobType: 'worker_scope_other',
        spaceId,
        libraryId
      });
      assert.equal(mismatched, null);
      const settled = await workerStore.settle({
        jobId: claimed.id,
        workerId,
        status: 'succeeded',
        summary: { verified: true },
        jobType: claimed.jobType,
        spaceId,
        libraryId
      });
      assert.equal(settled.status, 'succeeded');
    });
    await check('authorized recovery is job-type bounded', async () => {
      const queued = await enqueueFixture('recovery', 1);
      const workerId = 'worker:recovery-store';
      const claimed = await workerStore.claimNext({
        workerId,
        jobTypes: ['worker_scope_smoke'],
        leaseSeconds: 30
      });
      assert.equal(claimed.id, queued.id);
      await pool.query(
        `UPDATE sync_jobs
            SET lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
          WHERE id = $1`,
        [claimed.id]
      );
      const recovered = await workerStore.recoverExpiredLeases({
        workerId: 'worker:smoke-recovery',
        jobTypes: ['worker_scope_smoke'],
        limit: 10
      });
      const recoveredFixture = recovered.find((job) => job.id === claimed.id);
      assert.equal(recoveredFixture.status, 'failed');
      assert.equal(recoveredFixture.error, 'Worker lease expired before completion');
    });
    await check('authorized request store enqueues reads and cancels within workspace', async () => {
      const queued = await requestStore.enqueue({
        actorId,
        jobType: 'worker_scope_smoke',
        provider: 'worker_scope_smoke',
        spaceId,
        libraryId,
        idempotencyKey: `worker-scope-request:${crypto.randomUUID()}`,
        targetRef: { fixture: true },
        progress: { processed: 0 }
      });
      fixtureJobIds.push(queued.id);
      assert.equal(queued.createdBy, actorId);
      const listed = await requestStore.listOperatorJobs({ spaceId, actorId, limit: 10 });
      assert.ok(listed.some((job) => job.publicId === queued.publicId));
      const detail = await requestStore.getOperatorJob({ publicId: queued.publicId, spaceId, actorId });
      assert.equal(detail.publicId, queued.publicId);
      const cancelled = await requestStore.requestOperatorCancellation({
        publicId: queued.publicId,
        spaceId,
        actorId
      });
      assert.equal(cancelled.status, 'cancelled');
    });
    await check('authorized request store rejects jobs outside its allowlist', async () => {
      await assert.rejects(
        async () => requestStore.enqueue({
          actorId,
          jobType: 'worker_scope_other',
          provider: 'worker_scope_smoke',
          spaceId,
          libraryId,
          idempotencyKey: `worker-scope-disallowed:${crypto.randomUUID()}`
        }),
        (error) => error.code === 'durable_job_invalid_input'
      );
      const hidden = await rawStore.enqueue({
        jobType: 'worker_scope_other',
        provider: 'worker_scope_smoke',
        spaceId,
        libraryId,
        idempotencyKey: `worker-scope-hidden:${crypto.randomUUID()}`
      });
      fixtureJobIds.push(hidden.id);
      const detail = await requestStore.getOperatorJob({ publicId: hidden.publicId, spaceId, actorId });
      assert.equal(detail, null);
      const cancelled = await requestStore.requestOperatorCancellation({
        publicId: hidden.publicId,
        spaceId,
        actorId
      });
      assert.equal(cancelled, null);
    });
    await check('authorized service store observes and repairs only allowlisted legacy jobs', async () => {
      const inserted = await pool.query(
        `INSERT INTO sync_jobs (
           job_type, provider, status, created_by, space_id, library_id, scope, progress
         ) VALUES (
           'worker_scope_legacy', 'worker_scope_smoke', 'running', $1, $2, $3, $4::jsonb, '{}'::jsonb
         )
         RETURNING id`,
        [actorId, spaceId, libraryId, JSON.stringify({ spaceId, ...(libraryId ? { libraryId } : {}) })]
      );
      fixtureJobIds.push(inserted.rows[0].id);
      const counts = await serviceStore.observeStatusCounts();
      assert.equal(counts.find((row) => row.status === 'running')?.count, 1);
      const recovered = await serviceStore.recoverStaleLegacyJobs();
      assert.equal(recovered, 1);
      const row = await pool.query('SELECT status, error FROM sync_jobs WHERE id = $1', [inserted.rows[0].id]);
      assert.equal(row.rows[0].status, 'failed');
      assert.equal(row.rows[0].error, 'Process restarted before job completion');
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
    if (fixtureJobIds.length > 0) {
      await pool.query('DELETE FROM sync_jobs WHERE id = ANY($1::int[])', [fixtureJobIds]).catch(() => {});
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Durable worker scope broker smoke failed: ${error.message}`);
  process.exitCode = 1;
});
