# Pre-2.9.8 Go/No-Go Preflight

- Version: `2.9.8`
- Date: `2026-04-05`
- Commit: local working tree
- Scope: `2.9.8 — Runtime and Operations Hardening`

## Gate Results

- Version sync: PASS
- Release notes: PASS
- Lockfile policy: PASS
- Runtime dependency policy: PASS
- Release feed snapshot: PASS
- Observability release evidence: PASS
- App shell budget: PASS (time-bound exception)
- Init parity: PASS
- Migration rehearsal: PASS
- Backend unit tests: PASS
- OpenAPI validation: PASS
- RBAC regression: PASS
- Homelab edition boundary: PASS
- Platform edition boundary: PASS
- Compose smoke: PASS
- Browser regression: BLOCKED
- Dependency scan: PASS
- Secret scan: BLOCKED
- Image security and SBOM: BLOCKED

## Local Verification Notes

- Version metadata is synchronized to `2.9.8` across:
  - root [`app-meta.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/app-meta.json)
  - [`backend/app-meta.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/backend/app-meta.json)
  - [`frontend/src/app-meta.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/frontend/src/app-meta.json)
  - [`backend/package.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/backend/package.json)
  - [`frontend/package.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/frontend/package.json)
  - both package-lock files
- Lockfile policy is satisfied:
  - root [`package-lock.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/package-lock.json)
  - [`backend/package-lock.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/backend/package-lock.json)
  - [`frontend/package-lock.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/frontend/package-lock.json)
- Runtime dependency policy passed locally:
  - no `container_name` entries in compose files
  - no Redis services or `REDIS_URL` / `REDIS_PASSWORD` runtime env drift in compose or `env.example`
  - no forbidden backend `redis` or `connect-redis` dependency
- Release note [`docs/releases/v2.9.8.md`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/docs/releases/v2.9.8.md) exists and includes the required release and security-triage sections.
- The in-app release snapshot was regenerated with `node backend/scripts/export-release-feed.js`, and the latest release in [`backend/release-feed.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/backend/release-feed.json) is `2.9.8`.
- The protected `Help > Releases` API path was verified against the running stack by authenticating a temporary admin through the live app and confirming `/api/support/releases` returned `v2.9.8`.
- Running stack is back on `APP_EDITION=platform` with `APP_VERSION=2.9.8`; inside the live backend container this reports `APP_VERSION=2.9.8 APP_EDITION=platform`.
- In-stack compose smoke checks passed against the running stack:
  - backend healthy
  - frontend healthy
  - db healthy
  - `/api/health` returned `version=2.9.8`, `frontend=2.9.8`, `backend=2.9.8`, `build=v2.9.8`
  - `/api/auth/csrf-token` returned a CSRF token
  - session cookie options inside the running backend now match CI release expectations with `httpOnly=true`, `secure=true`, `sameSite=strict`
  - CSRF cookie issuance under the CI-style env override includes both `Secure` and `SameSite=Strict`
  - unauthenticated `/api/auth/me` returned `401`
- Observability release evidence is current for `2.9.8` in [`artifacts/observability-evidence/observability-release-evidence.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/observability-evidence/observability-release-evidence.json) with summary:
  - `total=9`
  - `passed=9`
  - `failed=0`
  - `blocked=0`
