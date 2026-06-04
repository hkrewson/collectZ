const express = require('express');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const { resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const {
  buildMissingIdentifierReviewClues,
  buildMissingIdentifierReviewSql,
  buildSparseMetadataReviewClues,
  buildSparseMetadataReviewSql
} = require('../services/reviewClues');

const router = express.Router();

router.use('/review-queue', authenticateToken);
router.use('/review-queue', enforceScopeAccess({ allowedHintRoles: ['admin'] }));

const MISSING_COVER_SQL = `COALESCE(NULLIF(TRIM(m.poster_path), ''), NULL) IS NULL`;
const MISSING_IDENTIFIER_SQL = buildMissingIdentifierReviewSql('m');
const SPARSE_METADATA_SQL = buildSparseMetadataReviewSql('m');

function firstNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function toCount(value) {
  return Math.max(0, Math.trunc(firstNumber(value)));
}

function safeJson(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (_) {
      return fallback;
    }
  }
  return fallback;
}

function normalizeSource(value) {
  const normalized = String(value || 'all').trim().toLowerCase().replace(/-/g, '_');
  return ['all', 'library', 'capture', 'wishlist', 'plex', 'sync'].includes(normalized) ? normalized : 'all';
}

function normalizeType(value) {
  const normalized = String(value || 'all').trim().toLowerCase().replace(/-/g, '_');
  return [
    'all',
    'missing_cover',
    'missing_identifier',
    'sparse_metadata',
    'capture_choice',
    'capture_ready',
    'capture_problem',
    'price_hit',
    'plex_conflict',
    'failed_sync'
  ].includes(normalized) ? normalized : 'all';
}

function normalizeSearch(value) {
  const trimmed = String(value || '').trim();
  return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed;
}

function normalizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function formatDate(value) {
  return value || null;
}

function mediaTypeLabel(value) {
  const normalized = String(value || '').trim();
  if (normalized === 'comic_book') return 'Comic';
  if (normalized === 'tv_series' || normalized === 'tv') return 'TV';
  if (normalized === 'movie') return 'Movie';
  if (normalized === 'book') return 'Book';
  if (normalized === 'audio') return 'Audio';
  if (normalized === 'game') return 'Game';
  return normalized || 'Item';
}

function mediaMeta(row = {}) {
  const details = safeJson(row.type_details);
  return [
    mediaTypeLabel(row.media_type),
    row.year,
    row.format,
    details.series || details.collection_title,
    details.issue_number ? `#${details.issue_number}` : null,
    details.author,
    details.provider_name || row.import_source
  ].filter(Boolean).join(' · ');
}

function clueText(clues = {}) {
  const reasons = Array.isArray(clues.review_reasons) ? clues.review_reasons.filter(Boolean) : [];
  const identifiers = Array.isArray(clues.recommended_identifiers) ? clues.recommended_identifiers.filter(Boolean) : [];
  const metadata = Array.isArray(clues.recommended_metadata) ? clues.recommended_metadata.filter(Boolean) : [];
  const recommendation = identifiers.length
    ? `Add ${identifiers.join(' or ')}`
    : metadata.length
      ? `Add ${metadata.join(', ')}`
      : '';
  return [reasons[0], recommendation].filter(Boolean).join('. ');
}

function shapeMediaItem(row, findingType) {
  const clues = findingType === 'missing_identifier'
    ? buildMissingIdentifierReviewClues(row)
    : findingType === 'sparse_metadata'
      ? buildSparseMetadataReviewClues(row)
      : {};
  const labels = {
    missing_cover: 'Missing cover',
    missing_identifier: 'Missing identifier',
    sparse_metadata: 'Sparse metadata'
  };
  const actions = {
    missing_cover: { label: 'Open missing covers', target_tab: 'library', review_filter: 'missing_covers' },
    missing_identifier: { label: 'Open missing identifiers', target_tab: 'library', review_filter: 'missing_identifiers' },
    sparse_metadata: { label: 'Open sparse metadata', target_tab: 'library', review_filter: 'sparse_metadata' }
  };
  return {
    id: `media:${findingType}:${row.id}`,
    source: 'library',
    source_label: 'Library',
    type: findingType,
    label: labels[findingType] || 'Library review',
    status: 'open',
    severity: findingType === 'missing_cover' ? 'info' : 'attention',
    title: row.title || 'Untitled',
    summary: mediaMeta(row),
    reason: findingType === 'missing_cover' ? 'No cover or poster image is attached.' : clueText(clues),
    confidence: null,
    object: { type: 'media', id: Number(row.id), media_type: row.media_type || null },
    action: actions[findingType],
    audit: null,
    created_at: formatDate(row.created_at),
    updated_at: formatDate(row.updated_at),
    review_reasons: clues.review_reasons || [],
    recommended_identifiers: clues.recommended_identifiers || [],
    recommended_metadata: clues.recommended_metadata || []
  };
}

