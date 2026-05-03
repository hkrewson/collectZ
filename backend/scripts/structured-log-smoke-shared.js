'use strict';

const assert = require('assert');
const crypto = require('crypto');

const BASE_URL = String(process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || process.env.RBAC_ADMIN_EMAIL || '').trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || process.env.RBAC_ADMIN_PASSWORD || '').trim();
const FEATURE_KEY = String(process.env.STRUCTURED_LOG_SMOKE_FEATURE_KEY || 'metrics_enabled').trim();
const POLL_ATTEMPTS = Math.max(1, Number(process.env.STRUCTURED_LOG_SMOKE_ATTEMPTS || 15));
const POLL_INTERVAL_MS = Math.max(250, Number(process.env.STRUCTURED_LOG_SMOKE_INTERVAL_MS || 2000));
const FEATURE_FLAG_SETTLE_MS = Math.max(0, Number(process.env.STRUCTURED_LOG_SMOKE_FEATURE_FLAG_SETTLE_MS || 11000));
const SMOKE_REQUEST_ID = String(process.env.STRUCTURED_LOG_SMOKE_REQUEST_ID || `structured-log-smoke-${crypto.randomUUID()}`);

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
}

const cookieJar = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function withStructuredLogSmokeEvent(runVerification) {
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
    return await runVerification({
      csrfToken,
      originalExportEnabled,
      originalTargetEnabled,
      requestId: SMOKE_REQUEST_ID,
      action: 'admin.feature_flag.update'
    });
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

module.exports = {
  BASE_URL,
  FEATURE_KEY,
  FEATURE_FLAG_SETTLE_MS,
  POLL_ATTEMPTS,
  POLL_INTERVAL_MS,
  SMOKE_REQUEST_ID,
  collectZHeaders,
  cookieHeader,
  fetchJson,
  getFeatureFlags,
  loginCollectZ,
  patchFeatureFlag,
  sleep,
  withStructuredLogSmokeEvent
};
