const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const { validate, collectibleCreateSchema, collectibleUpdateSchema } = require('../middleware/validate');
const { resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const { logActivity } = require('../services/audit');
const { uploadBuffer } = require('../services/storage');
const {
  COLLECTIBLE_SUBTYPES,
  COLLECTIBLE_CATEGORY_DEFINITIONS,
  resolveCategoryKey,
  resolveCategoryLabel
} = require('../services/collectibles');
const { isFeatureEnabled } = require('../services/featureFlags');

const router = express.Router();
const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
]);

router.use('/collectibles', authenticateToken);
router.use('/collectibles', enforceScopeAccess());
router.use('/collectibles', asyncHandler(async (_req, res, next) => {
  const enabled = await isFeatureEnabled('collectibles_enabled', false);
  if (!enabled) return res.status(404).json({ error: 'Collectibles feature is disabled' });
  return next();
}));

const parsePaging = (req) => {
  const pageRaw = Number(req.query?.page);
  const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
  return { page, limit, offset: (page - 1) * limit };
};

const serializeCollectibleRow = (row) => ({
  ...row,
  subtype: row.subtype || row.item_type || 'collectible',
  category_key: row.category_key || resolveCategoryKey(row.category) || null,
  category: row.category || resolveCategoryLabel(row.category_key) || null,
  item_type: row.subtype || row.item_type || 'collectible'
});

const normalizeCollectiblePayload = (payload = {}) => {
  const subtype = payload.subtype || payload.item_type || 'collectible';
  const categoryKey = resolveCategoryKey(payload.category_key || payload.category);
  const categoryLabel = resolveCategoryLabel(categoryKey);
  return {
    subtype: COLLECTIBLE_SUBTYPES.includes(subtype) ? subtype : 'collectible',
    category_key: categoryKey || null,
    category: categoryLabel || null
  };
};

router.get('/collectibles/categories', asyncHandler(async (_req, res) => {
  const rows = await pool.query(
    `SELECT key, label, sort_order
     FROM collectible_categories
     ORDER BY sort_order ASC, label ASC`
  );
  res.json({
    categories: rows.rows.map((row) => ({
      key: row.key,
      label: row.label
    }))
  });
}));

router.get('/collectibles', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const { page, limit, offset } = parsePaging(req);
  const q = String(req.query?.q || '').trim();
  const subtype = String(req.query?.subtype || req.query?.item_type || '').trim();
  const category = String(req.query?.category_key || req.query?.category || '').trim();
  const vendor = String(req.query?.vendor || '').trim();
  const eventIdRaw = Number(req.query?.event_id);
  const exclusiveRaw = String(req.query?.exclusive || '').trim().toLowerCase();
  const sortDir = String(req.query?.sort_dir || '').trim().toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const params = [];
  let where = 'WHERE c.archived_at IS NULL';

  if (q) {
    params.push(`%${q}%`);
    where += ` AND (c.title ILIKE $${params.length} OR COALESCE(c.notes, '') ILIKE $${params.length})`;
  }
  if (subtype && COLLECTIBLE_SUBTYPES.includes(subtype)) {
    params.push(subtype);
    where += ` AND c.subtype = $${params.length}`;
  }
  if (category) {
    const categoryKey = resolveCategoryKey(category);
    if (categoryKey) {
      params.push(categoryKey);
      where += ` AND c.category_key = $${params.length}`;
    }
  }
  if (vendor) {
    params.push(`%${vendor}%`);
    where += ` AND COALESCE(c.booth_or_vendor, '') ILIKE $${params.length}`;
  }
  if (Number.isFinite(eventIdRaw) && eventIdRaw > 0) {
    params.push(eventIdRaw);
    where += ` AND c.event_id = $${params.length}`;
  }
  if (exclusiveRaw === 'true' || exclusiveRaw === 'false') {
    params.push(exclusiveRaw === 'true');
    where += ` AND c.exclusive = $${params.length}`;
  }

  const scopeClause = appendScopeSql(params, scopeContext, {
    libraryColumn: 'library_id',
    spaceColumn: 'space_id'
  });
  where += scopeClause;

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM collectibles c
     ${where}`,
    params
  );
  params.push(limit);
  params.push(offset);
  const rows = await pool.query(
    `SELECT c.*
     FROM collectibles c
     ${where}
     ORDER BY LOWER(c.title) ${sortDir} NULLS LAST, c.id ${sortDir}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = Number(countResult.rows[0]?.total || 0);
  res.json({
    items: rows.rows.map(serializeCollectibleRow),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: page < Math.max(1, Math.ceil(total / limit))
    }
  });
}));

