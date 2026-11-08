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
  - `GIT_SHA` is injected as short SHA for cleaner UI display where surfaced.

Result: nav/version + `/api/health` build fields come from image build, not operator runtime commands.

Supported Node baseline:

- The supported Node 24 maintenance-LTS baseline is `24.22.1` or a later Node 24 security patch. Production images use the exact patch tag `node:24.22.1-alpine`; update the Dockerfiles, operational helper images, CI selectors, `.nvmrc`, and engine range together when the baseline advances.
- The frontend uses Node 24.22.1 only for dependency installation and the Vite build; the shipped frontend runtime remains static assets served by Nginx.
- Backend `package.json` declares `>=24.22.1 <25` so unsupported local installs fail visibly instead of silently drifting from CI and production.
- Node runtime advisories are separate from npm package audits. Keep the Node base image and CI runtime on a fixed upstream security release even when `npm audit` reports no package vulnerabilities.
- Backend development uses Node's built-in `--watch` mode so a separate file watcher package is not needed in the backend dependency tree.
- Release `dependency-scan` audits production dependencies with `--omit=dev`; it does not cover development/build tools such as Vite or source-map consumers. When a tooling advisory is reported, run full `npm audit` in both application directories and review Dependabot's lockfile path in addition to the release gate.

Migration safety in CI:

- `migration-check` runs schema migrations against ephemeral Postgres.
- Validates the OpenAPI baseline contract with `npm run test:openapi`.
- Runs `init.sql` parity check against migration-built schema to detect bootstrap drift.
- Verifies critical columns expected by current release.
- Runs restore-based rollback rehearsal (`npm run test:migration-rehearsal`).
- The generic rehearsal selects the newest real upgrade boundary: it uses the lesser of the reviewed identity-certification marker and `latest migration - 1`. This prevents a current certification marker from collapsing the rehearsal into an invalid `latest -> latest` run. Identity certification still evaluates its reviewed marker independently and may correctly report `not_required` when no newer identity-sensitive migration exists.
- Evaluates migrations after the selected baseline for identity-sensitive tables, roles, ownership, encryption, or audit storage. When matched, `npm run test:identity-upgrade-certification` creates a runtime-only synthetic identity and proves password, concurrent-session, workspace/library-role, personal API credential, and service credential behavior through the real HTTP server before upgrade, after the production migration runner, and after snapshot restore.
- Uploads artifact `migration-rehearsal-evidence.json` for generic schema and row-count traceability.
- Uploads artifact `identity-upgrade-certification-evidence.json`, whose `status` is `passed` when certification was required or `not_required` with the evaluated migration versions when it was not. Exact identity and credential continuity is compared with runtime-keyed fingerprints held only in memory; the written artifact contains identifiers, presence flags, and policy results, and rejects fingerprints, usable fixture credentials, and credential-bearing commands.
- Starts the migration-check PostgreSQL container inside the job with a runtime-generated masked credential, exports the connection URLs only through the job environment, and removes the container in an `always()` cleanup step.
- `backend/config/identity-upgrade-policies.json` is the reviewed source for the last certified migration version, default preservation behavior, and exact migration-version overrides that intentionally revoke existing sessions or API credentials or clear active scope. CI evaluates every migration newer than `certifiedThroughVersion`, so a release containing multiple migrations cannot hide an earlier identity-sensitive change behind an unrelated final migration. Advance the marker only after that range has passed certification and becomes the established release baseline.
- Uploads artifact `init-parity-evidence.json` for bootstrap parity traceability.
- Certifies the non-owner runtime database role (`npm run test:runtime-role-certification`, since `3.24.14`): in a scratch database it migrates a legacy owner-created install to `latest - 1`, runs the same migrate-and-provision path as the Compose `migrate` service, and proves with raw SQL that the runtime role can perform application DML and read legacy rows but cannot create, alter, drop, truncate, index, or disable triggers on tables, write `schema_migrations`, create schemas/roles/databases, grant itself `BYPASSRLS`, or assume the owner role; that future migration-created tables inherit runtime grants; and that the startup guard rejects the owner credential and owner-role members. The role name and password are ephemeral and are never written to the uploaded `runtime-role-certification-evidence.json`. A failure here means a grant, default privilege, or guard check regressed; inspect the failing `label` in the artifact.

Compose-backed jobs (`compose-smoke`, `rbac-regression`, `browser-regression`, and the hosted Core `runtime-smoke`) generate both `DB_PASSWORD` and `DB_RUNTIME_PASSWORD`. The stack starts the one-shot `migrate` service with the owner credential first; the backend receives only the runtime credential under `DATABASE_RUNTIME_ROLE_POLICY=enforce`, so in-container smoke scripts run with DML-only privileges. If the backend never becomes healthy, check `docker compose logs migrate` before the backend logs.

Security and release gates in CI:

