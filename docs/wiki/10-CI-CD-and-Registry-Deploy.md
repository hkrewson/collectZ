# CI/CD and Registry Deploy (Homelab-Friendly)

This project now supports a simple runtime deploy flow using prebuilt images.

## Goal

Homelab users should not need to build images locally.

Expected operator flow:

1. Start from compose example (`docker-compose.registry.yml`) and adjust env names/values if needed.
2. Copy and modify `.env` from `env.example`.
3. Pull and run containers with `docker compose up -d`.

## GitHub Actions Pipeline

Workflow file:

- `.github/workflows/docker-publish.yml`

Pipeline behavior:

- Reads version from `app-meta.json` and validates it matches:
  - `backend/package.json`
  - `frontend/package.json`
- Fails if any version value is out of sync.
- On tag builds (`v*`), validates tag version equals `app-meta.json` version.
- Builds and pushes images to GHCR:
  - `ghcr.io/<owner>/collectz-backend`
  - `ghcr.io/<owner>/collectz-frontend`
- Tags include:
  - `<semver>` (example `1.6.5-r1`)
  - `<major.minor>` (example `1.6`)
  - `sha-<commit>`
  - `latest` (default branch only)
- Injects build metadata during build:
  - `APP_VERSION` / `REACT_APP_VERSION`
  - `GIT_SHA` / `REACT_APP_GIT_SHA`
  - `BUILD_DATE` / `REACT_APP_BUILD_DATE`
  - `GIT_SHA` is injected as short SHA for cleaner UI display.

Result: nav/version + `/api/health` build fields come from image build, not operator runtime commands.

Migration safety in CI:

- `migration-check` runs schema migrations against ephemeral Postgres.
- Runs `init.sql` parity check against migration-built schema to detect bootstrap drift.
- Verifies critical columns expected by current release.
- Runs restore-based rollback rehearsal (`npm run test:migration-rehearsal`).
 - Uploads artifact `migration-rehearsal-evidence.json` for release traceability.
 - Uploads artifact `init-parity-evidence.json` for bootstrap parity traceability.

Security and release gates in CI:

- Secret leak scan (gitleaks) against repository history and current tree.
- Dependency vulnerability scan (`npm audit`) on backend/frontend dependencies.
- Container image vulnerability scan (Trivy) for backend/frontend images.
- SBOM generation (CycloneDX JSON) for backend/frontend images, uploaded as CI artifacts.
- Runtime topology policy check (blocks undeclared Redis/runtime drift).
- Compose smoke check:
  - stack boots,
  - backend/frontend health checks pass,
  - `/api/health` version matches release version,
  - unauthenticated `/api/auth/me` returns `401`.

Default blocking threshold:

- Any detected committed secret blocks CI.
- `critical` vulnerabilities block CI.
- `high` findings are triaged and tracked for remediation.

## Homelab Deploy Using Registry Images

1. Prepare `.env`:

```bash
cp env.example .env
```

2. Set required secrets in `.env`:

- `DB_PASSWORD`
- `SESSION_SECRET`
- `INTEGRATION_ENCRYPTION_KEY`

3. Optional image source values in `.env`:

- `IMAGE_REGISTRY=ghcr.io`
- `IMAGE_NAMESPACE=hkrewson`
- `IMAGE_TAG=1.6.5-r1`

4. Deploy:

```bash
docker compose --env-file .env -f docker-compose.registry.yml pull
docker compose --env-file .env -f docker-compose.registry.yml up -d
```

## Upgrade Process (Homelab)

```bash
# update repo files
# set IMAGE_TAG in .env to target version

docker compose --env-file .env -f docker-compose.registry.yml pull
docker compose --env-file .env -f docker-compose.registry.yml up -d
```

## Maintainer Release Process

1. Update `app-meta.json` version.
2. Run `node scripts/sync-app-meta.js` to sync backend/frontend package versions.
3. Commit and push.
4. CI builds and publishes images with embedded build metadata.
5. Optionally create git tag `vX.Y.Z` (or pre-release like `v1.6.5-r1`).