router.get('/collectibles/:id', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const collectibleId = Number(req.params.id);
  if (!Number.isFinite(collectibleId) || collectibleId <= 0) {
    return res.status(400).json({ error: 'Invalid collectible id' });
  }
  const params = [collectibleId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    libraryColumn: 'library_id',
    spaceColumn: 'space_id'
  });
  const result = await pool.query(
    `SELECT c.*
     FROM collectibles c
     WHERE id = $1
       AND c.archived_at IS NULL
       ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Collectible not found' });
  res.json(serializeCollectibleRow(result.rows[0]));
}));

router.post('/collectibles', validate(collectibleCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const libraryId = req.body.library_id || scopeContext.libraryId || null;
  const spaceId = req.body.space_id || scopeContext.spaceId || null;
  if (!libraryId) return res.status(400).json({ error: 'No active library selected for collectible creation' });
  const {
    title,
    subtype,
    item_type, // legacy alias
    category_key,
    category, // legacy alias
    event_id,
    booth_or_vendor,
    price,
    exclusive,
    image_path,
    notes
  } = req.body;
  const normalizedPayload = normalizeCollectiblePayload({
    subtype,
    item_type,
    category_key,
    category
  });
  const requestedCategory = category_key ?? category;
  if (requestedCategory !== undefined && requestedCategory !== null && requestedCategory !== '' && !normalizedPayload.category_key) {
    return res.status(400).json({ error: 'Invalid category value' });
  }

  if (event_id) {
    const eventParams = [event_id];
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
    if (!eventResult.rows[0]) return res.status(404).json({ error: 'Linked event not found in scope' });
  }

  const created = await pool.query(
    `INSERT INTO collectibles (
       library_id, space_id, created_by, title, subtype, item_type, category_key, category, event_id, booth_or_vendor, price, exclusive, image_path, notes
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
     )
     RETURNING *`,
    [
      libraryId,
      spaceId,
      req.user.id,
      title,
      normalizedPayload.subtype,
      normalizedPayload.subtype,
      normalizedPayload.category_key,
      normalizedPayload.category,
      event_id || null,
      booth_or_vendor || null,
      price ?? null,
      exclusive === true,
      image_path || null,
      notes || null
    ]
  );
  const row = created.rows[0];
  await logActivity(req, 'collectibles.create', 'collectible', row.id, {
    title: row.title,
    subtype: row.subtype,
    category_key: row.category_key,
    event_id: row.event_id
  });
  if (row.event_id) {
    await logActivity(req, 'collectibles.link_event', 'collectible', row.id, {
      event_id: row.event_id
    });
  }
  res.status(201).json(serializeCollectibleRow(row));
}));

router.patch('/collectibles/:id', validate(collectibleUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const collectibleId = Number(req.params.id);
  if (!Number.isFinite(collectibleId) || collectibleId <= 0) {
    return res.status(400).json({ error: 'Invalid collectible id' });
  }

  const allowed = ['title', 'subtype', 'item_type', 'category_key', 'category', 'event_id', 'booth_or_vendor', 'price', 'exclusive', 'image_path', 'notes'];
  const fields = Object.entries(req.body || {}).filter(([key]) => allowed.includes(key));
  if (fields.length === 0) return res.status(400).json({ error: 'No valid collectible fields provided' });

  const currentParams = [collectibleId];
  const currentScopeClause = appendScopeSql(currentParams, scopeContext, {
    libraryColumn: 'library_id',
    spaceColumn: 'space_id'
  });
  const current = await pool.query(
    `SELECT id, subtype, event_id
     FROM collectibles
     WHERE id = $1
       AND archived_at IS NULL
       ${currentScopeClause}
     LIMIT 1`,
    currentParams
  );
  if (!current.rows[0]) return res.status(404).json({ error: 'Collectible not found' });

  const hadSubtypeKey = Object.prototype.hasOwnProperty.call(req.body || {}, 'subtype')
    || Object.prototype.hasOwnProperty.call(req.body || {}, 'item_type');
  const hadCategoryKey = Object.prototype.hasOwnProperty.call(req.body || {}, 'category_key')
    || Object.prototype.hasOwnProperty.call(req.body || {}, 'category');
  const normalizedPayload = normalizeCollectiblePayload({
    subtype: req.body?.subtype,
    item_type: req.body?.item_type,
    category_key: req.body?.category_key,
    category: req.body?.category
  });
  const requestedCategory = req.body?.category_key ?? req.body?.category;
  if (requestedCategory !== undefined && requestedCategory !== null && requestedCategory !== '' && !normalizedPayload.category_key) {
    return res.status(400).json({ error: 'Invalid category value' });
  }

  const eventField = fields.find(([key]) => key === 'event_id');
  if (eventField && eventField[1]) {
    const eventParams = [Number(eventField[1])];
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
    if (!eventResult.rows[0]) return res.status(404).json({ error: 'Linked event not found in scope' });
  }

  const params = [collectibleId];
  const updates = [];
  for (const [key, value] of fields) {
    if (['subtype', 'item_type', 'category_key', 'category'].includes(key)) continue;
    params.push(value === '' ? null : value);
    updates.push({ key, ref: `$${params.length}` });
  }

  if (hadSubtypeKey) {
    params.push(normalizedPayload.subtype);
    updates.push({ key: 'subtype', ref: `$${params.length}` });
    params.push(normalizedPayload.subtype);
    updates.push({ key: 'item_type', ref: `$${params.length}` });
  }
  if (hadCategoryKey) {
    params.push(normalizedPayload.category_key);
    updates.push({ key: 'category_key', ref: `$${params.length}` });
    params.push(normalizedPayload.category);
    updates.push({ key: 'category', ref: `$${params.length}` });
  }
  const setClause = updates.map((entry) => `${entry.key} = ${entry.ref}`).join(', ');
  const whereScope = appendScopeSql(params, scopeContext, {
    libraryColumn: 'library_id',
    spaceColumn: 'space_id'
  });
  const updated = await pool.query(
    `UPDATE collectibles
     SET ${setClause}
     WHERE id = $1
       AND archived_at IS NULL
       ${whereScope}
     RETURNING *`,
    params
  );
  if (!updated.rows[0]) return res.status(404).json({ error: 'Collectible not found' });
  const updatedRow = updated.rows[0];
  if (hadSubtypeKey && current.rows[0].subtype !== updatedRow.subtype) {
    await logActivity(req, 'collectibles.reclassify', 'collectible', collectibleId, {
      from: current.rows[0].subtype,
      to: updatedRow.subtype
    });
  }
  if (eventField && Number(current.rows[0].event_id || 0) !== Number(updatedRow.event_id || 0)) {
    await logActivity(req, 'collectibles.link_event', 'collectible', collectibleId, {
      from_event_id: current.rows[0].event_id || null,
      to_event_id: updatedRow.event_id || null
    });
  }
  await logActivity(req, 'collectibles.update', 'collectible', collectibleId, {
    fields: updates.map((entry) => entry.key)
  });
  res.json(serializeCollectibleRow(updatedRow));
}));

router.post('/collectibles/:id/reclassify', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const collectibleId = Number(req.params.id);
  const requestedSubtype = String(req.body?.subtype || '').trim();
  if (!Number.isFinite(collectibleId) || collectibleId <= 0) {
    return res.status(400).json({ error: 'Invalid collectible id' });
  }
  if (!COLLECTIBLE_SUBTYPES.includes(requestedSubtype)) {
    return res.status(400).json({ error: 'Invalid subtype' });
  }
  const params = [collectibleId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    libraryColumn: 'library_id',
    spaceColumn: 'space_id'
  });
  const updated = await pool.query(
    `UPDATE collectibles
     SET subtype = $2,
         item_type = $2
     WHERE id = $1
       AND archived_at IS NULL
       ${scopeClause}
     RETURNING *`,
    [...params, requestedSubtype]
  );
  if (!updated.rows[0]) return res.status(404).json({ error: 'Collectible not found' });
  await logActivity(req, 'collectibles.reclassify', 'collectible', collectibleId, {
    to: requestedSubtype
  });
  res.json(serializeCollectibleRow(updated.rows[0]));
}));

router.delete('/collectibles/:id', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const collectibleId = Number(req.params.id);
  if (!Number.isFinite(collectibleId) || collectibleId <= 0) {
    return res.status(400).json({ error: 'Invalid collectible id' });
  }
  const params = [collectibleId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    libraryColumn: 'library_id',
    spaceColumn: 'space_id'
  });
  const deleted = await pool.query(
    `UPDATE collectibles
     SET archived_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND archived_at IS NULL
       ${scopeClause}
     RETURNING id, title`,
    params
  );
  if (!deleted.rows[0]) return res.status(404).json({ error: 'Collectible not found' });
  await logActivity(req, 'collectibles.delete', 'collectible', collectibleId, {
    title: deleted.rows[0].title
  });
  res.json({ ok: true, id: collectibleId });
}));

router.post('/collectibles/:id/upload-image', memoryUpload.single('image'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const collectibleId = Number(req.params.id);
  if (!Number.isFinite(collectibleId) || collectibleId <= 0) {
    return res.status(400).json({ error: 'Invalid collectible id' });
  }
  if (!req.file) return res.status(400).json({ error: 'Image file is required' });
  if (!ALLOWED_IMAGE_MIME_TYPES.has(String(req.file.mimetype || '').toLowerCase())) {
    return res.status(400).json({ error: 'Unsupported image type' });
  }

  const params = [collectibleId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    libraryColumn: 'library_id',
    spaceColumn: 'space_id'
  });
  const existing = await pool.query(
    `SELECT id, image_path
     FROM collectibles
     WHERE id = $1
       AND archived_at IS NULL
       ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!existing.rows[0]) return res.status(404).json({ error: 'Collectible not found' });

  const previousPath = existing.rows[0].image_path || null;
  const stored = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
  const updated = await pool.query(
    `UPDATE collectibles
     SET image_path = $1
     WHERE id = $2
     RETURNING id, image_path`,
    [stored.url, collectibleId]
  );

  await logActivity(req, previousPath ? 'collectibles.image.replace' : 'collectibles.image.upload', 'collectible', collectibleId, {
    previousPath,
    imagePath: updated.rows[0].image_path,
    provider: stored.provider
  });

  res.json(updated.rows[0]);
}));

router.delete('/collectibles/:id/image', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const collectibleId = Number(req.params.id);
  if (!Number.isFinite(collectibleId) || collectibleId <= 0) {
    return res.status(400).json({ error: 'Invalid collectible id' });
  }

  const params = [collectibleId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    libraryColumn: 'library_id',
    spaceColumn: 'space_id'
  });
  const existing = await pool.query(
    `SELECT id, image_path
     FROM collectibles
     WHERE id = $1
       AND archived_at IS NULL
       ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!existing.rows[0]) return res.status(404).json({ error: 'Collectible not found' });
  if (!existing.rows[0].image_path) return res.status(400).json({ error: 'No image attached' });

  await pool.query(`UPDATE collectibles SET image_path = NULL WHERE id = $1`, [collectibleId]);
  await logActivity(req, 'collectibles.image.delete', 'collectible', collectibleId, {
    previousPath: existing.rows[0].image_path
  });
  res.json({ ok: true, id: collectibleId });
}));

module.exports = router;
