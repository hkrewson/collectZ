# Engineering Delivery Policy (Pre-2.0)

This document defines mandatory engineering controls for milestone delivery, release quality, and frontend modularity.

Use this policy together with:

- `07-Release-Roadmap.md`
- `09-Smoke-Test-Checklist.md`
- `10-CI-CD-and-Registry-Deploy.md`

---

## 1) Mandatory Per-Milestone Release Gates

Every milestone release must pass all gates below before tag/publish.

### Required Gates

1. Version consistency:
   - `backend/package.json`, `frontend/package.json`, and app metadata version values must match.
2. Migration safety:
   - migration apply check passes in CI,
   - init/migration parity checks pass.
3. Runtime health:
   - compose stack boots cleanly,
   - `/api/health` returns expected version/build metadata.
4. Security checks:
   - secret scan (committed secret detection) completed,
   - dependency vulnerability scan completed,
   - container image scan completed,
   - SBOM artifact generated.
5. Smoke validation:
   - milestone UI/API smoke checklist executed and recorded.
6. Documentation:
   - release scope and operator-impacting changes documented in the wiki.
7. Full release notes:
   - a complete release note is required for every tagged version.
   - release note must include: summary, scope completed, migrations/schema impacts,
     env/config changes, deployment steps, rollback notes, UI/API test checklist, known limitations.

### Enforcement

- These gates must be enforced in CI wherever possible.
- Missing gate coverage is treated as a roadmap task, not a manual workaround.
- A release is "not ready" if any mandatory gate fails.
- "No release notes" is a release blocker.
- Tagged releases must publish a CI preflight go/no-go artifact proving required evidence exists.

---

## 1a) Release Notes Standard (Required)

Each release must publish full notes in a consistent format.

### Required Sections

1. Version and date.
2. Milestone target and status.
3. What changed (grouped by backend, frontend, database, docs/ops).
4. Breaking changes (or explicit "none").
5. New/changed environment variables.
6. Migration notes and data-impact notes.
7. Deployment and verification steps.
8. Rollback guidance.
9. Known issues and follow-up roadmap items.

### Storage

- Release notes are stored in-repo under `docs/releases/`.
- File naming: `vX.Y.Z.md` (example: `v1.9.14.md`).

### Enforcement Guidance

- CI should verify the presence of the matching release note file for release/tag workflows.
- Missing required sections should fail the release workflow once the section-check step is added.

---

## 1b) Vulnerability Triage Policy (CI Blocking Rules)

Security scans run in CI and use these default blocker thresholds:

- Secret scan (`gitleaks`): block on any detected committed secret.
- Dependency scan (`npm audit`): block on `critical` vulnerabilities.
- Container image scan (Trivy): block on `critical` vulnerabilities.
- `high` severity findings do not block by default, but must be triaged and tracked.

### Exception Process

If a release must proceed with a blocking finding:

1. Document the finding, impact, and compensating controls in release notes.
2. Create a roadmap item with target version and owner.
3. Add temporary CI exception only with:
   - explicit scope (single package/image),
   - expiration milestone/date,
   - linked issue/roadmap reference.
4. Remove exception immediately after remediation ships.

---

## 2) Scope Discipline and Feature-Creep Policy

### Rules

1. Each PR/milestone has an explicit in-scope list.
2. Out-of-scope enhancements are deferred to roadmap items unless they are blocking defects.
3. Security and data-integrity fixes can preempt feature scope, but must be documented.
4. Roadmap changes require same-PR documentation updates.
5. Refactors must be targeted:
   - no broad unrelated rewrites inside feature PRs.

### Required PR Notes

Each PR should include:

- milestone id (`1.9.x`/`2.0.x`),
- scope summary (what changed),
- non-scope items explicitly deferred,
- test evidence references.

---

## 3) Frontend Modularity Policy (App Shell vs Modules)

### App Shell Contract (`frontend/src/App.js`)

`App.js` is limited to:

- app bootstrap and top-level providers,
- route/screen composition,
- global shell layout and nav wiring,
- cross-page state wiring only when shared state cannot be localized.

`App.js` must not contain:

- page-specific business logic,
- large endpoint orchestration specific to one page,
- dense form logic for feature-specific views.

### Module Placement Rules

- Page-level feature logic: `frontend/src/components/*View.js` or page modules.
- Shared API interaction/state helpers: service or hook modules.
- Reusable UI primitives: dedicated component modules.
- Styles: feature-local classes/components where possible, avoid global bloat.

### Complexity Budget

- `frontend/src/App.js` soft budget: <= 450 LOC.
- `frontend/src/App.js` hard budget: <= 550 LOC (CI failure beyond this without approved exception).
- Any file exceeding 700 LOC should be split during the next relevant milestone.
- CI exception file for temporary App shell overage: `.ci/exceptions/app-shell-budget.json`.
  Required fields: `reason`, `approved_by`, `expires_on` (`YYYY-MM-DD`), `max_lines`, `target_milestone`.

---

## 4) Exception Process

If a milestone needs a temporary policy exception:

1. Document exception reason and risk.
2. Link the follow-up roadmap item/version target.
3. Add explicit expiration condition (when exception must be removed).

No permanent silent exceptions.

---

## 5) UI Simplicity Default Policy

When adding operational controls (filters, toggles, actions), default to the minimal interface that solves the common case.

Rules:

1. One primary input path first (for example a single search field) before adding secondary controls.
2. Avoid mandatory extra clicks (`Apply`, `Clear`, `Refresh`) unless there is a proven performance or correctness need.
3. Advanced filters should be hidden behind an explicit affordance, not always-on in default layout.
4. If a control does not materially improve first-pass task success, defer it to roadmap backlog.

Acceptance guidance:

- Default workflows should be operable with minimal taps/clicks on mobile and desktop.
- Added complexity must have a documented incident or operator use case.
