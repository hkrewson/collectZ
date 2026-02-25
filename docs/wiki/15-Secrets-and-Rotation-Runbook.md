# Secrets and Rotation Runbook

Use this runbook for routine key rotation and secret-compromise response.

## Scope

This applies to:

- `DB_PASSWORD`
- `SESSION_SECRET`
- `INTEGRATION_ENCRYPTION_KEY`
- provider keys (TMDB, Barcode, Vision, Plex, SMTP)

## Generate Strong Secrets

```bash
openssl rand -hex 32
```

Use a unique value per secret. Never reuse one value for multiple variables.
For production startup validation, keep `SESSION_SECRET` and `INTEGRATION_ENCRYPTION_KEY` at
32+ characters and avoid placeholder values.

## Rotation Triggers

Rotate immediately when:

- a secret may have been committed or exposed in logs/chat/screenshots,
- unauthorized access is suspected,
- a team member with secret access leaves.

Routine rotation target: every 90 days for app/session and integration encryption keys.

## Standard Rotation Procedure

1. Update values in `.env`.
2. Restart stack:

```bash
docker compose --env-file .env up -d
```

3. Verify health:

```bash
docker compose --env-file .env ps
curl -s http://localhost:3000/api/health
```

If startup fails, inspect backend logs:

```bash
docker compose --env-file .env logs --tail=80 backend
```

## Session Secret Rotation (Force Re-Auth)

Changing `SESSION_SECRET` invalidates cookie signing trust for new requests.

For immediate full session revocation, clear persisted sessions:

```bash
docker compose --env-file .env exec -T db psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "DELETE FROM user_sessions;"
```

Expected result: all users must log in again.

## Integration Encryption Key Rotation

`INTEGRATION_ENCRYPTION_KEY` encrypts provider API keys stored in `app_integrations`.

Important: rotating this key without re-saving provider keys will make stored encrypted values undecryptable.

Procedure:

1. Ensure admin can access current integration settings.
2. Rotate `INTEGRATION_ENCRYPTION_KEY` in `.env`.
3. Restart backend.
4. Open `Admin Settings -> Integrations`.
5. Re-enter and save each provider API key (Barcode, Vision, TMDB, Plex).
6. Re-run each provider test button.

If decryption warnings appear, clear and re-save affected keys.

## Secret Leak Incident Response Checklist

1. Contain:
   - rotate impacted secret(s),
   - revoke sessions if auth/session material was exposed.
2. Eradicate:
   - remove leaked values from repository history and CI variables.
3. Recover:
   - redeploy with rotated secrets,
   - verify auth and integrations.
4. Audit:
   - review `Admin Settings -> Activity` for suspicious actions during exposure window.

## Verification SQL Snippets

Count active sessions:

```bash
docker compose --env-file .env exec -T db psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "SELECT COUNT(*) AS active_sessions FROM user_sessions;"
```

Inspect recent auth-related activity:

```bash
docker compose --env-file .env exec -T db psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "SELECT id, action, created_at FROM activity_log WHERE action LIKE 'auth.%' ORDER BY id DESC LIMIT 20;"
```

## Notes

- Do not commit `.env`.
- Do not paste real secrets in issue trackers, chat logs, or screenshots.
- If committed secret scanning fails in CI, rotate the secret first, then fix history/exposure source.
