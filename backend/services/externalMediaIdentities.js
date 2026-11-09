'use strict';

const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');
const { normalizeTrustedConnectorHttpUrl } = require('./outboundUrlPolicy');

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 2147483647) {
    const error = new Error(`${label} is invalid`);
    error.code = 'INVALID_EXTERNAL_IDENTITY_INPUT';
    throw error;
  }
  return parsed;
}

function safeSourceUrl(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const normalized = normalizeTrustedConnectorHttpUrl(value);
  if (!normalized) {
    const error = new Error('Identity source URL must be HTTP without credentials');
    error.code = 'INVALID_EXTERNAL_IDENTITY_INPUT';
    throw error;
  }
  return normalized;
}

function publicIdentity(row) {
  if (!row) return null;
  return {
    id: row.id,
    spaceId: row.space_id,
    providerConnectionId: row.provider_connection_id,
    identityKind: row.identity_kind,
    externalId: row.external_id_raw,
    mediaId: row.media_id,
    sourceUrl: row.source_url,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    active: row.active,
    deactivatedAt: row.deactivated_at
  };
}

function conflictError() {
  const error = new Error('External identity is already attached to another canonical object');
  error.code = 'EXTERNAL_IDENTITY_CONFLICT';
  error.status = 409;
  return error;
}

async function identityEvent(client, {
  spaceId,
  identityId,
  type,
  fromMediaId,
  toMediaId,
  actorId,
  details = {}
}) {
  await client.query(
    `INSERT INTO external_media_identity_events
       (space_id, identity_id, event_type, from_media_id, to_media_id,
        from_media_public_id, to_media_public_id, actor_user_id, details)
     VALUES (
       $1, $2, $3, $4, $5,
       (SELECT public_id FROM media WHERE id = $4 AND space_id = $1),
       (SELECT public_id FROM media WHERE id = $5 AND space_id = $1),
       $6, $7::jsonb
     )`,
    [
      positiveInteger(spaceId, 'Workspace'),
      identityId,
      type,
      fromMediaId ?? null,
      toMediaId ?? null,
      positiveInteger(actorId, 'Actor'),
      JSON.stringify(details && typeof details === 'object' ? details : {})
    ]
  );
}

async function reassignMediaIdentitiesForMerge(client, {
  spaceId,
  actorId,
  fromMediaId,
  toMediaId
} = {}) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('External identity merge reassignment requires a transaction client');
  }
  const workspaceId = positiveInteger(spaceId, 'Workspace');
  const userId = positiveInteger(actorId, 'Actor');
  const sourceMediaId = positiveInteger(fromMediaId, 'Source canonical object');
  const targetMediaId = positiveInteger(toMediaId, 'Target canonical object');
  if (sourceMediaId === targetMediaId) return [];

  const locked = await client.query(
    `SELECT * FROM external_media_identities
      WHERE space_id = $1 AND media_id = $2
      ORDER BY id
      FOR UPDATE`,
    [workspaceId, sourceMediaId]
  );
  const reassigned = [];
  for (const row of locked.rows || []) {
    const updated = await client.query(
      `UPDATE external_media_identities
          SET media_id = $3, updated_by = $4
        WHERE space_id = $1 AND id = $2 AND media_id = $5
        RETURNING *`,
      [workspaceId, row.id, targetMediaId, userId, sourceMediaId]
    );
    if (!updated.rows[0]) throw conflictError();
    await identityEvent(client, {
      spaceId: workspaceId,
      identityId: row.id,
      type: 'reassigned',
      fromMediaId: sourceMediaId,
      toMediaId: targetMediaId,
      actorId: userId,
      details: { reason: 'canonical_merge' }
    });
    reassigned.push(publicIdentity(updated.rows[0]));
  }
  return reassigned;
}

async function restoreMediaIdentitiesFromMerge(client, {
  spaceId,
  actorId,
  identityIds,
  fromMediaId,
  toMediaId
} = {}) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('External identity merge restoration requires a transaction client');
  }
  const workspaceId = positiveInteger(spaceId, 'Workspace');
  const userId = positiveInteger(actorId, 'Actor');
  const sourceMediaId = positiveInteger(fromMediaId, 'Source canonical object');
  const targetMediaId = positiveInteger(toMediaId, 'Target canonical object');
  const ids = Array.from(new Set((identityIds || []).map((value) => String(value || '').trim()).filter(Boolean)));
  if (ids.length === 0 || sourceMediaId === targetMediaId) return [];

  const locked = await client.query(
    `SELECT * FROM external_media_identities
      WHERE space_id = $1 AND id = ANY($2::uuid[])
      ORDER BY id
      FOR UPDATE`,
    [workspaceId, ids]
  );
  if ((locked.rows || []).length !== ids.length || locked.rows.some((row) => Number(row.media_id) !== sourceMediaId)) {
    const error = conflictError();
    error.message = 'External identity changed after merge and cannot be restored automatically';
    throw error;
  }

  const restored = [];
  for (const row of locked.rows) {
    const updated = await client.query(
      `UPDATE external_media_identities
          SET media_id = $3, updated_by = $4
        WHERE space_id = $1 AND id = $2 AND media_id = $5
        RETURNING *`,
      [workspaceId, row.id, targetMediaId, userId, sourceMediaId]
    );
    if (!updated.rows[0]) throw conflictError();
    await identityEvent(client, {
      spaceId: workspaceId,
      identityId: row.id,
      type: 'reassigned',
      fromMediaId: sourceMediaId,
      toMediaId: targetMediaId,
      actorId: userId,
      details: { reason: 'canonical_merge_revert' }
    });
    restored.push(publicIdentity(updated.rows[0]));
  }
  return restored;
}

