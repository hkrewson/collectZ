'use strict';

const VALID_OWNER_TYPES = new Set(['media', 'art', 'collectible']);
const VALID_FAMILIES = new Set([
  'signed',
  'numbered',
  'certificate',
  'event_acquired',
  'edition_variant',
  'graded',
  'bundle',
  'provenance'
]);
const VALID_TONES = new Set(['default', 'brand', 'warning', 'danger', 'success']);

function cleanString(value, maxLength = null) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return maxLength && text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeOwnerType(value) {
  const ownerType = cleanString(value, 30);
  return VALID_OWNER_TYPES.has(ownerType) ? ownerType : null;
}

function normalizeTraitKey(value, fallbackFamily = null) {
  const raw = cleanString(value || fallbackFamily, 80);
  if (!raw) return null;
  const key = raw
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return key || null;
}

function normalizeTraitDetails(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((detail) => {
      const label = cleanString(detail?.label, 80);
      const detailValue = cleanString(detail?.value, 500);
      if (!label || !detailValue) return null;
      return { label, value: detailValue };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeTraitPayload(input = {}) {
  const family = cleanString(input.family, 40);
  if (!VALID_FAMILIES.has(family)) {
    const allowed = Array.from(VALID_FAMILIES).join(', ');
    const error = new Error(`Invalid trait family. Expected one of: ${allowed}`);
    error.status = 400;
    throw error;
  }
  const traitKey = normalizeTraitKey(input.key || input.trait_key, family);
  const label = cleanString(input.label, 120) || family.replaceAll('_', ' ');
  const tone = VALID_TONES.has(cleanString(input.tone, 20)) ? cleanString(input.tone, 20) : 'default';
  return {
    trait_key: traitKey,
    family,
    label,
    summary: cleanString(input.summary, 1000) || label,
    tone,
    details: normalizeTraitDetails(input.details),
    payload: normalizeJsonObject(input.payload),
    source: cleanString(input.source, 80) || 'manual',
    source_context: normalizeJsonObject(input.source_context)
  };
}

function serializeTraitRecord(row = {}) {
  return {
    id: row.id,
    owner_type: row.owner_type,
    owner_id: row.owner_id,
    key: row.trait_key,
    trait_key: row.trait_key,
    family: row.family,
    label: row.label,
    summary: row.summary,
    tone: row.tone || 'default',
    details: Array.isArray(row.details) ? row.details : [],
    payload: normalizeJsonObject(row.payload),
    source: row.source || 'manual',
    source_context: normalizeJsonObject(row.source_context),
    library_id: row.library_id || null,
    space_id: row.space_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function resolveTraitOwner(pool, { ownerType, ownerId, scopeContext = {} } = {}) {
  const normalizedOwnerType = normalizeOwnerType(ownerType);
  const normalizedOwnerId = Number(ownerId);
  if (!normalizedOwnerType || !Number.isInteger(normalizedOwnerId) || normalizedOwnerId <= 0) {
    const error = new Error('Invalid trait owner');
    error.status = 400;
    throw error;
  }

  const params = [normalizedOwnerId];
  let scopeClause = '';
  if (scopeContext?.spaceId !== null && scopeContext?.spaceId !== undefined) {
    params.push(scopeContext.spaceId);
    scopeClause += ` AND space_id = $${params.length}`;
  }
  if (scopeContext?.libraryId !== null && scopeContext?.libraryId !== undefined) {
    params.push(scopeContext.libraryId);
    scopeClause += ` AND library_id = $${params.length}`;
  }

  const tableByOwnerType = {
    media: { table: 'media', archivedClause: '' },
    art: { table: 'art_items', archivedClause: ' AND archived_at IS NULL' },
    collectible: { table: 'collectibles', archivedClause: ' AND archived_at IS NULL' }
  };
  const config = tableByOwnerType[normalizedOwnerType];
  const result = await pool.query(
    `SELECT id, library_id, space_id
     FROM ${config.table}
     WHERE id = $1
       ${config.archivedClause}
       ${scopeClause}
     LIMIT 1`,
    params
  );
  const row = result.rows[0] || null;
  if (!row) {
    const error = new Error('Trait owner not found');
    error.status = 404;
    throw error;
  }
  return {
    owner_type: normalizedOwnerType,
    owner_id: normalizedOwnerId,
    library_id: row.library_id || null,
    space_id: row.space_id || null
  };
}

async function loadTraitRecordsForOwner(pool, { ownerType, ownerId } = {}) {
  const normalizedOwnerType = normalizeOwnerType(ownerType);
  const normalizedOwnerId = Number(ownerId);
  if (!normalizedOwnerType || !Number.isInteger(normalizedOwnerId) || normalizedOwnerId <= 0) return [];
  const result = await pool.query(
    `SELECT *
     FROM collectible_trait_records
     WHERE owner_type = $1
       AND owner_id = $2
       AND archived_at IS NULL
     ORDER BY updated_at DESC, id DESC`,
    [normalizedOwnerType, normalizedOwnerId]
  );
  return result.rows.map(serializeTraitRecord);
}

async function loadTraitRecords(pool, { ownerType, ownerIds = [] } = {}) {
  const normalizedOwnerType = normalizeOwnerType(ownerType);
  const ids = Array.from(new Set((Array.isArray(ownerIds) ? ownerIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0)));
  const byOwner = new Map();
  if (!normalizedOwnerType || ids.length === 0) return byOwner;
  const result = await pool.query(
    `SELECT *
     FROM collectible_trait_records
     WHERE owner_type = $1
       AND owner_id = ANY($2::int[])
       AND archived_at IS NULL
     ORDER BY updated_at DESC, id DESC`,
    [normalizedOwnerType, ids]
  );
  for (const row of result.rows) {
    const ownerId = Number(row.owner_id);
    if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
    byOwner.get(ownerId).push(serializeTraitRecord(row));
  }
  return byOwner;
}

async function upsertTraitRecord(pool, { owner, input, userId = null } = {}) {
  const trait = normalizeTraitPayload(input);
  const result = await pool.query(
    `INSERT INTO collectible_trait_records (
       owner_type, owner_id, trait_key, family, label, summary, tone, details, payload,
       source, source_context, library_id, space_id, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11::jsonb,$12,$13,$14)
     ON CONFLICT (owner_type, owner_id, trait_key) WHERE archived_at IS NULL
     DO UPDATE SET family = EXCLUDED.family,
                   label = EXCLUDED.label,
                   summary = EXCLUDED.summary,
                   tone = EXCLUDED.tone,
                   details = EXCLUDED.details,
                   payload = EXCLUDED.payload,
                   source = EXCLUDED.source,
                   source_context = EXCLUDED.source_context,
                   library_id = EXCLUDED.library_id,
                   space_id = EXCLUDED.space_id,
                   updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      owner.owner_type,
      owner.owner_id,
      trait.trait_key,
      trait.family,
      trait.label,
      trait.summary,
      trait.tone,
      JSON.stringify(trait.details),
      JSON.stringify(trait.payload),
      trait.source,
      JSON.stringify(trait.source_context),
      owner.library_id || null,
      owner.space_id || null,
      userId || null
    ]
  );
  return serializeTraitRecord(result.rows[0]);
}

async function archiveTraitRecord(pool, { owner, traitKey } = {}) {
  const normalizedKey = normalizeTraitKey(traitKey);
  if (!normalizedKey) {
    const error = new Error('Trait key is required');
    error.status = 400;
    throw error;
  }
  const result = await pool.query(
    `UPDATE collectible_trait_records
     SET archived_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE owner_type = $1
       AND owner_id = $2
       AND trait_key = $3
       AND archived_at IS NULL
     RETURNING *`,
    [owner.owner_type, owner.owner_id, normalizedKey]
  );
  if (!result.rows[0]) {
    const error = new Error('Trait record not found');
    error.status = 404;
    throw error;
  }
  return serializeTraitRecord(result.rows[0]);
}

module.exports = {
  VALID_FAMILIES,
  VALID_OWNER_TYPES,
  archiveTraitRecord,
  loadTraitRecords,
  loadTraitRecordsForOwner,
  normalizeTraitPayload,
  resolveTraitOwner,
  serializeTraitRecord,
  upsertTraitRecord
};