- `frontend/src/App.js` is currently `631` lines, above the `550` hard budget, and now carries an explicit temporary exception at [`.ci/exceptions/app-shell-budget.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/.ci/exceptions/app-shell-budget.json):
  - `max_lines=650`
  - `expires_on=2026-06-04`
  - `target_milestone=2.9.9 — Observability Endpoint Control Plane`
- Init parity and migration rehearsal both passed and refreshed:
  - [`artifacts/init-parity-evidence/init-parity-evidence.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/init-parity-evidence/init-parity-evidence.json)
  - [`artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json)
- Backend unit tests passed locally with `node backend/scripts/unit-tests.js`.
- OpenAPI validation passed with `npm --prefix backend run test:openapi`.
- RBAC regression passed against the running stack when executed with `BASE_URL=http://frontend:3000`.
- API integration smoke passed against the rebuilt release-style stack with `SESSION_COOKIE_SECURE=true` and `TRUST_PROXY=1`.
- Platform edition-boundary smoke passed against a live `APP_EDITION=platform` backend container.
- Homelab edition-boundary smoke passed after rebuilding the backend live with `APP_EDITION=homelab`, and the backend was then restored to `APP_EDITION=platform`.
- Browser regression is not fully cleared locally yet:
  - one full local run reached `15 passed`, `4 skipped`, and surfaced two real selector-drift failures in [`tests/playwright/specs/integrations.browser.spec.js`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/tests/playwright/specs/integrations.browser.spec.js) and [`tests/playwright/specs/support-docs.capture.spec.js`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/tests/playwright/specs/support-docs.capture.spec.js)
  - those selectors were updated and both spec files now pass `node --check`
  - the Playwright auth helper previously targeted `docker compose --env-file .env` regardless of the CI stack project/env file; it now honors `PLAYWRIGHT_COMPOSE_PROJECT` and `PLAYWRIGHT_COMPOSE_ENV_FILE`, and both browser workflows export those values before invoking Playwright
  - a newer CI artifact then narrowed the remaining failure to one stale Graylog-specific assertion in [`tests/playwright/specs/integrations.browser.spec.js`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/tests/playwright/specs/integrations.browser.spec.js): the spec assumed CI would always render `gelf_udp` and `graylog:12201`, even though [`.env.ci`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/.env.ci) intentionally runs `LOG_EXPORT_BACKEND=off` with `LOG_EXPORT_HOST=127.0.0.1`
  - that assertion now reads `observabilityRuntime.logs` from `/api/admin/settings/integrations` through the authenticated Playwright helper and verifies the UI against the backend's actual runtime diagnostics instead of a hardcoded collector transport
  - the compose-aware auth bootstrap was verified directly against the live Docker stack with both default and explicit `PLAYWRIGHT_COMPOSE_PROJECT=collectz` execution paths
  - the remaining local rerun blocker is now the desktop Chromium launch failure itself: `bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer ... Permission denied (1100)`
- Dependency scan is now locally refreshed and clean:
  - backend `npm ci --no-fund` passed
  - frontend `npm ci --no-fund` passed after refreshing [`frontend/package-lock.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/frontend/package-lock.json)
  - [`artifacts/dependency-audit/backend-audit.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/dependency-audit/backend-audit.json) reports `low=0`, `moderate=0`, `high=0`, `critical=0`
  - [`artifacts/dependency-audit/frontend-audit.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/dependency-audit/frontend-audit.json) reports `low=0`, `moderate=0`, `high=0`, `critical=0`
- Secret scan, image scan, and SBOM generation remain CI-only from this shell state:
  - `gitleaks` not installed locally
  - `trivy` not installed locally
  - `syft` not installed locally
  - `cyclonedx-npm` not installed locally
  - older artifacts still exist under [`artifacts/gitleaks-results.sarif`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/gitleaks-results.sarif) and [`artifacts/sbom-cyclonedx`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/sbom-cyclonedx), but they must be regenerated in CI for this release closeout

## Evidence Artifacts

- [`artifacts/dependency-audit/backend-audit.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/dependency-audit/backend-audit.json)
- [`artifacts/dependency-audit/frontend-audit.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/dependency-audit/frontend-audit.json)
- [`artifacts/init-parity-evidence/init-parity-evidence.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/init-parity-evidence/init-parity-evidence.json)
- [`artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json)
- [`artifacts/observability-evidence/observability-release-evidence.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/observability-evidence/observability-release-evidence.json)
- [`.ci/exceptions/app-shell-budget.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/.ci/exceptions/app-shell-budget.json)
- [`preflight-go-no-go.md`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/preflight-go-no-go.md)

## Blocking Criteria

Release publication is NO-GO if any required gate fails or any required artifact is missing.

## Exceptions

- Browser regression remains pending CI confirmation because local Chromium launches are intermittently blocked by the desktop Mach port permission failure.
- Secret scan, image security scan, and SBOM generation remain pending CI or an unrestricted maintainer shell.

## Recommendation

GO for CI preflight on `v2.9.8`; final release publication remains pending the blocked CI-only gates above.
