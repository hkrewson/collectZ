# Upgrade Preservation Audit

This runbook describes how to prove that an upgrade preserves collection rows and user-visible library access before updating a live server.

## Goal

- Detect row-count drops before a production upgrade.
- Detect workspace/library access changes that could make existing rows disappear from a user's view.
- Rehearse a public-server upgrade on a restored database copy instead of the live database.

## What the audit checks

The audit script reads database metadata and counts only. By default it does not include media titles, library names, workspace names, or raw email addresses.

It reports:

- table counts for users, spaces, memberships, libraries, media, wishlist, capture, integrations, and activity-related tables when present,
- current max schema migration version,
- media rows missing or pointing at invalid libraries,
- media rows pointing at invalid spaces,
- libraries with no memberships,
- libraries without an owner/admin membership,
- users with invalid active workspace/library pointers,
- per-user visible media counts through library memberships,
- per-library media and membership counts.

When run with `--compare`, it flags:

- critical table count decreases,
- users missing after upgrade,
- libraries missing after upgrade,
- per-user visible media count decreases,
- per-library media count decreases,
- libraries that lose all members.

## Command

From the repo root, with `DATABASE_URL` pointing at the database to audit:

```bash
npm --prefix backend run test:upgrade-preservation-audit -- \
  --output artifacts/upgrade-preservation/baseline.json
```

After upgrading the rehearsal copy:

```bash
npm --prefix backend run test:upgrade-preservation-audit -- \
  --compare artifacts/upgrade-preservation/baseline.json \
  --output artifacts/upgrade-preservation/after.json \
  --fail-on-risk
```

Use `--include-names` only on private local evidence when names are needed for diagnosis. Do not upload or commit name-bearing production evidence.

## Recommended rehearsal for a public-server upgrade

1. Take a fresh database backup from the public server with `pg_dump`.
2. Back up the uploads/media volume or object storage separately.
3. Restore the database backup into an isolated rehearsal stack with its own database volume.
4. Point `DATABASE_URL` at the restored rehearsal database.
5. Run the audit before starting the new backend image:

   ```bash
   npm --prefix backend run test:upgrade-preservation-audit -- \
     --output artifacts/upgrade-preservation/public-baseline.json
   ```

6. Start the target backend/frontend containers against the rehearsal copy and allow migrations to run.
7. Run the audit again with comparison:

   ```bash
   npm --prefix backend run test:upgrade-preservation-audit -- \
     --compare artifacts/upgrade-preservation/public-baseline.json \
     --output artifacts/upgrade-preservation/public-after.json \
     --fail-on-risk
   ```

8. Browser-smoke the rehearsal stack:
   - sign in as the public account,
   - confirm Dashboard loads,
   - confirm expected libraries appear,
   - confirm expected item counts are visible,
   - open sample records from imported and manually created sources,
   - verify uploaded covers/images for at least a few known records.

9. Only update the live public server after the rehearsal audit and browser smoke pass.

## Interpreting results

- `summary.ok: true` means the script did not find high-risk preservation findings.
- Medium findings still need review. A library without an owner/admin may be operationally risky even if rows remain visible.
- High findings should block the live upgrade until repaired or explicitly explained.

## Safety notes

- Never rehearse migrations against the live public database.
- Keep the pre-upgrade database backup until the upgraded server has been verified.
- Do not commit production audit JSON if it was generated with `--include-names`.
- The audit is a preservation check, not a restore mechanism. Use the backup/restore runbook for rollback.
