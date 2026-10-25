# Dependency PR and CI Security Coverage

This document records dependency PR triage, vulnerability gates, and source/code scanning. The current queue and alert dispositions were refreshed on `2026-10-24`.

## Current PR Queue

Verified with `gh pr list` on 2026-10-24.

The queue had 22 automated update PRs. Six proposals were closed as superseded by newer versions already resolved on `main`: Nodemailer, CSV parser, Express rate limit, Vite, frontend Axios, and Vitest. The security fixes were pushed in `3.25.3`, and the resulting main-branch CodeQL and build/publish workflows passed. Ten additional compatible updates are included in the local `3.25.4` slice: #127, #137, #139, #141, #142, #145, #153, #158, #160, and #161. Close these as superseded after that release commit reaches `main`. PR #14 was already superseded by `express@5.2.1` on `main` and has been closed. Fifteen PRs currently remain open; after the ten duplicates close, five remain for separate review: #71 and #124 (the coupled ZXing browser/library updates), plus #113, #134, and #148 (GitHub Actions updates).

Keep `@zxing/browser@0.2.1` and `@zxing/library@0.23.0` together until dedicated barcode/browser compatibility checks are run; the browser update requires library `^0.23.0`. Review GitHub Actions major-version PRs (`actions/checkout` 6-to-7, `actions/setup-node` 6-to-7, and `github/codeql-action` 4.x) separately because they change CI execution behavior. Do not treat an automated green check on an old base as sufficient evidence.

### October 24, 2026 security triage

- Full clean-install `npm audit` under Node `24.22.1` found six backend and two frontend vulnerable package records. Backend fixes selected: `body-parser@2.4.0`, `multer@2.5.0`, `nodemailer@10.2.1`, `ip-address@10.7.4`, and `zod@4.6.7`. Frontend Vitest and `@vitest/mocker` are updated to `4.1.12`.
- Backend and frontend `npm ci` completed and audited zero vulnerabilities after those updates. Full audits also report zero. Hosted `dependency-scan` must verify the committed locks after push.
- GitHub Dependabot alerts were associated with vulnerable versions from the pushed `3.25.2` dependency graph, including packages already fixed on `main` in `3.25.3`. The `3.25.3` hosted dependency scan passed, but GitHub still lists the nine alerts as open. Do not manually dismiss them; inspect the alert details and default-branch graph after the next main-branch release.
- GitHub later refreshed the graph and marked Dependabot alerts #105 and #133–140 fixed at `2026-10-24 23:50 UTC`; the repository now has zero open Dependabot alerts. The corresponding default-branch versions are Vite `8.3.5`, `follow-redirects` `1.16.1`, `source-map-js` `1.2.2`, and no `brace-expansion` package. Backend/frontend full npm audits and hosted `dependency-scan` also passed. Do not manually dismiss these resolved alerts.
- CodeQL alerts #121–123 (`js/user-controlled-bypass`) were reviewed and dismissed as false positives on `2026-10-24`. Service-account bearer keys are SHA-256 hash-matched to active, unexpired stored records, then constrained by route scopes and allowed prefixes. Mobile auth requires an exact stored hash match; logout only revokes the authenticated session or a row with an exact refresh-token hash. Existing RBAC, auth-abuse, and source-contract checks cover these paths. The dismissal comments record these reasons; do not weaken authorization logic to silence the taint-model warnings.

## Coverage Map

| Gate | Location | Proves | Blocking posture |
|---|---|---|---|
| Dependency vulnerability scan | `.github/workflows/docker-publish.yml` `dependency-scan` | Backend/frontend production dependency audit (`npm audit --omit=dev`) runs from committed lockfiles under Node 24.22.1. Critical vulnerabilities block. High findings require release-note triage. This gate does not cover development/build tools; use a full `npm audit` in both apps when those advisories are reported. Node runtime and bundled-library advisories are handled by updating the image/CI Node baseline and image scan. | Blocking for publish workflow. |
| Dependency watch | `.github/workflows/dependency-watch.yml` | Weekly, manual, and dependency-PR clean installs cover root tooling plus backend/frontend under Node 24.22.1. Audit/outdated summaries and partial artifacts survive an ecosystem install failure, making lockfile drift actionable. | Advisory monitor; dependency-changing PRs must pass their clean installs. |
| Dependabot | `.github/dependabot.yml` | Weekly npm and GitHub Actions update PRs. | Advisory until PR selected. |
| Snyk PR checks | GitHub/Snyk integration | External dependency/security signal on Dependabot PRs. | Advisory unless configured as required in GitHub branch protection. |
| GitGuardian | GitHub/GitGuardian integration | External secret scanning signal on PRs. | Advisory unless configured as required in GitHub branch protection. |
| Local CI/CD release gate | `npm run release:local-gate` | Pre-push maintainer validation for version/release metadata, backend unit tests, OpenAPI, frontend build, dependency audits, local preflight, and diff hygiene. | Required local handoff expectation; hosted CI remains authoritative for public release gates. |
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

