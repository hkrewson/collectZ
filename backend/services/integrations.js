const pool = require('../db/pool');
const { decryptSecretWithStatus } = require('./crypto');
const { resolveBarcodePreset } = require('./barcode');
const { resolveTmdbPreset } = require('./tmdb');
const { resolvePlexPreset } = require('./plex');
const { resolveBooksPreset } = require('./books');
const { resolveAudioPreset } = require('./audio');
const { resolveGamesPreset } = require('./games');
const { resolveComicsPreset } = require('./comics');
const { normalizeVisionPreset } = require('./captureImageOcr');
const { normalizeKavitaBaseUrl } = require('./kavita');
const {
  DEFAULT_PRICECHARTING_API_URL,
  DEFAULT_EBAY_BROWSE_API_URL,
  DEFAULT_EBAY_MARKETPLACE_ID,
  MIN_PRICECHARTING_INTERVAL_MS,
  normalizePositiveInteger
} = require('./valuations');

const DEFAULT_PLEX_RECONCILIATION_SYNC_SETTINGS = Object.freeze({
  enabled: false,
  intervalMinutes: 360,
  limit: null,
  source: 'stored'
});

const DEFAULT_PLEX_WRITEBACK_SETTINGS = Object.freeze({
  ratingEnabled: false,
  watchStateEnabled: false,
  source: 'stored'
});

function normalizePlexReconciliationSyncSettings(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const parsedInterval = Number(raw.intervalMinutes ?? raw.interval_minutes ?? raw.plexReconciliationSyncIntervalMinutes);
  const intervalMinutes = Number.isInteger(parsedInterval) && parsedInterval >= 60
    ? Math.min(10080, parsedInterval)
    : DEFAULT_PLEX_RECONCILIATION_SYNC_SETTINGS.intervalMinutes;
  const rawLimit = raw.limit ?? raw.plexReconciliationSyncLimit;
  const parsedLimit = rawLimit === null || rawLimit === undefined || rawLimit === ''
    ? null
    : Number(rawLimit);
  const limit = Number.isInteger(parsedLimit) && parsedLimit > 0
    ? Math.min(50000, parsedLimit)
    : null;
  return {
    enabled: Boolean(raw.enabled ?? raw.plexReconciliationSyncEnabled),
    intervalMinutes,
    limit,
    source: raw.source || 'stored'
  };
}

function normalizePlexWritebackSettings(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    ratingEnabled: Boolean(raw.ratingEnabled ?? raw.plexRatingWritebackEnabled),
    watchStateEnabled: Boolean(raw.watchStateEnabled ?? raw.plexWatchStateWritebackEnabled),
    source: raw.source || DEFAULT_PLEX_WRITEBACK_SETTINGS.source
  };
}

function deriveCwaBaseUrl(rawUrl = '') {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  try {
    return new URL(value).origin;
  } catch (_) {
    return '';
  }
}

function hostnameMatches(rawUrl = '', expectedHostname = '') {
  const expected = String(expectedHostname || '').trim().toLowerCase();
  if (!expected) return false;
  try {
    const hostname = new URL(String(rawUrl || '').trim()).hostname.toLowerCase();
    return hostname === expected || hostname.endsWith(`.${expected}`);
  } catch (_) {
    return false;
  }
}

