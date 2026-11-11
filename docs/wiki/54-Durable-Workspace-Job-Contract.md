# Durable Workspace Job Contract

## Purpose

CollectZ uses PostgreSQL-backed durable jobs for provider work that must survive request completion and process restart. The job lifecycle owns execution mechanics; provider adapters continue to own transport, identity, matching, field precedence, and provider-specific outcomes.

The lifecycle seam is `backend/services/durableJobs.js`. Its interface is deliberately small: enqueue work, claim the next eligible job, renew its lease, report progress, settle it, request cancellation, recover expired leases, and read it back by workspace-scoped public id.

## Durable envelope

New durable jobs persist:

- immutable public UUID plus the existing numeric internal id;
- stable job type and contract version;
- relational workspace ownership, optional library ownership, and optional Provider Connection ownership;
- initiating user when one exists, correlation UUID, optional idempotency key, and a secret-free target reference;
- status, attempt count/limit, next eligible time, lease owner/expiry, heartbeat, cancellation, and completion timestamps;
- compatibility scope, progress, sanitized summary, and safe error text.

The database enforces that an attached library or Provider Connection belongs to the job workspace. Historical jobs whose deleted library can no longer be resolved retain their compatibility scope and leave the relational library field null rather than inventing ownership.

## Lifecycle rules

1. `enqueue` creates `queued` work or returns the existing job for the same workspace, job type, provider, and idempotency key.
2. `claimNext` uses `FOR UPDATE SKIP LOCKED`, increments the attempt count, records one worker lease, and transitions the job to `running`.
3. Only the lease owner may renew the lease, report progress, or settle the running job.
4. Retry settlement moves eligible work to `retry_wait` with an explicit next-attempt time. Reaching the attempt limit converts the result to terminal `failed`.
5. Cancellation is immediate for queued/retry-wait work. Running work records a cancellation request; the adapter must observe it at a safe checkpoint, and settlement becomes `cancelled`.
6. Expired running leases return to `retry_wait` when attempts remain and otherwise become `failed`.
7. `succeeded`, `failed`, and `cancelled` are terminal. Operator retry creates a new documented idempotency identity rather than rewriting terminal history.

## Security and ownership

- New durable callers must provide an explicit workspace. Library and Provider Connection identifiers are optional, but database foreign keys enforce same-workspace ownership when present.
- Jobs store Provider Connection ids, never provider usernames, passwords, tokens, encrypted credential payloads, authorization headers, or raw provider responses.
- Structured targets, progress, and summaries reject secret-bearing keys and pass through the audit redaction policy before persistence.
- Provider credentials are resolved at execution time by the owning adapter after workspace and connection lifecycle checks.
- Relational ownership does not itself activate RLS for `sync_jobs`; that remains a separate staged table-family decision requiring request, worker, raw-SQL, migration, and restore certification.

## Provider adapters

The first two adapters are intentionally different:

- Plex reconciliation is an existing automatic full-library workflow and proves migration from process-local scheduling plus recovery of long-running work.
- BookOrbit is a multi-instance OPDS workflow and proves scheduled enqueue, connection-scoped credentials, bounded remote traversal, stable external identity, and repeat-sync idempotency.

The lifecycle does not interpret Plex sections, BookOrbit Atom ids, metadata precedence, conflicts, covers, links, or import summaries. Those remain inside their provider adapters.

## Deferred work

- transactional outbox use where enqueue must commit atomically with another domain mutation;
- Plex webhook-hint and watched/rating refresh adoption;
- CWA, Kavita, Metron, scanner, OCR, valuation, notification, and price-watch adoption;
- append-only external source observations;
- broader work/edition/owned-copy modeling;
- `sync_jobs` RLS activation and multi-process worker deployment.
