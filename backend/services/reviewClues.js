'use strict';

const { normalizeOwnedFormats } = require('./mediaFormats');

const PHYSICAL_AUDIO_FORMATS = ['cd', 'vinyl', 'cassette', 'eight_track', 'four_track', 'vhs'];
const PHYSICAL_GAME_FORMATS = ['disc', 'card', 'cartridge'];

function sqlBlank(expr) {
  return `COALESCE(NULLIF(TRIM(${expr}), ''), NULL) IS NULL`;
}

function sqlPresent(expr) {
  return `COALESCE(NULLIF(TRIM(${expr}), ''), NULL) IS NOT NULL`;
}

function details(alias, key) {
  return `${alias}.type_details->>'${key}'`;
}

function buildMissingIdentifierReviewSql(alias = 'media') {
  const upcMissing = sqlBlank(`${alias}.upc`);
  const upcPresent = sqlPresent(`${alias}.upc`);
  const providerIdentityMissing = [
    details(alias, 'provider_item_id'),
    details(alias, 'provider_issue_id'),
    details(alias, 'provider_key'),
    details(alias, 'apple_itunes_track_id'),
    details(alias, 'apple_itunes_collection_id')
  ].map(sqlBlank).join(' AND ');
  const providerIdentityPresent = `NOT (${providerIdentityMissing})`;
  const bookIdentityMissing = [
    details(alias, 'isbn'),
    details(alias, 'isbn13'),
    details(alias, 'google_books_id'),
    details(alias, 'calibre_entry_id')
  ].map(sqlBlank).join(' AND ');
  const comicIdentityMissing = [
    details(alias, 'isbn'),
    details(alias, 'isbn13'),
    details(alias, 'provider_issue_id'),
    details(alias, 'kavita_chapter_id'),
    details(alias, 'kavita_series_id')
  ].map(sqlBlank).join(' AND ');
  const comicSeriesIssuePresent = `(${sqlPresent(details(alias, 'series'))} AND ${sqlPresent(details(alias, 'issue_number'))})`;
  const plexIdentityMissing = [
    details(alias, 'plex_rating_key'),
    details(alias, 'plex_item_key')
  ].map(sqlBlank).join(' AND ');
  const physicalAudio = `COALESCE(${alias}.owned_formats, ARRAY[]::text[]) && ARRAY['${PHYSICAL_AUDIO_FORMATS.join("','")}']::text[]`;
  const physicalGame = `COALESCE(${alias}.owned_formats, ARRAY[]::text[]) && ARRAY['${PHYSICAL_GAME_FORMATS.join("','")}']::text[]`;

  return `((
      ${alias}.media_type = 'book'
      AND ${upcMissing}
      AND ${bookIdentityMissing}
      AND ${providerIdentityMissing}
    ) OR (
      ${alias}.media_type IN ('movie', 'tv_series', 'tv_episode')
      AND ${upcMissing}
      AND ${alias}.tmdb_id IS NULL
      AND ${plexIdentityMissing}
      AND ${providerIdentityMissing}
    ) OR (
      ${alias}.media_type = 'comic_book'
      AND ${upcMissing}
      AND ${comicIdentityMissing}
      AND ${providerIdentityMissing}
      AND NOT ${comicSeriesIssuePresent}
    ) OR (
      ${alias}.media_type = 'audio'
      AND ${physicalAudio}
      AND ${upcMissing}
      AND ${providerIdentityMissing}
    ) OR (
      ${alias}.media_type = 'game'
      AND ${physicalGame}
      AND ${upcMissing}
      AND ${providerIdentityMissing}
    ))`;
}

