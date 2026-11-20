# Durable Workspace Job Contract

## Purpose

CollectZ uses PostgreSQL-backed durable jobs for provider work that must survive request completion and process restart. The job lifecycle owns execution mechanics; provider adapters continue to own transport, identity, matching, field precedence, and provider-specific outcomes.

The lifecycle seam is `backend/services/durableJobs.js`. Its interface is deliberately small: enqueue work, claim the next eligible job, renew its lease, report progress, settle it, request cancellation, recover expired leases, and read it back by workspace-scoped public id. `backend/services/durableJobWorker.js` composes that interface into a leased execution loop; it does not own provider transport or matching policy.

Legacy inline imports share the ownership seam without pretending to be restart-capable durable work. `createAuthorizedInlineImportJobStore` binds one authenticated actor, active workspace/library pair, allowlisted provider, and its fixed legacy job type. Its enqueue, start, progress, success, and failure transitions each run in a short actor-authorized transaction and repeat the exact relational and compatibility-scope predicates. CSV, Calibre, Delicious, CWA, Kavita, Plex import, and Metron keep their existing in-process provider execution and startup stale-job handling; only their `sync_jobs` mutation authority moved behind the module.

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
- Plex webhook ingestion is a stricter legacy adopter: it requires both an active workspace and active same-workspace library, uses a dedicated ingest grant, and fails closed rather than creating an installation-scoped job.
- Plex webhook processing uses the same claim/lease/progress/settlement interface through an adapter that admits only `plex`, the two webhook job types, and jobs whose active relational workspace/library exactly match their compatibility projection. Expired webhook leases recover through that adapter rather than startup's legacy direct-maintenance path.
- Valuation refresh requests require an authenticated actor and relational workspace ownership. Manual single-item and post-import batches persist only media ids, execution mode, and import source in the secret-free target, then a dedicated allowlisted worker claims that exact job, resolves current workspace valuation configuration at execution time, checkpoints progress, and can resume after process restart.
- Legacy inline imports require an authenticated actor plus an active exact workspace/library pair. The allowlist fixes each provider to either `media_import` or the historical Metron `import` type, structured state remains secret-filtered, and lifecycle updates reject a different actor, owner pair, type, provider, terminal state, or durable-lifecycle row. These jobs remain explicitly non-leased and non-restartable.
- Jobs store Provider Connection ids, never provider usernames, passwords, tokens, encrypted credential payloads, authorization headers, or raw provider responses.
- Structured targets, progress, and summaries reject secret-bearing keys and pass through the audit redaction policy before persistence.
- Provider credentials are resolved at execution time by the owning adapter after workspace and connection lifecycle checks.
- Migration `144` activates command-separated actor and worker RLS after request, worker, service, certification, migration, fresh-init, and retained-history paths adopt the bounded transaction contracts. Relational ownership remains necessary but is not the only authorization check.

## Provider adapters

The first two adapters are intentionally different:

- Plex reconciliation is the first adopted automatic full-library workflow. Manual and scheduled requests enqueue secret-free targets, scheduled cadence buckets provide duplicate suppression, and the worker resolves current workspace credentials only when it holds the lease.
- Plex reconciliation preview uses a separate read-only job type and dedicated request/worker allowlists. Its target persists section ids and an optional limit, the worker resolves current workspace Plex credentials after claim, and the summary explicitly records that Plex writeback and collectZ import mutation remained disabled.
- BookOrbit is a multi-instance OPDS workflow and proves scheduled enqueue, connection-scoped credentials, bounded remote traversal, stable external identity, and repeat-sync idempotency.

The BookOrbit adopter must also retain OPDS series names and indexes for comics, prove movement between book and comic classifications without duplicate canonical rows, and keep series index distinct from an absent issue number. Rich native multi-series, story-arc, credit, volume, and issue enrichment is the follow-on `3.28.1` model rather than an unstructured addition to the durable job envelope.

The lifecycle does not interpret Plex sections, BookOrbit Atom ids, CSV rows, metadata precedence, conflicts, covers, links, or import summaries. Those remain inside their provider adapters.

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

The older numeric-id `/api/media/sync-jobs` list, detail, and result endpoints use a separate authenticated read module over the same ownership model. Every lookup is bound to the selected workspace and a fixed production job-type allowlist. Normal users are additionally restricted to jobs they initiated; admins may list or inspect any allowlisted job in that selected workspace and may optionally filter the list by initiator. Terminal history keeps relational workspace ownership when deletion nulls the actor or library foreign key, so an admin can still inspect a same-workspace tombstone without broadening access to another workspace. Route code does not query the table directly.

## Deferred work

- transactional outbox use where enqueue must commit atomically with another domain mutation;
- restart-capable durable-worker adoption for legacy CWA, Kavita, Metron, CSV, and Plex import execution where payload durability can be designed without persisting uploads or credentials;
- append-only external source observations;
- broader work/edition/owned-copy modeling;
- multi-process worker deployment and transactional outbox adoption where enqueue must share another domain commit.
