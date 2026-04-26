const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const {
  validate,
  eventCreateSchema,
  eventUpdateSchema,
  eventArtifactCreateSchema,
  eventArtifactUpdateSchema,
  eventPurchasedItemCreateSchema,
  eventPurchasedItemUpdateSchema
} = require('../middleware/validate');
const { resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const { logActivity } = require('../services/audit');
const { uploadBuffer } = require('../services/storage');
const { isFeatureEnabled } = require('../services/featureFlags');

const router = express.Router();
const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif'
]);

router.use('/events', authenticateToken);
router.use('/events', enforceScopeAccess({ allowedHintRoles: ['admin'] }));
router.use('/events', asyncHandler(async (_req, res, next) => {
  const enabled = await isFeatureEnabled('events_enabled', false);
  if (!enabled) return res.status(404).json({ error: 'Events feature is disabled' });
  return next();
}));

const parsePaging = (req) => {
  const pageRaw = Number(req.query?.page);
  const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
  return { page, limit, offset: (page - 1) * limit };
};

const serializePurchasedItemRecord = (row) => ({
  id: row.id,
  event_id: row.event_id,
  item_type: row.item_type,
  item_id: row.item_id,
  title_snapshot: row.title_snapshot || null,
  vendor_snapshot: row.vendor_snapshot || null,
  booth_snapshot: row.booth_snapshot || null,
  price_snapshot: row.price_snapshot === null || row.price_snapshot === undefined ? null : Number(row.price_snapshot),
  created_by: row.created_by || null,
  created_at: row.created_at,
  updated_at: row.updated_at,
  resolved_item: row.resolved_item || null
});

async function ensureScopedEvent(scopeContext, eventId) {
  const eventParams = [eventId];
  const eventScopeClause = appendScopeSql(eventParams, scopeContext);
  const eventResult = await pool.query(
    `SELECT id
     FROM events
     WHERE id = $1
       AND archived_at IS NULL
       ${eventScopeClause}
     LIMIT 1`,
    eventParams
  );
  return eventResult.rows[0] || null;
}

