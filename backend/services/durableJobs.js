'use strict';

const { sanitizeAuditDetails, sanitizeLogField } = require('./audit');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_NAME_PATTERN = /^[a-z][a-z0-9_.:-]{1,79}$/;
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|credential|password|secret|session.?token|csrf.?token|api.?key|access.?token|refresh.?token)$/i;
const FINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
const SETTLEMENT_STATUSES = new Set(['succeeded', 'failed', 'retry_wait', 'cancelled']);

function durableJobError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requirePositiveInteger(value, label, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw durableJobError(`${label} must be a positive integer`, 'durable_job_invalid_input');
  }
  return normalized;
}

function requireSafeName(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!SAFE_NAME_PATTERN.test(normalized)) {
    throw durableJobError(`${label} must use a stable lowercase identifier`, 'durable_job_invalid_input');
  }
  return normalized;
}

function requireUuid(value, label, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  const normalized = String(value || '').trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw durableJobError(`${label} must be a UUID`, 'durable_job_invalid_input');
  }
  return normalized;
}

function requirePlainObject(value, label) {
  const normalized = value ?? {};
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw durableJobError(`${label} must be an object`, 'durable_job_invalid_input');
  }
  return normalized;
}

function assertSecretFree(value, path = 'payload') {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key) && !/(credential|connection|token)_?id$/i.test(key)) {
      throw durableJobError(`Secret-bearing durable job field is not allowed at ${path}.${key}`, 'durable_job_secret_payload_rejected');
    }
    assertSecretFree(entry, `${path}.${key}`);
  }
}

function normalizeWorkerId(workerId) {
  const normalized = sanitizeLogField(workerId).slice(0, 160);
  if (!normalized) {
    throw durableJobError('workerId is required', 'durable_job_invalid_input');
  }
  return normalized;
}

function normalizeLeaseSeconds(value) {
  const seconds = Number(value ?? 300);
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 3600) {
    throw durableJobError('leaseSeconds must be between 5 and 3600', 'durable_job_invalid_input');
  }
  return seconds;
}

function sanitizeStructuredValue(value, label) {
  const normalized = requirePlainObject(value, label);
  assertSecretFree(normalized, label);
  return sanitizeAuditDetails(normalized);
}

function sanitizeErrorMessage(value) {
  const normalized = sanitizeLogField(value || 'Durable job failed').slice(0, 1000);
  if (!normalized) return 'Durable job failed';
  return sanitizeAuditDetails(normalized)
    .replace(/(https?:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\b(basic|bearer)\s+[^\s,;]+/gi, '$1 [REDACTED]')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|token)=)[^&\s]+/gi, '$1[REDACTED]');
}

