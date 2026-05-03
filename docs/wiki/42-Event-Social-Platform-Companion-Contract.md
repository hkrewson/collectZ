# Event Social Platform Companion Contract

This document defines the current collectZ product boundary for an Apple/platform companion client that reads Event social planning data for day-of-con use.

## Product Boundary

- The web app remains the canonical admin and planning surface for Events, attendees, groups, meetups, schedule plans, and personal Sched feed setup.
- The platform companion client should start as a fast, read-heavy day-of-con surface backed by the existing collectZ API.
- The companion contract is intentionally narrow: compact read payloads plus links to existing write endpoints.
- No realtime location, presence, broad social discovery, or push notification behavior is included in this contract.
- Full schedule catalog discovery remains separate from personal schedule plans and should use a later catalog milestone.

## Read Contract

### `GET /api/events/:id/companion/today`

Returns a compact event-scoped snapshot intended for platform companion clients.

The response includes:

- `contract`: contract version, generated timestamp, read endpoint, supported write endpoint references, and out-of-scope capabilities.
- `event`: the scoped Event record.
- `counts`: counts for attendees, groups, meetups, and schedule plans.
- `sync.personal_ics`: current user's personal Sched ICS source metadata, without returning the raw URL.
- `sync.freshness`: one of `not_connected`, `never_synced`, `fresh`, `stale`, `failed`, or `unknown`.
- `sync.personal_ics_visibility`: UI-safe sync-health readback for platform clients, including freshness, stale threshold, manual refresh support, and raw URL protection.
- `cache`: recommended cache TTL, stale threshold, offline mode, and conflict policy.
- `privacy`: privacy and safety flags for companion clients.
- `offline_packet`: read-only poor-connectivity packet metadata, planned sessions, and key locations for platform companion caching.
- `attendees`: event attendee records.
- `groups`: event group records with members.
- `meetups`: event meetup records.
- `schedule_plans`: selected personal/shared schedule-plan records.

## Write Contract

The companion snapshot is not a new write surface. Platform clients should use the existing scoped Event endpoints when writes are needed:

- `GET/POST /api/events/:id/attendees`
- `PATCH/DELETE /api/events/:id/attendees/:attendeeId`
- `GET/POST /api/events/:id/groups`
- `PATCH/DELETE /api/events/:id/groups/:groupId`
- `POST/DELETE /api/events/:id/groups/:groupId/members`
- `GET/POST /api/events/:id/meetups`
- `PATCH/DELETE /api/events/:id/meetups/:meetupId`
- `GET/POST /api/events/:id/schedule-plans`
- `PATCH/DELETE /api/events/:id/schedule-plans/:planId`
- `GET/PUT/DELETE /api/events/:id/personal-ics-source`
- `POST /api/events/:id/personal-ics-source/sync`

## Notification Delivery Boundary

`GET /api/events/:id/schedule-notification-delivery-boundary` returns the current delivery capability contract for Event schedule notifications.

The current contract is intentionally local-only:

- supported channel: `event_local`,
- supported behavior: preview recipients, save drafts, edit drafts, discard drafts, mark a draft locally sent, create Event-local recipient readback rows, create Event-local delivery-attempt audit rows, read those attempts back, and update read/acknowledged state,
- unsupported behavior: push delivery, email delivery, native device registration, realtime fanout, global inboxes, and broadcast-without-selection behavior.

The boundary also includes provider-prep metadata. `event_local` is the active provider and creates local audit attempts only. Future provider slots such as `push`, `email`, and `platform_device` are listed only as disabled descriptors so platform clients can hide unavailable delivery controls and avoid inventing provider behavior.

The boundary includes a delivery-attempt model contract. Sent Event-local notifications create one attempt per notification-recipient-provider for local audit/readback. The attempt shape includes provider/channel, status, attempted/completed timestamps, retry metadata, provider message id, and provider error fields. For the current `event_local` provider, provider message ids and external error fields should remain empty because no external provider was contacted.

Platform clients should treat `sent` schedule notifications and `event_local` delivery attempts as coordination/audit records inside collectZ, not proof that another device received a push/email/message. A native client should not show push/email/device delivery affordances unless this boundary reports a future supported external channel and a new contract version.

## Offline and Cache Rules

- Companion clients may cache the snapshot for quick day-of-con launch.
- The recommended TTL is short, currently five minutes.
- A snapshot older than twelve hours should be treated as stale.
- Offline mode is read-only snapshot mode for this contract.
- The backend remains authoritative.
- If a platform client queues mutations while offline in a future milestone, it must refetch before retrying after reconnect to avoid writing over newer shared planning changes.

## Privacy and Safety Rules

- Raw personal ICS URLs are never returned by the companion snapshot.
- Visibility values remain scoped to existing event-social records: `private`, `selected_people`, `group`, and `event_workspace`.
- Real-time location, presence tracking, broad social discovery, and friend-finder behavior are not part of this contract.
- Push notifications are not part of this contract and need a later notification-specific milestone.

## OpenAPI Source of Truth

`backend/openapi/openapi.yaml` defines the public API shape for `EventCompanionTodayResponse` and `GET /api/events/{id}/companion/today`.

## Later Work

Keep these separate unless a future milestone explicitly promotes them:

- platform/native companion UI,
- selected-recipient notifications,
- full event schedule catalog and Now/Next discovery,
- offline mutation queues and conflict resolution UI,
- realtime location or presence-like behavior,
- broad social discovery or Sched-style friend finding.
