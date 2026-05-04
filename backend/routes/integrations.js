const express = require('express');
const axios = require('axios');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { isHomelabEdition } = require('../config/productEdition');
const { loadAdminIntegrationConfig, normalizeIntegrationRecord, loadGeneralSettings } = require('../services/integrations');
const { encryptSecret, maskSecret } = require('../services/crypto');
const { buildObservabilityRuntimeDiagnostics } = require('../services/observabilityRuntime');
const { resolveExportConfig, invalidateStoredExportConfigCache, LOG_EXPORT_BACKENDS, LOG_EXPORT_SETTINGS_READ_ONLY, validateStructuredLogDelivery, normalizeExplicitExportConfig } = require('../services/logExport');
const {
  DEFAULT_PRICECHARTING_API_URL,
  DEFAULT_EBAY_BROWSE_API_URL,
  DEFAULT_EBAY_MARKETPLACE_ID,
  MIN_PRICECHARTING_INTERVAL_MS,
  normalizePositiveInteger,
  buildPriceChartingDryRun,
  buildEbayBrowseDryRun
} = require('../services/valuations');
const { resolveBarcodePreset } = require('../services/barcode');
const { resolveTmdbPreset, searchTmdbMovie } = require('../services/tmdb');
const { resolvePlexPreset, fetchPlexSections } = require('../services/plex');
const { resolveBooksPreset, searchBooksByTitle } = require('../services/books');
const { resolveAudioPreset, searchAudioByTitle } = require('../services/audio');
const { resolveGamesPreset, searchGamesByTitle } = require('../services/games');
const { resolveComicsPreset, searchComicsByTitle, fetchMetronCollectionIssues } = require('../services/comics');
const { normalizeKavitaBaseUrl, testKavitaConnection } = require('../services/kavita');
const { logActivity, logError } = require('../services/audit');
const { DECRYPT_REMEDIATION } = require('../services/integrationResponse');
const { resolveScopeContext } = require('../db/scopeContext');

const sharedRouter = express.Router();
const platformRouter = express.Router();
const HOMELAB_EDITION = isHomelabEdition();

async function buildSharedIntegrationPayload(config) {
  return {
    barcodePreset: config?.barcodePreset || 'upcitemdb',
    barcodeProvider: config?.barcodeProvider || resolveBarcodePreset(config).provider,
    barcodeApiUrl: config?.barcodeApiUrl || '',
    barcodeApiKeySet: Boolean(config?.barcodeApiKey),
    barcodeApiKeyMasked: maskSecret(config?.barcodeApiKey || ''),
    tmdbPreset: config?.tmdbPreset || 'tmdb',
    tmdbProvider: config?.tmdbProvider || resolveTmdbPreset(config).provider,
    tmdbApiUrl: config?.tmdbApiUrl || '',
    tmdbApiKeySet: Boolean(config?.tmdbApiKey),
    tmdbApiKeyMasked: maskSecret(config?.tmdbApiKey || ''),
    plexPreset: config?.plexPreset || 'plex',
    plexProvider: config?.plexProvider || resolvePlexPreset(config).provider,
    plexApiUrl: config?.plexApiUrl || '',
    plexLibrarySections: Array.isArray(config?.plexLibrarySections) ? config.plexLibrarySections : [],
    plexApiKeySet: Boolean(config?.plexApiKey),
    plexApiKeyMasked: maskSecret(config?.plexApiKey || ''),
    booksPreset: config?.booksPreset || 'googlebooks',
    booksProvider: config?.booksProvider || resolveBooksPreset(config).provider,
    booksApiUrl: config?.booksApiUrl || '',
    booksApiKeySet: Boolean(config?.booksApiKey),
    booksApiKeyMasked: maskSecret(config?.booksApiKey || ''),
    audioPreset: config?.audioPreset || 'discogs',
    audioProvider: config?.audioProvider || resolveAudioPreset(config).provider,
    audioApiUrl: config?.audioApiUrl || '',
    audioApiKeySet: Boolean(config?.audioApiKey),
    audioApiKeyMasked: maskSecret(config?.audioApiKey || ''),
    gamesPreset: config?.gamesPreset || 'igdb',
    gamesProvider: config?.gamesProvider || resolveGamesPreset(config).provider,
    gamesApiUrl: config?.gamesApiUrl || '',
    gamesClientId: config?.gamesClientId || '',
    gamesApiKeySet: Boolean(config?.gamesApiKey),
    gamesApiKeyMasked: maskSecret(config?.gamesApiKey || ''),
    gamesClientSecretSet: Boolean(config?.gamesClientSecret),
    gamesClientSecretMasked: maskSecret(config?.gamesClientSecret || ''),
    comicsPreset: config?.comicsPreset || 'metron',
    comicsProvider: config?.comicsProvider || resolveComicsPreset(config).provider,
    comicsApiUrl: config?.comicsApiUrl || '',
    comicsUsername: config?.comicsUsername || '',
    comicsApiKeySet: Boolean(config?.comicsApiKey),
    comicsApiKeyMasked: maskSecret(config?.comicsApiKey || ''),
    cwaOpdsUrl: config?.cwaOpdsUrl || '',
    cwaUsername: config?.cwaUsername || '',
    cwaPasswordSet: Boolean(config?.cwaPassword),
    cwaPasswordMasked: maskSecret(config?.cwaPassword || ''),
    kavitaBaseUrl: config?.kavitaBaseUrl || '',
    kavitaApiKeySet: Boolean(config?.kavitaApiKey),
    kavitaApiKeyMasked: maskSecret(config?.kavitaApiKey || ''),
    kavitaTimeoutMs: config?.kavitaTimeoutMs || 20000,
    decryptHealth: {
      hasWarnings: Array.isArray(config?.decryptWarnings) && config.decryptWarnings.length > 0,
      warnings: Array.isArray(config?.decryptWarnings) ? config.decryptWarnings : [],
      remediation: DECRYPT_REMEDIATION
    }
  };
}

