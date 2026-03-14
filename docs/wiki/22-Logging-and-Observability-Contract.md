# Logging and Observability Contract

This document defines the canonical structured logging contract for external log shipping.

## Canonical GELF Schema (collectZ)

All shipped events MUST be valid GELF `1.1` with collectZ extensions.

This section describes the canonical payload emitted by collectZ before collector-specific ingestion or display normalization.

### Required GELF base fields

- `version`: always `"1.1"`.
- `host`: service identity (for example `collectz-backend`).
- `short_message`: concise action/event name (for example `request.failed`).
- `timestamp`: Unix epoch seconds with milliseconds precision.
- `level`: syslog-compatible severity integer.

### Standard collectZ extension fields (emit contract)

- `_service`: constant service label (`backend`).
- `_env`: deployment environment (`dev`, `test`, `prod`).
- `_app_version`: semantic version string.
- `_git_sha`: build git SHA (short or full).
- `_action`: canonical action name from activity/audit system.
- `_entity_type`: domain entity (`media`, `user`, `invite`, `http_request`, etc).
- `_entity_id`: numeric entity id when present.
- `_user_id`: numeric actor id when present.
- `_ip_address`: request source IP when available.
- `_request_id`: correlation id for request-scoped traces.

Request-id behavior:

- collectZ accepts an incoming `X-Request-Id` header when present
- otherwise collectZ generates a request id at the start of request processing
- the active request id is echoed back on the response as `X-Request-Id`
- request-scoped audit/exported GELF events use that same request id
- `_route`: API route path (for request events).
- `_method`: HTTP method (for request events).
- `_status`: HTTP response status (for request events).
- `_duration_ms`: request or job duration in milliseconds when available.
- `_outcome`: normalized result (`success`, `failed`, `denied`, `partial`).
- `_details`: redacted details payload (JSON object) at emit time.

Fields with unavailable values are omitted from the emitted GELF payload instead of being sent as explicit `null` values.

### Promoted detail fields (current whitelist)

For selected high-value audit details, collectZ also promotes scalar values into first-class GELF extension fields so they remain searchable in Graylog without parsing the serialized `details` blob.

Current promoted fields:

- `_detail_key`: promoted from `details.key`
- `_detail_reason`: promoted from `details.reason`
- `_detail_previous_enabled`: promoted from `details.previousEnabled`
- `_detail_next_enabled`: promoted from `details.nextEnabled`
- `_detail_requested_enabled`: promoted from `details.requestedEnabled`
- `_detail_env_override`: promoted from `details.envOverride`

Promotion rules:

- only explicitly whitelisted keys are promoted
- only scalar values are promoted
- null values are omitted from promoted top-level fields
- boolean values are promoted as lowercase strings (`"true"` / `"false"`) for Graylog-safe indexing
- nested objects and arrays remain only inside `_details`
- `_details` remains authoritative and is still emitted in full, subject to truncation and redaction rules

### Severity mapping (`level`)

- `3` (`error`): server failures, import failures, unhandled exceptions.
- `4` (`warning`): denied actions (`403`), auth/csrf failures, provider degradation.
- `6` (`info`): successful admin mutations, import starts/completions, auth login/logout.
- `7` (`debug`): optional deep diagnostics (disabled by default in production).

### Redaction policy (mandatory)

The following MUST NOT appear in `_details` (or any GELF field):

- raw API keys/tokens/secrets/passwords.
- session tokens, reset tokens, invite raw tokens.
- authorization headers and bearer values.

Allowed pattern: masked values only (for example `****abcd`) and boolean `...Set` flags.

### Example event (integration update)

```json
{
  "version": "1.1",
  "host": "collectz-backend",
  "short_message": "admin.settings.integrations.update",
  "timestamp": 1772356982.527,
  "level": 6,
  "_service": "backend",
  "_env": "prod",
  "_app_version": "2.0.0",
  "_git_sha": "abc1234",
  "_action": "admin.settings.integrations.update",
  "_entity_type": "app_integrations",
  "_entity_id": 1,
  "_user_id": 5,
  "_ip_address": "192.168.65.1",
  "_outcome": "success",
  "_details": {
    "tmdbPreset": "tmdb",
    "plexPreset": "plex",
    "keyUpdates": { "tmdb": false, "plex": false },
    "keyClears": { "tmdb": false, "plex": false }
  }
}
```

## Graylog Ingestion and Display Notes

When Graylog ingests the emitted GELF payload, its stored/search-visible message fields do not exactly mirror the emitted JSON.

### Field normalization observed in Graylog

Graylog search results normalize collectZ GELF extension fields by dropping the leading underscore from custom fields. For example:

- `_service` is displayed as `service`
- `_env` is displayed as `env`
- `_app_version` is displayed as `app_version`
- `_action` is displayed as `action`
- `_entity_type` is displayed as `entity_type`
- `_entity_id` is displayed as `entity_id`
- `_user_id` is displayed as `user_id`
- `_ip_address` is displayed as `ip_address`
- `_request_id` is displayed as `request_id`
- `_route` is displayed as `route`
- `_method` is displayed as `method`
- `_status` is displayed as `status`
- `_duration_ms` is displayed as `duration_ms`
- `_outcome` is displayed as `outcome`

Base GELF fields remain recognizable in Graylog search results:

- `host` is surfaced as Graylog `source`
- `short_message` is surfaced as Graylog `message`
- `timestamp` remains `timestamp`
- `level` remains `level`

### `_details` behavior in Graylog

At emit time, collectZ sends `_details` as a redacted JSON object.

In the current Graylog ingest/search path, that field is displayed as a JSON string rather than a nested searchable object. Example:

```json
{
  "details": "{\"key\":\"ui_drawer_edit_experiment\",\"previousEnabled\":true,\"nextEnabled\":false,\"envOverride\":null}"
}
```

So the current contract is:

- emit contract: `_details` is a JSON object
- Graylog-visible contract: `details` is currently expected to appear as a serialized JSON string in search results

This is accurate for the current `2.6.1` Graylog path and should be treated as the operator-visible behavior unless and until we promote individual detail keys into first-class GELF fields.

### Verified live example

Observed in the local Graylog smoke test for `admin.feature_flag.update`:

```json
{
  "app_version": "2.6.0",
  "method": "PATCH",
  "level": 6,
  "source": "collectz-backend",
  "ip_address": "172.20.0.3",
  "message": "admin.feature_flag.update",
  "env": "production",
  "entity_type": "feature_flag",
  "route": "/feature-flags/:key",
  "user_id": 1,
  "service": "backend",
  "action": "admin.feature_flag.update",
  "detail_key": "ui_drawer_edit_experiment",
  "detail_previous_enabled": "true",
  "detail_next_enabled": "false",
  "details": "{\"key\":\"ui_drawer_edit_experiment\",\"previousEnabled\":true,\"nextEnabled\":false,\"envOverride\":null}",
  "outcome": "success",
  "timestamp": "2026-03-14T03:51:29.683Z"
}
```

### Transport notes

- Primary target: UDP/TCP GELF endpoint (Graylog).
- Alternate exporters: JSON line output for syslog/collector ingestion.
- Export path MUST be runtime-toggleable by feature flag and environment settings.

## Initial 2.6.1 Implementation Notes

- Current first-slice exporter targets:
  - `gelf_udp`
  - `gelf_tcp`
  - `stdout_json`
- Existing `activity_log` persistence remains authoritative; external export is additive.
- Export failures must never block primary request/import behavior.
