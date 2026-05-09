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
- Real PMS Now Playing runtime proof. Promoted as `3.4.117`.
- Now Playing Viewer. Promoted as `3.4.118`.
- Now Playing Display Token. Promoted as `3.4.119`.
- Now Playing Display Preferences. Promoted as `3.4.120`.
- Now Playing Vertical Poster Display. Promoted as `3.4.121`.
- Plex Webhook and Ratings Sync Contract. Promoted as `3.4.122`.
- Plex Webhook Receiver Administration Contract. Promoted as `3.4.123`.
- Plex Webhook Receiver Processing and Import Enqueue Contract. Promoted as `3.4.124`.
- Plex Single-Rating-Key Import Processing from Webhook Hints. Promoted as `3.4.125`.
- Plex Webhook Import Hint Auto-Processor. Promoted as `3.4.126`.
- Plex Webhook Existing Receiver Readback. Promoted as `3.4.127`.
- Plex Watch-State Sync Cadence Contract. Promoted as `3.4.128`.
- Plex Watched-State Apply Implementation. Promoted as `3.4.129`.
- Plex Watched-State Scheduled Refresh. Promoted as `3.4.130`.
- Plex Rating Readback Apply Implementation. Promoted as `3.4.131`.
- Plex Watched-State Writeback Contract. Promoted as `3.4.132`.
- Plex Watched-State Writeback Implementation. Promoted as `3.4.133`.
- Plex Rating Writeback to Plex. Promoted as `3.4.134`.
- Plex Writeback UI Controls. Promoted as `3.4.135`.
- Plex Full-Library Reconciliation Contract. Promoted as `3.4.136`.
- Plex Scheduled Reconciliation Preview Job. Promoted as `3.4.137`.
- User Rating Scale Normalization. Promoted as `3.4.138`.
- Temporary Reconciliation Review UI. Promoted as `3.4.139`.
- Plex Reconciliation Auto-Sync and Conflict Review. Promoted as `3.4.140`.
- Plex Reconciliation Full-Scan and Scheduler Automation. Promoted as `3.4.141`.
- Plex Episode-Aware TV Sync and Writeback. Promoted as `3.4.142`.
- Plex Reconciliation Conflict Review and Resolution. Promoted as `3.4.143`.
- Plex Attach-Existing Conflict Resolution Contract. Promoted as `3.4.144`.
- Plex Provider/API Import Parity Contract. Promoted as `3.4.145`.
- Plex Provider Item-Listing API Discovery. Promoted as `3.4.146`.

## Acceptance Criteria

- The legacy Plex import paths are documented as current behavior.
- The provider-oriented PMS direction is documented for future Plex features.
- Source assertions keep the modernization contract and parser in place.
- Existing Plex import tests continue to pass without behavior changes.
