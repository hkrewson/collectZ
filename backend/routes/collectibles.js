const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const {
  validate,
  collectibleCreateSchema,
  collectibleUpdateSchema,
  artCreateSchema,
  artUpdateSchema,
  signatureRecordCreateSchema,
  signatureRecordUpdateSchema
} = require('../middleware/validate');
const { resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const { logActivity } = require('../services/audit');
const { uploadBuffer } = require('../services/storage');
const {
  loadSignatureRecords,
  loadSignatureRecordsForOwner,
  createSignatureRecord,
  updateSignatureRecord,
  updateSignatureProofPath,
  addSignatureProof,
  updateSignatureProofMetadata,
  archiveSignatureProof,
  archiveSignatureRecord,
  setPrimarySignatureRecord,
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
    height: row.height === null || row.height === undefined ? null : Number(row.height),
    width: row.width === null || row.width === undefined ? null : Number(row.width),
    dimension_unit: row.dimension_unit || null,
    framed: row.framed === true,
    print_number: row.print_number === null || row.print_number === undefined ? null : Number(row.print_number),
    print_run: row.print_run === null || row.print_run === undefined ? null : Number(row.print_run),
    artist_id: row.artist_id || null,
    artist_role: row.artist_role || null,
    artist: row.artist || null,
    artist_record: row.artist_id ? {
      id: row.artist_id,
      name: row.artist_record_name || row.artist || null,
      sort_name: row.artist_record_sort_name || null,
      aliases: Array.isArray(row.artist_record_aliases) ? row.artist_record_aliases : [],
      website_url: row.artist_record_website_url || null,
      notes: row.artist_record_notes || null
    } : null,
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
         epi.id AS purchased_item_id,
         ar.name AS artist_record_name,
         ar.sort_name AS artist_record_sort_name,
         ar.aliases AS artist_record_aliases,
         ar.website_url AS artist_record_website_url,
         ar.notes AS artist_record_notes
  FROM art_items a
  LEFT JOIN collectibles c
    ON c.id = a.source_collectible_id
   AND c.archived_at IS NULL
  LEFT JOIN art_artist_records ar
    ON ar.id = a.artist_id
   AND ar.archived_at IS NULL
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

const normalizeArtistName = (value) => String(value || '').trim().replace(/\s+/g, ' ');
const normalizeArtistKey = (value) => normalizeArtistName(value).toLowerCase();
const normalizeArtistAliases = (value) => {
  if (Array.isArray(value)) {
    return value.map(normalizeArtistName).filter(Boolean).slice(0, 12);
  }
  return String(value || '')
    .split(',')
    .map(normalizeArtistName)
    .filter(Boolean)
    .slice(0, 12);
};

const serializeArtistRecord = (row) => ({
  id: row.id,
  library_id: row.library_id || null,
  space_id: row.space_id || null,
  name: row.name,
  sort_name: row.sort_name || null,
  aliases: Array.isArray(row.aliases) ? row.aliases : [],
  website_url: row.website_url || null,
  notes: row.notes || null,
  linked_works_count: Number(row.linked_works_count || 0),
  created_at: row.created_at,
  updated_at: row.updated_at
});

const validateScopedArtistRecord = async (scopeContext, artistId) => {
  const numericArtistId = Number(artistId);
  if (!Number.isFinite(numericArtistId) || numericArtistId <= 0) return null;
  const params = [numericArtistId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    libraryColumn: 'ar.library_id',
    spaceColumn: 'ar.space_id'
  });
  const result = await pool.query(
    `SELECT ar.*,
            COUNT(a.id)::int AS linked_works_count
     FROM art_artist_records ar
     LEFT JOIN art_items a
       ON a.artist_id = ar.id
      AND a.archived_at IS NULL
     WHERE ar.id = $1
       AND ar.archived_at IS NULL
       ${scopeClause}
     GROUP BY ar.id
     LIMIT 1`,
    params
  );
  return result.rows[0] || null;
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

const buildArtSignaturePayloadFromRecord = (signature = {}, overrides = {}) => {
  const row = signature || {};
  return {
    signer_name: row.signer_name || null,
    signer_role: row.signer_role || null,
    signed_on: row.signed_on || null,
    signed_at: row.signed_at || null,
    signed_event_id: row.signed_event_id || null,
    proof_path: row.proof_path || null,
    notes: row.notes || null,
    ...overrides
  };
};

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

const refreshArtSignatureState = async (scopeContext, artRow) => {
  if (!artRow?.id) return null;
  const signatures = await loadSignatureRecordsForOwner(pool, { ownerType: 'art', ownerId: artRow.id });
  await pool.query(
    `UPDATE art_items
     SET signed = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [artRow.id, signatures.length > 0]
  );
  const refreshed = await loadNativeArtById(scopeContext, artRow.id);
  return attachSignaturesToArtRow(refreshed || artRow);
};

const serializeSignatureMutationResponse = async (scopeContext, artRow) => {
  const hydrated = await refreshArtSignatureState(scopeContext, artRow);
  return {
    art: serializeNativeArtRow(hydrated || artRow),
    signatures: hydrated?.signatures || []
  };
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
    height: payload.height ?? null,
    width: payload.width ?? null,
    dimension_unit: payload.dimension_unit || null,
    framed: payload.framed === true,
    print_number: payload.print_number ?? null,
    print_run: payload.print_run ?? null,
    event_id: payload.event_id || null,
    vendor,
    booth,
    artist_id: payload.artist_id || null,
    artist_role: payload.artist_role || null,
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

router.get('/art/artists', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const q = normalizeArtistName(req.query?.q || '');
  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(25, limitRaw)) : 10;
  const params = [];
  let where = 'WHERE ar.archived_at IS NULL';
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (
      ar.name ILIKE $${params.length}
      OR COALESCE(ar.sort_name, '') ILIKE $${params.length}
      OR EXISTS (
        SELECT 1
        FROM unnest(ar.aliases) alias_name
        WHERE alias_name ILIKE $${params.length}
      )
    )`;
  }
  where += appendScopeSql(params, scopeContext, {
    libraryColumn: 'ar.library_id',
    spaceColumn: 'ar.space_id'
  });
  params.push(limit);
  const rows = await pool.query(
    `SELECT ar.*,
            COUNT(a.id)::int AS linked_works_count
     FROM art_artist_records ar
     LEFT JOIN art_items a
       ON a.artist_id = ar.id
      AND a.archived_at IS NULL
     ${where}
     GROUP BY ar.id
     ORDER BY LOWER(COALESCE(ar.sort_name, ar.name)) ASC, ar.id ASC
     LIMIT $${params.length}`,
    params
  );
  res.json({ artists: rows.rows.map(serializeArtistRecord) });
}));