async function loadPurchasedItemSource(scopeContext, itemType, itemId) {
  const params = [itemId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    libraryColumn: 'library_id',
    spaceColumn: 'space_id'
  });

  if (itemType === 'art') {
    const result = await pool.query(
      `SELECT id, source_collectible_id, library_id, space_id, title, vendor, booth, price, image_path, artist, series, exclusive, notes, created_at, updated_at, archived_at
       FROM art_items
       WHERE id = $1
         AND archived_at IS NULL
         ${scopeClause}
       LIMIT 1`,
      params
    );
    if (!result.rows[0]) return null;
    return {
      item_type: 'art',
      item_id: result.rows[0].id,
      title: result.rows[0].title,
      vendor: result.rows[0].vendor || null,
      booth: result.rows[0].booth || null,
      price: result.rows[0].price ?? null,
      resolved_item: {
        id: result.rows[0].id,
        source_collectible_id: result.rows[0].source_collectible_id || null,
        library_id: result.rows[0].library_id || null,
        space_id: result.rows[0].space_id || null,
        title: result.rows[0].title,
        artist: result.rows[0].artist || null,
        series: result.rows[0].series || null,
        vendor: result.rows[0].vendor || null,
        booth: result.rows[0].booth || null,
        price: result.rows[0].price === null || result.rows[0].price === undefined ? null : Number(result.rows[0].price),
        exclusive: result.rows[0].exclusive === true,
        image_path: result.rows[0].image_path || null,
        notes: result.rows[0].notes || null,
        created_at: result.rows[0].created_at,
        updated_at: result.rows[0].updated_at,
        archived_at: result.rows[0].archived_at || null
      }
    };
  }

  const result = await pool.query(
    `SELECT id, title, vendor, booth, price, image_path, subtype, category_key, artist, series
     FROM collectibles
     WHERE id = $1
       AND archived_at IS NULL
       AND subtype <> 'art'
       ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!result.rows[0]) return null;
  return {
    item_type: 'collectible',
    item_id: result.rows[0].id,
    title: result.rows[0].title,
    vendor: result.rows[0].vendor || null,
    booth: result.rows[0].booth || null,
    price: result.rows[0].price ?? null,
    resolved_item: {
      id: result.rows[0].id,
      item_type: 'collectible',
      subtype: result.rows[0].subtype || 'collectible',
      category_key: result.rows[0].category_key || null,
      title: result.rows[0].title,
      artist: result.rows[0].artist || null,
      series: result.rows[0].series || null,
      vendor: result.rows[0].vendor || null,
      booth: result.rows[0].booth || null,
      image_path: result.rows[0].image_path || null
    }
  };
}

async function loadPurchasedItemsForEvent(eventId, scopeContext) {
  const result = await pool.query(
    `SELECT epi.*
     FROM event_purchased_items epi
     WHERE epi.event_id = $1
       AND epi.archived_at IS NULL
     ORDER BY epi.created_at DESC, epi.id DESC`,
    [eventId]
  );

  const rows = [];
  for (const row of result.rows) {
    const source = await loadPurchasedItemSource(scopeContext, row.item_type, row.item_id);
    rows.push(serializePurchasedItemRecord({
      ...row,
      resolved_item: source?.resolved_item || null
    }));
  }
  return rows;
}

router.get('/events', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const { page, limit, offset } = parsePaging(req);
  const q = String(req.query?.q || '').trim();
  const from = String(req.query?.from || '').trim();
  const to = String(req.query?.to || '').trim();
  const location = String(req.query?.location || '').trim();
  const sortDir = String(req.query?.sort_dir || '').trim().toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const params = [];
  let where = 'WHERE e.archived_at IS NULL';
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (
      e.title ILIKE $${params.length}
      OR COALESCE(e.location, '') ILIKE $${params.length}
      OR COALESCE(e.host, '') ILIKE $${params.length}
      OR COALESCE(e.notes, '') ILIKE $${params.length}
    )`;
  }
  if (location) {
    params.push(`%${location}%`);
    where += ` AND e.location ILIKE $${params.length}`;
  }
  if (from.match(/^\d{4}-\d{2}-\d{2}$/)) {
    params.push(from);
    where += ` AND e.date_start >= $${params.length}::date`;
  }
  if (to.match(/^\d{4}-\d{2}-\d{2}$/)) {
    params.push(to);
    where += ` AND e.date_start <= $${params.length}::date`;
  }
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'e.space_id',
    libraryColumn: 'e.library_id'
  });
  const whereWithScope = `${where} ${scopeClause}`;

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM events e
     ${whereWithScope}`,
    params
  );
  params.push(limit);
  params.push(offset);
  const rows = await pool.query(
    `SELECT
       e.*,
       COALESCE(a.artifact_count, 0)::int AS artifact_count,
       COALESCE(p.purchased_item_count, 0)::int AS purchased_item_count
     FROM events e
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS artifact_count
       FROM event_artifacts ea
       WHERE ea.event_id = e.id
     ) a ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS purchased_item_count
       FROM event_purchased_items epi
       WHERE epi.event_id = e.id
         AND epi.archived_at IS NULL
     ) p ON TRUE
     ${whereWithScope}
     ORDER BY e.date_start ${sortDir} NULLS LAST, e.date_end ${sortDir} NULLS LAST, e.title ${sortDir}, e.id ${sortDir}
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );
  const total = Number(countResult.rows[0]?.total || 0);
  res.json({
    items: rows.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: page < Math.max(1, Math.ceil(total / limit))
    }
  });
}));

