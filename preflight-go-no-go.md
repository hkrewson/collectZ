# Pre-2.9.8 Go/No-Go Preflight

- Version: `2.9.8`
- Date: `2026-04-05`
- Commit: local working tree
- Scope: `2.9.8 — Runtime and Operations Hardening`

## Gate Results

- Version sync: PASS
- Release notes: PASS
- Release feed snapshot: PASS
- Observability release evidence: PASS
- Init parity: PASS
- Migration rehearsal: PASS
- Backend unit tests: PASS
- OpenAPI validation: PASS
- RBAC regression: PASS
- Homelab edition boundary: PASS
- Platform edition boundary: PASS
- Compose smoke: PASS
- Browser regression: BLOCKED
- Dependency scan: BLOCKED
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
  - unauthenticated `/api/auth/me` returned `401`
- Observability release evidence is current for `2.9.8` in [`artifacts/observability-evidence/observability-release-evidence.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/observability-evidence/observability-release-evidence.json) with summary:
  - `total=9`
  - `passed=9`
  - `failed=0`
  - `blocked=0`
- Init parity and migration rehearsal both passed and refreshed:
  - [`artifacts/init-parity-evidence/init-parity-evidence.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/init-parity-evidence/init-parity-evidence.json)
  - [`artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json)
- Backend unit tests passed locally with `node backend/scripts/unit-tests.js`.
- OpenAPI validation passed with `npm --prefix backend run test:openapi`.
- RBAC regression passed against the running stack when executed with `BASE_URL=http://frontend:3000`.
- Platform edition-boundary smoke passed against a live `APP_EDITION=platform` backend container.
- Homelab edition-boundary smoke passed after rebuilding the backend live with `APP_EDITION=homelab`, and the backend was then restored to `APP_EDITION=platform`.
- Browser regression is not fully cleared locally yet:
  - one full local run reached `15 passed`, `4 skipped`, and surfaced two real selector-drift failures in [`tests/playwright/specs/integrations.browser.spec.js`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/tests/playwright/specs/integrations.browser.spec.js) and [`tests/playwright/specs/support-docs.capture.spec.js`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/tests/playwright/specs/support-docs.capture.spec.js)
  - those selectors were updated and both spec files now pass `node --check`
  - the focused rerun was then blocked by a local Chromium launch failure: `bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer ... Permission denied (1100)`
- Dependency audit is not fully cleared locally yet:
  - frontend audit artifact exists at [`artifacts/dependency-audit/frontend-audit.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/dependency-audit/frontend-audit.json) and reports `low=3`, `moderate=17`, `high=5`, `critical=0`
  - backend audit refresh was blocked by local network resolution to npm registry and currently produced an error artifact at [`artifacts/dependency-audit/backend-audit.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/dependency-audit/backend-audit.json)
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
- [`preflight-go-no-go.md`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/preflight-go-no-go.md)

## Blocking Criteria

Release publication is NO-GO if any required gate fails or any required artifact is missing.

## Exceptions

- Browser regression remains pending CI confirmation because local Chromium launches are intermittently blocked by the desktop Mach port permission failure.
- Dependency audit, secret scan, image security scan, and SBOM generation remain pending CI or an unrestricted maintainer shell.

## Recommendation

GO for CI preflight on `v2.9.8`; final release publication remains pending the blocked CI-only gates above.
