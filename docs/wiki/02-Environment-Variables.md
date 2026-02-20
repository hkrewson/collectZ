# Environment Variables

All runtime variables are loaded from `.env` via `docker compose --env-file .env ...`.

## Required

These must be set for a working deployment:

- `DB_PASSWORD`: Postgres app user password.
- `REDIS_PASSWORD`: Redis password.
- `SESSION_SECRET`: session security secret (used for session/cookie infrastructure and secure fallbacks).
- `INTEGRATION_ENCRYPTION_KEY`: secret used to encrypt integration API keys at rest.

Recommended generation:

```bash
openssl rand -hex 32
```

## Core Database/Runtime

- `DB_USER` (default: `mediavault`)
- `POSTGRES_DB` (default: `mediavault`)
- `DATABASE_SSL` (`false` by default)
- `NODE_ENV` (`production` by default)
- `ALLOWED_ORIGINS` (comma-separated origins)
- `AUDIT_LOG_MODE` (`failures` by default): request-level activity logging verbosity.
  - `off`: disable request outcome audit entries
  - `failures`: log failed API requests only
  - `mutations`: log write requests (`POST/PUT/PATCH/DELETE`) plus failures
  - `all`: log all API requests

## Integration Defaults (Can Be Managed in Admin UI)

These can be set in `.env`, but admin settings in UI now control active global integrations:

- TMDB: `TMDB_PRESET`, `TMDB_PROVIDER`, `TMDB_API_URL`, `TMDB_API_KEY`, `TMDB_API_KEY_HEADER`, `TMDB_API_KEY_QUERY_PARAM`
- Barcode: `BARCODE_PRESET`, `BARCODE_PROVIDER`, `BARCODE_API_URL`, `BARCODE_API_KEY`, `BARCODE_API_KEY_HEADER`, `BARCODE_QUERY_PARAM`
- Vision: `VISION_PRESET`, `VISION_PROVIDER`, `VISION_API_URL`, `VISION_API_KEY`, `VISION_API_KEY_HEADER`

## Frontend

- `REACT_APP_API_URL` (default: `/api`)

## Build Metadata (Recommended)

- `APP_VERSION`: semantic version shown in UI and health response (example: `1.6.2`).
- `GIT_SHA`: short git commit hash appended as build metadata (example: `2c9a862`).
- `BUILD_DATE`: UTC build timestamp (example: `2026-02-17T06:00:00Z`).

Metadata source of truth:

- `app-meta.json` in repo root
- Sync command: `node scripts/sync-app-meta.js`

These are optional in `.env`; you can also pass them inline on deploy.

## Included But Currently Not Used By Backend Code

Present in `env.example` for future extension:

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`

## Validation Tip

Before startup:

```bash
docker compose --env-file .env config >/dev/null
```

If Compose warns a required variable is unset, fix `.env` before `up`.
