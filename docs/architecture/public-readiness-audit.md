# Public Readiness Audit

This audit records the collectZ public-source readiness state after the canonical repository visibility transition.

## Scope

- Tracked collectZ source, docs, package scripts, active GitHub workflows, `env.example`, and Core OpenAPI.
- Local generated folders, runtime artifacts, backups, and old export outputs are out of publication scope when ignored by Git.
- Historical release notes may continue to mention the retired mirror model when they describe older releases accurately.

## Checks Completed

- The old public mirror repository has been archived or renamed, and the canonical collectZ source repository is public.
- `scripts/audit-public-source-boundary.js` reports `0` findings.
- `backend/scripts/validate-openapi.js` passes after the Core OpenAPI wording cleanup.
- `npm run release:local-gate:full` reports `13` passed, `0` failed, and `3` locally blocked gates.
- Maintained-source CodeQL reports `3` total findings and `0` active findings after in-source suppressions and scanner-visible guardrails.
- Dockerized gitleaks history scan reports `0` leaks across `967` commits.
- Dockerized Trivy scans report `0` HIGH/CRITICAL vulnerabilities, secrets, or misconfigurations for the backend image, frontend image, and publishable filesystem scan.
- Active GitHub workflows do not generate or push a public mirror.
- Active GitHub workflows provide the public-source CI posture for backend tests, frontend build, OpenAPI validation, Docker build/publish, CodeQL, dependency audit/watch, secret scan, runtime smoke, browser regression, and image security/SBOM gates.
- Root package scripts no longer include public export or public mirror generation commands.
- `.gitignore` excludes local public-export artifacts, backups, logs, traces, screenshots, media, and runtime output.
- `env.example` contains only collectZ Core runtime settings; platform composition is documented outside collectZ.
- collectZ OpenAPI no longer documents the platform docs, metrics, workspace-admin, user-admin, platform activity, or platform operations surfaces moved to `cairn`.

## Non-Blocking Findings

- `package.json` still uses `"private": true`. That blocks accidental npm publication; it does not block making the GitHub repository public.
- Test fixtures contain deterministic sample passwords and tokens for auth and regression checks. They are not production credentials.
- Ignored local folders such as `public-export/`, `artifacts/public-export/`, `public-mirror/`, and `backups/` may still exist in a working tree. They are not tracked and should not be published from Git.
- Some release notes and roadmap history mention the retired private-source/public-mirror model. Keep those as historical records unless they are reused as current instructions.
- Local gitleaks and Trivy binaries are not installed, so those scans were run through Docker rather than the local full-gate wrapper.
- Full mixed Playwright browser regression is split at the Core/platform boundary. Core CI now runs the required `test:browser:core` smoke subset; broader Core regression coverage is preserved behind `test:browser:core-regression`, event planner coverage behind `test:browser:event-planner`, and full-product platform/support/workspace coverage behind `test:browser:platform`.

## Remaining Public/Core Follow-Up

1. Keep historical release notes intact unless they are reused as current maintainer instructions.
2. Keep active docs, scripts, package commands, and workflows free of mirror-generation instructions.
3. Continue the Core/`cairn` split as concrete extraction slices instead of treating public visibility as an open blocker.
4. Rerun the selected release/test gate before each push-ready or release-shaped handoff.
5. Keep CI evidence current when workflows, runtime gates, dependency scanning, secret scanning, or image/SBOM behavior changes.
