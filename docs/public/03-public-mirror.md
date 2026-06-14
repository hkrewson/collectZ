# Public Mirror Contract

The public collectZ repository is a clean mirror for people who want to install, update, inspect public setup files, and understand the published containers.

## Included

- `README.md`
- `SECURITY.md`
- `docker-compose.yml`
- `env.example`
- `setup.sh`
- public version metadata
- `docs/public/`
- `backend/openapi/openapi.yaml`
- audited frontend source under `frontend/src/`
- frontend build metadata such as `frontend/package.json`, `frontend/vite.config.js`, and `frontend/tailwind.config.js`

## Not Included

- private git history
- maintainer planning notes
- release-gate evidence
- local CI artifacts
- runtime/debug artifacts
- uploaded media
- private environment files
- backend implementation source
- private source-of-truth git history

The public mirror is generated from a private source-of-truth checkout only after local validation. The exported tree is scanned for known private paths, private workflow terms, and secret-like values before a clean public commit is created.

## Source Boundary

The public mirror includes the audited frontend source and the public OpenAPI contract so users can inspect the client and integration surface that runs against the published containers.

Backend implementation source remains private. The public repository should be treated as an install, support, frontend-source, and API-contract mirror for the published GHCR images.

## Public CI

The public repository runs lightweight checks that match the public artifact:

- frontend dependency install and production build,
- public mirror hygiene checks for denied private-source terms and secret-like values,
- OpenAPI contract shape checks,
- CodeQL analysis for the exported frontend source,
- Dependabot monitoring for frontend dependencies and public GitHub Actions.

Full product release validation, backend tests, migrations, container builds, and image publishing remain in the private source-of-truth repository.
