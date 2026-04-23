# Release Roadmap (1.6.3 → 2.0.0)

This roadmap converts product direction into implementation milestones with acceptance criteria and DB/API checklists. It incorporates findings from two independent architecture reviews conducted after the 1.6.3 baseline, and reflects the project's core priorities: security, data integrity, simple end-user deployment, CI/CD robustness, and a clear path to multi-space support.

Deferred or unscheduled work lives in [08-Backlog.md](08-Backlog.md); this file stays focused on numbered milestones and the work that has already been selected for release planning.

---

## Guiding Principles

- Keep 1.x backward compatible with existing deployments.
- Use 2.0.0 for the multi-space data model change.
- Ship integrations incrementally, but design 1.x work to be reusable in 2.0.
- Security fixes and access control gaps take priority over new features.
- Every milestone should leave the deployment story simpler, not more complex.
- The CI/CD pipeline is a first-class concern — changes must be deployable via `docker compose pull && up -d` for homelab users.
- Delivery and modularity controls in `14-Engineering-Delivery-Policy.md` are mandatory for pre-2.0 releases.

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
- Add direct member setup flow for local/admin-driven onboarding without requiring the admin to choose or distribute a reusable password:
  - `Create member` action accepts email, display name, and target role (`user` or `admin`)
  - account is created in an invited/setup-pending state
  - admin chooses delivery mode:
    - copy one-time setup link
    - send setup link by email when SMTP is configured
  - invited user sets their own password through the one-time setup flow
- Show clear SMTP delivery availability in the Members/Invitations UI:
  - indicate whether email delivery is currently configured/available
  - keep copy-link/setup-link flow available even when SMTP is unavailable
- Keep this milestone scoped to member/invite UX and onboarding flow only:
  - do not add full SMTP credential management UI in this slice
  - do not introduce a long-lived admin-generated default-password workflow
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
- Admin can create a member and choose copy-link or email delivery for one-time account setup.
- Admin can preselect the new member role during setup without manually editing the user after claim.
- Member onboarding does not require the admin to set or retain a reusable password for the new user.
- Members/Invitations UI makes SMTP availability obvious before admin chooses delivery mode.
- Admin can revoke an active invite; revoked invite cannot be used.
- Used invites no longer clutter default invitation list.
- Activity log includes invite claim/revoke lifecycle events.
- Member drawer opens from list row and supports at least role updates + read-only activity metrics.

### API/DB Checklist

- Add invite revoke endpoint (admin-only).
- Add `invite.claimed` and `invite.revoked` activity event coverage.
- Add direct member-setup API support for creating an invited/setup-pending account with preselected role and one-time activation delivery metadata.
- Reuse existing one-time link/reset-style primitives where practical instead of storing admin-generated default passwords.
- If needed, expose non-secret SMTP availability status to the admin UI without exposing SMTP credentials.
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

- Split the former monolithic backend into a proper module structure while keeping `backend/server.js` as a thin bootstrap/composition root only:
  - `backend/routes/` — `auth.js`, `media.js`, `admin.js`, `integrations.js`
  - `backend/middleware/` — `authenticate.js`, `requireRole.js`, `asyncHandler.js`
  - `backend/services/` — `tmdb.js`, `barcode.js`, `vision.js`
  - `backend/db/` — `pool.js`, `migrations.js`
- Limit `backend/server.js` to:
  - Express app bootstrap and middleware composition,
  - route mounting,
  - startup validation/migration wiring,
  - health/bootstrap endpoints,
  - process startup and shutdown concerns.
- Do not keep feature-specific route handlers, business logic, provider integrations, or direct domain-query orchestration in `backend/server.js`.
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
- Backend route, middleware, service, and DB responsibilities live in dedicated modules; `backend/server.js` remains only as a thin bootstrap/composition entrypoint.

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

- Refactor `frontend/src/App.jsx` into component/page modules.
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
- Add size-budget checks for `frontend/src/App.jsx` and other high-risk files.
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

- `REQ-1`: `frontend/src/App.jsx` MUST be reduced to shell orchestration only (routing, nav, providers).
- `REQ-2`: Feature views/stateful logic MUST live in module components/hooks under `frontend/src/components` and `frontend/src/hooks`.
- `REQ-3`: CI MUST enforce an `App.js` line-budget gate with documented exception workflow and expiry.
- `REQ-4`: New milestone features MUST NOT increase `App.js` net LOC unless an approved exception exists.

### Scope

- Reduce `frontend/src/App.jsx` to shell-only orchestration:
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

## Deferred Planning Note — Tenancy Expansion

The earlier deferred-tenancy placeholder is superseded by the scheduled `2.7.0` tenancy milestone below.

Historical planning notes may still exist in:

- `docs/wiki/roadmap-tenancy-deferred.md` (local planning document, git-ignored)

---

## Post-2.0 (Later Milestones)

### Post-2.0 Versioning Rule

- Feature milestones advance by **minor** version (`2.x.0`).
- Fix-only follow-ups use **patch** version bumps (`2.x.y`), for example:
  - `2.2.1` = fixes to `2.2.0`
  - `2.3.2` = second patch release in the `2.3.x` line
- Avoid introducing new feature scope in patch releases.

### Post-2.0 Execution Order

1. `2.1.0` Metadata normalization and query performance
2. `2.2.0` Import match review + collections intelligence
3. `2.3.0` TV watch-state + provider sync foundation
4. `2.3.1` TV season drill-down and TMDB season metadata
5. `2.4.0a` Mixed-media schema and validation hardening
6. `2.4.0b` Search/filter/sort and dedupe quality tuning
7. `2.4.1` Collection conversion UX parity (movies/games)
8. `2.4.2` Events and memorabilia tracking
9. `2.4.3` Drawer-first editing compactness experiment
10. `2.4.3.1` Drawer/filter follow-up + Metron API compliance
11. `2.4.3.2` Collections UX unification and library integration
12. `2.4.4` Collectibles category expansion (cards/art/merch taxonomy)
13. `2.4.4.1` App shell decomposition (hooks extraction)
14. `2.4.4.2` App shell decomposition (dashboard content split)
15. `2.4.4.3` App shell guardrails enforcement
16. `2.4.5` Calibre Web Automated integration
17. `2.5.0` Invite/reset security hardening
18. `2.6.0` Observability platform (metrics + alerting)
19. `2.6.1` Structured log export (GELF + pluggable backends)
20. `2.7.0` True tenancy and space-scoped APIs
21. `2.8.0` UI refinement sprint
22. `2.8.1` Space creation and member onboarding flow
23. `2.8.2` Admin settings cleanup and baked-in feature flag retirement
24. `2.8.3` Import Review retirement and debug import diagnostics
25. `2.8.4` Scope privacy tightening and explicit support access
26. `2.8.5` Navigation shell cleanup and Integrations surface simplification
27. `2.8.6` Events and Collectibles UX alignment
28. `2.9.0` Assisted capture and barcode completion
29. `2.9.1` Support role and in-app help foundations
30. `2.9.2` Explicit support request, consent, and session approval
31. `2.9.3` Support operations audit trail and queue hardening
32. `2.9.4` Playwright browser regression foundations
33. `2.9.5` Playwright critical flow expansion
34. `2.9.6` Product edition boundary and homelab surface definition
35. `2.9.7` Observability baseline review and alert tuning
36. `2.9.8` Runtime and operations hardening
37. `2.9.9` Observability endpoint control plane
38. `2.10.0` Multi-format ownership model (movies/games)
39. `2.10.1` Library workflow UX polish
40. `2.10.2` Global shell background flattening
41. `2.10.3` Support-session banner normalization
42. `2.10.4` Poster card hover flattening
43. `2.10.5` Poster card action affordance flattening
44. `2.10.6` Add and edit cards search
45. `2.10.7` Shared tab strip flattening
46. `2.10.8` Sidebar ornament reduction
47. `2.10.9` Mobile header copy normalization
48. `2.10.10` Add/edit drawer heading normalization
49. `2.10.11` Modal shell flattening
50. `2.10.12` Shared form label normalization
51. `2.10.13` Shared UI language consolidation
52. `2.10.14` Space-scoped parity for settings, integrations, and activity
53. `2.10.15` Platform SMTP and email delivery foundation
54. `2.10.16` SaaS self-registration and password recovery
55. `2.10.17` Workspace invite and member lifecycle controls
56. `2.11.0` Optional market valuation integrations
57. `3.0.0` Frontend build modernization (CRA to Vite)
58. `3.1.0` Shared Core Extraction and Public Homelab Product Split
59. `3.1.1` Browser-visible regression expansion for shared-core lifecycle flows
60. `3.1.2` Post-split UI cleanup for support, help, and auth shell surfaces
61. `3.1.3` Library controls and selection behavior cleanup
62. `3.1.4` Profile surface and account navigation cleanup
63. `3.1.5` Library detail drawer layout and information hierarchy cleanup
64. `3.1.6` Cross-provider book and comic sync normalization

## 2.1.0 — Metadata Normalization and Query Performance

**Goal:** Replace comma-separated metadata fields with normalized relations for reliable search/filtering at scale.

**Status:** Completed (normalized-read default enabled; compatibility dual-write retained for safe 2.2 transition)

### Scope

- Normalize `genre`, `director`, and actor/cast metadata into relational tables.
- Backfill existing media records and preserve backward-compatible reads during migration window.
- Update filter/search endpoints and indexes for normalized queries.

### Phase Breakdown

- `2.1.0-phase1` (completed):
  - added normalized tables for `genres` / `directors` and join tables (`media_genres`, `media_directors`),
  - backfilled normalized rows from existing `media.genre` / `media.director`,
  - added dual-write sync on create/update/import paths,
  - kept backward-compatible reads via existing fields while extending search/filter to normalized joins.
- `2.1.0-phase2` (completed):
  - expand normalization to actor/cast data model,
  - move text search vector construction to normalized metadata source where practical,
  - add query-performance benchmarks and final cleanup plan for legacy comma fields.
  - progress update:
    - added actor/cast normalization tables (`actors`, `media_actors`) and migration/init parity for actor metadata,
    - added dual-write sync for cast metadata on create/update/import paths,
    - extended search/filter to include actor join lookups plus cast-members text matching,
    - enabled feature flag `metadata_normalized_read_enabled` by default for normalized-first metadata read paths.
    - benchmark evidence captured in `/Users/hamlin/Development/GitHub/hkrewson/collectZ/docs/reports/2.1.0-metadata-query-benchmark.md`.
    - staged cleanup/cutover plan documented in `/Users/hamlin/Development/GitHub/hkrewson/collectZ/docs/wiki/23-Metadata-Normalization-Cutover-Plan.md`.

### Acceptance Criteria

- Search/filter behavior matches existing functionality with improved accuracy/performance.
- Migration/backfill is complete with no data-loss regressions.

## 2.6.0 — Observability Platform (Metrics + Alerting)

**Goal:** Move from log-only triage to measurable system health with alerts.

### Scope

- Add structured metrics export for API/import/auth error rates and queue behavior.
- Add baseline dashboards and alert thresholds.
- Add operator playbook for alert triage and escalation.
- Add API contract and docs surface:
  - maintain `backend/openapi/openapi.yaml` as the source-of-truth contract for key admin/auth/media endpoints,
  - expose `/api/docs` (Swagger UI) as admin-only and gated by both `DEBUG>=1` and feature flag (for example `api_docs_enabled`),
  - add CI validation for OpenAPI schema correctness to prevent contract drift.

### Acceptance Criteria

- Critical regressions are visible via alerts without manual log polling.
- Dashboard coverage includes imports, auth failures, and admin actions.
- API docs are unavailable by default in production mode and only accessible when admin + debug/flag gates are satisfied.
- OpenAPI spec validation runs in CI and fails on invalid or drifted contract definitions.

## 2.6.1 — Structured Log Export (GELF + Pluggable Backends)

**Goal:** Add production-grade external log shipping with a canonical GELF contract, feature-flagged rollout, and operator-selectable backend targets.

### Scope

- Canonical GELF contract:
  - adopt the schema in `docs/wiki/22-Logging-and-Observability-Contract.md`,
  - map current `activity_log` + request audit events into GELF-compliant events with stable extension keys,
  - enforce redaction policy for sensitive fields before emit.
- Feature-flagged enablement:
  - add a backend feature flag for external log export (default off),
  - support safe rollout by environment and runtime toggle without app restart where feasible.
- Explicit runtime configuration surface (current operator path):
  - support env-driven backend selection and endpoint targeting for the current release path,
  - document the required runtime variables for backend type, host, port, service/host labels, and debug tracing,
  - verify that audit/admin/request events written via the shared audit pipeline are also eligible for configured external export.
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
- Supported collector targets can be configured explicitly by env vars and verified against a running stack.
- Graylog ingestion is documented and verified against sample collectZ events.
- ELK/Grafana/syslog alternatives are documented with supported field mappings and caveats.
- CI/runtime checks verify redaction rules and forbid plaintext secret/token fields in exported log payloads.
- Exporter outages do not degrade core API/import behavior.

## 2.7.0 — True Tenancy and Space-Scoped APIs

**Goal:** Restore true user-space separation so memberships, libraries, and data access are enforced through explicit tenancy boundaries and space-scoped APIs.

**Starting point:** Partial scope plumbing already exists (`active_space_id`, `active_library_id`, `library_memberships`, scoped query helpers), but the product still behaves like a mostly single-space system because spaces are not yet first-class resources and the API/UI contract is incomplete.

### Scope

- Space and membership activation:
  - support users belonging to multiple spaces with an explicit active-space context,
  - add personal/default space migration for existing installs,
  - make shared-space membership and role assignment first-class instead of implicit.
- Space-scoped API surface:
  - add dedicated APIs for spaces, memberships, and library management,
  - make media-, collection-, collectible-, event-, and import-facing APIs tenancy-aware by active space or explicit space-scoped route,
  - document the canonical tenancy contract so future clients do not rely on single-space assumptions.
- Data and RBAC enforcement:
  - ensure `space_id` boundaries are enforced consistently across queries, mutations, imports, jobs, and admin actions,
  - keep library management delegated to space admins within their own space,
  - block cross-space leakage in search, imports, dashboards, and background jobs.
- UX and migration:
  - add active-space switching to the UI,
  - make space membership and library context understandable in navigation and settings,
  - preserve a straightforward single-user path for homelab installs that only ever use one personal space.

### Acceptance Criteria

- Users can belong to more than one space and switch active context safely.
- Space-scoped APIs and UI flows prevent cross-space data leakage.
- Space admins can manage members and libraries only within their own space.
- Global server admins can operate the platform without automatically becoming members of every space.
- Existing single-user installs migrate to a personal/default space without manual repair.

### Phase Breakdown

- `2.7.0-phase1` Data model activation:
  - add first-class `spaces` and `space_memberships`,
  - backfill existing installs into a personal/default space model,
  - reconcile legacy multi-user installs so the earliest admin remains the sole `owner` of `Default Space` while each additional legacy user receives an isolated personal space as `owner`,
  - make `libraries.space_id` reference a real space record everywhere instead of acting as a loose grouping field.
- `2.7.0-phase2` Auth and active-scope contract:
  - add explicit active-space selection and bootstrap responses,
  - ensure session, PAT, and service-account auth consistently expose or derive valid scope,
  - limit scope overrides for non-admin users to explicit supported flows.
- `2.7.0-phase3` API activation:
  - add spaces and memberships endpoints,
  - treat app-level `admin` as the global server/super-admin role, distinct from per-space `owner` / `admin` / `member` / `viewer` memberships,
  - restrict new-space creation to the global server/super-admin role,
  - make the first user assigned during space creation the `owner` of that new space,
  - restrict space invite/member management to owners/admins of the target space,
  - add space-scoped invite APIs that carry the intended membership role at claim time,
  - make library lifecycle clearly subordinate to spaces,
  - keep owned-library reassignment tied to explicit cross-space transfer flows rather than ordinary membership edits,
  - prefer transfer-into-new-space as the safest first implementation for moving a user and their owned libraries,
  - harden media/import/events/collectibles/admin queries and jobs against cross-space leakage,
  - prevent ordinary space APIs from treating global/server-admin status as implicit tenant membership.
- `2.7.0-phase4` UI and migration hardening:
  - add active-space switching and membership management UI for actual space participants,
  - keep routine space settings, invite history, membership management, and content visibility limited to users who are members of the active space with appropriate role,
  - resolve live-tested phase-4 boundary issues:
    - member/viewer users must not see or use space-management mutation affordances,
    - active-library selectors must show only libraries the current user can actually access,
    - space members/invites/library context must refresh correctly after space switches without full page reload,
    - scoped invite URLs must preserve host and port correctly in local and reverse-proxy deployments,
    - update flows must never create new spaces as a side effect of editing an existing one,
  - verify migrated installs remain simple for single-user homelab setups,
  - complete browser-level UX verification for switching, invites, membership edits, transfers, and single-space usability.
- `2.7.0-phase5` Server-admin control plane and tenancy regression closeout:
  - add an admin-only platform UI/control plane for global/server-admin tasks:
    - create spaces,
    - assign or recover owners,
    - archive/delete spaces,
    - run support/recovery transfer actions,
  - first implementation slice may safely limit archive/delete to empty spaces until content-archival semantics are defined explicitly,
  - keep global/server-admin authority distinct from tenant membership in both backend policy and UI,
  - keep `Admin > Members` focused on platform user administration rather than tenant invite history or tenant content metrics,
  - expose high-level space metadata to global admins without automatically exposing tenant content, invite history, or routine space settings,
  - define any break-glass support flows as explicit, narrowly scoped, and fully audited,
  - add automated boundary coverage proving global admins can use platform endpoints without automatically gaining tenant roster/invite access,
  - close the tenancy milestone with broader automated tenancy regression coverage and migration rehearsal evidence for cross-space isolation.

### DB/API Checklist

- DB:
  - add `spaces` table:
    - `id`, `name`, `slug` (optional), `description`, `created_by`, `is_personal`, `created_at`, `updated_at`, `archived_at`.
  - add `space_memberships` table:
    - `id`, `space_id`, `user_id`, `role`, `created_by`, `created_at`, `updated_at`.
  - keep `libraries.space_id` required and backed by a real `spaces.id` FK.
  - ensure user state has valid active pointers:
    - `users.active_space_id`
    - `users.active_library_id`
  - backfill/migration rules:
    - create one personal/default space per existing install or per user, according to final migration decision,
    - for legacy single-space multi-user installs, keep the earliest admin as the only default-space owner and isolate each additional legacy user into their own owner-managed space,
    - attach existing libraries and media rows to migrated spaces without data loss,
    - populate memberships so current owners/admins retain access after cutover.
- API:
  - add `GET /api/spaces` for accessible spaces.
  - add `POST /api/spaces` and `PATCH /api/spaces/:id` for authorized creation/update.
  - add `POST /api/spaces/select` for active-space switching.
  - add membership endpoints:
    - `GET /api/spaces/:id/members`
    - `POST /api/spaces/:id/members`
    - `PATCH /api/spaces/:id/members/:memberId`
    - `DELETE /api/spaces/:id/members/:memberId`
  - add space-scoped invite endpoints:
    - `GET /api/spaces/:id/invites`
    - `POST /api/spaces/:id/invites`
    - `PATCH /api/spaces/:id/invites/:inviteId/revoke`
  - clarify library endpoints as space-scoped lifecycle operations:
    - either nested under spaces or explicitly validated against the active space.
  - ensure membership APIs preserve distinct role semantics:
    - global server admin
    - space owner
    - space admin
    - member
    - viewer
  - ensure global server-admin/platform APIs remain distinct from tenant-space management APIs wherever possible.
  - ensure cross-space transfer flows only rehome libraries owned by the transferred user, and only when an explicit transfer flow requests it.
  - add an explicit transfer API for moving a member into a newly created space with their owned libraries.
  - keep media/import/events/collectibles endpoints tenancy-aware by active scope, with explicit admin-only override paths where required.
  - add or refine admin-only platform endpoints for space creation, owner recovery, archival/deletion, and support workflows without implying blanket content access.

### Test Checklist

- Backend:
  - users cannot read or mutate data from spaces they do not belong to,
  - active-space switching updates the effective scope without requiring manual library repair,
  - background jobs and imports stay pinned to the originating space/library scope.
- Migration:
  - migration rehearsal proves single-user installs land in a valid personal/default space,
  - rollback path preserves library/media integrity.
- UI:
  - active-space switcher updates visible libraries and data views consistently,
  - membership and library-management flows are clearly scoped to the selected space,
  - member/viewer users cannot see or use unauthorized space-management mutations,
  - global server-admin UI remains distinct from tenant space UI.
- Regression:
  - existing single-space installs remain easy to use,
  - broader automated tenancy regression coverage should be complete before phase 5 is called done,
  - PAT/service-account/browser-session auth all honor the same space boundary rules.

## 2.2.0 — Import Match Review + Collections Intelligence

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

Historical note:

- The original Import Review queue/UI from `2.2.0` was later retired in `2.8.3`.
- Current operator guidance relies on import audit/export output plus debug-oriented diagnostics and external log export rather than a standalone review queue.

### Acceptance Criteria

- Ambiguous imports no longer auto-apply silently; this was originally handled through the review queue before retirement in `2.8.3`.
- Boxed-set imports can be represented as collection + contained items where data is available.

## 2.3.0 — TV Watch-State and Provider Sync Foundation

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

### Implementation Plan

1. DB foundation:
   - introduce `media_seasons` as source-of-truth for TV season inventory and watch state,
   - backfill existing season rows from legacy `media_variants` season entries.
2. API migration:
   - keep existing `PUT /api/media/:id/tv-seasons` contract for UI compatibility,
   - move implementation to `media_seasons` storage,
   - add explicit season read/update endpoints for watch-state/completeness updates.
3. UI baseline:
   - update TV detail drawer season rendering to consume season state from API output,
   - show completed-state indicator on seasons and series cards when all seasons complete.
4. Provider sync baseline:
   - map Plex season inventory into `media_seasons` (upsert, non-destructive),
   - keep episode-level sync optional/deferred.
