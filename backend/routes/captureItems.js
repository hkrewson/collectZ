const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const { resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const { logActivity } = require('../services/audit');
const { uploadBuffer, readLocalUploadBuffer } = require('../services/storage');
const { buildCaptureOcrCandidates } = require('../services/captureOcr');
const { extractTextFromImageBuffer } = require('../services/captureImageOcr');
const { loadIntegrationConfigRow, normalizeIntegrationRecord } = require('../services/integrations');
const mediaRouter = require('./media');

const router = express.Router();

router.use('/capture-items', authenticateToken);
router.use('/capture-items', enforceScopeAccess({ allowedHintRoles: ['admin'] }));

const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
const CAPTURE_TYPES = new Set(['barcode', 'photo', 'ocr_text', 'manual_note']);
const STATUSES = new Set(['new', 'reviewed', 'converted', 'discarded']);
const OBJECT_TYPES = new Set(['movie', 'tv_series', 'book', 'comic_book', 'audio', 'game', 'art', 'collectible', 'event_item', 'other']);
const REVIEW_FILTERS = new Set(['all', 'needs_choice', 'no_match', 'ready', 'missing_details', 'problems']);

function trimString(value) {
  return String(value || '').trim();
}

function nullableString(value) {
  const trimmed = trimString(value);
  return trimmed || null;
}

function normalizeCaptureType(value, fallback = 'manual_note') {
  const type = trimString(value).toLowerCase();
  return CAPTURE_TYPES.has(type) ? type : fallback;
}

function normalizeStatus(value, fallback = 'new') {
  const status = trimString(value).toLowerCase();
  return STATUSES.has(status) ? status : fallback;
}

function normalizeObjectType(value, fallback = 'other') {
  const type = trimString(value).toLowerCase();
  if (type === 'tv') return 'tv_series';
  if (type === 'comic') return 'comic_book';
  return OBJECT_TYPES.has(type) ? type : fallback;
}

function jsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (_) {
      return {};
    }
  }
  return {};
}

function extractClientCaptureId(body = {}, sourceContext = {}) {
  return nullableString(
    body.client_capture_id
    ?? body.clientCaptureId
    ?? sourceContext.client_capture_id
    ?? sourceContext.clientCaptureId
  );
}

function extractClientSource(body = {}, sourceContext = {}) {
  return nullableString(
    body.client_source
    ?? body.clientSource
    ?? sourceContext.client_source
    ?? sourceContext.clientSource
  );
}

function mergeClientCaptureContext(body = {}, sourceContext = {}) {
  const next = { ...jsonObject(sourceContext) };
  const clientCaptureId = extractClientCaptureId(body, next);
  const clientSource = extractClientSource(body, next);
  if (clientCaptureId) next.client_capture_id = clientCaptureId;
  if (clientSource) next.client_source = clientSource;
  return next;
}

