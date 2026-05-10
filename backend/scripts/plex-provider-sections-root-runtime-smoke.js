'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const {
  fetchPlexSections,
  fetchPlexSectionsWithResolution
} = require('../services/plex');

const repoRoot = path.resolve(__dirname, '..', '..');
const evidencePath = path.join(repoRoot, 'artifacts', 'plex-provider-sections-root-runtime', 'plex-provider-sections-root-runtime-smoke.json');
const fakeToken = `plex-provider-sections-root-${Date.now().toString(36)}`;

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

async function startFakePmsServer({ advertisedRoot = true, advertisedRootStatus = 200 } = {}) {
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
            Feature: [{
              key: 'sections',
              Directory: advertisedRoot ? [{
                title: 'Library Sections',
                key: '/library/sections/all',
                type: 'library',
                content: false
              }] : []
            }]
          }]
        }
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/library/sections/all') {
      if (advertisedRootStatus >= 400) {
        jsonResponse(res, advertisedRootStatus, { error: 'sections root unavailable' });
        return;
      }
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

function buildConfig(fake) {
  return {
    plexApiUrl: fake.baseUrl,
    plexApiKey: fakeToken,
    plexApiKeyQueryParam: 'X-Plex-Token'
  };
}

async function runScenario(name, options) {
  const fake = await startFakePmsServer(options);
  try {
    const result = await fetchPlexSectionsWithResolution(buildConfig(fake));
    return {
      name,
      sectionCount: result.sections.length,
      resolution: result.resolution,
      requests: fake.requests.map((entry) => ({
        method: entry.method,
        pathname: entry.pathname,
        hasToken: entry.hasToken,
        tokenMatched: entry.tokenMatched,
        accept: entry.accept
      }))
    };
  } finally {
    await fake.close();
  }
}

async function main() {
  const advertised = await runScenario('provider_advertised_sections_root', { advertisedRoot: true });
  assert(advertised.sectionCount === 2, `Expected advertised root sections: ${JSON.stringify(advertised)}`);
  assert(advertised.resolution.source === 'provider_advertised', `Expected provider-advertised source: ${JSON.stringify(advertised)}`);
  assert(advertised.resolution.path === '/library/sections/all', `Expected /library/sections/all: ${JSON.stringify(advertised)}`);
  assert(advertised.requests.some((entry) => entry.pathname === '/media/providers'), `Expected provider discovery request: ${JSON.stringify(advertised.requests)}`);
  assert(advertised.requests.some((entry) => entry.pathname === '/library/sections/all'), `Expected advertised root request: ${JSON.stringify(advertised.requests)}`);
  assert(!advertised.requests.some((entry) => entry.pathname === '/library/sections'), `Did not expect compatibility fallback: ${JSON.stringify(advertised.requests)}`);

  const unavailable = await runScenario('provider_advertised_root_unavailable_fallback', { advertisedRoot: true, advertisedRootStatus: 404 });
  assert(unavailable.sectionCount === 2, `Expected fallback sections: ${JSON.stringify(unavailable)}`);
  assert(unavailable.resolution.source === 'provider_advertised_root_failed_fallback', `Expected root-failed fallback: ${JSON.stringify(unavailable)}`);
  assert(unavailable.resolution.path === '/library/sections', `Expected /library/sections fallback: ${JSON.stringify(unavailable)}`);
  assert(unavailable.requests.some((entry) => entry.pathname === '/library/sections/all'), `Expected advertised root attempt: ${JSON.stringify(unavailable.requests)}`);
  assert(unavailable.requests.some((entry) => entry.pathname === '/library/sections'), `Expected fallback request: ${JSON.stringify(unavailable.requests)}`);

  const notAdvertised = await runScenario('provider_root_not_advertised_fallback', { advertisedRoot: false });
  assert(notAdvertised.sectionCount === 2, `Expected non-advertised fallback sections: ${JSON.stringify(notAdvertised)}`);
  assert(notAdvertised.resolution.source === 'compatibility_fallback', `Expected compatibility fallback: ${JSON.stringify(notAdvertised)}`);
  assert(notAdvertised.resolution.path === '/library/sections', `Expected /library/sections fallback: ${JSON.stringify(notAdvertised)}`);
  assert(!notAdvertised.requests.some((entry) => entry.pathname === '/library/sections/all'), `Did not expect advertised root request: ${JSON.stringify(notAdvertised.requests)}`);

  const compatibilityFake = await startFakePmsServer({ advertisedRoot: false });
  try {
    const sections = await fetchPlexSections(buildConfig(compatibilityFake));
    assert(sections.length === 2, `Expected fetchPlexSections compatibility result: ${JSON.stringify(sections)}`);
  } finally {
    await compatibilityFake.close();
  }

  const evidence = {
    generatedAt: new Date().toISOString(),
    provider: 'plex',
    processingMode: 'provider_sections_root_runtime_migration',
    readOnly: true,
    importMutation: false,
    plexWriteback: false,
    scenarios: [advertised, unavailable, notAdvertised],
    decision: 'runtime_section_discovery_prefers_provider_advertised_sections_all_and_falls_back_to_library_sections',
    assertions: [
      'fetchPlexSections now resolves the sections root through provider discovery at runtime',
      'provider-advertised /library/sections/all is used when it is present and readable',
      'fallback to /library/sections remains intact when the advertised root is absent or fails',
      'the smoke does not call item import endpoints or mutate collectZ rows'
    ]
  };

  assertSecretFree(evidence);
  writeEvidence(evidence);
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
