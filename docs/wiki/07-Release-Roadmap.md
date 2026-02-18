# Release Roadmap (1.6.3 -> 2.0.0)

This roadmap converts product direction into implementation milestones with acceptance criteria and DB/API checklists.

## Guiding Principles

- Keep 1.x backward compatible.
- Use 2.0.0 for the multi-space data model change.
- Ship integrations incrementally, but design 1.x work to be reusable in 2.0.

## 1.6.3 (Stability + Operations)

Goal: harden deployment and health visibility for self-hosted environments.

### Scope

- Add frontend Docker healthcheck for Portainer visibility.
- Add lightweight admin action audit trail (invites, user role changes, integration updates).
- Add backup/restore runbook (Postgres dump/restore).
- Add smoke test checklist for auth + media CRUD + integrations.

### Acceptance Criteria

- Portainer shows `healthy`/`unhealthy` for frontend, backend, db, redis.
- Admin actions above are persisted in `activity_log`.
- Documentation includes tested backup and restore commands.
- Fresh deploy + login + add/edit/delete media verified on localhost and Docker host.

### DB Checklist

- Confirm `activity_log` captures: action, user_id, entity_type, entity_id, details, created_at.
- Add indexes only if query patterns require them.
- No destructive migrations.

### API Checklist

- No breaking API changes.
- Ensure admin action handlers write to activity log.
- `/api/health` returns version/build metadata.

## 1.7.0 (Plex Integration Foundation)

Goal: first usable Plex import flow under current single-library model.

### Scope

- Add Plex integration settings in Admin Integrations.
- Add key validation test endpoint.
- Add manual “Import from Plex” endpoint and UI trigger.
- Import title/year/runtime/poster when available.
- Add dedupe policy (TMDB ID first, fallback title+year).

### Acceptance Criteria

- Admin can save/test Plex config.
- Manual import populates library without duplicate explosion.
- Import summary shows `created`, `updated`, `skipped`.
- Errors are visible and actionable in UI.

### DB Checklist

- Add fields for Plex configuration in `app_integrations`:
  - `plex_base_url`
  - `plex_api_token_encrypted`
  - `plex_library_section`
- Optional media provenance fields:
  - `source_provider` (`plex`, `manual`, etc.)
  - `source_external_id`

### API Checklist

- `POST /api/admin/settings/integrations/test-plex`
- `POST /api/media/import-plex`
- Integration settings payload/response extended for Plex.
- Keep existing integration endpoints backward compatible.

## 1.8.0 (Sync Reliability + Library Quality)

Goal: improve import robustness and usability before multi-space migration.

### Scope

- Add background job queue for long-running imports/syncs.
- Add sync status model (`idle`, `running`, `failed`, `succeeded`).
- Add richer search/filter/sort controls.
- Add merge/resolve UI for near-duplicate titles.

### Acceptance Criteria

- Plex import can run asynchronously and survive request timeout limits.
- UI shows job progress/status and final result.
- Users can resolve duplicates from UI without direct DB edits.
- Search/filter/sort remains responsive on larger libraries.

### DB Checklist

- Add `sync_jobs` table (provider, scope, status, started_at, finished_at, error, summary).
- Add dedupe-support metadata only if required by UI.
- Add indexes for job queries by status/created_at.

### API Checklist

- `POST /api/media/import-plex` can enqueue job mode.
- `GET /api/sync-jobs` and `GET /api/sync-jobs/:id`.
- Clear contract for job result summary payload.

## 1.9.0 (2.0 Migration Prep)

Goal: introduce internals that reduce risk for the 2.0 spaces migration.

### Scope

- Introduce service-layer scoping primitives (`scopeContext` concept).
- Refactor queries to flow through scope-aware helpers.
- Add migration scripts/tests for single-library -> space-capable schema path.
- Add feature flags where needed for staged rollout.

### Acceptance Criteria

- No user-facing behavior regressions in single-library mode.
- New helper layer exists and is used by media/invite/user-management paths.
- Migration rehearsal documented and repeatable on a DB snapshot.

### DB Checklist

- Add non-breaking preparatory columns/tables only (nullable/default-safe).
- Provide rollback notes for each migration.
- Validate migration runtime on realistic dataset.

### API Checklist

- Keep public API responses stable in 1.9.
- Add internal-only scaffolding endpoints only if necessary.

## 2.0.0 (Multi-Space Architecture)

Goal: each user can belong to one or more spaces, with isolated media and integrations per space.

### Scope

- Add spaces + memberships with per-space roles.
- Scope media, invites, and integrations by space.
- Add active-space switcher in UI.
- Move integration settings (TMDB/Barcode/Vision/Plex) to space settings.
- Enforce space isolation across all CRUD and admin paths.

### Acceptance Criteria

- User sees only media from active space.
- Space admins manage members/invites/integrations for their space.
- Cross-space data access is blocked by API and query layer.
- Legacy single-space installs auto-migrate into a default space.

### DB Checklist

- New tables:
  - `spaces`
  - `space_memberships`
- Add `space_id` foreign keys to:
  - `media`
  - `invites`
  - integration settings table(s)
- Migrate existing data:
  - create default space
  - attach existing users/media/settings to that space
- Add indexes on `(space_id, created_at)` and common lookup fields.

### API Checklist

- Require/resolve active space context on protected endpoints.
- New endpoints:
  - space CRUD (as needed)
  - space membership management
  - space-scoped integrations
- Preserve secure RBAC checks at both global and space levels.

## Post-2.0 (Later Milestones)

- Watchlist provider abstraction (Plex first, then others like Trakt).
- Per-space scheduled sync automation.
- Shared vs private user annotations and ratings controls.

## Release Operations Checklist (Each Version)

1. Update `frontend/package.json` and `backend/package.json`.
2. Document release scope and migration notes.
3. Build with metadata:
   - `APP_VERSION`
   - `GIT_SHA`
   - `BUILD_DATE`
4. Validate:
   - Nav shows expected version/build string.
   - `/api/health` returns expected version/build fields.
5. Tag release in git.
