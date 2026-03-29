# Pre-2.8.1 Go/No-Go Preflight

- Version: `2.8.1`
- Date: `2026-03-28`
- Commit: local working tree
- Scope: `2.8.1 — Space Creation and Member Onboarding Flow`

## Gate Results

- Secret scan: PASS
- Dependency scan: PASS
- Migration check: PASS
- Compose smoke: PASS
- RBAC regression: PASS
- Image security and SBOM: PASS

## Local Verification Notes

- Version metadata was synchronized across root, backend, frontend, mirrored `app-meta` files, and both lockfiles.
- Release note `docs/releases/v2.8.1.md` exists and includes the required release and security-triage sections.
- Backend unit tests passed.
- OpenAPI validation passed in the running backend container.
- Runtime dependency policy check passed locally:
  - no forbidden `container_name`,
  - no Redis service/env drift,
  - no forbidden backend Redis dependencies.
- Init parity passed in a mounted Docker runner using explicit `INIT_SQL_PATH=/workspace/init.sql` and wrote fresh evidence to:
  - `artifacts/init-parity-evidence/init-parity-evidence.json`
- Migration rehearsal passed in a mounted Docker runner and wrote fresh evidence to:
  - `artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json`
- Production dependency audits passed with clean counts for backend and frontend:
  - `low=0`
  - `moderate=0`
  - `high=0`
  - `critical=0`
- Compose smoke passed against the live `collectz_internal` network:
  - `/api/health` returned `2.8.1`
  - required security headers were present
  - CSRF cookie was issued with `Secure` and `SameSite=Strict`
  - session cookie options were `HttpOnly`, `Secure`, `SameSite=Strict`
  - unauthenticated `/api/auth/me` returned `401`
  - backend integration smoke passed
- RBAC regression passed against the running local stack.
- Cross-type isolation passed against the running local stack using the existing local release-test admin account:
  - `release-cross-type-admin-1774734793@example.com`
- Gitleaks returned no findings and wrote SARIF evidence to:
  - `artifacts/gitleaks-results.sarif`
- Trivy critical image scans passed for:
  - `mediavault-backend:latest`
  - `mediavault-frontend:latest`
- CycloneDX SBOM artifacts were regenerated locally for backend and frontend images:
  - `artifacts/sbom-cyclonedx/backend-sbom.cdx.json`
  - `artifacts/sbom-cyclonedx/frontend-sbom.cdx.json`

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

GO for commit/tag preparation for `v2.8.1`, subject to final maintainer review of the working tree and any last visual QA you want before tagging.