async function buildPlatformIntegrationPayload(config) {
  const resolvedExportConfig = await resolveExportConfig({ forceRefresh: true });
  return {
    ...(await buildSharedIntegrationPayload(config)),
    valuationProviders: {
      pricecharting: {
        enabled: Boolean(config?.priceChartingEnabled),
        apiUrl: config?.priceChartingApiUrl || DEFAULT_PRICECHARTING_API_URL,
        apiKeySet: Boolean(config?.priceChartingApiKey),
        apiKeyMasked: maskSecret(config?.priceChartingApiKey || ''),
        rateLimitMs: Math.max(
          MIN_PRICECHARTING_INTERVAL_MS,
          normalizePositiveInteger(config?.priceChartingRateLimitMs, MIN_PRICECHARTING_INTERVAL_MS)
        ),
        queueMode: 'serialized',
        concurrency: 1,
        automatedTesting: 'fixture_only'
      },
      ebayBrowse: {
        enabled: Boolean(config?.eBayBrowseEnabled),
        apiUrl: config?.eBayBrowseApiUrl || DEFAULT_EBAY_BROWSE_API_URL,
        clientId: config?.eBayBrowseClientId || '',
        clientSecretSet: Boolean(config?.eBayBrowseClientSecret),
        clientSecretMasked: maskSecret(config?.eBayBrowseClientSecret || ''),
        marketplaceId: config?.eBayBrowseMarketplaceId || DEFAULT_EBAY_MARKETPLACE_ID,
        automatedTesting: 'fixture_only'
      }
    },
    logExportControl: {
      readOnly: Boolean(resolvedExportConfig.controlPlane?.readOnly),
      source: resolvedExportConfig.controlPlane?.source || 'env_fallback',
      supportedBackends: resolvedExportConfig.controlPlane?.supportedBackends || [...LOG_EXPORT_BACKENDS],
      effective: resolvedExportConfig.controlPlane?.effective || {
        backend: resolvedExportConfig.backend,
        host: resolvedExportConfig.host,
        port: resolvedExportConfig.port,
        hostLabel: resolvedExportConfig.hostLabel,
        service: resolvedExportConfig.service,
        debugEnabled: resolvedExportConfig.debugEnabled
      },
      stored: resolvedExportConfig.controlPlane?.stored || null,
      lastValidation: config?.logExportLastValidation || null
    },
    observabilityRuntime: await buildObservabilityRuntimeDiagnostics()
  };
}

function buildHomelabIntegrationPayload(config) {
  return buildSharedIntegrationPayload(config);
}

