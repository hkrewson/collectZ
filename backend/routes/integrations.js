const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
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
const { resolvePlexPreset, fetchPlexSections, fetchPlexMediaProviders, fetchPlexNowPlayingSessions, fetchPlexImageAsset, normalizePlexWebhookEvent } = require('../services/plex');
const { resolveBooksPreset, searchBooksByTitle } = require('../services/books');
const { resolveAudioPreset, searchAudioByTitle } = require('../services/audio');
const { resolveGamesPreset, searchGamesByTitle } = require('../services/games');
const { resolveComicsPreset, searchComicsByTitle, fetchMetronCollectionIssues } = require('../services/comics');
const { normalizeKavitaBaseUrl, testKavitaConnection } = require('../services/kavita');
const { logActivity, logError } = require('../services/audit');
const { DECRYPT_REMEDIATION } = require('../services/integrationResponse');
const { resolveScopeContext } = require('../db/scopeContext');
const { getRequestOrigin } = require('../services/requestOrigin');

const sharedRouter = express.Router();
const platformRouter = express.Router();
const HOMELAB_EDITION = isHomelabEdition();
const NOW_PLAYING_DISPLAY_TOKEN_PREFIX = 'cznp_';
const PLEX_WEBHOOK_RECEIVER_TOKEN_PREFIX = 'czpw_';
const NOW_PLAYING_TEXT_SCALES = new Set(['compact', 'standard', 'large']);
const NOW_PLAYING_LAYOUT_MODES = new Set(['standard', 'poster_only']);
const DEFAULT_NOW_PLAYING_DISPLAY_PREFERENCES = Object.freeze({
  layoutMode: 'standard',
  showPoster: true,
  showBackdrop: true,
  showContext: true,
  showPlayer: true,
  showProgress: true,
  showUpdatedAt: true,
  showPausedSessions: true,
  textScale: 'standard'
});

function normalizeNowPlayingDisplayPreferences(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const normalized = { ...DEFAULT_NOW_PLAYING_DISPLAY_PREFERENCES };
  const layoutMode = String(raw.layoutMode || '').trim().toLowerCase();
  if (NOW_PLAYING_LAYOUT_MODES.has(layoutMode)) normalized.layoutMode = layoutMode;
  for (const key of ['showPoster', 'showBackdrop', 'showContext', 'showPlayer', 'showProgress', 'showUpdatedAt', 'showPausedSessions']) {
    if (raw[key] !== undefined) normalized[key] = Boolean(raw[key]);
  }
  const textScale = String(raw.textScale || '').trim().toLowerCase();
  if (NOW_PLAYING_TEXT_SCALES.has(textScale)) normalized.textScale = textScale;
  return normalized;
}

function filterNowPlayingSessionsForPreferences(sessions, preferences) {
  const values = Array.isArray(sessions) ? sessions : [];
  if (preferences.showPausedSessions) return values;
  return values.filter((session) => String(session?.player?.state || '').toLowerCase() !== 'paused');
}