router.post('/art/artists', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const libraryId = req.body.library_id || scopeContext.libraryId || null;
  const spaceId = req.body.space_id || scopeContext.spaceId || null;
  if (!libraryId) return res.status(400).json({ error: 'No active library selected for artist creation' });
  const name = normalizeArtistName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Artist name is required' });
  if (name.length > 255) return res.status(400).json({ error: 'Artist name is too long' });
  const normalizedName = normalizeArtistKey(name);
  const aliases = normalizeArtistAliases(req.body?.aliases);
  const sortName = normalizeArtistName(req.body?.sort_name);
  const websiteUrl = normalizeArtistName(req.body?.website_url);
  const notes = String(req.body?.notes || '').trim();

  const result = await pool.query(
    `INSERT INTO art_artist_records (
       library_id,
       space_id,
       created_by,
       name,
       normalized_name,
       sort_name,
       aliases,
       website_url,
       notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (library_id, normalized_name) WHERE archived_at IS NULL
     DO UPDATE SET name = art_artist_records.name
     RETURNING *`,
    [
      libraryId,
      spaceId,
      req.user.id,
      name,
      normalizedName,
      sortName || null,
      aliases,
      websiteUrl || null,
      notes || null
    ]
  );
  const row = await validateScopedArtistRecord(scopeContext, result.rows[0]?.id);
  res.status(201).json({ artist: serializeArtistRecord(row || result.rows[0]) });
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
  let artistRecord = null;
  if (payload.artist_id) {
    artistRecord = await validateScopedArtistRecord(scopeContext, payload.artist_id);
    if (!artistRecord) return res.status(404).json({ error: 'Artist record not found in scope' });
    payload.artist = payload.artist || artistRecord.name;
  }

  const created = await pool.query(
    `INSERT INTO art_items (
       library_id,
       space_id,
       created_by,
       title,
       artist,
       artist_id,
       artist_role,
       series,
       franchise,
       medium,
       height,
       width,
       dimension_unit,
       framed,
       print_number,
       print_run,
       vendor,
       booth,
       price,
       exclusive,
       signed,
       image_path,
       notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     RETURNING *`,
    [
      libraryId,
      spaceId,
      req.user.id,
      payload.title,
      payload.artist,
      payload.artist_id,
      payload.artist_role,
      payload.series,
      payload.franchise,
      payload.medium,
      payload.height,
      payload.width,
      payload.dimension_unit,
      payload.framed,
      payload.print_number,
      payload.print_run,
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

  const allowed = ['title', 'series', 'franchise', 'medium', 'height', 'width', 'dimension_unit', 'framed', 'print_number', 'print_run', 'vendor', 'booth', 'booth_or_vendor', 'artist', 'artist_id', 'artist_role', 'price', 'exclusive', 'signed', 'image_path', 'notes'];
  const payload = normalizeArtPayload({
    ...current,
    ...req.body
  });
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'artist_id') && payload.artist_id) {
    const artistRecord = await validateScopedArtistRecord(scopeContext, payload.artist_id);
    if (!artistRecord) return res.status(404).json({ error: 'Artist record not found in scope' });
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'artist') || !payload.artist) {
      payload.artist = artistRecord.name;
    }
  }
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
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'artist_id')
    && !Object.prototype.hasOwnProperty.call(req.body || {}, 'artist')) {
    params.push(payload.artist || null);
    updates.push({ key: 'artist', ref: `$${params.length}` });
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

router.get('/art/:id/signatures', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const artRouteId = Number(req.params.id);
  if (!Number.isFinite(artRouteId) || artRouteId <= 0) {
    return res.status(400).json({ error: 'Invalid art id' });
  }
  const current = await attachSignaturesToArtRow(await loadNativeArtByRouteId(scopeContext, artRouteId));
  if (!current) return res.status(404).json({ error: 'Art item not found' });
  res.json({ art_id: buildPublicNativeArtId(current), native_art_id: current.id, signatures: current.signatures || [] });
}));

