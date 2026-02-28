'use strict';

const assert = require('assert');
const { parseCsvText } = require('../services/csv');
const { normalizePlexItem, normalizePlexVariant } = require('../services/plex');
const { mapDeliciousItemTypeToMediaType } = require('../services/importMapping');
const { normalizeDeliciousRow } = require('../services/deliciousNormalize');
const { normalizeIsbn, normalizeIdentifierSet } = require('../services/importIdentifiers');
const { extractScopeHints, resolveScopeContext, appendScopeSql } = require('../db/scopeContext');

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error.stack || error.message || error);
    return false;
  }
}

const results = [];

results.push(run('csv.parseCsvText parses headers and rows', () => {
  const input = 'title,year,format\nDune,1984,VHS\nAliens,1986,Blu-ray\n';
  const parsed = parseCsvText(input);
  assert.deepStrictEqual(parsed.headers, ['title', 'year', 'format']);
  assert.strictEqual(parsed.rows.length, 2);
  assert.strictEqual(parsed.rows[0].title, 'Dune');
  assert.strictEqual(parsed.rows[1].year, '1986');
}));

results.push(run('csv.parseCsvText handles BOM + empty lines', () => {
  const input = '\ufefftitle,year\n\nDune,1984\n';
  const parsed = parseCsvText(input);
  assert.deepStrictEqual(parsed.headers, ['title', 'year']);
  assert.strictEqual(parsed.rows.length, 1);
  assert.strictEqual(parsed.rows[0].title, 'Dune');
}));

results.push(run('plex.normalizePlexItem maps movie values', () => {
  const input = {
    type: 'movie',
    title: 'Dune',
    originalTitle: 'Dune',
    year: '1984',
    duration: '8160000',
    summary: 'Arrakis',
    rating: '6.4',
    guid: 'plex://movie/abc?guid=tmdb://841',
    thumb: 'https://image.example/poster.jpg'
  };
  const out = normalizePlexItem(input);
  assert.strictEqual(out.title, 'Dune');
  assert.strictEqual(out.media_type, 'movie');
  assert.strictEqual(out.tmdb_id, 841);
  assert.strictEqual(out.runtime, 136);
  assert.strictEqual(out.poster_path, 'https://image.example/poster.jpg');
}));

results.push(run('plex.normalizePlexItem maps episode to tv series context', () => {
  const input = {
    type: 'episode',
    title: 'Episode title',
    grandparentTitle: 'Ahsoka',
    grandparentRatingKey: 'show-123',
    parentIndex: '1',
    guid: 'plex://episode/xyz?guid=tmdb://12345'
  };
  const out = normalizePlexItem(input);
  assert.strictEqual(out.title, 'Ahsoka');
  assert.strictEqual(out.media_type, 'tv_series');
  assert.strictEqual(out.tmdb_media_type, 'tv');
  assert.strictEqual(out.plex_rating_key, 'show-123');
  assert.strictEqual(out.season_number, 1);
}));

results.push(run('plex.normalizePlexItem maps album to audio context', () => {
  const input = {
    type: 'album',
    title: 'The Wall',
    parentTitle: 'Pink Floyd',
    year: '1979',
    thumb: 'https://image.example/wall.jpg'
  };
  const out = normalizePlexItem(input);
  assert.strictEqual(out.title, 'The Wall');
  assert.strictEqual(out.media_type, 'audio');
  assert.strictEqual(out.tmdb_media_type, null);
  assert.strictEqual(out.type_details.artist, 'Pink Floyd');
  assert.strictEqual(out.type_details.album, 'The Wall');
}));

results.push(run('plex.normalizePlexVariant derives season edition + key', () => {
  const input = {
    type: 'episode',
    ratingKey: 'ep-555',
    grandparentRatingKey: 'show-999',
    parentIndex: '2',
    Media: [
      {
        id: 'm1',
        duration: '3600000',
        videoCodec: 'h264',
        audioCodec: 'aac',
        videoResolution: '1080',
        audioChannels: '2',
        Part: [{ id: 'p1', file: '/tv/show/s02e01.mkv', container: 'mkv' }]
      }
    ]
  };
  const out = normalizePlexVariant(input, '7');
  assert.strictEqual(out.source_item_key, '7:show:show-999:season:2');
  assert.strictEqual(out.edition, 'Season 2');
  assert.strictEqual(out.source_part_id, null);
  assert.strictEqual(out.video_codec, 'h264');
}));

results.push(run('scope.extractScopeHints resolves space/library inputs', () => {
  const req = {
    query: { space_id: '3' },
    body: { library_id: 'all' },
    headers: {}
  };
  const hints = extractScopeHints(req);
  assert.strictEqual(hints.spaceId, 3);
  assert.strictEqual(hints.libraryId, null);
  assert.strictEqual(hints.libraryCleared, true);
}));

results.push(run('scope.resolveScopeContext prefers request scope context', () => {
  const req = {
    scopeContext: { spaceId: 9, libraryId: 12 },
    user: { activeSpaceId: 1, activeLibraryId: 2 }
  };
  const scope = resolveScopeContext(req);
  assert.deepStrictEqual(scope, { spaceId: 9, libraryId: 12 });
}));

results.push(run('scope.appendScopeSql appends scoped clauses and params', () => {
  const params = ['title'];
  const clause = appendScopeSql(params, { spaceId: 4, libraryId: 10 });
  assert.strictEqual(clause, ' AND space_id = $2 AND library_id = $3');
  assert.deepStrictEqual(params, ['title', 4, 10]);
}));

results.push(run('importMapping maps Delicious VideoGame to game', () => {
  assert.strictEqual(mapDeliciousItemTypeToMediaType('VideoGame'), 'game');
  assert.strictEqual(mapDeliciousItemTypeToMediaType('video game'), 'game');
  assert.strictEqual(mapDeliciousItemTypeToMediaType('Movie'), 'movie');
}));

results.push(run('deliciousNormalize extracts platform and ASIN', () => {
  const row = {
    title: 'Ace Combat 4: Shattered Skies - PlayStation 2',
    platform: '',
    'amazon link': 'https://www.amazon.com/dp/B00005NZ1G',
    EAN: '0043396-030145',
    ISBN: '',
    creator: 'Namco',
    edition: 'Greatest Hits',
    format: 'DVD'
  };
  const out = normalizeDeliciousRow(row);
  assert.strictEqual(out.normalizedTitle, 'Ace Combat 4: Shattered Skies');
  assert.strictEqual(out.normalizedPlatform, 'PlayStation 2');
  assert.strictEqual(out.amazonItemId, 'B00005NZ1G');
  assert.strictEqual(out.ean, '0043396030145');
}));

results.push(run('importIdentifiers normalizes ISBN-10 to ISBN-13', () => {
  const isbn13 = normalizeIsbn('0-345-39180-2');
  assert.strictEqual(isbn13, '9780345391803');
}));

results.push(run('importIdentifiers normalizes identifier set fields', () => {
  const out = normalizeIdentifierSet({
    isbn: '978-0-316-76948-0',
    ean_upc: '0 12345 67890 5',
    asin: 'https://www.amazon.com/dp/B00005NZ1G'
  });
  assert.strictEqual(out.isbn, '9780316769480');
  assert.strictEqual(out.eanUpc, '012345678905');
  assert.strictEqual(out.asin, 'B00005NZ1G');
}));

if (results.some((ok) => !ok)) {
  process.exit(1);
}

console.log(`All unit tests passed (${results.length})`);
