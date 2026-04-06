'use strict';

const dgram = require('dgram');
const net = require('net');
const pool = require('../db/pool');
const appMeta = require('../app-meta.json');
const { isFeatureEnabled } = require('./featureFlags');

const LOG_EXPORT_BACKENDS = new Set(['off', 'gelf_udp', 'gelf_tcp', 'stdout_json', 'syslog_udp', 'syslog_tcp']);
const DEFAULT_GELF_PORT = 12201;
const DEFAULT_SYSLOG_PORT = 514;
const DEFAULT_GELF_HOST = '127.0.0.1';
const MAX_DETAIL_BYTES = Math.max(1024, Number(process.env.LOG_EXPORT_MAX_DETAIL_BYTES || 16384));
const LOG_EXPORT_SETTINGS_READ_ONLY = parseBoolean(process.env.LOG_EXPORT_SETTINGS_READ_ONLY, false);
const LOG_EXPORT_CONFIG_CACHE_TTL_MS = Math.max(1000, Number(process.env.LOG_EXPORT_CONFIG_CACHE_TTL_SECONDS || 10) * 1000);
const DETAIL_PROMOTION_MAP = {
  key: '_detail_key',
  reason: '_detail_reason',
  previousEnabled: '_detail_previous_enabled',
  nextEnabled: '_detail_next_enabled',
  requestedEnabled: '_detail_requested_enabled',
  envOverride: '_detail_env_override'
};

let storedConfigCache = null;
let storedConfigCacheAt = 0;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function readExportConfig() {
  const backendRaw = String(process.env.LOG_EXPORT_BACKEND || 'off').trim().toLowerCase();
  const backend = LOG_EXPORT_BACKENDS.has(backendRaw) ? backendRaw : 'off';
  const defaultPort = backend === 'syslog_udp' || backend === 'syslog_tcp'
    ? DEFAULT_SYSLOG_PORT
    : DEFAULT_GELF_PORT;
  return {
    backend,
    host: String(process.env.LOG_EXPORT_HOST || DEFAULT_GELF_HOST).trim() || DEFAULT_GELF_HOST,
    port: Math.max(1, Number(process.env.LOG_EXPORT_PORT || defaultPort) || defaultPort),
    env: String(process.env.NODE_ENV || 'production').trim() || 'production',
    service: String(process.env.LOG_EXPORT_SERVICE || 'backend').trim() || 'backend',
    hostLabel: String(process.env.LOG_EXPORT_HOST_LABEL || 'collectz-backend').trim() || 'collectz-backend',
    gitSha: String(process.env.GIT_SHA || '').trim() || null,
    debugEnabled: parseBoolean(process.env.LOG_EXPORT_DEBUG, false)
  };
}

function parseStoredDebug(value) {
  if (value === undefined || value === null || value === '') return null;
  return Boolean(value);
}

function defaultPortForBackend(backend) {
  return backend === 'syslog_udp' || backend === 'syslog_tcp'
    ? DEFAULT_SYSLOG_PORT
    : DEFAULT_GELF_PORT;
}

function normalizeStoredExportConfig(row) {
  const backendRaw = String(row?.log_export_backend || '').trim().toLowerCase();
  const backend = backendRaw && LOG_EXPORT_BACKENDS.has(backendRaw) ? backendRaw : null;
  const hostLabel = String(row?.log_export_host_label || '').trim() || null;
  const service = String(row?.log_export_service || '').trim() || null;
  const debugEnabled = parseStoredDebug(row?.log_export_debug);
  if (!backend && !hostLabel && !service && debugEnabled === null) return null;
  const defaultPort = defaultPortForBackend(backend || 'gelf_udp');
  return {
    backend,
    host: backend ? (String(row?.log_export_host || DEFAULT_GELF_HOST).trim() || DEFAULT_GELF_HOST) : null,
    port: backend ? Math.max(1, Number(row?.log_export_port || defaultPort) || defaultPort) : null,
    hostLabel,
    service,
    debugEnabled
  };
}

function normalizeExplicitExportConfig(input = {}) {
  const backendRaw = String(input?.backend || '').trim().toLowerCase();
  if (!backendRaw || !LOG_EXPORT_BACKENDS.has(backendRaw)) return null;
  const defaultPort = defaultPortForBackend(backendRaw);
  return {
    backend: backendRaw,
    host: String(input?.host || DEFAULT_GELF_HOST).trim() || DEFAULT_GELF_HOST,
    port: Math.max(1, Number(input?.port || defaultPort) || defaultPort),
    hostLabel: String(input?.hostLabel || '').trim() || null,
    service: String(input?.service || '').trim() || null,
    debugEnabled: input?.debugEnabled === undefined ? null : parseBoolean(input?.debugEnabled, false)
  };
}

