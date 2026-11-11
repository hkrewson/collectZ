# collectZ Collection Domain

This glossary names the collection and provider-identity concepts that must remain distinct as collectZ imports, relates, and synchronizes records from external systems.

## Language

**Canonical Object**:
A collectZ-owned record representing the current local object to which external identities and reviewed facts attach.
_Avoid_: Provider object, source row

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

**Provider Adapter**:
Provider-specific interpretation that converts transport responses into typed external identities, observations, links, and candidate facts without hiding provider-specific behavior.
_Avoid_: Generic provider, collector

**OPDS Transport**:
Shared mechanics for authenticating, fetching, parsing, resolving, and traversing OPDS feeds without deciding provider-specific identity or media semantics.
_Avoid_: BookOrbit adapter, CWA adapter
