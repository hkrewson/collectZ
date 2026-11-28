# Work, Edition, and Owned Copy Contract

## Purpose

CollectZ must distinguish a creative title from a market release and from the physical or digital instance a library owns. The first adopter is reviewed Blu-ray.com intake, including single-title review and a manual authenticated collection batch. Existing `media` and `media_variants` behavior remains compatible while this model proves itself.

## Domain boundaries

- A **Work** is the creative movie title. In the first slice, one Work is anchored to one existing movie Canonical Object in one library.
- An **Edition** is one exact Blu-ray.com product/release of that Work. Its stable release key is the provider plus Blu-ray.com product id.
- An **Owned Copy** is one library-owned instance of that Edition. The first intake path creates one copy per reviewed Capture Inbox item.
- An **Edition Source Observation** is immutable normalized release evidence retained from the reviewed capture. It is evidence for the Edition, not current Work metadata and not a raw browser payload.
- `media` remains the compatibility projection used by existing title APIs and UI.
- `media_variants` remains a compatibility projection for existing Blu-ray and Plex consumers. It is not authoritative ownership state.
- `collection_object_identifiers` is the reviewed identity registry for Work- and Edition-scoped schemes. Raw identifiers remain in Edition Source Observations as evidence; category IDs remain classification evidence.

## First workflow invariants

1. Only an explicit Capture Inbox import of a supported Blu-ray.com movie capture creates these records.
2. A reviewed capture reuses the Work for its exact scoped Canonical Object.
3. `(workspace, library, provider, provider item id)` identifies one Edition. An Edition already attached to another Work fails for review; intake never silently reassigns it.
4. One Capture Inbox item creates at most one Owned Copy. A replay updates the same copy rather than increasing inventory.
5. Every successful reviewed intake retains a normalized Edition Source Observation. Exact replay is idempotent; changed normalized evidence appends a new observation.
6. Work, Edition, Owned Copy, capture, and compatibility media rows must share the same workspace and library.
7. The runtime can read or write the new records only inside an authorized exact-library database transaction.
8. Deleting a converted Capture Inbox receipt retains its Edition Source Observation and clears only the receipt pointer. Direct observation mutation/deletion remains forbidden; an authorized Work/Edition deletion may remove dependent evidence through the normal cascade.
9. Apply promotes supported reviewed identifiers atomically: IMDb title ID to the Work; Blu-ray product, content, global grouping, UPC/EAN, and ASIN values to the Edition. Strong cross-target collisions reject the item; corroborating values may be shared.

## Collection batch invariants

1. A user starts collection traversal explicitly in the browser companion while already signed in to Blu-ray.com. CollectZ never stores or receives the provider password, cookie, or session token.
2. One client batch id identifies one exact-library traversal receipt. One provider product key identifies at most one child capture inside that batch, so retrying a batch or page is duplicate-safe.
3. Traversal is sequential and bounded. Authentication prompts, challenges, forbidden or rate-limited responses, empty result pages, and network failures pause the batch instead of triggering bypass behavior.
4. An explicit provider row status or a verified provider `My Collection` page may establish `Owned` collection evidence. The ownership basis is retained separately from detail-page edition evidence.
5. An exact-product detail page must be identity-validated and normalized into Edition Enrichment Evidence before a row can be staged for Include. Failed or partial enrichment remains visible but ineligible for import.
6. Every enriched owned row begins Pending. Only an explicit reviewer Include decision makes it eligible for apply; missing, unsupported, or ambiguous evidence remains excluded from canonical mutation.
7. Page replay may refresh automatic classification evidence, but it cannot overwrite an explicit reviewer Include or Skip decision.
8. Batch review defaults to review-required items while retaining a full-set view and exposes edition identity, format, label, identifiers, release facts, technical details, source links, and provenance before apply.
9. Apply processes included rows independently through the reviewed single-title path. A successful row remains committed when another row fails, and the failed row remains retryable with its review evidence.
10. Traversal completion and detail-enrichment completion are distinct. A batch with any failed detail evidence is `ready_with_issues` even when every collection page was received.
11. Edition labels are not assumed to contain media format. Exact-product format parsing falls back from the edition label to the release title and then to the bounded collection-row format; deterministic parser misses do not consume transient retries.
12. Collection traversal is a persisted sequence of duplicate-safe page deliveries. The browser companion schedules each next page through a browser alarm so extension-worker suspension or update can resume the active batch without duplicating review rows.
13. Provider challenge, throttling, transport, identity, and incomplete-evidence failures retain distinct bounded reasons. Raw provider HTML and session material are never stored.
14. A failed-only retry reuses the same batch and provider item keys, updates only resubmitted failed evidence, and preserves converted or reviewer-controlled decisions.
15. Batch child captures stay grouped under the batch receipt and do not appear as duplicate rows in the ordinary Capture Inbox list.
16. Apply is permitted only after traversal reaches `ready`. Applying a reviewed subset commits those rows independently but keeps the batch `ready` and visible while pending decisions or failed enrichment remain; terminal completion means the review work is actually exhausted.

## Review and compatibility behavior

Before import, the Capture Inbox names the Work, Edition, and Owned Copy outcomes in plain language. After import, the API returns their public UUIDs and whether each record was created or reused. Existing title, owned-format, physical-variant, metadata, cover, trailer, and valuation mapping continues unchanged.

## Deferred program scope

- Multiple copies of one Edition outside distinct reviewed capture receipts.
- Wishlist, ordered, loaned, for-sale, and rented status mapping.
- Edition editing, upgrade discovery, price history, alerts, and Plex watched-state propagation.
- Backfill or automatic splitting of existing `media_variants`.
- Work sharing across libraries or adoption by books, games, audio, comics, or other providers.
- Removal of compatibility projections.