function captureLookupMatchCountSql() {
  return `jsonb_array_length(COALESCE(review_decision->'capture_lookup_matches', '[]'::jsonb))`;
}

function ocrCandidateCountSql() {
  return `jsonb_array_length(COALESCE(review_decision->'ocr_candidates', '[]'::jsonb))`;
}

function captureLookupProviderErrorSql() {
  return `NULLIF(review_decision->'capture_lookup_status'->>'provider_error', '') IS NOT NULL`;
}

function captureReviewCondition() {
  const lookupMatches = captureLookupMatchCountSql();
  const ocrCandidates = ocrCandidateCountSql();
  const activeStatus = "status NOT IN ('converted', 'discarded')";
  const hasLookupStatus = "review_decision ? 'capture_lookup_status'";
  const providerError = captureLookupProviderErrorSql();
  const lookupCount = `COALESCE(NULLIF(review_decision->'capture_lookup_status'->>'match_count', '')::int, ${lookupMatches})`;
  const missingDetails = `(
    NULLIF(title, '') IS NULL
    OR (capture_type IN ('barcode', 'ocr_text') AND NULLIF(barcode, '') IS NULL AND NULLIF(ocr_text, '') IS NULL)
    OR (capture_type = 'photo' AND NULLIF(image_path, '') IS NULL)
  )`;
  return `(
    ${activeStatus}
    AND (
      ${lookupMatches} > 1
      OR ${ocrCandidates} > 1
      OR (${hasLookupStatus} AND ${lookupCount} = 0 AND NOT (${providerError}))
      OR ${lookupMatches} = 1
      OR ${providerError}
      OR ${missingDetails}
    )
  )`;
}

function captureType(row = {}) {
  const reviewDecision = safeJson(row.review_decision);
  const lookupMatches = Array.isArray(reviewDecision.capture_lookup_matches) ? reviewDecision.capture_lookup_matches.length : 0;
  const ocrCandidates = Array.isArray(reviewDecision.ocr_candidates) ? reviewDecision.ocr_candidates.length : 0;
  const lookupStatus = safeJson(reviewDecision.capture_lookup_status);
  const providerError = String(lookupStatus.provider_error || '').trim();
  const matchCount = Number.isFinite(Number(lookupStatus.match_count)) ? Number(lookupStatus.match_count) : lookupMatches;
  if (providerError) return 'capture_problem';
  if (lookupMatches > 1 || ocrCandidates > 1) return 'capture_choice';
  if (Object.keys(lookupStatus).length > 0 && matchCount === 0) return 'capture_problem';
  if (lookupMatches === 1) return 'capture_ready';
  return 'capture_problem';
}

function shapeCaptureItem(row = {}) {
  const reviewDecision = safeJson(row.review_decision);
  const type = captureType(row);
  const labels = {
    capture_choice: 'Capture needs choice',
    capture_ready: 'Capture ready',
    capture_problem: 'Capture needs attention'
  };
  const lookupMatches = Array.isArray(reviewDecision.capture_lookup_matches) ? reviewDecision.capture_lookup_matches.length : 0;
  const ocrCandidates = Array.isArray(reviewDecision.ocr_candidates) ? reviewDecision.ocr_candidates.length : 0;
  const lookupStatus = safeJson(reviewDecision.capture_lookup_status);
  const reason = lookupMatches > 1
    ? `${lookupMatches} lookup candidates need a selection.`
    : ocrCandidates > 1
      ? `${ocrCandidates} OCR candidates need a selection.`
      : lookupMatches === 1
        ? 'One candidate is ready to import.'
        : lookupStatus.provider_error
          ? `Lookup problem: ${lookupStatus.provider_error}`
          : 'Capture needs more detail before it can be resolved.';
  return {
    id: `capture:${row.id}`,
    source: 'capture',
    source_label: 'Capture Inbox',
    type,
    label: labels[type],
    status: 'open',
    severity: type === 'capture_ready' ? 'ok' : 'attention',
    title: row.title || row.barcode || row.ocr_text || `Capture #${row.id}`,
    summary: [row.capture_type, row.object_type, row.barcode].filter(Boolean).join(' · '),
    reason,
    confidence: null,
    object: { type: 'capture_item', id: Number(row.id), object_type: row.object_type || null },
    action: { label: 'Open Capture Inbox', target_tab: 'library-capture' },
    audit: null,
    created_at: formatDate(row.created_at),
    updated_at: formatDate(row.updated_at)
  };
}