5. Validation and hardening:
   - enforce type-safe updates (`watch_state`, episode counters, timestamps),
   - add audit events for season/watch-state mutations.

### DB/API Checklist

- DB:
  - Add `media_seasons` table:
    - `id`, `media_id`, `season_number`,
    - `expected_episodes`, `available_episodes`, `is_complete`,
    - `watch_state` (`unwatched|in_progress|completed`),
    - `watchlist`, `last_watched_at`,
    - `source`, `created_at`, `updated_at`.
  - Constraints:
    - unique `(media_id, season_number)`,
    - `media_id` FK to `media(id)` with cascade delete,
    - non-negative episode counters.
  - Indexes:
    - `(media_id, season_number)`,
    - `(media_id, watch_state)`,
    - optional `(watchlist)` for queue views.
  - Backfill migration:
    - parse season numbers from legacy TV rows in `media_variants` where possible.
- API:
  - Keep: `PUT /api/media/:id/tv-seasons` (compatibility path, now backed by `media_seasons`).
  - Add: `GET /api/media/:id/tv-seasons`.
  - Add: `PATCH /api/media/:id/tv-seasons/:seasonNumber` for watch/completeness updates.
  - Keep `GET /api/media/:id/variants` contract stable for non-TV media.
  - For TV series, variants endpoint may return season rows sourced from `media_seasons` for UI continuity.
- Audit:
  - `media.tv_seasons.update` for list-level season updates.
  - `media.tv_season.update` for per-season watch/completeness changes.

### Test Checklist

- Backend:
  - migration applies cleanly and backfill creates valid season rows,
  - TV season endpoints enforce scope and media type,
  - invalid watch-state and invalid counters are rejected.
- UI:
  - TV detail drawer lists seasons from new source without regressions,
  - completed season shows check icon,
  - series-level completion state appears when all seasons complete.
- Regression:
  - movie/file variants behavior unchanged,
  - Plex import does not duplicate season rows across reruns.

## 2.3.1 — TV Season Drill-Down and TMDB Season Metadata

**Goal:** Add clickable TV season details with TMDB episode metadata while keeping Plex as inventory source-of-truth.

### Scope

- Add season detail API:
  - `GET /api/media/:id/tv-seasons/:seasonNumber` returns local season state plus TMDB season metadata/episodes when available.
- Add TMDB season services:
  - fetch TV show season summary (`episode_count`) for expected episode hydration,
  - fetch per-season episode list (`name`, `episode_number`, `air_date`, `runtime`).
- Add UI season drill-down in TV drawer:
  - `View episodes` toggle per season row,
  - show season metadata and read-only episode list.
- Hydrate `expected_episodes` during Plex TV import from TMDB season summary when TMDB id is known.

### Acceptance Criteria

- Clicking a season in TV drawer reveals episode-level metadata when TMDB data exists.
- Plex imports continue to populate `available_episodes`/season inventory without duplication.
- TMDB season metadata augments but does not overwrite watch-state fields (`watch_state`, `is_complete`, `watchlist`).
- No regression to movie edition rendering or non-TV detail drawers.

## 2.4.0a — Mixed-Media Schema and Validation Hardening

**Goal:** lock down mixed-media correctness so invalid type-specific payloads cannot persist.

### Task Checklist

- [x] Define canonical `type_details` allow-list per media type (`movie`, `tv_series`, `tv_episode`, `book`, `audio`, `game`, `comic_book`).
- [x] Enforce type-details allow-list on create and update payloads.
- [x] Ensure PATCH resolves effective media type from DB when `type_details` is updated without `media_type`.
- [x] Normalize type-details coercion by key (for example `track_count`) and reject incompatible shapes.
- [x] Ensure import paths sanitize/validate type-details using the same canonical rules.
- [x] Add/extend tests for cross-type isolation and invalid type-details key rejection.

### Acceptance Criteria

- Invalid `type_details` keys are rejected with clear validation errors.
- Cross-type field bleed is blocked in create/update/import paths.
- Type-details updates without explicit `media_type` still validate against stored media type.
- Existing valid mixed-media create/edit/import workflows remain functional.

## 2.4.0b — Search/Filter/Sort and Dedupe Quality Tuning

**Goal:** improve large-library query ergonomics and reduce false dedupe outcomes across providers.

### Task Checklist

- [x] Normalize cross-type search semantics for list/card/detail consistency.
- [x] Tighten filter/sort behavior for large mixed-media libraries.
- [x] Tune dedupe fallback precedence and confidence thresholds per provider/media type.
- [x] Improve duplicate-vs-near-match classification and audit export clarity.
- [x] Add collection item add-flow with provider-aware match/update:
  - first search existing library titles of same media type and link existing on confident match,
  - otherwise run provider enrichment (TMDB/IGDB) before create,
  - avoid duplicate creation when near-match already exists by requiring explicit user confirmation.
- [x] Add benchmark evidence for key mixed-media query paths.
- [x] Add regression checks for no manual refresh dependence in filter/sort flows.

### Acceptance Criteria

- Search/filter/sort works consistently across media types in large libraries.
- Dedupe quality improves with measurable reduction in false-positive merges.
- Audit outputs clearly identify dedupe/match decisions.
- Benchmarks and regression checks are green.

## 2.4.1 — Collection Conversion UX Parity (Movies/Games)

**Goal:** complete two-way conversion between individual titles and collections for movie/game workflows.

### Scope

- Add title-side conversion action for `movie` and `game`:
  - in edit modal, add `Convert to Collection` action (preferred over persistent checkbox).
- Keep collection-side conversion action and rename label for clarity:
  - `Convert to Individuals` -> `Convert to Title`.
- Ensure both paths preserve links and avoid orphaned collection rows.
- Apply same behavior to both Movies and Games.

### Acceptance Criteria

- A movie/game title can be converted into a collection from edit UI.
- A movie/game collection can be converted back to title from collection editor.
- Conversion actions are clearly labeled and symmetrical.
- No duplicate records are created during conversion.

## 2.5.0 — Invite/Reset Security and Secret Exfiltration Hardening

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
- External API authentication for automation (non-browser clients):
  - add Personal Access Tokens (PAT) with scoped permissions (`media:read`, `media:write`, `import:run`, `admin:*` as needed),
  - store token hashes only (one-time reveal), with revoke + optional expiry,
  - apply CSRF only to cookie-session browser flows; PAT-authenticated API calls bypass CSRF with scope checks and full audit logging,
  - add optional service-account keys for machine-to-machine use with tighter endpoint/scope constraints.

### Acceptance Criteria

- Invites and password resets support SMTP delivery with auditable lifecycle states.
- No reusable raw invite/reset token material is exposed beyond one-time creation response.
- Browser auth paths do not depend on localStorage/sessionStorage bearer tokens.
- Security checks assert no plaintext credential/token leakage in activity logs and integration responses.
- Existing media/import/admin workflows remain functional after hardening.
- External automation clients can call GET/PUT/PATCH securely via PAT without copying session/CSRF tokens.

## 2.7.1 — Security Maintenance and Dependency PR Triage

**Goal:** Keep the `2.7.x` line safe and shippable by using patch releases for CI-found vulnerabilities, image-security fixes, dependency PR triage, and small secure-review workflow improvements without waiting for later feature milestones.

### Scope

- Treat `2.7.x` as the active maintenance lane for:
  - CI-found dependency and image-security vulnerabilities,
  - patch/minor dependency PR triage,
  - small workflow-permission and release-gate fixes,
  - secure-review/checklist improvements tied to currently shipping code.
- Add a required secure-review checklist for PRs that touch:
  - auth/session/cookie behavior,
  - RBAC and scope enforcement,
  - request validation and parsing,
  - file upload/import surfaces,
  - external fetch/integration code,
  - CI workflow permissions and release automation.
- Define reviewer expectations for obvious-opening checks:
  - missing authorization guards,
  - unsafe input handling,
  - secret exposure in logs or config,
  - SSRF/path traversal/file-type validation issues,
  - dependency/workflow permission changes with elevated blast radius.
- Formalize weekly dependency PR triage using the scheduled dependency-watch artifact plus the current open Dependabot queue.
- Review dependency PRs in three lanes:
  - fast-track security-sensitive updates,
  - batch routine patch/minor maintenance updates,
  - isolate major-version upgrades for dedicated compatibility review and rollout notes.
- Keep dependency triage attached to roadmap/release traceability when an update is deferred for break-risk reasons.
- Explicitly keep this lane patch-focused:
  - no major feature work,
  - no broad architecture rewrites,
  - no semver-major dependency jumps without separate milestone planning.

### Acceptance Criteria

- Sensitive `2.7.x` PRs include an explicit secure-review note before merge.
- Reviewers have one documented place to check for common obvious security openings.
- Open dependency PRs are reviewed on the same weekly cadence as dependency-watch output.
- Security-sensitive dependency and image fixes can ship as `2.7.x` revisions without waiting for `2.8.0+`.
- Major dependency upgrades are no longer mixed into routine maintenance batches without explicit review planning.
- `2.7.x` release notes clearly distinguish:
  - security/vulnerability response,
  - dependency maintenance,
  - CI/release-gate fixes.

## 2.8.0 — UI Refinement Sprint (Cross-Device Consistency)

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
- Treat work already completed opportunistically in earlier milestones as done:
  - this sprint is for remaining cross-device consistency gaps, not for redoing settled UI work.
- Apply targeted visual/interaction adjustments per page and element until review checklist passes.
- Keep this sprint UX-only unless a blocker requires small functional fixes.
- Improve high-friction library management ergonomics:
  - add multi-select support within library views,
  - add a bulk delete action for selected items with clear confirmation and count feedback,
  - keep selection behavior usable on desktop and mobile without creating accidental destructive taps.

### Acceptance Criteria

- Desktop and mobile navigation use one consistent toggle paradigm.
- UI review checklist is completed for each major page section.
- Refinement changes do not introduce regression in auth, media CRUD, imports, or admin flows.
- Users can select multiple library items and perform a confirmed bulk delete from the library UI.
- Shared vs. private user annotations and ratings controls.
- Mobile-optimized barcode scanning UI (camera input with real-time scan feedback).
- Email delivery for invites via SMTP (already stubbed in `env.example`).

## 2.8.1 — Space Creation and Member Onboarding Flow

**Goal:** Restore a straightforward way to add people during tenant creation now that invite issuance is space-scoped, without reintroducing implicit cross-space membership.

### Scope

- Extend the create-space workflow so global admins can add an initial invite schema as part of space creation:
  - collect one or more member invites during the create-space flow,
  - allow role selection per invite within the new space,
  - preserve the first assigned owner semantics from the existing space-creation policy.
- Keep onboarding strictly tenant-scoped:
  - invites created during space creation belong only to the newly created space,
  - no automatic cross-space membership is introduced,
  - global/server-admin authority remains distinct from tenant membership after creation.
- Make the post-create experience clearer for operators:
  - show the newly created invite links or delivery outcomes immediately,
  - keep copy-link and SMTP-backed delivery aligned with the existing invite model,
  - surface validation/errors clearly when invite creation partially fails after the space itself succeeds.
- Ensure the create-space modal and resulting admin UX stay coherent with the current tenancy model:
  - no hidden side effects that add users to unrelated spaces,
  - no downgrade of existing owner/admin role protections,
  - audit space creation plus invite issuance as distinct events.

### Acceptance Criteria

- Global admins can create a new space and prepare its initial invites in the same guided flow.
- Users invited during space creation are scoped only to that new space.
- The first assigned owner and any additional invited roles match the intended tenant membership policy after claim.
- Space creation remains usable even when SMTP is unavailable by preserving copy-link fallback.
- Failures in invite issuance are surfaced without leaving the operator unclear about whether the space itself was created.

## 2.8.2 — Admin Settings Cleanup and Baked-In Feature Flag Retirement

**Goal:** Reduce admin control-plane clutter after the `2.8.0` UI pass by removing permanently enabled rollout flags from operator-facing controls and converting them into normal application behavior or narrower runtime config gates.

### Scope

- Retire no-longer-optional rollout flags from the admin feature-flag interface and feature-flag service where they have become standard product behavior:
  - `import_csv_enabled`,
  - `import_plex_enabled`,
  - `metadata_normalized_read_enabled`,
  - `tmdb_search_enabled`.
- Reclassify operational/runtime-only gates so they are not presented as product feature toggles:
  - move `api_docs_enabled` toward env/debug/runtime configuration rather than admin-visible feature-flag management.
- Remove experiment-era fallback paths once the accepted UI behavior is settled:
  - retire `ui_drawer_edit_experiment`,
  - remove stale frontend env fallback and backend flag plumbing once drawer behavior is considered final.
- Keep admin settings UX aligned with actual operator decisions:
  - visible flags should represent real rollout or operational decisions still worth toggling,
  - permanently-on behavior should not remain in the interface as fake optionality.
- Update roadmap-adjacent docs and env references so they match the post-cleanup control model.

### Acceptance Criteria

- The admin feature-flag screen only shows flags that remain true operator-controlled rollout or operational decisions.
- Permanently enabled import, metadata, and TMDB behavior no longer depends on admin-visible feature-flag toggles.
- API docs availability is controlled by the intended runtime/debug policy rather than a user-facing product toggle.
- Drawer-edit experiment plumbing is removed once the accepted UI path is finalized.
- Env examples and docs no longer describe retired flags as active operator decisions.

## 2.8.3 — Import Review Retirement and Debug Import Diagnostics

**Goal:** Retire the standalone Import Review product surface now that import audit/export paths carry most operator value, while preserving only the debug-oriented diagnostics that still help investigate import quality.

### Scope

- Remove the standalone `Library -> Import Review` surface from product navigation and follow through on UI retirement once the hidden/debug-only path is no longer needed.
- Retire backend queue and resolution plumbing for `import_match_reviews` after the UI has been removed and any remaining operator workflows are confirmed to rely on audit/export instead.
- Preserve useful import diagnostics in a narrower debug/operator form:
  - keep the ability to emit import-quality messages to a debug log/export channel,
  - expose that behavior through the appropriate operator surface if it remains useful (likely Settings or Integrations rather than Library navigation),
  - avoid restoring a full operator-facing review queue unless new evidence shows it is needed.
- Update docs and roadmap references so Import Review is no longer presented as an active product workflow once retirement is complete.

### Acceptance Criteria

- The product navigation no longer presents Import Review as a normal library workflow.
- Any remaining import diagnostics are explicitly debug/operator oriented and not framed as a mainstream end-user page.
- Backend `import_match_reviews` queueing, endpoints, transfer logic, and schema are removed once the replacement diagnostics path is confirmed.
- Import audit/export output still provides the operator signals needed to understand ambiguous or low-confidence import behavior.
- Docs and milestone notes align with the retired-product-surface decision.

## 2.8.4 — Scope Privacy Tightening and Explicit Support Access

**Goal:** Remove casual cross-space context switching from everyday navigation so tenancy privacy stays clear, while reserving any cross-space access for explicit, auditable support workflows only.

### Scope

- Remove normal active-space switching from the sidebar and other routine end-user/operator navigation surfaces.
- Keep active-library switching only where it remains valid within the current active space:
  - show the library switcher only when multiple libraries exist in the current space,
  - avoid presenting library scope controls when there is nothing meaningful to switch.
- Tighten the tenancy UX contract for global admins:
  - global admin authority should remain platform-scoped,
  - global admins should not casually enter tenant context through the normal navigation model,
  - routine platform administration (`All Spaces`, `All Members`, owner recovery, password reset) must remain possible without ordinary cross-space browsing.
- Define any cross-space troubleshooting as an explicit support action rather than a passive selector:
  - `Assume Space`, `Support Session`, `Act As User`, or equivalent named workflow,
  - require intentional entry rather than background scope switching,
  - treat the support path as a separate audited capability rather than a normal product control.
- Add strong audit/log coverage for any explicit support-access workflow:
  - who initiated it,
  - target user/space,
  - when it started and ended,
  - why it was invoked where possible.
- Update docs and UX copy so the product no longer suggests that ordinary space switching is part of the daily admin model once this privacy-tightening pass is complete.

### Acceptance Criteria

- Normal sidebar navigation no longer exposes active-space switching.
- Active-library switching is shown only when it is valid and useful within the current active space.
- Global admins can still perform platform recovery/owner-management tasks without joining or casually browsing tenant spaces.
- Any cross-space support capability is explicit, separately named, and fully audited.
- Tenancy/privacy documentation and UI language align with the explicit-support-access model rather than everyday cross-space switching.

## 2.8.5 — Navigation Shell Cleanup and Integrations Surface Simplification

**Goal:** Finish the shell/navigation cleanup that `2.8.4` sets up by removing stale scope cards from the sidebar, moving remaining integration-related controls into Integrations, and aligning Integrations UX with the newer scan-first settings patterns.

### Scope

- Remove the active space / active library card from the main sidebar shell once everyday space switching is no longer part of the product model.
- Move integration-adjacent operational toggles into Integrations:
  - `external log export`
  - `metrics export`
- Simplify Integrations UI treatment:
  - replace the older vertical-tab treatment with the same horizontal tab style used in the current settings work,
  - mute the heavier card framing,
  - reduce visual duplication between “settings” and “integration detail” surfaces.
- Keep operator semantics clear:
  - integration config stays in Integrations,
  - general settings stay in Settings,
  - runtime/observability toggles tied to integration backends no longer feel arbitrarily split across pages.

### Acceptance Criteria

- The sidebar no longer uses the old active scope card pattern.
- Integrations contains the remaining integration-owned operational toggles.
- Integrations uses the simpler horizontal-tab language established in the newer admin/settings surfaces.
- The resulting UI is visually lighter and no longer depends on stacked card shells to communicate hierarchy.

## 2.8.6 — Events and Collectibles UX Alignment

**Goal:** Round out Events and Collectibles so they feel like first-class parts of the product shell rather than earlier feature islands with slightly different UX language.

### Scope

- Audit Events and Collectibles flows for inconsistencies against the refined library/settings patterns shipped through `2.8.x`.
- Improve list, detail, filter, and action treatments where they still feel visually or behaviorally out of step with the rest of the app.
- Tighten copy, empty states, and action placement so these surfaces feel more intentional and easier to learn.
- Preserve current data models and capabilities; this is a UX/product-fit pass rather than a taxonomy or schema expansion milestone.

### Acceptance Criteria

- Events and Collectibles feel visually consistent with the rest of the application shell.
- Common actions and filters are easier to scan and understand.
- Any data-model changes remain small and directly tied to making Events and Collectibles behave like first-class library objects rather than separate feature islands.

## 2.9.0 — Assisted Capture and Barcode Completion

**Goal:** Complete the product promise behind barcode-assisted entry by validating the current provider flow and adding camera-assisted capture plus direct image attachment for manual entry.

### Why this is a minor version

- This milestone adds a net-new capture workflow rather than only polishing an existing screen.
- Camera-assisted barcode / cover capture expands the product’s input model in a user-visible way, which fits the repo’s `MINOR` guidance better than another `PATCH` refinement.

### Scope

- Verify and harden the existing barcode flow end to end:
  - confirm provider behavior still works as intended,
  - identify any rough edges in diagnostics, result handling, or fallback UX,
  - finish the remaining UX promises around that capability instead of leaving it as an “early add-on.”
- Add manual-entry camera options where they are product-appropriate:
  - use a device camera to capture barcodes during manual entry,
  - use a device camera to capture cover/front-art images during manual entry so images can be attached directly,
  - make the capture flow degrade gracefully on devices/browsers without camera support.
- Keep the debug/operator path intact:
  - barcode failures should remain diagnosable,
  - capture should not become an opaque black box when providers or browser permissions fail.

### Acceptance Criteria

- Barcode-assisted entry paths are explicitly revalidated and any high-friction gaps are resolved.
- Manual entry can invoke a device camera for barcode capture and direct cover-art capture where supported.
- Camera permissions and provider failures degrade gracefully with understandable fallback messaging.
- The feature feels like a completed capture workflow rather than an unfinished experimental promise.

## 2.9.1 — Support Role and In-App Help Foundations

**Goal:** Establish the first-class support actor model and a lightweight in-app help surface before support access becomes request-driven and consent-gated.

### Why this is a minor version

- This milestone adds a net-new product surface for help/chat and a distinct platform support role rather than only refining existing admin flows.
- It introduces a new user-visible support model that changes who can participate in support operations and how help is initiated.

### Scope

- Add an in-app help entrypoint that can evolve beyond static docs:
  - contextual help suggestions,
  - curated help articles,
  - lightweight recent release notes so users can see what changed without leaving the app,
  - a tabbed help-center shell such as `Guidance`, `Releases`, and `Support`,
  - clear escalation path when self-serve guidance is insufficient.
- Introduce a first-class `support_admin` role:
  - signs into the platform control plane rather than tenant space UX,
  - can work in support/help surfaces,
  - cannot browse tenant data by default,
  - cannot perform broader platform-governance actions reserved for full `admin`.
- Keep support and platform authority clearly separated:
  - `admin` remains the full platform operator / break-glass role,
  - `support_admin` is for responding to support questions and later approved support sessions.
- Define the support/help surface foundations needed for the next consent milestone:
  - support inbox or queue placeholder,
  - basic request states,
  - user-facing entrypoint to ask for help without immediately granting tenant access,
  - support threads that can feel conversational/live through lightweight refresh and chat-style layout before true realtime infrastructure exists.
- Add lightweight support-ops triage inside the help surface:
  - merge the support inbox into a single `Help Admin` experience for support staff,
  - classify requests as support, bug, or feature request,
  - allow internal notes that remain staff-only,
  - show lightweight queue badges/counts in navigation and support summaries,
  - make it possible to record linked repo issue references manually before any automatic repo sync exists.

### Acceptance Criteria

- The app exposes an in-app help surface with useful guidance and a clear escalation path.
- The help surface can show lightweight recent release context without requiring users to leave the app.
- `support_admin` exists as a distinct role with narrower powers than `admin`.
- Support staff can answer/support through the help surface without ambient tenant browsing.
- Support staff can classify and annotate requests without exposing internal notes to the requester.
- No support-session consent or tenant-access automation is assumed yet; this milestone only lays the actor and surface foundations.

