# Configuration Reference

collectZ can start with a small environment file. Provider keys and many integration settings can also be managed inside the app after startup.

## Required

| Variable | Purpose |
| --- | --- |
| `DB_PASSWORD` | Password for the bundled Postgres user. |
| `SESSION_SECRET` | Secret used to protect browser sessions. |
| `INTEGRATION_ENCRYPTION_KEY` | Key used to encrypt stored provider credentials. |

Use unique values for every install. A convenient way to generate values is:

```bash
openssl rand -hex 32
```

## Common Optional Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_USER` | `collectz` | Postgres user name. |
| `POSTGRES_DB` | `collectz` | Postgres database name. |
| `DATABASE_SSL` | `false` | Enable only when connecting to a database that requires SSL. |
| `ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Browser origins allowed to call the API. |
| `SESSION_COOKIE_SECURE` | `true` | Keep `true` behind HTTPS; use `false` only for direct HTTP local testing. |
| `TRUST_PROXY` | `1` | Use `1` behind one trusted reverse proxy hop. |
| `VITE_PLATFORM_API_URL` | empty | Optional frontend build-time URL for a cairn platform control plane. Leave empty for standalone Core installs. |

## Optional Platform Bridge

collectZ Core does not require `cairn`. If `VITE_PLATFORM_API_URL` is empty, platform-only surfaces are hidden or unavailable and Core remains self-contained.

When a deployment intentionally pairs collectZ with `cairn`, set `VITE_PLATFORM_API_URL` to the cairn API base URL before building the frontend. The compatibility shell will route moved platform surfaces to cairn, including support queue APIs, global workspace/member administration, platform activity, platform email delivery settings, and platform diagnostics.

## Provider Configuration

Provider keys are not required for basic manual collection management, but they unlock lookup, enrichment, import, and notification features.

Common providers include:

- TMDB for movie and TV metadata
- Google Books for ISBN/book lookup
- barcode/UPC lookup providers
- comics metadata providers
- Plex
- Kavita
- SMTP
- S3-compatible object storage

Keep provider secrets out of git. Store required secrets in `.env` and use the app settings surfaces where supported.
