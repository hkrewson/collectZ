'use strict';

const PRODUCT_EDITIONS = new Set(['platform', 'homelab']);

function normalizeProductEdition(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return PRODUCT_EDITIONS.has(normalized) ? normalized : 'platform';
}

function getProductEdition() {
  return normalizeProductEdition(process.env.APP_EDITION);
}

function isHomelabEdition(value = null) {
  return normalizeProductEdition(value || getProductEdition()) === 'homelab';
}

function buildEditionContract(edition = null) {
  const normalizedEdition = normalizeProductEdition(edition || getProductEdition());
  if (normalizedEdition === 'homelab') {
    return {
      shell: 'homelab',
      library_model: 'single_library_household',
      additional_user_model: 'local_accounts',
      workspace_surface: false,
      help_surface: 'guidance_and_releases'
    };
  }
  return {
    shell: 'platform',
    library_model: 'multi_workspace_platform',
    additional_user_model: 'workspace_memberships',
    workspace_surface: true,
    help_surface: 'full'
  };
}

function stripHomelabSpaceContext(payload, edition = null) {
  if (!isHomelabEdition(edition)) return payload;
  if (!payload || typeof payload !== 'object') return payload;
  return {
    ...payload,
    active_space_id: null,
    spaces: []
  };
}

function stripHomelabSpaceContextFromUser(user, edition = null) {
  if (!isHomelabEdition(edition)) return user;
  if (!user || typeof user !== 'object') return user;
  return {
    ...user,
    active_space_id: null
  };
}

module.exports = {
  PRODUCT_EDITIONS,
  normalizeProductEdition,
  getProductEdition,
  isHomelabEdition,
  buildEditionContract,
  stripHomelabSpaceContext,
  stripHomelabSpaceContextFromUser
};
