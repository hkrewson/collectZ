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
| BookOrbit | Atom entry id, kind `book` | Multiple workspace Provider Connections selected by UUID | Acquisition links and fallback cover reference from OPDS; authenticated native covers are served through a credential-safe CollectZ proxy; no fabricated browse link | ISBN is mutable metadata, not identity. Stable provider-owned type changes may move between book and comic only when lossless. An optional encrypted native API key enables read-only enrichment; OPDS remains the fallback. Audiobooks remain unsupported. |
| CWA/Calibre | Existing exact OPDS entry id, kind `book` | Stable `books.cwa_opds` binding over the existing workspace configuration | Separate browse and download links, including existing Calibre compatibility aliases; OPDS cover behavior is retained | The existing identifier contract and CWA label remain unchanged. The legacy encrypted configuration remains the credential source during migration. |
| Kavita | Numeric record id scoped by distinct `series` or `chapter` kind | Stable `books.kavita` binding over the existing workspace configuration | Native series/reader links and Kavita cover/page-proxy references remain provider-owned | Series and chapter identities never collapse into one kind. Reader progress and metadata writeback retain their existing explicit opt-in contracts and are not generalized here. |

The common database uniqueness boundary remains `(space_id, provider_connection_id, identity_kind, external_id_normalized)`. Compatibility strings such as `kavita:chapter:42` remain readable but are not the uniqueness guarantee.

### BookOrbit native enrichment boundary

BookOrbit OPDS remains the baseline catalog and identity transport. When a connection also has a native API key, CollectZ derives the numeric BookOrbit book id only from the validated Atom identity `urn:bookorbit:book:{id}` and reads `/api/v1/books/{id}` from the configured server origin. The response must return the same BookOrbit id before any fields are accepted. Authentication failures, unavailable responses, malformed payloads, or identity mismatches fall back per publication to the original OPDS row and do not fail the catalog import.

Native provider identifiers are compatibility metadata, not alternate authoritative identities. They are projected as BookOrbit-scoped scalar fields such as `bookorbit_comicvine_id` and `bookorbit_goodreads_id`; `provider_name` and `provider_item_id` remain `bookorbit` and the Atom entry id. CollectZ accepts selected metadata provenance only from an explicit native `metadataSource` object containing both `provider` and `providerItemId`. The provider must be one of the supported `providerIds` keys and the selected id must equal that provider's reported id. A missing, partial, unsupported, or inconsistent pair is omitted rather than inferred from the presence of an identifier.

Native series identity and membership are relational rather than provider-payload JSON. `provider_series_records` keeps the connection-scoped BookOrbit series id and name, while `media_series_memberships` links one canonical media row to one or more ordered series records. Membership rows keep series index, volume, issue number, expected item count, source timestamp, source kind, observation timestamps, and active/deactivated lifecycle separately. A successful native refresh reactivates or updates observed memberships and retires missing memberships; an OPDS fallback leaves the prior relational observation unchanged because the native result is unavailable rather than authoritatively empty. The first ordered membership continues to project `series` and `series_index`, and native volume/issue values continue to project their existing scalar fields during compatibility migration.

Native cover metadata is accepted only after the BookOrbit response identity matches the validated Atom identity. CollectZ stores bounded cover version, source, dimensions, and source timestamp as BookOrbit compatibility provenance, then uses a versioned `/api/media/bookorbit-cover/{connectionId}/{bookId}` path as the canonical poster. That session-only proxy resolves encrypted credentials at request time, verifies that the requested BookOrbit id is actively linked to the selected workspace connection, accepts only bounded image responses, and never exposes the upstream API key or direct authenticated cover URL. OPDS cover paths remain unchanged when native enrichment fails or does not advertise an ebook cover.

### Immutable source observation boundary

Migration `145` adds `provider_source_observations` as an append-only, workspace-owned history of normalized external facts. Each observation is tied to one Provider Connection and active external media identity, records the canonical media public UUID visible at observation time, and keeps an explicit source kind, source timestamp, schema version, content hash, observation timestamp, and actor. Database triggers reject updates and deletes, RLS requires the authorized workspace, and composite foreign keys prevent a connection or identity from crossing that workspace.

BookOrbit is the first adopter. Its identity module records one observation in the same authorized transaction as canonical reconciliation, field-control application, compatibility projection, and series-membership synchronization. OPDS fallback creates a `bookorbit_opds` observation; successful native enrichment creates a `bookorbit_native` observation without changing BookOrbit's canonical identity. The normalized facts include allowlisted bibliographic values, upstream provider ids, ordered series memberships, cover provenance, and—when explicitly and consistently supplied—the selected metadata provider and provider record id under `metadataSource`.

