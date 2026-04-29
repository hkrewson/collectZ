# collectZ Apple/Platform App Canonical Model Boundaries

Date: 2026-04-28
Source of truth inspected: current backend SQL schema, OpenAPI, media/event/art/collectibles routes, identity/enrichment helpers, and 3.4.31 personal Sched ICS sync work.

This is written for SwiftData/local-model planning from the current product, not an ideal future architecture.

## Core Entities

### Workspace Scope

#### Space
Current backend table: `spaces`.

A space is the tenancy/workspace boundary in platform mode. In homelab mode it is mostly hidden by the edition boundary, but it still exists in the backend. Apple local models should keep `spaceId` nullable on synced objects, even if the first platform app mostly behaves as single-space.

Canonical fields to carry locally:

```json
{
  "id": 1,
  "name": "Personal Space",
  "role": "admin",
  "status": "active"
}
```

#### Library
Current backend table: `libraries`.

A library scopes media, art, collectibles, collections, and events. Treat it as a real top-level container. Local objects should keep `libraryId`.

Do not flatten library into item type. A movie and a book are both media rows, but both still belong to a library.

### Media Item
Current backend table: `media`.

This is the canonical object for movies, TV, books, comics, games, and audio. The product currently uses one media table with `media_type`, not separate tables per media kind.

Current `media_type` values:

```text
movie, tv_series, tv_episode, book, audio, game, comic_book
```

SwiftData guidance:

- Use one `LibraryItem`/`MediaItem` model with `mediaType` enum.
- Put type-specific fields either in optional columns or a `typeDetails` value object.
- Avoid creating separate root SwiftData entities for movie/book/comic/game/audio unless the UI needs projections.

Important current fields:

```json
{
  "id": 2561,
  "title": "Whitecoats",
  "media_type": "movie",
  "original_title": "Intern Academy",
  "release_date": "2004-09-10",
  "year": 2004,
  "format": "Digital",
  "owned_formats": ["digital"],
  "genre": null,
  "director": "Dave Thomas",
  "cast": "...",
  "rating": null,
  "user_rating": null,
  "tmdb_id": 55922,
  "tmdb_media_type": "movie",
  "tmdb_url": "https://www.themoviedb.org/movie/55922",
  "poster_path": "/a6YQiS6nseTBsENp93r6mbfjSvc.jpg",
  "backdrop_path": "/3YTH3XzxwD7AiMe1tKyyytsxnq8.jpg",
  "overview": "Follows the misadventures...",
  "runtime": 99,
  "upc": null,
  "location": null,
  "notes": "Imported from Plex section 1",
  "type_details": { "edition": "Digital" },
  "library_id": 7,
  "space_id": 1,
  "import_source": "plex"
}
```

### Type Details
Current backend field: `media.type_details JSONB`.

This is the canonical storage for type-specific metadata that does not deserve a top-level column yet.

Allowed current keys by type:

```json
{
  "movie": ["edition", "provider_name", "provider_item_id", "provider_external_url"],
  "tv_series": [],
  "tv_episode": [],
  "book": ["author", "isbn", "publisher", "edition", "provider_name", "provider_item_id", "provider_external_url", "provider_download_url", "calibre_entry_id", "calibre_external_url", "calibre_download_url", "source_updated_at"],
  "audio": ["artist", "album", "track_count"],
  "game": ["platform", "developer", "region", "provider_name", "provider_item_id", "provider_external_url"],
  "comic_book": ["author", "isbn", "publisher", "edition", "series", "issue_number", "volume", "writer", "artist", "inker", "colorist", "cover_date", "provider_issue_id", "provider_name", "provider_item_id", "provider_external_url", "provider_download_url", "calibre_entry_id", "calibre_external_url", "calibre_download_url", "source_updated_at"]
}
```

SwiftData guidance:

- Model common fields as explicit columns.
- Model type-specific fields as an embedded value object or normalized sidecar entity.
- Preserve unknown future keys only if the app is intended to round-trip backend data.

### Media Metadata / External Identity
Current backend table: `media_metadata`.

This is a key/value sidecar for provider IDs and import identity aliases.

Current meaningful keys include:

