const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const { validate, collectibleCreateSchema, collectibleUpdateSchema, artCreateSchema, artUpdateSchema } = require('../middleware/validate');
const { resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const { logActivity } = require('../services/audit');
const { uploadBuffer } = require('../services/storage');
const {
  loadSignatureRecords,
  loadSignatureRecordsForOwner,
  syncPrimarySignatureRecord
} = require('../services/signatures');
const {
  ACTIVE_COLLECTIBLE_CATEGORY_KEYS,
  COLLECTIBLE_SUBTYPES,
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
const ART_SUBTYPE = 'art';
const COLLECTIBLE_ROUTE_PATHS = ['/collectibles', '/art'];
const COLLECTIBLE_DETAIL_PATHS = ['/collectibles/:id', '/art/:id'];
const COLLECTIBLE_DELETE_PATHS = ['/collectibles/:id', '/art/:id'];
const COLLECTIBLE_UPLOAD_PATHS = ['/collectibles/:id/upload-image', '/art/:id/upload-image'];
const COLLECTIBLE_IMAGE_DELETE_PATHS = ['/collectibles/:id/image', '/art/:id/image'];

const resolveRouteConfig = (req) => {
  const isArtRoute = String(req.path || '').startsWith('/art');
  return {
    isArtRoute,
    forcedSubtype: isArtRoute ? ART_SUBTYPE : null,
    entityLabel: isArtRoute ? 'art' : 'collectible'
  };
};

const appendSubtypeScope = (where, params, subtype, column = 'c.subtype') => {
  if (!subtype) return where;
  params.push(subtype);
  return `${where} AND ${column} = $${params.length}`;
};

router.use(COLLECTIBLE_ROUTE_PATHS, authenticateToken);
router.use(COLLECTIBLE_ROUTE_PATHS, enforceScopeAccess());
router.use(COLLECTIBLE_ROUTE_PATHS, asyncHandler(async (_req, res, next) => {
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

const serializeCollectibleRow = (row) => {
  const vendor = row.vendor || null;
  const booth = row.booth || null;
  const legacyVendorValue = row.booth_or_vendor || null;
  return {
    ...row,
    subtype: row.subtype || row.item_type || 'collectible',
    category_key: row.category_key || resolveCategoryKey(row.category) || null,
    category: row.category || resolveCategoryLabel(row.category_key) || null,
    item_type: row.subtype || row.item_type || 'collectible',
    series: row.series || null,
    franchise: row.franchise || null,
    native_art_id: row.native_art_id || null,
    vendor,
    booth,
    booth_or_vendor: vendor && booth ? `${vendor} / ${booth}` : (vendor || booth || legacyVendorValue || null)
  };
};

const serializeNativeArtRow = (row) => {
  const vendor = row.vendor || null;
  const booth = row.booth || null;
  const signatures = Array.isArray(row.signatures) ? row.signatures : [];
  const primarySignature = signatures.find((signature) => signature.is_primary) || signatures[0] || null;
  return {
    id: row.source_collectible_id || row.id,
    native_art_id: row.id,
    source_collectible_id: row.source_collectible_id || null,
    library_id: row.library_id || null,
    space_id: row.space_id || null,
    title: row.title,
    subtype: ART_SUBTYPE,
    item_type: ART_SUBTYPE,
    category_key: null,
    category: null,
    event_id: row.event_id || null,
    purchased_item_id: row.purchased_item_id || null,
    series: row.series || null,
    franchise: row.franchise || null,
    medium: row.medium || null,
    artist: row.artist || null,
    vendor,
    booth,
    booth_or_vendor: vendor && booth ? `${vendor} / ${booth}` : (vendor || booth || null),
    price: row.price === null || row.price === undefined ? null : Number(row.price),
    exclusive: row.exclusive === true,
    signed: row.signed === true || signatures.length > 0,
    signatures,
    signer_name: primarySignature?.signer_name || null,
    signer_role: primarySignature?.signer_role || null,
    signed_on: primarySignature?.signed_on || null,
    signed_at: primarySignature?.signed_at || null,
    signed_event_id: primarySignature?.signed_event_id || null,
    signature_proof_path: primarySignature?.proof_path || null,
    signature_notes: primarySignature?.notes || null,
    image_path: row.image_path || null,
    notes: row.notes || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
};

const buildNativeArtSelect = () => `
  SELECT a.*,
         COALESCE(epi.event_id, c.event_id) AS event_id,
         epi.id AS purchased_item_id
  FROM art_items a
  LEFT JOIN collectibles c
    ON c.id = a.source_collectible_id
   AND c.archived_at IS NULL
  LEFT JOIN LATERAL (
    SELECT id, event_id
    FROM event_purchased_items
    WHERE item_type = 'art'
      AND item_id = a.id
      AND archived_at IS NULL
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  ) epi ON true
`;

const upsertNativeArtFromCollectible = async (collectibleRow) => {
  const result = await pool.query(
    `INSERT INTO art_items (
       source_collectible_id,
       library_id,
       space_id,
       created_by,
       title,
       artist,
       series,
       franchise,
       medium,
       vendor,
       booth,
       price,
       exclusive,
       signed,
       image_path,
       notes,
       archived_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
     )
     ON CONFLICT (source_collectible_id) DO UPDATE
       SET library_id = EXCLUDED.library_id,
           space_id = EXCLUDED.space_id,
           title = EXCLUDED.title,
           artist = EXCLUDED.artist,
           series = EXCLUDED.series,
           franchise = EXCLUDED.franchise,
           medium = COALESCE(EXCLUDED.medium, art_items.medium),
           vendor = EXCLUDED.vendor,
           booth = EXCLUDED.booth,
           price = EXCLUDED.price,
           exclusive = EXCLUDED.exclusive,
           signed = COALESCE(EXCLUDED.signed, art_items.signed, false),
           image_path = EXCLUDED.image_path,
           notes = EXCLUDED.notes,
           archived_at = EXCLUDED.archived_at,
           updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      collectibleRow.id,
      collectibleRow.library_id || null,
      collectibleRow.space_id || null,
      collectibleRow.created_by || null,
      collectibleRow.title,
      collectibleRow.artist || null,
      collectibleRow.series || null,
      collectibleRow.franchise || null,
      collectibleRow.medium || null,
      collectibleRow.vendor || null,
      collectibleRow.booth || null,
      collectibleRow.price ?? null,
      collectibleRow.exclusive === true,
      typeof collectibleRow.signed === 'boolean' ? collectibleRow.signed : null,
      collectibleRow.image_path || null,
      collectibleRow.notes || null,
      collectibleRow.archived_at || null
    ]
  );
  return result.rows[0] || null;
};

const archiveNativeArtFromCollectible = async (collectibleId) => {
  await pool.query(
    `UPDATE art_items
     SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
         updated_at = CURRENT_TIMESTAMP
     WHERE source_collectible_id = $1`,
    [collectibleId]
  );
};

const validateScopedEvent = async (scopeContext, eventId) => {
  if (!eventId) return null;
  const eventParams = [Number(eventId)];
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
};

const buildPublicNativeArtId = (row) => Number(row.source_collectible_id || row.id);

const loadNativeArtByRouteId = async (scopeContext, routeId) => {
  const params = [routeId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    libraryColumn: 'a.library_id',
    spaceColumn: 'a.space_id'
  });
  const result = await pool.query(
    `${buildNativeArtSelect()}
     WHERE (a.source_collectible_id = $1 OR (a.source_collectible_id IS NULL AND a.id = $1))
       AND a.archived_at IS NULL
       ${scopeClause}
     LIMIT 1`,
    params
  );
  return result.rows[0] || null;
};

const loadNativeArtById = async (scopeContext, nativeArtId) => {
  const params = [nativeArtId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    libraryColumn: 'a.library_id',
    spaceColumn: 'a.space_id'
  });
  const result = await pool.query(
    `${buildNativeArtSelect()}
     WHERE a.id = $1
       AND a.archived_at IS NULL
       ${scopeClause}
     LIMIT 1`,
    params
  );
  return result.rows[0] || null;
};

const attachSignaturesToArtRows = async (rows = []) => {
  const artRows = Array.isArray(rows) ? rows : [];
  const ids = artRows.map((row) => Number(row.id || 0)).filter(Boolean);
  const signaturesByOwner = await loadSignatureRecords(pool, { ownerType: 'art', ownerIds: ids });
  return artRows.map((row) => ({
    ...row,
    signatures: signaturesByOwner.get(Number(row.id || 0)) || []
  }));
};

const attachSignaturesToArtRow = async (row) => {
  if (!row?.id) return row;
  const signatures = await loadSignatureRecordsForOwner(pool, { ownerType: 'art', ownerId: row.id });
  return { ...row, signatures };
};

const buildArtSignaturePayload = (payload = {}) => ({
  signer_name: payload.signer_name,
  signer_role: payload.signer_role,
  signed_on: payload.signed_on,
  signed_at: payload.signed_at,
  signed_event_id: payload.signed_event_id,
  proof_path: payload.signature_proof_path || payload.proof_path,
  notes: payload.signature_notes
});

const syncArtPrimarySignature = async ({ artRow, payload = {}, userId = null }) => {
  if (!artRow?.id) return null;
  return syncPrimarySignatureRecord(pool, {
    ownerType: 'art',
    ownerId: artRow.id,
    libraryId: artRow.library_id || null,
    spaceId: artRow.space_id || null,
    createdBy: userId,
    signature: buildArtSignaturePayload(payload),
    signed: payload.signed === true
  });
};

const syncNativeArtEventLink = async ({ artRow, eventId, userId }) => {
  if (!artRow?.id) return null;
  await pool.query(
    `UPDATE event_purchased_items
     SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
         updated_at = CURRENT_TIMESTAMP
     WHERE item_type = 'art'
       AND item_id = $1
       AND archived_at IS NULL
       AND ($2::integer IS NULL OR event_id <> $2)`,
    [artRow.id, eventId || null]
  );
  if (!eventId) return null;
  const linked = await pool.query(
    `INSERT INTO event_purchased_items (
       event_id,
       item_type,
       item_id,
       title_snapshot,
       vendor_snapshot,
       booth_snapshot,
       price_snapshot,
       created_by
     ) VALUES ($1,'art',$2,$3,$4,$5,$6,$7)
     ON CONFLICT (event_id, item_type, item_id) WHERE archived_at IS NULL
     DO UPDATE SET title_snapshot = EXCLUDED.title_snapshot,
                   vendor_snapshot = EXCLUDED.vendor_snapshot,
                   booth_snapshot = EXCLUDED.booth_snapshot,
                   price_snapshot = EXCLUDED.price_snapshot,
                   updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      eventId,
      artRow.id,
      artRow.title,
      artRow.vendor || null,
      artRow.booth || null,
      artRow.price ?? null,
      userId || null
    ]
  );
  return linked.rows[0] || null;
};

const normalizeArtPayload = (payload = {}) => {
  const vendor = payload.vendor ?? payload.booth_or_vendor ?? null;
  const booth = payload.booth ?? null;
  return {
    title: payload.title,
    series: payload.series || null,
    franchise: payload.franchise || null,
    medium: payload.medium || null,
    event_id: payload.event_id || null,
    vendor,
    booth,
    artist: payload.artist || null,
    price: payload.price ?? null,
    exclusive: payload.exclusive === true,
    signed: payload.signed === true,
    signer_name: payload.signer_name || null,
    signer_role: payload.signer_role || null,
    signed_on: payload.signed_on || null,
    signed_at: payload.signed_at || null,
    signed_event_id: payload.signed_event_id || null,
    signature_proof_path: payload.signature_proof_path || null,
    signature_notes: payload.signature_notes || null,
    image_path: payload.image_path || null,
    notes: payload.notes || null
  };
};

const normalizeCollectiblePayload = (payload = {}) => {
  const subtype = payload.subtype || payload.item_type || 'collectible';
  const categoryKey = resolveCategoryKey(payload.category_key || payload.category);
  const categoryLabel = resolveCategoryLabel(categoryKey);
  const vendor = payload.vendor ?? payload.booth_or_vendor ?? null;
  const booth = payload.booth ?? null;
  return {
    subtype: COLLECTIBLE_SUBTYPES.includes(subtype) ? subtype : 'collectible',
    category_key: categoryKey || null,
    category: categoryLabel || null,
    series: payload.series || null,
    franchise: payload.franchise || null,
    vendor,
    booth,
    booth_or_vendor: vendor || booth || payload.booth_or_vendor || null
  };
};

router.get('/collectibles/categories', asyncHandler(async (_req, res) => {
  const rows = await pool.query(
    `SELECT key, label, sort_order
     FROM collectible_categories
     WHERE key = ANY($1)
     ORDER BY sort_order ASC, label ASC`
    ,
    [ACTIVE_COLLECTIBLE_CATEGORY_KEYS]
  );
  res.json({
    categories: rows.rows.map((row) => ({
      key: row.key,
      label: row.label
    }))
  });
}));

router.get('/art/categories', asyncHandler(async (_req, res) => {
  res.status(404).json({ error: 'Art categories are not available' });
}));

router.get(COLLECTIBLE_ROUTE_PATHS, asyncHandler(async (req, res) => {
  const routeConfig = resolveRouteConfig(req);
  const scopeContext = resolveScopeContext(req);
  const { page, limit, offset } = parsePaging(req);
  const q = String(req.query?.q || '').trim();
  const subtype = routeConfig.forcedSubtype || String(req.query?.subtype || req.query?.item_type || '').trim();
  const category = String(req.query?.category_key || req.query?.category || '').trim();
  const vendor = String(req.query?.vendor || '').trim();
  const booth = String(req.query?.booth || '').trim();
  const series = String(req.query?.series || '').trim();
  const franchise = String(req.query?.franchise || '').trim();
  const eventIdRaw = Number(req.query?.event_id);
  const exclusiveRaw = String(req.query?.exclusive || '').trim().toLowerCase();
  const sortDir = String(req.query?.sort_dir || '').trim().toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  if (!routeConfig.isArtRoute && subtype === ART_SUBTYPE) {
    return res.status(400).json({ error: 'Use the Art library for art records' });
  }

  if (routeConfig.isArtRoute) {
    const params = [];
    let where = 'WHERE a.archived_at IS NULL';

    if (q) {
      params.push(`%${q}%`);
      where += ` AND (
        a.title ILIKE $${params.length}
        OR COALESCE(a.series, '') ILIKE $${params.length}
        OR COALESCE(a.franchise, '') ILIKE $${params.length}
        OR COALESCE(a.artist, '') ILIKE $${params.length}
        OR COALESCE(a.notes, '') ILIKE $${params.length}
      )`;
    }
    if (vendor) {
      params.push(`%${vendor}%`);
      where += ` AND COALESCE(a.vendor, '') ILIKE $${params.length}`;
    }
    if (booth) {
      params.push(`%${booth}%`);
      where += ` AND COALESCE(a.booth, '') ILIKE $${params.length}`;
    }
    if (series) {
      params.push(`%${series}%`);
      where += ` AND COALESCE(a.series, '') ILIKE $${params.length}`;
    }
    if (franchise) {
      params.push(`%${franchise}%`);
      where += ` AND COALESCE(a.franchise, '') ILIKE $${params.length}`;
    }
    if (Number.isFinite(eventIdRaw) && eventIdRaw > 0) {
      params.push(eventIdRaw);
      where += ` AND COALESCE(epi.event_id, c.event_id) = $${params.length}`;
    }
    if (exclusiveRaw === 'true' || exclusiveRaw === 'false') {
      params.push(exclusiveRaw === 'true');
      where += ` AND a.exclusive = $${params.length}`;
    }

    const scopeClause = appendScopeSql(params, scopeContext, {
      libraryColumn: 'a.library_id',
      spaceColumn: 'a.space_id'
    });
    where += scopeClause;

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM (${buildNativeArtSelect()}) native_art
       ${where.replaceAll('a.', 'native_art.').replaceAll('c.', 'native_art.').replaceAll('epi.', 'native_art.')}`,
      params
    );
    params.push(limit);
    params.push(offset);
    const rows = await pool.query(
      `${buildNativeArtSelect()}
       ${where}
       ORDER BY LOWER(a.title) ${sortDir} NULLS LAST, a.id ${sortDir}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = Number(countResult.rows[0]?.total || 0);
    const artRows = await attachSignaturesToArtRows(rows.rows);
    return res.json({
      items: artRows.map(serializeNativeArtRow),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: page < Math.max(1, Math.ceil(total / limit))
      }
    });
  }

  const params = [];
  let where = `WHERE c.archived_at IS NULL
    AND COALESCE(c.subtype, c.item_type, 'collectible') <> '${ART_SUBTYPE}'`;

  if (q) {
    params.push(`%${q}%`);
    where += ` AND (
      c.title ILIKE $${params.length}
      OR COALESCE(c.series, '') ILIKE $${params.length}
      OR COALESCE(c.franchise, '') ILIKE $${params.length}
      OR COALESCE(c.artist, '') ILIKE $${params.length}
      OR COALESCE(c.notes, '') ILIKE $${params.length}
    )`;
  }
  if (subtype && COLLECTIBLE_SUBTYPES.includes(subtype)) {
    where = appendSubtypeScope(where, params, subtype);
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
    where += ` AND (COALESCE(c.vendor, '') ILIKE $${params.length} OR COALESCE(c.booth_or_vendor, '') ILIKE $${params.length})`;
  }
  if (booth) {
    params.push(`%${booth}%`);
    where += ` AND (COALESCE(c.booth, '') ILIKE $${params.length} OR COALESCE(c.booth_or_vendor, '') ILIKE $${params.length})`;
  }
  if (series) {
    params.push(`%${series}%`);
    where += ` AND COALESCE(c.series, '') ILIKE $${params.length}`;
  }
  if (franchise) {
    params.push(`%${franchise}%`);
    where += ` AND COALESCE(c.franchise, '') ILIKE $${params.length}`;
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
    libraryColumn: 'c.library_id',
    spaceColumn: 'c.space_id'
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
    `SELECT c.*,
            a.id AS native_art_id
     FROM collectibles c
     LEFT JOIN art_items a
       ON a.source_collectible_id = c.id
      AND a.archived_at IS NULL
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

router.get(COLLECTIBLE_DETAIL_PATHS, asyncHandler(async (req, res) => {
  const routeConfig = resolveRouteConfig(req);
  const scopeContext = resolveScopeContext(req);
  const collectibleId = Number(req.params.id);
  if (!Number.isFinite(collectibleId) || collectibleId <= 0) {
    return res.status(400).json({ error: 'Invalid collectible id' });
  }

  if (routeConfig.isArtRoute) {
    const row = await loadNativeArtByRouteId(scopeContext, collectibleId);
    if (!row) return res.status(404).json({ error: 'Art item not found' });
    return res.json(serializeNativeArtRow(await attachSignaturesToArtRow(row)));
  }

  const params = [collectibleId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    libraryColumn: 'c.library_id',
    spaceColumn: 'c.space_id'
  });
  const subtypeClause = routeConfig.forcedSubtype
    ? `AND c.subtype = $${params.push(routeConfig.forcedSubtype)}`
    : `AND COALESCE(c.subtype, c.item_type, 'collectible') <> '${ART_SUBTYPE}'`;
  const result = await pool.query(
    `SELECT c.*,
            a.id AS native_art_id
     FROM collectibles c
     LEFT JOIN art_items a
       ON a.source_collectible_id = c.id
      AND a.archived_at IS NULL
     WHERE c.id = $1
       AND c.archived_at IS NULL
       ${subtypeClause}
       ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!result.rows[0]) return res.status(404).json({ error: `${routeConfig.entityLabel === 'art' ? 'Art item' : 'Collectible'} not found` });
  res.json(serializeCollectibleRow(result.rows[0]));
}));

const createArt = asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const libraryId = req.body.library_id || scopeContext.libraryId || null;
  const spaceId = req.body.space_id || scopeContext.spaceId || null;
  if (!libraryId) return res.status(400).json({ error: 'No active library selected for art creation' });

  const payload = normalizeArtPayload(req.body);
  if (payload.event_id) {
    const eventRow = await validateScopedEvent(scopeContext, payload.event_id);
    if (!eventRow) return res.status(404).json({ error: 'Linked event not found in scope' });
  }

  const created = await pool.query(
    `INSERT INTO art_items (
       library_id,
       space_id,
       created_by,
       title,
       artist,
       series,
       franchise,
       medium,
       vendor,
       booth,
       price,
       exclusive,
       signed,
       image_path,
       notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      libraryId,
      spaceId,
      req.user.id,
      payload.title,
      payload.artist,
      payload.series,
      payload.franchise,
      payload.medium,
      payload.vendor,
      payload.booth,
      payload.price,
      payload.exclusive,
      payload.signed,
      payload.image_path,
      payload.notes
    ]
  );
  const artRow = created.rows[0];
  await syncArtPrimarySignature({ artRow, payload, userId: req.user.id });
  await syncNativeArtEventLink({ artRow, eventId: payload.event_id, userId: req.user.id });
  const hydrated = await attachSignaturesToArtRow(await loadNativeArtById(scopeContext, artRow.id));
  const publicId = buildPublicNativeArtId(hydrated || artRow);

  await logActivity(req, 'art.create', 'art', publicId, {
    title: artRow.title,
    native_art_id: artRow.id,
    event_id: payload.event_id || null,
    franchise: artRow.franchise || null,
    medium: artRow.medium || null,
    signed: artRow.signed === true
  });
  if (payload.event_id) {
    await logActivity(req, 'art.link_event', 'art', publicId, {
      event_id: payload.event_id,
      native_art_id: artRow.id
    });
  }

  res.status(201).json(serializeNativeArtRow(hydrated || artRow));
});

const createCollectible = asyncHandler(async (req, res) => {
  const routeConfig = resolveRouteConfig(req);
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
    series,
    franchise,
    vendor,
    booth,
    booth_or_vendor,
    artist,
    medium,
    price,
    exclusive,
    signed,
    image_path,
    notes
  } = req.body;
  const normalizedPayload = normalizeCollectiblePayload({
    subtype,
    item_type,
    category_key,
    category,
    series,
    franchise,
    vendor,
    booth,
    booth_or_vendor
  });
  if (routeConfig.forcedSubtype) {
    normalizedPayload.subtype = routeConfig.forcedSubtype;
  } else if (normalizedPayload.subtype === ART_SUBTYPE) {
    return res.status(400).json({ error: 'Use the Art library for art records' });
  }
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
       library_id, space_id, created_by, title, series, franchise, subtype, item_type, category_key, category, event_id, vendor, booth, booth_or_vendor, artist, price, exclusive, image_path, notes
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
     )
     RETURNING *`,
    [
      libraryId,
      spaceId,
      req.user.id,
      title,
      normalizedPayload.series,
      normalizedPayload.franchise,
      normalizedPayload.subtype,
      normalizedPayload.subtype,
      normalizedPayload.category_key,
      normalizedPayload.category,
      event_id || null,
      normalizedPayload.vendor,
      normalizedPayload.booth,
      normalizedPayload.booth_or_vendor,
      artist || null,
      price ?? null,
      exclusive === true,
      image_path || null,
      notes || null
    ]
  );
  const row = created.rows[0];
  const nativeArt = row.subtype === ART_SUBTYPE ? await upsertNativeArtFromCollectible({
    ...row,
    medium: medium || null,
    signed: signed === true
  }) : null;
  await logActivity(req, 'collectibles.create', 'collectible', row.id, {
    title: row.title,
    subtype: row.subtype,
    category_key: row.category_key,
    event_id: row.event_id,
    series: row.series,
    franchise: row.franchise,
    vendor: row.vendor,
    booth: row.booth,
    native_art_id: nativeArt?.id || null
  });
  if (row.event_id) {
    await logActivity(req, 'collectibles.link_event', 'collectible', row.id, {
      event_id: row.event_id
    });
  }
  res.status(201).json(serializeCollectibleRow({
    ...row,
    native_art_id: nativeArt?.id || null
  }));
});

router.post('/collectibles', validate(collectibleCreateSchema), createCollectible);
router.post('/art', validate(artCreateSchema), createArt);

const updateArt = asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const artRouteId = Number(req.params.id);
  if (!Number.isFinite(artRouteId) || artRouteId <= 0) {
    return res.status(400).json({ error: 'Invalid art id' });
  }

  let current = await loadNativeArtByRouteId(scopeContext, artRouteId);
  if (!current) return res.status(404).json({ error: 'Art item not found' });
  current = await attachSignaturesToArtRow(current);
  const currentPrimarySignature = current.signatures?.find((signature) => signature.is_primary) || current.signatures?.[0] || null;
  current = {
    ...current,
    signer_name: currentPrimarySignature?.signer_name || null,
    signer_role: currentPrimarySignature?.signer_role || null,
    signed_on: currentPrimarySignature?.signed_on || null,
    signed_at: currentPrimarySignature?.signed_at || null,
    signed_event_id: currentPrimarySignature?.signed_event_id || null,
    signature_proof_path: currentPrimarySignature?.proof_path || null,
    signature_notes: currentPrimarySignature?.notes || null
  };

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'event_id') && req.body.event_id) {
    const eventRow = await validateScopedEvent(scopeContext, req.body.event_id);
    if (!eventRow) return res.status(404).json({ error: 'Linked event not found in scope' });
  }

  const allowed = ['title', 'series', 'franchise', 'medium', 'vendor', 'booth', 'booth_or_vendor', 'artist', 'price', 'exclusive', 'signed', 'image_path', 'notes'];
  const payload = normalizeArtPayload({
    ...current,
    ...req.body
  });
  const updates = [];
  const params = [current.id];
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, key)) continue;
    if (key === 'booth_or_vendor') continue;
    let value = payload[key];
    if (key === 'vendor' || key === 'booth') value = payload[key] || null;
    params.push(value === '' ? null : value);
    updates.push({ key, ref: `$${params.length}` });
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'booth_or_vendor')
    && !Object.prototype.hasOwnProperty.call(req.body || {}, 'vendor')) {
    params.push(payload.vendor || null);
    updates.push({ key: 'vendor', ref: `$${params.length}` });
  }
  if (updates.length > 0) {
    const setClause = updates.map((entry) => `${entry.key} = ${entry.ref}`).join(', ');
    await pool.query(
      `UPDATE art_items
       SET ${setClause},
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      params
    );
  }

  const signatureKeys = ['signed', 'signer_name', 'signer_role', 'signed_on', 'signed_at', 'signed_event_id', 'signature_proof_path', 'signature_notes'];
  const touchesSignature = signatureKeys.some((key) => Object.prototype.hasOwnProperty.call(req.body || {}, key));
  if (touchesSignature) {
    await syncArtPrimarySignature({
      artRow: { ...current, ...payload, id: current.id },
      payload: {
        ...current,
        ...payload,
        signed: Object.prototype.hasOwnProperty.call(req.body || {}, 'signed') ? payload.signed : current.signed === true
      },
      userId: req.user.id
    });
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'event_id')) {
    await syncNativeArtEventLink({
      artRow: { ...current, ...payload, id: current.id },
      eventId: req.body.event_id || null,
      userId: req.user.id
    });
  }

  const hydrated = await attachSignaturesToArtRow(await loadNativeArtById(scopeContext, current.id));
  if (current.source_collectible_id && hydrated) {
    await pool.query(
      `UPDATE collectibles
       SET title = $2,
           series = $3,
           franchise = $4,
           vendor = $5,
           booth = $6,
           booth_or_vendor = $7,
           artist = $8,
           price = $9,
           exclusive = $10,
           event_id = $11,
           image_path = $12,
           notes = $13,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        current.source_collectible_id,
        hydrated.title,
        hydrated.series || null,
        hydrated.franchise || null,
        hydrated.vendor || null,
        hydrated.booth || null,
        hydrated.vendor && hydrated.booth ? `${hydrated.vendor} / ${hydrated.booth}` : (hydrated.vendor || hydrated.booth || null),
        hydrated.artist || null,
        hydrated.price ?? null,
        hydrated.exclusive === true,
        hydrated.event_id || null,
        hydrated.image_path || null,
        hydrated.notes || null
      ]
    );
  }
  const publicId = buildPublicNativeArtId(hydrated || current);
  await logActivity(req, 'art.update', 'art', publicId, {
    fields: [
      ...updates.map((entry) => entry.key),
      ...(touchesSignature ? ['signature'] : []),
      ...(Object.prototype.hasOwnProperty.call(req.body || {}, 'event_id') ? ['event_id'] : [])
    ],
    native_art_id: current.id
  });
  res.json(serializeNativeArtRow(hydrated || current));
});

