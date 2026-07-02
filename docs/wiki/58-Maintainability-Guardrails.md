# Maintainability Guardrails

This note records the `3.23.0` foundation rules for adding lint, format, frontend unit tests, and extraction pressure without destabilizing the existing release workflow.

## Report-first quality command

- `npm run quality:frontend` is warning-only in `3.23.0`.
- The command writes ignored local artifacts to `artifacts/quality/frontend-quality-report.{json,md}`.
- ESLint includes React hooks and JSX accessibility rules for `frontend/src`.
- Prettier runs in check mode only; do not mass-format unrelated files to clear the baseline.
- Source-size reporting is warning-only and tracks the largest files called out by review:
  - `backend/routes/media.js`
  - `frontend/src/components/EventsView.jsx`
  - `frontend/src/components/LibraryView.jsx`
  - `backend/routes/events.js`

## Frontend unit tests

- Frontend unit tests use Vitest from `frontend/`.
- Start with pure helpers and small extracted modules before component testing.
- Playwright remains the browser regression layer; Vitest is the fast feedback loop for seams that are hard to exercise directly through the UI.

## Strangler extraction rule

- Do not rewrite a large file just because it is large.
- When product work touches a monolith section, prefer extracting the touched pure helper, subcomponent, or mapper into a focused module.
- Add Vitest coverage for the extracted module when it has branching behavior.
- Keep behavior-preserving extraction separate from follow-up UX or data-model changes when practical.
- Treat source-size warnings as a prompt to shrink touched areas or explain why growth is intentional.

## What becomes blocking later

The first slice makes reporting visible. A later milestone can choose which checks become CI-blocking once the baseline is understood and the noisy rules are tuned.
