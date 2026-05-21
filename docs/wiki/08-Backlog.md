# Backlog

This file is the staging area for work that has not yet been assigned a release version. Items stay here until they are selected for a numbered milestone.

## How to use the backlog

- Keep backlog items versionless until they are promoted.
- Treat tags as metadata only.
- Keep each item clearly scoped as a task, bug, discussion, or deferred milestone.
- Each backlog item should include enough context to judge status later: a one-line goal, current state or why it exists, intended scope, candidate subtasks when useful, and acceptance criteria.
- If an item is clearly a release candidate, mark it as such in the backlog, but do not assign a version number yet.
- When a backlog item is selected for work, move it into the roadmap as a numbered milestone instead of copying it.
- Keep the roadmap focused on milestone work only.
- Update the roadmap, release notes, release feed, and verification steps together when a backlog item is promoted.

## Product-Level Feature Gaps

These are product-level capability gaps discovered from the current shape of the app. They are not immediate implementation commitments and should stay versionless until one is selected and moved into the roadmap as a numbered milestone.

### Backlog Item: Unified Review Queue
**Type:** Deferred milestone
**Tags:** `product`, `review`, `imports`, `metadata`, `duplicates`
**Status:** Active backlog; not yet implemented as one unified product surface.

**Goal:** Centralize uncertain states from scanner, Plex, Kavita, enrichment, duplicate detection, and imports.

**Intent**
- Give users one predictable place to resolve uncertain or partial work instead of hunting through provider-specific screens.
- Preserve the provider-specific evidence that already exists while making the user workflow feel like "review these things" instead of "debug these integrations."

**Current state**
- Capture Inbox can hold scanner/capture work.
- Plex reconciliation conflicts have their own review surface.
- Dashboard/Needs Attention can show missing covers, missing identifiers, failed syncs, and Plex conflicts.
- Apple/iTunes target-price hits can be reviewed in Wishlist.
- These are separate surfaces; there is no single queue with shared statuses, ownership, or resolution semantics.

**Scope**
- Capture candidate selection, conflict review, sparse import review, missing-cover review, and low-confidence metadata decisions.
- Preserve provider-specific readback while giving users one place to resolve uncertain work.
- Define a common review item shape: source, affected object, reason, confidence, proposed action, available actions, status, and audit trail.
- Start with readback/links before trying to move every provider workflow into one giant editor.

**Candidate subtasks**
- Inventory existing reviewable states and map them to a shared review-item taxonomy.
- Add a backend readback endpoint that aggregates existing reviewable items without changing their source workflows.
- Add a compact review queue UI with source/type filters and direct links to the owning workflow.
- Add shared dismiss/defer semantics only where they can be audited without losing provider-specific evidence.
- Later: allow inline resolution for simple cases such as missing covers, sparse imports, duplicate candidates, and target-price hits.

**Acceptance Criteria**
- Reviewable items have a clear source, reason, and next action.
- Resolving a review item updates the relevant object or provider workflow.
- Dismissed or deferred review decisions remain auditable.

### Backlog Item: Collection Health and Audit Dashboard
**Type:** Deferred milestone
**Tags:** `product`, `health`, `audit`, `metadata`, `maintenance`
**Status:** Partially served by Dashboard/Needs Attention; full health/audit workflow is not implemented.

**Goal:** Show collection maintenance health across libraries and workspaces.

**Intent**
- Make collection maintenance visible and actionable without turning the Dashboard into a giant error log.
- Separate "things need attention" from "the collection has measurable health gaps over time."

**Current state**
- Dashboard can surface counts and sample lists for missing covers, missing identifiers, failed syncs, and Plex conflicts.
- Provider health and recent activity exist as operational readback.
- There is no dedicated health/audit view with severity, source, trend, filtering, or repair status.

**Scope**
- Surface missing identifiers, missing covers, duplicate candidates, stale syncs, failed imports, unlinked provider rows, and low-confidence metadata.
- Keep health findings explainable and actionable instead of presenting a vague score.
- Support workspace/library/type/provider filters.
- Include enough source context to explain why a finding exists and where to fix it.

**Candidate subtasks**
- Define health finding categories and severity rules.
- Add scoped backend summary endpoints for counts and sample rows.
- Add filtered drill-down lists for missing covers and missing identifiers.
- Add stale-sync and failed-import diagnostics that link back to sync job/activity evidence.
- Add a maintenance history/readback path so dismissed or resolved findings do not reappear without context.

**Acceptance Criteria**
- Users can identify the most important collection maintenance issues.
- Health findings can be filtered by library, media type, provider, and severity.
- Each finding links to a repair, review, or source record where available.

### Backlog Item: Universal Search
**Type:** Deferred milestone
**Tags:** `product`, `search`, `navigation`, `identifiers`
**Status:** Active backlog; current search remains section-specific plus scanner/provider lookup flows.

**Goal:** Search across media, books, comics, games, art, collectibles, events, people, vendors, identifiers, and provider IDs.

**Intent**
- Let users find an object without remembering which library, provider, event, or workflow owns it.
- Make barcode/ISBN/UPC/provider-id lookups a normal navigation path, not only an import/capture path.

**Current state**
- Library search, provider lookup, scanner barcode/ISBN lookup, event search, and admin/search-like workflows exist separately.
- There is no app-wide command/search surface that returns typed destinations across collection objects and operational records.

**Scope**
- Include barcode, ISBN, UPC, provider identity, artist, vendor, event, and object-title lookups.
- Provide direct navigation to matched records.
- Keep search scoped to the user's accessible workspace and library permissions.

**Candidate subtasks**
- Define a shared search result shape with object type, title, subtitle, source, destination, and match reason.
- Add a backend global-search endpoint that fans out to existing scoped object queries.
- Add identifier-first matching for ISBN/UPC/provider IDs before title search.
- Add a compact command/search UI that can navigate directly to records.
- Later: include review queue findings, activity entries, people/places, and provider sync records.

**Acceptance Criteria**
- Users can find known records without knowing which section owns them.
- Identifier searches return direct object matches where possible.
- Search results clearly show object type and destination.

### Backlog Item: Saved Views and Smart Collections
**Type:** Deferred milestone
**Tags:** `product`, `saved-views`, `smart-collections`, `filters`
**Status:** Active backlog; no durable saved-view model exists yet.

**Goal:** Let users save reusable filtered views across collection data.

**Intent**
- Turn repeated filters into named, reusable views without requiring users to rebuild them every time.
- Start as saved filters before adding rule automation or collection-like ownership semantics.

**Current state**
- Many library screens have filters and sort state.
- Dashboard and provider surfaces expose some fixed views.
- Users cannot save custom filtered views or share workspace-scoped smart views.

