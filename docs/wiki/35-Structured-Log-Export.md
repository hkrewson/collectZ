# Structured Log Export

This page tracks the `2.6.1` structured-log export rollout.

## Current Implementation Slice

The initial slice adds:

- canonical GELF event building aligned to `/Users/hamlin/Development/GitHub/hkrewson/collectZ/docs/wiki/22-Logging-and-Observability-Contract.md`
- a feature-flagged external log export path
- non-blocking exporter behavior so failed log shipping does not break API or import behavior
- backend targets:
  - `gelf_udp`
  - `gelf_tcp`
  - `stdout_json` (debug/testing helper)
  - `syslog_udp`
  - `syslog_tcp`

The existing `activity_log` database write remains the primary audit sink. External export is additive.

## Current Gaps

This first slice does not yet include:

- richer cross-service correlation beyond backend request-id generation and pass-through

Those remain part of the broader `2.6.1` milestone.

## Runtime Controls

- Integrations setting:
  - `External Logs -> External Log Export` in `Admin -> Integrations`
- Environment variables:
  - `LOG_EXPORT_BACKEND`
  - `LOG_EXPORT_HOST`
  - `LOG_EXPORT_PORT`
  - `LOG_EXPORT_HOST_LABEL`
  - `LOG_EXPORT_SERVICE`
  - `LOG_EXPORT_DEBUG`
  - `LOG_EXPORT_MAX_DETAIL_BYTES`
  - `GIT_SHA`

Current control surface note:

- The current shipped operator path is now split in a narrower, milestone-scoped way:
  - Integrations owns whether export is enabled.
  - `2.9.9` now begins moving common endpoint settings into `Admin -> Integrations -> External Logs`.
  - The first control-plane slice owns:
    - backend / transport
    - collector host
    - collector port
  - Runtime env still owns:
    - `LOG_EXPORT_HOST_LABEL`
    - `LOG_EXPORT_SERVICE`
    - `LOG_EXPORT_DEBUG`
    - `LOG_EXPORT_MAX_DETAIL_BYTES`
- Optional immutable-runtime mode:
  - `LOG_EXPORT_SETTINGS_READ_ONLY=true`
  - when set, UI endpoint fields are read-only and the running env remains authoritative for backend/host/port

## Local Graylog Example

- Compose stack:
  - `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/docker-compose.graylog.yml`
- Setup/runbook:
  - `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/README.md`
- End-to-end smoke script:
  - `/Users/hamlin/Development/GitHub/hkrewson/collectZ/backend/scripts/structured-log-smoke.js`

## Local Example vs Hardened Operator Guidance

The Graylog, Loki/Promtail, and syslog materials in this repo are not all equal in intent.

- Local/example guidance:
  - starter compose files under `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging`
  - localhost-published ports
  - inline secrets or example passwords
  - smoke-driven proof that collectZ can emit structured events without blocking app traffic
- Hardened operator guidance:
  - keep collectors on private networks or protected ingress paths
  - treat collector credentials, Graylog password secret material, and any Grafana/Prometheus scrape credentials as real secrets
  - persist collector/index state intentionally and document how that state is backed up and restored
  - assume collector outages or bad routing happen, and verify that collectZ keeps serving API/import work even when export fails

For longer-lived deployments, start with the example stacks only as proof-of-wiring, then move the collector behind private networking, durable volumes, and operator-owned secret management.

## Fast Diagnosis in Admin -> Integrations

`Admin -> Integrations -> External Logs` now shows runtime checks sourced from the running backend container.

It also begins exposing the common control-plane endpoint fields for the common case:

- backend / transport
- collector host
- collector port

Use that view before debugging the collector itself.

It answers:

- whether the Integration toggle is on,
- which `LOG_EXPORT_BACKEND` the backend is actually using,
- which collector host/port the running container sees,
- whether export debug tracing is on,
- and whether the current runtime combination needs attention.

This is the fastest way to catch drift such as:

- `External Log Export` enabled in the UI while `LOG_EXPORT_BACKEND=off`,
- a collector host that still points at loopback inside Docker,
- `stdout_json` output being enabled without realizing it shares the normal backend stdout stream,
- or a collector path that is expected to fail over cleanly but has not been verified against the current runtime.

## Loki/Promtail Example

