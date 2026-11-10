#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const pool = require('../db/pool');
const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');
const { createMetronImportIdentityModule } = require('../services/metronImportIdentity');

const ROLLBACK = 'METRON_AUTHORITATIVE_SYNC_ROLLBACK';

async function main() {
  const suffix = crypto.randomBytes(8).toString('hex');
  let userId;
  let spaceId;
  let libraryId;
  try {
    userId = Number((await pool.query(
      `INSERT INTO users (email, password, name, role, email_verified)
       VALUES ($1, $2, 'Metron authoritative sync smoke', 'admin', true)
       RETURNING id`,
      [`metron-authoritative-${suffix}@example.invalid`, crypto.randomBytes(48).toString('hex')]
    )).rows[0].id);
    spaceId = Number((await pool.query(
      'INSERT INTO spaces (name, slug, created_by) VALUES ($1, $2, $3) RETURNING id',
      [`Metron authoritative ${suffix}`, `metron-authoritative-${suffix}`, userId]
    )).rows[0].id);
    libraryId = Number((await pool.query(
      'INSERT INTO libraries (space_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
      [spaceId, `Metron library ${suffix}`, userId]
    )).rows[0].id);
    await pool.query(
      `INSERT INTO space_memberships (space_id, user_id, role)
       VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
      [spaceId, userId]
    );
    await pool.query(
      `INSERT INTO library_memberships (library_id, user_id, role)
       VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
      [libraryId, userId]
    );

    const module = createMetronImportIdentityModule({ pool });
    await assert.rejects(
      withAuthorizedScopeTransaction(pool, { spaceId, libraryId }, userId, async (client) => {
        const session = await module.open({
          spaceId,
          libraryId,
          actorId: userId,
          endpointUrl: 'https://metron.example.invalid/api/issue/',
          transactionClient: client
        });
        assert.equal((await session.knownIssueIds(['42'])).size, 0);
        const firstItem = {
          title: 'Alpha Flight #11',
          media_type: 'comic_book',
          year: 1984,
          format: 'Digital',
          overview: 'Provider overview',
          upc: '012345678905',
          type_details: { series: 'Alpha Flight', issue_number: '11', volume: '1' }
        };
        const first = await session.reconcileIssue({
          providerIssueId: '42',
          item: firstItem,
          sourceUrl: 'https://metron.example.invalid/issue/42'
        }, async ({ client: tx, preferredMediaId }) => {
          assert.equal(preferredMediaId, null);
          const inserted = await tx.query(
            `INSERT INTO media (title, media_type, library_id, space_id, added_by, import_source)
             VALUES ($1, 'comic_book', $2, $3, $4, 'metron') RETURNING id`,
            [firstItem.title, libraryId, spaceId, userId]
          );
          return { type: 'created', mediaId: Number(inserted.rows[0].id) };
        });
        const mediaId = Number(first.mediaId);
        assert(mediaId > 0);
        const initial = (await client.query(
          'SELECT title, year, format, owned_formats, overview, upc, type_details FROM media WHERE id = $1',
          [mediaId]
        )).rows[0];
        assert.equal(initial.title, firstItem.title);
        assert.equal(Number(initial.year), 1984);
        assert.deepEqual(initial.owned_formats, ['digital']);
        assert.equal(initial.type_details.provider_issue_id, '42');
        assert.equal(initial.type_details.provider_name, 'metron');
        assert.equal((await session.knownIssueIds(['00042'])).has('42'), true);

        await client.query('UPDATE media SET title = $2 WHERE id = $1', [mediaId, 'Reviewed manual title']);
        await client.query(
          `UPDATE canonical_media_field_controls
              SET authority = 'manual', provider_write_mode = 'preserve', locked = true,
                  source_provider_connection_id = NULL
            WHERE media_id = $1 AND field_path = 'media.title'`,
          [mediaId]
        );
        const second = await session.reconcileIssue({
          providerIssueId: '00042',
          item: { ...firstItem, title: 'Provider replacement title', year: 1985, overview: 'Refreshed overview' },
          sourceUrl: 'https://metron.example.invalid/issue/42'
        }, async ({ preferredMediaId, matchedBy }) => {
          assert.equal(Number(preferredMediaId), mediaId);
          assert.equal(matchedBy, 'external_identity');
          return { type: 'updated', mediaId };
        });
        assert.equal(Number(second.mediaId), mediaId);
        const repeated = (await client.query(
          'SELECT title, year, overview FROM media WHERE id = $1',
          [mediaId]
        )).rows[0];
        assert.equal(repeated.title, 'Reviewed manual title');
        assert.equal(Number(repeated.year), 1985);
        assert.equal(repeated.overview, 'Refreshed overview');
        assert.equal(Number((await client.query(
          'SELECT COUNT(*)::int AS count FROM external_media_identities WHERE media_id = $1 AND active',
          [mediaId]
        )).rows[0].count), 1);
        assert.equal(Number((await client.query(
          `SELECT COUNT(*)::int AS count FROM media_metadata
            WHERE media_id = $1 AND "key" IN ('provider_issue_id', 'metron_issue_id') AND "value" = '42'`,
          [mediaId]
        )).rows[0].count), 2);
        throw new Error(ROLLBACK);
      }),
      (error) => error.message === ROLLBACK
    );
    console.log('Metron authoritative sync smoke passed with stable repeat resolution, dual-write, and locked-field preservation.');
  } finally {
    if (libraryId) {
      await pool.query('DELETE FROM library_memberships WHERE library_id = $1', [libraryId]).catch(() => {});
      await pool.query('DELETE FROM libraries WHERE id = $1', [libraryId]).catch(() => {});
    }
    if (spaceId) {
      await pool.query('DELETE FROM space_memberships WHERE space_id = $1', [spaceId]).catch(() => {});
      await pool.query('DELETE FROM spaces WHERE id = $1', [spaceId]).catch(() => {});
    }
    if (userId) await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