## 2.9.2 — Explicit Support Request, Consent, and Session Approval

**Goal:** Move support access from admin-initiated break-glass behavior toward a request-driven, explicitly approved workflow tied to user consent and clear audit context.

### Scope

- Add explicit support request creation and tracking:
  - user or tenant admin can ask for help,
  - request captures target space/context, issue summary, and timestamps,
  - support staff can respond without immediately entering tenant context.
- Add approval/consent workflow for support access:
  - support session starts should be linked to a request,
  - support-session approval should be explicit and auditable,
  - consent state should be clear before support staff enter tenant context.
- Limit `support_admin` tenant access to approved requests:
  - no freehand support session starts,
  - approved support sessions should name the requester, target space, reason, and approval chain.
- Preserve a distinct break-glass path for full `admin` only if still needed:
  - keep it rarer, clearly labeled, and more heavily audited than ordinary support flows.

### Acceptance Criteria

- Support requests can be created and tracked without immediately granting tenant access.
- `support_admin` can only start tenant support sessions when an approved request exists.
- Support-session audit records include requester, approver/consent state, target space, reason, and start/end timing.
- The product no longer treats support access as an arbitrary operator action for non-admin support staff.

## 2.9.3 — Support Operations Audit Trail and Queue Hardening

**Goal:** Harden the operational side of the support workflow so support queues, transcripts/history, approvals, and session evidence remain understandable and safe in longer-lived deployments.

### Scope

- Strengthen support queue/history behavior:
  - request state transitions,
  - queue filtering/search,
  - stale/expired request handling,
  - clearer operator views for active vs completed support work.
- Improve auditability and evidence:
  - richer support request and support session event trails,
  - transcript/history retention decisions where chat exists,
  - revocation/expiry of stale approvals or dormant support access.
- Tighten support operations UX:
  - cleaner linking between help conversations, support requests, approvals, and active sessions,
  - reduce ambiguity about which request authorized which support session.
- Add repo-linked operational tracking where it proves useful:
  - support requests can create or link tracked engineering work,
  - tracked bug/feature status can sync from the repo instead of relying on manual updates alone,
  - shipped fixes/features can notify the original requester with clear release/version context.
- Keep privacy boundaries intact:
  - support history should not become a loophole for passive tenant browsing,
  - approvals and session evidence should remain explicit and bounded.

### Acceptance Criteria

- Support request and session history is easier to audit and operate over time.
- Approval state, session linkage, and operational status are visible without ambiguity.
- Expired or stale support approvals do not silently remain valid.
- The support workflow remains privacy-preserving while becoming more operationally durable.

## 2.9.4 — Playwright Browser Regression Foundations

**Goal:** Add a first-class browser regression layer so the repo stops relying almost entirely on backend/API assertions for user-visible workflow confidence.

### Why this is a patch version

- This milestone adds a new verification layer and test harness rather than changing the shipped product model directly.
- It improves engineering confidence and release safety without introducing a net-new end-user capability on its own.

### Scope

- Add Playwright to the repo as a supported browser-regression toolchain.
- Establish stable local/CI execution patterns:
  - deterministic app boot,
  - authenticated admin session setup,
  - seeded test users where needed,
  - artifact capture for screenshots/videos/traces on failure.
- Add screenshot-friendly browser ergonomics for support/help usage:
  - named capture-mode runs distinct from failure artifacts,
  - stable visual fixture seeding for selected support/admin surfaces,
  - intentional screenshot outputs that can be reused for support-reference or docs drafting,
  - a separate screenshot-capture workflow so support/docs visuals do not have to ride on the blocking regression gate.
- Cover the highest-value browser flows that are currently only inferred through API tests:
  - login/logout,
  - admin bootstrap and shell load,
  - end-user Help Center support interactions,
  - Help Admin support workspace interactions,
  - approved support-request session start/end, support-library switching, and temporary `Workspace` access for support admins,
  - support-session start/end banner behavior,
  - `All Workspaces` drawer tab switching,
  - Integrations tab switching and save feedback,
  - docs surface availability behavior when authenticated admin + debug gating are satisfied.
- Keep the current backend/API/release gates in place; Playwright complements them rather than replacing them.

### Acceptance Criteria

- The repo includes a runnable Playwright harness with documented local and CI invocation.
- Browser regressions cover the most important auth/admin shell flows already shipped in `2.8.x`.
- Failure output is useful enough for triage (trace/screenshot/video or equivalent artifacts).
- The repo can intentionally generate stable named screenshots for selected support/admin surfaces without mixing auth bootstrap state into uploaded failure artifacts.
- The repo can generate reusable named support/docs screenshots through a dedicated manual-friendly workflow instead of coupling them to the blocking regression job.
- The release process can point to a browser-regression layer instead of only backend/API evidence for those flows.

## 2.9.5 — Playwright Critical Flow Expansion

**Goal:** Expand the new browser-regression layer so the most fragile, multi-step product workflows have realistic UI coverage before the frontend build-system migration.

### Scope

- Add Playwright coverage for higher-value multi-step flows across the current product surface:
  - Integrations save/update flows for supported providers,
    - first slice: Barcode and Games settings save/persist across reload,
    - first slice: Metrics feature-flag toggle persists across reload,
    - first slice: focused visual-regression snapshot for the Integrations section-tab strip,
    - first slice: route-driven admin integration deep links must honor `?integration=` for supported sections including `metrics` and `logs`,
  - import/manual-entry flows that do not require future camera support yet,
    - second slice: barcode-driven Import Media flow with deterministic UPC lookup stubbing,
    - second slice: real browser add-to-library path verified through the live app and library UI search,
    - second slice: import browser cleanup must restore test-created media so the suite stays reusable,
    - fifth slice: generic CSV upload through the real Import Media browser UI,
    - fifth slice: deterministic polling of the queued import job to completion before library verification,
    - fifth slice: imported CSV title confirmed through the live library search surface with cleanup of seeded media after the run,
  - Events and Collectibles navigation and common actions after their UX-alignment pass,
    - fourth slice: end-user browser flow for creating an event, linking a collectible to that event, and verifying the relationship through the collectibles detail surface,
    - fourth slice: test setup explicitly enables and later restores the Events and Collectibles feature flags so browser evidence does not depend on ambient admin state,
    - fourth slice: authenticated cleanup removes test-created events and collectibles so the suite stays reusable,
  - negative-path assertions for admin/privacy boundaries where UI state matters.
    - third slice: support-admin browser boundary coverage for redirect-back-to-help behavior on disallowed tenant-library and admin routes, plus sidebar surface limits,
    - third slice: standard-user direct-route denial for admin surfaces,
    - third slice: keep these as browser-visible shell checks rather than only backend permission assertions.
- Add a small visual-regression subset where browser layout drift has been a real source of polish churn:
  - support-session banner,
  - Integrations tabs/layout,
  - selected key admin drawers or tabbed panes.
- Add maintainability ergonomics around the browser suite:
  - light page/workspace helpers for repeated flows,
  - a stable capture catalog for documentation/support visuals,
  - keep seeded fixtures deterministic enough that UI evidence remains reusable over time.
- Keep the suite intentionally small and stable:
  - avoid trying to test every backend rule through the browser,
  - reserve low-level logic for unit tests and policy/regression scripts.

### Acceptance Criteria

- Critical admin and library UI flows have browser-level regression coverage.
- The Playwright layer catches real UI breakage that current backend/API tests would miss.
- Visual/layout checks are focused and maintainable rather than sprawling snapshot noise.
- The repo is in a much better position to migrate from CRA to Vite without losing browser confidence.

## 2.9.6 — Product Edition Boundary and Homelab Surface Definition

**Goal:** Introduce an explicit `platform` vs `homelab` product-edition boundary inside the private repo so tenancy/platform capabilities stop leaking into the future homelab product shape before any repo split happens.

### Scope

- Add one authoritative edition contract shared by backend and frontend:
  - supported values: `platform`, `homelab`,
  - backend remains the source of truth for the active edition,
  - frontend shell/bootstrap reads the server-owned edition instead of relying on client-only env.
- Frontend shell composition boundary:
  - introduce shell-level control over nav groups, allowed routes, and mounted page surfaces,
  - keep the current tenancy/global admin surface as the `platform` shell,
  - define a `homelab` shell that excludes tenancy/global-management UI rather than merely hiding buttons late in the render tree,
  - define the homelab Help surface as a shared `Help` experience that exposes `Guidance` and `Releases` for all users,
  - do not mount `Metrics` or `Support` Help sections in `homelab` for either normal users or admins,
  - do not expose homelab shell routes or nav affordances for `All Workspaces`, `All Members`, `Activity`, or `Workspace`.
- Backend route-mounting boundary:
  - separate shared/common routes from platform-only route groups,
  - do not mount platform-only APIs in `homelab`,
  - keep auth/session bootstrap common where possible while removing platform assumptions from the homelab-mounted surface,
  - keep shared release/help-safe endpoints such as `/api/support/releases` mounted in `homelab` while unmounting platform-only support case-management endpoints.
- Homelab product-shape rules:
  - target one local admin with optional viewer/read-only users,
  - no normal active-space switching,
  - no space creation/assignment UI,
  - no tenant roster/invite model in the homelab UX,
  - keep library switching only when it remains meaningful inside the single homelab context.
- Data/model transition policy:
  - do not fork the schema yet,
  - allow homelab to continue operating on a single personal/default space internally during the transition,
  - treat that internal scope compatibility as implementation detail rather than surfaced product language.
- Testing and verification:
  - add regression coverage proving `homelab` cannot mount or navigate to tenancy/global routes,
  - add browser-level regression coverage proving `homelab` Help only mounts `Guidance` and `Releases`, and never mounts `Metrics`, `Support`, or `Help Admin`,
  - add browser-level regression coverage proving shared homelab workflows remain valid for `auth`, `library`, `import`, `profile`, and homelab-safe admin `settings` and `integrations`,
  - verify `platform` retains current tenancy/global behaviors,
  - keep shared workflows green in both editions (`auth`, `library`, `import`, `profile`, valid settings/integrations surfaces, edition-safe Help surfaces),
  - use the Playwright coverage added in `2.9.4` and `2.9.5` as the primary browser-level proof layer for edition shell and route boundaries rather than relying only on backend/API checks.

### Acceptance Criteria

- `homelab` edition does not mount tenancy/global platform pages or APIs.
- `homelab` still serves shared release/help-safe data, but platform-only support case/staff APIs, docs, metrics, spaces, and platform admin control-plane APIs are unmounted.
- `homelab` also unmounts platform-only auth support-session controls, while `platform` retains those explicit support-session auth endpoints.
- `homelab` Help exposes `Guidance` and `Releases` only, and does not mount `Metrics`, `Support`, or `Help Admin` for any role.
- `homelab` shell and direct-route handling do not expose or retain platform control-plane tabs such as `admin-spaces`, `admin-users`, `admin-activity`, or `space-manage`.
- `homelab` shared auth, scope, and library APIs preserve library context but do not surface the internal default-space model to the client: `active_space_id` is null and `spaces` is empty while valid `active_library_id` and library lists remain available.
- `homelab` still allows meaningful library creation and selection inside the single homelab context while keeping the internal default space hidden from the client contract.
- `homelab` registration no longer depends on the platform invite-token model after the first admin; additional local accounts can register without a tenant invite flow.
- `homelab` does not accept generic authenticated space switching through shared scope APIs; the hidden internal default space remains implementation detail rather than selectable client state.
- `platform` edition preserves the full current tenancy/global control plane.
- Edition branching is concentrated in shell/bootstrap/route-mount boundaries rather than scattered across unrelated components.
- Shared workflows continue to function in both editions without scope confusion.
- `homelab` has a repeatable runtime smoke gate that proves the shared mounted surfaces (`auth`, `profile`, `library`, `settings`, `integrations`, `feature flags`, `Help > Releases`) and the unmounted platform-only APIs (`support requests`, `docs`, `metrics`, `spaces`, `admin spaces`) against a live homelab stack even when browser execution is temporarily unavailable.
- `platform` has a repeatable runtime smoke gate that proves the retained control plane still mounts invite-based registration, spaces/libraries context, support queues, and admin user/space management APIs.
- The codebase is ready for a later repo split without first having to rediscover product boundaries.

## 2.9.7 — Capture Workflow Catch-Up and Unified Tabbed Editors

**Status:** Completed on `2026-04-05`

**Goal:** Close the real deployment-domain capture gaps left behind by the earlier barcode milestone and reshape add/edit into a single tabbed editor model that can adapt cleanly across media, events, and collectibles.

### Scope

- Finish the real product promise behind capture-assisted entry:
  - verify camera-assisted barcode capture on the deployed HTTPS domain instead of relying only on local assumptions,
  - distinguish clearly between camera access, frame capture, decode support, and decode failure,
  - add a more capable fallback decode path when the browser can access the camera but does not expose a reliable native `BarcodeDetector`,
  - keep manual UPC entry and still-photo fallback as first-class escape hatches instead of vague failure states.
- Replace the current long conditional add/edit forms with one stepped, tabbed editor pattern:
  - a shared shell/header/tabs/actions treatment for add and edit,
  - a consistent poster/cover rail and primary action row,
  - tab definitions that adapt by object type rather than forking whole editors,
  - one shared tab primitive so Help, admin surfaces, drawers, and future tabbed workflows do not drift into competing styles.
- Standardize the tab model around a predictable structure:
  - `Core Details` for all object types,
  - a type-specific second tab only when the object actually has a meaningful second cluster,
  - `Signatures` only for object types that truly persist signed-object metadata,
  - `Storage & Notes` as the shared closing tab.
- Apply the model across the current object families with the right per-type fit:
  - Movies and TV: `Core Details`, `Cast & Crew`, `Signatures`, `Storage & Notes`,
  - Books: decide whether author/publisher belongs in `Core Details` or a type-specific second tab, but keep one unified editor shell,
  - Audio/Games/Comic Books: keep the same shell while omitting unnecessary tabs when the data does not justify them,
  - Events: use the second tab for sub-events/artifacts such as panels, parties, and signings rather than forcing a signatures tab onto the event container itself,
  - Collectibles: stay on the shared shell but keep the tab count lean unless a second cluster is justified by the actual fields.
- Refine the large-screen entry drawer composition so the unified shell feels intentionally designed instead of merely expanded:
  - remove repeated active-step storytelling beneath the top step rail,
  - tighten field spans and max widths so short metadata fields do not stretch across wide canvases,
  - reduce cover-rail dominance where it visually outweighs the primary title and identifier work,
  - keep per-type layouts visually balanced while preserving the shared drawer structure.
- Keep Import and Library add/edit surfaces aligned where they share capture and lookup affordances.
- Add verification that proves both the new editor shell and the capture behavior on the real supported browser paths.

### Acceptance Criteria

- The deployed HTTPS/domain environment can distinguish between camera permission success and barcode decode support/failure without misleading fallback messaging.
- Live barcode capture works in the target supported browser paths, or falls back through a documented and intentional decode/manual path rather than an opaque unsupported message.
- Add and edit use one coherent tabbed editor pattern instead of separate ad hoc conditional forms.
- Object types only show tabs that correspond to real persisted data for that type.
- Events treat signings as sub-events/artifacts rather than event-level signature metadata.
- The new editor shell is documented and regression coverage is updated for the revised capture and add/edit flows.

### Closeout Notes

- The milestone finished with one shared tab/disclosure language across media, events, collectibles, help, and key admin workflows rather than per-surface tab drift.
- Help Guidance now uses inline one-open-at-a-time disclosure rows so end-user and support-admin guidance can grow without falling back to rounded card grids or long always-open text walls.
- Shared tab controls now distinguish between:
  - true tabs with keyboard and panel semantics, and
  - visually aligned filter/mode rows that intentionally keep button semantics.

### Follow-Up

- Accessibility/deep-linking follow-up for a later milestone:
  - add URL-synced state for expanded guidance rows and for active tabs where deep-linking provides real user value.

## 2.9.8 — Runtime and Operations Hardening

**Status:** Completed on `2026-04-05`

**Goal:** Harden the real-world operator paths added in `2.6.0` and `2.6.1` so logging, metrics, and supporting runtime surfaces are safer to run and easier to recover in longer-lived deployments.

### Scope

- Structured-log stack hardening:
  - revisit Graylog, Loki/Promtail, and syslog example stacks with production-leaning guidance for auth, network boundaries, persistence, and safer defaults,
  - document which parts remain local/dev examples versus recommended long-lived operator configurations,
  - add drift checks or troubleshooting guidance for exporter/runtime mismatches such as `backend_off`, wrong collector host, or stale backend env.
- Metrics and observability runtime hardening:
  - formalize retention and backup guidance for Prometheus data and any logging persistence volumes,
  - tighten admin/debug-gated observability surfaces with explicit operator guidance for exposure boundaries and reverse-proxy expectations,
  - ensure observability examples document restore and rotation implications for tokens, passwords, and collector state.
- Runtime separation and noise reduction:
  - reduce mixing between general request logs and structured export output where practical,
  - add guidance or implementation support for cleaner stream separation in collectors that benefit from it,
  - document expected failure behavior clearly so exporters never become a hidden availability dependency.
- Operational verification:
  - add repeatable smoke checks for supported collector paths,
  - make sure hardening guidance is reflected in docs, example compose files, and verification notes together,
  - formalize observability rehearsals as release evidence first:
    - collector-path evidence,
    - non-blocking failure evidence,
    - persistence/recreate evidence,
  - prefer release-checklist artifacts and documented operator proof over making every observability rehearsal a blocking every-PR CI gate,
  - leave promotion of selected rehearsals into nightly or release-only CI workflows as a later follow-up once the evidence shape stabilizes.

### Acceptance Criteria

- Graylog, Loki/Promtail, and syslog operator docs clearly distinguish local examples from hardened deployment guidance.
- Retention, persistence, and backup expectations for observability/logging data are documented and validated.
- Exporter misconfiguration and env drift have documented fast-diagnosis paths and, where reasonable, lightweight runtime validation.
- Logging/metrics hardening changes do not break core API/import behavior or make collector availability a runtime dependency.
- Release-shaped closeout can capture observability rehearsal evidence in a repeatable artifact path without requiring every rehearsal to run as a blocking PR gate.

## 2.9.9 — Observability Endpoint Control Plane

**Goal:** Move external log endpoint selection from env-only operator setup to an admin-managed control plane without weakening the existing fail-safe runtime behavior.

**Status:** Completed on `2026-04-06`

### Scope

- Admin-managed external log endpoint configuration:
  - add admin UI and backend settings storage for external log endpoint host/url, port, transport/backend type, and service/host labeling fields,
  - keep secrets/tokens masked and encrypted at rest where applicable,
  - preserve an env-backed override/read-only mode for locked-down deployments.
- Output style and backend selection:
  - expose supported exporter targets and output styles in the UI (for example GELF UDP/TCP, stdout JSON, syslog UDP/TCP),
  - document which combinations are first-class/supported versus advanced/operator-beware.
- Validation and diagnostics:
  - add a test/validate action that emits a deterministic audit/export event and reports whether the configured collector received it,
  - surface last validation outcome and troubleshooting guidance for common misconfigurations,
  - ensure admin/audit events written through the shared audit path remain eligible for configured external export.
- Safety and docs:
  - document precedence between env overrides and UI-managed settings,
  - update operator docs, runbooks, and smoke paths to cover both env-only and UI-managed configurations.

### Acceptance Criteria

- Admin can configure a supported external log endpoint without editing compose env for the common case.
- Validation/test flow confirms exporter configuration against a live collector path.
- Env override behavior is explicit and documented for operators who want immutable config.
- External logging configuration changes are auditable, masked, and do not make collector availability a hard runtime dependency.

## 2.10.0 — Multi-Format Ownership Model (Movies/Games)

**Goal:** support owning multiple formats of the same title without fragmenting the library record.

**Status:** Completed on `2026-04-06`

### Scope

- Replace single-format-only editing UX with format toggles:
  - `DVD`, `VHS`, `Blu-ray`, `4K UHD`, `Digital`.
- Persist owned formats as a multi-value field (`owned_formats`) while preserving backward compatibility.
- Keep `media.format` as a derived primary display value for compatibility.
- Primary format derivation rule:
  - choose highest quality/resolution selected (for example `4K UHD` > `Blu-ray` > `DVD` > `VHS`; `Digital` maps to source quality where known).
- Use badge-style toggles in add/edit modal:
  - selected: theme blue,
  - unselected: muted gray.

### Acceptance Criteria

- Users can save multiple owned formats on one title.
- Legacy views and existing filters continue to work with derived primary format.
- Format toggles are available for movie/game add/edit paths.
- Imports can map multi-format titles without creating duplicate records solely for format differences.

## 2.10.1 — Library Workflow UX Polish

**Goal:** finish the near-term import and title-selection UI/UX cleanup before any `3.0.0` build modernization work begins.

### Scope

- Import workflow UI pass:
  - review `Admin > Import` and related import tabs with [`$uncodixfy`](/Users/hamlin/.codex/skills/uncodixfy/SKILL.md) and [`$build-web-apps:web-design-guidelines`](/Users/hamlin/.codex/plugins/cache/openai-curated/build-web-apps/f78e3ad49297672a905eb7afb6aa0cef34edc79e/skills/web-design-guidelines/SKILL.md),
  - simplify any remaining AI-shaped layouts, stacked card framing, or redundant explanatory copy,
  - tighten tab hierarchy, selection states, and scan/import affordances so the flow reads like the rest of the product.
- Title-selection and result-picking pass:
  - review title selection surfaces introduced or affected by multi-format work,
  - refine result-card interaction patterns, editing affordances, and item selection states so they are stable, obvious, and consistent across library and import flows,
  - remove any lingering brittle hover-only or overlay-heavy interaction assumptions where a simpler action pattern would serve better.
- Milestone boundary:
  - complete these two UI/UX passes before starting `3.0.0 — Frontend Build Modernization (CRA to Vite)`.

### Acceptance Criteria

