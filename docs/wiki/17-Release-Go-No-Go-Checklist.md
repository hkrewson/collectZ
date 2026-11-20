# Release Go/No-Go Checklist

This checklist is enforced for tagged release runs (`v*`) via CI preflight.

## Required Gates

All blocking gates must pass. Advisory gates must be reviewed and explicitly accounted for in release closeout.

1. CodeQL code scanning should be reviewed when present. It is advisory at introduction and may become blocking after the baseline is understood.
2. Secret scan.
3. Dependency vulnerability scan.
4. Frontend unit and changed-file quality check.
5. Migration check (including init parity, generic rehearsal evidence, identity-upgrade certification evidence, and runtime-role certification evidence).
6. Compose smoke check.
7. RBAC regression check.
   - Includes workspace ownership snapshot drift, stable permission-key policy, maintained execution-path certification, and live sibling-workspace/job isolation evidence.
8. Browser regression check using the maintained Core regression set.
9. Runtime contract certification.
   - Hosted Core runtime smoke in `.github/workflows/docker-publish.yml`.
   - Control-plane runtime smoke against the canonical `collectz-private` platform stack and Cairn companion.
10. Image security scan + SBOM generation.

## Release Closeout Must-Do

Before we call a release ready, run a CI-shaped release check against the same gates enforced by `.github/workflows/docker-publish.yml`.

Minimum closeout expectation:

1. Confirm version metadata is synchronized across root, backend, and frontend manifests.
2. Confirm the matching release note exists and includes the required security triage markers.
3. Regenerate the in-app release snapshot consumed by `Help > Releases` and confirm the latest semver appears in that feed.
4. Run backend unit tests.
5. Run `npm run release:local-gate` so the standard local gate checks version/release metadata, backend and frontend unit tests, OpenAPI, changed-file frontend quality, frontend build, dependency audits, local preflight, and diff hygiene.
6. For release handoff, run `npm run release:local-gate:full -- --fail-on-blocked` when local CodeQL, secret scan, runtime smoke, browser regression, and image/SBOM readiness should stop on blocked heavy gates.
7. Generate or refresh a local preflight report with `npm --prefix backend run test:release-preflight-local` when you need the standalone `preflight-go-no-go.md` evidence outside the local gate.
8. Run init parity and generic migration rehearsal checks in an environment with database access when not already covered by local preflight evidence; for an identity-sensitive migration, require a `passed` identity-upgrade certification rather than `not_required`.
9. Run production dependency audit checks for backend and frontend when not already covered by the local gate.
10. Generate observability release evidence with `npm --prefix backend run test:observability-evidence` and review the resulting artifact for passed persistence, collector-path, non-blocking failure, backend-restore, and final-health checks.
11. Review CodeQL alerts if the workflow has run for the branch or release commit.
12. Confirm the remaining CI-only gates are green, especially gitleaks, compose smoke, RBAC, Trivy, and SBOM generation.
13. Confirm the Playwright browser-regression gate is green and its artifacts are available when failures occur. If the browser install fails before tests start, verify that the job still uses the documented `ubuntu-24.04` runner supported by the lockfile-pinned Playwright toolchain; preserve the install log because no test artifact bundle may exist yet.
14. Confirm the hosted `runtime-smoke` job (`core-runtime-smoke`) is green and its `Core runtime` step keeps the shared runtime surface mounted while control-plane-only APIs remain unavailable.
15. Run `docker compose -p collectz-private --env-file .env -f docker-compose.yml -f docker-compose.localhost.yml exec -T -e BASE_URL=http://frontend:3000 backend node scripts/platform-edition-boundary-smoke.js` against the canonical platform stack and Cairn companion; confirm invite-based registration and the tenant/admin control-plane APIs remain mounted. This private-edition certification is required release-closeout evidence and is not currently a public-workflow job.
16. If either runtime contract fails, preserve the hosted Core job's Compose logs/step output or the local control-plane command output and relevant container logs. Repair the concrete runtime/configuration assumption and rerun the affected check; one edition's passing check does not waive the other.
17. Confirm `latest` and moving minor tags are release-publish outputs, while `stable` remains a separate manual promotion decision.
18. When any of `rbac-regression`, `browser-regression`, hosted `runtime-smoke`, or canonical-stack control-plane runtime certification fail, inspect the exact failing artifact or step log and repair the concrete runtime/spec assumption locally before calling the release push-ready.

