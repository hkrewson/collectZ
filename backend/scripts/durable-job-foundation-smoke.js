'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const pool = require('../db/pool');
const { createDurableJobStore } = require('../services/durableJobs');

async function loadFixtureScope() {
  const result = await pool.query(
    `SELECT s.id AS space_id,
            l.id AS library_id,
            COALESCE(sm.user_id, s.created_by) AS user_id
       FROM spaces s
       JOIN libraries l ON l.space_id = s.id AND l.archived_at IS NULL
       LEFT JOIN LATERAL (
         SELECT user_id
           FROM space_memberships
          WHERE space_id = s.id
            AND suspended_at IS NULL
          ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, user_id
          LIMIT 1
       ) sm ON TRUE
      WHERE s.archived_at IS NULL
        AND COALESCE(sm.user_id, s.created_by) IS NOT NULL
      ORDER BY s.id, l.id
      LIMIT 1`
  );
  if (!result.rows[0]) throw new Error('Durable job smoke requires one active workspace, library, and actor');
  return {
    spaceId: Number(result.rows[0].space_id),
    libraryId: Number(result.rows[0].library_id),
    userId: Number(result.rows[0].user_id)
  };
}

async function main() {
  const store = createDurableJobStore(pool);
  const fixture = await loadFixtureScope();
  const mismatchResult = await pool.query(
    `SELECT id
       FROM libraries
      WHERE space_id <> $1
        AND archived_at IS NULL
      ORDER BY id
      LIMIT 1`,
    [fixture.spaceId]
  );
  if (!mismatchResult.rows[0]) throw new Error('Durable job smoke requires a second workspace library for scope-FK proof');
  const mismatchedLibraryId = Number(mismatchResult.rows[0].id);
  const runId = crypto.randomUUID();
  const jobType = 'durable_job_contract_smoke';
  const provider = 'contract_smoke';
  const workerA = `smoke-a:${runId}`;
  const workerB = `smoke-b:${runId}`;
  let checks = 0;

  const enqueue = (suffix, overrides = {}) => store.enqueue({
    jobType,
    jobVersion: 1,
    provider,
    createdBy: fixture.userId,
    spaceId: fixture.spaceId,
    libraryId: fixture.libraryId,
    idempotencyKey: `${runId}:${suffix}`,
    targetRef: { fixture: suffix },
    progress: { total: 1, processed: 0 },
    maxAttempts: 3,
    ...overrides
  });

  try {
    const first = await enqueue('idempotent');
    const duplicate = await enqueue('idempotent');
    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.id, first.id);
    assert.equal(first.spaceId, fixture.spaceId);
    assert.equal(first.libraryId, fixture.libraryId);
    assert.equal(first.status, 'queued');
    checks += 6;

    await assert.rejects(
      () => enqueue('cross-workspace-library', { libraryId: mismatchedLibraryId }),
      (error) => error.code === '23503'
    );
    await assert.rejects(
      () => pool.query('UPDATE sync_jobs SET public_id = gen_random_uuid() WHERE id = $1', [first.id]),
      (error) => error.code === '23514'
    );
    checks += 2;

    await assert.rejects(
      () => enqueue('secret-rejection', { targetRef: { password: 'must-not-persist' } }),
      (error) => error.code === 'durable_job_secret_payload_rejected'
    );
    checks += 1;

    const claimed = await store.claimNext({ workerId: workerA, jobTypes: [jobType], leaseSeconds: 30 });
    assert.equal(claimed.id, first.id);
    assert.equal(claimed.attemptCount, 1);
    assert.equal(claimed.leaseOwner, workerA);
    checks += 3;

    const wrongRenewal = await store.renewLease({ jobId: claimed.id, workerId: workerB, leaseSeconds: 30 });
    assert.equal(wrongRenewal, null);
    const renewed = await store.renewLease({ jobId: claimed.id, workerId: workerA, leaseSeconds: 30 });
    assert.equal(renewed.id, claimed.id);
    const progressed = await store.reportProgress({
      jobId: claimed.id,
      workerId: workerA,
      progress: { total: 1, processed: 1 }
    });
    assert.equal(progressed.progress.processed, 1);
    checks += 3;

    const waiting = await store.settle({
      jobId: claimed.id,
      workerId: workerA,
      status: 'retry_wait',
      error: 'transient provider failure',
      retryAt: new Date(Date.now() - 1000),
      summary: { retryable: true }
    });
    assert.equal(waiting.status, 'retry_wait');
    assert.equal(waiting.leaseOwner, null);
    const reclaimed = await store.claimNext({ workerId: workerB, jobTypes: [jobType], leaseSeconds: 30 });
    assert.equal(reclaimed.id, first.id);
    assert.equal(reclaimed.attemptCount, 2);
    const succeeded = await store.settle({
      jobId: reclaimed.id,
      workerId: workerB,
      status: 'succeeded',
      summary: { processed: 1 }
    });
    assert.equal(succeeded.status, 'succeeded');
    assert.equal(succeeded.error, null);
    checks += 6;

    const runtimeSecret = crypto.randomBytes(18).toString('hex');
    const redactionJob = await enqueue('error-redaction', { maxAttempts: 1 });
    const redactionClaim = await store.claimNext({ workerId: workerA, jobTypes: [jobType], leaseSeconds: 30 });
    assert.equal(redactionClaim.id, redactionJob.id);
    const redactedFailure = await store.settle({
      jobId: redactionClaim.id,
      workerId: workerA,
      status: 'failed',
      error: `provider failed at https://fixture:${runtimeSecret}@example.invalid/catalog?token=${runtimeSecret}`,
      summary: { failed: true }
    });
    assert.equal(redactedFailure.status, 'failed');
    assert.ok(redactedFailure.error.includes('[REDACTED]'));
    assert.ok(!redactedFailure.error.includes(runtimeSecret));
    checks += 4;

    const cancellable = await enqueue('cancel');
    const cancelled = await store.requestCancellation({
      publicId: cancellable.publicId,
      spaceId: fixture.spaceId
    });
    assert.equal(cancelled.status, 'cancelled');
    assert.ok(cancelled.cancelledAt);
    checks += 2;

    const expiring = await enqueue('expired', { maxAttempts: 1 });
    const expiringClaim = await store.claimNext({ workerId: workerA, jobTypes: [jobType], leaseSeconds: 30 });
    assert.equal(expiringClaim.id, expiring.id);
    await pool.query(
      `UPDATE sync_jobs
          SET lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
        WHERE id = $1`,
      [expiring.id]
    );
    const recovered = await store.recoverExpiredLeases({ limit: 10 });
    const recoveredExpired = recovered.find((job) => job.id === expiring.id);
    assert.equal(recoveredExpired.status, 'failed');
    assert.equal(recoveredExpired.error, 'Worker lease expired before completion');
    checks += 3;

    const expiringCancellation = await enqueue('expired-cancellation');
    const cancellationClaim = await store.claimNext({ workerId: workerA, jobTypes: [jobType], leaseSeconds: 30 });
    assert.equal(cancellationClaim.id, expiringCancellation.id);
    const cancellationRequested = await store.requestCancellation({
      publicId: expiringCancellation.publicId,
      spaceId: fixture.spaceId
    });
    assert.ok(cancellationRequested.cancelRequestedAt);
    await pool.query(
      `UPDATE sync_jobs
          SET lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
        WHERE id = $1`,
      [expiringCancellation.id]
    );
    const cancelledRecovery = await store.recoverExpiredLeases({ limit: 10 });
    const recoveredCancellation = cancelledRecovery.find((job) => job.id === expiringCancellation.id);
    assert.equal(recoveredCancellation.status, 'cancelled');
    assert.ok(recoveredCancellation.cancelledAt);
    checks += 4;

    const concurrentOne = await enqueue('concurrent-1');
    const concurrentTwo = await enqueue('concurrent-2');
    const [claimOne, claimTwo] = await Promise.all([
      store.claimNext({ workerId: workerA, jobTypes: [jobType], leaseSeconds: 30 }),
      store.claimNext({ workerId: workerB, jobTypes: [jobType], leaseSeconds: 30 })
    ]);
    assert.ok(claimOne && claimTwo);
    assert.notEqual(claimOne.id, claimTwo.id);
    assert.deepEqual(new Set([claimOne.id, claimTwo.id]), new Set([concurrentOne.id, concurrentTwo.id]));
    await Promise.all([
      store.settle({ jobId: claimOne.id, workerId: claimOne.leaseOwner, status: 'succeeded', summary: { processed: 1 } }),
      store.settle({ jobId: claimTwo.id, workerId: claimTwo.leaseOwner, status: 'succeeded', summary: { processed: 1 } })
    ]);
    checks += 3;

    const readback = await store.getByPublicId({ publicId: first.publicId, spaceId: fixture.spaceId });
    assert.equal(readback.status, 'succeeded');
    assert.equal(readback.attemptCount, 2);
    checks += 2;

    console.log(JSON.stringify({
      ok: true,
      checks,
      contract: 'durable-workspace-job.v1',
      tested: [
        'stable-public-id',
        'workspace-library-scope',
        'cross-workspace-library-denial',
        'immutable-job-identity',
        'idempotent-enqueue',
        'secret-field-refusal',
        'error-credential-redaction',
        'skip-locked-claim',
        'owner-bound-lease-renewal',
        'progress',
        'bounded-retry',
        'cancellation',
        'expired-lease-cancellation',
        'expired-lease-terminal-failure',
        'workspace-scoped-readback'
      ]
    }, null, 2));
  } finally {
    await pool.query(
      `DELETE FROM sync_jobs
        WHERE job_type = $1
          AND provider = $2
          AND idempotency_key LIKE $3`,
      [jobType, provider, `${runId}:%`]
    );
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