router.get('/events/:id', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return res.status(400).json({ error: 'Invalid event id' });
  }
  const params = [eventId];
  const scopeClause = appendScopeSql(params, scopeContext);
  const row = await pool.query(
    `SELECT
       e.*,
       COALESCE(a.artifact_count, 0)::int AS artifact_count,
       COALESCE(p.purchased_item_count, 0)::int AS purchased_item_count
     FROM events e
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS artifact_count
       FROM event_artifacts ea
       WHERE ea.event_id = e.id
     ) a ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS purchased_item_count
       FROM event_purchased_items epi
       WHERE epi.event_id = e.id
         AND epi.archived_at IS NULL
     ) p ON TRUE
     WHERE e.id = $1
       AND e.archived_at IS NULL
       ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!row.rows[0]) {
    return res.status(404).json({ error: 'Event not found' });
  }
  res.json(row.rows[0]);
}));

router.post('/events', validate(eventCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const libraryId = Number(scopeContext?.libraryId || 0) || null;
  if (!libraryId) {
    return res.status(400).json({ error: 'No active library selected for event creation' });
  }
  const spaceId = Number(scopeContext?.spaceId || 0) || null;
  const { title, url, location, date_start, date_end, host, time_label, room, image_path, notes } = req.body;
  const result = await pool.query(
    `INSERT INTO events (
       library_id, space_id, created_by, title, url, location, date_start, date_end, host, time_label, room, image_path, notes
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11, $12, $13)
     RETURNING *`,
    [libraryId, spaceId, req.user.id, title, url, location, date_start, date_end || null, host || null, time_label || null, room || null, image_path || null, notes || null]
  );
  const row = result.rows[0];
  await logActivity(req, 'events.create', 'event', row.id, {
    title: row.title,
    date_start: row.date_start,
    location: row.location
  });
  res.status(201).json(row);
}));

router.patch('/events/:id', validate(eventUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return res.status(400).json({ error: 'Invalid event id' });
  }
  const allowed = ['title', 'url', 'location', 'date_start', 'date_end', 'host', 'time_label', 'room', 'image_path', 'notes'];
  const fields = Object.entries(req.body || {}).filter(([key]) => allowed.includes(key));
  if (!fields.length) {
    return res.status(400).json({ error: 'No valid event fields provided' });
  }
  const updates = [];
  const params = [];
  for (const [key, value] of fields) {
    params.push(value ?? null);
    const cast = key === 'date_start' || key === 'date_end' ? '::date' : '';
    updates.push(`${key} = $${params.length}${cast}`);
  }
  params.push(eventId);
  let where = `WHERE id = $${params.length} AND archived_at IS NULL`;
  where += appendScopeSql(params, scopeContext);

  const result = await pool.query(
    `UPDATE events
     SET ${updates.join(', ')}
     ${where}
     RETURNING *`,
    params
  );
  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Event not found' });
  }
  await logActivity(req, 'events.update', 'event', eventId, {
    fields: fields.map(([k]) => k)
  });
  res.json(result.rows[0]);
}));

router.delete('/events/:id', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return res.status(400).json({ error: 'Invalid event id' });
  }
  const params = [eventId];
  const scopeClause = appendScopeSql(params, scopeContext);
  const result = await pool.query(
    `UPDATE events
     SET archived_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND archived_at IS NULL
       ${scopeClause}
     RETURNING id, title`,
    params
  );
  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Event not found' });
  }
  await logActivity(req, 'events.delete', 'event', eventId, {
    title: result.rows[0].title
  });
  res.json({ ok: true, id: eventId });
}));

router.post('/events/:id/upload-image', memoryUpload.single('image'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return res.status(400).json({ error: 'Invalid event id' });
  }
  if (!req.file) return res.status(400).json({ error: 'Image file is required' });
  if (!ALLOWED_IMAGE_MIME_TYPES.has(String(req.file.mimetype || '').toLowerCase())) {
    return res.status(400).json({ error: 'Unsupported image type' });
  }

  const params = [eventId];
  const scopeClause = appendScopeSql(params, scopeContext);
  const existing = await pool.query(
    `SELECT id, image_path
     FROM events
     WHERE id = $1
       AND archived_at IS NULL
       ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!existing.rows[0]) return res.status(404).json({ error: 'Event not found' });

  const previousPath = existing.rows[0].image_path || null;
  const stored = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
  const updated = await pool.query(
    `UPDATE events
     SET image_path = $1
     WHERE id = $2
     RETURNING id, image_path`,
    [stored.url, eventId]
  );

  await logActivity(req, previousPath ? 'events.image.replace' : 'events.image.upload', 'event', eventId, {
    previousPath,
    imagePath: updated.rows[0].image_path,
    provider: stored.provider
  });

  res.json(updated.rows[0]);
}));

