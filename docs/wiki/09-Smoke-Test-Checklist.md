# Smoke Test Checklist

Run this after deploys, upgrades, or restore operations.

## 1. Container Health

```bash
docker compose --env-file .env ps
```

Expected:

- `db`: healthy
- `redis`: healthy
- `backend`: healthy
- `frontend`: healthy

## 2. App Health Endpoint

```bash
curl -s http://localhost:3000/api/health
```

Expected:

- `status: "ok"`
- version/build fields present (`version`, `gitSha`, `buildDate`, `build`).

## 3. Auth Flow

- Open app in browser.
- Login as admin.
- Confirm dashboard loads without API errors.

## 4. Library CRUD

- Add a media item.
- Edit and save it.
- Open details view.
- Delete it and confirm prompt appears.

## 5. Integrations (Admin)

- Go to `Admin Settings -> Integrations`.
- Run `Test` for Barcode, Vision, and TMDB.
- Confirm status badges and messages render.

## 6. Invite + Role Admin Actions

- Create an invite token.
- Change a user role.
- Optional: remove a test user.

## 7. Activity Log Verification (DB)

Check audit entries were written:

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "SELECT id, action, entity_type, entity_id, user_id, created_at FROM activity_log ORDER BY id DESC LIMIT 20;"
```

Expected recent actions include:

- `admin.invite.create`
- `admin.user.role.update`
- `admin.settings.integrations.update`

## 8. Version UI Check

- In sidebar header, confirm display format:
  - `v <semver> (<sha>)`
- Match this against current deploy build.