const normalizeIntegrationRecord = (row) => {
  const envBarcodePreset = process.env.BARCODE_PRESET || process.env.BARCODE_PROVIDER || 'upcitemdb';
  const envTmdbPreset = process.env.TMDB_PRESET || 'tmdb';
  const envPlexPreset = process.env.PLEX_PRESET || process.env.PLEX_PROVIDER || 'plex';
  const envBooksPreset = process.env.BOOKS_PRESET || process.env.BOOKS_PROVIDER || 'googlebooks';
  const envAudioPreset = process.env.AUDIO_PRESET || process.env.AUDIO_PROVIDER || 'discogs';
  const envGamesPreset = process.env.GAMES_PRESET || process.env.GAMES_PROVIDER || 'igdb';
  const envComicsPreset = process.env.COMICS_PRESET || process.env.COMICS_PROVIDER || 'metron';
  const envVisionPreset = process.env.VISION_PRESET || process.env.VISION_PROVIDER || 'ocrspace';

  const barcodePreset = resolveBarcodePreset(row?.barcode_preset || envBarcodePreset);
  const tmdbPreset = resolveTmdbPreset(row?.tmdb_preset || envTmdbPreset);
  const plexPreset = resolvePlexPreset(row?.plex_preset || envPlexPreset);
  const booksPreset = resolveBooksPreset(row?.books_preset || envBooksPreset);
  const audioPreset = resolveAudioPreset(row?.audio_preset || envAudioPreset);
  const gamesPreset = resolveGamesPreset(row?.games_preset || envGamesPreset);
  const comicsPreset = resolveComicsPreset(row?.comics_preset || envComicsPreset);
  const visionPreset = normalizeVisionPreset(row?.vision_preset || envVisionPreset);

  const barcodeDecrypt = decryptSecretWithStatus(row?.barcode_api_key_encrypted, 'barcode_api_key_encrypted');
  const tmdbDecrypt = decryptSecretWithStatus(row?.tmdb_api_key_encrypted, 'tmdb_api_key_encrypted');
  const plexDecrypt = decryptSecretWithStatus(row?.plex_api_key_encrypted, 'plex_api_key_encrypted');
  const booksDecrypt = decryptSecretWithStatus(row?.books_api_key_encrypted, 'books_api_key_encrypted');
  const audioDecrypt = decryptSecretWithStatus(row?.audio_api_key_encrypted, 'audio_api_key_encrypted');
  const gamesDecrypt = decryptSecretWithStatus(row?.games_api_key_encrypted, 'games_api_key_encrypted');
  const gamesClientSecretDecrypt = decryptSecretWithStatus(row?.games_client_secret_encrypted, 'games_client_secret_encrypted');
  const comicsDecrypt = decryptSecretWithStatus(row?.comics_api_key_encrypted, 'comics_api_key_encrypted');
  const visionDecrypt = decryptSecretWithStatus(row?.vision_api_key_encrypted, 'vision_api_key_encrypted');
  const cwaPasswordDecrypt = decryptSecretWithStatus(row?.cwa_password_encrypted, 'cwa_password_encrypted');
  const kavitaApiKeyDecrypt = decryptSecretWithStatus(row?.kavita_api_key_encrypted, 'kavita_api_key_encrypted');
  const priceChartingDecrypt = decryptSecretWithStatus(row?.pricecharting_api_key_encrypted, 'pricecharting_api_key_encrypted');
  const ebayClientSecretDecrypt = decryptSecretWithStatus(row?.ebay_browse_client_secret_encrypted, 'ebay_browse_client_secret_encrypted');

  const barcodeApiKey = barcodeDecrypt.value || process.env.BARCODE_API_KEY || '';
  const tmdbApiKey = tmdbDecrypt.value || process.env.TMDB_API_KEY || '';
  const plexApiKey = plexDecrypt.value || process.env.PLEX_API_KEY || '';
  const booksApiKey = booksDecrypt.value || process.env.BOOKS_API_KEY || '';
  const audioApiKey = audioDecrypt.value || process.env.AUDIO_API_KEY || '';
  const gamesApiKey = gamesDecrypt.value || process.env.GAMES_API_KEY || '';
  const gamesClientSecret = gamesClientSecretDecrypt.value || process.env.GAMES_CLIENT_SECRET || '';
  const comicsApiKey = comicsDecrypt.value || process.env.COMICS_API_KEY || '';
  const visionApiKey = visionDecrypt.value || process.env.VISION_API_KEY || '';
  const cwaPassword = cwaPasswordDecrypt.value || process.env.CWA_PASSWORD || process.env.CWA_TOKEN || '';
  const kavitaApiKey = kavitaApiKeyDecrypt.value || process.env.KAVITA_API_KEY || process.env.KAVITA_TOKEN || '';
  const priceChartingApiKey = priceChartingDecrypt.value || process.env.PRICECHARTING_API_KEY || '';
  const eBayBrowseClientSecret = ebayClientSecretDecrypt.value || process.env.EBAY_BROWSE_CLIENT_SECRET || '';
  const cwaOpdsUrl = row?.cwa_opds_url || process.env.CWA_OPDS_URL || '';
  const resolvedCwaBaseUrl = deriveCwaBaseUrl(cwaOpdsUrl);
  const kavitaBaseUrl = normalizeKavitaBaseUrl(row?.kavita_base_url || process.env.KAVITA_BASE_URL || process.env.KAVITA_URL || '');

  const decryptWarnings = [];
  const maybeWarn = (provider, field, encryptedValue, decryptResult) => {
    if (!encryptedValue || !decryptResult?.error) return;
    decryptWarnings.push({
      provider,
      field,
      code: 'decrypt_failed',
      message: decryptResult.error
    });
  };
  maybeWarn('barcode', 'barcode_api_key_encrypted', row?.barcode_api_key_encrypted, barcodeDecrypt);
  maybeWarn('tmdb', 'tmdb_api_key_encrypted', row?.tmdb_api_key_encrypted, tmdbDecrypt);
  maybeWarn('plex', 'plex_api_key_encrypted', row?.plex_api_key_encrypted, plexDecrypt);
  maybeWarn('books', 'books_api_key_encrypted', row?.books_api_key_encrypted, booksDecrypt);
  maybeWarn('audio', 'audio_api_key_encrypted', row?.audio_api_key_encrypted, audioDecrypt);
  maybeWarn('games', 'games_api_key_encrypted', row?.games_api_key_encrypted, gamesDecrypt);
  maybeWarn('games', 'games_client_secret_encrypted', row?.games_client_secret_encrypted, gamesClientSecretDecrypt);
  maybeWarn('comics', 'comics_api_key_encrypted', row?.comics_api_key_encrypted, comicsDecrypt);
  maybeWarn('vision', 'vision_api_key_encrypted', row?.vision_api_key_encrypted, visionDecrypt);
  maybeWarn('cwa', 'cwa_password_encrypted', row?.cwa_password_encrypted, cwaPasswordDecrypt);
  maybeWarn('kavita', 'kavita_api_key_encrypted', row?.kavita_api_key_encrypted, kavitaApiKeyDecrypt);
  maybeWarn('pricecharting', 'pricecharting_api_key_encrypted', row?.pricecharting_api_key_encrypted, priceChartingDecrypt);
  maybeWarn('ebay_browse', 'ebay_browse_client_secret_encrypted', row?.ebay_browse_client_secret_encrypted, ebayClientSecretDecrypt);

  const legacyAudioUrl = row?.audio_api_url || '';
  const resolvedAudioProviderRaw = row?.audio_provider || audioPreset.provider;
  const resolvedAudioProvider = resolvedAudioProviderRaw === 'theaudiodb'
    ? 'discogs'
    : resolvedAudioProviderRaw;
  const resolvedAudioPreset = (row?.audio_preset || envAudioPreset) === 'theaudiodb'
    ? 'discogs'
    : (row?.audio_preset || envAudioPreset);
  const resolvedAudioApiUrl = hostnameMatches(legacyAudioUrl, 'theaudiodb.com')
    ? (audioPreset.apiUrl || process.env.AUDIO_API_URL || '')
    : (row?.audio_api_url || audioPreset.apiUrl || process.env.AUDIO_API_URL || '');

  return {
    barcodePreset: barcodePreset.preset || 'upcitemdb',
    barcodeProvider: barcodePreset.provider,
    barcodeApiUrl: row?.barcode_api_url || barcodePreset.apiUrl || process.env.BARCODE_API_URL || '',
    barcodeApiKeyHeader: barcodePreset.apiKeyHeader || 'x-api-key',
    barcodeQueryParam: barcodePreset.queryParam || 'upc',
    barcodeApiKey,
    visionPreset: visionPreset.preset || 'ocrspace',
    visionProvider: row?.vision_provider || visionPreset.provider,
    visionApiUrl: row?.vision_api_url || visionPreset.apiUrl || process.env.VISION_API_URL || '',
    visionApiKeyHeader: row?.vision_api_key_header || visionPreset.apiKeyHeader || process.env.VISION_API_KEY_HEADER || 'apikey',
    visionApiKey,
    tmdbPreset: tmdbPreset.preset || 'tmdb',
    tmdbProvider: tmdbPreset.provider,
    tmdbApiUrl: row?.tmdb_api_url || tmdbPreset.apiUrl || process.env.TMDB_API_URL || 'https://api.themoviedb.org/3/search/movie',
    tmdbApiKeyHeader: tmdbPreset.apiKeyHeader || '',
    tmdbApiKeyQueryParam: tmdbPreset.apiKeyQueryParam || 'api_key',
    tmdbApiKey,
    plexPreset: plexPreset.preset || 'plex',
    plexProvider: plexPreset.provider,
    plexApiUrl: row?.plex_api_url || plexPreset.apiUrl || process.env.PLEX_API_URL || '',
    plexApiKeyQueryParam: plexPreset.apiKeyQueryParam || 'X-Plex-Token',
    plexApiKey,
    plexLibrarySections: Array.isArray(row?.plex_library_sections)
      ? row.plex_library_sections
      : [],
    plexReconciliationSyncSettings: normalizePlexReconciliationSyncSettings({
      enabled: row?.plex_reconciliation_sync_enabled,
      intervalMinutes: row?.plex_reconciliation_sync_interval_minutes,
      limit: row?.plex_reconciliation_sync_limit,
      source: 'stored'
    }),
    plexWritebackSettings: normalizePlexWritebackSettings({
      ratingEnabled: row?.plex_rating_writeback_enabled,
      watchStateEnabled: row?.plex_watch_state_writeback_enabled,
      source: 'stored'
    }),
    booksPreset: booksPreset.preset || 'googlebooks',
    booksProvider: booksPreset.provider,
    booksApiUrl: row?.books_api_url || booksPreset.apiUrl || process.env.BOOKS_API_URL || '',
    booksApiKeyHeader: booksPreset.apiKeyHeader || '',
    booksApiKeyQueryParam: booksPreset.apiKeyQueryParam || 'key',
    booksApiKey,
    audioPreset: audioPreset.preset || resolvedAudioPreset,
    audioProvider: resolvedAudioProvider,
    audioApiUrl: resolvedAudioApiUrl,
    audioApiKeyHeader: audioPreset.apiKeyHeader || '',
    audioApiKeyQueryParam: audioPreset.apiKeyQueryParam || 'api_key',
    audioApiKey,
    gamesPreset: gamesPreset.preset || 'igdb',
    gamesProvider: gamesPreset.provider,
    gamesApiUrl: row?.games_api_url || gamesPreset.apiUrl || process.env.GAMES_API_URL || '',
    gamesApiKeyHeader: gamesPreset.apiKeyHeader || 'Authorization',
    gamesApiKeyQueryParam: gamesPreset.apiKeyQueryParam || 'api_key',
    gamesClientId: row?.games_client_id || process.env.GAMES_CLIENT_ID || '',
    gamesClientSecret,
    gamesApiKey,
    comicsPreset: comicsPreset.preset || 'metron',
    comicsProvider: comicsPreset.provider,
    comicsApiUrl: row?.comics_api_url || comicsPreset.apiUrl || process.env.COMICS_API_URL || '',
    comicsApiKeyHeader: comicsPreset.apiKeyHeader || '',
    comicsApiKeyQueryParam: comicsPreset.apiKeyQueryParam || 'api_key',
    comicsUsername: row?.comics_username || process.env.COMICS_USERNAME || '',
    comicsApiKey,
    priceChartingEnabled: row?.pricecharting_enabled === undefined || row?.pricecharting_enabled === null
      ? Boolean(process.env.PRICECHARTING_API_KEY)
      : Boolean(row?.pricecharting_enabled),
    priceChartingApiUrl: row?.pricecharting_api_url || process.env.PRICECHARTING_API_URL || DEFAULT_PRICECHARTING_API_URL,
    priceChartingApiKey,
    priceChartingRateLimitMs: Math.max(
      MIN_PRICECHARTING_INTERVAL_MS,
      normalizePositiveInteger(
        row?.pricecharting_rate_limit_ms || process.env.PRICECHARTING_RATE_LIMIT_MS,
        MIN_PRICECHARTING_INTERVAL_MS
      )
    ),
    eBayBrowseEnabled: row?.ebay_browse_enabled === undefined || row?.ebay_browse_enabled === null
      ? Boolean(process.env.EBAY_BROWSE_CLIENT_ID && (process.env.EBAY_BROWSE_CLIENT_SECRET || process.env.EBAY_BROWSE_TOKEN))
      : Boolean(row?.ebay_browse_enabled),
    eBayBrowseApiUrl: row?.ebay_browse_api_url || process.env.EBAY_BROWSE_API_URL || DEFAULT_EBAY_BROWSE_API_URL,
    eBayBrowseClientId: row?.ebay_browse_client_id || process.env.EBAY_BROWSE_CLIENT_ID || '',
    eBayBrowseClientSecret,
    eBayBrowseMarketplaceId: row?.ebay_browse_marketplace_id || process.env.EBAY_BROWSE_MARKETPLACE_ID || DEFAULT_EBAY_MARKETPLACE_ID,
    cwaOpdsUrl,
    cwaBaseUrl: resolvedCwaBaseUrl,
    cwaUsername: row?.cwa_username || process.env.CWA_USERNAME || '',
    cwaPassword,
    cwaTimeoutMs: 20000,
    kavitaBaseUrl,
    kavitaApiKey,
    kavitaTimeoutMs: Math.max(1000, normalizePositiveInteger(row?.kavita_timeout_ms || process.env.KAVITA_TIMEOUT_MS, 20000)),
    plexNowPlayingDisplayTokenHash: row?.plex_now_playing_display_token_hash || '',
    plexNowPlayingDisplayTokenCreatedAt: row?.plex_now_playing_display_token_created_at || null,
    plexNowPlayingDisplayTokenLastUsedAt: row?.plex_now_playing_display_token_last_used_at || null,
    plexNowPlayingDisplayPreferences: row?.plex_now_playing_display_preferences || {},
    plexWebhookReceiverTokenHash: row?.plex_webhook_receiver_token_hash || '',
    plexWebhookReceiverTokenCreatedAt: row?.plex_webhook_receiver_token_created_at || null,
    plexWebhookReceiverTokenLastRotatedAt: row?.plex_webhook_receiver_token_last_rotated_at || null,
    plexWebhookReceiverLastReceivedAt: row?.plex_webhook_receiver_last_received_at || null,
    plexWebhookReceiverLastEvent: row?.plex_webhook_receiver_last_event || null,
    plexWebhookReceiverLastValidationStatus: row?.plex_webhook_receiver_last_validation_status || null,
    plexWebhookReceiverLastValidationMessage: row?.plex_webhook_receiver_last_validation_message || null,
    plexWebhookReceiverLastValidatedAt: row?.plex_webhook_receiver_last_validated_at || null,
    logExportLastValidation: row?.log_export_last_validation_status
      ? {
        status: String(row.log_export_last_validation_status).trim().toLowerCase(),
        detail: String(row.log_export_last_validation_message || '').trim() || '',
        backend: row.log_export_last_validation_backend || null,
        host: row.log_export_last_validation_host || null,
        port: Number(row.log_export_last_validation_port || 0) || null,
        validatedAt: row.log_export_last_validated_at || null
      }
      : null,
    decryptWarnings
  };
};

