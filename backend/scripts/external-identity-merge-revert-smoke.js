#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const pool = require('../db/pool');
const { createProviderAdapterRegistry } = require('../services/providerAdapterRegistry');
const { createExternalMediaIdentityService } = require('../services/externalMediaIdentities');
const { setCanonicalFieldControl } = require('../services/canonicalMediaFieldControls');
const {
  mergeDuplicateIntoCanonical,
  revertDuplicateAttachIntoSeparateRow
} = require('./repair-book-comic-duplicates');

const adapterRegistry = createProviderAdapterRegistry({
  fixture: {
    validateSettings(settings = {}) { return settings; },
    validateCredentials(credentials = {}) { return credentials; },
    normalizeExternalId(kind, raw, normalizers) {
      return normalizers.exact(raw);
    }
  }
});
const identityService = createExternalMediaIdentityService({ pool, adapterRegistry });

async function loadFixtureScope() {
  const result = await pool.query(
    `SELECT u.id AS actor_id, l.space_id, l.id AS library_id
       FROM users u
       JOIN library_memberships lm ON lm.user_id = u.id
       JOIN libraries l ON l.id = lm.library_id
      WHERE l.archived_at IS NULL
      ORDER BY u.id, l.id
      LIMIT 1`
  );
  const row = result.rows[0];
  assert(row, 'External identity merge smoke requires one existing library member');
  return {
    actorId: Number(row.actor_id),
    spaceId: Number(row.space_id),
    libraryId: Number(row.library_id)
  };
}

