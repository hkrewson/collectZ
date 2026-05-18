const express = require('express');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const { resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const { logActivity } = require('../services/audit');

const router = express.Router();

router.use('/capture-items', authenticateToken);
router.use('/capture-items', enforceScopeAccess({ allowedHintRoles: ['admin'] }));

const CAPTURE_TYPES = new Set(['barcode', 'photo', 'ocr_text', 'manual_note']);
const STATUSES = new Set(['new', 'reviewed', 'converted', 'discarded']);
const OBJECT_TYPES = new Set(['movie', 'tv_series', 'book', 'comic_book', 'audio', 'game', 'art', 'collectible', 'event_item', 'other']);

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
  return {};
}

function shapeCaptureItem(row) {
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
    source_context: jsonObject(row.source_context),
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

  return next;
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

  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const page = Math.max(1, Number(req.query.page || 1));
  const offset = (page - 1) * limit;

  const totalResult = await pool.query(`SELECT COUNT(*)::int AS total FROM capture_items ${where}`, params);
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

  res.json({
    items: result.rows.map(shapeCaptureItem),
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
