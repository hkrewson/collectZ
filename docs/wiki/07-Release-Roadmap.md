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

**Current Slice:** `Version Closeout — Pending Live Runtime Rebuild`

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

**Current Slice:** `Closed`

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

**Current Slice:** `Closed`

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

## 3.3.1 — Loan Reminder Workflow

**Goal:** Add reminder behavior on top of the new library loans workflow so due-soon and overdue items can be followed up from one place without requiring manual date checking.

**Current Slice:** `Version Closeout`

### Scope

- Build on the shipped `3.3.0` loans workflow instead of reopening the core loans schema and browsing milestone.
- Define reminder eligibility for at least:
  - due soon
  - overdue
- Surface reminder state clearly in the loans view and media drawer.
- Add a manual reminder-send action for eligible loans with borrower email addresses.
- Persist reminder status and last-sent timing on the loan record.
- Reuse the existing email delivery primitives instead of inventing a second outbound channel.
- Defer automatic background sending unless the manual reminder path proves stable first.

### Acceptance Criteria

- Eligible loans can be identified clearly as due soon or overdue from the loans workflow.
- A reminder can be sent manually from the app for loans with borrower email.
- Reminder status and last-sent timing are stored and visible enough to avoid duplicate/manual confusion.
- The reminder slice stays additive to the shipped `3.3.0` loans feature instead of turning into a second schema-redesign pass.

### Active Slice Notes

- This belongs after `3.3.0` as a follow-on patch because reminder delivery adds a second workflow layer:
  - eligibility timing,
  - send actions,
  - duplicate-send guardrails,
  - delivery status,
  - and overdue follow-up handling.
- Start with manual reminder behavior and visible status before deciding whether automatic sending belongs in a later slice.
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
- Remaining follow-through to keep tracked in `3.3.1`:
  - keep reminder history depth and automatic sending deferred to backlog follow-up work instead of widening this patch.
- Preferred minimal DB/API contract:
  - a separate `media_loans` table rather than adding single loan fields directly onto `media`,
  - one active loan per media item at a time, enforced by an active-loan constraint,
  - fields for `media_id`, `library_id`, `space_id`, `borrower_name`, `borrower_email`, `loaned_at`, `due_at`, `returned_at`, `loan_format`, and optional notes,
  - reminder-ready timestamps/status fields can exist without requiring full reminder sending in the first implementation slice.
- Preferred first implementation slice after this audit:
  - create and return loans,
  - show active/overdue loans in a dedicated list,
  - leave actual outbound reminder sending for a later slice once the record lifecycle is proven.

## 3.3.2 — Automatic Loan Reminders

**Goal:** Add automatic due-soon and overdue reminder sending on top of the shipped manual loan reminder workflow without reopening the core loans record model.

**Current Slice:** `Automatic Reminder Scheduler Foundation`

### Scope

- Build on the shipped `3.3.1` manual reminder workflow instead of replacing it.
- Define the automatic reminder cadence for:
  - due-soon reminders,
  - overdue reminders,
  - and resend/backoff rules.
- Add a background reminder job or equivalent runtime-safe automation path.
- Prevent duplicate sends across repeated job runs and date-boundary edge cases.
- Surface enough audit and failure visibility to explain:
  - why a reminder sent,
  - why it did not send,
  - and whether delivery failed.
- Keep manual reminder send behavior intact while layering automation on top.
- Keep deeper reminder-event history out of this milestone unless the contract work proves it is an immediate blocker.

### Acceptance Criteria

- Eligible loans can receive automatic reminders without requiring a user to click `Send Reminder`.
- Automatic reminder runs do not repeatedly send duplicate messages for the same reminder phase/day.
- Reminder activity is visible enough to troubleshoot scheduled sends and failures.
- The existing manual reminder workflow continues to work alongside the automated path.

### Active Slice Notes

- This follows `3.3.1` directly because the manual reminder workflow and UI state are already in place.
- The first slice should settle:
  - cadence,
  - scheduling/runtime shape,
  - duplicate prevention rules,
  - and minimum audit visibility
  before implementation starts.
- Contract outcome from the audit:
  - the first automation slice should reuse the existing lightweight startup-timer pattern in `backend/server.js` rather than introducing a separate worker/queue system,
  - automation should be explicitly gated by reminder-delivery readiness so the runtime no-ops cleanly when SMTP is unavailable or automation is disabled,
  - because loans already use `DATE` fields, the scheduler can run on a simple hourly-style interval while still evaluating date-based due-soon and overdue windows,
  - the current shallow reminder fields are not enough to distinguish automatic due-soon sends from automatic overdue sends without guesswork,
  - so the first implementation slice may add narrow phase-specific send tracking while still keeping full reminder-event history out of scope.
- Current implementation shape:
  - automatic reminder sweeps run through a shared backend reminder service so manual send, scheduler execution, and smoke proofs use the same phase rules,
  - due-soon reminders send once per loan lifecycle,
  - overdue reminders send at most once per day,
  - phase-specific reminder timestamps support duplicate prevention without requiring full reminder-event history yet,
  - a restricted admin trigger endpoint can run the same sweep on demand for operator troubleshooting and smoke verification.
- `Loan Reminder History Depth` remains in backlog as a separate follow-up unless automatic scheduling proves it is required immediately for safe delivery or troubleshooting.

## 3.3.3 — Loan Reminder History Depth

**Goal:** Deepen library-loan reminder tracking beyond the current shallow loan-level state so reminder behavior can be audited and explained without overloading the active loan record.

**Current Slice:** `Version Closeout`

### Scope

- Build on the shipped `3.3.1` and `3.3.2` reminder workflows instead of redesigning the core `media_loans` lifecycle.
- Define an event-level reminder history model, likely through a dedicated table such as `media_loan_reminders`.
- Record reminder attempts and outcomes with enough detail to explain:
  - due-soon vs overdue phase,
  - manual vs automatic trigger,
  - sent, skipped, or failed status,
  - timestamp,
  - optional triggering user and failure context.
- Preserve the existing shallow fields on the loan record for simple UI status while introducing deeper audit history behind them.
- Keep the first slice grounded by aligning any remaining loan-view pagination affordances with the shared library pagination treatment instead of leaving one-off controls behind.

### Acceptance Criteria

- Reminder history can answer more than just the latest send state for a loan.
- The design clearly distinguishes between current reminder status on the loan record and event-by-event reminder history.
- The next implementation slice can add event persistence without reopening the shipped loan workflow contract.
- Loans pagination uses the same footer control treatment as the other library pages.

### Active Slice Notes

- This follows `3.3.2` directly because automatic reminders now make auditability the main remaining loans-specific gap.
- The first slice should settle:
  - event history shape,
  - minimum fields for audit and troubleshooting,
  - and how the deeper history coexists with the existing shallow reminder state
  before adding new persistence paths.
- A small UI alignment pass is included in this opening slice so the loans view no longer carries custom previous/next controls that drift from the shared library pagination shell.
- Contract outcome from the audit:
  - the existing `media_loans` reminder fields remain the source for simple current-state UI such as latest reminder status and last-sent timing,
  - deeper reminder history should live in a separate `media_loan_reminders` table rather than expanding `media_loans` into a multi-event ledger,
  - the minimum event shape should capture:
    - `loan_id`,
    - `library_id`,
    - `space_id`,
    - `phase` (`due_soon` or `overdue`),
    - `trigger` (`manual` or `automatic`),
    - `status` (`sent`, `skipped`, or `failed`),
    - `sent_at`,
    - optional `triggered_by_user_id`,
    - optional failure summary,
    - and a stable delivery window key so duplicate-prevention decisions are explainable,
  - automatic reminder duplicate prevention should continue to rely on the shallow phase timestamps for fast eligibility checks while the event table becomes the audit source of truth,
  - the first implementation slice should write event rows only for actual reminder attempts and outcomes, not for every ineligible loan scan.
- Current implementation shape:
  - the loans view footer now uses the shared library pagination treatment,
  - `media_loans` remains the fast current-state source for reminder status and latest-send timing,
  - manual and automatic reminder sends now write event rows to a dedicated `media_loan_reminders` table,
  - event rows capture phase, trigger source, status, timestamp, and delivery window key so duplicate-prevention decisions are explainable without reopening the loan record itself,
  - `GET /api/media/:id/loans` now expands loan history records with `reminder_events` so readback stays attached to the loan-detail/history path instead of widening the library-level loans list payload,
  - the loan-first media drawer now surfaces compact reminder history for both the active loan and recent returned loans so reminder audit context is visible where the richer loan-detail payload is already being read.

## 3.3.4 — Global Loan History View

**Goal:** Surface library loan history in a dedicated management view so past loans are visible and searchable outside the title-level drawer.

**Current Slice:** `Version Closeout`

### Scope

- Build on the shipped `3.3.0` through `3.3.3` loans and reminder workflows instead of redesigning the loan record model.
- Expose historical loans in the dedicated `Loans` workspace rather than keeping past activity discoverable only from the item drawer.
- Decide the first read model for:
  - active loans,
  - returned loans,
  - reminder-event context attached to historical loans,
  - and the filters/search states that belong in the global view.
- Keep the first slice focused on history visibility and management readability, not on new reminder automation or broader admin operations tooling.

### Acceptance Criteria

- Users can review past loan records without opening title drawers one by one.
- The global loans surface distinguishes clearly between currently out items and returned history.
- The first implementation slice can add the history view without widening the existing core loan lifecycle contract.
- Reminder-history visibility can be reused where it adds value without turning the Loans workspace into a noisy operator console.

### Active Slice Notes

- This follows `3.3.3` directly because reminder history now exists as persisted event data and drawer-level readback, making a broader history view the next natural surface question.
- The first slice should settle:
  - whether history lives as a dedicated filter/state inside `Loans` or as a separate subview,
  - what summary fields belong in the global history list,
  - and how much reminder-event detail should appear inline versus behind expansion
  before implementation starts.
- Current implementation shape:
  - the dedicated `Loans` workspace now keeps its main list payload lean,
  - each loan row can expand into a per-title history readback by reusing the existing `GET /api/media/:id/loans` detail/history contract,
  - returned and active historical entries are shown together inside that inline history panel,
  - and reminder-event history is surfaced there as supporting context instead of turning the top-level loans list into a full audit grid.

## 3.3.5 — Loan Reminder Operations Visibility

**Goal:** Make automatic loan reminder behavior easier to trust and troubleshoot by surfacing run-level operational visibility without turning the loans workflow into a broad reporting dashboard.

**Current Slice:** `Version Closeout`

### Scope

- Build on the shipped `3.3.1` through `3.3.4` reminder workflow, automation, history-depth, and global-history milestones instead of redesigning reminder execution.
- Focus the first slice on operational visibility for reminder automation:
  - last automatic reminder run,
  - sent/skipped/failed counts,
  - recent failures or no-send reasons,
  - and whether any lightweight operator trigger/readback belongs in the same surface.
- Keep the milestone scoped to reminder-operations trust and troubleshooting:
  - do not broaden into a full analytics/reporting dashboard,
  - do not introduce new reminder channels,
  - do not redesign the main Loans workspace again unless the operations contract clearly needs a small visibility hook there.

### Acceptance Criteria

- Operators can tell whether automatic loan reminders ran recently.
- Operators can review enough sent/skipped/failed summary context to troubleshoot basic reminder behavior.
- The implementation keeps run-level operations visibility distinct from per-loan history detail.
- The first slice defines whether operations visibility lives in an admin/operator surface, the Loans workspace, or a lightweight hybrid without widening scope accidentally.

### Active Slice Notes

- This follows `3.3.4` because the remaining loan/reminder gap is no longer basic workflow state or history depth; it is trust in the automation layer itself.
- The first slice should settle:
  - the run-level reminder operations model,
  - the minimum counts and failure details required,
  - and whether the existing admin-trigger path should surface summary results more explicitly
  before implementation starts.
- Contract decision:
  - keep reminder operations visibility separate from per-loan history,
  - start in an admin/operator-facing surface instead of widening the main `Loans` workspace again,
  - and reuse the existing automatic sweep summary plus audit events as the first data source instead of inventing a parallel metrics system.
- First implementation target:
  - a small read contract that exposes the latest automatic reminder run summary,
  - recent automatic run history,
  - and recent automatic failure entries with enough detail to answer basic “why didn’t this send?” questions.
- Current implementation shape:
  - the platform admin surface now has a dedicated reminder-operations read contract,
  - runtime configuration is reported alongside the latest automatic reminder run,
  - recent automatic run summaries are read back from `media.loan.reminder.auto_run` activity events,
  - recent automatic reminder failures are read back from `media.loan.reminder.auto_fail` activity events instead of introducing a separate reporting store,
  - and the platform activity view now surfaces that reminder-operations summary above the generic activity feed so operators can see runtime state, latest run counts, and recent failures without leaving the existing admin shell.
- Scope boundary:
  - do not build a broad analytics dashboard in this milestone,
  - do not add cross-system notification reporting,
  - and only add UI beyond an admin/operator visibility surface if the first implementation proves the reminder operations summary cannot stand on its own.

## 3.4.0 — Art Library Promotion and Event Purchase Linking

**Goal:** Promote Art into its own first-class library surface while preserving event-linked purchase history so art remains anchored to convention and show activity instead of becoming an orphaned side model.

**Current Slice:** `Version Closeout`

### Why this is a minor version

- This is a new first-class library surface, not just a taxonomy cleanup inside an existing screen.
- The milestone changes how users understand and navigate a real collection domain by moving Art out of the broader Collectibles bucket.
- It also touches event purchase relationships and migration boundaries for existing data, which is broader than a normal patch-only polish pass.

### Scope

- Promote Art into its own product/library surface instead of treating it only as a collectibles subtype.
- Preserve the ability to link purchased art back to events:
  - convention purchases,
  - artist alley purchases,
  - gallery or show purchases,
  - and similar event-scoped acquisition history.
- Decide whether the event purchase relationship should:
  - stay as a shared event-to-object model across Collectibles and Art,
  - or move behind a new cross-domain purchased-item relationship contract.
- Keep current collectible/event behavior intact while defining how existing art-classified collectible rows should migrate.
- Keep this milestone intentionally focused:
  - do not redesign Events broadly,
  - do not absorb Collectibles taxonomy simplification automatically unless the contract audit proves it is an immediate blocker,
  - do not widen into Apple/public-export/library-repo concerns.

### Acceptance Criteria

- Art can be managed through its own first-class library surface rather than only through Collectibles.
- Art items can still be linked to events as purchased items.
- Existing art-classified collectible rows can migrate without losing event purchase history, attribution, or basic discoverability.
- The relationship model between events and purchased items is documented clearly enough to support both Collectibles and Art without guesswork.

### Active Slice Notes

- This follows the completed `3.3.x` loans line because it is the next product-visible collection-domain expansion already identified in backlog.
- The first slice should settle:
  - whether Art is modeled as a new media/library domain, a promoted object model parallel to Collectibles, or a hybrid,
  - whether event purchase linking remains a direct foreign-key style attachment or becomes a more general purchased-item relationship,
  - and what minimum migration path is required for existing collectible rows where `subtype = art`.
- Starting-point audit outcome:
  - the current collectibles model already treats `art` and `card` as collectible subtypes,
  - the current collectible model already supports `event_id` purchase/event linking,
  - and the earlier `2.4.4` milestone intentionally framed Art and Cards as taxonomy expansion inside Collectibles rather than as separate library surfaces.
- Contract questions to answer before implementation:
  - should Art reuse the same object fields as Collectibles with a new library shell,
  - should Art keep or replace collectible-specific fields such as `booth_or_vendor`, `artist`, `exclusive`, and `price`,
  - and how should event-linked purchases be queried and displayed once Art is no longer only a collectible subtype.
- Contract outcome from the audit:
  - the current product has two overlapping purchase/history paths:
    - Art and other collectibles can link directly to an event through `collectibles.event_id`,
    - and Events also maintain a separate freeform `purchase` artifact lane that is not object-linked to a collectible record.
  - promoting Art into its own library should not start by inventing a brand-new detached purchase-history model.
  - the safer first boundary is:
    - keep one object-backed purchase relationship model for collectible-like things,
    - let both Collectibles and Art participate in that shared relationship,
    - and treat freeform event purchase artifacts as supporting notes/history rather than the primary canonical ownership link for tracked objects.
  - the first implementation should therefore prefer:
    - Art as a promoted parallel object domain that reuses most of the current collectible field shape,
    - a shared event-linked purchased-item relationship contract across Collectibles and Art,
    - and a migration path that lifts existing `subtype = art` rows without discarding their current `event_id`, `artist`, `price`, or vendor context.
- Explicit scope boundary for the next slice:
  - do not collapse the entire Collectibles taxonomy in this milestone unless the migration contract proves it is required,
  - do not redesign the Events artifact editor yet,
  - and do not force Art into the media-provider/media-import model prematurely just to make it look like Movies/Books/Games.
- First implementation slice now in progress:
  - Art has a dedicated backend route surface on top of the shared collectibles storage contract,
  - the dashboard/library shell exposes a dedicated `Art` destination instead of forcing users through Collectibles first,
  - and event-linked purchase behavior still rides the same `event_id` relationship rather than branching into a new detached purchase ledger.
- Current metadata follow-up in progress:
  - add `series` as a first-class field for Art and reusable collectible cases like comic panels,
  - split the overloaded `booth_or_vendor` field into distinct `vendor` and `booth` fields while keeping backward-compatible read behavior,
  - and preserve searchability/discoverability for artist plus series combinations.
- Narrow taxonomy simplification now pulled into this milestone intentionally:
  - Art promotion removed the old rationale for keeping `Art` in the Collectibles type menu,
  - so Collectibles can collapse its duplicate `Type` plus `Category` editor choice into one classification selector,
  - with `Card` living in that single selector and ordinary collectible categories continuing through the same control,
  - while leaving the broader versionless `Collectibles Taxonomy Simplification` backlog item available for any later cleanup that is not directly required by the Art split.
- Scope boundary for this foundation slice:
  - keep Art on the existing collectibles feature-flag boundary for now,
  - keep event purchase linking direct and shared,
  - and defer deeper row migration or schema split decisions until the dedicated Art surface has proven itself.

### Planned Follow-Through

- `3.4.0` is the bridge milestone:
  - Art gets its own first-class surface,
  - art-native metadata settles,
  - and Collectibles sheds the redundant taxonomy controls that no longer make sense once Art is promoted out.
- Native Art separation is explicitly planned as the next `3.4.x` line rather than being silently absorbed into this milestone.

## 3.4.1 — Art Native Schema and Purchased-Item Contract

**Goal:** Create a dedicated Art object model and the shared purchased-item relationship contract needed to let Events link to Art and Collectibles through one canonical purchase model.

**Current Slice:** `Version Closeout`

### Scope

- Add dedicated Art storage instead of relying on `collectibles.subtype = art` as the long-term source of truth.
- Treat these as native Art fields:
  - `artist`
  - `series`
  - `title`
  - `vendor`
  - `booth`
  - `price`
  - `exclusive`
  - `notes`
  - image fields and ownership metadata
- Add a shared event-facing purchased-item relationship model so Events can attach to:
  - Art
  - Collectibles
  - and later collectible-like domains
- Keep vendor and booth in the data model even when the default Art UI only surfaces them when an event link is present.

### Acceptance Criteria

- A dedicated Art storage contract exists in schema, migrations, API contracts, and docs.
- A shared purchased-item relationship contract exists for event-linked object purchases.
- The new schema can coexist with the bridge-era Art routes without forcing immediate cutover.

### Active Slice Notes

- Current runtime starting point:
  - tracked Art still lives in `collectibles` rows with `subtype = art`,
  - direct object linkage currently happens through `collectibles.event_id`,
  - and Events separately expose freeform `event_artifacts` rows with `artifact_type = purchase`.
- Contract decision:
  - keep `event_artifacts` as the freeform event-history lane for notes, ad-hoc purchases, freebies, signings, and other non-canonical event memories,
  - and add a separate shared purchased-item relationship for tracked library objects.
- Shared purchased-item relationship shape should start narrowly:
  - `id`
  - `event_id`
  - `item_type` (`art`, `collectible`)
  - `item_id`
  - optional display snapshot fields for stability in event readback:
    - `title_snapshot`
    - `vendor_snapshot`
    - `booth_snapshot`
    - `price_snapshot`
  - audit timestamps and creator attribution
- Native Art storage should treat these as first-class fields rather than collectible leftovers:
  - `artist`
  - `series`
  - `title`
  - `vendor`
  - `booth`
  - `price`
  - `exclusive`
  - `notes`
  - image fields
- UI rule carried forward from the contract:
  - `vendor` and `booth` remain native Art fields,
  - but the Art UI only needs to emphasize them when an event purchase link exists.
- Boundary for this contract slice:
  - do not redesign the current freeform event artifact editor yet,
  - do not cut Art reads away from the bridge model yet,
  - and do not try to absorb Cards or the rest of Collectibles into the native Art schema just because the purchased-item relationship becomes shared.
- First implementation foundation in this milestone:
  - add a dedicated `art_items` table with `source_collectible_id` bridge mapping so the current `/api/art` surface can dual-write native Art rows without cutting reads over yet,
  - add a shared `event_purchased_items` table keyed by `event_id + item_type + item_id`,
  - expose narrow event-facing purchased-item CRUD under `/api/events/:id/purchased-items`,
  - and keep the old `collectibles.event_id` and `event_artifacts` purchase lane intact until the dedicated migration and cutover milestones.

### Closeout

- Status: `Closed` as `v3.4.1`.
- Release artifact: `docs/releases/v3.4.1.md`.
- Version/feed sync:
  - root, backend, and frontend metadata are aligned on `3.4.1`,
  - and the in-app Help > Releases snapshot was regenerated with `3.4.1` as the latest entry.
- Runtime verification:
  - in-stack Help > Releases smoke served `3.4.1`,
  - event purchased-item smoke passed against the running backend/frontend stack,
  - RBAC regression passed in-stack,
  - platform edition boundary passed in-stack,
  - and observability release evidence passed `9/9` checks.
- Local checks:
  - backend unit tests passed (`205`),
  - OpenAPI validation passed,
  - release preflight was regenerated for `3.4.1`.
- Blocked local gates:
  - dependency audits were blocked by restricted registry DNS,
  - compose-smoke and homelab boundary were blocked by intermittent Docker socket permission failures,
  - browser regression was blocked by host Chromium launch permission failure after stale UI expectations were updated,
  - and secret scan plus image security/SBOM remain CI-only gates.
- Follow-up release boundary:
  - `3.4.2` owns existing Art migration and shared event purchase backfill,
  - and `3.4.3` owns native Art read cutover and event purchase readback UI.

## 3.4.2 — Art Migration and Shared Event Purchase Backfill

**Goal:** Move existing art-classified collectible rows into native Art storage and backfill shared purchased-item links without losing attribution, pricing, images, or event history.

**Current Slice:** `Closed`

### Scope

- Backfill existing `collectibles` rows where `subtype = art` into native Art records.
- Backfill event-linked Art purchases into the shared purchased-item relationship.
- Preserve:
  - event linkage
  - attribution
  - notes
  - vendor/booth context
  - pricing
  - images
  - and discoverability/search behavior
- Produce migration verification evidence that proves row counts and linkage integrity before cutover.

### Acceptance Criteria

- Existing Art data migrates without silent loss of linked event purchase history.
- Shared purchased-item rows exist for migrated Art purchases.
- Migration rehearsal and parity checks prove the backfill contract locally or are explicitly documented as blocked.

### Active Slice Notes

- Start from the `3.4.1` bridge state:
  - new and edited `/api/art` records already dual-write into `art_items`,
  - but older `collectibles.subtype = art` rows may not yet have native Art rows,
  - and older event-linked Art rows may still depend only on `collectibles.event_id`.
- Migration/backfill foundation:
  - add an idempotent migration that copies legacy Art collectible rows into `art_items` through `source_collectible_id`,
  - preserve `artist`, `series`, `title`, vendor/booth context, `price`, `exclusive`, images, notes, creator, timestamps, library, space, and archived state,
  - backfill `event_purchased_items` for legacy Art rows with `event_id`,
  - keep non-Art Collectibles out of the Art backfill,
  - and keep runtime reads on the bridge-era `/api/art` surface until `3.4.3`.

### Migration and Backfill Foundation Closeout

- Status: implementation complete; milestone moved to `Version Closeout`.
- Implemented migration `v75 — Backfill native art rows and shared event purchased item links`.
- Added transactional smoke coverage for:
  - active legacy Art rows,
  - standalone legacy Art rows,
  - archived legacy Art rows,
  - event-linked Art purchased-item backfill,
  - idempotent rerun behavior,
  - and non-Art Collectibles staying out of the Art backfill.
- Running localhost DB evidence after applying `v75`:
  - legacy Art rows: `3`,
  - native Art mappings: `3`,
  - event-linked Art rows: `2`,
  - shared Art purchase links: `2`,
  - missing native Art mappings: `0`,
  - missing event purchase links: `0`.
- Verification run:
  - backend unit tests passed (`206`),
  - Art migration backfill smoke passed in a backend-container transaction,
  - migration rehearsal passed through `v75`,
  - init parity passed through `v75`.
- Remaining work:
  - version sync, `docs/releases/v3.4.2.md`, Help > Releases feed regeneration, and release-shaped gates for `3.4.2`.

### Version Closeout

- Status: release artifacts are prepared for `v3.4.2`, but final closeout is pending a live runtime rebuild/verification because the live app version was reported as not matching the release closeout.
- Release artifact: `docs/releases/v3.4.2.md`.
- Version/feed sync:
  - root, backend, and frontend metadata are aligned on `3.4.2`,
  - and the in-app Help > Releases snapshot was regenerated with `3.4.2` as the latest entry.
- Runtime verification:
  - in-stack Help > Releases smoke served `3.4.2`,
  - Art migration backfill smoke passed in a backend-container transaction,
  - live localhost DB had migration `v75` applied with `0` missing native Art mappings and `0` missing event purchase links,
  - RBAC regression passed in-stack,
  - platform edition boundary passed in-stack,
  - and observability release evidence passed `9/9` checks.
- Local checks:
  - backend unit tests passed (`206`),
  - OpenAPI validation passed,
  - init parity passed through `v75`,
  - migration rehearsal passed through `v75`,
  - release preflight was regenerated for `3.4.2`.
- Blocked local gates:
  - dependency audits were blocked by restricted registry DNS,
  - compose-smoke and homelab boundary were blocked by Docker socket permission failures,
  - browser regression was blocked by host Chromium launch permission failure before app code ran,
  - host `localhost:3000` health was unreachable from this shell during final closeout,
  - live backend/frontend images still need to be rebuilt/recreated with `APP_VERSION=3.4.2` and verified from `/api/health`,
  - and secret scan plus image security/SBOM remain CI-only gates.
- Follow-up release boundary:
  - `3.4.3` owns native Art read cutover and event purchase readback UI,
  - and `3.4.4` owns Art UI divergence and legacy Collectibles decoupling.

## 3.4.3 — Art Native Read Cutover and Event Purchase Readback

**Goal:** Switch runtime reads to the native Art model and let Events read Art and Collectibles through the shared purchased-item relationship.

**Current Slice:** `Closed`

### Scope

- Cut `/api/art` over to native Art reads.
- Update Event-side purchased-item readback to use the shared relationship rather than collectible-only assumptions.
- Make Art-side vendor/booth visibility conditional on event linkage in the UI.
- Keep compatibility behavior only where required for cutover safety.

### Acceptance Criteria

- The running Art library no longer depends on collectible-backed Art reads.
- Events can read linked Art purchases and linked Collectibles purchases through the same relationship model.
- Art UI behavior reflects the event-aware vendor/booth rule without losing editability or data fidelity.

### Closeout

- Status: `Closed` as `v3.4.3`.
- Release artifact: `docs/releases/v3.4.3.md`.
- Version/feed sync:
  - root, backend, and frontend metadata are aligned on `3.4.3`,
  - and the in-app Help > Releases snapshot was regenerated with `3.4.3` as the latest entry.
- Runtime verification:
  - rebuilt backend/frontend images reported `3.4.3` from `/api/health`,
  - native Art read cutover smoke passed against the running backend stack,
  - event purchased-items smoke passed against the running backend stack,
  - targeted Playwright Events/Collectibles/Art browser regression passed against the rebuilt frontend,
  - full Playwright browser regression passed locally (`44` passed, `4` skipped homelab-browser specs),
  - in-stack Help > Releases smoke served `3.4.3`,
  - RBAC regression passed in-stack,
  - platform edition boundary passed in-stack,
  - homelab edition boundary passed in-stack,
  - and observability release evidence passed.
- Local checks:
  - backend unit tests passed (`207`),
  - OpenAPI validation passed,
  - release preflight was regenerated for `3.4.3` with compose smoke basics passing under CI secure-cookie overrides,
  - dependency audit artifacts were regenerated,
  - init parity was checked,
  - and migration rehearsal was checked.
- CI-only follow-through:
  - secret scan remains authoritative in tagged CI because `gitleaks` is not installed locally,
  - and image security/SBOM remain authoritative in tagged CI because local Trivy/SBOM tooling is not installed.
- Follow-up release boundary:
  - `3.4.4` owns Art UI divergence and legacy Collectibles decoupling.

## 3.4.4 — Art UI Divergence and Legacy Collectibles Decoupling

**Goal:** Finish separating Art from Collectibles at the product layer and remove the remaining bridge-era compatibility assumptions.

**Current Slice:** `Closed`

### Scope

- Give Art its own intentionally designed drawer/editor and detail/read surfaces where shared Collectibles UI is no longer the right fit.
- Remove or reduce the remaining shared-storage and shared-view assumptions that only exist to support the bridge phase.
- Clean up leftover taxonomy and compatibility code that was necessary during migration but should not define the long-term product model.

### Acceptance Criteria

- Art is a fully separate object domain in the product and no longer behaves like a collectible subtype with a nicer tab.
- The Collectibles surface no longer carries Art-specific compatibility logic that should live only in migration history.
- The long-term Art/Event/Collectibles relationship model is documented clearly enough for future work to build on without revisiting the bridge design.

### Closeout

- Status: `Closed` as `v3.4.4`.
- Release artifact: `docs/releases/v3.4.4.md`.
- Version/feed sync:
  - root, backend, frontend, and lockfile metadata are aligned on `3.4.4`,
  - and the in-app Help > Releases snapshot was regenerated with `3.4.4` as the latest entry.
- Runtime verification:
  - rebuilt backend/frontend images reported `3.4.4` from `/api/health`,
  - native Art read cutover smoke passed against the running backend stack,
  - event purchased-items smoke passed against the running backend stack,
  - targeted Playwright Events/Collectibles/Art browser regression passed against the rebuilt frontend,
  - full Playwright browser regression passed locally,
  - in-stack Help > Releases smoke served `3.4.4`,
  - RBAC regression passed in-stack,
  - platform edition boundary passed in-stack,
  - homelab edition boundary passed in-stack,
  - and observability release evidence passed.
- Local checks:
  - backend unit tests passed,
  - OpenAPI validation passed,
  - release preflight was regenerated for `3.4.4` with compose smoke basics passing under CI secure-cookie overrides,
  - dependency audit artifacts were regenerated,
  - init parity was checked,
  - and migration rehearsal was checked.
- CI-only follow-through:
  - secret scan remains authoritative in tagged CI because `gitleaks` is not installed locally,
  - and image security/SBOM remain authoritative in tagged CI because local Trivy/SBOM tooling is not installed.
- Long-term relationship contract:
  - Art is product-owned by the Art surface and native `art_items` records,
  - Collectibles are product-owned by non-Art collectible rows and classifications such as `Card`, `Funko`, and `Comic Panels`,
  - Events read tracked purchases through `event_purchased_items`,
  - `event_purchased_items.item_type = 'art'` points at `art_items.id`,
  - `event_purchased_items.item_type = 'collectible'` points at `collectibles.id`,
  - `art_items.source_collectible_id` remains bridge compatibility for migrated rows and current safe writes,
  - `/api/collectibles` does not expose or accept Art records,
  - and `/api/art` does not expose collectible categories.
- Follow-up boundary:
  - deeper removal of bridge columns or bridge-safe ID compatibility should be planned as a separate migration-safe milestone.

## 3.4.5 — Collectibles Taxonomy Cleanup and Art Medium Boundary

**Goal:** Finish the visible Collectibles taxonomy simplification while giving Art the medium/type boundary needed to absorb comic-panel-style artwork cleanly.

**Current Slice:** `Closed`

### Scope

- Keep Collectibles on one visible classification selector instead of separate type/category controls.
- Keep `Card` as a supported Collectibles classification in that one selector.
- Remove `Anime` from new Collectibles taxonomy choices because it is a fandom/source descriptor rather than an owned-object class.
- Move `Comic Panels` out of new Collectibles choices and into Art as a medium/type value.
- Add Art fields for:
  - medium/type (`Original`, `Print`, `Comic Panel`, `Sketch`, `Commission`, `Other`),
  - signed status.
- Preserve legacy readability for existing Collectibles records while migrating active Comic Panels records into native Art.

### Acceptance Criteria

- Collectibles entry and filtering no longer offer `Anime` or `Comic Panels` as new categories.
- Existing legacy Anime records remain readable and do not break validation/readback.
- Existing active Comic Panels collectibles are migrated into Art with `medium = comic_panel`.
- Art create/edit/detail/list surfaces read and write medium/type and signed status.
- The API/OpenAPI/init/migration contract stays aligned with the Art medium boundary.

### Active Slice Notes

- Do not rename Collectibles to Fandom in this slice. `Fandom` remains a possible future metadata/tagging concept, not the library name.
- Do not build a separate Comic Panels library; use Art medium/type first.
- Do not add full signature provenance in this slice; start with a simple signed boolean and leave signer/proof details for a future provenance task if needed.

### Closeout

- Status: `Closed` as `v3.4.5`.
- Release artifact: `docs/releases/v3.4.5.md`.
- Version/feed sync:
  - root, backend, frontend, and lockfile metadata are aligned on `3.4.5`,
  - and the in-app Help > Releases snapshot was regenerated with `3.4.5` as the latest entry.
- Runtime verification:
  - rebuilt backend/frontend images reported `3.4.5` from `/api/health`,
  - migration `76` applied in the running database,
  - live taxonomy/API smoke confirmed active Collectibles categories exclude `Anime` and `Comic Panels`,
  - live Art smoke confirmed `medium = comic_panel` and `signed = true` round-trip through create/detail,
  - targeted Events/Collectibles/Art browser regression passed,
  - RBAC regression passed in-stack,
  - platform edition boundary passed in-stack,
  - homelab edition boundary passed in-stack,
  - and in-stack Help > Releases served `3.4.5`.
- Local checks:
  - backend unit tests passed,
  - OpenAPI validation passed,
  - release preflight was regenerated for `3.4.5` with compose smoke basics passing under CI secure-cookie overrides,
  - dependency audit artifacts were regenerated,
  - init parity was checked,
  - and migration rehearsal was checked.
- CI-only follow-through:
  - secret scan remains authoritative in tagged CI because `gitleaks` is not installed locally,
  - and image security/SBOM remain authoritative in tagged CI because local Trivy/SBOM tooling is not installed.
- Follow-up boundary:
  - `Fandom` remains a possible future metadata/tagging concept, not the Collectibles library name,
  - and richer signature provenance should be planned separately if signer/proof detail becomes important.

## 3.4.6 — Art Bridge Cleanup and Native Art Write Hardening

**Goal:** Reduce Art's bridge-era dependence on hidden Collectibles rows now that Art has a native object model, while preserving compatibility for migrated records.

**Current Slice:** `Closed`

### Scope

- Stop creating new hidden `collectibles.subtype = art` rows when users create Art from `/api/art`.
- Route Art updates, image uploads, image removal, and archive/delete behavior through native `art_items` first.
- Keep bridge-compatible reads for migrated Art rows whose public ID still resolves through `art_items.source_collectible_id`.
- Preserve shared Event purchase linking through `event_purchased_items`.
- Keep existing migrated Art records readable and editable without forcing a destructive ID cutover.

### Acceptance Criteria

- New `/api/art` creates persist directly to `art_items` with `source_collectible_id = NULL`.
- `/api/art/:id` continues to resolve native-only rows by native ID and migrated rows by bridge-compatible source collectible ID.
- Art create/update/delete/image flows do not require a Collectibles row for native-only Art.
- Event purchase filters and readback continue to work for native-only Art.
- `/api/collectibles` continues to reject/exclude Art records.

### Active Slice Notes

- Do not remove the `source_collectible_id` column in this slice.
- Do not switch all legacy public Art IDs to native IDs in this slice.
- Deeper bridge-column removal or a public-ID cutover should remain a separate migration-safe milestone after compatibility behavior is proven.

### Closeout

- Status: `Closed` as `v3.4.6`.
- Release artifact: `docs/releases/v3.4.6.md`.
- Version/feed sync:
  - root, backend, frontend, lockfile, and app-meta metadata are aligned on `3.4.6`,
  - and the in-app Help > Releases snapshot was regenerated with `3.4.6` as the latest entry.
- Runtime verification:
  - rebuilt backend/frontend images reported `3.4.6` from `/api/health`,
  - live native Art smoke confirmed new `/api/art` creates write directly to `art_items` with `source_collectible_id = NULL`,
  - native Art detail/update/delete smoke passed against the running backend/frontend stack,
  - event purchased-items smoke passed with Art links resolved through native `art_items.id`,
  - Help > Releases smoke served `3.4.6`,
  - RBAC regression passed in-stack,
  - platform edition boundary passed in-stack,
  - homelab edition boundary passed in-stack,
  - browser regression passed locally with `44` passed and `4` skipped,
  - CI-shaped compose smoke basics passed under secure-cookie overrides,
  - and observability release evidence passed `9/9`.
- Local checks:
  - backend unit tests passed,
  - OpenAPI validation passed,
  - release preflight was regenerated for `3.4.6`,
  - backend production dependency audit reported `0` critical, `0` high, `2` moderate,
  - frontend production dependency audit reported `0` vulnerabilities,
  - init parity passed,
  - and migration rehearsal passed.
- Artifact hygiene:
  - generated preflight, dependency audit, init parity, migration rehearsal, and observability artifacts were checked for secret-bearing output,
  - observability command evidence contains redacted password values rather than plaintext credentials.
- CI-only follow-through:
  - secret scan remains authoritative in tagged CI because `gitleaks` is not installed locally,
  - and image security/SBOM remain authoritative in tagged CI because local Trivy/SBOM tooling is not installed.
- Follow-up boundary:
  - full removal of `source_collectible_id` remains deferred until legacy/public-ID compatibility is proven safe,
  - and a later public-ID cutover may be needed if migrated Art should expose native IDs everywhere.

## 3.4.7 — Event Purchase Linking Polish

**Goal:** Make shared purchased-item linking feel first-class from the Event view now that Art and Collectibles participate in the same tracked purchase relationship.

**Current Slice:** `Closed as v3.4.7`

### Scope

- Refine Event detail browsing for tracked Art and Collectibles purchases.
- Add event-side search/link flows so users can attach existing Art or Collectibles without leaving the Event drawer.
- Improve duplicate-link prevention and conflict copy.
- Allow event-side editing of purchase snapshots such as title, vendor, booth, and price.
- Keep `event_purchased_items` as the shared relationship.

### Acceptance Criteria

- Users can link Art and Collectibles from Events without needing to know each object's backing table.
- Event-side search distinguishes Art from Collectibles and uses the right native item id for Art.
- Duplicate links are prevented with useful UI feedback.
- Event purchase history remains readable and editable after item edits or archival.
- Existing freeform Event artifacts remain separate from tracked purchased-item links.

### Active Slice Notes

- Do not replace the freeform Event artifact purchase lane in this slice.
- Do not introduce a new purchase-history table; keep the shared `event_purchased_items` contract.
- Keep the UI consistent with the existing drawer controls rather than redesigning the Event surface.

### Closeout

- Status: `Closed` as `v3.4.7`.
- Release artifact: `docs/releases/v3.4.7.md`.
- Version/feed sync:
  - root, backend, frontend, lockfile, and app-meta metadata are aligned on `3.4.7`,
  - and the in-app Help > Releases snapshot was regenerated with `3.4.7` as the latest entry.
- Runtime verification:
  - rebuilt backend/frontend images reported `3.4.7` from `/api/health`,
  - Help > Releases smoke served `3.4.7` as the newest release,
  - event purchased-items smoke passed with shared Art and Collectibles links,
  - RBAC regression passed in-stack,
  - platform edition boundary passed in-stack,
  - homelab edition boundary passed after recreating the app in homelab edition,
  - browser regression passed locally with `45` passed and `4` skipped,
  - CI-shaped compose smoke basics passed under secure-cookie overrides,
  - and observability release evidence passed `9/9`.
- Local checks:
  - backend unit tests passed,
  - OpenAPI validation passed,
  - release preflight was regenerated for `3.4.7`,
  - backend production dependency audit reported `0` critical, `0` high, `2` moderate,
  - frontend production dependency audit reported `0` vulnerabilities,
  - init parity passed,
  - and migration rehearsal passed.
- Artifact hygiene:
  - generated preflight, dependency audit, init parity, migration rehearsal, observability, release note, and release feed artifacts were checked for secret-bearing output,
  - and the only matches in the generated closeout artifact scan were literal gate names for `secret-scan` / secret scan.
- CI-only follow-through:
  - secret scan remains authoritative in tagged CI because `gitleaks` is not installed locally,
  - and image security/SBOM remain authoritative in tagged CI because local Trivy/SBOM tooling is not installed.
- Follow-up boundary:
  - broader purchase reporting, bulk linking, and deeper purchase analytics remain future work if needed,
  - and this release intentionally keeps freeform Event artifacts separate from tracked purchased-item links.

## 3.4.8 — Fandom and Franchise Metadata

**Goal:** Give Art and Collectibles a shared place for fandom/source/franchise metadata without overloading object categories or renaming Collectibles.

**Current Slice:** `Closed as v3.4.8`

### Scope

- Add a shared freeform `franchise` field to native Art and Collectibles.
- Surface the field as `Fandom / Franchise` in Art and Collectibles create/edit/detail/card surfaces.
- Include franchise values in Art and Collectibles search.
- Keep Collectibles categories focused on owned-object shape such as Card, Funko, Toys, Clothing, and similar classes.
- Keep Art medium/type focused on physical/artistic form such as Original, Print, Comic Panel, Sketch, Commission, and Other.

### Acceptance Criteria

- Art and Collectibles can record a source/fandom/franchise value without changing object category or medium/type.
- Anime-like descriptors have a home as metadata rather than category taxonomy.
- The API/OpenAPI/init/migration contract stays aligned for the shared field.
- Existing Art/Collectibles records remain readable with `franchise = NULL`.
- The product copy does not rename Collectibles to Fandom in this slice.

### Active Slice Notes

- Use a simple freeform field first; do not add a controlled vocabulary or tag table in this slice.
- Do not rename Collectibles.
- Do not alter Event purchased-item snapshot semantics in this slice.

### Closeout — 2026-04-26

- Released as `v3.4.8`.
- Version metadata synced across `app-meta.json`, backend package metadata, frontend package metadata, backend app metadata, and frontend app metadata.
- Release note added at `docs/releases/v3.4.8.md`.
- In-app Help > Releases feed regenerated with `v3.4.8` as the latest entry.
- Runtime verification used Docker-first evidence from the rebuilt `backend`, `frontend`, and `db` services.
- Migration `77` verified against the running stack and release evidence through init parity and migration rehearsal checks.
- Local release closeout accounted for unit, OpenAPI, browser, RBAC, edition-boundary, dependency, migration, observability, compose-smoke, secret-scan, image-security, and SBOM gates.
- CI remains the authoritative source for tagged `secret-scan`, image security, and SBOM publication artifacts.

## 3.4.9 — Shared Signature Provenance Foundation

**Goal:** Replace one-off signed-object fields with a shared signature/provenance contract that Art can use immediately and existing media/title endpoints can adopt without losing compatibility.

**Current Slice:** `Closed as v3.4.9`

### Scope

- Add a shared `signature_records` storage model keyed by owner type and owner id.
- Support Art and media titles in the first slice; keep Collectibles out until a specific object case needs signed-copy provenance.
- Preserve existing media `signed_by`, `signed_role`, `signed_on`, `signed_at`, and `signed_proof_path` fields as compatibility projections.
- Preserve Art's simple `signed` boolean as the fast visual marker while adding richer signer/provenance details through the shared model.
- Surface Art signature provenance in the Art drawer/editor/detail flow without crowding unsigned items.
- Expose shared `signatures` readback through Art and media/title endpoints so future title surfaces use the same contract.

### Acceptance Criteria

- Art can record signer name, role, date, location/event context, notes, and proof path through a shared signature record.
- Existing media signature metadata is backfilled into the shared table and remains readable through current title fields.
- Art and media detail responses include a normalized `signatures` array.
- Updating Art signature provenance updates the shared table and keeps `art_items.signed` aligned.
- Upload/removal of media signing proof keeps the shared primary signature record in sync.
- API/OpenAPI/init/migration contracts stay aligned.

### Active Slice Notes

- Treat event autograph artifacts as event history, not object-level signed-copy provenance, in this slice.
- Keep proof image storage path-based for now and reuse existing upload/storage plumbing rather than introducing a new attachment service.
- Avoid a controlled signer directory or many-to-many signer catalog until repeated signer reuse proves the need.

### Closeout — 2026-04-26

- Released as `v3.4.9`.
- Version metadata synced across `app-meta.json`, backend package metadata, frontend package metadata, backend app metadata, and frontend app metadata.
- Release note added at `docs/releases/v3.4.9.md`.
- In-app Help > Releases feed regenerated with `v3.4.9` as the latest entry.
- Runtime verification used Docker-first evidence from the rebuilt `backend`, `frontend`, and `db` services.
- Migration `78` verified against the running stack and release evidence through init parity and migration rehearsal checks.
- Local release closeout accounted for unit, OpenAPI, browser, RBAC, edition-boundary, dependency, migration, observability, compose-smoke, secret-scan, image-security, and SBOM gates.
- CI remains the authoritative source for tagged `secret-scan`, image security, and SBOM publication artifacts.

## 3.4.10 — Shared Signature Proof Attachments

**Goal:** Let Art use the same proof upload/remove behavior already available to media signing proofs while keeping signature proof storage anchored to the shared signature provenance contract.

**Current Slice:** `Closed as v3.4.10`

### Scope

- Add Art signature proof upload and remove endpoints backed by the primary shared `signature_records` row.
- Keep existing media signing proof routes compatible while tightening shared-record sync on removal.
- Add Art drawer controls for proof file upload, proof removal, and proof viewing without replacing the existing URL fallback field.
- Cover the shared proof attachment path in source-level checks and the Art signature provenance browser regression.

### Acceptance Criteria

- Art proof uploads create or update the active primary signature record with `owner_type = 'art'`.
- Art proof removal clears the primary signature proof path without deleting the rest of the signer/provenance data.
- Media signing proof removal still clears the legacy media field and syncs the shared signature record.
- Art create/edit can upload a selected proof file after the Art record exists.
- API/OpenAPI/runtime checks stay aligned for the new Art proof endpoints.

### Active Slice Notes

- Do not introduce a general attachment library in this slice.
- Do not add multiple proof images per signature yet.
- Do not convert Event autograph artifacts into object-level signature records here.

### Closeout — 2026-04-26

- Released as `v3.4.10`.
- Version metadata synced across `app-meta.json`, backend package metadata, frontend package metadata, backend app metadata, and frontend app metadata.
- Release note added at `docs/releases/v3.4.10.md`.
- In-app Help > Releases feed regenerated with `v3.4.10` as the latest entry.
- Runtime verification used Docker-first evidence from the rebuilt `backend`, `frontend`, and `db` services.
- No schema migration was required; the release reuses migration `78` from `3.4.9`.
- Local release closeout accounted for unit, OpenAPI, browser, RBAC, edition-boundary, dependency, migration, observability, compose-smoke, secret-scan, image-security, and SBOM gates.
- CI remains the authoritative source for tagged `secret-scan`, image security, and SBOM publication artifacts.

## 3.4.11 — Event Autograph Signature Linking

**Goal:** Let event-captured autographs feed the same shared signature provenance model used by Art and media, while keeping Events as the capture/history surface instead of a separate signature system.

**Current Slice:** `Closed as v3.4.11`

### Scope

- Extend shared `signature_records` to support event autograph artifacts as a provenance owner type.
- Store event artifact links to the canonical Art/media signature record when an event autograph is attached to an owned object.
- Add an API endpoint that links an event autograph artifact to an Art or media signature without duplicating signature concepts.
- Keep event artifacts as event history; owned-object signatures remain canonical evidence on the Art/media object.
- Keep OpenAPI and source-level regression checks aligned with the new link path.

### Acceptance Criteria

- Autograph artifacts can capture signer, role, date, location, proof path, and notes in shared signature records.
- Linking an autograph artifact to Art creates/updates the Art primary shared signature and marks the Art item signed.
- Linking an autograph artifact to media creates/updates the media primary shared signature and keeps legacy media signature fields compatible.
- Event artifact reads expose both event-captured signature details and any linked object signature.
- Existing event purchased-item links remain separate from autograph provenance links.

### Active Slice Notes

- Do not add a dedicated frontend linking workflow in this first API slice.
- Do not make Events themselves signed objects; signings remain artifacts/sub-events.
- Do not add multi-proof or many-signature management UI in this slice.

### Closeout — 2026-04-26

- Released as `v3.4.11`.
- Version metadata synced across `app-meta.json`, backend package metadata, frontend package metadata, backend app metadata, and frontend app metadata.
- Release note added at `docs/releases/v3.4.11.md`.
- In-app Help > Releases feed regenerated with `v3.4.11` as the latest entry.
- Runtime verification used Docker-first evidence from rebuilt `backend`, `frontend`, and `db` services.
- Schema migration `79` applied in the running stack and was verified with init parity plus migration rehearsal evidence.
- Local release closeout accounted for unit, OpenAPI, browser, RBAC, edition-boundary, dependency, migration, observability, release note, release feed, and targeted Event signature-linking smoke gates.
- Local preflight marked CI-secure compose-smoke cookie checks blocked because this local development stack runs with `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; tagged CI remains authoritative for that secure-cookie variant.
- Local gitleaks, Trivy, and SBOM tooling were not installed, so tagged CI remains authoritative for `secret-scan`, `image-security-and-sbom`, and final release publication.
- The release intentionally leaves dedicated frontend autograph-to-object linking workflow, multi-signature management, and multi-proof management as follow-up work.

## 3.4.12 — Event Autograph Linking UI

**Goal:** Give the Event drawer a first-class workflow for turning an event autograph artifact into canonical Art/media signature provenance without creating a separate event-signature system.

**Current Slice:** `Closed as v3.4.12`

### Scope

- Add autograph-specific signer/provenance fields to Event artifact editing.
- Surface event-captured autograph provenance and linked object signature readback in the Event detail drawer.
- Add a compact Art/media search-and-link workflow for autograph artifacts using the existing `link-signature` API.
- Keep Events as the capture/history surface and Art/media as the canonical owned-object signature evidence surface.
- Cover the UI wiring with source-level checks and a targeted browser regression.

### Acceptance Criteria

- Autograph artifacts can be created/edited with signer name, signer role, signed date, signed location, proof path, and notes.
- Event autograph rows show captured signature details in the drawer.
- Unlinked autograph rows can search Art or media records and link one object signature from the drawer.
- Linked autograph rows show the canonical object signature target/readback.
- Existing purchased-item linking remains separate from autograph provenance linking.

### Active Slice Notes

- Do not add many-signature management or multi-proof management in this slice.
- Do not rename Event artifacts into a separate Signatures library.
- Prefer a compact drawer workflow over another navigation surface.

### Closeout — 2026-04-26

- Released as `v3.4.12`.
- Version metadata synced across root app metadata, backend app/package metadata, and frontend app/package metadata.
- Release note added at `docs/releases/v3.4.12.md`.
- In-app Help > Releases feed regenerated with `v3.4.12` as the latest entry.
- Runtime verification used Docker-first evidence from rebuilt `backend`, `frontend`, `db`, and homelab compose services.
- No schema migration was added; init parity and migration rehearsal were rerun against the existing migration set through version `79`.
- Local release closeout accounted for unit, OpenAPI, Event autograph linking smoke, RBAC, browser regression, homelab edition boundary, platform edition boundary, dependency audit, init parity, migration rehearsal, observability evidence, release note, release feed, and running-stack health gates.
- Local preflight marked CI-secure compose-smoke cookie checks blocked because this local development stack runs with `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; tagged CI remains authoritative for that secure-cookie variant.
- Local `gitleaks`, Trivy, and SBOM tooling were not installed in this shell, so tagged CI remains authoritative for `secret-scan`, `image-security-and-sbom`, and final release publication.
- Release evidence artifacts were inspected for unredacted secret-bearing patterns after observability evidence generation, with no unredacted hits found.
- The release intentionally leaves multiple signatures per object and multi-proof management as follow-up work.

## 3.4.13 — Multi-Signature Support for Art and Media

**Goal:** Let Art and media objects carry multiple signature provenance records while preserving the existing single-primary compatibility fields used by older forms, imports, and title endpoints.

**Current Slice:** `Closed as v3.4.13`

### Scope

- Add shared signature record create/update/archive/set-primary operations for Art and media.
- Keep one active primary signature per object for compatibility with existing Art signer fields and media `signed_by` projections.
- Add Art and media API endpoints for reading, adding, editing, archiving, and promoting signature records.
- Keep event autograph linking compatible by continuing to attach linked autographs to the canonical primary object signature unless a later workflow explicitly chooses a secondary target.
- Surface multiple signatures in Art/media readback without introducing multi-proof-per-signature storage.

### Acceptance Criteria

- Art and media detail responses can include more than one active signature record.
- Users can add secondary signatures without replacing the existing primary signature.
- Users can promote a secondary signature to primary, and compatibility fields update to that signature.
- Archiving signatures keeps Art `signed` state and media legacy signing fields aligned with the remaining primary signature or clears them when no active signatures remain.
- Existing single-signature Art/media create and edit flows continue to work as primary-signature shortcuts.
- API/OpenAPI/source-level/browser checks cover the multi-signature contract.

### Active Slice Notes

- Do not add multiple proof images per signature in this slice; each signature record keeps a single `proof_path`.
- Do not introduce a signer/person directory or controlled authority file yet.
- Keep Events as capture/history; object-level Art/media signatures remain canonical provenance.

### Closeout — 2026-04-26

- Released as `v3.4.13`.
- Version metadata synced across root app metadata, backend app/package metadata, and frontend app/package metadata.
- Release note added at `docs/releases/v3.4.13.md`.
- In-app Help > Releases feed regenerated with `v3.4.13` as the latest entry.
- Runtime verification used Docker-first evidence from rebuilt `backend`, `frontend`, `db`, homelab mode, and platform mode services.
- No schema migration was added; init parity and migration rehearsal were rerun against the existing migration set through version `79`.
- Local release closeout accounted for unit, OpenAPI, Art/media multi-signature browser regression, full browser regression, RBAC regression, homelab edition boundary, platform edition boundary, dependency audit, init parity, migration rehearsal, observability evidence, release note, release feed, API integration smoke, and running-stack health gates.
- Local preflight marked CI-secure compose-smoke cookie checks blocked because this local development stack runs with `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; tagged CI remains authoritative for that secure-cookie variant.
- Local `gitleaks`, Trivy, and SBOM tooling were not run in this shell, so tagged CI remains authoritative for `secret-scan`, `image-security-and-sbom`, and final release publication.
- Release evidence artifacts were inspected for unredacted secret-bearing patterns; secret-like values found in observability command evidence were redacted.
- Follow-up remains: full drawer-side multi-signature management UI and multi-proof-per-signature management.

## 3.4.14 — Art Physical Dimensions and Framing Metadata

**Goal:** Let native Art records track physical image dimensions and framed status as first-class Art metadata.

**Current Slice:** `Closed as v3.4.14`

### Scope

- Add Art height and width fields for artwork/image dimensions.
- Add a framed boolean field for Art records.
- Surface the fields in Art create/edit and detail readback.
- Keep the fields native to Art; do not add them back to Collectibles.
- Keep event purchase linking unchanged.

### Acceptance Criteria

- Art create/update accepts height, width, and framed metadata.
- Art detail/list responses include height, width, and framed metadata.
- The Art drawer can edit height, width, and framed status without changing the existing Art field layout.
- OpenAPI, init parity, migration rehearsal, and regression checks stay aligned.

### Active Slice Notes

- Treat dimensions as decimal numeric values without enforcing a unit in this slice.
- Label the UI fields as `H` and `W` to match the collection shorthand.
- A future task can add a unit field if mixed inches/centimeters becomes a real data need.

### Closeout — 2026-04-27

- Released as `v3.4.14`.
- Version artifact added at `docs/releases/v3.4.14.md`; final running app version alignment was completed with `v3.4.15` because `3.4.15` was the next closeout in the active release train.
- Art physical dimensions and framed metadata shipped as native Art fields, with drawer read/write coverage and no Collectibles backfill.
- Runtime verification used Docker-first evidence from the rebuilt app stack during the `3.4.15` closeout.
- Local release closeout accounted for backend unit, OpenAPI, focused Art/media browser regression, RBAC regression, homelab edition boundary, platform edition boundary, init parity, migration rehearsal, Help > Releases, and running-stack health gates.
- Local `gitleaks`, Trivy, and SBOM tooling were not run in this shell, so tagged CI remains authoritative for `secret-scan`, `image-security-and-sbom`, and final release publication.
- Follow-up remains: optional dimension unit metadata if mixed measurement systems become necessary.

## 3.4.15 — Drawer-Side Multi-Signature Management UI

**Goal:** Let Art and media drawers manage the shared multi-signature records introduced in `3.4.13` without forcing users through API-only workflows or overwriting the primary signature shortcut fields.

**Current Slice:** `Closed as v3.4.15`

### Scope

- Add a signatures list to Art and media edit drawers.
- Support adding and editing signer name, signer role, signed date, signed location/event context, proof path, and notes.
- Support archiving/removing a signature record from the drawer.
- Support promoting a secondary signature to primary from the drawer.
- Show primary versus secondary signatures clearly while preserving the existing primary-signature compatibility fields.
- Keep one proof path per signature; do not add multi-proof-per-signature storage in this slice.

### Acceptance Criteria

- Art drawers can add, edit, archive, and promote shared signature records.
- Media drawers can add, edit, archive, and promote shared signature records.
- Primary signature changes keep Art `signed` state and media legacy signing fields aligned through the existing backend contract.
- The UI distinguishes primary and secondary signatures without adding a separate signature system.
- Browser or API regression evidence covers the drawer-side multi-signature workflow.

### Active Slice Notes

- Build on the existing `signature_records` API and avoid schema changes unless the drawer work exposes a missing backend contract.
- Keep Event autograph artifacts as capture/history; this slice only manages canonical object-side Art/media signatures.

### Closeout — 2026-04-27

- Released as `v3.4.15`.
- Version metadata synced across root app metadata, backend package/app metadata, frontend package/app metadata, and lockfile package metadata.
- Release note added at `docs/releases/v3.4.15.md`; in-app Help > Releases feed regenerated with `v3.4.15` as the latest entry.
- Art and media drawers can add, edit, archive, and promote shared signature records while keeping primary signature compatibility fields aligned.
- Runtime verification used Docker-first evidence from rebuilt `backend` and `frontend` services, `/api/health`, and Help > Releases readback.
- Local release closeout accounted for backend unit, OpenAPI, focused Art/media browser regression, RBAC regression, homelab edition boundary, platform edition boundary, init parity, migration rehearsal, release preflight, dependency audit, Help > Releases, and running-stack health gates.
- Local `gitleaks`, Trivy, and SBOM tooling were not run in this shell, so tagged CI remains authoritative for `secret-scan`, `image-security-and-sbom`, and final release publication.
- Follow-up remains: shared proof upload/remove endpoints and multi-proof-per-signature management.

## 3.4.16 — Shared Signature Proof Upload/Remove

**Goal:** Normalize signature proof upload and removal around `signature_records` so Art and media drawers use the same proof workflow while existing object-level proof fields remain compatible.

**Current Slice:** `Closed as v3.4.16`

### Scope

- Add per-signature proof upload and remove endpoints for Art signature records.
- Add per-signature proof upload and remove endpoints for media signature records.
- Keep existing Art primary-proof and media signing-proof endpoints as compatibility paths.
- Update Art and media drawers to use the shared signature manager proof workflow.
- Preserve existing `proof_path`, `signature_proof_path`, and `signed_proof_path` readback compatibility.

### Acceptance Criteria

- Art signatures can upload, replace, open, and remove proof images from the drawer-side signature list.
- Media signatures can upload, replace, open, and remove proof images from the same shared drawer-side signature list.
- Updating proof on a primary media signature keeps `media.signed_proof_path` aligned.
- Updating proof on a primary Art signature keeps `signature_proof_path` readback aligned.
- Existing primary-proof endpoints continue to work for older clients.
- OpenAPI and browser/source regression coverage describe the shared proof contract.

### Active Slice Notes

- Keep this as single-proof-per-signature storage on `signature_records.proof_path`.
- Do not add a new proof attachment table or multi-proof UI in this slice.
- Multi-proof-per-signature evidence remains the likely next follow-up milestone.

### Closeout — 2026-04-27

- Released as `v3.4.16`.
- Version metadata synced across root app metadata, backend package/app metadata, frontend package/app metadata, and lockfile package metadata.
- Release note added at `docs/releases/v3.4.16.md`; in-app Help > Releases feed regenerated with `v3.4.16` as the latest entry.
- Art and media signatures now share per-signature proof upload/remove routes and drawer UI while legacy primary-proof endpoints remain compatible.
- Runtime verification used Docker-first evidence from rebuilt `backend` and `frontend` services, `/api/health`, and Help > Releases readback.
- Local release closeout accounted for backend unit, OpenAPI, Art/media browser regression, RBAC regression, homelab edition boundary, platform edition boundary, init parity, migration rehearsal, release preflight, dependency audit, observability evidence, Help > Releases, and running-stack health gates.
- Local `gitleaks`, Trivy, and SBOM tooling were not run in this shell, so tagged CI remains authoritative for `secret-scan`, `image-security-and-sbom`, and final release publication.
- Follow-up remains: multi-proof-per-signature evidence management if proof needs expand beyond one path per signature.

## 3.4.17 — Art Dimension Units

**Goal:** Let native Art height and width values carry explicit measurement unit metadata without converting or reinterpreting existing dimension values.

**Current Slice:** `Closed as v3.4.17`

### Scope

- Add an Art `dimension_unit` field for the existing H/W dimension values.
- Support inches and centimeters as the initial controlled unit values.
- Surface the unit in Art create/edit and detail readback.
- Keep the field native to Art; do not add it to Collectibles or event purchase links.
- Preserve existing H/W numeric behavior and avoid automatic unit conversion in this slice.

### Acceptance Criteria

- Art create/update accepts `dimension_unit` with `in`, `cm`, or null.
- Art detail/list responses include `dimension_unit`.
- The Art drawer can edit the unit alongside H/W and detail readback shows the unit with dimension values.
- OpenAPI, init parity, migration rehearsal, and regression checks stay aligned.

### Active Slice Notes

- Default new drawer entries to inches because the current local data examples are imperial, but store null when no dimension values are provided.
- Do not introduce separate height-unit and width-unit fields unless mixed-unit dimensions become a real need later.
- Do not convert existing height/width values during migration.

### Closeout — 2026-04-27

- Released as `v3.4.17`.
- Version metadata synced across root app metadata, backend package/app metadata, frontend package/app metadata, and lockfile package metadata.
- Release note added at `docs/releases/v3.4.17.md`; in-app Help > Releases feed regenerated with `v3.4.17` as the latest entry.
- Art dimension unit metadata shipped as native Art `dimension_unit` storage with `in`/`cm` validation, API/OpenAPI readback, drawer editing, and detail display.
- Runtime verification used Docker-first evidence from rebuilt `backend` and `frontend` services, `/api/health`, live schema migration `81`, and Help > Releases readback.
- Local closeout used `AGENTS.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, and `docs/wiki/10-CI-CD-and-Registry-Deploy.md` as release/checklist policy sources.
- Local release closeout accounted for backend unit, OpenAPI, focused Art/Event browser regression, full browser regression, RBAC regression, homelab edition boundary, platform edition boundary, init parity, migration rehearsal, release preflight, dependency audit, observability evidence, Help > Releases, and running-stack health gates.
- Local preflight marked CI-secure compose-smoke cookie checks blocked because this local development stack runs with `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; tagged CI remains authoritative for that secure-cookie variant.
- Local `gitleaks`, Trivy, and SBOM tooling were not run in this shell, so tagged CI remains authoritative for `secret-scan`, `image-security-and-sbom`, and final release publication.
- Generated release evidence artifacts were checked for unredacted secret-like patterns; only redacted observability command placeholders were present.
- No remaining work in `3.4.17`.

## 3.4.18 — Multi-Proof Signature Evidence Management

**Goal:** Let Art and media signature records keep multiple proof images while preserving the existing single `proof_path` compatibility field for older clients and primary-proof readback.

**Current Slice:** `Closed as v3.4.18`

### Scope

- Add a shared `signature_proofs` child table for per-signature evidence images.
- Backfill existing `signature_records.proof_path` values into `signature_proofs`.
- Keep `signature_records.proof_path` as the primary/first proof projection for compatibility.
- Add Art and media routes to remove an individual proof from a signature.
- Update shared Art/media drawer signature management to list, upload, open, and remove multiple proof images.

### Acceptance Criteria

- Art and media signature readback includes a `proofs` array on each signature record.
- Uploading another proof appends evidence instead of replacing the existing proof.
- Removing one proof does not remove the other proof images on that signature.
- Primary compatibility fields (`signature_proof_path`, `signed_proof_path`, and `proof_path`) continue to project the primary/first active proof.
- OpenAPI, init parity, migration rehearsal, and browser/API regression checks stay aligned.

### Active Slice Notes

- Keep one primary/compatibility projection per signature in this slice; do not add richer proof labels or certificate metadata yet.
- Do not move event artifacts into the proof table in this slice, though event-linked signatures still retain their existing proof path projection.
- Preserve existing `/proof` upload/remove routes as compatibility paths while adding proof-specific remove routes for the new UI.

### Closeout — 2026-04-27

- Released as `v3.4.18`.
- Version metadata synced across root app metadata, backend package/app metadata, frontend package/app metadata, and lockfile package metadata.
- Release note added at `docs/releases/v3.4.18.md`; in-app Help > Releases feed regenerated with `v3.4.18` as the latest entry.
- Multi-proof signature evidence shipped through the shared `signature_proofs` table, Art/media API routes, OpenAPI schema, and shared drawer UI.
- Existing single-proof compatibility readback remains projected through `signature_records.proof_path`, Art `signature_proof_path`, and media `signed_proof_path`.
- Runtime verification used Docker-first evidence from rebuilt `backend` and `frontend` services, `/api/health`, live schema migration `82`, and Help > Releases readback.
- Local closeout used `AGENTS.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, and `docs/wiki/10-CI-CD-and-Registry-Deploy.md` as release/checklist policy sources.
- Local release closeout accounted for backend unit, OpenAPI, focused Art/media browser regression, RBAC regression, homelab edition boundary, platform edition boundary, init parity, migration rehearsal, release preflight, dependency audit, observability evidence, Help > Releases, and running-stack health gates.
- Local preflight marked CI-secure compose-smoke cookie checks blocked because this local development stack runs with `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; tagged CI remains authoritative for that secure-cookie variant.
- Local `gitleaks`, Trivy, and SBOM tooling were not run in this shell, so tagged CI remains authoritative for `secret-scan`, `image-security-and-sbom`, and final release publication.
- Generated release evidence artifacts were checked for unredacted secret-like patterns; only redacted observability command placeholders were present.
- Follow-up remains: optional per-proof labels, certificate/evidence type, and proof notes if evidence management needs richer metadata.

## 3.4.19 — Signature Proof Evidence Metadata

**Goal:** Let each Art/media signature proof explain what kind of evidence it is without changing the shared signature ownership model or replacing the multi-proof storage added in `3.4.18`.

**Current Slice:** `Closed as v3.4.19`

### Scope

- Add per-proof metadata fields to `signature_proofs`:
  - evidence type,
  - short label,
  - notes.
- Allow Art and media proof uploads to include evidence metadata.
- Add Art and media per-proof metadata update endpoints.
- Update the shared signature drawer to display and edit metadata for each proof.
- Keep existing proof-path compatibility projection unchanged.

### Acceptance Criteria

- Art and media signature proof readback includes type, label, and notes.
- Users can add proof metadata during upload.
- Users can edit proof metadata after upload without replacing or removing the proof image.
- Existing primary proof compatibility fields continue to behave as in `3.4.18`.
- Migration/init parity, OpenAPI, and focused Art/media proof regressions stay aligned.

### Active Slice Notes

- This slice intentionally avoids richer attachment storage, OCR, certificate validation, or event-artifact promotion.
- Use simple, user-correctable metadata instead of enforcing a rigid evidence taxonomy too early.

### Closeout — 2026-04-27

- Released as `v3.4.19`.
- Version metadata synced across root app metadata, backend package/app metadata, frontend package/app metadata, and lockfile package metadata.
- Release note added at `docs/releases/v3.4.19.md`; in-app Help > Releases feed regenerated with `v3.4.19` as the latest entry.
- Signature proof evidence metadata shipped through migration `83`, shared signature services, Art/media routes, OpenAPI schema, shared drawer UI, and focused browser coverage.
- Existing primary proof compatibility readback remains projected through `signature_records.proof_path`, Art `signature_proof_path`, and media `signed_proof_path`.
- Runtime verification used Docker-first evidence from rebuilt `backend` and `frontend` services, `/api/health`, live schema migration `83`, and Help > Releases readback.
- Local closeout used `AGENTS.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, and `docs/wiki/10-CI-CD-and-Registry-Deploy.md` as release/checklist policy sources.
- Local release closeout accounted for backend unit, OpenAPI, focused Art/media browser regression, RBAC regression, homelab edition boundary, platform edition boundary, init parity, migration rehearsal, release preflight, dependency audit, observability evidence, Help > Releases, and running-stack health gates.
- Local preflight marked CI-secure compose-smoke cookie checks blocked because this local development stack runs with `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; tagged CI remains authoritative for that secure-cookie variant.
- Local `gitleaks`, Trivy, and SBOM tooling were not run in this shell, so tagged CI remains authoritative for `secret-scan`, `image-security-and-sbom`, and final release publication.
- Generated release evidence artifacts were checked for unredacted secret-like patterns; only redacted observability command placeholders were present.
- Follow-up remains: event artifact promotion into signature proofs and explicit primary-proof selection if users need more provenance curation.

## 3.4.20 — Public Homelab Compose and Private Platform Surface Scrub

**Goal:** Make the GitHub-visible deployment surface homelab-first by shipping one generated public compose file, defaulting the backend runtime to homelab when no private edition is explicitly configured, and moving private platform deployment details out of tracked public docs.

**Current Slice:** `Closed 2026-04-27`

### Why this work exists

- Public homelab deployers should see one clear compose path instead of choosing between multiple root compose variants.
- The private platform/dev stack should not be the default committed deployment story.
- Backend runtime behavior should be safe-by-default for public deployments: homelab unless a private stack explicitly opts into platform behavior.

### Scope

- Replace the tracked root compose variants with a generated public `docker-compose.yml` for homelab registry-image deployment.
- Add an idempotent compose generator and a public-export validation script.
- Remove tracked `docker-compose.registry.yml` and `docker-compose.homelab.yml`.
- Update backend product edition normalization so missing/invalid runtime edition resolves to homelab.
- Keep explicit private platform support available through untracked local/CI compose overrides.
- Scrub public deployment docs, setup helper output, env examples, and root package scripts so public deploy instructions use only the generated compose path.
- Update CI/source verification to layer temporary build/private overrides on top of the public compose without committing those private compose files.

### Acceptance Criteria

- Only one tracked root compose file remains: `docker-compose.yml`.
- `docker-compose.yml` is generated, homelab-safe, image-based, and contains no `APP_EDITION` entry.
- `env.example` contains no public app-edition setting.
- Backend default edition is homelab unless `platform` is explicitly set by a private/local/CI override.
- Public docs do not instruct users to run private platform compose or old registry/homelab compose variants.
- Public-export validation passes.
- Docker-first verification proves the generated compose can be config-rendered and the source-built stack still passes default homelab and explicit platform boundary checks.

### Active Slice Notes

- This slice intentionally does not rename all code/test/OpenAPI product-edition strings; those remain part of the private source boundary and CI verification contract.
- The Vite cleanup follow-through originally selected as `3.4.20` moves to `3.4.21`.
- Private platform deployment should use untracked local compose overrides such as `docker-compose.localhost.yml`.

### Closeout Notes

- Roadmap slice: `3.4.20 — Public Homelab Compose and Private Platform Surface Scrub`.
- Project docs/checklists used:
  - `AGENTS.md`
  - `docs/wiki/03-Docker-Compose-Setup.md`
  - `docs/wiki/04-Docker-CLI-and-Portainer-Deploy.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
  - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
- Runtime verification used Docker-first evidence from the generated public compose plus temporary `.ci` source/private overrides:
  - generated `docker-compose.yml` was idempotent,
  - `docker compose --env-file .env config` rendered successfully,
  - default rebuilt stack served `/api/health` as `3.4.20`,
  - default backend container had no `APP_EDITION` and resolved to `homelab`,
  - `/api/auth/config` reported homelab contract,
  - explicit private platform override resolved to `platform`,
  - Help > Releases served `3.4.20` as the latest entry.
- CI/checks run locally:
  - `node --check scripts/generate-public-compose.js`
  - `node --check scripts/validate-public-export-surface.js`
  - `node --check scripts/write-ci-compose-overrides.js`
  - `node --check backend/config/productEdition.js`
  - `node --check backend/scripts/api-integration-smoke.js`
  - `node --check backend/scripts/observability-release-evidence.js`
  - `node scripts/validate-public-export-surface.js`
  - `npm --prefix frontend ci --no-fund`
  - `npm --prefix backend ci --no-fund`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:unit`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:openapi`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:init-parity`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:migration-rehearsal`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:integration-smoke`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:homelab-edition-boundary`
  - `docker compose -p collectz-platform-smoke --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml -f .ci/docker-compose.platform.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:platform-edition-boundary`
  - `docker compose -p collectz-platform-smoke --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml -f .ci/docker-compose.platform.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:rbac-regression`
  - `PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted> PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:browser -- tests/playwright/specs/homelab-help.browser.spec.js tests/playwright/specs/homelab-shared.browser.spec.js`
  - `PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted> PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 PLAYWRIGHT_COMPOSE_PROJECT=collectz-platform-smoke PLAYWRIGHT_COMPOSE_ENV_FILE=.env npm run test:browser`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T -e BASE_URL=http://frontend:3000 -e EXPECTED_VERSION=3.4.20 backend npm run test:help-releases-smoke`
  - `npm --prefix backend run test:observability-evidence`
  - `npm --prefix backend run test:release-preflight-local`
- Release artifacts:
  - `docs/releases/v3.4.20.md`
  - regenerated `backend/release-feed.json`
  - regenerated `preflight-go-no-go.md`
  - regenerated dependency audit and observability evidence artifacts.
- Files changed:
  - public compose generation, validation, and CI override scripts;
  - root compose, env example, setup helper, package scripts, and public deploy docs;
  - backend product-edition defaulting and smoke/test expectations;
  - GitHub workflow compose layering;
  - homelab browser regression specs;
  - version metadata and release feed.
- Risks or follow-ups:
  - Tagged CI remains authoritative for `secret-scan` and `image-security-and-sbom`.
  - Local release preflight still marks secure-cookie compose basics as blocked in the local development stack because it intentionally runs with development cookie/runtime settings.
  - Backend dependency audit still reports two moderate production findings; no high or critical findings were introduced locally.
  - Vite cleanup follow-through remains queued as `3.4.21`.
- What remains in the milestone: nothing; `3.4.20` is closed.
- Recommended commit message: `Release 3.4.20 public homelab compose generation and private platform surface scrub`

## 3.4.21 — Frontend Vite Cleanup and Env Naming Follow-through

**Goal:** Finish the post-`3.0.0` frontend build modernization cleanup by removing stale CRA-shaped artifacts, making Vite env naming the preferred maintainer-facing path, and documenting any remaining compatibility shims intentionally.

**Current Slice:** `Closed 2026-04-27`

### Scope

- Audit frontend build/runtime inputs for remaining CRA-era assumptions.
- Make `VITE_*` the preferred frontend env naming path for maintainers and Docker builds.
- Keep backward compatibility for existing deployments only where it is intentional and documented.
- Update Docker/compose/CI docs so future frontend work clearly uses Vite terminology and output expectations.
- Confirm Vite output still serves correctly through the nginx frontend image.

### Acceptance Criteria

- The active frontend build path is visibly Vite-first in package scripts, Docker build args, compose wiring, and maintainer docs.
- Stale CRA-only files or local output directories are removed from tracked source or explicitly ignored.
- Any remaining `REACT_APP_*` support is documented as compatibility, not the preferred interface.
- `VITE_*` env names are available for the frontend API URL, app version, debug flag, and CSRF cookie name.
- Docker-first frontend build verification passes.
- Running-stack `/api/health` and browser smoke evidence confirm the rebuilt frontend is served correctly.

### Closeout Notes

- Roadmap slice: `3.4.21 — Frontend Vite Cleanup and Env Naming Follow-through`.
- Project docs/checklists used:
  - `AGENTS.md`
  - `docs/wiki/01-Configuration-and-Use.md`
  - `docs/wiki/02-Environment-Variables.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
  - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
- Runtime verification used Docker-first evidence from the generated public compose plus temporary `.ci` source/private overrides:
  - frontend image rebuilt through `npm run build:vite` and copied `/app/dist` into nginx,
  - `/api/health` reported `3.4.21` for app/frontend/backend metadata,
  - `/api/auth/config` reported the default homelab contract,
  - Help > Releases served `3.4.21` as the latest entry.
- CI/checks run locally:
  - `node --check frontend/vite.config.js`
  - `node --check backend/scripts/unit-tests.js`
  - `node --check scripts/write-ci-compose-overrides.js`
  - `node scripts/validate-public-export-surface.js`
  - `docker compose --env-file .env config`
  - `npm --prefix frontend ci --no-fund`
  - `APP_VERSION=3.4.21 docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml up -d --build backend frontend`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:unit`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:openapi`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:init-parity`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:migration-rehearsal`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:homelab-edition-boundary`
  - `docker compose -p collectz-platform-smoke --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml -f .ci/docker-compose.platform.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:platform-edition-boundary`
  - `docker compose -p collectz-platform-smoke --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml -f .ci/docker-compose.platform.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:rbac-regression`
  - `PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted> PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:browser -- tests/playwright/specs/homelab-help.browser.spec.js tests/playwright/specs/homelab-shared.browser.spec.js`
  - `PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted> PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 PLAYWRIGHT_COMPOSE_PROJECT=collectz-platform-smoke PLAYWRIGHT_COMPOSE_ENV_FILE=.env npm run test:browser`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T -e BASE_URL=http://frontend:3000 -e EXPECTED_VERSION=3.4.21 backend npm run test:help-releases-smoke`
  - `npm --prefix backend run test:observability-evidence`
  - `npm --prefix backend run test:release-preflight-local`
- Release artifacts:
  - `docs/releases/v3.4.21.md`
  - regenerated `backend/release-feed.json`
  - regenerated `preflight-go-no-go.md`
  - regenerated dependency audit, init parity, migration rehearsal, and observability evidence artifacts.
- Files changed:
  - Vite-first frontend env helper and API/version/CSRF env reads,
  - frontend Dockerfile build args,
  - CI frontend build args and generated CI compose override args,
  - public docs and env examples,
  - stale CRA-era `frontend/public/index.html` removal,
  - version metadata and release feed.
- Risks or follow-ups:
  - `REACT_APP_*` compatibility remains intentionally as a build-time fallback; a later cleanup can remove it once private/local workflows have fully moved to `VITE_*`.
  - Tagged CI remains authoritative for `secret-scan` and `image-security-and-sbom`.
  - Local release preflight still marks secure-cookie compose basics as blocked in the local development stack because it intentionally runs with development cookie/runtime settings.
  - Backend dependency audit still reports two moderate production findings; no high or critical findings were introduced locally.
- What remains in the milestone: nothing; `3.4.21` is closed.
- Recommended commit message: `Release 3.4.21 frontend Vite env cleanup and build-contract follow-through`

## 3.4.22 — Mobile Photo Upload Source Selection

**Goal:** Rework mobile photo upload surfaces so users can intentionally choose between selecting an existing image from their library and taking a new photo.

**Current Slice:** `Closed 2026-04-27`

### Scope

- Audit image upload and camera entry points in Art, Collectibles, Events, and shared signature proof management.
- Replace ambiguous `Upload/Capture image` controls with explicit source actions:
  - `Choose from Library` for ordinary image file selection,
  - `Take Photo` for camera-only capture.
- Remove `capture="environment"` from generic file-library inputs so mobile browsers can open the photo library.
- Preserve curated in-app camera modal flows for Art, Collectibles, and Events where already available.
- Use a shared frontend primitive so future image/proof upload controls do not drift back into mixed-source behavior.

### Acceptance Criteria

- Mobile users can choose an existing photo from their device library without being forced into camera capture.
- Mobile users can still intentionally open a camera capture flow when they want to take a new photo.
- The camera-only button is clearly differentiated from library upload.
- Desktop upload behavior remains functional and uses the same intent/copy.
- The behavior is verified on a responsive mobile browser path before promotion closes.

### Active Slice Notes

- This is a UI/UX behavior patch; it does not change image upload API contracts or stored file paths.
- Event artifact and signature proof uploads use browser camera capture as the explicit camera fallback when they do not have the curated in-app camera modal.

### Closeout Notes

- Roadmap slice: `3.4.22 — Mobile Photo Upload Source Selection`.
- Project docs/checklists used:
  - `AGENTS.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
  - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
- Runtime verification used Docker-first evidence from the generated public compose plus temporary `.ci` source/private overrides:
  - default frontend/backend images rebuilt with `APP_VERSION=3.4.22`,
  - `/api/health` reported `3.4.22` for app/frontend/backend metadata,
  - default homelab stack served the responsive Art drawer upload controls,
  - explicit platform override stack served `/api/health` as `3.4.22` on the alternate local port,
  - Help > Releases served `3.4.22` as the latest entry.
- CI/checks run locally:
  - `docker compose --env-file .env config`
  - `node scripts/validate-public-export-surface.js`
  - `npm --prefix frontend ci --no-fund`
  - `npm --prefix backend ci --no-fund`
  - `APP_VERSION=3.4.22 docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml up -d --build backend frontend`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:unit`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:openapi`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:init-parity`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:migration-rehearsal`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:homelab-edition-boundary`
  - `FRONTEND_PORT=3200 APP_VERSION=3.4.22 docker compose -p collectz-platform-smoke --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml -f .ci/docker-compose.platform.yml up -d backend frontend`
  - `docker compose -p collectz-platform-smoke --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml -f .ci/docker-compose.platform.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:platform-edition-boundary`
  - `docker compose -p collectz-platform-smoke --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml -f .ci/docker-compose.platform.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:rbac-regression`
  - `PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted> PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:browser -- tests/playwright/specs/events-collectibles.browser.spec.js -g "mobile art image controls"`
  - `PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted> PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:browser -- tests/playwright/specs/homelab-help.browser.spec.js tests/playwright/specs/homelab-shared.browser.spec.js`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T -e BASE_URL=http://frontend:3000 -e EXPECTED_VERSION=3.4.22 backend npm run test:help-releases-smoke`
  - `npm --prefix backend run test:observability-evidence`
  - `npm --prefix backend run test:release-preflight-local`
- Release artifacts:
  - `docs/releases/v3.4.22.md`
  - regenerated `backend/release-feed.json`
  - regenerated `preflight-go-no-go.md`
  - regenerated dependency audit, init parity, migration rehearsal, and observability evidence artifacts.
- Files changed:
  - shared `ImageSourceControl` frontend primitive,
  - Art, Collectibles, Events, event artifact, and signature proof upload controls,
  - focused unit source assertions and responsive mobile browser regression,
  - version metadata, generated compose defaults, release note, release feed, roadmap, and backlog.
- Risks or follow-ups:
  - Event artifact and signature proof camera actions still use the browser/OS camera fallback rather than the curated in-app camera modal.
  - Tagged CI remains authoritative for `secret-scan` and `image-security-and-sbom`.
  - Local release preflight still marks secure-cookie compose basics as blocked in the local development stack because it intentionally runs with development cookie/runtime settings.
  - The local preflight helper also marks browser regression as blocked because it does not ingest separately run Playwright evidence; focused mobile and homelab browser regressions were run manually above.
  - Backend dependency audit still reports two moderate production findings; no high or critical findings were introduced locally.
- What remains in the milestone: nothing; `3.4.22` is closed.
- Recommended commit message: `Release 3.4.22 mobile photo upload source selection and explicit camera controls`

## 3.4.23 — Detail Drawer Cover Backdrop Spacing

**Goal:** Make media detail drawers use a stable movie-style header band even when items only have cover art and no separate backdrop image.

**Current Slice:** `Closed 2026-04-27`

### Scope

- Fix Audio, Books, Comics, Games, Movies, and TV detail drawers so foreground cover art is not pulled into the top edge when no backdrop exists.
- Reuse the item cover/poster as the cropped header backdrop when `backdrop_path` is unavailable.
- Preserve the existing movie drawer layout when a real backdrop exists.
- Add a focused source regression guard for the fallback header behavior.

### Acceptance Criteria

- Media detail drawers always reserve header space before the foreground cover preview.
- Items without TMDB-style backdrops still have a header image area using their cover/poster art.
- Existing movie/TV backdrop behavior remains intact.
- The patch is verified through the Docker-first frontend/backend stack and release metadata is aligned.

### Closeout Notes

- Roadmap slice: `3.4.23 — Detail Drawer Cover Backdrop Spacing`.
- Project docs/checklists used:
  - `AGENTS.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
  - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
- Runtime verification used Docker-first evidence from the generated public compose plus temporary `.ci` source override:
  - default frontend/backend images rebuilt with `APP_VERSION=3.4.23`,
  - `/api/health` reported `3.4.23` for app/frontend/backend metadata,
  - Help > Releases served `3.4.23` as the latest entry.
- CI/checks run locally:
  - `docker compose --env-file .env config`
  - `node scripts/validate-public-export-surface.js`
  - `APP_VERSION=3.4.23 docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml up -d --build backend frontend`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:unit`
  - `PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted> PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:browser -- tests/playwright/specs/library-multiformat.browser.spec.js -g "media detail uses cover art as the header backdrop"`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T -e BASE_URL=http://frontend:3000 -e EXPECTED_VERSION=3.4.23 backend npm run test:help-releases-smoke`
- Release artifacts:
  - `docs/releases/v3.4.23.md`
  - regenerated `backend/release-feed.json`
- Files changed:
  - media detail drawer header fallback behavior,
  - focused unit source assertion,
  - focused browser regression for cover-as-backdrop detail drawers,
  - version metadata, generated compose defaults, release note, release feed, and roadmap.
- Risks or follow-ups:
  - Tagged CI remains authoritative for `secret-scan`, `dependency-scan`, `image-security-and-sbom`, and full browser regression.
  - Art, Collectibles, and Events already use uploaded images as header imagery when available; a later shared drawer-header primitive could reduce duplicate component markup.
- What remains in the milestone: nothing; `3.4.23` is closed.
- Recommended commit message: `Release 3.4.23 detail drawer cover backdrop spacing and media header fallback`

## 3.4.24 — Shared Drawer Backdrop Primitive

**Goal:** Consolidate repeated detail-drawer backdrop/header image markup so Media, Art, Collectibles, and Events keep one shared behavior for cropped header imagery.

**Current Slice:** `Closed 2026-04-27`

### Scope

- Add a shared frontend primitive for drawer backdrop/header image bands.
- Keep Media's `backdrop_path || poster_path` fallback from `3.4.23`.
- Move Art, Collectibles, and Events detail drawers onto the same primitive while preserving their existing image heights and foreground preview behavior.
- Add source assertions that protect the shared primitive wiring.

### Acceptance Criteria

- Media, Art, Collectibles, and Events detail drawers all use one shared backdrop primitive.
- Media items without separate backdrops still use cover art as the backdrop.
- Art, Collectibles, and Events retain their existing uploaded-image header treatment.
- Docker-first build and focused regression checks pass after the consolidation.

### Closeout Notes

- Roadmap slice: `3.4.24 — Shared Drawer Backdrop Primitive`.
- Project docs/checklists used:
  - `AGENTS.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
  - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
- Runtime verification used Docker-first evidence from the generated public compose plus temporary `.ci` source override:
  - default frontend/backend images rebuilt with `APP_VERSION=3.4.24`,
  - `/api/health` reported `3.4.24` for app/frontend/backend metadata,
  - Help > Releases served `3.4.24` as the latest entry.
- CI/checks run locally:
  - `docker compose --env-file .env config`
  - `node scripts/validate-public-export-surface.js`
  - `APP_VERSION=3.4.24 docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml up -d --build backend frontend`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:unit`
  - `PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted> PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:browser -- tests/playwright/specs/library-multiformat.browser.spec.js -g "media detail uses cover art as the header backdrop"`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T -e BASE_URL=http://frontend:3000 -e EXPECTED_VERSION=3.4.24 backend npm run test:help-releases-smoke`
- Release artifacts:
  - `docs/releases/v3.4.24.md`
  - regenerated `backend/release-feed.json`
- Files changed:
  - shared `DrawerBackdrop` frontend primitive,
  - Media, Art, Collectibles, and Events detail drawer backdrop calls,
  - focused unit source assertions,
  - version metadata, generated compose defaults, release note, release feed, and roadmap.
- Risks or follow-ups:
  - Tagged CI remains authoritative for `secret-scan`, `dependency-scan`, `image-security-and-sbom`, and full browser regression.
  - A broader drawer-shell primitive could further reduce duplicate slide-over markup, but that is intentionally out of scope for this narrow cleanup.
- What remains in the milestone: nothing; `3.4.24` is closed.
- Recommended commit message: `Release 3.4.24 shared drawer backdrop primitive and header image consolidation`

## 3.4.25 — Release Evidence Token Hygiene Cleanup

**Goal:** Remove fixed local Playwright bypass token values from committed release evidence examples and guard against reintroducing them.

**Current Slice:** `Closed 2026-04-27`

### Scope

- Redact old fixed `PLAYWRIGHT_E2E_BYPASS_TOKEN` examples from roadmap closeouts and release notes.
- Preserve command shape while replacing token material with `<redacted>`.
- Add a lightweight source guard so roadmap/release notes cannot reintroduce fixed local bypass token examples unnoticed.
- Keep this as docs/release-evidence hygiene only; do not change runtime token behavior.

### Acceptance Criteria

- Committed roadmap and release notes no longer contain the old fixed local Playwright bypass token example.
- New command examples keep token values redacted.
- Backend unit tests include a guard for this release evidence hygiene rule.
- Version metadata and Help > Releases are aligned to `3.4.25`.

### Closeout Notes

- Roadmap slice: `3.4.25 — Release Evidence Token Hygiene Cleanup`.
- Project docs/checklists used:
  - `AGENTS.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
  - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
- Runtime verification used Docker-first evidence from the generated public compose plus temporary `.ci` source override:
  - default frontend/backend images rebuilt with `APP_VERSION=3.4.25`,
  - `/api/health` reported `3.4.25` for app/frontend/backend metadata,
  - Help > Releases served `3.4.25` as the latest entry.
- CI/checks run locally:
  - `docker compose --env-file .env config`
  - `node scripts/validate-public-export-surface.js`
  - `APP_VERSION=3.4.25 docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml up -d --build backend frontend`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:unit`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T -e BASE_URL=http://frontend:3000 -e EXPECTED_VERSION=3.4.25 backend npm run test:help-releases-smoke`
  - `rg -n 'PLAYWRIGHT_E2E_BYPASS_TOKEN=<fixed-local-example>' docs/wiki/07-Release-Roadmap.md docs/releases`
- Release artifacts:
  - `docs/releases/v3.4.25.md`
  - regenerated `backend/release-feed.json`
- Files changed:
  - roadmap and release-note token redactions,
  - release-doc source guard in backend unit tests,
  - UI/UX cleanup working plan in backlog,
  - version metadata, generated compose defaults, release note, release feed, and roadmap.
- Risks or follow-ups:
  - Tagged CI remains authoritative for `secret-scan`, `dependency-scan`, `image-security-and-sbom`, and full browser regression.
  - This milestone covers committed roadmap/release notes; generated artifacts should continue to be inspected under the existing release evidence policy.
- What remains in the milestone: nothing; `3.4.25` is closed.
- Recommended commit message: `Release 3.4.25 release evidence token hygiene cleanup and Playwright command redaction`

## 3.4.26 — Shared Detail Drawer Shell and Mobile Density Audit

**Goal:** Pair the shared detail drawer shell cleanup with a small mobile density pass so common drawer structure and phone-sized spacing improve together.

**Current Slice:** `Closed 2026-04-27`

### Scope

- Extract a shared detail drawer shell primitive for the standard overlay, side panel, border, and slide-in wrapper.
- Migrate Media, Art, Collectibles, and Events detail drawers onto the shared shell.
- Keep edit drawers out of scope for this first pass.
- Tighten obvious mobile-only spacing drift in detail drawer headers and bodies without changing desktop spacing.
- Add source assertions for shared shell usage and mobile density guardrails.

### Acceptance Criteria

- Media, Art, Collectibles, and Events detail drawers use `DetailDrawerShell`.
- Existing backdrop/header behavior from `3.4.24` remains intact.
- Mobile detail drawer spacing is less padded on narrow viewports while preserving desktop spacing.
- Version metadata and Help > Releases are aligned to `3.4.26`.

### Closeout Notes

- Roadmap slice: `3.4.26 — Shared Detail Drawer Shell and Mobile Density Audit`.
- Project docs/checklists used:
  - `AGENTS.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
  - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
- Runtime verification used Docker-first evidence from the generated public compose plus temporary `.ci` source override:
  - default frontend/backend images rebuilt with `APP_VERSION=3.4.26`,
  - `/api/health` reported `3.4.26` for app/frontend/backend metadata,
  - Help > Releases served `3.4.26` as the latest entry.
- CI/checks run locally:
  - `docker compose --env-file .env config`
  - `node scripts/validate-public-export-surface.js`
  - `APP_VERSION=3.4.26 docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml up -d --build backend frontend`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:unit`
  - `PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted> PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:browser -- tests/playwright/specs/library-multiformat.browser.spec.js -g "media detail uses cover art as the header backdrop"`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T -e BASE_URL=http://frontend:3000 -e EXPECTED_VERSION=3.4.26 backend npm run test:help-releases-smoke`
- Release artifacts:
  - `docs/releases/v3.4.26.md`
  - regenerated `backend/release-feed.json`
- Files changed:
  - shared `DetailDrawerShell` frontend primitive,
  - Media, Art, Collectibles, and Events detail drawer shell wrappers,
  - mobile-only detail drawer spacing in Media, Collectibles, and Events,
  - focused unit source assertions,
  - version metadata, generated compose defaults, release note, release feed, roadmap, and backlog plan.
- Risks or follow-ups:
  - Tagged CI remains authoritative for `secret-scan`, `dependency-scan`, `image-security-and-sbom`, and full browser regression.
  - Edit drawer shell migration remains intentionally deferred until the detail shell proves stable.
  - Image/proof control language parity remains the next UI cleanup task.
- What remains in the milestone: nothing; `3.4.26` is closed.
- Recommended commit message: `Release 3.4.26 shared detail drawer shell and mobile density cleanup`

## 3.4.27 — Image and Proof Control Language Parity

**Goal:** Align image and proof action language across covers, event artifact images, and signature proof images so users do not have to relearn upload/remove/open behavior by drawer type.

**Current Slice:** `Closed 2026-04-27`

### Scope

- Audit image controls across Media, Art, Collectibles, Events, event artifacts, and signature proofs.
- Standardize action labels such as `Choose from Library`, `Take Photo`, `Replace image`, `Remove image`, `Open image`, and proof-specific equivalents where they apply.
- Preserve existing upload endpoints, stored paths, and proof/image persistence behavior.
- Clarify when a selected replacement makes existing open/remove actions unnecessary in the current edit session.
- Add focused source assertions for shared image/proof control language.

### Acceptance Criteria

- Similar image/proof tasks use similar labels and control order across the app.
- Mobile source selection remains explicit and does not force camera capture when choosing from the photo library.
- Existing proof/image upload and remove flows continue to work.
- A focused source assertion covers shared image/proof control behavior.
- Version metadata and Help > Releases are aligned to `3.4.27`.

### Closeout Notes

- Roadmap slice: `3.4.27 — Image and Proof Control Language Parity`.
- Project docs/checklists used:
  - `AGENTS.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
  - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
- Runtime verification used Docker-first evidence from the generated public compose plus temporary `.ci` source override:
  - default frontend/backend images rebuilt with `APP_VERSION=3.4.27`,
  - `/api/health` reported `3.4.27` for app/frontend/backend metadata,
  - Help > Releases served `3.4.27` as the latest entry.
- CI/checks run locally:
  - `docker compose --env-file .env config`
  - `node scripts/validate-public-export-surface.js`
  - `APP_VERSION=3.4.27 docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml up -d --build backend frontend`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:unit`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:openapi`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T -e BASE_URL=http://frontend:3000 -e EXPECTED_VERSION=3.4.27 backend npm run test:help-releases-smoke`
  - `git diff --check`
  - fixed-token grep across the new release note, roadmap, release feed, and Playwright artifacts
- Browser regression note:
  - A focused Playwright event-artifact test was attempted with a redacted bypass token, but it stopped before the UI assertion because `/api/admin/feature-flags` returned `403` on the default stack.
  - Local source/unit assertions cover this slice's image/proof language behavior; tagged CI remains authoritative for the full `browser-regression` gate.
- Release artifacts:
  - `docs/releases/v3.4.27.md`
  - regenerated `backend/release-feed.json`
- Files changed:
  - event artifact image action labels and pending-replacement hiding,
  - media cover image helper/action copy,
  - shared signature proof picker/list action copy,
  - focused unit source assertions,
  - version metadata, generated compose defaults, release note, release feed, roadmap, and backlog plan.
- Risks or follow-ups:
  - Tagged CI remains authoritative for `secret-scan`, `dependency-scan`, `image-security-and-sbom`, `rbac-regression`, `browser-regression`, `homelab-edition-boundary`, and `platform-edition-boundary`.
  - This release does not change upload endpoints or proof storage; a later edit-drawer pass can decide whether media cover picking should move fully onto the shared `CoverImagePicker` primitive.
- What remains in the milestone: nothing; `3.4.27` is closed.
- Recommended commit message: `Release 3.4.27 image and proof control language parity`

## 3.4.28 — TMDB Rate-Limit Investigation and Search Optimization

**Goal:** Identify whether movie-add limit failures are app-side or upstream TMDB-side, then reduce avoidable TMDB pressure in the add/edit lookup flow without changing provider contracts.

**Current Slice:** `Closed 2026-04-27`

### Scope

- Reproduce the movie-add lookup path from source and runtime evidence enough to identify which layer owns the visible limit response.
- Distinguish the app-side external-provider limiter from upstream TMDB 429/error responses.
- Review the movie add flow for avoidable duplicate TMDB calls.
- Implement the smallest safe optimization if a duplicate call path is clear.
- Preserve existing TMDB endpoints, integration settings, and stored media fields.

### Acceptance Criteria

- The likely source of the limit response is documented as app-side, TMDB-side, or still unverified.
- The relevant app-side limiter route and setting are called out clearly.
- Identifier results that already include TMDB/provider enrichment do not trigger a redundant follow-up title search when selected.
- Existing title-only and identifier-only fallback behavior continues for results that do not include enrichment data.
- Version metadata and Help > Releases are aligned to `3.4.28`.

### Closeout Notes

- Roadmap slice: `3.4.28 — TMDB Rate-Limit Investigation and Search Optimization`.
- Project docs/checklists used:
  - `AGENTS.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
  - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
- Runtime verification used Docker-first evidence from the generated public compose plus temporary `.ci` source override:
  - default frontend/backend images rebuilt with `APP_VERSION=3.4.28`,
  - `/api/health` reported `3.4.28` for app/frontend/backend metadata,
  - Help > Releases served `3.4.28` as the latest entry,
  - running backend logs confirmed `externalApiMax=30`.
- Rate-limit finding:
  - app-side external-provider limit responses are owned by the Express limiter mounted on `/api/media/search-tmdb` and `/api/media/lookup-upc`,
  - the setting is `RATE_LIMIT_EXTERNAL_API_MAX`,
  - upstream TMDB failures still come through TMDB service wrapping with upstream status/path details.
- CI/checks run locally:
  - `docker compose --env-file .env config`
  - `node scripts/validate-public-export-surface.js`
  - `APP_VERSION=3.4.28 docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml up -d --build backend frontend`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:unit`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:openapi`
  - `PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted> PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:browser -- tests/playwright/specs/library-multiformat.browser.spec.js -g "add drawer combines title and identifier"`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T -e BASE_URL=http://frontend:3000 -e EXPECTED_VERSION=3.4.28 backend npm run test:help-releases-smoke`
  - `git diff --check`
  - fixed-token grep across the new release note, roadmap, release feed, and Playwright artifacts
- Release artifacts:
  - `docs/releases/v3.4.28.md`
  - regenerated `backend/release-feed.json`
- Files changed:
  - media drawer identifier-selection enrichment guard,
  - focused Playwright lookup regression,
  - focused unit source assertions,
  - version metadata, generated compose defaults, release note, release feed, roadmap, and backlog plan.
- Risks or follow-ups:
  - Tagged CI remains authoritative for `secret-scan`, `dependency-scan`, `image-security-and-sbom`, `rbac-regression`, full `browser-regression`, `homelab-edition-boundary`, and `platform-edition-boundary`.
  - If users still hit app-side external-provider limits during ordinary movie adds, tune `RATE_LIMIT_EXTERNAL_API_MAX` or add a server-side short-lived search cache in a later backend-focused milestone.
  - This slice intentionally does not change upstream TMDB retry/backoff behavior.
- What remains in the milestone: nothing; `3.4.28` is closed.
- Recommended commit message: `Release 3.4.28 TMDB rate-limit investigation and lookup request reduction`

## 3.4.29 — Collectibles Naming Review

**Goal:** Decide whether the Collectibles library should keep its current name after Art promotion and fandom/franchise metadata, without changing product copy in this slice.

**Current Slice:** `Closed 2026-04-27`

### Scope

- Compare `Collectibles` against alternatives such as `Fandom` without renaming the product surface.
- Evaluate whether `Fandom / Franchise` metadata solves the naming pressure better than a library rename.
- Document downstream effects of any future rename on navigation, API copy, docs, imports, and Event purchase linking.
- Keep the current Collectibles object-category boundary stable.

### Acceptance Criteria

- The team has an explicit decision record for keeping or renaming Collectibles.
- Any future rename has a migration/product-copy checklist before implementation.
- The current Collectibles object-category boundary stays stable unless a later milestone intentionally changes it.
- Version metadata and Help > Releases are aligned to `3.4.29`.

### Closeout Notes

- Roadmap slice: `3.4.29 — Collectibles Naming Review`.
- Decision: keep `Collectibles` as the library name for now; keep `Fandom / Franchise` as shared metadata for Art and Collectibles rather than renaming the library to `Fandom`.
- Project docs/checklists used:
  - `AGENTS.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
  - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
- Runtime verification used Docker-first evidence from the generated public compose plus temporary `.ci` source override:
  - default frontend/backend images rebuilt with `APP_VERSION=3.4.29`,
  - `/api/health` reported `3.4.29` for app/frontend/backend metadata,
  - Help > Releases served `3.4.29` as the latest entry.
- CI/checks run locally:
  - `docker compose --env-file .env config`
  - `node scripts/validate-public-export-surface.js`
  - `APP_VERSION=3.4.29 docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml up -d --build backend frontend`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:unit`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:openapi`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T -e BASE_URL=http://frontend:3000 -e EXPECTED_VERSION=3.4.29 backend npm run test:help-releases-smoke`
  - `git diff --check`
  - fixed-token grep across the new release note, decision doc, roadmap, and release feed
- Release artifacts:
  - `docs/releases/v3.4.29.md`
  - `docs/wiki/39-Collectibles-Naming-Decision.md`
  - regenerated `backend/release-feed.json`
- Files changed:
  - Collectibles naming decision record,
  - unit source assertion for the decision record,
  - version metadata, generated compose defaults, release note, release feed, roadmap, and backlog plan.
- Risks or follow-ups:
  - Tagged CI remains authoritative for `secret-scan`, `dependency-scan`, `image-security-and-sbom`, `rbac-regression`, full `browser-regression`, `homelab-edition-boundary`, and `platform-edition-boundary`.
  - A future rename remains possible only if real usage shows `Collectibles` is consistently misunderstood after the Art and fandom/franchise changes settle.
  - This slice intentionally does not add route aliases, API renames, controlled fandom vocabularies, or product-copy changes.
- What remains in the milestone: nothing; `3.4.29` is closed.
- Recommended commit message: `Release 3.4.29 Collectibles naming decision and future rename checklist`

## 3.4.30 — Event Social Planning Foundation

**Goal:** Add the event-scoped social planning data model and API contract that lets collectZ track attendees, groups, meetups, and manual/shared schedule plans before the mobile day-of-con experience is built.

**Current Slice:** `Closed 2026-04-28`

### Scope

- Add event attendee records for people associated with a collectZ Event.
- Add event groups and group membership for travel parties, artist-alley groups, meetup crews, or similar planning clusters.
- Add lightweight meetups with title, time, location, notes, group association, status, and visibility.
- Add manual/source-backed schedule-plan records for planned, maybe, backup, skipped, or attended sessions.
- Keep every social planning surface scoped through the existing Event/library/space access model and Events feature gate.
- Document the privacy and product boundary before adding mobile, notifications, or native companion behavior.

### Acceptance Criteria

- Event social planning tables exist in migrations and init parity.
- Event child APIs exist for attendees, groups, meetups, and schedule plans.
- OpenAPI documents the new Event social planning records and routes.
- The dedicated foundation decision doc explains the privacy boundary and follow-up order.
- The mobile web experience remains a later milestone that reads this foundation rather than inventing a separate data shape.

### Notes

- This milestone does not add real-time location sharing, broad public discovery, push notification fanout, Sched ingestion, or the mobile-first UI itself.
- Fine-grained selected-recipient enforcement is intentionally deferred; this slice stores explicit visibility intent and keeps access bounded by existing Event scope controls.

### Closeout Notes

- Roadmap slice: `3.4.30 — Event Social Planning Foundation`.
- Project docs/checklists used:
  - `AGENTS.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
  - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
  - `docs/wiki/40-Event-Social-Planning-Foundation.md`
- Runtime verification used Docker-first evidence from the generated public compose plus temporary `.ci` source override:
  - backend/frontend images rebuilt with `APP_VERSION=3.4.30`,
  - migration `84` applied successfully in the running backend container,
  - `/api/health` reported `3.4.30` for app/frontend/backend metadata after the final rebuild,
  - Help > Releases served `3.4.30` as the latest entry.
- CI/checks run locally:
  - `docker compose --env-file .env config`
  - `node scripts/validate-public-export-surface.js`
  - `APP_VERSION=3.4.30 docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml up -d --build backend frontend`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:unit`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend npm run test:openapi`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T -e BASE_URL=http://localhost:3001 backend npm run test:event-social-planning-smoke`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend node scripts/check-init-parity.js`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T backend node scripts/migration-rehearsal.js`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T -e BASE_URL=http://frontend:3000 -e EXPECTED_VERSION=3.4.30 backend npm run test:help-releases-smoke`
  - `docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:homelab-edition-boundary`
  - browser regression was attempted with the standard local Playwright bypass token redacted; the homelab-compatible tests passed, while platform/admin/support specs failed because the running stack was the default homelab runtime and returned expected platform-surface `403`/`404` responses.
  - `git diff --check`
  - fixed-token grep across the new release note, foundation doc, roadmap, release feed, and smoke source
- Release artifacts:
  - `docs/releases/v3.4.30.md`
  - `docs/wiki/40-Event-Social-Planning-Foundation.md`
  - regenerated `backend/release-feed.json`
- Files changed:
  - Event social planning migration/init parity,
  - Event social planning validation and routes,
  - OpenAPI social planning schemas/routes,
  - Event detail drawer social planning section,
  - focused Event social planning smoke,
  - unit source assertions,
  - version metadata, generated compose defaults, release note, release feed, roadmap, and backlog plan.
- Risks or follow-ups:
  - Tagged CI remains authoritative for `secret-scan`, `dependency-scan`, `image-security-and-sbom`, `rbac-regression`, full `browser-regression`, `homelab-edition-boundary`, and `platform-edition-boundary`.
  - Local platform edition boundary could not be completed against the homelab-default runtime; the explicit platform smoke returned `404` for platform-only admin routes because the running backend was not started as platform.
  - Fine-grained selected-recipient enforcement is not implemented yet; this slice stores visibility intent and relies on existing Event scope access.
  - Mobile-first Event Social Planning Mobile Web Experience, Event Schedule Catalog and Now/Next Discovery, Personal Sched ICS sync, and friend-aware notifications remain follow-up milestones.
- What remains in the milestone: nothing; `3.4.30` is closed.
- Recommended commit message: `Release 3.4.30 event social planning foundation and drawer workflow`

## 3.4.31 — Personal Sched ICS Sync Contract and Parser Spike

**Goal:** Allow a user to connect a personal Sched ICS/iCal subscription link for a collectZ Event so selected sessions sync into private event schedule plans without treating the feed as the full event catalog.

**Current Slice:** `Closed 2026-04-28`

### Scope

- Add encrypted per-user/per-event personal ICS source storage.
- Add read/save/remove/manual-sync endpoints that never return the raw ICS URL.
- Parse Sched-style VEVENT rows into private `event_schedule_plans` using stable `sched_ics` source references.
- Track sync status, last success, item counts, and sanitized error state.
- Add a small Event drawer control for connecting, replacing, syncing, and removing the personal feed.
- Document that this is personal selected-session sync, not the full schedule catalog or Now/Next discovery model.

### Acceptance Criteria

- A user can connect and remove a personal ICS source for an Event.
- Manual refresh syncs selected sessions into `event_schedule_plans` with `source_type = sched_ics`.
- API responses and UI readback do not expose the raw ICS URL.
- Sync status is visible enough to troubleshoot stale or failed feeds.
- The full schedule catalog, friend-aware notifications, and native companion surfaces remain later milestones.

### Notes

- The ICS URL is treated as a secret-bearing schedule credential.
- This milestone does not add a polling scheduler; manual refresh proves the contract and parser first.
- This milestone does not implement the full convention scheduler provider framework from `docs/wiki/38-Convention-Scheduler-and-Provider-Spec.md`.

### Closeout Notes

- Roadmap slice: `3.4.31 — Personal Sched ICS Sync Contract and Parser Spike`.
- Project docs/checklists used:
  - `AGENTS.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
  - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
  - `docs/wiki/38-Convention-Scheduler-and-Provider-Spec.md`
  - `docs/wiki/40-Event-Social-Planning-Foundation.md`
  - `docs/wiki/41-Personal-Sched-ICS-Sync.md`
- Runtime verification used Docker-first evidence from the generated public compose plus temporary `.ci` source override:
  - backend/frontend images rebuilt with `APP_VERSION=3.4.31`,
  - migration `85` applied in the running backend container,
  - `/api/health` reported `3.4.31` for app/frontend/backend metadata,
  - Help > Releases served `3.4.31` as the latest entry.
- CI/checks run locally:
  - `docker compose --env-file .env config`
  - `node scripts/validate-public-export-surface.js`
  - `APP_VERSION=3.4.31 docker compose --env-file .env -f docker-compose.yml -f .ci/docker-compose.build.yml up -d --build backend frontend`
  - `docker compose --env-file .env exec -T backend npm run test:unit`
  - `docker compose --env-file .env exec -T backend npm run test:openapi`
  - `docker compose --env-file .env exec -T -e BASE_URL=http://localhost:3001 backend npm run test:event-personal-ics-sync-smoke`
  - `docker compose --env-file .env exec -T -e BASE_URL=http://localhost:3001 backend npm run test:event-social-planning-smoke`
  - `docker compose --env-file .env exec -T backend node scripts/check-init-parity.js`
  - `docker compose --env-file .env exec -T backend node scripts/migration-rehearsal.js`
  - `docker compose --env-file .env exec -T -e BASE_URL=http://frontend:3000 -e EXPECTED_VERSION=3.4.31 backend npm run test:help-releases-smoke`
  - `docker compose --env-file .env exec -T -e BASE_URL=http://frontend:3000 backend npm run test:homelab-edition-boundary`
  - `git diff --check`
  - targeted secret/URL grep across the new release note, decision doc, release feed, and generated init/migration evidence
- Release artifacts:
  - `docs/releases/v3.4.31.md`
  - `docs/wiki/41-Personal-Sched-ICS-Sync.md`
  - regenerated `backend/release-feed.json`
- Files changed:
  - encrypted personal ICS source migration/init parity,
  - Sched-style ICS parser/sync service,
  - Event personal ICS source routes and OpenAPI contract,
  - Event drawer personal ICS controls,
  - focused personal ICS sync smoke,
  - unit source assertions,
  - version metadata, generated compose defaults, release note, release feed, roadmap, and backlog plan.
- Risks or follow-ups:
  - This milestone intentionally supports manual refresh only; polling cadence remains a later operational decision.
  - Full Event Schedule Catalog and Now/Next Discovery remains separate from personal selected-session ICS sync.
  - Friend-aware schedule sharing and notifications remain later milestones after selected-recipient enforcement is designed.
  - Tagged CI remains authoritative for `secret-scan`, `dependency-scan`, `image-security-and-sbom`, `browser-regression`, `rbac-regression`, and `platform-edition-boundary`.
  - Local `rbac-regression` could not complete against the homelab-default runtime because platform-only admin space routes returned `403`.
  - Full browser regression was not rerun in this local closeout; previous homelab-default runs fail platform/admin/support specs unless the runtime is explicitly platform.
- What remains in the milestone: nothing; `3.4.31` is closed.
- Recommended commit message: `Release 3.4.31 personal Sched ICS sync contract and parser spike`

## 3.4.32 — Personal Sched ICS Schedule Detail Enrichment

**Goal:** Preserve and display richer per-session detail from personal Sched ICS feeds without expanding into the full event schedule catalog or Now/Next discovery milestone.

**Current Slice:** `Closed 2026-04-28`

### Scope

- Add compatibility-safe schedule-plan fields for source session URL, categories, source update timestamp, and source sequence.
- Parse Sched `CATEGORIES`, `URL`, `DTSTAMP`, and `SEQUENCE` fields into private `event_schedule_plans`.
- Keep the personal feed URL encrypted and redacted; only individual session URLs are exposed as schedule-plan source links.
- Update Event drawer schedule-plan cards to show time ranges, location, categories, description preview, and session links.
- Extend focused parser/unit and personal ICS smoke coverage.

### Acceptance Criteria

- Existing manual and ICS-backed schedule plans remain readable.
- New ICS syncs populate source URL/categories when provided by the feed.
- The schedule-plan API documents the richer fields.
- The Event drawer displays richer synced session detail without exposing the personal ICS feed URL.
- Full Event Schedule Catalog and Now/Next Discovery remains a separate milestone.

### Notes

- This is still personal selected-session sync, not an authoritative public event catalog.
- Sched edge behavior may temporarily throttle or block repeated direct fetches; local fixture smoke remains the deterministic regression gate.

### Closeout Notes

- Roadmap slice: `3.4.32 — Personal Sched ICS Schedule Detail Enrichment`.
- Project docs/checklists used:
  - `AGENTS.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `docs/wiki/41-Personal-Sched-ICS-Sync.md`
  - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
  - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
- Runtime verification used Docker-first local platform stack evidence:
  - backend/frontend images rebuilt with `APP_VERSION=3.4.32`,
  - `/api/health` reported `3.4.32` for app/frontend/backend,
  - migration `86` applied in the running backend container,
  - Help > Releases served `3.4.32` as the latest entry.
- CI/checks run locally:
  - `node --check backend/services/schedIcsSync.js`
  - `node --check backend/routes/events.js`
  - `node --check backend/middleware/validate.js`
  - `node --check backend/scripts/unit-tests.js`
  - `node --check backend/scripts/event-personal-ics-sync-smoke.js`
  - `APP_VERSION=3.4.32 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build backend frontend`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:unit`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:openapi`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:init-parity`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:migration-rehearsal`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:event-personal-ics-sync-smoke`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 -e EXPECTED_VERSION=3.4.32 backend npm run test:help-releases-smoke`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:platform-edition-boundary`
  - `node scripts/validate-public-export-surface.js`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml config`
  - `git diff --check`
- Release artifacts:
  - `docs/releases/v3.4.32.md`
  - regenerated `backend/release-feed.json`
- Files changed:
  - schedule-plan schema migration/init parity and OpenAPI contract,
  - personal Sched ICS parser/sync enrichment,
  - Event drawer schedule-plan detail rendering,
  - focused unit and personal ICS smoke coverage,
  - version metadata, generated public compose defaults, release feed, release note, and roadmap closeout.
- Risks or follow-ups:
  - Repeated direct requests to the real Sched feed began returning Cloudflare `403` during validation, so the deterministic local fixture smoke is the passing regression gate; the saved real sources currently show the latest failed upstream attempt even though previously synced plans remain in the DB.
  - Full Event Schedule Catalog and Now/Next Discovery remains separate from personal selected-session ICS sync.
  - Tagged CI remains authoritative for `dependency-scan`, `secret-scan`, `image-security-and-sbom`, `browser-regression`, `rbac-regression`, and `homelab-edition-boundary`.
- What remains in the milestone: nothing; `3.4.32` is closed.
- Recommended commit message: `Release 3.4.32 personal Sched ICS schedule detail enrichment`

## 3.4.33 — Event Schedule Agenda Drawer Polish

**Goal:** Make event schedule plans readable as a compact agenda in the Event detail drawer without expanding into continued Sched syncing, full schedule catalogs, or Now/Next discovery.

**Current Slice:** `Closed 2026-04-29`

### Scope

- Promote schedule plans above feed/social management inside the Event detail drawer.
- Replace heavy schedule-plan cards with a day-grouped agenda list.
- Keep agenda rows compact with stacked time ranges and room-first location previews.
- Keep descriptions, session links, and remove actions available from expanded rows instead of showing every control in the default scan view.
- Collapse Sched feed management behind a dedicated management section.
- Keep People, Groups, and Meetups available as secondary social-planning sections.

### Acceptance Criteria

- Existing manual and ICS-backed schedule plans remain readable.
- The default drawer view emphasizes the schedule before feed controls.
- Mobile and narrow drawer views can scan many sessions without excessive card stacking.
- No automatic or continued Sched syncing behavior is introduced.
- Full Event Schedule Catalog and Now/Next Discovery remains a separate milestone.

### Notes

- This patch is the schedule-readability slice from the broader Event Social Planning Mobile Web Experience backlog item.
- This patch does not change event schedule APIs, provider ingestion, Sched URL storage, or sync cadence.

### Closeout Notes

- Roadmap slice: `3.4.33 — Event Schedule Agenda Drawer Polish`.
- Project docs/checklists used:
  - `AGENTS.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
  - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
- Runtime verification used Docker-first local platform stack evidence:
  - backend image rebuilt with `APP_VERSION=3.4.33`,
  - frontend image rebuilt with `APP_VERSION=3.4.33`,
  - `/api/health` reported `3.4.33` for app/frontend/backend,
  - Help > Releases served `3.4.33` as the latest entry,
  - targeted Playwright UI smoke opened a temporary Event detail drawer, verified Schedule appears before Manage Sched feed, verified compact agenda rows and expanded session details, and cleaned up the fixture.
- CI/checks run locally:
  - `APP_VERSION=3.4.33 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build frontend`
  - `APP_VERSION=3.4.33 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build backend`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:unit`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:openapi`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:init-parity`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:migration-rehearsal`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:event-social-planning-smoke`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 -e EXPECTED_VERSION=3.4.33 backend npm run test:help-releases-smoke`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:platform-edition-boundary`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:rbac-regression`
  - targeted local Playwright schedule-agenda UI smoke with a temporary fixture Event
  - `node scripts/validate-public-export-surface.js`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml config`
  - `git diff --check`
- Release artifacts:
  - `docs/releases/v3.4.33.md`
  - regenerated `backend/release-feed.json`
- Files changed:
  - Event detail drawer schedule agenda UI,
  - mobile agenda density and room-first Sched location readback,
  - event social planning unit source contract,
  - version metadata, generated public compose defaults, package lock root versions, release feed, release note, roadmap, and backlog promotion note.
- Risks or follow-ups:
  - This patch intentionally does not add continued Sched syncing, full schedule catalog ingestion, Now/Next discovery, or friend notifications.
  - Tagged CI remains authoritative for `compose-smoke`, `rbac-regression`, `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, `dependency-scan`, `secret-scan`, and `image-security-and-sbom`.
- What remains in the milestone: nothing; `3.4.33` is closed.
- Recommended commit message: `Release 3.4.33 event schedule agenda drawer polish`

## 3.4.34 — Event Schedule Day Navigation and Now/Next Readability

**Goal:** Add lightweight day and now/next navigation to the Event detail drawer agenda so long personal schedules are easier to scan without expanding into full event catalog discovery or continued sync behavior.

**Current Slice:** `Closed 2026-04-29`

### Scope

- Add compact day navigation and an Upcoming filter for schedule plans in the Event detail drawer.
- Add a local-time now/next affordance when a current or upcoming selected session exists.
- Keep the agenda usable for past events where now/next is not available.
- Preserve the compact agenda row treatment from `3.4.33`.
- Avoid changes to Sched syncing, full schedule catalog import, friend notifications, or provider ingestion.

### Acceptance Criteria

- Users can filter/jump between days in a multi-day event schedule.
- Users can filter to upcoming selected sessions without scrolling past completed/past plans.
- Users can quickly move to the current or next selected session when one exists.
- The default view remains simple and readable on mobile.
- Existing manual and ICS-backed schedule plans remain readable.
- Full Event Schedule Catalog and Now/Next Discovery remains a separate milestone.

### Notes

- This is still selected personal schedule readability, not broad session discovery.

### Closeout Notes

- Roadmap slice: `3.4.34 — Event Schedule Day Navigation and Now/Next Readability`.
- Project docs/checklists used:
  - `AGENTS.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
  - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
- Runtime verification used Docker-first local platform stack evidence:
  - frontend/backend images rebuilt with `APP_VERSION=3.4.34`,
  - `/api/health` reported `3.4.34` for app/frontend/backend,
  - Help > Releases served `3.4.34` as the latest entry,
  - targeted Playwright UI smoke opened a temporary Event detail drawer, verified `Upcoming`, `Next`, and `All` agenda filters, verified compact room-first readback, and cleaned up the fixture.
- CI/checks run locally:
  - `APP_VERSION=3.4.34 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build frontend`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:unit`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:openapi`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:init-parity`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:migration-rehearsal`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 -e EXPECTED_VERSION=3.4.34 backend npm run test:help-releases-smoke`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:platform-edition-boundary`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:rbac-regression`
  - targeted local Playwright schedule-navigation UI smoke with a temporary fixture Event
  - `node scripts/validate-public-export-surface.js`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml config`
  - `git diff --check`
- Release artifacts:
  - `docs/releases/v3.4.34.md`
  - regenerated `backend/release-feed.json`
- Files changed:
  - Event detail drawer agenda filters for `All`, `Upcoming`, `Now`/`Next`, `Today`, and per-day navigation,
  - backlog follow-up entries for expanded row detail polish, quiet remove actions, and Sched feed failure-state polish,
  - release note, release feed, and roadmap closeout.
- Risks or follow-ups:
  - This patch intentionally does not add continued Sched syncing, full schedule catalog ingestion, broad Now/Next discovery, provider scraping, or friend notifications.
  - Tagged CI remains authoritative for `compose-smoke`, `browser-regression`, `homelab-edition-boundary`, `dependency-scan`, `secret-scan`, and `image-security-and-sbom`.
- What remains in the milestone: nothing; `3.4.34` is closed.
- Recommended commit message: `Release 3.4.34 event schedule day navigation and now-next readability`

## 3.4.35 — Event Schedule Expanded Row Detail Polish

**Goal:** Make expanded Event schedule rows more useful without making the collapsed agenda heavier.

**Current Slice:** `Closed 2026-04-29`

### Scope

- Improve the expanded schedule row detail block for selected schedule plans.
- Show full location, categories, source, session URL, notes, and relevant source metadata in a cleaner hierarchy.
- Keep the collapsed row compact and room-first.
- Preserve compatibility for manual and ICS-backed schedule plans.
- Avoid changes to Sched syncing, full schedule catalog import, friend notifications, provider ingestion, or archive/delete behavior.

### Acceptance Criteria

- Expanded rows clearly show full detail without repeating noisy metadata in the collapsed row.
- Long Sched descriptions and locations remain readable on mobile.
- Source/session links remain available without exposing the personal ICS feed URL.
- Existing manual and ICS-backed schedule plans remain readable.

### Notes

- This is still selected personal schedule readability, not broad session discovery.

### Closeout

- Roadmap slice: `3.4.35 — Event Schedule Expanded Row Detail Polish`.
- Project docs/checklists used:
  - `AGENTS.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
  - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
- Runtime verification used:
  - Docker-first local platform stack rebuilt with `APP_VERSION=3.4.35`.
  - `/api/health` reported `3.4.35` for app, frontend, backend, and build metadata.
  - Running stack restored after browser regression so the Playwright bypass env is unset.
  - Help > Releases served `3.4.35` as the latest release entry.
  - Targeted Playwright event schedule detail smoke created a temporary event/session, verified expanded full location/categories/source/notes/session link readback, and cleaned up the fixture.
- CI/checks run:
  - `APP_VERSION=3.4.35 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build frontend`
  - `curl -sS http://localhost:3000/api/health`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml ps`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:unit`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:openapi`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:init-parity`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:migration-rehearsal`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 -e EXPECTED_VERSION=3.4.35 backend npm run test:help-releases-smoke`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:platform-edition-boundary`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:rbac-regression`
  - `npm --prefix backend run test:observability-evidence`
  - `npm --prefix backend run test:release-preflight-local`
  - `PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted> npm run test:browser`
  - `node scripts/validate-public-export-surface.js`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml config --quiet`
  - `git diff --check`
- Verified facts:
  - Browser regression passed after repairing stale local Playwright fixture state: `50 passed`, `4 skipped` for homelab-only specs under the platform stack.
  - Local release preflight passed locally runnable gates: version sync, release note presence, dependency audits, migration evidence, and observability evidence.
  - Backend production dependency audit has no critical or high findings; frontend production dependency audit has no findings.
  - Observability release evidence passed `9/9` checks for `3.4.35`.
- Blocked/unverified items:
  - Local compose smoke secure-cookie assertions remain blocked by the intentional local development runtime posture (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`); CI/tagged release remains authoritative for secure-cookie compose smoke.
  - Homelab edition browser specs were skipped in the platform browser regression run, and the homelab boundary smoke is not valid against the local platform override stack; default homelab CI remains authoritative for that gate.
  - `secret-scan`, `image-security-and-sbom`, and the tagged release artifact publication gates remain CI-only.
- Files changed:
  - `frontend/src/components/EventsView.jsx`
  - `app-meta.json`
  - `backend/app-meta.json`
  - `backend/package.json`
  - `backend/package-lock.json`
  - `backend/release-feed.json`
  - `frontend/package.json`
  - `frontend/package-lock.json`
  - `frontend/src/app-meta.json`
  - `docker-compose.yml`
  - `docs/releases/v3.4.35.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `artifacts/observability-evidence/observability-release-evidence.json`
  - `preflight-go-no-go.md`
- Risks or follow-ups:
  - Quieter schedule row remove action placement remains a separate backlog task.
  - Feed-management failed-sync empty/error state remains a separate backlog task.
  - No continued Sched syncing, full session catalog discovery, friend notification, or provider ingestion behavior shipped in this patch.
- What remains in the milestone: nothing; `3.4.35` is closed.
- Recommended commit message: `Release 3.4.35 event schedule expanded row detail polish`

## 3.4.36 — Event Schedule Quiet Remove Actions

**Goal:** Make schedule-plan removal less prominent and less likely to be tapped accidentally while keeping intentional removal available from expanded schedule rows.

**Current Slice:** `Closed 2026-04-29`

### Scope

- Move destructive schedule-plan actions into a quieter expanded-row action area.
- Use low-emphasis button styling and clearer `Remove from schedule` language.
- Keep removal available for manual and ICS-backed selected schedule plans.
- Avoid changing archive/delete API behavior in this slice.
- Avoid changes to Sched syncing, full schedule catalog import, friend notifications, provider ingestion, or feed failure-state behavior.

### Acceptance Criteria

- `Remove` is not visually prominent in the default agenda scan view.
- Users can still remove a schedule plan intentionally from the expanded row.
- Mobile tap targets remain clear and accessible.
- Existing manual and ICS-backed schedule plans remain readable.

### Notes

- This is still selected personal schedule readability, not broad session discovery.

### Closeout

- Roadmap slice: `3.4.36 — Event Schedule Quiet Remove Actions`.
- Project docs/checklists used:
  - `AGENTS.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
  - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
- Runtime verification used:
  - Docker-first local platform stack rebuilt with `APP_VERSION=3.4.36`.
  - `/api/health` reported `3.4.36` for app, frontend, backend, and build metadata.
  - Running stack restored after browser regression and observability evidence so the Playwright bypass env is unset.
  - Help > Releases served `3.4.36` as the latest release entry.
- CI/checks run:
  - `APP_VERSION=3.4.36 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build frontend`
  - `curl -sS http://localhost:3000/api/health`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml ps`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:unit`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:openapi`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:init-parity`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:migration-rehearsal`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 -e EXPECTED_VERSION=3.4.36 backend npm run test:help-releases-smoke`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:platform-edition-boundary`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:rbac-regression`
  - `PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted> npm run test:browser`
  - `node --check backend/scripts/observability-release-evidence.js`
  - `npm --prefix backend run test:observability-evidence`
  - `npm --prefix backend run test:release-preflight-local`
  - `node scripts/validate-public-export-surface.js`
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml config --quiet`
  - `git diff --check`
- Verified facts:
  - Browser regression passed: `50 passed`, `4 skipped` for homelab-only specs under the platform stack.
  - Local release preflight passed locally runnable gates: version sync, release note presence, dependency audits, migration evidence, and observability evidence.
  - Backend production dependency audit has no critical or high findings; frontend production dependency audit has no findings.
  - Observability release evidence passed `9/9` checks for `3.4.36`.
  - Graylog evidence now resets only the example logging stack volumes before collector smoke and uses a smaller default message journal so local Docker free-space limits do not keep the collector from starting.
- Blocked/unverified items:
  - Local compose smoke secure-cookie assertions remain blocked by the intentional local development runtime posture (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`); CI/tagged release remains authoritative for secure-cookie compose smoke.
  - Homelab edition browser specs were skipped in the platform browser regression run, and the homelab boundary smoke is not valid against the local platform override stack; default homelab CI remains authoritative for that gate.
  - `secret-scan`, `image-security-and-sbom`, and the tagged release artifact publication gates remain CI-only.
- Files changed:
  - `frontend/src/components/EventsView.jsx`
  - `backend/scripts/observability-release-evidence.js`
  - `ops/logging/docker-compose.graylog.yml`
  - `app-meta.json`
  - `backend/app-meta.json`
  - `backend/package.json`
  - `backend/package-lock.json`
  - `backend/release-feed.json`
  - `frontend/package.json`
  - `frontend/package-lock.json`
  - `frontend/src/app-meta.json`
  - `docker-compose.yml`
  - `docs/releases/v3.4.36.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `artifacts/observability-evidence/observability-release-evidence.json`
  - `preflight-go-no-go.md`
- Risks or follow-ups:
  - Sched feed failure-state polish remains a separate backlog task.
  - No continued Sched syncing, full session catalog discovery, friend notification, or provider ingestion behavior shipped in this patch.
- What remains in the milestone: nothing; `3.4.36` is closed.
- Recommended commit message: `Release 3.4.36 event schedule quiet remove actions`

## 3.4.37 — Event Sched Feed Failure State Polish

**Goal:** Keep selected Event schedules usable and trustworthy when a connected personal Sched feed has failed, stale, or never-synced status.

**Current Slice:** `Closed 2026-04-29`

### Scope

- Improve collapsed and expanded `Manage Sched feed` readback for failed, stale, running, and never-synced sources.
- Keep previously synced schedule plans visually normal even when the latest feed refresh failed.
- Make sync errors visible but quiet enough not to dominate the schedule.
- Keep the personal ICS URL encrypted/redacted and never shown back to the user.
- Avoid automatic retry, continued sync, provider scraping, full catalog import, friend notifications, or native companion behavior.

### Acceptance Criteria

- A failed feed state is clear from `Manage Sched feed`.
- Existing schedule plans remain the primary surface and are not visually treated as failed.
- Users can distinguish last successful sync from last refresh attempt.
- The personal ICS URL remains encrypted/redacted and is never shown back to the user.

### Notes

- This is still selected personal schedule readability and trust, not broad session discovery.

### Closeout Evidence

- Roadmap slice: `3.4.37 — Event Sched Feed Failure State Polish`.
- Project docs/checklists used:
  - `AGENTS.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
  - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
- Runtime verification used:
  - Docker-first runtime rebuilt with `APP_VERSION=3.4.37`.
  - Running stack `/api/health` reports `version=3.4.37`, `frontend=3.4.37`, `backend=3.4.37`, and `build=v3.4.37`.
  - Running frontend/backend containers are healthy after restoration from the temporary browser-regression bypass run.
  - Backend runtime check confirms `PLAYWRIGHT_E2E_BYPASS_TOKEN=unset` after browser regression.
  - Running platform stack reports `APP_EDITION=platform`; the local platform override remains intact.
  - Help > Releases smoke serves `3.4.37` as the latest release and includes recent release entries.
- CI/checks run:
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml config --quiet` passed.
  - `node scripts/validate-public-export-surface.js` passed.
  - `git diff --check` passed.
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:unit` passed: 230 tests.
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:openapi` passed.
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:init-parity` passed and refreshed init parity evidence.
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:migration-rehearsal` passed and refreshed migration rehearsal evidence.
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 -e EXPECTED_VERSION=3.4.37 backend npm run test:help-releases-smoke` passed.
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:platform-edition-boundary` passed.
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:rbac-regression` passed.
  - Browser regression passed against the Docker stack: 50 passed, 4 skipped for homelab browser specs under the local platform stack.
  - `npm --prefix backend run test:observability-evidence` passed and refreshed observability evidence with 9/9 checks passing.
  - `npm --prefix backend run test:release-preflight-local` passed for locally runnable gates and refreshed `preflight-go-no-go.md`.
  - Secret hygiene check found no local Playwright bypass token strings in the retained release/docs/evidence paths inspected after transient Playwright artifacts were removed.
- Verified facts:
  - `Manage Sched feed` now has collapsed status language for connected, synced, stale, syncing, failed, and not-synced states.
  - Expanded Sched feed details distinguish last successful sync from last refresh attempt.
  - Failed feed status explains that saved schedule items remain usable when a prior successful sync exists.
  - The personal ICS URL is not read back in the drawer and remains outside the UI surface changed by this patch.
  - Version metadata, release note, generated release feed, and generated public compose output are aligned on `3.4.37`.
- Blocked or CI-only gates:
  - Local compose smoke secure-cookie assertions remain blocked by the intentional local development runtime posture (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`); CI/tagged release remains authoritative for secure-cookie compose smoke.
  - Homelab edition browser specs were skipped because the local stack is intentionally running with the private platform override; default homelab CI remains authoritative for `homelab-edition-boundary`.
  - `secret-scan`, `image-security-and-sbom`, and tagged release artifact publication remain CI-only.
- Files changed:
  - `frontend/src/components/EventsView.jsx`
  - `tests/playwright/specs/library-multiformat.browser.spec.js`
  - `app-meta.json`
  - `backend/app-meta.json`
  - `backend/package.json`
  - `backend/package-lock.json`
  - `backend/release-feed.json`
  - `frontend/package.json`
  - `frontend/package-lock.json`
  - `frontend/src/app-meta.json`
  - `docker-compose.yml`
  - `docs/releases/v3.4.37.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `artifacts/observability-evidence/observability-release-evidence.json`
  - `preflight-go-no-go.md`
- Risks or follow-ups:
  - This does not add continued Sched polling, automatic retry, broad catalog discovery, friend notifications, or native companion sync visibility.
  - Full schedule catalog / now-next discovery and native companion sync status should stay as separate future milestones.
  - The browser regression harness needed a small stabilization so the media add-drawer test waits for the hydrated movie grid before clicking toolbar `Add`.
- What remains in the milestone: nothing; `3.4.37` is closed.
- Recommended commit message: `Release 3.4.37 event Sched feed failure state polish`

## 3.4.38 — Event Social Mobile Overview

**Goal:** Add a compact mobile-first social overview to Event detail drawers so day-of-con context is readable before users dive into admin-heavy People, Groups, Meetups, Schedule, or Sched feed controls.

**Current Slice:** `Closed 2026-04-30`

### Scope

- Add a read-first mobile overview inside `Event plans`.
- Surface the current/next schedule plan, next meetup, attendee names, and group names when available.
- Keep privacy/status labels visible enough to distinguish private/group/shared planning records.
- Preserve the existing desktop planning accordions and management controls.
- Avoid API/schema changes, full schedule catalog discovery, friend notifications, native companion behavior, location/presence tracking, and fast meetup editing.

### Acceptance Criteria

- On a phone-sized Event detail drawer, users can quickly see the next schedule item, next meetup, people, and groups without opening every accordion.
- Empty states are short and useful when social data has not been added.
- Private/group/shared labels are visible in the mobile overview.
- Existing schedule, people, groups, meetup, and Sched feed management flows continue to work.

### Notes

- This is the overview slice of the broader `Event Social Planning Mobile Web Experience` backlog item.
- Fast meetup status updates, richer shared schedule editing, and native companion surfaces remain later milestones.

### Closeout Evidence

- Roadmap slice: `3.4.38 — Event Social Mobile Overview`.
- Project docs/checklists used:
  - `AGENTS.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
  - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
- Runtime verification used:
  - Docker-first runtime rebuilt with `APP_VERSION=3.4.38`.
  - Container Vite build completed successfully for the frontend image.
  - Running stack `/api/health` reports `version=3.4.38`, `frontend=3.4.38`, `backend=3.4.38`, and `build=v3.4.38`.
  - Running frontend/backend containers are healthy after restoration from the temporary browser-regression bypass run.
  - Backend runtime check confirms `PLAYWRIGHT_E2E_BYPASS_TOKEN=unset` after browser regression.
  - Running platform stack reports `APP_EDITION=platform`; the local platform override remains intact.
  - Help > Releases smoke serves `3.4.38` as the latest release and includes recent release entries.
- CI/checks run:
  - `APP_VERSION=3.4.38 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build frontend` passed.
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml config --quiet` passed.
  - `node scripts/validate-public-export-surface.js` passed.
  - `git diff --check` passed.
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:unit` passed: 230 tests.
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:openapi` passed.
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:init-parity` passed and refreshed init parity evidence.
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:migration-rehearsal` passed and refreshed migration rehearsal evidence.
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 -e EXPECTED_VERSION=3.4.38 backend npm run test:help-releases-smoke` passed.
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:platform-edition-boundary` passed.
  - `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 backend npm run test:rbac-regression` passed.
  - Targeted mobile Event browser regression passed.
  - Browser regression passed against the Docker stack: 51 passed, 4 skipped for homelab browser specs under the local platform stack.
  - `npm --prefix backend run test:observability-evidence` passed and refreshed observability evidence with 9/9 checks passing.
  - `npm --prefix backend run test:release-preflight-local` passed for locally runnable gates and refreshed `preflight-go-no-go.md`.
  - Secret hygiene check found no local Playwright bypass token strings in the retained release/docs/evidence paths inspected after transient Playwright artifacts were removed.
- Verified facts:
  - Event detail drawers now render a phone-sized `Mobile event social overview` above the detailed Event plans accordions.
  - The overview shows counts for people, groups, and meetups.
  - The overview surfaces current/next schedule, next meetup, attendee names, group names, and private/group visibility labels when data exists.
  - Existing Schedule, Manage Sched feed, People, Groups, and Meetups management sections remain available below the overview.
  - Version metadata, release note, generated release feed, and generated public compose output are aligned on `3.4.38`.
- Blocked or CI-only gates:
  - Local compose smoke secure-cookie assertions remain blocked by the intentional local development runtime posture (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`); CI/tagged release remains authoritative for secure-cookie compose smoke.
  - Homelab edition browser specs were skipped because the local stack is intentionally running with the private platform override; default homelab CI remains authoritative for `homelab-edition-boundary`.
  - `secret-scan`, `image-security-and-sbom`, and tagged release artifact publication remain CI-only.
- Files changed:
  - `frontend/src/components/EventsView.jsx`
  - `tests/playwright/specs/events-collectibles.browser.spec.js`
  - `backend/scripts/unit-tests.js`
  - `app-meta.json`
  - `backend/app-meta.json`
  - `backend/package.json`
  - `backend/package-lock.json`
  - `backend/release-feed.json`
  - `frontend/package.json`
  - `frontend/package-lock.json`
  - `frontend/src/app-meta.json`
  - `docker-compose.yml`
  - `docs/releases/v3.4.38.md`
  - `docs/wiki/07-Release-Roadmap.md`
  - `docs/wiki/08-Backlog.md`
  - `artifacts/observability-evidence/observability-release-evidence.json`
  - `preflight-go-no-go.md`
- Risks or follow-ups:
  - This does not add fast meetup status updates, notes editing, full schedule catalog discovery, friend notifications, native companion behavior, or location/presence tracking.
  - The broader Event Social Planning Mobile Web Experience backlog remains open for fast actions and richer shared/private editing.
- What remains in the milestone: nothing; `3.4.38` is closed.
- Recommended commit message: `Release 3.4.38 event social mobile overview`

## 3.4.39 — Event Meetup Fast Status and Notes

**Goal:** Let users update meetup status and quick notes from the Event drawer without opening a separate admin-heavy edit surface.

**Current Slice:** Closed 2026-04-30.

### Scope

- Add compact in-place controls for Event meetup `status` and `notes`.
- Use the existing meetup `PATCH` endpoint and current meetup status contract.
- Keep controls inside the existing Meetups section so desktop management remains familiar.
- Preserve removal and add-meetup behavior.
- Avoid schema changes, notifications, friend-aware session changes, full schedule catalog work, native companion behavior, location/presence tracking, or shared schedule editing.

### Acceptance Criteria

- A user can expand a meetup row and update status from allowed backend values.
- A user can add or replace a quick note for a meetup.
- Saved meetup status and notes round-trip through the backend.
- Existing Event social overview and management sections continue to work.

### Notes

- This is still web/mobile drawer editing, not native companion behavior.
- Shared schedule item editing remains a separate later slice.

### Closeout Evidence

- Roadmap slice: `3.4.39 — Event Meetup Fast Status and Notes`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `/Users/hamlin/.codex/skills/uncodixfy/SKILL.md`.
- Runtime verification used: Docker-first local stack rebuilt to `3.4.39`; `/api/health` reported frontend/backend/build `3.4.39`; backend runtime verified `APP_EDITION=platform` and `PLAYWRIGHT_E2E_BYPASS_TOKEN=unset` after browser regression; generated public compose was booted without the localhost override and verified `APP_EDITION=unset` before the homelab boundary smoke.
- CI/checks run locally: `APP_VERSION=3.4.39 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build frontend`; targeted Playwright meetup status/notes regression; backend unit tests; OpenAPI validation; compose config validation; public export surface validation; init parity; migration rehearsal; Help > Releases smoke for `3.4.39`; platform edition boundary; homelab edition boundary against generated public compose; RBAC regression; full browser regression (`52 passed`, `4 skipped`); observability release evidence; local release preflight.
- Release/version artifacts: `app-meta.json`, backend/frontend app meta and package versions, generated `docker-compose.yml`, `docs/releases/v3.4.39.md`, and `backend/release-feed.json` are aligned on `3.4.39`.
- Verified facts: meetup rows can be expanded in the mobile Event drawer; status updates use the existing backend status contract; quick notes save through the existing meetup `PATCH` endpoint; saved status and notes round-trip through `/api/events/:id/meetups`; existing mobile social overview remains covered by browser regression.
- Blocked/unverified items: CI `secret-scan` and `image-security-and-sbom` remain CI-only; local preflight compose-smoke secure-cookie checks remain blocked by the development stack using `NODE_ENV=development` and `SESSION_COOKIE_SECURE=false`, while runtime health/version and compose config were verified locally.
- Files changed: `frontend/src/components/EventsView.jsx`, `tests/playwright/specs/events-collectibles.browser.spec.js`, version metadata/package files, `docker-compose.yml`, `docs/releases/v3.4.39.md`, `backend/release-feed.json`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/observability-evidence/observability-release-evidence.json`, `preflight-go-no-go.md`.
- Risks or follow-ups: shared schedule item editing, notifications, native companion behavior, richer location/vendor notes, and fuller mobile social planning remain separate backlog work.
- What remains in the milestone: nothing; `3.4.39` is closed.
- Recommended commit message: `Release 3.4.39 event meetup fast status and notes`

## 3.4.40 — Shared Schedule Item Editing

**Goal:** Let users adjust schedule plan status, sharing visibility, and quick notes from the Event drawer without turning personal Sched plans into a full schedule catalog workflow.

**Current Slice:** Closed 2026-04-30.

### Scope

- Add compact in-place controls for Event schedule-plan `status`, `visibility`, and `notes`.
- Use the existing schedule-plan `PATCH` endpoint and current schedule-plan status/visibility contracts.
- Keep source-owned session details such as title, time, location, categories, source URL, and source metadata read-only in this patch.
- Preserve manual schedule plan add/remove behavior.
- Preserve user-owned planning fields when a personal Sched ICS row is manually refreshed.
- Avoid schema changes, continued Sched polling, full schedule catalog discovery, friend notifications, native companion behavior, location/presence tracking, or broad shared schedule conflict handling.

### Acceptance Criteria

- A user can expand a schedule row and update status from allowed backend values.
- A user can switch a schedule plan between private and shared-with-event visibility.
- A user can add or replace a quick note for a schedule plan.
- Saved schedule-plan status, visibility, and notes round-trip through the backend.
- Manual personal Sched ICS refresh keeps user-owned status, visibility, and notes on existing synced rows.
- Existing Event social overview, schedule agenda, Sched feed management, and meetup controls continue to work.

### Notes

- This is still web/mobile drawer editing, not native companion behavior.
- Full schedule catalog and friend-aware notifications remain separate later milestones.

### Closeout Evidence

- Roadmap slice: `3.4.40 — Shared Schedule Item Editing`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `/Users/hamlin/.codex/skills/uncodixfy/SKILL.md`.
- Runtime verification used: Docker-first backend/frontend rebuild to `3.4.40`; `/api/health` reported frontend/backend/build `3.4.40`; backend runtime verified `APP_EDITION=platform` and `PLAYWRIGHT_E2E_BYPASS_TOKEN=unset` after browser regression; generated public compose was booted without the localhost override and verified `APP_EDITION=unset` before the homelab boundary smoke.
- CI/checks run locally: `APP_VERSION=3.4.40 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build backend frontend`; backend service/script syntax checks; event social planning smoke; personal Sched ICS smoke; targeted Playwright schedule-plan edit regression; backend unit tests; OpenAPI validation; compose config validation; public export surface validation; init parity; migration rehearsal; Help > Releases smoke for `3.4.40`; platform edition boundary; homelab edition boundary against generated public compose; RBAC regression; full browser regression (`53 passed`, `4 skipped`); observability release evidence; local release preflight.
- Release/version artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.40.md`, and `backend/release-feed.json` are aligned on `3.4.40`.
- Verified facts: schedule rows can be expanded in the mobile Event drawer; status updates use the existing backend schedule-plan status contract; visibility updates can switch between private and shared-with-event; quick notes save through `/api/events/:id/schedule-plans/:planId`; saved status, visibility, and notes round-trip through `/api/events/:id/schedule-plans`; manual personal Sched ICS refresh preserves user-owned status, visibility, and notes on existing synced rows.
- Blocked/unverified items: CI `secret-scan` and `image-security-and-sbom` remain CI-only; local preflight compose-smoke secure-cookie checks remain blocked by the development stack using `NODE_ENV=development` and `SESSION_COOKIE_SECURE=false`, while runtime health/version and compose config were verified locally.
- Files changed: `frontend/src/components/EventsView.jsx`, `backend/services/schedIcsSync.js`, `backend/scripts/event-social-planning-smoke.js`, `backend/scripts/event-personal-ics-sync-smoke.js`, `tests/playwright/specs/events-collectibles.browser.spec.js`, version metadata/package files, `docker-compose.yml`, `docs/releases/v3.4.40.md`, `backend/release-feed.json`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/observability-evidence/observability-release-evidence.json`, `preflight-go-no-go.md`.
- Risks or follow-ups: vendor/booth/location notes, richer private/shared visual treatment, full schedule catalog discovery, conflict handling, selected-recipient notifications, and native companion behavior remain separate backlog work.
- What remains in the milestone: nothing; `3.4.40` is closed.
- Recommended commit message: `Release 3.4.40 shared schedule item editing`

## 3.4.41 — Event Social Private/Shared Visual Treatment

**Goal:** Make private, selected, group, and shared Event social records easier to understand in mobile Event drawers without adding noisy badge-heavy UI.

**Current Slice:** `Closed 2026-04-30.`

### Scope

- Add consistent visibility readback for Event social records.
- Use concise labels for `private`, `selected_people`, `group`, and `event_workspace` visibility.
- Make shared-with-event rows stand apart subtly in schedule, people, group, and meetup sections.
- Keep the mobile social overview aligned with the same visibility language.
- Avoid schema changes, new APIs, notifications, full schedule catalog discovery, conflict handling, native companion behavior, location/presence tracking, or vendor/booth/location note fields.

### Acceptance Criteria

- Mobile overview uses human-readable visibility labels.
- Schedule plan rows show visibility in collapsed and expanded states.
- People, Groups, and Meetups show visibility labels instead of raw internal values.
- Shared-with-event records are visually distinguishable without overwhelming the drawer.
- Existing schedule, meetup, people, groups, and Sched feed management flows continue to work.

### Notes

- This is a visual/readback polish patch only.
- Vendor/booth/location notes remain the next small Event Social backlog slice.

### Closeout Evidence

- Roadmap slice: `3.4.41 — Event Social Private/Shared Visual Treatment`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`.
- Runtime verification used: Docker-first backend/frontend rebuild to `3.4.41`; `/api/health` reported frontend/backend/build `3.4.41`; backend runtime verified `APP_EDITION=platform` and `PLAYWRIGHT_E2E_BYPASS_TOKEN=unset` after browser regression; generated public compose was booted without the localhost override and verified `APP_EDITION=unset` before the homelab boundary smoke.
- CI/checks run locally: `APP_VERSION=3.4.41 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build backend frontend`; event social planning smoke; targeted Playwright mobile social overview regression; backend unit tests; OpenAPI validation; compose config validation; public export surface validation; init parity; migration rehearsal; Help > Releases smoke for `3.4.41`; platform edition boundary; homelab edition boundary against generated public compose; RBAC regression; full browser regression (`53 passed`, `4 skipped`); observability release evidence; local release preflight; compose generator idempotence; version sync check; `git diff --check`; release-evidence secret-hygiene grep.
- Release/version artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.41.md`, and `backend/release-feed.json` are aligned on `3.4.41`.
- Verified facts: Event social overview, People, Groups, Meetups, and Schedule rows now use concise visibility labels instead of raw internal values; shared-with-event rows use subtle visual emphasis; selected/group/private/shared language remains consistent between collapsed and expanded schedule states; existing meetup and schedule edit flows still pass browser and smoke coverage.
- Blocked/unverified items: CI `secret-scan` and `image-security-and-sbom` remain CI-only; local preflight compose-smoke secure-cookie checks remain blocked by the development stack using `NODE_ENV=development` and `SESSION_COOKIE_SECURE=false`, while runtime health/version and compose config were verified locally.
- Files changed: `frontend/src/components/EventsView.jsx`, `tests/playwright/specs/events-collectibles.browser.spec.js`, version metadata/package files, `docker-compose.yml`, `docs/releases/v3.4.41.md`, `backend/release-feed.json`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/observability-evidence/observability-release-evidence.json`, `preflight-go-no-go.md`.
- Risks or follow-ups: vendor/booth/location notes remain the next small Event Social backlog slice; full schedule catalog discovery, conflict handling, selected-recipient notifications, and native companion behavior remain separate larger work.
- What remains in the milestone: nothing; `3.4.41` is closed.
- Recommended commit message: `Release 3.4.41 event social private shared visual treatment`

## 3.4.42 — Event Social Vendor Booth Location Notes

**Goal:** Let day-of-con Event social plans carry booth/vendor context and location notes directly on meetups and schedule plans, so mobile drawers can answer "where exactly are we meeting?" without relying on overloaded freeform notes.

**Current Slice:** `Closed 2026-04-30.`

### Scope

- Add explicit vendor, booth, and location-note fields to Event meetups and Event schedule plans.
- Preserve existing location, notes, status, visibility, Sched source metadata, and personal ICS behavior.
- Show vendor/booth/location-note context in mobile overview, meetup rows, and schedule rows.
- Allow quick editing of vendor, booth, and location notes from expanded meetup and schedule rows.
- Keep this limited to event social planning context; do not add full schedule catalogs, notifications, native companion behavior, real-time location/presence, or provider scraping.

### Acceptance Criteria

- Meetup create/update APIs accept and return `vendor`, `booth`, and `location_notes`.
- Schedule-plan create/update APIs accept and return `vendor`, `booth`, and `location_notes`.
- Mobile Event overview and row summaries include booth/vendor context when present.
- Expanded meetup and schedule rows show readable location, vendor/booth, and location-note details.
- Existing ICS sync keeps source-owned fields separate from user-owned vendor/booth/location-note fields.
- Existing social planning, schedule editing, visibility, and Sched feed flows continue to work.

### Notes

- This is still a web/mobile social planning patch, not a native companion or notification milestone.
- Full schedule catalog discovery and friend-aware notifications remain separate backlog items.

### Closeout Evidence

- Roadmap slice: `3.4.42 — Event Social Vendor Booth Location Notes`.
- Project docs/checklists used: `AGENTS.md`, `/Users/hamlin/.codex/skills/uncodixfy/SKILL.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`.
- Runtime verification used: Docker-first backend/frontend rebuild to `3.4.42`; `/api/health` reported frontend/backend/build `3.4.42`; backend runtime verified `APP_EDITION=platform` and `PLAYWRIGHT_E2E_BYPASS_TOKEN=unset` after browser regression; generated public compose was booted without the localhost override and verified `APP_EDITION=unset` before the homelab boundary smoke.
- CI/checks run locally: `APP_VERSION=3.4.42 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build backend frontend`; backend syntax checks; event social planning smoke; targeted Playwright mobile Event drawer regression; backend unit tests; OpenAPI validation; compose config validation; public export surface validation; init parity; migration rehearsal; Help > Releases smoke for `3.4.42`; platform edition boundary; homelab edition boundary against generated public compose; RBAC regression; full browser regression (`53 passed`, `4 skipped`); observability release evidence; local release preflight; compose generator idempotence; version sync check; `git diff --check`; release-evidence secret-hygiene grep.
- Release/version artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.42.md`, and `backend/release-feed.json` are aligned on `3.4.42`.
- Verified facts: Event meetups and schedule plans now accept and return `vendor`, `booth`, and `location_notes`; mobile Event overview and row summaries include vendor/booth/location-note context when present; expanded meetup and schedule rows show readable location, vendor/booth, and location-note details; quick-edit controls save those fields through the existing scoped Event social endpoints; Sched-owned session fields remain separate from user-owned planning context.
- Blocked/unverified items: CI `secret-scan` and `image-security-and-sbom` remain CI-only; local preflight compose-smoke secure-cookie checks remain blocked by the development stack using `NODE_ENV=development` and `SESSION_COOKIE_SECURE=false`, while runtime health/version and compose config were verified locally.
- Files changed: `backend/db/migrations.js`, `init.sql`, `backend/routes/events.js`, `backend/middleware/validate.js`, `backend/openapi/openapi.yaml`, `backend/scripts/event-social-planning-smoke.js`, `backend/scripts/unit-tests.js`, `frontend/src/components/EventsView.jsx`, `tests/playwright/specs/events-collectibles.browser.spec.js`, version metadata/package files, `docker-compose.yml`, `docs/releases/v3.4.42.md`, `backend/release-feed.json`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/observability-evidence/observability-release-evidence.json`, `preflight-go-no-go.md`.
- Risks or follow-ups: full schedule catalog discovery, selected-recipient notifications, native companion contract work, offline companion packets, and conflict handling remain separate backlog items.
- What remains in the milestone: nothing; `3.4.42` is closed.
- Recommended commit message: `Release 3.4.42 event social vendor booth location notes`

## 3.4.43 — Event Social Platform Companion Contract

**Goal:** Define and ship the current backend/API contract for an Apple/platform companion client that can read day-of-con Event social planning data without turning this patch into native UI, notification, location, or full schedule catalog work.

**Current Slice:** `Closed 2026-04-30.`

### Scope

- Add a compact companion read endpoint for "today at this event" planning data.
- Return event metadata, attendee/group/meetup/schedule-plan records, counts, personal ICS sync metadata, cache guidance, privacy rules, and contract metadata in one response.
- Keep writes on the existing Event social planning endpoints instead of adding parallel companion-specific write APIs.
- Document the platform companion boundary for Apple/native clients.
- Update OpenAPI, smoke coverage, unit source assertions, release notes, release feed, and version metadata.
- Keep native companion UI, full schedule catalog discovery, push notifications, realtime location/presence, broad social discovery, and offline mutation queues out of this milestone.

### Acceptance Criteria

- `GET /api/events/:id/companion/today` returns a scoped companion snapshot for authenticated users.
- The response includes `event-social-companion.v1` contract metadata and endpoint references for existing write flows.
- The response never returns the raw personal Sched ICS URL.
- Cache, offline, conflict, privacy, and out-of-scope expectations are represented in the API payload and documented.
- OpenAPI exposes `EventCompanionTodayResponse`.
- Event social planning smoke coverage validates the companion endpoint against real in-stack data.
- Existing Event social planning APIs and mobile web behavior continue to work.

### Notes

- This is a contract and boundary milestone, not a platform app implementation milestone.
- Full schedule catalog and Now/Next discovery stays in `Event Schedule Catalog and Now/Next Discovery`.
- Selected-recipient notifications need a separate notification milestone.

### Closeout Evidence

- Roadmap slice: `3.4.43 — Event Social Platform Companion Contract`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/40-Event-Social-Planning-Foundation.md`, `docs/wiki/41-Personal-Sched-ICS-Sync.md`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`.
- Runtime verification used: Docker-first backend/frontend rebuild to `3.4.43`; `/api/health` reported frontend/backend/build `3.4.43`; backend runtime verified `APP_EDITION=platform` and `PLAYWRIGHT_E2E_BYPASS_TOKEN=unset` after browser regression; generated public compose was booted without the localhost override and verified `APP_EDITION=unset` before the homelab boundary smoke.
- CI/checks run locally: `APP_VERSION=3.4.43 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build backend frontend`; backend syntax checks; event social planning smoke; backend unit tests; OpenAPI validation; compose config validation; public export surface validation; init parity; migration rehearsal; Help > Releases smoke for `3.4.43`; platform edition boundary; homelab edition boundary against generated public compose; RBAC regression; full browser regression (`53 passed`, `4 skipped`); observability release evidence; local release preflight; compose generator idempotence; version sync check; `git diff --check`; release-evidence secret-hygiene grep.
- Release/version artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.43.md`, and `backend/release-feed.json` are aligned on `3.4.43`.
- Verified facts: `GET /api/events/:id/companion/today` returns the `event-social-companion.v1` contract snapshot; the payload includes scoped event metadata, counts, attendees, groups, meetups, schedule plans, personal ICS freshness without raw URL exposure, cache guidance, privacy rules, out-of-scope capability markers, and existing write endpoint references; OpenAPI documents `EventCompanionTodayResponse`; the event social smoke validates the contract against live in-stack data.
- Blocked/unverified items: CI `secret-scan` and `image-security-and-sbom` remain CI-only; local preflight compose-smoke secure-cookie checks remain blocked by the development stack using `NODE_ENV=development` and `SESSION_COOKIE_SECURE=false`, while runtime health/version and compose config were verified locally; the local preflight helper still reports browser regression as blocked because it does not execute Playwright itself, but the full browser regression was run locally and passed.
- Files changed: `backend/routes/events.js`, `backend/openapi/openapi.yaml`, `backend/scripts/event-social-planning-smoke.js`, `backend/scripts/unit-tests.js`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`, version metadata/package files, `docker-compose.yml`, `docs/releases/v3.4.43.md`, `backend/release-feed.json`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/observability-evidence/observability-release-evidence.json`, `preflight-go-no-go.md`.
- Risks or follow-ups: native companion UI, selected-recipient notifications, full schedule catalog discovery, offline mutation queues, realtime location/presence, broad social discovery, and richer conflict UX remain separate backlog or future milestone work.
- What remains in the milestone: nothing; `3.4.43` is closed.
- Recommended commit message: `Release 3.4.43 event social platform companion contract`

## 3.4.44 — Platform Companion Personal Sched ICS Sync Visibility

**Goal:** Make personal Sched ICS sync health explicit and UI-safe for platform companion clients, so the Apple app can show confidence, stale, failed, and manual-refresh states without exposing raw feed URLs or treating personal plans as a full event catalog.

**Current Slice:** `Closed 2026-05-01.`

### Scope

- Extend the event companion snapshot with a UI-safe `sync.personal_ics_visibility` object.
- Include connected state, provider, lifecycle status, sync status, freshness, stale threshold, item count, redacted error summary, and manual refresh support.
- Keep the raw personal ICS URL hidden from API responses and diagnostics.
- Document how platform clients should present personal ICS sync health as personal schedule state.
- Update OpenAPI, smoke coverage, unit source assertions, release notes, release feed, and version metadata.
- Avoid native UI implementation, full schedule catalog ingestion, background polling, push notifications, and offline mutation queues.

### Acceptance Criteria

- `GET /api/events/:id/companion/today` includes `sync.personal_ics_visibility`.
- The visibility object always reports `raw_url_returned: false`.
- Error summaries redact URL-like values before reaching companion payloads.
- Manual refresh is advertised only when a personal ICS feed is connected.
- Documentation distinguishes personal selected-session sync from the full event catalog.
- Existing personal ICS source APIs, event social planning APIs, and companion snapshot behavior continue to work.

### Notes

- This is a backend/API contract patch for platform clients, not an Apple app UI patch.
- Full catalog discovery and platform Now/Next remain separate future milestones.

### Closeout Evidence

- Roadmap slice: `3.4.44 — Platform Companion Personal Sched ICS Sync Visibility`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/40-Event-Social-Planning-Foundation.md`, `docs/wiki/41-Personal-Sched-ICS-Sync.md`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`, `docs/wiki/43-Platform-Companion-ICS-Sync-Visibility.md`.
- Runtime verification used: Docker-first backend/frontend rebuild to `3.4.44`; `/api/health` reported frontend/backend/build `3.4.44`; backend runtime verified `APP_EDITION=platform` and `PLAYWRIGHT_E2E_BYPASS_TOKEN=unset` after browser regression; generated public compose was booted without the localhost override and verified `APP_EDITION=unset` before the homelab boundary smoke.
- CI/checks run locally: `APP_VERSION=3.4.44 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build backend frontend`; backend syntax checks; event social planning smoke; personal Sched ICS sync smoke; backend unit tests; OpenAPI validation; compose config validation; public export surface validation; init parity; migration rehearsal; Help > Releases smoke for `3.4.44`; platform edition boundary; homelab edition boundary against generated public compose; RBAC regression; full browser regression (`53 passed`, `4 skipped`); observability release evidence; local release preflight; compose generator idempotence; version sync check; `git diff --check`; release-evidence secret-hygiene grep.
- Release/version artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.44.md`, and `backend/release-feed.json` are aligned on `3.4.44`.
- Verified facts: `GET /api/events/:id/companion/today` now returns `sync.personal_ics_visibility`; connected-feed smoke verified `fresh` visibility, manual refresh endpoint readback, `personal_schedule_only: true`, `raw_url_returned: false`, and no raw ICS URL leakage; disconnected event social smoke verified safe not-connected readback; OpenAPI documents the UI-safe visibility object in `EventCompanionTodayResponse`.
- Blocked/unverified items: CI `secret-scan` and `image-security-and-sbom` remain CI-only; local preflight compose-smoke secure-cookie checks remain blocked by the development stack using `NODE_ENV=development` and `SESSION_COOKIE_SECURE=false`, while runtime health/version and compose config were verified locally; the local preflight helper still reports browser regression as blocked because it does not execute Playwright itself, but the full browser regression was run locally and passed.
- Files changed: `backend/routes/events.js`, `backend/openapi/openapi.yaml`, `backend/scripts/event-personal-ics-sync-smoke.js`, `backend/scripts/event-social-planning-smoke.js`, `backend/scripts/unit-tests.js`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`, `docs/wiki/43-Platform-Companion-ICS-Sync-Visibility.md`, version metadata/package files, `docker-compose.yml`, `docs/releases/v3.4.44.md`, `backend/release-feed.json`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/observability-evidence/observability-release-evidence.json`, `preflight-go-no-go.md`.
- Risks or follow-ups: native companion UI, full schedule catalog discovery, background polling, selected-recipient notifications, offline mutation queues, realtime location/presence, and richer conflict UX remain separate backlog or future milestone work.
- What remains in the milestone: nothing; `3.4.44` is closed.
- Recommended commit message: `Release 3.4.44 platform companion personal sched ics sync visibility`

## 3.4.45 — Platform Companion Offline Event Packet

**Goal:** Define and ship a read-only offline event packet inside the platform companion contract so native clients can cache current Event social planning state for poor convention-center connectivity without inventing unsupported full catalog, notification, location, or offline mutation behavior.

**Current Slice:** `Closed 2026-05-01.`

### Scope

- Extend `GET /api/events/:id/companion/today` with an `offline_packet` object.
- Include packet version, generated timestamp, cache key, TTL/stale guidance, retry/conflict policy, included-data markers, counts, freshness, privacy flags, limitations, planned sessions, and key locations.
- Build key locations from Event, meetup, and schedule-plan location/vendor/booth/location-note data.
- Include personal planned sessions from current schedule plans, including Sched ICS-derived plans.
- Explicitly mark full schedule catalog support as unavailable until the separate catalog milestone exists.
- Keep the packet read-only; do not add offline mutation queues, background polling, push notifications, realtime location/presence, broad social discovery, or native UI.

### Acceptance Criteria

- `GET /api/events/:id/companion/today` includes `offline_packet.version = event-social-offline-packet.v1`.
- The packet advertises `mode = read_only_snapshot`, `backend_authoritative = true`, and `supports_offline_mutations = false`.
- The retry policy requires refetching before retrying writes after reconnect.
- The packet includes planned sessions and key locations from existing Event social planning data.
- The packet explicitly reports `includes.schedule_catalog = false` and returns an empty `schedule_catalog` until the full catalog milestone exists.
- The packet never returns raw personal ICS URLs, realtime location, presence, or broad social discovery state.

### Notes

- This is a backend/API contract patch for platform clients, not an Apple app UI patch.
- Full event schedule catalog and Now/Next discovery remain separate future milestones.

### Closeout Evidence

- Roadmap slice: `3.4.45 — Platform Companion Offline Event Packet`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/40-Event-Social-Planning-Foundation.md`, `docs/wiki/41-Personal-Sched-ICS-Sync.md`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`, `docs/wiki/43-Platform-Companion-ICS-Sync-Visibility.md`, `docs/wiki/44-Platform-Companion-Offline-Event-Packet.md`.
- Runtime verification used: Docker-first backend/frontend rebuild to `3.4.45`; `/api/health` reported frontend/backend/build `3.4.45`; backend runtime verified `APP_EDITION=platform` and `PLAYWRIGHT_E2E_BYPASS_TOKEN=unset` after browser regression; generated public compose was booted without the localhost override and verified `APP_EDITION=unset` before the homelab boundary smoke.
- CI/checks run locally: `APP_VERSION=3.4.45 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build backend frontend`; backend syntax checks; event social planning smoke; personal Sched ICS sync smoke; backend unit tests; OpenAPI validation; compose config validation; public export surface validation; init parity; migration rehearsal; Help > Releases smoke for `3.4.45`; platform edition boundary; homelab edition boundary against generated public compose; RBAC regression; full browser regression (`53 passed`, `4 skipped`); observability release evidence; local release preflight; compose generator idempotence; version sync check; `git diff --check`; release-evidence secret-hygiene grep.
- Release/version artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.45.md`, and `backend/release-feed.json` are aligned on `3.4.45`.
- Verified facts: `GET /api/events/:id/companion/today` now returns `offline_packet.version = event-social-offline-packet.v1`; the packet advertises `mode = read_only_snapshot`, `backend_authoritative = true`, `supports_offline_mutations = false`, and refetch-before-retry behavior; event social smoke verified planned sessions, schedule catalog unavailability, key location booth/vendor context, and raw ICS URL privacy; connected personal ICS smoke verified the packet carries fresh personal ICS state and synced planned sessions without leaking the raw feed URL.
- Blocked/unverified items: CI `secret-scan` and `image-security-and-sbom` remain CI-only; local preflight compose-smoke secure-cookie checks remain blocked by the development stack using `NODE_ENV=development` and `SESSION_COOKIE_SECURE=false`, while runtime health/version and compose config were verified locally; the local preflight helper still reports browser regression as blocked because it does not execute Playwright itself, but the full browser regression was run locally and passed.
- Files changed: `backend/routes/events.js`, `backend/openapi/openapi.yaml`, `backend/scripts/event-personal-ics-sync-smoke.js`, `backend/scripts/event-social-planning-smoke.js`, `backend/scripts/unit-tests.js`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`, `docs/wiki/44-Platform-Companion-Offline-Event-Packet.md`, version metadata/package files, `docker-compose.yml`, `docs/releases/v3.4.45.md`, `backend/release-feed.json`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/observability-evidence/observability-release-evidence.json`, `preflight-go-no-go.md`.
- Risks or follow-ups: full event schedule catalog discovery, native/platform UI, background polling, selected-recipient notifications, offline mutation queues, realtime location/presence, and richer conflict UX remain separate backlog or future milestone work.
- What remains in the milestone: nothing; `3.4.45` is closed.
- Recommended commit message: `Release 3.4.45 platform companion offline event packet`

## 3.4.46 — Event Schedule Catalog Foundation

**Goal:** Add a canonical event schedule catalog object that is separate from personal schedule plans, so web/backend and platform companion clients can distinguish "sessions that exist at the event" from "sessions this user or workspace selected."

**Current Slice:** `Closed 2026-05-01.`

### Scope

- Add `event_schedule_sessions` for canonical event catalog sessions.
- Store title, start/end time, location/room, description, track, categories, source metadata, and status.
- Add event-scoped CRUD endpoints for schedule catalog sessions.
- Include catalog sessions and catalog counts in `GET /api/events/:id/companion/today`.
- Include catalog sessions in the read-only offline event packet and key-location summary.
- Keep personal Sched ICS sync mapped to personal schedule plans, not the full catalog.
- Update OpenAPI, smoke coverage, unit source assertions, release notes, release feed, and version metadata.

### Acceptance Criteria

- An event can store catalog sessions separate from `event_schedule_plans`.
- `GET /api/events/:id/schedule-sessions` returns the scoped catalog for an event.
- Create/update/archive routes enforce the same event scope boundary as existing Event social planning routes.
- The companion contract exposes `counts.schedule_catalog_sessions`, top-level `schedule_catalog`, and `contract.write_endpoints.schedule_catalog`.
- The offline packet advertises schedule catalog support and includes catalog sessions when present.
- Personal ICS sync smoke continues to prove personal selected sessions do not become catalog sessions.

### Notes

- This is a backend/API foundation milestone, not a Now / Next UI or provider-ingestion milestone.
- Provider import automation, quick plan actions, conflict workflows, selected-recipient notifications, native UI, and background sync remain future work.

### Closeout Evidence

- Roadmap slice: `3.4.46 — Event Schedule Catalog Foundation`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/40-Event-Social-Planning-Foundation.md`, `docs/wiki/41-Personal-Sched-ICS-Sync.md`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`, `docs/wiki/44-Platform-Companion-Offline-Event-Packet.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: Docker-first backend/frontend rebuild to `3.4.46`; `/api/health` reported frontend/backend/build `3.4.46`; backend runtime verified `APP_EDITION=platform`, `APP_VERSION=3.4.46`, and `PLAYWRIGHT_E2E_BYPASS_TOKEN=unset` after browser regression; generated public compose was booted without the localhost override and verified `APP_EDITION=unset` before the homelab boundary smoke; live DB verified `schema_migrations.version = 88`.
- CI/checks run locally: backend syntax checks; `APP_VERSION=3.4.46 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build backend frontend`; backend unit tests; OpenAPI validation; event social planning smoke; personal Sched ICS sync smoke; compose config validation; public export surface validation; init parity; migration rehearsal; Help > Releases smoke for `3.4.46`; platform edition boundary; homelab edition boundary against generated public compose; RBAC regression; full browser regression (`53 passed`, `4 skipped`); production dependency audits; Dockerized `npm ci --no-fund --dry-run` lockfile sync checks for backend and frontend; observability release evidence (`9/9` checks passed); local release preflight; compose generator idempotence; version sync check; `git diff --check`; release-evidence secret-hygiene grep.
- Release/version artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.46.md`, and `backend/release-feed.json` are aligned on `3.4.46`.
- Verified facts: `event_schedule_sessions` exists through migration `88` and `init.sql`; `GET/POST/PATCH/DELETE /api/events/:id/schedule-sessions` are scoped and smoke-tested; `GET /api/events/:id/companion/today` now returns `counts.schedule_catalog_sessions`, top-level `schedule_catalog`, `contract.write_endpoints.schedule_catalog`, and offline packet catalog support; personal ICS sync smoke verified selected personal Sched sessions remain schedule plans and do not become catalog sessions; OpenAPI documents `EventScheduleSessionRecord` and the new endpoints.
- Blocked/unverified items: CI `secret-scan` and `image-security-and-sbom` remain CI-only; local preflight compose-smoke secure-cookie checks remain blocked by the development stack using `NODE_ENV=development` and `SESSION_COOKIE_SECURE=false`, while runtime health/version and compose config were verified locally; the local preflight helper still reports browser regression as blocked because it does not execute Playwright itself, but the full browser regression was run locally and passed.
- Files changed: `backend/db/migrations.js`, `init.sql`, `backend/middleware/validate.js`, `backend/routes/events.js`, `backend/openapi/openapi.yaml`, `backend/scripts/event-social-planning-smoke.js`, `backend/scripts/event-personal-ics-sync-smoke.js`, `backend/scripts/unit-tests.js`, `docs/wiki/44-Platform-Companion-Offline-Event-Packet.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`, version metadata/package files, `docker-compose.yml`, `docs/releases/v3.4.46.md`, `backend/release-feed.json`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/observability-evidence/observability-release-evidence.json`, `preflight-go-no-go.md`.
- Risks or follow-ups: catalog import automation, Now / Next discovery UI, quick plan-change actions, conflict workflows, friend/group attendance on catalog sessions, selected-recipient notifications, native/platform UI, background sync, offline mutation queues, realtime location, and presence remain separate backlog or future milestone work.
- What remains in the milestone: nothing; `3.4.46` is closed.
- Recommended commit message: `Release 3.4.46 event schedule catalog foundation`

## 3.4.47 — Event Schedule Catalog Import/Entry Polish

**Goal:** Make the schedule catalog foundation usable from the Event drawer through manual catalog entry, inline catalog editing, and a guarded path from catalog session to personal schedule plan.

**Current Slice:** `Closed 2026-05-01.`

### Scope

- Add an Event drawer Catalog section that is visually separate from the user's personal Schedule section.
- List catalog sessions grouped by day using the compact agenda pattern already used for schedule plans.
- Add manual catalog session creation from the drawer.
- Add inline editing for catalog session title, start/end time, location, room, track, categories, source URL, description, and status.
- Add quiet archive behavior for catalog sessions.
- Add a guarded `Add to schedule` action that creates a private schedule plan from a catalog session and disables when that catalog session already has a linked plan.
- Update targeted browser coverage, unit source assertions, release notes, release feed, and version metadata.

### Acceptance Criteria

- Users can add, edit, and archive catalog sessions without leaving the Event drawer.
- Catalog sessions are shown separately from personal schedule plans.
- `Add to schedule` creates a `schedule_catalog`-sourced schedule plan with the catalog session id as `source_ref`.
- The UI does not allow an obvious duplicate plan from the same catalog session.
- The existing personal Sched ICS schedule-plan flow remains unchanged.

### Notes

- This is manual-entry and browser polish, not provider import automation.
- Now / Next discovery, conflict workflows, selected-recipient notifications, friend/group attendance, native UI, background sync, realtime location, and offline mutation queues remain future work.

### Closeout Evidence

- Roadmap slice: `3.4.47 — Event Schedule Catalog Import/Entry Polish`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/40-Event-Social-Planning-Foundation.md`, `docs/wiki/44-Platform-Companion-Offline-Event-Packet.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: Docker-first backend/frontend rebuild to `3.4.47`; `/api/health` reported frontend/backend/build `3.4.47`; backend runtime verified `APP_EDITION=platform`, `APP_VERSION=3.4.47`, and `PLAYWRIGHT_E2E_BYPASS_TOKEN=unset` after browser regression; generated public compose was booted without the localhost override and verified `APP_EDITION=unset` before the homelab boundary smoke; normal local platform stack was restored and rechecked after release evidence generation.
- CI/checks run locally: `APP_VERSION=3.4.47 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build backend frontend`; backend unit tests (`230` passed); OpenAPI validation; event social planning smoke; personal Sched ICS sync smoke; targeted Event drawer catalog browser regression; full browser regression (`54 passed`, `4 skipped`); compose config validation; public export surface validation; init parity; migration rehearsal; Help > Releases smoke for `3.4.47`; platform edition boundary; homelab edition boundary against generated public compose; RBAC regression; production dependency audits; Dockerized `npm ci --no-fund --dry-run` lockfile sync checks for backend and frontend; compose generator idempotence; version sync check; observability release evidence (`9/9` checks passed); local release preflight; release-evidence secret-hygiene grep; `git diff --check`.
- Release/version artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.47.md`, and `backend/release-feed.json` are aligned on `3.4.47`; the running Help > Releases feed served `3.4.47` as the latest entry.
- Verified facts: Event drawer Catalog section lists catalog sessions separately from personal schedule plans; users can manually add catalog sessions; inline catalog editing covers title, start/end time, location, room, track, categories, source URL, description, and status; catalog sessions can be quietly archived; `Add to schedule` creates a private `schedule_catalog` plan with the catalog session id as `source_ref`; the obvious duplicate action is disabled once a catalog session is already in the personal schedule; personal Sched ICS sync remains unchanged and still maps selected sessions to personal schedule plans.
- Blocked/unverified items: CI `secret-scan` and `image-security-and-sbom` remain CI-only; local preflight compose-smoke secure-cookie checks remain blocked by the development stack using `NODE_ENV=development` and `SESSION_COOKIE_SECURE=false`, while runtime health/version and compose config were verified locally; the local preflight helper reports browser regression as blocked because it does not execute Playwright itself, but the full browser regression was run locally and passed.
- Files changed: `frontend/src/components/EventsView.jsx`, `tests/playwright/specs/events-collectibles.browser.spec.js`, `tests/playwright/specs/library-multiformat.browser.spec.js`, `backend/scripts/unit-tests.js`, version metadata/package files, `docker-compose.yml`, `docs/releases/v3.4.47.md`, `backend/release-feed.json`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/observability-evidence/observability-release-evidence.json`, `preflight-go-no-go.md`.
- Risks or follow-ups: provider import automation, Now / Next discovery UI, quick plan-change actions, conflict workflows, friend/group attendance, selected-recipient notifications, native/platform UI, background sync, offline mutation queues, realtime location, and presence remain separate backlog or future milestone work.
- What remains in the milestone: nothing; `3.4.47` is closed.
- Recommended commit message: `Release 3.4.47 event schedule catalog entry polish`

## 3.4.48 — Event Schedule Now / Next Read-Only View

**Goal:** Make the existing event schedule catalog useful during a con by showing a compact read-only Now / Next view in the Event drawer, without adding import automation, notifications, or conflict-management behavior yet.

**Current Slice:** `Closed 2026-05-01.`

### Scope

- Add a compact Now / Next block inside the Event drawer Catalog section.
- Use existing `event_schedule_sessions` records as the source of truth.
- Show the active in-progress catalog session when one exists.
- Show the next upcoming catalog session when one exists.
- Show a short later-today list when additional same-day catalog sessions exist.
- Mark catalog sessions that are already in the user's schedule.
- Keep cancelled and hidden catalog sessions out of the Now / Next summary.
- Update targeted browser coverage, unit source assertions, release notes, release feed, and version metadata.

### Acceptance Criteria

- Users can quickly see what catalog session is happening now and what starts next.
- The summary is read-only and does not replace the full catalog list or personal schedule list.
- Catalog sessions already added to the user's schedule are visibly marked.
- Existing catalog add/edit/archive and `Add to schedule` behavior continues to work.
- Provider import automation, conflict workflows, selected-recipient notifications, native UI, background sync, realtime location, and offline mutation queues remain future work.

### Notes

- This is the first small Now / Next web slice from the larger Event Schedule Catalog Now/Next follow-up backlog item.
- This milestone intentionally avoids provider import and notification scope so the discovery surface can be validated before heavier social coordination work.

### Closeout Evidence

- Roadmap slice: `3.4.48 — Event Schedule Now / Next Read-Only View`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/40-Event-Social-Planning-Foundation.md`, `docs/wiki/44-Platform-Companion-Offline-Event-Packet.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: Docker-first backend/frontend rebuild to `3.4.48`; `/api/health` reported frontend/backend/build `3.4.48`; backend runtime verified `APP_EDITION=platform`, `APP_VERSION=3.4.48`, and `PLAYWRIGHT_E2E_BYPASS_TOKEN=unset` after browser regression; generated public compose was booted without the localhost override and verified `APP_EDITION=unset` before the homelab boundary smoke; normal local platform stack was restored and rechecked after release evidence generation.
- CI/checks run locally: `APP_VERSION=3.4.48 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build backend frontend`; backend unit tests (`230` passed); OpenAPI validation; event social planning smoke; personal Sched ICS sync smoke; targeted Event drawer Now / Next browser regression; full browser regression (`55 passed`, `4 skipped`); compose config validation; public export surface validation; init parity; migration rehearsal; Help > Releases smoke for `3.4.48`; platform edition boundary; homelab edition boundary against generated public compose; RBAC regression; production dependency audits; Dockerized `npm ci --no-fund --dry-run` lockfile sync checks for backend and frontend; compose generator idempotence; version sync check; observability release evidence (`9/9` checks passed); local release preflight; release-evidence secret-hygiene grep; `git diff --check`.
- Release/version artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.48.md`, and `backend/release-feed.json` are aligned on `3.4.48`; the running Help > Releases feed served `3.4.48` as the latest entry.
- Verified facts: Event drawer Catalog section now shows a read-only Now / Next summary above the full catalog list; active in-progress catalog sessions appear under `Now`; the next upcoming catalog session appears under `Next`; additional same-day upcoming sessions can appear under `Later`; sessions already linked into the user's schedule are marked `In schedule`; hidden and cancelled catalog sessions are excluded from the Now / Next summary; existing catalog add/edit/archive and `Add to schedule` behavior remains covered by browser regression.
- Blocked/unverified items: CI `secret-scan` and `image-security-and-sbom` remain CI-only; local preflight compose-smoke secure-cookie checks remain blocked by the development stack using `NODE_ENV=development` and `SESSION_COOKIE_SECURE=false`, while runtime health/version and compose config were verified locally; the local preflight helper reports browser regression as blocked because it does not execute Playwright itself, but the full browser regression was run locally and passed.
- Files changed: `frontend/src/components/EventsView.jsx`, `tests/playwright/specs/events-collectibles.browser.spec.js`, `backend/scripts/unit-tests.js`, version metadata/package files, `docker-compose.yml`, `docs/releases/v3.4.48.md`, `backend/release-feed.json`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/observability-evidence/observability-release-evidence.json`, `preflight-go-no-go.md`.
- Risks or follow-ups: provider import automation, richer Now / Next filters, quick plan-change states, conflict workflows, friend/group attendance, selected-recipient notifications, native/platform UI, background sync, offline mutation queues, realtime location, and presence remain separate backlog or future milestone work.
- What remains in the milestone: nothing; `3.4.48` is closed.
- Recommended commit message: `Release 3.4.48 event schedule now next read-only view`

## 3.4.49 — Event Schedule Quick Plan States

**Goal:** Make catalog sessions actionable from the Event drawer by letting users quickly mark a session as planned, maybe, backup, or skipped without introducing notifications, conflict handling, or provider import behavior.

**Current Slice:** `Closed 2026-05-01.`

### Scope

- Add a compact plan-state control for catalog sessions in the Catalog list.
- Add the same plan-state control to Now / Next catalog items.
- If no linked personal plan exists for a catalog session, selecting a state creates a private `schedule_catalog` plan.
- If a linked personal plan already exists, selecting a state updates that plan instead of creating a duplicate.
- Preserve the existing `source_type = schedule_catalog` and `source_ref = catalog_session_id` linkage.
- Keep the state set intentionally small: planned, maybe, backup, skipped.
- Update targeted browser coverage, unit source assertions, release notes, release feed, and version metadata.

### Acceptance Criteria

- Users can mark catalog sessions as planned, maybe, backup, or skipped from the catalog list.
- Users can mark Now / Next sessions with the same states.
- A first state selection creates a private personal schedule plan linked to the catalog session.
- Later state changes update the linked plan instead of duplicating it.
- Existing catalog add/edit/archive behavior remains intact.
- Notifications, conflict workflows, friend/group attendance, provider import automation, native UI, background sync, realtime location, and offline mutation queues remain future work.

### Notes

- This is the first actionable planning slice after the read-only Now / Next view.
- This milestone intentionally keeps social coordination and conflict resolution out of scope.

### Closeout Evidence

- Roadmap slice: `3.4.49 — Event Schedule Quick Plan States`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/40-Event-Social-Planning-Foundation.md`, `docs/wiki/44-Platform-Companion-Offline-Event-Packet.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: Docker-first backend/frontend rebuild to `3.4.49`; `/api/health` reported frontend/backend/build `3.4.49`; backend runtime verified `APP_EDITION=platform`, `APP_VERSION=3.4.49`, and `PLAYWRIGHT_E2E_BYPASS_TOKEN=unset` after browser regression; generated public compose was booted without the localhost override and verified `APP_EDITION=unset` before the homelab boundary smoke; normal local platform stack was restored and rechecked after release evidence generation.
- CI/checks run locally: `APP_VERSION=3.4.49 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build backend frontend`; backend unit tests (`230` passed); OpenAPI validation; event social planning smoke; personal Sched ICS sync smoke; targeted Event drawer quick-state browser regression; full browser regression (`55 passed`, `4 skipped`); compose config validation; public export surface validation; init parity; migration rehearsal; Help > Releases smoke for `3.4.49`; platform edition boundary; homelab edition boundary against generated public compose; RBAC regression; production dependency audits; Dockerized `npm ci --no-fund --dry-run` lockfile sync checks for backend and frontend; compose generator idempotence; version sync check; observability release evidence (`9/9` checks passed); local release preflight; release-evidence secret-hygiene grep; `git diff --check`.
- Release/version artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.49.md`, and `backend/release-feed.json` are aligned on `3.4.49`; the running Help > Releases feed served `3.4.49` as the latest entry.
- Verified facts: Catalog rows and Now / Next catalog items now expose a compact plan-state control; choosing planned, maybe, backup, or skipped creates a private linked `schedule_catalog` plan when none exists; choosing a new state for an already linked catalog session updates the existing plan rather than creating a duplicate; the UI continues to show the linked state on catalog and Now / Next rows; existing catalog add/edit/archive behavior remains covered by browser regression.
- Blocked/unverified items: CI `secret-scan` and `image-security-and-sbom` remain CI-only; local preflight compose-smoke secure-cookie checks remain blocked by the development stack using `NODE_ENV=development` and `SESSION_COOKIE_SECURE=false`, while runtime health/version and compose config were verified locally; the local preflight helper reports browser regression as blocked because it does not execute Playwright itself, but the full browser regression was run locally and passed.
- Files changed: `frontend/src/components/EventsView.jsx`, `tests/playwright/specs/events-collectibles.browser.spec.js`, `backend/scripts/unit-tests.js`, version metadata/package files, `docker-compose.yml`, `docs/releases/v3.4.49.md`, `backend/release-feed.json`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/observability-evidence/observability-release-evidence.json`, `preflight-go-no-go.md`.
- Risks or follow-ups: provider import automation, richer Now / Next filters, overlap/conflict detection, replacement choices, friend/group attendance, selected-recipient notifications, native/platform UI, background sync, offline mutation queues, realtime location, and presence remain separate backlog or future milestone work.
- What remains in the milestone: nothing; `3.4.49` is closed.
- Recommended commit message: `Release 3.4.49 event schedule quick plan states`

## 3.4.50 — Event Schedule Conflict Detection

**Goal:** Surface read-only overlap warnings for event schedule plans and catalog session choices, so users can see when planned, maybe, or backup sessions conflict before adding richer replacement or notification workflows.

**Current Slice:** `Closed 2026-05-01.`

### Scope

- Detect overlapping event schedule plans using existing `start_at` and `end_at` values.
- Treat `planned`, `maybe`, and `backup` as conflict-eligible states.
- Exclude `skipped` schedule plans from conflict warnings.
- Use a one-hour fallback window when an item has a start time but no end time.
- Show quiet conflict cues on Now / Next catalog items when the catalog choice overlaps an active personal plan.
- Show quiet conflict cues on Catalog rows when the linked or potential catalog plan overlaps an active personal plan.
- Show `Conflicts with ...` context in the personal Schedule list for overlapping active plans.
- Keep this read-only; do not add replace actions, selected-recipient notifications, provider import automation, native UI, background sync, realtime location, or offline mutation queues.
- Update targeted browser coverage, unit source assertions, release notes, release feed, and version metadata.

### Acceptance Criteria

- Overlapping planned/maybe/backup schedule plans are visibly marked as conflicts.
- Skipped plans do not create conflict warnings.
- Now / Next and Catalog rows can warn that a catalog session would conflict with the user's active schedule.
- The personal Schedule list identifies the conflicting session by title.
- Existing quick plan-state creation/update behavior continues to work.
- Conflict resolution actions remain future work.

### Notes

- This milestone intentionally stops at awareness. Replacement choices and backup/keep-both flows belong in a follow-up slice.

### Closeout Evidence

- Roadmap slice: `3.4.50 — Event Schedule Conflict Detection`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/40-Event-Social-Planning-Foundation.md`, `docs/wiki/44-Platform-Companion-Offline-Event-Packet.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: Docker-first backend/frontend rebuild to `3.4.50`; `/api/health` reported frontend/backend/build `3.4.50`; backend runtime verified `APP_EDITION=platform`, `APP_VERSION=3.4.50`, `NODE_ENV=development`, `SESSION_COOKIE_SECURE=false`, and no persisted `PLAYWRIGHT_E2E_BYPASS_TOKEN`; generated public compose was booted without the localhost override and verified with `APP_EDITION` unset before the homelab boundary smoke; normal local platform stack was restored and rechecked after release evidence generation.
- CI/checks run locally: `APP_VERSION=3.4.50 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build backend frontend`; backend unit tests (`230` passed); OpenAPI validation; event social planning smoke; personal Sched ICS sync smoke; targeted Event drawer conflict browser regression; full browser regression (`55` passed, `4` skipped); compose config validation; public export surface validation; init parity; migration rehearsal; Help > Releases smoke for `3.4.50`; platform edition boundary; homelab edition boundary against generated public compose; RBAC regression; production dependency audits; Dockerized `npm ci --no-fund --dry-run` lockfile sync checks for backend and frontend; compose generator idempotence; app meta/package sync; observability release evidence (`9/9` checks passed); local release preflight; release-evidence secret-hygiene grep; `git diff --check`.
- Release/version artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.50.md`, and `backend/release-feed.json` are aligned on `3.4.50`; the running Help > Releases feed served `3.4.50` as the latest entry.
- Verified facts: overlapping planned, maybe, and backup schedule plans now surface quiet `Conflict` and `Conflicts with ...` cues in the personal Schedule list; skipped plans are excluded from conflict warnings; Catalog and Now / Next rows show candidate conflict context when a catalog session overlaps an active personal plan; conflict detection uses existing event-scoped schedule start/end fields with a one-hour fallback for missing end times; existing quick plan-state creation/update behavior remains covered by browser regression.
- Blocked/unverified items: CI `secret-scan` and `image-security-and-sbom` remain CI-only; local preflight compose-smoke secure-cookie checks remain blocked by the development stack using `NODE_ENV=development` and `SESSION_COOKIE_SECURE=false`, while runtime health/version and compose config were verified locally; the local preflight helper reports browser regression as blocked because it does not execute Playwright itself, but the full browser regression was run locally and passed.
- Files changed: `frontend/src/components/EventsView.jsx`, `tests/playwright/specs/events-collectibles.browser.spec.js`, `backend/scripts/unit-tests.js`, version metadata/package files, `docker-compose.yml`, `docs/releases/v3.4.50.md`, `backend/release-feed.json`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/observability-evidence/observability-release-evidence.json`, `preflight-go-no-go.md`.
- Risks or follow-ups: conflict replacement choices, selected-recipient notifications, friend/group attendance on catalog sessions, provider import automation, native/platform UI, background sync, offline mutation queues, realtime location, and presence remain separate backlog or future milestone work.
- What remains in the milestone: nothing; `3.4.50` is closed.
- Recommended commit message: `Release 3.4.50 event schedule conflict detection`

## 3.4.51 — Event Schedule Conflict Resolution Actions

**Goal:** Turn read-only schedule conflict awareness into local, intentional plan-state choices without adding social notifications, provider import automation, native UI, or realtime behavior.

**Current Slice:** `Closed 2026-05-01.`

### Scope

- Intercept conflict-active catalog plan-state changes when the selected session overlaps active personal schedule plans.
- Show a compact conflict resolver in the Event drawer near the control that triggered it.
- Offer local choices to keep both, make the selected session planned while moving conflicting plans to backup, mark the selected session as backup, or skip the selected session.
- Apply the choices using the existing event schedule-plan create/update endpoints.
- Keep conflict handling user-local and read/write only for the current web Event drawer schedule state.
- Do not add selected-recipient notifications, friend/group attendance, provider import automation, native/platform UI, background sync, offline mutation queues, realtime location, or presence.
- Update targeted browser coverage, unit source assertions, release notes, release feed, and version metadata.

### Acceptance Criteria

- Choosing planned/maybe/backup for a conflicting catalog session opens a resolver instead of silently saving.
- `Keep both` preserves the requested state while keeping existing conflicting plans unchanged.
- `Make planned, move conflicts to backup` marks the selected catalog session planned and moves conflicting plans to backup.
- `Mark as backup` and `Skip this` save those states without requiring users to open the full Schedule row.
- Conflict prompts are shown only at the interaction source, not duplicated across Now / Next and Catalog rows.
- Existing non-conflicting quick plan-state behavior continues to save directly.

### Notes

- This milestone records intent around a conflict; it does not remove all conflict cues, because backup sessions remain conflict-visible by design.
- Friend/group notification and attendance behavior remains a later social-sharing milestone.

### Closeout Evidence

- Roadmap slice: `3.4.51 — Event Schedule Conflict Resolution Actions`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/40-Event-Social-Planning-Foundation.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: Docker-first backend/frontend rebuild to `3.4.51`; `/api/health` reported frontend/backend/build `3.4.51`; backend runtime verified `APP_EDITION=platform`, `APP_VERSION=3.4.51`, `NODE_ENV=development`, `SESSION_COOKIE_SECURE=false`, and no persisted `PLAYWRIGHT_E2E_BYPASS_TOKEN`; generated public compose was booted without the localhost override and verified with `APP_EDITION` unset before the homelab boundary smoke; normal local platform stack was restored and rechecked after release evidence generation.
- CI/checks run locally: `APP_VERSION=3.4.51 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build backend frontend`; backend unit tests (`230` passed); OpenAPI validation; event social planning smoke; personal Sched ICS sync smoke; targeted Event drawer conflict-resolution browser regression; full browser regression (`55` passed, `4` skipped); compose config validation; public export surface validation; init parity; migration rehearsal; Help > Releases smoke for `3.4.51`; platform edition boundary; homelab edition boundary against generated public compose; RBAC regression; production dependency audits; Dockerized `npm ci --no-fund --dry-run` lockfile sync checks for backend and frontend; compose generator idempotence; app meta/package sync; observability release evidence (`9/9` checks passed); local release preflight; release-evidence secret-hygiene grep; `git diff --check`.
- Release/version artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.51.md`, and `backend/release-feed.json` are aligned on `3.4.51`; the running Help > Releases feed served `3.4.51` as the latest entry.
- Verified facts: conflicting planned/maybe/backup catalog plan-state changes now open a compact resolver instead of silently saving; resolver prompts render only at the interaction source; `Keep both` preserves the requested state and existing conflicting plans; `Make planned, move conflicts to backup` marks the selected session planned and patches conflicting plans to backup; `Mark as backup` saves the selected session as backup; non-conflicting quick plan-state changes continue to save directly; conflict choices use the existing scoped schedule-plan endpoints and do not introduce notifications.
- Blocked/unverified items: CI `secret-scan` and `image-security-and-sbom` remain CI-only; local preflight compose-smoke secure-cookie checks remain blocked by the development stack using `NODE_ENV=development` and `SESSION_COOKIE_SECURE=false`, while runtime health/version and compose config were verified locally; the local preflight helper reports browser regression as blocked because it does not execute Playwright itself, but the full browser regression was run locally and passed.
- Files changed: `frontend/src/components/EventsView.jsx`, `tests/playwright/specs/events-collectibles.browser.spec.js`, `backend/scripts/unit-tests.js`, version metadata/package files, `docker-compose.yml`, `docs/releases/v3.4.51.md`, `backend/release-feed.json`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/observability-evidence/observability-release-evidence.json`, `preflight-go-no-go.md`.
- Risks or follow-ups: selected-recipient notifications, friend/group attendance on catalog sessions, schedule catalog filters, provider import automation, native/platform UI, background sync, offline mutation queues, realtime location, and presence remain separate backlog or future milestone work.
- What remains in the milestone: nothing; `3.4.51` is closed.
- Recommended commit message: `Release 3.4.51 event schedule conflict resolution actions`

## 3.4.52 — Event Schedule Friend / Group Attendance Readback

**Goal:** Add web-side shared attendance context for event catalog sessions using existing schedule-plan visibility, without adding notifications, friend discovery, platform relay behavior, or native/mobile push infrastructure.

**Current Slice:** `Closed 2026-05-01.`

### Scope

- Summarize catalog-linked schedule plans by active attendance states: planned, maybe, and backup.
- Keep the user's private catalog-linked plan as the primary plan-state control when duplicate/shared linked plans exist.
- Show compact shared attendance counts on Now / Next and Catalog rows.
- Show an expanded shared attendance block on Catalog rows with visibility-aware breakdowns.
- Use current visibility values (`selected_people`, `group`, `event_workspace`) as readback categories.
- Keep this read-only; do not add selected-recipient notifications, friend discovery, event companion invites, platform relay identity, device registration, push delivery, realtime presence/location, or offline mutation queues.
- Update targeted browser coverage, unit source assertions, release notes, release feed, and version metadata.

### Acceptance Criteria

- Catalog rows and Now / Next rows can show shared attendance counts such as `Shared: 1 backup`.
- Private linked plans continue to drive the user's own catalog plan-state control.
- Shared readback does not expose raw ICS URLs or notification/device details.
- Existing quick plan-state, conflict detection, and conflict-resolution flows continue to work.
- True friend identity, selected-recipient preview, and notifications remain future platform/social milestones.

### Notes

- Current web readback is visibility-aware schedule context, not a full friend graph.
- Group/selected-person identity targeting belongs with the later platform companion and selected-recipient notification work.

### Closeout

- Roadmap slice: `3.4.52 — Event Schedule Friend / Group Attendance Readback`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/40-Event-Social-Planning-Foundation.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: Docker-first backend/frontend rebuild to `3.4.52`; `/api/health` reported frontend/backend/build `3.4.52`; backend runtime verified `APP_EDITION=platform`, `APP_VERSION=3.4.52`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; generated public compose was booted without the localhost override and verified with `APP_EDITION` unset before the homelab boundary smoke; normal local platform stack was restored and rechecked after homelab verification.
- CI/checks run locally: `APP_VERSION=3.4.52 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build frontend`; backend unit tests (`230` passed); OpenAPI validation; event social planning smoke; personal Sched ICS sync smoke; Help > Releases smoke for `3.4.52`; targeted Event drawer Now / Next browser regression; full browser regression (`55` passed, `4` skipped); compose config validation; public export surface validation; init parity; migration rehearsal; platform edition boundary; homelab edition boundary against generated public compose; RBAC regression; Dockerized `npm ci --no-fund --dry-run` lockfile sync checks for backend and frontend; compose generator rerun; release-evidence secret-hygiene grep; `git diff --check`.
- Release/version artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.52.md`, and `backend/release-feed.json` are aligned on `3.4.52`; the running Help > Releases feed served `3.4.52` as the latest entry.
- Verified facts: catalog-linked shared/group schedule plans now render compact attendance readback such as `Shared: 1 backup`; expanded catalog rows show a visibility-aware shared attendance block; private linked plans continue to own the user's quick plan-state selector when duplicate/shared linked plans exist for the same catalog session; duplicate linked plans for the same catalog session no longer count as conflicts against each other; existing quick plan-state and conflict-resolution flows remain green in browser regression; this slice added no selected-recipient notifications, friend discovery, device registration, platform relay behavior, realtime presence, or offline mutation queues.
- Blocked/unverified items: CI `secret-scan` and `image-security-and-sbom` remain CI-only; local preflight compose-smoke secure-cookie checks remain blocked by the development stack using `NODE_ENV=development` and `SESSION_COOKIE_SECURE=false`, while runtime health/version and compose config were verified locally; `npm --prefix backend run test:observability-evidence` was attempted from repo root but hung without emitting fresh `3.4.52` evidence and was stopped after waiting, leaving observability evidence to rerun in a maintainer/CI release-evidence pass; host-side init parity and migration rehearsal artifact refresh was blocked by local Postgres admin authentication, while both checks passed in the running backend container.
- Files changed: `frontend/src/components/EventsView.jsx`, `tests/playwright/specs/events-collectibles.browser.spec.js`, `backend/scripts/unit-tests.js`, version metadata/package files, `docker-compose.yml`, `docs/releases/v3.4.52.md`, `backend/release-feed.json`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `preflight-go-no-go.md`.
- Risks or follow-ups: selected-recipient notifications, friend identity, group attendance membership detail, platform companion relay identity, device registration, push delivery, realtime location, presence, and offline mutation queues remain separate future milestones.
- What remains in the milestone: nothing for the readback slice; rerun observability release evidence and CI-only `secret-scan` / `image-security-and-sbom` during the release handoff.
- Recommended commit message: `Release 3.4.52 event schedule friend and group attendance readback`

## 3.4.53 — Event Schedule Catalog Filters

**Goal:** Make the event schedule catalog easier to scan on long convention schedules by adding compact, local filters for time window, plan state, conflicts, and shared attendance before notification or native companion work.

**Current Slice:** `Closed 2026-05-01.`

### Scope

- Add a compact filter row to the Event drawer schedule catalog list.
- Support time filters for All, Now, Next, and Later today.
- Support plan-state filtering, including Not in schedule.
- Add quick toggles for Conflicts only and Has shared attendance.
- Preserve existing Now / Next, quick plan-state, conflict-resolution, and shared-attendance behavior.
- Keep this as web-side filtering only; do not add selected-recipient notifications, friend discovery, event companion invites, platform relay identity, device registration, push delivery, realtime presence/location, or offline mutation queues.

### Acceptance Criteria

- Catalog lists can be narrowed to current, next, later-today, planned-state, conflict, or shared-attendance subsets.
- Filtered empty states are explicit and do not make the catalog feel broken.
- Existing schedule catalog quick actions and conflict flows continue to work.
- Shared-attendance filters use existing visibility-aware readback and do not expose raw ICS URLs or notification/device details.

### Notes

- This is a scanability patch, not a social notification milestone.
- Category, track, room, and provider-backed catalog import filters remain possible follow-ups after the compact filter behavior is proven.

### Closeout

- Roadmap slice: `3.4.53 — Event Schedule Catalog Filters`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/40-Event-Social-Planning-Foundation.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: Docker-first backend/frontend rebuild to `3.4.53`; `/api/health` reported frontend/backend/build `3.4.53`; backend runtime verified `APP_EDITION=platform`, `APP_VERSION=3.4.53`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; generated public compose was booted without the localhost override and verified with `APP_EDITION` unset before the homelab boundary smoke; normal local platform stack was restored and rechecked after homelab verification.
- CI/checks run locally: `APP_VERSION=3.4.53 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build backend frontend`; backend unit tests (`230` passed); OpenAPI validation; event social planning smoke; personal Sched ICS sync smoke; Help > Releases smoke for `3.4.53`; targeted Event drawer catalog-filter browser regression; full browser regression (`55` passed, `4` skipped); compose config validation; public export surface validation; init parity; migration rehearsal; platform edition boundary; homelab edition boundary against generated public compose; RBAC regression; Dockerized `npm ci --no-fund --dry-run` lockfile sync checks for backend and frontend; compose generator idempotence by checksum; local release preflight; release-evidence secret-hygiene grep; `git diff --check`.
- Release/version artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.53.md`, and `backend/release-feed.json` are aligned on `3.4.53`; the running Help > Releases feed served `3.4.53` as the latest entry.
- Verified facts: the Event drawer schedule catalog now has compact filters for All, Now, Next, Later today, plan state, Conflicts only, and Has shared attendance; filter counts show the visible/total session count; no-match results show an explicit empty state; plan-state filtering can isolate Not in schedule sessions; shared-attendance filtering uses the existing visibility-aware readback; conflict filtering uses the existing local conflict detection; existing quick plan-state and conflict-resolution flows remain green in browser regression.
- Blocked/unverified items: CI `secret-scan` and `image-security-and-sbom` remain CI-only; local preflight compose-smoke secure-cookie checks remain blocked by the development stack using `NODE_ENV=development` and `SESSION_COOKIE_SECURE=false`, while runtime health/version and compose config were verified locally; local preflight still reports observability release evidence as stale or failed because fresh observability evidence was not regenerated for `3.4.53`; the first event social smoke and first RBAC run hit Docker/DB fallout from Docker storage exhaustion, then passed after reclaiming build cache with `docker builder prune -f`.
- Files changed: `frontend/src/components/EventsView.jsx`, `tests/playwright/specs/events-collectibles.browser.spec.js`, `backend/scripts/unit-tests.js`, version metadata/package files, `docker-compose.yml`, `docs/releases/v3.4.53.md`, `backend/release-feed.json`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `preflight-go-no-go.md`.
- Risks or follow-ups: category/track/room catalog filters, provider-backed catalog import filters, selected-recipient notifications, friend identity, platform companion relay identity, device registration, push delivery, realtime location, presence, and offline mutation queues remain separate future milestones.
- What remains in the milestone: nothing for the catalog-filter slice; rerun observability release evidence and CI-only `secret-scan` / `image-security-and-sbom` during the release handoff.
- Recommended commit message: `Release 3.4.53 event schedule catalog filters`

## 3.4.54 — Event Schedule Catalog Metadata Filters

**Goal:** Let long event schedule catalogs be narrowed by session metadata that already exists in imported or manually entered catalog rows: track, category, and room/location.

**Current Slice:** `Closed 2026-05-02.`

### Scope

- Add derived catalog filter controls for track, category, and room/location.
- Reuse existing schedule catalog session metadata without adding schema, API, or sync behavior.
- Keep filtering local to the Event drawer catalog list.
- Preserve existing time, plan-state, conflict, shared-attendance, Now / Next, and quick plan-state behavior.
- Keep selected-recipient notifications, native companion identity, provider-backed catalog import filters, push delivery, realtime presence/location, and offline mutation queues out of this patch.

### Acceptance Criteria

- Catalog filter options are derived from the current event's catalog sessions.
- Track, category, and room/location filters narrow the same catalog list as the existing time and plan-state filters.
- Filter counts and no-match empty states continue to reflect the filtered catalog result.
- Browser regression covers metadata filtering alongside the existing catalog Now / Next and conflict flows.

### Notes

- This is still a scanability patch, not a social notification milestone.
- Provider-backed import taxonomy normalization remains a possible follow-up after more real event catalogs are tested.

### Closeout

- Roadmap slice: `3.4.54 — Event Schedule Catalog Metadata Filters`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/40-Event-Social-Planning-Foundation.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: Docker-first backend/frontend rebuild to `3.4.54`; `/api/health` reported frontend/backend/build `3.4.54`; backend runtime verified `APP_EDITION=platform`, `APP_VERSION=3.4.54`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; generated public compose was booted with `IMAGE_TAG=3.4.54` and verified with `APP_EDITION` unset before the homelab boundary smoke; normal local platform stack was restored and rechecked after homelab verification.
- CI/checks run locally: `APP_VERSION=3.4.54 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build backend frontend`; backend unit tests (`230` passed); OpenAPI validation; event social planning smoke; personal Sched ICS sync smoke; Help > Releases smoke for `3.4.54`; targeted Event drawer catalog-filter browser regression; full browser regression (`55` passed, `4` skipped); compose config validation; public export surface validation; init parity; migration rehearsal; platform edition boundary; homelab edition boundary against generated public compose; RBAC regression; Dockerized `npm ci --no-fund --dry-run` lockfile sync checks for backend and frontend; compose generator idempotence by checksum; local release preflight; release-evidence secret-hygiene grep; `git diff --check`.
- Release/version artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.54.md`, and `backend/release-feed.json` are aligned on `3.4.54`; the running Help > Releases feed served `3.4.54` as the latest entry.
- Verified facts: the Event drawer schedule catalog now derives Track, Category, and Room / Location filter options from the current catalog sessions; metadata filters combine with the existing time, plan-state, conflict, and shared-attendance filters; counts and the no-match empty state still reflect the filtered result; browser regression covers track, category, and room filtering alongside Now / Next, shared-attendance, and conflict flows.
- Blocked/unverified items: CI `secret-scan` and `image-security-and-sbom` remain CI-only; local preflight compose-smoke secure-cookie checks remain blocked by the development stack using `NODE_ENV=development` and `SESSION_COOKIE_SECURE=false`, while runtime health/version and compose config were verified locally; local preflight still reports observability release evidence as stale or failed because fresh observability evidence was not regenerated for `3.4.54`; local preflight cannot run the browser gate itself, but the full browser regression was run separately and passed.
- Files changed: `frontend/src/components/EventsView.jsx`, `tests/playwright/specs/events-collectibles.browser.spec.js`, `backend/scripts/unit-tests.js`, version metadata/package files, `docker-compose.yml`, `docs/releases/v3.4.54.md`, `backend/release-feed.json`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `preflight-go-no-go.md`.
- Risks or follow-ups: provider-backed catalog import filters, import taxonomy normalization, selected-recipient notifications, friend identity, platform companion relay identity, device registration, push delivery, realtime location, presence, and offline mutation queues remain separate future milestones.
- What remains in the milestone: nothing for the catalog-metadata-filter slice; rerun observability release evidence and CI-only `secret-scan` / `image-security-and-sbom` during the release handoff.
- Recommended commit message: `Release 3.4.54 event schedule catalog metadata filters`

## 3.4.55 — Event Schedule Catalog ICS Import and Taxonomy Normalization

**Goal:** Seed the canonical event schedule catalog from provider-backed ICS calendar feeds while keeping personal Sched ICS sync separate from full catalog import behavior.

**Current Slice:** `Closed 2026-05-02.`

### Scope

- Add a one-time catalog ICS import endpoint for scoped Events.
- Write imported rows into `event_schedule_sessions`, not `event_schedule_plans`.
- Keep the submitted catalog ICS URL transient: do not store it or return it.
- Normalize provider taxonomy by filtering generic provider categories, preserving useful categories, inferring track, and inferring room from location where possible.
- Add a compact Event drawer control for one-time catalog ICS import.
- Keep recurring catalog sync, scraping automation, selected-recipient notifications, friend identity, native companion UI, push delivery, realtime presence/location, and offline mutation queues out of this patch.

### Acceptance Criteria

- A Sched-style ICS URL can import full catalog sessions into `event_schedule_sessions`.
- Re-importing the same feed is idempotent by provider source reference and updates existing catalog sessions instead of duplicating them.
- Personal schedule plans are not created by catalog import.
- Imported catalog sessions feed existing Now / Next, conflict, attendance, and metadata filter behavior.
- Raw catalog ICS URLs are not stored or returned in API responses.

### Notes

- This is a conservative provider-backed import path, not recurring provider sync.
- Personal Sched ICS remains the selected-session sync path and continues to populate private schedule plans.

### Closeout

- Roadmap slice: `3.4.55 — Event Schedule Catalog ICS Import and Taxonomy Normalization`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/41-Personal-Sched-ICS-Sync.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: Docker-first backend/frontend rebuild to `3.4.55`; `/api/health` reported frontend/backend/build `3.4.55`; backend runtime verified `APP_EDITION=platform`, `APP_VERSION=3.4.55`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; generated public compose was booted with `IMAGE_TAG=3.4.55` and verified with `APP_EDITION` unset before the homelab boundary smoke; normal local platform stack was restored and rechecked after homelab verification.
- CI/checks run locally: `APP_VERSION=3.4.55 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build backend frontend`; backend unit tests (`231` passed); OpenAPI validation; event catalog ICS import smoke; event social planning smoke; personal Sched ICS sync smoke; Help > Releases smoke for `3.4.55`; targeted Event drawer catalog browser regressions; full browser regression (`55` passed, `4` skipped); compose config validation; public export surface validation; init parity; migration rehearsal; platform edition boundary; homelab edition boundary against generated public compose; RBAC regression; Dockerized `npm ci --no-fund --dry-run` lockfile sync checks for backend and frontend; compose generator idempotence by checksum; local release preflight; release-evidence secret-hygiene grep; `git diff --check`.
- Release/version artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.55.md`, and `backend/release-feed.json` are aligned on `3.4.55`; the running Help > Releases feed served `3.4.55` as the latest entry.
- Verified facts: `POST /api/events/:id/schedule-sessions/import-ics` fetches a submitted calendar URL once and upserts `event_schedule_sessions` with `source_type = sched_catalog_ics`; repeated imports update existing catalog sessions by source reference; imported sessions do not create personal schedule plans; raw catalog ICS URLs are not stored or returned; provider category noise such as `PROGRAMS` is filtered while useful categories, inferred track, and inferred room remain available to the catalog filters.
- Blocked/unverified items: CI `secret-scan` and `image-security-and-sbom` remain CI-only; local preflight compose-smoke secure-cookie checks remain blocked by the development stack using `NODE_ENV=development` and `SESSION_COOKIE_SECURE=false`, while runtime health/version and compose config were verified locally; local preflight still reports observability release evidence as stale or failed because fresh observability evidence was not regenerated for `3.4.55`; local preflight cannot run the browser gate itself, but the full browser regression was run separately and passed.
- Files changed: `backend/services/schedIcsSync.js`, `backend/routes/events.js`, `backend/middleware/validate.js`, `backend/openapi/openapi.yaml`, `backend/scripts/event-catalog-ics-import-smoke.js`, `backend/scripts/unit-tests.js`, `frontend/src/components/EventsView.jsx`, version metadata/package files, `docker-compose.yml`, `docs/releases/v3.4.55.md`, `backend/release-feed.json`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`, `preflight-go-no-go.md`.
- Risks or follow-ups: recurring catalog sync, provider-specific delta behavior, richer taxonomy mapping, selected-recipient notifications, friend identity, platform companion native UI, device registration, push delivery, realtime location, presence, and offline mutation queues remain separate future milestones.
- What remains in the milestone: nothing for the one-time catalog ICS import slice; rerun observability release evidence and CI-only `secret-scan` / `image-security-and-sbom` during the release handoff.
- Recommended commit message: `Release 3.4.55 event schedule catalog ICS import and taxonomy normalization`

## 3.4.56 — Event Schedule Catalog-to-Personal Plan Matching

**Goal:** Let imported catalog sessions recognize matching personal Sched ICS plans without collapsing catalog data and personal plan data into one object.

**Current Slice:** `Closed 2026-05-02.`

### Scope

- Add a catalog-session link field to event schedule plans.
- Backfill confident matches where personal Sched plans and catalog ICS sessions share the same event and source reference.
- Link existing personal plans after catalog ICS import, and link newly refreshed personal plans when catalog sessions already exist.
- Keep personal plan source identity as `sched_ics`; do not rewrite personal plans into `schedule_catalog` plans.
- Update catalog quick-state, attendance readback, and conflict handling so linked personal plans behave like selected catalog rows.
- Keep recurring provider sync, ambiguous fuzzy matching, selected-recipient notifications, native companion UI, push delivery, realtime presence/location, and offline mutation queues out of this patch.

### Acceptance Criteria

- A personal Sched ICS plan can carry `source_catalog_session_id` pointing to the matching `event_schedule_sessions` row.
- Catalog import does not create personal schedule plans, but it links existing personal plans when source references match.
- Personal Sched sync preserves `source_type = sched_ics` and source references while linking to existing catalog sessions.
- Event drawer catalog rows show linked personal Sched plans as already selected.
- Conflict detection and attendance readback do not double-count a personal plan that is linked to the same catalog session.
- Raw personal and catalog ICS URLs are not stored or returned outside their existing encrypted/secret handling boundary.

### Notes

- This is exact source-reference matching only. Fuzzy matching by title/time/location remains intentionally out of scope.
- The catalog remains the imported/discovery object; schedule plans remain user/workspace intent objects.

### Closeout

- Roadmap slice: `3.4.56 — Event Schedule Catalog-to-Personal Plan Matching`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/41-Personal-Sched-ICS-Sync.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: Docker-first backend/frontend rebuild to `3.4.56`; `/api/health` reported frontend/backend/build `3.4.56`; backend runtime verified `APP_EDITION=platform`, `APP_VERSION=3.4.56`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; generated public compose was booted with `IMAGE_TAG=3.4.56` and verified with `APP_EDITION` unset before the homelab boundary smoke; normal local platform stack was restored and rechecked after homelab verification.
- CI/checks run locally: backend service/routes/smoke/unit syntax checks; `APP_VERSION=3.4.56 docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build backend frontend`; backend unit tests (`231` passed); OpenAPI validation; event catalog ICS import smoke; personal Sched ICS sync smoke; event social planning smoke; Help > Releases smoke for `3.4.56`; targeted Event drawer browser regression (`12` passed); full browser regression (`55` passed, `4` skipped); compose config validation; public export surface validation; init parity; migration rehearsal; platform edition boundary; homelab edition boundary against generated public compose; RBAC regression; Dockerized `npm ci --no-fund --dry-run` lockfile sync checks for backend and frontend; compose generator idempotence by checksum; observability release evidence (`9/9` checks passed); local release preflight; release-evidence secret-hygiene grep; `git diff --check`.
- Release/version artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.56.md`, `backend/release-feed.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md` are aligned on `3.4.56`; the running Help > Releases feed served `3.4.56` as the latest entry.
- Verified facts: migration `89` adds and backfills `event_schedule_plans.source_catalog_session_id` from exact source-reference matches; `init.sql` parity covers the same column, FK, index, and migration seed; personal Sched ICS sync preserves `source_type = sched_ics` while linking two matching catalog sessions in smoke coverage; catalog import remains idempotent and does not create duplicate personal schedule plans; Event drawer catalog controls now recognize linked personal Sched plans as selected catalog rows; raw ICS URLs did not leak in smoke responses or the release-evidence grep.
- Blocked/unverified items: CI `secret-scan` and `image-security-and-sbom` remain CI-only; local preflight compose-smoke secure-cookie checks remain blocked by the development stack using `NODE_ENV=development` and `SESSION_COOKIE_SECURE=false`, while runtime health/version, compose config, and boundary behavior were verified locally; local preflight marks browser regression blocked because that helper does not execute Playwright, but the full browser regression was run separately and passed.
- Files changed: `backend/db/migrations.js`, `init.sql`, `backend/services/schedIcsSync.js`, `backend/routes/events.js`, `backend/openapi/openapi.yaml`, `backend/scripts/event-catalog-ics-import-smoke.js`, `backend/scripts/unit-tests.js`, `frontend/src/components/EventsView.jsx`, version metadata/package files, `docker-compose.yml`, `docs/releases/v3.4.56.md`, `backend/release-feed.json`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/41-Personal-Sched-ICS-Sync.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`, `artifacts/observability-evidence/observability-release-evidence.json`, `preflight-go-no-go.md`.
- Risks or follow-ups: fuzzy matching for catalog/personal rows, recurring catalog sync, provider-specific delta behavior, selected-recipient notifications, friend identity, platform companion native UI, device registration, push delivery, realtime location, presence, and offline mutation queues remain separate future milestones.
- What remains in the milestone: nothing for the catalog-to-personal exact-match slice; rerun CI-only `secret-scan` and `image-security-and-sbom` during the release handoff.
- Recommended commit message: `Release 3.4.56 event schedule catalog-to-personal plan matching`

## 3.4.57 — Event Schedule Selected-Recipient Change Preview

**Goal:** Add a preview-only contract for schedule plan changes so the app can show who would be affected before later notification delivery work exists.

**Current Slice:** `Closed.`

### Scope

- Add a scoped preview endpoint for schedule-plan or catalog-session changes.
- Return the schedule subject, requested status and visibility, eligible people/groups, and overlapping schedule conflicts.
- Make the contract explicitly preview-only: no message persistence, no push delivery, no device registration, and no broadcast send action.
- Add a compact Event drawer action for schedule rows to preview share impact without sending anything.
- Keep real notifications, selected-recipient send workflows, native device registration, push delivery, realtime presence/location, and offline mutation queues out of this patch.

### Acceptance Criteria

- A schedule plan can be previewed with a requested status and visibility.
- Private changes show no recipients.
- Shared visibility previews return scoped Event attendees/groups from existing social planning data.
- Preview responses include conflict readback so users can understand what else may be affected.
- The web drawer can request and display a share preview without sending or saving a message.
- OpenAPI and smoke coverage document that this is a preview-only contract.

### Notes

- This is a notification-adjacent contract slice, not a notification delivery milestone.
- Recipient identity remains Event-local for now; broader friend identity remains separate future work.

### Closeout

- Roadmap slice: `3.4.57 — Event Schedule Selected-Recipient Change Preview`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: Docker platform stack rebuilt/restored with `APP_VERSION=3.4.57`; `/api/health` returned frontend/backend/build `3.4.57`; running backend container reported `APP_EDITION=platform`; generated public homelab compose was also run with `IMAGE_TAG=3.4.57`, no in-container `APP_EDITION`, and healthy `/api/health`.
- CI/checks run: `node --check backend/routes/events.js`, `node --check backend/middleware/validate.js`, `node --check backend/scripts/event-social-planning-smoke.js`, `node --check backend/scripts/unit-tests.js`, container `npm run test:openapi`, container `npm run test:unit`, container `npm run test:init-parity`, container `npm run test:migration-rehearsal`, container `npm run test:help-releases-smoke`, container `npm run test:event-social-planning-smoke`, container `npm run test:event-catalog-ics-import-smoke`, container `npm run test:event-personal-ics-sync-smoke`, container `npm run test:rbac-regression`, container `npm run test:platform-edition-boundary`, generated-compose `npm run test:homelab-edition-boundary`, `docker compose --env-file .env config`, `npm run validate:public-export`, idempotent `npm run compose:generate`, Docker `npm ci --no-fund --dry-run` for backend/frontend, targeted Playwright support-session repair spec, full `npm run test:browser` with 55 passed / 4 skipped, `npm --prefix backend run test:observability-evidence`, `npm --prefix backend run test:release-preflight-local`, secret-hygiene grep of release artifacts, and `git diff --check`.
- Release/version artifacts: app metadata/package versions synced to `3.4.57`; `docs/releases/v3.4.57.md` added; `backend/release-feed.json` regenerated and Help > Releases smoke verified `3.4.57` as latest.
- Verified facts: preview endpoint returns a preview-only contract with delivery disabled; Event drawer can request/display selected-recipient impact without sending; event social smoke covers preview recipient counts; OpenAPI documents the preview request/response; browser regression covers the preview action and no-send language.
- Blocked/unverified items: local secure-cookie compose-smoke remains blocked by development runtime settings (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`); `secret-scan` and `image-security-and-sbom` remain CI-only; stricter CI compose-smoke must still run in GitHub Actions.
- Files changed: version metadata/manifests, generated public compose, event route/validation/OpenAPI contracts, event social smoke/unit coverage, Events drawer UI, Playwright event/support specs, release note/feed, roadmap/backlog/catalog docs, local preflight and observability evidence artifacts.
- Risks/follow-ups: this deliberately does not implement notification delivery, push/device registration, message persistence, realtime friend presence/location, or offline mutation queues; those remain separate future milestones.
- What remains in the milestone: no remaining 3.4.57 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.57 event schedule selected-recipient change preview`

## 3.4.58 — Event Schedule Selected-Recipient Notification Draft/Send Contract

**Goal:** Turn the schedule-change preview contract into an Event-local notification draft/send record so users can intentionally notify selected people or groups without introducing push delivery, device registration, or a broader friend graph.

**Current Slice:** `Closed.`

### Scope

- Add a scoped schedule-change notification endpoint that can create `draft` or `sent` records from a schedule plan or catalog session.
- Persist the schedule subject snapshot, requested status/visibility, selected recipient snapshots, conflicts, message title/body, and delivery limitations.
- Validate selected attendee/group recipients against the scoped Event-local preview recipients.
- Add a compact Event drawer action that can save a notification draft or mark the local notification as sent after previewing impact.
- Keep push/email/device delivery, background delivery workers, realtime presence/location, broad broadcast actions, friend identity expansion, and offline mutation queues out of this patch.

### Acceptance Criteria

- A schedule change preview can be promoted into a draft notification record.
- A selected-recipient notification can be marked `sent` as an Event-local record without external delivery.
- Private changes cannot create recipient fan-out.
- Recipient selections are validated against Event-local attendees/groups and visibility rules.
- The web drawer can create a local sent notification from the preview state with explicit no-push/no-device language.
- OpenAPI and smoke coverage document that this is a local notification contract, not push delivery.

### Notes

- This is the first durable notification record for event schedule changes.
- The selected-recipient model remains Event-local; broader friend identity and native push delivery stay separate future milestones.

### Closeout

- Roadmap slice: `3.4.58 — Event Schedule Selected-Recipient Notification Draft/Send Contract`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: Docker platform stack rebuilt/restored with `APP_VERSION=3.4.58`; `/api/health` returned frontend/backend/build `3.4.58`; running backend container reported `APP_EDITION=platform`; generated public homelab compose was run with `IMAGE_TAG=3.4.58`, no in-container `APP_EDITION`, healthy `/api/health`, and homelab boundary smoke passed.
- CI/checks run: `node --check backend/routes/events.js`, `node --check backend/middleware/validate.js`, `node --check backend/scripts/event-social-planning-smoke.js`, `node --check backend/scripts/unit-tests.js`, local and container OpenAPI validation, local and container backend unit tests (`231` passed), container `test:event-social-planning-smoke`, container `test:event-catalog-ics-import-smoke`, container `test:event-personal-ics-sync-smoke`, container `test:init-parity`, container `test:migration-rehearsal`, container `test:help-releases-smoke`, container `test:platform-edition-boundary`, container `test:homelab-edition-boundary`, container `test:rbac-regression` rerun isolated after a parallel fixture setup collision, targeted Event browser regression (`12` passed), full browser regression (`55` passed / `4` skipped), `docker compose --env-file .env config`, `npm run validate:public-export`, idempotent `npm run compose:generate`, Docker backend/frontend `npm ci --no-fund --dry-run`, `npm --prefix backend run test:observability-evidence`, `npm --prefix backend run test:release-preflight-local`, release artifact secret-hygiene grep, and `git diff --check`.
- Release/version artifacts: app metadata/package versions synced to `3.4.58`; `docs/releases/v3.4.58.md` added with required security triage markers; `backend/release-feed.json` regenerated; running Help > Releases smoke verified `3.4.58` as latest; `artifacts/observability-evidence/observability-release-evidence.json` and `preflight-go-no-go.md` regenerated.
- Verified facts: migration `90` adds `event_schedule_notifications`; `init.sql` parity covers the same table, indexes, trigger, and schema migration seed; `POST /api/events/:id/schedule-notifications` creates draft or sent Event-local notification records from the preview contract; selected attendee/group recipients are validated against scoped Event-local preview recipients; sent records store `sent_at` and explicitly keep external delivery disabled; Event drawer can preview, save draft, and record a local sent notice without push/email/device delivery.
- Blocked/unverified items: local secure-cookie compose-smoke remains blocked by development runtime settings (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`); `secret-scan` and `image-security-and-sbom` remain CI-only; stricter CI compose-smoke must still run in GitHub Actions.
- Files changed: version metadata/manifests, generated public compose, migration/init schema, event route/validation/OpenAPI contracts, event social smoke/unit coverage, Events drawer UI, Playwright Event browser spec, release note/feed, roadmap/backlog/catalog docs, local preflight, and observability evidence artifacts.
- Risks/follow-ups: this records local notification state only; push/device registration, email delivery, broader friend identity, realtime presence/location, notification inbox/read receipts, and offline mutation queues remain future milestones.
- What remains in the milestone: no remaining 3.4.58 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.58 event schedule selected-recipient notification draft and send contract`

## 3.4.59 — Event Schedule Notification History and Readback UI

**Goal:** Make Event-local schedule notification records visible after they are created so draft/sent notices do not feel write-only.

**Current Slice:** `Closed.`

### Scope

- Load existing `event_schedule_notifications` records in the Event social planning drawer.
- Group notification records by schedule plan or catalog session.
- Show a compact notification history block under expanded schedule plan rows with status, timestamp, recipients summary, and message body.
- Keep this readback local/read-only; do not add recipient inboxes, read receipts, push/email/device delivery, or broad friend identity.

### Acceptance Criteria

- Existing draft/sent schedule notification records appear when reopening the Event drawer.
- Newly created draft/sent records are inserted into the row history without requiring a full reload.
- History clearly says records are Event-local and not externally delivered.
- Browser coverage proves schedule notification history is visible after a local send.

### Notes

- This rounds off `3.4.58` by making local notification records visible.
- Full notification inbox/read-state and native push delivery remain future milestones.

### Closeout

- Roadmap slice: `3.4.59 — Event Schedule Notification History and Readback UI`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, and `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: rebuilt and recreated backend/frontend through Docker with `APP_VERSION=3.4.59`; verified `/api/health` reports frontend/backend/build `3.4.59`; verified local platform container env reports `APP_EDITION=platform`; switched to generated public compose and verified homelab boundary with no `APP_EDITION`; restored local platform compose afterward.
- CI/checks run: `node --check` for backend touched scripts/routes, `node backend/scripts/validate-openapi.js`, `node backend/scripts/unit-tests.js`, container `npm run test:openapi`, container `npm run test:unit`, container `npm run test:event-social-planning-smoke` with `BASE_URL=http://backend:3001`, container `npm run test:help-releases-smoke` with `BASE_URL=http://backend:3001`, container `npm run test:init-parity`, container `npm run test:migration-rehearsal`, container `npm run test:rbac-regression`, container `npm run test:platform-edition-boundary`, public-compose `npm run test:homelab-edition-boundary`, `npm run validate:public-export`, `docker compose --env-file .env config`, idempotent `npm run compose:generate`, backend/frontend Linux-container `npm ci --no-fund --dry-run`, `npm --prefix backend run test:observability-evidence`, `npm --prefix backend run test:release-preflight-local`, targeted Playwright Events/Integrations specs, full `npm run test:browser`, `git diff --check`, release-feed version readback, and local grep hygiene over release artifacts.
- Release artifacts: `docs/releases/v3.4.59.md` exists, `backend/release-feed.json` serves `3.4.59` first, `preflight-go-no-go.md` regenerated, and observability evidence regenerated for `3.4.59`.
- Verified facts: persisted schedule notification records now load when the Event drawer opens; expanded schedule plan rows show a compact Event-local notification history with status, timestamp, recipients summary, and message preview; newly saved/sent records update the current row history immediately; the UI copy states these records are local only and not push/device/email delivery.
- Blocked/unverified: local secure-cookie compose-smoke remains blocked by the development stack using `SESSION_COOKIE_SECURE=false`; local `gitleaks` is not installed, so `secret-scan` remains CI-only plus local grep hygiene; `image-security-and-sbom` remains CI-only Trivy/SBOM follow-through.
- Files changed: version metadata/manifests, generated public compose, release note/feed/preflight/observability evidence, Events drawer UI, Event Playwright regression spec, unit source assertions, event schedule catalog docs, roadmap, and backlog.
- Risks/follow-ups: this is still read-only Event-local history; recipient inbox/read receipts, native push, email delivery, friend identity resolution, and offline queued sends remain future milestones.
- What remains in the milestone: no remaining 3.4.59 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.59 event schedule notification history and readback UI`

## 3.4.60 — Event Schedule Notification Inbox and Recipient Readback Contract

**Goal:** Turn Event-local schedule notification records into recipient-readable in-app rows before adding push, email, device delivery, or a broader friend graph.

**Current Slice:** `Closed.`

### Scope

- Add normalized recipient readback rows for sent Event-local schedule notifications.
- Expose a scoped Event-local notification inbox endpoint with unread/read/acknowledged counts.
- Add a scoped endpoint for marking a recipient row read or acknowledged.
- Add a compact Notification inbox section to the Event social planning drawer.
- Keep this local/in-app only; do not add push delivery, email delivery, native device registration, global inboxes, realtime presence, or broad friend identity.

### Acceptance Criteria

- Creating a sent schedule notification creates local recipient readback rows for selected attendees/groups.
- The Event-local notification inbox returns recipient rows, message context, subject snapshots, and readback counts.
- Recipient rows can be marked read or acknowledged.
- The Event drawer shows unread/acknowledged state without implying external delivery.
- OpenAPI, smoke, unit, and browser coverage document the inbox contract and no-delivery boundary.

### Notes

- This is still an Event-local contract. It makes local coordination state visible without claiming that anyone's phone, email, or device has received a notification.
- Future milestones can layer user-linked attendees, native push, email delivery, or friend identity on top of this normalized recipient boundary.

### Closeout

- Roadmap slice: `3.4.60 — Event Schedule Notification Inbox and Recipient Readback Contract`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, and `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: rebuilt and recreated backend/frontend through Docker with `APP_VERSION=3.4.60`; verified `/api/health` reports frontend/backend/build `3.4.60`; verified local platform container env reports `APP_EDITION=platform`; switched to generated public compose and verified homelab boundary with no `APP_EDITION`; restored local platform compose afterward and verified `LOG_EXPORT_SETTINGS_READ_ONLY=false`.
- CI/checks run: backend route/validation/smoke/unit syntax checks; local and container OpenAPI validation; local and container backend unit tests (`231` passed); container `test:event-social-planning-smoke`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:help-releases-smoke`; container `test:rbac-regression`; container `test:platform-edition-boundary`; generated-compose `test:homelab-edition-boundary`; targeted Event browser regression (`12` passed); full browser regression (`55` passed, `4` skipped); `docker compose --env-file .env config`; `npm run validate:public-export`; idempotent `npm run compose:generate`; backend/frontend Linux-container `npm ci --no-fund --dry-run`; `npm --prefix backend run test:observability-evidence`; `npm --prefix backend run test:release-preflight-local`; release artifact secret-hygiene grep; and `git diff --check`.
- Release artifacts: `docs/releases/v3.4.60.md` exists, `backend/release-feed.json` serves `3.4.60` first, `preflight-go-no-go.md` regenerated, and observability evidence regenerated for `3.4.60`.
- Verified facts: migration `91` adds normalized `event_schedule_notification_recipients`; `init.sql` parity covers the same table, indexes, trigger, and migration seed; sent Event-local schedule notifications create attendee/group recipient readback rows; `GET /api/events/:id/schedule-notification-inbox` returns Event-local inbox counts and recipient rows; `PATCH /api/events/:id/schedule-notification-inbox/:recipientId` marks recipient rows read or acknowledged; the Event drawer shows a compact Notification inbox with no-push/no-email/no-device language.
- Blocked/unverified: local secure-cookie compose-smoke remains blocked by the development stack using `SESSION_COOKIE_SECURE=false`; local `gitleaks` is not installed, so `secret-scan` remains CI-only plus local grep hygiene; `image-security-and-sbom` remains CI-only Trivy/SBOM follow-through.
- Files changed: version metadata/manifests, generated public compose, migration/init schema, event route/validation/OpenAPI contracts, event social smoke/unit coverage, Events drawer UI, Playwright Event browser spec, release note/feed, roadmap/backlog/catalog docs, local preflight, and observability evidence artifacts.
- Risks/follow-ups: this is still Event-local readback only; user-linked attendee identity, recipient filtering to “me,” native push, email delivery, global notification inboxes, friend identity resolution, realtime presence/location, and offline queued sends remain future milestones.
- What remains in the milestone: no remaining 3.4.60 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.60 event schedule notification inbox and recipient readback contract`

## 3.4.61 — Event Schedule User-Linked Attendee Identity

**Goal:** Let an Event attendee optionally point at the current app user so local notification readback can distinguish "mine" without adding push, email, device registration, or a global friend graph.

**Current Slice:** `Closed.`

### Scope

- Add optional `event_attendees.user_id` linkage with active per-event duplicate prevention.
- Allow safe self-linking through attendee create/update payloads with `link_current_user`.
- Include linked-user identity and current-user flags in attendee, group member, preview, and notification inbox readbacks.
- Add `recipient=me` filtering to the Event-local notification inbox.
- Add small drawer UI affordances for linking an attendee to the current app user and reading back "Linked to you."

### Acceptance Criteria

- Existing manual attendees remain supported without linked app users.
- A user can create an attendee linked to their app user from the Event drawer.
- Non-admin users cannot link attendees to other app users.
- Duplicate active attendee links for the same event/app user return a friendly conflict.
- Event-local notification inbox readback includes `mine` counts and supports `?recipient=me`.
- OpenAPI, smoke, unit, and browser coverage document the linked-identity contract and the no-delivery/no-global-friend boundary.

### Notes

- This is an event-scoped identity bridge only. It intentionally does not add broad friend identity, push/email/native delivery, device registration, realtime presence, or global notification inbox behavior.
- Linked-user readback exposes app user id/name only; email is not part of the event attendee identity surface.

### Closeout

- Roadmap slice: `3.4.61 — Event Schedule User-Linked Attendee Identity`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, and `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: rebuilt and recreated backend/frontend through Docker with `APP_VERSION=3.4.61`; verified `/api/health` reports frontend/backend/build `3.4.61`; verified local platform container env reports `APP_EDITION=platform`; switched to generated public compose and verified homelab runtime with no `APP_EDITION`; restored local platform compose afterward.
- CI/checks run: backend route/validation/smoke/unit syntax checks; local and container OpenAPI validation; local and container backend unit tests (`231` passed); container `test:event-social-planning-smoke` with linked attendee and `recipient=me`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:help-releases-smoke`; container `test:rbac-regression`; container `test:platform-edition-boundary`; generated-compose `test:homelab-edition-boundary`; targeted Event browser regression (`12` passed); full browser regression (`55` passed, `4` skipped); `docker compose --env-file .env config`; `npm run validate:public-export`; idempotent `npm run compose:generate`; backend/frontend Linux-container `npm ci --no-fund --dry-run`; `npm --prefix backend run test:observability-evidence`; `npm --prefix backend run test:release-preflight-local`; release artifact secret-hygiene grep; and `git diff --check`.
- Release artifacts: `docs/releases/v3.4.61.md` exists, `backend/release-feed.json` serves `3.4.61` first, `preflight-go-no-go.md` regenerated, and observability evidence regenerated for `3.4.61`.
- Verified facts: migration `92` adds optional `event_attendees.user_id` plus active per-event duplicate prevention; `init.sql` parity covers the same column, indexes, and migration seed; attendee create/update accepts safe `link_current_user`; non-admin users cannot link another app user; duplicate active app-user attendee links return `409`; attendee/group/preview/inbox readback includes linked user id/name without email; `GET /api/events/:id/schedule-notification-inbox?recipient=me` filters to current-user linked recipient rows; the Event drawer can link attendees to the current app user and shows `Linked to you` readback.
- Blocked/unverified: local secure-cookie compose-smoke remains blocked by the development stack using `SESSION_COOKIE_SECURE=false`; local `gitleaks` is not installed, so `secret-scan` remains CI-only plus local grep hygiene; `image-security-and-sbom` remains CI-only Trivy/SBOM follow-through.
- Files changed: version metadata/manifests, generated public compose, migration/init schema, event route/validation/OpenAPI contracts, event social smoke/unit coverage, Events drawer UI, Playwright Event browser spec, release note/feed, roadmap/backlog/catalog docs, local preflight, and observability evidence artifacts.
- Risks/follow-ups: this remains Event-local identity only; native device identity, push/email delivery, friend discovery, reciprocal friend relationships, global notification inboxes, realtime presence/location, and offline queued sends remain future milestones.
- What remains in the milestone: no remaining 3.4.61 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.61 event schedule user-linked attendee identity`

## 3.4.62 — Event Schedule My Notifications Filter UI

**Goal:** Let users focus the Event-local Notification inbox on recipient rows linked to their own attendee identity now that `recipient=me` exists.

**Current Slice:** `Closed.`

### Scope

- Add a compact `All` / `Mine` filter to the Event drawer Notification inbox.
- Use the existing `GET /api/events/:id/schedule-notification-inbox?recipient=me` contract when `Mine` is selected.
- Keep the no-push/no-email/no-device language visible.
- Add browser/unit coverage for switching between all recipient rows and current-user linked recipient rows.

### Acceptance Criteria

- Notification inbox defaults to `All` and continues to show all Event-local recipient rows.
- Selecting `Mine` reloads the inbox from `recipient=me`.
- Empty mine-state copy explains that no notifications are linked to the current user yet.
- Browser coverage proves switching `All` / `Mine` changes the visible recipient count.
- No backend delivery, push, email, device registration, global inbox, or friend graph work is introduced.

### Notes

- This is a UI completion slice for the `3.4.61` linked-attendee identity contract.
- Broader friend-aware session cards and native notification delivery remain separate future work.

### Closeout

- Roadmap slice: `3.4.62 — Event Schedule My Notifications Filter UI`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, and `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: rebuilt and recreated backend/frontend through Docker with `APP_VERSION=3.4.62`; verified `/api/health` reports frontend/backend/build `3.4.62`; verified local platform container env reports `APP_EDITION=platform`; switched to generated public compose and verified homelab boundary; restored local platform compose afterward.
- CI/checks run: local and container OpenAPI validation; local and container backend unit tests (`231` passed); container `test:event-social-planning-smoke`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:help-releases-smoke`; container `test:rbac-regression`; container `test:platform-edition-boundary`; generated-compose `test:homelab-edition-boundary`; targeted Event browser regression (`12` passed); full browser regression (`55` passed, `4` skipped); `docker compose --env-file .env config`; `npm run validate:public-export`; idempotent `npm run compose:generate`; backend/frontend Linux-container `npm ci --no-fund --dry-run`; `npm --prefix backend run test:observability-evidence`; `npm --prefix backend run test:release-preflight-local`; release artifact secret-hygiene grep; and `git diff --check`.
- Release artifacts: `docs/releases/v3.4.62.md` exists, `backend/release-feed.json` serves `3.4.62` first, `preflight-go-no-go.md` regenerated, and observability evidence regenerated for `3.4.62`.
- Verified facts: the Event drawer Notification inbox now defaults to `All`; selecting `Mine` reloads the inbox through `GET /api/events/:id/schedule-notification-inbox?recipient=me`; browser coverage verifies the visible recipient count changes from all recipient rows to current-user linked rows and back; no backend delivery, push, email, device registration, global inbox, or friend graph work was introduced.
- Blocked/unverified: local secure-cookie compose-smoke remains blocked by the development stack using `SESSION_COOKIE_SECURE=false`; local `gitleaks` is not installed, so `secret-scan` remains CI-only plus local grep hygiene; `image-security-and-sbom` remains CI-only Trivy/SBOM follow-through.
- Files changed: version metadata/manifests, generated public compose, release note/feed, Events drawer UI, Event browser regression spec, unit source assertions, roadmap/backlog/catalog docs, local preflight, and observability evidence artifacts.
- Risks/follow-ups: this is still Event-local readback only; friend-aware session card attendance, reciprocal friend identity, native device identity, push/email delivery, global notification inboxes, realtime presence/location, and offline queued sends remain future milestones.
- What remains in the milestone: no remaining 3.4.62 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.62 event schedule my notifications filter UI`

## 3.4.63 — Event Schedule Shared Attendance on Session Cards

**Goal:** Make shared session attendance visible directly on Event schedule cards instead of requiring users to expand rows or infer meaning from the shared-attendance filter.

**Current Slice:** `Closed.`

### Scope

- Reuse the existing Event-local attendance readback model.
- Show compact shared-attendance context on Now/Next, catalog session rows, and personal schedule rows.
- Prefer visibility-safe attendee/group names when available.
- Fall back to the existing shared status count when the Event does not have attendee/group names to display.
- Keep this separate from push notifications, native device delivery, reciprocal friend graphs, realtime presence, and global inbox work.

### Acceptance Criteria

- Session cards show who a shared plan is visible to when attendee/group context exists.
- Session cards retain the existing count-based shared readback when no attendee/group context exists.
- Personal schedule rows update shared-attendance readback immediately when the draft visibility changes.
- Browser coverage verifies shared-attendance names appear on a schedule card.
- No backend notification delivery, push, email, native device registration, global inbox, or friend graph work is introduced.

### Notes

- This is a UI/readback completion slice for the `3.4.52` attendance readback and `3.4.61` linked-attendee identity work.

### Closeout

- Roadmap slice: `3.4.63 — Event Schedule Shared Attendance on Session Cards`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/06-Versioning-and-Build-Metadata.md`, and `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: rebuilt and recreated backend/frontend through Docker with `APP_VERSION=3.4.63`; verified `/api/health` reports frontend/backend/build `3.4.63`; verified local platform container env reports `APP_EDITION=platform`; switched to generated public compose and verified homelab boundary with no `APP_EDITION`; restored local platform compose afterward.
- CI/checks run: local and container OpenAPI validation; local and container backend unit tests (`231` passed); container `test:event-social-planning-smoke`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:help-releases-smoke`; container `test:rbac-regression`; container `test:platform-edition-boundary`; generated-compose `test:homelab-edition-boundary`; targeted Event browser regression (`12` passed); full browser regression (`55` passed, `4` skipped); `docker compose --env-file .env config`; `npm run validate:public-export`; idempotent `npm run compose:generate`; backend/frontend Linux-container `npm ci --no-fund --dry-run`; `npm --prefix backend run test:observability-evidence`; `npm --prefix backend run test:release-preflight-local`; release artifact secret-hygiene grep; and `git diff --check`.
- Release artifacts: `docs/releases/v3.4.63.md` exists, `backend/release-feed.json` serves `3.4.63` first, `preflight-go-no-go.md` regenerated, and observability evidence regenerated for `3.4.63`.
- Verified facts: Now/Next, catalog session, and personal schedule rows show compact shared-attendance context when a shared plan has visible Event attendee/group data; personal schedule rows prefer Event attendee display names over linked account names; rows fall back to the existing `Shared: <status counts>` text when no attendee/group names exist; changing draft schedule visibility updates the shared-attendance readback before save; no backend delivery, push, email, device registration, global inbox, reciprocal friend graph, or realtime presence work was introduced.
- Blocked/unverified: local secure-cookie compose-smoke remains blocked by the development stack using `SESSION_COOKIE_SECURE=false`; local `gitleaks` is not installed, so `secret-scan` remains CI-only plus local grep hygiene; `image-security-and-sbom` remains CI-only Trivy/SBOM follow-through.
- Files changed: version metadata/manifests, generated public compose, release note/feed, Events drawer UI, Event browser regression spec, unit source assertions, roadmap/backlog/catalog docs, local preflight, and observability evidence artifacts.
- Risks/follow-ups: shared-attendance card readback still derives from Event-local visibility and attendee/group records; true reciprocal friend attendance, selected-recipient device delivery, push/email sends, global notification inboxes, realtime presence/location, and offline queued sends remain future milestones.
- What remains in the milestone: no remaining 3.4.63 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.63 event schedule shared attendance on session cards`

## 3.4.64 — Event Schedule Join Leave Replace Actions

**Goal:** Make day-of schedule changes easier to express from session cards by adding explicit join, leave, backup, and replace intent actions on top of the existing plan-state, conflict, and selected-recipient notification contracts.

**Current Slice:** `Closed.`

### Scope

- Add compact intent actions for catalog session cards:
  - `Join`
  - `Leave`
  - `Backup`
  - `Replace with this` when conflicts exist
- Keep the existing plan-state select for precise/manual editing.
- Reuse existing conflict resolution behavior instead of adding a new conflict data model.
- Add matching quick intent controls to expanded personal schedule rows.
- Keep selected-recipient preview/send behavior in the existing Event-local notification flow.
- Keep push/email/native device delivery, reciprocal friend graphs, global inboxes, and realtime presence out of scope.

### Acceptance Criteria

- A user can join a catalog session from a session card without opening a full edit flow.
- A user can leave/drop a planned catalog session from a session card.
- A user can mark a catalog session as backup from a session card.
- A user can choose a replace action for a conflicting catalog session and move conflicting plans to backup through the existing conflict update path.
- Expanded personal schedule rows expose the same intent language for quick draft status changes before save/preview.
- Browser coverage verifies join, leave, backup, and replace actions from the Event drawer.

### Notes

- This is the first patch-sized slice from `Friend-Aware Session Changes and Notifications`.
- The notification behavior remains Event-local recordkeeping/readback only.

### Closeout

- Roadmap slice: `3.4.64 — Event Schedule Join Leave Replace Actions`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, and `/Users/hamlin/.codex/skills/uncodixfy/SKILL.md`.
- Runtime verification used: rebuilt and recreated backend/frontend through Docker with `APP_VERSION=3.4.64`; verified `/api/health` reports frontend/backend/build `3.4.64`; verified local platform container env reports `APP_EDITION=platform`; switched to generated public compose and verified homelab boundary with no `APP_EDITION`; restored local platform compose afterward.
- CI/checks run: local unit source assertions, backend unit tests, OpenAPI validation, init parity, migration rehearsal, event social planning smoke, targeted Event browser regression, full browser regression, RBAC regression, platform edition boundary, homelab edition boundary, public-export validation, generated-compose config/idempotence, Linux `npm ci --dry-run` dependency checks for backend/frontend, observability evidence, release preflight, secret-hygiene grep, and `git diff --check`.
- Release artifacts: `docs/releases/v3.4.64.md` exists, `backend/release-feed.json` serves `3.4.64` first, `preflight-go-no-go.md` regenerated, and observability evidence regenerated for `3.4.64`.
- Verified facts: catalog session cards now expose `Join`, `Leave`, `Backup`, and conflict-aware `Replace with this` intent actions; replace reuses the existing conflict update path to mark the chosen session planned and move conflicts to backup; expanded personal schedule rows expose matching draft intent language before save/preview; selected-recipient notification contracts remain unchanged.
- Blocked/unverified items: CI-only `secret-scan` and `image-security-and-sbom` must still run in GitHub Actions; local release preflight marks CI secure-cookie `compose-smoke` conditions blocked because the local development stack intentionally runs with `SESSION_COOKIE_SECURE=false`.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.64.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/app-meta.json`, `frontend/src/components/EventsView.jsx`, and `tests/playwright/specs/events-collectibles.browser.spec.js`.
- Risks or follow-ups: native push/email delivery, reciprocal friend graphs, global inboxes, and realtime presence remain future platform/mobile work; the personal schedule-row shortcuts intentionally remain draft controls until save/preview.
- What remains in the milestone: no remaining 3.4.64 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.64 event schedule join leave replace actions`

## 3.4.65 — Event Schedule Change Notification Templates

**Goal:** Seed selected-recipient Event-local notification drafts with action-aware message templates so join, leave, backup, and replace changes have useful default language without becoming push/email/broadcast delivery.

**Current Slice:** `Closed.`

### Scope

- Add a backend-owned `message_intent` template hint for schedule change previews and notification records.
- Support template intents for:
  - `join`
  - `leave`
  - `replace`
  - `backup`
  - `status_update`
- Keep notification records Event-local and selected-recipient-only.
- Show suggested template copy in the schedule change preview.
- Persist the selected template body when saving drafts or sending local notices.
- Keep native push, email, global inbox, friend graph, and realtime delivery out of scope.

### Acceptance Criteria

- Previewing a join action suggests "Anyone want to join me for..."
- Previewing a leave action suggests "I'm dropping..."
- Previewing a replace action suggests "I'm switching to..."
- Previewing a backup action suggests "I'm keeping ... as backup."
- Sending or saving a local notice persists the selected template body.
- Browser coverage verifies at least one action-template preview and sent local-notice readback.

### Notes

- This is a follow-up to `3.4.64` and remains inside the existing `event-schedule-notification.v1` local record contract.

### Closeout

- Roadmap slice: `3.4.65 — Event Schedule Change Notification Templates`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, and `/Users/hamlin/.codex/skills/uncodixfy/SKILL.md`.
- Runtime verification used: rebuilt and recreated backend/frontend through Docker with `APP_VERSION=3.4.65`; verified `/api/health` reports frontend/backend/build `3.4.65`; verified local platform container env reports `APP_EDITION=platform`; switched to generated public compose and verified homelab boundary with no `APP_EDITION`; restored local platform compose afterward.
- CI/checks run: backend route/validation/unit syntax checks, local and container backend unit tests, local and container OpenAPI validation, init parity, migration rehearsal, event social planning smoke, Help > Releases smoke, targeted Event browser regression, full browser regression, RBAC regression, platform edition boundary, homelab edition boundary, public-export validation, generated-compose config/idempotence, Linux `npm ci --dry-run` dependency checks for backend/frontend, observability evidence, release preflight, secret-hygiene grep, and `git diff --check`.
- Release artifacts: `docs/releases/v3.4.65.md` exists, `backend/release-feed.json` serves `3.4.65` first, `preflight-go-no-go.md` regenerated, and observability evidence regenerated for `3.4.65`.
- Verified facts: schedule change previews and notification create requests now accept backend-validated `message_intent`; preview responses include intent-aware message templates; expanded schedule-row quick actions seed matching local-notice templates; sent/draft Event-local notifications persist the selected template body; browser coverage verifies backup-template preview, notification record readback, history readback, and inbox readback.
- Blocked/unverified items: CI-only `secret-scan` and `image-security-and-sbom` must still run in GitHub Actions; local release preflight marks CI secure-cookie `compose-smoke` conditions blocked because the local development stack intentionally runs with `SESSION_COOKIE_SECURE=false`.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `backend/middleware/validate.js`, `backend/openapi/openapi.yaml`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/routes/events.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.65.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/app-meta.json`, `frontend/src/components/EventsView.jsx`, and `tests/playwright/specs/events-collectibles.browser.spec.js`.
- Risks or follow-ups: templates remain default copy only and are not a push/email/native delivery path; catalog-card actions still update plan state directly while schedule-row preview/send remains the explicit selected-recipient notification step.
- What remains in the milestone: no remaining 3.4.65 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.65 event schedule change notification templates`

## 3.4.66 — Event Schedule Template Picker and Message Edit UI

**Goal:** Let users choose and lightly edit the Event-local schedule notification message before saving a draft or sending a local notice.

**Current Slice:** `Closed.`

### Scope

- Add a compact template picker to the schedule notification preview/send area.
- Support quick template choices for joining, switching, meeting outside the room, dropping, backup, and general status updates.
- Add an editable message textarea seeded from the selected template.
- Persist edited message text through the existing `message_body` notification field.
- Keep recipient selection tied to the existing preview; no broadcast defaults.
- Keep push, email, native device delivery, global inboxes, and realtime social features out of scope.

### Acceptance Criteria

- A user can preview a schedule change and then choose a different message template.
- A user can edit the message before saving or sending the Event-local notice.
- The sent/draft notification record shows the edited message body.
- The Event-local inbox readback shows the edited message body.
- Browser coverage verifies template selection and message edit readback.

### Notes

- This remains a web UI/editor layer over the `event-schedule-notification.v1` local record contract.

### Closeout

- Roadmap slice: `3.4.66 — Event Schedule Template Picker and Message Edit UI`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, and `/Users/hamlin/.codex/skills/uncodixfy/SKILL.md`.
- Runtime verification used: rebuilt and recreated backend/frontend through Docker with `APP_VERSION=3.4.66`; verified `/api/health` reports frontend/backend/build `3.4.66`; verified local platform container env reports `APP_EDITION=platform`; switched to generated public compose and verified homelab boundary with no `APP_EDITION`; restored local platform compose afterward.
- CI/checks run: backend route/validation/unit syntax checks, local and container backend unit tests, local and container OpenAPI validation, init parity, migration rehearsal, event social planning smoke, Help > Releases smoke, targeted Event browser regression, full browser regression, RBAC regression, platform edition boundary, homelab edition boundary, public-export validation, generated-compose config/idempotence, Linux `npm ci --dry-run` dependency checks for backend/frontend, observability evidence, release preflight, secret-hygiene grep, and `git diff --check`.
- Release artifacts: `docs/releases/v3.4.66.md` exists, `backend/release-feed.json` serves `3.4.66` first, `preflight-go-no-go.md` regenerated, and observability evidence regenerated for `3.4.66`.
- Verified facts: schedule notification previews now show a compact template/message composer; users can choose join, switch, meet outside, drop, backup, or status-update templates; edited message text is sent through the existing `message_body` field; backend validation/OpenAPI now include the `meet` template intent; Event browser coverage verifies template selection, custom message send, notification record readback, and inbox readback.
- Blocked/unverified items: CI-only `secret-scan` and `image-security-and-sbom` must still run in GitHub Actions; local release preflight marks CI secure-cookie `compose-smoke` conditions blocked because the local development stack intentionally runs with `SESSION_COOKIE_SECURE=false`.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `backend/middleware/validate.js`, `backend/openapi/openapi.yaml`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/routes/events.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.66.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/app-meta.json`, `frontend/src/components/EventsView.jsx`, and `tests/playwright/specs/events-collectibles.browser.spec.js`.
- Risks or follow-ups: this is still Event-local message editing only, not push/email/native delivery; recipient selection remains the existing preview-derived selected-recipient behavior.
- What remains in the milestone: no remaining 3.4.66 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.66 event schedule template picker and message edit UI`

## 3.4.67 — Event Schedule Recipient Selection UI Polish

**Goal:** Make selected-recipient Event-local schedule notices explicit by letting users review and trim eligible people/groups before saving a draft or recording a local notice.

**Current Slice:** `Closed.`

### Scope

- Add a compact recipient selector to the schedule notification composer after a share preview exists.
- Seed selected people/groups from the existing preview-derived recipient list.
- Allow users to uncheck eligible people or groups before saving a draft or sending a local notice.
- Send selected recipients through the existing `recipient_attendee_ids` and `recipient_group_ids` request fields.
- Keep private changes unsendable and keep zero-recipient notices disabled.
- Keep push, email, native device delivery, global inboxes, friend graphs, and realtime social features out of scope.

### Acceptance Criteria

- A user can preview a schedule change and see the eligible people/groups who would be recorded as recipients.
- A user can remove one or more eligible recipients before saving/sending the Event-local notice.
- The Event-local notification inbox reflects only the selected recipients.
- Browser coverage verifies recipient selection and trimmed inbox readback.

### Notes

- This remains a web UI layer over the existing `event-schedule-notification.v1` local record contract.

### Closeout

- Roadmap slice: `3.4.67 — Event Schedule Recipient Selection UI Polish`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, and `/Users/hamlin/.codex/skills/uncodixfy/SKILL.md`.
- Runtime verification used: rebuilt and recreated backend/frontend through Docker with `APP_VERSION=3.4.67`; verified `/api/health` reports frontend/backend/build `3.4.67`; verified local platform container env reports `APP_EDITION=platform`; switched to generated public compose and verified homelab boundary with no `APP_EDITION`; restored local platform compose afterward.
- CI/checks run locally: local backend unit/source contract tests; local OpenAPI validation; container backend unit tests; container OpenAPI validation; event social planning smoke; Help > Releases smoke; init parity; migration rehearsal; RBAC regression; platform edition boundary; homelab edition boundary; targeted Event browser regression (`12 passed`); full browser regression (`55 passed`, `4 skipped`); public-export validation; generated-compose config validation; backend and frontend `npm ci --dry-run` dependency checks; observability release evidence; release preflight; generated-artifact secret-pattern grep; and `git diff --check`.
- Release artifacts: `docs/releases/v3.4.67.md` exists, `backend/release-feed.json` serves `3.4.67` first, `preflight-go-no-go.md` regenerated, and observability evidence regenerated for `3.4.67`.
- Verified facts: schedule notification previews now expose a compact recipient selector; eligible people/groups default selected from preview; users can uncheck a person or group before saving/sending; the UI disables send when private or when no recipients remain selected; sent Event-local notification records use the selected `recipient_attendee_ids` and `recipient_group_ids`; Event browser coverage verifies trimming a group recipient and reading back only the selected recipient in the inbox.
- Blocked/unverified items: CI-only `secret-scan` and `image-security-and-sbom` must still run in GitHub Actions; local release preflight marks CI secure-cookie `compose-smoke` conditions blocked because the local development stack intentionally runs with `SESSION_COOKIE_SECURE=false`.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.67.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/app-meta.json`, `frontend/src/components/EventsView.jsx`, `preflight-go-no-go.md`, `artifacts/observability-evidence/observability-release-evidence.json`, and `tests/playwright/specs/events-collectibles.browser.spec.js`.
- Risks or follow-ups: this is still Event-local selected-recipient recordkeeping only, not push/email/native delivery, global inboxes, realtime presence, or friend graph work.
- What remains in the milestone: no remaining 3.4.67 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.67 event schedule recipient selection UI polish`

## 3.4.68 — Event Schedule Notification Draft Management UI

**Goal:** Make Event-local schedule notification drafts usable after they are saved by letting users edit, send, or discard drafts from the Event drawer.

**Current Slice:** `Closed.`

### Scope

- Add draft-only update and discard endpoints for Event-local schedule notifications.
- Keep draft updates inside the existing selected-recipient notification contract.
- Add `Edit draft`, `Send draft`, and `Discard draft` actions to the schedule notification history UI.
- Rehydrate the composer from a saved draft, including message text and selected recipients.
- Keep sent notifications immutable from this UI.
- Keep push, email, native device delivery, global inboxes, friend graphs, and realtime social features out of scope.

### Acceptance Criteria

- A user can save a draft, reopen it for editing, update its message/recipients, and send the same draft record.
- A user can discard a saved draft without affecting sent notification history.
- Sent draft records create the same Event-local recipient readback rows as direct sends.
- Browser coverage verifies draft edit/send readback.

### Notes

- This remains Event-local record management only, not delivery.

### Closeout

- Roadmap slice: `3.4.68 — Event Schedule Notification Draft Management UI`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, and `/Users/hamlin/.codex/skills/uncodixfy/SKILL.md`.
- Runtime verification used: rebuilt and recreated backend/frontend through Docker with `APP_VERSION=3.4.68`; verified `/api/health` reports frontend/backend/build `3.4.68`; verified local platform container env reports `APP_EDITION=platform`; switched to generated public compose and verified homelab boundary with no `APP_EDITION`; restored local platform compose afterward.
- CI/checks run locally: backend route/unit/browser-test syntax checks; local backend unit/source contract tests; local OpenAPI validation; container backend unit tests; container OpenAPI validation; event social planning smoke; Help > Releases smoke; init parity; migration rehearsal; RBAC regression; platform edition boundary; homelab edition boundary; targeted Event browser regression (`12 passed` after fixing recipient-row reactivation); full browser regression (`55 passed`, `4 skipped`); public-export validation; generated-compose config validation and idempotence check; backend and frontend `npm ci --dry-run` dependency checks; observability release evidence; release preflight; generated-artifact secret-pattern grep; and `git diff --check`.
- Release artifacts: `docs/releases/v3.4.68.md` exists, `backend/release-feed.json` serves `3.4.68` first, `preflight-go-no-go.md` regenerated, and observability evidence regenerated for `3.4.68`.
- Verified facts: saved schedule notification drafts now expose `Edit draft`, `Send draft`, and `Discard draft` actions; draft edit rehydrates the composer with saved message and selected recipients; updating a draft preserves the same notification record; sending a draft creates active Event-local recipient readback rows; sent records remain immutable from the draft-management UI; browser coverage verifies draft edit, update, send, notification history, and inbox readback.
- Blocked/unverified items: CI-only `secret-scan` and `image-security-and-sbom` must still run in GitHub Actions; local release preflight marks CI secure-cookie `compose-smoke` conditions blocked because the local development stack intentionally runs with `SESSION_COOKIE_SECURE=false`.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `backend/openapi/openapi.yaml`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/routes/events.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.68.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/app-meta.json`, `frontend/src/components/EventsView.jsx`, `preflight-go-no-go.md`, `artifacts/observability-evidence/observability-release-evidence.json`, and `tests/playwright/specs/events-collectibles.browser.spec.js`.
- Risks or follow-ups: this remains Event-local draft management only, not push/email/native delivery, global inboxes, realtime presence, or friend graph work; discard is intentionally draft-only.
- What remains in the milestone: no remaining 3.4.68 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.68 event schedule notification draft management UI`

## 3.4.69 — Event Schedule Notification Delivery Boundary Platform Contract

**Goal:** Give web and platform/native clients a stable Event-local delivery boundary for schedule notifications so future clients do not mistake local notification records for push, email, device, realtime, or global inbox delivery.

**Current Slice:** `Closed.`

### Scope

- Add a versioned Event-scoped delivery-boundary endpoint for schedule notifications.
- Document the supported `event_local` record/readback channel.
- Explicitly list unsupported push, email, device registration, realtime fanout, global inbox, and broadcast behavior.
- Keep existing draft/send/readback endpoints unchanged except for contract discoverability.
- Surface the local-only boundary in the Event drawer notification inbox.
- Keep provider-backed delivery, device registration, native push, email, and global notification inboxes out of scope.

### Acceptance Criteria

- Platform/native clients can fetch a stable contract before offering notification delivery affordances.
- The contract reports local records and recipient readback as supported.
- The contract reports external delivery and device/provider channels as unsupported.
- OpenAPI and smoke coverage prove the endpoint and boundary values.
- The web Event drawer communicates that schedule notices are local event records only.

### Notes

- This milestone does not implement external notification delivery. It defines the current product boundary and keeps future provider work from leaking into the current UI/API contract.

### Closeout

- Roadmap slice: `3.4.69 — Event Schedule Notification Delivery Boundary Platform Contract`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`, and `/Users/hamlin/.codex/skills/uncodixfy/SKILL.md`.
- Runtime verification used: rebuilt and recreated backend/frontend through Docker with `APP_VERSION=3.4.69`; verified `/api/health` reports frontend/backend/build `3.4.69`; verified local platform container env reports `APP_EDITION=platform`; switched to generated public compose and verified homelab boundary with no `APP_EDITION`; restored local platform compose afterward.
- CI/checks run locally: backend route/smoke/unit syntax checks; local backend unit/source contract tests; local OpenAPI validation; container backend unit tests; container OpenAPI validation; event social planning smoke; Help > Releases smoke; init parity; migration rehearsal; RBAC regression; platform edition boundary; homelab edition boundary; full browser regression (`55 passed`, `4 skipped`); public-export validation; generated-compose config validation and idempotence check; backend and frontend `npm ci --dry-run` dependency checks; observability release evidence; release preflight; generated-artifact secret-pattern grep; and `git diff --check`.
- Release artifacts: `docs/releases/v3.4.69.md` exists, `backend/release-feed.json` serves `v3.4.69` first, `preflight-go-no-go.md` regenerated, and observability evidence regenerated for `3.4.69`.
- Verified facts: `GET /api/events/:id/schedule-notification-delivery-boundary` returns contract version `event-schedule-notification-delivery-boundary.v1`; it reports `event_local` records/readback as supported; it reports push, email, device, global inbox, realtime, and broadcast channels as unsupported; the Event drawer notification inbox now reads back the local-only boundary; OpenAPI and event social smoke prove the endpoint and values from the running stack.
- Blocked/unverified items: CI-only `secret-scan` and `image-security-and-sbom` must still run in GitHub Actions; local release preflight marks CI secure-cookie `compose-smoke` conditions blocked because the local development stack intentionally runs with `SESSION_COOKIE_SECURE=false`.
- Files changed: `app-meta.json`, `artifacts/observability-evidence/observability-release-evidence.json`, `backend/app-meta.json`, `backend/openapi/openapi.yaml`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/routes/events.js`, `backend/scripts/event-social-planning-smoke.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.69.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/app-meta.json`, `frontend/src/components/EventsView.jsx`, and `preflight-go-no-go.md`.
- Risks or follow-ups: this remains a delivery boundary only; provider-backed push, email, device registration, global notification inboxes, realtime fanout, and native offline mutation queues remain future work.
- What remains in the milestone: no remaining 3.4.69 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.69 event schedule notification delivery boundary platform contract`

## 3.4.70 — Event Schedule Notification Delivery Provider Prep

**Goal:** Prepare the schedule-notification delivery contract for future provider-backed delivery without enabling push, email, native device delivery, delivery attempts, or global inbox behavior.

**Current Slice:** `Closed.`

### Scope

- Extend the existing Event schedule notification delivery boundary with provider-prep metadata.
- Keep `event_local` as the only active provider.
- List future provider slots such as `push`, `email`, and `platform_device` as disabled descriptors with clear reasons.
- Report that external delivery attempts, delivery attempt readback, device registration endpoints, and provider configuration are not available.
- Update OpenAPI, smoke coverage, and platform companion docs so native clients can hide unavailable delivery controls.
- Do not add provider settings, delivery queues, delivery attempt tables, push/email delivery, or device registration.

### Acceptance Criteria

- The delivery boundary reports provider contract version `event-schedule-notification-provider-prep.v1`.
- The provider contract reports `active_provider = event_local`.
- Push, email, and platform-device providers are discoverable but disabled.
- The contract reports no external delivery attempts and no delivery attempt endpoint.
- Event social smoke and OpenAPI validation prove the provider-prep fields.

### Notes

- This is a contract-prep patch only. Real provider configuration and delivery execution remain future milestones.

### Closeout

- Roadmap slice: `3.4.70 — Event Schedule Notification Delivery Provider Prep`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`, and `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: rebuilt and recreated backend/frontend through Docker with `APP_VERSION=3.4.70`; verified `/api/health` reports frontend/backend/build `3.4.70`; verified local platform container env reports `APP_EDITION=platform`; switched to generated public compose and verified homelab boundary with no `APP_EDITION`; restored local platform compose afterward.
- CI/checks run locally: backend route/smoke/unit syntax checks; local backend unit/source contract tests; local OpenAPI validation; container backend unit tests; container OpenAPI validation; event social planning smoke; Help > Releases smoke; init parity; migration rehearsal; RBAC regression; platform edition boundary; homelab edition boundary; full browser regression (`55 passed`, `4 skipped`); public-export validation; generated-compose config validation and idempotence check; backend and frontend `npm ci --dry-run` dependency checks; observability release evidence; release preflight; generated-artifact secret-pattern grep; and `git diff --check`.
- Release artifacts: `docs/releases/v3.4.70.md` exists, `backend/release-feed.json` serves `v3.4.70` first, `preflight-go-no-go.md` regenerated, and observability evidence regenerated for `3.4.70`.
- Verified facts: the schedule notification delivery boundary now includes provider contract version `event-schedule-notification-provider-prep.v1`; `event_local` is the active provider; `push`, `email`, and `platform_device` providers are discoverable but disabled; external delivery attempts, delivery attempt readback, provider configuration, and device registration endpoints remain unavailable; OpenAPI and event social smoke prove the provider-prep fields from the running stack.
- Blocked/unverified items: CI-only `secret-scan` and `image-security-and-sbom` must still run in GitHub Actions; local release preflight marks CI secure-cookie `compose-smoke` conditions blocked because the local development stack intentionally runs with `SESSION_COOKIE_SECURE=false`; the preflight helper also marks browser regression blocked even though full browser regression was run separately and passed locally.
- Files changed: `app-meta.json`, `artifacts/observability-evidence/observability-release-evidence.json`, `backend/app-meta.json`, `backend/openapi/openapi.yaml`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/routes/events.js`, `backend/scripts/event-social-planning-smoke.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.70.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/app-meta.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: this remains provider-prep metadata only; real provider settings, delivery queues, delivery attempt records, push/email delivery, native device registration, and global notification inboxes remain future milestones.
- What remains in the milestone: no remaining 3.4.70 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.70 event schedule notification delivery provider prep`

## 3.4.71 — Event Schedule Delivery Attempt Model Design

**Goal:** Define the future delivery-attempt audit model for Event schedule notifications without creating attempt records or enabling provider-backed delivery.

**Current Slice:** `Closed.`

### Scope

- Extend the existing delivery boundary with a versioned delivery-attempt model contract.
- Keep delivery attempts unsupported and uncreated while all external providers remain disabled.
- Define the future relationship as one attempt per notification-recipient-provider when delivery providers are enabled.
- Document future attempt fields such as provider, channel, status, attempted/completed timestamps, retry metadata, provider message id, and provider error details.
- Update OpenAPI, smoke coverage, and platform companion docs so native clients can understand the future audit shape without reading attempts today.
- Do not add database tables, delivery attempt endpoints, delivery queues, provider settings, push/email delivery, or device registration.

### Acceptance Criteria

- The delivery boundary reports attempt model version `event-schedule-notification-delivery-attempt-model.v1`.
- The attempt model reports `supported = false` and `creates_records = false`.
- The attempt model documents provider/channel/status/timestamp/retry/provider-message/error fields.
- Event social smoke and OpenAPI validation prove the attempt-model fields.
- Runtime send behavior remains Event-local record/readback only.

### Notes

- This is a model-design patch only. Delivery attempt persistence and readback remain future milestones.

### Closeout

- Roadmap slice: `3.4.71 — Event Schedule Delivery Attempt Model Design`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`, and `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: rebuilt and recreated backend/frontend through Docker with `APP_VERSION=3.4.71`; verified `/api/health` reports frontend/backend/build `3.4.71`; verified local platform container env reports `APP_EDITION=platform`; switched to generated public compose and verified homelab boundary with no `APP_EDITION`; restored local platform compose afterward.
- CI/checks run locally: backend route/smoke/unit syntax checks; local backend unit/source contract tests; local OpenAPI validation; container backend unit tests; container OpenAPI validation; event social planning smoke; Help > Releases smoke; init parity; migration rehearsal; RBAC regression; platform edition boundary; homelab edition boundary; full browser regression (`55 passed`, `4 skipped`); public-export validation; generated-compose config validation and idempotence check; backend and frontend `npm ci --dry-run` dependency checks; observability release evidence; release preflight; generated-artifact secret-pattern grep; and `git diff --check`.
- Release artifacts: `docs/releases/v3.4.71.md` exists, `backend/release-feed.json` serves `v3.4.71` first, `preflight-go-no-go.md` regenerated, and observability evidence regenerated for `3.4.71`.
- Verified facts: the schedule notification delivery boundary now includes attempt model version `event-schedule-notification-delivery-attempt-model.v1`; the model reports `supported = false` and `creates_records = false`; it documents the future one-attempt-per-notification-recipient-provider relationship plus provider/channel/status/timestamp/retry/provider-message/error fields; runtime sends remain Event-local records and recipient readback only.
- Blocked/unverified items: CI-only `secret-scan` and `image-security-and-sbom` must still run in GitHub Actions; local release preflight marks CI secure-cookie `compose-smoke` conditions blocked because the local development stack intentionally runs with `SESSION_COOKIE_SECURE=false`; the preflight helper also marks browser regression blocked even though full browser regression was run separately and passed locally.
- Files changed: `app-meta.json`, `artifacts/observability-evidence/observability-release-evidence.json`, `backend/app-meta.json`, `backend/openapi/openapi.yaml`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/routes/events.js`, `backend/scripts/event-social-planning-smoke.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.71.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/app-meta.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: this remains model design only; delivery-attempt persistence, readback endpoints, provider queues, provider settings, push/email delivery, native device registration, and global notification inboxes remain future milestones.
- What remains in the milestone: no remaining 3.4.71 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.71 event schedule delivery attempt model design`

## 3.4.72 — Event Schedule Delivery Attempt Persistence and Readback

**Goal:** Persist and read back Event-local schedule notification delivery-attempt audit rows without enabling push, email, native device delivery, or external providers.

**Current Slice:** `Closed.`

### Scope

- Add a normalized `event_schedule_notification_delivery_attempts` table.
- Create one `event_local` delivery-attempt audit row per selected recipient when a schedule notification is locally sent.
- Backfill local attempt rows for existing sent Event schedule notifications.
- Add scoped delivery-attempt readback for Event notification history and platform/native planning.
- Include delivery-attempt summaries on schedule notification records.
- Keep push, email, platform-device, realtime, global inbox, and provider-backed delivery disabled.

### Acceptance Criteria

- Sent Event-local schedule notifications create delivery-attempt rows for each recipient.
- Draft notifications do not create delivery-attempt rows until sent.
- Notification list readback includes delivery-attempt counts by status.
- A scoped readback endpoint returns attempt rows filtered by notification when requested.
- OpenAPI, init parity, migration rehearsal, and event social smoke prove the persistence/readback path.
- Provider-boundary responses still report no external delivery and no push/email/device delivery.

### Notes

- This is audit persistence, not external delivery. `event_local` attempts mean "recorded locally for selected recipients," not delivered to a device or provider.

### Closeout

- Roadmap slice: `3.4.72 — Event Schedule Delivery Attempt Persistence and Readback`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`, and `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: rebuilt and recreated backend/frontend through Docker with `APP_VERSION=3.4.72`; verified `/api/health` reports frontend/backend/build `3.4.72`; verified migration `93` applied in the running backend logs; verified local platform container env reports `APP_EDITION=platform`; switched to generated public compose with local `3.4.72` image tags and verified homelab boundary with no `APP_EDITION`; restored local platform compose afterward.
- CI/checks run locally: backend route/smoke/unit syntax checks; local backend unit/source contract tests; local OpenAPI validation; container backend unit tests; container OpenAPI validation; event social planning smoke with in-stack `BASE_URL`; Help > Releases smoke; init parity; migration rehearsal; RBAC regression; platform edition boundary; homelab edition boundary; full browser regression (`55 passed`, `4 skipped`); public-export validation; generated-compose config validation and idempotence check; backend and frontend `npm ci --dry-run` dependency checks; observability release evidence; release preflight; targeted generated-artifact secret-pattern grep; and `git diff --check`.
- Release artifacts: `docs/releases/v3.4.72.md` exists, `backend/release-feed.json` serves `v3.4.72` first, `preflight-go-no-go.md` regenerated, and observability evidence regenerated for `3.4.72`.
- Verified facts: migration `93` adds `event_schedule_notification_delivery_attempts` and init parity covers it; sent Event-local schedule notifications create one `event_local` attempt per selected recipient; notification list readback includes attempt counts by status; `GET /api/events/:id/schedule-notification-delivery-attempts` returns scoped local attempt rows and can filter by notification id; the delivery boundary now reports local attempt records/readback while external delivery remains unsupported.
- Blocked/unverified items: CI-only `secret-scan` and `image-security-and-sbom` must still run in GitHub Actions; local release preflight marks CI secure-cookie `compose-smoke` conditions blocked because the local development stack intentionally runs with `SESSION_COOKIE_SECURE=false`; the preflight helper marks browser regression blocked even though full browser regression was run separately and passed locally.
- Files changed: `app-meta.json`, `artifacts/observability-evidence/observability-release-evidence.json`, `backend/app-meta.json`, `backend/db/migrations.js`, `backend/openapi/openapi.yaml`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/routes/events.js`, `backend/scripts/event-social-planning-smoke.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.72.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/app-meta.json`, `init.sql`, and `preflight-go-no-go.md`.
- Risks or follow-ups: delivery attempts remain Event-local audit evidence only; push/email/platform-device delivery, provider queues, provider settings, native device registration, and global notification inboxes remain future milestones.
- What remains in the milestone: no remaining 3.4.72 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.72 event schedule delivery attempt persistence and readback`

## 3.4.73 — Event Schedule Delivery Attempt Readback UI

**Goal:** Surface Event-local delivery-attempt audit evidence in the Event drawer notification history without implying push, email, native device, realtime, or external provider delivery.

**Current Slice:** `Closed.`

### Scope

- Load Event-local notification delivery-attempt rows with the Event social planning data.
- Group attempt rows by notification id for drawer readback.
- Show compact delivery-attempt summary on sent schedule notification records.
- Show recipient/group, status, and completed time in notification history when attempt rows are available.
- Preserve clear local-audit-only language.
- Keep provider settings, delivery queues, push/email/device delivery, global inboxes, and native notification delivery out of scope.

### Acceptance Criteria

- Sent notification history rows show delivery-attempt readback when local attempt rows exist.
- Draft notification history rows do not show delivery-attempt rows.
- Attempt UI names the local recipient or group snapshot where available.
- UI copy says local audit/readback only and does not imply external delivery.
- Browser regression proves the readback appears after sending a local notice.

### Notes

- This is a drawer readback patch only. It does not change delivery persistence, provider settings, or external notification delivery behavior.

### Closeout — 2026-05-03

- Roadmap slice: `3.4.73 — Event Schedule Delivery Attempt Readback UI`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`, and `/Users/hamlin/.codex/skills/uncodixfy/SKILL.md`.
- Runtime verification used: Docker rebuilt/recreated `backend` and `frontend` with `APP_VERSION=3.4.73`; `/api/health` returned frontend/backend/build `3.4.73`; running backend env was verified as `APP_EDITION=platform` for local platform compose; generated public compose was temporarily started with no `APP_EDITION` and the homelab boundary passed; local platform compose was restored afterward.
- CI/checks run: browser regression with redacted `PLAYWRIGHT_E2E_BYPASS_TOKEN` (`55 passed`, `4 skipped`); targeted event drawer browser regression; `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T backend npm run test:unit`; `test:openapi`; `test:init-parity`; `test:migration-rehearsal`; `test:event-social-planning-smoke`; `test:rbac-regression`; `test:platform-edition-boundary`; generated-compose homelab boundary smoke with no `APP_EDITION`; `npm run validate:public-export`; `docker compose --env-file .env config`; idempotent `npm run compose:generate`; backend/frontend `npm ci --no-fund --dry-run`; `test:help-releases-smoke` for `v3.4.73`; `test:observability-evidence`; `test:release-preflight-local`; targeted secret-pattern scan over generated release artifacts; `git diff --check`.
- Release artifacts: `docs/releases/v3.4.73.md` exists; `backend/release-feed.json` serves `v3.4.73`; `preflight-go-no-go.md` was regenerated; `artifacts/observability-evidence/observability-release-evidence.json` reports `9/9` checks passed.
- Verified facts: the Event drawer loads `/api/events/:id/schedule-notification-delivery-attempts` alongside schedule notification records; attempt rows are grouped by notification id; sent notification cards show a compact delivery-attempt summary and history readback; readback rows show recipient/group snapshot, local status, and completion time; copy explicitly says the record is local audit/readback only and not push/email/device delivery; browser coverage proves the readback appears after sending a local schedule notice.
- Blocked/unverified items: CI-only `secret-scan` and `image-security-and-sbom` still need to run in GitHub Actions; local release preflight marks secure-cookie compose-smoke conditions blocked because the dev stack intentionally runs `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; the preflight helper marks browser regression blocked even though full browser regression passed separately.
- Files changed: `app-meta.json`, `artifacts/observability-evidence/observability-release-evidence.json`, `backend/app-meta.json`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.73.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`, `frontend/package.json`, `frontend/src/app-meta.json`, `frontend/src/components/EventsView.jsx`, `preflight-go-no-go.md`, and `tests/playwright/specs/events-collectibles.browser.spec.js`.
- Risks or follow-ups: delivery attempt readback is still Event-local audit UI only; provider queues, provider settings, push/email/device delivery, native device registration, and global notification inboxes remain future work.
- What remains in the milestone: no remaining 3.4.73 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.73 event schedule delivery attempt readback UI`

## 3.4.74 — Platform Companion Now/Next Schedule Experience

**Goal:** Give Apple/platform companion clients a stable, compact Now/Next schedule snapshot from the existing Event catalog and personal-plan data, without depending on web frontend files or adding native UI code in this repo.

**Current Slice:** `Closed.`

### Scope

- Promote the backlog item into a backend/API companion contract slice.
- Extend `GET /api/events/:id/companion/today` with a versioned `now_next` block.
- Include current, next/upcoming, soon, and nearby active catalog sessions.
- Overlay linked personal schedule-plan state so native clients can distinguish catalog-only sessions from manual or personal Sched ICS plans.
- Include quick-action endpoint hints for `planned`, `maybe`, `skipped`, and `backup` using the existing schedule-plan endpoints.
- Include read-only conflict hints for overlapping personal/shared plans.
- Update OpenAPI, companion docs, smoke coverage, release notes, and release-feed data.
- Keep native Swift UI, offline mutation queues, provider automation, push/email/device delivery, realtime presence, and broad friend discovery out of scope.

### Acceptance Criteria

- The companion snapshot reports `now_next.contract.version = event-companion-now-next.v1`.
- Current/upcoming catalog sessions are readable without scraping web UI state.
- Each item clearly distinguishes `catalog_only`, `personal_plan`, or `personal_sched_ics`.
- Quick-action hints reference existing schedule-plan write endpoints without creating a new write surface.
- Conflict hints are read-only and do not mutate plans.
- Event social smoke and OpenAPI validation prove the contract.

### Notes

- This is the backend/platform contract for a native day-of-con schedule surface. It does not implement the Apple app UI.

### Closeout — 2026-05-03

- Roadmap slice: `3.4.74 — Platform Companion Now/Next Schedule Experience`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`, and `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: Docker rebuilt/recreated `backend` and `frontend` with `APP_VERSION=3.4.74`; `/api/health` returned frontend/backend/build `3.4.74`; running backend env was verified as `APP_EDITION=platform` for local platform compose; generated public compose was temporarily started with no `APP_EDITION` and the homelab boundary passed; local platform compose was restored afterward.
- CI/checks run: local backend syntax checks; local backend unit/source contract tests (`231` passed); local OpenAPI validation; backend/frontend dependency dry-runs; Docker production build with Vite; container backend unit tests; container OpenAPI validation; container `test:event-social-planning-smoke`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:rbac-regression`; container `test:platform-edition-boundary`; generated-compose `test:homelab-edition-boundary`; full browser regression with redacted `PLAYWRIGHT_E2E_BYPASS_TOKEN` (`55 passed`, `4 skipped`); `test:help-releases-smoke` for `v3.4.74`; `npm run validate:public-export`; `docker compose --env-file .env config`; idempotent `npm run compose:generate`; `test:observability-evidence`; `test:release-preflight-local`; targeted secret-pattern scan over generated release artifacts; `git diff --check`.
- Release artifacts: `docs/releases/v3.4.74.md` exists; `backend/release-feed.json` serves `v3.4.74`; `preflight-go-no-go.md` was regenerated; `artifacts/observability-evidence/observability-release-evidence.json` reports `9/9` checks passed.
- Verified facts: `GET /api/events/:id/companion/today` now includes `now_next.contract.version = event-companion-now-next.v1`; the payload separates current, next/upcoming, soon, and nearby active catalog sessions; each item includes relation readback for `catalog_only`, `personal_plan`, or `personal_sched_ics`; quick-action hints point to existing schedule-plan endpoints and supported statuses; conflict hints are read-only overlap summaries; smoke coverage verifies the active catalog session appears in companion Now/Next without depending on web frontend state.
- Blocked/unverified items: CI-only `secret-scan` and `image-security-and-sbom` still need to run in GitHub Actions; local release preflight marks secure-cookie compose-smoke conditions blocked because the dev stack intentionally runs `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; the preflight helper marks browser regression blocked even though full browser regression passed separately.
- Files changed: `app-meta.json`, `artifacts/observability-evidence/observability-release-evidence.json`, `backend/app-meta.json`, `backend/openapi/openapi.yaml`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/routes/events.js`, `backend/scripts/event-social-planning-smoke.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.74.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`, `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/app-meta.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: this is backend/API contract work only; native Swift UI, offline mutation queues, selected-recipient native sends, provider-backed push/email/device delivery, realtime presence, and broad friend discovery remain separate future milestones.
- What remains in the milestone: no remaining 3.4.74 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.74 platform companion now next schedule experience`

## 3.4.75 — Platform Companion Friend-Aware Session Changes

**Goal:** Give Apple/platform companion clients a stable, native-friendly contract for selected-recipient schedule change coordination using the existing Event-local preview, draft, send, and inbox APIs.

**Current Slice:** `Closed.`

### Scope

- Promote the backlog item into a backend/API companion contract slice.
- Extend `GET /api/events/:id/companion/today` with a versioned `friend_aware_changes` block.
- Advertise supported session-change intents and default template language for native clients.
- Expose recipient-selection policy and endpoint hints for preview, draft/save/send, delivery-boundary readback, and inbox readback.
- Keep privacy, visibility, and recipient eligibility backend-owned.
- Update OpenAPI, companion docs, smoke coverage, release notes, and release-feed data.
- Keep native Swift UI, offline mutation queues, push/email/device delivery, realtime presence, and broad friend discovery out of scope.

### Acceptance Criteria

- The companion snapshot reports `friend_aware_changes.contract.version = event-companion-friend-aware-session-changes.v1`.
- Platform clients can discover selected-recipient schedule change behavior from the companion payload without web-specific assumptions.
- The contract explicitly advertises non-broadcast recipient policy and local-only delivery scope.
- Supported message intents/templates are readable from the API contract.
- Event social smoke and OpenAPI validation prove the contract.

### Notes

- This is the backend/platform contract for native session-change coordination. It does not implement the Apple app UI or external delivery.

### Closeout — 2026-05-03

- Roadmap slice: `3.4.75 — Platform Companion Friend-Aware Session Changes`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, and `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`.
- Runtime verification used: Docker rebuilt/recreated `backend` and `frontend` with `APP_VERSION=3.4.75`; `/api/health` returned frontend/backend/build `3.4.75`; running backend env was verified as `APP_EDITION=platform` for local platform compose; generated public compose was temporarily started with no `APP_EDITION` and the homelab boundary passed; local platform compose was restored afterward.
- CI/checks run: local backend syntax checks; local backend unit/source contract tests (`231` passed); local OpenAPI validation; backend/frontend dependency dry-runs; Docker production build with Vite; container backend unit tests; container OpenAPI validation; container `test:event-social-planning-smoke`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:rbac-regression`; container `test:platform-edition-boundary`; generated-compose `test:homelab-edition-boundary`; full browser regression with redacted `PLAYWRIGHT_E2E_BYPASS_TOKEN` (`55 passed`, `4 skipped`); `test:help-releases-smoke` for `v3.4.75`; `npm run validate:public-export`; `docker compose --env-file .env config`; idempotent `npm run compose:generate`; `test:observability-evidence`; `test:release-preflight-local`; targeted secret-pattern scan over generated release artifacts; `git diff --check`.
- Release artifacts: `docs/releases/v3.4.75.md` exists; `backend/release-feed.json` serves `v3.4.75`; `preflight-go-no-go.md` was regenerated; `artifacts/observability-evidence/observability-release-evidence.json` reports `9/9` checks passed.
- Verified facts: `GET /api/events/:id/companion/today` now includes `friend_aware_changes.contract.version = event-companion-friend-aware-session-changes.v1`; the payload exposes supported intents, selected-recipient recipient policy, endpoint hints for preview/records/inbox/delivery-boundary, and native write guidance; the contract keeps privacy and recipient eligibility backend-owned; the running event social smoke proves the companion payload advertises selected-recipient notifications while external delivery remains unsupported.
- Blocked/unverified items: CI-only `secret-scan` and `image-security-and-sbom` still need to run in GitHub Actions; local release preflight marks secure-cookie compose-smoke conditions blocked because the dev stack intentionally runs `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; the preflight helper marks browser regression blocked even though full browser regression passed separately.
- Files changed: `app-meta.json`, `artifacts/observability-evidence/observability-release-evidence.json`, `backend/app-meta.json`, `backend/openapi/openapi.yaml`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/routes/events.js`, `backend/scripts/event-social-planning-smoke.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.75.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Event-Social-Platform-Companion-Contract.md`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/app-meta.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: this remains backend/API contract work only; native Swift UI, offline mutation queues, real push/email/device delivery, device registration, global inboxes, realtime presence, and broad friend discovery remain separate future milestones.
- What remains in the milestone: no remaining 3.4.75 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.75 platform companion friend-aware session changes`

## 3.4.76 — Event Schedule Shared Session Presence Readback Polish

**Goal:** Make shared session presence easier to scan on Event schedule cards by turning the existing attendance readback into clearer people/group presence strips and more structured expanded detail.

**Current Slice:** `Closed 2026-05-03.`

### Scope

- Reuse the existing Event-local attendance readback model from shared schedule plans.
- Keep the collapsed Now / Next, catalog, and personal-plan rows compact, but add clearer shared presence chips/counts.
- Improve expanded shared-attendance readback with named people/groups and a cleaner count summary.
- Preserve current visibility-safe readback rules and draft-time preview behavior when plan visibility changes.
- Keep this separate from push/email/device delivery, global inboxes, reciprocal friend graphs, realtime presence, and native platform UI.

### Acceptance Criteria

- Session cards still show compact shared presence when visibility allows, but the readback is easier to scan than a single text line.
- Expanded shared-attendance blocks show clearer people/group breakdowns when those names exist.
- The fallback count/status readback still works when named people/groups are limited.
- Browser coverage verifies the richer shared-attendance readback on session rows.
- No backend delivery, push, email, native device registration, global inbox, or friend graph work is introduced.

### Notes

- This is a UI/readback polish slice on top of `3.4.63`, not a new social model.

### Closeout

- Roadmap slice: `3.4.76 — Event Schedule Shared Session Presence Readback Polish`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, and `docs/wiki/45-Event-Schedule-Catalog-Foundation.md`.
- Runtime verification used: rebuilt and recreated backend/frontend through Docker with `APP_VERSION=3.4.76`; verified `/api/health` reports frontend/backend/build `3.4.76`; verified local platform container env reports `APP_EDITION=platform`, `APP_VERSION=3.4.76`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; switched to generated public compose plus `.ci/docker-compose.build.yml` and verified homelab runtime with `APP_EDITION` unset; restored local platform compose afterward and rechecked `/api/health`.
- CI/checks run: local backend unit/source assertions (`231` passed); local OpenAPI validation; container backend unit tests; container OpenAPI validation; container `test:event-social-planning-smoke`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.76`; container `test:rbac-regression`; container `test:platform-edition-boundary`; generated-compose `test:homelab-edition-boundary`; full browser regression via direct Playwright CLI under Node 24 (`55 passed`, `4 skipped`); `docker compose --env-file .env config`; `npm run validate:public-export`; idempotent `npm run compose:generate`; backend/frontend `npm ci --no-fund --dry-run`; `npm --prefix backend run test:observability-evidence`; `npm --prefix backend run test:release-preflight-local`; targeted release-artifact secret-pattern grep; and `git diff --check`.
- Release artifacts: `docs/releases/v3.4.76.md` exists; `backend/release-feed.json` serves `v3.4.76`; `preflight-go-no-go.md` was regenerated; `artifacts/observability-evidence/observability-release-evidence.json` now reports `3.4.76` with `9/9` checks passed.
- Verified facts: Event schedule cards now render shared-presence strips as structured chips instead of a single fallback-only text line; expanded shared-attendance readback now shows clearer `People` and `Groups` sections when Event-local names exist; existing visibility-safe attendance derivation still drives the UI; personal schedule draft visibility changes continue to update shared-attendance readback before save; no backend delivery, push, email, native device registration, global inbox, or reciprocal friend-graph work was introduced.
- Blocked/unverified: local release preflight still marks secure-cookie compose-smoke conditions blocked because the dev stack intentionally runs `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; CI-only `secret-scan` and `image-security-and-sbom` still need GitHub Actions follow-through; the host `npm run test:browser` launcher hit a local Playwright/runtime issue (`performance is not defined`), so browser regression was run successfully through direct Node 24 CLI invocation instead.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/release-feed.json`, `frontend/src/components/EventsView.jsx`, `tests/playwright/specs/events-collectibles.browser.spec.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.76.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks/follow-ups: this remains Event-local readback polish only; broader social discovery, reciprocal friend identity, native device identity, push/email delivery, global notification inboxes, realtime presence/location, and offline queued sends remain future milestones.
- What remains in the milestone: no remaining 3.4.76 implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.76 event schedule shared session presence readback polish`

## 3.4.77 — Event Social Discovery Readback Polish

**Goal:** Make Event-local People, Groups, and Meetups easier to browse by surfacing their relationships directly in the drawer instead of making each section feel isolated.

**Current Slice:** `Closed 2026-05-03.`

### Scope

- Keep the existing Event-local attendee/group/meetup data model and APIs.
- Improve attendee cards with clearer related-group, next-meetup, and next shared-plan readback.
- Improve group cards with member preview plus next meetup/shared-plan cues.
- Improve meetup rows with clearer group/member/notes context in both collapsed and expanded states.
- Add browser coverage for the richer readback.
- Keep reciprocal friend graph, realtime presence, cross-event discovery, device delivery, and native companion UI out of scope.

### Acceptance Criteria

- People rows show more than name plus visibility; they also show related Event-local context.
- Group rows show members and upcoming meetup/shared-plan cues without requiring backend changes.
- Meetup rows show cleaner group/member/notes readback before edit actions.
- Browser coverage proves the new discovery/readback blocks in the Event drawer.
- No new social backend contract, push delivery, or cross-event identity model is introduced.

### Closeout

- Roadmap slice: `3.4.77 — Event Social Discovery Readback Polish`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, and `docs/wiki/40-Event-Social-Planning-Foundation.md`.
- Runtime verification used: rebuilt and recreated the local platform stack through Docker with `APP_VERSION=3.4.77`; verified `/api/health` reports frontend/backend/build `3.4.77`; verified the running platform container env reports `APP_EDITION=platform`, `APP_VERSION=3.4.77`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; temporarily switched to generated public compose plus `.ci/docker-compose.build.yml`, verified homelab runtime with `APP_EDITION` unset, ran the homelab boundary smoke, then restored the local platform compose and rechecked `/api/health`.
- CI/checks run: local backend unit/source assertions (`231` passed); local OpenAPI validation; container backend unit tests; container OpenAPI validation; container `test:event-social-planning-smoke` with `BASE_URL=http://frontend:3000`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.77`; container `test:rbac-regression` with `BASE_URL=http://frontend:3000`; container `test:platform-edition-boundary` with `BASE_URL=http://frontend:3000`; generated-compose `test:homelab-edition-boundary`; full browser regression via `PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted> npm exec playwright test` (`55 passed`, `4 skipped`); `docker compose --env-file .env config`; `npm run validate:public-export`; idempotent `npm run compose:generate`; backend/frontend `npm ci --no-fund --dry-run`; `npm --prefix backend run test:observability-evidence`; `npm --prefix backend run test:release-preflight-local`; release-artifact secret-pattern grep confirming only redacted credential strings remain; and `git diff --check`.
- Release artifacts: `docs/releases/v3.4.77.md` exists with security triage markers; `backend/release-feed.json` serves `v3.4.77`; `preflight-go-no-go.md` was regenerated; `artifacts/observability-evidence/observability-release-evidence.json` reports `3.4.77` with `9/9` checks passed.
- Verified facts: attendee rows now show related-group, next-meetup, and next shared-plan readback; group rows now show member preview plus meetup/shared-plan cues; meetup rows now surface group/member/notes context before edit controls; browser regression proves the richer social discovery readback inside the Event drawer without adding new backend contracts.
- Blocked/unverified: local release preflight still marks secure-cookie compose-smoke conditions blocked because the dev stack intentionally runs `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; CI-only `secret-scan` and `image-security-and-sbom` still need GitHub Actions follow-through; the local preflight helper still marks browser regression blocked because that helper does not execute Playwright itself even though full browser regression passed separately.
- Files changed: `app-meta.json`, `artifacts/dependency-audit/frontend-audit.json`, `artifacts/observability-evidence/observability-release-evidence.json`, `backend/app-meta.json`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.77.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/app-meta.json`, `frontend/src/components/EventsView.jsx`, `preflight-go-no-go.md`, and `tests/playwright/specs/events-collectibles.browser.spec.js`.
- Risks or follow-ups: this remains Event-local discovery/readback polish only; reciprocal friend identity, realtime presence, cross-event social discovery, device delivery, and native companion UI remain separate future work.
- What remains in the milestone: no remaining `3.4.77` implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.77 event social discovery readback polish`

## 3.4.78 — Event-local Social Editability Polish

**Goal:** Make Event-local People, Groups, and Meetups easier to maintain in place so the richer social readback from `3.4.77` can be updated without bouncing out to separate creation-only flows.

**Current Slice:** `Closed 2026-05-03.`

### Scope

- Keep the existing Event-local attendee/group/meetup backend model and patch endpoints.
- Add inline attendee editing for name, relationship, status, visibility, and notes.
- Add inline group editing for name, visibility, notes, and membership.
- Expand meetup editing so group ownership and visibility can be updated alongside status and location notes.
- Add browser coverage that proves attendee edit, group membership edit, and meetup reassignment/readback on a live Event drawer.
- Keep reciprocal friend graph work, cross-event identity, realtime presence, delivery/provider execution, and native companion UI out of scope.

### Acceptance Criteria

- People rows can be edited inline for core Event-local relationship metadata.
- Group rows can update membership and visibility without leaving the drawer.
- Meetup rows can move between groups while preserving Event-local readback consistency.
- Browser coverage proves the editability path through the Event drawer and verifies persisted API readback.
- No new social backend contract, push delivery behavior, or cross-event friend model is introduced.

### Closeout

- Roadmap slice: `3.4.78 — Event-local Social Editability Polish`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, and `docs/wiki/40-Event-Social-Planning-Foundation.md`.
- Runtime verification used: rebuilt and recreated the local platform stack through Docker with `APP_VERSION=3.4.78`; verified `/api/health` reports frontend/backend/build `3.4.78`; verified the running platform container env reports `APP_EDITION=platform`, `APP_VERSION=3.4.78`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; regenerated the public compose and verified it resolves `APP_VERSION: 3.4.78`; temporarily swapped to generated public compose plus `.ci/docker-compose.build.yml`, verified the homelab stack answers `/api/health` at `3.4.78`, confirmed `APP_EDITION` is unset in-container, ran the homelab boundary smoke, then restored the local platform stack and rechecked `/api/health`.
- CI/checks run: local backend unit/source assertions (`231` passed); local OpenAPI validation; container backend unit tests; container OpenAPI validation; container `test:event-social-planning-smoke` with `BASE_URL=http://frontend:3000`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:help-releases-smoke` with `BASE_URL=http://frontend:3000` and `EXPECTED_RELEASE_VERSION=v3.4.78`; container `test:rbac-regression` with `BASE_URL=http://frontend:3000`; container `test:platform-edition-boundary` with `BASE_URL=http://frontend:3000`; generated-compose `test:homelab-edition-boundary`; full browser regression via `PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted> npm exec playwright test` (`56 passed`, `4 skipped`); `docker compose --env-file .env config`; idempotent `npm run compose:generate`; `npm run validate:public-export`; backend/frontend `npm ci --no-fund --dry-run`; backend/frontend `npm ci --no-fund`; `npm --prefix backend run test:observability-evidence`; `npm --prefix backend run test:release-preflight-local`; and `git diff --check`.
- Release artifacts: `docs/releases/v3.4.78.md` exists with security triage markers; `backend/release-feed.json` serves `v3.4.78`; `preflight-go-no-go.md` was regenerated; `artifacts/observability-evidence/observability-release-evidence.json` reports `3.4.78` with `9/9` checks passed.
- Verified facts: attendee rows now support inline edits for name, relationship, status, visibility, and notes; group rows now support inline name/visibility/notes changes plus membership updates through the shared checkbox primitive; meetup rows now support group reassignment and visibility edits in the same in-place editor; the Event drawer browser regression suite was updated to cover attendee edit, group membership edit, meetup reassignment, and the refreshed mobile social overview assertions.
- Blocked/unverified: local release preflight still marks secure-cookie compose-smoke conditions blocked because the dev stack intentionally runs `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; CI-only `secret-scan` and `image-security-and-sbom` still need GitHub Actions follow-through; the local preflight helper still marks browser regression blocked because that helper does not execute Playwright itself even though full browser regression passed separately.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/release-feed.json`, `frontend/src/components/EventsView.jsx`, `tests/playwright/specs/events-collectibles.browser.spec.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.78.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/dependency-audit/frontend-audit.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: this remains Event-local editability polish only; cross-event identity, realtime presence, delivery/provider execution, native companion social mutation UX, and a broader friend graph remain separate work.
- What remains in the milestone: no remaining `3.4.78` implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.78 event-local social editability polish`

## 3.4.79 — Event Self-Attendee Auto-Link and Add Me Flow

**Goal:** Keep Event attendee ownership and Event-local social planning exactly where they are, but remove the awkward manual self-linking step by giving the signed-in user a first-class `Add me` path.

**Current Slice:** `Version Closeout completed.`

### Scope

- Keep the existing Event-local attendee backend model, ownership fields, and `user_id` linkage behavior from `3.4.61`.
- Replace the generic attendee-form self-link checkbox with an explicit `Add me` action for the current signed-in user.
- Auto-fill the self-attendee display name from the current app user when available.
- Keep the generic People form focused on adding other attendees only.
- Add browser coverage that proves the Event drawer can add the signed-in user as `You` without surfacing the old manual checkbox.
- Keep external contact identity models, cross-event identity, native companion social mutation UX, and broader friend-graph work out of scope.

### Acceptance Criteria

- The People panel offers an explicit `Add me` path when the current signed-in user does not yet have an attendee row for the Event.
- Using `Add me` creates a linked attendee row for the current app user without asking the user to toggle a manual checkbox.
- Once created, the attendee reads back as `You` / `Linked to you`.
- The generic attendee form remains available for adding other people and no longer presents the old self-link checkbox.
- Browser coverage proves the self-attendee path and API readback on a live Event drawer.

### Closeout

- Roadmap slice: `3.4.79 — Event Self-Attendee Auto-Link and Add Me Flow`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, and `docs/wiki/40-Event-Social-Planning-Foundation.md`.
- Runtime verification used: rebuilt and recreated the local platform stack through Docker with `APP_VERSION=3.4.79`; verified `/api/health` reports frontend/backend/build `3.4.79`; verified the running platform container env reports `APP_EDITION=platform`, `APP_VERSION=3.4.79`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; verified `events_enabled=true` in the live DB; temporarily brought the platform override down, started the generated public compose plus `.ci/docker-compose.build.yml`, verified `/api/auth/config` reports `product_edition=homelab` with `workspace_surface=false`, ran the homelab boundary smoke against that clean stack, then restored the local platform stack and rechecked `/api/health`.
- CI/checks run: local backend unit/source assertions (`231` passed); local OpenAPI validation; container backend unit tests; container OpenAPI validation; container `test:event-social-planning-smoke` with `BASE_URL=http://frontend:3000`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:help-releases-smoke` with `BASE_URL=http://frontend:3000` and `EXPECTED_RELEASE_VERSION=v3.4.79`; container `test:rbac-regression` with `BASE_URL=http://frontend:3000`; container `test:platform-edition-boundary` with `BASE_URL=http://frontend:3000`; generated-compose `test:homelab-edition-boundary`; full browser regression via `PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted> npm run test:browser` (`57 passed`, `4 skipped`); targeted Event browser regression for the new `Add me` flow (`14 passed` in `events-collectibles.browser.spec.js`); `docker compose --env-file .env config`; idempotent `npm run compose:generate`; `npm run validate:public-export`; backend/frontend `npm ci --no-fund --dry-run`; `npm --prefix backend run test:observability-evidence`; `npm --prefix backend run test:release-preflight-local`; release-artifact secret-pattern grep over `docs/releases/v3.4.79.md`, `backend/release-feed.json`, `preflight-go-no-go.md`, and `artifacts`; and `git diff --check`.
- Release artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.79.md`, and `backend/release-feed.json` are aligned on `3.4.79`; the running Help > Releases feed serves `v3.4.79` first; `preflight-go-no-go.md` was regenerated; `artifacts/observability-evidence/observability-release-evidence.json` reports `3.4.79` with `9/9` checks passed.
- Verified facts: the Event drawer People panel now shows a dedicated `Add me` callout when no current-user attendee exists; the generic attendee form now reads as an “other people” path and no longer exposes the old self-link checkbox; using `Add me` creates a linked attendee row that reads back as `You` and `Linked to you`; the full browser suite proves the new flow without regressing adjacent Event or collectible workflows.
- Blocked/unverified: local release preflight still marks secure-cookie compose-smoke conditions blocked because the dev stack intentionally runs `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; CI-only `secret-scan` and `image-security-and-sbom` still need GitHub Actions follow-through; the local preflight helper still marks browser regression blocked because that helper does not execute Playwright itself even though full browser regression passed separately.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/release-feed.json`, `frontend/src/components/EventsView.jsx`, `frontend/src/components/app/DashboardContent.jsx`, `tests/playwright/specs/events-collectibles.browser.spec.js`, `backend/scripts/unit-tests.js`, `backend/scripts/homelab-edition-boundary-smoke.js`, `docker-compose.yml`, `docs/releases/v3.4.79.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: this keeps the Event-local attendee ownership model intact and only improves self-identity UX; external contact identities, cross-event identity, native companion social mutation UX, realtime presence, and a broader friend graph remain separate work.
- What remains in the milestone: no remaining `3.4.79` implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.79 event self-attendee auto-link and add me flow`

## 3.4.80 — Event Self-Attendee Header Affordance Polish

**Goal:** Make the self-attendee path obvious before the People section is expanded by surfacing `Add me to this event` directly in the section header.

**Current Slice:** `Version Closeout completed.`

### Scope

- Keep the linked self-attendee creation behavior from `3.4.79`.
- Move the primary `Add me` affordance higher in the People section so it is visible from the collapsed Event social panel.
- Keep the in-panel helper copy lightweight and focused on clarifying the difference between adding yourself and adding other attendees.
- Update browser/source coverage so the header-level affordance is what the test suite proves.
- Keep broader identity/contact/provider work out of scope.

### Acceptance Criteria

- The People section shows an explicit `Add me to this event` action before the section is expanded when the current signed-in user has not yet been added.
- Expanding People still shows a lightweight reminder of what the self-attendee action does.
- The generic attendee form remains clearly framed as an “other people” flow.
- Browser coverage proves the header-level self-attendee affordance on a live Event drawer.

### Closeout

- Roadmap slice: `3.4.80 — Event Self-Attendee Header Affordance Polish`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, and `docs/wiki/40-Event-Social-Planning-Foundation.md`.
- Runtime verification used: rebuilt and recreated the local platform stack through Docker with `APP_VERSION=3.4.80` using `docker-compose.yml` plus `docker-compose.localhost.yml`; verified `/api/health` reports frontend/backend/build `3.4.80`; verified the running platform container env reports `APP_EDITION=platform`, `APP_VERSION=3.4.80`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; temporarily swapped to the generated public compose plus `.ci/docker-compose.build.yml`, verified the homelab backend env leaves `APP_EDITION` unset, ran the homelab boundary smoke, then restored the local platform stack and rechecked `/api/health`.
- CI/checks run: local backend unit/source assertions (`231` passed); local OpenAPI validation; container backend unit tests; container OpenAPI validation; container `test:event-social-planning-smoke` with `BASE_URL=http://frontend:3000`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:help-releases-smoke` with `BASE_URL=http://frontend:3000` and `EXPECTED_RELEASE_VERSION=v3.4.80`; container `test:rbac-regression` with `BASE_URL=http://frontend:3000`; container `test:platform-edition-boundary` with `BASE_URL=http://frontend:3000`; generated-compose `test:homelab-edition-boundary`; targeted Event browser regression via `PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted> npm exec playwright test tests/playwright/specs/events-collectibles.browser.spec.js` (`14 passed`); full browser regression via `PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted> npm run test:browser` (`57 passed`, `4 skipped`); `docker compose --env-file .env config`; idempotent `npm run compose:generate`; `npm run validate:public-export`; backend/frontend `npm ci --no-fund --dry-run`; `npm --prefix backend run test:observability-evidence`; `npm --prefix backend run test:release-preflight-local`; release-artifact secret-pattern grep over `docs/releases/v3.4.80.md`, `backend/release-feed.json`, `preflight-go-no-go.md`, and `artifacts/observability-evidence/observability-release-evidence.json`; and `git diff --check`.
- Release artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.80.md`, and `backend/release-feed.json` are aligned on `3.4.80`; the running Help > Releases feed serves `v3.4.80` first while retaining `v3.4.79`; `preflight-go-no-go.md` was regenerated; `artifacts/observability-evidence/observability-release-evidence.json` reports `3.4.80` with `9/9` checks passed.
- Verified facts: the Event drawer People section now surfaces `Add me to this event` in the section header before the drawer content is expanded; the inline reminder copy now explains the self-attendee path without duplicating the action button lower in the panel; the generic attendee form remains clearly framed as an “other people” flow; the full browser suite proves the updated Event flow without regressing adjacent admin, library, or social surfaces.
- Blocked/unverified: local release preflight still marks secure-cookie compose-smoke conditions blocked because the dev stack intentionally runs `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; CI-only `secret-scan` and `image-security-and-sbom` still need GitHub Actions follow-through; the local preflight helper still marks browser regression blocked because that helper does not execute Playwright itself even though full browser regression passed separately.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/release-feed.json`, `frontend/src/components/EventsView.jsx`, `tests/playwright/specs/events-collectibles.browser.spec.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.80.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: this keeps the Event-local attendee ownership model and `3.4.79` linked self-attendee behavior intact; external contact identities, cross-event identity, native companion social mutation UX, realtime presence, and a broader friend graph remain separate work.
- What remains in the milestone: no remaining `3.4.80` implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.80 event self-attendee header affordance polish`

## 3.4.81 — Event Self-Attendee Default Creation on First Social Action

**Goal:** Remove another layer of social-model friction by automatically creating the signed-in user’s self attendee when their first Event social action clearly implies “I’m participating here.”

**Current Slice:** `Version Closeout completed.`

### Scope

- Keep the explicit `Add me to this event` affordance from `3.4.79` and `3.4.80`.
- Automatically create the self attendee when the signed-in user creates their first group, meetup, or manual schedule plan without already having a linked attendee row.
- When the first action is group creation, make the new self attendee the group’s initial member so the group is immediately useful.
- Keep the generic People form unchanged for adding other attendees.
- Stop observability structured-log evidence from mutating the user-facing `events_enabled` library flag by switching its deterministic toggle to a platform-safe flag.
- Keep cross-event identity, external contact identities, realtime presence, and broader friend-graph work out of scope.

### Acceptance Criteria

- Creating a first group, meetup, or manual schedule plan without a self attendee automatically creates the signed-in user’s attendee row first.
- Group creation links that new self attendee as the initial group member.
- The explicit `Add me to this event` affordance still exists when the user wants to add themselves directly first.
- Observability evidence no longer leaves the Events library hidden by toggling `events_enabled`.
- Browser coverage proves at least one first-social-action path creates and links the self attendee automatically.

### Closeout

- Roadmap slice: `3.4.81 — Event Self-Attendee Default Creation on First Social Action`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, and `docs/wiki/40-Event-Social-Planning-Foundation.md`.
- Runtime verification used: rebuilt and recreated the local platform stack through Docker with `APP_VERSION=3.4.81` using `docker-compose.yml` plus `docker-compose.localhost.yml`; verified `/api/health` reports frontend/backend/build `3.4.81`; verified the running platform container env reports `APP_EDITION=platform`, `APP_VERSION=3.4.81`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; verified the live DB still reports `events_enabled=true`; reran observability release evidence and confirmed `events_enabled` stayed enabled afterward; temporarily swapped to the generated public compose plus `.ci/docker-compose.build.yml`, verified `/api/auth/config` reports homelab behavior with `workspace_surface=false`, ran the homelab boundary smoke, then restored the local platform stack and rechecked `/api/health`.
- CI/checks run: local backend unit/source assertions (`231` passed); local OpenAPI validation; container backend unit tests; container OpenAPI validation; container `test:event-social-planning-smoke` with `BASE_URL=http://frontend:3000`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:help-releases-smoke` with `BASE_URL=http://frontend:3000` and `EXPECTED_RELEASE_VERSION=v3.4.81`; container `test:rbac-regression` with `BASE_URL=http://frontend:3000`; container `test:platform-edition-boundary` with `BASE_URL=http://frontend:3000`; generated-compose `test:homelab-edition-boundary`; targeted Event browser regression via `PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted> npm exec playwright test tests/playwright/specs/events-collectibles.browser.spec.js` (`15 passed`); full browser regression via `PLAYWRIGHT_E2E_BYPASS_TOKEN=<redacted> npm run test:browser` (`58 passed`, `4 skipped`); `docker compose --env-file .env config`; idempotent `npm run compose:generate`; `npm run validate:public-export`; backend/frontend `npm ci --no-fund --dry-run`; `npm --prefix backend run test:observability-evidence`; `npm --prefix backend run test:release-preflight-local`; release-artifact secret-pattern grep over `docs/releases/v3.4.81.md`, `backend/release-feed.json`, `preflight-go-no-go.md`, and `artifacts/observability-evidence/observability-release-evidence.json`; and `git diff --check`.
- Release artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.81.md`, and `backend/release-feed.json` are aligned on `3.4.81`; the running Help > Releases feed serves `v3.4.81` first while retaining `v3.4.80` and `v3.4.79`; `preflight-go-no-go.md` was regenerated; `artifacts/observability-evidence/observability-release-evidence.json` reports `3.4.81` with `9/9` checks passed.
- Verified facts: creating a first group, meetup, or manual schedule plan now auto-creates the signed-in user’s Event attendee row before the action completes; first group creation uses that just-created self attendee as the initial group member; the explicit `Add me to this event` path remains available for direct self-linking; the observability structured-log smoke path now toggles `metrics_enabled` by default instead of the user-facing `events_enabled` library flag; the live DB kept `events_enabled=true` after observability evidence and browser/regression runs.
- Blocked/unverified: local release preflight still marks secure-cookie compose-smoke conditions blocked because the dev stack intentionally runs `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; CI-only `secret-scan` and `image-security-and-sbom` still need GitHub Actions follow-through; the local preflight helper still marks browser regression blocked because that helper does not execute Playwright itself even though full browser regression passed separately.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/release-feed.json`, `backend/scripts/structured-log-smoke-shared.js`, `backend/scripts/unit-tests.js`, `frontend/src/components/EventsView.jsx`, `tests/playwright/specs/events-collectibles.browser.spec.js`, `docker-compose.yml`, `docs/releases/v3.4.81.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: this keeps the Event-local attendee ownership model intact while smoothing the first-action UX; external contact identities, cross-event identity, native companion social mutation UX, realtime presence, and a broader friend graph remain separate work.
- What remains in the milestone: no remaining `3.4.81` implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.81 event self-attendee default creation on first social action`

## 3.4.82 — Event Attendee Duplicate Guardrails

**Goal:** Stabilize the Event-social attendee model after `3.4.79`, `3.4.80`, and `3.4.81` by preventing confusing duplicate attendee rows, especially duplicate self-like rows.

**Current Slice:** `Version Closeout completed.`

### Scope

- Prevent duplicate linked self-attendee creation in the UI before the backend 409 when possible.
- Add lightweight guardrails when adding other attendees with the same or very similar display name.
- Keep manual entry of non-user attendees intact.
- Improve duplicate error/readback copy so the user understands what already exists.
- Suggest the existing matching attendee instead of silently blocking.
- Preserve the current `Add me to this event` and first-social-action auto-create behavior.
- Keep cross-event identity, external contacts, Discord delivery, realtime presence, and broader friend-graph work out of scope.

### Acceptance Criteria

- The People panel warns before saving an attendee whose name matches or closely resembles an existing active attendee.
- The warning identifies the existing attendee row and requires an explicit `Add anyway` acknowledgement before creating a separate Event-local attendee.
- Manual non-user attendee entry remains possible after acknowledgement.
- A self-like manual attendee name points users back to the linked `Add me to this event` flow when no self attendee exists.
- Duplicate linked self-attendee API responses include clearer copy plus the existing attendee row when the unique-link guard fires.
- Browser coverage proves both duplicate self-like and duplicate other-attendee guardrails on a live Event drawer.

### Closeout

- Roadmap slice: `3.4.82 — Event Attendee Duplicate Guardrails`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, and `docs/wiki/40-Event-Social-Planning-Foundation.md`.
- Runtime verification used: rebuilt and recreated the local platform stack through Docker with `APP_VERSION=3.4.82`; verified `/api/health` reports frontend/backend/build `3.4.82`; verified the running platform container env reports `APP_EDITION=platform`, `APP_VERSION=3.4.82`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; verified the live DB reported `events_enabled=true` before implementation, after the rebuilt stack, after observability release evidence, and after restoring the platform stack; temporarily swapped to the generated public compose plus `.ci/docker-compose.build.yml`, verified `/api/auth/config` reports homelab behavior with `workspace_surface=false`, ran the homelab boundary smoke, then restored the local platform stack and rechecked `/api/health`.
- CI/checks run: source syntax checks for `backend/routes/events.js` and `backend/scripts/unit-tests.js`; container backend unit/source assertions (`231` passed); container OpenAPI validation; container `test:event-social-planning-smoke` with `BASE_URL=http://frontend:3000` after an initial missing-`BASE_URL` attempt failed with `fetch failed`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:help-releases-smoke` with `BASE_URL=http://frontend:3000` and `EXPECTED_RELEASE_VERSION=v3.4.82`; container `test:rbac-regression`; container `test:platform-edition-boundary`; generated-compose `test:homelab-edition-boundary`; targeted Event/Collectibles browser regression (`15 passed`); full browser regression (`58 passed`, `4 skipped`); `docker compose --env-file .env config`; idempotent `npm run compose:generate`; `npm run validate:public-export`; Docker Node 20 backend/frontend `npm ci --dry-run --no-fund --ignore-scripts`; Docker Node 20 backend/frontend `npm audit --omit=dev --json`; `backend/scripts/observability-release-evidence.js`; `backend/scripts/release-preflight-local.js`; release-artifact secret-pattern grep over `docs/releases/v3.4.82.md`, `backend/release-feed.json`, `preflight-go-no-go.md`, dependency audit artifacts, migration/init artifacts, and observability artifacts; and `git diff --check`.
- Release artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.82.md`, and `backend/release-feed.json` are aligned on `3.4.82`; the running Help > Releases feed serves `v3.4.82` first while retaining recent Event-social releases; `artifacts/observability-evidence/observability-release-evidence.json` reports `3.4.82` with `9/9` checks passed; Docker Node 20 audit artifacts report backend low `0`, moderate `2`, high `0`, critical `0`, and frontend low `0`, moderate `0`, high `0`, critical `0`.
- Verified facts: the Event drawer now warns on self-like and duplicate attendee display names before save; the duplicate warning suggests the existing attendee row and requires `Add anyway` before creating an intentional separate attendee; manual non-user attendees remain supported; duplicate linked self-attendee 409 responses now return clearer copy plus `existing_attendee`; the explicit `Add me to this event` path and first-social-action auto-create behavior remain in place; `events_enabled` stayed enabled.
- Blocked/unverified: local release preflight still marks secure-cookie compose-smoke conditions blocked when the dev stack intentionally runs `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; the preflight helper's host `npm audit` calls returned no vulnerability metadata under the local shell, so dependency audits were rerun with Docker Node 20 and produced the counts above; CI-only `secret-scan` and `image-security-and-sbom` still need GitHub Actions follow-through; local preflight helper marks browser regression blocked because it does not execute Playwright itself even though full browser regression passed separately.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/release-feed.json`, `backend/routes/events.js`, `backend/scripts/unit-tests.js`, `frontend/src/components/EventsView.jsx`, `tests/playwright/specs/events-collectibles.browser.spec.js`, `docker-compose.yml`, `docs/releases/v3.4.82.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: these are lightweight Event-local duplicate guardrails only; external contact identity, cross-event identity, Discord delivery, native companion social mutation UX, realtime presence, and broader friend-graph work remain separate milestones.
- What remains in the milestone: no remaining `3.4.82` implementation work; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.82 event attendee duplicate guardrails`

## 3.4.83 — Event Social Mobile Day-Of Summary

**Goal:** Continue the Event Social Planning Mobile Web Experience by making the Event social overview more useful on a phone during a con, with faster who/when/where readback before native companion surfaces.

**Current Slice:** `Closed 2026-05-04`

### Scope

- Rework the mobile-only Event social overview into a day-of summary with the current schedule focus, next meetup, and people/group context.
- Add direct mobile jumps into the existing Schedule, Meetups, and People sections instead of introducing a separate mobile social data path.
- Preserve desktop planning views, Event-local attendee ownership, duplicate attendee guardrails, `Add me`, first-social-action self attendee creation, notification contracts, and manual non-user attendees.
- Keep native companion behavior, push/Discord/email delivery, cross-event identity, external contacts, realtime presence, and broader friend graph work out of scope.

### Acceptance Criteria

- A mobile user can open an Event drawer and quickly see who, when, where, and visibility for the next relevant social plan.
- Meetups and schedule plans are readable from the mobile overview without excessive drawer scrolling.
- The mobile overview can jump to the existing Schedule, Meetups, and People sections.
- Private/shared visibility remains visible in the summary.
- Version metadata and Help > Releases are aligned to `3.4.83`.

### Closeout Notes

- Roadmap slice: `3.4.83 — Event Social Mobile Day-Of Summary`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/14-Engineering-Delivery-Policy.md`, and `docs/wiki/17-Release-Go-No-Go-Checklist.md`.
- Runtime verification used: rebuilt and recreated the local platform stack through Docker with `APP_VERSION=3.4.83`; verified `/api/health` reports frontend/backend/build `3.4.83`; verified the running platform container env reports `APP_EDITION=platform`, `APP_VERSION=3.4.83`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; verified the live DB reported `events_enabled=true` before implementation, after the rebuilt stack, after observability release evidence, and after restoring the platform stack; verified Help > Releases serves `v3.4.83` first; temporarily swapped to the generated public compose plus `.ci/docker-compose.build.yml`, verified `/api/auth/config` reports homelab behavior with `workspace_surface=false`, ran the homelab boundary smoke, then restored the local platform stack and rechecked `/api/health` and healthy container state.
- CI/checks run: source syntax check for `backend/scripts/unit-tests.js`; container backend unit/source assertions (`231` passed); container OpenAPI validation; container `test:event-social-planning-smoke` with `BASE_URL=http://frontend:3000`; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.83` before and after stack restore; container `test:init-parity`; container `test:migration-rehearsal`; container `test:rbac-regression`; container `test:platform-edition-boundary`; generated-compose `test:homelab-edition-boundary`; targeted Event/Collectibles browser regression (`15 passed`); full browser regression (`58 passed`, `4 skipped`); `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml config`; idempotent `npm run compose:generate`; `npm run validate:public-export`; Docker Node 20 backend/frontend `npm ci --dry-run --no-fund --ignore-scripts`; Docker Node 20 backend/frontend `npm audit --omit=dev --json`; `backend/scripts/observability-release-evidence.js`; `backend/scripts/release-preflight-local.js`; release-artifact secret-pattern grep over `docs/releases/v3.4.83.md`, `backend/release-feed.json`, `preflight-go-no-go.md`, dependency audit artifacts, migration/init artifacts, and observability artifacts; and `git diff --check`.
- Release artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.83.md`, and `backend/release-feed.json` are aligned on `3.4.83`; the running Help > Releases feed serves `v3.4.83` first while retaining recent Event-social releases; `artifacts/observability-evidence/observability-release-evidence.json` reports `3.4.83` with `9/9` checks passed; Docker Node 20 audit artifacts report backend low `0`, moderate `2`, high `0`, critical `0`, and frontend low `0`, moderate `0`, high `0`, critical `0`.
- Blocked/unverified items: the local release preflight helper marks secure-cookie compose smoke as blocked because the dev stack intentionally runs `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; `secret-scan` and `image-security-and-sbom` remain CI-only gates for the tagged release handoff.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/release-feed.json`, `backend/scripts/unit-tests.js`, `frontend/src/components/EventsView.jsx`, `tests/playwright/specs/events-collectibles.browser.spec.js`, `docker-compose.yml`, `docs/releases/v3.4.83.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/dependency-audit/backend-audit.json`, `artifacts/dependency-audit/frontend-audit.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: the mobile summary uses existing Event-local schedule, meetup, people, and group data only; future native companion behavior, push/Discord/email delivery, cross-event identity, external contacts, realtime presence, and broader friend graph work remain intentionally out of scope.
- What remains in the milestone: no remaining `3.4.83` implementation work; CI-only release gates must pass before public tag/release publication. The broader `Event Social Planning Mobile Web Experience` backlog item remains open for later native/platform companion validation and additional small mobile-social polish.
- Recommended commit message: `Release 3.4.83 event social mobile day-of summary`

## 3.4.84 — Event Catalog Mobile Time Window Filters

**Goal:** Continue the Event Schedule Catalog Now/Next follow-ups by helping mobile users narrow the catalog snapshot to sessions happening now, next, later today, or already planned without turning the drawer into a full catalog redesign.

**Current Slice:** `Closed 2026-05-03`

### Scope

- Add compact mobile-only time-window filters to the existing Event catalog Now / Next card.
- Support `All`, `Now`, `Next`, `Later Today`, and `Planned` windows with visible counts.
- Preserve conflict readback, shared attendance context, and quick plan-state actions inside filtered rows.
- Preserve the existing desktop catalog management and full catalog filter/edit surfaces.
- Keep full schedule discovery redesign, native companion behavior, push/Discord/email delivery, cross-event identity, external contacts, realtime presence, and broader friend graph work out of scope.

### Acceptance Criteria

- A mobile user can quickly filter the catalog Now / Next card to what is happening now, next, later today, or already planned.
- Filtered rows still show time/place context, shared attendance, conflicts, and quick plan actions.
- The default Now / Next card remains unchanged until the mobile user chooses a filter.
- Desktop catalog management remains unchanged.
- Version metadata and Help > Releases are aligned to `3.4.84`.

### Closeout Notes

- Roadmap slice: `3.4.84 — Event Catalog Mobile Time Window Filters`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/14-Engineering-Delivery-Policy.md`, and `docs/wiki/17-Release-Go-No-Go-Checklist.md`.
- Runtime verification used: rebuilt and recreated the local platform stack through Docker with `APP_VERSION=3.4.84`; verified `/api/health` reports frontend/backend/build `3.4.84`; verified the running platform container env reports `APP_EDITION=platform`, `APP_VERSION=3.4.84`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; verified the live DB reported `events_enabled=true` before implementation, after the rebuilt stack, after observability release evidence, and after restoring the platform stack; verified Help > Releases serves `v3.4.84` first; temporarily swapped to the generated public compose plus `.ci/docker-compose.build.yml`, verified `/api/auth/config` reports homelab behavior with `workspace_surface=false`, ran the homelab boundary smoke, then restored the local platform stack and rechecked `/api/health`, `events_enabled`, and healthy container state.
- CI/checks run: source syntax check for `backend/scripts/unit-tests.js`; container backend unit/source assertions (`231` passed); container OpenAPI validation; container `test:event-social-planning-smoke` with `BASE_URL=http://frontend:3000`; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.84` before and after stack restore; container `test:init-parity`; container `test:migration-rehearsal`; container `test:rbac-regression`; container `test:platform-edition-boundary`; generated-compose `test:homelab-edition-boundary`; targeted catalog Now/Next browser regression after fixing strict locator ambiguity; full Event/Collectibles browser regression (`15 passed`); full browser regression (`58 passed`, `4 skipped`); `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml config`; idempotent `npm run compose:generate`; `npm run validate:public-export`; Docker Node 20 backend/frontend `npm ci --dry-run --no-fund --ignore-scripts`; Docker Node 20 backend/frontend `npm audit --omit=dev --json`; `backend/scripts/observability-release-evidence.js`; `backend/scripts/release-preflight-local.js`; release-artifact secret-pattern grep over `docs/releases/v3.4.84.md`, `backend/release-feed.json`, `preflight-go-no-go.md`, dependency audit artifacts, migration/init artifacts, and observability artifacts; and `git diff --check`.
- Release artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.84.md`, and `backend/release-feed.json` are aligned on `3.4.84`; the running Help > Releases feed serves `v3.4.84` first while retaining recent Event-social releases; `artifacts/observability-evidence/observability-release-evidence.json` reports `3.4.84` with `9/9` checks passed; Docker Node 20 audit artifacts report backend low `0`, moderate `2`, high `0`, critical `0`, and frontend low `0`, moderate `0`, high `0`, critical `0`.
- Blocked/unverified items: the local release preflight helper marks secure-cookie compose smoke as blocked because the dev stack intentionally runs `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; `secret-scan` and `image-security-and-sbom` remain CI-only gates for the tagged release handoff.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/release-feed.json`, `backend/scripts/unit-tests.js`, `frontend/src/components/EventsView.jsx`, `tests/playwright/specs/events-collectibles.browser.spec.js`, `docker-compose.yml`, `docs/releases/v3.4.84.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: this slice filters the existing Now / Next snapshot only and intentionally does not redesign full catalog discovery, change schedule matching, add native companion behavior, enable push/Discord/email delivery, introduce cross-event identity, or broaden the friend graph.
- What remains in the milestone: no remaining `3.4.84` implementation work; CI-only release gates must pass before public tag/release publication. The broader `Event Schedule Catalog Now/Next Follow-ups` backlog item remains open for future full catalog discovery and richer mobile decision support.
- Recommended commit message: `Release 3.4.84 event catalog mobile time window filters`

## 3.4.85 — Kavita Digital Library Connection Foundation

**Goal:** Promote the Kavita digital-library backlog item into a bounded read-first foundation so admins can configure Kavita, prove native API connectivity, and inspect library/series readback without widening into metadata writeback, embedded reading, or full import/sync.

**Current Slice:** `Closed 2026-05-03`

### Scope

- Add admin-managed Kavita URL, API key, and timeout settings beside the existing CWA OPDS integration surface.
- Store the Kavita API key encrypted and return only redacted set/masked status in settings responses.
- Use Kavita native API authentication plus library and series readback for the first connection test.
- Expose an `Open Kavita` link from the integration settings when a base URL is configured.
- Keep Kavita separate from CWA/Calibre provider identity and leave shared digital-library provider abstractions for later.
- Keep metadata writeback, embedded/in-frame reading, reading progress, and full import/sync out of this slice.

### Acceptance Criteria

- Admins can save and test Kavita settings without affecting CWA OPDS settings.
- The test endpoint proves auth, library discovery, and a small series sample against a live/fake Kavita-compatible API.
- Settings responses never expose the raw Kavita API key.
- Kavita failures do not block non-Kavita integrations or core library actions.
- Version metadata and Help > Releases are aligned to `3.4.85`.

### Closeout Notes

- Roadmap slice: `3.4.85 — Kavita Digital Library Connection Foundation`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, and `docs/wiki/41-Kavita-Integration-Setup.md`.
- Runtime verification used: rebuilt and recreated the local platform stack through Docker with `APP_VERSION=3.4.85`; verified `/api/health` reports frontend/backend/build `3.4.85`; verified the running platform container env reports `APP_EDITION=platform`, `APP_VERSION=3.4.85`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; verified the live DB has the three Kavita integration columns; verified the live DB reported `events_enabled=true` before implementation, after the rebuilt stack, after observability release evidence, after homelab-stack verification, and after restoring the platform stack; verified Help > Releases serves `v3.4.85` first; temporarily swapped to generated public compose plus `.ci/docker-compose.build.yml`, verified `/api/auth/config` reports homelab behavior with `workspace_surface=false`, ran the homelab boundary smoke, then restored the local platform stack and rechecked `/api/health`, `events_enabled`, and healthy container state.
- CI/checks run: source syntax checks for touched backend routes/services/scripts; container frontend Vite production build during Docker image build; container backend unit/source assertions (`232` passed); container OpenAPI validation; container `test:kavita-connection-smoke` with `BASE_URL=http://frontend:3000`; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.85`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:rbac-regression` with `BASE_URL=http://frontend:3000`; container `test:platform-edition-boundary` with `BASE_URL=http://frontend:3000`; generated-compose `test:homelab-edition-boundary`; API integration smoke; targeted Integrations browser regression (`3 passed`); full browser regression (`58 passed`, `4 skipped`); `docker compose --env-file .env config`; idempotent `npm run compose:generate`; `npm run validate:public-export`; Docker/Node 20 frontend `npm ci --dry-run --no-fund --ignore-scripts`; backend/frontend dependency audits via npm 11/Corepack; `backend/scripts/observability-release-evidence.js`; `backend/scripts/release-preflight-local.js`; release-artifact secret-pattern grep over release notes, release feed, preflight, dependency audit artifacts, migration/init artifacts, and observability artifacts; and `git diff --check`.
- Release artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.85.md`, and `backend/release-feed.json` are aligned on `3.4.85`; the running Help > Releases feed serves `v3.4.85` first while retaining recent Event-social releases; `artifacts/observability-evidence/observability-release-evidence.json` reports `3.4.85` with `9/9` checks passed; npm audit artifacts report backend low `0`, moderate `2`, high `0`, critical `0`, and frontend low `0`, moderate `0`, high `0`, critical `0`.
- Verified facts: Kavita settings are saved with encrypted API key storage and redacted settings readback; the connection smoke proves plugin-auth, library discovery, series sampling, and link-out URL construction against a running collectZ stack and local Kavita-compatible API; the raw Kavita API key is not returned by settings or smoke readback; the Kavita tab is hidden from the space-scoped integration surface until space-owned Kavita behavior is explicitly designed; CWA OPDS settings remain separate.
- Inference: Kavita's native API is the better first read path than OPDS for this foundation because it exposes direct auth, library, and series readback in the official OpenAPI contract; full import/sync should still validate exact stable provider identity/link fields before using this read path for canonical media rows.
- Blocked/unverified items: local secure-cookie compose-smoke remains blocked by development runtime settings (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`); `secret-scan` and `image-security-and-sbom` remain CI-only gates for the tagged release handoff; real Kavita deployments may vary by reverse proxy, auth-key policy, or route shape and should be validated by operators with their own Kavita URL/API key.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/db/migrations.js`, `init.sql`, `backend/services/kavita.js`, `backend/services/integrations.js`, `backend/services/integrationResponse.js`, `backend/routes/integrations.js`, `backend/openapi/openapi.yaml`, `backend/scripts/kavita-connection-smoke.js`, `backend/scripts/unit-tests.js`, `frontend/src/components/AdminIntegrationsView.jsx`, `frontend/src/components/SpaceManagerView.jsx`, `tests/playwright/specs/admin-shell.browser.spec.js`, `tests/playwright/specs/integrations.browser.spec.js`, `docker-compose.yml`, `docs/releases/v3.4.85.md`, `docs/wiki/41-Kavita-Integration-Setup.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `backend/release-feed.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: this is read-first connection infrastructure only; metadata writeback, full Kavita import/sync, provider identity persistence on media rows, reading progress, embedded/in-app reading, and any shared Calibre/CWA/Kavita provider framework remain future milestones.
- What remains in the milestone: no remaining `3.4.85` implementation work; CI-only release gates must pass before public tag/release publication. Follow-on Kavita work should split into separate milestones for opt-in metadata writeback, full import/sync with stable provider identity, and reader/progress exploration.
- Recommended commit message: `Release 3.4.85 Kavita digital library connection foundation`

## 3.4.86 — Kavita Digital Library Import/Sync Foundation

**Goal:** Build on the Kavita connection foundation by adding an opt-in import/sync path that reads Kavita series into collectZ media rows without creating confusing duplicates or widening into writeback, embedded reading, or progress sync.

**Current Slice:** `Closed 2026-05-03`

### Scope

- Add a Kavita import endpoint that uses the native API connection from `3.4.85`.
- Normalize Kavita series into the existing media import/upsert pipeline.
- Use provider-scoped stable IDs (`kavita:series:<id>`) so Kavita identity does not collide with CWA/Calibre or other providers.
- Reuse safe existing non-Kavita titles in the active library/space instead of blindly creating duplicate rows.
- Add an admin import affordance from the Kavita integration settings.
- Add Docker-friendly smoke coverage for non-Kavita title reuse and repeat-sync idempotency.
- Keep metadata writeback to Kavita, embedded/in-frame reading, reading progress, cross-server identity, and friend/social reading features out of this slice.

### Acceptance Criteria

- Admins can queue a Kavita import from Admin > Integrations when imports are available.
- A Kavita import creates provider-linked media rows for new series.
- Re-running the same Kavita import updates/no-ops the existing provider-linked row instead of creating duplicates.
- A matching existing non-Kavita title in the same active library is reused and gains Kavita provider linkage while preserving existing local metadata.
- The running-stack smoke proves native API auth, series import, non-Kavita title reuse, repeat-sync idempotency, and redacted credential behavior.
- Version metadata and Help > Releases are aligned to `3.4.86`.

### Closeout Notes

- Roadmap slice: `3.4.86 — Kavita Digital Library Import/Sync Foundation`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, and `docs/wiki/41-Kavita-Integration-Setup.md`.
- Runtime verification used: rebuilt and recreated the local platform stack through Docker with `APP_VERSION=3.4.86`; verified `/api/health` reports frontend/backend/build `3.4.86`; verified `/api/auth/config` reports platform behavior after restore; verified the live DB reported `events_enabled=true` before implementation, after the rebuilt stack, after observability release evidence, and after restoring the platform stack; verified Help > Releases serves `v3.4.86` first; temporarily swapped to generated public compose plus `.ci/docker-compose.build.yml`, verified `/api/auth/config` reports homelab behavior with `workspace_surface=false`, ran the homelab boundary smoke, then restored the local platform stack and rechecked `/api/health`, `events_enabled`, and healthy container state.
- CI/checks run: source syntax checks for touched backend route/service/scripts; container frontend Vite production build during Docker image build; container backend unit/source assertions (`233` passed); container OpenAPI validation; container `test:kavita-connection-smoke` with `BASE_URL=http://frontend:3000`; container `test:kavita-import-sync-smoke` with `BASE_URL=http://frontend:3000`; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.86`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:rbac-regression` with `BASE_URL=http://frontend:3000`; container `test:platform-edition-boundary` with `BASE_URL=http://frontend:3000`; generated-compose `test:homelab-edition-boundary`; API integration smoke; targeted Integrations/Admin Shell browser regression (`8 passed`); full browser regression (`58 passed`, `4 skipped`); `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml config`; `npm run validate:public-export`; backend/frontend dependency audits via npm 11/Corepack; `backend/scripts/observability-release-evidence.js`; `backend/scripts/release-preflight-local.js`; release-artifact secret-pattern grep over dependency audit, migration/init, observability, release note, release feed, and preflight artifacts; and `git diff --check`.
- Release artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.86.md`, and `backend/release-feed.json` are aligned on `3.4.86`; the running Help > Releases feed serves `v3.4.86` first while retaining recent Event/Kavita releases; `artifacts/observability-evidence/observability-release-evidence.json` reports `3.4.86` with `9/9` checks passed; npm audit artifacts report backend low `0`, moderate `2`, high `0`, critical `0`, and frontend low `0`, moderate `0`, high `0`, critical `0`.
- Verified facts: `/api/media/import-kavita` imports Kavita series through the native Plugin/authenticate plus Series/all-v2 path; Kavita provider IDs are scoped as `kavita:series:<id>`; the running-stack import smoke proves an existing non-Kavita book title is reused and updated with Kavita provider linkage without losing existing author metadata; a second Kavita import reuses the canonical row with `created=0`, `updated=1`, and one canonical provider row; the Admin Kavita panel can queue `Import from Kavita`; raw Kavita API keys are not returned by settings/test/import smoke readback.
- Inference: exact title/media-type fallback remains appropriate for this first Kavita import foundation because it is scoped to the active library/space and still runs after stronger identifier/provider/normalization checks; broader fuzzy title matching, cross-event/social reading, and cross-server identity should stay separate.
- Blocked/unverified items: local secure-cookie compose-smoke remains blocked by development runtime settings (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`); `secret-scan` and `image-security-and-sbom` remain CI-only gates for the tagged release handoff; real Kavita deployments may expose richer per-volume/chapter metadata that this first series-level importer intentionally does not consume yet.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/db/migrations.js`, `init.sql`, `backend/services/kavita.js`, `backend/services/integrations.js`, `backend/services/integrationResponse.js`, `backend/routes/integrations.js`, `backend/routes/media.js`, `backend/openapi/openapi.yaml`, `backend/scripts/kavita-connection-smoke.js`, `backend/scripts/kavita-import-sync-smoke.js`, `backend/scripts/unit-tests.js`, `frontend/src/components/AdminIntegrationsView.jsx`, `frontend/src/components/SpaceManagerView.jsx`, `tests/playwright/specs/admin-shell.browser.spec.js`, `tests/playwright/specs/integrations.browser.spec.js`, `docker-compose.yml`, `docs/releases/v3.4.85.md`, `docs/releases/v3.4.86.md`, `docs/wiki/41-Kavita-Integration-Setup.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `backend/release-feed.json`, `artifacts/dependency-audit/backend-audit.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: Kavita import is series-level and read-only; metadata writeback, chapter/volume-level mapping, embedded/in-frame reading, reading progress, per-space Kavita administration, fuzzy duplicate review UI, and shared Calibre/CWA/Kavita provider abstractions remain future work.
- What remains in the milestone: no remaining `3.4.86` implementation work; CI-only release gates must pass before public tag/release publication. Follow-on Kavita work should split into separate milestones for richer metadata mapping/writeback, reader/progress exploration, and provider framework cleanup.
- Recommended commit message: `Release 3.4.86 Kavita digital library import sync foundation`

## 3.4.87 — Kavita Metadata Mapping Detail Foundation

**Goal:** Make Kavita-imported rows richer and more trustworthy by preserving native library and series detail metadata while keeping the integration read-only and avoiding reader/progress/writeback scope.

**Current Slice:** `Closed 2026-05-04`

### Scope

- Map Kavita library and series identifiers, names, type, format, pages, sort/original/localized names, and cover source metadata into collectZ provider detail fields.
- Improve book versus comic classification from Kavita library type before falling back to name hints.
- Preserve the safe existing-title reuse and repeat-sync idempotency from `3.4.86`.
- Add smoke coverage for book and comic Kavita libraries importing side by side.
- Keep metadata writeback to Kavita, embedded/in-frame reading, reading progress, cross-server identity, and provider framework cleanup out of this slice.

### Acceptance Criteria

- Kavita book-library series import as `book`; Kavita comic/manga-library series import as `comic_book`.
- Imported rows retain stable Kavita library/series metadata in `type_details`.
- Existing non-Kavita title reuse still preserves local metadata while adding Kavita detail fields.
- Repeat Kavita import remains idempotent and does not create duplicate rows.
- Version metadata and Help > Releases are aligned to `3.4.87`.

### Closeout Notes

- Roadmap slice: `3.4.87 — Kavita Metadata Mapping Detail Foundation`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, and `docs/wiki/41-Kavita-Integration-Setup.md`.
- Runtime verification used: rebuilt and recreated the local platform stack through Docker with `APP_VERSION=3.4.87`; verified `/api/health` reports frontend/backend/build `3.4.87`; verified `/api/auth/config` reports platform behavior after restore; verified the live DB reported `events_enabled=true` before implementation, after the rebuilt stack, after observability release evidence, and after restoring the platform stack; verified Help > Releases serves `v3.4.87` first; temporarily swapped to generated public compose plus `.ci/docker-compose.build.yml`, verified `/api/auth/config` reports homelab behavior with `workspace_surface=false`, ran the homelab boundary smoke, then restored the local platform stack and rechecked `/api/health`, `events_enabled`, and healthy container state.
- CI/checks run: source syntax checks for touched backend service/scripts; container frontend Vite production build during Docker image build; container backend unit/source assertions (`234` passed); container OpenAPI validation; container `test:kavita-connection-smoke` with `BASE_URL=http://frontend:3000`; container `test:kavita-import-sync-smoke` with `BASE_URL=http://frontend:3000`; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.87`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:rbac-regression` with `BASE_URL=http://frontend:3000`; container `test:platform-edition-boundary` with `BASE_URL=http://frontend:3000`; generated-compose `test:homelab-edition-boundary`; API integration smoke; targeted Event browser rerun for the now/next fixture; full browser regression (`58 passed`, `4 skipped`); `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml config`; `npm run validate:public-export`; backend/frontend dependency audits via npm 11/Corepack; `backend/scripts/observability-release-evidence.js`; `backend/scripts/release-preflight-local.js`; release-artifact secret-pattern grep over dependency audit, migration/init, observability, release note, release feed, and preflight artifacts; and `git diff --check`.
- Release artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.87.md`, and `backend/release-feed.json` are aligned on `3.4.87`; the running Help > Releases feed serves `v3.4.87` first while retaining recent Kavita/Event releases; `artifacts/observability-evidence/observability-release-evidence.json` reports `3.4.87` with `9/9` checks passed; npm audit artifacts report backend low `0`, moderate `2`, high `0`, critical `0`, and frontend low `0`, moderate `0`, high `0`, critical `0`.
- Verified facts: Kavita imports now persist library id, library name, normalized library type, series id, series names, format, pages, and cover source in provider detail fields; Kavita library type `2` classifies as `book` and type `1` classifies as `comic_book`; the running-stack import smoke proves a non-Kavita book title with matching date metadata is reused, a comic row is created from a separate Kavita library, repeat import updates both canonical rows with `created=0`, and raw Kavita secrets are not returned.
- Inference: numeric Kavita library type mapping follows the native API enum shape used by the existing fake-compatible API and common Kavita contracts (`manga`, `comic`, `book`); deployments with custom or future library type values will fall back to the existing name-hint classifier until a later provider-contract expansion.
- Blocked/unverified items: local secure-cookie compose-smoke remains blocked by development runtime settings (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`); `secret-scan` and `image-security-and-sbom` remain CI-only gates for the tagged release handoff; real Kavita deployments may expose richer volume/chapter/person metadata that this series-level mapper intentionally does not consume yet.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/services/kavita.js`, `backend/services/typeDetails.js`, `backend/routes/media.js`, `backend/scripts/kavita-import-sync-smoke.js`, `backend/scripts/unit-tests.js`, `tests/playwright/specs/events-collectibles.browser.spec.js`, `docker-compose.yml`, `docs/releases/v3.4.87.md`, `docs/wiki/07-Release-Roadmap.md`, `backend/release-feed.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: Kavita import remains series-level and read-only; metadata writeback, volume/chapter/person enrichment, embedded/in-frame reading, reading progress, per-space Kavita administration, fuzzy duplicate review UI, and shared Calibre/CWA/Kavita provider abstractions remain future work.
- What remains in the milestone: no remaining `3.4.87` implementation work; CI-only release gates must pass before public tag/release publication. A good next Kavita slice is either volume/chapter detail enrichment or read-only external-reader launch/progress contract discovery, but not both at once.
- Recommended commit message: `Release 3.4.87 Kavita metadata mapping detail foundation`

## 3.4.88 — Kavita Volume/Chapter Detail Enrichment

**Goal:** Add deeper read-only Kavita volume and chapter metadata to imported rows so issue/chapter counts, volume numbers, chapter titles, publication dates, page counts, and comic issue mapping are more trustworthy without expanding into writeback or reader/progress scope.

**Current Slice:** `Closed 2026-05-04`

### Scope

- Read Kavita volume/chapter detail from the native API during import.
- Preserve issue/chapter counts, volume numbers, first chapter identifiers/titles/publication dates/page counts, total chapter pages, and compact chapter title summaries in Kavita provider detail fields.
- Improve comic issue mapping from clear Kavita volume/chapter detail when the imported row is already classified as `comic_book`.
- Preserve existing non-Kavita title reuse, repeat-sync idempotency, and local/manual metadata.
- Keep metadata writeback to Kavita, embedded/in-frame reading, reading progress, cross-server identity, and provider framework cleanup out of this slice.

### Acceptance Criteria

- Kavita imports query `/api/Series/volumes` for imported series within a bounded detail budget.
- Imported book and comic rows retain volume/chapter counts and first-chapter metadata in `type_details`.
- Comic imports can fill missing `volume`, `issue_number`, and `cover_date` from clear Kavita chapter detail.
- Repeat Kavita import remains idempotent and existing non-Kavita title reuse still preserves local metadata.
- Version metadata and Help > Releases are aligned to `3.4.88`.

### Closeout Notes

- Roadmap slice: `3.4.88 — Kavita Volume/Chapter Detail Enrichment`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, and `docs/wiki/41-Kavita-Integration-Setup.md`.
- Runtime verification used: rebuilt and recreated the local platform stack through Docker with `APP_VERSION=3.4.88`; verified `/api/health` reports frontend/backend/build `3.4.88`; verified `/api/auth/config` reports platform behavior after restore; verified the live DB reported `events_enabled=true` before implementation, after the rebuilt stack, after observability release evidence, and after restoring the platform stack; verified Help > Releases serves `v3.4.88` first; temporarily swapped to generated public compose plus `.ci/docker-compose.build.yml`, verified `/api/auth/config` reports homelab behavior with `workspace_surface=false`, ran the homelab boundary smoke, then restored the local platform stack and rechecked `/api/health`, `/api/auth/config`, `events_enabled`, and healthy container state.
- CI/checks run: source syntax checks for touched backend service/scripts; local backend unit/source assertions (`234` passed); container frontend Vite production build during Docker image build; container backend unit/source assertions (`234` passed); container OpenAPI validation; container `test:kavita-connection-smoke` with `BASE_URL=http://frontend:3000`; container `test:kavita-import-sync-smoke` with `BASE_URL=http://frontend:3000`; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.88`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:rbac-regression` with `BASE_URL=http://frontend:3000`; container `test:platform-edition-boundary` with `BASE_URL=http://frontend:3000`; generated-compose `test:homelab-edition-boundary`; API integration smoke; full browser regression (`58 passed`, `4 skipped`); `docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml config`; `npm run validate:public-export`; backend/frontend dependency audits via npm 11/Corepack; `backend/scripts/observability-release-evidence.js`; `backend/scripts/release-preflight-local.js`; release-artifact secret-pattern scan over dependency audit, migration/init, observability, release note, release feed, and preflight artifacts; and `git diff --check`.
- Release artifacts: `app-meta.json`, backend/frontend app meta, backend/frontend package and lockfile versions, generated `docker-compose.yml`, `docs/releases/v3.4.88.md`, and `backend/release-feed.json` are aligned on `3.4.88`; the running Help > Releases feed serves `v3.4.88` first while retaining recent Kavita/Event releases; `artifacts/observability-evidence/observability-release-evidence.json` reports `3.4.88` with `9/9` checks passed; npm audit artifacts report backend low `0`, moderate `2`, high `0`, critical `0`, and frontend low `0`, moderate `0`, high `0`, critical `0`.
- Verified facts: Kavita imports now call `/api/Series/volumes` for imported series within a bounded detail budget; imported rows persist Kavita volume count, chapter count, volume number list, first chapter id/number/title/release date/page count, compact chapter title summaries, and total chapter pages in `type_details`; comic rows fill missing `volume`, `issue_number`, and `cover_date` from clear first-volume/first-chapter metadata; the running-stack import smoke proves an existing non-Kavita book title is reused, a Kavita comic is classified from library type, volume details are fetched for both rows, repeat import remains idempotent, and raw Kavita secrets are not returned.
- Inference: using the first non-special chapter is the least surprising series-level comic issue mapping for this read-only importer; multi-issue series may still need a later per-issue expansion if collectZ starts importing Kavita chapters as individual media rows.
- Blocked/unverified items: local secure-cookie compose-smoke remains blocked by development runtime settings (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`); `secret-scan` and `image-security-and-sbom` remain CI-only gates for the tagged release handoff; real Kavita deployments with very large libraries may hit the bounded volume-detail budget and should tune or expand that import contract in a later slice.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/services/kavita.js`, `backend/services/typeDetails.js`, `backend/routes/media.js`, `backend/scripts/kavita-import-sync-smoke.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.88.md`, `docs/wiki/07-Release-Roadmap.md`, `backend/release-feed.json`, `artifacts/dependency-audit/backend-audit.json`, `artifacts/dependency-audit/frontend-audit.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: Kavita import remains series-level and read-only; metadata writeback, embedded/in-frame reading, reading progress, chapter-as-issue row fan-out, per-space Kavita administration, and shared Calibre/CWA/Kavita provider abstractions remain future work.
- What remains in the milestone: no remaining `3.4.88` implementation work; CI-only release gates must pass before public tag/release publication. A good next Kavita slice is read-only external-reader launch/progress contract discovery, kept separate from writeback.
- Recommended commit message: `Release 3.4.88 Kavita volume chapter detail enrichment`

## 3.4.89 — Kavita External Reader Launch Contract

**Goal:** Give Kavita-imported rows a clear, safe launch path back into Kavita's native web UI without embedding Kavita, proxying pages, syncing reading progress, or pushing metadata back to Kavita.

**Current Slice:** `Closed 2026-05-04`

### Scope

- Define Kavita launch URLs from stored library, series, format, and first-chapter ids.
- Prefer Kavita's native reader routes for imported rows with chapter detail, while keeping a series-detail URL as fallback.
- Surface a clear `Open in Kavita` or `Read in Kavita` action in collectZ media details.
- Prove launch URLs are built from configured base URL and Kavita ids without API keys, OPDS keys, bearer tokens, or other credentials.
- Keep embedded iframe reading, page streaming, reading progress sync, metadata writeback, per-space Kavita administration, and provider abstraction cleanup out of this slice.

### Acceptance Criteria

- Imported Kavita rows retain `kavita_series_url`, `kavita_launch_url`, `kavita_launch_label`, and `kavita_launch_target` provider detail fields.
- Book, PDF, and comic/manga launch helpers use Kavita's native web route shape and preserve reverse-proxy base paths.
- Media detail source links show Kavita actions without treating collectZ as an embedded reader.
- Kavita import smoke proves launch URLs are secret-free and repeat sync remains idempotent.
- Version metadata and Help > Releases are aligned to `3.4.89`.

### Closeout Notes

- Roadmap slice: `3.4.89 — Kavita External Reader Launch Contract`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, and `docs/wiki/41-Kavita-Integration-Setup.md`.
- Runtime verification used: rebuilt Docker platform stack at `3.4.89`, `/api/health`, `/api/auth/config`, in-stack Help > Releases smoke, Kavita connection smoke, Kavita import/sync smoke with `Read in Kavita` launch URL readback, homelab default-compose boundary smoke, and live DB `events_enabled=true` readback before and after the slice.
- CI/checks run locally: syntax checks for Kavita/media/unit scripts, backend unit tests, OpenAPI validation, Kavita connection smoke, Kavita import/sync smoke, Help > Releases smoke, init parity, migration rehearsal, RBAC regression, API integration smoke, platform edition boundary, homelab edition boundary, full Playwright browser regression, public export validation, local release preflight/dependency audit, observability release evidence, compose config generation, and generated-artifact secret-pattern scan.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata, `docker-compose.yml`, `docs/releases/v3.4.89.md`, and `backend/release-feed.json` are aligned to `3.4.89`.
- Release gate accounting: `compose-smoke` was locally covered by rebuilt stack health, `/api/health`, `/api/auth/config`, and compose config generation; `rbac-regression`, `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, and `dependency-scan` passed locally; `secret-scan` and `image-security-and-sbom` remain CI-only locally because `gitleaks`, `trivy`, and SBOM tooling were not installed in the local shell.
- Risks/follow-ups: embedded iframe reading, page streaming, reading progress sync, metadata writeback, per-space Kavita administration, chapter-as-issue fan-out, and shared provider abstraction cleanup remain out of scope and stay in backlog.
- What remains in the milestone: no open `3.4.89` work remains.
- Recommended commit message: `Release 3.4.89 Kavita external reader launch contract`.

## 3.4.90 — Kavita Cover Art Source Hardening

**Goal:** Make Kavita-owned cover art render reliably through collectZ without exposing Kavita credentials, while keeping fallback enrichment from Metron, Google Books, or Open Library-style sources separate.

**Current Slice:** `Closed 2026-05-04`

### Scope

- Use Kavita `coverImage` as the first cover-art source for Kavita-imported rows.
- Store raw Kavita cover source metadata for troubleshooting.
- Serve imported Kavita covers through an authenticated collectZ proxy tied to visible Kavita rows in the active scope.
- Ensure frontend image rendering treats collectZ `/api/...` image paths as same-origin instead of rewriting them as TMDB poster paths.
- Prove cover proxy readback does not leak Kavita API keys, OPDS keys, bearer tokens, or other credentials.
- Keep Metron/Google Books fallback enrichment, metadata writeback, embedded reading, reader page proxying, and progress sync out of this slice.

### Acceptance Criteria

- Kavita imports with `coverImage` store `kavita_cover_image`, `kavita_cover_url`, `kavita_cover_proxy_url`, `kavita_cover_source`, and `kavita_cover_status`.
- Imported Kavita rows use the collectZ cover proxy as `poster_path`.
- The Kavita cover proxy only serves covers for Kavita rows in the active scope and fetches the Kavita image server-side.
- Kavita import smoke proves proxied cover readback works and remains secret-free.
- Version metadata and Help > Releases are aligned to `3.4.90`.

### Closeout Notes

- Roadmap slice: `3.4.90 — Kavita Cover Art Source Hardening`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, and `docs/wiki/41-Kavita-Integration-Setup.md`.
- Runtime verification used: rebuilt Docker platform stack at `3.4.90`, `/api/health`, `/api/auth/config`, in-stack Help > Releases smoke, Kavita connection smoke, Kavita import/sync smoke with cover proxy image readback, isolated generated-compose homelab boundary stack, and live DB `events_enabled=true` readback before and after the slice.
- CI/checks run locally: syntax checks for touched Kavita/media/unit scripts; local backend unit/source assertions (`238` passed); local OpenAPI validation; container backend unit/source assertions (`238` passed); container OpenAPI validation; container `test:kavita-connection-smoke`; container `test:kavita-import-sync-smoke` rerun isolated after an intentional-smoke shared-config collision; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.90`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:rbac-regression`; container `test:platform-edition-boundary`; isolated generated-compose `test:homelab-edition-boundary`; API integration smoke; targeted Event catalog Now/Next browser repair spec; full browser regression (`58` passed, `4` skipped); `npm run validate:public-export`; `npm run compose:generate`; local release preflight/dependency audit; observability release evidence; release-artifact secret-pattern scan; and `git diff --check`.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata, `docker-compose.yml`, `docs/releases/v3.4.90.md`, and `backend/release-feed.json` are aligned to `3.4.90`.
- Release gate accounting: `compose-smoke` was locally covered by rebuilt stack health, `/api/health`, `/api/auth/config`, and compose config generation; `rbac-regression`, `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, and local dependency audit passed locally; `secret-scan` and `image-security-and-sbom` remain CI-only locally because `gitleaks`, `trivy`, and SBOM tooling were not installed in the local shell.
- Risks/follow-ups: Metron, Google Books, or Open Library-style fallback cover enrichment, embedded reading, page streaming, reading progress sync, metadata writeback, reader page proxying, per-space Kavita administration, chapter-as-issue fan-out, and shared provider abstraction cleanup remain out of scope and stay in backlog.
- What remains in the milestone: no open `3.4.90` work remains.
- Recommended commit message: `Release 3.4.90 Kavita cover art source hardening`.

## 3.4.91 — Kavita Reader and Progress Contract Discovery

**Goal:** Document the reader/progress API boundary for Kavita before collectZ attempts embedded reading, page streaming, or progress sync.

**Current Slice:** `Closed 2026-05-04`

### Scope

- Review Kavita's current upstream OpenAPI reader/progress endpoints.
- Document which paths are read-like, write-like, or side-effectful.
- Preserve the current native Kavita link-out behavior as the approved path.
- Make the security boundary explicit for Kavita auth keys, OPDS keys, browser sessions, reader content, and progress state.
- Add a lightweight repo guard so future work does not accidentally treat iframe reading, page proxying, or progress writeback as approved.
- Keep embedded iframe reading, page streaming, reading progress writeback, per-space Kavita administration, metadata writeback, and provider abstraction cleanup out of this slice.

### Acceptance Criteria

- A dedicated reader/progress contract doc exists with a recommendation for link-out, embed, and progress-sync paths.
- The setup doc points to the reader/progress contract.
- Unit/source assertions keep the documented no-iframe, no-reader-proxy, and no-progress-writeback boundary visible.
- Version metadata and Help > Releases are aligned to `3.4.91`.

### Closeout Notes

- Roadmap slice: `3.4.91 — Kavita Reader and Progress Contract Discovery`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/41-Kavita-Integration-Setup.md`, and `docs/wiki/42-Kavita-Reader-Progress-Contract.md`.
- Runtime verification used: rebuilt Docker platform stack at `3.4.91`, `/api/health`, `/api/auth/config`, in-stack Help > Releases smoke, Kavita connection smoke, Kavita import/sync smoke, isolated generated-compose homelab boundary stack, and live DB `events_enabled=true` readback before and after the slice.
- CI/checks run locally: source syntax check for `backend/scripts/unit-tests.js`; local backend unit/source assertions (`239` passed); local OpenAPI validation; container backend unit/source assertions (`239` passed); container OpenAPI validation; container `test:kavita-connection-smoke`; container `test:kavita-import-sync-smoke`; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.91`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:rbac-regression`; container `test:platform-edition-boundary`; isolated generated-compose `test:homelab-edition-boundary`; API integration smoke; targeted Space Manager browser rerun after a transient concurrent-release-helper 502; full browser regression rerun cleanly (`58` passed, `4` skipped); `npm run validate:public-export`; `npm run compose:generate`; local release preflight; Docker Node 20 backend/frontend dependency audits; observability release evidence; release-artifact secret-pattern scan; and `git diff --check`.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata, `docker-compose.yml`, `docs/releases/v3.4.91.md`, and `backend/release-feed.json` are aligned to `3.4.91`.
- Release gate accounting: `compose-smoke` was locally covered by rebuilt stack health, `/api/health`, `/api/auth/config`, and compose config generation; `rbac-regression`, `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, and Docker Node 20 dependency audit passed locally; `secret-scan` and `image-security-and-sbom` remain CI-only locally because `gitleaks`, `trivy`, and SBOM tooling were not installed in the local shell.
- Verified facts: Kavita upstream OpenAPI `0.9.0.0` still exposes reader content, reader navigation, progress read, progress write, bookmark/personal-reader-state, and KOReader sync endpoints; collectZ remains link-out only for Kavita reader use; no iframe reader, reader page proxy, or progress writeback implementation was added in this slice.
- Risks/follow-ups: embedded iframe reading, page streaming, progress readback, progress writeback, metadata writeback, per-space Kavita administration, chapter-as-issue fan-out, and shared provider abstraction cleanup remain out of scope and stay in backlog.
- What remains in the milestone: no open `3.4.91` work remains.
- Recommended commit message: `Release 3.4.91 Kavita reader and progress contract discovery`.

## 3.4.92 — Kavita Chapter-as-Issue Row Fan-out Contract

**Goal:** Define how selected Kavita comic/manga chapters can later become individual collectZ `comic_book` rows without colliding with the existing series-level import model.

**Current Slice:** `Closed 2026-05-04`

### Scope

- Document the opt-in fan-out contract for Kavita comic/manga chapters.
- Define provider identity for series rows and chapter/issue rows.
- Define when a Kavita chapter is eligible to become a collectZ `comic_book` row.
- Document duplicate handling and local metadata preservation rules.
- Define smoke coverage for repeat sync idempotency and duplicate issue avoidance.
- Keep implementation, embedded reading, reader page proxying, progress sync, metadata writeback, per-space Kavita administration, and shared provider abstraction cleanup out of this slice.

### Acceptance Criteria

- A dedicated chapter-as-issue fan-out contract doc exists.
- The setup doc points to the fan-out contract and states fan-out remains off by default.
- Unit/source assertions keep the `kavita:series:{seriesId}` versus `kavita:chapter:{chapterId}` identity boundary visible.
- The smoke plan proves repeat sync idempotency, local metadata preservation, book-library exclusion, and secret-free launch/cover URLs.
- Version metadata and Help > Releases are aligned to `3.4.92`.

### Closeout Notes

- Roadmap slice: `3.4.92 — Kavita Chapter-as-Issue Row Fan-out Contract`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/41-Kavita-Integration-Setup.md`, and `docs/wiki/43-Kavita-Chapter-Issue-Fanout-Contract.md`.
- Runtime verification used: rebuilt Docker platform stack at `3.4.92`, `/api/health`, `/api/auth/config`, in-stack Help > Releases smoke, Kavita connection smoke, Kavita import/sync smoke proving default series-level import remains intact, isolated generated-compose homelab boundary stack, and live DB `events_enabled=true` readback before and after the slice.
- CI/checks run locally: source syntax check for `backend/scripts/unit-tests.js`; local backend unit/source assertions (`240` passed); local OpenAPI validation; container backend unit/source assertions (`240` passed); container OpenAPI validation; container `test:kavita-connection-smoke`; container `test:kavita-import-sync-smoke`; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.92`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:rbac-regression` rerun isolated after an initial concurrent fixture collision; container `test:platform-edition-boundary`; isolated generated-compose `test:homelab-edition-boundary`; API integration smoke; full browser regression (`58` passed, `4` skipped); `npm run validate:public-export`; `npm run compose:generate`; local release preflight; Docker Node 20 backend/frontend dependency audits; observability release evidence; release-artifact secret-pattern scan; and `git diff --check`.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata, `docker-compose.yml`, `docs/releases/v3.4.92.md`, and `backend/release-feed.json` are aligned to `3.4.92`.
- Release gate accounting: `compose-smoke` was locally covered by rebuilt stack health, `/api/health`, `/api/auth/config`, and compose config generation; `rbac-regression`, `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, and Docker Node 20 dependency audit passed locally; `secret-scan` and `image-security-and-sbom` remain CI-only locally because `gitleaks`, `trivy`, and SBOM tooling were not installed in the local shell.
- Verified facts: current collectZ Kavita import still creates the canonical series rows only by default; the contract defines future opt-in chapter issue ids as `kavita:chapter:{chapterId}` while preserving existing series ids as `kavita:series:{seriesId}`; no fan-out implementation, reader embedding, reader proxying, progress sync, or metadata writeback was added in this slice.
- Risks/follow-ups: implementing opt-in fan-out, UI/import controls for selected chapters, high-confidence local issue reuse, embedded reading, progress sync, metadata writeback, per-space Kavita administration, and shared provider abstraction cleanup remain out of scope and stay in backlog.
- What remains in the milestone: no open `3.4.92` work remains.
- Recommended commit message: `Release 3.4.92 Kavita chapter-as-issue row fan-out contract`.

## 3.4.93 — Kavita Chapter-as-Issue Row Fan-out Implementation

**Goal:** Actually add the opt-in import behavior defined in `3.4.92`, while preserving default series-level Kavita imports and keeping the integration read-only.

**Current Slice:** `Closed 2026-05-04`

### Scope

- Add a default-off `chapterFanout` option to Kavita import.
- Fan out eligible comic/manga Kavita chapters into individual `comic_book` rows.
- Keep series rows as `provider_item_id = kavita:series:{seriesId}` and chapter rows as `provider_item_id = kavita:chapter:{chapterId}`.
- Preserve the parent series row and link chapter rows back to it through Kavita provider metadata.
- Skip book libraries, unknown library types, and special chapters.
- Keep native Kavita launch URLs secret-free and do not call reader/progress endpoints.
- Extend the Kavita import smoke to prove default behavior, opt-in issue creation, repeat-sync idempotency, book exclusion, special-chapter skipping, cover proxy behavior, and credential-free URLs.
- Keep embedded reading, page proxying, progress sync, metadata writeback, per-space Kavita administration, and shared provider abstractions out of this slice.

### Acceptance Criteria

- Default Kavita import still creates only the canonical series-level rows.
- Opt-in fan-out creates comic chapter issue rows with `provider_item_id` and `provider_issue_id` set to `kavita:chapter:{chapterId}`.
- Repeat opt-in fan-out sync creates no duplicate issue rows.
- Book libraries do not fan out into comic issue rows.
- Special chapters are skipped unless a later explicit option is added.
- The admin Kavita import surface exposes the opt-in behavior without making it default.
- Version metadata and Help > Releases are aligned to `3.4.93`.

### Closeout Notes

- Roadmap slice: `3.4.93 — Kavita Chapter-as-Issue Row Fan-out Implementation`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/41-Kavita-Integration-Setup.md`, and `docs/wiki/43-Kavita-Chapter-Issue-Fanout-Contract.md`.
- Runtime verification used: rebuilt Docker platform stack at `3.4.93`, `/api/health`, `/api/auth/config`, in-stack Help > Releases smoke, Kavita connection smoke, Kavita import/sync smoke proving default series-level import plus opt-in chapter fan-out, isolated generated-compose homelab boundary stack, restored platform stack health, and live DB `events_enabled=true` readback before and after evidence/tooling.
- CI/checks run locally: source syntax checks for touched backend scripts/services/routes; container backend unit/source assertions (`241` passed); container OpenAPI validation; container `test:kavita-connection-smoke`; container `test:kavita-import-sync-smoke`; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.93`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:rbac-regression`; container `test:platform-edition-boundary`; isolated generated-compose `test:homelab-edition-boundary`; API integration smoke; full browser regression (`58` passed, `4` skipped); `npm run validate:public-export`; `npm run compose:generate`; local release preflight; Docker Node 20 backend/frontend dependency audits; observability release evidence; release-artifact secret-pattern scan; and `git diff --check`.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata, `docker-compose.yml`, `docs/releases/v3.4.93.md`, and `backend/release-feed.json` are aligned to `3.4.93`.
- Release gate accounting: `compose-smoke` was locally covered by rebuilt stack health, `/api/health`, `/api/auth/config`, and compose generation; `rbac-regression`, `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, and Docker Node 20 dependency audit passed locally; `secret-scan` and `image-security-and-sbom` remain CI-only locally because `gitleaks`, `trivy`, and SBOM tooling were not installed in the local shell.
- Verified facts: default Kavita import still creates only series-level rows; opt-in `chapterFanout` creates comic chapter rows keyed as `kavita:chapter:{chapterId}` without duplicating repeat sync; an existing local comic issue can be reused by high-confidence series/volume/issue normalization after provider-id lookup fails; book libraries and special chapters do not fan out; launch and cover proxy URLs remain credential-free; no reader/progress endpoints were added.
- Risks/follow-ups: embedded reading, reader page proxying, progress sync, metadata writeback, per-space Kavita administration, shared Calibre/CWA/Kavita provider abstractions, and optional special-chapter import remain future work.
- What remains in the milestone: no open `3.4.93` work remains.
- Recommended commit message: `Release 3.4.93 Kavita chapter-as-issue row fan-out implementation`.

## 3.4.94 — Kavita Workspace-Owned Integration Administration Contract

**Goal:** Define Kavita administration as workspace-owned integration behavior before moving credentials, testing, import, cover proxying, and fan-out controls into the workspace settings surface.

**Current Slice:** `Closed 2026-05-04`

### Scope

- Document that Kavita settings should be owned by the active workspace.
- Define workspace-admin permissions for save, test, import, fan-out, readback, and clear actions.
- Define how platform admins may manage Kavita only within workspace context or an explicit support/control-plane action.
- Define homelab behavior as effectively single-workspace while still following the workspace-owned model.
- Define scope rules so overlapping Kavita series/chapter ids in different workspaces cannot collide.
- Define migration recommendations for legacy platform-level Kavita settings.
- Keep implementation, embedded reading, reader page proxying, progress sync, metadata writeback, special-chapter fan-out, and shared provider abstractions out of this slice.

### Acceptance Criteria

- A dedicated workspace-owned Kavita administration contract doc exists.
- The Kavita setup doc links to the workspace-owned administration contract.
- The backlog records that the contract was promoted while implementation remains separate.
- Unit/source assertions keep the workspace-owned, workspace-admin, cross-space isolation, and credential-redaction boundaries visible.
- Version metadata and Help > Releases are aligned to `3.4.94`.

### Closeout Notes

- Roadmap slice: `3.4.94 — Kavita Workspace-Owned Integration Administration Contract`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/41-Kavita-Integration-Setup.md`, and `docs/wiki/44-Kavita-Workspace-Owned-Administration-Contract.md`.
- Runtime verification used: rebuilt the Docker platform stack with `APP_VERSION=3.4.94`; verified container health, `/api/health`, `/api/auth/config`, in-stack Help > Releases smoke for `v3.4.94`, and live DB `events_enabled=true` readback after release evidence tooling completed.
- CI/checks run locally: source syntax check for `backend/scripts/unit-tests.js`; container backend unit/source assertions; container OpenAPI validation; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.94`; `npm run compose:generate`; release feed regeneration; observability release evidence refresh; local release preflight; and `git diff --check`.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata, `docker-compose.yml`, `docs/releases/v3.4.94.md`, and `backend/release-feed.json` are aligned to `3.4.94`.
- Release gate accounting: this is a docs/contract-only slice with no runtime behavior change; local release preflight passed version sync, release note, dependency-audit artifact, migration-evidence artifact, and observability-evidence checks. The helper marked compose secure-cookie coverage blocked in the local development stack (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`), and CI must still rerun `compose-smoke`, `browser-regression`, `secret-scan`, and `image-security-and-sbom`.
- Verified facts: the contract now states Kavita should be workspace-owned; workspace admins own save/test/import/clear for their workspace; matching, cover proxy, and import behavior must remain workspace/library scoped; implementation, migration, embedded reading, progress sync, metadata writeback, and shared provider abstractions were not added.
- Risks/follow-ups: implement workspace-owned Kavita storage/UI/smoke as a separate milestone; decide legacy platform-config migration behavior carefully so existing installs are not surprised.
- What remains in the milestone: no open `3.4.94` contract work remains.
- Recommended commit message: `Release 3.4.94 Kavita workspace-owned integration administration contract`.

## 3.4.95 — Kavita Workspace-Owned Integration Administration Implementation

**Goal:** Implement the `3.4.94` workspace-owned Kavita administration contract so workspace admins can own Kavita settings, testing, imports, fan-out, and cover readback without relying on platform-global Kavita configuration.

**Current Slice:** `Closed 2026-05-04`

### Scope

- Add Kavita settings to the existing workspace integrations API and Space Manager integration surface.
- Store workspace Kavita base URL, encrypted API key, and timeout on the workspace-scoped `app_integrations.space_id` row.
- Add workspace-scoped Kavita connection testing.
- Require workspace-admin access before Kavita import/fan-out can run.
- Stop Kavita import and cover proxy execution from falling back to legacy platform-level Kavita credentials.
- Keep Kavita settings readback redacted.
- Extend the Kavita import smoke to prove workspace-owned save/test/import, overlapping provider ids across workspaces, scoped cover readback, and secret-free settings.
- Keep embedded reading, page proxying, progress sync, metadata writeback, special-chapter import, and shared provider abstractions out of this slice.

### Acceptance Criteria

- Workspace admins can save, test, import from, fan out from, read back, and clear their workspace Kavita connection.
- Workspace Kavita readback never returns raw API keys.
- Kavita import requires workspace-admin access and uses only the active workspace's Kavita settings.
- Two workspaces can import overlapping Kavita series/chapter ids without updating each other's rows.
- Kavita cover proxy readback uses the row's workspace-owned Kavita settings.
- The global Admin > Integrations surface no longer presents Kavita as a primary platform-owned integration.
- Version metadata and Help > Releases are aligned to `3.4.95`.

### Closeout Notes

- Roadmap slice: `3.4.95 — Kavita Workspace-Owned Integration Administration Implementation`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/41-Kavita-Integration-Setup.md`, and `docs/wiki/44-Kavita-Workspace-Owned-Administration-Contract.md`.
- Runtime verification used: rebuilt the Docker platform stack with `APP_VERSION=3.4.95`; verified healthy backend/frontend containers, `/api/health` serving `3.4.95`, `/api/auth/config` platform readback, live DB `events_enabled=true`, in-stack Help > Releases smoke for `v3.4.95`, Kavita connection smoke, and Kavita import/sync smoke with workspace-owned settings/test/import, chapter fan-out, overlapping workspace ids, scoped cover proxy readback, and secret-free readback.
- CI/checks run locally: source syntax checks for touched backend routes/services/scripts; local OpenAPI validation; container backend unit/source assertions (`243` passed); container OpenAPI validation; container `test:kavita-connection-smoke`; container `test:kavita-import-sync-smoke` with `BASE_URL=http://127.0.0.1:3001`; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.95`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:rbac-regression`; container `test:platform-edition-boundary`; full browser regression with bundled Node (`58` passed, `4` skipped); targeted admin/integrations/workspace browser rerun after updating platform-tab expectations; `npm run validate:public-export`; `npm run compose:generate`; release feed regeneration; observability release evidence refresh; local release preflight; release-artifact secret-pattern scan; and `git diff --check`.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata and lockfiles, `docker-compose.yml`, `docs/releases/v3.4.95.md`, and `backend/release-feed.json` are aligned to `3.4.95`.
- Release gate accounting: rebuilt stack health and runtime smokes locally covered compose basics except CI secure-cookie settings; `rbac-regression`, `browser-regression`, `platform-edition-boundary`, dependency-audit artifact checks, init parity, migration rehearsal, and observability evidence passed locally. Local release preflight still marks secure-cookie compose coverage blocked in the development stack (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`), and CI must still rerun `compose-smoke`, `homelab-edition-boundary`, `secret-scan`, and `image-security-and-sbom`.
- Verified facts: workspace integrations now persist Kavita URL, encrypted API key, and timeout on the workspace-scoped integration row; workspace Kavita readback remains redacted; workspace Kavita test is available at `/api/spaces/{id}/integrations/test-kavita`; Kavita import requires workspace-admin access and no longer falls back to platform Kavita settings; cover proxy fetches use the Kavita config for the row's workspace; the platform Admin integrations browser surface no longer presents Kavita as a primary platform-owned tab; Space Manager integrations exposes Kavita.
- Risks/follow-ups: embedded reading, reader page proxying, progress sync, metadata writeback, special-chapter import, shared Calibre/CWA/Kavita provider abstractions, and any explicit one-time legacy platform Kavita migration helper remain separate.
- What remains in the milestone: no planned implementation work remains after final verification.
- Recommended commit message: `Release 3.4.95 Kavita workspace-owned integration administration implementation`.

## 3.4.96 — Kavita Metadata Writeback Contract and API Probe

**Goal:** Decide whether collectZ should push metadata back into Kavita and define a conservative opt-in contract before any user-facing mutation workflow exists.

**Current Slice:** `Closed 2026-05-04`

### Scope

- Review Kavita's current writable metadata API shape.
- Document the first allowed series/chapter metadata fields and safety requirements.
- Add pure backend payload builders for future writeback preview/apply work.
- Add a Docker-friendly fake-server probe that verifies the intended payload shape without mutating a real Kavita server.
- Keep the current Kavita runtime read-only and do not add a user-facing writeback action.
- Keep embedded reading, reader page proxying, progress sync, external enrichment writeback, and shared provider abstractions out of this slice.

### Acceptance Criteria

- The writeback contract names the exact native Kavita endpoints considered viable.
- The first field set is narrow and per-field selectable.
- Locked fields are skipped by default.
- The fake-server probe proves the planned series/chapter payload shape and secret-free behavior.
- Version metadata and Help > Releases are aligned to `3.4.96`.

### Closeout Notes

- Roadmap slice: `3.4.96 — Kavita Metadata Writeback Contract and API Probe`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/41-Kavita-Integration-Setup.md`, and `docs/wiki/45-Kavita-Metadata-Writeback-Contract.md`.
- Runtime verification used: rebuilt the Docker platform stack with `APP_VERSION=3.4.96`; verified healthy backend/frontend containers, `/api/health` serving `3.4.96`, `/api/auth/config` platform readback, live DB `events_enabled=true` at the start and after release evidence, in-stack Help > Releases smoke for `v3.4.96`, Kavita connection smoke, Kavita import/sync smoke, the fake-server metadata writeback probe, isolated homelab edition boundary stack, and restored platform stack health.
- CI/checks run locally: source syntax checks for the new writeback contract/probe and unit test script; local metadata writeback probe; local OpenAPI validation; local backend unit/source assertions reached the new Kavita assertion but failed under the local Node runtime because `AbortController` is unavailable in the existing Sched ICS fetch test; container backend unit/source assertions (`244` passed); container OpenAPI validation; container `test:kavita-metadata-writeback-probe`; container `test:kavita-connection-smoke`; container `test:kavita-import-sync-smoke` rerun isolated after an initial fixture-state collision; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.96`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:rbac-regression`; container `test:platform-edition-boundary`; isolated generated-compose `test:homelab-edition-boundary`; full browser regression with bundled Node (`58` passed, `4` skipped); `npm run validate:public-export`; `npm run compose:generate`; release feed regeneration; observability release evidence refresh (`9/9` passed); local release preflight; release-artifact secret-pattern scan; and `git diff --check`.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata and lockfiles, `docker-compose.yml`, `docs/releases/v3.4.96.md`, and `backend/release-feed.json` are aligned to `3.4.96`.
- Release gate accounting: rebuilt stack health and runtime smokes locally covered compose basics except CI secure-cookie settings; `rbac-regression`, `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, dependency-audit artifact checks, init parity, migration rehearsal, and observability evidence passed locally. Local release preflight still marks secure-cookie compose coverage blocked in the development stack (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`), and CI must still rerun `compose-smoke`, `secret-scan`, and `image-security-and-sbom`.
- Verified facts: Kavita's documented writable metadata targets for this contract are `POST /api/Series/metadata` and `POST /api/Chapter/update`; collectZ now has pure payload builders and a fake-server probe for those shapes; locked fields are skipped by default; no user-facing writeback action, real Kavita mutation call, reader/progress writeback, or external enrichment writeback was added.
- Inference: the first writable field allowlist is intentionally limited to descriptive series/chapter metadata because it is straightforward to preview, audit, and skip when locked; broader writeback should wait for an explicit preview/apply UI.
- Blocked/unverified items: local secure-cookie compose-smoke remains blocked by development runtime settings (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`); `secret-scan` and `image-security-and-sbom` remain CI-only gates for the tagged release handoff; no real Kavita server mutation endpoint was exercised because this slice deliberately avoids writing to user Kavita data.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/services/kavitaWritebackContract.js`, `backend/scripts/kavita-metadata-writeback-probe.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.96.md`, `docs/wiki/45-Kavita-Metadata-Writeback-Contract.md`, `docs/wiki/41-Kavita-Integration-Setup.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `backend/release-feed.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks/follow-ups: actual Kavita metadata writeback still needs a workspace-admin preview endpoint, field-level diff UI, explicit apply endpoint, audit logging, failure readback, and locked-field override decision; embedded reading, progress sync, external enrichment writeback, and shared provider abstractions remain separate.
- What remains in the milestone: no open `3.4.96` implementation work remains; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.96 Kavita metadata writeback contract and API probe`.

## 3.4.97 — Kavita Metadata Writeback Preview and Diff

**Goal:** Add the first preview-only Kavita metadata writeback implementation step so workspace admins can compare current Kavita metadata with collectZ metadata for a Kavita-linked media row before any write/apply path exists.

**Status:** Closed 2026-05-05.

### Scope

- Add a workspace-admin-only preview endpoint for Kavita-linked media rows.
- Read current Kavita series metadata from `GET /api/Series/metadata`.
- For chapter fan-out rows, read current chapter values from Kavita volume/chapter detail readback.
- Build a field-level diff against collectZ metadata using the `3.4.96` allowlist and locked-field skip behavior.
- Add a read-only media-detail UI panel for previewing the diff.
- Keep apply/writeback mutation, locked-field override, reader/progress sync, external enrichment writeback, and shared provider abstractions out of scope.

### Acceptance Criteria

- Preview responses are marked preview-only and mutation-disabled.
- Preview requires workspace-admin access and uses the row's workspace-owned Kavita connection.
- Preview JSON never exposes Kavita API keys, bearer tokens, or browser-usable credential URLs.
- Locked fields are skipped in preview readback.
- Kavita import/sync smoke proves preview-only series/chapter diff behavior against a fake Kavita-compatible server.
- Version metadata and Help > Releases are aligned to `3.4.97`.

### Closeout Notes

- Roadmap slice: `3.4.97 — Kavita Metadata Writeback Preview and Diff`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/41-Kavita-Integration-Setup.md`, and `docs/wiki/45-Kavita-Metadata-Writeback-Contract.md`.
- Runtime verification used: rebuilt and recreated the Docker platform stack with `APP_VERSION=3.4.97`; verified healthy backend/frontend containers, `/api/health` serving frontend/backend/build `3.4.97`, backend container env readback for `APP_VERSION=3.4.97`, `APP_EDITION=platform`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; verified the live DB `feature_flags.events_enabled=true` after evidence runs; verified Help > Releases serves `v3.4.97`; ran the Kavita import/sync smoke against the running backend and fake Kavita-compatible server, proving preview-only series/chapter diff behavior; temporarily swapped to the generated public compose plus `.ci/docker-compose.build.yml` for homelab boundary verification, then restored the platform stack and rechecked health.
- CI/checks run locally: source syntax checks for `backend/routes/media.js`, `backend/services/kavita.js`, `backend/services/kavitaWritebackContract.js`, `backend/scripts/kavita-import-sync-smoke.js`, and `backend/scripts/unit-tests.js`; bundled-Node frontend production build; container backend unit/source assertions (`244` passed); container OpenAPI validation; container `test:kavita-metadata-writeback-probe`; container `test:kavita-import-sync-smoke` with metadata preview coverage; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.97`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:rbac-regression`; container `test:platform-edition-boundary`; container API integration smoke; isolated generated-compose `test:homelab-edition-boundary`; full browser regression with bundled Node (`58` passed, `4` skipped); `npm run validate:public-export`; `npm run compose:generate`; release-feed regeneration; observability release evidence refresh (`9/9` passed); Node 20 container dependency audits for backend/frontend (`0` low, `0` moderate, `0` high, `0` critical); local release preflight; and `git diff --check`.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata and lockfiles, `docker-compose.yml`, `docs/releases/v3.4.97.md`, and `backend/release-feed.json` are aligned to `3.4.97`.
- Release gate accounting: rebuilt stack health and runtime smokes locally covered compose basics except CI secure-cookie settings; `rbac-regression`, `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, dependency-audit artifact checks, init parity, migration rehearsal, and observability evidence passed locally. Local release preflight still marks secure-cookie compose coverage blocked in the development stack (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`), and CI must still rerun `compose-smoke`, `secret-scan`, and `image-security-and-sbom`.
- Verified facts: Kavita-linked media rows now expose a workspace-admin-only preview endpoint; preview uses the row's workspace-owned Kavita integration; series preview reads current Kavita metadata through `GET /api/Series/metadata`; chapter fan-out preview reads current chapter values through Kavita volume/chapter detail readback; responses are `previewOnly` and `mutationEnabled=false`; locked fields are skipped; preview responses do not return Kavita API keys or bearer tokens; the media detail drawer has a read-only Kavita Metadata panel and no apply/write action.
- Inference: chapter current-value readback uses the volume/chapter detail shape because the documented Kavita write target is `POST /api/Chapter/update`, while the available read path for this slice is the existing volume/chapter detail response.
- Blocked/unverified items: local secure-cookie compose-smoke remains blocked by development runtime settings (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`); `secret-scan` and `image-security-and-sbom` remain CI-only gates for the tagged release handoff; no real Kavita mutation endpoint was exercised because this slice deliberately avoids writing to user Kavita data.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/middleware/validate.js`, `backend/openapi/openapi.yaml`, `backend/routes/media.js`, `backend/services/kavita.js`, `backend/services/kavitaWritebackContract.js`, `backend/scripts/kavita-import-sync-smoke.js`, `backend/scripts/unit-tests.js`, `frontend/src/components/LibraryView.jsx`, `docker-compose.yml`, `docs/releases/v3.4.97.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/45-Kavita-Metadata-Writeback-Contract.md`, `backend/release-feed.json`, `artifacts/dependency-audit/backend-audit.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks/follow-ups: actual Kavita metadata apply/writeback still needs an explicit apply endpoint, audit log for attempted writes, failure readback, field-level selection UI, locked-field override decision, and operator confirmation copy; embedded reading, progress sync, external enrichment writeback, and shared provider abstractions remain separate future milestones.
- What remains in the milestone: no open `3.4.97` implementation work remains; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.97 Kavita metadata writeback preview and diff`.

## 3.4.98 — Kavita Metadata Writeback Apply

**Goal:** Add the first explicit Kavita metadata writeback apply path so workspace admins can send changed, unlocked collectZ metadata fields to Kavita after reviewing the preview diff.

**Status:** Closed 2026-05-05.

### Scope

- Add a workspace-admin-only apply endpoint for Kavita-linked media rows.
- Re-read current Kavita metadata before applying and reuse the preview diff contract.
- Write only changed, unlocked fields from the existing allowlist.
- Require explicit confirmation in the request body.
- Add UI affordance beside the preview diff for applying the currently changed fields.
- Add activity/audit events for applied, skipped, and failed attempts.
- Extend the Kavita import/sync smoke fake server to prove series and chapter apply payloads without real-user Kavita mutation.
- Keep background sync, locked-field override, external enrichment writeback, reader/progress sync, and shared provider abstractions out of scope.

### Acceptance Criteria

- Apply requires workspace-admin access and uses the row's workspace-owned Kavita connection.
- Apply recomputes preview immediately before mutation.
- Apply writes only changed fields and omits locked or missing fields.
- Apply responses never expose Kavita API keys, bearer tokens, or browser-usable credential URLs.
- Failed Kavita writeback does not update local collectZ metadata as if Kavita accepted the change.
- Kavita import/sync smoke proves both series and chapter apply behavior against a fake Kavita-compatible server.
- Version metadata and Help > Releases are aligned to `3.4.98`.

### Closeout Notes

- Roadmap slice: `3.4.98 — Kavita Metadata Writeback Apply`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/41-Kavita-Integration-Setup.md`, and `docs/wiki/45-Kavita-Metadata-Writeback-Contract.md`.
- Runtime verification used: rebuilt and recreated the Docker platform stack with `APP_VERSION=3.4.98`; verified healthy backend/frontend containers, `/api/health` serving frontend/backend/build `3.4.98`, backend container env readback for `APP_VERSION=3.4.98`, `APP_EDITION=platform`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; verified the live DB `feature_flags.events_enabled=true` after evidence runs; verified Help > Releases serves `v3.4.98`; ran the Kavita import/sync smoke against the running backend and fake Kavita-compatible server, proving one series metadata write and one chapter metadata write; temporarily swapped to generated public compose plus `.ci/docker-compose.build.yml` for homelab boundary verification, then restored the platform stack and rechecked health.
- CI/checks run locally: source syntax checks for `backend/routes/media.js`, `backend/services/kavita.js`, `backend/services/kavitaWritebackContract.js`, `backend/scripts/kavita-import-sync-smoke.js`, and `backend/scripts/unit-tests.js`; Docker frontend production build; container backend unit/source assertions (`244` passed); container OpenAPI validation; container `test:kavita-import-sync-smoke` with metadata apply coverage; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.98`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:rbac-regression`; container `test:platform-edition-boundary`; container API integration smoke; isolated generated-compose `test:homelab-edition-boundary`; full browser regression with bundled Node (`58` passed, `4` skipped) after rerunning it without concurrent stack churn; `npm run validate:public-export`; `npm run compose:generate`; release-feed regeneration; observability release evidence refresh (`9/9` passed); Node 20 container dependency audits for backend/frontend (`0` low, `0` moderate, `0` high, `0` critical); local release preflight; and `git diff --check`.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata and lockfiles, `docker-compose.yml`, `docs/releases/v3.4.98.md`, and `backend/release-feed.json` are aligned to `3.4.98`.
- Release gate accounting: rebuilt stack health and runtime smokes locally covered compose basics except CI secure-cookie settings; `rbac-regression`, `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, dependency-audit artifact checks, init parity, migration rehearsal, and observability evidence passed locally. Local release preflight still marks secure-cookie compose coverage blocked in the development stack (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`), and CI must still rerun `compose-smoke`, `secret-scan`, and `image-security-and-sbom`.
- Verified facts: Kavita-linked media rows now expose a workspace-admin-only apply endpoint; apply requires `confirm: true`; apply re-reads current Kavita metadata and recomputes the preview diff before mutation; series apply calls `POST /api/Series/metadata`; chapter apply calls `POST /api/Chapter/update`; only changed unlocked fields are sent; locked writers were omitted in the fake-server proof; responses do not return Kavita API keys or bearer tokens; the media detail drawer exposes `Apply to Kavita` only after preview; failed attempts are logged and do not update local collectZ metadata as accepted.
- Inference: the UI currently applies all changed fields from the preview rather than providing per-field checkboxes because the first writeback allowlist is narrow and locked/missing fields are already filtered server-side.
- Blocked/unverified items: local secure-cookie compose-smoke remains blocked by development runtime settings (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`); `secret-scan` and `image-security-and-sbom` remain CI-only gates for the tagged release handoff; no real user Kavita server was mutated during local verification because the apply proof used a fake Kavita-compatible server.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/middleware/validate.js`, `backend/openapi/openapi.yaml`, `backend/routes/media.js`, `backend/services/kavita.js`, `backend/services/kavitaWritebackContract.js`, `backend/scripts/kavita-import-sync-smoke.js`, `backend/scripts/unit-tests.js`, `frontend/src/components/LibraryView.jsx`, `docker-compose.yml`, `docs/releases/v3.4.98.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/45-Kavita-Metadata-Writeback-Contract.md`, `backend/release-feed.json`, `artifacts/dependency-audit/frontend-audit.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks/follow-ups: add field-level selection UI before broader writeback use; decide whether locked-field override is ever allowed; add a richer post-apply refresh/readback state; keep external enrichment writeback, reader/progress sync, and shared provider abstractions as separate future milestones.
- What remains in the milestone: no open `3.4.98` implementation work remains; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.98 Kavita metadata writeback apply`.

## 3.4.99 — Kavita Writeback Field Selection UI

**Goal:** Make the manual Kavita writeback apply flow field-selectable so workspace admins can choose the exact changed fields to send after preview.

**Current Slice:** `Closed 2026-05-06`

### Scope

- Add field-level selection controls to the Kavita metadata preview diff.
- Select changed unlocked fields by default after preview.
- Keep unchanged rows visible but not selectable for apply.
- Send only selected changed fields to the existing apply endpoint.
- Keep locked-field override, background sync, external enrichment writeback, reader/progress sync, and shared provider abstractions out of scope.

### Acceptance Criteria

- Preview readback shows changed, skipped, and selected field counts.
- Apply is disabled when no changed fields are selected.
- Apply payloads send only the selected changed fields.
- Unchanged and skipped fields are not selectable.
- Version metadata and Help > Releases are aligned to `3.4.99`.

### Closeout Notes

- Roadmap slice: `3.4.99 — Kavita Writeback Field Selection UI`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/41-Kavita-Integration-Setup.md`, and `docs/wiki/45-Kavita-Metadata-Writeback-Contract.md`.
- Runtime verification used: rebuilt and restored the Docker platform stack with `APP_VERSION=3.4.99`; verified healthy backend/frontend containers, `/api/health` serving frontend/backend/build `3.4.99`, backend container env readback for `APP_VERSION=3.4.99`, `APP_EDITION=platform`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; verified live DB `feature_flags.events_enabled=true` at the start and after all evidence tooling; verified Help > Releases serves `v3.4.99`; ran the Kavita import/sync smoke against the running backend and fake Kavita-compatible server, proving selected-field apply still writes only `releaseYear` for the series metadata path and one chapter write for the chapter metadata path; temporarily swapped to generated public compose plus `.ci/docker-compose.build.yml` for homelab boundary verification, then restored the localhost platform stack and rechecked health.
- CI/checks run locally: `node --check backend/scripts/unit-tests.js`; Docker frontend production build; container backend unit/source assertions (`244` passed); container OpenAPI validation; container `test:kavita-import-sync-smoke` with metadata field-selection apply coverage; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.99`; container `test:init-parity`; container `test:migration-rehearsal`; container `test:rbac-regression` rerun isolated after a parallel boundary-smoke fixture collision; container `test:platform-edition-boundary`; container API integration smoke; isolated generated-compose `test:homelab-edition-boundary`; full browser regression with bundled Node (`58` passed, `4` skipped); `npm run validate:public-export`; `npm run compose:generate`; release-feed regeneration; observability release evidence refresh (`9/9` passed); Node 20 container dependency audits for backend/frontend (`0` low, `0` moderate, `0` high, `0` critical); local release preflight; and `git diff --check`.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata and lockfiles, `docker-compose.yml`, `docs/releases/v3.4.99.md`, and `backend/release-feed.json` are aligned to `3.4.99`.
- Release gate accounting: rebuilt stack health and runtime smokes locally covered compose basics except CI secure-cookie settings; `rbac-regression`, `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, dependency-audit artifact checks, init parity, migration rehearsal, and observability evidence passed locally. Local release preflight marks secure-cookie compose coverage blocked in the development stack (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`), and CI must still rerun `compose-smoke`, `secret-scan`, and `image-security-and-sbom`.
- Verified facts: changed unlocked Kavita diff fields are selected by default after preview; unchanged rows remain visible but unselectable; selected-field count is shown beside changed/skipped readback; `Apply to Kavita` is disabled when no changed fields are selected; apply sends only selected changed fields; the running-stack Kavita smoke proved selected `releaseYear` series apply plus one chapter apply without returning Kavita secrets.
- Inference: field-level checkboxes are the right next guardrail before expanding writeback coverage because they make the existing narrow allowlist explicit without changing the backend mutation contract.
- Blocked/unverified items: local secure-cookie compose-smoke remains blocked by development runtime settings (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`); `secret-scan` and `image-security-and-sbom` remain CI-only gates for the tagged release handoff; no real user Kavita server was mutated during local verification because the apply proof used a fake Kavita-compatible server.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/scripts/unit-tests.js`, `frontend/src/components/LibraryView.jsx`, `docker-compose.yml`, `docs/releases/v3.4.99.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/45-Kavita-Metadata-Writeback-Contract.md`, `backend/release-feed.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks/follow-ups: locked-field override policy still needs an explicit future decision; real Kavita writeback validation should be run before relying on this for a personal production library; post-apply refresh/readback can get richer; reader/progress sync, external enrichment writeback, and shared provider abstractions remain separate future work.
- What remains in the milestone: no open `3.4.99` implementation work remains; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.99 Kavita writeback field selection UI`.

## 3.4.100 — Kavita Reading Progress Sync Contract

**Goal:** Define the first safe Kavita reading-progress sync contract so collectZ can later show read-only Kavita progress without embedding the reader, proxying pages, or writing progress.

**Current Slice:** `Closed 2026-05-06`

### Scope

- Recheck Kavita's native reader/progress API surface for read and write boundaries.
- Add a small contract helper and fake-server probe for read-only progress readback.
- Document workspace-owned credential handling, per-user ownership questions, and eligible row identity.
- Keep progress UI/read implementation, progress writeback, embedded reading, page streaming, background polling, and shared provider abstractions out of scope.

### Acceptance Criteria

- Contract docs identify `GET /api/Reader/get-progress` as the first read-only progress endpoint and enumerate write endpoints that remain prohibited.
- Probe proves only a read endpoint is called and normalized readback excludes secret-like fields.
- Chapter-as-issue rows are identified as the first eligible collectZ rows because they have stable Kavita chapter ids.
- Version metadata and Help > Releases are aligned to `3.4.100`.

### Closeout Notes

- Roadmap slice: `3.4.100 — Kavita Reading Progress Sync Contract`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/41-Kavita-Integration-Setup.md`, and `docs/wiki/42-Kavita-Reader-Progress-Contract.md`.
- Runtime verification used: rebuilt and restored the Docker platform stack with `APP_VERSION=3.4.100`; verified healthy backend/frontend containers, `/api/health` serving frontend/backend/build `3.4.100`, backend container env readback for `APP_VERSION=3.4.100`, `APP_EDITION=platform`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; verified live DB `feature_flags.events_enabled=true` before and after verification/evidence tooling; verified Help > Releases serves `v3.4.100`; ran the Kavita progress contract probe in-container against a fake Kavita-compatible server, proving the read-only `GET /api/Reader/get-progress?chapterId=9702` shape, prohibited write endpoint enumeration, and `secretReturned=false`; temporarily swapped to generated public compose plus `.ci/docker-compose.build.yml` for homelab boundary verification, then restored the localhost platform stack and rechecked health.
- CI/checks run locally: source syntax checks for `backend/services/kavitaProgressContract.js`, `backend/scripts/kavita-progress-contract-probe.js`, and `backend/scripts/unit-tests.js`; local and container `test:kavita-progress-contract-probe`; Docker frontend production build; container backend unit/source assertions (`245` passed); container OpenAPI validation; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.100`; container API integration smoke; container `test:init-parity`; container `test:migration-rehearsal`; container `test:rbac-regression`; container `test:platform-edition-boundary`; isolated generated-compose `test:homelab-edition-boundary`; full browser regression with bundled Node (`58` passed, `4` skipped); `npm run validate:public-export`; `npm run compose:generate`; release-feed regeneration; observability release evidence refresh (`9/9` passed); Node 20 container dependency audits for backend/frontend (`0` low, `0` moderate, `0` high, `0` critical); local release preflight; and `git diff --check`.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata and lockfiles, `docker-compose.yml`, `docs/releases/v3.4.100.md`, and `backend/release-feed.json` are aligned to `3.4.100`.
- Release gate accounting: rebuilt stack health and runtime smokes locally covered compose basics except CI secure-cookie settings; `rbac-regression`, `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, dependency-audit artifact checks, init parity, migration rehearsal, and observability evidence passed locally. Local release preflight marks secure-cookie compose coverage blocked in the development stack (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`), and CI must still rerun `compose-smoke`, `secret-scan`, and `image-security-and-sbom`.
- Verified facts: Kavita upstream OpenAPI still identifies as `0.9.0.0`; `GET /api/Reader/get-progress` accepts `chapterId`; `POST /api/Reader/progress` accepts `ProgressDto`; the new contract helper marks progress sync implementation disabled; the fake-server probe makes only one read request; normalized progress readback excludes injected secret-like fields; no native reader, page proxy, or progress write endpoint is exercised.
- Inference: chapter-as-issue rows are the safest first progress candidates because `3.4.93` gives them stable Kavita chapter ids; series-level progress aggregation should wait until child-chapter readback semantics are implemented.
- Blocked/unverified items: local secure-cookie compose-smoke remains blocked by development runtime settings (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`); `secret-scan` and `image-security-and-sbom` remain CI-only gates for the tagged release handoff; no real user Kavita progress endpoint was called because this slice proves the contract with a fake Kavita-compatible server.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/services/kavitaProgressContract.js`, `backend/scripts/kavita-progress-contract-probe.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.100.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/41-Kavita-Integration-Setup.md`, `docs/wiki/42-Kavita-Reader-Progress-Contract.md`, `backend/release-feed.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks/follow-ups: the next implementation should add read-only progress UI/API for chapter-backed rows; per-user Kavita identity remains unresolved; progress writeback, mark read/unread, KOReader sync, embedded reading, page proxying, background polling, and shared provider abstractions remain separate future work.
- What remains in the milestone: no open `3.4.100` implementation work remains; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.100 Kavita reading progress sync contract`.

## 3.4.101 — Kavita Read-Only Progress Visibility

**Goal:** Implement the first read-only Kavita progress visibility path for chapter-backed Kavita rows without writing progress, embedding the reader, or proxying reader pages.

**Current Slice:** `Closed 2026-05-06`

### Scope

- Add a scoped backend endpoint for Kavita chapter-backed media rows to read `GET /api/Reader/get-progress`.
- Use the row's workspace-owned Kavita connection and return only normalized, secret-free progress fields.
- Add a compact media-detail drawer panel for Kavita chapter-as-issue rows.
- Extend fake-Kavita smoke coverage to prove read-only behavior and no secret readback.
- Keep progress writeback, mark read/unread, embedded reading, reader page proxying, background polling, and shared provider abstractions out of scope.

### Acceptance Criteria

- Chapter-backed Kavita rows can request read-only progress from the running stack.
- Series-level Kavita rows do not become progress-sync targets in this slice.
- Browser-visible progress readback excludes Kavita API keys, bearer tokens, OPDS keys, and credential URLs.
- Fake-Kavita smoke proves only `GET /api/Reader/get-progress` is used for progress.
- Version metadata and Help > Releases are aligned to `3.4.101`.

### Closeout

- Roadmap slice: `3.4.101 — Kavita Read-Only Progress Visibility`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/41-Kavita-Integration-Setup.md`, and `docs/wiki/42-Kavita-Reader-Progress-Contract.md`.
- Runtime verification used: rebuilt and restored the Docker platform stack with `APP_VERSION=3.4.101`; verified healthy backend/frontend containers, `/api/health` serving frontend/backend/build `3.4.101`, backend container env readback for `APP_VERSION=3.4.101`, `APP_EDITION=platform`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; verified live DB `feature_flags.events_enabled=true` after evidence tooling; verified Help > Releases serves `v3.4.101`; ran the Kavita import/sync smoke against the running backend and fake Kavita-compatible server, proving read-only progress readback with `progressReadOnly=true`, `progressReadEndpointCalls=1`, `progressReadPage=11`, and `secretReturned=false`; temporarily swapped to generated public compose plus `.ci/docker-compose.build.yml` for homelab boundary verification, then restored the localhost platform stack and rechecked health.
- CI/checks run locally: source syntax checks for `backend/routes/media.js`, `backend/services/kavita.js`, `backend/scripts/kavita-import-sync-smoke.js`, and `backend/scripts/unit-tests.js`; local frontend production build with bundled Node; local unit/source assertions attempted and passed the new Kavita assertions before the known local Node `AbortController` gap stopped a later Sched ICS fetch test; container backend unit/source assertions (`245` passed); container OpenAPI validation; container `test:kavita-import-sync-smoke` with progress readback coverage; container `test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.101`; container API integration smoke; container `test:init-parity`; container `test:migration-rehearsal`; container `test:rbac-regression`; container `test:platform-edition-boundary`; isolated generated-compose `test:homelab-edition-boundary`; full browser regression with bundled Node (`58` passed, `4` skipped); `npm run validate:public-export`; `npm run compose:generate`; release-feed regeneration; observability release evidence refresh; Node 20 container dependency audits for backend/frontend (`0` low, `0` moderate, `0` high, `0` critical); local release preflight; generated-artifact secret hygiene checks; and `git diff --check`.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata and lockfiles, `docker-compose.yml`, `docs/releases/v3.4.101.md`, and `backend/release-feed.json` are aligned to `3.4.101`.
- Release gate accounting: local secure-cookie compose-smoke remains blocked by development runtime settings (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`); `secret-scan` and `image-security-and-sbom` remain CI-only gates for the tagged release handoff; dependency-scan, release preflight, RBAC, browser, homelab edition boundary, and platform edition boundary gates were run locally.
- Verified facts: Kavita chapter-backed media rows now expose a scoped `GET /api/media/:id/kavita-progress` endpoint; the endpoint uses the row's workspace-owned Kavita connection; it only targets stable chapter-backed rows; progress responses normalize page/chapter/series/volume/scroll/timestamp fields; browser-visible readback excludes injected Kavita secret-like fields; the media detail drawer includes a read-only Kavita Progress panel with an explicit Read Progress action.
- Inference: series-level progress aggregation should wait until child-chapter rollup semantics and per-user Kavita identity are designed.
- Blocked/unverified items: no real user Kavita server progress endpoint was called because this slice proves behavior with a fake Kavita-compatible server; progress writeback, mark read/unread, and per-user Kavita identity remain out of scope; CI-only gates must still pass before tag/release publication.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/routes/media.js`, `backend/services/kavita.js`, `backend/scripts/kavita-import-sync-smoke.js`, `backend/scripts/unit-tests.js`, `frontend/src/components/LibraryView.jsx`, `docker-compose.yml`, `docs/releases/v3.4.101.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Kavita-Reader-Progress-Contract.md`, `backend/release-feed.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks/follow-ups: real Kavita validation should be run before relying on this against a personal production library; per-user Kavita identity remains unresolved; progress writeback, mark read/unread, embedded reading, page proxying, background polling, external enrichment writeback, and shared provider abstractions remain separate future milestones.
- What remains in the milestone: no open `3.4.101` implementation work remains; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.101 Kavita read-only progress visibility`.

## 3.4.102 — Kavita Progress Writeback and Page Proxy Reader

**Goal:** Implement the first explicit Kavita progress writeback and page-proxy reader path for chapter-backed Kavita rows while keeping Kavita credentials server-side and avoiding full iframe/native-reader ownership.

**Current Slice:** `Closed 2026-05-06`

### Scope

- Add a scoped backend endpoint for Kavita chapter-backed media rows to write selected page progress through `POST /api/Reader/progress`.
- Add scoped reader metadata and single-page image proxy endpoints for Kavita chapter-backed rows.
- Add compact media-detail drawer controls to load one proxied Kavita reader page, move page-by-page, and explicitly save progress.
- Extend fake-Kavita smoke coverage to prove progress writeback, page proxying, and secret-free browser responses.
- Keep mark read/unread, automatic/background progress sync, iframe embedding, PDF/raw chapter file proxying, KOReader sync, and shared provider abstractions out of scope.

### Acceptance Criteria

- Chapter-backed Kavita rows can explicitly save a selected page number back to Kavita from the running stack.
- Chapter-backed Kavita rows can load sanitized reader metadata and a proxied reader image page through collectZ.
- Browser-visible responses and page URLs never include Kavita API keys, bearer tokens, OPDS keys, or Kavita file names.
- Fake-Kavita smoke proves `POST /api/Reader/progress`, `GET /api/Reader/chapter-info`, and `GET /api/Reader/image` are called only through backend-owned credentials.
- Version metadata and Help > Releases are aligned to `3.4.102`.

### Closeout

- Roadmap slice: `3.4.102 — Kavita Progress Writeback and Page Proxy Reader`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Kavita-Reader-Progress-Contract.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, and `docs/wiki/10-CI-CD-and-Registry-Deploy.md`.
- Runtime verification used: rebuilt the Docker platform stack with `APP_VERSION=3.4.102`; verified `/api/health` serving frontend/backend/build `3.4.102`; verified Help > Releases serves `v3.4.102`; verified live DB `feature_flags.events_enabled=true`; ran the running-stack Kavita import/sync smoke with explicit progress writeback, reader-info, reader-image, and secret-free response coverage; and reran the Kavita progress contract probe after the final backend rebuild.
- CI/checks run locally: source syntax checks for the changed backend files and smoke/unit scripts; `git diff --check`; `npm run compose:generate`; `npm run validate:public-export`; backend unit/source assertions (`245` passed); OpenAPI validation; Kavita import/sync smoke; Kavita progress contract probe; Help > Releases smoke; RBAC regression; platform edition boundary smoke; init parity; migration rehearsal; observability release evidence refresh (`9/9` passed); dependency audits via Node 20 containers (backend `0` low, `2` moderate, `0` high, `0` critical; frontend `0` vulnerabilities); local release preflight; targeted Playwright integrations browser regression (`3` passed); and Docker health checks. The local homelab edition boundary run was blocked by using the platform/localhost stack, where platform-only admin email settings are intentionally mounted; rerun the homelab gate from the generated public compose stack before a public release tag. CI-only gates still required before tag publication: `secret-scan`, full CI `compose-smoke` secure-cookie path, `image-security-and-sbom`, and the complete CI browser regression.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata and lockfiles, `docker-compose.yml`, `docs/releases/v3.4.102.md`, and `backend/release-feed.json` are aligned to `3.4.102`.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/middleware/validate.js`, `backend/routes/media.js`, `backend/services/kavita.js`, `backend/services/kavitaProgressContract.js`, `backend/scripts/kavita-import-sync-smoke.js`, `backend/scripts/kavita-progress-contract-probe.js`, `backend/scripts/unit-tests.js`, `backend/openapi/openapi.yaml`, `frontend/src/components/LibraryView.jsx`, `docker-compose.yml`, `docs/releases/v3.4.102.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Kavita-Reader-Progress-Contract.md`, `backend/release-feed.json`, `artifacts/dependency-audit/backend-audit.json`, `artifacts/dependency-audit/frontend-audit.json`, `artifacts/init-parity-evidence/init-parity-evidence.json`, `artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks/follow-ups: progress writes represent the workspace-owned Kavita account, so the UI keeps them explicit and workspace-admin gated; mark read/unread, full iframe/native reader ownership, PDF/raw chapter proxying, automatic/background sync, KOReader sync, and shared digital progress abstractions remain future backlog work.
- What remains in the milestone: no open `3.4.102` implementation work remains; CI-only and homelab-runtime release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.102 Kavita progress writeback and page proxy reader`.

## 3.4.103 — Kavita Mark Read/Unread Contract

**Goal:** Define the safe Kavita read-state boundary before collectZ exposes any mark read/unread action, preserving the explicit workspace-owned account model from `3.4.102`.

**Current Slice:** `Closed`

### Scope

- Recheck Kavita's native mark read/unread API shapes against the upstream OpenAPI source.
- Document why series-wide mark read/unread and volume-wide mark read remain out of scope for the first implementation.
- Identify chapter-level mark-read as the only first-candidate future endpoint.
- Extend the Kavita progress/read-state contract probe with disabled mark endpoint evidence.
- Keep runtime mark read/unread routes, UI controls, import-triggered read-state changes, background polling, KOReader sync, and shared provider abstractions out of scope.

### Acceptance Criteria

- Contract docs identify `POST /api/Reader/mark-read`, `POST /api/Reader/mark-unread`, `POST /api/Reader/mark-chapter-read`, and `POST /api/Reader/mark-volume-read` with their current request shapes.
- The probe reports read-state implementation disabled and proves mark endpoints are not called.
- The first future implementation candidate is explicitly limited to chapter-backed rows and `POST /api/Reader/mark-chapter-read`.
- Version metadata and Help > Releases are aligned to `3.4.103`.

### Closeout

- Roadmap slice: `3.4.103 — Kavita Mark Read/Unread Contract`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Kavita-Reader-Progress-Contract.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, and `docs/wiki/10-CI-CD-and-Registry-Deploy.md`.
- Runtime verification used: rebuilt the Docker platform stack with `APP_VERSION=3.4.103`; verified `/api/health` serving frontend/backend/build `3.4.103`; verified Help > Releases serves `v3.4.103`; verified live DB `feature_flags.events_enabled=true`; and ran the Kavita progress/read-state contract probe in the backend container, proving `readStateImplementationEnabled=false`, `POST /api/Reader/mark-chapter-read` as the first future candidate, disabled series/volume/panel/KOReader read-state endpoints, and `secretReturned=false`.
- CI/checks run locally: source syntax checks for `backend/services/kavitaProgressContract.js`, `backend/scripts/kavita-progress-contract-probe.js`, and `backend/scripts/unit-tests.js`; local OpenAPI validation; local Kavita progress/read-state contract probe; local unit/source assertions reached and passed the new Kavita assertions before the known host Node 14 `AbortController` gap; `git diff --check`; `npm run compose:generate`; `npm run validate:public-export`; Docker backend/frontend build; container backend unit/source assertions (`246` passed); container OpenAPI validation; container Kavita progress/read-state contract probe; Help > Releases smoke; RBAC regression; platform edition boundary smoke; init parity; migration rehearsal; observability release evidence refresh (`9/9` passed); dependency audits via Node 20 containers (backend `0` low, `2` moderate, `0` high, `0` critical; frontend `0` vulnerabilities); targeted Playwright integrations browser regression (`3` passed); and local release preflight. Local preflight still blocks the full compose-smoke secure-cookie path because the dev stack has `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; `secret-scan`, full CI browser regression, homelab generated-compose boundary, and `image-security-and-sbom` remain CI/release-handoff gates before a public tag.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata and lockfiles, `docker-compose.yml`, `docs/releases/v3.4.103.md`, and `backend/release-feed.json` are aligned to `3.4.103`.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/services/kavitaProgressContract.js`, `backend/scripts/kavita-progress-contract-probe.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.103.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Kavita-Reader-Progress-Contract.md`, `backend/release-feed.json`, `artifacts/dependency-audit/backend-audit.json`, `artifacts/dependency-audit/frontend-audit.json`, `artifacts/init-parity-evidence/init-parity-evidence.json`, `artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks/follow-ups: no runtime mark read/unread behavior exists yet; a future implementation should start with explicit chapter-level mark-read only, handle the missing chapter-level mark-unread API shape, and avoid series/volume bulk mutations until product copy and ownership are clear.
- What remains in the milestone: no open `3.4.103` implementation work remains; CI-only and homelab-runtime release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.103 Kavita mark read unread contract`.

## 3.4.104 — Kavita Chapter Mark-Read Implementation

**Goal:** Implement the narrow Kavita chapter mark-read action defined by `3.4.103` without enabling series-wide, volume-wide, automatic, or unread read-state writes.

**Current Slice:** `Closed`

### Scope

- Add a scoped backend endpoint for Kavita chapter-backed media rows to call `POST /api/Reader/mark-chapter-read`.
- Require explicit user confirmation and workspace-admin access, matching the progress writeback ownership model.
- Add a compact media-detail drawer action for `Mark Read in Kavita`.
- Extend fake-Kavita smoke coverage to prove exactly one chapter mark-read call and no bulk read-state endpoint calls.
- Keep series-wide mark read/unread, volume-wide mark read, chapter unread, automatic/background read-state writes, KOReader sync, and shared provider abstractions out of scope.

### Acceptance Criteria

- Chapter-backed Kavita rows can explicitly mark the linked chapter read in Kavita from the running stack.
- Browser-visible responses never include Kavita API keys, bearer tokens, OPDS keys, or Kavita file names.
- Fake-Kavita smoke proves only `POST /api/Reader/mark-chapter-read` is called for read-state writes.
- The Kavita progress/read-state contract probe reports chapter mark-read enabled while bulk read-state endpoints remain prohibited.
- Version metadata and Help > Releases are aligned to `3.4.104`.

### Closeout

- Roadmap slice: `3.4.104 — Kavita Chapter Mark-Read Implementation`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Kavita-Reader-Progress-Contract.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, and `docs/wiki/10-CI-CD-and-Registry-Deploy.md`.
- Runtime verification used: rebuilt the Docker platform stack with `APP_VERSION=3.4.104`; verified `/api/health` serving frontend/backend/build `3.4.104`; verified Help > Releases serves `v3.4.104`; verified live DB `feature_flags.events_enabled=true`; ran the running-stack Kavita import/sync smoke with chapter mark-read coverage, proving `readStateEndpointCalls=1`, `bulkReadStateEndpointCalls=0`, and `secretReturned=false`; and ran the Kavita progress/read-state contract probe in the backend container, proving `POST /api/Reader/mark-chapter-read` is enabled while series, volume, panel, KOReader, and unread endpoints remain prohibited.
- CI/checks run locally: source syntax checks for `backend/routes/media.js`, `backend/services/kavita.js`, `backend/services/kavitaProgressContract.js`, `backend/middleware/validate.js`, `backend/scripts/kavita-import-sync-smoke.js`, and `backend/scripts/kavita-progress-contract-probe.js`; local OpenAPI validation; local Kavita progress/read-state contract probe; local unit/source assertions reached and passed the new Kavita assertions before the known host Node 14 `AbortController` gap; `git diff --check`; `npm run compose:generate`; `npm run validate:public-export`; Docker backend/frontend build; container backend unit/source assertions (`246` passed); container OpenAPI validation; container Kavita progress/read-state contract probe; container Kavita import/sync smoke; Help > Releases smoke; RBAC regression; platform edition boundary smoke; init parity; migration rehearsal; observability release evidence refresh (`9/9` passed); dependency audits via Node 20 containers (backend `0` low, `2` moderate, `0` high, `0` critical; frontend `0` vulnerabilities); targeted Playwright integrations browser regression (`3` passed); and local release preflight. Local preflight still blocks the full compose-smoke secure-cookie path because the dev stack has `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; `secret-scan`, full CI browser regression, homelab generated-compose boundary, and `image-security-and-sbom` remain CI/release-handoff gates before a public tag.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata and lockfiles, `docker-compose.yml`, `docs/releases/v3.4.104.md`, and `backend/release-feed.json` are aligned to `3.4.104`.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/middleware/validate.js`, `backend/routes/media.js`, `backend/services/kavita.js`, `backend/services/kavitaProgressContract.js`, `backend/scripts/kavita-import-sync-smoke.js`, `backend/scripts/kavita-progress-contract-probe.js`, `backend/scripts/unit-tests.js`, `backend/openapi/openapi.yaml`, `frontend/src/components/LibraryView.jsx`, `docker-compose.yml`, `docs/releases/v3.4.104.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Kavita-Reader-Progress-Contract.md`, `backend/release-feed.json`, `artifacts/dependency-audit/backend-audit.json`, `artifacts/dependency-audit/frontend-audit.json`, `artifacts/init-parity-evidence/init-parity-evidence.json`, `artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks/follow-ups: the action writes to the workspace-owned Kavita account, not a distinct per-collectZ-user Kavita identity; chapter unread still needs design because the checked Kavita OpenAPI snapshot has no chapter-level mark-unread endpoint; series-wide mark read/unread and volume-wide mark read remain intentionally disabled.
- What remains in the milestone: no open `3.4.104` implementation work remains; CI-only and homelab-runtime release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.104 Kavita chapter mark-read implementation`.

## 3.4.105 — Kavita Chapter Unread Contract

**Goal:** Define whether and how collectZ can safely reverse Kavita chapter read state after `3.4.104`, without adding a misleading or destructive unread action.

**Status:** Completed.

### Scope

- Recheck Kavita's upstream OpenAPI reader/progress surface for chapter-level unread or reset-progress semantics.
- Document why series, volume, multiple-volume, multiple-series, panel, and KOReader unread/progress endpoints remain prohibited.
- Treat `POST /api/Reader/progress` with `pageNum: 0` as discovery-only until real Kavita runtime behavior proves whether it resets progress or true read state.
- Extend the Kavita progress/read-state contract probe with unread/reversal evidence.
- Keep runtime unread routes, UI controls, import-triggered reversal, background polling, KOReader sync, and shared provider abstractions out of scope.

### Acceptance Criteria

- Contract docs identify that the checked Kavita OpenAPI snapshot has no chapter-level mark-unread endpoint.
- The probe reports unread implementation disabled and lists prohibited bulk unread endpoints.
- The docs distinguish reset-progress copy from true unread semantics.
- Version metadata and Help > Releases are aligned to `3.4.105`.

### Closeout

- Roadmap slice: `3.4.105 — Kavita Chapter Unread Contract`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Kavita-Reader-Progress-Contract.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, and `docs/wiki/10-CI-CD-and-Registry-Deploy.md`.
- Runtime verification used: rebuilt and restored the Docker platform stack with `APP_VERSION=3.4.105`; verified `/api/health` serving frontend/backend/build `3.4.105`; verified Help > Releases serves `v3.4.105`; verified live DB `feature_flags.events_enabled=true` after evidence tooling; ran the Kavita progress/read-state contract probe in the backend container, proving unread implementation remains disabled, no chapter-unread endpoint is available, bulk unread endpoints stay prohibited, progress page `0` remains discovery-only, and `secretReturned=false`; temporarily swapped to generated public compose plus `.ci/docker-compose.build.yml` for homelab boundary verification with `APP_EDITION` unset, then restored the localhost platform stack and rechecked health.
- CI/checks run locally: source syntax checks for `backend/services/kavitaProgressContract.js`, `backend/scripts/kavita-progress-contract-probe.js`, and `backend/scripts/unit-tests.js`; local OpenAPI validation; local Kavita progress/read-state contract probe; local unit/source assertions reached and passed the new Kavita assertions before the known host Node 14 `AbortController` gap; `git diff --check`; Docker backend/frontend build; container backend unit/source assertions (`247` passed); container OpenAPI validation; container Kavita progress/read-state contract probe; Help > Releases smoke with `EXPECTED_RELEASE_VERSION=v3.4.105`; API integration smoke; RBAC regression; platform edition boundary smoke; isolated generated-compose homelab edition boundary smoke; init parity; migration rehearsal; observability release evidence refresh (`9/9` passed); dependency audits via Node 20 containers (backend `0` low, `2` moderate, `0` high, `0` critical; frontend `0` vulnerabilities); targeted Playwright integrations browser regression (`3` passed); full browser regression (`58` passed, `4` skipped); `npm run compose:generate`; `npm run validate:public-export`; release-feed regeneration; and local release preflight.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata and lockfiles, `docker-compose.yml`, `docs/releases/v3.4.105.md`, and `backend/release-feed.json` are aligned to `3.4.105`.
- Release gate accounting: rebuilt stack health and runtime smokes locally covered compose basics except CI secure-cookie settings; `rbac-regression`, full local `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, dependency-audit artifact checks, init parity, migration rehearsal, and observability evidence passed locally. Local release preflight marks secure-cookie compose coverage blocked in the development stack (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`), and CI must still rerun `compose-smoke`, `secret-scan`, and `image-security-and-sbom`.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/services/kavitaProgressContract.js`, `backend/scripts/kavita-progress-contract-probe.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.105.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Kavita-Reader-Progress-Contract.md`, `backend/release-feed.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks/follow-ups: Kavita still offers no checked chapter-level mark-unread endpoint, so runtime unread/reset-progress remains intentionally out of product UI; progress page `0` needs real Kavita runtime proof before it can be described as unread or reset; CI-only secret scan and image security/SBOM must still pass before public tag/release publication.
- What remains in the milestone: no open `3.4.105` implementation work remains; later Kavita work should stay separated into runtime unread discovery/implementation, richer embedded reader ownership, raw/PDF chapter proxying, KOReader/background sync, and shared provider abstractions.
- Recommended commit message: `Release 3.4.105 Kavita chapter unread contract`.

## 3.4.106 — Kavita Reset Progress Runtime Proof

**Goal:** Prove the narrow Kavita reset-progress payload shape after `3.4.105` without exposing a misleading unread or reset-progress product control.

**Status:** Completed.

### Scope

- Extend the Kavita progress/read-state probe to exercise `POST /api/Reader/progress` with `pageNum: 0` against the fake Kavita-compatible runtime.
- Keep the proof explicit that this is reset-progress probe evidence, not true chapter-unread semantics.
- Confirm no series, volume, multiple-volume, multiple-series, panel, or KOReader unread/progress endpoint is called.
- Keep runtime `kavita-reset-progress` routes, drawer controls, import/sync writes, background jobs, and `Reset Kavita progress` UI copy out of scope.
- Preserve backend-only Kavita credentials and secret-free probe readback.

### Acceptance Criteria

- The Kavita progress/read-state probe reports a reset-progress probe payload with `pageNum: 0` and no bulk unread endpoint calls.
- Contract docs distinguish probe-only reset-progress evidence from true unread behavior.
- Source assertions prove no reset-progress route or UI control was introduced.
- Version metadata and Help > Releases are aligned to `3.4.106`.

### Closeout

- Roadmap slice: `3.4.106 — Kavita Reset Progress Runtime Proof`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Kavita-Reader-Progress-Contract.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, and `docs/wiki/10-CI-CD-and-Registry-Deploy.md`.
- Runtime verification used: rebuilt and restored the Docker platform stack with `APP_VERSION=3.4.106`; verified `/api/health` serving frontend/backend/build `3.4.106`; verified Help > Releases serves `v3.4.106`; verified live DB `feature_flags.events_enabled=true`; ran the Kavita progress/read-state contract probe in the backend container, proving the reset-progress probe uses `POST /api/Reader/progress` with `pageNum=0`, no bulk unread endpoint is called, reset/unread implementation remains disabled, and `secretReturned=false`; temporarily swapped to generated public compose plus `.ci/docker-compose.build.yml` for homelab boundary verification with `APP_EDITION` unset, then restored the localhost platform stack and rechecked health.
- CI/checks run locally: source syntax checks for `backend/services/kavitaProgressContract.js`, `backend/scripts/kavita-progress-contract-probe.js`, and `backend/scripts/unit-tests.js`; local Kavita progress/read-state contract probe; local unit/source assertions reached and passed the new Kavita assertions before the known host Node 14 `AbortController` gap; `git diff --check`; Docker backend/frontend build; container backend unit/source assertions (`248` passed); container OpenAPI validation; container Kavita progress/read-state contract probe; Help > Releases smoke with `EXPECTED_RELEASE_VERSION=v3.4.106`; API integration smoke; RBAC regression; platform edition boundary smoke; isolated generated-compose homelab edition boundary smoke; init parity; migration rehearsal; observability release evidence refresh (`9/9` passed); dependency audits via Node 20 containers (backend `0` low, `2` moderate, `0` high, `0` critical; frontend `0` vulnerabilities); full browser regression rerun after an initial concurrent observability/container churn failure (`58` passed, `4` skipped); `npm run compose:generate`; `npm run validate:public-export`; release-feed regeneration; and local release preflight.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata and lockfiles, `docker-compose.yml`, `docs/releases/v3.4.106.md`, and `backend/release-feed.json` are aligned to `3.4.106`.
- Release gate accounting: rebuilt stack health and runtime smokes locally covered compose basics except CI secure-cookie settings; `rbac-regression`, full local `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, dependency-audit artifact checks, init parity, migration rehearsal, and observability evidence passed locally. Local release preflight marks secure-cookie compose coverage blocked in the development stack (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`), and CI must still rerun `compose-smoke`, `secret-scan`, and `image-security-and-sbom`.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/services/kavitaProgressContract.js`, `backend/scripts/kavita-progress-contract-probe.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.106.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Kavita-Reader-Progress-Contract.md`, `backend/release-feed.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks/follow-ups: this proves only the collectZ/fake-Kavita reset-progress payload shape, not real Kavita unread semantics; no reset-progress UI or route is enabled; a future runtime implementation still needs real Kavita verification, copy that says reset progress rather than mark unread, and explicit user action.
- What remains in the milestone: no open `3.4.106` implementation work remains; later Kavita work should stay separated into real runtime reset/unread implementation, richer embedded reader ownership, raw/PDF chapter proxying, KOReader/background sync, and shared provider abstractions.
- Recommended commit message: `Release 3.4.106 Kavita reset progress runtime proof`.

## 3.4.107 — Kavita Runtime Unread/Reset Implementation

**Goal:** Enable the narrow Kavita reset-progress runtime action proven in `3.4.106` while keeping product copy and API behavior clear that this is not true chapter-level mark-unread.

**Status:** Completed.

### Scope

- Add an explicit Kavita chapter-backed reset-progress route using `POST /api/Reader/progress` with `pageNum: 0` and `bookScrollId: null`.
- Add a media detail drawer control labeled `Reset Progress`.
- Keep `Mark Unread in Kavita` copy out of the UI because Kavita still exposes no checked chapter-level mark-unread endpoint.
- Preserve the existing `Mark Read in Kavita` action.
- Prove the reset-progress runtime path through the fake Kavita-compatible running-stack smoke.
- Keep series-wide unread, volume-wide unread, multiple-volume/multiple-series unread, panel progress, KOReader sync, background polling, and full embedded reader ownership out of scope.

### Acceptance Criteria

- Workspace admins can explicitly reset progress for a Kavita chapter-backed row.
- The reset payload writes page `0` and clears `bookScrollId`.
- Browser-visible reset readback remains secret-free.
- Smoke coverage proves no bulk unread endpoint is called.
- The UI and API copy distinguish reset progress from true mark-unread behavior.
- Version metadata and Help > Releases are aligned to `3.4.107`.

### Closeout

- Roadmap slice: `3.4.107 — Kavita Runtime Unread/Reset Implementation`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Kavita-Reader-Progress-Contract.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, and `docs/wiki/10-CI-CD-and-Registry-Deploy.md`.
- Runtime verification used: rebuilt and restored the Docker platform stack with `APP_VERSION=3.4.107`; verified `/api/health` serving frontend/backend/build `3.4.107`; verified the running backend container reports `APP_VERSION=3.4.107`, `APP_EDITION=platform`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; verified live DB `feature_flags.events_enabled=true` before rebuild, after rebuild, after observability evidence, and after final platform restore; ran the Kavita progress/read-state contract probe in the backend container, proving reset-progress is runtime-enabled through `POST /api/Reader/progress` with `pageNum=0` while unread implementation stays false and `secretReturned=false`; ran the Kavita import/sync smoke in-stack with fake Kavita runtime, proving progress write page `1`, reset-progress page `0`, `bulkReadStateEndpointCalls=0`, secret-free responses, cover proxy readback, workspace-owned settings, and cross-workspace Kavita isolation; temporarily switched to generated public compose plus `.ci/docker-compose.build.yml` for homelab boundary verification, then restored the localhost platform stack and rechecked health.
- CI/checks run locally: source syntax checks for `backend/routes/media.js`, `backend/services/kavitaProgressContract.js`, `backend/scripts/kavita-import-sync-smoke.js`, `backend/scripts/kavita-progress-contract-probe.js`, and `backend/scripts/unit-tests.js`; local OpenAPI validation; local Kavita progress/read-state contract probe; local unit/source assertions reached and passed the new Kavita assertions before the known host Node 14 `AbortController` gap; Docker backend/frontend build; container backend unit/source assertions (`248` passed); container OpenAPI validation; container Kavita progress/read-state contract probe; container Kavita import/sync smoke with `BASE_URL=http://frontend:3000`; Help > Releases smoke with `EXPECTED_RELEASE_VERSION=v3.4.107`; API integration smoke; RBAC regression; platform edition boundary smoke; isolated generated-compose homelab edition boundary smoke; init parity; migration rehearsal; observability release evidence refresh (`9/9` passed); local release preflight; full browser regression rerun after an initial concurrent observability/container churn failure (`58` passed, `4` skipped); `npm run compose:generate`; `npm run validate:public-export`; release-feed regeneration; release artifact secret-pattern grep over release note, release feed, preflight, migration/init evidence, and observability evidence; version metadata sync check; and `git diff --check`.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata and lockfiles, `docker-compose.yml`, `docs/releases/v3.4.107.md`, and `backend/release-feed.json` are aligned to `3.4.107`; running Help > Releases serves `v3.4.107` first.
- Release gate accounting: rebuilt stack health and runtime smokes locally covered compose basics except CI secure-cookie settings; `rbac-regression`, local `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, dependency-audit artifact checks, init parity, migration rehearsal, and observability evidence passed locally. Local release preflight marks secure-cookie compose coverage blocked in the development stack (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`), and CI must still rerun `compose-smoke`, `secret-scan`, and `image-security-and-sbom`.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/middleware/validate.js`, `backend/openapi/openapi.yaml`, `backend/routes/media.js`, `backend/services/kavitaProgressContract.js`, `backend/scripts/kavita-import-sync-smoke.js`, `backend/scripts/kavita-progress-contract-probe.js`, `backend/scripts/unit-tests.js`, `frontend/src/components/LibraryView.jsx`, `docker-compose.yml`, `docs/releases/v3.4.107.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Kavita-Reader-Progress-Contract.md`, `backend/release-feed.json`, `artifacts/dependency-audit/backend-audit.json`, `artifacts/dependency-audit/frontend-audit.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks/follow-ups: Kavita still exposes no checked chapter-level mark-unread endpoint, so collectZ labels this action `Reset Progress` and keeps true chapter unread out of scope; reset progress represents the workspace-owned Kavita account, not a distinct collectZ-user Kavita identity; full embedded reader ownership, raw/PDF chapter proxying, background polling, KOReader sync, and shared provider abstractions remain separate future work.
- What remains in the milestone: no open `3.4.107` implementation work remains; CI-only release gates must pass before public tag/release publication. Later Kavita work should stay separated into true chapter unread if Kavita exposes/proves a safe endpoint, richer embedded reader ownership, raw/PDF chapter proxying, KOReader/background sync, and shared provider abstractions.
- Recommended commit message: `Release 3.4.107 Kavita runtime unread reset implementation`.

## 3.4.108 — Kavita Embedded Reader Controls Polish

**Goal:** Polish the existing Kavita chapter page-proxy controls so reader page preview, progress readback, save progress, reset progress, and mark-read actions feel cohesive without widening into full embedded reader ownership.

**Status:** Completed.

### Scope

- Improve the media drawer's Kavita chapter reader section layout and copy.
- Present page controls as one-based user-facing page numbers while keeping the existing zero-based backend page parameter.
- Add clearer reader loaded/error/loading states for the proxied page image.
- Group `Load Reader`, `Save Progress`, `Reset Progress`, and `Mark Read in Kavita` as explicit actions.
- Preserve the existing progress/read/reset endpoints and workspace-admin write boundaries.
- Keep iframe reader ownership, raw/PDF chapter proxying, automatic progress writes, background polling, KOReader sync, and true mark-unread behavior out of scope.

### Acceptance Criteria

- Kavita chapter-backed rows show a cohesive `Kavita Reader` drawer section.
- The drawer displays current page, total pages, saved progress, and reader/image loading state clearly.
- Page entry uses one-based page numbers without changing backend API semantics.
- Reader image failures surface a browser-visible error state.
- Existing Kavita import/sync and progress contract smokes still pass.
- Version metadata and Help > Releases are aligned to `3.4.108`.

### Closeout

- Roadmap slice: `3.4.108 — Kavita Embedded Reader Controls Polish`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/42-Kavita-Reader-Progress-Contract.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/08-Backlog.md`, and this roadmap.
- Runtime verification used: rebuilt the Docker platform stack with `APP_VERSION=3.4.108`; verified `/api/health` reports frontend/backend/build `3.4.108`; verified the running backend container reports platform development runtime values; verified live DB `feature_flags.events_enabled=true` before the slice, after stack restore, after observability evidence, and after final checks; verified Help > Releases serves `v3.4.108` first; ran Kavita progress and import/sync smokes inside the stack with fake Kavita runtime, including reader info/image proxy calls, progress reset page `0`, progress write page `1`, no bulk read-state calls, secret-free responses, cover proxy readback, workspace-owned settings, cross-workspace isolation, and existing non-Kavita title reuse.
- CI/checks run locally: changed-source unit assertions; Docker container `npm run test:unit` (`249` passed); Docker container OpenAPI validation; Docker container Kavita progress contract probe; Docker container Kavita import/sync smoke with `BASE_URL=http://frontend:3000`; Docker Help > Releases smoke with `EXPECTED_RELEASE_VERSION=v3.4.108`; Docker API integration smoke; Docker init parity; Docker migration rehearsal; Docker RBAC regression; Docker platform edition boundary; generated-compose homelab edition boundary; `npm run compose:generate`; `npm run validate:public-export`; observability release evidence (`9/9` passed); local release preflight; full Playwright browser regression (`58` passed, `4` skipped); version sync check; release artifact secret-pattern grep; and `git diff --check`.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata and lockfiles, `docker-compose.yml`, `docs/releases/v3.4.108.md`, and `backend/release-feed.json` are aligned to `3.4.108`; running Help > Releases serves `v3.4.108` first.
- Release gate accounting: rebuilt stack health, response headers, CSRF/auth basics, and integration smoke locally covered compose basics except the CI secure-cookie profile; `rbac-regression`, local `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, dependency-audit artifact checks, init parity, migration rehearsal, and observability evidence passed locally. Local release preflight marks secure-cookie compose coverage blocked in the development stack (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`), and CI must still rerun `compose-smoke`, `secret-scan`, and `image-security-and-sbom`.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/scripts/unit-tests.js`, `frontend/src/components/LibraryView.jsx`, `docker-compose.yml`, `docs/releases/v3.4.108.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/42-Kavita-Reader-Progress-Contract.md`, `backend/release-feed.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: the UI polish remains a page-image preview rather than a full Kavita iframe/streaming reader; true unread, raw/PDF proxying, automatic progress writes, background polling, KOReader sync, and shared provider-reader abstractions remain intentionally out of scope. Local `gitleaks` and `trivy` binaries were not installed, so those scanner gates remain CI-only plus local release-artifact grep hygiene.
- What remains in the milestone: no open `3.4.108` implementation work remains; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.108 Kavita embedded reader controls polish`.

## 3.4.109 — Artwork Numbered Print Metadata and Badge

**Goal:** Let artwork entries capture numbered print details, including the specific print number and total print run, and surface a clear numbered-print badge in artwork cards, rows, and detail views.

**Current Slice:** `Closed`

### Scope

- Add item-local Art metadata fields for print number and print run / edition size.
- Support partial entry where only the print number or only the run size is known.
- Validate positive integer values without making non-numbered artwork harder to create.
- Show concise `#12/100 Signed Print`, `Print #12`, or `Print Run 100` readback in browse and detail surfaces when data exists.
- Preserve existing Art type, provenance, signature, event purchase, image, artist, dimension, and framing fields.
- Keep reusable artist records, valuation-provider enrichment, external print registries, certificate verification, and broad edition-series modeling out of scope.

### Acceptance Criteria

- Users can add or edit an artwork item with print number and print run values.
- Non-numbered artwork can still be created and edited without extra required fields.
- Artwork card, list, and detail surfaces show a numbered-print badge/readback when print metadata is present.
- API, OpenAPI, migration, and browser coverage prove the fields round-trip and the badge/readback appears only when appropriate.
- Version metadata and Help > Releases are aligned to `3.4.109`.

### Closeout

- Roadmap slice: `3.4.109 — Artwork Numbered Print Metadata and Badge`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, and the Art implementation contracts in `backend/openapi/openapi.yaml`.
- Runtime verification used: rebuilt the Docker platform stack with `APP_VERSION=3.4.109`; verified `/api/health` reports frontend/backend/build `3.4.109`; verified the running backend container reports `APP_VERSION=3.4.109`, `APP_EDITION=platform`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; verified live DB `schema_migrations` includes version `95`; verified `art_items.print_number` and `art_items.print_run` exist as integer columns; verified live DB `feature_flags.events_enabled=true` before rebuild, after rebuild, after observability evidence, and after final stack restore; verified Help > Releases serves `v3.4.109` first.
- CI/checks run locally: source syntax checks for `backend/db/migrations.js`, `backend/middleware/validate.js`, and `backend/routes/collectibles.js`; local backend unit/source assertions (`250` passed); local OpenAPI validation; local Vite build; Docker backend/frontend build; container backend unit/source assertions (`250` passed); container OpenAPI validation; Help > Releases smoke with `EXPECTED_RELEASE_VERSION=v3.4.109`; API integration smoke; init parity; migration rehearsal; RBAC regression; platform edition boundary smoke; generated-compose homelab edition boundary smoke; `npm run compose:generate`; `npm run validate:public-export`; full Playwright browser regression (`58` passed, `4` skipped) including Art print metadata API round-trip; observability release evidence (`9/9` passed after lowering the local Graylog evidence journal default); local release preflight; version sync check; release artifact secret-pattern grep; and `git diff --check`.
- Version closeout: `app-meta.json`, backend/frontend app metadata, backend/frontend package metadata, `docker-compose.yml`, `docs/releases/v3.4.109.md`, and `backend/release-feed.json` are aligned to `3.4.109`; running Help > Releases serves `v3.4.109` first.
- Release gate accounting: rebuilt stack health, response headers, `/api/auth/config`, unauthenticated `/api/auth/me`, and integration smoke locally covered compose basics except the CI secure-cookie profile; `rbac-regression`, local `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, dependency-audit artifact checks, init parity, migration rehearsal, and observability evidence passed locally. Local release preflight marks secure-cookie compose coverage blocked in the development stack (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`), and CI must still rerun `compose-smoke`, `secret-scan`, and `image-security-and-sbom`.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/db/migrations.js`, `backend/middleware/validate.js`, `backend/openapi/openapi.yaml`, `backend/routes/collectibles.js`, `backend/scripts/unit-tests.js`, `frontend/src/components/ArtView.jsx`, `init.sql`, `ops/logging/docker-compose.graylog.yml`, `docker-compose.yml`, `docs/releases/v3.4.109.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `backend/release-feed.json`, `artifacts/observability-evidence/observability-release-evidence.json`, `artifacts/init-parity-evidence/init-parity-evidence.json`, `artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json`, `preflight-go-no-go.md`, and `tests/playwright/specs/events-collectibles.browser.spec.js`.
- Risks or follow-ups: numbered print metadata is intentionally item-local; Art poster cards now keep edition/signed/medium as a quiet subtitle and leave fuller series/artist/purchase context to list and detail views; reusable artist records, valuation enrichment, external print registries, certificate verification, and broad edition-series modeling remain separate. Local `gitleaks` and `trivy` binaries were not installed, so `secret-scan` and `image-security-and-sbom` remain CI-only plus local release-artifact grep hygiene.
- What remains in the milestone: no open `3.4.109` implementation work remains; CI-only release gates must pass before public tag/release publication.
- Recommended commit message: `Release 3.4.109 Artwork numbered print metadata and badge`.

## 3.4.110 — Release Channel Automation and Stable Promotion

**Goal:** Define the collectZ `latest` and `stable` release channels for homelab users and automate stable promotion as a deliberate maintainer action.

**Current Slice:** `Closed`

### Scope

- Add a GitHub security policy that states supported release channels.
- Document `latest`, `stable`, exact semver tags, and moving minor tags.
- Keep `latest` as the automatic publish output for green releases.
- Add a manual stable-promotion workflow that retags existing exact-version images instead of rebuilding.
- Add release/source assertions so channel policy, docs, and workflow do not drift silently.

### Acceptance Criteria

- The repository documents `latest` as the newest release and `stable` as the recommended homelab channel.
- The repository documents a weekly `latest` cadence plus manual `stable` promotion after at least seven days of clean maintainer homelab use and no known blocker.
- Maintainers can run a manual workflow with an exact version to promote backend/frontend images to `stable` and `stable-<major.minor>`.
- Stable promotion verifies the git tag, release note, successful release workflow, and exact backend/frontend images before retagging.
- Version metadata and Help > Releases are aligned to `3.4.110`.

### Closeout

- Roadmap slice: `3.4.110 — Release Channel Automation and Stable Promotion`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, and release note workflow via `docs/releases/v3.4.110.md` plus `backend/release-feed.json`.
- Runtime verification used: rebuilt the Docker platform stack with `APP_VERSION=3.4.110`; verified `/api/health` reports frontend/backend/build `3.4.110`; verified running backend `APP_VERSION=3.4.110`; verified Help > Releases serves `v3.4.110` first; verified live DB writeability with a temp-table insert after Docker cache cleanup; verified live DB `feature_flags.events_enabled=true` and `feature_flags.collectibles_enabled=true`; temporarily switched to generated homelab compose with `.ci/docker-compose.build.yml` for the homelab boundary gate, then restored the localhost platform stack.
- CI/checks run locally: workflow YAML parse for `.github/workflows/*.yml`; local backend unit/source assertions (`251` passed); Docker backend unit/source assertions (`251` passed); local frontend Vite build; Docker backend/frontend build; Docker OpenAPI validation; Docker Help > Releases smoke with `EXPECTED_RELEASE_VERSION=v3.4.110`; Docker RBAC regression; Docker platform edition boundary; generated-compose homelab edition boundary; `npm run validate:public-export`; version metadata sync check; release-note section check; `git diff --check`; full browser regression after Docker storage cleanup (`58` passed, `4` skipped, with one transient miss rerun targeted and passing); local release preflight.
- Release gate accounting: release-channel workflow behavior is source-verified locally, but the actual `Promote Stable Images` workflow must run in GitHub because it requires GHCR package write permissions and GitHub Actions run history. Local release preflight passed version sync, release note presence, dependency-audit artifact checks, and migration evidence checks; it still marks compose secure-cookie coverage blocked in the development stack (`SESSION_COOKIE_SECURE=false`, `NODE_ENV=development`), and marks observability evidence failed because the existing artifact is stale at `3.4.109` and the local refresh was blocked by Docker Desktop storage exhaustion (`No space left on device`) while starting Graylog/MongoDB/OpenSearch. CI must still rerun `compose-smoke`, `browser-regression`, `secret-scan`, `image-security-and-sbom`, and release publish checks.
- Files changed: `SECURITY.md`, `.github/workflows/promote-stable.yml`, `README.md`, `env.example`, `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, backend/frontend package manifests and lockfiles, `docker-compose.yml`, `backend/scripts/unit-tests.js`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/releases/v3.4.110.md`, `backend/release-feed.json`, `preflight-go-no-go.md`, and this roadmap.
- Risks or follow-ups: stable promotion remains a maintainer judgment call after at least seven days of clean homelab use; rollback protection depends on image version labels being available and otherwise warns rather than blocking; local observability evidence needs rerun after Docker storage is cleaned further or in CI/release evidence infrastructure.
- What remains in the milestone: no open `3.4.110` implementation work remains; CI-only and locally blocked release gates must pass before public tag/release publication, and stable promotion should only be run after the chosen latest release has soaked.
- Recommended commit message: `Release 3.4.110 release channel automation and stable promotion`.

## 3.4.111 — Plex PMS API Modernization Foundation

**Goal:** Establish a provider-oriented Plex PMS API contract for future Plex features without changing the current legacy-path import behavior.

**Current Slice:** `Closed`

### Scope

- Audit and document the current Plex legacy import paths.
- Add a provider-oriented PMS modernization contract in the Plex service layer.
- Add lightweight `/media/providers` discovery parsing for future Plex-facing slices.
- Preserve existing Plex import, duplicate-avoidance, TV season, and metadata behavior.
- Remove the promoted Plex PMS item from the backlog.

### Acceptance Criteria

- Existing Plex import paths remain stable and documented as current behavior.
- A provider-oriented modernization contract identifies `/media/providers` as the next discovery seam.
- Source assertions cover the contract and provider parsing for JSON/XML-shaped PMS payloads.
- No Now Playing UI, Plex webhook, scheduled sync, or broad import rewrite is introduced in this slice.

### Closeout

- Version: `3.4.111`
- Release note: `docs/releases/v3.4.111.md`
- Release feed: regenerated with `backend/scripts/export-release-feed.js`; running Help > Releases smoke served `v3.4.111` as latest.
- Runtime evidence: Docker stack health reported frontend/backend/build `3.4.111`; live DB kept `events_enabled=true`; Help > Releases smoke passed.
- Verification: backend unit tests, OpenAPI validation, init parity, migration rehearsal, release preflight local, observability release evidence, RBAC regression, browser regression, homelab edition boundary, platform edition boundary, public export validation, and diff whitespace checks passed locally.
- CI-only follow-up: `secret-scan` and `image-security-and-sbom` still require the GitHub Actions scanners.
- Remaining Plex PMS work: Now Playing UI, webhook handling, scheduled sync cadence, and any broad import rewrite remain separate future slices.

## 3.4.112 — Plex Provider Discovery Runtime Proof

**Goal:** Prove the new Plex `/media/providers` discovery path against a PMS-shaped runtime response before changing import behavior.

**Current Slice:** `Closed`

### Scope

- Add a Docker-runnable backend smoke that starts a fake PMS server and exercises the real Plex provider-discovery fetch path.
- Verify the fake PMS receives `GET /media/providers` with token-bearing auth while the evidence output stays secret-free.
- Persist lightweight runtime evidence for provider keys, titles, types, protocols, and feature keys.
- Keep existing Plex import paths and Now Playing, webhook, scheduled sync, and broad import rewrite work out of scope.

### Acceptance Criteria

- `npm run test:plex-provider-discovery-smoke` passes inside the backend container.
- The smoke writes `artifacts/plex-provider-discovery/plex-provider-discovery-smoke.json`.
- The evidence proves normalized provider readback without returning Plex tokens, provider URLs, file paths, or raw locations.
- Existing Plex import tests and release gates continue to pass.

### Closeout

- Version: `3.4.112`
- Release note: `docs/releases/v3.4.112.md`
- Release feed: regenerated with `backend/scripts/export-release-feed.js`; running Help > Releases smoke served `v3.4.112` as latest.
- Runtime evidence: Docker stack health reported frontend/backend/build `3.4.112`; live DB kept `events_enabled=true`; `test:plex-provider-discovery-smoke` passed inside the backend container and proved a fake PMS `GET /media/providers` request plus safe normalized provider readback.
- Verification: backend unit tests, OpenAPI validation, init parity, migration rehearsal, release preflight local, observability release evidence, RBAC regression, browser regression, homelab edition boundary, platform edition boundary, provider-discovery smoke, and diff whitespace checks passed locally.
- CI-only follow-up: `secret-scan` and `image-security-and-sbom` still require the GitHub Actions scanners because local `gitleaks` and `trivy` binaries are not installed.
- Remaining Plex PMS work: Now Playing UI, webhook ingestion, scheduled sync cadence, real-server provider discovery readback, and any broad import rewrite remain separate future slices.

## 3.4.113 — Plex Real-Server Provider Discovery Readback

**Goal:** Let admins probe the real saved Plex PMS `/media/providers` endpoint from collectZ without exposing secrets or changing import behavior.

**Current Slice:** `Closed`

### Scope

- Add read-only admin and workspace integration probe endpoints for Plex provider discovery.
- Reuse saved Plex API URL/token settings server-side.
- Return only sanitized provider capability fields: key, title, type, protocol, identifier, and feature keys.
- Add a Plex Integrations UI action to run the provider probe and display sanitized readback.
- Keep existing Plex import paths, Now Playing, webhook ingestion, scheduled sync, and import rewrites out of scope.

### Acceptance Criteria

- Admin/global and workspace integrations can call a Plex provider probe without returning tokens, raw URLs, file paths, or raw PMS payloads.
- Existing Plex library-section test/import behavior remains intact.
- OpenAPI, source assertions, and release docs describe the probe as read-only.
- Running-stack verification proves the app serves `3.4.113` and Help > Releases contains the release.

### Closeout

- Version: `3.4.113`
- Release note: `docs/releases/v3.4.113.md`
- Release feed: regenerated with `backend/scripts/export-release-feed.js`; running Help > Releases smoke served `v3.4.113` as latest.
- Runtime evidence: Docker stack health reported frontend/backend/build `3.4.113`; live DB kept `events_enabled=true` and `collectibles_enabled=true`; `test:plex-provider-readback-smoke` passed inside the backend container and proved the saved-settings probe calls a fake PMS `/media/providers` endpoint while returning only sanitized provider readback; production-shaped compose smoke preflight passed in-stack health, headers, CSRF cookie, unauthenticated `401`, and integration smoke.
- Verification: backend unit tests, OpenAPI validation, init parity, migration rehearsal, release preflight local, observability release evidence, RBAC regression, browser regression, homelab edition boundary, platform edition boundary, public export validation, Plex provider readback smoke, Help > Releases smoke, and diff whitespace checks passed locally.
- Release gate accounting: `compose-smoke`, `rbac-regression`, `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, dependency-audit checks, init parity, migration rehearsal, and observability evidence passed locally. `secret-scan` and `image-security-and-sbom` still require GitHub Actions because local `gitleaks` and `trivy` binaries are not installed.
- Remaining Plex PMS work: Now Playing provider proof, Now Playing UI, webhook ingestion, scheduled sync cadence, real-user/manual PMS provider probe use, and any broad import rewrite remain separate future slices.

## 3.4.114 — Plex Now Playing Provider Proof

**Goal:** Prove the Plex PMS now-playing sessions surface with a safe read-only parser and Docker-runnable fake PMS smoke before adding any Now Playing UI or changing import behavior.

**Current Slice:** `Closed`

### Scope

- Add a provider-oriented `/status/sessions` contract to the Plex service layer.
- Add lightweight now-playing session parsing for JSON/XML-shaped PMS payloads.
- Normalize only safe readback fields: session key, rating key, title, type, series/parent title, year, duration, view offset, progress, user label/id, and player label/product/state/platform.
- Add a Docker-runnable fake PMS smoke that proves token-authenticated `/status/sessions` access and writes secret-free evidence.
- Keep Now Playing UI, webhooks, scheduled sync, watch-state writes, and import behavior changes out of scope.

### Acceptance Criteria

- `npm run test:plex-now-playing-provider-proof-smoke` passes inside the backend container.
- The smoke writes `artifacts/plex-now-playing/plex-now-playing-provider-proof-smoke.json`.
- The evidence proves safe session readback without Plex tokens, player IP addresses, machine identifiers, media file paths, provider URLs, or raw PMS payloads.
- Existing Plex provider discovery/readback and import paths remain unchanged.

### Closeout

- Version: `3.4.114`
- Release note: `docs/releases/v3.4.114.md`
- Release feed: regenerated with `backend/scripts/export-release-feed.js`; running Help > Releases smoke served `v3.4.114` as latest.
- Runtime evidence: Docker stack health reported frontend/backend/build `3.4.114`; live DB kept `events_enabled=true` and `collectibles_enabled=true`; `test:plex-now-playing-provider-proof-smoke` passed inside the backend container and proved a fake PMS `GET /status/sessions` request plus safe normalized session readback with no token, player IP, machine identifier, or media file path surfaced; production-shaped compose smoke preflight passed in-stack health, headers, CSRF cookie, unauthenticated `401`, and integration smoke.
- Verification: backend unit tests, OpenAPI validation, init parity, migration rehearsal, release preflight local, observability release evidence, RBAC regression, browser regression, homelab edition boundary, platform edition boundary, public export validation, Plex now-playing provider proof smoke, Help > Releases smoke, and diff whitespace checks passed locally.
- Release gate accounting: `compose-smoke`, `rbac-regression`, `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, dependency-audit checks, init parity, migration rehearsal, and observability evidence passed locally. `secret-scan` and `image-security-and-sbom` still require GitHub Actions because local `gitleaks` and `trivy` binaries are not installed.
- Remaining Plex PMS work: Now Playing readback endpoint, Now Playing UI, webhook ingestion, scheduled sync cadence, real-user/manual PMS now-playing probe use, watch-state writeback, and any broad import rewrite remain separate future slices.

## 3.4.115 — Plex Now Playing Readback Endpoint

**Goal:** Expose the proven Plex PMS `/status/sessions` now-playing parser through read-only admin and workspace integration endpoints using saved Plex settings, without adding UI or changing import behavior.

**Current Slice:** `Closed`

### Scope

- Add read-only admin and workspace integration probe endpoints for Plex now-playing sessions.
- Reuse saved Plex API URL/token settings server-side.
- Return only sanitized session fields from the `3.4.114` parser.
- Add a Docker-runnable fake PMS smoke that exercises the collectZ endpoint path against saved temporary Plex settings.
- Keep Now Playing UI, webhooks, scheduled sync, watch-state writes, and import behavior changes out of scope.

### Acceptance Criteria

- Admin/global and workspace integrations can call a Plex now-playing probe without returning tokens, player IP addresses, machine identifiers, media file paths, provider URLs, or raw PMS payloads.
- Existing Plex provider discovery/readback, library-section discovery, and import behavior remain intact.
- OpenAPI, source assertions, and release docs describe the probe as read-only.
- Running-stack verification proves the app serves `3.4.115` and Help > Releases contains the release.

### Closeout

- Version: `3.4.115`
- Release note: `docs/releases/v3.4.115.md`
- Release feed: regenerated with `backend/scripts/export-release-feed.js`; running Help > Releases smoke served `v3.4.115` as latest.
- Runtime evidence: Docker stack health reported frontend/backend/build `3.4.115`; live DB kept `events_enabled=true` and `collectibles_enabled=true`; `test:plex-now-playing-readback-smoke` passed inside the backend container and proved the collectZ admin endpoint calls a fake PMS `GET /status/sessions` with saved temporary Plex settings while returning only sanitized session readback; production-shaped compose smoke preflight passed in-stack health, headers, CSRF cookie, unauthenticated `401`, and integration smoke.
- Verification: backend unit tests, OpenAPI validation, init parity, migration rehearsal, release preflight local, observability release evidence, RBAC regression, browser regression, homelab edition boundary, platform edition boundary, public export validation, Plex now-playing readback smoke, Help > Releases smoke, and diff whitespace checks passed locally.
- Release gate accounting: `compose-smoke`, `rbac-regression`, `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, dependency-audit checks, init parity, migration rehearsal, and observability evidence passed locally. `secret-scan` and `image-security-and-sbom` still require GitHub Actions because local `gitleaks` and `trivy` binaries are not installed.
- Remaining Plex PMS work: Now Playing UI readback, real-user/manual PMS now-playing probe use, webhook ingestion, scheduled sync cadence, watch-state writeback, and any broad import rewrite remain separate future slices.

## 3.4.116 — Plex Now Playing UI Readback

**Goal:** Make the saved Plex now-playing readback endpoint visible as a compact read-only Integrations diagnostic without adding a dashboard surface, webhook behavior, scheduled sync, watch-state writes, or import changes.

**Current Slice:** `Closed 2026-05-06`

### Scope

- Add an `Active Sessions` action to the Plex Integrations action row.
- Call the existing admin/workspace `test-plex-now-playing` endpoints.
- Display sanitized session rows inside the existing Plex settings panel: title, type, progress, series/parent context, user label, and player state/platform/title.
- Show an explicit `No active Plex sessions.` empty state after a successful or failed checked readback with no sessions.
- Keep the surface read-only and diagnostic-only.

### Acceptance Criteria

- Plex Integrations can fetch and display now-playing sessions without exposing tokens, player IP addresses, machine identifiers, media file paths, provider URLs, or raw PMS payloads.
- Workspace and platform integrations both use the same endpoint-base wiring.
- Existing Plex provider discovery/readback, section discovery, imports, and now-playing endpoint behavior remain intact.
- Running-stack verification proves the app serves `3.4.116` and Help > Releases contains the release.

### Closeout

- Version: `3.4.116`.
- Release note: `docs/releases/v3.4.116.md`.
- Release feed: regenerated with `backend/scripts/export-release-feed.js`; running Help > Releases smoke served `v3.4.116` as latest.
- Runtime evidence: Docker health reported frontend/backend/build `3.4.116`; live DB kept `events_enabled=true` and `collectibles_enabled=true`; the containerized Plex now-playing readback smoke fetched one fake active session through `/status/sessions` and returned sanitized title readback; production-shaped preflight passed compose-smoke basics.
- Verification: container unit tests, OpenAPI validation, Plex now-playing readback smoke, Help Releases smoke, init parity, migration rehearsal, RBAC regression, platform edition boundary, homelab edition boundary, browser regression, observability evidence, release preflight, public export validation, integration smoke, secret-pattern artifact inspection, and `git diff --check` all passed locally.
- Release gate accounting: `compose-smoke`, `rbac-regression`, `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, and dependency-audit preflight passed locally. `secret-scan` and `image-security-and-sbom` remain CI-only because local `gitleaks` and `trivy` binaries are not installed; local artifact secret-pattern inspection passed.
- Remaining Plex PMS work: real-user/manual PMS now-playing proof, dashboard/widget decisions, webhook ingestion, scheduled sync cadence, watch-state writeback, and broad import modernization remain separate follow-up slices.

## 3.4.117 — Plex Real PMS Now Playing Runtime Proof

**Goal:** Prove the saved real Plex PMS `/status/sessions` runtime shape before building a dedicated Now Playing viewer, while keeping the evidence read-only and secret-free.

**Current Slice:** `Closed 2026-05-07`

### Scope

- Add a Docker-runnable proof script that uses saved Plex settings from the running stack instead of a fake PMS.
- Capture only sanitized field-coverage evidence for active sessions: title/type context, progress availability, player state/platform, Plex-relative poster/art key availability, and queue-presence hints.
- Extend the normalized now-playing session contract with Plex-relative `metadataKey`, `thumbKey`, `artKey`, and `hasQueueItem` readback for future authenticated viewer/proxy work.
- Keep evidence free of Plex tokens, provider URLs, player IP addresses, machine identifiers, media file paths, and raw PMS payloads.
- Keep imports, webhooks, scheduled sync, watch-state writes, and the dedicated viewer out of scope.

### Acceptance Criteria

- `npm run test:plex-real-now-playing-runtime-proof` runs inside the backend container and writes `artifacts/plex-now-playing/plex-real-now-playing-runtime-proof.json`.
- If saved Plex settings are unavailable, the proof exits cleanly with explicit skipped evidence instead of fabricating a result.
- If saved Plex settings are configured, the proof reaches `/status/sessions` and records sanitized viewer-readiness field coverage.
- Existing fake-PMS now-playing proof/readback smokes and UI readback continue to pass.
- Running-stack verification proves the app serves `3.4.117` and Help > Releases contains the release.

### Closeout

- Version: `3.4.117`.
- Release note: `docs/releases/v3.4.117.md`.
- Release feed: regenerated with `backend/scripts/export-release-feed.js`; running Help > Releases smoke served `v3.4.117` as latest.
- Runtime evidence: Docker health reported frontend/backend/build `3.4.117`; live DB kept `events_enabled=true` and `collectibles_enabled=true`; the real-PMS proof used saved admin Plex settings, reached `/status/sessions`, found one paused episode session, confirmed title/progress/player-state readback, confirmed Plex-relative metadata/thumb/art key availability, and confirmed no queue item hint was present.
- Verification: syntax checks for `backend/services/plex.js` and `backend/scripts/plex-real-now-playing-runtime-proof.js`; container unit tests (`261` passed); OpenAPI validation; real Plex now-playing runtime proof; fake-PMS now-playing provider proof; now-playing endpoint readback smoke; Help Releases smoke; init parity; migration rehearsal; RBAC regression; platform edition boundary; homelab edition boundary; browser regression (`59` passed, `4` skipped); observability evidence; release preflight; public export validation; release artifact secret-pattern inspection; and `git diff --check` all passed locally.
- Release gate accounting: `compose-smoke`, `rbac-regression`, `browser-regression`, `homelab-edition-boundary`, `platform-edition-boundary`, and dependency-audit preflight passed locally. `secret-scan` and `image-security-and-sbom` remain CI-only because local `gitleaks` and `trivy` binaries are not installed; local artifact secret-pattern inspection passed.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `frontend/src/app-meta.json`, `backend/package.json`, `frontend/package.json`, `backend/package-lock.json`, `frontend/package-lock.json`, `backend/services/plex.js`, `backend/scripts/plex-real-now-playing-runtime-proof.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `env.example`, `README.md`, `docs/releases/v3.4.117.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, `backend/release-feed.json`, `artifacts/plex-now-playing/plex-real-now-playing-runtime-proof.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks/follow-ups: the proof depends on whatever Plex is playing at run time, so queue behavior remains unproven when Plex does not expose a queue item in the active session; poster/art values are Plex-relative keys and still need an authenticated image proxy before a public viewer can display them; webhooks, scheduled sync cadence, watch-state writeback, and broad import modernization remain intentionally out of scope.
- What remains in the milestone: no open `3.4.117` implementation work remains; CI-only `secret-scan` and `image-security-and-sbom` must still pass in CI before public release publication.
- Recommended commit message: `Release 3.4.117 Plex real PMS now playing runtime proof`.

## 3.4.118 — Plex Now Playing Viewer

**Goal:** Add a standalone authenticated Plex Now Playing display page that can be opened on a passive display, using the proven `/status/sessions` readback and a safe app-owned image proxy.

**Current Slice:** `Closed 2026-05-07`

### Scope

- Add an authenticated `/now-playing` frontend route outside the dashboard shell.
- Add a read-only backend viewer endpoint that returns sanitized active-session display data.
- Add an authenticated Plex image proxy for Plex-relative poster/art keys without exposing Plex base URLs, tokens, file paths, IP addresses, machine identifiers, or raw PMS payloads.
- Refresh the viewer automatically while the browser tab is visible.
- Build v1 around the current playing or paused session only; keep next-queue behavior out of scope because `3.4.117` did not prove queue hints.

### Acceptance Criteria

- `/now-playing` renders a full-screen display page for authenticated admins.
- The viewer shows the current title, parent/show context, player state/platform, progress, and poster/art when Plex exposes usable keys.
- The viewer has explicit unavailable and nothing-playing states.
- `npm run test:plex-now-playing-viewer-smoke` passes inside the backend container against a fake PMS and proves both viewer JSON and proxied image readback.
- Existing Plex provider proof, real-PMS proof, readback endpoint, and Integrations UI behavior remain intact.
- Running-stack verification proves the app serves `3.4.118` and Help > Releases contains the release.

### Closeout

- Roadmap slice: `3.4.118 — Plex Now Playing Viewer`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, and `docs/releases/v3.4.118.md`.
- Runtime verification used: rebuilt backend/frontend containers with `APP_VERSION=3.4.118`; verified `/api/health` reports frontend/backend/build `3.4.118`; verified Help > Releases serves `v3.4.118`; verified live DB `feature_flags.events_enabled=true` and `feature_flags.collectibles_enabled=true`; verified authenticated `/api/plex/now-playing-viewer` plus `/api/plex/now-playing-image` against a fake PMS; verified saved real Plex settings reach `/status/sessions` and return sanitized active-session coverage with title, progress, player state, and Plex-relative image keys; verified homelab and platform edition runtime boundaries.
- CI/checks run: `node --check backend/services/plex.js`, `node --check backend/routes/integrations.js`, `node --check backend/scripts/plex-now-playing-viewer-smoke.js`, `npm --prefix backend run test:unit`, `npm --prefix backend run test:openapi`, `npm --prefix frontend run build:vite`, Docker `backend npm run test:unit`, Docker `backend npm run test:openapi`, Docker `backend npm run test:plex-now-playing-viewer-smoke`, Docker `backend npm run test:plex-now-playing-readback-smoke`, Docker `backend npm run test:plex-real-now-playing-runtime-proof`, targeted Playwright `tests/playwright/specs/now-playing-viewer.browser.spec.js`, full `npm run test:browser` (`60 passed`, `4 skipped`), Docker `backend npm run test:init-parity`, Docker `backend npm run test:migration-rehearsal`, Docker `backend npm run test:rbac-regression`, Docker `backend npm run test:platform-edition-boundary`, `npm run validate:public-export`, Docker homelab `backend npm run test:homelab-edition-boundary`, `npm --prefix backend run test:observability-evidence`, production-shaped `npm --prefix backend run test:release-preflight-local`, generated-artifact secret-pattern scan, and `git diff --check`.
- Files changed: `README.md`, `app-meta.json`, `backend/app-meta.json`, `backend/openapi/openapi.yaml`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/routes/integrations.js`, `backend/scripts/plex-now-playing-viewer-smoke.js`, `backend/scripts/unit-tests.js`, `backend/services/plex.js`, `docker-compose.yml`, `docs/releases/v3.4.118.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, `env.example`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/App.jsx`, `frontend/src/app-meta.json`, `frontend/src/components/NowPlayingView.jsx`, `frontend/src/components/app/AppPrimitives.jsx`, `frontend/src/components/app/hooks/useSessionBootstrap.js`, `preflight-go-no-go.md`, and `tests/playwright/specs/now-playing-viewer.browser.spec.js`.
- Risks or follow-ups: v1 is admin-authenticated only, not a shareable display-token route; queue/next-up remains out of scope because the real PMS proof still reports no queue item hint; image proxy intentionally accepts only Plex-relative keys and does not expose raw PMS assets; `secret-scan` and `image-security-and-sbom` remain CI-only locally because `gitleaks` and `trivy` are not installed.
- What remains in the milestone: none for `3.4.118`; future Plex slices can add display-token mode, richer layout options, or queue handling if a PMS response proves those fields.
- Recommended commit message: `Release 3.4.118 with Plex Now Playing viewer and authenticated image proxy`

## 3.4.119 — Plex Now Playing Display Token

**Goal:** Let admins generate a revocable, limited Plex Now Playing display link so a passive display can open `/now-playing` without an admin browser session.

**Current Slice:** `Closed 2026-05-07`

### Scope

- Store only a hashed Plex Now Playing display token on the admin Plex integration row.
- Add admin generate and revoke actions for the display token.
- Add token-only read endpoints for sanitized Now Playing viewer data and proxied Plex-relative images.
- Update `/now-playing?token=...` to use the display-token endpoints without redirecting to login.
- Keep the existing admin-session `/now-playing` behavior intact.
- Keep Plex imports, webhooks, watch-state writes, queue/next-up behavior, and broad import modernization out of scope.

### Acceptance Criteria

- Admins can generate a display link and revoke it from Plex Integrations.
- The raw display token is returned only at generation time; subsequent settings readback exposes only enabled/created/last-used metadata.
- `/now-playing?token=...` renders the viewer without an admin session.
- Display-token viewer and image routes reject missing, invalid, or revoked tokens.
- Display-token routes return only the same sanitized viewer data and app-owned image proxy paths as the authenticated viewer.
- Running-stack verification proves the app serves `3.4.119`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.119 — Plex Now Playing Display Token`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, and `docs/releases/v3.4.119.md`.
- Runtime verification used: rebuilt backend/frontend containers with `APP_VERSION=3.4.119`; verified `/api/health` reports frontend/backend/build `3.4.119`; verified live DB migration `96`; verified Help > Releases serves `v3.4.119`; verified live DB `feature_flags.events_enabled=true` and `feature_flags.collectibles_enabled=true`; verified the Plex Now Playing viewer smoke inside Docker against a fake PMS, including admin-session viewer readback, admin-session image proxy, display-token generation, unauthenticated display-token viewer readback, display-token image proxy, revoke, and post-revoke `401`; verified homelab and platform edition runtime boundaries.
- CI/checks run: `node --check backend/routes/integrations.js`, `node --check backend/scripts/plex-now-playing-viewer-smoke.js`, `npm --prefix backend run test:unit`, `npm --prefix backend run test:openapi`, `npm --prefix frontend run build:vite`, Docker `backend npm run test:unit`, Docker `backend npm run test:openapi`, Docker `backend npm run test:plex-now-playing-viewer-smoke`, targeted Playwright `tests/playwright/specs/now-playing-viewer.browser.spec.js`, full `npm run test:browser` (`61 passed`, `4 skipped`), Docker `backend npm run test:init-parity`, Docker `backend npm run test:migration-rehearsal`, Docker `backend npm run test:rbac-regression`, Docker `backend npm run test:platform-edition-boundary`, `npm run validate:public-export`, Docker homelab `backend npm run test:homelab-edition-boundary`, `npm --prefix backend run test:observability-evidence`, production-shaped `npm --prefix backend run test:release-preflight-local`, generated-artifact secret-pattern scan, and `git diff --check`.
- Files changed: `README.md`, `app-meta.json`, `backend/app-meta.json`, `backend/db/migrations.js`, `backend/openapi/openapi.yaml`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/routes/integrations.js`, `backend/scripts/plex-now-playing-viewer-smoke.js`, `backend/scripts/unit-tests.js`, `backend/services/integrations.js`, `docker-compose.yml`, `docs/releases/v3.4.119.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, `env.example`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/App.jsx`, `frontend/src/app-meta.json`, `frontend/src/components/AdminIntegrationsView.jsx`, `frontend/src/components/NowPlayingView.jsx`, `frontend/src/components/app/hooks/useSessionBootstrap.js`, `init.sql`, `preflight-go-no-go.md`, and `tests/playwright/specs/now-playing-viewer.browser.spec.js`.
- Risks or follow-ups: display links are bearer-style URLs and should be treated as secrets; token expiration and multiple named display devices remain future work; queue/next-up remains out of scope because PMS proof still has no usable queue hint; `secret-scan` and `image-security-and-sbom` remain CI-only locally because `gitleaks` and `trivy` are not installed.
- What remains in the milestone: none for `3.4.119`; future Plex slices can add named display devices, token expiration, richer viewer layout controls, webhooks, scheduled sync cadence, or watch-state sync as separate milestones.
- Recommended commit message: `Release 3.4.119 with Plex Now Playing display token links`

## 3.4.120 — Plex Now Playing Display Preferences

**Goal:** Let admins control the passive Plex Now Playing display surface without changing Plex imports, webhooks, scheduled sync, or watch-state behavior.

**Current Slice:** `Closed 2026-05-07`

### Scope

- Add saved Plex Now Playing display preferences on the app integration row.
- Let admins toggle poster, backdrop, context, player, progress, refresh time, paused sessions, and display text scale.
- Return normalized display preferences from both the authenticated admin viewer endpoint and the limited display-token endpoint.
- Apply the preferences in `/now-playing` for both admin-session and display-token modes.
- Keep the existing display token, image proxy, Plex imports, PMS parser behavior, webhooks, scheduled sync cadence, and watch-state work unchanged.

### Acceptance Criteria

- Plex Integrations can save display preferences without exposing Plex credentials or display tokens.
- `/api/plex/now-playing-viewer` and `/api/plex/now-playing-display` return normalized `displayPreferences`.
- `/now-playing` hides or shows the selected display elements and respects compact/standard/large text scale.
- Paused sessions can be excluded from the viewer payload before the frontend chooses the first session.
- Docker runtime smoke proves preference save and token viewer readback against a fake PMS.
- Running-stack verification proves the app serves `3.4.120`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.120 — Plex Now Playing Display Preferences`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, and `docs/releases/v3.4.120.md`.
- Runtime verification used: rebuilt local backend/frontend images tagged `3.4.120`; verified `/api/health` reports frontend/backend/build `3.4.120`; verified live DB migration `97`; verified live DB `feature_flags.events_enabled=true` and `feature_flags.collectibles_enabled=true`; verified Help > Releases serves `v3.4.120`; verified Docker Plex Now Playing viewer smoke against a fake PMS, including display preference save/readback through the display-token endpoint; verified Plex readback and real now-playing runtime proof still return sanitized data; restored the running stack to `ghcr.io/hkrewson/collectz-backend:3.4.120` and `ghcr.io/hkrewson/collectz-frontend:3.4.120`.
- CI/checks run: `node --check backend/routes/integrations.js`, `node --check backend/scripts/plex-now-playing-viewer-smoke.js`, Docker Node 20 `npm run test:unit` (`262` passed), Docker `backend npm run test:openapi`, Docker `backend npm run test:plex-now-playing-viewer-smoke`, Docker `backend npm run test:plex-now-playing-readback-smoke`, Docker `backend npm run test:plex-real-now-playing-runtime-proof`, targeted Playwright Now Playing spec in the official Playwright container (`3` passed), full Playwright browser regression in the official Playwright container (`61` passed, `4` skipped), Docker `backend npm run test:init-parity`, Docker `backend npm run test:migration-rehearsal`, platform-mode Docker `backend npm run test:rbac-regression`, platform-mode Docker `backend npm run test:platform-edition-boundary`, Docker `backend npm run test:homelab-edition-boundary`, `npm run validate:public-export`, `npm --prefix backend run test:observability-evidence`, `npm --prefix backend run test:release-preflight-local`, generated-artifact secret-pattern scan, and `git diff --check`.
- Files changed: `README.md`, `app-meta.json`, `backend/app-meta.json`, `backend/db/migrations.js`, `backend/openapi/openapi.yaml`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/routes/integrations.js`, `backend/scripts/plex-now-playing-viewer-smoke.js`, `backend/scripts/unit-tests.js`, `backend/services/integrations.js`, `docker-compose.yml`, `docs/releases/v3.4.120.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, `env.example`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/app-meta.json`, `frontend/src/components/AdminIntegrationsView.jsx`, `frontend/src/components/NowPlayingView.jsx`, `init.sql`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: preferences are global to the single saved display token rather than per named display device; token expiration and multiple named display devices remain future work; queue/next-up remains out of scope because PMS proof still has no usable queue hint; local `compose-smoke` secure-cookie parity, `secret-scan`, and `image-security-and-sbom` remain CI-only or blocked locally as documented in `preflight-go-no-go.md`.
- What remains in the milestone: none for `3.4.120`; future Plex slices can add named display devices, token expiration, webhooks, scheduled sync cadence, or watch-state sync as separate milestones.
- Recommended commit message: `Release 3.4.120 with Plex Now Playing display preferences`

## 3.4.121 — Plex Now Playing Vertical Poster Display

**Goal:** Add a saved vertical poster-only layout option for passive Plex Now Playing displays without changing Plex imports, display-token ownership, webhooks, scheduled sync, or watch-state behavior.

**Current Slice:** `Closed 2026-05-07`

### Scope

- Add a saved display layout mode to the existing Plex Now Playing display preferences.
- Let admins choose `Standard` or `Vertical poster only` in Plex Integrations.
- Render `/now-playing` in poster-only mode as a full-height vertical poster surface for both admin-session and display-token modes.
- Keep the existing field visibility toggles, text scale, display-token behavior, and image proxy behavior intact.

### Acceptance Criteria

- The admin settings payload persists and reads back `layoutMode`.
- `/api/plex/now-playing-viewer` and `/api/plex/now-playing-display` return normalized `layoutMode`.
- `/now-playing` respects `layoutMode: poster_only` and hides standard text/header/progress chrome.
- Docker runtime smoke proves poster-only preference save and display-token readback against a fake PMS.
- Running-stack verification proves the app serves `3.4.121`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.121 — Plex Now Playing Vertical Poster Display`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, and `docs/releases/v3.4.121.md`.
- Runtime verification used: rebuilt local platform backend/frontend images with `APP_VERSION=3.4.121`; verified backend container `APP_EDITION=platform` and `APP_VERSION=3.4.121`; verified `/api/health` reports frontend/backend/build `3.4.121`; verified `/api/auth/config` reports `product_edition=platform`; verified live DB `feature_flags.events_enabled=true` and `feature_flags.collectibles_enabled=true`; verified served frontend assets contain `poster_only`, `posterOnlyMode`, `displayPreferences`, and `VITE_APP_VERSION=3.4.121`; verified Help > Releases serves `v3.4.121`; verified Plex Now Playing viewer smoke inside Docker against a fake PMS, including poster-only preference save/readback through the display-token endpoint.
- CI/checks run: `node --check backend/routes/integrations.js`, `node --check backend/scripts/plex-now-playing-viewer-smoke.js`, `node --check tests/playwright/specs/now-playing-viewer.browser.spec.js`, Docker `backend npm run test:unit` (`262` passed), Docker `backend npm run test:openapi`, Docker `backend npm run test:integration-smoke`, Docker `backend npm run test:plex-now-playing-viewer-smoke`, Docker `backend npm run test:help-releases-smoke`, targeted Playwright Now Playing spec in the official Playwright container (`4` passed), full Playwright browser regression in the official Playwright container (`62` passed, `4` skipped), Docker `backend npm run test:init-parity`, Docker `backend npm run test:migration-rehearsal`, platform-mode Docker `backend npm run test:rbac-regression`, platform-mode Docker `backend npm run test:platform-edition-boundary`, `npm run validate:public-export`, `npm --prefix backend run test:observability-evidence`, `npm --prefix backend run test:release-preflight-local`, generated-artifact secret-pattern scan, and `git diff --check`.
- Files changed: `README.md`, `app-meta.json`, `backend/app-meta.json`, `backend/openapi/openapi.yaml`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/routes/integrations.js`, `backend/scripts/plex-now-playing-viewer-smoke.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.121.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, `env.example`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/app-meta.json`, `frontend/src/components/AdminIntegrationsView.jsx`, `frontend/src/components/NowPlayingView.jsx`, `artifacts/observability-evidence/observability-release-evidence.json`, `preflight-go-no-go.md`, and `tests/playwright/specs/now-playing-viewer.browser.spec.js`.
- Risks or follow-ups: poster-only mode currently uses the first active Plex session and the existing single display-token preferences; named display devices, per-display layouts, token expiration, queue/next-up, webhooks, scheduled sync cadence, and watch-state sync remain future Plex work; local `compose-smoke` secure-cookie parity, `secret-scan`, and `image-security-and-sbom` remain CI-only or blocked locally as documented in `preflight-go-no-go.md`; homelab edition boundary was not rerun locally for this slice because the live stack was preserved in platform mode.
- What remains in the milestone: none for `3.4.121`; future Plex slices can add named display devices, token expiration, webhooks, scheduled sync cadence, or watch-state sync as separate milestones.
- Recommended commit message: `Release 3.4.121 with Plex Now Playing vertical poster display`

## 3.4.122 — Plex Webhook and Ratings Sync Contract

**Goal:** Define and prove the safe Plex webhook and rating-sync contract before enabling automatic inbound webhook processing or collectZ-to-Plex writes.

**Current Slice:** `Closed 2026-05-07`

### Scope

- Normalize Plex webhook event hints for `library.new`, `media.scrobble`, and `media.rate`.
- Treat playback webhooks (`media.play`, `media.pause`, `media.resume`, `media.stop`, `playback.started`) as observed-only events for later activity/progress slices.
- Define PMS metadata readback by `ratingKey` as the required next step before collectZ mutates local titles.
- Define collectZ-to-Plex rating writeback using Plex `PUT /:/rate`.
- Keep real webhook receiver URLs, webhook secret/token management, automatic import updates, scheduled polling cadence, watched-state writeback, and actual rating writeback apply UI out of scope.

### Acceptance Criteria

- The Plex service exposes a versioned contract for supported inbound webhook hints and rating writeback shape.
- Normalized webhook readback preserves useful fields such as event, action, rating key, title, type, library section, watched/rating intent, and metadata readback path.
- Normalized webhook readback does not expose Plex tokens, provider URLs, raw file paths, server UUIDs, IP addresses, or raw payloads.
- Rating writeback contract builds a `PUT /:/rate` request with `identifier`, `key`, `rating`, and optional `ratedAt`.
- A Docker-runnable fake webhook smoke proves `library.new`, `media.scrobble`, `media.rate`, playback observation, and rating writeback request shape.
- Running-stack verification proves the app serves `3.4.122`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.122 — Plex Webhook and Ratings Sync Contract`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, and `docs/releases/v3.4.122.md`.
- Runtime verification used: rebuilt local platform backend/frontend images with `APP_VERSION=3.4.122`; verified backend container `APP_EDITION=platform` and `APP_VERSION=3.4.122`; verified `/api/health` reports frontend/backend/build `3.4.122`; verified live DB `feature_flags.events_enabled=true` and `feature_flags.collectibles_enabled=true`; verified Help > Releases serves `v3.4.122`; verified Docker Plex webhook/rating contract smoke writes secret-free evidence for `library.new`, `media.scrobble`, `media.rate`, playback observation, and `PUT /:/rate` writeback request shape.
- CI/checks run: `node --check backend/services/plex.js`, `node --check backend/scripts/plex-webhook-ratings-contract-smoke.js`, `node --check backend/scripts/unit-tests.js`, Docker Node 20 `backend npm run test:unit` (`264` passed), Docker `backend npm run test:openapi`, Docker `backend npm run test:integration-smoke`, Docker `backend npm run test:plex-webhook-ratings-contract-smoke`, Docker `backend npm run test:help-releases-smoke`, full Playwright browser regression in the official Playwright container (`62` passed, `4` skipped), Docker `backend npm run test:init-parity`, Docker `backend npm run test:migration-rehearsal`, platform-mode Docker `backend npm run test:rbac-regression`, platform-mode Docker `backend npm run test:platform-edition-boundary`, `npm run validate:public-export`, `npm --prefix backend run test:observability-evidence`, `npm --prefix backend run test:release-preflight-local`, generated-artifact secret-pattern scan, and `git diff --check`.
- Files changed: `README.md`, `app-meta.json`, `backend/app-meta.json`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/scripts/plex-webhook-ratings-contract-smoke.js`, `backend/scripts/unit-tests.js`, `backend/services/plex.js`, `docker-compose.yml`, `docs/releases/v3.4.122.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, `env.example`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/app-meta.json`, `artifacts/plex-webhooks/plex-webhook-ratings-contract-smoke.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: this is contract/proof only; actual webhook receiver URLs, webhook secret/token management, event persistence, import enqueueing, rating writeback apply UI, watched-state writeback, scheduled polling cadence, and broad Plex import modernization remain separate future slices; local `compose-smoke` secure-cookie parity, `secret-scan`, and `image-security-and-sbom` remain CI-only or blocked locally as documented in `preflight-go-no-go.md`; homelab edition boundary was not rerun locally for this slice because the live stack was preserved in platform mode.
- What remains in the milestone: none for `3.4.122`; next Plex slices can implement webhook receiver administration, ratings read/write runtime proof, watch-state cadence, or webhook-triggered import/update processing.
- Recommended commit message: `Release 3.4.122 with Plex webhook and ratings sync contract`

## 3.4.123 — Plex Webhook Receiver Administration Contract

**Goal:** Add the admin contract for generating, rotating, revoking, and proving a Plex webhook receiver URL without enabling automatic import or watched/rating mutation behavior yet.

### Scope

- Add a token-scoped Plex webhook receiver endpoint for supported Plex webhook hint events.
- Add admin integration controls and API routes for generating, rotating, and revoking receiver URLs.
- Store receiver tokens only as hashes and return raw receiver URLs only at generation time.
- Keep receiver processing contract-only: accept/normalize/read back events, but do not enqueue imports, update watched state, or write ratings.
- Redact receiver tokens from request/error logs.

### Acceptance Criteria

- Admins can generate/regenerate and revoke a Plex webhook receiver URL from integration settings.
- Invalid receiver tokens are rejected and revoked tokens stop working.
- Valid receiver webhook posts accept supported fake Plex events and report `processingMode=contract_only`.
- Receiver status readback shows enabled state, last received timestamp, and last event without exposing the raw token.
- Logs and smoke artifacts do not expose generated receiver tokens.
- Running-stack verification proves the app serves `3.4.123`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.123 — Plex Webhook Receiver Administration Contract`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, and `docs/releases/v3.4.123.md`.
- Runtime verification used: rebuilt the local platform backend/frontend stack with `APP_VERSION=3.4.123`; verified backend container `APP_EDITION=platform` and `APP_VERSION=3.4.123`; verified `/api/health` reports frontend/backend/build `3.4.123`; verified `/api/auth/config` reports `product_edition=platform`; verified live DB `feature_flags.events_enabled=true` and `feature_flags.collectibles_enabled=true`; verified Help > Releases serves `v3.4.123`; verified Docker Plex webhook receiver admin smoke rejects invalid tokens, accepts a valid `library.new` webhook in `contract_only` mode, persists redacted evidence, and rejects the same token after revoke.
- CI/checks run: `node --check backend/routes/integrations.js`, `node --check backend/middleware/errors.js`, `node --check backend/db/migrations.js`, `node --check backend/scripts/plex-webhook-receiver-admin-smoke.js`, `node --check backend/scripts/unit-tests.js`, Docker Node 20 `backend npm run test:unit` (`265` passed), Docker `backend npm run test:openapi`, Docker `backend npm run test:integration-smoke`, Docker `backend npm run test:plex-webhook-receiver-admin-smoke`, Docker `backend npm run test:help-releases-smoke`, full Playwright browser regression in the official Playwright container (`62` passed, `4` skipped), Docker `backend npm run test:init-parity`, Docker `backend npm run test:migration-rehearsal`, platform-mode Docker `backend npm run test:rbac-regression`, platform-mode Docker `backend npm run test:platform-edition-boundary`, `npm run validate:public-export`, `npm --prefix backend run test:observability-evidence`, `npm --prefix backend run test:release-preflight-local`, generated-artifact secret-pattern scan, and `git diff --check`.
- Files changed: `README.md`, `app-meta.json`, `backend/app-meta.json`, `backend/db/migrations.js`, `backend/middleware/errors.js`, `backend/openapi/openapi.yaml`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/routes/integrations.js`, `backend/scripts/plex-webhook-receiver-admin-smoke.js`, `backend/scripts/unit-tests.js`, `backend/services/integrations.js`, `docker-compose.yml`, `docs/releases/v3.4.123.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, `env.example`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/app-meta.json`, `frontend/src/components/AdminIntegrationsView.jsx`, `init.sql`, `artifacts/plex-webhooks/plex-webhook-receiver-admin-smoke.json`, `artifacts/observability-evidence/observability-release-evidence.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: this is receiver administration plus contract-only acceptance; webhook-triggered import enqueueing, watched-state writeback, rating writeback apply behavior, scheduled sync cadence, and broad Plex import rewrites remain separate future slices; local `compose-smoke` secure-cookie parity, `secret-scan`, and `image-security-and-sbom` remain CI-only or blocked locally as documented in `preflight-go-no-go.md`; homelab edition boundary was not rerun locally for this slice because the live stack was intentionally preserved in platform mode, while source assertions and full browser coverage still exercised homelab boundary contracts where available.
- What remains in the milestone: none for `3.4.123`; next Plex slices can implement webhook processing/import enqueue, watched-state sync/writeback, ratings writeback apply, scheduled sync cadence, or deeper provider-oriented import modernization.
- Recommended commit message: `Release 3.4.123 with Plex webhook receiver administration contract`

## 3.4.124 — Plex Webhook Receiver Processing and Import Enqueue Contract

**Goal:** Let valid Plex `library.new` webhooks create a durable import hint job without silently running a full Plex import or mutating watched/rating state.

### Scope

- On valid `library.new` webhook events with a `ratingKey`, create a queued `plex_webhook_import_hint` sync job.
- Include sanitized job scope for the webhook event, `ratingKey`, metadata readback path, title/type hints, and future single-rating-key import processing.
- Reuse an existing queued/running import hint job for duplicate `library.new` events with the same `ratingKey`.
- Keep `media.scrobble`, `media.rate`, and playback observation events read-only.
- Keep full Plex import execution, watched-state writeback, rating writeback apply, and scheduled sync cadence out of scope.

### Acceptance Criteria

- Valid `library.new` webhook posts return `processingMode=import_enqueue_hint`.
- The response includes a redacted import enqueue readback with queued job id, status, provider, job type, and `ratingKey`.
- Duplicate `library.new` webhook posts for the same queued/running `ratingKey` reuse the existing job instead of creating a second row.
- `media.scrobble` and `media.rate` webhook posts do not enqueue import jobs.
- Smoke evidence proves queueing, duplicate reuse, read-only watched-state behavior, revoke behavior, and no receiver token or Plex secret leakage.
- Running-stack verification proves the app serves `3.4.124`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.124 — Plex Webhook Receiver Processing and Import Enqueue Contract`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, and `docs/releases/v3.4.124.md`.
- Runtime verification used: rebuilt the local platform backend/frontend stack with `APP_VERSION=3.4.124`; verified backend container `APP_EDITION=platform` and `APP_VERSION=3.4.124`; verified `/api/health` reports frontend/backend/build `3.4.124`; verified `/api/auth/config` reports `product_edition=platform`; verified live DB `feature_flags.events_enabled=true` and `feature_flags.collectibles_enabled=true`; verified Help > Releases serves `v3.4.124`; verified Docker Plex webhook receiver admin smoke creates a queued `plex_webhook_import_hint` job for `library.new`, reuses that job for a duplicate `ratingKey`, keeps `media.scrobble` read-only, writes redacted evidence, and rejects the same token after revoke.
- CI/checks run: `node --check backend/routes/integrations.js`, `node --check backend/scripts/plex-webhook-receiver-admin-smoke.js`, `node --check backend/scripts/unit-tests.js`, Docker Node 20 `backend npm run test:unit` (`265` passed), Docker `backend npm run test:openapi`, Docker `backend npm run test:integration-smoke`, Docker `backend npm run test:plex-webhook-receiver-admin-smoke`, Docker `backend npm run test:help-releases-smoke`, full Playwright browser regression in the official Playwright container (`62` passed, `4` skipped), Docker `backend npm run test:init-parity`, Docker `backend npm run test:migration-rehearsal`, platform-mode Docker `backend npm run test:rbac-regression`, platform-mode Docker `backend npm run test:platform-edition-boundary`, `npm run validate:public-export`, `npm --prefix backend run test:observability-evidence`, `npm --prefix backend run test:release-preflight-local`, generated-artifact secret-pattern scan, and `git diff --check`.
- Files changed: `README.md`, `app-meta.json`, `backend/app-meta.json`, `backend/openapi/openapi.yaml`, `backend/package.json`, `backend/package-lock.json`, `backend/release-feed.json`, `backend/routes/integrations.js`, `backend/scripts/plex-webhook-receiver-admin-smoke.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.124.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, `env.example`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/app-meta.json`, `artifacts/init-parity-evidence/init-parity-evidence.json`, `artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json`, `artifacts/observability-evidence/observability-release-evidence.json`, `artifacts/plex-webhooks/plex-webhook-receiver-admin-smoke.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: this slice queues import hints only; actual single-rating-key Plex metadata fetch/import processing, watched-state writeback, rating writeback apply behavior, scheduled sync cadence, and broad Plex import modernization remain separate future slices; local `compose-smoke` secure-cookie parity, `secret-scan`, and `image-security-and-sbom` remain CI-only or blocked locally as documented in `preflight-go-no-go.md`; homelab edition boundary was not rerun locally for this slice because the live stack was intentionally preserved in platform mode, while source assertions and full browser coverage still exercised homelab boundary contracts where available.
- What remains in the milestone: none for `3.4.124`; next Plex slices can implement single-rating-key processing for queued webhook import hints, watched-state sync/writeback, ratings writeback apply, scheduled sync cadence, or deeper provider-oriented import modernization.
- Recommended commit message: `Release 3.4.124 with Plex webhook import hint enqueue contract`

## 3.4.125 — Plex Single-Rating-Key Import Processing from Webhook Hints

**Goal:** Process queued Plex `library.new` webhook import hints by fetching exactly one PMS metadata item and reusing the existing Plex import behavior for that title.

### Scope

- Add admin-only processing for one queued `plex_webhook_import_hint` job.
- Fetch Plex metadata from `/library/metadata/:ratingKey` using saved Plex settings.
- Reuse the current Plex import path for the fetched item so duplicate protection, Plex metadata aliases, scoped library ownership, and media updates stay consistent.
- Preserve the `3.4.124` receiver enqueue behavior and duplicate queued-job guard.
- Keep watched-state writeback, rating writeback apply behavior, scheduled sync cadence, and broad Plex import rewrites out of scope.

### Acceptance Criteria

- A queued `plex_webhook_import_hint` job can be claimed and processed through `single_rating_key_import`.
- Processing fetches only the hinted `ratingKey` metadata item from PMS.
- The processed item creates or updates a scoped media row through the existing Plex import machinery.
- Job readback clearly reports imported, created, updated, skipped, and error counts.
- Smoke evidence proves queueing, duplicate reuse, metadata readback, media-row persistence, revoke behavior, and no receiver token or Plex secret leakage.
- Running-stack verification proves the app serves `3.4.125`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.125 — Plex Single-Rating-Key Import Processing from Webhook Hints`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, and `docs/releases/v3.4.125.md`.
- Runtime verification used: rebuilt the local platform backend/frontend stack with `APP_VERSION=3.4.125`; verified backend container `APP_EDITION=platform` and `APP_VERSION=3.4.125`; verified `/api/health` reports frontend/backend/build `3.4.125`; verified `/api/auth/config` reports `product_edition=platform`; verified live DB `feature_flags.events_enabled=true` and `feature_flags.collectibles_enabled=true`; verified Help > Releases serves `v3.4.125`; verified Docker Plex webhook import-hint processing smoke queues a `plex_webhook_import_hint`, reuses the duplicate queued job, fetches fake PMS `/library/metadata/:ratingKey`, imports/updates one media row through the Plex path, keeps watched-state read-only, writes redacted evidence, and rejects the token after revoke; verified homelab edition boundary in an isolated temporary compose project without changing the active platform stack.
- CI/checks run: `node --check backend/services/plex.js`, `node --check backend/routes/media.js`, `node --check backend/scripts/plex-webhook-receiver-admin-smoke.js`, `node --check backend/scripts/unit-tests.js`, Docker Node 20 `backend npm run test:unit` (`265` passed), Docker `backend npm run test:openapi`, Docker `backend npm run test:integration-smoke`, Docker `backend npm run test:plex-webhook-import-hint-processing-smoke`, Docker `backend npm run test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.125`, Docker `backend npm run test:init-parity`, Docker `backend npm run test:migration-rehearsal`, platform-mode Docker `backend npm run test:rbac-regression`, platform-mode Docker `backend npm run test:platform-edition-boundary`, isolated homelab Docker `backend npm run test:homelab-edition-boundary`, host Playwright browser regression with bundled Node (`62` passed, `4` skipped), `npm run validate:public-export`, `npm --prefix backend run test:observability-evidence`, `npm --prefix backend run test:release-preflight-local`, generated-artifact secret-pattern scan, and `git diff --check`.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `backend/openapi/openapi.yaml`, `backend/package.json`, `backend/release-feed.json`, `backend/routes/media.js`, `backend/scripts/plex-webhook-receiver-admin-smoke.js`, `backend/scripts/unit-tests.js`, `backend/services/plex.js`, `docker-compose.yml`, `docs/releases/v3.4.125.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, `frontend/package.json`, `frontend/src/app-meta.json`, `artifacts/observability-evidence/observability-release-evidence.json`, `artifacts/plex-webhooks/plex-webhook-receiver-admin-smoke.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: processing is admin-triggered for one queued hint at a time; automatic scheduling, watched-state sync/writeback, rating writeback apply behavior, and broad provider-oriented import rewrites remain future slices; app-level webhook hints use saved global Plex settings when the active workspace does not have its own Plex settings; local `compose-smoke` secure-cookie parity, CI `secret-scan`, and `image-security-and-sbom` remain CI-only or blocked locally as documented in `preflight-go-no-go.md`.
- What remains in the milestone: none for `3.4.125`; next Plex slices can add scheduled processing cadence, watched-state sync/writeback, rating writeback apply behavior, or deeper provider-oriented import modernization.
- Recommended commit message: `Release 3.4.125 with Plex single-rating-key webhook import processing`

## 3.4.126 — Plex Webhook Import Hint Auto-Processor

**Goal:** Let collectZ automatically process queued Plex `library.new` webhook import hints using the single-rating-key import path from `3.4.125`.

### Scope

- Add a lightweight backend cadence for queued `plex_webhook_import_hint` jobs.
- Process a small batch per sweep and avoid overlapping auto-runs.
- Preserve queued Plex webhook hints across backend restarts.
- Add admin readback for runtime settings and last-run status.
- Reuse the existing single-rating-key processor, duplicate protection, scoped media ownership, and redacted evidence.
- Keep watched-state sync/writeback, rating writeback apply behavior, scheduled full-library reconciliation, and broad Plex import rewrites out of scope.

### Acceptance Criteria

- A queued Plex webhook import hint is automatically processed without an admin clicking the manual processor endpoint.
- The auto-processor reports enabled state, interval, batch size, and last-run counters.
- Backend restart cleanup does not fail queued Plex import hints before the processor can run.
- Smoke evidence proves webhook enqueue, duplicate reuse, auto-processing, PMS metadata readback, media-row persistence, revoke behavior, and no receiver token or Plex secret leakage.
- Running-stack verification proves the app serves `3.4.126`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.126 — Plex Webhook Import Hint Auto-Processor`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, and `docs/releases/v3.4.126.md`.
- Runtime verification used: rebuilt the local platform backend/frontend stack with `APP_VERSION=3.4.126` and `PLEX_WEBHOOK_IMPORT_AUTO_PROCESSOR_INTERVAL_SECONDS=5`; verified backend container `APP_EDITION=platform`, `APP_VERSION=3.4.126`, `PLEX_WEBHOOK_IMPORT_AUTO_PROCESSOR_ENABLED=true`, and interval `5`; verified `/api/health` reports frontend/backend/build `3.4.126`; verified `/api/auth/config` reports `product_edition=platform`; verified live DB `feature_flags.events_enabled=true` and `feature_flags.collectibles_enabled=true` after active-stack and temporary homelab checks; verified Help > Releases serves `v3.4.126`; verified Docker Plex webhook receiver admin smoke queues a `plex_webhook_import_hint`, reuses the duplicate queued job, keeps watched-state read-only, auto-processes the hint without the manual endpoint, reads back fake PMS metadata, imports one media row, writes redacted evidence, and rejects the previous receiver token after revoke; verified homelab edition boundary in an isolated temporary compose project without changing the active platform stack.
- CI/checks run: `node --check backend/routes/media.js`, `node --check backend/server.js`, `node --check backend/scripts/plex-webhook-receiver-admin-smoke.js`, `node --check backend/scripts/unit-tests.js`, local Node 20 `npm --prefix backend run test:unit` (`265` passed), local `npm --prefix backend run test:openapi`, Docker `backend npm run test:unit` (`265` passed), Docker `backend npm run test:openapi`, Docker `backend npm run test:integration-smoke`, Docker `backend npm run test:plex-webhook-import-auto-processor-smoke`, Docker `backend npm run test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.126`, Docker `backend npm run test:init-parity`, Docker `backend npm run test:migration-rehearsal`, platform-mode Docker `backend npm run test:rbac-regression`, platform-mode Docker `backend npm run test:platform-edition-boundary`, isolated homelab Docker `backend npm run test:homelab-edition-boundary`, targeted Playwright rerun for the initially timed-out homelab/now-playing browser specs, full host Playwright browser regression with bundled Node (`62` passed, `4` skipped), `npm run validate:public-export`, `npm --prefix backend run test:observability-evidence`, `npm --prefix backend run test:release-preflight-local`, generated-artifact secret-pattern scan, and `git diff --check`.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `backend/openapi/openapi.yaml`, `backend/package.json`, `backend/release-feed.json`, `backend/routes/media.js`, `backend/scripts/plex-webhook-receiver-admin-smoke.js`, `backend/scripts/unit-tests.js`, `backend/server.js`, `docker-compose.yml`, `docs/releases/v3.4.126.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, `env.example`, `frontend/package.json`, `frontend/src/app-meta.json`, `scripts/generate-public-compose.js`, `artifacts/observability-evidence/observability-release-evidence.json`, `artifacts/plex-webhooks/plex-webhook-receiver-admin-smoke.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: app-level Plex webhook hints fall back to global/admin Plex settings when no creator or scoped owner is available; the auto-processor is intentionally lightweight and still does not implement watched-state sync/writeback, rating writeback apply behavior, scheduled full-library reconciliation, or broad Plex import rewrites; local `compose-smoke` secure-cookie parity, CI `secret-scan`, and `image-security-and-sbom` remain CI-only or blocked locally as documented in `preflight-go-no-go.md`.
- What remains in the milestone: none for `3.4.126`; future Plex slices can implement watched-state processing, rating read/write flows, scheduled reconciliation, and deeper workspace-owned provider administration.
- Recommended commit message: `Release 3.4.126 with Plex webhook import hint auto-processing`

## 3.4.127 — Plex Webhook Existing Receiver Readback

**Goal:** Make existing Plex webhook receivers visible in Integrations after refresh without exposing raw receiver tokens.

### Scope

- Show existing Plex webhook receiver state with masked URL readback.
- Add a stable token fingerprint so admins can identify the saved receiver.
- Keep full receiver tokens one-time only and hash-only at rest.
- Preserve generate, regenerate, revoke, webhook enqueue, and auto-processing behavior.
- Keep watched-state writeback, rating writeback apply behavior, scheduled full-library reconciliation, and broad Plex import rewrites out of scope.

### Acceptance Criteria

- Integrations > Plex shows that an existing receiver is active after refresh.
- Existing receiver readback includes masked URL, token fingerprint, last event, last received time, and rotation time.
- The raw receiver token remains visible only immediately after generation.
- Smoke/source evidence proves existing receiver readback stays token-safe.
- Running-stack verification proves the app serves `3.4.127`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.127 — Plex Webhook Existing Receiver Readback`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, and `docs/releases/v3.4.127.md`.
- Runtime verification used: rebuilt the local platform backend/frontend stack with `APP_VERSION=3.4.127` and `PLEX_WEBHOOK_IMPORT_AUTO_PROCESSOR_INTERVAL_SECONDS=5`; verified backend container `APP_EDITION=platform`, `APP_VERSION=3.4.127`, and `PLEX_WEBHOOK_IMPORT_AUTO_PROCESSOR_ENABLED=true`; verified `/api/health` reports frontend/backend/build `3.4.127`; verified `/api/auth/config` reports `product_edition=platform`; verified live DB `feature_flags.events_enabled=true` and `feature_flags.collectibles_enabled=true` after active-stack and temporary homelab checks; verified Help > Releases serves `v3.4.127`; verified Docker Plex webhook smoke returns `receiverPathMasked` and token fingerprint readback for an existing receiver, rejects invalid tokens, queues and auto-processes a `library.new` import hint, keeps watched-state read-only, writes redacted evidence, and rejects the previous receiver token after revoke; verified homelab edition boundary in an isolated temporary compose project without changing the active platform stack.
- CI/checks run: `node --check backend/routes/integrations.js`, `node --check backend/scripts/plex-webhook-receiver-admin-smoke.js`, `node --check backend/scripts/unit-tests.js`, local Node 20 `npm --prefix backend run test:unit` (`265` passed), local `npm --prefix backend run test:openapi`, Docker `backend npm run test:unit` (`265` passed), Docker `backend npm run test:openapi`, Docker `backend npm run test:integration-smoke`, Docker `backend npm run test:plex-webhook-import-auto-processor-smoke` with `BASE_URL=http://frontend:3000`, Docker `backend npm run test:help-releases-smoke` with `EXPECTED_RELEASE_VERSION=v3.4.127`, Docker `backend npm run test:init-parity`, Docker `backend npm run test:migration-rehearsal`, platform-mode Docker `backend npm run test:rbac-regression`, platform-mode Docker `backend npm run test:platform-edition-boundary`, isolated homelab Docker `backend npm run test:homelab-edition-boundary`, full host Playwright browser regression with bundled Node (`62` passed, `4` skipped), `npm run validate:public-export`, `npm --prefix backend run test:observability-evidence`, `npm --prefix backend run test:release-preflight-local`, generated-artifact secret-pattern scan, and `git diff --check`.
- Files changed: `app-meta.json`, `backend/app-meta.json`, `backend/package.json`, `backend/release-feed.json`, `backend/routes/integrations.js`, `backend/scripts/plex-webhook-receiver-admin-smoke.js`, `backend/scripts/unit-tests.js`, `docker-compose.yml`, `docs/releases/v3.4.127.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, `frontend/package.json`, `frontend/src/app-meta.json`, `frontend/src/components/AdminIntegrationsView.jsx`, `artifacts/observability-evidence/observability-release-evidence.json`, `artifacts/plex-webhooks/plex-webhook-receiver-admin-smoke.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: existing receiver readback intentionally cannot reconstruct the real token because tokens remain hash-only at rest; admins must regenerate when Plex needs the full receiver URL again; watched-state sync/writeback, rating writeback apply behavior, scheduled full-library reconciliation, and broad Plex import rewrites remain future slices; local `compose-smoke` secure-cookie parity, CI `secret-scan`, and `image-security-and-sbom` remain CI-only or blocked locally as documented in `preflight-go-no-go.md`.
- What remains in the milestone: none for `3.4.127`; future Plex slices can implement watched-state processing, rating read/write flows, scheduled reconciliation, and deeper workspace-owned provider administration.
- Recommended commit message: `Release 3.4.127 with Plex webhook existing receiver readback`

## 3.4.128 — Plex Watch-State Sync Cadence Contract

**Goal:** Define and prove the read-only Plex watched-state readback surface before adding any scheduled mutation or Plex scrobble writeback behavior.

### Scope

- Add a read-only watch-state sync contract for Plex `viewCount`, `viewedAt`/`lastViewedAt`, `viewOffset`, and `duration` fields.
- Normalize watched-state readbacks into `completed`, `in_progress`, and `unwatched` states for future scheduler/apply work.
- Add fake-PMS smoke evidence for `/library/metadata/:ratingKey` and `/library/metadata/:ratingKey/allLeaves` watched-state reads.
- Preserve `media.scrobble` webhook behavior as a refresh hint only.
- Keep collectZ watched-state mutation, Plex scrobble/unscrobble writeback, rating writeback apply behavior, scheduled full-library reconciliation, and broad Plex import rewrites out of scope.

### Acceptance Criteria

- Contract exposes default/minimum cadence expectations and the supported read paths.
- Smoke evidence proves completed, in-progress, and unwatched Plex states without calling Plex writeback paths.
- Watch-state evidence redacts Plex tokens, provider URLs, private IPs, and media file paths.
- Source assertions keep the read-only contract, parser, fake-PMS smoke, and roadmap promotion wired.
- Running-stack verification proves the app serves `3.4.128`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.128 — Plex Watch-State Sync Cadence Contract`.
- Project docs/checklists used: `AGENTS.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/10-CI-CD-and-Registry-Deploy.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, and `docs/releases/v3.4.128.md`.
- Runtime verification used: rebuilt the local platform backend/frontend stack with `APP_VERSION=3.4.128` and `PLEX_WEBHOOK_IMPORT_AUTO_PROCESSOR_INTERVAL_SECONDS=5`; verified backend container `APP_EDITION=platform` and `APP_VERSION=3.4.128`; verified `/api/health` reports frontend/backend/build `3.4.128`; verified `/api/auth/config` reports `product_edition=platform`; verified live DB `feature_flags.events_enabled=true` and `feature_flags.collectibles_enabled=true` after active-stack and temporary homelab checks; verified Help > Releases serves `v3.4.128`; verified Docker Plex watch-state smoke reads fake PMS metadata and allLeaves watched-state fields for completed, in-progress, and unwatched entries, does not call scrobble/unscrobble writeback paths, and writes redacted evidence; verified homelab edition boundary in an isolated temporary compose project on port `3199` without changing the active platform stack.
- CI/checks run: `node --check backend/services/plex.js`, `node --check backend/scripts/plex-watch-state-sync-cadence-smoke.js`, `node --check backend/scripts/unit-tests.js`, local bundled Node `npm --prefix backend run test:unit` (`267` passed), local `npm --prefix backend run test:openapi`, local `npm --prefix backend run test:plex-watch-state-sync-cadence-smoke`, Docker `backend npm run test:unit` (`267` passed), Docker `backend npm run test:openapi`, Docker `backend npm run test:integration-smoke`, Docker `backend npm run test:plex-watch-state-sync-cadence-smoke`, Docker `backend npm run test:help-releases-smoke` with `BASE_URL=http://frontend:3000` and `EXPECTED_RELEASE_VERSION=v3.4.128`, Docker `backend npm run test:init-parity`, Docker `backend npm run test:migration-rehearsal`, platform-mode Docker `backend npm run test:rbac-regression`, platform-mode Docker `backend npm run test:platform-edition-boundary`, isolated homelab Docker `backend npm run test:homelab-edition-boundary`, full host Playwright browser regression with bundled Node (`62` passed, `4` skipped), `npm run validate:public-export`, `npm --prefix backend run test:observability-evidence`, `npm --prefix backend run test:release-preflight-local`, generated-artifact secret-pattern scan, and `git diff --check`.
- Files changed: `app-meta.json`, `artifacts/observability-evidence/observability-release-evidence.json`, `artifacts/plex-watch-state/plex-watch-state-sync-cadence-smoke.json`, `backend/app-meta.json`, `backend/package.json`, `backend/release-feed.json`, `backend/scripts/plex-watch-state-sync-cadence-smoke.js`, `backend/scripts/unit-tests.js`, `backend/services/plex.js`, `docker-compose.yml`, `docs/releases/v3.4.128.md`, `docs/wiki/07-Release-Roadmap.md`, `docs/wiki/08-Backlog.md`, `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`, `frontend/package.json`, `frontend/src/app-meta.json`, and `preflight-go-no-go.md`.
- Risks or follow-ups: this slice is intentionally read-only and does not yet mutate collectZ watched state or write watched state back to Plex; rating writeback apply behavior, scheduled full-library reconciliation, and broad Plex import rewrites remain future slices; local `compose-smoke` secure-cookie parity, CI `secret-scan`, and `image-security-and-sbom` remain CI-only or blocked locally as documented in `preflight-go-no-go.md`.
- What remains in the milestone: none for `3.4.128`; future Plex slices can implement watched-state apply/writeback, rating writeback apply behavior, scheduled reconciliation, and deeper workspace-owned provider administration.
- Recommended commit message: `Release 3.4.128 with Plex watch-state sync cadence contract`

## 3.4.129 — Plex Watched-State Apply Implementation

**Goal:** Apply proven Plex watched-state readback to existing collectZ rows without importing new media rows or writing watched state back to Plex.

### Scope

- Add an explicit admin-only Plex watched-state apply endpoint.
- Read Plex watched/progress fields via the contract from `3.4.128`.
- Update matching movie/media rows through safe Plex watch-state metadata.
- Update matching TV series season rows through `media_seasons` when episode leaf readback includes a linked series rating key and season number.
- Prove the apply path against a fake PMS with an existing movie and TV series.
- Keep scheduled refresh, Plex scrobble/unscrobble writeback, rating writeback apply behavior, full-library reconciliation, and broad Plex import rewrites out of scope.

### Acceptance Criteria

- The apply endpoint requires admin access and existing Plex configuration.
- Plex watched-state readback updates existing collectZ rows but does not create media rows.
- Movie watched state is stored as Plex-derived metadata on the existing row.
- TV episode leaf readback updates existing `media_seasons` state.
- Smoke evidence proves no Plex scrobble/unscrobble writeback paths were called and no Plex secrets or file paths are surfaced.
- Running-stack verification proves the app serves `3.4.129`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.129 — Plex Watched-State Apply Implementation`.
- Project docs/checklists used: `AGENTS.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `docs/wiki/08-Backlog.md`; `docs/wiki/17-Release-Go-No-Go-Checklist.md`; `docs/wiki/10-CI-CD-and-Registry-Deploy.md`.
- Runtime verification used: Docker-first stack rebuilt with `APP_VERSION=3.4.129`; `/api/health` served backend/frontend/build `3.4.129`; running backend container reported `APP_EDITION=platform` and `APP_VERSION=3.4.129`; live DB kept `events_enabled=true` and `collectibles_enabled=true`; Help > Releases smoke served `v3.4.129`; Plex watched-state apply smoke used a fake PMS to update an existing movie and TV season without creating media rows or calling Plex scrobble/unscrobble writeback paths.
- CI/checks run: `node --check backend/routes/media.js`; `node --check backend/scripts/plex-watch-state-apply-smoke.js`; `node --check backend/scripts/unit-tests.js`; backend unit tests; OpenAPI validation; Docker Plex watched-state apply smoke; Docker integration smoke; Docker init parity; Docker migration rehearsal; local compose-smoke health/header/CSRF/auth checks; Docker RBAC regression; Docker platform edition boundary; isolated Docker Homelab edition boundary; public export validation; observability release evidence; local release preflight; Help > Releases smoke; Playwright browser regression (`62 passed`, `4 skipped`); `git diff --check`; targeted generated-artifact secret hygiene scan. Backend production dependency audit in Docker showed `0` critical and `0` high findings with `2` moderate findings; frontend production dependency audit in a Node container showed `0` findings. Local `gitleaks`, `trivy`, and SBOM tooling were unavailable, so `secret-scan` and `image-security-and-sbom` still require CI confirmation.
- Files changed: `app-meta.json`; `backend/app-meta.json`; `backend/openapi/openapi.yaml`; `backend/package.json`; `backend/release-feed.json`; `backend/routes/media.js`; `backend/scripts/plex-watch-state-apply-smoke.js`; `backend/scripts/unit-tests.js`; `docker-compose.yml`; `docs/releases/v3.4.129.md`; `docs/wiki/07-Release-Roadmap.md`; `docs/wiki/08-Backlog.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `frontend/package.json`; `frontend/src/app-meta.json`; `artifacts/observability-evidence/observability-release-evidence.json`; `artifacts/plex-watch-state/plex-watch-state-apply-smoke.json`; `preflight-go-no-go.md`.
- Risks or follow-ups: apply behavior depends on existing Plex rating-key metadata and season numbers, so unmatched Plex rows are skipped rather than imported; scheduled watched-state refresh, Plex scrobble/unscrobble writeback, rating writeback apply, and broader Plex import reconciliation remain separate milestones.
- What remains in the milestone: no implementation work remains for `3.4.129`; CI must still confirm `secret-scan` and `image-security-and-sbom` because the local tooling is not installed.
- Recommended commit message: `Release 3.4.129 with Plex watched-state apply implementation`.

## 3.4.130 — Plex Watched-State Scheduled Refresh

**Goal:** Let collectZ refresh Plex watched-state readbacks for existing Plex-linked rows on demand and through an opt-in scheduler without importing new rows or writing watched state back to Plex.

### Scope

- Add a Plex watched-state refresh scheduler runtime with status and manual-run endpoints.
- Discover existing Plex-linked collectZ rows by `plex_item_key` and group them by library scope.
- Reuse the `3.4.129` watched-state apply path so matched movies and TV seasons update consistently.
- Keep the timer opt-in by environment variable to avoid unexpected Plex polling on upgrade.
- Prove the scheduler sweep against a fake PMS with an existing movie and TV series.
- Keep Plex scrobble/unscrobble writeback, rating writeback apply behavior, full-library reconciliation, and broad Plex import rewrites out of scope.

### Acceptance Criteria

- The scheduler status and manual-run endpoints require admin access.
- The scheduler reports runtime config and last-run state without surfacing Plex secrets.
- A manual scheduler sweep updates existing movie and TV season watched state without creating media rows.
- Smoke evidence proves no Plex scrobble/unscrobble writeback paths were called and no Plex secrets or file paths are surfaced.
- Running-stack verification proves the app serves `3.4.130`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.130 — Plex Watched-State Scheduled Refresh`.
- Project docs/checklists used: `AGENTS.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `docs/wiki/08-Backlog.md`; `docs/wiki/17-Release-Go-No-Go-Checklist.md`; `docs/wiki/10-CI-CD-and-Registry-Deploy.md`; `docs/releases/v3.4.130.md`.
- Runtime verification used: Docker-first stack rebuilt with `APP_VERSION=3.4.130`; `/api/health` served backend/frontend/build `3.4.130`; running backend container reported `APP_EDITION=platform`, `APP_VERSION=3.4.130`, and `PLEX_WATCH_STATE_REFRESH_ENABLED=false`; live DB kept `events_enabled=true` and `collectibles_enabled=true`; Help > Releases smoke served `v3.4.130`; Plex watched-state refresh scheduler smoke used a fake PMS to prove the timer defaults off, a manual sweep updates an existing movie and TV season, no media rows are created, and Plex scrobble/unscrobble writeback paths are not called.
- CI/checks run: `node --check backend/routes/media.js`; `node --check backend/server.js`; `node --check backend/scripts/plex-watch-state-refresh-scheduler-smoke.js`; `node --check backend/scripts/unit-tests.js`; local backend unit tests (`269` passed); local OpenAPI validation; Docker backend unit tests (`269` passed); Docker OpenAPI validation; Docker integration smoke; Docker Plex watched-state refresh scheduler smoke; Docker Help > Releases smoke; Docker init parity; Docker migration rehearsal; local compose-smoke health/header/CSRF/auth checks; Docker RBAC regression; Docker platform edition boundary; isolated Docker Homelab edition boundary; public export validation; observability release evidence; local release preflight; Playwright browser regression (`62` passed, `4` skipped); `git diff --check`; targeted generated-artifact secret hygiene scan. Backend production dependency audit in Docker showed `0` critical and `0` high findings with `2` moderate findings; frontend production dependency audit in a Node container showed `0` findings. Local `gitleaks`, `trivy`, and SBOM tooling were unavailable, so `secret-scan` and `image-security-and-sbom` still require CI confirmation.
- Files changed: `app-meta.json`; `backend/app-meta.json`; `backend/openapi/openapi.yaml`; `backend/package.json`; `backend/release-feed.json`; `backend/routes/media.js`; `backend/scripts/plex-watch-state-refresh-scheduler-smoke.js`; `backend/scripts/unit-tests.js`; `backend/server.js`; `docker-compose.yml`; `docs/releases/v3.4.130.md`; `docs/wiki/07-Release-Roadmap.md`; `docs/wiki/08-Backlog.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `env.example`; `frontend/package.json`; `frontend/src/app-meta.json`; `scripts/generate-public-compose.js`; `artifacts/observability-evidence/observability-release-evidence.json`; `artifacts/plex-watch-state/plex-watch-state-refresh-scheduler-smoke.json`; `preflight-go-no-go.md`.
- Risks or follow-ups: the scheduler is intentionally opt-in and defaults off to avoid unexpected Plex polling; refresh matching depends on existing `plex_item_key` metadata and season numbers; Plex watched-state writeback, Plex rating writeback apply behavior, scheduled full-library reconciliation, and broad Plex import rewrites remain separate milestones.
- What remains in the milestone: no implementation work remains for `3.4.130`; CI must still confirm `secret-scan` and `image-security-and-sbom` because the local tooling is not installed.
- Recommended commit message: `Release 3.4.130 with Plex watched-state scheduled refresh`.

## 3.4.131 — Plex Rating Readback Apply Implementation

**Goal:** Apply Plex user-rating readback to existing collectZ rows without importing new rows or writing ratings back to Plex.

### Scope

- Add a read-only Plex rating snapshot parser for `userRating`.
- Add an admin-only rating apply endpoint for explicit rating-key or section readback.
- Update matching collectZ `user_rating` values and store lightweight Plex rating metadata.
- Prove the apply path against a fake PMS with an existing movie row.
- Keep collectZ-to-Plex `/:/rate` writeback, watched-state writeback, scheduled rating refresh, full-library reconciliation, and broad Plex import rewrites out of scope.

### Acceptance Criteria

- The apply endpoint requires admin access and existing Plex configuration.
- Plex rating readback updates existing collectZ rows but does not create media rows.
- Plex provider `rating` is not treated as the user's rating when `userRating` is absent.
- Smoke evidence proves `/:/rate` writeback was not called and no Plex secrets or file paths are surfaced.
- Running-stack verification proves the app serves `3.4.131`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.131 — Plex Rating Readback Apply Implementation`.
- Project docs/checklists used: `AGENTS.md`; `docs/wiki/17-Release-Go-No-Go-Checklist.md`; `docs/wiki/10-CI-CD-and-Registry-Deploy.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `docs/wiki/08-Backlog.md`.
- Runtime verification used: Docker-first rebuild of backend/frontend with `APP_VERSION=3.4.131`; live `/api/health` returned frontend/backend/build `3.4.131`; live backend container env remained `APP_EDITION=platform`; live DB feature flags showed `events_enabled=true` and `collectibles_enabled=true`; Docker Plex rating apply smoke updated an existing movie from Plex `userRating=8.5`, stored `plex_user_rating`, did not create new media rows, and proved fake PMS `/:/rate` writeback was not called; Docker Help > Releases served `v3.4.131`; isolated homelab stack boundary passed and was torn down before rechecking the active platform stack.
- CI/checks run: `node --check backend/services/plex.js`; `node --check backend/routes/media.js`; `node --check backend/scripts/plex-rating-apply-smoke.js`; `node --check backend/scripts/unit-tests.js`; local backend unit tests (`271` passed); local OpenAPI validation; Docker backend unit tests (`271` passed); Docker OpenAPI validation; Docker integration smoke; Docker Plex rating apply smoke; Docker Help > Releases smoke; Docker init parity; Docker migration rehearsal; local compose-smoke health/header/CSRF/auth checks; Docker RBAC regression; Docker platform edition boundary; isolated Docker Homelab edition boundary; public export validation; observability release evidence; local release preflight; Playwright browser regression (`62` passed, `4` skipped); `git diff --check`; targeted generated-artifact secret hygiene scan. Backend production dependency audit in Docker showed `0` critical and `0` high findings with `2` moderate findings; frontend production dependency audit in a Node container showed `0` findings. Local `gitleaks`, `trivy`, and `syft` were unavailable, so `secret-scan` and `image-security-and-sbom` still require CI confirmation.
- Files changed: `app-meta.json`; `backend/app-meta.json`; `backend/openapi/openapi.yaml`; `backend/package.json`; `backend/release-feed.json`; `backend/routes/media.js`; `backend/scripts/plex-rating-apply-smoke.js`; `backend/scripts/unit-tests.js`; `backend/services/plex.js`; `docker-compose.yml`; `docs/releases/v3.4.131.md`; `docs/wiki/07-Release-Roadmap.md`; `docs/wiki/08-Backlog.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `frontend/package.json`; `frontend/src/app-meta.json`; `artifacts/observability-evidence/observability-release-evidence.json`; `artifacts/plex-ratings/plex-rating-apply-smoke.json`; `preflight-go-no-go.md`.
- Risks or follow-ups: rating apply only updates existing rows matched by Plex rating key metadata; it does not import missing rows, schedule recurring rating refreshes, or write collectZ ratings back to Plex. Plex provider `rating` is intentionally ignored unless `userRating` is present.
- What remains in the milestone: no implementation work remains for `3.4.131`; CI must still confirm `secret-scan` and `image-security-and-sbom` because the local tools are not installed.
- Recommended commit message: `Release 3.4.131 with Plex rating readback apply implementation`.

## 3.4.132 — Plex Watched-State Writeback Contract

**Goal:** Prove the collectZ-to-Plex watched-state writeback request shape before adding any UI-driven, scheduled, or user-action-triggered Plex mutation.

### Scope

- Add an explicit watched-state writeback contract for Plex `scrobble` and `unscrobble`.
- Use `PUT /:/scrobble` and `PUT /:/unscrobble` with `identifier=com.plexapp.plugins.library` and a Plex rating key.
- Add a service-level fake-PMS smoke that proves both writeback calls without adding an admin route or automatic writeback behavior.
- Keep the existing readback apply and scheduled readback refresh behavior intact.
- Keep watched-state writeback implementation, rating writeback to Plex, scheduled full-library reconciliation, and broad Plex import rewrites out of scope.

### Acceptance Criteria

- The contract documents action, method, path, identifier, and supported key/URI input shape.
- The request builder rejects missing rating keys/URIs and unknown actions.
- The fake-PMS smoke proves collectZ sends `PUT` to both `/:/scrobble` and `/:/unscrobble`.
- No Plex token values, token query strings, private IPs, or raw file paths appear in smoke evidence.
- Running-stack verification proves the app serves `3.4.132`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.132 — Plex Watched-State Writeback Contract`.
- Project docs/checklists used: `AGENTS.md`; `docs/wiki/17-Release-Go-No-Go-Checklist.md`; `docs/wiki/10-CI-CD-and-Registry-Deploy.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `docs/wiki/08-Backlog.md`; `docs/releases/v3.4.132.md`.
- Runtime verification used: Docker-first rebuild of backend/frontend with `APP_VERSION=3.4.132`; live `/api/health` returned frontend/backend/build `3.4.132`; live backend container env remained `APP_EDITION=platform`; live DB feature flags showed `events_enabled=true` and `collectibles_enabled=true`; Docker Plex watched-state writeback contract smoke proved service-level `PUT /:/scrobble` and `PUT /:/unscrobble` requests against a fake PMS with sanitized evidence; Docker Help > Releases served `v3.4.132`; isolated homelab stack boundary passed and was torn down before rechecking the active platform stack.
- CI/checks run: `node --check backend/services/plex.js`; `node --check backend/scripts/plex-watched-state-writeback-contract-smoke.js`; `node --check backend/scripts/unit-tests.js`; local backend unit tests (`273` passed); local Plex watched-state writeback contract smoke; Docker backend unit tests (`273` passed); Docker OpenAPI validation; Docker integration smoke; Docker Plex watched-state writeback contract smoke; Docker Help > Releases smoke; Docker init parity; Docker migration rehearsal; local compose-smoke health/header/CSRF/auth checks; Docker RBAC regression; Docker platform edition boundary; isolated Docker Homelab edition boundary; public export validation; observability release evidence; local release preflight; Playwright browser regression (`62` passed, `4` skipped); `git diff --check`; targeted generated-artifact secret hygiene scan. Backend production dependency audit in Docker showed `0` critical and `0` high findings with `2` moderate findings; frontend production dependency audit in a Node container showed `0` findings. Local `gitleaks`, `trivy`, and `syft` were unavailable, so `secret-scan` and `image-security-and-sbom` still require CI confirmation.
- Files changed: `app-meta.json`; `backend/app-meta.json`; `backend/package.json`; `backend/release-feed.json`; `backend/scripts/plex-watched-state-writeback-contract-smoke.js`; `backend/scripts/unit-tests.js`; `backend/services/plex.js`; `docker-compose.yml`; `docs/releases/v3.4.132.md`; `docs/wiki/07-Release-Roadmap.md`; `docs/wiki/08-Backlog.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `frontend/package.json`; `frontend/src/app-meta.json`; `artifacts/observability-evidence/observability-release-evidence.json`; `artifacts/plex-watch-state/plex-watched-state-writeback-contract-smoke.json`; `preflight-go-no-go.md`.
- Risks or follow-ups: this slice proves the watched-state writeback request shape only; it does not add a route, UI action, scheduled writeback, or normal media-action mutation against Plex. The next watched-state slice should decide where explicit admin/user intent lives and how collectZ state changes map to scrobble/unscrobble safely.
- What remains in the milestone: no implementation work remains for `3.4.132`; CI must still confirm `secret-scan` and `image-security-and-sbom` because the local tools are not installed.
- Recommended commit message: `Release 3.4.132 with Plex watched-state writeback contract`.

## 3.4.133 — Plex Watched-State Writeback Implementation

**Goal:** Add an explicit admin-only watched-state writeback path for one existing Plex-linked collectZ row, using the `3.4.132` contract without enabling automatic or scheduled Plex mutation.

### Scope

- Add an admin-only manual endpoint for `scrobble` and `unscrobble`.
- Resolve the target from an existing Plex-linked `media` row by `mediaId` or `ratingKey`.
- Reject unsupported TV-series writeback until a later episode-aware slice.
- Call Plex through the proven `PUT /:/scrobble` and `PUT /:/unscrobble` service helper.
- Record lightweight writeback provenance metadata on the collectZ row.
- Keep UI auto-sync, scheduled writeback, rating writeback to Plex, full-library reconciliation, and broad Plex import rewrites out of scope.

### Acceptance Criteria

- The endpoint requires admin access, active library scope, saved Plex configuration, and one existing Plex-linked media row.
- Explicit `scrobble` and `unscrobble` actions each call fake PMS with `PUT`.
- The route response and smoke evidence do not surface Plex token values, token query strings, private IPs, or raw file paths.
- The smoke proves no media rows are created during writeback.
- Running-stack verification proves the app serves `3.4.133`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.133 — Plex Watched-State Writeback Implementation`.
- Project docs/checklists used: `AGENTS.md`; `docs/wiki/17-Release-Go-No-Go-Checklist.md`; `docs/wiki/10-CI-CD-and-Registry-Deploy.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `docs/wiki/08-Backlog.md`; `docs/releases/v3.4.133.md`.
- Runtime verification used: Docker-first rebuild of backend/frontend with `APP_VERSION=3.4.133`; live `/api/health` returned frontend/backend/build `3.4.133`; live backend container env remained `APP_EDITION=platform`; live DB feature flags showed `events_enabled=true` and `collectibles_enabled=true`; Docker Plex watched-state writeback smoke proved admin-only single-row `scrobble` and `unscrobble` writeback against a fake PMS with no media row creation and sanitized evidence; Docker Help > Releases served `v3.4.133`; isolated homelab stack boundary passed and was torn down before rechecking the active platform stack.
- CI/checks run: `node --check backend/routes/media.js`; `node --check backend/services/plex.js`; `node --check backend/scripts/plex-watched-state-writeback-smoke.js`; `node --check backend/scripts/unit-tests.js`; local and Docker `npm run test:unit`; local and Docker `npm run test:openapi`; Docker `npm run test:integration-smoke`; Docker `npm run test:plex-watched-state-writeback-smoke`; Docker init parity; Docker migration rehearsal; Docker `npm run test:platform-edition-boundary`; Docker `npm run test:homelab-edition-boundary`; Docker `npm run test:rbac-regression`; direct compose smoke; `npm --prefix backend run test:observability-evidence`; `npm --prefix backend run test:release-preflight-local`; bundled-runtime `npm run test:browser`; backend production dependency audit; frontend production dependency audit in disposable Node container; `git diff --check`; targeted artifact/docs secret scan.
- Files changed: `app-meta.json`; `backend/app-meta.json`; `backend/openapi/openapi.yaml`; `backend/package.json`; `backend/release-feed.json`; `backend/routes/media.js`; `backend/scripts/plex-watched-state-writeback-smoke.js`; `backend/scripts/unit-tests.js`; `docker-compose.yml`; `docs/releases/v3.4.133.md`; `docs/wiki/07-Release-Roadmap.md`; `docs/wiki/08-Backlog.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `frontend/package.json`; `frontend/src/app-meta.json`; `artifacts/observability-evidence/observability-release-evidence.json`; `artifacts/plex-watch-state/plex-watched-state-writeback-smoke.json`; `preflight-go-no-go.md`.
- Risks or follow-ups: TV-series writeback remains intentionally blocked until an episode-aware Plex slice; rating writeback to Plex remains separate; local `gitleaks`, `trivy`, and `syft` CLIs are not installed, so CI must still confirm the full `secret-scan` and `image-security-and-sbom` gates. One RBAC run failed while another boundary smoke was active against the shared local DB, then passed cleanly when rerun alone.
- What remains in the milestone: no implementation work remains for `3.4.133`; CI must still confirm `secret-scan` and `image-security-and-sbom` because the local tools are not installed.
- Recommended commit message: `Release 3.4.133 with Plex watched-state writeback implementation`.

## 3.4.134 — Plex Rating Writeback to Plex

**Goal:** Add an explicit admin-only rating writeback path for one existing Plex-linked collectZ row, using the proven `/:/rate` request shape without enabling automatic or scheduled Plex rating mutation.

### Scope

- Add an admin-only manual endpoint for Plex rating writeback.
- Resolve the target from an existing Plex-linked `media` row by `mediaId` or `ratingKey`.
- Accept an explicit rating from 0 to 10, or use the matched row's existing `user_rating` when no rating is supplied.
- Call Plex through `PUT /:/rate` with `identifier=com.plexapp.plugins.library`, the Plex rating key, and the collectZ rating.
- Record lightweight writeback provenance metadata on the collectZ row.
- Keep UI auto-sync, scheduled rating writeback, scheduled full-library reconciliation, and broad Plex import rewrites out of scope.

### Acceptance Criteria

- The endpoint requires admin access, active library scope, saved Plex configuration, and one existing Plex-linked media row.
- The endpoint rejects missing/invalid ratings when no collectZ rating exists on the matched row.
- The fake PMS smoke proves `PUT /:/rate` is called with the expected key/rating and no media rows are created.
- The route response and smoke evidence do not surface Plex token values, token query strings, private IPs, or raw file paths.
- Running-stack verification proves the app serves `3.4.134`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.134 — Plex Rating Writeback to Plex`.
- Project docs/checklists used: `AGENTS.md`; `docs/wiki/17-Release-Go-No-Go-Checklist.md`; `docs/wiki/10-CI-CD-and-Registry-Deploy.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `docs/wiki/08-Backlog.md`; `docs/releases/v3.4.134.md`.
- Runtime verification used: Docker-first rebuild of backend/frontend with `APP_VERSION=3.4.134`; live `/api/health` returned frontend/backend/build `3.4.134`; live backend container env remained `APP_EDITION=platform`; live DB feature flags showed `events_enabled=true` and `collectibles_enabled=true`; Docker Plex rating writeback smoke proved admin-only single-row rating writeback against a fake PMS with `PUT /:/rate`, `identifier=com.plexapp.plugins.library`, rating key, and collectZ rating, with no media row creation and sanitized evidence; Docker Help > Releases served `v3.4.134`; isolated homelab stack boundary passed and was torn down before rechecking the active platform stack.
- CI/checks run: `node --check backend/routes/media.js`; `node --check backend/services/plex.js`; `node --check backend/scripts/plex-rating-writeback-smoke.js`; `node --check backend/scripts/unit-tests.js`; local and Docker `npm run test:unit`; local and Docker `npm run test:openapi`; Docker `npm run test:integration-smoke`; Docker `npm run test:plex-rating-writeback-smoke`; Docker Help > Releases smoke; Docker init parity; Docker migration rehearsal; Docker `npm run test:rbac-regression`; Docker `npm run test:platform-edition-boundary`; isolated Docker `npm run test:homelab-edition-boundary`; direct compose smoke; public export validation; `npm --prefix backend run test:observability-evidence`; `npm --prefix backend run test:release-preflight-local`; bundled-runtime `npm run test:browser`; backend production dependency audit; frontend production dependency audit in disposable Node container; `git diff --check`; targeted artifact/docs secret scan.
- Files changed: `app-meta.json`; `backend/app-meta.json`; `backend/openapi/openapi.yaml`; `backend/package.json`; `backend/release-feed.json`; `backend/routes/media.js`; `backend/scripts/plex-rating-writeback-smoke.js`; `backend/scripts/unit-tests.js`; `backend/services/plex.js`; `docker-compose.yml`; `docs/releases/v3.4.134.md`; `docs/wiki/07-Release-Roadmap.md`; `docs/wiki/08-Backlog.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `frontend/package.json`; `frontend/src/app-meta.json`; `artifacts/observability-evidence/observability-release-evidence.json`; `artifacts/plex-ratings/plex-rating-writeback-smoke.json`; `preflight-go-no-go.md`.
- Risks or follow-ups: rating writeback is intentionally explicit/admin-only and does not add UI auto-sync, scheduled writeback, full-library reconciliation, or broad Plex import rewrites; existing row matching still depends on `plex_item_key` metadata. Local `gitleaks`, `trivy`, and `syft` CLIs are not installed, so CI must still confirm the full `secret-scan` and `image-security-and-sbom` gates. Local preflight still marks CI secure-cookie compose conditions blocked because the dev stack runs with `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; direct compose smoke passed locally.
- What remains in the milestone: no implementation work remains for `3.4.134`; CI must still confirm `secret-scan` and `image-security-and-sbom` because the local tools are not installed.
- Recommended commit message: `Release 3.4.134 with Plex rating writeback to Plex`.

## 3.4.135 — Plex Writeback UI Controls

**Goal:** Give admins explicit Plex-linked detail drawer controls for pushing collectZ ratings and watched-state changes back to Plex, without adding automatic writeback or broad import behavior changes.

### Scope

- Expose Plex-linked state on media list/detail readbacks.
- Show admin-only Plex writeback controls in the media detail drawer when the row is linked to Plex.
- Wire rating writeback to the existing `POST /api/media/write-plex-rating` endpoint.
- Wire movie/non-TV watched and unwatched actions to the existing `POST /api/media/write-plex-watch-state` endpoint.
- Keep TV-series watched-state writeback blocked until an episode-aware slice.
- Keep scheduled writeback, automatic sync, full-library reconciliation, and broad Plex import rewrites out of scope.

### Acceptance Criteria

- Non-admin users do not receive Plex writeback controls.
- Non-Plex-linked rows do not show Plex writeback controls.
- Rating writeback uses the current collectZ row rating unless the backend rejects missing/invalid ratings.
- Movie/non-TV watched-state buttons call only explicit `scrobble` and `unscrobble` actions.
- Running-stack verification proves the app serves `3.4.135`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.135 — Plex Writeback UI Controls`.
- Project docs/checklists used: `AGENTS.md`; `docs/wiki/17-Release-Go-No-Go-Checklist.md`; `docs/wiki/10-CI-CD-and-Registry-Deploy.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `docs/wiki/08-Backlog.md`; `docs/releases/v3.4.135.md`.
- Runtime verification used: Docker-first rebuild of backend/frontend with `APP_VERSION=3.4.135`; live `/api/health` returned frontend/backend/build `3.4.135`; live backend container env remained `APP_EDITION=platform`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; live DB feature flags showed `events_enabled=true` and `collectibles_enabled=true`; Docker Help > Releases served `v3.4.135`; Docker Plex rating and watched-state writeback smokes passed sequentially against fake PMS responses with no media row creation; Playwright browser regression opened a real Plex-linked movie drawer in the running stack and proved admin controls post explicit rating and `scrobble` actions; isolated homelab stack boundary passed and was torn down before rechecking the active platform stack.
- CI/checks run: `node --check backend/routes/media.js`; `node --check backend/scripts/unit-tests.js`; bundled-runtime local `npm --prefix backend run test:unit`; local `npm --prefix backend run test:openapi`; local `npm --prefix frontend run build`; Docker `npm run test:unit`; Docker `npm run test:openapi`; Docker `npm run test:integration-smoke`; Docker `npm run test:plex-rating-writeback-smoke`; Docker `npm run test:plex-watched-state-writeback-smoke`; Docker Help > Releases smoke; Docker init parity; Docker migration rehearsal; Docker `npm run test:rbac-regression`; Docker `npm run test:platform-edition-boundary`; isolated Docker `npm run test:homelab-edition-boundary`; bundled-runtime `npm run test:browser`; backend and frontend production dependency audits in disposable Node 20 containers; `npm --prefix backend run test:observability-evidence`; `npm --prefix backend run test:release-preflight-local`; `git diff --check`; targeted artifact/docs secret pattern scan.
- Files changed: `app-meta.json`; `backend/app-meta.json`; `backend/package.json`; `backend/package-lock.json`; `backend/release-feed.json`; `backend/routes/media.js`; `backend/scripts/unit-tests.js`; `docker-compose.yml`; `docs/releases/v3.4.135.md`; `docs/wiki/07-Release-Roadmap.md`; `docs/wiki/08-Backlog.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `frontend/package.json`; `frontend/src/app-meta.json`; `frontend/src/components/LibraryView.jsx`; `frontend/src/components/app/DashboardContent.jsx`; `tests/playwright/specs/library-multiformat.browser.spec.js`; `artifacts/dependency-audit/backend-audit.json`; `artifacts/dependency-audit/frontend-audit.json`; `artifacts/observability-evidence/observability-release-evidence.json`; `preflight-go-no-go.md`.
- Risks or follow-ups: Plex writeback remains explicit/admin-only and still depends on existing Plex linkage metadata; TV-series watched-state controls remain hidden until an episode-aware writeback slice; full-library reconciliation, automatic writeback, and broad import rewrites remain separate. Local `gitleaks`, `trivy`, and `syft` CLIs are not installed, so CI must still confirm `secret-scan` and `image-security-and-sbom`; local preflight still marks secure-cookie compose conditions blocked because the dev stack runs with `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`, while direct compose health/header checks and runtime smokes passed locally.
- What remains in the milestone: no implementation work remains for `3.4.135`; CI must still confirm the CI-only `secret-scan` and `image-security-and-sbom` gates.
- Recommended commit message: `Release 3.4.135 with Plex writeback UI controls`.

## 3.4.136 — Plex Full-Library Reconciliation Contract

**Goal:** Add a read-only Plex full-library reconciliation preview that classifies what an import or scheduled reconciliation would do before any collectZ rows are created, updated, or linked.

### Scope

- Add an admin-only reconciliation preview endpoint for Plex library sections.
- Fetch Plex sections and selected section items through the current maintained legacy library paths.
- Compare Plex items to existing collectZ rows by Plex GUID, Plex item key, TMDB identity, and safe title/year fallback.
- Return sanitized buckets for `alreadyLinked`, `wouldUpdate`, `wouldCreate`, and `conflict`.
- Keep scheduled automation, automatic imports, row mutation, writeback, and broad Plex import rewrites out of scope.

### Acceptance Criteria

- The preview requires admin access, active library scope, and saved Plex configuration.
- The preview response is explicit about `readOnly`, `plexWriteback`, and `importMutation` state.
- The fake PMS smoke proves linked, update, create, and conflict buckets without creating or updating media rows.
- The route response and smoke evidence do not surface Plex token values, token query strings, private IPs, or raw media file paths.
- Running-stack verification proves the app serves `3.4.136`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.136 — Plex Full-Library Reconciliation Contract`.
- Project docs/checklists used: `AGENTS.md`; `docs/wiki/17-Release-Go-No-Go-Checklist.md`; `docs/wiki/10-CI-CD-and-Registry-Deploy.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `docs/wiki/08-Backlog.md`; `docs/releases/v3.4.136.md`.
- Runtime verification used: Docker-first backend/frontend rebuild with `APP_VERSION=3.4.136`; live `/api/health` returned frontend/backend/build `3.4.136`; live backend container env was restored to `APP_EDITION=platform`, `APP_VERSION=3.4.136`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; live DB feature flags showed `events_enabled=true` and `collectibles_enabled=true`; Docker Plex full-library reconciliation smoke hit the running stack via `BASE_URL=http://frontend:3000` and proved one `alreadyLinked`, one `wouldUpdate`, one `wouldCreate`, and one `conflict` bucket with `mediaCountBefore=3` and `mediaCountAfter=3`; Docker Help > Releases smoke served `v3.4.136`; direct compose health/header checks returned `200` with security headers and unauthenticated `/api/auth/me` returned `401`; homelab boundary was verified by temporarily applying a local homelab compose override, then the active stack was restored to platform and rechecked.
- CI/checks run: `node --check backend/routes/media.js`; `node --check backend/scripts/plex-full-library-reconciliation-smoke.js`; `node --check backend/scripts/unit-tests.js`; local OpenAPI validation; Docker `npm run test:unit`; Docker `npm run test:openapi`; Docker `npm run test:integration-smoke`; Docker `npm run test:plex-full-library-reconciliation-smoke`; Docker Help > Releases smoke; Docker init parity; Docker migration rehearsal; Docker `npm run test:rbac-regression`; Docker `npm run test:platform-edition-boundary`; Docker `npm run test:homelab-edition-boundary`; bundled-runtime `npm run test:browser`; `npm --prefix backend run test:observability-evidence`; `npm --prefix backend run test:release-preflight-local`; dependency-audit artifact readback showed backend/frontend low/moderate/high/critical counts all zero; `git diff --check`; targeted artifact/docs secret pattern scan.
- Files changed: `app-meta.json`; `backend/app-meta.json`; `backend/openapi/openapi.yaml`; `backend/package.json`; `backend/package-lock.json`; `backend/release-feed.json`; `backend/routes/media.js`; `backend/scripts/plex-full-library-reconciliation-smoke.js`; `backend/scripts/unit-tests.js`; `docker-compose.yml`; `docs/releases/v3.4.136.md`; `docs/wiki/07-Release-Roadmap.md`; `docs/wiki/08-Backlog.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `frontend/package.json`; `frontend/src/app-meta.json`; `artifacts/plex-reconciliation/plex-full-library-reconciliation-smoke.json`; `artifacts/observability-evidence/observability-release-evidence.json`; `preflight-go-no-go.md`.
- Risks or follow-ups: this is intentionally a read-only preview and does not schedule reconciliation, mutate collectZ rows, add UI controls, or rewrite the broad Plex import path; title/year fallback remains conservative and reports strong-ID conflicts instead of silently attaching. Local `gitleaks`, `trivy`, and `syft` CLIs are not installed, so CI must still confirm the full `secret-scan` and `image-security-and-sbom` gates. Local preflight still marks secure-cookie compose conditions blocked because the dev stack runs with `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; direct compose health/header checks, runtime smokes, and browser regression passed locally.
- What remains in the milestone: no implementation work remains for `3.4.136`; CI must still confirm the CI-only `secret-scan` and `image-security-and-sbom` gates.
- Recommended commit message: `Release 3.4.136 with Plex full-library reconciliation preview`.

## 3.4.137 — Plex Scheduled Reconciliation Preview Job

**Goal:** Promote the read-only Plex reconciliation preview into a tracked sync-job workflow so admins can run and review full-library reconciliation evidence without mutating collectZ rows or Plex.

### Scope

- Add an admin-only endpoint that queues a Plex reconciliation preview job.
- Store preview result history in the existing `sync_jobs` readback surface.
- Preserve the `alreadyLinked`, `wouldUpdate`, `wouldCreate`, and `conflict` bucket model from `3.4.136`.
- Keep the job explicitly read-only with `plexWriteback=false` and `importMutation=false`.
- Keep automatic reconciliation mutation, automatic imports, UI controls, and broad Plex import rewrites out of scope.

### Acceptance Criteria

- The job endpoint requires admin access, active library scope, and saved Plex configuration.
- The queued response and sync job result both expose the read-only processing mode.
- The fake PMS smoke proves the queued job succeeds and stores the same bucket counts in `/api/media/sync-jobs/:id/result`.
- The job response and smoke evidence do not surface Plex token values, token query strings, private IPs, or raw media file paths.
- Running-stack verification proves the app serves `3.4.137`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.137 — Plex Scheduled Reconciliation Preview Job`.
- Project docs/checklists used: `AGENTS.md`; `docs/wiki/17-Release-Go-No-Go-Checklist.md`; `docs/wiki/10-CI-CD-and-Registry-Deploy.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `docs/wiki/08-Backlog.md`; `docs/releases/v3.4.137.md`.
- Runtime verification used: Docker-first backend/frontend rebuild with `APP_VERSION=3.4.137`; live `/api/health` returned frontend/backend/build `3.4.137`; live backend container env was restored to `APP_EDITION=platform`, `APP_VERSION=3.4.137`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; live DB feature flags showed `events_enabled=true` and `collectibles_enabled=true`; Docker Plex reconciliation preview job smoke hit the running stack via `BASE_URL=http://frontend:3000` and proved the synchronous preview plus a succeeded `plex_reconciliation_preview` sync job with `mediaCountBefore=3`, `mediaCountAfter=3`, and one each of `alreadyLinked`, `wouldUpdate`, `wouldCreate`, and `conflict`; Docker Help > Releases smoke served `v3.4.137`; direct compose health/header checks returned `200` with security headers and unauthenticated `/api/auth/me` returned `401`; homelab boundary was verified by temporarily applying a local homelab compose override, then the active stack was restored to platform and rechecked.
- CI/checks run: `node --check backend/routes/media.js`; `node --check backend/scripts/plex-full-library-reconciliation-smoke.js`; `node --check backend/scripts/unit-tests.js`; local OpenAPI validation; Docker `npm run test:unit`; Docker `npm run test:openapi`; Docker `npm run test:integration-smoke`; Docker `npm run test:plex-reconciliation-preview-job-smoke`; Docker Help > Releases smoke; Docker init parity; Docker migration rehearsal; Docker `npm run test:rbac-regression`; Docker `npm run test:platform-edition-boundary`; Docker `npm run test:homelab-edition-boundary`; bundled-runtime `npm run test:browser`; `npm --prefix backend run test:observability-evidence`; `npm --prefix backend run test:release-preflight-local`; dependency-audit artifact readback showed backend/frontend low/moderate/high/critical counts all zero; `git diff --check`; targeted artifact/docs secret pattern scan.
- Files changed: `app-meta.json`; `backend/app-meta.json`; `backend/openapi/openapi.yaml`; `backend/package.json`; `backend/package-lock.json`; `backend/release-feed.json`; `backend/routes/media.js`; `backend/scripts/plex-full-library-reconciliation-smoke.js`; `backend/scripts/unit-tests.js`; `docker-compose.yml`; `docs/releases/v3.4.137.md`; `docs/wiki/07-Release-Roadmap.md`; `docs/wiki/08-Backlog.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `frontend/package.json`; `frontend/src/app-meta.json`; `artifacts/plex-reconciliation/plex-full-library-reconciliation-smoke.json`; `artifacts/observability-evidence/observability-release-evidence.json`; `preflight-go-no-go.md`.
- Risks or follow-ups: this is intentionally a queued preview job and does not add recurring scheduling, automatic reconciliation mutation, UI controls, or broad Plex import rewrites; sync job summaries now retain sanitized bucket rows, so very large libraries may need a later compact-summary/pagination pass before exposing a UI. Local `gitleaks`, `trivy`, and `syft` CLIs are not installed, so CI must still confirm the full `secret-scan` and `image-security-and-sbom` gates. Local preflight still marks secure-cookie compose conditions blocked because the dev stack runs with `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; direct compose health/header checks, runtime smokes, and browser regression passed locally.
- What remains in the milestone: no implementation work remains for `3.4.137`; CI must still confirm the CI-only `secret-scan` and `image-security-and-sbom` gates.
- Recommended commit message: `Release 3.4.137 with Plex reconciliation preview sync jobs`.

## 3.4.138 — User Rating Scale Normalization

**Goal:** Fix the Plex rating writeback scale mismatch by making collectZ `user_rating` canonical on a 0-10 provider-compatible scale while preserving the existing 0-5 star UI.

### Scope

- Convert the stored `media.user_rating` field from 0-5 star values to 0-10 values.
- Keep star controls visually and interactively 0-5 stars with half-star selection.
- Convert between star display and stored rating only at the frontend boundary.
- Let Plex writeback send the stored 0-10 value directly to Plex.
- Keep Plex rating readback as 0-10 internal data instead of dividing it into stars at storage time.
- Add migration/init parity and update the Plex writeback/browser coverage for the 3.5-star to Plex 7/10 case.

### Acceptance Criteria

- Existing 0-5 `user_rating` values migrate once to 0-10 values.
- A user selecting 3.5 stars saves `user_rating = 7`.
- Plex rating writeback sends `rating=7` for a 3.5-star collectZ title.
- Plex rating readback stores Plex `userRating` without converting it down to star scale.
- The visible star UI remains 0-5 stars.
- Running-stack verification proves the app serves `3.4.138`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.138 — User Rating Scale Normalization`.
- Project docs/checklists used: `AGENTS.md`; `docs/wiki/17-Release-Go-No-Go-Checklist.md`; `docs/wiki/10-CI-CD-and-Registry-Deploy.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `docs/wiki/08-Backlog.md`; `docs/releases/v3.4.138.md`.
- Runtime verification used: Docker-first backend/frontend rebuild with `APP_VERSION=3.4.138`; live `/api/health` returned frontend/backend/build `3.4.138`; live backend container env was restored to `APP_EDITION=platform`, `APP_VERSION=3.4.138`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; live DB feature flags showed `events_enabled=true` and `collectibles_enabled=true`; live DB schema showed `schema_migrations.max=99` and `media.user_rating numeric(3,1)`; Docker Plex rating writeback smoke proved `rating=7` for the collectZ 3.5-star equivalent; Docker Plex rating apply smoke proved Plex `userRating=8.5` stores as `user_rating=8.5` without calling `/:/rate`; Docker Help > Releases smoke served `v3.4.138`; direct compose health/header checks returned `200` with security headers and unauthenticated `/api/auth/me` returned `401`; homelab boundary was verified by temporarily applying a local homelab compose override, then the active stack was restored to platform and rechecked.
- CI/checks run: `node --check backend/routes/media.js`; `node --check backend/middleware/validate.js`; `node --check backend/db/migrations.js`; `node --check backend/scripts/plex-rating-writeback-smoke.js`; `node --check backend/scripts/unit-tests.js`; local OpenAPI validation; Docker `npm run test:unit`; Docker `npm run test:openapi`; Docker `npm run test:integration-smoke`; Docker `npm run test:plex-rating-writeback-smoke`; Docker `npm run test:plex-rating-apply-smoke`; Docker Help > Releases smoke; Docker init parity; Docker migration rehearsal; Docker `npm run test:rbac-regression`; Docker `npm run test:platform-edition-boundary`; Docker `npm run test:homelab-edition-boundary`; bundled-runtime `npm run test:browser`; `npm --prefix backend run test:observability-evidence`; `npm --prefix backend run test:release-preflight-local`; dependency-audit artifact readback showed backend/frontend low/moderate/high/critical counts all zero; `git diff --check`; targeted artifact/docs secret pattern scan.
- Files changed: `app-meta.json`; `backend/app-meta.json`; `backend/db/migrations.js`; `backend/middleware/validate.js`; `backend/package.json`; `backend/package-lock.json`; `backend/release-feed.json`; `backend/scripts/plex-rating-writeback-smoke.js`; `backend/scripts/unit-tests.js`; `docker-compose.yml`; `docs/releases/v3.4.138.md`; `docs/wiki/07-Release-Roadmap.md`; `docs/wiki/08-Backlog.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `frontend/package.json`; `frontend/package-lock.json`; `frontend/src/app-meta.json`; `frontend/src/components/LibraryView.jsx`; `init.sql`; `tests/playwright/specs/library-multiformat.browser.spec.js`; `artifacts/plex-ratings/plex-rating-writeback-smoke.json`; `artifacts/observability-evidence/observability-release-evidence.json`; `preflight-go-no-go.md`.
- Risks or follow-ups: the migration assumes existing `user_rating <= 5` values are legacy star-scale values and converts them to 0-10 once; this matches the current UI history and leaves any already-provider-scale values above 5 unchanged. The star UI remains 0-5, but CSV/API callers now need to treat `user_rating` as 0-10. Local `gitleaks`, `trivy`, and `syft` CLIs are not installed, so CI must still confirm the full `secret-scan` and `image-security-and-sbom` gates. Local preflight still marks secure-cookie compose conditions blocked because the dev stack runs with `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; direct compose health/header checks, runtime smokes, and browser regression passed locally.
- What remains in the milestone: no implementation work remains for `3.4.138`; CI must still confirm the CI-only `secret-scan` and `image-security-and-sbom` gates.
- Recommended commit message: `Release 3.4.138 with user rating scale normalization for Plex writeback`.

## 3.4.139 — Plex Temporary Reconciliation Review UI

**Goal:** Add a temporary admin review surface for existing Plex reconciliation preview results without introducing apply/mutation behavior.

### Scope

- Add a temporary read-only reconciliation preview panel to Plex integration settings.
- Let admins run the existing synchronous preview endpoint from the UI.
- Let admins queue the existing reconciliation preview job and read back its stored result.
- Show sanitized linked, would-update, would-create, and conflict buckets.
- Keep automatic reconciliation mutation, apply buttons, Plex writeback, and broad import rewrites out of scope.

### Acceptance Criteria

- The Plex integrations panel exposes read-only preview controls.
- Preview output shows summary counts and sample rows for all reconciliation buckets.
- Queued preview results can be read back into the same temporary review UI.
- The UI does not expose an apply action or raw Plex credentials.
- Running-stack verification proves the app serves `3.4.139`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.139 — Plex Temporary Reconciliation Review UI`.
- Project docs/checklists used: `AGENTS.md`; `docs/wiki/17-Release-Go-No-Go-Checklist.md`; `docs/wiki/10-CI-CD-and-Registry-Deploy.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `docs/wiki/08-Backlog.md`; `docs/releases/v3.4.139.md`.
- Runtime verification used: Docker-first backend/frontend rebuild with `APP_VERSION=3.4.139`; live `/api/health` returned frontend/backend/build `3.4.139`; live backend container env was restored to `APP_EDITION=platform`, `APP_VERSION=3.4.139`, `NODE_ENV=development`, and `SESSION_COOKIE_SECURE=false`; live DB feature flags showed `events_enabled=true` and `collectibles_enabled=true`; Docker Plex reconciliation preview job smoke proved read-only linked/update/create/conflict buckets with `mediaCountBefore=3` and `mediaCountAfter=3`; Docker Help > Releases smoke served `v3.4.139`; direct compose health/header checks returned `200` with security headers and unauthenticated `/api/auth/me` returned `401`; homelab boundary was verified by temporarily applying a local homelab compose override, then the active stack was restored to platform and rechecked.
- CI/checks run: `node --check backend/scripts/unit-tests.js`; bundled-runtime frontend build; Docker backend/frontend build; Docker `npm run test:unit`; Docker `npm run test:openapi`; Docker `npm run test:integration-smoke`; Docker `npm run test:plex-reconciliation-preview-job-smoke`; Docker Help > Releases smoke; Docker init parity; Docker migration rehearsal; Docker `npm run test:rbac-regression` with `BASE_URL=http://frontend:3000`; Docker `npm run test:platform-edition-boundary` with `BASE_URL=http://frontend:3000`; isolated Docker `npm run test:homelab-edition-boundary`; targeted `integrations.browser.spec.js`; full browser regression; `npm --prefix backend run test:observability-evidence`; `npm --prefix backend run test:release-preflight-local`; dependency-audit artifact readback showed backend/frontend low/moderate/high/critical counts all zero; `git diff --check`; targeted artifact/docs secret pattern scan.
- Files changed: `app-meta.json`; `backend/app-meta.json`; `backend/package.json`; `backend/package-lock.json`; `backend/release-feed.json`; `backend/scripts/unit-tests.js`; `docker-compose.yml`; `docs/releases/v3.4.139.md`; `docs/wiki/07-Release-Roadmap.md`; `docs/wiki/08-Backlog.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `frontend/package.json`; `frontend/package-lock.json`; `frontend/src/app-meta.json`; `frontend/src/components/AdminIntegrationsView.jsx`; `tests/playwright/specs/integrations.browser.spec.js`; `artifacts/observability-evidence/observability-release-evidence.json`; `preflight-go-no-go.md`.
- Risks or follow-ups: this is intentionally temporary UI and still has no apply action; large libraries show only the first 25 rows per bucket in the temporary view; automatic reconciliation mutation, conflict resolution policy, and broad Plex import rewrites remain separate. Local `gitleaks`, `trivy`, and `syft` CLIs are not installed, so CI must still confirm the full `secret-scan` and `image-security-and-sbom` gates. Local preflight still marks secure-cookie compose conditions blocked because the dev stack runs with `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`; direct compose health/header checks, runtime smokes, and browser regression passed locally.
- What remains in the milestone: no implementation work remains for `3.4.139`; CI must still confirm the CI-only `secret-scan` and `image-security-and-sbom` gates.
- Recommended commit message: `Release 3.4.139 with temporary Plex reconciliation review UI`.

## 3.4.140 — Plex Reconciliation Auto-Sync and Conflict Review

**Goal:** Let admins run a conservative one-way Plex library sync that applies safe reconciliation buckets and stores conflicts for review.

### Scope

- Add a queued Plex reconciliation sync endpoint.
- Reuse the existing reconciliation classifier before applying mutations.
- Automatically create rows from `wouldCreate`.
- Automatically update only strong-identity matches from `wouldUpdate`.
- Keep already-linked rows as no-op readback.
- Store conflicts and unsafe title/year-only matches in the sync job result for review.
- Update the Plex integrations panel from temporary preview-first language toward a sync action with sync issue readback.
- Keep Plex writeback, recurring scheduling, conflict apply/resolve controls, and broad import rewrites out of scope.

### Acceptance Criteria

- The sync job reports `processingMode=full_library_reconciliation_sync`, `importMutation=true`, and `plexWriteback=false`.
- A fake PMS smoke proves one safe create, one strong-ID update, one already-linked no-op, and one stored conflict.
- The UI exposes `Sync Plex Library` and shows sync issue readback without an apply action.
- The sync job result remains sanitized and does not expose Plex tokens, raw Plex URLs, private IPs, or media file paths.
- Running-stack verification proves the app serves `3.4.140`, Help > Releases contains the release, and `events_enabled` remains on.

### Closeout

- Roadmap slice: `3.4.140 — Plex Reconciliation Auto-Sync and Conflict Review`.
- Project docs/checklists used: `AGENTS.md`; `docs/wiki/17-Release-Go-No-Go-Checklist.md`; `docs/wiki/10-CI-CD-and-Registry-Deploy.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `docs/wiki/08-Backlog.md`; `docs/releases/v3.4.140.md`.
- Runtime verification used: Docker-first backend/frontend stack rebuilt and run with `APP_VERSION=3.4.140`; `/api/health` returned frontend/backend/build `3.4.140`; running backend env was restored to `APP_EDITION=platform`, `APP_VERSION=3.4.140`, `NODE_ENV=development`, `SESSION_COOKIE_SECURE=false`; live DB global feature flags showed `events_enabled=true` and `collectibles_enabled=true`; Docker Plex reconciliation sync smoke proved one create, one strong-ID update, one already-linked no-op, and one conflict-review row without leaking Plex tokens, raw URLs, private IPs, or file paths; Docker Help > Releases smoke served `v3.4.140`; direct compose `/api/auth/me` returned `401`; homelab boundary was verified under a temporary local homelab override and the stack was restored to platform.
- CI/checks run: `node --check backend/routes/media.js`; `node --check backend/scripts/plex-reconciliation-sync-smoke.js`; Docker `npm run test:unit`; Docker `npm run test:openapi`; Docker `npm run test:integration-smoke`; Docker `npm run test:init-parity`; Docker `npm run test:migration-rehearsal`; Docker `npm run test:rbac-regression`; Docker `npm run test:platform-edition-boundary`; isolated Docker `npm run test:homelab-edition-boundary`; Docker `npm run test:plex-reconciliation-sync-smoke`; Docker Help > Releases smoke; targeted `integrations.browser.spec.js`; full browser regression; `npm --prefix backend run test:observability-evidence`; `npm --prefix backend run test:release-preflight-local`; dependency audit artifact readback showed backend/frontend low/moderate/high/critical counts all zero; `git diff --check`; targeted artifact/docs secret pattern scan.
- Files changed: `app-meta.json`; `backend/app-meta.json`; `backend/openapi/openapi.yaml`; `backend/package.json`; `backend/package-lock.json`; `backend/release-feed.json`; `backend/routes/media.js`; `backend/scripts/plex-reconciliation-sync-smoke.js`; `backend/scripts/unit-tests.js`; `docker-compose.yml`; `docs/releases/v3.4.140.md`; `docs/wiki/07-Release-Roadmap.md`; `docs/wiki/08-Backlog.md`; `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md`; `frontend/package.json`; `frontend/package-lock.json`; `frontend/src/app-meta.json`; `frontend/src/components/AdminIntegrationsView.jsx`; `tests/playwright/specs/integrations.browser.spec.js`; `artifacts/observability-evidence/observability-release-evidence.json`; `preflight-go-no-go.md`.
- Risks or follow-ups: conflict review is readback-only for now; unsafe title/year matches are kept out of automatic mutation; recurring automation remains separate from this manual sync action; local `gitleaks`, `trivy`, and `syft` CLIs were not installed, so CI must still confirm full `secret-scan` and `image-security-and-sbom`; local preflight still marks secure-cookie compose conditions blocked because this dev stack runs with `SESSION_COOKIE_SECURE=false` and `NODE_ENV=development`, though direct compose health/header/auth checks passed locally.
- What remains in the milestone: no implementation work remains for `3.4.140`; CI must still confirm the CI-only `secret-scan` and `image-security-and-sbom` gates and stricter secure-cookie compose-smoke conditions.
- Recommended commit message: `Release 3.4.140 with Plex reconciliation auto-sync and conflict review`.

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
