# Public Homelab Environment Reference

This page documents the public homelab deployment surface. `env.example` intentionally stays small; start there, then use this page when you need an optional setting.

The public `docker-compose.yml` uses prebuilt GHCR `latest` images and passes only the variables needed for normal startup. Provider keys and most advanced runtime controls should be configured inside the app whenever possible.

## Required

Set these before first startup:

- `DB_PASSWORD`: Postgres password for the app database user.
- `SESSION_SECRET`: browser session secret. Use a strong unique value.
- `INTEGRATION_ENCRYPTION_KEY`: encrypts stored integration credentials. Use a strong unique value.

Recommended secret generation:

```bash
openssl rand -hex 32
```

## Database

These can usually stay at their defaults:

- `DB_USER` default: `collectz`
- `POSTGRES_DB` default: `collectz`
- `DATABASE_SSL` default: `false`

Only change the database name or user when attaching collectZ to an existing Postgres setup.

## Browser and Proxy

- `ALLOWED_ORIGINS`: comma-separated browser origins allowed to call the API.
  - Local default: `http://localhost:3000,http://127.0.0.1:3000`
  - Public example: `https://collect.example.com`
- `SESSION_COOKIE_SECURE` default: `true`
  - Keep `true` behind HTTPS.
  - Use `false` only for direct plain-HTTP testing.
- `TRUST_PROXY` default: `1`
  - Use `1` behind one reverse proxy hop.
  - Use `false` only when accessing the backend directly.

## Frontend Port

- `FRONTEND_PORT` default: `3000`

Use this when another service already owns port `3000` on the host:

```text
FRONTEND_PORT=3100
```

## Uploaded Images

The public compose stores uploaded images in the `media_uploads` Docker volume by default.

Local storage needs no extra variables. S3-compatible object storage is supported by the app, but the public compose does not pass S3 variables by default. If you want S3-backed uploads, add a private compose override for the backend environment and configure:

- `STORAGE_PROVIDER=s3`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_REGION`
- `S3_ENDPOINT` when using MinIO, Backblaze B2, or another compatible service

## Integrations

Configure these in the app under Admin or Integrations when possible:

- TMDB
- Google Books
- Barcode/UPC lookup
- Comics metadata
- Plex
- Kavita
- SMTP mail
- Optional valuation providers

The public compose no longer advertises provider API keys in `.env` because the app can store integration settings securely. If you specifically need environment-backed provider bootstrap, use a private compose override that adds only the needed backend environment values.

## Image Updates

The public compose defaults to:

- `ghcr.io/hkrewson/collectz-backend:latest`
- `ghcr.io/hkrewson/collectz-frontend:latest`

Update with:

```bash
docker compose --env-file .env pull
docker compose --env-file .env up -d
```

For exact version pinning, edit the backend/frontend `image:` lines directly or use a private compose override.

## Verify Running Values

After changing `.env` or compose settings, verify the running container rather than only reading local files:

```bash
docker inspect collectz-backend-1 \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^(DATABASE_URL|NODE_ENV|SESSION_COOKIE_SECURE|TRUST_PROXY|ALLOWED_ORIGINS|APP_VERSION)='
```

Do not paste secret values into issue reports, screenshots, release evidence, or shared logs.
