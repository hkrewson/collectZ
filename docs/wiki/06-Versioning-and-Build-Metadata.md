# Versioning and Build Metadata

This project uses **Semantic Versioning** with Docker build metadata.

## Policy

- Baseline: `1.0.0` = first revision that supported login + add media.
- `MAJOR` (`X.0.0`): breaking changes.
- `MINOR` (`1.X.0`): new features.
- `PATCH` (`1.6.X`): fixes/refinements.

Current project version: `1.6.4`.

## Source of Truth

- Keep SemVer in both package files:
  - `frontend/package.json`
  - `backend/package.json`
- Keep these two version values aligned for each release.

## Build Identifier

At build/deploy time, append git metadata as build info:

- Display format: `v<semver>+<git_sha>`
- Example: `v1.6.4+2c9a862`

Build metadata values:

- `APP_VERSION` (SemVer, e.g. `1.6.4`)
- `GIT_SHA` (short commit hash)
- `BUILD_DATE` (UTC timestamp)

## Build Command

Use this command for local or server deploys:

```bash
APP_VERSION=1.6.4 \
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

1. Update both `frontend/package.json` and `backend/package.json`.
2. Commit the version bump.
3. Build/deploy with `APP_VERSION`, `GIT_SHA`, and `BUILD_DATE`.
4. Confirm version in sidebar and `/api/health`.
