const { getSessionUserByToken } = require('../services/sessions');
const { SESSION_TTL_DAYS } = require('../services/sessions');
const { logActivity } = require('../services/audit');
const {
  getPersonalAccessTokenPrincipal,
  touchPersonalAccessToken,
  hasPersonalAccessTokenScope,
  getRequiredPatScopesForRequest
} = require('../services/personalAccessTokens');
const {
  getServiceAccountKeyPrincipal,
  touchServiceAccountKey,
  isServiceAccountPrefixAllowed
} = require('../services/serviceAccountKeys');
const {
  getMobileAccessTokenPrincipal,
  touchMobileAuthSession,
  hasMobileAuthScope,
  getRequiredMobileScopesForRequest
} = require('../services/mobileAuthTokens');

const parseBoolean = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const ALLOW_SESSION_BEARER_FALLBACK = parseBoolean(process.env.ALLOW_SESSION_BEARER_FALLBACK, false);
const SESSION_COOKIE_NAME = String(process.env.SESSION_COOKIE_NAME || 'session_token').trim() || 'session_token';
const CSRF_COOKIE_NAME = String(process.env.CSRF_COOKIE_NAME || 'csrf_token').trim() || 'csrf_token';

const extractBearerToken = (req) => {
  const authHeader = req.headers['authorization'];
  return authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
};

const resolveSessionToken = (req) => {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME] || null;
  if (cookieToken) {
    return { token: cookieToken, source: 'cookie', deniedReason: null };
  }

  const bearerToken = extractBearerToken(req);

  if (!bearerToken) {
    return { token: null, source: null, deniedReason: 'missing_token' };
  }

  if (!ALLOW_SESSION_BEARER_FALLBACK) {
    return { token: null, source: 'bearer', deniedReason: 'bearer_session_fallback_disabled' };
  }

  return { token: bearerToken, source: 'bearer', deniedReason: null };
};

const requirePatScopesForRequest = async (req, res) => {
  const requiredScopes = getRequiredPatScopesForRequest(req);
  if (!requiredScopes || requiredScopes.length === 0) {
    void logActivity(req, 'auth.pat.denied', 'http_request', null, {
      reason: 'unsupported_route',
      method: req.method,
      url: req.originalUrl
    });
    res.status(403).json({ error: 'Personal access tokens are not supported for this route' });
    return false;
  }

  if (!hasPersonalAccessTokenScope(req.authContext?.scopes, requiredScopes)) {
    void logActivity(req, 'auth.pat.denied', 'http_request', null, {
      reason: 'insufficient_scope',
      method: req.method,
      url: req.originalUrl,
      requiredScopes
    });
    res.status(403).json({ error: 'Personal access token scope is insufficient for this route' });
    return false;
  }

  return true;
};

const requireServiceAccountAccessForRequest = async (req, res) => {
  if (!isServiceAccountPrefixAllowed(req.authContext?.allowedPrefixes, req)) {
    void logActivity(req, 'auth.service_account.denied', 'http_request', null, {
      reason: 'disallowed_prefix',
      method: req.method,
      url: req.originalUrl,
      allowedPrefixes: req.authContext?.allowedPrefixes || []
    });
    res.status(403).json({ error: 'Service account key is not allowed for this route' });
    return false;
  }

  const requiredScopes = getRequiredPatScopesForRequest(req);
  if (!requiredScopes || requiredScopes.length === 0) {
    void logActivity(req, 'auth.service_account.denied', 'http_request', null, {
      reason: 'unsupported_route',
      method: req.method,
      url: req.originalUrl
    });
    res.status(403).json({ error: 'Service account keys are not supported for this route' });
    return false;
  }

  if (!hasPersonalAccessTokenScope(req.authContext?.scopes, requiredScopes)) {
    void logActivity(req, 'auth.service_account.denied', 'http_request', null, {
      reason: 'insufficient_scope',
      method: req.method,
      url: req.originalUrl,
      requiredScopes
    });
    res.status(403).json({ error: 'Service account key scope is insufficient for this route' });
    return false;
  }

  return true;
};

