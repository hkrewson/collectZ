'use strict';

const { createProviderAdapterRegistry } = require('./providerAdapterRegistry');
const {
  buildDigitalLibraryCanonicalFields,
  buildDigitalLibraryCompatibility
} = require('./digitalLibraryIdentityPayload');

const CWA_IDENTITY_KIND = 'book';

const cwaAdapter = Object.freeze({
  validateSettings(settings) {
    const slot = String(settings?.integrationSlot || 'cwa_opds').trim().toLowerCase();
    if (slot !== 'cwa_opds') throw new TypeError('CWA provider settings require the CWA OPDS integration slot');
    return { integrationSlot: 'cwa_opds' };
  },
  validateCredentials(credentials) {
    const normalized = {};
    if (credentials?.username !== undefined) normalized.username = String(credentials.username || '').trim();
    if (credentials?.password !== undefined) normalized.password = String(credentials.password || '');
    return normalized;
  },
  normalizeExternalId(kind, raw, normalizers) {
    if (kind !== CWA_IDENTITY_KIND) throw new TypeError(`CWA identity kind ${kind} is not supported`);
    return normalizers.exact(raw);
  }
});

function buildCwaCanonicalFields(item = {}) {
  const typeDetailKeys = [
    'author', 'isbn', 'publisher', 'edition',
    'provider_external_url', 'provider_download_url',
    'calibre_external_url', 'calibre_download_url', 'source_updated_at'
  ];
  if (item.media_type === 'comic_book') {
    typeDetailKeys.push('series', 'issue_number', 'volume');
  }
  return buildDigitalLibraryCanonicalFields(item, {
    mediaKeys: ['title', 'original_title', 'release_date', 'year', 'format', 'genre', 'overview', 'poster_path'],
    typeDetailKeys
  });
}

function buildCwaCompatibility(externalId) {
  return buildDigitalLibraryCompatibility({
    providerName: 'cwa_opds',
    externalId,
    typeDetailKeys: ['provider_item_id', 'calibre_entry_id'],
    metadataKeys: ['provider_item_id', 'calibre_entry_id']
  });
}

function createCwaAdapterRegistry() {
  return createProviderAdapterRegistry({ cwa: cwaAdapter });
}

module.exports = {
  CWA_IDENTITY_KIND,
  cwaAdapter,
  buildCwaCanonicalFields,
  buildCwaCompatibility,
  createCwaAdapterRegistry
};
