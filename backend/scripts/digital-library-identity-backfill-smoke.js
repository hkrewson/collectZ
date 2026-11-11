#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const pool = require('../db/pool');
const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');
const { createProviderAdapterRegistry } = require('../services/providerAdapterRegistry');
const { cwaAdapter } = require('../services/cwaIdentity');
const { kavitaAdapter } = require('../services/kavitaIdentity');
const { createExternalMediaIdentityService } = require('../services/externalMediaIdentities');
const { createProviderIdentityBackfillPlanner } = require('../services/providerIdentityBackfillPlanner');
const { createProviderIdentityBackfill } = require('../services/providerIdentityBackfill');

const ROLLBACK = 'DIGITAL_LIBRARY_IDENTITY_BACKFILL_SMOKE_ROLLBACK';

async function fixtureScope() {
  const result = await pool.query(
    `SELECT u.id AS actor_id, l.space_id, l.id AS library_id
       FROM users u
       JOIN library_memberships lm ON lm.user_id = u.id
       JOIN libraries l ON l.id = lm.library_id
      WHERE l.archived_at IS NULL
        AND NOT EXISTS (
          SELECT 1
            FROM media m
            LEFT JOIN media_metadata mm ON mm.media_id = m.id
           WHERE m.space_id = l.space_id
             AND (
               COALESCE(m.type_details, '{}'::jsonb) ?| ARRAY[
                 'provider_item_id', 'provider_issue_id', 'calibre_entry_id', 'metron_issue_id',
                 'plex_guid', 'plex_item_key', 'kavita_series_provider_item_id',
                 'kavita_chapter_provider_item_id'
               ]::text[]
               OR mm."key" IN (
                 'provider_item_id', 'provider_issue_id', 'calibre_entry_id', 'metron_issue_id',
                 'plex_guid', 'plex_item_key', 'kavita_series_provider_item_id',
                 'kavita_chapter_provider_item_id'
               )
             )
        )
      ORDER BY u.id, l.id
      LIMIT 1`
  );
  assert(result.rows[0], 'Digital-library identity backfill smoke requires one retained empty workspace library member');
  return {
    actorId: Number(result.rows[0].actor_id),
    spaceId: Number(result.rows[0].space_id),
    libraryId: Number(result.rows[0].library_id)
  };
}

