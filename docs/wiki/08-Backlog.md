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

### Backlog Item: Library Detail Drawer Layout and Information Hierarchy Cleanup
**Type:** Deferred milestone
**Tags:** `ui`, `drawers`, `library`, `layout`, `detail-view`, `information-hierarchy`

**Goal:** Make library detail drawers feel more content-shaped and less template-driven by tightening sparse layouts, relaxing overused metadata grids, and reducing visual weight in drawer chrome.

**Scope**
- Reassess the current shared drawer pattern across library detail views, where one vertical rhythm and one metadata grammar are stretched across very different content types.
- Reduce excessive empty vertical space in sparse drawers so the body does not feel abandoned or bottom-light while the footer feels dominant.
- Allow selective width variants instead of assuming one universal drawer width:
  - media drawers may need a slightly wider detail variant,
  - collectibles and events likely need denser composition rather than more width.
- Reduce dependence on repeated two-column metadata grids when they flatten the content hierarchy.
- Let overview content remain block-oriented instead of forcing it into surrounding field-grid logic.
- Rework technical and provider-heavy metadata so long machine values do not strain narrow two-column layouts:
  - prefer stacked or list-style treatments where they read more naturally than field matrices.
- Keep valuation treatment compact and integrated:
  - `Low`, `Mid`, and `High` on one horizontal row,
  - supporting source and update metadata quieter than the values,
  - refresh control treated as a low-emphasis utility action.
- Replace long raw external URLs and oversized external-link buttons with quieter labeled links or link-style actions:
  - use destination/action labels such as `Read in Calibre`, `Open source`, `View on TMDB`, `Open event site`, or `Open image`,
  - avoid exposing infrastructure-heavy raw URLs in the drawer body when a descriptive link label will do.
- Move drawer titles away from all-caps so the hierarchy stays strong without shouting.
- Tone down the footer action bar so `Close`, `Edit`, and `Delete` no longer carry more visual weight than the drawer content above them.
- Let drawer layouts vary more intentionally by content density and content type instead of enforcing the same section rhythm everywhere.

**Assessment Notes**
- Overall drawer pattern is coherent and serviceable, but still feels too templated:
  - too much empty vertical space in sparse drawers,
  - same structure regardless of content density,
  - footer actions often feel heavier than the body.
- TV and comics are among the stronger fits because they have enough content to justify the current structure.
- Games are solid but still a little long and overly sectioned.
- Movies are competent but read like the default media drawer rather than a fully resolved layout.
- Audio drawers are clean but underfilled for the amount of space they use.
- Events are acceptable but often feel like drawers waiting for more content.
- Books are functionally useful but visually rough because long provider IDs and URLs strain the current grid.
- Collectibles are the weakest fit because the sparse body leaves too much dead space and makes the footer disproportionately important.

**Recommended First Focus**
- Start with the weakest structural fits:
  - collectibles,
  - books.
- Use those two surfaces to prove the broader direction before touching every drawer type.

**Acceptance Criteria**
- Sparse drawers no longer feel empty, abandoned, or bottom-heavy.
- Drawer composition varies intentionally by content density instead of relying on one overused two-column field grammar.
- Media drawers that need more width have it without forcing the same width on collectibles or events.
- Long technical/provider metadata no longer breaks the reading rhythm of the drawer.
- External sources are presented as labeled links or quieter actions instead of raw URLs and chunky buttons.
- Drawer titles no longer render in all-caps.
- Footer actions are toned down so they support the drawer instead of dominating it.
- The first-pass target drawers, especially books and collectibles, show clear layout improvement without regressing stronger drawers such as TV and comics.

### Backlog Item: Profile Surface and Account Navigation Cleanup
**Type:** Deferred milestone
**Tags:** `profile`, `navigation`, `account`, `ui`, `shell`, `uncodixfy`

**Goal:** Rework the profile surface and account navigation so they feel more intentional, less AI-heavy, and better integrated with the rest of the app shell.

**Scope**
- Take an [`$uncodixfy`](/Users/hamlin/.codex/skills/uncodixfy/SKILL.md) pass over the profile page so it reads like a normal product surface instead of an over-composed generic account screen.
- Reassess the overall profile information hierarchy, spacing, and section structure so the page feels calmer and more deliberate.
- Explore replacing the current direct profile/shell treatment with a clearer profile dropdown menu from the profile icon.
- Define the first menu contents for that account dropdown:
  - `My profile`
  - `Discord`
  - `GitHub`
  - `Sign Out`
- Decide whether Discord and GitHub should continue to live as standalone shell footer links once the profile dropdown exists, or whether those actions should consolidate into the account menu.
- Keep the work focused on profile/account-surface behavior and shell navigation cleanup rather than mixing it into library milestones.

**Recommended Update Path**
- Treat the profile page cleanup and the profile dropdown as one milestone so the page and its entry point evolve together.
- Start by tightening the profile page itself before finalizing the shell/menu placement, so the menu points to a surface that already feels intentional.
- Use the account menu to simplify shell chrome, not just add one more place for the same links.

**Acceptance Criteria**
- The profile page no longer feels AI-heavy or over-designed.
- The profile icon can open a clear account menu with `My profile`, `Discord`, `GitHub`, and `Sign Out`.
- Account navigation feels more integrated with the shell and does not duplicate itself awkwardly across footer links and profile controls.
- The resulting profile/account experience feels consistent with the rest of the app’s calmer post-`3.1.2` UI direction.

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
