# Durable Workspace Job Contract

## Purpose

CollectZ uses PostgreSQL-backed durable jobs for provider work that must survive request completion and process restart. The job lifecycle owns execution mechanics; provider adapters continue to own transport, identity, matching, field precedence, and provider-specific outcomes.

The lifecycle seam is `backend/services/durableJobs.js`. Its interface is deliberately small: enqueue work, claim the next eligible job, renew its lease, report progress, settle it, request cancellation, recover expired leases, and read it back by workspace-scoped public id. `backend/services/durableJobWorker.js` composes that interface into a leased execution loop; it does not own provider transport or matching policy.

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

- Plex reconciliation is the first adopted automatic full-library workflow. Manual and scheduled requests enqueue secret-free targets, scheduled cadence buckets provide duplicate suppression, and the worker resolves current workspace credentials only when it holds the lease.
- BookOrbit is a multi-instance OPDS workflow and proves scheduled enqueue, connection-scoped credentials, bounded remote traversal, stable external identity, and repeat-sync idempotency.

The BookOrbit adopter must also retain OPDS series names and indexes for comics, prove movement between book and comic classifications without duplicate canonical rows, and keep series index distinct from an absent issue number. Rich native multi-series, story-arc, credit, volume, and issue enrichment is the follow-on `3.28.1` model rather than an unstructured addition to the durable job envelope.

The lifecycle does not interpret Plex sections, BookOrbit Atom ids, metadata precedence, conflicts, covers, links, or import summaries. Those remain inside their provider adapters.

## Persisted provider cadence

`provider_sync_targets` stores the automatic BookOrbit connection/library pairing separately from both the Provider Connection and the durable job history. Each target has one generated UUID, explicit workspace, relational Provider Connection and library ownership, enabled state, bounded interval, and last-enqueue time. Composite foreign keys prevent either referenced object from crossing the target workspace, and scoped transactions protect reads and writes.

The scheduler scans due targets on a five-minute process-local sweep. Its cadence-bucket idempotency key makes concurrent application instances converge on one durable job; the database job lifecycle, rather than the timer, is the reliability boundary. Disabling a target stops future enqueue without deleting its job history or Provider Connection. The scheduler never changes BookOrbit data.

The certified BookOrbit result contract records bounded counts and audit rows, including series coverage, while keeping credentials and raw feeds out of targets, progress, summaries, logs, and readback. OPDS series order remains `series_index`; an absent provider issue number remains absent.

## Operator readback and cancellation

Workspace integration managers use one provider-neutral surface for recent durable work:

- `GET /api/spaces/{spaceId}/integrations/jobs` lists workspace-owned jobs and may filter by job type, provider, or Provider Connection.
- `GET /api/spaces/{spaceId}/integrations/jobs/{publicId}` reads one job only when its public UUID belongs to that workspace.
- `POST /api/spaces/{spaceId}/integrations/jobs/{publicId}/cancel` requests cancellation through the same lifecycle interface and requires the normal session and CSRF protections for a workspace mutation.

The operator projection includes only public identity, declared job/provider contract, optional library and Provider Connection references, status, bounded progress/summary, sanitized failure reason, attempt limits, next eligibility, lifecycle timestamps, and whether cancellation remains available. It deliberately omits the numeric database id, workspace implementation id, initiating-user id, correlation/idempotency values, target reference, lease owner, lease expiry, and heartbeat. Structured progress and summaries are re-sanitized on read so older or manually repaired rows cannot bypass the current redaction policy.

Queued and retry-wait jobs cancel immediately. Running jobs record a request and remain running until their adapter reaches a safe checkpoint; the UI therefore says cancellation was requested rather than claiming the process was interrupted. Terminal jobs return a conflict and are never rewritten. Every lookup and mutation includes the explicit workspace predicate, so knowing another workspace's public job UUID does not grant read or cancellation access.

The shared integration panel refreshes recent jobs, shows safe attempt/failure/summary facts, and uses a two-step cancellation confirmation. BookOrbit displays persisted target cadence, last enqueue, and computed next eligibility for the selected Provider Connection. Plex reconciliation presents the equivalent cadence projection from its existing scheduler state. Cadence is operational readback only; the durable job table remains the execution-history authority.

## Deferred work

- transactional outbox use where enqueue must commit atomically with another domain mutation;
- Plex webhook-hint and watched/rating refresh adoption;
- CWA, Kavita, Metron, scanner, OCR, valuation, notification, and price-watch adoption;
- append-only external source observations;
- broader work/edition/owned-copy modeling;
- `sync_jobs` RLS activation and multi-process worker deployment.
