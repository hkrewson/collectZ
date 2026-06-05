# Backlog

This file is the staging area for work that has not yet been assigned a release version. Items stay here until they are selected for a numbered milestone.

## How to use the backlog

- Keep backlog items versionless until they are promoted.
- Treat tags as metadata only.
- Keep each item clearly scoped as a task, bug, discussion, or deferred milestone.
- Each backlog item should include enough context to judge status later: a one-line goal, current state or why it exists, intended scope, candidate subtasks when useful, and acceptance criteria.
- If an item is clearly a release candidate, mark it as such in the backlog, but do not assign a version number yet.
- When a backlog item is selected for work, move it into the roadmap as a numbered milestone instead of copying it.
- Keep the roadmap focused on milestone work only.
- Update the roadmap, release notes, release feed, and verification steps together when a backlog item is promoted.

## UI/UX Refinement Backlog

These are unscheduled interface cleanup tasks discovered during the `3.10.x` mobile header and search work. Keep them versionless until selected and moved into the roadmap as numbered UI/UX milestones.

### Backlog Item: Header and Search Surface Refinement
**Type:** UI/UX refinement
**Tags:** `ui`, `ux`, `mobile`, `headers`, `search`, `filters`, `density`
**Status:** Completed across the `3.10.x` UI/UX line. Closed as a backlog item; add a new specific backlog item if a future header/search regression or polish target appears.

**Goal:** Completed the broad mobile and desktop header/search refinement pass by making the surfaces compact, predictable, and deliberate without hiding important controls.

**Why this work exists**
- The `3.10.x` UI/UX line stabilized mobile shell/page headers, fixed utility-page headers, introduced shared page-header/search primitives, normalized live search, compacted utility filters, moved library filtering into funnel menus, and replaced grid/list button pairs with a layout menu.
- The broad "headers are too large and inconsistent" problem is no longer open-ended backlog work.
- This task is closed so future work starts from a concrete page/screenshot/regression instead of reopening the original broad cleanup frame.

**Completed intent**
- Primary actions and search stay easy to reach.
- Secondary filter detail moved behind compact readback where it helped density.
- Repeated header/search behavior moved into shared primitives instead of page-specific one-off hiding rules.
- Desktop clarity was preserved while mobile density improved.

**Closed scope**
- Mobile app/header stability was completed.
- Utility-page fixed headers were completed for Wishlist, Import, Integrations, Capture Inbox, and Loans.
- Shared page-header/search primitives were added for library-style and utility pages.
- Search behavior was normalized to live updates instead of explicit Search buttons.
- Secondary filters were compacted into funnel menus where useful.
- Library layout controls were consolidated into a layout menu.
- Desktop header copy was cleaned up so library-style pages use compact section-specific headings.
- Mobile section icons and accessibility labels were added for the header/search surfaces.

**Future work rule**
- Do not reopen this broad task for general polish.
- If more work is needed, add a new backlog item with the affected surface, observed problem, intended behavior, and acceptance criteria.

**Completion criteria**
- Mobile pages expose primary search/actions without forcing every secondary filter to stay visible.
- Filter state remains readable before the user opens the secondary controls.
- Search behavior is consistent enough that users do not wonder whether they need to press a Search button.
- Desktop surfaces remain readable and do not inherit mobile-only compaction compromises.
- Shared primitives carry the repeated behavior where possible.

## Product-Level Feature Gaps

These are product-level capability gaps discovered from the current shape of the app. They are not immediate implementation commitments and should stay versionless until one is selected and moved into the roadmap as a numbered milestone.

### Backlog Item: Dashboard Review Rules and Drawer-First Resolution
**Type:** Product/UI maintenance track
**Tags:** `dashboard`, `review`, `collection-health`, `metadata`, `identifiers`, `ux`
**Status:** Completed across `3.11.0` and `3.12.1` through `3.12.14`. Closed as a backlog item; add a new specific backlog item if future real data exposes a review-rule false positive, missing drawer action, or repair flow gap.

**Goal:** Completed the Dashboard Review row/drawer resolution model so collection review work stays inside Dashboard Review, and common review rows guide users toward app-assisted repair before manual provider matching.

**Why this work exists**
- Dashboard Review has proven to be the useful surface for collection cleanup.
- A separate Review page/nav item duplicated Dashboard and Library review filters without adding enough value.
- The drawer model is the right resolution surface, but the rules and available drawer actions still need iteration by media type and source.
- Some missing-identifier rows may reflect provider enrichment gaps, weak imported titles, or source-specific repair needs rather than missing data the user should manually know.

**Completed state**
- `3.11.0` separated true identifier gaps from sparse metadata so digital/manual records are not pushed toward impossible identifiers.
- `3.12.1` removed the standalone Review page/nav item and made Dashboard Review rows open inline drawers.
- `3.12.2` through `3.12.14` added assisted resolution, identifier rule tuning, type-specific drawer actions, defer/dismiss, title cleanup hints, hidden decision readback, decision history, known identity, pending updates, save readiness, manual fallback guidance, sparse metadata lookup, and the standard tabbed Dashboard layout.
- The product rule is now proven: collection-health review work belongs in Dashboard Review rows and drawers unless a future workflow clearly cannot fit there.

**Completed intent**
- Treat Dashboard Review as the primary collection-health review surface.
- Resolve review findings from rows and drawers instead of adding new top-level pages.
- Prefer app-assisted lookup, enrichment, upload, title cleanup, and source repair before manual identifier entry.
- Keep manual fields available as fallback controls, not the main interaction.

**Closed scope**
- True identifier gaps were separated from sparse metadata review findings.
- Standalone Review page/nav behavior was removed.
- Dashboard Review rows open inline drawers for the exact row.
- Missing-cover rows support upload and fallback cover path repair.
- Missing-identifier rows support assisted lookup and candidate apply behavior.
- Sparse-metadata rows support assisted lookup while preserving manual fallback fields.
- Identifier rules were tuned for digital/manual/source-linked records.
- Drawer guidance is media-aware and treats manual entry as fallback.
- Defer, dismiss, restore, hidden decision readback, and decision history were added inside Dashboard Review.
- Known identity, pending updates, and save-readiness readback were added to drawers.
- Dashboard Review now uses the standard tabbed Dashboard layout.

**Future work rule**
- Do not reopen this broad task for general review polish.
- Do not reintroduce a standalone Review page/nav item unless a future workflow clearly cannot fit inside Dashboard Review rows/drawers.
- If more work is needed, add a new backlog item with the affected review category, observed false positive or missing action, intended repair path, and acceptance criteria.

**Completion criteria**
- Future review work starts by asking what the Dashboard row/drawer cannot solve before proposing a new page.
- Missing-identifier findings distinguish true identity absence from provider enrichment gaps.
- Drawer actions are specific to the media type and review reason.
- Users can resolve common review rows without needing to manually research provider IDs.
- Dismiss/defer, if added, is scoped to the row/drawer workflow and does not create a separate review destination.

### Backlog Item: Collection Health and Audit Dashboard
**Type:** Deferred milestone
**Tags:** `product`, `health`, `audit`, `metadata`, `maintenance`
**Status:** Partially served by Dashboard Review and the `3.11`/`3.12` review-rule work; full trend/audit workflow is not implemented.

**Goal:** Show collection maintenance health across libraries and workspaces.

**Intent**
- Make collection maintenance visible and actionable without turning the Dashboard into a giant error log.
- Separate "things need attention" from "the collection has measurable health gaps over time."

**Current state**
- Dashboard Review can surface counts and sample lists for missing covers, missing identifiers, sparse metadata, failed syncs, and Plex conflicts.
- Dashboard Review rows now have row-level clues, inline drawers, assisted repair, defer/dismiss, hidden decision readback, known identity, pending updates, and save-readiness controls.
- Provider health and recent activity exist as operational readback.
- There is no dedicated health/audit view with severity, source, trend, cross-library filtering, or longitudinal repair status.

**Scope**
- Surface missing identifiers, missing covers, duplicate candidates, stale syncs, failed imports, unlinked provider rows, and low-confidence metadata.
- Keep health findings explainable and actionable instead of presenting a vague score.
- Support workspace/library/type/provider filters.
- Include enough source context to explain why a finding exists and where to fix it.

**Candidate subtasks**
- Define health finding categories and severity rules.
- Reuse Dashboard Review findings where possible instead of creating a second review destination.
- Add trend/history readback only if the Dashboard Review snapshot is not enough to understand health over time.
- Add stale-sync and failed-import diagnostics that link back to sync job/activity evidence.
- Add a maintenance history/readback path so dismissed or resolved findings do not reappear without context.

**Acceptance Criteria**
- Users can identify the most important collection maintenance issues.
- Health findings can be filtered by library, media type, provider, and severity.
- Each finding links to a repair, review, or source record where available.

### Backlog Item: Universal Search
**Type:** Deferred milestone
**Tags:** `product`, `search`, `navigation`, `identifiers`
**Status:** Active backlog; current search remains section-specific plus scanner/provider lookup flows.

**Goal:** Search across media, books, comics, games, art, collectibles, events, people, vendors, identifiers, and provider IDs.

**Intent**
- Let users find an object without remembering which library, provider, event, or workflow owns it.
- Make barcode/ISBN/UPC/provider-id lookups a normal navigation path, not only an import/capture path.

**Current state**
- Library search, provider lookup, scanner barcode/ISBN lookup, event search, and admin/search-like workflows exist separately.
- There is no app-wide command/search surface that returns typed destinations across collection objects and operational records.

**Scope**
- Include barcode, ISBN, UPC, provider identity, artist, vendor, event, and object-title lookups.
- Provide direct navigation to matched records.
- Keep search scoped to the user's accessible workspace and library permissions.

**Candidate subtasks**
- Define a shared search result shape with object type, title, subtitle, source, destination, and match reason.
- Add a backend global-search endpoint that fans out to existing scoped object queries.
- Add identifier-first matching for ISBN/UPC/provider IDs before title search.
- Add a compact command/search UI that can navigate directly to records.
- Later: include review queue findings, activity entries, people/places, and provider sync records.

