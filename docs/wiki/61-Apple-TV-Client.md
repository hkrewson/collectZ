# Apple TV client

The native app lives in the sibling `collectZ-tvos` repository. Version 1.0.0 targets tvOS 18+, CollectZ Core 3.25.0+, and TV capability version 1. It browses existing media, media collections, art, and collectibles without editing or playing content. The web application's shipped theme and assets are the visual source of truth.

## Connect

Enter the HTTPS origin of your Core installation on Apple TV. Open the displayed `/activate` address on another device, sign in, and enter the code shown on your own television. Approval grants read-only access to your current authorized libraries. No Plex or other source connection is made by the TV.

`GET /api/mobile/tv/capabilities` advertises version/edition support. Device start, decision, and token endpoints live under `/api/mobile/auth/device`. Start returns a same-origin verification path, a short code, a secret device credential, a 600-second expiry, and a 5-second initial polling interval. `authorization_pending` continues polling; `slow_down` adds five seconds. Denial, expiration, and consumed credentials stop polling. Approval requires cookie authentication and CSRF; authorization headers are rejected on that browser endpoint.

TV sessions use the existing mobile token lifecycle and only `profile:read` plus `tv:read`. Existing scanner permissions remain unchanged. Refresh and logout use `/api/mobile/auth/refresh` and `/api/mobile/auth/logout`. Lost refresh/redemption responses require reconnecting rather than unsafe retries. Offline sign-out clears the Keychain immediately; an unreachable server session remains bounded by its server TTL.

## API boundaries

TV read scopes allow only exact library, media, media-collection, art, collectible, feature-flag, and artwork read endpoints. Scoped reads require an explicit `library_id` (or existing `x-library-id` hint). Membership is checked even for administrator accounts. This does not update the user's global active library. `/api/libraries` returns only current non-suspended memberships.

TV responses omit integration payloads and raw image URLs, exposing a limited metadata projection and same-origin `artwork_path`. The image endpoint checks the same library boundary before loading uploads or HTTPS artwork from known catalog hosts or the configured public S3 base. Remote DNS is pinned to a public IPv4 address, redirects are rejected, response size is bounded, and image magic is validated. Unsupported hosts, private source URLs, and unavailable artwork render an honest placeholder. No arbitrary URL-fetch endpoint is exposed.

Collection refresh reads stored CollectZ data; it never triggers imports, source synchronization, or writeback. The app retains stale results only in memory, clears them on identity/server/access changes, and uses an ephemeral URLSession without a disk cache.

## Verification

Run `npm run test:tv-auth-smoke` in the backend against an **isolated disposable Core database**. It creates fixture identities/content and intentionally suspends a fixture membership; do not run against user data. It proves polling/CSRF/one-time redemption, rotation/revocation, scanner isolation, forbidden writes, cross-library item/artwork denial, collection-join isolation, and membership revocation. Run existing mobile-auth, RBAC, integration, migration/init-parity and release gates as well.

Native test/build instructions and TestFlight preparation are in `collectZ-tvos/README.md`. Hardware focus/VoiceOver and signed distribution checks must be recorded separately from simulator evidence.

## Implementation verification — October 16, 2026

- Dedicated Core TV smoke: **55 checks passed**; real browser activation test: **passed**; Core RBAC regression: **passed** with an explicitly seeded random administrator fixture.
- Backend unit suite, OpenAPI, and ownership certification pass (67 tables, 341 routes, 11 execution paths). Fresh-init parity and migration 122 → 123 rehearsal passed; evidence was copied from the disposable container.
- Canonical `collectz-private` was rebuilt in place at 3.25.0. The migration service completed and the normal non-owner backend started. Backend/frontend production dependency audits report zero vulnerabilities after compatible axios/proxy-addr lock updates.
- Native signed simulator tests and device compilation passed; the native verification document distinguishes final local tests from the live integration run.
- The standard local release gate passes package/version/release-note/feed, CI preparation, unit, OpenAPI, frontend build, production audits, and whitespace checks. The full local gate wrapper still reports hosted/tooling blocks for standalone gitleaks/Trivy and browser opt-in; the Docker-backed scans and isolated browser/runtime results are recorded separately below.
- **Infrastructure recovery:** Docker's approximately 58 GB virtual disk filled during initial validation. With explicit user approval, unused build-cache cleanup reclaimed 14.47 GB; application images and existing data volumes were preserved. The canonical stack is healthy. Identity certification through migration 123 and all 30 runtime-role checks now pass. Both Core and control-plane runtime smokes, the CI-selected 31-test Core browser regression, and production secure-cookie/header/anonymous-denial checks pass. The final native suite passes all 17 tests, including live pairing and focus restoration after final UI polish.
- Local Trivy scans of both built images report **0 fixable critical vulnerabilities**, and both CycloneDX SBOMs were generated in `artifacts/tv-release/sbom`. These are local-image results; hosted CI must scan the exact published image digests after an authorized push.
- **Secret gate remains failed:** full-history gitleaks reports 16 `credentialFingerprint`/`storedCredentialFingerprint` entries in historical migration evidence in commits `6ca3cfad1406` and `7cdb071633c8`. Current evidence excludes these fields; the new TV backend commits and complete native repository scan clean. No values were printed, history rewritten, or findings suppressed. Maintainers must resolve the history gate before release.
- Observability rerun passed **9/9** checks: all persistence rehearsals, Graylog/Loki/syslog collector paths, non-blocking export failure, backend restoration, and final health. Collector smoke requires control-plane edition because Core intentionally hides the export flag. It ran against the disposable verification stack with isolated logging volumes; existing monitoring services were restored.
- External acceptance still includes signed TestFlight validation, physical-device accessibility, beta-review access, and hosted CI on the eventual authorized push. Do not publish or describe 3.25.0 as release-ready until blocking gates are resolved.

Final full local wrapper: **13 passed, 0 failed, 3 blocked**, with runtime excluded from the duplicate run because both editions had just passed independently. Maintained-source CodeQL reports 5 baseline/suppressed results and **0 active findings** after removing an unused fixture variable; the 55-check TV smoke was rerun successfully. Wrapper blocks for host gitleaks/Trivy availability and browser opt-in do not replace the actual Docker-backed scan outcomes above, including the failed history secret gate. Policies used: `AGENTS.md`, `docs/wiki/17-Release-Go-No-Go-Checklist.md`, and `docs/wiki/10-CI-CD-and-Registry-Deploy.md`. Saved local scan/SBOM evidence is indexed at `artifacts/tv-release/README.md`.
