'use strict';

const assert = require('assert');
const http = require('http');
const {
  READER_GET_PROGRESS_ENDPOINT,
  PROGRESS_WRITE_ENDPOINTS,
  buildKavitaProgressContractProbe,
  buildKavitaProgressReadRequest,
  normalizeKavitaProgressReadback
} = require('../services/kavitaProgressContract');

const ephemeralToken = `progress-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function createFakeKavitaProgressServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    requests.push({
      method: req.method,
      pathname: requestUrl.pathname,
      query: Object.fromEntries(requestUrl.searchParams.entries()),
      authorizationSet: Boolean(req.headers.authorization)
    });

    if (PROGRESS_WRITE_ENDPOINTS.includes(requestUrl.pathname)) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ accepted: false, error: 'write endpoint must not be called' }));
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

    assert.strictEqual(probe.progressSyncImplementationEnabled, false);
    assert.strictEqual(readRequest.readOnly, true);
    assert.strictEqual(readRequest.implementationEnabled, false);
    assert.ok(probe.prohibitedWriteEndpoints.includes('/api/Reader/progress'));
    assert.ok(probe.prohibitedWriteEndpoints.includes('/api/Koreader/{apiKey}/syncs/progress'));

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

    console.log(JSON.stringify({
      provider: probe.provider,
      progressSyncImplementationEnabled: probe.progressSyncImplementationEnabled,
      readEndpoint: probe.endpoints.getProgress.endpoint,
      readQuery: probe.endpoints.getProgress.query,
      prohibitedWriteEndpoints: probe.prohibitedWriteEndpoints,
      readOnlyRequest: readRequest.readOnly,
      normalizedReadback: normalized,
      secretReturned: JSON.stringify(normalized).includes('must-not-leak')
    }, null, 2));
  } finally {
    await fake.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