router.delete('/events/:id/image', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return res.status(400).json({ error: 'Invalid event id' });
  }

  const params = [eventId];
  const scopeClause = appendScopeSql(params, scopeContext);
  const existing = await pool.query(
    `SELECT id, image_path
     FROM events
     WHERE id = $1
       AND archived_at IS NULL
       ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!existing.rows[0]) return res.status(404).json({ error: 'Event not found' });
  if (!existing.rows[0].image_path) return res.status(400).json({ error: 'No image attached' });

  await pool.query(`UPDATE events SET image_path = NULL WHERE id = $1`, [eventId]);
  await logActivity(req, 'events.image.delete', 'event', eventId, {
    previousPath: existing.rows[0].image_path
  });
  res.json({ ok: true, id: eventId });
}));

router.get('/events/:id/artifacts', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return res.status(400).json({ error: 'Invalid event id' });
  }

  const eventParams = [eventId];
  const eventScopeClause = appendScopeSql(eventParams, scopeContext);
  const eventResult = await pool.query(
    `SELECT id
     FROM events
     WHERE id = $1
       AND archived_at IS NULL
       ${eventScopeClause}
     LIMIT 1`,
    eventParams
  );
  if (!eventResult.rows[0]) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const artifacts = await pool.query(
    `SELECT *
     FROM event_artifacts
     WHERE event_id = $1
     ORDER BY created_at DESC, id DESC`,
    [eventId]
  );
  res.json(artifacts.rows);
}));

router.post('/events/:id/artifacts', validate(eventArtifactCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return res.status(400).json({ error: 'Invalid event id' });
  }
  const eventParams = [eventId];
  const eventScopeClause = appendScopeSql(eventParams, scopeContext);
  const eventResult = await pool.query(
    `SELECT id
     FROM events
     WHERE id = $1
       AND archived_at IS NULL
       ${eventScopeClause}
     LIMIT 1`,
    eventParams
  );
  if (!eventResult.rows[0]) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const { artifact_type, title, description, image_path, price, vendor } = req.body;
  const created = await pool.query(
    `INSERT INTO event_artifacts (
       event_id, artifact_type, title, description, image_path, price, vendor, created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [eventId, artifact_type, title, description || null, image_path || null, price ?? null, vendor || null, req.user.id]
  );
  const row = created.rows[0];
  await logActivity(req, 'events.artifact.create', 'event', eventId, {
    artifactId: row.id,
    artifactType: row.artifact_type,
    title: row.title
  });
  res.status(201).json(row);
}));

