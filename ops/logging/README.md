# Structured Logging Stack Example

This directory contains a minimal Graylog stack for the `2.6.1` structured-log export milestone.

## What It Includes

- MongoDB for Graylog metadata
- OpenSearch for Graylog indexing/search
- Graylog with:
  - web UI on `http://localhost:9000`
  - GELF UDP/TCP listener ports published on `12201`

For the Loki/Promtail example, see:

- `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/docker-compose.loki.yml`
- `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/loki/loki.yml`
- `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/promtail/promtail.yml`
- `/Users/hamlin/Development/GitHub/hkrewson/collectZ/docs/wiki/36-Loki-and-Promtail-Structured-Logs.md`

For the syslog example, see:

- `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/docker-compose.syslog.yml`
- `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/syslog/collector.js`
- `/Users/hamlin/Development/GitHub/hkrewson/collectZ/docs/wiki/37-Syslog-Structured-Logs.md`

For the syslog example, see:

- `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/docker-compose.syslog.yml`
- `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/syslog/collector.js`
- `/Users/hamlin/Development/GitHub/hkrewson/collectZ/docs/wiki/37-Syslog-Structured-Logs.md`

## Assumptions

- collectZ is already running on the Docker network:
  - `collectz_internal`
  - or another name supplied with `APP_DOCKER_NETWORK`
- collectZ backend is configured with:
  - `LOG_EXPORT_BACKEND=gelf_udp`
  - `LOG_EXPORT_HOST=graylog`
  - `LOG_EXPORT_PORT=12201`
- the feature flag `external_log_export_enabled` is enabled before or during the smoke path

## Graylog Admin Password

Graylog expects the root password as a SHA-256 hash.

Generate one:

```bash
printf '%s' 'your-graylog-admin-password' | shasum -a 256
```

Then export:

```bash
export GRAYLOG_ROOT_PASSWORD_SHA2='your_sha256_here'
export GRAYLOG_HTTP_EXTERNAL_URI='http://127.0.0.1:9000/'
```

Also set a random password secret:

```bash
export GRAYLOG_PASSWORD_SECRET='replace-with-a-long-random-string'
```

## Start

```bash
docker compose -f ops/logging/docker-compose.graylog.yml up -d
```

## End-to-End Smoke Path

1. Recreate collectZ backend with log export pointed at Graylog:

```bash
LOG_EXPORT_BACKEND=gelf_udp \
LOG_EXPORT_HOST=graylog \
LOG_EXPORT_PORT=12201 \
docker compose --env-file .env up -d --build backend
```

2. Run the smoke script:

```bash
GRAYLOG_URL='http://localhost:9000' \
GRAYLOG_USERNAME='admin' \
GRAYLOG_PASSWORD='your-graylog-admin-password' \
ADMIN_EMAIL='your-admin-email' \
ADMIN_PASSWORD='your-admin-password' \
node backend/scripts/structured-log-smoke.js
```

The script will:

- create or reuse a `collectz-gelf-udp` input in Graylog
- log into collectZ as an admin
- enable `external_log_export_enabled` if needed
- trigger a deterministic `admin.feature_flag.update` audit event
- verify the exported event via Graylog search and, when needed, direct OpenSearch index inspection
- tag the triggering request with a deterministic `X-Request-Id` so verification matches the current run instead of historical sibling events
- wait through the backend feature-flag cache settle window after enabling export, so the emitted audit event reflects the live runtime gate instead of a stale flag read
- restore feature-flag state when possible

## Notes

- This is a local/internal stack example, not a hardened production deployment.
- Export failures should not affect collectZ request behavior; if Graylog is down, requests still succeed and `activity_log` still persists locally.

## Quick Diagnosis: `backend_off` / Env Drift

If the structured-log smoke says events are missing, check the backend runtime first before debugging Graylog.

1. Verify the running backend container has the expected exporter env:

```bash
docker compose --env-file .env exec -T backend sh -lc 'printf "backend=%s host=%s port=%s debug=%s\n" "$LOG_EXPORT_BACKEND" "$LOG_EXPORT_HOST" "$LOG_EXPORT_PORT" "$LOG_EXPORT_DEBUG"'
```

Expected for the Graylog path:

- `backend=gelf_udp`
- `host=graylog`
- `port=12201`

2. If you need proof of the app-side decision path, rebuild once with debug tracing:

```bash
APP_VERSION=2.6.0 \
LOG_EXPORT_BACKEND=gelf_udp \
LOG_EXPORT_HOST=graylog \
LOG_EXPORT_PORT=12201 \
LOG_EXPORT_DEBUG=1 \
docker compose --env-file .env up -d --build backend
```

3. Run the structured-log smoke, then inspect backend logs:

```bash
docker logs --tail 200 collectz-backend-1
```

Key interpretations:

- `[log-export-debug] skip.backend_off`
  - backend was rebuilt without the GELF env overrides
- `[log-export-debug] skip.feature_flag_disabled`
  - external export gate is still off for that event
- `[log-export-debug] emit.attempt`
  - app is attempting the collector send
- `[log-export-debug] emit.success`
  - transport send completed successfully
- `[log-export-debug] export.complete`
  - route-path export finished successfully

4. After diagnosis, return the backend to normal runtime noise levels:

```bash
APP_VERSION=2.6.0 \
LOG_EXPORT_BACKEND=gelf_udp \
LOG_EXPORT_HOST=graylog \
LOG_EXPORT_PORT=12201 \
LOG_EXPORT_DEBUG=0 \
docker compose --env-file .env up -d --build backend
```
