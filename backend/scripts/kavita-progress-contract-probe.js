'use strict';

const assert = require('assert');
const http = require('http');
const {
  READER_GET_PROGRESS_ENDPOINT,
  READ_STATE_DISABLED_WRITE_ENDPOINTS,
  PROGRESS_UNSUPPORTED_WRITE_ENDPOINTS,
  buildKavitaProgressContractProbe,
  buildKavitaProgressReadRequest,
  buildKavitaProgressWritePayload,
  buildKavitaResetProgressPayload,
  buildKavitaResetProgressProbePayload,
  buildKavitaChapterReadStatePayload,
  normalizeKavitaProgressReadback
} = require('../services/kavitaProgressContract');

const ephemeralToken = `progress-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function createFakeKavitaProgressServer() {
    const requests = [];
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url, 'http://127.0.0.1');
    const record = {
      method: req.method,
      pathname: requestUrl.pathname,
      query: Object.fromEntries(requestUrl.searchParams.entries()),
      authorizationSet: Boolean(req.headers.authorization),
      body: null
    };
    requests.push(record);

    if (PROGRESS_UNSUPPORTED_WRITE_ENDPOINTS.includes(requestUrl.pathname)) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ accepted: false, error: 'unsupported write endpoint must not be called' }));
      return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/Reader/progress') {
      let requestBody = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        requestBody += chunk;
      });
      req.on('end', () => {
        record.body = requestBody ? JSON.parse(requestBody) : {};
        if (record.body.pageNum !== 0) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ accepted: false, error: 'reset-progress probe must send pageNum 0' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          accepted: true,
          libraryId: record.body.libraryId,
          seriesId: record.body.seriesId,
          volumeId: record.body.volumeId,
          chapterId: record.body.chapterId,
          pageNum: 0,
          bookScrollId: null,
          apiKey: 'must-not-leak',
          bearerToken: 'must-not-leak'
        }));
      });
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === READER_GET_PROGRESS_ENDPOINT) {
      assert.strictEqual(requestUrl.searchParams.get('chapterId'), '9702');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        libraryId: 44,
        seriesId: 8602,
        volumeId: 12,
        chapterId: 9702,
        pageNum: 17,
        bookScrollId: 'scroll-pos-17',
        lastModifiedUtc: '2026-05-05T05:00:00Z',
        apiKey: 'must-not-leak',
        bearerToken: 'must-not-leak'
      }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ accepted: false }));
  });

  return {
    server,
    requests,
    listen: () => new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(server.address()));
    }),
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function postJson(baseUrl, payload) {
  const url = new URL(payload.endpoint, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: payload.method,
      headers: {
        authorization: `Bearer ${ephemeralToken}`,
        'content-type': 'application/json'
      }
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: responseBody ? JSON.parse(responseBody) : {}
        });
      });
    });
    req.on('error', reject);
    req.end(JSON.stringify(payload.body || {}));
  });
}

function getJson(baseUrl, payload) {
  const url = new URL(payload.endpoint, baseUrl);
  for (const [key, value] of Object.entries(payload.query || {})) {
    url.searchParams.set(key, String(value));
  }
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: payload.method,
      headers: {
        authorization: `Bearer ${ephemeralToken}`
      }
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: responseBody ? JSON.parse(responseBody) : {}
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const fake = createFakeKavitaProgressServer();
  const address = await fake.listen();
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    const probe = buildKavitaProgressContractProbe();
    const readRequest = buildKavitaProgressReadRequest({ chapterId: 9702 });

    assert.strictEqual(probe.progressSyncImplementationEnabled, true);
    assert.strictEqual(readRequest.readOnly, true);
    assert.strictEqual(readRequest.implementationEnabled, true);
    assert.ok(probe.enabledWriteEndpoints.includes('/api/Reader/progress'));
    assert.ok(!probe.prohibitedWriteEndpoints.includes('/api/Reader/progress'));
    assert.strictEqual(probe.readStateImplementationEnabled, true);
    assert.strictEqual(probe.readStateContract.enabledEndpoint, '/api/Reader/mark-chapter-read');
    assert.deepStrictEqual(probe.readStateContract.disabledWriteEndpoints, READ_STATE_DISABLED_WRITE_ENDPOINTS);
    assert.ok(probe.readStateContract.disabledWriteEndpoints.includes('/api/Reader/mark-read'));
    assert.ok(probe.readStateContract.disabledWriteEndpoints.includes('/api/Reader/mark-unread'));
    assert.ok(!probe.readStateContract.disabledWriteEndpoints.includes('/api/Reader/mark-chapter-read'));
    assert.ok(probe.enabledWriteEndpoints.includes('/api/Reader/mark-chapter-read'));
    assert.strictEqual(probe.unreadContract.implementationEnabled, false);
    assert.strictEqual(probe.unreadContract.chapterUnreadEndpointAvailable, false);
    assert.ok(probe.unreadContract.prohibitedUnreadEndpoints.includes('/api/Reader/mark-unread'));
    assert.ok(probe.unreadContract.prohibitedUnreadEndpoints.includes('/api/Reader/mark-volume-unread'));
    assert.ok(probe.unreadContract.prohibitedUnreadEndpoints.includes('/api/Reader/mark-multiple-unread'));
    assert.ok(probe.unreadContract.prohibitedUnreadEndpoints.includes('/api/Reader/mark-multiple-series-unread'));
    assert.strictEqual(probe.unreadContract.resetProgressCandidate.status, 'runtime_enabled');
    assert.strictEqual(probe.unreadContract.resetProgressCandidate.implementationEnabled, true);
    assert.strictEqual(probe.unreadContract.resetProgressCandidate.provenPayload.pageNum, 0);
    assert.ok(probe.prohibitedWriteEndpoints.includes('/api/Koreader/{apiKey}/syncs/progress'));
    const writePayload = buildKavitaProgressWritePayload({
      libraryId: 44,
      seriesId: 8602,
      volumeId: 12,
      chapterId: 9702,
      pageNum: 18,
      bookScrollId: 'scroll-pos-18',
      lastModifiedUtc: '2026-05-06T05:00:00Z'
    });
    assert.strictEqual(writePayload.chapterId, 9702);
    assert.strictEqual(writePayload.pageNum, 18);
    const readStatePayload = buildKavitaChapterReadStatePayload({
      seriesId: 8602,
      chapterId: 9702,
      generateReadingSession: false
    });
    assert.deepStrictEqual(readStatePayload, {
      seriesId: 8602,
      chapterId: 9702,
      generateReadingSession: false
    });
    const resetProgressPayload = buildKavitaResetProgressProbePayload({
      libraryId: 44,
      seriesId: 8602,
      volumeId: 12,
      chapterId: 9702,
      lastModifiedUtc: '2026-05-06T05:10:00Z'
    });
    assert.strictEqual(resetProgressPayload.pageNum, 0);
    assert.strictEqual(resetProgressPayload.bookScrollId, null);
    assert.deepStrictEqual(buildKavitaResetProgressPayload({
      libraryId: 44,
      seriesId: 8602,
      volumeId: 12,
      chapterId: 9702,
      lastModifiedUtc: '2026-05-06T05:10:00Z'
    }), resetProgressPayload);

    const response = await getJson(baseUrl, readRequest);
    assert.strictEqual(response.status, 200);
    const normalized = normalizeKavitaProgressReadback(response.body);
    assert.strictEqual(normalized.chapterId, 9702);
    assert.strictEqual(normalized.pageNum, 17);
    assert.ok(!JSON.stringify(normalized).includes('must-not-leak'));
    assert.strictEqual(fake.requests.length, 1);
    assert.strictEqual(fake.requests[0].method, 'GET');
    assert.strictEqual(fake.requests[0].pathname, READER_GET_PROGRESS_ENDPOINT);
    assert.ok(fake.requests[0].authorizationSet);

    const resetResponse = await postJson(baseUrl, {
      method: 'POST',
      endpoint: '/api/Reader/progress',
      body: resetProgressPayload
    });
    assert.strictEqual(resetResponse.status, 200);
    const normalizedResetReadback = normalizeKavitaProgressReadback(resetResponse.body);
    assert.strictEqual(normalizedResetReadback.pageNum, 0);
    assert.ok(!Object.prototype.hasOwnProperty.call(normalizedResetReadback, 'bookScrollId'));
    assert.ok(!JSON.stringify(normalizedResetReadback).includes('must-not-leak'));
    assert.strictEqual(fake.requests.length, 2);
    assert.strictEqual(fake.requests[1].method, 'POST');
    assert.strictEqual(fake.requests[1].pathname, '/api/Reader/progress');
    assert.strictEqual(fake.requests[1].body.pageNum, 0);
    assert.ok(!fake.requests.some((request) => READ_STATE_DISABLED_WRITE_ENDPOINTS.includes(request.pathname)));

    console.log(JSON.stringify({
      provider: probe.provider,
      progressSyncImplementationEnabled: probe.progressSyncImplementationEnabled,
      readEndpoint: probe.endpoints.getProgress.endpoint,
      readQuery: probe.endpoints.getProgress.query,
      enabledWriteEndpoints: probe.enabledWriteEndpoints,
      prohibitedWriteEndpoints: probe.prohibitedWriteEndpoints,
      readStateImplementationEnabled: probe.readStateImplementationEnabled,
      readStateContract: probe.readStateContract,
      unreadContract: probe.unreadContract,
      readOnlyRequest: readRequest.readOnly,
      writePayload,
      readStatePayload,
      resetProgressProbe: {
        implementationEnabled: probe.unreadContract.resetProgressCandidate.implementationEnabled,
        endpoint: probe.unreadContract.resetProgressCandidate.endpoint,
        payload: resetProgressPayload,
        normalizedReadback: normalizedResetReadback,
        noBulkUnreadEndpointCalled: !fake.requests.some((request) => probe.unreadContract.prohibitedUnreadEndpoints.includes(request.pathname))
      },
      normalizedReadback: normalized,
      secretReturned: JSON.stringify(normalized).includes('must-not-leak')
        || JSON.stringify(normalizedResetReadback).includes('must-not-leak')
    }, null, 2));
  } finally {
    await fake.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
