# Observability Dashboard Spec

Use this as the first dashboard definition for `2.6.0`.

The goal is not visual polish. The goal is fast incident recognition for:

- API failures
- latency regressions
- auth degradation
- import backlog/failures
- admin mutation regressions

## Dashboard Scope

The first dashboard should cover a rolling `15m`, `1h`, and `24h` view.

Recommended sections:

1. Service health
2. API traffic and failures
3. API latency
4. Auth outcomes
5. Import queue and outcomes
6. Import enrichment detail
7. Import quality ratios
8. Provider error detail
9. Provider request outcomes
10. Admin mutation outcomes

## Panel Layout

### Row 1: Service Health

#### Panel 1. Build Info

Purpose:

- confirm the running version during incident triage

Metric:

- `collectz_build_info`

Display:

- stat panel

#### Panel 2. Current Sync Jobs by Status

Purpose:

- see whether jobs are piling up in `queued` or `running`

Metric:

- `collectz_sync_jobs`

Display:

- stacked bar or table by `status`

## Row 2: API Traffic and Failures

#### Panel 3. API Request Volume by Route/Status Class

Purpose:

- show which routes are active and whether failures are concentrated

Starter query:

```promql
sum by (route, status_class) (
  rate(collectz_http_requests_total[5m])
)
```

Display:

- stacked time series

#### Panel 4. API Failure Rate by Route

Purpose:

- highlight routes crossing the initial failure thresholds

Starter query:

```promql
sum by (route) (
  rate(collectz_http_request_failures_total[5m])
)
/
sum by (route) (
  rate(collectz_http_requests_total[5m])
)
```

Display:

- time series
- top-N table for worst routes

#### Panel 5. Exact API Failure Count by Route/Status

Purpose:

- distinguish `401/403` auth noise from `5xx` incidents

Starter query:

```promql
sum by (route, status) (
  rate(collectz_http_request_failures_total[5m])
)
```

Display:

- table

## Row 3: API Latency

#### Panel 6. Request Duration p95 by Route

Purpose:

- catch latency regressions early

Starter query:

```promql
histogram_quantile(
  0.95,
  sum by (le, route) (
    rate(collectz_http_request_duration_ms_bucket[5m])
  )
)
```

Display:

- time series

Recommended focus routes:

- `/api/auth/login`
- `/api/auth/me`
- `/api/media`
- `/api/media/import-plex`
- `/api/media/sync-jobs/:id`
- `/api/admin/users/:id/role`

#### Panel 7. Slowest Routes (p95)

Purpose:

- rank the routes most likely to need optimization or triage

Starter query:

```promql
topk(
  10,
  histogram_quantile(
    0.95,
    sum by (le, route) (
      rate(collectz_http_request_duration_ms_bucket[5m])
    )
  )
)
```

Display:

- bar gauge or table

## Row 4: Auth Outcomes

#### Panel 8. Login Success vs Failure

Purpose:

- detect auth regressions and suspicious spikes

Starter query:

```promql
sum by (outcome) (
  rate(collectz_auth_events_total{action="login"}[5m])
)
```

Display:

- stacked time series

#### Panel 9. Password Reset Consume Outcomes

Purpose:

- spot reset-link breakage or token misuse

Starter query:

```promql
sum by (outcome) (
  rate(collectz_auth_events_total{action="password_reset_consume"}[5m])
)
```

Display:

- time series

## Row 5: Import Queue and Outcomes

#### Panel 10. Import Outcomes by Provider

Purpose:

- show queued/succeeded/failed state transitions

Starter query:

```promql
sum by (provider, status) (
  increase(collectz_import_jobs_total[$__range])
)
```

Display:

- stacked bar chart or table

Tuning note:

- imports are usually bursty and low-frequency, so `increase(...[$__range])` is more readable than a short `rate(...)` window

#### Panel 11. Current Queue Pressure

Purpose:

- show whether jobs are accumulating instead of draining

Starter query:

```promql
collectz_sync_jobs{status=~"queued|running|failed"}
```