router.post('/art/:id/signatures', validate(signatureRecordCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const artRouteId = Number(req.params.id);
  if (!Number.isFinite(artRouteId) || artRouteId <= 0) {
    return res.status(400).json({ error: 'Invalid art id' });
  }
  const current = await loadNativeArtByRouteId(scopeContext, artRouteId);
  if (!current) return res.status(404).json({ error: 'Art item not found' });
  const signature = await createSignatureRecord(pool, {
    ownerType: 'art',
    ownerId: current.id,
    libraryId: current.library_id || null,
    spaceId: current.space_id || null,
    createdBy: req.user.id,
    signature: req.body,
    isPrimary: req.body.is_primary === true
  });
  if (!signature) return res.status(400).json({ error: 'At least one signature detail is required' });
  const response = await serializeSignatureMutationResponse(scopeContext, current);
  await logActivity(req, 'art.signature.create', 'art', buildPublicNativeArtId(current), {
    native_art_id: current.id,
    signatureRecordId: signature.id,
    isPrimary: signature.is_primary === true
  });
  res.status(201).json({ ...response, signature });
}));

router.patch('/art/:id/signatures/:signatureId', validate(signatureRecordUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const artRouteId = Number(req.params.id);
  const signatureId = Number(req.params.signatureId);
  if (!Number.isFinite(artRouteId) || artRouteId <= 0 || !Number.isFinite(signatureId) || signatureId <= 0) {
    return res.status(400).json({ error: 'Invalid art/signature id' });
  }
  const current = await loadNativeArtByRouteId(scopeContext, artRouteId);
  if (!current) return res.status(404).json({ error: 'Art item not found' });
  const signature = await updateSignatureRecord(pool, {
    ownerType: 'art',
    ownerId: current.id,
    signatureId,
    libraryId: current.library_id || null,
    spaceId: current.space_id || null,
    signature: req.body,
    isPrimary: req.body.is_primary === true
  });
  if (!signature) return res.status(404).json({ error: 'Signature record not found' });
  const response = await serializeSignatureMutationResponse(scopeContext, current);
  await logActivity(req, 'art.signature.update', 'art', buildPublicNativeArtId(current), {
    native_art_id: current.id,
    signatureRecordId: signature.id,
    isPrimary: signature.is_primary === true
  });
  res.json({ ...response, signature });
}));