function shapeCaptureItem(row) {
  const sourceContext = jsonObject(row.source_context);
  return {
    id: row.id,
    title: row.title,
    capture_type: row.capture_type,
    status: row.status,
    object_type: row.object_type,
    barcode: row.barcode,
    symbology: row.symbology,
    ocr_text: row.ocr_text,
    notes: row.notes,
    image_path: row.image_path,
    source_context: sourceContext,
    client_capture_id: sourceContext.client_capture_id || null,
    client_source: sourceContext.client_source || null,
    review_decision: jsonObject(row.review_decision),
    linked_media_id: row.linked_media_id,
    wanted_item_id: row.wanted_item_id,
    library_id: row.library_id,
    space_id: row.space_id,
    created_by: row.created_by,
    reviewed_at: row.reviewed_at,
    converted_at: row.converted_at,
    discarded_at: row.discarded_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function normalizeReviewFilter(value) {
  const filter = trimString(value).toLowerCase();
  return REVIEW_FILTERS.has(filter) ? filter : 'all';
}

function reviewArrayLength(path) {
  return `jsonb_array_length(COALESCE(review_decision->'${path}', '[]'::jsonb))`;
}

function hasActiveReplayConflictSql() {
  return `EXISTS (
    SELECT 1
      FROM jsonb_array_elements(COALESCE(review_decision->'capture_replay_conflicts', '[]'::jsonb)) AS conflict
     WHERE conflict->>'status' = 'needs_review'
       AND ${reviewArrayLength('fields').replace(/review_decision/g, 'conflict')} > 0
  )`;
}

function captureLookupMatchCountSql() {
  return reviewArrayLength('capture_lookup_matches');
}

function ocrCandidateCountSql() {
  return reviewArrayLength('ocr_candidates');
}

function captureLookupCountStatusSql() {
  return `COALESCE(NULLIF(review_decision->'capture_lookup_status'->>'match_count', '')::int, ${captureLookupMatchCountSql()})`;
}

function captureLookupProviderErrorSql() {
  return `NULLIF(review_decision->'capture_lookup_status'->>'provider_error', '') IS NOT NULL`;
}

function captureReviewFilterCondition(filter) {
  const lookupMatches = captureLookupMatchCountSql();
  const ocrCandidates = ocrCandidateCountSql();
  const lookupCount = captureLookupCountStatusSql();
  const providerError = captureLookupProviderErrorSql();
  const replayConflict = hasActiveReplayConflictSql();
  const activeStatus = "status NOT IN ('converted', 'discarded')";
  const hasLookupStatus = "review_decision ? 'capture_lookup_status'";
  const missingText = `(
    ${activeStatus}
    AND (
      NULLIF(title, '') IS NULL
      OR (
        capture_type IN ('barcode', 'ocr_text')
        AND NULLIF(barcode, '') IS NULL
        AND NULLIF(ocr_text, '') IS NULL
      )
      OR (
        capture_type = 'photo'
        AND NULLIF(image_path, '') IS NULL
      )
    )
  )`;

  if (filter === 'needs_choice') {
    return `(${activeStatus} AND (${lookupMatches} > 1 OR ${ocrCandidates} > 1 OR ${replayConflict}))`;
  }
  if (filter === 'no_match') {
    return `(${activeStatus} AND ${hasLookupStatus} AND ${lookupCount} = 0 AND NOT (${providerError}))`;
  }
  if (filter === 'ready') {
    return `(${activeStatus} AND ${lookupMatches} = 1)`;
  }
  if (filter === 'missing_details') {
    return missingText;
  }
  if (filter === 'problems') {
    return `(${activeStatus} AND (${providerError} OR ${replayConflict}))`;
  }
  return 'TRUE';
}

function valuesFromBody(body, current = {}) {
  const next = { ...current };
  const has = (field) => Object.prototype.hasOwnProperty.call(body || {}, field);

  if (has('title')) next.title = nullableString(body.title);
  if (has('capture_type')) next.capture_type = normalizeCaptureType(body.capture_type, current.capture_type || 'manual_note');
  if (has('status')) next.status = normalizeStatus(body.status, current.status || 'new');
  if (has('object_type') || has('media_type')) next.object_type = normalizeObjectType(body.object_type ?? body.media_type, current.object_type || 'other');
  if (has('barcode') || has('upc') || has('isbn')) next.barcode = nullableString(body.barcode ?? body.upc ?? body.isbn);
  if (has('symbology')) next.symbology = nullableString(body.symbology);
  if (has('ocr_text')) next.ocr_text = nullableString(body.ocr_text);
  if (has('notes')) next.notes = nullableString(body.notes);
  if (has('image_path')) next.image_path = nullableString(body.image_path);
  if (has('source_context')) next.source_context = jsonObject(body.source_context);
  if (has('review_decision')) next.review_decision = jsonObject(body.review_decision);
  next.source_context = mergeClientCaptureContext(body, next.source_context || {});

  return next;
}

function mergeReviewDecision(current = {}, patch = {}) {
  return {
    ...jsonObject(current),
    ...jsonObject(patch)
  };
}

function findStoredOcrCandidate(reviewDecision = {}, candidateId = '') {
  const candidates = Array.isArray(reviewDecision?.ocr_candidates) ? reviewDecision.ocr_candidates : [];
  return candidates.find((candidate) => String(candidate?.id || '') === String(candidateId || '')) || null;
}

function findStoredLookupMatch(reviewDecision = {}, matchId = '') {
  const matches = Array.isArray(reviewDecision?.capture_lookup_matches) ? reviewDecision.capture_lookup_matches : [];
  return matches.find((match) => String(match?.id || '') === String(matchId || '')) || null;
}

function sanitizeLookupMatches(matches = []) {
  return (Array.isArray(matches) ? matches : []).slice(0, 10).map((match) => ({
    id: match.id || null,
    source: match.source || null,
    match_type: match.match_type || null,
    media_id: match.media_id ?? null,
    title: match.title || match.normalizedTitle || match.searchTitle || '',
    normalizedTitle: match.normalizedTitle || match.title || '',
    searchTitle: match.searchTitle || match.normalizedTitle || match.title || '',
    description: match.description || null,
    image: match.image || null,
    upc: match.upc || match.barcode || null,
    barcode: match.barcode || match.upc || null,
    symbology: match.symbology || null,
    mediaTypeGuess: match.mediaTypeGuess || match.media_type || null,
    media_type: match.media_type || match.mediaTypeGuess || null,
    year: match.year || null,
    already_imported: Boolean(match.already_imported),
    provider_candidate_index: match.provider_candidate_index ?? null,
    typeDetails: match.typeDetails || match.type_details || {},
    type_details: match.type_details || match.typeDetails || {}
  }));
}

function compareReplayField(field, currentValue, incomingValue) {
  const normalizedCurrent = nullableString(currentValue);
  const normalizedIncoming = nullableString(incomingValue);
  if (!normalizedIncoming || !normalizedCurrent || normalizedIncoming === normalizedCurrent) return null;
  return { field, existing: normalizedCurrent, incoming: normalizedIncoming };
}

function buildReplayConflicts(current, item) {
  return [
    compareReplayField('title', current.title, item.title),
    compareReplayField('capture_type', current.capture_type, item.capture_type),
    compareReplayField('object_type', current.object_type, item.object_type),
    compareReplayField('barcode', current.barcode, item.barcode),
    compareReplayField('symbology', current.symbology, item.symbology),
    compareReplayField('ocr_text', current.ocr_text, item.ocr_text),
    compareReplayField('image_path', current.image_path, item.image_path)
  ].filter(Boolean);
}

function mergeReplayConflictReview(currentReviewDecision = {}, conflicts = [], item = {}) {
  const current = jsonObject(currentReviewDecision);
  if (!conflicts.length) {
    return {
      ...current,
      capture_replay_last_status: 'matched'
    };
  }
  const previous = Array.isArray(current.capture_replay_conflicts) ? current.capture_replay_conflicts : [];
  const replayRecord = {
    status: 'needs_review',
    received_at: new Date().toISOString(),
    fields: conflicts,
    incoming: {
      title: item.title ?? null,
      capture_type: item.capture_type ?? null,
      object_type: item.object_type ?? null,
      barcode: item.barcode ?? null,
      symbology: item.symbology ?? null,
      ocr_text: item.ocr_text ?? null,
      image_path: item.image_path ?? null
    }
  };
  return {
    ...current,
    capture_replay_last_status: 'needs_review',
    capture_replay_conflict_count: previous.length + 1,
    capture_replay_conflicts: [...previous.slice(-4), replayRecord]
  };
}

function getLatestOpenReplayConflict(reviewDecision = {}) {
  const conflicts = Array.isArray(reviewDecision?.capture_replay_conflicts) ? reviewDecision.capture_replay_conflicts : [];
  for (let index = conflicts.length - 1; index >= 0; index -= 1) {
    const conflict = conflicts[index];
    if (conflict?.status === 'needs_review' && Array.isArray(conflict.fields) && conflict.fields.length) {
      return { conflict, index, conflicts };
    }
  }
  return { conflict: null, index: -1, conflicts };
}

function resolveReplayConflictReview(currentReviewDecision = {}, action = 'keep_existing') {
  const current = jsonObject(currentReviewDecision);
  const { conflict, index, conflicts } = getLatestOpenReplayConflict(current);
  if (!conflict) return { reviewDecision: current, conflict: null, appliedFields: [] };

  const resolvedAt = new Date().toISOString();
  const nextConflicts = conflicts.slice();
  nextConflicts[index] = {
    ...conflict,
    status: action === 'apply_incoming' ? 'applied_incoming' : 'kept_existing',
    resolved_at: resolvedAt,
    resolution: action
  };

  return {
    reviewDecision: {
      ...current,
      capture_replay_last_status: 'resolved',
      capture_replay_last_resolution: action,
      capture_replay_resolved_at: resolvedAt,
      capture_replay_conflicts: nextConflicts
    },
    conflict,
    appliedFields: action === 'apply_incoming' ? conflict.fields : []
  };
}

function applyReplayFieldValue(field, value, currentValue) {
  switch (field) {
    case 'title':
      return nullableString(value) ?? currentValue ?? null;
    case 'capture_type':
      return normalizeCaptureType(value, currentValue || 'manual_note');
    case 'object_type':
      return normalizeObjectType(value, currentValue || 'other');
    case 'barcode':
    case 'symbology':
    case 'ocr_text':
    case 'image_path':
      return nullableString(value);
    default:
      return currentValue ?? null;
  }
}

function buildScopedWhere(params, scopeContext, id = null) {
  let where = 'WHERE 1=1';
  if (id !== null && id !== undefined) {
    params.push(id);
    where += ` AND id = $${params.length}`;
  }
  where += appendScopeSql(params, scopeContext);
  return where;
}

async function fetchCaptureItem(id, scopeContext) {
  const params = [];
  const where = buildScopedWhere(params, scopeContext, id);
  const result = await pool.query(`SELECT * FROM capture_items ${where} LIMIT 1`, params);
  return result.rows[0] || null;
}

async function fetchCaptureItemByClientCaptureId(clientCaptureId, scopeContext) {
  const normalized = nullableString(clientCaptureId);
  if (!normalized) return null;
  const params = [normalized];
  let where = "WHERE source_context->>'client_capture_id' = $1";
  where += appendScopeSql(params, scopeContext);
  const result = await pool.query(
    `SELECT *
       FROM capture_items
      ${where}
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    params
  );
  return result.rows[0] || null;
}

async function updateCaptureItemFromRetry(existing, item, scopeContext, req, action = 'capture.idempotent_replay') {
  const current = shapeCaptureItem(existing);
  const replayConflicts = buildReplayConflicts(current, item);
  const sourceContext = {
    ...current.source_context,
    ...mergeClientCaptureContext(req.body || {}, item.source_context || {}),
    idempotent_replayed_at: new Date().toISOString(),
    ...(replayConflicts.length ? { idempotent_replay_status: 'needs_review' } : { idempotent_replay_status: 'matched' })
  };
  const reviewDecision = mergeReplayConflictReview(
    {
      ...current.review_decision,
      ...jsonObject(item.review_decision)
    },
    replayConflicts,
    item
  );
  const shouldApplyIncoming = replayConflicts.length === 0;

  const result = await pool.query(
    `UPDATE capture_items
        SET title = CASE WHEN $13::boolean THEN COALESCE($1, title) ELSE title END,
            capture_type = CASE WHEN $13::boolean THEN COALESCE($2, capture_type) ELSE capture_type END,
            status = CASE
              WHEN status IN ('converted', 'discarded') THEN status
              WHEN $13::boolean THEN COALESCE($3, status)
              ELSE status
            END,
            object_type = CASE WHEN $13::boolean THEN COALESCE($4, object_type) ELSE object_type END,
            barcode = CASE WHEN $13::boolean THEN COALESCE($5, barcode) ELSE barcode END,
            symbology = CASE WHEN $13::boolean THEN COALESCE($6, symbology) ELSE symbology END,
            ocr_text = CASE WHEN $13::boolean THEN COALESCE($7, ocr_text) ELSE ocr_text END,
            notes = COALESCE($8, notes),
            image_path = CASE WHEN $13::boolean THEN COALESCE($9, image_path) ELSE image_path END,
            source_context = $10::jsonb,
            review_decision = $11::jsonb,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $12
      RETURNING *`,
    [
      item.title ?? null,
      item.capture_type || null,
      item.status || null,
      item.object_type || null,
      item.barcode ?? null,
      item.symbology ?? null,
      item.ocr_text ?? null,
      item.notes ?? null,
      item.image_path ?? null,
      JSON.stringify(sourceContext),
      JSON.stringify(reviewDecision),
      current.id,
      shouldApplyIncoming
    ]
  );

  const updated = shapeCaptureItem(result.rows[0]);
  await logActivity(req, action, 'capture_item', updated.id, {
    title: updated.title,
    captureType: updated.capture_type,
    clientCaptureId: updated.client_capture_id,
    replayConflictCount: replayConflicts.length,
    status: updated.status,
    spaceId: scopeContext.spaceId,
    libraryId: scopeContext.libraryId
  });
  return { item: updated, conflicts: replayConflicts };
}

router.get('/capture-items', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const params = [];
  let where = 'WHERE 1=1';

  const status = trimString(req.query.status).toLowerCase();
  if (status && status !== 'all' && STATUSES.has(status)) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  } else if (status === '' || status === 'active') {
    params.push(['new', 'reviewed']);
    where += ` AND status = ANY($${params.length})`;
  }

  const captureType = normalizeCaptureType(req.query.capture_type, null);
  if (captureType) {
    params.push(captureType);
    where += ` AND capture_type = $${params.length}`;
  }

  const search = trimString(req.query.search);
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where += ` AND (
      LOWER(COALESCE(title, '')) LIKE $${params.length}
      OR LOWER(COALESCE(barcode, '')) LIKE $${params.length}
      OR LOWER(COALESCE(ocr_text, '')) LIKE $${params.length}
      OR LOWER(COALESCE(notes, '')) LIKE $${params.length}
    )`;
  }

  where += appendScopeSql(params, scopeContext);
  const baseWhere = where;

  const reviewFilter = normalizeReviewFilter(req.query.review_filter);
  if (reviewFilter !== 'all') {
    where += ` AND ${captureReviewFilterCondition(reviewFilter)}`;
  }

  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const page = Math.max(1, Number(req.query.page || 1));
  const offset = (page - 1) * limit;

  const totalResult = await pool.query(`SELECT COUNT(*)::int AS total FROM capture_items ${where}`, params);
  const countResult = await pool.query(
    `SELECT
        COUNT(*)::int AS all_count,
        COUNT(*) FILTER (WHERE ${captureReviewFilterCondition('needs_choice')})::int AS needs_choice,
        COUNT(*) FILTER (WHERE ${captureReviewFilterCondition('no_match')})::int AS no_match,
        COUNT(*) FILTER (WHERE ${captureReviewFilterCondition('ready')})::int AS ready,
        COUNT(*) FILTER (WHERE ${captureReviewFilterCondition('missing_details')})::int AS missing_details,
        COUNT(*) FILTER (WHERE ${captureReviewFilterCondition('problems')})::int AS problems
       FROM capture_items
      ${baseWhere}`,
    params
  );
  const listParams = params.slice();
  listParams.push(limit, offset);
  const result = await pool.query(
    `SELECT *
       FROM capture_items
      ${where}
      ORDER BY
        CASE status WHEN 'new' THEN 0 WHEN 'reviewed' THEN 1 WHEN 'converted' THEN 2 ELSE 3 END,
        updated_at DESC,
        id DESC
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  const reviewCounts = countResult.rows[0] || {};

  res.json({
    items: result.rows.map(shapeCaptureItem),
    review_filter: reviewFilter,
    review_counts: {
      all: reviewCounts.all_count || 0,
      needs_choice: reviewCounts.needs_choice || 0,
      no_match: reviewCounts.no_match || 0,
      ready: reviewCounts.ready || 0,
      missing_details: reviewCounts.missing_details || 0,
      problems: reviewCounts.problems || 0
    },
    pagination: {
      page,
      limit,
      total: totalResult.rows[0]?.total || 0,
      total_pages: Math.max(1, Math.ceil((totalResult.rows[0]?.total || 0) / limit))
    }
  });
}));

router.post('/capture-items', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const item = valuesFromBody(req.body || {});
  const hasUsefulCapture = Boolean(item.title || item.barcode || item.ocr_text || item.notes || item.image_path);
  if (!hasUsefulCapture) {
    return res.status(400).json({ error: 'Capture needs a title, barcode, OCR text, note, or image path.' });
  }

  const clientCaptureId = extractClientCaptureId(req.body || {}, item.source_context || {});
  const existing = await fetchCaptureItemByClientCaptureId(clientCaptureId, scopeContext);
  if (existing) {
    const retryResult = await updateCaptureItemFromRetry(existing, item, scopeContext, req);
    return res.json({
      item: retryResult.item,
      idempotent: true,
      idempotency: {
        replayed: true,
        client_capture_id: retryResult.item.client_capture_id,
        conflict_count: retryResult.conflicts.length,
        status: retryResult.conflicts.length ? 'needs_review' : 'matched'
      },
      replay_conflicts: retryResult.conflicts
    });
  }

  const result = await pool.query(
    `INSERT INTO capture_items (
       title, capture_type, status, object_type, barcode, symbology, ocr_text, notes, image_path,
       source_context, review_decision, library_id, space_id, created_by
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10::jsonb, $11::jsonb, $12, $13, $14
     )
     RETURNING *`,
    [
      item.title ?? null,
      item.capture_type || 'manual_note',
      item.status || 'new',
      item.object_type || 'other',
      item.barcode ?? null,
      item.symbology ?? null,
      item.ocr_text ?? null,
      item.notes ?? null,
      item.image_path ?? null,
      JSON.stringify(item.source_context || {}),
      JSON.stringify(item.review_decision || {}),
      scopeContext.libraryId,
      scopeContext.spaceId,
      req.user?.id || null
    ]
  );

  const created = shapeCaptureItem(result.rows[0]);
  await logActivity(req, 'capture.create', 'capture_item', created.id, {
    title: created.title,
    captureType: created.capture_type,
    status: created.status,
    barcode: created.barcode,
    spaceId: created.space_id,
    libraryId: created.library_id
  });
  return res.status(201).json({ item: created });
}));

