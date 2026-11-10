#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const pool = require('../db/pool');
const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');
const { createCwaImportIdentityModule } = require('../services/cwaImportIdentity');

const ROLLBACK = 'CWA_AUTHORITATIVE_SYNC_ROLLBACK';

async function main() {
  const suffix = crypto.randomBytes(8).toString('hex');
  let userId;
  let spaceId;
  let libraryId;
  try {
    userId = Number((await pool.query(
      `INSERT INTO users (email, password, name, role, email_verified)
       VALUES ($1, $2, 'CWA authoritative sync smoke', 'admin', true)
       RETURNING id`,
      [`cwa-authoritative-${suffix}@example.invalid`, crypto.randomBytes(48).toString('hex')]
    )).rows[0].id);
    spaceId = Number((await pool.query(
      'INSERT INTO spaces (name, slug, created_by) VALUES ($1, $2, $3) RETURNING id',
      [`CWA authoritative ${suffix}`, `cwa-authoritative-${suffix}`, userId]
    )).rows[0].id);
    libraryId = Number((await pool.query(
      'INSERT INTO libraries (space_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
      [spaceId, `CWA library ${suffix}`, userId]
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

    const module = createCwaImportIdentityModule({ pool });
    await assert.rejects(
      withAuthorizedScopeTransaction(pool, { spaceId, libraryId }, userId, async (client) => {
        const session = await module.open({
          spaceId,
          libraryId,
          actorId: userId,
          endpointUrl: 'https://cwa.example.invalid/opds',
          transactionClient: client
        });
        const item = {
          title: 'CWA Identity Book',
          media_type: 'book',
          year: 2025,
          format: 'Digital',
          overview: 'Initial CWA summary',
          type_details: {
            author: 'Example Author',
            isbn: '9781234567890',
            publisher: 'Example Press',
            provider_external_url: 'https://cwa.example.invalid/book/42',
            provider_download_url: 'https://cwa.example.invalid/download/42.epub',
            calibre_external_url: 'https://cwa.example.invalid/book/42',
            calibre_download_url: 'https://cwa.example.invalid/download/42.epub',
            source_updated_at: '2025-01-02T03:04:05Z'
          }
        };
        const first = await session.reconcileItem({
          externalId: 'urn:uuid:cwa-book-42',
          item,
          sourceUrl: 'https://cwa.example.invalid/book/42'
        }, async ({ client: tx, preferredMediaId }) => {
          assert.equal(preferredMediaId, null);
          const inserted = await tx.query(
            `INSERT INTO media (title, media_type, library_id, space_id, added_by, import_source)
             VALUES ($1, 'book', $2, $3, $4, 'cwa_opds') RETURNING id`,
            [item.title, libraryId, spaceId, userId]
          );
          return { type: 'created', mediaId: Number(inserted.rows[0].id) };
        });
        const mediaId = Number(first.mediaId);
        const initial = (await client.query(
          'SELECT title, year, format, owned_formats, overview, type_details FROM media WHERE id = $1',
          [mediaId]
        )).rows[0];
        assert.equal(initial.title, item.title);
        assert.equal(Number(initial.year), 2025);
        assert.deepEqual(initial.owned_formats, ['digital']);
        assert.equal(initial.type_details.provider_name, 'cwa_opds');
        assert.equal(initial.type_details.provider_item_id, 'urn:uuid:cwa-book-42');
        assert.equal(initial.type_details.calibre_entry_id, 'urn:uuid:cwa-book-42');
        assert.equal(initial.type_details.provider_external_url, 'https://cwa.example.invalid/book/42');
        assert.equal(initial.type_details.provider_download_url, 'https://cwa.example.invalid/download/42.epub');

        await client.query('UPDATE media SET title = $2 WHERE id = $1', [mediaId, 'Reviewed CWA title']);
        await client.query(
          `UPDATE canonical_media_field_controls
              SET authority = 'manual', provider_write_mode = 'preserve', locked = true,
                  source_provider_connection_id = NULL
            WHERE media_id = $1 AND field_path = 'media.title'`,
          [mediaId]
        );
        const second = await session.reconcileItem({
          externalId: 'urn:uuid:cwa-book-42',
          item: { ...item, title: 'Provider replacement title', year: 2026, overview: 'Refreshed CWA summary' },
          sourceUrl: 'https://cwa.example.invalid/book/42'
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
        assert.equal(repeated.title, 'Reviewed CWA title');
        assert.equal(Number(repeated.year), 2026);
        assert.equal(repeated.overview, 'Refreshed CWA summary');
        assert.equal(Number((await client.query(
          'SELECT COUNT(*)::int AS count FROM external_media_identities WHERE media_id = $1 AND active',
          [mediaId]
        )).rows[0].count), 1);
        assert.equal(Number((await client.query(
          `SELECT COUNT(*)::int AS count FROM media_metadata
            WHERE media_id = $1 AND "key" IN ('provider_item_id', 'calibre_entry_id')
              AND "value" = 'urn:uuid:cwa-book-42'`,
          [mediaId]
        )).rows[0].count), 2);
        throw new Error(ROLLBACK);
      }),
      (error) => error.message === ROLLBACK
    );
    console.log('CWA authoritative sync smoke passed with stable repeat resolution, dual-write, and locked-field preservation.');
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
