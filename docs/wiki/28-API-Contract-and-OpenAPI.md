# API Contract and OpenAPI

`2.6.0` introduces a maintained OpenAPI baseline for key auth, admin, and media endpoints.

## Source of Truth

The current contract file lives at:

- `backend/openapi/openapi.yaml`

For now, the file is stored as JSON-compatible YAML so it can be validated without adding another parser dependency to the backend toolchain.

## Validation

Run:

```bash
npm --prefix backend run test:openapi
```

CI also runs this validation in `.github/workflows/docker-publish.yml` as part of the `migration-check` job.

This validates:

- OpenAPI version presence
- required `info`, `paths`, `components`, and `securitySchemes` blocks
- required baseline paths:
  - `/api/health`
  - `/api/auth/login`
  - `/api/auth/me`
  - `/api/admin/invites`
  - `/api/media`
  - `/api/media/sync-jobs/{id}`
- required baseline schemas for auth, invites, media lists, and sync jobs

## Current Scope

This is intentionally a baseline contract, not a full API inventory.

The current goal is to lock down the highest-value surfaces first:

- health/version
- browser auth
- personal access token lifecycle
- service account key lifecycle
- invite creation
- gated docs and metrics surfaces
- async Plex import launch
- media list reads
- async import job status

## Planned Follow-Up

Later `2.6.0` slices should add:

- broader endpoint coverage in `backend/openapi/openapi.yaml`
- CI wiring so OpenAPI validation runs as a release gate

## Docs Surface

The admin docs surface is available at:

- `/api/docs`

Access requirements:

- authenticated admin user
- `DEBUG>=1`
- feature flag `api_docs_enabled=true`

The raw generated spec is exposed at:

- `/api/docs/openapi.json`

When the debug or feature-flag gate is not satisfied, the docs routes return `404`.
