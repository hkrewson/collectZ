# Calibre Web Automated Integration Setup

This guide covers setup, verification, and troubleshooting for the CWA OPDS integration used by collectZ (`2.4.5` milestone).

## Purpose

- Replace CSV-style Calibre imports with direct OPDS ingestion.
- Preserve source linkage per imported item (provider IDs + deep links).
- Keep repeat syncs idempotent (update existing rows, avoid duplicates).

## Prerequisites

- collectZ backend/frontend running.
- CWA reachable from collectZ backend network.
- OPDS feed enabled in CWA.
- A CWA account with access to the desired libraries.

## CWA-Side Requirements

1. Enable OPDS feed in CWA settings.
2. Create a dedicated integration user (recommended) with read access.
3. Confirm feed URL works in browser or curl:
   - example: `https://cwa.example/opds`
4. Confirm authentication mode:
   - Basic auth username/password is supported by collectZ.

## collectZ Configuration

Use Admin -> Integrations -> `CWA OPDS`.

Required fields:

- `OPDS URL` (`cwa_opds_url`)

Optional but recommended:

- `Base URL` (`cwa_base_url`) for clean deep links
- `Username` (`cwa_username`)
- `Password/Token` (`cwa_password`) (encrypted at rest)
- `Timeout (ms)` (`cwa_timeout_ms`)

Then click `Save`, then `Test CWA`.

## Import Flow

Use Import -> `CWA OPDS`.

Supported modes:

- `syncMode=incremental` (default)
  - upserts current feed rows
  - reconciles previously imported CWA items that no longer exist upstream (delete missing)
- `syncMode=full`
  - upserts only
  - no delete reconciliation

Parameters:

- `maxPages` (default `20`)
- `deleteMissing` (default `true`, incremental mode only)

Safety behavior:

- If feed is truncated (`hasMore=true`, typically because `maxPages` cap is reached), delete reconciliation is skipped with reason `truncated_feed`.

## Deep-Link Verification Checklist

After a successful CWA import:

1. Open a known imported Book or Comic.
2. Confirm item has CWA provider linkage in `type_details`:
   - `provider_item_id` or `calibre_entry_id`
   - `provider_external_url` or `calibre_external_url`
3. Click `Open in Calibre` in detail drawer.
4. Verify target opens to the correct item in CWA.
5. Repeat for at least one Book and one Comic entry.

## Expected Activity/Job Evidence

Activity log actions:

- `media.import.cwa`
- `media.import.cwa.failed`

Sync jobs:

- `provider = cwa_opds`
- summary should include:
  - `rows`, `created`, `updated`, `errorCount`
  - `pagesFetched`, `endpoint`, `hasMore`
  - `syncMode`, `deleted`, `deleteSkipped`, `deleteSkippedReason`

## Troubleshooting

### `CWA OPDS URL is not configured`

- Save `OPDS URL` in Admin Integrations first.

### 401/403 on test or import

- Verify CWA username/password.
- Confirm integration user has library access in CWA.

### Timeout errors

- Increase `cwa_timeout_ms`.
- Validate network path between backend and CWA host.

### Imports create duplicates

- Confirm incoming items include stable IDs (`provider_item_id` / `calibre_entry_id`).
- Re-run import and verify updates occur (not creates) for unchanged items.

### Missing deletes on incremental sync

- Check if `hasMore=true` in sync summary (truncated feed guard).
- Raise `maxPages` or disable truncation before expecting delete reconciliation.

### Deep links open wrong host/path

- Set `cwa_base_url` to externally routable URL (if reverse proxy/public host differs).
- Re-import affected items so stored links reflect final base URL.

## Environment Variables

Optional `.env` defaults (can be overridden via Admin Integrations UI):

- `CWA_OPDS_URL`
- `CWA_BASE_URL`
- `CWA_USERNAME`
- `CWA_PASSWORD`
- `CWA_TIMEOUT_MS`