**Scope**
- Support views such as unread Kavita comics, signed art, missing ISBNs, event-purchased items, recent imports, watched but unowned media, and needs-review items.
- Keep saved views as user/workspace-scoped filters before introducing heavier rule automation.

**Candidate subtasks**
- Define saved view storage: owner, workspace/library scope, object type, filters, sort, display mode, and visibility.
- Add create/update/delete/list endpoints for saved views.
- Add UI affordances to save the current library filter state.
- Add a "Saved Views" entry point in the library/dashboard navigation.
- Later: support smart collection badges, shared workspace views, and review/health-driven views.

**Acceptance Criteria**
- Users can save, name, open, and update reusable filtered views.
- Saved views preserve the relevant filters and sort choices.
- Views remain permission-aware across workspaces and libraries.

### Backlog Item: People and Places Model
**Type:** Deferred milestone
**Tags:** `product`, `people`, `places`, `identity`, `events`
**Status:** Partially implemented for artists and event attendees; broader scoped identity model remains backlog.

**Goal:** Introduce reusable scoped identities for creators, vendors, venues, friends, publishers, stores, and event-related people.

**Intent**
- Reduce repeated free-text names where reuse has real value, while keeping lightweight one-off entry intact.
- Keep identity scoped to a workspace unless a later milestone explicitly defines a broader boundary.

**Current state**
- Reusable Artist records exist for artwork entry.
- Event attendees can be linked to app users for current-user/self attendee behavior.
- Vendor, venue, publisher, store, friend/contact, and broader creator identities are still mostly free text or object-local fields.

**Scope**
- Keep this distinct from a social network or broad friend graph.
- Support reusable people/place references for artists, vendors, venues, publishers, stores, attendees, and event contacts where useful.
- Preserve workspace ownership and privacy boundaries.

**Candidate subtasks**
- Inventory existing person/place-like fields and decide which should stay free text.
- Define scoped people/place records with roles, aliases, links, and source provenance.
- Extend artwork artists only after proving migration/backfill behavior.
- Add vendor and venue reuse for events/convention purchases if it reduces repeated entry.
- Keep "friends" limited to event-local coordination/contact records unless a later friend graph is selected.

**Acceptance Criteria**
- People and places can be reused without duplicating plain-text fields everywhere.
- Existing item-local text remains usable where a reusable record is unnecessary.
- The model does not imply cross-workspace identity or social graph behavior by default.

### Backlog Item: Backup, Export, and Portability UX
**Type:** Deferred milestone
**Tags:** `product`, `backup`, `export`, `portability`, `homelab`
**Status:** Active backlog; docs/runbooks exist, but in-app trust/readback is not implemented.

**Goal:** Make data trust visible in the app, not only in docs.

**Intent**
- Help self-hosted and platform users understand where their data lives, whether backup/export paths are healthy, and how portable their collection is.
- Keep sensitive backup details redacted while making operational confidence visible.

**Current state**
- Public docs and runbooks describe configuration, backup/restore, environment, and deployment behavior.
- The app does not provide an in-product backup/export status dashboard.

**Scope**
- Surface export data, export images, backup status, restore guidance, storage location readback, and portability checks.
- Keep operator docs as the detailed runbook while giving users an in-app confidence/readiness surface.

**Candidate subtasks**
- Add read-only backend endpoints for database/storage/export capability readback.
- Show storage locations and configured backup/export status with secrets redacted.
- Add manual export actions only after readback and permissions are clear.
- Add portability checks for database rows, uploaded media, provider-linked metadata, and release/runtime version.
- Link to sanitized docs/runbooks from the in-app surface.

**Acceptance Criteria**
- Users can see whether backups and exports are configured and recent.
- Export/restore guidance is visible from the app without exposing secrets.
- Data portability coverage is clear for database records, images, and provider-linked metadata.

### Backlog Item: Apple/iTunes Wishlist Price Watch Follow-ups
**Type:** Deferred milestone
**Tags:** `wishlist`, `apple-itunes`, `price-watch`, `notifications`, `review`

**Goal:** Preserve future Apple/iTunes Wishlist price-watch ideas without treating them as current priority work.

**Why this work exists**
- The Apple/iTunes Wishlist foundation can already search, save, refresh prices, store history, run an opt-in scheduler, surface target-price hits, and mark hits ordered or dismissed.
- The remaining work is useful only if Apple/iTunes price watching becomes personally or product-significant later.

**Scope**
- Add optional price-drop notification behavior for target-price hits.
- Route target-price hits into a broader review queue if the Unified Review Queue is selected.
- Improve price-history UX with trends, lowest-seen readback, or compact charts.
- Research better Apple movie/catalog matching only if Apple/iTunes movie acquisition tracking becomes important.
- Keep scheduled polling conservative, opt-in, and rate-limit aware.

**Out of scope**
- Do not add auto-purchase behavior.
- Do not make Apple/iTunes the default Wishlist acquisition path.
- Do not prioritize this ahead of higher-value collection, capture, import, or review workflows unless explicitly selected.

**Acceptance Criteria**
- Users can opt into any alerting or polling behavior.
- Price-watch decisions remain explainable from stored price history and provider metadata.
- Target-price hits can be reviewed or dismissed without creating noisy duplicate work.

## UI/UX Cleanup Working Plan

These tasks are intentionally ordered so quick hygiene work does not get buried under larger UI refactors.

