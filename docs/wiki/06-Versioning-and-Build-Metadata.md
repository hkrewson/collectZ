# Versioning and Build Metadata

This project uses **Semantic Versioning** with Docker build metadata.

## Policy

- Baseline: `1.0.0` = first revision that supported login + add media.
- `MAJOR` (`X.0.0`): breaking changes.
- `MINOR` (`1.X.0`): new features.
- `PATCH` (`1.6.X`): fixes/refinements.

Current project version: `3.4.0`.

## Source of Truth

- Canonical metadata file: `app-meta.json` at repo root.
- Synced targets:
  - `backend/package.json`
  - `frontend/package.json`
  - `backend/app-meta.json`
  - `frontend/src/app-meta.json`
- Sync command:

```bash
node scripts/sync-app-meta.js
```

## Build Identifier

Version source:

- `APP_VERSION` (optional env override)
- `app-meta.json` (canonical fallback)

## Build Command

Use this command for local or server deploys:

```bash
APP_VERSION=3.4.0 \
docker compose --env-file .env up -d --build
```

## Where Version Appears

- Frontend nav panel (sidebar footer): `v<semver>`
- Backend health endpoints:
  - `/health`
  - `/api/health`

## Release Bump Checklist

1. Update `app-meta.json` version.
2. Run `node scripts/sync-app-meta.js`.
3. Run `node backend/scripts/export-release-feed.js` so `Help > Releases` includes the new release note.
4. Commit the version bump.
5. Build/deploy with `APP_VERSION` (or rely on `app-meta.json` fallback).
6. Confirm version in sidebar, `/api/health`, and the in-app `Help > Releases` feed.
