# Pre-2.8.5 Go/No-Go Preflight

- Version: `2.8.5`
- Date: `2026-03-29`
- Commit: local working tree
- Scope: `2.8.5 — Navigation Shell Cleanup and Integrations Surface Simplification`

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
- Runtime dependency policy: PASS

## Local Verification Notes

- Version metadata was synchronized across root, backend, frontend, mirrored `app-meta` files, package manifests, and both lockfiles to `2.8.5`.
- Release note [`docs/releases/v2.8.5.md`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/docs/releases/v2.8.5.md) exists and includes the required release and security-triage sections.
- Backend unit tests passed via:
  - `node backend/scripts/unit-tests.js`
- Frontend production build passed in Docker via:
  - `docker run --rm -v "$PWD/frontend":/app -w /app node:20-alpine sh -lc "npm run build"`
- OpenAPI validation passed in the running backend container.
- Integration smoke passed against the running stack on the internal Docker network.
- RBAC regression passed against the running local stack.
- Cross-type isolation passed against the running local stack from inside the backend container using the existing local release-test admin account:
  - `release-cross-type-admin-1774734793@example.com`
- Production dependency audits passed with clean counts for backend and frontend:
  - `low=0`
  - `moderate=0`
  - `high=0`
  - `critical=0`
- Init parity passed against the live compose-network Postgres and wrote fresh evidence to:
  - `artifacts/init-parity-evidence/init-parity-evidence.json`
- Migration rehearsal passed with baseline `45` and latest `46`, and wrote fresh evidence to:
  - `artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json`
- Compose smoke passed against the live stack:
  - `/api/health` returned `2.8.5`
  - required security headers were present
  - CSRF cookie was issued with `Secure` and `SameSite=Strict`
  - session cookie options were `HttpOnly`, `Secure`, `SameSite=Strict`
  - unauthenticated `/api/auth/me` returned `401`
- Gitleaks returned no findings and refreshed SARIF evidence:
  - `artifacts/gitleaks-results.sarif`
- Trivy critical image scans passed for:
  - `mediavault-backend:latest`
  - `mediavault-frontend:latest`
- CycloneDX SBOM artifacts were regenerated locally for backend and frontend images:
  - `artifacts/sbom-cyclonedx/backend-sbom.cdx.json`
  - `artifacts/sbom-cyclonedx/frontend-sbom.cdx.json`
- Runtime dependency policy passed:
  - no `container_name`
  - no Redis services or Redis env vars in compose/env docs
  - no forbidden backend Redis dependencies

## Local Tooling Notes

- The first init-parity and migration-rehearsal attempts failed because the commands incorrectly passed `INIT_PARITY_ADMIN_URL` / `MIGRATION_REHEARSAL_ADMIN_URL` as `http://frontend:3000`. Those script variables are Postgres admin connection overrides, not app URLs. Rerunning both gates with the live `DATABASE_URL` as the source of truth resolved the issue cleanly.
- The release closeout also caught a real metadata-sync miss before gate execution:
  - both lockfiles still reported `2.8.4`
  - the lockfile versions were corrected before the release gates proceeded

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

GO for commit/tag preparation for `v2.8.5`, subject to final maintainer review of the working tree and any last visual QA you want before tagging.