1. Promote and complete `Release Evidence Token Hygiene Cleanup` by redacting fixed Playwright token examples and adding a guard against reintroducing them.
2. `Shared Detail Drawer Shell Primitive` and `Mobile Drawer Density Audit and Follow-up` were promoted together as `3.4.26`; continue with image/proof parity next.
3. `Image and Proof Control Language Parity` was promoted as `3.4.27`; finish that parity pass before moving to API/provider search work.
4. `TMDB Rate-Limit Investigation and Search Optimization` was promoted as `3.4.28`; keep remaining naming/social items separate after this provider/search slice.
5. `Collectibles Naming Review` was promoted as `3.4.29`; keep the current Collectibles name unless a later milestone intentionally revisits it.
6. `Event Social Planning Foundation` was promoted as `3.4.30`; keep `Event Social Planning Mobile Web Experience` queued behind the durable event-social data model.
7. `Personal Sched ICS Schedule Sync` was promoted as `3.4.31`; keep full schedule catalog/Now-Next discovery separate from personal selected-session sync.
8. The schedule-readability slice of `Event Social Planning Mobile Web Experience` was promoted as `3.4.33`; keep the broader mobile/social companion experience queued behind this drawer polish.
9. The day navigation and current/next readability slice of `Event Social Planning Mobile Web Experience` was promoted as `3.4.34`; keep the remaining schedule polish follow-ups queued as separate patch-sized tasks.
10. `Event Schedule Expanded Row Detail Polish` was promoted as `3.4.35`; keep quiet remove actions and Sched feed failure state queued separately.
11. `Event Schedule Quiet Remove Actions` was promoted as `3.4.36`; keep Sched feed failure state queued separately.
12. `Event Sched Feed Failure State Polish` was promoted as `3.4.37`; keep full schedule catalog and native companion sync visibility separate.
13. The mobile overview slice of `Event Social Planning Mobile Web Experience` was promoted as `3.4.38`; keep fast meetup updates, shared schedule item editing, and native companion behavior separate.
14. The fast meetup status and notes slice of `Event Social Planning Mobile Web Experience` was promoted as `3.4.39`; keep shared schedule editing, notifications, and native companion behavior separate.
15. The shared schedule item editing slice of `Event Social Planning Mobile Web Experience` was promoted as `3.4.40`; keep notifications, full schedule catalog discovery, and native companion behavior separate.
16. The private/shared visual treatment slice of `Event Social Planning Mobile Web Experience` was promoted as `3.4.41`; keep vendor/booth/location notes, notifications, full schedule catalog discovery, and native companion behavior separate.
17. The vendor/booth/location notes slice of `Event Social Planning Mobile Web Experience` was promoted as `3.4.42`; keep notifications, full schedule catalog discovery, and native companion behavior separate.
18. The compact contract slice of `Event Social Planning Platform Companion Contract` was promoted as `3.4.43`; keep native UI, push notifications, full schedule catalog discovery, offline mutation queues, realtime location, and broad social discovery separate.
19. `Platform Companion Personal Sched ICS Sync Visibility` was promoted as `3.4.44`; keep native UI, full schedule catalog discovery, background polling, push notifications, and offline mutation queues separate.
20. `Platform Companion Offline Event Packet` was promoted as `3.4.45`; keep full schedule catalog discovery, native UI, background polling, push notifications, realtime location, and offline mutation queues separate.
21. The shared session presence slice of event-local social discovery polish was promoted as `3.4.76`; keep event-local editing, cross-event identity, and delivery/provider work separate.
22. The social discovery readback slice of event-local social discovery polish was promoted as `3.4.77`; keep inline attendee/group/meetup editing, global friend graph work, and realtime presence separate.
23. The event-local social editability slice was promoted as `3.4.78`; keep cross-event identity, realtime presence, native companion social mutation UX, and true friend-graph work separate.
24. The self-attendee auto-link and `Add me` flow slice was promoted as `3.4.79`; keep external contact identities, cross-event identity, and broader friend graph work separate.
25. The self-attendee header-affordance polish slice was promoted as `3.4.80`; keep external contact identities, cross-event identity, and broader friend graph work separate.
26. The self-attendee default-creation slice was promoted as `3.4.81`; keep external contact identities, cross-event identity, and broader friend graph work separate.
27. The attendee duplicate guardrails slice was promoted as `3.4.82`; keep external contact identities, cross-event identity, Discord delivery, and broader friend graph work separate.
28. The mobile day-of social summary slice of `Event Social Planning Mobile Web Experience` was promoted as `3.4.83`; keep native companion behavior, push/Discord/email delivery, cross-event identity, external contacts, realtime presence, and broader friend graph work separate.
29. The mobile time-window filter slice of `Event Schedule Catalog Now/Next Follow-ups` was promoted as `3.4.84`; keep full catalog discovery redesign, native companion behavior, push/Discord/email delivery, cross-event identity, realtime presence, and broader friend graph work separate.
30. `Kavita Digital Library Integration` was promoted as `3.4.85`; keep metadata writeback, in-app/embedded reading, full import/sync, cross-provider digital-library abstractions, and reading-progress workflows separate.
31. The Kavita import/sync foundation, metadata mapping, and volume/chapter enrichment slices were promoted as `3.4.86`, `3.4.87`, and `3.4.88`; keep reader launch/progress discovery, metadata writeback, chapter-as-issue row fan-out, per-space Kavita administration, and shared provider abstractions as versionless backlog tasks until selected.
32. `Kavita External Reader Launch Contract` was promoted as `3.4.89`; keep embedded iframe reading, page streaming, reading progress sync, metadata writeback, and per-space Kavita administration separate.
33. `Kavita Reader and Progress Contract Discovery` was promoted as `3.4.91`; keep embedded iframe reading, page streaming, reading progress writeback, and per-space Kavita administration as separate backlog tasks until selected.
34. `Kavita Chapter-as-Issue Row Fan-out` was promoted as `3.4.92`; keep embedded reading, progress sync, metadata writeback, per-space Kavita administration, and shared provider abstractions separate until selected.
35. `Kavita Chapter-as-Issue Row Fan-out Implementation` was promoted as `3.4.93`; keep embedded reading, progress sync, metadata writeback, per-space Kavita administration, and shared provider abstractions separate.
36. `Kavita Workspace-Owned Integration Administration Contract` was promoted as `3.4.94`; keep implementation, embedded reading, progress sync, metadata writeback, and shared provider abstractions separate.
37. `Kavita Workspace-Owned Integration Administration Implementation` was promoted as `3.4.95`; keep embedded reading, progress sync, metadata writeback, special-chapter import, and shared provider abstractions separate.
38. `Kavita Metadata Writeback Contract` was promoted as `3.4.96`; keep actual writeback preview/apply UI, progress sync, external enrichment writeback, and shared provider abstractions separate.
39. `Kavita Metadata Writeback Preview and Diff` was promoted as `3.4.97`; keep actual writeback apply, progress sync, external enrichment writeback, locked-field override, and shared provider abstractions separate.
40. `Kavita Metadata Writeback Apply` was promoted as `3.4.98`; keep background sync, progress sync, external enrichment writeback, locked-field override, and shared provider abstractions separate.
41. `Kavita Writeback Field Selection UI` was promoted as `3.4.99`; keep background sync, progress sync, external enrichment writeback, locked-field override, and shared provider abstractions separate.
42. `Kavita Reading Progress Sync Contract` was promoted as `3.4.100`; keep actual progress UI/read implementation, progress writeback, embedded reading, page proxying, and shared provider abstractions separate.
43. `Kavita Read-Only Progress Visibility` was promoted as `3.4.101`; keep progress writeback, mark read/unread, embedded reading, page proxying, background polling, and shared provider abstractions separate.
44. `Kavita Progress Writeback and Page Proxy Reader` was promoted as `3.4.102`; keep mark read/unread, iframe/full embedded reader ownership, PDF/raw chapter file proxying, background polling, KOReader sync, and shared provider abstractions separate.
45. `Kavita Mark Read/Unread Contract` was promoted as `3.4.103`; keep runtime mark read/unread implementation, full embedded reader ownership, PDF/raw chapter file proxying, background polling, KOReader sync, and shared provider abstractions separate.
46. `Kavita Chapter Mark-Read Implementation` was promoted as `3.4.104`; keep series-wide mark read/unread, volume-wide mark read, chapter unread, full embedded reader ownership, PDF/raw chapter file proxying, background polling, KOReader sync, and shared provider abstractions separate.
47. `Kavita Chapter Unread Contract` was promoted as `3.4.105`; the reset-progress runtime proof was promoted as `3.4.106`; the explicit reset-progress implementation was promoted as `3.4.107`; reader-control polish was promoted as `3.4.108`; keep true chapter unread, full embedded reader ownership, PDF/raw chapter file proxying, background polling, KOReader sync, and shared provider abstractions separate.
48. `Plex PMS API Modernization Foundation` was promoted as `3.4.111`; the provider-discovery runtime proof was promoted as `3.4.112`; real-server provider discovery readback was promoted as `3.4.113`; Now Playing provider proof was promoted as `3.4.114`; Now Playing readback endpoint was promoted as `3.4.115`; Now Playing UI readback was promoted as `3.4.116`; real PMS Now Playing runtime proof was promoted as `3.4.117`; Now Playing Viewer was promoted as `3.4.118`; Now Playing Display Token was promoted as `3.4.119`; Now Playing Display Preferences was promoted as `3.4.120`; Plex Now Playing Vertical Poster Display was promoted as `3.4.121`; Plex Webhook and Ratings Sync Contract was promoted as `3.4.122`; Plex Webhook Receiver Administration Contract was promoted as `3.4.123`; Plex Webhook Receiver Processing and Import Enqueue Contract was promoted as `3.4.124`; Plex Single-Rating-Key Import Processing from Webhook Hints was promoted as `3.4.125`; Plex Webhook Import Hint Auto-Processor was promoted as `3.4.126`; Plex Webhook Existing Receiver Readback was promoted as `3.4.127`; Plex Watch-State Sync Cadence Contract was promoted as `3.4.128`; Plex Watched-State Apply Implementation was promoted as `3.4.129`; Plex Watched-State Scheduled Refresh was promoted as `3.4.130`; Plex Rating Readback Apply Implementation was promoted as `3.4.131`; Plex Watched-State Writeback Contract was promoted as `3.4.132`; Plex Watched-State Writeback Implementation was promoted as `3.4.133`; Plex Rating Writeback to Plex was promoted as `3.4.134`; Plex Writeback UI Controls was promoted as `3.4.135`; Plex Full-Library Reconciliation Contract was promoted as `3.4.136`; Plex Scheduled Reconciliation Preview Job was promoted as `3.4.137`; User Rating Scale Normalization was promoted as `3.4.138`; Temporary Reconciliation Review UI was promoted as `3.4.139`; Plex Reconciliation Auto-Sync and Conflict Review was promoted as `3.4.140`; Plex Reconciliation Full-Scan and Scheduler Automation was promoted as `3.4.141`; Plex Episode-Aware TV Sync and Writeback was promoted as `3.4.142`; Plex Reconciliation Conflict Review and Resolution was promoted as `3.4.143`; Plex Attach-Existing Conflict Resolution Contract was promoted as `3.4.144`; Plex Provider/API Import Parity Contract was promoted as `3.4.145`; Plex Provider Item-Listing API Discovery was promoted as `3.4.146`; Plex Real PMS Provider Item-Row Parity Proof was promoted as `3.4.147`; Plex Now Playing Multi-Session Display Polish was promoted as `3.4.148`; Plex Provider-Advertised Path Import Migration Contract was promoted as `3.4.149`; Plex Provider-Advertised Sections Root Runtime Migration was promoted as `3.4.150`; keep broad import rewrites separate.
49. `Kavita Comic Series Title Normalization and Issue Mapping` was promoted as `3.4.153`; `Kavita Comic Issue Coverage Guardrails` was promoted as `3.4.154`; `Kavita Numeric Comic Library Type Fan-out Fix` was promoted as `3.4.155`; `Kavita Chapter Issue Cover Proxy` was promoted as `3.4.156`; keep true chapter unread, embedded reader ownership, PDF/raw chapter file proxying, background polling, KOReader sync, repair of older already-imported rows, cover 404 recovery for missing Kavita source images, issue coverage audit, and shared provider abstractions separate.
50. `Barcode Scanner Backend Import API` was promoted as `3.4.157`; keep native scanner UI changes, public lookup exposure, bulk scanning queues, and frontend-mediated scanner flows separate.

