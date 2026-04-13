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

### Backlog Item: Browser-Visible Regression Expansion for Shared-Core Lifecycle Flows
**Type:** Task
**Tags:** `testing`, `browser-regression`, `shared-core`, `risk`

**Goal:** Expand browser-visible regression coverage for extracted shared-core lifecycle flows after `3.1.0` stabilizes.

**Scope**
- Add browser-visible coverage for support-session flows.
- Add browser-visible coverage for library lifecycle flows.
- Add browser-visible coverage for space lifecycle flows.
- Go beyond the minimum release gates where the shared-core split needs extra confidence.

**Acceptance Criteria**
- Shared-core lifecycle flows are covered by browser-visible regression checks.
- Support-session, library, and space lifecycle paths are exercised beyond the minimum gates.
- The added coverage reduces risk for the split between shared-core and milestone-specific work.

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