router.patch('/events/:id/artifacts/:artifactId', validate(eventArtifactUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  const artifactId = Number(req.params.artifactId);
  if (!Number.isFinite(eventId) || eventId <= 0 || !Number.isFinite(artifactId) || artifactId <= 0) {
    return res.status(400).json({ error: 'Invalid event/artifact id' });
  }

  const eventParams = [eventId];
  const eventScopeClause = appendScopeSql(eventParams, scopeContext);
  const eventResult = await pool.query(
    `SELECT id
     FROM events
     WHERE id = $1
       AND archived_at IS NULL
       ${eventScopeClause}
     LIMIT 1`,
    eventParams
  );
  if (!eventResult.rows[0]) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const allowed = ['artifact_type', 'title', 'description', 'image_path', 'price', 'vendor'];
  const fields = Object.entries(req.body || {}).filter(([key]) => allowed.includes(key));
  if (!fields.length) {
    return res.status(400).json({ error: 'No valid artifact fields provided' });
  }
  const updates = [];
  const params = [eventId, artifactId];
  for (const [key, value] of fields) {
    params.push(value ?? null);
    updates.push(`${key} = $${params.length}`);
  }
  const result = await pool.query(
    `UPDATE event_artifacts
     SET ${updates.join(', ')}
     WHERE event_id = $1
       AND id = $2
     RETURNING *`,
    params
  );
  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Artifact not found' });
  }
  await logActivity(req, 'events.artifact.update', 'event', eventId, {
    artifactId,
    fields: fields.map(([k]) => k)
  });
  res.json(result.rows[0]);
}));

router.delete('/events/:id/artifacts/:artifactId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  const artifactId = Number(req.params.artifactId);
  if (!Number.isFinite(eventId) || eventId <= 0 || !Number.isFinite(artifactId) || artifactId <= 0) {
    return res.status(400).json({ error: 'Invalid event/artifact id' });
  }
  const eventParams = [eventId];
  const eventScopeClause = appendScopeSql(eventParams, scopeContext);
  const eventResult = await pool.query(
    `SELECT id
     FROM events
     WHERE id = $1
       AND archived_at IS NULL
       ${eventScopeClause}
     LIMIT 1`,
    eventParams
  );
  if (!eventResult.rows[0]) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const deleted = await pool.query(
    `DELETE FROM event_artifacts
     WHERE event_id = $1
       AND id = $2
     RETURNING id, artifact_type, title`,
    [eventId, artifactId]
  );
  if (!deleted.rows[0]) {
    return res.status(404).json({ error: 'Artifact not found' });
  }
  await logActivity(req, 'events.artifact.delete', 'event', eventId, {
    artifactId,
    artifactType: deleted.rows[0].artifact_type,
    title: deleted.rows[0].title
  });
  res.json({ ok: true, id: artifactId });
}));

router.get('/events/:id/purchased-items', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return res.status(400).json({ error: 'Invalid event id' });
  }

  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const purchasedItems = await loadPurchasedItemsForEvent(eventId, scopeContext);
  res.json({ items: purchasedItems });
}));

router.post('/events/:id/purchased-items', validate(eventPurchasedItemCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return res.status(400).json({ error: 'Invalid event id' });
  }

  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const source = await loadPurchasedItemSource(scopeContext, req.body.item_type, Number(req.body.item_id));
  if (!source) {
    return res.status(404).json({ error: 'Purchased item source not found in scope' });
  }

  const created = await pool.query(
    `INSERT INTO event_purchased_items (
       event_id,
       item_type,
       item_id,
       title_snapshot,
       vendor_snapshot,
       booth_snapshot,
       price_snapshot,
       created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (event_id, item_type, item_id) WHERE archived_at IS NULL
     DO NOTHING
     RETURNING *`,
    [
      eventId,
      source.item_type,
      source.item_id,
      req.body.title_snapshot || source.title,
      req.body.vendor_snapshot || source.vendor || null,
      req.body.booth_snapshot || source.booth || null,
      req.body.price_snapshot ?? source.price ?? null,
      req.user.id
    ]
  );
  if (!created.rows[0]) {
    return res.status(409).json({ error: 'Purchased item is already linked to this event' });
  }

  await logActivity(req, 'events.purchased_item.create', 'event', eventId, {
    purchasedItemId: created.rows[0].id,
    itemType: source.item_type,
    itemId: source.item_id
  });

  res.status(201).json(serializePurchasedItemRecord({
    ...created.rows[0],
    resolved_item: source.resolved_item
  }));
}));

