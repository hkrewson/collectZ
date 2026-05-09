# Backlog

This file is the staging area for work that has not yet been assigned a release version. Items stay here until they are selected for a numbered milestone.

## How to use the backlog

- Keep backlog items versionless until they are promoted.
- Treat tags as metadata only.
- Keep each item clearly scoped as a task, bug, discussion, or deferred milestone.
- If an item is clearly a release candidate, mark it as such in the backlog, but do not assign a version number yet.
- When a backlog item is selected for work, move it into the roadmap as a numbered milestone instead of copying it.
- Keep the roadmap focused on milestone work only.
- Update the roadmap, release notes, release feed, and verification steps together when a backlog item is promoted.

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
48. `Plex PMS API Modernization Foundation` was promoted as `3.4.111`; the provider-discovery runtime proof was promoted as `3.4.112`; real-server provider discovery readback was promoted as `3.4.113`; Now Playing provider proof was promoted as `3.4.114`; Now Playing readback endpoint was promoted as `3.4.115`; Now Playing UI readback was promoted as `3.4.116`; real PMS Now Playing runtime proof was promoted as `3.4.117`; Now Playing Viewer was promoted as `3.4.118`; Now Playing Display Token was promoted as `3.4.119`; Now Playing Display Preferences was promoted as `3.4.120`; Now Playing Vertical Poster Display was promoted as `3.4.121`; Plex Webhook and Ratings Sync Contract was promoted as `3.4.122`; Plex Webhook Receiver Administration Contract was promoted as `3.4.123`; Plex Webhook Receiver Processing and Import Enqueue Contract was promoted as `3.4.124`; Plex Single-Rating-Key Import Processing from Webhook Hints was promoted as `3.4.125`; Plex Webhook Import Hint Auto-Processor was promoted as `3.4.126`; Plex Webhook Existing Receiver Readback was promoted as `3.4.127`; Plex Watch-State Sync Cadence Contract was promoted as `3.4.128`; keep watched-state apply/writeback, rating writeback apply behavior, scheduled full-library reconciliation, and broad import rewrites separate.

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

### Backlog Item: Reusable Artist Records for Artwork Entry
**Type:** Task
**Tags:** `artwork`, `artists`, `creators`, `metadata`, `ux`

**Goal:** Let users create, reuse, and update artist details once, then link artwork to those artist records without re-entering the same details for every item.

**Why this work exists**
- Artwork entry currently depends too much on repeated per-item artist details.
- Users should be able to add artwork by an artist they already know without retyping bio, aliases, links, notes, or other creator metadata.
- Artist creation and artist selection should live inside the same artwork entry workflow so adding a new artist does not interrupt cataloging.

**Scope**
- Add reusable artist/creator records that can be linked from artwork items.
- Support typeahead search from the artwork artist field against existing artist records.
- Allow inline artist creation from the same artist field when no existing artist matches.
- When an existing artist is selected, autofill or expose known artist details without overwriting artwork-specific fields.
- Make keyboard flow efficient: tabbing or moving to the next field should accept a highlighted match where that behavior is clear and reversible.
- Keep artwork-specific metadata on the artwork item, such as title, medium, purchase/source details, provenance, signatures, photos, framing, or certificate details.
- Support enough role flexibility to avoid assuming every linked person is only the primary artist.
- Leave event exhibitor lookup/import out of this first slice; event vendors can be considered later as a separate provenance helper.

**Acceptance Criteria**
- A user can create an artist record once and reuse it across multiple artwork entries.
- A user can search existing artists with typeahead while adding or editing artwork.
- A user can create a new artist inline from the artwork entry flow without navigating away.
- Selecting an artist brings forward known artist metadata while preserving artwork-specific fields.
- Keyboard navigation supports fast entry without surprising or irreversible autofill.
- Artwork detail views can show linked artist information and navigate to other works by the same artist.
- The implementation clearly distinguishes reusable artist metadata from per-artwork provenance and item details.

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

