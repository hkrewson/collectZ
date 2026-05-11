# Kavita Chapter-as-Issue Fan-out Contract

`3.4.92` defines how collectZ should eventually import selected Kavita comic/manga chapters as individual `comic_book` rows. `3.4.93` implements the first opt-in import behavior. `3.4.154` defaults the admin import control toward chapter rows and includes special chapters when Kavita provides usable chapter metadata.

## Recommendation

Chapter fan-out is comic-only. API callers still opt in through `chapterFanout=true`; the admin Kavita import checkbox defaults on so comic imports do not quietly stop at series-level rows.

Do not auto-expand books or unknown Kavita libraries into issues by default. Kavita libraries often include manga volumes, omnibus files, specials, and book-like archives where a chapter row is not always the right collectZ object.

## Identity Model

Keep series-level and chapter-level provider identities distinct:

- Series row: `provider_item_id = kavita:series:{seriesId}`
- Chapter/issue row: `provider_item_id = kavita:chapter:{chapterId}`

Chapter rows should also retain parent linkage in `type_details`:

- `provider_name = kavita`
- `kavita_series_id`
- `kavita_chapter_id`
- `kavita_volume_id`
- `kavita_library_id`
- `kavita_parent_provider_item_id = kavita:series:{seriesId}`
- `kavita_series_provider_item_id = kavita:series:{seriesId}`
- `kavita_chapter_provider_item_id = kavita:chapter:{chapterId}`

The provider identity must be the strongest repeat-sync key. A chapter row must never reuse the series provider id, and a series row must never be converted into a chapter row.

## Fan-out Eligibility

The fan-out implementation includes a Kavita chapter only when all of these are true:

- The parent library resolves to collectZ `comic_book` through Kavita library type `comic` or `manga`; observed numeric Kavita library types `1` and `5` normalize to `comic`.
- The parent series has volume/chapter detail loaded from `/api/Series/volumes`.
- The chapter has a stable numeric Kavita chapter id.
- The chapter has enough display metadata to form a useful row: issue number, title, release date, page count, or sort/order metadata.

Books, EPUB/PDF-only libraries, and unknown library types should keep series-level import only until a separate contract says otherwise.

## Row Mapping

For an eligible chapter, collectZ should map:

- `media_type = comic_book`
- `title` from chapter title when useful, otherwise the parent series title plus issue/chapter number
- `format = Digital`
- `series` from the parent Kavita series title
- `issue_number` from Kavita chapter number/range
- `volume` from Kavita volume number
- `cover_date` / `release_date` from chapter release date when present
- `page_count` / `kavita_first_chapter_pages` style metadata from chapter pages when present
- `external_url`, `kavita_launch_url`, and `provider_external_url` as secret-free native Kavita reader links for that chapter
- `poster_path` through the collectZ Kavita chapter-cover proxy when a chapter id is available, using Kavita reader page `0` as the issue/title cover
- parent series cover metadata remains available as fallback/provider context, but chapter rows should not intentionally repeat the series cover when a chapter image can be proxied

The parent series row can remain useful as a series/collection-level record. Fan-out should not require deleting or hiding that row.

## Duplicate and Preservation Rules

Repeat sync must first match by `provider_name = kavita` plus `provider_item_id = kavita:chapter:{chapterId}`. If a matching row exists, update only missing or Kavita-owned fields and preserve local user edits.

When no provider match exists, the implementation is conservative about attaching to an existing non-Kavita comic row. It may reuse an existing local row only when existing duplicate guardrails consider the match high-confidence for the same comic issue. Otherwise it creates a new Kavita-backed row or queues the match for review through the existing import diagnostics.

Never overwrite these local fields from fan-out data without an explicit merge/write policy:

- user notes
- ownership status
- local purchase/provenance fields
- signature/proof metadata
- manually curated cover art
- non-Kavita provider identifiers

## Smoke Plan

The implementation milestone extends the fake Kavita import smoke with a comic/manga library containing one series and multiple chapters.

The smoke should prove:

- Admin Kavita import defaults to importing comic chapters as issue rows.
- Fan-out import creates chapter rows with `provider_item_id` values such as `kavita:chapter:9702`.
- The parent series row keeps `provider_item_id = kavita:series:8602`.
- Repeat fan-out sync reports no duplicate creation.
- Existing non-Kavita/local comic issue metadata is preserved when a high-confidence match is reused.
- Book libraries do not fan out into comic issue rows.
- Special chapters import as issue rows when they have a stable chapter id and display/order metadata.
- Launch URLs and cover proxy URLs remain credential-free.
- No reader/progress endpoints are called as part of fan-out.

## Non-goals

This contract and implementation do not add embedded reading, reader page proxying, progress sync, metadata writeback, per-space Kavita administration, or a shared provider abstraction.