- Import tabs and related workflow surfaces feel aligned with the rest of the current admin/library UI instead of reading like a one-off flow.
- Title selection and result-picking affordances are visually clear, stable in browser automation, and do not depend on fragile overlay/hover behavior for primary actions.
- The repo has a documented pre-`3.0.0` checkpoint for these UX passes so build-tool modernization does not absorb or skip them.

## 2.10.2 — Global Shell Background Flattening

**Goal:** remove the remaining premium-SaaS background wash so the product shell depends on layout and typography rather than decorative gradients.

### Scope

- Remove or substantially reduce the global radial blue gradients defined in `frontend/src/index.css`.
- Rebalance dark and light theme body backgrounds toward flatter, calmer surfaces.
- Keep contrast, readability, and existing shell hierarchy intact without replacing the gradients with new decorative effects.

### Acceptance Criteria

- App backgrounds no longer read as a branded gradient stage set.
- Core library/admin/import screens feel calmer without losing legibility or orientation.
- Theme variants stay visually consistent after the background flattening.

## 2.10.3 — Support-Session Banner Normalization

**Goal:** keep support-session status obvious without the current high-drama amber control-plane banner treatment.

### Scope

- Flatten the active support-session banner in `frontend/src/App.jsx`.
- Remove gradient banding, inset glow, and other alert-strip theatrics.
- Simplify uppercase micro-labels and narrated copy into plain status language.
- Preserve the key functional signals:
  - support session active,
  - current space/library context,
  - started timestamp,
  - session exit path.

### Acceptance Criteria

- Support-session state is still unmistakable.
- The banner reads like normal product chrome rather than an emergency operations strip.
- The copy is shorter and plainer without losing support-task clarity.

## 2.10.4 — Poster Card Hover Flattening

**Goal:** reduce the remaining AI-heavy poster-card hover theatrics across library-style surfaces.

### Scope

- Flatten poster-card hover behavior in `frontend/src/components/app/AppPrimitives.jsx`.
- Remove or reduce image zoom, fade-overlay drama, and overemphasized shadow treatment.
- Keep poster cards interactive and readable without switching into a “special mode” on hover.

### Acceptance Criteria

- Poster cards feel calmer and more durable in normal browsing.
- Hover states still provide useful affordance without theatrical motion or layered effects.
- Shared poster-card changes remain consistent across all surfaces that consume the primitive.

## 2.10.5 — Poster Card Action Affordance Flattening

**Goal:** replace hover-revealed showcase-style action trays with simpler, steadier card actions.

### Scope

- Rework the bottom action bar behavior in `frontend/src/components/app/AppPrimitives.jsx`.
- Remove `translate-y`/opacity-reveal theatrics and blur-backed floating action buttons where possible.
- Choose a more durable action pattern for edit/delete/secondary card actions that does not depend on dramatic hover-only reveal behavior.

### Acceptance Criteria

- Card actions are easier to discover and less theatrical.
- Primary card interactions do not depend on showcase-style hover transitions.
- Shared action treatment remains compact and consistent across card consumers.

## 2.10.6 — Add and Edit Cards Search

### BUG FIX

- Bug: the Add and Edit drawer lookup button currently requires a barcode even though the flattened drawer UI now implies one universal search action based on any available identifying data.

### Requires Skills

- This work requires the use of [$build-web-apps:web-design-guidelines](/Users/hamlin/.codex/plugins/cache/openai-curated/build-web-apps/f78e3ad49297672a905eb7afb6aa0cef34edc79e/skills/web-design-guidelines/SKILL.md)
- This work requires the use of [$uncodixfy](/Users/hamlin/.codex/skills/uncodixfy/SKILL.md)
- [$build-web-apps:frontend-skill](/Users/hamlin/.codex/plugins/cache/openai-curated/build-web-apps/f78e3ad49297672a905eb7afb6aa0cef34edc79e/skills/frontend-skill/SKILL.md) may be employed to further assist as needed.

**Goal:** The lookup button should be universal. When clicked, it should use the available information entered to search the relevant API. The icon should be removed since it evokes a barcode only solution.

### Implementation Order

- Slice 1: make the drawer lookup control universal, remove barcode-only iconography, and route single-source requests correctly for title-only and identifier-only searches.
- Slice 2: when title and identifier both exist, run both relevant lookups, normalize the results into one picker, and compare/combine where practical.
- Slice 3: when dual-source results differ and the user chooses the identifier match, perform the follow-up provider-default title lookup needed to complete enrichment.

### Scope
- For Movies and TV when title exists, lookup should default to a search of TMDB API
- For Movies and TV when UPC | Barcode exists, lookup should default to a search of upcitemdb API
- For Movies and TV when UPC & Title exists, both API endpoints should be eligible and their results can be compared and combined.
- For Movies and TV when UPC & Title exist and lookups differ, both results should be presented for the user to select. If the UPC results are selected, a new search of TMDB API should be performed to gather new metadata.
- For Audio when title exists, lookup should default to Discogs API
- For Audio when UPC exists, lookup should default to upcitemdb API
- For Audio when both title and upc exist, a search of both discogs and upcitemdb should be performed. Results can be compared and combined.
- For Audio when both title and upc exist, and lookups differ, both results should be presented for the user to select. If the upc result is selected, a new request from discogs should be performed to gather new metadata.
- For Books when title exists, lookup should default to Google books.
- For books when upc | isbn exists, lookup should default to that endpoint
- For books if both exist, perform both lookups and compare / combine results
- For comic Books when title exists, lookup should default to Metron.
- For comic books when upc | isbn exists, lookup should default to that endpoint
- For comic books if both exist, perform both lookups and compare / combine results
- For games if title exists, search should be performed with IGDB
- For games if upc exists, search of upcitemdb should be performed
- For games if both exist, search of IGDB and upcitemdb should both be performed. Results can be compared and combined.
- For all title add / edit cards, any additional data (year, release date, etc) can be used when appropriate to improve results

### Acceptance Criteria

- All Add and Edit drawers behave correctly for any search requests.
- The single lookup button is visually universal and no longer suggests barcode-only behavior.
- Search Title only should default to the media type default title search API endpoint
- Search Title with year or release date should get results from the media type default search API endpoint
- Search UPC | Barcode | ISBN | ASIN should get results from barcode/upc API endpoint
- Search when title and barcode exist should pull results from media type default search api and from barcode search api. If results match, they are presented to the user for acceptance. If results differ both are presented to the user to choose from. If the barcode result is picked, those results inform a new search with the media type default title api endpoint.

## 2.10.7 — Shared Tab Strip Flattening

**Goal:** finish the move away from pill-shell tab groups toward the flatter horizontal tab language used in the newer surfaces.

### Scope

- Flatten the shared `.tab-strip` and `.tab` pattern in `frontend/src/index.css`.
- Remove pill-group shell treatment and inset-button feel where it still reads as stylized chrome.
- Keep horizontal tabs compact, readable, and consistent with the normalized import/admin/drawer tab direction.

### Acceptance Criteria

- Shared tab strips read as normal navigation, not segmented-control décor.
- Existing tabbed surfaces remain visually consistent after the shared style change.
- Active/inactive tab states are still obvious without pill-shell framing.

## 2.10.8 — Sidebar Ornament Reduction

**Goal:** simplify the library shell navigation so it feels less over-authored.

### Scope

- Review `frontend/src/components/SidebarNav.jsx` for remaining ornamental signals:
  - uppercase library label,
  - role badge styling,
  - active gold accent bar,
  - sub-item dot bullets.
- Reduce decorative navigation cues while preserving hierarchy and current wayfinding.

### Acceptance Criteria

- Sidebar hierarchy is still clear.
- Navigation reads as product navigation rather than styled dashboard chrome.
- Supporting role/library context remains available without decorative overload.

## 2.10.9 — Mobile Header Copy Normalization

**Goal:** replace the remaining control-plane/product-marketing phrasing in the mobile header with plain product labeling.

### Scope

- Simplify the mobile header copy in `frontend/src/App.jsx`.
- Remove phrases such as:
  - `Homelab control plane`,
  - `Platform control plane`,
  - `Support control plane`.
- Preserve role/context awareness using simpler library/space/product language.

### Acceptance Criteria

- Mobile header copy is plainer and more product-native.
- Role and scope context remain understandable.
- No marketing-flavored or AI-generated-sounding system labels remain in this header path.

## 2.10.10 — Add/Edit Drawer Heading Normalization

**Goal:** make add/edit drawers feel like normal working surfaces instead of staged modal moments.

### Scope

- Remove all-caps heading treatment and tracking-heavy display styling in `frontend/src/components/LibraryView.jsx`.
- Revisit related drawer heading typography so it aligns with the calmer tab and selection work already completed.
- Preserve strong hierarchy without shouting the drawer title.

### Acceptance Criteria

- Add/edit drawers feel more like normal product workspaces.
- Drawer headings remain easy to scan without all-caps display styling.
- The updated heading treatment is consistent across add/edit drawers for supported media types.

## 2.10.11 — Modal Shell Flattening

**Goal:** reduce the remaining blur-heavy, oversized modal shell treatment across shared overlays.

### Scope

- Review modal primitives in `frontend/src/components/app/AppPrimitives.jsx` and related modal surfaces.
- Reduce oversized rounded shells, blur-heavy backdrops, and heavy shadow treatment where they still feel staged.
- Keep modal focus, layering, and dismissal behavior intact.

### Acceptance Criteria

- Modals feel calmer and more functional.
- Backdrop and shell styling support focus without becoming decorative.
- Shared modal changes remain compatible with current capture/detail/editor flows.

## 2.10.12 — Shared Form Label Normalization

**Goal:** remove the remaining eyebrow-style uppercase label language that keeps resurfacing through shared form primitives.

### Scope

- Rework shared form label styling in `frontend/src/index.css`.
- Reduce or remove global uppercase + tracking-heavy label defaults.
- Preserve readable field hierarchy and accessibility across forms, drawers, admin surfaces, and supporting workflows.

### Acceptance Criteria

- Shared labels no longer force eyebrow-style UI language across the app.
- Forms stay readable and scannable after the typography shift.
- The label style feels consistent with the rest of the flattened `2.10.x` UX cleanup lane.

## 2.10.13 — Shared UI Language Consolidation

**Goal:** finish the `2.10.x` frontend cleanup lane by centralizing the shared visual language into the global style layer and shared primitives so future UI changes rely less on view-level one-offs.

### Scope

- Audit the remaining shared product-language decisions that are still split between:
  - `frontend/src/index.css`,
  - `frontend/src/components/app/AppPrimitives.jsx`,
  - and view-level files such as `frontend/src/App.jsx`, `frontend/src/components/LibraryView.jsx`, `frontend/src/components/SidebarNav.jsx`, and `frontend/src/components/AuthPage.jsx`.
- Move repeated visual rules, interaction patterns, and shell treatments into shared layers where they genuinely belong:
  - tabs,
  - headings,
  - toolbar/status rows,
  - shared shell chrome,
  - reusable form/layout rhythms,
  - modal/drawer scaffolding.
- Include the authentication surface in this consolidation pass so the remaining AI-shaped auth-page elements are normalized before `3.0.0`, especially:
  - ornamental media-type pills,
  - all-caps marketing-style CTA/hero copy,
  - left-column hero posture,
  - any color treatment that still feels more template-driven than product-native,
  - and the misleading always-visible `Register` affordance while registration is still invite-led.
- Normalize the shared heading system so workspace and panel headings read like normal product UI instead of display-font chrome, including examples such as:
  - `Library`,
  - `Import Media`,
  - `Help`,
  - `Integrations`,
  - `Profile`,
  - `Activity`,
  - `All Workspaces`,
  - `Members`,
  - `Workspace Controls`,
  - and `Member Details`.
- Reduce view-specific styling stacks where the styling is expressing shared product language rather than page-specific composition.
- Keep page-specific composition and copy local to the views instead of over-abstracting unlike surfaces into forced primitives.
- Complete this centralization pass before closing the `2.10.x` milestone train or starting `3.0.0 — Frontend Build Modernization (CRA to Vite)`.

### Acceptance Criteria

- The app’s shared visual language lives primarily in `frontend/src/index.css` and `frontend/src/components/app/AppPrimitives.jsx`, with noticeably less duplicated styling logic in view files.
- View components are left owning page-specific composition and product wording more than ad hoc brand/chrome styling.
- Future UI adjustments can be made through shared layers more often than through repeated per-view class rewrites.
- The centralization pass avoids over-abstraction and preserves clear boundaries between shared product language and view-specific layout.
- The auth page no longer stands apart as a mini marketing surface with leftover AI-style pills, CTA posture, or mismatched palette tone.
- The auth surface only exposes `Register` when registration is actually available, starting with invite-driven entry links in the current platform model.
- Shared workspace and panel headings no longer read as uppercase display-font chrome across the app.

## 2.10.14 — Space-Scoped Parity For Settings, Integrations, and Activity

### BUG FIX

- Bug: space owners do not currently receive the space-scoped Settings, Integrations, and Activity parity that the product’s space-separation model implies.

**Goal:** each space should control its own settings and free-token integrations, and should see its own activity feed, so space separation is real product behavior rather than only a library/access boundary.

### Scope

- Make Settings available at the space level so a space can manage its own settings instead of depending on global/admin-only control-plane access.
- Make Integrations available at the space level for integrations that are intended to be space-owned and token-limited per user/space.
- Preserve explicit exceptions where integrations remain outside per-space control:
  - logs
  - metrics
- Make Activity feeds space-scoped so space owners and members see activity that belongs to their own space rather than depending on global/admin visibility.
- Keep ownership and access aligned with the existing space/library separation model:
  - a user sees only the settings, integrations, and activity for the space they are allowed to operate in,
  - ownership of activity belongs to the space,
  - and the product promise of meaningful server-side separation is maintained.
- Complete this parity milestone before any large new feature work or `3.0.0 — Frontend Build Modernization (CRA to Vite)`.

### Acceptance Criteria

- Space owners can access and manage space-scoped Settings.
- Space owners can access and manage space-scoped Integrations for the supported free-token integrations, excluding logs and metrics.
- Space owners and members can access a space-scoped Activity surface that reflects only their own space activity.
- The resulting behavior matches the product promise of server-side space separation rather than leaving these surfaces as global-only control-plane gaps.

## 2.10.15 — Platform SMTP and Email Delivery Foundation

**Goal:** establish a real platform-owned email delivery model for invites, password resets, and future SaaS auth flows so email-backed lifecycle actions stop depending on ad hoc copy-link-only operator behavior.

### Scope

- Define and implement the platform SMTP ownership model explicitly:
  - SMTP is platform-level infrastructure, not workspace-owned infrastructure,
  - runtime `.env` values remain the bootstrap/default source of truth for deployment,
  - the app may expose a platform settings surface for viewing/editing SMTP configuration only where secrets can be handled safely and intentionally.
- Keep the first delivery model intentionally simple and supportable:
  - one platform SMTP configuration serves invite delivery, password resets, self-registration mail, and future admin-issued account lifecycle email,
  - do not add per-workspace SMTP servers in this milestone,
  - defer workspace-branded sender customization or richer branding overrides to a later milestone.
- Add the platform settings/admin UX needed to make SMTP operationally usable:
  - show whether SMTP is configured and available,
  - allow operators to understand whether the platform will send email or require copy-link fallback,
  - define whether in-app editing persists platform overrides or remains env-backed read-only configuration in the first slice.
- Keep secrets and operator safety explicit:
  - SMTP credentials must never be echoed back in plaintext,
  - any settings/API surface must return masked/redacted values,
  - operator docs must explain env-backed bootstrap, override behavior, and safe recovery/update workflow.
- Complete this foundation before `2.10.16` and `2.10.17` so registration, password recovery, and workspace invite/member lifecycle work all build on the same delivery model rather than each inventing partial mail handling.

### Acceptance Criteria

- The platform has one documented and implemented SMTP delivery model that is clearly platform-owned rather than workspace-owned.
- Platform operators can tell whether email delivery is available without exposing SMTP secrets.
- Invites and password-reset-style workflows have a stable platform email path to build on, with copy-link fallback only where explicitly intended.
- Docs explain the relationship between `.env` bootstrap values, any in-app settings surface, and masked secret handling clearly enough for operators to configure and troubleshoot delivery.

## 2.10.16 — SaaS Self-Registration and Password Recovery

**Goal:** add normal SaaS account-entry flows so the platform can support self-registration and email-based password recovery without requiring invite-only registration for every account.

### Scope

- Add SaaS self-registration as a first-class platform capability:
  - invite-only registration is no longer the only account-creation path for the SaaS product,
  - invite flows remain available where workspace or operator workflows require them,
  - registration availability should remain explicit and configurable rather than implied by stale auth copy.
- Add the standard auth-screen password recovery flow:
  - request reset by email from the auth surface,
  - send reset email through the platform SMTP model from `2.10.15`,
  - complete password reset through a normal emailed token flow.
- Keep account lifecycle and token handling aligned with the existing security direction:
  - reset tokens remain one-time and non-replayable,
  - raw token material is not exposed beyond intentional one-time creation moments where policy still allows it,
  - activity/audit coverage should capture reset request, delivery, claim, and invalidation states where relevant.
- Keep this milestone focused on public auth/account entry:
  - do not absorb workspace member lifecycle controls here,
  - do not absorb per-workspace branding or custom SMTP behavior here.

### Acceptance Criteria

- SaaS users can self-register without requiring an invite-only path.
- The auth screen exposes a standard password-reset request flow that sends email through the platform SMTP model.
- Reset completion works through an emailed link/token flow with safe one-time semantics.
- Invite-based onboarding remains available where the platform still needs it, without forcing all registration through invites.

## 2.10.17 — Workspace Invite and Member Lifecycle Controls

**Goal:** give workspace owners/admins a complete email-first member lifecycle workflow so they can onboard and manage workspace users without relying on platform-only operator intervention.

### Scope

- Add workspace invite-by-email as the normal tenant onboarding path:
  - workspace owners/admins can invite a user by email,
  - the email sends a setup link that lands the user in the intended workspace context,
  - invite claim/setup must preserve the intended workspace role after claim.
- Finish the create-workspace onboarding gap left by earlier invite work:
  - allow workspace creation to designate a brand-new invited user as the initial owner instead of requiring an already-active existing account for owner assignment,
  - preserve clear “first assigned owner” semantics at claim time,
  - keep the workflow usable when SMTP is unavailable by preserving explicit copy-link fallback where intended.
- Add workspace-scoped member lifecycle controls:
  - workspace owners/admins can force a password reset for a user,
  - workspace owners/admins can suspend a user,
  - workspace owners/admins can remove a user from the workspace according to the intended tenancy policy.
- Keep authority boundaries explicit:
  - workspace-scoped lifecycle controls apply within the workspace model and must not silently become platform-global user administration,
  - global/platform admin authority remains distinct from normal workspace ownership,
  - all invite/member lifecycle actions should remain auditable.
  - membership removal must preserve workspace content and attribution rather than silently deleting user-created records.
  - removing the last owner must remain blocked until ownership is transferred or another owner exists.

### Acceptance Criteria

- Workspace owners/admins can invite users by email into their workspace with setup-link delivery.
- Workspace creation can assign a brand-new invited owner instead of requiring an existing active account as the initial owner.
- Workspace owners/admins can force password reset, suspend, and remove users through workspace-scoped controls.
- Invite claim and member lifecycle behavior remain aligned with the workspace ownership model rather than leaking into unrelated spaces or platform-global state.

## 3.0.0 — Frontend Build Modernization (CRA to Vite)

**Goal:** Replace the legacy Create React App (`react-scripts`) frontend toolchain with a modern Vite-based build and dev workflow so the project can retire the remaining CRA-coupled advisory cluster, simplify frontend maintenance, and keep static nginx-based production deployment intact.

### Why this is a major version

- This is not just a dependency bump; it changes the frontend build system, local dev server, env handling conventions, and parts of the frontend test/build contract.
- The production runtime stays a static asset build served by nginx, but the developer workflow and build assumptions change enough to justify a semver-major milestone.
- Remaining CRA-coupled advisories from the `2.7.x` maintenance lane are intentionally folded into this milestone rather than stretched across patch releases.

### Scope

- Replace `react-scripts` with Vite for the frontend build and development shell.
- Preserve the current application architecture:
  - React stays in place,
  - nginx still serves built static assets in production,
  - backend API topology stays unchanged,
  - no UI redesign is required as part of this migration.
- Port CRA-specific frontend behaviors to explicit Vite equivalents:
  - env variable exposure and naming conventions,
  - HTML entry bootstrapping,
  - asset import semantics,
  - SVG import behavior,
  - dev-server proxy expectations,
  - static public asset handling,
  - source map and build output expectations used by release workflows.
- Rework test/build tooling assumptions that currently ride on CRA defaults:
  - evaluate whether the existing Jest path remains, or whether frontend tests move to a Vite-compatible runner in the same milestone,
  - keep CI coverage expectations explicit rather than relying on hidden CRA defaults.
- Retire the remaining CRA-coupled advisory family by removing or replacing the vulnerable toolchain paths:
  - `svgo`,
  - `@svgr/plugin-svgo`,
  - `@svgr/webpack`,
  - `webpack-dev-server`,
  - `resolve-url-loader -> postcss`,
  - any other CRA-bound transitive packages that disappear once `react-scripts` is removed.
- Keep the migration behavior-focused, not design-focused:
  - do not bundle page redesigns or feature work into this milestone,
  - keep routing, auth/session behavior, library CRUD, import flows, and tenancy UI behavior functionally equivalent unless a specific migration fix requires a targeted adjustment.

### Behavior changes to plan explicitly

- Development server:
  - local frontend development uses Vite's built-in dev server instead of `react-scripts start`,
  - HMR/refresh behavior changes to Vite semantics,
  - proxy behavior for API calls must be configured explicitly rather than inherited from CRA conventions.
- Environment variables:
  - CRA-style frontend env assumptions need migration to Vite's env model,
  - any frontend code relying on CRA env injection must be audited and ported carefully.
