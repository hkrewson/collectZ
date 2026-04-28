# Collectibles Naming Decision

## Decision

Keep the library name `Collectibles` for now.

Do not rename the library to `Fandom` in the current product surface. Treat `Fandom / Franchise` as metadata that can apply across Art and Collectibles rather than as the owned-object library name.

## Context

Art was promoted into its own native library, and Collectibles taxonomy was simplified so the category selector describes the physical or object class. That cleanup removed category values such as Anime and Comic Panels from Collectibles because those labels were mixing source/fandom context with object shape.

The later `Fandom / Franchise` field gave Art and Collectibles a shared place for source, universe, franchise, or fandom context. That solved the strongest pressure behind renaming Collectibles without forcing a broad product-copy or API rename.

## Rationale

`Collectibles` still describes the boundary users are acting on: cards, Lego, figures, props, replicas, Funko, toys, clothing, and similar owned objects.

`Fandom` describes why the object matters or what universe/source it belongs to. That meaning is broader than Collectibles because Art can also be tied to a fandom, franchise, source material, creator world, or convention context.

Renaming the library to `Fandom` would blur object ownership with source metadata, and it would create avoidable churn across navigation, API names, docs, imports, event purchase linking, and user expectations.

## Current Product Boundary

- `Collectibles` is the owned-object library for non-media, non-Art physical objects.
- `Art` is the owned-object library for artwork, including comic-panel-style artwork through Art medium/type.
- `Fandom / Franchise` is metadata, not taxonomy.
- Collectibles category should describe the object class.
- Art medium/type should describe the artwork form.

## Future Rename Checklist

Only revisit a rename if real usage shows `Collectibles` is consistently misunderstood after the Art and fandom/franchise changes have settled.

Before any future rename, define and review:

- proposed product name and user-facing copy,
- navigation labels and empty-state copy,
- route/API naming strategy and compatibility aliases,
- OpenAPI/docs impact,
- import/export column names,
- event purchased-item copy,
- release-note and migration messaging,
- rollback behavior,
- browser regression coverage for old and new entry points.

## Non-Goals

- Do not rename Collectibles in this decision slice.
- Do not add a fandom tag table or controlled vocabulary here.
- Do not change Collectibles API routes, data model names, or Event purchase linking semantics here.
