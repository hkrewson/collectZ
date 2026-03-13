# Admin Recovery and SMTP Triage

Use this runbook when invite delivery, password reset delivery, or admin account recovery is blocking access.

## 1. Break-Glass Recovery

Primary reference:

- `docs/wiki/01-Configuration-and-Use.md`
- `docs/wiki/15-Secrets-and-Rotation-Runbook.md`

Use break-glass recovery when:

- no admin can sign in,
- SMTP delivery is failing and no one can receive reset links,
- a password reset token was exposed and UI recovery is no longer trusted.

Recommended order:

1. Confirm the target user exists:

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "SELECT id,email,role,active FROM users ORDER BY id;"
```

2. Promote the user to admin if needed:

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "UPDATE users SET role = 'admin' WHERE email = 'you@example.com';"
```

3. Generate a bcrypt hash for a temporary strong password:

```bash
docker compose --env-file .env exec -T backend \
  node -e "const bcrypt=require('bcrypt'); bcrypt.hash(process.argv[1],12).then(h=>console.log(h));" 'NewStrongPassword123!'
```

4. Apply the password hash:

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "UPDATE users SET password = '<PASTE_BCRYPT_HASH>' WHERE email = 'you@example.com';"
```

5. Revoke active sessions for that account:

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "DELETE FROM user_sessions WHERE user_id = (SELECT id FROM users WHERE email = 'you@example.com');"
```

6. Sign in with the temporary password and immediately replace it in the UI.

## 2. Invalidate Outstanding Invite/Reset Tokens

Use this when a link was copied to the wrong place, emailed incorrectly, or exposed during support/debugging.

Preferred path:

- invalidate the token from the Admin UI if access is still available.

Database fallback:

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "UPDATE invites SET active = FALSE WHERE active = TRUE;"
```

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "UPDATE users SET reset_token = NULL, reset_expires = NULL WHERE reset_token IS NOT NULL;"
```

After invalidation:

1. re-issue only the required invite/reset links,
2. confirm delivery channel ownership,
3. review recent activity log entries for unexpected token creation or exposure events.

## 3. SMTP Delivery Failure Triage

Symptoms:

- admin can create invite/reset link, but recipient never receives email,
- UI falls back to copy-link unexpectedly,
- backend logs show transport/auth/TLS failures.

Check in this order:

1. Verify env values:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

2. Restart backend after any env change:

```bash
docker compose --env-file .env up -d backend
```

3. Check backend logs:

```bash
docker compose --env-file .env logs --tail=120 backend
```

Look for:

- auth failure / invalid credentials,
- TLS handshake failure,
- connection timeout / refused,
- sender rejection for `SMTP_FROM`.

4. Confirm app health:

```bash
curl -s http://localhost:3000/api/health
```

5. Send a fresh invite or password reset.

If it still fails:

- use copy-link only as a temporary manual fallback,
- rotate SMTP credentials if compromise is suspected,
- document the incident window and affected recipients.

## 4. What To Capture In An Incident

Record:

- exact timestamp window,
- affected user email(s),
- whether a token/link was exposed,
- whether SMTP was failing or just delayed,
- whether sessions or reset tokens were revoked,
- which secrets were rotated,
- which recovery account was promoted or reset.

## 5. Follow-Up

After recovery:

1. rotate any exposed secrets using `docs/wiki/15-Secrets-and-Rotation-Runbook.md`,
2. re-test invite delivery,
3. re-test admin-issued password reset delivery,
4. confirm activity log shows expected recovery actions only.
