# Observability Baseline Tuning Log

Use this log to record real observed runs before tightening alert thresholds.

The goal is to keep threshold changes tied to evidence instead of memory.

## How To Use This Log

For each meaningful run or incident sample, capture:

- date/time
- environment or stack context
- import/provider involved
- whether the run was healthy, degraded, or failed
- key metric values
- what threshold or dashboard question the run informed

Do not overwrite older entries. Add new dated entries so we keep a tuning history.

## Baseline Entries

### 2026-03-14 — Delicious Import Baseline

Context:

- local Docker monitoring stack
- rebuilt backend with current `2.6.0` observability instrumentation
- completed Delicious import observed through Prometheus + `sync_jobs.summary`

Observed values:

- `collectz_import_jobs_total{provider="csv_delicious",status="queued"} = 1`
- `collectz_import_jobs_total{provider="csv_delicious",status="succeeded"} = 1`
- `collectz_import_enrichment_total{provider="csv_delicious",kind="pipeline",outcome="enriched"} = 1282`
- `collectz_import_enrichment_total{provider="csv_delicious",kind="pipeline",outcome="no_match"} = 257`
- hard import errors: `0`
- invalid rows: `2`

Derived ratio:

- Delicious pipeline no-match ratio: about `16.7%`

Interpretation:

- a successful Delicious import can include a meaningful no-match population without indicating an operational incident
- raw no-match count should not page on its own
- ratio is the more useful signal than count

Starter tuning outcome:

- keep Delicious no-match warning as ratio-based
- use starter threshold:
  - `> 35%`
  - only when at least `100` items were processed in the window

Follow-up:

- collect at least 2 more healthy Delicious import samples before lowering the threshold
- compare movie-heavy and game-heavy Delicious exports separately if behavior diverges materially