const requireMobileAccessForRequest = async (req, res) => {
  const requiredScopes = getRequiredMobileScopesForRequest(req);
  if (!requiredScopes || requiredScopes.length === 0) {
    void logActivity(req, 'auth.mobile.denied', 'http_request', null, {
      reason: 'unsupported_route',
      method: req.method,
      url: req.originalUrl
    });
    res.status(403).json({ error: 'Mobile tokens are not supported for this route' });
    return false;
  }

  if (!hasMobileAuthScope(req.authContext?.scopes, requiredScopes)) {
    void logActivity(req, 'auth.mobile.denied', 'http_request', null, {
      reason: 'insufficient_scope',
      method: req.method,
      url: req.originalUrl,
      requiredScopes
    });
    res.status(403).json({ error: 'Mobile token scope is insufficient for this route' });
    return false;
  }

  return true;
};

/**
 * authenticateToken reads the session token from the httpOnly cookie.
 * Authorization Bearer fallback is disabled by default and only enabled via
 * explicit environment override for legacy non-browser clients.
 *
 * The session token is opaque, stored hashed in the database, and
 * linked to a user via the user_sessions table.
 */
const authenticateToken = async (req, res, next) => {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME] || null;
  const bearerToken = extractBearerToken(req);

  if (!cookieToken && bearerToken) {
    try {
      const serviceAccountPrincipal = await getServiceAccountKeyPrincipal(bearerToken);
      if (serviceAccountPrincipal) {
        req.user = {
          id: serviceAccountPrincipal.owner_user_id,
          email: serviceAccountPrincipal.email,
          role: serviceAccountPrincipal.role,
          scopeSpaceId: serviceAccountPrincipal.scope_space_id ?? serviceAccountPrincipal.active_space_id ?? null,
          activeSpaceId: serviceAccountPrincipal.scope_space_id ?? serviceAccountPrincipal.active_space_id ?? null,
          activeLibraryId: serviceAccountPrincipal.active_library_id ?? null
        };
        req.authContext = {
          type: 'service_account',
          keyId: serviceAccountPrincipal.key_id,
          keyName: serviceAccountPrincipal.key_name,
          scopes: Array.isArray(serviceAccountPrincipal.scopes) ? serviceAccountPrincipal.scopes : [],
          allowedPrefixes: Array.isArray(serviceAccountPrincipal.allowed_prefixes) ? serviceAccountPrincipal.allowed_prefixes : []
        };
        req.sessionId = null;
        const allowed = await requireServiceAccountAccessForRequest(req, res);
        if (!allowed) return;
        await touchServiceAccountKey(serviceAccountPrincipal.key_id);
        return next();
      }

      const patPrincipal = await getPersonalAccessTokenPrincipal(bearerToken);
      if (patPrincipal) {
        req.user = {
          id: patPrincipal.user_id,
          email: patPrincipal.email,
          role: patPrincipal.role,
          scopeSpaceId: patPrincipal.scope_space_id ?? patPrincipal.active_space_id ?? null,
          activeSpaceId: patPrincipal.scope_space_id ?? patPrincipal.active_space_id ?? null,
          activeLibraryId: patPrincipal.active_library_id ?? null
        };
        req.authContext = {
          type: 'pat',
          tokenId: patPrincipal.token_id,
          tokenName: patPrincipal.token_name,
          scopes: Array.isArray(patPrincipal.scopes) ? patPrincipal.scopes : []
        };
        req.sessionId = null;
        const allowed = await requirePatScopesForRequest(req, res);
        if (!allowed) return;
        await touchPersonalAccessToken(patPrincipal.token_id);
        return next();
      }

      const mobilePrincipal = await getMobileAccessTokenPrincipal(bearerToken);
      if (mobilePrincipal) {
        req.user = {
          id: mobilePrincipal.user_id,
          email: mobilePrincipal.email,
          role: mobilePrincipal.role,
          scopeSpaceId: mobilePrincipal.scope_space_id ?? mobilePrincipal.active_space_id ?? null,
          activeSpaceId: mobilePrincipal.scope_space_id ?? mobilePrincipal.active_space_id ?? null,
          activeLibraryId: mobilePrincipal.active_library_id ?? null
        };
        req.authContext = {
          type: 'mobile',
          sessionId: mobilePrincipal.session_id,
          scopes: Array.isArray(mobilePrincipal.scopes) ? mobilePrincipal.scopes : [],
          deviceName: mobilePrincipal.device_name || null,
          platform: mobilePrincipal.platform || null,
          appVersion: mobilePrincipal.app_version || null
        };
        req.sessionId = null;
        const allowed = await requireMobileAccessForRequest(req, res);
        if (!allowed) return;
        await touchMobileAuthSession(mobilePrincipal.session_id);
        return next();
      }

      if (!ALLOW_SESSION_BEARER_FALLBACK) {
        void logActivity(req, 'auth.mobile.denied', 'http_request', null, {
          reason: 'invalid_or_expired_api_token',
          method: req.method,
          url: req.originalUrl
        });
        return res.status(401).json({ error: 'Invalid or expired API token' });
      }
    } catch (error) {
      return next(error);
    }
  }

  const { token, source, deniedReason } = resolveSessionToken(req);

  if (!token) {
    void logActivity(req, 'auth.access.denied', 'http_request', null, {
      reason: deniedReason,
      method: req.method,
      url: req.originalUrl
    });
    if (deniedReason === 'bearer_session_fallback_disabled') {
      return res.status(401).json({ error: 'Bearer session auth is disabled for browser hardening' });
    }
    return res.status(401).json({ error: 'Access denied' });
  }

  try {
    const sessionUser = await getSessionUserByToken(token);
    if (!sessionUser) {
      if (source === 'cookie') {
        res.clearCookie(SESSION_COOKIE_NAME);
      }
      void logActivity(req, 'auth.access.denied', 'http_request', null, {
        reason: 'invalid_or_expired_session',
        method: req.method,
        url: req.originalUrl
      });
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    req.user = {
      id: sessionUser.id,
      email: sessionUser.email,
      role: sessionUser.role,
      scopeSpaceId: sessionUser.support_space_id ?? sessionUser.scope_space_id ?? sessionUser.active_space_id ?? null,
      activeSpaceId: sessionUser.support_space_id ?? sessionUser.scope_space_id ?? sessionUser.active_space_id ?? null,
      activeLibraryId: sessionUser.support_library_id ?? sessionUser.active_library_id ?? null,
      supportSpaceId: sessionUser.support_space_id ?? null,
      supportLibraryId: sessionUser.support_library_id ?? null,
      supportRequestId: sessionUser.support_request_id ?? null,
      supportStartedAt: sessionUser.support_started_at ?? null,
      supportReason: sessionUser.support_reason ?? null,
      supportPreviousSpaceId: sessionUser.support_previous_space_id ?? null,
      supportPreviousLibraryId: sessionUser.support_previous_library_id ?? null
    };
    req.authContext = { type: 'session', scopes: [] };
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
    void logActivity(req, 'auth.permission.denied', 'http_request', null, {
      reason: 'insufficient_permissions',
      method: req.method,
      url: req.originalUrl,
      requiredRoles: roles,
      userRole: req.user?.role || null
    });
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

const requireSessionAuth = (req, res, next) => {
  if (req.authContext?.type !== 'session') {
    void logActivity(req, 'auth.permission.denied', 'http_request', null, {
      reason: 'session_auth_required',
      method: req.method,
      url: req.originalUrl,
      authType: req.authContext?.type || null
    });
    return res.status(403).json({ error: 'Session authentication is required for this route' });
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

module.exports = {
  authenticateToken,
  requireRole,
  requireSessionAuth,
  SESSION_COOKIE_OPTIONS,
  CSRF_COOKIE_OPTIONS,
  resolveSessionToken,
  extractBearerToken,
  ALLOW_SESSION_BEARER_FALLBACK,
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME
};
