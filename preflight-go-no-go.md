# Pre-2.8.3 Go/No-Go Preflight

- Version: `2.8.3`
- Date: `2026-03-29`
- Commit: local working tree
- Scope: `2.8.3 — Import Review Retirement and Debug Import Diagnostics`

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
- Import Review retirement smoke: PASS
- RBAC regression: PASS
- Cross-type isolation: PASS
- Compose smoke: PASS
- Image security and SBOM: PASS
- Runtime dependency policy: PASS

## Local Verification Notes

- Version metadata was synchronized across root, backend, frontend, mirrored `app-meta` files, and package manifests to `2.8.3`.
- Release note [`docs/releases/v2.8.3.md`](docs/releases/v2.8.3.md) exists and includes the required release and security-triage sections.
- Backend unit tests passed via:
  - `node backend/scripts/unit-tests.js`
- Frontend production build passed in Docker via:
  - `docker run --rm -v "$PWD/frontend":/app -w /app node:20-alpine sh -lc "npm run build"`
- OpenAPI validation passed in the running backend container.
- Integration smoke passed against the running stack on the internal Docker network.
- The dedicated authenticated Import Review retirement smoke passed against the running stack and confirmed the retired authenticated routes now return `404`.
- RBAC regression passed against the running local stack from inside the backend container.
- Cross-type isolation passed against the running local stack from inside the backend container using the existing local release-test admin account:
  - `release-cross-type-admin-1774734793@example.com`
- Production dependency audits passed with clean counts for backend and frontend:
  - `low=0`
  - `moderate=0`
  - `high=0`
  - `critical=0`
- Init parity initially failed and exposed a real `2.8.3` bootstrap drift:
  - `init.sql` still defined the retired `import_match_reviews` table, indexes, trigger, and lacked migration marker `45`
  - the drift was fixed in [`init.sql`](/Users/hamlin/Development/GitHub/hkrewson/collectZ/init.sql)
  - init parity then passed and wrote fresh evidence to:
    - `artifacts/init-parity-evidence/init-parity-evidence.json`
- Migration rehearsal passed with baseline `44` and latest `45`, and wrote fresh evidence to:
  - `artifacts/migration-rehearsal-evidence/migration-rehearsal-evidence.json`
- Compose smoke passed against the live `collectz_internal` network:
  - `/api/health` returned `2.8.3`
  - required security headers were present
  - CSRF cookie was issued with `Secure` and `SameSite=Strict`
  - session cookie options were `HttpOnly`, `Secure`, `SameSite=Strict`
  - unauthenticated `/api/auth/me` returned `401`
- Gitleaks returned no findings and refreshed SARIF evidence:
  - `artifacts/gitleaks-results.sarif`
- Trivy critical image scans passed for:
  - `mediavault-backend:latest`
  - `mediavault-frontend:latest`
- CycloneDX SBOM artifacts were regenerated locally for backend and frontend images:
  - `artifacts/sbom-cyclonedx/backend-sbom.cdx.json`
  - `artifacts/sbom-cyclonedx/frontend-sbom.cdx.json`
- Runtime dependency policy passed:
  - no `container_name`
  - no Redis services or Redis env vars in compose/env docs
  - no forbidden backend Redis dependencies

## Local Tooling Notes

- Host-local `localhost:3000` probes were intermittently flaky during the release check window, so the definitive compose-smoke HTTP evidence was gathered on the internal Docker network via `http://frontend:3000`.
- The initial in-container init-parity attempt used the wrong path for `init.sql`; after that was corrected, the gate exposed a genuine schema drift, which was fixed and then reverified successfully.

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

GO for commit/tag preparation for `v2.8.3`, subject to final maintainer review of the working tree and any last visual QA you want before tagging.
