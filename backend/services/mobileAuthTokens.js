const crypto = require('crypto');
const pool = require('../db/pool');

const MOBILE_AUTH_SCOPES = ['profile:read', 'capture:read', 'capture:write'];
const MOBILE_ACCESS_TTL_MINUTES = Math.max(5, Number(process.env.MOBILE_ACCESS_TTL_MINUTES || 15));
const MOBILE_REFRESH_TTL_DAYS = Math.max(1, Number(process.env.MOBILE_REFRESH_TTL_DAYS || 30));

const hashMobileAuthToken = (token) => crypto
  .createHash('sha256')
  .update(String(token || ''))
  .digest('hex');

const generateMobileToken = (kind) => `cz_mobile_${kind}_${crypto.randomBytes(32).toString('hex')}`;

const shapeMobileTokenPair = (row, accessToken, refreshToken) => ({
  accessToken,
  refreshToken,
  expiresAt: row.expires_at,
  refreshExpiresAt: row.refresh_expires_at,
  tokenType: 'Bearer',
  scope: Array.isArray(row.scopes) ? row.scopes : MOBILE_AUTH_SCOPES
});

const createMobileAuthSession = async ({
  userId,
  deviceName = null,
  platform = null,
  appVersion = null,
  ipAddress = null,
  userAgent = null
}) => {
  const accessToken = generateMobileToken('access');
  const refreshToken = generateMobileToken('refresh');
  const result = await pool.query(
    `INSERT INTO mobile_auth_sessions (
       user_id, access_token_hash, refresh_token_hash, refresh_token_last_four, scopes,
       device_name, platform, app_version, ip_address, user_agent,
       expires_at, refresh_expires_at
     )
     VALUES (
       $1, $2, $3, $4, $5::jsonb,
       $6, $7, $8, $9, $10,
       NOW() + ($11::int * INTERVAL '1 minute'),
       NOW() + ($12::int * INTERVAL '1 day')
     )
     RETURNING id, user_id, scopes, expires_at, refresh_expires_at, last_used_at, revoked_at, created_at`,
    [
      userId,
      hashMobileAuthToken(accessToken),
      hashMobileAuthToken(refreshToken),
      refreshToken.slice(-4),
      JSON.stringify(MOBILE_AUTH_SCOPES),
      deviceName,
      platform,
      appVersion,
      ipAddress,
      userAgent,
      MOBILE_ACCESS_TTL_MINUTES,
      MOBILE_REFRESH_TTL_DAYS
    ]
  );
  return {
    session: result.rows[0],
    ...shapeMobileTokenPair(result.rows[0], accessToken, refreshToken)
  };
};

const getMobileAccessTokenPrincipal = async (token) => {
  const tokenHash = hashMobileAuthToken(token);
  const result = await pool.query(
    `SELECT
       mas.id AS session_id,
       mas.user_id,
       mas.scopes,
       mas.device_name,
       mas.platform,
       mas.app_version,
       mas.expires_at,
       mas.refresh_expires_at,
       u.email,
       u.role,
       COALESCE(active_library.space_id, u.active_space_id, fallback_library.space_id) AS scope_space_id,
       COALESCE(active_library.space_id, u.active_space_id, fallback_library.space_id) AS active_space_id,
       COALESCE(active_library.id, fallback_library.id) AS active_library_id
     FROM mobile_auth_sessions mas
     JOIN users u ON u.id = mas.user_id
     LEFT JOIN libraries active_library
       ON active_library.id = u.active_library_id
      AND active_library.archived_at IS NULL
     LEFT JOIN LATERAL (
       SELECT l.id, l.space_id
       FROM library_memberships lm
       JOIN libraries l ON l.id = lm.library_id
       JOIN space_memberships sm
         ON sm.space_id = l.space_id
        AND sm.user_id = lm.user_id
        AND sm.suspended_at IS NULL
       WHERE lm.user_id = u.id
         AND l.archived_at IS NULL
       ORDER BY lm.created_at ASC, lm.library_id ASC
       LIMIT 1
     ) fallback_library ON true
     WHERE mas.access_token_hash = $1
       AND mas.revoked_at IS NULL
       AND mas.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  return result.rows[0] || null;
};

const touchMobileAuthSession = async (sessionId) => {
  await pool.query(
    `UPDATE mobile_auth_sessions
     SET last_used_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [sessionId]
  );
};

const refreshMobileAuthSession = async (refreshToken) => {
  const refreshTokenHash = hashMobileAuthToken(refreshToken);
  const accessToken = generateMobileToken('access');
  const nextRefreshToken = generateMobileToken('refresh');
  const result = await pool.query(
    `UPDATE mobile_auth_sessions
     SET access_token_hash = $2,
         refresh_token_hash = $3,
         refresh_token_last_four = $4,
         expires_at = NOW() + ($5::int * INTERVAL '1 minute'),
         refresh_expires_at = NOW() + ($6::int * INTERVAL '1 day'),
         last_used_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE refresh_token_hash = $1
       AND revoked_at IS NULL
       AND refresh_expires_at > NOW()
     RETURNING id, user_id, scopes, expires_at, refresh_expires_at, last_used_at, revoked_at, created_at`,
    [
      refreshTokenHash,
      hashMobileAuthToken(accessToken),
      hashMobileAuthToken(nextRefreshToken),
      nextRefreshToken.slice(-4),
      MOBILE_ACCESS_TTL_MINUTES,
      MOBILE_REFRESH_TTL_DAYS
    ]
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  return {
    session: row,
    ...shapeMobileTokenPair(row, accessToken, nextRefreshToken)
  };
};

const revokeMobileAuthSession = async ({ sessionId = null, refreshToken = null }) => {
  const refreshTokenHash = refreshToken ? hashMobileAuthToken(refreshToken) : null;
  const result = await pool.query(
    `UPDATE mobile_auth_sessions
     SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
         updated_at = CURRENT_TIMESTAMP
     WHERE revoked_at IS NULL
       AND (
         ($1::int IS NOT NULL AND id = $1::int)
         OR ($2::varchar IS NOT NULL AND refresh_token_hash = $2::varchar)
       )
     RETURNING id, user_id, scopes, expires_at, refresh_expires_at, revoked_at`,
    [sessionId, refreshTokenHash]
  );
  return result.rows;
};

const scopeImplies = (granted, required) => granted === required;

const hasMobileAuthScope = (grantedScopes, requiredScopes) => {
  if (!requiredScopes || requiredScopes.length === 0) return true;
  const normalizedGranted = Array.isArray(grantedScopes) ? grantedScopes : [];
  return requiredScopes.some((required) => normalizedGranted.some((granted) => scopeImplies(granted, required)));
};

const getRequiredMobileScopesForRequest = (req) => {
  const path = String(req.originalUrl || req.path || '').split('?')[0];
  const method = String(req.method || 'GET').toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';

  if (path === '/api/mobile/auth/session' || path === '/api/mobile/auth/logout') return ['profile:read'];
  if (path === '/api/auth/me') return ['profile:read'];
  if (path.startsWith('/api/capture-items')) return [isRead ? 'capture:read' : 'capture:write'];
  return null;
};

module.exports = {
  MOBILE_AUTH_SCOPES,
  MOBILE_ACCESS_TTL_MINUTES,
  MOBILE_REFRESH_TTL_DAYS,
  hashMobileAuthToken,
  createMobileAuthSession,
  getMobileAccessTokenPrincipal,
  touchMobileAuthSession,
  refreshMobileAuthSession,
  revokeMobileAuthSession,
  hasMobileAuthScope,
  getRequiredMobileScopesForRequest
};
