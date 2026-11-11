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
  - `/api/media`
  - `/api/media/sync-jobs/{id}`
- required baseline schemas for auth, invites, media lists, and sync jobs

## Current Scope

This is intentionally a baseline contract, not a full API inventory.

The current goal is to lock down the highest-value surfaces first:

- health/version
- browser auth
- personal access token lifecycle
- Core API key lifecycle
- invite creation
- gated docs and metrics surfaces
- async Plex import launch
- media list reads
- async import job status
- workspace-managed, multi-instance BookOrbit connection administration
- BookOrbit connection testing and authoritative import launch

### BookOrbit connection contract

BookOrbit connections are workspace-owned Provider Connections rather than fields in the singleton integration record. Public responses include stable connection UUID, provider label, endpoint, validated non-secret settings, lifecycle state, and a `credentialsConfigured` boolean. They never return usernames, passwords, encrypted payloads, or credential masks.

The maintained routes are:

- `GET|POST /api/spaces/{id}/integrations/bookorbit-connections`
- `PATCH /api/spaces/{id}/integrations/bookorbit-connections/{connectionId}`
- `PUT /api/spaces/{id}/integrations/bookorbit-connections/{connectionId}/credentials`
- `PUT /api/spaces/{id}/integrations/bookorbit-connections/{connectionId}/status`
- `POST /api/spaces/{id}/integrations/bookorbit-connections/{connectionId}/test`
- `POST /api/media/import-bookorbit`

Connection mutations and tests require a session with recent reauthentication. Import requires a session and explicit active workspace/library scope. The import request selects one connection UUID, and authoritative identity matching remains scoped by workspace plus that connection UUID plus identity kind plus BookOrbit Atom entry id.

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

The raw generated spec is exposed at:

- `/api/docs/openapi.json`

When the debug gate is not satisfied, the docs routes return `404`.