router.patch('/events/:id/purchased-items/:purchasedItemId', validate(eventPurchasedItemUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  const purchasedItemId = Number(req.params.purchasedItemId);
  if (!Number.isFinite(eventId) || eventId <= 0 || !Number.isFinite(purchasedItemId) || purchasedItemId <= 0) {
    return res.status(400).json({ error: 'Invalid event/purchased item id' });
  }

  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const existing = await pool.query(
    `SELECT *
     FROM event_purchased_items
     WHERE id = $1
       AND event_id = $2
       AND archived_at IS NULL
     LIMIT 1`,
    [purchasedItemId, eventId]
  );
  if (!existing.rows[0]) {
    return res.status(404).json({ error: 'Purchased item link not found' });
  }

  let source = await loadPurchasedItemSource(scopeContext, existing.rows[0].item_type, existing.rows[0].item_id);
  let nextItemType = existing.rows[0].item_type;
  let nextItemId = existing.rows[0].item_id;

  const relinkRequested = Object.prototype.hasOwnProperty.call(req.body || {}, 'item_type')
    || Object.prototype.hasOwnProperty.call(req.body || {}, 'item_id');
  if (relinkRequested) {
    const targetItemType = req.body.item_type || existing.rows[0].item_type;
    const targetItemId = req.body.item_id || existing.rows[0].item_id;
    source = await loadPurchasedItemSource(scopeContext, targetItemType, Number(targetItemId));
    if (!source) {
      return res.status(404).json({ error: 'Purchased item source not found in scope' });
    }
    nextItemType = source.item_type;
    nextItemId = source.item_id;
  }

  if (
    (nextItemType !== existing.rows[0].item_type || Number(nextItemId) !== Number(existing.rows[0].item_id))
  ) {
    const duplicate = await pool.query(
      `SELECT id
       FROM event_purchased_items
       WHERE event_id = $1
         AND item_type = $2
         AND item_id = $3
         AND archived_at IS NULL
         AND id <> $4
       LIMIT 1`,
      [eventId, nextItemType, nextItemId, purchasedItemId]
    );
    if (duplicate.rows[0]) {
      return res.status(409).json({ error: 'Purchased item is already linked to this event' });
    }
  }

  const updated = await pool.query(
    `UPDATE event_purchased_items
     SET item_type = $3,
         item_id = $4,
         title_snapshot = $5,
         vendor_snapshot = $6,
         booth_snapshot = $7,
         price_snapshot = $8
     WHERE id = $1
       AND event_id = $2
       AND archived_at IS NULL
     RETURNING *`,
    [
      purchasedItemId,
      eventId,
      nextItemType,
      nextItemId,
      req.body.title_snapshot ?? existing.rows[0].title_snapshot ?? source?.title ?? null,
      req.body.vendor_snapshot ?? existing.rows[0].vendor_snapshot ?? source?.vendor ?? null,
      req.body.booth_snapshot ?? existing.rows[0].booth_snapshot ?? source?.booth ?? null,
      req.body.price_snapshot ?? existing.rows[0].price_snapshot ?? source?.price ?? null
    ]
  );

  await logActivity(req, 'events.purchased_item.update', 'event', eventId, {
    purchasedItemId,
    itemType: nextItemType,
    itemId: nextItemId
  });

  res.json(serializePurchasedItemRecord({
    ...updated.rows[0],
    resolved_item: source?.resolved_item || null
  }));
}));

router.delete('/events/:id/purchased-items/:purchasedItemId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  const purchasedItemId = Number(req.params.purchasedItemId);
  if (!Number.isFinite(eventId) || eventId <= 0 || !Number.isFinite(purchasedItemId) || purchasedItemId <= 0) {
    return res.status(400).json({ error: 'Invalid event/purchased item id' });
  }

  const eventRow = await ensureScopedEvent(scopeContext, eventId);
  if (!eventRow) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const deleted = await pool.query(
    `UPDATE event_purchased_items
     SET archived_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND event_id = $2
       AND archived_at IS NULL
     RETURNING id, item_type, item_id`,
    [purchasedItemId, eventId]
  );
  if (!deleted.rows[0]) {
    return res.status(404).json({ error: 'Purchased item link not found' });
  }

  await logActivity(req, 'events.purchased_item.delete', 'event', eventId, {
    purchasedItemId,
    itemType: deleted.rows[0].item_type,
    itemId: deleted.rows[0].item_id
  });

  res.json({ ok: true, id: purchasedItemId });
}));

