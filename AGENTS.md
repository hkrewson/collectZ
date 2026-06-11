## Project Execution Policy


### Read First

The assistant must re-read this file before starting or closing any milestone, release, runtime, monitoring, auth, migration, deployment, or other non-trivial engineering task in this repo.

Do not rely on memory of these policies when the file can be consulted directly.

For milestone, release, runtime, monitoring, auth, migration, or deployment work, the assistant must:

1. Identify the exact roadmap milestone/slice before starting.
2. Use project documentation/checklists/policies from the repo as the source of truth instead of memory.
3. Use Docker-first runtime verification whenever containers are available.
   - HINT: In our local development environment, docker containers are always available.
4. Prefer evidence from running containers, in-stack HTTP checks, logs, and live DB/container state over local inference.
5. Distinguish explicitly between:
   - verified facts
   - inference
   - blocked/unverified items
6. Run the full relevant CI/release checklist before calling work complete.
   - If a CI/release checklist item fails, do the work needed to resolve the failure.
7. If a gate cannot be run locally, state:
   - the exact blocked gate
   - why it is blocked
   - what local evidence was gathered
   - what must still be rerun in CI
8. Close each meaningful slice with:
   - Roadmap slice
   - Project docs/checklists used
   - Runtime verification used
   - CI/checks run
   - Files changed
   - Risks or follow-ups
   - What remains in the milestone
9. For each slice, name the exact repo docs/checklists used by file path in the closeout.
10. For any meaningful code, docs, milestone, or release closeout, always provide exactly one recommended commit message, and make it the fuller descriptive form rather than a short generic variant.
11. For release-shaped closeout, the commit message must explicitly name the version and the primary shipped scope.
12. After completing and verifying a meaningful code, docs, milestone, or release-shaped slice, the assistant should stage and create the git commit automatically using the recommended commit message, unless the user explicitly says not to commit.
    - The assistant must not push to GitHub unless the user explicitly asks for a push.
    - The user owns the decision of what code is pushed and when.
    - If the worktree includes unrelated user changes, commit only the files belonging to the completed slice and leave unrelated changes unstaged.
13. When Docker containers are available, do not rely on local inference for runtime behavior if the running stack can answer directly.
14. For env/config/auth/runtime issues, verify values inside the running container, not only in `.env` or compose files.
15. For release-shaped work, explicitly work through the gates defined in:
    - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
    - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
    - At minimum, release readiness must explicitly account for these named gates from CI:
      - `compose-smoke`
      - `rbac-regression`
      - `browser-regression`
      - `runtime-smoke`
        - Core runtime
        - Control-plane runtime
      - `dependency-scan`
      - `secret-scan`
      - `image-security-and-sbom`
16. For release/version/docs/auth/infra changes, do not call work complete until version sync, release-note requirements, init parity, and relevant regression gates have been checked or explicitly marked blocked.
    - “Relevant regression gates” is not generic shorthand here; for semver or release-shaped closeout it includes `rbac-regression`, `browser-regression`, and `runtime-smoke` unless the roadmap slice clearly proves one is out of scope.
    - The assistant must verify that repo docs still explain what each gate is proving, what runtime/env assumptions it depends on, and what evidence/artifacts are expected when it fails.
17. Every completed numbered roadmap milestone must end with a version closeout, even when the slice does not require a full release-shaped gate run.
   - A version closeout always includes semver/app-version sync, the matching `docs/releases/vX.Y.Z.md`, regenerated in-app release-feed data, and running-stack verification of recent Help > Releases entries.
   - A numbered milestone may defer some release gates only when those gates are explicitly marked blocked or clearly out of scope, but it may not be closed without version/release artifact alignment.
18. For every backlog task closeout, update the in-app Help > Releases source as part of the release note workflow:
   - ensure the matching `docs/releases/vX.Y.Z.md` exists,
   - regenerate any release-feed snapshot used by the app,
   - verify the running stack can still serve recent Help > Releases entries.
18a. Before any push-ready or release-shaped handoff, run `npm run release:local-gate` unless explicitly blocked or the user has explicitly scoped the work away from push/release readiness.
   - For release handoff, prefer `npm run release:local-gate:full -- --fail-on-blocked` when local CodeQL, secret scan, runtime smoke, browser regression, and image/SBOM readiness should stop on blocked heavy gates.
   - If the local gate cannot run, state the blocked gate, why it is blocked, and which hosted CI gate must confirm it after push.
19. If a change introduces work from a later roadmap milestone, pause and call out the milestone boundary before continuing.
20. For OpenAPI, metrics, dashboard, alerting, or monitoring changes, keep implementation, docs/specs, and validation artifacts in sync before calling the slice complete.
21. Never treat localhost, transient, fixture, smoke-test, or release-evidence credentials as safe to expose in plaintext.
    - Do not commit plaintext passwords, tokens, API keys, or basic-auth strings into docs, generated artifacts, logs, screenshots, traces, or recorded command strings.
    - If a workflow or evidence artifact needs to show that a secret-bearing step ran, redact the secret value before writing the artifact.
    - Prefer runtime-generated ephemeral credentials over hardcoded fallback secrets in release evidence, smoke scripts, and test harnesses whenever practical.
    - If a scanner flags a transient/local credential, treat it as a real hygiene issue to resolve rather than dismissing it as “only local” or “only test”.
22. During release, CI, smoke, or artifact work, proactively inspect generated artifacts/logs for secret leakage before calling the slice ready.
    - This includes release evidence JSON, Playwright artifacts, captured command strings, curl/basic-auth commands, and any uploaded troubleshooting bundles.
23. Keep the roadmap and backlog separated by intent:
   - `docs/wiki/07-Release-Roadmap.md` stays focused on numbered milestones and active milestone slices.
   - `docs/wiki/08-Backlog.md` is the source of truth for unscheduled work.
   - When a backlog item is selected for work, move it into the roadmap as a numbered milestone; do not copy it.
