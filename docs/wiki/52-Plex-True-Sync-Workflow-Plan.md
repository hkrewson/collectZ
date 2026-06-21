# Plex True Sync Workflow Plan

## Goal

Make Plex feel like a real sync integration instead of a long settings page with several unrelated controls.

The UI should teach the operating model through the workflow itself:

- setup connection details and selected libraries,
- run or schedule library sync,
- expose webhook receiver state,
- keep provider and display diagnostics in an advanced area.

## Current Baseline

- Plex connection settings, import controls, reconciliation sync, webhook receiver, provider discovery, active sessions, and now-playing display settings all exist.
- The page has grown too long and explanatory.
- The previous "Plex operating model" block duplicated the controls instead of improving the workflow.
- Plex import and reconciliation remain on maintained Plex library paths; provider discovery is still capability readback.

## First Slice

`3.20.0` starts the redesign by splitting the Plex integration tab into four sections:

- `Setup`: API URL, library section IDs, detected libraries, and credentials.
- `Sync`: manual check, manual sync, queued preview, scheduler readback, and conflict review.
- `Webhook`: receiver generation, masked receiver readback, processing mode, and last event state.
- `Advanced`: provider discovery, active sessions, now-playing display link, and display preferences.

The first slice removes the separate operating-model explainer from the UI. The workflow sections now carry that context.

## Follow-Up Work

- Persist sync cadence and read it back from the same Sync section instead of relying only on runtime env. Completed in `3.20.1`.
- Add an initial import flow that makes selected Plex libraries and media types explicit before queuing work. Completed in `3.20.3`.
- Add webhook setup validation so the UI can show whether Plex can reach the receiver. Completed in `3.20.2` with receiver-exists validation and local-only host warning readback.
- Add scheduled pull sync controls for new Plex items, watched state, and rating readback. Library reconciliation cadence was completed in `3.20.1`; watched-state and rating readback status/manual run was surfaced in `3.20.7`; persisted readback refresh cadence was completed in `3.20.8`.
- Add explicit opt-in writeback controls for ratings and watched state. Completed in `3.20.6`; no silent writeback.
- Add activity entries for import, sync, webhook, and writeback outcomes. Activity readability for existing Plex events improved in `3.20.4`.
- Add reconciliation review filters for Plex conflicts, skipped items, and provider errors. Conflict status and match-reason filters completed in `3.20.5`.

## Safety Rules

- Do not expose Plex tokens, raw file paths, download locations, or secret-adjacent values in browser-visible payloads.
- Keep writeback opt-in and user-triggered until a later release explicitly adds scheduler controls.
- Keep provider discovery separate from item import behavior unless a runtime proof shows identity, metadata, and repeat-sync parity.
- Keep the UI compact: no standalone operating-model copy blocks, no duplicated tab headings, and no large explanatory boxes.

## Acceptance Criteria

- Users can tell where to set up Plex, where to sync, where to configure webhooks, and where diagnostics live without reading a separate operating-model panel.
- The Plex tab remains usable on laptop-height screens without forcing advanced diagnostics above the primary connection and sync workflow.
- The backlog points to this plan for future Plex sync work instead of reopening broad completed Plex modernization items.
