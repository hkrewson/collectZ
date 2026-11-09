'use strict';

const TYPE_DETAIL_KEYS = new Set([
  'provider_name',
  'provider_item_id',
  'provider_issue_id',
  'calibre_entry_id',
  'kavita_parent_provider_item_id',
  'kavita_series_provider_item_id',
  'kavita_chapter_provider_item_id'
]);
const METADATA_KEYS = new Set([
  'provider_item_id',
  'provider_issue_id',
  'calibre_entry_id',
  'metron_issue_id',
  'plex_guid',
  'plex_item_key'
]);
const IDENTITY_VALUE_KEYS = new Set([
  'provider_item_id',
  'provider_issue_id',
  'calibre_entry_id',
  'metron_issue_id',
  'plex_guid',
  'plex_item_key',
  'kavita_parent_provider_item_id',
  'kavita_series_provider_item_id',
  'kavita_chapter_provider_item_id'
]);

function compatibilityError(message) {
  const error = new Error(message);
  error.code = 'EXTERNAL_IDENTITY_COMPATIBILITY_CONFLICT';
  error.status = 409;
  return error;
}

function normalizeFields(value, allowed, label) {
  if (value === null || value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const normalized = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label} field ${key} is not supported`);
    const text = String(raw ?? '').trim();
    if (!text || text.length > 2048) throw new TypeError(`${label} field ${key} is invalid`);
    normalized[key] = text;
  }
  return normalized;
}

function normalizeCompatibilityProjection(projection = {}, externalId) {
  const normalizedExternalId = String(externalId ?? '').trim();
  if (!normalizedExternalId) throw new TypeError('Compatibility projection requires an external identity');
  const normalized = {
    typeDetails: normalizeFields(projection.typeDetails, TYPE_DETAIL_KEYS, 'Compatibility type-details'),
    metadata: normalizeFields(projection.metadata, METADATA_KEYS, 'Compatibility metadata')
  };
  const identityValues = [
    ...Object.entries(normalized.typeDetails),
    ...Object.entries(normalized.metadata)
  ].filter(([key]) => IDENTITY_VALUE_KEYS.has(key)).map(([, value]) => value);
  if (identityValues.length === 0 || identityValues.some((value) => value !== normalizedExternalId)) {
    throw new TypeError('Compatibility identity fields must project the authoritative external id exactly');
  }
  return normalized;
}

function compareProjection(currentTypeDetails = {}, currentMetadata = {}, projection = {}) {
  const missingTypeDetails = {};
  const missingMetadata = {};
  const aligned = [];
  const conflicts = [];
  for (const [key, value] of Object.entries(projection.typeDetails || {})) {
    const current = String(currentTypeDetails?.[key] ?? '').trim();
    if (!current) missingTypeDetails[key] = value;
    else if (current === value) aligned.push({ storage: 'type_details', key });
    else conflicts.push({ storage: 'type_details', key, current, expected: value });
  }
  for (const [key, value] of Object.entries(projection.metadata || {})) {
    const current = String(currentMetadata?.[key] ?? '').trim();
    if (!current) missingMetadata[key] = value;
    else if (current === value) aligned.push({ storage: 'media_metadata', key });
    else conflicts.push({ storage: 'media_metadata', key, current, expected: value });
  }
  return { missingTypeDetails, missingMetadata, aligned, conflicts };
}

async function applyCompatibilityProjection(client, {
  spaceId,
  mediaId,
  externalId,
  projection
} = {}) {
  if (!client || typeof client.query !== 'function') throw new TypeError('Compatibility projection requires a transaction client');
  const normalized = normalizeCompatibilityProjection(projection, externalId);
  const media = await client.query(
    `SELECT id, type_details
       FROM media
      WHERE id = $1 AND space_id = $2
      FOR UPDATE`,
    [mediaId, spaceId]
  );
  if (!media.rows[0]) {
    const error = new Error('Canonical object was not found in the authorized workspace');
    error.code = 'CANONICAL_OBJECT_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const metadataKeys = Object.keys(normalized.metadata);
  const metadata = metadataKeys.length === 0
    ? { rows: [] }
    : await client.query(
        `SELECT "key", "value"
           FROM media_metadata
          WHERE media_id = $1 AND "key" = ANY($2::varchar[])
          FOR UPDATE`,
        [mediaId, metadataKeys]
      );
  const currentMetadata = Object.fromEntries((metadata.rows || []).map((row) => [row.key, row.value]));
  const comparison = compareProjection(media.rows[0].type_details || {}, currentMetadata, normalized);
  if (comparison.conflicts.length > 0) {
    const error = compatibilityError('Legacy provider identity projection conflicts with canonical compatibility fields');
    error.diagnostics = comparison.conflicts.map(({ storage, key }) => ({ storage, key }));
    throw error;
  }
  if (Object.keys(comparison.missingTypeDetails).length > 0) {
    await client.query(
      `UPDATE media
          SET type_details = COALESCE(type_details, '{}'::jsonb) || $3::jsonb,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND space_id = $2`,
      [mediaId, spaceId, JSON.stringify(comparison.missingTypeDetails)]
    );
  }
  for (const [key, value] of Object.entries(comparison.missingMetadata)) {
    await client.query(
      `INSERT INTO media_metadata (media_id, "key", "value")
       VALUES ($1, $2, $3)
       ON CONFLICT (media_id, "key") DO NOTHING`,
      [mediaId, key, value]
    );
  }
  return {
    written: Object.keys(comparison.missingTypeDetails).length + Object.keys(comparison.missingMetadata).length,
    aligned: comparison.aligned.length,
    conflicts: []
  };
}

module.exports = {
  TYPE_DETAIL_KEYS,
  METADATA_KEYS,
  normalizeCompatibilityProjection,
  compareProjection,
  applyCompatibilityProjection
};
