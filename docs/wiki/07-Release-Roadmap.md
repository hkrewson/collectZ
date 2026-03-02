# Release Roadmap (1.6.3 → 2.0.0)

This roadmap converts product direction into implementation milestones with acceptance criteria and DB/API checklists. It incorporates findings from two independent architecture reviews conducted after the 1.6.3 baseline, and reflects the project's core priorities: security, data integrity, simple end-user deployment, CI/CD robustness, and a clear path to multi-space support.

---

## Guiding Principles

- Keep 1.x backward compatible with existing deployments.
- Use 2.0.0 for the multi-space data model change.
- Ship integrations incrementally, but design 1.x work to be reusable in 2.0.
- Security fixes and access control gaps take priority over new features.
- Every milestone should leave the deployment story simpler, not more complex.
- The CI/CD pipeline is a first-class concern — changes must be deployable via `docker compose pull && up -d` for homelab users.
- Delivery and modularity controls in `14-Engineering-Delivery-Policy.md` are mandatory for pre-2.0 releases.

---

## 1.6.5-r1 — Auditability and Auth Operations

**Goal:** Improve troubleshooting during development/testing by expanding activity logging coverage and making audit verbosity configurable.

### Scope

- Add request-outcome activity logging with environment toggle:
  - `AUDIT_LOG_MODE=off`
  - `AUDIT_LOG_MODE=failures` (default)
  - `AUDIT_LOG_MODE=mutations`
  - `AUDIT_LOG_MODE=all`
- Ensure profile and user lifecycle changes emit explicit activity events:
  - register
  - login
  - logout
  - profile updates (including password-change flag)
  - admin user role updates/deletes
- Keep explicit admin/domain events while adding generic request-failure visibility.

### Acceptance Criteria

- Failed API actions appear in Activity log with method, path, status, and error summary.
- Profile and user updates are visible in Activity log with sufficient context to troubleshoot.
- Audit verbosity can be changed by setting `AUDIT_LOG_MODE` in `.env` / compose runtime.

### API/Ops Checklist

- Document `AUDIT_LOG_MODE` in env/deploy docs.
- Keep default mode `failures` for production-like noise levels.
- Use `mutations` or `all` during active development when deeper traceability is needed.

---

## 1.6.6 — Members and Invitations UX

**Goal:** Improve admin usability and lifecycle management for users/invites without introducing major schema risk.

### Scope

- Rename admin nav label from `Users` to `Members`.
- Split current mixed admin view into two tabs:
  - `Members`
  - `Invitations`
- Invitation lifecycle controls:
  - add explicit invalidate/revoke for unused invites
  - hide used invites from default view (with optional filter to show historical)
- Invitation history visibility:
  - include claim event in activity log (`invite.claimed`) with invite id, claimed-by user, email, timestamp
  - include creator identity where available
- Add member detail drawer (slide-over) with:
  - profile basics
  - role editing
  - last login
  - contribution counters (media additions, last edit timestamp)
  - a simple contribution score metric

### Acceptance Criteria

- Admin can switch clearly between Members and Invitations without mixed content.
- Admin can revoke an active invite; revoked invite cannot be used.
- Used invites no longer clutter default invitation list.
- Activity log includes invite claim/revoke lifecycle events.
- Member drawer opens from list row and supports at least role updates + read-only activity metrics.

### API/DB Checklist

- Add invite revoke endpoint (admin-only).
- Add `invite.claimed` and `invite.revoked` activity event coverage.
- If needed, add non-breaking user activity summary endpoint for drawer stats.

---

## 1.6.4 — Security Hardening & Code Health (Next Release)

**Goal:** Close confirmed security gaps, fix silent bugs, and establish code structure that supports safe iteration through 1.7 and beyond. This is a required stepping stone — no new features ship before these are resolved.

### Scope

**Security (ship before anything else):**

- Fix the access control gap on `PATCH /api/media/:id` and `DELETE /api/media/:id`. Any authenticated user can currently modify or delete any media item added by any other user. Add ownership enforcement: `WHERE id = $1 AND (added_by = $2 OR $3 = 'admin')`, where the third parameter is the requesting user's role. Admins retain unrestricted access.
- Fix the broken seed user in `init.sql`. The bcrypt hash for `admin@example.com` is truncated (24 chars, not the required 60), meaning the documented password `admin123` does not work. The net effect is that fresh deployments immediately require an invite token because a user row exists but the bootstrap path is broken. **Remove the seed block entirely from `init.sql`** and update the first-run documentation to describe the uninvited first-admin registration path clearly.
- Move request logger middleware to the top of the middleware stack, before route registration. It currently fires after `app.listen()` and logs nothing.
- Completed: auth state now uses `httpOnly` cookie sessions and frontend no longer relies on `localStorage` tokens.

**Code structure (required before 1.7):**

- Split `server.js` (currently ~1,500 lines) into a proper module structure:
  - `backend/routes/` — `auth.js`, `media.js`, `admin.js`, `integrations.js`
  - `backend/middleware/` — `authenticate.js`, `requireRole.js`, `asyncHandler.js`
  - `backend/services/` — `tmdb.js`, `barcode.js`, `vision.js`
  - `backend/db/` — `pool.js`, `migrations.js`
- Add a centralized async error handler. All route handlers must be wrapped with an `asyncHandler` utility that catches unhandled promise rejections and passes them to Express's error middleware, preventing silent 500s:
  ```js
  const asyncHandler = fn => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
  ```
- Completed: consolidated on opaque `httpOnly` cookie sessions with server-side session validation.

**Input validation:**

- Add `zod` for request body validation on all write endpoints. Start with `POST /api/media`, `PATCH /api/media/:id`, `POST /api/auth/register`, and `POST /api/auth/login`. Parameterized queries already prevent SQL injection, but unvalidated inputs allow garbage data into the database and make debugging upstream errors harder.

**Minor bugs and polish:**

- Expose the Admin Activity Log in the UI. The `activity_log` table is already being written to and the `GET /api/admin/activity` endpoint exists — the frontend admin panel just doesn't have a dedicated view yet. This is a 1.6.3 feature that wasn't surfaced. *(Note: if already present in current UI, verify and close this item.)*
- Add activity log filtering to `GET /api/admin/activity` via optional query params: `action`, `userId`, `from`, `to`, `q`, `limit`. Preserve the current response shape when no filters are sent.
- Change user role management UX from immediate auto-save on select change to an explicit Save button per row.

### Acceptance Criteria

- A non-admin user cannot edit or delete media added by another user via the API.
- Fresh deployment with an empty DB allows first user registration without an invite token, and that user receives admin role.
- Request logs appear in `docker compose logs backend` for every API request.
- Tokens are issued as `httpOnly` cookies; `localStorage` is no longer used for auth state.
- All write endpoint bodies are validated via zod; malformed requests return structured 400 errors.
- `server.js` is replaced by a module tree; the single file no longer exists.

### DB Checklist

- No schema changes in this milestone.
- Remove seed user from `init.sql`.

### API Checklist

- `PATCH /api/media/:id` and `DELETE /api/media/:id` enforce ownership.
- `GET /api/admin/activity` accepts optional filter query params.
- Login/register return `Set-Cookie` with `httpOnly`, `SameSite=Strict`, `Secure` (in production).
- No breaking changes to response shapes.

---

## 1.7.0 — Migration Infrastructure + Plex Integration Foundation

**Goal:** Replace the fragile `ensureSchema()` startup migration with a proper versioned migration system, then build the first usable Plex import flow on top of that solid foundation.

### Scope

**Migration infrastructure (prerequisite for all future schema work):**

