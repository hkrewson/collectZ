'use strict';

const { TYPE_DETAILS_ALLOWED_BY_MEDIA_TYPE, normalizeTypeDetails } = require('./typeDetails');

const MEDIA_FIELD_COLUMNS = Object.freeze({
  title: 'title',
  original_title: 'original_title',
  release_date: 'release_date',
  year: 'year',
  format: 'format',
  genre: 'genre',
  director: 'director',
  cast_members: 'cast_members',
  rating: 'rating',
  tmdb_id: 'tmdb_id',
  tmdb_media_type: 'tmdb_media_type',
  tmdb_url: 'tmdb_url',
  poster_path: 'poster_path',
  backdrop_path: 'backdrop_path',
  overview: 'overview',
  trailer_url: 'trailer_url',
  runtime: 'runtime',
  network: 'network',
  upc: 'upc'
});

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 2147483647) {
    throw new TypeError(`${label} is invalid`);
  }
  return parsed;
}

function normalizeFieldPath(value, mediaType = null) {
  const fieldPath = String(value || '').trim();
  const match = /^(media|type_details)\.([a-z][a-z0-9_]{0,79})$/.exec(fieldPath);
  if (!match) throw new TypeError('Canonical field path is invalid');
  const [, storage, field] = match;
  if (storage === 'media' && !MEDIA_FIELD_COLUMNS[field]) {
    throw new TypeError(`Canonical media field ${field} is not provider-writable`);
  }
  if (storage === 'type_details' && mediaType) {
    const allowed = new Set(TYPE_DETAILS_ALLOWED_BY_MEDIA_TYPE[mediaType] || []);
    if (!allowed.has(field)) throw new TypeError(`Canonical type-details field ${field} is invalid for ${mediaType}`);
  }
  return { fieldPath, storage, field };
}

function blank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function comparable(value) {
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value ?? null);
}

function decideProviderFieldUpdate({ currentValue, proposedValue, control, providerConnectionId } = {}) {
  if (proposedValue === undefined || proposedValue === null) return { action: 'skip', reason: 'missing_proposed_value' };
  if (comparable(currentValue) === comparable(proposedValue)) return { action: 'observe', reason: 'already_equal' };
  if (control?.locked) return { action: 'skip', reason: 'locked' };
  if (blank(currentValue)) {
    if (control && ['manual', 'reviewed'].includes(control.authority) && control.provider_write_mode !== 'refresh') {
      return { action: 'skip', reason: `${control.authority}_preserved` };
    }
    if (control?.source_provider_connection_id && control.source_provider_connection_id !== providerConnectionId) {
      return { action: 'skip', reason: 'different_provider_preserved' };
    }
    return { action: 'fill', reason: 'canonical_value_missing' };
  }
  if (!control) return { action: 'skip', reason: 'uncontrolled_existing_value' };
  if (control.source_provider_connection_id && control.source_provider_connection_id !== providerConnectionId) {
    return { action: 'skip', reason: 'different_provider_preserved' };
  }
  if (control.authority === 'manual') return { action: 'skip', reason: 'manual_preserved' };
  if (control.provider_write_mode !== 'refresh') {
    return { action: 'skip', reason: `${control.authority}_preserved` };
  }
  return { action: 'refresh', reason: `${control.authority}_refresh_allowed` };
}

function normalizeControl({ authority, providerWriteMode = 'preserve', locked = false, providerConnectionId = null } = {}) {
  const normalizedAuthority = String(authority || '').trim().toLowerCase();
  const mode = String(providerWriteMode || '').trim().toLowerCase();
  if (!['provider', 'manual', 'reviewed'].includes(normalizedAuthority)) {
    throw new TypeError('Canonical field authority is invalid');
  }
  if (!['preserve', 'refresh'].includes(mode)) throw new TypeError('Canonical field provider write mode is invalid');
  const isLocked = Boolean(locked);
  if (normalizedAuthority === 'provider' && !providerConnectionId) {
    throw new TypeError('Provider field authority requires a Provider Connection');
  }
  if (mode === 'refresh' && (
    !['provider', 'reviewed'].includes(normalizedAuthority) || !providerConnectionId || isLocked
  )) {
    throw new TypeError('Provider refresh requires an unlocked provider or reviewed authority with a Provider Connection');
  }
  if (isLocked && mode !== 'preserve') throw new TypeError('Locked canonical fields must preserve their value');
  return {
    authority: normalizedAuthority,
    providerWriteMode: mode,
    locked: isLocked,
    providerConnectionId: providerConnectionId || null
  };
}

