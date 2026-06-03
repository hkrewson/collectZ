# Dependency PR and CI Security Coverage

This document records the `3.10.28` dependency PR and CI security review. It is a maintainer-facing coverage map for dependency PR triage, vulnerability gates, and source/code scanning.

## Current PR Queue

Verified with `gh pr list` on 2026-06-03.

| PR | Source | Status | Disposition |
|---:|---|---|---|
| `#77` | Dependabot: `react-dom` `19.2.6` to `19.2.7` | Mergeable; GitGuardian and Snyk green | Covered by local `3.10.25` React runtime compatibility work. Close or let GitHub mark obsolete after local commits are pushed. |
| `#76` | Dependabot: `react` `19.2.6` to `19.2.7` | Mergeable; GitGuardian and Snyk green | Covered by local `3.10.25` React runtime compatibility work. Close or let GitHub mark obsolete after local commits are pushed. |
| `#71` | Dependabot: `@zxing/library` `0.22.0` to `0.23.0` | Mergeable; GitGuardian and Snyk green | Keep open/deferred. `@zxing/browser@0.2.0` currently peers with `@zxing/library ^0.22.0`; treat this as an intentional compatibility patch, not a blind merge. |
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
| Homelab edition boundary | `.github/workflows/docker-publish.yml` `homelab-edition-boundary` | Shared/public runtime boundary remains mounted while private-only APIs stay unavailable. | Blocking for publish workflow. |
| Platform edition boundary | `.github/workflows/docker-publish.yml` `platform-edition-boundary` | Private/platform control-plane surfaces remain available where expected. | Blocking for publish workflow. |
| Image security and SBOM | `.github/workflows/docker-publish.yml` `image-security-and-sbom` | Backend/frontend images are scanned with Trivy and CycloneDX SBOMs are uploaded. Critical vulnerabilities block. | Blocking for publish workflow. |

## CodeQL Decision

GitHub's CodeQL/code scanning documentation lists public repositories on GitHub.com as supported for CodeQL code scanning, and the CodeQL project describes CodeQL as free for open source. collectZ is a public repository, so adding CodeQL is appropriate as a low-cost source scanning layer.

CodeQL does not replace the existing dependency, secret, image, RBAC, browser, or edition-boundary gates. It fills a different lane: source-level static analysis for JavaScript/TypeScript issues that dependency and container scanners do not prove.

Initial posture is advisory. After the first baseline run is clean and false-positive behavior is understood, maintainers can decide whether CodeQL should become a required branch-protection check.

## Operating Policy

- Treat Dependabot PRs as prompts to create intentional local maintenance patches when the dependency has runtime, peer, or major-version risk.
- Merge or close PRs only after the selected local patch has release notes, release-feed output, and runtime evidence.
- Keep vulnerability-bearing PRs ahead of routine patch churn.
- Do not blindly merge PRs that cross major versions, peer dependency boundaries, framework runtimes, router/parser behavior, auth/session behavior, migration tooling, or image/build tooling.
- Document high vulnerabilities in the matching release note with owner and target milestone.
- Keep `@zxing/library@0.23.0` deferred until the browser peer boundary is resolved or explicitly overridden with runtime proof.

## Follow-Up Options

- Add branch protection requirements for CodeQL after the first baseline run is understood.
- Add OSV/Scorecard as a separate advisory workflow if dependency provenance risk becomes a priority.
- Add license policy scanning only if distribution or dependency-license obligations become unclear.
- Add SBOM diffing only if release review needs dependency-change traceability beyond current CycloneDX artifacts.
- Add Snyk policy documentation if Snyk remains a long-term required PR signal.