**Acceptance Criteria**
- Users can find known records without knowing which section owns them.
- Identifier searches return direct object matches where possible.
- Search results clearly show object type and destination.

### Backlog Item: Saved Views and Smart Collections
**Type:** Deferred milestone
**Tags:** `product`, `saved-views`, `smart-collections`, `filters`
**Status:** Active backlog; no durable saved-view model exists yet.

**Goal:** Let users save reusable filtered views across collection data.

**Intent**
- Turn repeated filters into named, reusable views without requiring users to rebuild them every time.
- Start as saved filters before adding rule automation or collection-like ownership semantics.

**Current state**
- Many library screens have filters and sort state.
- Dashboard and provider surfaces expose some fixed views.
- Users cannot save custom filtered views or share workspace-scoped smart views.

**Scope**
- Support views such as unread Kavita comics, signed art, missing ISBNs, event-purchased items, recent imports, watched but unowned media, and needs-review items.
- Keep saved views as user/workspace-scoped filters before introducing heavier rule automation.

**Candidate subtasks**
- Define saved view storage: owner, workspace/library scope, object type, filters, sort, display mode, and visibility.
- Add create/update/delete/list endpoints for saved views.
- Add UI affordances to save the current library filter state.
- Add a "Saved Views" entry point in the library/dashboard navigation.
- Later: support smart collection badges, shared workspace views, and review/health-driven views.

**Acceptance Criteria**
- Users can save, name, open, and update reusable filtered views.
- Saved views preserve the relevant filters and sort choices.
- Views remain permission-aware across workspaces and libraries.

### Backlog Item: People and Places Model
**Type:** Deferred milestone
**Tags:** `product`, `people`, `places`, `identity`, `events`
**Status:** Partially implemented for Art artist records and event-local attendees; broader scoped identity model remains backlog.

**Goal:** Introduce reusable scoped identities for creators, vendors, venues, friends, publishers, stores, and event-related people.

**Intent**
- Reduce repeated free-text names where reuse has real value, while keeping lightweight one-off entry intact.
- Keep identity scoped to a workspace unless a later milestone explicitly defines a broader boundary.

**Current state**
- Reusable Artist records for Art shipped in `3.4.152`, including inline creation, reuse, links, notes, role readback, and other-works navigation.
- Event attendees can be linked to app users for current-user/self attendee behavior, and event-local people/group/meetup readback exists from the event social planning work.
- Vendor, venue, publisher, store, friend/contact, and broader creator identities are still mostly free text or object-local fields.

**Scope**
- Keep this distinct from a social network or broad friend graph.
- Support reusable people/place references for artists, vendors, venues, publishers, stores, attendees, and event contacts where useful.
- Preserve workspace ownership and privacy boundaries.

**Candidate subtasks**
- Inventory existing person/place-like fields and decide which should stay free text.
- Define scoped people/place records with roles, aliases, links, and source provenance.
- Extend artwork artists only after proving migration/backfill behavior.
- Add vendor and venue reuse for events/convention purchases if it reduces repeated entry.
- Keep "friends" limited to event-local coordination/contact records unless a later friend graph is selected.

**Acceptance Criteria**
- People and places can be reused without duplicating plain-text fields everywhere.
- Existing item-local text remains usable where a reusable record is unnecessary.
- The model does not imply cross-workspace identity or social graph behavior by default.

### Backlog Item: Reusable Collectible Traits Across Libraries
**Type:** Deferred milestone
**Tags:** `product`, `collectibles`, `metadata`, `traits`, `cross-library`
**Status:** Partially served by Art signed/numbered metadata, reusable artists, and event-acquired fields; a generalized cross-library trait model is not implemented.

**Goal:** Add reusable collectible traits that can be surfaced in existing object drawers without creating new top-level libraries for every collectible category.

**Why this work exists**
- Many collectible concepts apply across Books, Comics, Games, Art, Media, and Collectibles: signed, numbered, graded, certified, variant, bundled, and event-acquired.
- Modeling each category as its own library would make the app heavier and harder to maintain.
- Shared traits let collectZ improve specificity while keeping existing library surfaces intact.

**Current state**
- Art already has item-local signature, print number/run, dimensions, linked event, vendor/booth, exclusive, and reusable artist behavior.
- Some libraries have local format/source/signature-like fields, but there is no shared trait schema or shared drawer behavior across Books, Comics, Games, Media, Art, and Collectibles.
- This task should not restart the already-shipped Art-specific work; it should decide what becomes reusable outside Art.

**Intent**
- Treat traits as optional object capabilities shown only when useful for the selected library/type.
- Preserve lightweight manual entry and avoid forcing every row into collectible-level detail.
- Make future UI drawers explain what makes an item special without burying users in fields.

**Scope**
- Define reusable trait families:
  - `signed/autographed`: signer, date, event/location, personalization, witnessed/authenticated.
  - `numbered/limited`: item number, run size, artist proof, printer proof, remarque, limited edition.
  - `graded`: grading company, grade, certificate number, slab/case notes.
  - `certificate/provenance`: COA present, issuer, certificate number, document/image attachment, source/vendor.
  - `edition/variant`: format, platform, region, printing, package variant, collector edition, promo/demo/screener/ARC.
  - `bundle/related item`: included with, part of box set, came with collector edition, linked companion object.
  - `event acquired`: event, vendor, booth, exclusive status, pickup notes.
- Decide which traits appear for each library surface and item type.
- Keep this as a model/UI capability task, not enrichment or valuation work.

**Candidate subtasks**
- Inventory current fields for signed, numbered, event-linked, edition, variant, and collectible category data.
- Define a trait schema that can be attached to existing object types without duplicating whole records.
- Add drawer/edit display rules for trait sections by library and item type.
- Add compact readback badges or metadata lines only where they improve recognition.
- Add tests for trait persistence and rendering across at least Art, Comics, Books, Games, Media, and Collectibles.

**Out of scope**
- Do not create new top-level libraries for every collectible type.
- Do not automatically duplicate media rows into Collectibles.
- Do not add valuation, external registry enrichment, or marketplace pricing in this first trait-model task.
- Do not make traits required for normal media/book/game entry.

**Acceptance Criteria**
- Users can mark relevant rows as signed, numbered, graded, certified/provenance-backed, variant/edition-specific, bundled/related, or event-acquired.
- Trait fields are available where useful and hidden or lightweight where irrelevant.
- Existing library objects remain the canonical records unless a later relationship task intentionally links a companion object.
- The UI makes special collectible details readable without making ordinary add/edit flows feel heavier.

### Backlog Item: Physical Media Edition and Variant Modeling
**Type:** Deferred milestone
**Tags:** `media`, `games`, `books`, `variants`, `editions`, `physical-media`
**Status:** Active backlog; some local format/source fields exist, but edition/variant modeling is not generalized.

**Goal:** Improve how collectZ represents physical media variants such as SteelBooks, slipcovers, screeners, promo/demo discs, limited-run releases, collector editions, ARCs, and book printings.

**Why this work exists**
- SteelBooks, slipcovers, DVD/Blu-ray/VHS variants, and limited packaging should generally stay in the same media/library family as the owned title.
- Games need platform/source behavior similar to movie/TV format, plus region, publisher line, collector edition, promo/demo, and limited-run distinctions.
- Books need edition/printing and limited-run fields for first editions, later printings, ARCs, advance reader copies, and numbered editions.

**Current state**
- Media rows can already carry formats and source/provider identity, and Art can carry numbered-print details.
- Games, Books, Movies/TV, and Audio do not yet share a deliberate edition/variant vocabulary.
- This item should not create duplicate Collectibles rows for ordinary format variants.

**Scope**
- Treat SteelBook, slipcover, screener, promo disc, and packaging variants as edition/format metadata on media rows.
- Treat game platform as a format-like ownership dimension while also supporting region, digital/physical source, collector edition, promo/demo, and limited-run details.
- Treat book edition, printing, ARC/advance-reader-copy state, and limited-numbered runs as book-specific edition metadata.
- Keep screeners and promo/demo discs close to their media/game record instead of forcing them into Collectibles.

**Candidate subtasks**
- Inventory current format/platform fields for Movies, TV, Games, Books, and Audio.
- Define a shared edition/variant readback vocabulary with library-specific labels.
- Add add/edit drawer controls for variant fields only where the selected type supports them.
- Update list/detail surfaces to show variant labels compactly.
- Add tests for media, game, and book variant entry and repeat editing.

**Out of scope**
- Do not build direct storefront/game-platform syncs here.
- Do not add hardware/peripheral inventory to Games in this task.
- Do not convert every box set into a separate Collectibles row.
- Do not add external valuation or market rarity scoring.

**Acceptance Criteria**
- Media variants can be tracked without leaving the owning media library.
- Game platform/edition/region/source details are visible enough to distinguish owned copies.
- Book edition, printing, ARC, and limited-run details can be recorded and read back.
- Variant modeling does not create confusing duplicate canonical records.

### Backlog Item: Certification, Grading, and Provenance Traits
**Type:** Deferred milestone
**Tags:** `collectibles`, `comics`, `books`, `art`, `grading`, `coa`, `provenance`
**Status:** Active backlog; signature/provenance-adjacent fields exist in Art, but generalized grading/COA/provenance support is not implemented.

**Goal:** Add consistent certificate, grading, and provenance support across collectible-like objects without tying it to one category.

**Why this work exists**
- CGC/CBCS graded comics, graded cards, graded games, signed books/comics, COAs, witnessed signatures, authenticated autographs, and provenance documents share a common evidence model.
- Users need to know whether a signature or collectible claim is self-entered, witnessed, certified, or backed by a document/image.
- Grading overlays and badges may be useful, but the underlying data should come first.

**Current state**
- Art can record signed/numbered/event/vendor context, but it does not provide a reusable certificate/provenance attachment model.
- Comics, Books, Games, Collectibles, and Media do not yet share grade, cert number, issuer, COA, slab/case, or provenance readback.
- Any future visual badge/overlay should follow stored data rather than define the data model.

