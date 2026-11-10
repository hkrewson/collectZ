'use strict';

const { createProviderAdapterRegistry } = require('./providerAdapterRegistry');

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

function compact(entries) {
  return Object.fromEntries(entries.filter(([, value]) => value !== null && value !== undefined && value !== ''));
}

function buildCwaCanonicalFields(item = {}) {
  const details = item.type_details && typeof item.type_details === 'object' ? item.type_details : {};
  const common = [
    ['media.title', item.title],
    ['media.original_title', item.original_title],
    ['media.release_date', item.release_date],
    ['media.year', item.year],
    ['media.format', item.format],
    ['media.genre', item.genre],
    ['media.overview', item.overview],
    ['media.poster_path', item.poster_path],
    ['type_details.author', details.author],
    ['type_details.isbn', details.isbn],
    ['type_details.publisher', details.publisher],
    ['type_details.edition', details.edition],
    ['type_details.provider_external_url', details.provider_external_url],
    ['type_details.provider_download_url', details.provider_download_url],
    ['type_details.calibre_external_url', details.calibre_external_url],
    ['type_details.calibre_download_url', details.calibre_download_url],
    ['type_details.source_updated_at', details.source_updated_at]
  ];
  if (item.media_type === 'comic_book') {
    common.push(
      ['type_details.series', details.series],
      ['type_details.issue_number', details.issue_number],
      ['type_details.volume', details.volume]
    );
  }
  return compact(common);
}

function buildCwaCompatibility(externalId) {
  const value = String(externalId || '').trim();
  if (!value) throw new TypeError('CWA compatibility projection requires an entry id');
  return {
    typeDetails: {
      provider_name: 'cwa_opds',
      provider_item_id: value,
      calibre_entry_id: value
    },
    metadata: { provider_item_id: value, calibre_entry_id: value }
  };
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
