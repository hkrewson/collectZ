# Public Repository Readiness

This document defines the current collectZ public repository strategy.

The previous private-source/public-mirror export model is retired. collectZ is moving back to a canonical public-source model, with SaaS/platform behavior split into a separate service named `cairn`.

## Goal

collectZ should be publicly inspectable, buildable, and deployable as the open-source Core app for self-hosted collection management.

The public source repository should include the code needed to understand, test, and operate Core. It should not include secrets, private maintainer evidence, local runtime artifacts, or platform service implementation that belongs in `cairn`.

## Operating model

- `collectZ-main` becomes the canonical public collectZ source repository.
- The old public `collectz` mirror should be archived or renamed before the canonical repo takes over the public path.
- collectZ Core remains runnable without `cairn`.
- `cairn` starts as a private repo while extraction is in progress, then can be made public after review.
- GitHub Actions, CodeQL, dependency checks, OpenAPI validation, backend tests, frontend builds, and Docker builds should run on the canonical public source.
- Historical release notes may mention the retired mirror workflow, but current maintainer docs and commands should not require it.

## Public source contents

The canonical public collectZ repo should include:

- backend and frontend Core source,
- Core migrations and OpenAPI contract,
- self-hosted Docker compose and setup docs,
- release notes and public help/release feed data,
- CI workflows that can run safely in public,
- security policy and issue/support entry points,
- tests for Core behavior and public contracts.

The public collectZ repo should not include:

- `.env` files or secret-bearing config,
- private maintainer notes that are not written for public readers,
- release evidence artifacts, traces, screenshots, logs, local audit bundles, or generated reports,
- local-only runtime overrides that expose workstation or private deployment details,
- platform service implementation once that code is extracted to `cairn`,
- credentials, customer data, uploaded media, or database dumps.

## Current cleanup state

The old mirror export machinery has been removed from active source:

- `scripts/build-public-export.js`
- `scripts/generate-public-compose.js`
- `scripts/validate-public-export-surface.js`
- `public-export.manifest.json`
- `public-mirror/`
- `docs/public/03-public-mirror.md`
- root package scripts for `compose:generate`, `validate:public-export`, and `public:export`

Keep future cleanup focused on active docs and commands. Avoid rewriting historical release notes unless they are reused as current instructions.

## Publication readiness checklist

Before making the canonical source repo public:

1. Confirm the old public mirror repository has been archived or renamed.
2. Confirm `README.md`, `docs/public/`, maintainer docs, package scripts, and workflows no longer instruct maintainers to generate or push a public mirror.
3. Run a secret and private-artifact sweep over tracked files.
4. Confirm `.gitignore` excludes local env files, generated artifacts, traces, logs, screenshots, and database dumps.
5. Confirm public workflows do not require private-only credentials except for explicitly configured package/image publishing secrets.
6. Run backend tests, OpenAPI validation, frontend build, Docker build, CodeQL/dependency checks, and `git diff --check`.
7. Decide whether issues/discussions are enabled on the canonical public repo.
8. Change repo visibility only after the above checks pass.

## `cairn` boundary checklist

Before moving a platform surface out of collectZ:

1. Classify it as Core, platform, temporary compatibility, or historical documentation.
2. Preserve Core user authentication and self-hosted runtime behavior.
3. Expose only documented Core APIs for `cairn`; do not share collectZ internals or write directly to the Core database from `cairn`.
4. Move platform API docs to the `cairn` OpenAPI spec.
5. Keep homelab/Core smoke tests passing after each extraction slice.

## Leak response

If a secret, private artifact, customer data, or private-only operational detail is accidentally published:

1. Stop further publication work.
2. Rotate any exposed credential or token immediately.
3. Remove or replace the exposed public content as appropriate for the severity.
4. Add a test, scan rule, or checklist item that would have caught the issue.
5. Document the cause and remediation in maintainer-facing notes.
