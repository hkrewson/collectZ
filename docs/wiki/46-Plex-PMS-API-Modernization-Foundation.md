# Plex PMS API Modernization Foundation

## Goal

Move new Plex-facing work toward the provider-oriented Plex Media Server API without destabilizing the existing Plex import path.

## Current collectZ Behavior

The existing Plex integration is legacy-library-path based:

- `/library/sections`
- `/library/sections/:sectionId/all`
- `/library/metadata/:ratingKey/children`
- `/library/metadata/:ratingKey/allLeaves`

Those paths remain the maintained import path for current Plex library sync, duplicate avoidance, TV season inventory, and provider identity alias behavior.

## Modernization Direction

New Plex-facing features should first prove the provider-oriented PMS API shape before adding more hard-coded library-section assumptions.

The initial discovery path is:

- `/media/providers`

Use this for feature discovery and future new Plex surfaces where possible. The first good proof slice is a read-only Now Playing or provider-discovery probe, not a rewrite of import behavior.

## Migration Rules

- Keep existing Plex import and duplicate-avoidance behavior on legacy paths until provider endpoints prove equivalent identity and metadata coverage.
- Prefer JSON responses for new PMS API calls while preserving XML compatibility for existing imports.
- Treat provider discovery as capability readback, not as permission to change import semantics automatically.
- Do not expose Plex tokens, provider URLs, file paths, raw download locations, or other credential-adjacent values in browser-visible payloads.
- Keep Plex modernization separate from Plex webhooks, scheduled sync cadence, and kiosk-style Now Playing UI until each is promoted as its own milestone.

## Candidate Follow-ups

- Now Playing Viewer provider proof.
- Plex provider-discovery runtime smoke against a fake PMS payload. Promoted as `3.4.112`.
- Real-server Plex provider discovery readback. Promoted as `3.4.113`.
- Now Playing provider proof. Promoted as `3.4.114`.
- Now Playing readback endpoint. Promoted as `3.4.115`.
- Now Playing UI readback. Promoted as `3.4.116`.
- Plex watch-state sync cadence.
- Plex webhook ingestion contract.

## Acceptance Criteria

- The legacy Plex import paths are documented as current behavior.
- The provider-oriented PMS direction is documented for future Plex features.
- Source assertions keep the modernization contract and parser in place.
- Existing Plex import tests continue to pass without behavior changes.
