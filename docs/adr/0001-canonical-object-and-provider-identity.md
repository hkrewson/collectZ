# Keep canonical objects independent from provider identities

collectZ keeps the numeric `media.id` key for internal relational storage, adds an immutable collectZ-generated UUID for public object identity, and stores provider identifiers in a separate relation scoped by workspace and stable provider connection. Provider connection identity survives display-name, endpoint, credential, and lifecycle changes; external identity remains historical and may be deactivated or transactionally reassigned rather than embedded in mutable object JSON. This avoids provider-specific columns and singleton integration ownership while preserving compatibility with existing media foreign keys.

## Considered options

- Embedding provider IDs in `media.type_details` or `media_metadata` was rejected because it cannot enforce provider-instance uniqueness, workspace consistency, or safe reassignment.
- Replacing numeric media primary keys with UUIDs was rejected because it would force a broad, high-risk foreign-key conversion without improving provider identity semantics.
- A generic polymorphic target was deferred until work, edition, and owned-copy targets actually exist; this milestone uses a concrete `media_id` foreign key.

## Merge and audit lifecycle

A canonical merge reassigns the duplicate object's External Identities inside the same authorized database transaction that records merge history and removes the duplicate row. The merge history stores the exact identity ids moved by that event. Revert restores only that captured set, preserves identities observed on the surviving canonical object after the merge, and fails for review if a captured identity has since moved elsewhere.

The external-identity service exposes a transaction composition boundary that supplies both the authorized database client and client-bound identity operations. Provider sync can therefore resolve, attach, observe, deactivate, or reassign an identity in the same transaction as its canonical compatibility projection without opening nested transactions or bypassing workspace RLS.

Authoritative repeat sync resolves only by Provider Connection, Identity Kind, and normalized external id. The reconciliation interface supplies that resolved Canonical Object to provider work, rejects a different returned target, attaches or observes the identity, and applies the Compatibility Projection in one transaction. Compatibility fields are fill-only: an equal value is idempotent, a missing value is projected, and a different existing value is an explicit conflict that rolls back the attempted identity write instead of silently overwriting manual or another provider's state.

Legacy identity backfill is plan-first and fail-closed. A row becomes a Backfill Candidate only when an explicit provider extraction rule yields one identity meaning, exactly one active Provider Connection of that type exists in the workspace, the owning adapter can normalize it, and neither legacy rows nor authoritative identities disagree about its Canonical Object. Missing, inactive, or multiple connections and every value or target conflict remain unchanged and produce value-redacted review diagnostics; provider names and identifier prefixes are never used to invent a connection.

Identity lifecycle events retain the immutable Canonical UUIDs observed on both sides of a reassignment. Their numeric media references are convenience pointers and may be cleared by foreign-key cleanup after a merged row is deleted; no other event field may be updated or deleted. Revert restores the duplicate's original Canonical UUID rather than generating a replacement. This keeps historical evidence durable without allowing audit foreign keys to prevent the lifecycle operation they describe.
