const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const { validate, mobileLoginSchema, mobileRefreshSchema, mobileLogoutSchema } = require('../middleware/validate');
const { logActivity } = require('../services/audit');
const { recordAuthEvent } = require('../services/metrics');
const { ensureUserDefaultScope } = require('../services/libraries');
const {
  createMobileAuthSession,
  refreshMobileAuthSession,
  revokeMobileAuthSession,
  MOBILE_AUTH_SCOPES
} = require('../services/mobileAuthTokens');
const {
  getProductEdition,
  isHomelabEdition,
  getPublicRuntimeMode,
  buildRuntimeContract,
  stripHomelabSpaceContext,
  stripHomelabSpaceContextFromUser
} = require('../config/productEdition');

const router = express.Router();

function buildScopeContext(scope) {
  const payload = {
    active_space_id: scope?.spaceId ?? scope?.active_space_id ?? null,
    active_library_id: scope?.libraryId ?? scope?.active_library_id ?? null
  };
  return stripHomelabSpaceContext(payload, getProductEdition());
}

function buildMobileCapabilityInfo() {
  return {
    capture_inbox: true,
    barcode_capture: true,
    provider_enrichment: false,
    media_import: false,
    admin: false
  };
}

function shapeMobileUser(user, scope) {
  const { password: _password, ...safeUser } = user;
  return stripHomelabSpaceContextFromUser({
    ...safeUser,
    runtime_mode: getPublicRuntimeMode(getProductEdition()),
    runtime_contract: buildRuntimeContract(getProductEdition()),
    active_space_id: scope?.spaceId ?? safeUser.active_space_id ?? null,
    active_library_id: scope?.libraryId ?? safeUser.active_library_id ?? null
  }, getProductEdition());
}

function buildMobileAuthResponse({ tokenPair, user, scope }) {
  return {
    accessToken: tokenPair.accessToken,
    refreshToken: tokenPair.refreshToken,
    expiresAt: tokenPair.expiresAt,
    refreshExpiresAt: tokenPair.refreshExpiresAt,
    tokenType: tokenPair.tokenType,
    scope: tokenPair.scope,
    user: shapeMobileUser(user, scope),
    scopeContext: buildScopeContext(scope)
  };
}

router.post('/auth/login', validate(mobileLoginSchema), asyncHandler(async (req, res) => {
  const { email, password, device_name: deviceName, platform, app_version: appVersion } = req.body;

  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (result.rows.length === 0) {
    recordAuthEvent('mobile_login', 'failed');
    await logActivity(req, 'auth.mobile.login.failed', 'user', null, { email, reason: 'invalid_credentials' });
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const user = result.rows[0];
  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    recordAuthEvent('mobile_login', 'failed');
    await logActivity(req, 'auth.mobile.login.failed', 'user', user.id, { email: user.email, reason: 'invalid_credentials' });
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (!isHomelabEdition(getProductEdition()) && !user.email_verified) {
    recordAuthEvent('mobile_login', 'verification_required');
    await logActivity(req, 'auth.mobile.login.denied', 'user', user.id, {
      email: user.email,
      reason: 'email_verification_required'
    });
    return res.status(403).json({
      error: 'Please verify your email before signing in',
      code: 'email_verification_required'
    });
  }

  const scope = await ensureUserDefaultScope(user.id);
  const tokenPair = await createMobileAuthSession({
    userId: user.id,
    deviceName,
    platform,
    appVersion,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || null
  });

  await logActivity({ ...req, user: { id: user.id, role: user.role, email: user.email } }, 'auth.mobile.login', 'user', user.id, {
    email: user.email,
    scopes: MOBILE_AUTH_SCOPES,
    activeSpaceId: scope.spaceId,
    activeLibraryId: scope.libraryId,
    deviceName: deviceName || null,
    platform: platform || null,
    appVersion: appVersion || null
  });
  recordAuthEvent('mobile_login', 'succeeded');

  res.json(buildMobileAuthResponse({ tokenPair, user, scope }));
}));

router.post('/auth/refresh', validate(mobileRefreshSchema), asyncHandler(async (req, res) => {
  const tokenPair = await refreshMobileAuthSession(req.body.refreshToken);
  if (!tokenPair) {
    recordAuthEvent('mobile_refresh', 'failed');
    await logActivity(req, 'auth.mobile.refresh.denied', 'mobile_auth_session', null, {
      reason: 'invalid_or_expired_refresh_token'
    });
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  const userResult = await pool.query(
    'SELECT id, email, name, role, image_path, created_at, updated_at, email_verified, email_verified_at, active_space_id, active_library_id FROM users WHERE id = $1',
    [tokenPair.session.user_id]
  );
  const user = userResult.rows[0] || null;
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
  const scope = await ensureUserDefaultScope(user.id);
  await logActivity({ ...req, user: { id: user.id, role: user.role, email: user.email } }, 'auth.mobile.refresh', 'mobile_auth_session', tokenPair.session.id, {
    scopes: tokenPair.scope,
    activeSpaceId: scope.spaceId,
    activeLibraryId: scope.libraryId
  });
  recordAuthEvent('mobile_refresh', 'succeeded');

  res.json(buildMobileAuthResponse({ tokenPair, user, scope }));
}));

router.post('/auth/logout', authenticateToken, validate(mobileLogoutSchema), asyncHandler(async (req, res) => {
  if (req.authContext?.type !== 'mobile') {
    return res.status(403).json({ error: 'Mobile token authentication is required' });
  }
  const revoked = await revokeMobileAuthSession({
    sessionId: req.authContext.sessionId,
    refreshToken: req.body?.refreshToken || null
  });
  await logActivity(req, 'auth.mobile.logout', 'mobile_auth_session', req.authContext.sessionId, {
    revokedCount: revoked.length,
    refreshTokenIncluded: Boolean(req.body?.refreshToken)
  });
  recordAuthEvent('mobile_logout', 'succeeded');
  res.json({ revoked: true });
}));

router.get('/auth/session', authenticateToken, asyncHandler(async (req, res) => {
  if (req.authContext?.type !== 'mobile') {
    return res.status(403).json({ error: 'Mobile token authentication is required' });
  }
  const userResult = await pool.query(
    'SELECT id, email, name, role, image_path, created_at, updated_at, email_verified, email_verified_at, active_space_id, active_library_id FROM users WHERE id = $1',
    [req.user.id]
  );
  if (userResult.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  const scope = await ensureUserDefaultScope(req.user.id);
  res.json({
    user: shapeMobileUser(userResult.rows[0], scope),
    scopeContext: buildScopeContext(scope),
    scope: Array.isArray(req.authContext.scopes) ? req.authContext.scopes : MOBILE_AUTH_SCOPES,
    tokenType: 'Bearer',
    capabilities: buildMobileCapabilityInfo()
  });
}));

module.exports = router;
