'use strict';

const { normalizeDigits, normalizeText } = require('./bookComicNormalization');

const GENERIC_SUBTITLE_TOKENS = new Set([
  'the movie',
  'movie',
  'the film',
  'the collection',
  'collection',
  'the series',
  'complete series'
]);

function extractStructuredTitleSignals(title = '') {
  const raw = String(title || '').trim();
  const normalizedTitle = normalizeText(raw);
  const volumeMatch = raw.match(/\bvol(?:ume)?\.?\s*([ivxlcdm0-9]+(?:\.\d+)?)\b/i);
  const seasonMatch = raw.match(/\bseason\s+(\d+)\b/i);
  const discMatch = raw.match(/\bdisc\s+([ivxlcdm0-9]+|\d+)\b/i);
  const partMatch = raw.match(/\bpart\s+([ivxlcdm0-9]+|\d+)\b/i);
  const collectionSignal = /\b(collection|box set|collector'?s edition|anthology|complete series|complete collection|volume|vol(?:ume)?\.?|season|disc|part)\b/i.test(raw);
  const separatorMatch = raw.match(/[:\-]\s*([^:-]+)$/);
  const suffix = separatorMatch ? normalizeText(separatorMatch[1]) : '';
  return {
    raw,
    normalizedTitle,
    volumeToken: normalizeText(volumeMatch?.[1] || ''),
    seasonToken: normalizeDigits(seasonMatch?.[1] || ''),
    discToken: normalizeText(discMatch?.[1] || ''),
    partToken: normalizeText(partMatch?.[1] || ''),
    hasCollectionSignal: collectionSignal,
    hasGenericSubtitle: Boolean(suffix) && GENERIC_SUBTITLE_TOKENS.has(suffix)
  };
}

function isTitleSafeForGenericYearRecommendation(title = '') {
  const signals = extractStructuredTitleSignals(title);
  return Boolean(signals.normalizedTitle)
    && !signals.hasCollectionSignal
    && !signals.hasGenericSubtitle;
}

function buildGenericManualMergeIdentity(row = {}) {
  const mediaType = String(row.media_type || '').trim();
  const typeDetails = row?.type_details && typeof row.type_details === 'object' ? row.type_details : {};
  const providerName = normalizeText(typeDetails.provider_name || '');
  const providerItemId = String(typeDetails.provider_item_id || '').trim();
  if (providerName && providerItemId) {
    return {
      confidence: 'high',
      kind: 'provider_item',
      key: `${mediaType}:provider:${providerName}::${providerItemId}`,
      rationale: ['provider_name', 'provider_item_id']
    };
  }

  const tmdbId = String(row.tmdb_id || '').trim();
  if (tmdbId) {
    return {
      confidence: 'high',
      kind: 'tmdb_id',
      key: `${mediaType}:tmdb:${tmdbId}`,
      rationale: ['tmdb_id']
    };
  }

  const normalizedUpc = normalizeDigits(row.upc || '');
  if (normalizedUpc) {
    return {
      confidence: 'high',
      kind: 'upc',
      key: `${mediaType}:upc:${normalizedUpc}`,
      rationale: ['upc']
    };
  }

  const normalizedTitle = normalizeText(row.title || '');
  const year = String(row.year || '').trim();
  if (normalizedTitle && year && isTitleSafeForGenericYearRecommendation(row.title || '')) {
    return {
      confidence: 'medium',
      kind: 'title_year',
      key: `${mediaType}:title_year:${normalizedTitle}::${year}`,
      rationale: ['normalized_title', 'year']
    };
  }

  if (normalizedTitle) {
    return {
      confidence: 'low',
      kind: 'title_only',
      key: `${mediaType}:title:${normalizedTitle}`,
      rationale: ['normalized_title_only']
    };
  }

  return null;
}

module.exports = {
  extractStructuredTitleSignals,
  isTitleSafeForGenericYearRecommendation,
  buildGenericManualMergeIdentity
};