async function retainedCounts(scope) {
  return withAuthorizedScopeTransaction(pool, { spaceId: scope.spaceId }, scope.actorId, async (client) => {
    const result = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM provider_connections WHERE space_id = $1) AS connections,
         (SELECT COUNT(*)::int FROM provider_integration_bindings WHERE space_id = $1) AS bindings,
         (SELECT COUNT(*)::int FROM media WHERE space_id = $1) AS media,
         (SELECT COUNT(*)::int FROM external_media_identities WHERE space_id = $1) AS identities,
         (SELECT COUNT(*)::int FROM external_media_identity_events WHERE space_id = $1) AS events`,
      [scope.spaceId]
    );
    return result.rows[0];
  });
}

async function main() {
  const scope = await fixtureScope();
  const before = await retainedCounts(scope);
  const adapterRegistry = createProviderAdapterRegistry({ cwa: cwaAdapter, kavita: kavitaAdapter });
  const identityService = createExternalMediaIdentityService({ pool, adapterRegistry });
  const planner = createProviderIdentityBackfillPlanner({ adapterRegistry });
  const backfill = createProviderIdentityBackfill({ identityService, planner });

  await assert.rejects(
    withAuthorizedScopeTransaction(pool, { spaceId: scope.spaceId }, scope.actorId, async (client) => {
      const connections = (await client.query(
        `INSERT INTO provider_connections
           (space_id, provider_type, display_name, endpoint_url, settings, status, created_by)
         VALUES
           ($1, 'cwa', 'Bound CWA backfill smoke', 'https://cwa.invalid/opds', '{"integrationSlot":"cwa_opds"}', 'active', $2),
           ($1, 'cwa', 'Unbound CWA backfill smoke', 'https://other-cwa.invalid/opds', '{"integrationSlot":"cwa_opds"}', 'active', $2),
           ($1, 'kavita', 'Bound Kavita backfill smoke', 'https://kavita.invalid', '{"integrationSlot":"kavita"}', 'active', $2),
           ($1, 'kavita', 'Unbound Kavita backfill smoke', 'https://other-kavita.invalid', '{"integrationSlot":"kavita"}', 'active', $2)
         RETURNING id, provider_type, display_name`,
        [scope.spaceId, scope.actorId]
      )).rows;
      const cwa = connections.find(({ display_name }) => display_name.startsWith('Bound CWA'));
      const kavita = connections.find(({ display_name }) => display_name.startsWith('Bound Kavita'));
      assert(cwa && kavita);

      await client.query(
        `INSERT INTO provider_integration_bindings
           (space_id, integration_key, provider_connection_id, created_by)
         VALUES ($1, 'books.cwa_opds', $2, $4), ($1, 'books.kavita', $3, $4)`,
        [scope.spaceId, cwa.id, kavita.id, scope.actorId]
      );
      await client.query(
        `INSERT INTO media
           (title, media_type, format, library_id, space_id, added_by, import_source, type_details)
         VALUES
           ('CWA historical identity smoke', 'book', 'Digital', $1, $2, $3, 'cwa_opds',
            '{"provider_name":"cwa_opds","provider_item_id":"42","calibre_entry_id":"42"}'),
           ('Kavita historical series identity smoke', 'book', 'Digital', $1, $2, $3, 'kavita',
            '{"provider_name":"kavita","provider_item_id":"kavita:series:42","kavita_series_provider_item_id":"kavita:series:42"}'),
           ('Kavita historical chapter identity smoke', 'comic_book', 'Digital', $1, $2, $3, 'kavita',
            '{"provider_name":"kavita","provider_item_id":"kavita:chapter:42","provider_issue_id":"kavita:chapter:42","kavita_chapter_provider_item_id":"kavita:chapter:42","kavita_series_provider_item_id":"kavita:series:7"}')`,
        [scope.libraryId, scope.spaceId, scope.actorId]
      );

      const planned = await backfill.run({
        spaceId: scope.spaceId,
        actorId: scope.actorId,
        mode: 'plan',
        transactionClient: client
      });
      assert.equal(planned.summary.planned, 3);
      assert.equal(planned.summary.reviewRequired, 0);
      assert.equal(JSON.stringify(planned).includes('kavita:chapter:42'), false);
      assert.equal(JSON.stringify(planned).includes('kavita:series:42'), false);

      await client.query(
        `DELETE FROM provider_integration_bindings
          WHERE space_id = $1 AND integration_key IN ('books.cwa_opds', 'books.kavita')`,
        [scope.spaceId]
      );
      const ambiguous = await backfill.run({
        spaceId: scope.spaceId,
        actorId: scope.actorId,
        mode: 'plan',
        transactionClient: client
      });
      assert.equal(ambiguous.summary.planned, 0);
      assert.equal(ambiguous.summary.diagnosticCounts.provider_connection_ambiguous, 3);
      await client.query(
        `INSERT INTO provider_integration_bindings
           (space_id, integration_key, provider_connection_id, created_by)
         VALUES ($1, 'books.cwa_opds', $2, $4), ($1, 'books.kavita', $3, $4)`,
        [scope.spaceId, cwa.id, kavita.id, scope.actorId]
      );

      const applied = await backfill.run({
        spaceId: scope.spaceId,
        actorId: scope.actorId,
        mode: 'apply',
        transactionClient: client
      });
      assert.equal(applied.summary.applied, 3);
      const identities = (await client.query(
        `SELECT provider_connection_id, identity_kind, external_id_normalized
           FROM external_media_identities
          WHERE space_id = $1 AND active
            AND provider_connection_id IN ($2, $3)
          ORDER BY provider_connection_id, identity_kind`,
        [scope.spaceId, cwa.id, kavita.id]
      )).rows;
      assert.equal(identities.length, 3);
      assert.deepEqual(
        identities.map(({ identity_kind, external_id_normalized }) => [identity_kind, external_id_normalized]).sort(),
        [['book', '42'], ['chapter', '42'], ['series', '42']]
      );

      const rerun = await backfill.run({
        spaceId: scope.spaceId,
        actorId: scope.actorId,
        mode: 'apply',
        transactionClient: client
      });
      assert.equal(rerun.summary.applied, 0);
      assert.equal(rerun.summary.aligned, 3);
      throw new Error(ROLLBACK);
    }),
    (error) => error.message === ROLLBACK
  );

  const after = await retainedCounts(scope);
  assert.deepEqual(after, before, 'Rollback-only digital-library backfill smoke changed retained state');
  console.log('Digital-library identity backfill smoke passed binding selection, ambiguity refusal, redaction, idempotency, and rollback restoration.');
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
