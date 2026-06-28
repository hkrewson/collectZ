# cairn Platform Extraction Map

This map classifies current collectZ surfaces for the `cairn` extraction. It uses the existing homelab/platform edition boundary as the starting point, but preserves Core internals that are required for self-hosted behavior.

## Classification Rules

- **Move to cairn:** SaaS/platform control-plane behavior, platform-only admin/support UI, platform OpenAPI, and platform service docs.
- **Keep in Core:** self-hosted collection management, Core auth/session behavior, library/media/data workflows, and internal scope primitives required by Core.
- **Compatibility bridge:** current platform behavior that depends on Core internals and needs a documented Core API before it can move.
- **Historical only:** release notes and completed roadmap entries that describe the retired mirror/platform workflow at the time.

## Backend Routes

Move to `cairn`:

- `/api/docs` and `/api/docs/openapi.json`
- `/api/metrics`
- `/api/support/requests`
- `/api/support/requests/:id`
- `/api/support/requests/:id/messages`
- `/api/support/requests/:id/status`
- `/api/support/requests/:id/access`
- `/api/support/requests/:id/triage`
- `/api/support/staff/summary`
- `/api/admin/spaces`
- `/api/admin/spaces/create-with-onboarding`
- `/api/admin/spaces/:id`
- `/api/admin/spaces/:id/members`
- `/api/admin/spaces/:id/invites`
- `/api/admin/spaces/:id/invites/:inviteId/revoke`
- `/api/admin/spaces/:id/owner`
- `/api/admin/spaces/:id/archive`
- `/api/admin/users`
- `/api/admin/users/:id/summary`
- `/api/admin/users/:id/role`
- `/api/admin/users/:id/password-reset`
- `/api/admin/settings/email-delivery`
- `/api/admin/settings/email-delivery/test`
- platform-only integration diagnostics under `/api/admin/settings/integrations/test-pricecharting`, `/test-ebay`, and `/test-logs`; collectZ Core keeps explicit compatibility 404s and no longer carries the old unreachable executable handlers
- `/api/admin/activity`
- `/api/admin/loan-reminder-operations`

Keep in Core:

- `/api/health`
- core auth endpoints for registration, login, logout, password reset, email verification, CSRF, `/api/auth/me`, `/api/auth/config`, `/api/auth/scope`, and `/api/profile`
- dashboard, media, libraries, import, capture, wishlist, events, collectibles, art, loans, signatures, merge review, feature flags, Core settings, and Core integrations
- `/api/support/releases`, because Help/Releases is a Core public/self-host surface
- `/api/auth/support-session/start` and `/api/auth/support-session`, as the audited Core support-session bridge used when an external platform approves access

Compatibility bridge:

- `/api/spaces`, `/api/spaces/select`, and workspace/member/invite routes in `backend/routes/spaces.js`
- `/api/spaces/:id/settings/general`, `/feature-flags`, `/activity`, `/portability`, and `/integrations`
- `/api/spaces/:id/integrations/test-*`

These bridge routes expose currently visible platform/workspace management, but they also depend on Core scope, library, integration, and token models. They should stay in collectZ until `cairn` has documented Core APIs for instance/workspace routing, support access, and scoped admin operations.

## Frontend Surfaces

Moved out of collectZ Core:

- `SupportInboxView.jsx`
- `AdminSpacesView.jsx`
- `AdminUsersView.jsx`
- `AdminActivityView.jsx`
- platform mode switch affordances in `SidebarNav.jsx`
- navigation entries for `support-inbox`, `admin-spaces`, `admin-users`, and `admin-activity`
- platform bridge API routing and `VITE_PLATFORM_API_URL` runtime wiring
- platform support mode inside `HelpView.jsx`
- support-session banner and controls that are only for platform staff
- platform-specific support/settings copy such as Help Admin, support-session labels, platform SMTP controls, and platform analytics tracking controls

Keep in Core:

- `AuthPage.jsx` for Core login/registration
- dashboard, library, import, capture, wishlist, events, collectibles, art, loans, profile, admin merge review, admin settings, admin integrations, and help/releases surfaces that are useful to self-hosted Core
- local runtime tab gating in `productEdition.js` until platform extraction removes the need for edition-aware shell behavior

Compatibility bridge:

- `SpaceManagerView.jsx` and the `space-manage` tab
- active-space and active-library selection in `App.jsx`
- `DashboardShell.jsx`, `DashboardContent.jsx`, `SidebarNav.jsx`, and `dashboardRouting.js` Core tab definitions
- scoped support-session helpers, until `cairn` has a cleaner operation bridge

## OpenAPI Split

Move to `cairn` OpenAPI:

- support request/inbox APIs except Core release feed
- global workspace administration
- global member administration
- platform docs and metrics
- platform email delivery settings
- platform activity and platform operations readbacks
- platform admin-token management if `cairn` later needs its own control-plane machine credentials; collectZ Core API keys stay in Core