const updateCollectible = asyncHandler(async (req, res) => {
  const routeConfig = resolveRouteConfig(req);
  const scopeContext = resolveScopeContext(req);
  const collectibleId = Number(req.params.id);
  if (!Number.isFinite(collectibleId) || collectibleId <= 0) {
    return res.status(400).json({ error: 'Invalid collectible id' });
  }

  const allowed = ['title', 'series', 'franchise', 'subtype', 'item_type', 'category_key', 'category', 'event_id', 'vendor', 'booth', 'booth_or_vendor', 'artist', 'medium', 'price', 'exclusive', 'signed', 'image_path', 'notes'];
  const fields = Object.entries(req.body || {}).filter(([key]) => allowed.includes(key));
  if (fields.length === 0) return res.status(400).json({ error: 'No valid collectible fields provided' });

  const currentParams = [collectibleId];
  const currentScopeClause = appendScopeSql(currentParams, scopeContext, {
    libraryColumn: 'library_id',
    spaceColumn: 'space_id'
  });
  const currentSubtypeClause = routeConfig.forcedSubtype
    ? `AND subtype = $${currentParams.push(routeConfig.forcedSubtype)}`
    : `AND COALESCE(subtype, item_type, 'collectible') <> '${ART_SUBTYPE}'`;
  const current = await pool.query(
    `SELECT id, subtype, event_id
     FROM collectibles
     WHERE id = $1
       AND archived_at IS NULL
       ${currentSubtypeClause}
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
    category: req.body?.category,
    series: req.body?.series,
    franchise: req.body?.franchise,
    vendor: req.body?.vendor,
    booth: req.body?.booth,
    booth_or_vendor: req.body?.booth_or_vendor
  });
  if (routeConfig.forcedSubtype) {
    if (hadSubtypeKey && normalizedPayload.subtype !== routeConfig.forcedSubtype) {
      return res.status(400).json({ error: 'Art items stay in the Art library' });
    }
    normalizedPayload.subtype = routeConfig.forcedSubtype;
  } else if (hadSubtypeKey && normalizedPayload.subtype === ART_SUBTYPE) {
    return res.status(400).json({ error: 'Use the Art library for art records' });
  }
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
    if (['subtype', 'item_type', 'category_key', 'category', 'series', 'franchise', 'vendor', 'booth', 'booth_or_vendor', 'medium', 'signed'].includes(key)) continue;
    params.push(value === '' ? null : value);
    updates.push({ key, ref: `$${params.length}` });
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'series')) {
    params.push(normalizedPayload.series);
    updates.push({ key: 'series', ref: `$${params.length}` });
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'franchise')) {
    params.push(normalizedPayload.franchise);
    updates.push({ key: 'franchise', ref: `$${params.length}` });
  }
  if (
    Object.prototype.hasOwnProperty.call(req.body || {}, 'vendor')
    || Object.prototype.hasOwnProperty.call(req.body || {}, 'booth')
    || Object.prototype.hasOwnProperty.call(req.body || {}, 'booth_or_vendor')
  ) {
    params.push(normalizedPayload.vendor);
    updates.push({ key: 'vendor', ref: `$${params.length}` });
    params.push(normalizedPayload.booth);
    updates.push({ key: 'booth', ref: `$${params.length}` });
    params.push(normalizedPayload.booth_or_vendor);
    updates.push({ key: 'booth_or_vendor', ref: `$${params.length}` });
  }

  if (hadSubtypeKey || routeConfig.forcedSubtype) {
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
  if (updates.length === 0 && routeConfig.isArtRoute) {
    updates.push({ key: 'updated_at', ref: 'CURRENT_TIMESTAMP' });
  }
  const setClause = updates.map((entry) => `${entry.key} = ${entry.ref}`).join(', ');
  const whereScope = appendScopeSql(params, scopeContext, {
    libraryColumn: 'library_id',
    spaceColumn: 'space_id'
  });
  const updateSubtypeClause = routeConfig.forcedSubtype
    ? `AND subtype = $${params.push(routeConfig.forcedSubtype)}`
    : `AND COALESCE(subtype, item_type, 'collectible') <> '${ART_SUBTYPE}'`;
  const updated = await pool.query(
    `UPDATE collectibles
     SET ${setClause}
     WHERE id = $1
       AND archived_at IS NULL
       ${updateSubtypeClause}
       ${whereScope}
     RETURNING *`,
    params
  );
  if (!updated.rows[0]) return res.status(404).json({ error: 'Collectible not found' });
  const updatedRow = updated.rows[0];
  const nativeArt = updatedRow.subtype === ART_SUBTYPE
    ? await upsertNativeArtFromCollectible({
        ...updatedRow,
        medium: Object.prototype.hasOwnProperty.call(req.body || {}, 'medium') ? (req.body.medium || null) : undefined,
        signed: Object.prototype.hasOwnProperty.call(req.body || {}, 'signed') ? req.body.signed === true : undefined
      })
    : (current.rows[0].subtype === ART_SUBTYPE ? (await archiveNativeArtFromCollectible(collectibleId), null) : null);
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
    fields: updates.map((entry) => entry.key),
    native_art_id: nativeArt?.id || null
  });
  res.json(serializeCollectibleRow({
    ...updatedRow,
    native_art_id: nativeArt?.id || null
  }));
});

router.patch('/collectibles/:id', validate(collectibleUpdateSchema), updateCollectible);
router.patch('/art/:id', validate(artUpdateSchema), updateArt);

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
  if (requestedSubtype === ART_SUBTYPE) {
    return res.status(400).json({ error: 'Use the Art library for art records' });
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
       AND COALESCE(subtype, item_type, 'collectible') <> '${ART_SUBTYPE}'
       ${scopeClause}
     RETURNING *`,
    [...params, requestedSubtype]
  );
  if (!updated.rows[0]) return res.status(404).json({ error: 'Collectible not found' });
  if (requestedSubtype === ART_SUBTYPE) {
    await upsertNativeArtFromCollectible(updated.rows[0]);
  } else {
    await archiveNativeArtFromCollectible(collectibleId);
  }
  await logActivity(req, 'collectibles.reclassify', 'collectible', collectibleId, {
    to: requestedSubtype
  });
  res.json(serializeCollectibleRow(updated.rows[0]));
}));

