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
  stripHomelabSpaceContext,
  stripHomelabSpaceContextFromUser
};
