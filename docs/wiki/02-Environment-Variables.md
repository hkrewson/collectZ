# Environment Variables

All runtime variables are loaded from `.env` via `docker compose --env-file .env ...`.

## Required

These must be set for a working deployment:

- `DB_PASSWORD`: Postgres app user password.
- `SESSION_SECRET`: session security secret for cookie/session infrastructure.
- `INTEGRATION_ENCRYPTION_KEY`: secret used to encrypt integration API keys at rest. Required in production.
- Production hardening:
  - `SESSION_SECRET` and `INTEGRATION_ENCRYPTION_KEY` must be non-placeholder values and at least 32 characters.
  - `DB_PASSWORD` must be set in production.

Recommended generation:

```bash
openssl rand -hex 32
```

## Core Database/Runtime

- `DB_USER` (default: `mediavault`)
- `POSTGRES_DB` (default: `mediavault`)
- `DATABASE_SSL` (`false` by default)
- `NODE_ENV` (`production` by default)
- `APP_EDITION` (`platform` by default)
  - supported values:
    - `platform`: current tenancy/global-admin product surface
    - `homelab`: single-household surface with Help limited to `Guidance` and `Releases`
  - backend is the source of truth for the active edition and exposes it through auth/bootstrap responses
- `TRUST_PROXY` (`1` recommended behind one reverse proxy hop; `false` when backend is exposed directly)
- `SESSION_COOKIE_SECURE` (default `true`): must remain `true` in production.
  - If you run plain HTTP development over `localhost` or a trusted LAN IP, use `NODE_ENV=development` and optionally set `SESSION_COOKIE_SECURE=false`.
- `ALLOWED_ORIGINS` (comma-separated origins)
  - For local LAN testing, include the exact origin you open in the browser, for example `http://10.22.20.91:3000`.
- `ALLOW_SESSION_BEARER_FALLBACK` (default `false`): legacy escape hatch that permits session tokens in `Authorization: Bearer` headers.
  - Keep `false` for normal browser hardening.
  - Only enable temporarily for older non-browser clients that still depend on bearer session tokens.
- `AUDIT_LOG_MODE` (`failures` by default): request-level activity logging verbosity.
  - `off`: disable request outcome audit entries
  - `failures`: log failed API requests only
  - `mutations`: log write requests (`POST/PUT/PATCH/DELETE`) plus failures
  - `all`: log all API requests
  - request-outcome entries include method, path, status, duration, and a sanitized error summary when present
- Session controls:
  - `SESSION_TTL_DAYS` (default `7`): session lifetime in days.
  - `SESSION_MAX_PER_USER` (default `10`): max active sessions retained per user.
  - `SESSION_CLEANUP_INTERVAL_MINUTES` (default `60`): periodic expired-session cleanup cadence.
- Rate limiting controls (app-layer authoritative policy):
  - `RATE_LIMIT_WINDOW_MINUTES` (default `15`)
  - `RATE_LIMIT_GLOBAL_MAX` (default `600`) — global `/api/*` safety net.
  - `RATE_LIMIT_AUTH_MAX` (default `20`) — `/api/auth/login`, `/api/auth/register`.
  - `RATE_LIMIT_ADMIN_MAX` (default `300`) — `/api/admin/*`.
  - `RATE_LIMIT_MEDIA_READ_MAX` (default `600`) — `GET/HEAD /api/media/*`.
  - `RATE_LIMIT_MEDIA_WRITE_MAX` (default `240`) — write methods on `/api/media/*`.
  - `RATE_LIMIT_IMPORT_START_MAX` (default `60`) — import start routes.
  - `RATE_LIMIT_SYNC_POLL_MAX` (default `600`) — `/api/media/sync-jobs`.
  - `RATE_LIMIT_EXTERNAL_API_MAX` (default `30`) — external provider routes (`/api/media/search-tmdb`, `/api/media/lookup-upc`).
  - `PLAYWRIGHT_E2E_BYPASS_TOKEN` (optional) — Playwright-only rate-limit bypass token for browser regression runs.
    - Requests must include header `x-playwright-e2e-bypass: <token>`.
    - Intended only for local/CI browser testing.
    - Leave unset for normal runtime.
