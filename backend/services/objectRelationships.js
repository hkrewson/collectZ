'use strict';

const VALID_OWNER_TYPES = new Set(['media', 'art', 'collectible', 'event']);
const VALID_RELATIONSHIP_TYPES = new Set([
  'part_of',
  'includes',
  'included_with',
  'companion_to',
  'purchased_with',
  'event_acquired_with'
]);

const OWNER_CONFIG = {
  media: {
    table: 'media',
    title: 'title',
    subtitle: "NULLIF(CONCAT_WS(' · ', initcap(replace(media_type, '_', ' ')), year::text), '')",
    archivedClause: ''
  },
  art: {
    table: 'art_items',
    title: 'title',
    subtitle: "NULLIF(CONCAT_WS(' · ', artist, series), '')",
    archivedClause: 'AND archived_at IS NULL'
  },
  collectible: {
    table: 'collectibles',
    title: 'title',
    subtitle: "NULLIF(CONCAT_WS(' · ', category, series), '')",
    archivedClause: 'AND archived_at IS NULL'
  },
  event: {
    table: 'events',
    title: 'title',
    subtitle: "NULLIF(CONCAT_WS(' · ', location, date_start::text), '')",
    archivedClause: 'AND archived_at IS NULL'
  }
};

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

function normalizeRelationshipType(value) {
  const relationshipType = cleanString(value, 40);
  return VALID_RELATIONSHIP_TYPES.has(relationshipType) ? relationshipType : null;
}

function buildScopeClause(scopeContext = {}, params = []) {
  let scopeClause = '';
  if (scopeContext?.spaceId !== null && scopeContext?.spaceId !== undefined) {
    params.push(scopeContext.spaceId);
    scopeClause += ` AND space_id = $${params.length}`;
  }
  if (scopeContext?.libraryId !== null && scopeContext?.libraryId !== undefined) {
    params.push(scopeContext.libraryId);
    scopeClause += ` AND library_id = $${params.length}`;
  }
  return scopeClause;
}

function spaceOnlyScope(scopeContext = {}) {
  return {
    spaceId: scopeContext?.spaceId,
    libraryId: null
  };
}

function normalizeOwnerInput({ ownerType, ownerId } = {}) {
  const normalizedOwnerType = normalizeOwnerType(ownerType);
  const normalizedOwnerId = Number(ownerId);
  if (!normalizedOwnerType || !Number.isInteger(normalizedOwnerId) || normalizedOwnerId <= 0) {
    const error = new Error('Invalid relationship owner');
    error.status = 400;
    throw error;
  }
  return { ownerType: normalizedOwnerType, ownerId: normalizedOwnerId };
}

async function resolveRelationshipOwner(pool, { ownerType, ownerId, scopeContext = {} } = {}) {
  const normalized = normalizeOwnerInput({ ownerType, ownerId });
  const config = OWNER_CONFIG[normalized.ownerType];
  const params = [normalized.ownerId];
  const scopeClause = buildScopeClause(scopeContext, params);
  const result = await pool.query(
    `SELECT id, library_id, space_id, ${config.title} AS title, ${config.subtitle} AS subtitle
     FROM ${config.table}
     WHERE id = $1
       ${config.archivedClause}
       ${scopeClause}
     LIMIT 1`,
    params
  );
  const row = result.rows[0] || null;
  if (!row) {
    const error = new Error('Relationship owner not found');
    error.status = 404;
    throw error;
  }
  return {
    owner_type: normalized.ownerType,
    owner_id: normalized.ownerId,
    library_id: row.library_id || null,
    space_id: row.space_id || null,
    title: row.title || `${normalized.ownerType} #${normalized.ownerId}`,
    subtitle: row.subtitle || null
  };
}

