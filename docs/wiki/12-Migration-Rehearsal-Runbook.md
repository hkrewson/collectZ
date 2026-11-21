# 2.0 Migration Rehearsal Runbook (From 1.9)

This runbook is the repeatable process for testing the 2.0 schema migration safely against real 1.9 data before production rollout.

## Goal

- Validate schema/data migration behavior on a copy of production data.
- Verify application startup and key workflows after migration.
- Verify rollback procedure on rehearsal data.
- For public-server upgrades where workspace/library access may change, also run the [Upgrade Preservation Audit](50-Upgrade-Preservation-Audit.md) before and after the rehearsal migration.

## Inputs

- A recent 1.9 database backup (`.dump` or `.sql`) from production.
- The target application revision and migration code in this repo.
- Docker host with enough free disk for duplicate DB data.

## Baseline Strategy (Fresh-Install Clarity)

- Production migrations remain append-only in `backend/db/migrations.js`.
- `version: 1` is the historical baseline snapshot schema (not a reversible down migration).
- Rollback readiness is implemented as restore-based rollback:
  - take/retain a pre-upgrade database snapshot,
  - validate forward migration on a rehearsal copy,
  - restore snapshot to recover baseline behavior.
- CI automates this path using a synthetic legacy fixture DB plus two database-native PostgreSQL template snapshot/restore checks:
  - a pre-upgrade snapshot restored at the selected baseline for rollback parity,
  - a post-upgrade migration-built snapshot restored at the latest version, provisioned with an ephemeral non-owner runtime credential, and certified for complete migration history, bootstrap state, data counts, and external migration mode.
- The database-native template snapshot is an in-cluster restore authority check. It does not replace the operator rehearsal of a portable production `.dump` or `.sql` backup described above.

## Rehearsal Steps

1. Export a fresh backup from production (read-only operation).
2. Start an isolated rehearsal stack (separate compose project + volumes).
3. Restore the 1.9 backup into rehearsal Postgres.
4. Start backend on rehearsal stack and allow migrations to run.
5. Verify backend startup logs report expected migration version.
6. Execute smoke checks:
   - login works
   - library loads
   - media CRUD works
   - invites/admin pages load
   - integrations settings load
7. Capture row counts before/after for critical tables:
   - `users`
   - `media`
   - `invites`
   - `app_integrations`
8. Verify new columns/tables expected by migration exist.
9. Run rollback rehearsal on rehearsal DB backup copy only:
   - restore pre-migration backup snapshot
   - confirm app returns to 1.9 behavior

## Suggested SQL Validation Snippets

```sql
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM media;
SELECT COUNT(*) FROM invites;
SELECT COUNT(*) FROM app_integrations;
```

```sql
SELECT version, description, applied_at
FROM schema_migrations
ORDER BY version DESC
LIMIT 10;
```

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'app_integrations'
  AND column_name = 'space_id';
```

## Exit Criteria

- Migration applies without errors on rehearsal stack.
- Core smoke flows pass.
- No unexpected row-count drops in critical tables.
- Rollback on rehearsal copy is documented and validated.

## CI Evidence

- GitHub Actions job `migration-check` runs:
  1. migration-chain fresh-install authority check against the maintained `init.sql` reference,
  1. forward migration check,
  2. restore-based rollback rehearsal (`npm run test:migration-rehearsal`),
  3. artifact upload.
- Artifact: `migration-rehearsal-evidence.json`
  - has top-level `status: passed`,
  - includes baseline/latest version checks,
  - pre-upgrade, post-upgrade, rollback, and restored row counts,
  - rollback parity assertion,
  - includes `restoreAuthority` identifying `postgresql_template_snapshot`, the append-only migration chain, an empty migration-built source, every migration version, required bootstrap rows, external migration mode, and a redacted non-owner runtime credential,
  - fails when restored counts differ from post-upgrade counts or any restored-runtime authority check fails.
- Artifact: `init-parity-evidence.json`
  - identifies the append-only migration chain as fresh-install authority,
  - verifies the authority database reached every expected migration,
  - inventories relations, columns, indexes, constraints, triggers, functions, scope-security objects, migration rows, feature flags, and required bootstrap rows,
  - compares the authority database with the maintained `init.sql` reference and requires zero drift.
- Canonical control-plane follow-through: `backend/artifacts/control-plane-runtime-authority-evidence.json`
  - is produced inside the existing canonical backend/database containers, not a second stack,
  - creates an empty scratch database and applies the same complete append-only chain,
  - starts a production-mode Platform backend through a redacted non-owner runtime credential on an unpublished container-local port,
  - requires the Platform workspace contract and full Platform edition boundary smoke,
  - removes the temporary process, database, and runtime/broker roles before succeeding.

## Notes

- Never run rehearsal directly against production DB.
- Keep rehearsal artifacts (logs, SQL output, row counts) attached to release notes for traceability.