```text
isbn, ean_upc, ean, upc, asin, amazon_item_id,
plex_guid, plex_item_key, plex_section_id,
provider_item_id, calibre_entry_id, metron_issue_id,
identity_alias:provider_item_id:..., identity_alias:calibre_entry_id:..., identity_alias:provider_issue_id:..., identity_alias:plex_guid:..., identity_alias:plex_item_key:..., identity_alias:isbn:..., identity_alias:ean_upc:..., identity_alias:amazon_item_id:...
```

SwiftData guidance:

- Create a real `ExternalIdentity` entity.
- Relationship: `MediaItem 1 -> many ExternalIdentity`.
- Do not store every provider identifier only in random item fields.
- Keep `tmdb_id` top-level because the backend does; also mirror it as an external identity if useful for unified local lookup.

Example:

```json
{
  "ownerType": "media",
  "ownerId": 2561,
  "source": "tmdb",
  "kind": "tmdb_id",
  "value": "55922",
  "isPrimary": true,
  "confidence": "high"
}
```

### Media Variant
Current backend table: `media_variants`.

This is edition/file-level detail, primarily from Plex. It is not the canonical media item.

Relationship: `MediaItem 1 -> many MediaVariant`.

SwiftData guidance:

- Keep variants separate from the item.
- Do not make file path, codec, resolution, or Plex part ID fields on the core item.

### TV Season
Current backend table: `media_seasons`.

Relationship: `TV Series MediaItem 1 -> many MediaSeason`.

Important distinction: `tv_episode` exists as a media type, but the current richer TV completeness model is season-level under a `tv_series` item.

### Collection
Current backend table: `collections`.

Collections are grouping/import constructs. They are not the same thing as libraries and not the same thing as media variants. Useful for import/merge history and collection browsing, but probably not a first-pass Apple core model unless the platform app needs collection management.

### Art Item
Current backend table: `art_items`.

Art is now a first-class object separate from Collectibles. Do not model Art as a collectible category in the Apple app.

Representative payload:

```json
{
  "id": 2,
  "title": "Bast",
  "artist": "Nigel Sade",
  "series": "Croyance",
  "franchise": null,
  "medium": "print",
  "height": 20,
  "width": 8,
  "dimension_unit": "in",
  "framed": false,
  "vendor": "Studio Sade",
  "booth": null,
  "price": 25,
  "exclusive": false,
  "signed": false,
  "image_path": "/uploads/art/bast.jpg",
  "notes": null,
  "signatures": []
}
```

### Collectible
Current backend table: `collectibles`.

Collectibles remain a separate first-class domain object, but the naming decision kept “Collectibles” rather than “Fandom.” Fandom/franchise is metadata, not the object taxonomy.

Current category keys include Lego, figures/statues, props/replicas/originals, Funko, comic panels, toys, clothing. Art/comic panels are moving toward the Art model via `medium = comic_panel`, but legacy/category data can still exist.

SwiftData guidance:

- Model `Collectible` separately from `ArtItem`.
- Do not create a separate root entity for Fandom yet.
- Use `franchise` as metadata shared by Art and Collectibles.

### Signature Record
Current backend table: `signature_records`.

Signatures are shared provenance records for `media`, `art`, and `event_artifact` owners.

Relationship:

```text
SignatureRecord.owner_type + owner_id -> MediaItem OR ArtItem OR EventArtifact
SignatureRecord 1 -> many SignatureProof
SignatureRecord optionally belongs to signed_event_id -> Event
```

SwiftData guidance:

- Make `SignatureRecord` a real reusable entity, not fields embedded on Art only.
- Support multiple signatures per object.
- Support `isPrimary` but do not assume only one signature exists.

### Signature Proof
Current backend table: `signature_proofs`.

Proof images/evidence are separate from the signature. A signature can have multiple proofs.

Relationship: `SignatureRecord 1 -> many SignatureProof`.

### Event
Current backend table: `events`.

An Event is a user-managed event log / convention or attendance record. It is not the canonical storage for thousands of imported sessions.

Representative payload:

```json
{
  "id": 42,
  "title": "San Diego Comic-Con 2023",
  "url": "https://example.com/event/sdcc-2023",
  "location": "San Diego, CA",
  "date_start": "2023-07-20",
  "date_end": "2023-07-23",
  "host": "Comic-Con International",
  "time_label": null,
  "room": null,
  "image_path": "/uploads/events/sdcc-2023.jpg",
  "notes": null
}
```