Display:

- table or stat panels grouped by `status`

## Row 6: Import Enrichment Detail

#### Panel 12. Import Enrichment Outcomes

Purpose:

- show whether import jobs are matching and enriching cleanly by provider
- separate pipeline no-match behavior from TMDB poster misses and other enrichment categories

Starter query:

```promql
sum by (provider, kind, outcome) (
  increase(collectz_import_enrichment_total[$__range])
)
```

Display:

- stacked bar chart or table

## Row 7: Import Quality Ratios

#### Panel 13. Delicious No-Match Ratio

Purpose:

- make Delicious import match quality visible without treating raw `no_match` counts as failures
- help tune the `CollectZDeliciousNoMatchRatioHigh` warning against real data

Starter query:

```promql
100 * (
  sum(increase(collectz_import_enrichment_total{provider="csv_delicious",kind="pipeline",outcome="no_match"}[$__range]))
  /
  clamp_min(
    sum(increase(collectz_import_enrichment_total{provider="csv_delicious",kind="pipeline",outcome=~"enriched|no_match"}[$__range])),
    1
  )
)
```

Display:

- stat panel with sparkline
- unit: percent

#### Panel 14. Tracked Import Quality Ratios

Purpose:

- provide a compact row for provider-specific quality ratios
- start with Delicious no-match ratio and expand as additional provider-specific quality signals prove useful

Starter query:

```promql
100 * (
  sum(increase(collectz_import_enrichment_total{provider="csv_delicious",kind="pipeline",outcome="no_match"}[$__range]))
  /
  clamp_min(
    sum(increase(collectz_import_enrichment_total{provider="csv_delicious",kind="pipeline",outcome=~"enriched|no_match"}[$__range])),
    1
  )
)
```

Display:

- bar gauge
- unit: percent

## Row 8: Provider Error Detail

#### Panel 15. Top Provider Error Outcomes

Purpose:

- surface the noisiest non-success upstream outcomes without making operators scan the full provider panel
- distinguish common `http_404` background misses from rarer transport or `5xx` incidents

Starter query:

```promql
topk(
  10,
  sum by (provider, operation, outcome) (
    increase(collectz_provider_requests_total{outcome!="success"}[$__range])
  )
)
```

Display:

- table

## Row 9: Provider Request Outcomes

#### Panel 16. Provider Request Outcomes

Purpose:

- show whether TMDB, Plex, and Metron are succeeding, throttling, or failing upstream
- separate provider API issues from application-side import logic issues

Starter query:

```promql
sum by (provider, operation, outcome) (
  increase(collectz_provider_requests_total[$__range])
)
```

Display:

- stacked bar chart or table

## Row 10: Admin Mutations

#### Panel 17. Admin Mutation Success vs Failure

Purpose:

- catch admin-only regressions caused by validation, permissions, or feature flags

Starter query:

```promql
sum by (route, outcome) (
  rate(collectz_admin_actions_total[5m])
)
```

Display:

- table

## Threshold Mapping

Map these panels directly to the threshold doc:

- API failures:
  - Panel 4
  - Panel 5
- API latency:
  - Panel 6
  - Panel 7
- Auth failures:
  - Panel 8
  - Panel 9
- Import degradation:
  - Panel 10
  - Panel 11
  - Panel 12
  - Panel 13
  - Panel 14
- Provider request issues:
  - Panel 15
  - Panel 16
- Admin mutation failures:
  - Panel 17

Reference:

- `docs/wiki/29-Metrics-and-Alerts.md`
- `docs/wiki/30-Observability-Triage-Runbook.md`

## Implementation Notes

When this dashboard is created in the actual monitoring stack:

1. keep route labels normalized exactly as exported by the backend
2. do not collapse auth/import/admin panels into one generic error dashboard
3. keep `15m` as the default view during early rollout
4. revisit panel noise after at least one week of baseline data

Starter artifact:

- `ops/monitoring/grafana/dashboards/collectz-overview.json`