- Adopt `node-pg-migrate` for versioned, transactional schema migrations.
- Convert all existing `ensureSchema()` `ALTER TABLE` and `CREATE TABLE` calls into numbered migration files under `backend/migrations/`.
- Migrations run once at startup via the migration runner; the `ensureSchema()` function is removed.
- Each migration is transactional: if a statement fails, the migration rolls back cleanly and the server refuses to start, rather than leaving the schema partially applied.
- Document the migration workflow in the wiki: how to write a new migration, how to roll back, how to verify migration state against the DB.

**Plex integration:**

- Add Plex integration settings to Admin Integrations UI (alongside Barcode, Vision, TMDB).
- Add Plex config fields to `app_integrations` table (see DB checklist).
- Add key validation test endpoint: `POST /api/admin/settings/integrations/test-plex`.
- Add manual "Import from Plex" endpoint: `POST /api/media/import-plex`.
- Import maps Plex library items to media records: title, year, runtime, poster, TMDB ID (if available from Plex metadata).
- Plex library sections are stored as a selectable list, not a single string field — a single Plex server can have multiple sections with different media types. The config stores `plex_library_sections` as a JSONB array.
- Apply the same normalize-response pattern used for barcode/vision: a `normalizePlexItem()` function in `services/plex.js` maps Plex metadata to the internal media shape.
- Add deduplication policy: match on TMDB ID first, fall back to title + year. Import summary reports `created`, `updated`, `skipped` counts.
- Errors are surfaced per-item in the import summary, not as a global failure.

**Pagination (required before collection sizes become a problem):**

- Add cursor-based or offset pagination to `GET /api/media`. Default page size: 50. Add `page`, `limit`, and `cursor` query params. Update the frontend library view to support paginated loading.
- This is grouped here because it becomes critical once Plex imports populate large libraries.

### Acceptance Criteria

- Schema migrations run transactionally on startup; a failed migration halts the server with a clear error.
- Rolling back a migration restores the previous schema state cleanly.
- Admin can save, test, and use Plex config.
- Manual Plex import completes without duplicate explosion.
- Import summary shows created/updated/skipped with per-item error details.
- `GET /api/media` returns paginated results; frontend handles pages correctly.

### DB Checklist

- New migration files replace `ensureSchema()`.
- Add to `app_integrations`:
  - `plex_base_url TEXT`
  - `plex_api_token_encrypted TEXT`
  - `plex_library_sections JSONB` (array of `{ key, title, type }`)
- Optional media provenance fields on `media`:
  - `source_provider VARCHAR(50)` — `'plex'`, `'manual'`, `'csv'`, etc.
  - `source_external_id VARCHAR(255)`

### API Checklist

- `POST /api/admin/settings/integrations/test-plex`
- `POST /api/media/import-plex`
- `GET /api/media` accepts `page`, `limit`, `cursor` params; response includes pagination metadata.
- Integration settings payload/response extended for Plex.
- All existing integration endpoints remain backward compatible.

---

## 1.8.0 — Object Storage + Sync Reliability + CSV Import

**Goal:** Fix the file upload persistence problem, make imports robust and asynchronous, and add CSV import as a first-class path for users migrating from other tools.

### Scope

**Object storage for uploads (correctness fix, should have been earlier):**

- Replace local `uploads/` directory with an S3-compatible object store. Support AWS S3, MinIO, and Backblaze B2 via a single `S3_*` env config block (already stubbed in `env.example`).
- Add a `storage` service abstraction in `backend/services/storage.js` that provides `upload(buffer, filename)` and `getUrl(filename)` — swappable between local disk (for dev) and S3 (for production) via `STORAGE_PROVIDER` env var.
- Local disk remains the default for zero-config dev deployments. Production deployments are encouraged to use object storage.
- Existing uploads from the local volume are not auto-migrated; document the manual migration path.

**Background job queue:**

- Add a lightweight job queue using `pg-boss` (Postgres-backed, no new infrastructure required) for long-running operations like Plex sync and CSV import.
- Add `sync_jobs` table tracking provider, scope, status (`idle`, `running`, `failed`, `succeeded`), `started_at`, `finished_at`, error details, and a result summary.
- `POST /api/media/import-plex` can now enqueue an async job instead of blocking the HTTP request.
- Add `GET /api/sync-jobs` and `GET /api/sync-jobs/:id` endpoints.
- Frontend shows job status and final result for active/recent jobs.

**CSV import:**

- Two modes: generic CSV and Delicious Library export.
- Generic CSV: `GET /api/media/import/template-csv` returns a downloadable template with required/optional column headers and one example row. `POST /api/media/import-csv` accepts a CSV file, validates each row via zod, imports valid rows, and returns a per-row result summary.
- Delicious Library: exports are XML, not CSV — the parser must handle the actual Delicious Library XML export format. `POST /api/media/import-csv/delicious` accepts the XML file, maps fields to the internal media shape, and deduplicates against existing records.
- Validation reports row-level errors without failing the entire batch. A batch with 80% valid rows imports the valid rows and reports the failures.

**Richer library UX:**

- Add merge/resolve UI for near-duplicate titles (same title, different years or formats).
- Add sort controls to the library view: by title, year, format, date added, user rating.
  - Title sort must ignore leading articles (`A`, `An`, `The`) for ordering while still displaying full titles.
- Add additional filter dimensions: director, actor/cast, year, resolution, genre, rating range, user rating range.
  - Resolution filter values should support at least: `SD`, `720p`, `1080p`, `4K`.
  - Actor filtering requires actor metadata ingestion from TMDB/Plex import paths (or manual metadata extension) before UI filter is enabled.

### Acceptance Criteria

- Cover images survive backend container restarts when object storage is configured.
- Plex import can run asynchronously; UI shows progress and final result.
- Generic CSV import validates row-by-row and reports failures without aborting valid rows.
- Delicious Library XML import correctly maps known fields to media records.
- Library view supports sorting and extended filtering.
- Users can resolve near-duplicates from the UI.

### DB Checklist

- Add `sync_jobs` table: `id`, `provider`, `scope`, `status`, `started_at`, `finished_at`, `error`, `summary JSONB`, `created_at`.
- Add indexes on `sync_jobs(status, created_at)`.
- Add `import_source VARCHAR(50)` to `media` for traceability (`csv_generic`, `csv_delicious`, `plex`, `manual`).
- Add composite indexes on `media(format, year)` and `media(genre, year)` to support filter queries.

### API Checklist

- `POST /api/media/import-plex` supports both sync (small libraries) and async (large libraries) via `?async=true`.
- `GET /api/sync-jobs`, `GET /api/sync-jobs/:id`.
- `GET /api/media/import/template-csv`.
- `POST /api/media/import-csv` (generic).
- `POST /api/media/import-csv/delicious` (XML format).
- `GET /api/media` extended sort/filter params.

---

## 1.9.0 — TV Series Support + 2.0 Migration Prep

**Goal:** Add TV show support (the data model is currently movie-only) and introduce the internal scaffolding that reduces risk for the 2.0 spaces + multi-library migration.

### Scope

**TV series support:**

- Add `media_type` discriminator to `media` table: `'movie'`, `'tv_series'`, `'tv_episode'`, `'other'`.
- For TV series, add series-level fields: `series_id` (self-referential FK for episodes), `season_number`, `episode_number`, `episode_title`, `network`.
- Extend TMDB integration to use the TV search and details endpoints (`/3/search/tv`, `/3/tv/{id}`) in addition to the existing movie endpoints. Add `tmdb_media_type` to distinguish which TMDB endpoint produced the record.
- Frontend add/edit forms adapt based on selected media type.
- Library navigation exposes media type as a Library submenu (`Movies`, `TV`, `Other`) instead of a top-level filter control.
- TV workflow defaults to series-level tracking; season ownership is currently represented in variants (`Season N`) as an interim implementation, with a planned move to a dedicated `media_seasons` model.
- Library view supports filtering by `media_type`.

