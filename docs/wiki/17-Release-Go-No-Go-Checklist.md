# Release Go/No-Go Checklist

This checklist is enforced for tagged release runs (`v*`) via CI preflight.

## Required Gates

All blocking gates must pass. Advisory gates must be reviewed and explicitly accounted for in release closeout.

1. CodeQL code scanning should be reviewed when present. It is advisory at introduction and may become blocking after the baseline is understood.
2. Secret scan.
3. Dependency vulnerability scan.
4. Migration check (including init parity, generic rehearsal evidence, identity-upgrade certification evidence, and runtime-role certification evidence).
5. Compose smoke check.
6. RBAC regression check.
   - Includes workspace ownership snapshot drift, stable permission-key policy, maintained execution-path certification, and live sibling-workspace/job isolation evidence.
7. Browser regression check.
8. Runtime contract certification.
   - Hosted Core runtime smoke in `.github/workflows/docker-publish.yml`.
   - Control-plane runtime smoke against the canonical `collectz-private` platform stack and Cairn companion.
9. Image security scan + SBOM generation.

## Release Closeout Must-Do

Before we call a release ready, run a CI-shaped release check against the same gates enforced by `.github/workflows/docker-publish.yml`.

Minimum closeout expectation:

1. Confirm version metadata is synchronized across root, backend, and frontend manifests.
2. Confirm the matching release note exists and includes the required security triage markers.
3. Regenerate the in-app release snapshot consumed by `Help > Releases` and confirm the latest semver appears in that feed.
4. Run backend unit tests.
5. Run `npm run release:local-gate` so the standard local gate checks version/release metadata, backend unit tests, OpenAPI, frontend build, dependency audits, local preflight, and diff hygiene.
6. For release handoff, run `npm run release:local-gate:full -- --fail-on-blocked` when local CodeQL, secret scan, runtime smoke, browser regression, and image/SBOM readiness should stop on blocked heavy gates.
7. Generate or refresh a local preflight report with `npm --prefix backend run test:release-preflight-local` when you need the standalone `preflight-go-no-go.md` evidence outside the local gate.
8. Run init parity and generic migration rehearsal checks in an environment with database access when not already covered by local preflight evidence; for an identity-sensitive migration, require a `passed` identity-upgrade certification rather than `not_required`.
9. Run production dependency audit checks for backend and frontend when not already covered by the local gate.
10. Generate observability release evidence with `npm --prefix backend run test:observability-evidence` and review the resulting artifact for passed persistence, collector-path, non-blocking failure, backend-restore, and final-health checks.
11. Review CodeQL alerts if the workflow has run for the branch or release commit.
12. Confirm the remaining CI-only gates are green, especially gitleaks, compose smoke, RBAC, Trivy, and SBOM generation.
13. Confirm the Playwright browser-regression gate is green and its artifacts are available when failures occur.
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
