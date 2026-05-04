# Kavita Reader and Progress Contract

`3.4.91` documents the Kavita reader/progress boundary for collectZ. The decision for now is link-out only: collectZ may keep secret-free native Kavita reader links, but it must not embed Kavita's reader, proxy reader pages, stream chapter content, or write reading progress until a later opt-in milestone defines and proves that behavior.

## Source Snapshot

This discovery slice reviewed Kavita's upstream OpenAPI document from `https://raw.githubusercontent.com/Kareadita/Kavita/develop/openapi.json` on 2026-05-04. That document identifies itself as `0.9.0.0` and describes auth-key based API access through the `x-api-key` header.

The relevant reader/progress paths include:

- Read/session visibility: `GET /api/Activity/current`
- Reader content and metadata: `GET /api/Reader/chapter-info`, `GET /api/Reader/image`, `GET /api/Reader/pdf`, `GET /api/Reader/thumbnail`, `GET /api/Reader/file-dimensions`
- Reader navigation: `GET /api/Reader/continue-point`, `GET /api/Reader/next-chapter`, `GET /api/Reader/prev-chapter`
- Progress reads: `GET /api/Reader/get-progress`, `GET /api/Reader/has-progress`, `GET /api/Reader/first-progress-date`, `GET /api/Reader/time-left`, `GET /api/Reader/time-left-for-chapter`, `GET /api/Panels/get-progress`
- Progress writes: `POST /api/Reader/progress`, `POST /api/Reader/mark-read`, `POST /api/Reader/mark-unread`, `POST /api/Reader/mark-chapter-read`, `POST /api/Reader/mark-volume-read`, `POST /api/Panels/save-progress`
- Bookmark and personal reader state: `POST /api/Reader/bookmark`, `POST /api/Reader/unbookmark`, `POST /api/Reader/create-ptoc`, `GET /api/Reader/ptoc`
- KOReader sync: `GET /api/Koreader/{apiKey}/syncs/progress/{ebookHash}`, `PUT /api/Koreader/{apiKey}/syncs/progress`

Some reader metadata endpoints explicitly note side effects in the OpenAPI summaries, including caching chapter or bookmark images for reading. That means collectZ should treat even some `GET` reader endpoints as more than passive metadata reads.

## Current Recommendation

Keep collectZ reader behavior limited to native Kavita web links:

- Existing `kavita_launch_url` values may open Kavita's own web reader in a new tab/window.
- Launch URLs must remain credential-free and must not contain API keys, OPDS keys, bearer tokens, or session tokens.
- The browser session belongs to Kavita. If the user is not signed in to Kavita, Kavita should handle that auth boundary.
- collectZ should continue importing metadata and cover art server-side, but should not fetch reader pages or progress as part of the current import path.

Do not implement embedded reading in this contract:

- Do not iframe Kavita's reader inside collectZ.
- Do not proxy `/api/Reader/image`, `/api/Reader/pdf`, `/api/Reader/thumbnail`, or chapter file content through collectZ.
- Do not create a collectZ reader surface backed by Kavita pages.
- Do not make collectZ responsible for Kavita reader cookies, JWTs, auth keys, or per-user reader sessions.

Do not implement progress sync in this contract:

- Do not call progress write endpoints from collectZ.
- Do not mark Kavita chapters, volumes, or series read/unread from collectZ.
- Do not persist Kavita per-user progress into collectZ rows without a later ownership model.
- Do not use KOReader sync endpoints as a shortcut for collectZ progress sync.

## Security Boundary

Kavita auth keys remain backend-only integration secrets. They may be used by collectZ for server-side read-only metadata and cover import work already covered by prior slices. They must not be sent to the frontend, embedded in URLs, logged in release evidence, or placed in browser-visible reader URLs.

Native launch links are safe only because they use Kavita web routes, not Kavita API-key routes. A future reader/progress milestone must separately define:

- which Kavita user identity is being represented,
- whether progress is read-only or writeback,
- whether any operation is per-space, per-user, or platform-owned,
- how consent, preview, audit, and rollback work,
- how token/cookie handling avoids exposing Kavita credentials to collectZ users who should not have them.

## Future Milestone Shape

A future progress milestone should be small and opt-in. The first viable implementation should prefer read-only progress visibility before any writeback. It should have a fake-Kavita smoke server that proves:

- progress reads do not leak secrets,
- write endpoints are not called unless the milestone explicitly enables writeback,
- progress data is scoped to the signed-in collectZ user or an explicitly configured service identity,
- native launch links still work without collecting Kavita browser credentials.

A future embedded-reader milestone, if accepted at all, should be separate from progress sync and should first prove CORS, auth, content-security-policy, cache, and page-streaming behavior without using real Kavita tokens in browser-visible artifacts.