**Goal:** Prepare the public homelab repo promotion and export workflow after the shared-core boundary settles.

**Scope**
- Define how shared-core content is packaged for public release.
- Define how publication and update flow work for the homelab repo.
- Keep the public repo free of private platform shell surfaces.
- Make the promotion path intentional instead of ad hoc.

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
**Tags:** `imports`, `csv`, `plex`, `calibre`, `kavita`, `metron`, `sync`

**Goal:** Expand import templates and synchronization cadence controls across the supported import sources.

**Scope**
- Add multiple CSV templates for:
  - Games
  - Movies / TV
  - Audio
  - Events
  - Collectibles
  - Books
- Define cadence for updates from:
  - Plex
  - Calibre
  - Kavita
  - Metron
- Move Plex import to the actual API instead of a placeholder or indirect path.
- Set a cadence to check for new titles in Plex.
- Set a cadence to check for updated watch statuses in Plex.
- Receive and process Plex webhooks.

**Acceptance Criteria**
- The named CSV templates are available for the supported library types.
- Update cadence can be described and configured for Plex, Calibre, Kavita, and Metron sources.
- Plex import uses the actual API path.
- New-title checks, watch-status checks, and webhooks are all represented in the import design.

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

**Goal:** Make the web app's event social planning views useful on a phone during a con before building native companion surfaces.

**Scope**
- Continue the mobile-first event social view beyond the completed `3.4.38` through `3.4.42` slices when new small mobile-social polish needs appear.
- Optimize the view for quick day-of-con scanning rather than admin-heavy editing.
- Keep the UI privacy-aware so private and shared items are visually distinct.
- Preserve desktop planning views for richer pre-con editing.

**Acceptance Criteria**
- A user can open an event on mobile and quickly see who/when/where for social plans.
- Meetups and schedule plans are readable without excessive drawer scrolling.
- Private vs shared records are visually clear.
- The mobile web surface is good enough to validate the workflow before native/platform implementation.

### Backlog Item: Event Schedule Catalog Now/Next Follow-ups
**Type:** Deferred milestone
**Tags:** `events`, `schedule`, `discovery`, `sched`, `calendar`, `mobile`

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
- This follow-up turns that data into import-backed and time-aware discovery surfaces.

**Scope**
- Support importing or manually entering an event's full schedule catalog.
- Add a mobile-friendly "Now / Next" view for sessions happening now, starting soon, and optionally later today.
- Add filters for time window, track/category, location/room, planned status, friend/group attendance, and conflicts.
- Add session states such as planned, maybe, skipped, backup, and unavailable where useful.
- Keep Sched ingestion conservative: prefer supported export/import paths over brittle scraping.

**Acceptance Criteria**
- Catalog import flows build on `event_schedule_sessions` instead of personal selected schedule plans.
- The web app can show sessions happening now and starting soon.
- A user can quickly mark a session as planned, maybe, skipped, or backup.
- Overlapping sessions are detectable as conflicts.
- The schedule catalog can later be cached by a platform companion app.

### Backlog Item: Friend-Aware Session Changes and Notifications
**Type:** Deferred milestone
**Tags:** `events`, `social`, `schedule`, `notifications`, `friends`, `groups`

**Goal:** Let users quickly change session choices and notify selected friends or groups about the plan change.

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

**Acceptance Criteria**
- A user can change session plans from a quick event/session view.
- The app can notify selected friends or groups about the change.
- Friend/group visibility is permission-aware.
- Session conflicts are handled intentionally instead of silently overwriting plans.

### Backlog Item: Platform Companion Now/Next Schedule Experience
**Type:** Deferred milestone
**Tags:** `apple`, `platform-app`, `xcode`, `events`, `schedule`, `offline`, `notifications`

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

### Backlog Item: Platform Companion Friend-Aware Session Changes
**Type:** Deferred milestone
**Tags:** `apple`, `platform-app`, `xcode`, `events`, `social`, `schedule`, `notifications`, `privacy`

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
