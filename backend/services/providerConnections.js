'use strict';

const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');
const { normalizeTrustedConnectorHttpUrl } = require('./outboundUrlPolicy');

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 2147483647) {
    const error = new Error(`${label} is invalid`);
    error.code = 'INVALID_PROVIDER_CONNECTION_INPUT';
    throw error;
  }
  return parsed;
}

function displayName(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 255) {
    const error = new Error('Provider connection display name is invalid');
    error.code = 'INVALID_PROVIDER_CONNECTION_INPUT';
    throw error;
  }
  return normalized;
}

function endpointUrl(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const normalized = normalizeTrustedConnectorHttpUrl(value);
  if (!normalized) {
    const error = new Error('Provider endpoint must be an HTTP URL without credentials');
    error.code = 'INVALID_PROVIDER_CONNECTION_INPUT';
    throw error;
  }
  return normalized;
}

function publicConnection(row) {
  if (!row) return null;
  return {
    id: row.id,
    spaceId: row.space_id,
    providerType: row.provider_type,
    displayName: row.display_name,
    endpointUrl: row.endpoint_url,
    status: row.status,
    settings: row.settings || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    disabledAt: row.disabled_at,
    archivedAt: row.archived_at
  };
}

function createProviderConnectionService({ pool, adapterRegistry, encrypt } = {}) {
  if (!pool || !adapterRegistry) throw new TypeError('Provider connection service requires a pool and adapter registry');
  const encryptValue = encrypt || ((value) => require('./crypto').encryptSecret(value));

  async function scoped(spaceIdValue, actorIdValue, work) {
    const spaceId = positiveInteger(spaceIdValue, 'Workspace');
    const actorId = positiveInteger(actorIdValue, 'Actor');
    return withAuthorizedScopeTransaction(pool, { spaceId }, actorId, work);
  }

  async function create({ spaceId, actorId, providerType, name, endpoint, settings = {}, credentials } = {}) {
    const validated = adapterRegistry.validateSettings(providerType, settings);
    const normalizedName = displayName(name);
    const normalizedEndpoint = endpointUrl(endpoint);
    const validatedCredentials = credentials === undefined
      ? null
      : adapterRegistry.validateCredentials(validated.providerType, credentials).credentials;
    return scoped(spaceId, actorId, async (client) => {
      const result = await client.query(
        `INSERT INTO provider_connections
           (space_id, provider_type, display_name, endpoint_url, settings, created_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         RETURNING *`,
        [spaceId, validated.providerType, normalizedName, normalizedEndpoint, JSON.stringify(validated.settings), actorId]
      );
      const connection = result.rows[0];
      if (validatedCredentials) {
        const encrypted = encryptValue(JSON.stringify(validatedCredentials));
        await client.query(
          `INSERT INTO provider_connection_credentials
             (provider_connection_id, space_id, secret_payload_encrypted, updated_by)
           VALUES ($1, $2, $3, $4)`,
          [connection.id, spaceId, encrypted, actorId]
        );
      }
      return publicConnection(connection);
    });
  }

  async function list({ spaceId, actorId, includeArchived = false } = {}) {
    return scoped(spaceId, actorId, async (client) => {
      const result = await client.query(
        `SELECT * FROM provider_connections
          WHERE space_id = $1 AND ($2::boolean OR status <> 'archived')
          ORDER BY provider_type, display_name, id`,
        [spaceId, Boolean(includeArchived)]
      );
      return result.rows.map(publicConnection);
    });
  }

  async function get({ spaceId, actorId, connectionId } = {}) {
    return scoped(spaceId, actorId, async (client) => {
      const result = await client.query(
        'SELECT * FROM provider_connections WHERE space_id = $1 AND id = $2',
        [spaceId, connectionId]
      );
      return publicConnection(result.rows[0]);
    });
  }

  async function update({ spaceId, actorId, connectionId, name, endpoint, settings } = {}) {
    return scoped(spaceId, actorId, async (client) => {
      const currentResult = await client.query(
        'SELECT * FROM provider_connections WHERE space_id = $1 AND id = $2 FOR UPDATE',
        [spaceId, connectionId]
      );
      const current = currentResult.rows[0];
      if (!current) return null;
      const nextSettings = settings === undefined
        ? current.settings
        : adapterRegistry.validateSettings(current.provider_type, settings).settings;
      const result = await client.query(
        `UPDATE provider_connections
            SET display_name = $3, endpoint_url = $4, settings = $5::jsonb
          WHERE space_id = $1 AND id = $2
          RETURNING *`,
        [spaceId, connectionId, name === undefined ? current.display_name : displayName(name),
          endpoint === undefined ? current.endpoint_url : endpointUrl(endpoint), JSON.stringify(nextSettings)]
      );
      return publicConnection(result.rows[0]);
    });
  }

  async function setLifecycle({ spaceId, actorId, connectionId, status } = {}) {
    const nextStatus = String(status || '').trim().toLowerCase();
    if (!['active', 'disabled', 'archived'].includes(nextStatus)) {
      const error = new Error('Provider connection status is invalid');
      error.code = 'INVALID_PROVIDER_CONNECTION_STATUS';
      throw error;
    }
    return scoped(spaceId, actorId, async (client) => {
      const result = await client.query(
        `UPDATE provider_connections
            SET status = $3,
                disabled_at = CASE WHEN $3 = 'disabled' THEN CURRENT_TIMESTAMP ELSE NULL END,
                archived_at = CASE WHEN $3 = 'archived' THEN CURRENT_TIMESTAMP ELSE NULL END
          WHERE space_id = $1 AND id = $2
          RETURNING *`,
        [spaceId, connectionId, nextStatus]
      );
      return publicConnection(result.rows[0]);
    });
  }

  async function setCredentials({ spaceId, actorId, connectionId, credentials } = {}) {
    return scoped(spaceId, actorId, async (client) => {
      const current = await client.query(
        'SELECT provider_type FROM provider_connections WHERE space_id = $1 AND id = $2 FOR UPDATE',
        [spaceId, connectionId]
      );
      if (!current.rows[0]) return false;
      const validated = adapterRegistry.validateCredentials(current.rows[0].provider_type, credentials).credentials;
      const encrypted = encryptValue(JSON.stringify(validated));
      await client.query(
        `INSERT INTO provider_connection_credentials
           (provider_connection_id, space_id, secret_payload_encrypted, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (provider_connection_id) DO UPDATE
           SET secret_payload_encrypted = EXCLUDED.secret_payload_encrypted,
               updated_by = EXCLUDED.updated_by`,
        [connectionId, spaceId, encrypted, actorId]
      );
      return true;
    });
  }

  return Object.freeze({ create, list, get, update, setLifecycle, setCredentials });
}

module.exports = { createProviderConnectionService, publicConnection };