router.post('/capture-items/upload-image', memoryUpload.single('image'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  if (!req.file) return res.status(400).json({ error: 'Image file is required.' });

  const mimeType = String(req.file.mimetype || '').toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    return res.status(400).json({ error: 'Unsupported image type. Use JPEG, PNG, WEBP, or GIF.' });
  }

  const bodyItem = valuesFromBody(req.body || {});
  const preUploadSourceContext = mergeClientCaptureContext(req.body || {}, bodyItem.source_context || {});
  const clientCaptureId = extractClientCaptureId(req.body || {}, preUploadSourceContext);
  const existing = await fetchCaptureItemByClientCaptureId(clientCaptureId, scopeContext);
  if (existing) {
    const current = shapeCaptureItem(existing);
    if (current.image_path) {
      const retryResult = await updateCaptureItemFromRetry(
        existing,
        {
          ...bodyItem,
          title: bodyItem.title || nullableString(req.body?.name) || nullableString(req.file.originalname),
          capture_type: 'photo',
          source_context: preUploadSourceContext
        },
        scopeContext,
        req,
        'capture.image.idempotent_replay'
      );
      return res.json({
        item: retryResult.item,
        upload: {
          image_path: retryResult.item.image_path,
          provider: retryResult.item.source_context?.upload_provider || current.source_context?.upload_provider || 'existing'
        },
        idempotent: true,
        idempotency: {
          replayed: true,
          client_capture_id: retryResult.item.client_capture_id,
          conflict_count: retryResult.conflicts.length,
          status: retryResult.conflicts.length ? 'needs_review' : 'matched'
        },
        replay_conflicts: retryResult.conflicts
      });
    }
  }

  const stored = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
  const sourceContext = {
    source: 'capture_upload',
    upload_provider: stored.provider,
    original_filename: nullableString(req.file.originalname),
    mime_type: req.file.mimetype || null,
    size_bytes: req.file.size || null,
    ...mergeClientCaptureContext(req.body || {}, bodyItem.source_context || {})
  };
  const title = bodyItem.title || nullableString(req.body?.name) || nullableString(req.file.originalname) || 'Photo capture';
  if (existing) {
    const retryResult = await updateCaptureItemFromRetry(
      existing,
      {
        ...bodyItem,
        title,
        capture_type: 'photo',
        image_path: stored.url,
        source_context: sourceContext
      },
      scopeContext,
      req,
      'capture.image.idempotent_replay'
    );
    return res.json({
      item: retryResult.item,
      upload: { image_path: stored.url, provider: stored.provider },
      idempotent: true,
      idempotency: {
        replayed: true,
        client_capture_id: retryResult.item.client_capture_id,
        conflict_count: retryResult.conflicts.length,
        status: retryResult.conflicts.length ? 'needs_review' : 'matched'
      },
      replay_conflicts: retryResult.conflicts
    });
  }

  const result = await pool.query(
    `INSERT INTO capture_items (
       title, capture_type, status, object_type, barcode, symbology, ocr_text, notes, image_path,
       source_context, review_decision, library_id, space_id, created_by
     )
     VALUES (
       $1, 'photo', $2, $3, $4, $5, $6, $7, $8,
       $9::jsonb, $10::jsonb, $11, $12, $13
     )
     RETURNING *`,
    [
      title,
      bodyItem.status || 'new',
      bodyItem.object_type || 'other',
      bodyItem.barcode ?? null,
      bodyItem.symbology ?? null,
      bodyItem.ocr_text ?? null,
      bodyItem.notes ?? null,
      stored.url,
      JSON.stringify(sourceContext),
      JSON.stringify(bodyItem.review_decision || {}),
      scopeContext.libraryId,
      scopeContext.spaceId,
      req.user?.id || null
    ]
  );

  const created = shapeCaptureItem(result.rows[0]);
  await logActivity(req, 'capture.image.upload', 'capture_item', created.id, {
    title: created.title,
    captureType: created.capture_type,
    imagePath: created.image_path,
    provider: stored.provider,
    spaceId: created.space_id,
    libraryId: created.library_id
  });
  return res.status(201).json({ item: created, upload: { image_path: stored.url, provider: stored.provider } });
}));

