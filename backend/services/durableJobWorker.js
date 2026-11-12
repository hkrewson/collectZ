'use strict';

const crypto = require('crypto');

const CANCELLED_CODE = 'durable_job_cancelled';
const LOST_LEASE_CODE = 'durable_job_lease_lost';

function workerError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function`);
  return value;
}

function positiveInteger(value, fallback, label, { minimum = 1, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
  return parsed;
}

function defaultRetryDelayMs(job = {}) {
  const attempt = Math.max(1, Number(job.attemptCount || 1));
  return Math.min(15 * 60 * 1000, 30 * 1000 * (2 ** Math.max(0, attempt - 1)));
}

function createDurableJobWorker(options = {}) {
  const store = options.store;
  if (!store || typeof store.claimNext !== 'function' || typeof store.settle !== 'function') {
    throw new TypeError('Durable job worker requires a lifecycle store');
  }
  const execute = requireFunction(options.execute, 'execute');
  const classifyError = typeof options.classifyError === 'function'
    ? options.classifyError
    : () => 'retry';
  const retryDelayMs = typeof options.retryDelayMs === 'function'
    ? options.retryDelayMs
    : defaultRetryDelayMs;
  const jobTypes = [...new Set((options.jobTypes || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (jobTypes.length === 0) throw new TypeError('Durable job worker requires at least one job type');
  const leaseSeconds = positiveInteger(options.leaseSeconds, 300, 'leaseSeconds', { minimum: 5, maximum: 3600 });
  const pollIntervalMs = positiveInteger(options.pollIntervalMs, 1000, 'pollIntervalMs', { minimum: 100, maximum: 60000 });
  const heartbeatIntervalMs = positiveInteger(
    options.heartbeatIntervalMs,
    Math.max(1000, Math.floor((leaseSeconds * 1000) / 3)),
    'heartbeatIntervalMs',
    { minimum: 100, maximum: leaseSeconds * 1000 }
  );
  const workerId = String(options.workerId || `worker:${process.pid}:${crypto.randomUUID()}`).slice(0, 160);
  const state = {
    running: false,
    started: false,
    lastClaimedAt: null,
    lastFinishedAt: null,
    lastJobPublicId: null,
    lastStatus: null,
    lastError: null
  };
  let timer = null;
  let stopped = false;

  async function runOnce() {
    if (state.running) return { claimed: false, reason: 'already_running' };
    state.running = true;
    let job = null;
    let heartbeat = null;
    let cancellationRequested = false;
    let leaseLost = false;
    try {
      job = await store.claimNext({ workerId, leaseSeconds, jobTypes });
      if (!job) return { claimed: false, reason: 'empty' };
      state.lastClaimedAt = new Date().toISOString();
      state.lastJobPublicId = job.publicId;
      state.lastStatus = 'running';
      state.lastError = null;

      heartbeat = setInterval(async () => {
        try {
          const renewed = await store.renewLease({ jobId: job.id, workerId, leaseSeconds });
          if (!renewed) {
            const current = await store.getByPublicId({ publicId: job.publicId, spaceId: job.spaceId });
            cancellationRequested = Boolean(current?.cancelRequestedAt);
            leaseLost = !cancellationRequested;
            return;
          }
          cancellationRequested = Boolean(renewed.cancelRequestedAt);
        } catch (error) {
          leaseLost = true;
          state.lastError = error.message || 'Durable job heartbeat failed';
        }
      }, heartbeatIntervalMs);
      heartbeat.unref?.();

      const checkpoint = async () => {
        if (leaseLost) throw workerError('Durable job lease was lost', LOST_LEASE_CODE);
        const current = await store.getByPublicId({ publicId: job.publicId, spaceId: job.spaceId });
        if (!current || current.leaseOwner !== workerId || current.status !== 'running') {
          throw workerError('Durable job lease was lost', LOST_LEASE_CODE);
        }
        cancellationRequested = Boolean(current.cancelRequestedAt);
        if (cancellationRequested) throw workerError('Durable job was cancelled', CANCELLED_CODE);
        return current;
      };
      const reportProgress = async (progress) => {
        if (leaseLost) throw workerError('Durable job lease was lost', LOST_LEASE_CODE);
        const current = await store.reportProgress({ jobId: job.id, workerId, progress });
        if (!current) throw workerError('Durable job lease was lost', LOST_LEASE_CODE);
        cancellationRequested = Boolean(current.cancelRequestedAt);
        if (cancellationRequested) throw workerError('Durable job was cancelled', CANCELLED_CODE);
        return current;
      };

      await checkpoint();
      const result = await execute(job, Object.freeze({ checkpoint, reportProgress, workerId }));
      if (leaseLost) throw workerError('Durable job lease was lost', LOST_LEASE_CODE);
      const settled = await store.settle({
        jobId: job.id,
        workerId,
        status: cancellationRequested ? 'cancelled' : 'succeeded',
        summary: result?.summary || result || {}
      });
      if (!settled) throw workerError('Durable job lease was lost before settlement', LOST_LEASE_CODE);
      state.lastStatus = settled.status;
      return { claimed: true, job: settled };
    } catch (error) {
      state.lastError = error.message || 'Durable job execution failed';
      if (!job || error.code === LOST_LEASE_CODE || leaseLost) {
        state.lastStatus = error.code === LOST_LEASE_CODE || leaseLost ? 'lease_lost' : 'failed';
        return { claimed: Boolean(job), job, error };
      }
      const cancelled = cancellationRequested || error.code === CANCELLED_CODE;
      const disposition = cancelled ? 'cancelled' : classifyError(error, job);
      const status = disposition === 'retry' ? 'retry_wait' : (disposition === 'cancelled' ? 'cancelled' : 'failed');
      const delay = Math.max(1000, Number(retryDelayMs(job, error)) || defaultRetryDelayMs(job));
      let settled = null;
      try {
        settled = await store.settle({
          jobId: job.id,
          workerId,
          status,
          summary: {},
          error: error.message || 'Durable job execution failed',
          retryAt: status === 'retry_wait' ? new Date(Date.now() + delay) : null
        });
      } catch (settlementError) {
        state.lastError = settlementError.message || 'Durable job settlement failed';
        state.lastStatus = 'settlement_failed';
        return { claimed: true, job, error: settlementError };
      }
      state.lastStatus = settled?.status || status;
      return { claimed: true, job: settled || job, error };
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      state.running = false;
      state.lastFinishedAt = new Date().toISOString();
    }
  }

  function scheduleNext(delay = pollIntervalMs) {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        await runOnce();
      } catch (error) {
        state.lastError = error.message || 'Durable job worker loop failed';
        state.lastStatus = 'worker_error';
      } finally {
        scheduleNext();
      }
    }, delay);
    timer.unref?.();
  }

  function start({ initialDelayMs = 0 } = {}) {
    if (state.started) return false;
    stopped = false;
    state.started = true;
    scheduleNext(Math.max(0, Number(initialDelayMs) || 0));
    return true;
  }

  function stop() {
    stopped = true;
    state.started = false;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return Object.freeze({
    runOnce,
    start,
    stop,
    getState: () => ({ ...state, workerId, jobTypes: [...jobTypes], leaseSeconds, pollIntervalMs })
  });
}

module.exports = {
  CANCELLED_CODE,
  LOST_LEASE_CODE,
  createDurableJobWorker,
  defaultRetryDelayMs
};
