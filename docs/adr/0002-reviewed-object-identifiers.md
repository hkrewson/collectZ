# Attach reviewed object identifiers at Work and Edition scope

CollectZ stores identifiers promoted by reviewed intake in a typed Object Identifier registry. Each record names its scheme, normalized value, target kind, resolution strength, source provider, and latest Edition Source Observation. IMDb title IDs identify Works. Blu-ray product IDs, UPC/EAN, ASIN, Blu-ray content IDs, and Blu-ray global grouping IDs attach to Editions. Provider category IDs remain taxonomy evidence and are not Object Identifiers.

## Considered options

- Reusing `external_media_identities` was rejected because that relation represents one configured Provider Connection and currently targets a Canonical Object. Authenticated browser capture deliberately does not retain a Blu-ray.com account or Provider Connection, and UPC/ASIN values are not provider-instance identities.
- Keeping reviewed identifiers only inside observation JSON or compatibility columns was rejected because callers cannot reliably resolve, constrain, or search identifiers by their correct Work/Edition meaning.
- Making every value globally exclusive was rejected because UPC/EAN, ASIN, content, and grouping identifiers may legitimately collide or describe bundles. Only documented strong resolution schemes are exclusive.

## Promotion and collision policy

Raw captured values remain immutable Edition Source Observation evidence. Explicit Apply atomically promotes supported identifiers alongside the Work, Edition, Owned Copy, and observation. Repeat Apply updates the last-seen provenance without duplicating the identifier.

`imdb.title` is exclusive per Work and `bluray.product` is exclusive per Edition within one library. A conflicting strong identifier rejects the whole reviewed item for human resolution. UPC/EAN, ASIN, Blu-ray content, and global product/parent values are corroborating or grouping evidence: they are unique only on the same target and may resolve to multiple targets when context requires it.

The migration backfills only reviewed editions. It promotes an IMDb value only when existing reviewed evidence maps it to exactly one Work; ambiguous values remain observations rather than causing a guessed identity assignment.
