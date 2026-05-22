'use strict';

function safeDetails(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hasText(value) {
  return String(value || '').trim().length > 0;
}

function hasRecognizedIdentifier(row = {}) {
  const details = safeDetails(row.type_details);
  return hasText(row.upc)
    || row.tmdb_id !== null && row.tmdb_id !== undefined
    || hasText(details.isbn)
    || hasText(details.isbn13)
    || hasText(details.google_books_id)
    || hasText(details.plex_rating_key)
    || hasText(details.kavita_series_id);
}

function recommendedIdentifiersForMediaType(mediaType) {
  const normalized = String(mediaType || '').trim().toLowerCase();
  if (normalized === 'book') return ['ISBN', 'Google Books ID'];
  if (normalized === 'movie' || normalized === 'tv_series' || normalized === 'tv_episode') return ['TMDB ID', 'Plex identity'];
  if (normalized === 'comic_book') return ['UPC/ISBN', 'provider issue identity'];
  if (normalized === 'audio' || normalized === 'game') return ['UPC'];
  return ['UPC', 'provider identity'];
}

function buildMissingIdentifierReviewClues(row = {}) {
  if (hasRecognizedIdentifier(row)) {
    return {
      review_reasons: [],
      recommended_identifiers: []
    };
  }
  return {
    review_reasons: ['No recognized identifier on record'],
    recommended_identifiers: recommendedIdentifiersForMediaType(row.media_type)
  };
}

function applyMediaReviewClues(row = {}, reviewFilter = '') {
  const normalizedReviewFilter = String(reviewFilter || '').trim().toLowerCase().replace(/-/g, '_');
  if (normalizedReviewFilter !== 'missing_identifiers' && normalizedReviewFilter !== 'missing_identifier') {
    return row;
  }
  return {
    ...row,
    ...buildMissingIdentifierReviewClues(row)
  };
}

module.exports = {
  buildMissingIdentifierReviewClues,
  applyMediaReviewClues,
  recommendedIdentifiersForMediaType
};
