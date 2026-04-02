# Pre-2.9.0 Go/No-Go Preflight

- Version: `2.9.0`
- Date: `2026-04-01`
- Commit: local working tree
- Scope: `2.9.0 — Assisted Capture and Barcode Completion`

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

- Version metadata has been bumped to `2.9.0` in root, backend, frontend, and package manifests.
- Release note [`docs/releases/v2.9.0.md`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/docs/releases/v2.9.0.md) exists and includes the required release and security-triage sections.
- Running stack rebuilt with `APP_VERSION=2.9.0`; live `/api/health` reports `version=2.9.0`, `frontend=2.9.0`, `backend=2.9.0`.
- Compose smoke checks passed against the running stack:
  - frontend container healthy
  - CSRF endpoint returned `200`
  - CSRF cookie issued with `SameSite=Strict`
  - security headers present, including `Strict-Transport-Security`, `X-Content-Type-Options`, and `X-Frame-Options`
  - unauthenticated `/api/auth/me` returned `401`
- Production dependency audit artifacts are clean for backend and frontend at `low=0`, `moderate=0`, `high=0`, `critical=0`.
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

GO for `v2.9.0`.