router.post('/capture-items/:id/ocr-text', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Capture item not found.' });

  const scopeContext = resolveScopeContext(req);
  const current = await fetchCaptureItem(id, scopeContext);
  if (!current) return res.status(404).json({ error: 'Capture item not found.' });

  const ocrText = nullableString(req.body?.ocr_text ?? req.body?.text);
  if (!ocrText) return res.status(400).json({ error: 'OCR text is required.' });

  const extracted = buildCaptureOcrCandidates(ocrText);
  const shapedCurrent = shapeCaptureItem(current);
  const sourceContext = mergeReviewDecision(shapedCurrent.source_context, {
    ocr_source: nullableString(req.body?.source) || 'client',
    ocr_updated_at: new Date().toISOString()
  });
  const reviewDecision = mergeReviewDecision(shapedCurrent.review_decision, {
    ocr_candidates: extracted.candidates,
    ocr_candidate_summary: {
      isbn: extracted.isbnCandidates.length,
      upc: extracted.upcCandidates.length,
      asin: extracted.asinCandidates.length
    }
  });

  const result = await pool.query(
    `UPDATE capture_items
        SET ocr_text = $1,
            capture_type = CASE WHEN capture_type = 'manual_note' THEN 'ocr_text' ELSE capture_type END,
            source_context = $2::jsonb,
            review_decision = $3::jsonb,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *`,
    [
      extracted.rawText || ocrText,
      JSON.stringify(sourceContext),
      JSON.stringify(reviewDecision),
      id
    ]
  );

  const updated = shapeCaptureItem(result.rows[0]);
  await logActivity(req, 'capture.ocr.extract', 'capture_item', updated.id, {
    title: updated.title,
    captureType: updated.capture_type,
    candidateCount: extracted.candidates.length,
    spaceId: updated.space_id,
    libraryId: updated.library_id
  });
  return res.json({ item: updated, candidates: extracted.candidates, parsed: extracted });
}));

