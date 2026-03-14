# Syslog Structured Logs

This page documents the syslog-compatible path for the `2.6.1` structured-log milestone.

## Goal

Provide a minimal RFC5424-compatible collector path using the native collectZ exporter rather than an intermediate log shipper.

collectZ now supports:

- `syslog_tcp`
- `syslog_udp`

The starter example uses `syslog_tcp` because it is easier to inspect deterministically in local development.

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

2. Enable `external_log_export_enabled`, then trigger a known audit event such as an admin feature-flag update.

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