router.post('/art/:id/signatures/:signatureId/proof', memoryUpload.single('proof'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const artRouteId = Number(req.params.id);
  const signatureId = Number(req.params.signatureId);
  if (!Number.isFinite(artRouteId) || artRouteId <= 0 || !Number.isFinite(signatureId) || signatureId <= 0) {
    return res.status(400).json({ error: 'Invalid art/signature id' });
  }
  if (!req.file) return res.status(400).json({ error: 'Proof image file is required' });
  if (!ALLOWED_IMAGE_MIME_TYPES.has(String(req.file.mimetype || '').toLowerCase())) {
    return res.status(400).json({ error: 'Unsupported image type' });
  }
  const current = await attachSignaturesToArtRow(await loadNativeArtByRouteId(scopeContext, artRouteId));
  if (!current) return res.status(404).json({ error: 'Art item not found' });
  const existingSignature = (current.signatures || []).find((signature) => Number(signature.id) === signatureId) || null;
  if (!existingSignature) return res.status(404).json({ error: 'Signature record not found' });
  const stored = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
  const proofMutation = await addSignatureProof(pool, {
    ownerType: 'art',
    ownerId: current.id,
    signatureId,
    proofPath: stored.url,
    proofType: req.body.proof_type,
    label: req.body.label,
    notes: req.body.notes,
    provider: stored.provider,
    originalFilename: req.file.originalname,
    mimeType: req.file.mimetype,
    createdBy: req.user.id
  });
  const signature = proofMutation?.signature || null;
  if (!signature) return res.status(404).json({ error: 'Signature record not found' });
  const response = await serializeSignatureMutationResponse(scopeContext, current);
  await logActivity(req, existingSignature.proof_path ? 'art.signature.proof.add' : 'art.signature.proof.upload', 'art', buildPublicNativeArtId(current), {
    native_art_id: current.id,
    signatureRecordId: signature.id,
    nextPath: stored.url,
    proofId: proofMutation?.proof?.id || null,
    provider: stored.provider
  });
  res.json({
    ...response,
    signature,
    proof: proofMutation?.proof || null,
    signature_proof_path: response.art?.signature_proof_path || null,
    proof_path: signature.proof_path || null,
    provider: stored.provider
  });
}));

router.patch('/art/:id/signatures/:signatureId/proofs/:proofId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const artRouteId = Number(req.params.id);
  const signatureId = Number(req.params.signatureId);
  const proofId = Number(req.params.proofId);
  if (!Number.isFinite(artRouteId) || artRouteId <= 0 || !Number.isFinite(signatureId) || signatureId <= 0 || !Number.isFinite(proofId) || proofId <= 0) {
    return res.status(400).json({ error: 'Invalid art/signature/proof id' });
  }
  const current = await attachSignaturesToArtRow(await loadNativeArtByRouteId(scopeContext, artRouteId));
  if (!current) return res.status(404).json({ error: 'Art item not found' });
  const existingSignature = (current.signatures || []).find((signature) => Number(signature.id) === signatureId) || null;
  if (!existingSignature) return res.status(404).json({ error: 'Signature record not found' });
  const proofMutation = await updateSignatureProofMetadata(pool, {
    ownerType: 'art',
    ownerId: current.id,
    signatureId,
    proofId,
    proofType: req.body.proof_type,
    label: req.body.label,
    notes: req.body.notes
  });
  if (!proofMutation?.signature) return res.status(404).json({ error: 'Signature proof not found' });
  const response = await serializeSignatureMutationResponse(scopeContext, current);
  await logActivity(req, 'art.signature.proof.metadata.update', 'art', buildPublicNativeArtId(current), {
    native_art_id: current.id,
    signatureRecordId: signatureId,
    proofId,
    proofType: proofMutation.proof?.proof_type || null
  });
  res.json({
    ...response,
    signature: proofMutation.signature,
    proof: proofMutation.proof,
    signature_proof_path: response.art?.signature_proof_path || null,
    proof_path: proofMutation.signature.proof_path || null
  });
}));

