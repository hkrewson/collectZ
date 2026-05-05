# Kavita Metadata Writeback Contract

`3.4.96` confirms Kavita has native metadata mutation endpoints that collectZ can target later, but keeps collectZ writeback disabled until a separate implementation milestone adds UI review, audit logging, and explicit workspace opt-in.

## Decision

Kavita metadata writeback is viable, but it should be narrow, preview-first, and manually initiated. collectZ should not run automatic bidirectional sync and should not push enrichment from third-party providers back into Kavita without user review.

## Writable Endpoints

The first supported writeback candidates are:

- Series metadata: `POST /api/Series/metadata`
- Chapter metadata: `POST /api/Chapter/update`

The series endpoint expects a `seriesMetadata` wrapper with `seriesId`. The chapter endpoint expects the chapter `id` at the top level.

## First Field Set

Start with low-risk descriptive fields that collectZ already reads or can display clearly in a diff.

Series fields:

- `summary`
- `genres`
- `tags`
- `writers`
- `publishers`
- `releaseYear`
- `language`
- `webLinks`

Chapter fields:

- `summary`
- `genres`
- `tags`
- `writers`
- `publishers`
- `isbn`
- `releaseDate`
- `titleName`
- `webLinks`

Cover images, page files, reading progress, bookmarks, library membership, series matching, and file organization are out of scope for this contract.

## Safety Requirements

- Writeback is disabled by default and must be explicitly enabled for a workspace-owned Kavita connection.
- The UI must read current Kavita metadata before writeback and show a field-level preview diff.
- The user must select the exact fields to push.
- Locked Kavita fields are skipped unless a later milestone adds an explicit override flow.
- Every attempted writeback must produce an audit event with workspace, media row, Kavita target id, selected fields, skipped fields, and outcome.
- Kavita credentials remain backend-only secrets and must never appear in preview JSON, logs, release evidence, or browser-visible URLs.
- A failed writeback must not update local collectZ metadata as if Kavita accepted the change.

## Implementation Boundary

This contract only adds payload builders and a fake-server probe. It does not add a user-facing writeback action, does not call a real Kavita server's mutation endpoints, and does not create a background sync job.

The next implementation slice should add a workspace-admin-only preview endpoint first, then a separate apply endpoint after the preview/audit shape is proven.

## Non-Goals

- Automatic bidirectional metadata sync.
- Embedded reader, reader page proxying, bookmark sync, or reading-progress writeback.
- Writing Metron, Google Books, Open Library, or other external enrichment directly into Kavita without user review.
- A shared Calibre/CWA/Kavita writeback abstraction.
