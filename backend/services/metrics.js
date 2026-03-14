'use strict';

const pool = require('../db/pool');
const appMeta = require('../app-meta.json');

const counters = {
  httpRequests: new Map(),
  httpFailures: new Map(),
  authEvents: new Map(),
  importJobs: new Map(),
  importEnrichment: new Map(),
  providerRequests: new Map(),
  adminActions: new Map()
};

const histograms = {
  httpRequestDurationMs: new Map()
};

const HTTP_DURATION_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000];

const escapeLabelValue = (value) => String(value ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/\n/g, '\\n')
  .replace(/"/g, '\\"');

const buildLabelKey = (labels) => JSON.stringify(labels);

const incrementCounter = (bucket, labels, amount = 1) => {
  const key = buildLabelKey(labels);
  bucket.set(key, (bucket.get(key) || 0) + amount);
};

const observeHistogram = (histogram, labels, value, buckets) => {
  const key = buildLabelKey(labels);
  const current = histogram.get(key) || {
    sum: 0,
    count: 0,
    buckets: new Map()
  };
  current.sum += Number(value || 0);
  current.count += 1;
  for (const bucket of buckets) {
    if (Number(value || 0) <= bucket) {
      current.buckets.set(String(bucket), (current.buckets.get(String(bucket)) || 0) + 1);
    }
  }
  current.buckets.set('+Inf', (current.buckets.get('+Inf') || 0) + 1);
  histogram.set(key, current);
};

const normalizeFallbackRoute = (rawPath) => String(rawPath || '/')
  .split('?')[0]
  .replace(/\/\d+(?=\/|$)/g, '/:id')
  .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, '/:token');

const normalizeMetricRoute = (req) => {
  if (req.baseUrl && req.route?.path) {
    return `${req.baseUrl}${req.route.path}`;
  }
  if (req.route?.path) return req.route.path;
  return normalizeFallbackRoute(req.originalUrl || req.path || '/');
};

const formatLabels = (labels) => {
  const entries = Object.entries(labels || {});
  if (entries.length === 0) return '';
  return `{${entries.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(',')}}`;
};

const formatCounterLines = (name, help, bucket) => {
  const lines = [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} counter`
  ];
  for (const [rawLabels, value] of bucket.entries()) {
    lines.push(`${name}${formatLabels(JSON.parse(rawLabels))} ${value}`);
  }
  return lines;
};

const formatGaugeLines = (name, help, samples) => {
  const lines = [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`
  ];
  for (const sample of samples) {
    lines.push(`${name}${formatLabels(sample.labels)} ${sample.value}`);
  }
  return lines;
};