function shapeWishlistHit(row = {}) {
  const currentPrice = row.current_price !== null && row.current_price !== undefined ? Number(row.current_price) : null;
  const targetPrice = row.target_price !== null && row.target_price !== undefined ? Number(row.target_price) : null;
  const currency = row.currency || safeJson(row.source_context).currency || null;
  return {
    id: `wishlist:price_hit:${row.id}`,
    source: 'wishlist',
    source_label: 'Wishlist',
    type: 'price_hit',
    label: 'Target price hit',
    status: 'open',
    severity: 'ok',
    title: row.title || 'Wishlist item',
    summary: [row.object_type, row.format, row.provider].filter(Boolean).join(' · '),
    reason: currentPrice !== null && targetPrice !== null
      ? `Current price ${currentPrice.toFixed(2)}${currency ? ` ${currency}` : ''} is at or below target ${targetPrice.toFixed(2)}.`
      : 'Current price is at or below the saved target.',
    confidence: null,
    object: { type: 'wanted_item', id: Number(row.id) },
    action: { label: 'Open Wishlist', target_tab: 'library-wishlist' },
    audit: { checked_at: row.checked_at || null },
    created_at: formatDate(row.created_at),
    updated_at: formatDate(row.updated_at)
  };
}

function shapePlexConflict(row = {}) {
  const item = safeJson(row.item_snapshot);
  const existing = safeJson(row.existing_snapshot);
  return {
    id: `plex:conflict:${row.id}`,
    source: 'plex',
    source_label: 'Plex',
    type: 'plex_conflict',
    label: 'Plex conflict',
    status: row.status || 'open',
    severity: 'warning',
    title: item.title || existing.title || `Plex conflict #${row.id}`,
    summary: [item.media_type || existing.media_type, item.year || existing.year, row.matched_by].filter(Boolean).join(' · '),
    reason: row.reason || 'Plex reconciliation needs a decision.',
    confidence: null,
    object: { type: 'plex_reconciliation_review', id: Number(row.id), media_id: row.existing_media_id ? Number(row.existing_media_id) : null },
    action: { label: 'Open Plex conflicts', target_tab: 'admin-integrations', target_section: 'plex' },
    audit: { job_id: row.job_id ? Number(row.job_id) : null },
    created_at: formatDate(row.created_at),
    updated_at: formatDate(row.updated_at)
  };
}

function shapeFailedSync(row = {}) {
  return {
    id: `sync:failed:${row.id}`,
    source: 'sync',
    source_label: 'Syncs',
    type: 'failed_sync',
    label: 'Failed sync',
    status: 'open',
    severity: 'danger',
    title: row.provider || row.job_type || `Sync job #${row.id}`,
    summary: [row.job_type, row.status].filter(Boolean).join(' · '),
    reason: row.error || safeJson(row.summary).message || 'Sync failed without a detailed error.',
    confidence: null,
    object: { type: 'sync_job', id: Number(row.id) },
    action: { label: 'Open Import', target_tab: 'library-import' },
    audit: { summary: safeJson(row.summary) },
    created_at: formatDate(row.created_at),
    updated_at: formatDate(row.updated_at)
  };
}

function sourceMatches(item, source) {
  return source === 'all' || item.source === source;
}

function typeMatches(item, type) {
  return type === 'all' || item.type === type;
}

function searchMatches(item, search) {
  if (!search) return true;
  const haystack = [item.title, item.summary, item.reason, item.source_label, item.label].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(search.toLowerCase());
}