**2.0 migration prep:**

- Introduce `scopeContext` — a helper that all media/invite/user queries route through. Initially returns a no-op context (single-library mode), but is the injection point for space filtering in 2.0.
- Extend `scopeContext` to carry both `space_id` and `library_id` (library remains optional in 1.9 behavior).
- Refactor database queries in `db/` to accept a `scopeContext` parameter. No behavior change — this is scaffolding.
- Add non-breaking preparatory columns: `space_id INTEGER` (nullable, no FK yet) to `media`, `invites`, and the relevant integration settings.
- Add non-breaking preparatory library model:
  - `libraries` table (nullable links, no hard constraints yet for backwards compatibility).
  - `library_id INTEGER` (nullable, no FK yet) on `media`.
  - `library_id` included in internal scope resolution, defaulting to null/no-op in single-library mode.
- Write and test the migration rehearsal: apply the 2.0 schema to a copy of a production DB snapshot, verify data integrity, document rollback procedure.
- Add feature flags infrastructure (a simple `feature_flags` table or env-var-based config) for staged rollout of 2.0 behaviors.

### Acceptance Criteria

- TV series and episodes can be added, edited, and filtered in the library.
- TMDB lookup works for both movies and TV shows.
- All media/invite queries route through `scopeContext` (`space_id` + optional `library_id`) with no behavior regression.
- 2.0 migration rehearsal is documented and repeatable against a real DB snapshot.
- `space_id` column exists on affected tables with no constraints (nullable, no FK).
- `libraries` table and nullable `media.library_id` exist with no behavior change in 1.9.

### DB Checklist

- Add `media_type VARCHAR(20) DEFAULT 'movie'` to `media`.
- Add `season_number INTEGER`, `episode_number INTEGER`, `episode_title VARCHAR(500)`, `network VARCHAR(255)`, `series_id INTEGER REFERENCES media(id)` to `media` (all nullable).
- Add `tmdb_media_type VARCHAR(20)` to `media`.
- Add `space_id INTEGER` (nullable) to `media`, `invites`.
- Add `library_id INTEGER` (nullable) to `media`.
- Add `libraries` table with nullable pre-2.0 fields:
  - `id SERIAL PRIMARY KEY`
  - `space_id INTEGER` (nullable pre-2.0)
  - `name VARCHAR(255) NOT NULL`
  - `description TEXT`
  - `created_by INTEGER REFERENCES users(id) ON DELETE SET NULL`
  - `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
  - `updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
  - `archived_at TIMESTAMP`
- Add `feature_flags` table: `key VARCHAR(100) PRIMARY KEY`, `enabled BOOLEAN DEFAULT false`, `description TEXT`.

### API Checklist

- `POST /api/media/search-tmdb` accepts `media_type` param (`movie` or `tv`).
- `GET /api/media/tmdb/:id/details` handles both movie and TV detail endpoints.
- `GET /api/media` supports `media_type` filter.
- No public API changes from `scopeContext`/`library_id` scaffolding introduction (internal only).

---

## 1.9.2 → 1.9.9 — Assessment Remediation Track (Pre-2.0 Hardening)

This track converts the 1.9.1 external assessment findings into executable milestones. Goal: enter 2.0 with lower security risk, better migration confidence, and predictable import behavior at scale.

### Concern/Recommendation Register

- Enforce independent encryption secret for integrations; do not fall back to session or dev default in production.
- Log integration key decryption failures (no silent empty-string behavior).
- Move long-running Plex import out of blocking request path (async jobs / queue).
- Expose enrichment failures in per-row audit output (no silent swallow).
- Add DB-level uniqueness for metadata keys per media item (`media_metadata(media_id, key)`).
- Replace custom CSV parser with a battle-tested parser library.
- Cap or periodically prune user sessions outside login hot path.
- Normalize/optimize genre and director filtering for scale.
- Reconcile rate-limit behavior between nginx and Express and document authority.
- Split oversized frontend `App.js` into maintainable component modules.
- Remove misleading auth-role UX dependence on `localStorage` cache.
- Consolidate TMDB TV/movie normalization in one layer to prevent drift.
- Add operational feature flag service behavior and audit coverage.
- Improve migration fidelity/rollback tooling before 2.0 (down strategy + rehearsal automation).
- Resolve migration-history clarity gap where v1 is a snapshot schema.

## 1.9.2 — Secret and Crypto Hardening

**Goal:** Eliminate risky secret fallbacks and make crypto failures observable.

### Scope

- Require `INTEGRATION_ENCRYPTION_KEY` in production startup (fail fast with clear error).
- Remove production fallback to `SESSION_SECRET`/hardcoded dev-only value for integration encryption.
- Add warning/error logging when decryption fails (include key type/provider context, never secret value).
- Add key-rotation guidance and failure modes to deployment docs.
- Make `trust proxy` configurable by env and document required topology assumptions.

### Acceptance Criteria

- Production startup fails when integration encryption key is missing.
- Decryption failures are visible in logs and activity events.
- Proxy trust behavior is explicit, configurable, and documented.

## 1.9.3 — Import Reliability and Async Execution

**Goal:** Make large imports durable and observable without HTTP timeout risk.

### Scope

- Implement async import job path (`sync_jobs` + background worker).
- Add concurrency controls and provider-aware throttling for TMDB/plex enrichment calls.
- Persist import progress and expose status endpoints for frontend polling.
- Include enrichment-failure detail per item in import audit output.

### Acceptance Criteria

- Large Plex import no longer requires a single long-running HTTP request.
- Import results contain explicit enrichment miss/failure reasons.
- Frontend can track job progress and completion summary.

## 1.9.4 — Data Integrity and Query Performance

**Goal:** Prevent subtle data drift and keep filters fast as libraries grow.

### Scope

- Add uniqueness guarantee for `media_metadata` (`UNIQUE(media_id, key)`), with migration cleanup for duplicates.
- Add/optimize index strategy for genre/director filtering (GIN/trigram or normalized tables by chosen approach).
- Add periodic session cleanup job and configurable max sessions per user policy.
- Ensure import dedupe/update logic remains deterministic under concurrent execution.

### Acceptance Criteria

- Duplicate metadata keys cannot accumulate per media item.
- Director/genre filtering remains performant on large datasets.
- Session table growth is bounded without relying on login-triggered cleanup.

## 1.9.5 — Parsing and Normalization Consistency

**Goal:** Remove parser edge-case risk and centralize media normalization.

### Scope

- Replace hand-rolled CSV parsing with a maintained parser library.
- Add import tests for quoted/multiline/escaped CSV edge cases.
- Consolidate TMDB TV/movie field normalization into one canonical layer (backend contract).
- Simplify frontend to consume normalized API response without duplicate normalization logic.
- Add integration-secret health check/reporting for decrypt failures (e.g., stale `INTEGRATION_ENCRYPTION_KEY`) with a clear admin remediation path.

### Acceptance Criteria

- CSV import handles edge-case rows reliably.
- TV/movie mapping logic has a single source of truth.
- Frontend and backend normalization cannot drift silently.
- Integration settings clearly indicate decrypt health issues and required fix steps without blocking unrelated features.

## 1.9.6 — Frontend Maintainability and Auth UX Clarity

**Goal:** Reduce frontend complexity and remove misleading security UX.

### Scope

- Refactor `frontend/src/App.js` into component/page modules.
- Keep role-gated rendering based on server-confirmed session state; treat local cache as non-authoritative or remove it.
- Add clear loading/forbidden UX patterns for server-authoritative role checks.
- Add smoke tests for navigation, role-gated views, and critical library flows.
- Add activity log filter controls (action/entity/date/user) for faster incident triage during testing and admin ops.
- Extend `Import` UI with a `Barcode` tab (parity with Plex/CSV tabs) so barcode-driven ingest is available from the unified import workflow.

