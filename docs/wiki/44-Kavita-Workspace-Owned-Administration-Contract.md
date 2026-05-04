# Kavita Workspace-Owned Administration Contract

`3.4.94` defines the administration boundary for Kavita settings. Kavita should be owned by the active workspace, much like other user-facing integrations. This is a contract and smoke-plan slice, not the storage or UI implementation.

## Ownership Model

Kavita connection settings are workspace-owned:

- The active workspace owns its Kavita base URL, API key, timeout, import behavior, and clear/test actions.
- Workspace admins can save, test, import from, and clear only the Kavita connection for workspaces where they have admin rights.
- Platform admins can manage a workspace Kavita connection only while operating in that workspace context or through an explicit platform support/control-plane action.
- Homelab keeps the same effective single-workspace behavior, but the contract still treats the Kavita connection as workspace-owned rather than global platform infrastructure.

Kavita credentials are not platform-global defaults for all spaces. A later migration may preserve legacy platform Kavita settings as a bootstrap source for the default workspace, but new administration should be space scoped.

## Permission Boundary

The implementation milestone should apply these rules:

- `save`: workspace admin only for the target workspace.
- `test`: workspace admin only for the target workspace, using that workspace's stored or submitted Kavita settings.
- `import`: workspace admin only for the target workspace, writing rows only into that workspace/library scope.
- `clear`: workspace admin only for the target workspace.
- `read settings`: workspace admin only, with API keys redacted or represented only by set/masked flags.
- `cover proxy`: only serves covers for Kavita rows visible in the active workspace/library scope.

Standard workspace members may use imported rows and secret-free launch links when the rows are visible to them. They must not read, test, mutate, or clear Kavita credentials.

## Identity and Scope

Provider identifiers remain provider-local and row-local, but matching must be scoped:

- Series row: `provider_item_id = kavita:series:{seriesId}`
- Chapter row: `provider_item_id = kavita:chapter:{chapterId}`
- Matching, repeat sync, cover proxy lookup, metadata alias lookup, and high-confidence local issue reuse must include workspace/library scope.

Two workspaces may import from different Kavita servers that use the same Kavita series or chapter ids. Those rows must not update each other, proxy each other's covers, or leak each other's launch URLs.

## Migration Recommendation

The implementation should avoid surprising existing installs:

- If a legacy platform-level Kavita config exists, migrate or copy it only into the current/default workspace with explicit evidence.
- Do not fan out a platform-level Kavita credential to every workspace.
- Keep credential values encrypted at rest and redacted in settings responses, logs, release evidence, and smoke artifacts.
- Keep CWA/Calibre, Plex, and future digital-library provider settings separate unless a later shared-provider abstraction contract says otherwise.

## Smoke Plan

The implementation milestone should add a workspace-owned Kavita administration smoke that proves:

- Workspace A admin can save, test, import, fan out, and clear Workspace A's Kavita settings.
- Workspace B admin cannot read, test, import, or clear Workspace A's Kavita settings.
- Workspace B can independently save a Kavita connection with overlapping Kavita ids without updating Workspace A rows.
- Cover proxy readback stays scoped and cannot serve another workspace's Kavita cover.
- Settings readback never returns raw API keys.
- Homelab still exposes the expected single-workspace integration behavior.
- Platform and support/admin paths do not bypass workspace scope accidentally.

## Non-goals

This contract does not implement the workspace-owned storage migration or UI. It also does not add embedded reading, reader page proxying, progress sync, metadata writeback, global reading/social graphs, special-chapter fan-out, or shared Calibre/CWA/Kavita provider abstractions.

