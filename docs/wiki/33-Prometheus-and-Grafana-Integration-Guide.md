# Prometheus and Grafana Integration Guide

Use this guide to turn the `2.6.0` observability artifacts into a working first monitoring stack.

This repo does not currently ship a bundled Prometheus or Grafana compose stack.

The goal here is to make deployment straightforward for operators already running one of:

- Prometheus + Grafana
- Grafana Cloud with Prometheus-compatible scrape targets
- another PromQL-compatible monitoring system

Starter monitoring stack example:

- `ops/monitoring/docker-compose.monitoring.yml`

## What This Guide Connects

This guide ties together:

- metrics endpoint:
  - `docs/wiki/29-Metrics-and-Alerts.md`
- triage flow:
  - `docs/wiki/30-Observability-Triage-Runbook.md`
- dashboard layout:
  - `docs/wiki/31-Observability-Dashboard-Spec.md`
- alert rules:
  - `docs/wiki/32-Alert-Rules-Spec.md`
- rule artifact:
  - `docs/alerts/collectz-alert-rules.yaml`

## Prerequisites

Before wiring a monitoring stack, make sure the backend metrics surface is intentionally enabled.

Required conditions:

- `DEBUG>=1`
- feature flag `metrics_enabled=true`
- one of:
  - an authenticated admin path to `/api/metrics`
  - `METRICS_SCRAPE_TOKEN` for trusted internal scraping

The endpoint is:

- `/api/metrics`

If the gate is not satisfied, it returns `404`.

## Deployment Guidance

The current metrics endpoint is admin-only and intended for trusted internal monitoring access.

Recommended approach:

1. expose `/api/metrics` only on an internal network or admin-only reverse-proxy path
2. avoid publishing the metrics endpoint directly to the public internet
3. keep scrape traffic inside the same Docker network, VPN, or private ingress layer
4. prefer `METRICS_SCRAPE_TOKEN` over browser-style admin sessions for Prometheus scraping

This is the current dedicated machine credential model for metrics scraping.

## Suggested Rollout Order

1. enable metrics in a non-public environment
2. verify `/api/metrics` returns the expected Prometheus text format
3. add the scrape target in Prometheus or equivalent
4. import or recreate the first dashboard panels from:
   - `docs/wiki/31-Observability-Dashboard-Spec.md`
5. load the starter alert expressions from:
   - `docs/alerts/collectz-alert-rules.yaml`
6. run the thresholds in warning-only mode first
7. tune thresholds after at least several days of baseline observation

## Example Prometheus Scrape Config

This example assumes the monitoring system can reach the backend over an internal hostname.

```yaml
scrape_configs:
  - job_name: collectz
    metrics_path: /api/metrics
    scheme: http
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/secrets/collectz-metrics-token.txt
    static_configs:
      - targets:
          - backend:3001
```

If collectZ is behind a reverse proxy, adapt the target to the internal upstream or protected admin host.

Example:

```yaml
scrape_configs:
  - job_name: collectz
    metrics_path: /api/metrics
    scheme: https
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/secrets/collectz-metrics-token.txt
    static_configs:
      - targets:
          - collectz-admin.internal.example.com
```

For local/internal testing, the repo now also includes:

- `ops/monitoring/docker-compose.monitoring.yml`
- `ops/monitoring/prometheus/prometheus.yml`
- `ops/monitoring/grafana/provisioning/datasources/prometheus.yml`
- `ops/monitoring/prometheus/collectz-metrics-token.example.txt`

The monitoring compose file joins the collectZ app network and scrapes:

- `backend:3001`

By default it expects the app network to be:

- `collectz_internal`

Override that with:

- `APP_DOCKER_NETWORK=<your_network_name>`

## Authentication and Access Notes

The current route accepts either:

- admin-authenticated browser/API access
- `Authorization: Bearer <METRICS_SCRAPE_TOKEN>`

For Prometheus, use the dedicated scrape token path.

Practical options:

- same-network scrape path where the app is not publicly exposed
- private ingress restricted to internal operators
- reverse-proxy enforcement that only allows the monitoring network to reach `/api/metrics`

Do not treat the example scrape config above as sufficient internet-facing security by itself.

## Grafana Dashboard Setup

Use `docs/wiki/31-Observability-Dashboard-Spec.md` as the source of truth for the first dashboard.

Recommended first rows:

1. Service health
2. API traffic and failures
3. API latency
4. Auth outcomes
5. Import queue and outcomes
6. Admin mutation outcomes

When building the dashboard:

1. use `15m`, `1h`, and `24h` time presets
2. keep route labels visible in the traffic, failure, and latency panels
3. keep auth, import, and admin panels separate instead of collapsing them into one generic operational view
4. pin a build/version stat using `collectz_build_info`

## Alert Rule Setup

Use:

- `docs/alerts/collectz-alert-rules.yaml`

The current file is written in a Prometheus-style rule-group format and is intended to be adapted into:

- Prometheus rule files
- Grafana managed alerts
- another PromQL-compatible alerting layer

Recommended initial policy:

1. import the rules with the names kept stable
2. start with notification routing that is visible but non-paging
3. confirm each alert maps back to:
   - `docs/wiki/30-Observability-Triage-Runbook.md`
4. tune severity and thresholds only after collecting baseline production data

## First Validation Checks

After wiring the stack, verify:

1. `collectz_build_info` is visible
2. `collectz_http_requests_total` increases during normal UI/API traffic
3. `collectz_http_request_duration_ms_bucket` is populated
4. `collectz_auth_events_total` changes on login success and failure
5. `collectz_import_jobs_total` changes when an import is queued and completed
6. `collectz_sync_jobs` shows non-zero counts when jobs are active

If a recent import exists in the database but expected metric series are missing, verify the running backend image includes the latest instrumentation before tuning the dashboard. A stale backend image can make Grafana look empty even when Prometheus scraping is healthy.

Examples:

- `csv_delicious` job rows exist in `sync_jobs` but `collectz_import_jobs_total{provider="csv_delicious"}` is absent
- provider-backed imports ran, but `collectz_provider_requests_total` never appears

## Recommended Baseline Period

Before treating the initial thresholds as paging-grade policy, collect at least:

- 3 to 7 days of normal traffic for small deployments
- 1 to 2 weeks for environments with bursty imports or infrequent admin operations

During that window:

- record expected auth failure background noise
- note normal import queue spikes
- identify naturally slow routes before tightening p95 thresholds

## Known Limits

Current observability scope is intentionally small.

This first rollout does not yet include:

- dashboard JSON exports
- automatic alert delivery configuration
- log aggregation setup
- per-query database latency instrumentation
- provider-specific enrichment miss metrics beyond the current import outcome layer

## Follow-Up Candidates

Later `2.6.x` work can add:

- exported dashboard JSON artifacts
- example reverse-proxy protection for `/api/metrics`
- metrics scrape authentication guidance specific to the deployed ingress model
- dashboard screenshots or provisioning manifests
