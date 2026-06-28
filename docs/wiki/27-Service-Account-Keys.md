# Core API Keys

Core API keys are for machine-to-machine access to collectZ Core APIs where a human browser session is not appropriate. The current endpoint path still uses `service-account-keys` for compatibility, but these keys are Core-owned automation credentials, not platform control-plane credentials.

They are intentionally narrower than Personal Access Tokens:

- admin-only creation and revocation,
- one-time reveal,
- hashed at rest,
- explicit scope list,
- explicit allowed route-prefix list,
- no admin wildcard scope.

## Management Endpoints

Session-authenticated, admin-only, and available in Core/homelab runtimes:

- `GET /api/auth/service-account-keys`
- `POST /api/auth/service-account-keys`
- `DELETE /api/auth/service-account-keys/:id`

## Allowed Scopes

- `libraries:read`
- `libraries:write`
- `media:read`
- `media:write`
- `events:read`
- `events:write`
- `collectibles:read`
- `collectibles:write`
- `import:run`

## Allowed Route Prefixes

- `/api/libraries`
- `/api/media`
- `/api/media/import-`
- `/api/events`
- `/api/collectibles`

Both checks apply:

1. the request path must match an allowed prefix
2. the request method/path must map to a permitted scope

## Intended Use

Good fit:

- automation jobs
- import runners
- local scripts with tightly bounded route access

Not intended for:

- browser auth
- normal human login
- unrestricted admin API access
- platform control-plane administration

Use PATs when a human operator needs an API token. Use Core API keys when the caller is a bounded automation client.