- Asset handling:
  - SVG/component import behavior must be revalidated,
  - static path assumptions tied to CRA's public asset model must be migrated.
- Build output:
  - Docker frontend build commands and any release checks that assume CRA output conventions must be updated,
  - nginx static serving and SPA fallback behavior must remain correct after the build-tool swap.
- Testing:
  - frontend test wiring must be made explicit rather than indirectly inherited from CRA.

### Recommended delivery shape

- Stage 1: migration planning and compatibility inventory
  - inventory every CRA-specific behavior in the current frontend,
  - identify env, asset, test, and proxy assumptions,
  - document the exact migration contract before implementation.
- Stage 2: Vite scaffold and parallel build path
  - add Vite config and scripts,
  - keep the current UI behavior unchanged,
  - get a Vite dev server and production build working alongside the existing frontend code.
- Stage 3: parity and CI migration
  - switch Docker/CI/frontend build flows to Vite,
  - update release checks, artifact expectations, and any workflow assumptions tied to CRA build output.
  - current direction for this stage:
    - cut production Docker/nginx over to Vite output first,
    - move local maintainer defaults (`start`, `build`, `preview`) to Vite once the production cutover is proven,
    - prove Docker, CI, and browser regression on the Vite path,
    - then retire the temporary CRA rollback rail.
- Stage 4: remove CRA
  - remove `react-scripts` and the old CRA-only dependency surface,
  - confirm the remaining frontend advisory cluster is actually gone from the lockfile and CI scans.

### Acceptance Criteria

- Frontend local development works through Vite instead of `react-scripts`.
- Production frontend build still outputs static assets served by nginx with correct SPA fallback behavior.
- Auth/session bootstrap, library browsing/editing, imports, admin flows, and tenancy UI behave equivalently before and after the migration.
- CI/release workflows are updated for the new frontend build path and remain green.
- The remaining CRA-coupled advisory family is removed from the active frontend toolchain.
- Frontend docs explain the new dev/build workflow clearly enough that maintainers no longer need CRA-specific tribal knowledge.

### API/Ops Checklist

- Update frontend Docker build steps to use the Vite production build.
- Update operator/developer docs for the new local frontend start/build commands.
- Verify nginx routing and asset paths still work in local, reverse-proxy, and registry-image deployments.
- Reconfirm release-gate artifacts after the build-tool migration:
  - dependency audits,
  - image scans,
  - SBOM generation,
  - compose smoke,
  - UI/API regression evidence.

### Milestone boundaries

- `2.7.x` remains the patch-maintenance lane for narrow security and dependency work.
- `2.8.0` and `2.8.1` remain product/UI workflow milestones and should not absorb build-tool migration work.
- Any remaining frontend toolchain remediation after `2.7.3` should be considered part of this `3.0.0` milestone rather than stretched across additional speculative patch releases unless a clearly isolated low-risk fix appears.

## 3.1.0 — Shared Core Extraction and Public Homelab Product Split

**Goal:** Turn the proven edition boundary into a real product split by extracting a stable shared core, keeping the platform/SaaS shell private, and preparing a public homelab shell/repo that contains no tenancy/platform code.

### Scope

- First extraction slice:
  - make the edition contract explicit in shared backend-owned bootstrap/auth payloads so both product shells consume one authoritative definition of:
    - `platform`: multi-workspace platform shell,
    - `homelab`: single-library household shell with local accounts and no workspace control plane,
  - keep this slice focused on contract hardening and docs/smoke verification rather than the later public-repo promotion mechanics.
- Early workflow hardening:
  - run both editions locally as first-class compose targets instead of temporarily flipping one shared stack back and forth,
  - keep the default local/private stack on the real platform/dev dataset,
  - use one explicit parallel homelab stack for edition-split verification so fresh isolated data is expected and obvious.
- Early platform-route extraction:
  - move clearly platform-only auth/control-plane capabilities behind platform-only route registration instead of leaving them on shared routers,
  - early examples:
    - service-account key management stays mounted in platform and is fully unmounted in homelab,
    - platform-only valuation and log-export integration test routes stay mounted in platform while homelab keeps only the shared collector-safe integration surface,
    - shared Help surfaces continue to be tightened so homelab role handling follows the edition contract instead of inheriting platform support-staff behavior from raw admin role checks,
    - workspace-scoped integration routes stay mounted only with the platform workspace surface instead of remaining available to the homelab runtime,
    - shared dashboard shell helpers continue to be tightened so support badges, mobile header labels, support-session banners, and sidebar support-role handling only activate when the edition actually exposes the support lane,
    - shared scope and library flows continue to be tightened so homelab no longer persists a user-facing `active_space_id` selection in the database during default-scope and library-switch operations even though library ownership still maps internally to a backing space.
    - always-mounted shared settings/media routes continue to be normalized around the resolved scope context so homelab-safe reads and enrichment/import helpers do not depend on raw persisted workspace state or stray `req.user.activeSpaceId` access in shared code.
    - auth/session/token bootstrap continues to be tightened so shared runtime scope resolution can use an internal effective scope field instead of assuming the user-facing `active_space_id` is the only safe source of truth.
    - scope-mutating shared and platform-safe routes continue to be tightened so support request targeting, space selection, and related request-level handoffs keep the internal effective scope aligned instead of mutating only `activeSpaceId`.
    - auth principal bootstrap continues to be tightened so internal `scope_space_id` prefers the active library's backing space before falling back to persisted `active_space_id`, reducing drift between effective scope and user-facing workspace state in both editions.
    - request-level auth middleware continues to be tightened so `req.user.activeSpaceId` stays aligned with the derived internal effective scope, reducing the chance that older direct reads accidentally revive persisted workspace-state drift.
    - auth/profile payload shaping continues to be tightened so platform-facing `active_space_id` responses prefer the request's effective scope before falling back to legacy request fields or persisted workspace state.
    - internal auth principal records continue to be tightened so their `active_space_id` mirrors the effective scope derivation as well, reducing downstream drift in middleware and audit paths that still consume principal records directly.
    - shared library payload shaping continues to be tightened so `/api/libraries` prefers request-level effective scope and active-library state instead of re-reading raw persisted user scope after bootstrap.
    - default-scope service resolution continues to be tightened so the active library row is reused as the primary scope anchor even when a preferred space is already in play, reducing duplicate lookups and keeping shared scope bootstrap centered on effective library state instead of older persisted workspace hints.
    - default-scope membership counting continues to be tightened so suspended space memberships no longer count as usable scope during bootstrap, letting shared scope recovery follow active memberships instead of stale suspended workspace history.
    - shared scope-access fallback resolution continues to be tightened so a fallback library is only derived from libraries whose backing space membership is still active, keeping scope bootstrap aligned with the same accessible-library semantics used elsewhere in the shared core.
    - library archive/delete replacement fallback continues to be tightened so replacement libraries are only selected from active space memberships, preventing suspended workspace history from quietly becoming the next active scope after library removal.
    - auth principal bootstrap continues to be tightened so `active_library_id` now prefers the actually joined active library row before any fallback library, preventing stale persisted library ids from outranking the effective library state already used for scope derivation.
    - auth principal fallback-library resolution continues to be tightened so session, personal-access-token, and service-account bootstrap only derive fallback libraries from active space memberships, keeping principal scope bootstrap aligned with the same accessible-library rules used elsewhere in the shared runtime.
    - auth principal active-library joins continue to be tightened so archived active libraries no longer outrank fallback scope resolution during session, personal-access-token, or service-account bootstrap.
    - platform space archive/delete cleanup continues to be tightened so dangling active libraries from the affected space are cleared even when a user's persisted `active_space_id` has already drifted, preventing deleted or archived platform spaces from leaving behind stale active-library scope.
    - shared space-selection response shaping continues to be tightened so `/api/spaces/select` follows the same homelab-safe surfaced-space contract as the rest of the shared scope-mutation payloads instead of returning a raw `active_space_id` after the persisted write has already been normalized.
    - destructive shared and platform space cleanup continues to be tightened so stale `user_sessions` support-session state is cleared when the affected space or one of its libraries is no longer valid, preventing old support-session targets or previous-space restore pointers from surviving space archive/delete or membership suspension/removal flows.
    - library archive/delete cleanup continues to be tightened so stale `user_sessions` support-library pointers are cleared when a library is archived or deleted, preventing current or previous support-session library targets from surviving after the referenced library is no longer valid.
    - library ownership transfer continues to be tightened so the previous owner's persisted active library and stale support-session library pointers are repaired when transfer removes their membership to the library, preventing the old owner from staying anchored to a library they no longer belong to.
    - member transfer into a new space continues to be tightened so stale `user_sessions` support-session scope pointing at the source space is cleared when the user's source-space membership is removed, preventing old support-session targets or previous-space restore pointers from surviving after the transfer.
    - shared owned-library move cleanup continues to be tightened so users who lose memberships to libraries moved into a new space do not keep stale active-library or support-library pointers while waiting for later fallback bootstrap to repair them.
    - shared library-membership sync continues to be tightened so granting a user real library access in a space can immediately anchor an otherwise unscoped user to the first accessible library in that space instead of depending on later fallback/bootstrap to choose an active scope.
    - shared library-membership removal continues to be tightened so removing a user's library access in a space immediately clears stale active-library and support-library pointers and opportunistically restores a replacement accessible library instead of depending on later fallback/bootstrap to repair the user's scope.
    - shared library-membership loss repair continues to be extracted into common library-service helpers so removing or moving library access now clears stale support-space and previous-support-space session pointers alongside support-library state whenever those sessions were anchored to the lost library, reducing route-local patching and keeping the shared runtime aligned around one mutation-time repair path.
    - shared library-access-loss repair continues to be extracted out of route-local archive, delete, and ownership-transfer flows so library lifecycle mutations now reuse the same service helper for restoring replacement active scope, clearing stale support-session library pointers, and optionally bootstrapping a default fallback scope when no accessible library remains.
    - shared space-access invalidation continues to be extracted into common space-service helpers so suspension, membership removal, and transfer-out lifecycle flows no longer carry duplicated route-local SQL for clearing persisted active scope and stale current/previous support-session state when a user loses access to a space.
    - targeted backend/runtime space lifecycle coverage now proves the extracted shared space-access invalidation helper on the live platform stack by validating suspension and membership removal clear stale persisted scope and current/previous support-session state, while transfer-to-new-space clears source-space session pointers without clobbering the newly assigned active scope.
    - targeted backend/runtime library lifecycle coverage now proves the extracted shared library-access-loss repair helper on the live platform stack by validating replacement-library repair after archive, default-scope fallback after ownership transfer when no accessible library remains, and stale current/previous support-session library cleanup in the same mutation flows.
    - support-session bootstrap continues to be tightened so the stored previous support-session scope is validated against currently accessible space/library state before it is saved, preventing stale previous-space or previous-library pointers from being carried forward into support-session metadata.
    - support-session teardown continues to be tightened so request-level restored scope and support-session audit metadata use the same validated previous scope instead of copying raw previous-space or previous-library ids directly out of the session row.
    - support-session `/api/auth/me` payload shaping continues to be tightened so active support-session library state is validated against the current support space instead of echoing a stale `supportLibraryId` directly out of request auth state.
    - support-session scope payload shaping continues to be tightened so normalized support-session space/library results are written back into request auth state and invalid support-session request pointers are cleared instead of lingering after payload construction.
    - support-session `/api/auth/me` request-state handling continues to be tightened so normalized support-session space/library results are written back into the request auth state and invalid support-session request pointers are cleared there too, keeping `/api/auth/me` aligned with the normalized scope payload path.
    - shared auth/bootstrap normalization continues to be consolidated so `/api/auth/me`, `/api/profile`, and scope payload shaping reuse the same request-state normalization helper for support-session and default-scope handling instead of carrying parallel route-local normalization branches.
    - targeted support-session runtime coverage now proves `/api/auth/me` must honor active support-session scope for both `admin` and `support_admin` users instead of falling back to default admin scope during an active support session, tightening another remaining split between session normalization helpers and the live auth profile surface.
    - targeted backend/runtime regression coverage continues to be expanded around support-session normalization so the live platform stack now deliberately poisons stale previous-scope and support-library session state and proves `/api/auth/support-session/start`, `/api/auth/me`, `/api/auth/scope`, and `/api/auth/support-session` teardown normalize those cases back to valid runtime state instead of restoring drifted pointers.
- Shared core extraction:
  - identify and extract domain logic that should be implemented once and consumed by both products,
  - expected core areas include media/import logic, shared auth/session primitives, shared API client patterns, shared UI primitives, and edition-safe integrations/metadata services.
- Private platform shell:
  - keep tenancy lifecycle, global spaces/members administration, owner recovery, support-session/assume-user capabilities, and tenant membership/invite orchestration in the private platform product.
- Public homelab shell:
  - build the homelab product from the shared core plus the homelab-safe shell only,
  - do not ship tenancy/global frontend or backend route groups in the public repo,
  - preserve the chosen homelab user model: one admin with optional viewer/read-only users.
- Repo/product split delivery model:
  - private repo remains the source of truth during extraction,
  - public homelab repo is created only after the edition boundary is stable,
  - public updates are promoted/exported intentionally from the private source rather than maintained as an equal long-lived peer branch.
- Release/CI separation:
  - define separate build/test/release verification paths for platform and homelab products,
  - ensure public builds do not depend on private-only modules or route groups.
- Commercial boundary policy:
  - if licensing/subscriptions are introduced later, they apply to the private platform product after the code split,
  - the public repo stays safe because platform code is absent, not merely hidden behind a mutable flag.

### Acceptance Criteria

- Shared capabilities can be developed once and consumed by both product shells.
- The public homelab repo contains no tenancy/platform code.
- The private platform product retains the full SaaS control plane.
- Public homelab builds and release gates run independently from the private platform product.
- The private-to-public promotion path is documented and disciplined enough to avoid accidental platform leakage.

## 3.1.1 — Browser-Visible Regression Expansion for Shared-Core Lifecycle Flows

**Goal:** Expand browser-visible regression coverage for the shared-core lifecycle repairs extracted in `3.1.0` so the next confidence layer proves what end users and support staff actually see after those mutations land.

### Scope

- Add browser-visible coverage for support-session lifecycle flows where normalized scope and request-state handling should stay visible in the shell.
- Add browser-visible coverage for library lifecycle flows where active-library fallback, selector state, and import/library surfaces must recover after archive or ownership transfer.
- Add browser-visible coverage for space lifecycle flows where suspension, removal, and other access invalidation mutations must remain visible through workspace navigation and scope-dependent shell affordances.
- Keep this milestone focused on browser-facing proof of the extracted shared core rather than reopening architecture or product-boundary extraction work from `3.1.0`.

### Acceptance Criteria

- Shared-core lifecycle fallout is covered by browser-visible regression checks rather than backend/runtime smokes alone.
- Support-session, library, and space lifecycle paths are exercised beyond the minimum release gates where the shared-core split needs extra confidence.
- Added browser coverage demonstrates that shell-visible scope, library, and workspace behavior stays aligned with the extracted lifecycle helpers.

## 3.1.2 — Post-Split UI Cleanup for Support, Help, and Auth Shell Surfaces

**Goal:** Clean up the visible support, help, and auth shell surfaces now that the shared-core and browser-visible lifecycle boundary work has stabilized.

### Scope

- Remove browser-visible polish that no longer matches the post-split shared-core story.
- Focus on support, help, and auth shell surfaces that still read as overly heavy, inconsistent, or AI-shaped after the `3.1.0` and `3.1.1` stabilization work.
- Keep the milestone bounded to UI/shell cleanup rather than reopening shared-core extraction or edition-boundary architecture work.

### Acceptance Criteria

- Support, help, and auth shell surfaces feel more consistent and restrained.
- Remaining browser-visible polish is cleaned up without altering the core shared-core story.
- The work stays clearly separated from milestone-level architecture changes.

## 3.1.3 — Library Controls and Selection Behavior Cleanup

**Goal:** Clean up shared library controls, selection behavior, and valuation presentation so the main collection workflow feels simpler, clearer, and more consistent after the `3.1.2` shell cleanup pass.

**Status:** Completed.

### Scope

- Simplify pagination controls by replacing verbose `Previous` and `Next` labels with clearer directional controls and a tighter page-size toolbar.
- Tighten bulk-selection wording and affordances:
  - remove the idle `Bulk Actions` label,
  - make page selection and full-result selection distinct instead of overloading one `Select all` affordance,
  - keep the selection state readable without turning the toolbar into a wall of repeated verbs,
  - once a full page is selected, offer escalation to select all matching titles in the current library type,
  - remove unnecessary delete-button narration such as `Delete selected`.
- Carry one browser-regression artifact modification from the `3.1.2` release evidence:
  - align the space-manager Playwright assertions so suspension or removal with surviving unrelated workspace access proves redirect into a fallback manageable workspace instead of incorrectly expecting the `Access Restricted` boundary.
- Add a cleaner valuation treatment with:
  - a `Valuation` label,
  - a simpler refresh affordance,
  - low / mid / high valuation display that reads as straightforward field labels instead of noisy parentheticals.
- Keep the milestone bounded to library workflow and UI behavior cleanup rather than widening back into support/help/auth shell work or broader product-split architecture changes.

### Acceptance Criteria

- Pagination controls are visually simpler and still unambiguous.
- Bulk selection language is clearer and less verbose.
- Bulk selection can escalate cleanly from the current page to all matching titles in the current library type.
- Valuation display includes low / mid / high values with a refresh action.
- The cleanup improves the main library workflow without reopening broader milestone-level UI redesign work.

### Closeout Notes

- Shared library pagination now uses quieter directional controls with a tighter footer treatment.
- Bulk selection now distinguishes current-page selection from full-result selection and can escalate to all matching titles in the active library type.
- The selection state was moved into the results header so it reads as content-region state instead of a second toolbar.
- Valuation presentation in the detail drawer was flattened into a simpler low / mid / high row with a reduced refresh affordance.
- Broader drawer redesign, profile/account surface cleanup, and comic server-pagination normalization were intentionally deferred to the backlog rather than widening this milestone.

## 3.1.4 — Profile Surface and Account Navigation Cleanup

**Goal:** Rework the profile surface and account entry point so account management feels calmer, more intentional, and better integrated with the shell after the `3.1.3` library cleanup pass.

**Status:** Completed.

### Scope

- Take an `uncodixfy` pass over the profile page so it reads like a normal product surface instead of a generic boxed account screen.
- Tighten the profile information hierarchy, spacing, and section structure without widening into broader auth/settings redesign work.
- Replace the current direct profile/footer-account treatment with a clearer account menu from the profile nav entry.
- Define the first account menu contents:
  - `My profile`
  - `Discord`
  - `GitHub`
  - `Sign out`
- Consolidate duplicate shell footer account links into that profile/account menu so the shell carries one clearer account entry point.
- Keep the milestone bounded to profile/account navigation cleanup rather than mixing it into drawer or broader shell milestones.

### Acceptance Criteria

- The profile page feels calmer, denser, and less AI-heavy.
- The profile nav entry can open a clear account menu with `My profile`, `Discord`, `GitHub`, and `Sign out`.
- Account navigation no longer duplicates itself awkwardly across the profile entry and footer links.
- The resulting profile/account experience feels consistent with the calmer post-`3.1.2` and post-`3.1.3` shell direction.

### Closeout Notes

- The profile page was reshaped into a calmer account-management surface with cleaner spacing, flatter token treatment, and a more intentional identity summary.
- The shell now uses one consolidated account menu entry point with `My profile`, `Discord`, `GitHub`, and `Sign out` instead of duplicated footer account links.
- Profile images are now supported across the profile surface and shell account entry, with a clickable avatar upload target replacing the earlier separate image preview and URL field.
- Backend auth/profile handling now persists `users.image_path`, and the milestone included a follow-on migration fix so `/api/auth/me` and profile edits recover cleanly on the running stack.
- Homelab and platform were rebuilt onto the same refreshed shared shell/library-adjacent UI path so comics, search, pagination, nav, and profile/account updates land consistently across both editions while preserving intended feature-level product differences.

## 3.1.5 — Library Detail Drawer Layout and Information Hierarchy Cleanup

**Goal:** Make library detail drawers feel more content-shaped and less template-driven by tightening sparse layouts, relaxing overused metadata grids, and reducing visual weight in drawer chrome after the `3.1.3` and `3.1.4` cleanup passes.

**Status:** Completed.

### Scope

- Reassess the shared drawer pattern across library detail views, where one vertical rhythm and one metadata grammar are stretched across very different content types.
- Reduce excessive empty vertical space in sparse drawers so the body does not feel abandoned or bottom-light while the footer feels dominant.
- Allow selective width variants instead of assuming one universal drawer width:
  - media drawers may need a slightly wider detail variant,
  - collectibles and events likely need denser composition rather than more width.
- Reduce dependence on repeated two-column metadata grids when they flatten the content hierarchy.
- Let overview content remain block-oriented instead of forcing it into surrounding field-grid logic.
- Rework technical and provider-heavy metadata so long machine values do not strain narrow two-column layouts:
  - prefer stacked or list-style treatments where they read more naturally than field matrices.
- Keep valuation treatment compact and integrated:
  - `Low`, `Mid`, and `High` on one horizontal row,
  - supporting source and update metadata quieter than the values,
  - refresh control treated as a low-emphasis utility action.
- Replace long raw external URLs and oversized external-link buttons with quieter labeled links or link-style actions:
  - use destination/action labels such as `Read in Calibre`, `Open source`, `View on TMDB`, `Open event site`, or `Open image`,
  - avoid exposing infrastructure-heavy raw URLs in the drawer body when a descriptive link label will do.
- Move drawer titles away from all-caps so the hierarchy stays strong without shouting.
- Tone down the footer action bar so `Close`, `Edit`, and `Delete` no longer carry more visual weight than the drawer content above them.
- Let drawer layouts vary more intentionally by content density and content type instead of enforcing the same section rhythm everywhere.
- Keep the milestone bounded to drawer surfaces and information hierarchy rather than widening back into profile, auth, or library data-flow milestones.

### Assessment Notes