function resolveNextAdminValuationState(body = {}, existing = null) {
  const pick = (incoming, existingValue, fallback) =>
    incoming !== undefined ? incoming : (existingValue ?? fallback);

  const nextPriceChartingApiKey = body.clearPriceChartingApiKey
    ? null
    : (body.priceChartingApiKey
      ? encryptSecret(body.priceChartingApiKey)
      : existing?.pricecharting_api_key_encrypted || null);

  const nextEbayClientSecret = body.clearEBayBrowseClientSecret
    ? null
    : (body.eBayBrowseClientSecret
      ? encryptSecret(body.eBayBrowseClientSecret)
      : existing?.ebay_browse_client_secret_encrypted || null);

  return {
    pricecharting_enabled: pick(body.priceChartingEnabled, existing?.pricecharting_enabled, false),
    pricecharting_api_url: pick(body.priceChartingApiUrl, existing?.pricecharting_api_url, DEFAULT_PRICECHARTING_API_URL),
    pricecharting_api_key_encrypted: nextPriceChartingApiKey,
    pricecharting_rate_limit_ms: Math.max(
      MIN_PRICECHARTING_INTERVAL_MS,
      normalizePositiveInteger(
        pick(body.priceChartingRateLimitMs, existing?.pricecharting_rate_limit_ms, MIN_PRICECHARTING_INTERVAL_MS),
        MIN_PRICECHARTING_INTERVAL_MS
      )
    ),
    ebay_browse_enabled: pick(body.eBayBrowseEnabled, existing?.ebay_browse_enabled, false),
    ebay_browse_api_url: pick(body.eBayBrowseApiUrl, existing?.ebay_browse_api_url, DEFAULT_EBAY_BROWSE_API_URL),
    ebay_browse_client_id: pick(body.eBayBrowseClientId, existing?.ebay_browse_client_id, ''),
    ebay_browse_client_secret_encrypted: nextEbayClientSecret,
    ebay_browse_marketplace_id: pick(body.eBayBrowseMarketplaceId, existing?.ebay_browse_marketplace_id, DEFAULT_EBAY_MARKETPLACE_ID)
  };
}

function normalizeLogExportValidationRecord(row) {
  const status = String(row?.log_export_last_validation_status || '').trim().toLowerCase();
  if (!status) return null;
  return {
    status,
    detail: String(row?.log_export_last_validation_message || '').trim() || '',
    backend: row?.log_export_last_validation_backend || null,
    host: row?.log_export_last_validation_host || null,
    port: Number(row?.log_export_last_validation_port || 0) || null,
    validatedAt: row?.log_export_last_validated_at || null
  };
}

function hasPlatformOnlyIntegrationUpdate(body = {}) {
  return (
    body.priceChartingEnabled !== undefined
    || body.priceChartingApiUrl !== undefined
    || body.priceChartingApiKey !== undefined
    || body.clearPriceChartingApiKey !== undefined
    || body.priceChartingRateLimitMs !== undefined
    || body.eBayBrowseEnabled !== undefined
    || body.eBayBrowseApiUrl !== undefined
    || body.eBayBrowseClientId !== undefined
    || body.eBayBrowseClientSecret !== undefined
    || body.clearEBayBrowseClientSecret !== undefined
    || body.eBayBrowseMarketplaceId !== undefined
    || body.logExportBackend !== undefined
    || body.logExportHost !== undefined
    || body.logExportPort !== undefined
    || body.logExportHostLabel !== undefined
    || body.logExportService !== undefined
    || body.logExportDebug !== undefined
  );
}

// ── General settings (read — available to all authenticated users) ────────────

sharedRouter.get('/settings/general', authenticateToken, asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const settings = await loadGeneralSettings(scopeContext?.spaceId || null);
  res.json(settings);
}));

// ── Integration settings (admin only) ─────────────────────────────────────────

sharedRouter.get('/admin/settings/integrations', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const config = await loadAdminIntegrationConfig();
  res.json(await (HOMELAB_EDITION ? buildHomelabIntegrationPayload(config) : buildPlatformIntegrationPayload(config)));
}));

