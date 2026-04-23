'use strict';

const GRAYLOG_URL = String(process.env.GRAYLOG_URL || 'http://localhost:9000').replace(/\/$/, '');
const GRAYLOG_USERNAME = String(process.env.GRAYLOG_USERNAME || 'admin').trim();
const GRAYLOG_PASSWORD = String(process.env.GRAYLOG_PASSWORD || '').trim();
const GRAYLOG_INPUT_TITLE = String(process.env.GRAYLOG_INPUT_TITLE || 'collectz-gelf-udp').trim();
const OPENSEARCH_URL = String(process.env.OPENSEARCH_URL || 'http://opensearch:9200').replace(/\/$/, '');
const {
  POLL_ATTEMPTS,
  POLL_INTERVAL_MS,
  SMOKE_REQUEST_ID,
  fetchJson,
  sleep,
  withStructuredLogSmokeEvent
} = require('./structured-log-smoke-shared');

if (!GRAYLOG_PASSWORD) {
  throw new Error('GRAYLOG_PASSWORD is required');
}

function basicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

async function listGraylogInputs() {
  const result = await fetchJson(`${GRAYLOG_URL}/api/system/inputs`, {
    headers: {
      Accept: 'application/json',
      Authorization: basicAuth(GRAYLOG_USERNAME, GRAYLOG_PASSWORD),
      'X-Requested-By': 'collectz-smoke'
    }
  });
  if (!result.response.ok) {
    throw new Error(`Graylog input listing failed (${result.response.status})`);
  }
  return result.body?.inputs || [];
}

async function ensureGraylogGelfUdpInput() {
  const inputs = await listGraylogInputs();
  const existing = inputs.find((input) => input?.title === GRAYLOG_INPUT_TITLE);
  if (existing) return existing;

  const payload = {
    title: GRAYLOG_INPUT_TITLE,
    global: true,
    type: 'org.graylog2.inputs.gelf.udp.GELFUDPInput',
    configuration: {
      bind_address: '0.0.0.0',
      port: 12201,
      recv_buffer_size: 262144,
      number_worker_threads: 2,
      decompress_size_limit: 8388608,
      override_source: null
    }
  };
  const result = await fetchJson(`${GRAYLOG_URL}/api/system/inputs`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: basicAuth(GRAYLOG_USERNAME, GRAYLOG_PASSWORD),
      'X-Requested-By': 'collectz-smoke',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!result.response.ok) {
    throw new Error(`Graylog input create failed (${result.response.status})`);
  }
  return result.body;
}

async function searchGraylog(query) {
  const url = new URL(`${GRAYLOG_URL}/api/search/universal/relative`);
  url.searchParams.set('query', query);
  url.searchParams.set('range', '300');
  url.searchParams.set('limit', '20');
  const result = await fetchJson(url.toString(), {
    headers: {
      Accept: 'application/json',
      Authorization: basicAuth(GRAYLOG_USERNAME, GRAYLOG_PASSWORD),
      'X-Requested-By': 'collectz-smoke'
    }
  });
  if (!result.response.ok) {
    throw new Error(`Graylog search failed (${result.response.status})`);
  }
  return result.body?.messages || [];
}

async function searchOpenSearch(action, requestId) {
  const url = new URL(`${OPENSEARCH_URL}/graylog_0/_search`);
  url.searchParams.set('size', '50');
  url.searchParams.set('sort', 'timestamp:desc');
  const result = await fetchJson(url.toString(), {
    headers: {
      Accept: 'application/json'
    }
  });
  if (result.response.status === 404) {
    return [];
  }
  if (!result.response.ok) {
    throw new Error(`OpenSearch search failed (${result.response.status})`);
  }
  const hits = result.body?.hits?.hits || [];
  return hits
    .map((entry) => entry?._source || null)
    .filter(Boolean)
    .filter((message) => (message.action === action || message.message === action))
    .filter((message) => !requestId || message.request_id === requestId);
}

async function pollForExportedEvent(action, requestId) {
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    const graylogMessages = await searchGraylog(action);
    const graylogMatch = graylogMessages.find((entry) => {
      const message = entry?.message || {};
      return (message._action === action || message.action === action)
        && (!requestId || message.request_id === requestId);
    });
    if (graylogMatch) {
      return {
        source: 'graylog-search',
        message: graylogMatch.message || graylogMatch
      };
    }

    const openSearchMatches = await searchOpenSearch(action, requestId);
    if (openSearchMatches[0]) {
      return {
        source: 'opensearch-index',
        message: openSearchMatches[0]
      };
    }

    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

async function main() {
  console.log('Ensuring Graylog GELF UDP input exists...');
  await ensureGraylogGelfUdpInput();
  const found = await withStructuredLogSmokeEvent(async ({ action, requestId }) => {
    console.log('Polling Graylog for exported event...');
    const found = await pollForExportedEvent(action, requestId);
    if (!found) {
      throw new Error('Exported admin.feature_flag.update event not found in Graylog search');
    }
    return found;
  });

  console.log('Structured log smoke passed.');
  console.log(JSON.stringify(found, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
