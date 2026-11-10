'use strict';

const { createProviderAdapterRegistry } = require('./providerAdapterRegistry');

const METRON_IDENTITY_KIND = 'issue';

const metronAdapter = Object.freeze({
  validateSettings(settings) {
    const slot = String(settings?.integrationSlot || 'comics').trim().toLowerCase();
    if (slot !== 'comics') throw new TypeError('Metron provider settings require the comics integration slot');
    return { integrationSlot: 'comics' };
  },
  validateCredentials(credentials) {
    const normalized = {};
    if (credentials?.username !== undefined) normalized.username = String(credentials.username || '').trim();
    if (credentials?.password !== undefined) normalized.password = String(credentials.password || '');
    return normalized;
  },
  normalizeExternalId(kind, raw, normalizers) {
    if (kind !== METRON_IDENTITY_KIND) throw new TypeError(`Metron identity kind ${kind} is not supported`);
    return normalizers.numeric(raw);
  }
});

function compact(entries) {
  return Object.fromEntries(entries.filter(([, value]) => value !== null && value !== undefined && value !== ''));
}

function buildMetronCanonicalFields(item = {}) {
  const details = item.type_details && typeof item.type_details === 'object' ? item.type_details : {};
  return compact([
    ['media.title', item.title],
    ['media.original_title', item.original_title],
    ['media.release_date', item.release_date],
    ['media.year', item.year],
    ['media.format', item.format],
    ['media.genre', item.genre],
    ['media.overview', item.overview],
    ['media.tmdb_url', item.tmdb_url],
    ['media.poster_path', item.poster_path],
    ['media.upc', item.upc],
    ['type_details.series', details.series],
    ['type_details.issue_number', details.issue_number],
    ['type_details.volume', details.volume],
    ['type_details.edition', details.edition],
    ['type_details.author', details.author],
    ['type_details.publisher', details.publisher],
    ['type_details.writer', details.writer],
    ['type_details.artist', details.artist],
    ['type_details.inker', details.inker],
    ['type_details.colorist', details.colorist],
    ['type_details.cover_date', details.cover_date]
  ]);
}

function buildMetronCompatibility(externalId) {
  const value = String(externalId || '').trim();
  if (!value) throw new TypeError('Metron compatibility projection requires an issue id');
  return {
    typeDetails: { provider_name: 'metron', provider_issue_id: value },
    metadata: { provider_issue_id: value, metron_issue_id: value }
  };
}

function createMetronAdapterRegistry() {
  return createProviderAdapterRegistry({ metron: metronAdapter });
}

module.exports = {
  METRON_IDENTITY_KIND,
  metronAdapter,
  buildMetronCanonicalFields,
  buildMetronCompatibility,
  createMetronAdapterRegistry
};
