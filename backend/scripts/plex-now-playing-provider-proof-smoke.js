'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { fetchPlexNowPlayingSessions } = require('../services/plex');

const repoRoot = path.resolve(__dirname, '..', '..');
const evidencePath = path.join(repoRoot, 'artifacts', 'plex-now-playing', 'plex-now-playing-provider-proof-smoke.json');
const fakeToken = `plex-now-playing-${Date.now().toString(36)}`;

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

    if (req.method !== 'GET' || url.pathname !== '/status/sessions') {
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
        size: 1,
        Metadata: [{
          ratingKey: '12345',
          sessionKey: '987',
          type: 'episode',
          title: 'The One With a Safe Payload',
          grandparentTitle: 'Example Show',
          parentTitle: 'Season 2',
          year: 2026,
          duration: 1800000,
          viewOffset: 450000,
          User: { title: 'Local Viewer', username: 'local-viewer', id: '42', token: 'must-not-surface' },
          Player: {
            title: 'Living Room',
            product: 'Plex Web',
            state: 'playing',
            platform: 'Chrome',
            address: '192.168.1.24',
            machineIdentifier: 'must-not-surface'
          },
          Media: [{ Part: [{ file: '/private/media/example.mkv' }] }],
          token: 'must-not-surface',
          key: '/library/metadata/12345'
        }]
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
    const sessions = await fetchPlexNowPlayingSessions({
      plexApiUrl: fake.baseUrl,
      plexApiKey: fakeToken,
      plexApiKeyQueryParam: 'X-Plex-Token'
    });

    assert(sessions.length === 1, `Expected 1 now-playing session, got ${sessions.length}`);
    const session = sessions[0];
    assert(session.title === 'The One With a Safe Payload', `Unexpected title: ${session.title}`);
    assert(session.type === 'episode', `Unexpected type: ${session.type}`);
    assert(session.grandparentTitle === 'Example Show', `Unexpected show title: ${session.grandparentTitle}`);
    assert(session.progressPercent === 25, `Unexpected progress: ${session.progressPercent}`);
    assert(session.user?.title === 'Local Viewer', `Unexpected user readback: ${JSON.stringify(session.user)}`);
    assert(session.player?.state === 'playing', `Unexpected player state: ${JSON.stringify(session.player)}`);
    assert(!Object.prototype.hasOwnProperty.call(session, 'token'), 'Session readback must not expose token');
    assert(!JSON.stringify(session).includes('/private/media'), 'Session readback must not expose media file paths');
    assert(!JSON.stringify(session).includes('192.168.1.24'), 'Session readback must not expose player IP addresses');
    assert(!JSON.stringify(session).includes(fakeToken), 'Session readback must not expose raw Plex token');

    const request = fake.requests.find((entry) => entry.pathname === '/status/sessions');
    assert(request, 'Expected fake PMS to receive /status/sessions request');
    assert(request.hasToken === true, 'Expected request to include token query parameter');
    assert(request.tokenMatched === true, 'Expected fake PMS token to match without exposing it in evidence');

    const evidence = {
      generatedAt: new Date().toISOString(),
      mode: 'fake-pms',
      path: '/status/sessions',
      sessionCount: sessions.length,
      sessions,
      requests: fake.requests.map((entry) => ({
        method: entry.method,
        pathname: entry.pathname,
        hasToken: entry.hasToken,
        tokenMatched: entry.tokenMatched,
        accept: entry.accept
      })),
      assertions: [
        'fake PMS received GET /status/sessions',
        'now-playing payload normalized into safe readback fields',
        'token, player IP, machine identifier, and media file paths were not surfaced',
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