Stable promotion expectation:

- Promote `stable` only from an already-published exact version.
- Require at least seven days of clean maintainer homelab use unless the promotion is an urgent security/runtime fix.
- Use `.github/workflows/promote-stable.yml` so the exact-version backend/frontend image digests are retagged without a rebuild.

If any of these are skipped locally because the shell environment is restricted, the release stays pending until CI or an unrestricted maintainer shell confirms them.

## Required Evidence Artifacts

Tagged runs must produce:

- `dependency-audit/backend-audit.json`
- `dependency-audit/frontend-audit.json`
- `init-parity-evidence/init-parity-evidence.json`
- `migration-rehearsal-evidence/migration-rehearsal-evidence.json`
- `identity-upgrade-certification-evidence/identity-upgrade-certification-evidence.json`
- `runtime-role-certification-evidence/runtime-role-certification-evidence.json`
- `saved-view-rls-evidence/saved-view-rls-evidence.json`
- `sbom-cyclonedx/backend-sbom.cdx.json`
- `sbom-cyclonedx/frontend-sbom.cdx.json`
- `preflight-go-no-go.md`

When the browser gate fails, the release investigation should also preserve the uploaded Playwright artifact bundle (`artifacts/playwright/...`) long enough to inspect:

- failing `error-context.md`
- failing `trace.zip`
- screenshots/videos when present

Release-shaped closeout should also generate:

- `observability-evidence/observability-release-evidence.json`

This artifact is release-facing evidence first. It is not yet a tagged-CI-required artifact until the observability rehearsals are promoted into workflow automation.

If any required artifact is missing, release is **NO-GO**.

## Blocking Rule

Release publication is blocked when:

- any mandatory gate fails, or
- any mandatory evidence artifact is missing.

## Exception Process

Exceptions are not implicit. Follow:

- `docs/wiki/14-Engineering-Delivery-Policy.md` -> `Exception Process`

Any exception must include:

- documented risk,
- compensating controls,
- expiration/remediation target.

For migration 124 and later, saved-view RLS certification must pass its raw-SQL, cascade, scope-forgery, concurrency, migration, and restore checks, and the live saved-view HTTP smoke must pass in `rbac-regression`. Missing or failed `saved-view-rls-evidence` is a NO-GO; inspect its failing check label and the migration-check log. The canonical stack must still serve recent Help > Releases entries after the scoped CRUD change.

For migration 127 and later, `external-identity-certification-evidence` is also a NO-GO gate. Its migration version must match the latest migration reported by the same run's migration-rehearsal evidence, and it must contain at least 15 passed checks covering immutable canonical UUIDs, provider-instance uniqueness, workspace-consistent foreign keys, RLS denial, separate credential storage, concurrent active-identity conflict prevention, lifecycle retention/reactivation/reassignment, append-only audit events, and unscoped runtime denial. Investigate the named failed check without retaining fixture credentials.

For migration 137 and later, run `test:media-review-decision-rls-smoke` against the canonical non-owner backend after migration/init parity. It must create and remove two isolated workspace ownership trees, prove authorized decision creation and cleanup, unscoped runtime denial, sibling-workspace isolation, cross-workspace write denial, and immutable ownership. Incomplete fixture creation or cleanup and any unexpected database error are NO-GO; do not bypass the policy or retain fixture identifiers in release evidence.

For migration 138 and later, run `test:media-merge-feedback-rls-smoke` against the canonical non-owner backend after migration/init parity. It must create and remove two workspaces with sibling libraries, then prove authorized feedback creation, unscoped and workspace-only grant denial, sibling-library and sibling-workspace isolation, cross-library write denial, immutable ownership, and guarded parent cascade. Any missing label, unexpected database error, or incomplete cleanup is NO-GO. Release evidence must not retain fixture identifiers, database URLs, passwords, or transaction grants.

For migration 139 and later, run `test:event-exclusive-sources-rls-smoke` and `test:event-exclusive-sources-http-smoke` against the canonical non-owner backend after migration/init parity. The database smoke must prove all ten grant, parent, promoted-target, linked-target move, immutable-owner, and cascade boundaries; the HTTP smoke must prove list, update, atomic Wishlist promotion, and protected committed readback. Missing labels, unexpected errors, incomplete cleanup, or secret-bearing output are NO-GO.

