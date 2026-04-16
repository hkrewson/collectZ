'use strict';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function normalizeIssueToken(value) {
  return String(value || '')
    .trim()
    .replace(/^#\s*/, '')
    .replace(/^(issue|no\.?)\s*/i, '')
    .trim()
    .toLowerCase();
}

function toPlainTypeDetails(typeDetails) {
  return typeDetails && typeof typeDetails === 'object' ? typeDetails : {};
}

function buildBookNormalizationIdentity(row = {}) {
  const typeDetails = toPlainTypeDetails(row.type_details);
  const isbn = normalizeDigits(typeDetails.isbn || row.isbn || '');
  if (isbn) {
    return {
      confidence: 'high',
      kind: 'isbn',
      key: `book:isbn:${isbn}`
    };
  }

  const normalizedTitle = normalizeText(row.title);
  const normalizedAuthor = normalizeText(typeDetails.author || row.book_author || '');
  if (normalizedTitle && normalizedAuthor) {
    return {
      confidence: 'medium',
      kind: 'title_author',
      key: `book:title_author:${normalizedTitle}::${normalizedAuthor}`
    };
  }

  if (normalizedTitle) {
    return {
      confidence: 'low',
      kind: 'title_only',
      key: `book:title:${normalizedTitle}`
    };
  }

  return null;
}

function buildComicNormalizationIdentity(row = {}) {
  const typeDetails = toPlainTypeDetails(row.type_details);
  const providerName = normalizeText(typeDetails.provider_name || '');
  const providerItemId = String(typeDetails.provider_item_id || '').trim();
  if (providerName && providerItemId) {
    return {
      confidence: 'high',
      kind: 'provider_item',
      key: `comic:provider:${providerName}::${providerItemId}`
    };
  }

  const series = normalizeText(typeDetails.series || '');
  const issueNumber = normalizeIssueToken(typeDetails.issue_number || '');
  const volume = normalizeText(typeDetails.volume || '');
  if (series && issueNumber) {
    return {
      confidence: 'high',
      kind: 'series_issue',
      key: `comic:series_issue:${series}::${volume || '-'}::${issueNumber}`
    };
  }

  const normalizedTitle = normalizeText(row.title);
  if (normalizedTitle) {
    return {
      confidence: 'low',
      kind: 'title_only',
      key: `comic:title:${normalizedTitle}`
    };
  }

  return null;
}

function detectLikelyComicLikeBook(row = {}) {
  const typeDetails = toPlainTypeDetails(row.type_details);
  const title = String(row.title || '').trim();
  if (!title) return { likely: false, reasons: [] };

  const reasons = [];
  if (/#\s*\d+[a-z]?/i.test(title)) reasons.push('issue_number_in_title');
  if (/\bvariant\b/i.test(title)) reasons.push('variant_in_title');
  if (/^\(\d{4}\)\s+.+#\s*\d+/i.test(title)) reasons.push('year_prefixed_issue_title');
  if (/\bv\d+\s*#\s*\d+/i.test(title)) reasons.push('volume_issue_pattern');

  const hasComicTypeDetails = Boolean(
    String(typeDetails.series || '').trim()
    || String(typeDetails.issue_number || '').trim()
    || String(typeDetails.volume || '').trim()
  );
  if (hasComicTypeDetails) reasons.push('comic_type_details_present');

  return {
    likely: reasons.length > 0,
    reasons
  };
}

function groupRowsByNormalizationKey(rows = [], builder) {
  const grouped = new Map();
  for (const row of rows) {
    const identity = builder(row);
    if (!identity?.key) continue;
    const bucket = grouped.get(identity.key) || {
      ...identity,
      rows: []
    };
    bucket.rows.push(row);
    grouped.set(identity.key, bucket);
  }
  return Array.from(grouped.values()).filter((bucket) => bucket.rows.length > 1);
}

module.exports = {
  normalizeText,
  normalizeDigits,
  normalizeIssueToken,
  buildBookNormalizationIdentity,
  buildComicNormalizationIdentity,
  detectLikelyComicLikeBook,
  groupRowsByNormalizationKey
};