Keep in collectZ Core OpenAPI:

- Core auth/session/profile
- Core library/media/import/capture/wishlist/events/collectibles/art/loans/signatures/object relationships
- Core admin settings, merge review, portability, feature flags, and self-hosted integrations
- Help/Releases feed

Bridge until Core contracts exist:

- Core support-session start/end bridge
- workspace scope selection and scoped workspace settings
- scoped integrations diagnostics
- Core API key management at `/api/auth/service-account-keys`

## Database and Migrations

Keep in Core for v1:

- `spaces`
- `space_memberships`
- `users.active_space_id`
- `libraries.space_id`
- `media.space_id`
- `app_integrations.space_id`
- all existing `space_id` columns on Core domain tables

These are internal Core scope primitives now. Removing them would require a larger Core data model rewrite and is not part of the first extraction.

Move to `cairn` in future migrations:

- platform user/workspace directory tables
- Core instance registry
- platform admin account tables
- platform email-first routing metadata
- platform support request queue
- platform support access approval state
- platform activity log

Compatibility bridge:

- current `user_sessions.support_*` columns can stay in Core until support access is initiated by `cairn` through a documented Core support-session API.
- current `service_account_keys` stay in Core as Core API key / machine-token support.

## First Extraction Order

1. Create `cairn` privately with its own service, database, OpenAPI spec, CI, and health endpoint.
2. Add `cairn` platform directory tables: platform admins, Core instances, workspaces, and email routing.
3. Add the email-first login router in `cairn`.
4. Add a documented Core instance read/health contract that `cairn` can call without database access. Done: collectZ Core exposes `GET /api/core/instance`, and `cairn` exposes `GET /api/core-instances/{id}/readiness` for platform-side checks.
5. Move platform docs and metrics to `cairn`. Done: `cairn` serves `GET /api/docs`, `GET /api/docs/openapi.yaml`, and `GET /api/metrics`; collectZ Core no longer mounts, documents, or carries its previous platform docs/metrics route modules.
6. Move support request/inbox UI and APIs to `cairn`, leaving only the Core support-session bridge in collectZ. In progress: `cairn` owns the platform support queue data model and API contract; collectZ Core no longer mounts or documents the platform support request APIs, and Core no longer ships the support queue UI.
7. Move global workspace/member administration to `cairn`, backed by documented Core APIs where Core data changes are required. In progress: `cairn` now owns the workspace directory and user-route API contract; collectZ Core returns 404 for the global `/api/admin/spaces*` control-plane, no longer documents those paths, and no longer carries the old unreachable handlers or admin-space control smoke. Core still owns user/workspace-scoped `/api/spaces*` operations and workspace integrations.
8. Move platform user administration to `cairn`. In progress: `cairn` now owns the platform admin/routed-user directory contract; collectZ Core returns 404 for `/api/admin/users*` and no longer carries the old unreachable handlers. Workspace-scoped member management remains under Core `/api/spaces*` until cairn has a Core operation bridge for scoped data changes.
9. Move platform settings and diagnostics to `cairn`. In progress: `cairn` now owns platform email delivery settings plus PriceCharting, eBay, and structured-log platform diagnostics; collectZ Core returns 404 for those platform-only settings routes and no longer carries the old email-delivery or platform integration diagnostic handlers. Shared Core integration settings and Core provider diagnostics remain in collectZ.
10. Move platform activity and platform operations readbacks to `cairn`. In progress: `cairn` now owns `/api/admin/activity`, a platform activity table, and a compatibility `/api/admin/loan-reminder-operations` readback. collectZ Core keeps workspace-scoped activity under `/api/spaces/:id/activity` and no longer documents the moved platform activity paths.
11. Remove platform-only tabs and OpenAPI paths from collectZ after the matching `cairn` surface exists. In progress: Core no longer carries the standalone support inbox, global workspace, global user, platform activity, platform navigation, bridge API routing frontend modules, embedded support request UI, dormant platform email/analytics settings controls, or support-session banner.

## Verification Targets

- Core homelab runtime smoke still passes after each extraction slice.
- collectZ starts and operates without `cairn`.
- Any compose examples, private-network guidance, or runtime configuration that connects collectZ Core to `cairn` lives in the `cairn` repository only, not in public Core docs or compose files.
- `cairn` can route a known Core user email to the configured Core login URL.
- `cairn` can authenticate a platform admin without creating a Core session.
- Support access requires explicit approval, writes an audit trail, expires, and cannot be initiated by ordinary Core login.
- collectZ OpenAPI no longer documents moved platform APIs once they are served by `cairn`.
- `cairn` OpenAPI documents platform APIs before public visibility is enabled for the repo.