router.post('/events/:id/artifacts/:artifactId/upload-image', memoryUpload.single('image'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  const artifactId = Number(req.params.artifactId);
  if (!Number.isFinite(eventId) || eventId <= 0 || !Number.isFinite(artifactId) || artifactId <= 0) {
    return res.status(400).json({ error: 'Invalid event/artifact id' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.has(String(req.file.mimetype || '').toLowerCase())) {
    return res.status(400).json({ error: 'Unsupported file type. Allowed: JPEG, PNG, WEBP, GIF.' });
  }

  const eventParams = [eventId];
  const eventScopeClause = appendScopeSql(eventParams, scopeContext);
  const eventResult = await pool.query(
    `SELECT id
     FROM events
     WHERE id = $1
       AND archived_at IS NULL
       ${eventScopeClause}
     LIMIT 1`,
    eventParams
  );
  if (!eventResult.rows[0]) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const artifactCheck = await pool.query(
    `SELECT id, image_path
     FROM event_artifacts
     WHERE event_id = $1
       AND id = $2
     LIMIT 1`,
    [eventId, artifactId]
  );
  if (!artifactCheck.rows[0]) {
    return res.status(404).json({ error: 'Artifact not found' });
  }

  const previousPath = artifactCheck.rows[0].image_path || null;
  const stored = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
  const updated = await pool.query(
    `UPDATE event_artifacts
     SET image_path = $1
     WHERE id = $2
     RETURNING id, image_path`,
    [stored.url, artifactId]
  );

  await logActivity(req, previousPath ? 'events.attachment.replace' : 'events.attachment.upload', 'event', eventId, {
    artifactId,
    previousPath,
    nextPath: updated.rows[0].image_path
  });

  res.json({
    id: updated.rows[0].id,
    image_path: updated.rows[0].image_path,
    provider: stored.provider
  });
}));

router.delete('/events/:id/artifacts/:artifactId/image', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const eventId = Number(req.params.id);
  const artifactId = Number(req.params.artifactId);
  if (!Number.isFinite(eventId) || eventId <= 0 || !Number.isFinite(artifactId) || artifactId <= 0) {
    return res.status(400).json({ error: 'Invalid event/artifact id' });
  }

  const eventParams = [eventId];
  const eventScopeClause = appendScopeSql(eventParams, scopeContext);
  const eventResult = await pool.query(
    `SELECT id
     FROM events
     WHERE id = $1
       AND archived_at IS NULL
       ${eventScopeClause}
     LIMIT 1`,
    eventParams
  );
  if (!eventResult.rows[0]) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const artifactCheck = await pool.query(
    `SELECT id, image_path
     FROM event_artifacts
     WHERE event_id = $1
       AND id = $2
     LIMIT 1`,
    [eventId, artifactId]
  );
  if (!artifactCheck.rows[0]) {
    return res.status(404).json({ error: 'Artifact not found' });
  }
  if (!artifactCheck.rows[0].image_path) {
    return res.json({ ok: true, removed: false });
  }

  await pool.query(
    `UPDATE event_artifacts
     SET image_path = NULL
     WHERE id = $1`,
    [artifactId]
  );
  await logActivity(req, 'events.attachment.delete', 'event', eventId, {
    artifactId,
    previousPath: artifactCheck.rows[0].image_path
  });
  res.json({ ok: true, removed: true });
}));

module.exports = router;