### Acceptance Criteria

- App entry file is significantly reduced and componentized.
- UI role visibility aligns with server authorization behavior.
- Core UI flows are covered by repeatable smoke checks.
- Import menu includes `Barcode` as a first-class tab with clear success/error feedback and audit events.

## 1.9.7 — Rate Limiting and Edge Policy Alignment

**Goal:** Make rate-limiting behavior predictable across deployment topologies.

### Scope

- Define authoritative rate-limit layer per endpoint class (edge vs app).
- Align nginx and Express settings to avoid conflicting or multiplicative limits.
- Document single-node vs multi-node behavior expectations.
- Add validation checklist for Portainer/homelab deployments.
- Activity filter UX polish (deferred from 1.9.6):
  - Merge activity filter inputs into a streamlined search-first flow.
  - Allow Enter key to apply filters without requiring a separate Apply click.

### Acceptance Criteria

- Effective limits are deterministic and documented.
- Auth/media/admin endpoints have intentional rate-limit ownership.

## 1.9.8 — Feature Flag Operationalization

**Goal:** Turn feature flag scaffolding into an operational control plane.

### Scope

- Implement feature flag read/service layer used by real code paths.
- Add admin visibility/edit capability for safe flags (or env-backed read-only mode with docs).
- Add activity/audit entries for all flag changes.
- Add `created_at` and updater metadata as needed for governance.

### Acceptance Criteria

- Feature flags are active controls, not inert schema.
- All flag changes are auditable and reversible.

## 1.9.9 — Migration Fidelity and Rollback Readiness

**Goal:** Enter 2.0 with proven migration/rollback discipline.

### Scope

- Add rollback strategy support for critical migrations (or scripted restore workflow with automated verification).
- Add CI rehearsal: apply forward migrations on snapshot fixture and validate rollback path.
- Reconcile migration-history clarity:
  - keep append-only production migrations,
  - add documented baseline strategy for fresh-install clarity.
- Publish reproducible migration rehearsal evidence for 2.0 readiness.

### Acceptance Criteria

- 2.0 preflight includes a tested rollback path.
- Migration behavior is reproducible in CI and documented for operators.

## 1.9.14 — CSRF Defense and Session Cookie Hardening

**Goal:** Add explicit cross-site request forgery protection for cookie-authenticated write operations.

### Scope

- Implement CSRF token issuance endpoint and middleware verification for mutating API routes (`POST`, `PUT`, `PATCH`, `DELETE`).
- Keep existing `SameSite`/`httpOnly` cookie settings and add explicit CSRF token check as defense in depth.
- Add frontend CSRF bootstrap and automatic token attachment on mutating calls.
- Add clear 403 error shape for missing/invalid CSRF tokens and document troubleshooting.
- Add activity log event(s) for CSRF validation failures.

### Acceptance Criteria

- Cross-site form/post attempts without valid CSRF token are rejected.
- All authenticated mutating endpoints require and validate CSRF token.
- Frontend user flows continue to work without manual token handling by users.

## 1.9.15 — Invite Security Hardening (Token Hashing + Lifecycle Controls)

**Goal:** Remove plaintext invite-token risk and strengthen invitation lifecycle controls.

### Scope

- Store invite tokens hashed at rest (similar model to session token hashing).
- Return raw token only at invite creation time; never return stored raw token on list/read endpoints.
- Add explicit invite invalidation and one-time claim enforcement checks with consistent error responses.
- Bind invite claim strictly to invited email (already partially present; make behavior canonical and tested).
- Add audit coverage for invite create, claim, revoke, and failed claim attempts.

### Acceptance Criteria

- Database does not store plaintext invite tokens.
- Used/revoked/expired tokens cannot be replayed.
- Invite list endpoint no longer leaks reusable token material.

## 1.9.16 — Credential Recovery and Password Reset Workflow

**Goal:** Harden account credential changes and provide robust admin recovery paths.

### Scope

- Require current password for any self-service password change.
- On successful self-service password change:
  - revoke all other active sessions for that user,
  - optionally keep current session alive (documented behavior).
- Add admin-initiated password reset flow:
  - create one-time-use reset token + expiry,
  - generate reset URL for user delivery,
  - require token consumption to set a new password.
- Add "force reset" and "reset token invalidation" controls for admins.
- Add break-glass admin recovery documentation with CLI commands for cases where admin account access is lost.
- Add full audit coverage for password-change and reset lifecycle events (start/success/failure/invalidation).

### Acceptance Criteria

- Users cannot change password without current password verification.
- Admin can issue one-time reset URLs and invalidation works.
- Recovery commands are documented and tested against a running container stack.

## 1.9.17 — Scope Authority and Membership Enforcement

**Goal:** Ensure space/library access is server-authoritative and not client-header-authoritative.

### Scope

- Move active `space_id`/`library_id` resolution to server-side session/membership context.
- Treat request headers/query overrides (`x-space-id`, `x-library-id`) as non-authoritative hints only when explicitly allowed.
- Enforce membership checks on all scoped endpoints (media, invites, admin operations).
- Add explicit 403 errors for invalid scope access attempts.
- Add audit entries for rejected cross-scope access attempts.

### Acceptance Criteria

- Users cannot access non-member scopes by altering headers/query params.
- Scope enforcement behavior is consistent across read/write/admin endpoints.
- Cross-scope leakage tests pass.

## 1.9.18 — Runtime Dependency Rationalization (Redis Decision)

**Goal:** Remove ambiguous runtime dependencies before 2.0 and simplify deploy/security posture.

### Scope

- Decide and implement one of:
  - fully remove Redis from compose/env/dependencies if unused, or
  - reintroduce Redis-backed runtime features intentionally with documented purpose.
- Remove dead env vars/deps/docs related to unused runtime components.
- Update health checks and deploy docs to match the chosen runtime architecture.
- Add CI check that blocks reintroduction of undeclared runtime dependencies.

### Acceptance Criteria

- Runtime topology is explicit and minimal.
- Homelab deployment docs and compose files match actual runtime requirements.
- No orphan/unused secret requirements remain.

## 1.9.19 — CI Security Gates and Release Checklist Enforcement

**Goal:** Make secure release behavior mandatory and automated.

### Scope

- Add CI security gates:
  - dependency vulnerability scan for backend/frontend,
  - container image scan,
  - SBOM artifact generation and retention.
- Enforce version/release checklist in CI (not manual-only):
  - version parity checks,
  - migration checks,
  - health/smoke checks against compose stack,
  - release-note checklist marker validation.
- Fail builds when required release gates are not satisfied.
- Document triage policy for vulnerabilities (blocker thresholds + exception process).

### Acceptance Criteria

- CI blocks releases missing mandatory release checks.
- CI artifacts include scan reports/SBOM for each release build.
- Release process is reproducible by operators, not dependent on developer memory.

## 1.9.20 — Frontend Modularity Guardrails (App.js and Feature-Creep Policy)

**Goal:** Prevent monolith regression in frontend architecture and maintain iteration speed.

### Scope

- Define and enforce frontend module boundaries:
  - `App.js` retains shell/routing/composition only,
  - page-level containers under dedicated module paths,
  - shared UI and state hooks in separate modules.
- Add size-budget checks for `frontend/src/App.js` and other high-risk files.
- Add feature-creep policy and PR checklist requiring:
  - explicit scope statement,
  - rationale for new module vs existing module,
  - no unrelated refactors in feature PRs.
- Add roadmap discipline rule: milestone scope changes require explicit roadmap/doc update in same PR.
- Add lint or static checks that fail CI when modularity guardrails are violated.

### Acceptance Criteria

- `App.js` remains within defined size/complexity budget.
- New frontend features land in modules, not by expanding the app shell monolith.
- PR and CI checks enforce scope discipline and modularity standards.

