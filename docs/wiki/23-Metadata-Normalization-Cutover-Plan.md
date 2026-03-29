# Metadata Normalization Cutover Plan (2.1.x)

## Goal

Move metadata search/filter read paths from legacy comma-separated columns (`genre`, `director`, `cast_members`) to normalized relations (`media_genres`, `media_directors`, `media_actors`) with low rollback risk.

## Source of Truth Strategy

- Target source of truth: normalized relation tables.
- Transitional model: dual-write.
- Historical rollout control: feature flag `metadata_normalized_read_enabled` during the 2.1.x cutover window.
- Current state after `2.8.2`: normalized-first metadata reads are standard behavior, not an admin-visible toggle.

## Staged Rollout

### Stage A

- Write path: dual-write (legacy columns + normalized tables).
- Read path: dual-read (legacy OR normalized).
- Historical flag state: `metadata_normalized_read_enabled = false`.

### Stage B (current default)

- Write path: dual-write.
- Read path: normalized-first (legacy metadata columns excluded from metadata filter predicates).
- Historical flag state: `metadata_normalized_read_enabled = true` (default during cutover).
- Current rollback note: there is no longer a runtime flag rollback path; rollback requires code/image reversal if a regression is discovered.

### Stage C (next optional hardening cycle)

- Keep Stage B enabled for at least one full tester cycle.
- Required checks:
  - no search/filter correctness regressions for director/genre/cast;
  - no import correctness regressions for CSV/Plex/manual add;
  - acceptable query timings and buffer usage compared with Stage A evidence.

### Stage D (2.1.x optional follow-up)

- Stop writing legacy metadata columns (`genre`, `director`, `cast_members`) for new/updated records.
- Keep columns present and backfilled for rollback safety and one full cycle.

### Stage E (later migration cleanup)

- Remove legacy columns in a later migration after Stage D stability window.
- Remove dual-write code paths and legacy fallback read clauses.

## Cutover Criteria

The project can move from Stage A -> B only when:

1. `test:init-parity`, `test:unit`, and `test:integration-smoke` pass.
2. Benchmark evidence exists and shows no severe normalized-read regressions.
3. UI validation confirms search/filter parity for director/genre/cast.

The project can move from Stage B -> D only when:

1. Stage C test window completes without blocker defects.
2. Activity logs show no elevated import/search failures attributable to metadata query changes.
3. Operator sign-off is documented in release notes.

## Rollback Plan

- Immediate: redeploy a previous backend image if normalized-read behavior must be rolled back.
- Data safety: normalized tables remain populated; no destructive migration in Stages A-C.

## Operational Notes

- Keep backfill scripts idempotent.
- Keep migration parity (`init.sql` vs `migrations.js`) enforced for each metadata-schema update.
- Include metadata-query benchmark evidence in release notes for any stage transition.
