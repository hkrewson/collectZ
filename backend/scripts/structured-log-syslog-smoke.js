'use strict';

const {
  POLL_ATTEMPTS,
  POLL_INTERVAL_MS,
  fetchJson,
  sleep,
  withStructuredLogSmokeEvent
} = require('./structured-log-smoke-shared');

const SYSLOG_COLLECTOR_URL = String(process.env.SYSLOG_COLLECTOR_URL || 'http://syslog-collector:1515').replace(/\/$/, '');

async function readCollectorLogTail() {
  const url = new URL(`${SYSLOG_COLLECTOR_URL}/tail`);
  url.searchParams.set('lines', '120');
  const result = await fetchJson(url.toString(), {
    headers: { Accept: 'application/json' }
  });
  if (!result.response.ok) {
    throw new Error(`Syslog helper query failed (${result.response.status})`);
  }
  return Array.isArray(result.body?.lines) ? result.body.lines : [];
}

async function pollForExportedEvent(requestId, action) {
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    const tail = await readCollectorLogTail();
    const line = tail
      .find((entry) => entry.includes(requestId) && entry.includes(action));
    if (line) {
      return {
        source: 'syslog-tail',
        line
      };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

async function main() {
  const found = await withStructuredLogSmokeEvent(async ({ requestId, action }) => {
    console.log('Polling syslog collector log for exported event...');
    const match = await pollForExportedEvent(requestId, action);
    if (!match) {
      throw new Error('Exported admin.feature_flag.update event not found in syslog collector log');
    }
    return match;
  });

  console.log('Syslog structured log smoke passed.');
  console.log(JSON.stringify(found, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
