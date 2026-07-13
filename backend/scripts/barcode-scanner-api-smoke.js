'use strict';

const bcrypt = require('bcrypt');
const http = require('http');
const pool = require('../db/pool');
const { ensureUserDefaultScope } = require('../services/libraries');
const { createPersonalAccessToken } = require('../services/personalAccessTokens');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { method = 'GET', token = '', body = null, expectStatus = null } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== null) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (expectStatus !== null && response.status !== expectStatus) {
    throw new Error(`${method} ${path} expected ${expectStatus}, got ${response.status}: ${JSON.stringify(data)}`);
  }
  return { status: response.status, data };
}

async function createSmokeUser() {
  const suffix = Date.now();
  const passwordHash = await bcrypt.hash(`BarcodeSmoke-${suffix}`, 12);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, $3, 'user', true, NOW())
     RETURNING id`,
    [`barcode-scanner-smoke-${suffix}@example.com`, passwordHash, 'Barcode Scanner Smoke']
  );
  const userId = Number(result.rows[0]?.id || 0);
  const scope = await ensureUserDefaultScope(userId);
  await pool.query(
    `UPDATE users
        SET active_library_id = COALESCE($2, active_library_id),
            scope_space_id = COALESCE($3, scope_space_id),
            active_space_id = COALESCE($3, active_space_id)
      WHERE id = $1`,
    [userId, scope.libraryId || null, scope.spaceId || null]
  ).catch(() => {});
  if (scope.spaceId) {
    await pool.query(
      `INSERT INTO space_memberships (space_id, user_id, role, created_by)
       VALUES ($1, $2, 'owner', $2)
       ON CONFLICT (space_id, user_id) DO NOTHING`,
      [scope.spaceId, userId]
    );
  }
  if (scope.libraryId) {
    await pool.query(
      `INSERT INTO library_memberships (user_id, library_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (user_id, library_id) DO NOTHING`,
      [userId, scope.libraryId]
    );
  }
  const token = await createPersonalAccessToken({
    userId,
    name: 'Barcode scanner smoke',
    scopes: ['media:read', 'import:run']
  });
  return { userId, token: token.token, ...scope };
}

async function seedMedia({ userId, libraryId, spaceId, upc }) {
  const result = await pool.query(
    `INSERT INTO media (title, media_type, year, format, upc, library_id, space_id, added_by, import_source)
     VALUES ('Barcode Scanner Existing Match', 'movie', 2026, 'Blu-ray', $1, $2, $3, $4, 'barcode_scanner_smoke')
     RETURNING id`,
    [upc, libraryId, spaceId, userId]
  );
  return Number(result.rows[0]?.id || 0);
}

async function configureFakeBarcodeProvider({ spaceId, barcodeUrl, booksUrl }) {
  await pool.query(
    `INSERT INTO app_integrations (space_id, barcode_preset, barcode_api_url, books_preset, books_api_url)
     VALUES ($1, 'upcitemdb', $2, 'googlebooks', $3)
     ON CONFLICT (space_id)
     DO UPDATE SET barcode_preset = EXCLUDED.barcode_preset,
                   barcode_api_url = EXCLUDED.barcode_api_url,
                   books_preset = EXCLUDED.books_preset,
                   books_api_url = EXCLUDED.books_api_url,
                   updated_at = CURRENT_TIMESTAMP`,
    [spaceId, barcodeUrl, booksUrl]
  );
}

async function startFakeProvider() {
  const multiUpc = '0076783005990';
  const gameUpc = '0045496742508';
  const isbn = '9780553572735';
  const isbnNoMatch = '0553572393';
  const isbnNoMatchCanonical = '9780553572391';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/books') {
      const q = url.searchParams.get('q') || '';
      res.setHeader('Content-Type', 'application/json');
      if (q === `isbn:${isbn}`) {
        res.end(JSON.stringify({
          totalItems: 1,
          items: [
            {
              id: 'google-before-the-storm',
              volumeInfo: {
                title: 'Before the Storm',
                authors: ['Michael P. Kube-McDowell'],
                publisher: 'Bantam',
                publishedDate: '1996',
                description: 'Book one of the Black Fleet Crisis trilogy.',
                industryIdentifiers: [
                  { type: 'ISBN_13', identifier: isbn },
                  { type: 'ISBN_10', identifier: '0553572733' }
                ],
                imageLinks: {
                  thumbnail: 'https://example.test/before-the-storm.jpg'
                },
                infoLink: 'https://example.test/books/before-the-storm'
              }
            }
          ]
        }));
        return;
      }
      if (q === `isbn:${isbnNoMatchCanonical}`) {
        res.end(JSON.stringify({ totalItems: 0, items: [] }));
        return;
      }
      res.end(JSON.stringify({ totalItems: 0, items: [] }));
      return;
    }

    const upc = url.searchParams.get('upc') || '';
    res.setHeader('Content-Type', 'application/json');
    if (upc === multiUpc) {
      res.end(JSON.stringify({
        code: 'OK',
        total: 1,
        items: [
          {
            title: 'Crystal Star, The New Condition!',
            description: 'Top-level provider candidate with offer title variants.',
            upc,
            brand: 'Provider Fixture',
            year: 2024,
            offers: [
              { title: 'Before the Storm', merchant: 'Bookseller A' },
              { title: 'Crystal Star, The New Condition!', merchant: 'Bookseller B' },
              { title: 'Before the Storm #1 Black Fleet Crisis', merchant: 'Bookseller C' }
            ]
          }
        ]
      }));
      return;
    }
    if (upc === gameUpc) {
      res.end(JSON.stringify({
        code: 'OK',
        total: 1,
        items: [
          {
            title: 'Nintendo Pokemon Y (Nintendo 3DS)',
            description: 'Retail game fixture with Nintendo 3DS platform metadata.',
            upc,
            brand: 'Nintendo',
            category: 'Video Games',
            offers: [
              { title: 'Pokemon Y - Nintendo 3DS', merchant: 'Game Store A' },
              { title: 'Pokemon Y - Pre-Played', merchant: 'Game Store B' },
              { title: 'Pokemon Y for Nintendo 3DS, Multicolor', merchant: 'Game Store C' }
            ]
          }
        ]
      }));
      return;
    }
    if (upc === isbnNoMatch || upc === isbnNoMatchCanonical) {
      res.end(JSON.stringify({
        code: 'OK',
        total: 1,
        items: [
          {
            title: 'Wrong generic barcode fallback',
            description: 'This result must not appear for valid ISBN direct no-match lookups.',
            upc,
            brand: 'Provider Fixture'
          }
        ]
      }));
      return;
    }
    res.end(JSON.stringify({ code: 'OK', total: 0, items: [] }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    multiUpc,
    gameUpc,
    isbn,
    isbnNoMatch,
    isbnNoMatchCanonical,
    barcodeUrl: `http://127.0.0.1:${address.port}/lookup`,
    booksUrl: `http://127.0.0.1:${address.port}/books`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function cleanup({ userId, libraryId, spaceId }) {
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
    await pool.query('DELETE FROM personal_access_tokens WHERE user_id = $1', [userId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
  }
}

async function main() {
  const context = await createSmokeUser();
  const fakeProvider = await startFakeProvider();
  const existingUpc = '123456789012';
  try {
    await configureFakeBarcodeProvider({
      spaceId: context.spaceId,
      barcodeUrl: fakeProvider.barcodeUrl,
      booksUrl: fakeProvider.booksUrl
    });
    const seededMediaId = await seedMedia({ ...context, upc: existingUpc });
    assert(seededMediaId, 'failed to seed existing barcode media row');

    const unauthenticatedLookup = await request('/api/media/lookup/barcode', {
      method: 'POST',
      body: { barcode: existingUpc, symbology: 'ean13' },
      expectStatus: 401
    });
    assert(unauthenticatedLookup.data?.error, 'unauthenticated lookup should return an auth error');

    const lookup = await request('/api/media/lookup/barcode', {
      method: 'POST',
      token: context.token,
      body: { barcode: existingUpc, symbology: 'ean13', mediaType: 'movie' },
      expectStatus: 200
    });
    assert(lookup.data?.ok === true, 'lookup should return ok=true');
    assert(Array.isArray(lookup.data?.matches), 'lookup should return matches array');
    assert(lookup.data.matches.some((match) => Number(match.media_id) === seededMediaId), 'lookup should include seeded catalog match');

    const emptyLookup = await request('/api/media/lookup/barcode', {
      method: 'POST',
      token: context.token,
      body: { barcode: '000011112222', symbology: 'upca', mediaType: 'movie' },
      expectStatus: 200
    });
    assert(emptyLookup.data?.ok === true, 'empty lookup should still return ok=true');
    assert(Array.isArray(emptyLookup.data?.matches), 'empty lookup should return matches array');

    const multiProviderLookup = await request('/api/media/lookup/barcode', {
      method: 'POST',
      token: context.token,
      body: { barcode: fakeProvider.multiUpc, symbology: 'ean13', mediaType: 'movie', limit: 10 },
      expectStatus: 200
    });
    assert(multiProviderLookup.data?.ok === true, 'multi-provider lookup should return ok=true');
    const providerMatches = (multiProviderLookup.data.matches || []).filter((match) => match.source === 'upcitemdb');
    assert(providerMatches.length === 3, `multi-provider lookup should preserve 3 provider matches, got ${providerMatches.length}`);
    assert(providerMatches.some((match) => match.title === 'Before the Storm'), 'provider offer title variant should be returned as a scanner match');
    assert(providerMatches.some((match) => match.match_type === 'provider_title_variant'), 'scanner match should identify provider title variants');
    const providerIds = new Set(providerMatches.map((match) => match.id));
    assert(providerIds.size === providerMatches.length, 'provider candidates should have unique ids');

    const gameLookup = await request('/api/media/lookup/barcode', {
      method: 'POST',
      token: context.token,
      body: { barcode: fakeProvider.gameUpc, symbology: 'ean13', limit: 10 },
      expectStatus: 200
    });
    assert(gameLookup.data?.ok === true, 'game lookup should return ok=true');
    const gameMatches = (gameLookup.data.matches || []).filter((match) => match.source === 'upcitemdb');
    assert(gameMatches.length === 4, `game lookup should preserve provider game variants, got ${gameMatches.length}`);
    assert(gameMatches.every((match) => match.media_type === 'game' || match.mediaTypeGuess === 'game'), 'game lookup matches should be typed as game');
    assert(gameMatches.every((match) => match.searchTitle === 'Pokemon Y'), 'game lookup variants should use the game title for enrichment search');
    assert(gameMatches.some((match) => match.typeDetails?.platform === 'Nintendo 3DS'), 'game lookup should include platform metadata');

    const webLookup = await request('/api/media/lookup-upc', {
      method: 'POST',
      token: context.token,
      body: { upc: fakeProvider.multiUpc, mediaType: 'book' },
      expectStatus: 200
    });
    const webMatches = Array.isArray(webLookup.data?.matches) ? webLookup.data.matches : [];
    assert(webMatches.some((match) => match.title === 'Before the Storm'), 'web UPC lookup should return provider offer title variants');
    assert(webMatches.some((match) => match.match_type === 'provider_title_variant'), 'web UPC lookup should label provider title variants');

    const scannerIsbnLookup = await request('/api/media/lookup/barcode', {
      method: 'POST',
      token: context.token,
      body: { barcode: fakeProvider.isbn, symbology: 'ean13', limit: 10 },
      expectStatus: 200
    });
    assert(scannerIsbnLookup.data?.ok === true, 'scanner ISBN lookup should return ok=true');
    const scannerIsbnMatches = Array.isArray(scannerIsbnLookup.data?.matches) ? scannerIsbnLookup.data.matches : [];
    assert(scannerIsbnMatches.some((match) => match.source === 'books:isbn-direct' && match.title === 'Before the Storm'), 'scanner ISBN lookup should use direct books enrichment without requiring mediaType=book');

    const webIsbnLookup = await request('/api/media/lookup-upc', {
      method: 'POST',
      token: context.token,
      body: { upc: fakeProvider.isbn, mediaType: 'movie' },
      expectStatus: 200
    });
    const webIsbnMatches = Array.isArray(webIsbnLookup.data?.matches) ? webIsbnLookup.data.matches : [];
    assert(webIsbnMatches.some((match) => match.source === 'books:isbn-direct' && match.title === 'Before the Storm'), 'web ISBN lookup should use direct books enrichment even when mediaType is not book');

    const scannerIsbnNoMatchLookup = await request('/api/media/lookup/barcode', {
      method: 'POST',
      token: context.token,
      body: { barcode: fakeProvider.isbnNoMatch, symbology: 'isbn10', limit: 10 },
      expectStatus: 200
    });
    assert(scannerIsbnNoMatchLookup.data?.ok === true, 'scanner ISBN no-match lookup should return ok=true');
    assert(scannerIsbnNoMatchLookup.data?.provider === 'books:isbn-direct', 'scanner ISBN no-match lookup should stay on books:isbn-direct');
    assert(scannerIsbnNoMatchLookup.data?.request?.isbn === fakeProvider.isbnNoMatchCanonical, 'scanner ISBN no-match lookup should report canonical ISBN-13');
    const scannerIsbnNoMatchMatches = Array.isArray(scannerIsbnNoMatchLookup.data?.matches) ? scannerIsbnNoMatchLookup.data.matches : [];
    assert(scannerIsbnNoMatchMatches.length === 0, `scanner ISBN no-match lookup should return empty matches, got ${scannerIsbnNoMatchMatches.length}`);

    const webIsbnNoMatchLookup = await request('/api/media/lookup-upc', {
      method: 'POST',
      token: context.token,
      body: { upc: fakeProvider.isbnNoMatch, mediaType: 'movie' },
      expectStatus: 200
    });
    assert(webIsbnNoMatchLookup.data?.provider === 'books:isbn-direct', 'web ISBN no-match lookup should stay on books:isbn-direct');
    assert(webIsbnNoMatchLookup.data?.request?.isbn === fakeProvider.isbnNoMatchCanonical, 'web ISBN no-match lookup should report canonical ISBN-13');
    const webIsbnNoMatchMatches = Array.isArray(webIsbnNoMatchLookup.data?.matches) ? webIsbnNoMatchLookup.data.matches : [];
    assert(webIsbnNoMatchMatches.length === 0, `web ISBN no-match lookup should return empty matches, got ${webIsbnNoMatchMatches.length}`);

    const unauthenticatedImport = await request('/api/media/import-barcode', {
      method: 'POST',
      body: {
        barcode: fakeProvider.isbn,
        symbology: 'ean13',
        mediaType: 'book',
        selectedMatch: {
          source: 'barcode_provider',
          title: 'Barcode Scanner Import Smoke',
          mediaTypeGuess: 'book',
          typeDetails: { author: 'Smoke Author', isbn: fakeProvider.isbn }
        }
      },
      expectStatus: 401
    });
    assert(unauthenticatedImport.data?.error, 'unauthenticated import should return an auth error');

    const imported = await request('/api/media/import-barcode', {
      method: 'POST',
      token: context.token,
      body: {
        barcode: fakeProvider.isbn,
        symbology: 'ean13',
        mediaType: 'book',
        selectedMatch: {
          id: 'provider:barcode-scanner-import-smoke',
          source: 'barcode_provider',
          title: 'Before the Storm',
          mediaTypeGuess: 'book',
          typeDetails: { author: 'Michael P. Kube-McDowell', isbn: fakeProvider.isbn }
        }
      }
    });
    assert([200, 201].includes(imported.status), `import should succeed, got ${imported.status}`);
    assert(imported.data?.ok === true, 'import response should return ok=true');
    assert(Number(imported.data?.media_id || 0) > 0, 'import response should include media_id');
    assert(imported.data?.enrichment_status === 'enriched', `import should report enriched status, got ${imported.data?.enrichment_status}`);
    assert(String(imported.data?.lookup_path || '').includes('identifier_first:isbn'), `import should use ISBN enrichment path, got ${imported.data?.lookup_path}`);
    const importedMedia = imported.data?.media || {};
    assert(importedMedia.overview === 'Book one of the Black Fleet Crisis trilogy.', 'imported media should include book enrichment overview');
    assert(importedMedia.poster_path === 'https://example.test/before-the-storm.jpg', 'imported media should include book enrichment cover');
    assert(importedMedia.type_details?.publisher === 'Bantam', 'imported media should include enriched publisher');

    console.log(JSON.stringify({
      ok: true,
      checks: {
        lookupRequiresAuth: true,
        lookupSuccess: true,
        emptyLookupSuccess: true,
        multiProviderLookupSuccess: true,
        gameProviderLookupSuccess: true,
        webLookupTitleVariantSuccess: true,
        scannerIsbnLookupSuccess: true,
        webIsbnLookupSuccess: true,
        scannerIsbnNoFallbackSuccess: true,
        webIsbnNoFallbackSuccess: true,
        importRequiresAuth: true,
        importSuccess: true,
        importEnrichmentSuccess: true
      },
      seededMediaId,
      importedMediaId: imported.data.media_id
    }, null, 2));
  } finally {
    await fakeProvider.close().catch(() => {});
    await cleanup(context);
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error(error.message || error);
  await pool.end().catch(() => {});
  process.exit(1);
});
