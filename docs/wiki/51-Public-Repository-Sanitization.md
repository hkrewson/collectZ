# Public Repository Sanitization

This document defines the collectZ public repository strategy. It is maintainer documentation for the private source-of-truth repository, not content intended to be copied into the public mirror.

## Goal

collectZ should be publicly deployable without exposing private maintainer workflow, release evidence, roadmap/backlog planning, local runtime details, source-level runtime boundary terms, or historical troubleshooting artifacts. The public surface should be generated from a validated source tree, not maintained by hand and not created by mirroring private git history.

## Operating model

- The private source-of-truth repository remains the place where maintainers work, run local CI/CD, keep roadmap/backlog context, and collect release evidence.
- The public repository is a clean deployment mirror generated from an approved export manifest.
- The selected public mirror target is `https://github.com/hkrewson/collectz`.
- Public commits are clean export commits. They do not include private source-of-truth git history.
- GHCR images remain the primary runtime distribution path for deployed containers.
- Public release notes and public deployment files must line up with the container tags they describe.
- Hosted GitHub security features may still run on the public mirror, but they are not the only validation gate. The private/local release gate must pass before a public export is produced.
- Backend implementation source remains private. Audited frontend source and the OpenAPI contract can be exported once `npm run audit:public-source-boundary` reports zero findings.

## Export manifest

The checked-in export contract lives at `public-export.manifest.json`.

The manifest is intentionally conservative:

- `allowedPathPrefixes` names the first approved public source/docs surface.
- `deniedPathPrefixes` and `deniedExactPaths` name private or generated paths that must never appear in a public export.
- `deniedContentPatterns` lists private runtime/control labels and maintainer-only terms the export validator must keep out of public setup surfaces.
- The denylist wins over the allowlist.

The current validator is `npm run validate:public-export`. It checks both the existing public setup surface and the manifest contract. Public mirror automation must run this validator before writing any public tree.

## Public mirror contents

The public mirror should include:

- public deployment files such as `docker-compose.yml` and `env.example`,
- a public README, security policy, and setup/update guidance,
- version metadata needed to identify the published runtime,
- references to GHCR runtime images,
- audited frontend source and build metadata,
- the public OpenAPI contract.

The public mirror must not include:

- `.github/` workflow internals from the private source repository,
- `.ci/` private overrides,
- `docs/wiki/` maintainer roadmap, backlog, and release-planning documents,
- `artifacts/`, release evidence, browser traces, logs, screenshots, generated reports, or local audit bundles,
- local compose overrides such as `docker-compose.localhost.yml`,
- `.env` files or secret-bearing config,
- platform/control-plane runbooks and internal operational docs,
- private source-of-truth git history.
- backend implementation source until a source-publication boundary is separately designed.

## Source-publication boundary audit

Before adding or expanding frontend source, OpenAPI, or backend implementation paths in `public-export.manifest.json`, run:

```bash
npm run audit:public-source-boundary
```

The audit scans the candidate public source surfaces and writes a JSON report under `artifacts/public-export/`. It currently treats the following as source-publication blockers:

- private runtime selector names,
- private product/runtime contract field names,
- private deployment language,
- private operations labels,
- auth/test bypass labels,
- maintainer-only documentation paths.

A useful source mirror should not be produced by weakening the export allowlist. It should be produced by resolving or intentionally excluding the audit findings until the source surfaces are public-safe by design.

## Publication workflow

The first public mirror automation should follow this order:

1. Run the standard local release gate from the private source tree.
2. Build a temporary export tree from the manifest allowlist.
3. Reject the export if any denied path, denied content pattern, generated artifact, or secret-like value appears.
4. Create a clean public commit in a separate public repository or export branch.
5. Tag or annotate the public commit with the collectZ release version and container tag.
6. Push only after the maintainer explicitly chooses to publish.

The export builder is `npm run public:export`. By default, it creates or refreshes `public-export/` only after the standard local release gate report is current and passing. Use `npm run public:export -- --force` to replace an existing local export tree.

To create a local clean commit inside the generated tree, run `npm run public:export -- --force --commit`. This initializes a separate git repository inside `public-export/`, commits the generated files with clean history, and still does not push anywhere.

This workflow does not push a public mirror. Publishing remains an explicit maintainer action after reviewing the generated tree.

## Public issues and checks

Public issues and discussions can live in the public mirror if the mirror is the user-facing support entry point. Maintainer planning should stay in the private source-of-truth repository.

Public CodeQL, Dependabot, and lightweight build checks are useful on the mirror, but they should not replace private/local gates. Any public checks should avoid labels or workflow names that expose private architecture or operational boundaries.

Public mirror automation lives under `public-mirror/` in the private source tree and is mapped into the generated public repository root during export. Do not allow the private `.github/` directory directly; it contains source-of-truth release, image-publishing, and private validation workflows.

## Leak response

If a denied path, secret-like value, or private-only artifact is accidentally published:

1. Stop further public exports.
2. Rotate any exposed credential or token immediately, even if it looks local or transient.
3. Remove or replace the public mirror commit. Do not try to hide the issue only with a follow-up commit.
4. Run the export validator and secret scan again.
5. Document the cause and add a new validator rule before re-enabling publication.

## Follow-up automation

Future work should add a publish command or handoff checklist once the public mirror target exists. That command should stay separate from normal git push behavior and should require an explicit maintainer publish action.
