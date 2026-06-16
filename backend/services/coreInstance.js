'use strict';

const appMeta = require('../app-meta.json');
const { getPublicRuntimeMode, buildRuntimeContract } = require('../config/productEdition');

function normalizeIdentifier(value, fallback = null) {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function buildCoreInstanceContract({ origin = null, now = new Date() } = {}) {
  const appVersion = process.env.APP_VERSION || appMeta.backend || appMeta.version || 'unknown';
  const frontendVersion = appMeta.frontend || appMeta.version || appVersion;
  const backendVersion = appMeta.backend || appMeta.version || appVersion;
  const publicBaseUrl = normalizeIdentifier(process.env.CORE_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || origin);
  const loginPath = '/login';

  return {
    status: 'ok',
    service: 'collectz-core',
    instance: {
      id: normalizeIdentifier(process.env.CORE_INSTANCE_ID),
      slug: normalizeIdentifier(process.env.CORE_INSTANCE_SLUG, 'default'),
      name: normalizeIdentifier(process.env.CORE_INSTANCE_NAME, 'collectZ Core'),
      public_base_url: publicBaseUrl,
      login_path: loginPath,
      login_url: publicBaseUrl ? `${publicBaseUrl}${loginPath}` : null
    },
    version: appVersion,
    frontend: frontendVersion,
    backend: backendVersion,
    build: `v${appVersion}`,
    runtime_mode: getPublicRuntimeMode(),
    runtime_contract: buildRuntimeContract(),
    auth_authority: 'core',
    capabilities: {
      local_accounts: true,
      workspace_memberships: true,
      support_session_bridge: true,
      platform_control_plane: false
    },
    generated_at: now.toISOString()
  };
}

module.exports = {
  buildCoreInstanceContract
};
