# Kavita Reader and Progress Contract

`3.4.91` documents the Kavita reader/progress boundary for collectZ. The decision for now is link-out only: collectZ may keep secret-free native Kavita reader links, but it must not embed Kavita's reader, proxy reader pages, stream chapter content, or write reading progress until a later opt-in milestone defines and proves that behavior.

`3.4.100` defines the first progress-sync contract without enabling runtime sync. Read-only progress visibility is the first viable implementation shape; progress writeback, embedded reading, reader page proxying, and KOReader sync remain out of scope.

`3.4.101` implements the first read-only visibility step for Kavita chapter-backed collectZ rows. It adds a scoped collectZ read endpoint and a compact media-detail drawer panel, but still does not write progress, mark items read/unread, embed the Kavita reader, proxy reader pages, or poll in the background.

`3.4.102` implements the first opt-in progress writeback and page-proxy reader slice. collectZ may save an explicitly selected page number to Kavita through `POST /api/Reader/progress`, and it may proxy `/api/Reader/image` for a single authenticated chapter page so Kavita credentials remain server-side. This does not approve iframe embedding, background polling, automatic progress writes, KOReader sync shortcuts, raw file downloads, or broad in-app reader/session ownership.

`3.4.103` defines the mark read/unread contract without enabling runtime mark actions. The first viable future implementation candidate is a chapter-scoped mark-read action against `POST /api/Reader/mark-chapter-read`; series-wide mark read/unread, volume-wide mark read, panel save-progress, KOReader sync, automatic read-state updates, and any claim of per-user Kavita identity remain out of scope.

`3.4.104` implements explicit chapter mark-read for Kavita chapter-backed collectZ rows. collectZ may call `POST /api/Reader/mark-chapter-read` after a signed-in workspace admin explicitly clicks `Mark Read in Kavita`. Series-wide mark read/unread, volume-wide mark read, panel save-progress, KOReader sync, automatic read-state updates, and chapter-level mark-unread remain out of scope.

`3.4.105` defines the chapter unread/read-state reversal contract without enabling runtime unread behavior. The checked Kavita OpenAPI still exposes no chapter-level mark-unread endpoint; collectZ must not use series, volume, multiple-volume, multiple-series, panel, or KOReader unread/progress endpoints as a shortcut. Resetting progress to page `0` remains discovery-only and must not be presented as true unread until proven against Kavita runtime behavior.

`3.4.106` proves the reset-progress probe shape without exposing runtime reset or unread behavior. The fake Kavita-compatible runtime now accepts only a probe-only reset-progress payload through `POST /api/Reader/progress` with `pageNum: 0` and `bookScrollId: null`, confirms browser-visible readback stays secret-free, and confirms no bulk unread endpoint is called. This still does not prove true unread semantics against a real Kavita runtime, so no collectZ route or UI control is added.

`3.4.107` enables explicit reset-progress runtime behavior for Kavita chapter-backed collectZ rows. collectZ may call `POST /api/Reader/progress` with `pageNum: 0` and `bookScrollId: null` only after a signed-in workspace admin explicitly clicks `Reset Progress`. This remains distinct from chapter-level mark-unread: Kavita's checked OpenAPI still exposes no chapter-level mark-unread endpoint, and collectZ still must not call series, volume, multiple-volume, multiple-series, panel, or KOReader unread/progress endpoints as a shortcut.

## Source Snapshot

This discovery slice reviewed Kavita's upstream OpenAPI document from `https://raw.githubusercontent.com/Kareadita/Kavita/develop/openapi.json` on 2026-05-04. That document identifies itself as `0.9.0.0` and describes auth-key based API access through the `x-api-key` header.

The `3.4.100` follow-up rechecked the same upstream OpenAPI document on 2026-05-05. It still identifies as `0.9.0.0`; `GET /api/Reader/get-progress` accepts a `chapterId` query parameter, and `POST /api/Reader/progress` accepts a `ProgressDto` containing `libraryId`, `seriesId`, `volumeId`, `chapterId`, `pageNum`, optional `bookScrollId`, and `lastModifiedUtc`.

The `3.4.103` follow-up rechecked the upstream OpenAPI document on 2026-05-06. It still identifies as `0.9.0.0`; `POST /api/Reader/mark-read` and `POST /api/Reader/mark-unread` use `MarkReadDto` with `seriesId` and `generateReadingSession`, `POST /api/Reader/mark-chapter-read` uses `MarkChapterReadDto` with `seriesId`, `chapterId`, and `generateReadingSession`, and `POST /api/Reader/mark-volume-read` uses `MarkVolumeReadDto` with `seriesId`, `volumeId`, and `generateReadingSession`. The checked OpenAPI snapshot does not expose a chapter-level mark-unread endpoint.

