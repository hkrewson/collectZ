# Personal Sched ICS Sync

## Decision

A personal Sched ICS/iCal feed is a personal plan sync adapter, not the full convention schedule catalog.

Sched can expose a user's selected sessions through calendar subscription links. collectZ should use that feed to keep the user's private event schedule plans fresh, while a later catalog/import milestone remains responsible for full-event discovery and Now/Next browsing.

## Product Boundary

This slice intentionally does not implement the full convention scheduler provider framework. It adds only:

- one encrypted personal ICS source per user per collectZ Event,
- manual refresh of that source,
- parsing of VEVENT records into private `event_schedule_plans`,
- source-backed updates using stable ICS UID/source references,
- redacted sync status and error readback.

The synced records stay event-scoped and user-owned through `created_by`. They do not create public catalog sessions, broad social discovery, notifications, or native companion behavior.

## Privacy and Secret Handling

The personal ICS URL is treated as a secret-bearing schedule credential.

- The URL is encrypted at rest in `event_personal_ics_sources.feed_url_encrypted`.
- The API never returns the raw ICS URL.
- UI readback shows only whether a source exists, sync status, timestamps, counts, and sanitized errors.
- Activity logs record source IDs and summaries, not feed URLs.
- Release evidence and smoke output must not include real personal ICS links.

## Sync Behavior

Manual refresh fetches the stored feed, parses VEVENT rows, and upserts matching `event_schedule_plans` with:

- `source_type = sched_ics`,
- `source_ref` from `UID` or a stable hash fallback,
- private visibility,
- planned status unless the ICS event is cancelled,
- title, time, location, and notes derived from the calendar entry.

Existing synced records for the same user/event/source are updated in place. Records missing from a non-empty refresh are archived so removals from Sched do not linger as active plans.

## Follow-Up Order

1. Add conflict/readability polish in the mobile event planning view.
2. Add a full Event Schedule Catalog and Now/Next discovery model.
3. Link confident ICS matches to catalog sessions when catalog data exists. Implemented in `3.4.56` using `source_catalog_session_id` while preserving personal `sched_ics` source identity.
4. Add friend/group schedule-sharing and notification decisions after selected-recipient enforcement is designed.
