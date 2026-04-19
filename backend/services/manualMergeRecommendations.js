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

function normalizeComparableIdentityText(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return normalizeText(raw) || raw.toLowerCase();
}

function buildStructuredTitleNamespace(raw = '') {
  const namespaceMatch = String(raw || '').trim().match(
    /^(.*?)(?:(?:\s*[:\-]\s*)|(?:,\s*)|(?:\s+\b(?:vol(?:ume)?\.?|season|disc|part)\b))/i
  );
  return normalizeText(namespaceMatch?.[1] || '');
}

function extractStructuredTitleSignals(title = '') {
  const raw = String(title || '').trim();
  const normalizedTitle = normalizeText(raw);
  const volumeMatch = raw.match(/\bvol(?:ume)?\.?\s*([ivxlcdm0-9]+(?:\.\d+)?)\b/i);
  const seasonMatch = raw.match(/\bseason\s+(\d+)\b/i);
  const discMatch = raw.match(/\bdisc\s+([ivxlcdm0-9]+|\d+)\b/i);
  const partMatch = raw.match(/\bpart\s+([ivxlcdm0-9]+|\d+)\b/i);
  const collectionSignal = /\b(collection|box set|collector'?s edition|anthology|complete series|complete collection|volume|vol(?:ume)?\.?|season|disc|part)\b/i.test(raw);
  const separatorParts = raw.match(/^(.*?)[\s]*[:\-][\s]*(.+)$/);
  const separatorPrefix = separatorParts ? normalizeText(separatorParts[1]) : '';
  const separatorSuffix = separatorParts ? normalizeText(separatorParts[2]) : '';
  const titleNamespace = buildStructuredTitleNamespace(raw);
  const namespaceRemainder = titleNamespace && normalizedTitle.startsWith(`${titleNamespace} `)
    ? normalizedTitle.slice(titleNamespace.length).trim()
    : normalizedTitle !== titleNamespace ? normalizedTitle : '';
  return {
    raw,
    normalizedTitle,
    volumeToken: normalizeText(volumeMatch?.[1] || ''),
    seasonToken: normalizeDigits(seasonMatch?.[1] || ''),
    discToken: normalizeText(discMatch?.[1] || ''),
    partToken: normalizeText(partMatch?.[1] || ''),
    hasCollectionSignal: collectionSignal,
    separatorPrefix,
    separatorSuffix,
    titleNamespace,
    namespaceRemainder,
    hasGenericSubtitle: Boolean(separatorSuffix) && GENERIC_SUBTITLE_TOKENS.has(separatorSuffix)
  };
}

function isStructuredTitlePairUnsafeForSharedCoverDiscovery(leftTitle = '', rightTitle = '') {
  const left = extractStructuredTitleSignals(leftTitle);
  const right = extractStructuredTitleSignals(rightTitle);
  if (!left.normalizedTitle || !right.normalizedTitle) return false;
  if (left.normalizedTitle === right.normalizedTitle) return false;

  if (left.separatorPrefix && right.separatorPrefix && left.separatorPrefix === right.separatorPrefix) {
    if (left.separatorSuffix && right.separatorSuffix && left.separatorSuffix !== right.separatorSuffix) {
      return true;
    }
  }

  if (left.titleNamespace && right.titleNamespace && left.titleNamespace === right.titleNamespace) {
    if (left.namespaceRemainder && right.namespaceRemainder && left.namespaceRemainder !== right.namespaceRemainder) {
      return true;
    }
  }

  if (left.volumeToken && right.volumeToken && left.volumeToken !== right.volumeToken) return true;
  if (left.seasonToken && right.seasonToken && left.seasonToken !== right.seasonToken) return true;
  if (left.discToken && right.discToken && left.discToken !== right.discToken) return true;
  if (left.partToken && right.partToken && left.partToken !== right.partToken) return true;
  return false;
}

function isTitleSafeForGenericYearRecommendation(title = '') {
  const signals = extractStructuredTitleSignals(title);
  return Boolean(signals.normalizedTitle)
    && !signals.hasCollectionSignal
    && !signals.hasGenericSubtitle;
}

function assessMovieDiscoveryConflictReasons(leftRow = {}, rightRow = {}) {
  if (String(leftRow.media_type || '').trim() !== 'movie' || String(rightRow.media_type || '').trim() !== 'movie') {
    return [];
  }
  const reasons = [];
  const leftTmdbId = String(leftRow.tmdb_id || '').trim();
  const rightTmdbId = String(rightRow.tmdb_id || '').trim();
  const leftUpc = normalizeDigits(leftRow.upc || '');
  const rightUpc = normalizeDigits(rightRow.upc || '');
  const leftOriginalTitle = normalizeComparableIdentityText(leftRow.original_title || '');
  const rightOriginalTitle = normalizeComparableIdentityText(rightRow.original_title || '');
  const leftDirector = normalizeComparableIdentityText(leftRow.director || '');
  const rightDirector = normalizeComparableIdentityText(rightRow.director || '');
  const leftYear = Number(leftRow.year || 0) || null;
  const rightYear = Number(rightRow.year || 0) || null;
  const leftRuntime = Number(leftRow.runtime || 0) || null;
  const rightRuntime = Number(rightRow.runtime || 0) || null;

  if (leftTmdbId && rightTmdbId && leftTmdbId !== rightTmdbId) reasons.push('tmdb_id_conflict');
  if (leftUpc && rightUpc && leftUpc !== rightUpc) reasons.push('upc_conflict');
  if (leftOriginalTitle && rightOriginalTitle && leftOriginalTitle !== rightOriginalTitle) reasons.push('original_title_conflict');
  if (leftDirector && rightDirector && leftDirector !== rightDirector) reasons.push('director_conflict');
  if (leftYear && rightYear && Math.abs(leftYear - rightYear) >= 2) reasons.push('year_conflict');
  if (leftRuntime && rightRuntime && Math.abs(leftRuntime - rightRuntime) >= 10) reasons.push('runtime_conflict');

  return reasons;
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
  assessMovieDiscoveryConflictReasons,
  extractStructuredTitleSignals,
  isStructuredTitlePairUnsafeForSharedCoverDiscovery,
  isTitleSafeForGenericYearRecommendation,
  buildGenericManualMergeIdentity
};
