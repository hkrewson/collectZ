# Work, Edition, and Owned Copy Contract

## Purpose

CollectZ must distinguish a creative title from a market release and from the physical or digital instance a library owns. The first adopter is reviewed Blu-ray.com single-title intake. Existing `media` and `media_variants` behavior remains compatible while this model proves itself.

## Domain boundaries

- A **Work** is the creative movie title. In the first slice, one Work is anchored to one existing movie Canonical Object in one library.
- An **Edition** is one exact Blu-ray.com product/release of that Work. Its stable release key is the provider plus Blu-ray.com product id.
- An **Owned Copy** is one library-owned instance of that Edition. The first intake path creates one copy per reviewed Capture Inbox item.
- An **Edition Source Observation** is immutable normalized release evidence retained from the reviewed capture. It is evidence for the Edition, not current Work metadata and not a raw browser payload.
- `media` remains the compatibility projection used by existing title APIs and UI.
- `media_variants` remains a compatibility projection for existing Blu-ray and Plex consumers. It is not authoritative ownership state.

## First workflow invariants

1. Only an explicit Capture Inbox import of a supported Blu-ray.com movie capture creates these records.
2. A reviewed capture reuses the Work for its exact scoped Canonical Object.
3. `(workspace, library, provider, provider item id)` identifies one Edition. An Edition already attached to another Work fails for review; intake never silently reassigns it.
4. One Capture Inbox item creates at most one Owned Copy. A replay updates the same copy rather than increasing inventory.
5. Every successful reviewed intake retains a normalized Edition Source Observation. Exact replay is idempotent; changed normalized evidence appends a new observation.
6. Work, Edition, Owned Copy, capture, and compatibility media rows must share the same workspace and library.
7. The runtime can read or write the new records only inside an authorized exact-library database transaction.
8. Deleting a converted Capture Inbox receipt retains its Edition Source Observation and clears only the receipt pointer. Direct observation mutation/deletion remains forbidden; an authorized Work/Edition deletion may remove dependent evidence through the normal cascade.

## Review and compatibility behavior

Before import, the Capture Inbox names the Work, Edition, and Owned Copy outcomes in plain language. After import, the API returns their public UUIDs and whether each record was created or reused. Existing title, owned-format, physical-variant, metadata, cover, trailer, and valuation mapping continues unchanged.

## Deferred program scope

- Batch collection traversal and a batch review drawer.
- Multiple copies of one Edition outside distinct reviewed capture receipts.
- Wishlist, ordered, loaned, for-sale, and rented status mapping.
- Edition editing, upgrade discovery, price history, alerts, and Plex watched-state propagation.
- Backfill or automatic splitting of existing `media_variants`.
- Work sharing across libraries or adoption by books, games, audio, comics, or other providers.
- Removal of compatibility projections.