async function loadIntegrationConfigRow(spaceId = null, { allowFallback = true } = {}) {
  const numericSpaceId = Number(spaceId || 0) || null;
  if (numericSpaceId) {
    const scoped = await pool.query(
      `SELECT *
         FROM app_integrations
        WHERE space_id = $1
        ORDER BY id ASC
        LIMIT 1`,
      [numericSpaceId]
    );
    if (scoped.rows[0]) return scoped.rows[0];
  }

  if (!allowFallback) return null;

  const fallback = await pool.query(
    `SELECT *
       FROM app_integrations
      WHERE id = 1
      LIMIT 1`
  );
  return fallback.rows[0] || null;
}

const loadAdminIntegrationConfig = async () => {
  const row = await loadIntegrationConfigRow(null, { allowFallback: true });
  return normalizeIntegrationRecord(row || null);
};

const loadScopedIntegrationConfig = async (spaceId) => {
  const row = await loadIntegrationConfigRow(spaceId, { allowFallback: false });
  return normalizeIntegrationRecord(row || null);
};

const loadWorkspaceKavitaIntegrationConfig = async (spaceId) => {
  const row = await loadIntegrationConfigRow(spaceId, { allowFallback: false });
  const normalized = normalizeIntegrationRecord(row || null);
  const kavitaDecrypt = decryptSecretWithStatus(row?.kavita_api_key_encrypted, 'kavita_api_key_encrypted');
  const decryptWarnings = (normalized.decryptWarnings || [])
    .filter((warning) => warning?.provider !== 'kavita');
  if (row?.kavita_api_key_encrypted && kavitaDecrypt.error) {
    decryptWarnings.push({
      provider: 'kavita',
      field: 'kavita_api_key_encrypted',
      code: 'decrypt_failed',
      message: kavitaDecrypt.error
    });
  }
  return {
    ...normalized,
    kavitaBaseUrl: normalizeKavitaBaseUrl(row?.kavita_base_url || ''),
    kavitaApiKey: kavitaDecrypt.value || '',
    kavitaTimeoutMs: Math.max(1000, normalizePositiveInteger(row?.kavita_timeout_ms, 20000)),
    decryptWarnings
  };
};