function addCount(counts, source, type, count) {
  const normalized = toCount(count);
  counts.total += normalized;
  counts.by_source[source] = (counts.by_source[source] || 0) + normalized;
  counts.by_type[type] = (counts.by_type[type] || 0) + normalized;
}

function buildSyncScopeClause(params, scopeContext) {
  const conditions = [];
  if (scopeContext?.spaceId !== null && scopeContext?.spaceId !== undefined) {
    params.push(String(scopeContext.spaceId));
    conditions.push(`(scope->>'spaceId') = $${params.length}`);
  }
  if (scopeContext?.libraryId !== null && scopeContext?.libraryId !== undefined) {
    params.push(String(scopeContext.libraryId));
    conditions.push(`(scope->>'libraryId') = $${params.length}`);
  }
  return conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
}

router.get('/review-queue', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const source = normalizeSource(req.query.source);
  const type = normalizeType(req.query.type);
  const search = normalizeSearch(req.query.search);
  const limit = normalizeLimit(req.query.limit);
  const isAdmin = String(req.user?.role || '') === 'admin';

  const mediaParams = [];
  const mediaScopeClause = appendScopeSql(mediaParams, scopeContext, {
    spaceColumn: 'm.space_id',
    libraryColumn: 'm.library_id'
  });
  const captureParams = [];
  const captureScopeClause = appendScopeSql(captureParams, scopeContext);
  const wishlistParams = ['apple_itunes'];
  let wishlistWhere = `
    WHERE wi.provider = $1
      AND wi.provider_key IS NOT NULL
      AND wi.target_price IS NOT NULL
      AND COALESCE(latest.price, NULLIF(wi.source_context->>'current_price', '')::numeric) IS NOT NULL
      AND COALESCE(latest.price, NULLIF(wi.source_context->>'current_price', '')::numeric) <= wi.target_price
      AND wi.status = ANY($2)
  `;
  wishlistParams.push(['wanted', 'watching', 'preordered']);
  wishlistWhere += appendScopeSql(wishlistParams, scopeContext, { spaceColumn: 'wi.space_id', libraryColumn: 'wi.library_id' });
  const plexParams = [];
  const plexScopeClause = appendScopeSql(plexParams, scopeContext, { spaceColumn: 'space_id', libraryColumn: 'library_id' });
  const syncParams = [];
  const syncScopeClause = buildSyncScopeClause(syncParams, scopeContext);

  const [
    mediaCounts,
    missingCovers,
    missingIdentifiers,
    sparseMetadata,
    captureCounts,
    captureItems,
    wishlistHits,
    plexCounts,
    plexConflicts,
    failedSyncs
  ] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE ${MISSING_COVER_SQL})::int AS missing_cover,
         COUNT(*) FILTER (WHERE ${MISSING_IDENTIFIER_SQL})::int AS missing_identifier,
         COUNT(*) FILTER (WHERE ${SPARSE_METADATA_SQL})::int AS sparse_metadata
       FROM media m
       WHERE 1=1${mediaScopeClause}`,
      mediaParams
    ),
    pool.query(
      `SELECT m.id, m.title, m.media_type, m.year, m.format, m.poster_path, m.type_details, m.import_source, m.owned_formats, m.updated_at, m.created_at
       FROM media m
       WHERE ${MISSING_COVER_SQL}${mediaScopeClause}
       ORDER BY m.updated_at DESC NULLS LAST, m.id DESC
       LIMIT 20`,
      mediaParams
    ),
    pool.query(
      `SELECT m.id, m.title, m.media_type, m.year, m.format, m.poster_path, m.upc, m.tmdb_id, m.type_details, m.import_source, m.owned_formats, m.updated_at, m.created_at
       FROM media m
       WHERE ${MISSING_IDENTIFIER_SQL}${mediaScopeClause}
       ORDER BY m.updated_at DESC NULLS LAST, m.id DESC
       LIMIT 20`,
      mediaParams
    ),
    pool.query(
      `SELECT m.id, m.title, m.media_type, m.year, m.format, m.poster_path, m.upc, m.tmdb_id, m.type_details, m.import_source, m.owned_formats, m.updated_at, m.created_at
       FROM media m
       WHERE ${SPARSE_METADATA_SQL}${mediaScopeClause}
       ORDER BY m.updated_at DESC NULLS LAST, m.id DESC
       LIMIT 20`,
      mediaParams
    ),
    pool.query(
      `SELECT COUNT(*)::int AS reviewable
       FROM capture_items
       WHERE ${captureReviewCondition()}${captureScopeClause}`,
      captureParams
    ),
    pool.query(
      `SELECT id, title, capture_type, status, object_type, barcode, symbology, ocr_text, notes, image_path, review_decision, source_context, updated_at, created_at
       FROM capture_items
       WHERE ${captureReviewCondition()}${captureScopeClause}
       ORDER BY updated_at DESC, id DESC
       LIMIT 20`,
      captureParams
    ),
    pool.query(
      `SELECT wi.*,
              COALESCE(latest.price, NULLIF(wi.source_context->>'current_price', '')::numeric) AS current_price,
              COALESCE(latest.currency, wi.source_context->>'currency') AS currency,
              latest.checked_at
         FROM wanted_items wi
         LEFT JOIN LATERAL (
           SELECT price, currency, checked_at
             FROM wanted_item_price_history
            WHERE wanted_item_id = wi.id
            ORDER BY checked_at DESC, id DESC
            LIMIT 1
         ) latest ON TRUE
        ${wishlistWhere}
        ORDER BY COALESCE(latest.checked_at, wi.updated_at) DESC, wi.id DESC
        LIMIT 20`,
      wishlistParams
    ),
    isAdmin
      ? pool.query(
        `SELECT COUNT(*)::int AS open_count
         FROM plex_reconciliation_reviews
         WHERE status = 'open'${plexScopeClause}`,
        plexParams
      )
      : Promise.resolve({ rows: [{ open_count: 0 }] }),
    isAdmin
      ? pool.query(
        `SELECT id, provider, source_key, status, resolution, reason, matched_by,
                item_snapshot, existing_snapshot, job_id, existing_media_id, resolved_media_id,
                library_id, space_id, notes, created_at, updated_at, resolved_at
           FROM plex_reconciliation_reviews
           WHERE status = 'open'${plexScopeClause}
           ORDER BY updated_at DESC, created_at DESC
           LIMIT 20`,
        plexParams
      )
      : Promise.resolve({ rows: [] }),
    pool.query(
      `SELECT id, job_type, provider, status, error, summary, updated_at, created_at
       FROM sync_jobs
       WHERE status = 'failed'${syncScopeClause}
       ORDER BY updated_at DESC, id DESC
       LIMIT 20`,
      syncParams
    )
  ]);

  const mediaCountRow = mediaCounts.rows[0] || {};
  const counts = { total: 0, by_source: {}, by_type: {} };
  addCount(counts, 'library', 'missing_cover', mediaCountRow.missing_cover);
  addCount(counts, 'library', 'missing_identifier', mediaCountRow.missing_identifier);
  addCount(counts, 'library', 'sparse_metadata', mediaCountRow.sparse_metadata);
  addCount(counts, 'capture', 'capture_choice', captureCounts.rows[0]?.reviewable);
  addCount(counts, 'wishlist', 'price_hit', wishlistHits.rows.length);
  addCount(counts, 'plex', 'plex_conflict', plexCounts.rows[0]?.open_count);
  addCount(counts, 'sync', 'failed_sync', failedSyncs.rows.length);

  const allItems = [
    ...missingCovers.rows.map((row) => shapeMediaItem(row, 'missing_cover')),
    ...missingIdentifiers.rows.map((row) => shapeMediaItem(row, 'missing_identifier')),
    ...sparseMetadata.rows.map((row) => shapeMediaItem(row, 'sparse_metadata')),
    ...captureItems.rows.map(shapeCaptureItem),
    ...wishlistHits.rows.map(shapeWishlistHit),
    ...plexConflicts.rows.map(shapePlexConflict),
    ...failedSyncs.rows.map(shapeFailedSync)
  ];

  const filteredItems = allItems
    .filter((item) => sourceMatches(item, source))
    .filter((item) => typeMatches(item, type))
    .filter((item) => searchMatches(item, search))
    .sort((left, right) => new Date(right.updated_at || right.created_at || 0) - new Date(left.updated_at || left.created_at || 0))
    .slice(0, limit);

  res.json({
    ok: true,
    generated_at: new Date().toISOString(),
    filters: { source, type, search, limit },
    counts,
    items: filteredItems
  });
}));

module.exports = router;