## 1.9.21 — Secret Hygiene and Rotation Readiness

**Goal:** Ensure no secrets are committed and operators have a deterministic key-rotation/incident process before 2.0.

### Scope

- Add blocking CI secret scanning gate (repo history + working tree) to release pipeline.
- Document mandatory secret lifecycle policy:
  - generation,
  - storage,
  - rotation cadence,
  - compromise response.
- Add operator runbook for:
  - rotating `SESSION_SECRET`,
  - rotating `INTEGRATION_ENCRYPTION_KEY` with key re-entry/re-encryption,
  - forced session invalidation (`user_sessions` cleanup).

### Acceptance Criteria

- CI fails when a secret leak is detected.
- Secret rotation runbook exists and is linked from wiki home.
- Operators can execute full key rotation without ambiguous steps.

## 1.9.22 — Session and Cookie Hardening Verification

**Goal:** Lock in cookie-session security defaults and remove weak fallback behavior.

### Scope

- Validate secure cookie behavior across proxy/direct deploy modes.
- Remove/flag any dev-only crypto/session fallback paths that could mask misconfiguration.
- Add CI/runtime assertions for required security headers and cookie attributes in production mode.

### Acceptance Criteria

- Production config cannot boot with insecure session/crypto fallback.
- Cookie/session behavior is deterministic and documented for reverse-proxy deployments.

## 1.9.23 — RBAC Regression Test Pack

**Goal:** Prevent privilege regressions by making scope and role checks testable and repeatable.

### Scope

- Add integration tests for core RBAC paths:
  - media ownership,
  - admin-only routes,
  - scope membership enforcement.
- Add CI job to run RBAC regression pack before image publish.

### Acceptance Criteria

- CI fails on role/scope regression.
- Regression tests cover both allow and deny paths for critical endpoints.

## 1.9.24 — Observability and Activity Triaging

**Goal:** Improve operator incident diagnosis with structured, filterable, high-signal logs.

### Scope

- Expand activity filtering for incident workflows (action/entity/status/reason windowing).
- Ensure import/auth/admin failure paths emit actionable log details.
- Document operator triage flow from UI + DB query fallback.

### Acceptance Criteria

- Operators can quickly isolate failed actions in Activity without raw DB exploration.
- Failure events include sufficient context to identify remediation path.

## 1.9.25 — Pre-2.0 Go/No-Go Automation

**Goal:** Convert the pre-2.0 go/no-go checklist into an enforceable release gate.

### Scope

- Add a dedicated preflight checklist artifact in CI for tagged releases.
- Require evidence for migration rehearsal, security scans, and smoke validation in release output.
- Add explicit release-blocking criteria and exception process references in docs.

### Acceptance Criteria

- Tagged builds emit a clear go/no-go result with linked evidence artifacts.
- Missing preflight evidence blocks release publication.

## 1.9.26 — Portable Compose Topology + Security Triage Baseline

**Goal:** Eliminate fixed-container deployment coupling and establish an explicit pre-2.0 vulnerability triage baseline.

### Requirements

- `REQ-1`: Compose files MUST NOT define `container_name`.
- `REQ-2`: CI compose checks MUST resolve service containers dynamically (`docker compose ps -q`), never by fixed names.
- `REQ-3`: CI MUST fail if `container_name` is reintroduced.
- `REQ-4`: Registry compose defaults MUST enforce secure production cookie posture (`SESSION_COOKIE_SECURE=true` unless explicitly overridden for local dev).
- `REQ-5`: Release notes MUST include a vulnerability triage summary with owner and target remediation milestone for any unresolved `high` findings.

### Scope

- Remove `container_name` from all compose files to allow:
  - parallel stacks,
  - project-name isolation,
  - safer rehearsal environments.
- Update CI compose health checks to resolve container IDs by service name (`docker compose ps -q`) instead of fixed names.
- Add CI guard that fails if `container_name` is reintroduced.
- Align registry compose defaults with current security posture:
  - secure session cookies by default in production mode.
- Capture baseline `high` vulnerability inventory and document remediation plan/owner in release notes.

### Acceptance Criteria

- Compose stacks run without fixed-name collisions (`main` and temporary project names).
- CI no longer references hard-coded container names.
- CI blocks `container_name` drift.
- Release note includes explicit `high` vulnerability triage summary and target remediation milestone.

### Test Plan

- Run `docker compose --env-file .env config` for both local and registry compose files.
- Run stack smoke with default project and a non-default project (`-p`), verify healthy startup.
- Run CI locally (or equivalent scripts) for compose health checks and `container_name` policy guard.
- Confirm release note template includes vulnerability-triage section.

### API/DB Checklist

- No schema/API contract changes.
- Runtime/deploy topology only.

## 1.9.27 — App Shell De-Bloat and Modularity Enforcement

**Goal:** Bring frontend architecture into policy compliance before 2.0 migration complexity lands.

### Requirements

- `REQ-1`: `frontend/src/App.js` MUST be reduced to shell orchestration only (routing, nav, providers).
- `REQ-2`: Feature views/stateful logic MUST live in module components/hooks under `frontend/src/components` and `frontend/src/hooks`.
- `REQ-3`: CI MUST enforce an `App.js` line-budget gate with documented exception workflow and expiry.
- `REQ-4`: New milestone features MUST NOT increase `App.js` net LOC unless an approved exception exists.

### Scope

- Reduce `frontend/src/App.js` to shell-only orchestration:
  - routing,
  - nav,
  - global providers.
- Move remaining feature-specific logic into module components/hooks.
- Add CI modularity enforcement:
  - fail when `App.js` exceeds hard budget unless exception is documented.
- Add explicit exception mechanism with expiry for temporary over-budget states.

### Acceptance Criteria

- `App.js` is at or below policy hard budget, or approved time-bound exception exists.
- New feature code lands outside App shell by default.
- CI enforces modularity budget gate.

### Test Plan

- Run unit/smoke tests for Library/Admin/Profile flows after extraction.
- Validate nav, auth, imports, and drawer behavior unchanged.
- Validate CI fails when `App.js` exceeds budget without exception metadata.

### API/DB Checklist

- No schema/API contract changes.
- Frontend architecture and CI policy enforcement only.

## 1.9.28 — Final 2.0 Migration Readiness Rehearsal

**Goal:** Produce final go/no-go evidence that 2.0 migration + rollback is safe on production-like data.

### Requirements

- `REQ-1`: Rehearsal MUST run on a recent production-like snapshot copy.
- `REQ-2`: Rehearsal MUST verify both forward migration and rollback integrity checks.
- `REQ-3`: A signed go/no-go artifact MUST exist before opening `2.0.0` implementation PR.
- `REQ-4`: Any critical rehearsal failure MUST block 2.0 kickoff.

### Scope

- Run full migration rehearsal against recent production-like snapshot copy.
- Verify:
  - schema upgrade path,
  - data integrity checks,
  - rollback path evidence.
- Publish rehearsal report and operator runbook updates.
- Require explicit release signoff checklist completion before opening 2.0 implementation PR.

### Acceptance Criteria

- Rehearsal report artifact exists with pass/fail matrix for upgrade + rollback.
- No unresolved data integrity blockers remain.
- 2.0 kickoff requires signed checklist reference in release notes/roadmap.

### Test Plan

- Execute documented rehearsal script end-to-end on a snapshot clone.
- Validate integrity queries before/after upgrade and after rollback.
- Validate failure-mode reporting and block condition in release workflow.

### API/DB Checklist

- No production schema changes in this milestone.
- Rehearsal and evidence generation only.

## 1.9.29 — Pre-2.0 Security Remediation Closure

**Goal:** Close remaining high-severity dependency/base-image risk before 2.0 go-live approval.

### Requirements

