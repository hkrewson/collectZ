#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const pool = require('../db/pool');
const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');
const { createPlexImportIdentityModule } = require('../services/plexImportIdentity');

const ROLLBACK = 'PLEX_AUTHORITATIVE_SYNC_ROLLBACK';

async function main() {
  const suffix = crypto.randomBytes(8).toString('hex');
  let userId;
  let spaceId;
  let libraryId;
  try {
    userId = Number((await pool.query(
      `INSERT INTO users (email, password, name, role, email_verified)
       VALUES ($1, $2, 'Plex authoritative sync smoke', 'admin', true)
       RETURNING id`,
      [`plex-authoritative-${suffix}@example.invalid`, crypto.randomBytes(48).toString('hex')]
    )).rows[0].id);
    spaceId = Number((await pool.query(
      'INSERT INTO spaces (name, slug, created_by) VALUES ($1, $2, $3) RETURNING id',
      [`Plex authoritative ${suffix}`, `plex-authoritative-${suffix}`, userId]
    )).rows[0].id);
    libraryId = Number((await pool.query(
      'INSERT INTO libraries (space_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
      [spaceId, `Plex library ${suffix}`, userId]
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

    const module = createPlexImportIdentityModule({ pool });
    await assert.rejects(
      withAuthorizedScopeTransaction(pool, { spaceId, libraryId }, userId, async (client) => {
        const session = await module.open({
          spaceId,
          libraryId,
          actorId: userId,
          endpointUrl: 'https://plex.example.invalid:32400',
          transactionClient: client
        });
        const item = {
          title: 'Plex Identity Movie',
          media_type: 'movie',
          year: 2025,
          format: 'Digital',
          overview: 'Initial Plex summary',
          tmdb_id: 900001,
          tmdb_media_type: 'movie',
          tmdb_url: 'https://www.themoviedb.org/movie/900001'
        };
        const first = await session.reconcileItem({
          plexGuid: 'plex://movie/authoritative-42',
          plexItemKey: '1:42',
          item
        }, async ({ client: tx, preferredMediaId, identityKind }) => {
          assert.equal(preferredMediaId, null);
          assert.equal(identityKind, 'guid');
          const inserted = await tx.query(
            `INSERT INTO media (title, media_type, library_id, space_id, added_by, import_source)
             VALUES ($1, 'movie', $2, $3, $4, 'plex') RETURNING id`,
            [item.title, libraryId, spaceId, userId]
          );
          return { type: 'created', mediaId: Number(inserted.rows[0].id) };
        });
        const mediaId = Number(first.mediaId);
        const initial = (await client.query(
          'SELECT title, year, format, overview, tmdb_id FROM media WHERE id = $1',
          [mediaId]
        )).rows[0];
        assert.equal(initial.title, item.title);
        assert.equal(Number(initial.year), 2025);
        assert.equal(initial.format, 'Digital');
        assert.equal(initial.overview, 'Initial Plex summary');
        assert.equal(Number(initial.tmdb_id), 900001);
        assert.equal((await client.query(
          `SELECT "value" FROM media_metadata WHERE media_id = $1 AND "key" = 'plex_guid'`,
          [mediaId]
        )).rows[0]?.value, 'plex://movie/authoritative-42');

        await client.query('UPDATE media SET title = $2 WHERE id = $1', [mediaId, 'Reviewed Plex title']);
        await client.query(
          `UPDATE canonical_media_field_controls
              SET authority = 'manual', provider_write_mode = 'preserve', locked = true,
                  source_provider_connection_id = NULL
            WHERE media_id = $1 AND field_path = 'media.title'`,
          [mediaId]
        );
        const second = await session.reconcileItem({
          plexGuid: 'plex://movie/authoritative-42',
          plexItemKey: '1:42',
          item: { ...item, title: 'Provider replacement title', year: 2026, overview: 'Refreshed Plex summary' }
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
        assert.equal(repeated.title, 'Reviewed Plex title');
        assert.equal(Number(repeated.year), 2026);
        assert.equal(repeated.overview, 'Refreshed Plex summary');
        assert.equal(Number((await client.query(
          `SELECT COUNT(*)::int AS count FROM external_media_identities
            WHERE media_id = $1 AND identity_kind = 'guid' AND active`,
          [mediaId]
        )).rows[0].count), 1);

        const fallbackItem = {
          title: 'Plex Item-Key Fallback Movie',
          media_type: 'movie',
          year: 2024,
          overview: 'Plex item without a GUID'
        };
        const fallback = await session.reconcileItem({
          plexItemKey: '1:43',
          item: fallbackItem
        }, async ({ client: tx, preferredMediaId, identityKind }) => {
          assert.equal(preferredMediaId, null);
          assert.equal(identityKind, 'item');
          const inserted = await tx.query(
            `INSERT INTO media (title, media_type, library_id, space_id, added_by, import_source)
             VALUES ($1, 'movie', $2, $3, $4, 'plex') RETURNING id`,
            [fallbackItem.title, libraryId, spaceId, userId]
          );
          return { type: 'created', mediaId: Number(inserted.rows[0].id) };
        });
        assert.equal((await client.query(
          `SELECT "value" FROM media_metadata WHERE media_id = $1 AND "key" = 'plex_item_key'`,
          [fallback.mediaId]
        )).rows[0]?.value, '1:43');
        assert.equal((await client.query(
          `SELECT identity_kind FROM external_media_identities
            WHERE media_id = $1 AND active`,
          [fallback.mediaId]
        )).rows[0]?.identity_kind, 'item');
        throw new Error(ROLLBACK);
      }),
      (error) => error.message === ROLLBACK
    );
    console.log('Plex authoritative sync smoke passed with GUID and item-key identities, stable repeat resolution, and locked-field preservation.');
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
