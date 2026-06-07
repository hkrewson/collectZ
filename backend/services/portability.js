'use strict';

const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const appMeta = require('../app-meta.json');

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

const PORTABLE_TABLES = [
  { key: 'media', label: 'Library items', table: 'media' },
  { key: 'art', label: 'Art records', table: 'art_items' },
  { key: 'collectibles', label: 'Collectibles', table: 'collectibles' },
  { key: 'events', label: 'Events', table: 'events' },
  { key: 'wishlist', label: 'Wishlist items', table: 'wanted_items' },
  { key: 'loans', label: 'Loans', table: 'media_loans' },
  { key: 'captures', label: 'Capture inbox rows', table: 'capture_items' },
  { key: 'libraries', label: 'Libraries', table: 'libraries' },
  { key: 'workspaces', label: 'Workspaces', table: 'spaces' }
];

const DIRECT_SPACE_TABLES = new Set([
  'media',
  'art_items',
  'collectibles',
  'events',
  'wanted_items',
  'media_loans',
  'capture_items',
  'libraries'
]);

const SECRET_KEY_PATTERN = /(password|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential|encryption)/i;
const SECRET_URL_PARAM_PATTERN = /([?&](?:[^=&#]*(?:token|secret|password|api[_-]?key|access[_-]?key|credential)[^=&#]*)=)[^&#]*/gi;
const JSON_EXPORT_FORMAT = 'collectz.portability.export.v1';
const CSV_EXPORT_FORMAT = 'collectz.portability.csv.v1';
const DEFAULT_BACKUP_FRESHNESS_HOURS = 24;

function parseDatabaseUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) {
    return {
      configured: false,
      host: null,
      port: null,
      database: null,
      user: null
    };
  }

  try {
    const parsed = new URL(raw);
    return {
      configured: true,
      host: parsed.hostname || null,
      port: parsed.port || null,
      database: parsed.pathname ? parsed.pathname.replace(/^\/+/, '') : null,
      user: parsed.username ? decodeURIComponent(parsed.username) : null
    };
  } catch (_) {
    return {
      configured: true,
      host: 'unreadable',
      port: null,
      database: null,
      user: null
    };
  }
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatAgeHours(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const rounded = Math.round(Number(value) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function normalizePortabilityScope(options = {}) {
  if (options.scope && typeof options.scope === 'object') {
    return normalizePortabilityScope({
      ...options.scope,
      spaceId: options.scope.space_id || options.scope.spaceId
    });
  }
  const requestedScope = String(options.scope || options.type || 'platform').trim().toLowerCase();
  if (requestedScope === 'workspace') {
    const spaceId = Number(options.spaceId || options.space_id || 0);
    if (!Number.isFinite(spaceId) || spaceId <= 0) {
      const error = new Error('Workspace portability requires a valid space id');
      error.status = 400;
      throw error;
    }
    const label = String(options.spaceName || options.label || '').trim() || `Workspace ${spaceId}`;
    return {
      type: 'workspace',
      space_id: spaceId,
      label
    };
  }

  return {
    type: 'platform',
    space_id: null,
    label: 'Platform'
  };
}

function scopedTableClause(table, scope) {
  if (!scope || scope.type !== 'workspace') {
    return { where: '', params: [] };
  }
  if (DIRECT_SPACE_TABLES.has(table)) {
    return { where: ' WHERE space_id = $1', params: [scope.space_id] };
  }
  if (table === 'spaces') {
    return { where: ' WHERE id = $1', params: [scope.space_id] };
  }
  return { where: '', params: [] };
}

function scopedMediaIdentifierClause(scope) {
  const identifierClause = `
    (
      tmdb_id IS NOT NULL
       OR NULLIF(TRIM(COALESCE(upc, '')), '') IS NOT NULL
       OR COALESCE(type_details, '{}'::jsonb) ?| ARRAY[
         'isbn',
         'isbn13',
         'google_books_id',
         'provider_name',
         'provider_item_id',
         'plex_rating_key',
         'kavita_series_id'
       ]
    )
  `;
  if (scope?.type === 'workspace') {
    return {
      where: `WHERE space_id = $1 AND ${identifierClause}`,
      params: [scope.space_id]
    };
  }
  return {
    where: `WHERE ${identifierClause}`,
    params: []
  };
}

function buildRestoreRehearsalReadback({ databaseOk, storage, backupFreshness, counts, scope } = {}) {
  const totalPortableRows = Array.isArray(counts)
    ? counts.reduce((sum, item) => sum + (Number(item.count || 0) || 0), 0)
    : 0;
  const freshnessStatus = String(backupFreshness?.status || '').trim().toLowerCase();
  const freshnessOk = freshnessStatus === 'fresh';
  const storageOk = Boolean(storage?.configured);
  const steps = [
    {
      key: 'database_export',
      label: 'Database export',
      status: databaseOk && totalPortableRows > 0 ? 'ok' : 'warn',
      detail: databaseOk && totalPortableRows > 0
        ? `${totalPortableRows} ${scope?.type === 'workspace' ? 'workspace-scoped ' : ''}database rows are visible to the portability export.`
        : 'No portable database rows are visible yet.'
    },
    {
      key: 'backup_freshness',
      label: 'Backup freshness',
      status: freshnessOk ? 'ok' : 'warn',
      detail: freshnessOk
        ? backupFreshness.detail
        : 'Connect a backup marker or confirm the latest host backup before rehearsal.'
    },
    {
      key: 'image_binaries',
      label: 'Uploaded image binaries',
      status: storageOk ? 'manual' : 'warn',
      detail: storageOk
        ? scope?.type === 'workspace'
          ? 'Export includes a storage manifest only; copy needed uploaded image binaries from the uploads volume or object storage separately.'
          : 'Export includes an uploads manifest only; copy the uploads volume or object storage separately.'
        : 'Uploads storage is not readable from this backend runtime.'
    },
    {
      key: 'restore_dry_run',
      label: 'Restore dry run',
      status: 'manual',
      detail: 'Use a separate test stack, restore the database dump and uploads, then validate health before touching live data.'
    }
  ];
  const hasError = steps.some((step) => step.status === 'error');
  const hasWarn = steps.some((step) => step.status === 'warn');

  return {
    status: hasError ? 'blocked' : hasWarn ? 'needs_attention' : 'ready_for_manual_rehearsal',
    destructive: false,
    last_checked_at: new Date().toISOString(),
    summary: hasWarn
      ? 'Restore rehearsal needs at least one manual check before it is trustworthy.'
      : 'Restore rehearsal has the expected inputs for a manual dry run.',
    steps
  };
}

async function getBackupFreshnessReadback(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const maxAgeHours = parsePositiveNumber(
    options.maxAgeHours ?? process.env.COLLECTZ_BACKUP_FRESHNESS_HOURS ?? process.env.BACKUP_FRESHNESS_HOURS,
    DEFAULT_BACKUP_FRESHNESS_HOURS
  );
  const markerPath = String(
    options.markerPath ?? process.env.COLLECTZ_BACKUP_STATUS_PATH ?? process.env.BACKUP_STATUS_PATH ?? ''
  ).trim();
  const base = {
    checked_at: now.toISOString(),
    max_age_hours: maxAgeHours,
    marker_path: markerPath || null
  };

  if (!markerPath) {
    return {
      ...base,
      configured: false,
      status: 'not_configured',
      last_success_at: null,
      last_started_at: null,
      age_hours: null,
      detail: 'No backup status marker is configured. Set COLLECTZ_BACKUP_STATUS_PATH to let collectZ read scheduled backup freshness.'
    };
  }

  let raw;
  try {
    raw = await fs.promises.readFile(markerPath, 'utf8');
  } catch (error) {
    return {
      ...base,
      configured: true,
      status: 'unavailable',
      last_success_at: null,
      last_started_at: null,
      age_hours: null,
      detail: `Backup status marker could not be read: ${error.message || 'unavailable'}`
    };
  }

  let marker;
  try {
    marker = JSON.parse(raw);
  } catch (_) {
    return {
      ...base,
      configured: true,
      status: 'invalid',
      last_success_at: null,
      last_started_at: null,
      age_hours: null,
      detail: 'Backup status marker is not valid JSON.'
    };
  }

  const reportedStatus = String(marker.status || marker.state || '').trim().toLowerCase();
  const lastSuccess = parseOptionalDate(marker.last_success_at || marker.lastSuccessfulAt || marker.completed_at);
  const lastStarted = parseOptionalDate(marker.last_started_at || marker.lastStartedAt || marker.started_at);
  const ageHours = lastSuccess ? Math.max(0, (now.getTime() - lastSuccess.getTime()) / 36e5) : null;
  const backupLabel = marker.backup_file || marker.filename || marker.path || null;
  const backupSizeBytes = Number.isFinite(Number(marker.size_bytes)) ? Number(marker.size_bytes) : null;

  if (['failed', 'error'].includes(reportedStatus)) {
    return {
      ...base,
      configured: true,
      status: 'failed',
      last_success_at: lastSuccess ? lastSuccess.toISOString() : null,
      last_started_at: lastStarted ? lastStarted.toISOString() : null,
      age_hours: ageHours,
      backup_label: backupLabel,
      backup_size: backupSizeBytes === null ? null : formatBytes(backupSizeBytes),
      detail: marker.message || marker.error || 'The most recent backup marker reports a failed backup.'
    };
  }

  if (!lastSuccess) {
    return {
      ...base,
      configured: true,
      status: 'warn',
      last_success_at: null,
      last_started_at: lastStarted ? lastStarted.toISOString() : null,
      age_hours: null,
      backup_label: backupLabel,
      backup_size: backupSizeBytes === null ? null : formatBytes(backupSizeBytes),
      detail: 'Backup status marker exists, but it does not report a successful backup timestamp.'
    };
  }

  const fresh = ageHours <= maxAgeHours;
  return {
    ...base,
    configured: true,
    status: fresh ? 'fresh' : 'stale',
    last_success_at: lastSuccess.toISOString(),
    last_started_at: lastStarted ? lastStarted.toISOString() : null,
    age_hours: ageHours,
    backup_label: backupLabel,
    backup_size: backupSizeBytes === null ? null : formatBytes(backupSizeBytes),
    detail: fresh
      ? `Last successful backup was ${formatAgeHours(ageHours)} hours ago.`
      : `Last successful backup was ${formatAgeHours(ageHours)} hours ago, which is older than the ${maxAgeHours}-hour freshness target.`
  };
}

async function walkDirectoryStats(dir) {
  let fileCount = 0;
  let totalBytes = 0;

  async function visit(target) {
    const entries = await fs.promises.readdir(target, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(target, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile()) {
        const stat = await fs.promises.stat(fullPath);
        fileCount += 1;
        totalBytes += stat.size;
      }
    }
  }

  await visit(dir);
  return { fileCount, totalBytes };
}

async function walkDirectoryManifest(dir) {
  const files = [];

  async function visit(target) {
    const entries = await fs.promises.readdir(target, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(target, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile()) {
        const stat = await fs.promises.stat(fullPath);
        files.push({
          path: path.relative(dir, fullPath).split(path.sep).join('/'),
          size_bytes: stat.size,
          modified_at: stat.mtime.toISOString()
        });
      }
    }
  }

  await visit(dir);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

async function getStorageReadback() {
  const provider = String(process.env.STORAGE_PROVIDER || 'local').trim().toLowerCase() || 'local';
  if (provider === 's3') {
    return {
      provider: 's3',
      location: process.env.S3_BUCKET ? `s3://${process.env.S3_BUCKET}` : 'S3 bucket not set',
      configured: Boolean(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY),
      writable: null,
      file_count: null,
      total_bytes: null,
      total_size: null,
      note: 'Object storage contents are managed outside the local container.'
    };
  }

  try {
    await fs.promises.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.promises.access(UPLOADS_DIR, fs.constants.R_OK | fs.constants.W_OK);
    const stats = await walkDirectoryStats(UPLOADS_DIR);
    return {
      provider: 'local',
      location: '/app/uploads',
      configured: true,
      writable: true,
      file_count: stats.fileCount,
      total_bytes: stats.totalBytes,
      total_size: formatBytes(stats.totalBytes),
      note: 'Uploaded images live in the configured uploads volume.'
    };
  } catch (error) {
    return {
      provider: 'local',
      location: '/app/uploads',
      configured: false,
      writable: false,
      file_count: null,
      total_bytes: null,
      total_size: null,
      note: error.message || 'Uploads directory is not available.'
    };
  }
}

async function tableExists(client, table) {
  const result = await client.query('SELECT to_regclass($1) AS name', [table]);
  return Boolean(result.rows[0]?.name);
}

async function countTable(client, table, scope) {
  if (!(await tableExists(client, table))) return null;
  const clause = scopedTableClause(table, scope);
  const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}${clause.where}`, clause.params);
  return Number(result.rows[0]?.count || 0);
}

async function readTableRows(client, table, scope) {
  if (!(await tableExists(client, table))) return null;
  const clause = scopedTableClause(table, scope);
  const result = await client.query(`SELECT to_jsonb(${table}) AS row FROM ${table}${clause.where} ORDER BY id ASC`, clause.params);
  return result.rows.map((item) => item.row || {});
}

async function getPortableCounts(client, scope) {
  const counts = [];
  for (const item of PORTABLE_TABLES) {
    counts.push({
      key: item.key,
      label: item.label,
      count: await countTable(client, item.table, scope)
    });
  }
  return counts;
}

async function getProviderLinkedCount(client, scope) {
  if (!(await tableExists(client, 'media'))) return 0;
  const clause = scopedMediaIdentifierClause(scope);
  const result = await client.query(`
    SELECT COUNT(*)::int AS count
    FROM media
    ${clause.where}
  `, clause.params);
  return Number(result.rows[0]?.count || 0);
}

function buildChecks({ databaseOk, storage, counts, providerLinkedCount, backupFreshness, scope }) {
  const totalPortableRows = counts.reduce((sum, item) => sum + (Number(item.count || 0) || 0), 0);
  return [
    {
      key: 'database',
      label: 'Database connection',
      status: databaseOk ? 'ok' : 'error',
      detail: databaseOk ? 'Database is reachable from the backend.' : 'Database readback failed.'
    },
    {
      key: 'records',
      label: 'Record coverage',
      status: totalPortableRows > 0 ? 'ok' : 'warn',
      detail: totalPortableRows > 0
        ? `${totalPortableRows} ${scope?.type === 'workspace' ? 'workspace-scoped ' : ''}portable database rows are visible to export planning.`
        : 'No portable collection rows were found yet.'
    },
    {
      key: 'uploads',
      label: 'Image storage',
      status: storage.configured ? 'ok' : 'warn',
      detail: storage.configured
        ? `${storage.file_count ?? 'Unknown'} stored image files are visible.`
        : 'Image storage is not readable from this backend runtime.'
    },
    {
      key: 'provider_metadata',
      label: 'Provider metadata',
      status: providerLinkedCount > 0 ? 'ok' : 'warn',
      detail: providerLinkedCount > 0
        ? `${providerLinkedCount} library records have provider or identifier metadata.`
        : 'No provider-linked media metadata is visible yet.'
    },
    {
      key: 'backup_freshness',
      label: 'Backup freshness',
      status: backupFreshness?.status === 'fresh' ? 'ok' : backupFreshness?.status === 'failed' || backupFreshness?.status === 'invalid' ? 'error' : 'warn',
      detail: backupFreshness?.detail || 'Backup freshness has not been checked yet.'
    },
    {
      key: 'runtime_version',
      label: 'Runtime version',
      status: 'ok',
      detail: `Backend metadata reports ${appMeta.version || 'unknown'}.`
    }
  ];
}

function redactString(value) {
  const raw = String(value);
  SECRET_URL_PARAM_PATTERN.lastIndex = 0;
  if (!SECRET_URL_PARAM_PATTERN.test(raw)) {
    SECRET_URL_PARAM_PATTERN.lastIndex = 0;
    return value;
  }
  SECRET_URL_PARAM_PATTERN.lastIndex = 0;
  return raw.replace(SECRET_URL_PARAM_PATTERN, '$1[redacted]');
}

function redactPortableValue(value, stats = { redacted: 0 }) {
  if (Array.isArray(value)) {
    return value.map((item) => redactPortableValue(item, stats));
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      const redacted = redactString(value);
      if (redacted !== value) stats.redacted += 1;
      return redacted;
    }
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }

  return Object.entries(value).reduce((next, [key, item]) => {
    if (SECRET_KEY_PATTERN.test(String(key))) {
      next[key] = '[redacted]';
      stats.redacted += 1;
      return next;
    }
    next[key] = redactPortableValue(item, stats);
    return next;
  }, {});
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function csvEscape(value) {
  const raw = csvCell(value);
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function csvRows(rows) {
  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
}

function sortedRecordKeys(row = {}) {
  return Object.keys(row || {}).sort((a, b) => {
    if (a === 'id') return -1;
    if (b === 'id') return 1;
    return a.localeCompare(b);
  });
}

function keyValueCsv(values) {
  return csvRows([
    ['key', 'value'],
    ...Object.entries(values || {})
  ]);
}

function tableRowsToCsv(rows) {
  const columns = Array.from(rows.reduce((set, row) => {
    sortedRecordKeys(row).forEach((key) => set.add(key));
    return set;
  }, new Set()));
  if (!columns.length) columns.push('id');
  return csvRows([
    columns,
    ...rows.map((row) => columns.map((column) => row?.[column] ?? ''))
  ]);
}

function buildPortabilityCsvFiles(payload) {
  const generatedAt = String(payload.manifest?.generated_at || new Date().toISOString()).replace(/[:.]/g, '-');
  const scope = payload.manifest?.scope || {};
  const prefix = scope.type === 'workspace'
    ? `collectz-workspace-${scope.space_id || 'current'}-export-${generatedAt}`
    : `collectz-export-${generatedAt}`;
  return [
    {
      key: 'manifest',
      label: 'Manifest',
      filename: `${prefix}-manifest.csv`,
      data: keyValueCsv({
        format: CSV_EXPORT_FORMAT,
        json_format: payload.manifest?.format || JSON_EXPORT_FORMAT,
        generated_at: payload.manifest?.generated_at || '',
        app: payload.manifest?.app || 'collectZ',
        version: payload.manifest?.version || 'unknown',
        scope_type: scope.type || 'platform',
        scope_label: scope.label || '',
        scope_space_id: scope.space_id || '',
        database_records: payload.manifest?.includes?.database_records ? 'true' : 'false',
        upload_file_manifest: payload.manifest?.includes?.upload_file_manifest ? 'true' : 'false',
        upload_file_binaries: payload.manifest?.includes?.upload_file_binaries ? 'true' : 'false',
        integration_secrets: payload.manifest?.includes?.integration_secrets ? 'true' : 'false',
        restore_automation: payload.manifest?.includes?.restore_automation ? 'true' : 'false',
        redaction_enabled: payload.manifest?.redaction?.enabled ? 'true' : 'false',
        redacted_values: payload.manifest?.redaction?.redacted_values ?? 0
      })
    },
    {
      key: 'restore_guidance',
      label: 'Restore guidance',
      filename: `${prefix}-restore-guidance.csv`,
      data: csvRows([
        ['step', 'guidance'],
        ...(payload.restore_guidance || []).map((item, index) => [index + 1, item])
      ])
    },
    {
      key: 'uploads_manifest',
      label: 'Uploads manifest',
      filename: `${prefix}-uploads-manifest.csv`,
      data: csvRows([
        ['path', 'size_bytes', 'modified_at'],
        ...((payload.uploads?.files || []).map((file) => [file.path, file.size_bytes, file.modified_at]))
      ])
    },
    ...((payload.database?.tables || []).map((table) => ({
      key: `table:${table.key}`,
      label: table.label,
      filename: `${prefix}-${table.key}.csv`,
      data: tableRowsToCsv(table.rows || []),
      row_count: table.count || 0
    })))
  ];
}

async function buildUploadsManifest(storage) {
  if (storage.provider === 's3') {
    return {
      provider: 's3',
      location: storage.location,
      included_files: false,
      files: [],
      note: 'Object storage files are not bundled by this manual export; back up the bucket alongside this export.'
    };
  }

  if (!storage.configured) {
    return {
      provider: storage.provider || 'local',
      location: storage.location || '/app/uploads',
      included_files: false,
      files: [],
      note: 'Uploads storage was not readable when the export was generated.'
    };
  }

  const files = await walkDirectoryManifest(UPLOADS_DIR);
  return {
    provider: 'local',
    location: '/app/uploads',
    included_files: false,
    files,
    note: 'This export includes an uploads manifest only. Back up the uploads volume separately for image binaries.'
  };
}

function buildManualExportNote(scope) {
  if (scope.type === 'workspace') {
    return 'Manual exports include database rows for this workspace and an uploads manifest. JSON is best for portability; CSV files are best for spreadsheet review. Back up upload binaries separately.';
  }
  return 'Manual exports include database rows and an uploads manifest. JSON is best for portability; CSV files are best for spreadsheet review. Back up upload binaries separately.';
}

function buildRestoreGuidance(scope) {
  if (scope.type === 'workspace') {
    return [
      'Use the workspace export when you need a portable copy of one workspace.',
      'Back up the uploads volume or object storage bucket with any workspace export that references images.',
      'If you run scheduled backups, write a JSON status marker and set COLLECTZ_BACKUP_STATUS_PATH so collectZ can report freshness.',
      'Rehearse restore in a separate test stack before trusting a backup plan.',
      'Restore workspace data only after confirming the target workspace and import plan.',
      'Validate with container health, backend logs, and a Help > Releases readback.'
    ];
  }
  return [
    'Back up the database with pg_dump from the Docker host.',
    'Back up the uploads volume or object storage bucket with the database snapshot.',
    'If you run scheduled backups, write a JSON status marker and set COLLECTZ_BACKUP_STATUS_PATH so collectZ can report freshness.',
    'Rehearse restore in a separate test stack before trusting a backup plan.',
    'Restore into a stopped app runtime, then restart backend and frontend.',
    'Validate with container health, backend logs, and a Help > Releases readback.'
  ];
}

async function buildPortabilityExportPayload(options = {}) {
  const scope = normalizePortabilityScope(options);
  const generatedAt = new Date().toISOString();
  const status = await buildPortabilityStatus({ scope });
  const client = await pool.connect();
  const redactionStats = { redacted: 0 };

  try {
    const tables = [];
    for (const item of PORTABLE_TABLES) {
      const rows = await readTableRows(client, item.table, scope);
      tables.push({
        key: item.key,
        label: item.label,
        table: item.table,
        exists: Array.isArray(rows),
        count: Array.isArray(rows) ? rows.length : null,
        rows: Array.isArray(rows) ? redactPortableValue(rows, redactionStats) : []
      });
    }

    const uploads = await buildUploadsManifest(status.storage || {});
    const redactedStatus = redactPortableValue(status, redactionStats);
    const redactedValueCount = redactionStats.redacted;
    return {
      manifest: {
        format: JSON_EXPORT_FORMAT,
        generated_at: generatedAt,
        app: appMeta.app || 'collectZ',
        version: appMeta.version || 'unknown',
        scope,
        includes: {
          database_records: true,
          upload_file_manifest: true,
          upload_file_binaries: false,
          integration_secrets: false,
          restore_automation: false
        },
        redaction: {
          enabled: true,
          redacted_values: redactedValueCount
        }
      },
      status: redactedStatus,
      database: {
        tables
      },
      uploads,
      restore_guidance: status.restore_guidance || []
    };
  } finally {
    client.release();
  }
}

async function buildPortabilityJsonExport(options = {}) {
  const payload = await buildPortabilityExportPayload(options);
  const json = JSON.stringify(payload, null, 2);
  const scope = payload.manifest?.scope || {};
  const prefix = scope.type === 'workspace'
    ? `collectz-workspace-${scope.space_id || 'current'}-export`
    : 'collectz-export';
  return {
    payload,
    buffer: Buffer.from(json, 'utf8'),
    filename: `${prefix}-${String(payload.manifest.generated_at).replace(/[:.]/g, '-')}.json`
  };
}

async function buildPortabilityCsvFileExport(fileKey, options = {}) {
  const payload = await buildPortabilityExportPayload(options);
  const files = buildPortabilityCsvFiles(payload);
  if (!fileKey) {
    return {
      payload,
      files: files.map(({ key, label, filename, row_count }) => ({ key, label, filename, row_count }))
    };
  }
  const file = files.find((item) => item.key === fileKey);
  if (!file) {
    const error = new Error('Unknown CSV export file');
    error.status = 400;
    throw error;
  }
  return {
    payload,
    buffer: Buffer.from(file.data, 'utf8'),
    filename: file.filename,
    file
  };
}

async function buildPortabilityStatus(options = {}) {
  const scope = normalizePortabilityScope(options);
  const dbInfo = parseDatabaseUrl(process.env.DATABASE_URL);
  const storage = await getStorageReadback();
  const backupFreshness = await getBackupFreshnessReadback();
  const client = await pool.connect();

  try {
    const dbNow = await client.query('SELECT NOW() AS checked_at');
    const counts = await getPortableCounts(client, scope);
    const providerLinkedCount = await getProviderLinkedCount(client, scope);
    const restoreRehearsal = buildRestoreRehearsalReadback({
      databaseOk: true,
      storage,
      backupFreshness,
      counts,
      scope
    });
    return {
      generated_at: new Date().toISOString(),
      scope,
      database: {
        ...dbInfo,
        ssl: process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1',
        reachable: true,
        checked_at: dbNow.rows[0]?.checked_at || null
      },
      storage,
      backup_freshness: backupFreshness,
      restore_rehearsal: restoreRehearsal,
      export_capabilities: {
        manual_archive: {
          status: 'available',
          format: 'collectZ JSON export or CSV file exports',
          formats: ['json', 'csv'],
          includes_upload_binaries: false,
          note: buildManualExportNote(scope)
        },
        database_records: {
          status: 'available',
          format: 'collectZ JSON export',
          coverage: counts
        },
        uploaded_images: {
          status: storage.configured ? 'available' : 'attention',
          format: storage.provider === 's3' ? 'Object storage bucket' : 'Uploads volume',
          file_count: storage.file_count,
          total_size: storage.total_size
        },
        provider_metadata: {
          status: providerLinkedCount > 0 ? 'available' : 'limited',
          linked_records: providerLinkedCount
        }
      },
      restore_guidance: buildRestoreGuidance(scope),
      docs: [
        {
          label: 'Backup and Restore runbook',
          path: 'docs/wiki/08-Backup-and-Restore.md'
        }
      ],
      checks: buildChecks({ databaseOk: true, storage, counts, providerLinkedCount, backupFreshness, scope })
    };
  } finally {
    client.release();
  }
}

module.exports = {
  buildPortabilityJsonExport,
  buildPortabilityCsvFileExport,
  buildPortabilityExportPayload,
  buildPortabilityCsvFiles,
  buildPortabilityStatus,
  parseDatabaseUrl,
  formatBytes,
  redactPortableValue,
  normalizePortabilityScope,
  getBackupFreshnessReadback,
  buildRestoreRehearsalReadback
};
