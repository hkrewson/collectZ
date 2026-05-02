# Local Release Go/No-Go Preflight

- Version: `3.4.62`
- Generated: `2026-05-02T17:39:15.885Z`
- Base URL: `http://localhost:3000`

## Gate Results

- Version metadata sync: PASS — all manifests aligned on 3.4.62
- Release note presence: PASS — docs/releases/v3.4.62.md
- Backend dependency audit: PASS — low=0 moderate=2 high=0 critical=0
- Frontend dependency audit: PASS — low=0 moderate=0 high=0 critical=0
- Migration evidence presence: PASS — init parity and migration rehearsal evidence are present
- Observability release evidence: PASS — observability artifact present for 3.4.62 with 9/9 checks passed
- Compose smoke basics: BLOCKED — current local stack is not running with CI secure-cookie settings (SESSION_COOKIE_SECURE=false, NODE_ENV=development)
- Secret scan: BLOCKED — CI-only gitleaks gate
- Browser regression: BLOCKED — not run by this local preflight helper
- Image security and SBOM: BLOCKED — CI-only Trivy/SBOM gate

## Evidence Artifacts

- `artifacts/dependency-audit/backend-audit.json`: present
- `artifacts/dependency-audit/frontend-audit.json`: present
- `artifacts/init-parity-evidence/init-parity-evidence.json`: present
- `artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json`: present
- `artifacts/observability-evidence/observability-release-evidence.json`: present
- `preflight-go-no-go.md`: will be written by this helper

## Release Note

- `docs/releases/v3.4.62.md`: present
- Security triage markers: present

## Blocking Criteria

Release is NO-GO if any required local gate fails, any required artifact is missing, or CI-only blocking gates later fail in CI.

## CI-Only Follow-Through

- `secret-scan`
- `browser-regression` when it is not run locally or the local browser environment is blocked
- `image-security-and-sbom`
- any stricter CI `compose-smoke` conditions not exercised by this local helper
