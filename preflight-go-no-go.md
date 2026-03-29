# Pre-2.8.2 Go/No-Go Preflight

- Version: `2.8.2`
- Date: `2026-03-28`
- Commit: local working tree
- Scope: `2.8.2 — Admin Settings Cleanup and Baked-In Feature Flag Retirement`

## Gate Results

- Version sync: PASS
- Release notes: PASS
- Secret scan: PASS
- Dependency scan: PASS
- Init parity: PASS
- Migration rehearsal: PASS
- Backend unit tests: PASS
- OpenAPI validation: PASS
- Frontend production build: PASS
- Integration smoke: PASS
- RBAC regression: PASS
- Cross-type isolation: PASS
- Compose smoke: PASS
- Image security and SBOM: PASS

## Local Verification Notes

- Version metadata was synchronized across root, backend, frontend, mirrored `app-meta` files, and both lockfiles to `2.8.2`.
- Release note [`docs/releases/v2.8.2.md`](docs/releases/v2.8.2.md) exists and includes the required release and security-triage sections.
- Backend unit tests passed via:
  - `node backend/scripts/unit-tests.js`
- Frontend production build passed in Docker via:
  - `docker run --rm -v "$PWD/frontend":/app -w /app node:20-alpine sh -lc "npm run build"`
- OpenAPI validation passed in the running backend container.
- Integration smoke passed against the running stack on the internal Docker network.
- RBAC regression passed against the running local stack from inside the backend container.
- Cross-type isolation passed against the running local stack from inside the backend container using the existing local release-test admin account:
  - `release-cross-type-admin-1774734793@example.com`
- Production dependency audits passed with clean counts for backend and frontend:
  - `low=0`
  - `moderate=0`
  - `high=0`
  - `critical=0`
- Init parity passed in a mounted Docker runner using explicit `INIT_SQL_PATH=/workspace/init.sql` and wrote fresh evidence to:
  - `artifacts/init-parity-evidence/init-parity-evidence.json`
- Migration rehearsal passed in a mounted Docker runner and wrote fresh evidence to:
  - `artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json`
- Compose smoke passed against the live `collectz_internal` network:
  - `/api/health` returned `2.8.2`
  - required security headers were present
  - CSRF cookie was issued with `Secure` and `SameSite=Strict`
  - session cookie options were `HttpOnly`, `Secure`, `SameSite=Strict`
  - unauthenticated `/api/auth/me` returned `401`
- Gitleaks returned no findings and wrote SARIF evidence to:
  - `artifacts/gitleaks-results.sarif`
- Trivy critical image scans passed for:
  - `mediavault-backend:latest`
  - `mediavault-frontend:latest`
- CycloneDX SBOM artifacts were regenerated locally for backend and frontend images:
  - `artifacts/sbom-cyclonedx/backend-sbom.cdx.json`
  - `artifacts/sbom-cyclonedx/frontend-sbom.cdx.json`

## Local Tooling Notes

- Host-local `npm audit` hit an npm client bug (`Cannot read property ... of undefined`) for both backend and frontend, so the required production audit gate was re-run successfully inside Docker and the resulting JSON artifacts are the source of truth.
- Host-local `node` execution of the RBAC and cross-type scripts hit a local `fetch failed` networking issue, so both gates were re-run successfully inside the running backend container against `http://frontend:3000`.
- The mounted Docker init-parity and migration-rehearsal commands emitted a `.env` parse warning while sourcing shell variables locally, but both commands still completed successfully and wrote fresh passing evidence artifacts.

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

GO for commit/tag preparation for `v2.8.2`, subject to final maintainer review of the working tree and any last visual QA you want before tagging.
