const express = require('express');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const { resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const { logActivity } = require('../services/audit');
const {
  PROVIDER: APPLE_ITUNES_PROVIDER,
  fetchAppleLookup,
  fetchAppleSearch,
  normalizeAppleItunesResult,
  normalizeCountry,
  normalizeLimit,
  normalizeMediaList
} = require('../services/appleItunes');

const router = express.Router();

router.use('/wishlist', authenticateToken);
router.use('/wishlist', enforceScopeAccess({ allowedHintRoles: ['admin'] }));

const ACTIVE_STATUSES = ['wanted', 'watching', 'preordered', 'ordered'];
const STATUSES = new Set([...ACTIVE_STATUSES, 'acquired', 'dismissed']);
const PRIORITIES = new Set(['low', 'normal', 'high', 'grail']);
const OBJECT_TYPES = new Set(['movie', 'tv_series', 'book', 'comic_book', 'audio', 'game', 'art', 'collectible', 'event_item', 'other']);
const MEDIA_OBJECT_TYPES = new Set(['movie', 'tv_series', 'book', 'comic_book', 'audio', 'game']);

function trimString(value) {
  return String(value || '').trim();
}

function nullableString(value) {
  const trimmed = trimString(value);
  return trimmed || null;
}

function nullableInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function nullablePrice(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

function jsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return {};
}

function normalizeStatus(value, fallback = 'wanted') {
  const status = trimString(value).toLowerCase();
  return STATUSES.has(status) ? status : fallback;
}

function normalizePriority(value, fallback = 'normal') {
  const priority = trimString(value).toLowerCase();
  return PRIORITIES.has(priority) ? priority : fallback;
}

function normalizeObjectType(value, fallback = 'movie') {
  const objectType = trimString(value).toLowerCase();
  if (objectType === 'tv') return 'tv_series';
  if (objectType === 'comic') return 'comic_book';
  if (OBJECT_TYPES.has(objectType)) return objectType;
  return fallback;
}

function shapeWantedItem(row) {
  return {
    id: row.id,
    title: row.title,
    object_type: row.object_type,
    status: row.status,
    priority: row.priority,
    year: row.year,
    desired_format: row.desired_format,
    desired_edition: row.desired_edition,
    notes: row.notes,
    identifiers: jsonObject(row.identifiers),
    source_context: jsonObject(row.source_context),
    provider: row.provider,
    provider_key: row.provider_key,
    event_id: row.event_id,
    vendor: row.vendor,
    target_price: row.target_price === null || row.target_price === undefined ? null : Number(row.target_price),
    linked_media_id: row.linked_media_id,
    library_id: row.library_id,
    space_id: row.space_id,
    created_by: row.created_by,
    acquired_at: row.acquired_at,
    dismissed_at: row.dismissed_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function buildScopedItemWhere(params, scopeContext, id = null) {
  let where = 'WHERE 1=1';
  if (id !== null && id !== undefined) {
    params.push(id);
    where += ` AND id = $${params.length}`;
  }
  where += appendScopeSql(params, scopeContext);
  return where;
}

async function fetchWantedItem(id, scopeContext) {
  const params = [];
  const where = buildScopedItemWhere(params, scopeContext, id);
  const result = await pool.query(`SELECT * FROM wanted_items ${where} LIMIT 1`, params);
  return result.rows[0] || null;
}

function itemValuesFromBody(body, current = {}) {
  const next = { ...current };
  const has = (field) => Object.prototype.hasOwnProperty.call(body || {}, field);

  if (has('title')) next.title = trimString(body.title);
  if (has('object_type') || has('media_type')) next.object_type = normalizeObjectType(body.object_type ?? body.media_type, current.object_type || 'movie');
  if (has('status')) next.status = normalizeStatus(body.status, current.status || 'wanted');
  if (has('priority')) next.priority = normalizePriority(body.priority, current.priority || 'normal');
  if (has('year')) next.year = nullableInt(body.year);
  if (has('desired_format')) next.desired_format = nullableString(body.desired_format);
  if (has('desired_edition')) next.desired_edition = nullableString(body.desired_edition);
  if (has('notes')) next.notes = nullableString(body.notes);
  if (has('identifiers')) next.identifiers = jsonObject(body.identifiers);
  if (has('source_context')) next.source_context = jsonObject(body.source_context);
  if (has('provider')) next.provider = nullableString(body.provider);
  if (has('provider_key')) next.provider_key = nullableString(body.provider_key);
  if (has('event_id')) next.event_id = nullableInt(body.event_id);
  if (has('vendor')) next.vendor = nullableString(body.vendor);
  if (has('target_price')) next.target_price = nullablePrice(body.target_price);

  return next;
}

async function findScopedWantedItemByProvider(scopeContext, provider, providerKey) {
  if (!provider || !providerKey) return null;
  const params = [provider, providerKey];
  let where = 'WHERE provider = $1 AND provider_key = $2';
  where += appendScopeSql(params, scopeContext);
  const result = await pool.query(`SELECT * FROM wanted_items ${where} ORDER BY updated_at DESC, id DESC LIMIT 1`, params);
  return result.rows[0] || null;
}

async function markAppleItunesSavedState(scopeContext, candidates) {
  const keys = Array.from(new Set((candidates || []).map((candidate) => candidate.provider_key).filter(Boolean)));
  if (keys.length === 0) {
    return (candidates || []).map((candidate) => ({ ...candidate, already_saved: false, wanted_item_id: null }));
  }

  const params = [APPLE_ITUNES_PROVIDER, keys];
  let where = 'WHERE provider = $1 AND provider_key = ANY($2)';
  where += appendScopeSql(params, scopeContext);
  const result = await pool.query(
    `SELECT id, provider_key
       FROM wanted_items
      ${where}`,
    params
  );
  const savedByKey = new Map(result.rows.map((row) => [String(row.provider_key), Number(row.id)]));
  return candidates.map((candidate) => ({
    ...candidate,
    already_saved: savedByKey.has(String(candidate.provider_key)),
    wanted_item_id: savedByKey.get(String(candidate.provider_key)) || null
  }));
}

function buildApplePriceReadback(row, candidate, error = null) {
  const sourceContext = jsonObject(row.source_context);
  const previousPrice = sourceContext.current_price ?? null;
  const currentPrice = candidate?.price ?? null;
  const targetPrice = row.target_price === null || row.target_price === undefined ? null : Number(row.target_price);
  const targetMet = targetPrice !== null && currentPrice !== null ? Number(currentPrice) <= targetPrice : false;
  return {
    id: row.id,
    title: row.title,
    provider_key: row.provider_key,
    previous_price: previousPrice === null || previousPrice === undefined ? null : Number(previousPrice),
    current_price: currentPrice === null || currentPrice === undefined ? null : Number(currentPrice),
    currency: candidate?.currency || sourceContext.currency || null,
    target_price: targetPrice,
    target_met: targetMet,
    error
  };
}

function normalizeAppleSaveCandidate(body) {
  const input = body?.candidate && typeof body.candidate === 'object' ? body.candidate : body || {};
  const normalized = input.raw_result
    ? normalizeAppleItunesResult(input.raw_result, { media: input.media })
    : null;
  const candidate = {
    ...(normalized || {}),
    ...input,
    provider: APPLE_ITUNES_PROVIDER
  };
  if (!candidate.provider_key && normalized?.provider_key) candidate.provider_key = normalized.provider_key;
  if (!candidate.title && normalized?.title) candidate.title = normalized.title;
  return candidate;
}

router.get('/wishlist/apple-itunes/search', asyncHandler(async (req, res) => {
  const term = trimString(req.query.term);
  if (!term) return res.status(400).json({ error: 'Search term is required.' });

  const scopeContext = resolveScopeContext(req);
  const media = normalizeMediaList(req.query.media);
  const country = normalizeCountry(req.query.country);
  const limit = normalizeLimit(req.query.limit);
  const matches = await fetchAppleSearch({ term, media, country, limit });
  const scopedMatches = await markAppleItunesSavedState(scopeContext, matches);

  return res.json({
    provider: APPLE_ITUNES_PROVIDER,
    term,
    media,
    country,
    limit,
    matches: scopedMatches
  });
}));

router.post('/wishlist/apple-itunes/save', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const candidate = normalizeAppleSaveCandidate(req.body || {});
  const providerKey = nullableString(candidate.provider_key);
  if (!candidate.title || !providerKey) {
    return res.status(400).json({ error: 'Apple/iTunes wishlist save requires a title and provider key.' });
  }

  const existing = await findScopedWantedItemByProvider(scopeContext, APPLE_ITUNES_PROVIDER, providerKey);
  if (existing) {
    return res.json({
      ok: true,
      created: false,
      existing: true,
      item: shapeWantedItem(existing)
    });
  }

  const country = normalizeCountry(req.body?.country || candidate.raw_result?.country || 'US');
  const identifiers = {
    provider_name: APPLE_ITUNES_PROVIDER,
    provider_item_id: providerKey,
    apple_itunes_provider_key: providerKey,
    apple_itunes_track_id: candidate.raw_result?.trackId ?? null,
    apple_itunes_collection_id: candidate.raw_result?.collectionId ?? null,
    apple_itunes_media: candidate.media || null,
    apple_itunes_kind: candidate.kind || null
  };
  const sourceContext = {
    provider: APPLE_ITUNES_PROVIDER,
    provider_key: providerKey,
    media: candidate.media || null,
    kind: candidate.kind || null,
    country,
    currency: candidate.currency || null,
    current_price: candidate.price ?? null,
    store_url: candidate.store_url || null,
    artwork_url: candidate.artwork_url || null,
    looked_up_at: new Date().toISOString(),
    raw_result: jsonObject(candidate.raw_result)
  };
  const result = await pool.query(
    `INSERT INTO wanted_items (
       title, object_type, status, priority, year, desired_format, desired_edition, notes,
       identifiers, source_context, provider, provider_key, event_id, vendor, target_price,
       library_id, space_id, created_by
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15,
       $16, $17, $18
     )
     RETURNING *`,
    [
      trimString(candidate.title),
      normalizeObjectType(candidate.object_type, 'other'),
      normalizeStatus(req.body?.status, 'wanted'),
      normalizePriority(req.body?.priority, 'normal'),
      nullableInt(candidate.year),
      nullableString(candidate.kind || candidate.media),
      nullableString(candidate.subtitle),
      nullableString(req.body?.notes),
      JSON.stringify(identifiers),
      JSON.stringify(sourceContext),
      APPLE_ITUNES_PROVIDER,
      providerKey,
      null,
      'Apple',
      nullablePrice(req.body?.target_price),
      scopeContext.libraryId,
      scopeContext.spaceId,
      req.user?.id || null
    ]
  );

  const created = shapeWantedItem(result.rows[0]);
  await logActivity(req, 'wishlist.create', 'wanted_item', created.id, {
    title: created.title,
    object_type: created.object_type,
    status: created.status,
    provider: APPLE_ITUNES_PROVIDER,
    providerKey,
    spaceId: created.space_id,
    libraryId: created.library_id
  });
  return res.status(201).json({
    ok: true,
    created: true,
    existing: false,
    item: created
  });
}));

router.post('/wishlist/apple-itunes/refresh-prices', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const limit = normalizeLimit(req.body?.limit || 25);
  const requestedStatus = trimString(req.body?.status).toLowerCase();
  const params = [APPLE_ITUNES_PROVIDER];
  let where = 'WHERE provider = $1 AND provider_key IS NOT NULL';
  if (requestedStatus && requestedStatus !== 'active' && requestedStatus !== 'all' && STATUSES.has(requestedStatus)) {
    params.push(requestedStatus);
    where += ` AND status = $${params.length}`;
  } else if (requestedStatus !== 'all') {
    params.push(ACTIVE_STATUSES);
    where += ` AND status = ANY($${params.length})`;
  }
  where += appendScopeSql(params, scopeContext);
  params.push(limit);

  const result = await pool.query(
    `SELECT *
       FROM wanted_items
      ${where}
      ORDER BY updated_at DESC, id DESC
      LIMIT $${params.length}`,
    params
  );

  const refreshedAt = new Date().toISOString();
  const items = [];
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of result.rows) {
    const sourceContext = jsonObject(row.source_context);
    const country = normalizeCountry(req.body?.country || sourceContext.country || 'US');
    try {
      const candidate = await fetchAppleLookup({ providerKey: row.provider_key, country });
      if (!candidate) {
        skipped += 1;
        items.push(buildApplePriceReadback(row, null, 'No Apple/iTunes lookup result.'));
        continue;
      }
      const readback = buildApplePriceReadback(row, candidate);
      const nextSourceContext = {
        ...sourceContext,
        provider: APPLE_ITUNES_PROVIDER,
        provider_key: row.provider_key,
        country,
        currency: candidate.currency || sourceContext.currency || null,
        previous_price: readback.previous_price,
        current_price: readback.current_price,
        store_url: candidate.store_url || sourceContext.store_url || null,
        artwork_url: candidate.artwork_url || sourceContext.artwork_url || null,
        price_refreshed_at: refreshedAt,
        target_price_met: readback.target_met,
        target_price_delta: readback.current_price !== null && readback.target_price !== null
          ? Math.round((readback.current_price - readback.target_price) * 100) / 100
          : null,
        raw_result: jsonObject(candidate.raw_result)
      };
      const updatedRow = await pool.query(
        `UPDATE wanted_items
            SET source_context = $2::jsonb,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [row.id, JSON.stringify(nextSourceContext)]
      );
      updated += 1;
      items.push({
        ...readback,
        item: shapeWantedItem(updatedRow.rows[0])
      });
    } catch (err) {
      failed += 1;
      items.push(buildApplePriceReadback(row, null, err?.message || 'Apple/iTunes lookup failed.'));
    }
  }

  await logActivity(req, 'wishlist.apple_itunes_prices_refresh', 'wanted_item', null, {
    provider: APPLE_ITUNES_PROVIDER,
    checked: result.rows.length,
    updated,
    skipped,
    failed,
    spaceId: scopeContext.spaceId,
    libraryId: scopeContext.libraryId
  });

  return res.json({
    ok: true,
    provider: APPLE_ITUNES_PROVIDER,
    checked: result.rows.length,
    updated,
    skipped,
    failed,
    items
  });
}));

router.get('/wishlist', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const params = [];
  let where = 'WHERE 1=1';

  const status = trimString(req.query.status).toLowerCase();
  if (status === 'active' || status === '') {
    params.push(ACTIVE_STATUSES);
    where += ` AND status = ANY($${params.length})`;
  } else if (status !== 'all' && STATUSES.has(status)) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }

  const objectType = normalizeObjectType(req.query.object_type, null);
  if (objectType) {
    params.push(objectType);
    where += ` AND object_type = $${params.length}`;
  }

  const search = trimString(req.query.search);
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where += ` AND (LOWER(title) LIKE $${params.length} OR LOWER(COALESCE(provider_key, '')) LIKE $${params.length} OR LOWER(COALESCE(notes, '')) LIKE $${params.length})`;
  }

  where += appendScopeSql(params, scopeContext);

  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const page = Math.max(1, Number(req.query.page || 1));
  const offset = (page - 1) * limit;

  const totalResult = await pool.query(`SELECT COUNT(*)::int AS total FROM wanted_items ${where}`, params);
  const listParams = params.slice();
  listParams.push(limit, offset);
  const result = await pool.query(
    `SELECT *
       FROM wanted_items
      ${where}
      ORDER BY
        CASE priority WHEN 'grail' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        updated_at DESC,
        id DESC
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  res.json({
    items: result.rows.map(shapeWantedItem),
    pagination: {
      page,
      limit,
      total: totalResult.rows[0]?.total || 0,
      total_pages: Math.max(1, Math.ceil((totalResult.rows[0]?.total || 0) / limit))
    }
  });
}));

router.post('/wishlist', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const item = itemValuesFromBody(req.body || {});
  if (!item.title) {
    return res.status(400).json({ error: 'Wishlist title is required.' });
  }

  const result = await pool.query(
    `INSERT INTO wanted_items (
       title, object_type, status, priority, year, desired_format, desired_edition, notes,
       identifiers, source_context, provider, provider_key, event_id, vendor, target_price,
       library_id, space_id, created_by
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15,
       $16, $17, $18
     )
     RETURNING *`,
    [
      item.title,
      item.object_type || 'movie',
      item.status || 'wanted',
      item.priority || 'normal',
      item.year ?? null,
      item.desired_format ?? null,
      item.desired_edition ?? null,
      item.notes ?? null,
      JSON.stringify(item.identifiers || {}),
      JSON.stringify(item.source_context || {}),
      item.provider ?? null,
      item.provider_key ?? null,
      item.event_id ?? null,
      item.vendor ?? null,
      item.target_price ?? null,
      scopeContext.libraryId,
      scopeContext.spaceId,
      req.user?.id || null
    ]
  );

  const created = shapeWantedItem(result.rows[0]);
  await logActivity(req, 'wishlist.create', 'wanted_item', created.id, {
    title: created.title,
    object_type: created.object_type,
    status: created.status,
    spaceId: created.space_id,
    libraryId: created.library_id
  });
  return res.status(201).json({ item: created });
}));