sharedRouter.put('/admin/settings/integrations', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const {
    logExportBackend, logExportHost, logExportPort, logExportHostLabel, logExportService, logExportDebug
  } = req.body;

  if (HOMELAB_EDITION && hasPlatformOnlyIntegrationUpdate(req.body)) {
    return res.status(404).json({ error: 'Platform-only integration settings are not available in homelab edition' });
  }

  const existingRow = await pool.query('SELECT * FROM app_integrations WHERE id = 1');
  const existing = existingRow.rows[0] || null;
  const pick = (incoming, existingValue, fallback) =>
    incoming !== undefined ? incoming : (existingValue ?? fallback);
  const requestsLogExportUpdate =
    logExportBackend !== undefined
    || logExportHost !== undefined
    || logExportPort !== undefined
    || logExportHostLabel !== undefined
    || logExportService !== undefined
    || logExportDebug !== undefined;
  const requestsValuationUpdate =
    req.body.priceChartingEnabled !== undefined
    || req.body.priceChartingApiUrl !== undefined
    || req.body.priceChartingApiKey !== undefined
    || req.body.clearPriceChartingApiKey !== undefined
    || req.body.priceChartingRateLimitMs !== undefined
    || req.body.eBayBrowseEnabled !== undefined
    || req.body.eBayBrowseApiUrl !== undefined
    || req.body.eBayBrowseClientId !== undefined
    || req.body.eBayBrowseClientSecret !== undefined
    || req.body.clearEBayBrowseClientSecret !== undefined
    || req.body.eBayBrowseMarketplaceId !== undefined;
  if (requestsLogExportUpdate && LOG_EXPORT_SETTINGS_READ_ONLY) {
    return res.status(409).json({ error: 'External log endpoint settings are read-only in this environment' });
  }

  const normalizedLogExportBackend = logExportBackend === undefined
    ? undefined
    : String(logExportBackend || '').trim().toLowerCase();
  if (normalizedLogExportBackend !== undefined && normalizedLogExportBackend !== '' && !LOG_EXPORT_BACKENDS.has(normalizedLogExportBackend)) {
    return res.status(400).json({ error: 'Unsupported external log backend' });
  }
  if (logExportPort !== undefined && logExportPort !== null && logExportPort !== '') {
    const parsedLogExportPort = Number(logExportPort);
    if (!Number.isInteger(parsedLogExportPort) || parsedLogExportPort < 1 || parsedLogExportPort > 65535) {
      return res.status(400).json({ error: 'External log port must be an integer between 1 and 65535' });
    }
  }
  if (req.body.priceChartingRateLimitMs !== undefined) {
    const parsedRateLimitMs = Number(req.body.priceChartingRateLimitMs);
    if (!Number.isInteger(parsedRateLimitMs) || parsedRateLimitMs < MIN_PRICECHARTING_INTERVAL_MS) {
      return res.status(400).json({ error: `PriceCharting interval must be an integer >= ${MIN_PRICECHARTING_INTERVAL_MS}ms` });
    }
  }
  const clearLogExportControl = normalizedLogExportBackend !== undefined && normalizedLogExportBackend === '';
  const nextLogExportBackend = clearLogExportControl
    ? null
    : pick(normalizedLogExportBackend, existing?.log_export_backend, null);
  const nextLogExportHost = clearLogExportControl
    ? null
    : pick(logExportHost !== undefined ? String(logExportHost || '').trim() : undefined, existing?.log_export_host, null);
  const nextLogExportPort = clearLogExportControl
    ? null
    : pick(
      logExportPort !== undefined && logExportPort !== null && logExportPort !== ''
        ? Number(logExportPort)
        : undefined,
      existing?.log_export_port,
      null
    );
  const nextLogExportHostLabel = clearLogExportControl
    ? null
    : pick(
      logExportHostLabel !== undefined ? (String(logExportHostLabel || '').trim() || null) : undefined,
      existing?.log_export_host_label,
      null
    );
  const nextLogExportService = clearLogExportControl
    ? null
    : pick(
      logExportService !== undefined ? (String(logExportService || '').trim() || null) : undefined,
      existing?.log_export_service,
      null
    );
  const nextLogExportDebug = clearLogExportControl
    ? null
    : pick(
      logExportDebug !== undefined ? Boolean(logExportDebug) : undefined,
      existing?.log_export_debug,
      null
    );
  const valuationState = resolveNextAdminValuationState(req.body, existing);
  const requestsKavitaUpdate =
    req.body.kavitaBaseUrl !== undefined
    || req.body.kavitaApiKey !== undefined
    || req.body.clearKavitaApiKey !== undefined
    || req.body.kavitaTimeoutMs !== undefined;
  const nextKavitaBaseUrl = req.body.kavitaBaseUrl !== undefined
    ? normalizeKavitaBaseUrl(req.body.kavitaBaseUrl)
    : (existing?.kavita_base_url || '');
  const nextKavitaApiKey = req.body.clearKavitaApiKey
    ? null
    : (req.body.kavitaApiKey
      ? encryptSecret(req.body.kavitaApiKey)
      : existing?.kavita_api_key_encrypted || null);
  const nextKavitaTimeoutMs = Math.max(
    1000,
    normalizePositiveInteger(
      req.body.kavitaTimeoutMs !== undefined ? req.body.kavitaTimeoutMs : existing?.kavita_timeout_ms,
      20000
    )
  );

  const result = await pool.query(
    `INSERT INTO app_integrations (
       id,
       pricecharting_enabled,
       pricecharting_api_url,
       pricecharting_api_key_encrypted,
       pricecharting_rate_limit_ms,
       ebay_browse_enabled,
       ebay_browse_api_url,
       ebay_browse_client_id,
       ebay_browse_client_secret_encrypted,
       ebay_browse_marketplace_id,
       log_export_backend,
       log_export_host,
       log_export_port,
       log_export_host_label,
       log_export_service,
       log_export_debug,
       kavita_base_url,
       kavita_api_key_encrypted,
       kavita_timeout_ms
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
     )
     ON CONFLICT (id) DO UPDATE SET
       pricecharting_enabled = EXCLUDED.pricecharting_enabled,
       pricecharting_api_url = EXCLUDED.pricecharting_api_url,
       pricecharting_api_key_encrypted = EXCLUDED.pricecharting_api_key_encrypted,
       pricecharting_rate_limit_ms = EXCLUDED.pricecharting_rate_limit_ms,
       ebay_browse_enabled = EXCLUDED.ebay_browse_enabled,
       ebay_browse_api_url = EXCLUDED.ebay_browse_api_url,
       ebay_browse_client_id = EXCLUDED.ebay_browse_client_id,
       ebay_browse_client_secret_encrypted = EXCLUDED.ebay_browse_client_secret_encrypted,
       ebay_browse_marketplace_id = EXCLUDED.ebay_browse_marketplace_id,
       log_export_backend = EXCLUDED.log_export_backend,
       log_export_host = EXCLUDED.log_export_host,
       log_export_port = EXCLUDED.log_export_port,
       log_export_host_label = EXCLUDED.log_export_host_label,
       log_export_service = EXCLUDED.log_export_service,
       log_export_debug = EXCLUDED.log_export_debug,
       kavita_base_url = EXCLUDED.kavita_base_url,
       kavita_api_key_encrypted = EXCLUDED.kavita_api_key_encrypted,
       kavita_timeout_ms = EXCLUDED.kavita_timeout_ms
     RETURNING *`,
    [
      1,
      valuationState.pricecharting_enabled,
      valuationState.pricecharting_api_url,
      valuationState.pricecharting_api_key_encrypted,
      valuationState.pricecharting_rate_limit_ms,
      valuationState.ebay_browse_enabled,
      valuationState.ebay_browse_api_url,
      valuationState.ebay_browse_client_id,
      valuationState.ebay_browse_client_secret_encrypted,
      valuationState.ebay_browse_marketplace_id,
      nextLogExportBackend,
      nextLogExportHost,
      nextLogExportPort,
      nextLogExportHostLabel,
      nextLogExportService,
      nextLogExportDebug,
      nextKavitaBaseUrl,
      nextKavitaApiKey,
      nextKavitaTimeoutMs
    ]
  );

  invalidateStoredExportConfigCache();
  const config = normalizeIntegrationRecord(result.rows[0]);
  await logActivity(req, 'admin.settings.integrations.update', 'app_integrations', 1, {
    valuationProviders: requestsValuationUpdate
      ? {
        pricecharting: {
          enabled: valuationState.pricecharting_enabled,
          apiUrl: valuationState.pricecharting_api_url,
          rateLimitMs: valuationState.pricecharting_rate_limit_ms,
          apiKeyUpdated: Boolean(req.body.priceChartingApiKey),
          apiKeyCleared: Boolean(req.body.clearPriceChartingApiKey)
        },
        ebayBrowse: {
          enabled: valuationState.ebay_browse_enabled,
          apiUrl: valuationState.ebay_browse_api_url,
          clientId: valuationState.ebay_browse_client_id,
          marketplaceId: valuationState.ebay_browse_marketplace_id,
          clientSecretUpdated: Boolean(req.body.eBayBrowseClientSecret),
          clientSecretCleared: Boolean(req.body.clearEBayBrowseClientSecret)
        }
      }
      : null,
    logExportControl: requestsLogExportUpdate
      ? {
        backend: nextLogExportBackend,
        host: nextLogExportHost,
        port: nextLogExportPort,
        hostLabel: nextLogExportHostLabel,
        service: nextLogExportService,
        debugEnabled: nextLogExportDebug,
        source: clearLogExportControl ? 'env_fallback' : 'stored'
      }
      : null,
    kavita: requestsKavitaUpdate
      ? {
        configured: Boolean(nextKavitaBaseUrl),
        timeoutMs: nextKavitaTimeoutMs,
        apiKeyUpdated: Boolean(req.body.kavitaApiKey),
        apiKeyCleared: Boolean(req.body.clearKavitaApiKey)
      }
      : null
  });

  res.json(await (HOMELAB_EDITION ? buildHomelabIntegrationPayload(config) : buildPlatformIntegrationPayload(config)));
}));