- Overall drawer pattern is coherent and serviceable, but still feels too templated:
  - too much empty vertical space in sparse drawers,
  - same structure regardless of content density,
  - footer actions often feel heavier than the body.
- TV and comics are among the stronger fits because they have enough content to justify the current structure.
- Games are solid but still a little long and overly sectioned.
- Movies are competent but read like the default media drawer rather than a fully resolved layout.
- Audio drawers are clean but underfilled for the amount of space they use.
- Events are acceptable but often feel like drawers waiting for more content.
- Books are functionally useful but visually rough because long provider IDs and URLs strain the current grid.
- Collectibles are the weakest fit because the sparse body leaves too much dead space and makes the footer disproportionately important.

### Recommended First Focus

- Start with the weakest structural fits:
  - collectibles,
  - books.
- Use those two surfaces to prove the broader direction before touching every drawer type.

### Acceptance Criteria

- Sparse drawers no longer feel empty, abandoned, or bottom-heavy.
- Drawer composition varies intentionally by content density instead of relying on one overused two-column field grammar.
- Media drawers that need more width have it without forcing the same width on collectibles or events.
- Long technical/provider metadata no longer breaks the reading rhythm of the drawer.
- External sources are presented as labeled links or quieter actions instead of raw URLs and chunky buttons.
- Drawer titles no longer render in all-caps.
- Footer actions are toned down so they support the drawer instead of dominating it.
- The first-pass target drawers, especially books and collectibles, show clear layout improvement without regressing stronger drawers such as TV and comics.

### Closeout Notes

- Book drawers now use a wider, less machine-shaped layout with calmer title treatment, labeled source links, reduced provider-plumbing exposure, and a tighter lower-half arrangement for editions, rating, and notes.
- Collectible and event drawers were flattened and restrained rather than redesigned into heavier panel systems, with quieter links, lighter footer actions, and denser information hierarchy.
- Shared media drawers for movies, TV, games, and comics were normalized so titles, notes, external actions, and footer controls no longer feel like leftovers from the older button-heavy drawer system.
- Comic drawers now suppress visible internal/provider IDs, stop leaking Calibre and OPDS plumbing into `Type Details`, use provider-aware source labels such as `View on Metron` and `Download on Calibre`, and clamp long overview text behind a simple show more/show less control.
- TV season handling was reshaped from stacked nested cards into a flatter season-tab treatment with shorter `S1`-style labels, checkmark completion state, and one selected-season detail area instead of multiple boxed subpanels.
- The milestone also carried a small shared-library behavior fix so newer library tabs like events and collectibles persist correctly across refresh instead of falling back before feature flags finish loading.

## 3.1.6 — Cross-Provider Book and Comic Sync Normalization

**Goal:** Normalize book and comic ingest across Metron and OPDS/CWA so equivalent titles can attach to one canonical library record instead of creating duplicate rows or drifting into the wrong media type when multiple sync-capable sources contribute overlapping data.

**Current Slice:** `3.1.6.29 — Browser Regression Repair and Milestone Closeout`

- Prove that a canonical record with more than one absorbed duplicate can revert one merge event without disturbing the others, and verify the merge-details evidence summary updates cleanly after the partial revert.
- Keep any future user-facing revert affordance out of the normal drawer for now; if we surface revert later, it should start as an operator-facing action layered on top of the same event-based repair history.
- Finish the milestone with release-shaped closeout discipline:
  - version metadata synchronized to `3.1.6`,
  - release note + release-feed snapshot regenerated,
  - running-stack `Help > Releases` proof reverified,
  - browser-regression repaired and rerun green after the library bulk-selection fix.

### Scope

- Reassess the current Metron and OPDS/CWA ingest paths for books and comics, where overlapping titles can arrive as separate rows without a shared normalization contract.
- Start the milestone with a duplicate and misclassification audit against the running dev dataset before changing merge behavior.
- Define cross-provider identity precedence for books and comics:
  - books: ISBN and normalized book identifiers first,
  - comics: provider-native IDs when durable, then series + issue/volume identity,
  - title/date/publisher heuristics only as lower-confidence fallback.
- Detect likely comic-like rows imported as `book` before they silently compete with canonical comic rows.
- Define confidence bands for cross-provider matching:
  - high confidence auto-attach / normalize,
  - medium confidence review candidates,
  - low confidence remain separate.
- Preserve provider/source attribution even when one canonical record accumulates metadata from more than one provider.
- Stop new duplicate creation during repeat Metron and OPDS/CWA syncs before attempting broad historical repair.
- Keep this milestone explicitly separate from:
  - OPDS browse/read/download link-contract cleanup,
  - broader provider-comparison work,
  - comic server-pagination normalization.

### Acceptance Criteria

- The dev dataset can be audited for duplicate clusters and likely comic/book misclassifications with a repeatable report.
- Identifier precedence and confidence bands are documented clearly enough to explain why rows merge, link for review, or remain separate.
- New Metron and OPDS/CWA syncs can enrich an existing canonical row instead of creating an obvious duplicate when confidence is high.
- Historical duplicates have a defined repair path that is dry-run-safe before any bulk merge/update step is applied.

### Active Slice Notes

- Keep provider and identifier matches as the first dedupe layer.
- After those hard identifiers, use the normalization contract during ingest only when confidence is `high`.
- Keep `medium` confidence matches out of auto-attach for now:
  - no silent merge for series + issue without volume,
  - no title/author auto-merge for books without stronger proof,
  - no historical backfill yet.
- Use the running dev dataset to verify that obvious duplicates stop creating new rows while review-scoped cases remain separate until a later slice adds an operator-facing decision path.
- Prove the new behavior with a runtime smoke that seeds a scoped existing comic row, imports a CSV duplicate through the real `/api/media/import-csv?sync=1` path, and confirms:
  - `created = 0`
  - `updated = 1`
  - `match_mode = matched_by_normalization_high`
  - `matched_by = normalization_series_issue_volume`
- Surface duplicate-attach evidence in the record drawer as a persistent but quiet `Merge details` section for books and comics rather than a transient banner or a heavy dedicated tab.
- Build the drawer evidence from the existing SQL repair history so canonical records can show:
  - how many merged records they absorbed,
  - the match confidence and rationale,
  - source summaries for canonical and merged rows,
  - field-level provenance for the current merged metadata.
- Keep the first provenance UI scoped to books and comics until the repair history model and drawer treatment have been validated on the running stack.
- Persist first-class merge evidence at duplicate-attach time so the drawer and API can read durable facts instead of reconstructing as much at read time:
  - confidence
  - match kind
  - merge key
  - rationale tokens
  - canonical-selection reason
- Expose that persisted evidence through the merge-details API as stable technical details for future operator tooling and provenance UI reuse.
- Surface medium-confidence matches in the import audit rather than reviving the retired review queue:
  - suppress plain title fallback when a `medium` normalization candidate is found,
  - keep the incoming row separate,
  - return review candidate details in `auditRows`,
  - track the candidate count in import `summary`.
- Make review-tier rows visibly distinct in the audit-only contract:
  - medium-confidence creates should emit `audit_outcome = review_candidate_created`,
  - import `summary` should track both review-candidate count and review-row count,
  - runtime smoke should prove those fields without introducing a merge action UI.
- Historical repair remains dry-run-only in this slice:
  - choose one canonical row per high-confidence duplicate cluster using deterministic precedence,
  - list the rows that would attach to that canonical record,
  - keep medium-confidence duplicate clusters in a review bucket,
  - emit likely comic-like `book` rows as separate reclassification candidates,
  - do not mutate data yet.
- Add a scoped comic-like book repair tool after the dry-run planner:
  - keep the mutation path opt-in with `--apply`,
  - allow narrow targeting by explicit ids and optional library scope,
  - preserve the previous `media_type` and `type_details` in `media_metadata` before reclassification,
  - prove the repair with a Docker-backed smoke that reclassifies one seeded `book` row into `comic_book` without attempting a broad sweep.
- Add a paired revert path before applying the repair to real candidate rows:
  - support explicit `--revert` restoration using the stored historical snapshot metadata,
  - keep the revert path narrowly scoped by ids and optional library scope,
  - record when a revert was executed,
  - prove the same Docker-backed smoke can restore the seeded row back to `book` with its prior metadata intact.
- Run one tiny real-data pilot before attempting any broader sweep:
  - choose only obvious OPDS comic-issue titles that already dry-run cleanly,
  - apply reclassification by explicit ids only,
  - verify the live rows and stored historical snapshot metadata directly in the running DB after mutation,
  - keep broader candidate sets untouched until the narrow pilot is judged safe.
- Continue with one additional tiny OPDS-only follow-on batch if the first pilot stays clean:
  - use the updated running repair report after the first mutation to choose the next obvious ids,
  - keep the second batch explicit-id only,
  - verify the same rollback metadata contract after apply,
  - still avoid fuzzy review cases like duplicate-leaning variant titles.
- Finish the obvious OPDS-only reclassification set before stopping this repair lane:
  - apply the final explicit-id OPDS issue rows that still dry-run cleanly,
  - re-run the live historical repair report afterward,
  - confirm that only fuzzy review cases remain once the obvious OPDS issue rows are exhausted.
- Switch from type reclassification into duplicate-attach repair once the obvious OPDS reclassification set is exhausted:
  - keep the attach tool restricted to explicit ids and one high-confidence normalization cluster at a time,
  - choose or override one canonical row, snapshot the duplicate onto the canonical row before deletion, and preserve a timestamped attach record in `media_metadata`,
  - merge missing canonical `type_details`, metadata, taxonomy, seasons, and rewired references like collection items before deleting the duplicate row,
  - prove the behavior with a Docker-backed smoke that seeds a canonical and duplicate row, enriches the canonical row from duplicate-only fields, rewires a collection item, and confirms the duplicate row is removed.
- Add a paired revert path for duplicate attach before using the tool on real duplicate clusters:
  - support explicit `--revert` restoration for one duplicate id within the explicit-id cluster,
  - store enough canonical pre-attach context to restore canonical `type_details`, metadata, taxonomy, and season ownership after the duplicate row is recreated,
  - rewire collection items, variants, and child series references back to the restored duplicate row,
  - prove the same Docker-backed smoke can round-trip `apply -> revert` with the duplicate row restored and the canonical enrichment removed.
- Run the first real-data duplicate-attach pilot only after the revert path is proven:
  - pick one obvious high-confidence cluster with a shared ISBN or fully matching comic identity and no review-tier ambiguity,
  - dry-run it first, then apply by explicit ids only,
  - verify directly in the running backend that the canonical row remains, the duplicate row is removed, and the canonical row now carries the duplicate attach snapshot/context metadata,
  - rerun the live historical repair report afterward and confirm the cluster count drops by one before attempting any second real-data duplicate attach.
- Harden duplicate-attach snapshot storage before widening the pilot set:
  - move large duplicate attach snapshot/context payloads out of `media_metadata` and into a dedicated repair-history store so larger real duplicates cannot hit metadata index row-size limits,
  - keep the existing revert path backward-compatible for any earlier metadata-backed pilot rows,
  - re-run init parity and migration rehearsal after the schema change,
  - retry the next tiny explicit-id duplicate-attach pilot only after the storage change is proven in Docker-backed smoke and the live repair report confirms the cluster count drops again.
- Continue with one more tiny ISBN-backed duplicate-attach pilot after the storage hardening lands:
  - choose another explicit-id high-confidence book pair from the running repair report,
  - verify the pair in the live DB before mutation,
  - apply the repair through the running backend and confirm the duplicate row is removed while `media_repair_history` records the attach,
  - rerun the live repair report afterward and confirm the safe duplicate cluster count drops again.
- Harden the duplicate-attach CLI around repeated explicit-id reruns:
  - if the requested duplicate row is already gone but the canonical row and unreverted attach history still exist, report the repair as already attached instead of throwing a misleading row-count failure,
  - prove the already-attached path against a real pilot pair in the running backend after the third pilot lands.
- Continue with one more tiny ISBN-backed duplicate-attach pilot after the already-attached guard is proven:
  - pick the next clean book pair from the running repair report,
  - dry-run it and inspect the live DB before mutation,
  - apply the repair through the running backend and confirm the duplicate row is removed while `media_repair_history` records the attach,
  - rerun the live repair report afterward and confirm the safe duplicate cluster count drops again.
- Continue with one more ISBN-backed book pilot after the fourth attach stays clean:
  - pick the next top book cluster from the running repair report instead of widening into comic duplicates yet,
  - verify that the pair still has no existing repair history and no review-tier ambiguity,
  - apply the attach through the running backend and confirm the duplicate row disappears while the canonical row remains unchanged apart from repair history,
  - rerun the live repair report and confirm the safe duplicate cluster count drops again before deciding whether to keep doing tiny book pilots or switch shape.
- Start the first comic duplicate attach pilot only after the book lane proves repeatable:
  - choose one explicit-id duplicate from the cleanest `series + issue + volume` comic cluster instead of collapsing an entire comic cluster at once,
  - verify in the running backend that the canonical and chosen duplicate share the same normalized comic identity and have no prior repair history,
  - apply the attach for that one duplicate only and confirm the duplicate row is removed while `media_repair_history` records the attach,
  - rerun the live repair report afterward and confirm the report rolls forward to the next comic duplicate in the sequence without disturbing review-tier cases.
- Continue with a second comic duplicate pilot before changing the repair shape:
  - use the next issue in the same clean comic family so the validation stays apples-to-apples with the first comic pilot,
  - verify the canonical and selected duplicate still share the same provider issue id, normalized comic identity, and no prior repair history,
  - attach only one duplicate row and rerun the live repair report afterward,
  - confirm the report advances cleanly to the next issue before deciding whether the comic lane is ready for repeated one-at-a-time work or any broader batching rule.

### Closeout Notes

- Books and comics now follow one explicit normalization contract across ingest and historical repair:
  - high-confidence matches attach to a canonical row,
  - medium-confidence matches stay visible and review-scoped,
  - low-confidence rows remain separate.
- Historical cleanup is no longer theoretical:
  - comic-like `book` rows have a rollback-safe reclassification path,
  - duplicate attach repairs have rollback-safe revert support,
  - both lanes were proven with Docker-backed smokes and narrow real-data pilots.
- Canonical rows can now accumulate more than one absorbed duplicate without losing explainability:
  - repair history stores durable merge evidence,
  - the drawer shows persistent match evidence with provider/source labels,
  - partial revert proof confirms one merge event can be restored without disturbing another still-active merge.
- The drawer treatment intentionally stops short of a user-facing repair action surface:
  - match evidence stays inline and read-only for now,
  - any future revert affordance should begin as an operator-facing action, not a default end-user drawer control.
- The milestone closed with semver/release alignment on `3.1.6`, including release notes, the in-app release feed snapshot, rebuilt platform/homelab stacks, green RBAC/browser/edition-boundary gates, and live Help > Releases proof on the running stack.

**Status:** Completed on `2026-04-18`

## 3.2.0 — Manual Media Merge Review and Apply Workflow

**Goal:** Add a controlled operator-facing manual merge workflow so supported media types can be reviewed, compared, merged, and reverted intentionally without allowing unsafe cross-type merges.

**Status:** Completed on `2026-04-19`

- Start with same-type manual merge only:
  - books
  - comics
  - movies
  - TV
  - games
  - audio
  - collectibles
  - events
- Explicitly block cross-type merges such as:
  - `book -> tv`
  - `movie -> game`
  - `comic -> audio`
- Keep the first implementation operator/admin-facing, pairwise, preview-first, and revert-safe.
- Reuse the existing repair-history, match-evidence, and revert model instead of inventing a second merge system.

### Scope

- Add a manual merge workflow for same-type records across the supported media families.
- Build a preview surface that compares:
  - canonical record candidate,
  - matched record candidate,
  - current metadata from both records,
  - expected winning values,
  - rewired dependents,
  - resulting provenance/evidence.
- Reuse the existing duplicate-attach repair model where practical so manual merge preserves:
  - merge evidence,
  - source/provider summaries,
  - repair history,
  - revert behavior,
  - drawer-visible provenance.
- Keep the first action surface operator/admin-only rather than turning the normal record drawer into a general-purpose merge workstation.
- Keep merge preview and apply pairwise:
  - one canonical record,
  - one duplicate record,
- Capture operator outcomes for recommended pairs so accepted and rejected decisions can inform future merge automation without mutating records when a pair is rejected.
- Keep medium-confidence generic recommendations skeptical around franchise wrappers, volume/season titles, and generic subtitles so broad series names do not overpower the specific item identity.
  - one explicit confirmation.
- Keep the work explicitly separate from:
  - broader ingest/provider normalization changes already completed in `3.1.6`,
  - cross-type record conversion,
  - batch merge automation.

### Acceptance Criteria

- Operators can preview a same-type merge before applying it.
- The preview clearly shows canonical vs matched values and the expected post-merge record shape.
- Cross-type merge attempts are blocked explicitly and explained clearly.
- Applied manual merges persist evidence through the existing repair-history model and remain visible in the drawer provenance surface.
- Manual merges can be reverted through the same historical repair model rather than becoming one-way destructive actions.

### Active Slice Notes

- Define the operator boundary first:
  - read-only drawer evidence remains available to normal users,
  - preview/apply/revert actions stay out of the default drawer flow,
  - first implementation should live behind operator/admin permissions.
- Start with a read-first merge preview contract before adding apply:
  - canonical id,
  - duplicate id,
  - same-type validation result,
  - field-by-field comparison,
  - resulting value selection,
  - dependent rewiring summary,
  - existing merge/revert history if present.
- Prefer one API contract that future UI surfaces can reuse:
  - operator review surface,
  - future action menu entry,
  - possible support-session tooling later.
- Treat the `3.1.6` merge evidence drawer as the user-visible provenance layer, not as the primary action surface for manual merge.
- The first operator UI should stay scoped and quiet:
  - live in the admin/operator lane rather than the normal drawer,
  - use active workspace/library scope,
  - preview one canonical record plus one matched record at a time,
  - help operators find candidate records inside the current scope instead of assuming they already know both ids,
  - show compared fields, winning values, rewiring impact, and history context,
  - add apply only as an explicit operator confirmation step on top of the preview contract,
  - keep revert for a later operator slice rather than crowding the first apply workflow.
- Use the next slice to bridge manual review toward future automation:
  - surface conservative same-type recommended pairs in active scope,
  - rank high-confidence identity matches ahead of medium-confidence title/year matches,
  - let operators flow from a recommendation into the existing preview/apply path,
  - keep rejection/outcome learning for a later follow-up slice.

### Milestone Closeout

- Operators now have a full manual merge workflow across supported same-type media:
  - preview,
  - apply,
  - revert,
  - reject,
  - defer,
  - suppressed-pair history restore,
  - duplicate discovery,
  - collection duplicate review,
  - inline lane-native review continuity.
- Discovery hardening now blocks the highest-volume false-positive classes we encountered during operator review:
  - franchise/series wrapper collisions,
  - comic issue-title namespace mismatches,
  - movie exact-title collisions with conflicting identity fields.
- Good messy matches remain reviewable instead of disappearing behind over-tight rules:
  - packaging-heavy movie titles,
  - partial-director overlap,
  - missing-one-side identifier cases.
- Merge provenance is now a shared drawer primitive rather than a books/comics-only affordance.
- Manual merge apply writes activity evidence and preserves absorbed provider/sync identities so future imports can resolve back to the canonical row.
- Re-sync durability is runtime-proven today for:
  - provider-item / Calibre-style alias reuse,
  - Plex `plex_guid` / `plex_item_key` alias reuse.
- The milestone closes with semver/release artifact alignment on `3.2.0`, including:
  - synced app/package metadata,
  - matching `docs/releases/v3.2.0.md`,
  - regenerated `backend/release-feed.json`,
  - authenticated running-stack `Help > Releases` proof on both platform and homelab containers.
- The next priority moves into a new milestone focused on re-sync durability proofs rather than extending the manual merge milestone indefinitely.

## 3.2.1 — Re-Sync Idempotency and Canonical Reuse Proofs

**Goal:** Prove that merged canonical records survive repeat imports and later syncs across supported providers without silently recreating duplicates or attaching conflicting identities to the wrong row.

**Current Slice:** `Merge Revert Re-Sync Integrity Smoke`

### Scope

- Add Docker-backed runtime proofs for import and sync paths that can recreate duplicates after operator merges.
- Prove alias-preserved canonical reuse when the same content is imported again from the same provider.
- Prove repeat-sync idempotency where supported import contracts should update-or-no-op instead of create.
- Keep the work proof-first rather than widening the merge UI unless a failing proof exposes a real runtime bug.
- Prioritize:
  - Metron re-sync alias proof
  - repeat-sync idempotency smokes
  - cross-source canonical reuse
  - multi-hop merge alias reuse
  - merge revert re-sync integrity

### Acceptance Criteria

- Active provider/sync paths have concrete runtime smokes proving canonical reuse after merge.
- Reimporting the same content on proven paths does not recreate duplicate rows in the active scope.
- Failures identify the exact provider identity field or sync assumption that regressed.
- The resulting proof matrix is strong enough to support future ingest and dedupe work without guesswork.

### Active Slice Notes

- Start with Metron/comics because that path still lacks the same post-merge re-sync proof we now have for provider-item imports and Plex.
- Use the real `POST /api/media/import-comics?sync=1` path, not a mock-only helper.
- Prefer a fake Metron provider that exercises the real collection and issue-detail fetch flow over a direct DB-only proof.
- Verify that alias-preserved canonical reuse updates the merged canonical comic instead of creating a new duplicate row.
- Follow with the CSV-family import endpoints because they are the widest repeat-import surface today:
  - generic CSV,
  - Calibre CSV,
  - Delicious CSV.
- Prove each supported CSV import path is idempotent when the same source payload is imported twice into the same scope.
- Then prove the same scoped title can move across different import families without forking into duplicates:
  - create from one source,
  - update from a second source,
  - update again from a third source,
  - while preserving one canonical row.
- Then prove alias reuse survives multi-hop merge history:
  - merge duplicate B into canonical A,
  - merge canonical A into canonical C,
  - reimport identities from both A and B,
  - and confirm they both resolve to C.
