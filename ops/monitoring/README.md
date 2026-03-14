# Monitoring Stack Example

This directory contains a minimal Prometheus + Grafana example for the `2.6.0` observability rollout.

## What It Includes

- Prometheus scrape config for collectZ metrics
- Prometheus rule loading for:
  - `../../docs/alerts/collectz-alert-rules.yaml`
- Grafana datasource provisioning for Prometheus
- Grafana dashboard provisioning for:
  - `grafana/dashboards/collectz-overview.json`

## What It Does Not Include

- collectZ application containers
- prebuilt Grafana dashboard JSON
- ingress/auth hardening for production monitoring

## Assumptions

This example assumes:

- collectZ backend is already running in Docker
- the collectZ app network is reachable as:
  - `collectz_internal`
  - or another name provided through `APP_DOCKER_NETWORK`
- collectZ metrics are enabled:
  - `DEBUG>=1`
  - `metrics_enabled=true`
- collectZ backend has `METRICS_SCRAPE_TOKEN` set
- `ops/monitoring/prometheus/collectz-metrics-token.txt` contains the same token value

## Start

Before starting:

1. set `METRICS_SCRAPE_TOKEN` in your collectZ backend environment
2. create:
   - `ops/monitoring/prometheus/collectz-metrics-token.txt`
3. put the same token value in that file
4. if your app Docker network is not `collectz_internal`, set:
   - `APP_DOCKER_NETWORK=your_actual_network_name`

You can start from:

```bash
cp ops/monitoring/prometheus/collectz-metrics-token.example.txt \
  ops/monitoring/prometheus/collectz-metrics-token.txt
```

Then replace the placeholder with your real token.

Start the monitoring stack:

```bash
docker compose -f ops/monitoring/docker-compose.monitoring.yml up -d
```

## Endpoints

- Prometheus:
  - `http://localhost:9090`
- Grafana:
  - `http://localhost:3002`

Default Grafana credentials:

- username:
  - `admin`
- password:
  - `admin`

Override with:

- `GRAFANA_ADMIN_USER`
- `GRAFANA_ADMIN_PASSWORD`

## Next Steps

1. Verify Prometheus can scrape `collectz` at `http://localhost:9090/targets`
2. Build the first dashboard using:
   - the pre-provisioned `collectZ Overview` dashboard
   - `../../docs/wiki/31-Observability-Dashboard-Spec.md` for further tuning
3. Review and adapt alert expressions from:
   - `../../docs/alerts/collectz-alert-rules.yaml`
4. Tune thresholds after baseline collection

## Troubleshooting

If Prometheus is healthy but expected series are missing:

- verify the running backend container was rebuilt/restarted after the metric was added
- check the raw metrics text from the running stack before assuming Grafana is the problem

Example symptoms of a stale backend image:

- `collectz_import_jobs_total` shows `plex` or `metron` but not `csv_delicious`
- `collectz_provider_requests_total` is absent even though TMDB/Plex/Metron activity occurred

When that happens, rebuild and restart the backend container before tuning dashboards or alerts.

## Production Note

This is a starter example for local or protected internal use.

For production, add:

- private networking or protected ingress
- persistent secret management
- hardened Grafana auth
- backups for Prometheus/Grafana data if needed
