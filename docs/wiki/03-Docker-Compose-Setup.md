# Docker Compose Setup

## Basic Setup (Minimum to Run)

1. Prepare env file:

```bash
cp env.example .env
```

2. Set at least:

- `DB_PASSWORD`
- `SESSION_SECRET`
- `INTEGRATION_ENCRYPTION_KEY`

3. Start stack:

```bash
docker compose --env-file .env up -d --build
```

4. Verify:

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs -f backend frontend db
```

## Full Setup (Integrations + Production Origins)

In addition to basic setup:

1. Set `ALLOWED_ORIGINS` to include production domain(s).
2. Set integration keys (`TMDB_API_KEY`, `BARCODE_API_KEY`, `VISION_API_KEY`) or configure these in Admin Settings UI.
3. Deploy behind reverse proxy/SSL (Nginx, Traefik, Caddy, Cloudflare tunnel).

Start/update:

```bash
docker compose --env-file .env up -d --build
```

## Updating an Existing Host

```bash
git pull
docker compose --env-file .env up -d --build
```

## Postgres Password Mismatch Recovery

If backend fails with auth/SASL errors after password changes:

### Fresh install / data can be reset

```bash
docker compose --env-file .env down -v
docker compose --env-file .env up -d --build
```

### Keep existing data

Set DB user password inside Postgres to match `.env`:

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "ALTER USER ${DB_USER:-mediavault} WITH PASSWORD '${DB_PASSWORD}';"

docker compose --env-file .env restart backend
```
