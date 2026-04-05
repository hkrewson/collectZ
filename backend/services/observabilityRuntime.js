'use strict';

const { getFeatureFlag } = require('./featureFlags');
const { readExportConfig } = require('./logExport');

const DEFAULT_LOG_HOSTS = new Set(['127.0.0.1', 'localhost']);
const DEBUG_LEVEL = Math.max(0, Math.min(2, Number(process.env.DEBUG || 0) || 0));
const METRICS_SCRAPE_TOKEN = String(process.env.METRICS_SCRAPE_TOKEN || '').trim();

function makeCheck(level, title, detail) {
  return { level, title, detail };
}

async function buildLogsRuntimeDiagnostics() {
  const flag = await getFeatureFlag('external_log_export_enabled');
  const config = readExportConfig();
  const checks = [];

  if (!flag?.enabled) {
    checks.push(makeCheck(
      'info',
      'Export is disabled here',
      'The External Log Export setting is off in Admin -> Integrations, so the backend will keep writing activity data locally without shipping structured events.'
    ));
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

  return {
    featureEnabled: Boolean(flag?.enabled),
    featureStoredEnabled: Boolean(flag?.storedEnabled),
    backend: config.backend,
    host: config.host,
    port: config.port,
    hostLabel: config.hostLabel,
    service: config.service,
    debugEnabled: config.debugEnabled,
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

  if (!flag?.enabled) {
    checks.push(makeCheck(
      'info',
      'Metrics are disabled here',
      'The Metrics Export setting is off in Admin -> Integrations, so /api/metrics will stay closed even if DEBUG is enabled.'
    ));
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
  }

  return {
    featureEnabled: Boolean(flag?.enabled),
    featureStoredEnabled: Boolean(flag?.storedEnabled),
    debugLevel: DEBUG_LEVEL,
    scrapeTokenConfigured: Boolean(METRICS_SCRAPE_TOKEN),
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