**Scope**
- Support grading company, grade, cert number, slab/case notes, and optional cert URL/image.
- Support COA/provenance issuer, certificate number, source/vendor, event, and attachment linkage.
- Support signed/autographed readback with signer, date, event/location, personalization, and authentication state.
- Consider visual grade/cert badges or overlays for poster/card/grid views after data and readback are proven.

**Candidate subtasks**
- Define the shared certification/provenance data shape.
- Map where it applies: Comics, Books, Art, Collectibles, Games, and selected Media items.
- Add UI controls in drawers with compact default state and expanded details when a cert/grade is present.
- Add detail/list readback for grade, cert, signed, and COA indicators.
- Add tests for graded comic, signed book with COA, certified art print, and authenticated collectible flows.

**Out of scope**
- Do not integrate with CGC, CBCS, PSA, JSA, Beckett, or other registry APIs in the first slice.
- Do not estimate value from grade or certification.
- Do not require certificates for signed/autographed items.
- Do not silently upgrade user-entered provenance with provider data.

**Acceptance Criteria**
- A user can record grade/cert/provenance details where relevant.
- Signed and certified states are distinguishable in readback.
- Attachments or certificate references can be linked without exposing private files unintentionally.
- Visual badges/overlays, if added, reflect stored data and do not replace detail readback.

### Backlog Item: Related Object and Bundle Relationships
**Type:** Deferred milestone
**Tags:** `collections`, `relationships`, `bundles`, `box-sets`, `collectibles`, `events`
**Status:** Active backlog; event/art context links exist, but general object-to-object bundle relationships are not implemented.

**Goal:** Link items that belong together, such as box sets, bundled trading cards, collector-edition extras, strategy guides, soundtrack inserts, posters, pins, and event-acquired companion objects.

**Why this work exists**
- Some objects naturally belong to another owned item without becoming the same record.
- Automatic duplication into another library would create "which row is canonical?" confusion.
- A relationship model can show "included with" or "part of" context while preserving each object's owning library.

**Current state**
- Art and event workflows can carry event/vendor/booth context, and event social planning has its own local relationship/readback model.
- There is no general relationship model for "included with," "part of box set," "companion to," or linked cross-library extras.
- The previously discussed "replicate/sync into Collectibles" idea should remain out of scope unless a later milestone proves duplication is truly needed.

**Scope**
- Support relationships such as `part_of`, `includes`, `included_with`, `companion_to`, `purchased_with`, and `event_acquired_with`.
- Allow a media/game/book/comic row to link to Art or Collectibles rows for posters, cards, signed prints, guides, tickets, merch, or extras.
- Support box-set parent/child readback without requiring every child to be entered immediately.
- Preserve event/vendor/booth context where the relationship came from a convention or purchase.

**Candidate subtasks**
- Inventory current event/art/media link behavior and avoid duplicating existing relationships.
- Define relationship types, direction, display labels, and delete behavior.
- Add simple link/unlink UI from detail drawers.
- Add readback sections such as "Included items", "Part of box set", or "Related collectibles".
- Add tests for bundled card, box set, strategy guide linked to game, and poster linked to movie/comic/event.

**Out of scope**
- Do not automatically create duplicate rows in Collectibles when a box set is checked.
- Do not add inventory quantity, valuation rollups, or ownership hierarchy accounting in the first slice.
- Do not turn relationships into a social graph or broad knowledge graph.

**Acceptance Criteria**
- Users can link related objects without duplicating canonical records.
- Relationship direction and meaning are clear in the UI.
- Deleting or editing one object does not silently destroy another related object.
- Bundled/extras context is visible from both sides where useful.

### Backlog Item: Collectible Type Taxonomy Expansion
**Type:** Task
**Tags:** `collectibles`, `taxonomy`, `events`, `music`, `memorabilia`
**Status:** Active backlog; small taxonomy/UI cleanup candidate after trait direction is stable.

**Goal:** Expand the existing Collectibles type dropdown for common memorabilia that belongs in Collectibles rather than Media or Art.

**Why this work exists**
- Several collectible categories can be supported as selectable types without new schema-heavy modeling.
- Badges, lanyards, pins, patches, stickers, tickets, setlists, programs, merch, props, figures, cards, and hardware/peripherals need consistent labels.
- Posters, one-sheets, lobby cards, tour posters, original pages, and display-focused prints may belong better in Art, so taxonomy should not overreach.

**Scope**
- Add or normalize dropdown options for convention/event items, music memorabilia, pop-culture memorabilia, hardware/peripherals, props/replicas, cards, and merch.
- Keep Art-oriented print/display objects in Art unless a later milestone intentionally changes that boundary.
- Add optional notes or type descriptions where labels could be ambiguous.
- Preserve existing collectible rows and current dropdown values.

**Candidate subtasks**
- Inventory current collectible type values and real user-entered examples.
- Define additions and aliases for event, music, memorabilia, hardware/peripheral, and merch categories.
- Add migration/backfill only if current values need normalization.
- Update add/edit UI and tests for the expanded dropdown.

**Out of scope**
- Do not add reusable traits, grading, COA, bundle relationships, or valuation in this taxonomy-only task.
- Do not move existing Art records into Collectibles automatically.
- Do not rename top-level Collectibles unless a separate naming review is promoted.

**Acceptance Criteria**
- Common convention, music, memorabilia, hardware/peripheral, prop, card, and merch items have clear type choices.
- Existing rows keep working.
- The taxonomy does not blur Art and Collectibles boundaries without an explicit future decision.

### Backlog Item: Backup, Export, and Portability UX
**Type:** Deferred milestone
**Tags:** `product`, `backup`, `export`, `portability`, `homelab`
**Status:** Active backlog; docs/runbooks exist, but in-app trust/readback is not implemented.

**Goal:** Make data trust visible in the app, not only in docs.

**Intent**
- Help self-hosted and platform users understand where their data lives, whether backup/export paths are healthy, and how portable their collection is.
- Keep sensitive backup details redacted while making operational confidence visible.

**Current state**
- Public docs and runbooks describe configuration, backup/restore, environment, and deployment behavior.
- The app does not provide an in-product backup/export status dashboard.

**Scope**
- Surface export data, export images, backup status, restore guidance, storage location readback, and portability checks.
- Keep operator docs as the detailed runbook while giving users an in-app confidence/readiness surface.

**Candidate subtasks**
- Add read-only backend endpoints for database/storage/export capability readback.
- Show storage locations and configured backup/export status with secrets redacted.
- Add manual export actions only after readback and permissions are clear.
- Add portability checks for database rows, uploaded media, provider-linked metadata, and release/runtime version.
- Link to sanitized docs/runbooks from the in-app surface.

**Acceptance Criteria**
- Users can see whether backups and exports are configured and recent.
- Export/restore guidance is visible from the app without exposing secrets.
- Data portability coverage is clear for database records, images, and provider-linked metadata.

### Backlog Item: Apple/iTunes Wishlist Price Watch Follow-ups
**Type:** Deferred milestone
**Tags:** `wishlist`, `apple-itunes`, `price-watch`, `notifications`, `review`
**Status:** Mostly completed for search/save/refresh/history/scheduler/target-hit workflow; remaining work is optional notification and richer price-history polish only.

**Goal:** Preserve future Apple/iTunes Wishlist price-watch ideas without treating them as current priority work.

**Why this work exists**
- The Apple/iTunes Wishlist foundation can already search, save, refresh prices, store history, run an opt-in scheduler, surface target-price hits, and mark hits ordered or dismissed.
- The remaining work is useful only if Apple/iTunes price watching becomes personally or product-significant later.

**Scope**
- Add optional price-drop notification behavior for target-price hits.
- Improve price-history UX with trends, lowest-seen readback, or compact charts.
- Research better Apple movie/catalog matching only if Apple/iTunes movie acquisition tracking becomes important.
- Keep scheduled polling conservative, opt-in, and rate-limit aware.
- Keep target-price hit handling inside Wishlist unless a future Dashboard Review or notification workflow proves it needs a broader routing surface.

**Out of scope**
- Do not add auto-purchase behavior.
- Do not make Apple/iTunes the default Wishlist acquisition path.
- Do not prioritize this ahead of higher-value collection, capture, import, or review workflows unless explicitly selected.

**Acceptance Criteria**
- Users can opt into any alerting or polling behavior.
- Price-watch decisions remain explainable from stored price history and provider metadata.
- Target-price hits can be reviewed or dismissed without creating noisy duplicate work.

## UI/UX Cleanup Working Plan

These tasks are intentionally ordered so quick hygiene work does not get buried under larger UI refactors.

### Active UI/UX Review Callouts
**Status:** Mostly completed through the `3.10.x` UI/UX line; keep as a historical working frame and only reopen with a concrete page-level issue.

**Goal:** Keep the remaining high-value webapp polish findings visible while continuing focused page-by-page UI/UX cleanup.

**Current verified context**
- Running-stack visual review at `3.10.6` showed the mobile library headers were much improved: no horizontal overflow, compact page chrome, stable pagination, and cleaner search/filter/action placement.
- Later `3.10.x` patches added shared header/search primitives, utility-page header compaction, live search normalization, Capture Inbox filter compaction, icon-led mobile library headers, desktop header cleanup, funnel filters, and layout-menu controls.
- The active broad UI/UX round is effectively closed; future UI work should be promoted from concrete page-level issues, not from this general callout list.

**Important follow-up tasks**
- `Mobile Page Title Deduplication for Non-Library Pages`
  - Dashboard, Wishlist, Import, Integrations, and Loans still show the compact mobile shell title and then repeat the same page title below.
  - Bring these pages into the same deduped mobile-title pattern used by the library pages.
  - Preserve desktop page headings unless a specific desktop simplification is selected.
- `Wishlist Mobile Density and Apple/iTunes Utility Compression`
  - Wishlist is still the busiest mobile surface.
  - Compress Apple/iTunes search and price-refresh controls so the actual wishlist is reachable sooner.
  - Make `Refresh saved prices`, `Auto refresh off`, and `Run auto refresh now` feel like a coherent compact utility control group rather than loose text.
