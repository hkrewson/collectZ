'use strict';

const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');
const { normalizeTrustedConnectorHttpUrl } = require('./outboundUrlPolicy');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function connectionUuid(value) {
  const normalized = String(value || '').trim();
  if (!UUID_PATTERN.test(normalized)) {
    const error = new Error('Provider connection id is invalid');
    error.code = 'INVALID_PROVIDER_CONNECTION_INPUT';
    error.status = 400;
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
    archivedAt: row.archived_at,
    credentialsConfigured: Boolean(row.credentials_configured)
  };
}

function createProviderConnectionService({ pool, adapterRegistry, encrypt, decrypt } = {}) {
  if (!pool || !adapterRegistry) throw new TypeError('Provider connection service requires a pool and adapter registry');
  const encryptValue = encrypt || ((value) => require('./crypto').encryptSecret(value));
  const decryptValue = decrypt || ((value) => require('./crypto').decryptSecret(value, 'provider connection credentials'));

  async function withCredentialState(client, row) {
    if (!row) return null;
    if (row.credentials_configured !== undefined) return row;
    const result = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM provider_connection_credentials
          WHERE space_id = $1 AND provider_connection_id = $2
       ) AS credentials_configured`,
      [row.space_id, row.id]
    );
    return { ...row, credentials_configured: Boolean(result.rows[0]?.credentials_configured) };
  }

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
      return publicConnection({ ...connection, credentials_configured: Boolean(validatedCredentials) });
    });
  }

  async function list({ spaceId, actorId, includeArchived = false, providerType = null } = {}) {
    const normalizedProviderType = providerType === null || providerType === undefined
      ? null
      : adapterRegistry.get(providerType).providerType;
    return scoped(spaceId, actorId, async (client) => {
      const result = await client.query(
        `SELECT c.*,
                EXISTS (
                  SELECT 1 FROM provider_connection_credentials cc
                   WHERE cc.space_id = c.space_id AND cc.provider_connection_id = c.id
                ) AS credentials_configured
           FROM provider_connections c
          WHERE c.space_id = $1
            AND ($2::boolean OR c.status <> 'archived')
            AND ($3::text IS NULL OR c.provider_type = $3)
          ORDER BY c.provider_type, c.display_name, c.id`,
        [spaceId, Boolean(includeArchived), normalizedProviderType]
      );
      return result.rows.map(publicConnection);
    });
  }

  async function get({ spaceId, actorId, connectionId } = {}) {
    const id = connectionUuid(connectionId);
    return scoped(spaceId, actorId, async (client) => {
      const result = await client.query(
        'SELECT * FROM provider_connections WHERE space_id = $1 AND id = $2',
        [spaceId, id]
      );
      return publicConnection(await withCredentialState(client, result.rows[0]));
    });
  }

  async function update({ spaceId, actorId, connectionId, name, endpoint, settings } = {}) {
    const id = connectionUuid(connectionId);
    return scoped(spaceId, actorId, async (client) => {
      const currentResult = await client.query(
        'SELECT * FROM provider_connections WHERE space_id = $1 AND id = $2 FOR UPDATE',
        [spaceId, id]
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
        [spaceId, id, name === undefined ? current.display_name : displayName(name),
          endpoint === undefined ? current.endpoint_url : endpointUrl(endpoint), JSON.stringify(nextSettings)]
      );
      return publicConnection(await withCredentialState(client, result.rows[0]));
    });
  }

  async function setLifecycle({ spaceId, actorId, connectionId, status } = {}) {
    const id = connectionUuid(connectionId);
    const nextStatus = String(status || '').trim().toLowerCase();
    if (!['active', 'disabled', 'archived'].includes(nextStatus)) {
      const error = new Error('Provider connection status is invalid');
      error.code = 'INVALID_PROVIDER_CONNECTION_STATUS';
      throw error;
    }
    return scoped(spaceId, actorId, async (client) => {
      const result = await client.query(
        `UPDATE provider_connections
            SET status = $3::varchar,
                disabled_at = CASE WHEN $3::varchar = 'disabled' THEN CURRENT_TIMESTAMP ELSE NULL END,
                archived_at = CASE WHEN $3::varchar = 'archived' THEN CURRENT_TIMESTAMP ELSE NULL END
          WHERE space_id = $1 AND id = $2
          RETURNING *`,
        [spaceId, id, nextStatus]
      );
      return publicConnection(await withCredentialState(client, result.rows[0]));
    });
  }

  async function setCredentials({ spaceId, actorId, connectionId, credentials } = {}) {
    const id = connectionUuid(connectionId);
    return scoped(spaceId, actorId, async (client) => {
      const current = await client.query(
        'SELECT provider_type FROM provider_connections WHERE space_id = $1 AND id = $2 FOR UPDATE',
        [spaceId, id]
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
        [id, spaceId, encrypted, actorId]
      );
      return true;
    });
  }

  async function loadRuntime({ spaceId, actorId, connectionId, providerType } = {}) {
    const id = connectionUuid(connectionId);
    const expectedProviderType = adapterRegistry.get(providerType).providerType;
    return scoped(spaceId, actorId, async (client) => {
      const result = await client.query(
        `SELECT c.*, cc.secret_payload_encrypted,
                (cc.provider_connection_id IS NOT NULL) AS credentials_configured
           FROM provider_connections c
           LEFT JOIN provider_connection_credentials cc
             ON cc.space_id = c.space_id AND cc.provider_connection_id = c.id
          WHERE c.space_id = $1 AND c.id = $2`,
        [spaceId, id]
      );
      const row = result.rows[0];
      if (!row || row.provider_type !== expectedProviderType) {
        const error = new Error('Provider connection was not found');
        error.code = 'PROVIDER_CONNECTION_NOT_FOUND';
        error.status = 404;
        throw error;
      }
      if (row.status !== 'active') {
        const error = new Error('Provider connection is not active');
        error.code = 'PROVIDER_CONNECTION_INACTIVE';
        error.status = 409;
        throw error;
      }
      if (!row.endpoint_url) {
        const error = new Error('Provider connection endpoint is not configured');
        error.code = 'PROVIDER_CONNECTION_INCOMPLETE';
        error.status = 409;
        throw error;
      }
      if (!row.secret_payload_encrypted) {
        const error = new Error('Provider connection credentials are not configured');
        error.code = 'PROVIDER_CONNECTION_INCOMPLETE';
        error.status = 409;
        throw error;
      }
      let settings;
      let credentials;
      try {
        const decrypted = JSON.parse(decryptValue(row.secret_payload_encrypted));
        settings = adapterRegistry.validateSettings(expectedProviderType, row.settings || {}).settings;
        credentials = adapterRegistry.validateCredentials(expectedProviderType, decrypted).credentials;
      } catch {
        const error = new Error('Provider connection runtime configuration could not be loaded');
        error.code = 'PROVIDER_CONNECTION_RUNTIME_UNAVAILABLE';
        error.status = 409;
        throw error;
      }
      return Object.freeze({
        connection: Object.freeze(publicConnection(row)),
        settings: Object.freeze(settings),
        credentials: Object.freeze(credentials)
      });
    });
  }

  return Object.freeze({ create, list, get, update, setLifecycle, setCredentials, loadRuntime });
}

module.exports = { createProviderConnectionService, publicConnection };