router.delete(COLLECTIBLE_DELETE_PATHS, asyncHandler(async (req, res) => {
  const routeConfig = resolveRouteConfig(req);
  const scopeContext = resolveScopeContext(req);
  const collectibleId = Number(req.params.id);
  if (!Number.isFinite(collectibleId) || collectibleId <= 0) {
    return res.status(400).json({ error: 'Invalid collectible id' });
  }

  if (routeConfig.isArtRoute) {
    const current = await loadNativeArtByRouteId(scopeContext, collectibleId);
    if (!current) return res.status(404).json({ error: 'Art item not found' });
    await pool.query(
      `UPDATE art_items
       SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [current.id]
    );
    await pool.query(
      `UPDATE event_purchased_items
       SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE item_type = 'art'
         AND item_id = $1
         AND archived_at IS NULL`,
      [current.id]
    );
    if (current.source_collectible_id) {
      await pool.query(
        `UPDATE collectibles
         SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP)
         WHERE id = $1`,
        [current.source_collectible_id]
      );
    }
    const publicId = buildPublicNativeArtId(current);
    await logActivity(req, 'art.delete', 'art', publicId, {
      title: current.title,
      native_art_id: current.id
    });
    return res.json({ ok: true, id: publicId });
  }

  const params = [collectibleId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    libraryColumn: 'library_id',
    spaceColumn: 'space_id'
  });
  const subtypeClause = routeConfig.forcedSubtype
    ? `AND subtype = $${params.push(routeConfig.forcedSubtype)}`
    : `AND COALESCE(subtype, item_type, 'collectible') <> '${ART_SUBTYPE}'`;
  const deleted = await pool.query(
    `UPDATE collectibles
     SET archived_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND archived_at IS NULL
       ${subtypeClause}
       ${scopeClause}
     RETURNING id, title`,
    params
  );
  if (!deleted.rows[0]) return res.status(404).json({ error: `${routeConfig.entityLabel === 'art' ? 'Art item' : 'Collectible'} not found` });
  if (routeConfig.forcedSubtype === ART_SUBTYPE || routeConfig.entityLabel === 'art') {
    await archiveNativeArtFromCollectible(collectibleId);
  }
  await logActivity(req, 'collectibles.delete', 'collectible', collectibleId, {
    title: deleted.rows[0].title
  });
  res.json({ ok: true, id: collectibleId });
}));

router.post(COLLECTIBLE_UPLOAD_PATHS, memoryUpload.single('image'), asyncHandler(async (req, res) => {
  const routeConfig = resolveRouteConfig(req);
  const scopeContext = resolveScopeContext(req);
  const collectibleId = Number(req.params.id);
  if (!Number.isFinite(collectibleId) || collectibleId <= 0) {
    return res.status(400).json({ error: 'Invalid collectible id' });
  }
  if (!req.file) return res.status(400).json({ error: 'Image file is required' });
  if (!ALLOWED_IMAGE_MIME_TYPES.has(String(req.file.mimetype || '').toLowerCase())) {
    return res.status(400).json({ error: 'Unsupported image type' });
  }

  if (routeConfig.isArtRoute) {
    const current = await loadNativeArtByRouteId(scopeContext, collectibleId);
    if (!current) return res.status(404).json({ error: 'Art item not found' });
    const previousPath = current.image_path || null;
    const stored = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
    const updated = await pool.query(
      `UPDATE art_items
       SET image_path = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, image_path`,
      [stored.url, current.id]
    );
    if (current.source_collectible_id) {
      await pool.query(
        `UPDATE collectibles
         SET image_path = $1
         WHERE id = $2`,
        [stored.url, current.source_collectible_id]
      );
    }
    const publicId = buildPublicNativeArtId(current);
    await logActivity(req, previousPath ? 'art.image.replace' : 'art.image.upload', 'art', publicId, {
      previousPath,
      imagePath: updated.rows[0].image_path,
      provider: stored.provider,
      native_art_id: current.id
    });
    return res.json({ id: publicId, image_path: updated.rows[0].image_path });
  }

  const params = [collectibleId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    libraryColumn: 'library_id',
    spaceColumn: 'space_id'
  });
  const subtypeClause = routeConfig.forcedSubtype
    ? `AND subtype = $${params.push(routeConfig.forcedSubtype)}`
    : `AND COALESCE(subtype, item_type, 'collectible') <> '${ART_SUBTYPE}'`;
  const existing = await pool.query(
    `SELECT id, image_path
     FROM collectibles
     WHERE id = $1
       AND archived_at IS NULL
       ${subtypeClause}
       ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!existing.rows[0]) return res.status(404).json({ error: `${routeConfig.entityLabel === 'art' ? 'Art item' : 'Collectible'} not found` });

  const previousPath = existing.rows[0].image_path || null;
  const stored = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
  const updated = await pool.query(
    `UPDATE collectibles
     SET image_path = $1
     WHERE id = $2
     RETURNING id, image_path`,
    [stored.url, collectibleId]
  );
  if (routeConfig.forcedSubtype === ART_SUBTYPE || String(req.path || '').startsWith('/art')) {
    await pool.query(
      `UPDATE art_items
       SET image_path = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE source_collectible_id = $2`,
      [stored.url, collectibleId]
    );
  }

  await logActivity(req, previousPath ? 'collectibles.image.replace' : 'collectibles.image.upload', 'collectible', collectibleId, {
    previousPath,
    imagePath: updated.rows[0].image_path,
    provider: stored.provider
  });

  res.json(updated.rows[0]);
}));

