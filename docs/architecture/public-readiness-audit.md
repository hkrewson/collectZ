# Public Readiness Audit

This audit records the current collectZ source state before changing the canonical repository visibility.

## Scope

- Tracked collectZ source, docs, package scripts, active GitHub workflows, `env.example`, and Core OpenAPI.
- Local generated folders, runtime artifacts, backups, and old export outputs are out of publication scope when ignored by Git.
- Historical release notes may continue to mention the retired mirror model when they describe older releases accurately.

## Checks Completed

- `scripts/audit-public-source-boundary.js` reports `0` findings.
- `backend/scripts/validate-openapi.js` passes after the Core OpenAPI wording cleanup.
- Active GitHub workflows do not generate or push a public mirror.
- Root package scripts no longer include public export or public mirror generation commands.
- `.gitignore` excludes local public-export artifacts, backups, logs, traces, screenshots, media, and runtime output.
- `env.example` documents `VITE_PLATFORM_API_URL` as an optional bridge to `cairn`; leaving it empty keeps collectZ in standalone Core mode.
- collectZ OpenAPI no longer documents the platform docs, metrics, workspace-admin, user-admin, platform activity, or platform operations surfaces moved to `cairn`.

## Non-Blocking Findings

- `package.json` still uses `"private": true`. That blocks accidental npm publication; it does not block making the GitHub repository public.
- Test fixtures contain deterministic sample passwords and tokens for auth and regression checks. They are not production credentials.
- Ignored local folders such as `public-export/`, `artifacts/public-export/`, `public-mirror/`, and `backups/` may still exist in a working tree. They are not tracked and should not be published from Git.
- Some release notes and roadmap history mention the retired private-source/public-mirror model. Keep those as historical records unless they are reused as current instructions.

## Remaining Before Visibility Change

1. Archive or rename the existing public `hkrewson/collectz` mirror.
2. Confirm the desired final repository path for canonical collectZ source.
3. Rebuild the original public CI pipeline on the canonical source repo.
4. Run the release/test gate selected for the visibility change, including backend tests, frontend build, OpenAPI validation, Docker build, CodeQL, dependency checks, and secret scan.
5. Change repository visibility only after the above checks pass.
