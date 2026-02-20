# Versioning and Build Metadata

This project uses **Semantic Versioning** with Docker build metadata.

## Policy

- Baseline: `1.0.0` = first revision that supported login + add media.
- `MAJOR` (`X.0.0`): breaking changes.
- `MINOR` (`1.X.0`): new features.
- `PATCH` (`1.6.X`): fixes/refinements.

Current project version: `1.6.5-r1`.

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

At build/deploy time, append git metadata as build info:

- Display format: `v<semver>+<git_sha>`
- Example: `v1.6.5-r1+2c9a862`

Build metadata values:

- `APP_VERSION` (SemVer, e.g. `1.6.5-r1`)
- `GIT_SHA` (short commit hash)
- `BUILD_DATE` (UTC timestamp)

## Build Command

Use this command for local or server deploys:

```bash
APP_VERSION=1.6.5-r1 \
GIT_SHA=$(git rev-parse --short HEAD) \
BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
docker compose --env-file .env up -d --build
```

## Where Version Appears

- Frontend nav panel (sidebar footer): `v<semver>+<sha>`
- Backend health endpoints:
  - `/health`
  - `/api/health`

## Release Bump Checklist

1. Update `app-meta.json` version.
2. Run `node scripts/sync-app-meta.js`.
3. Commit the version bump.
4. Build/deploy with `APP_VERSION`, `GIT_SHA`, and `BUILD_DATE` (or rely on CI build args).
5. Confirm version in sidebar and `/api/health`.