const formatHistogramLines = (name, help, histogram) => {
  const lines = [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} histogram`
  ];
  for (const [rawLabels, sample] of histogram.entries()) {
    const labels = JSON.parse(rawLabels);
    for (const [bucket, value] of sample.buckets.entries()) {
      lines.push(`${name}_bucket${formatLabels({ ...labels, le: bucket })} ${value}`);
    }
    lines.push(`${name}_sum${formatLabels(labels)} ${sample.sum}`);
    lines.push(`${name}_count${formatLabels(labels)} ${sample.count}`);
  }
  return lines;
};

const recordHttpRequestMetric = (req, statusCode, durationMs = null) => {
  const route = normalizeMetricRoute(req);
  const method = String(req.method || 'GET').toUpperCase();
  const statusClass = `${Math.floor(Number(statusCode || 0) / 100)}xx`;
  incrementCounter(counters.httpRequests, { method, route, status_class: statusClass });
  if (Number(statusCode || 0) >= 400) {
    incrementCounter(counters.httpFailures, { method, route, status: String(statusCode) });
  }
  if (durationMs !== null && durationMs !== undefined) {
    observeHistogram(
      histograms.httpRequestDurationMs,
      { method, route },
      Number(durationMs || 0),
      HTTP_DURATION_BUCKETS_MS
    );
  }
  if (route.startsWith('/api/admin') && !['GET', 'HEAD'].includes(method)) {
    incrementCounter(counters.adminActions, {
      method,
      route,
      outcome: Number(statusCode || 0) >= 400 ? 'failed' : 'succeeded'
    });
  }
};

const recordAuthEvent = (action, outcome = 'success') => {
  incrementCounter(counters.authEvents, { action, outcome });
};

const recordImportJobEvent = (provider, status) => {
  incrementCounter(counters.importJobs, { provider: provider || 'unknown', status: status || 'unknown' });
};

const recordImportEnrichmentEvent = (provider, kind, outcome, amount = 1) => {
  incrementCounter(counters.importEnrichment, {
    provider: provider || 'unknown',
    kind: kind || 'unknown',
    outcome: outcome || 'unknown'
  }, Number(amount || 1));
};

const recordProviderRequestEvent = (provider, operation, outcome, amount = 1) => {
  incrementCounter(counters.providerRequests, {
    provider: provider || 'unknown',
    operation: operation || 'unknown',
    outcome: outcome || 'unknown'
  }, Number(amount || 1));
};

const loadSyncJobStatusSamples = async () => {
  const result = await pool.query(
    `SELECT status, COUNT(*)::int AS count
     FROM sync_jobs
     GROUP BY status
     ORDER BY status ASC`
  );
  return result.rows.map((row) => ({
    labels: { status: row.status || 'unknown' },
    value: Number(row.count || 0)
  }));
};

const renderMetrics = async () => {
  const lines = [];

  lines.push(...formatGaugeLines('collectz_build_info', 'Static build metadata for the running backend', [{
    labels: {
      version: process.env.APP_VERSION || appMeta.backend || appMeta.version || 'unknown',
      frontend: appMeta.frontend || appMeta.version || 'unknown',
      backend: appMeta.backend || appMeta.version || 'unknown'
    },
    value: 1
  }]));

  lines.push(...formatCounterLines(
    'collectz_http_requests_total',
    'HTTP API requests observed by method, normalized route, and status class.',
    counters.httpRequests
  ));
  lines.push(...formatCounterLines(
    'collectz_http_request_failures_total',
    'HTTP API request failures by method, normalized route, and exact status.',
    counters.httpFailures
  ));
  lines.push(...formatCounterLines(
    'collectz_auth_events_total',
    'Auth lifecycle events by action and outcome.',
    counters.authEvents
  ));
  lines.push(...formatCounterLines(
    'collectz_import_jobs_total',
    'Import job lifecycle events by provider and status.',
    counters.importJobs
  ));
  lines.push(...formatCounterLines(
    'collectz_import_enrichment_total',
    'Import enrichment outcomes by provider, enrichment kind, and outcome.',
    counters.importEnrichment
  ));
  lines.push(...formatCounterLines(
    'collectz_provider_requests_total',
    'Provider request outcomes by provider, operation, and outcome.',
    counters.providerRequests
  ));
  lines.push(...formatCounterLines(
    'collectz_admin_actions_total',
    'Admin mutating API actions by method, normalized route, and outcome.',
    counters.adminActions
  ));
  lines.push(...formatHistogramLines(
    'collectz_http_request_duration_ms',
    'HTTP API request duration by method and normalized route.',
    histograms.httpRequestDurationMs
  ));
  lines.push(...formatGaugeLines(
    'collectz_sync_jobs',
    'Current sync job rows grouped by status.',
    await loadSyncJobStatusSamples()
  ));

  return `${lines.join('\n')}\n`;
};

const getMetricCounterValue = (metricName, labels) => {
  const bucket = counters[metricName];
  if (!(bucket instanceof Map)) return 0;
  return bucket.get(buildLabelKey(labels)) || 0;
};

module.exports = {
  recordHttpRequestMetric,
  recordAuthEvent,
  recordImportJobEvent,
  recordImportEnrichmentEvent,
  recordProviderRequestEvent,
  renderMetrics,
  getMetricCounterValue
};
