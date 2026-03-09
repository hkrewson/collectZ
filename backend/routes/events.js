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
  eventArtifactUpdateSchema
} = require('../middleware/validate');
const { resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const { logActivity } = require('../services/audit');
const { uploadBuffer } = require('../services/storage');

const router = express.Router();
const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif'
]);

router.use(authenticateToken);
router.use(enforceScopeAccess({ allowedHintRoles: ['admin'] }));

const parsePaging = (req) => {
  const pageRaw = Number(req.query?.page);
  const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
  return { page, limit, offset: (page - 1) * limit };
};

router.get('/events', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const { page, limit, offset } = parsePaging(req);
  const q = String(req.query?.q || '').trim();
  const from = String(req.query?.from || '').trim();
  const to = String(req.query?.to || '').trim();
  const location = String(req.query?.location || '').trim();

  const params = [];
  let where = 'WHERE e.archived_at IS NULL';
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (e.title ILIKE $${params.length} OR COALESCE(e.host, '') ILIKE $${params.length} OR COALESCE(e.notes, '') ILIKE $${params.length})`;
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
       COALESCE(a.artifact_count, 0)::int AS artifact_count
     FROM events e
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS artifact_count
       FROM event_artifacts ea
       WHERE ea.event_id = e.id
     ) a ON TRUE
     ${whereWithScope}
     ORDER BY e.date_start DESC, e.created_at DESC
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
       COALESCE(a.artifact_count, 0)::int AS artifact_count
     FROM events e
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS artifact_count
       FROM event_artifacts ea
       WHERE ea.event_id = e.id
     ) a ON TRUE
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
  const { title, url, location, date_start, date_end, host, time_label, room, notes } = req.body;
  const result = await pool.query(
    `INSERT INTO events (
       library_id, space_id, created_by, title, url, location, date_start, date_end, host, time_label, room, notes
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11, $12)
     RETURNING *`,
    [libraryId, spaceId, req.user.id, title, url, location, date_start, date_end || null, host || null, time_label || null, room || null, notes || null]
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
  const allowed = ['title', 'url', 'location', 'date_start', 'date_end', 'host', 'time_label', 'room', 'notes'];
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
