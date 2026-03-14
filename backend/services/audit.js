const pool = require('../db/pool');
const { buildGelfEvent, maybeExportActivityLog, debugLog } = require('./logExport');

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|session(_|-)?token|csrf(_|-)?token|api(_|-)?key|secret|password|token)$/i;
const SENSITIVE_VALUE_PATTERN = /(bearer\s+[a-z0-9._~-]+|session_token=|csrf_token=)/i;

const sanitizeAuditDetails = (value, key = '') => {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditDetails(item));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => {
        if (SENSITIVE_KEY_PATTERN.test(entryKey) && !/_id$/i.test(entryKey) && !/used$/i.test(entryKey)) {
          return [entryKey, REDACTED];
        }
        return [entryKey, sanitizeAuditDetails(entryValue, entryKey)];
      })
    );
  }

  if (typeof value === 'string') {
    if (SENSITIVE_KEY_PATTERN.test(key) && !/_id$/i.test(key) && !/used$/i.test(key)) {
      return REDACTED;
    }
    if (SENSITIVE_VALUE_PATTERN.test(value)) {
      return REDACTED;
    }
  }

  return value;
};

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
    const sanitizedDetails = details ? sanitizeAuditDetails(details) : null;
    await pool.query(
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [userId, action, entityType, entityId, sanitizedDetails ? JSON.stringify(sanitizedDetails) : null, ipAddress]
    );
    try {
      const event = buildGelfEvent({
        req,
        action,
        entityType,
        entityId,
        details: sanitizedDetails,
        ipAddress,
        userId
      });
      debugLog('activity.built', {
        action,
        requestId: event._request_id || null,
        userId,
        entityType,
        entityId: entityId ?? null
      });
      await maybeExportActivityLog(event);
    } catch (exportError) {
      console.warn('Structured log export failed:', exportError.message);
    }
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

module.exports = { logActivity, logError, extractRequestIp, sanitizeAuditDetails };
