# Kavita Integration Setup

`3.4.85` adds the first read-only Kavita connection foundation. It is intentionally limited to connection setup and native API readback.

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

## Current Boundaries

This foundation does not import or sync Kavita books/comics into collectZ yet. It also does not push metadata into Kavita, embed the Kavita reader, write reading progress, or create a shared Calibre/CWA/Kavita provider abstraction.

Those are intentionally later milestones so the connection/auth contract can settle first.

## Troubleshooting

- `Kavita base URL is not configured`: save a non-empty URL in the Kavita integration settings.
- `Kavita API key is not configured`: enter a Kavita API key and save again.
- `Kavita rejected the configured API key`: generate a fresh key in Kavita and save it in collectZ.
- Timeout or connection errors: verify the backend container can reach the Kavita URL, including reverse proxy hostnames and ports.
