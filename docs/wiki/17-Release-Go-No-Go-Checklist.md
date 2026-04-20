# Release Go/No-Go Checklist

This checklist is enforced for tagged release runs (`v*`) via CI preflight.

## Required Gates

All of the following must pass:

1. Secret scan.
2. Dependency vulnerability scan.
3. Migration check (including init parity + rehearsal evidence).
4. Compose smoke check.
5. RBAC regression check.
6. Browser regression check.
7. Homelab edition boundary smoke check.
8. Platform edition boundary smoke check.
9. Image security scan + SBOM generation.

## Release Closeout Must-Do

Before we call a release ready, run a CI-shaped release check against the same gates enforced by `.github/workflows/docker-publish.yml`.

Minimum closeout expectation:

1. Confirm version metadata is synchronized across root, backend, and frontend manifests.
2. Confirm the matching release note exists and includes the required security triage markers.
3. Regenerate the in-app release snapshot consumed by `Help > Releases` and confirm the latest semver appears in that feed.
4. Run backend unit tests.
5. Generate a local preflight report with `npm --prefix backend run test:release-preflight-local` so the current dependency-audit artifacts and `preflight-go-no-go.md` reflect the live local release evidence.
6. Run init parity / migration rehearsal checks in an environment with database access.
7. Run production dependency audit checks for backend and frontend.
8. Generate observability release evidence with `npm --prefix backend run test:observability-evidence` and review the resulting artifact for passed persistence, collector-path, non-blocking failure, backend-restore, and final-health checks.
9. Confirm the remaining CI-only gates are green, especially gitleaks, compose smoke, RBAC, Trivy, and SBOM generation.
10. Confirm the Playwright browser-regression gate is green and its artifacts are available when failures occur.
11. Confirm the homelab edition boundary gate is green so the live `homelab` stack still exposes only the shared mounted surfaces and keeps platform-only APIs unmounted.
12. Confirm the platform edition boundary gate is green so the live `platform` stack still preserves invite-based registration and the tenant/admin control-plane APIs that must remain mounted.
13. When any of `rbac-regression`, `browser-regression`, `homelab-edition-boundary`, or `platform-edition-boundary` fail, inspect the exact failing artifact or step log and repair the concrete runtime/spec assumption locally before calling the release push-ready.

If any of these are skipped locally because the shell environment is restricted, the release stays pending until CI or an unrestricted maintainer shell confirms them.

## Required Evidence Artifacts

Tagged runs must produce:

- `dependency-audit/backend-audit.json`
- `dependency-audit/frontend-audit.json`
- `init-parity-evidence/init-parity-evidence.json`
- `migration-rehearsal-evidence/migration-rehearsal-evidence.json`
- `sbom-cyclonedx/backend-sbom.cdx.json`
- `sbom-cyclonedx/frontend-sbom.cdx.json`
- `preflight-go-no-go.md`

When the browser gate fails, the release investigation should also preserve the uploaded Playwright artifact bundle (`artifacts/playwright/...`) long enough to inspect:

- failing `error-context.md`
- failing `trace.zip`
- screenshots/videos when present

Release-shaped closeout should also generate:

- `observability-evidence/observability-release-evidence.json`

This artifact is release-facing evidence first. It is not yet a tagged-CI-required artifact until the observability rehearsals are promoted into workflow automation.

If any required artifact is missing, release is **NO-GO**.

## Blocking Rule

Release publication is blocked when:

- any mandatory gate fails, or
- any mandatory evidence artifact is missing.

## Exception Process

Exceptions are not implicit. Follow:

- `docs/wiki/14-Engineering-Delivery-Policy.md` -> `Exception Process`

Any exception must include:

- documented risk,
- compensating controls,
- expiration/remediation target.
