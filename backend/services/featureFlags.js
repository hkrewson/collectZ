const pool = require('../db/pool');

const FEATURE_FLAG_DEFINITIONS = {
  self_registration_enabled: {
    description: 'Enable public SaaS self-registration on the auth screen',
    defaultEnabled: true
  },
  events_enabled: {
    description: 'Enable Events library UI and API',
    defaultEnabled: false
  },
  collectibles_enabled: {
    description: 'Enable Collectibles library UI and API',
    defaultEnabled: false
  },
  metrics_enabled: {
    description: 'Enable admin-only Prometheus-style metrics export when DEBUG is enabled',
    defaultEnabled: false
  },
  external_log_export_enabled: {
    description: 'Enable external structured log export for activity/audit events',
    defaultEnabled: false
  }
};

const FLAG_KEYS = Object.keys(FEATURE_FLAG_DEFINITIONS);
const FEATURE_FLAGS_READ_ONLY = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.FEATURE_FLAGS_READ_ONLY || '').trim().toLowerCase()
);
const FEATURE_FLAGS_CACHE_TTL_MS = Math.max(1000, Number(process.env.FEATURE_FLAGS_CACHE_TTL_SECONDS || 10) * 1000);
const SETTINGS_OWNED_FLAGS = new Set(['self_registration_enabled', 'metrics_enabled', 'external_log_export_enabled']);
const SPACE_OWNED_FLAGS = new Set(['events_enabled', 'collectibles_enabled']);
const SPACE_FLAG_COLUMNS = {
  events_enabled: 'events_enabled',
  collectibles_enabled: 'collectibles_enabled'
};

let cache = null;
let cacheAt = 0;

function envOverrideForKey(key) {
  if (SETTINGS_OWNED_FLAGS.has(key)) return null;
  const envKey = `FEATURE_FLAG_${String(key).toUpperCase()}`;
  const raw = process.env[envKey];
  if (raw === undefined || raw === null || raw === '') return null;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function normalizeFeatureFlagRecord(key, storedEnabled, row = null) {
  const override = envOverrideForKey(key);
  return {
    key,
    enabled: override !== null ? override : Boolean(storedEnabled),
    storedEnabled: Boolean(storedEnabled),
    envOverride: override,
    description: row?.description || FEATURE_FLAG_DEFINITIONS[key]?.description || '',
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
    updatedBy: row?.updated_by || null,
    updatedByEmail: row?.updated_by_email || null
  };
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
     WHERE ff.key = ANY($1::text[])
     ORDER BY ff.key ASC`,
    [FLAG_KEYS]
  );

  const byKey = new Map();
  for (const row of result.rows) {
    byKey.set(row.key, normalizeFeatureFlagRecord(row.key, row.enabled, row));
  }

  for (const key of FLAG_KEYS) {
    if (byKey.has(key)) continue;
    const def = FEATURE_FLAG_DEFINITIONS[key];
    byKey.set(key, normalizeFeatureFlagRecord(key, def.defaultEnabled, { description: def.description }));
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

async function listSpaceFeatureFlags(spaceId, options = {}) {
  const numericSpaceId = Number(spaceId || 0);
  if (!Number.isFinite(numericSpaceId) || numericSpaceId <= 0) {
    const error = new Error('space_id must be a positive integer');
    error.status = 400;
    throw error;
  }

  const byKey = await loadFeatureFlags(options);
  const result = await pool.query(
    `SELECT events_enabled, collectibles_enabled
       FROM spaces
      WHERE id = $1
      LIMIT 1`,
    [numericSpaceId]
  );
  if (result.rows.length === 0) {
    const error = new Error('Space not found');
    error.status = 404;
    throw error;
  }

  const scopedRow = result.rows[0];
  return [...SPACE_OWNED_FLAGS].sort().map((key) => {
    const globalFallback = byKey.get(key);
    const column = SPACE_FLAG_COLUMNS[key];
    const scopedValue = scopedRow?.[column];
    const storedEnabled = scopedValue === null || scopedValue === undefined
      ? Boolean(globalFallback?.storedEnabled)
      : Boolean(scopedValue);
    return normalizeFeatureFlagRecord(key, storedEnabled, globalFallback);
  });
}

async function getSpaceFeatureFlag(spaceId, key, options = {}) {
  if (!SPACE_OWNED_FLAGS.has(key)) return null;
  const flags = await listSpaceFeatureFlags(spaceId, options);
  return flags.find((flag) => flag.key === key) || null;
}

async function isFeatureEnabledForSpace(spaceId, key, fallback = false) {
  if (!SPACE_OWNED_FLAGS.has(key)) return isFeatureEnabled(key, fallback);
  const numericSpaceId = Number(spaceId || 0);
  if (!Number.isFinite(numericSpaceId) || numericSpaceId <= 0) {
    return isFeatureEnabled(key, fallback);
  }
  const flag = await getSpaceFeatureFlag(numericSpaceId, key);
  if (!flag) return fallback;
  return Boolean(flag.enabled);
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

async function updateSpaceFeatureFlag({ spaceId, key, enabled, updatedBy = null }) {
  const numericSpaceId = Number(spaceId || 0);
  if (!Number.isFinite(numericSpaceId) || numericSpaceId <= 0) {
    const error = new Error('space_id must be a positive integer');
    error.status = 400;
    throw error;
  }
  if (!SPACE_OWNED_FLAGS.has(key)) {
    const error = new Error(`Unknown space feature flag: ${key}`);
    error.status = 404;
    throw error;
  }
  if (FEATURE_FLAGS_READ_ONLY) {
    const error = new Error('Feature flags are read-only in this environment');
    error.status = 409;
    error.code = 'feature_flags_read_only';
    throw error;
  }
  if (envOverrideForKey(key) !== null) {
    const error = new Error('Feature flag is controlled by the environment');
    error.status = 409;
    error.code = 'feature_flag_env_override';
    throw error;
  }

  const column = SPACE_FLAG_COLUMNS[key];
  const result = await pool.query(
    `UPDATE spaces
        SET ${column} = $2,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id`,
    [numericSpaceId, Boolean(enabled)]
  );
  if (result.rows.length === 0) {
    const error = new Error('Space not found');
    error.status = 404;
    throw error;
  }
  return getSpaceFeatureFlag(numericSpaceId, key, { forceRefresh: true });
}

module.exports = {
  FEATURE_FLAG_DEFINITIONS,
  FEATURE_FLAGS_READ_ONLY,
  FLAG_KEYS,
  SPACE_OWNED_FLAGS,
  listFeatureFlags,
  getFeatureFlag,
  isFeatureEnabled,
  listSpaceFeatureFlags,
  getSpaceFeatureFlag,
  isFeatureEnabledForSpace,
  updateFeatureFlag,
  updateSpaceFeatureFlag,
  invalidateFeatureFlagsCache
};
