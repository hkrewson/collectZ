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