function shapeJob(row, created = undefined) {
  if (!row) return null;
  const result = {
    id: row.id,
    publicId: row.public_id,
    jobType: row.job_type,
    jobVersion: row.job_version,
    provider: row.provider,
    status: row.status,
    createdBy: row.created_by,
    spaceId: row.space_id,
    libraryId: row.library_id,
    providerConnectionId: row.provider_connection_id,
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    targetRef: row.target_ref || {},
    progress: row.progress || {},
    summary: row.summary || null,
    error: row.error || null,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    heartbeatAt: row.heartbeat_at,
    cancelRequestedAt: row.cancel_requested_at,
    cancelledAt: row.cancelled_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (created !== undefined) result.created = created;
  return result;
}

function shapeOperatorJob(row) {
  if (!row) return null;
  const status = String(row.status || '').trim().toLowerCase();
  return Object.freeze({
    publicId: row.public_id,
    jobType: row.job_type,
    jobVersion: row.job_version,
    provider: row.provider,
    status,
    libraryId: row.library_id,
    providerConnectionId: row.provider_connection_id,
    progress: sanitizeAuditDetails(row.progress || {}),
    summary: row.summary ? sanitizeAuditDetails(row.summary) : null,
    failureReason: row.error ? sanitizeErrorMessage(row.error) : null,
    attemptCount: Number(row.attempt_count || 0),
    maxAttempts: Number(row.max_attempts || 0),
    nextEligibleAt: ['queued', 'retry_wait'].includes(status) ? row.available_at : null,
    cancelRequestedAt: row.cancel_requested_at,
    cancelledAt: row.cancelled_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canCancel: !FINAL_STATUSES.has(status) && !row.cancel_requested_at
  });
}

const RETURNING_COLUMNS = `
  id, public_id, job_type, job_version, provider, status, created_by,
  space_id, library_id, provider_connection_id, correlation_id, idempotency_key,
  target_ref, progress, summary, error, attempt_count, max_attempts, available_at,
  lease_owner, lease_expires_at, heartbeat_at, cancel_requested_at, cancelled_at,
  started_at, finished_at, created_at, updated_at`;
const QUALIFIED_RETURNING_COLUMNS = RETURNING_COLUMNS
  .split(',')
  .map((column) => `j.${column.trim()}`)
  .join(', ');

function createDurableJobStore(queryAdapter) {
  if (!queryAdapter || typeof queryAdapter.query !== 'function') {
    throw durableJobError('A PostgreSQL query adapter is required', 'durable_job_invalid_adapter');
  }

  async function enqueue(spec = {}) {
    const jobType = requireSafeName(spec.jobType, 'jobType');
    const provider = requireSafeName(spec.provider, 'provider');
    const jobVersion = requirePositiveInteger(spec.jobVersion ?? 1, 'jobVersion');
    const createdBy = requirePositiveInteger(spec.createdBy, 'createdBy', { nullable: true });
    const spaceId = requirePositiveInteger(spec.spaceId, 'spaceId');
    const libraryId = requirePositiveInteger(spec.libraryId, 'libraryId', { nullable: true });
    const providerConnectionId = requireUuid(spec.providerConnectionId, 'providerConnectionId', { nullable: true });
    const correlationId = requireUuid(spec.correlationId, 'correlationId', { nullable: true });
    const maxAttempts = requirePositiveInteger(spec.maxAttempts ?? 3, 'maxAttempts');
    const idempotencyKey = spec.idempotencyKey === null || spec.idempotencyKey === undefined
      ? null
      : String(spec.idempotencyKey).trim().slice(0, 255);
    if (spec.idempotencyKey !== null && spec.idempotencyKey !== undefined && !idempotencyKey) {
      throw durableJobError('idempotencyKey cannot be empty', 'durable_job_invalid_input');
    }
    const targetRef = sanitizeStructuredValue(spec.targetRef || {}, 'targetRef');
    const progress = sanitizeStructuredValue(spec.progress || {}, 'progress');
    const compatibilityScope = {
      spaceId,
      ...(libraryId ? { libraryId } : {}),
      ...(providerConnectionId ? { connectionId: providerConnectionId } : {}),
      durableLifecycle: true
    };

    const insert = await queryAdapter.query(
      `INSERT INTO sync_jobs (
         job_type, job_version, provider, status, created_by,
         space_id, library_id, provider_connection_id, correlation_id,
         idempotency_key, target_ref, scope, progress, max_attempts, available_at
       ) VALUES (
         $1, $2, $3, 'queued', $4,
         $5, $6, $7, COALESCE($8::uuid, gen_random_uuid()),
         $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, COALESCE($14::timestamptz, CURRENT_TIMESTAMP)
       )
       ON CONFLICT (space_id, job_type, provider, idempotency_key)
         WHERE idempotency_key IS NOT NULL
       DO NOTHING
       RETURNING ${RETURNING_COLUMNS}`,
      [
        jobType,
        jobVersion,
        provider,
        createdBy,
        spaceId,
        libraryId,
        providerConnectionId,
        correlationId,
        idempotencyKey,
        JSON.stringify(targetRef),
        JSON.stringify(compatibilityScope),
        JSON.stringify(progress),
        maxAttempts,
        spec.availableAt || null
      ]
    );
    if (insert.rows[0]) return shapeJob(insert.rows[0], true);
    if (!idempotencyKey) {
      throw durableJobError('Durable job enqueue did not return a row', 'durable_job_enqueue_failed');
    }
    const existing = await queryAdapter.query(
      `SELECT ${RETURNING_COLUMNS}
         FROM sync_jobs
        WHERE space_id = $1
          AND job_type = $2
          AND provider = $3
          AND idempotency_key = $4
        LIMIT 1`,
      [spaceId, jobType, provider, idempotencyKey]
    );
    if (!existing.rows[0]) {
      throw durableJobError('Idempotent durable job could not be read after conflict', 'durable_job_enqueue_conflict');
    }
    return shapeJob(existing.rows[0], false);
  }

  async function claimNext(options = {}) {
    const workerId = normalizeWorkerId(options.workerId);
    const leaseSeconds = normalizeLeaseSeconds(options.leaseSeconds);
    const jobTypes = options.jobTypes === undefined || options.jobTypes === null
      ? null
      : [...new Set(options.jobTypes.map((value) => requireSafeName(value, 'jobType')))];
    if (jobTypes && jobTypes.length === 0) return null;
    const result = await queryAdapter.query(
      `WITH candidate AS (
         SELECT id
           FROM sync_jobs
          WHERE status IN ('queued', 'retry_wait')
            AND available_at <= CURRENT_TIMESTAMP
            AND cancel_requested_at IS NULL
            AND attempt_count < max_attempts
            AND ($1::text[] IS NULL OR job_type = ANY($1::text[]))
          ORDER BY available_at ASC, created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE sync_jobs j
          SET status = 'running',
              attempt_count = attempt_count + 1,
              lease_owner = $2,
              lease_expires_at = CURRENT_TIMESTAMP + ($3 * INTERVAL '1 second'),
              heartbeat_at = CURRENT_TIMESTAMP,
              started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
              finished_at = NULL,
              error = NULL
         FROM candidate
        WHERE j.id = candidate.id
       RETURNING ${QUALIFIED_RETURNING_COLUMNS}`,
      [jobTypes, workerId, leaseSeconds]
    );
    return shapeJob(result.rows[0]);
  }

  async function renewLease({ jobId, workerId, leaseSeconds = 300 } = {}) {
    const id = requirePositiveInteger(jobId, 'jobId');
    const owner = normalizeWorkerId(workerId);
    const seconds = normalizeLeaseSeconds(leaseSeconds);
    const result = await queryAdapter.query(
      `UPDATE sync_jobs
          SET heartbeat_at = CURRENT_TIMESTAMP,
              lease_expires_at = CURRENT_TIMESTAMP + ($3 * INTERVAL '1 second')
        WHERE id = $1
          AND status = 'running'
          AND lease_owner = $2
          AND lease_expires_at > CURRENT_TIMESTAMP
          AND cancel_requested_at IS NULL
       RETURNING ${RETURNING_COLUMNS}`,
      [id, owner, seconds]
    );
    return shapeJob(result.rows[0]);
  }

  async function reportProgress({ jobId, workerId, progress } = {}) {
    const id = requirePositiveInteger(jobId, 'jobId');
    const owner = normalizeWorkerId(workerId);
    const safeProgress = sanitizeStructuredValue(progress || {}, 'progress');
    const result = await queryAdapter.query(
      `UPDATE sync_jobs
          SET progress = $3::jsonb
        WHERE id = $1
          AND status = 'running'
          AND lease_owner = $2
          AND lease_expires_at > CURRENT_TIMESTAMP
       RETURNING ${RETURNING_COLUMNS}`,
      [id, owner, JSON.stringify(safeProgress)]
    );
    return shapeJob(result.rows[0]);
  }

  async function settle({ jobId, workerId, status, summary = {}, error = null, retryAt = null } = {}) {
    const id = requirePositiveInteger(jobId, 'jobId');
    const owner = normalizeWorkerId(workerId);
    const requestedStatus = String(status || '').trim().toLowerCase();
    if (!SETTLEMENT_STATUSES.has(requestedStatus)) {
      throw durableJobError('Invalid durable job settlement status', 'durable_job_invalid_input');
    }
    const safeSummary = sanitizeStructuredValue(summary || {}, 'summary');
    const safeError = requestedStatus === 'succeeded' ? null : sanitizeErrorMessage(error);
    if (requestedStatus === 'retry_wait' && !retryAt) {
      throw durableJobError('retryAt is required for retry settlement', 'durable_job_invalid_input');
    }
    const result = await queryAdapter.query(
      `UPDATE sync_jobs
          SET status = CASE
                WHEN cancel_requested_at IS NOT NULL OR $3 = 'cancelled' THEN 'cancelled'
                WHEN $3 = 'retry_wait' AND attempt_count >= max_attempts THEN 'failed'
                ELSE $3
              END,
              summary = $4::jsonb,
              error = CASE WHEN $3 = 'succeeded' THEN NULL ELSE $5 END,
              available_at = CASE
                WHEN $3 = 'retry_wait' AND attempt_count < max_attempts THEN $6::timestamptz
                ELSE available_at
              END,
              cancelled_at = CASE
                WHEN cancel_requested_at IS NOT NULL OR $3 = 'cancelled' THEN CURRENT_TIMESTAMP
                ELSE cancelled_at
              END,
              finished_at = CASE
                WHEN $3 = 'retry_wait' AND attempt_count < max_attempts AND cancel_requested_at IS NULL THEN NULL
                ELSE CURRENT_TIMESTAMP
              END,
              lease_owner = NULL,
              lease_expires_at = NULL,
              heartbeat_at = NULL
        WHERE id = $1
          AND status = 'running'
          AND lease_owner = $2
       RETURNING ${RETURNING_COLUMNS}`,
      [id, owner, requestedStatus, JSON.stringify(safeSummary), safeError, retryAt]
    );
    return shapeJob(result.rows[0]);
  }

  async function requestCancellationRow({ publicId, spaceId } = {}) {
    const id = requireUuid(publicId, 'publicId');
    const workspace = requirePositiveInteger(spaceId, 'spaceId');
    return queryAdapter.query(
      `UPDATE sync_jobs
          SET cancel_requested_at = COALESCE(cancel_requested_at, CURRENT_TIMESTAMP),
              status = CASE WHEN status IN ('queued', 'retry_wait') THEN 'cancelled' ELSE status END,
              cancelled_at = CASE WHEN status IN ('queued', 'retry_wait') THEN CURRENT_TIMESTAMP ELSE cancelled_at END,
              finished_at = CASE WHEN status IN ('queued', 'retry_wait') THEN CURRENT_TIMESTAMP ELSE finished_at END
        WHERE public_id = $1
          AND space_id = $2
          AND status NOT IN ('succeeded', 'failed', 'cancelled')
       RETURNING ${RETURNING_COLUMNS}`,
      [id, workspace]
    );
  }

  async function requestCancellation(options = {}) {
    const result = await requestCancellationRow(options);
    return shapeJob(result.rows[0]);
  }

  async function requestOperatorCancellation(options = {}) {
    const result = await requestCancellationRow(options);
    return shapeOperatorJob(result.rows[0]);
  }

  async function recoverExpiredLeases({ limit = 100 } = {}) {
    const rowLimit = Math.min(requirePositiveInteger(limit, 'limit'), 1000);
    const result = await queryAdapter.query(
      `WITH expired AS (
         SELECT id
           FROM sync_jobs
          WHERE status = 'running'
            AND lease_expires_at <= CURRENT_TIMESTAMP
          ORDER BY lease_expires_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE sync_jobs j
          SET status = CASE
                WHEN cancel_requested_at IS NOT NULL THEN 'cancelled'
                WHEN attempt_count < max_attempts THEN 'retry_wait'
                ELSE 'failed'
              END,
              available_at = CASE
                WHEN cancel_requested_at IS NULL AND attempt_count < max_attempts THEN CURRENT_TIMESTAMP
                ELSE available_at
              END,
              error = CASE
                WHEN cancel_requested_at IS NOT NULL THEN NULL
                ELSE 'Worker lease expired before completion'
              END,
              cancelled_at = CASE
                WHEN cancel_requested_at IS NOT NULL THEN CURRENT_TIMESTAMP
                ELSE cancelled_at
              END,
              finished_at = CASE
                WHEN cancel_requested_at IS NULL AND attempt_count < max_attempts THEN NULL
                ELSE CURRENT_TIMESTAMP
              END,
              lease_owner = NULL,
              lease_expires_at = NULL,
              heartbeat_at = NULL
         FROM expired
        WHERE j.id = expired.id
       RETURNING ${QUALIFIED_RETURNING_COLUMNS}`,
      [rowLimit]
    );
    return result.rows.map((row) => shapeJob(row));
  }

  async function getByPublicId({ publicId, spaceId } = {}) {
    const id = requireUuid(publicId, 'publicId');
    const workspace = requirePositiveInteger(spaceId, 'spaceId');
    const result = await queryAdapter.query(
      `SELECT ${RETURNING_COLUMNS}
         FROM sync_jobs
        WHERE public_id = $1
          AND space_id = $2
        LIMIT 1`,
      [id, workspace]
    );
    return shapeJob(result.rows[0]);
  }

  async function listOperatorJobs({
    spaceId,
    jobType = null,
    provider = null,
    providerConnectionId = null,
    limit = 20
  } = {}) {
    const workspace = requirePositiveInteger(spaceId, 'spaceId');
    const normalizedJobType = jobType ? requireSafeName(jobType, 'jobType') : null;
    const normalizedProvider = provider ? requireSafeName(provider, 'provider') : null;
    const normalizedConnectionId = providerConnectionId
      ? requireUuid(providerConnectionId, 'providerConnectionId')
      : null;
    const rowLimit = Math.min(requirePositiveInteger(limit, 'limit'), 100);
    const result = await queryAdapter.query(
      `SELECT ${RETURNING_COLUMNS}
         FROM sync_jobs
        WHERE space_id = $1
          AND ($2::text IS NULL OR job_type = $2)
          AND ($3::text IS NULL OR provider = $3)
          AND ($4::uuid IS NULL OR provider_connection_id = $4)
        ORDER BY created_at DESC, id DESC
        LIMIT $5`,
      [workspace, normalizedJobType, normalizedProvider, normalizedConnectionId, rowLimit]
    );
    return result.rows.map(shapeOperatorJob);
  }

  async function getOperatorJob({ publicId, spaceId } = {}) {
    const id = requireUuid(publicId, 'publicId');
    const workspace = requirePositiveInteger(spaceId, 'spaceId');
    const result = await queryAdapter.query(
      `SELECT ${RETURNING_COLUMNS}
         FROM sync_jobs
        WHERE public_id = $1
          AND space_id = $2
        LIMIT 1`,
      [id, workspace]
    );
    return shapeOperatorJob(result.rows[0]);
  }

  return Object.freeze({
    enqueue,
    claimNext,
    renewLease,
    reportProgress,
    settle,
    requestCancellation,
    requestOperatorCancellation,
    recoverExpiredLeases,
    getByPublicId,
    listOperatorJobs,
    getOperatorJob
  });
}

module.exports = {
  FINAL_STATUSES,
  assertSecretFree,
  createDurableJobStore,
  shapeJob,
  shapeOperatorJob
};
