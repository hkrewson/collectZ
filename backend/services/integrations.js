const pool = require('../db/pool');
const { decryptSecretWithStatus } = require('./crypto');
const { resolveBarcodePreset } = require('./barcode');
const { resolveVisionPreset } = require('./vision');
const { resolveTmdbPreset } = require('./tmdb');
const { resolvePlexPreset } = require('./plex');
const { resolveBooksPreset } = require('./books');
const { resolveAudioPreset } = require('./audio');
const { resolveGamesPreset } = require('./games');
const { resolveComicsPreset } = require('./comics');

function deriveCwaBaseUrl(rawUrl = '') {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  try {
    return new URL(value).origin;
  } catch (_) {
    return '';
  }
}

const normalizeIntegrationRecord = (row) => {
  const envBarcodePreset = process.env.BARCODE_PRESET || process.env.BARCODE_PROVIDER || 'upcitemdb';
  const envVisionPreset = process.env.VISION_PRESET || process.env.VISION_PROVIDER || 'ocrspace';
  const envTmdbPreset = process.env.TMDB_PRESET || 'tmdb';
  const envPlexPreset = process.env.PLEX_PRESET || process.env.PLEX_PROVIDER || 'plex';
  const envBooksPreset = process.env.BOOKS_PRESET || process.env.BOOKS_PROVIDER || 'googlebooks';
  const envAudioPreset = process.env.AUDIO_PRESET || process.env.AUDIO_PROVIDER || 'discogs';
  const envGamesPreset = process.env.GAMES_PRESET || process.env.GAMES_PROVIDER || 'igdb';
  const envComicsPreset = process.env.COMICS_PRESET || process.env.COMICS_PROVIDER || 'metron';

  const barcodePreset = resolveBarcodePreset(row?.barcode_preset || envBarcodePreset);
  const visionPreset = resolveVisionPreset(row?.vision_preset || envVisionPreset);
  const tmdbPreset = resolveTmdbPreset(row?.tmdb_preset || envTmdbPreset);
  const plexPreset = resolvePlexPreset(row?.plex_preset || envPlexPreset);
  const booksPreset = resolveBooksPreset(row?.books_preset || envBooksPreset);
  const audioPreset = resolveAudioPreset(row?.audio_preset || envAudioPreset);
  const gamesPreset = resolveGamesPreset(row?.games_preset || envGamesPreset);
  const comicsPreset = resolveComicsPreset(row?.comics_preset || envComicsPreset);

  const barcodeDecrypt = decryptSecretWithStatus(row?.barcode_api_key_encrypted, 'barcode_api_key_encrypted');
  const visionDecrypt = decryptSecretWithStatus(row?.vision_api_key_encrypted, 'vision_api_key_encrypted');
  const tmdbDecrypt = decryptSecretWithStatus(row?.tmdb_api_key_encrypted, 'tmdb_api_key_encrypted');
  const plexDecrypt = decryptSecretWithStatus(row?.plex_api_key_encrypted, 'plex_api_key_encrypted');
  const booksDecrypt = decryptSecretWithStatus(row?.books_api_key_encrypted, 'books_api_key_encrypted');
  const audioDecrypt = decryptSecretWithStatus(row?.audio_api_key_encrypted, 'audio_api_key_encrypted');
  const gamesDecrypt = decryptSecretWithStatus(row?.games_api_key_encrypted, 'games_api_key_encrypted');
  const gamesClientSecretDecrypt = decryptSecretWithStatus(row?.games_client_secret_encrypted, 'games_client_secret_encrypted');
  const comicsDecrypt = decryptSecretWithStatus(row?.comics_api_key_encrypted, 'comics_api_key_encrypted');
  const cwaPasswordDecrypt = decryptSecretWithStatus(row?.cwa_password_encrypted, 'cwa_password_encrypted');

  const barcodeApiKey = barcodeDecrypt.value || process.env.BARCODE_API_KEY || '';
  const visionApiKey = visionDecrypt.value || process.env.VISION_API_KEY || '';
  const tmdbApiKey = tmdbDecrypt.value || process.env.TMDB_API_KEY || '';
  const plexApiKey = plexDecrypt.value || process.env.PLEX_API_KEY || '';
  const booksApiKey = booksDecrypt.value || process.env.BOOKS_API_KEY || '';
  const audioApiKey = audioDecrypt.value || process.env.AUDIO_API_KEY || '';
  const gamesApiKey = gamesDecrypt.value || process.env.GAMES_API_KEY || '';
  const gamesClientSecret = gamesClientSecretDecrypt.value || process.env.GAMES_CLIENT_SECRET || '';
  const comicsApiKey = comicsDecrypt.value || process.env.COMICS_API_KEY || '';
  const cwaPassword = cwaPasswordDecrypt.value || process.env.CWA_PASSWORD || process.env.CWA_TOKEN || '';
  const cwaOpdsUrl = row?.cwa_opds_url || process.env.CWA_OPDS_URL || '';
  const resolvedCwaBaseUrl = deriveCwaBaseUrl(cwaOpdsUrl);

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
  maybeWarn('vision', 'vision_api_key_encrypted', row?.vision_api_key_encrypted, visionDecrypt);
  maybeWarn('tmdb', 'tmdb_api_key_encrypted', row?.tmdb_api_key_encrypted, tmdbDecrypt);
  maybeWarn('plex', 'plex_api_key_encrypted', row?.plex_api_key_encrypted, plexDecrypt);
  maybeWarn('books', 'books_api_key_encrypted', row?.books_api_key_encrypted, booksDecrypt);
  maybeWarn('audio', 'audio_api_key_encrypted', row?.audio_api_key_encrypted, audioDecrypt);
  maybeWarn('games', 'games_api_key_encrypted', row?.games_api_key_encrypted, gamesDecrypt);
  maybeWarn('games', 'games_client_secret_encrypted', row?.games_client_secret_encrypted, gamesClientSecretDecrypt);
  maybeWarn('comics', 'comics_api_key_encrypted', row?.comics_api_key_encrypted, comicsDecrypt);
  maybeWarn('cwa', 'cwa_password_encrypted', row?.cwa_password_encrypted, cwaPasswordDecrypt);

  const legacyAudioUrl = row?.audio_api_url || '';
  const resolvedAudioProviderRaw = row?.audio_provider || audioPreset.provider;
  const resolvedAudioProvider = resolvedAudioProviderRaw === 'theaudiodb'
    ? 'discogs'
    : resolvedAudioProviderRaw;
  const resolvedAudioPreset = (row?.audio_preset || envAudioPreset) === 'theaudiodb'
    ? 'discogs'
    : (row?.audio_preset || envAudioPreset);
  const resolvedAudioApiUrl = legacyAudioUrl.includes('theaudiodb.com')
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
    visionProvider: visionPreset.provider,
    visionApiUrl: row?.vision_api_url || visionPreset.apiUrl || process.env.VISION_API_URL || '',
    visionApiKeyHeader: visionPreset.apiKeyHeader || 'apikey',
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
    cwaOpdsUrl,
    cwaBaseUrl: resolvedCwaBaseUrl,
    cwaUsername: row?.cwa_username || process.env.CWA_USERNAME || '',
    cwaPassword,
    cwaTimeoutMs: 20000,
    decryptWarnings
  };
};

const loadAdminIntegrationConfig = async () => {
  const result = await pool.query('SELECT * FROM app_integrations WHERE id = 1');
  return normalizeIntegrationRecord(result.rows[0]);
};

const loadGeneralSettings = async () => {
  const result = await pool.query('SELECT * FROM app_settings WHERE id = 1');
  const row = result.rows[0] || {};
  return {
    theme: row.theme || 'system',
    density: row.density || 'comfortable'
  };
};

module.exports = { deriveCwaBaseUrl, normalizeIntegrationRecord, loadAdminIntegrationConfig, loadGeneralSettings };
