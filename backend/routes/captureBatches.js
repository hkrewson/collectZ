'use strict';

const express = require('express');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const { resolveScopeContext } = require('../db/scopeContext');
const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');
const { logActivity } = require('../services/audit');
const { optionalNonNegativeInt, deriveCaptureBatchReviewStatus } = require('../services/captureBatchProgress');
const captureItemsRouter = require('./captureItems');

const router = express.Router();
const BATCH_STATUSES = new Set(['collecting', 'paused', 'ready']);
const OWNED_STATUSES = new Set(['owned', 'in collection']);
const PROVIDER = 'blu-ray.com';

router.use('/capture-batches', authenticateToken);
router.use('/capture-batches', enforceScopeAccess({ allowedHintRoles: ['admin'] }));

function clean(value, max = 500) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, max) : null;
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function positiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function isOwnedStatus(value) {
  return OWNED_STATUSES.has(
    String(value || '')
      .trim()
      .toLowerCase()
  );
}

function isEnrichedItem(value) {
  return clean(value?.enrichment_status, 40) === 'enriched';
}

function isEnrichedSourceContext(value) {
  return clean(object(value).enrichment_status, 40) === 'enriched';
}

function boundedEvidence(value, depth = 0) {
  if (depth > 3) return null;
  if (typeof value === 'string') return clean(value, 4000);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value))
    return value
      .slice(0, 20)
      .map((entry) => boundedEvidence(entry, depth + 1))
      .filter((entry) => entry !== null);
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 30)
      .map(([key, entry]) => [clean(key, 80), boundedEvidence(entry, depth + 1)])
      .filter(([key, entry]) => key && entry !== null)
  );
}

function itemIdentifiers(item, productId) {
  const supplied = object(item.identifiers);
  const identifiers = { bluray_product_id: productId };
  for (const key of [
    'bluray_content_id',
    'bluray_category_id',
    'bluray_global_parent_id',
    'bluray_global_product_id',
    'imdb_id',
    'asin',
    'upc',
    'ean'
  ]) {
    const value = clean(supplied[key], 255);
    if (value) identifiers[key] = value;
  }
  return identifiers;
}

