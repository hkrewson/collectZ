/**
 * asyncHandler wraps an async route handler and forwards any unhandled
 * rejection to Express's next() error pipeline. Without this, unhandled
 * async rejections produce silent 500s with no logging.
 *
 * Usage:
 *   router.get('/path', asyncHandler(async (req, res) => { ... }));
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function sanitizeLogField(value = '') {
  return String(value || '')
    .replace(/[\r\n]+/g, '')
    .replace(/\t+/g, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .trim();
}

function sanitizeRequestUrl(url = '') {
  return sanitizeLogField(url)
    .replace(/(\/api\/plex\/webhooks\/)czpw_[A-Za-z0-9_-]+/g, '$1[REDACTED]')
    .replace(/([?&]token=)czpw_[A-Za-z0-9_-]+/g, '$1[REDACTED]');
}

/**
 * Centralized error handler middleware.
 * Must be registered LAST in the Express app, after all routes.
 */
const errorHandler = (err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.expose !== false && err.message
    ? err.message
    : 'Internal server error';

  if (status >= 500) {
    console.error(`[ERROR] method=${JSON.stringify(sanitizeLogField(req.method))} url=${JSON.stringify(sanitizeRequestUrl(req.originalUrl))} message=${JSON.stringify(sanitizeLogField(err.message))}`);
    if (err.stack) console.error(err.stack);
  }

  res.status(status).json({ error: message });
};

/**
 * Request logger. Must be registered FIRST in the middleware stack,
 * before any routes, so that all requests are captured.
 */
const requestLogger = (req, _res, next) => {
  const ts = new Date().toISOString();
  const startedAt = Date.now();
  const res = _res;
  const requestId = sanitizeLogField(req.requestId || req.headers['x-request-id'] || '-');
  const method = sanitizeLogField(req.method);
  const safeUrl = sanitizeRequestUrl(req.originalUrl);
  const origin = sanitizeLogField(req.headers.origin || '-');
  console.log(`${ts} method=${JSON.stringify(method)} url=${JSON.stringify(safeUrl)} origin=${JSON.stringify(origin)} req=${JSON.stringify(requestId)}`);
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    console.log(`${new Date().toISOString()} method=${JSON.stringify(method)} url=${JSON.stringify(safeUrl)} status=${res.statusCode} duration=${durationMs}ms req=${JSON.stringify(requestId)}`);
  });
  next();
};

module.exports = { asyncHandler, errorHandler, requestLogger, sanitizeRequestUrl, sanitizeLogField };
