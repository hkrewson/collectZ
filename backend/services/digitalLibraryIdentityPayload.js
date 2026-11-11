'use strict';

function nonEmptyEntries(entries) {
  return Object.fromEntries(entries.filter(([, value]) => value !== null && value !== undefined && value !== ''));
}

function text(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

function keys(value, label) {
  if (!Array.isArray(value) || value.some((key) => typeof key !== 'string' || !key.trim())) {
    throw new TypeError(`${label} must be an array of field names`);
  }
  return [...new Set(value.map((key) => key.trim()))];
}

function buildDigitalLibraryCanonicalFields(item = {}, { mediaKeys = [], typeDetailKeys = [] } = {}) {
  const details = item.type_details && typeof item.type_details === 'object' && !Array.isArray(item.type_details)
    ? item.type_details
    : {};
  return nonEmptyEntries([
    ...keys(mediaKeys, 'Digital-library media keys').map((key) => [`media.${key}`, item[key]]),
    ...keys(typeDetailKeys, 'Digital-library type-detail keys').map((key) => [`type_details.${key}`, details[key]])
  ]);
}

function buildDigitalLibraryCompatibility({
  providerName,
  externalId,
  typeDetailKeys = ['provider_item_id'],
  metadataKeys = ['provider_item_id']
} = {}) {
  const provider = text(providerName, 'Digital-library provider name');
  const identity = text(externalId, 'Digital-library compatibility identity');
  return {
    typeDetails: {
      provider_name: provider,
      ...Object.fromEntries(keys(typeDetailKeys, 'Digital-library compatibility type-detail keys')
        .map((key) => [key, identity]))
    },
    metadata: Object.fromEntries(keys(metadataKeys, 'Digital-library compatibility metadata keys')
      .map((key) => [key, identity]))
  };
}

module.exports = {
  buildDigitalLibraryCanonicalFields,
  buildDigitalLibraryCompatibility
};
