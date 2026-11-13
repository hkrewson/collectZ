#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { fetchBookOrbitOpdsItems, enrichBookOrbitRowsWithNativeMetadata } = require('../services/bookOrbit');

function feed({ id, title, links = [], entries = [] }) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/">',
    `  <id>${id}</id>`,
    `  <title>${title}</title>`,
    '  <updated>2026-11-10T20:00:00.000Z</updated>',
    ...links,
    ...entries,
    '</feed>'
  ].join('\n');
}

function bookEntry({ id, isbn, title = 'BookOrbit Foundation Book', mime = 'application/epub+zip', extension = 'epub' }) {
  return [
    '  <entry>',
    `    <id>urn:bookorbit:book:${id}</id>`,
    `    <title>${title}</title>`,
    '    <updated>2026-11-10T19:00:00.000Z</updated>',
    '    <author><name>Foundation Author</name></author>',
    `    <dc:identifier>urn:isbn:${isbn}</dc:identifier>`,
    '    <dc:publisher>Foundation Press</dc:publisher>',
    '    <link rel="http://opds-spec.org/sort/series" href="/api/v1/opds/catalog?seriesId=9" title="Foundation Series #2"/>',
    `    <link rel="http://opds-spec.org/acquisition" type="${mime}" href="/api/v1/opds/${id}/download?fileId=8.${extension}"/>`,
    `    <link rel="http://opds-spec.org/image" type="image/jpeg" href="/api/v1/opds/${id}/cover"/>`,
    '  </entry>'
  ].join('\n');
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('BookOrbit smoke server did not start');
  return `http://127.0.0.1:${address.port}`;
}

async function expectCode(work, code) {
  await assert.rejects(work, (error) => {
    assert.equal(error.code, code);
    assert.equal(JSON.stringify(error).includes('password'), false);
    return true;
  });
}