- Operator guide:
  - `/Users/hamlin/Development/GitHub/hkrewson/collectZ/docs/wiki/36-Loki-and-Promtail-Structured-Logs.md`
- Stack file:
  - `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/docker-compose.loki.yml`
- Smoke script:
  - `/Users/hamlin/Development/GitHub/hkrewson/collectZ/backend/scripts/structured-log-loki-smoke.js`
- Loki config:
  - `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/loki/loki.yml`
- Promtail config:
  - `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/promtail/promtail.yml`

## Syslog Example

- Operator guide:
  - `/Users/hamlin/Development/GitHub/hkrewson/collectZ/docs/wiki/37-Syslog-Structured-Logs.md`
- Stack file:
  - `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/docker-compose.syslog.yml`
- Smoke script:
  - `/Users/hamlin/Development/GitHub/hkrewson/collectZ/backend/scripts/structured-log-syslog-smoke.js`
- Collector script:
  - `/Users/hamlin/Development/GitHub/hkrewson/collectZ/ops/logging/syslog/collector.js`

## Current Graylog Behavior

The current Graylog path is verified end to end for GELF UDP export.

Important behavior notes:

- collectZ emits underscore-prefixed GELF extension fields as defined in:
  - `/Users/hamlin/Development/GitHub/hkrewson/collectZ/docs/wiki/22-Logging-and-Observability-Contract.md`
- Graylog search results normalize those fields for display by dropping the leading underscore
- Graylog surfaces GELF `host` as `source`
- Graylog surfaces GELF `short_message` as `message`
- Graylog currently displays `_details` as a serialized JSON string rather than a nested object in search results
- selected whitelisted detail keys are also promoted into first-class searchable GELF fields
  - current examples:
    - `detail_key`
    - `detail_reason`
    - `detail_previous_enabled`
    - `detail_next_enabled`
    - `detail_requested_enabled`
    - `detail_env_override`
- promoted boolean values are emitted as lowercase strings and null promoted values are omitted
- request-scoped events now carry a stable `_request_id` sourced from the incoming `X-Request-Id` header or generated by backend middleware

So when validating a shipped event in Graylog, compare against the Graylog-visible shape, not only the raw emitted field names.

## Verification Notes

Graylog search and stored-index visibility are not always identical for every ad hoc query shape.

The smoke path therefore prefers:

1. Graylog API search when it finds the expected event
2. OpenSearch index inspection as a fallback verification path

That keeps the verification focused on actual stored documents instead of over-trusting Graylog query semantics for dotted message names.

## Failure Behavior

- exporter errors are swallowed after a warning log
- primary DB-backed audit logging still runs
- request/import behavior must not fail because a log endpoint is unavailable

Repeatable failure-contract smoke:

- `/Users/hamlin/Development/GitHub/hkrewson/collectZ/backend/scripts/structured-log-nonblocking-smoke.js`

Use it after pointing the backend at an intentionally unreachable TCP collector target. The smoke proves:

- the admin mutation still succeeds,
- a new `activity_log` row still lands in Postgres,
- `/api/health` stays healthy,
- and exporter failure remains additive instead of becoming a hidden availability dependency.

## Persistence and Backup Expectations

collectZ itself does not depend on the external collector to retain audit history. The primary durable audit sink remains:

- `activity_log` in the collectZ database

If you choose to keep external structured logs long term, treat collector state as separately durable operator data.

- Graylog/OpenSearch:
  - back up the OpenSearch indices and Graylog metadata store if you want retained search history after failure
- Loki/Promtail:
  - retain Loki storage intentionally if you want historical queries to survive container replacement
- Syslog example collector:
  - the bundled collector is intentionally local and minimal; do not treat it as a hardened retention target

Rotation/restoration note:

- changing collector endpoints, passwords, tokens, or persistent volumes can make older dashboards/search paths look empty even when collectZ is still exporting correctly
- confirm both the running backend env and the collector’s retained state after any restore or secret rotation

Example-stack rehearsal:

- run:
  - `bash ops/logging/verify-graylog-persistence.sh`
- that verifies the named Graylog, MongoDB, and OpenSearch volumes survive a normal `docker compose down` / `up -d` cycle
- treat `docker compose down -v` as the destructive reset path for the bundled Graylog example
