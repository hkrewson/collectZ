# Pre-2.10.0 Go/No-Go Preflight

- Version: `2.10.0`
- Date: `2026-04-06`
- Commit: local working tree
- Scope: `2.10.0 — Multi-Format Ownership Model (Movies/Games)`

## Gate Results

- Version sync: PASS
- Release notes: PASS
- Lockfile policy: PASS
- Runtime dependency policy: PASS
- Release feed snapshot: PASS
- Help > Releases serving: PASS
- Observability release evidence: PASS
- App shell budget: PASS (time-bound exception)
- Init parity: PASS
- Migration rehearsal: PASS
- Backend unit tests: PASS
- OpenAPI validation: PASS
- Compose smoke: PASS
- RBAC regression: PASS
- Browser regression: PASS
- Homelab edition boundary: PASS
- Platform edition boundary: PASS
- Dependency scan: PASS
- Secret scan: BLOCKED
- Image security and SBOM: BLOCKED

## Local Verification Notes

- Version metadata is synchronized to `2.10.0` across:
  - root [`app-meta.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/app-meta.json)
  - [`backend/app-meta.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/backend/app-meta.json)
  - [`frontend/src/app-meta.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/frontend/src/app-meta.json)
  - [`backend/package.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/backend/package.json)
  - [`frontend/package.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/frontend/package.json)
  - both package-lock files
- Lockfile policy is satisfied:
  - [`backend/package-lock.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/backend/package-lock.json)
  - [`frontend/package-lock.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/frontend/package-lock.json)
  - both remain `lockfileVersion=3` with package version `2.10.0`
- Runtime dependency policy passed locally:
  - no `container_name` entries in compose files
  - no Redis services or Redis env drift
  - no forbidden backend `redis` / `connect-redis` dependency
- Release note [`docs/releases/v2.10.0.md`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/docs/releases/v2.10.0.md) exists and includes the required release and security-triage sections.
- The in-app release snapshot was regenerated with `node backend/scripts/export-release-feed.js`, and the latest release in [`backend/release-feed.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/backend/release-feed.json) is `2.10.0`.
- The running stack serves `Help > Releases` successfully:
  - authenticated `/api/support/releases` returned latest tag `2.10.0`
  - release count in the running feed response: `5`
- Running stack is back on `APP_EDITION=platform` with release-shaped env:
  - inside the backend container: `APP_VERSION=2.10.0 APP_EDITION=platform SESSION_COOKIE_SECURE=true TRUST_PROXY=1 PLAYWRIGHT_E2E_BYPASS_TOKEN=collectz-playwright`
- Compose smoke checks passed against the live stack:
  - [`curl http://127.0.0.1:3000/api/health`](http://127.0.0.1:3000/api/health) returned `status=ok` with `version=2.10.0`
  - response headers included:
    - `Strict-Transport-Security`
    - `X-Content-Type-Options`
    - `X-Frame-Options`
  - `/api/auth/csrf-token` issued a cookie with:
    - `Secure`
    - `SameSite=Strict`
  - unauthenticated `/api/auth/me` returned `401`
  - backend session cookie options inside the running container are:
    - `httpOnly=true`
    - `secure=true`
    - `sameSite=strict`
  - API integration smoke passed
- Observability release evidence is current for `2.10.0` in [`artifacts/observability-evidence/observability-release-evidence.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/observability-evidence/observability-release-evidence.json) with summary:
  - `total=9`
  - `passed=9`
  - `failed=0`
  - `blocked=0`
- Init parity and migration rehearsal both passed and were refreshed:
  - [`artifacts/init-parity-evidence/init-parity-evidence.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/init-parity-evidence/init-parity-evidence.json)
  - [`artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json)
  - init parity mismatch count: `0`
  - migration rehearsal upgraded baseline `57 -> 58` and rollback counts matched pre-upgrade state
- Backend unit tests passed in a Dockerized Node 20 environment:
  - `All unit tests passed (125)`
- OpenAPI validation passed in the running backend container.
- RBAC regression passed against the running stack with `BASE_URL=http://frontend:3000`.
- Browser regression passed locally against the running stack after mirroring the CI secure-cookie and bypass-token shape:
  - `18 passed`
  - `4 skipped`
  - `0 failed`
  - release closeout also fixed a real support-session regression in [`backend/middleware/scopeAccess.js`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/backend/middleware/scopeAccess.js) so `support_admin` users can switch tenant libraries during an active approved support session without incorrectly tripping `library_membership_required`
- Edition-boundary gates passed:
  - homelab edition boundary smoke passed against a live `APP_EDITION=homelab` backend
  - platform edition boundary smoke passed against a live `APP_EDITION=platform` backend
- Dependency scan passed in Dockerized Node 20, matching the workflow toolchain:
  - [`artifacts/dependency-audit/backend-audit.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/dependency-audit/backend-audit.json): `low=0 moderate=0 high=0 critical=0`
  - [`artifacts/dependency-audit/frontend-audit.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/artifacts/dependency-audit/frontend-audit.json): `low=0 moderate=0 high=0 critical=0`
- `frontend/src/App.js` is still above the hard modularity budget and continues to use the time-bound exception in [`.ci/exceptions/app-shell-budget.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/.ci/exceptions/app-shell-budget.json):
  - `max_lines=650`
  - `target_milestone=3.0.0 — Frontend Build Modernization (CRA to Vite)`
- Direct GitHub Actions inspection through the requested `gh-fix-ci` workflow is blocked in this shell because `gh` is not installed, so direct workflow-run log inspection still requires CI itself or a maintainer shell with GitHub CLI available.

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

- Secret scan is still pending because `gitleaks` is not installed in this shell.
- Image security and SBOM generation are still pending because `trivy`, `syft`, and `cyclonedx-npm` are not installed in this shell.
- Direct GitHub Actions inspection via the requested `gh-fix-ci` workflow is still pending because `gh` is not installed in this shell.

## Recommendation

GO for `v2.10.0` release use from the repo/runtime side; final tagged publication still depends on the CI-only secret-scan and image/SBOM gates above.
