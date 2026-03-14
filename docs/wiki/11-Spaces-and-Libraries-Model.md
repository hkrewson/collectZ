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

#### Phase 3: Space-Governed Libraries

- Treat libraries as resources owned by a space, not just loosely grouped by `space_id`.
- Make library lifecycle and membership rules subordinate to the selected space.
- Ensure background jobs/imports are pinned to originating space/library scope.

#### Phase 4: UI and Migration Hardening

- Add space switching and membership management flows.
- Preserve a low-friction single-user path for homelab installs.
- Validate migration and rollback with rehearsal evidence before release.

## Navigation Direction

In 2.0:

- Sidebar `Library` becomes a parent section.
- Child items list libraries for the active space.
- Include role-gated actions:
  - `New Library`
  - `Manage Libraries`

## RBAC Direction

- Space admins can manage library lifecycle in their space.
- Standard users can switch/use libraries they have access to.
- Delete/archive library actions must require explicit confirmation.
- Space membership changes must be auditable and isolated to the target space.

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
- Whether admin users keep cross-space override behavior on all routes or only on explicit admin surfaces.
