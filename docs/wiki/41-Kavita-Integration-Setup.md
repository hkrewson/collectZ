# Kavita Integration Setup

`3.4.85` added the first read-only Kavita connection foundation. Later Kavita slices add import/sync, metadata mapping, volume/chapter enrichment, and secret-free launch links back to Kavita's native web UI.

## Requirements

- A reachable Kavita base URL, such as `https://kavita.example`.
- A Kavita API key/auth key for the user collectZ should authenticate as.
- Network access from the collectZ backend container to the Kavita host.

## Configuration

1. Open `Admin` -> `Integrations` -> `Kavita`.
2. Enter the Kavita URL.
3. Enter the API key.
4. Keep the default timeout unless the Kavita host is slow through a reverse proxy.
5. Save the settings.
6. Run `Test`.

The settings API stores the API key encrypted and only returns whether a key is set plus a masked value. The raw key is not returned in settings responses.

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

## Current Boundaries

The Kavita integration remains read-only. It does not push metadata into Kavita, embed the Kavita reader, proxy reader pages, write reading progress, or create a shared Calibre/CWA/Kavita provider abstraction. The cover proxy is only for imported cover images and does not expose reader content.

Those are intentionally later milestones so the connection/auth contract can settle first.

## Troubleshooting

- `Kavita base URL is not configured`: save a non-empty URL in the Kavita integration settings.
- `Kavita API key is not configured`: enter a Kavita API key and save again.
- `Kavita rejected the configured API key`: generate a fresh key in Kavita and save it in collectZ.
- Timeout or connection errors: verify the backend container can reach the Kavita URL, including reverse proxy hostnames and ports.