router.delete('/art/:id/signatures/:signatureId/proofs/:proofId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const artRouteId = Number(req.params.id);
  const signatureId = Number(req.params.signatureId);
  const proofId = Number(req.params.proofId);
  if (!Number.isFinite(artRouteId) || artRouteId <= 0 || !Number.isFinite(signatureId) || signatureId <= 0 || !Number.isFinite(proofId) || proofId <= 0) {
    return res.status(400).json({ error: 'Invalid art/signature/proof id' });
  }
  const current = await attachSignaturesToArtRow(await loadNativeArtByRouteId(scopeContext, artRouteId));
  if (!current) return res.status(404).json({ error: 'Art item not found' });
  const existingSignature = (current.signatures || []).find((signature) => Number(signature.id) === signatureId) || null;
  if (!existingSignature) return res.status(404).json({ error: 'Signature record not found' });
  const proofMutation = await archiveSignatureProof(pool, {
    ownerType: 'art',
    ownerId: current.id,
    signatureId,
    proofId
  });
  if (!proofMutation?.signature) return res.status(404).json({ error: 'Signature proof not found' });
  const response = await serializeSignatureMutationResponse(scopeContext, current);
  await logActivity(req, 'art.signature.proof.remove', 'art', buildPublicNativeArtId(current), {
    native_art_id: current.id,
    signatureRecordId: signatureId,
    proofId,
    previousPath: proofMutation.proof?.proof_path || null
  });
  res.json({
    ...response,
    signature: proofMutation.signature,
    proof: proofMutation.proof,
    removed: true,
    signature_proof_path: response.art?.signature_proof_path || null,
    proof_path: proofMutation.signature.proof_path || null
  });
}));

router.delete('/art/:id/signatures/:signatureId/proof', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const artRouteId = Number(req.params.id);
  const signatureId = Number(req.params.signatureId);
  if (!Number.isFinite(artRouteId) || artRouteId <= 0 || !Number.isFinite(signatureId) || signatureId <= 0) {
    return res.status(400).json({ error: 'Invalid art/signature id' });
  }
  const current = await attachSignaturesToArtRow(await loadNativeArtByRouteId(scopeContext, artRouteId));
  if (!current) return res.status(404).json({ error: 'Art item not found' });
  const existingSignature = (current.signatures || []).find((signature) => Number(signature.id) === signatureId) || null;
  if (!existingSignature) return res.status(404).json({ error: 'Signature record not found' });
  if (!existingSignature.proof_path) {
    const response = await serializeSignatureMutationResponse(scopeContext, current);
    return res.json({
      ...response,
      signature: existingSignature,
      removed: false,
      signature_proof_path: response.art?.signature_proof_path || null,
      proof_path: null
    });
  }
  const primaryProof = (existingSignature.proofs || []).find((proof) => proof.proof_path === existingSignature.proof_path) || (existingSignature.proofs || [])[0] || null;
  const proofMutation = primaryProof ? await archiveSignatureProof(pool, {
    ownerType: 'art',
    ownerId: current.id,
    signatureId,
    proofId: primaryProof.id
  }) : { signature: await updateSignatureProofPath(pool, { ownerType: 'art', ownerId: current.id, signatureId, proofPath: null }), proof: null };
  const signature = proofMutation?.signature || null;
  if (!signature) return res.status(404).json({ error: 'Signature record not found' });
  const response = await serializeSignatureMutationResponse(scopeContext, current);
  await logActivity(req, 'art.signature.proof.remove', 'art', buildPublicNativeArtId(current), {
    native_art_id: current.id,
    signatureRecordId: signature.id,
    previousPath: existingSignature.proof_path || null
  });
  res.json({
    ...response,
    signature,
    removed: true,
    signature_proof_path: response.art?.signature_proof_path || null,
    proof_path: null
  });
}));

router.post('/art/:id/signatures/:signatureId/primary', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const artRouteId = Number(req.params.id);
  const signatureId = Number(req.params.signatureId);
  if (!Number.isFinite(artRouteId) || artRouteId <= 0 || !Number.isFinite(signatureId) || signatureId <= 0) {
    return res.status(400).json({ error: 'Invalid art/signature id' });
  }
  const current = await loadNativeArtByRouteId(scopeContext, artRouteId);
  if (!current) return res.status(404).json({ error: 'Art item not found' });
  const signature = await setPrimarySignatureRecord(pool, { ownerType: 'art', ownerId: current.id, signatureId });
  if (!signature) return res.status(404).json({ error: 'Signature record not found' });
  const response = await serializeSignatureMutationResponse(scopeContext, current);
  await logActivity(req, 'art.signature.primary', 'art', buildPublicNativeArtId(current), {
    native_art_id: current.id,
    signatureRecordId: signature.id
  });
  res.json({ ...response, signature });
}));