function createExternalMediaIdentityService({ pool, adapterRegistry } = {}) {
  if (!pool || !adapterRegistry) throw new TypeError('External identity service requires a pool and adapter registry');

  async function scoped(spaceIdValue, actorIdValue, work) {
    const spaceId = positiveInteger(spaceIdValue, 'Workspace');
    const actorId = positiveInteger(actorIdValue, 'Actor');
    return withAuthorizedScopeTransaction(pool, { spaceId }, actorId, work);
  }

  async function connection(client, spaceId, connectionId, { requireActive = false } = {}) {
    const result = await client.query(
      `SELECT id, provider_type, status
         FROM provider_connections
        WHERE space_id = $1 AND id = $2`,
      [spaceId, connectionId]
    );
    const row = result.rows[0];
    if (!row) {
      const error = new Error('Provider connection was not found');
      error.code = 'PROVIDER_CONNECTION_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    if (requireActive && row.status !== 'active') {
      const error = new Error('Provider connection is not active');
      error.code = 'PROVIDER_CONNECTION_INACTIVE';
      error.status = 409;
      throw error;
    }
    return row;
  }

  async function normalizedIdentity(client, spaceId, connectionId, identityKind, externalId, options = {}) {
    const provider = await connection(client, spaceId, connectionId, options);
    return adapterRegistry.normalizeExternalId(provider.provider_type, identityKind, externalId);
  }

  async function resolve({ spaceId, actorId, connectionId, identityKind, externalId, includeInactive = false } = {}) {
    return scoped(spaceId, actorId, async (client) => {
      const identity = await normalizedIdentity(client, spaceId, connectionId, identityKind, externalId);
      const result = await client.query(
        `SELECT * FROM external_media_identities
          WHERE space_id = $1 AND provider_connection_id = $2
            AND identity_kind = $3 AND external_id_normalized = $4
            AND ($5::boolean OR active)
          ORDER BY active DESC, last_seen_at DESC, id
          LIMIT 1`,
        [spaceId, connectionId, identity.identityKind, identity.normalizedExternalId, Boolean(includeInactive)]
      );
      return publicIdentity(result.rows[0]);
    });
  }

  async function attach({ spaceId, actorId, connectionId, identityKind, externalId, mediaId, sourceUrl } = {}) {
    const targetMediaId = positiveInteger(mediaId, 'Canonical object');
    const normalizedSourceUrl = safeSourceUrl(sourceUrl);
    return scoped(spaceId, actorId, async (client) => {
      const identity = await normalizedIdentity(client, spaceId, connectionId, identityKind, externalId, { requireActive: true });
      const activeResult = await client.query(
        `SELECT * FROM external_media_identities
          WHERE space_id = $1 AND provider_connection_id = $2
            AND identity_kind = $3 AND external_id_normalized = $4 AND active
          FOR UPDATE`,
        [spaceId, connectionId, identity.identityKind, identity.normalizedExternalId]
      );
      const active = activeResult.rows[0];
      if (active) {
        if (Number(active.media_id) !== targetMediaId) throw conflictError();
        const observed = await client.query(
          `UPDATE external_media_identities
              SET last_seen_at = CURRENT_TIMESTAMP, source_url = COALESCE($3, source_url),
                  external_id_raw = $4, updated_by = $5
            WHERE space_id = $1 AND id = $2
            RETURNING *`,
          [spaceId, active.id, normalizedSourceUrl, identity.rawExternalId, actorId]
        );
        await identityEvent(client, { spaceId, identityId: active.id, type: 'observed', fromMediaId: targetMediaId, toMediaId: targetMediaId, actorId });
        return publicIdentity(observed.rows[0]);
      }

      const inactiveResult = await client.query(
        `SELECT * FROM external_media_identities
          WHERE space_id = $1 AND provider_connection_id = $2
            AND identity_kind = $3 AND external_id_normalized = $4 AND NOT active
          ORDER BY last_seen_at DESC, id LIMIT 1 FOR UPDATE`,
        [spaceId, connectionId, identity.identityKind, identity.normalizedExternalId]
      );
      const inactive = inactiveResult.rows[0];
      if (inactive) {
        try {
          const reactivated = await client.query(
            `UPDATE external_media_identities
                SET active = true, deactivated_at = NULL, media_id = $3,
                    last_seen_at = CURRENT_TIMESTAMP, source_url = COALESCE($4, source_url),
                    external_id_raw = $5, updated_by = $6
              WHERE space_id = $1 AND id = $2
              RETURNING *`,
            [spaceId, inactive.id, targetMediaId, normalizedSourceUrl, identity.rawExternalId, actorId]
          );
          await identityEvent(client, { spaceId, identityId: inactive.id, type: 'reactivated', fromMediaId: inactive.media_id, toMediaId: targetMediaId, actorId });
          return publicIdentity(reactivated.rows[0]);
        } catch (error) {
          if (error.code === '23505') throw conflictError();
          throw error;
        }
      }

      try {
        const inserted = await client.query(
          `INSERT INTO external_media_identities
             (space_id, provider_connection_id, identity_kind, external_id_raw,
              external_id_normalized, media_id, source_url, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
           ON CONFLICT (space_id, provider_connection_id, identity_kind, external_id_normalized)
             WHERE active DO NOTHING
           RETURNING *`,
          [spaceId, connectionId, identity.identityKind, identity.rawExternalId,
            identity.normalizedExternalId, targetMediaId, normalizedSourceUrl, actorId]
        );
        if (inserted.rows[0]) {
          await identityEvent(client, { spaceId, identityId: inserted.rows[0].id, type: 'attached', toMediaId: targetMediaId, actorId });
          return publicIdentity(inserted.rows[0]);
        }
        const winner = await client.query(
          `SELECT * FROM external_media_identities
            WHERE space_id = $1 AND provider_connection_id = $2
              AND identity_kind = $3 AND external_id_normalized = $4 AND active`,
          [spaceId, connectionId, identity.identityKind, identity.normalizedExternalId]
        );
        if (Number(winner.rows[0]?.media_id) !== targetMediaId) throw conflictError();
        return publicIdentity(winner.rows[0]);
      } catch (error) {
        if (error.code === '23505') throw conflictError();
        throw error;
      }
    });
  }

  async function listForMedia({ spaceId, actorId, mediaId, includeInactive = true } = {}) {
    const targetMediaId = positiveInteger(mediaId, 'Canonical object');
    return scoped(spaceId, actorId, async (client) => {
      const result = await client.query(
        `SELECT * FROM external_media_identities
          WHERE space_id = $1 AND media_id = $2 AND ($3::boolean OR active)
          ORDER BY active DESC, provider_connection_id, identity_kind, first_seen_at`,
        [spaceId, targetMediaId, Boolean(includeInactive)]
      );
      return result.rows.map(publicIdentity);
    });
  }

  async function deactivate({ spaceId, actorId, identityId } = {}) {
    return scoped(spaceId, actorId, async (client) => {
      const result = await client.query(
        `UPDATE external_media_identities
            SET active = false, deactivated_at = CURRENT_TIMESTAMP, updated_by = $3
          WHERE space_id = $1 AND id = $2 AND active
          RETURNING *`,
        [spaceId, identityId, actorId]
      );
      const row = result.rows[0];
      if (!row) return null;
      await identityEvent(client, { spaceId, identityId: row.id, type: 'deactivated', fromMediaId: row.media_id, actorId });
      return publicIdentity(row);
    });
  }

  async function reassign({ spaceId, actorId, identityId, mediaId } = {}) {
    const targetMediaId = positiveInteger(mediaId, 'Canonical object');
    return scoped(spaceId, actorId, async (client) => {
      const current = await client.query(
        'SELECT * FROM external_media_identities WHERE space_id = $1 AND id = $2 FOR UPDATE',
        [spaceId, identityId]
      );
      const row = current.rows[0];
      if (!row) return null;
      if (Number(row.media_id) === targetMediaId) return publicIdentity(row);
      const result = await client.query(
        `UPDATE external_media_identities
            SET media_id = $3, updated_by = $4
          WHERE space_id = $1 AND id = $2
          RETURNING *`,
        [spaceId, identityId, targetMediaId, actorId]
      );
      await identityEvent(client, { spaceId, identityId, type: 'reassigned', fromMediaId: row.media_id, toMediaId: targetMediaId, actorId });
      return publicIdentity(result.rows[0]);
    });
  }

  return Object.freeze({ resolve, attach, listForMedia, deactivate, reassign });
}

module.exports = {
  createExternalMediaIdentityService,
  publicIdentity,
  reassignMediaIdentitiesForMerge,
  restoreMediaIdentitiesFromMerge
};