async function loadStoredExportConfig({ forceRefresh = false } = {}) {
  if (!forceRefresh && storedConfigCache && (Date.now() - storedConfigCacheAt) < LOG_EXPORT_CONFIG_CACHE_TTL_MS) {
    return storedConfigCache;
  }
  const result = await pool.query(
    'SELECT log_export_backend, log_export_host, log_export_port, log_export_host_label, log_export_service, log_export_debug FROM app_integrations WHERE id = 1'
  );
  storedConfigCache = normalizeStoredExportConfig(result.rows[0] || null);
  storedConfigCacheAt = Date.now();
  return storedConfigCache;
}

function readCachedExportConfig() {
  const envConfig = readExportConfig();
  if (LOG_EXPORT_SETTINGS_READ_ONLY || !storedConfigCache) return envConfig;
  return {
    ...envConfig,
    backend: storedConfigCache.backend || envConfig.backend,
    host: storedConfigCache.backend ? storedConfigCache.host : envConfig.host,
    port: storedConfigCache.backend ? storedConfigCache.port : envConfig.port,
    hostLabel: storedConfigCache.hostLabel || envConfig.hostLabel,
    service: storedConfigCache.service || envConfig.service,
    debugEnabled: storedConfigCache.debugEnabled === null || storedConfigCache.debugEnabled === undefined
      ? envConfig.debugEnabled
      : storedConfigCache.debugEnabled
  };
}

function invalidateStoredExportConfigCache() {
  storedConfigCache = null;
  storedConfigCacheAt = 0;
}

async function resolveExportConfig(options = {}) {
  const envConfig = readExportConfig();

  if (LOG_EXPORT_SETTINGS_READ_ONLY) {
    return {
      ...envConfig,
      controlPlane: {
        readOnly: true,
        source: 'env_override',
        supportedBackends: [...LOG_EXPORT_BACKENDS],
        stored: null,
        effective: {
          backend: envConfig.backend,
          host: envConfig.host,
          port: envConfig.port,
          hostLabel: envConfig.hostLabel,
          service: envConfig.service
        }
      }
    };
  }

  const stored = await loadStoredExportConfig(options);
  if (stored) {
    const effective = {
      backend: stored.backend || envConfig.backend,
      host: stored.backend ? stored.host : envConfig.host,
      port: stored.backend ? stored.port : envConfig.port,
      hostLabel: stored.hostLabel || envConfig.hostLabel,
      service: stored.service || envConfig.service,
      debugEnabled: stored.debugEnabled === null || stored.debugEnabled === undefined
        ? envConfig.debugEnabled
        : stored.debugEnabled
    };
    return {
      ...envConfig,
      ...effective,
      controlPlane: {
        readOnly: false,
        source: 'stored',
        supportedBackends: [...LOG_EXPORT_BACKENDS],
        stored,
        effective
      }
    };
  }

  return {
    ...envConfig,
    controlPlane: {
      readOnly: false,
      source: 'env_fallback',
      supportedBackends: [...LOG_EXPORT_BACKENDS],
      stored: null,
      effective: {
        backend: envConfig.backend,
        host: envConfig.host,
        port: envConfig.port,
        hostLabel: envConfig.hostLabel,
        service: envConfig.service
      }
    }
  };
}

function debugLog(message, fields = {}) {
  const config = readCachedExportConfig();
  if (!config.debugEnabled) return;
  console.log(`[log-export-debug] ${message} ${JSON.stringify(fields)}`);
}

function inferOutcome(action, details) {
  const detailOutcome = details && typeof details === 'object' ? details.outcome : null;
  if (detailOutcome && typeof detailOutcome === 'string') return detailOutcome;
  if (typeof action !== 'string') return 'success';
  if (action.endsWith('.failed')) return 'failed';
  if (action.endsWith('.denied')) return 'denied';
  if (action.includes('.failed.')) return 'failed';
  return 'success';
}

function inferLevel(action, details) {
  const status = Number(details?.status || details?._status || 0) || 0;
  if (status >= 500) return 3;
  if (status >= 400) return 4;
  if (typeof action === 'string') {
    if (action.endsWith('.failed') || action.includes('.failed.')) return 3;
    if (action.endsWith('.denied') || action.includes('.denied.') || action.includes('csrf.failed')) return 4;
  }
  return 6;
}

