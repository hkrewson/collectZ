# Convention Scheduler and Provider Framework Spec

Status: proposed design spec

## Goal

Add a true calendar-style convention scheduler to collectZ without polluting the existing `events` log model.

The scheduler should:

- sync available convention sessions from external sources,
- let users add overlapping sessions to a personal convention calendar,
- support one or more preferred choices when conflicts exist,
- provide public read-only calendar sharing,
- promote attended sessions into a real collectZ Event after attendance is confirmed,
- support source-specific scraping/parsing logic through a provider framework.

## Design Principles

1. Keep planned sessions separate from `events`.
2. Treat imported convention data as read-only source data unless explicitly promoted.
3. Allow overlapping plans; conflicts are informative, not blocking.
4. Keep sharing read-only and isolated from the authenticated app surface where possible.
5. Prefer a provider/adapter framework over arbitrary executable plugins.

## Why This Is Separate From Events

The current `events` model is a user-managed event log for actual attendance and memorabilia tracking. It is not a good primary storage model for thousands of imported candidate sessions, recurring resyncs, preference states, and public calendar feeds.

This feature should therefore introduce a separate scheduling domain that only creates or updates `events` when the user marks sessions as attended.

## Provider Framework

### Recommended Model

Start with an internal provider framework loaded from a known server-side directory. Do not start with an unrestricted "drop any code into a folder and execute it" plugin runtime.

Benefits:

- clearer security boundary,
- easier validation and test coverage,
- safer Docker packaging,
- easier provider versioning and migration control,
- lower SSRF and remote-code-execution risk.

### Provider Contract

Each provider exposes a manifest plus a bounded set of functions.

```js
module.exports = {
  manifest: {
    key: 'sched_ics',
    version: 1,
    displayName: 'Sched ICS',
    description: 'Imports convention sessions from a Sched iCalendar feed.',
    modes: ['pull'],
    auth: 'none',
    supports: {
      catalogs: true,
      incrementalSync: true,
      deleteDetection: 'best_effort',
      publicSourceUrl: true
    }
  },

  validateConfig(config) {},
  discover(input) {},
  fetch(context) {},
  parse(payload, context) {},
  normalize(records, context) {},
  dedupeKey(record) {},
  fingerprint(record) {},
  mapSeries(record, context) {}
};
```

### Provider Responsibilities

- `validateConfig(config)`
  - validates provider-specific config such as feed URL, headers, auth mode, timezone hints, and sync options.
- `discover(input)`
  - optional helper for resolving a source page into canonical source endpoints.
  - example: a Comic-Con wrapper page that links to the real Sched feed.
- `fetch(context)`
  - retrieves raw source data.
- `parse(payload, context)`
  - converts raw feed or HTML responses into source records.
- `normalize(records, context)`
  - maps parsed records into collectZ's canonical convention session shape.
- `dedupeKey(record)`
  - returns the stable external identity used for upsert logic.
- `fingerprint(record)`
  - returns a content hash for change detection.
- `mapSeries(record, context)`
  - groups sessions under a convention series such as `San Diego Comic-Con 2025`.

### Provider Manifest Fields

- `key`
- `version`
- `displayName`
- `description`
- `modes`
  - `pull`
  - `discover_then_pull`
- `auth`
  - `none`
  - `basic`
  - `token`
- `supports.catalogs`
- `supports.incrementalSync`
- `supports.deleteDetection`
  - `none`
  - `best_effort`
  - `strong`
- `supports.publicSourceUrl`

### Folder Structure

```text
backend/
  providers/
    convention/
      index.js
      loader.js
      registry.js
      types.js
      shared/
        fetch.js
        html.js
        ics.js
        hashing.js
        normalize.js
      sched_ics/
        manifest.js
        provider.js
        fixtures/
          comiccon2025-sample.ics
      sched_html/
        manifest.js
        provider.js
      reedpop_html/
        manifest.js
        provider.js
```

### Loader Rules

- load only providers from the approved `backend/providers/convention` tree,
- require explicit registry allowlisting,
- reject providers with duplicate `key` values,
- expose provider metadata through an admin-only API,
- store provider config in database-backed source records, not inside provider files,
- log provider failures with source id, provider key, stage, and sanitized error detail.

## Data Model

### 1. Convention Series

Represents the top-level convention or event run.

Table: `convention_series`

- `id`
- `library_id`
- `space_id`
- `created_by`
- `title`
  - example: `San Diego Comic-Con 2025`
- `slug`
- `location`
- `timezone`
- `starts_at`
- `ends_at`
- `source_provider`
- `source_url`
- `source_external_id`
- `status`
  - `draft|active|archived`
- `created_at`
- `updated_at`
- `archived_at`

Recommended indexes:

- `(library_id, starts_at DESC)`
- `(space_id, starts_at DESC)`
- unique `(library_id, slug)` where `archived_at IS NULL`

