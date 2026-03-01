const pool = require('../db/pool');

const extractRequestIp = (req) => {
  const forwarded = req?.headers?.['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    return first || null;
  }
  return req?.ip || req?.socket?.remoteAddress || null;
};

const logActivity = async (req, action, entityType = null, entityId = null, details = null) => {
  try {
    const userId = req.user?.id || null;
    const ipAddress = extractRequestIp(req);
    await pool.query(
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [userId, action, entityType, entityId, details ? JSON.stringify(details) : null, ipAddress]
    );
  } catch (error) {
    console.error('Activity log write failed:', error.message);
  }
};

const logError = (context, error) => {
  const message = error?.message || String(error);
  const status = error?.response?.status;
  if (status) {
    console.error(`[${context}] ${message} (HTTP ${status})`);
  } else {
    console.error(`[${context}] ${message}`);
  }
};

module.exports = { logActivity, logError, extractRequestIp };