router.delete(COLLECTIBLE_IMAGE_DELETE_PATHS, asyncHandler(async (req, res) => {
  const routeConfig = resolveRouteConfig(req);
  const scopeContext = resolveScopeContext(req);
  const collectibleId = Number(req.params.id);
  if (!Number.isFinite(collectibleId) || collectibleId <= 0) {
    return res.status(400).json({ error: 'Invalid collectible id' });
  }

  if (routeConfig.isArtRoute) {
    const current = await loadNativeArtByRouteId(scopeContext, collectibleId);
    if (!current) return res.status(404).json({ error: 'Art item not found' });
    if (!current.image_path) return res.status(400).json({ error: 'No image attached' });
    await pool.query(
      `UPDATE art_items
       SET image_path = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [current.id]
    );
    if (current.source_collectible_id) {
      await pool.query(`UPDATE collectibles SET image_path = NULL WHERE id = $1`, [current.source_collectible_id]);
    }
    const publicId = buildPublicNativeArtId(current);
    await logActivity(req, 'art.image.delete', 'art', publicId, {
      previousPath: current.image_path,
      native_art_id: current.id
    });
    return res.json({ ok: true, id: publicId });
  }

  const params = [collectibleId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    libraryColumn: 'library_id',
    spaceColumn: 'space_id'
  });
  const subtypeClause = routeConfig.forcedSubtype
    ? `AND subtype = $${params.push(routeConfig.forcedSubtype)}`
    : `AND COALESCE(subtype, item_type, 'collectible') <> '${ART_SUBTYPE}'`;
  const existing = await pool.query(
    `SELECT id, image_path
     FROM collectibles
     WHERE id = $1
       AND archived_at IS NULL
       ${subtypeClause}
       ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!existing.rows[0]) return res.status(404).json({ error: `${routeConfig.entityLabel === 'art' ? 'Art item' : 'Collectible'} not found` });
  if (!existing.rows[0].image_path) return res.status(400).json({ error: 'No image attached' });

  await pool.query(`UPDATE collectibles SET image_path = NULL WHERE id = $1`, [collectibleId]);
  if (routeConfig.forcedSubtype === ART_SUBTYPE || String(req.path || '').startsWith('/art')) {
    await pool.query(
      `UPDATE art_items
       SET image_path = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE source_collectible_id = $1`,
      [collectibleId]
    );
  }
  await logActivity(req, 'collectibles.image.delete', 'collectible', collectibleId, {
    previousPath: existing.rows[0].image_path
  });
  res.json({ ok: true, id: collectibleId });
}));

module.exports = router;
