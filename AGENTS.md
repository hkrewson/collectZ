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
10. When Docker containers are available, do not rely on local inference for runtime behavior if the running stack can answer directly.
11. For env/config/auth/runtime issues, verify values inside the running container, not only in `.env` or compose files.
12. For release-shaped work, explicitly work through the gates defined in:
    - `docs/wiki/17-Release-Go-No-Go-Checklist.md`
    - `docs/wiki/10-CI-CD-and-Registry-Deploy.md`
13. For release/version/docs/auth/infra changes, do not call work complete until version sync, release-note requirements, init parity, and relevant regression gates have been checked or explicitly marked blocked.
14. If a change introduces work from a later roadmap milestone, pause and call out the milestone boundary before continuing.
15. For OpenAPI, metrics, dashboard, alerting, or monitoring changes, keep implementation, docs/specs, and validation artifacts in sync before calling the slice complete.

