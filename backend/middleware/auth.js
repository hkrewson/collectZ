const { getSessionUserByToken } = require('../services/sessions');
const { SESSION_TTL_DAYS } = require('../services/sessions');

const parseBoolean = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

/**
 * authenticateToken reads the session token from the httpOnly cookie.
 * Falls back to the Authorization Bearer header for API clients.
 *
 * The session token is opaque, stored hashed in the database, and
 * linked to a user via the user_sessions table.
 */
const authenticateToken = async (req, res, next) => {
  // Prefer cookie (browser clients); fall back to Bearer header (API clients)
  const cookieToken = req.cookies?.session_token;
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  const token = cookieToken || bearerToken;

  if (!token) {
    return res.status(401).json({ error: 'Access denied' });
  }

  try {
    const sessionUser = await getSessionUserByToken(token);
    if (!sessionUser) {
      if (cookieToken) {
        res.clearCookie('session_token');
      }
      return res.status(403).json({ error: 'Invalid or expired session' });
    }

    req.user = {
      id: sessionUser.id,
      email: sessionUser.email,
      role: sessionUser.role
    };
    req.sessionId = sessionUser.session_id;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * requireRole(...roles) — authorization middleware.
 * Must be used after authenticateToken.
 *
 * Usage:
 *   router.get('/admin/...', authenticateToken, requireRole('admin'), handler);
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

/**
 * SESSION_COOKIE_OPTIONS — shared options for Set-Cookie.
 * Exported so login/register routes use the same config.
 */
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: parseBoolean(process.env.SESSION_COOKIE_SECURE, process.env.NODE_ENV === 'production'),
  path: '/',
  maxAge: 1000 * 60 * 60 * 24 * SESSION_TTL_DAYS
};

const CSRF_COOKIE_OPTIONS = {
  httpOnly: false,
  sameSite: SESSION_COOKIE_OPTIONS.sameSite,
  secure: SESSION_COOKIE_OPTIONS.secure,
  path: SESSION_COOKIE_OPTIONS.path,
  maxAge: SESSION_COOKIE_OPTIONS.maxAge
};

module.exports = { authenticateToken, requireRole, SESSION_COOKIE_OPTIONS, CSRF_COOKIE_OPTIONS };
