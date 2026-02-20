const { logActivity } = require('../services/audit');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const VALID_MODES = new Set(['off', 'failures', 'mutations', 'all']);

const getMode = () => {
  const raw = String(process.env.AUDIT_LOG_MODE || 'failures').toLowerCase();
  return VALID_MODES.has(raw) ? raw : 'failures';
};

const summarizeErrorBody = (body) => {
  if (!body) return null;
  if (typeof body === 'string') return { message: body.slice(0, 400) };
  if (typeof body !== 'object') return null;
  return {
    error: body.error || body.message || null,
    detail: body.detail || null,
    details: body.details || null
  };
};

const auditRequestOutcome = (req, res, next) => {
  if (!req.originalUrl?.startsWith('/api/')) return next();

  const mode = getMode();
  if (mode === 'off') return next();

  const startedAt = Date.now();
  let responseBody = null;

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    responseBody = body;
    return originalJson(body);
  };

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
      url: req.originalUrl,
      status,
      durationMs: Date.now() - startedAt,
      response: summarizeErrorBody(responseBody)
    };

    void logActivity(req, action, 'http_request', null, details);
  });

  next();
};

module.exports = { auditRequestOutcome, getMode };