- Feature flags:
  - `FEATURE_FLAGS_READ_ONLY` (default `false`) — when true, admin flag updates are blocked (read-only control plane).
  - `FEATURE_FLAGS_CACHE_TTL_SECONDS` (default `10`) — backend feature-flag cache TTL.
    - Multi-instance note: cache is process-local; flag updates become visible on other backend instances after their TTL window expires.
  - Active operator/runtime flag env overrides (highest precedence):
    - `FEATURE_FLAG_EVENTS_ENABLED`
    - `FEATURE_FLAG_COLLECTIBLES_ENABLED`
  - Integrations-owned runtime toggles:
    - `metrics_enabled`
    - `external_log_export_enabled`
    - These are now controlled from `Admin -> Integrations` rather than per-flag env overrides.
  - Retired baked-in flag overrides are no longer part of the active control model:
    - CSV import, Plex import, TMDB search/details, normalized metadata reads, drawer-edit UI, and API docs availability no longer use admin-visible feature flags.
  - `METRICS_SCRAPE_TOKEN` (optional) — dedicated bearer token accepted by `/api/metrics`.
    - Intended for Prometheus or another trusted internal scraper.
    - Only active when `DEBUG>=1` and the Metrics integration setting is enabled.
  - `/api/docs` is admin-only and only available when `DEBUG>=1`; it is no longer controlled by a separate feature flag.
    - Keep it on private infrastructure only.
  - `LOG_EXPORT_BACKEND` (default `off`) — external structured-log backend.
    - supported values:
      - `off`
      - `gelf_udp`
      - `gelf_tcp`
      - `stdout_json`
      - `syslog_udp`
      - `syslog_tcp`
  - `LOG_EXPORT_HOST` (default `127.0.0.1`) — log collector host for structured-log export.
  - `LOG_EXPORT_PORT` (default `12201` for GELF/stdout-oriented paths, `514` for syslog backends) — log collector port for structured-log export.
  - `LOG_EXPORT_SETTINGS_READ_ONLY` (default `false`) — when true, `Admin -> Integrations -> External Logs` becomes read-only for backend/host/port and the running env stays authoritative.
  - `LOG_EXPORT_HOST_LABEL` (default `collectz-backend`) — GELF `host` field value.
  - `LOG_EXPORT_SERVICE` (default `backend`) — structured log `_service` value.
  - `LOG_EXPORT_DEBUG` (default `false`) — emit debug traces for export gating, event build, and transport attempts.
  - `LOG_EXPORT_MAX_DETAIL_BYTES` (default `16384`) — max serialized `_details` payload before truncation.
  - `GIT_SHA` (optional) — build SHA added to structured logs when set.
    - `2.9.9` begins moving the common case into the admin control plane:
      - `Admin -> Integrations -> External Logs` can now manage backend / transport, collector host, and collector port when `LOG_EXPORT_SETTINGS_READ_ONLY=false`.
      - `LOG_EXPORT_HOST_LABEL` and `LOG_EXPORT_SERVICE` now act as env fallbacks or locked read-only overrides for the External Logs control plane rather than being the only way to set those labels.
      - if no saved control-plane endpoint exists yet, runtime env values still act as the fallback.
## Integration Defaults (Can Be Managed in Admin UI)

These can be set in `.env`, but admin settings in UI now control active global integrations:

