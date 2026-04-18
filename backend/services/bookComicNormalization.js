'use strict';

const CONFIDENCE_ACTIONS = {
  high: 'auto_attach',
  medium: 'review',
  low: 'keep_separate'
};

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

function withAction(identity) {
  if (!identity) return null;
  return {
    ...identity,
    action: CONFIDENCE_ACTIONS[identity.confidence] || 'keep_separate'
  };
}

function buildBookNormalizationIdentity(row = {}) {
  const typeDetails = toPlainTypeDetails(row.type_details);
  const isbn = normalizeDigits(typeDetails.isbn || row.isbn || '');
  if (isbn) {
    return withAction({
      confidence: 'high',
      kind: 'isbn',
      key: `book:isbn:${isbn}`,
      rationale: ['normalized_isbn']
    });
  }

  const normalizedTitle = normalizeText(row.title);
  const normalizedAuthor = normalizeText(typeDetails.author || row.book_author || '');
  if (normalizedTitle && normalizedAuthor) {
    return withAction({
      confidence: 'medium',
      kind: 'title_author',
      key: `book:title_author:${normalizedTitle}::${normalizedAuthor}`,
      rationale: ['normalized_title', 'normalized_author']
    });
  }

  if (normalizedTitle) {
    return withAction({
      confidence: 'low',
      kind: 'title_only',
      key: `book:title:${normalizedTitle}`,
      rationale: ['normalized_title_only']
    });
  }

  return null;
}

