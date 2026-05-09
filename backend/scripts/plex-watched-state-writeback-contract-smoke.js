#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const {
  buildPlexWatchedStateWritebackContract,
  buildPlexWatchedStateWritebackRequest,
  sendPlexWatchedStateWriteback
} = require('../services/plex');

const fakePlexToken = `plex-watch-writeback-${crypto.randomBytes(6).toString('hex')}`;
const ARTIFACT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'artifacts',
  'plex-watch-state',
  'plex-watched-state-writeback-contract-smoke.json'
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSecretFree(value, label = 'payload') {
  const text = JSON.stringify(value);
  assert(!text.includes(fakePlexToken), `${label} surfaced raw Plex token`);
  assert(!/X-Plex-Token=/i.test(text), `${label} surfaced Plex token query string`);
  assert(!/\/mnt\/plex-media/i.test(text), `${label} surfaced raw media file path`);
  assert(!/192\.168\./.test(text), `${label} surfaced private IP address`);
}

async function startFakePmsServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    requests.push({
      method: req.method,
      pathname: url.pathname,
      key: url.searchParams.get('key') || null,
      identifier: url.searchParams.get('identifier') || null,
      hasToken: url.searchParams.has('X-Plex-Token'),
      unexpectedFilePath: '/mnt/plex-media/should-not-surface.mkv',
      unexpectedPrivateIp: '192.168.1.50'
    });

    if ((url.pathname === '/:/scrobble' || url.pathname === '/:/unscrobble')
      && req.method === 'PUT'
      && url.searchParams.get('identifier') === 'com.plexapp.plugins.library'
      && url.searchParams.get('key') === '5001'
      && url.searchParams.get('X-Plex-Token') === fakePlexToken) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unexpected fake PMS request' }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function main() {
  const fake = await startFakePmsServer();
  try {
    const config = {
      plexApiUrl: fake.baseUrl,
      plexApiKey: fakePlexToken,
      plexApiKeyQueryParam: 'X-Plex-Token'
    };
    const contract = buildPlexWatchedStateWritebackContract();
    const scrobbleRequest = buildPlexWatchedStateWritebackRequest({ ratingKey: '5001', action: 'scrobble' });
    const unscrobbleRequest = buildPlexWatchedStateWritebackRequest({ ratingKey: '5001', action: 'unscrobble' });
    const scrobble = await sendPlexWatchedStateWriteback(config, { ratingKey: '5001', action: 'scrobble' });
    const unscrobble = await sendPlexWatchedStateWriteback(config, { ratingKey: '5001', action: 'unscrobble' });

    assert(contract.method === 'PUT', `Expected PUT contract method: ${JSON.stringify(contract)}`);
    assert(scrobbleRequest.method === 'PUT', `Expected PUT scrobble request: ${JSON.stringify(scrobbleRequest)}`);
    assert(unscrobbleRequest.method === 'PUT', `Expected PUT unscrobble request: ${JSON.stringify(unscrobbleRequest)}`);
    assert(scrobble.request.path === '/:/scrobble', `Unexpected scrobble path: ${JSON.stringify(scrobble)}`);
    assert(unscrobble.request.path === '/:/unscrobble', `Unexpected unscrobble path: ${JSON.stringify(unscrobble)}`);
    assert(fake.requests.length === 2, `Expected two fake PMS requests: ${JSON.stringify(fake.requests)}`);
    assert(fake.requests.every((entry) => entry.method === 'PUT'), `Expected all fake PMS requests to use PUT: ${JSON.stringify(fake.requests)}`);
    assert(fake.requests.some((entry) => entry.pathname === '/:/scrobble'), `Missing scrobble call: ${JSON.stringify(fake.requests)}`);
    assert(fake.requests.some((entry) => entry.pathname === '/:/unscrobble'), `Missing unscrobble call: ${JSON.stringify(fake.requests)}`);

    const safeRequests = fake.requests.map((entry) => ({
      method: entry.method,
      pathname: entry.pathname,
      key: entry.key,
      identifier: entry.identifier,
      hasToken: entry.hasToken
    }));
    const evidence = {
      ok: true,
      provider: 'plex',
      processingMode: 'watched_state_writeback_contract',
      contract: {
        status: contract.status,
        method: contract.method,
        identifier: contract.identifier,
        actions: contract.actions
      },
      requests: safeRequests,
      readbacks: [
        { action: scrobble.request.action, path: scrobble.request.path, watched: scrobble.request.watched, status: scrobble.status },
        { action: unscrobble.request.action, path: unscrobble.request.path, watched: unscrobble.request.watched, status: unscrobble.status }
      ],
      notes: [
        'Plex watched-state writeback contract uses PUT for scrobble and unscrobble.',
        'The proof is service-level only and does not add UI-driven or scheduled Plex mutation.',
        'Evidence records only sanitized request shape and token presence, not token values.'
      ]
    };
    assertSecretFree(evidence, 'watched-state writeback contract evidence');
    fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
    fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`Plex watched-state writeback contract smoke passed. Evidence: ${ARTIFACT_PATH}`);
  } finally {
    await fake.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
