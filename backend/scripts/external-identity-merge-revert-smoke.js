#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const pool = require('../db/pool');
const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');
const {
  mergeDuplicateIntoCanonical,
  revertDuplicateAttachIntoSeparateRow
} = require('./repair-book-comic-duplicates');

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
    await withAuthorizedScopeTransaction(pool, { spaceId: scope.spaceId, libraryId: scope.libraryId }, scope.actorId, async (client) => {
      const connection = (await client.query(
        `INSERT INTO provider_connections (space_id, provider_type, display_name, status, created_by)
         VALUES ($1, 'fixture', 'Merge lifecycle smoke', 'active', $2)
         RETURNING id`,
        [scope.spaceId, scope.actorId]
      )).rows[0];
      const media = (await client.query(
        `INSERT INTO media (title, media_type, format, library_id, space_id, added_by, import_source)
         VALUES
           ('Identity merge canonical', 'book', 'Digital', $1, $2, $3, 'identity_merge_smoke'),
           ('Identity merge duplicate', 'book', 'Digital', $1, $2, $3, 'identity_merge_smoke')
         RETURNING *`,
        [scope.libraryId, scope.spaceId, scope.actorId]
      )).rows;
      const canonical = media[0];
      const duplicate = media[1];
      const identity = (await client.query(
        `INSERT INTO external_media_identities
           (space_id, provider_connection_id, identity_kind, external_id_raw,
            external_id_normalized, media_id, created_by, updated_by)
         VALUES ($1, $2, 'book', 'fixture:merge:42', 'fixture:merge:42', $3, $4, $4)
         RETURNING id`,
        [scope.spaceId, connection.id, duplicate.id, scope.actorId]
      )).rows[0];

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
        canonicalUuidRestored: afterRevert.public_id === duplicate.public_id
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