The `3.4.105` follow-up rechecked the upstream OpenAPI document on 2026-05-06. It still identifies as `0.9.0.0`; the unread-capable endpoints are bulk mutations: `POST /api/Reader/mark-unread` for a series, `POST /api/Reader/mark-volume-unread` for a whole volume, `POST /api/Reader/mark-multiple-unread` for multiple volumes, and `POST /api/Reader/mark-multiple-series-unread` for multiple series. No chapter-level mark-unread endpoint is present in the checked snapshot.

The relevant reader/progress paths include:

- Read/session visibility: `GET /api/Activity/current`
- Reader content and metadata: `GET /api/Reader/chapter-info`, `GET /api/Reader/image`, `GET /api/Reader/pdf`, `GET /api/Reader/thumbnail`, `GET /api/Reader/file-dimensions`
- Reader navigation: `GET /api/Reader/continue-point`, `GET /api/Reader/next-chapter`, `GET /api/Reader/prev-chapter`
- Progress reads: `GET /api/Reader/get-progress`, `GET /api/Reader/has-progress`, `GET /api/Reader/first-progress-date`, `GET /api/Reader/time-left`, `GET /api/Reader/time-left-for-chapter`, `GET /api/Panels/get-progress`
- Progress writes: `POST /api/Reader/progress`, `POST /api/Reader/mark-read`, `POST /api/Reader/mark-unread`, `POST /api/Reader/mark-chapter-read`, `POST /api/Reader/mark-volume-read`, `POST /api/Reader/mark-volume-unread`, `POST /api/Reader/mark-multiple-unread`, `POST /api/Reader/mark-multiple-series-unread`, `POST /api/Panels/save-progress`
- Bookmark and personal reader state: `POST /api/Reader/bookmark`, `POST /api/Reader/unbookmark`, `POST /api/Reader/create-ptoc`, `GET /api/Reader/ptoc`
- KOReader sync: `GET /api/Koreader/{apiKey}/syncs/progress/{ebookHash}`, `PUT /api/Koreader/{apiKey}/syncs/progress`

Some reader metadata endpoints explicitly note side effects in the OpenAPI summaries, including caching chapter or bookmark images for reading. That means collectZ should treat even some `GET` reader endpoints as more than passive metadata reads.

## Current Recommendation

Keep collectZ reader behavior limited to native Kavita web links plus the explicitly scoped `3.4.102` page/progress actions:

- Existing `kavita_launch_url` values may open Kavita's own web reader in a new tab/window.
- Launch URLs must remain credential-free and must not contain API keys, OPDS keys, bearer tokens, or session tokens.
- The browser session belongs to Kavita. If the user is not signed in to Kavita, Kavita should handle that auth boundary.
- collectZ should continue importing metadata and cover art server-side, but should not fetch reader pages or write progress as part of the import path.

Do not implement iframe-based embedded reading in this contract:

- Do not iframe Kavita's reader inside collectZ.
- Starting in `3.4.102`, collectZ may proxy `/api/Reader/image` for a single authenticated chapter page when the signed-in collectZ user can access the linked chapter-backed row.
- Do not proxy `/api/Reader/pdf`, `/api/Reader/thumbnail`, raw chapter files, or whole-reader sessions through collectZ.
- Do not create a full collectZ reader shell that replaces Kavita's reader controls until a later reader milestone defines cache, navigation, and session ownership.
- Do not make collectZ responsible for Kavita reader cookies, JWTs, auth keys, or per-user reader sessions.

Do not implement automatic progress sync in this contract:

- Starting in `3.4.102`, collectZ may call `POST /api/Reader/progress` after an explicit signed-in user action on a linked chapter-backed row.
- Progress writeback requires an explicit user action, scoped media access, and backend-only workspace Kavita credentials.
- Do not mark Kavita chapters, volumes, or series read/unread from collectZ until a later milestone defines that behavior.
- Do not persist Kavita per-user progress into collectZ rows without a later ownership model.
- Do not use KOReader sync endpoints as a shortcut for collectZ progress sync.

Keep mark read/write behavior narrow in this contract:

