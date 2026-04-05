# Syslog Structured Logs

This page documents the syslog-compatible path for the `2.6.1` structured-log milestone.

## Goal

Provide a minimal RFC5424-compatible collector path using the native collectZ exporter rather than an intermediate log shipper.

collectZ now supports:

- `syslog_tcp`
- `syslog_udp`

The starter example uses `syslog_tcp` because it is easier to inspect deterministically in local development.

## Use This Example For

Treat the bundled syslog collector as:

- a local verification target,
- a way to prove collectZ can emit RFC5424-compatible structured events without an intermediate shipper.

Do not treat the included collector as hardened long-lived infrastructure. It intentionally favors inspectability over indexing, auth hardening, retention policy, or restore ergonomics.

For longer-lived syslog paths:

- run the collector on protected networking,
- use real secret and TLS handling where your collector supports it,
- define rotation and retention outside the app,
- and validate that collector availability never becomes a dependency for core app traffic.

## Compose Example

- Stack file:
  - `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/docker-compose.syslog.yml`
- Collector script:
  - `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/syslog/collector.js`

Render check:

```bash
docker compose -f /Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/docker-compose.syslog.yml config
```

## Backend Runtime Settings

For the syslog path, run the backend with:

```bash
APP_VERSION=2.6.0 \
LOG_EXPORT_BACKEND=syslog_tcp \
LOG_EXPORT_HOST=syslog-collector \
LOG_EXPORT_PORT=1514 \
LOG_EXPORT_DEBUG=0 \
docker compose --env-file .env up -d --build backend
```

The backend emits an RFC5424-style syslog line whose message body is the same JSON event used by the other exporter paths.

## Message Shape

The syslog exporter uses:

- RFC5424 header fields for timestamp, host, app name, and message id
- a `collectz@41058` structured-data block for selected searchable fields:
  - `action`
  - `entity_type`
  - `entity_id`
  - `user_id`
  - `request_id`
  - `route`
  - `method`
  - `outcome`
  - `detail_key`
- the full structured event JSON as the message body

This keeps syslog transport compatibility while preserving the richer event payload.

## Start

1. Start the syslog collector:

```bash
docker compose -f /Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/docker-compose.syslog.yml up -d
```

2. Enable `External Log Export` in `Admin -> Integrations -> External Logs`, then trigger a known audit event such as an admin feature-flag update.

## Verification

Useful checks:

1. Confirm backend exporter mode:

```bash
docker compose --env-file .env exec -T backend sh -lc 'printf "backend=%s host=%s port=%s\n" "$LOG_EXPORT_BACKEND" "$LOG_EXPORT_HOST" "$LOG_EXPORT_PORT"'
```

Expected:

- `backend=syslog_tcp`
- `host=syslog-collector`
- `port=1514`

2. Confirm the collector stack renders:

```bash
docker compose -f /Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/docker-compose.syslog.yml config
```

3. Confirm the collector is receiving current events:

```bash
docker exec logging-syslog-collector-1 tail -n 20 /var/log/collectz/collectz-syslog.log
```

You should see RFC5424 lines whose trailing message body contains the collectZ structured event JSON.

## Caveats

- The bundled collector is intentionally minimal and local-use only.
- It stores raw syslog lines for easy inspection, not indexing.
- `syslog_tcp` is the recommended local example because line framing is deterministic.
- `syslog_udp` is supported by the exporter, but local verification is less deterministic under bursty conditions.

## Fast Diagnosis

Start in `Admin -> Integrations -> External Logs`.

That runtime check will quickly tell you whether the running backend currently sees:

- the External Log Export toggle enabled,
- `LOG_EXPORT_BACKEND=syslog_tcp` or `syslog_udp`,
- the collector host and port you expect.

Then verify the collector itself:

1. `docker compose -f /Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/docker-compose.syslog.yml config`
2. `docker compose --env-file .env exec -T backend sh -lc 'printf "backend=%s host=%s port=%s\n" "$LOG_EXPORT_BACKEND" "$LOG_EXPORT_HOST" "$LOG_EXPORT_PORT"'`
3. `docker exec logging-syslog-collector-1 tail -n 20 /var/log/collectz/collectz-syslog.log`

If the UI toggle is on but the runtime check still shows `backend=off`, the backend env was not rebuilt/restarted with the intended exporter settings.