### Backlog Item: Kavita True Chapter Unread Runtime Support
**Type:** Task
**Tags:** `kavita`, `reading-progress`, `read-state`, `comics`

**Goal:** Add real chapter unread behavior only if Kavita exposes a safe runtime contract for reversing chapter read state.

**Why this work exists**
- The first Kavita read-state work proved chapter mark-read and reset-progress behavior.
- True unread remains separate because the available runtime behavior needs proof before exposing UI that claims to reverse read state.

**Scope**
- Re-probe Kavita runtime behavior for chapter unread or equivalent reverse-read semantics.
- Add backend support only for a verified, chapter-scoped operation.
- Keep reset-progress behavior distinct from true unread in API and UI copy.
- Preserve workspace-owned Kavita credential boundaries and secret-free readback.

**Acceptance Criteria**
- Runtime smoke proves the exact Kavita call used for unread behavior.
- The UI does not label reset-progress as unread.
- If Kavita does not expose a safe operation, the slice closes with documented unsupported behavior instead of adding a misleading control.

### Backlog Item: Kavita Embedded Reader Ownership and File Proxying
**Type:** Deferred milestone
**Tags:** `kavita`, `reader`, `proxy`, `pdf`, `comics`, `books`

**Goal:** Decide whether collectZ should own a fuller embedded Kavita reading experience beyond current launch/page-control behavior.

**Scope**
- Evaluate full iframe ownership, chapter page proxying, PDF/raw chapter file proxying, and browser security constraints.
- Keep external Kavita launch behavior intact.
- Keep reading progress writeback explicit and user-controlled.
- Avoid exposing Kavita credentials, download URLs, or raw file paths to the frontend.

**Acceptance Criteria**
- The reader ownership boundary is documented.
- Any proxy endpoint is authenticated, workspace-scoped, and secret-free in browser-visible payloads.
- Existing external launch and page-control behavior keep working.

### Backlog Item: Kavita Background Progress Polling and KOReader Sync
**Type:** Deferred milestone
**Tags:** `kavita`, `sync`, `progress`, `koreader`, `background-jobs`

**Goal:** Explore recurring read-progress sync from Kavita and possible KOReader interoperability without making foreground import flows heavier.

**Scope**
- Define safe polling cadence and workspace ownership rules.
- Track progress changes without creating noisy writeback loops.
- Evaluate KOReader sync inputs and conflict behavior separately from Kavita-native progress.
- Keep manual import/sync and explicit progress writeback behavior intact.

