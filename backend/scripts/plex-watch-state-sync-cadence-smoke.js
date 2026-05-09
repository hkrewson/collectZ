#!/usr/bin/env node

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const {
  buildPlexWatchStateSyncContract,
  fetchPlexWatchStateSnapshot
} = require('../services/plex');

const repoRoot = path.resolve(__dirname, '..', '..');
const evidencePath = path.join(repoRoot, 'artifacts', 'plex-watch-state', 'plex-watch-state-sync-cadence-smoke.json');
const fakeToken = `plex-watch-state-${Date.now().toString(36)}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSecretFree(value, label = 'payload') {
  const text = JSON.stringify(value);
  assert(!text.includes(fakeToken), `${label} surfaced the raw Plex token`);
  assert(!/X-Plex-Token=/i.test(text), `${label} surfaced a Plex token query string`);
  assert(!/https?:\/\/plex\.example/i.test(text), `${label} surfaced a raw Plex URL`);
  assert(!/\/mnt\/plex-media/i.test(text), `${label} surfaced a raw media file path`);
  assert(!/192\.168\./.test(text), `${label} surfaced a private IP address`);
}

function writeEvidence(payload) {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(payload, null, 2));
}

function metadataPayload(entry) {
  return JSON.stringify({ MediaContainer: { size: 1, Metadata: [entry] } });
}

function sectionPayload(entries) {
  return JSON.stringify({ MediaContainer: { size: entries.length, Metadata: entries } });
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

    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }

    if (url.searchParams.get('X-Plex-Token') !== fakeToken) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    if (url.pathname === '/library/metadata/1001') {
      res.writeHead(200);
      res.end(metadataPayload({
        ratingKey: '1001',
        type: 'movie',
        title: 'Completed Movie',
        viewCount: 1,
        lastViewedAt: 1778250000,
        duration: 7200000,
        viewOffset: 0,
        librarySectionID: '1',
        Media: [{ Part: [{ file: '/mnt/plex-media/Completed Movie.mkv' }] }]
      }));
      return;
    }

    if (url.pathname === '/library/metadata/1002') {
      res.writeHead(200);
      res.end(metadataPayload({
        ratingKey: '1002',
        type: 'movie',
        title: 'Paused Movie',
        viewCount: 0,
        duration: 7200000,
        viewOffset: 1800000,
        librarySectionID: '1',
        thumb: `https://plex.example.invalid/library/metadata/1002/thumb?X-Plex-Token=${fakeToken}`
      }));
      return;
    }

    if (url.pathname === '/library/metadata/2001/allLeaves') {
      res.writeHead(200);
      res.end(sectionPayload([
        {
          ratingKey: '2001-1',
          type: 'episode',
          grandparentTitle: 'Example Show',
          parentTitle: 'Season 1',
          title: 'Watched Episode',
          parentIndex: 1,
          index: 1,
          viewCount: 1,
          viewedAt: 1778253600,
          duration: 1800000,
          viewOffset: 0
        },
        {
          ratingKey: '2001-2',
          type: 'episode',
          grandparentTitle: 'Example Show',
          parentTitle: 'Season 1',
          title: 'Unwatched Episode',
          parentIndex: 1,
          index: 2,
          viewCount: 0,
          duration: 1800000,
          viewOffset: 0
        }
      ]));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
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
  const contract = buildPlexWatchStateSyncContract();
  assert(contract.status === 'read_only_contract', 'Expected watched-state contract to stay read-only');
  assert(contract.cadence.defaultIntervalMinutes === 60, 'Expected default sync cadence');
  assert(contract.cadence.minimumIntervalMinutes === 15, 'Expected minimum sync cadence');
  assert(contract.applyBehavior.collectzMutation === 'future_explicit_opt_in', 'Expected collectZ mutation to stay future opt-in');
  assert(contract.applyBehavior.plexWriteback === 'future_explicit_opt_in', 'Expected Plex writeback to stay future opt-in');

  const fake = await startFakePmsServer();
  try {
    const snapshot = await fetchPlexWatchStateSnapshot(
      {
        plexApiUrl: fake.baseUrl,
        plexApiKey: fakeToken,
        plexApiKeyQueryParam: 'X-Plex-Token'
      },
      {
        ratingKeys: ['1001', '1002'],
        leafRatingKeys: ['2001']
      }
    );

    assert(snapshot.entries.length === 4, `Expected 4 watched-state entries, got ${snapshot.entries.length}`);
    const byRatingKey = new Map(snapshot.entries.map((entry) => [entry.ratingKey, entry]));
    assert(byRatingKey.get('1001')?.watchState === 'completed', 'Expected completed movie state');
    assert(byRatingKey.get('1002')?.watchState === 'in_progress', 'Expected paused movie state');
    assert(byRatingKey.get('1002')?.progressPercent === 25, 'Expected paused movie progress');
    assert(byRatingKey.get('2001-1')?.watchState === 'completed', 'Expected watched episode state');
    assert(byRatingKey.get('2001-2')?.watchState === 'unwatched', 'Expected unwatched episode state');
    assert(snapshot.readbacks.length === 3, `Expected 3 PMS readbacks, got ${snapshot.readbacks.length}`);
    assert(snapshot.readbacks.every((entry) => entry.entryCount > 0), 'Expected every PMS readback to yield entries');
    assert(fake.requests.every((entry) => entry.hasToken && entry.tokenMatched), 'Expected all fake PMS requests to authenticate');
    assert(!fake.requests.some((entry) => entry.pathname === '/:/scrobble' || entry.pathname === '/:/unscrobble'), 'Smoke must not call Plex watched-state writeback paths');
    assertSecretFree(snapshot, 'watched-state snapshot');

    const evidence = {
      generatedAt: new Date().toISOString(),
      mode: 'fake-pms',
      contract,
      entryCounts: {
        total: snapshot.entries.length,
        completed: snapshot.entries.filter((entry) => entry.watchState === 'completed').length,
        inProgress: snapshot.entries.filter((entry) => entry.watchState === 'in_progress').length,
        unwatched: snapshot.entries.filter((entry) => entry.watchState === 'unwatched').length
      },
      readbacks: snapshot.readbacks,
      sampleStates: snapshot.entries.map((entry) => ({
        ratingKey: entry.ratingKey,
        type: entry.type,
        title: entry.title,
        watchState: entry.watchState,
        progressPercent: entry.progressPercent,
        lastViewedAt: entry.lastViewedAt
      })),
      requests: fake.requests.map((entry) => ({
        method: entry.method,
        pathname: entry.pathname,
        hasToken: entry.hasToken,
        tokenMatched: entry.tokenMatched,
        accept: entry.accept
      })),
      assertions: [
        'fake PMS exposed completed, in-progress, and unwatched states',
        'watched-state readback used metadata and allLeaves paths only',
        'collectZ mutation and Plex scrobble writeback stayed future opt-in',
        'token, provider URL, private IP, and media file paths were not surfaced'
      ]
    };
    assertSecretFree(evidence, 'watched-state evidence');
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
