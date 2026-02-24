# Activity Triage Runbook

Use this flow when an import, auth action, admin action, or scoped request fails.

## 1) UI-first triage

Open `Admin Settings -> Activity`.

Use filters:

- `Search`: broad text search across action/entity/user/details.
- `Action`: exact action key (example: `request.failed`, `media.import.plex.failed`).
- `Entity`: exact entity type (example: `http_request`, `media`, `scope`).
- `User`: email substring or numeric user id.
- `Status`: HTTP status class (`4xx`, `5xx`) or exact status (`401`, `403`, `429`, `500`).
- `Reason`: partial match against `details.reason`.
- `From/To`: constrain incident window.

For most failures, start with:

1. `Status = 4xx` or `5xx`
2. narrow `From/To`
3. add `Reason` if present

## 2) Failure patterns

- Auth failures:
  - action: `request.failed`
  - entity: `http_request`
  - reason/status in `details`
- Scope denials:
  - action: `scope.access.denied`
  - entity: `scope`
  - `details.reason` indicates enforcement cause
- Import failures:
  - actions ending in `.failed` (for example `media.import.plex.failed`)
  - inspect `details.error` and provider-specific fields

## 3) DB fallback query

If UI is insufficient, run direct SQL:

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "SELECT id, action, entity_type, user_id, details->>'status' AS status, details->>'reason' AS reason, created_at FROM activity_log ORDER BY id DESC LIMIT 200;"
```

Time-bounded query:

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "SELECT id, action, entity_type, user_id, details, created_at FROM activity_log WHERE created_at >= NOW() - INTERVAL '2 hours' ORDER BY id DESC;"
```

## 4) What to capture in incidents

- exact action key(s)
- status and reason values
- affected user id/email
- time window
- endpoint URL/method (for `http_request` events)

## 5) Next actions

- Fix configuration if reason indicates setup issue (`missing key`, `scope`, `rate limit`).
- Re-run failed action after remediation.
- Verify new success/failure event appears with expected status/reason.