- `Desktop Sidebar Growth and Bottom Account Area Review`
  - Desktop sidebar is close to crowding lower navigation/admin content when the account area, help counts, and expanded groups are all visible.
  - Review sidebar scroll behavior, bottom padding, and account menu anchoring before adding more permanent nav items.
- `Dashboard Top Summary Row Purpose Review`
  - Dashboard Review panel is now stronger than the top metrics row.
  - Revisit whether `Items`, `Missing covers`, and `Missing identifiers` should remain as top-row metrics, become more action-oriented, or be visually subordinated.
  - Avoid turning Dashboard into database telemetry when the Review panel already provides the actionable path.

**Working rule**
- When selecting the next UI/UX patch, check these callouts first and either promote one into the roadmap or explicitly state why another page issue is more urgent.
- Do not let these become vague backlog memory; close or revise the callout when each issue is fixed and verified.

1. Promote and complete `Release Evidence Token Hygiene Cleanup` by redacting fixed Playwright token examples and adding a guard against reintroducing them.
2. `Shared Detail Drawer Shell Primitive` and `Mobile Drawer Density Audit and Follow-up` were promoted together as `3.4.26`; continue with image/proof parity next.
3. `Image and Proof Control Language Parity` was promoted as `3.4.27`; finish that parity pass before moving to API/provider search work.
4. `TMDB Rate-Limit Investigation and Search Optimization` was promoted as `3.4.28`; keep remaining naming/social items separate after this provider/search slice.
5. `Collectibles Naming Review` was promoted as `3.4.29`; keep the current Collectibles name unless a later milestone intentionally revisits it.
6. `Event Social Planning Foundation` was promoted as `3.4.30`; keep `Event Social Planning Mobile Web Experience` queued behind the durable event-social data model.
7. `Personal Sched ICS Schedule Sync` was promoted as `3.4.31`; keep full schedule catalog/Now-Next discovery separate from personal selected-session sync.
8. The schedule-readability slice of `Event Social Planning Mobile Web Experience` was promoted as `3.4.33`; keep the broader mobile/social companion experience queued behind this drawer polish.
9. The day navigation and current/next readability slice of `Event Social Planning Mobile Web Experience` was promoted as `3.4.34`; keep the remaining schedule polish follow-ups queued as separate patch-sized tasks.
10. `Event Schedule Expanded Row Detail Polish` was promoted as `3.4.35`; keep quiet remove actions and Sched feed failure state queued separately.
11. `Event Schedule Quiet Remove Actions` was promoted as `3.4.36`; keep Sched feed failure state queued separately.
12. `Event Sched Feed Failure State Polish` was promoted as `3.4.37`; keep full schedule catalog and native companion sync visibility separate.
13. The mobile overview slice of `Event Social Planning Mobile Web Experience` was promoted as `3.4.38`; keep fast meetup updates, shared schedule item editing, and native companion behavior separate.
14. The fast meetup status and notes slice of `Event Social Planning Mobile Web Experience` was promoted as `3.4.39`; keep shared schedule editing, notifications, and native companion behavior separate.
15. The shared schedule item editing slice of `Event Social Planning Mobile Web Experience` was promoted as `3.4.40`; keep notifications, full schedule catalog discovery, and native companion behavior separate.
16. The private/shared visual treatment slice of `Event Social Planning Mobile Web Experience` was promoted as `3.4.41`; keep vendor/booth/location notes, notifications, full schedule catalog discovery, and native companion behavior separate.
17. The vendor/booth/location notes slice of `Event Social Planning Mobile Web Experience` was promoted as `3.4.42`; keep notifications, full schedule catalog discovery, and native companion behavior separate.
18. The compact contract slice of `Event Social Planning Platform Companion Contract` was promoted as `3.4.43`; keep native UI, push notifications, full schedule catalog discovery, offline mutation queues, realtime location, and broad social discovery separate.
19. `Platform Companion Personal Sched ICS Sync Visibility` was promoted as `3.4.44`; keep native UI, full schedule catalog discovery, background polling, push notifications, and offline mutation queues separate.
20. `Platform Companion Offline Event Packet` was promoted as `3.4.45`; keep full schedule catalog discovery, native UI, background polling, push notifications, realtime location, and offline mutation queues separate.
21. The shared session presence slice of event-local social discovery polish was promoted as `3.4.76`; keep event-local editing, cross-event identity, and delivery/provider work separate.
22. The social discovery readback slice of event-local social discovery polish was promoted as `3.4.77`; keep inline attendee/group/meetup editing, global friend graph work, and realtime presence separate.
23. The event-local social editability slice was promoted as `3.4.78`; keep cross-event identity, realtime presence, native companion social mutation UX, and true friend-graph work separate.
24. The self-attendee auto-link and `Add me` flow slice was promoted as `3.4.79`; keep external contact identities, cross-event identity, and broader friend graph work separate.
25. The self-attendee header-affordance polish slice was promoted as `3.4.80`; keep external contact identities, cross-event identity, and broader friend graph work separate.
26. The self-attendee default-creation slice was promoted as `3.4.81`; keep external contact identities, cross-event identity, and broader friend graph work separate.
27. The attendee duplicate guardrails slice was promoted as `3.4.82`; keep external contact identities, cross-event identity, Discord delivery, and broader friend graph work separate.
28. The mobile day-of social summary slice of `Event Social Planning Mobile Web Experience` was promoted as `3.4.83`; keep native companion behavior, push/Discord/email delivery, cross-event identity, external contacts, realtime presence, and broader friend graph work separate.
29. The mobile time-window filter slice of `Event Schedule Catalog Now/Next Follow-ups` was promoted as `3.4.84`; keep full catalog discovery redesign, native companion behavior, push/Discord/email delivery, cross-event identity, realtime presence, and broader friend graph work separate.
30. `Kavita Digital Library Integration` was promoted as `3.4.85`; keep metadata writeback, in-app/embedded reading, full import/sync, cross-provider digital-library abstractions, and reading-progress workflows separate.
31. The Kavita import/sync foundation, metadata mapping, and volume/chapter enrichment slices were promoted as `3.4.86`, `3.4.87`, and `3.4.88`; keep reader launch/progress discovery, metadata writeback, chapter-as-issue row fan-out, per-space Kavita administration, and shared provider abstractions as versionless backlog tasks until selected.
32. `Kavita External Reader Launch Contract` was promoted as `3.4.89`; keep embedded iframe reading, page streaming, reading progress sync, metadata writeback, and per-space Kavita administration separate.
33. `Kavita Reader and Progress Contract Discovery` was promoted as `3.4.91`; keep embedded iframe reading, page streaming, reading progress writeback, and per-space Kavita administration as separate backlog tasks until selected.
34. `Kavita Chapter-as-Issue Row Fan-out` was promoted as `3.4.92`; keep embedded reading, progress sync, metadata writeback, per-space Kavita administration, and shared provider abstractions separate until selected.
35. `Kavita Chapter-as-Issue Row Fan-out Implementation` was promoted as `3.4.93`; keep embedded reading, progress sync, metadata writeback, per-space Kavita administration, and shared provider abstractions separate.
36. `Kavita Workspace-Owned Integration Administration Contract` was promoted as `3.4.94`; keep implementation, embedded reading, progress sync, metadata writeback, and shared provider abstractions separate.
37. `Kavita Workspace-Owned Integration Administration Implementation` was promoted as `3.4.95`; keep embedded reading, progress sync, metadata writeback, special-chapter import, and shared provider abstractions separate.
38. `Kavita Metadata Writeback Contract` was promoted as `3.4.96`; keep actual writeback preview/apply UI, progress sync, external enrichment writeback, and shared provider abstractions separate.
39. `Kavita Metadata Writeback Preview and Diff` was promoted as `3.4.97`; keep actual writeback apply, progress sync, external enrichment writeback, locked-field override, and shared provider abstractions separate.
40. `Kavita Metadata Writeback Apply` was promoted as `3.4.98`; keep background sync, progress sync, external enrichment writeback, locked-field override, and shared provider abstractions separate.
41. `Kavita Writeback Field Selection UI` was promoted as `3.4.99`; keep background sync, progress sync, external enrichment writeback, locked-field override, and shared provider abstractions separate.
42. `Kavita Reading Progress Sync Contract` was promoted as `3.4.100`; keep actual progress UI/read implementation, progress writeback, embedded reading, page proxying, and shared provider abstractions separate.
43. `Kavita Read-Only Progress Visibility` was promoted as `3.4.101`; keep progress writeback, mark read/unread, embedded reading, page proxying, background polling, and shared provider abstractions separate.
44. `Kavita Progress Writeback and Page Proxy Reader` was promoted as `3.4.102`; keep mark read/unread, iframe/full embedded reader ownership, PDF/raw chapter file proxying, background polling, KOReader sync, and shared provider abstractions separate.
45. `Kavita Mark Read/Unread Contract` was promoted as `3.4.103`; keep runtime mark read/unread implementation, full embedded reader ownership, PDF/raw chapter file proxying, background polling, KOReader sync, and shared provider abstractions separate.
46. `Kavita Chapter Mark-Read Implementation` was promoted as `3.4.104`; keep series-wide mark read/unread, volume-wide mark read, chapter unread, full embedded reader ownership, PDF/raw chapter file proxying, background polling, KOReader sync, and shared provider abstractions separate.
47. `Kavita Chapter Unread Contract` was promoted as `3.4.105`; the reset-progress runtime proof was promoted as `3.4.106`; the explicit reset-progress implementation was promoted as `3.4.107`; reader-control polish was promoted as `3.4.108`; keep true chapter unread, full embedded reader ownership, PDF/raw chapter file proxying, background polling, KOReader sync, and shared provider abstractions separate.
48. `Plex PMS API Modernization Foundation` was promoted as `3.4.111`; the provider-discovery runtime proof was promoted as `3.4.112`; real-server provider discovery readback was promoted as `3.4.113`; Now Playing provider proof was promoted as `3.4.114`; Now Playing readback endpoint was promoted as `3.4.115`; Now Playing UI readback was promoted as `3.4.116`; real PMS Now Playing runtime proof was promoted as `3.4.117`; Now Playing Viewer was promoted as `3.4.118`; Now Playing Display Token was promoted as `3.4.119`; Now Playing Display Preferences was promoted as `3.4.120`; Plex Now Playing Vertical Poster Display was promoted as `3.4.121`; Plex Webhook and Ratings Sync Contract was promoted as `3.4.122`; Plex Webhook Receiver Administration Contract was promoted as `3.4.123`; Plex Webhook Receiver Processing and Import Enqueue Contract was promoted as `3.4.124`; Plex Single-Rating-Key Import Processing from Webhook Hints was promoted as `3.4.125`; Plex Webhook Import Hint Auto-Processor was promoted as `3.4.126`; Plex Webhook Existing Receiver Readback was promoted as `3.4.127`; Plex Watch-State Sync Cadence Contract was promoted as `3.4.128`; Plex Watched-State Apply Implementation was promoted as `3.4.129`; Plex Watched-State Scheduled Refresh was promoted as `3.4.130`; Plex Rating Readback Apply Implementation was promoted as `3.4.131`; Plex Watched-State Writeback Contract was promoted as `3.4.132`; Plex Watched-State Writeback Implementation was promoted as `3.4.133`; Plex Rating Writeback to Plex was promoted as `3.4.134`; Plex Writeback UI Controls was promoted as `3.4.135`; Plex Full-Library Reconciliation Contract was promoted as `3.4.136`; Plex Scheduled Reconciliation Preview Job was promoted as `3.4.137`; User Rating Scale Normalization was promoted as `3.4.138`; Temporary Reconciliation Review UI was promoted as `3.4.139`; Plex Reconciliation Auto-Sync and Conflict Review was promoted as `3.4.140`; Plex Reconciliation Full-Scan and Scheduler Automation was promoted as `3.4.141`; Plex Episode-Aware TV Sync and Writeback was promoted as `3.4.142`; Plex Reconciliation Conflict Review and Resolution was promoted as `3.4.143`; Plex Attach-Existing Conflict Resolution Contract was promoted as `3.4.144`; Plex Provider/API Import Parity Contract was promoted as `3.4.145`; Plex Provider Item-Listing API Discovery was promoted as `3.4.146`; Plex Real PMS Provider Item-Row Parity Proof was promoted as `3.4.147`; Plex Now Playing Multi-Session Display Polish was promoted as `3.4.148`; Plex Provider-Advertised Path Import Migration Contract was promoted as `3.4.149`; Plex Provider-Advertised Sections Root Runtime Migration was promoted as `3.4.150`; keep broad import rewrites separate.
49. `Kavita Comic Series Title Normalization and Issue Mapping` was promoted as `3.4.153`; `Kavita Comic Issue Coverage Guardrails` was promoted as `3.4.154`; `Kavita Numeric Comic Library Type Fan-out Fix` was promoted as `3.4.155`; `Kavita Chapter Issue Cover Proxy` was promoted as `3.4.156`; keep true chapter unread, embedded reader ownership, PDF/raw chapter file proxying, background polling, KOReader sync, repair of older already-imported rows, cover 404 recovery for missing Kavita source images, issue coverage audit, and shared provider abstractions separate.
50. `Barcode Scanner Backend Import API` was promoted as `3.4.157`; keep native scanner UI changes, public lookup exposure, bulk scanning queues, and frontend-mediated scanner flows separate.

