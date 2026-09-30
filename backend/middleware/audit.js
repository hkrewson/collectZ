const { logActivity } = require('../services/audit');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const VALID_MODES = new Set(['off', 'failures', 'mutations', 'all']);

const getMode = () => {
  const raw = String(process.env.AUDIT_LOG_MODE || 'failures').toLowerCase();
  return VALID_MODES.has(raw) ? raw : 'failures';
};

const auditRequestOutcome = (req, res, next) => {
  if (!req.originalUrl?.startsWith('/api/')) return next();

  const mode = getMode();
  if (mode === 'off') return next();

  const startedAt = Date.now();

  res.on('finish', () => {
    const status = res.statusCode;
    const isFailure = status >= 400;
    const isMutation = MUTATING_METHODS.has(req.method);
    const shouldLog =
      mode === 'all'
      || (mode === 'failures' && isFailure)
      || (mode === 'mutations' && (isMutation || isFailure));

    if (!shouldLog) return;

    const action = isFailure ? 'request.failed' : 'request.succeeded';
    const details = {
      method: req.method,
      path: req.originalUrl?.split('?')[0] || req.path || req.originalUrl || null,
      status,
      durationMs: Date.now() - startedAt
    };

    void logActivity(req, action, 'http_request', null, details);
  });

  next();
};

module.exports = { auditRequestOutcome, getMode };