- Finally prove revert integrity:
  - merge a duplicate into a canonical row,
  - revert that merge,
  - reimport the old duplicate identity,
  - and confirm the restored duplicate row, not the former canonical, receives the update without creating a third row.

### Closeout Notes

- `3.2.1` closed with Docker-backed runtime proof for:
  - Metron re-sync alias reuse,
  - CSV-family repeat-import idempotency,
  - CSV-family cross-source canonical reuse,
  - multi-hop merge alias reuse,
  - merge revert re-sync integrity.
- The milestone also fixed a real revert-path bug where duplicate-only preserved identity aliases could remain attached to the former canonical after revert.
- Version closeout for `3.2.1` includes:
  - synced app/package metadata,
  - matching `docs/releases/v3.2.1.md`,
  - regenerated `backend/release-feed.json`,
  - authenticated running-stack `Help > Releases` proof on platform and homelab containers.

## 3.2.2 — Release Gate and Evidence Hardening

**Goal:** Reduce the gap between local release closeout evidence and the CI gates that still decide whether a patch is truly ready to ship.

**Status:** Completed.
**Current Slice:** `Local Preflight Audit and Go/No-Go Report`

### Scope

- Add repo-native local preflight helpers that generate release-facing evidence instead of relying on ad hoc manual command transcripts.
- Generate local dependency-audit artifacts in the same shape CI expects for release closeout.
- Generate a local go/no-go report that records:
  - version alignment,
  - dependency audit status,
  - compose-smoke basics against the live stack,
  - discovered blocked CI-only gates.
- Keep the patch focused on release hardening and evidence quality, not new end-user product features.

### Acceptance Criteria

- Maintainers can generate `dependency-audit` artifacts locally without hand-assembling them.
- Maintainers can generate a local `preflight-go-no-go.md` that explicitly distinguishes:
  - passed local evidence,
  - failed local gates,
  - blocked CI-only gates.
- The preflight helper uses the running stack for runtime checks where the stack can answer directly.
- The resulting report is good enough to attach to a release closeout without reconstructing the gate state from memory.

### Active Slice Notes

- Start by mirroring the CI dependency-audit artifact shape locally:
  - `artifacts/dependency-audit/backend-audit.json`
  - `artifacts/dependency-audit/frontend-audit.json`
- Record the live local compose-smoke basics directly from the running stack:
  - `/api/health`,
  - response security headers,
  - CSRF cookie issuance,
  - unauthenticated `/api/auth/me`,
  - API integration smoke.
- Make blocked CI-only gates explicit in the generated report instead of silently omitting them.
- Keep the helper text aligned with `docs/wiki/17-Release-Go-No-Go-Checklist.md` and `.github/workflows/docker-publish.yml`.

### Closeout Notes

- `3.2.2` closed with:
  - repo-native local release preflight generation,
  - regenerated dependency-audit artifacts,
  - a refreshed `preflight-go-no-go.md`,
  - `follow-redirects` remediation to `1.16.0` in backend and frontend dependency trees,
  - browser-regression proof updated for the current tabbed merge-review flow.
- Version closeout for `3.2.2` includes:
  - semver/app metadata sync to `3.2.2`,
  - matching `docs/releases/v3.2.2.md`,
  - regenerated `backend/release-feed.json`,
  - running-stack `Help > Releases` verification on platform and homelab.
- Remaining release follow-through stays in CI:
  - `secret-scan`,
  - `image-security-and-sbom`,
  - stricter CI `compose-smoke` conditions beyond the local development stack's secure-cookie profile.

## 3.2.3 — Scope-Isolated Merge Re-Sync Boundaries

**Goal:** Prove that preserved merge identities only resolve within the correct active scope so later re-syncs cannot update or recreate records in the wrong space or library when overlapping identifiers exist elsewhere.

**Status:** Completed.
**Current Slice:** `Scope Isolation Re-Sync Smoke`

### Scope

- Add a Docker-backed runtime smoke that exercises post-merge re-sync behavior across more than one scope.
- Prove that a re-sync in one scope reuses the intended canonical row only inside that same scope.
- Prove that overlapping provider or alias identifiers in another scope do not get updated, absorbed, or recreated by the wrong re-sync.
- Keep the patch focused on merge-boundary correctness rather than widening the operator merge UI.

### Acceptance Criteria

- A runtime smoke proves a merged canonical record is reused only inside its own scope on later re-sync.
- The same incoming identifier does not attach to or mutate rows outside the active scope.
- If the proof exposes a scope-resolution bug, the bug is fixed before `3.2.3` closes.
- The milestone ends with a clear statement of what scope-isolated merge/re-sync behavior is now proven versus what remains future proof work.

### Active Slice Notes

- Start with the narrowest high-value boundary:
  - one canonical merge in scope A,
  - an overlapping external/provider identity in scope B,
  - a later re-sync in scope A,
  - and proof that only scope A is touched.
- Prefer using a real supported re-sync path rather than a DB-only helper so the proof exercises the live route-level scope rules.
- Treat this as the first promoted item from the merge-proof backlog rather than trying to solve the whole remaining matrix in one patch.
- Keep the still-unscheduled follow-up proof families out of this milestone for now:
  - provider-family cross-source canonical reuse beyond the current CSV matrix,
  - collection re-sync boundary behavior,
  - strong-id conflict guards,
  - sparse-metadata alias reuse.

### Closeout Notes

- `3.2.3` closed with Docker-backed runtime proof that:
  - a manually merged canonical record in library A is reused on later scoped re-sync,
  - the same overlapping provider identity in library B remains untouched until its own scoped re-sync runs,
  - and neither scoped import creates an extra row while `provider_item_id` matching stays isolated to the active library context.
- The milestone also tightened the smoke harness itself by:
  - switching the runtime actor to a normal library-switching user,
  - and using the direct manual merge helper to seed the merged precondition without relying on admin-only support-session flows.
- Version closeout for `3.2.3` includes:
  - semver/app metadata sync to `3.2.3`,
  - matching `docs/releases/v3.2.3.md`,
  - regenerated `backend/release-feed.json`,
  - running-stack `Help > Releases` verification on platform and homelab.

## 3.2.4 — Strong-Identifier Merge Conflict Guards

**Goal:** Prove that later syncs and imports refuse to mutate an existing canonical row when strong identifiers materially conflict, even if weaker title or packaging signals look similar.

**Current Slice:** `Strong-Identifier Conflict Guard Smoke`

### Scope

- Add a Docker-backed runtime smoke for a same-title or near-same-title sync/import case where strong identifiers disagree.
- Prove that the incoming row does not auto-attach to the wrong canonical when:
  - provider identity conflicts,
  - canonical alias reuse would be unsafe,
  - or stronger identifiers disagree with the apparent title match.
- Keep the patch focused on duplicate-avoidance safety and sync correctness rather than expanding merge UI.

### Acceptance Criteria

- A runtime smoke proves the wrong canonical is not updated when strong identifiers conflict.
- The conflicting content remains separate instead of silently mutating an existing canonical row.
- If the proof exposes an unsafe auto-attach path, the bug is fixed before `3.2.4` closes.
- The milestone ends with a clear statement of which strong-id conflict cases are now guarded in runtime proof.

### Active Slice Notes

- Start with the highest-risk case:
  - a previously merged canonical exists,
  - a later sync/import arrives with a misleadingly similar title,
  - but strong identifiers conflict,
  - and the runtime proof confirms the canonical is left untouched.
- Prefer a real supported sync/import path over a DB-only setup so the proof exercises the live matching logic.
- Keep the remaining merge-proof follow-ups out of this patch for now:
  - provider-family cross-source canonical reuse beyond the current CSV matrix,
  - collection re-sync boundary behavior,
  - sparse-metadata alias reuse.
- The completed `3.2.4` runtime proof matrix now covers:
  - book conflict guard via ISBN on the generic CSV import path,
  - movie conflict guard via UPC on the generic CSV import path,
  - movie conflict guard via TMDB on the Plex import path.
- Version closeout for `3.2.4` includes:
  - semver/app metadata sync to `3.2.4`,
  - matching `docs/releases/v3.2.4.md`,
  - regenerated `backend/release-feed.json`,
  - running-stack `Help > Releases` verification on platform and homelab.

## 3.2.5 — Provider-Family Cross-Source Canonical Reuse

**Goal:** Prove that canonical reuse survives across a real non-CSV provider-family boundary so later syncs do not fork the same content into duplicate canonicals when provider contracts change.

**Current Slice:** `Sparse-Metadata Alias Reuse Smoke`

### Scope

- Extend the existing canonical-reuse proof matrix beyond the CSV-family coverage already shipped in `3.2.1`.
- Choose a real mixed provider-family path where the same item can plausibly arrive through different source contracts.
- Prove that the later provider-family sync reuses the existing canonical row instead of creating a duplicate.
- Keep the work proof-first unless runtime evidence exposes a real merge or sync bug.

### Acceptance Criteria

- A Docker-backed runtime smoke proves one canonical row is reused across the selected provider-family boundary.
- The later provider-family sync updates or no-ops instead of creating a duplicate row.
- The proof clearly identifies the stable identity contract that allowed the reuse.
- If the proof exposes an unsafe cross-family attach gap, the bug is fixed before `3.2.5` closes.

### Active Slice Notes

- Start with the highest-confidence mixed provider-family path:
  - a canonical movie row created by a non-Plex source contract,
  - a later Plex sync for the same title family,
  - and TMDB identity proving the existing canonical should be reused.
- Prefer a runtime shape where the seeded canonical title intentionally differs from the later Plex title so the proof demonstrates TMDB-based reuse rather than a weaker title fallback.
- Add a second proof shape for this patch:
  - a merged canonical with preserved duplicate aliases,
  - a later metadata-poor follow-up payload,
  - and runtime proof that alias reuse still resolves the update onto the canonical row.
- Keep the remaining merge-proof follow-ups out of this patch for now:
  - collection re-sync boundary behavior.
- The completed `3.2.5` runtime proof matrix now covers:
  - non-Plex canonical reuse by a later Plex sync through `tmdb_id`,
  - sparse post-merge CSV follow-up reuse through preserved `provider_item_id` aliases,
  - and canonical metadata preservation under degraded `type_details` payloads.
- Version closeout for `3.2.5` includes:
  - semver/app metadata sync to `3.2.5`,
  - matching `docs/releases/v3.2.5.md`,
  - regenerated `backend/release-feed.json`,
  - running-stack `Help > Releases` verification on platform and homelab.

## 3.2.6 — Collection Re-Sync Boundaries

**Goal:** Prove that collection merge decisions remain durable when collection-shaped imports run again later, so merged collection containers do not silently reappear as duplicates.

**Current Slice:** `Collection Re-Sync Boundary Smoke`

### Scope

- Promote the collection-side duplicate-prevention work out of backlog and keep it narrowly focused on durability of merged collections.
- Exercise a real collection-shaped import path rather than a DB-only reconstruction.
- Prove that a previously absorbed collection identity can still resolve onto the surviving canonical collection after merge.
- Keep the patch focused on collection duplicate prevention and boundary durability rather than expanding collection UI or editing flows.

### Acceptance Criteria

- A Docker-backed runtime smoke proves a merged collection state survives later collection-shaped import activity without recreating a duplicate collection row.
- The surviving canonical collection remains the landing point for the later import even when the absorbed collection arrived from a different source/title identity.
- Collection-linked item relationships remain consistent after the re-sync.
- If the proof exposes a collection identity gap, the bug is fixed before `3.2.6` closes.

### Active Slice Notes

- Start with the highest-risk collection recreation shape:
  - a canonical collection survives a manual merge,
  - the absorbed duplicate came from a collection-shaped import source,
  - and that same collection import runs again later.
- Prefer the generic CSV boxed-set path first because it exercises the real `ensureImportCollection(...)` boundary used by collection-only imports.
- The proof should show both:
  - no duplicate collection row recreated,
  - and the surviving canonical collection still able to absorb collection item updates from the re-sync.
- The completed `3.2.6` runtime proof now covers:
  - preservation of absorbed collection import identities during collection merge apply,
  - alias-aware collection reuse on later boxed-set CSV imports,
  - and canonical collection reuse without duplicate container recreation across platform and homelab stacks.
- Version closeout for `3.2.6` includes:
  - semver/app metadata sync to `3.2.6`,
  - matching `docs/releases/v3.2.6.md`,
  - regenerated `backend/release-feed.json`,
  - running-stack `Help > Releases` verification on platform and homelab.

## 3.2.7 — OPDS / Digital-Library Dedupe Hardening

**Goal:** Re-enable the deferred OPDS/CWA import path behind a proof-first dedupe contract so digital-library syncs can repeat safely without recreating duplicate book or comic rows when stable provider identities already exist.

**Current Slice:** `Version Closeout`

### Scope

- Promote the digital-library duplicate-prevention work out of backlog and keep this patch tightly focused on dedupe-safe OPDS/CWA reintroduction rather than broader provider comparison.
- Re-enable the real `/api/media/import-cwa` runtime path instead of leaving the importer service stranded behind a deferred route.
- Prove that repeat OPDS/CWA syncs reuse the same canonical row through stable provider identities such as `provider_item_id` / `calibre_entry_id`.
- Keep the patch focused on repeat-import idempotency and duplicate prevention before widening into richer OPDS link semantics or broader digital-library product UX.

### Acceptance Criteria

- A Docker-backed runtime smoke proves the same OPDS/CWA entry imported twice updates or no-ops instead of creating a duplicate row.
- The live `/api/media/import-cwa` route uses the existing importer service rather than returning the deferred `410` response.
- The resulting imported row preserves the provider identity fields needed for later dedupe and alias reuse.
- If the proof exposes a route-level or type-details merge bug, the bug is fixed before `3.2.7` closes.

### Active Slice Notes

- Start with the smallest truthful milestone boundary:
  - one OPDS/CWA importer path,
  - one repeat-sync idempotency proof,
  - one canonical row reused across reruns.
- The current codebase already contains:
  - `backend/services/cwa.js`,
  - OPDS entry normalization,
  - and product/setup docs describing a dedupe-safe importer,
  - but the live route is still deferred with `cwa_import_deferred`.
- The first slice should therefore:
  - re-enable the route,
  - drive the real importer through a deterministic OPDS fixture/feed,
  - and prove duplicate-safe repeat import behavior on both platform and homelab stacks.
- The completed first slice now covers:
  - live `/api/media/import-cwa` re-enabled through the existing OPDS importer service,
  - Docker-backed repeat-sync idempotency proof on platform and homelab,
  - and canonical book reuse through persisted `provider_item_id` / `calibre_entry_id` identity fields instead of duplicate row recreation.
- The next active slice tightens the OPDS contract without widening provider scope:
  - preserve browse/detail URLs separately from acquisition/download URLs,
  - stop treating OPDS links as generic `tmdb_url` surrogates for books and comics,
  - and prove the stored link contract through a Docker-backed runtime smoke before any broader reader-link UX work.
- The completed second slice now covers:
  - browse/detail and download/acquisition OPDS link separation,
  - `tmdb_url` cleanup for OPDS-imported books and comics,
  - and Docker-backed link-contract proof on platform and homelab.
- The next active slice adds one comic-heavy dedupe proof before closeout:
  - drive the live `/api/media/import-cwa?sync=1` path with a clearly comic-shaped OPDS entry,
  - prove it imports as `comic_book` with parsed `series`, `issue_number`, and `volume`,
  - and confirm a second sync reuses the same canonical row through persisted OPDS identities instead of recreating a duplicate comic row.
- The completed third slice now covers:
  - a Docker-backed comic-heavy OPDS runtime proof on platform and homelab,
  - `comic_book` classification plus persisted `series`, `issue_number`, and `volume`,
  - and duplicate-safe canonical reuse through `provider_item_id` / `calibre_entry_id` on repeat sync.
- Version closeout for `3.2.7` includes:
  - semver/app metadata sync to `3.2.7`,
  - matching `docs/releases/v3.2.7.md`,
  - regenerated `backend/release-feed.json`,
  - and running-stack `Help > Releases` verification on platform and homelab.
- Keep the remaining digital-library follow-up out of this patch for now:
  - provider comparison and alternative reader evaluation,
  - and larger-scale comic-heavy dedupe tuning.

## 3.2.8 — Comic Sort and Server Pagination Normalization

**Goal:** Remove the comic-book full-fetch exception by moving comic ordering and series browsing onto a server-backed pagination path that relies on stable comic identity fields instead of client-only full-list sorting.

**Current Slice:** `Version Closeout`

### Scope

- Promote comic-heavy normalization quality work out of backlog and keep it distinct from the `3.2.7` dedupe milestone.
- Reassess the current comic library/list path where the frontend requests a single large page and sorts issues client-side for practical issue ordering.
- Determine whether stable server-side ordering can be built directly from existing comic identity fields first:
  - `series`
  - `issue_number`
  - `volume`
- If JSONB-based query logic becomes too brittle or unreadable, introduce dedicated normalized comic sort fields with a backfill/repair plan for older rows.
- Keep the first slice focused on query contract and runtime proof shape before widening into larger comic UI redesign.

### Acceptance Criteria

- A server-backed path for comic ordering and series browsing is defined clearly enough to replace the current comic full-fetch exception.
- The chosen contract explains whether it relies on existing `type_details`, new normalized sort fields, or both.
- The milestone proves comic issue ordering can remain stable without requiring the full comic issue set in browser memory.
- If the proof exposes missing comic sort metadata on existing rows, the follow-up repair/backfill path is defined before `3.2.8` closes.

### Active Slice Notes

- This belongs in `3.2.8` rather than `3.2.7` because it follows the comic-heavy OPDS dedupe hardening without widening that release beyond import/sync correctness.
- Audit findings for the first slice:
  - the backend list route still allowed a comic-specific `limit=5000` ceiling,
  - the frontend `LibraryView` still forced comics onto `page=1` with `limit=5000`,
  - and comic issue ordering plus page slicing still happened in browser memory.
- Chosen first contract:
  - add a server-backed `comic_issue` sort built from existing `type_details.series`, `issue_number`, and `volume` with title fallback parsing,
  - use normal API pagination for the main comic `issues` view,
  - then add a paginated `/api/media/comic-series` summary path for the `series` tab,
  - then add a paginated `/api/media/comic-series/issues` path for selected-series issue browsing,
  - while allowing the `series_issues` view to reuse normal paged `issues` results when the selected series filter is still `all`.
- Runtime proof for the first slice must show:
  - the comic issue list honors requested page size,
  - page-to-page issue ordering stays stable in server results,
  - the comic series list returns grouped summaries with true series counts and paging,
  - the selected-series issues list returns only the chosen series with stable in-series ordering and paging,
  - and the browser no longer needs the full comic issue set in memory for the default `issues`, `series`, or selected-series `series_issues` tabs.
- Keep broader comic UI cleanup and drawer work out of this milestone unless the query contract forces it.
- The completed milestone now covers:
  - server-backed `comic_issue` ordering for the default comic `issues` tab,
  - paginated grouped `/api/media/comic-series` summaries for the `series` tab,
  - paginated `/api/media/comic-series/issues` browsing for selected-series `series_issues`,
  - and Docker-backed platform plus homelab runtime proof that the browser no longer needs the comic full-fetch exception for those browsing paths.
- Version closeout for `3.2.8` includes:
  - semver/app metadata sync to `3.2.8`,
  - matching `docs/releases/v3.2.8.md`,
  - regenerated `backend/release-feed.json`,
  - and running-stack `Help > Releases` verification on platform and homelab.

## 3.2.9 — Comic Overview Validation and Metron Description Handling

**Goal:** Prevent comic edit saves from failing when provider-enriched Metron descriptions exceed the local `overview` validation limit.

**Current Slice:** `Version Closeout`

### Scope

- Reproduce the comic edit flow where reselecting Metron metadata for an existing comic can return a description longer than the current `overview` validation cap.
- Decide and implement the provider-handling rule explicitly:
  - auto-truncate Metron description text to the allowed limit before save,
  - while keeping the field editable in the drawer,
  - and preserving backend-safe behavior for direct API clients too.
- Keep the edit drawer usable if overview editing remains visible:
  - the field should not overflow or crowd out the rest of the drawer workflow.
- Ensure activity and error surfaces no longer fail with a generic validation surprise when the provider payload is otherwise valid.
- Add runtime proof for the exact comic re-enrichment case:
  - existing comic row,
  - Metron lookup reselected,
  - oversized provider description,
  - successful save with deterministic truncation behavior.

### Acceptance Criteria

- Re-enriching and saving a comic with an oversized Metron description no longer fails on the current `overview` validation cap alone.
- The chosen behavior for oversized descriptions is documented and consistent in UI and backend handling.
- Truncation is deterministic and preserves a readable summary.
- The edit drawer remains usable without layout overflow.
- The exact Alpha Flight-style repro shape is covered by a regression proof.

### Active Slice Notes

- This belongs in `3.2.9` rather than widening `3.2.8`, because it is a comic edit and provider-validation bug rather than a comic query contract issue.
- The current failure shape is:
  - comic lookup applies Metron `overview` into the edit form,
  - submit sends that text unchanged,
  - backend validation rejects `overview` values longer than 10,000 characters.
- The chosen first fix should be layered:
  - clamp the overview before applying provider lookup data in the drawer,
  - keep the field editable,
  - clamp again in backend validation so non-UI clients cannot trigger the same failure,
  - and prove the exact re-enrichment save path through a Docker-backed fake-Metron smoke.

## 3.2.10 — Comic Provider Search Result Thumbnails

**Goal:** Make comic provider re-enrichment easier to scan by showing compact cover thumbnails directly in the lookup result list.

**Current Slice:** `Version Closeout`

### Scope

- Add a small thumbnail to provider lookup results in the edit drawer overlay.
- Reuse the poster/image data already returned by comic and other provider lookup flows instead of adding a new provider contract.
- Keep the result list compact and readable:
  - thumbnail should not dominate the row,
  - text and source badges should still scan well,
  - rows should degrade gracefully when no image is available.