function buildComicNormalizationIdentity(row = {}) {
  const typeDetails = toPlainTypeDetails(row.type_details);
  const providerName = normalizeText(typeDetails.provider_name || '');
  const providerItemId = String(typeDetails.provider_item_id || '').trim();
  if (providerName && providerItemId) {
    return withAction({
      confidence: 'high',
      kind: 'provider_item',
      key: `comic:provider:${providerName}::${providerItemId}`,
      rationale: ['provider_name', 'provider_item_id']
    });
  }

  const series = normalizeText(typeDetails.series || '');
  const issueNumber = normalizeIssueToken(typeDetails.issue_number || '');
  const volume = normalizeText(typeDetails.volume || '');
  if (series && issueNumber && volume) {
    return withAction({
      confidence: 'high',
      kind: 'series_issue_volume',
      key: `comic:series_issue:${series}::${volume || '-'}::${issueNumber}`,
      rationale: ['normalized_series', 'normalized_issue_number', 'normalized_volume']
    });
  }

  if (series && issueNumber) {
    return withAction({
      confidence: 'medium',
      kind: 'series_issue',
      key: `comic:series_issue:${series}::-::${issueNumber}`,
      rationale: ['normalized_series', 'normalized_issue_number']
    });
  }

  const normalizedTitle = normalizeText(row.title);
  if (normalizedTitle) {
    return withAction({
      confidence: 'low',
      kind: 'title_only',
      key: `comic:title:${normalizedTitle}`,
      rationale: ['normalized_title_only']
    });
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

function splitClustersByConfidence(clusters = []) {
  return clusters.reduce((acc, cluster) => {
    const key = cluster.confidence || 'unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(cluster);
    return acc;
  }, { high: [], medium: [], low: [] });
}

function buildNormalizationMatchContract() {
  return {
    books: [
      {
        confidence: 'high',
        action: CONFIDENCE_ACTIONS.high,
        precedence: 1,
        kind: 'isbn',
        matchRule: 'Normalized ISBN matches across rows.'
      },
      {
        confidence: 'medium',
        action: CONFIDENCE_ACTIONS.medium,
        precedence: 2,
        kind: 'title_author',
        matchRule: 'Normalized title plus normalized author matches, but no ISBN is present.'
      },
      {
        confidence: 'low',
        action: CONFIDENCE_ACTIONS.low,
        precedence: 3,
        kind: 'title_only',
        matchRule: 'Only normalized title matches, so rows remain separate until stronger evidence exists.'
      }
    ],
    comics: [
      {
        confidence: 'high',
        action: CONFIDENCE_ACTIONS.high,
        precedence: 1,
        kind: 'provider_item',
        matchRule: 'Provider name plus provider item id matches across rows.'
      },
      {
        confidence: 'high',
        action: CONFIDENCE_ACTIONS.high,
        precedence: 2,
        kind: 'series_issue_volume',
        matchRule: 'Normalized series, issue number, and volume all match.'
      },
      {
        confidence: 'medium',
        action: CONFIDENCE_ACTIONS.medium,
        precedence: 3,
        kind: 'series_issue',
        matchRule: 'Normalized series and issue number match, but volume is missing or ambiguous.'
      },
      {
        confidence: 'low',
        action: CONFIDENCE_ACTIONS.low,
        precedence: 4,
        kind: 'title_only',
        matchRule: 'Only normalized title matches, so rows remain separate until stronger evidence exists.'
      }
    ]
  };
}

function scoreRowForCanonicalSelection(row = {}) {
  const typeDetails = toPlainTypeDetails(row.type_details);
  const mediaType = String(row.media_type || '').trim();
  let score = 0;

  if (mediaType === 'book') {
    if (normalizeDigits(typeDetails.isbn || row.isbn || '')) score += 10;
    if (normalizeText(typeDetails.author || row.book_author || '')) score += 4;
    if (normalizeText(typeDetails.publisher || '')) score += 2;
  }

  if (mediaType === 'comic_book') {
    if (normalizeText(typeDetails.provider_name || '') && String(typeDetails.provider_item_id || '').trim()) score += 12;
    if (normalizeText(typeDetails.series || '')) score += 4;
    if (normalizeIssueToken(typeDetails.issue_number || '')) score += 3;
    if (normalizeText(typeDetails.volume || '')) score += 2;
  }

  if (String(typeDetails.provider_name || '').trim()) score += 2;
  if (String(row.import_source || '').trim()) score += 1;
  if (String(row.title || '').trim()) score += 1;

  return score;
}

function chooseCanonicalRow(rows = []) {
  const candidates = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (candidates.length === 0) return null;
  return candidates
    .map((row) => ({
      row,
      score: scoreRowForCanonicalSelection(row),
      id: Number(row.id || Number.MAX_SAFE_INTEGER)
    }))
    .sort((left, right) => right.score - left.score || left.id - right.id)[0]?.row || null;
}

function summarizeRepairTargetRow(row = {}) {
  const typeDetails = toPlainTypeDetails(row.type_details);
  return {
    id: Number(row.id || 0) || null,
    media_type: String(row.media_type || '').trim() || null,
    title: String(row.title || '').trim() || null,
    import_source: String(row.import_source || '').trim() || null,
    provider: String(typeDetails.provider_name || '').trim() || null,
    provider_item_id: String(typeDetails.provider_item_id || '').trim() || null,
    isbn: String(typeDetails.isbn || '').trim() || null,
    author: String(typeDetails.author || '').trim() || null,
    series: String(typeDetails.series || '').trim() || null,
    issue_number: String(typeDetails.issue_number || '').trim() || null,
    volume: String(typeDetails.volume || '').trim() || null
  };
}

function buildDuplicateRepairPlan(cluster = {}) {
  const rows = Array.isArray(cluster.rows) ? cluster.rows : [];
  if (rows.length < 2) return null;

  const canonical = chooseCanonicalRow(rows);
  if (!canonical) return null;

  const duplicates = rows
    .filter((row) => Number(row.id) !== Number(canonical.id))
    .sort((left, right) => Number(left.id || 0) - Number(right.id || 0));

  const confidence = String(cluster.confidence || '').trim() || 'unknown';
  const action = confidence === 'high'
    ? 'attach_duplicate_to_canonical'
    : 'review_duplicate_cluster';

  return {
    key: cluster.key || null,
    confidence,
    action,
    kind: cluster.kind || null,
    rationale: Array.isArray(cluster.rationale) ? cluster.rationale : [],
    canonical: summarizeRepairTargetRow(canonical),
    duplicates: duplicates.map(summarizeRepairTargetRow)
  };
}

function buildHistoricalRepairPlan({
  duplicateBookClusters = [],
  duplicateComicClusters = [],
  likelyComicLikeBooks = []
} = {}) {
  const highConfidenceDuplicates = [
    ...duplicateBookClusters,
    ...duplicateComicClusters
  ]
    .filter((cluster) => cluster?.confidence === 'high')
    .map(buildDuplicateRepairPlan)
    .filter(Boolean);

  const reviewDuplicateClusters = [
    ...duplicateBookClusters,
    ...duplicateComicClusters
  ]
    .filter((cluster) => cluster?.confidence === 'medium')
    .map(buildDuplicateRepairPlan)
    .filter(Boolean);

  const likelyTypeRepairs = (Array.isArray(likelyComicLikeBooks) ? likelyComicLikeBooks : [])
    .map((entry) => {
      const row = entry?.row || entry;
      const signal = entry?.signal || detectLikelyComicLikeBook(row);
      if (!signal?.likely) return null;
      return {
        action: 'review_reclassify_book_to_comic',
        confidence: 'review',
        reasons: Array.isArray(signal.reasons) ? signal.reasons : [],
        source: summarizeRepairTargetRow(row)
      };
    })
    .filter(Boolean);

  return {
    dryRun: true,
    summary: {
      safeAutoAttachDuplicateClusters: highConfidenceDuplicates.length,
      reviewDuplicateClusters: reviewDuplicateClusters.length,
      likelyTypeRepairs: likelyTypeRepairs.length
    },
    safeAutoAttachDuplicateClusters: highConfidenceDuplicates,
    reviewDuplicateClusters,
    likelyTypeRepairs
  };
}

module.exports = {
  CONFIDENCE_ACTIONS,
  normalizeText,
  normalizeDigits,
  normalizeIssueToken,
  buildBookNormalizationIdentity,
  buildComicNormalizationIdentity,
  detectLikelyComicLikeBook,
  scoreRowForCanonicalSelection,
  chooseCanonicalRow,
  buildDuplicateRepairPlan,
  buildHistoricalRepairPlan,
  groupRowsByNormalizationKey,
  splitClustersByConfidence,
  buildNormalizationMatchContract
};
