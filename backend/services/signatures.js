'use strict';

const VALID_OWNER_TYPES = new Set(['media', 'art', 'event_artifact']);

function cleanString(value, maxLength = 1000) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function cleanDate(value) {
  const text = cleanString(value, 32);
  if (!text) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeOwnerType(ownerType) {
  const normalized = cleanString(ownerType, 32);
  if (!VALID_OWNER_TYPES.has(normalized)) {
    throw new Error(`Unsupported signature owner type: ${ownerType}`);
  }
  return normalized;
}

function normalizeSignatureInput(input = {}) {
  const signerName = cleanString(input.signer_name ?? input.signed_by, 255);
  const signerRole = cleanString(input.signer_role ?? input.signed_role, 100);
  const signedOn = cleanDate(input.signed_on);
  const signedAt = cleanString(input.signed_at, 255);
  const proofPath = cleanString(input.proof_path ?? input.signed_proof_path, 1000);
  const notes = cleanString(input.notes ?? input.signature_notes, 5000);
  const signedEventIdRaw = input.signed_event_id ?? input.event_id;
  const signedEventId = Number.isFinite(Number(signedEventIdRaw)) && Number(signedEventIdRaw) > 0
    ? Number(signedEventIdRaw)
    : null;
  const hasDetails = Boolean(signerName || signerRole || signedOn || signedAt || signedEventId || proofPath || notes);
  return {
    signer_name: signerName,
    signer_role: signerRole,
    signed_on: signedOn,
    signed_at: signedAt,
    signed_event_id: signedEventId,
    proof_path: proofPath,
    notes,
    hasDetails
  };
}

function serializeSignatureRow(row = {}) {
  const signedOn = row.signed_on instanceof Date
    ? row.signed_on.toISOString().slice(0, 10)
    : (row.signed_on ? String(row.signed_on).slice(0, 10) : null);
  return {
    id: Number(row.id || 0) || null,
    owner_type: row.owner_type || null,
    owner_id: Number(row.owner_id || 0) || null,
    library_id: Number(row.library_id || 0) || null,
    space_id: Number(row.space_id || 0) || null,
    signer_name: row.signer_name || null,
    signer_role: row.signer_role || null,
    signed_on: signedOn,
    signed_at: row.signed_at || null,
    signed_event_id: Number(row.signed_event_id || 0) || null,
    proof_path: row.proof_path || null,
    notes: row.notes || null,
    is_primary: row.is_primary === true,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

async function loadSignatureRecords(pool, { ownerType, ownerIds = [] }) {
  const normalizedOwnerType = normalizeOwnerType(ownerType);
  const ids = Array.isArray(ownerIds)
    ? ownerIds.map((value) => Number(value || 0)).filter((value) => Number.isFinite(value) && value > 0)
    : [];
  if (ids.length === 0) return new Map();
  const result = await pool.query(
    `SELECT *
       FROM signature_records
      WHERE owner_type = $1
        AND owner_id = ANY($2::int[])
        AND archived_at IS NULL
      ORDER BY is_primary DESC, signed_on DESC NULLS LAST, id DESC`,
    [normalizedOwnerType, ids]
  );
  const grouped = new Map(ids.map((id) => [id, []]));
  for (const row of result.rows || []) {
    const ownerId = Number(row.owner_id || 0);
    if (!grouped.has(ownerId)) grouped.set(ownerId, []);
    grouped.get(ownerId).push(serializeSignatureRow(row));
  }
  return grouped;
}

async function loadSignatureRecordsForOwner(pool, { ownerType, ownerId }) {
  const grouped = await loadSignatureRecords(pool, { ownerType, ownerIds: [ownerId] });
  return grouped.get(Number(ownerId)) || [];
}

async function hasActiveSignatureRecords(db, { ownerType, ownerId }) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM signature_records
      WHERE owner_type = $1
        AND owner_id = $2
        AND archived_at IS NULL`,
    [ownerType, ownerId]
  );
  return Number(result.rows?.[0]?.count || 0) > 0;
}

async function hasActivePrimarySignatureRecord(db, { ownerType, ownerId }) {
  const result = await db.query(
    `SELECT id
       FROM signature_records
      WHERE owner_type = $1
        AND owner_id = $2
        AND is_primary = TRUE
        AND archived_at IS NULL
      LIMIT 1`,
    [ownerType, ownerId]
  );
  return Boolean(result.rows?.[0]?.id);
}

async function setPrimarySignatureRecord(pool, { ownerType, ownerId, signatureId }) {
  const normalizedOwnerType = normalizeOwnerType(ownerType);
  const normalizedOwnerId = Number(ownerId || 0);
  const normalizedSignatureId = Number(signatureId || 0);
  if (!Number.isFinite(normalizedOwnerId) || normalizedOwnerId <= 0) return null;
  if (!Number.isFinite(normalizedSignatureId) || normalizedSignatureId <= 0) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query(
      `SELECT *
         FROM signature_records
        WHERE id = $1
          AND owner_type = $2
          AND owner_id = $3
          AND archived_at IS NULL
        LIMIT 1
        FOR UPDATE`,
      [normalizedSignatureId, normalizedOwnerType, normalizedOwnerId]
    );
    if (!target.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(
      `UPDATE signature_records
          SET is_primary = FALSE,
              updated_at = CURRENT_TIMESTAMP
        WHERE owner_type = $1
          AND owner_id = $2
          AND archived_at IS NULL
          AND id <> $3`,
      [normalizedOwnerType, normalizedOwnerId, normalizedSignatureId]
    );
    const updated = await client.query(
      `UPDATE signature_records
          SET is_primary = TRUE,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      [normalizedSignatureId]
    );
    await client.query('COMMIT');
    return serializeSignatureRow(updated.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createSignatureRecord(pool, {
  ownerType,
  ownerId,
  libraryId = null,
  spaceId = null,
  createdBy = null,
  signature = {},
  isPrimary = false
}) {
  const normalizedOwnerType = normalizeOwnerType(ownerType);
  const normalizedOwnerId = Number(ownerId || 0);
  if (!Number.isFinite(normalizedOwnerId) || normalizedOwnerId <= 0) return null;
  const normalized = normalizeSignatureInput(signature);
  if (!normalized.hasDetails) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const shouldBePrimary = isPrimary === true || !(await hasActivePrimarySignatureRecord(client, {
      ownerType: normalizedOwnerType,
      ownerId: normalizedOwnerId
    }));
    if (shouldBePrimary) {
      await client.query(
        `UPDATE signature_records
            SET is_primary = FALSE,
                updated_at = CURRENT_TIMESTAMP
          WHERE owner_type = $1
            AND owner_id = $2
            AND archived_at IS NULL`,
        [normalizedOwnerType, normalizedOwnerId]
      );
    }
    const inserted = await client.query(
      `INSERT INTO signature_records (
         owner_type,
         owner_id,
         library_id,
         space_id,
         signer_name,
         signer_role,
         signed_on,
         signed_at,
         signed_event_id,
         proof_path,
         notes,
         is_primary,
         created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        normalizedOwnerType,
        normalizedOwnerId,
        libraryId || null,
        spaceId || null,
        normalized.signer_name,
        normalized.signer_role,
        normalized.signed_on,
        normalized.signed_at,
        normalized.signed_event_id,
        normalized.proof_path,
        normalized.notes,
        shouldBePrimary,
        createdBy || null
      ]
    );
    await client.query('COMMIT');
    return serializeSignatureRow(inserted.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateSignatureRecord(pool, {
  ownerType,
  ownerId,
  signatureId,
  libraryId = null,
  spaceId = null,
  signature = {},
  isPrimary = undefined
}) {
  const normalizedOwnerType = normalizeOwnerType(ownerType);
  const normalizedOwnerId = Number(ownerId || 0);
  const normalizedSignatureId = Number(signatureId || 0);
  if (!Number.isFinite(normalizedOwnerId) || normalizedOwnerId <= 0) return null;
  if (!Number.isFinite(normalizedSignatureId) || normalizedSignatureId <= 0) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT *
         FROM signature_records
        WHERE id = $1
          AND owner_type = $2
          AND owner_id = $3
          AND archived_at IS NULL
        LIMIT 1
        FOR UPDATE`,
      [normalizedSignatureId, normalizedOwnerType, normalizedOwnerId]
    );
    if (!existing.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const existingSignature = serializeSignatureRow(existing.rows[0]);
    const normalized = normalizeSignatureInput({
      signer_name: Object.prototype.hasOwnProperty.call(signature, 'signer_name') || Object.prototype.hasOwnProperty.call(signature, 'signed_by') ? (signature.signer_name ?? signature.signed_by) : existingSignature.signer_name,
      signer_role: Object.prototype.hasOwnProperty.call(signature, 'signer_role') || Object.prototype.hasOwnProperty.call(signature, 'signed_role') ? (signature.signer_role ?? signature.signed_role) : existingSignature.signer_role,
      signed_on: Object.prototype.hasOwnProperty.call(signature, 'signed_on') ? signature.signed_on : existingSignature.signed_on,
      signed_at: Object.prototype.hasOwnProperty.call(signature, 'signed_at') ? signature.signed_at : existingSignature.signed_at,
      signed_event_id: Object.prototype.hasOwnProperty.call(signature, 'signed_event_id') || Object.prototype.hasOwnProperty.call(signature, 'event_id') ? (signature.signed_event_id ?? signature.event_id) : existingSignature.signed_event_id,
      proof_path: Object.prototype.hasOwnProperty.call(signature, 'proof_path') || Object.prototype.hasOwnProperty.call(signature, 'signed_proof_path') ? (signature.proof_path ?? signature.signed_proof_path) : existingSignature.proof_path,
      notes: Object.prototype.hasOwnProperty.call(signature, 'notes') || Object.prototype.hasOwnProperty.call(signature, 'signature_notes') ? (signature.notes ?? signature.signature_notes) : existingSignature.notes
    });
    if (!normalized.hasDetails) {
      await client.query('ROLLBACK');
      return null;
    }
    if (isPrimary === true) {
      await client.query(
        `UPDATE signature_records
            SET is_primary = FALSE,
                updated_at = CURRENT_TIMESTAMP
          WHERE owner_type = $1
            AND owner_id = $2
            AND archived_at IS NULL
            AND id <> $3`,
        [normalizedOwnerType, normalizedOwnerId, normalizedSignatureId]
      );
    }
    const updated = await client.query(
      `UPDATE signature_records
          SET library_id = $4,
              space_id = $5,
              signer_name = $6,
              signer_role = $7,
              signed_on = $8,
              signed_at = $9,
              signed_event_id = $10,
              proof_path = $11,
              notes = $12,
              is_primary = CASE WHEN $13::boolean IS TRUE THEN TRUE ELSE is_primary END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND owner_type = $2
          AND owner_id = $3
          AND archived_at IS NULL
        RETURNING *`,
      [
        normalizedSignatureId,
        normalizedOwnerType,
        normalizedOwnerId,
        libraryId || existing.rows[0].library_id || null,
        spaceId || existing.rows[0].space_id || null,
        normalized.signer_name,
        normalized.signer_role,
        normalized.signed_on,
        normalized.signed_at,
        normalized.signed_event_id,
        normalized.proof_path,
        normalized.notes,
        isPrimary === true
      ]
    );
    await client.query('COMMIT');
    return serializeSignatureRow(updated.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function archiveSignatureRecord(pool, { ownerType, ownerId, signatureId }) {
  const normalizedOwnerType = normalizeOwnerType(ownerType);
  const normalizedOwnerId = Number(ownerId || 0);
  const normalizedSignatureId = Number(signatureId || 0);
  if (!Number.isFinite(normalizedOwnerId) || normalizedOwnerId <= 0) return null;
  if (!Number.isFinite(normalizedSignatureId) || normalizedSignatureId <= 0) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const archived = await client.query(
      `UPDATE signature_records
          SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
              is_primary = FALSE,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND owner_type = $2
          AND owner_id = $3
          AND archived_at IS NULL
        RETURNING *`,
      [normalizedSignatureId, normalizedOwnerType, normalizedOwnerId]
    );
    if (!archived.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const stillHasPrimary = await hasActivePrimarySignatureRecord(client, {
      ownerType: normalizedOwnerType,
      ownerId: normalizedOwnerId
    });
    if (!stillHasPrimary && await hasActiveSignatureRecords(client, {
      ownerType: normalizedOwnerType,
      ownerId: normalizedOwnerId
    })) {
      await client.query(
        `UPDATE signature_records
            SET is_primary = TRUE,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = (
            SELECT id
              FROM signature_records
             WHERE owner_type = $1
               AND owner_id = $2
               AND archived_at IS NULL
             ORDER BY signed_on DESC NULLS LAST, id DESC
             LIMIT 1
          )`,
        [normalizedOwnerType, normalizedOwnerId]
      );
    }
    await client.query('COMMIT');
    return serializeSignatureRow(archived.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function archiveSignatureRecordsForOwner(pool, { ownerType, ownerId }) {
  const normalizedOwnerType = normalizeOwnerType(ownerType);
  const normalizedOwnerId = Number(ownerId || 0);
  if (!Number.isFinite(normalizedOwnerId) || normalizedOwnerId <= 0) return [];
  const result = await pool.query(
    `UPDATE signature_records
        SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
            is_primary = FALSE,
            updated_at = CURRENT_TIMESTAMP
      WHERE owner_type = $1
        AND owner_id = $2
        AND archived_at IS NULL
      RETURNING *`,
    [normalizedOwnerType, normalizedOwnerId]
  );
  return (result.rows || []).map(serializeSignatureRow);
}

async function syncPrimarySignatureRecord(pool, {
  ownerType,
  ownerId,
  libraryId = null,
  spaceId = null,
  createdBy = null,
  signature = {},
  signed = false
}) {
  const normalizedOwnerType = normalizeOwnerType(ownerType);
  const normalizedOwnerId = Number(ownerId || 0);
  if (!Number.isFinite(normalizedOwnerId) || normalizedOwnerId <= 0) return null;
  const normalized = normalizeSignatureInput(signature);
  const shouldExist = Boolean(signed || normalized.hasDetails);
  if (!shouldExist) {
    await archiveSignatureRecordsForOwner(pool, { ownerType: normalizedOwnerType, ownerId: normalizedOwnerId });
    return null;
  }
  const result = await pool.query(
    `INSERT INTO signature_records (
       owner_type,
       owner_id,
       library_id,
       space_id,
       signer_name,
       signer_role,
       signed_on,
       signed_at,
       signed_event_id,
       proof_path,
       notes,
       is_primary,
       created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12)
     ON CONFLICT (owner_type, owner_id) WHERE is_primary = TRUE AND archived_at IS NULL
     DO UPDATE SET library_id = EXCLUDED.library_id,
                   space_id = EXCLUDED.space_id,
                   signer_name = EXCLUDED.signer_name,
                   signer_role = EXCLUDED.signer_role,
                   signed_on = EXCLUDED.signed_on,
                   signed_at = EXCLUDED.signed_at,
                   signed_event_id = EXCLUDED.signed_event_id,
                   proof_path = EXCLUDED.proof_path,
                   notes = EXCLUDED.notes,
                   updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      normalizedOwnerType,
      normalizedOwnerId,
      libraryId || null,
      spaceId || null,
      normalized.signer_name,
      normalized.signer_role,
      normalized.signed_on,
      normalized.signed_at,
      normalized.signed_event_id,
      normalized.proof_path,
      normalized.notes,
      createdBy || null
    ]
  );
  return serializeSignatureRow(result.rows[0]);
}

function buildLegacyMediaSignature(row = {}) {
  return normalizeSignatureInput({
    signed_by: row.signed_by,
    signed_role: row.signed_role,
    signed_on: row.signed_on,
    signed_at: row.signed_at,
    signed_proof_path: row.signed_proof_path
  });
}

module.exports = {
  normalizeSignatureInput,
  serializeSignatureRow,
  loadSignatureRecords,
  loadSignatureRecordsForOwner,
  createSignatureRecord,
  updateSignatureRecord,
  archiveSignatureRecord,
  archiveSignatureRecordsForOwner,
  setPrimarySignatureRecord,
  syncPrimarySignatureRecord,
  buildLegacyMediaSignature
};
