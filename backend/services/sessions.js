const crypto = require('crypto');
const pool = require('../db/pool');

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const SESSION_TTL_DAYS = parsePositiveInt(process.env.SESSION_TTL_DAYS, 7);
const SESSION_MAX_PER_USER = parsePositiveInt(process.env.SESSION_MAX_PER_USER, 10);

const hashSessionToken = (token) => crypto
  .createHash('sha256')
  .update(token)
  .digest('hex');

const cleanupExpiredSessions = async () => {
  const result = await pool.query('DELETE FROM user_sessions WHERE expires_at <= NOW()');
  return result.rowCount || 0;
};

const createSession = async (userId, { ipAddress = null, userAgent = null } = {}) => {
  const token = crypto.randomBytes(48).toString('hex');
  const tokenHash = hashSessionToken(token);

  await cleanupExpiredSessions();
  await pool.query(
    `INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '${SESSION_TTL_DAYS} days')`,
    [userId, tokenHash, ipAddress, userAgent]
  );
  await pool.query(
    `DELETE FROM user_sessions
     WHERE user_id = $1
       AND id NOT IN (
         SELECT id
         FROM user_sessions
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2
       )`,
    [userId, SESSION_MAX_PER_USER]
  );

  return token;
};

const getSessionUserByToken = async (token) => {
  const tokenHash = hashSessionToken(token);
  const result = await pool.query(
    `SELECT
       s.id AS session_id,
       u.id,
       u.email,
       u.role
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );

  return result.rows[0] || null;
};

const revokeSessionByToken = async (token) => {
  const tokenHash = hashSessionToken(token);
  await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
};

module.exports = {
  cleanupExpiredSessions,
  createSession,
  getSessionUserByToken,
  revokeSessionByToken,
  SESSION_TTL_DAYS,
  SESSION_MAX_PER_USER
};
