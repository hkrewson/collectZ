'use strict';

const assert = require('assert');
const pool = require('../db/pool');
const {
  BLURAY_VALUATION_SOURCE,
  applyBrowserCaptureMapping,
  buildBrowserCaptureMapping
} = require('../services/browserCaptureMapping');

function fixtureMapping() {
  return buildBrowserCaptureMapping({
    contract: 'collectz.browser_capture.v1',
    extension_version: '0.1.1',
    source: 'browser_extension',
    client_source: 'browser-extension',
    adapter: 'bluray',
    url: 'https://www.blu-ray.com/movies/Dune-4K-Blu-ray/295838/',
    canonical_url: 'https://www.blu-ray.com/movies/Dune-4K-Blu-ray/295838/',
    captured_at: '2026-07-31T18:00:00.000Z',
    identifiers: {
      bluray_product_id: '295838',
      bluray_content_id: '111111',
      bluray_global_product_id: '222222',
      imdb_id: 'tt1160419',
      asin: 'B09GWCX92K',
      upc: '883929701223'
    },
    page_metadata: {
      edition: '4K Ultra HD + Blu-ray + Digital',
      media_format: '4K Ultra HD + Blu-ray + Digital',
      cover_image_url: 'https://images.example.test/dune.jpg',
      trailer_url: 'https://video.example.test/dune.mp4',
      release_details: {
        studio: 'Warner Bros.',
        year: '2021',
        runtime: '155 minutes',
        rating: 'Rated PG-13',
        release_date: 'January 11, 2022'
      },
      specs: {
        video: 'Codec: HEVC / H.265 Resolution: Native 4K (2160p) HDR: HDR10',
        audio: 'English: Dolby Atmos'
      },
      pricing: {
        used: {
          amount: 14.99,
          currency: 'USD',
          display: '$14.99',
          seller: 'Amazon',
          condition: 'used',
          savings_percent: 50
        }
      }
    }
  });
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const scope = await client.query('SELECT id, space_id FROM libraries ORDER BY id LIMIT 1');
    assert.ok(scope.rows[0], 'runtime smoke requires one initialized library');

    const media = await client.query(
      `INSERT INTO media (title, media_type, library_id, space_id, owned_formats)
       VALUES ($1, 'movie', $2, $3, ARRAY['digital']::text[])
       RETURNING id`,
      ['Browser mapping smoke fixture', scope.rows[0].id, scope.rows[0].space_id]
    );
    const mediaId = media.rows[0].id;
    const mapping = fixtureMapping();
    const applied = await applyBrowserCaptureMapping({ db: client, mediaId, mapping });

    assert.ok(applied.applied.includes('used_value'));
    assert.ok(applied.applied.includes('physical_variant'));
    const mappedMedia = await client.query(
      `SELECT year, runtime, release_date, format, owned_formats, upc, estimated_value_low,
              valuation_currency, valuation_source, poster_path, trailer_url
         FROM media WHERE id = $1`,
      [mediaId]
    );
    assert.deepStrictEqual(mappedMedia.rows[0].owned_formats, ['bluray', 'uhd', 'digital']);
    assert.strictEqual(mappedMedia.rows[0].year, 2021);
    assert.strictEqual(mappedMedia.rows[0].runtime, 155);
    assert.strictEqual(mappedMedia.rows[0].release_date, null);
    assert.strictEqual(mappedMedia.rows[0].format, '4K UHD');
    assert.strictEqual(Number(mappedMedia.rows[0].estimated_value_low), 14.99);
    assert.strictEqual(mappedMedia.rows[0].valuation_currency, 'USD');
    assert.strictEqual(mappedMedia.rows[0].valuation_source, BLURAY_VALUATION_SOURCE);

    const variant = await client.query(
      `SELECT source_item_key, source_media_id, source_part_id, edition, container, resolution,
              runtime_minutes, raw_json->>'physical_release_date' AS physical_release_date
         FROM media_variants WHERE id = $1`,
      [applied.variant_id]
    );
    assert.strictEqual(variant.rows[0].source_item_key, '295838');
    assert.strictEqual(variant.rows[0].physical_release_date, '2022-01-11');

    const metadata = await client.query(
      `SELECT "key", "value" FROM media_metadata WHERE media_id = $1 ORDER BY "key"`,
      [mediaId]
    );
    assert.deepStrictEqual(metadata.rows, [
      { key: 'amazon_item_id', value: 'B09GWCX92K' },
      { key: 'imdb_id', value: 'tt1160419' }
    ]);

    await client.query(
      `UPDATE media
          SET estimated_value_low = 99.00,
              valuation_source = 'manual',
              valuation_last_updated = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [mediaId]
    );
    const preserved = await applyBrowserCaptureMapping({ db: client, mediaId, mapping });
    assert.ok(preserved.skipped.includes('valuation_preserved'));
    const preservedValue = await client.query(
      'SELECT estimated_value_low, valuation_source FROM media WHERE id = $1',
      [mediaId]
    );
    assert.strictEqual(Number(preservedValue.rows[0].estimated_value_low), 99);
    assert.strictEqual(preservedValue.rows[0].valuation_source, 'manual');

    console.log(JSON.stringify({
      ok: true,
      mapped: applied.applied,
      preserved: preserved.skipped,
      variant_id: applied.variant_id
    }, null, 2));
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
