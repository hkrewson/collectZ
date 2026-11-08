# Keep canonical objects independent from provider identities

collectZ keeps the numeric `media.id` key for internal relational storage, adds an immutable collectZ-generated UUID for public object identity, and stores provider identifiers in a separate relation scoped by workspace and stable provider connection. Provider connection identity survives display-name, endpoint, credential, and lifecycle changes; external identity remains historical and may be deactivated or transactionally reassigned rather than embedded in mutable object JSON. This avoids provider-specific columns and singleton integration ownership while preserving compatibility with existing media foreign keys.

## Considered options

- Embedding provider IDs in `media.type_details` or `media_metadata` was rejected because it cannot enforce provider-instance uniqueness, workspace consistency, or safe reassignment.
- Replacing numeric media primary keys with UUIDs was rejected because it would force a broad, high-risk foreign-key conversion without improving provider identity semantics.
- A generic polymorphic target was deferred until work, edition, and owned-copy targets actually exist; this milestone uses a concrete `media_id` foreign key.