**Acceptance Criteria**
- Background polling has clear cadence, ownership, and failure behavior.
- Progress conflicts are observable and do not silently overwrite newer user state.
- KOReader sync is represented as a separate provider path if it proves viable.

### Backlog Item: Kavita External Enrichment Writeback and Locked-Field Overrides
**Type:** Deferred milestone
**Tags:** `kavita`, `metadata`, `writeback`, `metron`, `google-books`, `enrichment`

**Goal:** Extend Kavita metadata writeback beyond manual field selection by safely using external enrichment sources and explicit locked-field decisions.

**Scope**
- Compare collectZ-enriched metadata from comics/books providers against Kavita fields.
- Add explicit locked-field override decisions before changing Kavita-owned metadata.
- Keep preview/diff and manual apply behavior as the required safety layer.
- Avoid automatic background writeback until conflicts and ownership are well understood.

**Acceptance Criteria**
- External enrichment candidates are shown with provenance before writeback.
- Locked Kavita fields require an explicit user override.
- Writeback remains auditable and workspace-scoped.

### Backlog Item: Kavita Special-Chapter Import Handling
**Type:** Task
**Tags:** `kavita`, `imports`, `comics`, `metadata`

**Goal:** Handle Kavita special chapters, annuals, one-shots, and non-standard issue numbering without corrupting normal series or chapter-as-issue rows.

**Scope**
- Identify Kavita chapter records that do not map cleanly to ordinary issue numbers.
- Preserve source identity and title metadata for specials.
- Keep normal series-level and opt-in chapter-as-issue imports stable.
- Avoid broad external comic registry matching in this first slice.

**Acceptance Criteria**
- Special chapters can be imported or skipped with clear readback.
- Non-standard numbering does not collapse into issue `1` or overwrite standard issue rows.
- Repeat sync remains idempotent.

### Backlog Item: Shared Digital Library Provider Abstractions
**Type:** Deferred milestone
**Tags:** `kavita`, `calibre`, `cwa`, `opds`, `providers`, `imports`

**Goal:** Consolidate common provider/import contracts across Kavita, Calibre/CWA OPDS, and future digital-library sources without hiding provider-specific behavior.

**Why this work exists**
- Kavita, CWA/Calibre, and OPDS sources now share concepts such as provider ids, external URLs, download/reader links, cover art, and repeat-sync identity.
- A shared abstraction can reduce duplication, but only after provider-specific behavior has been proven.

**Scope**
- Inventory common provider fields and source-specific exceptions.
- Define shared import identity, link, cover-art, and credential-redaction helpers.
- Preserve provider-specific API behavior and smoke coverage.
- Keep metadata writeback and reader/progress sync as separate contracts.

**Acceptance Criteria**
- Common digital-library import behavior has one documented contract.
- Existing Kavita and CWA/Calibre smokes continue to prove provider-specific identity, link, and cover behavior.

### Backlog Item: Artwork Edition Registry and Valuation Enrichment
**Type:** Deferred milestone
**Tags:** `artwork`, `prints`, `valuation`, `edition-series`, `metadata`

**Goal:** Build on item-local numbered print metadata with optional enrichment for edition-series details, external registries, certificates, and valuation providers.

**Scope**
- Explore whether numbered print runs can be linked to a reusable edition-series concept without making manual art entry heavier.
- Evaluate external print registries or certificate/provenance sources where available.
- Add valuation-provider enrichment only when provenance and confidence can be shown clearly.
- Keep current per-item print number, print run, signed state, and medium entry intact.

**Acceptance Criteria**
- Existing item-local print metadata continues to work without external enrichment.
- Any external edition or valuation data includes source/provenance readback.
- Certificate or registry data never silently overwrites user-entered art details.


### Backlog Item: Apple Platform App Contract Publishing
**Type:** Deferred milestone
**Tags:** `apple`, `ios`, `ipados`, `macos`, `tvos`, `openapi`, `releases`, `contract`

**Goal:** Publish collectZ as a versioned backend contract and release artifact set so a separate SwiftUI Apple-platform repo can build and consume the API without depending on the web app repo layout or source tree.

**Why this work exists**
- The Apple app will live in its own repository and needs a stable way to consume collectZ API changes.
- The Apple app should not depend on the web frontend build output or on direct source sharing from this repo.
- Versioned contract artifacts give the Apple repo a pinned, reproducible input for Swift code generation and client integration.

**Scope**
- Keep `backend/openapi/openapi.yaml` as the source-of-truth contract for backend behavior.
- Publish the OpenAPI contract as a versioned artifact on tagged releases.
- Keep the existing GHCR backend/frontend image publishing flow for deployable runtime images.
- Expose a clear release package for other repos to consume, without splitting this repository into multiple source trees.
- Document how a separate Apple repo should download the pinned contract artifact and generate Swift client types from it.
- Decide whether GitHub Releases, release assets, or another versioned artifact host is the canonical distribution path for the contract.

**Acceptance Criteria**
- A tagged backend release publishes a versioned API contract artifact.
- The contract artifact can be consumed from a separate repository without checking out this repo.
- The Apple repo can pin to a specific backend version and generate Swift client models from it.
- Backend/frontend deployable images remain versioned and published as they are today.
- The publication and consumption flow is documented clearly enough for a separate Apple app repo to implement it without guesswork.

### Backlog Item: Deferred Vite Compatibility Shim Removal
**Type:** Deferred milestone
**Tags:** `frontend`, `vite`, `react`, `cleanup`, `compatibility`, `3.6-candidate`, `3.7-candidate`

**Goal:** Remove the remaining CRA-era frontend compatibility shims after the Vite-first runtime has baked long enough to prove there are no React behavior regressions.

**Follow-up timing**
- Revisit this item when planning `3.6` or `3.7`.
- Promote only if no React behavior issues, frontend env regressions, Docker build regressions, or browser-regression instability have appeared since the `3.4.21` Vite env cleanup.
- If React/Vite behavior issues appear before `3.6`/`3.7`, keep this item deferred and treat the compatibility shims as safety rails until the issues are understood.

**Scope**
- Remove `REACT_APP_*` fallback reads from frontend source once `VITE_*` is proven safe everywhere.
- Remove legacy `REACT_APP_*` Docker build args/env plumbing from `frontend/Dockerfile`.
- Remove the `process.env.REACT_APP_*` define bridge from `frontend/vite.config.js`.
- Decide whether the explicit `build:vite`, `dev:vite`, and `preview:vite` aliases still add clarity or should be removed once Vite is no longer a transition concern.
- Update docs, CI checks, and unit source assertions so `VITE_*` is the only maintained frontend env contract.

