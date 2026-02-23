const pool = require('../db/pool');
const { decryptSecretWithStatus } = require('./crypto');
const { resolveBarcodePreset } = require('./barcode');
const { resolveVisionPreset } = require('./vision');
const { resolveTmdbPreset } = require('./tmdb');
const { resolvePlexPreset } = require('./plex');

const normalizeIntegrationRecord = (row) => {
  const envBarcodePreset = process.env.BARCODE_PRESET || process.env.BARCODE_PROVIDER || 'upcitemdb';
  const envVisionPreset = process.env.VISION_PRESET || process.env.VISION_PROVIDER || 'ocrspace';
  const envTmdbPreset = process.env.TMDB_PRESET || 'tmdb';
  const envPlexPreset = process.env.PLEX_PRESET || process.env.PLEX_PROVIDER || 'plex';

  const barcodePreset = resolveBarcodePreset(row?.barcode_preset || envBarcodePreset);
  const visionPreset = resolveVisionPreset(row?.vision_preset || envVisionPreset);
  const tmdbPreset = resolveTmdbPreset(row?.tmdb_preset || envTmdbPreset);
  const plexPreset = resolvePlexPreset(row?.plex_preset || envPlexPreset);

  const barcodeDecrypt = decryptSecretWithStatus(row?.barcode_api_key_encrypted, 'barcode_api_key_encrypted');
  const visionDecrypt = decryptSecretWithStatus(row?.vision_api_key_encrypted, 'vision_api_key_encrypted');
  const tmdbDecrypt = decryptSecretWithStatus(row?.tmdb_api_key_encrypted, 'tmdb_api_key_encrypted');
  const plexDecrypt = decryptSecretWithStatus(row?.plex_api_key_encrypted, 'plex_api_key_encrypted');

  const barcodeApiKey = barcodeDecrypt.value || process.env.BARCODE_API_KEY || '';
  const visionApiKey = visionDecrypt.value || process.env.VISION_API_KEY || '';
  const tmdbApiKey = tmdbDecrypt.value || process.env.TMDB_API_KEY || '';
  const plexApiKey = plexDecrypt.value || process.env.PLEX_API_KEY || '';

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

  return {
    barcodePreset: row?.barcode_preset || envBarcodePreset,
    barcodeProvider: row?.barcode_provider || barcodePreset.provider,
    barcodeApiUrl: row?.barcode_api_url || barcodePreset.apiUrl || process.env.BARCODE_API_URL || '',
    barcodeApiKeyHeader: row?.barcode_api_key_header || barcodePreset.apiKeyHeader || 'x-api-key',
    barcodeQueryParam: row?.barcode_query_param || barcodePreset.queryParam || 'upc',
    barcodeApiKey,
    visionPreset: row?.vision_preset || envVisionPreset,
    visionProvider: row?.vision_provider || visionPreset.provider,
    visionApiUrl: row?.vision_api_url || visionPreset.apiUrl || process.env.VISION_API_URL || '',
    visionApiKeyHeader: row?.vision_api_key_header || visionPreset.apiKeyHeader || 'apikey',
    visionApiKey,
    tmdbPreset: row?.tmdb_preset || envTmdbPreset,
    tmdbProvider: row?.tmdb_provider || tmdbPreset.provider,
    tmdbApiUrl: row?.tmdb_api_url || tmdbPreset.apiUrl || process.env.TMDB_API_URL || 'https://api.themoviedb.org/3/search/movie',
    tmdbApiKeyHeader: row?.tmdb_api_key_header || tmdbPreset.apiKeyHeader || '',
    tmdbApiKeyQueryParam: row?.tmdb_api_key_query_param || tmdbPreset.apiKeyQueryParam || 'api_key',
    tmdbApiKey,
    plexPreset: row?.plex_preset || envPlexPreset,
    plexProvider: row?.plex_provider || plexPreset.provider,
    plexApiUrl: row?.plex_api_url || plexPreset.apiUrl || process.env.PLEX_API_URL || '',
    plexServerName: row?.plex_server_name || process.env.PLEX_SERVER_NAME || '',
    plexApiKeyQueryParam: row?.plex_api_key_query_param || plexPreset.apiKeyQueryParam || 'X-Plex-Token',
    plexApiKey,
    plexLibrarySections: Array.isArray(row?.plex_library_sections)
      ? row.plex_library_sections
      : [],
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

module.exports = { normalizeIntegrationRecord, loadAdminIntegrationConfig, loadGeneralSettings };