platformRouter.post('/admin/settings/integrations/test-pricecharting', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const config = await loadAdminIntegrationConfig();
  const dryRun = buildPriceChartingDryRun(config, req.body || {});
  res.status(dryRun.status === 400 ? 400 : 200).json(dryRun);
}));

platformRouter.post('/admin/settings/integrations/test-ebay', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const config = await loadAdminIntegrationConfig();
  const dryRun = buildEbayBrowseDryRun(config, req.body || {});
  res.status(dryRun.status === 400 ? 400 : 200).json(dryRun);
}));

// ── Integration test endpoints ────────────────────────────────────────────────

sharedRouter.post('/admin/settings/integrations/test-barcode', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const { upc } = req.body || {};
  const config = await loadAdminIntegrationConfig();
  const testUpc = String(upc || '012569828708').trim();

  if (!config.barcodeApiUrl) {
    return res.status(400).json({ ok: false, authenticated: false, detail: 'Barcode API URL is not configured' });
  }

  const headers = {};
  if (config.barcodeApiKey) headers[config.barcodeApiKeyHeader || 'x-api-key'] = config.barcodeApiKey;

  const response = await axios.get(config.barcodeApiUrl, {
    params: { [config.barcodeQueryParam || 'upc']: testUpc },
    headers,
    timeout: 15000,
    validateStatus: () => true
  });

  const status = response.status;
  const authenticated = status !== 401 && status !== 403;
  res.json({
    ok: authenticated, authenticated, status, provider: config.barcodeProvider,
    detail: response.data?.message || response.data?.error || `Provider returned status ${status}`
  });
}));

