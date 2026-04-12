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
- `SESSION_COOKIE_SECURE=true` (required when `NODE_ENV=production`)

3. Start the default platform/dev stack:

```bash
docker compose --env-file .env up -d --build
```

4. Verify:

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs -f backend frontend db
```

## Local Edition Targets

Use the default stack for your real platform/dev dataset, and use one parallel homelab stack for edition-split verification:

- Platform/dev on port `3000`:

```bash
npm run stack:up:platform
```

- Homelab parallel stack on port `3100`:
  - This stack intentionally uses isolated Docker volumes and distinct cookie names.
  - Existing platform users and sessions from `localhost:3000` will not carry over automatically.

```bash
npm run stack:up:homelab
```

- The homelab stack uses isolated project-scoped Docker volumes, so it will not reuse the default-stack users or library data.
- The homelab stack also uses edition-specific session and CSRF cookie names so both local editions can stay signed in at the same time without colliding on `localhost`.
- Run both edition-boundary smokes after both stacks are up:

```bash
npm run test:edition-boundaries:local
```

## Full Setup (Integrations + Production Origins)

In addition to basic setup:

1. Set `ALLOWED_ORIGINS` to include production domain(s).
2. Keep `SESSION_COOKIE_SECURE=true` for TLS-backed production access.
3. Set integration keys (`TMDB_API_KEY`, `BARCODE_API_KEY`) or configure these in Admin Settings UI.
4. Deploy behind reverse proxy/SSL (Nginx, Traefik, Caddy, Cloudflare tunnel).

Start/update:

```bash
docker compose --env-file .env up -d --build
```

## Local LAN HTTP Setup

If you want to open the app from another device on your wired or Wi-Fi LAN over plain HTTP:

1. Set `NODE_ENV=development`.
2. Set `SESSION_COOKIE_SECURE=false`.
3. Add the exact LAN origin you will browse from to `ALLOWED_ORIGINS`, for example `http://10.22.20.91:3000`.
4. Rebuild the stack:

```bash
docker compose --env-file .env up -d --build backend frontend
```

This keeps the registry/production default secure while allowing local non-TLS browser sessions to work correctly on the LAN.

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