function buildSparseMetadataReviewSql(alias = 'media') {
  const missingIdentifier = buildMissingIdentifierReviewSql(alias);
  const noOwnedFormats = `COALESCE(array_length(COALESCE(${alias}.owned_formats, ARRAY[]::text[]), 1), 0) = 0`;
  return `((NOT ${missingIdentifier}) AND ((
      ${alias}.media_type = 'book'
      AND (${sqlBlank(details(alias, 'author'))} OR ${alias}.year IS NULL)
    ) OR (
      ${alias}.media_type IN ('movie', 'tv_series', 'tv_episode')
      AND ${alias}.year IS NULL
    ) OR (
      ${alias}.media_type = 'comic_book'
      AND (${sqlBlank(details(alias, 'series'))} OR ${sqlBlank(details(alias, 'issue_number'))} OR (${sqlBlank(details(alias, 'writer'))} AND ${sqlBlank(details(alias, 'artist'))}))
    ) OR (
      ${alias}.media_type = 'audio'
      AND (${sqlBlank(details(alias, 'artist'))} OR ${alias}.year IS NULL OR ${noOwnedFormats})
    ) OR (
      ${alias}.media_type = 'game'
      AND (${sqlBlank(details(alias, 'platform'))} OR ${alias}.year IS NULL OR (${sqlBlank(details(alias, 'developer'))} AND ${sqlBlank(details(alias, 'publisher'))}) OR ${noOwnedFormats})
    )))`;
}

const MISSING_IDENTIFIER_REVIEW_SQL = buildMissingIdentifierReviewSql('media');
const SPARSE_METADATA_REVIEW_SQL = buildSparseMetadataReviewSql('media');

function safeDetails(row = {}) {
  return row.type_details && typeof row.type_details === 'object' ? row.type_details : {};
}

function hasText(value) {
  return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined && value !== '';
}

function firstText(...values) {
  return values.find(hasText) || null;
}

function mediaType(row = {}) {
  return String(row.media_type || '').trim().toLowerCase();
}

function ownedFormats(row = {}) {
  return normalizeOwnedFormats(mediaType(row), row.owned_formats, row.format);
}

function hasProviderIdentity(row = {}) {
  const detailsRow = safeDetails(row);
  return Boolean(firstText(
    detailsRow.provider_item_id,
    detailsRow.provider_issue_id,
    detailsRow.provider_key,
    detailsRow.apple_itunes_track_id,
    detailsRow.apple_itunes_collection_id,
    detailsRow.calibre_entry_id
  ));
}

function hasBookIdentity(row = {}) {
  const detailsRow = safeDetails(row);
  return hasText(row.upc)
    || Boolean(firstText(detailsRow.isbn, detailsRow.isbn13, detailsRow.google_books_id, detailsRow.calibre_entry_id))
    || hasProviderIdentity(row);
}

function hasMovieIdentity(row = {}) {
  const detailsRow = safeDetails(row);
  return hasText(row.upc)
    || hasText(row.tmdb_id)
    || Boolean(firstText(detailsRow.plex_rating_key, detailsRow.plex_item_key))
    || hasProviderIdentity(row);
}

function hasComicIdentity(row = {}) {
  const detailsRow = safeDetails(row);
  const seriesIssue = hasText(detailsRow.series) && hasText(detailsRow.issue_number);
  return hasText(row.upc)
    || Boolean(firstText(detailsRow.isbn, detailsRow.isbn13, detailsRow.provider_issue_id, detailsRow.kavita_chapter_id, detailsRow.kavita_series_id))
    || hasProviderIdentity(row)
    || seriesIssue;
}

function hasPhysicalIdentifier(row = {}) {
  return hasText(row.upc) || hasProviderIdentity(row);
}

function isPhysicalAudio(row = {}) {
  return ownedFormats(row).some((format) => PHYSICAL_AUDIO_FORMATS.includes(format));
}

function isPhysicalGame(row = {}) {
  return ownedFormats(row).some((format) => PHYSICAL_GAME_FORMATS.includes(format));
}

function missingIdentifierRecommendation(row = {}) {
  switch (mediaType(row)) {
    case 'book':
      return {
        reason: 'No book identifier on record',
        recommended_identifiers: ['ISBN', 'Google Books ID']
      };
    case 'movie':
    case 'tv_series':
    case 'tv_episode':
      return {
        reason: 'No movie or TV provider identity on record',
        recommended_identifiers: ['TMDB ID', 'Plex identity']
      };
    case 'comic_book':
      return {
        reason: 'No comic issue identity or series/issue pairing on record',
        recommended_identifiers: ['UPC/ISBN', 'provider issue identity']
      };
    case 'audio':
      return {
        reason: 'Physical audio item has no retail identifier',
        recommended_identifiers: ['UPC/EAN']
      };
    case 'game':
      return {
        reason: 'Physical game item has no retail identifier',
        recommended_identifiers: ['UPC/EAN']
      };
    default:
      return {
        reason: 'No recognized identifier on record',
        recommended_identifiers: []
      };
  }
}