router.delete('/art/:id/signatures/:signatureId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const artRouteId = Number(req.params.id);
  const signatureId = Number(req.params.signatureId);
  if (!Number.isFinite(artRouteId) || artRouteId <= 0 || !Number.isFinite(signatureId) || signatureId <= 0) {
    return res.status(400).json({ error: 'Invalid art/signature id' });
  }
  const current = await loadNativeArtByRouteId(scopeContext, artRouteId);
  if (!current) return res.status(404).json({ error: 'Art item not found' });
  const signature = await archiveSignatureRecord(pool, { ownerType: 'art', ownerId: current.id, signatureId });
  if (!signature) return res.status(404).json({ error: 'Signature record not found' });
  const response = await serializeSignatureMutationResponse(scopeContext, current);
  await logActivity(req, 'art.signature.archive', 'art', buildPublicNativeArtId(current), {
    native_art_id: current.id,
    signatureRecordId: signature.id
  });
  res.json({ ...response, signature, archived: true });
}));

router.post('/art/:id/upload-signature-proof', memoryUpload.single('proof'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const artRouteId = Number(req.params.id);
  if (!Number.isFinite(artRouteId) || artRouteId <= 0) {
    return res.status(400).json({ error: 'Invalid art id' });
  }
  if (!req.file) return res.status(400).json({ error: 'Proof image file is required' });
  if (!ALLOWED_IMAGE_MIME_TYPES.has(String(req.file.mimetype || '').toLowerCase())) {
    return res.status(400).json({ error: 'Unsupported image type' });
  }

  const current = await attachSignaturesToArtRow(await loadNativeArtByRouteId(scopeContext, artRouteId));
  if (!current) return res.status(404).json({ error: 'Art item not found' });
  const primarySignature = current.signatures?.find((signature) => signature.is_primary) || current.signatures?.[0] || null;
  const previousPath = primarySignature?.proof_path || null;
  const stored = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
  const signature = await syncPrimarySignatureRecord(pool, {
    ownerType: 'art',
    ownerId: current.id,
    libraryId: current.library_id || null,
    spaceId: current.space_id || null,
    createdBy: req.user.id,
    signature: buildArtSignaturePayloadFromRecord(primarySignature, { proof_path: stored.url }),
    signed: true
  });
  await pool.query(
    `UPDATE art_items
     SET signed = TRUE,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [current.id]
  );
  const publicId = buildPublicNativeArtId(current);
  await logActivity(req, previousPath ? 'art.signature_proof.replace' : 'art.signature_proof.upload', 'art', publicId, {
    previousPath,
    nextPath: stored.url,
    provider: stored.provider,
    native_art_id: current.id
  });
  res.json({
    id: publicId,
    native_art_id: current.id,
    signature_proof_path: signature?.proof_path || stored.url,
    proof_path: signature?.proof_path || stored.url,
    signatures: signature ? [signature] : [],
    provider: stored.provider
  });
}));

router.delete('/art/:id/signature-proof', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const artRouteId = Number(req.params.id);
  if (!Number.isFinite(artRouteId) || artRouteId <= 0) {
    return res.status(400).json({ error: 'Invalid art id' });
  }

  const current = await attachSignaturesToArtRow(await loadNativeArtByRouteId(scopeContext, artRouteId));
  if (!current) return res.status(404).json({ error: 'Art item not found' });
  const primarySignature = current.signatures?.find((signature) => signature.is_primary) || current.signatures?.[0] || null;
  const previousPath = primarySignature?.proof_path || null;
  if (!previousPath) {
    return res.json({ ok: true, removed: false, id: buildPublicNativeArtId(current), signature_proof_path: null });
  }
  const signature = await syncPrimarySignatureRecord(pool, {
    ownerType: 'art',
    ownerId: current.id,
    libraryId: current.library_id || null,
    spaceId: current.space_id || null,
    createdBy: req.user.id,
    signature: buildArtSignaturePayloadFromRecord(primarySignature, { proof_path: null }),
    signed: current.signed === true
  });
  const publicId = buildPublicNativeArtId(current);
  await logActivity(req, 'art.signature_proof.remove', 'art', publicId, {
    previousPath,
    native_art_id: current.id
  });
  res.json({
    ok: true,
    removed: true,
    id: publicId,
    native_art_id: current.id,
    signature_proof_path: signature?.proof_path || null,
    proof_path: signature?.proof_path || null,
    signatures: signature ? [signature] : []
  });
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
