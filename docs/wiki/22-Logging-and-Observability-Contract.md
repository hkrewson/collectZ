# Logging and Observability Contract

This document defines the canonical structured logging contract for external log shipping.

## Canonical GELF Schema (collectZ)

All shipped events MUST be valid GELF `1.1` with collectZ extensions.

### Required GELF base fields

- `version`: always `"1.1"`.
- `host`: service identity (for example `collectz-backend`).
- `short_message`: concise action/event name (for example `request.failed`).
- `timestamp`: Unix epoch seconds with milliseconds precision.
- `level`: syslog-compatible severity integer.

### Standard collectZ extension fields

- `_service`: constant service label (`backend`).
- `_env`: deployment environment (`dev`, `test`, `prod`).
- `_app_version`: semantic version string.
- `_git_sha`: build git SHA (short or full).
- `_action`: canonical action name from activity/audit system.
- `_entity_type`: domain entity (`media`, `user`, `invite`, `http_request`, etc).
- `_entity_id`: numeric entity id when present, else null.
- `_user_id`: numeric actor id when present, else null.
- `_ip_address`: request source IP when available.
- `_request_id`: correlation id for request-scoped traces.
- `_route`: API route path (for request events).
- `_method`: HTTP method (for request events).
- `_status`: HTTP response status (for request events).
- `_duration_ms`: request or job duration in milliseconds when available.
- `_outcome`: normalized result (`success`, `failed`, `denied`, `partial`).
- `_details`: redacted details payload (JSON object).

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

### Transport notes

- Primary target: UDP/TCP GELF endpoint (Graylog).
- Alternate exporters: JSON line output for syslog/collector ingestion.
- Export path MUST be runtime-toggleable by feature flag and environment settings.