sharedRouter.post('/admin/settings/integrations/test-tmdb', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const { title, year } = req.body || {};
  const config = await loadAdminIntegrationConfig();

  try {
    const results = await searchTmdbMovie(String(title || 'The Matrix').trim(), year || '1999', config);
    res.json({
      ok: true, authenticated: true, status: 200, provider: config.tmdbProvider || 'tmdb',
      detail: `Received ${results.length} result(s)`, resultCount: results.length
    });
  } catch (error) {
    logError('Test TMDB integration', error);
    const status = error.response?.status || 502;
    res.json({
      ok: false, authenticated: status !== 401 && status !== 403, status,
      provider: config.tmdbProvider || 'tmdb',
      detail: error.response?.data?.status_message || error.response?.data?.message || error.message
    });
  }
}));

sharedRouter.post('/admin/settings/integrations/test-plex', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const config = await loadAdminIntegrationConfig();
  if (!config.plexApiUrl) {
    return res.status(400).json({ ok: false, authenticated: false, detail: 'Plex API URL is not configured' });
  }
  if (!config.plexApiKey) {
    return res.status(400).json({ ok: false, authenticated: false, detail: 'Plex API key is not configured' });
  }

  try {
    const sections = await fetchPlexSections(config);
    const movieSections = sections.filter((s) => s.type === 'movie');
    const byType = sections.reduce((acc, s) => {
      const key = s.type || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    res.json({
      ok: true,
      authenticated: true,
      status: 200,
      provider: config.plexProvider || 'plex',
      detail: `Connected. Found ${movieSections.length} movie section(s) (${sections.length} total). Types: ${JSON.stringify(byType)}`,
      sections,
      movieSections
    });
  } catch (error) {
    logError('Test Plex integration', error);
    const status = error.response?.status || 502;
    res.json({
      ok: false,
      authenticated: status !== 401 && status !== 403,
      status,
      provider: config.plexProvider || 'plex',
      detail: error.message
    });
  }
}));

sharedRouter.post('/admin/settings/integrations/test-books', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const { title, author } = req.body || {};
  const config = await loadAdminIntegrationConfig();
  if (!config.booksApiUrl) {
    return res.status(400).json({ ok: false, authenticated: false, detail: 'Books API URL is not configured' });
  }
  try {
    const results = await searchBooksByTitle(String(title || 'Dust').trim(), config, 5, String(author || 'Hugh Howey').trim());
    res.json({
      ok: true,
      authenticated: true,
      status: 200,
      provider: config.booksProvider || 'googlebooks',
      detail: `Received ${results.length} result(s)`,
      resultCount: results.length
    });
  } catch (error) {
    logError('Test books integration', error);
    const status = error.status || error.response?.status || 502;
    res.json({
      ok: false,
      authenticated: status !== 401 && status !== 403,
      status,
      provider: config.booksProvider || 'googlebooks',
      detail: error.message
    });
  }
}));

sharedRouter.post('/admin/settings/integrations/test-audio', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const { title, artist } = req.body || {};
  const config = await loadAdminIntegrationConfig();
  if (!config.audioApiUrl) {
    return res.status(400).json({ ok: false, authenticated: false, detail: 'Audio API URL is not configured' });
  }
  try {
    const results = await searchAudioByTitle(String(title || 'Kind of Blue').trim(), config, 5, String(artist || 'Miles Davis').trim());
    res.json({
      ok: true,
      authenticated: true,
      status: 200,
      provider: config.audioProvider || 'discogs',
      detail: `Received ${results.length} result(s)`,
      resultCount: results.length
    });
  } catch (error) {
    logError('Test audio integration', error);
    const status = error.status || error.response?.status || 502;
    res.json({
      ok: false,
      authenticated: status !== 401 && status !== 403,
      status,
      provider: config.audioProvider || 'discogs',
      detail: error.message
    });
  }
}));