router.post('/capture-items/:id/ocr-image', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Capture item not found.' });

  const scopeContext = resolveScopeContext(req);
  const current = await fetchCaptureItem(id, scopeContext);
  if (!current) return res.status(404).json({ error: 'Capture item not found.' });

  const shapedCurrent = shapeCaptureItem(current);
  if (!shapedCurrent.image_path) return res.status(400).json({ error: 'Capture needs an uploaded image before backend OCR can run.' });

  const imageBuffer = await readLocalUploadBuffer(shapedCurrent.image_path);
  if (!imageBuffer) {
    return res.status(400).json({ error: 'Backend OCR currently supports images stored by the local upload provider.' });
  }

  const integrationRow = await loadIntegrationConfigRow(scopeContext.spaceId, { allowFallback: true });
  const config = normalizeIntegrationRecord(integrationRow || null);
  const ocrResult = await extractTextFromImageBuffer(imageBuffer, {
    filename: shapedCurrent.source_context?.original_filename || `capture-${id}`,
    mimeType: shapedCurrent.source_context?.mime_type || 'application/octet-stream',
    config
  });
  const extracted = buildCaptureOcrCandidates(ocrResult.text || '');
  const sourceContext = mergeReviewDecision(shapedCurrent.source_context, {
    ocr_source: 'backend_image',
    ocr_image_provider: ocrResult.provider,
    ocr_image_processed_at: new Date().toISOString()
  });
  const reviewDecision = mergeReviewDecision(shapedCurrent.review_decision, {
    ocr_candidates: extracted.candidates,
    ocr_candidate_summary: {
      isbn: extracted.isbnCandidates.length,
      upc: extracted.upcCandidates.length,
      asin: extracted.asinCandidates.length
    },
    ocr_image_status: {
      provider: ocrResult.provider,
      text_length: String(ocrResult.text || '').length,
      candidate_count: extracted.candidates.length,
      processed_at: sourceContext.ocr_image_processed_at
    }
  });

  const result = await pool.query(
    `UPDATE capture_items
        SET ocr_text = $1,
            capture_type = CASE WHEN capture_type = 'manual_note' THEN 'photo' ELSE capture_type END,
            source_context = $2::jsonb,
            review_decision = $3::jsonb,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *`,
    [
      extracted.rawText || ocrResult.text || null,
      JSON.stringify(sourceContext),
      JSON.stringify(reviewDecision),
      id
    ]
  );

  const updated = shapeCaptureItem(result.rows[0]);
  await logActivity(req, 'capture.ocr.image_extract', 'capture_item', updated.id, {
    title: updated.title,
    captureType: updated.capture_type,
    provider: ocrResult.provider,
    textLength: String(ocrResult.text || '').length,
    candidateCount: extracted.candidates.length,
    spaceId: updated.space_id,
    libraryId: updated.library_id
  });
  return res.json({
    item: updated,
    candidates: extracted.candidates,
    parsed: extracted,
    ocr: {
      provider: ocrResult.provider,
      text_length: String(ocrResult.text || '').length
    }
  });
}));