- `rbac-regression` also runs the machine-checked workspace ownership contract, the production-shaped workspace authorization certification smoke, the sensitive-operation inventory contract, and live recent-reauthentication non-mutation proof. The ownership snapshot must classify every table and route declaration and certify maintained job/provider/search/export/audit paths; the authorization smoke proves anonymous, read-only, sibling-workspace, identifier-tampering, provider, and durable-job denial. The sensitive-operation checks prove safe credential status readback plus CSRF, stale-session, sibling-session, non-session credential, password-proof, credential mutation, support-delegation, and audit-retention behavior without retaining fixture secrets.
- `rbac-regression` runs the external identity registry certification under the provisioned non-owner runtime role and uploads `external-identity-certification-evidence`. Release preflight requires migration `127`, at least 15 passed checks, and no failed UUID, provider-instance, cross-workspace, lifecycle, credential-separation, append-only-event, or unscoped-read assertion.

- Local CI/CD release gate (`npm run release:local-gate`) for pre-push maintainer validation before public CI runs.
- CodeQL code scanning for JavaScript/TypeScript source analysis.
- Secret leak scan (gitleaks) against repository history and current tree.
- Dependency vulnerability scan (`npm audit`) on backend/frontend dependencies under Node 24.22.1 so each committed lockfile is validated against the supported runtime baseline; this does not scan Node's bundled OpenSSL, c-ares, certificate store, or Undici components.
- Dependency Watch runs weekly, on demand, and for pull requests that change root/backend/frontend dependency manifests, lockfiles, or the workflow itself. It clean-installs root tooling plus both applications under Node 24.22.1, reports root tooling and production dependency audit counts, and uploads partial summaries/artifacts even when one ecosystem's clean install fails.
- RBAC regression gate (API-level ownership/role/scope allow-deny checks), including the live Postgres auth-token abuse smoke for reset/invitation/verification replay, concurrency, CSRF non-mutation, session revocation, invalid token states, enumeration resistance, audit allowlist/value-leakage checks, focused reset rate limiting, and the dedicated invitation mutation limiter.
- Playwright browser-regression gate against the live compose stack for key auth/admin shell flows.
- Hosted `runtime-smoke` job (`core-runtime-smoke`) with a `Core runtime` step that verifies shared surfaces still work while control-plane-only APIs stay unmounted. A failure is investigated from that job's Compose logs and failing step output.
- Required control-plane runtime certification with `docker compose -p collectz-private --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 backend node scripts/platform-edition-boundary-smoke.js` against the canonical platform stack and its Cairn companion. It verifies invite-based registration plus tenant/admin control-plane surfaces remain mounted. This private-edition contract is release-closeout evidence rather than a job in the public workflow; preserve the local command output and relevant container logs on failure.
- The hosted Core check and canonical-stack control-plane check are complementary. Neither substitutes for the other, and both must be explicitly accounted for before release closeout.
- OpenAPI contract validation gate for key auth/admin/media endpoints.
- Container image vulnerability scan (Trivy) for backend/frontend images.
- SBOM generation (CycloneDX JSON) for backend/frontend images, uploaded as CI artifacts.
- Release preflight runs on `main` release-candidate pushes before auto-tagging and on explicit `v*` tag pushes; it generates a go/no-go checklist artifact and fails if required evidence artifacts are missing.
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
- CodeQL is an advisory source-analysis layer at introduction; it does not replace dependency scanning, gitleaks, Trivy, SBOM, RBAC, browser regression, or runtime-smoke gates.
- Maintain `docs/wiki/49-Dependency-PR-and-CI-Security-Coverage.md` as the coverage map for dependency PR disposition and CI security posture.
- Use `npm run release:local-gate:full` when local CodeQL, secret scan, runtime smoke, browser regression, and image/SBOM readiness should be attempted before push.

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

Release preflight runs additionally block on missing required preflight evidence artifacts before `main` auto-tagging or explicit tagged release confirmation.

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
- `DB_RUNTIME_PASSWORD`
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
- Run `npm run release:local-gate` before push, or install the opt-in hook with `npm run release:install-hooks`.
- Keep `.github/workflows/docker-publish.yml` running the browser-regression gate before publish/release jobs.
- Keep `.github/workflows/docker-publish.yml` running the hosted Core `runtime-smoke` gate before publish/release jobs, and keep canonical-stack control-plane runtime certification in the release closeout so both edition contracts remain enforced at their available boundaries.
- Keep `.github/workflows/browser-captures.yml` as a separate manual screenshot-generation path for support/docs visuals instead of folding capture mode into the blocking regression gate.
- Do not add Playwright browsers or the root test harness as dependencies of the shipped backend/frontend runtime images.

## Saved-view RLS pilot certification (3.26.0)

`migration-check` runs `test:saved-view-rls-certification` using its masked PostgreSQL admin URL and uploads `saved-view-rls-evidence/saved-view-rls-evidence.json`. The check uses scratch databases and ephemeral runtime/broker roles, verifies raw-SQL CRUD isolation and scope spoof denial, blocks parent-delete cascade bypass, certifies migration/backfill and fail-closed ambiguous ownership, and restores a database snapshot. Runtime SQL alone cannot mint the transaction grants. Failure labels identify the denied operation or migration/restore assumption; the artifact contains only labels, booleans, and the migration number, never fixture credentials. Hosted preflight requires a passed artifact with at least 15 checks.

The `rbac-regression` job also runs `test:saved-view-rls-http-smoke` against its running backend. It proves authenticated CRUD, committed readback, peer/sibling-workspace denial, and request scope-spoof denial. Local equivalents use the existing canonical backend container and scratch databases inside the existing PostgreSQL service; no parallel Compose project or volume is needed.
