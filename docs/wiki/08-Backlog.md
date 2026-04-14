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

### Backlog Item: Post-Split UI Cleanup for Support, Help, and Auth Shell Surfaces
**Type:** Task
**Tags:** `ui`, `polish`, `support`, `help`, `auth`

**Goal:** Clean up support, help, and auth shell surfaces once the edition boundary stops moving.

**Scope**
- Remove browser-visible polish that no longer matches the shared-core extraction story.
- Focus on remaining shell surfaces that still read as overly heavy or AI-shaped.
- Keep the cleanup bounded so it does not change the shared-core architecture work.

**Acceptance Criteria**
- Support, help, and auth shell surfaces feel more consistent and restrained.
- Remaining browser-visible polish is cleaned up without altering the core shared-core story.
- The work stays separate from milestone-level architecture changes.

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
