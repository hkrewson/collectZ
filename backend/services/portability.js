'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
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

const SECRET_KEY_PATTERN = /(password|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential|encryption)/i;
const SECRET_URL_PARAM_PATTERN = /([?&](?:[^=&#]*(?:token|secret|password|api[_-]?key|access[_-]?key|credential)[^=&#]*)=)[^&#]*/gi;

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

async function countTable(client, table) {
  if (!(await tableExists(client, table))) return null;
  const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
  return Number(result.rows[0]?.count || 0);
}

async function readTableRows(client, table) {
  if (!(await tableExists(client, table))) return null;
  const result = await client.query(`SELECT to_jsonb(${table}) AS row FROM ${table} ORDER BY id ASC`);
  return result.rows.map((item) => item.row || {});
}

async function getPortableCounts(client) {
  const counts = [];
  for (const item of PORTABLE_TABLES) {
    counts.push({
      key: item.key,
      label: item.label,
      count: await countTable(client, item.table)
    });
  }
  return counts;
}

async function getProviderLinkedCount(client) {
  if (!(await tableExists(client, 'media'))) return 0;
  const result = await client.query(`
    SELECT COUNT(*)::int AS count
    FROM media
    WHERE tmdb_id IS NOT NULL
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
  `);
  return Number(result.rows[0]?.count || 0);
}

function buildChecks({ databaseOk, storage, counts, providerLinkedCount }) {
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
        ? `${totalPortableRows} portable database rows are visible to export planning.`
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

async function buildPortabilityExportPayload() {
  const generatedAt = new Date().toISOString();
  const status = await buildPortabilityStatus();
  const client = await pool.connect();
  const redactionStats = { redacted: 0 };

  try {
    const tables = [];
    for (const item of PORTABLE_TABLES) {
      const rows = await readTableRows(client, item.table);
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
        format: 'collectz.portability.export.v1',
        generated_at: generatedAt,
        app: appMeta.app || 'collectZ',
        version: appMeta.version || 'unknown',
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

async function buildPortabilityExportArchive() {
  const payload = await buildPortabilityExportPayload();
  const json = JSON.stringify(payload, null, 2);
  return {
    payload,
    buffer: zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 }),
    filename: `collectz-export-${String(payload.manifest.generated_at).replace(/[:.]/g, '-')}.json.gz`
  };
}

async function buildPortabilityStatus() {
  const dbInfo = parseDatabaseUrl(process.env.DATABASE_URL);
  const storage = await getStorageReadback();
  const client = await pool.connect();

  try {
    const dbNow = await client.query('SELECT NOW() AS checked_at');
    const counts = await getPortableCounts(client);
    const providerLinkedCount = await getProviderLinkedCount(client);
    return {
      generated_at: new Date().toISOString(),
      database: {
        ...dbInfo,
        ssl: process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1',
        reachable: true,
        checked_at: dbNow.rows[0]?.checked_at || null
      },
      storage,
      export_capabilities: {
        manual_archive: {
          status: 'available',
          format: 'collectZ JSON gzip export',
          includes_upload_binaries: false,
          note: 'Manual exports include database rows and an uploads manifest. Back up upload binaries separately.'
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
      restore_guidance: [
        'Back up the database with pg_dump from the Docker host.',
        'Back up the uploads volume or object storage bucket with the database snapshot.',
        'Restore into a stopped app runtime, then restart backend and frontend.',
        'Validate with container health, backend logs, and a Help > Releases readback.'
      ],
      docs: [
        {
          label: 'Backup and Restore runbook',
          path: 'docs/wiki/08-Backup-and-Restore.md'
        }
      ],
      checks: buildChecks({ databaseOk: true, storage, counts, providerLinkedCount })
    };
  } finally {
    client.release();
  }
}

module.exports = {
  buildPortabilityExportArchive,
  buildPortabilityExportPayload,
  buildPortabilityStatus,
  parseDatabaseUrl,
  formatBytes,
  redactPortableValue
};