function generateNowPlayingDisplayToken() {
  return `${NOW_PLAYING_DISPLAY_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
}

function generatePlexWebhookReceiverToken() {
  return `${PLEX_WEBHOOK_RECEIVER_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
}

function hashNowPlayingDisplayToken(token) {
  const value = String(token || '').trim();
  if (!value) return '';
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashPlexWebhookReceiverToken(token) {
  const value = String(token || '').trim();
  if (!value) return '';
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqualHash(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function buildNowPlayingImagePath(key, { display = false } = {}) {
  const value = String(key || '').trim();
  if (!value) return null;
  const basePath = display ? '/api/plex/now-playing-display-image' : '/api/plex/now-playing-image';
  return `${basePath}?key=${encodeURIComponent(value)}`;
}

function shapeNowPlayingViewerSession(session, options = {}) {
  const posterKey = session?.thumbKey || session?.artKey || null;
  const backdropKey = session?.artKey || session?.thumbKey || null;
  return {
    sessionKey: session?.sessionKey || null,
    ratingKey: session?.ratingKey || null,
    title: session?.title || 'Unknown title',
    type: session?.type || null,
    grandparentTitle: session?.grandparentTitle || null,
    parentTitle: session?.parentTitle || null,
    year: session?.year || null,
    durationMs: session?.durationMs || null,
    viewOffsetMs: session?.viewOffsetMs || null,
    progressPercent: session?.progressPercent ?? null,
    player: session?.player || null,
    user: session?.user || null,
    hasQueueItem: Boolean(session?.hasQueueItem),
    posterImagePath: buildNowPlayingImagePath(posterKey, options),
    backdropImagePath: buildNowPlayingImagePath(backdropKey, options)
  };
}

function shapeNowPlayingDisplayTokenStatus(config) {
  return {
    enabled: Boolean(config?.plexNowPlayingDisplayTokenHash),
    createdAt: config?.plexNowPlayingDisplayTokenCreatedAt || null,
    lastUsedAt: config?.plexNowPlayingDisplayTokenLastUsedAt || null
  };
}

function buildPlexWebhookReceiverPath(token = null) {
  const suffix = token ? `/${encodeURIComponent(token)}` : '/[token]';
  return `/api/plex/webhooks${suffix}`;
}

function buildPlexWebhookReceiverUrl(req, token) {
  return `${getRequestOrigin(req)}${buildPlexWebhookReceiverPath(token)}`;
}

function shapePlexWebhookReceiverStatus(config, req = null) {
  return {
    enabled: Boolean(config?.plexWebhookReceiverTokenHash),
    createdAt: config?.plexWebhookReceiverTokenCreatedAt || null,
    lastRotatedAt: config?.plexWebhookReceiverTokenLastRotatedAt || null,
    lastReceivedAt: config?.plexWebhookReceiverLastReceivedAt || null,
    lastEvent: config?.plexWebhookReceiverLastEvent || null,
    receiverPath: buildPlexWebhookReceiverPath(),
    receiverUrlTemplate: req ? `${getRequestOrigin(req)}${buildPlexWebhookReceiverPath()}` : null,
    supportedEvents: ['library.new', 'media.scrobble', 'media.rate'],
    observedOnlyEvents: ['media.play', 'media.pause', 'media.resume', 'media.stop', 'playback.started'],
    processingMode: 'library_new_import_enqueue_only'
  };
}

async function loadConfigForNowPlayingDisplayToken(token, { touch = false } = {}) {
  const rawToken = String(token || '').trim();
  if (!rawToken || !rawToken.startsWith(NOW_PLAYING_DISPLAY_TOKEN_PREFIX)) return null;
  const config = await loadAdminIntegrationConfig();
  const expectedHash = config?.plexNowPlayingDisplayTokenHash || '';
  const actualHash = hashNowPlayingDisplayToken(rawToken);
  if (!safeEqualHash(actualHash, expectedHash)) return null;
  if (touch) {
    await pool.query(
      `UPDATE app_integrations
          SET plex_now_playing_display_token_last_used_at = NOW()
        WHERE id = 1
          AND plex_now_playing_display_token_hash = $1`,
      [expectedHash]
    ).catch(() => {});
  }
  return config;
}

async function loadConfigForPlexWebhookReceiverToken(token) {
  const rawToken = String(token || '').trim();
  if (!rawToken || !rawToken.startsWith(PLEX_WEBHOOK_RECEIVER_TOKEN_PREFIX)) return null;
  const config = await loadAdminIntegrationConfig();
  const expectedHash = config?.plexWebhookReceiverTokenHash || '';
  const actualHash = hashPlexWebhookReceiverToken(rawToken);
  if (!safeEqualHash(actualHash, expectedHash)) return null;
  return config;
}

function shapePlexWebhookImportJob(job = null, { existing = false } = {}) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    existing: Boolean(existing),
    jobType: job.job_type,
    provider: job.provider,
    ratingKey: job.scope?.ratingKey || null,
    metadataReadbackPath: job.scope?.metadataReadbackPath || null,
    processingMode: job.scope?.processingMode || null,
    createdAt: job.created_at || null
  };
}

async function enqueuePlexWebhookImportHint(normalizedEvent) {
  if (!normalizedEvent || normalizedEvent.action !== 'sync_new_title_hint' || !normalizedEvent.ratingKey) {
    return { queued: false, reason: 'not_import_hint', job: null };
  }

  const existing = await pool.query(
    `SELECT id, job_type, provider, status, created_by, scope, progress, summary, error,
            started_at, finished_at, created_at, updated_at
       FROM sync_jobs
      WHERE job_type = 'plex_webhook_import_hint'
        AND provider = 'plex'
        AND status IN ('queued', 'running')
        AND scope->>'trigger' = 'plex_webhook'
        AND scope->>'event' = 'library.new'
        AND scope->>'ratingKey' = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [normalizedEvent.ratingKey]
  );
  if (existing.rows[0]) {
    return { queued: true, existing: true, job: existing.rows[0] };
  }

  const scope = {
    trigger: 'plex_webhook',
    event: normalizedEvent.event,
    action: normalizedEvent.action,
    ratingKey: normalizedEvent.ratingKey,
    metadataReadbackPath: normalizedEvent.metadataReadbackPath,
    metadataTitle: normalizedEvent.metadata?.title || null,
    metadataType: normalizedEvent.metadata?.type || null,
    librarySectionId: normalizedEvent.metadata?.librarySectionId || null,
    processingMode: 'queued_import_hint',
    importMode: 'single_rating_key'
  };
  const progress = {
    total: 1,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errorCount: 0
  };
  const summary = {
    queuedFromWebhook: true,
    event: normalizedEvent.event,
    action: normalizedEvent.action,
    ratingKey: normalizedEvent.ratingKey,
    metadataReadbackPath: normalizedEvent.metadataReadbackPath,
    processingMode: 'queued_import_hint',
    processor: 'pending_future_slice'
  };
  const result = await pool.query(
    `INSERT INTO sync_jobs (job_type, provider, status, created_by, scope, progress, summary)
     VALUES ('plex_webhook_import_hint', 'plex', 'queued', NULL, $1::jsonb, $2::jsonb, $3::jsonb)
     RETURNING id, job_type, provider, status, created_by, scope, progress, summary, error,
               started_at, finished_at, created_at, updated_at`,
    [JSON.stringify(scope), JSON.stringify(progress), JSON.stringify(summary)]
  );
  return { queued: true, existing: false, job: result.rows[0] || null };
}

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
    plexNowPlayingDisplayToken: shapeNowPlayingDisplayTokenStatus(config),
    plexNowPlayingDisplayPreferences: normalizeNowPlayingDisplayPreferences(config?.plexNowPlayingDisplayPreferences),
    plexWebhookReceiver: shapePlexWebhookReceiverStatus(config),
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

sharedRouter.get('/plex/now-playing-viewer', authenticateToken, requireRole('admin'), asyncHandler(async (_req, res) => {
  const config = await loadAdminIntegrationConfig();
  if (!config.plexApiUrl) {
    return res.status(400).json({ ok: false, authenticated: false, detail: 'Plex API URL is not configured' });
  }
  if (!config.plexApiKey) {
    return res.status(400).json({ ok: false, authenticated: false, detail: 'Plex API key is not configured' });
  }

  const sessions = await fetchPlexNowPlayingSessions(config);
  const displayPreferences = normalizeNowPlayingDisplayPreferences(config.plexNowPlayingDisplayPreferences);
  const visibleSessions = filterNowPlayingSessionsForPreferences(sessions, displayPreferences);
  return res.json({
    ok: true,
    path: '/status/sessions',
    sessionCount: visibleSessions.length,
    generatedAt: new Date().toISOString(),
    displayPreferences,
    sessions: visibleSessions.map(shapeNowPlayingViewerSession)
  });
}));

sharedRouter.get('/plex/now-playing-display', asyncHandler(async (req, res) => {
  const config = await loadConfigForNowPlayingDisplayToken(req.query.token, { touch: true });
  if (!config) {
    return res.status(401).json({ ok: false, error: 'Invalid or revoked Now Playing display token' });
  }
  if (!config.plexApiUrl) {
    return res.status(400).json({ ok: false, authenticated: false, detail: 'Plex API URL is not configured' });
  }
  if (!config.plexApiKey) {
    return res.status(400).json({ ok: false, authenticated: false, detail: 'Plex API key is not configured' });
  }

  const sessions = await fetchPlexNowPlayingSessions(config);
  const displayPreferences = normalizeNowPlayingDisplayPreferences(config.plexNowPlayingDisplayPreferences);
  const visibleSessions = filterNowPlayingSessionsForPreferences(sessions, displayPreferences);
  return res.json({
    ok: true,
    path: '/status/sessions',
    access: 'display_token',
    sessionCount: visibleSessions.length,
    generatedAt: new Date().toISOString(),
    displayPreferences,
    sessions: visibleSessions.map((session) => shapeNowPlayingViewerSession(session, { display: true }))
  });
}));

sharedRouter.get('/plex/now-playing-image', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const key = String(req.query.key || '').trim();
  const config = await loadAdminIntegrationConfig();
  if (!config.plexApiUrl || !config.plexApiKey) {
    return res.status(404).json({ error: 'Plex image settings were not found' });
  }
  const image = await fetchPlexImageAsset(config, key);
  res.setHeader('Content-Type', image.contentType);
  res.setHeader('Cache-Control', 'private, max-age=60');
  return res.send(image.body);
}));

sharedRouter.get('/plex/now-playing-display-image', asyncHandler(async (req, res) => {
  const key = String(req.query.key || '').trim();
  const config = await loadConfigForNowPlayingDisplayToken(req.query.token, { touch: true });
  if (!config || !config.plexApiUrl || !config.plexApiKey) {
    return res.status(404).json({ error: 'Plex image settings were not found' });
  }
  const image = await fetchPlexImageAsset(config, key);
  res.setHeader('Content-Type', image.contentType);
  res.setHeader('Cache-Control', 'private, max-age=60');
  return res.send(image.body);
}));

sharedRouter.post('/plex/webhooks/:token', asyncHandler(async (req, res) => {
  const config = await loadConfigForPlexWebhookReceiverToken(req.params.token);
  if (!config) {
    return res.status(401).json({ ok: false, error: 'Invalid or revoked Plex webhook receiver token' });
  }

  const normalizedEvent = normalizePlexWebhookEvent(req.body || {});
  if (!normalizedEvent) {
    return res.status(400).json({ ok: false, error: 'Plex webhook payload was not recognized' });
  }

  await pool.query(
    `UPDATE app_integrations
        SET plex_webhook_receiver_last_received_at = NOW(),
            plex_webhook_receiver_last_event = $1
      WHERE id = 1
        AND plex_webhook_receiver_token_hash = $2`,
    [normalizedEvent.event, config.plexWebhookReceiverTokenHash]
  );
  const importEnqueue = await enqueuePlexWebhookImportHint(normalizedEvent);
  if (importEnqueue.queued && importEnqueue.job && !importEnqueue.existing) {
    await logActivity({
      user: null,
      headers: req.headers,
      ip: req.ip,
      socket: req.socket
    }, 'plex.webhook.import_hint.queued', 'sync_jobs', importEnqueue.job.id, {
      event: normalizedEvent.event,
      action: normalizedEvent.action,
      ratingKey: normalizedEvent.ratingKey,
      metadataReadbackPath: normalizedEvent.metadataReadbackPath,
      jobId: importEnqueue.job.id
    });
  }

  return res.json({
    ok: true,
    accepted: true,
    processingMode: importEnqueue.queued ? 'import_enqueue_hint' : 'read_only',
    event: normalizedEvent.event,
    supported: normalizedEvent.supported,
    action: normalizedEvent.action,
    ratingKey: normalizedEvent.ratingKey,
    metadataReadbackPath: normalizedEvent.metadataReadbackPath,
    importEnqueue: {
      queued: Boolean(importEnqueue.queued),
      reason: importEnqueue.reason || null,
      job: shapePlexWebhookImportJob(importEnqueue.job, { existing: importEnqueue.existing })
    },
    normalizedEvent
  });
}));

// ── Integration settings (admin only) ─────────────────────────────────────────

sharedRouter.get('/admin/settings/integrations', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const config = await loadAdminIntegrationConfig();
  res.json(await (HOMELAB_EDITION ? buildHomelabIntegrationPayload(config) : buildPlatformIntegrationPayload(config)));
}));

sharedRouter.post('/admin/settings/integrations/plex-now-playing-display-token', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const token = generateNowPlayingDisplayToken();
  const tokenHash = hashNowPlayingDisplayToken(token);
  const result = await pool.query(
    `INSERT INTO app_integrations (
       id,
       plex_now_playing_display_token_hash,
       plex_now_playing_display_token_created_at,
       plex_now_playing_display_token_last_used_at
     ) VALUES (1, $1, NOW(), NULL)
     ON CONFLICT (id) DO UPDATE SET
       plex_now_playing_display_token_hash = EXCLUDED.plex_now_playing_display_token_hash,
       plex_now_playing_display_token_created_at = EXCLUDED.plex_now_playing_display_token_created_at,
       plex_now_playing_display_token_last_used_at = NULL
     RETURNING plex_now_playing_display_token_created_at`,
    [tokenHash]
  );
  await logActivity(req, 'admin.settings.integrations.plex_now_playing_display_token.generate', 'app_integrations', 1, {
    tokenCreated: true
  });
  return res.json({
    ok: true,
    token,
    displayPath: `/now-playing?token=${encodeURIComponent(token)}`,
    displayApiPath: '/api/plex/now-playing-display',
    plexNowPlayingDisplayToken: {
      enabled: true,
      createdAt: result.rows[0]?.plex_now_playing_display_token_created_at || null,
      lastUsedAt: null
    }
  });
}));

sharedRouter.delete('/admin/settings/integrations/plex-now-playing-display-token', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  await pool.query(
    `UPDATE app_integrations
        SET plex_now_playing_display_token_hash = NULL,
            plex_now_playing_display_token_created_at = NULL,
            plex_now_playing_display_token_last_used_at = NULL
      WHERE id = 1`
  );
  await logActivity(req, 'admin.settings.integrations.plex_now_playing_display_token.revoke', 'app_integrations', 1, {
    tokenRevoked: true
  });
  return res.json({
    ok: true,
    plexNowPlayingDisplayToken: {
      enabled: false,
      createdAt: null,
      lastUsedAt: null
    }
  });
}));

sharedRouter.post('/admin/settings/integrations/plex-webhook-receiver-token', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const token = generatePlexWebhookReceiverToken();
  const tokenHash = hashPlexWebhookReceiverToken(token);
  const result = await pool.query(
    `INSERT INTO app_integrations (
       id,
       plex_webhook_receiver_token_hash,
       plex_webhook_receiver_token_created_at,
       plex_webhook_receiver_token_last_rotated_at,
       plex_webhook_receiver_last_received_at,
       plex_webhook_receiver_last_event
     ) VALUES (1, $1, NOW(), NOW(), NULL, NULL)
     ON CONFLICT (id) DO UPDATE SET
       plex_webhook_receiver_token_hash = EXCLUDED.plex_webhook_receiver_token_hash,
       plex_webhook_receiver_token_created_at = COALESCE(app_integrations.plex_webhook_receiver_token_created_at, EXCLUDED.plex_webhook_receiver_token_created_at),
       plex_webhook_receiver_token_last_rotated_at = EXCLUDED.plex_webhook_receiver_token_last_rotated_at,
       plex_webhook_receiver_last_received_at = NULL,
       plex_webhook_receiver_last_event = NULL
     RETURNING *`,
    [tokenHash]
  );
  const config = normalizeIntegrationRecord(result.rows[0]);
  await logActivity(req, 'admin.settings.integrations.plex_webhook_receiver_token.generate', 'app_integrations', 1, {
    tokenCreated: true
  });
  return res.json({
    ok: true,
    token,
    webhookPath: buildPlexWebhookReceiverPath(token),
    webhookUrl: buildPlexWebhookReceiverUrl(req, token),
    plexWebhookReceiver: shapePlexWebhookReceiverStatus(config, req)
  });
}));

sharedRouter.delete('/admin/settings/integrations/plex-webhook-receiver-token', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  await pool.query(
    `UPDATE app_integrations
        SET plex_webhook_receiver_token_hash = NULL,
            plex_webhook_receiver_token_created_at = NULL,
            plex_webhook_receiver_token_last_rotated_at = NULL,
            plex_webhook_receiver_last_received_at = NULL,
            plex_webhook_receiver_last_event = NULL
      WHERE id = 1`
  );
  await logActivity(req, 'admin.settings.integrations.plex_webhook_receiver_token.revoke', 'app_integrations', 1, {
    tokenRevoked: true
  });
  return res.json({
    ok: true,
    plexWebhookReceiver: shapePlexWebhookReceiverStatus(null, req)
  });
}));

sharedRouter.put('/admin/settings/integrations/plex-now-playing-display-preferences', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const preferences = normalizeNowPlayingDisplayPreferences(req.body?.preferences || req.body || {});
  await pool.query(
    `INSERT INTO app_integrations (
       id,
       plex_now_playing_display_preferences
     ) VALUES (1, $1::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       plex_now_playing_display_preferences = EXCLUDED.plex_now_playing_display_preferences`,
    [JSON.stringify(preferences)]
  );
  await logActivity(req, 'admin.settings.integrations.plex_now_playing_display_preferences.update', 'app_integrations', 1, {
    preferences
  });
  return res.json({
    ok: true,
    plexNowPlayingDisplayPreferences: preferences
  });
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

sharedRouter.post('/admin/settings/integrations/test-plex-providers', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const config = await loadAdminIntegrationConfig();
  if (!config.plexApiUrl) {
    return res.status(400).json({ ok: false, authenticated: false, detail: 'Plex API URL is not configured' });
  }
  if (!config.plexApiKey) {
    return res.status(400).json({ ok: false, authenticated: false, detail: 'Plex API key is not configured' });
  }

  try {
    const providers = await fetchPlexMediaProviders(config);
    res.json({
      ok: true,
      authenticated: true,
      status: 200,
      provider: config.plexProvider || 'plex',
      path: '/media/providers',
      providerCount: providers.length,
      detail: `Connected. Found ${providers.length} Plex media provider(s).`,
      providers
    });
  } catch (error) {
    logError('Test Plex provider discovery', error);
    const status = error.response?.status || 502;
    res.json({
      ok: false,
      authenticated: status !== 401 && status !== 403,
      status,
      provider: config.plexProvider || 'plex',
      path: '/media/providers',
      detail: error.message
    });
  }
}));

sharedRouter.post('/admin/settings/integrations/test-plex-now-playing', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const config = await loadAdminIntegrationConfig();
  if (!config.plexApiUrl) {
    return res.status(400).json({ ok: false, authenticated: false, detail: 'Plex API URL is not configured' });
  }
  if (!config.plexApiKey) {
    return res.status(400).json({ ok: false, authenticated: false, detail: 'Plex API key is not configured' });
  }

  try {
    const sessions = await fetchPlexNowPlayingSessions(config);
    res.json({
      ok: true,
      authenticated: true,
      status: 200,
      provider: config.plexProvider || 'plex',
      path: '/status/sessions',
      sessionCount: sessions.length,
      detail: `Connected. Found ${sessions.length} active Plex session(s).`,
      sessions
    });
  } catch (error) {
    logError('Test Plex now playing readback', error);
    const status = error.response?.status || 502;
    res.json({
      ok: false,
      authenticated: status !== 401 && status !== 403,
      status,
      provider: config.plexProvider || 'plex',
      path: '/status/sessions',
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
