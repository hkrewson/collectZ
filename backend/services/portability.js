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
        database_records: {
          status: 'available',
          format: 'Postgres dump / future app export',
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
  buildPortabilityStatus,
  parseDatabaseUrl,
  formatBytes
};
