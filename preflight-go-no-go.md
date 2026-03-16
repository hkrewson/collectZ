# 2.7.0 Local Preflight Go/No-Go

## Status
- Local preflight status: GO pending CI confirmation
- Version under test: 2.7.0
- Date: 2026-03-15

## Gates run locally
- Secret scan (gitleaks via Docker image): PASS
- Dependency audit (backend): PASS at release threshold (`critical=0`); `low=2`, `high=0`
- Dependency audit (frontend): PASS at release threshold (`critical=0`); `low=0`, `high=0`
- Backend unit tests: PASS
- OpenAPI validation: PASS
- init.sql parity: PASS
- Migration rehearsal: PASS
- Compose smoke on rebuilt live 2.7.0 stack: PASS
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
- `docs/releases/v2.7.0.md`

## Notes
- Local compose smoke used the rebuilt live stack because the repo compose file binds host port `3000`.
- Dependency-audit triage is reflected in `docs/releases/v2.7.0.md`.
- Backend dependency audit still includes two low findings in `fast-xml-parser` / `@aws-sdk/xml-builder`; no moderate, high, or critical findings were present locally.
- Existing-install tenancy behavior has been validated on the upgraded live dataset, but a restore rehearsal from a real public `2.3.0` backup remains pending.
- CI should still be rerun to confirm the hosted workflow passes with the same gates and artifacts.
