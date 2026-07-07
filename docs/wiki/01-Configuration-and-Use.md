# Configuration and Use

## Architecture Overview

- `frontend`: React app served by Nginx on port `3000`
- `backend`: Node/Express API on port `3001` (internal to compose network)
- `db`: Postgres 16

The frontend proxies `/api/*` to backend inside the Docker network.

## Local Maintainer Port Contract

Use these ports for local maintainer/dev stacks. Do not repurpose them without
updating this section, the matching npm stack scripts, and the Cairn deploy docs.

| Stack | Compose project | Browser entry point | Service endpoint | Purpose |
| --- | --- | --- | --- | --- |
| Core-only / homelab | `collectz-homelab` | `http://localhost:3100` | backend is compose-internal on `3001` | Self-hosted/Core runtime without Cairn. |
| Platform paired Core | `collectz-private` | `http://localhost:3201` | backend is compose-internal on `3001` | collectZ Core running in platform mode beside Cairn. |
| Cairn platform control plane | `collectz-private` | API/docs at `http://localhost:3101` | `http://localhost:3101/health`, `http://localhost:3101/api/docs` | Platform-owned routing/admin/support/docs service. |

Notes:

- `npm run stack:up:homelab` forces `FRONTEND_PORT=3100` and compose project `collectz-homelab`.
- `npm run stack:up:platform` forces `FRONTEND_PORT=3201`, `VITE_PLATFORM_API_URL=http://localhost:3101/api`, `CAIRN_PORT=3101`, and compose project `collectz-private` for the collectZ side of the paired platform stack.
- The Cairn service and Cairn database are owned by the `cairn` repository deploy compose. Its matching local port contract must stay aligned with this table.
- `http://localhost:3101/` is not the collectZ app. Use `/health` for Cairn health and `/api/docs` for Cairn API documentation.

## Frontend Local Dev and Build Modes

The frontend now runs on a Vite-first toolchain:

- Primary frontend commands:
  - `npm --prefix frontend run start`
  - `npm --prefix frontend run build`
  - `npm --prefix frontend run preview`

Current runtime contract:

- Docker and CI use the Vite production build path for the nginx-served frontend image.
- Local maintainer defaults use the same Vite toolchain as production.
- The legacy CRA rollback rail and `REACT_APP_*` compatibility shims have been removed along with `react-scripts`.
- The Vite dev server proxies `/api` and `/uploads` to `http://localhost:3001` by default. Override with `VITE_PROXY_TARGET` when your backend is running elsewhere.
- Preferred frontend env names:
  - `VITE_API_URL`
  - `VITE_APP_VERSION`
  - `VITE_DEBUG`
  - `VITE_CSRF_COOKIE_NAME`
- `REACT_APP_*` names are no longer supported frontend configuration. Use `VITE_*` for local, Docker, and CI configuration.

## First Startup

From repo root:

```bash
cp env.example .env
# edit .env and set required values
npm run stack:up
```

Check status/logs:

```bash
npm run stack:ps
docker compose --env-file .env logs -f backend frontend db
```

For local homelab verification, bring up the explicit parallel stack on port `3100`:

```bash
npm run stack:up:homelab
```

For local platform/Core verification, bring up the collectZ side of the paired
platform stack on port `3201`:

```bash
npm run stack:up:platform
```

Start or inspect Cairn from the `cairn` repository using its deploy docs; the
canonical local Cairn API/docs port is `3101`.

## Authentication Behavior

Registration logic:

- If user count is `0`: first registered user becomes `admin` and no invite is required.
- If user count is `> 0` in `platform`: an invite token remains valid onboarding, but public self-registration is also allowed when the `self_registration_enabled` feature flag is enabled and SMTP delivery is configured. If self-registration is disabled, an invite token is required.
- If user count is `> 0` in `homelab`: additional local accounts can still self-register without an invite token inside the single-library household model.
- The backend auth/bootstrap contract is the source of truth for the active edition shape:
  - `platform`: multi-workspace platform shell
  - `homelab`: single-library household shell with local accounts and no workspace control-plane surface

There is no default seeded admin account in current releases.

## Password Reset Workflows

- Admins can generate one-time reset URLs from `Admin Settings -> Members -> Member Details`.
- Reset links are one-time use and expire automatically.
- Admins can invalidate all active reset links for a member from the same panel.
- Users changing their own password in Profile must provide current password.

## Break-Glass Admin Recovery (CLI)

Use this when no admin can sign in and UI-based reset is unavailable.

For the full recovery + SMTP troubleshooting flow, also use:

- `docs/wiki/26-Admin-Recovery-and-SMTP-Triage.md`
- `docs/wiki/15-Secrets-and-Rotation-Runbook.md`

1. Generate a bcrypt hash:

```bash
docker compose --env-file .env exec -T backend \
  node -e "const bcrypt=require('bcrypt'); bcrypt.hash(process.argv[1],12).then(h=>console.log(h));" 'NewStrongPassword123!'
```

2. Update an existing admin account password:

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-collectz}" -d "${POSTGRES_DB:-collectz}" \
  -c "UPDATE users SET password = '<PASTE_BCRYPT_HASH>' WHERE email = 'admin@example.com';"
```

3. If no admin exists, promote a user to admin:

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-collectz}" -d "${POSTGRES_DB:-collectz}" \
  -c "UPDATE users SET role = 'admin' WHERE email = 'you@example.com';"
```

4. Invalidate all existing sessions for that account:

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-collectz}" -d "${POSTGRES_DB:-collectz}" \
  -c "DELETE FROM user_sessions WHERE user_id = (SELECT id FROM users WHERE email = 'admin@example.com');"
```

## Import Identifier Matching (2.0 beta.4)

CSV imports now match in this order:

1. `isbn` (books)
2. `ean/upc`
3. Provider-native IDs (TMDB/Plex when present)
4. Title/year/media_type fallback

Normalized identifiers are written to import audit rows (`isbn`, `ean_upc`, `asin`) along with `match_mode`.

### Troubleshooting

- Malformed ISBN:
  - Only canonical ISBN-13 is used for matching.
  - ISBN-10 values are converted to ISBN-13 during import.
  - If conversion fails, matching falls back to later steps.
- Malformed EAN/UPC:
  - Non-digit characters are stripped before matching.
  - Empty/invalid values are ignored and fallback matching is used.
- Identifier collisions:
  - If multiple existing rows match the same identifier, the row is marked `identifier_conflict`.
  - Import still resolves deterministically (latest matching row), but the conflict should be checked through the import audit export rather than a standalone review queue.
- Fallback behavior:
  - `identifier_no_match_fallback_title`: an identifier was present but no identifier match existed, so fallback matching was used.
  - `fallback_title_only`: no identifier was present; title/year/media_type matching was used directly.
- Debug diagnostics:
  - Ambiguous rows can be marked `diagnostic_flagged` in the import audit export.
  - When debug logging and external log export are enabled, collectZ can emit `media.import.diagnostic.flagged` events to the operator log pipeline for those rows.
