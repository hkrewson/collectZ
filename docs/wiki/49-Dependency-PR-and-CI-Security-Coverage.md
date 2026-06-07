# Dependency PR and CI Security Coverage

This document records the `3.10.28` dependency PR and CI security review. It is a maintainer-facing coverage map for dependency PR triage, vulnerability gates, and source/code scanning.

## Current PR Queue

Verified with `gh pr list` on 2026-06-03.

| PR | Source | Status | Disposition |
|---:|---|---|---|
| `#77` | Dependabot: `react-dom` `19.2.6` to `19.2.7` | Mergeable; GitGuardian and Snyk green | Covered by local `3.10.25` React runtime compatibility work. Close or let GitHub mark obsolete after local commits are pushed. |
| `#76` | Dependabot: `react` `19.2.6` to `19.2.7` | Mergeable; GitGuardian and Snyk green | Covered by local `3.10.25` React runtime compatibility work. Close or let GitHub mark obsolete after local commits are pushed. |
| `#71` | Dependabot: `@zxing/library` `0.22.0` to `0.23.0` | Mergeable; GitGuardian and Snyk green | Keep open/deferred. `@zxing/browser@0.2.0` currently peers with `@zxing/library ^0.22.0`; treat this as an intentional compatibility patch, not a blind merge. The Node 20 engine warning from `@zxing/library@0.22.0` is handled separately by the `3.12.17` frontend Node 24 builder alignment. |
| `#65` | Dependabot: `@zxing/browser` `0.1.5` to `0.2.0` | Conflicting; GitGuardian and Snyk green | Covered by local `3.10.23` ZXing browser decoder upgrade. Close or let GitHub mark obsolete after local commits are pushed. |
| `#14` | Dependabot: `express` `4.22.1` to `5.2.1` | Conflicting; no current check rollup | Covered by local `3.10.27` Express 5 runtime compatibility work. Close or let GitHub mark obsolete after local commits are pushed. |

## Coverage Map

| Gate | Location | Proves | Blocking posture |
|---|---|---|---|
| Dependency vulnerability scan | `.github/workflows/docker-publish.yml` `dependency-scan` | Backend/frontend production dependency audit runs from committed lockfiles. Critical vulnerabilities block. High findings require release-note triage. | Blocking for publish workflow. |
| Dependency watch | `.github/workflows/dependency-watch.yml` | Scheduled outdated/audit reporting for backend and frontend dependencies. Produces review artifacts without blocking releases. | Advisory. |
| Dependabot | `.github/dependabot.yml` | Weekly npm and GitHub Actions update PRs. | Advisory until PR selected. |
| Snyk PR checks | GitHub/Snyk integration | External dependency/security signal on Dependabot PRs. | Advisory unless configured as required in GitHub branch protection. |
| GitGuardian | GitHub/GitGuardian integration | External secret scanning signal on PRs. | Advisory unless configured as required in GitHub branch protection. |
| Secret scan | `.github/workflows/docker-publish.yml` `secret-scan` | Gitleaks scans repository history/current tree and enforces zero SARIF findings. | Blocking for publish workflow. |
| CodeQL code scanning | `.github/workflows/codeql.yml` | Static source analysis for JavaScript/TypeScript security and quality issues. Uploads code scanning alerts to GitHub Security. | Advisory at introduction; promote to required only after the first clean baseline is understood. |
| Migration check | `.github/workflows/docker-publish.yml` `migration-check` | Unit tests, OpenAPI, migrations, init parity, and migration rehearsal against ephemeral Postgres. | Blocking for publish workflow. |
| Compose smoke | `.github/workflows/docker-publish.yml` `compose-smoke` | Built stack health, version readback, security headers, secure cookie attributes, unauthenticated auth behavior, and integration smoke. | Blocking for publish workflow. |
| RBAC regression | `.github/workflows/docker-publish.yml` `rbac-regression` | API-level ownership, role, scope, and cross-type isolation behavior. | Blocking for publish workflow. |
| Browser regression | `.github/workflows/docker-publish.yml` `browser-regression` | Playwright coverage against a live compose stack for key app flows. | Blocking for publish workflow. |
| Runtime smoke | `.github/workflows/docker-publish.yml` `runtime-smoke` | Verifies both the core runtime surface and the control-plane runtime surface without exposing product edition naming in the public workflow labels. | Blocking for publish workflow. |
| Image security and SBOM | `.github/workflows/docker-publish.yml` `image-security-and-sbom` | Backend/frontend images are scanned with Trivy and CycloneDX SBOMs are uploaded. Critical vulnerabilities block. | Blocking for publish workflow. |