### Backlog Item: Kavita True Chapter Unread Runtime Support
**Type:** Task
**Tags:** `kavita`, `reading-progress`, `read-state`, `comics`

**Goal:** Add real chapter unread behavior only if Kavita exposes a safe runtime contract for reversing chapter read state.

**Why this work exists**
- The first Kavita read-state work proved chapter mark-read and reset-progress behavior.
- True unread remains separate because the available runtime behavior needs proof before exposing UI that claims to reverse read state.

**Scope**
- Re-probe Kavita runtime behavior for chapter unread or equivalent reverse-read semantics.
- Add backend support only for a verified, chapter-scoped operation.
- Keep reset-progress behavior distinct from true unread in API and UI copy.
- Preserve workspace-owned Kavita credential boundaries and secret-free readback.

**Acceptance Criteria**
- Runtime smoke proves the exact Kavita call used for unread behavior.
- The UI does not label reset-progress as unread.
- If Kavita does not expose a safe operation, the slice closes with documented unsupported behavior instead of adding a misleading control.

### Backlog Item: Kavita Embedded Reader Ownership and File Proxying
**Type:** Deferred milestone
**Tags:** `kavita`, `reader`, `proxy`, `pdf`, `comics`, `books`

**Goal:** Decide whether collectZ should own a fuller embedded Kavita reading experience beyond current launch/page-control behavior.

**Scope**
- Evaluate full iframe ownership, chapter page proxying, PDF/raw chapter file proxying, and browser security constraints.
- Keep external Kavita launch behavior intact.
- Keep reading progress writeback explicit and user-controlled.
- Avoid exposing Kavita credentials, download URLs, or raw file paths to the frontend.

**Acceptance Criteria**
- The reader ownership boundary is documented.
- Any proxy endpoint is authenticated, workspace-scoped, and secret-free in browser-visible payloads.
- Existing external launch and page-control behavior keep working.

### Backlog Item: Kavita Background Progress Polling and KOReader Sync
**Type:** Deferred milestone
**Tags:** `kavita`, `sync`, `progress`, `koreader`, `background-jobs`

**Goal:** Explore recurring read-progress sync from Kavita and possible KOReader interoperability without making foreground import flows heavier.

**Scope**
- Define safe polling cadence and workspace ownership rules.
- Track progress changes without creating noisy writeback loops.
- Evaluate KOReader sync inputs and conflict behavior separately from Kavita-native progress.
- Keep manual import/sync and explicit progress writeback behavior intact.

**Acceptance Criteria**
- Background polling has clear cadence, ownership, and failure behavior.
- Progress conflicts are observable and do not silently overwrite newer user state.
- KOReader sync is represented as a separate provider path if it proves viable.

### Backlog Item: Kavita External Enrichment Writeback and Locked-Field Overrides
**Type:** Deferred milestone
**Tags:** `kavita`, `metadata`, `writeback`, `metron`, `google-books`, `enrichment`

**Goal:** Extend Kavita metadata writeback beyond manual field selection by safely using external enrichment sources and explicit locked-field decisions.

**Scope**
- Compare collectZ-enriched metadata from comics/books providers against Kavita fields.
- Add explicit locked-field override decisions before changing Kavita-owned metadata.
- Keep preview/diff and manual apply behavior as the required safety layer.
- Avoid automatic background writeback until conflicts and ownership are well understood.

**Acceptance Criteria**
- External enrichment candidates are shown with provenance before writeback.
- Locked Kavita fields require an explicit user override.
- Writeback remains auditable and workspace-scoped.

### Backlog Item: Kavita Special-Chapter Import Handling
**Type:** Task
**Tags:** `kavita`, `imports`, `comics`, `metadata`

**Goal:** Handle Kavita special chapters, annuals, one-shots, and non-standard issue numbering without corrupting normal series or chapter-as-issue rows.

**Scope**
- Identify Kavita chapter records that do not map cleanly to ordinary issue numbers.
- Preserve source identity and title metadata for specials.
- Keep normal series-level and opt-in chapter-as-issue imports stable.
- Avoid broad external comic registry matching in this first slice.

**Acceptance Criteria**
- Special chapters can be imported or skipped with clear readback.
- Non-standard numbering does not collapse into issue `1` or overwrite standard issue rows.
- Repeat sync remains idempotent.

### Backlog Item: Shared Digital Library Provider Abstractions
**Type:** Deferred milestone
**Tags:** `kavita`, `calibre`, `cwa`, `opds`, `providers`, `imports`
**Status:** Active backlog; extraction/refactor task only, not a new provider feature.

**Goal:** Consolidate common provider/import contracts across Kavita, Calibre/CWA OPDS, and future digital-library sources without hiding provider-specific behavior.

**Why this work exists**
- Kavita, CWA/Calibre, and OPDS sources now share concepts such as provider ids, external URLs, download/reader links, cover art, and repeat-sync identity.
- A shared abstraction can reduce duplication, but only after provider-specific behavior has been proven.
- The phrase "shared provider abstractions" is easy to overread as a large generic integration framework; this task should instead extract the smallest proven helpers and contracts that reduce duplicated provider plumbing.

**Intent**
- Treat this as refactor/extraction work after at least two provider behaviors have been proven in production-shaped flows.
- Keep each provider's user-facing behavior, route names, docs, smoke tests, and readback explicit.
- Make future provider work easier by standardizing only the boring repeated parts: source identity, source links, cover identity, credential redaction, import result readback, and repeat-sync matching.

**Current state**
- Kavita has substantial provider-specific behavior across import identity, issue fan-out, cover handling, progress, writeback planning, and workspace-owned administration.
- CWA/Calibre/OPDS-style sources share some link, cover, reader, and repeat-sync concepts, but their provider-specific behavior should remain visible.
- Playnite game intake is tracked separately and should prove its own import/update behavior before any shared abstraction is applied to it.

**Scope**
- Inventory common provider fields and source-specific exceptions.
- Define small shared import identity, source-link, reader/download-link, cover-art, and credential-redaction helpers.
- Define a common import result/readback shape for created, updated, skipped, failed, duplicate, and needs-review rows where providers already expose equivalent concepts.
- Define repeat-sync identity helpers that make provider matching auditable without forcing every provider into the same schema.
- Preserve provider-specific API behavior and smoke coverage.
- Document where each provider intentionally diverges from the shared helper behavior.

**Candidate subtasks**
- Compare Kavita and CWA/Calibre/OPDS source identity, link, cover, and import-result fields.
- Identify duplicated helper logic that can be extracted without changing runtime behavior.
- Add shared helper/service modules only for proven duplication.
- Update provider-specific tests so they prove both shared helper behavior and provider-specific exceptions.
- Add docs explaining when future provider work should use the shared helpers and when it should stay provider-local.

