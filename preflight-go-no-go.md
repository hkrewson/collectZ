# 2.7.1 Local Preflight Go/No-Go

## Status
- Local preflight status: GO pending hosted CI confirmation
- Version under test: 2.7.1
- Date: 2026-03-19

## Gates run locally
- Secret scan (gitleaks via Docker image): PASS
- Dependency audit (backend): PASS at release threshold (`critical=0`); `low=1`, `high=1`
- Dependency audit (frontend): PASS at release threshold (`critical=0`); `low=0`, `high=0`
- Backend unit tests: PASS
- OpenAPI validation: PASS
- init.sql parity: PASS
- Migration rehearsal: PASS
- Compose smoke on rebuilt live 2.7.1 stack: PASS
- RBAC regression: PASS
- Admin space control smoke: PASS
- Tenancy platform-boundary smoke: PASS
- Backend image critical Trivy scan: PASS
- Frontend image critical Trivy scan: PASS
- Backend SBOM generation: PASS
- Frontend SBOM generation: PASS

## Evidence artifacts
- `artifacts/dependency-audit/backend-audit.json`
- `artifacts/dependency-audit/frontend-audit.json`
- `artifacts/init-parity-evidence.json`
- `artifacts/migration-rehearsal-evidence.json`
- `artifacts/sbom-cyclonedx/backend-sbom.cdx.json`
- `artifacts/sbom-cyclonedx/frontend-sbom.cdx.json`
- `preflight-go-no-go.md`
- `docs/releases/v2.7.1.md`

## Notes
- Docker-first compose smoke evidence was taken from the rebuilt live `2.7.1` stack and in-network curl checks against `http://frontend:3000`.
- Backend dependency-audit triage is reflected in `docs/releases/v2.7.1.md`; the remaining `high` is transitive via `@aws-sdk/xml-builder -> fast-xml-parser` and stays below the current blocking threshold because `critical=0`.
- Frontend production dependency audit is clean; the remaining `nth-check` follow-up is confined to the legacy CRA/SVGO build chain and is not part of the shipped runtime.
- This patch release narrows scope to release-gate repairs, low-risk dependency overrides, and runtime recovery from the detached frontend service.
