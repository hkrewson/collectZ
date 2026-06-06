# Backup and Restore (Postgres)

This runbook covers safe backup/restore for self-hosted deployments.

## Backup

From repo root on your Docker host:

```bash
mkdir -p backups
BACKUP_FILE="backups/collectz_$(date -u +%Y%m%dT%H%M%SZ).sql"
docker compose --env-file .env exec -T db \
  pg_dump -U "${DB_USER:-collectz}" -d "${POSTGRES_DB:-collectz}" \
  > "$BACKUP_FILE"
```

Optional compressed backup:

```bash
gzip -f "$BACKUP_FILE"
```

## Restore

Warning: this overwrites data in the target database.

1. Stop app services (keep DB running):

```bash
docker compose --env-file .env stop frontend backend
```

2. Restore SQL dump file:

```bash
BACKUP_FILE="backups/collectz_YYYYMMDDTHHMMSSZ.sql"
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-collectz}" -d "${POSTGRES_DB:-collectz}" \
  < "$BACKUP_FILE"
```

If using `.sql.gz`:

```bash
gunzip -c backups/collectz_YYYYMMDDTHHMMSSZ.sql.gz | \
  docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-collectz}" -d "${POSTGRES_DB:-collectz}"
```

3. Restart app services:

```bash
docker compose --env-file .env start backend frontend
```

## Validate

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs --tail=100 backend frontend db
curl -s http://localhost:3000/api/health
```

## Suggested Retention

- Keep daily backups for 7 days.
- Keep weekly backups for 4 weeks.
- Keep monthly backups for 3-6 months.

Store backups off-host if possible.

## Backup Freshness Readback

collectZ can show whether your external backup job has reported a recent successful run. The app does not perform scheduled backups itself; your host backup job writes a small JSON marker file, and the backend reads it.

Set these backend environment variables when you want the app to read backup freshness:

```bash
COLLECTZ_BACKUP_STATUS_PATH=/app/backup-status/collectz-backup-status.json
COLLECTZ_BACKUP_FRESHNESS_HOURS=24
```

Example marker file:

```json
{
  "status": "ok",
  "last_success_at": "2026-06-06T06:00:00.000Z",
  "last_started_at": "2026-06-06T05:59:00.000Z",
  "backup_file": "collectz_20260606T060000Z.sql.gz",
  "size_bytes": 12345678
}
```

If the most recent job failed, write:

```json
{
  "status": "failed",
  "last_started_at": "2026-06-06T06:00:00.000Z",
  "message": "pg_dump exited non-zero"
}
```

Mount the marker file into the backend container read-only if the backup job runs on the Docker host. If no marker is configured, the app reports backup freshness as not connected.
