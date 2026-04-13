const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken, requireRole, requireSessionAuth, SESSION_COOKIE_OPTIONS, SESSION_COOKIE_NAME, CSRF_COOKIE_NAME } = require('../middleware/auth');
const {
  validate,
  registerSchema,
  loginSchema,
  passwordResetRequestSchema,
  emailVerificationRequestSchema,
  emailVerificationConsumeSchema,
  profileUpdateSchema,
  passwordResetConsumeSchema,
  personalAccessTokenCreateSchema,
  serviceAccountKeyCreateSchema,
  authScopeSelectSchema,
  supportSessionStartSchema
} = require('../middleware/validate');
const { createSession, revokeSessionByToken, revokeSessionsForUser, getSessionUserByToken } = require('../services/sessions');
const { logActivity } = require('../services/audit');
const { issueCsrfToken, clearCsrfToken } = require('../middleware/csrf');
const { hashInviteToken } = require('../services/invites');
const { sendPasswordResetEmail, sendEmailVerificationEmail, loadSmtpConfig, isSmtpConfigured } = require('../services/email');
const { getRequestOrigin } = require('../services/requestOrigin');
const { issuePasswordResetToken } = require('../services/passwordResets');
const { issueEmailVerificationToken } = require('../services/emailVerifications');
const {
  ensureUserDefaultScope,
  getAccessibleLibrary,
  listLibrariesForSpace,
  syncLibraryMembershipsForSpaceUser
} = require('../services/libraries');
const { listAccessibleSpacesForUser, getAccessibleSpaceForUser, createPersonalWorkspaceForUser } = require('../services/spaces');
const {
  PERSONAL_ACCESS_TOKEN_SCOPES,
  createPersonalAccessToken,
  listPersonalAccessTokensForUser,
  revokePersonalAccessToken
} = require('../services/personalAccessTokens');
const {
  SERVICE_ACCOUNT_KEY_SCOPES,
  SERVICE_ACCOUNT_ALLOWED_PREFIXES,
  createServiceAccountKey,
  listServiceAccountKeys,
  revokeServiceAccountKey
} = require('../services/serviceAccountKeys');
const { recordAuthEvent } = require('../services/metrics');
const { isSupportAccessApprovalActive } = require('../services/supportAccess');
const { isFeatureEnabled } = require('../services/featureFlags');
const {
  getProductEdition,
  isHomelabEdition,
  buildEditionContract,
  resolvePersistedActiveSpaceId,
  stripHomelabSpaceContext,
  stripHomelabSpaceContextFromUser
} = require('../config/productEdition');

const router = express.Router();
const platformRouter = express.Router();

async function getSupportSpaceSummary(client, spaceId) {
  const result = await client.query(
    `SELECT
       s.id,
       s.name,
       s.slug,
       s.description,
       s.is_personal,
       COUNT(DISTINCT l.id)::int AS library_count
     FROM spaces s
     LEFT JOIN libraries l
       ON l.space_id = s.id
      AND l.archived_at IS NULL
     WHERE s.id = $1
       AND s.archived_at IS NULL
     GROUP BY s.id
     LIMIT 1`,
    [spaceId]
  );
  return result.rows[0] || null;
}

async function listSupportLibrariesForSpace(client, spaceId) {
  const result = await client.query(
    `SELECT l.id, l.name, l.description, l.space_id, l.created_by, l.created_at, l.updated_at,
            u.email AS created_by_email, u.name AS created_by_name,
            COUNT(m.id)::int AS item_count
     FROM libraries l
     LEFT JOIN users u ON u.id = l.created_by
     LEFT JOIN media m ON m.library_id = l.id
     WHERE l.space_id = $1
       AND l.archived_at IS NULL
     GROUP BY l.id, u.email, u.name
     ORDER BY lower(l.name) ASC, l.id ASC`,
    [spaceId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description || null,
    space_id: row.space_id || null,
    created_by: row.created_by || null,
    created_by_email: row.created_by_email || null,
    created_by_name: row.created_by_name || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    item_count: Number(row.item_count || 0)
  }));
}

async function getSupportRequestSessionSummary(client, requestId) {
  if (!Number.isFinite(Number(requestId)) || Number(requestId) <= 0) return null;
  const result = await client.query(
    `SELECT sr.id,
            sr.subject,
            sr.requester_user_id,
            requester.name AS requester_name,
            requester.email AS requester_email,
            target_library.name AS target_library_name
       FROM support_requests sr
       JOIN users requester ON requester.id = sr.requester_user_id
       LEFT JOIN libraries target_library ON target_library.id = sr.target_library_id
      WHERE sr.id = $1
      LIMIT 1`,
    [requestId]
  );
  return result.rows[0] || null;
}

function formatSupportRequestKey(id) {
  const numericId = Number(id || 0);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  return `SUP-${String(numericId).padStart(6, '0')}`;
}

function clearSupportSessionAuthState(req, { clearScope = true } = {}) {
  req.user.supportSpaceId = null;
  req.user.supportLibraryId = null;
  req.user.supportRequestId = null;
  req.user.supportStartedAt = null;
  req.user.supportReason = null;
  req.user.supportPreviousSpaceId = null;
  req.user.supportPreviousLibraryId = null;
  if (clearScope) {
    req.user.scopeSpaceId = null;
    req.user.activeSpaceId = null;
    req.user.activeLibraryId = null;
  }
}

async function normalizeRequestAuthState(req) {
  if (['admin', 'support_admin'].includes(String(req.user?.role || '')) && Number(req.user?.supportSpaceId || 0) > 0) {
    const client = await pool.connect();
    try {
      const supportSpace = await getSupportSpaceSummary(client, Number(req.user.supportSpaceId));
      if (!supportSpace) {
        clearSupportSessionAuthState(req);
        return {
          kind: 'support_session',
          supportSpace: null,
          libraries: [],
          activeLibraryId: null
        };
      }

      const libraries = await listSupportLibrariesForSpace(client, supportSpace.id);
      const requestedLibraryId = Number(req.user.supportLibraryId || 0) || null;
      const activeLibraryId = requestedLibraryId && libraries.some((library) => Number(library.id) === requestedLibraryId)
        ? requestedLibraryId
        : (libraries[0]?.id || null);

      req.user.supportSpaceId = supportSpace.id;
      req.user.supportLibraryId = activeLibraryId;
      req.user.scopeSpaceId = supportSpace.id;
      req.user.activeSpaceId = supportSpace.id;
      req.user.activeLibraryId = activeLibraryId;

      return {
        kind: 'support_session',
        supportSpace,
        libraries,
        activeLibraryId
      };
    } finally {
      client.release();
    }
  }

  if (req.user?.role === 'support_admin') {
    clearSupportSessionAuthState(req);
    return {
      kind: 'support_admin_idle',
      supportSpace: null,
      libraries: [],
      activeLibraryId: null
    };
  }

  const ensuredScope = await ensureUserDefaultScope(req.user.id);
  req.user.scopeSpaceId = ensuredScope.spaceId;
  req.user.activeSpaceId = ensuredScope.spaceId;
  req.user.activeLibraryId = ensuredScope.libraryId;
  return {
    kind: 'default_scope',
    ensuredScope
  };
}

