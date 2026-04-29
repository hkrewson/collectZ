# Event Social Planning Foundation

## Decision

Event social planning belongs in collectZ as event-scoped planning data before it becomes a mobile-first or native companion experience.

The first foundation slice stores durable, privacy-aware social planning records attached to an existing collectZ Event:

- attendees: people associated with the event,
- groups: event-specific planning groups such as travel party, artist alley group, or meetup crew,
- group members: attendee membership inside those groups,
- meetups: lightweight time/place coordination records,
- schedule plans: manual or source-backed planned schedule items.

## Product Boundary

This foundation is intentionally conservative:

- no broad public social discovery,
- no real-time location sharing,
- no push-notification fanout,
- no native/platform-only source of truth,
- no replacement for the future convention schedule catalog.

The web app remains the canonical planning/admin surface. A later mobile web milestone can read these records and optimize the day-of-con view for quick scanning.

## Privacy Model

Each social planning record carries an explicit visibility value:

- `private`
- `selected_people`
- `group`
- `event_workspace`

The initial implementation stores the intent and keeps all routes scoped by the existing Event/library/space access controls. Fine-grained selected-recipient enforcement remains a later social-sharing milestone.

## API Surface

The foundation exposes scoped Event child resources:

- `GET/POST /api/events/:id/attendees`
- `PATCH/DELETE /api/events/:id/attendees/:attendeeId`
- `GET/POST /api/events/:id/groups`
- `PATCH/DELETE /api/events/:id/groups/:groupId`
- `GET/POST /api/events/:id/meetups`
- `PATCH/DELETE /api/events/:id/meetups/:meetupId`
- `GET/POST /api/events/:id/schedule-plans`
- `PATCH/DELETE /api/events/:id/schedule-plans/:planId`

All routes require the existing Events feature gate and active scope access.

## Follow-Up Order

1. Add a web detail-drawer readback/editor for social planning records.
2. Add the mobile-first Event Social Planning Mobile Web Experience.
3. Add Event Schedule Catalog and Now/Next Discovery.
4. Add Personal Sched ICS Schedule Sync.
5. Add friend-aware session changes and selected-recipient notifications.
