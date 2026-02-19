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
    console.error(`[ERROR] ${req.method} ${req.originalUrl} — ${err.message}`);
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
  console.log(`${ts} ${req.method} ${req.originalUrl} origin:${req.headers.origin || '-'}`);
  next();
};

module.exports = { asyncHandler, errorHandler, requestLogger };