- TMDB: `TMDB_PRESET`, `TMDB_PROVIDER`, `TMDB_API_URL`, `TMDB_API_KEY`
- Barcode: `BARCODE_PRESET`, `BARCODE_PROVIDER`, `BARCODE_API_URL`, `BARCODE_API_KEY`
- Plex: `PLEX_PRESET`, `PLEX_PROVIDER`, `PLEX_API_URL`, `PLEX_API_KEY`
- Supported provider presets now own their key-header and query-param details in backend service config.
- Custom integration authoring is intentionally not part of the current Admin Integrations surface. If we need user-defined providers later, that belongs in a dedicated plugin/extensibility milestone.
- CWA OPDS (deferred/disabled runtime surface): `CWA_OPDS_URL`, `CWA_USERNAME`, `CWA_PASSWORD`
- Async import tuning:
  - `TMDB_IMPORT_MIN_INTERVAL_MS` (default `50`): minimum delay between TMDB enrichment calls during Plex import.
  - `PLEX_JOB_PROGRESS_BATCH_SIZE` (default `25`): items processed between persisted async progress updates.
  - `CSV_JOB_PROGRESS_BATCH_SIZE` (default `25`): rows processed between persisted progress updates for CSV imports.


## Storage Provider

Cover image upload storage is configurable:

- `STORAGE_PROVIDER` (`local` default, `s3` optional)

When `STORAGE_PROVIDER=s3`, configure:

- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_REGION` (default `us-east-1`)
- `S3_ENDPOINT` (optional, required for MinIO/B2-compatible endpoints)
- `S3_FORCE_PATH_STYLE` (`true` default; useful for S3-compatible providers)
- `S3_PUBLIC_BASE_URL` (optional; override returned public URL base, e.g. CDN/custom domain)

`local` mode stores files under the backend `uploads/` directory and serves them at `/uploads/...`.

## Frontend

- `REACT_APP_API_URL` (default: `/api`)

## Version Metadata

- `APP_VERSION`: optional override for semantic version shown in UI and health response (example: `1.7.0`).

Metadata source of truth:

- `app-meta.json` in repo root
- Sync command: `node scripts/sync-app-meta.js`

If `APP_VERSION` is unset, runtime falls back to `app-meta.json`.

## SMTP Mail Delivery (Invites + Password Resets)

When SMTP is configured, admin-created invites and password resets are emailed directly.

- `SMTP_HOST`
- `SMTP_PORT` (default recommended: `587`)
- `SMTP_USER` (optional if relay allows anonymous send)
- `SMTP_PASSWORD` (required when `SMTP_USER` is set)
- `SMTP_FROM` (required sender display/address)
- `SMTP_SECURE` (optional; defaults to `true` when port is `465`, else `false`)

If SMTP is not configured, backend falls back to copy-link token workflows for admin UX.

## Validation Tip

Before startup:

```bash
docker compose --env-file .env config >/dev/null
```

If Compose warns a required variable is unset, fix `.env` before `up`.

## Production Startup Error Reference

If `INTEGRATION_ENCRYPTION_KEY` is missing in production mode, backend startup fails with:

`INTEGRATION_ENCRYPTION_KEY must be set in production`

Set the variable in `.env` and restart backend.

If `SESSION_COOKIE_SECURE` is set to `false` while `NODE_ENV=production`, backend startup fails with:

`SESSION_COOKIE_SECURE must be true in production`

If `SESSION_SECRET` or `INTEGRATION_ENCRYPTION_KEY` is weak (placeholder/short) in production, backend startup fails with:

- `SESSION_SECRET is too weak in production (minimum 32 chars, non-placeholder value)`
- `INTEGRATION_ENCRYPTION_KEY is too weak in production (minimum 32 chars, non-placeholder value)`

If `DB_PASSWORD` is missing in production, backend startup fails with:

`DB_PASSWORD must be set in production`

## Integration Key Rotation Notes

- `INTEGRATION_ENCRYPTION_KEY` protects encrypted integration credentials stored in `app_integrations`.
- Rotating this key without re-encrypting existing secrets will make old encrypted values undecryptable.
- If rotation is required:
  1. export/decrypt current integration keys while old key is active,
  2. update `INTEGRATION_ENCRYPTION_KEY`,
  3. re-save integration keys through Admin Integrations UI.
- Decryption failures are logged by the backend as warnings to make this state visible.

For full incident response and rotation commands, use:

- `docs/wiki/15-Secrets-and-Rotation-Runbook.md`
- `docs/wiki/26-Admin-Recovery-and-SMTP-Triage.md`