async function main() {
  const scope = await loadFixtureScope();
  const rollback = new Error('external identity merge smoke rollback');
  rollback.smokeRollback = true;
  let evidence = null;

  try {
    await identityService.transaction({
      spaceId: scope.spaceId,
      libraryId: scope.libraryId,
      actorId: scope.actorId
    }, async ({ client, identities }) => {
      const connection = (await client.query(
        `INSERT INTO provider_connections (space_id, provider_type, display_name, status, created_by)
         VALUES ($1, 'fixture', 'Merge lifecycle smoke', 'active', $2)
         RETURNING id`,
        [scope.spaceId, scope.actorId]
      )).rows[0];
      const secondConnection = (await client.query(
        `INSERT INTO provider_connections (space_id, provider_type, display_name, status, created_by)
         VALUES ($1, 'fixture', 'Second merge lifecycle smoke', 'active', $2)
         RETURNING id`,
        [scope.spaceId, scope.actorId]
      )).rows[0];
      const media = (await client.query(
        `INSERT INTO media (title, media_type, format, library_id, space_id, added_by, import_source)
         VALUES
           ('Identity merge canonical', 'book', 'Digital', $1, $2, $3, 'identity_merge_smoke'),
           ('Identity merge duplicate', 'book', 'Digital', $1, $2, $3, 'identity_merge_smoke'),
           ('Identity second provider target', 'book', 'Digital', $1, $2, $3, 'identity_merge_smoke')
         RETURNING *`,
        [scope.libraryId, scope.spaceId, scope.actorId]
      )).rows;
      const canonical = media[0];
      const duplicate = media[1];
      const secondProviderTarget = media[2];
      const compatibility = {
        typeDetails: {
          provider_name: 'fixture',
          provider_item_id: 'fixture:merge:42'
        },
        metadata: {
          provider_item_id: 'fixture:merge:42'
        }
      };
      const firstReconciliation = await identities.reconcile({
        connectionId: connection.id,
        identityKind: 'book',
        externalId: 'fixture:merge:42',
        compatibility,
        canonicalFields: {
          'media.overview': 'Provider synopsis v1',
          'type_details.publisher': 'Provider Publisher'
        }
      }, async ({ resolvedMediaId }) => {
        assert.equal(resolvedMediaId, null);
        return { mediaId: duplicate.id };
      });
      assert.equal(firstReconciliation.matchedBy, 'canonical_candidate');
      assert.equal(firstReconciliation.compatibility.written, 3);
      assert.equal(firstReconciliation.canonicalFields.applied.length, 2);
      const repeatReconciliation = await identities.reconcile({
        connectionId: connection.id,
        identityKind: 'book',
        externalId: 'fixture:merge:42',
        compatibility,
        canonicalFields: {
          'media.overview': 'Provider synopsis v2',
          'type_details.publisher': 'Provider Publisher'
        }
      }, async ({ resolvedMediaId, matchedBy }) => {
        assert.equal(Number(resolvedMediaId), Number(duplicate.id));
        assert.equal(matchedBy, 'external_identity');
        return { mediaId: resolvedMediaId };
      });
      assert.equal(repeatReconciliation.matchedBy, 'external_identity');
      assert.equal(repeatReconciliation.compatibility.written, 0);
      assert.equal(repeatReconciliation.compatibility.aligned, 3);
      assert.deepEqual(repeatReconciliation.canonicalFields.applied, [
        { fieldPath: 'media.overview', action: 'refresh' }
      ]);
      assert.deepEqual(repeatReconciliation.canonicalFields.observed, [
        { fieldPath: 'type_details.publisher', reason: 'already_equal' }
      ]);
      await setCanonicalFieldControl(client, {
        spaceId: scope.spaceId,
        mediaId: duplicate.id,
        fieldPath: 'media.overview',
        authority: 'manual',
        providerWriteMode: 'preserve',
        locked: true,
        actorId: scope.actorId
      });
      const preservedReconciliation = await identities.reconcile({
        connectionId: connection.id,
        identityKind: 'book',
        externalId: 'fixture:merge:42',
        compatibility,
        canonicalFields: { 'media.overview': 'Provider synopsis v3' }
      }, async ({ resolvedMediaId }) => ({ mediaId: resolvedMediaId }));
      assert.deepEqual(preservedReconciliation.canonicalFields.skipped, [
        { fieldPath: 'media.overview', reason: 'locked' }
      ]);
      const preservedOverview = await client.query('SELECT overview FROM media WHERE id = $1', [duplicate.id]);
      assert.equal(preservedOverview.rows[0].overview, 'Provider synopsis v2');
      const identity = repeatReconciliation.identity;
      const secondProvider = await identities.reconcile({
        connectionId: secondConnection.id,
        identityKind: 'book',
        externalId: 'fixture:merge:42',
        compatibility
      }, async ({ resolvedMediaId }) => {
        assert.equal(resolvedMediaId, null);
        return { mediaId: secondProviderTarget.id };
      });
      assert.equal(Number(secondProvider.mediaId), Number(secondProviderTarget.id));
      assert.notEqual(secondProvider.identity.id, identity.id);

      await client.query('SAVEPOINT compatibility_conflict');
      let conflictCode = null;
      try {
        const conflictConnection = (await client.query(
          `INSERT INTO provider_connections (space_id, provider_type, display_name, status, created_by)
           VALUES ($1, 'fixture', 'Conflict merge lifecycle smoke', 'active', $2)
           RETURNING id`,
          [scope.spaceId, scope.actorId]
        )).rows[0];
        await identities.reconcile({
          connectionId: conflictConnection.id,
          identityKind: 'book',
          externalId: 'fixture:merge:conflict',
          compatibility: {
            typeDetails: {
              provider_name: 'fixture',
              provider_item_id: 'fixture:merge:conflict'
            },
            metadata: {
              provider_item_id: 'fixture:merge:conflict'
            }
          }
        }, async () => ({ mediaId: secondProviderTarget.id }));
      } catch (error) {
        conflictCode = error.code;
      }
      assert.equal(conflictCode, 'EXTERNAL_IDENTITY_COMPATIBILITY_CONFLICT');
      await client.query('ROLLBACK TO SAVEPOINT compatibility_conflict');
      const conflictingIdentityCount = await client.query(
        `SELECT COUNT(*)::int AS count
           FROM external_media_identities
          WHERE space_id = $1 AND external_id_normalized = 'fixture:merge:conflict'`,
        [scope.spaceId]
      );
      assert.equal(Number(conflictingIdentityCount.rows[0]?.count || 0), 0);

      const applied = await mergeDuplicateIntoCanonical(
        client,
        canonical,
        duplicate,
        { action: 'identity_merge_smoke' },
        scope.actorId
      );
      assert.equal(applied.reassignedExternalIdentities, 1);
      const afterMerge = (await client.query(
        `SELECT i.media_id, e.from_media_id, e.from_media_public_id, e.to_media_id, e.to_media_public_id
           FROM external_media_identities i
           JOIN external_media_identity_events e ON e.identity_id = i.id
          WHERE i.id = $1 AND e.event_type = 'reassigned'
          ORDER BY e.id DESC LIMIT 1`,
        [identity.id]
      )).rows[0];
      assert.equal(Number(afterMerge.media_id), Number(canonical.id));
      assert.equal(afterMerge.from_media_id, null);
      assert.equal(afterMerge.from_media_public_id, duplicate.public_id);
      assert.equal(Number(afterMerge.to_media_id), Number(canonical.id));
      assert.equal(afterMerge.to_media_public_id, canonical.public_id);

      const reverted = await revertDuplicateAttachIntoSeparateRow(
        client,
        canonical,
        duplicate.id,
        scope.actorId
      );
      assert.equal(reverted.restoredExternalIdentities, 1);
      const afterRevert = (await client.query(
        `SELECT i.media_id, m.public_id
           FROM external_media_identities i
           JOIN media m ON m.id = i.media_id
          WHERE i.id = $1`,
        [identity.id]
      )).rows[0];
      assert.equal(Number(afterRevert.media_id), Number(duplicate.id));
      assert.equal(afterRevert.public_id, duplicate.public_id);

      evidence = {
        mergeReassigned: applied.reassignedExternalIdentities,
        revertRestored: reverted.restoredExternalIdentities,
        deletedNumericReferenceCleared: afterMerge.from_media_id === null,
        immutablePublicReferenceRetained: afterMerge.from_media_public_id === duplicate.public_id,
        canonicalUuidRestored: afterRevert.public_id === duplicate.public_id,
        authoritativeRepeatMatch: repeatReconciliation.matchedBy === 'external_identity',
        compatibilityProjectionAligned: repeatReconciliation.compatibility.aligned === 3,
        providerInstanceIsolation: Number(secondProvider.mediaId) === Number(secondProviderTarget.id),
        projectionConflictRolledBack: Number(conflictingIdentityCount.rows[0]?.count || 0) === 0,
        providerFieldRefreshControlled: repeatReconciliation.canonicalFields.applied.length === 1,
        manualFieldLockPreserved: preservedOverview.rows[0].overview === 'Provider synopsis v2'
      };
      throw rollback;
    });
  } catch (error) {
    if (!error.smokeRollback) throw error;
  } finally {
    await pool.end().catch(() => {});
  }

  assert(evidence, 'External identity merge smoke did not produce evidence');
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
