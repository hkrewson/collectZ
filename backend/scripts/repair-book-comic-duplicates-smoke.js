'use strict';

const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { ensureUserDefaultScope } = require('../services/libraries');
const { runRepairBookComicDuplicates } = require('./repair-book-comic-duplicates');

async function createDirectUser({ email, password, name, role = 'user' }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, $3, $4, true, NOW())
     RETURNING id`,
    [email, passwordHash, name, role]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

async function cleanupTemporaryState({ userId, libraryId, spaceId, collectionId, genreId }) {
  if (collectionId) {
    await pool.query('DELETE FROM collection_items WHERE collection_id = $1', [collectionId]).catch(() => {});
    await pool.query('DELETE FROM collections WHERE id = $1', [collectionId]).catch(() => {});
  }
  if (libraryId) {
    await pool.query('DELETE FROM media_metadata WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_variants WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_genres WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM library_memberships WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM libraries WHERE id = $1', [libraryId]).catch(() => {});
  }
  if (genreId) {
    await pool.query('DELETE FROM genres WHERE id = $1', [genreId]).catch(() => {});
  }
  if (spaceId) {
    await pool.query('DELETE FROM app_integrations WHERE space_id = $1', [spaceId]).catch(() => {});
    await pool.query('DELETE FROM space_memberships WHERE space_id = $1', [spaceId]).catch(() => {});
    await pool.query('DELETE FROM spaces WHERE id = $1', [spaceId]).catch(() => {});
  }
  if (userId) {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
  }
}

async function main() {
  const suffix = Date.now();
  const email = `repair-duplicates-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  let userId = null;
  let libraryId = null;
  let spaceId = null;
  let canonicalId = null;
  let duplicateId = null;
  let collectionId = null;
  let genreId = null;

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Repair Duplicates Smoke User'
    });

    const scope = await ensureUserDefaultScope(userId);
    libraryId = Number(scope?.libraryId || 0) || null;
    spaceId = Number(scope?.spaceId || 0) || null;
    if (!libraryId || !spaceId) {
      throw new Error(`Missing default scope for temp user ${userId}`);
    }

    const canonical = await pool.query(
      `INSERT INTO media (
         title, media_type, format, type_details, library_id, space_id, added_by, import_source
       ) VALUES (
         $1, 'book', 'Hardcover', $2::jsonb, $3, $4, $5, 'manual_seed'
       )
       RETURNING id`,
      [
        'Duplicate Attach Smoke Book',
        JSON.stringify({
          isbn: '9780358447849'
        }),
        libraryId,
        spaceId,
        userId
      ]
    );
    canonicalId = Number(canonical.rows[0]?.id || 0) || null;

    const duplicate = await pool.query(
      `INSERT INTO media (
         title, media_type, format, type_details, library_id, space_id, added_by, import_source
       ) VALUES (
         $1, 'book', 'Hardcover', $2::jsonb, $3, $4, $5, 'manual_seed'
       )
       RETURNING id`,
      [
        'Duplicate Attach Smoke Book',
        JSON.stringify({
          isbn: '9780358447849',
          author: 'Hugh Howey',
          publisher: 'Broad Reach'
        }),
        libraryId,
        spaceId,
        userId
      ]
    );
    duplicateId = Number(duplicate.rows[0]?.id || 0) || null;

    const genre = await pool.query(
      `INSERT INTO genres (name, normalized_name)
       VALUES ('Science Fiction', 'science fiction duplicate attach smoke')
       RETURNING id`
    );
    genreId = Number(genre.rows[0]?.id || 0) || null;
    await pool.query(
      `INSERT INTO media_genres (media_id, genre_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [duplicateId, genreId]
    );

    await pool.query(
      `INSERT INTO media_metadata (media_id, "key", "value")
       VALUES ($1, 'amazon_item_id', 'B00DUPLICATEATTACH')`,
      [duplicateId]
    );

    const collection = await pool.query(
      `INSERT INTO collections (name, media_type, library_id, space_id, created_by)
       VALUES ('Duplicate Attach Smoke Collection', 'book', $1, $2, $3)
       RETURNING id`,
      [libraryId, spaceId, userId]
    );
    collectionId = Number(collection.rows[0]?.id || 0) || null;
    await pool.query(
      `INSERT INTO collection_items (collection_id, media_id, position)
       VALUES ($1, $2, 1)`,
      [collectionId, duplicateId]
    );

    const dryRun = await runRepairBookComicDuplicates({
      ids: [canonicalId, duplicateId],
      canonicalId,
      apply: false
    });
    if (dryRun.attached !== 0 || Number(dryRun.duplicates?.length || 0) !== 1) {
      throw new Error(`Expected dry-run with one duplicate candidate, got ${JSON.stringify(dryRun)}`);
    }

    const applied = await runRepairBookComicDuplicates({
      ids: [canonicalId, duplicateId],
      canonicalId,
      apply: true
    });
    if (applied.attached !== 1) {
      throw new Error(`Expected one attached duplicate, got ${JSON.stringify(applied)}`);
    }

    const canonicalAfter = await pool.query(
      `SELECT id, media_type, type_details
       FROM media
       WHERE id = $1`,
      [canonicalId]
    );
    const duplicateAfter = await pool.query(
      `SELECT id
       FROM media
       WHERE id = $1`,
      [duplicateId]
    );
    const metadataAfter = await pool.query(
      `SELECT "key", "value"
       FROM media_metadata
       WHERE media_id = $1
       ORDER BY "key" ASC`,
      [canonicalId]
    );
    const collectionAfter = await pool.query(
      `SELECT media_id
       FROM collection_items
       WHERE collection_id = $1`,
      [collectionId]
    );
    const genreAfter = await pool.query(
      `SELECT media_id
       FROM media_genres
       WHERE genre_id = $1`,
      [genreId]
    );

    const canonicalRow = canonicalAfter.rows[0] || {};
    if (canonicalRow.media_type !== 'book') {
      throw new Error(`Expected canonical row to remain a book, got ${JSON.stringify(canonicalRow)}`);
    }
    if (String(canonicalRow.type_details?.author || '') !== 'Hugh Howey') {
      throw new Error(`Expected canonical type details to merge duplicate author, got ${JSON.stringify(canonicalRow.type_details)}`);
    }
    if (duplicateAfter.rows.length !== 0) {
      throw new Error(`Expected duplicate row to be deleted, got ${JSON.stringify(duplicateAfter.rows)}`);
    }
    if (!metadataAfter.rows.some((row) => row.key === 'amazon_item_id' && row.value === 'B00DUPLICATEATTACH')) {
      throw new Error(`Expected canonical metadata to retain duplicate metadata entries, got ${JSON.stringify(metadataAfter.rows)}`);
    }
    if (!metadataAfter.rows.some((row) => row.key === `historical_duplicate_attach_snapshot_${duplicateId}`)) {
      throw new Error(`Expected canonical snapshot metadata for duplicate, got ${JSON.stringify(metadataAfter.rows)}`);
    }
    if (Number(collectionAfter.rows[0]?.media_id || 0) !== canonicalId) {
      throw new Error(`Expected collection item to rewire to canonical, got ${JSON.stringify(collectionAfter.rows)}`);
    }
    if (Number(genreAfter.rows[0]?.media_id || 0) !== canonicalId) {
      throw new Error(`Expected genre relation to rewire to canonical, got ${JSON.stringify(genreAfter.rows)}`);
    }

    console.log('Repair book/comic duplicates smoke passed');
    console.log(JSON.stringify({
      canonicalId,
      duplicateId,
      attached: applied.attached,
      canonicalAuthor: canonicalRow.type_details?.author || null,
      collectionMediaId: Number(collectionAfter.rows[0]?.media_id || 0) || null,
      snapshotKeyPresent: metadataAfter.rows.some((row) => row.key === `historical_duplicate_attach_snapshot_${duplicateId}`)
    }, null, 2));
  } finally {
    await cleanupTemporaryState({ userId, libraryId, spaceId, collectionId, genreId });
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