**Acceptance Criteria**
- Frontend source reads Vite env through `import.meta.env` / the shared Vite env helper without `REACT_APP_*` fallback.
- Docker and CI frontend build args expose only `VITE_*` frontend configuration.
- Docs no longer describe `REACT_APP_*` as supported configuration, except in historical release notes.
- Docker-first frontend build, default homelab boundary, explicit platform boundary, and browser regression pass after removal.
- The release closeout explicitly confirms no observed React behavior regressions triggered the deferral guard.

### Backlog Item: Public Homelab Repo Promotion and Export Workflow
**Type:** Deferred milestone
**Tags:** `major-feature`, `infra`, `risk`, `homelab`, `repo-promotion`
**Status:** Partially completed by public-compose/env/docs cleanup; remaining work is actual publication/export automation.

**Goal:** Prepare the public homelab repo promotion and export workflow after the shared-core boundary settles.

**Current state**
- Public homelab compose and private platform surface scrub work shipped in `3.4.20`.
- Public environment/docs cleanup shipped across the `3.8.x` line, including simplified env examples and public homelab reference updates.
- GHCR image publication exists for backend/frontend runtime images.
- A separate public repo/export workflow is not yet automated or documented as a repeatable release operation.

**Scope**
- Define how shared-core content is packaged for public release.
- Define how publication and update flow work for the homelab repo.
- Keep the public repo free of private platform shell surfaces.
- Make the promotion path intentional instead of ad hoc.

**Remaining subtasks**
- Decide whether the public homelab artifact is a separate repository, release asset bundle, or generated export branch.
- Add an export validation checklist that proves no private platform-only docs, env knobs, credentials, or internal runbooks leak into the public artifact.
- Document how `latest` and stable tags map to public deployment updates.
- Add release automation only after the exported artifact boundary is stable enough to maintain.

**Acceptance Criteria**
- The public homelab repo contains no private platform shell surfaces.
- The packaging and publication flow is documented and repeatable.
- Update flow from the private source into the public repo is clear and intentional.

### Backlog Item: Personal Workspace Offboarding, Archive Retention, and Recovery
**Type:** Deferred milestone
**Tags:** `workspace`, `lifecycle`, `retention`, `recovery`

**Goal:** Define the SaaS account and workspace offboarding path for personal workspaces.

**Scope**
- Separate workspace membership removal from account/workspace offboarding.
- Keep ordinary workspace admin actions limited to `Remove from Workspace`.
- Use an inactive/archive lifecycle instead of immediate hard deletion by default.
- Define recovery behavior when the same user later re-registers.
- Preserve content attribution even if the original account no longer exists.

**Acceptance Criteria**
- Workspace admins remove members from shared workspaces without deleting shared content.
- Personal workspace offboarding uses a documented inactive/archive/deletion lifecycle.
- Re-registration with the same email can recover an archive-eligible personal workspace during the retention window.
- The `0-30 / 31-90 / 91+ day` retention behavior is documented, implemented, and auditable.

### Backlog Item: Optional Build: Cost Model and Billing Readiness
**Type:** Deferred milestone
**Tags:** `cost-model`, `billing`, `hosted`, `metering`

**Goal:** Prepare a data-backed cost model before any hosted subscription offering.

**Scope**
- Add usage metering primitives for provider calls, sync jobs, and storage.
- Build a cost estimation model with low, mid, and high bands.
- Add a read-only admin cost estimate view for hosted-mode planning.
- Define deployment profiles for self-hosted and hosted subscription usage.
- Document break-even and guardrail thresholds for enabling paid integrations by default in hosted mode.

**Acceptance Criteria**
- Cost estimates can be generated from real usage telemetry.
- Top cost drivers are visible and attributable.
- The self-hosted profile remains fully functional with paid-provider integrations disabled.

### Backlog Item: Imports and Sync Cadence Expansion
**Type:** Deferred milestone
**Tags:** `imports`, `csv`, `calibre`, `kavita`, `metron`, `sync`
**Status:** Active backlog for non-Plex providers and CSV templates; Plex broad sync work is closed.

**Goal:** Expand import templates and synchronization cadence controls across the supported non-Plex import sources.

**Current state**
- Plex import/reconciliation/scheduler/writeback work is closed and should not be reopened under this broad item.
- Kavita has substantial import/sync behavior, issue fan-out, covers, progress, writeback, and workspace-owned administration, but still has separate backlog for special chapters, background progress polling, and shared provider abstraction.
- Barcode/ISBN scanner API and Capture Inbox paths exist.
- Multiple type-specific CSV templates and non-Plex cadence controls are not yet formalized as a shared import operating model.

**Scope**
- Add multiple CSV templates for:
  - Games
  - Movies / TV
  - Audio
  - Events
  - Collectibles
  - Books
- Define cadence for updates from:
  - Calibre
  - Kavita
  - Metron

**Remaining subtasks**
- Inventory existing CSV import mappings and identify gaps by media type.
- Add template files, docs, and import smoke coverage for each supported CSV shape.
- Define per-provider cadence readback and controls for Calibre/CWA, Kavita, and Metron where applicable.
- Route failed/stale import cadence states into Dashboard/health or the future Unified Review Queue.
- Keep provider-specific metadata behavior documented instead of hiding it behind one generic sync label.

**Plex status**
- Plex import, provider discovery, provider-advertised sections-root resolution, webhook receipt/processing, new-title hints, watched-state sync/writeback, rating readback/writeback, reconciliation, conflict review, scheduled/full-scan behavior, and operating-model UI/docs cleanup were promoted and closed across `3.4.111` through `3.4.151`.
- Plex now uses `/media/providers` as capability discovery and resolves provider-advertised `/library/...` roots where proven safe. Current item import remains on documented Plex library paths because real-PMS provider item-row proof did not expose a better provider item-listing candidate.
- Do not reopen broad Plex provider item-listing migration unless a future Plex PMS shape exposes richer provider-advertised item rows and a new runtime proof shows identity, metadata, and repeat-sync parity.

**Acceptance Criteria**
- The named CSV templates are available for the supported library types.
- Update cadence can be described and configured for Calibre, Kavita, and Metron sources.
- Plex remains represented by completed promoted milestones instead of stale future-work bullets.

### Backlog Item: Support Metrics and Satisfaction Surveys
**Type:** Task
**Tags:** `support`, `metrics`, `csat`, `nps`, `survey`

**Goal:** Add support metrics and a post-close satisfaction survey path.

**Scope**
- Track support metrics for CSat.
- Track support metrics for Promoter-style feedback.
- When a support request is closed, optionally send a satisfaction survey.

**Acceptance Criteria**
- Support metrics can capture satisfaction and promoter-style feedback.
- Closed support requests can trigger an optional survey.
- The survey flow stays aligned with the support request lifecycle.


### Backlog Item: Event Social Planning Mobile Web Experience
**Type:** Task
**Tags:** `events`, `mobile`, `ui`, `social`, `meetups`, `schedule`
**Status:** Mostly completed across `3.4.33` through `3.4.84`; keep only for new mobile-web polish discovered through real use.

