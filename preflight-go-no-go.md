# 2.7.5 Local Preflight Go/No-Go

## Status
- Local preflight status: GO pending hosted CI confirmation
- Version under test: 2.7.5
- Date: 2026-03-20

## Gates run locally
- Secret scan (gitleaks via Docker image): PASS
- Dependency audit (backend): PASS at release threshold (`critical=0`); `low=0`, `moderate=0`, `high=0`
- Dependency audit (frontend): PASS at release threshold (`critical=0`); `low=0`, `moderate=0`, `high=0`
- Backend unit tests: PASS
- OpenAPI validation: PASS
- init.sql parity: PASS
- Migration rehearsal: PASS
- Compose smoke on rebuilt live 2.7.5 stack: PASS
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
- `docs/releases/v2.7.5.md`

## Notes
- Docker-first compose smoke evidence was taken from the rebuilt live `2.7.5` stack and in-network curl checks against `http://frontend:3000`.
- This patch release targets the remaining clearly isolated low-risk dependency PR item: the direct frontend `postcss` update.
- Remaining development-only advisories are concentrated in the legacy CRA toolchain and are reflected in [docs/releases/v2.7.5.md](/Users/hamlin/Development/GitHub/hkrewson/collectZ/docs/releases/v2.7.5.md) rather than treated as production/runtime blockers.
