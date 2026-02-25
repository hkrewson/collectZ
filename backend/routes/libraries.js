const express = require('express');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const {
  validate,
  libraryCreateSchema,
  libraryUpdateSchema,
  librarySelectSchema,
  libraryDeleteSchema,
  libraryTransferSchema,
  libraryArchiveSchema
} = require('../middleware/validate');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const { logActivity } = require('../services/audit');
const { listLibrariesForUser, getAccessibleLibrary, ensureUserDefaultLibrary } = require('../services/libraries');

const router = express.Router();

router.use(authenticateToken);
router.use(enforceScopeAccess({ allowedHintRoles: ['admin', 'user', 'viewer'] }));

router.get('/libraries', asyncHandler(async (req, res) => {
  await ensureUserDefaultLibrary(req.user.id);
  const libraries = await listLibrariesForUser({ userId: req.user.id, role: req.user.role });
  const userScopeResult = await pool.query(
    `SELECT active_library_id
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [req.user.id]
  );
  const activeLibraryId = Number(userScopeResult.rows[0]?.active_library_id || 0) || null;
  const hasActive = activeLibraryId && libraries.some((lib) => Number(lib.id) === activeLibraryId);
  if (!hasActive && libraries.length > 0) {
    const fallbackLibraryId = libraries[0].id;
    await pool.query(
      `UPDATE users
       SET active_library_id = $2
       WHERE id = $1`,
      [req.user.id, fallbackLibraryId]
    );
    req.user.activeLibraryId = fallbackLibraryId;
  }
  const resolvedActiveLibraryId = hasActive
    ? activeLibraryId
    : (libraries[0]?.id || null);
  res.json({
    libraries,
    active_library_id: resolvedActiveLibraryId
  });
}));

router.post('/libraries', validate(libraryCreateSchema), asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  const created = await pool.query(
    `INSERT INTO libraries (name, description, created_by, space_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, description, space_id, created_by, created_at, updated_at`,
    [name.trim(), description || null, req.user.id, req.user.activeSpaceId || null]
  );
  const library = created.rows[0];

  await pool.query(
    `INSERT INTO library_memberships (user_id, library_id, role)
     VALUES ($1, $2, 'owner')
     ON CONFLICT (user_id, library_id) DO NOTHING`,
    [req.user.id, library.id]
  );

  await pool.query(
    `UPDATE users
     SET active_library_id = $2
     WHERE id = $1`,
    [req.user.id, library.id]
  );
  req.user.activeLibraryId = library.id;

  await logActivity(req, 'library.create', 'library', library.id, {
    name: library.name
  });
  res.status(201).json({
    ...library,
    active_library_id: library.id
  });
}));

router.patch('/libraries/:id', validate(libraryUpdateSchema), asyncHandler(async (req, res) => {
  const libraryId = Number(req.params.id);
  if (!Number.isFinite(libraryId) || libraryId <= 0) {
    return res.status(400).json({ error: 'Invalid library id' });
  }

  const allowedLibrary = await getAccessibleLibrary({
    userId: req.user.id,
    role: req.user.role,
    libraryId
  });
  if (!allowedLibrary) {
    return res.status(403).json({ error: 'Library access denied' });
  }

  const updates = [];
  const params = [];
  if (req.body.name !== undefined) {
    params.push(req.body.name.trim());
    updates.push(`name = $${params.length}`);
  }
  if (req.body.description !== undefined) {
    params.push(req.body.description || null);
    updates.push(`description = $${params.length}`);
  }
  if (updates.length === 0) {
    return res.status(400).json({ error: 'No library fields provided' });
  }

  params.push(libraryId);
  const result = await pool.query(
    `UPDATE libraries
     SET ${updates.join(', ')}
     WHERE id = $${params.length}
       AND archived_at IS NULL
     RETURNING id, name, description, space_id, created_by, created_at, updated_at`,
    params
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Library not found' });
  }

  await logActivity(req, 'library.update', 'library', libraryId, {
    previousName: allowedLibrary.name,
    nextName: result.rows[0].name
  });
  res.json(result.rows[0]);
}));

router.post('/libraries/select', validate(librarySelectSchema), asyncHandler(async (req, res) => {
  const libraryId = Number(req.body.library_id);
  const selected = await getAccessibleLibrary({
    userId: req.user.id,
    role: req.user.role,
    libraryId
  });
  if (!selected) {
    return res.status(403).json({ error: 'Library access denied' });
  }

  await pool.query(
    `UPDATE users
     SET active_library_id = $2,
         active_space_id = $3
     WHERE id = $1`,
    [req.user.id, selected.id, selected.space_id || null]
  );
  req.user.activeLibraryId = selected.id;
  req.user.activeSpaceId = selected.space_id || null;

  await logActivity(req, 'library.select', 'library', selected.id, {
    libraryName: selected.name
  });

  res.json({
    active_library_id: selected.id,
    active_space_id: selected.space_id || null,
    library: selected
  });
}));

router.post('/libraries/:id/transfer', validate(libraryTransferSchema), asyncHandler(async (req, res) => {
  const libraryId = Number(req.params.id);
  if (!Number.isFinite(libraryId) || libraryId <= 0) {
    return res.status(400).json({ error: 'Invalid library id' });
  }

  const target = await getAccessibleLibrary({
    userId: req.user.id,
    role: req.user.role,
    libraryId
  });
  if (!target) {
    return res.status(403).json({ error: 'Library access denied' });
  }

  if (req.user.role !== 'admin' && Number(target.created_by || 0) !== Number(req.user.id)) {
    return res.status(403).json({ error: 'Only admins or owners can transfer ownership' });
  }

  const newOwnerUserId = Number(req.body.new_owner_user_id);
  const newOwnerResult = await pool.query(
    `SELECT id, email, name
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [newOwnerUserId]
  );
  if (newOwnerResult.rows.length === 0) {
    return res.status(404).json({ error: 'Target owner user not found' });
  }

  await pool.query(
    `UPDATE libraries
     SET created_by = $2
     WHERE id = $1`,
    [libraryId, newOwnerUserId]
  );
  await pool.query(
    `INSERT INTO library_memberships (user_id, library_id, role)
     VALUES ($1, $2, 'owner')
     ON CONFLICT (user_id, library_id)
     DO UPDATE SET role = 'owner'`,
    [newOwnerUserId, libraryId]
  );

  await logActivity(req, 'library.transfer', 'library', libraryId, {
    libraryName: target.name,
    previousOwnerUserId: target.created_by || null,
    nextOwnerUserId: newOwnerUserId,
    nextOwnerEmail: newOwnerResult.rows[0].email
  });

  res.json({
    id: libraryId,
    name: target.name,
    new_owner_user_id: newOwnerUserId,
    new_owner_email: newOwnerResult.rows[0].email,
    new_owner_name: newOwnerResult.rows[0].name || null
  });
}));

router.post('/libraries/:id/archive', validate(libraryArchiveSchema), asyncHandler(async (req, res) => {
  const libraryId = Number(req.params.id);
  if (!Number.isFinite(libraryId) || libraryId <= 0) {
    return res.status(400).json({ error: 'Invalid library id' });
  }
  const target = await getAccessibleLibrary({
    userId: req.user.id,
    role: req.user.role,
    libraryId
  });
  if (!target) {
    return res.status(403).json({ error: 'Library access denied' });
  }

  if (String(req.body.confirm_name || '').trim() !== String(target.name || '').trim()) {
    return res.status(400).json({ error: 'Library name confirmation does not match' });
  }

  if (req.user.role !== 'admin' && Number(target.created_by || 0) !== Number(req.user.id)) {
    return res.status(403).json({ error: 'Only admins or owners can archive libraries' });
  }

  const itemCountResult = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM media
     WHERE library_id = $1`,
    [libraryId]
  );
  const itemCount = Number(itemCountResult.rows[0]?.count || 0);
  if (itemCount > 0) {
    return res.status(400).json({
      error: 'Cannot archive a non-empty library',
      detail: 'Move or delete media items first',
      item_count: itemCount
    });
  }

  await pool.query(
    `UPDATE libraries
     SET archived_at = NOW()
     WHERE id = $1`,
    [libraryId]
  );

  const usersWithActive = await pool.query(
    `SELECT id
     FROM users
     WHERE active_library_id = $1`,
    [libraryId]
  );
  for (const row of usersWithActive.rows) {
    const replacement = await pool.query(
      `SELECT lm.library_id
       FROM library_memberships lm
       JOIN libraries l ON l.id = lm.library_id
       WHERE lm.user_id = $1
         AND l.archived_at IS NULL
       ORDER BY lm.created_at ASC, lm.library_id ASC
       LIMIT 1`,
      [row.id]
    );
    await pool.query(
      `UPDATE users
       SET active_library_id = $2
       WHERE id = $1`,
      [row.id, replacement.rows[0]?.library_id || null]
    );
  }

  await logActivity(req, 'library.archive', 'library', libraryId, {
    name: target.name
  });
  res.json({ message: 'Library archived' });
}));

router.post('/libraries/:id/unarchive', asyncHandler(async (req, res) => {
  const libraryId = Number(req.params.id);
  if (!Number.isFinite(libraryId) || libraryId <= 0) {
    return res.status(400).json({ error: 'Invalid library id' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can unarchive libraries' });
  }
  const existing = await pool.query(
    `SELECT id, name
     FROM libraries
     WHERE id = $1
     LIMIT 1`,
    [libraryId]
  );
  if (existing.rows.length === 0) {
    return res.status(404).json({ error: 'Library not found' });
  }
  await pool.query(
    `UPDATE libraries
     SET archived_at = NULL
     WHERE id = $1`,
    [libraryId]
  );
  await logActivity(req, 'library.unarchive', 'library', libraryId, {
    name: existing.rows[0].name
  });
  res.json({ message: 'Library unarchived' });
}));

router.delete('/libraries/:id', validate(libraryDeleteSchema), asyncHandler(async (req, res) => {
  const libraryId = Number(req.params.id);
  if (!Number.isFinite(libraryId) || libraryId <= 0) {
    return res.status(400).json({ error: 'Invalid library id' });
  }

  const target = await getAccessibleLibrary({
    userId: req.user.id,
    role: req.user.role,
    libraryId
  });
  if (!target) {
    return res.status(403).json({ error: 'Library access denied' });
  }

  if (String(req.body.confirm_name || '').trim() !== String(target.name || '').trim()) {
    return res.status(400).json({ error: 'Library name confirmation does not match' });
  }

  if (req.user.role !== 'admin' && Number(target.created_by || 0) !== Number(req.user.id)) {
    return res.status(403).json({ error: 'Only the creator can delete this library' });
  }

  const itemCountResult = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM media
     WHERE library_id = $1`,
    [libraryId]
  );
  const itemCount = Number(itemCountResult.rows[0]?.count || 0);
  if (itemCount > 0) {
    return res.status(400).json({
      error: 'Cannot delete a non-empty library',
      detail: 'Move or delete media items first',
      item_count: itemCount
    });
  }

  const usersWithActive = await pool.query(
    `SELECT id
     FROM users
     WHERE active_library_id = $1`,
    [libraryId]
  );

  await pool.query('DELETE FROM library_memberships WHERE library_id = $1', [libraryId]);
  await pool.query(
    `UPDATE libraries
     SET archived_at = NOW()
     WHERE id = $1`,
    [libraryId]
  );

  for (const row of usersWithActive.rows) {
    const replacement = await pool.query(
      `SELECT lm.library_id
       FROM library_memberships lm
       JOIN libraries l ON l.id = lm.library_id
       WHERE lm.user_id = $1
         AND l.archived_at IS NULL
       ORDER BY lm.created_at ASC, lm.library_id ASC
      LIMIT 1`,
      [row.id]
    );
    let replacementLibraryId = replacement.rows[0]?.library_id || null;
    if (!replacementLibraryId) {
      replacementLibraryId = await ensureUserDefaultLibrary(row.id);
    }
    await pool.query(
      `UPDATE users
       SET active_library_id = $2
       WHERE id = $1`,
      [row.id, replacementLibraryId]
    );
  }

  await logActivity(req, 'library.delete', 'library', libraryId, {
    name: target.name,
    ownerUserId: target.created_by || null
  });
  res.json({ message: 'Library deleted' });
}));

module.exports = router;
