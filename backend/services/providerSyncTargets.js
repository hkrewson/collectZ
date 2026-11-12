'use strict';

const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new TypeError(`${label} is invalid`);
  return parsed;
}

function uuid(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new TypeError(`${label} is invalid`);
  return normalized;
}

function intervalMinutes(value) {
  const parsed = Number(value ?? 360);
  if (!Number.isInteger(parsed) || parsed < 60 || parsed > 10080) {
    throw new TypeError('Provider sync interval must be between 60 and 10080 minutes');
  }
  return parsed;
}

function shape(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    spaceId: Number(row.space_id),
    providerConnectionId: row.provider_connection_id,
    libraryId: Number(row.library_id),
    libraryName: row.library_name || null,
    providerType: row.provider_type || null,
    enabled: Boolean(row.enabled),
    intervalMinutes: Number(row.interval_minutes),
    lastEnqueuedAt: row.last_enqueued_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function createProviderSyncTargetStore({ pool } = {}) {
  if (!pool) throw new TypeError('Provider sync target store requires a database pool');

  async function scoped(spaceIdValue, actorIdValue, work) {
    const spaceId = positiveInteger(spaceIdValue, 'Workspace');
    const actorId = positiveInteger(actorIdValue, 'Actor');
    return withAuthorizedScopeTransaction(pool, { spaceId }, actorId, work);
  }

  async function list({ spaceId, actorId, connectionId = null } = {}) {
    const normalizedConnectionId = connectionId ? uuid(connectionId, 'Provider connection') : null;
    return scoped(spaceId, actorId, async (client) => {
      const result = await client.query(
        `SELECT t.*, l.name AS library_name, c.provider_type
           FROM provider_sync_targets t
           JOIN libraries l ON l.space_id = t.space_id AND l.id = t.library_id
           JOIN provider_connections c ON c.space_id = t.space_id AND c.id = t.provider_connection_id
          WHERE t.space_id = $1
            AND ($2::uuid IS NULL OR t.provider_connection_id = $2)
          ORDER BY c.display_name, l.name, t.id`,
        [spaceId, normalizedConnectionId]
      );
      return result.rows.map(shape);
    });
  }

  async function configureSingle({
    spaceId,
    actorId,
    connectionId,
    libraryId,
    enabled = false,
    syncIntervalMinutes = 360
  } = {}) {
    const normalizedConnectionId = uuid(connectionId, 'Provider connection');
    const normalizedLibraryId = positiveInteger(libraryId, 'Library');
    const normalizedInterval = intervalMinutes(syncIntervalMinutes);
    return scoped(spaceId, actorId, async (client) => {
      const result = await client.query(
        `INSERT INTO provider_sync_targets
           (space_id, provider_connection_id, library_id, enabled, interval_minutes, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (provider_connection_id) DO UPDATE
           SET library_id = EXCLUDED.library_id,
               enabled = EXCLUDED.enabled,
               interval_minutes = EXCLUDED.interval_minutes,
               updated_by = EXCLUDED.updated_by
         RETURNING *`,
        [spaceId, normalizedConnectionId, normalizedLibraryId, Boolean(enabled), normalizedInterval, actorId]
      );
      return shape(result.rows[0]);
    });
  }

  async function listDue({ spaceId, actorId, providerType, now = new Date() } = {}) {
    const normalizedProvider = String(providerType || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{1,79}$/.test(normalizedProvider)) throw new TypeError('Provider type is invalid');
    return scoped(spaceId, actorId, async (client) => {
      const result = await client.query(
        `SELECT t.*, l.name AS library_name, c.provider_type
           FROM provider_sync_targets t
           JOIN libraries l ON l.space_id = t.space_id AND l.id = t.library_id
           JOIN provider_connections c ON c.space_id = t.space_id AND c.id = t.provider_connection_id
          WHERE t.space_id = $1
            AND t.enabled = true
            AND c.provider_type = $2
            AND c.status = 'active'
            AND (t.last_enqueued_at IS NULL OR t.last_enqueued_at + (t.interval_minutes * INTERVAL '1 minute') <= $3::timestamptz)
          ORDER BY COALESCE(t.last_enqueued_at, '-infinity'::timestamptz), t.id`,
        [spaceId, normalizedProvider, now]
      );
      return result.rows.map(shape);
    });
  }

  async function markEnqueued({ spaceId, actorId, targetId, at = new Date() } = {}) {
    const normalizedTargetId = uuid(targetId, 'Provider sync target');
    return scoped(spaceId, actorId, async (client) => {
      const result = await client.query(
        `UPDATE provider_sync_targets
            SET last_enqueued_at = $3, updated_by = $4
          WHERE space_id = $1 AND id = $2
          RETURNING *`,
        [spaceId, normalizedTargetId, at, actorId]
      );
      return shape(result.rows[0]);
    });
  }

  return Object.freeze({ list, configureSingle, listDue, markEnqueued });
}

module.exports = { createProviderSyncTargetStore, intervalMinutes, shape };
