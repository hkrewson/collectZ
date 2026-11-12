'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDurableJobWorker } = require('../services/durableJobWorker');

function createStore(job, overrides = {}) {
  const calls = [];
  const store = {
    async claimNext(args) {
      calls.push(['claimNext', args]);
      return job;
    },
    async renewLease(args) {
      calls.push(['renewLease', args]);
      return job;
    },
    async getByPublicId(args) {
      calls.push(['getByPublicId', args]);
      return job;
    },
    async reportProgress(args) {
      calls.push(['reportProgress', args]);
      return { ...job, progress: args.progress };
    },
    async settle(args) {
      calls.push(['settle', args]);
      return { ...job, status: args.status, summary: args.summary };
    },
    ...overrides
  };
  return { store, calls };
}

const baseJob = Object.freeze({
  id: 41,
  publicId: '7a9e217a-aed8-4c1f-881f-b775f8373d4e',
  jobType: 'plex_reconciliation_sync',
  provider: 'plex',
  status: 'running',
  spaceId: 2,
  libraryId: 3,
  attemptCount: 1,
  maxAttempts: 3,
  leaseOwner: 'test-worker',
  cancelRequestedAt: null
});

test('durable worker claims, checkpoints, reports progress, and succeeds through the lifecycle interface', async () => {
  const { store, calls } = createStore(baseJob);
  const worker = createDurableJobWorker({
    store,
    workerId: 'test-worker',
    jobTypes: ['plex_reconciliation_sync'],
    execute: async (_job, context) => {
      await context.reportProgress({ processed: 1 });
      return { summary: { scanned: 1 } };
    }
  });
  const result = await worker.runOnce();
  assert.equal(result.job.status, 'succeeded');
  assert.deepEqual(calls.at(-1)[1].summary, { scanned: 1 });
  assert.deepEqual(calls.map(([name]) => name), ['claimNext', 'getByPublicId', 'reportProgress', 'settle']);
});

test('durable worker turns a cancellation request into cancelled settlement', async () => {
  const cancelled = { ...baseJob, cancelRequestedAt: new Date().toISOString() };
  const { store, calls } = createStore(cancelled);
  const worker = createDurableJobWorker({
    store,
    workerId: 'test-worker',
    jobTypes: ['plex_reconciliation_sync'],
    execute: async () => ({ summary: { shouldNotRun: true } })
  });
  const result = await worker.runOnce();
  assert.equal(result.job.status, 'cancelled');
  assert.equal(calls.some(([name]) => name === 'reportProgress'), false);
});

test('durable worker schedules bounded retry settlement for retryable failures', async () => {
  const { store, calls } = createStore(baseJob);
  const worker = createDurableJobWorker({
    store,
    workerId: 'test-worker',
    jobTypes: ['plex_reconciliation_sync'],
    retryDelayMs: () => 2500,
    execute: async () => {
      throw new Error('temporary provider failure');
    }
  });
  const result = await worker.runOnce();
  assert.equal(result.job.status, 'retry_wait');
  const settlement = calls.find(([name]) => name === 'settle')[1];
  assert.equal(settlement.status, 'retry_wait');
  assert.ok(settlement.retryAt instanceof Date);
});

test('durable worker terminally settles errors classified as permanent', async () => {
  const { store, calls } = createStore(baseJob);
  const worker = createDurableJobWorker({
    store,
    workerId: 'test-worker',
    jobTypes: ['plex_reconciliation_sync'],
    classifyError: () => 'failed',
    execute: async () => {
      throw new Error('configuration missing');
    }
  });
  const result = await worker.runOnce();
  assert.equal(result.job.status, 'failed');
  assert.equal(calls.find(([name]) => name === 'settle')[1].retryAt, null);
});

test('durable worker contains settlement failures so the polling loop can continue', async () => {
  const { store } = createStore(baseJob, {
    async settle() {
      throw new Error('database temporarily unavailable');
    }
  });
  const worker = createDurableJobWorker({
    store,
    workerId: 'test-worker',
    jobTypes: ['plex_reconciliation_sync'],
    execute: async () => {
      throw new Error('provider failure');
    }
  });
  const result = await worker.runOnce();
  assert.equal(result.claimed, true);
  assert.equal(result.error.message, 'database temporarily unavailable');
  assert.equal(worker.getState().lastStatus, 'settlement_failed');
});