Kavita is the second, materially different adopter. Its identity module records `kavita_api` observations after reconciliation of either the `series` or `chapter` identity kind. The Kavita fact schema keeps safe library, series, chapter, bibliographic, chapter-fan-out, and CollectZ cover-proxy provenance explicit. It deliberately omits reader/launch URLs, upstream cover URLs, server filenames, API keys, bearer tokens, and writeback/progress payloads. Chapter observations retain their parent series identity as provenance without collapsing the chapter identity into the series.

Raw native/OPDS/API payloads, credentials, authorization headers, API keys, passwords, bearer tokens, and direct authenticated provider URLs are not retained by either adopter.

Observation idempotency derives from the import batch, external identity, source kind, and normalized content hash. Retrying the same durable or inline job with unchanged facts reuses its observation, while a later batch or changed facts appends a new immutable observation. Synchronous imports mint one batch identity per request. The ledger is historical evidence for later rematching and provenance decisions; it does not overwrite canonical fields, infer a selected upstream metadata provider, or introduce the broader work/edition/owned-copy model.

### Workspace-authorized observation readback

`GET /api/media/{id}/provider-observations` projects the immutable history only after the requested media row resolves inside the actor's active workspace/library scope. History follows the external identities currently attached to that canonical row, so identity reassignment or merge repair keeps its evidence with the identity. Results are newest-first and paginated.

Each projected observation also carries a read-only comparison against the current canonical row. The comparison is derived inside the same authorized transaction from an explicit bibliographic allowlist, ignores blank observed values, and normalizes equivalent text, number, identifier, and date representations. It returns only differing field paths and safe current/observed values. Canonical-field context is limited to authority, provider write mode, lock state, and whether the authority belongs to the same Provider Connection; internal connection ids and actor/authorization state are not projected. This comparison is evidence for review only and does not apply metadata, select a provider, or rematch an identity.

The public projection includes the observation UUID, safe Provider Connection id/type/label, identity kind and lifecycle state, canonical public UUID recorded at observation time, source kind, schema version, content fingerprint, normalized facts, provider source timestamp, and observation timestamp. It omits workspace implementation ids, actor ids, identity database ids, idempotency keys, connection endpoints/settings, credentials, authorization values, and raw provider payloads. The Library drawer consumes the same projection and shows only the newest bounded history. For BookOrbit native observations it labels a verified explicit metadata source separately from the complete provider-identifier list; it does not choose a provider or alter current fields.

## Adoption and failure behavior

Repeat sync resolves the authoritative relation before compatibility fields. A same-provider local id on another connection or workspace is a different identity. Manual, reviewed, locked, or differently sourced Canonical Fields remain protected by Canonical Field Controls.

Historical CWA and Kavita adoption prefers the stable integration binding. If no binding exists, exactly one active same-provider connection is required. Missing, inactive, conflicting, or ambiguous connection ownership; conflicting legacy values; multiple canonical candidates; and authoritative target conflicts stay unchanged for review. Public plan/apply results expose deterministic fingerprints and evidence field names, never raw external ids or credentials.

## Verification

- `scripts/external-identity-tests.js` proves the shared Interface and each adapter projection.
- `scripts/bookorbit-opds-transport-smoke.js` proves native authentication, identity matching, multi-series projection, cover transport limits, upstream identifier projection, and per-row OPDS fallback without storing a fixed credential.
- `scripts/bookorbit-authoritative-import-smoke.js` proves ordered membership refresh/retirement, active-only media-detail readback, compatibility projection, authenticated cover proxying, canonical identity stability, normalized observation persistence, retry idempotency, append-only enforcement, RLS isolation, and credential-free facts.
- `scripts/kavita-import-sync-smoke.js` proves series/chapter identity separation, chapter fan-out, same-batch observation reuse, later-batch history, canonical public-UUID linkage, workspace isolation, safe cover-proxy provenance, and absence of fixture credentials and direct server URLs. `scripts/cwa-authoritative-sync-smoke.js` retains its provider-specific runtime behavior without observation adoption.
- The BookOrbit and Kavita runtime smokes both exercise paginated public observation readback, provider-specific facts, omitted sensitive/internal fields, and sibling-workspace non-disclosure.
- `scripts/digital-library-identity-backfill-smoke.js` proves binding selection, ambiguity refusal, redaction, idempotency, and rollback restoration against live PostgreSQL and RLS.

This contract does not introduce automated observation conflict resolution/rematching, historical observation backfill, reading-progress convergence, metadata-writeback convergence, source-observation adoption for providers other than BookOrbit and Kavita, or a work/edition/copy model.
