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
