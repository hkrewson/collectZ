# Staged Row-Level Security

## Active milestone

`3.26.0 — Transaction-Local Workspace Scope and Saved-View RLS Pilot` is in progress. No production RLS policy is enabled by the initial transaction helper. Application version remains `3.25.4` until the milestone reaches version closeout.

## Transaction contract

`backend/db/scopedTransaction.js` exposes `withScopedTransaction(pool, scope, work)`.

- Supply a positive PostgreSQL integer `spaceId` and optional positive integer `libraryId` from an already authorized server-side request or job context. Missing workspace scope fails before acquiring a connection.
- All database work inside the callback must use its supplied client. Calling the global pool would escape the transaction. Do not issue transaction-control SQL, nest transactions, return before asynchronous database work completes, or perform external provider calls inside the callback.
- The helper owns BEGIN/COMMIT/ROLLBACK, binds both settings with parameterized transaction-local `set_config`, and explicitly clears optional library context. Work failures trigger rollback; failed rollback discards the connection.
- No request middleware, worker, or maintenance command adopts this helper implicitly. Each pilot execution path must be inventoried and bound explicitly before RLS activation.

## Pilot candidate and security boundary

The candidate is `saved_library_views`, classified in `backend/config/workspace-ownership-contract.json`. Its maintained CRUD paths are in `backend/routes/libraries.js`. It has owner, workspace, and optional library identifiers; existing rows permit null workspace identifiers, which require explicit inventory and a compatibility/backfill decision before activation.

PostgreSQL custom settings are mutable by the shared runtime role. A policy that trusts only `current_setting('collectz.space_id')` cannot prove authorized workspace selection against arbitrary SQL. Do not advertise or enable such a policy as raw-SQL workspace isolation. The next implementation must select and test a scope-validation mechanism that cannot be forged by that role, including its key/credential provisioning and restore contract. Existing application membership, permission, owner, and library predicates remain required.

Before activation, certify SELECT/INSERT/UPDATE/DELETE, ownership mutation, null/invalid scope, sibling workspace/library, spoofed scope, pooled reuse, concurrent requests, and all maintained execution paths. Use both USING and WITH CHECK. Keep authorization/bootstrap tables outside this pilot. Confirm schema-owner/runtime privilege separation and migration/init parity, then certify upgrade and restore before expanding to another family.

## Verification

- `node --test backend/scripts/scoped-transaction-tests.js`: rejects invalid scope before connection acquisition; verifies local binding, same-client execution, return value, optional-library clearing, rollback for callback/settings/commit failure, and connection disposal when rollback fails.
- `node backend/scripts/scoped-transaction-smoke.js` inside the existing backend container: uses its configured runtime credential and a one-connection pool, checks no superuser/BYPASSRLS, checks settings inside a transaction, and confirms the same PostgreSQL session has empty settings after commit and rollback. It modifies no application rows and creates no containers, databases, or volumes. A failure prints a sanitized gate label; inspect connection readiness or reproduce the failing assertion without writing credentials into evidence.
- These checks prove transaction plumbing only. They do not certify RLS, membership, table ownership, or production route adoption. Production activation and release readiness remain pending under `docs/wiki/17-Release-Go-No-Go-Checklist.md` and `docs/wiki/10-CI-CD-and-Registry-Deploy.md`.