async function buildAuthScopePayload(req) {
  const normalized = await normalizeRequestAuthState(req);
  if (normalized.kind === 'support_session') {
    if (!normalized.supportSpace) {
      return {
        active_space_id: null,
        active_library_id: null,
        spaces: [],
        libraries: [],
        support_session: null
      };
    }

    const client = await pool.connect();
    try {
      const supportRequestSummary = await getSupportRequestSessionSummary(client, Number(req.user.supportRequestId || 0) || null);
      // The summary lookup is separate from state normalization so /me and /profile
      // can reuse the same request-state helper without always paying for request details.
      const activeLibrary = normalized.libraries.find((library) => Number(library.id) === Number(normalized.activeLibraryId)) || null;
      return stripHomelabSpaceContext({
        active_space_id: normalized.supportSpace.id,
        active_library_id: normalized.activeLibraryId,
        spaces: [{
          id: normalized.supportSpace.id,
          name: normalized.supportSpace.name,
          slug: normalized.supportSpace.slug || null,
          description: normalized.supportSpace.description || null,
          is_personal: Boolean(normalized.supportSpace.is_personal),
          membership_role: 'admin',
          library_count: Number(normalized.supportSpace.library_count || 0)
        }],
        libraries: normalized.libraries,
        support_session: {
          active: true,
          space_id: normalized.supportSpace.id,
          library_id: normalized.activeLibraryId,
          started_at: req.user.supportStartedAt || null,
          reason: req.user.supportReason || null,
          request_id: req.user.supportRequestId || null,
          request_key: formatSupportRequestKey(req.user.supportRequestId || null),
          request_subject: supportRequestSummary?.subject || null,
          requester_user_id: supportRequestSummary?.requester_user_id || null,
          requester_name: supportRequestSummary?.requester_name || null,
          requester_email: supportRequestSummary?.requester_email || null,
          previous_space_id: req.user.supportPreviousSpaceId ?? null,
          previous_library_id: req.user.supportPreviousLibraryId ?? null,
          space_name: normalized.supportSpace.name,
          library_name: activeLibrary?.name || supportRequestSummary?.target_library_name || null
        }
      }, getProductEdition());
    } finally {
      client.release();
    }
  }

  if (normalized.kind === 'support_admin_idle') {
    return stripHomelabSpaceContext({
      active_space_id: null,
      active_library_id: null,
      spaces: [],
      libraries: [],
      support_session: null
    }, getProductEdition());
  }

  const client = await pool.connect();
  try {
    const spaces = await listAccessibleSpacesForUser(client, {
      userId: req.user.id,
      role: req.user.role
    });
    const libraries = normalized.ensuredScope.spaceId
      ? await listLibrariesForSpace({
          userId: req.user.id,
          role: req.user.role,
          spaceId: normalized.ensuredScope.spaceId
        })
      : [];

    return stripHomelabSpaceContext({
      active_space_id: normalized.ensuredScope.spaceId,
      active_library_id: normalized.ensuredScope.libraryId,
      spaces: spaces.map((space) => ({
        id: space.id,
        name: space.name,
        slug: space.slug || null,
        description: space.description || null,
        is_personal: Boolean(space.is_personal),
        membership_role: space.membership_role || null,
          library_count: Number(space.library_count || 0)
      })),
      libraries,
      support_session: null
    }, getProductEdition());
  } finally {
    client.release();
  }
}

async function resolveSupportPreviousScope(client, req, currentSession) {
  let previousSpaceId = Number(currentSession.support_previous_space_id || 0)
    || Number(req.user.scopeSpaceId || req.user.activeSpaceId || 0)
    || null;
  let previousLibraryId = Number(currentSession.support_previous_library_id || 0)
    || Number(req.user.activeLibraryId || 0)
    || null;

  if (previousLibraryId) {
    const previousLibrary = await getAccessibleLibrary({
      userId: req.user.id,
      role: req.user.role,
      libraryId: previousLibraryId
    });
    if (previousLibrary) {
      return {
        previousSpaceId: Number(previousLibrary.space_id || 0) || null,
        previousLibraryId: Number(previousLibrary.id || 0) || null
      };
    }
  }

  if (previousSpaceId) {
    const previousSpace = await getAccessibleSpaceForUser(client, {
      userId: req.user.id,
      role: req.user.role,
      spaceId: previousSpaceId
    });
    if (previousSpace) {
      const previousLibraries = await listLibrariesForSpace({
        userId: req.user.id,
        role: req.user.role,
        spaceId: previousSpace.id
      });
      return {
        previousSpaceId: Number(previousSpace.id || 0) || null,
        previousLibraryId: Number(previousLibraries[0]?.id || 0) || null
      };
    }
  }

  return {
    previousSpaceId: null,
    previousLibraryId: null
  };
}

async function buildPublicAuthConfig() {
  const productEdition = getProductEdition();
  const homelabEdition = isHomelabEdition(productEdition);
  const userCountResult = await pool.query('SELECT COUNT(*)::int AS count FROM users');
  const existingUserCount = userCountResult.rows[0]?.count || 0;
  const firstUserBootstrap = existingUserCount === 0;
  const selfRegistrationEnabled = homelabEdition
    ? true
    : await isFeatureEnabled('self_registration_enabled', true);
  const smtpConfigured = homelabEdition
    ? false
    : isSmtpConfigured(await loadSmtpConfig());
  const registrationRequested = homelabEdition || firstUserBootstrap || selfRegistrationEnabled;
  const registerAvailable = homelabEdition
    ? true
    : firstUserBootstrap || (registrationRequested && smtpConfigured);

  return {
    product_edition: productEdition,
    edition_contract: buildEditionContract(productEdition),
    register_available: registerAvailable,
    invite_required: !homelabEdition && existingUserCount > 0 && !selfRegistrationEnabled,
    first_user_bootstrap: firstUserBootstrap,
    password_reset_available: true,
    email_verification_required: !homelabEdition && !firstUserBootstrap,
    smtp_configured: homelabEdition ? null : smtpConfigured
  };
}

