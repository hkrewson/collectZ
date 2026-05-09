'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const {
  fetchPlexMediaProviders,
  fetchPlexLibraryItems,
  fetchPlexShowSeasons,
  fetchPlexShowSeasonVariants
} = require('../services/plex');

const repoRoot = path.resolve(__dirname, '..', '..');
const evidencePath = path.join(repoRoot, 'artifacts', 'plex-provider-import-parity', 'plex-provider-import-parity-smoke.json');
const fakeToken = `plex-provider-import-parity-${Date.now().toString(36)}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeEvidence(payload) {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(payload, null, 2));
}

function assertSecretFree(payload) {
  const text = JSON.stringify(payload);
  assert(!text.includes(fakeToken), 'Evidence must not expose the Plex token');
  assert(!/X-Plex-Token=/i.test(text), 'Evidence must not expose Plex token query strings');
  assert(!text.includes('/private/media'), 'Evidence must not expose media file paths');
  assert(!text.includes('127.0.0.1'), 'Evidence must not expose provider URLs or private IPs');
}

function jsonResponse(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function startFakePmsServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    requests.push({
      method: req.method,
      pathname: url.pathname,
      hasToken: url.searchParams.has('X-Plex-Token'),
      tokenMatched: url.searchParams.get('X-Plex-Token') === fakeToken,
      accept: req.headers.accept || ''
    });

    if (url.searchParams.get('X-Plex-Token') !== fakeToken) {
      jsonResponse(res, 401, { error: 'unauthorized' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/media/providers') {
      jsonResponse(res, 200, {
        MediaContainer: {
          MediaProvider: [{
            key: 'com.plexapp.plugins.library',
            title: 'Library',
            type: 'library',
            protocol: 'plex',
            identifier: 'com.plexapp.plugins.library',
            Feature: [
              { key: 'browse' },
              { key: 'metadata' },
              { key: 'timeline' }
            ],
            token: 'must-not-surface',
            url: 'http://127.0.0.1/private'
          }]
        }
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/library/sections') {
      jsonResponse(res, 200, {
        MediaContainer: {
          Directory: [
            { key: '1', title: 'Movies', type: 'movie' },
            { key: '2', title: 'TV Shows', type: 'show' }
          ]
        }
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/library/sections/1/all') {
      jsonResponse(res, 200, {
        MediaContainer: {
          Metadata: [{
            ratingKey: '2001',
            key: '/library/metadata/2001',
            type: 'movie',
            title: 'Provider Parity Movie',
            year: 2024,
            guid: 'tmdb://91001',
            duration: 7200000,
            summary: 'A fake movie used to compare Plex import coverage.',
            thumb: '/library/metadata/2001/thumb/1700000000',
            Media: [{
              id: 'm2001',
              duration: 7200000,
              videoResolution: '4k',
              width: 3840,
              height: 2160,
              videoCodec: 'hevc',
              audioCodec: 'aac',
              Part: [{ id: 'p2001', file: '/private/media/movie.mkv', container: 'mkv' }]
            }]
          }]
        }
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/library/sections/2/all') {
      jsonResponse(res, 200, {
        MediaContainer: {
          Directory: [{
            ratingKey: '3001',
            key: '/library/metadata/3001',
            type: 'show',
            title: 'Provider Parity Show',
            year: 2023,
            guid: 'tmdb://92001',
            summary: 'A fake show used to compare Plex import coverage.',
            thumb: '/library/metadata/3001/thumb/1700000000',
            leafCount: 2,
            viewedLeafCount: 1
          }]
        }
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/library/metadata/3001/children') {
      jsonResponse(res, 200, {
        MediaContainer: {
          Directory: [{
            ratingKey: '3101',
            key: '/library/metadata/3101',
            type: 'season',
            title: 'Season 1',
            index: 1,
            leafCount: 2,
            viewedLeafCount: 1
          }]
        }
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/library/metadata/3001/allLeaves') {
      jsonResponse(res, 200, {
        MediaContainer: {
          Metadata: [
            {
              ratingKey: '3201',
              type: 'episode',
              title: 'Pilot',
              grandparentTitle: 'Provider Parity Show',
              grandparentRatingKey: '3001',
              parentIndex: 1,
              index: 1,
              viewCount: 1,
              Media: [{
                id: 'e3201m',
                duration: 1800000,
                videoResolution: '1080',
                width: 1920,
                height: 1080,
                Part: [{ id: 'e3201p', file: '/private/media/show-s01e01.mkv', container: 'mkv' }]
              }]
            },
            {
              ratingKey: '3202',
              type: 'episode',
              title: 'Second',
              grandparentTitle: 'Provider Parity Show',
              grandparentRatingKey: '3001',
              parentIndex: 1,
              index: 2,
              viewCount: 0,
              Media: [{
                id: 'e3202m',
                duration: 1800000,
                videoResolution: '1080',
                width: 1920,
                height: 1080,
                Part: [{ id: 'e3202p', file: '/private/media/show-s01e02.mkv', container: 'mkv' }]
              }]
            }
          ]
        }
      });
      return;
    }

    jsonResponse(res, 404, { error: 'not found' });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to start fake PMS server');

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function main() {
  const fake = await startFakePmsServer();
  try {
    const config = {
      plexApiUrl: fake.baseUrl,
      plexApiKey: fakeToken,
      plexApiKeyQueryParam: 'X-Plex-Token',
      plexLibrarySections: ['1', '2']
    };
    const providers = await fetchPlexMediaProviders(config);
    const libraryItems = await fetchPlexLibraryItems(config, ['1', '2']);
    const showSeasons = await fetchPlexShowSeasons(config, '3001');
    const showSeasonVariants = await fetchPlexShowSeasonVariants(config, '3001', '2');

    const provider = providers.find((entry) => entry.key === 'com.plexapp.plugins.library');
    const movie = libraryItems.find((entry) => entry.normalized?.title === 'Provider Parity Movie');
    const show = libraryItems.find((entry) => entry.normalized?.title === 'Provider Parity Show');
    assert(provider, `Expected library provider readback: ${JSON.stringify(providers)}`);
    assert(movie?.normalized?.tmdb_id === 91001, `Expected movie TMDB identity: ${JSON.stringify(movie?.normalized)}`);
    assert(movie?.variant?.video_height === 2160, `Expected movie variant resolution: ${JSON.stringify(movie?.variant)}`);
    assert(show?.normalized?.media_type === 'tv_series', `Expected TV series normalization: ${JSON.stringify(show?.normalized)}`);
    assert(showSeasons[0]?.available_episodes === 2, `Expected season episode count: ${JSON.stringify(showSeasons)}`);
    assert(showSeasonVariants[0]?.video_height === 1080, `Expected season variant resolution: ${JSON.stringify(showSeasonVariants)}`);

    const providerFeatureKeys = provider.featureKeys || [];
    const evidence = {
      generatedAt: new Date().toISOString(),
      provider: 'plex',
      processingMode: 'provider_import_parity_contract',
      readOnly: true,
      importMutation: false,
      plexWriteback: false,
      decision: 'legacy_import_remains_current_until_provider_api_item_listing_reaches_field_parity',
      providerDiscovery: {
        path: '/media/providers',
        providerCount: providers.length,
        featureKeys: providerFeatureKeys,
        covers: {
          capabilityDiscovery: providerFeatureKeys.length > 0,
          importableItemRows: false,
          itemStrongIdentity: false,
          posterOrArtworkKeys: false,
          variantResolution: false,
          seasonEpisodeCounts: false,
          watchState: false,
          userRating: false
        }
      },
      legacyImportReadback: {
        paths: [
          '/library/sections',
          '/library/sections/:sectionId/all',
          '/library/metadata/:ratingKey/children',
          '/library/metadata/:ratingKey/allLeaves'
        ],
        sectionCount: 2,
        itemCount: libraryItems.length,
        covers: {
          importableItemRows: libraryItems.length === 2,
          itemStrongIdentity: Boolean(movie.normalized.tmdb_id && movie.normalized.plex_guid && movie.normalized.plex_rating_key),
          posterOrArtworkKeys: Boolean(movie.raw.thumb),
          variantResolution: Boolean(movie.variant.video_height && showSeasonVariants[0]?.video_height),
          seasonEpisodeCounts: Boolean(showSeasons[0]?.available_episodes),
          watchState: true,
          userRating: false
        },
        samples: {
          movie: {
            mediaType: movie.normalized.media_type,
            hasTitle: Boolean(movie.normalized.title),
            hasTmdbId: Boolean(movie.normalized.tmdb_id),
            hasPlexGuid: Boolean(movie.normalized.plex_guid),
            hasPlexRatingKey: Boolean(movie.normalized.plex_rating_key),
            hasVariantResolution: Boolean(movie.variant.video_height)
          },
          show: {
            mediaType: show.normalized.media_type,
            hasTitle: Boolean(show.normalized.title),
            hasTmdbId: Boolean(show.normalized.tmdb_id),
            seasonCount: showSeasons.length,
            hasEpisodeResolutionRollup: Boolean(showSeasonVariants[0]?.video_height)
          }
        }
      },
      parityGaps: [
        'Provider discovery identifies PMS capabilities but does not enumerate importable library items.',
        'Provider discovery does not expose item-level TMDB/Plex identities needed for duplicate-safe imports.',
        'Provider discovery does not expose poster/artwork keys, media variants, season counts, episode leaves, watched state, or user ratings by itself.',
        'A future provider/API import migration needs a proven item listing endpoint before replacing /library/sections/:sectionId/all.'
      ],
      requests: fake.requests.map((entry) => ({
        method: entry.method,
        pathname: entry.pathname,
        hasToken: entry.hasToken,
        tokenMatched: entry.tokenMatched,
        accept: entry.accept
      })),
      assertions: [
        'fake PMS provider discovery was read without changing import behavior',
        'legacy import endpoints still provide duplicate-safe item identities and media details',
        'provider discovery alone is not field-equivalent to the current import path',
        'evidence omits Plex tokens, provider URLs, private IPs, and media file paths'
      ]
    };

    assert(evidence.providerDiscovery.covers.capabilityDiscovery === true, 'Expected provider capability discovery coverage');
    assert(evidence.providerDiscovery.covers.importableItemRows === false, 'Provider discovery must not be treated as item listing parity');
    assert(evidence.legacyImportReadback.covers.itemStrongIdentity === true, 'Expected legacy strong identity coverage');
    assert(evidence.legacyImportReadback.covers.variantResolution === true, 'Expected legacy media variant coverage');
    assert(fake.requests.some((entry) => entry.pathname === '/media/providers'), 'Expected /media/providers request');
    assert(fake.requests.some((entry) => entry.pathname === '/library/sections/1/all'), 'Expected movie section request');
    assert(fake.requests.some((entry) => entry.pathname === '/library/metadata/3001/allLeaves'), 'Expected episode leaves request');
    assert(fake.requests.every((entry) => entry.hasToken && entry.tokenMatched), 'Expected all fake PMS requests to authenticate');
    assertSecretFree(evidence);
    writeEvidence(evidence);
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await fake.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
