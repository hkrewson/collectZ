# Pre-2.9.2 Go/No-Go Preflight

- Version: `2.9.2`
- Date: `2026-04-02`
- Commit: local working tree
- Scope: `2.9.2 — Explicit Support Request, Consent, and Session Approval`

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

- Version metadata has been bumped to `2.9.2` in root, backend, frontend, package manifests, and lockfiles.
- Release note [`docs/releases/v2.9.2.md`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/docs/releases/v2.9.2.md) exists and includes the required release and security-triage sections.
- The in-app release snapshot was regenerated with `node backend/scripts/export-release-feed.js` and the running backend release feed now resolves `2.9.2` as the newest entry.
- Running stack rebuilt with `APP_VERSION=2.9.2`; live `/api/health` reports `version=2.9.2`, `frontend=2.9.2`, `backend=2.9.2`.
- Compose smoke checks passed against the running stack:
  - backend healthy
  - frontend healthy
  - CSRF endpoint returned `200`
  - CSRF cookie issued with `SameSite=Strict`
  - security headers present, including `Strict-Transport-Security`, `X-Content-Type-Options`, and `X-Frame-Options`
  - unauthenticated `/api/auth/me` returned `401`
- Production dependency audit artifacts are clean for backend and frontend at `low=0`, `moderate=0`, `high=0`, `critical=0`.
- Init parity initially failed due to support bootstrap drift; the release was corrected by aligning migrations and `init.sql` with support-request migrations `51`, `52`, and trigger parity `53`, then rerunning parity successfully.
- Init parity, migration rehearsal, RBAC regression, cross-type isolation, secret scan, critical image scans, and CycloneDX SBOM generation all completed successfully.

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

GO for `v2.9.2`.