sharedRouter.post('/admin/settings/integrations/test-games', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const { title } = req.body || {};
  const config = await loadAdminIntegrationConfig();
  if (!config.gamesApiUrl) {
    return res.status(400).json({ ok: false, authenticated: false, detail: 'Games API URL is not configured' });
  }
  try {
    const results = await searchGamesByTitle(String(title || 'Halo').trim(), config, 5);
    res.json({
      ok: true,
      authenticated: true,
      status: 200,
      provider: config.gamesProvider || 'igdb',
      detail: `Received ${results.length} result(s)`,
      resultCount: results.length
    });
  } catch (error) {
    logError('Test games integration', error);
    const status = error.status || error.response?.status || 502;
    res.json({
      ok: false,
      authenticated: status !== 401 && status !== 403,
      status,
      provider: config.gamesProvider || 'igdb',
      detail: error.message
    });
  }
}));

sharedRouter.post('/admin/settings/integrations/test-comics', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const { title } = req.body || {};
  const config = await loadAdminIntegrationConfig();
  if (!config.comicsApiUrl) {
    return res.status(400).json({ ok: false, authenticated: false, detail: 'Comics API URL is not configured' });
  }
  try {
    const results = await searchComicsByTitle(String(title || 'Batman').trim(), config, 5);
    let collectionCount = null;
    if (String(config.comicsProvider || '').toLowerCase() === 'metron') {
      try {
        const collection = await fetchMetronCollectionIssues(config, { limit: 250 });
        collectionCount = collection.issues.length;
      } catch (_collectionError) {
        collectionCount = null;
      }
    }
    res.json({
      ok: true,
      authenticated: true,
      status: 200,
      provider: config.comicsProvider || 'metron',
      detail: collectionCount === null
        ? `Received ${results.length} result(s)`
        : `Received ${results.length} result(s), collection access ok (${collectionCount} issue(s) sampled)`,
      resultCount: results.length,
      collectionCount
    });
  } catch (error) {
    logError('Test comics integration', error);
    const status = error.status || error.response?.status || 502;
    res.json({
      ok: false,
      authenticated: status !== 401 && status !== 403,
      status,
      provider: config.comicsProvider || 'metron',
      detail: error.message
    });
  }
}));

sharedRouter.post('/admin/settings/integrations/test-cwa', authenticateToken, requireRole('admin'), asyncHandler(async (_req, res) => {
  return res.status(410).json({
    ok: false,
    authenticated: false,
    status: 410,
    provider: 'cwa_opds',
    detail: 'CWA OPDS integration testing is deferred and currently disabled.'
  });
}));

sharedRouter.post('/admin/settings/integrations/test-kavita', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const storedConfig = await loadAdminIntegrationConfig();
  const config = {
    ...storedConfig,
    kavitaBaseUrl: req.body?.kavitaBaseUrl !== undefined
      ? normalizeKavitaBaseUrl(req.body.kavitaBaseUrl)
      : storedConfig.kavitaBaseUrl,
    kavitaApiKey: req.body?.kavitaApiKey || storedConfig.kavitaApiKey,
    kavitaTimeoutMs: req.body?.kavitaTimeoutMs || storedConfig.kavitaTimeoutMs || 20000
  };

  try {
    const result = await testKavitaConnection(config);
    res.json(result);
  } catch (error) {
    logError('Test Kavita integration', error);
    const status = error.status || error.response?.status || 502;
    res.status(status >= 400 && status < 500 ? status : 200).json({
      ok: false,
      authenticated: status !== 401 && status !== 403,
      status,
      provider: 'kavita',
      detail: error.response?.data?.message || error.response?.data?.error || error.message
    });
  }
}));

