'use strict';

const FIELD_TYPES = Object.freeze({
  method: 'method',
  path: 'path',
  reason: 'code',
  role: 'code',
  userRole: 'code',
  authType: 'code',
  productEdition: 'code',
  invitedSpaceRole: 'code',
  delivery: 'code',
  exposureMode: 'code',
  supportRequestKey: 'code',
  platform: 'code',
  appVersion: 'code',
  inviteTokenUsed: 'boolean',
  passwordChanged: 'boolean',
  refreshTokenIncluded: 'boolean',
  isPersonal: 'boolean',
  requiredScopes: 'codeArray',
  requiredRoles: 'codeArray',
  scopes: 'codeArray',
  changedFields: 'codeArray',
  activeSpaceId: 'integer',
  activeLibraryId: 'integer',
  supportRequestId: 'integer',
  requesterUserId: 'integer',
  supportSpaceId: 'integer',
  supportLibraryId: 'integer',
  previousSpaceId: 'integer',
  previousLibraryId: 'integer',
  spaceId: 'integer',
  libraryId: 'integer',
  librarySpaceId: 'integer',
  requestedSpaceId: 'integer',
  requestedLibraryId: 'integer',
  membershipId: 'integer',
  targetUserId: 'integer',
  previousOwnerUserId: 'integer',
  nextOwnerUserId: 'integer',
  ownerUserId: 'integer',
  sourceSpaceId: 'integer',
  targetSpaceId: 'integer',
  userId: 'integer',
  revokedSessionCount: 'integer',
  revokedCount: 'integer',
  maxAgeMinutes: 'integer',
  expiresAt: 'timestamp',
  verificationExpiresAt: 'timestamp',
  revokedAt: 'timestamp',
  startedAt: 'timestamp'
});

const schema = (...fields) => Object.freeze(Object.fromEntries(
  fields.map((field) => [field, FIELD_TYPES[field]])
));

const AUTH_AUDIT_DETAIL_SCHEMAS = Object.freeze({
  'auth.access.denied': schema('reason', 'method', 'path'),
  'auth.mobile.denied': schema('reason', 'method', 'path', 'requiredScopes'),
  'auth.pat.denied': schema('reason', 'method', 'path', 'requiredScopes'),
  'auth.permission.denied': schema('reason', 'method', 'path', 'requiredRoles', 'userRole', 'authType'),
  'auth.service_account.denied': schema('reason', 'method', 'path', 'requiredScopes'),
  'auth.email_verification.consume': schema(),
  'auth.email_verification.consume.failed': schema('reason'),
  'auth.email_verification.request': schema('expiresAt'),
  'auth.email_verification.request.delivered': schema('delivery'),
  'auth.email_verification.request.delivery_failed': schema('reason'),
  'auth.email_verification.request.delivery_skipped': schema('delivery', 'reason'),
  'auth.email_verification.request.ignored': schema('reason'),
  'auth.mobile.login': schema('scopes', 'activeSpaceId', 'activeLibraryId', 'platform', 'appVersion'),
  'auth.mobile.login.denied': schema('reason'),
  'auth.mobile.login.failed': schema('reason'),
  'auth.mobile.logout': schema('revokedCount', 'refreshTokenIncluded'),
  'auth.mobile.refresh': schema('scopes', 'activeSpaceId', 'activeLibraryId'),
  'auth.mobile.refresh.denied': schema('reason'),
  'auth.password_reset.consume': schema('revokedSessionCount'),
  'auth.password_reset.consume.failed': schema('reason'),
  'auth.password_reset.request': schema('expiresAt'),
  'auth.password_reset.request.delivered': schema('delivery'),
  'auth.password_reset.request.delivery_failed': schema('reason'),
  'auth.password_reset.request.delivery_skipped': schema('delivery', 'reason'),
  'auth.password_reset.request.unknown': schema('reason'),
  'auth.pat.create': schema('scopes', 'expiresAt'),
  'auth.pat.revoke': schema('revokedAt'),
  'auth.profile.password_change.failed': schema('reason'),
  'auth.profile.update': schema('changedFields', 'passwordChanged', 'revokedSessionCount'),
  'auth.reauthentication.failed': schema('reason'),
  'auth.reauthentication.required': schema('reason', 'method', 'path'),
  'auth.reauthentication.succeeded': schema('maxAgeMinutes'),
  'auth.scope.select': schema('activeSpaceId', 'activeLibraryId'),
  'auth.service_account.create': schema('scopes', 'expiresAt'),
  'auth.service_account.revoke': schema('revokedAt'),
  'auth.support_session.ended': schema(
    'supportRequestId',
    'supportRequestKey',
    'supportSpaceId',
    'supportLibraryId',
    'startedAt',
    'previousSpaceId',
    'previousLibraryId'
  ),
  'auth.support_session.library.select': schema('supportSpaceId'),
  'auth.support_session.started': schema(
    'supportRequestId',
    'supportRequestKey',
    'requesterUserId',
    'supportSpaceId',
    'supportLibraryId',
    'previousSpaceId',
    'previousLibraryId'
  ),
  'auth.user.login': schema(),
  'auth.user.logout': schema(),
  'auth.user.register': schema('role', 'inviteTokenUsed', 'productEdition', 'invitedSpaceRole', 'activeLibraryId'),
  'auth.user.register.pending_verification': schema(
    'role',
    'inviteTokenUsed',
    'productEdition',
    'verificationExpiresAt'
  ),
  'invite.claimed': schema('spaceId', 'role'),
  'scope.access.denied': schema(
    'reason',
    'requestedSpaceId',
    'requestedLibraryId',
    'role',
    'libraryId',
    'librarySpaceId',
    'spaceId'
  ),
  'security.csrf.failed': schema('method', 'path', 'reason'),
  'space.create': schema('ownerUserId'),
  'space.invite.create': schema('role', 'spaceId', 'expiresAt'),
  'space.invite.delivered': schema('role', 'spaceId', 'delivery'),
  'space.invite.delivery_failed': schema('role', 'spaceId', 'reason'),
  'space.invite.revoke': schema('role', 'spaceId'),
  'space.invite.token_exposed': schema('role', 'spaceId', 'exposureMode'),
  'space.member.add': schema('targetUserId', 'role', 'spaceId'),
  'space.member.update': schema('targetUserId', 'role', 'spaceId'),
  'space.member.suspend': schema('targetUserId', 'role', 'spaceId'),
  'space.member.restore': schema('targetUserId', 'role', 'spaceId'),
  'space.member.remove': schema('targetUserId', 'role', 'spaceId'),
  'space.member.transfer_new_space': schema('targetUserId', 'sourceSpaceId', 'targetSpaceId'),
  'space.member.password_reset.create': schema('spaceId', 'membershipId', 'role', 'expiresAt'),
  'space.member.password_reset.delivered': schema('spaceId', 'membershipId', 'role', 'delivery'),
  'space.member.password_reset.delivery_failed': schema('spaceId', 'membershipId', 'role', 'reason'),
  'space.member.password_reset.token_exposed': schema('spaceId', 'membershipId', 'role', 'exposureMode'),
  'workspace.create.personal': schema('userId', 'isPersonal'),
  'library.transfer': schema('previousOwnerUserId', 'nextOwnerUserId')
});

