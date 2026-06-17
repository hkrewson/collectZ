'use strict';

const fs = require('fs');
const path = require('path');

const specPath = path.resolve(__dirname, '..', 'openapi', 'openapi.yaml');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateResponseObject(operation, code, response) {
  assert(response && typeof response === 'object', `${operation} response ${code} must be an object`);
  assert(typeof response.description === 'string' && response.description.trim(), `${operation} response ${code} requires a description`);
}

function main() {
  const raw = fs.readFileSync(specPath, 'utf8');
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (error) {
    throw new Error(`OpenAPI spec must be valid JSON-compatible YAML: ${error.message}`);
  }

  assert(spec && typeof spec === 'object', 'OpenAPI spec must be an object');
  assert(/^3\./.test(String(spec.openapi || '')), 'OpenAPI version must start with 3.');
  assert(spec.info && typeof spec.info === 'object', 'OpenAPI info block is required');
  assert(spec.info.title === 'collectZ API', 'OpenAPI info.title must be "collectZ API"');
  assert(typeof spec.info.version === 'string' && spec.info.version.trim(), 'OpenAPI info.version is required');
  assert(spec.paths && typeof spec.paths === 'object', 'OpenAPI paths block is required');
  assert(spec.components && typeof spec.components === 'object', 'OpenAPI components block is required');
  assert(spec.components.schemas && typeof spec.components.schemas === 'object', 'OpenAPI components.schemas block is required');
  assert(spec.components.securitySchemes && typeof spec.components.securitySchemes === 'object', 'OpenAPI components.securitySchemes block is required');

  const requiredPaths = {
    '/api/health': ['get'],
    '/api/core/instance': ['get'],
    '/api/auth/login': ['post'],
    '/api/auth/me': ['get'],
    '/api/auth/scope': ['get', 'post'],
    '/api/auth/support-session/start': ['post'],
    '/api/auth/support-session': ['delete'],
    '/api/support/releases': ['get'],
    '/api/spaces': ['get', 'post'],
    '/api/spaces/select': ['post'],
    '/api/spaces/{id}': ['patch'],
    '/api/spaces/{id}/members': ['get', 'post'],
    '/api/spaces/{id}/members/{memberId}': ['patch', 'delete'],
    '/api/spaces/{id}/invites': ['get', 'post'],
    '/api/spaces/{id}/invites/{inviteId}/revoke': ['patch'],
    '/api/spaces/{id}/members/{memberId}/transfer-new-space': ['post'],
    '/api/auth/personal-access-tokens': ['get', 'post'],
    '/api/auth/personal-access-tokens/{id}': ['delete'],
    '/api/auth/service-account-keys': ['get', 'post'],
    '/api/auth/service-account-keys/{id}': ['delete'],
    '/api/media': ['get'],
    '/api/media/lookup/barcode': ['post'],
    '/api/media/import-barcode': ['post'],
    '/api/media/import-plex': ['post'],
    '/api/media/sync-jobs': ['get'],
    '/api/media/sync-jobs/{id}': ['get'],
    '/api/media/sync-jobs/{id}/result': ['get']
  };

  for (const [routePath, methods] of Object.entries(requiredPaths)) {
    const pathItem = spec.paths[routePath];
    assert(pathItem && typeof pathItem === 'object', `Missing required path: ${routePath}`);
    for (const method of methods) {
      const operation = pathItem[method];
      assert(operation && typeof operation === 'object', `Missing required operation: ${method.toUpperCase()} ${routePath}`);
      assert(typeof operation.summary === 'string' && operation.summary.trim(), `Missing summary for ${method.toUpperCase()} ${routePath}`);
      assert(operation.responses && typeof operation.responses === 'object', `Missing responses for ${method.toUpperCase()} ${routePath}`);
      for (const [code, response] of Object.entries(operation.responses)) {
        validateResponseObject(`${method.toUpperCase()} ${routePath}`, code, response);
      }
    }
  }

  const forbiddenPaths = [
    '/api/support/requests',
    '/api/support/requests/{id}',
    '/api/support/requests/{id}/messages',
    '/api/support/requests/{id}/status',
    '/api/support/requests/{id}/access',
    '/api/support/requests/{id}/triage',
    '/api/support/staff/summary',
    '/api/admin/spaces',
    '/api/admin/spaces/{id}',
    '/api/admin/spaces/{id}/members',
    '/api/admin/spaces/{id}/invites',
    '/api/admin/spaces/{id}/invites/{inviteId}/revoke',
    '/api/admin/spaces/create-with-onboarding',
    '/api/admin/spaces/{id}/owner',
    '/api/admin/spaces/{id}/archive',
    '/api/admin/users',
    '/api/admin/users/{id}',
    '/api/admin/users/{id}/summary',
    '/api/admin/users/{id}/role',
    '/api/admin/users/{id}/password-reset',
    '/api/admin/users/{id}/password-reset/invalidate',
    '/api/admin/settings/email-delivery',
    '/api/admin/settings/email-delivery/test',
    '/api/admin/settings/integrations/test-pricecharting',
    '/api/admin/settings/integrations/test-ebay',
    '/api/admin/settings/integrations/test-logs',
    '/api/admin/activity',
    '/api/admin/loan-reminder-operations'
  ];
  for (const routePath of forbiddenPaths) {
    assert(!spec.paths[routePath], `Core OpenAPI must not document cairn-owned path: ${routePath}`);
  }

  const requiredSchemas = [
    'Error',
    'Health',
    'CoreInstanceContract',
    'User',
    'SpaceSummary',
    'LibrarySummary',
    'AuthScopeResponse',
    'AuthScopeSelectRequest',
    'SupportSessionRecord',
    'SupportSessionStartRequest',
    'SupportReleaseEntry',
    'SupportReleaseFeedResponse',
    'SpaceRecord',
    'SpaceListResponse',
    'SpaceMembershipRecord',
    'SpaceMembershipListResponse',
    'SpaceCreateRequest',
    'SpaceUpdateRequest',
    'SpaceMembershipCreateRequest',
    'SpaceMembershipUpdateRequest',
    'SpaceInviteRecord',
    'SpaceInviteListResponse',
    'SpaceInviteCreateRequest',
    'SpaceTransferCreateRequest',
    'SpaceTransferResponse',
    'LoginRequest',
    'LoginResponse',
    'NamedTokenRecord',
    'PersonalAccessTokenRecord',
    'ServiceAccountKeyRecord',
    'PersonalAccessTokenCreateRequest',
    'ServiceAccountKeyCreateRequest',
    'PersonalAccessTokenListResponse',
    'PersonalAccessTokenCreateResponse',
    'ServiceAccountKeyListResponse',
    'ServiceAccountKeyCreateResponse',
    'MediaListResponse',
    'BarcodeLookupRequest',
    'BarcodeLookupMatch',
    'BarcodeLookupResponse',
    'BarcodeImportRequest',
    'BarcodeImportResponse',
    'SyncJobResponse',
    'QueuedJobResponse'
  ];
  for (const schemaName of requiredSchemas) {
    assert(spec.components.schemas[schemaName], `Missing required schema: ${schemaName}`);
  }

  const forbiddenSchemas = [
    'SupportRequestRecord',
    'SupportRequestMessageRecord',
    'SupportRequestListResponse',
    'SupportRequestDetailResponse',
    'SupportRequestCreateRequest',
    'SupportRequestMessageCreateRequest',
    'SupportRequestStatusUpdateRequest',
    'SupportRequestAccessUpdateRequest',
    'SupportRequestTriageUpdateRequest',
    'SupportRequestMutationResponse',
    'SupportStaffSummaryResponse',
    'AdminSpaceRecord',
    'AdminSpaceListResponse',
    'AdminSpaceDetailResponse',
    'AdminSpaceOwnerAssignRequest',
    'AdminSpaceArchiveRequest',
    'AdminSpaceInitialInviteRequest',
    'AdminSpaceCreateWithOnboardingRequest',
    'AdminSpaceOnboardingInviteResult',
    'AdminSpaceCreateWithOnboardingResponse'
  ];
  for (const schemaName of forbiddenSchemas) {
    assert(!spec.components.schemas[schemaName], `Core OpenAPI must not document cairn-owned schema: ${schemaName}`);
  }

  const requiredSecuritySchemes = ['cookieSession', 'bearerAuth', 'csrfHeader'];
  for (const securityName of requiredSecuritySchemes) {
    assert(spec.components.securitySchemes[securityName], `Missing required security scheme: ${securityName}`);
  }

  console.log(`OpenAPI validation passed: ${specPath}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
