# Portainer Stack Build

This page provides a practical Portainer stack workflow.

## 1. Prepare Values

Generate secure values:

```bash
openssl rand -hex 24  # DB_PASSWORD
openssl rand -hex 24  # REDIS_PASSWORD
openssl rand -hex 32  # SESSION_SECRET
openssl rand -hex 32  # INTEGRATION_ENCRYPTION_KEY
```

## 2. Create Stack

In Portainer:

1. `Stacks` -> `Add stack`
2. Name: `collectz`
3. Build method:
   - Preferred: `Repository`
   - Alternative: `Web editor`
4. Use compose file from repo root: `docker-compose.yml`

## 3. Environment Variables

Minimum required:

- `DB_PASSWORD`
- `REDIS_PASSWORD`
- `SESSION_SECRET`
- `INTEGRATION_ENCRYPTION_KEY`

Recommended production values:

- `ALLOWED_ORIGINS` with your public URL(s)
- `TMDB_API_KEY`, `BARCODE_API_KEY`, `VISION_API_KEY` (or configure in Admin UI)

## 4. Deploy and Validate

After deploy:

1. Verify all services healthy in Portainer.
2. Open app URL.
3. Register the first account; it becomes admin automatically when the users table is empty.
4. For later registrations, use invite links from `Admin Settings -> Members -> Invitations`.

## 5. Break-Glass Recovery (If Admin Access Is Lost)

If you lose admin UI access, use the break-glass flow in `/docs/wiki/01-Configuration-and-Use.md` to:

- reset an admin password,
- promote a user to admin role,
- revoke active sessions.
