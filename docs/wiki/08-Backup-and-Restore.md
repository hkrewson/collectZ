# Backup and Restore (Postgres)

This runbook covers safe backup/restore for self-hosted deployments.

## Backup

From repo root on your Docker host:

```bash
mkdir -p backups
BACKUP_FILE="backups/mediavault_$(date -u +%Y%m%dT%H%M%SZ).sql"
docker compose --env-file .env exec -T db \
  pg_dump -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
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
BACKUP_FILE="backups/mediavault_YYYYMMDDTHHMMSSZ.sql"
docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}" \
  < "$BACKUP_FILE"
```

If using `.sql.gz`:

```bash
gunzip -c backups/mediavault_YYYYMMDDTHHMMSSZ.sql.gz | \
  docker compose --env-file .env exec -T db \
  psql -U "${DB_USER:-mediavault}" -d "${POSTGRES_DB:-mediavault}"
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
