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

module.exports = {
  PRODUCT_EDITIONS,
  normalizeProductEdition,
  getProductEdition,
  isHomelabEdition
};