## CodeQL Decision

GitHub's CodeQL/code scanning documentation lists public repositories on GitHub.com as supported for CodeQL code scanning, and the CodeQL project describes CodeQL as free for open source. collectZ is a public repository, so adding CodeQL is appropriate as a low-cost source scanning layer.

CodeQL does not replace the existing dependency, secret, image, RBAC, browser, or runtime-smoke gates. It fills a different lane: source-level static analysis for JavaScript/TypeScript issues that dependency and container scanners do not prove.

Initial posture is advisory. After the first baseline run is clean and false-positive behavior is understood, maintainers can decide whether CodeQL should become a required branch-protection check.

## CodeQL Baseline Parity

Authoritative CodeQL baseline means the GitHub Actions scan over a clean checkout of committed, maintained JavaScript/TypeScript source. The workflow uses `.github/codeql/codeql-config.yml` to keep generated and local-only output out of the source-analysis baseline while preserving the broad `security-extended` and `security-and-quality` suites.

The hosted workflow keeps authoritative analysis on committed source and runs `security-extended` plus `security-and-quality` with `codeql-config.yml`. The local `.github/codeql/collectz-js-models` model pack is used for exploratory local CLI scans only, because hosted CodeQL workflow inputs currently accept registry-scoped packs and do not support local pack paths.

Exploratory local CLI runs may additionally load `codeql/javascript-queries:AlertSuppression.ql` and the local collectZ model pack for in-file suppression and model-coverage review. Those local-only results are still advisory until they reproduce against the hosted authoritative baseline.

The config excludes generated/noisy paths such as `artifacts/**`, `backend/artifacts/**`, `frontend/artifacts/**`, Playwright reports, coverage output, build/dist output, dependency folders, and local SARIF exports. Those files may exist in a maintainer workspace after browser captures, release evidence generation, local builds, or exploratory CodeQL runs, but they are not shipped app source and should not drive product-security remediation unless the finding points back to maintained source.

Local CodeQL runs should be made comparable to cloud by either starting from a clean checkout or using the same config file:

```bash
gh codeql database create /tmp/collectz-codeql-db \
  --language=javascript-typescript \
  --build-mode=none \
  --source-root "$PWD" \
  --codescanning-config .github/codeql/codeql-config.yml

gh codeql database analyze /tmp/collectz-codeql-db \
  codeql/javascript-queries:codeql-suites/javascript-security-extended.qls \
  codeql/javascript-queries:codeql-suites/javascript-security-and-quality.qls \
  --format=sarifv2.1.0 \
  --output=/tmp/collectz-codeql-results.sarif \
  --threads=0 \
  --rerun
```

Local exploratory scans may intentionally include uncommitted/generated files or local-only query/model inputs, but findings from generated artifacts, Playwright reports, SARIF outputs, release evidence, coverage, dependency folders, local build output, or unsupported local-only CodeQL extensions are triage noise unless they identify a problem in maintained source. Raw local SARIF result counts are also not expected to equal GitHub code-scanning alert counts exactly because GitHub fingerprints, deduplicates, branches, and suppresses alerts before presenting them in the Security UI.

## Operating Policy

- Treat Dependabot PRs as prompts to create intentional local maintenance patches when the dependency has runtime, peer, or major-version risk.
- Merge or close PRs only after the selected local patch has release notes, release-feed output, and runtime evidence.
- Keep vulnerability-bearing PRs ahead of routine patch churn.
- Do not blindly merge PRs that cross major versions, peer dependency boundaries, framework runtimes, router/parser behavior, auth/session behavior, migration tooling, or image/build tooling.
- Document high vulnerabilities in the matching release note with owner and target milestone.
- Keep `@zxing/library@0.23.0` deferred until the browser peer boundary is resolved or explicitly overridden with runtime proof.
- Treat frontend build-runtime changes separately from ZXing package-version changes; the supported `0.22.0` decoder pair now expects the frontend Docker builder to run on Node 24.
- Treat the clean GitHub Actions CodeQL baseline as authoritative for product security triage. Local generated-artifact findings are advisory context only unless they trace to committed maintained source.

## Follow-Up Options

- Add branch protection requirements for CodeQL after the first baseline run is understood.
- Add OSV/Scorecard as a separate advisory workflow if dependency provenance risk becomes a priority.
- Add license policy scanning only if distribution or dependency-license obligations become unclear.
- Add SBOM diffing only if release review needs dependency-change traceability beyond current CycloneDX artifacts.
- Add Snyk policy documentation if Snyk remains a long-term required PR signal.
