#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const pool = require('../db/pool');
const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');
const { createProviderIntegrationBindingService } = require('../services/providerIntegrationBindings');

const ROLLBACK_PROBE = 'PROVIDER_BINDING_SMOKE_ROLLBACK';

async function bindingCount(spaceId, actorId) {
  return withAuthorizedScopeTransaction(pool, { spaceId }, actorId, async (client) => {
    const result = await client.query(
      'SELECT COUNT(*)::int AS count FROM provider_integration_bindings WHERE space_id = $1',
      [spaceId]
    );
    return result.rows[0].count;
  });
}

async function main() {
  const fixture = await pool.query(
    `SELECT ai.space_id, u.id AS actor_id
       FROM app_integrations ai
       CROSS JOIN LATERAL (SELECT id FROM users ORDER BY id LIMIT 1) u
      WHERE ai.space_id IS NOT NULL
      ORDER BY ai.space_id
      LIMIT 1`
  );
  assert(fixture.rows[0], 'Provider binding smoke requires one retained workspace integration row and actor');
  const spaceId = Number(fixture.rows[0].space_id);
  const actorId = Number(fixture.rows[0].actor_id);
  const before = await bindingCount(spaceId, actorId);
  const service = createProviderIntegrationBindingService({ pool });

  await assert.rejects(
    withAuthorizedScopeTransaction(pool, { spaceId }, actorId, async (client) => {
      const first = await service.ensureMetronBinding({
        spaceId,
        actorId,
        endpointUrl: 'https://metron.invalid/api'
      }, client);
      const second = await service.ensureMetronBinding({
        spaceId,
        actorId,
        endpointUrl: 'https://metron.invalid/v2/'
      }, client);
      assert.equal(second.providerConnectionId, first.providerConnectionId);
      assert.equal(second.endpointUrl, 'https://metron.invalid/v2');
      const cwaFirst = await service.ensureCwaBinding({
        spaceId,
        actorId,
        endpointUrl: 'https://cwa.invalid/opds'
      }, client);
      const cwaSecond = await service.ensureCwaBinding({
        spaceId,
        actorId,
        endpointUrl: 'https://cwa.invalid/opds/v2/'
      }, client);
      assert.equal(cwaSecond.providerConnectionId, cwaFirst.providerConnectionId);
      assert.equal(cwaSecond.endpointUrl, 'https://cwa.invalid/opds/v2');
      const rows = await client.query(
        `SELECT b.provider_connection_id, c.provider_type, c.endpoint_url
           FROM provider_integration_bindings b
           JOIN provider_connections c
             ON c.space_id = b.space_id AND c.id = b.provider_connection_id
          WHERE b.space_id = $1 AND b.integration_key = 'comics.metron'`,
        [spaceId]
      );
      assert.equal(rows.rowCount, 1);
      assert.equal(rows.rows[0].provider_type, 'metron');
      assert.equal(rows.rows[0].endpoint_url, 'https://metron.invalid/v2');
      const cwaRows = await client.query(
        `SELECT b.provider_connection_id, c.provider_type, c.endpoint_url
           FROM provider_integration_bindings b
           JOIN provider_connections c
             ON c.space_id = b.space_id AND c.id = b.provider_connection_id
          WHERE b.space_id = $1 AND b.integration_key = 'books.cwa_opds'`,
        [spaceId]
      );
      assert.equal(cwaRows.rowCount, 1);
      assert.equal(cwaRows.rows[0].provider_type, 'cwa');
      assert.equal(cwaRows.rows[0].endpoint_url, 'https://cwa.invalid/opds/v2');
      throw new Error(ROLLBACK_PROBE);
    }),
    (error) => error.message === ROLLBACK_PROBE
  );

  const after = await bindingCount(spaceId, actorId);
  assert.equal(after, before, 'Rollback-only binding smoke changed retained provider state');
  console.log('Provider integration binding smoke passed with stable UUID reuse and rollback-safe retained state.');
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
