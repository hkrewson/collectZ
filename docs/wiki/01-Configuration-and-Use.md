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

If the sample seeded admin exists, invite will be required immediately.

## Default Seeded Admin (Current Init Script)

`init.sql` includes a sample row:

- Email: `admin@example.com`
- Intended password: `admin123`

This sample user is meant for development/bootstrap only.

## Remove Default Seed User After Containers Are Running

Remove only the seeded account:

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "DELETE FROM users WHERE email = 'admin@example.com';"
```

Verify users:

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "SELECT id,email,role,created_at FROM users ORDER BY id;"
```

## Remove Seed User From `init.sql` (Future Deployments)

Edit `init.sql` and remove this entire block:

```sql
-- Sample data (optional - remove in production)
-- Note: Password is 'admin123' hashed with bcrypt
INSERT INTO users (email, password, name, role) VALUES 
('admin@example.com', 'RADYwtaMkc9jqrUnJKHcLmLf', 'Admin User', 'admin')
ON CONFLICT (email) DO NOTHING;
```

Important: `init.sql` only runs on first database initialization (empty Postgres volume).

If DB volume already exists, changing `init.sql` will not affect existing data unless you recreate the DB volume.
