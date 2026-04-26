#!/usr/bin/env node

'use strict';

const assert = require('assert');
const pool = require('../db/pool');
const { MIGRATIONS } = require('../db/migrations');

const backfillMigration = MIGRATIONS.find((migration) => migration.version === 75);

async function main() {
  assert.ok(backfillMigration, 'Expected migration v75 to exist');
  assert.ok(
    String(backfillMigration.description || '').includes('Backfill native art rows'),
    'Expected migration v75 to describe the Art backfill'
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const suffix = Date.now();
    const userResult = await client.query(
      `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
       VALUES ($1, $2, $3, 'admin', true, NOW())
       RETURNING id`,
      [`art-backfill-smoke-${suffix}@example.com`, 'not-a-real-login-hash', 'Art Backfill Smoke']
    );
    const userId = userResult.rows[0].id;

    const spaceResult = await client.query(
      `INSERT INTO spaces (name, slug, created_by, events_enabled, collectibles_enabled)
       VALUES ($1, $2, $3, true, true)
       RETURNING id`,
      ['Art Backfill Smoke Space', `art-backfill-smoke-${suffix}`, userId]
    );
    const spaceId = spaceResult.rows[0].id;

    const libraryResult = await client.query(
      `INSERT INTO libraries (space_id, name, created_by)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [spaceId, 'Art Backfill Smoke Library', userId]
    );
    const libraryId = libraryResult.rows[0].id;

    const eventResult = await client.query(
      `INSERT INTO events (library_id, space_id, created_by, title, url, location, date_start)
       VALUES ($1, $2, $3, $4, $5, $6, '2026-04-25')
       RETURNING id`,
      [libraryId, spaceId, userId, 'Art Backfill Smoke Event', 'https://example.test/art-backfill-smoke', 'Chicago, IL']
    );
    const eventId = eventResult.rows[0].id;

    const activeArt = await client.query(
      `INSERT INTO collectibles (
         library_id, space_id, created_by, title, subtype, item_type, event_id,
         series, vendor, booth, booth_or_vendor, artist, price, exclusive, image_path, notes
       )
       VALUES ($1, $2, $3, 'Bast', 'art', 'art', $4, 'Croyance', NULL, 'A12', 'Studio Sade', 'Nigel Sade', 250, true, '/uploads/bast.jpg', 'Legacy active Art')
       RETURNING id`,
      [libraryId, spaceId, userId, eventId]
    );

    const standaloneArt = await client.query(
      `INSERT INTO collectibles (
         library_id, space_id, created_by, title, subtype, item_type,
         series, vendor, artist, price, notes
       )
       VALUES ($1, $2, $3, 'Anubis', 'art', 'art', 'Croyance', 'Studio Sade', 'Nigel Sade', 175, 'Legacy standalone Art')
       RETURNING id`,
      [libraryId, spaceId, userId]
    );

    const archivedArt = await client.query(
      `INSERT INTO collectibles (
         library_id, space_id, created_by, title, subtype, item_type, event_id,
         vendor, artist, price, archived_at
       )
       VALUES ($1, $2, $3, 'Sekhmet', 'art', 'art', $4, 'Studio Sade', 'Nigel Sade', 200, NOW())
       RETURNING id`,
      [libraryId, spaceId, userId, eventId]
    );

    await client.query(
      `INSERT INTO collectibles (library_id, space_id, created_by, title, subtype, item_type, event_id, vendor)
       VALUES ($1, $2, $3, 'Non Art Figure', 'collectible', 'collectible', $4, 'Booth Forge')`,
      [libraryId, spaceId, userId, eventId]
    );

    await client.query(backfillMigration.up);
    await client.query(backfillMigration.up);

    const nativeRows = await client.query(
      `SELECT source_collectible_id, title, artist, series, vendor, booth, price, exclusive, image_path, notes, archived_at
       FROM art_items
       WHERE source_collectible_id = ANY($1::int[])
       ORDER BY source_collectible_id ASC`,
      [[activeArt.rows[0].id, standaloneArt.rows[0].id, archivedArt.rows[0].id]]
    );
    assert.strictEqual(nativeRows.rows.length, 3, 'Expected all legacy Art rows to have native Art rows');

    const activeNative = nativeRows.rows.find((row) => row.source_collectible_id === activeArt.rows[0].id);
    assert.strictEqual(activeNative.title, 'Bast');
    assert.strictEqual(activeNative.artist, 'Nigel Sade');
    assert.strictEqual(activeNative.series, 'Croyance');
    assert.strictEqual(activeNative.vendor, 'Studio Sade');
    assert.strictEqual(activeNative.booth, 'A12');
    assert.strictEqual(Number(activeNative.price), 250);
    assert.strictEqual(activeNative.exclusive, true);
    assert.strictEqual(activeNative.image_path, '/uploads/bast.jpg');

    const purchasedRows = await client.query(
      `SELECT epi.item_type, epi.item_id, epi.title_snapshot, epi.vendor_snapshot, epi.booth_snapshot, epi.price_snapshot, epi.archived_at, ai.source_collectible_id
       FROM event_purchased_items epi
       INNER JOIN art_items ai
         ON ai.id = epi.item_id
        AND epi.item_type = 'art'
       WHERE epi.event_id = $1
       ORDER BY ai.source_collectible_id ASC`,
      [eventId]
    );
    assert.strictEqual(purchasedRows.rows.length, 2, 'Expected only event-linked Art rows to become purchased-item links');
    assert.strictEqual(
      purchasedRows.rows.filter((row) => row.source_collectible_id === activeArt.rows[0].id).length,
      1,
      'Expected active event-linked Art purchase to be backfilled once'
    );
    assert.strictEqual(
      purchasedRows.rows.filter((row) => row.source_collectible_id === archivedArt.rows[0].id && row.archived_at).length,
      1,
      'Expected archived event-linked Art purchase to preserve archived state'
    );

    const nonArtRows = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM event_purchased_items epi
       WHERE epi.event_id = $1
         AND epi.item_type = 'collectible'`,
      [eventId]
    );
    assert.strictEqual(nonArtRows.rows[0].total, 0, 'Expected collectible rows to stay out of the Art migration backfill');

    console.log(JSON.stringify({
      nativeArtRows: nativeRows.rows.length,
      purchasedItemRows: purchasedRows.rows.length,
      activeArtSourceId: activeArt.rows[0].id,
      standaloneArtSourceId: standaloneArt.rows[0].id,
      archivedArtSourceId: archivedArt.rows[0].id
    }, null, 2));
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