async function main() {
  const username = `bookorbit-${crypto.randomBytes(6).toString('hex')}`;
  const password = crypto.randomBytes(32).toString('base64url');
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const apiKey = `bok_${crypto.randomBytes(24).toString('hex')}`;
  let currentIsbn = '9781476735402';
  const requestedPaths = [];
  const server = http.createServer((req, res) => {
    requestedPaths.push(req.url);
    if (req.url === '/api/v1/books/42') {
      if (req.headers['x-api-key'] !== apiKey) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'unauthorized' }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        id: 42,
        seriesName: 'Foundation Series',
        seriesIndex: '2',
        providerIds: { comicvine: '90042', goodreads: '80042' },
        comicMetadata: { issueNumber: '2', pencillers: ['Native Artist'] }
      }));
    }
    if (req.url === '/api/v1/books/43') {
      res.writeHead(503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'temporarily unavailable' }));
    }
    if (req.headers.authorization !== authorization) {
      res.writeHead(401, { 'content-type': 'application/atom+xml' });
      return res.end(feed({ id: 'urn:bookorbit:unauthorized', title: 'Unauthorized' }));
    }
    res.setHeader('content-type', 'application/atom+xml; charset=utf-8');
    if (req.url === '/api/v1/opds') {
      return res.end(feed({
        id: 'urn:bookorbit:root',
        title: 'BookOrbit',
        entries: [
          '  <entry><id>urn:bookorbit:all</id><title>All Books</title><updated>2026-11-10T20:00:00.000Z</updated><link rel="subsection" type="application/atom+xml;profile=opds-catalog" href="/api/v1/opds/catalog?page=1"/></entry>',
          '  <entry><id>urn:bookorbit:recent</id><title>Recent</title><updated>2026-11-10T20:00:00.000Z</updated><link rel="subsection" type="application/atom+xml;profile=opds-catalog" href="/api/v1/opds/recent"/></entry>'
        ]
      }));
    }
    if (req.url === '/api/v1/opds/catalog?page=1') {
      return res.end(feed({
        id: 'urn:bookorbit:catalog',
        title: 'Catalog',
        links: ['  <link rel="next" href="/api/v1/opds/catalog?page=2"/>'],
        entries: [bookEntry({ id: 42, isbn: currentIsbn })]
      }));
    }
    if (req.url === '/api/v1/opds/catalog?page=2') {
      return res.end(feed({
        id: 'urn:bookorbit:catalog:2',
        title: 'Catalog',
        entries: [bookEntry({
          id: 43,
          isbn: '9781401207925',
          title: 'Foundation Comic',
          mime: 'application/vnd.comicbook+zip',
          extension: 'cbz'
        })]
      }));
    }
    if (req.url === '/api/v1/opds/recent') {
      return res.end(feed({
        id: 'urn:bookorbit:recent',
        title: 'Recent',
        entries: [bookEntry({ id: 42, isbn: currentIsbn })]
      }));
    }
    if (req.url === '/api/v1/opds/cycle') {
      return res.end(feed({
        id: 'urn:bookorbit:cycle',
        title: 'Cycle',
        links: ['  <link rel="next" href="/api/v1/opds/cycle"/>']
      }));
    }
    if (req.url === '/api/v1/opds/unsafe') {
      return res.end(feed({
        id: 'urn:bookorbit:unsafe',
        title: 'Unsafe',
        entries: ['  <entry><id>urn:bookorbit:nav</id><title>Unsafe</title><updated>2026-11-10T20:00:00.000Z</updated><link rel="subsection" type="application/atom+xml" href="http://example.invalid/opds"/></entry>']
      }));
    }
    if (req.url === '/api/v1/opds/oversized') {
      return res.end(feed({
        id: 'urn:bookorbit:oversized',
        title: 'Oversized',
        entries: [`  <entry><id>urn:bookorbit:book:90</id><title>${'X'.repeat(2400)}</title><updated>2026-11-10T20:00:00.000Z</updated><link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="/download/90"/></entry>`]
      }));
    }
    if (req.url === '/api/v1/opds/malformed') {
      return res.end('<?xml version="1.0"?><not-a-feed/>');
    }
    if (req.url === '/api/v1/opds/stalled') {
      return setTimeout(() => res.end(feed({ id: 'urn:bookorbit:stalled', title: 'Stalled' })), 1500);
    }
    res.writeHead(404, { 'content-type': 'application/atom+xml' });
    return res.end(feed({ id: 'urn:bookorbit:missing', title: 'Missing' }));
  });

  const baseUrl = await listen(server);
  const config = { endpointUrl: `${baseUrl}/api/v1/opds`, username, password, timeoutMs: 5000 };
  try {
    const first = await fetchBookOrbitOpdsItems(config, { maxPages: 3 });
    assert.equal(first.pagesFetched, 3);
    assert.equal(first.rows.length, 2);
    assert.deepEqual(requestedPaths.splice(0), [
      '/api/v1/opds',
      '/api/v1/opds/catalog?page=1',
      '/api/v1/opds/catalog?page=2'
    ]);
    assert.equal(first.rows[0].type_details.provider_item_id, 'urn:bookorbit:book:42');
    assert.equal(first.rows[0].type_details.isbn, '9781476735402');
    assert.equal(first.rows[0].type_details.series, 'Foundation Series');
    assert.equal(first.rows[0].type_details.series_index, '2');
    assert.equal(first.rows[0].type_details.provider_external_url, null);
    assert.match(first.rows[0].type_details.provider_download_url, /\/42\/download/);
    assert.equal(first.rows[0].release_date, null);
    assert.equal(first.rows[0].type_details.source_updated_at, '2026-11-10T19:00:00.000Z');
    assert.equal(first.rows[1].media_type, 'comic_book');

    const native = await enrichBookOrbitRowsWithNativeMetadata(first.rows, {
      baseUrl,
      apiKey,
      timeoutMs: 5000
    }, { concurrency: 2 });
    assert.equal(native.configured, true);
    assert.equal(native.attempted, 2);
    assert.equal(native.enriched, 1);
    assert.equal(native.fallback, 1);
    assert.equal(native.providerIdentifierRows, 1);
    assert.equal(native.rows[0].type_details.bookorbit_book_id, '42');
    assert.equal(native.rows[0].type_details.bookorbit_comicvine_id, '90042');
    assert.equal(native.rows[0].type_details.provider_name, 'bookorbit');
    assert.equal(native.rows[1].type_details.bookorbit_native_metadata, undefined);

    currentIsbn = '9780306406157';
    const repeated = await fetchBookOrbitOpdsItems(config, { maxPages: 3 });
    assert.equal(repeated.rows[0].type_details.provider_item_id, first.rows[0].type_details.provider_item_id);
    assert.equal(repeated.rows[0].type_details.isbn, '9780306406157');

    await expectCode(
      () => fetchBookOrbitOpdsItems({ ...config, password: crypto.randomBytes(24).toString('hex') }),
      'OPDS_AUTHENTICATION_FAILED'
    );
    await expectCode(
      () => fetchBookOrbitOpdsItems({ ...config, endpointUrl: `${baseUrl}/api/v1/opds/cycle` }),
      'OPDS_PAGINATION_CYCLE'
    );
    await expectCode(
      () => fetchBookOrbitOpdsItems({ ...config, endpointUrl: `${baseUrl}/api/v1/opds/unsafe` }),
      'OPDS_UNSAFE_URL'
    );
    await expectCode(() => fetchBookOrbitOpdsItems(config, { maxPages: 2 }), 'OPDS_PAGE_LIMIT_EXCEEDED');
    await expectCode(
      () => fetchBookOrbitOpdsItems({ ...config, endpointUrl: `${baseUrl}/api/v1/opds/oversized` }, { maxResponseBytes: 1024 }),
      'OPDS_RESPONSE_TOO_LARGE'
    );
    await expectCode(
      () => fetchBookOrbitOpdsItems({ ...config, endpointUrl: `${baseUrl}/api/v1/opds/malformed` }),
      'OPDS_MALFORMED_FEED'
    );
    await expectCode(
      () => fetchBookOrbitOpdsItems({ ...config, endpointUrl: `${baseUrl}/api/v1/opds/stalled`, timeoutMs: 1000 }),
      'OPDS_REQUEST_TIMEOUT'
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(JSON.stringify({
    passed: true,
    pages: 3,
    publications: 2,
    protections: ['authentication', 'cycle', 'origin', 'page_limit', 'response_limit', 'malformed_feed', 'timeout', 'native_fallback']
  }));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
