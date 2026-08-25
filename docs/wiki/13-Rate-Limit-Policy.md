# Rate Limit Policy (1.9.7)

This release establishes **application-layer rate limiting as the authoritative policy**.

- Express (`backend/server.js`) owns request-rate controls.
- Nginx (`frontend/nginx.conf`) is used as a reverse proxy/static host and intentionally does **not** apply `limit_req` rules.
- This avoids duplicated/multiplicative limits across layers.

## Endpoint Classes

Default window: `RATE_LIMIT_WINDOW_MINUTES` (default `15`).

- Global API safety net (`/api/*`, except `/api/media/sync-jobs`)
  - env: `RATE_LIMIT_GLOBAL_MAX` (default `600`)
- Auth
  - routes: `/api/auth/login`, `/api/auth/register`, `/api/auth/password-reset/*`, `/api/auth/email-verification/*`, `/api/mobile/auth/login`, `/api/mobile/auth/refresh`
  - env: `RATE_LIMIT_AUTH_MAX` (default `20`)
- Invitation mutation
  - routes: `POST /api/spaces/{spaceId}/invites`, `PATCH /api/spaces/{spaceId}/invites/{inviteId}/revoke`
  - env: `RATE_LIMIT_INVITE_MAX` (default `20`)
- Admin
  - routes: `/api/admin/*`
  - env: `RATE_LIMIT_ADMIN_MAX` (default `300`)
- Media Read
  - routes: `/api/media/*` for `GET/HEAD`
  - env: `RATE_LIMIT_MEDIA_READ_MAX` (default `600`)
- Media Write
  - routes: `/api/media/*` for non-`GET/HEAD`
  - env: `RATE_LIMIT_MEDIA_WRITE_MAX` (default `240`)
- Import Start
  - routes: `/api/media/import-plex`, `/api/media/import-csv`, `/api/media/import-csv/delicious`
  - env: `RATE_LIMIT_IMPORT_START_MAX` (default `60`)
- Import Status Poll
  - route: `/api/media/sync-jobs`
  - env: `RATE_LIMIT_SYNC_POLL_MAX` (default `600`)

## Trust Proxy

Client IP attribution depends on `TRUST_PROXY`.

- Behind one reverse proxy hop: `TRUST_PROXY=1` (recommended for homelab reverse-proxy setups).
- Direct backend access (no proxy): `TRUST_PROXY=false`.

## Single-Node vs Multi-Node

- Current limiter state is in-process memory (per backend container).
- Single-node: deterministic behavior.
- Multi-node: effective limit scales with number of backend replicas.
  - If strict shared limits are required later, move to a centralized store-backed limiter.

## Portainer / Homelab Validation Checklist

1. Confirm `TRUST_PROXY` matches deployment topology.
2. Confirm only one active limiting layer (Express).
3. Verify auth throttling:
   - repeated bad login attempts trigger `429`.
   - repeated authenticated invitation mutations trigger `429` without weakening CSRF enforcement.
4. Verify import status polling:
   - multi-tab dashboard usage does not starve login/admin endpoints.
5. Verify admin workflows remain usable under normal usage:
   - `/api/admin/activity`
   - `/api/admin/settings/integrations`
6. If `429` appears unexpectedly, review:
   - backend logs for endpoint concentration,
   - frontend polling behavior (especially import status),
   - configured `RATE_LIMIT_*` env values.
