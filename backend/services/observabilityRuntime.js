'use strict';

const { getFeatureFlag } = require('./featureFlags');
const { readExportConfig, resolveExportConfig } = require('./logExport');

const DEFAULT_LOG_HOSTS = new Set(['127.0.0.1', 'localhost']);
const DEBUG_LEVEL = Math.max(0, Math.min(2, Number(process.env.DEBUG || 0) || 0));
const METRICS_SCRAPE_TOKEN = String(process.env.METRICS_SCRAPE_TOKEN || '').trim();
const NODE_ENV = String(process.env.NODE_ENV || 'production').trim().toLowerCase() || 'production';
const WEAK_TOKEN_VALUES = new Set([
  'changeme',
  'change-me',
  'replace-me',
  'replace_me',
  'replace-this',
  'dev',
  'development',
  'password',
  'secret',
  'token',
  'example',
  'your_metrics_scrape_token'
]);

function makeCheck(level, title, detail) {
  return { level, title, detail };
}

function parseTrustProxy(value) {
  if (value === undefined || value === null || value === '') {
    return NODE_ENV === 'production' ? 1 : false;
  }
  const normalized = String(value).toLowerCase().trim();
  if (normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  const asNumber = Number(normalized);
  if (Number.isInteger(asNumber) && asNumber >= 0) return asNumber;
  return NODE_ENV === 'production' ? 1 : false;
}

function isWeakScrapeToken(token) {
  if (!token) return false;
  const normalized = String(token).trim().toLowerCase();
  return normalized.length < 24 || WEAK_TOKEN_VALUES.has(normalized);
}

async function buildLogsRuntimeDiagnostics() {
  const flag = await getFeatureFlag('external_log_export_enabled');
  const envConfig = readExportConfig();
  const config = await resolveExportConfig();
  const checks = [];

  if (!flag?.enabled) {
    checks.push(makeCheck(
      'info',
      'Export is disabled here',
      'The External Log Export setting is off in Admin -> Integrations, so the backend will keep writing activity data locally without shipping structured events.'
    ));
    if (config.backend !== 'off') {
      checks.push(makeCheck(
        'warn',
        'Runtime transport is configured but inactive',
        `The running backend still has LOG_EXPORT_BACKEND=${config.backend}, but the Admin -> Integrations toggle is off, so that transport is configured but not currently used.`
      ));
    }
  } else if (config.backend === 'off') {
    checks.push(makeCheck(
      'warn',
      'Runtime transport is off',
      'External Log Export is enabled in Admin -> Integrations, but the running backend still has LOG_EXPORT_BACKEND=off, so no collector transport will be used.'
    ));
  } else {
    checks.push(makeCheck(
      'ok',
      'Runtime transport is configured',
      `The running backend is prepared to export structured events with ${config.backend} to ${config.host}:${config.port}.`
    ));
  }

  if (flag?.enabled && config.backend !== 'off' && DEFAULT_LOG_HOSTS.has(String(config.host || '').toLowerCase())) {
    checks.push(makeCheck(
      'warn',
      'Collector host points to loopback',
      'LOG_EXPORT_HOST is set to localhost/127.0.0.1 inside the backend container. That usually means the collector will only work if it runs in the same container namespace.'
    ));
  }

  if (flag?.enabled && config.backend === 'stdout_json') {
    checks.push(makeCheck(
      'info',
      'Structured export shares stdout',
      'stdout_json keeps export non-blocking, but it mixes structured events with normal backend logs. Promtail or another collector has to separate those streams downstream.'
    ));
  }

  if (config.debugEnabled) {
    checks.push(makeCheck(
      'info',
      'Exporter debug tracing is on',
      'LOG_EXPORT_DEBUG is enabled, so the backend will emit extra exporter decision logs. That is useful for diagnosis, but it adds runtime noise.'
    ));
  }

  if (flag?.enabled && config.backend !== 'off') {
    checks.push(makeCheck(
      'info',
      'Collector outages should stay non-blocking',
      'Export transport failures should only produce a warning log. The primary DB-backed activity_log write remains the durable audit path, so API and import work should keep succeeding even when the collector is unavailable.'
    ));
  }

  return {
    featureEnabled: Boolean(flag?.enabled),
    featureStoredEnabled: Boolean(flag?.storedEnabled),
    backend: config.backend,
    host: config.host,
    port: config.port,
    hostLabel: config.hostLabel,
    service: config.service,
    debugEnabled: config.debugEnabled,
    configSource: config.controlPlane?.source || 'env_fallback',
    configReadOnly: Boolean(config.controlPlane?.readOnly),
    envBackend: envConfig.backend,
    envHost: envConfig.host,
    envPort: envConfig.port,
    storedBackend: config.controlPlane?.stored?.backend || null,
    storedHost: config.controlPlane?.stored?.host || null,
    storedPort: config.controlPlane?.stored?.port || null,
    effectiveState: !flag?.enabled
      ? 'disabled'
      : config.backend === 'off'
        ? 'attention'
        : 'ready',
    checks
  };
}

async function buildMetricsRuntimeDiagnostics() {
  const flag = await getFeatureFlag('metrics_enabled');
  const checks = [];
  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  const trustProxyDisplay = typeof trustProxy === 'number' ? String(trustProxy) : trustProxy ? 'true' : 'false';

  if (!flag?.enabled) {
    checks.push(makeCheck(
      'info',
      'Metrics are disabled here',
      'The Metrics Export setting is off in Admin -> Integrations, so /api/metrics will stay closed even if DEBUG is enabled.'
    ));
    if (DEBUG_LEVEL >= 1) {
      checks.push(makeCheck(
        'info',
        'DEBUG is open but metrics are still gated off',
        'The running backend has DEBUG>=1, but the Metrics Export toggle is off, so /api/metrics remains intentionally closed.'
      ));
    }
    if (METRICS_SCRAPE_TOKEN) {
      checks.push(makeCheck(
        'info',
        'Scrape token is configured but inactive',
        'A metrics scrape token is present in runtime config, but it will not open /api/metrics until the Metrics Export toggle is also enabled.'
      ));
    }
  } else if (DEBUG_LEVEL < 1) {
    checks.push(makeCheck(
      'warn',
      'Runtime debug gate is closed',
      'Metrics Export is enabled in Admin -> Integrations, but the running backend has DEBUG<1, so /api/metrics still returns 404.'
    ));
  } else {
    checks.push(makeCheck(
      'ok',
      'Metrics endpoint can open',
      'The running backend has both the integration toggle and DEBUG gate open, so /api/metrics is available to an admin session or a valid scrape token.'
    ));
  }

  if (!METRICS_SCRAPE_TOKEN) {
    checks.push(makeCheck(
      'info',
      'No dedicated scrape token is configured',
      'Admin sessions can still reach /api/metrics when the gate is open, but Prometheus or another collector will need a protected admin path unless you set METRICS_SCRAPE_TOKEN.'
    ));
  } else if (isWeakScrapeToken(METRICS_SCRAPE_TOKEN)) {
    checks.push(makeCheck(
      'warn',
      'Scrape token looks weak',
      'METRICS_SCRAPE_TOKEN is present, but it looks short or placeholder-like. Treat it as a machine credential and rotate it to a long random value before relying on a reverse proxy or shared scrape path.'
    ));
  }

  if (Boolean(flag?.enabled) && DEBUG_LEVEL >= 1) {
    if (!trustProxy) {
      checks.push(makeCheck(
        'info',
        'Trust proxy is off',
        'That is fine for direct backend access. If /api/metrics is only reachable through nginx, Traefik, or another reverse proxy, set TRUST_PROXY deliberately so forwarded scheme/IP behavior stays predictable.'
      ));
    } else {
      checks.push(makeCheck(
        'info',
        'Reverse-proxy deployments should still keep metrics private',
        'A valid scrape token or admin session can open /api/metrics now. Keep the route on an internal network or protected reverse-proxy path instead of publishing it directly.'
      ));
    }
  }

  return {
    featureEnabled: Boolean(flag?.enabled),
    featureStoredEnabled: Boolean(flag?.storedEnabled),
    debugLevel: DEBUG_LEVEL,
    scrapeTokenConfigured: Boolean(METRICS_SCRAPE_TOKEN),
    trustProxy: trustProxyDisplay,
    endpointPath: '/api/metrics',
    effectiveState: !flag?.enabled
      ? 'disabled'
      : DEBUG_LEVEL < 1
        ? 'attention'
        : 'ready',
    checks
  };
}

async function buildObservabilityRuntimeDiagnostics() {
  const [logs, metrics] = await Promise.all([
    buildLogsRuntimeDiagnostics(),
    buildMetricsRuntimeDiagnostics()
  ]);
  return { logs, metrics };
}

module.exports = {
  buildLogsRuntimeDiagnostics,
  buildMetricsRuntimeDiagnostics,
  buildObservabilityRuntimeDiagnostics
};
