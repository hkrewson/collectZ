# collectZ

collectZ is a self-hosted media collection manager currently focused on movies.
It is designed for homelab-friendly deployment with Docker, secure user auth, and admin-managed integrations.

## What It Does

- Secure login/register with cookie-based sessions
- Role-aware admin area (members, invitations, activity, integrations)
- Library browsing with search, card/list view, rating, and detail drawer
- Add/edit/delete media entries
- TMDB enrichment for metadata and artwork
- Plex import with dedupe + variant handling
- CSV import support:
  - Generic CSV import
  - Delicious Library CSV import (movie rows only)
- Import audit reports (downloadable per-row CSV)

## Current Version

- `3.4.20`

## App Metadata

- Canonical metadata lives in `app-meta.json`.
- Mirror files used at runtime:
  - `backend/app-meta.json`
  - `frontend/src/app-meta.json`
- After editing root metadata, sync mirrors with:
  - `node scripts/sync-app-meta.js`

## Quick Start (Local Docker)

1. Clone repo and enter directory.
2. Copy env file:
   - `cp env.example .env`
3. Edit `.env` and set at minimum:
   - `DB_PASSWORD`
   - `SESSION_SECRET`
   - `INTEGRATION_ENCRYPTION_KEY` (required in production)
   - `SESSION_COOKIE_SECURE=true` (required in production)
   - `TMDB_API_KEY` (recommended for enrichment)
   - production hardening: use strong non-placeholder secrets (minimum 32 chars)
4. Pull and start:
   - `docker compose --env-file .env pull`
   - `docker compose --env-file .env up -d`
5. Open:
   - `http://localhost:3000`

Optional preflight helper:

- `./setup.sh`
- Performs prerequisite + `.env` checks and prints deploy commands.
- It does not modify application source files.

## First-Run Auth Behavior

- If there are no users, the first successful registration becomes admin.
- Additional local users can register after the first admin.
- Admins can manage shared settings and integrations from the Admin section.

## Core Environment Variables

Required for reliable operation:

- `DB_PASSWORD`
- `SESSION_SECRET`
- `INTEGRATION_ENCRYPTION_KEY` (required in production)
- `SESSION_COOKIE_SECURE=true` (required in production)

Strongly recommended:

- `TMDB_API_KEY`
- `ALLOWED_ORIGINS`
- `TRUST_PROXY` (`1` behind one reverse proxy hop; `false` for direct backend access)

Storage selection:

- `STORAGE_PROVIDER=local` (default) stores uploads on local filesystem (`/uploads`)
- `STORAGE_PROVIDER=s3` stores uploads in S3-compatible object storage (set `S3_*` vars)

See `env.example` and docs in `docs/wiki/` for full configuration details.

Debug levels:

- `DEBUG=0`: normal production behavior (no debug/dev-only workflows)
- `DEBUG=1`: basic diagnostics (expanded import/audit detail)
- `DEBUG=2`: full dev/debug workflows (includes Import Review queue + endpoints/UI)

For frontend debug-gated UI, set the Vite env:

- `VITE_DEBUG=0|1|2`

The public compose defaults to `0`. Legacy `REACT_APP_*` names remain build-time compatibility shims only; use `VITE_*` for new local and CI configuration.

## Import Workflows

Use the `Import` section in the left navigation:

- **Plex**: imports from configured Plex integration (admin-managed)
  - Runs as an async job with progress/status tracking
- **Generic CSV**: import from collectZ-friendly columns
- **Delicious CSV**: imports movie rows from Delicious export CSV

After CSV imports, use **Download Audit CSV** to get per-row results (`created`, `updated`, `skipped`, `error`).

## Production Deploy

The public compose file uses prebuilt images from GHCR:

1. Configure `.env`
2. Set your release channel or exact tag:
  - `IMAGE_TAG=stable` for the recommended homelab release
  - `IMAGE_TAG=latest` for the newest release
  - `IMAGE_TAG=3.4.122` to pin an exact release
3. Deploy:
   - `docker compose --env-file .env pull`
   - `docker compose --env-file .env up -d`

## Updating

- `docker compose --env-file .env pull`
- `docker compose --env-file .env up -d`

## Notes

- Health checks are included for db/backend/frontend services.
- Activity log captures operational and admin events.
- Movie import dedupe primarily matches by TMDB ID, then title/year heuristics.

## Troubleshooting

- If backend startup fails in production with:
  - `INTEGRATION_ENCRYPTION_KEY must be set in production`
- Set `INTEGRATION_ENCRYPTION_KEY` in `.env`, then restart:
  - `docker compose --env-file .env up -d backend`
- If Admin Integrations shows a decryption warning, that key was encrypted with older key material.
  Re-enter/save the affected key (or clear it) so it is re-encrypted with current `INTEGRATION_ENCRYPTION_KEY`.