const loadGeneralSettings = async (spaceId = null) => {
  const result = await pool.query('SELECT * FROM app_settings WHERE id = 1');
  const row = result.rows[0] || {};
  const numericSpaceId = Number(spaceId || 0) || null;
  let scopedRow = null;
  if (numericSpaceId) {
    const scopedResult = await pool.query(
      `SELECT theme, density
         FROM spaces
        WHERE id = $1
        LIMIT 1`,
      [numericSpaceId]
    );
    scopedRow = scopedResult.rows[0] || null;
  }
  return {
    theme: scopedRow?.theme || row.theme || 'system',
    density: scopedRow?.density || row.density || 'comfortable'
  };
};

const updateScopedGeneralSettings = async ({ spaceId, theme, density }) => {
  const numericSpaceId = Number(spaceId || 0) || null;
  if (!numericSpaceId) {
    const error = new Error('space_id must be a positive integer');
    error.status = 400;
    throw error;
  }

  const existing = await pool.query(
    `SELECT theme, density
       FROM spaces
      WHERE id = $1
      LIMIT 1`,
    [numericSpaceId]
  );
  if (existing.rows.length === 0) {
    const error = new Error('Space not found');
    error.status = 404;
    throw error;
  }

  const current = existing.rows[0] || {};
  const result = await pool.query(
    `UPDATE spaces
        SET theme = $2,
            density = $3,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING theme, density`,
    [
      numericSpaceId,
      theme !== undefined ? theme : current.theme,
      density !== undefined ? density : current.density
    ]
  );
  return {
    theme: result.rows[0]?.theme || 'system',
    density: result.rows[0]?.density || 'comfortable'
  };
};

module.exports = {
  deriveCwaBaseUrl,
  normalizeIntegrationRecord,
  loadIntegrationConfigRow,
  loadAdminIntegrationConfig,
  loadScopedIntegrationConfig,
  loadWorkspaceKavitaIntegrationConfig,
  loadGeneralSettings,
  updateScopedGeneralSettings,
  normalizePlexReconciliationSyncSettings,
  normalizePlexWritebackSettings,
  DEFAULT_PLEX_RECONCILIATION_SYNC_SETTINGS,
  DEFAULT_PLEX_WRITEBACK_SETTINGS
};
