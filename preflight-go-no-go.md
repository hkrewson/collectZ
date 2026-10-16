# Local Release Go/No-Go Preflight

- Version: `3.25.0`
- Generated: `2026-10-16T21:46:08.339Z`
- Base URL: `http://localhost:3201`

## Gate Results

- Version metadata sync: PASS — all manifests aligned on 3.25.0
- Release note presence: PASS — docs/releases/v3.25.0.md
- Backend dependency audit: PASS — low=0 moderate=0 high=0 critical=0
- Frontend dependency audit: PASS — low=0 moderate=0 high=0 critical=0
- Migration evidence presence: PASS — init parity and migration rehearsal evidence are present
- Identity upgrade certification evidence: PASS — passed for migration chain through 122
- Runtime role certification evidence: PASS — passed 30/30 checks for migration chain through 122
- Observability release evidence: FAIL — observability artifact missing, stale, or contains failed/blocked checks
- Compose smoke basics: BLOCKED — current local stack is not running with CI secure-cookie settings (SESSION_COOKIE_SECURE=false, NODE_ENV=development)
- Secret scan: BLOCKED — CI-only gitleaks gate
- Browser regression: BLOCKED — not run by this local preflight helper
- Image security and SBOM: BLOCKED — CI-only Trivy/SBOM gate

## Evidence Artifacts

- `artifacts/dependency-audit/backend-audit.json`: present
- `artifacts/dependency-audit/frontend-audit.json`: present
- `backend/artifacts/init-parity-evidence.json`: present
- `backend/artifacts/migration-rehearsal-evidence.json`: present
- `backend/artifacts/identity-upgrade-certification-evidence.json`: present
- `backend/artifacts/runtime-role-certification-evidence.json`: present
- `artifacts/observability-evidence/observability-release-evidence.json`: present
- `preflight-go-no-go.md`: will be written by this helper

## Release Note

- `docs/releases/v3.25.0.md`: present
- Security triage markers: missing

## Blocking Criteria

Release is NO-GO if any required local gate fails, any required artifact is missing, or CI-only blocking gates later fail in CI.

## CI-Only Follow-Through

- `secret-scan`
- `browser-regression` when it is not run locally or the local browser environment is blocked
- `image-security-and-sbom`
- any stricter CI `compose-smoke` conditions not exercised by this local helper
