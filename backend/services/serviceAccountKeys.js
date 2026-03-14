const crypto = require('crypto');
const pool = require('../db/pool');

const SERVICE_ACCOUNT_KEY_SCOPES = [
  'libraries:read',
  'libraries:write',
  'media:read',
  'media:write',
  'events:read',
  'events:write',
  'collectibles:read',
  'collectibles:write',
  'import:run'
];

const SERVICE_ACCOUNT_ALLOWED_PREFIXES = [
  '/api/libraries',
  '/api/media',
  '/api/media/import-',
  '/api/events',
  '/api/collectibles'
];

const SERVICE_ACCOUNT_DEFAULT_SCOPES = ['media:read'];
const SERVICE_ACCOUNT_DEFAULT_ALLOWED_PREFIXES = ['/api/media'];

const hashServiceAccountKey = (token) => crypto
  .createHash('sha256')
  .update(String(token || ''))
  .digest('hex');

const generateServiceAccountKey = () => `cz_sak_${crypto.randomBytes(32).toString('hex')}`;

const normalizeServiceAccountScopes = (scopes) => {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return [...SERVICE_ACCOUNT_DEFAULT_SCOPES];
  }
  return [...new Set(scopes.filter((scope) => SERVICE_ACCOUNT_KEY_SCOPES.includes(scope)))];
};

const normalizeAllowedPrefixes = (prefixes) => {
  if (!Array.isArray(prefixes) || prefixes.length === 0) {
    return [...SERVICE_ACCOUNT_DEFAULT_ALLOWED_PREFIXES];
  }
  return [...new Set(prefixes.filter((prefix) => SERVICE_ACCOUNT_ALLOWED_PREFIXES.includes(prefix)))];
};

const createServiceAccountKey = async ({ ownerUserId, createdByUserId, name, scopes, allowedPrefixes, expiresAt = null }) => {
  const rawKey = generateServiceAccountKey();
  const keyHash = hashServiceAccountKey(rawKey);
  const normalizedScopes = normalizeServiceAccountScopes(scopes);
  const normalizedPrefixes = normalizeAllowedPrefixes(allowedPrefixes);
  const lastFour = rawKey.slice(-4);
  const result = await pool.query(
    `INSERT INTO service_account_keys (
       owner_user_id,
       created_by_user_id,
       name,
       key_hash,
       key_last_four,
       scopes,
       allowed_prefixes,
       expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
     RETURNING id, owner_user_id, created_by_user_id, name, key_last_four, scopes, allowed_prefixes, expires_at, last_used_at, revoked_at, created_at, updated_at`,
    [
      ownerUserId,
      createdByUserId,
      name,
      keyHash,
      lastFour,
      JSON.stringify(normalizedScopes),
      JSON.stringify(normalizedPrefixes),
      expiresAt
    ]
  );
  return {
    key: rawKey,
    record: result.rows[0]
  };
};

const listServiceAccountKeys = async () => {
  const result = await pool.query(
    `SELECT
       sak.id,
       sak.owner_user_id,
       sak.created_by_user_id,
       sak.name,
       sak.key_last_four,
       sak.scopes,
       sak.allowed_prefixes,
       sak.expires_at,
       sak.last_used_at,
       sak.revoked_at,
       sak.created_at,
       sak.updated_at,
       owner.email AS owner_email,
       creator.email AS created_by_email
     FROM service_account_keys sak
     JOIN users owner ON owner.id = sak.owner_user_id
     LEFT JOIN users creator ON creator.id = sak.created_by_user_id
     ORDER BY sak.created_at DESC`
  );
  return result.rows;
};

const revokeServiceAccountKey = async ({ keyId }) => {
  const result = await pool.query(
    `UPDATE service_account_keys
     SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND revoked_at IS NULL
     RETURNING id, owner_user_id, created_by_user_id, name, key_last_four, scopes, allowed_prefixes, expires_at, last_used_at, revoked_at, created_at, updated_at`,
    [keyId]
  );
  return result.rows[0] || null;
};

const getServiceAccountKeyPrincipal = async (key) => {
  const keyHash = hashServiceAccountKey(key);
  const result = await pool.query(
    `SELECT
       sak.id AS key_id,
       sak.owner_user_id,
       sak.created_by_user_id,
       sak.name AS key_name,
       sak.scopes,
       sak.allowed_prefixes,
       sak.expires_at,
       owner.email,
       owner.role,
       COALESCE(owner.active_space_id, fallback_library.space_id) AS active_space_id,
       COALESCE(owner.active_library_id, fallback_library.id) AS active_library_id
     FROM service_account_keys sak
     JOIN users owner ON owner.id = sak.owner_user_id
     LEFT JOIN LATERAL (
       SELECT l.id, l.space_id
       FROM library_memberships lm
       JOIN libraries l ON l.id = lm.library_id
       WHERE lm.user_id = owner.id
         AND l.archived_at IS NULL
       ORDER BY lm.created_at ASC, lm.library_id ASC
       LIMIT 1
     ) fallback_library ON true
     WHERE sak.key_hash = $1
       AND sak.revoked_at IS NULL
       AND (sak.expires_at IS NULL OR sak.expires_at > NOW())
     LIMIT 1`,
    [keyHash]
  );
  return result.rows[0] || null;
};

const touchServiceAccountKey = async (keyId) => {
  await pool.query(
    `UPDATE service_account_keys
     SET last_used_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [keyId]
  );
};

const isServiceAccountPrefixAllowed = (allowedPrefixes, req) => {
  const path = String(req.originalUrl || req.path || '').split('?')[0];
  const normalized = Array.isArray(allowedPrefixes) ? allowedPrefixes : [];
  return normalized.some((prefix) => path.startsWith(prefix));
};

module.exports = {
  SERVICE_ACCOUNT_KEY_SCOPES,
  SERVICE_ACCOUNT_ALLOWED_PREFIXES,
  SERVICE_ACCOUNT_DEFAULT_SCOPES,
  SERVICE_ACCOUNT_DEFAULT_ALLOWED_PREFIXES,
  hashServiceAccountKey,
  createServiceAccountKey,
  listServiceAccountKeys,
  revokeServiceAccountKey,
  getServiceAccountKeyPrincipal,
  touchServiceAccountKey,
  isServiceAccountPrefixAllowed
};