async function setCanonicalFieldControl(client, {
  spaceId,
  mediaId,
  fieldPath,
  authority,
  providerWriteMode,
  locked,
  providerConnectionId,
  actorId
} = {}) {
  if (!client || typeof client.query !== 'function') throw new TypeError('Canonical field control requires a transaction client');
  const workspaceId = positiveInteger(spaceId, 'Workspace');
  const canonicalId = positiveInteger(mediaId, 'Canonical object');
  const userId = positiveInteger(actorId, 'Actor');
  const mediaResult = await client.query(
    'SELECT media_type FROM media WHERE id = $1 AND space_id = $2 FOR UPDATE',
    [canonicalId, workspaceId]
  );
  if (!mediaResult.rows[0]) {
    const error = new Error('Canonical object was not found in the authorized workspace');
    error.code = 'CANONICAL_OBJECT_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const normalizedPath = normalizeFieldPath(fieldPath, mediaResult.rows[0].media_type).fieldPath;
  const control = normalizeControl({ authority, providerWriteMode, locked, providerConnectionId });
  const result = await client.query(
    `INSERT INTO canonical_media_field_controls
       (space_id, media_id, field_path, authority, provider_write_mode, locked,
        source_provider_connection_id, decided_by, decided_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
     ON CONFLICT (media_id, field_path) DO UPDATE
       SET authority = EXCLUDED.authority,
           provider_write_mode = EXCLUDED.provider_write_mode,
           locked = EXCLUDED.locked,
           source_provider_connection_id = EXCLUDED.source_provider_connection_id,
           decided_by = EXCLUDED.decided_by,
           decided_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [workspaceId, canonicalId, normalizedPath, control.authority, control.providerWriteMode,
      control.locked, control.providerConnectionId, userId]
  );
  return result.rows[0];
}

async function applyProviderFieldUpdates(client, {
  spaceId,
  mediaId,
  providerConnectionId,
  actorId,
  candidates = {}
} = {}) {
  if (!client || typeof client.query !== 'function') throw new TypeError('Provider field updates require a transaction client');
  const workspaceId = positiveInteger(spaceId, 'Workspace');
  const canonicalId = positiveInteger(mediaId, 'Canonical object');
  const userId = positiveInteger(actorId, 'Actor');
  if (!providerConnectionId) throw new TypeError('Provider field updates require a Provider Connection');
  if (!candidates || typeof candidates !== 'object' || Array.isArray(candidates)) {
    throw new TypeError('Provider field candidates must be an object');
  }
  const mediaResult = await client.query(
    'SELECT * FROM media WHERE id = $1 AND space_id = $2 FOR UPDATE',
    [canonicalId, workspaceId]
  );
  const media = mediaResult.rows[0];
  if (!media) {
    const error = new Error('Canonical object was not found in the authorized workspace');
    error.code = 'CANONICAL_OBJECT_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const connection = await client.query(
    `SELECT id FROM provider_connections
      WHERE space_id = $1 AND id = $2 AND status = 'active'
      FOR SHARE`,
    [workspaceId, providerConnectionId]
  );
  if (!connection.rows[0]) {
    const error = new Error('Active Provider Connection was not found in the authorized workspace');
    error.code = 'PROVIDER_CONNECTION_UNAVAILABLE';
    error.status = 409;
    throw error;
  }
  const normalizedCandidates = Object.entries(candidates).map(([path, value]) => {
    const normalizedPath = normalizeFieldPath(path, media.media_type);
    if (normalizedPath.storage !== 'type_details' || value === null || value === undefined) {
      return { ...normalizedPath, value };
    }
    const normalized = normalizeTypeDetails(media.media_type, { [normalizedPath.field]: value }, { strict: true });
    if (normalized.errors.length > 0 || !normalized.value || normalized.value[normalizedPath.field] === undefined) {
      throw new TypeError(`Canonical type-details field ${normalizedPath.field} has an invalid provider value`);
    }
    return { ...normalizedPath, value: normalized.value[normalizedPath.field] };
  });
  if (normalizedCandidates.length === 0) return { applied: [], observed: [], skipped: [] };
  const controlsResult = await client.query(
    `SELECT * FROM canonical_media_field_controls
      WHERE space_id = $1 AND media_id = $2 AND field_path = ANY($3::varchar[])
      FOR UPDATE`,
    [workspaceId, canonicalId, normalizedCandidates.map(({ fieldPath }) => fieldPath)]
  );
  const controls = new Map(controlsResult.rows.map((row) => [row.field_path, row]));
  const result = { applied: [], observed: [], skipped: [] };

  for (const candidate of normalizedCandidates) {
    const currentValue = candidate.storage === 'media'
      ? media[candidate.field]
      : (media.type_details || {})[candidate.field];
    const control = controls.get(candidate.fieldPath) || null;
    const decision = decideProviderFieldUpdate({
      currentValue,
      proposedValue: candidate.value,
      control,
      providerConnectionId
    });
    if (decision.action === 'skip') {
      result.skipped.push({ fieldPath: candidate.fieldPath, reason: decision.reason });
      continue;
    }
    if (decision.action === 'fill' || decision.action === 'refresh') {
      if (candidate.storage === 'media') {
        await client.query(
          `UPDATE media SET ${MEDIA_FIELD_COLUMNS[candidate.field]} = $3 WHERE id = $1 AND space_id = $2`,
          [canonicalId, workspaceId, candidate.value]
        );
        media[candidate.field] = candidate.value;
      } else {
        await client.query(
          `UPDATE media
              SET type_details = jsonb_set(COALESCE(type_details, '{}'::jsonb), ARRAY[$3]::text[], $4::jsonb, true)
            WHERE id = $1 AND space_id = $2`,
          [canonicalId, workspaceId, candidate.field, JSON.stringify(candidate.value)]
        );
        media.type_details = { ...(media.type_details || {}), [candidate.field]: candidate.value };
      }
      result.applied.push({ fieldPath: candidate.fieldPath, action: decision.action });
    } else {
      result.observed.push({ fieldPath: candidate.fieldPath, reason: decision.reason });
    }

    if (control) {
      if (control.source_provider_connection_id === providerConnectionId) {
        await client.query(
          `UPDATE canonical_media_field_controls
              SET last_observed_at = CURRENT_TIMESTAMP
            WHERE space_id = $1 AND media_id = $2 AND field_path = $3`,
          [workspaceId, canonicalId, candidate.fieldPath]
        );
      }
    } else if (decision.action === 'fill') {
      await client.query(
        `INSERT INTO canonical_media_field_controls
           (space_id, media_id, field_path, authority, provider_write_mode, locked,
            source_provider_connection_id, last_observed_at, decided_by)
         VALUES ($1, $2, $3, 'provider', 'refresh', false, $4, CURRENT_TIMESTAMP, $5)`,
        [workspaceId, canonicalId, candidate.fieldPath, providerConnectionId, userId]
      );
    }
  }
  return result;
}

module.exports = {
  MEDIA_FIELD_COLUMNS,
  normalizeFieldPath,
  normalizeControl,
  decideProviderFieldUpdate,
  setCanonicalFieldControl,
  applyProviderFieldUpdates
};
