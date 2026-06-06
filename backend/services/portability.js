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
const JSON_EXPORT_FORMAT = 'collectz.portability.export.v1';
const CSV_EXPORT_FORMAT = 'collectz.portability.csv.v1';
const ZIP_STORE_METHOD = 0;
const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

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

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function getDosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function buildZipArchive(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = getDosDateTime();

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data || ''), 'utf8');
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(ZIP_STORE_METHOD, 8);
    localHeader.writeUInt16LE(now.time, 10);
    localHeader.writeUInt16LE(now.date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(ZIP_STORE_METHOD, 10);
    centralHeader.writeUInt16LE(now.time, 12);
    centralHeader.writeUInt16LE(now.date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralSize, 12);
  endRecord.writeUInt32LE(centralOffset, 16);
  endRecord.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, endRecord]);
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

function tableRowsToCsv(rows) {
  const columns = Array.from(rows.reduce((set, row) => {
    Object.keys(row || {}).forEach((key) => set.add(key));
    return set;
  }, new Set()));
  columns.sort((a, b) => {
    if (a === 'id') return -1;
    if (b === 'id') return 1;
    return a.localeCompare(b);
  });
  if (!columns.length) {
    return csvRows([['id']]);
  }
  return csvRows([
    columns,
    ...rows.map((row) => columns.map((column) => row?.[column] ?? ''))
  ]);
}

function manifestToCsv(manifest) {
  return csvRows([
    ['key', 'value'],
    ['format', CSV_EXPORT_FORMAT],
    ['json_format', manifest?.format || JSON_EXPORT_FORMAT],
    ['generated_at', manifest?.generated_at || ''],
    ['app', manifest?.app || 'collectZ'],
    ['version', manifest?.version || 'unknown'],
    ['database_records', manifest?.includes?.database_records ? 'true' : 'false'],
    ['upload_file_manifest', manifest?.includes?.upload_file_manifest ? 'true' : 'false'],
    ['upload_file_binaries', manifest?.includes?.upload_file_binaries ? 'true' : 'false'],
    ['integration_secrets', manifest?.includes?.integration_secrets ? 'true' : 'false'],
    ['restore_automation', manifest?.includes?.restore_automation ? 'true' : 'false'],
    ['redaction_enabled', manifest?.redaction?.enabled ? 'true' : 'false'],
    ['redacted_values', manifest?.redaction?.redacted_values ?? 0]
  ]);
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
        format: JSON_EXPORT_FORMAT,
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

async function buildPortabilityCsvArchive() {
  const payload = await buildPortabilityExportPayload();
  const generatedAt = String(payload.manifest.generated_at).replace(/[:.]/g, '-');
  const files = [
    { name: 'manifest.csv', data: manifestToCsv(payload.manifest) },
    {
      name: 'restore_guidance.csv',
      data: csvRows([
        ['step', 'guidance'],
        ...(payload.restore_guidance || []).map((item, index) => [index + 1, item])
      ])
    },
    {
      name: 'uploads_manifest.csv',
      data: csvRows([
        ['path', 'size_bytes', 'modified_at'],
        ...((payload.uploads?.files || []).map((file) => [file.path, file.size_bytes, file.modified_at]))
      ])
    },
    ...((payload.database?.tables || []).map((table, index) => ({
      name: `tables/${String(index + 1).padStart(2, '0')}-${table.key}.csv`,
      data: tableRowsToCsv(table.rows || [])
    })))
  ];

  return {
    payload,
    buffer: buildZipArchive(files),
    filename: `collectz-export-${generatedAt}.csv.zip`,
    file_count: files.length
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
          format: 'collectZ JSON gzip export or CSV zip export',
          formats: ['json', 'csv'],
          includes_upload_binaries: false,
          note: 'Manual exports include database rows and an uploads manifest. JSON is best for portability; CSV is best for spreadsheet review. Back up upload binaries separately.'
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
  buildPortabilityCsvArchive,
  buildPortabilityExportPayload,
  buildZipArchive,
  buildPortabilityStatus,
  parseDatabaseUrl,
  formatBytes,
  redactPortableValue
};