router.post('/capture-items/:id/apply-ocr-candidate', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Capture item not found.' });

  const scopeContext = resolveScopeContext(req);
  const current = await fetchCaptureItem(id, scopeContext);
  if (!current) return res.status(404).json({ error: 'Capture item not found.' });

  const shapedCurrent = shapeCaptureItem(current);
  const candidateId = nullableString(req.body?.candidate_id);
  const candidate = candidateId
    ? findStoredOcrCandidate(shapedCurrent.review_decision, candidateId)
    : jsonObject(req.body?.candidate);
  if (!candidate?.barcode) return res.status(400).json({ error: 'OCR candidate is required.' });

  const reviewDecision = mergeReviewDecision(shapedCurrent.review_decision, {
    selected_ocr_candidate: candidate,
    selected_ocr_candidate_at: new Date().toISOString()
  });
  const objectType = normalizeObjectType(candidate.media_type || candidate.mediaTypeGuess, shapedCurrent.object_type || 'other');

  const result = await pool.query(
    `UPDATE capture_items
        SET barcode = $1,
            symbology = $2,
            object_type = $3,
            review_decision = $4::jsonb,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING *`,
    [
      nullableString(candidate.barcode || candidate.value),
      nullableString(candidate.symbology),
      objectType,
      JSON.stringify(reviewDecision),
      id
    ]
  );

  const updated = shapeCaptureItem(result.rows[0]);
  await logActivity(req, 'capture.ocr.apply_candidate', 'capture_item', updated.id, {
    title: updated.title,
    captureType: updated.capture_type,
    candidateId: candidate.id || null,
    barcode: updated.barcode,
    symbology: updated.symbology,
    spaceId: updated.space_id,
    libraryId: updated.library_id
  });
  return res.json({ item: updated, candidate });
}));

router.post('/capture-items/:id/lookup-matches', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Capture item not found.' });

  const scopeContext = resolveScopeContext(req);
  const current = await fetchCaptureItem(id, scopeContext);
  if (!current) return res.status(404).json({ error: 'Capture item not found.' });

  const shapedCurrent = shapeCaptureItem(current);
  const barcode = nullableString(req.body?.barcode) || shapedCurrent.barcode;
  if (!barcode) return res.status(400).json({ error: 'Capture needs a barcode or applied OCR candidate before match lookup.' });
  if (typeof mediaRouter.lookupScannerBarcodeCandidates !== 'function') {
    return res.status(409).json({ error: 'Barcode lookup is not available in this runtime.' });
  }

  const limit = Math.max(1, Math.min(10, Number(req.body?.limit || 6)));
  const lookup = await mediaRouter.lookupScannerBarcodeCandidates({
    barcode,
    symbology: nullableString(req.body?.symbology) || shapedCurrent.symbology || '',
    mediaType: nullableString(req.body?.media_type) || shapedCurrent.object_type || null,
    limit,
    scopeContext
  });
  const matches = sanitizeLookupMatches(lookup.matches || []);
  const lookedUpAt = new Date().toISOString();
  const reviewDecision = mergeReviewDecision(shapedCurrent.review_decision, {
    capture_lookup_matches: matches,
    capture_lookup_status: {
      barcode: lookup.barcode || barcode,
      symbology: lookup.symbology || shapedCurrent.symbology || null,
      provider: lookup.provider || null,
      provider_error: lookup.provider_error || null,
      catalog_count: lookup.catalog_count || 0,
      provider_count: lookup.provider_count || 0,
      match_count: matches.length,
      looked_up_at: lookedUpAt
    }
  });
  const sourceContext = mergeReviewDecision(shapedCurrent.source_context, {
    capture_lookup_source: 'backend',
    capture_lookup_last_at: lookedUpAt
  });

  const result = await pool.query(
    `UPDATE capture_items
        SET review_decision = $1::jsonb,
            source_context = $2::jsonb,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *`,
    [
      JSON.stringify(reviewDecision),
      JSON.stringify(sourceContext),
      id
    ]
  );

  const updated = shapeCaptureItem(result.rows[0]);
  await logActivity(req, 'capture.lookup_matches', 'capture_item', updated.id, {
    title: updated.title,
    captureType: updated.capture_type,
    barcode: lookup.barcode || barcode,
    matchCount: matches.length,
    catalogCount: lookup.catalog_count || 0,
    providerCount: lookup.provider_count || 0,
    provider: lookup.provider || null,
    providerError: lookup.provider_error || null,
    spaceId: updated.space_id,
    libraryId: updated.library_id
  });
  return res.json({
    item: updated,
    matches,
    lookup: {
      provider: lookup.provider || null,
      barcode: lookup.barcode || barcode,
      symbology: lookup.symbology || shapedCurrent.symbology || null,
      count: matches.length,
      catalog_count: lookup.catalog_count || 0,
      provider_count: lookup.provider_count || 0,
      provider_error: lookup.provider_error || null
    }
  });
}));