**Goal:** Make the web app's event social planning views useful on a phone during a con before building native companion surfaces.

**Current state**
- The Event drawer now includes mobile schedule readability, day navigation, compact social overview, fast meetup/status updates, shared schedule editing, private/shared treatment, vendor/booth/location notes, day-of social summary, and mobile time-window filters.
- Event-local attendee, group, meetup, schedule, notification draft/history/inbox, and delivery-attempt readback foundations are present.
- The broad "make it usable on mobile" intent is no longer a blank backlog item; future work should be specific polish found during real event use.

**Scope**
- Continue the mobile-first event social view beyond the completed `3.4.38` through `3.4.42` slices when new small mobile-social polish needs appear.
- Optimize the view for quick day-of-con scanning rather than admin-heavy editing.
- Keep the UI privacy-aware so private and shared items are visually distinct.
- Preserve desktop planning views for richer pre-con editing.

**Remaining subtasks**
- Record concrete mobile friction from actual con/day-of use instead of inventing broad UI work.
- Promote only narrow slices such as "reduce drawer scrolling for X," "make Y action thumb-reachable," or "clarify Z privacy readback."
- Keep native companion work in the platform-app backlog items instead of widening this web task.

**Acceptance Criteria**
- A user can open an event on mobile and quickly see who/when/where for social plans.
- Meetups and schedule plans are readable without excessive drawer scrolling.
- Private vs shared records are visually clear.
- The mobile web surface is good enough to validate the workflow before native/platform implementation.

### Backlog Item: Event Schedule Catalog Now/Next Follow-ups
**Type:** Deferred milestone
**Tags:** `events`, `schedule`, `discovery`, `sched`, `calendar`, `mobile`
**Status:** Mostly completed for web/backend catalog discovery; remaining work should be narrow import/provider polish or native-companion-specific.

**Goal:** Build on the `3.4.46` and `3.4.47` schedule catalog foundation/entry work with import, discovery, and richer quick planning flows for sessions happening during a con.

**Why this work exists**
- Sched-style full event calendars are useful, but mobile discovery is often weak when a user needs to decide what to do right now.
- collectZ can make event calendars more actionable by combining session discovery with planned attendance, friends, groups, meetups, and collection/event context.
- The `3.4.46` foundation added canonical catalog storage that is distinct from a user's personal plan.
- The `3.4.47` polish slice added manual catalog entry/editing plus guarded catalog-to-schedule creation.
- The `3.4.48` read-only slice is promoted to add the first compact Now / Next view from existing catalog sessions.
- The `3.4.49` quick-state slice is promoted to let catalog and Now / Next sessions create or update linked personal plan states.
- The `3.4.50` conflict-detection slice is promoted to show read-only overlap warnings before replacement or notification workflows.
- The `3.4.51` conflict-resolution slice is promoted to make local keep/backup/skip choices explicit before notification workflows.
- The `3.4.52` attendance-readback slice is promoted to show visibility-aware shared schedule context before selected-recipient notifications.
- The `3.4.53` catalog-filter slice is promoted to make long event catalogs scannable before selected-recipient notifications or native companion work.
- The `3.4.54` catalog-metadata-filter slice is promoted to add track, category, and room/location filters to the web catalog before selected-recipient notifications or native companion work.
- The `3.4.55` catalog-ICS-import slice is promoted to seed canonical catalog sessions from provider calendar feeds without recurring sync or personal-plan side effects.
- The `3.4.56` catalog-to-personal matching slice is promoted to connect confident personal Sched plans back to matching catalog sessions without rewriting personal source identity.
- The `3.4.57` selected-recipient change-preview slice is promoted to preview affected people/groups and conflicts before real notification delivery work.
- The `3.4.58` selected-recipient notification contract slice is promoted to persist draft/sent Event-local schedule notifications without push/device delivery.
- The `3.4.59` notification history slice is promoted to read back those Event-local draft/sent schedule notification records in the drawer.
- The `3.4.60` notification inbox/readback slice is promoted to add Event-local recipient rows with read/acknowledged state before push, email, or native device delivery.
- The `3.4.61` user-linked attendee identity slice is promoted to connect Event attendees to the current app user for "mine" inbox filtering without broad friend identity or native delivery.
- The `3.4.62` My Notifications filter UI slice is promoted to expose the current-user inbox filter in the Event drawer.
- The `3.4.63` shared-attendance card slice is promoted to show visibility-safe people/group context directly on session cards.
- The `3.4.64` join/leave/replace action slice is promoted to turn session-card readback into quick plan-change intent.
- The `3.4.65` change-template slice is promoted to seed selected-recipient local notification drafts from schedule action intent.
- The `3.4.66` template-picker slice is promoted to let users choose and edit Event-local notice text before save/send.
- The `3.4.67` recipient-selection UI polish slice is promoted to let users trim eligible people/groups before saving or sending an Event-local notice.
- The `3.4.68` draft-management slice is promoted to edit, send, or discard Event-local schedule notification drafts.
- The `3.4.69` delivery-boundary slice is promoted to give platform/native clients a stable Event-local delivery contract before any push, email, or device-provider work exists.
- The `3.4.70` provider-prep slice is promoted to describe disabled push/email/platform-device providers without creating delivery attempts or enabling external delivery.
- The `3.4.71` delivery-attempt model slice is promoted to define the future attempt audit shape while keeping attempt creation disabled.
- The `3.4.72` delivery-attempt persistence slice is promoted to create/read Event-local attempt audit rows without enabling external providers.
- The `3.4.73` delivery-attempt readback UI slice is promoted to surface Event-local attempt audit evidence in notification history.
- Later slices added platform companion Now/Next contracts (`3.4.74` and `3.4.75`), social discovery/readback, attendee duplicate guardrails, mobile day-of social summary, and mobile time-window filters through `3.4.84`.
- The original broad web/backend catalog intent is mostly shipped; this item remains only as a parking place for specific catalog import/provider or day-of-discovery polish.

**Scope**
- Support importing or manually entering an event's full schedule catalog.
- Add a mobile-friendly "Now / Next" view for sessions happening now, starting soon, and optionally later today.
- Add filters for time window, track/category, location/room, planned status, friend/group attendance, and conflicts.
- Add session states such as planned, maybe, skipped, backup, and unavailable where useful.
- Keep Sched ingestion conservative: prefer supported export/import paths over brittle scraping.

**Remaining subtasks**
- Identify any missing provider import path beyond current ICS/manual entry.
- Add only concrete catalog discovery improvements that cannot be solved by the existing filters and Now/Next readback.
- Keep push/email/device-provider delivery outside this item unless a delivery provider task is explicitly selected.
- Move native Swift/UI work to the platform companion backlog items.

