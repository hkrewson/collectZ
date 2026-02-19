const crypto = require('crypto');
const pool = require('../db/pool');

const SESSION_TTL_DAYS = 7;

const hashSessionToken = (token) => crypto
  .createHash('sha256')
  .update(token)
  .digest('hex');

const createSession = async (userId, { ipAddress = null, userAgent = null } = {}) => {
  const token = crypto.randomBytes(48).toString('hex');
  const tokenHash = hashSessionToken(token);

  await pool.query('DELETE FROM user_sessions WHERE expires_at <= NOW()');
  await pool.query(
    `INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '${SESSION_TTL_DAYS} days')`,
    [userId, tokenHash, ipAddress, userAgent]
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
  createSession,
  getSessionUserByToken,
  revokeSessionByToken
};
