# Environment Variables

All runtime variables are loaded from `.env` via `docker compose --env-file .env ...`.

## Required

These must be set for a working deployment:

- `DB_PASSWORD`: Postgres app user password.
- `REDIS_PASSWORD`: Redis password.
- `SESSION_SECRET`: session security secret for cookie/session infrastructure.
- `INTEGRATION_ENCRYPTION_KEY`: secret used to encrypt integration API keys at rest. Required in production.

Recommended generation:

```bash
openssl rand -hex 32
```

## Core Database/Runtime

- `DB_USER` (default: `mediavault`)
- `POSTGRES_DB` (default: `mediavault`)
- `DATABASE_SSL` (`false` by default)
- `NODE_ENV` (`production` by default)
- `TRUST_PROXY` (`1` recommended behind one reverse proxy hop; `false` when backend is exposed directly)
- `ALLOWED_ORIGINS` (comma-separated origins)
- `AUDIT_LOG_MODE` (`failures` by default): request-level activity logging verbosity.
  - `off`: disable request outcome audit entries
  - `failures`: log failed API requests only
  - `mutations`: log write requests (`POST/PUT/PATCH/DELETE`) plus failures
  - `all`: log all API requests
- Session controls:
  - `SESSION_TTL_DAYS` (default `7`): session lifetime in days.
  - `SESSION_MAX_PER_USER` (default `10`): max active sessions retained per user.
  - `SESSION_CLEANUP_INTERVAL_MINUTES` (default `60`): periodic expired-session cleanup cadence.

## Integration Defaults (Can Be Managed in Admin UI)

These can be set in `.env`, but admin settings in UI now control active global integrations:

- TMDB: `TMDB_PRESET`, `TMDB_PROVIDER`, `TMDB_API_URL`, `TMDB_API_KEY`, `TMDB_API_KEY_HEADER`, `TMDB_API_KEY_QUERY_PARAM`
- Barcode: `BARCODE_PRESET`, `BARCODE_PROVIDER`, `BARCODE_API_URL`, `BARCODE_API_KEY`, `BARCODE_API_KEY_HEADER`, `BARCODE_QUERY_PARAM`
- Vision: `VISION_PRESET`, `VISION_PROVIDER`, `VISION_API_URL`, `VISION_API_KEY`, `VISION_API_KEY_HEADER`
- Plex: `PLEX_PRESET`, `PLEX_PROVIDER`, `PLEX_API_URL`, `PLEX_SERVER_NAME`, `PLEX_API_KEY`
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

## Build Metadata (Recommended)

- `APP_VERSION`: semantic version shown in UI and health response (example: `1.7.0`).
- `GIT_SHA`: short git commit hash appended as build metadata (example: `2c9a862`).
- `BUILD_DATE`: UTC build timestamp (example: `2026-02-17T06:00:00Z`).

Metadata source of truth:

- `app-meta.json` in repo root
- Sync command: `node scripts/sync-app-meta.js`

These are optional in `.env`; you can also pass them inline on deploy.

## Included But Currently Not Used By Backend Code

Present in `env.example` for future extension:

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`

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

## Integration Key Rotation Notes

- `INTEGRATION_ENCRYPTION_KEY` protects encrypted integration credentials stored in `app_integrations`.
- Rotating this key without re-encrypting existing secrets will make old encrypted values undecryptable.
- If rotation is required:
  1. export/decrypt current integration keys while old key is active,
  2. update `INTEGRATION_ENCRYPTION_KEY`,
  3. re-save integration keys through Admin Integrations UI.
- Decryption failures are logged by the backend as warnings to make this state visible.