function buildMissingIdentifierReviewClues(row = {}) {
  const type = mediaType(row);
  const isMissing = (type === 'book' && !hasBookIdentity(row))
    || ((type === 'movie' || type === 'tv_series' || type === 'tv_episode') && !hasMovieIdentity(row))
    || (type === 'comic_book' && !hasComicIdentity(row))
    || (type === 'audio' && isPhysicalAudio(row) && !hasPhysicalIdentifier(row))
    || (type === 'game' && isPhysicalGame(row) && !hasPhysicalIdentifier(row));

  if (!isMissing) {
    return {
      review_finding_type: null,
      review_reasons: [],
      recommended_identifiers: []
    };
  }

  const recommendation = missingIdentifierRecommendation(row);
  return {
    review_finding_type: 'missing_identifier',
    review_reasons: [recommendation.reason],
    recommended_identifiers: recommendation.recommended_identifiers
  };
}

function missingMetadata(row = {}) {
  const detailsRow = safeDetails(row);
  const missing = [];
  const type = mediaType(row);
  if (type === 'book') {
    if (!hasText(detailsRow.author)) missing.push('author');
    if (!hasText(row.year)) missing.push('year');
  } else if (type === 'movie' || type === 'tv_series' || type === 'tv_episode') {
    if (!hasText(row.year)) missing.push('year');
  } else if (type === 'comic_book') {
    if (!hasText(detailsRow.series)) missing.push('series');
    if (!hasText(detailsRow.issue_number)) missing.push('issue number');
    if (!hasText(detailsRow.writer) && !hasText(detailsRow.artist)) missing.push('creator');
  } else if (type === 'audio') {
    if (!hasText(detailsRow.artist)) missing.push('artist');
    if (!hasText(row.year)) missing.push('year');
    if (ownedFormats(row).length === 0) missing.push('format');
  } else if (type === 'game') {
    if (!hasText(detailsRow.platform)) missing.push('platform');
    if (!hasText(row.year)) missing.push('year');
    if (!hasText(detailsRow.developer) && !hasText(detailsRow.publisher)) missing.push('developer or publisher');
    if (ownedFormats(row).length === 0) missing.push('format');
  }
  return missing;
}

function buildSparseMetadataReviewClues(row = {}) {
  if (buildMissingIdentifierReviewClues(row).review_finding_type === 'missing_identifier') {
    return {
      review_finding_type: null,
      review_reasons: [],
      recommended_metadata: []
    };
  }
  const missing = missingMetadata(row);
  if (missing.length === 0) {
    return {
      review_finding_type: null,
      review_reasons: [],
      recommended_metadata: []
    };
  }
  return {
    review_finding_type: 'sparse_metadata',
    review_reasons: ['Record is missing helpful descriptive metadata'],
    recommended_metadata: missing
  };
}

function buildMediaHealthReview(row = {}) {
  const identifier = buildMissingIdentifierReviewClues(row);
  if (identifier.review_finding_type) return identifier;
  return buildSparseMetadataReviewClues(row);
}

function applyMediaReviewClues(row = {}, reviewFilter = '') {
  const normalized = String(reviewFilter || '').trim().toLowerCase().replace(/-/g, '_');
  if (normalized === 'missing_identifiers' || normalized === 'missing_identifier') {
    return {
      ...row,
      ...buildMissingIdentifierReviewClues(row)
    };
  }
  if (normalized === 'sparse_metadata' || normalized === 'missing_metadata' || normalized === 'metadata') {
    return {
      ...row,
      ...buildSparseMetadataReviewClues(row)
    };
  }
  return row;
}

module.exports = {
  MISSING_IDENTIFIER_REVIEW_SQL,
  SPARSE_METADATA_REVIEW_SQL,
  buildMediaHealthReview,
  buildMissingIdentifierReviewClues,
  buildMissingIdentifierReviewSql,
  buildSparseMetadataReviewClues,
  buildSparseMetadataReviewSql,
  applyMediaReviewClues
};
