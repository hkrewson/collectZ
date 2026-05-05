# Kavita Reader and Progress Contract

`3.4.91` documents the Kavita reader/progress boundary for collectZ. The decision for now is link-out only: collectZ may keep secret-free native Kavita reader links, but it must not embed Kavita's reader, proxy reader pages, stream chapter content, or write reading progress until a later opt-in milestone defines and proves that behavior.

`3.4.100` defines the first progress-sync contract without enabling runtime sync. Read-only progress visibility is the first viable implementation shape; progress writeback, embedded reading, reader page proxying, and KOReader sync remain out of scope.

`3.4.101` implements the first read-only visibility step for Kavita chapter-backed collectZ rows. It adds a scoped collectZ read endpoint and a compact media-detail drawer panel, but still does not write progress, mark items read/unread, embed the Kavita reader, proxy reader pages, or poll in the background.

## Source Snapshot

This discovery slice reviewed Kavita's upstream OpenAPI document from `https://raw.githubusercontent.com/Kareadita/Kavita/develop/openapi.json` on 2026-05-04. That document identifies itself as `0.9.0.0` and describes auth-key based API access through the `x-api-key` header.

The `3.4.100` follow-up rechecked the same upstream OpenAPI document on 2026-05-05. It still identifies as `0.9.0.0`; `GET /api/Reader/get-progress` accepts a `chapterId` query parameter, and `POST /api/Reader/progress` accepts a `ProgressDto` containing `libraryId`, `seriesId`, `volumeId`, `chapterId`, `pageNum`, optional `bookScrollId`, and `lastModifiedUtc`.

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
- Do not call `POST /api/Reader/progress` from collectZ.
- Do not mark Kavita chapters, volumes, or series read/unread from collectZ.
- Do not persist Kavita per-user progress into collectZ rows without a later ownership model.
- Do not use KOReader sync endpoints as a shortcut for collectZ progress sync.

## `3.4.100` Progress Sync Contract

The first progress-sync implementation should be a later, explicit opt-in milestone and should start with read-only progress visibility:

- Read Kavita progress only for Kavita chapter-backed rows where collectZ already has a `kavita:chapter:{chapterId}` provider identity.
- Use the active workspace-owned Kavita connection server-side; Workspace-owned Kavita credentials remain backend-only.
- Treat progress as Kavita-owned state. collectZ may display a readback snapshot, but should not persist it as durable collectZ truth until the ownership model is explicit.
- Keep series-level rows out of progress sync unless a later milestone defines aggregation from child chapter progress.
- Keep chapter-as-issue rows eligible because they already have stable Kavita chapter ids from `3.4.93`.
- Return only normalized readback fields such as `libraryId`, `seriesId`, `volumeId`, `chapterId`, `pageNum`, `bookScrollId`, and `lastModifiedUtc`.
- Never return API keys, bearer tokens, OPDS keys, Kavita session cookies, or browser-usable credential URLs.

The first implementation must not:

- Call `POST /api/Reader/progress`, `POST /api/Reader/mark-read`, `POST /api/Reader/mark-unread`, `POST /api/Reader/mark-chapter-read`, `POST /api/Reader/mark-volume-read`, or `POST /api/Panels/save-progress`.
- Use `GET /api/Koreader/{apiKey}/syncs/progress/{ebookHash}` or `PUT /api/Koreader/{apiKey}/syncs/progress` as a collectZ shortcut.
- Open, proxy, cache, or stream reader pages.
- Add background polling or bidirectional sync.
- Infer a collectZ user's Kavita identity from a workspace service key without explicit product copy.

### Probe Evidence

`3.4.100` adds `npm run test:kavita-progress-contract-probe`, which uses a fake Kavita-compatible progress server to prove the contract shape:

- The only fake-server request is `GET /api/Reader/get-progress?chapterId=9702`.
- The probe marks progress sync implementation as disabled.
- Known write endpoints are enumerated as prohibited.
- Normalized readback excludes injected secret-like fields.
- No native reader, page proxy, or progress write endpoint is exercised.

`3.4.101` extends the running-stack Kavita import/sync smoke with a fake Kavita progress readback. The smoke imports chapter-as-issue rows, calls the collectZ media progress endpoint for the linked chapter row, verifies the only Kavita progress call is read-only, and confirms API-key/bearer-token fixture values are excluded from the browser-visible response.

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
