'use strict';

const assert = require('assert');
const http = require('http');
const {
  SERIES_METADATA_ENDPOINT,
  CHAPTER_METADATA_ENDPOINT,
  buildKavitaMetadataWritebackProbe,
  buildKavitaSeriesMetadataWritebackPayload,
  buildKavitaChapterMetadataWritebackPayload
} = require('../services/kavitaWritebackContract');

const ephemeralToken = `probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 100000) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function createFakeKavitaWritebackServer() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    try {
      const body = await readJsonBody(req);
      requests.push({
        method: req.method,
        url: req.url,
        authorizationSet: Boolean(req.headers.authorization),
        body
      });

      if (req.method === 'POST' && req.url === SERIES_METADATA_ENDPOINT) {
        assert.ok(body.seriesMetadata, 'series metadata writeback must wrap the payload');
        assert.strictEqual(body.seriesMetadata.seriesId, 8602);
        assert.strictEqual(body.seriesMetadata.summary, 'Previewed summary from collectZ');
        assert.deepStrictEqual(body.seriesMetadata.tags, ['collectz-preview']);
        assert.ok(!Object.prototype.hasOwnProperty.call(body.seriesMetadata, 'coverImage'));
        assert.ok(!Object.prototype.hasOwnProperty.call(body.seriesMetadata, 'apiKey'));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ accepted: true, kind: 'series' }));
        return;
      }

      if (req.method === 'POST' && req.url === CHAPTER_METADATA_ENDPOINT) {
        assert.strictEqual(body.id, 9702);
        assert.strictEqual(body.titleName, 'Issue 1');
        assert.strictEqual(body.releaseDate, '2024-05-01');
        assert.ok(!Object.prototype.hasOwnProperty.call(body, 'pages'));
        assert.ok(!Object.prototype.hasOwnProperty.call(body, 'apiKey'));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ accepted: true, kind: 'chapter' }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ accepted: false }));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ accepted: false, error: error.message }));
    }
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
        'content-type': 'application/json',
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
    req.end(JSON.stringify(payload.body));
  });
}

async function main() {
  const fake = createFakeKavitaWritebackServer();
  const address = await fake.listen();
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    const probe = buildKavitaMetadataWritebackProbe();
    const seriesPayload = buildKavitaSeriesMetadataWritebackPayload({
      seriesId: 8602,
      metadata: {
        seriesId: 8602,
        summary: 'Previewed summary from collectZ',
        tags: ['collectz-preview'],
        releaseYear: 2024,
        coverImage: '/api/image/series-cover?seriesId=8602',
        writersLocked: true,
        writers: [{ name: 'Locked Writer' }],
        apiKey: 'must-not-leak'
      },
      selectedFields: ['summary', 'tags', 'releaseYear', 'writers', 'coverImage', 'apiKey']
    });
    const chapterPayload = buildKavitaChapterMetadataWritebackPayload({
      chapterId: 9702,
      metadata: {
        id: 9702,
        titleName: 'Issue 1',
        releaseDate: '2024-05-01',
        isbn: '9780000000001',
        pages: 22,
        apiKey: 'must-not-leak'
      },
      selectedFields: ['titleName', 'releaseDate', 'isbn', 'pages', 'apiKey']
    });

    assert.strictEqual(probe.implementationEnabled, false);
    assert.strictEqual(seriesPayload.implementationEnabled, false);
    assert.strictEqual(chapterPayload.implementationEnabled, false);
    assert.deepStrictEqual(seriesPayload.skippedFields, [{ field: 'writers', reason: 'locked' }]);
    assert.ok(!JSON.stringify(seriesPayload).includes('must-not-leak'));
    assert.ok(!JSON.stringify(chapterPayload).includes('must-not-leak'));

    const seriesResponse = await postJson(baseUrl, seriesPayload);
    const chapterResponse = await postJson(baseUrl, chapterPayload);
    assert.strictEqual(seriesResponse.status, 200);
    assert.strictEqual(chapterResponse.status, 200);
    assert.strictEqual(seriesResponse.body.accepted, true);
    assert.strictEqual(chapterResponse.body.accepted, true);
    assert.strictEqual(fake.requests.length, 2);
    assert.ok(fake.requests.every((request) => request.authorizationSet));

    console.log(JSON.stringify({
      provider: probe.provider,
      writebackImplementationEnabled: probe.implementationEnabled,
      seriesEndpoint: probe.endpoints.seriesMetadata.endpoint,
      chapterEndpoint: probe.endpoints.chapterMetadata.endpoint,
      seriesAccepted: seriesResponse.body.accepted,
      chapterAccepted: chapterResponse.body.accepted,
      previewRequired: probe.safetyRequirements.includes('preview diff before mutation'),
      explicitOptInRequired: probe.safetyRequirements.includes('workspace-owned integration opt-in'),
      auditRequired: probe.safetyRequirements.includes('audit log for every attempted writeback'),
      seriesFields: seriesPayload.selectedFields,
      chapterFields: chapterPayload.selectedFields,
      skippedFields: seriesPayload.skippedFields
    }, null, 2));
  } finally {
    await fake.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
