# Pre-2.8.0 Go/No-Go Preflight

- Version: `2.8.0`
- Date: `2026-03-28`
- Commit: local working tree
- Scope: `2.8.0 — UI Refinement Sprint (Cross-Device Consistency)`

## Gate Results

- Secret scan: PASS
- Dependency scan: PASS
- Migration check: PASS
- Compose smoke: PASS
- RBAC regression: PASS
- Image security and SBOM: PASS

## Local Verification Notes

- Version metadata was synchronized across root, backend, frontend, and mirrored app-meta files.
- Release note `docs/releases/v2.8.0.md` exists and includes the required release and security-triage sections.
- Backend unit tests passed in a Node 20 Docker runner mounted to the repo.
- OpenAPI validation passed in a Node 20 Docker runner mounted to the repo.
- Runtime dependency policy check passed locally (no forbidden `container_name`, Redis service/env drift, or backend Redis deps).
- Init parity and migration rehearsal passed against the local compose Postgres on the `collectz_internal` network.
- Compose smoke passed using the running local stack and one-off containers on the compose network:
  - `/api/health` returned `2.8.0`
  - security headers present
  - CSRF cookie issued with `Secure` and `SameSite=Strict`
  - session cookie options verified as `HttpOnly`, `Secure`, `SameSite=Strict`
  - unauthenticated `/api/auth/me` returned `401`
  - backend integration smoke passed
- RBAC regression passed against the running local stack.
- Cross-type isolation passed against the running local stack using a temporary seeded local admin account for test bootstrap.
- Trivy critical image scans passed for local images:
  - `mediavault-backend:latest`
  - `mediavault-frontend:latest`
- CycloneDX SBOM artifacts were regenerated locally for backend and frontend images.

## Evidence Artifacts

- `artifacts/dependency-audit/backend-audit.json`
- `artifacts/dependency-audit/frontend-audit.json`
- `artifacts/init-parity-evidence/init-parity-evidence.json`
- `artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json`
- `artifacts/sbom-cyclonedx/backend-sbom.cdx.json`
- `artifacts/sbom-cyclonedx/frontend-sbom.cdx.json`
- `preflight-go-no-go.md`

## Blocking Criteria

Release is NO-GO if any required gate fails or any required artifact is missing.

## Exceptions

- None.

## Recommendation

GO for commit/tag preparation, subject to final maintainer review of the working tree and any desired browser QA sweep before tagging `v2.8.0`.