### Event Artifact
Current backend table: `event_artifacts`.

Artifacts are event-scoped notes/things: session, person, autograph, purchase, freebie, note.

Keep these separate from Art/Collectibles/Media. Some artifacts can link to signatures later, but they are not automatically library items.

### Event Purchased Item
Current backend table: `event_purchased_items`.

This is the shared relationship from Event to purchased Art/Collectible.

Relationship:

```text
Event 1 -> many EventPurchasedItem
EventPurchasedItem many -> one ArtItem OR Collectible
```

This is not a generic inventory table; it is event purchase linkage with snapshots.

### Event Attendee / Person
Current backend table: `event_attendees`.

This is event-scoped person data. There is not yet a global person/contact entity in the backend.

SwiftData guidance:

- For current product parity, model `EventAttendee` as scoped to Event.
- Do not create a global `Person` identity graph yet unless the Apple app needs local-only contacts. If you do, keep it separate from backend IDs.

### Event Group
Current backend table: `event_groups`.

Event-scoped planning group.

Relationship: `Event 1 -> many EventGroup`.

### Event Group Member
Current backend table: `event_group_members`.

Many-to-many join between EventGroup and EventAttendee.

Relationship: `EventGroup many <-> many EventAttendee` through EventGroupMember.

### Event Meetup
Current backend table: `event_meetups`.

Event-scoped social coordination item.

Relationship:

```text
Event 1 -> many Meetup
EventGroup 0/1 -> many Meetup
```

### Event Schedule Plan
Current backend table: `event_schedule_plans`.

This is the current personal/manual schedule plan model. It is not a full public session catalog.

Current statuses:

```text
planned, maybe, backup, skipped, attended
```

Representative payload:

```json
{
  "id": 801,
  "event_id": 42,
  "title": "Creature Design Panel",
  "start_at": "2026-07-24T16:00:00.000Z",
  "end_at": "2026-07-24T17:00:00.000Z",
  "location": "Room 6BCF",
  "source_type": "sched_ics",
  "source_ref": "panel-1@example.test",
  "status": "planned",
  "visibility": "private",
  "notes": "Bring sketchbook, questions, and coffee.\n\nhttps://example.test/session/panel-1"
}
```

### Personal ICS Source
Current backend table: `event_personal_ics_sources`.

Encrypted per-user/per-event source for personal Sched/iCal sync.

Relationship: `Event 1 -> many PersonalIcsSource`, but unique active row per event/user.

Important: the API never returns `feed_url_encrypted` or the raw URL. Local Apple app should not store raw ICS URLs unless the user explicitly enters one locally and the app is responsible for secure Keychain storage.

Representative readback:

```json
{
  "source": {
    "id": 12,
    "event_id": 42,
    "provider": "sched_ics",
    "has_url": true,
    "status": "active",
    "sync_status": "succeeded",
    "last_synced_at": "2026-04-28T20:15:00.000Z",
    "last_success_at": "2026-04-28T20:15:00.000Z",
    "last_error": null,
    "last_item_count": 2,
    "last_change_summary": { "created": 2, "updated": 0, "removed": 0, "total": 2 }
  }
}
```

### Loan
Current backend table: `media_loans`.

Loans are media-specific, not shared with Art/Collectibles at the moment.

Relationship: `MediaItem 1 -> many MediaLoan`; only one active loan per media item is enforced.

### Sync State / Offline Cache State
There is no single backend table named offline cache state for the Apple app. Local app should define its own sync state model.

Recommended local-only entities:

```text
LocalSyncState
PendingMutation
RemoteSnapshotMetadata
OfflineAssetCacheEntry
```

Keep these local-only and do not confuse them with backend sync jobs/import jobs.

## Relationships

Canonical current relationships:

```text
Space 1 -> many Library
Library 1 -> many MediaItem
Library 1 -> many ArtItem
Library 1 -> many Collectible
Library 1 -> many Event

MediaItem 1 -> many ExternalIdentity/media_metadata
MediaItem 1 -> many MediaVariant
TV Series MediaItem 1 -> many MediaSeason
MediaItem 1 -> many SignatureRecord
MediaItem 1 -> many MediaLoan

ArtItem 1 -> many SignatureRecord
Collectible independent, but can link to Event through EventPurchasedItem

Event 1 -> many EventArtifact
Event 1 -> many EventPurchasedItem
Event 1 -> many EventAttendee
Event 1 -> many EventGroup
EventGroup many <-> many EventAttendee through EventGroupMember
Event 1 -> many EventMeetup
EventGroup 0/1 -> many EventMeetup
Event 1 -> many EventSchedulePlan
Event 1 -> many PersonalIcsSource

EventPurchasedItem many -> one ArtItem OR Collectible
SignatureRecord 1 -> many SignatureProof
SignatureRecord 0/1 -> Event through signed_event_id
EventArtifact 0/1 -> SignatureRecord through signature_record_id
```

Things related in UI but separate in the model:

- Art is not Collectibles.
- Event Artifact purchase/autograph/note is not the same as Art/Collectible/Media.
- Event Schedule Plan is not the future full Session Catalog.
- Personal ICS source is not a schedule item; it produces schedule plans.
- Signature Proof is not Signature Record.
- Media Variant is not Media Item.
- External Identity is not the item itself.
- Fandom/franchise is metadata, not a library type.

## Identifiers

### Backend IDs

Backend integer IDs are authoritative for sync identity once an object exists remotely:

```text
media.id
art_items.id
collectibles.id
events.id
event_artifacts.id
event_attendees.id
event_groups.id
event_meetups.id
event_schedule_plans.id
signature_records.id
signature_proofs.id
media_loans.id
```

Apple local models should use:

```text
local UUID: stable before upload
remote backend id: nullable until synced
serverUpdatedAt: conflict/sync comparison
syncStatus: clean/dirty/deleted/conflicted
```

### Primary Provider IDs By Type

Movie / TV:

- Primary provider identity: `tmdb_id` + `tmdb_media_type`.
- Backend stores this top-level on `media`.
- TMDB URL/poster/backdrop are enrichment fields derived from TMDB.
- Plex IDs are import/source identity, not canonical creative identity.

Book:

- Primary high-confidence identity: normalized ISBN in `type_details.isbn` or `media_metadata` key `isbn`.
- Google Books ID/provider item ID is useful provider metadata but not always universal identity.
- Calibre/CWA IDs identify imported source rows, not the book globally.

Comic:

- High-confidence identity: provider name + provider item ID, or series + issue + volume.
- Metron issue ID is a strong provider identity when present.
- ISBN can exist for trades/collections, but issue identity should prefer provider/series/issue/volume.

Game:

- Current provider target is IGDB.
- UPC/EAN/ASIN/platform can be important import/search identities.
- Platform is part of the game copy’s owned context, not always global creative identity.

Audio:

- UPC/EAN/ASIN and type details such as artist/album/track_count matter.
- Current model is less provider-rich than movie/book/comic.

Art:

- Backend `art_items.id` is authoritative.
- There is no external provider identity for art currently.
- Series + artist + title are meaningful user/domain identity but not guaranteed unique.

Collectible:

- Backend `collectibles.id` is authoritative.
- No external provider identity currently.
- Category/franchise/vendor/booth are metadata.

Event:

- Backend `events.id` is authoritative.
- Event URL is metadata, not guaranteed stable identity.

Event Schedule Plan / Personal ICS:

- Backend `event_schedule_plans.id` is authoritative once synced.
- For Sched/iCal-derived plans, `source_type = sched_ics` and `source_ref` is the stable source reference.
- `source_ref` is ICS `UID` when available, otherwise a hash fallback.
- Personal ICS source URL is secret config, not a public identifier.

### Secondary / Metadata IDs

These are useful but should not replace backend ID as sync identity:

```text
provider_item_id
provider_issue_id
provider_external_url
provider_download_url
calibre_entry_id
calibre_external_url
calibre_download_url
plex_guid
plex_item_key
plex_section_id
amazon_item_id
asin
ean_upc
upc
```

## Representative Payloads

These are representative current payload shapes, not a fresh export from the user’s live database.

### Movie

