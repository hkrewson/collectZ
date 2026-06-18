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
