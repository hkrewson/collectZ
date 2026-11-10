'use strict';

const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');
const { normalizeTrustedConnectorHttpUrl } = require('./outboundUrlPolicy');

const METRON_INTEGRATION_KEY = 'comics.metron';

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 2147483647) {
    const error = new Error(`${label} is invalid`);
    error.code = 'INVALID_PROVIDER_INTEGRATION_BINDING';
    throw error;
  }
  return parsed;
}

function metronEndpoint(value) {
  const normalized = normalizeTrustedConnectorHttpUrl(value);
  if (!normalized) {
    const error = new Error('Metron endpoint must be an HTTP URL without credentials');
    error.code = 'INVALID_PROVIDER_INTEGRATION_BINDING';
    throw error;
  }
  return normalized;
}

function publicBinding(row) {
  if (!row) return null;
  return Object.freeze({
    spaceId: Number(row.space_id),
    integrationKey: row.integration_key,
    providerConnectionId: row.provider_connection_id,
    providerType: row.provider_type,
    status: row.status,
    endpointUrl: row.endpoint_url
  });
}

function createProviderIntegrationBindingService({ pool } = {}) {
  if (!pool) throw new TypeError('Provider integration binding service requires a pool');

  async function ensureMetronBinding({ spaceId, actorId, endpointUrl } = {}, transactionClient = null) {
    const workspaceId = positiveInteger(spaceId, 'Workspace');
    const userId = positiveInteger(actorId, 'Actor');
    const endpoint = metronEndpoint(endpointUrl);
    const work = async (client) => {
      await client.query(
        'SELECT pg_advisory_xact_lock($1, hashtext($2))',
        [workspaceId, METRON_INTEGRATION_KEY]
      );
      const existing = await client.query(
        `SELECT b.space_id, b.integration_key, b.provider_connection_id,
                c.provider_type, c.status, c.endpoint_url
           FROM provider_integration_bindings b
           JOIN provider_connections c
             ON c.space_id = b.space_id AND c.id = b.provider_connection_id
          WHERE b.space_id = $1 AND b.integration_key = $2
          FOR UPDATE OF b, c`,
        [workspaceId, METRON_INTEGRATION_KEY]
      );
      const bound = existing.rows[0];
      if (bound) {
        if (bound.provider_type !== 'metron') {
          const error = new Error('Metron integration binding points to a different provider type');
          error.code = 'PROVIDER_INTEGRATION_BINDING_CONFLICT';
          error.status = 409;
          throw error;
        }
        if (bound.status !== 'active') {
          const error = new Error('The bound Metron provider connection is not active');
          error.code = 'PROVIDER_CONNECTION_INACTIVE';
          error.status = 409;
          throw error;
        }
        if (bound.endpoint_url !== endpoint) {
          const updated = await client.query(
            `UPDATE provider_connections
                SET endpoint_url = $3
              WHERE space_id = $1 AND id = $2
              RETURNING provider_type, status, endpoint_url`,
            [workspaceId, bound.provider_connection_id, endpoint]
          );
          Object.assign(bound, updated.rows[0]);
        }
        return publicBinding(bound);
      }

      const connection = await client.query(
        `INSERT INTO provider_connections
           (space_id, provider_type, display_name, endpoint_url, settings, created_by)
         VALUES ($1, 'metron', 'Metron comics', $2, '{"integrationSlot":"comics"}'::jsonb, $3)
         RETURNING id, provider_type, status, endpoint_url`,
        [workspaceId, endpoint, userId]
      );
      const created = connection.rows[0];
      const binding = await client.query(
        `INSERT INTO provider_integration_bindings
           (space_id, integration_key, provider_connection_id, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING space_id, integration_key, provider_connection_id`,
        [workspaceId, METRON_INTEGRATION_KEY, created.id, userId]
      );
      return publicBinding({ ...binding.rows[0], ...created });
    };

    if (transactionClient) {
      if (typeof transactionClient.query !== 'function') {
        throw new TypeError('Transaction client must provide query()');
      }
      return work(transactionClient);
    }
    return withAuthorizedScopeTransaction(pool, { spaceId: workspaceId }, userId, work);
  }

  return Object.freeze({ ensureMetronBinding });
}

module.exports = {
  METRON_INTEGRATION_KEY,
  createProviderIntegrationBindingService,
  publicBinding
};
