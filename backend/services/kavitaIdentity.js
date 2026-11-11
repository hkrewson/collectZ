'use strict';

const { createProviderAdapterRegistry } = require('./providerAdapterRegistry');

const KAVITA_SERIES_IDENTITY_KIND = 'series';
const KAVITA_CHAPTER_IDENTITY_KIND = 'chapter';

function parseKavitaExternalIdentity(value) {
  const match = String(value || '').trim().match(/^kavita:(series|chapter):(\d+)$/i);
  if (!match) {
    const error = new TypeError('Kavita identity must use kavita:series:<id> or kavita:chapter:<id>');
    error.code = 'INVALID_EXTERNAL_IDENTITY';
    throw error;
  }
  return Object.freeze({
    identityKind: match[1].toLowerCase(),
    providerItemId: `kavita:${match[1].toLowerCase()}:${BigInt(match[2]).toString(10)}`,
    numericId: BigInt(match[2]).toString(10)
  });
}

const kavitaAdapter = Object.freeze({
  validateSettings(settings) {
    const slot = String(settings?.integrationSlot || 'kavita').trim().toLowerCase();
    if (slot !== 'kavita') throw new TypeError('Kavita provider settings require the Kavita integration slot');
    return { integrationSlot: 'kavita' };
  },
  validateCredentials(credentials) {
    const normalized = {};
    if (credentials?.apiKey !== undefined) normalized.apiKey = String(credentials.apiKey || '').trim();
    return normalized;
  },
  normalizeExternalId(kind, raw, normalizers) {
    if (![KAVITA_SERIES_IDENTITY_KIND, KAVITA_CHAPTER_IDENTITY_KIND].includes(kind)) {
      throw new TypeError(`Kavita identity kind ${kind} is not supported`);
    }
    const parsed = parseKavitaExternalIdentity(raw);
    if (parsed.identityKind !== kind) throw new TypeError(`Kavita ${kind} identity has the wrong provider prefix`);
    return normalizers.numeric(parsed.numericId);
  }
});

function compact(entries) {
  return Object.fromEntries(entries.filter(([, value]) => value !== null && value !== undefined && value !== ''));
}

const KAVITA_CANONICAL_DETAIL_KEYS = Object.freeze([
  'author', 'isbn', 'publisher', 'edition',
  'series', 'issue_number', 'volume', 'writer', 'artist', 'inker', 'colorist', 'cover_date',
  'provider_external_url', 'provider_download_url', 'provider_series_url',
  'kavita_library_id', 'kavita_library_name', 'kavita_library_type',
  'kavita_series_id', 'kavita_series_name', 'kavita_localized_name', 'kavita_original_name',
  'kavita_sort_name', 'kavita_title_parse_status', 'kavita_issue_title', 'kavita_format', 'kavita_pages',
  'kavita_cover_image', 'kavita_cover_url', 'kavita_cover_proxy_url', 'kavita_cover_source', 'kavita_cover_status',
  'kavita_series_url', 'kavita_launch_url', 'kavita_launch_label', 'kavita_launch_target',
  'kavita_volume_detail_status', 'kavita_volume_count', 'kavita_chapter_count', 'kavita_volume_numbers',
  'kavita_first_volume_number', 'kavita_first_chapter_id', 'kavita_first_chapter_number',
  'kavita_first_chapter_title', 'kavita_first_chapter_release_date', 'kavita_first_chapter_pages',
  'kavita_chapter_titles', 'kavita_chapter_pages_total', 'kavita_chapter_fanout',
  'kavita_chapter_id', 'kavita_volume_id', 'kavita_chapter_number', 'kavita_chapter_title',
  'kavita_chapter_sort_order', 'kavita_chapter_release_date', 'kavita_chapter_pages', 'kavita_chapter_special',
  'kavita_parent_provider_item_id', 'kavita_series_provider_item_id', 'kavita_chapter_provider_item_id'
]);

function buildKavitaCanonicalFields(item = {}) {
  const details = item.type_details && typeof item.type_details === 'object' ? item.type_details : {};
  const common = [
    ['media.title', item.title],
    ['media.original_title', item.original_title],
    ['media.release_date', item.release_date],
    ['media.year', item.year],
    ['media.format', item.format],
    ['media.genre', item.genre],
    ['media.overview', item.overview],
    ['media.poster_path', item.poster_path]
  ];
  for (const key of KAVITA_CANONICAL_DETAIL_KEYS) common.push([`type_details.${key}`, details[key]]);
  return compact(common);
}

function buildKavitaCompatibility(providerItemId, identityKind) {
  const parsed = parseKavitaExternalIdentity(providerItemId);
  if (parsed.identityKind !== identityKind) throw new TypeError('Kavita compatibility identity kind does not match its provider id');
  const typeDetails = { provider_name: 'kavita', provider_item_id: parsed.providerItemId };
  const metadata = { provider_item_id: parsed.providerItemId };
  if (identityKind === KAVITA_CHAPTER_IDENTITY_KIND) {
    typeDetails.provider_issue_id = parsed.providerItemId;
    metadata.provider_issue_id = parsed.providerItemId;
  }
  return { typeDetails, metadata };
}

function createKavitaAdapterRegistry() {
  return createProviderAdapterRegistry({ kavita: kavitaAdapter });
}

module.exports = {
  KAVITA_SERIES_IDENTITY_KIND,
  KAVITA_CHAPTER_IDENTITY_KIND,
  KAVITA_CANONICAL_DETAIL_KEYS,
  kavitaAdapter,
  parseKavitaExternalIdentity,
  buildKavitaCanonicalFields,
  buildKavitaCompatibility,
  createKavitaAdapterRegistry
};