router.patch('/wishlist/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Wishlist item not found.' });

  const scopeContext = resolveScopeContext(req);
  const current = await fetchWantedItem(id, scopeContext);
  if (!current) return res.status(404).json({ error: 'Wishlist item not found.' });

  const next = itemValuesFromBody(req.body || {}, shapeWantedItem(current));
  if (!next.title) return res.status(400).json({ error: 'Wishlist title is required.' });

  const result = await pool.query(
    `UPDATE wanted_items
        SET title = $1,
            object_type = $2,
            status = $3,
            priority = $4,
            year = $5,
            desired_format = $6,
            desired_edition = $7,
            notes = $8,
            identifiers = $9::jsonb,
            source_context = $10::jsonb,
            provider = $11,
            provider_key = $12,
            event_id = $13,
            vendor = $14,
            target_price = $15,
            acquired_at = CASE WHEN $3 = 'acquired' THEN COALESCE(acquired_at, CURRENT_TIMESTAMP) ELSE acquired_at END,
            dismissed_at = CASE WHEN $3 = 'dismissed' THEN COALESCE(dismissed_at, CURRENT_TIMESTAMP) ELSE dismissed_at END
      WHERE id = $16
      RETURNING *`,
    [
      next.title,
      next.object_type,
      next.status,
      next.priority,
      next.year,
      next.desired_format,
      next.desired_edition,
      next.notes,
      JSON.stringify(next.identifiers || {}),
      JSON.stringify(next.source_context || {}),
      next.provider,
      next.provider_key,
      next.event_id,
      next.vendor,
      next.target_price,
      id
    ]
  );

  const updated = shapeWantedItem(result.rows[0]);
  await logActivity(req, 'wishlist.update', 'wanted_item', updated.id, {
    title: updated.title,
    status: updated.status,
    spaceId: updated.space_id,
    libraryId: updated.library_id
  });
  return res.json({ item: updated });
}));

