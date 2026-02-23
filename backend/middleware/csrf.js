const crypto = require('crypto');
const { CSRF_COOKIE_OPTIONS } = require('./auth');
const { logActivity } = require('../services/audit');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const EXEMPT_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register'
]);

function issueCsrfToken(res) {
  const token = crypto.randomBytes(24).toString('hex');
  res.cookie('csrf_token', token, CSRF_COOKIE_OPTIONS);
  return token;
}

function clearCsrfToken(res) {
  res.clearCookie('csrf_token', {
    httpOnly: CSRF_COOKIE_OPTIONS.httpOnly,
    sameSite: CSRF_COOKIE_OPTIONS.sameSite,
    secure: CSRF_COOKIE_OPTIONS.secure,
    path: CSRF_COOKIE_OPTIONS.path
  });
}

function shouldEnforceCsrf(req) {
  if (!MUTATING_METHODS.has(req.method)) return false;
  if (EXEMPT_PATHS.has(req.originalUrl)) return false;
  return Boolean(req.cookies?.session_token);
}

function csrfProtection(req, res, next) {
  if (!shouldEnforceCsrf(req)) return next();

  const cookieToken = req.cookies?.csrf_token;
  const headerToken = req.get('x-csrf-token');

  if (cookieToken && headerToken && cookieToken === headerToken) {
    return next();
  }

  void logActivity(req, 'security.csrf.failed', 'http_request', null, {
    method: req.method,
    url: req.originalUrl,
    reason: !cookieToken ? 'missing_csrf_cookie' : (!headerToken ? 'missing_csrf_header' : 'mismatch')
  });
  return res.status(403).json({ error: 'CSRF validation failed' });
}

module.exports = { issueCsrfToken, clearCsrfToken, csrfProtection };
