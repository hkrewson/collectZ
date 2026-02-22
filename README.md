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

- `1.8.0`

## Quick Start (Local Docker)

1. Clone repo and enter directory.
2. Copy env file:
   - `cp env.example .env`
3. Edit `.env` and set at minimum:
   - `DB_PASSWORD`
   - `REDIS_PASSWORD`
   - `SESSION_SECRET`
   - `TMDB_API_KEY` (recommended for enrichment)
   - `INTEGRATION_ENCRYPTION_KEY` (recommended for encrypted integration keys)
4. Build and start:
   - `docker compose --env-file .env up -d --build`
5. Open:
   - `http://localhost:3000`

## First-Run Auth Behavior

- If there are no users, the first successful registration becomes admin.
- After that, invite-based registration is enforced.
- Admin can manage members and invitations from the Admin section.

## Core Environment Variables

Required for reliable operation:

- `DB_PASSWORD`
- `REDIS_PASSWORD`
- `SESSION_SECRET`

Strongly recommended:

- `TMDB_API_KEY`
- `INTEGRATION_ENCRYPTION_KEY`
- `ALLOWED_ORIGINS`

See `env.example` and docs in `docs/wiki/` for full configuration details.

## Import Workflows

Use the `Import` section in the left navigation:

- **Plex**: imports from configured Plex integration (admin-managed)
- **Generic CSV**: import from collectZ-friendly columns
- **Delicious CSV**: imports movie rows from Delicious export CSV

After CSV imports, use **Download Audit CSV** to get per-row results (`created`, `updated`, `skipped`, `error`).

## Production / Registry Deploy

If using prebuilt images from GHCR:

1. Configure `.env` and `docker-compose.registry.yml`
2. Set your tag (example):
   - `IMAGE_TAG=1.8.0`
3. Deploy:
   - `docker compose -f docker-compose.registry.yml --env-file .env pull`
   - `docker compose -f docker-compose.registry.yml --env-file .env up -d`

## Updating

Local source build:

- `docker compose --env-file .env up -d --build`

Registry deploy:

- `docker compose -f docker-compose.registry.yml --env-file .env pull`
- `docker compose -f docker-compose.registry.yml --env-file .env up -d`

## Notes

- Health checks are included for db/backend/frontend services.
- Activity log captures operational and admin events.
- Movie import dedupe primarily matches by TMDB ID, then title/year heuristics.