- Starting in `3.4.104`, chapter mark-read is enabled only for explicit user action on a Kavita chapter-backed collectZ row.
- Treat `POST /api/Reader/mark-read` and `POST /api/Reader/mark-unread` as series-wide bulk mutations because Kavita marks all volumes and chapters in the series.
- Treat `POST /api/Reader/mark-volume-read` as a bulk volume mutation because it marks every chapter in the volume.
- Do not call series-wide or volume-wide read-state endpoints from collectZ.
- Do not add chapter-level mark-unread until a later milestone defines how to handle Kavita's missing chapter-level mark-unread endpoint.
- Do not call volume, multiple-volume, or multiple-series unread endpoints as a workaround for a single collectZ chapter row.
- Do not label page `0` progress as unread unless a later runtime proof demonstrates that Kavita treats it as true unread.
- `3.4.106` proves only the collectZ/fake-Kavita reset-progress probe payload shape for page `0`; it does not prove that real Kavita treats page `0` as unread.
- Starting in `3.4.107`, page `0` progress may be written only as explicit `Reset Progress` behavior, not as `Mark unread`.
- Do not add automatic read-state writes from page navigation, import/sync, progress readback, or progress save.
- Do not claim this is per-collectZ-user state until a later milestone defines Kavita user identity instead of relying only on the workspace-owned service account.

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

- Call mark-read/mark-unread endpoints, `POST /api/Panels/save-progress`, or KOReader sync endpoints.
- Use `GET /api/Koreader/{apiKey}/syncs/progress/{ebookHash}` or `PUT /api/Koreader/{apiKey}/syncs/progress` as a collectZ shortcut.
- Open, proxy, cache, or stream broad reader sessions.
- Add background polling or bidirectional sync.
- Infer a collectZ user's Kavita identity from a workspace service key without explicit product copy.

## `3.4.102` Progress Writeback and Page Proxy Slice

This slice keeps the chapter-as-issue row boundary from `3.4.93` and the read-only progress visibility from `3.4.101`, then adds two explicit actions:

- `POST /api/media/:id/kavita-progress` writes a selected `pageNum` to Kavita through `POST /api/Reader/progress`.
- `GET /api/media/:id/kavita-reader-info` and `GET /api/media/:id/kavita-reader-page?page=N` read chapter metadata and proxy one Kavita reader image page.

Security and UX boundaries:

- Only signed-in users who can access the scoped media row can use these endpoints.
- The row must be Kavita chapter-backed; series-level rows remain out of scope.
- Kavita API keys and bearer tokens are used only server-side and are never returned to the browser.
- Reader page proxying is per-page and short-cache only.
- The drawer UI exposes explicit `Load Page` and `Save Progress` actions; it does not autosave on page navigation.
- Mark read/unread, full embedded reader controls, PDF/raw file proxying, background polling, and shared progress abstractions remain future work.

## `3.4.103` Mark Read/Unread Contract

This slice documents and proves the read-state boundary before any runtime implementation:

- Series-level `POST /api/Reader/mark-read` and `POST /api/Reader/mark-unread` are disabled because they mutate every volume and chapter in the Kavita series.
- Volume-level `POST /api/Reader/mark-volume-read` is disabled because it mutates every chapter in the volume.
- `POST /api/Reader/mark-chapter-read` is documented as the only first-candidate future endpoint because collectZ chapter-as-issue rows already carry stable `seriesId` and `chapterId` values.
- The first future implementation should require an explicit user action, workspace-admin permission matching progress writeback, backend-only Kavita credentials, audit logging, and secret-free readback copy.
- The checked Kavita OpenAPI snapshot does not expose a chapter-level mark-unread endpoint, so unread behavior needs separate design instead of pretending it mirrors chapter mark-read.
- No runtime route, drawer control, import/sync path, or background job calls a Kavita mark endpoint in this slice.

## `3.4.104` Chapter Mark-Read Implementation

This slice enables the narrow first runtime read-state action defined by `3.4.103`:

- `POST /api/media/:id/kavita-read-state` calls Kavita `POST /api/Reader/mark-chapter-read`.
- The target media row must be Kavita chapter-backed and scoped to the signed-in collectZ user's active workspace/library.
- The action requires workspace-admin access, explicit `confirm: true`, backend-only Kavita credentials, and audit logging.
- Browser-visible responses include only the collectZ media row, action name, target `seriesId`/`chapterId`, and `generateReadingSession`; they never include Kavita API keys, bearer tokens, OPDS keys, or Kavita file names.
- The drawer UI exposes a `Mark Read in Kavita` button beside the explicit page/progress controls.
- The action does not write collectZ-owned read state, does not infer a collectZ user's Kavita identity, and does not call series-wide, volume-wide, panel, KOReader, or mark-unread endpoints.