```json
{
  "id": 2561,
  "title": "Whitecoats",
  "media_type": "movie",
  "original_title": "Intern Academy",
  "year": 2004,
  "owned_formats": ["digital"],
  "director": "Dave Thomas",
  "runtime": 99,
  "tmdb_id": 55922,
  "tmdb_media_type": "movie",
  "poster_path": "/a6YQiS6nseTBsENp93r6mbfjSvc.jpg",
  "backdrop_path": "/3YTH3XzxwD7AiMe1tKyyytsxnq8.jpg",
  "import_source": "plex",
  "type_details": { "edition": "Digital" }
}
```

### TV Series

```json
{
  "id": 3100,
  "title": "Example Show",
  "media_type": "tv_series",
  "year": 2022,
  "owned_formats": ["digital"],
  "tmdb_id": 12345,
  "tmdb_media_type": "tv",
  "poster_path": "/poster.jpg",
  "backdrop_path": "/backdrop.jpg",
  "network": "Example Network",
  "import_source": "plex",
  "seasons": [
    { "season_number": 1, "expected_episodes": 10, "available_episodes": 10, "is_complete": true, "watch_state": "completed", "source": "plex" }
  ]
}
```

### Book

```json
{
  "id": 7252,
  "title": "Alpha Flight by Mantlo and Lee Omnibus Jim Lee Cover",
  "media_type": "book",
  "year": 2026,
  "owned_formats": ["hardcover"],
  "poster_path": "https://covers2.booksamillion.com/covers/bam/0/35/844/784/0358447844.jpg",
  "type_details": {
    "isbn": "9781302965389",
    "author": "Bill Mantlo, James Hudnall",
    "edition": "Hardcover",
    "publisher": "Marvel Universe"
  },
  "import_source": "manual"
}
```

### Comic

```json
{
  "id": 4888,
  "title": "Groo - Hell On Earth 01",
  "media_type": "comic_book",
  "year": 2004,
  "owned_formats": ["digital"],
  "type_details": {
    "series": "Groo - Hell On Earth",
    "issue_number": "1",
    "writer": "Mark Evanier",
    "artist": "Sergio Aragones",
    "provider_name": "metron",
    "provider_item_id": "example-issue-id"
  },
  "import_source": "metron"
}
```

### Game

```json
{
  "id": 6100,
  "title": "Example Game",
  "media_type": "game",
  "year": 2017,
  "owned_formats": ["cartridge"],
  "upc": "045496590420",
  "type_details": {
    "platform": "Nintendo Switch",
    "developer": "Nintendo",
    "region": "US",
    "provider_name": "igdb",
    "provider_item_id": "example-igdb-id"
  },
  "import_source": "manual"
}
```

### Audio

```json
{
  "id": 6200,
  "title": "Example Album",
  "media_type": "audio",
  "year": 1994,
  "owned_formats": ["cd", "digital"],
  "upc": "012345678901",
  "type_details": {
    "artist": "Example Artist",
    "album": "Example Album",
    "track_count": 12
  },
  "import_source": "manual"
}
```

### Art

```json
{
  "id": 2,
  "title": "Bast",
  "artist": "Nigel Sade",
  "series": "Croyance",
  "medium": "print",
  "height": 20,
  "width": 8,
  "dimension_unit": "in",
  "framed": false,
  "vendor": "Studio Sade",
  "price": 25,
  "signed": false
}
```

### Event Schedule Plan From Sched ICS

```json
{
  "id": 801,
  "event_id": 42,
  "title": "Creature Design Panel",
  "start_at": "2026-07-24T16:00:00.000Z",
  "end_at": "2026-07-24T17:00:00.000Z",
  "location": "Room 6BCF",
  "source_type": "sched_ics",
  "source_ref": "panel-1@example.test",
  "status": "planned",
  "visibility": "private"
}
```

## Enrichment Rules

### What Enrichment Adds

Movies / TV enrichment can add:

```text
tmdb_id, tmdb_media_type, tmdb_url, poster_path, backdrop_path, overview, trailer_url, runtime, release_date, year, director, cast, genre, rating, network
```

Books enrichment can add:

```text
poster/cover URL, overview, author, publisher, ISBN, edition, year/date where available, provider IDs/URLs
```

Comics enrichment can add:

```text
series, issue_number, volume, writer, artist, inker, colorist, cover_date, provider issue IDs, cover image, overview
```

Games enrichment can add:

```text
platform, developer, region, cover/poster, provider IDs, release date/year
```