router.post('/capture-items/:id/import-match', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Capture item not found.' });

  const scopeContext = resolveScopeContext(req);
  const current = await fetchCaptureItem(id, scopeContext);
  if (!current) return res.status(404).json({ error: 'Capture item not found.' });

  const shapedCurrent = shapeCaptureItem(current);
  const matchId = nullableString(req.body?.match_id);
  const storedMatch = matchId ? findStoredLookupMatch(shapedCurrent.review_decision, matchId) : null;
  const providedMatch = jsonObject(req.body?.match || req.body?.selectedMatch);
  const selectedMatch = storedMatch || providedMatch;
  if (!selectedMatch?.media_id && !selectedMatch?.title) {
    return res.status(400).json({ error: 'Select a stored lookup match or provide a match with a title.' });
  }
  if (matchId && !storedMatch) {
    return res.status(404).json({ error: 'Stored lookup match not found for this capture.' });
  }
  if (typeof mediaRouter.importBarcodeMatchForRequest !== 'function') {
    return res.status(409).json({ error: 'Barcode import is not available in this runtime.' });
  }

  const barcode = nullableString(req.body?.barcode)
    || selectedMatch.barcode
    || selectedMatch.upc
    || shapedCurrent.barcode
    || '';
  const importResult = await mediaRouter.importBarcodeMatchForRequest(req, {
    scopeContext,
    selectedMatch,
    barcode,
    symbology: nullableString(req.body?.symbology) || selectedMatch.symbology || shapedCurrent.symbology || '',
    mediaType: nullableString(req.body?.media_type) || selectedMatch.media_type || selectedMatch.mediaTypeGuess || shapedCurrent.object_type || null,
    importSource: 'capture_lookup',
    activityAction: 'media.import_capture_lookup',
    existingActivityAction: 'media.import_capture_lookup.existing'
  });
  if (!importResult?.body?.ok || !importResult.body.media_id) {
    return res.status(importResult?.statusCode || 400).json(importResult?.body || { error: 'Capture match import failed.' });
  }

  const importedAt = new Date().toISOString();
  const reviewDecision = mergeReviewDecision(shapedCurrent.review_decision, {
    selected_capture_lookup_match: selectedMatch,
    selected_capture_lookup_match_at: importedAt,
    capture_import_result: {
      status: importResult.body.status || null,
      action: importResult.body.action || null,
      media_id: importResult.body.media_id,
      matched_by: importResult.body.matched_by || null,
      match_mode: importResult.body.match_mode || null,
      enrichment_status: importResult.body.enrichment_status || null,
      lookup_path: importResult.body.lookup_path || null,
      lookup_status: importResult.body.lookup_status || null,
      imported_at: importedAt
    },
    converted_to: 'media'
  });
  const sourceContext = mergeReviewDecision(shapedCurrent.source_context, {
    capture_import_source: 'lookup_match',
    capture_imported_at: importedAt
  });

  const result = await pool.query(
    `UPDATE capture_items
        SET status = 'converted',
            linked_media_id = $1,
            converted_at = COALESCE(converted_at, CURRENT_TIMESTAMP),
            review_decision = $2::jsonb,
            source_context = $3::jsonb,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *`,
    [
      importResult.body.media_id,
      JSON.stringify(reviewDecision),
      JSON.stringify(sourceContext),
      id
    ]
  );

  const updated = shapeCaptureItem(result.rows[0]);
  await logActivity(req, 'capture.import_match', 'capture_item', updated.id, {
    title: updated.title,
    captureType: updated.capture_type,
    mediaId: importResult.body.media_id,
    importStatus: importResult.body.status || null,
    matchId: selectedMatch.id || null,
    barcode: importResult.body.barcode || barcode || null,
    spaceId: updated.space_id,
    libraryId: updated.library_id
  });
  return res.status(importResult.statusCode || 200).json({
    ok: true,
    item: updated,
    import: importResult.body,
    match: selectedMatch
  });
}));

router.post('/capture-items/:id/resolve-replay-conflict', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Capture item not found.' });

  const action = trimString(req.body?.action || 'keep_existing').toLowerCase();
  if (!['keep_existing', 'apply_incoming'].includes(action)) {
    return res.status(400).json({ error: 'Use action keep_existing or apply_incoming.' });
  }

  const scopeContext = resolveScopeContext(req);
  const current = await fetchCaptureItem(id, scopeContext);
  if (!current) return res.status(404).json({ error: 'Capture item not found.' });

  const shapedCurrent = shapeCaptureItem(current);
  const { reviewDecision, conflict, appliedFields } = resolveReplayConflictReview(shapedCurrent.review_decision, action);
  if (!conflict) return res.status(409).json({ error: 'No replay conflict needs review for this capture.' });

  const nextValues = {
    title: shapedCurrent.title,
    capture_type: shapedCurrent.capture_type,
    object_type: shapedCurrent.object_type,
    barcode: shapedCurrent.barcode,
    symbology: shapedCurrent.symbology,
    ocr_text: shapedCurrent.ocr_text,
    image_path: shapedCurrent.image_path
  };
  appliedFields.forEach((fieldConflict) => {
    if (!fieldConflict?.field) return;
    nextValues[fieldConflict.field] = applyReplayFieldValue(
      fieldConflict.field,
      fieldConflict.incoming,
      nextValues[fieldConflict.field]
    );
  });

  const sourceContext = {
    ...shapedCurrent.source_context,
    idempotent_replay_status: 'resolved',
    idempotent_replay_resolution: action,
    idempotent_replay_resolved_at: reviewDecision.capture_replay_resolved_at
  };

  const result = await pool.query(
    `UPDATE capture_items
        SET title = $1,
            capture_type = $2,
            object_type = $3,
            barcode = $4,
            symbology = $5,
            ocr_text = $6,
            image_path = $7,
            source_context = $8::jsonb,
            review_decision = $9::jsonb,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
      RETURNING *`,
    [
      nextValues.title,
      nextValues.capture_type,
      nextValues.object_type,
      nextValues.barcode,
      nextValues.symbology,
      nextValues.ocr_text,
      nextValues.image_path,
      JSON.stringify(sourceContext),
      JSON.stringify(reviewDecision),
      id
    ]
  );

  const updated = shapeCaptureItem(result.rows[0]);
  await logActivity(req, 'capture.replay_conflict.resolve', 'capture_item', updated.id, {
    title: updated.title,
    captureType: updated.capture_type,
    action,
    appliedFieldCount: appliedFields.length,
    spaceId: updated.space_id,
    libraryId: updated.library_id
  });
  return res.json({
    item: updated,
    resolution: {
      action,
      applied_fields: appliedFields.map((fieldConflict) => fieldConflict.field).filter(Boolean)
    }
  });
}));