// ── CSRF token bootstrap ──────────────────────────────────────────────────────
router.get('/csrf-token', asyncHandler(async (req, res) => {
  const token = issueCsrfToken(res);
  res.json({ csrfToken: token });
}));

router.get('/config', asyncHandler(async (_req, res) => {
  res.json(await buildPublicAuthConfig());
}));

// ── Register ──────────────────────────────────────────────────────────────────

router.post('/register', validate(registerSchema), asyncHandler(async (req, res) => {
  const { email, password, name, inviteToken } = req.body;
  const productEdition = getProductEdition();
  const homelabEdition = isHomelabEdition(productEdition);

  const userCountResult = await pool.query('SELECT COUNT(*)::int AS count FROM users');
  const existingUserCount = userCountResult.rows[0]?.count || 0;
  const firstUserBootstrap = existingUserCount === 0;

  const selfRegistrationEnabled = homelabEdition
    ? true
    : await isFeatureEnabled('self_registration_enabled', true);
  const smtpConfigured = homelabEdition
    ? false
    : isSmtpConfigured(await loadSmtpConfig());
  const bootstrapWithoutSmtp = !homelabEdition && firstUserBootstrap && !smtpConfigured;
  const publicRegistrationAllowed = homelabEdition
    ? true
    : firstUserBootstrap || (selfRegistrationEnabled && smtpConfigured);

  let claimedInvite = null;
  if (!homelabEdition && inviteToken) {
    const tokenHash = hashInviteToken(inviteToken);
    const invite = await pool.query(
      `SELECT * FROM invites
       WHERE (token_hash = $1 OR token = $2)
         AND used = false
         AND revoked = false
         AND expires_at > NOW()`,
      [tokenHash, inviteToken]
    );
    if (invite.rows.length === 0) {
      recordAuthEvent('register', 'failed');
      return res.status(400).json({ error: 'Invalid or expired invite token' });
    }
    if (String(invite.rows[0].email).toLowerCase() !== String(email).toLowerCase()) {
      recordAuthEvent('register', 'failed');
      return res.status(400).json({ error: 'Invite token is not valid for this email address' });
    }
    claimedInvite = invite.rows[0];
  } else if (!homelabEdition && existingUserCount > 0 && !selfRegistrationEnabled) {
    recordAuthEvent('register', 'failed');
    return res.status(400).json({ error: 'An invite token is required to register' });
  } else if (!claimedInvite && !publicRegistrationAllowed) {
    recordAuthEvent('register', 'failed');
    return res.status(503).json({ error: 'Registration is temporarily unavailable until email verification delivery is configured' });
  }

  const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existingUser.rows.length > 0) {
    recordAuthEvent('register', 'failed');
    return res.status(409).json({ error: 'An account with that email already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const role = firstUserBootstrap ? 'admin' : 'user';

  const emailVerified = homelabEdition || Boolean(claimedInvite) || bootstrapWithoutSmtp;
  const emailVerifiedAt = emailVerified ? new Date() : null;
  const result = await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, email, name, role, email_verified, email_verified_at`,
    [email, hashedPassword, name, role, emailVerified, emailVerifiedAt]
  );
  if (claimedInvite?.space_id) {
    await pool.query(
      `INSERT INTO space_memberships (space_id, user_id, role, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (space_id, user_id) DO UPDATE
       SET role = EXCLUDED.role,
           updated_at = CURRENT_TIMESTAMP,
           created_by = COALESCE(space_memberships.created_by, EXCLUDED.created_by)`,
      [
        claimedInvite.space_id,
        result.rows[0].id,
        claimedInvite.space_role || 'member',
        claimedInvite.created_by || null
      ]
    );
    const syncClient = await pool.connect();
    try {
      await syncLibraryMembershipsForSpaceUser(syncClient, {
        spaceId: claimedInvite.space_id,
        userId: result.rows[0].id
      });
    } finally {
      syncClient.release();
    }
  }
  if (inviteToken) {
    await pool.query(
      'UPDATE invites SET used = true, used_by = $2, used_at = NOW() WHERE id = $1',
      [claimedInvite.id, result.rows[0].id]
    );
    await logActivity({ ...req, user: { id: result.rows[0].id } }, 'invite.claimed', 'invite', claimedInvite?.id || null, {
      inviteEmail: claimedInvite?.email || null,
      claimedByEmail: result.rows[0].email,
      spaceId: claimedInvite?.space_id || null,
      role: claimedInvite?.space_role || null
    });
  }

  if (!claimedInvite && !homelabEdition) {
    const personalWorkspaceClient = await pool.connect();
    try {
      await personalWorkspaceClient.query('BEGIN');
      const personalWorkspace = await createPersonalWorkspaceForUser(personalWorkspaceClient, {
        userId: result.rows[0].id,
        email: result.rows[0].email,
        name: result.rows[0].name
      });
      await personalWorkspaceClient.query('COMMIT');
      await logActivity(req, 'workspace.create.personal', 'space', personalWorkspace.id, {
        userId: result.rows[0].id,
        email: result.rows[0].email,
        name: personalWorkspace.name,
        isPersonal: true
      });
    } catch (error) {
      await personalWorkspaceClient.query('ROLLBACK');
      throw error;
    } finally {
      personalWorkspaceClient.release();
    }
  }

  if (!emailVerified) {
    const verification = await issueEmailVerificationToken({
      userId: result.rows[0].id
    });
    const verificationUrl = `${getRequestOrigin(req)}/verify-email?token=${encodeURIComponent(verification.token)}&email=${encodeURIComponent(result.rows[0].email)}`;

    await logActivity({ ...req, user: { id: result.rows[0].id, role: result.rows[0].role, email: result.rows[0].email } }, 'auth.user.register.pending_verification', 'user', result.rows[0].id, {
      email: result.rows[0].email,
      role: result.rows[0].role,
      inviteTokenUsed: false,
      productEdition,
      verificationTokenId: verification.id,
      verificationExpiresAt: verification.expires_at
    });

    try {
      const delivery = await sendEmailVerificationEmail({
        to: result.rows[0].email,
        verificationUrl,
        expiresAt: verification.expires_at
      });
      await logActivity(req, delivery.sent ? 'auth.email_verification.request.delivered' : 'auth.email_verification.request.delivery_skipped', 'user', result.rows[0].id, {
        email: result.rows[0].email,
        verificationTokenId: verification.id,
        delivery: delivery.sent ? 'smtp' : 'none',
        reason: delivery.reason || null
      });
      recordAuthEvent('register', delivery.sent ? 'verification_pending' : 'delivery_skipped');
      return res.status(201).json({
        message: 'Check your email to verify your account before signing in.',
        verification_required: true,
        email: result.rows[0].email
      });
    } catch (error) {
      await logActivity(req, 'auth.email_verification.request.delivery_failed', 'user', result.rows[0].id, {
        email: result.rows[0].email,
        verificationTokenId: verification.id,
        reason: error.message || 'smtp_send_failed'
      });
      recordAuthEvent('register', 'delivery_failed');
      return res.status(202).json({
        message: 'Your account was created, but we could not send the verification email. Use resend verification email from the sign-in screen.',
        verification_required: true,
        email: result.rows[0].email
      });
    }
  }

  const ensuredScope = await ensureUserDefaultScope(result.rows[0].id, {
    preferredSpaceId: claimedInvite?.space_id || null
  });
  const activeLibraryId = ensuredScope.libraryId;
  const activeSpaceId = ensuredScope.spaceId;

  const token = await createSession(result.rows[0].id, {
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || null
  });

  res.cookie(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
  issueCsrfToken(res);
  await logActivity({ ...req, user: { id: result.rows[0].id, role: result.rows[0].role, email: result.rows[0].email } }, 'auth.user.register', 'user', result.rows[0].id, {
    email: result.rows[0].email,
    role: result.rows[0].role,
    inviteTokenUsed: Boolean(inviteToken),
    productEdition,
    invitedSpaceRole: claimedInvite?.space_role || null,
    activeLibraryId
  });
  recordAuthEvent('register', 'succeeded');
  res.json({
    user: {
      ...stripHomelabSpaceContextFromUser(result.rows[0], getProductEdition()),
      active_space_id: stripHomelabSpaceContext({ active_space_id: activeSpaceId }, getProductEdition()).active_space_id,
      active_library_id: activeLibraryId
    }
  });
}));

// ── Login ─────────────────────────────────────────────────────────────────────

router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (result.rows.length === 0) {
    recordAuthEvent('login', 'failed');
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const user = result.rows[0];
  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    recordAuthEvent('login', 'failed');
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!isHomelabEdition(getProductEdition()) && !user.email_verified) {
    recordAuthEvent('login', 'verification_required');
    return res.status(403).json({
      error: 'Please verify your email before signing in',
      code: 'email_verification_required'
    });
  }
  const ensuredScope = await ensureUserDefaultScope(user.id);
  const activeLibraryId = ensuredScope.libraryId;
  const activeSpaceId = ensuredScope.spaceId;

  const token = await createSession(user.id, {
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || null
  });

  const { password: _, ...userWithoutPassword } = user;
  res.cookie(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
  issueCsrfToken(res);
  await logActivity({ ...req, user: { id: user.id, role: user.role, email: user.email } }, 'auth.user.login', 'user', user.id, { email: user.email });
  recordAuthEvent('login', 'succeeded');
  res.json({
    user: {
      ...stripHomelabSpaceContextFromUser(userWithoutPassword, getProductEdition()),
      active_space_id: stripHomelabSpaceContext({ active_space_id: activeSpaceId }, getProductEdition()).active_space_id,
      active_library_id: activeLibraryId
    }
  });
}));

router.post('/email-verification/request', validate(emailVerificationRequestSchema), asyncHandler(async (req, res) => {
  const { email } = req.body;
  const genericResponse = {
    message: 'If an unverified account exists for that email, a verification email will be sent shortly.'
  };

  const userResult = await pool.query(
    'SELECT id, email, email_verified FROM users WHERE lower(email) = lower($1) LIMIT 1',
    [email]
  );
  const user = userResult.rows[0] || null;

  if (!user || user.email_verified) {
    recordAuthEvent('email_verification_request', 'ignored');
    await logActivity(req, 'auth.email_verification.request.ignored', 'user', user?.id || null, {
      email
    });
    return res.json(genericResponse);
  }

  const verification = await issueEmailVerificationToken({
    userId: user.id
  });
  const verificationUrl = `${getRequestOrigin(req)}/verify-email?token=${encodeURIComponent(verification.token)}&email=${encodeURIComponent(user.email)}`;

  await logActivity(req, 'auth.email_verification.request', 'user', user.id, {
    email: user.email,
    verificationTokenId: verification.id,
    expiresAt: verification.expires_at
  });

  try {
    const delivery = await sendEmailVerificationEmail({
      to: user.email,
      verificationUrl,
      expiresAt: verification.expires_at
    });
    await logActivity(
      req,
      delivery.sent ? 'auth.email_verification.request.delivered' : 'auth.email_verification.request.delivery_skipped',
      'user',
      user.id,
      {
        email: user.email,
        verificationTokenId: verification.id,
        delivery: delivery.sent ? 'smtp' : 'none',
        reason: delivery.reason || null
      }
    );
    recordAuthEvent('email_verification_request', delivery.sent ? 'succeeded' : 'delivery_skipped');
  } catch (error) {
    recordAuthEvent('email_verification_request', 'failed');
    await logActivity(req, 'auth.email_verification.request.delivery_failed', 'user', user.id, {
      email: user.email,
      verificationTokenId: verification.id,
      reason: error.message || 'smtp_send_failed'
    });
  }

  res.json(genericResponse);
}));

router.post('/email-verification/consume', validate(emailVerificationConsumeSchema), asyncHandler(async (req, res) => {
  const { token, email } = req.body;
  const tokenHash = hashInviteToken(token);
  const verificationLookup = await pool.query(
    `SELECT evt.id, evt.user_id, u.email
     FROM email_verification_tokens evt
     JOIN users u ON u.id = evt.user_id
     WHERE evt.token_hash = $1
       AND evt.used = false
       AND evt.revoked = false
       AND evt.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  if (verificationLookup.rows.length === 0) {
    recordAuthEvent('email_verification_consume', 'failed');
    await logActivity(req, 'auth.email_verification.consume.failed', 'email_verification', null, {
      email,
      reason: 'invalid_or_expired_token'
    });
    return res.status(400).json({ error: 'Invalid or expired verification token' });
  }
  const verificationRow = verificationLookup.rows[0];
  if (String(verificationRow.email).toLowerCase() !== String(email).toLowerCase()) {
    recordAuthEvent('email_verification_consume', 'failed');
    await logActivity(req, 'auth.email_verification.consume.failed', 'user', verificationRow.user_id, {
      email,
      reason: 'email_mismatch'
    });
    return res.status(400).json({ error: 'Verification token is not valid for this email address' });
  }

  await pool.query(
    'UPDATE users SET email_verified = true, email_verified_at = NOW() WHERE id = $1',
    [verificationRow.user_id]
  );
  await pool.query(
    'UPDATE email_verification_tokens SET used = true, used_at = NOW() WHERE id = $1',
    [verificationRow.id]
  );

  const ensuredScope = await ensureUserDefaultScope(verificationRow.user_id);
  const newSessionToken = await createSession(verificationRow.user_id, {
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || null
  });
  const meResult = await pool.query(
    'SELECT id, email, name, role, created_at, updated_at, email_verified, email_verified_at FROM users WHERE id = $1',
    [verificationRow.user_id]
  );
  const me = meResult.rows[0];

  res.cookie(SESSION_COOKIE_NAME, newSessionToken, SESSION_COOKIE_OPTIONS);
  issueCsrfToken(res);
  await logActivity(req, 'auth.email_verification.consume', 'user', verificationRow.user_id, {
    email: verificationRow.email
  });
  recordAuthEvent('email_verification_consume', 'succeeded');
  res.json({
    user: {
      ...stripHomelabSpaceContextFromUser(me, getProductEdition()),
      active_space_id: stripHomelabSpaceContext({ active_space_id: ensuredScope.spaceId }, getProductEdition()).active_space_id,
      active_library_id: ensuredScope.libraryId
    }
  });
}));

// ── Password reset request (email-first public flow) ────────────────────────
router.post('/password-reset/request', validate(passwordResetRequestSchema), asyncHandler(async (req, res) => {
  const { email } = req.body;
  const genericResponse = {
    message: 'If an account exists for that email, you will receive a password reset email shortly.'
  };

  const userResult = await pool.query(
    'SELECT id, email FROM users WHERE lower(email) = lower($1) LIMIT 1',
    [email]
  );
  const user = userResult.rows[0] || null;

  if (!user) {
    recordAuthEvent('password_reset_request', 'ignored');
    await logActivity(req, 'auth.password_reset.request.unknown', 'password_reset', null, {
      email
    });
    return res.json(genericResponse);
  }

  const issued = await issuePasswordResetToken({
    userId: user.id,
    createdBy: null
  });
  const resetUrl = `${getRequestOrigin(req)}/reset-password?token=${encodeURIComponent(issued.token)}&email=${encodeURIComponent(user.email)}`;

  await logActivity(req, 'auth.password_reset.request', 'user', user.id, {
    email: user.email,
    resetTokenId: issued.id,
    expiresAt: issued.expires_at
  });

  try {
    const delivery = await sendPasswordResetEmail({
      to: user.email,
      resetUrl,
      expiresAt: issued.expires_at
    });

    await logActivity(
      req,
      delivery.sent ? 'auth.password_reset.request.delivered' : 'auth.password_reset.request.delivery_skipped',
      'user',
      user.id,
      {
        email: user.email,
        resetTokenId: issued.id,
        delivery: delivery.sent ? 'smtp' : 'none',
        reason: delivery.reason || null
      }
    );
    recordAuthEvent('password_reset_request', delivery.sent ? 'succeeded' : 'delivery_skipped');
  } catch (error) {
    recordAuthEvent('password_reset_request', 'failed');
    await logActivity(req, 'auth.password_reset.request.delivery_failed', 'user', user.id, {
      email: user.email,
      resetTokenId: issued.id,
      reason: error.message || 'smtp_send_failed'
    });
  }

  res.json(genericResponse);
}));

// ── Logout ────────────────────────────────────────────────────────────────────

router.post('/logout', asyncHandler(async (req, res) => {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  const sessionUser = cookieToken ? await getSessionUserByToken(cookieToken) : null;
  if (cookieToken) {
    await revokeSessionByToken(cookieToken);
  }
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: SESSION_COOKIE_OPTIONS.httpOnly,
    sameSite: SESSION_COOKIE_OPTIONS.sameSite,
    secure: SESSION_COOKIE_OPTIONS.secure,
    path: SESSION_COOKIE_OPTIONS.path
  });
  clearCsrfToken(res);
  const auditReq = sessionUser
    ? {
        ...req,
        user: {
          id: sessionUser.id,
          email: sessionUser.email,
          role: sessionUser.role,
          scopeSpaceId: sessionUser.scope_space_id ?? sessionUser.active_space_id ?? null,
          activeSpaceId: sessionUser.scope_space_id ?? sessionUser.active_space_id ?? null,
          activeLibraryId: sessionUser.active_library_id ?? null
        },
        sessionId: sessionUser.session_id
      }
    : req;
  await logActivity(auditReq, 'auth.user.logout', 'user', sessionUser?.id || req.user?.id || null, null);
  res.json({ message: 'Logged out' });
}));

// ── Password reset consume (one-time token) ───────────────────────────────────
router.post('/password-reset/consume', validate(passwordResetConsumeSchema), asyncHandler(async (req, res) => {
  const { token, email, password } = req.body;
  const tokenHash = hashInviteToken(token);
  const resetLookup = await pool.query(
    `SELECT prt.id, prt.user_id, u.email
     FROM password_reset_tokens prt
     JOIN users u ON u.id = prt.user_id
     WHERE prt.token_hash = $1
       AND prt.used = false
       AND prt.revoked = false
       AND prt.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  if (resetLookup.rows.length === 0) {
    recordAuthEvent('password_reset_consume', 'failed');
    await logActivity(req, 'auth.password_reset.consume.failed', 'password_reset', null, {
      email,
      reason: 'invalid_or_expired_token'
    });
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }
  const resetRow = resetLookup.rows[0];
  if (String(resetRow.email).toLowerCase() !== String(email).toLowerCase()) {
    recordAuthEvent('password_reset_consume', 'failed');
    await logActivity(req, 'auth.password_reset.consume.failed', 'user', resetRow.user_id, {
      email,
      reason: 'email_mismatch'
    });
    return res.status(400).json({ error: 'Reset token is not valid for this email address' });
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  await pool.query(
    `UPDATE users
     SET password = $1,
         email_verified = true,
         email_verified_at = COALESCE(email_verified_at, NOW())
     WHERE id = $2`,
    [hashedPassword, resetRow.user_id]
  );
  await pool.query(
    'UPDATE password_reset_tokens SET used = true, used_at = NOW() WHERE id = $1',
    [resetRow.id]
  );

  const revokedCount = await revokeSessionsForUser(resetRow.user_id);
  const newSessionToken = await createSession(resetRow.user_id, {
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || null
  });
  const meResult = await pool.query(
    'SELECT id, email, name, role, created_at, updated_at, email_verified, email_verified_at FROM users WHERE id = $1',
    [resetRow.user_id]
  );
  const me = meResult.rows[0];

  res.cookie(SESSION_COOKIE_NAME, newSessionToken, SESSION_COOKIE_OPTIONS);
  issueCsrfToken(res);
  await logActivity(req, 'auth.password_reset.consume', 'user', resetRow.user_id, {
    email: resetRow.email,
    revokedSessionCount: revokedCount
  });
  recordAuthEvent('password_reset_consume', 'succeeded');
  res.json({ user: me });
}));

// ── Current user ──────────────────────────────────────────────────────────────

router.get('/me', authenticateToken, asyncHandler(async (req, res) => {
  await normalizeRequestAuthState(req);
  const result = await pool.query(
    'SELECT id, email, name, role, created_at, updated_at, email_verified, email_verified_at, active_space_id, active_library_id FROM users WHERE id = $1',
    [req.user.id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  const row = result.rows[0];
  res.json(stripHomelabSpaceContextFromUser({
    ...row,
    product_edition: getProductEdition(),
    edition_contract: buildEditionContract(getProductEdition()),
    active_space_id: req.user.scopeSpaceId ?? req.user.activeSpaceId ?? row.active_space_id ?? null,
    active_library_id: req.user.activeLibraryId ?? row.active_library_id ?? null
  }, getProductEdition()));
}));

router.get('/scope', authenticateToken, asyncHandler(async (req, res) => {
  const payload = await buildAuthScopePayload(req);
  res.json(payload);
}));

router.post('/scope', authenticateToken, requireSessionAuth, validate(authScopeSelectSchema), asyncHandler(async (req, res) => {
  if (String(req.user.role || '') === 'support_admin') {
    return res.status(403).json({ error: 'Support admins must use explicit support-session controls instead of generic scope selection' });
  }

  const productEdition = getProductEdition();
  const homelabEdition = isHomelabEdition(productEdition);
  const requestedSpaceId = Number(req.body.space_id || 0) || null;
  const requestedLibraryId = Number(req.body.library_id || 0) || null;

  if (homelabEdition && requestedSpaceId) {
    return res.status(403).json({ error: 'Homelab does not expose generic space selection' });
  }

  let nextSpaceId = requestedSpaceId;
  let nextLibraryId = requestedLibraryId;

  if (requestedLibraryId) {
    const selectedLibrary = await getAccessibleLibrary({
      userId: req.user.id,
      role: req.user.role,
      libraryId: requestedLibraryId
    });
    if (!selectedLibrary) {
      return res.status(403).json({ error: 'Library access denied' });
    }
    nextLibraryId = selectedLibrary.id;
    nextSpaceId = selectedLibrary.space_id || nextSpaceId || null;
  }

  if (nextSpaceId) {
    const selectedSpace = await pool.connect();
    try {
      const accessibleSpace = await getAccessibleSpaceForUser(selectedSpace, {
        userId: req.user.id,
        role: req.user.role,
        spaceId: nextSpaceId
      });
      if (!accessibleSpace) {
        return res.status(403).json({ error: 'Space access denied' });
      }
    } finally {
      selectedSpace.release();
    }
  }

  if (!nextSpaceId && nextLibraryId) {
    const selectedLibrary = await getAccessibleLibrary({
      userId: req.user.id,
      role: req.user.role,
      libraryId: nextLibraryId
    });
    nextSpaceId = selectedLibrary?.space_id || null;
  }

  if (nextSpaceId && !nextLibraryId) {
    const libraries = await listLibrariesForSpace({
      userId: req.user.id,
      role: req.user.role,
      spaceId: nextSpaceId
    });
    const currentLibraryInSpace = libraries.find((library) => Number(library.id) === Number(req.user.activeLibraryId || 0));
    nextLibraryId = currentLibraryInSpace?.id || libraries[0]?.id || null;
  }

  await pool.query(
    `UPDATE users
     SET active_space_id = $2,
         active_library_id = $3
     WHERE id = $1`,
    [req.user.id, resolvePersistedActiveSpaceId(nextSpaceId, productEdition), nextLibraryId]
  );

  req.user.activeSpaceId = nextSpaceId;
  req.user.scopeSpaceId = nextSpaceId;
  req.user.activeLibraryId = nextLibraryId;

  await logActivity(req, 'auth.scope.select', 'user', req.user.id, {
    activeSpaceId: nextSpaceId,
    activeLibraryId: nextLibraryId
  });

  const payload = await buildAuthScopePayload(req);
  res.json(payload);
}));

platformRouter.post('/support-session/start', authenticateToken, requireSessionAuth, requireRole('admin', 'support_admin'), validate(supportSessionStartSchema), asyncHandler(async (req, res) => {
  const targetSpaceId = Number(req.body.space_id || 0);
  const requestedLibraryId = Number(req.body.library_id || 0) || null;
  const requestId = Number(req.body.request_id || 0) || null;
  const reason = String(req.body.reason || '').trim() || null;
  const isSupportAdmin = req.user.role === 'support_admin';

  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');

    const sessionResult = await client.query(
      `SELECT id, support_space_id, support_library_id, support_request_id, support_started_at, support_reason,
              support_previous_space_id, support_previous_library_id
       FROM user_sessions
       WHERE id = $1
       FOR UPDATE`,
      [req.sessionId]
    );
    if (sessionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Session not found' });
    }

    let approvedSupportRequest = null;
    if (isSupportAdmin) {
      if (!requestId) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'support_admin sessions must be linked to an approved support request' });
      }

      const requestResult = await client.query(
        `SELECT sr.id, sr.requester_user_id, sr.subject, sr.status, sr.support_access_status, sr.support_access_approved_at, sr.target_space_id, sr.target_library_id,
                requester.name AS requester_name,
                requester.email AS requester_email
           FROM support_requests sr
           JOIN users requester ON requester.id = sr.requester_user_id
          WHERE sr.id = $1
          LIMIT 1`,
        [requestId]
      );
      approvedSupportRequest = requestResult.rows[0] || null;
      if (!approvedSupportRequest) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Approved support request not found' });
      }
      if (!isSupportAccessApprovalActive({
        status: approvedSupportRequest.support_access_status,
        approvedAt: approvedSupportRequest.support_access_approved_at,
        requestStatus: approvedSupportRequest.status
      })) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Support request approval is missing, expired, or no longer valid for tenant support access' });
      }
      if (Number(approvedSupportRequest.target_space_id || 0) !== targetSpaceId) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Approved support request does not match the selected target space' });
      }
    }

    const targetSpace = await getSupportSpaceSummary(client, targetSpaceId);
    if (!targetSpace) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Space not found' });
    }

    const libraries = await listSupportLibrariesForSpace(client, targetSpaceId);
    let targetLibraryId = requestedLibraryId;
    if (targetLibraryId) {
      const matchesTarget = libraries.some((library) => Number(library.id) === targetLibraryId);
      if (!matchesTarget) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Selected library is not part of the target space' });
      }
    } else {
      targetLibraryId = libraries[0]?.id || null;
    }
    if (approvedSupportRequest?.target_library_id && targetLibraryId && Number(approvedSupportRequest.target_library_id) !== Number(targetLibraryId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Approved support request does not match the selected target library' });
    }

    const currentSession = sessionResult.rows[0];
    const {
      previousSpaceId,
      previousLibraryId
    } = await resolveSupportPreviousScope(client, req, currentSession);

    await client.query(
      `UPDATE user_sessions
       SET support_space_id = $2,
           support_library_id = $3,
           support_request_id = $4,
           support_started_at = NOW(),
           support_reason = $5,
           support_previous_space_id = $6,
           support_previous_library_id = $7
       WHERE id = $1`,
      [req.sessionId, targetSpaceId, targetLibraryId, approvedSupportRequest?.id || null, reason, previousSpaceId, previousLibraryId]
    );

    await client.query('COMMIT');
    committed = true;

    req.user.supportSpaceId = targetSpaceId;
    req.user.supportLibraryId = targetLibraryId;
    req.user.supportRequestId = approvedSupportRequest?.id || null;
    req.user.supportStartedAt = new Date().toISOString();
    req.user.supportReason = reason;
    req.user.supportPreviousSpaceId = previousSpaceId;
    req.user.supportPreviousLibraryId = previousLibraryId;
    req.user.scopeSpaceId = targetSpaceId;
    req.user.activeSpaceId = targetSpaceId;
    req.user.activeLibraryId = targetLibraryId;

    await logActivity(req, 'auth.support_session.started', 'space', targetSpaceId, {
      reason,
      supportRequestId: approvedSupportRequest?.id || null,
      supportRequestKey: formatSupportRequestKey(approvedSupportRequest?.id || null),
      requesterUserId: approvedSupportRequest?.requester_user_id || null,
      requesterEmail: approvedSupportRequest?.requester_email || null,
      supportSpaceId: targetSpaceId,
      supportLibraryId: targetLibraryId,
      previousSpaceId,
      previousLibraryId
    });

    const payload = await buildAuthScopePayload(req);
    res.json(payload);
  } catch (error) {
    if (!committed) {
      await client.query('ROLLBACK');
    }
    throw error;
  } finally {
    client.release();
  }
}));

platformRouter.delete('/support-session', authenticateToken, requireSessionAuth, requireRole('admin', 'support_admin'), asyncHandler(async (req, res) => {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');

    const sessionResult = await client.query(
      `SELECT support_space_id, support_library_id, support_request_id, support_started_at, support_reason,
              support_previous_space_id, support_previous_library_id
       FROM user_sessions
       WHERE id = $1
       FOR UPDATE`,
      [req.sessionId]
    );
    if (sessionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Session not found' });
    }

    const currentSession = sessionResult.rows[0];
    const {
      previousSpaceId,
      previousLibraryId
    } = await resolveSupportPreviousScope(client, req, currentSession);

    await client.query(
      `UPDATE user_sessions
       SET support_space_id = NULL,
           support_library_id = NULL,
           support_request_id = NULL,
           support_started_at = NULL,
           support_reason = NULL,
           support_previous_space_id = NULL,
           support_previous_library_id = NULL
       WHERE id = $1`,
      [req.sessionId]
    );

    await client.query('COMMIT');
    committed = true;

    await logActivity(req, 'auth.support_session.ended', 'space', currentSession.support_space_id || null, {
      reason: currentSession.support_reason || null,
      supportRequestId: currentSession.support_request_id || null,
      supportRequestKey: formatSupportRequestKey(currentSession.support_request_id || null),
      supportSpaceId: currentSession.support_space_id || null,
      supportLibraryId: currentSession.support_library_id || null,
      startedAt: currentSession.support_started_at || null,
      previousSpaceId,
      previousLibraryId
    });

    req.user.supportSpaceId = null;
    req.user.supportLibraryId = null;
    req.user.supportRequestId = null;
    req.user.supportStartedAt = null;
    req.user.supportReason = null;
    req.user.supportPreviousSpaceId = null;
    req.user.supportPreviousLibraryId = null;
    req.user.scopeSpaceId = previousSpaceId;
    req.user.activeSpaceId = previousSpaceId;
    req.user.activeLibraryId = previousLibraryId;

    const payload = await buildAuthScopePayload(req);
    res.json(payload);
  } catch (error) {
    if (!committed) {
      await client.query('ROLLBACK');
    }
    throw error;
  } finally {
    client.release();
  }
}));

// ── Profile ───────────────────────────────────────────────────────────────────

router.get('/profile', authenticateToken, asyncHandler(async (req, res) => {
  await normalizeRequestAuthState(req);
  const result = await pool.query(
    'SELECT id, email, name, role, created_at, updated_at, active_space_id, active_library_id FROM users WHERE id = $1',
    [req.user.id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  const row = result.rows[0];
  res.json(stripHomelabSpaceContextFromUser({
    ...row,
    product_edition: getProductEdition(),
    edition_contract: buildEditionContract(getProductEdition()),
    active_space_id: req.user.scopeSpaceId ?? req.user.activeSpaceId ?? row.active_space_id ?? null,
    active_library_id: req.user.activeLibraryId ?? row.active_library_id ?? null
  }, getProductEdition()));
}));

router.patch('/profile', authenticateToken, validate(profileUpdateSchema), asyncHandler(async (req, res) => {
  const { name, email, password, current_password: currentPassword } = req.body;
  const previous = await pool.query(
    'SELECT id, email, name, password FROM users WHERE id = $1',
    [req.user.id]
  );
  if (previous.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const updates = [];
  const values = [];

  if (name) {
    values.push(name);
    updates.push(`name = $${values.length}`);
  }

  if (email) {
    const emailCheck = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND id <> $2',
      [email, req.user.id]
    );
    if (emailCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Email is already in use by another account' });
    }
    values.push(email);
    updates.push(`email = $${values.length}`);
  }

  if (password) {
    const currentValid = await bcrypt.compare(currentPassword, previous.rows[0].password);
    if (!currentValid) {
      await logActivity(req, 'auth.profile.password_change.failed', 'user', req.user.id, {
        reason: 'current_password_incorrect'
      });
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const hashed = await bcrypt.hash(password, 12);
    values.push(hashed);
    updates.push(`password = $${values.length}`);
  }

  if (updates.length === 0) {
    return res.json({
      id: previous.rows[0].id,
      email: previous.rows[0].email,
      name: previous.rows[0].name,
      role: req.user.role
    });
  }

  values.push(req.user.id);
  const result = await pool.query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length}
     RETURNING id, email, name, role, created_at, updated_at`,
    values
  );

  let revokedSessionCount = 0;
  if (password) {
    revokedSessionCount = await revokeSessionsForUser(req.user.id, {
      keepSessionId: req.sessionId || null
    });
  }

  await logActivity(req, 'auth.profile.update', 'user', req.user.id, {
    previousName: previous.rows[0].name,
    previousEmail: previous.rows[0].email,
    nextName: result.rows[0].name,
    nextEmail: result.rows[0].email,
    passwordChanged: Boolean(password),
    revokedSessionCount
  });

  res.json(result.rows[0]);
}));

// ── Personal Access Tokens ───────────────────────────────────────────────────

router.get('/personal-access-tokens', authenticateToken, requireSessionAuth, asyncHandler(async (req, res) => {
  const tokens = await listPersonalAccessTokensForUser(req.user.id);
  res.json({
    scopes: PERSONAL_ACCESS_TOKEN_SCOPES,
    tokens
  });
}));

router.post('/personal-access-tokens', authenticateToken, requireSessionAuth, validate(personalAccessTokenCreateSchema), asyncHandler(async (req, res) => {
  const expiresAt = req.body.expires_at ? new Date(req.body.expires_at) : null;
  const created = await createPersonalAccessToken({
    userId: req.user.id,
    name: req.body.name.trim(),
    scopes: req.body.scopes,
    expiresAt
  });
  await logActivity(req, 'auth.pat.create', 'personal_access_token', created.record.id, {
    name: created.record.name,
    scopes: created.record.scopes,
    expiresAt: created.record.expires_at
  });
  res.status(201).json({
    token: created.token,
    record: created.record
  });
}));

router.delete('/personal-access-tokens/:id', authenticateToken, requireSessionAuth, asyncHandler(async (req, res) => {
  const tokenId = Number(req.params.id);
  if (!Number.isFinite(tokenId) || tokenId <= 0) {
    return res.status(400).json({ error: 'Invalid token id' });
  }
  const revoked = await revokePersonalAccessToken({ userId: req.user.id, tokenId });
  if (!revoked) {
    return res.status(404).json({ error: 'Personal access token not found' });
  }
  await logActivity(req, 'auth.pat.revoke', 'personal_access_token', revoked.id, {
    name: revoked.name,
    revokedAt: revoked.revoked_at
  });
  res.json(revoked);
}));

// ── Service Account Keys (admin-only) ────────────────────────────────────────

platformRouter.get('/service-account-keys', authenticateToken, requireSessionAuth, requireRole('admin'), asyncHandler(async (_req, res) => {
  const keys = await listServiceAccountKeys();
  res.json({
    scopes: SERVICE_ACCOUNT_KEY_SCOPES,
    allowed_prefixes: SERVICE_ACCOUNT_ALLOWED_PREFIXES,
    keys
  });
}));

platformRouter.post('/service-account-keys', authenticateToken, requireSessionAuth, requireRole('admin'), validate(serviceAccountKeyCreateSchema), asyncHandler(async (req, res) => {
  const expiresAt = req.body.expires_at ? new Date(req.body.expires_at) : null;
  const created = await createServiceAccountKey({
    ownerUserId: req.user.id,
    createdByUserId: req.user.id,
    name: req.body.name.trim(),
    scopes: req.body.scopes,
    allowedPrefixes: req.body.allowed_prefixes,
    expiresAt
  });
  await logActivity(req, 'auth.service_account.create', 'service_account_key', created.record.id, {
    name: created.record.name,
    scopes: created.record.scopes,
    allowedPrefixes: created.record.allowed_prefixes,
    expiresAt: created.record.expires_at
  });
  res.status(201).json({
    key: created.key,
    record: created.record
  });
}));

platformRouter.delete('/service-account-keys/:id', authenticateToken, requireSessionAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const keyId = Number(req.params.id);
  if (!Number.isFinite(keyId) || keyId <= 0) {
    return res.status(400).json({ error: 'Invalid service account key id' });
  }
  const revoked = await revokeServiceAccountKey({ keyId });
  if (!revoked) {
    return res.status(404).json({ error: 'Service account key not found' });
  }
  await logActivity(req, 'auth.service_account.revoke', 'service_account_key', revoked.id, {
    name: revoked.name,
    revokedAt: revoked.revoked_at
  });
  res.json(revoked);
}));

module.exports = {
  authRouter: router,
  authPlatformRouter: platformRouter
};