Audio enrichment can add:

```text
artist, album, track count, cover art, UPC/EAN/ASIN when available
```

Art/Collectibles currently have no external enrichment provider. They are user-owned records.

Events and social planning currently have no external enrichment except Sched ICS producing private schedule plans.

### Safe To Overwrite If Blank

Backend enrichment generally fills missing provider-owned fields and tries not to trample user-owned values. Apple should follow the same rule.

Safe if local/user value is blank:

```text
poster_path, backdrop_path, overview, trailer_url, runtime, tmdb_url, rating, provider IDs, type_details provider fields, normalized author/publisher/creator fields, cover images
```

### Risky To Overwrite

Only overwrite with explicit user approval or if the field is still known to be provider-owned and not user-edited:

```text
title, original_title, year, release_date, director, cast, genre, network, type_details.author, type_details.artist, type_details.series, type_details.issue_number
```

### Never Overwrite Without User Intent

User-owned fields:

```text
owned_formats, format when manually edited, user_rating, location, notes, signed fields/provenance, signature records, proof records, art dimensions, framed, price, exclusive, vendor, booth, event purchase links, loan state, event social statuses, schedule plan status, meetup status, attendee/group notes
```

### Incremental vs All-At-Once

Use incremental enrichment.

Recommended Apple pipeline:

1. Create or update user-owned shell item locally.
2. Attach external identities as separate records.
3. Fetch enrichment by strongest identity.
4. Apply provider fields only where blank or not user-edited.
5. Preserve raw provider payload in a cache/sidecar if useful, not in the core item.
6. Record `enrichedAt`, `provider`, and field provenance locally if possible.

### Artwork Storage

Current backend stores primary item artwork directly on the item:

```text
media.poster_path
media.backdrop_path
art_items.image_path
collectibles.image_path
events.image_path
event_artifacts.image_path
```

Current backend also stores signature proof artwork separately:

```text
signature_records.proof_path
signature_proofs.proof_path
```

SwiftData guidance:

- Keep simple display artwork path fields on the item for current API parity.
- Add a reusable local `AssetCacheEntry` for downloaded/cached image bytes.
- Do not make item artwork a required separate remote entity yet.
- Do make signature proofs separate related objects.

## Editable Boundaries

### User Owns

```text
library placement, owned formats, physical format, user rating, location, notes, loan state, signatures/proofs, Art fields, Collectible fields, Event fields, social planning records, schedule plan statuses, vendor/booth/price/exclusive/framed/dimensions
```

### Backend Owns

```text
remote IDs, created_at, updated_at, archived_at, scope/library/space access, activity logs, release/config/feature flags, server-side import/sync status, encrypted secret storage
```

### Enrichment Owns

```text
provider IDs, provider URLs, poster/backdrop/cover suggestions, overview/synopsis, cast/crew/provider metadata, valuation estimates, Plex variant file metadata, Sched ICS-derived source_ref/source_type and imported schedule times/titles when not user-edited
```

### Conflict Rule

If a user edited a field and enrichment later returns a different value, user value wins.

If remote backend changed a user-owned field and local also changed it offline, do not auto-merge silently. Mark conflicted and prefer local in the UI until user resolves or explicitly accepts remote.

If enrichment changes a provider-owned field and the user never edited it, remote/enrichment can win.

## Search / Indexing Fields

### Media Local Search

Index:

```text
title, original_title, media_type, year, release_date, owned_formats, format, director, cast, genre, network, notes, upc, tmdb_id, tmdb_media_type, type_details.author, type_details.isbn, type_details.publisher, type_details.series, type_details.issue_number, type_details.volume, type_details.writer, type_details.artist, type_details.platform, type_details.developer, provider_item_id, provider_issue_id, plex_guid, plex_item_key
```

Fast browse facets:

```text
media_type, owned_formats, year, genre, creator/author/artist, platform, series, issue_number, watch_state, loan status, signed state
```

### Art Search

Index:

```text
title, artist, series, franchise, medium, vendor, booth, notes, signed, framed, dimension_unit
```

Fast browse facets:

```text
medium, artist, series, franchise, signed, framed, exclusive, linked event
```

### Collectibles Search

Index:

```text
title, category_key, category, franchise, series, artist, vendor, booth, notes
```

Fast browse facets:

