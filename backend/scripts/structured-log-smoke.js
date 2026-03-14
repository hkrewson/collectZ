'use strict';

const assert = require('assert');
const crypto = require('crypto');

const BASE_URL = String(process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || process.env.RBAC_ADMIN_EMAIL || '').trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || process.env.RBAC_ADMIN_PASSWORD || '').trim();
const GRAYLOG_URL = String(process.env.GRAYLOG_URL || 'http://localhost:9000').replace(/\/$/, '');
const GRAYLOG_USERNAME = String(process.env.GRAYLOG_USERNAME || 'admin').trim();
const GRAYLOG_PASSWORD = String(process.env.GRAYLOG_PASSWORD || '').trim();
const GRAYLOG_INPUT_TITLE = String(process.env.GRAYLOG_INPUT_TITLE || 'collectz-gelf-udp').trim();
const OPENSEARCH_URL = String(process.env.OPENSEARCH_URL || 'http://opensearch:9200').replace(/\/$/, '');
const FEATURE_KEY = String(process.env.STRUCTURED_LOG_SMOKE_FEATURE_KEY || 'ui_drawer_edit_experiment').trim();
const POLL_ATTEMPTS = Math.max(1, Number(process.env.STRUCTURED_LOG_SMOKE_ATTEMPTS || 15));
const POLL_INTERVAL_MS = Math.max(250, Number(process.env.STRUCTURED_LOG_SMOKE_INTERVAL_MS || 2000));
const FEATURE_FLAG_SETTLE_MS = Math.max(0, Number(process.env.STRUCTURED_LOG_SMOKE_FEATURE_FLAG_SETTLE_MS || 11000));
const SMOKE_REQUEST_ID = String(process.env.STRUCTURED_LOG_SMOKE_REQUEST_ID || `structured-log-smoke-${crypto.randomUUID()}`);

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
}
if (!GRAYLOG_PASSWORD) {
  throw new Error('GRAYLOG_PASSWORD is required');
}

const cookieJar = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function basicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function storeCookies(response) {
  const headers = response.headers;
  if (!headers || typeof headers.getSetCookie !== 'function') return;
  const cookies = headers.getSetCookie();
  for (const entry of cookies) {
    const first = String(entry).split(';')[0];
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    cookieJar.set(first.slice(0, eq), first.slice(eq + 1));
  }
}

function cookieHeader() {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function collectZHeaders(extra = {}) {
  return {
    'X-Request-Id': SMOKE_REQUEST_ID,
    ...extra
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = text;
  }
  return { response, body };
}

async function loginCollectZ() {
  const csrfBootstrap = await fetchJson(`${BASE_URL}/api/auth/csrf-token`, {
    headers: collectZHeaders({ Accept: 'application/json' })
  });
  if (!csrfBootstrap.response.ok) {
    throw new Error(`CSRF bootstrap failed (${csrfBootstrap.response.status})`);
  }
  storeCookies(csrfBootstrap.response);
  const csrfToken = csrfBootstrap.body?.csrfToken;
  assert.ok(csrfToken, 'csrfToken missing from bootstrap response');

  const login = await fetchJson(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      ...collectZHeaders(),
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      Cookie: cookieHeader()
    },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    })
  });
  if (!login.response.ok) {
    throw new Error(`Login failed (${login.response.status})`);
  }
  storeCookies(login.response);
  const rotatedToken = cookieJar.get('csrf_token') || csrfToken;
  assert.ok(rotatedToken, 'csrf_token cookie missing after login');
  return rotatedToken;
}

async function getFeatureFlags(csrfToken) {
  const result = await fetchJson(`${BASE_URL}/api/admin/feature-flags`, {
    headers: {
      ...collectZHeaders(),
      Accept: 'application/json',
      'X-CSRF-Token': csrfToken,
      Cookie: cookieHeader()
    }
  });
  if (!result.response.ok) {
    throw new Error(`Feature flag list failed (${result.response.status})`);
  }
  return result.body?.flags || [];
}

async function patchFeatureFlag(csrfToken, key, enabled) {
  const result = await fetchJson(`${BASE_URL}/api/admin/feature-flags/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    headers: {
      ...collectZHeaders(),
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      Cookie: cookieHeader()
    },
    body: JSON.stringify({ enabled })
  });
  if (!result.response.ok) {
    throw new Error(`Feature flag patch failed for ${key} (${result.response.status}): ${JSON.stringify(result.body)}`);
  }
  return result.body;
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

  console.log('Logging into collectZ admin session...');
  const csrfToken = await loginCollectZ();

  const flags = await getFeatureFlags(csrfToken);
  const exportFlag = flags.find((flag) => flag.key === 'external_log_export_enabled');
  const targetFlag = flags.find((flag) => flag.key === FEATURE_KEY);
  if (!exportFlag) throw new Error('external_log_export_enabled feature flag not found');
  if (!targetFlag) throw new Error(`${FEATURE_KEY} feature flag not found`);

  const originalExportEnabled = Boolean(exportFlag.enabled);
  const originalTargetEnabled = Boolean(targetFlag.enabled);

  try {
    if (!originalExportEnabled) {
      console.log('Enabling external_log_export_enabled...');
      await patchFeatureFlag(csrfToken, 'external_log_export_enabled', true);
      if (FEATURE_FLAG_SETTLE_MS > 0) {
        console.log(`Waiting ${FEATURE_FLAG_SETTLE_MS}ms for feature-flag cache to settle...`);
        await sleep(FEATURE_FLAG_SETTLE_MS);
      }
    }

    console.log(`Toggling ${FEATURE_KEY} to emit a deterministic audit event...`);
    await patchFeatureFlag(csrfToken, FEATURE_KEY, !originalTargetEnabled);

    console.log('Polling Graylog for exported event...');
    const found = await pollForExportedEvent('admin.feature_flag.update', SMOKE_REQUEST_ID);
    if (!found) {
      throw new Error('Exported admin.feature_flag.update event not found in Graylog search');
    }

    console.log('Structured log smoke passed.');
    console.log(JSON.stringify(found, null, 2));
  } finally {
    try {
      if (targetFlag) {
        await patchFeatureFlag(csrfToken, FEATURE_KEY, originalTargetEnabled);
      }
      if (!originalExportEnabled) {
        await patchFeatureFlag(csrfToken, 'external_log_export_enabled', false);
      }
    } catch (restoreError) {
      console.warn(`State restore warning: ${restoreError.message}`);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
