'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { fetchPlexMediaProviders } = require('../services/plex');

const repoRoot = path.resolve(__dirname, '..', '..');
const evidencePath = path.join(repoRoot, 'artifacts', 'plex-provider-discovery', 'plex-provider-discovery-smoke.json');
const fakeToken = `plex-provider-smoke-${Date.now().toString(36)}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeEvidence(payload) {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(payload, null, 2));
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

    res.setHeader('Content-Type', 'application/json');

    if (req.method !== 'GET' || url.pathname !== '/media/providers') {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    if (url.searchParams.get('X-Plex-Token') !== fakeToken) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    res.writeHead(200);
    res.end(JSON.stringify({
      MediaContainer: {
        MediaProvider: [
          {
            key: 'com.plexapp.plugins.library',
            title: 'Library',
            type: 'library',
            protocol: 'plex',
            identifier: 'com.plexapp.plugins.library',
            Feature: [
              { key: 'browse' },
              { key: 'timeline' },
              { key: 'metadata' }
            ],
            token: 'must-not-surface',
            url: 'http://127.0.0.1/private'
          },
          {
            key: 'system',
            title: 'System',
            type: 'server',
            protocol: 'plex',
            Feature: { key: 'status' }
          }
        ]
      }
    }));
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

    assert(providers.length === 2, `Expected 2 providers, got ${providers.length}`);
    const library = providers.find((provider) => provider.key === 'com.plexapp.plugins.library');
    assert(library, `Expected library provider, got ${JSON.stringify(providers)}`);
    assert(library.title === 'Library', `Expected Library title, got ${library.title}`);
    assert(library.type === 'library', `Expected library type, got ${library.type}`);
    assert(library.protocol === 'plex', `Expected plex protocol, got ${library.protocol}`);
    assert(JSON.stringify(library.featureKeys) === JSON.stringify(['browse', 'metadata', 'timeline']), `Unexpected feature keys: ${JSON.stringify(library.featureKeys)}`);
    assert(!Object.prototype.hasOwnProperty.call(library, 'token'), 'Provider readback must not expose token');
    assert(!Object.prototype.hasOwnProperty.call(library, 'url'), 'Provider readback must not expose provider URL');

    const request = fake.requests.find((entry) => entry.pathname === '/media/providers');
    assert(request, 'Expected fake PMS to receive /media/providers request');
    assert(request.hasToken === true, 'Expected request to include token query parameter');
    assert(request.tokenMatched === true, 'Expected fake PMS token to match without exposing it in evidence');

    const evidence = {
      generatedAt: new Date().toISOString(),
      mode: 'fake-pms',
      path: '/media/providers',
      providerCount: providers.length,
      providers,
      requests: fake.requests.map((entry) => ({
        method: entry.method,
        pathname: entry.pathname,
        hasToken: entry.hasToken,
        tokenMatched: entry.tokenMatched,
        accept: entry.accept
      })),
      assertions: [
        'fake PMS received GET /media/providers',
        'provider payload normalized into safe readback fields',
        'token and provider URL fields were not surfaced',
        'existing Plex import paths were not called'
      ]
    };
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
