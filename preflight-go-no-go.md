# Local Release Go/No-Go Preflight

- Version: `3.31.4`
- Generated: `2026-11-28T03:49:58.958Z`
- Base URL: `http://localhost:3000`

## Gate Results

- Version metadata sync: PASS — all manifests aligned on 3.31.4
- Release note presence: PASS — docs/releases/v3.31.4.md
- Backend dependency audit: PASS — low=0 moderate=0 high=0 critical=0
- Frontend dependency audit: PASS — low=0 moderate=0 high=0 critical=0
- Migration authority and rehearsal evidence: PASS — migration chain certified as fresh-install and restored-runtime authority through 150
- Identity upgrade certification evidence: PASS — passed for migration chain through 150
- Saved-view RLS certification evidence: PASS — passed 17 live isolation and restore checks
- External identity registry certification evidence: PASS — passed 21 UUID, scope, lifecycle, and RLS checks through migration 150
- Runtime role certification evidence: PASS — passed 32/32 checks with provisioning contract v1 and migration-built runtime authority through migration 150
- Control-plane migration-built runtime authority evidence: PASS — passed 5/5 startup and platform-boundary checks through migration 150
- Observability release evidence: FAIL — observability artifact missing, stale, or contains failed/blocked checks
- Compose smoke basics: BLOCKED — in-stack /api/health probe failed: getaddrinfo ENOTFOUND frontend
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
- `backend/artifacts/control-plane-runtime-authority-evidence.json`: present
- `backend/artifacts/external-identity-certification/external-identity-certification.json`: present
- `artifacts/observability-evidence/observability-release-evidence.json`: present
- `preflight-go-no-go.md`: will be written by this helper

## Release Note

- `docs/releases/v3.31.4.md`: present
- Security triage markers: present

## Blocking Criteria

Release is NO-GO if any required local gate fails, any required artifact is missing, or CI-only blocking gates later fail in CI.

## CI-Only Follow-Through

- `secret-scan`
- `browser-regression` when it is not run locally or the local browser environment is blocked
- `image-security-and-sbom`
- any stricter CI `compose-smoke` conditions not exercised by this local helper
