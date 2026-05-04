const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken, requireRole, requireSessionAuth } = require('../middleware/auth');
const {
  validate,
  mediaCreateSchema,
  mediaUpdateSchema,
  mediaLoanCreateSchema,
  mediaLoanUpdateSchema,
  mediaLoanReturnSchema,
  mediaLoanReminderSendSchema,
  mediaValuationRefreshSchema,
  mediaMergePreviewSchema,
  mediaMergeApplySchema,
  mediaMergeRevertSchema,
  collectionMergeApplySchema,
  collectionMergeRevertSchema,
  MANUAL_MERGE_REJECTION_REASON_CODES,
  mediaMergeRecommendationRejectSchema,
  mediaMergeRecommendationDeferSchema,
  mediaMergeRecommendationRestoreSchema,
  simpleSearchSchema,
  titleAuthorSearchSchema,
  titleArtistSearchSchema,
  upcLookupSchema,
  signatureRecordCreateSchema,
  signatureRecordUpdateSchema
} = require('../middleware/validate');
const { loadAdminIntegrationConfig, loadScopedIntegrationConfig } = require('../services/integrations');
const {
  searchTmdbMovie,
  searchTmdbMulti,
  fetchTmdbMovieDetails,
  fetchTmdbTvShowSeasonSummary,
  fetchTmdbTvSeasonDetails
} = require('../services/tmdb');
const { normalizeBarcodeMatches } = require('../services/barcode');
const { fetchPlexLibraryItems, fetchPlexShowSeasons, fetchPlexShowSeasonVariants, fetchPlexSeasonEpisodeStates } = require('../services/plex');
const { searchBooksByTitle, searchBooksByIsbn } = require('../services/books');
const { searchAudioByTitle } = require('../services/audio');
const { searchGamesByTitle } = require('../services/games');
const { searchComicsByTitle, fetchMetronCollectionIssues, fetchMetronIssueDetails, pushMetronCollectionIssue } = require('../services/comics');
const { parseCsvText } = require('../services/csv');
const { fetchCwaOpdsItems } = require('../services/cwa');
const { fetchKavitaImportItems } = require('../services/kavita');
const { mapDeliciousItemTypeToMediaType } = require('../services/importMapping');
const { normalizeDeliciousRow } = require('../services/deliciousNormalize');
const { normalizeIdentifierSet, normalizeIsbn } = require('../services/importIdentifiers');
const { syncNormalizedMetadataForMedia } = require('../services/mediaTaxonomy');
const { normalizeTypeDetails } = require('../services/typeDetails');
const {
  buildBookNormalizationIdentity,
  buildComicNormalizationIdentity,
  CANONICAL_SELECTION_REASON,
  chooseCanonicalRow,
  normalizeDigits,
  normalizeText,
  normalizeIssueToken
} = require('../services/bookComicNormalization');
const {
  assessMovieDiscoveryConflictReasons,
  buildGenericManualMergeIdentity,
  isStructuredTitlePairUnsafeForSharedCoverDiscovery,
  normalizeMovieDiscoveryTitle
} = require('../services/manualMergeRecommendations');
const {
  buildMediaIdentityAliasKey
} = require('../services/mediaIdentityAliases');
const {
  ALL_DISPLAY_FORMAT_LABELS,
  getOwnedFormatOptions,
  getOwnedFormatLabel,
  normalizeOwnedFormatValue,
  normalizeOwnedFormats,
  sortOwnedFormats,
  derivePrimaryFormat,
  buildOwnedFormatsPayload,
  buildMergedOwnedFormatsPayload
} = require('../services/mediaFormats');
const { formatSyncJob } = require('../services/syncJobs');
const { logError, logActivity } = require('../services/audit');
const { recordImportJobEvent, recordImportEnrichmentEvent } = require('../services/metrics');
const { uploadBuffer } = require('../services/storage');
const {
  loadSignatureRecordsForOwner,
  createSignatureRecord,
  updateSignatureRecord,
  updateSignatureProofPath,
  addSignatureProof,
  updateSignatureProofMetadata,
  archiveSignatureProof,
  archiveSignatureRecord,
  setPrimarySignatureRecord,
  syncPrimarySignatureRecord,
  buildLegacyMediaSignature
} = require('../services/signatures');
const { resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const { isFeatureEnabledForSpace } = require('../services/featureFlags');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const { ensureUserDefaultLibrary, ensureUserDefaultScope } = require('../services/libraries');
const { refreshMediaValuation } = require('../services/valuations');
const {
  normalizeLoanDateValue,
  buildLoanReminderPhase,
  wasLoanReminderSentToday,
  formatMediaLoanRow,
  sendReminderForLoanRow,
  runAutomaticLoanReminderSweep
} = require('../services/loanReminders');
const { runManualMediaMergeApply, runManualMediaMergeRevert } = require('../scripts/repair-book-comic-duplicates');

const router = express.Router();

const ALLOWED_COVER_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function sanitizeUploadFilename(originalName = '') {
  const base = path.basename(String(originalName || '').trim());
  if (!base) return 'upload.bin';
  const sanitized = base.replace(/[^A-Za-z0-9._-]/g, '_');
  return sanitized.slice(-120) || 'upload.bin';
}

const imageFileFilter = (_req, file, cb) => {
  const mimeType = String(file?.mimetype || '').toLowerCase();
  if (!ALLOWED_COVER_MIME_TYPES.has(mimeType)) {
    const error = new multer.MulterError('LIMIT_UNEXPECTED_FILE', file?.fieldname || 'file');
    error.message = 'Unsupported file type. Allowed: JPEG, PNG, WEBP, GIF.';
    return cb(error);
  }
  return cb(null, true);
};

const tempDiskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, 'uploads/'),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${sanitizeUploadFilename(file.originalname)}`)
});
const tempUpload = multer({ storage: tempDiskStorage, limits: { fileSize: 10 * 1024 * 1024 } });
const memoryImageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: imageFileFilter });

const MEDIA_TYPES = ['movie', 'tv_series', 'tv_episode', 'book', 'audio', 'game', 'comic_book'];
const MERGE_REVIEW_MEDIA_TYPES = new Set(['movie', 'tv_series', 'book', 'audio', 'game', 'comic_book']);
const TV_WATCH_STATES = new Set(['unwatched', 'in_progress', 'completed']);
const SYNC_JOB_ALLOWED_FIELDS = new Set([
  'status',
  'scope',
  'progress',
  'summary',
  'error',
  'started_at',
  'finished_at'
]);
const SORT_COLUMNS = {
  title: 'title',
  year: 'year',
  format: 'format',
  created_at: 'created_at',
  user_rating: 'user_rating',
  rating: 'rating',
  comic_issue: 'comic_issue'
};
const IMPORT_MATCH_MODES = [
  'matched_by_identifier',
  'matched_by_normalization_high',
  'normalization_review_medium',
  'identifier_no_match_fallback_title',
  'fallback_title_only',
  'identifier_conflict'
];
const IMPORT_ENRICHMENT_STATUSES = [
  'enriched',
  'no_match',
  'not_attempted',
  'not_applicable'
];
const IMPORT_AUDIT_OUTCOMES = [
  'new_created',
  'review_candidate_created',
  'duplicate_exact',
  'near_match_update',
  'created_debug_flagged',
  'skipped_invalid',
  'error',
  'collection_only'
];
const GAME_UPC_FIRST_ENABLED = String(process.env.GAME_UPC_FIRST || 'false').trim().toLowerCase() === 'true';
const PLAYWRIGHT_E2E_BYPASS_TOKEN = String(process.env.PLAYWRIGHT_E2E_BYPASS_TOKEN || '').trim();

function requestHasPlaywrightBypass(req) {
  if (!PLAYWRIGHT_E2E_BYPASS_TOKEN) return false;
  return (
    String(req.headers['x-playwright-e2e-bypass'] || '').trim() === PLAYWRIGHT_E2E_BYPASS_TOKEN
    || String(req.cookies?.playwright_e2e_bypass || '').trim() === PLAYWRIGHT_E2E_BYPASS_TOKEN
  );
}

const parsePlexRatingKeyFromItemKey = (itemKey) => {
  const raw = String(itemKey || '').trim();
  if (!raw) return null;
  const parts = raw.split(':').map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || '';
  if (/^\d+$/.test(last)) return last;
  const match = raw.match(/\/library\/metadata\/(\d+)/i);
  return match?.[1] || null;
};
const DEBUG_LEVEL = Math.max(0, Math.min(2, Number(process.env.DEBUG || 0) || 0));
const isDebugAt = (level) => DEBUG_LEVEL >= level;

function buildImportMatchCounters() {
  return IMPORT_MATCH_MODES.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function incrementImportMatchCounter(counters, mode) {
  if (!counters || !mode || !Object.prototype.hasOwnProperty.call(counters, mode)) return;
  counters[mode] += 1;
}

function buildImportEnrichmentCounters() {
  return IMPORT_ENRICHMENT_STATUSES.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function incrementImportEnrichmentCounter(counters, status) {
  if (!counters || !status || !Object.prototype.hasOwnProperty.call(counters, status)) return;
  counters[status] += 1;
}

function recordImportEnrichmentSummaryMetrics(provider, summary = null) {
  if (!summary || typeof summary !== 'object') return;
  for (const [outcome, count] of Object.entries(summary)) {
    const amount = Number(count || 0);
    if (amount > 0) recordImportEnrichmentEvent(provider, 'pipeline', outcome, amount);
  }
}

function recordPlexEnrichmentMetrics(result = null) {
  if (!result || typeof result !== 'object') return;
  const summary = result.summary || {};
  const posterEnriched = Number(result.tmdbPosterEnriched || 0);
  const posterNoMatch = Number(result.tmdbPosterLookupNoMatch || 0);
  const posterNoImage = Number(result.tmdbPosterLookupNoImage || 0);
  const seasonMisses = Number((summary.enrichmentMisses || []).length || 0);
  const seasonErrors = Number((summary.enrichmentErrors || []).length || 0);
  if (posterEnriched > 0) recordImportEnrichmentEvent('plex', 'tmdb_poster', 'enriched', posterEnriched);
  if (posterNoMatch > 0) recordImportEnrichmentEvent('plex', 'tmdb_poster', 'no_match', posterNoMatch);
  if (posterNoImage > 0) recordImportEnrichmentEvent('plex', 'tmdb_poster', 'no_image', posterNoImage);
  if (seasonMisses > 0) recordImportEnrichmentEvent('plex', 'tmdb_season_summary', 'miss', seasonMisses);
  if (seasonErrors > 0) recordImportEnrichmentEvent('plex', 'tmdb_season_summary', 'error', seasonErrors);
}

function normalizeMergeReviewMediaTypeFilter(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'all') return null;
  return MERGE_REVIEW_MEDIA_TYPES.has(normalized) ? normalized : null;
}

function normalizeRecommendationFeedbackOutcomeFilter(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'all') return null;
  return ['rejected', 'deferred'].includes(normalized) ? normalized : null;
}

function buildImportAuditOutcomeCounters() {
  return IMPORT_AUDIT_OUTCOMES.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function incrementImportAuditOutcomeCounter(counters, outcome) {
  if (!counters || !outcome || !Object.prototype.hasOwnProperty.call(counters, outcome)) return;
  counters[outcome] += 1;
}

function resolveImportDecisionProfile({ mediaType, importSource }) {
  const normalizedMediaType = normalizeMediaType(mediaType || 'movie', 'movie');
  const normalizedSource = String(importSource || '').trim().toLowerCase();
  const isDelicious = normalizedSource === 'csv_delicious';
  return {
    mediaType: normalizedMediaType,
    importSource: normalizedSource,
    scoreBase: isDelicious ? 68 : 70,
    fallbackTitleWindow: normalizedMediaType === 'game' ? { min: 50, max: 68 } : { min: 45, max: 70 },
    identifierFallbackWindow: normalizedMediaType === 'game' ? { min: 55, max: 73 } : { min: 50, max: 75 },
    defaultWindow: normalizedMediaType === 'game' ? { min: 42, max: 63 } : { min: 40, max: 65 }
  };
}

function deriveImportConfidenceScore({
  matchMode,
  matchedBy,
  enrichmentStatus,
  mediaType,
  importSource,
  lookupStatus = ''
}) {
  const profile = resolveImportDecisionProfile({ mediaType, importSource });
  let score = profile.scoreBase;
  if (matchMode === 'matched_by_identifier') score += 25;
  if (matchMode === 'matched_by_normalization_high') score += 18;
  if (matchMode === 'normalization_review_medium') score += 6;
  if (matchMode === 'identifier_conflict') score -= 35;
  if (matchMode === 'strong_identifier_conflict_guarded') score -= 32;
  if (matchMode === 'identifier_no_match_fallback_title') score -= 15;
  if (matchMode === 'fallback_title_only') score -= 20;

  if (matchedBy === 'title_year_media_type') score -= 10;
  if (String(matchedBy || '').startsWith('provider_')) score += 8;

  if (enrichmentStatus === 'enriched') score += 8;
  if (enrichmentStatus === 'no_match') score -= 12;
  if (enrichmentStatus === 'not_attempted') score -= 6;

  if (profile.mediaType === 'game' && matchMode === 'identifier_no_match_fallback_title') {
    score -= 4;
  }
  if (profile.mediaType === 'movie' && enrichmentStatus === 'enriched') {
    score += 2;
  }
  if (String(lookupStatus || '').includes('tmdb:no_hit') || String(lookupStatus || '').includes('igdb:no_hit')) {
    score -= 3;
  }

  return Math.max(0, Math.min(100, score));
}

function shouldFlagImportDiagnostic({
  matchMode,
  enrichmentStatus,
  confidenceScore,
  upsertStatus,
  mediaType,
  importSource
}) {
  const profile = resolveImportDecisionProfile({ mediaType, importSource });
  const score = Number.isFinite(Number(confidenceScore)) ? Number(confidenceScore) : 0;
  const noMatch = enrichmentStatus === 'no_match';
  if (matchMode === 'identifier_conflict') return true;
  if (matchMode === 'strong_identifier_conflict_guarded') return true;
  // If a row already created/updated a media record successfully,
  // review queue provides no operator value; keep this in CSV audit only.
  if (upsertStatus === 'created' || upsertStatus === 'updated') return false;
  // Queue only genuinely actionable/ambiguous rows.
  // Low-confidence no-match rows should stay in audit export, not the review queue.
  if (matchMode === 'fallback_title_only') {
    if (noMatch) return false;
    return score >= profile.fallbackTitleWindow.min && score < profile.fallbackTitleWindow.max;
  }
  if (matchMode === 'identifier_no_match_fallback_title') {
    if (noMatch) return false;
    return score >= profile.identifierFallbackWindow.min && score < profile.identifierFallbackWindow.max;
  }
  if (noMatch) return false;
  return score >= profile.defaultWindow.min && score < profile.defaultWindow.max;
}

function deriveImportAuditOutcome({
  upsertStatus,
  matchedBy,
  matchMode,
  diagnosticFlagged
}) {
  if (upsertStatus === 'created') {
    if (matchMode === 'normalization_review_medium') {
      return 'review_candidate_created';
    }
    return diagnosticFlagged ? 'created_debug_flagged' : 'new_created';
  }
  if (upsertStatus === 'updated') {
    const matched = String(matchedBy || '');
    if (
      matchMode === 'matched_by_identifier'
      || matchMode === 'matched_by_normalization_high'
      || matchMode === 'identifier_conflict'
      || matched.startsWith('identifier_')
      || matched.startsWith('provider_')
    ) {
      return 'duplicate_exact';
    }
    return 'near_match_update';
  }
  if (upsertStatus === 'skipped_collection') return 'collection_only';
  if (upsertStatus === 'error') return 'error';
  return 'skipped_invalid';
}

function deriveImportAuditClassificationDetail({
  upsertStatus,
  matchMode,
  matchedBy,
  enrichmentStatus,
  lookupPath,
  mediaType,
  importSource
}) {
  const type = normalizeMediaType(mediaType || 'movie', 'movie');
  const source = String(importSource || '').trim().toLowerCase() || 'unknown';
  const matched = String(matchedBy || '').trim().toLowerCase();
  const mode = String(matchMode || '').trim().toLowerCase();
  const lookup = String(lookupPath || 'none').trim() || 'none';
  const enrichment = String(enrichmentStatus || 'not_attempted').trim().toLowerCase();
  return [
    `source=${source}`,
    `type=${type}`,
    `upsert=${upsertStatus || 'unknown'}`,
    `mode=${mode || 'none'}`,
    `match=${matched || 'none'}`,
    `enrichment=${enrichment}`,
    `lookup=${lookup}`
  ].join('|');
}

function normalizeMediaType(input, fallback = 'movie') {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (
    raw === 'tv'
    || raw === 'show'
    || raw === 'series'
    || raw === 'tv_show'
    || raw === 'tvseries'
    || raw === 'tv_series'
    || raw === 'tv-series'
  ) return 'tv_series';
  if (raw === 'tv_episode' || raw === 'episode') return 'tv_episode';
  if (raw === 'movie' || raw === 'film') return 'movie';
  if (raw === 'book' || raw === 'books') return 'book';
  if (raw === 'comic' || raw === 'comics' || raw === 'comic_book' || raw === 'comic-book') return 'comic_book';
  if (raw === 'audio' || raw === 'music' || raw === 'album' || raw === 'cd' || raw === 'vinyl' || raw === 'lp') return 'audio';
  if (raw === 'game' || raw === 'games' || raw === 'video_game' || raw === 'videogame') return 'game';
  if (raw === 'other') return 'comic_book';
  return fallback;
}

function normalizeStrongIdentifierValue(value) {
  return String(value || '').trim();
}

function normalizeStrongIsbnValue(value) {
  return String(value || '').replace(/\D+/g, '').trim();
}

function getCandidateStrongIdentifiers(candidateRow = {}) {
  const typeDetails = candidateRow?.type_details && typeof candidateRow.type_details === 'object'
    ? candidateRow.type_details
    : {};
  return {
    isbn: normalizeStrongIsbnValue(typeDetails.isbn || ''),
    eanUpc: normalizeStrongIdentifierValue(candidateRow.upc || ''),
    tmdbId: normalizeStrongIdentifierValue(candidateRow.tmdb_id || ''),
    providerItemId: normalizeStrongIdentifierValue(typeDetails.provider_item_id || typeDetails.calibre_entry_id || ''),
    providerIssueId: normalizeStrongIdentifierValue(typeDetails.provider_issue_id || '')
  };
}

function getIncomingStrongIdentifiers({ item = {}, normalizedTypeDetails = {}, resolvedIdentifiers = {} } = {}) {
  const typeDetails = normalizedTypeDetails && typeof normalizedTypeDetails === 'object'
    ? normalizedTypeDetails
    : {};
  return {
    isbn: normalizeStrongIsbnValue(resolvedIdentifiers.isbn || typeDetails.isbn || ''),
    eanUpc: normalizeStrongIdentifierValue(resolvedIdentifiers.eanUpc || item.upc || ''),
    tmdbId: normalizeStrongIdentifierValue(item.tmdb_id || ''),
    providerItemId: normalizeStrongIdentifierValue(typeDetails.provider_item_id || typeDetails.calibre_entry_id || item.provider_item_id || ''),
    providerIssueId: normalizeStrongIdentifierValue(typeDetails.provider_issue_id || item.provider_issue_id || '')
  };
}

function assessTitleFallbackStrongIdentifierConflicts({ item = {}, normalizedTypeDetails = {}, resolvedIdentifiers = {}, candidateRow = {} } = {}) {
  const incoming = getIncomingStrongIdentifiers({ item, normalizedTypeDetails, resolvedIdentifiers });
  const candidate = getCandidateStrongIdentifiers(candidateRow);
  const conflicts = [];

  if (incoming.isbn && candidate.isbn && incoming.isbn !== candidate.isbn) conflicts.push('isbn_conflict');
  if (incoming.eanUpc && candidate.eanUpc && incoming.eanUpc !== candidate.eanUpc) conflicts.push('ean_upc_conflict');
  if (incoming.tmdbId && candidate.tmdbId && incoming.tmdbId !== candidate.tmdbId) conflicts.push('tmdb_id_conflict');
  if (incoming.providerItemId && candidate.providerItemId && incoming.providerItemId !== candidate.providerItemId) conflicts.push('provider_item_id_conflict');
  if (incoming.providerIssueId && candidate.providerIssueId && incoming.providerIssueId !== candidate.providerIssueId) conflicts.push('provider_issue_id_conflict');

  return conflicts;
}

function validateTypeSpecificFields(mediaType, payload = {}) {
  const effectiveType = normalizeMediaType(mediaType, 'movie');
  const hasSeason = payload.season_number !== undefined && payload.season_number !== null;
  const hasEpisodeNumber = payload.episode_number !== undefined && payload.episode_number !== null;
  const hasEpisodeTitle = payload.episode_title !== undefined && payload.episode_title !== null && String(payload.episode_title).trim() !== '';
  const hasNetwork = payload.network !== undefined && payload.network !== null && String(payload.network).trim() !== '';
  const hasTvFields = hasSeason || hasEpisodeNumber || hasEpisodeTitle || hasNetwork;

  if (!['tv_series', 'tv_episode'].includes(effectiveType) && hasTvFields) {
    return 'TV-specific fields are only valid for TV media types';
  }
  if (effectiveType === 'tv_series' && (hasEpisodeNumber || hasEpisodeTitle)) {
    return 'TV series entries cannot include episode-specific fields';
  }
  return null;
}

function stripIncompatibleTypeSpecificFields(mediaType, payload = {}) {
  const effectiveType = normalizeMediaType(mediaType, 'movie');
  const cleaned = { ...payload };
  if (!['tv_series', 'tv_episode'].includes(effectiveType)) {
    delete cleaned.season_number;
    delete cleaned.episode_number;
    delete cleaned.episode_title;
    delete cleaned.network;
    return cleaned;
  }
  if (effectiveType === 'tv_series') {
    delete cleaned.episode_number;
    delete cleaned.episode_title;
  }
  return cleaned;
}

function normalizeResolution(value) {
  if (!value || value === 'all') return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '4k') return '4k';
  if (normalized === '1080p') return '1080';
  if (normalized === '720p') return '720';
  if (normalized === 'sd') return 'sd';
  return normalized;
}

function normalizeMediaFormat(formatValue) {
  const normalized = normalizeOwnedFormatValue('movie', formatValue)
    || normalizeOwnedFormatValue('book', formatValue)
    || normalizeOwnedFormatValue('comic_book', formatValue)
    || normalizeOwnedFormatValue('game', formatValue)
    || normalizeOwnedFormatValue('audio', formatValue)
    || normalizeOwnedFormatValue('tv_series', formatValue);
  if (!normalized) {
    return ALL_DISPLAY_FORMAT_LABELS.includes(formatValue) ? formatValue : 'Digital';
  }
  const formatLabel = derivePrimaryFormat('movie', [normalized], null)
    || derivePrimaryFormat('book', [normalized], null)
    || derivePrimaryFormat('comic_book', [normalized], null)
    || derivePrimaryFormat('game', [normalized], null)
    || derivePrimaryFormat('audio', [normalized], null)
    || derivePrimaryFormat('tv_series', [normalized], null);
  return formatLabel || 'Digital';
}

function normalizeOwnedFormatFilterValue(formatValue) {
  return normalizeOwnedFormatValue('movie', formatValue)
    || normalizeOwnedFormatValue('book', formatValue)
    || normalizeOwnedFormatValue('comic_book', formatValue)
    || normalizeOwnedFormatValue('game', formatValue)
    || normalizeOwnedFormatValue('audio', formatValue)
    || normalizeOwnedFormatValue('tv_series', formatValue)
    || null;
}

function parseOwnedFormatsInput(mediaType, rawValue, fallbackFormat = null) {
  if (Array.isArray(rawValue)) {
    return sortOwnedFormats(mediaType, normalizeOwnedFormats(mediaType, rawValue, fallbackFormat));
  }
  const source = String(rawValue || '').trim();
  if (!source) {
    return sortOwnedFormats(mediaType, normalizeOwnedFormats(mediaType, null, fallbackFormat));
  }
  const tokens = source
    .split(/[|,;]+/)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  return sortOwnedFormats(mediaType, normalizeOwnedFormats(mediaType, tokens, fallbackFormat));
}

function normalizeMediaRecord(row = {}) {
  const payload = buildOwnedFormatsPayload(row.media_type || 'movie', row.owned_formats, row.format);
  return {
    ...row,
    owned_formats: payload.ownedFormats,
    format: payload.format,
    cast: row.cast || row.cast_members || null
  };
}

async function attachSignaturesToMediaRecord(row = {}) {
  if (!row?.id) return row;
  const signatures = await loadSignatureRecordsForOwner(pool, { ownerType: 'media', ownerId: row.id });
  return {
    ...row,
    signatures
  };
}

async function syncMediaPrimarySignature(row = {}, userId = null) {
  if (!row?.id) return null;
  const signature = buildLegacyMediaSignature(row);
  return syncPrimarySignatureRecord(pool, {
    ownerType: 'media',
    ownerId: row.id,
    libraryId: row.library_id || null,
    spaceId: row.space_id || null,
    createdBy: userId,
    signature,
    signed: signature.hasDetails
  });
}

async function syncMediaLegacyFieldsFromSignatures(mediaId) {
  const signatures = await loadSignatureRecordsForOwner(pool, { ownerType: 'media', ownerId: mediaId });
  const primarySignature = signatures.find((signature) => signature.is_primary) || signatures[0] || null;
  const updated = await pool.query(
    `UPDATE media
     SET signed_by = $2,
         signed_role = $3,
         signed_on = $4,
         signed_at = $5,
         signed_proof_path = $6
     WHERE id = $1
     RETURNING *, cast_members AS cast`,
    [
      mediaId,
      primarySignature?.signer_name || null,
      primarySignature?.signer_role || null,
      primarySignature?.signed_on || null,
      primarySignature?.signed_at || null,
      primarySignature?.proof_path || null
    ]
  );
  const row = updated.rows[0] ? normalizeMediaRecord(updated.rows[0]) : null;
  return row ? attachSignaturesToMediaRecord(row) : null;
}

function humanizeMergeSourceToken(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('metron')) return 'Metron';
  if (normalized.includes('cwa_opds') || normalized.includes('opds')) return 'OPDS / Calibre';
  if (normalized.includes('calibre')) return 'Calibre';
  if (normalized === 'csv_delicious') return 'Delicious Library';
  if (normalized === 'csv_generic') return 'CSV Import';
  if (normalized === 'csv_calibre') return 'Calibre CSV';
  if (normalized.includes('delicious')) return 'Delicious Library';
  if (normalized.includes('plex')) return 'Plex';
  if (normalized.startsWith('manual') || normalized.includes('manual')) return 'Manual';
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function summarizeMergeSourceRow(row = {}) {
  const typeDetails = row?.type_details && typeof row.type_details === 'object' ? row.type_details : {};
  const importSource = String(row.import_source || '').trim() || null;
  const providerName = String(typeDetails.provider_name || '').trim() || null;
  const sourceProviderLabel = humanizeMergeSourceToken(providerName);
  const sourceImportLabel = humanizeMergeSourceToken(importSource);
  const sourceLabelParts = Array.from(new Set([sourceProviderLabel, sourceImportLabel].filter(Boolean)));
  return {
    id: Number(row.id || 0) || null,
    title: String(row.title || '').trim() || null,
    media_type: String(row.media_type || '').trim() || null,
    year: Number(row.year || 0) || null,
    poster_path: String(row.poster_path || '').trim() || null,
    import_source: importSource,
    type_details: typeDetails,
    provider_name: providerName,
    provider_item_id: String(typeDetails.provider_item_id || '').trim() || null,
    provider_issue_id: String(typeDetails.provider_issue_id || '').trim() || null,
    source_provider_label: sourceProviderLabel,
    source_import_label: sourceImportLabel,
    source_label: sourceLabelParts.join(' · ') || null
  };
}

function formatMergeMatchKind(kind = '', mediaType = '') {
  const normalized = String(kind || '').trim();
  const normalizedMediaType = String(mediaType || '').trim();
  if (normalized === 'shared_cover_path') return 'Matched on shared cover art path';
  if (normalized === 'exact_title') return 'Matched on exact title';
  if (normalized === 'normalized_movie_title') return 'Matched on normalized movie title';
  if (normalized === 'tmdb_id') return 'Matched on TMDB id';
  if (normalized === 'upc') return 'Matched on UPC';
  if (normalized === 'provider_item') return 'Matched on provider item';
  if (normalized === 'title_year') return 'Matched on title and year';
  if (normalized === 'title_only') return 'Matched on title';
  if (normalizedMediaType === 'book') {
    if (normalized === 'isbn') return 'Matched on ISBN';
    if (normalized === 'title_author') return 'Matched on title and author';
    if (normalized === 'title_only') return 'Matched on title';
  }
  if (normalizedMediaType === 'comic_book') {
    if (normalized === 'provider_item') return 'Matched on provider item';
    if (normalized === 'series_issue_volume') return 'Matched on series, issue, and volume';
    if (normalized === 'series_issue') return 'Matched on series and issue';
    if (normalized === 'title_only') return 'Matched on title';
  }
  return 'Matched on normalized record identity';
}

function buildManualMergeRecommendationIdentity(row = {}) {
  const mediaType = String(row.media_type || '').trim();
  if (mediaType === 'book') return buildBookNormalizationIdentity(row);
  if (mediaType === 'comic_book') return buildComicNormalizationIdentity(row);
  return buildGenericManualMergeIdentity(row);
}

function buildRecommendationPairKey(canonicalId, duplicateId) {
  const left = Number(canonicalId || 0);
  const right = Number(duplicateId || 0);
  if (!left || !right) return null;
  const pairLowId = Math.min(left, right);
  const pairHighId = Math.max(left, right);
  return {
    pairLowId,
    pairHighId,
    key: `${pairLowId}:${pairHighId}`
  };
}

function extractComicTitleIssueToken(title = '') {
  const raw = String(title || '').trim();
  if (!raw) return '';
  const directMatch = raw.match(/#\s*([0-9]+[a-z]?)/i);
  if (directMatch?.[1]) return normalizeIssueToken(directMatch[1]);
  const volumeMatch = raw.match(/\bv\d+\s+([0-9]+[a-z]?)\b/i);
  if (volumeMatch?.[1]) return normalizeIssueToken(volumeMatch[1]);
  const trailingMatch = raw.match(/\b([0-9]+[a-z]?)\b\s*$/i);
  if (trailingMatch?.[1]) return normalizeIssueToken(trailingMatch[1]);
  return '';
}

function assessComicRecommendationSuppression(row = {}) {
  if (String(row.media_type || '').trim() !== 'comic_book') return [];
  const typeDetails = row?.type_details && typeof row.type_details === 'object' ? row.type_details : {};
  const issueNumber = normalizeIssueToken(typeDetails.issue_number || '');
  const editionIssue = normalizeIssueToken(String(typeDetails.edition || '').replace(/^issue\s*/i, ''));
  const titleIssue = extractComicTitleIssueToken(row.title || '');
  const reasons = [];
  if (issueNumber && titleIssue && titleIssue !== issueNumber) {
    reasons.push('title_issue_mismatch');
  }
  if (issueNumber && editionIssue && editionIssue !== issueNumber) {
    reasons.push('edition_issue_mismatch');
  }
  return reasons;
}

function buildComicDuplicateGroupSummary(bucket = {}) {
  const rows = Array.isArray(bucket.rows) ? bucket.rows : [];
  if (rows.length < 2) return null;
  const canonical = chooseCanonicalRow(rows);
  if (!canonical) return null;
  const suppressionReasons = Array.from(new Set(rows.flatMap((row) => assessComicRecommendationSuppression(row))));
  return {
    duplicate_group_id: String(bucket.key || ''),
    media_type: 'comic_book',
    confidence: bucket.confidence || null,
    kind: bucket.kind || null,
    summary: formatMergeMatchKind(bucket.kind, 'comic_book'),
    rationale: Array.isArray(bucket.rationale) ? bucket.rationale : [],
    rationale_labels: (Array.isArray(bucket.rationale) ? bucket.rationale : []).map(formatMergeRationaleLabel),
    suppressed: suppressionReasons.length > 0,
    suppression_reasons: suppressionReasons,
    canonical: summarizeMergeSourceRow(canonical),
    duplicates: rows
      .filter((row) => Number(row.id || 0) !== Number(canonical.id || 0))
      .sort((left, right) => Number(left.id || 0) - Number(right.id || 0))
      .map((row) => summarizeMergeSourceRow(row)),
    duplicate_count: rows.length,
    supporting_sources: rows.length,
    series: String(canonical?.type_details?.series || '').trim() || null,
    issue_number: String(canonical?.type_details?.issue_number || '').trim() || null,
    volume: String(canonical?.type_details?.volume || '').trim() || null
  };
}

async function loadScopedSuppressedMergeRecommendationPairs({ scopeContext = null, outcomes = ['rejected'] } = {}) {
  const normalizedOutcomes = Array.from(new Set((outcomes || [])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)));
  if (normalizedOutcomes.length === 0) return new Set();
  const params = [normalizedOutcomes];
  const suppressedScopeClause = appendScopeSql(params, scopeContext);
  const suppressedResult = await pool.query(
    `SELECT pair_low_media_id, pair_high_media_id
       FROM media_merge_recommendation_feedback
      WHERE outcome = ANY($1::text[])${suppressedScopeClause}`,
    params
  );
  return new Set(
    (suppressedResult.rows || []).map((row) => `${Number(row.pair_low_media_id || 0)}:${Number(row.pair_high_media_id || 0)}`)
  );
}

async function loadScopedManualMergeRecommendations({ scopeContext = null, limit = 12, mediaType = null } = {}) {
  const cappedLimit = Math.max(1, Math.min(50, Number(limit || 12) || 12));
  const params = [];
  let where = 'WHERE 1=1';
  const normalizedMediaType = normalizeMergeReviewMediaTypeFilter(mediaType);
  if (normalizedMediaType) {
    params.push(normalizedMediaType);
    where += ` AND media_type = $${params.length}`;
  }
  where += appendScopeSql(params, scopeContext);
  const result = await pool.query(
    `SELECT id, title, media_type, import_source, type_details, year, upc, tmdb_id, tmdb_media_type
       FROM media
       ${where}
      ORDER BY updated_at DESC, id DESC`,
    params
  );

  const suppressedPairs = await loadScopedSuppressedMergeRecommendationPairs({
    scopeContext,
    outcomes: ['rejected', 'deferred']
  });

  const buckets = new Map();
  for (const row of result.rows || []) {
    const identity = buildManualMergeRecommendationIdentity(row);
    if (!identity?.key || identity.confidence === 'low') continue;
    const bucket = buckets.get(identity.key) || {
      ...identity,
      media_type: String(row.media_type || '').trim() || null,
      rows: []
    };
    bucket.rows.push(normalizeMediaRecord(row));
    buckets.set(identity.key, bucket);
  }

  const confidenceOrder = { high: 0, medium: 1, low: 2, review: 3 };
  const allItems = Array.from(buckets.values())
    .filter((bucket) => Array.isArray(bucket.rows) && bucket.rows.length > 1)
    .flatMap((bucket) => {
      const canonical = chooseCanonicalRow(bucket.rows);
      if (!canonical) return [];
      if (bucket.media_type === 'comic_book') {
        const suppressionReasons = Array.from(new Set(bucket.rows.flatMap((row) => assessComicRecommendationSuppression(row))));
        if (suppressionReasons.length > 0) return [];
      }
      return bucket.rows
        .filter((row) => Number(row.id) !== Number(canonical.id))
        .sort((left, right) => Number(left.id || 0) - Number(right.id || 0))
        .map((duplicate) => {
          const pairKey = buildRecommendationPairKey(canonical.id, duplicate.id);
          if (!pairKey || suppressedPairs.has(pairKey.key)) return null;
          return {
          recommendation_id: `${bucket.key}:${canonical.id}:${duplicate.id}`,
          pair_key: pairKey.key,
          media_type: bucket.media_type,
          confidence: bucket.confidence,
          kind: bucket.kind,
          key: bucket.key,
          summary: formatMergeMatchKind(bucket.kind, bucket.media_type),
          rationale: Array.isArray(bucket.rationale) ? bucket.rationale : [],
          rationale_labels: (Array.isArray(bucket.rationale) ? bucket.rationale : []).map(formatMergeRationaleLabel),
          canonical: summarizeMergeSourceRow(canonical),
          duplicate: summarizeMergeSourceRow(duplicate),
          canonical_selection: {
            recommended_canonical_id: Number(canonical.id || 0) || null,
            requested_matches_recommended: true,
            selection_reason: CANONICAL_SELECTION_REASON
          }
          };
        })
        .filter(Boolean);
    })
    .sort((left, right) => {
      const confidenceDelta = (confidenceOrder[left.confidence] ?? 99) - (confidenceOrder[right.confidence] ?? 99);
      if (confidenceDelta !== 0) return confidenceDelta;
      const mediaTypeDelta = String(left.media_type || '').localeCompare(String(right.media_type || ''));
      if (mediaTypeDelta !== 0) return mediaTypeDelta;
      return Number(left.canonical?.id || 0) - Number(right.canonical?.id || 0)
        || Number(left.duplicate?.id || 0) - Number(right.duplicate?.id || 0);
    });

  const limitedItems = allItems.slice(0, cappedLimit);
  return {
    summary: {
      total_candidates: allItems.length,
      returned_candidates: limitedItems.length,
      high_confidence: allItems.filter((item) => item.confidence === 'high').length,
      medium_confidence: allItems.filter((item) => item.confidence === 'medium').length
    },
    items: limitedItems
  };
}

async function loadScopedComicDuplicateCandidates({ scopeContext = null, limit = 12, search = '', mediaType = null } = {}) {
  const cappedLimit = Math.max(1, Math.min(50, Number(limit || 12) || 12));
  const normalizedMediaType = normalizeMergeReviewMediaTypeFilter(mediaType);
  if (normalizedMediaType && normalizedMediaType !== 'comic_book') {
    return {
      summary: {
        total_groups: 0,
        candidate_groups: 0,
        suppressed_groups: 0,
        returned_groups: 0
      },
      items: [],
      suppressed_items: []
    };
  }
  const normalizedSearch = normalizeText(search || '');
  const params = [];
  const where = `WHERE m.media_type = 'comic_book'
    AND COALESCE(m.type_details->>'series','') <> ''
    AND COALESCE(m.type_details->>'issue_number','') <> ''
    ${appendScopeSql(params, scopeContext, { spaceColumn: 'm.space_id', libraryColumn: 'm.library_id' })}`;
  const result = await pool.query(
    `SELECT id, title, media_type, import_source, type_details, year, upc, tmdb_id, tmdb_media_type
       FROM media m
       ${where}
      ORDER BY updated_at DESC, id DESC`,
    params
  );
  const suppressedPairs = await loadScopedSuppressedMergeRecommendationPairs({
    scopeContext,
    outcomes: ['rejected', 'deferred']
  });

  const buckets = new Map();
  for (const row of result.rows || []) {
    const identity = buildComicNormalizationIdentity(row);
    if (!identity?.key || identity.confidence === 'low') continue;
    const normalizedRow = normalizeMediaRecord(row);
    if (normalizedSearch) {
      const haystack = normalizeText([
        normalizedRow.title || '',
        normalizedRow?.type_details?.series || '',
        normalizedRow?.type_details?.issue_number || '',
        normalizedRow?.type_details?.volume || ''
      ].join(' '));
      if (!haystack.includes(normalizedSearch)) continue;
    }
    const bucket = buckets.get(identity.key) || {
      ...identity,
      rows: []
    };
    bucket.rows.push(normalizedRow);
    buckets.set(identity.key, bucket);
  }

  const summarizedGroups = Array.from(buckets.values())
    .filter((bucket) => Array.isArray(bucket.rows) && bucket.rows.length > 1)
    .map((bucket) => buildComicDuplicateGroupSummary(bucket))
    .map((group) => {
      if (!group?.canonical?.id || !Array.isArray(group.duplicates)) return group;
      const remainingDuplicates = group.duplicates.filter((duplicate) => {
        const pairKey = buildRecommendationPairKey(group.canonical.id, duplicate.id);
        return pairKey ? !suppressedPairs.has(pairKey.key) : false;
      });
      if (remainingDuplicates.length === 0) return null;
      return {
        ...group,
        duplicates: remainingDuplicates,
        duplicate_count: remainingDuplicates.length + 1,
        supporting_sources: remainingDuplicates.length + 1
      };
    })
    .filter(Boolean)
    .sort((left, right) => Number(right.duplicate_count || 0) - Number(left.duplicate_count || 0)
      || String(left.series || '').localeCompare(String(right.series || ''))
      || String(left.issue_number || '').localeCompare(String(right.issue_number || '')));

  const candidateItems = summarizedGroups.filter((item) => !item.suppressed);
  const suppressedItems = summarizedGroups.filter((item) => item.suppressed);
  return {
    summary: {
      total_groups: summarizedGroups.length,
      candidate_groups: candidateItems.length,
      suppressed_groups: suppressedItems.length,
      returned_groups: Math.min(candidateItems.length, cappedLimit)
    },
    items: candidateItems.slice(0, cappedLimit),
    suppressed_items: suppressedItems.slice(0, Math.min(6, suppressedItems.length))
  };
}

async function loadScopedDuplicateDiscoveryCandidates({ scopeContext = null, limit = 12, search = '', mediaId = null, mediaType = null } = {}) {
  const cappedLimit = Math.max(1, Math.min(50, Number(limit || 12) || 12));
  const focusedMediaId = Number(mediaId || 0) || null;
  const normalizedSearch = normalizeText(search || '');
  const params = [];
  let where = 'WHERE 1=1';
  const normalizedMediaType = normalizeMergeReviewMediaTypeFilter(mediaType);
  if (normalizedMediaType) {
    params.push(normalizedMediaType);
    where += ` AND media_type = $${params.length}`;
  }
  where += appendScopeSql(params, scopeContext);
  const result = await pool.query(
    `SELECT id, title, media_type, import_source, type_details, year, upc, tmdb_id, tmdb_media_type, poster_path,
            original_title, director, cast_members AS cast, runtime
       FROM media
       ${where}
      ORDER BY updated_at DESC, id DESC`,
    params
  );

  const suppressedPairs = await loadScopedSuppressedMergeRecommendationPairs({
    scopeContext,
    outcomes: ['rejected', 'deferred']
  });
  const strictRecommendationPairs = new Set(
    (await loadScopedManualMergeRecommendations({ scopeContext, limit: 500, mediaType: normalizedMediaType })).items.map((item) => item.pair_key).filter(Boolean)
  );
  const comicCandidatePairs = new Set();
  const comicDuplicateGroups = await loadScopedComicDuplicateCandidates({ scopeContext, limit: 500, search: '', mediaType: normalizedMediaType });
  for (const group of comicDuplicateGroups.items || []) {
    for (const duplicate of group.duplicates || []) {
      const pairKey = buildRecommendationPairKey(group?.canonical?.id, duplicate?.id);
      if (pairKey?.key) comicCandidatePairs.add(pairKey.key);
    }
  }

  const knownPairs = new Set([
    ...suppressedPairs,
    ...strictRecommendationPairs,
    ...comicCandidatePairs
  ]);

  const normalizedRows = (result.rows || []).map((row) => normalizeMediaRecord(row));
  const focusRow = focusedMediaId
    ? normalizedRows.find((row) => Number(row.id || 0) === focusedMediaId) || null
    : null;
  if (focusedMediaId && !focusRow) {
    return {
      summary: {
        total_candidates: 0,
        returned_candidates: 0,
        shared_cover_candidates: 0,
        exact_title_candidates: 0,
        normalized_movie_title_candidates: 0,
        focused_media_id: focusedMediaId,
        focused_title: null
      },
      focus: null,
      items: []
    };
  }

  const candidateMap = new Map();
  const considerPair = (leftRow, rightRow, signal) => {
    const pairKey = buildRecommendationPairKey(leftRow?.id, rightRow?.id);
    if (!pairKey?.key || knownPairs.has(pairKey.key)) return;
    if (String(leftRow?.media_type || '') !== String(rightRow?.media_type || '')) return;
    if (focusedMediaId && ![Number(leftRow?.id || 0), Number(rightRow?.id || 0)].includes(focusedMediaId)) return;
    if (
      signal === 'shared_cover_path'
      && isStructuredTitlePairUnsafeForSharedCoverDiscovery(leftRow?.title || '', rightRow?.title || '')
    ) {
      return;
    }
    if (assessMovieDiscoveryConflictReasons(leftRow, rightRow).length > 0) {
      return;
    }

    const canonical = chooseCanonicalRow([leftRow, rightRow]);
    const duplicate = Number(canonical?.id || 0) === Number(leftRow?.id || 0) ? rightRow : leftRow;
    if (!canonical?.id || !duplicate?.id) return;

    const haystack = normalizeText([
      canonical.title || '',
      duplicate.title || '',
      canonical?.type_details?.series || '',
      duplicate?.type_details?.series || ''
    ].join(' '));
    if (normalizedSearch && !haystack.includes(normalizedSearch)) return;

    const existing = candidateMap.get(pairKey.key);
    if (existing) {
      const existingRank = existing.signal === 'shared_cover_path' ? 0 : 1;
      const nextRank = signal === 'shared_cover_path' ? 0 : 1;
      if (nextRank < existingRank) {
        candidateMap.set(pairKey.key, {
          ...existing,
          signal,
          summary: formatMergeMatchKind(signal, canonical.media_type),
          rationale: signal === 'shared_cover_path'
            ? ['poster_path']
            : signal === 'normalized_movie_title'
              ? ['normalized_movie_title']
              : ['exact_title'],
          rationale_labels: signal === 'shared_cover_path'
            ? ['Poster path']
            : signal === 'normalized_movie_title'
              ? ['Normalized movie title']
              : ['Exact title']
        });
      }
      return;
    }

    candidateMap.set(pairKey.key, {
      discovery_id: `discovery:${signal}:${pairKey.key}`,
      pair_key: pairKey.key,
      media_type: canonical.media_type,
      confidence: signal === 'shared_cover_path' ? 'review' : 'review',
      signal,
      summary: formatMergeMatchKind(signal, canonical.media_type),
      rationale: signal === 'shared_cover_path'
        ? ['poster_path']
        : signal === 'normalized_movie_title'
          ? ['normalized_movie_title']
          : ['exact_title'],
      rationale_labels: signal === 'shared_cover_path'
        ? ['Poster path']
        : signal === 'normalized_movie_title'
          ? ['Normalized movie title']
          : ['Exact title'],
      canonical: summarizeMergeSourceRow(canonical),
      duplicate: summarizeMergeSourceRow(duplicate),
      canonical_selection: {
        recommended_canonical_id: Number(canonical.id || 0) || null,
        requested_matches_recommended: true,
        selection_reason: CANONICAL_SELECTION_REASON
      }
    });
  };

  const posterBuckets = new Map();
  const titleBuckets = new Map();
  const normalizedMovieTitleBuckets = new Map();
  for (const row of normalizedRows) {
    const mediaType = String(row.media_type || '').trim();
    const posterPath = String(row.poster_path || '').trim();
    const normalizedTitle = normalizeText(row.title || '');
    const normalizedMovieTitle = mediaType === 'movie' ? normalizeMovieDiscoveryTitle(row.title || '') : '';
    if (posterPath) {
      const key = `${mediaType}:poster:${posterPath}`;
      const bucket = posterBuckets.get(key) || [];
      bucket.push(row);
      posterBuckets.set(key, bucket);
    }
    if (normalizedTitle) {
      const key = `${mediaType}:title:${normalizedTitle}`;
      const bucket = titleBuckets.get(key) || [];
      bucket.push(row);
      titleBuckets.set(key, bucket);
    }
    if (normalizedMovieTitle) {
      const key = `${mediaType}:normalized_title:${normalizedMovieTitle}`;
      const bucket = normalizedMovieTitleBuckets.get(key) || [];
      bucket.push(row);
      normalizedMovieTitleBuckets.set(key, bucket);
    }
  }

  for (const bucket of posterBuckets.values()) {
    if (bucket.length < 2) continue;
    const sortedRows = [...bucket].sort((left, right) => Number(left.id || 0) - Number(right.id || 0));
    for (let index = 0; index < sortedRows.length - 1; index += 1) {
      for (let offset = index + 1; offset < sortedRows.length; offset += 1) {
        considerPair(sortedRows[index], sortedRows[offset], 'shared_cover_path');
      }
    }
  }

  for (const bucket of titleBuckets.values()) {
    if (bucket.length < 2) continue;
    const sortedRows = [...bucket].sort((left, right) => Number(left.id || 0) - Number(right.id || 0));
    for (let index = 0; index < sortedRows.length - 1; index += 1) {
      for (let offset = index + 1; offset < sortedRows.length; offset += 1) {
        considerPair(sortedRows[index], sortedRows[offset], 'exact_title');
      }
    }
  }

  for (const bucket of normalizedMovieTitleBuckets.values()) {
    if (bucket.length < 2) continue;
    const sortedRows = [...bucket].sort((left, right) => Number(left.id || 0) - Number(right.id || 0));
    for (let index = 0; index < sortedRows.length - 1; index += 1) {
      for (let offset = index + 1; offset < sortedRows.length; offset += 1) {
        considerPair(sortedRows[index], sortedRows[offset], 'normalized_movie_title');
      }
    }
  }

  const confidenceOrder = { review: 0 };
  const signalOrder = { shared_cover_path: 0, exact_title: 1, normalized_movie_title: 2 };
  const allItems = Array.from(candidateMap.values()).sort((left, right) => {
    const signalDelta = (signalOrder[left.signal] ?? 99) - (signalOrder[right.signal] ?? 99);
    if (signalDelta !== 0) return signalDelta;
    const confidenceDelta = (confidenceOrder[left.confidence] ?? 99) - (confidenceOrder[right.confidence] ?? 99);
    if (confidenceDelta !== 0) return confidenceDelta;
    return Number(left.canonical?.id || 0) - Number(right.canonical?.id || 0)
      || Number(left.duplicate?.id || 0) - Number(right.duplicate?.id || 0);
  });
  const limitedItems = allItems.slice(0, cappedLimit);
  return {
    summary: {
      total_candidates: allItems.length,
      returned_candidates: limitedItems.length,
      shared_cover_candidates: allItems.filter((item) => item.signal === 'shared_cover_path').length,
      exact_title_candidates: allItems.filter((item) => item.signal === 'exact_title').length,
      normalized_movie_title_candidates: allItems.filter((item) => item.signal === 'normalized_movie_title').length,
      focused_media_id: focusedMediaId,
      focused_title: focusRow?.title || null
    },
    focus: focusRow ? summarizeMergeSourceRow(focusRow) : null,
    items: limitedItems
  };
}

async function loadScopedCollectionDuplicateGroups({ scopeContext = null, limit = 12, search = '', mediaType = null } = {}) {
  const cappedLimit = Math.max(1, Math.min(50, Number(limit || 12) || 12));
  const normalizedSearch = String(search || '').trim();
  const normalizedMediaType = normalizeMergeReviewMediaTypeFilter(mediaType);
  const params = [];
  let where = 'WHERE 1=1';
  if (normalizedMediaType) {
    params.push(normalizedMediaType);
    where += ` AND c.media_type = $${params.length}`;
  }
  if (normalizedSearch) {
    params.push(`%${normalizedSearch}%`);
    where += ` AND (
      c.name ILIKE $${params.length}
      OR COALESCE(c.source_title, '') ILIKE $${params.length}
    )`;
  }
  where += appendScopeSql(params, scopeContext, {
    spaceColumn: 'c.space_id',
    libraryColumn: 'c.library_id'
  });

  const result = await pool.query(
    `SELECT
       c.id,
       c.name,
       c.media_type,
       c.source_title,
       c.import_source,
       c.expected_item_count,
       c.library_id,
       c.space_id,
       c.created_at,
       c.updated_at,
       l.name AS library_name,
       COUNT(ci.id)::int AS item_count,
       COUNT(ci.id) FILTER (WHERE ci.media_id IS NOT NULL)::int AS linked_item_count
     FROM collections c
     LEFT JOIN collection_items ci ON ci.collection_id = c.id
     LEFT JOIN libraries l ON l.id = c.library_id
     ${where}
     GROUP BY c.id, l.name
     ORDER BY c.created_at DESC, c.id DESC`,
    params
  );

  const groups = new Map();
  for (const row of result.rows || []) {
    const expectedItemCount = Number(row.expected_item_count || 0) || 0;
    const key = `${normalizeText(row.name || '')}::${String(row.media_type || '').trim()}::${expectedItemCount}`;
    const group = groups.get(key) || {
      duplicate_group_id: key,
      name: row.name || row.source_title || `Collection #${row.id}`,
      media_type: String(row.media_type || '').trim() || null,
      expected_item_count: expectedItemCount,
      collections: []
    };
    group.collections.push({
      id: Number(row.id || 0) || null,
      name: row.name || row.source_title || `Collection #${row.id}`,
      source_title: row.source_title || null,
      import_source: row.import_source || null,
      library_id: Number(row.library_id || 0) || null,
      library_name: row.library_name || null,
      space_id: Number(row.space_id || 0) || null,
      created_at: row.created_at || null,
      item_count: Number(row.item_count || 0) || 0,
      linked_item_count: Number(row.linked_item_count || 0) || 0
    });
    groups.set(key, group);
  }

  const allItems = Array.from(groups.values())
    .filter((group) => Array.isArray(group.collections) && group.collections.length > 1)
    .sort((left, right) => {
      const countDelta = Number(right.collections.length || 0) - Number(left.collections.length || 0);
      if (countDelta !== 0) return countDelta;
      return String(left.name || '').localeCompare(String(right.name || ''));
    });
  const limitedItems = allItems.slice(0, cappedLimit);

  return {
    summary: {
      total_groups: allItems.length,
      returned_groups: limitedItems.length,
      duplicate_collections: allItems.reduce((sum, item) => sum + Number(item.collections?.length || 0), 0)
    },
    items: limitedItems
  };
}

function summarizeCollectionRow(row = {}, items = null) {
  const normalizedItems = Array.isArray(items) ? items : (Array.isArray(row.items) ? row.items : []);
  return {
    id: Number(row.id || 0) || null,
    name: row.name || row.source_title || `Collection #${row.id}`,
    media_type: String(row.media_type || '').trim() || null,
    source_title: row.source_title || null,
    import_source: row.import_source || null,
    source_label: humanizeMergeSourceToken(row.import_source) || 'Unknown source',
    expected_item_count: Number(row.expected_item_count || 0) || 0,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    library_id: Number(row.library_id || 0) || null,
    library_name: row.library_name || null,
    space_id: Number(row.space_id || 0) || null,
    created_by: Number(row.created_by || 0) || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    item_count: normalizedItems.length
  };
}

function buildCollectionItemIdentityKey(item = {}) {
  const mediaId = Number(item.media_id || 0) || null;
  if (mediaId) return `media:${mediaId}`;
  const containedTitle = normalizeText(item.contained_title || item.media_title || '');
  if (containedTitle) return `title:${containedTitle}`;
  return `item:${Number(item.id || 0) || 'unknown'}`;
}

function mergeCollectionMetadataObjects(leftValue, rightValue) {
  const left = leftValue && typeof leftValue === 'object' && !Array.isArray(leftValue) ? leftValue : {};
  const right = rightValue && typeof rightValue === 'object' && !Array.isArray(rightValue) ? rightValue : {};
  return {
    ...right,
    ...left
  };
}

function normalizeCollectionImportAlias({
  sourceTitle = '',
  importSource = null,
  mediaType = null,
  source_title = '',
  import_source = null,
  media_type = null
} = {}) {
  const normalizedSourceTitle = String(sourceTitle || source_title || '').trim();
  if (!normalizedSourceTitle) return null;
  return {
    source_title: normalizedSourceTitle,
    import_source: importSource || import_source || null,
    media_type: normalizeMediaType(mediaType || media_type || 'movie', 'movie')
  };
}

function dedupeCollectionImportAliases(aliases = []) {
  const deduped = [];
  const seen = new Set();
  for (const alias of aliases || []) {
    const normalized = normalizeCollectionImportAlias(alias || {});
    if (!normalized) continue;
    const key = [
      normalizeText(normalized.source_title || ''),
      String(normalized.import_source || ''),
      String(normalized.media_type || '')
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}

function extractCollectionImportAliases(metadata = null) {
  const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata.import_collection_aliases
    : [];
  return dedupeCollectionImportAliases(Array.isArray(source) ? source : []);
}

function collectionMatchesImportAlias(collection = {}, alias = null) {
  const normalizedAlias = normalizeCollectionImportAlias(alias || {});
  if (!normalizedAlias) return false;
  const directAlias = normalizeCollectionImportAlias({
    sourceTitle: collection.source_title || '',
    importSource: collection.import_source || null,
    mediaType: collection.media_type || null
  });
  if (directAlias) {
    const directMatch = normalizeText(directAlias.source_title || '') === normalizeText(normalizedAlias.source_title || '')
      && String(directAlias.import_source || '') === String(normalizedAlias.import_source || '')
      && String(directAlias.media_type || '') === String(normalizedAlias.media_type || '');
    if (directMatch) return true;
  }
  return extractCollectionImportAliases(collection.metadata).some((candidate) => (
    normalizeText(candidate.source_title || '') === normalizeText(normalizedAlias.source_title || '')
    && String(candidate.import_source || '') === String(normalizedAlias.import_source || '')
    && String(candidate.media_type || '') === String(normalizedAlias.media_type || '')
  ));
}

function buildMergedCollectionImportAliases({
  canonical = {},
  duplicate = {},
  mergedMetadata = {}
} = {}) {
  const aliases = [
    ...extractCollectionImportAliases(mergedMetadata),
    ...extractCollectionImportAliases(canonical.metadata),
    ...extractCollectionImportAliases(duplicate.metadata),
    normalizeCollectionImportAlias({
      sourceTitle: duplicate.source_title || '',
      importSource: duplicate.import_source || null,
      mediaType: duplicate.media_type || null
    })
  ];
  return dedupeCollectionImportAliases(aliases);
}

function buildCollectionMergeResult({
  canonical = {},
  duplicate = {},
  canonicalItems = [],
  duplicateItems = []
} = {}) {
  const existingKeys = new Set((canonicalItems || []).map((item) => buildCollectionItemIdentityKey(item)));
  let appendedItems = 0;
  for (const item of duplicateItems || []) {
    const key = buildCollectionItemIdentityKey(item);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    appendedItems += 1;
  }
  const mergedItemCount = Number(canonicalItems.length || 0) + appendedItems;
  const mergedMetadata = mergeCollectionMetadataObjects(canonical.metadata, duplicate.metadata);
  const importAliases = buildMergedCollectionImportAliases({
    canonical,
    duplicate,
    mergedMetadata
  });
  if (importAliases.length > 0) {
    mergedMetadata.import_collection_aliases = importAliases;
  }
  return {
    name: canonical.name || duplicate.name || null,
    source_title: canonical.source_title || duplicate.source_title || null,
    expected_item_count: Math.max(
      Number(canonical.expected_item_count || 0) || 0,
      Number(duplicate.expected_item_count || 0) || 0,
      mergedItemCount
    ) || 0,
    import_source: canonical.import_source || duplicate.import_source || null,
    metadata: mergedMetadata,
    merged_item_count: mergedItemCount,
    moved_item_count: appendedItems
  };
}

async function loadScopedCollectionsByIds(collectionIds = [], scopeContext = null) {
  const normalizedIds = Array.from(new Set((collectionIds || []).map((value) => Number(value || 0)).filter((value) => value > 0)));
  if (normalizedIds.length === 0) return [];
  const params = [normalizedIds];
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'c.space_id',
    libraryColumn: 'c.library_id'
  });
  const result = await pool.query(
    `SELECT
       c.id, c.name, c.media_type, c.source_title, c.import_source, c.expected_item_count, c.metadata,
       c.library_id, c.space_id, c.created_by, c.created_at, c.updated_at,
       l.name AS library_name
     FROM collections c
     LEFT JOIN libraries l ON l.id = c.library_id
     WHERE c.id = ANY($1::int[])
     ${scopeClause}
     ORDER BY c.created_at DESC, c.id DESC`,
    params
  );
  return (result.rows || []).map((row) => summarizeCollectionRow(row));
}

async function loadCollectionItemsByCollectionIds(collectionIds = []) {
  const normalizedIds = Array.from(new Set((collectionIds || []).map((value) => Number(value || 0)).filter((value) => value > 0)));
  if (normalizedIds.length === 0) return new Map();
  const result = await pool.query(
    `SELECT
       ci.id, ci.collection_id, ci.media_id, ci.contained_title, ci.position, ci.confidence_score,
       ci.resolution_status, ci.source_payload, ci.created_at, ci.updated_at,
       m.title AS media_title, m.media_type AS media_type, m.poster_path AS media_poster_path, m.year AS media_year
     FROM collection_items ci
     LEFT JOIN media m ON m.id = ci.media_id
     WHERE ci.collection_id = ANY($1::int[])
     ORDER BY ci.collection_id ASC, COALESCE(ci.position, 999999), ci.id ASC`,
    [normalizedIds]
  );
  const itemsByCollectionId = new Map(normalizedIds.map((id) => [id, []]));
  for (const row of result.rows || []) {
    const collectionId = Number(row.collection_id || 0);
    const bucket = itemsByCollectionId.get(collectionId);
    if (!bucket) continue;
    bucket.push({
      id: Number(row.id || 0) || null,
      collection_id: collectionId,
      media_id: Number(row.media_id || 0) || null,
      contained_title: row.contained_title || null,
      position: Number.isFinite(Number(row.position)) ? Number(row.position) : null,
      confidence_score: row.confidence_score === null || row.confidence_score === undefined ? null : Number(row.confidence_score),
      resolution_status: row.resolution_status || null,
      source_payload: row.source_payload && typeof row.source_payload === 'object' ? row.source_payload : {},
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
      media_title: row.media_title || null,
      media_type: row.media_type || null,
      media_year: row.media_year === null || row.media_year === undefined ? null : Number(row.media_year),
      label: row.media_title || row.contained_title || `Collection item #${row.id}`
    });
  }
  return itemsByCollectionId;
}

async function loadScopedCollectionMergeDetails(collectionId, scopeContext = null) {
  const canonicalCollectionId = Number(collectionId || 0);
  if (!canonicalCollectionId) return null;
  const collections = await loadScopedCollectionsByIds([canonicalCollectionId], scopeContext);
  const canonical = collections[0] || null;
  if (!canonical) return null;

  const params = [canonicalCollectionId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'c.space_id',
    libraryColumn: 'c.library_id'
  });
  const result = await pool.query(
    `SELECT h.id, h.duplicate_collection_id, h.repair_type, h.snapshot, h.context, h.applied_at, h.reverted_at
       FROM collection_merge_history h
       JOIN collections c ON c.id = h.canonical_collection_id
      WHERE h.canonical_collection_id = $1
        AND h.reverted_at IS NULL
        ${scopeClause}
      ORDER BY h.applied_at DESC, h.id DESC`,
    params
  );
  const entries = (result.rows || []).map((row) => {
    const snapshot = row.snapshot && typeof row.snapshot === 'object' ? row.snapshot : {};
    const context = row.context && typeof row.context === 'object' ? row.context : {};
    const duplicate = summarizeCollectionRow(snapshot.duplicate_before || {
      id: row.duplicate_collection_id,
      name: `Collection #${row.duplicate_collection_id}`
    }, Array.isArray(snapshot.duplicate_items_before) ? snapshot.duplicate_items_before : []);
    return {
      history_id: Number(row.id || 0) || null,
      duplicate_id: Number(row.duplicate_collection_id || 0) || null,
      repair_type: row.repair_type || 'duplicate_attach',
      applied_at: row.applied_at || null,
      summary: String(context.summary || 'Collection merge').trim() || 'Collection merge',
      canonical,
      duplicate,
      moved_item_count: Number(context.moved_item_count || 0) || 0,
      skipped_item_count: Number(context.skipped_item_count || 0) || 0
    };
  });

  return {
    collection: canonical,
    summary: {
      active_merge_count: entries.length,
      supporting_collections: 1 + entries.length,
      latest_merge_at: entries[0]?.applied_at || null
    },
    entries
  };
}

async function loadScopedCollectionDuplicatePreview({
  leftCollectionId,
  rightCollectionId,
  scopeContext = null
} = {}) {
  const leftId = Number(leftCollectionId || 0);
  const rightId = Number(rightCollectionId || 0);
  if (!leftId || !rightId || leftId === rightId) return null;

  const collections = await loadScopedCollectionsByIds([leftId, rightId], scopeContext);
  if (collections.length !== 2) return null;

  const collectionById = new Map(collections.map((collection) => [Number(collection.id || 0), collection]));
  const left = collectionById.get(leftId) || null;
  const right = collectionById.get(rightId) || null;
  if (!left || !right) return null;

  if (String(left.media_type || '') !== String(right.media_type || '')) {
    return {
      allowed: false,
      details: {
        left_media_type: left.media_type || null,
        right_media_type: right.media_type || null
      },
      left,
      right
    };
  }

  const itemsByCollectionId = await loadCollectionItemsByCollectionIds([leftId, rightId]);
  const leftItems = itemsByCollectionId.get(leftId) || [];
  const rightItems = itemsByCollectionId.get(rightId) || [];
  const resultingCollection = buildCollectionMergeResult({
    canonical: left,
    duplicate: right,
    canonicalItems: leftItems,
    duplicateItems: rightItems
  });
  const comparedFields = [
    {
      key: 'name',
      label: 'Collection name',
      left_value: left.name || null,
      right_value: right.name || null
    },
    {
      key: 'source_title',
      label: 'Source title',
      left_value: left.source_title || null,
      right_value: right.source_title || null
    },
    {
      key: 'expected_item_count',
      label: 'Expected items',
      left_value: left.expected_item_count || 0,
      right_value: right.expected_item_count || 0
    },
    {
      key: 'linked_items',
      label: 'Linked items',
      left_value: leftItems.filter((item) => item.media_id).length,
      right_value: rightItems.filter((item) => item.media_id).length
    },
    {
      key: 'source',
      label: 'Source',
      left_value: left.source_label || null,
      right_value: right.source_label || null
    }
  ];

  return {
    allowed: true,
    left: {
      ...left,
      items: leftItems
    },
    right: {
      ...right,
      items: rightItems
    },
    preview: {
      media_type: left.media_type || right.media_type || null,
      summary: 'Matched on collection name and expected item count',
      compared_fields: comparedFields,
      resulting_collection: resultingCollection,
      item_summary: {
        left_item_count: leftItems.length,
        right_item_count: rightItems.length,
        merged_item_count: resultingCollection.merged_item_count,
        moved_item_count: resultingCollection.moved_item_count,
        left_linked_item_count: leftItems.filter((item) => item.media_id).length,
        right_linked_item_count: rightItems.filter((item) => item.media_id).length
      }
    }
  };
}

async function runManualCollectionMergeApply({
  canonicalCollectionId,
  duplicateCollectionId,
  userId = null,
  preview = null
} = {}) {
  const canonicalId = Number(canonicalCollectionId || 0);
  const duplicateId = Number(duplicateCollectionId || 0);
  if (!canonicalId || !duplicateId || canonicalId === duplicateId) {
    throw new Error('Invalid collection merge pair');
  }

  const mergePreview = preview || await loadScopedCollectionDuplicatePreview({
    leftCollectionId: canonicalId,
    rightCollectionId: duplicateId,
    scopeContext: null
  });
  if (!mergePreview || !mergePreview.allowed) {
    throw new Error('Collection merge preview is not available');
  }

  const canonical = mergePreview.left;
  const duplicate = mergePreview.right;
  const canonicalItems = Array.isArray(canonical?.items) ? canonical.items : [];
  const duplicateItems = Array.isArray(duplicate?.items) ? duplicate.items : [];
  const mergeResult = buildCollectionMergeResult({
    canonical,
    duplicate,
    canonicalItems,
    duplicateItems
  });
  const mergedCollectionMetadata = mergeCollectionMetadataObjects(canonical.metadata, duplicate.metadata);
  const mergedCollectionAliases = buildMergedCollectionImportAliases({
    canonical,
    duplicate,
    mergedMetadata: mergeResult.metadata && typeof mergeResult.metadata === 'object'
      ? mergeResult.metadata
      : mergedCollectionMetadata
  });
  if (mergedCollectionAliases.length > 0) {
    mergedCollectionMetadata.import_collection_aliases = mergedCollectionAliases;
  }

  const snapshot = {
    canonical_before: canonical,
    duplicate_before: duplicate,
    duplicate_items_before: duplicateItems
  };
  const baseContext = {
    summary: String(mergePreview.preview?.summary || 'Collection merge').trim() || 'Collection merge',
    moved_item_count: 0,
    skipped_item_count: 0,
    resulting_collection: mergeResult
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const historyInsert = await client.query(
      `INSERT INTO collection_merge_history (
         canonical_collection_id, duplicate_collection_id, repair_type, snapshot, context, created_by
       ) VALUES (
         $1, $2, 'duplicate_attach', $3::jsonb, $4::jsonb, $5
       )
       RETURNING id`,
      [
        canonicalId,
        duplicateId,
        JSON.stringify(snapshot),
        JSON.stringify(baseContext),
        userId || null
      ]
    );
    const historyId = Number(historyInsert.rows[0]?.id || 0) || null;

    const existingKeys = new Set(canonicalItems.map((item) => buildCollectionItemIdentityKey(item)));
    let nextPosition = canonicalItems.reduce((maxValue, item) => Math.max(maxValue, Number(item.position || 0) || 0), 0);
    const movedItems = [];
    let skippedItemCount = 0;
    for (const item of duplicateItems) {
      const identityKey = buildCollectionItemIdentityKey(item);
      if (existingKeys.has(identityKey)) {
        skippedItemCount += 1;
        continue;
      }
      existingKeys.add(identityKey);
      nextPosition += 1;
      const inserted = await client.query(
        `INSERT INTO collection_items (
           collection_id, media_id, contained_title, position, confidence_score, resolution_status, source_payload
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7::jsonb
         )
         RETURNING id`,
        [
          canonicalId,
          item.media_id || null,
          item.contained_title || item.media_title || null,
          nextPosition,
          item.confidence_score === null || item.confidence_score === undefined ? null : Number(item.confidence_score),
          item.resolution_status || 'pending',
          item.source_payload && typeof item.source_payload === 'object' ? JSON.stringify(item.source_payload) : null
        ]
      );
      movedItems.push({
        original_duplicate_item_id: item.id,
        inserted_canonical_item_id: Number(inserted.rows[0]?.id || 0) || null,
        identity_key: identityKey
      });
    }

    await client.query(`DELETE FROM collection_items WHERE collection_id = $1`, [duplicateId]);
    await client.query(`DELETE FROM collections WHERE id = $1`, [duplicateId]);
    await client.query(
      `UPDATE collections
          SET name = $2,
              source_title = $3,
              expected_item_count = $4,
              metadata = $5::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [
        canonicalId,
        mergeResult.name || canonical.name || `Collection #${canonicalId}`,
        mergeResult.source_title || null,
        mergeResult.expected_item_count || null,
        JSON.stringify(mergedCollectionMetadata || {})
      ]
    );
    await client.query(
      `UPDATE collection_merge_history
          SET context = $2::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [
        historyId,
        JSON.stringify({
          ...baseContext,
          moved_item_count: movedItems.length,
          skipped_item_count: skippedItemCount,
          moved_items: movedItems
        })
      ]
    );
    await client.query('COMMIT');
    return {
      history_id: historyId,
      moved_item_count: movedItems.length,
      skipped_item_count: skippedItemCount
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function runManualCollectionMergeRevert({
  canonicalCollectionId,
  duplicateCollectionId
} = {}) {
  const canonicalId = Number(canonicalCollectionId || 0);
  const duplicateId = Number(duplicateCollectionId || 0);
  if (!canonicalId || !duplicateId || canonicalId === duplicateId) {
    throw new Error('Invalid collection merge revert pair');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const historyResult = await client.query(
      `SELECT id, snapshot, context, applied_at
         FROM collection_merge_history
        WHERE canonical_collection_id = $1
          AND duplicate_collection_id = $2
          AND repair_type = 'duplicate_attach'
          AND reverted_at IS NULL
        LIMIT 1`,
      [canonicalId, duplicateId]
    );
    const historyRow = historyResult.rows[0];
    if (!historyRow) {
      throw new Error('Active collection merge event was not found');
    }
    const newerActive = await client.query(
      `SELECT 1
         FROM collection_merge_history
        WHERE canonical_collection_id = $1
          AND id <> $2
          AND reverted_at IS NULL
          AND applied_at > $3
        LIMIT 1`,
      [canonicalId, historyRow.id, historyRow.applied_at]
    );
    if (newerActive.rows[0]) {
      const err = new Error('Only the latest collection merge event can be reverted right now');
      err.statusCode = 409;
      throw err;
    }

    const snapshot = historyRow.snapshot && typeof historyRow.snapshot === 'object' ? historyRow.snapshot : {};
    const context = historyRow.context && typeof historyRow.context === 'object' ? historyRow.context : {};
    const canonicalBefore = snapshot.canonical_before && typeof snapshot.canonical_before === 'object' ? snapshot.canonical_before : null;
    const duplicateBefore = snapshot.duplicate_before && typeof snapshot.duplicate_before === 'object' ? snapshot.duplicate_before : null;
    const duplicateItemsBefore = Array.isArray(snapshot.duplicate_items_before) ? snapshot.duplicate_items_before : [];
    const movedItems = Array.isArray(context.moved_items) ? context.moved_items : [];

    if (!canonicalBefore || !duplicateBefore) {
      throw new Error('Collection merge snapshot is incomplete');
    }

    await client.query(
      `DELETE FROM collection_items
        WHERE collection_id = $1
          AND id = ANY($2::int[])`,
      [
        canonicalId,
        movedItems.map((item) => Number(item.inserted_canonical_item_id || 0)).filter((value) => value > 0)
      ]
    );

    await client.query(
      `UPDATE collections
          SET name = $2,
              source_title = $3,
              import_source = $4,
              expected_item_count = $5,
              metadata = $6::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [
        canonicalId,
        canonicalBefore.name || `Collection #${canonicalId}`,
        canonicalBefore.source_title || null,
        canonicalBefore.import_source || null,
        canonicalBefore.expected_item_count || null,
        JSON.stringify(canonicalBefore.metadata || {})
      ]
    );

    await client.query(
      `INSERT INTO collections (
         id, name, media_type, source_title, import_source, expected_item_count, metadata,
         library_id, space_id, created_by, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12
       )`,
      [
        duplicateBefore.id,
        duplicateBefore.name || `Collection #${duplicateId}`,
        duplicateBefore.media_type || null,
        duplicateBefore.source_title || null,
        duplicateBefore.import_source || null,
        duplicateBefore.expected_item_count || null,
        JSON.stringify(duplicateBefore.metadata || {}),
        duplicateBefore.library_id || null,
        duplicateBefore.space_id || null,
        duplicateBefore.created_by || null,
        duplicateBefore.created_at || new Date().toISOString(),
        duplicateBefore.updated_at || new Date().toISOString()
      ]
    );

    for (const item of duplicateItemsBefore) {
      await client.query(
        `INSERT INTO collection_items (
           id, collection_id, media_id, contained_title, position, confidence_score,
           resolution_status, source_payload, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10
         )`,
        [
          item.id,
          duplicateBefore.id,
          item.media_id || null,
          item.contained_title || null,
          item.position === null || item.position === undefined ? null : Number(item.position),
          item.confidence_score === null || item.confidence_score === undefined ? null : Number(item.confidence_score),
          item.resolution_status || 'pending',
          item.source_payload && typeof item.source_payload === 'object' ? JSON.stringify(item.source_payload) : null,
          item.created_at || new Date().toISOString(),
          item.updated_at || new Date().toISOString()
        ]
      );
    }

    await client.query(
      `SELECT setval(pg_get_serial_sequence('collections', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM collections), 1), true)`
    );
    await client.query(
      `SELECT setval(pg_get_serial_sequence('collection_items', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM collection_items), 1), true)`
    );
    await client.query(
      `UPDATE collection_merge_history
          SET reverted_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [historyRow.id]
    );
    await client.query('COMMIT');
    return {
      reverted: true,
      restored_item_count: duplicateItemsBefore.length
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function recordManualMergeRecommendationFeedback({
  canonicalMediaId,
  duplicateMediaId,
  outcome = 'rejected',
  scopeContext = null,
  userId = null,
  reasonCode = null,
  reason = null,
  preview = null
} = {}) {
  const pairKey = buildRecommendationPairKey(canonicalMediaId, duplicateMediaId);
  if (!pairKey) {
    throw new Error('Invalid recommendation pair');
  }
  const normalizedOutcome = String(outcome || 'rejected').trim().toLowerCase();
  if (!['rejected', 'deferred'].includes(normalizedOutcome)) {
    throw new Error('Invalid recommendation feedback outcome');
  }
  const previewEvidence = preview?.preview?.evidence || {};
  const payload = {
    action: normalizedOutcome === 'deferred'
      ? 'manual_merge_recommendation_deferred'
      : 'manual_merge_recommendation_rejected',
    summary: String(
      previewEvidence.summary
      || (normalizedOutcome === 'deferred' ? 'Deferred suggested merge' : 'Rejected suggested merge')
    ).trim() || (normalizedOutcome === 'deferred' ? 'Deferred suggested merge' : 'Rejected suggested merge'),
    confidence: String(previewEvidence.confidence || '').trim() || null,
    kind: String(previewEvidence.kind || '').trim() || null,
    key: String(previewEvidence.key || '').trim() || null,
    rationale: Array.isArray(previewEvidence.rationale) ? previewEvidence.rationale : [],
    reason_code: String(reasonCode || '').trim() || null,
    canonical: summarizeMergeSourceRow(preview?.canonical || {}),
    duplicate: summarizeMergeSourceRow(preview?.duplicate || {})
  };
  const values = [
    pairKey.pairLowId,
    pairKey.pairHighId,
    Number(canonicalMediaId || 0),
    Number(duplicateMediaId || 0),
    String(preview?.preview?.media_type || preview?.canonical?.media_type || '').trim() || null,
    reason,
    JSON.stringify(payload),
    scopeContext?.spaceId || null,
    scopeContext?.libraryId || null,
    userId || null
  ];
  const existing = await pool.query(
    `SELECT id
       FROM media_merge_recommendation_feedback
      WHERE pair_low_media_id = $1
        AND pair_high_media_id = $2
        AND outcome = $5
        AND COALESCE(space_id, 0) = COALESCE($3, 0)
        AND COALESCE(library_id, 0) = COALESCE($4, 0)
      LIMIT 1`,
    [pairKey.pairLowId, pairKey.pairHighId, scopeContext?.spaceId || null, scopeContext?.libraryId || null, normalizedOutcome]
  );
  const result = existing.rows?.[0]?.id
    ? await pool.query(
      `UPDATE media_merge_recommendation_feedback
          SET canonical_media_id = $3,
              duplicate_media_id = $4,
              media_type = $5,
              reason = $6,
              context = $7::jsonb,
              created_by = $10,
              created_at = CURRENT_TIMESTAMP
        WHERE id = $11
        RETURNING id, created_at`,
      [...values, Number(existing.rows[0].id)]
    )
    : await pool.query(
      `INSERT INTO media_merge_recommendation_feedback (
         pair_low_media_id,
         pair_high_media_id,
         canonical_media_id,
         duplicate_media_id,
         media_type,
         outcome,
         reason,
         context,
         space_id,
         library_id,
       created_by
       )
       VALUES ($1, $2, $3, $4, $5, $11, $6, $7::jsonb, $8, $9, $10)
       RETURNING id, created_at`,
      [...values, normalizedOutcome]
    );
  return {
    id: Number(result.rows?.[0]?.id || 0) || null,
    pair_key: pairKey.key,
    created_at: result.rows?.[0]?.created_at || null,
    outcome: normalizedOutcome,
    reason_code: payload.reason_code,
    reason: reason || null
  };
}

async function loadScopedMergeRecommendationFeedbackHistory({
  scopeContext = null,
  limit = 12,
  search = '',
  mediaType = null,
  outcome = null
} = {}) {
  const cappedLimit = Math.max(1, Math.min(50, Number(limit || 12) || 12));
  const normalizedSearch = String(search || '').trim();
  const normalizedMediaType = normalizeMergeReviewMediaTypeFilter(mediaType);
  const normalizedOutcome = normalizeRecommendationFeedbackOutcomeFilter(outcome);
  const params = [];
  let where = 'WHERE 1=1';
  if (normalizedOutcome) {
    params.push(normalizedOutcome);
    where += ` AND f.outcome = $${params.length}`;
  }
  if (normalizedMediaType) {
    params.push(normalizedMediaType);
    where += ` AND f.media_type = $${params.length}`;
  }
  if (normalizedSearch) {
    params.push(`%${normalizedSearch}%`);
    where += ` AND (
      COALESCE(canonical.title, '') ILIKE $${params.length}
      OR COALESCE(duplicate.title, '') ILIKE $${params.length}
      OR COALESCE(f.reason, '') ILIKE $${params.length}
    )`;
  }
  where += appendScopeSql(params, scopeContext, {
    spaceColumn: 'f.space_id',
    libraryColumn: 'f.library_id'
  });

  const result = await pool.query(
    `SELECT
       f.id,
       f.outcome,
       f.reason,
       f.context,
       f.media_type,
       f.created_at,
       f.created_by,
       f.canonical_media_id,
       f.duplicate_media_id,
       canonical.title AS canonical_title,
       canonical.import_source AS canonical_import_source,
       duplicate.title AS duplicate_title,
       duplicate.import_source AS duplicate_import_source,
       u.name AS created_by_name
     FROM media_merge_recommendation_feedback f
     LEFT JOIN media canonical ON canonical.id = f.canonical_media_id
     LEFT JOIN media duplicate ON duplicate.id = f.duplicate_media_id
     LEFT JOIN users u ON u.id = f.created_by
     ${where}
     ORDER BY f.created_at DESC, f.id DESC
     LIMIT ${cappedLimit}`,
    params
  );

  const items = (result.rows || []).map((row) => ({
    feedback_id: Number(row.id || 0) || null,
    outcome: String(row.outcome || '').trim() || null,
    media_type: String(row.media_type || '').trim() || null,
    reason: row.reason || null,
    reason_code: String(row?.context?.reason_code || '').trim() || null,
    created_at: row.created_at || null,
    created_by: Number(row.created_by || 0) || null,
    created_by_name: row.created_by_name || null,
    pair_key: buildRecommendationPairKey(row.canonical_media_id, row.duplicate_media_id)?.key || null,
    summary: String(row?.context?.summary || '').trim() || 'Suppressed pair',
    canonical: summarizeMergeSourceRow({
      id: row.canonical_media_id,
      title: row.canonical_title,
      media_type: row.media_type,
      import_source: row.canonical_import_source
    }),
    duplicate: summarizeMergeSourceRow({
      id: row.duplicate_media_id,
      title: row.duplicate_title,
      media_type: row.media_type,
      import_source: row.duplicate_import_source
    })
  }));

  return {
    summary: {
      total_items: items.length,
      rejected_items: items.filter((item) => item.outcome === 'rejected').length,
      deferred_items: items.filter((item) => item.outcome === 'deferred').length,
      returned_items: items.length
    },
    items
  };
}

async function restoreScopedMergeRecommendationFeedback({ feedbackId, scopeContext = null } = {}) {
  const id = Number(feedbackId || 0);
  if (!id) return null;
  const params = [id];
  const scopedClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'space_id',
    libraryColumn: 'library_id'
  });
  const existing = await pool.query(
    `SELECT id, outcome, reason, context, media_type, canonical_media_id, duplicate_media_id
       FROM media_merge_recommendation_feedback
      WHERE id = $1${scopedClause}
      LIMIT 1`,
    params
  );
  const row = existing.rows?.[0] || null;
  if (!row) return null;
  await pool.query('DELETE FROM media_merge_recommendation_feedback WHERE id = $1', [id]);
  return {
    feedback_id: Number(row.id || 0) || null,
    outcome: String(row.outcome || '').trim() || null,
    reason: row.reason || null,
    reason_code: String(row?.context?.reason_code || '').trim() || null,
    media_type: String(row.media_type || '').trim() || null,
    canonical_media_id: Number(row.canonical_media_id || 0) || null,
    duplicate_media_id: Number(row.duplicate_media_id || 0) || null,
    pair_key: buildRecommendationPairKey(row.canonical_media_id, row.duplicate_media_id)?.key || null
  };
}

function buildMergeTechnicalDetails({
  row = {},
  mergeEvidence = null
} = {}) {
  return {
    repair_type: String(row?.repair_type || 'duplicate_attach').trim() || 'duplicate_attach',
    merge_key: String(mergeEvidence?.key || '').trim() || null,
    canonical_id: Number(mergeEvidence?.canonical_selection?.canonical_id || row?.canonical_media_id || 0) || null,
    duplicate_id: Number(mergeEvidence?.canonical_selection?.duplicate_id || row?.duplicate_media_id || 0) || null,
    selection_reason: String(mergeEvidence?.canonical_selection?.selection_reason || '').trim() || null,
    applied_at: row?.applied_at || null,
    reverted_at: row?.reverted_at || null
  };
}

function formatManualMergeRejectionReasonLabel(reasonCode = '') {
  const normalized = String(reasonCode || '').trim();
  const labels = {
    different_title_identity: 'Different title identity',
    different_volume_or_edition: 'Different volume or edition',
    different_season_or_part: 'Different season or part',
    collection_wrapper_only: 'Collection wrapper only',
    other: 'Other'
  };
  return labels[normalized] || null;
}

function formatMergeRationaleLabel(token = '') {
  const normalized = String(token || '').trim();
  const labels = {
    normalized_isbn: 'ISBN',
    normalized_title: 'Title',
    normalized_author: 'Author',
    normalized_title_only: 'Title',
    provider_name: 'Provider name',
    provider_item_id: 'Provider item id',
    normalized_series: 'Series',
    normalized_issue_number: 'Issue number',
    normalized_volume: 'Volume'
  };
  return labels[normalized] || normalized.replace(/_/g, ' ');
}

function formatMergeFieldLabel(key = '') {
  const normalized = String(key || '').trim();
  const labels = {
    isbn: 'ISBN',
    author: 'Author',
    publisher: 'Publisher',
    edition: 'Edition',
    series: 'Series',
    issue_number: 'Issue number',
    volume: 'Volume',
    provider_issue_id: 'Provider issue id',
    provider_item_id: 'Provider item id',
    provider_name: 'Provider name',
    cover_date: 'Cover date',
    writer: 'Writer',
    artist: 'Artist',
    inker: 'Inker',
    colorist: 'Colorist'
  };
  return labels[normalized] || normalized.replace(/_/g, ' ');
}

function valuesEqualForMerge(left, right) {
  if (left === right) return true;
  if ((left === null || left === undefined || left === '') && (right === null || right === undefined || right === '')) return true;
  return String(left ?? '').trim() === String(right ?? '').trim();
}

function buildMergeFieldProvenance({
  currentTypeDetails = {},
  previousCanonicalTypeDetails = {},
  duplicateTypeDetails = {},
  mediaType = ''
} = {}) {
  const prioritizedKeys = mediaType === 'book'
    ? ['isbn', 'author', 'publisher', 'edition', 'provider_name', 'provider_item_id']
    : mediaType === 'comic_book'
      ? ['series', 'issue_number', 'volume', 'cover_date', 'publisher', 'provider_issue_id', 'provider_name', 'provider_item_id']
      : [];
  const keySet = new Set(prioritizedKeys);
  Object.keys(currentTypeDetails || {}).forEach((key) => keySet.add(key));
  Object.keys(previousCanonicalTypeDetails || {}).forEach((key) => keySet.add(key));
  Object.keys(duplicateTypeDetails || {}).forEach((key) => keySet.add(key));

  return Array.from(keySet)
    .filter(Boolean)
    .map((key) => {
      const currentValue = currentTypeDetails?.[key] ?? null;
      const canonicalValue = previousCanonicalTypeDetails?.[key] ?? null;
      const duplicateValue = duplicateTypeDetails?.[key] ?? null;
      if (
        currentValue === null && canonicalValue === null && duplicateValue === null
      ) return null;

      let usedFrom = 'resolved';
      if (valuesEqualForMerge(currentValue, canonicalValue) && valuesEqualForMerge(currentValue, duplicateValue)) {
        usedFrom = 'both';
      } else if (valuesEqualForMerge(currentValue, canonicalValue)) {
        usedFrom = 'canonical';
      } else if (valuesEqualForMerge(currentValue, duplicateValue)) {
        usedFrom = 'merged';
      }

      return {
        key,
        label: formatMergeFieldLabel(key),
        used_from: usedFrom,
        current_value: currentValue,
        canonical_value: canonicalValue,
        merged_value: duplicateValue
      };
    })
    .filter((entry) => entry && (entry.current_value !== null || entry.canonical_value !== null || entry.merged_value !== null));
}

function buildAggregateMergeFieldProvenance({
  currentTypeDetails = {},
  previousCanonicalTypeDetails = {},
  mergedTypeDetailsList = [],
  mediaType = ''
} = {}) {
  const prioritizedKeys = mediaType === 'book'
    ? ['isbn', 'author', 'publisher', 'edition', 'provider_name', 'provider_item_id']
    : mediaType === 'comic_book'
      ? ['series', 'issue_number', 'volume', 'cover_date', 'publisher', 'provider_issue_id', 'provider_name', 'provider_item_id']
      : [];
  const keySet = new Set(prioritizedKeys);
  Object.keys(currentTypeDetails || {}).forEach((key) => keySet.add(key));
  Object.keys(previousCanonicalTypeDetails || {}).forEach((key) => keySet.add(key));
  (Array.isArray(mergedTypeDetailsList) ? mergedTypeDetailsList : []).forEach((details) => {
    Object.keys(details && typeof details === 'object' ? details : {}).forEach((key) => keySet.add(key));
  });

  return Array.from(keySet)
    .filter(Boolean)
    .map((key) => {
      const currentValue = currentTypeDetails?.[key] ?? null;
      const canonicalValue = currentTypeDetails?.[key] ?? null;
      const mergedValues = (Array.isArray(mergedTypeDetailsList) ? mergedTypeDetailsList : [])
        .map((details) => (details && typeof details === 'object' ? (details[key] ?? null) : null));
      if (
        currentValue === null &&
        mergedValues.every((value) => value === null)
      ) return null;

      const canonicalMatched = true;
      const mergedSupportCount = mergedValues.filter((value) => valuesEqualForMerge(currentValue, value)).length;
      const totalSourceCount = 1 + mergedValues.length;
      const supportCount = (canonicalMatched ? 1 : 0) + mergedSupportCount;

      let usedFrom = 'resolved';
      if (supportCount === totalSourceCount && totalSourceCount > 1) {
        usedFrom = 'all_sources';
      } else if (canonicalMatched && mergedSupportCount > 0) {
        usedFrom = 'canonical_and_merged';
      } else if (canonicalMatched) {
        usedFrom = 'canonical';
      } else if (mergedSupportCount > 1) {
        usedFrom = 'merged_sources';
      } else if (mergedSupportCount === 1) {
        usedFrom = 'merged';
      }

      const distinctMergedValues = Array.from(new Set(
        mergedValues
          .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
          .map((value) => String(value))
      ));

      return {
        key,
        label: formatMergeFieldLabel(key),
        used_from: usedFrom,
        current_value: currentValue,
        canonical_value: canonicalValue,
        merged_values: distinctMergedValues,
        support_count: supportCount,
        total_source_count: totalSourceCount,
        merged_support_count: mergedSupportCount
      };
    })
    .filter((entry) => entry && (
      entry.current_value !== null ||
      entry.canonical_value !== null ||
      (Array.isArray(entry.merged_values) && entry.merged_values.length > 0)
    ));
}

function getManualMergeTypeDetailKeys(mediaType = '') {
  const normalized = String(mediaType || '').trim();
  if (normalized === 'book') {
    return ['isbn', 'author', 'publisher', 'edition', 'provider_name', 'provider_item_id'];
  }
  if (normalized === 'comic_book') {
    return ['series', 'issue_number', 'volume', 'cover_date', 'publisher', 'provider_issue_id', 'provider_name', 'provider_item_id'];
  }
  if (normalized === 'movie') {
    return ['edition'];
  }
  if (normalized === 'tv_series') {
    return ['network'];
  }
  if (normalized === 'audio') {
    return ['artist', 'album', 'track_count'];
  }
  if (normalized === 'game') {
    return ['platform', 'developer', 'region'];
  }
  return [];
}

function formatManualMergeFieldLabel(key = '') {
  const normalized = String(key || '').trim();
  const topLevelLabels = {
    title: 'Title',
    original_title: 'Original title',
    release_date: 'Release date',
    year: 'Year',
    format: 'Format',
    owned_formats: 'Owned formats',
    genre: 'Genre',
    director: 'Director',
    cast: 'Cast',
    runtime: 'Runtime',
    upc: 'UPC',
    location: 'Location',
    notes: 'Notes',
    season_number: 'Season number',
    episode_number: 'Episode number',
    episode_title: 'Episode title',
    network: 'Network',
    tmdb_id: 'TMDB id'
  };
  return topLevelLabels[normalized] || formatMergeFieldLabel(normalized);
}

function formatManualMergeValue(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
    return entries.length > 0 ? entries.join(', ') : null;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    return keys.length > 0 ? JSON.stringify(value) : null;
  }
  const trimmed = String(value).trim();
  return trimmed || null;
}

function formatManualMergeFieldValue(mediaType, key, value) {
  if (key === 'owned_formats') {
    const normalized = normalizeOwnedFormats(mediaType, value, null);
    if (normalized.length === 0) return null;
    return normalized
      .map((entry) => getOwnedFormatLabel(mediaType, entry) || entry)
      .join(', ');
  }
  if (key === 'format') {
    const normalized = normalizeOwnedFormatValue(mediaType, value);
    if (normalized) return getOwnedFormatLabel(mediaType, normalized) || normalized;
  }
  return formatManualMergeValue(value);
}

function chooseManualMergeResultValue(canonicalValue, duplicateValue) {
  const canonicalText = formatManualMergeValue(canonicalValue);
  const duplicateText = formatManualMergeValue(duplicateValue);
  if (canonicalText && duplicateText && canonicalText === duplicateText) {
    return {
      result_value: canonicalText,
      resolution: 'both'
    };
  }
  if (canonicalText) {
    return {
      result_value: canonicalText,
      resolution: 'canonical'
    };
  }
  if (duplicateText) {
    return {
      result_value: duplicateText,
      resolution: 'matched'
    };
  }
  return {
    result_value: null,
    resolution: 'empty'
  };
}

function chooseManualMergeFormatResult(mediaType, canonical = {}, duplicate = {}, key = 'format') {
  const merged = buildMergedOwnedFormatsPayload(
    mediaType,
    canonical.owned_formats,
    canonical.format,
    duplicate.owned_formats,
    duplicate.format
  );
  const resultValue = key === 'owned_formats'
    ? formatManualMergeFieldValue(mediaType, key, merged.ownedFormats)
    : formatManualMergeFieldValue(mediaType, key, merged.format);
  const canonicalValue = key === 'owned_formats'
    ? formatManualMergeFieldValue(mediaType, key, canonical.owned_formats)
    : formatManualMergeFieldValue(mediaType, key, canonical.format);
  const duplicateValue = key === 'owned_formats'
    ? formatManualMergeFieldValue(mediaType, key, duplicate.owned_formats)
    : formatManualMergeFieldValue(mediaType, key, duplicate.format);

  let resolution = 'empty';
  if (resultValue && canonicalValue && duplicateValue && resultValue === canonicalValue && resultValue === duplicateValue) {
    resolution = 'both';
  } else if (resultValue && canonicalValue && resultValue === canonicalValue) {
    resolution = 'canonical';
  } else if (resultValue && duplicateValue && resultValue === duplicateValue) {
    resolution = 'matched';
  } else if (resultValue) {
    resolution = 'merged';
  }

  return {
    result_value: resultValue,
    resolution
  };
}

function buildManualMergeEvidence(canonical = {}, duplicate = {}) {
  const mediaType = String(canonical.media_type || duplicate.media_type || '').trim();
  const builder = mediaType === 'comic_book'
    ? buildComicNormalizationIdentity
    : mediaType === 'book'
      ? buildBookNormalizationIdentity
      : null;
  const canonicalIdentity = builder ? builder(canonical) : null;
  const duplicateIdentity = builder ? builder(duplicate) : null;
  if (
    canonicalIdentity?.key
    && duplicateIdentity?.key
    && canonicalIdentity.key === duplicateIdentity.key
  ) {
    return {
      confidence: canonicalIdentity.confidence || duplicateIdentity.confidence || 'high',
      kind: canonicalIdentity.kind || duplicateIdentity.kind || null,
      key: canonicalIdentity.key,
      rationale: Array.isArray(canonicalIdentity.rationale) ? canonicalIdentity.rationale : [],
      summary: formatMergeMatchKind(canonicalIdentity.kind, mediaType),
      operator_review_required: true
    };
  }

  const canonicalTitle = normalizeText(canonical.title || '');
  const duplicateTitle = normalizeText(duplicate.title || '');
  const canonicalYear = String(canonical.year || '').trim() || null;
  const duplicateYear = String(duplicate.year || '').trim() || null;

  if (canonicalTitle && duplicateTitle && canonicalTitle === duplicateTitle && canonicalYear && duplicateYear && canonicalYear === duplicateYear) {
    return {
      confidence: 'medium',
      kind: 'title_year',
      key: `${mediaType}:title_year:${canonicalTitle}::${canonicalYear}`,
      rationale: ['normalized_title', 'year'],
      summary: 'Matched on title and year',
      operator_review_required: true
    };
  }

  if (canonicalTitle && duplicateTitle && canonicalTitle === duplicateTitle) {
    return {
      confidence: 'low',
      kind: 'title_only',
      key: `${mediaType}:title:${canonicalTitle}`,
      rationale: ['normalized_title_only'],
      summary: 'Matched on title',
      operator_review_required: true
    };
  }

  return {
    confidence: 'review',
    kind: 'same_type_manual_review',
    key: null,
    rationale: [],
    summary: 'Manual same-type review required',
    operator_review_required: true
  };
}

function buildManualMergeFieldComparisons(canonical = {}, duplicate = {}) {
  const mediaType = String(canonical.media_type || duplicate.media_type || '').trim();
  const fieldSpecs = [
    { key: 'title', source: 'top_level' },
    { key: 'original_title', source: 'top_level' },
    { key: 'release_date', source: 'top_level' },
    { key: 'year', source: 'top_level' },
    { key: 'format', source: 'top_level' },
    { key: 'owned_formats', source: 'top_level' },
    { key: 'genre', source: 'top_level' },
    { key: 'director', source: 'top_level' },
    { key: 'cast', source: 'top_level' },
    { key: 'runtime', source: 'top_level' },
    { key: 'season_number', source: 'top_level' },
    { key: 'episode_number', source: 'top_level' },
    { key: 'episode_title', source: 'top_level' },
    { key: 'network', source: 'top_level' },
    { key: 'upc', source: 'top_level' },
    { key: 'tmdb_id', source: 'top_level' },
    { key: 'location', source: 'top_level' },
    { key: 'notes', source: 'top_level' },
    ...getManualMergeTypeDetailKeys(mediaType).map((key) => ({ key, source: 'type_details' }))
  ];

  return fieldSpecs
    .map(({ key, source }) => {
      const canonicalRaw = source === 'type_details'
        ? (canonical.type_details && typeof canonical.type_details === 'object' ? canonical.type_details[key] : null)
        : canonical[key];
      const duplicateRaw = source === 'type_details'
        ? (duplicate.type_details && typeof duplicate.type_details === 'object' ? duplicate.type_details[key] : null)
        : duplicate[key];
      const canonicalValue = source === 'top_level'
        ? formatManualMergeFieldValue(mediaType, key, canonicalRaw)
        : formatManualMergeValue(canonicalRaw);
      const duplicateValue = source === 'top_level'
        ? formatManualMergeFieldValue(mediaType, key, duplicateRaw)
        : formatManualMergeValue(duplicateRaw);
      if (!canonicalValue && !duplicateValue) return null;
      const result = (source === 'top_level' && (key === 'format' || key === 'owned_formats'))
        ? chooseManualMergeFormatResult(mediaType, canonical, duplicate, key)
        : chooseManualMergeResultValue(canonicalRaw, duplicateRaw);
      return {
        key,
        label: formatManualMergeFieldLabel(key),
        source,
        canonical_value: canonicalValue,
        duplicate_value: duplicateValue,
        result_value: result.result_value,
        resolution: result.resolution
      };
    })
    .filter(Boolean);
}

async function loadManualMergeDependentSummary(duplicateMediaId) {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM collection_items WHERE media_id = $1) AS collection_item_count,
       (SELECT COUNT(*)::int FROM media_variants WHERE media_id = $1) AS variant_count,
       (SELECT COUNT(*)::int FROM media_seasons WHERE media_id = $1) AS season_count,
       (SELECT COUNT(*)::int FROM media WHERE series_id = $1) AS child_series_reference_count,
       (SELECT COUNT(*)::int FROM media_metadata WHERE media_id = $1) AS metadata_count,
       (SELECT COUNT(*)::int FROM media_genres WHERE media_id = $1) AS genre_link_count,
       (SELECT COUNT(*)::int FROM media_directors WHERE media_id = $1) AS director_link_count,
       (SELECT COUNT(*)::int FROM media_actors WHERE media_id = $1) AS actor_link_count`,
    [duplicateMediaId]
  );
  const row = result.rows[0] || {};
  const summary = {
    collection_items: Number(row.collection_item_count || 0),
    variants: Number(row.variant_count || 0),
    seasons: Number(row.season_count || 0),
    child_series_references: Number(row.child_series_reference_count || 0),
    metadata_entries: Number(row.metadata_count || 0),
    genre_links: Number(row.genre_link_count || 0),
    director_links: Number(row.director_link_count || 0),
    actor_links: Number(row.actor_link_count || 0)
  };
  return {
    ...summary,
    total: Object.values(summary).reduce((acc, value) => acc + Number(value || 0), 0)
  };
}

async function loadManualMergeHistoryContext(canonicalMediaId, duplicateMediaId) {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int
          FROM media_repair_history
         WHERE canonical_media_id = $1
           AND repair_type = 'duplicate_attach'
           AND reverted_at IS NULL) AS canonical_active_merge_count,
       (SELECT COUNT(*)::int
          FROM media_repair_history
         WHERE canonical_media_id = $2
           AND repair_type = 'duplicate_attach'
           AND reverted_at IS NULL) AS duplicate_active_merge_count,
       EXISTS(
         SELECT 1
           FROM media_repair_history
          WHERE duplicate_media_id = $2
            AND repair_type = 'duplicate_attach'
            AND reverted_at IS NULL
       ) AS duplicate_is_absorbed`,
    [canonicalMediaId, duplicateMediaId]
  );
  const row = result.rows[0] || {};
  return {
    canonical_active_merge_count: Number(row.canonical_active_merge_count || 0),
    duplicate_active_merge_count: Number(row.duplicate_active_merge_count || 0),
    duplicate_is_absorbed: Boolean(row.duplicate_is_absorbed)
  };
}

async function loadScopedManualMergePreview({ canonicalMediaId, duplicateMediaId, scopeContext = null }) {
  const [canonical, duplicate] = await Promise.all([
    loadScopedMediaItem(canonicalMediaId, scopeContext),
    loadScopedMediaItem(duplicateMediaId, scopeContext)
  ]);
  if (!canonical || !duplicate) return null;

  const canonicalMediaType = String(canonical.media_type || '').trim();
  const duplicateMediaType = String(duplicate.media_type || '').trim();
  if (canonicalMediaType !== duplicateMediaType) {
    return {
      allowed: false,
      reason: 'cross_type_merge_blocked',
      canonical: summarizeMergeSourceRow(canonical),
      duplicate: summarizeMergeSourceRow(duplicate),
      details: {
        canonical_media_type: canonicalMediaType || null,
        duplicate_media_type: duplicateMediaType || null
      }
    };
  }

  const recommendedCanonical = chooseCanonicalRow([canonical, duplicate]);
  const [dependentRewiring, historyContext] = await Promise.all([
    loadManualMergeDependentSummary(duplicateMediaId),
    loadManualMergeHistoryContext(canonicalMediaId, duplicateMediaId)
  ]);
  const evidence = buildManualMergeEvidence(canonical, duplicate);

  return {
    allowed: true,
    canonical: summarizeMergeSourceRow(canonical),
    duplicate: summarizeMergeSourceRow(duplicate),
    preview: {
      media_type: canonicalMediaType,
      operator_review_required: true,
      canonical_selection: {
        requested_canonical_id: canonicalMediaId,
        recommended_canonical_id: Number(recommendedCanonical?.id || 0) || canonicalMediaId,
        requested_matches_recommended: Number(recommendedCanonical?.id || 0) === Number(canonicalMediaId),
        selection_reason: CANONICAL_SELECTION_REASON
      },
      evidence,
      field_comparison: buildManualMergeFieldComparisons(canonical, duplicate),
      dependent_rewiring: dependentRewiring,
      history_context: historyContext
    }
  };
}

async function loadScopedMergeDetails(mediaId, scopeContext = null) {
  const canonical = await loadScopedMediaItem(mediaId, scopeContext);
  if (!canonical) return null;

  const historyResult = await pool.query(
    `SELECT canonical_media_id, duplicate_media_id, repair_type, snapshot, context, applied_at, reverted_at
       FROM media_repair_history
      WHERE canonical_media_id = $1
        AND repair_type = 'duplicate_attach'
      ORDER BY applied_at DESC NULLS LAST, duplicate_media_id DESC`,
    [mediaId]
  );

  const historyRows = (historyResult.rows || []).filter((row) => !row.reverted_at);
  if (historyRows.length === 0) {
    return {
      canonical: summarizeMergeSourceRow(canonical),
      summary: {
        merge_count: 0,
        active_merge_count: 0,
        source_count: 1,
        merged_source_count: 0,
        last_merge_at: null,
        merged_sources: [],
        field_provenance: [],
        match_summaries: [],
        rationale: []
      },
      entries: []
    };
  }

  const entries = historyRows.map((row) => {
    const snapshot = row.snapshot && typeof row.snapshot === 'object' ? row.snapshot : {};
    const context = row.context && typeof row.context === 'object' ? row.context : {};
    const mergeEvidence = context.mergeEvidence && typeof context.mergeEvidence === 'object'
      ? context.mergeEvidence
      : null;
    const duplicateMedia = snapshot.media && typeof snapshot.media === 'object' ? snapshot.media : {};
    const previousCanonicalTypeDetails = context.previousCanonicalTypeDetails && typeof context.previousCanonicalTypeDetails === 'object'
      ? context.previousCanonicalTypeDetails
      : {};
    const duplicateTypeDetails = duplicateMedia.type_details && typeof duplicateMedia.type_details === 'object'
      ? duplicateMedia.type_details
      : {};
    const canonicalRowForIdentity = {
      ...canonical,
      type_details: previousCanonicalTypeDetails
    };
    const duplicateRowForIdentity = {
      ...duplicateMedia,
      media_type: duplicateMedia.media_type || canonical.media_type,
      type_details: duplicateTypeDetails
    };
    const identity = canonical.media_type === 'comic_book'
      ? buildComicNormalizationIdentity(canonicalRowForIdentity)
      : buildBookNormalizationIdentity(canonicalRowForIdentity);
    const duplicateIdentity = canonical.media_type === 'comic_book'
      ? buildComicNormalizationIdentity(duplicateRowForIdentity)
      : buildBookNormalizationIdentity(duplicateRowForIdentity);
    const resolvedIdentity = identity?.key && duplicateIdentity?.key === identity.key ? identity : (duplicateIdentity || identity || null);
    const persistedKind = String(mergeEvidence?.kind || '').trim() || null;
    const persistedConfidence = String(mergeEvidence?.confidence || '').trim() || null;
    const persistedRationale = Array.isArray(mergeEvidence?.rationale) ? mergeEvidence.rationale : null;
    const matchKind = persistedKind || resolvedIdentity?.kind || null;
    const confidence = persistedConfidence || resolvedIdentity?.confidence || 'high';
    const rationale = persistedRationale || (Array.isArray(resolvedIdentity?.rationale) ? resolvedIdentity.rationale : []);

    return {
      duplicate_id: Number(row.duplicate_media_id || 0) || null,
      repair_type: String(row.repair_type || 'duplicate_attach').trim() || 'duplicate_attach',
      applied_at: row.applied_at || null,
      reverted_at: row.reverted_at || null,
      confidence,
      match_kind: matchKind,
      match_summary: formatMergeMatchKind(matchKind, canonical.media_type),
      rationale: rationale.map(formatMergeRationaleLabel),
      canonical: summarizeMergeSourceRow({
        ...canonical,
        type_details: previousCanonicalTypeDetails
      }),
      merged: summarizeMergeSourceRow(duplicateMedia),
      technical_details: buildMergeTechnicalDetails({
        row,
        mergeEvidence
      }),
      field_provenance: buildMergeFieldProvenance({
        currentTypeDetails: canonical.type_details || {},
        previousCanonicalTypeDetails,
        duplicateTypeDetails,
        mediaType: canonical.media_type
      })
    };
  });

  const uniqueMergedSourceMap = new Map();
  entries.forEach((entry) => {
    if (!entry?.merged?.id) return;
    if (!uniqueMergedSourceMap.has(entry.merged.id)) {
      uniqueMergedSourceMap.set(entry.merged.id, entry.merged);
    }
  });
  const mergedSources = Array.from(uniqueMergedSourceMap.values());
  const previousCanonicalTypeDetails = entries[0]?.canonical?.type_details && typeof entries[0].canonical.type_details === 'object'
    ? entries[0].canonical.type_details
    : {};
  const mergedTypeDetailsList = mergedSources
    .map((entry) => (entry?.type_details && typeof entry.type_details === 'object' ? entry.type_details : {}));
  const matchSummaries = Array.from(new Set(entries.map((entry) => entry?.match_summary).filter(Boolean)));
  const rationale = Array.from(new Set(entries.flatMap((entry) => Array.isArray(entry?.rationale) ? entry.rationale : []).filter(Boolean)));

  return {
    canonical: summarizeMergeSourceRow(canonical),
    summary: {
      merge_count: entries.length,
      active_merge_count: entries.length,
      source_count: 1 + mergedSources.length,
      merged_source_count: mergedSources.length,
      last_merge_at: entries[0]?.applied_at || null,
      merged_sources: mergedSources,
      field_provenance: buildAggregateMergeFieldProvenance({
        currentTypeDetails: canonical.type_details || {},
        previousCanonicalTypeDetails,
        mergedTypeDetailsList,
        mediaType: canonical.media_type
      }),
      match_summaries: matchSummaries,
      rationale
    },
    entries
  };
}

async function loadScopedMediaItem(mediaId, scopeContext = null) {
  const params = [mediaId];
  const scopeClause = appendScopeSql(params, scopeContext);
  const result = await pool.query(
    `SELECT media.*,
            COALESCE(season_stats.season_count, 0) AS tv_season_count,
            COALESCE(season_stats.completed_count, 0) AS tv_completed_season_count,
            CASE
              WHEN media.media_type = 'tv_series'
               AND COALESCE(season_stats.season_count, 0) > 0
               AND COALESCE(season_stats.season_count, 0) = COALESCE(season_stats.completed_count, 0)
                THEN TRUE
              ELSE FALSE
            END AS tv_all_seasons_completed
     FROM media
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS season_count,
              COUNT(*) FILTER (WHERE ms.is_complete = TRUE OR ms.watch_state = 'completed')::int AS completed_count
       FROM media_seasons ms
       WHERE ms.media_id = media.id
     ) season_stats ON TRUE
     WHERE media.id = $1${scopeClause}
     LIMIT 1`,
    params
  );
  return result.rows[0] ? attachSignaturesToMediaRecord(normalizeMediaRecord(result.rows[0])) : null;
}

async function loadScopedMediaLoan(loanId, scopeContext = null) {
  const params = [loanId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'ml.space_id',
    libraryColumn: 'ml.library_id'
  });
  const result = await pool.query(
    `SELECT ml.*,
            m.title AS media_title,
            m.media_type,
            m.poster_path,
            m.year
       FROM media_loans ml
       JOIN media m ON m.id = ml.media_id
      WHERE ml.id = $1${scopeClause}
      LIMIT 1`,
    params
  );
  return result.rows[0] ? formatMediaLoanRow(result.rows[0]) : null;
}

function formatLoanReminderEventRow(row = {}) {
  return {
    id: Number(row.id || 0) || null,
    loan_id: Number(row.loan_id || 0) || null,
    media_id: Number(row.media_id || 0) || null,
    library_id: Number(row.library_id || 0) || null,
    space_id: Number(row.space_id || 0) || null,
    phase: String(row.phase || '').trim() || null,
    trigger_source: String(row.trigger_source || '').trim() || null,
    status: String(row.status || '').trim() || null,
    sent_at: row.sent_at || null,
    triggered_by_user_id: Number(row.triggered_by_user_id || 0) || null,
    failure_summary: row.failure_summary || null,
    delivery_window_key: String(row.delivery_window_key || '').trim() || null
  };
}

async function loadLoanReminderEventsByLoanIds(loanIds = [], scopeContext = null) {
  const ids = Array.isArray(loanIds) ? loanIds.map((value) => Number(value || 0)).filter(Boolean) : [];
  if (ids.length === 0) return new Map();
  const params = [ids];
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'mlr.space_id',
    libraryColumn: 'mlr.library_id'
  });
  const result = await pool.query(
    `SELECT mlr.*
       FROM media_loan_reminders mlr
      WHERE mlr.loan_id = ANY($1::int[])${scopeClause}
      ORDER BY mlr.sent_at DESC, mlr.id DESC`,
    params
  );
  const grouped = new Map();
  for (const row of result.rows || []) {
    const loanId = Number(row.loan_id || 0) || null;
    if (!loanId) continue;
    if (!grouped.has(loanId)) grouped.set(loanId, []);
    grouped.get(loanId).push(formatLoanReminderEventRow(row));
  }
  return grouped;
}

async function persistMediaValuation(mediaId, valuation) {
  const result = await pool.query(
    `UPDATE media
     SET estimated_value_low = $2,
         estimated_value_mid = $3,
         estimated_value_high = $4,
         valuation_currency = $5,
         valuation_source = $6,
         valuation_last_updated = $7
     WHERE id = $1
     RETURNING *`,
    [
      mediaId,
      valuation.low,
      valuation.mid,
      valuation.high,
      valuation.currency,
      valuation.source,
      valuation.lastUpdatedAt
    ]
  );
  return normalizeMediaRecord(result.rows[0]);
}

function validateOwnedFormatsForType(mediaType, ownedFormats = []) {
  const allowed = new Set(getOwnedFormatOptions(mediaType).map((entry) => entry.value));
  const values = Array.isArray(ownedFormats)
    ? ownedFormats
    : (ownedFormats === null || ownedFormats === undefined || ownedFormats === '' ? [] : [ownedFormats]);
  const invalid = values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => !allowed.has(value));
  return invalid.length > 0 ? `Invalid owned_formats for ${mediaType}: ${invalid.join(', ')}` : null;
}

function getRowValue(row, name) {
  if (!row || !name) return '';
  const normalized = String(name).trim().toLowerCase();
  const key = Object.keys(row).find((k) => String(k).trim().toLowerCase() === normalized);
  return key ? row[key] : '';
}

function parseYear(value) {
  if (!value) return null;
  const yearMatch = String(value).match(/\b(18|19|20)\d{2}\b/);
  if (!yearMatch) return null;
  const year = Number(yearMatch[0]);
  return Number.isFinite(year) ? year : null;
}

function parseDateOnly(value) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseCalibreDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }
  return parseDateOnly(raw);
}

function normalizeCalibreRows(rows = []) {
  return rows.map((row) => {
    const value = (name) => getRowValue(row, name);
    const tags = String(value('tags') || '').toLowerCase();
    const formats = String(value('formats') || '').toLowerCase();
    const isComic = tags.includes('comic') || tags.includes('manga') || formats.includes('cbz') || formats.includes('cbr');
    const year = parseYear(value('pubdate') || value('date') || value('year'));
    const format = isComic ? 'Digital' : (normalizeMediaFormat(value('format')) || 'Digital');
    const ownedFormats = normalizeOwnedFormats(isComic ? 'comic_book' : 'book', null, format);
    const series = value('series');
    const seriesIndex = value('series_index') || value('series index') || value('index');

    return {
      title: value('title'),
      media_type: isComic ? 'comic_book' : 'book',
      original_title: value('original_title') || '',
      release_date: parseCalibreDate(value('pubdate') || value('date')),
      year: year ? String(year) : '',
      format,
      owned_formats: ownedFormats,
      genre: value('tags') || value('genre') || '',
      director: '',
      rating: value('rating') || '',
      user_rating: '',
      runtime: '',
      upc: value('ean') || value('upc') || '',
      signed_by: '',
      signed_role: '',
      signed_on: '',
      signed_at: '',
      location: '',
      notes: value('comments') || '',
      author: value('authors') || value('author') || '',
      isbn: value('isbn') || value('isbn13') || '',
      publisher: value('publisher') || '',
      edition: value('edition') || '',
      series,
      issue_number: seriesIndex
    };
  });
}

function normalizeSignedRole(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (['author', 'producer', 'cast'].includes(normalized)) return normalized;
  return null;
}

function normalizeTitleForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLookupTitle(value = '', mediaType = 'movie') {
  let text = String(value || '').trim();
  if (!text) return '';
  const typoMap = {
    edtion: 'edition',
    comming: 'coming',
    girfriend: 'girlfriend',
    butthead: 'butt-head',
    bluray: 'blu ray'
  };
  Object.entries(typoMap).forEach(([wrong, right]) => {
    text = text.replace(new RegExp(`\\b${wrong}\\b`, 'ig'), right);
  });
  // Remove explicit edition/noise tokens that commonly appear in export titles.
  text = text
    .replace(/\b(limited|collector'?s?|special|ultimate|deluxe|extended|anniversary)\s+edition\b/ig, '')
    .replace(/\b\d+\s*page\s+(limited\s+)?(edition\s+)?(gallery\s+)?book\b/ig, '')
    .replace(/\b(with|w\/)?\s*(digital\s+copy|digital\s+code|bonus\s+features?|bonus\s+content)\b/ig, '')
    .replace(/\b(steelbook|blu[\s-]?ray|dvd|uhd|4k|digital(\s+hd)?)\b/ig, '')
    .replace(/\s+\+\s+digital(\s+hd)?\b/ig, '')
    .replace(/\b(standard\s+edition)\b/ig, '')
    .replace(/\s*-\s*(xbox|playstation|ps[1-5]|nintendo|switch|wii|wii u|gamecube|dreamcast|sega|pc|steam)\b.*$/ig, '');
  if (mediaType === 'game') {
    text = text.replace(/\bfor\s+(xbox|playstation|nintendo|switch|wii|pc)\b.*$/ig, '');
  }
  text = text
    .replace(/\[([^\]]{1,80})\]/g, ' $1 ')
    .replace(/\(([^)]{1,80})\)/g, ' $1 ')
    .replace(/\buncut\b/ig, '')
    .replace(/\btheatrical\s+version\b/ig, '')
    .replace(/\bseason\s+\d+\b/ig, '')
    .replace(/\bpart\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/ig, '')
    .replace(/\bchapter\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/ig, '')
    .replace(/\bvol(?:ume)?\.?\s*[ivxlcdm\d]+\b/ig, '')
    .replace(/\bdisc\s*[ivxlcdm\d]+\b/ig, '');
  // Remove trailing parenthetical/bracket descriptors.
  text = text
    .replace(/\(([^)]*(edition|steelbook|dvd|blu[\s-]?ray|digital|uhd|4k)[^)]*)\)/ig, '')
    .replace(/\[([^\]]*(edition|steelbook|dvd|blu[\s-]?ray|digital|uhd|4k)[^\]]*)\]/ig, '')
    .replace(/\s*\+\s*[^+]{0,80}$/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*-\s*$/g, '')
    .trim();
  return text;
}

function buildLookupTitleCandidates(value = '', mediaType = 'movie') {
  const raw = String(value || '').trim();
  const normalized = normalizeLookupTitle(raw, mediaType);
  const candidates = [raw, normalized].filter(Boolean);
  const trailingArticleSwap = normalized.replace(/\b(.+),\s*(the|a|an)\b/i, '$2 $1').trim();
  if (trailingArticleSwap && trailingArticleSwap !== normalized) candidates.push(trailingArticleSwap);
  const bracketStripped = raw.replace(/\[[^\]]+\]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (bracketStripped && bracketStripped !== raw) candidates.push(normalizeLookupTitle(bracketStripped, mediaType));
  const dashBase = normalized.replace(/\s*-\s*[^-]{3,}$/g, '').trim();
  if (dashBase && dashBase !== normalized) candidates.push(dashBase);
  const colonBase = normalized.replace(/\s*:\s*[^:]{3,}$/g, '').trim();
  if (colonBase && colonBase !== normalized) candidates.push(colonBase);
  const volTrimmed = normalized
    .replace(/\b(v(ol)?\.?\s*\d+|volume\s*\d+|disc\s*\d+|part\s*\d+)\b/ig, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (volTrimmed && volTrimmed !== normalized) candidates.push(volTrimmed);
  if (normalized.includes('&')) candidates.push(normalized.replace(/\s*&\s*/g, ' and ').replace(/\s{2,}/g, ' ').trim());
  if (/\band\b/i.test(normalized)) candidates.push(normalized.replace(/\band\b/ig, '&').replace(/\s{2,}/g, ' ').trim());
  return [...new Set(candidates.filter(Boolean))].slice(0, 6);
}

function normalizeComicIssueToken(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .replace(/^#\s*/, '')
    .replace(/^(issue|no\.?)\s*/i, '')
    .trim()
    .toLowerCase();
}

function detectBoxedSetCandidate(title = '', notes = '') {
  const sourceTitle = String(title || '').trim();
  if (!sourceTitle) {
    return { isCandidate: false, expectedItemCount: null, containedTitles: [] };
  }
  const haystack = `${sourceTitle} ${String(notes || '')}`.toLowerCase();
  const countMatch = haystack.match(/\b(\d{1,3})\s*[- ]?(movie|movies|film|films|disc|discs|dvd|blu[-\s]?ray)\b/i);
  const expectedItemCount = countMatch ? Number(countMatch[1]) : null;
  const unit = String(countMatch?.[2] || '').toLowerCase();
  const hasCollectionKeyword = /\b(collection|set|pack|bundle|marathon|favorites?|anthology|trilogy)\b/i.test(haystack);
  const isMovieUnit = ['movie', 'movies', 'film', 'films'].includes(unit);
  const isDiscUnit = ['disc', 'discs', 'dvd', 'blu-ray', 'blu ray'].includes(unit);

  const containedTitles = [];
  const includesMatch = String(notes || '').match(/includes?\s*:\s*(.+)$/i);
  if (includesMatch?.[1]) {
    includesMatch[1]
      .split(/[|/;,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((value) => containedTitles.push(value));
  }

  const isLikelyCollection = Number.isFinite(expectedItemCount)
    && expectedItemCount > 1
    && (
      isMovieUnit
      || (isDiscUnit && hasCollectionKeyword)
      || hasCollectionKeyword
    );

  return {
    isCandidate: isLikelyCollection,
    expectedItemCount: Number.isFinite(expectedItemCount) ? expectedItemCount : null,
    containedTitles
  };
}

function extractComicIssueTokenFromTitle(title) {
  const value = String(title || '').trim();
  if (!value) return '';
  const hashMatch = value.match(/#\s*([A-Za-z0-9.-]+)/);
  if (hashMatch?.[1]) return normalizeComicIssueToken(hashMatch[1]);
  const issueMatch = value.match(/\b(?:issue|no\.?)\s*([A-Za-z0-9.-]+)/i);
  if (issueMatch?.[1]) return normalizeComicIssueToken(issueMatch[1]);
  return '';
}

function getComicIssueTokenFromCandidate(row = {}) {
  const issueFromDetails = normalizeComicIssueToken(row?.type_details?.issue_number || '');
  if (issueFromDetails) return issueFromDetails;
  return extractComicIssueTokenFromTitle(row?.title || row?.name || '');
}

function getComicIssueTokenFromItem(item = {}) {
  const issueFromDetails = normalizeComicIssueToken(item?.type_details?.issue_number || '');
  if (issueFromDetails) return issueFromDetails;
  return extractComicIssueTokenFromTitle(item?.title || '');
}

function pickBestTmdbMatch(results = [], title, year) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const targetTitle = normalizeTitleForMatch(title);
  const targetYear = Number.isFinite(Number(year)) ? Number(year) : null;
  let best = null;
  let bestScore = -Infinity;

  for (const row of results) {
    const candidateTitle = normalizeTitleForMatch(
      row.title || row.name || row.original_title || row.original_name || ''
    );
    const candidateYear = parseYear(row.release_date || row.first_air_date || '');
    let score = 0;
    if (targetTitle && candidateTitle) {
      if (candidateTitle === targetTitle) score += 100;
      else if (candidateTitle.startsWith(targetTitle) || targetTitle.startsWith(candidateTitle)) score += 60;
      else if (candidateTitle.includes(targetTitle) || targetTitle.includes(candidateTitle)) score += 35;
    }
    if (targetYear && candidateYear) {
      const delta = Math.abs(candidateYear - targetYear);
      if (delta === 0) score += 30;
      else if (delta <= 1) score += 20;
      else if (delta <= 2) score += 10;
    }
    if (row.vote_count) score += Math.min(10, Number(row.vote_count) / 500);
    if (!best || score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best || results[0];
}

function scoreTmdbMatchCandidate(row, title, year) {
  const targetTitle = normalizeTitleForMatch(title);
  const targetYear = Number.isFinite(Number(year)) ? Number(year) : null;
  const candidateTitle = normalizeTitleForMatch(
    row?.title || row?.name || row?.original_title || row?.original_name || ''
  );
  const candidateYear = parseYear(row?.release_date || row?.first_air_date || '');
  let score = 0;
  let exactTitle = false;
  if (targetTitle && candidateTitle) {
    if (candidateTitle === targetTitle) {
      score += 100;
      exactTitle = true;
    }
    else if (candidateTitle.startsWith(targetTitle) || targetTitle.startsWith(candidateTitle)) score += 60;
    else if (candidateTitle.includes(targetTitle) || targetTitle.includes(candidateTitle)) score += 35;
  }
  const yearDelta = targetYear && candidateYear ? Math.abs(candidateYear - targetYear) : null;
  if (targetYear && candidateYear) {
    if (yearDelta === 0) score += 30;
    else if (yearDelta <= 1) score += 20;
    else if (yearDelta <= 2) score += 10;
  }
  if (row?.vote_count) score += Math.min(10, Number(row.vote_count) / 500);
  return {
    score,
    exactTitle,
    yearDelta,
    candidateTitle,
    candidateYear: Number.isFinite(candidateYear) ? candidateYear : null
  };
}

async function findBestTmdbCandidate({
  title,
  year,
  config,
  tmdbType = 'movie',
  mediaType = 'movie',
  allowMultiFallback = false
}) {
  const titleCandidates = buildLookupTitleCandidates(title, mediaType).slice(0, 6);
  let bestCandidate = null;
  let bestLookupTitle = '';
  let bestScore = -Infinity;

  for (const lookupTitle of titleCandidates) {
    const results = await searchTmdbMovie(lookupTitle, year || undefined, config, tmdbType);
    const candidate = pickBestTmdbMatch(results, lookupTitle, year);
    if (!candidate) continue;
    const scored = scoreTmdbMatchCandidate(candidate, lookupTitle, year);
    if (!bestCandidate || scored.score > bestScore) {
      bestCandidate = candidate;
      bestLookupTitle = lookupTitle;
      bestScore = scored.score;
    }
    if (scored.exactTitle && scored.yearDelta === 0) break;
  }

  if (!bestCandidate && allowMultiFallback && tmdbType === 'movie') {
    for (const lookupTitle of titleCandidates) {
      const results = await searchTmdbMulti(lookupTitle, year || undefined, config);
      const candidate = pickBestTmdbMatch(results, lookupTitle, year);
      if (!candidate) continue;
      const scored = scoreTmdbMatchCandidate(candidate, lookupTitle, year);
      if (!bestCandidate || scored.score > bestScore) {
        bestCandidate = candidate;
        bestLookupTitle = lookupTitle;
        bestScore = scored.score;
      }
      if (scored.exactTitle && scored.yearDelta === 0) break;
    }
  }

  return {
    candidate: bestCandidate,
    lookupTitle: bestLookupTitle || String(title || '').trim()
  };
}

function pickBestProviderMatch(results = [], title, year, options = {}) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const targetTitle = normalizeTitleForMatch(title);
  const targetYear = Number.isFinite(Number(year)) ? Number(year) : null;
  const mediaType = normalizeMediaType(options.mediaType || '', 'movie');
  const targetComicIssue = mediaType === 'comic_book'
    ? normalizeComicIssueToken(options.comicIssueNumber || '')
    : '';
  let best = null;
  let bestScore = -Infinity;

  for (const row of results) {
    const candidateTitle = normalizeTitleForMatch(row.title || row.name || '');
    const candidateYear = parseYear(row.release_date || row.year || '');
    let score = 0;
    if (targetTitle && candidateTitle) {
      if (candidateTitle === targetTitle) score += 100;
      else if (candidateTitle.startsWith(targetTitle) || targetTitle.startsWith(candidateTitle)) score += 60;
      else if (candidateTitle.includes(targetTitle) || targetTitle.includes(candidateTitle)) score += 35;
    }
    if (targetYear && candidateYear) {
      const delta = Math.abs(candidateYear - targetYear);
      if (delta === 0) score += 20;
      else if (delta <= 1) score += 10;
      else if (delta <= 2) score += 5;
    }
    if (mediaType === 'comic_book' && targetComicIssue) {
      const candidateIssue = getComicIssueTokenFromCandidate(row);
      if (candidateIssue && candidateIssue === targetComicIssue) score += 120;
      else if (candidateIssue && candidateIssue !== targetComicIssue) score -= 240;
    }
    if (!best || score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best || results[0];
}

async function enrichImportItemByMediaType(item, config, cache, tracker = null) {
  const normalizedMediaType = normalizeMediaType(item.media_type || 'movie', 'movie');
  if (!item?.title) return item;
  if (!['book', 'audio', 'game', 'comic_book'].includes(normalizedMediaType)) return item;
  if (normalizedMediaType === 'comic_book') {
    const inferredIssue = getComicIssueTokenFromItem(item);
    if (inferredIssue) {
      item = {
        ...item,
        type_details: {
          ...(item.type_details || {}),
          issue_number: item?.type_details?.issue_number || inferredIssue
        }
      };
    }
  }

  const identifiers = resolveImportIdentifiers(item, item.identifiers || {});
  const cacheKey = `${normalizedMediaType}:q:${String(item.title).toLowerCase()}|${item.year || ''}|${identifiers.isbn || ''}|${identifiers.eanUpc || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return {
      ...item,
      ...cached,
      type_details: { ...(item.type_details || {}), ...(cached.type_details || {}) }
    };
  }

  try {
    let results = [];
    if (normalizedMediaType === 'book') {
      if (identifiers.isbn) {
        if (tracker) tracker.lookupPath.add('identifier_first:isbn');
        results = await searchBooksByIsbn(identifiers.isbn, config, 8);
      }
      if (!results.length) {
        if (tracker) tracker.lookupPath.add('title_fallback');
        const candidates = buildLookupTitleCandidates(item.title, normalizedMediaType);
        for (const candidateTitle of candidates) {
          // eslint-disable-next-line no-await-in-loop
          results = await searchBooksByTitle(
            candidateTitle,
            config,
            8,
            item.type_details?.author || item.director || ''
          );
          if (results.length) break;
        }
      }
    } else if (normalizedMediaType === 'comic_book') {
      if (tracker) tracker.lookupPath.add('title_fallback');
      const candidates = buildLookupTitleCandidates(item.title, normalizedMediaType);
      for (const candidateTitle of candidates) {
        // eslint-disable-next-line no-await-in-loop
        results = await searchComicsByTitle(candidateTitle, config, 8);
        if (results.length) break;
      }
    } else if (normalizedMediaType === 'audio') {
      if (identifiers.eanUpc && config.barcodeApiUrl && config.barcodeApiKey) {
        if (tracker) tracker.lookupPath.add('identifier_first:ean_upc');
        const lookup = await axios.get(config.barcodeApiUrl, {
          params: { [config.barcodeQueryParam || 'upc']: identifiers.eanUpc },
          headers: config.barcodeApiKeyHeader ? { [config.barcodeApiKeyHeader]: config.barcodeApiKey } : {},
          timeout: 20000
        });
        const matches = normalizeBarcodeMatches(lookup.data);
        if (matches.length) {
          results = matches
            .filter((m) => m?.title)
            .map((m) => ({
              title: m.title,
              year: parseYear(m.release_date || ''),
              release_date: m.release_date || null,
              overview: m.description || null,
              genre: null,
              external_url: null,
              poster_path: m.image || null,
              type_details: {
                artist: item.type_details?.artist || null,
                album: m.title,
                track_count: null
              }
            }));
        }
      }
      if (!results.length) {
        if (tracker) tracker.lookupPath.add('title_fallback');
        const candidates = buildLookupTitleCandidates(item.title, normalizedMediaType);
        for (const candidateTitle of candidates) {
          // eslint-disable-next-line no-await-in-loop
          results = await searchAudioByTitle(
            candidateTitle,
            config,
            8,
            item.type_details?.artist || item.director || ''
          );
          if (results.length) break;
        }
      }
    } else {
      if (GAME_UPC_FIRST_ENABLED && identifiers.eanUpc && config.barcodeApiUrl && config.barcodeApiKey) {
        if (tracker) tracker.lookupPath.add('identifier_first:ean_upc');
        try {
          const lookup = await axios.get(config.barcodeApiUrl, {
            params: { [config.barcodeQueryParam || 'upc']: identifiers.eanUpc },
            headers: config.barcodeApiKeyHeader ? { [config.barcodeApiKeyHeader]: config.barcodeApiKey } : {},
            timeout: 20000,
            validateStatus: () => true
          });
          if (lookup.status >= 400) {
            if (tracker) tracker.lookupStatus.add(`barcode:error:${lookup.status}`);
          } else {
            const matches = normalizeBarcodeMatches(lookup.data);
            if (matches.length) {
              if (tracker) tracker.lookupStatus.add('barcode:hit');
              const titleCandidate = matches[0]?.title || '';
              if (titleCandidate) {
                try {
                  results = await searchGamesByTitle(titleCandidate, config, 8);
                  if (results.length && tracker) tracker.lookupStatus.add('igdb:upc_title:hit');
                } catch (error) {
                  const status = Number(error?.status || error?.response?.status || 0) || 'unknown';
                  if (tracker) tracker.lookupStatus.add(`igdb:upc_title:error:${status}`);
                }
              }
            } else if (tracker) {
              tracker.lookupStatus.add('barcode:no_hit');
            }
          }
        } catch (error) {
          const status = Number(error?.status || error?.response?.status || 0) || 'unknown';
          if (tracker) tracker.lookupStatus.add(`barcode:error:${status}`);
        }
      }
      if (!results.length) {
        if (tracker) tracker.lookupPath.add('title_fallback');
        const candidates = buildLookupTitleCandidates(item.title, normalizedMediaType);
        for (const candidateTitle of candidates) {
          try {
            // eslint-disable-next-line no-await-in-loop
            results = await searchGamesByTitle(candidateTitle, config, 8);
            if (results.length) {
              if (tracker) tracker.lookupStatus.add('igdb:title:hit');
              break;
            }
          } catch (error) {
            const status = Number(error?.status || error?.response?.status || 0) || 'unknown';
            if (tracker) tracker.lookupStatus.add(`igdb:title:error:${status}`);
          }
        }
      }
      if (!results.length && tracker && !Array.from(tracker.lookupStatus).some((s) => s.includes(':error:'))) {
        tracker.lookupStatus.add('igdb:title:no_hit');
      }
    }
    const best = pickBestProviderMatch(results, item.title, item.year, {
      mediaType: normalizedMediaType,
      comicIssueNumber: normalizedMediaType === 'comic_book' ? item?.type_details?.issue_number : ''
    }) || null;
    if (!best) {
      if (tracker) tracker.lookupStatus.add(`provider:${normalizedMediaType}:no_hit`);
      cache.set(cacheKey, {});
      return item;
    }
    if (tracker) tracker.providerMatched = true;
    if (tracker) tracker.lookupStatus.add(`provider:${normalizedMediaType}:hit`);

    const bestTypeDetails = best.type_details || {};
    const incomingTypeDetails = item.type_details || {};
    const enriched = {
      year: item.year || best.year || parseYear(best.release_date) || null,
      release_date: item.release_date || best.release_date || null,
      overview: item.overview || best.overview || null,
      genre: item.genre || best.genre || null,
      poster_path: item.poster_path || best.poster_path || null,
      tmdb_url: item.tmdb_url || best.external_url || null,
      type_details: {
        ...incomingTypeDetails,
        author: incomingTypeDetails.author || bestTypeDetails.author || null,
        isbn: incomingTypeDetails.isbn || bestTypeDetails.isbn || null,
        publisher: incomingTypeDetails.publisher || bestTypeDetails.publisher || null,
        edition: incomingTypeDetails.edition || bestTypeDetails.edition || null,
        series: incomingTypeDetails.series || bestTypeDetails.series || null,
        issue_number: incomingTypeDetails.issue_number || bestTypeDetails.issue_number || null,
        provider_issue_id: incomingTypeDetails.provider_issue_id || bestTypeDetails.provider_issue_id || best.id || null,
        volume: incomingTypeDetails.volume || bestTypeDetails.volume || null,
        writer: incomingTypeDetails.writer || bestTypeDetails.writer || null,
        artist: incomingTypeDetails.artist || bestTypeDetails.artist || null,
        album: incomingTypeDetails.album || bestTypeDetails.album || null,
        track_count: incomingTypeDetails.track_count || bestTypeDetails.track_count || null,
        platform: incomingTypeDetails.platform || bestTypeDetails.platform || null,
        developer: incomingTypeDetails.developer || bestTypeDetails.developer || null,
        region: incomingTypeDetails.region || bestTypeDetails.region || null,
        inker: incomingTypeDetails.inker || bestTypeDetails.inker || null,
        colorist: incomingTypeDetails.colorist || bestTypeDetails.colorist || null,
        cover_date: incomingTypeDetails.cover_date || bestTypeDetails.cover_date || null
      }
    };

    cache.set(cacheKey, enriched);
    return {
      ...item,
      ...enriched,
      type_details: { ...(item.type_details || {}), ...(enriched.type_details || {}) }
    };
  } catch (_error) {
    if (tracker) {
      const status = Number(_error?.status || _error?.response?.status || 0) || 'unknown';
      tracker.lookupStatus.add(`provider:${normalizedMediaType}:error:${status}`);
    }
    cache.set(cacheKey, {});
    return item;
  }
}

async function enrichImportItemWithTmdb(item, config, cache, options = {}, tracker = null) {
  const lookupTitle = String(options.lookupTitle || item?.title || '').trim();
  if (!config?.tmdbApiKey || !lookupTitle) return item;
  const normalizedMediaType = normalizeMediaType(item.media_type || 'movie', 'movie');
  if (!['movie', 'tv_series', 'tv_episode'].includes(normalizedMediaType)) {
    return item;
  }
  const tmdbType = normalizedMediaType === 'tv_series' || normalizedMediaType === 'tv_episode' ? 'tv' : 'movie';

  const cacheKey = item.tmdb_id
    ? `${tmdbType}:id:${item.tmdb_id}`
    : `${tmdbType}:q:${String(lookupTitle).toLowerCase()}|${item.year || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return {
      ...item,
      ...cached,
      ...buildOwnedFormatsPayload(item.media_type || 'movie', item.owned_formats, item.format)
    };
  }

  try {
    let candidate = null;
    if (item.tmdb_id) {
      candidate = { id: item.tmdb_id };
      if (tracker) tracker.lookupStatus.add('tmdb:id_hint');
    } else {
      const resolved = await findBestTmdbCandidate({
        title: lookupTitle,
        year: item.year,
        config,
        tmdbType,
        mediaType: normalizedMediaType,
        allowMultiFallback: normalizedMediaType === 'movie'
      });
      candidate = resolved.candidate || null;
      if (candidate && normalizedMediaType === 'movie' && normalizeTitleForMatch(resolved.lookupTitle) !== normalizeTitleForMatch(lookupTitle) && tracker) {
        tracker.lookupStatus.add('tmdb:title_variant_hit');
      }
    }
    if (!candidate?.id) {
      if (tracker) tracker.lookupStatus.add('tmdb:no_hit');
      cache.set(cacheKey, {});
      return item;
    }
    if (tracker) tracker.lookupStatus.add('tmdb:hit');

    const details = await fetchTmdbMovieDetails(candidate.id, config, tmdbType);
    const enriched = {
      tmdb_id: candidate.id,
      tmdb_media_type: tmdbType,
      tmdb_url: details?.tmdb_url || `https://www.themoviedb.org/${tmdbType}/${candidate.id}`,
      poster_path: details?.poster_path || candidate?.poster_path || null,
      backdrop_path: details?.backdrop_path || candidate?.backdrop_path || null,
      overview: details?.overview || candidate?.overview || null,
      rating: details?.rating ?? candidate?.rating ?? candidate?.vote_average ?? null,
      runtime: details?.runtime || item.runtime || null,
      director: details?.director || item.director || null,
      cast: details?.cast || item.cast || null,
      trailer_url: details?.trailer_url || item.trailer_url || null,
      release_date: details?.release_date || item.release_date || null,
      year: item.year || parseYear(details?.release_date),
      original_title: item.original_title || candidate?.original_title || candidate?.original_name || null
    };
    cache.set(cacheKey, enriched);
    return {
      ...item,
      ...enriched,
      ...buildOwnedFormatsPayload(item.media_type || 'movie', item.owned_formats, item.format)
    };
  } catch (_error) {
    if (tracker) {
      const status = Number(_error?.status || _error?.response?.status || 0) || 'unknown';
      tracker.lookupStatus.add(`tmdb:error:${status}`);
    }
    cache.set(cacheKey, {});
    return item;
  }
}

function hasEnrichmentDelta(before, after) {
  const fields = [
    'tmdb_id', 'tmdb_url', 'poster_path', 'backdrop_path', 'overview',
    'director', 'cast', 'genre', 'rating', 'runtime', 'trailer_url', 'release_date', 'year'
  ];
  for (const key of fields) {
    const prev = before?.[key];
    const next = after?.[key];
    if ((prev === null || prev === undefined || prev === '') && (next !== null && next !== undefined && next !== '')) {
      return true;
    }
  }
  return false;
}

function pickBestBarcodeMatch(matches = [], sourceTitle = '') {
  if (!Array.isArray(matches) || !matches.length) return null;
  const target = normalizeTitleForMatch(sourceTitle);
  if (!target) return matches[0];
  let best = null;
  let bestScore = -1;
  for (const match of matches) {
    const title = normalizeTitleForMatch(match?.title || '');
    if (!title) continue;
    let score = 0;
    if (title === target) score = 100;
    else if (title.includes(target) || target.includes(title)) score = 60;
    if (score > bestScore) {
      best = match;
      bestScore = score;
    }
  }
  return best || matches[0];
}

async function enrichMovieFromBarcode(item, config, cache, identifiers = {}) {
  const normalizedType = normalizeMediaType(item.media_type || 'movie', 'movie');
  if (normalizedType !== 'movie') return { item, attempted: false, barcodeTitleHint: '', matched: false };
  const eanUpc = String(identifiers.eanUpc || identifiers.ean_upc || item.upc || '').trim();
  if (!eanUpc) return { item, attempted: false, barcodeTitleHint: '', matched: false };
  if (!config?.barcodeApiUrl || !config?.barcodeApiKey) return { item, attempted: false, barcodeTitleHint: '', matched: false };

  const cacheKey = `movie:barcode:${eanUpc}`;
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey) || {};
    return {
      item: {
        ...item,
        overview: item.overview || cached.overview || null,
        poster_path: item.poster_path || cached.poster_path || null,
        upc: item.upc || eanUpc
      },
      attempted: true,
      barcodeTitleHint: cached.titleHint || '',
      matched: Boolean(cached.titleHint || cached.poster_path || cached.overview)
    };
  }

  try {
    const barcodeResponse = await axios.get(config.barcodeApiUrl, {
      params: { [config.barcodeQueryParam || 'upc']: eanUpc },
      headers: config.barcodeApiKeyHeader ? { [config.barcodeApiKeyHeader]: config.barcodeApiKey } : {},
      timeout: 20000,
      validateStatus: () => true
    });
    if (barcodeResponse.status >= 400) {
      cache.set(cacheKey, {});
      return { item, attempted: true, barcodeTitleHint: '', matched: false };
    }
    const matches = normalizeBarcodeMatches(barcodeResponse.data);
    const best = pickBestBarcodeMatch(matches, item.title);
    if (!best) {
      cache.set(cacheKey, {});
      return { item, attempted: true, barcodeTitleHint: '', matched: false };
    }
    const cached = {
      titleHint: best.title || '',
      overview: best.description || null,
      poster_path: best.image || null
    };
    cache.set(cacheKey, cached);
    return {
      item: {
        ...item,
        overview: item.overview || cached.overview || null,
        poster_path: item.poster_path || cached.poster_path || null,
        upc: item.upc || eanUpc
      },
      attempted: true,
      barcodeTitleHint: cached.titleHint,
      matched: true
    };
  } catch (_error) {
    cache.set(cacheKey, {});
    return { item, attempted: true, barcodeTitleHint: '', matched: false };
  }
}

async function runImportEnrichmentPipeline(item, config, caches, identifiers = {}) {
  const normalizedType = normalizeMediaType(item.media_type || 'movie', 'movie');
  let working = { ...item };
  let attempted = false;
  let enriched = false;
  const tracker = { lookupPath: new Set(), lookupStatus: new Set(), providerMatched: false };

  if (['book', 'audio', 'game', 'comic_book'].includes(normalizedType)) {
    attempted = true;
    const before = { ...working };
    working = await enrichImportItemByMediaType({ ...working, identifiers }, config, caches.providerCache, tracker);
    enriched = enriched || hasEnrichmentDelta(before, working);
  }

  if (normalizedType === 'movie') {
    const beforeBarcode = { ...working };
    if (identifiers.eanUpc) tracker.lookupPath.add('identifier_first:ean_upc');
    const barcode = await enrichMovieFromBarcode(working, config, caches.providerCache, identifiers);
    if (barcode.matched) tracker.providerMatched = true;
    if (barcode.attempted) attempted = true;
    working = barcode.item;
    enriched = enriched || hasEnrichmentDelta(beforeBarcode, working);

    const beforeTmdbHint = { ...working };
    if (barcode.barcodeTitleHint && normalizeTitleForMatch(barcode.barcodeTitleHint) !== normalizeTitleForMatch(working.title)) {
      tracker.lookupPath.add('title_fallback:barcode_hint');
      working = await enrichImportItemWithTmdb(working, config, caches.tmdbCache, { lookupTitle: barcode.barcodeTitleHint }, tracker);
      attempted = true;
      if (working.tmdb_id) tracker.providerMatched = true;
      enriched = enriched || hasEnrichmentDelta(beforeTmdbHint, working);
    }
  }

  if (['movie', 'tv_series', 'tv_episode'].includes(normalizedType)) {
    const beforeTmdb = { ...working };
    const candidates = buildLookupTitleCandidates(working.title, normalizedType);
    tracker.lookupPath.add('title_fallback');
    for (const lookupTitle of candidates) {
      // eslint-disable-next-line no-await-in-loop
      working = await enrichImportItemWithTmdb(working, config, caches.tmdbCache, { lookupTitle }, tracker);
      if (working.tmdb_id) tracker.providerMatched = true;
      if (working.tmdb_id) break;
    }
    attempted = true;
    enriched = enriched || hasEnrichmentDelta(beforeTmdb, working);
  }

  const enrichmentStatus = attempted ? ((enriched || tracker.providerMatched) ? 'enriched' : 'no_match') : 'not_applicable';
  const lookupPath = Array.from(tracker.lookupPath).join('|') || 'none';
  const lookupStatus = Array.from(tracker.lookupStatus).join('|') || 'none';
  return { item: working, enrichmentStatus, lookupPath, lookupStatus };
}

function resolveImportIdentifiers(item = {}, inputIdentifiers = {}) {
  return normalizeIdentifierSet({
    isbn: inputIdentifiers.isbn || item.type_details?.isbn || '',
    ean_upc: inputIdentifiers.eanUpc || inputIdentifiers.ean_upc || item.upc || '',
    asin: inputIdentifiers.asin || inputIdentifiers.amazon_item_id || item.amazon_item_id || ''
  });
}

function getIdentifierMatchPriority({ mediaType, importSource }) {
  const normalizedMediaType = normalizeMediaType(mediaType || 'movie', 'movie');
  const normalizedSource = String(importSource || '').trim().toLowerCase();
  if (normalizedMediaType === 'book') return ['isbn', 'ean_upc', 'asin'];
  if (normalizedMediaType === 'game') {
    return normalizedSource === 'csv_delicious'
      ? ['ean_upc', 'asin', 'isbn']
      : ['ean_upc', 'isbn', 'asin'];
  }
  if (normalizedMediaType === 'audio') return ['ean_upc', 'asin', 'isbn'];
  return ['ean_upc', 'isbn', 'asin'];
}

async function findExistingByIdentifier({ identifierType, identifierValue, normalizedMediaType, scopeContext = null }) {
  if (!identifierValue) return { row: null, conflict: false };
  const params = [normalizedMediaType, identifierValue];
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'm.space_id',
    libraryColumn: 'm.library_id'
  });
  let condition = '';
  if (identifierType === 'isbn') {
    const aliasKey = buildMediaIdentityAliasKey('isbn', identifierValue);
    condition = `(COALESCE(m.type_details->>'isbn', '') = $2 OR (mm."key" = 'isbn' AND mm."value" = $2)${aliasKey ? ` OR mm."key" = '${aliasKey.replace(/'/g, "''")}'` : ''})`;
  } else if (identifierType === 'ean_upc') {
    const aliasKey = buildMediaIdentityAliasKey('eanUpc', identifierValue);
    condition = `(COALESCE(m.upc, '') = $2 OR (mm."key" IN ('ean', 'ean_upc', 'upc') AND mm."value" = $2)${aliasKey ? ` OR mm."key" = '${aliasKey.replace(/'/g, "''")}'` : ''})`;
  } else if (identifierType === 'asin') {
    const aliasKey = buildMediaIdentityAliasKey('amazonItemId', identifierValue);
    condition = `((mm."key" = 'amazon_item_id' AND mm."value" = $2)${aliasKey ? ` OR mm."key" = '${aliasKey.replace(/'/g, "''")}'` : ''})`;
  } else {
    return { row: null, conflict: false };
  }

  const result = await pool.query(
    `SELECT DISTINCT m.id
     FROM media m
     LEFT JOIN media_metadata mm ON mm.media_id = m.id
     WHERE COALESCE(m.media_type, 'movie') = $1
       AND ${condition}
       ${scopeClause}
     ORDER BY m.id DESC
     LIMIT 2`,
    params
  );
  return {
    row: result.rows[0] || null,
    conflict: result.rows.length > 1
  };
}

async function findExistingByProviderIds({ item, normalizedMediaType, normalizedTmdbType, scopeContext = null }) {
  const providerItemId = String(
    item?.type_details?.provider_item_id || item?.type_details?.calibre_entry_id || item?.provider_item_id || ''
  ).trim();
  if (providerItemId) {
    const providerItemAliasKey = buildMediaIdentityAliasKey('providerItemId', providerItemId);
    const calibreEntryAliasKey = buildMediaIdentityAliasKey('calibreEntryId', providerItemId);
    const params = [providerItemId, normalizedMediaType];
    const scopeClause = appendScopeSql(params, scopeContext, {
      spaceColumn: 'm.space_id',
      libraryColumn: 'm.library_id'
    });
    const byProviderItemId = await pool.query(
      `SELECT DISTINCT m.id
       FROM media m
       LEFT JOIN media_metadata mm ON mm.media_id = m.id
       WHERE COALESCE(m.media_type, 'movie') = $2
         AND (
           COALESCE(m.type_details->>'provider_item_id', '') = $1
           OR COALESCE(m.type_details->>'calibre_entry_id', '') = $1
           OR (mm."key" = 'provider_item_id' AND mm."value" = $1)
           OR (mm."key" = 'calibre_entry_id' AND mm."value" = $1)
           ${providerItemAliasKey ? `OR mm."key" = '${providerItemAliasKey.replace(/'/g, "''")}'` : ''}
           ${calibreEntryAliasKey ? `OR mm."key" = '${calibreEntryAliasKey.replace(/'/g, "''")}'` : ''}
         )
         ${scopeClause}
       ORDER BY m.id DESC
       LIMIT 1`,
      params
    );
    if (byProviderItemId.rows[0]) {
      return { row: byProviderItemId.rows[0], matchedBy: 'provider_item_id' };
    }
  }

  if (normalizedMediaType === 'comic_book') {
    const providerIssueId = String(
      item?.type_details?.provider_issue_id || item?.provider_issue_id || ''
    ).trim();
    if (providerIssueId) {
      const providerIssueAliasKey = buildMediaIdentityAliasKey('providerIssueId', providerIssueId);
      const params = [providerIssueId, normalizedMediaType];
      const scopeClause = appendScopeSql(params, scopeContext, {
        spaceColumn: 'm.space_id',
        libraryColumn: 'm.library_id'
      });
      const byProviderIssueId = await pool.query(
        `SELECT DISTINCT m.id
         FROM media m
         LEFT JOIN media_metadata mm ON mm.media_id = m.id
         WHERE COALESCE(m.media_type, 'movie') = $2
           AND (
             COALESCE(m.type_details->>'provider_issue_id', '') = $1
             OR (mm."key" = 'metron_issue_id' AND mm."value" = $1)
             ${providerIssueAliasKey ? `OR mm."key" = '${providerIssueAliasKey.replace(/'/g, "''")}'` : ''}
           )
           ${scopeClause}
         ORDER BY m.id DESC
         LIMIT 1`,
        params
      );
      if (byProviderIssueId.rows[0]) {
        return { row: byProviderIssueId.rows[0], matchedBy: 'provider_issue_id' };
      }
    }
  }

  if (item.tmdb_id) {
    const params = [item.tmdb_id, normalizedTmdbType, normalizedMediaType];
    const scopeClause = appendScopeSql(params, scopeContext);
    const byTmdb = await pool.query(
      `SELECT id
       FROM media
       WHERE tmdb_id = $1
         AND COALESCE(tmdb_media_type, 'movie') = $2
         AND COALESCE(media_type, 'movie') = $3
         ${scopeClause}
       ORDER BY id DESC
       LIMIT 1`,
      params
    );
    if (byTmdb.rows[0]) return { row: byTmdb.rows[0], matchedBy: 'provider_tmdb' };
  }

  const plexGuid = item.plex_guid || null;
  if (plexGuid) {
    const plexGuidAliasKey = buildMediaIdentityAliasKey('plexGuid', plexGuid);
    const params = [plexGuid];
    const scopeClause = appendScopeSql(params, scopeContext, {
      spaceColumn: 'm.space_id',
      libraryColumn: 'm.library_id'
    });
    const byPlexGuid = await pool.query(
      `SELECT m.id
       FROM media m
       JOIN media_metadata mm ON mm.media_id = m.id
       WHERE ((mm."key" = 'plex_guid' AND mm."value" = $1)${plexGuidAliasKey ? ` OR mm."key" = '${plexGuidAliasKey.replace(/'/g, "''")}'` : ''})
         ${scopeClause}
       ORDER BY m.id DESC
       LIMIT 1`,
      params
    );
    if (byPlexGuid.rows[0]) return { row: byPlexGuid.rows[0], matchedBy: 'provider_plex_guid' };
  }

  const plexRatingKey = item.plex_rating_key || null;
  if (plexRatingKey) {
    const plexItemAliasKey = buildMediaIdentityAliasKey('plexItemKey', plexRatingKey);
    const params = [plexRatingKey];
    const scopeClause = appendScopeSql(params, scopeContext, {
      spaceColumn: 'm.space_id',
      libraryColumn: 'm.library_id'
    });
    const byPlexRatingKey = await pool.query(
      `SELECT m.id
       FROM media m
       JOIN media_metadata mm ON mm.media_id = m.id
       WHERE ((mm."key" = 'plex_item_key' AND mm."value" = $1)${plexItemAliasKey ? ` OR mm."key" = '${plexItemAliasKey.replace(/'/g, "''")}'` : ''})
         ${scopeClause}
       ORDER BY m.id DESC
       LIMIT 1`,
      params
    );
    if (byPlexRatingKey.rows[0]) return { row: byPlexRatingKey.rows[0], matchedBy: 'provider_plex_item_key' };
  }

  return { row: null, matchedBy: null };
}

function buildNormalizationIdentityForImportedItem({ normalizedMediaType, title, normalizedTypeDetails, resolvedIdentifiers }) {
  const payload = {
    title,
    media_type: normalizedMediaType,
    isbn: resolvedIdentifiers?.isbn || '',
    type_details: normalizedTypeDetails || {}
  };
  if (normalizedMediaType === 'book') return buildBookNormalizationIdentity(payload);
  if (normalizedMediaType === 'comic_book') return buildComicNormalizationIdentity(payload);
  return null;
}

function buildNormalizationReviewCandidatesForRows({
  rows = [],
  normalizedMediaType,
  normalizationIdentity
}) {
  if (!Array.isArray(rows) || rows.length === 0 || !normalizationIdentity?.key || normalizationIdentity.confidence !== 'medium') {
    return [];
  }

  let matches = [];
  if (normalizedMediaType === 'book' && normalizationIdentity.kind === 'title_author') {
    const keyBody = String(normalizationIdentity.key).replace(/^book:title_author:/, '');
    const [normalizedTitle = '', normalizedAuthor = ''] = keyBody.split('::');
    matches = rows.filter((candidate) => {
      const typeDetails = candidate?.type_details && typeof candidate.type_details === 'object' ? candidate.type_details : {};
      return (
        normalizeText(candidate?.title || '') === normalizedTitle
        && normalizeText(typeDetails.author || '') === normalizedAuthor
      );
    });
  } else if (normalizedMediaType === 'comic_book' && normalizationIdentity.kind === 'series_issue') {
    const keyBody = String(normalizationIdentity.key).replace(/^comic:series_issue:/, '');
    const [normalizedSeries = '', , normalizedIssue = ''] = keyBody.split('::');
    matches = rows.filter((candidate) => {
      const typeDetails = candidate?.type_details && typeof candidate.type_details === 'object' ? candidate.type_details : {};
      return (
        normalizeText(typeDetails.series || '') === normalizedSeries
        && normalizeIssueToken(typeDetails.issue_number || '') === normalizedIssue
      );
    });
  }

  return matches.slice(0, 5).map((candidate) => {
    const typeDetails = candidate?.type_details && typeof candidate.type_details === 'object' ? candidate.type_details : {};
    return {
      media_id: Number(candidate.id || 0) || null,
      title: String(candidate.title || '').trim() || null,
      media_type: String(candidate.media_type || normalizedMediaType || '').trim() || null,
      confidence: normalizationIdentity.confidence,
      action: normalizationIdentity.action,
      matched_by: `normalization_${normalizationIdentity.kind}`,
      rationale: Array.isArray(normalizationIdentity.rationale) ? normalizationIdentity.rationale : [],
      type_details: {
        author: String(typeDetails.author || '').trim() || null,
        series: String(typeDetails.series || '').trim() || null,
        issue_number: String(typeDetails.issue_number || '').trim() || null,
        volume: String(typeDetails.volume || '').trim() || null,
        isbn: String(typeDetails.isbn || '').trim() || null
      }
    };
  });
}

async function findNormalizationReviewCandidates({
  normalizedMediaType,
  normalizationIdentity,
  scopeContext = null
}) {
  if (!normalizationIdentity?.key || normalizationIdentity.confidence !== 'medium') {
    return [];
  }

  const params = [normalizedMediaType];
  let scopeClause = '';
  let candidateQuery = '';

  if (normalizedMediaType === 'book' && normalizationIdentity.kind === 'title_author') {
    scopeClause = appendScopeSql(params, scopeContext, {
      spaceColumn: 'm.space_id',
      libraryColumn: 'm.library_id'
    });
    candidateQuery = `
      SELECT m.id, m.title, m.type_details, m.media_type
      FROM media m
      WHERE COALESCE(m.media_type, 'movie') = $1
        ${scopeClause}
      ORDER BY m.id DESC
      LIMIT 250`;
  } else if (normalizedMediaType === 'comic_book' && normalizationIdentity.kind === 'series_issue') {
    scopeClause = appendScopeSql(params, scopeContext, {
      spaceColumn: 'm.space_id',
      libraryColumn: 'm.library_id'
    });
    candidateQuery = `
      SELECT m.id, m.title, m.type_details, m.media_type
      FROM media m
      WHERE COALESCE(m.media_type, 'movie') = $1
        ${scopeClause}
      ORDER BY m.id DESC
      LIMIT 250`;
  } else {
    return [];
  }

  const result = await pool.query(candidateQuery, params);
  return buildNormalizationReviewCandidatesForRows({
    rows: result.rows || [],
    normalizedMediaType,
    normalizationIdentity
  });
}

async function findExistingByNormalizationIdentity({
  normalizedMediaType,
  normalizationIdentity,
  title,
  normalizedTypeDetails,
  scopeContext = null
}) {
  if (!normalizationIdentity?.key || normalizationIdentity.confidence !== 'high') {
    return { row: null, matchedBy: null, matchMode: null };
  }

  const params = [normalizedMediaType];
  let scopeClause = '';

  let candidateQuery = '';
  if (normalizedMediaType === 'book' && normalizationIdentity.kind === 'isbn') {
    params.push(String(normalizedTypeDetails?.isbn || '').replace(/\D+/g, ''));
    scopeClause = appendScopeSql(params, scopeContext, {
      spaceColumn: 'm.space_id',
      libraryColumn: 'm.library_id'
    });
    candidateQuery = `
      SELECT DISTINCT m.id, m.title, m.type_details, m.media_type
      FROM media m
      LEFT JOIN media_metadata mm ON mm.media_id = m.id
      WHERE COALESCE(m.media_type, 'movie') = $1
        AND (
          regexp_replace(COALESCE(m.type_details->>'isbn', ''), '\\D+', '', 'g') = $2
          OR (mm."key" = 'isbn' AND regexp_replace(COALESCE(mm."value", ''), '\\D+', '', 'g') = $2)
        )
        ${scopeClause}
      ORDER BY m.id DESC
      LIMIT 10`;
  } else if (normalizedMediaType === 'comic_book' && normalizationIdentity.kind === 'series_issue_volume') {
    params.push(String(normalizedTypeDetails?.series || '').trim().toLowerCase());
    scopeClause = appendScopeSql(params, scopeContext, {
      spaceColumn: 'm.space_id',
      libraryColumn: 'm.library_id'
    });
    candidateQuery = `
      SELECT m.id, m.title, m.type_details, m.media_type
      FROM media m
      WHERE COALESCE(m.media_type, 'movie') = $1
        AND lower(trim(COALESCE(m.type_details->>'series', ''))) = $2
        ${scopeClause}
      ORDER BY m.id DESC
      LIMIT 100`;
  } else if (normalizedMediaType === 'comic_book' && normalizationIdentity.kind === 'provider_item') {
    return { row: null, matchedBy: null, matchMode: null };
  } else {
    return { row: null, matchedBy: null, matchMode: null };
  }

  const result = await pool.query(candidateQuery, params);
  const builder = normalizedMediaType === 'book' ? buildBookNormalizationIdentity : buildComicNormalizationIdentity;
  const matchedRow = (result.rows || []).find((candidate) => {
    const candidateIdentity = builder(candidate);
    return candidateIdentity?.confidence === 'high' && candidateIdentity?.key === normalizationIdentity.key;
  });

  if (!matchedRow) return { row: null, matchedBy: null, matchMode: null };
  return {
    row: { id: matchedRow.id },
    matchedBy: `normalization_${normalizationIdentity.kind}`,
    matchMode: 'matched_by_normalization_high'
  };
}

async function upsertImportedMedia({ userId, item, importSource, scopeContext = null, identifiers = null }) {
  const title = String(item.title || '').trim();
  if (!title) {
    return { type: 'invalid', detail: 'Missing title' };
  }
  const normalizedMediaType = normalizeMediaType(item.media_type || 'movie', 'movie');
  const normalizedTmdbType = normalizedMediaType === 'tv_series' || normalizedMediaType === 'tv_episode' ? 'tv' : 'movie';
  const normalizedTypeDetailsResult = normalizeTypeDetails(normalizedMediaType, item.type_details, { strict: false });
  const normalizedTypeDetails = normalizedTypeDetailsResult.value;
  const baseIdentifiers = resolveImportIdentifiers(item, identifiers || {});
  const resolvedIdentifiers = normalizedMediaType === 'comic_book'
    ? {
        isbn: '',
        eanUpc: '',
        asin: ''
      }
    : baseIdentifiers;
  const identifierAttempted = Boolean(resolvedIdentifiers.isbn || resolvedIdentifiers.eanUpc || resolvedIdentifiers.asin);
  const dedupLockKey = buildMediaDedupLockKey({ ...item, title, ...resolvedIdentifiers }, scopeContext);
  return withDedupLock(dedupLockKey, async () => {
    let existingRow = null;
    let matchMode = identifierAttempted ? 'identifier_no_match_fallback_title' : 'fallback_title_only';
    let matchedBy = 'title_year_media_type';
    let identifierConflict = false;
    let normalizationReviewCandidates = [];
    let normalizationIdentity = null;

    const identifierPriority = getIdentifierMatchPriority({
      mediaType: normalizedMediaType,
      importSource
    });
    for (const identifierType of identifierPriority) {
      if (existingRow) break;
      let identifierValue = '';
      if (identifierType === 'isbn') identifierValue = resolvedIdentifiers.isbn;
      if (identifierType === 'ean_upc') identifierValue = resolvedIdentifiers.eanUpc;
      if (identifierType === 'asin') identifierValue = resolvedIdentifiers.asin;
      if (!identifierValue) continue;
      // eslint-disable-next-line no-await-in-loop
      const matchByIdentifier = await findExistingByIdentifier({
        identifierType,
        identifierValue,
        normalizedMediaType,
        scopeContext
      });
      if (matchByIdentifier.row) {
        existingRow = matchByIdentifier.row;
        matchedBy = `identifier_${identifierType}`;
        identifierConflict = matchByIdentifier.conflict;
        matchMode = matchByIdentifier.conflict ? 'identifier_conflict' : 'matched_by_identifier';
      }
    }

    if (!existingRow) {
      const providerMatch = await findExistingByProviderIds({
        item,
        normalizedMediaType,
        normalizedTmdbType,
        scopeContext
      });
      if (providerMatch.row) {
        existingRow = providerMatch.row;
        matchedBy = providerMatch.matchedBy || 'provider';
      }
    }

    if (!existingRow && ['book', 'comic_book'].includes(normalizedMediaType)) {
      normalizationIdentity = buildNormalizationIdentityForImportedItem({
        normalizedMediaType,
        title,
        normalizedTypeDetails,
        resolvedIdentifiers
      });
      const normalizationMatch = await findExistingByNormalizationIdentity({
        normalizedMediaType,
        normalizationIdentity,
        title,
        normalizedTypeDetails,
        scopeContext
      });
      if (normalizationMatch.row) {
        existingRow = normalizationMatch.row;
        matchedBy = normalizationMatch.matchedBy || 'normalization_high';
        matchMode = normalizationMatch.matchMode || 'matched_by_normalization_high';
      }
    }

    if (!existingRow && normalizationIdentity?.confidence === 'medium') {
      normalizationReviewCandidates = await findNormalizationReviewCandidates({
        normalizedMediaType,
        normalizationIdentity,
        scopeContext
      });
      if (normalizationReviewCandidates.length > 0) {
        matchMode = 'normalization_review_medium';
        matchedBy = `normalization_${normalizationIdentity.kind}`;
      }
    }

    if (!existingRow) {
      const comicProviderIssueId = normalizedMediaType === 'comic_book'
        ? String(normalizedTypeDetails?.provider_issue_id || '').trim()
        : '';
      const shouldSkipTitleFallback = (normalizedMediaType === 'comic_book' && Boolean(comicProviderIssueId))
        || normalizationReviewCandidates.length > 0;
      if (!shouldSkipTitleFallback) {
        const year = item.year ?? null;
        const existingParams = [title, year, normalizedMediaType];
        const existingScopeClause = appendScopeSql(existingParams, scopeContext);
        const existing = await pool.query(
          `SELECT id, title, media_type, type_details, upc, tmdb_id
           FROM media
           WHERE LOWER(TRIM(title)) = LOWER(TRIM($1))
             AND (($2::int IS NOT NULL AND year = $2::int) OR ($2::int IS NULL))
             AND COALESCE(media_type, 'movie') = $3
             ${existingScopeClause}
           ORDER BY created_at DESC
           LIMIT 5`,
          existingParams
        );
        const titleFallbackCandidates = existing.rows || [];
        const safeTitleFallbackCandidate = titleFallbackCandidates.find((candidate) => {
          const conflicts = assessTitleFallbackStrongIdentifierConflicts({
            item,
            normalizedTypeDetails,
            resolvedIdentifiers,
            candidateRow: candidate
          });
          return conflicts.length === 0;
        }) || null;
        if (safeTitleFallbackCandidate) {
          existingRow = safeTitleFallbackCandidate;
        } else if (titleFallbackCandidates.length > 0) {
          matchMode = 'strong_identifier_conflict_guarded';
          matchedBy = 'title_year_media_type';
        }
      }
    }

    if (existingRow) {
      const currentFormatStateResult = await pool.query(
        'SELECT media_type, format, owned_formats FROM media WHERE id = $1 LIMIT 1',
        [existingRow.id]
      );
      const currentFormatState = currentFormatStateResult.rows[0] || {};
      const mergedOwnedFormats = sortOwnedFormats(
        normalizedMediaType,
        [
          ...(Array.isArray(currentFormatState.owned_formats) ? currentFormatState.owned_formats : []),
          ...(Array.isArray(item.owned_formats) ? item.owned_formats : [])
        ]
      );
      const ownedFormatState = buildOwnedFormatsPayload(
        normalizedMediaType,
        mergedOwnedFormats,
        item.format || currentFormatState.format
      );
      const updateParams = [
        normalizedMediaType,
        item.original_title || null,
        item.release_date || null,
        item.year || null,
        ownedFormatState.format || null,
        ownedFormatState.ownedFormats,
        item.genre || null,
        item.director || null,
        item.cast || null,
        item.rating || null,
        item.user_rating || null,
        item.tmdb_id || null,
        item.tmdb_media_type || normalizedTmdbType,
        item.tmdb_url || null,
        item.poster_path || null,
        item.backdrop_path || null,
        item.overview || null,
        item.trailer_url || null,
        item.runtime || null,
        item.upc || null,
        item.signed_by || null,
        item.signed_role || null,
        item.signed_on || null,
        item.signed_at || null,
        item.signed_proof_path || null,
        item.location || null,
        item.notes || null,
        normalizedTypeDetails ? JSON.stringify(normalizedTypeDetails) : null,
        importSource || null,
        existingRow.id
      ];
      const updateScopeClause = appendScopeSql(updateParams, scopeContext);
      await pool.query(
        `UPDATE media SET
           media_type = COALESCE($1, media_type),
           original_title = COALESCE($2, original_title),
           release_date = COALESCE($3, release_date),
           year = COALESCE($4, year),
           format = COALESCE($5, format),
           owned_formats = COALESCE($6::text[], owned_formats),
           genre = COALESCE($7, genre),
           director = COALESCE($8, director),
           cast_members = COALESCE($9, cast_members),
           rating = COALESCE($10, rating),
           user_rating = COALESCE($11, user_rating),
           tmdb_id = COALESCE($12, tmdb_id),
           tmdb_media_type = COALESCE($13, tmdb_media_type),
           tmdb_url = COALESCE($14, tmdb_url),
           poster_path = COALESCE($15, poster_path),
           backdrop_path = COALESCE($16, backdrop_path),
           overview = COALESCE($17, overview),
           trailer_url = COALESCE($18, trailer_url),
           runtime = COALESCE($19, runtime),
           upc = COALESCE($20, upc),
           signed_by = COALESCE($21, signed_by),
           signed_role = COALESCE($22, signed_role),
           signed_on = COALESCE($23, signed_on),
           signed_at = COALESCE($24, signed_at),
           signed_proof_path = COALESCE($25, signed_proof_path),
           location = COALESCE($26, location),
           notes = COALESCE($27, notes),
           type_details = CASE
             WHEN $28::jsonb IS NULL THEN type_details
             ELSE COALESCE(type_details, '{}'::jsonb) || $28::jsonb
           END,
           import_source = COALESCE($29, import_source)
         WHERE id = $30${updateScopeClause}
         RETURNING id, genre, director, cast_members AS cast`,
        updateParams
      );
      const refreshed = await pool.query('SELECT id, genre, director, cast_members AS cast FROM media WHERE id = $1', [existingRow.id]);
      const updatedRow = refreshed.rows[0] || { id: existingRow.id, genre: item.genre || null, director: item.director || null, cast: item.cast || null };
      await syncNormalizedMetadataForMedia({
        mediaId: updatedRow.id,
        genre: updatedRow.genre,
        director: updatedRow.director,
        cast: updatedRow.cast
      });
      return {
        type: 'updated',
        mediaId: existingRow.id,
        matchMode,
        matchedBy,
        identifiers: resolvedIdentifiers,
        identifierConflict,
        normalizationReviewCandidates
      };
    }

    const ownedFormatState = buildOwnedFormatsPayload(normalizedMediaType, item.owned_formats, item.format);
    const inserted = await pool.query(
      `INSERT INTO media (
         title, media_type, original_title, release_date, year, format, owned_formats, genre, director, cast_members,
         rating, user_rating, tmdb_id, tmdb_media_type, tmdb_url, poster_path, backdrop_path, overview, trailer_url,
         runtime, upc, signed_by, signed_role, signed_on, signed_at, signed_proof_path, location, notes, type_details, library_id, space_id, added_by, import_source
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7::text[],$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29::jsonb,$30,$31,$32,$33
       )
       RETURNING id, genre, director, cast_members AS cast`,
      [
        title,
        normalizedMediaType,
        item.original_title || null,
        item.release_date || null,
        item.year || null,
        ownedFormatState.format || 'Digital',
        ownedFormatState.ownedFormats,
        item.genre || null,
        item.director || null,
        item.cast || null,
        item.rating || null,
        item.user_rating || null,
        item.tmdb_id || null,
        item.tmdb_media_type || normalizedTmdbType,
        item.tmdb_url || null,
        item.poster_path || null,
        item.backdrop_path || null,
        item.overview || null,
        item.trailer_url || null,
        item.runtime || null,
        item.upc || null,
        item.signed_by || null,
        item.signed_role || null,
        item.signed_on || null,
        item.signed_at || null,
        item.signed_proof_path || null,
        item.location || null,
        item.notes || null,
        normalizedTypeDetails ? JSON.stringify(normalizedTypeDetails) : null,
        item.library_id || scopeContext?.libraryId || null,
        item.space_id || scopeContext?.spaceId || null,
        userId,
        importSource || null
      ]
    );
    const insertedRow = inserted.rows[0] || null;
    if (insertedRow?.id) {
      await syncNormalizedMetadataForMedia({
        mediaId: insertedRow.id,
        genre: insertedRow.genre,
        director: insertedRow.director,
        cast: insertedRow.cast
      });
    }
    return {
      type: 'created',
      mediaId: insertedRow?.id || null,
      matchMode,
      matchedBy,
      identifiers: resolvedIdentifiers,
      identifierConflict,
      normalizationReviewCandidates
    };
  });
}

async function upsertMediaMetadataEntry(mediaId, key, value) {
  if (!mediaId || !key || value === undefined || value === null || value === '') return;
  await pool.query(
    `INSERT INTO media_metadata (media_id, "key", "value")
     VALUES ($1::int, $2::varchar, $3::text)
     ON CONFLICT (media_id, "key")
     DO UPDATE SET "value" = EXCLUDED."value"`,
    [mediaId, String(key), String(value)]
  );
}

const TMDB_IMPORT_MIN_INTERVAL_MS = Math.max(0, Number(process.env.TMDB_IMPORT_MIN_INTERVAL_MS || 50));
const PLEX_JOB_PROGRESS_BATCH_SIZE = Math.max(1, Number(process.env.PLEX_JOB_PROGRESS_BATCH_SIZE || 25));
const CSV_JOB_PROGRESS_BATCH_SIZE = Math.max(1, Number(process.env.CSV_JOB_PROGRESS_BATCH_SIZE || 25));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildTmdbThrottle() {
  let lastAt = 0;
  return async () => {
    if (TMDB_IMPORT_MIN_INTERVAL_MS <= 0) return;
    const now = Date.now();
    const waitMs = (lastAt + TMDB_IMPORT_MIN_INTERVAL_MS) - now;
    if (waitMs > 0) await sleep(waitMs);
    lastAt = Date.now();
  };
}

function parseAsyncFlag(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function shouldQueueImportByDefault(req) {
  const syncRequested = parseAsyncFlag(req.query?.sync) || parseAsyncFlag(req.body?.sync);
  if (syncRequested) return false;

  if (req.query?.async !== undefined || req.body?.async !== undefined) {
    return parseAsyncFlag(req.query?.async) || parseAsyncFlag(req.body?.async);
  }

  return true;
}

function resolveValuationExecutionMode(req) {
  const normalized = String(req.get('x-valuation-refresh-mode') || 'live').trim().toLowerCase();
  if (normalized === 'fixture' && process.env.NODE_ENV !== 'production') {
    return 'fixture';
  }
  return 'live';
}

function buildQueuedJobResponse(job, provider) {
  return {
    ok: true,
    queued: true,
    provider: provider || job.provider,
    job_id: job.id,
    status: job.status,
    status_url: `/api/media/sync-jobs/${job.id}`,
    job: {
      id: job.id,
      status: job.status,
      provider: provider || job.provider,
      progress: job.progress
    }
  };
}

function jobScopePayload(scopeContext, sectionIds = []) {
  return {
    spaceId: scopeContext?.spaceId ?? null,
    libraryId: scopeContext?.libraryId ?? null,
    sectionIds: Array.isArray(sectionIds) ? sectionIds : []
  };
}

function resolveValuationProviderForConfig(config = {}, mode = 'live') {
  const normalizedMode = String(mode || 'live').trim().toLowerCase();
  if (normalizedMode === 'fixture') {
    if (config.priceChartingEnabled) return 'pricecharting';
    if (config.eBayBrowseEnabled) return 'ebay_browse';
    return 'pricecharting';
  }
  if (config.priceChartingEnabled && config.priceChartingApiKey) return 'pricecharting';
  if (config.eBayBrowseEnabled && config.eBayBrowseClientId && config.eBayBrowseClientSecret) return 'ebay_browse';
  return 'unknown';
}

function canExecuteValuationForConfig(config = {}, mode = 'live') {
  const normalizedMode = String(mode || 'live').trim().toLowerCase();
  if (normalizedMode === 'fixture') {
    return Boolean(config.priceChartingEnabled || config.eBayBrowseEnabled);
  }
  return Boolean(
    (config.priceChartingEnabled && config.priceChartingApiKey)
    || (config.eBayBrowseEnabled && config.eBayBrowseClientId && config.eBayBrowseClientSecret)
  );
}

function buildDedupScopeKey(scopeContext = null) {
  const space = scopeContext?.spaceId ? `s:${scopeContext.spaceId}` : 's:global';
  const library = scopeContext?.libraryId ? `l:${scopeContext.libraryId}` : 'l:all';
  return `${space}|${library}`;
}

function buildMediaDedupLockKey(item = {}, scopeContext = null) {
  const scope = buildDedupScopeKey(scopeContext);
  const normalizedMediaType = normalizeMediaType(item.media_type || 'movie', 'movie');
  const tmdbType = item.tmdb_media_type || (normalizedMediaType === 'tv_series' || normalizedMediaType === 'tv_episode' ? 'tv' : 'movie');
  if (item.isbn) return `media|${scope}|isbn|${item.isbn}|${normalizedMediaType}`;
  if (item.eanUpc || item.ean_upc) return `media|${scope}|ean_upc|${item.eanUpc || item.ean_upc}|${normalizedMediaType}`;
  if (item.asin) return `media|${scope}|asin|${item.asin}|${normalizedMediaType}`;
  if (item.plex_guid) return `media|${scope}|plex_guid|${item.plex_guid}`;
  if (item.plex_rating_key) return `media|${scope}|plex_rating_key|${item.plex_rating_key}`;
  if (item.tmdb_id) return `media|${scope}|tmdb|${tmdbType}|${item.tmdb_id}`;
  const title = normalizeTitleForMatch(item.title || '');
  const year = item.year || 'na';
  return `media|${scope}|title_year_type|${title}|${year}|${normalizedMediaType}`;
}

async function withDedupLock(lockKey, fn) {
  await pool.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
  try {
    return await fn();
  } finally {
    await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
  }
}

async function createSyncJob({ userId, jobType, provider, scope, progress }) {
  const result = await pool.query(
    `INSERT INTO sync_jobs (job_type, provider, status, created_by, scope, progress)
     VALUES ($1, $2, 'queued', $3, $4::jsonb, $5::jsonb)
     RETURNING id, job_type, provider, status, created_by, scope, progress, summary, error,
               started_at, finished_at, created_at, updated_at`,
    [
      jobType,
      provider,
      userId || null,
      JSON.stringify(scope || {}),
      JSON.stringify(progress || {})
    ]
  );
  return result.rows[0];
}

async function updateSyncJob(jobId, patch = {}) {
  const entries = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (!SYNC_JOB_ALLOWED_FIELDS.has(key)) {
      throw new Error(`Invalid sync job update field: ${key}`);
    }
    entries.push([key, value]);
  }
  if (entries.length === 0) return null;
  const sets = [];
  const values = [];
  for (const [key, value] of entries) {
    values.push(value);
    if (['scope', 'progress', 'summary'].includes(key)) {
      sets.push(`${key} = $${values.length}::jsonb`);
    } else {
      sets.push(`${key} = $${values.length}`);
    }
  }
  values.push(jobId);
  const result = await pool.query(
    `UPDATE sync_jobs
     SET ${sets.join(', ')}
     WHERE id = $${values.length}
     RETURNING id, job_type, provider, status, created_by, scope, progress, summary, error,
               started_at, finished_at, created_at, updated_at`,
    values
  );
  return result.rows[0] || null;
}

async function getSyncJob(jobId, reqUser) {
  const params = [jobId];
  let where = 'WHERE id = $1';
  if (reqUser?.role !== 'admin') {
    params.push(reqUser?.id || null);
    where += ` AND created_by = $${params.length}`;
  }
  const result = await pool.query(
    `SELECT id, job_type, provider, status, created_by, scope, progress, summary, error,
            started_at, finished_at, created_at, updated_at
     FROM sync_jobs
     ${where}
     LIMIT 1`,
    params
  );
  return result.rows[0] || null;
}

async function queueImportedValuationRefresh({
  mediaIds = [],
  userId = null,
  scopeContext = null,
  mode = 'live',
  auditReq = null,
  importSource = null
}) {
  const uniqueMediaIds = [...new Set(
    (Array.isArray(mediaIds) ? mediaIds : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
  )];
  if (uniqueMediaIds.length === 0) {
    return { queued: false, count: 0, jobId: null, provider: null };
  }

  const scopedConfig = await loadScopedIntegrationConfig(scopeContext?.spaceId || null);
  const config = scopedConfig?.kavitaBaseUrl && scopedConfig?.kavitaApiKey
    ? scopedConfig
    : await loadAdminIntegrationConfig();
  if (!canExecuteValuationForConfig(config, mode)) {
    return { queued: false, count: 0, jobId: null, provider: null };
  }

  const provider = resolveValuationProviderForConfig(config, mode);
  const job = await createSyncJob({
    userId,
    jobType: 'valuation_refresh',
    provider,
    scope: {
      ...jobScopePayload(scopeContext),
      importSource: importSource || null,
      mediaCount: uniqueMediaIds.length
    },
    progress: {
      total: uniqueMediaIds.length,
      processed: 0,
      matched: 0,
      skipped: 0,
      errorCount: 0
    }
  });

  setImmediate(async () => {
    const summary = {
      importSource: importSource || null,
      total: uniqueMediaIds.length,
      matched: 0,
      skipped: 0,
      errorCount: 0,
      providerCounts: {},
      errorsSample: []
    };
    try {
      await updateSyncJob(job.id, { status: 'running', started_at: new Date() });
      for (let index = 0; index < uniqueMediaIds.length; index += 1) {
        const mediaId = uniqueMediaIds[index];
        try {
          const media = await loadScopedMediaItem(mediaId, scopeContext);
          if (!media) {
            summary.skipped += 1;
          } else {
            const result = await refreshMediaValuation(media, config, { mode, httpClient: axios });
            if (result?.matched && result?.valuation) {
              await persistMediaValuation(mediaId, result.valuation);
              summary.matched += 1;
            } else {
              summary.skipped += 1;
            }
            const providerKey = String(result?.provider || provider || 'unknown');
            summary.providerCounts[providerKey] = (summary.providerCounts[providerKey] || 0) + 1;
          }
        } catch (error) {
          summary.errorCount += 1;
          if (summary.errorsSample.length < 20) {
            summary.errorsSample.push({
              mediaId,
              detail: error.message || 'Valuation refresh failed'
            });
          }
        }

        await updateSyncJob(job.id, {
          progress: {
            total: uniqueMediaIds.length,
            processed: index + 1,
            matched: summary.matched,
            skipped: summary.skipped,
            errorCount: summary.errorCount
          }
        });
      }

      await updateSyncJob(job.id, {
        status: 'succeeded',
        summary,
        finished_at: new Date()
      });
      await logActivity(auditReq, 'media.valuation.import_refresh', 'media', null, {
        importSource: importSource || null,
        provider,
        mode,
        mediaCount: uniqueMediaIds.length,
        matched: summary.matched,
        skipped: summary.skipped,
        errorCount: summary.errorCount,
        jobId: job.id
      });
    } catch (error) {
      await updateSyncJob(job.id, {
        status: 'failed',
        error: error.message || 'Import valuation refresh failed',
        finished_at: new Date(),
        summary
      });
      await logActivity(auditReq, 'media.valuation.import_refresh.failed', 'media', null, {
        importSource: importSource || null,
        provider,
        mode,
        mediaCount: uniqueMediaIds.length,
        detail: error.message || 'Import valuation refresh failed',
        jobId: job.id
      });
    }
  });

  return {
    queued: true,
    count: uniqueMediaIds.length,
    jobId: job.id,
    provider
  };
}

async function emitImportDiagnosticFlag({
  auditReq,
  jobId = null,
  importSource = null,
  provider = null,
  rowNumber = null,
  sourceTitle = null,
  mediaType = null,
  upsertStatus = null,
  matchMode = null,
  matchedBy = null,
  enrichmentStatus = null,
  proposedMediaId = null,
  confidenceScore = null,
  lookupPath = null,
  lookupStatus = null,
  identifiers = null,
  collectionId = null,
  classificationDetail = null,
  auditOutcome = null
}) {
  if (!auditReq || !isDebugAt(2)) return false;
  await logActivity(auditReq, 'media.import.diagnostic.flagged', jobId ? 'sync_job' : 'media_import', jobId || null, {
    provider: provider || null,
    importSource: importSource || null,
    rowNumber: Number.isFinite(Number(rowNumber)) ? Number(rowNumber) : null,
    sourceTitle: sourceTitle || null,
    mediaType: normalizeMediaType(mediaType || 'movie', 'movie'),
    upsertStatus: upsertStatus || null,
    matchMode: matchMode || null,
    matchedBy: matchedBy || null,
    enrichmentStatus: enrichmentStatus || null,
    proposedMediaId: proposedMediaId || null,
    confidenceScore: Number.isFinite(Number(confidenceScore)) ? Number(confidenceScore) : null,
    lookupPath: lookupPath || 'none',
    lookupStatus: lookupStatus || 'none',
    identifiers: identifiers || null,
    collectionId: collectionId || null,
    classificationDetail: classificationDetail || null,
    auditOutcome: auditOutcome || null
  });
  return true;
}

async function ensureImportCollection({
  userId,
  scopeContext,
  importSource = null,
  mediaType = null,
  sourceTitle = '',
  expectedItemCount = null,
  metadata = null
}) {
  const normalizedSourceTitle = String(sourceTitle || '').trim();
  if (!normalizedSourceTitle) return { id: null, created: false };
  const params = [
    normalizedSourceTitle,
    importSource || null,
    normalizeMediaType(mediaType || 'movie', 'movie'),
    scopeContext?.libraryId || null,
    scopeContext?.spaceId || null
  ];
  const existing = await pool.query(
    `SELECT id
     FROM collections
     WHERE lower(trim(source_title)) = lower(trim($1))
       AND COALESCE(import_source, '') = COALESCE($2, '')
       AND COALESCE(media_type, '') = COALESCE($3, '')
       AND COALESCE(library_id, 0) = COALESCE($4, 0)
       AND COALESCE(space_id, 0) = COALESCE($5, 0)
     ORDER BY id DESC
     LIMIT 1`,
    params
  );
  if (existing.rows[0]?.id) return { id: existing.rows[0].id, created: false };

  const alias = normalizeCollectionImportAlias({
    sourceTitle: normalizedSourceTitle,
    importSource,
    mediaType
  });
  if (alias) {
    const aliasCandidates = await pool.query(
      `SELECT id, source_title, import_source, media_type, metadata
         FROM collections
        WHERE COALESCE(media_type, '') = COALESCE($1, '')
          AND COALESCE(library_id, 0) = COALESCE($2, 0)
          AND COALESCE(space_id, 0) = COALESCE($3, 0)
        ORDER BY id DESC`,
      [
        alias.media_type || null,
        scopeContext?.libraryId || null,
        scopeContext?.spaceId || null
      ]
    );
    const aliasMatch = aliasCandidates.rows.find((row) => collectionMatchesImportAlias(row, alias));
    if (aliasMatch?.id) return { id: aliasMatch.id, created: false };
  }

  const created = await pool.query(
    `INSERT INTO collections (
       name, media_type, source_title, import_source, expected_item_count, metadata,
       library_id, space_id, created_by
     )
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
     RETURNING id`,
    [
      normalizedSourceTitle,
      normalizeMediaType(mediaType || 'movie', 'movie'),
      normalizedSourceTitle,
      importSource || null,
      Number.isFinite(Number(expectedItemCount)) ? Number(expectedItemCount) : null,
      metadata ? JSON.stringify(metadata) : null,
      scopeContext?.libraryId || null,
      scopeContext?.spaceId || null,
      userId || null
    ]
  );
  return { id: created.rows[0]?.id || null, created: true };
}

async function addCollectionItem({
  collectionId,
  mediaId = null,
  containedTitle = null,
  position = null,
  confidenceScore = null,
  sourcePayload = null
}) {
  if (!collectionId) return null;
  if (mediaId && containedTitle) {
    const relink = await pool.query(
      `UPDATE collection_items
       SET media_id = $2,
           confidence_score = COALESCE($3, confidence_score),
           source_payload = COALESCE($4::jsonb, source_payload),
           resolution_status = CASE WHEN resolution_status = 'pending' THEN 'resolved' ELSE resolution_status END
       WHERE id = (
         SELECT id
         FROM collection_items
         WHERE collection_id = $1
           AND media_id IS NULL
           AND COALESCE(contained_title, '') = COALESCE($5, '')
         ORDER BY id DESC
         LIMIT 1
       )
       RETURNING id`,
      [
        collectionId,
        mediaId || null,
        Number.isFinite(Number(confidenceScore)) ? Number(confidenceScore) : null,
        sourcePayload ? JSON.stringify(sourcePayload) : null,
        containedTitle || null
      ]
    );
    if (relink.rows[0]?.id) return relink.rows[0].id;
  }

  const existing = await pool.query(
    `SELECT id
     FROM collection_items
     WHERE collection_id = $1
       AND COALESCE(media_id, 0) = COALESCE($2, 0)
       AND COALESCE(contained_title, '') = COALESCE($3, '')
     ORDER BY id DESC
     LIMIT 1`,
    [collectionId, mediaId || null, containedTitle || null]
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;
  const inserted = await pool.query(
    `INSERT INTO collection_items (
       collection_id, media_id, contained_title, position, confidence_score, source_payload
     )
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)
     RETURNING id`,
    [
      collectionId,
      mediaId || null,
      containedTitle || null,
      Number.isFinite(Number(position)) ? Number(position) : null,
      Number.isFinite(Number(confidenceScore)) ? Number(confidenceScore) : null,
      sourcePayload ? JSON.stringify(sourcePayload) : null
    ]
  );
  return inserted.rows[0]?.id || null;
}

async function runPlexImport({ req, config, sectionIds = [], scopeContext = null, onProgress = null }) {
  const summary = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    enrichmentErrors: [],
    enrichmentMisses: []
  };
  const createdMediaIds = [];
  const tmdbPosterLookupMissSamples = [];
  let tmdbPosterEnriched = 0;
  let tmdbPosterLookupMisses = 0;
  let tmdbPosterLookupNoMatch = 0;
  let tmdbPosterLookupNoImage = 0;
  let variantsCreated = 0;
  let variantsUpdated = 0;
  let seasonsCreated = 0;
  let seasonsUpdated = 0;
  const processedShowSeasonKeys = new Set();
  let items = [];
  const tmdbEnrichmentCache = new Map();
  const providerEnrichmentCache = new Map();
  const throttleTmdb = buildTmdbThrottle();
  const updateProgress = async (progress) => {
    if (typeof onProgress !== 'function') return;
    await onProgress(progress);
  };
  const shouldPersistVariant = (mediaType, variant) => {
    if (!variant) return false;
    if (mediaType !== 'tv_series') return true;
    const hasStreamData = Boolean(
      variant.resolution
      || Number.isFinite(Number(variant.video_height))
      || Number.isFinite(Number(variant.video_width))
      || variant.file_path
    );
    const isDerivedSeasonVariant = Number.isInteger(Number(variant.season_number)) && Number(variant.season_number) > 0;
    return hasStreamData || isDerivedSeasonVariant;
  };
  const upsertMediaMetadata = async (mediaId, key, value) => {
    if (!value) return;
    await pool.query(
      `INSERT INTO media_metadata (media_id, "key", "value")
       VALUES ($1::int, $2::varchar, $3::text)
       ON CONFLICT (media_id, "key")
       DO UPDATE SET "value" = EXCLUDED."value"`,
      [mediaId, key, String(value)]
    );
  };
  const upsertMediaVariant = async (mediaId, variant) => {
    if (!variant) return;
    const payload = [
      mediaId,
      variant.source || 'plex',
      variant.source_item_key || null,
      variant.source_media_id || null,
      variant.source_part_id || null,
      variant.edition || null,
      variant.file_path || null,
      variant.container || null,
      variant.video_codec || null,
      variant.audio_codec || null,
      variant.resolution || null,
      variant.video_width || null,
      variant.video_height || null,
      variant.audio_channels || null,
      variant.duration_ms || null,
      variant.runtime_minutes || null,
      variant.raw_json ? JSON.stringify(variant.raw_json) : null
    ];

    const byPart = variant.source_part_id
      ? await pool.query(
        `UPDATE media_variants
         SET media_id = $1,
             source_item_key = COALESCE($3, source_item_key),
             source_media_id = COALESCE($4, source_media_id),
             source_part_id = COALESCE($5, source_part_id),
             edition = COALESCE($6, edition),
             file_path = COALESCE($7, file_path),
             container = COALESCE($8, container),
             video_codec = COALESCE($9, video_codec),
             audio_codec = COALESCE($10, audio_codec),
             resolution = COALESCE($11, resolution),
             video_width = COALESCE($12, video_width),
             video_height = COALESCE($13, video_height),
             audio_channels = COALESCE($14, audio_channels),
             duration_ms = COALESCE($15, duration_ms),
             runtime_minutes = COALESCE($16, runtime_minutes),
             raw_json = COALESCE($17::jsonb, raw_json)
         WHERE source = $2
           AND source_part_id = $5
         RETURNING id`,
        payload
      )
      : { rows: [] };
    if (byPart.rows.length > 0) {
      variantsUpdated += 1;
      return;
    }

    const byItem = variant.source_item_key
      ? await pool.query(
        `UPDATE media_variants
         SET media_id = $1,
             source_item_key = COALESCE($3, source_item_key),
             source_media_id = COALESCE($4, source_media_id),
             source_part_id = COALESCE($5, source_part_id),
             edition = COALESCE($6, edition),
             file_path = COALESCE($7, file_path),
             container = COALESCE($8, container),
             video_codec = COALESCE($9, video_codec),
             audio_codec = COALESCE($10, audio_codec),
             resolution = COALESCE($11, resolution),
             video_width = COALESCE($12, video_width),
             video_height = COALESCE($13, video_height),
             audio_channels = COALESCE($14, audio_channels),
             duration_ms = COALESCE($15, duration_ms),
             runtime_minutes = COALESCE($16, runtime_minutes),
             raw_json = COALESCE($17::jsonb, raw_json)
         WHERE source = $2
           AND source_item_key = $3
         RETURNING id`,
        payload
      )
      : { rows: [] };
    if (byItem.rows.length > 0) {
      variantsUpdated += 1;
      return;
    }

    await pool.query(
      `INSERT INTO media_variants (
         media_id, source, source_item_key, source_media_id, source_part_id,
         edition, file_path, container, video_codec, audio_codec, resolution,
         video_width, video_height, audio_channels, duration_ms, runtime_minutes, raw_json
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb
       )`,
      payload
    );
    variantsCreated += 1;
  };
  const upsertMediaSeason = async (mediaId, mediaRow, variant) => {
    if (!mediaId || !mediaRow || mediaRow.media_type !== 'tv_series') return;
    const fromVariant = Number(variant?.season_number);
    const fromMedia = Number(mediaRow?.season_number);
    let seasonNumber = Number.isInteger(fromVariant) && fromVariant > 0 ? fromVariant : null;
    if (!seasonNumber && Number.isInteger(fromMedia) && fromMedia > 0) seasonNumber = fromMedia;
    if (!seasonNumber && variant?.source_item_key) {
      const keyMatch = String(variant.source_item_key).match(/:season:(\d+)/i);
      if (keyMatch?.[1]) seasonNumber = Number(keyMatch[1]);
    }
    if (!seasonNumber && variant?.edition) {
      const editionMatch = String(variant.edition).match(/season\s*(\d+)/i);
      if (editionMatch?.[1]) seasonNumber = Number(editionMatch[1]);
    }
    if (!Number.isInteger(seasonNumber) || seasonNumber <= 0) return;

    const updated = await pool.query(
      `UPDATE media_seasons
       SET source = $3
       WHERE media_id = $1
         AND season_number = $2
       RETURNING id`,
      [mediaId, seasonNumber, variant?.source || 'plex']
    );
    if (updated.rows.length > 0) {
      seasonsUpdated += 1;
      return;
    }
    await pool.query(
      `INSERT INTO media_seasons (media_id, season_number, source)
       VALUES ($1, $2, $3)
       ON CONFLICT (media_id, season_number) DO NOTHING`,
      [mediaId, seasonNumber, variant?.source || 'plex']
    );
    seasonsCreated += 1;
  };
  const upsertPlexShowSeasons = async (mediaId, sectionId, plexRatingKey) => {
    if (!mediaId || !sectionId || !plexRatingKey) return;
    const dedupeKey = `${sectionId}:${plexRatingKey}`;
    if (processedShowSeasonKeys.has(dedupeKey)) return;
    processedShowSeasonKeys.add(dedupeKey);
    let seasons = [];
    let seasonVariants = [];
    try {
      seasons = await fetchPlexShowSeasons(config, plexRatingKey);
      seasonVariants = await fetchPlexShowSeasonVariants(config, plexRatingKey, sectionId);
    } catch (error) {
      summary.enrichmentErrors.push({
        title: `show:${plexRatingKey}`,
        type: 'plex_season_fetch',
        detail: error.message || 'Plex season fetch failed'
      });
      return;
    }
    for (const season of seasons) {
      const seasonNumber = Number(season?.season_number);
      if (!Number.isInteger(seasonNumber) || seasonNumber <= 0) continue;
      const availableEpisodes = Number.isInteger(Number(season?.available_episodes))
        ? Number(season.available_episodes)
        : null;
      const watchedEpisodes = Number.isInteger(Number(season?.watched_episodes))
        ? Number(season.watched_episodes)
        : 0;
      let watchState = 'unwatched';
      if (availableEpisodes !== null && watchedEpisodes >= availableEpisodes && availableEpisodes > 0) {
        watchState = 'completed';
      } else if (watchedEpisodes > 0) {
        watchState = 'in_progress';
      }
      const updated = await pool.query(
        `UPDATE media_seasons
         SET source = 'plex',
             available_episodes = COALESCE($3, available_episodes),
             watch_state = $4,
             is_complete = CASE
               WHEN expected_episodes IS NOT NULL
                AND expected_episodes > 0
                AND COALESCE($3, available_episodes) IS NOT NULL
                AND COALESCE($3, available_episodes) >= expected_episodes
                 THEN TRUE
               ELSE is_complete
             END
         WHERE media_id = $1
           AND season_number = $2
         RETURNING id`,
        [mediaId, seasonNumber, availableEpisodes, watchState]
      );
      if (updated.rows.length > 0) {
        seasonsUpdated += 1;
        continue;
      }
      await pool.query(
        `INSERT INTO media_seasons (media_id, season_number, source, available_episodes, watch_state, is_complete)
         VALUES ($1, $2, 'plex', $3, $4, FALSE)
         ON CONFLICT (media_id, season_number) DO NOTHING`,
        [
          mediaId,
          seasonNumber,
          availableEpisodes,
          watchState
        ]
      );
      seasonsCreated += 1;
    }
    for (const variant of seasonVariants) {
      try {
        await upsertMediaVariant(mediaId, variant);
      } catch (error) {
        summary.enrichmentErrors.push({
          title: `show:${plexRatingKey}:season:${variant?.season_number || 'unknown'}`,
          type: 'plex_season_variant_upsert',
          detail: error.message || 'Plex season variant upsert failed'
        });
      }
    }
  };
  const tmdbSeasonSummaryCache = new Map();
  const hydrateTmdbSeasonExpectedCounts = async (mediaId, tmdbId, mediaContext = {}) => {
    if (!mediaId || !tmdbId || !config.tmdbApiKey) return;
    const normalizedMediaType = normalizeMediaType(mediaContext?.mediaType || '', '');
    const normalizedTmdbMediaType = String(mediaContext?.tmdbMediaType || '').trim().toLowerCase();
    if (normalizedMediaType !== 'tv_series' || normalizedTmdbMediaType !== 'tv') return;
    const cacheKey = String(tmdbId);
    let summaries = tmdbSeasonSummaryCache.get(cacheKey);
    if (summaries === undefined) {
      try {
        await throttleTmdb();
        summaries = await fetchTmdbTvShowSeasonSummary(tmdbId, config);
      } catch (error) {
        summaries = [];
        const isTmdbNotFound = Number(error?.tmdb?.status || error?.status || 0) === 404;
        const bucket = isTmdbNotFound ? summary.enrichmentMisses : summary.enrichmentErrors;
        bucket.push({
          mediaId,
          mediaTitle: mediaContext?.title || null,
          mediaYear: Number.isFinite(Number(mediaContext?.year)) ? Number(mediaContext.year) : null,
          title: `tmdb:${tmdbId}`,
          type: 'tmdb_season_summary_fetch',
          detail: error.message || 'TMDB season summary fetch failed'
        });
      }
      tmdbSeasonSummaryCache.set(cacheKey, summaries);
    }
    if (!Array.isArray(summaries) || summaries.length === 0) return;
    for (const season of summaries) {
      if (!Number.isInteger(season?.season_number) || season.season_number <= 0) continue;
      if (!Number.isInteger(season?.episode_count) || season.episode_count <= 0) continue;
      await pool.query(
        `UPDATE media_seasons
         SET expected_episodes = $3,
             is_complete = CASE
               WHEN available_episodes IS NOT NULL AND $3 IS NOT NULL AND $3 > 0 AND available_episodes >= $3 THEN TRUE
               ELSE FALSE
             END
         WHERE media_id = $1
           AND season_number = $2
           AND (expected_episodes IS DISTINCT FROM $3)`,
        [mediaId, season.season_number, season.episode_count]
      );
    }
  };

  items = await fetchPlexLibraryItems(config, sectionIds);
  await updateProgress({
    total: items.length,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errorCount: 0
  });

  for (let idx = 0; idx < items.length; idx += 1) {
    const item = items[idx];
    let media = { ...item.normalized };
    if (!media.title) {
      summary.skipped += 1;
      continue;
    }

    media = await enrichImportItemByMediaType(media, config, providerEnrichmentCache);

    const mediaType = normalizeMediaType(media.media_type || item.normalized.media_type || 'movie', 'movie');
    const canUseTmdb = mediaType === 'movie' || mediaType === 'tv_series' || mediaType === 'tv_episode';
    if (config.tmdbApiKey && canUseTmdb && (!media.poster_path || !media.cast || !media.director)) {
      const tmdbType = media.tmdb_media_type === 'tv' ? 'tv' : 'movie';
      const cacheKey = media.tmdb_id
        ? `${tmdbType}:id:${media.tmdb_id}`
        : `${tmdbType}:q:${String(media.title || '').toLowerCase()}|${media.year || ''}`;
      let cached = tmdbEnrichmentCache.get(cacheKey);
      if (cached === undefined) {
        cached = null;
        try {
          await throttleTmdb();
          if (media.tmdb_id) {
            const details = await fetchTmdbMovieDetails(media.tmdb_id, config, tmdbType);
            cached = {
              tmdb_id: media.tmdb_id,
              tmdb_url: details?.tmdb_url || `https://www.themoviedb.org/${tmdbType}/${media.tmdb_id}`,
              poster_path: details?.poster_path || null,
              backdrop_path: details?.backdrop_path || null,
              director: details?.director || null,
              cast: details?.cast || null
            };
          } else if (media.title) {
            const resolved = await findBestTmdbCandidate({
              title: media.title,
              year: media.year,
              config,
              tmdbType,
              mediaType,
              allowMultiFallback: tmdbType === 'movie'
            });
            const best = resolved.candidate;
            if (best) {
              let details = null;
              try {
                if (best.id) {
                  details = await fetchTmdbMovieDetails(best.id, config, tmdbType);
                }
              } catch (_) {
                details = null;
              }
              cached = {
                tmdb_id: best.id || null,
                tmdb_url: details?.tmdb_url || (best.id ? `https://www.themoviedb.org/${tmdbType}/${best.id}` : null),
                poster_path: details?.poster_path || best.poster_path || null,
                backdrop_path: details?.backdrop_path || best.backdrop_path || null,
                director: details?.director || null,
                cast: details?.cast || null
              };
            }
          }
        } catch (error) {
          cached = null;
          summary.enrichmentErrors.push({
            title: media.title,
            type: 'tmdb_poster_enrichment',
            detail: error.message || 'TMDB enrichment failed'
          });
          logError('Plex import TMDB poster enrichment failed', error);
        }
        tmdbEnrichmentCache.set(cacheKey, cached);
      }

      if (cached) {
        media.poster_path = media.poster_path || cached.poster_path || null;
        media.backdrop_path = media.backdrop_path || cached.backdrop_path || media.poster_path || null;
        media.tmdb_id = media.tmdb_id || cached.tmdb_id || null;
        media.tmdb_url = media.tmdb_url || cached.tmdb_url || (media.tmdb_id ? `https://www.themoviedb.org/${tmdbType}/${media.tmdb_id}` : null);
        media.director = media.director || cached.director || null;
        media.cast = media.cast || cached.cast || null;
      }
      if (cached?.poster_path) {
        tmdbPosterEnriched += 1;
      } else {
        tmdbPosterLookupMisses += 1;
        if (cached?.tmdb_id || media.tmdb_id) tmdbPosterLookupNoImage += 1;
        else tmdbPosterLookupNoMatch += 1;
        if (tmdbPosterLookupMissSamples.length < 50) {
          tmdbPosterLookupMissSamples.push({
            mediaId: null,
            mediaTitle: media.title || null,
            mediaYear: Number.isFinite(Number(media.year)) ? Number(media.year) : null,
            mediaType: mediaType,
            tmdbId: media.tmdb_id || null,
            tmdbMediaType: tmdbType,
            lookupTitleCandidates: buildLookupTitleCandidates(media.title, mediaType).slice(0, 6),
            posterPresentAfterEnrichment: Boolean(media.poster_path)
          });
        }
      }
    }

    try {
      const plexGuid = media.plex_guid || null;
      const rawPlexRatingKey = media.plex_rating_key || item.raw?.ratingKey || item.raw?.key || null;
      const plexRatingKey = parsePlexRatingKeyFromItemKey(rawPlexRatingKey);
      const rawPlexItemKey = rawPlexRatingKey ? `${item.sectionId}:${rawPlexRatingKey}` : null;
      const plexItemKey = plexRatingKey ? `${item.sectionId}:${plexRatingKey}` : rawPlexItemKey;
      const dedupKey = buildMediaDedupLockKey({
        ...media,
        plex_rating_key: plexItemKey
      }, scopeContext);
      await withDedupLock(dedupKey, async () => {
        let existing = null;

        if (plexGuid) {
        const plexGuidAliasKey = buildMediaIdentityAliasKey('plexGuid', plexGuid);
        const byPlexGuidParams = [plexGuid];
        const byPlexGuidScopeClause = appendScopeSql(byPlexGuidParams, scopeContext, {
          spaceColumn: 'm.space_id',
          libraryColumn: 'm.library_id'
        });
        const byPlexGuid = await pool.query(
          `SELECT m.id
           FROM media m
           JOIN media_metadata mm ON mm.media_id = m.id
           WHERE ((mm."key" = 'plex_guid' AND mm."value" = $1)${plexGuidAliasKey ? ` OR mm."key" = '${plexGuidAliasKey.replace(/'/g, "''")}'` : ''})
             ${byPlexGuidScopeClause}
           ORDER BY m.created_at DESC
           LIMIT 1`,
          byPlexGuidParams
        );
          existing = byPlexGuid.rows[0] || null;
        }

        if (!existing && (plexItemKey || rawPlexItemKey)) {
        const byPlexItemKeyCandidates = [...new Set([plexItemKey, rawPlexItemKey].filter(Boolean))];
        const byPlexItemKeyAliasKeys = byPlexItemKeyCandidates
          .map((value) => buildMediaIdentityAliasKey('plexItemKey', value))
          .filter(Boolean);
        const byPlexItemKeyParams = [byPlexItemKeyCandidates];
        const byPlexItemKeyScopeClause = appendScopeSql(byPlexItemKeyParams, scopeContext, {
          spaceColumn: 'm.space_id',
          libraryColumn: 'm.library_id'
        });
        const byPlexItemKey = await pool.query(
          `SELECT m.id
           FROM media m
           JOIN media_metadata mm ON mm.media_id = m.id
           WHERE ((mm."key" = 'plex_item_key' AND mm."value" = ANY($1::text[]))${byPlexItemKeyAliasKeys.length ? ` OR mm."key" = ANY(ARRAY[${byPlexItemKeyAliasKeys.map((key) => `'${key.replace(/'/g, "''")}'`).join(', ')}]::text[])` : ''})
             ${byPlexItemKeyScopeClause}
           ORDER BY m.created_at DESC
           LIMIT 1`,
          byPlexItemKeyParams
        );
          existing = byPlexItemKey.rows[0] || null;
        }

        if (!existing && media.tmdb_id) {
        const byTmdbParams = [media.tmdb_id, media.tmdb_media_type || 'movie'];
        const byTmdbScopeClause = appendScopeSql(byTmdbParams, scopeContext);
        const byTmdb = await pool.query(
          `SELECT id
           FROM media
           WHERE tmdb_id = $1
             AND COALESCE(tmdb_media_type, 'movie') = COALESCE($2, COALESCE(tmdb_media_type, 'movie'))
             ${byTmdbScopeClause}
           LIMIT 1`,
          byTmdbParams
        );
          existing = byTmdb.rows[0] || null;
        }

        if (!existing) {
        const byTitleYearParams = [media.title, media.year || null];
        const byTitleYearScopeClause = appendScopeSql(byTitleYearParams, scopeContext);
        const byTitleYear = await pool.query(
          `SELECT id, title, media_type, type_details, upc, tmdb_id
           FROM media
           WHERE LOWER(TRIM(title)) = LOWER(TRIM($1))
             AND (
               ($2::int IS NOT NULL AND year = $2::int)
               OR ($2::int IS NULL)
             )
             ${byTitleYearScopeClause}
           ORDER BY created_at DESC
           LIMIT 5`,
          byTitleYearParams
        );
        const titleFallbackCandidates = byTitleYear.rows || [];
        const safeTitleFallbackCandidate = titleFallbackCandidates.find((candidate) => {
          const conflicts = assessTitleFallbackStrongIdentifierConflicts({
            item: media,
            normalizedTypeDetails: media.type_details,
            resolvedIdentifiers: { isbn: '', eanUpc: '', asin: '' },
            candidateRow: candidate
          });
          return conflicts.length === 0;
        }) || null;
          existing = safeTitleFallbackCandidate || null;
        }

        if (existing) {
        const ownedFormatState = buildOwnedFormatsPayload(media.media_type || 'movie', media.owned_formats, media.format);
        const updateParams = [
          media.original_title,
          media.release_date,
          media.year,
          ownedFormatState.format,
          ownedFormatState.ownedFormats,
          media.director,
          media.cast,
          media.rating,
          media.runtime,
          media.poster_path,
          media.backdrop_path,
          media.overview,
          media.tmdb_id,
          media.tmdb_media_type || 'movie',
          media.tmdb_url,
          normalizeMediaType(media.media_type || 'movie', 'movie'),
          media.network,
          `Imported from Plex section ${item.sectionId}`,
          existing.id
        ];
        const updateScopeClause = appendScopeSql(updateParams, scopeContext);
        await pool.query(
          `UPDATE media SET
           original_title = COALESCE($1, original_title),
           release_date = COALESCE($2, release_date),
           year = COALESCE($3, year),
           format = COALESCE($4, format),
           owned_formats = COALESCE($5::text[], owned_formats),
           director = COALESCE($6, director),
           cast_members = COALESCE($7, cast_members),
           rating = COALESCE($8, rating),
           runtime = COALESCE($9, runtime),
           poster_path = COALESCE($10, poster_path),
           backdrop_path = COALESCE($11, backdrop_path),
           overview = COALESCE($12, overview),
           tmdb_id = COALESCE($13, tmdb_id),
           tmdb_media_type = COALESCE($14, tmdb_media_type),
           tmdb_url = COALESCE($15, tmdb_url),
           media_type = COALESCE($16, media_type),
           network = COALESCE($17, network),
           notes = COALESCE($18, notes),
           import_source = 'plex'
           WHERE id = $19${updateScopeClause}
           RETURNING id, genre, director, cast_members AS cast`,
          updateParams
        );
        const refreshed = await pool.query('SELECT id, genre, director, cast_members AS cast FROM media WHERE id = $1', [existing.id]);
        const updatedRow = refreshed.rows[0] || { id: existing.id, genre: null, director: media.director || null, cast: media.cast || null };
        await syncNormalizedMetadataForMedia({
          mediaId: updatedRow.id,
          genre: updatedRow.genre,
          director: updatedRow.director,
          cast: updatedRow.cast
        });
        await upsertMediaMetadata(existing.id, 'plex_guid', plexGuid);
        await upsertMediaMetadata(existing.id, 'plex_item_key', plexItemKey);
        await upsertMediaMetadata(existing.id, 'plex_section_id', item.sectionId);
        if (shouldPersistVariant(media.media_type, item.variant)) {
          await upsertMediaVariant(existing.id, item.variant);
        }
        await upsertMediaSeason(existing.id, media, item.variant);
        if (String(item.raw?.type || '').toLowerCase() === 'show') {
          await upsertPlexShowSeasons(existing.id, item.sectionId, plexRatingKey);
        }
        await hydrateTmdbSeasonExpectedCounts(existing.id, media.tmdb_id, {
          title: media.title,
          year: media.year,
          mediaType: media.media_type,
          tmdbMediaType: media.tmdb_media_type
        });
          summary.updated += 1;
        } else {
        const ownedFormatState = buildOwnedFormatsPayload(media.media_type || 'movie', media.owned_formats, media.format);
        const inserted = await pool.query(
          `INSERT INTO media (
             title, original_title, release_date, year, format, owned_formats, director, cast_members, rating,
             runtime, poster_path, backdrop_path, overview, tmdb_id, tmdb_media_type, tmdb_url, media_type, network, notes,
             library_id, space_id, added_by, import_source
           ) VALUES (
             $1,$2,$3,$4,$5,$6::text[],$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
           )
           RETURNING id, genre, director, cast_members AS cast`,
          [
            media.title,
            media.original_title,
            media.release_date,
            media.year,
            ownedFormatState.format || 'Digital',
            ownedFormatState.ownedFormats,
            media.director,
            media.cast,
            media.rating,
            media.runtime,
            media.poster_path,
            media.backdrop_path,
            media.overview,
            media.tmdb_id,
            media.tmdb_media_type || 'movie',
            media.tmdb_url,
            normalizeMediaType(media.media_type || 'movie', 'movie'),
            media.network,
            `Imported from Plex section ${item.sectionId}`,
            scopeContext.libraryId || null,
            scopeContext.spaceId || null,
            req.user.id,
            'plex'
          ]
        );
          const insertedRow = inserted.rows[0] || null;
          const insertedId = insertedRow?.id;
          if (insertedId) {
          createdMediaIds.push(insertedId);
          await syncNormalizedMetadataForMedia({
            mediaId: insertedId,
            genre: insertedRow.genre,
            director: insertedRow.director,
            cast: insertedRow.cast
          });
          await upsertMediaMetadata(insertedId, 'plex_guid', plexGuid);
          await upsertMediaMetadata(insertedId, 'plex_item_key', plexItemKey);
          await upsertMediaMetadata(insertedId, 'plex_section_id', item.sectionId);
          if (shouldPersistVariant(media.media_type, item.variant)) {
            await upsertMediaVariant(insertedId, item.variant);
          }
          await upsertMediaSeason(insertedId, media, item.variant);
          if (String(item.raw?.type || '').toLowerCase() === 'show') {
            await upsertPlexShowSeasons(insertedId, item.sectionId, plexRatingKey);
          }
          await hydrateTmdbSeasonExpectedCounts(insertedId, media.tmdb_id, {
            title: media.title,
            year: media.year,
            mediaType: media.media_type,
            tmdbMediaType: media.tmdb_media_type
          });
          }
          summary.created += 1;
        }
      });
    } catch (error) {
      summary.errors.push({ title: media.title, detail: error.message });
    }

    const processed = idx + 1;
    if (processed === items.length || processed % PLEX_JOB_PROGRESS_BATCH_SIZE === 0) {
      await updateProgress({
        total: items.length,
        processed,
        created: summary.created,
        updated: summary.updated,
        skipped: summary.skipped,
        errorCount: summary.errors.length
      });
    }
  }

  return {
    imported: items.length,
    createdMediaIds,
    summary: {
      ...summary,
      tmdbPosterLookupMissSamples
    },
    tmdbPosterEnriched,
    tmdbPosterLookupMisses,
    tmdbPosterLookupNoMatch,
    tmdbPosterLookupNoImage,
    variantsCreated,
    variantsUpdated,
    seasonsCreated,
    seasonsUpdated
  };
}

async function runMetronImport({ req, config, scopeContext = null, onProgress = null }) {
  const summary = { created: 0, updated: 0, skipped: 0, skipped_existing: 0, errors: [] };
  const createdMediaIds = [];
  const detailCache = new Map();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const fetchDetailWithRetry = async (providerIssueId) => {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await fetchMetronIssueDetails(config, providerIssueId);
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await sleep(300 * (attempt + 1));
        }
      }
    }
    throw lastError || new Error('Metron detail lookup failed');
  };
  const updateProgress = async (progress) => {
    if (typeof onProgress !== 'function') return;
    await onProgress(progress);
  };

  const { issues, endpoint } = await fetchMetronCollectionIssues(config, { limit: 2500 });
  const incomingProviderIssueIds = [...new Set(
    issues
      .map((issue) => String(issue?.type_details?.provider_issue_id || issue?.id || '').trim())
      .filter(Boolean)
  )];
  const existingProviderIssueIds = new Set();
  if (incomingProviderIssueIds.length > 0) {
    const existingParams = [incomingProviderIssueIds];
    const existingScopeClause = appendScopeSql(existingParams, scopeContext, {
      spaceColumn: 'm.space_id',
      libraryColumn: 'm.library_id'
    });
    const existing = await pool.query(
      `SELECT DISTINCT COALESCE(m.type_details->>'provider_issue_id', '') AS provider_issue_id
       FROM media m
       WHERE m.media_type = 'comic_book'
         AND COALESCE(m.type_details->>'provider_issue_id', '') = ANY($1::text[])
         ${existingScopeClause}`,
      existingParams
    );
    for (const row of existing.rows || []) {
      const value = String(row?.provider_issue_id || '').trim();
      if (value) existingProviderIssueIds.add(value);
    }
  }
  const pendingIssues = issues.filter((issue) => {
    const providerIssueId = String(issue?.type_details?.provider_issue_id || issue?.id || '').trim();
    if (!providerIssueId) return true;
    return !existingProviderIssueIds.has(providerIssueId);
  });
  summary.skipped_existing = issues.length - pendingIssues.length;

  await updateProgress({
    total: pendingIssues.length,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: summary.skipped_existing,
    errorCount: 0
  });

  for (let idx = 0; idx < pendingIssues.length; idx += 1) {
    const issue = pendingIssues[idx];
    if (!issue?.title) {
      summary.skipped += 1;
      continue;
    }
    try {
      let mergedIssue = issue;
      const providerIssueId = String(issue?.type_details?.provider_issue_id || issue?.id || '').trim();
      if (providerIssueId) {
        if (!detailCache.has(providerIssueId)) {
          try {
            const detailed = await fetchDetailWithRetry(providerIssueId);
            detailCache.set(providerIssueId, detailed);
          } catch (_detailError) {
            detailCache.set(providerIssueId, null);
          }
        }
        const detailed = detailCache.get(providerIssueId);
        if (detailed) {
          mergedIssue = {
            ...issue,
            ...detailed,
            type_details: {
              ...(issue.type_details || {}),
              ...(detailed.type_details || {}),
              provider_issue_id: providerIssueId
            },
            tmdb_url: detailed.external_url || issue.external_url || null,
            poster_path: detailed.poster_path || issue.poster_path || null,
            overview: detailed.overview || issue.overview || null,
            upc: detailed.upc || issue.upc || null
          };
        }
      }

      const prepared = {
        title: mergedIssue.title,
        media_type: 'comic_book',
        year: mergedIssue.year || null,
        release_date: mergedIssue.release_date || null,
        format: 'Digital',
        overview: mergedIssue.overview || null,
        tmdb_url: mergedIssue.external_url || null,
        poster_path: mergedIssue.poster_path || null,
        upc: mergedIssue.upc || null,
        type_details: {
          ...(mergedIssue.type_details || {}),
          provider_issue_id: providerIssueId || null
        },
        library_id: scopeContext?.libraryId || null,
        space_id: scopeContext?.spaceId || null
      };
      const result = await upsertImportedMedia({
        userId: req.user.id,
        item: prepared,
        importSource: 'metron',
        scopeContext
      });
      if (result.type === 'created') {
        summary.created += 1;
        if (result.mediaId) createdMediaIds.push(result.mediaId);
      }
      else if (result.type === 'updated') summary.updated += 1;
      else summary.skipped += 1;
      if (result.mediaId && issue.id) {
        await upsertMediaMetadataEntry(result.mediaId, 'metron_issue_id', issue.id);
      }
    } catch (error) {
      summary.errors.push({ title: issue.title, detail: error.message || 'Metron import failed' });
    }

    const processed = idx + 1;
    if (processed === pendingIssues.length || processed % CSV_JOB_PROGRESS_BATCH_SIZE === 0) {
      await updateProgress({
        total: pendingIssues.length,
        processed,
        created: summary.created,
        updated: summary.updated,
        skipped: summary.skipped + summary.skipped_existing,
        errorCount: summary.errors.length
      });
    }
  }

  return {
    imported: pendingIssues.length,
    totalAvailable: issues.length,
    createdMediaIds,
    summary,
    collectionEndpoint: endpoint
  };
}

async function maybePushComicToMetron({ req, mediaRow }) {
  if (!mediaRow || mediaRow.media_type !== 'comic_book') return;
  const scopeContext = resolveScopeContext(req);
  const config = await loadScopedIntegrationConfig(mediaRow.space_id || scopeContext?.spaceId || null);
  if (String(config.comicsProvider || '').toLowerCase() !== 'metron') return;
  if (!config.comicsApiKey || !config.comicsApiUrl) return;

  const details = mediaRow.type_details && typeof mediaRow.type_details === 'object'
    ? mediaRow.type_details
    : {};
  let issueId = details.provider_issue_id || null;
  if (!issueId) {
    try {
      const matches = await searchComicsByTitle(String(mediaRow.title || '').trim(), config, 6);
      const best = pickBestProviderMatch(matches, mediaRow.title, mediaRow.year);
      issueId = best?.id || null;
    } catch (_error) {
      issueId = null;
    }
  }
  if (!issueId) return;

  try {
    await pushMetronCollectionIssue(config, issueId);
    await logActivity(req, 'media.metron.push.success', 'media', mediaRow.id, {
      issueId: String(issueId),
      title: mediaRow.title
    });
  } catch (error) {
    await logActivity(req, 'media.metron.push.failed', 'media', mediaRow.id, {
      issueId: String(issueId),
      title: mediaRow.title,
      detail: error.message || 'Metron push failed'
    });
  }
}

async function runGenericCsvImport({
  rows,
  userId,
  scopeContext,
  onProgress = null,
  importSource = 'csv_generic',
  reviewContext = null
}) {
  const summary = {
    created: 0,
    updated: 0,
    skipped_invalid: 0,
    skipped_collection: 0,
    diagnosticsFlagged: 0,
    normalizationReviewCandidates: 0,
    normalizationReviewRows: 0,
    collectionsDetected: 0,
    collectionsCreated: 0,
    collectionItemsSeeded: 0,
    errors: [],
    matchModes: buildImportMatchCounters(),
    enrichment: buildImportEnrichmentCounters(),
    auditOutcomes: buildImportAuditOutcomeCounters()
  };
  const auditRows = [];
  const createdMediaIds = [];
  const config = await loadScopedIntegrationConfig(scopeContext?.spaceId || null);
  const caches = { tmdbCache: new Map(), providerCache: new Map() };
  const updateProgress = async (progress) => {
    if (typeof onProgress !== 'function') return;
    await onProgress(progress);
  };

  await updateProgress({
    total: rows.length,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errorCount: 0
  });

  for (let idx = 0; idx < rows.length; idx += 1) {
    const row = rows[idx];
    const rowTypeDetails = row?.type_details || {};
    const value = (name) => getRowValue(row, name);
    const mappedMediaType = normalizeMediaType(
      value('media_type') || value('media type') || value('type') || value('item type') || 'movie',
      'movie'
    );
    const mapped = {
      title: value('title'),
      media_type: mappedMediaType,
      original_title: value('original_title') || '',
      release_date: parseDateOnly(value('release_date')),
      year: parseYear(value('year') || value('release_date')),
      owned_formats: parseOwnedFormatsInput(
        mappedMediaType,
        value('owned_formats') || value('owned formats'),
        value('format')
      ),
      format: normalizeMediaFormat(value('format')),
      genre: value('genre'),
      director: value('director'),
      cast: value('cast') || value('actors') || value('actor'),
      rating: value('rating') ? Number(value('rating')) : null,
      user_rating: value('user_rating') ? Number(value('user_rating')) : null,
      tmdb_url: value('tmdb_url')
        || (['movie', 'tv_series', 'tv_episode'].includes(mappedMediaType) ? value('external_url') : null)
        || null,
      poster_path: value('poster_path') || value('image_url') || null,
      overview: value('overview') || value('summary') || value('description') || null,
      runtime: value('runtime') ? Number(value('runtime')) : null,
      upc: value('upc'),
      signed_by: value('signed_by') || value('signed by'),
      signed_role: normalizeSignedRole(value('signed_role') || value('signed role')),
      signed_on: parseDateOnly(value('signed_on') || value('signed on')),
      signed_at: value('signed_at') || value('signed at'),
      location: value('location'),
      notes: value('notes'),
      type_details: {
        author: value('author') || rowTypeDetails.author || null,
        isbn: value('isbn') || value('isbn13') || rowTypeDetails.isbn || null,
        publisher: value('publisher') || rowTypeDetails.publisher || null,
        edition: value('edition') || rowTypeDetails.edition || null,
        series: value('series') || rowTypeDetails.series || null,
        issue_number: value('issue_number') || value('issue number') || rowTypeDetails.issue_number || null,
        volume: value('volume') || rowTypeDetails.volume || null,
        writer: value('writer') || rowTypeDetails.writer || null,
        artist: value('artist') || rowTypeDetails.artist || null,
        inker: value('inker') || rowTypeDetails.inker || null,
        colorist: value('colorist') || rowTypeDetails.colorist || null,
        cover_date: value('cover_date') || value('cover date') || rowTypeDetails.cover_date || null,
        album: value('album') || rowTypeDetails.album || null,
        track_count: value('track_count') || rowTypeDetails.track_count || null,
        platform: value('platform') || rowTypeDetails.platform || null,
        developer: value('developer') || rowTypeDetails.developer || null,
        region: value('region') || rowTypeDetails.region || null,
        provider_issue_id: value('provider_issue_id') || rowTypeDetails.provider_issue_id || null,
        provider_name: value('provider_name') || rowTypeDetails.provider_name || null,
        provider_item_id: value('provider_item_id') || rowTypeDetails.provider_item_id || rowTypeDetails.calibre_entry_id || null,
        provider_external_url: value('provider_external_url') || rowTypeDetails.provider_external_url || rowTypeDetails.calibre_external_url || value('external_url') || null,
        provider_download_url: value('provider_download_url') || rowTypeDetails.provider_download_url || rowTypeDetails.calibre_download_url || null,
        calibre_entry_id: value('calibre_entry_id') || rowTypeDetails.calibre_entry_id || null,
        calibre_external_url: value('calibre_external_url') || rowTypeDetails.calibre_external_url || null,
        calibre_download_url: value('calibre_download_url') || rowTypeDetails.calibre_download_url || null,
        source_updated_at: value('source_updated_at') || rowTypeDetails.source_updated_at || null
      }
    };
    let collectionId = null;
    const boxedSet = detectBoxedSetCandidate(mapped.title, mapped.notes);
    const collectionOnly = boxedSet.isCandidate;
    if (boxedSet.isCandidate) {
      summary.collectionsDetected += 1;
      const collection = await ensureImportCollection({
        userId,
        scopeContext,
        importSource,
        mediaType: mapped.media_type || 'movie',
        sourceTitle: mapped.title,
        expectedItemCount: boxedSet.expectedItemCount,
        metadata: {
          detectedBy: 'title_pattern',
          rowNumber: idx + 2
        }
      });
      collectionId = collection.id;
      if (collectionId) {
        if (collection.created) summary.collectionsCreated += 1;
        if (boxedSet.containedTitles.length > 0) {
          for (let ci = 0; ci < boxedSet.containedTitles.length; ci += 1) {
            const containedTitle = boxedSet.containedTitles[ci];
            const itemId = await addCollectionItem({
              collectionId,
              containedTitle,
              position: ci + 1,
              confidenceScore: 40,
              sourcePayload: { source: 'import_parse' }
            });
            if (itemId) summary.collectionItemsSeeded += 1;
          }
        }
      }
    }
    if (collectionOnly) {
      summary.skipped_collection += 1;
      incrementImportAuditOutcomeCounter(summary.auditOutcomes, 'collection_only');
      auditRows.push({
        row: idx + 2,
        media_type: mapped.media_type || '',
        title: mapped.title || '',
        status: 'skipped_collection',
        detail: 'Collection source title handled in collections-only mode',
        enrichment_status: 'not_applicable',
        audit_outcome: 'collection_only',
        classification_detail: deriveImportAuditClassificationDetail({
          upsertStatus: 'skipped_collection',
          matchMode: null,
          matchedBy: null,
          enrichmentStatus: 'not_applicable',
          lookupPath: 'none',
          mediaType: mapped.media_type || 'movie',
          importSource
        })
      });
      const processed = idx + 1;
      if (processed === rows.length || processed % CSV_JOB_PROGRESS_BATCH_SIZE === 0) {
        await updateProgress({
          total: rows.length,
          processed,
          created: summary.created,
          updated: summary.updated,
          skipped: summary.skipped_invalid + summary.skipped_collection,
          errorCount: summary.errors.length
        });
      }
      continue;
    }
    const rowIdentifiers = normalizeIdentifierSet({
      isbn: value('isbn') || value('isbn13'),
      ean_upc: value('ean') || value('upc') || value('ean_upc'),
      asin: value('asin') || value('amazon_item_id') || value('amazon_link') || value('amazon link')
    });
    try {
      const enrichmentResult = await runImportEnrichmentPipeline(
        { ...mapped, identifiers: rowIdentifiers },
        config,
        caches,
        rowIdentifiers
      );
      const enriched = enrichmentResult.item;
      incrementImportEnrichmentCounter(summary.enrichment, enrichmentResult.enrichmentStatus);
      const result = await upsertImportedMedia({
        userId,
        item: enriched,
        importSource,
        scopeContext,
        identifiers: rowIdentifiers
      });
      if (result.mediaId) {
        await upsertMediaMetadataEntry(result.mediaId, 'isbn', rowIdentifiers.isbn);
        await upsertMediaMetadataEntry(result.mediaId, 'ean', rowIdentifiers.eanUpc);
        await upsertMediaMetadataEntry(result.mediaId, 'ean_upc', rowIdentifiers.eanUpc);
        await upsertMediaMetadataEntry(result.mediaId, 'amazon_item_id', rowIdentifiers.asin);
        await upsertMediaMetadataEntry(result.mediaId, 'provider_item_id', mapped.type_details?.provider_item_id || '');
        await upsertMediaMetadataEntry(result.mediaId, 'calibre_entry_id', mapped.type_details?.calibre_entry_id || '');
        if (collectionId) {
          const itemId = await addCollectionItem({
            collectionId,
            mediaId: result.mediaId,
            containedTitle: mapped.title || null,
            sourcePayload: { source: 'import_upsert' }
          });
          if (itemId) summary.collectionItemsSeeded += 1;
        }
      }
      incrementImportMatchCounter(summary.matchModes, result.matchMode);
      summary.normalizationReviewCandidates += Array.isArray(result.normalizationReviewCandidates)
        ? result.normalizationReviewCandidates.length
        : 0;
      const confidenceScore = deriveImportConfidenceScore({
        matchMode: result.matchMode,
        matchedBy: result.matchedBy,
        enrichmentStatus: enrichmentResult.enrichmentStatus,
        mediaType: mapped.media_type || 'movie',
        importSource,
        lookupStatus: enrichmentResult.lookupStatus
      });
      const diagnosticFlagged = shouldFlagImportDiagnostic({
        matchMode: result.matchMode,
        enrichmentStatus: enrichmentResult.enrichmentStatus,
        confidenceScore,
        upsertStatus: result.type,
        mediaType: mapped.media_type || 'movie',
        importSource
      });
      const classificationDetail = deriveImportAuditClassificationDetail({
        upsertStatus: result.type,
        matchMode: result.matchMode,
        matchedBy: result.matchedBy,
        enrichmentStatus: enrichmentResult.enrichmentStatus,
        lookupPath: enrichmentResult.lookupPath,
        mediaType: mapped.media_type || 'movie',
        importSource
      });
      const auditOutcome = deriveImportAuditOutcome({
        upsertStatus: result.type,
        matchedBy: result.matchedBy,
        matchMode: result.matchMode,
        diagnosticFlagged
      });
      if (auditOutcome === 'review_candidate_created') {
        summary.normalizationReviewRows += 1;
      }
      if (diagnosticFlagged) {
        await emitImportDiagnosticFlag({
          auditReq: reviewContext?.auditReq || null,
          jobId: reviewContext?.jobId || null,
          importSource,
          provider: reviewContext?.provider || 'csv_generic',
          rowNumber: idx + 2,
          sourceTitle: mapped.title || '',
          mediaType: mapped.media_type || 'movie',
          upsertStatus: result.type,
          matchMode: result.matchMode || null,
          matchedBy: result.matchedBy || null,
          enrichmentStatus: enrichmentResult.enrichmentStatus,
          proposedMediaId: result.mediaId || null,
          confidenceScore,
          lookupPath: enrichmentResult.lookupPath || 'none',
          lookupStatus: enrichmentResult.lookupStatus || 'none',
          identifiers: rowIdentifiers,
          collectionId,
          classificationDetail,
          auditOutcome
        });
        summary.diagnosticsFlagged += 1;
      }
      if (result.type === 'created') {
        summary.created += 1;
        if (result.mediaId) createdMediaIds.push(result.mediaId);
        incrementImportAuditOutcomeCounter(summary.auditOutcomes, auditOutcome);
        auditRows.push({
          row: idx + 2,
          media_type: mapped.media_type || '',
          title: mapped.title || '',
          status: 'created',
          detail: '',
          match_mode: result.matchMode || null,
          matched_by: result.matchedBy || null,
          enrichment_status: enrichmentResult.enrichmentStatus,
          lookup_path: enrichmentResult.lookupPath || 'none',
          lookup_status: enrichmentResult.lookupStatus || 'none',
          audit_outcome: auditOutcome,
          classification_detail: classificationDetail,
          confidence_score: confidenceScore,
          diagnostic_flagged: diagnosticFlagged,
          normalization_review_candidates: result.normalizationReviewCandidates || [],
          normalization_review_candidate_count: Array.isArray(result.normalizationReviewCandidates) ? result.normalizationReviewCandidates.length : 0,
          isbn: rowIdentifiers.isbn || '',
          ean_upc: rowIdentifiers.eanUpc || '',
          asin: rowIdentifiers.asin || ''
        });
      } else if (result.type === 'updated') {
        summary.updated += 1;
        incrementImportAuditOutcomeCounter(summary.auditOutcomes, auditOutcome);
        auditRows.push({
          row: idx + 2,
          media_type: mapped.media_type || '',
          title: mapped.title || '',
          status: 'updated',
          detail: '',
          match_mode: result.matchMode || null,
          matched_by: result.matchedBy || null,
          enrichment_status: enrichmentResult.enrichmentStatus,
          lookup_path: enrichmentResult.lookupPath || 'none',
          lookup_status: enrichmentResult.lookupStatus || 'none',
          audit_outcome: auditOutcome,
          classification_detail: classificationDetail,
          confidence_score: confidenceScore,
          diagnostic_flagged: diagnosticFlagged,
          normalization_review_candidates: result.normalizationReviewCandidates || [],
          normalization_review_candidate_count: Array.isArray(result.normalizationReviewCandidates) ? result.normalizationReviewCandidates.length : 0,
          isbn: rowIdentifiers.isbn || '',
          ean_upc: rowIdentifiers.eanUpc || '',
          asin: rowIdentifiers.asin || ''
        });
      } else {
        summary.skipped_invalid += 1;
        incrementImportAuditOutcomeCounter(summary.auditOutcomes, 'skipped_invalid');
        auditRows.push({
          row: idx + 2,
          media_type: mapped.media_type || '',
          title: mapped.title || '',
          status: 'skipped_invalid',
          detail: result.detail || 'Invalid row',
          match_mode: result.matchMode || null,
          matched_by: result.matchedBy || null,
          enrichment_status: enrichmentResult.enrichmentStatus,
          lookup_path: enrichmentResult.lookupPath || 'none',
          lookup_status: enrichmentResult.lookupStatus || 'none',
          audit_outcome: 'skipped_invalid',
          classification_detail: classificationDetail,
          confidence_score: confidenceScore,
          diagnostic_flagged: diagnosticFlagged,
          normalization_review_candidates: result.normalizationReviewCandidates || [],
          normalization_review_candidate_count: Array.isArray(result.normalizationReviewCandidates) ? result.normalizationReviewCandidates.length : 0,
          isbn: rowIdentifiers.isbn || '',
          ean_upc: rowIdentifiers.eanUpc || '',
          asin: rowIdentifiers.asin || ''
        });
      }
    } catch (error) {
      summary.errors.push({ row: idx + 2, detail: error.message });
      incrementImportAuditOutcomeCounter(summary.auditOutcomes, 'error');
      auditRows.push({
        row: idx + 2,
        media_type: mapped.media_type || '',
        title: mapped.title || '',
        status: 'error',
        detail: error.message,
        enrichment_status: 'not_attempted',
        lookup_path: 'none',
        lookup_status: 'none',
        audit_outcome: 'error',
        classification_detail: deriveImportAuditClassificationDetail({
          upsertStatus: 'error',
          matchMode: null,
          matchedBy: null,
          enrichmentStatus: 'not_attempted',
          lookupPath: 'none',
          mediaType: mapped.media_type || 'movie',
          importSource
        })
      });
    }

    const processed = idx + 1;
    if (processed === rows.length || processed % CSV_JOB_PROGRESS_BATCH_SIZE === 0) {
      await updateProgress({
        total: rows.length,
        processed,
        created: summary.created,
        updated: summary.updated,
        skipped: summary.skipped_invalid + summary.skipped_collection,
        errorCount: summary.errors.length
      });
    }
  }

  return { rows: rows.length, summary, auditRows, createdMediaIds };
}

async function runDeliciousCsvImport({
  rows,
  userId,
  scopeContext,
  onProgress = null,
  reviewContext = null
}) {
  const summary = {
    created: 0,
    updated: 0,
    skipped_non_movie: 0,
    skipped_invalid: 0,
    skipped_collection: 0,
    diagnosticsFlagged: 0,
    normalizationReviewCandidates: 0,
    normalizationReviewRows: 0,
    collectionsDetected: 0,
    collectionsCreated: 0,
    collectionItemsSeeded: 0,
    errors: [],
    matchModes: buildImportMatchCounters(),
    enrichment: buildImportEnrichmentCounters(),
    auditOutcomes: buildImportAuditOutcomeCounters()
  };
  const auditRows = [];
  const createdMediaIds = [];
  const config = await loadScopedIntegrationConfig(scopeContext?.spaceId || null);
  const caches = { tmdbCache: new Map(), providerCache: new Map() };
  const updateProgress = async (progress) => {
    if (typeof onProgress !== 'function') return;
    await onProgress(progress);
  };

  await updateProgress({
    total: rows.length,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errorCount: 0
  });

  for (let idx = 0; idx < rows.length; idx += 1) {
    const row = rows[idx];
    const normalizedRow = normalizeDeliciousRow(row);
    const itemType = String(normalizedRow.itemType || '').trim().toLowerCase();
    const mappedMediaType = mapDeliciousItemTypeToMediaType(itemType);
    if (!mappedMediaType) {
      summary.skipped_non_movie += 1;
      incrementImportAuditOutcomeCounter(summary.auditOutcomes, 'skipped_invalid');
      auditRows.push({
        row: idx + 2,
        media_type: mappedMediaType || '',
        title: normalizedRow.rawTitle,
        status: 'skipped_non_movie',
        detail: `unmapped item type: ${itemType || 'unknown'}`,
        enrichment_status: 'not_applicable',
        audit_outcome: 'skipped_invalid',
        classification_detail: deriveImportAuditClassificationDetail({
          upsertStatus: 'skipped_non_movie',
          matchMode: null,
          matchedBy: null,
          enrichmentStatus: 'not_applicable',
          lookupPath: 'none',
          mediaType: mappedMediaType || 'movie',
          importSource: 'csv_delicious'
        })
      });
    } else {
      const title = normalizedRow.normalizedTitle;
      if (!title) {
        summary.skipped_invalid += 1;
        incrementImportAuditOutcomeCounter(summary.auditOutcomes, 'skipped_invalid');
        auditRows.push({
          row: idx + 2,
          media_type: mappedMediaType || '',
          title: '',
          status: 'skipped_invalid',
          detail: 'Missing title',
          match_mode: null,
          matched_by: null,
          enrichment_status: 'not_attempted',
          audit_outcome: 'skipped_invalid',
          classification_detail: deriveImportAuditClassificationDetail({
            upsertStatus: 'skipped_invalid',
            matchMode: null,
            matchedBy: null,
            enrichmentStatus: 'not_attempted',
            lookupPath: 'none',
            mediaType: mappedMediaType || 'movie',
            importSource: 'csv_delicious'
          }),
          isbn: '',
          ean_upc: '',
          asin: ''
        });
      } else {
        const sourceNotes = [normalizedRow.notesRaw];
        if (normalizedRow.edition) sourceNotes.push(`Edition: ${normalizedRow.edition}`);
        if (normalizedRow.normalizedPlatform) sourceNotes.push(`Platform: ${normalizedRow.normalizedPlatform}`);
        const mapped = {
          title,
          media_type: mappedMediaType,
          original_title: normalizedRow.rawTitle && normalizedRow.rawTitle !== title ? normalizedRow.rawTitle : null,
          year: parseYear(normalizedRow.releaseDateRaw) || parseYear(normalizedRow.creationDateRaw),
          release_date: parseDateOnly(normalizedRow.releaseDateRaw),
          format: normalizeMediaFormat(normalizedRow.formatRaw),
          genre: null,
          director: normalizedRow.creator || null,
          user_rating: normalizedRow.ratingRaw ? Number(normalizedRow.ratingRaw) : null,
          upc: normalizedRow.ean || null,
          signed_by: normalizedRow.signedBy || null,
          signed_role: normalizeSignedRole(normalizedRow.signedRole) || null,
          signed_on: parseDateOnly(normalizedRow.signedOnRaw),
          signed_at: normalizedRow.signedAt || null,
          notes: sourceNotes.filter(Boolean).join(' | ') || null,
          type_details: {
            author: normalizedRow.creator || null,
            isbn: normalizedRow.isbn || null,
            edition: normalizedRow.edition || null,
            artist: normalizedRow.creator || null,
            album: title,
            platform: normalizedRow.normalizedPlatform || null
          }
        };
        let collectionId = null;
        const boxedSet = detectBoxedSetCandidate(title, mapped.notes);
        const collectionOnly = boxedSet.isCandidate;
        if (boxedSet.isCandidate) {
          summary.collectionsDetected += 1;
          const collection = await ensureImportCollection({
            userId,
            scopeContext,
            importSource: 'csv_delicious',
            mediaType: mapped.media_type || 'movie',
            sourceTitle: title,
            expectedItemCount: boxedSet.expectedItemCount,
            metadata: {
              detectedBy: 'title_pattern',
              rowNumber: idx + 2,
              itemType: itemType || null
            }
          });
          collectionId = collection.id;
          if (collectionId) {
            if (collection.created) summary.collectionsCreated += 1;
            if (boxedSet.containedTitles.length > 0) {
              for (let ci = 0; ci < boxedSet.containedTitles.length; ci += 1) {
                const itemId = await addCollectionItem({
                  collectionId,
                  containedTitle: boxedSet.containedTitles[ci],
                  position: ci + 1,
                  confidenceScore: 40,
                  sourcePayload: { source: 'import_parse' }
                });
                if (itemId) summary.collectionItemsSeeded += 1;
              }
            }
          }
        }
        if (collectionOnly) {
          summary.skipped_collection += 1;
          incrementImportAuditOutcomeCounter(summary.auditOutcomes, 'collection_only');
          auditRows.push({
            row: idx + 2,
            media_type: mapped.media_type || '',
            title,
            status: 'skipped_collection',
            detail: 'Collection source title handled in collections-only mode',
            enrichment_status: 'not_applicable',
            audit_outcome: 'collection_only',
            classification_detail: deriveImportAuditClassificationDetail({
              upsertStatus: 'skipped_collection',
              matchMode: null,
              matchedBy: null,
              enrichmentStatus: 'not_applicable',
              lookupPath: 'none',
              mediaType: mapped.media_type || 'movie',
              importSource: 'csv_delicious'
            })
          });
          const processed = idx + 1;
          if (processed === rows.length || processed % CSV_JOB_PROGRESS_BATCH_SIZE === 0) {
            await updateProgress({
              total: rows.length,
              processed,
              created: summary.created,
              updated: summary.updated,
              skipped: summary.skipped_invalid + summary.skipped_non_movie + summary.skipped_collection,
              errorCount: summary.errors.length
            });
          }
          continue;
        }
        const rowIdentifiers = normalizeIdentifierSet({
          isbn: normalizedRow.isbn || '',
          ean_upc: normalizedRow.ean || '',
          asin: normalizedRow.amazonItemId || ''
        });

        try {
          const enrichmentResult = await runImportEnrichmentPipeline(
            { ...mapped, identifiers: rowIdentifiers },
            config,
            caches,
            rowIdentifiers
          );
          const enriched = enrichmentResult.item;
          incrementImportEnrichmentCounter(summary.enrichment, enrichmentResult.enrichmentStatus);
          const result = await upsertImportedMedia({
            userId,
            item: enriched,
            importSource: 'csv_delicious',
            scopeContext,
            identifiers: rowIdentifiers
          });
          incrementImportMatchCounter(summary.matchModes, result.matchMode);
          summary.normalizationReviewCandidates += Array.isArray(result.normalizationReviewCandidates)
            ? result.normalizationReviewCandidates.length
            : 0;
          const confidenceScore = deriveImportConfidenceScore({
            matchMode: result.matchMode,
            matchedBy: result.matchedBy,
            enrichmentStatus: enrichmentResult.enrichmentStatus,
            mediaType: mapped.media_type || 'movie',
            importSource: 'csv_delicious',
            lookupStatus: enrichmentResult.lookupStatus
          });
          const diagnosticFlagged = shouldFlagImportDiagnostic({
            matchMode: result.matchMode,
            enrichmentStatus: enrichmentResult.enrichmentStatus,
            confidenceScore,
            upsertStatus: result.type,
            mediaType: mapped.media_type || 'movie',
            importSource: 'csv_delicious'
          });
          const classificationDetail = deriveImportAuditClassificationDetail({
            upsertStatus: result.type,
            matchMode: result.matchMode,
            matchedBy: result.matchedBy,
            enrichmentStatus: enrichmentResult.enrichmentStatus,
            lookupPath: enrichmentResult.lookupPath,
            mediaType: mapped.media_type || 'movie',
            importSource: 'csv_delicious'
          });
          const auditOutcome = deriveImportAuditOutcome({
            upsertStatus: result.type,
            matchedBy: result.matchedBy,
            matchMode: result.matchMode,
            diagnosticFlagged
          });
          if (auditOutcome === 'review_candidate_created') {
            summary.normalizationReviewRows += 1;
          }
          if (diagnosticFlagged) {
            await emitImportDiagnosticFlag({
              auditReq: reviewContext?.auditReq || null,
              jobId: reviewContext?.jobId || null,
              importSource: 'csv_delicious',
              provider: reviewContext?.provider || 'csv_delicious',
              rowNumber: idx + 2,
              sourceTitle: title,
              mediaType: mapped.media_type || 'movie',
              upsertStatus: result.type,
              matchMode: result.matchMode || null,
              matchedBy: result.matchedBy || null,
              enrichmentStatus: enrichmentResult.enrichmentStatus,
              proposedMediaId: result.mediaId || null,
              confidenceScore,
              lookupPath: enrichmentResult.lookupPath || 'none',
              lookupStatus: enrichmentResult.lookupStatus || 'none',
              identifiers: rowIdentifiers,
              collectionId,
              classificationDetail,
              auditOutcome
            });
            summary.diagnosticsFlagged += 1;
          }
          if (result.mediaId) {
            await upsertMediaMetadataEntry(result.mediaId, 'amazon_item_id', normalizedRow.amazonItemId);
            await upsertMediaMetadataEntry(result.mediaId, 'ean', normalizedRow.ean);
            await upsertMediaMetadataEntry(result.mediaId, 'ean_upc', normalizedRow.ean);
            await upsertMediaMetadataEntry(result.mediaId, 'isbn', normalizedRow.isbn);
            await upsertMediaMetadataEntry(result.mediaId, 'source_creator', normalizedRow.creator);
            await upsertMediaMetadataEntry(result.mediaId, 'source_edition', normalizedRow.edition);
            await upsertMediaMetadataEntry(result.mediaId, 'source_format', normalizedRow.formatRaw);
            await upsertMediaMetadataEntry(result.mediaId, 'normalized_platform', normalizedRow.normalizedPlatform);
            if (collectionId) {
              const itemId = await addCollectionItem({
                collectionId,
                mediaId: result.mediaId,
                containedTitle: title,
                sourcePayload: { source: 'import_upsert' }
              });
              if (itemId) summary.collectionItemsSeeded += 1;
            }
          }
          if (result.type === 'created') {
            summary.created += 1;
            if (result.mediaId) createdMediaIds.push(result.mediaId);
            incrementImportAuditOutcomeCounter(summary.auditOutcomes, auditOutcome);
            auditRows.push({
              row: idx + 2,
              media_type: mapped.media_type || '',
              title,
              status: 'created',
              detail: '',
              match_mode: result.matchMode || null,
              matched_by: result.matchedBy || null,
              enrichment_status: enrichmentResult.enrichmentStatus,
              lookup_path: enrichmentResult.lookupPath || 'none',
              lookup_status: enrichmentResult.lookupStatus || 'none',
              audit_outcome: auditOutcome,
              classification_detail: classificationDetail,
              confidence_score: confidenceScore,
              diagnostic_flagged: diagnosticFlagged,
              normalization_review_candidates: result.normalizationReviewCandidates || [],
              normalization_review_candidate_count: Array.isArray(result.normalizationReviewCandidates) ? result.normalizationReviewCandidates.length : 0,
              isbn: rowIdentifiers.isbn || '',
              ean_upc: rowIdentifiers.eanUpc || '',
              asin: rowIdentifiers.asin || ''
            });
          } else if (result.type === 'updated') {
            summary.updated += 1;
            incrementImportAuditOutcomeCounter(summary.auditOutcomes, auditOutcome);
            auditRows.push({
              row: idx + 2,
              media_type: mapped.media_type || '',
              title,
              status: 'updated',
              detail: '',
              match_mode: result.matchMode || null,
              matched_by: result.matchedBy || null,
              enrichment_status: enrichmentResult.enrichmentStatus,
              lookup_path: enrichmentResult.lookupPath || 'none',
              lookup_status: enrichmentResult.lookupStatus || 'none',
              audit_outcome: auditOutcome,
              classification_detail: classificationDetail,
              confidence_score: confidenceScore,
              diagnostic_flagged: diagnosticFlagged,
              normalization_review_candidates: result.normalizationReviewCandidates || [],
              normalization_review_candidate_count: Array.isArray(result.normalizationReviewCandidates) ? result.normalizationReviewCandidates.length : 0,
              isbn: rowIdentifiers.isbn || '',
              ean_upc: rowIdentifiers.eanUpc || '',
              asin: rowIdentifiers.asin || ''
            });
          } else {
            summary.skipped_invalid += 1;
            incrementImportAuditOutcomeCounter(summary.auditOutcomes, 'skipped_invalid');
            auditRows.push({
              row: idx + 2,
              media_type: mapped.media_type || '',
              title,
              status: 'skipped_invalid',
              detail: result.detail || 'Invalid row',
              match_mode: result.matchMode || null,
              matched_by: result.matchedBy || null,
              enrichment_status: enrichmentResult.enrichmentStatus,
              lookup_path: enrichmentResult.lookupPath || 'none',
              lookup_status: enrichmentResult.lookupStatus || 'none',
              audit_outcome: 'skipped_invalid',
              classification_detail: classificationDetail,
              confidence_score: confidenceScore,
              diagnostic_flagged: diagnosticFlagged,
              normalization_review_candidates: result.normalizationReviewCandidates || [],
              normalization_review_candidate_count: Array.isArray(result.normalizationReviewCandidates) ? result.normalizationReviewCandidates.length : 0,
              isbn: rowIdentifiers.isbn || '',
              ean_upc: rowIdentifiers.eanUpc || '',
              asin: rowIdentifiers.asin || ''
            });
          }
        } catch (error) {
          summary.errors.push({ row: idx + 2, detail: error.message });
          incrementImportAuditOutcomeCounter(summary.auditOutcomes, 'error');
          auditRows.push({
            row: idx + 2,
            media_type: mapped.media_type || '',
            title,
            status: 'error',
            detail: error.message,
            enrichment_status: 'not_attempted',
            lookup_path: 'none',
            lookup_status: 'none',
            audit_outcome: 'error',
            classification_detail: deriveImportAuditClassificationDetail({
              upsertStatus: 'error',
              matchMode: null,
              matchedBy: null,
              enrichmentStatus: 'not_attempted',
              lookupPath: 'none',
              mediaType: mapped.media_type || 'movie',
              importSource: 'csv_delicious'
            })
          });
        }
      }
    }

    const processed = idx + 1;
    if (processed === rows.length || processed % CSV_JOB_PROGRESS_BATCH_SIZE === 0) {
      await updateProgress({
        total: rows.length,
        processed,
        created: summary.created,
        updated: summary.updated,
        skipped: summary.skipped_invalid + summary.skipped_non_movie + summary.skipped_collection,
        errorCount: summary.errors.length
      });
    }
  }

  return { rows: rows.length, summary, auditRows, createdMediaIds };
}

// All routes require auth
router.use(authenticateToken);
router.use(enforceScopeAccess({ allowedHintRoles: ['admin'] }));

router.get('/feature-flags', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventsEnabled = await isFeatureEnabledForSpace(scopeContext?.spaceId || null, 'events_enabled', false);
  const collectiblesEnabled = await isFeatureEnabledForSpace(scopeContext?.spaceId || null, 'collectibles_enabled', false);
  res.json({
    flags: {
      events_enabled: Boolean(eventsEnabled),
      collectibles_enabled: Boolean(collectiblesEnabled)
    }
  });
}));

// ── List / search ─────────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const {
    format, search, page, limit,
    sortBy, sortDir,
    media_type,
    director, genre, cast, resolution, platform, publisher,
    yearMin, yearMax,
    ratingMin, ratingMax,
    userRatingMin, userRatingMax
  } = req.query;
  const pageNum = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1;
  const mediaTypeFilter = String(media_type || '').toLowerCase();
  const maxLimit = mediaTypeFilter === 'comic_book' ? 5000 : 200;
  const limitNum = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(maxLimit, Number(limit))) : 50;
  const offset = (pageNum - 1) * limitNum;
  let where = 'WHERE 1=1';
  const params = [];
  const safeSortBy = SORT_COLUMNS[String(sortBy || '').toLowerCase()] || 'title';
  const safeSortDir = String(sortDir || '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const normalizedSearch = typeof search === 'string' ? search.trim() : '';
  const comicSeriesSortExpr = `
    lower(
      coalesce(
        nullif(trim(coalesce(type_details->>'series', '')), ''),
        nullif(trim(regexp_replace(coalesce(title, ''), '\\s+#\\s*[A-Za-z0-9.-]+.*$', '', '')), ''),
        coalesce(title, '')
      )
    )
  `;
  const comicIssueRawExpr = `
    nullif(
      trim(
        coalesce(
          nullif(trim(coalesce(type_details->>'issue_number', '')), ''),
          substring(coalesce(title, '') from '#\\s*([A-Za-z0-9.-]+)')
        )
      ),
      ''
    )
  `;
  const comicIssueNumericExpr = `
    CASE
      WHEN ${comicIssueRawExpr} ~ '^\\d+(?:\\.\\d+)?' THEN regexp_replace(${comicIssueRawExpr}, '^(\\d+(?:\\.\\d+)?).*$' , '\\1')::numeric
      ELSE NULL
    END
  `;
  const comicIssueSuffixExpr = `
    lower(
      trim(
        regexp_replace(
          coalesce(${comicIssueRawExpr}, ''),
          '^\\d+(?:\\.\\d+)?',
          ''
        )
      )
    )
  `;
  const comicVolumeExpr = `
    CASE
      WHEN nullif(trim(coalesce(type_details->>'volume', '')), '') ~ '^\\d+$'
        THEN (type_details->>'volume')::int
      ELSE NULL
    END
  `;
  const sortExpression = safeSortBy === 'comic_issue'
    ? `${comicSeriesSortExpr} ${safeSortDir},
       ${comicVolumeExpr} ${safeSortDir} NULLS LAST,
       CASE
         WHEN ${comicIssueRawExpr} IS NULL THEN 2
         WHEN ${comicIssueRawExpr} ~ '^\\d+(?:\\.\\d+)?' THEN 0
         ELSE 1
       END ${safeSortDir},
       ${comicIssueNumericExpr} ${safeSortDir} NULLS LAST,
       ${comicIssueSuffixExpr} ${safeSortDir},
       lower(title) ${safeSortDir}`
    : safeSortBy === 'title'
      ? `regexp_replace(lower(coalesce(title, '')), '^(the|an|a)\\s+', '', 'i') ${safeSortDir}, lower(title) ${safeSortDir}`
      : `${safeSortBy} ${safeSortDir} NULLS LAST, lower(title) ASC`;

  const normalizedFormatFilter = normalizeOwnedFormatFilterValue(format);
  if (format && format !== 'all' && (normalizedFormatFilter || ALL_DISPLAY_FORMAT_LABELS.includes(format))) {
    params.push(normalizedFormatFilter || normalizeOwnedFormatFilterValue(normalizeMediaFormat(format)));
    where += ` AND owned_formats @> ARRAY[$${params.length}]::text[]`;
  }

  if (media_type === 'tv') {
    where += ` AND media_type IN ('tv_series', 'tv_episode')`;
  } else if (media_type && media_type !== 'all' && MEDIA_TYPES.includes(String(media_type))) {
    params.push(media_type);
    where += ` AND media_type = $${params.length}`;
  }

  if (normalizedSearch) {
    params.push(normalizedSearch);
    const tsqIdx = params.length;
    params.push(`%${normalizedSearch}%`);
    const likeIdx = params.length;
    where += ` AND (
      to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(original_title,'') || ' ' || coalesce(notes,'')) @@ plainto_tsquery('simple', $${tsqIdx})
      OR title ILIKE $${likeIdx}
      OR original_title ILIKE $${likeIdx}
      OR EXISTS (
        SELECT 1
        FROM media_directors md
        JOIN directors d ON d.id = md.director_id
        WHERE md.media_id = media.id
          AND d.name ILIKE $${likeIdx}
      )
      OR EXISTS (
        SELECT 1
        FROM media_genres mg
        JOIN genres g ON g.id = mg.genre_id
        WHERE mg.media_id = media.id
          AND g.name ILIKE $${likeIdx}
      )
      OR EXISTS (
        SELECT 1
        FROM media_actors ma
        JOIN actors a ON a.id = ma.actor_id
        WHERE ma.media_id = media.id
          AND a.name ILIKE $${likeIdx}
      )
      OR notes ILIKE $${likeIdx}
      OR COALESCE(type_details->>'series', '') ILIKE $${likeIdx}
      OR COALESCE(type_details->>'writer', '') ILIKE $${likeIdx}
      OR COALESCE(type_details->>'artist', '') ILIKE $${likeIdx}
    )`;
  }

  if (director) {
    params.push(`%${director}%`);
    where += ` AND EXISTS (
      SELECT 1
      FROM media_directors md
      JOIN directors d ON d.id = md.director_id
      WHERE md.media_id = media.id
        AND d.name ILIKE $${params.length}
    )`;
  }

  if (genre) {
    params.push(`%${genre}%`);
    where += ` AND EXISTS (
      SELECT 1
      FROM media_genres mg
      JOIN genres g ON g.id = mg.genre_id
      WHERE mg.media_id = media.id
        AND g.name ILIKE $${params.length}
    )`;
  }

  if (cast) {
    params.push(`%${cast}%`);
    where += ` AND EXISTS (
      SELECT 1
      FROM media_actors ma
      JOIN actors a ON a.id = ma.actor_id
      WHERE ma.media_id = media.id
        AND a.name ILIKE $${params.length}
    )`;
  }

  if (Number.isFinite(Number(yearMin))) {
    params.push(Number(yearMin));
    where += ` AND year >= $${params.length}`;
  }

  if (Number.isFinite(Number(yearMax))) {
    params.push(Number(yearMax));
    where += ` AND year <= $${params.length}`;
  }

  if (Number.isFinite(Number(ratingMin))) {
    params.push(Number(ratingMin));
    where += ` AND rating >= $${params.length}`;
  }

  if (Number.isFinite(Number(ratingMax))) {
    params.push(Number(ratingMax));
    where += ` AND rating <= $${params.length}`;
  }

  if (Number.isFinite(Number(userRatingMin))) {
    params.push(Number(userRatingMin));
    where += ` AND user_rating >= $${params.length}`;
  }

  if (Number.isFinite(Number(userRatingMax))) {
    params.push(Number(userRatingMax));
    where += ` AND user_rating <= $${params.length}`;
  }

  const normalizedResolution = normalizeResolution(resolution);
  if (normalizedResolution) {
    params.push(normalizedResolution);
    const idx = params.length;
    where += ` AND EXISTS (
      SELECT 1
      FROM media_variants mv
      WHERE mv.media_id = media.id
        AND (
          ($${idx} = '4k' AND (
            mv.video_height >= 2000
            OR mv.resolution ILIKE '%4k%'
            OR mv.resolution ILIKE '%2160%'
            OR mv.resolution ILIKE '%uhd%'
          ))
          OR ($${idx} = '1080' AND (
            (mv.video_height >= 1000 AND mv.video_height < 2000)
            OR mv.resolution ILIKE '%1080%'
          ))
          OR ($${idx} = '720' AND (
            (mv.video_height >= 700 AND mv.video_height < 1000)
            OR mv.resolution ILIKE '%720%'
          ))
          OR ($${idx} = 'sd' AND (
            (mv.video_height > 0 AND mv.video_height < 700)
            OR mv.resolution ILIKE '%sd%'
            OR mv.resolution ILIKE '%480%'
            OR mv.resolution ILIKE '%576%'
          ))
        )
    )`;
  }

  const normalizedPlatform = String(platform || '').trim();
  if (normalizedPlatform && normalizedPlatform.toLowerCase() !== 'all') {
    params.push(`%${normalizedPlatform}%`);
    where += ` AND COALESCE(type_details->>'platform', '') ILIKE $${params.length}`;
  }

  const normalizedPublisher = String(publisher || '').trim();
  if (normalizedPublisher && normalizedPublisher.toLowerCase() !== 'all') {
    params.push(`%${normalizedPublisher}%`);
    where += ` AND COALESCE(type_details->>'publisher', '') ILIKE $${params.length}`;
  }

  where += appendScopeSql(params, scopeContext);

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM media ${where}`,
    params
  );
  const total = countResult.rows[0]?.total || 0;

  params.push(limitNum);
  params.push(offset);
  const result = await pool.query(
    `SELECT media.*,
            COALESCE(season_stats.season_count, 0) AS tv_season_count,
            COALESCE(season_stats.completed_count, 0) AS tv_completed_season_count,
            CASE
              WHEN media.media_type = 'tv_series'
               AND COALESCE(season_stats.season_count, 0) > 0
               AND COALESCE(season_stats.season_count, 0) = COALESCE(season_stats.completed_count, 0)
                THEN TRUE
              ELSE FALSE
            END AS tv_all_seasons_completed
     FROM media
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS season_count,
              COUNT(*) FILTER (WHERE ms.is_complete = TRUE OR ms.watch_state = 'completed')::int AS completed_count
       FROM media_seasons ms
       WHERE ms.media_id = media.id
     ) season_stats ON TRUE
     ${where}
     ORDER BY ${sortExpression}
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );
  const normalizedItems = result.rows.map((row) => normalizeMediaRecord(row));
  const totalPages = total > 0 ? Math.ceil(total / limitNum) : 1;
  res.json({
    items: normalizedItems,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
      hasMore: pageNum < totalPages
    }
  });
}));

router.get('/comic-series', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const {
    search,
    page,
    limit,
    publisher,
    sortDir
  } = req.query;

  const pageNum = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1;
  const limitNum = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Number(limit))) : 50;
  const offset = (pageNum - 1) * limitNum;
  const safeSortDir = String(sortDir || '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const normalizedSearch = typeof search === 'string' ? search.trim() : '';
  let where = `WHERE media.media_type = 'comic_book'`;
  const params = [];

  if (normalizedSearch) {
    params.push(normalizedSearch);
    const tsqIdx = params.length;
    params.push(`%${normalizedSearch}%`);
    const likeIdx = params.length;
    where += ` AND (
      to_tsvector('simple', coalesce(media.title,'') || ' ' || coalesce(media.original_title,'') || ' ' || coalesce(media.notes,'')) @@ plainto_tsquery('simple', $${tsqIdx})
      OR media.title ILIKE $${likeIdx}
      OR media.original_title ILIKE $${likeIdx}
      OR media.notes ILIKE $${likeIdx}
      OR COALESCE(media.type_details->>'series', '') ILIKE $${likeIdx}
      OR COALESCE(media.type_details->>'writer', '') ILIKE $${likeIdx}
      OR COALESCE(media.type_details->>'artist', '') ILIKE $${likeIdx}
    )`;
  }

  const normalizedPublisher = String(publisher || '').trim();
  if (normalizedPublisher && normalizedPublisher.toLowerCase() !== 'all') {
    params.push(`%${normalizedPublisher}%`);
    where += ` AND COALESCE(media.type_details->>'publisher', '') ILIKE $${params.length}`;
  }

  where += appendScopeSql(params, scopeContext);

  const countResult = await pool.query(
    `WITH filtered AS (
       SELECT lower(
         coalesce(
           nullif(trim(coalesce(media.type_details->>'series', '')), ''),
           nullif(trim(regexp_replace(coalesce(media.title, ''), '\\s+#\\s*[A-Za-z0-9.-]+.*$', '', '')), ''),
           coalesce(media.title, '')
         )
       ) AS series_sort_key
       FROM media
       ${where}
     )
     SELECT COUNT(DISTINCT series_sort_key)::int AS total FROM filtered`,
    params
  );
  const total = Number(countResult.rows[0]?.total || 0);

  params.push(limitNum);
  params.push(offset);
  const result = await pool.query(
    `WITH filtered AS (
       SELECT
         media.id,
         media.title,
         media.year,
         media.poster_path,
         lower(
           coalesce(
             nullif(trim(coalesce(media.type_details->>'series', '')), ''),
             nullif(trim(regexp_replace(coalesce(media.title, ''), '\\s+#\\s*[A-Za-z0-9.-]+.*$', '', '')), ''),
             coalesce(media.title, '')
           )
         ) AS series_sort_key,
         coalesce(
           nullif(trim(coalesce(media.type_details->>'series', '')), ''),
           nullif(trim(regexp_replace(coalesce(media.title, ''), '\\s+#\\s*[A-Za-z0-9.-]+.*$', '', '')), ''),
           coalesce(media.title, ''),
           'Unknown Series'
         ) AS series_name
       FROM media
       ${where}
     ),
     grouped AS (
       SELECT
         series_sort_key,
         MIN(series_name) AS name,
         COUNT(*)::int AS count,
         MIN(year) FILTER (WHERE year IS NOT NULL) AS year_min,
         MAX(year) FILTER (WHERE year IS NOT NULL) AS year_max
       FROM filtered
       GROUP BY series_sort_key
     )
     SELECT
       grouped.name,
       grouped.count,
       grouped.year_min,
       grouped.year_max,
       (
         SELECT f.poster_path
         FROM filtered f
         WHERE f.series_sort_key = grouped.series_sort_key
           AND f.poster_path IS NOT NULL
         ORDER BY f.year DESC NULLS LAST, f.id DESC
         LIMIT 1
       ) AS poster_path
     FROM grouped
     ORDER BY grouped.series_sort_key ${safeSortDir}
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );

  const totalPages = total > 0 ? Math.ceil(total / limitNum) : 1;
  res.json({
    items: result.rows.map((row) => ({
      name: row.name,
      count: Number(row.count || 0),
      yearMin: row.year_min === null ? null : Number(row.year_min),
      yearMax: row.year_max === null ? null : Number(row.year_max),
      poster_path: row.poster_path || null
    })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
      hasMore: pageNum < totalPages
    }
  });
}));

router.get('/comic-series/issues', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const {
    series,
    search,
    page,
    limit,
    publisher,
    sortDir
  } = req.query;

  const normalizedSeries = String(series || '').trim();
  if (!normalizedSeries) {
    return res.status(400).json({ error: 'series is required' });
  }

  const pageNum = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1;
  const limitNum = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Number(limit))) : 50;
  const offset = (pageNum - 1) * limitNum;
  const safeSortDir = String(sortDir || '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const normalizedSearch = typeof search === 'string' ? search.trim() : '';
  const params = [];
  let where = `WHERE media.media_type = 'comic_book'`;

  const comicSeriesSortExpr = `
    lower(
      coalesce(
        nullif(trim(coalesce(media.type_details->>'series', '')), ''),
        nullif(trim(regexp_replace(coalesce(media.title, ''), '\\s+#\\s*[A-Za-z0-9.-]+.*$', '', '')), ''),
        coalesce(media.title, '')
      )
    )
  `;
  const comicIssueRawExpr = `
    nullif(
      trim(
        coalesce(
          nullif(trim(coalesce(media.type_details->>'issue_number', '')), ''),
          substring(coalesce(media.title, '') from '#\\s*([A-Za-z0-9.-]+)')
        )
      ),
      ''
    )
  `;
  const comicIssueNumericExpr = `
    CASE
      WHEN ${comicIssueRawExpr} ~ '^\\d+(?:\\.\\d+)?' THEN regexp_replace(${comicIssueRawExpr}, '^(\\d+(?:\\.\\d+)?).*$' , '\\1')::numeric
      ELSE NULL
    END
  `;
  const comicIssueSuffixExpr = `
    lower(
      trim(
        regexp_replace(
          coalesce(${comicIssueRawExpr}, ''),
          '^\\d+(?:\\.\\d+)?',
          ''
        )
      )
    )
  `;
  const comicVolumeExpr = `
    CASE
      WHEN nullif(trim(coalesce(media.type_details->>'volume', '')), '') ~ '^\\d+$'
        THEN (media.type_details->>'volume')::int
      ELSE NULL
    END
  `;
  const targetSeriesExpr = `
    coalesce(
      nullif(trim(coalesce(media.type_details->>'series', '')), ''),
      nullif(trim(regexp_replace(coalesce(media.title, ''), '\\s+#\\s*[A-Za-z0-9.-]+.*$', '', '')), ''),
      coalesce(media.title, ''),
      'Unknown Series'
    )
  `;

  params.push(normalizedSeries);
  where += ` AND ${targetSeriesExpr} = $${params.length}`;

  if (normalizedSearch) {
    params.push(normalizedSearch);
    const tsqIdx = params.length;
    params.push(`%${normalizedSearch}%`);
    const likeIdx = params.length;
    where += ` AND (
      to_tsvector('simple', coalesce(media.title,'') || ' ' || coalesce(media.original_title,'') || ' ' || coalesce(media.notes,'')) @@ plainto_tsquery('simple', $${tsqIdx})
      OR media.title ILIKE $${likeIdx}
      OR media.original_title ILIKE $${likeIdx}
      OR media.notes ILIKE $${likeIdx}
      OR COALESCE(media.type_details->>'series', '') ILIKE $${likeIdx}
      OR COALESCE(media.type_details->>'writer', '') ILIKE $${likeIdx}
      OR COALESCE(media.type_details->>'artist', '') ILIKE $${likeIdx}
    )`;
  }

  const normalizedPublisher = String(publisher || '').trim();
  if (normalizedPublisher && normalizedPublisher.toLowerCase() !== 'all') {
    params.push(`%${normalizedPublisher}%`);
    where += ` AND COALESCE(media.type_details->>'publisher', '') ILIKE $${params.length}`;
  }

  where += appendScopeSql(params, scopeContext);

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM media ${where}`,
    params
  );
  const total = Number(countResult.rows[0]?.total || 0);

  params.push(limitNum);
  params.push(offset);
  const result = await pool.query(
    `SELECT media.*,
            COALESCE(season_stats.season_count, 0) AS tv_season_count,
            COALESCE(season_stats.completed_count, 0) AS tv_completed_season_count,
            CASE
              WHEN media.media_type = 'tv_series'
               AND COALESCE(season_stats.season_count, 0) > 0
               AND COALESCE(season_stats.season_count, 0) = COALESCE(season_stats.completed_count, 0)
                THEN TRUE
              ELSE FALSE
            END AS tv_all_seasons_completed
     FROM media
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS season_count,
              COUNT(*) FILTER (WHERE ms.is_complete = TRUE OR ms.watch_state = 'completed')::int AS completed_count
       FROM media_seasons ms
       WHERE ms.media_id = media.id
     ) season_stats ON TRUE
     ${where}
     ORDER BY ${comicSeriesSortExpr} ${safeSortDir},
              ${comicVolumeExpr} ${safeSortDir} NULLS LAST,
              CASE
                WHEN ${comicIssueRawExpr} IS NULL THEN 2
                WHEN ${comicIssueRawExpr} ~ '^\\d+(?:\\.\\d+)?' THEN 0
                ELSE 1
              END ${safeSortDir},
              ${comicIssueNumericExpr} ${safeSortDir} NULLS LAST,
              ${comicIssueSuffixExpr} ${safeSortDir},
              lower(media.title) ${safeSortDir}
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );

  const normalizedItems = result.rows.map((row) => normalizeMediaRecord(row));
  const totalPages = total > 0 ? Math.ceil(total / limitNum) : 1;
  res.json({
    items: normalizedItems,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
      hasMore: pageNum < totalPages
    }
  });
}));

router.get('/:id', asyncHandler(async (req, res, next) => {
  const scopeContext = resolveScopeContext(req);
  if (!/^\d+$/.test(String(req.params.id || ''))) {
    return next();
  }
  const mediaId = Number(req.params.id);
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return res.status(400).json({ error: 'Invalid media id' });
  }
  const media = await loadScopedMediaItem(mediaId, scopeContext);
  if (!media) {
    return res.status(404).json({ error: 'Media item not found' });
  }
  res.json(media);
}));

router.get('/:id/merge-details', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return res.status(400).json({ error: 'Invalid media id' });
  }
  const details = await loadScopedMergeDetails(mediaId, scopeContext);
  if (!details) {
    return res.status(404).json({ error: 'Media item not found' });
  }
  res.json(details);
}));

router.get('/merge-recommendations', requireSessionAuth, requireRole('admin', 'support_admin'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const limit = Math.max(1, Math.min(50, Number(req.query?.limit || 12) || 12));
  const mediaType = normalizeMergeReviewMediaTypeFilter(req.query?.media_type);
  const recommendations = await loadScopedManualMergeRecommendations({
    scopeContext,
    limit,
    mediaType
  });
  res.json(recommendations);
}));

router.get('/discovery-candidates', requireSessionAuth, requireRole('admin', 'support_admin'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const limit = Math.max(1, Math.min(50, Number(req.query?.limit || 12) || 12));
  const search = String(req.query?.search || '').trim();
  const mediaId = Number(req.query?.media_id || 0) || null;
  const mediaType = normalizeMergeReviewMediaTypeFilter(req.query?.media_type);
  const discovery = await loadScopedDuplicateDiscoveryCandidates({
    scopeContext,
    limit,
    search,
    mediaId,
    mediaType
  });
  res.json(discovery);
}));

router.get('/comics/duplicate-candidates', requireSessionAuth, requireRole('admin', 'support_admin'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const limit = Math.max(1, Math.min(50, Number(req.query?.limit || 12) || 12));
  const search = String(req.query?.search || '').trim();
  const mediaType = normalizeMergeReviewMediaTypeFilter(req.query?.media_type);
  const candidates = await loadScopedComicDuplicateCandidates({
    scopeContext,
    limit,
    search,
    mediaType
  });
  res.json(candidates);
}));

router.get('/collections/duplicates', requireSessionAuth, requireRole('admin', 'support_admin'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const limit = Math.max(1, Math.min(50, Number(req.query?.limit || 12) || 12));
  const search = String(req.query?.search || '').trim();
  const mediaType = normalizeMergeReviewMediaTypeFilter(req.query?.media_type);
  const duplicates = await loadScopedCollectionDuplicateGroups({
    scopeContext,
    limit,
    search,
    mediaType
  });
  res.json(duplicates);
}));

router.get('/collections/duplicate-preview', requireSessionAuth, requireRole('admin', 'support_admin'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const leftCollectionId = Number(req.query?.left_id || 0);
  const rightCollectionId = Number(req.query?.right_id || 0);
  if (!leftCollectionId || !rightCollectionId || leftCollectionId === rightCollectionId) {
    return res.status(400).json({ error: 'left_id and right_id must be different positive integers' });
  }
  const preview = await loadScopedCollectionDuplicatePreview({
    leftCollectionId,
    rightCollectionId,
    scopeContext
  });
  if (!preview) {
    return res.status(404).json({ error: 'One or both collections were not found in the active scope' });
  }
  if (!preview.allowed) {
    return res.status(409).json({
      error: 'Cross-type collection previews are not allowed',
      details: preview.details,
      left: preview.left,
      right: preview.right
    });
  }
  res.json(preview);
}));

router.get('/collections/:id/merge-details', requireSessionAuth, requireRole('admin', 'support_admin'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const collectionId = Number(req.params.id || 0);
  if (!collectionId) {
    return res.status(400).json({ error: 'Invalid collection id' });
  }
  const details = await loadScopedCollectionMergeDetails(collectionId, scopeContext);
  if (!details) {
    return res.status(404).json({ error: 'Collection not found in the active scope' });
  }
  res.json(details);
}));

router.get('/loans', requireSessionAuth, asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const page = Math.max(1, Number(req.query?.page || 1) || 1);
  const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 25) || 25));
  const offset = (page - 1) * limit;
  const status = ['active', 'overdue', 'returned', 'all'].includes(String(req.query?.status || '').trim().toLowerCase())
    ? String(req.query.status || '').trim().toLowerCase()
    : 'active';
  const search = String(req.query?.search || '').trim();

  const params = [];
  let where = ' WHERE 1=1';
  where += appendScopeSql(params, scopeContext, {
    spaceColumn: 'ml.space_id',
    libraryColumn: 'ml.library_id'
  });
  if (status === 'active') {
    where += ` AND ml.returned_at IS NULL AND ml.due_at >= CURRENT_DATE`;
  } else if (status === 'overdue') {
    where += ` AND ml.returned_at IS NULL AND ml.due_at < CURRENT_DATE`;
  } else if (status === 'returned') {
    where += ` AND ml.returned_at IS NOT NULL`;
  }
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where += ` AND (
      lower(m.title) LIKE $${params.length}
      OR lower(COALESCE(ml.borrower_name, '')) LIKE $${params.length}
      OR lower(COALESCE(ml.borrower_email, '')) LIKE $${params.length}
    )`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM media_loans ml
       JOIN media m ON m.id = ml.media_id
      ${where}`,
    params
  );
  const total = Number(countResult.rows[0]?.total || 0);
  const dueSoonResult = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM media_loans ml
       JOIN media m ON m.id = ml.media_id
      ${where}
        AND ml.returned_at IS NULL
        AND ml.due_at >= CURRENT_DATE
        AND ml.due_at <= (CURRENT_DATE + INTERVAL '3 days')`,
    params
  );
  const dueSoonTotal = Number(dueSoonResult.rows[0]?.total || 0);

  const rowParams = [...params, limit, offset];
  const rows = await pool.query(
    `SELECT ml.*,
            m.title AS media_title,
            m.media_type,
            m.poster_path,
            m.year
       FROM media_loans ml
       JOIN media m ON m.id = ml.media_id
      ${where}
      ORDER BY
        CASE WHEN ml.returned_at IS NULL THEN 0 ELSE 1 END ASC,
        CASE WHEN ml.returned_at IS NULL THEN ml.due_at END ASC NULLS LAST,
        COALESCE(ml.returned_at, ml.created_at) DESC,
        ml.id DESC
      LIMIT $${rowParams.length - 1}
      OFFSET $${rowParams.length}`,
    rowParams
  );

  res.json({
    items: rows.rows.map(formatMediaLoanRow),
    summary: {
      dueSoon: dueSoonTotal
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: offset + rows.rows.length < total
    }
  });
}));

router.get('/:id/loans', requireSessionAuth, asyncHandler(async (req, res, next) => {
  const scopeContext = resolveScopeContext(req);
  if (!/^\d+$/.test(String(req.params.id || ''))) {
    return next();
  }
  const mediaId = Number(req.params.id || 0);
  if (!mediaId) {
    return res.status(400).json({ error: 'Invalid media id' });
  }
  const media = await loadScopedMediaItem(mediaId, scopeContext);
  if (!media) {
    return res.status(404).json({ error: 'Media item not found' });
  }
  const params = [mediaId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'ml.space_id',
    libraryColumn: 'ml.library_id'
  });
  const result = await pool.query(
    `SELECT ml.*,
            m.title AS media_title,
            m.media_type,
            m.poster_path,
            m.year
       FROM media_loans ml
       JOIN media m ON m.id = ml.media_id
      WHERE ml.media_id = $1${scopeClause}
      ORDER BY
        CASE WHEN ml.returned_at IS NULL THEN 0 ELSE 1 END ASC,
        COALESCE(ml.returned_at, ml.due_at, ml.created_at) DESC,
        ml.id DESC`,
    params
  );
  const items = result.rows.map(formatMediaLoanRow);
  const reminderEventsByLoanId = await loadLoanReminderEventsByLoanIds(items.map((entry) => entry.id), scopeContext);
  const itemsWithReminderEvents = items.map((entry) => ({
    ...entry,
    reminder_events: reminderEventsByLoanId.get(Number(entry.id || 0)) || []
  }));
  res.json({
    media: {
      id: media.id,
      title: media.title,
      media_type: media.media_type,
      poster_path: media.poster_path,
      year: media.year
    },
    active_loan: itemsWithReminderEvents.find((entry) => !entry.returned_at) || null,
    history: itemsWithReminderEvents
  });
}));

router.post('/:id/loans', requireSessionAuth, validate(mediaLoanCreateSchema), asyncHandler(async (req, res, next) => {
  const scopeContext = resolveScopeContext(req);
  if (!/^\d+$/.test(String(req.params.id || ''))) {
    return next();
  }
  const mediaId = Number(req.params.id || 0);
  if (!mediaId) {
    return res.status(400).json({ error: 'Invalid media id' });
  }
  const media = await loadScopedMediaItem(mediaId, scopeContext);
  if (!media) {
    return res.status(404).json({ error: 'Media item not found' });
  }
  const existingActiveParams = [mediaId];
  const existingActiveScopeClause = appendScopeSql(existingActiveParams, scopeContext, {
    spaceColumn: 'space_id',
    libraryColumn: 'library_id'
  });
  const existingActive = await pool.query(
    `SELECT id
       FROM media_loans
      WHERE media_id = $1
        AND returned_at IS NULL${existingActiveScopeClause}
      LIMIT 1`,
    existingActiveParams
  );
  if (existingActive.rows[0]) {
    return res.status(409).json({ error: 'This item already has an active loan' });
  }

  const payload = buildOwnedFormatsPayload(media.media_type || 'movie', media.owned_formats, media.format);
  const defaultLoanFormat = media.format || (payload.ownedFormats[0] ? getOwnedFormatLabel(media.media_type || 'movie', payload.ownedFormats[0]) : null);
  const result = await pool.query(
    `INSERT INTO media_loans (
       media_id, library_id, space_id, borrower_name, borrower_email, loaned_at, due_at, loan_format, notes, created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
     )
     RETURNING *`,
    [
      media.id,
      media.library_id || scopeContext.libraryId || null,
      media.space_id || scopeContext.spaceId || null,
      req.body.borrower_name,
      req.body.borrower_email || null,
      req.body.loaned_at,
      req.body.due_at,
      req.body.loan_format || defaultLoanFormat || null,
      req.body.notes || null,
      req.user.id
    ]
  );
  const loan = await loadScopedMediaLoan(result.rows[0].id, scopeContext);
  await logActivity(req, 'media.loan.create', 'media_loan', loan.id, {
    mediaId: media.id,
    title: media.title || null,
    borrowerName: loan.borrower_name || null,
    dueAt: loan.due_at || null,
    libraryId: media.library_id || null,
    spaceId: media.space_id || scopeContext.spaceId || null
  });
  res.status(201).json(loan);
}));

router.patch('/loans/:loanId', requireSessionAuth, validate(mediaLoanUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const loanId = Number(req.params.loanId || 0);
  if (!loanId) {
    return res.status(400).json({ error: 'Invalid loan id' });
  }
  const existing = await loadScopedMediaLoan(loanId, scopeContext);
  if (!existing) {
    return res.status(404).json({ error: 'Loan not found' });
  }
  if (existing.returned_at) {
    return res.status(409).json({ error: 'Returned loans cannot be edited' });
  }
  const nextLoanedAt = req.body.loaned_at || existing.loaned_at;
  const nextDueAt = req.body.due_at || existing.due_at;
  if (nextLoanedAt && nextDueAt && nextDueAt < nextLoanedAt) {
    return res.status(400).json({ error: 'due_at must be on or after loaned_at' });
  }
  const fields = Object.fromEntries(
    Object.entries(req.body).filter(([, value]) => value !== undefined)
  );
  const keys = Object.keys(fields);
  if (keys.length === 0) {
    return res.status(400).json({ error: 'No valid fields provided for update' });
  }
  const values = keys.map((key) => fields[key]);
  const params = [...values, loanId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'space_id',
    libraryColumn: 'library_id'
  });
  const setClause = keys.map((key, index) => `${key} = $${index + 1}`).join(', ');
  await pool.query(
    `UPDATE media_loans
        SET ${setClause},
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $${keys.length + 1}${scopeClause}`,
    params
  );
  const updated = await loadScopedMediaLoan(loanId, scopeContext);
  await logActivity(req, 'media.loan.update', 'media_loan', updated.id, {
    mediaId: updated.media_id || null,
    borrowerName: updated.borrower_name || null,
    dueAt: updated.due_at || null,
    fields: keys
  });
  res.json(updated);
}));

router.patch('/loans/:loanId/return', requireSessionAuth, validate(mediaLoanReturnSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const loanId = Number(req.params.loanId || 0);
  if (!loanId) {
    return res.status(400).json({ error: 'Invalid loan id' });
  }
  const existing = await loadScopedMediaLoan(loanId, scopeContext);
  if (!existing) {
    return res.status(404).json({ error: 'Loan not found' });
  }
  if (existing.returned_at) {
    return res.status(409).json({ error: 'Loan is already returned' });
  }
  const returnedAt = req.body.returned_at || new Date().toISOString().slice(0, 10);
  const params = [returnedAt, loanId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'space_id',
    libraryColumn: 'library_id'
  });
  await pool.query(
    `UPDATE media_loans
        SET returned_at = $1,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $2${scopeClause}`,
    params
  );
  const updated = await loadScopedMediaLoan(loanId, scopeContext);
  await logActivity(req, 'media.loan.return', 'media_loan', updated.id, {
    mediaId: updated.media_id || null,
    borrowerName: updated.borrower_name || null,
    returnedAt: updated.returned_at || null
  });
  res.json(updated);
}));

router.post('/loans/:loanId/reminder', requireSessionAuth, validate(mediaLoanReminderSendSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const loanId = Number(req.params.loanId || 0);
  if (!loanId) {
    return res.status(400).json({ error: 'Invalid loan id' });
  }
  const existing = await loadScopedMediaLoan(loanId, scopeContext);
  if (!existing) {
    return res.status(404).json({ error: 'Loan not found' });
  }
  if (existing.returned_at) {
    return res.status(409).json({ error: 'Returned loans cannot receive reminders' });
  }
  if (!existing.borrower_email) {
    return res.status(409).json({ error: 'Add a borrower email before sending reminders' });
  }
  const reminderPhase = buildLoanReminderPhase(existing);
  if (!reminderPhase) {
    return res.status(409).json({ error: 'Reminders can only be sent for due-soon or overdue loans' });
  }
  if (wasLoanReminderSentToday(existing)) {
    return res.status(409).json({ error: 'A reminder has already been sent today for this loan' });
  }
  const reminderResult = await sendReminderForLoanRow(existing, reminderPhase, { source: 'manual', req });
  if (!reminderResult?.sent) {
    if (reminderResult?.reason === 'smtp_not_configured') {
      return res.status(503).json({ error: 'Email delivery is not configured for reminders' });
    }
    return res.status(502).json({ error: 'Failed to send reminder email' });
  }
  const updated = await loadScopedMediaLoan(loanId, scopeContext);
  res.json(updated);
}));

router.post('/loan-reminders/run-auto', requireSessionAuth, requireRole('admin', 'support_admin'), asyncHandler(async (_req, res) => {
  const summary = await runAutomaticLoanReminderSweep({
    reason: 'manual_trigger',
    logSummary: true
  });
  res.json(summary);
}));

router.post('/collections/merge-apply', requireSessionAuth, requireRole('admin', 'support_admin'), validate(collectionMergeApplySchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const canonicalCollectionId = Number(req.body?.canonical_id);
  const duplicateCollectionId = Number(req.body?.duplicate_id);
  const preview = await loadScopedCollectionDuplicatePreview({
    leftCollectionId: canonicalCollectionId,
    rightCollectionId: duplicateCollectionId,
    scopeContext
  });
  if (!preview) {
    return res.status(404).json({ error: 'One or both collections were not found in the active scope' });
  }
  if (!preview.allowed) {
    return res.status(409).json({
      error: 'Cross-type collection merges are not allowed',
      details: preview.details,
      canonical: preview.left,
      duplicate: preview.right
    });
  }

  const result = await runManualCollectionMergeApply({
    canonicalCollectionId,
    duplicateCollectionId,
    userId: req.user?.id || null,
    preview
  });
  const mergeDetails = await loadScopedCollectionMergeDetails(canonicalCollectionId, scopeContext);

  await logActivity(req, 'media.collection.merge_apply', 'collection', canonicalCollectionId, {
    canonical_collection_id: canonicalCollectionId,
    duplicate_collection_id: duplicateCollectionId,
    media_type: preview.preview?.media_type || null,
    moved_item_count: Number(result.moved_item_count || 0) || 0,
    skipped_item_count: Number(result.skipped_item_count || 0) || 0
  });

  res.json({
    applied: true,
    canonical: mergeDetails?.collection || preview.left,
    duplicate: preview.right,
    result,
    merge_details: mergeDetails
  });
}));

router.post('/collections/merge-revert', requireSessionAuth, requireRole('admin', 'support_admin'), validate(collectionMergeRevertSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const canonicalCollectionId = Number(req.body?.canonical_id);
  const duplicateCollectionId = Number(req.body?.duplicate_id);
  const beforeDetails = await loadScopedCollectionMergeDetails(canonicalCollectionId, scopeContext);
  if (!beforeDetails?.collection) {
    return res.status(404).json({ error: 'Canonical collection was not found in the active scope' });
  }
  const matchingEntry = Array.isArray(beforeDetails.entries)
    ? beforeDetails.entries.find((entry) => Number(entry?.duplicate_id || 0) === duplicateCollectionId)
    : null;
  if (!matchingEntry) {
    return res.status(404).json({ error: 'Active collection merge event was not found for the requested duplicate id' });
  }

  try {
    const result = await runManualCollectionMergeRevert({
      canonicalCollectionId,
      duplicateCollectionId
    });
    const mergeDetails = await loadScopedCollectionMergeDetails(canonicalCollectionId, scopeContext);
    const restoredCollections = await loadScopedCollectionsByIds([duplicateCollectionId], scopeContext);
    const restoredDuplicate = restoredCollections[0] || matchingEntry.duplicate || null;

    await logActivity(req, 'media.collection.merge_revert', 'collection', canonicalCollectionId, {
      canonical_collection_id: canonicalCollectionId,
      duplicate_collection_id: duplicateCollectionId,
      media_type: beforeDetails.collection?.media_type || null
    });

    res.json({
      reverted: true,
      canonical: mergeDetails?.collection || beforeDetails.collection,
      duplicate: restoredDuplicate,
      result,
      merge_details: mergeDetails
    });
  } catch (error) {
    if (Number(error?.statusCode || 0) === 409) {
      return res.status(409).json({ error: error.message });
    }
    throw error;
  }
}));

router.get('/merge-recommendations/history', requireSessionAuth, requireRole('admin', 'support_admin'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const limit = Math.max(1, Math.min(50, Number(req.query?.limit || 12) || 12));
  const search = String(req.query?.search || '').trim();
  const mediaType = normalizeMergeReviewMediaTypeFilter(req.query?.media_type);
  const outcome = normalizeRecommendationFeedbackOutcomeFilter(req.query?.outcome);
  const history = await loadScopedMergeRecommendationFeedbackHistory({
    scopeContext,
    limit,
    search,
    mediaType,
    outcome
  });
  res.json(history);
}));

router.post('/merge-recommendations/reject', requireSessionAuth, requireRole('admin', 'support_admin'), validate(mediaMergeRecommendationRejectSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const canonicalMediaId = Number(req.body?.canonical_id);
  const duplicateMediaId = Number(req.body?.duplicate_id);
  const reasonCode = MANUAL_MERGE_REJECTION_REASON_CODES.includes(String(req.body?.reason_code || '').trim())
    ? String(req.body.reason_code).trim()
    : null;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() || null : null;
  const preview = await loadScopedManualMergePreview({
    canonicalMediaId,
    duplicateMediaId,
    scopeContext
  });
  if (!preview) {
    return res.status(404).json({ error: 'One or both media items were not found in the active scope' });
  }
  if (!preview.allowed) {
    return res.status(409).json({
      error: 'Cross-type merges are not allowed',
      details: preview.details,
      canonical: preview.canonical,
      duplicate: preview.duplicate
    });
  }

  const feedback = await recordManualMergeRecommendationFeedback({
    canonicalMediaId,
    duplicateMediaId,
    outcome: 'rejected',
    scopeContext,
    userId: req.user?.id || null,
    reasonCode,
    reason,
    preview
  });
  await logActivity(req, 'media.merge_recommendation.reject', 'media', canonicalMediaId, {
    canonical_id: canonicalMediaId,
    duplicate_id: duplicateMediaId,
    pair_key: feedback.pair_key,
    reason_code: reasonCode,
    reason,
    media_type: preview.preview?.media_type || preview.canonical?.media_type || null
  });
  const recommendations = await loadScopedManualMergeRecommendations({
    scopeContext,
    limit: Math.max(1, Math.min(50, Number(req.query?.limit || 12) || 12))
  });
  res.json({
    rejected: true,
    feedback,
    canonical: preview.canonical,
    duplicate: preview.duplicate,
    recommendations
  });
}));

router.post('/merge-recommendations/defer', requireSessionAuth, requireRole('admin', 'support_admin'), validate(mediaMergeRecommendationDeferSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const canonicalMediaId = Number(req.body?.canonical_id);
  const duplicateMediaId = Number(req.body?.duplicate_id);
  const reasonCode = MANUAL_MERGE_REJECTION_REASON_CODES.includes(String(req.body?.reason_code || '').trim())
    ? String(req.body.reason_code).trim()
    : null;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() || null : null;
  const preview = await loadScopedManualMergePreview({
    canonicalMediaId,
    duplicateMediaId,
    scopeContext
  });
  if (!preview) {
    return res.status(404).json({ error: 'One or both media items were not found in the active scope' });
  }
  if (!preview.allowed) {
    return res.status(409).json({
      error: 'Cross-type merges are not allowed',
      details: preview.details,
      canonical: preview.canonical,
      duplicate: preview.duplicate
    });
  }

  const feedback = await recordManualMergeRecommendationFeedback({
    canonicalMediaId,
    duplicateMediaId,
    outcome: 'deferred',
    scopeContext,
    userId: req.user?.id || null,
    reasonCode,
    reason,
    preview
  });
  await logActivity(req, 'media.merge_recommendation.defer', 'media', canonicalMediaId, {
    canonical_id: canonicalMediaId,
    duplicate_id: duplicateMediaId,
    pair_key: feedback.pair_key,
    reason_code: reasonCode,
    reason,
    media_type: preview.preview?.media_type || preview.canonical?.media_type || null
  });
  const recommendations = await loadScopedManualMergeRecommendations({
    scopeContext,
    limit: Math.max(1, Math.min(50, Number(req.query?.limit || 12) || 12))
  });
  res.json({
    deferred: true,
    feedback,
    canonical: preview.canonical,
    duplicate: preview.duplicate,
    recommendations
  });
}));

router.post('/merge-recommendations/restore', requireSessionAuth, requireRole('admin', 'support_admin'), validate(mediaMergeRecommendationRestoreSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const restored = await restoreScopedMergeRecommendationFeedback({
    feedbackId: Number(req.body?.feedback_id || 0),
    scopeContext
  });
  if (!restored) {
    return res.status(404).json({ error: 'Suppressed pair entry was not found in the active scope' });
  }
  await logActivity(req, 'media.merge_recommendation.restore', 'media', restored.canonical_media_id, {
    canonical_id: restored.canonical_media_id,
    duplicate_id: restored.duplicate_media_id,
    pair_key: restored.pair_key,
    restored_outcome: restored.outcome,
    media_type: restored.media_type || null
  });
  const recommendations = await loadScopedManualMergeRecommendations({
    scopeContext,
    limit: Math.max(1, Math.min(50, Number(req.query?.limit || 12) || 12)),
    mediaType: normalizeMergeReviewMediaTypeFilter(req.query?.media_type)
  });
  const history = await loadScopedMergeRecommendationFeedbackHistory({
    scopeContext,
    limit: Math.max(1, Math.min(50, Number(req.query?.history_limit || 12) || 12)),
    search: String(req.query?.search || '').trim(),
    mediaType: normalizeMergeReviewMediaTypeFilter(req.query?.media_type),
    outcome: normalizeRecommendationFeedbackOutcomeFilter(req.query?.outcome)
  });
  res.json({
    restored: true,
    feedback: restored,
    recommendations,
    history
  });
}));

router.post('/merge-preview', requireSessionAuth, requireRole('admin', 'support_admin'), validate(mediaMergePreviewSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const canonicalMediaId = Number(req.body?.canonical_id);
  const duplicateMediaId = Number(req.body?.duplicate_id);
  const preview = await loadScopedManualMergePreview({
    canonicalMediaId,
    duplicateMediaId,
    scopeContext
  });
  if (!preview) {
    return res.status(404).json({ error: 'One or both media items were not found in the active scope' });
  }
  if (!preview.allowed) {
    return res.status(409).json({
      error: 'Cross-type merges are not allowed',
      details: preview.details,
      canonical: preview.canonical,
      duplicate: preview.duplicate
    });
  }
  res.json(preview);
}));

router.post('/merge-apply', requireSessionAuth, requireRole('admin', 'support_admin'), validate(mediaMergeApplySchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const canonicalMediaId = Number(req.body?.canonical_id);
  const duplicateMediaId = Number(req.body?.duplicate_id);
  const preview = await loadScopedManualMergePreview({
    canonicalMediaId,
    duplicateMediaId,
    scopeContext
  });
  if (!preview) {
    return res.status(404).json({ error: 'One or both media items were not found in the active scope' });
  }
  if (!preview.allowed) {
    return res.status(409).json({
      error: 'Cross-type merges are not allowed',
      details: preview.details,
      canonical: preview.canonical,
      duplicate: preview.duplicate
    });
  }

  const mergeEvidence = {
    ...(preview.preview?.evidence || {}),
    action: 'manual_merge',
    summary: String(preview.preview?.evidence?.summary || 'Manual merge').trim() || 'Manual merge',
    canonical_selection: {
      requested_canonical_id: canonicalMediaId,
      recommended_canonical_id: Number(preview.preview?.canonical_selection?.recommended_canonical_id || 0) || canonicalMediaId,
      requested_matches_recommended: Boolean(preview.preview?.canonical_selection?.requested_matches_recommended),
      selection_reason: String(preview.preview?.canonical_selection?.selection_reason || CANONICAL_SELECTION_REASON).trim() || CANONICAL_SELECTION_REASON
    }
  };

  const result = await runManualMediaMergeApply({
    canonicalId: canonicalMediaId,
    duplicateId: duplicateMediaId,
    mergeEvidence
  });
  const mergeDetails = await loadScopedMergeDetails(canonicalMediaId, scopeContext);
  const canonical = summarizeMergeSourceRow(await loadScopedMediaItem(canonicalMediaId, scopeContext));

  await logActivity(req, 'media.merge_apply', 'media', canonicalMediaId, {
    canonical_id: canonicalMediaId,
    duplicate_id: duplicateMediaId,
    media_type: preview.preview?.media_type || canonical?.media_type || null,
    evidence_summary: mergeEvidence.summary,
    evidence_confidence: mergeEvidence.confidence || null,
    attached_count: Number(result?.attached || 0) || 0
  });

  res.json({
    applied: true,
    canonical,
    duplicate: preview.duplicate,
    result,
    merge_details: mergeDetails
  });
}));

router.post('/merge-revert', requireSessionAuth, requireRole('admin', 'support_admin'), validate(mediaMergeRevertSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const canonicalMediaId = Number(req.body?.canonical_id);
  const duplicateMediaId = Number(req.body?.duplicate_id);
  const canonical = await loadScopedMediaItem(canonicalMediaId, scopeContext);
  if (!canonical) {
    return res.status(404).json({ error: 'Canonical media item was not found in the active scope' });
  }
  const mergeDetailsBefore = await loadScopedMergeDetails(canonicalMediaId, scopeContext);
  const matchingEntry = Array.isArray(mergeDetailsBefore?.entries)
    ? mergeDetailsBefore.entries.find((entry) => Number(entry?.duplicate_id || 0) === duplicateMediaId)
    : null;
  if (!matchingEntry) {
    return res.status(404).json({ error: 'Active merge event was not found for the requested duplicate id' });
  }

  const result = await runManualMediaMergeRevert({
    canonicalId: canonicalMediaId,
    duplicateId: duplicateMediaId
  });
  const mergeDetails = await loadScopedMergeDetails(canonicalMediaId, scopeContext);
  const restoredDuplicate = await loadScopedMediaItem(duplicateMediaId, scopeContext);

  await logActivity(req, 'media.merge_revert', 'media', canonicalMediaId, {
    canonical_id: canonicalMediaId,
    duplicate_id: duplicateMediaId,
    media_type: canonical.media_type || null,
    repair_type: matchingEntry?.repair_type || 'duplicate_attach'
  });

  res.json({
    reverted: true,
    canonical: summarizeMergeSourceRow(await loadScopedMediaItem(canonicalMediaId, scopeContext)),
    duplicate: restoredDuplicate ? summarizeMergeSourceRow(restoredDuplicate) : matchingEntry?.merged || null,
    result,
    merge_details: mergeDetails
  });
}));

router.post('/:id/valuation-refresh', validate(mediaValuationRefreshSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return res.status(400).json({ error: 'Invalid media id' });
  }

  const media = await loadScopedMediaItem(mediaId, scopeContext);
  if (!media) {
    return res.status(404).json({ error: 'Media item not found' });
  }

  const mode = String(req.body?.mode || 'live').trim().toLowerCase();
  if (mode === 'fixture' && process.env.NODE_ENV === 'production' && !requestHasPlaywrightBypass(req)) {
    return res.status(403).json({ error: 'Fixture valuation mode is not available in production' });
  }

  const config = await loadScopedIntegrationConfig(scopeContext?.spaceId || null);
  const asyncMode = shouldQueueImportByDefault(req);
  const auditReq = {
    user: req.user,
    headers: req.headers,
    ip: req.ip,
    socket: req.socket
  };

  const runRefresh = async () => {
    const outcome = await refreshMediaValuation(media, config, { mode, httpClient: axios });
    let refreshedMedia = media;
    if (outcome?.matched && outcome?.valuation) {
      refreshedMedia = await persistMediaValuation(media.id, outcome.valuation);
    }
    return {
      ...outcome,
      media: refreshedMedia
    };
  };

  if (asyncMode) {
    const provider = mode === 'fixture'
      ? (config.priceChartingEnabled ? 'pricecharting' : (config.eBayBrowseEnabled ? 'ebay_browse' : 'pricecharting'))
      : (config.priceChartingEnabled ? 'pricecharting' : (config.eBayBrowseEnabled ? 'ebay_browse' : 'unknown'));
    const job = await createSyncJob({
      userId: req.user.id,
      jobType: 'valuation_refresh',
      provider,
      scope: { ...jobScopePayload(scopeContext), mediaId },
      progress: {
        total: 1,
        processed: 0,
        matched: 0,
        errorCount: 0
      }
    });

    setImmediate(async () => {
      try {
        await updateSyncJob(job.id, { status: 'running', started_at: new Date() });
        const result = await runRefresh();
        await updateSyncJob(job.id, {
          status: 'succeeded',
          progress: {
            total: 1,
            processed: 1,
            matched: result.matched ? 1 : 0,
            errorCount: 0
          },
          summary: {
            mediaId,
            matched: Boolean(result.matched),
            provider: result.provider,
            liveNetwork: Boolean(result.liveNetwork),
            fixture: Boolean(result.fixture),
            valuation: result.valuation || null,
            lookupPlan: result.lookupPlan || null
          },
          finished_at: new Date()
        });
        await logActivity(auditReq, 'media.valuation.refresh', 'media', mediaId, {
          title: media.title || null,
          provider: result.provider || null,
          matched: Boolean(result.matched),
          liveNetwork: Boolean(result.liveNetwork),
          fixture: Boolean(result.fixture),
          mode,
          jobId: job.id
        });
      } catch (error) {
        await updateSyncJob(job.id, {
          status: 'failed',
          error: error.message || 'Valuation refresh failed',
          finished_at: new Date(),
          progress: {
            total: 1,
            processed: 1,
            matched: 0,
            errorCount: 1
          }
        });
        await logActivity(auditReq, 'media.valuation.refresh.failed', 'media', mediaId, {
          title: media.title || null,
          detail: error.message || 'Valuation refresh failed',
          mode,
          jobId: job.id
        });
      }
    });

    return res.status(202).json(buildQueuedJobResponse(job, provider));
  }

  try {
    const result = await runRefresh();
    await logActivity(req, 'media.valuation.refresh', 'media', mediaId, {
      title: media.title || null,
      provider: result.provider || null,
      matched: Boolean(result.matched),
      liveNetwork: Boolean(result.liveNetwork),
      fixture: Boolean(result.fixture),
      mode
    });
    return res.json({
      ok: true,
      queued: false,
      provider: result.provider,
      matched: Boolean(result.matched),
      liveNetwork: Boolean(result.liveNetwork),
      fixture: Boolean(result.fixture),
      valuation: result.valuation || null,
      media: result.media,
      lookupPlan: result.lookupPlan || null
    });
  } catch (error) {
    await logActivity(req, 'media.valuation.refresh.failed', 'media', mediaId, {
      title: media.title || null,
      detail: error.message || 'Valuation refresh failed',
      mode
    });
    return res.status(502).json({ error: error.message || 'Valuation refresh failed' });
  }
}));

router.get('/:id/variants', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return res.status(400).json({ error: 'Invalid media id' });
  }
  const mediaScopeParams = [mediaId];
  const mediaScopeClause = appendScopeSql(mediaScopeParams, scopeContext);
  const mediaResult = await pool.query(
    `SELECT id, media_type FROM media WHERE id = $1${mediaScopeClause}`,
    mediaScopeParams
  );
  const media = mediaResult.rows[0];
  if (!media) {
    return res.status(404).json({ error: 'Media item not found' });
  }
  if (media.media_type === 'tv_series') {
    const seasonsResult = await pool.query(
      `SELECT id, media_id, source, season_number, expected_episodes, available_episodes,
              is_complete, watch_state, watchlist, last_watched_at, created_at, updated_at
       FROM media_seasons
       WHERE media_id = $1
       ORDER BY season_number ASC`,
      [mediaId]
    );
    const rows = seasonsResult.rows.map((row) => ({
      id: row.id,
      media_id: row.media_id,
      source: row.source,
      source_item_key: `season:${row.season_number}`,
      edition: `Season ${row.season_number}`,
      season_number: row.season_number,
      expected_episodes: row.expected_episodes,
      available_episodes: row.available_episodes,
      is_complete: row.is_complete,
      watch_state: row.watch_state,
      watchlist: row.watchlist,
      last_watched_at: row.last_watched_at,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
    return res.json(rows);
  }
  const result = await pool.query(
    `SELECT id, media_id, source, source_item_key, source_media_id, source_part_id,
            edition, file_path, container, video_codec, audio_codec, resolution,
            video_width, video_height, audio_channels, duration_ms, runtime_minutes,
            created_at, updated_at
     FROM media_variants
     WHERE media_id = $1
     ORDER BY created_at DESC`,
    [mediaId]
  );
  res.json(result.rows);
}));

router.get('/:id/tv-seasons', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return res.status(400).json({ error: 'Invalid media id' });
  }
  const mediaParams = [mediaId];
  const mediaScopeClause = appendScopeSql(mediaParams, scopeContext);
  const mediaResult = await pool.query(
    `SELECT id, media_type FROM media WHERE id = $1${mediaScopeClause}`,
    mediaParams
  );
  const media = mediaResult.rows[0];
  if (!media) return res.status(404).json({ error: 'Media item not found' });
  if (media.media_type !== 'tv_series') {
    return res.status(400).json({ error: 'TV seasons are only available for TV series' });
  }
  const seasonsResult = await pool.query(
    `SELECT id, media_id, season_number, expected_episodes, available_episodes, is_complete,
            watch_state, watchlist, last_watched_at, source, created_at, updated_at
     FROM media_seasons
     WHERE media_id = $1
     ORDER BY season_number ASC`,
    [mediaId]
  );
  res.json({ mediaId, seasons: seasonsResult.rows });
}));

router.get('/:id/tv-seasons/:seasonNumber', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  const seasonNumber = Number(req.params.seasonNumber);
  if (!Number.isFinite(mediaId) || mediaId <= 0 || !Number.isInteger(seasonNumber) || seasonNumber <= 0) {
    return res.status(400).json({ error: 'Invalid media id or season number' });
  }
  const mediaParams = [mediaId];
  const mediaScopeClause = appendScopeSql(mediaParams, scopeContext);
  const mediaResult = await pool.query(
    `SELECT id, media_type, tmdb_id
     FROM media
     WHERE id = $1${mediaScopeClause}`,
    mediaParams
  );
  const media = mediaResult.rows[0];
  if (!media) return res.status(404).json({ error: 'Media item not found' });
  if (media.media_type !== 'tv_series') {
    return res.status(400).json({ error: 'TV season details are only available for TV series' });
  }
  const seasonResult = await pool.query(
    `SELECT id, media_id, season_number, expected_episodes, available_episodes, is_complete,
            watch_state, watchlist, last_watched_at, source, created_at, updated_at
     FROM media_seasons
     WHERE media_id = $1
       AND season_number = $2`,
    [mediaId, seasonNumber]
  );
  const season = seasonResult.rows[0];
  if (!season) {
    return res.status(404).json({ error: 'Season not found for media item' });
  }
  if (Number(season.expected_episodes) === 0) {
    const normalized = await pool.query(
      `UPDATE media_seasons
       SET expected_episodes = NULL
       WHERE media_id = $1
         AND season_number = $2
       RETURNING id, media_id, season_number, expected_episodes, available_episodes, is_complete,
                 watch_state, watchlist, last_watched_at, source, created_at, updated_at`,
      [mediaId, seasonNumber]
    );
    if (normalized.rows[0]) {
      Object.assign(season, normalized.rows[0]);
    }
  }

  const plexMetaResult = await pool.query(
    `SELECT "value"
     FROM media_metadata
     WHERE media_id = $1
       AND "key" = 'plex_item_key'
     LIMIT 1`,
    [mediaId]
  );
  const plexItemKey = plexMetaResult.rows[0]?.value || null;
  const plexRatingKey = parsePlexRatingKeyFromItemKey(plexItemKey);

  let tmdb = null;
  let plexEpisodeState = { watchedEpisodeNumbers: [], availableEpisodeNumbers: [] };
  const needsIntegrationConfig = Boolean(media.tmdb_id) || Boolean(plexRatingKey);
  const config = needsIntegrationConfig ? await loadScopedIntegrationConfig(scopeContext?.spaceId || null) : null;
  if (media.tmdb_id && config) {
    try {
      tmdb = await fetchTmdbTvSeasonDetails(media.tmdb_id, seasonNumber, config);
      const expected = Number(tmdb?.episode_count);
      if (Number.isInteger(expected) && expected > 0 && season.expected_episodes !== expected) {
        const updated = await pool.query(
          `UPDATE media_seasons
           SET expected_episodes = $3
           WHERE media_id = $1
             AND season_number = $2
           RETURNING id, media_id, season_number, expected_episodes, available_episodes, is_complete,
                     watch_state, watchlist, last_watched_at, source, created_at, updated_at`,
          [mediaId, seasonNumber, expected]
        );
        if (updated.rows[0]) {
          res.json({ mediaId, season: updated.rows[0], tmdb });
          return;
        }
      }
    } catch (_error) {
      tmdb = null;
    }
  }
  if (plexRatingKey && config?.plexApiUrl && config?.plexApiKey) {
    try {
      plexEpisodeState = await fetchPlexSeasonEpisodeStates(config, plexRatingKey, seasonNumber);
    } catch (_error) {
      plexEpisodeState = { watchedEpisodeNumbers: [], availableEpisodeNumbers: [] };
    }
  }
  if (tmdb && Array.isArray(tmdb.episodes)) {
    const watched = new Set(plexEpisodeState.watchedEpisodeNumbers || []);
    const available = new Set(plexEpisodeState.availableEpisodeNumbers || []);
    tmdb.episodes = tmdb.episodes.map((episode) => ({
      ...episode,
      watched: watched.has(Number(episode.episode_number)),
      in_library: available.has(Number(episode.episode_number))
    }));
  }

  const hasAllEpisodes = Number.isFinite(Number(season?.available_episodes))
    && Number.isFinite(Number(season?.expected_episodes))
    ? Number(season.available_episodes) >= Number(season.expected_episodes)
    : null;

  res.json({
    mediaId,
    season,
    tmdb,
    plex: {
      ratingKey: plexRatingKey,
      watchedEpisodeNumbers: plexEpisodeState.watchedEpisodeNumbers,
      availableEpisodeNumbers: plexEpisodeState.availableEpisodeNumbers
    },
    derived: {
      hasAllEpisodes
    }
  });
}));

router.put('/:id/tv-seasons', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return res.status(400).json({ error: 'Invalid media id' });
  }

  const rawSeasons = Array.isArray(req.body?.seasons) ? req.body.seasons : [];
  const seasons = [...new Set(
    rawSeasons
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0 && value <= 999)
  )].sort((a, b) => a - b);

  const mediaParams = [mediaId];
  const mediaScopeClause = appendScopeSql(mediaParams, scopeContext);
  const mediaResult = await pool.query(
    `SELECT id, media_type FROM media WHERE id = $1${mediaScopeClause}`,
    mediaParams
  );
  const media = mediaResult.rows[0];
  if (!media) {
    return res.status(404).json({ error: 'Media item not found' });
  }
  if (media.media_type !== 'tv_series') {
    return res.status(400).json({ error: 'TV seasons can only be set for TV series' });
  }

  const source = 'manual_tv_season';
  if (seasons.length > 0) {
    await pool.query(
      `DELETE FROM media_seasons
       WHERE media_id = $1
         AND source = $2
         AND season_number <> ALL($3::int[])`,
      [mediaId, source, seasons]
    );
  } else {
    await pool.query(
      `DELETE FROM media_seasons
       WHERE media_id = $1
         AND source = $2`,
      [mediaId, source]
    );
  }

  for (const season of seasons) {
    await pool.query(
      `INSERT INTO media_seasons (media_id, season_number, source)
       VALUES ($1, $2, $3)
       ON CONFLICT (media_id, season_number)
       DO UPDATE SET source = EXCLUDED.source`,
      [mediaId, season, source]
    );
  }

  await logActivity(req, 'media.tv_seasons.update', 'media', mediaId, {
    seasons
  });

  res.json({ ok: true, mediaId, seasons });
}));

router.patch('/:id/tv-seasons/:seasonNumber', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  const seasonNumber = Number(req.params.seasonNumber);
  if (!Number.isFinite(mediaId) || mediaId <= 0 || !Number.isInteger(seasonNumber) || seasonNumber <= 0) {
    return res.status(400).json({ error: 'Invalid media id or season number' });
  }

  const mediaParams = [mediaId];
  const mediaScopeClause = appendScopeSql(mediaParams, scopeContext);
  const mediaResult = await pool.query(
    `SELECT id, media_type FROM media WHERE id = $1${mediaScopeClause}`,
    mediaParams
  );
  const media = mediaResult.rows[0];
  if (!media) return res.status(404).json({ error: 'Media item not found' });
  if (media.media_type !== 'tv_series') {
    return res.status(400).json({ error: 'TV seasons can only be updated for TV series' });
  }

  const raw = req.body || {};
  const updates = {};
  if (raw.expected_episodes !== undefined) {
    const val = raw.expected_episodes === null || raw.expected_episodes === '' ? null : Number(raw.expected_episodes);
    if (val !== null && (!Number.isInteger(val) || val < 0)) {
      return res.status(400).json({ error: 'expected_episodes must be a non-negative integer or null' });
    }
    updates.expected_episodes = val;
  }
  if (raw.available_episodes !== undefined) {
    const val = raw.available_episodes === null || raw.available_episodes === '' ? null : Number(raw.available_episodes);
    if (val !== null && (!Number.isInteger(val) || val < 0)) {
      return res.status(400).json({ error: 'available_episodes must be a non-negative integer or null' });
    }
    updates.available_episodes = val;
  }
  if (raw.is_complete !== undefined) {
    updates.is_complete = Boolean(raw.is_complete);
  }
  if (raw.watchlist !== undefined) {
    updates.watchlist = Boolean(raw.watchlist);
  }
  if (raw.watch_state !== undefined) {
    const state = String(raw.watch_state || '').trim().toLowerCase();
    if (!TV_WATCH_STATES.has(state)) {
      return res.status(400).json({ error: 'watch_state must be one of unwatched, in_progress, completed' });
    }
    updates.watch_state = state;
  }
  if (raw.last_watched_at !== undefined) {
    if (raw.last_watched_at === null || raw.last_watched_at === '') {
      updates.last_watched_at = null;
    } else {
      const parsed = new Date(raw.last_watched_at);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'last_watched_at must be a valid date or null' });
      }
      updates.last_watched_at = parsed.toISOString();
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No season fields provided for update' });
  }

  const existing = await pool.query(
    `SELECT id FROM media_seasons WHERE media_id = $1 AND season_number = $2`,
    [mediaId, seasonNumber]
  );
  if (existing.rows.length === 0) {
    await pool.query(
      `INSERT INTO media_seasons (media_id, season_number, source)
       VALUES ($1, $2, $3)`,
      [mediaId, seasonNumber, 'manual_tv_season']
    );
  }

  const setParts = [];
  const values = [];
  Object.entries(updates).forEach(([key, value], idx) => {
    setParts.push(`${key} = $${idx + 1}`);
    values.push(value);
  });
  values.push(mediaId, seasonNumber);
  const updated = await pool.query(
    `UPDATE media_seasons
     SET ${setParts.join(', ')}
     WHERE media_id = $${values.length - 1}
       AND season_number = $${values.length}
     RETURNING id, media_id, season_number, expected_episodes, available_episodes,
               is_complete, watch_state, watchlist, last_watched_at, source, created_at, updated_at`,
    values
  );

  await logActivity(req, 'media.tv_season.update', 'media', mediaId, {
    season_number: seasonNumber,
    updates
  });

  res.json({ ok: true, mediaId, season: updated.rows[0] });
}));

// ── TMDB search ───────────────────────────────────────────────────────────────

router.post('/search-tmdb', validate(simpleSearchSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const { title, year, mediaType } = req.body;
  const config = await loadScopedIntegrationConfig(scopeContext?.spaceId || null);
  const normalizedType = mediaType === 'tv' ? 'tv' : 'movie';
  const results = await searchTmdbMovie(title, year, config, normalizedType);
  res.json(results);
}));

router.post('/tmdb/trace-match', validate(simpleSearchSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const { title, year, mediaType } = req.body;
  const lookupTitle = title;
  const config = await loadScopedIntegrationConfig(scopeContext?.spaceId || null);
  const normalizedType = mediaType === 'tv' ? 'tv' : 'movie';
  const searchResults = await searchTmdbMovie(lookupTitle, year, config, normalizedType);
  const scored = searchResults.map((row) => {
    const score = scoreTmdbMatchCandidate(row, lookupTitle, year);
    return {
      id: row.id || null,
      title: row.title || row.name || null,
      original_title: row.original_title || row.original_name || null,
      release_date: row.release_date || row.first_air_date || null,
      release_year: row.release_year || score.candidateYear,
      vote_average: row.vote_average ?? row.rating ?? null,
      vote_count: row.vote_count ?? null,
      overview: row.overview || null,
      poster_path: row.poster_path || null,
      tmdb_media_type: row.tmdb_media_type || normalizedType,
      score: score.score
    };
  });
  const chosen = pickBestTmdbMatch(searchResults, lookupTitle, year);
  res.json({
    title: lookupTitle,
    year: Number.isFinite(Number(year)) ? Number(year) : null,
    mediaType: normalizedType,
    chosen: chosen ? {
      id: chosen.id || null,
      title: chosen.title || chosen.name || null,
      original_title: chosen.original_title || chosen.original_name || null,
      release_date: chosen.release_date || chosen.first_air_date || null,
      release_year: chosen.release_year || parseYear(chosen.release_date || chosen.first_air_date || ''),
      vote_average: chosen.vote_average ?? chosen.rating ?? null,
      vote_count: chosen.vote_count ?? null,
      tmdb_media_type: chosen.tmdb_media_type || normalizedType
    } : null,
    candidates: scored
  });
}));

router.get('/tmdb/:id/details', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const movieId = Number(req.params.id);
  if (!Number.isFinite(movieId) || movieId <= 0) {
    return res.status(400).json({ error: 'Valid numeric TMDB id is required' });
  }
  const config = await loadScopedIntegrationConfig(scopeContext?.spaceId || null);
  const normalizedType = req.query.mediaType === 'tv' ? 'tv' : 'movie';
  const details = await fetchTmdbMovieDetails(movieId, config, normalizedType);
  res.json(details);
}));

router.get('/tmdb/:id/trace', asyncHandler(async (req, res) => {
  const tmdbId = Number(req.params.id);
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
    return res.status(400).json({ error: 'Valid numeric TMDB id is required' });
  }
  const scopeContext = resolveScopeContext(req);
  const normalizedType = req.query.mediaType === 'tv' ? 'tv' : 'movie';
  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : 20;
  const params = [tmdbId, normalizedType, limit];
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'm.space_id',
    libraryColumn: 'm.library_id'
  });
  const result = await pool.query(
    `SELECT
       m.id,
       m.title,
       m.original_title,
       m.year,
       m.media_type,
       m.tmdb_id,
       m.tmdb_media_type,
       m.tmdb_url,
       m.import_source,
       m.library_id,
       m.space_id,
       MAX(CASE WHEN mm."key" = 'plex_guid' THEN mm."value" END) AS plex_guid,
       MAX(CASE WHEN mm."key" = 'plex_item_key' THEN mm."value" END) AS plex_item_key,
       MAX(CASE WHEN mm."key" = 'plex_section_id' THEN mm."value" END) AS plex_section_id
     FROM media m
     LEFT JOIN media_metadata mm
       ON mm.media_id = m.id
      AND mm."key" IN ('plex_guid', 'plex_item_key', 'plex_section_id')
     WHERE m.tmdb_id = $1
       AND COALESCE(m.tmdb_media_type, 'movie') = $2
       ${scopeClause}
     GROUP BY
       m.id, m.title, m.original_title, m.year, m.media_type, m.tmdb_id,
       m.tmdb_media_type, m.tmdb_url, m.import_source, m.library_id, m.space_id
     ORDER BY lower(m.title) ASC, m.id ASC
     LIMIT $3`,
    params
  );
  res.json({
    tmdb_id: tmdbId,
    tmdb_media_type: normalizedType,
    count: result.rows.length,
    items: result.rows
  });
}));

router.post('/enrich/book/search', validate(titleAuthorSearchSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const { title, author } = req.body;
  const config = await loadScopedIntegrationConfig(scopeContext?.spaceId || null);
  const matches = await searchBooksByTitle(title, config, 10, String(author || '').trim());
  res.json({ provider: config.booksProvider || 'googlebooks', matches });
}));

router.post('/enrich/audio/search', validate(titleArtistSearchSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const { title, artist } = req.body;
  const config = await loadScopedIntegrationConfig(scopeContext?.spaceId || null);
  const matches = await searchAudioByTitle(title, config, 10, String(artist || '').trim());
  res.json({ provider: config.audioProvider || 'discogs', matches });
}));

router.post('/enrich/game/search', validate(simpleSearchSchema.pick({ title: true })), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const { title } = req.body;
  const config = await loadScopedIntegrationConfig(scopeContext?.spaceId || null);
  const matches = await searchGamesByTitle(title, config, 10);
  res.json({ provider: config.gamesProvider || 'igdb', matches });
}));

router.post('/enrich/comic/search', validate(simpleSearchSchema.pick({ title: true })), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const { title } = req.body;
  const config = await loadScopedIntegrationConfig(scopeContext?.spaceId || null);
  const matches = await searchComicsByTitle(title, config, 10);
  res.json({ provider: config.comicsProvider || 'metron', matches });
}));

// ── UPC lookup ────────────────────────────────────────────────────────────────

router.post('/lookup-upc', validate(upcLookupSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const { upc, mediaType } = req.body;

  const config = await loadScopedIntegrationConfig(scopeContext?.spaceId || null);
  const { barcodeProvider, barcodeApiUrl, barcodeQueryParam, barcodeApiKey, barcodeApiKeyHeader } = config;
  const directBookIsbn = mediaType === 'book' ? normalizeIsbn(upc) : '';

  if (directBookIsbn) {
    try {
      const directBookMatches = await searchBooksByIsbn(directBookIsbn, config, 5);
      if (directBookMatches.length) {
        return res.json({
          provider: 'books:isbn-direct',
          request: {
            provider: 'books:isbn-direct',
            isbn: directBookIsbn
          },
          matches: directBookMatches.map((book) => ({
            title: book?.title || '',
            normalizedTitle: book?.title || '',
            searchTitle: book?.title || '',
            description: book?.overview || null,
            image: book?.poster_path || null,
            upc: String(upc || '').trim() || null,
            mediaTypeGuess: 'book',
            year: book?.year || null,
            source: 'books:isbn-direct',
            typeDetails: {
              author: book?.type_details?.author || null,
              isbn: directBookIsbn,
              format: book?.type_details?.edition || null,
              series: null,
              season_number: null,
              publisher: book?.type_details?.publisher || null
            },
            book
          }))
        });
      }
    } catch (error) {
      if ((error?.status || 500) >= 400 && (error?.status || 500) < 500) {
        return res.status(error.status || 400).json({
          error: error?.message || 'Book enrichment failed',
          detail: 'Direct ISBN lookup failed',
          stage: 'book_isbn_direct',
          request: {
            mediaType,
            isbn: directBookIsbn
          }
        });
      }
    }
  }

  if (!barcodeApiUrl) {
    return res.status(400).json({ error: 'Barcode API URL is not configured', provider: barcodeProvider });
  }

  const headers = {};
  if (barcodeApiKey) headers[barcodeApiKeyHeader] = barcodeApiKey;
  const barcodeRequest = {
    provider: barcodeProvider,
    url: barcodeApiUrl,
    params: { [barcodeQueryParam]: upc },
    headerNames: Object.keys(headers)
  };

  let barcodeResponse;
  try {
    barcodeResponse = await axios.get(barcodeApiUrl, {
      params: { [barcodeQueryParam]: upc },
      headers,
      timeout: 15000
    });
  } catch (error) {
    const detail = error?.response?.data?.message
      || error?.response?.data?.error
      || error?.response?.data?.detail
      || error?.message
      || 'Barcode lookup failed';
    return res.status(error?.response?.status || 400).json({
      error: detail,
      detail: 'Barcode provider request failed',
      stage: 'barcode_provider',
      request: barcodeRequest
    });
  }

  const barcodeMatches = normalizeBarcodeMatches(barcodeResponse.data);
  const enrichedMatches = [];

  for (const match of barcodeMatches.slice(0, 6)) {
    let book = null;
    let typeEnrichment = null;
    let tmdb = null;
    const effectiveMediaType = mediaType || match.mediaTypeGuess || null;

    if (effectiveMediaType === 'book') {
      try {
        const isbn = String(match?.typeDetails?.isbn || '').trim();
        const author = String(match?.typeDetails?.author || '').trim();
        const queryTitle = String(match?.searchTitle || match?.normalizedTitle || match?.title || '').trim();
        let bookResults = [];
        if (isbn) {
          bookResults = await searchBooksByIsbn(isbn, config, 5);
        }
        if (!bookResults.length && queryTitle) {
          bookResults = await searchBooksByTitle(queryTitle, config, 5, author);
        }
        book = bookResults[0] || null;
      } catch (error) {
        if ((error?.status || 500) >= 400 && (error?.status || 500) < 500) {
          return res.status(error.status || 400).json({
            error: error?.message || 'Book enrichment failed',
            detail: 'Book enrichment request failed',
            stage: 'book_enrichment',
            request: {
              mediaType: effectiveMediaType,
              queryTitle,
              isbn,
              author
            }
          });
        }
      }
    } else if (effectiveMediaType === 'audio') {
      try {
        const queryTitle = String(match?.searchTitle || match?.normalizedTitle || match?.title || '').trim();
        if (queryTitle) {
          const audioResults = await searchAudioByTitle(queryTitle, config, 5, String(match?.typeDetails?.author || '').trim());
          typeEnrichment = audioResults[0] || null;
        }
      } catch (error) {
        if ((error?.status || 500) >= 400 && (error?.status || 500) < 500) {
          const queryTitle = String(match?.searchTitle || match?.normalizedTitle || match?.title || '').trim();
          return res.status(error.status || 400).json({
            error: error?.message || 'Audio enrichment failed',
            detail: 'Audio enrichment request failed',
            stage: 'audio_enrichment',
            request: {
              mediaType: effectiveMediaType,
              queryTitle
            }
          });
        }
      }
    } else if (effectiveMediaType === 'game') {
      try {
        const queryTitle = String(match?.searchTitle || match?.normalizedTitle || match?.title || '').trim();
        if (queryTitle) {
          const gameResults = await searchGamesByTitle(queryTitle, config, 5);
          typeEnrichment = gameResults[0] || null;
        }
      } catch (error) {
        if ((error?.status || 500) >= 400 && (error?.status || 500) < 500) {
          const queryTitle = String(match?.searchTitle || match?.normalizedTitle || match?.title || '').trim();
          return res.status(error.status || 400).json({
            error: error?.message || 'Game enrichment failed',
            detail: 'Game enrichment request failed',
            stage: 'game_enrichment',
            request: {
              mediaType: effectiveMediaType,
              queryTitle
            }
          });
        }
      }
    } else if (effectiveMediaType === 'comic_book') {
      try {
        const queryTitle = String(match?.searchTitle || match?.normalizedTitle || match?.title || '').trim();
        if (queryTitle) {
          const comicResults = await searchComicsByTitle(queryTitle, config, 5);
          typeEnrichment = comicResults[0] || null;
        }
      } catch (error) {
        if ((error?.status || 500) >= 400 && (error?.status || 500) < 500) {
          const queryTitle = String(match?.searchTitle || match?.normalizedTitle || match?.title || '').trim();
          return res.status(error.status || 400).json({
            error: error?.message || 'Comic enrichment failed',
            detail: 'Comic enrichment request failed',
            stage: 'comic_enrichment',
            request: {
              mediaType: effectiveMediaType,
              queryTitle
            }
          });
        }
      }
    } else if (match.title) {
      try {
        const tmdbSearchType = effectiveMediaType === 'tv_series' || effectiveMediaType === 'tv_episode' || match.mediaTypeGuess === 'tv_series'
          ? 'tv'
          : 'movie';
        const queryTitle = String(match?.searchTitle || match?.normalizedTitle || match?.title || '').trim();
        const tmdbResults = await searchTmdbMovie(queryTitle, undefined, config, tmdbSearchType);
        tmdb = tmdbResults[0] || null;
      } catch (error) {
        if ((error?.status || 500) >= 400 && (error?.status || 500) < 500) {
          return res.status(error.status || 400).json({
            error: error?.message || 'TMDB enrichment failed',
            detail: 'TMDB enrichment request failed',
            stage: 'tmdb_enrichment',
            request: {
              mediaType: effectiveMediaType,
              tmdbType: effectiveMediaType === 'tv_series' || effectiveMediaType === 'tv_episode' || match.mediaTypeGuess === 'tv_series' ? 'tv' : 'movie',
              queryTitle: String(match?.searchTitle || match?.normalizedTitle || match?.title || '').trim()
            }
          });
        }
      }
    }
    enrichedMatches.push({ ...match, book, typeEnrichment, tmdb });
  }

  res.json({ provider: barcodeProvider, upc, matches: enrichedMatches });
}));

// ── Cover upload ──────────────────────────────────────────────────────────────

router.post('/upload-cover', memoryImageUpload.single('cover'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const stored = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
  res.json({ path: stored.url, provider: stored.provider });
}));

async function resolveEditableMediaForUser({ req, mediaId, scopeContext }) {
  const unrestrictedParams = [mediaId];
  const unrestrictedScopeClause = appendScopeSql(unrestrictedParams, scopeContext);
  const unrestricted = await pool.query(
    `SELECT id, library_id, space_id, signed_by, signed_role, signed_on, signed_at, signed_proof_path
     FROM media
     WHERE id = $1${unrestrictedScopeClause}
     LIMIT 1`,
    unrestrictedParams
  );
  if (unrestricted.rows.length === 0) {
    return { status: 404, row: null };
  }

  const editableParams = [mediaId];
  let ownerClause = '';
  if (req.user.role !== 'admin') {
    editableParams.push(req.user.id);
    ownerClause = ` AND added_by = $${editableParams.length}`;
  }
  const editableScopeClause = appendScopeSql(editableParams, scopeContext);
  const editable = await pool.query(
    `SELECT id, library_id, space_id, signed_by, signed_role, signed_on, signed_at, signed_proof_path
     FROM media
     WHERE id = $1${ownerClause}${editableScopeClause}
     LIMIT 1`,
    editableParams
  );
  if (editable.rows.length === 0) {
    return { status: 403, row: null };
  }
  return { status: 200, row: editable.rows[0] };
}

router.get('/:id/signatures', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return res.status(400).json({ error: 'Invalid media id' });
  }
  const media = await loadScopedMediaItem(mediaId, scopeContext);
  if (!media) return res.status(404).json({ error: 'Media item not found' });
  res.json({ media_id: media.id, signatures: media.signatures || [] });
}));

router.post('/:id/signatures', validate(signatureRecordCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return res.status(400).json({ error: 'Invalid media id' });
  }
  const access = await resolveEditableMediaForUser({ req, mediaId, scopeContext });
  if (access.status === 404) return res.status(404).json({ error: 'Media item not found' });
  if (access.status === 403) return res.status(403).json({ error: 'Not authorized to edit this media item' });
  const signature = await createSignatureRecord(pool, {
    ownerType: 'media',
    ownerId: mediaId,
    libraryId: access.row.library_id || null,
    spaceId: access.row.space_id || null,
    createdBy: req.user.id,
    signature: req.body,
    isPrimary: req.body.is_primary === true
  });
  if (!signature) return res.status(400).json({ error: 'At least one signature detail is required' });
  const media = await syncMediaLegacyFieldsFromSignatures(mediaId);
  await logActivity(req, 'media.signature.create', 'media', mediaId, {
    signatureRecordId: signature.id,
    isPrimary: signature.is_primary === true
  });
  res.status(201).json({ media, signatures: media?.signatures || [], signature });
}));

router.patch('/:id/signatures/:signatureId', validate(signatureRecordUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  const signatureId = Number(req.params.signatureId);
  if (!Number.isFinite(mediaId) || mediaId <= 0 || !Number.isFinite(signatureId) || signatureId <= 0) {
    return res.status(400).json({ error: 'Invalid media/signature id' });
  }
  const access = await resolveEditableMediaForUser({ req, mediaId, scopeContext });
  if (access.status === 404) return res.status(404).json({ error: 'Media item not found' });
  if (access.status === 403) return res.status(403).json({ error: 'Not authorized to edit this media item' });
  const signature = await updateSignatureRecord(pool, {
    ownerType: 'media',
    ownerId: mediaId,
    signatureId,
    libraryId: access.row.library_id || null,
    spaceId: access.row.space_id || null,
    signature: req.body,
    isPrimary: req.body.is_primary === true
  });
  if (!signature) return res.status(404).json({ error: 'Signature record not found' });
  const media = await syncMediaLegacyFieldsFromSignatures(mediaId);
  await logActivity(req, 'media.signature.update', 'media', mediaId, {
    signatureRecordId: signature.id,
    isPrimary: signature.is_primary === true
  });
  res.json({ media, signatures: media?.signatures || [], signature });
}));

router.post('/:id/signatures/:signatureId/proof', memoryImageUpload.single('proof'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  const signatureId = Number(req.params.signatureId);
  if (!Number.isFinite(mediaId) || mediaId <= 0 || !Number.isFinite(signatureId) || signatureId <= 0) {
    return res.status(400).json({ error: 'Invalid media/signature id' });
  }
  if (!req.file) return res.status(400).json({ error: 'Proof image file is required' });
  const access = await resolveEditableMediaForUser({ req, mediaId, scopeContext });
  if (access.status === 404) return res.status(404).json({ error: 'Media item not found' });
  if (access.status === 403) return res.status(403).json({ error: 'Not authorized to edit this media item' });
  const currentSignatures = await loadSignatureRecordsForOwner(pool, { ownerType: 'media', ownerId: mediaId });
  const existingSignature = currentSignatures.find((signature) => Number(signature.id) === signatureId) || null;
  if (!existingSignature) return res.status(404).json({ error: 'Signature record not found' });
  const stored = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
  const proofMutation = await addSignatureProof(pool, {
    ownerType: 'media',
    ownerId: mediaId,
    signatureId,
    proofPath: stored.url,
    proofType: req.body.proof_type,
    label: req.body.label,
    notes: req.body.notes,
    provider: stored.provider,
    originalFilename: req.file.originalname,
    mimeType: req.file.mimetype,
    createdBy: req.user.id
  });
  const signature = proofMutation?.signature || null;
  if (!signature) return res.status(404).json({ error: 'Signature record not found' });
  const media = await syncMediaLegacyFieldsFromSignatures(mediaId);
  await logActivity(req, existingSignature.proof_path ? 'media.signature.proof.add' : 'media.signature.proof.upload', 'media', mediaId, {
    signatureRecordId: signature.id,
    nextPath: stored.url,
    proofId: proofMutation?.proof?.id || null,
    provider: stored.provider
  });
  res.json({
    media,
    signatures: media?.signatures || [],
    signature,
    proof: proofMutation?.proof || null,
    proof_path: signature.proof_path || null,
    signed_proof_path: media?.signed_proof_path || null,
    provider: stored.provider
  });
}));

router.patch('/:id/signatures/:signatureId/proofs/:proofId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  const signatureId = Number(req.params.signatureId);
  const proofId = Number(req.params.proofId);
  if (!Number.isFinite(mediaId) || mediaId <= 0 || !Number.isFinite(signatureId) || signatureId <= 0 || !Number.isFinite(proofId) || proofId <= 0) {
    return res.status(400).json({ error: 'Invalid media/signature/proof id' });
  }
  const access = await resolveEditableMediaForUser({ req, mediaId, scopeContext });
  if (access.status === 404) return res.status(404).json({ error: 'Media item not found' });
  if (access.status === 403) return res.status(403).json({ error: 'Not authorized to edit this media item' });
  const proofMutation = await updateSignatureProofMetadata(pool, {
    ownerType: 'media',
    ownerId: mediaId,
    signatureId,
    proofId,
    proofType: req.body.proof_type,
    label: req.body.label,
    notes: req.body.notes
  });
  if (!proofMutation?.signature) return res.status(404).json({ error: 'Signature proof not found' });
  const media = await syncMediaLegacyFieldsFromSignatures(mediaId);
  await logActivity(req, 'media.signature.proof.metadata.update', 'media', mediaId, {
    signatureRecordId: signatureId,
    proofId,
    proofType: proofMutation.proof?.proof_type || null
  });
  res.json({
    media,
    signatures: media?.signatures || [],
    signature: proofMutation.signature,
    proof: proofMutation.proof,
    proof_path: proofMutation.signature.proof_path || null,
    signed_proof_path: media?.signed_proof_path || null
  });
}));

router.delete('/:id/signatures/:signatureId/proofs/:proofId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  const signatureId = Number(req.params.signatureId);
  const proofId = Number(req.params.proofId);
  if (!Number.isFinite(mediaId) || mediaId <= 0 || !Number.isFinite(signatureId) || signatureId <= 0 || !Number.isFinite(proofId) || proofId <= 0) {
    return res.status(400).json({ error: 'Invalid media/signature/proof id' });
  }
  const access = await resolveEditableMediaForUser({ req, mediaId, scopeContext });
  if (access.status === 404) return res.status(404).json({ error: 'Media item not found' });
  if (access.status === 403) return res.status(403).json({ error: 'Not authorized to edit this media item' });
  const proofMutation = await archiveSignatureProof(pool, {
    ownerType: 'media',
    ownerId: mediaId,
    signatureId,
    proofId
  });
  if (!proofMutation?.signature) return res.status(404).json({ error: 'Signature proof not found' });
  const media = await syncMediaLegacyFieldsFromSignatures(mediaId);
  await logActivity(req, 'media.signature.proof.remove', 'media', mediaId, {
    signatureRecordId: signatureId,
    proofId,
    previousPath: proofMutation.proof?.proof_path || null
  });
  res.json({
    media,
    signatures: media?.signatures || [],
    signature: proofMutation.signature,
    proof: proofMutation.proof,
    removed: true,
    proof_path: proofMutation.signature.proof_path || null,
    signed_proof_path: media?.signed_proof_path || null
  });
}));

router.delete('/:id/signatures/:signatureId/proof', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  const signatureId = Number(req.params.signatureId);
  if (!Number.isFinite(mediaId) || mediaId <= 0 || !Number.isFinite(signatureId) || signatureId <= 0) {
    return res.status(400).json({ error: 'Invalid media/signature id' });
  }
  const access = await resolveEditableMediaForUser({ req, mediaId, scopeContext });
  if (access.status === 404) return res.status(404).json({ error: 'Media item not found' });
  if (access.status === 403) return res.status(403).json({ error: 'Not authorized to edit this media item' });
  const currentSignatures = await loadSignatureRecordsForOwner(pool, { ownerType: 'media', ownerId: mediaId });
  const existingSignature = currentSignatures.find((signature) => Number(signature.id) === signatureId) || null;
  if (!existingSignature) return res.status(404).json({ error: 'Signature record not found' });
  if (!existingSignature.proof_path) {
    const media = await syncMediaLegacyFieldsFromSignatures(mediaId);
    return res.json({
      media,
      signatures: media?.signatures || [],
      signature: existingSignature,
      removed: false,
      proof_path: null,
      signed_proof_path: media?.signed_proof_path || null
    });
  }
  const primaryProof = (existingSignature.proofs || []).find((proof) => proof.proof_path === existingSignature.proof_path) || (existingSignature.proofs || [])[0] || null;
  const proofMutation = primaryProof ? await archiveSignatureProof(pool, {
    ownerType: 'media',
    ownerId: mediaId,
    signatureId,
    proofId: primaryProof.id
  }) : { signature: await updateSignatureProofPath(pool, { ownerType: 'media', ownerId: mediaId, signatureId, proofPath: null }), proof: null };
  const signature = proofMutation?.signature || null;
  if (!signature) return res.status(404).json({ error: 'Signature record not found' });
  const media = await syncMediaLegacyFieldsFromSignatures(mediaId);
  await logActivity(req, 'media.signature.proof.remove', 'media', mediaId, {
    signatureRecordId: signature.id,
    previousPath: existingSignature.proof_path || null
  });
  res.json({
    media,
    signatures: media?.signatures || [],
    signature,
    removed: true,
    proof_path: null,
    signed_proof_path: media?.signed_proof_path || null
  });
}));

router.post('/:id/signatures/:signatureId/primary', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  const signatureId = Number(req.params.signatureId);
  if (!Number.isFinite(mediaId) || mediaId <= 0 || !Number.isFinite(signatureId) || signatureId <= 0) {
    return res.status(400).json({ error: 'Invalid media/signature id' });
  }
  const access = await resolveEditableMediaForUser({ req, mediaId, scopeContext });
  if (access.status === 404) return res.status(404).json({ error: 'Media item not found' });
  if (access.status === 403) return res.status(403).json({ error: 'Not authorized to edit this media item' });
  const signature = await setPrimarySignatureRecord(pool, { ownerType: 'media', ownerId: mediaId, signatureId });
  if (!signature) return res.status(404).json({ error: 'Signature record not found' });
  const media = await syncMediaLegacyFieldsFromSignatures(mediaId);
  await logActivity(req, 'media.signature.primary', 'media', mediaId, { signatureRecordId: signature.id });
  res.json({ media, signatures: media?.signatures || [], signature });
}));

router.delete('/:id/signatures/:signatureId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  const signatureId = Number(req.params.signatureId);
  if (!Number.isFinite(mediaId) || mediaId <= 0 || !Number.isFinite(signatureId) || signatureId <= 0) {
    return res.status(400).json({ error: 'Invalid media/signature id' });
  }
  const access = await resolveEditableMediaForUser({ req, mediaId, scopeContext });
  if (access.status === 404) return res.status(404).json({ error: 'Media item not found' });
  if (access.status === 403) return res.status(403).json({ error: 'Not authorized to edit this media item' });
  const signature = await archiveSignatureRecord(pool, { ownerType: 'media', ownerId: mediaId, signatureId });
  if (!signature) return res.status(404).json({ error: 'Signature record not found' });
  const media = await syncMediaLegacyFieldsFromSignatures(mediaId);
  await logActivity(req, 'media.signature.archive', 'media', mediaId, { signatureRecordId: signature.id });
  res.json({ media, signatures: media?.signatures || [], signature, archived: true });
}));

router.post('/:id/upload-signing-proof', memoryImageUpload.single('proof'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return res.status(400).json({ error: 'Invalid media id' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const access = await resolveEditableMediaForUser({ req, mediaId, scopeContext });
  if (access.status === 404) return res.status(404).json({ error: 'Media item not found' });
  if (access.status === 403) return res.status(403).json({ error: 'Not authorized to edit this media item' });

  const previousPath = access.row?.signed_proof_path || null;
  const stored = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
  const updated = await pool.query(
    `UPDATE media
     SET signed_proof_path = $1
     WHERE id = $2
     RETURNING id, library_id, space_id, signed_by, signed_role, signed_on, signed_at, signed_proof_path`,
    [stored.url, mediaId]
  );
  await syncMediaPrimarySignature(updated.rows[0], req.user.id);
  await logActivity(
    req,
    previousPath ? 'media.signing_proof.replace' : 'media.signing_proof.upload',
    'media',
    mediaId,
    { previousPath, nextPath: stored.url, provider: stored.provider }
  );
  res.json({
    id: updated.rows[0].id,
    signed_proof_path: updated.rows[0].signed_proof_path,
    provider: stored.provider
  });
}));

router.delete('/:id/signing-proof', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return res.status(400).json({ error: 'Invalid media id' });
  }

  const access = await resolveEditableMediaForUser({ req, mediaId, scopeContext });
  if (access.status === 404) return res.status(404).json({ error: 'Media item not found' });
  if (access.status === 403) return res.status(403).json({ error: 'Not authorized to edit this media item' });

  const previousPath = access.row?.signed_proof_path || null;
  if (!previousPath) {
    return res.json({ ok: true, removed: false });
  }
  const updated = await pool.query(
    `UPDATE media
     SET signed_proof_path = NULL
     WHERE id = $1
     RETURNING id, library_id, space_id, signed_by, signed_role, signed_on, signed_at, signed_proof_path`,
    [mediaId]
  );
  await syncMediaPrimarySignature(updated.rows[0], req.user.id);
  await logActivity(req, 'media.signing_proof.remove', 'media', mediaId, { previousPath });
  res.json({ ok: true, removed: true, signed_proof_path: null });
}));

// ── CSV import ────────────────────────────────────────────────────────────────

router.get('/import/template-csv', asyncHandler(async (_req, res) => {
  const template = [
    'title,media_type,year,owned_formats,format,director,cast,genre,rating,user_rating,runtime,upc,isbn,ean_upc,asin,signed_by,signed_role,signed_on,signed_at,signed_proof_path,location,notes',
    '"The Matrix","movie",1999,"dvd|bluray|digital","Blu-ray","Lana Wachowski, Lilly Wachowski","Keanu Reeves, Laurence Fishburne","Science Fiction",8.7,4.5,136,085391163545,,,,,,,,"Living Room","Example row"',
    '"Wool","book",2012,"paperback|digital","Paperback","Hugh Howey","Science Fiction",,4.5,,,9781476735402,,,Hugh Howey,author,2024-06-12,"Salt Lake City","Identifier-first matching example"'
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="collectz-template.csv"');
  res.send(template);
}));

router.post('/import-csv', tempUpload.single('file'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const valuationMode = resolveValuationExecutionMode(req);
  if (!req.file) {
    return res.status(400).json({ error: 'CSV file is required (multipart field: file)' });
  }
  let text = '';
  try {
    text = await fs.promises.readFile(req.file.path, 'utf8');
  } finally {
    await fs.promises.unlink(req.file.path).catch(() => {});
  }

  let parsed;
  try {
    parsed = parseCsvText(text);
  } catch (error) {
    return res.status(400).json({ error: `Invalid CSV format: ${error.message}` });
  }
  const { headers, rows } = parsed;
  if (headers.length === 0) {
    return res.status(400).json({ error: 'CSV is empty' });
  }
  const canonical = headers.map((h) => String(h).trim().toLowerCase());
  if (!canonical.includes('title')) {
    return res.status(400).json({ error: 'CSV must include a title column' });
  }
  const asyncMode = shouldQueueImportByDefault(req);
  const auditReq = {
    user: req.user,
    headers: req.headers,
    ip: req.ip,
    socket: req.socket
  };

  if (asyncMode) {
    const job = await createSyncJob({
      userId: req.user.id,
      jobType: 'media_import',
      provider: 'csv_generic',
      scope: jobScopePayload(scopeContext),
      progress: {
        total: rows.length,
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errorCount: 0
      }
    });
    recordImportJobEvent('csv_generic', 'queued');

    setImmediate(async () => {
      try {
        await updateSyncJob(job.id, { status: 'running', started_at: new Date() });
        const result = await runGenericCsvImport({
          rows,
          userId: req.user.id,
          scopeContext,
          onProgress: async (progress) => updateSyncJob(job.id, { progress }),
          reviewContext: { jobId: job.id, provider: 'csv_generic', auditReq }
        });
        const valuationRefresh = await queueImportedValuationRefresh({
          mediaIds: result.createdMediaIds,
          userId: req.user.id,
          scopeContext,
          mode: valuationMode,
          auditReq,
          importSource: 'csv_generic'
        });
        await updateSyncJob(job.id, {
          status: 'succeeded',
          progress: {
            total: result.rows,
            processed: result.rows,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped: result.summary.skipped_invalid,
            errorCount: result.summary.errors.length
          },
          summary: {
            rows: result.rows,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped_invalid: result.summary.skipped_invalid,
            errorCount: result.summary.errors.length,
            matchModes: result.summary.matchModes,
            enrichment: result.summary.enrichment,
            diagnosticsFlagged: result.summary.diagnosticsFlagged,
            normalizationReviewCandidates: result.summary.normalizationReviewCandidates || 0,
            normalizationReviewRows: result.summary.normalizationReviewRows || 0,
            valuationRefresh,
            collectionsDetected: result.summary.collectionsDetected || 0,
            collectionsCreated: result.summary.collectionsCreated || 0,
            collectionItemsSeeded: result.summary.collectionItemsSeeded || 0,
            auditRows: result.auditRows
          },
          finished_at: new Date()
        });
        recordImportJobEvent('csv_generic', 'succeeded');
        recordImportEnrichmentSummaryMetrics('csv_generic', result.summary.enrichment);
        await logActivity(auditReq, 'media.import.csv', 'media', null, {
          rows: result.rows,
          created: result.summary.created,
          updated: result.summary.updated,
          skipped_invalid: result.summary.skipped_invalid,
          errorCount: result.summary.errors.length,
          matchModes: result.summary.matchModes,
          enrichment: result.summary.enrichment,
          diagnosticsFlagged: result.summary.diagnosticsFlagged,
          normalizationReviewCandidates: result.summary.normalizationReviewCandidates || 0,
          normalizationReviewRows: result.summary.normalizationReviewRows || 0,
          valuationRefresh,
          collectionsDetected: result.summary.collectionsDetected || 0,
          collectionsCreated: result.summary.collectionsCreated || 0,
          collectionItemsSeeded: result.summary.collectionItemsSeeded || 0,
          jobId: job.id
        });
      } catch (error) {
        recordImportJobEvent('csv_generic', 'failed');
        await updateSyncJob(job.id, {
          status: 'failed',
          error: error.message || 'CSV import failed',
          finished_at: new Date()
        });
        await logActivity(auditReq, 'media.import.csv.failed', 'media', null, {
          detail: error.message || 'CSV import failed',
          jobId: job.id
        });
      }
    });

    return res.status(202).json(buildQueuedJobResponse(job, 'csv_generic'));
  }

  const result = await runGenericCsvImport({
    rows,
    userId: req.user.id,
    scopeContext,
    reviewContext: { provider: 'csv_generic', auditReq: req }
  });
  const valuationRefresh = await queueImportedValuationRefresh({
    mediaIds: result.createdMediaIds,
    userId: req.user.id,
    scopeContext,
    mode: valuationMode,
    auditReq: req,
    importSource: 'csv_generic'
  });
  recordImportJobEvent('csv_generic', 'succeeded');
  recordImportEnrichmentSummaryMetrics('csv_generic', result.summary.enrichment);
  await logActivity(req, 'media.import.csv', 'media', null, {
    rows: result.rows,
    created: result.summary.created,
    updated: result.summary.updated,
    skipped_invalid: result.summary.skipped_invalid,
    errorCount: result.summary.errors.length,
    matchModes: result.summary.matchModes,
    enrichment: result.summary.enrichment,
    diagnosticsFlagged: result.summary.diagnosticsFlagged,
    normalizationReviewCandidates: result.summary.normalizationReviewCandidates || 0,
    normalizationReviewRows: result.summary.normalizationReviewRows || 0,
    valuationRefresh,
    collectionsDetected: result.summary.collectionsDetected || 0,
    collectionsCreated: result.summary.collectionsCreated || 0,
    collectionItemsSeeded: result.summary.collectionItemsSeeded || 0
  });
  res.json({ ok: true, rows: result.rows, summary: result.summary, auditRows: result.auditRows, valuationRefresh });
}));

router.post('/import-csv/calibre', tempUpload.single('file'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const valuationMode = resolveValuationExecutionMode(req);
  if (!req.file) {
    return res.status(400).json({ error: 'Calibre CSV file is required (multipart field: file)' });
  }
  let text = '';
  try {
    text = await fs.promises.readFile(req.file.path, 'utf8');
  } finally {
    await fs.promises.unlink(req.file.path).catch(() => {});
  }

  let parsed;
  try {
    parsed = parseCsvText(text);
  } catch (error) {
    return res.status(400).json({ error: `Invalid CSV format: ${error.message}` });
  }
  const { rows } = parsed;
  const mappedRows = normalizeCalibreRows(rows);
  const asyncMode = shouldQueueImportByDefault(req);
  const auditReq = {
    user: req.user,
    headers: req.headers,
    ip: req.ip,
    socket: req.socket
  };

  if (asyncMode) {
    const job = await createSyncJob({
      userId: req.user.id,
      jobType: 'media_import',
      provider: 'csv_calibre',
      scope: jobScopePayload(scopeContext),
      progress: {
        total: mappedRows.length,
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errorCount: 0
      }
    });

    setImmediate(async () => {
      try {
        await updateSyncJob(job.id, { status: 'running', started_at: new Date() });
        const result = await runGenericCsvImport({
          rows: mappedRows,
          userId: req.user.id,
          scopeContext,
          onProgress: async (progress) => updateSyncJob(job.id, { progress }),
          importSource: 'csv_calibre',
          reviewContext: { jobId: job.id, provider: 'csv_calibre', auditReq }
        });
        const valuationRefresh = await queueImportedValuationRefresh({
          mediaIds: result.createdMediaIds,
          userId: req.user.id,
          scopeContext,
          mode: valuationMode,
          auditReq,
          importSource: 'csv_calibre'
        });
        await updateSyncJob(job.id, {
          status: 'succeeded',
          progress: {
            total: result.rows,
            processed: result.rows,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped: result.summary.skipped_invalid,
            errorCount: result.summary.errors.length
          },
          summary: {
            rows: result.rows,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped_invalid: result.summary.skipped_invalid,
            errorCount: result.summary.errors.length,
            matchModes: result.summary.matchModes,
            enrichment: result.summary.enrichment,
            diagnosticsFlagged: result.summary.diagnosticsFlagged,
            normalizationReviewCandidates: result.summary.normalizationReviewCandidates || 0,
            normalizationReviewRows: result.summary.normalizationReviewRows || 0,
            valuationRefresh,
            collectionsDetected: result.summary.collectionsDetected || 0,
            collectionsCreated: result.summary.collectionsCreated || 0,
            collectionItemsSeeded: result.summary.collectionItemsSeeded || 0,
            auditRows: result.auditRows
          },
          finished_at: new Date()
        });
        recordImportJobEvent('csv_calibre', 'succeeded');
        recordImportEnrichmentSummaryMetrics('csv_calibre', result.summary.enrichment);
        await logActivity(auditReq, 'media.import.calibre', 'media', null, {
          rows: result.rows,
          created: result.summary.created,
          updated: result.summary.updated,
          skipped_invalid: result.summary.skipped_invalid,
          errorCount: result.summary.errors.length,
          matchModes: result.summary.matchModes,
          enrichment: result.summary.enrichment,
          diagnosticsFlagged: result.summary.diagnosticsFlagged,
          normalizationReviewCandidates: result.summary.normalizationReviewCandidates || 0,
          normalizationReviewRows: result.summary.normalizationReviewRows || 0,
          valuationRefresh,
          collectionsDetected: result.summary.collectionsDetected || 0,
          collectionsCreated: result.summary.collectionsCreated || 0,
          collectionItemsSeeded: result.summary.collectionItemsSeeded || 0,
          jobId: job.id
        });
      } catch (error) {
        recordImportJobEvent('csv_calibre', 'failed');
        await updateSyncJob(job.id, {
          status: 'failed',
          error: error.message || 'Calibre import failed',
          finished_at: new Date()
        });
        await logActivity(auditReq, 'media.import.calibre.failed', 'media', null, {
          detail: error.message || 'Calibre import failed',
          jobId: job.id
        });
      }
    });

    recordImportJobEvent('csv_calibre', 'queued');
    return res.status(202).json(buildQueuedJobResponse(job, 'csv_calibre'));
  }

  const result = await runGenericCsvImport({
    rows: mappedRows,
    userId: req.user.id,
    scopeContext,
    importSource: 'csv_calibre',
    reviewContext: { provider: 'csv_calibre', auditReq: req }
  });
  const valuationRefresh = await queueImportedValuationRefresh({
    mediaIds: result.createdMediaIds,
    userId: req.user.id,
    scopeContext,
    mode: valuationMode,
    auditReq: req,
    importSource: 'csv_calibre'
  });
  recordImportJobEvent('csv_calibre', 'succeeded');
  recordImportEnrichmentSummaryMetrics('csv_calibre', result.summary.enrichment);
  await logActivity(req, 'media.import.calibre', 'media', null, {
    rows: result.rows,
    created: result.summary.created,
    updated: result.summary.updated,
    skipped_invalid: result.summary.skipped_invalid,
    errorCount: result.summary.errors.length,
    matchModes: result.summary.matchModes,
    enrichment: result.summary.enrichment,
    diagnosticsFlagged: result.summary.diagnosticsFlagged,
    normalizationReviewCandidates: result.summary.normalizationReviewCandidates || 0,
    normalizationReviewRows: result.summary.normalizationReviewRows || 0,
    valuationRefresh,
    collectionsDetected: result.summary.collectionsDetected || 0,
    collectionsCreated: result.summary.collectionsCreated || 0,
    collectionItemsSeeded: result.summary.collectionItemsSeeded || 0
  });
  res.json({ ok: true, rows: result.rows, summary: result.summary, auditRows: result.auditRows, valuationRefresh });
}));

router.post('/import-cwa', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const valuationMode = resolveValuationExecutionMode(req);
  const config = await loadScopedIntegrationConfig(scopeContext?.spaceId || null);
  const maxPagesRaw = Number(req.body?.maxPages ?? req.query?.maxPages);
  const maxPages = Number.isFinite(maxPagesRaw) ? Math.max(1, Math.min(100, maxPagesRaw)) : undefined;
  const asyncMode = shouldQueueImportByDefault(req);
  const auditReq = {
    user: req.user,
    headers: req.headers,
    ip: req.ip,
    socket: req.socket
  };

  const runImport = async ({ onProgress = null, reviewContext = null } = {}) => {
    const fetched = await fetchCwaOpdsItems(config, { maxPages });
    const result = await runGenericCsvImport({
      rows: fetched.rows,
      userId: req.user.id,
      scopeContext,
      onProgress,
      importSource: 'cwa_opds',
      reviewContext
    });
    const valuationRefresh = await queueImportedValuationRefresh({
      mediaIds: result.createdMediaIds,
      userId: req.user.id,
      scopeContext,
      mode: valuationMode,
      auditReq: reviewContext?.auditReq || req,
      importSource: 'cwa_opds'
    });
    return { fetched, result, valuationRefresh };
  };

  if (asyncMode) {
    const job = await createSyncJob({
      userId: req.user.id,
      jobType: 'media_import',
      provider: 'cwa_opds',
      scope: jobScopePayload(scopeContext),
      progress: {
        total: 0,
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errorCount: 0
      }
    });
    recordImportJobEvent('cwa_opds', 'queued');

    setImmediate(async () => {
      try {
        await updateSyncJob(job.id, { status: 'running', started_at: new Date() });
        const { fetched, result, valuationRefresh } = await runImport({
          onProgress: async (progress) => updateSyncJob(job.id, { progress }),
          reviewContext: { jobId: job.id, provider: 'cwa_opds', auditReq }
        });
        await updateSyncJob(job.id, {
          status: 'succeeded',
          progress: {
            total: result.rows,
            processed: result.rows,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped: result.summary.skipped_invalid + result.summary.skipped_collection,
            errorCount: result.summary.errors.length
          },
          summary: {
            rows: result.rows,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped_invalid: result.summary.skipped_invalid,
            skipped_collection: result.summary.skipped_collection,
            errorCount: result.summary.errors.length,
            matchModes: result.summary.matchModes,
            enrichment: result.summary.enrichment,
            diagnosticsFlagged: result.summary.diagnosticsFlagged,
            normalizationReviewCandidates: result.summary.normalizationReviewCandidates || 0,
            normalizationReviewRows: result.summary.normalizationReviewRows || 0,
            valuationRefresh,
            pagesFetched: fetched.pagesFetched,
            endpoint: fetched.endpoint,
            hasMore: Boolean(fetched.hasMore),
            subsectionDiscovered: fetched.subsectionDiscovered || 0,
            navigationEntriesSkipped: fetched.navigationEntriesSkipped || 0,
            auditRows: result.auditRows
          },
          finished_at: new Date()
        });
        recordImportJobEvent('cwa_opds', 'succeeded');
        recordImportEnrichmentSummaryMetrics('cwa_opds', result.summary.enrichment);
        await logActivity(auditReq, 'media.import.cwa', 'media', null, {
          rows: result.rows,
          created: result.summary.created,
          updated: result.summary.updated,
          skipped_invalid: result.summary.skipped_invalid,
          skipped_collection: result.summary.skipped_collection,
          errorCount: result.summary.errors.length,
          matchModes: result.summary.matchModes,
          enrichment: result.summary.enrichment,
          diagnosticsFlagged: result.summary.diagnosticsFlagged,
          normalizationReviewCandidates: result.summary.normalizationReviewCandidates || 0,
          normalizationReviewRows: result.summary.normalizationReviewRows || 0,
          valuationRefresh,
          pagesFetched: fetched.pagesFetched,
          endpoint: fetched.endpoint,
          hasMore: Boolean(fetched.hasMore),
          subsectionDiscovered: fetched.subsectionDiscovered || 0,
          navigationEntriesSkipped: fetched.navigationEntriesSkipped || 0,
          jobId: job.id
        });
      } catch (error) {
        recordImportJobEvent('cwa_opds', 'failed');
        await updateSyncJob(job.id, {
          status: 'failed',
          error: error.message || 'CWA OPDS import failed',
          finished_at: new Date()
        });
        await logActivity(auditReq, 'media.import.cwa.failed', 'media', null, {
          detail: error.message || 'CWA OPDS import failed',
          jobId: job.id
        });
      }
    });

    return res.status(202).json(buildQueuedJobResponse(job, 'cwa_opds'));
  }

  const { fetched, result, valuationRefresh } = await runImport({
    reviewContext: { provider: 'cwa_opds', auditReq: req }
  });
  recordImportJobEvent('cwa_opds', 'succeeded');
  recordImportEnrichmentSummaryMetrics('cwa_opds', result.summary.enrichment);
  await logActivity(req, 'media.import.cwa', 'media', null, {
    rows: result.rows,
    created: result.summary.created,
    updated: result.summary.updated,
    skipped_invalid: result.summary.skipped_invalid,
    skipped_collection: result.summary.skipped_collection,
    errorCount: result.summary.errors.length,
    matchModes: result.summary.matchModes,
    enrichment: result.summary.enrichment,
    diagnosticsFlagged: result.summary.diagnosticsFlagged,
    normalizationReviewCandidates: result.summary.normalizationReviewCandidates || 0,
    normalizationReviewRows: result.summary.normalizationReviewRows || 0,
    valuationRefresh,
    pagesFetched: fetched.pagesFetched,
    endpoint: fetched.endpoint,
    hasMore: Boolean(fetched.hasMore),
    subsectionDiscovered: fetched.subsectionDiscovered || 0,
    navigationEntriesSkipped: fetched.navigationEntriesSkipped || 0
  });
  res.json({
    ok: true,
    rows: result.rows,
    summary: {
      ...result.summary,
      pagesFetched: fetched.pagesFetched,
      endpoint: fetched.endpoint,
      hasMore: Boolean(fetched.hasMore),
      subsectionDiscovered: fetched.subsectionDiscovered || 0,
      navigationEntriesSkipped: fetched.navigationEntriesSkipped || 0
    },
    auditRows: result.auditRows,
    valuationRefresh
  });
}));

router.post('/import-kavita', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const valuationMode = resolveValuationExecutionMode(req);
  const scopedConfig = await loadScopedIntegrationConfig(scopeContext?.spaceId || null);
  const config = scopedConfig?.kavitaBaseUrl && scopedConfig?.kavitaApiKey
    ? scopedConfig
    : await loadAdminIntegrationConfig();
  const maxPagesRaw = Number(req.body?.maxPages ?? req.query?.maxPages);
  const pageSizeRaw = Number(req.body?.pageSize ?? req.query?.pageSize);
  const maxPages = Number.isFinite(maxPagesRaw) ? Math.max(1, Math.min(100, maxPagesRaw)) : undefined;
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.max(1, Math.min(500, pageSizeRaw)) : undefined;
  const asyncMode = shouldQueueImportByDefault(req);
  const auditReq = {
    user: req.user,
    headers: req.headers,
    ip: req.ip,
    socket: req.socket
  };

  const runImport = async ({ onProgress = null, reviewContext = null } = {}) => {
    const fetched = await fetchKavitaImportItems(config, { maxPages, pageSize });
    const result = await runGenericCsvImport({
      rows: fetched.rows,
      userId: req.user.id,
      scopeContext,
      onProgress,
      importSource: 'kavita',
      reviewContext
    });
    const valuationRefresh = await queueImportedValuationRefresh({
      mediaIds: result.createdMediaIds,
      userId: req.user.id,
      scopeContext,
      mode: valuationMode,
      auditReq: reviewContext?.auditReq || req,
      importSource: 'kavita'
    });
    return { fetched, result, valuationRefresh };
  };

  if (asyncMode) {
    const job = await createSyncJob({
      userId: req.user.id,
      jobType: 'media_import',
      provider: 'kavita',
      scope: jobScopePayload(scopeContext),
      progress: {
        total: 0,
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errorCount: 0
      }
    });
    recordImportJobEvent('kavita', 'queued');

    setImmediate(async () => {
      try {
        await updateSyncJob(job.id, { status: 'running', started_at: new Date() });
        const { fetched, result, valuationRefresh } = await runImport({
          onProgress: async (progress) => updateSyncJob(job.id, { progress }),
          reviewContext: { jobId: job.id, provider: 'kavita', auditReq }
        });
        await updateSyncJob(job.id, {
          status: 'succeeded',
          progress: {
            total: result.rows,
            processed: result.rows,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped: result.summary.skipped_invalid + result.summary.skipped_collection,
            errorCount: result.summary.errors.length
          },
          summary: {
            rows: result.rows,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped_invalid: result.summary.skipped_invalid,
            skipped_collection: result.summary.skipped_collection,
            errorCount: result.summary.errors.length,
            matchModes: result.summary.matchModes,
            enrichment: result.summary.enrichment,
            diagnosticsFlagged: result.summary.diagnosticsFlagged,
            normalizationReviewCandidates: result.summary.normalizationReviewCandidates || 0,
            normalizationReviewRows: result.summary.normalizationReviewRows || 0,
            valuationRefresh,
            pagesFetched: fetched.pagesFetched,
            pageSize: fetched.pageSize,
            libraryCount: fetched.libraryCount,
            hasMore: Boolean(fetched.hasMore),
            auditRows: result.auditRows
          },
          finished_at: new Date()
        });
        recordImportJobEvent('kavita', 'succeeded');
        recordImportEnrichmentSummaryMetrics('kavita', result.summary.enrichment);
        await logActivity(auditReq, 'media.import.kavita', 'media', null, {
          rows: result.rows,
          created: result.summary.created,
          updated: result.summary.updated,
          skipped_invalid: result.summary.skipped_invalid,
          skipped_collection: result.summary.skipped_collection,
          errorCount: result.summary.errors.length,
          matchModes: result.summary.matchModes,
          enrichment: result.summary.enrichment,
          diagnosticsFlagged: result.summary.diagnosticsFlagged,
          normalizationReviewCandidates: result.summary.normalizationReviewCandidates || 0,
          normalizationReviewRows: result.summary.normalizationReviewRows || 0,
          valuationRefresh,
          pagesFetched: fetched.pagesFetched,
          pageSize: fetched.pageSize,
          libraryCount: fetched.libraryCount,
          hasMore: Boolean(fetched.hasMore),
          jobId: job.id
        });
      } catch (error) {
        recordImportJobEvent('kavita', 'failed');
        await updateSyncJob(job.id, {
          status: 'failed',
          error: error.message || 'Kavita import failed',
          finished_at: new Date()
        });
        await logActivity(auditReq, 'media.import.kavita.failed', 'media', null, {
          detail: error.message || 'Kavita import failed',
          jobId: job.id
        });
      }
    });

    return res.status(202).json(buildQueuedJobResponse(job, 'kavita'));
  }

  const { fetched, result, valuationRefresh } = await runImport({
    reviewContext: { provider: 'kavita', auditReq: req }
  });
  recordImportJobEvent('kavita', 'succeeded');
  recordImportEnrichmentSummaryMetrics('kavita', result.summary.enrichment);
  await logActivity(req, 'media.import.kavita', 'media', null, {
    rows: result.rows,
    created: result.summary.created,
    updated: result.summary.updated,
    skipped_invalid: result.summary.skipped_invalid,
    skipped_collection: result.summary.skipped_collection,
    errorCount: result.summary.errors.length,
    matchModes: result.summary.matchModes,
    enrichment: result.summary.enrichment,
    diagnosticsFlagged: result.summary.diagnosticsFlagged,
    normalizationReviewCandidates: result.summary.normalizationReviewCandidates || 0,
    normalizationReviewRows: result.summary.normalizationReviewRows || 0,
    valuationRefresh,
    pagesFetched: fetched.pagesFetched,
    pageSize: fetched.pageSize,
    libraryCount: fetched.libraryCount,
    hasMore: Boolean(fetched.hasMore)
  });
  res.json({
    ok: true,
    rows: result.rows,
    summary: {
      ...result.summary,
      pagesFetched: fetched.pagesFetched,
      pageSize: fetched.pageSize,
      libraryCount: fetched.libraryCount,
      hasMore: Boolean(fetched.hasMore)
    },
    auditRows: result.auditRows,
    valuationRefresh
  });
}));

router.post('/import-csv/delicious', tempUpload.single('file'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const valuationMode = resolveValuationExecutionMode(req);
  if (!req.file) {
    return res.status(400).json({ error: 'Delicious CSV file is required (multipart field: file)' });
  }
  let text = '';
  try {
    text = await fs.promises.readFile(req.file.path, 'utf8');
  } finally {
    await fs.promises.unlink(req.file.path).catch(() => {});
  }

  let parsed;
  try {
    parsed = parseCsvText(text);
  } catch (error) {
    return res.status(400).json({ error: `Invalid CSV format: ${error.message}` });
  }
  const { rows } = parsed;
  const asyncMode = shouldQueueImportByDefault(req);
  const auditReq = {
    user: req.user,
    headers: req.headers,
    ip: req.ip,
    socket: req.socket
  };

  if (asyncMode) {
    const job = await createSyncJob({
      userId: req.user.id,
      jobType: 'media_import',
      provider: 'csv_delicious',
      scope: jobScopePayload(scopeContext),
      progress: {
        total: rows.length,
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errorCount: 0
      }
    });

    setImmediate(async () => {
      try {
        await updateSyncJob(job.id, { status: 'running', started_at: new Date() });
        const result = await runDeliciousCsvImport({
          rows,
          userId: req.user.id,
          scopeContext,
          onProgress: async (progress) => updateSyncJob(job.id, { progress }),
          reviewContext: { jobId: job.id, provider: 'csv_delicious', auditReq }
        });
        const valuationRefresh = await queueImportedValuationRefresh({
          mediaIds: result.createdMediaIds,
          userId: req.user.id,
          scopeContext,
          mode: valuationMode,
          auditReq,
          importSource: 'csv_delicious'
        });
        await updateSyncJob(job.id, {
          status: 'succeeded',
          progress: {
            total: result.rows,
            processed: result.rows,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped: result.summary.skipped_invalid + result.summary.skipped_non_movie,
            errorCount: result.summary.errors.length
          },
          summary: {
            rows: result.rows,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped_non_movie: result.summary.skipped_non_movie,
            skipped_invalid: result.summary.skipped_invalid,
            errorCount: result.summary.errors.length,
            matchModes: result.summary.matchModes,
            enrichment: result.summary.enrichment,
            diagnosticsFlagged: result.summary.diagnosticsFlagged,
            valuationRefresh,
            collectionsDetected: result.summary.collectionsDetected || 0,
            collectionsCreated: result.summary.collectionsCreated || 0,
            collectionItemsSeeded: result.summary.collectionItemsSeeded || 0,
            auditRows: result.auditRows
          },
          finished_at: new Date()
        });
        recordImportJobEvent('csv_delicious', 'succeeded');
        recordImportEnrichmentSummaryMetrics('csv_delicious', result.summary.enrichment);
        await logActivity(auditReq, 'media.import.csv.delicious', 'media', null, {
          rows: result.rows,
          created: result.summary.created,
          updated: result.summary.updated,
          skipped_non_movie: result.summary.skipped_non_movie,
          skipped_invalid: result.summary.skipped_invalid,
          errorCount: result.summary.errors.length,
          matchModes: result.summary.matchModes,
          enrichment: result.summary.enrichment,
          diagnosticsFlagged: result.summary.diagnosticsFlagged,
          valuationRefresh,
          collectionsDetected: result.summary.collectionsDetected || 0,
          collectionsCreated: result.summary.collectionsCreated || 0,
          collectionItemsSeeded: result.summary.collectionItemsSeeded || 0,
          jobId: job.id
        });
      } catch (error) {
        recordImportJobEvent('csv_delicious', 'failed');
        await updateSyncJob(job.id, {
          status: 'failed',
          error: error.message || 'Delicious CSV import failed',
          finished_at: new Date()
        });
        await logActivity(auditReq, 'media.import.csv.delicious.failed', 'media', null, {
          detail: error.message || 'Delicious CSV import failed',
          jobId: job.id
        });
      }
    });

    recordImportJobEvent('csv_delicious', 'queued');
    return res.status(202).json(buildQueuedJobResponse(job, 'csv_delicious'));
  }

  const result = await runDeliciousCsvImport({
    rows,
    userId: req.user.id,
    scopeContext,
    reviewContext: { provider: 'csv_delicious', auditReq: req }
  });
  const valuationRefresh = await queueImportedValuationRefresh({
    mediaIds: result.createdMediaIds,
    userId: req.user.id,
    scopeContext,
    mode: valuationMode,
    auditReq: req,
    importSource: 'csv_delicious'
  });
  recordImportJobEvent('csv_delicious', 'succeeded');
  recordImportEnrichmentSummaryMetrics('csv_delicious', result.summary.enrichment);
  await logActivity(req, 'media.import.csv.delicious', 'media', null, {
    rows: result.rows,
    created: result.summary.created,
    updated: result.summary.updated,
    skipped_non_movie: result.summary.skipped_non_movie,
    skipped_invalid: result.summary.skipped_invalid,
    errorCount: result.summary.errors.length,
    matchModes: result.summary.matchModes,
    enrichment: result.summary.enrichment,
    diagnosticsFlagged: result.summary.diagnosticsFlagged,
    valuationRefresh,
    collectionsDetected: result.summary.collectionsDetected || 0,
    collectionsCreated: result.summary.collectionsCreated || 0,
    collectionItemsSeeded: result.summary.collectionItemsSeeded || 0
  });
  res.json({ ok: true, rows: result.rows, summary: result.summary, auditRows: result.auditRows, valuationRefresh });
}));

// ── Plex import (admin only) ─────────────────────────────────────────────────

router.post('/import-plex', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const valuationMode = resolveValuationExecutionMode(req);
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can import from Plex' });
  }
  const ensuredScope = scopeContext?.libraryId
    ? { spaceId: scopeContext?.spaceId || null, libraryId: scopeContext.libraryId }
    : await ensureUserDefaultScope(req.user.id);
  const ensuredLibraryId = ensuredScope.libraryId;
  const effectiveScopeContext = {
    ...scopeContext,
    spaceId: scopeContext?.spaceId ?? ensuredScope.spaceId ?? null,
    libraryId: ensuredLibraryId || null
  };
  if (!effectiveScopeContext.libraryId) {
    return res.status(400).json({ error: 'Active library is required before Plex import' });
  }

  const sectionIds = Array.isArray(req.body?.sectionIds) ? req.body.sectionIds : [];
  const config = await loadScopedIntegrationConfig(effectiveScopeContext.spaceId || null);
  if (!config.plexApiUrl) {
    return res.status(400).json({ error: 'Plex API URL is not configured' });
  }
  if (!config.plexApiKey) {
    return res.status(400).json({ error: 'Plex API key is not configured' });
  }
  const asyncMode = shouldQueueImportByDefault(req);
  const auditReq = {
    user: req.user,
    headers: req.headers,
    ip: req.ip,
    socket: req.socket
  };

  if (asyncMode) {
    const job = await createSyncJob({
      userId: req.user.id,
      jobType: 'media_import',
      provider: 'plex',
      scope: jobScopePayload(effectiveScopeContext, sectionIds),
      progress: {
        total: 0,
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errorCount: 0
      }
    });

    setImmediate(async () => {
      try {
        await updateSyncJob(job.id, {
          status: 'running',
          started_at: new Date()
        });
        const result = await runPlexImport({
          req: auditReq,
          config,
          sectionIds,
          scopeContext: effectiveScopeContext,
          onProgress: async (progress) => {
            await updateSyncJob(job.id, { progress });
          }
        });
        const valuationRefresh = await queueImportedValuationRefresh({
          mediaIds: result.createdMediaIds,
          userId: req.user.id,
          scopeContext: effectiveScopeContext,
          mode: valuationMode,
          auditReq,
          importSource: 'plex'
        });

        await updateSyncJob(job.id, {
          status: 'succeeded',
          summary: {
            imported: result.imported,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped: result.summary.skipped,
            errorCount: result.summary.errors.length,
            tmdbPosterEnriched: result.tmdbPosterEnriched,
            tmdbPosterLookupMisses: result.tmdbPosterLookupMisses,
            tmdbPosterLookupNoMatch: result.tmdbPosterLookupNoMatch,
            tmdbPosterLookupNoImage: result.tmdbPosterLookupNoImage,
            variantsCreated: result.variantsCreated,
            variantsUpdated: result.variantsUpdated,
            seasonsCreated: result.seasonsCreated,
            seasonsUpdated: result.seasonsUpdated,
            valuationRefresh,
            enrichmentErrors: result.summary.enrichmentErrors || [],
            enrichmentMisses: result.summary.enrichmentMisses || [],
            tmdbPosterLookupMissSamples: result.summary.tmdbPosterLookupMissSamples || [],
            errorsSample: (result.summary.errors || []).slice(0, 50)
          },
          progress: {
            total: result.imported,
            processed: result.imported,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped: result.summary.skipped,
            errorCount: result.summary.errors.length
          },
          finished_at: new Date()
        });
        recordImportJobEvent('plex', 'succeeded');
        recordPlexEnrichmentMetrics(result);

        await logActivity(auditReq, 'media.import.plex', 'media', null, {
          sectionIds,
          imported: result.imported,
          created: result.summary.created,
          updated: result.summary.updated,
          skipped: result.summary.skipped,
          errorCount: result.summary.errors.length,
          tmdbPosterEnriched: result.tmdbPosterEnriched,
          tmdbPosterLookupMisses: result.tmdbPosterLookupMisses,
          tmdbPosterLookupNoMatch: result.tmdbPosterLookupNoMatch,
          tmdbPosterLookupNoImage: result.tmdbPosterLookupNoImage,
          variantsCreated: result.variantsCreated,
          variantsUpdated: result.variantsUpdated,
          seasonsCreated: result.seasonsCreated,
          seasonsUpdated: result.seasonsUpdated,
          valuationRefresh,
          enrichmentErrorCount: (result.summary.enrichmentErrors || []).length,
          enrichmentMissCount: (result.summary.enrichmentMisses || []).length,
          jobId: job.id
        });
      } catch (error) {
        logError('Plex async import failed', error);
        recordImportJobEvent('plex', 'failed');
        await updateSyncJob(job.id, {
          status: 'failed',
          error: error.message || 'Plex import failed',
          finished_at: new Date()
        });
        await logActivity(auditReq, 'media.import.plex.failed', 'media', null, {
          sectionIds,
          detail: error.message || 'Plex import failed',
          jobId: job.id
        });
      }
    });

    return res.status(202).json(buildQueuedJobResponse(job, 'plex'));
  }

  try {
    const result = await runPlexImport({
      req,
      config,
      sectionIds,
      scopeContext: effectiveScopeContext
    });
    const valuationRefresh = await queueImportedValuationRefresh({
      mediaIds: result.createdMediaIds,
      userId: req.user.id,
      scopeContext: effectiveScopeContext,
      mode: valuationMode,
      auditReq: req,
      importSource: 'plex'
    });

    await logActivity(req, 'media.import.plex', 'media', null, {
      sectionIds,
      imported: result.imported,
      created: result.summary.created,
      updated: result.summary.updated,
      skipped: result.summary.skipped,
      errorCount: result.summary.errors.length,
      tmdbPosterEnriched: result.tmdbPosterEnriched,
      tmdbPosterLookupMisses: result.tmdbPosterLookupMisses,
      variantsCreated: result.variantsCreated,
      variantsUpdated: result.variantsUpdated,
      seasonsCreated: result.seasonsCreated,
      seasonsUpdated: result.seasonsUpdated,
      valuationRefresh,
      enrichmentErrorCount: (result.summary.enrichmentErrors || []).length
    });
    recordImportJobEvent('plex', 'succeeded');
    recordPlexEnrichmentMetrics(result);

    return res.json({ ok: true, ...result, valuationRefresh });
  } catch (error) {
    logError('Plex import fetch failed', error);
    recordImportJobEvent('plex', 'failed');
    await logActivity(req, 'media.import.plex.failed', 'media', null, {
      sectionIds,
      detail: error.message || 'Plex import failed'
    });
    return res.status(502).json({ error: error.message || 'Plex import failed' });
  }
}));

router.post('/import-comics', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const valuationMode = resolveValuationExecutionMode(req);
  const useAsync = shouldQueueImportByDefault(req);
  const config = await loadScopedIntegrationConfig(scopeContext?.spaceId || null);
  if (String(config.comicsProvider || '').toLowerCase() !== 'metron') {
    return res.status(400).json({ error: 'Comics provider must be set to Metron for collection import' });
  }
  if (!config.comicsApiUrl) {
    return res.status(400).json({ error: 'Metron API URL is not configured' });
  }
  if (!config.comicsApiKey) {
    return res.status(400).json({ error: 'Metron password/token is not configured' });
  }

  if (useAsync) {
    const job = await createSyncJob({
      userId: req.user.id,
      jobType: 'import',
      provider: 'metron',
      scope: jobScopePayload(scopeContext),
      progress: { total: 0, processed: 0, created: 0, updated: 0, skipped: 0, errorCount: 0 }
    });
    recordImportJobEvent('metron', 'queued');

    process.nextTick(async () => {
      const auditReq = { ...req, user: req.user };
      try {
        await updateSyncJob(job.id, { status: 'running', started_at: new Date() });
        const result = await runMetronImport({
          req: auditReq,
          config,
          scopeContext,
          onProgress: async (progress) => updateSyncJob(job.id, { progress })
        });
        const valuationRefresh = await queueImportedValuationRefresh({
          mediaIds: result.createdMediaIds,
          userId: req.user.id,
          scopeContext,
          mode: valuationMode,
          auditReq,
          importSource: 'metron'
        });
        await updateSyncJob(job.id, {
          status: 'succeeded',
          finished_at: new Date(),
          summary: {
            imported: result.imported,
            totalAvailable: result.totalAvailable || result.imported,
            skipped_existing: result.summary.skipped_existing || 0,
            created: result.summary.created,
            updated: result.summary.updated,
            valuationRefresh,
            skipped: result.summary.skipped,
            errorCount: result.summary.errors.length,
            collectionEndpoint: result.collectionEndpoint
          },
          progress: {
            total: result.totalAvailable || result.imported,
            processed: result.totalAvailable || result.imported,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped: (result.summary.skipped || 0) + (result.summary.skipped_existing || 0),
            errorCount: result.summary.errors.length
          }
        });
        recordImportJobEvent('metron', 'succeeded');
        await logActivity(auditReq, 'media.import.metron', 'media', null, {
          imported: result.imported,
          totalAvailable: result.totalAvailable || result.imported,
          skipped_existing: result.summary.skipped_existing || 0,
          created: result.summary.created,
          updated: result.summary.updated,
          valuationRefresh,
          skipped: result.summary.skipped,
          errorCount: result.summary.errors.length,
          collectionEndpoint: result.collectionEndpoint,
          jobId: job.id
        });
      } catch (error) {
        logError('Metron import failed', error);
        recordImportJobEvent('metron', 'failed');
        await updateSyncJob(job.id, {
          status: 'failed',
          finished_at: new Date(),
          error: error.message || 'Metron import failed'
        });
        await logActivity(auditReq, 'media.import.metron.failed', 'media', null, {
          detail: error.message || 'Metron import failed',
          jobId: job.id
        });
      }
    });

    return res.status(202).json(buildQueuedJobResponse(job, 'metron'));
  }

  try {
    const result = await runMetronImport({ req, config, scopeContext });
    const valuationRefresh = await queueImportedValuationRefresh({
      mediaIds: result.createdMediaIds,
      userId: req.user.id,
      scopeContext,
      mode: valuationMode,
      auditReq: req,
      importSource: 'metron'
    });
    await logActivity(req, 'media.import.metron', 'media', null, {
      imported: result.imported,
      totalAvailable: result.totalAvailable || result.imported,
      skipped_existing: result.summary.skipped_existing || 0,
      created: result.summary.created,
      updated: result.summary.updated,
      valuationRefresh,
      skipped: result.summary.skipped,
      errorCount: result.summary.errors.length,
      collectionEndpoint: result.collectionEndpoint
    });
    recordImportJobEvent('metron', 'succeeded');
    return res.json({ ok: true, ...result, valuationRefresh });
  } catch (error) {
    logError('Metron import failed', error);
    recordImportJobEvent('metron', 'failed');
    await logActivity(req, 'media.import.metron.failed', 'media', null, {
      detail: error.message || 'Metron import failed'
    });
    return res.status(502).json({ error: error.message || 'Metron import failed' });
  }
}));

router.get('/sync-jobs', asyncHandler(async (req, res) => {
  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
  const params = [limit];
  let where = '';
  if (req.user.role !== 'admin') {
    params.push(req.user.id);
    where = `WHERE created_by = $${params.length}`;
  } else if (Number.isFinite(Number(req.query?.created_by))) {
    params.push(Number(req.query.created_by));
    where = `WHERE created_by = $${params.length}`;
  }

  const result = await pool.query(
    `SELECT id, job_type, provider, status, created_by, scope, progress, summary, error,
            started_at, finished_at, created_at, updated_at
     FROM sync_jobs
     ${where}
     ORDER BY created_at DESC
     LIMIT $1`,
    params
  );
  res.json(result.rows.map((job) => formatSyncJob(job)));
}));

router.get('/sync-jobs/:id', asyncHandler(async (req, res) => {
  const jobId = Number(req.params.id);
  if (!Number.isFinite(jobId) || jobId <= 0) {
    return res.status(400).json({ error: 'Invalid job id' });
  }
  const job = await getSyncJob(jobId, req.user);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(formatSyncJob(job));
}));

router.get('/sync-jobs/:id/result', asyncHandler(async (req, res) => {
  const jobId = Number(req.params.id);
  if (!Number.isFinite(jobId) || jobId <= 0) {
    return res.status(400).json({ error: 'Invalid job id' });
  }
  const job = await getSyncJob(jobId, req.user);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(formatSyncJob(job, { includeFullSummary: true }));
}));

router.get('/collections', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const pageRaw = Number(req.query?.page);
  const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
  const search = String(req.query?.search || '').trim();
  const mediaType = req.query?.media_type ? normalizeMediaType(req.query.media_type, '') : '';

  const params = [];
  let where = 'WHERE 1=1';
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (c.name ILIKE $${params.length} OR COALESCE(c.source_title, '') ILIKE $${params.length})`;
  }
  if (mediaType) {
    params.push(mediaType);
    where += ` AND COALESCE(c.media_type, '') = $${params.length}`;
  }
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'c.space_id',
    libraryColumn: 'c.library_id'
  });
  const whereWithScope = `${where} ${scopeClause}`;
  const offset = (page - 1) * limit;

  const count = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM collections c
     ${whereWithScope}`,
    params
  );
  params.push(limit);
  params.push(offset);
  const rows = await pool.query(
    `SELECT
       c.id, c.name, c.media_type, c.source_title, c.import_source, c.expected_item_count,
       c.library_id, c.space_id, c.created_by, c.created_at, c.updated_at,
       rep.poster_path,
       COALESCE(fmt.has_digital, false) AS has_digital,
       COUNT(ci.id)::int AS item_count,
       COUNT(ci.id) FILTER (WHERE ci.media_id IS NOT NULL)::int AS linked_item_count
     FROM collections c
     LEFT JOIN collection_items ci ON ci.collection_id = c.id
     LEFT JOIN LATERAL (
       SELECT m.poster_path
       FROM collection_items ci_rep
       JOIN media m ON m.id = ci_rep.media_id
       WHERE ci_rep.collection_id = c.id
         AND COALESCE(m.poster_path, '') <> ''
       ORDER BY COALESCE(ci_rep.position, 999999), ci_rep.id
       LIMIT 1
     ) rep ON TRUE
     LEFT JOIN LATERAL (
       SELECT BOOL_OR(COALESCE(m.format, '') ILIKE '%digital%') AS has_digital
       FROM collection_items ci_fmt
       LEFT JOIN media m ON m.id = ci_fmt.media_id
       WHERE ci_fmt.collection_id = c.id
     ) fmt ON TRUE
     ${whereWithScope}
     GROUP BY c.id, rep.poster_path, fmt.has_digital
     ORDER BY c.created_at DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );
  const total = count.rows[0]?.total || 0;
  res.json({
    items: rows.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  });
}));

router.get('/collections/:id', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const collectionId = Number(req.params.id);
  if (!Number.isFinite(collectionId) || collectionId <= 0) {
    return res.status(400).json({ error: 'Invalid collection id' });
  }
  const params = [collectionId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'c.space_id',
    libraryColumn: 'c.library_id'
  });
  const collection = await pool.query(
    `SELECT
       c.id, c.name, c.media_type, c.source_title, c.import_source, c.expected_item_count, c.metadata,
       c.library_id, c.space_id, c.created_by, c.created_at, c.updated_at
     FROM collections c
     WHERE c.id = $1
     ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!collection.rows[0]) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  const items = await pool.query(
    `SELECT
       ci.id, ci.collection_id, ci.media_id, ci.contained_title, ci.position, ci.confidence_score,
       ci.resolution_status, ci.source_payload, ci.created_at, ci.updated_at,
       m.title AS media_title, m.media_type AS media_type, m.poster_path AS media_poster_path, m.year AS media_year
     FROM collection_items ci
     LEFT JOIN media m ON m.id = ci.media_id
     WHERE ci.collection_id = $1
     ORDER BY COALESCE(ci.position, 999999), ci.id ASC`,
    [collectionId]
  );

  res.json({
    collection: collection.rows[0],
    items: items.rows
  });
}));

router.patch('/collections/:id', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const collectionId = Number(req.params.id);
  if (!Number.isFinite(collectionId) || collectionId <= 0) {
    return res.status(400).json({ error: 'Invalid collection id' });
  }
  const allowed = ['name', 'expected_item_count', 'source_title', 'metadata'];
  const fields = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(fields).length) {
    return res.status(400).json({ error: 'No valid collection fields provided' });
  }
  const updates = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'metadata') {
      values.push(value && typeof value === 'object' ? JSON.stringify(value) : null);
      updates.push(`${key} = $${values.length}::jsonb`);
      continue;
    }
    if (key === 'expected_item_count') {
      const parsed = Number(value);
      values.push(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
      updates.push(`${key} = $${values.length}::int`);
      continue;
    }
    values.push(value ? String(value).trim() : null);
    updates.push(`${key} = $${values.length}::text`);
  }
  values.push(collectionId);
  let scopeClause = '';
  if (scopeContext?.spaceId !== null && scopeContext?.spaceId !== undefined) {
    values.push(Number(scopeContext.spaceId));
    scopeClause += ` AND space_id = $${values.length}::int`;
  }
  if (scopeContext?.libraryId !== null && scopeContext?.libraryId !== undefined) {
    values.push(Number(scopeContext.libraryId));
    scopeClause += ` AND library_id = $${values.length}::int`;
  }
  const result = await pool.query(
    `UPDATE collections
     SET ${updates.join(', ')}
     WHERE id = $${updates.length + 1}::int
     ${scopeClause}
     RETURNING *`,
    values
  );
  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Collection not found' });
  }
  await logActivity(req, 'media.collection.update', 'collection', collectionId, {
    fields: Object.keys(fields)
  });
  res.json(result.rows[0]);
}));

router.post('/collections/:id/items', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const collectionId = Number(req.params.id);
  if (!Number.isFinite(collectionId) || collectionId <= 0) {
    return res.status(400).json({ error: 'Invalid collection id' });
  }
  const collectionParams = [collectionId];
  const scopeClause = appendScopeSql(collectionParams, scopeContext, {
    spaceColumn: 'space_id',
    libraryColumn: 'library_id'
  });
  const collection = await pool.query(
    `SELECT id, media_type, library_id, space_id FROM collections WHERE id = $1 ${scopeClause} LIMIT 1`,
    collectionParams
  );
  if (!collection.rows[0]) {
    return res.status(404).json({ error: 'Collection not found' });
  }
  const collectionRow = collection.rows[0];

  const containedTitle = req.body?.contained_title ? String(req.body.contained_title).trim() : null;
  const mediaId = Number(req.body?.media_id);
  const position = Number(req.body?.position);
  const year = Number(req.body?.year);
  if (!containedTitle && !Number.isFinite(mediaId)) {
    return res.status(400).json({ error: 'contained_title or media_id is required' });
  }

  const effectiveScope = {
    libraryId: collectionRow.library_id ?? scopeContext.libraryId ?? null,
    spaceId: collectionRow.space_id ?? scopeContext.spaceId ?? null
  };
  const expectedMediaType = normalizeMediaType(collectionRow.media_type || 'movie', 'movie');
  const normalizedYear = Number.isFinite(year) && year > 1800 ? Math.round(year) : null;
  let resolvedMediaId = Number.isFinite(mediaId) ? mediaId : null;
  let matchedBy = null;
  let matchMode = null;
  let confidenceScore = null;
  let enrichmentStatus = 'not_attempted';

  if (resolvedMediaId) {
    const mediaParams = [resolvedMediaId, expectedMediaType];
    const mediaScopeClause = appendScopeSql(mediaParams, effectiveScope);
    const mediaCheck = await pool.query(
      `SELECT id
       FROM media
       WHERE id = $1
         AND COALESCE(media_type, 'movie') = $2
         ${mediaScopeClause}
       LIMIT 1`,
      mediaParams
    );
    if (!mediaCheck.rows[0]) {
      return res.status(404).json({ error: 'Provided media_id not found in this collection scope/type' });
    }
    matchedBy = 'manual_media_id';
    matchMode = 'matched_by_identifier';
    confidenceScore = 100;
  } else if (containedTitle) {
    const existingParams = [
      containedTitle,
      expectedMediaType,
      normalizedYear,
      effectiveScope.libraryId || null,
      effectiveScope.spaceId || null
    ];
    const existingByTitle = await pool.query(
      `SELECT id
       FROM media
       WHERE LOWER(TRIM(title)) = LOWER(TRIM($1))
         AND COALESCE(media_type, 'movie') = $2
         AND ($3::int IS NULL OR year = $3::int)
         AND COALESCE(library_id, 0) = COALESCE($4, 0)
         AND COALESCE(space_id, 0) = COALESCE($5, 0)
       ORDER BY created_at DESC
       LIMIT 1`,
      existingParams
    );
    if (existingByTitle.rows[0]?.id) {
      resolvedMediaId = Number(existingByTitle.rows[0].id);
      matchedBy = 'collection_exact_title_same_type';
      matchMode = 'fallback_title_only';
      confidenceScore = normalizedYear ? 95 : 90;
    } else {
      const config = await loadScopedIntegrationConfig(effectiveScope.spaceId || null);
      const enrichmentResult = await runImportEnrichmentPipeline(
        {
          title: containedTitle,
          media_type: expectedMediaType,
          year: normalizedYear,
          format: 'Digital',
          library_id: effectiveScope.libraryId,
          space_id: effectiveScope.spaceId
        },
        config,
        { tmdbCache: new Map(), providerCache: new Map() },
        {}
      );
      enrichmentStatus = enrichmentResult.enrichmentStatus;
      const upsertResult = await upsertImportedMedia({
        userId: req.user.id,
        item: {
          ...enrichmentResult.item,
          library_id: effectiveScope.libraryId,
          space_id: effectiveScope.spaceId
        },
        importSource: 'collection_manual',
        scopeContext: effectiveScope
      });
      if (upsertResult?.mediaId) {
        resolvedMediaId = Number(upsertResult.mediaId);
        matchedBy = upsertResult.matchedBy || 'collection_provider_upsert';
        matchMode = upsertResult.matchMode || 'fallback_title_only';
        confidenceScore = deriveImportConfidenceScore({
          matchMode,
          matchedBy,
          enrichmentStatus
        });
      }
    }
  }

  const itemId = await addCollectionItem({
    collectionId,
    mediaId: resolvedMediaId || null,
    containedTitle: containedTitle || null,
    position: Number.isFinite(position) ? position : null,
    confidenceScore: Number.isFinite(confidenceScore) ? confidenceScore : null,
    sourcePayload: {
      source: 'manual_edit',
      matched_by: matchedBy,
      match_mode: matchMode,
      enrichment_status: enrichmentStatus,
      requested_year: normalizedYear
    }
  });
  const item = await pool.query(
    `SELECT * FROM collection_items WHERE id = $1 LIMIT 1`,
    [itemId]
  );
  await logActivity(req, 'media.collection.item.add', 'collection', collectionId, {
    itemId: item.rows[0]?.id || null,
    media_id: resolvedMediaId || null,
    contained_title: containedTitle || null,
    matched_by: matchedBy,
    match_mode: matchMode,
    confidence_score: Number.isFinite(confidenceScore) ? confidenceScore : null,
    enrichment_status: enrichmentStatus
  });
  res.status(201).json({
    ...item.rows[0],
    resolved_media_id: resolvedMediaId || null,
    matched_by: matchedBy,
    match_mode: matchMode,
    confidence_score: Number.isFinite(confidenceScore) ? confidenceScore : null,
    enrichment_status: enrichmentStatus
  });
}));

router.patch('/collections/:id/items/:itemId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const collectionId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  if (!Number.isFinite(collectionId) || collectionId <= 0 || !Number.isFinite(itemId) || itemId <= 0) {
    return res.status(400).json({ error: 'Invalid collection item id' });
  }
  const allowed = ['contained_title', 'position', 'media_id', 'resolution_status'];
  const fields = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(fields).length) {
    return res.status(400).json({ error: 'No valid collection item fields provided' });
  }
  const collectionParams = [collectionId];
  const scopeClause = appendScopeSql(collectionParams, scopeContext, {
    spaceColumn: 'space_id',
    libraryColumn: 'library_id'
  });
  const collection = await pool.query(
    `SELECT id FROM collections WHERE id = $1 ${scopeClause} LIMIT 1`,
    collectionParams
  );
  if (!collection.rows[0]) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  const updates = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'position' || key === 'media_id') {
      const parsed = Number(value);
      values.push(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
      updates.push(`${key} = $${values.length}`);
      continue;
    }
    if (key === 'resolution_status') {
      const normalized = ['pending', 'resolved', 'skipped'].includes(String(value || '').toLowerCase())
        ? String(value).toLowerCase()
        : 'pending';
      values.push(normalized);
      updates.push(`${key} = $${values.length}`);
      continue;
    }
    values.push(value ? String(value).trim() : null);
    updates.push(`${key} = $${values.length}`);
  }
  values.push(collectionId);
  values.push(itemId);
  const result = await pool.query(
    `UPDATE collection_items
     SET ${updates.join(', ')}
     WHERE collection_id = $${values.length - 1}
       AND id = $${values.length}
     RETURNING *`,
    values
  );
  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Collection item not found' });
  }
  await logActivity(req, 'media.collection.item.update', 'collection', collectionId, {
    itemId,
    fields: Object.keys(fields)
  });
  res.json(result.rows[0]);
}));

router.delete('/collections/:id/items/:itemId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const collectionId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  if (!Number.isFinite(collectionId) || collectionId <= 0 || !Number.isFinite(itemId) || itemId <= 0) {
    return res.status(400).json({ error: 'Invalid collection item id' });
  }
  const collectionParams = [collectionId];
  const scopeClause = appendScopeSql(collectionParams, scopeContext, {
    spaceColumn: 'space_id',
    libraryColumn: 'library_id'
  });
  const collection = await pool.query(
    `SELECT id FROM collections WHERE id = $1 ${scopeClause} LIMIT 1`,
    collectionParams
  );
  if (!collection.rows[0]) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  const deleted = await pool.query(
    `DELETE FROM collection_items
     WHERE collection_id = $1
       AND id = $2
     RETURNING id`,
    [collectionId, itemId]
  );
  if (!deleted.rows[0]) {
    return res.status(404).json({ error: 'Collection item not found' });
  }
  await logActivity(req, 'media.collection.item.delete', 'collection', collectionId, {
    itemId
  });
  res.json({ ok: true });
}));

router.post('/:id/convert-to-collection', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return res.status(400).json({ error: 'Invalid media id' });
  }

  const mediaParams = [mediaId];
  const mediaScopeClause = appendScopeSql(mediaParams, scopeContext);
  const mediaResult = await pool.query(
    `SELECT *
     FROM media
     WHERE id = $1
     ${mediaScopeClause}
     LIMIT 1`,
    mediaParams
  );
  const media = mediaResult.rows[0];
  if (!media) {
    return res.status(404).json({ error: 'Media not found' });
  }
  const normalizedMediaType = normalizeMediaType(media.media_type || 'movie', 'movie');
  if (!['movie', 'game'].includes(normalizedMediaType)) {
    return res.status(400).json({ error: 'Only movie and game titles can be converted to collections' });
  }

  const existingCollectionItem = await pool.query(
    `SELECT ci.id, ci.collection_id
     FROM collection_items ci
     JOIN collections c ON c.id = ci.collection_id
     WHERE ci.media_id = $1
       AND COALESCE(c.media_type, 'movie') = $2
       AND COALESCE(c.library_id, 0) = COALESCE($3, 0)
       AND COALESCE(c.space_id, 0) = COALESCE($4, 0)
     ORDER BY ci.id DESC
     LIMIT 1`,
    [mediaId, normalizedMediaType, media.library_id || null, media.space_id || null]
  );
  if (existingCollectionItem.rows[0]) {
    return res.status(409).json({ error: 'Title is already linked to a collection' });
  }

  const collectionName = String(media.title || '').trim() || `Collection ${mediaId}`;
  const metadata = {
    converted_from_media_id: mediaId,
    converted_from_title: media.title || null,
    converted_at: new Date().toISOString(),
    converted_by: req.user.id
  };
  const createdCollection = await pool.query(
    `INSERT INTO collections (
       name, media_type, source_title, import_source, expected_item_count, metadata, library_id, space_id, created_by
     ) VALUES (
       $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9
     )
     RETURNING id, name, media_type, source_title, library_id, space_id`,
    [
      collectionName,
      normalizedMediaType,
      media.title || null,
      'manual_convert',
      1,
      JSON.stringify(metadata),
      media.library_id || scopeContext.libraryId || null,
      media.space_id || scopeContext.spaceId || null,
      req.user.id
    ]
  );
  const collection = createdCollection.rows[0];

  const mediaSnapshot = {
    title: media.title || null,
    media_type: normalizedMediaType,
    original_title: media.original_title || null,
    release_date: media.release_date || null,
    year: media.year || null,
    format: derivePrimaryFormat(normalizedMediaType, media.owned_formats, media.format) || 'Digital',
    owned_formats: sortOwnedFormats(normalizedMediaType, media.owned_formats || []),
    genre: media.genre || null,
    director: media.director || null,
    cast_members: media.cast_members || null,
    rating: media.rating || null,
    user_rating: media.user_rating || null,
    tmdb_id: media.tmdb_id || null,
    tmdb_media_type: media.tmdb_media_type || null,
    tmdb_url: media.tmdb_url || null,
    poster_path: media.poster_path || null,
    backdrop_path: media.backdrop_path || null,
    overview: media.overview || null,
    trailer_url: media.trailer_url || null,
    runtime: media.runtime || null,
    upc: media.upc || null,
    signed_by: media.signed_by || null,
    signed_role: media.signed_role || null,
    signed_on: media.signed_on || null,
    signed_at: media.signed_at || null,
    signed_proof_path: media.signed_proof_path || null,
    location: media.location || null,
    notes: media.notes || null,
    type_details: media.type_details || null
  };

  await addCollectionItem({
    collectionId: collection.id,
    mediaId: null,
    containedTitle: media.title || null,
    position: 1,
    confidenceScore: 100,
    sourcePayload: {
      source: 'manual_convert',
      converted_from_media_id: mediaId,
      media_snapshot: mediaSnapshot
    }
  });

  const deleteParams = [mediaId];
  const deleteScopeClause = appendScopeSql(deleteParams, scopeContext);
  await pool.query(`DELETE FROM media WHERE id = $1${deleteScopeClause}`, deleteParams);

  await logActivity(req, 'media.convert_to_collection', 'media', mediaId, {
    collection_id: collection.id,
    media_type: normalizedMediaType,
    title: media.title || null
  });

  res.json({
    ok: true,
    collection_id: collection.id,
    collection_name: collection.name,
    media_type: collection.media_type
  });
}));

router.post('/collections/:id/convert-to-individual', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const collectionId = Number(req.params.id);
  if (!Number.isFinite(collectionId) || collectionId <= 0) {
    return res.status(400).json({ error: 'Invalid collection id' });
  }
  const params = [collectionId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'space_id',
    libraryColumn: 'library_id'
  });
  const collection = await pool.query(
    `SELECT id, name, media_type, library_id, space_id
     FROM collections
     WHERE id = $1
     ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!collection.rows[0]) {
    return res.status(404).json({ error: 'Collection not found' });
  }
  const items = await pool.query(
    `SELECT id, media_id, contained_title, source_payload, position
     FROM collection_items
     WHERE collection_id = $1
     ORDER BY COALESCE(position, 999999), id`,
    [collectionId]
  );

  let createdTitles = 0;
  for (const item of items.rows) {
    if (item.media_id) continue;
    const payload = item.source_payload && typeof item.source_payload === 'object'
      ? item.source_payload
      : {};
    const snapshot = payload.media_snapshot && typeof payload.media_snapshot === 'object'
      ? payload.media_snapshot
      : null;
    const restoredType = normalizeMediaType(snapshot?.media_type || collection.rows[0].media_type || 'movie', 'movie');
    const restoredOwnedFormatState = buildOwnedFormatsPayload(restoredType, snapshot?.owned_formats, snapshot?.format);
    const insert = await pool.query(
      `INSERT INTO media (
         title, media_type, original_title, release_date, year, format, owned_formats, genre, director, cast_members,
         rating, user_rating, tmdb_id, tmdb_media_type, tmdb_url, poster_path, backdrop_path, overview,
         trailer_url, runtime, upc, signed_by, signed_role, signed_on, signed_at, signed_proof_path, location, notes,
         type_details, library_id, space_id, added_by, import_source
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7::text[],$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29::jsonb,$30,$31,$32,$33
       )
       RETURNING id, genre, director, cast_members AS cast`,
      [
        (snapshot?.title || item.contained_title || collection.rows[0].name || '').trim() || `Title ${collectionId}`,
        restoredType,
        snapshot?.original_title || null,
        snapshot?.release_date || null,
        snapshot?.year || null,
        restoredOwnedFormatState.format || 'Digital',
        restoredOwnedFormatState.ownedFormats,
        snapshot?.genre || null,
        snapshot?.director || null,
        snapshot?.cast_members || null,
        snapshot?.rating || null,
        snapshot?.user_rating || null,
        snapshot?.tmdb_id || null,
        snapshot?.tmdb_media_type || null,
        snapshot?.tmdb_url || null,
        snapshot?.poster_path || null,
        snapshot?.backdrop_path || null,
        snapshot?.overview || null,
        snapshot?.trailer_url || null,
        snapshot?.runtime || null,
        snapshot?.upc || null,
        snapshot?.signed_by || null,
        snapshot?.signed_role || null,
        snapshot?.signed_on || null,
        snapshot?.signed_at || null,
        snapshot?.signed_proof_path || null,
        snapshot?.location || null,
        snapshot?.notes || null,
        snapshot?.type_details ? JSON.stringify(snapshot.type_details) : null,
        collection.rows[0].library_id ?? scopeContext.libraryId ?? null,
        collection.rows[0].space_id ?? scopeContext.spaceId ?? null,
        req.user.id,
        'manual_convert'
      ]
    );
    const created = insert.rows[0];
    if (created?.id) {
      createdTitles += 1;
      await syncNormalizedMetadataForMedia({
        mediaId: created.id,
        genre: created.genre,
        director: created.director,
        cast: created.cast
      });
    }
  }
  await pool.query(`DELETE FROM collection_items WHERE collection_id = $1`, [collectionId]);
  await pool.query(`DELETE FROM collections WHERE id = $1`, [collectionId]);
  await logActivity(req, 'media.collection.convert_to_individual', 'collection', collectionId, {
    itemCount: items.rows.length,
    createdTitles,
    name: collection.rows[0].name || null
  });
  res.json({ ok: true, removed_items: items.rows.length, created_titles: createdTitles });
}));

// ── Create ────────────────────────────────────────────────────────────────────

router.post('/', validate(mediaCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const {
    title, media_type, original_title, release_date, year, format, owned_formats, genre, director, rating,
    cast,
    user_rating, tmdb_id, tmdb_media_type, tmdb_url, poster_path, backdrop_path, overview,
    trailer_url, runtime, upc, signed_by, signed_role, signed_on, signed_at, signed_proof_path, location, notes, import_source,
    season_number, episode_number, episode_title, network, type_details, library_id
    , space_id
  } = req.body;
  const normalizedMediaType = normalizeMediaType(media_type || 'movie', 'movie');
  const normalizedTypeDetailsResult = normalizeTypeDetails(normalizedMediaType, type_details, { strict: true });
  if ((normalizedTypeDetailsResult.invalidKeys || []).length > 0) {
    return res.status(400).json({
      error: `Invalid type_details key(s) for ${normalizedMediaType}: ${normalizedTypeDetailsResult.invalidKeys.join(', ')}`
    });
  }
  if ((normalizedTypeDetailsResult.errors || []).length > 0) {
    return res.status(400).json({
      error: `Invalid type_details values for ${normalizedMediaType}`,
      details: normalizedTypeDetailsResult.errors
    });
  }
  const normalizedTypeDetails = normalizedTypeDetailsResult.value;
  const ownedFormatState = buildOwnedFormatsPayload(normalizedMediaType, owned_formats, format);
  const ownedFormatsValidationError = validateOwnedFormatsForType(normalizedMediaType, ownedFormatState.ownedFormats);
  if (ownedFormatsValidationError) {
    return res.status(400).json({ error: ownedFormatsValidationError });
  }
  const fieldValidationError = validateTypeSpecificFields(normalizedMediaType, req.body);
  if (fieldValidationError) {
    return res.status(400).json({ error: fieldValidationError });
  }

  const result = await pool.query(
    `INSERT INTO media (
       title, media_type, original_title, release_date, year, format, owned_formats, genre, director, cast_members, rating,
       user_rating, tmdb_id, tmdb_media_type, tmdb_url, poster_path, backdrop_path, overview,
       trailer_url, runtime, upc, signed_by, signed_role, signed_on, signed_at, signed_proof_path, location, notes, season_number, episode_number, episode_title, network,
       type_details, library_id, space_id, added_by, import_source
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7::text[],$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33::jsonb,$34,$35,$36,$37
     ) RETURNING *, cast_members AS cast`,
    [
      title, normalizedMediaType, original_title || null, release_date || null, year || null, ownedFormatState.format || null,
      ownedFormatState.ownedFormats, genre || null, director || null, cast || null, rating || null, user_rating || null,
      tmdb_id || null, tmdb_media_type || null, tmdb_url || null, poster_path || null, backdrop_path || null,
      overview || null, trailer_url || null, runtime || null, upc || null, signed_by || null,
      signed_role || null, signed_on || null, signed_at || null, signed_proof_path || null, location || null, notes || null,
      season_number || null, episode_number || null, episode_title || null, network || null,
      normalizedTypeDetails ? JSON.stringify(normalizedTypeDetails) : null,
      library_id || scopeContext.libraryId || null,
      space_id || scopeContext.spaceId || null,
      req.user.id, import_source || 'manual'
    ]
  );
  const created = normalizeMediaRecord(result.rows[0]);
  await syncMediaPrimarySignature(created, req.user.id);
  const createdWithSignatures = await attachSignaturesToMediaRecord(created);
  await syncNormalizedMetadataForMedia({
    mediaId: created.id,
    genre: created.genre,
    director: created.director,
    cast: created.cast || created.cast_members
  });
  await logActivity(req, 'media.create', 'media', created.id, {
    title: created.title || null,
    mediaType: created.media_type || null,
    libraryId: created.library_id || null,
    spaceId: created.space_id || scopeContext.spaceId || null
  });
  await maybePushComicToMetron({ req, mediaRow: created });
  res.status(201).json(createdWithSignatures);
}));

// ── Update ─────────────────────────────────────────────────────────────────────
// Ownership enforcement: users may only edit their own media; admins are unrestricted.

router.patch('/:id', validate(mediaUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const { id } = req.params;

  const ALLOWED_FIELDS = [
    'title', 'media_type', 'original_title', 'release_date', 'year', 'format', 'owned_formats', 'genre', 'director', 'cast',
    'rating', 'user_rating', 'tmdb_id', 'tmdb_media_type', 'tmdb_url', 'poster_path', 'backdrop_path',
    'overview', 'trailer_url', 'runtime', 'upc', 'signed_by', 'signed_role', 'signed_on', 'signed_at', 'signed_proof_path', 'location', 'notes', 'season_number',
    'episode_number', 'episode_title', 'network', 'type_details', 'library_id', 'space_id'
  ];

  let fields = Object.fromEntries(
    Object.entries(req.body).filter(([key]) => ALLOWED_FIELDS.includes(key))
  );
  if (Object.prototype.hasOwnProperty.call(fields, 'cast')) {
    fields.cast_members = fields.cast;
    delete fields.cast;
  }
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'No valid fields provided for update' });
  }

  const touchesTypeSpecific = ['season_number', 'episode_number', 'episode_title', 'network']
    .some((key) => Object.prototype.hasOwnProperty.call(fields, key));
  const touchesFormatState = ['media_type', 'format', 'owned_formats']
    .some((key) => Object.prototype.hasOwnProperty.call(fields, key));
  let effectiveMediaType = null;
  let currentFormatState = null;
  if (fields.media_type) {
    effectiveMediaType = normalizeMediaType(fields.media_type, 'movie');
    fields.media_type = effectiveMediaType;
  }
  if (touchesTypeSpecific || Object.prototype.hasOwnProperty.call(fields, 'type_details') || touchesFormatState) {
    const mediaTypeParams = [id];
    const mediaTypeScopeClause = appendScopeSql(mediaTypeParams, scopeContext);
    const currentTypeResult = await pool.query(
      `SELECT media_type, format, owned_formats FROM media WHERE id = $1${mediaTypeScopeClause} LIMIT 1`,
      mediaTypeParams
    );
    currentFormatState = currentTypeResult.rows[0] || null;
    effectiveMediaType = effectiveMediaType || normalizeMediaType(currentFormatState?.media_type || 'movie', 'movie');
  }
  fields = stripIncompatibleTypeSpecificFields(effectiveMediaType || 'movie', fields);
  const fieldValidationError = validateTypeSpecificFields(effectiveMediaType || 'movie', fields);
  if (fieldValidationError) {
    return res.status(400).json({ error: fieldValidationError });
  }
  if (touchesFormatState) {
    const nextOwnedFormatsInput = Object.prototype.hasOwnProperty.call(fields, 'owned_formats')
      ? fields.owned_formats
      : currentFormatState?.owned_formats;
    const nextFormatFallback = Object.prototype.hasOwnProperty.call(fields, 'owned_formats')
      ? fields.format
      : (Object.prototype.hasOwnProperty.call(fields, 'format') ? fields.format : currentFormatState?.format);
    const ownedFormatState = buildOwnedFormatsPayload(
      effectiveMediaType || 'movie',
      nextOwnedFormatsInput,
      nextFormatFallback
    );
    const ownedFormatsValidationError = validateOwnedFormatsForType(effectiveMediaType || 'movie', ownedFormatState.ownedFormats);
    if (ownedFormatsValidationError) {
      return res.status(400).json({ error: ownedFormatsValidationError });
    }
    fields.owned_formats = ownedFormatState.ownedFormats;
    fields.format = ownedFormatState.format;
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'type_details')) {
    const detailType = effectiveMediaType || 'movie';
    const normalizedTypeDetailsResult = normalizeTypeDetails(detailType, fields.type_details, { strict: true });
    if ((normalizedTypeDetailsResult.invalidKeys || []).length > 0) {
      return res.status(400).json({
        error: `Invalid type_details key(s) for ${detailType}: ${normalizedTypeDetailsResult.invalidKeys.join(', ')}`
      });
    }
    if ((normalizedTypeDetailsResult.errors || []).length > 0) {
      return res.status(400).json({
        error: `Invalid type_details values for ${detailType}`,
        details: normalizedTypeDetailsResult.errors
      });
    }
    fields.type_details = normalizedTypeDetailsResult.value;
  }

  const keys = Object.keys(fields);
  if (keys.length === 0) {
    return res.status(400).json({ error: 'No valid fields provided for update' });
  }
  const normalizedValues = keys.map((key) => fields[key]);

  const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');
  const updateParams = [...normalizedValues, id];
  let ownerClause = '';
  if (req.user.role !== 'admin') {
    updateParams.push(req.user.id);
    ownerClause = ` AND added_by = $${updateParams.length}`;
  }
  const updateScopeClause = appendScopeSql(updateParams, scopeContext);
  const result = await pool.query(
    `UPDATE media
     SET ${setClause}
     WHERE id = $${keys.length + 1}${ownerClause}${updateScopeClause}
     RETURNING *, cast_members AS cast`,
    updateParams
  );
  if (result.rows.length === 0) {
    const existsParams = [id];
    const existsScopeClause = appendScopeSql(existsParams, scopeContext);
    const exists = await pool.query(`SELECT id FROM media WHERE id = $1${existsScopeClause}`, existsParams);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'Media item not found' });
    }
    return res.status(403).json({ error: 'You do not have permission to edit this item' });
  }
  const updated = normalizeMediaRecord(result.rows[0]);
  if (['signed_by', 'signed_role', 'signed_on', 'signed_at', 'signed_proof_path', 'library_id', 'space_id'].some((key) => keys.includes(key))) {
    await syncMediaPrimarySignature(updated, req.user.id);
  }
  const updatedWithSignatures = await attachSignaturesToMediaRecord(updated);
  await syncNormalizedMetadataForMedia({
    mediaId: updated.id,
    genre: updated.genre,
    director: updated.director,
    cast: updated.cast || updated.cast_members
  });
  await logActivity(req, 'media.update', 'media', updated.id, {
    title: updated.title || null,
    mediaType: updated.media_type || null,
    libraryId: updated.library_id || null,
    spaceId: updated.space_id || scopeContext.spaceId || null,
    fields: keys
  });
  res.json(updatedWithSignatures);
}));

// ── Delete ────────────────────────────────────────────────────────────────────
// Ownership enforcement: users may only delete their own media; admins are unrestricted.

router.delete('/:id', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const { id } = req.params;

  const existingParams = [id];
  const existingScopeClause = appendScopeSql(existingParams, scopeContext);
  const existing = await pool.query(
    `SELECT id, added_by, title, media_type, library_id, space_id
     FROM media
     WHERE id = $1${existingScopeClause}`,
    existingParams
  );
  if (existing.rows.length === 0) {
    return res.status(404).json({ error: 'Media item not found' });
  }
  if (req.user.role !== 'admin' && existing.rows[0].added_by !== req.user.id) {
    return res.status(403).json({ error: 'You do not have permission to delete this item' });
  }

  const deleteParams = [id];
  const deleteScopeClause = appendScopeSql(deleteParams, scopeContext);
  await pool.query(`DELETE FROM media WHERE id = $1${deleteScopeClause}`, deleteParams);
  await logActivity(req, 'media.delete', 'media', Number(id), {
    title: existing.rows[0].title || null,
    mediaType: existing.rows[0].media_type || null,
    libraryId: existing.rows[0].library_id || null,
    spaceId: existing.rows[0].space_id || scopeContext.spaceId || null
  });
  res.json({ message: 'Media deleted' });
}));

module.exports = router;