### 2. Convention Sources

Tracks configured upstream feeds/pages and sync metadata.

Table: `convention_sources`

- `id`
- `library_id`
- `space_id`
- `created_by`
- `series_id`
- `provider_key`
- `provider_version`
- `title`
- `source_url`
- `config_json`
- `status`
  - `active|paused|error|archived`
- `last_synced_at`
- `last_sync_status`
  - `idle|running|failed|succeeded|partial`
- `last_sync_summary`
- `last_error`
- `etag`
- `last_modified`
- `created_at`
- `updated_at`
- `archived_at`

Recommended indexes:

- `(library_id, status, updated_at DESC)`
- `(series_id, status)`

### 3. Convention Sessions

Canonical imported session catalog.

Table: `convention_sessions`

- `id`
- `library_id`
- `space_id`
- `series_id`
- `source_id`
- `provider_key`
- `external_id`
- `dedupe_key`
- `fingerprint`
- `title`
- `description`
- `session_type`
- `track`
- `host`
- `room`
- `venue`
- `location_text`
- `starts_at`
- `ends_at`
- `all_day`
- `status`
  - `scheduled|cancelled|moved|removed`
- `source_url`
- `raw_payload_json`
- `last_seen_at`
- `created_at`
- `updated_at`
- `archived_at`

Recommended indexes:

- unique `(source_id, dedupe_key)`
- `(series_id, starts_at ASC)`
- `(library_id, starts_at ASC)`
- `(room, starts_at ASC)`

### 4. User Session Plans

Represents a user's scheduling choices. Multiple overlapping rows are allowed.

Table: `user_session_plans`

- `id`
- `session_id`
- `user_id`
- `plan_state`
  - `interested|scheduled|preferred|backup|attended|skipped`
- `priority_rank`
  - nullable integer for ordering preferred choices
- `attendance_state`
  - `unknown|attended|missed`
- `notes`
- `created_at`
- `updated_at`
- `archived_at`

Recommended indexes:

- unique `(session_id, user_id)` where `archived_at IS NULL`
- `(user_id, plan_state, updated_at DESC)`
- `(user_id, attendance_state, updated_at DESC)`

### 5. Shared Calendar Links

Public calendar sharing should be separate from the main authenticated app state.

Table: `calendar_share_links`

- `id`
- `library_id`
- `space_id`
- `created_by`
- `series_id`
- `token_hash`
- `title`
- `status`
  - `active|revoked|expired`
- `includes_only_preferred`
- `includes_attended`
- `includes_backups`
- `created_at`
- `updated_at`
- `expires_at`
- `revoked_at`

Recommended indexes:

- unique `(token_hash)`
- `(series_id, status)`

### 6. Attendance Promotion Links

Tracks promotion from planned sessions into a real collectZ event.

Table: `event_session_attendance`

- `id`
- `event_id`
- `session_id`
- `user_id`
- `attendance_note`
- `created_at`
- unique `(event_id, session_id, user_id)`

This can coexist with existing `event_artifacts`, but it preserves structured session identity rather than flattening attended sessions into freeform notes.

## Sync Model

### Initial Sync

1. Admin creates a convention series.
2. Admin adds one or more sources to the series.
3. Provider validates config and fetches the source.
4. Parsed sessions are normalized and upserted into `convention_sessions`.
5. Removed sessions are either:
   - marked `removed`, or
   - left untouched if the provider cannot confidently detect deletions.

### Resync

Resync should support:

- manual `Sync now`,
- optional scheduled sync via existing job infrastructure,
- idempotent upsert,
- partial-failure reporting,
- change detection through `fingerprint`.

### Deletion Semantics

- Do not hard-delete source sessions on normal resync.
- Mark source rows as `removed` or `cancelled`.
- Keep user plans intact even if upstream removes a row, but surface the stale state in UI.

## API Routes

All routes below are library/space scoped and should follow the current tenancy/scope model.

### Admin and Source Management

- `GET /api/conventions`
  - list convention series
- `POST /api/conventions`
  - create a convention series
- `GET /api/conventions/:id`
  - convention summary
- `PATCH /api/conventions/:id`
  - update title/location/timezone/date range/status
- `POST /api/conventions/:id/sources`
  - add a source
- `GET /api/conventions/:id/sources`
  - list sources for a convention
- `PATCH /api/convention-sources/:id`
  - pause/resume/update config
- `POST /api/convention-sources/:id/sync`
  - enqueue or run sync
- `GET /api/convention-sources/:id/sync-jobs`
  - recent sync history
- `GET /api/convention-providers`
  - admin-only provider registry list

### Session Catalog

- `GET /api/conventions/:id/sessions`
  - filters:
    - `from`
    - `to`
    - `room`
    - `track`
    - `q`
    - `status`
    - `day`
    - `view=calendar|agenda`