The hosted workflow keeps authoritative analysis on committed source and runs `.github/codeql/collectz-maintained-source.qls` with `codeql-config.yml`. The maintained-source suite imports the built-in JavaScript/TypeScript `security-and-quality` suite and the config filters disposition `js/http-to-file-access` and the reviewed Sched ICS `js/request-forgery` boundary because collectZ intentionally persists authenticated upload bytes under generated, non-user-controlled paths and enforces the ICS public/private DNS policy in source even though hosted JavaScript CodeQL does not model that helper precisely. JavaScript/TypeScript model packs are not currently supported by CodeQL, so the checked-in `.github/codeql/collectz-js-models` pack is kept only as reference material; the local request-forgery parity check in this slice comes from the in-source `// codeql[js/request-forgery]` suppression on the reviewed sink.

Exploratory local CLI runs may additionally load `codeql/javascript-queries:AlertSuppression.ql` for in-file suppression review. Those local-only results are still advisory until they reproduce against the hosted authoritative baseline.

The config excludes generated/noisy paths such as `artifacts/**`, `backend/artifacts/**`, `frontend/artifacts/**`, Playwright reports, coverage output, build/dist output, dependency folders, and local SARIF exports. Those files may exist in a maintainer workspace after browser captures, release evidence generation, local builds, or exploratory CodeQL runs, but they are not shipped app source and should not drive product-security remediation unless the finding points back to maintained source.

Local CodeQL runs should be made comparable to cloud by either starting from a clean checkout or using the same config file:

```bash
gh codeql database create /tmp/collectz-codeql-db \
  --language=javascript-typescript \
  --build-mode=none \
  --source-root "$PWD" \
  --codescanning-config .github/codeql/codeql-config.yml

gh codeql database analyze /tmp/collectz-codeql-db \
  .github/codeql/collectz-maintained-source.qls \
  --format=sarifv2.1.0 \
  --output=/tmp/collectz-codeql-results.sarif \
  --threads=0 \
  --rerun
```

Latest local parity check (2026-06-10):
- Result count: `1` suppressed `js/request-forgery` result, `0` active findings.
- Active findings: `0`.
- Dispositioned suite exclusions: `js/http-to-file-access` remains excluded because the matched writes are intentional authenticated upload persistence or local smoke/proof artifact generation to fixed/generated paths, and `js/request-forgery` is source-suppressed because the ICS URL guard enforces the public/private DNS policy in source even though the hosted JavaScript analysis does not model that helper precisely.
- The previously reviewed findings were in committed, maintained source (none under ignored paths such as artifacts, Playwright report output, coverage, dist/build outputs, node_modules, or SARIF outputs).

Local exploratory scans may intentionally include uncommitted/generated files or local-only query/model inputs, but findings from generated artifacts, Playwright reports, SARIF outputs, release evidence, coverage, dependency folders, local build output, or unsupported local-only CodeQL extensions are triage noise unless they identify a problem in maintained source. Raw local SARIF result counts are also not expected to equal GitHub code-scanning alert counts exactly because GitHub fingerprints, deduplicates, branches, and suppresses alerts before presenting them in the Security UI.

## Operating Policy

- Treat Dependabot PRs as prompts to create intentional local maintenance patches when the dependency has runtime, peer, or major-version risk.
- Prefer one verified main-branch maintenance slice over stacking stale automated PRs; close automated PRs that the delivered slice supersedes.
- Merge or close PRs only after the selected local patch has release notes, release-feed output, and runtime evidence.
- Keep vulnerability-bearing PRs ahead of routine patch churn.
- Do not blindly merge PRs that cross major versions, peer dependency boundaries, framework runtimes, router/parser behavior, auth/session behavior, migration tooling, or image/build tooling.
- Document high vulnerabilities in the matching release note with owner and target milestone.
- Keep `@zxing/library@0.23.0` deferred until the browser peer boundary is resolved or explicitly overridden with runtime proof.
- Treat frontend build-runtime changes separately from ZXing package-version changes; the supported `0.22.0` decoder pair expects the frontend Docker builder to run on the current patched Node 24 baseline (`24.22.1` or later security patch).
- Treat the clean GitHub Actions CodeQL baseline as authoritative for product security triage. Local generated-artifact findings are advisory context only unless they trace to committed maintained source.

## Follow-Up Options

- Add branch protection requirements for CodeQL after the first baseline run is understood.
- Add OSV/Scorecard as a separate advisory workflow if dependency provenance risk becomes a priority.
- Add license policy scanning only if distribution or dependency-license obligations become unclear.
- Add SBOM diffing only if release review needs dependency-change traceability beyond current CycloneDX artifacts.
- Add Snyk policy documentation if Snyk remains a long-term required PR signal.
