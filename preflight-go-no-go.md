# 2.6.1 Local Preflight Go/No-Go

## Status
- Local preflight status: GO pending CI confirmation
- Version under test: 2.6.1
- Date: 2026-03-14

## Gates run locally
- Secret scan (gitleaks via Docker image): PASS
- Dependency audit (backend): PASS at release threshold (critical=0); high=3
- Dependency audit (frontend): PASS at release threshold (critical=0); high=0
- Backend unit tests: PASS
- OpenAPI validation: PASS
- init.sql parity: PASS
- Migration rehearsal: PASS
- Compose smoke on rebuilt live 2.6.1 stack: PASS
- RBAC regression: PASS
- Cross-type isolation regression: PASS
- Backend image critical Trivy scan: PASS
- Frontend image critical Trivy scan: PASS
- Backend SBOM generation: PASS
- Frontend SBOM generation: PASS

## Evidence artifacts
- `artifacts/dependency-audit/backend-audit.json`
- `artifacts/dependency-audit/frontend-audit.json`
- `backend/artifacts/init-parity-evidence.json`
- `backend/artifacts/migration-rehearsal-evidence.json`
- `artifacts/sbom-cyclonedx/backend-sbom.cdx.json`
- `artifacts/sbom-cyclonedx/frontend-sbom.cdx.json`
- `docs/releases/v2.6.1.md`

## Notes
- Local compose smoke used the rebuilt live stack because the repo compose file binds host port `3000`.
- Dependency-audit triage is reflected in `docs/releases/v2.6.1.md`.
- Remaining backend `high` findings are tracked for remediation in `2.9.1`.
- CI should still be rerun to confirm the hosted workflow passes with the same gates and artifacts.
