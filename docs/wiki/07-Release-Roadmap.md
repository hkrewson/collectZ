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

---

## 2.0.0 — Multi-Space + Multi-Library Architecture

**Goal:** Each user can belong to one or more spaces, and each space can contain multiple libraries with isolated media and integrations.

### Scope

- Add spaces and memberships with per-space roles.
- Add libraries within each space (create, rename/update metadata, archive/delete behavior with safeguards).
- Scope media by both space and library.
- Scope invites and integrations by space.
- Add active-space switcher in UI.
- Replace single `Library` nav destination with library collection navigation:
  - `Library` becomes a parent section.
  - Child entries list available libraries in the active space.
  - Add quick actions for `New Library` and `Manage Libraries` (role-gated).
- Move integration settings (TMDB, Barcode, Vision, Plex) to space-level settings.
- Enforce space isolation across all CRUD and admin paths via `scopeContext` (now fully active).
- Legacy single-space installs auto-migrate into a default space with a default library — this migration must be reversible, documented, and tested against real snapshots from 1.9.

### Acceptance Criteria

- User sees only media from their active space and selected library.
- Space admins manage members, invites, integrations, and library lifecycle for their space.
- Library CRUD is available according to role policy; deleting a library requires explicit confirmation and defined handling for existing media.
- Cross-space data access is blocked at both the API and query layer.
- Cross-library data leakage is blocked unless explicitly requested via allowed filters.
- Legacy single-library deployments upgrade cleanly into a default space + default library with no data loss.
- Rollback from 2.0 to 1.9 is documented and tested.

### DB Checklist

- New tables: `spaces`, `space_memberships`, `libraries`.
- Add FK constraints to `space_id` on `media`, `invites`, `libraries`, and integration settings tables (previously nullable, now required).
- Add FK constraint to `media.library_id` (required in 2.0) referencing `libraries(id)`.
- Migrate existing data: create default space + default library, attach all existing users/media/settings.
- Add indexes on `(space_id, created_at)`, `(library_id, created_at)`, and common space/library-scoped lookup fields.

### API Checklist

- All protected endpoints resolve active space from session context.
- All media endpoints resolve active library from session/request context.
- New endpoints:
  - space CRUD
  - space membership management
  - library CRUD within active space
  - space-scoped integrations
- Secure RBAC at both global and space levels.
- Role checks enforce who can create, edit, archive, and delete libraries.

---

## Post-2.0 (Later Milestones)

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
- Shared vs. private user annotations and ratings controls.
- Mobile-optimized barcode scanning UI (camera input with real-time scan feedback).
- Email delivery for invites via SMTP (already stubbed in `env.example`).

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
2. Document release scope, migration notes, and any breaking changes.
3. Run CI pipeline — lint, smoke test, migration validation must all pass.
4. Build and push images via CI with `APP_VERSION`, `GIT_SHA`, `BUILD_DATE` injected.
5. Validate on a staging or local deployment:
   - Nav shows expected `v<semver> (<sha>)` string.
   - `/api/health` returns expected version/build fields.
   - Smoke test checklist passes (see `09-Smoke-Test-Checklist.md`).
6. Tag release in git: `vX.Y.Z`.
7. Update `docker-compose.registry.yml` default `IMAGE_TAG` value.
8. Notify homelab users via release notes of any env var changes required.
