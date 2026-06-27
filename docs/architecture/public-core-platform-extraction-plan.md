# Public Core and Platform Extraction Plan

## Decision

collectZ is the canonical public open-source Core repository again. The temporary public mirror model is retired. SaaS/platform behavior is moving into a separate service and repository named `cairn`.

The new boundary is:

- collectZ is the public Core app and can run as a self-hosted homelab runtime.
- `cairn` is the platform control plane required for the full SaaS/platform product: routing, platform administration, support workflows, platform docs, and platform API contracts.
- `cairn` starts private while extraction and review are in progress, then can be made public after the boundary is clean.

## Repository Transition Status

Completed transition work:

1. Archived or renamed the old public `hkrewson/collectz` mirror instead of deleting it.
2. Promoted the canonical collectZ source repository publicly.
3. Removed mirror-only machinery from collectZ:
   - public export/build scripts,
   - mirror hygiene scripts,
   - public mirror workflows,
   - docs that state backend source is private,
   - generated mirror-only compose comments or assumptions.
4. Kept private maintainer notes, release evidence, runtime artifacts, local credentials, private environment files, and operational-only automation out of the public repo.
5. Replaced mirror CI with normal public-source CI for backend, frontend, OpenAPI, Docker image builds, CodeQL, dependency review, secret scanning, runtime smoke, browser regression, and image security/SBOM gates.

## collectZ Core Boundary

collectZ remains runnable by itself without `cairn`.

Core keeps:

- frontend and backend for self-hosted collection management,
- normal user authentication for Core users,
- homelab/self-host Docker compose,
- Core database migrations,
- Core OpenAPI/docs,
- library, media, import, capture, wishlist, events, loans, integrations, and release/help surfaces appropriate for self-hosted use,
- internal scoping primitives where they are required to keep the app coherent.

Core does not own the SaaS control plane after extraction:

- platform login router,
- platform admin surface,
- platform user/workspace directory,
- platform support inbox,
- audited platform support-session orchestration,
- platform metrics/docs surface,
- platform OpenAPI/docs,
- global multi-Core-instance routing.

The current homelab/platform edition boundary is the seed for the extraction. Existing platform-only routes and UI are the first candidates to move, but each surface should still be checked before extraction so internal Core scope primitives are not removed accidentally.

## `cairn` Platform Boundary

`cairn` is a separate service, not an overlay build.

It must integrate with collectZ through documented APIs only. It must not patch collectZ source, import collectZ internals, or write directly to collectZ database tables in v1.

`cairn` owns its own database for:

- platform admins,
- email-first login routing,
- workspace directory records,
- Core instance records,
- user-to-workspace routing metadata,
- support access workflow state that belongs to the platform control plane.

The platform is designed for many Core app instances, but v1 can deploy one Core stack plus one `cairn` service in the same compose environment.

Any compose examples or runtime configuration that describe the connection between `cairn` and collectZ Core belong in `cairn` documentation only. The public Core repository must not carry paired-service compose examples, private network wiring instructions, or `cairn` deployment configuration.

The first extraction map lives in `docs/architecture/cairn-platform-extraction-map.md`.

## Auth and Access Model

The shared front door is an email-first router in `cairn`.

1. User enters email.
2. `cairn` determines whether the email belongs to a platform admin or a Core workspace user.
3. Platform admins authenticate into `cairn`.
4. Core workspace users are routed to the correct Core app login; Core owns their password and session.
5. If a platform admin also has a Core member account with the same email, `cairn` may offer a one-way handoff into Core after platform authentication.
6. Core authentication never grants platform authentication.

Support access must be explicit, audited, and time-bound. Platform admins accessing their own personal library must use their normal Core member account, not support access.

## API Documentation Split

collectZ publishes only Core/self-host API documentation.

`cairn` publishes platform API documentation, including platform admin, routing, support, metrics, and platform-specific OpenAPI contracts.

Platform-only paths should be removed from the collectZ OpenAPI spec during extraction. Examples include support staff inbox APIs, platform docs/metrics, workspace administration, global member administration, platform activity, and multi-instance platform routing. The audited Core support-session bridge remains a Core API because it changes Core session scope after an external platform approval.

## First Implementation Sequence

1. Inventory mirror-only files and workflows in `collectZ-main`.
2. Inventory platform-only backend routes, frontend views, services, migrations, and OpenAPI paths using the existing homelab/platform edition boundary.
3. Remove public mirror machinery from collectZ-main.
4. Update README and public docs so collectZ is described as the canonical open-source app, not a mirror.
5. Create the initial `cairn` repository privately.
6. Scaffold `cairn` as a service with its own API, database, OpenAPI spec, and CI.
7. Add the platform directory model in `cairn`: platform users, Core instances, workspaces, and email routing.
8. Add Core API contracts required by `cairn`, keeping them public and documented in collectZ if they belong to Core.
9. Move platform surfaces incrementally from collectZ to `cairn`, starting with docs/metrics and support/admin surfaces.
10. Keep homelab/core smoke tests passing after each extraction step.

## Progress