- Preserve the current apply behavior and result ordering.

### Acceptance Criteria

- Comic search results show a compact cover thumbnail when provider image data is present.
- Result rows remain usable when images are missing.
- The change works with the existing lookup payload shape and does not require provider API changes.
- Frontend regression coverage proves the thumbnail rendering contract is present in the source.

### Active Slice Notes

- This belongs after `3.2.9` as a small comic UX refinement rather than reopening the Metron validation bugfix patch.
- The current lookup payloads already include image candidates like:
  - `image`
  - `poster_path`
  - type-specific poster fields under enrichment results
- The slice should stay render-only unless the runtime proof shows the payload shape needs cleanup first.

## 3.3.0 — Library Loans Tracking

**Goal:** Add a loans workflow to the library so borrowed items, borrower details, and reminder timing can be tracked without disrupting the core catalog experience.

**Current Slice:** `Loans View Management Polish`

### Scope

- Promote library loans tracking out of backlog and define the smallest durable product contract before building reminder delivery or broader support flows.
- Track the essential loan record fields:
  - media item,
  - borrower name,
  - loan date,
  - format,
  - expected return date,
  - borrower email.
- Fit loans into the existing library workflow without turning the main catalog views into a support-style queue.
- Keep reminder work in scope only as far as needed to define how reminder eligibility and timing should be stored and triggered.
- Use the first slice to determine:
  - where the loans surface belongs in the current app shell,
  - whether loans should be item-attached only or also browsable in a dedicated view,
  - and what the minimal DB/API contract needs to be for later reminder delivery.

### Acceptance Criteria

- The loans workflow contract is defined clearly enough to implement without re-deciding ownership, placement, and reminder primitives mid-slice.
- The chosen loans surface fits the existing library experience without disrupting normal catalog browsing.
- The required DB/API shape for recording and later reminding from a loan record is called out explicitly.
- If reminder delivery is not fully implemented in the first milestone slice, the storage and trigger boundary is still defined before the milestone closes.

### Active Slice Notes

- This belongs after `3.2.10` as a fresh minor-feature milestone rather than another comic/provider follow-up or a patch-sized cleanup.
- The first slice should stay contract-first:
  - decide UI placement,
  - decide item-attached versus dedicated-list behavior,
  - define the minimal reminder-ready record shape,
  - then implement from that contract instead of letting reminder behavior leak into the initial schema by accident.
- Contract audit outcome:
  - loans should be item-attached at creation time but also browsable in a dedicated library-level loans view,
  - item-attached alone would hide overdue and due-soon workflow too deeply inside per-title drawers,
  - reminder delivery should be designed around stored eligibility fields first rather than a full scheduler in the initial slice.
- Preferred initial product shape:
  - add a `library-loans` view in the existing library/dashboard family,
  - add a loan action and active-loan summary inside the media detail drawer,
  - keep loan return and borrower edits reachable from the dedicated loans view.
- Foundation slice now verified:
  - `media_loans` exists in both `init.sql` and migrations with one-active-loan-per-media protection,
  - scoped loan create/list/update/return APIs are documented in OpenAPI,
  - the media detail drawer can record and return loans,
  - the dedicated `library-loans` view can browse active, overdue, returned, and all loans,
  - a Docker-backed smoke proves create, update, return, and history behavior on both platform and homelab stacks.
- Current polish slice focus:
  - make the dedicated loans view feel like the management surface for everything currently out,
  - show accurate status counts across the scoped result set,
  - surface due-soon and overdue urgency more clearly without pulling full reminder delivery into the same milestone.
- Preferred minimal DB/API contract:
  - a separate `media_loans` table rather than adding single loan fields directly onto `media`,
  - one active loan per media item at a time, enforced by an active-loan constraint,
  - fields for `media_id`, `library_id`, `space_id`, `borrower_name`, `borrower_email`, `loaned_at`, `due_at`, `returned_at`, `loan_format`, and optional notes,
  - reminder-ready timestamps/status fields can exist without requiring full reminder sending in the first implementation slice.
- Preferred first implementation slice after this audit:
  - create and return loans,
  - show active/overdue loans in a dedicated list,
  - leave actual outbound reminder sending for a later slice once the record lifecycle is proven.


## 2.4.3 — Drawer-First Editing Compactness Experiment (Rollback-Safe)

**Goal:** Run a contained UI experiment to unify detail/edit into slide-over drawers, reduce field sprawl, and validate usability before broader UI refactors.

### Scope

- Unify title and collection editing into drawer surfaces (same shell as detail drawer) with size variants:
  - detail drawer: narrow,
  - edit drawer: wide.
- Compact edit layout:
  - condense narrow-value fields (`rating`, `runtime`, year-like numerics, and similar) to right-sized widths,
  - reduce unnecessary full-width controls while preserving readability.
- Movie editions baseline:
  - if only one edition exists, default label to `Theatrical`,
  - add editable edition text field in primary movie metadata section (near type/format/year).
- Library quick-filter select behavior by media type:
  - Movies/TV: keep resolution filter,
  - Games: platform filter,
  - Comic Books: publisher filter,
  - Audio/Books: hide select when no meaningful quick-filter is available.
- Import view sub-navigation parity with Integrations:
  - add import submenu in alphabetical order: `Barcode`, `Calibre`, `CSV`, `Delicious`, `Plex`.

### Delivery Guardrails (Rollback)

- Implement behind one feature flag (`ui_drawer_edit_experiment`).
- Keep current full edit modal path intact as fallback.
- No schema migrations in this milestone.
- Rollback path: disable flag and redeploy.

### Acceptance Criteria

- Drawer edit mode is usable on desktop/mobile without regression to save/delete/convert flows.
- Compact field sizing improves scan/edit speed without truncation or validation confusion.
- Movie edition default/edit behavior works for single-edition titles.
- Media-type-specific quick filter select behavior is correct for each library type.
- Import submenu behaves consistently with integrations nav pattern.
- Flag-off behavior exactly restores current UI flow.

## 2.4.3.1 — Drawer/Filter Follow-Up + Metron API Compliance

**Goal:** Close post-validation gaps from `2.4.3` and align comics provider behavior with documented API limits.
**Status:** Completed.

### Scope

- Resolution quick-filter precision:
  - change movie resolution buckets to non-overlapping rules (exact target class),
  - remove current overlap behavior between `SD`, `720`, `1080`, and `4K`.
- TV resolution visibility:
  - ensure Plex import persists per-title/per-variant resolution for TV items,
  - make TV resolution quick-filter return expected rows based on imported Plex metadata.
- Metron API compliance hardening:
  - send a dedicated non-browser `User-Agent` header for all Metron requests,
  - enforce provider throttle envelope at `20 requests/minute`,
  - add daily-cap safety behavior for `5000/day` guidance (graceful pause/fail + clear job summary/audit detail),
  - avoid burst/concurrency patterns that violate Metron guidance.

### Acceptance Criteria

- Movie quick-filter buckets are deterministic and non-overlapping.
- TV quick-filter returns results when Plex resolution metadata exists.
- Metron imports/enrichment run without provider throttle violations under normal import volume.
- Metron request identity (`User-Agent`) is explicitly set and auditable in request config.
- When rate/daily caps are hit, sync job summary reports a clear provider-limit reason instead of opaque errors.

## 2.4.3.2 — Collections UX Unification and Library Integration

**Goal:** Make collections feel first-class and visually consistent with the main library while keeping conversion/edit flows explicit.
**Status:** Completed.

### Scope

- Collection cards use poster-style media cards (not list-only admin cards) with consistent badges and hover actions.
- In collection card hover actions:
  - keep `Edit`,
  - replace destructive hover action with `Convert` action.
- Collection editor moves to the same drawer interaction model used for title add/edit.
- Collection drawer items render in a consistent structured style similar to editions/episodes blocks.
- Collection entries are included in the main library result set; `Collections` tab becomes a filter lens, not a separate-only surface.
- Preserve existing tabs:
  - `All Movies|Movie Collections`,
  - `All Games|Game Collections`.

### Acceptance Criteria

- Collections and titles share consistent card visuals and interaction affordances.
- Collection edit uses drawer UI and supports current add/remove/convert workflows without regression.
- Collections are visible in main library views and still filter correctly in collections tab.
- Conversion actions are clear and recoverable (audit events retained).

## 2.4.2 — Events and Memorabilia Tracking

**Goal:** Add optional event tracking for conventions/festivals while keeping core media catalog flows simple.
**Status:** Completed.

### Scope

- Add an `Events` area for user-managed event logs (for example: ComiCon, film festivals, concerts, theme parks, and collection-related location visits).
- Event model baseline:
  - required fields: `title`, `url`, `location`, `date_start`,
  - optional fields: `date_end`, `host`, `time`, `room`, `notes`.
- Event-linked tracking rows:
  - sessions attended,
  - people met,
  - autographs/signings,
  - vendor/art purchases,
  - freebies and other collectibles.
- Add relation support from collectibles to events (`collectible.event_id`) so event exclusives can be queried and audited.
- Attachment support for event artifacts:
  - photo upload/capture on mobile and desktop,
  - storage metadata + audit logging.
- Keep Events isolated from core media CRUD paths so media performance and reliability are not impacted.

### Acceptance Criteria

- Users can create/edit/delete events with required fields validated server-side.
- Users can add event artifacts and link collectibles to an event.
- Event attachments can be uploaded/captured and rendered reliably on mobile and desktop.
- Event actions and attachment changes emit clear audit log entries.

### Implementation notes

- Events API/UI, artifact CRUD, and attachment upload/capture are complete and validated.
- Events list supports paging plus `q`, `location`, `from`, and `to` filters.
- Collectibles table linkage (`collectibles.event_id`) is migration-ready when the `collectibles` table exists.
- Full collectible record management UX is tracked in `2.4.4` (taxonomy expansion) and is intentionally out of scope for `2.4.2`.

### DB/API Checklist

- DB:
  - Add `events` table:
    - `id`, `library_id`, `space_id`, `created_by`, `title`, `url`, `location`, `date_start`,
    - optional `date_end`, `host`, `time_label`, `room`, `notes`,
    - `created_at`, `updated_at`, `archived_at`.
  - Add `event_artifacts` table:
    - `id`, `event_id`, `artifact_type` (`session|person|autograph|purchase|freebie|note`),
    - `title`, `description`, optional `image_path`, optional `price`, optional `vendor`,
    - `created_by`, `created_at`, `updated_at`.
  - Add indexes:
    - `events(library_id, date_start DESC)`,
    - `events(created_by, created_at DESC)`,
    - `event_artifacts(event_id, created_at DESC)`.
  - Add FK relation for collectibles linkage:
    - `collectibles.event_id REFERENCES events(id) ON DELETE SET NULL`.
- API:
  - `GET /api/events` with paging + optional filters (`from`, `to`, `location`, `q`).
  - `POST /api/events`, `PATCH /api/events/:id`, `DELETE /api/events/:id`.
  - `GET /api/events/:id/artifacts`, `POST /api/events/:id/artifacts`.
  - `PATCH /api/events/:id/artifacts/:artifactId`, `DELETE /api/events/:id/artifacts/:artifactId`.
  - All endpoints scope-enforced by `library_id` membership; admin override follows existing policy.
- Audit/ops:
  - Add activity actions:
    - `events.create|update|delete`,
    - `events.artifact.create|update|delete`,
    - `events.attachment.upload|delete`.
  - Require image upload validation (mime/size caps) using existing object storage pathway.

## 2.4.4 — Collectibles, Art, and Cards Taxonomy Expansion

**Goal:** Add non-media collection tracking for physical memorabilia that does not fit Movies/TV/Books/Audio/Games.
**Status:** Completed.

### Scope

- Add a new `Collectibles` library surface for items without a strict media-provider model.
- Baseline collectible model:
  - required: `title`,
  - optional: `image`, `event_id` (relation), `booth_or_vendor`, `price`, `exclusive` (boolean), `notes`.
- Add first-class subtypes:
  - `Art` (prints, originals, specialty pieces),
  - `Cards` (sports/comic/game cards),
  - generalized collectibles.
- Add single-select category taxonomy for collectibles:
  - `Lego` (sets),
  - `Figures / Statues`,
  - `Props / Replicas / Originals`,
  - `Funko`,
  - `Comic Panels`,
  - `Anime`,
  - `Toys`,
  - `Clothing`.
- Keep category values controlled (enum/table-backed) to avoid drift and improve filter quality.
- Add filter/search support on `category`, `event`, `vendor`, and `exclusive` status.

### Acceptance Criteria

- Users can create/edit/delete collectible rows and assign a category.
- Collectible rows can be linked to events and queried by event.
- Cards and art entries are tracked as dedicated subtype views without breaking shared collectible fields.
- Category and event filters behave consistently in list and detail views.

### DB/API Checklist

- DB:
  - Add `collectibles` table:
    - `id`, `library_id`, `space_id`, `created_by`,
    - `title` (required), `image_path`, `event_id`, `booth_or_vendor`, `price`, `exclusive`, `notes`,
    - `subtype` (`collectible|art|card`), `category_key`,
    - `created_at`, `updated_at`, `archived_at`.
  - Add `collectible_categories` lookup table (or enum-backed seed) with controlled keys:
    - `lego`, `figures_statues`, `props_replicas_originals`, `funko`, `comic_panels`, `anime`, `toys`, `clothing`.
  - Add indexes:
    - `collectibles(library_id, subtype, category_key)`,
    - `collectibles(event_id)`,
    - `collectibles(exclusive, created_at DESC)`,
    - optional trigram/text index for `title` + `booth_or_vendor`.
- API:
  - `GET /api/collectibles` with filters (`subtype`, `category`, `event_id`, `exclusive`, `q`, paging).
  - `POST /api/collectibles`, `PATCH /api/collectibles/:id`, `DELETE /api/collectibles/:id`.
  - `GET /api/collectibles/categories` (controlled taxonomy list for UI single-select).
  - Optional conversion endpoint:
    - `POST /api/collectibles/:id/reclassify` to switch subtype (`collectible`/`art`/`card`) without data loss.
- Audit/ops:
  - Add activity actions:
    - `collectibles.create|update|delete`,
    - `collectibles.reclassify`,
    - `collectibles.link_event`.
  - Ensure category values are validated server-side against controlled taxonomy.

## 2.4.4.1 — App Shell Decomposition (Hooks Extraction)

**Goal:** Reduce orchestration risk in `frontend/src/App.jsx` by extracting side-effect-heavy concerns into focused hooks without changing behavior.
**Status:** Completed.

### Scope

- Extract import polling/leader election into `useImportJobPolling`.
- Extract session bootstrap/auth-check lifecycle into `useSessionBootstrap`.
- Extract media API operations into `useMediaApi` (load/add/edit/delete/rate wrappers).
- Keep existing URL behavior, tab behavior, and API contracts unchanged.

### Acceptance Criteria

- `frontend/src/App.jsx` reduced to `<= 600` lines.
- No regression in auth/session bootstrap, import polling, or media CRUD flows.
- Existing CI checks pass without increasing App.js exception budgets.

### Delivery Notes

- Extracted hooks:
  - `frontend/src/components/app/hooks/useSessionBootstrap.js`
  - `frontend/src/components/app/hooks/useImportJobPolling.js`
  - `frontend/src/components/app/hooks/useMediaApi.js`
- App shell line count reduced from `676` to `462`.

## 2.4.4.2 — App Shell Decomposition (Dashboard Content Split)

**Goal:** Split render-routing responsibilities from root app orchestration for safer feature delivery.
**Status:** Completed.

### Scope

- Move tab switch/render logic into a dedicated dashboard content component.
- Keep root `App` focused on app-level state wiring and shell composition.
- Preserve feature-flag gating behavior for Events/Collectibles/import review.

### Acceptance Criteria

- `frontend/src/App.jsx` reduced to `<= 500` lines.
- Tab routing/render behavior matches pre-refactor behavior.
- No regressions in admin gating, library forcing, or drawer/navigation wiring.

### Delivery Notes

- Extracted dashboard tab renderer to `frontend/src/components/app/DashboardContent.jsx`.
- App shell line count reduced from `462` to `360`.

## 2.4.4.3 — App Shell Guardrails Enforcement

**Goal:** Re-establish long-term frontend modularity guardrails after decomposition.
**Status:** Completed.

### Scope

- Reconfirm and document `App.js` line-budget guardrail targets.
- Ensure extracted modules have clear ownership boundaries (`routing`, `session`, `import polling`, `media ops`).
- Remove temporary exception pressure by aligning with default guardrails.

### Acceptance Criteria

- App shell files remain within documented budget limits without exceptions increase.
- CI guardrails pass on fresh clone/build.
- Roadmap and delivery policy references reflect the updated app-shell structure.

### Delivery Notes

- Removed stale app shell budget exception file (`.ci/exceptions/app-shell-budget.json`).
- CI now fails if an exception file exists while `frontend/src/App.jsx` is already within hard budget.
- Updated engineering delivery policy with explicit app-shell ownership boundaries.

## 2.4.5 — Calibre Web Automated Integration (Comics/Books Bridge)

**Goal:** Replace CSV-centric Calibre workflows with direct Calibre Web Automated (CWA) integration for better reliability, better metadata continuity, and optional read-through behavior.
**Status:** Deferred (partially implemented, currently disabled).

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

### Progress Snapshot (Parked)

- [x] Admin integration settings for CWA endpoint/auth/timeouts + encrypted credential storage.
- [x] CWA test endpoint and OPDS connectivity check.
- [x] OPDS ingestion import path (`cwa_opds`) with pagination traversal.
- [x] Canonical provider linkage persistence (`provider_item_id`, external URL, source attribution).
- [x] `Open in Calibre` deep-link action from media details.
- [x] Incremental sync behavior with dedupe-safe upsert and optional delete reconciliation.
- [x] Truncated-feed delete guardrail (`hasMore=true` skips deletion, reason surfaced in summary).
- [x] CWA setup/testing runbook added to wiki.
- [ ] Optional in-app reader path (feature-flagged, allowlist-only).
- [x] Containment patch applied:
  - CWA import/test endpoints return disabled/deferred responses,
  - CWA UI entry points removed from active Admin/Import surfaces.

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

## 2.4.6 — Optional Convention Scheduler and Session Provider Framework

**Goal:** Add a true calendar-style convention planner that syncs external session catalogs, supports personal scheduling and sharing, and promotes attended sessions into collectZ Events without importing raw schedule rows into the `events` table.
**Status:** Proposed optional addition.

### Scope

- Add a separate convention scheduling domain rather than reusing the existing `events` table for imported source sessions.
- Convention planning core:
  - create a convention series such as `San Diego Comic-Con 2025`,
  - sync available sessions from external sources into a canonical session catalog,
  - support a personal `My Calendar` view with overlapping sessions allowed,
  - support one or more preferred choices among conflicting sessions,
  - support attended/missed tracking on planned sessions.
- Attendance promotion:
  - allow attended sessions to create or attach to a real collectZ event,
  - keep memorabilia, purchases, autographs, freebies, and collectibles anchored to the promoted event,
  - preserve structured linkage from attended sessions back to the canonical convention schedule.
- Sharing:
  - generate public read-only ICS links for a user's planned convention schedule,
  - optionally add a public web calendar view later behind a separate sharing surface.
- Provider framework:
  - load vetted server-side convention providers from an internal provider directory,
  - define a provider contract for discovery, fetch, parse, normalize, dedupe, and change detection,
  - start with machine-readable providers first (`sched_ics`) and use HTML scraping providers only as fallback.
- Operational safety:
  - resync must be idempotent,
  - upstream changes should mark sessions moved/cancelled/removed without deleting user planning state,
  - provider failures must not impact core media/events/collectibles workflows.
- Documentation deliverables:
  - keep the dedicated design spec in sync:
    - `docs/wiki/38-Convention-Scheduler-and-Provider-Spec.md`.

### Acceptance Criteria

- Imported convention sessions do not create rows in `events` until attendance promotion is explicitly requested.
- Users can add overlapping sessions to `My Calendar` without validation errors.
- Users can mark one or more sessions as preferred and filter calendar views accordingly.
- Attended sessions can be promoted into a real collectZ event with structured links back to source sessions.
- Public read-only ICS share links work without exposing authenticated app state or private metadata.
- Resync is dedupe-safe and surfaces meaningful partial-failure details when provider data is incomplete or changed upstream.

### DB/API Checklist

- DB:
  - add `convention_series` table for top-level convention runs,
  - add `convention_sources` table for configured upstream provider sources and sync metadata,
  - add `convention_sessions` table for canonical imported session rows,
  - add `user_session_plans` table for per-user planning state,
  - add `calendar_share_links` table for public sharing,
  - add `event_session_attendance` table for linking promoted attended sessions to real collectZ events.
- API:
  - `GET/POST/PATCH /api/conventions...`,
  - `GET/POST/PATCH /api/convention-sources...`,
  - `POST /api/convention-sources/:id/sync`,
  - `GET /api/conventions/:id/sessions`,
  - `PUT/DELETE /api/convention-sessions/:id/my-plan`,
  - `POST /api/conventions/:id/attendance/promote`,
  - share routes for public ICS output.
- UI:
  - convention directory,
  - day or multi-day calendar planner,
  - session detail drawer,
  - `My Calendar` filtered planning view,
  - attendance promotion flow,
  - share-link management.
- Provider framework:
  - internal loader/registry for convention providers,
  - initial provider target: `sched_ics`,
  - optional fallback provider target: `sched_html`.

### Notes

- This is intentionally a separate planning domain inside collectZ, not a separate companion app.
- This is intentionally not a first-pass arbitrary code plugin runtime; initial implementation should load vetted internal provider adapters only.

## 2.11.0 — Optional Market Valuation Integrations

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
- Keep valuation read-only in `2.11.0` (no writeback to providers).
- Keep pricing behind feature flags and optional env configuration.

### Acceptance Criteria

- Admin can configure/test PriceCharting and eBay integrations independently.
- Media detail view can show valuation fields when present and degrade gracefully when unavailable.
- Pricing failures do not block media CRUD/import flows and are fully auditable.

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
