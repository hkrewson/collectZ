'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const {
  fetchPlexMediaProviders,
  extractPlexProviderItemListingCandidates
} = require('../services/plex');

const repoRoot = path.resolve(__dirname, '..', '..');
const evidencePath = path.join(repoRoot, 'artifacts', 'plex-provider-item-listing-discovery', 'plex-provider-item-listing-discovery-smoke.json');
const fakeToken = `plex-provider-item-listing-${Date.now().toString(36)}`;

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
  assert(!text.includes('must-not-surface'), 'Evidence must not expose raw provider secrets');
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
            token: 'must-not-surface',
            url: 'http://127.0.0.1/private',
            Feature: [
              {
                key: 'content',
                type: 'content',
                Directory: [
                  {
                    title: 'Movies',
                    type: 'movie',
                    key: '/library/sections/1/all',
                    content: true,
                    hubKey: '/hubs/sections/1',
                    thumb: '/private/media/provider-movie-thumb.jpg'
                  },
                  {
                    title: 'TV Shows',
                    type: 'show',
                    key: '/library/sections/2/all',
                    content: true,
                    hubKey: '/hubs/sections/2',
                    art: '/private/media/provider-tv-art.jpg'
                  },
                  {
                    title: 'Unsafe absolute URL',
                    type: 'movie',
                    key: 'http://127.0.0.1/private?X-Plex-Token=must-not-surface',
                    content: true
                  }
                ]
              },
              {
                key: 'metadata',
                Directory: [{
                  title: 'Metadata root',
                  type: 'metadata',
                  key: '/library/metadata',
                  content: false
                }]
              }
            ]
          }]
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
    const providers = await fetchPlexMediaProviders({
      plexApiUrl: fake.baseUrl,
      plexApiKey: fakeToken,
      plexApiKeyQueryParam: 'X-Plex-Token'
    });
    const candidates = extractPlexProviderItemListingCandidates(providers);

    assert(providers.length === 1, `Expected one sanitized provider: ${JSON.stringify(providers)}`);
    assert(candidates.length === 2, `Expected two item listing candidates: ${JSON.stringify(candidates)}`);
    assert(candidates.some((entry) => entry.key === '/library/sections/1/all' && entry.type === 'movie'), `Expected movie listing candidate: ${JSON.stringify(candidates)}`);
    assert(candidates.some((entry) => entry.key === '/library/sections/2/all' && entry.type === 'show'), `Expected show listing candidate: ${JSON.stringify(candidates)}`);
    assert(candidates.every((entry) => entry.content === true), 'Expected candidates to require content directories');
    assert(fake.requests.length === 1 && fake.requests[0].pathname === '/media/providers', `Expected only provider discovery request: ${JSON.stringify(fake.requests)}`);
    assert(fake.requests.every((entry) => entry.hasToken && entry.tokenMatched), 'Expected fake PMS request to authenticate');

    const evidence = {
      generatedAt: new Date().toISOString(),
      provider: 'plex',
      processingMode: 'provider_item_listing_discovery_contract',
      readOnly: true,
      importMutation: false,
      plexWriteback: false,
      discoverySource: {
        path: '/media/providers',
        providerCount: providers.length,
        candidateCount: candidates.length
      },
      providerItemListingCandidates: candidates,
      decision: 'provider_advertised_item_listing_candidates_found_but_import_behavior_remains_legacy_until_real_server_field_parity_is_proven',
      nextProofNeeded: [
        'Probe the saved real PMS provider directories and confirm candidate item rows include Plex rating keys.',
        'Confirm candidate item rows include strong external identities such as TMDB GUIDs where Plex exposes them.',
        'Confirm candidate item rows preserve poster/artwork keys, media variants, season/episode counts, watched state, and user ratings before replacing legacy section imports.'
      ],
      requests: fake.requests.map((entry) => ({
        method: entry.method,
        pathname: entry.pathname,
        hasToken: entry.hasToken,
        tokenMatched: entry.tokenMatched,
        accept: entry.accept
      })),
      assertions: [
        'provider feature directories can advertise content listing keys',
        'unsafe absolute provider URLs and token-bearing keys are ignored',
        'the proof does not call import endpoints or mutate collectZ rows',
        'legacy import remains current until real-server provider item rows prove field parity'
      ]
    };

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
