'use strict';

const LOKI_URL = String(process.env.LOKI_URL || 'http://localhost:3100').replace(/\/$/, '');
const {
  POLL_ATTEMPTS,
  POLL_INTERVAL_MS,
  fetchJson,
  sleep,
  withStructuredLogSmokeEvent
} = require('./structured-log-smoke-shared');

async function searchLoki(requestId, action) {
  const url = new URL(`${LOKI_URL}/loki/api/v1/query_range`);
  const now = Date.now() * 1_000_000;
  const start = now - (10 * 60 * 1_000_000_000);
  url.searchParams.set('query', '{job="collectz-backend"}');
  url.searchParams.set('limit', '200');
  url.searchParams.set('start', String(start));
  url.searchParams.set('end', String(now));
  const result = await fetchJson(url.toString(), {
    headers: { Accept: 'application/json' }
  });
  if (!result.response.ok) {
    throw new Error(`Loki query failed (${result.response.status})`);
  }
  return (result.body?.data?.result || [])
    .flatMap((stream) => Array.isArray(stream?.values) ? stream.values : [])
    .map((entry) => entry?.[1] || '')
    .filter((value) => value.includes(requestId) && value.includes(action));
}

async function pollForExportedEvent(requestId, action) {
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    const matches = await searchLoki(requestId, action);
    const line = matches[0];

    if (line) {
      return {
        source: 'loki-query',
        line
      };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

async function main() {
  const found = await withStructuredLogSmokeEvent(async ({ requestId, action }) => {
    console.log('Polling Loki for exported event...');
    const match = await pollForExportedEvent(requestId, action);
    if (!match) {
      throw new Error('Exported admin.feature_flag.update event not found in Loki query results');
    }
    return match;
  });

  console.log('Loki structured log smoke passed.');
  console.log(JSON.stringify(found, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