- `GET /api/convention-sessions/:id`
  - session detail

### Personal Planning

- `GET /api/conventions/:id/my-plans`
  - returns planned sessions plus conflict metadata
- `PUT /api/convention-sessions/:id/my-plan`
  - create/update personal plan state
- `DELETE /api/convention-sessions/:id/my-plan`
  - remove from personal calendar
- `POST /api/conventions/:id/my-plans/bulk`
  - bulk update state or priority for selected sessions

### Attendance Promotion

- `POST /api/conventions/:id/attendance/promote`
  - create or reuse a collectZ event for the convention and attach attended sessions
- `POST /api/convention-sessions/:id/attend`
  - shortcut to mark attended and optionally promote
- `GET /api/events/:id/attended-sessions`
  - list structured attended sessions linked to the event

### Sharing

- `POST /api/conventions/:id/share-links`
  - create a public read-only share link
- `GET /api/conventions/:id/share-links`
  - list existing share links
- `DELETE /api/convention-share-links/:id`
  - revoke share link
- `GET /calendar/share/:token.ics`
  - public ICS feed for calendar subscribers
- `GET /calendar/share/:token`
  - optional public web calendar view

## UI States

### 1. Convention Directory

Primary list of convention series.

States:

- empty
- loading
- loaded
- sync running
- sync error

Actions:

- create convention
- open convention calendar
- manage sources
- sync now
- create share link

### 2. Convention Calendar View

Primary planning interface.

Modes:

- `agenda`
- `day`
- `multi-day`

States:

- unplanned
- scheduled
- preferred
- backup
- attended
- missed
- cancelled upstream

Visual behavior:

- overlapping sessions render side-by-side or stacked in the time grid,
- preference state is highlighted but does not hide backups,
- conflicts show a badge/count rather than blocking save,
- upstream changes show moved/cancelled indicators.

### 3. Session Detail Drawer

Shows canonical source data plus personal plan controls.

Actions:

- add to my calendar
- mark preferred
- mark backup
- mark attended
- remove from my calendar
- open source URL

### 4. My Calendar

Filtered personal planning view.

States:

- all planned
- preferred only
- attended only
- conflicts only

Actions:

- reorder preference rank,
- bulk mark attended,
- bulk remove,
- generate or copy share link.

### 5. Attendance Promotion Flow

When user marks sessions as attended:

1. choose existing event or create a new event,
2. default suggestion: `San Diego Comic-Con 2025`,
3. attach attended sessions to that event,
4. optionally create session artifacts later from attended rows.

### 6. Public Share View

Read-only surface for friends/family.

States:

- active share
- expired/revoked
- no sessions yet

Constraints:

- no authenticated admin shell reuse,
- no notes or private metadata unless explicitly allowed later,
- no user emails, memberships, or internal ids in payloads.

## Event Promotion Rules

- Imported sessions must not create `events` automatically.
- Only sessions marked `attended` can be promoted.
- Promotion should either:
  - create one event per convention series, or
  - let the user choose an existing event for the same date range.
- The resulting collectZ event remains the memorabilia anchor for:
  - purchases,
  - freebies,
  - autographs,
  - photos,
  - linked collectibles.

## Suggested Audit Events

- `convention.create|update|delete`
- `convention.source.create|update|delete`
- `convention.source.sync.start|success|partial|failure`
- `convention.plan.update`
- `convention.plan.attended`
- `convention.share.create|revoke`
- `convention.attendance.promote`

## Security and Operational Notes

- Provider fetches must use explicit outbound allowlist and timeout controls.
- Do not expose arbitrary provider file loading from writable user paths.
- Public share routes should use separate serializers and rate limiting.
- Shared ICS feeds should expose only the minimum event fields needed by calendar clients.
- Provider failures must not block core media, events, or collectibles flows.

## Proposed First Provider

Provider key: `sched_ics`

Why first:

- best fit for Comic-Con style schedules,
- stable machine-readable feed shape,
- simpler and safer than HTML scraping,
- strong candidate for repeatable resync.

Fallback provider:

- `sched_html`
  - only if no usable ICS feed is available.

## Delivery Recommendation

Ship in two phases.

### Phase 1

- convention series + source records,
- `sched_ics` provider,
- session catalog sync,
- personal planning calendar,
- overlap + preference states,
- public ICS share links.

### Phase 2

- attendance promotion into real collectZ events,
- structured attended-session linkage,
- optional public web calendar view,
- broader provider catalog.

## Open Questions

- whether public web sharing should ship with ICS in phase 1 or remain phase 2,
- whether attended sessions should also create `event_artifacts` automatically or remain linked only through `event_session_attendance`,
- whether source sync should use existing `sync_jobs` tables directly or a scheduler-specific sync job type,
- whether conventions should be library-specific only or optionally space-global within a tenant.