- `REQ-1`: Dependency and image scan results MUST have no untriaged `high` findings.
- `REQ-2`: Any retained `high` finding MUST include documented compensating controls, owner, and expiration.
- `REQ-3`: Pre-2.0 go/no-go artifact MUST be updated to `GO` only after security gate closure.

### Scope

- Upgrade/replace vulnerable packages where feasible without breaking production behavior.
- Re-run dependency and image scans and attach updated artifacts.
- Update release note/security triage and go/no-go report with final disposition.

### Acceptance Criteria

- `critical` and `high` findings are either remediated or approved via explicit exception process.
- CI and release artifacts show completed security triage closure.
- 2.0 kickoff is unblocked from a security-gate perspective.

---

## 2.0.0 — Homelab Core Release (Users + One Library Surface)

**Goal:** Deliver a secure, usable homelab media catalog for households: multiple users, admin-managed integrations, and one unified library experience for movies, TV, books, audio, and games.

**Product boundary for 2.0.0:**
- No enterprise tenancy model.
- No user-owned integration credentials.
- No required nested library hierarchy for end users.
- Keep multi-library internals optional and lightweight; default UX is a single primary library surface.

### Milestone Path From `2.0.0-alpha.9` to Stable `2.0.0`

- `2.0.0-beta.1`:
  - Lock auth/RBAC behavior for admin + normal users.
  - Validate admin-managed integrations end-to-end (test/import/sync).
  - UI pass for clarity and mobile usability (Library, Import, Profile, Members, Activity).
  - Add media-type baseline coverage for `movie`, `tv_series`, `book`, `audio`, `game`, `other` in Library create/edit/list flows.
- `2.0.0-beta.2`:
  - Strengthen library data model for mixed media types (movies/TV/books/audio/games) without over-complicating tenancy.
  - Finish search/filter/sort and paging ergonomics for practical collection sizes.
  - Verify import quality and de-duplication behavior across providers.
  - Complete media-type filter/search behavior checks so each type can be isolated and managed without cross-type confusion.
- `2.0.0-beta.3`:
  - Add admin-managed enrichment provider settings for Books, Audio, and Games (alongside TMDB/Barcode/Vision/Plex).
  - Add provider test endpoints and integration status badges for Books, Audio, and Games.
  - Add Library lookup-and-apply flows for Books, Audio, and Games in add/edit media forms.
  - Validate that applied enrichment populates type-specific fields and persists through create/edit flows.
- `2.0.0-beta.4`:
  - Add identifier-first enrichment pipeline for imports and manual lookups:
    - `ISBN` first for books,
    - `EAN/UPC` first for physical media and games,
    - title/year fallback only when identifiers are missing or no-hit.
  - Extend Delicious import mapping to persist source identifiers (`isbn`, `ean/upc`, `asin` parsed from Amazon link when present).
  - Add de-duplication precedence by identifier (`ISBN`, `EAN/UPC`) before title/year matching.
  - Add explicit import audit detail for identifier lookup outcome (`matched_by_identifier`, `identifier_no_match`, `fallback_title_match`).
- `2.0.0-beta.5`:
  - Add signed-copy metadata fields across media types:
    - `signed_by` (free text),
    - `signed_role` (`author`, `producer`, `cast`),
    - `signed_on` (date),
    - `signed_at` (free text).
  - Ensure create/edit/view/import payloads preserve these fields without breaking older clients.
  - Add migration + index review (where needed) and include field-level validation rules.
- `2.0.0-beta.6`:
  - Add comic-book tracking foundation:
    - media-type-level support for comic entries in unified library UX,
    - calibre library/list import path for comics (hosted library or export file ingestion),
    - comic enrichment provider implementation:
      - primary: Metron,
      - secondary fallback: GCD API,
      - optional/legacy adapter: ComicVine (feature-flagged, terms-dependent).
    - normalized comic metadata mapping (`series`, `issue_number`, `volume`, `publisher`, `author/writer`, `artist`, `inker`, `colorist`, `cover_date` where available).
  - Add photo capture/upload foundation for signings and cover workflows:
    - reusable image picker that supports file upload and mobile camera capture (`capture` input behavior),
    - signed-proof image attachment support on media entries (separate from poster art),
    - explicit success/failure UI feedback for Vision cover recognition (no silent no-op path),
    - audit events for attachment upload/replace/remove actions.
  - Reader feasibility spike:
    - evaluate built-in reader options for common comic formats,
    - evaluate extension path to digital books where technically safe and maintainable.
  - Add clear scope boundaries for v2.0 release candidate (tracking + import first, reader optional behind feature flag if incomplete).
- `2.0.0-rc.1` (completed 2026-03-02):
  - Public test-server rehearsal with real tester traffic.
  - Resolve blocker bugs from tester template + activity logs.
  - Complete release checklist, migration rehearsal evidence, and rollback steps.
  - Run explicit RC media-type test matrix (add/edit/delete/search/import where applicable) for movies, TV, books, audio, and games.
- `2.0.0` (completed 2026-03-02):
  - Stable homelab release with documented setup, security defaults, and operator runbooks.

### Scope

- Keep multi-user support (`admin`, `user`, optional `viewer`) with secure cookie sessions and CSRF.
- Keep integrations admin-managed at app scope:
  - TMDB, Barcode, Vision, Plex.
- Provide one primary library UX with category/type filtering:
  - movies, TV, books, audio, games, other.
- Preserve import/sync workflows:
  - Plex import,
  - Generic CSV import,
  - Delicious CSV import.
- Use identifier-first matching where available:
  - `ISBN` and `EAN/UPC` as primary enrichment/dedupe keys,
  - title/year as fallback.
- Preserve clear audit visibility for failures and privileged actions.
- Prioritize usability and reliability over adding tenancy complexity.

### Acceptance Criteria

- Admin can configure integrations and users; normal users can manage catalog entries safely.
- End users can add/import/edit/delete/search media without scope confusion.
- Media-type coverage is confirmed at RC: movies, TV, books, audio, and games are all manageable in the unified library surface.
- Imports with identifier-bearing rows produce materially higher match quality:
  - books with `ISBN` preferentially match by `ISBN`,
  - physical media rows with `EAN/UPC` preferentially match by barcode,
  - audit output states whether identifier or fallback matching was used.
- Library performance remains acceptable for large personal collections.
- Security defaults are enforced in production (strong secrets, secure cookies, CI gates).
- Release docs support straightforward homelab deployment and recovery.

### DB/API Checklist

- DB:
  - Keep current `media` + supporting tables stable and migration-safe.
  - Persist and index canonical external identifiers used for import/dedupe (`isbn`, `ean/upc`, optional `asin` metadata).
  - Ensure indexes support high-volume browse/search/import paths.
  - Avoid disruptive tenancy schema expansion in 2.0.0.
- API:
  - Keep API contracts stable for auth, media CRUD, imports, invites, and admin tooling.
  - Add identifier-aware enrichment/import behavior without breaking existing request payloads.
  - Maintain strict RBAC checks and explicit audit events for failures/denials.
  - Avoid introducing new multi-space endpoint families in 2.0.0.

---

## 2.5.0 / 3.0.0 — Optional Tenancy Expansion (Deferred)

Deferred tenancy planning has been moved to a separate roadmap document:

- `docs/wiki/roadmap-tenancy-deferred.md` (local planning document, git-ignored)

---

## Post-2.0 (Later Milestones)

## 2.1.0 — Metadata Normalization and Query Performance

**Goal:** Replace comma-separated metadata fields with normalized relations for reliable search/filtering at scale.

### Scope

- Normalize `genre`, `director`, and actor/cast metadata into relational tables.
- Backfill existing media records and preserve backward-compatible reads during migration window.
- Update filter/search endpoints and indexes for normalized queries.

### Acceptance Criteria

