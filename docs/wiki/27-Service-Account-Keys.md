# Service Account Keys

Service account keys are for machine-to-machine API access where a human user session is not appropriate.

They are intentionally narrower than Personal Access Tokens:

- admin-only creation and revocation,
- one-time reveal,
- hashed at rest,
- explicit scope list,
- explicit allowed route-prefix list,
- no admin wildcard scope.

## Management Endpoints

Session-authenticated and admin-only:

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

Use PATs when a human operator needs an API token. Use service account keys when the caller is a bounded automation client.