## `3.4.105` Chapter Unread / Read-State Reversal Contract

This slice answers the immediate reversal question created by `3.4.104` without enabling a runtime unread action:

- Kavita's checked OpenAPI snapshot does not expose `POST /api/Reader/mark-chapter-unread` or another chapter-scoped unread endpoint.
- Series unread, volume unread, multiple-volume unread, and multiple-series unread endpoints are bulk mutations and remain prohibited for collectZ chapter rows.
- `POST /api/Reader/progress` with `pageNum: 0` is a reset-progress candidate. Starting in `3.4.107`, collectZ may call it only as `Reset Progress`, not as `Mark unread`.
- `POST /api/Panels/save-progress` and KOReader progress sync remain prohibited shortcuts.
- No route, UI control, import/sync path, or background job performs unread/read-state reversal in this slice.
- Future implementation copy should distinguish `Reset Kavita progress` from `Mark unread` unless Kavita provides or proves a true chapter-unread semantic.

## `3.4.106` Reset Progress Runtime Proof

This slice turns the `3.4.105` reset-progress candidate into a probe-only runtime proof:

- The probe sends `POST /api/Reader/progress` with the same scoped chapter payload collectZ already uses for progress writeback, but with `pageNum: 0` and `bookScrollId: null`.
- The fake Kavita-compatible runtime accepts only that reset-progress probe shape and returns normalized readback with `pageNum: 0`.
- The probe confirms no series, volume, multiple-volume, multiple-series, panel, or KOReader unread/progress endpoint is called.
- Browser-visible probe output remains secret-free even when the fake runtime injects secret-like fields.
- No `kavita-reset-progress` route, drawer control, import/sync path, background job, or `Reset Kavita progress` UI copy is added in this slice.
- Real Kavita unread semantics remain unverified. Future product copy should continue to say reset progress, not mark unread, unless a real Kavita runtime proves true chapter-unread behavior.

## `3.4.107` Runtime Reset Progress Implementation

This slice turns the reset-progress proof into a narrow runtime action:

- `POST /api/media/:id/kavita-reset-progress` calls Kavita `POST /api/Reader/progress` with page `0` and `bookScrollId: null`.
- The action is workspace-admin gated and requires an explicit confirmation payload.
- The media detail drawer labels the action `Reset Progress`, not `Mark Unread`.
- The response includes a caveat that Kavita exposes no chapter-level mark-unread endpoint.
- The running-stack smoke proves the action writes page `0`, returns secret-free readback, and does not call series, volume, multiple-volume, multiple-series, panel, or KOReader unread/progress endpoints.
- Chapter-level mark-read remains the only read-state endpoint collectZ calls; reset progress remains a progress write, not a true unread claim.

### Probe Evidence

`3.4.100` added `npm run test:kavita-progress-contract-probe`, which uses a fake Kavita-compatible progress server to prove the progress contract shape. In `3.4.102`, the probe reflects the opt-in writeback contract:

- The only fake-server request is `GET /api/Reader/get-progress?chapterId=9702`.
- The probe marks explicit progress sync implementation as enabled.
- `POST /api/Reader/progress` is the only enabled write endpoint.
- Mark-read/mark-unread, panel save-progress, and KOReader sync endpoints are enumerated as prohibited.
- The write payload helper requires library, series, volume, chapter, and page fields.
- `3.4.103` extends the probe with read-state contract evidence. `3.4.104` updates that evidence so `POST /api/Reader/mark-chapter-read` is enabled, while series-wide, volume-wide, panel, KOReader, and mark-unread endpoints remain disabled. `3.4.105` adds unread/reversal evidence: no chapter-unread endpoint is available, bulk unread endpoints stay prohibited, and progress page `0` remains a reset-progress candidate. `3.4.106` adds a probe-only `pageNum: 0` write against the fake Kavita-compatible runtime and proves no bulk unread endpoint is called. `3.4.107` enables the same page `0` write as an explicit reset-progress action while continuing to prohibit bulk unread endpoints and `Mark unread` copy.
- Normalized readback excludes injected secret-like fields.
- No mark-read, KOReader, PDF, raw file, or broad reader endpoint is exercised.

`3.4.101` extended the running-stack Kavita import/sync smoke with a fake Kavita progress readback. `3.4.102` extends it again with explicit progress writeback, chapter-info, and page-image calls, while confirming API-key/bearer-token fixture values are excluded from browser-visible responses. `3.4.104` adds a fake Kavita chapter mark-read call and proves no bulk read-state endpoint is called.

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
