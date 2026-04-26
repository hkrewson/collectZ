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

### Backlog Item: Art Signature Provenance
**Type:** Task
**Tags:** `art`, `signatures`, `provenance`, `attachments`

**Goal:** Expand Art's simple signed status into richer provenance when signer and proof details matter.

**Scope**
- Add optional signer/provenance fields for Art records.
- Decide whether proof images reuse existing image storage or need a distinct attachment type.
- Preserve the simple `signed` boolean as the fast visual marker.
- Keep provenance fields out of Collectibles unless a future object type proves it needs the same contract.

**Acceptance Criteria**
- Art can record who signed an item and any supporting proof metadata.
- The drawer/detail surface can show provenance without crowding ordinary unsigned items.
- Existing signed boolean data remains readable and migrates cleanly into the richer model.

### Backlog Item: Collectibles Naming Review
**Type:** Discussion
**Tags:** `collectibles`, `naming`, `taxonomy`, `fandom`

**Goal:** Revisit whether the Collectibles library name still communicates the right boundary after Art promotion and taxonomy cleanup.

**Scope**
- Compare `Collectibles` against alternatives such as `Fandom` without changing product copy in this task.
- Evaluate whether a future fandom/franchise metadata field solves the naming pressure better than a library rename.
- Identify downstream effects of any rename on navigation, API copy, docs, imports, and user expectations.

**Acceptance Criteria**
- The team has an explicit decision record for keeping or renaming Collectibles.
- Any future rename has a migration/product-copy checklist before implementation.
- The current Collectibles object-category boundary stays stable unless a later milestone intentionally changes it.

### Backlog Item: TMDB Rate-Limit Investigation and Search Optimization
**Type:** Discussion
**Tags:** `tmdb`, `rate-limit`, `search`, `imports`, `performance`

**Goal:** Determine whether movie-add resource-limit failures are coming from the app API or from TMDB, then identify any safe optimization that reduces TMDB pressure.

**Scope**
- Reproduce the failure path for movie adds and identify which layer returned the limit response.
- Distinguish between the app-side external-provider limiter and upstream TMDB rate limiting.
- Review the movie add flow for avoidable duplicate TMDB calls.
- Evaluate whether title search, identifier search, and follow-up details fetch can be consolidated or cached more effectively.

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
