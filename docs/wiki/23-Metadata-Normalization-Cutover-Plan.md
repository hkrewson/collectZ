# Metadata Normalization Cutover Plan (2.1.x)

## Goal

Move metadata search/filter read paths from legacy comma-separated columns (`genre`, `director`, `cast_members`) to normalized relations (`media_genres`, `media_directors`, `media_actors`) with low rollback risk.

## Source of Truth Strategy

- Target source of truth: normalized relation tables.
- Transitional model: dual-write.
- Rollout control: feature flag `metadata_normalized_read_enabled`.

## Staged Rollout

### Stage A (current)

- Write path: dual-write (legacy columns + normalized tables).
- Read path: dual-read (legacy OR normalized).
- Flag state: `metadata_normalized_read_enabled = false`.

### Stage B

- Write path: dual-write.
- Read path: normalized-first (legacy metadata columns excluded from metadata filter predicates).
- Flag state: `metadata_normalized_read_enabled = true`.
- Rollback: flip flag off.

### Stage C

- Keep Stage B enabled for at least one full tester cycle.
- Required checks:
  - no search/filter correctness regressions for director/genre/cast;
  - no import correctness regressions for CSV/Plex/manual add;
  - acceptable query timings and buffer usage compared with Stage A evidence.

### Stage D

- Stop writing legacy metadata columns (`genre`, `director`, `cast_members`) for new/updated records.
- Keep columns present and backfilled for rollback safety and one full cycle.

### Stage E

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

- Immediate: set `metadata_normalized_read_enabled=false`.
- If required: redeploy previous backend image.
- Data safety: normalized tables remain populated; no destructive migration in Stages A-C.

## Operational Notes

- Keep backfill scripts idempotent.
- Keep migration parity (`init.sql` vs `migrations.js`) enforced for each metadata-schema update.
- Include metadata-query benchmark evidence in release notes for any stage transition.
