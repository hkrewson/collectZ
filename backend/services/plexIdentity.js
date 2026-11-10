'use strict';

const { createProviderAdapterRegistry } = require('./providerAdapterRegistry');

const PLEX_GUID_IDENTITY_KIND = 'guid';
const PLEX_ITEM_IDENTITY_KIND = 'item';
const PLEX_IDENTITY_KINDS = new Set([PLEX_GUID_IDENTITY_KIND, PLEX_ITEM_IDENTITY_KIND]);

const plexAdapter = Object.freeze({
  validateSettings(settings) {
    const slot = String(settings?.integrationSlot || 'plex').trim().toLowerCase();
    if (slot !== 'plex') throw new TypeError('Plex provider settings require the Plex integration slot');
    return { integrationSlot: 'plex' };
  },
  validateCredentials(credentials) {
    const normalized = {};
    if (credentials?.token !== undefined) normalized.token = String(credentials.token || '');
    return normalized;
  },
  normalizeExternalId(kind, raw, normalizers) {
    if (!PLEX_IDENTITY_KINDS.has(kind)) throw new TypeError(`Plex identity kind ${kind} is not supported`);
    return normalizers.exact(raw);
  }
});

function compact(entries) {
  return Object.fromEntries(entries.filter(([, value]) => value !== null && value !== undefined && value !== ''));
}

function selectPlexIdentity({ plexGuid = null, plexItemKey = null } = {}) {
  const guid = String(plexGuid || '').trim();
  if (guid) return { identityKind: PLEX_GUID_IDENTITY_KIND, externalId: guid };
  const itemKey = String(plexItemKey || '').trim();
  if (itemKey) return { identityKind: PLEX_ITEM_IDENTITY_KIND, externalId: itemKey };
  const error = new Error('Plex item is missing both GUID and item-key identity');
  error.code = 'INVALID_EXTERNAL_IDENTITY';
  throw error;
}

function buildPlexCompatibility(identityKind, externalId) {
  const value = String(externalId || '').trim();
  if (!value) throw new TypeError('Plex compatibility projection requires an external id');
  if (identityKind === PLEX_GUID_IDENTITY_KIND) return { metadata: { plex_guid: value } };
  if (identityKind === PLEX_ITEM_IDENTITY_KIND) return { metadata: { plex_item_key: value } };
  throw new TypeError(`Plex identity kind ${identityKind} is not supported`);
}

function buildPlexCanonicalFields(item = {}) {
  const details = item.type_details && typeof item.type_details === 'object' ? item.type_details : {};
  const fields = [
    ['media.title', item.title],
    ['media.original_title', item.original_title],
    ['media.release_date', item.release_date],
    ['media.year', item.year],
    ['media.format', item.format],
    ['media.director', item.director],
    ['media.cast_members', item.cast],
    ['media.rating', item.rating],
    ['media.runtime', item.runtime],
    ['media.poster_path', item.poster_path],
    ['media.backdrop_path', item.backdrop_path],
    ['media.overview', item.overview],
    ['media.tmdb_id', item.tmdb_id],
    ['media.tmdb_media_type', item.tmdb_media_type],
    ['media.tmdb_url', item.tmdb_url],
    ['media.network', item.network]
  ];
  if (item.media_type === 'audio') {
    fields.push(
      ['type_details.artist', details.artist],
      ['type_details.album', details.album],
      ['type_details.track_count', details.track_count],
      ['type_details.compilation', details.compilation],
      ['type_details.track_artists', details.track_artists]
    );
  }
  return compact(fields);
}

function createPlexAdapterRegistry() {
  return createProviderAdapterRegistry({ plex: plexAdapter });
}

module.exports = {
  PLEX_GUID_IDENTITY_KIND,
  PLEX_ITEM_IDENTITY_KIND,
  plexAdapter,
  selectPlexIdentity,
  buildPlexCompatibility,
  buildPlexCanonicalFields,
  createPlexAdapterRegistry
};
