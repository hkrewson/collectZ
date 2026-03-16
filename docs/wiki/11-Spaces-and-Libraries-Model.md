# Spaces and Libraries Model (Planning)

This page documents the planned separation between spaces and libraries so implementation stays consistent through the scheduled `2.7.0` tenancy milestone.

## Intent

- A user can belong to one or more spaces.
- A space can contain multiple libraries.
- A library is a logical collection boundary (for example: Movies, Books, Music), without enforcing domain-specific field models yet.

## Current Starting Point

- The app already carries partial scope state:
  - `users.active_space_id`
  - `users.active_library_id`
  - `libraries.space_id`
  - `library_memberships`
- Scope-aware helpers and filters already exist in backend routes.
- What is still missing is the first-class tenancy contract:
  - a real `spaces` resource,
  - space memberships,
  - explicit active-space selection UX/API,
  - consistent space-governed library management.

## Scope Boundaries

What this plan includes:

- Library lifecycle: create, rename/update metadata, archive/delete.
- Library-aware navigation and filtering.
- Library-level media scoping.

What this plan intentionally does not include yet:

- Domain-specific schemas per library type (movies vs books vs games).
- Per-library custom fields.
- Advanced media-type plugins.

## TV Series Direction

- TV series should be tracked as series-first records in `media`.
- Season ownership should use a dedicated model (`media_seasons`) instead of overloading `media_variants`.
- `media_variants` remains focused on edition/file variants (for example: movie editions from Plex).
- Season completeness should be supported (`expected_episodes`, `available_episodes`, `is_complete`) so future watch-state features have a stable base.
- Watch-state and watchlist tracking should support both manual updates and provider sync (Plex first, additional providers later where licensing/API access permits).

## Data Model Direction

### Completed Foundation

- Introduced `libraries` table with minimal metadata.
- Added `media.library_id` and `space_id` fields where needed.
- Extended internal `scopeContext` to carry active scope.
- Added `active_space_id` / `active_library_id` to user state.
- Added `library_memberships` and basic library selection behavior.

### 2.7.0 Activation Plan

#### Phase 1: Real Space Records

- Add a first-class `spaces` table.
- Add `space_memberships`.
- Backfill existing installs into a personal/default space model.

#### Phase 2: Active Scope Contract

- Add explicit active-space selection in API/UI.
- Ensure session bootstrap and auth surfaces always expose valid active scope.
- Reduce ambiguous scope-hint behavior for ordinary users.

Phase 2 implementation notes:

- Add an auth-owned scope contract for bootstrap and selection before full spaces CRUD exists.
- Ordinary users should switch context through explicit selection flows, not arbitrary `space_id` / `library_id` request hints.
- Session, PAT, and service-account auth should all derive a valid active scope even when stored pointers are stale.

#### Phase 3: Space-Governed Libraries

- Treat libraries as resources owned by a space, not just loosely grouped by `space_id`.
- Make library lifecycle and membership rules subordinate to the selected space.
- Ensure background jobs/imports are pinned to originating space/library scope.
- Add scoped invites that carry the intended space role at claim time.
- Use transfer-into-new-space as the safest first flow for moving a user and their owned libraries.

#### Phase 4: UI and Migration Hardening

- Add space switching and membership management flows.
- Preserve a low-friction single-user path for homelab installs.
- Validate migration and rollback with rehearsal evidence before release.
- Fix the live-tested phase-4 boundary issues before phase completion:
  - `member` / `viewer` users must not see or use space-management mutations,
  - active-library selectors must only show actually accessible libraries,
  - members/invites/library context must refresh on space switch without full page reload,
  - scoped invite URLs must preserve host and port correctly,
  - edit/update flows must not create new spaces as a side effect.
- Complete browser-level tenancy UX verification for:
  - multi-space switching,
  - scoped invite create/claim/revoke,
  - membership role updates/removals,
  - transfer-to-new-space,
  - single-space usability smoke.

#### Phase 5: Server Admin Control Plane and Regression Closeout

