# collectZ Collection Domain

This glossary names the collection and provider-identity concepts that must remain distinct as collectZ imports, relates, and synchronizes records from external systems.

## Language

**Canonical Object**:
A collectZ-owned record representing the current local object to which external identities and reviewed facts attach.
_Avoid_: Provider object, source row

**Work**:
A collectZ-owned identity for the creative title or object independent of a particular market release and any copy a library owns.
_Avoid_: Edition, Owned Copy, provider group, media variant

**Edition**:
A specific published, manufactured, or distributed release of a Work, distinguished by stable release identity and release-level facts such as format, date, region, packaging, or technical specifications.
_Avoid_: Work, Owned Copy, format label, Provider Edition Group

**Owned Copy**:
One library-owned instance of an Edition, carrying ownership facts such as status, condition, acquisition, location, loan state, or copy-specific provenance.
_Avoid_: Edition, format, inventory count

**Canonical UUID**:
An immutable collectZ-generated public identifier for a Canonical Object, independent of database storage keys and every external provider identity.
_Avoid_: Provider ID, external ID

**Provider Connection**:
A workspace-owned configuration representing one specific external provider installation or account.
_Avoid_: Provider name, endpoint URL

**External Identity**:
The durable relation between one Provider Connection's typed external identifier and a Canonical Object or a later work, edition, or owned-copy target.
_Avoid_: Metadata field, provider ID field

**Identity Lifecycle Event**:
An append-only record that an External Identity was attached, observed, deactivated, reactivated, or reassigned.
_Avoid_: Source observation, mutable audit field

**Canonical Merge**:
A reversible consolidation of one Canonical Object into another that moves the exact External Identity set as part of the same transaction while retaining immutable identity evidence.
_Avoid_: Row delete, metadata merge

**Compatibility Projection**:
A temporary legacy representation derived from an authoritative External Identity for callers that have not yet migrated to the identity registry.
_Avoid_: Provider identity, source observation

**Backfill Candidate**:
A legacy identity claim eligible for authoritative migration only when its provider semantics and single owning Provider Connection are explicit and conflict-free.
_Avoid_: Inferred provider identity, probable match

**Canonical Field Control**:
A per-field decision stating whose value is authoritative, whether provider refresh is permitted, and whether the current canonical value is locked.
_Avoid_: Source observation, provider metadata

**Provider Type Transition**:
A controlled change to a Canonical Object's media type when the same External Identity is later observed with different provider semantics. The Canonical UUID stays stable; provider-owned, lossless changes may apply automatically, while locked, manually controlled, cross-provider, or lossy changes require review.
_Avoid_: Re-import, replacement object, duplicate object

**Identity Kind**:
The provider-defined level identified by an External Identity, such as book, series, chapter, edition, or file.
_Avoid_: Media type

**Source Observation**:
An external provider's facts as observed at a particular time, preserved separately from the reviewed current state of a Canonical Object.
_Avoid_: Canonical metadata, provider identity

**Edition Source Observation**:
An immutable, normalized record of release-level facts observed during reviewed intake and attached to the exact Edition they describe.
_Avoid_: Edition, current metadata, raw capture payload

**Collection Capture Batch**:
One user-initiated traversal of an authenticated provider collection that is reviewed and applied as a coherent intake unit.
_Avoid_: Crawl job, automatic sync

**Batch Review Item**:
One provider collection entry within a Collection Capture Batch, carrying its own staged decision and apply outcome.
_Avoid_: Imported title, child job

**Edition Enrichment Evidence**:
Bounded release-level facts fetched from the exact provider product page after a collection entry is discovered and before it can be included for import. It supplements collection ownership evidence without becoming canonical metadata until reviewed apply.
_Avoid_: Automatic metadata import, raw product page, canonical edition

**Ready With Issues**:
A completed Collection Capture Batch traversal whose received rows are available for review but whose exact-product enrichment still contains one or more failed items. It is a recoverable review state, not a successful import or a paused traversal.
_Avoid_: Ready, completed, failed batch

**Provider Edition Group**:
A provider's observation that distinct External Identities represent editions of one work, retained as provenance without asserting a CollectZ-owned Work or Edition relationship.
_Avoid_: Duplicate set, canonical merge, identity match

**Reviewed Observation Apply**:
An atomic, audited promotion of current approved Source Observation differences into a Canonical Object as reviewed, preserve-only values.
_Avoid_: Provider refresh, provider writeback, automatic rematch

**Reviewed Cover Apply**:
A Reviewed Observation Apply whose value is a credential-safe CollectZ cover reference that a person compared visually before promotion.
_Avoid_: Remote image import, automatic cover refresh, provider image URL

**Identity Rematch Candidate**:
A Canonical Object suggested as a possible new target for an existing External Identity from bounded Source Observation evidence, without implying approval or mutation.
_Avoid_: Duplicate, automatic match, reassigned identity

**Provider Adapter**:
Provider-specific interpretation that converts transport responses into typed external identities, observations, links, and candidate facts without hiding provider-specific behavior.
_Avoid_: Generic provider, collector

**OPDS Transport**:
Shared mechanics for authenticating, fetching, parsing, resolving, and traversing OPDS feeds without deciding provider-specific identity or media semantics.
_Avoid_: BookOrbit adapter, CWA adapter
