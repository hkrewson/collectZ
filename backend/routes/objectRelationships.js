const express = require('express');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const { resolveScopeContext } = require('../db/scopeContext');
const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');
const { logActivity } = require('../services/audit');
const {
  archiveRelationship,
  createRelationship,
  loadRelationshipsForOwner,
  resolveRelationshipOwner,
  searchRelationshipTargets
} = require('../services/objectRelationships');

const router = express.Router();

router.use('/object-relationships', authenticateToken);
router.use('/object-relationships', enforceScopeAccess());

const resolveOwnerFromRequest = async (req, db = pool) => resolveRelationshipOwner(db, {
  ownerType: req.params.ownerType || req.body?.owner_type,
  ownerId: req.params.ownerId || req.body?.owner_id,
  scopeContext: resolveScopeContext(req)
});

const withObjectRelationshipScope = async (req, work) => {
  const scopeContext = resolveScopeContext(req);
  const spaceId = Number(scopeContext?.spaceId || 0);
  const rawLibraryId = scopeContext?.libraryId;
  const libraryId = rawLibraryId === null || rawLibraryId === undefined || rawLibraryId === ''
    ? null
    : Number(rawLibraryId);
  if (!Number.isInteger(spaceId) || spaceId <= 0 ||
      (libraryId !== null && (!Number.isInteger(libraryId) || libraryId <= 0))) {
    const error = new Error('Active workspace is required for object relationships');
    error.status = 400;
    throw error;
  }
  return withAuthorizedScopeTransaction(pool, { spaceId, libraryId }, req.user.id, work);
};

router.get('/object-relationships/search', asyncHandler(async (req, res) => {
  const matches = await searchRelationshipTargets(pool, {
    q: req.query.q,
    ownerType: req.query.type || req.query.owner_type || 'all',
    scopeContext: resolveScopeContext(req),
    limit: req.query.limit
  });
  res.json({ matches });
}));

router.get('/object-relationships/:ownerType/:ownerId', asyncHandler(async (req, res) => {
  const result = await withObjectRelationshipScope(req, async (client) => {
    const owner = await resolveOwnerFromRequest(req, client);
    const relationships = await loadRelationshipsForOwner(client, {
      ownerType: owner.owner_type,
      ownerId: owner.owner_id
    });
    return { owner, relationships };
  });
  res.json(result);
}));

router.post('/object-relationships/:ownerType/:ownerId', asyncHandler(async (req, res) => {
  const result = await withObjectRelationshipScope(req, async (client) => {
    const owner = await resolveOwnerFromRequest(req, client);
    const relationship = await createRelationship(client, {
      source: owner,
      targetType: req.body?.target_type,
      targetId: req.body?.target_id,
      relationshipType: req.body?.relationship_type,
      label: req.body?.label,
      notes: req.body?.notes,
      scopeContext: resolveScopeContext(req),
      userId: req.user?.id || null
    });
    return { owner, relationship };
  });
  const { owner, relationship } = result;
  await logActivity(req, 'object_relationship.create', 'object_relationship', relationship.id, {
    ownerType: owner.owner_type,
    ownerId: owner.owner_id,
    targetType: relationship.target?.owner_type,
    targetId: relationship.target?.owner_id,
    relationshipType: relationship.relationship_type,
    libraryId: owner.library_id || null,
    spaceId: owner.space_id || null
  });
  res.status(201).json({ owner, relationship });
}));

router.delete('/object-relationships/:ownerType/:ownerId/:relationshipId', asyncHandler(async (req, res) => {
  const result = await withObjectRelationshipScope(req, async (client) => {
    const owner = await resolveOwnerFromRequest(req, client);
    const relationship = await archiveRelationship(client, {
      owner,
      relationshipId: req.params.relationshipId
    });
    return { owner, relationship };
  });
  const { owner, relationship } = result;
  await logActivity(req, 'object_relationship.archive', 'object_relationship', relationship.id, {
    ownerType: owner.owner_type,
    ownerId: owner.owner_id,
    relationshipType: relationship.relationship_type,
    libraryId: owner.library_id || null,
    spaceId: owner.space_id || null
  });
  res.json({ owner, relationship, archived: true });
}));

module.exports = router;