- Separate global server-admin/platform actions from tenant space membership UI.
- Keep global server admins able to create spaces, assign/recover owners, archive/delete spaces, and run support/recovery flows without automatically joining every space.
- In the first server-admin control-plane slice, archive/delete may be limited to empty spaces so we do not silently invent content-archival behavior for library-bearing spaces.
- Keep platform member management separate from tenant invite history; `Admin > Members` should manage accounts and recovery actions, while scoped invites remain in tenant space controls.
- Keep routine space settings, memberships, invites, and content visibility tenant-scoped unless the global admin is explicitly added to that space.
- Add automated regression coverage that proves platform-global space actions do not imply tenant membership powers such as roster or invite access.
- Finish the broader automated tenancy regression coverage before the overall `2.7.0` milestone is considered complete.

## Navigation Direction

In 2.0:

- Sidebar `Library` becomes a parent section.
- Child items list libraries for the active space.
- Include role-gated actions:
  - `New Library`
  - `Manage Libraries`

## RBAC Direction

- App-level `admin` is the global server administrator (`super admin`) role.
- Space membership roles remain distinct from the global server admin role:
  - `owner`
  - `admin`
  - `member`
  - `viewer`
- Space owners can manage long-lived space governance for their own space.
- Space admins can manage library lifecycle in their space.
- Standard users can switch/use libraries they have access to.
- Delete/archive library actions must require explicit confirmation.
- Space membership changes must be auditable and isolated to the target space.
- Global server-admin authority should be modeled as platform authority, not implicit membership in every space.

### Tenancy Policy Notes

- Only the global server admin role can create new spaces.
- The first user assigned during new-space creation becomes that space's `owner`.
- Space owners/admins can invite and manage users only inside their own space.
- `member` and `viewer` access must remain limited to spaces they belong to.
- Global server admins may see high-level space metadata for platform operation, but should not automatically receive routine tenant visibility into:
  - library/content data,
  - space invite history,
  - space membership management,
  - ordinary space settings screens.
- If a global server admin needs to help inside a space, that should happen through:
  - explicit membership/invitation into that space, or
  - a separate explicit and fully audited server-admin support workflow.
- Cross-space user transfer should move only libraries the user owns, not every library they can access.
- Ownership-based library reassignment should happen only through an explicit cross-space transfer flow, not ordinary membership edits.
- The first transfer flow should create the destination space as part of the move, to avoid ambiguous reassignment into an existing shared space.
- The global/default install space should not double as the server-admin control plane.
- A global server admin does not need a dedicated admin-only library; platform authority should stay separate from library/content scope.

## API Direction

- Add dedicated space endpoints:
  - `GET /api/spaces`
  - `POST /api/spaces`
  - `PATCH /api/spaces/:id`
  - `POST /api/spaces/select`
- Add dedicated membership endpoints:
  - `GET /api/spaces/:id/members`
  - `POST /api/spaces/:id/members`
  - `PATCH /api/spaces/:id/members/:memberId`
  - `DELETE /api/spaces/:id/members/:memberId`
- Add dedicated scoped-invite endpoints:
  - `GET /api/spaces/:id/invites`
  - `POST /api/spaces/:id/invites`
  - `PATCH /api/spaces/:id/invites/:inviteId/revoke`
- Add an explicit transfer endpoint for moving a member and their owned libraries into a newly created space.
- Add separate admin/platform endpoints or surfaces for space creation, archival/deletion, owner recovery, and support flows.
- Keep library endpoints, but make their effective scope explicit and space-governed.
- Ensure media/import/events/collectibles/admin surfaces inherit the same active-space contract.

## Migration Notes

- Existing single-library installs migrate to:
  - one default space
  - one default library
- Existing media is attached to the default library.
- Migration/rollback must be validated against snapshot rehearsal before 2.0 release.

### Phase 1 Migration Decision

- `2.7.0-phase1` uses an install-wide `Default Space` backfill for existing installs.
- This preserves current single-space behavior while activating first-class `spaces` and `space_memberships`.
- Per-user personal spaces and richer shared-space UX remain deferred to later `2.7.0` phases.

## Open Decisions for 2.7.0 Planning

- Whether migrated installs get:
  - one install-wide default space,
  - or one personal space per user plus optional shared spaces.
- Whether library management endpoints should become nested under spaces or remain top-level with strict active-space validation.
- Whether break-glass support should exist at all, and if so:
  - which operations it permits,
  - how it is surfaced,
  - what extra audit evidence it must emit.
- Whether global admins keep cross-space override behavior on all routes or only on explicit admin surfaces.