For migration 140 and later, run `test:object-relationships-rls-smoke` and `test:object-relationships-http-smoke` against the canonical non-owner backend after migration/init parity. The database smoke must prove all twelve workspace grant, cross-library, sibling-workspace, cross-workspace write, immutable endpoint, owner move/delete, and unscoped archive boundaries; the HTTP smoke must prove authenticated cross-library create, list, archive, and protected committed readback. Missing labels, unexpected errors, incomplete cleanup, or secret-bearing output are NO-GO.

For migration 141 and later, run `test:worker-scope-broker-smoke` against the canonical non-owner backend and inspect `worker-scope-broker-evidence`. All twenty-one current broker, action-separation, actor-request, lifecycle, targeted valuation, targeted read-only preview, inline-import, exact webhook, legacy-service, denial, replay, and recovery labels must pass, and fixture jobs must be removed. The valuation and Plex preview labels must enqueue with the authenticated actor and exact workspace/library, claim only the specified job through their dedicated worker allowlists, report progress, and settle successfully. The inline-import label must enqueue, start, report, and settle only through its actor/exact-scope/provider/type-bound module and must remain explicitly non-durable. The full Plex preview smoke must also use only its ephemeral workspace integration, retain the same media count, prove no Plex writeback/import mutation, and remove its job, user, library, and configuration fixtures. Init parity, runtime-role provisioning, and workspace-ownership classification must include the worker grant control plane. Any failed label, broker table access, runtime grant-minting access, retained fixture, unexpected secret in evidence, or claim that `sync_jobs` RLS is active before authenticated legacy readback and final policy certification are migrated or separated is NO-GO.

For authenticated `sync_jobs` readback, run `test:tenancy-platform-boundary` against the canonical stack. Its ephemeral owner must select the fixture workspace, `/api/dashboard/summary` must report that exact workspace and an array of recent jobs, `/api/spaces/:id/activity` must remain available, and cleanup must remove the fixture scope. Dashboard/activity SQL must prefer relational ownership, retain only a compatibility fallback for legacy scope JSON, and run inside actor-authorized transactions. A mismatch, ungranted activity read, cleanup failure, or claim that this certifies global metrics or service access is NO-GO.

For migration `142` and later, the canonical broker smoke must pass all fourteen foundational service labels, including observation/maintenance action separation and a real allowlisted legacy observe/repair cycle. Metrics rendering must still emit `collectz_sync_jobs`; normal startup, init parity, migration rehearsal, and identity-upgrade certification must pass; the explicit historical identity-baseline boot must not invoke post-baseline broker-backed maintenance; and no fixture row or transient grant may remain. Cross-action authority, an unclassified production job type, missing metrics, cleanup failure, secret-bearing evidence, historical-baseline startup requiring migration `142`, or treating this foundation alone as inline-import or table-RLS certification is NO-GO.

For migration `143` and later, the canonical broker smoke must pass all twenty-one current labels, including exact workspace/library webhook-ingest isolation, relational enqueue/deduplication, exact-scope webhook claim/progress/settlement, actor/exact-scope inline-import lifecycle, and recovery exclusion of unscoped legacy rows. Startup maintenance must no longer mutate the adopted webhook types, and the media processor must contain no direct webhook claim or lifecycle SQL. Inline import routes must contain no direct `sync_jobs` insert or lifecycle update SQL; their module must repeat actor, owner, type, provider, state, and compatibility-scope predicates. The end-to-end Plex webhook smoke must use an isolated workspace integration, persist matching relational and compatibility ownership, process import/watch/rating hints, revoke its receiver, and remove every fixture without modifying retained installation settings. Fresh init, the `142 -> 143` migration rehearsal, runtime-role provisioning, identity-upgrade certification, RBAC, and live database cleanup readback must pass. Missing or inactive ownership, installation-scope fallback, cross-action authority, duplicate jobs, unscoped claim/recovery, direct webhook/import lifecycle SQL, retained grants/fixtures, secret-bearing evidence, or a claim that authenticated legacy readback or `sync_jobs` RLS is already certified is NO-GO.
