# CI/CD and Registry Deploy (Homelab-Friendly)

This project now supports a simple runtime deploy flow using prebuilt images.

## Goal

Homelab users should not need to build images locally.

Expected operator flow:

1. Start from the generated public `docker-compose.yml` and adjust env names/values if needed.
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
  - `latest` (default release channel)
- Release channel meaning:
  - Exact semver tags such as `3.4.110` are immutable release pins.
  - Moving minor tags such as `3.4` point to the newest published release in that minor line.
  - `latest` points to the default release.
  - `stable` is retained as a compatibility tag for older deployments that explicitly use it.
  - `stable-<major.minor>` points to the promoted stable release for that minor line.
- Injects build metadata during build:
  - backend image: `APP_VERSION` and `GIT_SHA`
  - frontend image: `VITE_APP_VERSION`, `VITE_GIT_SHA`, and `VITE_BUILD_DATE`
  - legacy frontend `REACT_APP_*` names remain compatibility shims only, not the preferred CI contract.
  - `GIT_SHA` is injected as short SHA for cleaner UI display where surfaced.

Result: nav/version + `/api/health` build fields come from image build, not operator runtime commands.

Migration safety in CI:

- `migration-check` runs schema migrations against ephemeral Postgres.
- Validates the OpenAPI baseline contract with `npm run test:openapi`.
- Runs `init.sql` parity check against migration-built schema to detect bootstrap drift.
- Verifies critical columns expected by current release.
- Runs restore-based rollback rehearsal (`npm run test:migration-rehearsal`).
 - Uploads artifact `migration-rehearsal-evidence.json` for release traceability.
 - Uploads artifact `init-parity-evidence.json` for bootstrap parity traceability.

Security and release gates in CI:

- CodeQL code scanning for JavaScript/TypeScript source analysis.
- Secret leak scan (gitleaks) against repository history and current tree.
- Dependency vulnerability scan (`npm audit`) on backend/frontend dependencies.
- RBAC regression gate (API-level ownership/role/scope allow-deny checks).
- Playwright browser-regression gate against the live compose stack for key auth/admin shell flows.
- Homelab edition boundary smoke gate against the default compose stack to verify shared surfaces still work while private-only APIs stay unmounted.
- Private edition boundary smoke gate against an explicitly configured private CI stack to verify invite-based registration plus tenant/admin control-plane surfaces remain mounted while the homelab split tightens elsewhere.
- OpenAPI contract validation gate for key auth/admin/media endpoints.
- Container image vulnerability scan (Trivy) for backend/frontend images.
- SBOM generation (CycloneDX JSON) for backend/frontend images, uploaded as CI artifacts.
- Tagged release preflight (`v*`) generates a go/no-go checklist artifact and fails if required evidence artifacts are missing.
- Runtime topology policy check (blocks undeclared Redis/runtime drift).
- Compose smoke check:
  - stack boots,
  - backend/frontend health checks pass,
  - `/api/health` version matches release version,
  - security headers (`x-content-type-options`, `x-frame-options`, `strict-transport-security`) are present,
  - CSRF/session cookies are issued with secure attributes (`Secure`, `SameSite=Strict`, and `HttpOnly` for session),
  - unauthenticated `/api/auth/me` returns `401`.

Source code scanning:

- `.github/workflows/codeql.yml` runs CodeQL for JavaScript/TypeScript on pushes, pull requests, a weekly schedule, and manual dispatch.
- CodeQL is an advisory source-analysis layer at introduction; it does not replace dependency scanning, gitleaks, Trivy, SBOM, RBAC, browser regression, or edition-boundary gates.
- Maintain `docs/wiki/49-Dependency-PR-and-CI-Security-Coverage.md` as the coverage map for dependency PR disposition and CI security posture.

Playwright packaging boundary:

- The root-level Playwright package is tracked in git as test infrastructure and installed in CI for browser-regression jobs.
- It is not part of the production runtime images.
- Saved Playwright auth/session bootstrap state must stay outside uploaded CI artifact paths.
- CI should use per-run random browser-regression bypass credentials, not fixed shared token strings.
- Runtime containers are still built only from:
  - `backend/package*.json` via `backend/Dockerfile`
  - `frontend/package*.json` via `frontend/Dockerfile`
- Browser tests run alongside the compose stack, not inside the shipped app images.

Default blocking threshold:

- Any detected committed secret blocks CI.
- `critical` vulnerabilities block CI.
- `high` findings are triaged and tracked for remediation.

Tagged release runs additionally block on missing required preflight evidence artifacts.

Observability release evidence:

- Local/release-shaped closeout should run:
  - `npm --prefix backend run test:observability-evidence`
- That writes:
  - `artifacts/observability-evidence/observability-release-evidence.json`
- The current intent is release evidence first:
  - persistence/recreate rehearsals run automatically there,
  - supported collector-path smokes and intentional bad-collector drills now run automatically there,
  - backend restore and final stack health are also captured there,
  - and this should not be treated as an every-PR blocking gate by default.

## Homelab Deploy Using Registry Images

1. Prepare `.env`:

```bash
cp env.example .env
```

2. Set required secrets in `.env`:

- `DB_PASSWORD`
- `SESSION_SECRET`
- `INTEGRATION_ENCRYPTION_KEY`

For optional deployment settings, use `docs/wiki/48-Deployment-Environment-Reference.md`. Keep `env.example` limited to the small startup surface.

3. Deploy:

```bash
docker compose --env-file .env pull
docker compose --env-file .env up -d
```

## Upgrade Process (Homelab)

```bash
# update repo files

docker compose --env-file .env pull
docker compose --env-file .env up -d
```

## Maintainer Release Process

1. Update `app-meta.json` version.
2. Run `node scripts/sync-app-meta.js` to sync backend/frontend package versions.
3. Run `node backend/scripts/export-release-feed.js` so the in-app `Help > Releases` snapshot includes the new semver.
4. Run `npm --prefix backend run test:release-preflight-local` to generate local dependency-audit artifacts and `preflight-go-no-go.md` before the tagged release handoff.
5. Commit and push.
6. CI builds and publishes images with embedded build metadata.
7. Optionally create git tag `vX.Y.Z` (or pre-release like `v1.6.5-r1`).

## Release Cadence and Stable Promotion

- `latest` is published at least weekly when `main` is green, typically as the Sunday release train.
- Additional `latest` releases may be cut during the week for security fixes, important runtime fixes, or completed feature slices.
- `stable` is promoted manually from an already-published exact release after at least seven days of clean maintainer homelab use and no known blocker.
- Stable promotion is handled by `.github/workflows/promote-stable.yml`. It verifies the git tag, release note, successful release workflow, and backend/frontend exact-version images before retagging those images as `stable` and `stable-<major.minor>`.
- Stable promotion retags existing image digests; it does not rebuild images.

Browser-regression expectation:

- Maintain the root Playwright manifest and lockfile in git.
- Keep `.github/workflows/docker-publish.yml` running the browser-regression gate before publish/release jobs.
- Keep `.github/workflows/docker-publish.yml` running the homelab-edition-boundary gate before publish/release jobs so the public runtime boundary is enforced as a first-class contract.
- Keep `.github/workflows/docker-publish.yml` running the private edition-boundary gate before publish/release jobs in private CI so the private control plane is proven to remain intact while homelab boundaries evolve.
- Keep `.github/workflows/browser-captures.yml` as a separate manual screenshot-generation path for support/docs visuals instead of folding capture mode into the blocking regression gate.
- Do not add Playwright browsers or the root test harness as dependencies of the shipped backend/frontend runtime images.
