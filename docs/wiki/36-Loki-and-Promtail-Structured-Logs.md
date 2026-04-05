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

## Use This Example For

This repo’s Loki/Promtail material is best treated as:

- a local or protected-internal proof that `stdout_json` export reaches Grafana/Loki tooling,
- a starter pattern for teams who already understand Loki retention, storage, and secret handling.

It is not a complete hardened deployment by itself.

For longer-lived use:

- keep Loki/Grafana on private networking or protected ingress,
- move any example credentials out of compose defaults,
- decide retention and backup policy for Loki storage up front,
- and remember that Promtail is scraping a mixed stdout stream unless you separate it intentionally.

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

## Fast Diagnosis

Start in `Admin -> Integrations -> External Logs`.

That runtime check tells you whether the running backend currently sees:

- `LOG_EXPORT_BACKEND=stdout_json`
- the External Log Export toggle enabled
- exporter debug tracing on or off

Then confirm the collector side:

1. `docker compose -f /Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/docker-compose.loki.yml config`
2. `docker logs --tail 100 collectz-backend-1`
3. Promtail/Loki ingestion in Grafana or Loki query UI

Common drift patterns:

- Metrics/logging docs were followed, but the backend was not rebuilt with `LOG_EXPORT_BACKEND=stdout_json`
- External Log Export is still off in Admin -> Integrations
- Promtail is healthy, but operators expect only structured JSON while plaintext request lines are still mixed into stdout

## Retention and Restore Notes

If you want Loki history to survive container replacement, persist Loki storage intentionally and document its backup path. Promtail positions and Grafana state may also need persistence depending on how much operator continuity you want after restore.