```text
category_key, franchise, exclusive, linked event
```

### Events / Social Planning Search

Index:

```text
event title, location, host, room, date_start, date_end, notes, artifact title/description/vendor, attendee display_name/contact_label/relationship, group name, meetup title/location/notes, schedule plan title/location/source_ref/notes
```

Fast browse facets:

```text
current/upcoming event, today, now/next schedule plans, meetup status, plan status, group, visibility, source_type
```

## Sync / Offline Rules

### Local Object Identity

Use local UUID + nullable remote ID.

Recommended fields for every syncable object:

```text
localId UUID
remoteId Int?
remoteType String
libraryId Int?
spaceId Int?
createdAt Date?
updatedAt Date?
archivedAt Date?
localUpdatedAt Date
syncState enum(clean, dirtyCreate, dirtyUpdate, dirtyDelete, syncing, conflicted, failed)
lastSyncedAt Date?
lastSyncError String?
```

### Conflict Behavior

- Local unsynced user edits should not be overwritten by incoming remote enrichment.
- Remote deletes/archive should create a local tombstone conflict if the local object has unsynced edits.
- For clean local objects, remote updated_at wins.
- For provider/enrichment fields, newest provider snapshot can win only if the user has not edited that field.
- For schedule plans from ICS, source sync may update title/time/location/notes for `source_type = sched_ics`, but user-owned `status` should be protected once manually changed if the app tracks field ownership.

### Stale / Offline Behavior

- Show stale badges for provider/enrichment/sync status; do not block browse.
- Cached images should remain visible offline.
- Mutations queue locally and replay when online.
- If enrichment is unavailable, keep user-entered shell records.
- If personal ICS sync fails, keep existing schedule plans and show sync status/error; do not delete local plans on failed fetch.

## Intentionally Not Core Yet

Do not put these into the first stable Apple core schema as first-class remote models unless needed for a specific feature:

- Full convention session catalog/provider framework. It is designed but not implemented as current product truth.
- Global Person/contact graph. Current people are event attendees only.
- Global Fandom entity. Fandom/franchise is metadata on Art/Collectibles now.
- Provider plugin registry. Current provider details are backend implementation/config, not app-owned domain data.
- Observability/logging/admin/support data. Keep out of the consumer platform app core store.
- Merge repair history and recommendation feedback. Useful backend/operator data, not first-pass app model.
- Raw encrypted ICS URLs in SwiftData. Use Keychain if the platform app ever stores user-entered feed URLs locally.
- Raw provider payloads as core models. Store in cache/sidecar only if needed for debugging or offline re-enrichment.
- Event artifacts as library items. They are event-scoped until explicitly promoted/linked.

## Suggested SwiftData Entity Set

Minimum stable set:

```text
WorkspaceSpace
Library
MediaItem
MediaTypeDetails
ExternalIdentity
MediaVariant
MediaSeason
ArtItem
Collectible
SignatureRecord
SignatureProof
Event
EventArtifact
EventPurchasedItem
EventAttendee
EventGroup
EventGroupMember
EventMeetup
EventSchedulePlan
PersonalIcsSourceStatus
MediaLoan
AssetCacheEntry
LocalSyncState
PendingMutation
```

Optional later set:

```text
ConventionSeries
ConventionSessionCatalogItem
ConventionSource
SessionCatalogMatch
GlobalPerson
FandomFranchise
ProviderRawCache
MergeReviewRecord
```

## Open Questions / Risks

1. Field ownership is not fully explicit in the backend today. Apple should add local field-level dirty/provenance tracking if it wants safe offline enrichment merges.
2. Sched ICS sync currently creates personal schedule plans, not full catalog sessions. Do not design Now/Next discovery as if the full catalog already exists.
3. Art is first-class now, but legacy collectible linkage remains through `source_collectible_id`; migration paths should tolerate old references.
4. `type_details` is flexible but intentionally constrained by media type. A too-rigid Swift schema may cause avoidable migrations later.
5. Backend APIs currently use integer IDs. Apple needs local UUIDs for offline creation before remote IDs exist.
6. Signatures are shared and multi-owner; do not repeat the old pattern of only boolean signed fields.
7. Secret-bearing source configuration should not live in ordinary SwiftData rows unless encrypted/Keychain-backed.
