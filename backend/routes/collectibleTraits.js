const express = require('express');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const { resolveScopeContext } = require('../db/scopeContext');
const { logActivity } = require('../services/audit');
const {
  archiveTraitRecord,
  loadTraitRecordsForOwner,
  resolveTraitOwner,
  upsertTraitRecord
} = require('../services/collectibleTraitRecords');

const router = express.Router();

router.use('/collectible-traits', authenticateToken);
router.use('/collectible-traits', enforceScopeAccess());

const resolveOwnerFromRequest = async (req) => resolveTraitOwner(pool, {
  ownerType: req.params.ownerType || req.body?.owner_type,
  ownerId: req.params.ownerId || req.body?.owner_id,
  scopeContext: resolveScopeContext(req)
});

router.get('/collectible-traits/:ownerType/:ownerId', asyncHandler(async (req, res) => {
  const owner = await resolveOwnerFromRequest(req);
  const traits = await loadTraitRecordsForOwner(pool, {
    ownerType: owner.owner_type,
    ownerId: owner.owner_id
  });
  res.json({ owner, traits });
}));

const upsertTraitHandler = asyncHandler(async (req, res) => {
  const owner = await resolveOwnerFromRequest(req);
  const input = {
    ...req.body,
    trait_key: req.params.traitKey || req.body?.trait_key || req.body?.key
  };
  const trait = await upsertTraitRecord(pool, {
    owner,
    input,
    userId: req.user?.id || null
  });
  await logActivity(req, 'collectible_trait.upsert', 'collectible_trait', trait.id, {
    ownerType: owner.owner_type,
    ownerId: owner.owner_id,
    traitKey: trait.key,
    family: trait.family,
    libraryId: owner.library_id || null,
    spaceId: owner.space_id || null
  });
  res.json({ owner, trait });
});

router.put('/collectible-traits/:ownerType/:ownerId', upsertTraitHandler);
router.put('/collectible-traits/:ownerType/:ownerId/:traitKey', upsertTraitHandler);

router.delete('/collectible-traits/:ownerType/:ownerId/:traitKey', asyncHandler(async (req, res) => {
  const owner = await resolveOwnerFromRequest(req);
  const trait = await archiveTraitRecord(pool, {
    owner,
    traitKey: req.params.traitKey
  });
  await logActivity(req, 'collectible_trait.archive', 'collectible_trait', trait.id, {
    ownerType: owner.owner_type,
    ownerId: owner.owner_id,
    traitKey: trait.key,
    family: trait.family,
    libraryId: owner.library_id || null,
    spaceId: owner.space_id || null
  });
  res.json({ owner, trait, archived: true });
}));

module.exports = router;
