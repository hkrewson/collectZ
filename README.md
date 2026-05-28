# collectZ

collectZ is a self-hosted collection management app capable of tracking media, books, comics, games, art, events, loans, wishlists, and more.


## What It Does

- **Dashboard:** first-screen summary for recent activity, provider health, upcoming events, failed syncs, missing covers, missing identifiers, and other items that need attention.
- **Library:** browse, search, add, edit, rate, and review movies, TV, books, comics, games, audio, art, collectibles, and related objects.
- **Loans:** keep track of items loaned to friend, send email reminder, and track returns.
- **Imports and syncs:** CSV, Plex, Kavita, scanner/barcode intake, and provider-specific enrichment paths.
- **Provider integrations:** TMDB, Google Books, UPC/barcode lookup, Metron/comics, Plex, Kavita, optional valuation providers, SMTP, storage, metrics, and structured log export.
- **Events:** convention/event planning, schedules, and event-linked purchases.
- **Wishlist:** wanted items, statuses, priority, target price.

## Deployment Model

Use the included docker compose file and an env file with prebuilt images from GHCR.

## Quick Start

1. Clone the repo and enter the directory.
2. Copy the example environment:

   ```bash
   cp env.example .env
   ```

3. Edit `.env` and set at minimum:

   ```text
   DB_PASSWORD=
   SESSION_SECRET=
   INTEGRATION_ENCRYPTION_KEY=
   ```

   Use strong unique values. `openssl rand -hex 32` is a good starting point for secrets.

4. Pull and start:

   ```bash
   docker compose --env-file .env pull
   docker compose --env-file .env up -d
   ```

6. Open:

   ```text
   http://localhost:3000
   ```

Optional setup helper:

```bash
./setup.sh
```

The helper checks prerequisites, creates `.env` when needed, can generate missing secrets, and can start collectZ for you. It does not modify application source files or print secret values.

## First-Run Auth

- On a new install, the first successful registration becomes the admin.
- Additional accounts can be invited or managed from the app after initial setup.

## Core Configuration

Required for reliable operation:

- `DB_PASSWORD`
- `SESSION_SECRET`
- `INTEGRATION_ENCRYPTION_KEY`

Runtime and reverse-proxy settings:

- `SESSION_COOKIE_SECURE=true` for HTTPS deployments; use `false` only for direct HTTP local testing
- `TRUST_PROXY=1` when running behind one trusted reverse proxy hop
- `ALLOWED_ORIGINS` set to the browser origins that should be allowed

Useful optional configuration:

- `STORAGE_PROVIDER=local` for filesystem uploads
- `STORAGE_PROVIDER=s3` plus `S3_*` values for S3-compatible object storage
- `TMDB_API_KEY`, `COMICS_API_KEY`, `BARCODE_API_KEY`, `PLEX_API_KEY`, and other provider keys as needed
- `SMTP_*` values for invites, password reset, and email flows

See [Deployment Environment Reference](docs/wiki/48-Deployment-Environment-Reference.md) for operator-safe optional settings. The older [Environment Variables](docs/wiki/02-Environment-Variables.md) page is a broader maintainer reference.

## Integrations

Most provider settings can be bootstrapped from `.env` and then managed from the app's Integrations area.

Common integrations:

- TMDB for movie/TV metadata and artwork
- Google Books for ISBN/book enrichment
- Barcode/UPC lookup for scanner and web capture flows
- Metron/comics for comic metadata
- Plex for import, reconciliation, watch state, ratings, webhooks, and now-playing
- Kavita for hosted books/comics/magazines
- SMTP for user and support workflows
- Local or S3-compatible storage for uploaded images
- Optional metrics and structured log export for operations

## Import and Capture Workflows

Use the app's `Import` and `Capture Inbox` areas for intake work.

Supported paths include:

- Plex library import and sync
- Kavita library import and sync
- Generic CSV import
- Delicious Library CSV import
- Barcode/ISBN scanner API
- Web Capture Inbox with photo, OCR, barcode/ISBN, lookup matches, batch scanning, and review filters

Imports and syncs run through backend-owned APIs. The web UI and scanner clients are clients of those backend contracts, not separate sources of truth.

## Updating

Update the image tag if desired, then run:

```bash
docker compose --env-file .env pull
docker compose --env-file .env up -d
```

Check the running version:

```bash
curl http://localhost:3000/api/health
```

Release notes are also available in the app under Help/Releases.

## Developer Notes

Canonical version metadata lives in:

- `app-meta.json`
- `backend/app-meta.json`
- `frontend/src/app-meta.json`
- `backend/package.json`
- `frontend/package.json`

After changing the root metadata, sync mirrors with:

```bash
node scripts/sync-app-meta.js
```

Regenerate the in-app release feed with:

```bash
node backend/scripts/export-release-feed.js
```

For source-built local development, use the local override:

```bash
APP_VERSION=$(node -p "require('./app-meta.json').version") \
docker compose --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml up -d --build
```

## Documentation

The `docs/wiki/` directory is currently a maintainer knowledge base, not a polished public wiki. It contains a mix of user/operator docs, engineering runbooks, roadmap history, release policy, and integration contracts.

Good public/operator entry points:

- [Configuration and Use](docs/wiki/01-Configuration-and-Use.md)
- [Deployment Environment Reference](docs/wiki/48-Deployment-Environment-Reference.md)
- [Docker Compose Setup](docs/wiki/03-Docker-Compose-Setup.md)
- [CI/CD and Registry Deploy](docs/wiki/10-CI-CD-and-Registry-Deploy.md)
- [Backup and Restore](docs/wiki/08-Backup-and-Restore.md)
- [Kavita Integration Setup](docs/wiki/41-Kavita-Integration-Setup.md)
- [Personal Access Tokens](docs/wiki/25-Personal-Access-Tokens.md)

Internal/planning-heavy docs such as the roadmap, backlog, delivery policy, release gates, and integration contracts are useful to maintainers but are not written as end-user documentation yet.

## Troubleshooting

If backend startup says the integration encryption key is missing, set `INTEGRATION_ENCRYPTION_KEY` in `.env`, then restart:

```bash
docker compose --env-file .env up -d backend
```

If Integrations shows a decryption warning, the saved key was encrypted with older key material. Re-enter or clear the affected key so it is encrypted with the current `INTEGRATION_ENCRYPTION_KEY`.

If login fails after changing compose or `.env`, verify the running backend container values, not only the file:

```bash
docker inspect collectz-backend-1 \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^(DATABASE_URL|NODE_ENV|SESSION_COOKIE_SECURE|TRUST_PROXY|ALLOWED_ORIGINS|APP_VERSION)='
```
