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

### Backlog Item: Digital Library Sync Revisit
**Type:** Deferred milestone
**Tags:** `digital-library`, `cwa`, `opds`, `metadata`, `dedupe`

**Goal:** Reassess digital-owned book and comic sync after core roadmap stabilization.

**Scope**
- Compare CWA/OPDS against at least one alternative self-hosted solution.
- Evaluate metadata quality and consistency.
- Evaluate identifier richness for dedupe and enrichment.
- Evaluate operational complexity for homelab users.
- Define a stronger ingest contract for digital-owned items, especially comics.

**Acceptance Criteria**
- The chosen provider path has a documented rationale and tradeoff matrix.
- Repeat-import idempotency is demonstrated at scale before reintroduction.
- Dedupe quality meets target thresholds for comic-heavy datasets.
- The UI workflow is simple enough for non-technical admins.

### Backlog Item: OPDS Sync Contract and Reader-Link Separation
**Type:** Deferred milestone
**Tags:** `digital-library`, `opds`, `cwa`, `sync`, `metadata`, `links`

**Goal:** Tighten the OPDS/CWA sync contract so imported digital books and comics preserve meaningful browse/read/download links, expose clearer source labels in the UI, and stop collapsing different OPDS link types into one generic external URL.

**Scope**
- Reassess OPDS entry link handling in the CWA importer, where acquisition/download links are currently preferred over alternate or catalog/detail links.
- Separate OPDS link semantics into distinct stored fields where the feed supports them:
  - browse/source URL
  - read/detail URL
  - download/acquisition URL
- Stop treating one captured OPDS link as all of the following at once:
  - `tmdb_url`
  - `external_url`
  - `provider_external_url`
  - `calibre_external_url`
- Define how OPDS-imported items should be labeled in the UI based on actual provider context:
  - `Read in Calibre`
  - `Open source`
  - `View on Google Books`
  - `Download EPUB`
  - or similar truthful action labels
- Dedupe identical URLs before surfacing them so one destination does not appear as multiple different sources.
- Decide whether non-reader-facing provider plumbing such as raw OPDS identifiers should stay hidden from drawers by default unless explicitly useful.
- Preserve idempotent sync behavior while introducing the richer link contract for existing and newly imported OPDS rows.
- Keep the work explicitly separate from the broader provider-comparison item in `Digital Library Sync Revisit` and from the current `3.1.5` drawer-only milestone.

**Acceptance Criteria**
- OPDS-imported titles no longer surface the same URL as multiple different source actions.
- Browse/detail/read URLs and download/acquisition URLs are stored separately when the feed provides them.
- The drawer can render truthful, provider-aware labels instead of misleading generic labels like `View on TMDB` for books.
- OPDS-imported book and comic drawers do not expose non-useful plumbing metadata by default.
- Repeat syncs preserve the richer link contract without regressing dedupe or creating duplicate source entries.

### Backlog Item: Comic Sort and Server Pagination Normalization
**Type:** Deferred milestone
**Tags:** `comics`, `pagination`, `sorting`, `backend`, `data-model`

**Goal:** Remove the comic-book full-fetch exception by moving comic ordering and series browsing onto a server-backed pagination path.

**Scope**
- Reassess the current comic-book list path, where the frontend requests a single large page and sorts issues client-side for accurate issue ordering.
- Determine whether comic ordering can be handled directly from existing `type_details` values first:
  - `series`
  - `issue_number`
  - `volume`
- If the SQL path from JSONB fields becomes too fragile or unreadable, introduce dedicated normalized comic sort fields with a backfill/repair pass for older rows.
- Define how the `Series` and `Series Issues` views should work without requiring the full comic issue set to be loaded into memory.
- Keep the work explicitly separate from UI-only library cleanup milestones.

**Recommended Update Path**
- Start with a proof-of-concept using the existing `type_details` structure rather than assuming new columns are required.
- If that query path is too brittle, add dedicated normalized fields such as:
  - a series sort field
  - raw issue number
  - parsed issue numeric/suffix fields for stable ordering
- Use title parsing only as a repair/backfill fallback for legacy rows with incomplete comic metadata.
- Treat server-backed series aggregation as part of the same milestone, not as an afterthought once issue pagination works.