- Search/filter behavior matches existing functionality with improved accuracy/performance.
- Migration/backfill is complete with no data-loss regressions.

## 2.2.0 — Observability Platform (Metrics + Alerting)

**Goal:** Move from log-only triage to measurable system health with alerts.

### Scope

- Add structured metrics export for API/import/auth error rates and queue behavior.
- Add baseline dashboards and alert thresholds.
- Add operator playbook for alert triage and escalation.

### Acceptance Criteria

- Critical regressions are visible via alerts without manual log polling.
- Dashboard coverage includes imports, auth failures, and admin actions.

## 2.2.5 — Structured Log Export (GELF + Pluggable Backends)

**Goal:** Add production-grade external log shipping with a canonical GELF contract, feature-flagged rollout, and operator-selectable backend targets.

### Scope

- Canonical GELF contract:
  - adopt the schema in `docs/wiki/22-Logging-and-Observability-Contract.md`,
  - map current `activity_log` + request audit events into GELF-compliant events with stable extension keys,
  - enforce redaction policy for sensitive fields before emit.
- Feature-flagged enablement:
  - add a backend feature flag for external log export (default off),
  - support safe rollout by environment and runtime toggle without app restart where feasible.
- Graylog setup path (primary):
  - add compose examples and runbook for local/self-hosted Graylog endpoint,
  - support UDP/TCP GELF transports with retry/fail-safe behavior,
  - define failure mode: logging exporter failures must not block primary API behavior.
- Alternative backends (same milestone, operator choice):
  - ELK/OpenSearch pipeline guidance (GELF or JSON ingest path),
  - Grafana stack path (Loki/Promtail-compatible structured logs),
  - syslog forwarding path for traditional homelab environments.
- Compatibility and safety:
  - no secret/token leakage in shipped payloads,
  - bounded payload sizes and drop/truncation policy for oversized details,
  - correlation fields for request/job tracing (`_request_id`, `_action`, `_entity_type`, etc).

### Acceptance Criteria

- External log export can be enabled/disabled by feature flag and config.
- Graylog ingestion is documented and verified against sample collectZ events.
- ELK/Grafana/syslog alternatives are documented with supported field mappings and caveats.
- CI/runtime checks verify redaction rules and forbid plaintext secret/token fields in exported log payloads.
- Exporter outages do not degrade core API/import behavior.

## 2.3.0 — Import Match Review + Collections Intelligence

**Goal:** Improve import quality for ambiguous matches and boxed-set decomposition while keeping automation safe and operator-visible.

### Scope

- Import match review workflow:
  - Add backend confidence scoring for enrichment/import matches across providers.
  - Persist low-confidence or ambiguous rows to an `import_match_reviews` queue (by import job/source row).
  - Add a `Library -> Import Review` UI for resolving poor matches after import completes (non-blocking).
  - Resolution actions: `Accept suggested`, `Choose alternate`, `Search again`, `Skip/Keep manual`.
  - Show unresolved review count badge in navigation.
  - Record all review decisions in audit logs.
- Physical boxed-set decomposition (optional fallback track):
  - Add `collections` + `collection_items` model for package-level imports (for example, boxed sets and marathons).
  - Detect boxed-set candidates during import and extract expected title count when present (for example, `4-movie`, `8-film`).
  - Resolve contained titles using provider-first strategy (UPC/product APIs + movie/TV APIs), then confidence score results.
  - Add optional web lookup fallback for unresolved sets (strictly gated by legal/ToS/robots constraints and feature flag).
  - Keep web-fallback results in manual review queue by default (no silent auto-apply).
  - Add side-project spike: evaluate provider reliability and legal risk for Blu-ray-focused scraping before enabling in production.

### Acceptance Criteria

- Ambiguous imports no longer auto-apply silently; they enter review queue.
- Boxed-set imports can be represented as collection + contained items where data is available.

## 2.4.0 — TV Watch-State and Provider Sync Foundation

**Goal:** Build durable TV season/watch-state modeling that can sync with external providers later.

### Scope

- TV data model hardening:
  - Move season ownership out of `media_variants` into a dedicated `media_seasons` table keyed by `media_id` (TV series).
  - Keep `media_variants` for movie/file editions only.
  - Add season completeness fields (`expected_episodes`, `available_episodes`, `is_complete`).
  - Optional episode-level inventory remains future/opt-in.
- Watch status foundation:
  - Add series/season watch state fields (`unwatched`, `in_progress`, `completed`) with `last_watched_at`.
  - Add watchlist flags for planned viewing.
  - UI status indicators:
    - Show a green check icon on season rows marked `completed`.
    - Show a green check icon on TV series cards/posts when all tracked seasons are `completed`.
  - Prepare provider sync strategy for Plex as source-of-truth first, then optional outbound sync providers.
- Watchlist provider abstraction (Plex-first, then Trakt, Letterboxd).
- Per-space scheduled Plex sync automation.
- External status sync exploration (future): evaluate JustWatch and other services based on API availability and licensing constraints.
- Library-type specializations and templates (movies, music, books, games, comics) with domain-specific field sets.

### Acceptance Criteria

- TV seasons are modeled independently from movie editions.
- Series/season watch-state is visible and queryable with consistent UI indicators.

## 2.4.9 — Invite/Reset Security and Secret Exfiltration Hardening

**Goal:** Strengthen credential-recovery and invitation workflows while reducing practical token/secret exfiltration surface before UX-focused 2.5 work.

### Scope

- Email-first invite and password reset delivery:
  - add SMTP-backed delivery for invite links and admin-issued password reset links,
  - keep copy-link fallback only as an explicit admin action with clear warning.
- One-time token exposure minimization:
  - keep raw invite/reset tokens visible only at creation moment and avoid replay exposure in list/read endpoints,
  - add explicit token lifecycle audit events (`created`, `delivered`, `claimed`, `invalidated`, `expired`).
- Auth/session hardening aligned to exfiltration concerns:
  - reduce or remove browser Bearer-token fallback in favor of HttpOnly cookie-only browser auth paths,
  - retain CSRF defenses and verify mutating routes reject missing/invalid token pairs.
- Audit and log leak prevention controls:
  - add CI/runtime checks that activity/error logs do not contain plaintext API keys, session tokens, reset tokens, or authorization headers,
  - add automated regression checks for redaction/masking behavior on integration settings responses.
- Operator guidance and incident handling:
  - document break-glass recovery for lost admin access and secret rotation order,
  - add troubleshooting guidance for SMTP delivery failures and token invalidation.

### Acceptance Criteria

- Invites and password resets support SMTP delivery with auditable lifecycle states.
- No reusable raw invite/reset token material is exposed beyond one-time creation response.
- Browser auth paths do not depend on localStorage/sessionStorage bearer tokens.
- Security checks assert no plaintext credential/token leakage in activity logs and integration responses.
- Existing media/import/admin workflows remain functional after hardening.

## 2.5.0 — UI Refinement Sprint (Cross-Device Consistency)

**Goal:** Run a focused page-by-page UI refinement pass after 2.0 stabilization, prioritizing interaction consistency and responsive usability.

### Scope

- Standardize primary navigation toggle behavior:
  - replace collapse/expand control with a single hamburger-style toggle interaction,
  - keep behavior consistent across desktop and mobile patterns.
- Conduct structured UI review across major surfaces:
  - Library,
  - Import,
  - Profile,
  - Admin sections.
- Apply targeted visual/interaction adjustments per page and element until review checklist passes.
- Keep this sprint UX-only unless a blocker requires small functional fixes.

### Acceptance Criteria

- Desktop and mobile navigation use one consistent toggle paradigm.
- UI review checklist is completed for each major page section.
- Refinement changes do not introduce regression in auth, media CRUD, imports, or admin flows.
- Shared vs. private user annotations and ratings controls.
- Mobile-optimized barcode scanning UI (camera input with real-time scan feedback).
- Email delivery for invites via SMTP (already stubbed in `env.example`).

