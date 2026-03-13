const crypto = require('crypto');
const pool = require('../db/pool');

const PERSONAL_ACCESS_TOKEN_SCOPES = [
  'profile:read',
  'profile:write',
  'libraries:read',
  'libraries:write',
  'media:read',
  'media:write',
  'events:read',
  'events:write',
  'collectibles:read',
  'collectibles:write',
  'import:run',
  'admin:*'
];

const PERSONAL_ACCESS_TOKEN_DEFAULT_SCOPES = ['media:read'];

const hashPersonalAccessToken = (token) => crypto
  .createHash('sha256')
  .update(String(token || ''))
  .digest('hex');

const generatePersonalAccessToken = () => `cz_pat_${crypto.randomBytes(32).toString('hex')}`;

const normalizeScopes = (scopes) => {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return [...PERSONAL_ACCESS_TOKEN_DEFAULT_SCOPES];
  }
  return [...new Set(scopes.filter((scope) => PERSONAL_ACCESS_TOKEN_SCOPES.includes(scope)))];
};

const createPersonalAccessToken = async ({ userId, name, scopes, expiresAt = null }) => {
  const rawToken = generatePersonalAccessToken();
  const tokenHash = hashPersonalAccessToken(rawToken);
  const normalizedScopes = normalizeScopes(scopes);
  const lastFour = rawToken.slice(-4);
  const result = await pool.query(
    `INSERT INTO personal_access_tokens (user_id, name, token_hash, token_last_four, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id, user_id, name, token_last_four, scopes, expires_at, last_used_at, revoked_at, created_at, updated_at`,
    [userId, name, tokenHash, lastFour, JSON.stringify(normalizedScopes), expiresAt]
  );
  return {
    token: rawToken,
    record: result.rows[0]
  };
};

const listPersonalAccessTokensForUser = async (userId) => {
  const result = await pool.query(
    `SELECT id, user_id, name, token_last_four, scopes, expires_at, last_used_at, revoked_at, created_at, updated_at
     FROM personal_access_tokens
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
};

const revokePersonalAccessToken = async ({ userId, tokenId }) => {
  const result = await pool.query(
    `UPDATE personal_access_tokens
     SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND user_id = $2
       AND revoked_at IS NULL
     RETURNING id, user_id, name, token_last_four, scopes, expires_at, last_used_at, revoked_at, created_at, updated_at`,
    [tokenId, userId]
  );
  return result.rows[0] || null;
};

const getPersonalAccessTokenPrincipal = async (token) => {
  const tokenHash = hashPersonalAccessToken(token);
  const result = await pool.query(
    `SELECT
       pat.id AS token_id,
       pat.user_id,
       pat.name AS token_name,
       pat.scopes,
       pat.expires_at,
       u.email,
       u.role,
       u.active_space_id,
       u.active_library_id
     FROM personal_access_tokens pat
     JOIN users u ON u.id = pat.user_id
     WHERE pat.token_hash = $1
       AND pat.revoked_at IS NULL
       AND (pat.expires_at IS NULL OR pat.expires_at > NOW())
     LIMIT 1`,
    [tokenHash]
  );
  return result.rows[0] || null;
};

const touchPersonalAccessToken = async (tokenId) => {
  await pool.query(
    `UPDATE personal_access_tokens
     SET last_used_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [tokenId]
  );
};

const scopeImplies = (granted, required) => {
  if (granted === required) return true;
  if (granted === 'admin:*') return true;
  return false;
};

const hasPersonalAccessTokenScope = (grantedScopes, requiredScopes) => {
  if (!requiredScopes || requiredScopes.length === 0) return true;
  const normalizedGranted = Array.isArray(grantedScopes) ? grantedScopes : [];
  return requiredScopes.some((required) => normalizedGranted.some((granted) => scopeImplies(granted, required)));
};

const getRequiredPatScopesForRequest = (req) => {
  const path = String(req.originalUrl || req.path || '').split('?')[0];
  const method = String(req.method || 'GET').toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';

  if (path.startsWith('/api/admin')) return ['admin:*'];
  if (path === '/api/auth/me' || path.startsWith('/api/profile') || path.startsWith('/api/settings/general')) {
    return [isRead ? 'profile:read' : 'profile:write'];
  }
  if (path.startsWith('/api/libraries')) return [isRead ? 'libraries:read' : 'libraries:write'];
  if (path.startsWith('/api/media/import-')) return ['import:run'];
  if (path.startsWith('/api/media')) return [isRead ? 'media:read' : 'media:write'];
  if (path.startsWith('/api/events')) return [isRead ? 'events:read' : 'events:write'];
  if (path.startsWith('/api/collectibles')) return [isRead ? 'collectibles:read' : 'collectibles:write'];

  return null;
};

module.exports = {
  PERSONAL_ACCESS_TOKEN_SCOPES,
  PERSONAL_ACCESS_TOKEN_DEFAULT_SCOPES,
  hashPersonalAccessToken,
  createPersonalAccessToken,
  listPersonalAccessTokensForUser,
  revokePersonalAccessToken,
  getPersonalAccessTokenPrincipal,
  touchPersonalAccessToken,
  hasPersonalAccessTokenScope,
  getRequiredPatScopesForRequest
};
