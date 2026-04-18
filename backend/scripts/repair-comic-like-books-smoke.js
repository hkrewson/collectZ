'use strict';

const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { ensureUserDefaultScope } = require('../services/libraries');
const { runRepairComicLikeBooks } = require('./repair-comic-like-books');

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

async function cleanupTemporaryState({ userId, libraryId, spaceId }) {
  if (libraryId) {
    await pool.query('DELETE FROM media_metadata WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM library_memberships WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM libraries WHERE id = $1', [libraryId]).catch(() => {});
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
  const email = `repair-comic-like-books-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  let userId = null;
  let libraryId = null;
  let spaceId = null;
  let mediaId = null;

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Repair Comic-Like Books Smoke User'
    });

    const scope = await ensureUserDefaultScope(userId);
    libraryId = Number(scope?.libraryId || 0) || null;
    spaceId = Number(scope?.spaceId || 0) || null;
    if (!libraryId || !spaceId) {
      throw new Error(`Missing default scope for temp user ${userId}`);
    }

    const inserted = await pool.query(
      `INSERT INTO media (
         title, media_type, format, type_details, library_id, space_id, added_by, import_source
       ) VALUES (
         $1, 'book', 'Digital', $2::jsonb, $3, $4, $5, 'manual_seed'
       )
       RETURNING id`,
      [
        'Groo The Wanderer v1 #1 - Friends and Enemies',
        JSON.stringify({
          author: 'Sergio Aragonés, Mark Evanier',
          provider_name: 'cwa_opds',
          provider_item_id: 'urn:uuid:test-reclass'
        }),
        libraryId,
        spaceId,
        userId
      ]
    );
    mediaId = Number(inserted.rows[0]?.id || 0) || null;
    if (!mediaId) throw new Error('Failed to seed comic-like book row');

    const dryRun = await runRepairComicLikeBooks({
      apply: false,
      ids: [mediaId],
      limit: 5
    });
    if (dryRun.applicable !== 1 || dryRun.updated !== 0) {
      throw new Error(`Expected dry-run applicable=1 updated=0, got ${JSON.stringify(dryRun)}`);
    }

    const applied = await runRepairComicLikeBooks({
      apply: true,
      ids: [mediaId],
      limit: 5
    });
    if (applied.updated !== 1) {
      throw new Error(`Expected one updated row during apply, got ${JSON.stringify(applied)}`);
    }

    const repaired = await pool.query(
      `SELECT media_type, type_details
       FROM media
       WHERE id = $1`,
      [mediaId]
    );
    const media = repaired.rows[0] || {};
    if (media.media_type !== 'comic_book') {
      throw new Error(`Expected media_type comic_book, got ${JSON.stringify(media)}`);
    }
    if (String(media.type_details?.series || '') !== 'Groo The Wanderer') {
      throw new Error(`Expected inferred series, got ${JSON.stringify(media.type_details)}`);
    }
    if (String(media.type_details?.issue_number || '') !== '1') {
      throw new Error(`Expected inferred issue number, got ${JSON.stringify(media.type_details)}`);
    }
    if (String(media.type_details?.volume || '') !== '1') {
      throw new Error(`Expected inferred volume, got ${JSON.stringify(media.type_details)}`);
    }

    const metadata = await pool.query(
      `SELECT "key", "value"
       FROM media_metadata
       WHERE media_id = $1
         AND "key" IN (
           'historical_repair_previous_media_type',
           'historical_repair_previous_type_details',
           'historical_repair_action'
         )
       ORDER BY "key" ASC`,
      [mediaId]
    );
    const keys = metadata.rows.map((row) => row.key).sort();
    if (!keys.includes('historical_repair_previous_media_type') || !keys.includes('historical_repair_previous_type_details') || !keys.includes('historical_repair_action')) {
      throw new Error(`Expected repair snapshot metadata, got ${JSON.stringify(metadata.rows)}`);
    }

    console.log('Repair comic-like books smoke passed');
    console.log(JSON.stringify({
      dryRunApplicable: dryRun.applicable,
      appliedUpdated: applied.updated,
      mediaType: media.media_type,
      series: media.type_details?.series || null,
      issue_number: media.type_details?.issue_number || null,
      volume: media.type_details?.volume || null,
      metadataKeys: keys
    }, null, 2));
  } finally {
    await cleanupTemporaryState({ userId, libraryId, spaceId });
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
