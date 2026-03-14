# Observability Triage Runbook

Use this runbook when `/api/metrics` or an external scrape/alerting system indicates rising failures, latency, or import backlog.

## 1. Confirm the Signal

Before treating it as an incident, confirm:

1. the metric is still moving, not a single stale spike
2. the affected route or provider is clear
3. the issue is current, not already recovered

Prioritize these signals:

- `collectz_http_request_failures_total`
- `collectz_http_request_duration_ms`
- `collectz_auth_events_total`
- `collectz_import_jobs_total`
- `collectz_sync_jobs`
- `collectz_admin_actions_total`

## 2. Classify the Incident

Use the metric that moved first:

### API failures

Usually indicated by:

- `collectz_http_request_failures_total`

Questions:

1. Which route is failing?
2. Is it `4xx` or `5xx`?
3. Is the route auth-, admin-, or import-related?

Next references:

- `docs/wiki/16-Activity-Triage-Runbook.md`

### Latency regression

Usually indicated by:

- `collectz_http_request_duration_ms`

Questions:

1. Which route regressed?
2. Is the regression read-heavy or mutation-heavy?
3. Is the database under load, or is an upstream provider slow?

Check:

- current sync job load
- recent import activity
- backend logs during the same window

### Auth degradation

Usually indicated by:

- `collectz_auth_events_total`

Questions:

1. Are failures concentrated on `login` or `password_reset_consume`?
2. Did a deploy just change auth, cookie, CSRF, or token behavior?
3. Is this likely abuse, credential stuffing, or a regression?

Check:

- `/api/auth/login`
- `/api/auth/me`
- recent `request.failed` activity

### Import degradation

Usually indicated by:

- `collectz_import_jobs_total`
- `collectz_sync_jobs`

Questions:

1. Which provider is failing: Plex, Metron, or a CSV import path like Delicious/Calibre/generic?
2. Are jobs failing quickly or just staying queued/running?
3. Is the issue a hard failure, or just a high `no_match` ratio during enrichment?
4. Did integration config or upstream provider behavior change?

Check:

- `/api/media/sync-jobs`
- `/api/media/sync-jobs/:id/result`
- recent import-related activity rows

Notes:

- successful Delicious imports can still show substantial `pipeline=no_match` counts
- treat high no-match ratios as a data-quality warning, not the same class of issue as failed jobs or provider outages

### Admin mutation failures

Usually indicated by:

- `collectz_admin_actions_total`

Questions:

1. Which admin route is failing?
2. Did a feature flag, validation, or permission rule change?
3. Is the failure user-specific or global?

## 3. Immediate Response

Use the smallest response that reduces harm:

### For auth incidents

1. confirm whether the issue is global or account-specific
2. if necessary, use the recovery flow in `docs/wiki/26-Admin-Recovery-and-SMTP-Triage.md`
3. avoid rotating secrets until you know whether this is a configuration issue or an actual compromise

### For import incidents

1. stop launching new imports if queue pressure is rising
2. inspect one failing job in detail before retrying many jobs
3. verify integration credentials and upstream availability

### For admin/API regressions

1. identify the first failing route
2. compare against the most recent deploy or config change
3. consider temporarily disabling the affected feature flag if the failure is isolated

## 4. DB and API Checks

Current sync-job distribution:

```bash
curl -sS \
  -H "Authorization: Bearer $PAT" \
  http://localhost:3000/api/media/sync-jobs | jq
```

Single job detail:

```bash
curl -sS \
  -H "Authorization: Bearer $PAT" \
  http://localhost:3000/api/media/sync-jobs/JOB_ID/result | jq
```

Recent activity fallback:

```bash
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  -c "SELECT id, action, entity_type, user_id, details, created_at FROM activity_log ORDER BY id DESC LIMIT 200;"
```

## 5. What to Capture

Record:

- affected metric name(s)
- route/provider labels involved
- first observed time and latest observed time
- whether the issue is ongoing or recovered
- related deploy/config/feature-flag changes
- one concrete failing example request/job

## 6. Exit Criteria

An observability incident is ready to close when:

1. the triggering metric has returned to normal range
2. the underlying route/provider has a confirmed successful test
3. follow-up work is recorded if the threshold or instrumentation needs tuning