function shapeBatch(row) {
  const enrichedItemCount = optionalNonNegativeInt(row.enriched_item_count) || 0;
  const enrichmentFailedItemCount = optionalNonNegativeInt(row.enrichment_failed_item_count) || 0;
  return {
    id: row.id,
    client_batch_id: row.client_batch_id,
    source_provider: row.source_provider,
    source_collection_key: row.source_collection_key,
    source_url: row.source_url,
    status: row.status,
    review_status: deriveCaptureBatchReviewStatus(row.status, enrichmentFailedItemCount),
    current_page: row.current_page,
    total_pages: row.total_pages,
    expected_item_count: row.expected_item_count,
    received_item_count: row.received_item_count,
    applied_item_count: row.applied_item_count,
    failed_item_count: row.failed_item_count,
    enriched_item_count: enrichedItemCount,
    enrichment_failed_item_count: enrichmentFailedItemCount,
    pause_reason: row.pause_reason,
    pause_detail: row.pause_detail,
    library_id: row.library_id,
    space_id: row.space_id,
    started_at: row.started_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function shapeItem(row) {
  const decision = object(row.review_decision);
  const batchReview = object(decision.batch_review);
  return {
    id: row.id,
    item_key: row.capture_batch_item_key,
    position: row.capture_batch_position,
    title: row.title,
    source_status: row.capture_batch_source_status,
    source_context: object(row.source_context),
    status: row.status,
    linked_media_id: row.linked_media_id,
    classification: batchReview.classification || 'needs_review',
    decision: batchReview.decision || 'pending',
    selected_media_id: batchReview.selected_media_id || null,
    candidates: Array.isArray(batchReview.candidates) ? batchReview.candidates : [],
    reason: batchReview.reason || null,
    apply_status: batchReview.apply_status || null,
    apply_error: batchReview.apply_error || null,
    updated_at: row.updated_at
  };
}

async function scopedQuery(req, scope, text, values) {
  return withAuthorizedScopeTransaction(pool, { spaceId: scope.spaceId, libraryId: scope.libraryId }, req.user.id, (client) =>
    client.query(text, values)
  );
}

async function findBatch(req, id, scope) {
  const result = await scopedQuery(
    req,
    scope,
    `SELECT * FROM capture_batches WHERE id = $1 AND space_id = $2 AND library_id = $3 LIMIT 1`,
    [id, scope.spaceId, scope.libraryId]
  );
  return result.rows[0] || null;
}

async function classifyItem(req, scope, item) {
  const productId = clean(item.product_id ?? item.bluray_product_id, 255);
  const title = clean(item.title, 500);
  const year = positiveInt(item.year);
  if (!isOwnedStatus(item.status)) {
    return { classification: 'needs_review', decision: 'skip', reason: 'Only an explicit Owned status can be applied.' };
  }
  if (!isEnrichedItem(item)) {
    return {
      classification: 'needs_review',
      decision: 'skip',
      reason: 'Edition detail enrichment must complete before this row can be reviewed for import.'
    };
  }
  if (!productId) {
    return { classification: 'missing_identity', decision: 'pending', reason: 'The provider product ID is missing.' };
  }

  const edition = await scopedQuery(
    req,
    scope,
    `SELECT cw.media_id, m.title, m.year
       FROM collection_editions ce
       JOIN collection_works cw ON cw.id = ce.work_id AND cw.space_id = ce.space_id AND cw.library_id = ce.library_id
       JOIN media m ON m.id = cw.media_id AND m.space_id = cw.space_id AND m.library_id = cw.library_id
      WHERE ce.space_id = $1 AND ce.library_id = $2
        AND ce.source_provider = $3 AND ce.source_item_id = $4
      LIMIT 1`,
    [scope.spaceId, scope.libraryId, PROVIDER, productId]
  );
  if (edition.rows[0]) {
    return {
      classification: 'exact_edition',
      decision: 'pending',
      selected_media_id: edition.rows[0].media_id,
      candidates: edition.rows,
      reason: 'Exact Blu-ray edition already exists; confirm Include after reviewing its evidence.'
    };
  }

  if (!title) return { classification: 'missing_identity', decision: 'pending', reason: 'The collection row has no title.' };
  const candidates = await scopedQuery(
    req,
    scope,
    `SELECT id AS media_id, title, year
       FROM media
      WHERE space_id = $1 AND library_id = $2 AND media_type = 'movie'
        AND lower(regexp_replace(btrim(title), '\\s+', ' ', 'g')) = lower($3)
        AND ($4::int IS NULL OR year = $4)
      ORDER BY updated_at DESC, id DESC
      LIMIT 5`,
    [scope.spaceId, scope.libraryId, title, year]
  );
  if (candidates.rowCount === 1) {
    return {
      classification: 'existing_work',
      decision: 'pending',
      selected_media_id: candidates.rows[0].media_id,
      candidates: candidates.rows,
      reason: 'One existing movie matches this title and year; confirm Include after reviewing its evidence.'
    };
  }
  if (candidates.rowCount > 1) {
    return {
      classification: 'needs_choice',
      decision: 'pending',
      candidates: candidates.rows,
      reason: 'More than one existing movie matches.'
    };
  }
  return {
    classification: 'new_work',
    decision: 'pending',
    candidates: [],
    reason: 'No existing movie matches; review will create it only after you confirm Include.'
  };
}

function sourceContextForItem(batch, item, productId) {
  const url = clean(item.url, 2000);
  const metadata = object(item.page_metadata);
  const mediaFormat = clean(metadata.media_format ?? item.format ?? item.media_format, 100);
  const year = positiveInt(item.year);
  const releaseDetails = object(metadata.release_details);
  const enrichmentStatus = ['enriched', 'failed', 'list_only'].includes(clean(item.enrichment_status, 40))
    ? clean(item.enrichment_status, 40)
    : 'list_only';
  const ownershipBasis = ['row_status', 'collection_page'].includes(clean(item.ownership_basis, 40))
    ? clean(item.ownership_basis, 40)
    : null;
  return {
    source: 'browser_extension',
    client_source: 'browser-extension',
    contract: 'collectz.bluray_collection_item.v1',
    extension_version: clean(item.extension_version, 40),
    adapter: 'bluray',
    url,
    canonical_url: url,
    page_title: clean(item.title, 500),
    detected_object_type: 'movie',
    identifiers: itemIdentifiers(item, productId),
    enrichment_status: enrichmentStatus,
    enrichment_error: clean(item.enrichment_error, 80),
    ownership_basis: ownershipBasis,
    page_metadata: {
      source_site: PROVIDER,
      bluray_product_id: productId,
      release_title: clean(metadata.release_title ?? item.release_title ?? item.title, 500),
      media_format: mediaFormat,
      edition: clean(metadata.edition, 500),
      country: clean(metadata.country, 120),
      collection_status: clean(item.status, 40),
      collection_page: positiveInt(item.page),
      ownership_basis: ownershipBasis,
      enrichment_status: enrichmentStatus,
      release_details: {
        studio: clean(releaseDetails.studio, 500),
        year: clean(releaseDetails.year, 20) || (year ? String(year) : null),
        runtime: clean(releaseDetails.runtime, 100),
        rating: clean(releaseDetails.rating, 100),
        release_date: clean(releaseDetails.release_date, 100)
      },
      specs: boundedEvidence(metadata.specs),
      ratings: boundedEvidence(metadata.ratings),
      pricing: boundedEvidence(metadata.pricing),
      cover_image_url: clean(metadata.cover_image_url, 2000),
      buy_url: clean(metadata.buy_url, 2000),
      imdb_url: clean(metadata.imdb_url, 2000),
      rotten_tomatoes_url: clean(metadata.rotten_tomatoes_url, 2000),
      trailer_url: clean(metadata.trailer_url, 2000)
    },
    captured_at: clean(item.captured_at, 50) || new Date().toISOString(),
    collection_batch_id: batch.id
  };
}

router.post(
  '/capture-batches',
  asyncHandler(async (req, res) => {
    const scope = resolveScopeContext(req);
    const clientBatchId = clean(req.body?.client_batch_id, 255);
    if (!clientBatchId) return res.status(400).json({ error: 'client_batch_id is required.' });
    const sourceUrl = clean(req.body?.source_url, 2000);
    const result = await scopedQuery(
      req,
      scope,
      `INSERT INTO capture_batches
       (space_id, library_id, client_batch_id, source_provider, source_collection_key, source_url, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (space_id, library_id, client_batch_id) DO UPDATE SET
       source_url = COALESCE(EXCLUDED.source_url, capture_batches.source_url), updated_at = CURRENT_TIMESTAMP
     RETURNING *, (xmax = 0) AS inserted`,
      [scope.spaceId, scope.libraryId, clientBatchId, PROVIDER, clean(req.body?.source_collection_key, 255), sourceUrl, req.user.id]
    );
    const batch = shapeBatch(result.rows[0]);
    await logActivity(req, 'capture_batch.create', 'capture_batch', null, {
      batchId: batch.id,
      spaceId: scope.spaceId,
      libraryId: scope.libraryId
    });
    return res.status(result.rows[0].inserted ? 201 : 200).json({ batch });
  })
);

router.get(
  '/capture-batches',
  asyncHandler(async (req, res) => {
    const scope = resolveScopeContext(req);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
    const includeCompleted = String(req.query.status || 'active') === 'all';
    const result = await scopedQuery(
      req,
      scope,
      `SELECT b.*, COALESCE(e.enriched_item_count, 0)::int AS enriched_item_count,
              COALESCE(e.enrichment_failed_item_count, 0)::int AS enrichment_failed_item_count
         FROM capture_batches b
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (WHERE ci.source_context->>'enrichment_status' = 'enriched') AS enriched_item_count,
                  COUNT(*) FILTER (WHERE ci.source_context->>'enrichment_status' = 'failed') AS enrichment_failed_item_count
             FROM capture_items ci
            WHERE ci.capture_batch_id = b.id
              AND ci.space_id = b.space_id
              AND ci.library_id = b.library_id
         ) e ON true
        WHERE b.space_id = $1 AND b.library_id = $2
          AND ($3::boolean OR b.status NOT IN ('completed', 'discarded'))
        ORDER BY b.updated_at DESC LIMIT $4`,
      [scope.spaceId, scope.libraryId, includeCompleted, limit]
    );
    return res.json({ batches: result.rows.map(shapeBatch) });
  })
);

router.get(
  '/capture-batches/:id',
  asyncHandler(async (req, res) => {
    const scope = resolveScopeContext(req);
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Capture batch not found.' });
    const batch = await findBatch(req, req.params.id, scope);
    if (!batch) return res.status(404).json({ error: 'Capture batch not found.' });
    const items = await scopedQuery(
      req,
      scope,
      `SELECT * FROM capture_items
      WHERE capture_batch_id = $1 AND space_id = $2 AND library_id = $3
      ORDER BY capture_batch_position, id`,
      [batch.id, scope.spaceId, scope.libraryId]
    );
    const shaped = items.rows.map(shapeItem);
    const enrichedItemCount = shaped.filter((item) => item.source_context.enrichment_status === 'enriched').length;
    const enrichmentFailedItemCount = shaped.filter((item) => item.source_context.enrichment_status === 'failed').length;
    const counts = shaped.reduce((result, item) => {
      result[item.decision] = (result[item.decision] || 0) + 1;
      result[item.classification] = (result[item.classification] || 0) + 1;
      return result;
    }, {});
    return res.json({
      batch: shapeBatch({
        ...batch,
        enriched_item_count: enrichedItemCount,
        enrichment_failed_item_count: enrichmentFailedItemCount
      }),
      items: shaped,
      review_counts: counts
    });
  })
);

router.post(
  '/capture-batches/:id/items',
  asyncHandler(async (req, res) => {
    const scope = resolveScopeContext(req);
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Capture batch not found.' });
    const batch = await findBatch(req, req.params.id, scope);
    if (!batch) return res.status(404).json({ error: 'Capture batch not found.' });
    if (!['collecting', 'paused', 'ready'].includes(batch.status))
      return res.status(409).json({ error: 'This batch no longer accepts collection pages.' });
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length || items.length > 50) return res.status(400).json({ error: 'Submit between 1 and 50 collection items.' });

    const saved = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = object(items[index]);
      const productId = clean(item.product_id ?? item.bluray_product_id, 255);
      const itemKey = clean(item.item_key ?? productId, 255);
      if (!itemKey) return res.status(400).json({ error: `Item ${index + 1} needs item_key or product_id.` });
      const classification = await classifyItem(req, scope, item);
      classification.decision_source = 'automatic';
      const sourceContext = sourceContextForItem(batch, item, productId);
      sourceContext.client_capture_id = `bluray-batch:${batch.id}:${itemKey}`;
      const reviewDecision = { batch_review: classification };
      const pageNumber = positiveInt(item.page) || positiveInt(req.body?.page) || 1;
      const position = (pageNumber - 1) * 50 + (positiveInt(item.position) || index + 1);
      const result = await scopedQuery(
        req,
        scope,
        `INSERT INTO capture_items
         (title, capture_type, status, object_type, notes, source_context, review_decision,
          library_id, space_id, created_by, capture_batch_id, capture_batch_item_key,
          capture_batch_position, capture_batch_source_status)
       VALUES ($1, 'manual_note', 'new', 'movie', $2, $3::jsonb, $4::jsonb,
               $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (capture_batch_id, capture_batch_item_key) WHERE capture_batch_id IS NOT NULL DO UPDATE SET
         title = COALESCE(EXCLUDED.title, capture_items.title),
         source_context = EXCLUDED.source_context,
         capture_batch_position = EXCLUDED.capture_batch_position,
         capture_batch_source_status = EXCLUDED.capture_batch_source_status,
         review_decision = CASE
           WHEN capture_items.status = 'converted'
             OR capture_items.review_decision->'batch_review'->>'decision_source' = 'reviewer'
             THEN capture_items.review_decision
           ELSE EXCLUDED.review_decision
         END,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
        [
          clean(item.title, 500),
          'Authenticated Blu-ray collection capture',
          JSON.stringify(sourceContext),
          JSON.stringify(reviewDecision),
          scope.libraryId,
          scope.spaceId,
          req.user.id,
          batch.id,
          itemKey,
          position,
          clean(item.status, 40)
        ]
      );
      saved.push(shapeItem(result.rows[0]));
    }
    const currentPage = positiveInt(req.body?.page) || batch.current_page;
    const totalPages = positiveInt(req.body?.total_pages);
    const expectedCount = optionalNonNegativeInt(req.body?.expected_item_count);
    const updated = await scopedQuery(
      req,
      scope,
      `UPDATE capture_batches SET
       current_page = GREATEST(current_page, $2),
       total_pages = COALESCE($3, total_pages),
       expected_item_count = COALESCE($4, expected_item_count),
       received_item_count = (SELECT COUNT(*) FROM capture_items WHERE capture_batch_id = $1),
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 RETURNING *`,
      [batch.id, currentPage || 0, totalPages, expectedCount]
    );
    return res.status(201).json({ batch: shapeBatch(updated.rows[0]), items: saved });
  })
);

router.patch(
  '/capture-batches/:id/progress',
  asyncHandler(async (req, res) => {
    const scope = resolveScopeContext(req);
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Capture batch not found.' });
    const status = clean(req.body?.status, 32);
    if (!BATCH_STATUSES.has(status)) return res.status(400).json({ error: 'Progress status must be collecting, paused, or ready.' });
    const result = await scopedQuery(
      req,
      scope,
      `UPDATE capture_batches SET status = $1,
       current_page = COALESCE($2, current_page), total_pages = COALESCE($3, total_pages),
       expected_item_count = COALESCE($4, expected_item_count), pause_reason = $5, pause_detail = $6,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $7 AND space_id = $8 AND library_id = $9
     RETURNING *`,
      [
        status,
        optionalNonNegativeInt(req.body?.current_page),
        positiveInt(req.body?.total_pages),
        optionalNonNegativeInt(req.body?.expected_item_count),
        status === 'paused' ? clean(req.body?.pause_reason, 80) : null,
        status === 'paused' ? clean(req.body?.pause_detail, 500) : null,
        req.params.id,
        scope.spaceId,
        scope.libraryId
      ]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Capture batch not found.' });
    return res.json({ batch: shapeBatch(result.rows[0]) });
  })
);

router.patch(
  '/capture-batches/:id/items/:itemId',
  asyncHandler(async (req, res) => {
    const scope = resolveScopeContext(req);
    const itemId = positiveInt(req.params.itemId);
    if (!isUuid(req.params.id) || !itemId) return res.status(404).json({ error: 'Batch review item not found.' });
    const decision = clean(req.body?.decision, 20);
    if (!['include', 'skip'].includes(decision)) return res.status(400).json({ error: 'Decision must be include or skip.' });
    const current = await scopedQuery(
      req,
      scope,
      `SELECT * FROM capture_items WHERE id = $1 AND capture_batch_id = $2 AND space_id = $3 AND library_id = $4`,
      [itemId, req.params.id, scope.spaceId, scope.libraryId]
    );
    if (!current.rowCount) return res.status(404).json({ error: 'Batch review item not found.' });
    if (decision === 'include' && !isOwnedStatus(current.rows[0].capture_batch_source_status)) {
      return res.status(409).json({ error: 'Only collection rows with an explicit Owned status can be included.' });
    }
    if (decision === 'include' && !isEnrichedSourceContext(current.rows[0].source_context)) {
      return res.status(409).json({ error: 'Edition detail enrichment must complete before this row can be included.' });
    }
    const review = object(current.rows[0].review_decision);
    const batchReview = { ...object(review.batch_review), decision, decision_source: 'reviewer' };
    const selectedMediaId = positiveInt(req.body?.selected_media_id);
    if (selectedMediaId) {
      const media = await scopedQuery(req, scope, `SELECT id, title, year FROM media WHERE id = $1 AND space_id = $2 AND library_id = $3`, [
        selectedMediaId,
        scope.spaceId,
        scope.libraryId
      ]);
      if (!media.rowCount) return res.status(409).json({ error: 'Selected movie is outside the active library.' });
      batchReview.selected_media_id = selectedMediaId;
      batchReview.candidates = media.rows.map((row) => ({ media_id: row.id, title: row.title, year: row.year }));
    }
    const result = await scopedQuery(
      req,
      scope,
      `UPDATE capture_items SET review_decision = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [JSON.stringify({ ...review, batch_review: batchReview }), itemId]
    );
    return res.json({ item: shapeItem(result.rows[0]) });
  })
);

function responseRecorder() {
  const record = { statusCode: 200, body: null };
  return {
    record,
    status(code) {
      record.statusCode = code;
      return this;
    },
    json(body) {
      record.body = body;
      return body;
    }
  };
}

router.post(
  '/capture-batches/:id/apply',
  asyncHandler(async (req, res) => {
    const scope = resolveScopeContext(req);
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Capture batch not found.' });
    const batch = await findBatch(req, req.params.id, scope);
    if (!batch) return res.status(404).json({ error: 'Capture batch not found.' });
    const pending = await scopedQuery(
      req,
      scope,
      `SELECT * FROM capture_items
      WHERE capture_batch_id = $1 AND space_id = $2 AND library_id = $3 AND status <> 'converted'
        AND review_decision->'batch_review'->>'decision' = 'include'
      ORDER BY capture_batch_position, id`,
      [batch.id, scope.spaceId, scope.libraryId]
    );
    if (!pending.rowCount)
      return res
        .status(409)
        .json({ error: 'No reviewed editions are included. Review edition evidence and choose Include before applying.' });
    await scopedQuery(req, scope, `UPDATE capture_batches SET status = 'applying', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [
      batch.id
    ]);
    const results = [];
    for (const row of pending.rows) {
      const batchReview = object(object(row.review_decision).batch_review);
      const sourceContext = object(row.source_context);
      const mappingProductId = clean(object(sourceContext.identifiers).bluray_product_id, 255);
      const selectedMediaId = positiveInt(batchReview.selected_media_id);
      const match = selectedMediaId
        ? {
            id: `batch-media-${selectedMediaId}`,
            source: 'capture_review',
            match_type: 'capture_review',
            media_id: selectedMediaId,
            title: row.title,
            media_type: 'movie'
          }
        : { id: `batch-new-${row.id}`, source: 'capture_review', match_type: 'capture_review', title: row.title, media_type: 'movie' };
      const recorder = responseRecorder();
      const batchReq = Object.create(req);
      batchReq.params = { id: String(row.id) };
      batchReq.body = { match, media_type: 'movie' };
      try {
        await captureItemsRouter.importCaptureItemForRequest(batchReq, recorder, row.id);
        if (recorder.record.statusCode >= 400 || !recorder.record.body?.ok)
          throw new Error(recorder.record.body?.error || 'Import failed.');
        results.push({ item_id: row.id, ok: true, media_id: recorder.record.body.import?.media_id || null, product_id: mappingProductId });
      } catch (error) {
        const review = object(row.review_decision);
        review.batch_review = { ...batchReview, apply_status: 'failed', apply_error: clean(error.message, 500) };
        await scopedQuery(
          req,
          scope,
          `UPDATE capture_items SET review_decision = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [JSON.stringify(review), row.id]
        );
        results.push({ item_id: row.id, ok: false, error: clean(error.message, 500), product_id: mappingProductId });
      }
    }
    const appliedCount = await scopedQuery(
      req,
      scope,
      `SELECT COUNT(*)::int AS count FROM capture_items WHERE capture_batch_id = $1 AND status = 'converted'`,
      [batch.id]
    );
    const failedCount = results.filter((entry) => !entry.ok).length;
    const updated = await scopedQuery(
      req,
      scope,
      `UPDATE capture_batches SET status = $2, applied_item_count = $3, failed_item_count = $4,
       completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [batch.id, failedCount ? 'completed_with_errors' : 'completed', appliedCount.rows[0].count, failedCount]
    );
    await logActivity(req, 'capture_batch.apply', 'capture_batch', null, {
      batchId: batch.id,
      applied: appliedCount.rows[0].count,
      failed: failedCount,
      spaceId: scope.spaceId,
      libraryId: scope.libraryId
    });
    return res.status(failedCount ? 207 : 200).json({ ok: failedCount === 0, batch: shapeBatch(updated.rows[0]), results });
  })
);

module.exports = router;
