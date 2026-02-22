# Spaces and Libraries Model (Planning)

This page documents the planned separation between spaces and libraries so implementation stays consistent through 2.0.

## Intent

- A user can belong to one or more spaces.
- A space can contain multiple libraries.
- A library is a logical collection boundary (for example: Movies, Books, Music), without enforcing domain-specific field models yet.

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

### 1.9 Prep (non-breaking)

- Introduce `libraries` table with minimal metadata.
- Add nullable `media.library_id`.
- Extend internal `scopeContext` to carry optional `library_id`.
- Keep runtime behavior equivalent to a single-library experience.

### 2.0 Activation

- Make `space_id` and `library_id` required where appropriate.
- Create a default space and default library for migrated installs.
- Enforce space + library scoping across media queries and mutations.

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

## Migration Notes

- Existing single-library installs migrate to:
  - one default space
  - one default library
- Existing media is attached to the default library.
- Migration/rollback must be validated against snapshot rehearsal before 2.0 release.
