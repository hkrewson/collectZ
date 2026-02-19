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
3. If registration asks for invite on first use, check for seeded admin in DB.

## 5. Remove Seeded Admin (Optional but Recommended)

From host CLI:

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "DELETE FROM users WHERE email = 'admin@example.com';"
```

Then first registration can create the initial admin (if no other users remain).

## 6. Remove Seed Block for Future New Volumes

Edit `init.sql` and remove the sample `INSERT INTO users` block.

If a database volume already exists, recreate DB volume to apply init changes:

```bash
docker compose --env-file .env down -v
docker compose --env-file .env up -d --build
```