## 2.6.0 — Events and Memorabilia Tracking

**Goal:** Add optional event tracking for conventions/festivals while keeping core media catalog flows simple.

### Scope

- Add an `Events` area for user-managed event logs (for example: comic conventions, film festivals, VHS events).
- Event model baseline:
  - event name, venue/location, start date, end date, notes.
- Event artifact tracking:
  - sessions attended,
  - people met,
  - autographs/signings,
  - purchases,
  - freebies.
- Attachment support for event artifacts:
  - photo upload/capture on mobile and desktop,
  - storage metadata + audit logging.
- Keep Events isolated from core media CRUD paths so media performance and reliability are not impacted.

### Acceptance Criteria

- Users can create/edit/delete events and add artifact rows under an event.
- Event attachments can be uploaded/captured and rendered reliably on mobile and desktop.
- Event actions and attachment changes emit clear audit log entries.

## 2.6.5 — Calibre Web Automated Integration (Comics/Books Bridge)

**Goal:** Replace CSV-centric Calibre workflows with direct Calibre Web Automated (CWA) integration for better reliability, better metadata continuity, and optional read-through behavior.

### Scope

- Direct CWA integration (same-host Docker-friendly):
  - add admin integration settings for CWA endpoint + auth model:
    - `cwa_opds_url`,
    - `cwa_base_url`,
    - `cwa_username`,
    - `cwa_password/token` (encrypted at rest),
    - timeout/retry controls.
  - use OPDS feed ingestion as the canonical read path (no CSV dependency).
  - support discovery/sync from CWA libraries without requiring CSV export.
  - map CWA items into collectZ media models for books/comics.
  - persist provider linkage metadata (`provider_item_id`, external URL, import source).
- Link-out first (primary UX path):
  - store canonical external CWA item identifiers/URLs on imported media,
  - add `Open in Calibre` action on media details (deep-link to exact issue/book when available),
  - document reverse-proxy/port-forward guidance for homelab deployments.
- Read capability decision track (feature-flagged):
  - add optional in-app reader path for supported non-DRM formats only,
  - if reader is disabled, preserve seamless external link-out behavior to CWA,
  - enforce strict file-type allowlist and sandboxed rendering strategy.
- Sync and consistency:
  - support incremental pull (new/updated/deleted) from CWA feeds,
  - support OPDS pagination traversal to avoid truncation on large libraries,
  - keep identifier-first dedupe and enrichment behavior for incoming rows,
  - preserve source attribution (`import_source`, provider ids) for round-trip troubleshooting.
- Operational safety:
  - importer failures are auditable and non-blocking for core CRUD,
  - CWA integration remains optional behind feature flags and env/config toggles.
- Documentation deliverables:
  - write `Calibre Web Automated Integration Setup` guide in wiki:
    - required CWA settings/prerequisites,
    - Docker networking/reverse-proxy examples,
    - OPDS auth verification steps,
    - troubleshooting (auth errors, pagination, deep-link mismatches).

### Acceptance Criteria

- Admin can configure/test CWA integration and run direct sync without CSV export.
- Imported comic/book entries can open the matching item in CWA when link metadata is available.
- Deep-link tests pass:
  - selected imported items open the exact target issue/book in CWA,
  - links remain valid through reverse-proxy/public host routing.
- OPDS ingestion tests pass:
  - auth success/failure paths are explicit and audited,
  - paginated libraries import all pages without silent truncation,
  - repeat sync does not duplicate existing items.
- In-app reader (if enabled) works only for allowed formats and can be fully disabled by feature flag.
- CWA outages/auth failures do not break core collectZ media workflows.

## 2.7.0 — Optional Market Valuation Integrations

**Goal:** Add optional value-estimate integrations for collectors without making pricing a hard dependency of core catalog features.

### Scope

- Add admin-managed, optional pricing providers:
  - PriceCharting (primary collectibles/games pricing source),
  - eBay Browse API (market listing/signal fallback).
- Add provider abstraction and normalized valuation model:
  - `estimated_value_low`,
  - `estimated_value_mid`,
  - `estimated_value_high`,
  - `valuation_currency`,
  - `valuation_source`,
  - `valuation_last_updated`.
- Support identifier-first price lookups (`UPC/EAN/ISBN` where applicable) with title fallback.
- Keep valuation read-only in v2.7.0 (no writeback to providers).
- Keep pricing behind feature flags and optional env configuration.

### Acceptance Criteria

- Admin can configure/test PriceCharting and eBay integrations independently.
- Media detail view can show valuation fields when present and degrade gracefully when unavailable.
- Pricing failures do not block media CRUD/import flows and are fully auditable.

## 2.8.0 — Optional Build: Cost Model and Billing Readiness

**Goal:** Prepare a data-backed cost model before any hosted subscription offering, while keeping self-hosted installs free of paid-provider dependencies.

### Scope

- Add per-portal usage metering primitives:
  - provider API call counts by integration and route,
  - import/sync job runtime and volume counters,
  - storage usage counters for uploads/attachments.
- Build a cost estimation model:
  - baseline infrastructure assumptions (compute, DB, storage, egress),
  - provider usage multipliers (for paid APIs where configured),
  - monthly low/mid/high estimate bands per portal.
- Add read-only admin “Cost Estimate” reporting view for hosted-mode planning.
- Define deployment profiles:
  - `self_hosted` profile (no paid APIs required),
  - `hosted_subscription` profile (paid integrations allowed and metered).
- Document break-even and guardrail thresholds for enabling paid integrations by default in hosted mode.

### Acceptance Criteria

- Cost estimate report can be generated from real usage telemetry for a portal.
- Top cost drivers are visible and attributable (API, storage, compute).
- Self-hosted profile remains fully functional with all paid-provider integrations disabled.

---

## CI/CD Notes (All Versions)

The existing GitHub Actions pipeline (`.github/workflows/docker-publish.yml`) correctly enforces version parity between `frontend/package.json` and `backend/package.json`, builds and pushes to GHCR, and injects build metadata. The following improvements are recommended across milestones:

- **1.6.4:** Add a linting step (`eslint`) and a basic smoke test step (curl `/api/health` against a test compose stack) to the CI pipeline. Fail the build if either fails.
- **1.7.0:** Add migration dry-run validation to CI: spin up a test Postgres container, run migrations against it, and verify the final schema matches expectations.
- **1.8.0:** Add integration test coverage for import endpoints (mock external APIs in CI).
- **2.0.0:** Add a migration rollback test to CI: apply 2.0 migrations, then roll back to 1.9 schema, verify no data loss on the test dataset.

Homelab deployers continue to use `docker compose -f docker-compose.registry.yml pull && up -d` with `IMAGE_TAG` set to the target version. The CI pipeline is the only path to publishing images — no manual `docker push` from developer machines.

---

## Release Operations Checklist (Each Version)

1. Update `frontend/package.json` and `backend/package.json` to the new version (must match).
2. Publish full release notes in `docs/releases/vX.Y.Z.md` (required).
3. Document release scope, migration notes, and any breaking changes.
4. Run CI pipeline — lint, smoke test, migration validation must all pass.
5. Build and push images via CI with `APP_VERSION`, `GIT_SHA`, `BUILD_DATE` injected.
6. Validate on a staging or local deployment:
   - Nav shows expected `v<semver> (<sha>)` string.
   - `/api/health` returns expected version/build fields.
   - Smoke test checklist passes (see `09-Smoke-Test-Checklist.md`).
7. Tag release in git: `vX.Y.Z`.
7. Update `docker-compose.registry.yml` default `IMAGE_TAG` value.
8. Notify homelab users via release notes of any env var changes required.
