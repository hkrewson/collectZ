const pool = require('../db/pool');

const FEATURE_FLAG_DEFINITIONS = {
  import_plex_enabled: {
    description: 'Allow Plex imports from the Import page and API',
    defaultEnabled: true
  },
  import_csv_enabled: {
    description: 'Allow CSV imports (generic and Delicious)',
    defaultEnabled: true
  },
  tmdb_search_enabled: {
    description: 'Allow TMDB search and details lookups',
    defaultEnabled: true
  },
  lookup_upc_enabled: {
    description: 'Allow barcode/UPC lookup API usage',
    defaultEnabled: true
  },
  recognize_cover_enabled: {
    description: 'Allow vision/OCR cover recognition API usage',
    defaultEnabled: true
  }
};

const FLAG_KEYS = Object.keys(FEATURE_FLAG_DEFINITIONS);
const FEATURE_FLAGS_READ_ONLY = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.FEATURE_FLAGS_READ_ONLY || '').trim().toLowerCase()
);
const FEATURE_FLAGS_CACHE_TTL_MS = Math.max(1000, Number(process.env.FEATURE_FLAGS_CACHE_TTL_SECONDS || 10) * 1000);

let cache = null;
let cacheAt = 0;

function envOverrideForKey(key) {
  const envKey = `FEATURE_FLAG_${String(key).toUpperCase()}`;
  const raw = process.env[envKey];
  if (raw === undefined || raw === null || raw === '') return null;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

async function ensureDefaultFlags() {
  if (FLAG_KEYS.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const key of FLAG_KEYS) {
      const def = FEATURE_FLAG_DEFINITIONS[key];
      await client.query(
        `INSERT INTO feature_flags (key, enabled, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE
         SET description = EXCLUDED.description`,
        [key, def.defaultEnabled, def.description]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function loadFeatureFlags({ forceRefresh = false } = {}) {
  if (!forceRefresh && cache && (Date.now() - cacheAt) < FEATURE_FLAGS_CACHE_TTL_MS) {
    return cache;
  }

  await ensureDefaultFlags();

  const result = await pool.query(
    `SELECT ff.key, ff.enabled, ff.description, ff.created_at, ff.updated_at, ff.updated_by,
            u.email AS updated_by_email
     FROM feature_flags ff
     LEFT JOIN users u ON u.id = ff.updated_by
     ORDER BY ff.key ASC`
  );

  const byKey = new Map();
  for (const row of result.rows) {
    const override = envOverrideForKey(row.key);
    byKey.set(row.key, {
      key: row.key,
      enabled: override !== null ? override : Boolean(row.enabled),
      storedEnabled: Boolean(row.enabled),
      envOverride: override,
      description: row.description || FEATURE_FLAG_DEFINITIONS[row.key]?.description || '',
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
      updatedBy: row.updated_by || null,
      updatedByEmail: row.updated_by_email || null
    });
  }

  for (const key of FLAG_KEYS) {
    if (byKey.has(key)) continue;
    const def = FEATURE_FLAG_DEFINITIONS[key];
    const override = envOverrideForKey(key);
    byKey.set(key, {
      key,
      enabled: override !== null ? override : Boolean(def.defaultEnabled),
      storedEnabled: Boolean(def.defaultEnabled),
      envOverride: override,
      description: def.description,
      createdAt: null,
      updatedAt: null,
      updatedBy: null,
      updatedByEmail: null
    });
  }

  cache = byKey;
  cacheAt = Date.now();
  return byKey;
}

async function listFeatureFlags(options = {}) {
  const byKey = await loadFeatureFlags(options);
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

async function getFeatureFlag(key, options = {}) {
  if (!key) return null;
  const byKey = await loadFeatureFlags(options);
  return byKey.get(key) || null;
}

async function isFeatureEnabled(key, fallback = false) {
  const row = await getFeatureFlag(key);
  if (!row) return fallback;
  return Boolean(row.enabled);
}

function invalidateFeatureFlagsCache() {
  cache = null;
  cacheAt = 0;
}

async function updateFeatureFlag({ key, enabled, updatedBy = null }) {
  if (!FLAG_KEYS.includes(key)) {
    const error = new Error(`Unknown feature flag: ${key}`);
    error.status = 404;
    throw error;
  }

  if (FEATURE_FLAGS_READ_ONLY) {
    const error = new Error('Feature flags are read-only in this environment');
    error.status = 409;
    error.code = 'feature_flags_read_only';
    throw error;
  }

  await ensureDefaultFlags();

  const result = await pool.query(
    `UPDATE feature_flags
     SET enabled = $2,
         updated_by = $3
     WHERE key = $1
     RETURNING key, enabled, description, created_at, updated_at, updated_by`,
    [key, Boolean(enabled), updatedBy || null]
  );

  if (result.rows.length === 0) {
    const error = new Error(`Feature flag not found: ${key}`);
    error.status = 404;
    throw error;
  }

  invalidateFeatureFlagsCache();
  return getFeatureFlag(key, { forceRefresh: true });
}

module.exports = {
  FEATURE_FLAG_DEFINITIONS,
  FEATURE_FLAGS_READ_ONLY,
  FLAG_KEYS,
  listFeatureFlags,
  getFeatureFlag,
  isFeatureEnabled,
  updateFeatureFlag,
  invalidateFeatureFlagsCache
};