router.patch('/capture-items/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Capture item not found.' });

  const scopeContext = resolveScopeContext(req);
  const current = await fetchCaptureItem(id, scopeContext);
  if (!current) return res.status(404).json({ error: 'Capture item not found.' });

  const next = valuesFromBody(req.body || {}, shapeCaptureItem(current));
  const result = await pool.query(
    `UPDATE capture_items
        SET title = $1,
            capture_type = $2,
            status = $3,
            object_type = $4,
            barcode = $5,
            symbology = $6,
            ocr_text = $7,
            notes = $8,
            image_path = $9,
            source_context = $10::jsonb,
            review_decision = $11::jsonb,
            reviewed_at = CASE WHEN $3 = 'reviewed' THEN COALESCE(reviewed_at, CURRENT_TIMESTAMP) ELSE reviewed_at END,
            discarded_at = CASE WHEN $3 = 'discarded' THEN COALESCE(discarded_at, CURRENT_TIMESTAMP) ELSE discarded_at END
      WHERE id = $12
      RETURNING *`,
    [
      next.title ?? null,
      next.capture_type,
      next.status,
      next.object_type,
      next.barcode,
      next.symbology,
      next.ocr_text,
      next.notes,
      next.image_path,
      JSON.stringify(next.source_context || {}),
      JSON.stringify(next.review_decision || {}),
      id
    ]
  );

  const updated = shapeCaptureItem(result.rows[0]);
  await logActivity(req, 'capture.update', 'capture_item', updated.id, {
    title: updated.title,
    captureType: updated.capture_type,
    status: updated.status,
    spaceId: updated.space_id,
    libraryId: updated.library_id
  });
  return res.json({ item: updated });
}));

router.post('/capture-items/:id/convert-wishlist', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Capture item not found.' });

  const scopeContext = resolveScopeContext(req);
  const capture = await fetchCaptureItem(id, scopeContext);
  if (!capture) return res.status(404).json({ error: 'Capture item not found.' });

  const shaped = shapeCaptureItem(capture);
  const title = nullableString(req.body?.title) || shaped.title || shaped.barcode || 'Captured item';
  const identifiers = {
    ...(shaped.barcode ? { barcode: shaped.barcode } : {}),
    ...(shaped.symbology ? { symbology: shaped.symbology } : {})
  };
  const sourceContext = {
    source: 'capture',
    capture_item_id: shaped.id,
    capture_type: shaped.capture_type,
    ...(shaped.source_context || {})
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wantedResult = await client.query(
      `INSERT INTO wanted_items (
         title, object_type, status, priority, notes, identifiers, source_context,
         provider, provider_key, library_id, space_id, created_by
       )
       VALUES ($1, $2, 'wanted', 'normal', $3, $4::jsonb, $5::jsonb, 'capture', $6, $7, $8, $9)
       RETURNING *`,
      [
        title,
        shaped.object_type || 'other',
        [shaped.notes, shaped.ocr_text ? `OCR: ${shaped.ocr_text}` : null].filter(Boolean).join('\n') || null,
        JSON.stringify(identifiers),
        JSON.stringify(sourceContext),
        `capture:${shaped.id}`,
        shaped.library_id,
        shaped.space_id,
        req.user?.id || null
      ]
    );
    const captureResult = await client.query(
      `UPDATE capture_items
          SET status = 'converted',
              wanted_item_id = $1,
              converted_at = COALESCE(converted_at, CURRENT_TIMESTAMP),
              review_decision = jsonb_set(COALESCE(review_decision, '{}'::jsonb), '{converted_to}', to_jsonb('wishlist'::text), true)
        WHERE id = $2
        RETURNING *`,
      [wantedResult.rows[0].id, shaped.id]
    );
    await client.query('COMMIT');

    const item = shapeCaptureItem(captureResult.rows[0]);
    await logActivity(req, 'capture.convert_wishlist', 'capture_item', item.id, {
      title,
      captureType: item.capture_type,
      wantedItemId: wantedResult.rows[0].id,
      spaceId: item.space_id,
      libraryId: item.library_id
    });
    return res.status(201).json({ ok: true, item, wanted_item: wantedResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

router.delete('/capture-items/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Capture item not found.' });

  const scopeContext = resolveScopeContext(req);
  const params = [];
  const where = buildScopedWhere(params, scopeContext, id);
  const result = await pool.query(`DELETE FROM capture_items ${where} RETURNING id, title, capture_type, space_id, library_id`, params);
  const deleted = result.rows[0];
  if (!deleted) return res.status(404).json({ error: 'Capture item not found.' });

  await logActivity(req, 'capture.delete', 'capture_item', deleted.id, {
    title: deleted.title,
    captureType: deleted.capture_type,
    spaceId: deleted.space_id,
    libraryId: deleted.library_id
  });
  return res.json({ ok: true, id: deleted.id });
}));

module.exports = router;
