# Configuration and Use

## Architecture Overview

- `frontend`: React app served by Nginx on port `3000`
- `backend`: Node/Express API on port `3001` (internal to compose network)
- `db`: Postgres 16
- `redis`: Redis 7

The frontend proxies `/api/*` to backend inside the Docker network.

## First Startup

From repo root:

```bash
cp env.example .env
# edit .env and set required values
docker compose --env-file .env up -d --build
```

Check status/logs:

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs -f backend frontend db
```

## Authentication Behavior

Registration logic:

- If user count is `0`: first registered user becomes `admin` and no invite is required.
- If user count is `> 0`: invite token is required.

There is no default seeded admin account in current releases.

## Password Reset Workflows

- Admins can generate one-time reset URLs from `Admin Settings -> Members -> Member Details`.
- Reset links are one-time use and expire automatically.
- Admins can invalidate all active reset links for a member from the same panel.
- Users changing their own password in Profile must provide current password.

## Break-Glass Admin Recovery (CLI)

Use this when no admin can sign in and UI-based reset is unavailable.

1. Generate a bcrypt hash:

```bash
docker compose --env-file .env exec -T backend \
  node -e "const bcrypt=require('bcrypt'); bcrypt.hash(process.argv[1],12).then(h=>console.log(h));" 'NewStrongPassword123!'
```

2. Update an existing admin account password:

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "UPDATE users SET password = '<PASTE_BCRYPT_HASH>' WHERE email = 'admin@example.com';"
```

3. If no admin exists, promote a user to admin:

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "UPDATE users SET role = 'admin' WHERE email = 'you@example.com';"
```

4. Invalidate all existing sessions for that account:

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "DELETE FROM user_sessions WHERE user_id = (SELECT id FROM users WHERE email = 'admin@example.com');"
```
