# Metrics and Alerts

`2.6.0` begins the observability rollout with a small Prometheus-style metrics surface.

## Metrics Endpoint

- `/api/metrics`

Current access rules:

- authenticated admin user
- or `Authorization: Bearer <METRICS_SCRAPE_TOKEN>` for trusted internal scrapers
- `DEBUG>=1`
- feature flag `metrics_enabled=true`

If the gate is not satisfied, the endpoint returns `404`.

## Current Exported Signals

- `collectz_build_info`
- `collectz_http_requests_total`
- `collectz_http_request_failures_total`
- `collectz_http_request_duration_ms`
- `collectz_auth_events_total`
- `collectz_import_jobs_total`
- `collectz_import_enrichment_total`
- `collectz_provider_requests_total`
- `collectz_admin_actions_total`
- `collectz_sync_jobs`

## Current Coverage

The first rollout focuses on:

- API request volume and failure shape
- request latency buckets by route
- auth success/failure outcomes
- import queue/success/failure lifecycle
- import enrichment outcomes by provider and enrichment kind
- import quality ratios for Delicious and future provider-specific signals
- provider error detail for non-success TMDB, Plex, and Metron outcomes
- provider request outcomes for TMDB, Plex, and Metron
- admin mutation success/failure counts
- live sync-job status counts from the database

## Initial Alert Thresholds

These are starting thresholds, not final SLOs.

Use a rolling 5-minute window unless otherwise noted.

### API failure rate

Alert when either condition is true:

- `collectz_http_request_failures_total` shows sustained `5xx` growth on the same route for 5 minutes
- failure ratio exceeds `5%` for a high-traffic route

Suggested first focus routes:

- `/api/auth/login`
- `/api/auth/me`
- `/api/media`
- `/api/media/import-plex`
- `/api/media/sync-jobs/:id`

### API latency

Alert when:

- p95 of `collectz_http_request_duration_ms` exceeds `1000ms` for read-heavy routes for 10 minutes
- p95 exceeds `2500ms` for mutating admin/import routes for 10 minutes

### Auth failures

Alert when:

- `collectz_auth_events_total{action="login",outcome="failed"}` spikes sharply relative to recent baseline
- password reset consume failures grow continuously for 10 minutes

This is primarily a credential-stuffing, client breakage, or token misuse signal.

### Import degradation

Alert when:

- `collectz_import_jobs_total{status="failed"}` increases for the same provider more than `3` times in `15` minutes
- `collectz_sync_jobs{status="running"}` remains elevated without corresponding success completions for `15` minutes
- `collectz_sync_jobs{status="queued"}` keeps growing for `10` minutes

Observed baseline from a successful Delicious import:

- `1282` pipeline `enriched`
- `257` pipeline `no_match`
- `0` hard import errors

Interpretation:

- a meaningful `no_match` count is normal for Delicious imports
- do not treat raw `no_match` totals as an incident by themselves
- prefer ratio-based warning thresholds after at least `100` processed items
- a starter warning threshold of roughly `35%` `no_match` is reasonable until we gather more samples
- use a compact dashboard row for tracked quality ratios so provider-specific signals stay visible as we add more of them

### Admin mutation failures

Alert when:

- `collectz_admin_actions_total{outcome="failed"}` grows for the same route more than `5` times in `10` minutes

This is usually configuration drift, validation breakage, or permission regression.

## Dashboards

The first dashboard should include:

1. total API traffic by route/status class
2. API failure count by route/status
3. API request duration by route
4. auth success vs failure counts
5. import queued/succeeded/failed counts by provider
6. import enrichment outcomes by provider/kind/outcome
7. import quality ratios for Delicious and future provider-specific signals
8. top provider error outcomes by provider/operation/outcome
9. provider request outcomes by provider/operation/outcome
10. current sync-job status gauge
11. admin mutation success vs failure counts

For low-frequency background work like imports, enrichment, and provider API activity:

- prefer windowed `increase(...)` panels over short `rate(...[5m])` panels
- use `rate(...)` mainly for high-volume request traffic
- expect `15m` views to look quiet after a completed batch import; `1h` and `24h` are more informative

Dashboard spec:

- `docs/wiki/31-Observability-Dashboard-Spec.md`
- baseline tuning log:
  - `docs/wiki/34-Observability-Baseline-Tuning-Log.md`
- stack integration:
  - `docs/wiki/33-Prometheus-and-Grafana-Integration-Guide.md`

## Triage

Use:

- `docs/wiki/30-Observability-Triage-Runbook.md`
- `docs/wiki/32-Alert-Rules-Spec.md`
- `docs/wiki/33-Prometheus-and-Grafana-Integration-Guide.md`

## Planned Follow-Up

Later `2.6.0` slices should add:

- tuned thresholds after a baseline observation period