router.delete('/wishlist/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Wishlist item not found.' });

  const scopeContext = resolveScopeContext(req);
  const params = [];
  const where = buildScopedItemWhere(params, scopeContext, id);
  const result = await pool.query(`DELETE FROM wanted_items ${where} RETURNING id, title, space_id, library_id`, params);
  const deleted = result.rows[0];
  if (!deleted) return res.status(404).json({ error: 'Wishlist item not found.' });

  await logActivity(req, 'wishlist.delete', 'wanted_item', deleted.id, {
    title: deleted.title,
    spaceId: deleted.space_id,
    libraryId: deleted.library_id
  });
  return res.json({ ok: true, id: deleted.id });
}));

router.post('/wishlist/:id/convert', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Wishlist item not found.' });

  const scopeContext = resolveScopeContext(req);
  const wanted = await fetchWantedItem(id, scopeContext);
  if (!wanted) return res.status(404).json({ error: 'Wishlist item not found.' });
  if (!MEDIA_OBJECT_TYPES.has(wanted.object_type)) {
    return res.status(400).json({ error: 'Only media wishlist items can be converted into library media records right now.' });
  }

  const identifiers = jsonObject(wanted.identifiers);
  const sourceContext = jsonObject(wanted.source_context);
  const typeDetails = {
    ...(identifiers || {}),
    wishlist_id: wanted.id,
    desired_format: wanted.desired_format || null,
    desired_edition: wanted.desired_edition || null,
    source_context: sourceContext,
    provider_name: wanted.provider || identifiers.provider_name || sourceContext.provider || null,
    provider_item_id: wanted.provider_key || identifiers.provider_item_id || sourceContext.provider_key || null
  };
  const upc = identifiers.upc || identifiers.barcode || null;
  const notes = [wanted.notes, wanted.vendor ? `Wishlist vendor: ${wanted.vendor}` : null]
    .filter(Boolean)
    .join('\n');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mediaResult = await client.query(
      `INSERT INTO media (
         title, media_type, year, format, owned_formats, upc, notes, type_details,
         library_id, space_id, import_source, added_by
       )
       VALUES ($1, $2, $3, 'Digital', ARRAY[]::text[], $4, $5, $6::jsonb, $7, $8, 'wishlist', $9)
       RETURNING id, title, media_type, year, format, upc, notes, type_details, library_id, space_id, import_source, created_at, updated_at`,
      [
        wanted.title,
        wanted.object_type,
        wanted.year,
        upc,
        notes || null,
        JSON.stringify(typeDetails),
        wanted.library_id,
        wanted.space_id,
        req.user?.id || null
      ]
    );
    const media = mediaResult.rows[0];
    const wantedResult = await client.query(
      `UPDATE wanted_items
          SET status = 'acquired',
              linked_media_id = $1,
              acquired_at = COALESCE(acquired_at, CURRENT_TIMESTAMP)
        WHERE id = $2
        RETURNING *`,
      [media.id, wanted.id]
    );
    await client.query('COMMIT');

    const item = shapeWantedItem(wantedResult.rows[0]);
    await logActivity(req, 'wishlist.convert', 'wanted_item', item.id, {
      title: item.title,
      mediaId: media.id,
      object_type: item.object_type,
      spaceId: item.space_id,
      libraryId: item.library_id
    });
    return res.status(201).json({ ok: true, item, media });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

module.exports = router;