const SENSITIVE_ACTION_PATTERNS = Object.freeze([
  /^auth\./,
  /^space\.invite\./,
  /^space\.member\./,
  /^library\.transfer$/,
  /^invite\.claimed$/,
  /^scope\.access\.denied$/,
  /^security\.csrf\.failed$/,
  /^space\.create$/,
  /^workspace\.create\.personal$/
]);

const normalizeCode = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  return /^[A-Za-z0-9_.:-]{1,100}$/.test(normalized) ? normalized : null;
};

const normalizeMethod = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  return /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(normalized) ? normalized : null;
};

const normalizePath = (value) => {
  const normalized = String(value || '').split('?')[0].trim();
  if (!normalized.startsWith('/api/') || normalized.length > 300 || /[\r\n]/.test(normalized)) return null;
  return normalized;
};

const normalizeInteger = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : null;
};

const normalizeTimestamp = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const timestamp = value instanceof Date ? value : new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
};

const normalizeCodeArray = (value) => {
  if (!Array.isArray(value)) return null;
  const normalized = value.slice(0, 50).map(normalizeCode).filter(Boolean);
  return normalized.length > 0 ? normalized : [];
};

const normalizeFieldValue = (type, value) => {
  switch (type) {
    case 'boolean': return typeof value === 'boolean' ? value : null;
    case 'code': return normalizeCode(value);
    case 'codeArray': return normalizeCodeArray(value);
    case 'integer': return normalizeInteger(value);
    case 'method': return normalizeMethod(value);
    case 'path': return normalizePath(value);
    case 'timestamp': return normalizeTimestamp(value);
    default: return null;
  }
};

const isSensitiveAuditAction = (action) => SENSITIVE_ACTION_PATTERNS.some((pattern) => pattern.test(String(action || '')));

const applyAuthAuditDetailPolicy = (action, details) => {
  if (!isSensitiveAuditAction(action)) {
    return { details, rejectedFieldCount: 0, cataloged: false };
  }

  const contract = AUTH_AUDIT_DETAIL_SCHEMAS[action];
  if (!contract) {
    return {
      details: null,
      rejectedFieldCount: details && typeof details === 'object' ? Object.keys(details).length : 0,
      cataloged: false
    };
  }

  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return { details: null, rejectedFieldCount: details === null || details === undefined ? 0 : 1, cataloged: true };
  }

  const allowed = {};
  let rejectedFieldCount = 0;
  for (const [key, value] of Object.entries(details)) {
    const type = contract[key];
    if (!type) {
      rejectedFieldCount += 1;
      continue;
    }
    const normalized = normalizeFieldValue(type, value);
    if (normalized === null) {
      if (value !== null && value !== undefined && value !== '') rejectedFieldCount += 1;
      continue;
    }
    allowed[key] = normalized;
  }

  return {
    details: Object.keys(allowed).length > 0 ? allowed : null,
    rejectedFieldCount,
    cataloged: true
  };
};

module.exports = {
  AUTH_AUDIT_DETAIL_SCHEMAS,
  applyAuthAuditDetailPolicy,
  isSensitiveAuditAction
};
