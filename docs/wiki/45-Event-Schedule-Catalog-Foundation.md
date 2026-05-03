# Event Schedule Catalog Foundation

This document defines the current event schedule catalog boundary for collectZ web/backend and platform companion clients.

## Product Boundary

- `event_schedule_sessions` is the canonical event schedule catalog table.
- Catalog sessions are separate from personal schedule plans in `event_schedule_plans`.
- Personal Sched ICS sync continues to create or update selected personal schedule plans only.
- When a catalog session and personal Sched plan share the same provider source reference, the plan can point to the catalog session through `source_catalog_session_id` without changing its personal `sched_ics` identity.
- The catalog can be manually created through API endpoints and seeded through one-time provider ICS import.
- Provider ICS import is intentionally not recurring background sync.
- Now / Next discovery, conflict workflows, quick plan actions, push/device delivery, and native/platform UI stay separate future milestones.
- Schedule change preview can identify affected Event attendees/groups and conflicts.
- Schedule notification records can persist selected-recipient drafts and local sent notices, but external delivery remains out of scope.

## Catalog Session Shape

A catalog session can store:

- title,
- start and end time,
- location and room,
- description,
- track,
- categories,
- source type,
- source reference,
- source URL,
- source updated timestamp,
- status: `active`, `cancelled`, or `hidden`.

Use `hidden` for sessions that should remain in backend history but not show in the companion catalog snapshot.

## API Surface

The foundation endpoints are event-scoped and use the same auth/scope checks as the existing Event social planning endpoints:

- `GET /api/events/:id/schedule-sessions`
- `POST /api/events/:id/schedule-sessions`
- `POST /api/events/:id/schedule-sessions/import-ics`
- `PATCH /api/events/:id/schedule-sessions/:sessionId`
- `DELETE /api/events/:id/schedule-sessions/:sessionId`
- `POST /api/events/:id/schedule-change-preview`
- `GET /api/events/:id/schedule-notifications`
- `POST /api/events/:id/schedule-notifications`
- `GET /api/events/:id/schedule-notification-delivery-boundary`
- `GET /api/events/:id/schedule-notification-delivery-attempts`
- `GET /api/events/:id/schedule-notification-inbox`
- `PATCH /api/events/:id/schedule-notification-inbox/:recipientId`

Deleted sessions are archived with `archived_at`; they are not hard-deleted by the API.

`POST /api/events/:id/schedule-sessions/import-ics` accepts a transient Sched-style/calendar ICS URL, fetches it once, and upserts catalog rows by source reference. The raw URL is not stored or returned. Imported sessions use `source_type = sched_catalog_ics`.

`POST /api/events/:id/schedule-change-preview` is preview-only. It returns the schedule subject, requested status and visibility, scoped people/groups, conflicts, and a simple message template. It does not send notifications, persist message drafts, register devices, or expose push delivery behavior.

`GET /api/events/:id/schedule-notifications` returns recent durable Event-local notification records for drawer readback/history.

`POST /api/events/:id/schedule-notifications` creates a durable Event-local notification record with status `draft` or `sent`. A sent record is local readback only: it does not push, email, register devices, or broadcast outside the Event-local selected recipient snapshot.

`GET /api/events/:id/schedule-notification-delivery-boundary` returns the platform-readable delivery capability boundary for schedule notifications. The current contract supports Event-local records, recipient readback, and local delivery-attempt audit rows only; push, email, native device delivery, realtime fanout, global inboxes, external provider attempts, and broadcast delivery are explicitly unsupported. Provider-prep metadata lists `event_local` as the only active provider while keeping future `push`, `email`, and `platform_device` providers disabled. The response also includes the delivery-attempt model shape for one attempt per notification-recipient-provider.

`GET /api/events/:id/schedule-notification-delivery-attempts` returns Event-local delivery-attempt audit rows. These rows mean collectZ recorded the selected-recipient local send path; they do not prove push, email, native device, realtime, or provider delivery.

The web Event drawer surfaces this as compact delivery-attempt readback on sent notification history rows. The UI should keep the local-audit-only language visible near the attempt rows so users do not mistake the audit record for push, email, or device delivery.

`GET /api/events/:id/schedule-notification-inbox` returns Event-local recipient rows for sent notification records, including unread/read/acknowledged counts. `PATCH /api/events/:id/schedule-notification-inbox/:recipientId` marks a local recipient row read or acknowledged. This readback contract is still scoped to the Event and does not imply external delivery, device registration, or global friend identity.

Event attendees can optionally link to an app user through `user_id` or the safer `link_current_user` helper on attendee create/update. Linked attendee identity is event-scoped and returns app user id/name plus current-user flags; it does not expose email or create a global friend graph. `GET /api/events/:id/schedule-notification-inbox?recipient=me` narrows readback to recipient rows linked to the current app user.

The web Event drawer exposes this through a compact Notification inbox `All` / `Mine` filter. `Mine` is a readback filter only; it does not send notifications, register devices, or create a global notification inbox.

The web Event drawer also uses the Event-local attendee/group state to show visibility-safe shared-attendance context on Now/Next, catalog session, and personal schedule cards. This is readback only: shared rows can name already-visible Event people/groups, but they do not create reciprocal friend identity, realtime presence, push delivery, or global notifications.

## Companion and Offline Packet Behavior

`GET /api/events/:id/companion/today` now returns:

- `counts.schedule_catalog_sessions`,
- `contract.write_endpoints.schedule_catalog`,
- top-level `schedule_catalog`,
- `offline_packet.includes.schedule_catalog = true`,
- `offline_packet.schedule_catalog`,
- key-location entries derived from catalog session `location` or `room`.

This means platform clients can cache catalog sessions when present without mistaking personal selected-session plans for the full catalog.

## What Stays Separate

Keep these out of this foundation unless explicitly promoted:

- recurring provider sync or scraping automation,
- recurring background sync,
- Now / Next discovery UI,
- external selected-recipient delivery,
- reciprocal friend identity or realtime attendance/presence,
- conflict resolution or replacement prompts,
- offline mutation queues,
- realtime location or presence behavior,
- native/platform UI implementation.

## Design Notes

Catalog sessions answer: "What sessions exist at this event?"

Schedule plans answer: "What does this user or event workspace intend to attend, skip, mark as backup, or share?"

Those objects can be linked when provider source references confidently match, but they remain separate records because enrichment/import ownership, user editing, privacy, and conflict behavior are different.