function serializeRelationship(row = {}, titles = new Map(), owner = null) {
  const sourceKey = `${row.source_type}:${row.source_id}`;
  const targetKey = `${row.target_type}:${row.target_id}`;
  const source = titles.get(sourceKey) || {
    owner_type: row.source_type,
    owner_id: row.source_id,
    title: `${row.source_type} #${row.source_id}`,
    subtitle: null
  };
  const target = titles.get(targetKey) || {
    owner_type: row.target_type,
    owner_id: row.target_id,
    title: `${row.target_type} #${row.target_id}`,
    subtitle: null
  };
  const ownerMatchesSource = owner && owner.owner_type === row.source_type && Number(owner.owner_id) === Number(row.source_id);
  const counterpart = ownerMatchesSource ? target : source;
  return {
    id: row.id,
    relationship_type: row.relationship_type,
    label: row.label || null,
    notes: row.notes || null,
    source,
    target,
    counterpart,
    direction: ownerMatchesSource ? 'outgoing' : 'incoming',
    library_id: row.library_id || null,
    space_id: row.space_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function hydrateRelationshipTitles(pool, rows = []) {
  const idsByType = new Map();
  for (const row of rows) {
    for (const [ownerType, ownerId] of [[row.source_type, row.source_id], [row.target_type, row.target_id]]) {
      if (!idsByType.has(ownerType)) idsByType.set(ownerType, new Set());
      idsByType.get(ownerType).add(Number(ownerId));
    }
  }
  const titles = new Map();
  for (const [ownerType, idsSet] of idsByType.entries()) {
    const config = OWNER_CONFIG[ownerType];
    const ids = Array.from(idsSet).filter((id) => Number.isInteger(id) && id > 0);
    if (!config || ids.length === 0) continue;
    const result = await pool.query(
      `SELECT id, ${config.title} AS title, ${config.subtitle} AS subtitle
       FROM ${config.table}
       WHERE id = ANY($1::int[])`,
      [ids]
    );
    for (const row of result.rows) {
      titles.set(`${ownerType}:${row.id}`, {
        owner_type: ownerType,
        owner_id: row.id,
        title: row.title || `${ownerType} #${row.id}`,
        subtitle: row.subtitle || null
      });
    }
  }
  return titles;
}

async function loadRelationshipsForOwner(pool, { ownerType, ownerId } = {}) {
  const owner = normalizeOwnerInput({ ownerType, ownerId });
  const result = await pool.query(
    `SELECT *
     FROM object_relationships
     WHERE archived_at IS NULL
       AND (
         (source_type = $1 AND source_id = $2)
         OR (target_type = $1 AND target_id = $2)
       )
     ORDER BY updated_at DESC, id DESC`,
    [owner.ownerType, owner.ownerId]
  );
  const titleMap = await hydrateRelationshipTitles(pool, result.rows);
  const ownerPayload = { owner_type: owner.ownerType, owner_id: owner.ownerId };
  return result.rows.map((row) => serializeRelationship(row, titleMap, ownerPayload));
}

async function searchRelationshipTargets(pool, {
  q,
  ownerType = 'all',
  scopeContext = {},
  limit = 12
} = {}) {
  const query = cleanString(q, 120);
  if (!query || query.length < 2) return [];
  const requestedType = cleanString(ownerType, 30) || 'all';
  const ownerTypes = requestedType === 'all'
    ? Array.from(VALID_OWNER_TYPES)
    : [normalizeOwnerType(requestedType)].filter(Boolean);
  if (ownerTypes.length === 0) {
    const error = new Error('Invalid relationship target type');
    error.status = 400;
    throw error;
  }

  const perTypeLimit = Math.max(1, Math.min(Number(limit) || 12, 25));
  const targetScopeContext = spaceOnlyScope(scopeContext);
  const results = [];
  for (const type of ownerTypes) {
    const config = OWNER_CONFIG[type];
    const params = [`%${query}%`, perTypeLimit];
    const scopeClause = buildScopeClause(targetScopeContext, params);
    const searchResult = await pool.query(
      `SELECT id, ${config.title} AS title, ${config.subtitle} AS subtitle
       FROM ${config.table}
       WHERE ${config.title} ILIKE $1
         ${config.archivedClause}
         ${scopeClause}
       ORDER BY ${config.title} ASC, id ASC
       LIMIT $2`,
      params
    );
    for (const row of searchResult.rows) {
      results.push({
        owner_type: type,
        owner_id: row.id,
        title: row.title || `${type} #${row.id}`,
        subtitle: row.subtitle || null
      });
    }
  }
  return results.slice(0, perTypeLimit);
}

async function createRelationship(pool, {
  source,
  targetType,
  targetId,
  relationshipType,
  label = null,
  notes = null,
  scopeContext = {},
  userId = null
} = {}) {
  const relationship = normalizeRelationshipType(relationshipType);
  if (!relationship) {
    const allowed = Array.from(VALID_RELATIONSHIP_TYPES).join(', ');
    const error = new Error(`Invalid relationship type. Expected one of: ${allowed}`);
    error.status = 400;
    throw error;
  }
  const target = await resolveRelationshipOwner(pool, { ownerType: targetType, ownerId: targetId, scopeContext: spaceOnlyScope(scopeContext) });
  if (source.owner_type === target.owner_type && Number(source.owner_id) === Number(target.owner_id)) {
    const error = new Error('A record cannot be related to itself');
    error.status = 400;
    throw error;
  }
  const result = await pool.query(
    `INSERT INTO object_relationships (
       source_type, source_id, target_type, target_id, relationship_type, label, notes,
       library_id, space_id, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (source_type, source_id, target_type, target_id, relationship_type) WHERE archived_at IS NULL
     DO UPDATE SET label = EXCLUDED.label,
                   notes = EXCLUDED.notes,
                   library_id = EXCLUDED.library_id,
                   space_id = EXCLUDED.space_id,
                   updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      source.owner_type,
      source.owner_id,
      target.owner_type,
      target.owner_id,
      relationship,
      cleanString(label, 160),
      cleanString(notes, 2000),
      source.library_id || target.library_id || null,
      source.space_id || target.space_id || null,
      userId || null
    ]
  );
  const titleMap = await hydrateRelationshipTitles(pool, result.rows);
  return serializeRelationship(result.rows[0], titleMap, source);
}

async function archiveRelationship(pool, { owner, relationshipId } = {}) {
  const id = Number(relationshipId);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error('Invalid relationship id');
    error.status = 400;
    throw error;
  }
  const result = await pool.query(
    `UPDATE object_relationships
     SET archived_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND archived_at IS NULL
       AND (
         (source_type = $2 AND source_id = $3)
         OR (target_type = $2 AND target_id = $3)
       )
     RETURNING *`,
    [id, owner.owner_type, owner.owner_id]
  );
  if (!result.rows[0]) {
    const error = new Error('Relationship not found');
    error.status = 404;
    throw error;
  }
  const titleMap = await hydrateRelationshipTitles(pool, result.rows);
  return serializeRelationship(result.rows[0], titleMap, owner);
}

module.exports = {
  VALID_OWNER_TYPES,
  VALID_RELATIONSHIP_TYPES,
  archiveRelationship,
  createRelationship,
  loadRelationshipsForOwner,
  resolveRelationshipOwner,
  searchRelationshipTargets
};
