# Kavita Integration Setup

`3.4.85` added the first read-only Kavita connection foundation. Later Kavita slices add import/sync, metadata mapping, volume/chapter enrichment, secret-free launch links back to Kavita's native web UI, a documented reader/progress boundary, chapter-as-issue fan-out, workspace-owned administration, and metadata writeback.

## Requirements

- A reachable Kavita base URL, such as `https://kavita.example`.
- A Kavita API key/auth key for the user collectZ should authenticate as.
- Network access from the collectZ backend container to the Kavita host.

## Configuration

1. Open `Workspace` -> `Integrations` -> `Kavita` for the active workspace.
2. Enter the Kavita URL.
3. Enter the API key.
4. Keep the default timeout unless the Kavita host is slow through a reverse proxy.
5. Save the settings.
6. Run `Test`.

The workspace settings API stores the API key encrypted and only returns whether a key is set plus a masked value. The raw key is not returned in settings responses. Legacy platform-level Kavita settings may still exist as compatibility data, but workspace imports and cover proxy reads use the active workspace's Kavita connection.

## What The Test Proves

The connection test uses Kavita's native API path:

- `POST /api/Plugin/authenticate`
- `GET /api/Library/libraries`
- `POST /api/Series/all-v2`

A passing test means collectZ can authenticate, read the library list, sample series, and build Kavita link-out URLs.

## Import and Launch Links

Kavita imports are read-only. Imported rows keep Kavita provider identity, Kavita cover source metadata, and, when volume/chapter detail is available, a launch URL back into Kavita.

Cover art uses a collectZ-authenticated proxy URL:

- collectZ cover proxy: `/api/media/kavita-cover/{seriesId}`
- Kavita source path metadata: `kavita_cover_image`
- Kavita source URL metadata: `kavita_cover_url`
- readback status metadata: `kavita_cover_source` and `kavita_cover_status`

The proxy only serves covers for Kavita rows visible in the active collectZ scope, then fetches the Kavita image server-side using the stored integration credentials.

Launch links remain native Kavita web URLs:

- Series detail fallback: `/library/{libraryId}/series/{seriesId}`
- Comic/manga/image/archive reader: `/library/{libraryId}/series/{seriesId}/manga/{chapterId}`
- EPUB reader: `/library/{libraryId}/series/{seriesId}/book/{chapterId}`
- PDF reader: `/library/{libraryId}/series/{seriesId}/pdf/{chapterId}`

Cover proxy URLs and launch URLs must not include API keys, OPDS keys, bearer tokens, or any other credential. Users still authenticate with Kavita in Kavita's own browser session for native reader launches.

## Chapter-as-Issue Fan-out

Kavita imports keep the parent series row and can also import comic/manga chapters as individual `comic_book` issue rows. `docs/wiki/43-Kavita-Chapter-Issue-Fanout-Contract.md` defines and `3.4.93` implements the fan-out shape; `3.4.154` makes the admin import control default to chapter issue rows so comic imports do not quietly stop at series-level rows.

To fan out eligible comic/manga chapters, send `chapterFanout=true` to `POST /api/media/import-kavita` or leave the admin Kavita import checkbox enabled before queueing the import. Book libraries and unknown library types stay series-level. Comic special chapters import as issue rows when Kavita provides a stable chapter id and at least one display/order signal.

The identity boundary is:

- Series row: `provider_item_id = kavita:series:{seriesId}`
- Chapter row: `provider_item_id = kavita:chapter:{chapterId}`

Fan-out preserves the parent series row and keeps repeat sync idempotent. It does not call Kavita reader/progress endpoints.

## Current Boundaries

`docs/wiki/44-Kavita-Workspace-Owned-Administration-Contract.md` defines the administration model: Kavita is owned by the active workspace, with workspace admins controlling save/test/import/clear for their workspace only. `3.4.95` implements that first workspace-owned administration path.

`docs/wiki/45-Kavita-Metadata-Writeback-Contract.md` defines the metadata writeback boundary. `3.4.96` confirms Kavita exposes native series/chapter metadata mutation endpoints, `3.4.97` adds preview/diff readback, `3.4.98` adds explicit manual apply, and `3.4.99` adds field-level apply selection.

The Kavita reader/progress boundary remains conservative. collectZ may manually write selected metadata fields after preview, but it does not embed the Kavita reader, proxy reader pages, write reading progress, enable chapter-as-issue fan-out by default, or create a shared Calibre/CWA/Kavita provider abstraction. The cover proxy is only for imported cover images and does not expose reader content.

Those are intentionally later milestones so the connection/auth contract can settle first. See `docs/wiki/42-Kavita-Reader-Progress-Contract.md` for the current reader/progress recommendation: link out to Kavita's native reader, do not iframe or proxy reader pages, and use read-only progress visibility before any later opt-in writeback.

## Troubleshooting

- `Kavita base URL is not configured`: save a non-empty URL in the Kavita integration settings.
- `Kavita API key is not configured`: enter a Kavita API key and save again.
- `Kavita rejected the configured API key`: generate a fresh key in Kavita and save it in collectZ.
- Timeout or connection errors: verify the backend container can reach the Kavita URL, including reverse proxy hostnames and ports.