**Acceptance Criteria**
- Catalog import flows build on `event_schedule_sessions` instead of personal selected schedule plans.
- The web app can show sessions happening now and starting soon.
- A user can quickly mark a session as planned, maybe, skipped, or backup.
- Overlapping sessions are detectable as conflicts.
- The schedule catalog can later be cached by a platform companion app.

### Backlog Item: Friend-Aware Session Changes and Notifications
**Type:** Deferred milestone
**Tags:** `events`, `social`, `schedule`, `notifications`, `friends`, `groups`
**Status:** Backend/local event notification workflow mostly shipped; remaining work is external delivery and/or native app UX.

**Goal:** Let users quickly change session choices and notify selected friends or groups about the plan change.

**Current state**
- Join/leave/replace/backup intent, selected-recipient drafts, templates, recipient trimming, draft management, notification history/inbox/readback, delivery attempt audit rows, and platform companion contracts have shipped.
- Delivery providers are intentionally described but disabled; there is no push/email/device delivery.
- No broad friend graph exists; the model remains event-local and visibility-aware.

**Scope**
- Add explicit actions for joining, leaving, replacing, or marking backup sessions. The first web-card slice is promoted as `3.4.64`.
- When a change affects shared plans, offer selected-recipient notifications instead of broadcasting by default. The first action-template slice is promoted as `3.4.65`; picker/edit UI is promoted as `3.4.66`; recipient-selection polish is promoted as `3.4.67`; draft-management UI is promoted as `3.4.68`; the delivery-boundary/platform contract is promoted as `3.4.69`; provider-prep metadata is promoted as `3.4.70`; the delivery-attempt model contract is promoted as `3.4.71`; Event-local delivery-attempt persistence/readback is promoted as `3.4.72`; delivery-attempt readback UI is promoted as `3.4.73`.
- A session-presence polish slice is promoted as `3.4.76` to make shared attendance readback clearer on cards and in expanded detail without adding a friend graph or delivery behavior.
- An Event-social discovery readback slice is promoted as `3.4.77` to make People, Groups, and Meetups feel more connected in the drawer without widening the backend social model.
- Support message templates such as:
  - "I'm switching to this session"
  - "Anyone want to join?"
  - "Meet outside this room"
  - "I'm dropping this session"
- Show friend/group attendance on session cards when visibility allows.
- Handle conflicts by offering replace, keep as backup, or keep both tentative.
- Respect privacy levels from the event social planning model.

**Remaining subtasks**
- Pick an actual delivery provider path, such as email, push, platform-device, or Discord, before adding real outbound delivery.
- Keep delivery opt-in per change and selected-recipient by default.
- Add provider-specific failure/readback only after external delivery is enabled.
- Keep any native Apple session-change UI in the platform companion backlog.

**Acceptance Criteria**
- A user can change session plans from a quick event/session view.
- The app can notify selected friends or groups about the change.
- Friend/group visibility is permission-aware.
- Session conflicts are handled intentionally instead of silently overwriting plans.

### Backlog Item: Platform Companion Now/Next Schedule Experience
**Type:** Deferred milestone
**Tags:** `apple`, `platform-app`, `xcode`, `events`, `schedule`, `offline`, `notifications`
**Status:** Backend/API contract shipped as `3.4.74`; remaining work is native app implementation outside this repo plus any contract gaps found by that app.

**Goal:** Make the Apple/Xcode app a useful day-of-con companion for fast schedule discovery and plan changes while the web app remains the canonical planning surface.

**Why this work exists**
- The platform app should be most useful when a user is already on the convention floor and needs to decide what is happening now, what is next, and whether a session switch is worth it.
- Personal Sched ICS sync should inform the user's plan state, but it should not masquerade as the full event calendar.
- The native app should consume versioned backend/OpenAPI behavior instead of depending on web frontend files, layouts, or source sharing.

**Scope**
- Consume the backend event schedule catalog, personal planned schedule state, and relevant location metadata through versioned API/OpenAPI behavior.
- Show a fast "Now / Next" surface for current, upcoming, and nearby sessions for the active event.
- Clearly distinguish full catalog sessions from the user's personal planned or ICS-synced sessions.
- Support quick actions for `planned`, `maybe`, `skipped`, and `backup` when the backend contract allows them.
- Surface conflict state and replacement choices when a user changes from one overlapping session to another.
- Optimize the native view for convention-floor speed rather than admin-heavy editing.
- Keep the platform app positioned as a companion surface; setup and broader planning still happen primarily on the web.

**Acceptance Criteria**
- The platform app is useful during the con even when setup and planning happened on the web.
- Current, upcoming, and nearby sessions are readable with minimal navigation friction.
- Catalog sessions and personal planned sessions are visually distinct.
- Quick plan-change actions and conflict cues are available without requiring web-specific UI assumptions.
- The app consumes versioned backend/OpenAPI behavior and does not depend on web frontend files.

**Promotion**
- The backend/API companion contract slice for this work is promoted as `3.4.74`. Native Swift UI implementation remains outside this webapp repo.
- Do not promote more backend work from this item until the native client identifies a concrete contract gap.

### Backlog Item: Platform Companion Friend-Aware Session Changes
**Type:** Deferred milestone
**Tags:** `apple`, `platform-app`, `xcode`, `events`, `social`, `schedule`, `notifications`, `privacy`
**Status:** Backend/API contract shipped as `3.4.75`; remaining work is native app implementation and future real delivery-provider integration.

**Goal:** Let the Apple/Xcode app handle quick session plan changes with opt-in, privacy-aware friend and group notifications.

**Why this work exists**
- Session switching often happens in motion, and the day-of-con device is the right place to send a fast update to a selected set of people.
- Notifications should help coordination without becoming noisy or broadcast-by-default.
- Privacy and visibility rules must stay backend-owned so the native app does not invent weaker sharing behavior.

**Scope**
- Let users notify selected friends or groups when changing plans from the native app.
- Support opt-in message templates such as:
  - `I'm switching to this session`
  - `Anyone want to join?`
  - `Meet outside this room`
  - `I'm dropping this session`
- Default to selected-recipient notifications instead of broad broadcast behavior.
- Respect backend privacy and visibility rules for friend/group/session-sharing state.
- Show enough context around the session change to understand who will be notified and whether a conflict or replacement is occurring.

**Acceptance Criteria**
- Plan changes can trigger selected-recipient notifications from the platform app.
- Message templates support common day-of-con coordination cases without requiring freeform social discovery features.
- Notification behavior is opt-in per change and not broadcast by default.
- Backend privacy and visibility rules are enforced consistently by the platform app.

**Promotion**
- The backend/API companion contract slice for this work is promoted as `3.4.75`. Native Swift UI implementation remains outside this webapp repo.
- Do not promote more backend work from this item until the native client or a selected delivery provider exposes a concrete contract gap.
