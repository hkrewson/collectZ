# Digital-Library Provider Identity Contract

BookOrbit, CWA/Calibre, and Kavita share provider-identity mechanics, not one provider domain model. Each adapter owns its identity syntax, configuration, credentials, links, covers, and provider-only behavior.

## Shared module boundary

`backend/services/digitalLibraryIdentityPayload.js` is the shared payload Module. Its Interface has two operations:

- build an allowlisted Canonical Field payload from adapter-selected media and type-detail keys;
- build the legacy Compatibility Projection for one authoritative external identity.

BookOrbit, CWA, and Kavita are three real Adapters at this Seam. They supply their own field allowlists and compatibility aliases. The Module does not parse feeds, fetch covers, validate credentials, infer identity kinds, select connections, merge objects, or decide provider-specific writeback.

The surrounding existing Modules retain the other shared mechanics:

- `providerConnections.js` owns multi-instance lifecycle and public credential-state redaction;
- workspace integration responses retain the existing encrypted-secret and masked-readback behavior for the singleton CWA and Kavita configuration slots;
- `externalMediaIdentities.js` owns connection-scoped repeat resolution and target-conflict refusal;
- `providerIdentityCompatibility.js` owns exact compatibility alignment and field-name-only conflict diagnostics;
- `providerIdentityBackfillPlanner.js` owns plan-first historical adoption and fail-closed ambiguity diagnostics.

## Provider exceptions

| Provider | Authoritative identity | Connection model | Link and cover contract | Intentional exceptions |
| --- | --- | --- | --- | --- |
| BookOrbit | Atom entry id, kind `book` | Multiple workspace Provider Connections selected by UUID | Acquisition and series links from OPDS; cover reference from the feed; no fabricated browse link | ISBN is mutable metadata, not identity. Stable provider-owned type changes may move between book and comic only when lossless. An optional encrypted native API key enables read-only enrichment; OPDS remains the fallback. Audiobooks remain unsupported. |
| CWA/Calibre | Existing exact OPDS entry id, kind `book` | Stable `books.cwa_opds` binding over the existing workspace configuration | Separate browse and download links, including existing Calibre compatibility aliases; OPDS cover behavior is retained | The existing identifier contract and CWA label remain unchanged. The legacy encrypted configuration remains the credential source during migration. |
| Kavita | Numeric record id scoped by distinct `series` or `chapter` kind | Stable `books.kavita` binding over the existing workspace configuration | Native series/reader links and Kavita cover/page-proxy references remain provider-owned | Series and chapter identities never collapse into one kind. Reader progress and metadata writeback retain their existing explicit opt-in contracts and are not generalized here. |

The common database uniqueness boundary remains `(space_id, provider_connection_id, identity_kind, external_id_normalized)`. Compatibility strings such as `kavita:chapter:42` remain readable but are not the uniqueness guarantee.

### BookOrbit native enrichment boundary

BookOrbit OPDS remains the baseline catalog and identity transport. When a connection also has a native API key, CollectZ derives the numeric BookOrbit book id only from the validated Atom identity `urn:bookorbit:book:{id}` and reads `/api/v1/books/{id}` from the configured server origin. The response must return the same BookOrbit id before any fields are accepted. Authentication failures, unavailable responses, malformed payloads, or identity mismatches fall back per publication to the original OPDS row and do not fail the catalog import.

Native provider identifiers are compatibility metadata, not alternate authoritative identities. They are projected as BookOrbit-scoped scalar fields such as `bookorbit_comicvine_id` and `bookorbit_goodreads_id`; `provider_name` and `provider_item_id` remain `bookorbit` and the Atom entry id. The native response does not currently expose a reliable selected-provider field, so CollectZ does not infer one from the presence of an identifier. Series, issue, credit, character, team, location, and story-arc values remain provider-controlled enrichment fields until later `3.28.1` slices introduce normalized multi-series membership and richer provenance.

## Adoption and failure behavior

Repeat sync resolves the authoritative relation before compatibility fields. A same-provider local id on another connection or workspace is a different identity. Manual, reviewed, locked, or differently sourced Canonical Fields remain protected by Canonical Field Controls.

Historical CWA and Kavita adoption prefers the stable integration binding. If no binding exists, exactly one active same-provider connection is required. Missing, inactive, conflicting, or ambiguous connection ownership; conflicting legacy values; multiple canonical candidates; and authoritative target conflicts stay unchanged for review. Public plan/apply results expose deterministic fingerprints and evidence field names, never raw external ids or credentials.

## Verification

- `scripts/external-identity-tests.js` proves the shared Interface and each adapter projection.
- `scripts/bookorbit-opds-transport-smoke.js` proves native authentication, identity matching, upstream identifier projection, and per-row OPDS fallback without storing a fixed credential.
- `scripts/bookorbit-authoritative-import-smoke.js`, `scripts/cwa-authoritative-sync-smoke.js`, and `scripts/kavita-import-sync-smoke.js` retain provider-specific runtime behavior.
- `scripts/digital-library-identity-backfill-smoke.js` proves binding selection, ambiguity refusal, redaction, idempotency, and rollback restoration against live PostgreSQL and RLS.

This contract does not introduce scheduling, reading-progress convergence, metadata-writeback convergence, source-observation history, or a work/edition/copy model.