- The old public mirror has been archived or renamed, and the canonical collectZ source repository is public.
- Mirror export scripts, manifest, generated compose script, public mirror automation, and mirror-specific active docs have been removed from active source.
- Active maintainer docs now describe the canonical public-source model and `cairn` extraction.
- The first platform extraction map is documented in `docs/architecture/cairn-platform-extraction-map.md`.
- A private-first `cairn` scaffold exists at `/Users/hamlin/Development/GitHub/hkrewson/cairn`.
- The private GitHub repo exists at `https://github.com/hkrewson/cairn`.
- `cairn` has an initial commit on `main`, a modern npm lockfile, CI, OpenAPI stub, directory migration, and health/config API scaffold.
- `cairn` now has the first email-first login routing contract at `POST /api/login-routes/lookup`.
- collectZ Core now publishes non-secret instance metadata at `GET /api/core/instance`, and `cairn` can read it through `GET /api/core-instances/{id}/readiness`.
- Platform API docs and platform-service metrics now live in `cairn` at `GET /api/docs`, `GET /api/docs/openapi.yaml`, and `GET /api/metrics`; collectZ Core no longer mounts or documents the former platform docs/metrics endpoints.
- `cairn` now has the first platform support queue model and API contract for requests, messages, status updates, triage metadata, and support staff summary. collectZ still hosts a compatibility UI shell and the Core support-session bridge until cairn grows its own frontend.
- `cairn` now owns global workspace/member administration contracts. collectZ Core returns 404 for `/api/admin/spaces*` and `/api/admin/users*`, while Core workspace-scoped management remains under `/api/spaces*`.
- `cairn` now owns platform email delivery settings plus PriceCharting, eBay, and structured-log platform diagnostics. collectZ Core returns 404 for those platform-only settings routes.
- `cairn` now owns platform activity and platform operations readbacks at `/api/admin/activity` and `/api/admin/loan-reminder-operations`. collectZ Core keeps workspace-scoped activity at `/api/spaces/:id/activity`.
- collectZ frontend platform routing remains optional so Core-only deployments stay self-contained.

## Initial Inventory

Mirror-only candidates removed or rewritten in the first cleanup slice:

- `scripts/build-public-export.js`
- `scripts/generate-public-compose.js`
- `scripts/validate-public-export-surface.js`
- `public-export.manifest.json`
- `public-mirror/`
- `docs/public/03-public-mirror.md`
- README sections that describe a generated public mirror or private backend source
- package scripts for `compose:generate`, `validate:public-export`, and `public:export`
- Docker compose comments that mark the compose file as generated from public-mirror automation
- unit tests that assert public mirror/export behavior

Remaining Core/`cairn` cleanup should focus on concrete platform-surface extraction slices and stale active maintainer docs or roadmap references that still describe the retired mirror model as current work. Historical release notes may continue to describe older releases accurately.

The remaining split work is intentionally narrow:

- Remove or quarantine dead/unreachable backend platform route code from Core after each route is confirmed blocked or moved.
- Decide whether collectZ keeps a temporary platform frontend shell for `cairn`, or whether those views move fully to the `cairn` repository.
- Classify service-account keys as Core machine-token support or move them to `cairn` as platform admin tokens.
- Keep support-session and scoped workspace APIs in Core unless `cairn` needs a cleaner documented operation bridge.
- Keep paired-service compose examples and Core/`cairn` network configuration out of the public Core repository; document them in `cairn` only.

Platform extraction candidates already identified by the current edition boundary:

- platform routers mounted only when `APP_EDITION` is not homelab
- `/api/docs` and `/api/metrics`
- `/api/auth/support-session/start` and `/api/auth/support-session`
- `/api/auth/service-account-keys`
- support staff request/inbox APIs under `/api/support`
- global workspace/member administration under `/api/admin/spaces` and `/api/admin/users`
- platform-only integration test endpoints under `/api/admin/settings/integrations/test-*`
- frontend tabs and views for `support-inbox`, `space-manage`, `admin-spaces`, and `admin-users`
- platform OpenAPI paths for support inbox, spaces, docs, metrics, activity, and global workspace/member administration

Core primitives to preserve until replaced by a deliberate API contract:

- user authentication and Core sessions
- library and active-scope selection needed by self-hosted use
- database tables needed to preserve current Core access behavior
- homelab edition boundary smoke tests
- Core API docs for self-hosted functionality

## Acceptance Criteria

- collectZ is public without relying on a generated mirror.
- collectZ can run without `cairn`.
- `cairn` can route users to one configured Core instance.
- Normal Core users authenticate in Core.
- Platform admins authenticate in `cairn`.
- Support access is explicit, audited, and time-bound.
- Core OpenAPI contains only Core APIs.
- Platform OpenAPI lives in `cairn`.
- Public CI covers backend, frontend, OpenAPI, Docker builds, CodeQL, dependency review, secret scan, runtime smoke, browser regression, and image security/SBOM gates.

## Public Readiness Checklist

- No active workflow generates or pushes a public mirror.
- collectZ README and public docs describe Core as the public source of truth.
- `env.example` contains no private runtime values and stays scoped to collectZ Core configuration.
- collectZ OpenAPI omits cairn-owned platform paths.
- `cairn` OpenAPI documents every platform path that collectZ now blocks or bridges.
- The collectZ local stack can boot without the platform service.
- Paired collectZ + `cairn` development configuration, compose examples, and private-network guidance are documented in `cairn`, not in the public Core repository.
- Secret/history scans are rerun for release-shaped or push-ready handoffs.

The current audit record lives in `docs/architecture/public-readiness-audit.md`.