function truncateJsonValue(value, maxBytes = MAX_DETAIL_BYTES) {
  if (value === null || value === undefined) return value;
  const serialized = JSON.stringify(value);
  if (!serialized) return value;
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) return value;
  const truncated = serialized.slice(0, Math.max(0, maxBytes - 64));
  return {
    truncated: true,
    preview: truncated,
    originalBytes: Buffer.byteLength(serialized, 'utf8')
  };
}

function promoteDetailFields(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  return Object.entries(DETAIL_PROMOTION_MAP).reduce((acc, [detailKey, fieldName]) => {
    const value = details[detailKey];
    if (value === undefined || value === null) return acc;
    if ((value !== null && typeof value === 'object') || Array.isArray(value)) return acc;
    if (typeof value === 'boolean') {
      acc[fieldName] = value ? 'true' : 'false';
      return acc;
    }
    acc[fieldName] = value;
    return acc;
  }, {});
}

function omitNilFields(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== null && value !== undefined)
  );
}

function sanitizeSyslogToken(value, fallback = '-') {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).replace(/\s+/g, '_');
}

function escapeStructuredDataValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\]/g, '\\]');
}

function buildSyslogStructuredData(event) {
  const fields = [
    ['action', event?._action],
    ['entity_type', event?._entity_type],
    ['entity_id', event?._entity_id],
    ['user_id', event?._user_id],
    ['request_id', event?._request_id],
    ['route', event?._route],
    ['method', event?._method],
    ['outcome', event?._outcome],
    ['detail_key', event?._detail_key]
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');

  if (!fields.length) return '-';
  const rendered = fields
    .map(([key, value]) => `${key}="${escapeStructuredDataValue(value)}"`)
    .join(' ');
  return `[collectz@41058 ${rendered}]`;
}

function formatSyslogMessage(event) {
  const timestamp = new Date((event?.timestamp || Date.now() / 1000) * 1000).toISOString();
  const host = sanitizeSyslogToken(event?.host, 'collectz-backend');
  const appName = sanitizeSyslogToken(event?._service || 'backend', 'backend');
  const procId = '-';
  const msgId = sanitizeSyslogToken(event?._action || event?.short_message || 'activity_log', 'activity_log');
  const structuredData = buildSyslogStructuredData(event);
  const message = JSON.stringify(event);
  return `<14>1 ${timestamp} ${host} ${appName} ${procId} ${msgId} ${structuredData} ${message}`;
}

function buildGelfEvent({ req, action, entityType = null, entityId = null, details = null, ipAddress = null, userId = null, configOverride = null }) {
  const config = configOverride || readExportConfig();
  const normalizedDetails = truncateJsonValue(details);
  const route = req?.route?.path || req?.path || req?.originalUrl || null;
  const method = req?.method || normalizedDetails?.method || null;
  const status = Number(normalizedDetails?.status || 0) || null;
  const durationMs = Number(normalizedDetails?.durationMs || normalizedDetails?.duration_ms || 0) || null;
  const outcome = inferOutcome(action, normalizedDetails);

  return omitNilFields({
    version: '1.1',
    host: config.hostLabel,
    short_message: action || 'activity_log',
    timestamp: Date.now() / 1000,
    level: inferLevel(action, normalizedDetails),
    _service: config.service,
    _env: config.env,
    _app_version: process.env.APP_VERSION || appMeta.backend || appMeta.version || 'unknown',
    _git_sha: config.gitSha,
    _action: action || null,
    _entity_type: entityType || null,
    _entity_id: entityId ?? null,
    _user_id: userId ?? null,
    _ip_address: ipAddress || null,
    _request_id: req?.requestId || req?.headers?.['x-request-id'] || null,
    _route: route,
    _method: method,
    _status: status,
    _duration_ms: durationMs,
    _outcome: outcome,
    _details: normalizedDetails || null,
    ...promoteDetailFields(normalizedDetails)
  });
}

async function sendUdp(host, port, payload) {
  await new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    const buffer = Buffer.from(payload, 'utf8');
    client.send(buffer, port, host, (error) => {
      client.close();
      if (error) reject(error);
      else resolve();
    });
  });
}

async function sendTcp(host, port, payload) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.write(payload);
      socket.end();
    });
    socket.on('error', reject);
    socket.on('close', () => resolve());
  });
}