**Out of scope**
- Do not build a broad generic provider framework.
- Do not add a new provider integration as part of this abstraction task.
- Do not move provider-specific route names, admin UI, smoke tests, or user-facing readback behind generic labels.
- Do not include metadata writeback, reading-progress sync, embedded readers, provider scheduling, or file proxying unless those are separately promoted milestones.
- Do not block Playnite Game Library Intake on this task; Playnite should prove its import behavior first and may reuse shared pieces later.

**Acceptance Criteria**
- Common digital-library import plumbing has one documented contract for the extracted helper layer.
- Existing Kavita and CWA/Calibre smokes continue to prove provider-specific identity, link, cover, and readback behavior.
- Provider-specific exceptions remain documented and visible in tests or smoke readback.
- A future implementer can tell this is limited extraction work, not permission to flatten every provider into one generic integration model.

### Backlog Item: Playnite Game Library Intake
**Type:** Deferred milestone
**Tags:** `games`, `playnite`, `imports`, `providers`, `digital-library`, `sync`
**Status:** Active backlog; not yet promoted or versioned.

**Goal:** Use Playnite as the preferred source for digital game library intake instead of building separate direct syncs for each storefront or platform.

**Why this work exists**
- Playnite already aggregates many PC and console-adjacent game sources through its library model and extension ecosystem.
- Direct collectZ syncs for Steam, GOG, Epic, Xbox, PlayStation, Ubisoft, Battle.net, itch.io, Amazon, Humble, Rockstar, and similar services would duplicate fragile provider-specific auth and API work.
- A Playnite-first path lets collectZ focus on collection ownership, metadata, review, and repeat import behavior while treating Playnite as the user-managed game-library aggregator.

**Intent**
- Make Playnite the canonical digital game intake bridge for collectZ.
- Avoid adding direct syncs for services that Playnite already covers unless a future milestone proves Playnite cannot support a required use case.
- Preserve source/provider identity so repeat imports update existing game rows cleanly.

**Current state**
- collectZ supports games as a library type, but there is no dedicated digital game library intake workflow.
- The backlog has shared provider/import abstraction work, but no Playnite-specific plan.
- Playnite source and extension documentation suggest practical options for export/import or a lightweight collectZ companion extension.

**Scope**
- Start with Playnite export/import support before building a live companion extension.
- Accept a Playnite-exported library file or documented payload shape.
- Normalize game rows with title, platform/source, provider identity, ownership/install status when available, artwork metadata, release/year metadata, tags/categories, and source links.
- Match repeat imports by stable Playnite/source identifiers before falling back to title/platform matching.
- Surface import results with created, updated, skipped, duplicate, and needs-review counts.
- Keep conflicts reviewable rather than silently overwriting uncertain existing rows.

**Candidate subtasks**
- Inspect Playnite export formats and extension APIs to choose the first supported intake shape.
- Define collectZ's Playnite import contract and OpenAPI request/response shapes.
- Add backend parsing, normalization, dedupe, and update behavior for Playnite game rows.
- Add a compact Import UI path for Playnite files or payloads.
- Add tests for first import, repeat import, changed metadata, missing identifiers, duplicate candidates, and unsupported rows.
- Later: evaluate a Playnite companion extension that can push library snapshots to collectZ without manual export/import.

**Out of scope**
- Do not build direct Steam, Xbox, PlayStation, GOG, Epic, Ubisoft, Battle.net, itch.io, Amazon, Humble, or Rockstar syncs in this task.
- Do not implement storefront auth scraping or launcher credential storage.
- Do not build price tracking, achievement sync, playtime sync, or install-state automation in the first slice.
- Do not require Playnite to replace manually entered physical game records.

**Acceptance Criteria**
- The backlog clearly names Playnite as the preferred digital game library intake source.
- A future implementer can tell that direct provider syncs are intentionally deferred/avoided.
- The first promoted slice has a concrete path: Playnite export/import, stable identity, repeat updates, conflict readback, and UI import entry.
- Existing games remain manually manageable even if no Playnite source is connected.

### Backlog Item: Artwork Edition Registry and Valuation Enrichment
**Type:** Deferred milestone
**Tags:** `artwork`, `prints`, `valuation`, `edition-series`, `metadata`

**Goal:** Build on item-local numbered print metadata with optional enrichment for edition-series details, external registries, certificates, and valuation providers.

**Scope**
- Explore whether numbered print runs can be linked to a reusable edition-series concept without making manual art entry heavier.
- Evaluate external print registries or certificate/provenance sources where available.
- Add valuation-provider enrichment only when provenance and confidence can be shown clearly.
- Keep current per-item print number, print run, signed state, and medium entry intact.

**Acceptance Criteria**
- Existing item-local print metadata continues to work without external enrichment.
- Any external edition or valuation data includes source/provenance readback.
- Certificate or registry data never silently overwrites user-entered art details.


### Backlog Item: Apple Platform App Contract Publishing
**Type:** Deferred milestone
**Tags:** `apple`, `ios`, `ipados`, `macos`, `tvos`, `openapi`, `releases`, `contract`

**Goal:** Publish collectZ as a versioned backend contract and release artifact set so a separate SwiftUI Apple-platform repo can build and consume the API without depending on the web app repo layout or source tree.

**Why this work exists**
- The Apple app will live in its own repository and needs a stable way to consume collectZ API changes.
- The Apple app should not depend on the web frontend build output or on direct source sharing from this repo.
- Versioned contract artifacts give the Apple repo a pinned, reproducible input for Swift code generation and client integration.

**Scope**
- Keep `backend/openapi/openapi.yaml` as the source-of-truth contract for backend behavior.
- Publish the OpenAPI contract as a versioned artifact on tagged releases.
- Keep the existing GHCR backend/frontend image publishing flow for deployable runtime images.
- Expose a clear release package for other repos to consume, without splitting this repository into multiple source trees.
- Document how a separate Apple repo should download the pinned contract artifact and generate Swift client types from it.
- Decide whether GitHub Releases, release assets, or another versioned artifact host is the canonical distribution path for the contract.

**Acceptance Criteria**
- A tagged backend release publishes a versioned API contract artifact.
- The contract artifact can be consumed from a separate repository without checking out this repo.
- The Apple repo can pin to a specific backend version and generate Swift client models from it.
- Backend/frontend deployable images remain versioned and published as they are today.
- The publication and consumption flow is documented clearly enough for a separate Apple app repo to implement it without guesswork.

### Backlog Item: Public Homelab Repo Promotion and Export Workflow
**Type:** Deferred milestone
**Tags:** `major-feature`, `infra`, `risk`, `homelab`, `repo-promotion`
**Status:** Partially completed by public-compose/env/docs cleanup; remaining work is actual publication/export automation.

**Goal:** Prepare the public homelab repo promotion and export workflow after the shared-core boundary settles.

**Current state**
- Public homelab compose and private platform surface scrub work shipped in `3.4.20`.
- Public environment/docs cleanup shipped across the `3.8.x` line, including simplified env examples and public homelab reference updates.
- GHCR image publication exists for backend/frontend runtime images.
- A separate public repo/export workflow is not yet automated or documented as a repeatable release operation.

**Scope**
- Define how shared-core content is packaged for public release.
- Define how publication and update flow work for the homelab repo.
- Keep the public repo free of private platform shell surfaces.
- Make the promotion path intentional instead of ad hoc.

**Remaining subtasks**
- Decide whether the public homelab artifact is a separate repository, release asset bundle, or generated export branch.
- Add an export validation checklist that proves no private platform-only docs, env knobs, credentials, or internal runbooks leak into the public artifact.
- Document how `latest` and stable tags map to public deployment updates.
- Add release automation only after the exported artifact boundary is stable enough to maintain.

**Acceptance Criteria**
- The public homelab repo contains no private platform shell surfaces.
- The packaging and publication flow is documented and repeatable.
- Update flow from the private source into the public repo is clear and intentional.

### Backlog Item: Personal Workspace Offboarding, Archive Retention, and Recovery
**Type:** Deferred milestone
**Tags:** `workspace`, `lifecycle`, `retention`, `recovery`

**Goal:** Define the SaaS account and workspace offboarding path for personal workspaces.

**Scope**
- Separate workspace membership removal from account/workspace offboarding.
- Keep ordinary workspace admin actions limited to `Remove from Workspace`.
- Use an inactive/archive lifecycle instead of immediate hard deletion by default.
- Define recovery behavior when the same user later re-registers.
- Preserve content attribution even if the original account no longer exists.

**Acceptance Criteria**
- Workspace admins remove members from shared workspaces without deleting shared content.
- Personal workspace offboarding uses a documented inactive/archive/deletion lifecycle.
- Re-registration with the same email can recover an archive-eligible personal workspace during the retention window.
- The `0-30 / 31-90 / 91+ day` retention behavior is documented, implemented, and auditable.

### Backlog Item: Optional Build: Cost Model and Billing Readiness
**Type:** Deferred milestone
**Tags:** `cost-model`, `billing`, `hosted`, `metering`

**Goal:** Prepare a data-backed cost model before any hosted subscription offering.

**Scope**
- Add usage metering primitives for provider calls, sync jobs, and storage.
- Build a cost estimation model with low, mid, and high bands.
- Add a read-only admin cost estimate view for hosted-mode planning.
- Define deployment profiles for self-hosted and hosted subscription usage.
- Document break-even and guardrail thresholds for enabling paid integrations by default in hosted mode.

**Acceptance Criteria**
- Cost estimates can be generated from real usage telemetry.
- Top cost drivers are visible and attributable.
- The self-hosted profile remains fully functional with paid-provider integrations disabled.

### Backlog Item: Subscription Entitlement Contract and Tier Model
**Type:** Deferred milestone
**Tags:** `subscriptions`, `entitlements`, `billing`, `license`, `hosted`, `stripe`
**Status:** Active backlog; not yet promoted or versioned.

