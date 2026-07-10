# Local CI/CD Release Gate

This document defines the local release-gate workflow for collectZ maintainers and Codex.

The local gate does not replace GitHub Actions, CodeQL, Dependabot, GHCR publishing, or the tagged release workflow. It gives maintainers one local command to run before pushing, so common release, security, and runtime issues are caught before public CI logs are involved.

## Commands

Standard pre-push gate:

```bash
npm run release:local-gate
```

Full local gate:

```bash
npm run release:local-gate:full
```

Full gate with blocked heavy checks treated as failures:

```bash
npm run release:local-gate:full -- --fail-on-blocked
```

Install the optional pre-push hook:

```bash
npm run release:install-hooks
```

Temporarily bypass the hook only with an explicit reason:

```bash
COLLECTZ_SKIP_LOCAL_GATE="reason here" git push
```

## Standard Profile

The standard profile is intended for ordinary pre-push use. It runs:

- package and app metadata JSON parsing
- version metadata sync
- release note heading check
- Help > Releases feed check
- backend unit tests
- OpenAPI validation
- frontend production build
- backend production dependency audit
- frontend production dependency audit
- local release preflight helper
- `git diff --check`

The standard profile writes:

- `artifacts/local-ci/local-release-gate.json`
- `artifacts/local-ci/local-release-gate.md`

These reports intentionally avoid writing environment variables and redact common secret-bearing output patterns.

## Full Profile

The full profile includes the standard profile plus heavier local checks when the machine has the tools and runtime state available:

- CodeQL maintained-source analysis through `gh codeql`
- gitleaks secret scan
- runtime smoke against isolated throwaway Docker compose projects
- Playwright browser regression
- image security/SBOM readiness

`BLOCKED` means the current machine does not have the needed tool, runtime state, or opt-in environment variable. Use `--fail-on-blocked` when a release handoff should stop on missing heavy gates.

## Tool Expectations

Some full-profile gates depend on optional local tools or runtime state:

- CodeQL requires the GitHub CLI with CodeQL support.
- Secret scanning requires `gitleaks`.
- Runtime smoke requires Docker. The local runner creates separate throwaway core and control-plane compose projects with generated ephemeral secrets, then tears them down.
- Browser regression requires `PLAYWRIGHT_E2E_BYPASS_TOKEN`.
- Image security/SBOM currently remains CI follow-through unless local Trivy wiring is promoted in a later slice.

## Push Policy

Before pushing ordinary work, run the standard local gate or install the pre-push hook.

Before pushing release-shaped work, run the full profile when practical, then account for any blocked heavy gates in the release closeout. GitHub Actions remains the final hosted confirmation for public CI, image publishing, and any gates that are unavailable locally; the hosted release preflight must pass on the `main` release-candidate run before auto-tagging proceeds.

Do not commit local gate artifacts unless a future release evidence policy explicitly promotes them. They are working evidence for the local machine, not public release notes.
