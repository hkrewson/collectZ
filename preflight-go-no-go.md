# Pre-2.9.4 Go/No-Go Preflight

- Version: `2.9.4`
- Date: `2026-04-03`
- Commit: local working tree
- Scope: `2.9.4 — Playwright Browser Regression Foundations`

## Gate Results

- Version sync: PASS
- Release notes: PASS
- Release feed snapshot: PASS
- Secret scan: PASS
- Dependency scan: PASS
- Init parity: PASS
- Migration rehearsal: PASS
- Backend unit tests: PASS
- OpenAPI validation: PASS
- Browser regression: PASS
- RBAC regression: PASS
- Compose smoke: PASS
- Runtime dependency policy: PASS
- Image security and SBOM: PASS

## Local Verification Notes

- Version metadata is synchronized to `2.9.4` across:
  - root [`app-meta.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/app-meta.json)
  - [`backend/app-meta.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/backend/app-meta.json)
  - [`frontend/src/app-meta.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/frontend/src/app-meta.json)
  - [`backend/package.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/backend/package.json)
  - [`frontend/package.json`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/frontend/package.json)
  - both package-lock files
- Release note [`docs/releases/v2.9.4.md`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/docs/releases/v2.9.4.md) exists and includes the required release and security-triage sections.
- The in-app release snapshot was regenerated with `node backend/scripts/export-release-feed.js`, and the running backend release feed resolves `2.9.4` as the newest Help > Releases entry.
- Running stack rebuilt with `APP_VERSION=2.9.4` and `PLAYWRIGHT_E2E_BYPASS_TOKEN=collectz-playwright`; live `/api/health` reports `version=2.9.4`, `frontend=2.9.4`, `backend=2.9.4`.
- Compose smoke checks passed against the running stack:
  - backend healthy
  - frontend healthy
  - CSRF endpoint returned `200`
  - CSRF cookie issued with `SameSite=Strict`
  - security headers present, including `Strict-Transport-Security`, `X-Content-Type-Options`, and `X-Frame-Options`
  - unauthenticated `/api/auth/me` returned `401`
- Playwright browser regression is green locally at `10 passed`.
- RBAC regression passed against the running stack when executed with `BASE_URL=http://frontend:3000`.
- Production dependency audit artifacts are clean for backend and frontend at `low=0`, `moderate=0`, `high=0`, `critical=0`.
- Init parity, migration rehearsal, secret scan, critical image scans, and CycloneDX SBOM generation all completed successfully.
- Runtime dependency policy check remains clean:
  - no `redis` service in compose
  - no `REDIS_URL` or `REDIS_PASSWORD` runtime drift in the enforced policy surfaces
  - no backend `redis` or `connect-redis` dependency

## Evidence Artifacts

- `artifacts/dependency-audit/backend-audit.json`
- `artifacts/dependency-audit/frontend-audit.json`
- `artifacts/init-parity-evidence/init-parity-evidence.json`
- `artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json`
- `artifacts/sbom-cyclonedx/backend-sbom.cdx.json`
- `artifacts/sbom-cyclonedx/frontend-sbom.cdx.json`
- `artifacts/gitleaks-results.sarif`
- `preflight-go-no-go.md`

## Blocking Criteria

Release is NO-GO if any required gate fails or any required artifact is missing.

## Exceptions

- None.

## Recommendation

GO for `v2.9.4`.
