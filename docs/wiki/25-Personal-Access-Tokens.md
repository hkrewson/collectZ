# Personal Access Tokens

Personal Access Tokens (PATs) let you call the collectZ API from scripts and automation without copying browser session cookies.

PATs are intended for API use. Browser access should continue using the normal session cookie flow.

## Scope

Current supported scopes:

- `profile:read`
- `profile:write`
- `libraries:read`
- `libraries:write`
- `media:read`
- `media:write`
- `events:read`
- `events:write`
- `collectibles:read`
- `collectibles:write`
- `import:run`
- `admin:*`

## Create And Revoke In The UI

Open `Profile` and use the `Personal Access Tokens` section to:

- create a token
- copy the token once at creation time
- review scopes and expiry
- revoke an existing token

Tokens are only shown once when created. After that, only the last four characters remain visible.

## Curl Workflow

PAT creation and revocation are session-authenticated routes. That means:

- login with your normal account
- fetch a CSRF token
- create or revoke PATs using the session cookie + CSRF header
- use the PAT itself for later API requests

Assumptions:

- backend base URL is `http://localhost:3001`
- cookie jar file is `cookies.txt`

### 1. Log In And Store Session Cookies

```bash
curl -sS -c cookies.txt \
  -H "Content-Type: application/json" \
  -X POST "http://localhost:3001/api/auth/login" \
  --data '{"email":"you@example.com","password":"your-password"}'
```

### 2. Fetch A CSRF Token For Session-Authenticated Writes

```bash
curl -sS -b cookies.txt -c cookies.txt \
  "http://localhost:3001/api/auth/csrf-token"
```

Example response:

```json
{"csrfToken":"replace-me"}
```

### 3. Create A PAT

Replace `CSRF_TOKEN_HERE` with the token from the previous step.

```bash
curl -sS -b cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: CSRF_TOKEN_HERE" \
  -X POST "http://localhost:3001/api/auth/personal-access-tokens" \
  --data '{
    "name":"automation-token",
    "scopes":["media:read","media:write","import:run"],
    "expires_at":"2026-12-31T23:59:59Z"
  }'
```

Example response:

```json
{
  "token": "cz_pat_...",
  "record": {
    "id": 3,
    "user_id": 1,
    "name": "automation-token",
    "token_last_four": "7f2a",
    "scopes": ["media:read", "media:write", "import:run"],
    "expires_at": "2026-12-31T23:59:59.000Z",
    "last_used_at": null,
    "revoked_at": null,
    "created_at": "2026-03-12T00:00:00.000Z",
    "updated_at": "2026-03-12T00:00:00.000Z"
  }
}
```

### 4. List Existing PATs

```bash
curl -sS -b cookies.txt \
  "http://localhost:3001/api/auth/personal-access-tokens"
```

### 5. Use A PAT For API Requests

Read example:

```bash
curl -sS \
  -H "Authorization: Bearer cz_pat_your_token_here" \
  "http://localhost:3001/api/media?limit=5"
```

Write example:

```bash
curl -sS \
  -H "Authorization: Bearer cz_pat_your_token_here" \
  -H "Content-Type: application/json" \
  -X PATCH "http://localhost:3001/api/media/42" \
  --data '{"notes":"Updated by automation"}'
```

PAT-authenticated requests do not require CSRF headers.

### 5a. Start Imports As Background Jobs

Import endpoints now queue by default for API clients and return `202 Accepted` immediately.

Plex import example:

```bash
curl -sS \
  -H "Authorization: Bearer cz_pat_your_token_here" \
  -H "Content-Type: application/json" \
  -X POST "http://localhost:3001/api/media/import-plex" \
  --data '{}'
```

Example response:

```json
{
  "ok": true,
  "queued": true,
  "provider": "plex",
  "job_id": 14,
  "status": "queued",
  "status_url": "/api/media/sync-jobs/14",
  "job": {
    "id": 14,
    "status": "queued",
    "provider": "plex",
    "progress": {
      "total": 0,
      "processed": 0,
      "created": 0,
      "updated": 0,
      "skipped": 0,
      "errorCount": 0
    }
  }
}
```

Poll the job status:

```bash
curl -sS \
  -H "Authorization: Bearer cz_pat_your_token_here" \
  "http://localhost:3001/api/media/sync-jobs/14"
```

Poll until the job reaches a terminal state and then stop automatically:

```bash
while :; do
  json=$(curl -sS \
    -H "Authorization: Bearer cz_pat_your_token_here" \
    "http://localhost:3001/api/media/sync-jobs/14")
  echo "$json" | jq '{id, status, progress, summary, error}'
  case "$(echo "$json" | jq -r '.status')" in
    succeeded|failed) break ;;
  esac
  sleep 2
done
```

Fetch the full stored job result only when you want the detailed summary/errors:

```bash
curl -sS \
  -H "Authorization: Bearer cz_pat_your_token_here" \
  "http://localhost:3001/api/media/sync-jobs/14/result"
```

If you explicitly want blocking behavior for troubleshooting, opt into sync mode:

```bash
curl -sS \
  -H "Authorization: Bearer cz_pat_your_token_here" \
  -H "Content-Type: application/json" \
  -X POST "http://localhost:3001/api/media/import-plex?sync=1" \
  --data '{}'
```

### 6. Revoke A PAT

Revocation is session-authenticated and currently requires normal cookie session auth plus CSRF.

```bash
curl -sS -b cookies.txt \
  -H "x-csrf-token: CSRF_TOKEN_HERE" \
  -X DELETE "http://localhost:3001/api/auth/personal-access-tokens/3"
```

## Route Behavior Notes

- PATs are accepted as `Authorization: Bearer <token>`.
- PATs are scoped per route family and HTTP method.
- PATs do not replace browser login.
- PAT management endpoints are session-only on purpose.

## Current Route Mapping

- `GET /api/auth/me`, `GET/PATCH /api/profile`: `profile:*`
- `GET/POST/PATCH/DELETE /api/libraries...`: `libraries:*`
- `GET/POST/PATCH/DELETE /api/media...`: `media:*`
- `POST /api/media/import-*`: `import:run`
- `GET /api/media/sync-jobs`, `GET /api/media/sync-jobs/:id`, `GET /api/media/sync-jobs/:id/result`: `import:run`
- `GET/POST/PATCH/DELETE /api/events...`: `events:*`
- `GET/POST/PATCH/DELETE /api/collectibles...`: `collectibles:*`
- `/api/admin...`: `admin:*`

## Security Notes

- Tokens are hashed at rest.
- Tokens are shown only once when created.
- Revoke tokens you no longer need.
- Prefer narrow scopes over broad scopes.
- Prefer expiry dates for automation tokens when practical.