async function emitStructuredLogWithConfig(event, config) {
  if (!config || config.backend === 'off') return false;

  const payload = JSON.stringify(event);
  debugLog('emit.attempt', {
    backend: config.backend,
    host: config.host,
    port: config.port,
    action: event?._action || event?.short_message || null,
    requestId: event?._request_id || null
  });
  if (config.backend === 'stdout_json') {
    console.log(payload);
    debugLog('emit.success', {
      backend: config.backend,
      action: event?._action || event?.short_message || null,
      requestId: event?._request_id || null
    });
    return true;
  }
  if (config.backend === 'gelf_udp') {
    await sendUdp(config.host, config.port, payload);
    debugLog('emit.success', {
      backend: config.backend,
      action: event?._action || event?.short_message || null,
      requestId: event?._request_id || null
    });
    return true;
  }
  if (config.backend === 'gelf_tcp') {
    await sendTcp(config.host, config.port, `${payload}\0`);
    debugLog('emit.success', {
      backend: config.backend,
      action: event?._action || event?.short_message || null,
      requestId: event?._request_id || null
    });
    return true;
  }
  if (config.backend === 'syslog_udp') {
    const syslogPayload = formatSyslogMessage(event);
    await sendUdp(config.host, config.port, syslogPayload);
    debugLog('emit.success', {
      backend: config.backend,
      action: event?._action || event?.short_message || null,
      requestId: event?._request_id || null
    });
    return true;
  }
  if (config.backend === 'syslog_tcp') {
    const syslogPayload = formatSyslogMessage(event);
    await sendTcp(config.host, config.port, `${syslogPayload}\n`);
    debugLog('emit.success', {
      backend: config.backend,
      action: event?._action || event?.short_message || null,
      requestId: event?._request_id || null
    });
    return true;
  }
  return false;
}

async function emitStructuredLog(event) {
  const config = await resolveExportConfig();
  return emitStructuredLogWithConfig(event, config);
}

async function validateStructuredLogDelivery(configInput) {
  const config = normalizeExplicitExportConfig(configInput);
  if (!config || config.backend === 'off') {
    return {
      ok: false,
      status: 'failed',
      detail: 'External structured log backend is off, so there is no collector path to validate.',
      mode: 'disabled',
      config: config || {
        backend: 'off',
        host: DEFAULT_GELF_HOST,
        port: DEFAULT_GELF_PORT
      }
    };
  }

  const validationId = `log-validate-${Date.now()}`;
  const event = buildGelfEvent({
    action: 'admin.integrations.external_logs.validate',
    entityType: 'app_integrations',
    entityId: 1,
    details: {
      validationId,
      backend: config.backend,
      host: config.host,
      port: config.port
    }
  });
  try {
    await emitStructuredLogWithConfig(event, config);
    if (config.backend === 'gelf_udp' || config.backend === 'syslog_udp') {
      return {
        ok: true,
        status: 'warning',
        detail: 'Datagram send succeeded, but UDP collectors do not acknowledge receipt. Use the collector-specific smoke path when you need end-to-end proof.',
        mode: 'udp_send',
        config
      };
    }
    return {
      ok: true,
      status: 'passed',
      detail: config.backend === 'stdout_json'
        ? 'Structured log event emitted to backend stdout JSON successfully.'
        : 'Structured log event reached the configured TCP collector path successfully.',
      mode: config.backend === 'stdout_json' ? 'stdout_emit' : 'tcp_connect',
      config
    };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      detail: error?.message || 'Structured log validation failed.',
      mode: config.backend === 'gelf_udp' || config.backend === 'syslog_udp' ? 'udp_send' : 'tcp_connect',
      config
    };
  }
}

async function maybeExportActivityLog(event) {
  const config = await resolveExportConfig();
  if (config.backend === 'off') {
    debugLog('skip.backend_off', {
      action: event?._action || event?.short_message || null,
      requestId: event?._request_id || null
    });
    return false;
  }
  const enabled = await isFeatureEnabled('external_log_export_enabled', false);
  if (!enabled) {
    debugLog('skip.feature_flag_disabled', {
      action: event?._action || event?.short_message || null,
      requestId: event?._request_id || null
    });
    return false;
  }
  await emitStructuredLog(event);
  debugLog('export.complete', {
    action: event?._action || event?.short_message || null,
    requestId: event?._request_id || null
  });
  return true;
}

module.exports = {
  LOG_EXPORT_BACKENDS,
  LOG_EXPORT_SETTINGS_READ_ONLY,
  buildGelfEvent,
  debugLog,
  emitStructuredLog,
  inferLevel,
  inferOutcome,
  invalidateStoredExportConfigCache,
  maybeExportActivityLog,
  normalizeExplicitExportConfig,
  omitNilFields,
  formatSyslogMessage,
  promoteDetailFields,
  readExportConfig,
  resolveExportConfig,
  validateStructuredLogDelivery,
  truncateJsonValue
};