platformRouter.post('/admin/settings/integrations/test-logs', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const requestedBackend = req.body?.logExportBackend;
  const requestedHost = req.body?.logExportHost;
  const requestedPort = req.body?.logExportPort;
  const requestedHostLabel = req.body?.logExportHostLabel;
  const requestedService = req.body?.logExportService;
  const requestedDebug = req.body?.logExportDebug;
  const resolved = await resolveExportConfig({ forceRefresh: true });
  const requestedAnyLogExportField = [
    requestedBackend,
    requestedHost,
    requestedPort,
    requestedHostLabel,
    requestedService,
    requestedDebug
  ].some((value) => value !== undefined);

  if (
    requestedPort !== undefined
    && requestedPort !== null
    && requestedPort !== ''
  ) {
    const parsedRequestedPort = Number(requestedPort);
    if (!Number.isInteger(parsedRequestedPort) || parsedRequestedPort < 1 || parsedRequestedPort > 65535) {
      return res.status(400).json({
        ok: false,
        authenticated: false,
        status: 400,
        provider: 'structured_logs',
        detail: 'External log port must be an integer between 1 and 65535'
      });
    }
  }

  let candidateConfig = resolved.controlPlane?.effective || {
    backend: resolved.backend,
    host: resolved.host,
    port: resolved.port,
    hostLabel: resolved.hostLabel,
    service: resolved.service,
    debugEnabled: resolved.debugEnabled
  };
  if (!LOG_EXPORT_SETTINGS_READ_ONLY && requestedAnyLogExportField) {
    const requestedBackendRaw = String(requestedBackend || '').trim().toLowerCase();
    const normalizedRequested = normalizeExplicitExportConfig({
      backend: requestedBackendRaw || candidateConfig.backend,
      host: requestedHost !== undefined ? requestedHost : candidateConfig.host,
      port: requestedPort !== undefined ? requestedPort : candidateConfig.port,
      hostLabel: requestedHostLabel,
      service: requestedService,
      debugEnabled: requestedDebug
    });
    if (!normalizedRequested) {
      return res.status(400).json({
        ok: false,
        authenticated: false,
        status: 400,
        provider: 'structured_logs',
        detail: 'Unsupported external log backend'
      });
    }
    candidateConfig = {
      ...candidateConfig,
      ...normalizedRequested,
      hostLabel: requestedHostLabel !== undefined
        ? (String(requestedHostLabel || '').trim() || null)
        : candidateConfig.hostLabel,
      service: requestedService !== undefined
        ? (String(requestedService || '').trim() || null)
        : candidateConfig.service,
      debugEnabled: requestedDebug !== undefined
        ? Boolean(requestedDebug)
        : candidateConfig.debugEnabled
    };
  }

  const validation = await validateStructuredLogDelivery(candidateConfig);
  const now = new Date();
  await pool.query(
    `UPDATE app_integrations
        SET log_export_last_validation_status = $1,
            log_export_last_validation_message = $2,
            log_export_last_validation_backend = $3,
            log_export_last_validation_host = $4,
            log_export_last_validation_port = $5,
            log_export_last_validated_at = $6
      WHERE id = 1`,
    [
      validation.status,
      validation.detail,
      validation.config?.backend || candidateConfig.backend || null,
      validation.config?.host || candidateConfig.host || null,
      validation.config?.port || candidateConfig.port || null,
      now.toISOString()
    ]
  );
  const config = await loadAdminIntegrationConfig();
  await logActivity(req, 'admin.settings.integrations.test_logs', 'app_integrations', 1, {
    ok: validation.ok,
    status: validation.status,
    backend: validation.config?.backend || candidateConfig.backend || null,
    host: validation.config?.host || candidateConfig.host || null,
    port: validation.config?.port || candidateConfig.port || null,
    hostLabel: validation.config?.hostLabel || candidateConfig.hostLabel || null,
    service: validation.config?.service || candidateConfig.service || null,
    debugEnabled: validation.config?.debugEnabled ?? candidateConfig.debugEnabled ?? null,
    readOnly: LOG_EXPORT_SETTINGS_READ_ONLY,
    mode: validation.mode
  });

  return res.json({
    ok: validation.ok,
    authenticated: validation.ok,
    status: validation.ok ? 200 : 502,
    provider: 'structured_logs',
    detail: validation.detail,
    validation,
    logExportControl: {
      readOnly: Boolean(LOG_EXPORT_SETTINGS_READ_ONLY),
      source: LOG_EXPORT_SETTINGS_READ_ONLY
        ? 'env_override'
        : (resolved.controlPlane?.source || 'env_fallback'),
      supportedBackends: resolved.controlPlane?.supportedBackends || [...LOG_EXPORT_BACKENDS],
      effective: resolved.controlPlane?.effective || {
        backend: resolved.backend,
        host: resolved.host,
        port: resolved.port,
        hostLabel: resolved.hostLabel,
        service: resolved.service,
        debugEnabled: resolved.debugEnabled
      },
      stored: resolved.controlPlane?.stored || null,
      lastValidation: normalizeLogExportValidationRecord({
        log_export_last_validation_status: validation.status,
        log_export_last_validation_message: validation.detail,
        log_export_last_validation_backend: validation.config?.backend || candidateConfig.backend || null,
        log_export_last_validation_host: validation.config?.host || candidateConfig.host || null,
        log_export_last_validation_port: validation.config?.port || candidateConfig.port || null,
        log_export_last_validated_at: now.toISOString()
      })
    },
    observabilityRuntime: await buildObservabilityRuntimeDiagnostics(),
    config: await buildPlatformIntegrationPayload(config)
  });
}));

module.exports = {
  sharedIntegrationsRouter: sharedRouter,
  platformIntegrationsRouter: platformRouter
};
