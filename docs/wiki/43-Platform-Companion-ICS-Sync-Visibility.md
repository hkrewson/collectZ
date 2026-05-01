# Platform Companion Personal Sched ICS Sync Visibility

This document defines how platform companion clients should read and present personal Sched ICS sync health in the current collectZ product.

## Product Boundary

- Personal Sched ICS sync represents the user's selected schedule, not the event's full schedule catalog.
- The backend owns feed storage, sync execution, freshness classification, and raw URL protection.
- Platform clients should display sync health from backend-provided fields instead of deriving separate sync state on-device.
- Raw personal ICS URLs must never appear in UI, logs, screenshots, diagnostics, analytics, or crash payloads.

## Companion Snapshot Fields

`GET /api/events/:id/companion/today` returns `sync.personal_ics_visibility` for native/mobile clients.

This object is intentionally UI-safe and includes:

- `connected`: whether a personal feed is configured.
- `provider`: currently `sched_ics` unless another backend-supported provider is added later.
- `status`: backend source lifecycle state.
- `sync_status`: backend sync execution state.
- `freshness`: one of `not_connected`, `never_synced`, `fresh`, `stale`, `failed`, or `unknown`.
- `state_label`: a plain display label for quick UI use.
- `last_synced_at`: when the last sync attempt ran.
- `last_success_at`: when the last successful sync completed.
- `stale_after_at`: when the current successful sync should be treated as stale.
- `last_item_count`: number of personal schedule items produced by the last sync.
- `has_error`: whether there is a current sync error state.
- `error_summary`: a redacted, short error summary suitable for UI/debug display.
- `manual_refresh_supported`: whether the backend supports manual refresh for this state.
- `manual_refresh_endpoint`: backend endpoint to call when manual refresh is supported.
- `personal_schedule_only`: always `true` in this contract, so clients do not present the feed as a full catalog.
- `raw_url_returned`: always `false`.

## Display Guidance

- `not_connected`: show setup guidance, not a sync failure.
- `never_synced`: show that a feed exists but has not produced schedule data yet.
- `fresh`: show normal schedule confidence.
- `stale`: show a quiet stale warning and allow backend refresh when supported.
- `failed`: show a recoverable sync warning with redacted error summary if present.
- `unknown`: show neutral uncertainty and encourage refresh when available.

## Manual Refresh

- Clients may call `manual_refresh_endpoint` only when `manual_refresh_supported` is `true`.
- Refresh remains backend-owned; clients should not fetch Sched ICS URLs directly.
- A refresh result may update personal schedule plans but does not create or import the full event catalog.

## Out of Scope

- Full event schedule catalog ingestion.
- Continued background polling from the platform app.
- Push notifications for stale or failed sync.
- Offline mutation queues.
- Any UI or diagnostic display of the raw ICS URL.
