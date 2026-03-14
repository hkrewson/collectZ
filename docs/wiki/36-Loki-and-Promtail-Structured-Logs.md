# Loki and Promtail Structured Logs

This page documents the Loki/Promtail-compatible path for the `2.6.1` structured-log milestone.

## Goal

Provide a Grafana-stack-friendly log collection path without changing the application exporter surface.

collectZ already supports:

- `stdout_json`
- `gelf_udp`
- `gelf_tcp`

The Loki path uses `stdout_json` and has Promtail scrape the backend container logs.

The starter Loki config disables old-sample rejection for local use so first boot can ingest existing backend container logs without looking broken. That is intentional for this local operator path, not a production recommendation.

## Compose Example

- Stack file:
  - `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/docker-compose.loki.yml`
- Loki config:
  - `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/loki/loki.yml`
- Promtail config:
  - `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/promtail/promtail.yml`

Render check:

```bash
docker compose -f /Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/docker-compose.loki.yml config
```

## Backend Runtime Settings

For the Loki/Promtail path, run the backend with:

```bash
LOG_EXPORT_BACKEND=stdout_json
LOG_EXPORT_DEBUG=0
```

The exported event is written as a JSON log line to backend stdout. Promtail scrapes the backend container logs and forwards those lines to Loki.

## What Promtail Extracts

The starter Promtail config parses the backend container log stream and extracts these fields from structured log lines when present:

- `service`
- `action`
- `entity_type`
- `outcome`
- `detail_key`
- `request_id`

Current label choices in the starter config:

- `service`
- `action`
- `entity_type`
- `outcome`
- `detail_key`

Note:

- `request_id` is intentionally not promoted to a label in the starter example because it is high-cardinality.
- You can still query it from the parsed log payload in Loki/Grafana.

## Start

1. Rebuild backend for `stdout_json` export:

```bash
APP_VERSION=2.6.0 \
LOG_EXPORT_BACKEND=stdout_json \
LOG_EXPORT_DEBUG=0 \
docker compose --env-file .env up -d --build backend
```

2. Start Loki/Promtail:

```bash
docker compose -f /Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/docker-compose.loki.yml up -d
```

3. Trigger a known audit event, for example the structured-log smoke or an admin feature-flag update.

## Verification

Useful checks:

1. Confirm backend exporter mode:

```bash
docker compose --env-file .env exec -T backend sh -lc 'printf "backend=%s\n" "$LOG_EXPORT_BACKEND"'
```

Expected:

- `backend=stdout_json`

2. Confirm Promtail config renders:

```bash
docker compose -f /Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/docker-compose.loki.yml config
```

3. Confirm the backend is writing structured JSON lines to stdout:

```bash
docker logs --tail 100 collectz-backend-1
```

You should see normal request logs plus JSON lines for exported structured events.

## Caveats

- This starter path scrapes mixed backend stdout:
  - normal plaintext request logs
  - structured JSON export lines
- Promtail’s JSON stage only extracts fields from lines that are valid JSON; plaintext request logs are still ingested but will not have structured fields.
- If you want a cleaner separation later, the next refinement would be:
  - route structured export to a dedicated stream,
  - or split general request logging from structured export output.