**Acceptance Criteria**
- Comic books no longer require a special full-fetch client path for ordinary issue browsing.
- Server-side pagination preserves the same practical issue ordering users expect today.
- The `Series` and `Series Issues` views work without relying on the full comic issue set being present in browser memory.
- The chosen approach is documented clearly enough to explain whether it relies on existing JSONB fields, new normalized columns, or both.

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

### Backlog Item: Library Loans Tracking
**Type:** Task
**Tags:** `library`, `loans`, `tracking`, `reminders`, `email`

**Goal:** Add a loans section to the library for tracking borrowed items and reminders.

**Scope**
- Track what item is loaned.
- Track who it is loaned to.
- Track when it was loaned.
- Track the format of the item.
- Track the expected return date.
- Track the borrower email address.
- Support emailed reminders for upcoming or overdue returns.

**Acceptance Criteria**
- Library loans can be recorded with item, borrower, loan date, format, and return date.
- Borrower email can be stored for reminder delivery.
- Reminder behavior can be triggered from the stored loan record.
- The loans section fits the library workflow without disrupting existing catalog behavior.

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

### Backlog Item: TMDB Rate-Limit Investigation and Search Optimization
**Type:** Discussion
**Tags:** `tmdb`, `rate-limit`, `search`, `imports`, `performance`

**Goal:** Determine whether movie-add resource-limit failures are coming from the app API or from TMDB, then identify any safe optimization that reduces TMDB pressure.

**Scope**
- Reproduce the failure path for movie adds and identify which layer returned the limit response.
- Distinguish between the app-side external-provider limiter and upstream TMDB rate limiting.
- Review the movie add flow for avoidable duplicate TMDB calls.
- Evaluate whether title search, identifier search, and follow-up details fetch can be consolidated or cached more effectively.

### Backlog Item: Collection Re-Sync Boundary Proof
**Type:** Deferred milestone
**Tags:** `merge`, `collections`, `sync`, `dedupe`, `proofs`

**Goal:** Prove that collection-level merge decisions remain durable when collection-shaped imports or sync updates run again later.

**Scope**
- Revisit collection merge behavior after the current collection merge review/apply/revert work.
- Prove that a merged collection does not silently reappear as a duplicate container on later sync/import activity.
- Verify that collection-linked items still resolve against the intended merged collection state.
- Keep the work limited to boundary and durability proof rather than expanding collection UI.

**Acceptance Criteria**
- A runtime smoke proves a merged collection state survives later sync/import activity without recreating a duplicate collection row.
- Collection-linked item relationships remain consistent after the re-sync.
- The proof identifies what collection boundary behavior is now guaranteed and what still remains future work.

### Backlog Item: Sparse-Metadata Alias Reuse Proof
**Type:** Deferred milestone
**Tags:** `merge`, `sync`, `aliases`, `dedupe`, `proofs`

**Goal:** Prove that preserved merge aliases still avoid duplicate recreation when later sync payloads are weak or incomplete.

**Scope**
- Choose one or more re-sync paths where the follow-up payload carries only sparse metadata.
- Prove that preserved alias keys still land the update on the existing canonical row instead of creating a new duplicate.
- Verify that missing strong metadata is treated as incomplete input, not as evidence to fork a second record.
- Keep the work narrowly focused on post-merge durability under degraded payload quality.

**Acceptance Criteria**
- A runtime smoke proves sparse follow-up payloads still resolve to the canonical row through preserved aliases.
- The same content does not recreate a duplicate row solely because the later payload is metadata-poor.
- The proof documents which alias fields remain sufficient for safe reuse in the sparse case.
- Consider whether the current app-level external provider limit should be tuned if the limiter is the real source of the problem.

**Acceptance Criteria**
- The likely source of the limit response is documented as app-side, TMDB-side, or still unverified.
- Any safe optimization opportunities are identified with their tradeoffs.
- If the app-side limiter is the issue, the relevant route and setting are called out clearly for follow-up work.
- If TMDB pressure is the issue, the likely request-reduction path is documented for a future milestone or task.

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
