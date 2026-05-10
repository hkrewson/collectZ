'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const {
  fetchPlexMediaProviders,
  buildPlexProviderAdvertisedImportPathContract
} = require('../services/plex');

const repoRoot = path.resolve(__dirname, '..', '..');
const evidencePath = path.join(repoRoot, 'artifacts', 'plex-provider-advertised-import-path-contract', 'plex-provider-advertised-import-path-contract-smoke.json');
const fakeToken = `plex-provider-advertised-path-${Date.now().toString(36)}`;

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
            identifier: 'com.plexapp.plugins.library',
            title: 'Library',
            type: 'library',
            protocol: 'plex',
            token: 'must-not-surface',
            url: 'http://127.0.0.1/private',
            Feature: [
              {
                key: 'sections',
                type: 'content',
                Directory: [{
                  title: 'Library Sections',
                  key: '/library/sections/all',
                  type: 'library',
                  content: false
                }]
              },
              {
                key: 'metadata',
                type: 'metadata',
                Directory: [{
                  title: 'Metadata Root',
                  key: '/library/metadata',
                  type: 'metadata',
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
    const contract = buildPlexProviderAdvertisedImportPathContract(providers);

    assert(providers.length === 1, `Expected one sanitized provider: ${JSON.stringify(providers)}`);
    assert(contract.providerFound === true, `Expected library provider: ${JSON.stringify(contract)}`);
    assert(contract.providerAdvertisedSectionsRoot === true, `Expected advertised sections root: ${JSON.stringify(contract)}`);
    assert(contract.sectionsRootPath === '/library/sections/all', `Expected OpenAPI sections root: ${JSON.stringify(contract)}`);
    assert(contract.sectionItemsPathTemplate === '/library/sections/:sectionId/all', `Expected section item template: ${JSON.stringify(contract)}`);
    assert(contract.metadataPathTemplate === '/library/metadata/:ids', `Expected metadata template: ${JSON.stringify(contract)}`);
    assert(contract.metadataLeavesPathTemplate === '/library/metadata/:ids/allLeaves', `Expected allLeaves template: ${JSON.stringify(contract)}`);
    assert(contract.ratingWritebackPath === '/:/rate', `Expected rating writeback path: ${JSON.stringify(contract)}`);
    assert(contract.watchedStateWritebackPaths.scrobble === '/:/scrobble', `Expected scrobble path: ${JSON.stringify(contract)}`);
    assert(contract.importMigrationReady === false, 'Contract must not flip import migration readiness');
    assert(fake.requests.length === 1 && fake.requests[0].pathname === '/media/providers', `Expected only provider discovery request: ${JSON.stringify(fake.requests)}`);

    const fallbackContract = buildPlexProviderAdvertisedImportPathContract([]);
    assert(fallbackContract.sectionsRootPath === '/library/sections', `Expected compatibility fallback: ${JSON.stringify(fallbackContract)}`);
    assert(fallbackContract.providerAdvertisedSectionsRoot === false, 'Empty provider discovery should not claim an advertised root');

    const evidence = {
      generatedAt: new Date().toISOString(),
      provider: 'plex',
      processingMode: 'provider_advertised_import_path_contract',
      readOnly: true,
      importMutation: false,
      plexWriteback: false,
      providerDiscovery: {
        path: '/media/providers',
        providerCount: providers.length
      },
      openApiSource: {
        title: 'Plex Media Server',
        downloadedSpecPath: '/Users/hamlin/Downloads/openapi.json',
        documentedPathsChecked: [
          '/media/providers',
          '/library/sections/all',
          '/library/sections/:sectionId/all',
          '/library/metadata/:ids',
          '/library/metadata/:ids/allLeaves',
          '/:/rate',
          '/:/scrobble',
          '/:/unscrobble',
          '/status/sessions'
        ]
      },
      advertisedContract: contract,
      compatibilityFallback: {
        providerFound: fallbackContract.providerFound,
        providerAdvertisedSectionsRoot: fallbackContract.providerAdvertisedSectionsRoot,
        sectionsRootPath: fallbackContract.sectionsRootPath
      },
      decision: 'media_providers_is_capability_discovery_and_import_should_resolve_documented_library_provider_paths_before_any_runtime_migration',
      assertions: [
        '/media/providers is not treated as an item-listing endpoint by itself',
        'the library provider can advertise /library/sections/all as the sections root',
        'current import mutation behavior remains unchanged',
        'compatibility fallback stays /library/sections when the advertised root is absent'
      ],
      requests: fake.requests.map((entry) => ({
        method: entry.method,
        pathname: entry.pathname,
        hasToken: entry.hasToken,
        tokenMatched: entry.tokenMatched,
        accept: entry.accept
      }))
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