**Goal:** Define the first hosted-product subscription contract before payment processing is implemented.

**Why this work exists**
- collectZ needs a free tier that remains useful forever and at least one paid tier that unlocks heavier capabilities.
- The first subscription slice should be an entitlement/license contract, not Stripe checkout or live payment collection.
- The existing `platform` / `homelab` product-edition boundary is a shell/runtime boundary, not a subscription tier model, and must not be reused as Free vs Paid.
- Individual users should work from a normal user license that hides platform/admin capabilities regardless of tier.

**Tier intent**
- Free should support real personal collection work: manual collection management, Dashboard, Wishlist, Loans, Activity, basic review surfaces, manual add/edit, manual image upload, manual CSV/import paths where cost is local, barcode/ISBN lookup and scanner intake with conservative usage tracking, basic low-cost provider lookup, and export/portability trust features.
- Paid should focus first on automation: scheduled provider syncs, Apple/iTunes price watch automation, future Playnite automation, background enrichment jobs, cover/metadata refresh, valuation refresh, OCR/photo/capture automation beyond basic barcode capture, advanced/batch review helpers, duplicate automation, collection-health automation, and higher soft limits for storage, provider calls, sync frequency, and capture processing.
- Future paid tiers may add collaboration/team features, but collaboration should not be the first paid boundary.

**Intended first implementation slice**
- Add a license/entitlement model owned by the user's personal workspace and billing email.
- Automatically grant every user a default `free` license.
- Reserve Stripe identifiers for a later payment slice: customer id, subscription id, current period, and subscription status.
- Add a backend entitlement registry with named capabilities such as:
  - `automation.provider_sync`
  - `automation.price_watch`
  - `automation.ocr`
  - `automation.valuation_refresh`
  - `review.advanced_queue`
  - `limits.storage.soft`
  - `limits.provider_calls.soft`
- Add authenticated license readback through an account-level endpoint such as `GET /api/account/license`.
- Return plan key, status, billing email, entitlements, soft-limit usage, and upgrade-readable reasons.
- Add enforcement helpers so paid automation endpoints can return a clear `upgrade_required` response when blocked.
- Keep manual features available on Free.
- Track usage for cost modeling, but do not hard-block soft limits in the first slice except for explicitly paid automation.
- Add Account/Settings UI readback for current plan, included automation, and locked automation.
- Ensure subscription state never exposes platform/admin menus, labels, or controls.

**Stripe follow-up**
- Use Stripe Billing as the intended future payment processor.
- Implement Checkout Sessions, customer portal, and webhook-driven subscription status only after the entitlement contract exists.
- Do not add live checkout, customer portal, or Stripe webhooks in the first entitlement-contract slice.

**Related work**
- `Optional Build: Cost Model and Billing Readiness` should remain related but separate. Cost modeling can use entitlement/usage data later, but it is not required before the entitlement contract is defined.
- `Personal Workspace Offboarding, Archive Retention, and Recovery` should inform future paid cancellation, retention, and recovery behavior.

**Acceptance Criteria**
- Backlog and roadmap clearly distinguish subscription tiers from product editions/platform capabilities.
- A future implementation can add Free and Paid readback without exposing platform/admin surfaces.
- Free remains a useful personal collection tier rather than a short trial.
- Paid is defined around automation and cost-bearing work first.
- Stripe is documented as the likely payment provider, but payment collection remains a later milestone.

### Backlog Item: Imports and Sync Cadence Expansion
**Type:** Deferred milestone
**Tags:** `imports`, `csv`, `calibre`, `kavita`, `metron`, `sync`
**Status:** Active backlog for non-Plex providers and CSV templates; Plex broad sync work is closed.

**Goal:** Expand import templates and synchronization cadence controls across the supported non-Plex import sources.

**Current state**
- Plex import/reconciliation/scheduler/writeback work is closed and should not be reopened under this broad item.
- Kavita has substantial import/sync behavior, issue fan-out, covers, progress, writeback, and workspace-owned administration, but still has separate backlog for special chapters, background progress polling, and shared provider abstraction.
- Barcode/ISBN scanner API and Capture Inbox paths exist.
- Multiple type-specific CSV templates and non-Plex cadence controls are not yet formalized as a shared import operating model.

**Scope**
- Add multiple CSV templates for:
  - Games
  - Movies / TV
  - Audio
  - Events
  - Collectibles
  - Books
- Define cadence for updates from:
  - Calibre
  - Kavita
  - Metron

**Remaining subtasks**
- Inventory existing CSV import mappings and identify gaps by media type.
- Add template files, docs, and import smoke coverage for each supported CSV shape.
- Define per-provider cadence readback and controls for Calibre/CWA, Kavita, and Metron where applicable.
- Route failed/stale import cadence states into Dashboard/health or the future Unified Review Queue.
- Keep provider-specific metadata behavior documented instead of hiding it behind one generic sync label.

**Plex status**
- Plex import, provider discovery, provider-advertised sections-root resolution, webhook receipt/processing, new-title hints, watched-state sync/writeback, rating readback/writeback, reconciliation, conflict review, scheduled/full-scan behavior, and operating-model UI/docs cleanup were promoted and closed across `3.4.111` through `3.4.151`.
- Plex now uses `/media/providers` as capability discovery and resolves provider-advertised `/library/...` roots where proven safe. Current item import remains on documented Plex library paths because real-PMS provider item-row proof did not expose a better provider item-listing candidate.
- Do not reopen broad Plex provider item-listing migration unless a future Plex PMS shape exposes richer provider-advertised item rows and a new runtime proof shows identity, metadata, and repeat-sync parity.

**Acceptance Criteria**
- The named CSV templates are available for the supported library types.
- Update cadence can be described and configured for Calibre, Kavita, and Metron sources.
- Plex remains represented by completed promoted milestones instead of stale future-work bullets.

### Backlog Item: Support Metrics and Satisfaction Surveys
**Type:** Task
**Tags:** `support`, `metrics`, `csat`, `nps`, `survey`

**Goal:** Add support metrics and a post-close satisfaction survey path.

**Scope**
- Track support metrics for CSat.
- Track support metrics for Promoter-style feedback.
- When a support request is closed, optionally send a satisfaction survey.

**Acceptance Criteria**
- Support metrics can capture satisfaction and promoter-style feedback.
- Closed support requests can trigger an optional survey.
- The survey flow stays aligned with the support request lifecycle.


### Backlog Item: Event Social Planning Mobile Web Experience
**Type:** Task
**Tags:** `events`, `mobile`, `ui`, `social`, `meetups`, `schedule`
**Status:** Mostly completed across `3.4.33` through `3.4.84`; keep only for new mobile-web polish discovered through real use.

**Goal:** Make the web app's event social planning views useful on a phone during a con before building native companion surfaces.

**Current state**
- The Event drawer now includes mobile schedule readability, day navigation, compact social overview, fast meetup/status updates, shared schedule editing, private/shared treatment, vendor/booth/location notes, day-of social summary, and mobile time-window filters.
- Event-local attendee, group, meetup, schedule, notification draft/history/inbox, and delivery-attempt readback foundations are present.
- The broad "make it usable on mobile" intent is no longer a blank backlog item; future work should be specific polish found during real event use.

**Scope**
- Continue the mobile-first event social view beyond the completed `3.4.38` through `3.4.42` slices when new small mobile-social polish needs appear.
- Optimize the view for quick day-of-con scanning rather than admin-heavy editing.
- Keep the UI privacy-aware so private and shared items are visually distinct.
- Preserve desktop planning views for richer pre-con editing.

**Remaining subtasks**
- Record concrete mobile friction from actual con/day-of use instead of inventing broad UI work.
- Promote only narrow slices such as "reduce drawer scrolling for X," "make Y action thumb-reachable," or "clarify Z privacy readback."
- Keep native companion work in the platform-app backlog items instead of widening this web task.

**Acceptance Criteria**
- A user can open an event on mobile and quickly see who/when/where for social plans.
- Meetups and schedule plans are readable without excessive drawer scrolling.
- Private vs shared records are visually clear.
- The mobile web surface is good enough to validate the workflow before native/platform implementation.

### Backlog Item: Event Schedule Catalog Now/Next Follow-ups
**Type:** Deferred milestone
**Tags:** `events`, `schedule`, `discovery`, `sched`, `calendar`, `mobile`
**Status:** Mostly completed for web/backend catalog discovery; remaining work should be narrow import/provider polish or native-companion-specific.

**Goal:** Build on the `3.4.46` and `3.4.47` schedule catalog foundation/entry work with import, discovery, and richer quick planning flows for sessions happening during a con.

