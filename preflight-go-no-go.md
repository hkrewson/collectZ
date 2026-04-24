# Local Release Go/No-Go Preflight

- Version: `3.3.2`
- Generated: `2026-04-24T03:18:53.277Z`
- Base URL: `http://localhost:3000`

## Gate Results

- Version metadata sync: PASS — all manifests aligned on 3.3.2
- Release note presence: PASS — docs/releases/v3.3.2.md
- Backend dependency audit: BLOCKED — request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org
- Frontend dependency audit: BLOCKED — request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org
- Migration evidence presence: PASS — init parity and migration rehearsal evidence are present
- Observability release evidence: PASS — observability artifact present for 3.3.2 with 9/9 checks passed
- Compose smoke basics: BLOCKED — in-stack /api/health probe failed: permission denied while trying to connect to the docker API at unix:///Users/hamlin/.docker/run/docker.sock
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

- `docs/releases/v3.3.2.md`: present
- Security triage markers: present

## Blocking Criteria

Release is NO-GO if any required local gate fails, any required artifact is missing, or CI-only blocking gates later fail in CI.

## CI-Only Follow-Through

- `secret-scan`
- `browser-regression` when it is not run locally or the local browser environment is blocked
- `image-security-and-sbom`
- any stricter CI `compose-smoke` conditions not exercised by this local helper
