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
**Tags:** `imports`, `csv`, `plex`, `calibre`, `metron`, `sync`

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
  - Metron
- Move Plex import to the actual API instead of a placeholder or indirect path.
- Set a cadence to check for new titles in Plex.
- Set a cadence to check for updated watch statuses in Plex.
- Receive and process Plex webhooks.

**Acceptance Criteria**
- The named CSV templates are available for the supported library types.
- Update cadence can be described and configured for Plex, Calibre, and Metron sources.
- Plex import uses the actual API path.
- New-title checks, watch-status checks, and webhooks are all represented in the import design.

### Backlog Item: Now Playing Viewer
**Type:** Task
**Tags:** `plex`, `now-playing`, `display`, `kiosk`, `ui`

**Goal:** Add a dedicated Now Playing viewer for a display-driven device such as an SBC.

**Scope**
- Create a unique page that can be opened on an SBC or similar display device.
- Show a full-sized Plex poster for either:
  - the next queued title
  - the title currently playing
- Keep the page simple enough for passive viewing on a dedicated screen.

**Acceptance Criteria**
- The viewer can be opened independently from the main app shell.
- The page shows a full-sized poster for the current or next queued title.
- The display experience is readable from across a room.

### Backlog Item: Plex PMS API Modernization Foundation
**Type:** Deferred milestone
**Tags:** `plex`, `api`, `pms`, `integration`, `modernization`

**Goal:** Gradually move Plex integration work toward the Plex Media Server API model documented in the official PMS API guide instead of continuing to hardwire older library-section request paths everywhere.

**Why this work exists**
- The current Plex integration in this repo still centers on direct library endpoints such as `/library/sections` and `/library/metadata/...`.
- The official Plex PMS guidance for new applications recommends JSON responses and a provider-oriented approach centered on `/media/providers`.
- New Plex-facing features such as a future Now Playing viewer are a good opportunity to adopt the newer contract intentionally instead of expanding older assumptions further.

**Scope**
- Audit the current Plex service layer and identify where it still hard-codes legacy library-section and metadata paths.
- Define a provider-oriented Plex client contract aligned with the official PMS API guidance:
  - prefer JSON,
  - prefer `/media/providers` and feature discovery where practical,
  - reduce reliance on hard-coded library-path assumptions for new work.
- Keep existing import and dedupe behavior stable while adding the newer Plex contract alongside the current one.
- Use one narrow Plex-facing feature to prove the newer contract before considering broader migration of existing import flows.
- Document migration boundaries clearly so future Plex milestones can choose whether they are:
  - legacy-path maintenance,
  - or new-contract adoption.

**Acceptance Criteria**
- The current legacy Plex-path usage is documented clearly enough to distinguish maintenance work from modernization work.
- A provider-oriented Plex client contract is defined for new Plex-facing features.
- At least one future Plex milestone can adopt the newer PMS model without forcing an all-at-once rewrite of import behavior.
- The roadmap has a clean versionless backlog task available when the team decides to begin the migration.

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

**Goal:** Build on the `3.4.46` schedule catalog foundation with import, discovery, and quick planning flows for sessions happening during a con.

**Why this work exists**
- Sched-style full event calendars are useful, but mobile discovery is often weak when a user needs to decide what to do right now.
- collectZ can make event calendars more actionable by combining session discovery with planned attendance, friends, groups, meetups, and collection/event context.
- The `3.4.46` foundation added canonical catalog storage that is distinct from a user's personal plan; this follow-up turns that data into a useful discovery surface.

**Scope**
- Support importing or manually entering an event's full schedule catalog.
- Add a mobile-friendly "Now / Next" view for sessions happening now, starting soon, and optionally later today.
- Add filters for time window, track/category, location/room, planned status, friend/group attendance, and conflicts.
- Add session states such as planned, maybe, skipped, backup, and unavailable where useful.
- Keep Sched ingestion conservative: prefer supported export/import paths over brittle scraping.

**Acceptance Criteria**
- Catalog import or entry flows build on `event_schedule_sessions` instead of personal selected schedule plans.
- The web app can show sessions happening now and starting soon.
- A user can quickly mark a session as planned, maybe, skipped, or backup.
- Overlapping sessions are detectable as conflicts.
- The schedule catalog can later be cached by a platform companion app.

### Backlog Item: Friend-Aware Session Changes and Notifications
**Type:** Deferred milestone
**Tags:** `events`, `social`, `schedule`, `notifications`, `friends`, `groups`

**Goal:** Let users quickly change session choices and notify selected friends or groups about the plan change.

**Scope**
- Add explicit actions for joining, leaving, replacing, or marking backup sessions.
- When a change affects shared plans, offer selected-recipient notifications instead of broadcasting by default.
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