**Why this work exists**
- Sched-style full event calendars are useful, but mobile discovery is often weak when a user needs to decide what to do right now.
- collectZ can make event calendars more actionable by combining session discovery with planned attendance, friends, groups, meetups, and collection/event context.
- The `3.4.46` foundation added canonical catalog storage that is distinct from a user's personal plan.
- The `3.4.47` polish slice added manual catalog entry/editing plus guarded catalog-to-schedule creation.
- The `3.4.48` read-only slice is promoted to add the first compact Now / Next view from existing catalog sessions.
- The `3.4.49` quick-state slice is promoted to let catalog and Now / Next sessions create or update linked personal plan states.
- The `3.4.50` conflict-detection slice is promoted to show read-only overlap warnings before replacement or notification workflows.
- The `3.4.51` conflict-resolution slice is promoted to make local keep/backup/skip choices explicit before notification workflows.
- The `3.4.52` attendance-readback slice is promoted to show visibility-aware shared schedule context before selected-recipient notifications.
- The `3.4.53` catalog-filter slice is promoted to make long event catalogs scannable before selected-recipient notifications or native companion work.
- The `3.4.54` catalog-metadata-filter slice is promoted to add track, category, and room/location filters to the web catalog before selected-recipient notifications or native companion work.
- The `3.4.55` catalog-ICS-import slice is promoted to seed canonical catalog sessions from provider calendar feeds without recurring sync or personal-plan side effects.
- The `3.4.56` catalog-to-personal matching slice is promoted to connect confident personal Sched plans back to matching catalog sessions without rewriting personal source identity.
- The `3.4.57` selected-recipient change-preview slice is promoted to preview affected people/groups and conflicts before real notification delivery work.
- The `3.4.58` selected-recipient notification contract slice is promoted to persist draft/sent Event-local schedule notifications without push/device delivery.
- The `3.4.59` notification history slice is promoted to read back those Event-local draft/sent schedule notification records in the drawer.
- The `3.4.60` notification inbox/readback slice is promoted to add Event-local recipient rows with read/acknowledged state before push, email, or native device delivery.
- The `3.4.61` user-linked attendee identity slice is promoted to connect Event attendees to the current app user for "mine" inbox filtering without broad friend identity or native delivery.
- The `3.4.62` My Notifications filter UI slice is promoted to expose the current-user inbox filter in the Event drawer.
- The `3.4.63` shared-attendance card slice is promoted to show visibility-safe people/group context directly on session cards.
- The `3.4.64` join/leave/replace action slice is promoted to turn session-card readback into quick plan-change intent.
- The `3.4.65` change-template slice is promoted to seed selected-recipient local notification drafts from schedule action intent.
- The `3.4.66` template-picker slice is promoted to let users choose and edit Event-local notice text before save/send.
- The `3.4.67` recipient-selection UI polish slice is promoted to let users trim eligible people/groups before saving or sending an Event-local notice.
- The `3.4.68` draft-management slice is promoted to edit, send, or discard Event-local schedule notification drafts.
- The `3.4.69` delivery-boundary slice is promoted to give platform/native clients a stable Event-local delivery contract before any push, email, or device-provider work exists.
- The `3.4.70` provider-prep slice is promoted to describe disabled push/email/platform-device providers without creating delivery attempts or enabling external delivery.
- The `3.4.71` delivery-attempt model slice is promoted to define the future attempt audit shape while keeping attempt creation disabled.
- The `3.4.72` delivery-attempt persistence slice is promoted to create/read Event-local attempt audit rows without enabling external providers.
- The `3.4.73` delivery-attempt readback UI slice is promoted to surface Event-local attempt audit evidence in notification history.
- Later slices added platform companion Now/Next contracts (`3.4.74` and `3.4.75`), social discovery/readback, attendee duplicate guardrails, mobile day-of social summary, and mobile time-window filters through `3.4.84`.
- The original broad web/backend catalog intent is mostly shipped; this item remains only as a parking place for specific catalog import/provider or day-of-discovery polish.

**Scope**
- Support importing or manually entering an event's full schedule catalog.
- Add a mobile-friendly "Now / Next" view for sessions happening now, starting soon, and optionally later today.
- Add filters for time window, track/category, location/room, planned status, friend/group attendance, and conflicts.
- Add session states such as planned, maybe, skipped, backup, and unavailable where useful.
- Keep Sched ingestion conservative: prefer supported export/import paths over brittle scraping.

**Remaining subtasks**
- Identify any missing provider import path beyond current ICS/manual entry.
- Add only concrete catalog discovery improvements that cannot be solved by the existing filters and Now/Next readback.
- Keep push/email/device-provider delivery outside this item unless a delivery provider task is explicitly selected.
- Move native Swift/UI work to the platform companion backlog items.

**Acceptance Criteria**
- Catalog import flows build on `event_schedule_sessions` instead of personal selected schedule plans.
- The web app can show sessions happening now and starting soon.
- A user can quickly mark a session as planned, maybe, skipped, or backup.
- Overlapping sessions are detectable as conflicts.
- The schedule catalog can later be cached by a platform companion app.

### Backlog Item: Friend-Aware Session Changes and Notifications
**Type:** Deferred milestone
**Tags:** `events`, `social`, `schedule`, `notifications`, `friends`, `groups`
**Status:** Backend/local event notification workflow mostly shipped; remaining work is external delivery and/or native app UX.

**Goal:** Let users quickly change session choices and notify selected friends or groups about the plan change.

**Current state**
- Join/leave/replace/backup intent, selected-recipient drafts, templates, recipient trimming, draft management, notification history/inbox/readback, delivery attempt audit rows, and platform companion contracts have shipped.
- Delivery providers are intentionally described but disabled; there is no push/email/device delivery.
- No broad friend graph exists; the model remains event-local and visibility-aware.

**Scope**
- Add explicit actions for joining, leaving, replacing, or marking backup sessions. The first web-card slice is promoted as `3.4.64`.
- When a change affects shared plans, offer selected-recipient notifications instead of broadcasting by default. The first action-template slice is promoted as `3.4.65`; picker/edit UI is promoted as `3.4.66`; recipient-selection polish is promoted as `3.4.67`; draft-management UI is promoted as `3.4.68`; the delivery-boundary/platform contract is promoted as `3.4.69`; provider-prep metadata is promoted as `3.4.70`; the delivery-attempt model contract is promoted as `3.4.71`; Event-local delivery-attempt persistence/readback is promoted as `3.4.72`; delivery-attempt readback UI is promoted as `3.4.73`.
- A session-presence polish slice is promoted as `3.4.76` to make shared attendance readback clearer on cards and in expanded detail without adding a friend graph or delivery behavior.
- An Event-social discovery readback slice is promoted as `3.4.77` to make People, Groups, and Meetups feel more connected in the drawer without widening the backend social model.
- Support message templates such as:
  - "I'm switching to this session"
  - "Anyone want to join?"
  - "Meet outside this room"
  - "I'm dropping this session"
- Show friend/group attendance on session cards when visibility allows.
- Handle conflicts by offering replace, keep as backup, or keep both tentative.
- Respect privacy levels from the event social planning model.

**Remaining subtasks**
- Pick an actual delivery provider path, such as email, push, platform-device, or Discord, before adding real outbound delivery.
- Keep delivery opt-in per change and selected-recipient by default.
- Add provider-specific failure/readback only after external delivery is enabled.
- Keep any native Apple session-change UI in the platform companion backlog.

**Acceptance Criteria**
- A user can change session plans from a quick event/session view.
- The app can notify selected friends or groups about the change.
- Friend/group visibility is permission-aware.
- Session conflicts are handled intentionally instead of silently overwriting plans.

### Backlog Item: Platform Companion Now/Next Schedule Experience
**Type:** Deferred milestone
**Tags:** `apple`, `platform-app`, `xcode`, `events`, `schedule`, `offline`, `notifications`
**Status:** Backend/API contract shipped as `3.4.74`; remaining work is native app implementation outside this repo plus any contract gaps found by that app.

**Goal:** Make the Apple/Xcode app a useful day-of-con companion for fast schedule discovery and plan changes while the web app remains the canonical planning surface.

**Why this work exists**
- The platform app should be most useful when a user is already on the convention floor and needs to decide what is happening now, what is next, and whether a session switch is worth it.
- Personal Sched ICS sync should inform the user's plan state, but it should not masquerade as the full event calendar.
- The native app should consume versioned backend/OpenAPI behavior instead of depending on web frontend files, layouts, or source sharing.

**Scope**
- Consume the backend event schedule catalog, personal planned schedule state, and relevant location metadata through versioned API/OpenAPI behavior.
- Show a fast "Now / Next" surface for current, upcoming, and nearby sessions for the active event.
- Clearly distinguish full catalog sessions from the user's personal planned or ICS-synced sessions.
- Support quick actions for `planned`, `maybe`, `skipped`, and `backup` when the backend contract allows them.
- Surface conflict state and replacement choices when a user changes from one overlapping session to another.
- Optimize the native view for convention-floor speed rather than admin-heavy editing.
- Keep the platform app positioned as a companion surface; setup and broader planning still happen primarily on the web.

**Acceptance Criteria**
- The platform app is useful during the con even when setup and planning happened on the web.
- Current, upcoming, and nearby sessions are readable with minimal navigation friction.
- Catalog sessions and personal planned sessions are visually distinct.
- Quick plan-change actions and conflict cues are available without requiring web-specific UI assumptions.
- The app consumes versioned backend/OpenAPI behavior and does not depend on web frontend files.

**Promotion**
- The backend/API companion contract slice for this work is promoted as `3.4.74`. Native Swift UI implementation remains outside this webapp repo.
- Do not promote more backend work from this item until the native client identifies a concrete contract gap.

### Backlog Item: Platform Companion Friend-Aware Session Changes
**Type:** Deferred milestone
**Tags:** `apple`, `platform-app`, `xcode`, `events`, `social`, `schedule`, `notifications`, `privacy`
**Status:** Backend/API contract shipped as `3.4.75`; remaining work is native app implementation and future real delivery-provider integration.

**Goal:** Let the Apple/Xcode app handle quick session plan changes with opt-in, privacy-aware friend and group notifications.

**Why this work exists**
- Session switching often happens in motion, and the day-of-con device is the right place to send a fast update to a selected set of people.
- Notifications should help coordination without becoming noisy or broadcast-by-default.
- Privacy and visibility rules must stay backend-owned so the native app does not invent weaker sharing behavior.

**Scope**
- Let users notify selected friends or groups when changing plans from the native app.
- Support opt-in message templates such as:
  - `I'm switching to this session`
  - `Anyone want to join?`
  - `Meet outside this room`
  - `I'm dropping this session`
- Default to selected-recipient notifications instead of broad broadcast behavior.
- Respect backend privacy and visibility rules for friend/group/session-sharing state.
- Show enough context around the session change to understand who will be notified and whether a conflict or replacement is occurring.

**Acceptance Criteria**
- Plan changes can trigger selected-recipient notifications from the platform app.
- Message templates support common day-of-con coordination cases without requiring freeform social discovery features.
- Notification behavior is opt-in per change and not broadcast by default.
- Backend privacy and visibility rules are enforced consistently by the platform app.

**Promotion**
- The backend/API companion contract slice for this work is promoted as `3.4.75`. Native Swift UI implementation remains outside this webapp repo.
- Do not promote more backend work from this item until the native client or a selected delivery provider exposes a concrete contract gap.
