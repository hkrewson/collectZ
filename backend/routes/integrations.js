const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { loadAdminIntegrationConfig, normalizeIntegrationRecord, loadGeneralSettings } = require('../services/integrations');
const { encryptSecret, maskSecret } = require('../services/crypto');
const { resolveBarcodePreset } = require('../services/barcode');
const { resolveVisionPreset } = require('../services/vision');
const { resolveTmdbPreset, searchTmdbMovie } = require('../services/tmdb');
const { resolvePlexPreset, fetchPlexSections } = require('../services/plex');
const { resolveBooksPreset, searchBooksByTitle } = require('../services/books');
const { resolveAudioPreset, searchAudioByTitle } = require('../services/audio');
const { resolveGamesPreset, searchGamesByTitle } = require('../services/games');
const { resolveComicsPreset, searchComicsByTitle, fetchMetronCollectionIssues } = require('../services/comics');
const { logActivity, logError } = require('../services/audit');

const router = express.Router();

const DECRYPT_REMEDIATION = 'Stored encrypted key cannot be decrypted with current INTEGRATION_ENCRYPTION_KEY. Re-enter and save the key, or clear the saved key.';

const buildIntegrationResponse = (config) => ({
  barcodePreset: config.barcodePreset,
  barcodeProvider: config.barcodeProvider,
  barcodeApiUrl: config.barcodeApiUrl,
  barcodeApiKeyHeader: config.barcodeApiKeyHeader,
  barcodeQueryParam: config.barcodeQueryParam,
  barcodeApiKeySet: Boolean(config.barcodeApiKey),
  barcodeApiKeyMasked: maskSecret(config.barcodeApiKey),
  visionPreset: config.visionPreset,
  visionProvider: config.visionProvider,
  visionApiUrl: config.visionApiUrl,
  visionApiKeyHeader: config.visionApiKeyHeader,
  visionApiKeySet: Boolean(config.visionApiKey),
  visionApiKeyMasked: maskSecret(config.visionApiKey),
  tmdbPreset: config.tmdbPreset,
  tmdbProvider: config.tmdbProvider,
  tmdbApiUrl: config.tmdbApiUrl,
  tmdbApiKeyHeader: config.tmdbApiKeyHeader,
  tmdbApiKeyQueryParam: config.tmdbApiKeyQueryParam,
  tmdbApiKeySet: Boolean(config.tmdbApiKey),
  tmdbApiKeyMasked: maskSecret(config.tmdbApiKey),
  plexPreset: config.plexPreset,
  plexProvider: config.plexProvider,
  plexApiUrl: config.plexApiUrl,
  plexServerName: config.plexServerName,
  plexApiKeyQueryParam: config.plexApiKeyQueryParam,
  plexLibrarySections: config.plexLibrarySections || [],
  plexApiKeySet: Boolean(config.plexApiKey),
  plexApiKeyMasked: maskSecret(config.plexApiKey),
  booksPreset: config.booksPreset,
  booksProvider: config.booksProvider,
  booksApiUrl: config.booksApiUrl,
  booksApiKeyHeader: config.booksApiKeyHeader,
  booksApiKeyQueryParam: config.booksApiKeyQueryParam,
  booksApiKeySet: Boolean(config.booksApiKey),
  booksApiKeyMasked: maskSecret(config.booksApiKey),
  audioPreset: config.audioPreset,
  audioProvider: config.audioProvider,
  audioApiUrl: config.audioApiUrl,
  audioApiKeyHeader: config.audioApiKeyHeader,
  audioApiKeyQueryParam: config.audioApiKeyQueryParam,
  audioApiKeySet: Boolean(config.audioApiKey),
  audioApiKeyMasked: maskSecret(config.audioApiKey),
  gamesPreset: config.gamesPreset,
  gamesProvider: config.gamesProvider,
  gamesApiUrl: config.gamesApiUrl,
  gamesApiKeyHeader: config.gamesApiKeyHeader,
  gamesApiKeyQueryParam: config.gamesApiKeyQueryParam,
  gamesClientId: config.gamesClientId,
  gamesClientSecretSet: Boolean(config.gamesClientSecret),
  gamesClientSecretMasked: maskSecret(config.gamesClientSecret),
  gamesApiKeySet: Boolean(config.gamesApiKey),
  gamesApiKeyMasked: maskSecret(config.gamesApiKey),
  comicsPreset: config.comicsPreset,
  comicsProvider: config.comicsProvider,
  comicsApiUrl: config.comicsApiUrl,
  comicsApiKeyHeader: config.comicsApiKeyHeader,
  comicsApiKeyQueryParam: config.comicsApiKeyQueryParam,
  comicsUsername: config.comicsUsername,
  comicsApiKeySet: Boolean(config.comicsApiKey),
  comicsApiKeyMasked: maskSecret(config.comicsApiKey),
  decryptHealth: {
    hasWarnings: Array.isArray(config.decryptWarnings) && config.decryptWarnings.length > 0,
    warnings: Array.isArray(config.decryptWarnings) ? config.decryptWarnings : [],
    remediation: DECRYPT_REMEDIATION
  }
});

// ── General settings (read — available to all authenticated users) ────────────

router.get('/settings/general', authenticateToken, asyncHandler(async (req, res) => {
  const settings = await loadGeneralSettings();
  res.json(settings);
}));

// ── Integration settings (admin only) ─────────────────────────────────────────

router.get('/admin/settings/integrations', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const config = await loadAdminIntegrationConfig();
  res.json(buildIntegrationResponse(config));
}));

router.put('/admin/settings/integrations', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const {
    barcodePreset, barcodeProvider, barcodeApiUrl, barcodeApiKeyHeader, barcodeQueryParam,
    barcodeApiKey, clearBarcodeApiKey,
    visionPreset, visionProvider, visionApiUrl, visionApiKeyHeader,
    visionApiKey, clearVisionApiKey,
    tmdbPreset, tmdbProvider, tmdbApiUrl, tmdbApiKeyHeader, tmdbApiKeyQueryParam,
    tmdbApiKey, clearTmdbApiKey,
    plexPreset, plexProvider, plexApiUrl, plexServerName, plexApiKeyQueryParam, plexLibrarySections,
    plexApiKey, clearPlexApiKey,
    booksPreset, booksProvider, booksApiUrl, booksApiKeyHeader, booksApiKeyQueryParam,
    booksApiKey, clearBooksApiKey,
    audioPreset, audioProvider, audioApiUrl, audioApiKeyHeader, audioApiKeyQueryParam,
    audioApiKey, clearAudioApiKey,
    gamesPreset, gamesProvider, gamesApiUrl, gamesApiKeyHeader, gamesApiKeyQueryParam, gamesClientId,
    gamesApiKey, clearGamesApiKey, gamesClientSecret, clearGamesClientSecret,
    comicsPreset, comicsProvider, comicsApiUrl, comicsApiKeyHeader, comicsApiKeyQueryParam, comicsUsername,
    comicsApiKey, clearComicsApiKey
  } = req.body;

  const selectedBarcodePreset = resolveBarcodePreset(barcodePreset || 'upcitemdb');
  const selectedVisionPreset = resolveVisionPreset(visionPreset || 'ocrspace');
  const selectedTmdbPreset = resolveTmdbPreset(tmdbPreset || 'tmdb');
  const selectedPlexPreset = resolvePlexPreset(plexPreset || 'plex');
  const selectedBooksPreset = resolveBooksPreset(booksPreset || 'googlebooks');
  const selectedAudioPreset = resolveAudioPreset(audioPreset || 'discogs');
  const selectedGamesPreset = resolveGamesPreset(gamesPreset || 'igdb');
  const selectedComicsPreset = resolveComicsPreset(comicsPreset || 'metron');

  const existingRow = await pool.query('SELECT * FROM app_integrations WHERE id = 1');
  const existing = existingRow.rows[0] || null;
  const pick = (incoming, existingValue, fallback) =>
    incoming !== undefined ? incoming : (existingValue ?? fallback);

  const finalBarcodeApiKey = clearBarcodeApiKey
    ? null
    : (barcodeApiKey ? encryptSecret(barcodeApiKey) : existing?.barcode_api_key_encrypted || null);
  const finalVisionApiKey = clearVisionApiKey
    ? null
    : (visionApiKey ? encryptSecret(visionApiKey) : existing?.vision_api_key_encrypted || null);
  const finalTmdbApiKey = clearTmdbApiKey
    ? null
    : (tmdbApiKey ? encryptSecret(tmdbApiKey) : existing?.tmdb_api_key_encrypted || null);
  const finalPlexApiKey = clearPlexApiKey
    ? null
    : (plexApiKey ? encryptSecret(plexApiKey) : existing?.plex_api_key_encrypted || null);
  const finalBooksApiKey = clearBooksApiKey
    ? null
    : (booksApiKey ? encryptSecret(booksApiKey) : existing?.books_api_key_encrypted || null);
  const finalAudioApiKey = clearAudioApiKey
    ? null
    : (audioApiKey ? encryptSecret(audioApiKey) : existing?.audio_api_key_encrypted || null);
  const finalGamesApiKey = clearGamesApiKey
    ? null
    : (gamesApiKey ? encryptSecret(gamesApiKey) : existing?.games_api_key_encrypted || null);
  const finalComicsApiKey = clearComicsApiKey
    ? null
    : (comicsApiKey ? encryptSecret(comicsApiKey) : existing?.comics_api_key_encrypted || null);
  const finalGamesClientSecret = clearGamesClientSecret
    ? null
    : (gamesClientSecret ? encryptSecret(gamesClientSecret) : existing?.games_client_secret_encrypted || null);

  const result = await pool.query(
    `INSERT INTO app_integrations (
       id, barcode_preset, barcode_provider, barcode_api_url, barcode_api_key_encrypted,
       barcode_api_key_header, barcode_query_param,
       vision_preset, vision_provider, vision_api_url, vision_api_key_encrypted, vision_api_key_header,
       tmdb_preset, tmdb_provider, tmdb_api_url, tmdb_api_key_encrypted, tmdb_api_key_header, tmdb_api_key_query_param,
       plex_preset, plex_provider, plex_api_url, plex_server_name, plex_api_key_encrypted, plex_api_key_query_param, plex_library_sections,
       books_preset, books_provider, books_api_url, books_api_key_encrypted, books_api_key_header, books_api_key_query_param,
       audio_preset, audio_provider, audio_api_url, audio_api_key_encrypted, audio_api_key_header, audio_api_key_query_param,
       games_preset, games_provider, games_api_url, games_api_key_encrypted, games_api_key_header, games_api_key_query_param, games_client_id, games_client_secret_encrypted,
       comics_preset, comics_provider, comics_api_url, comics_api_key_encrypted, comics_api_key_header, comics_api_key_query_param, comics_username
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25::jsonb,
       $26,$27,$28,$29,$30,$31,
       $32,$33,$34,$35,$36,$37,
       $38,$39,$40,$41,$42,$43,$44,$45,
       $46,$47,$48,$49,$50,$51,$52
     )
     ON CONFLICT (id) DO UPDATE SET
       barcode_preset = EXCLUDED.barcode_preset, barcode_provider = EXCLUDED.barcode_provider,
       barcode_api_url = EXCLUDED.barcode_api_url, barcode_api_key_encrypted = EXCLUDED.barcode_api_key_encrypted,
       barcode_api_key_header = EXCLUDED.barcode_api_key_header, barcode_query_param = EXCLUDED.barcode_query_param,
       vision_preset = EXCLUDED.vision_preset, vision_provider = EXCLUDED.vision_provider,
       vision_api_url = EXCLUDED.vision_api_url, vision_api_key_encrypted = EXCLUDED.vision_api_key_encrypted,
       vision_api_key_header = EXCLUDED.vision_api_key_header,
       tmdb_preset = EXCLUDED.tmdb_preset, tmdb_provider = EXCLUDED.tmdb_provider,
       tmdb_api_url = EXCLUDED.tmdb_api_url, tmdb_api_key_encrypted = EXCLUDED.tmdb_api_key_encrypted,
       tmdb_api_key_header = EXCLUDED.tmdb_api_key_header, tmdb_api_key_query_param = EXCLUDED.tmdb_api_key_query_param,
       plex_preset = EXCLUDED.plex_preset, plex_provider = EXCLUDED.plex_provider,
       plex_api_url = EXCLUDED.plex_api_url, plex_server_name = EXCLUDED.plex_server_name,
       plex_api_key_encrypted = EXCLUDED.plex_api_key_encrypted,
       plex_api_key_query_param = EXCLUDED.plex_api_key_query_param,
       plex_library_sections = EXCLUDED.plex_library_sections,
       books_preset = EXCLUDED.books_preset, books_provider = EXCLUDED.books_provider,
       books_api_url = EXCLUDED.books_api_url, books_api_key_encrypted = EXCLUDED.books_api_key_encrypted,
       books_api_key_header = EXCLUDED.books_api_key_header, books_api_key_query_param = EXCLUDED.books_api_key_query_param,
       audio_preset = EXCLUDED.audio_preset, audio_provider = EXCLUDED.audio_provider,
       audio_api_url = EXCLUDED.audio_api_url, audio_api_key_encrypted = EXCLUDED.audio_api_key_encrypted,
       audio_api_key_header = EXCLUDED.audio_api_key_header, audio_api_key_query_param = EXCLUDED.audio_api_key_query_param,
       games_preset = EXCLUDED.games_preset, games_provider = EXCLUDED.games_provider,
       games_api_url = EXCLUDED.games_api_url, games_api_key_encrypted = EXCLUDED.games_api_key_encrypted,
       games_api_key_header = EXCLUDED.games_api_key_header, games_api_key_query_param = EXCLUDED.games_api_key_query_param,
       games_client_id = EXCLUDED.games_client_id,
       games_client_secret_encrypted = EXCLUDED.games_client_secret_encrypted,
       comics_preset = EXCLUDED.comics_preset, comics_provider = EXCLUDED.comics_provider,
       comics_api_url = EXCLUDED.comics_api_url, comics_api_key_encrypted = EXCLUDED.comics_api_key_encrypted,
       comics_api_key_header = EXCLUDED.comics_api_key_header, comics_api_key_query_param = EXCLUDED.comics_api_key_query_param,
       comics_username = EXCLUDED.comics_username
     RETURNING *`,
    [
      1,
      pick(barcodePreset, existing?.barcode_preset, 'upcitemdb'),
      pick(barcodeProvider, existing?.barcode_provider, selectedBarcodePreset.provider),
      pick(barcodeApiUrl, existing?.barcode_api_url, selectedBarcodePreset.apiUrl),
      finalBarcodeApiKey,
      pick(barcodeApiKeyHeader, existing?.barcode_api_key_header, selectedBarcodePreset.apiKeyHeader),
      pick(barcodeQueryParam, existing?.barcode_query_param, selectedBarcodePreset.queryParam),
      pick(visionPreset, existing?.vision_preset, 'ocrspace'),
      pick(visionProvider, existing?.vision_provider, selectedVisionPreset.provider),
      pick(visionApiUrl, existing?.vision_api_url, selectedVisionPreset.apiUrl),
      finalVisionApiKey,
      pick(visionApiKeyHeader, existing?.vision_api_key_header, selectedVisionPreset.apiKeyHeader),
      pick(tmdbPreset, existing?.tmdb_preset, 'tmdb'),
      pick(tmdbProvider, existing?.tmdb_provider, selectedTmdbPreset.provider),
      pick(tmdbApiUrl, existing?.tmdb_api_url, selectedTmdbPreset.apiUrl),
      finalTmdbApiKey,
      pick(tmdbApiKeyHeader, existing?.tmdb_api_key_header, selectedTmdbPreset.apiKeyHeader),
      pick(tmdbApiKeyQueryParam, existing?.tmdb_api_key_query_param, selectedTmdbPreset.apiKeyQueryParam),
      pick(plexPreset, existing?.plex_preset, 'plex'),
      pick(plexProvider, existing?.plex_provider, selectedPlexPreset.provider),
      pick(plexApiUrl, existing?.plex_api_url, selectedPlexPreset.apiUrl),
      pick(plexServerName, existing?.plex_server_name, ''),
      finalPlexApiKey,
      pick(plexApiKeyQueryParam, existing?.plex_api_key_query_param, selectedPlexPreset.apiKeyQueryParam),
      JSON.stringify(Array.isArray(plexLibrarySections) ? plexLibrarySections : (existing?.plex_library_sections || [])),
      pick(booksPreset, existing?.books_preset, 'googlebooks'),
      pick(booksProvider, existing?.books_provider, selectedBooksPreset.provider),
      pick(booksApiUrl, existing?.books_api_url, selectedBooksPreset.apiUrl),
      finalBooksApiKey,
      pick(booksApiKeyHeader, existing?.books_api_key_header, selectedBooksPreset.apiKeyHeader),
      pick(booksApiKeyQueryParam, existing?.books_api_key_query_param, selectedBooksPreset.apiKeyQueryParam),
      pick(audioPreset, existing?.audio_preset, 'discogs'),
      pick(audioProvider, existing?.audio_provider, selectedAudioPreset.provider),
      pick(audioApiUrl, existing?.audio_api_url, selectedAudioPreset.apiUrl),
      finalAudioApiKey,
      pick(audioApiKeyHeader, existing?.audio_api_key_header, selectedAudioPreset.apiKeyHeader),
      pick(audioApiKeyQueryParam, existing?.audio_api_key_query_param, selectedAudioPreset.apiKeyQueryParam),
      pick(gamesPreset, existing?.games_preset, 'igdb'),
      pick(gamesProvider, existing?.games_provider, selectedGamesPreset.provider),
      pick(gamesApiUrl, existing?.games_api_url, selectedGamesPreset.apiUrl),
      finalGamesApiKey,
      pick(gamesApiKeyHeader, existing?.games_api_key_header, selectedGamesPreset.apiKeyHeader),
      pick(gamesApiKeyQueryParam, existing?.games_api_key_query_param, selectedGamesPreset.apiKeyQueryParam),
      pick(gamesClientId, existing?.games_client_id, ''),
      finalGamesClientSecret,
      pick(comicsPreset, existing?.comics_preset, 'metron'),
      pick(comicsProvider, existing?.comics_provider, selectedComicsPreset.provider),
      pick(comicsApiUrl, existing?.comics_api_url, selectedComicsPreset.apiUrl),
      finalComicsApiKey,
      pick(comicsApiKeyHeader, existing?.comics_api_key_header, selectedComicsPreset.apiKeyHeader),
      pick(comicsApiKeyQueryParam, existing?.comics_api_key_query_param, selectedComicsPreset.apiKeyQueryParam),
      pick(comicsUsername, existing?.comics_username, '')
    ]
  );

  const config = normalizeIntegrationRecord(result.rows[0]);
  await logActivity(req, 'admin.settings.integrations.update', 'app_integrations', 1, {
    barcodePreset: config.barcodePreset,
    visionPreset: config.visionPreset,
    tmdbPreset: config.tmdbPreset,
    plexPreset: config.plexPreset,
    booksPreset: config.booksPreset,
    audioPreset: config.audioPreset,
    gamesPreset: config.gamesPreset,
    comicsPreset: config.comicsPreset,
    keyUpdates: {
      barcode: Boolean(barcodeApiKey),
      vision: Boolean(visionApiKey),
      tmdb: Boolean(tmdbApiKey),
      plex: Boolean(plexApiKey),
      books: Boolean(booksApiKey),
      audio: Boolean(audioApiKey),
      games: Boolean(gamesApiKey),
      gamesClientSecret: Boolean(gamesClientSecret),
      comics: Boolean(comicsApiKey)
    },
    keyClears: {
      barcode: Boolean(clearBarcodeApiKey),
      vision: Boolean(clearVisionApiKey),
      tmdb: Boolean(clearTmdbApiKey),
      plex: Boolean(clearPlexApiKey),
      books: Boolean(clearBooksApiKey),
      audio: Boolean(clearAudioApiKey),
      games: Boolean(clearGamesApiKey),
      gamesClientSecret: Boolean(clearGamesClientSecret),
      comics: Boolean(clearComicsApiKey)
    }
  });

  res.json(buildIntegrationResponse(config));
}));

// ── Integration test endpoints ────────────────────────────────────────────────

router.post('/admin/settings/integrations/test-barcode', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
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

router.post('/admin/settings/integrations/test-vision', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
  const { imageUrl } = req.body || {};
  const config = await loadAdminIntegrationConfig();

  if (!config.visionApiUrl) {
    return res.status(400).json({ ok: false, authenticated: false, detail: 'Vision API URL is not configured' });
  }

  const body = new FormData();
  body.append('url', imageUrl || 'https://upload.wikimedia.org/wikipedia/en/c/c1/The_Matrix_Poster.jpg');
  body.append('language', 'eng');
  body.append('isOverlayRequired', 'false');

  const headers = { ...body.getHeaders() };
  if (config.visionApiKey) headers[config.visionApiKeyHeader || 'apikey'] = config.visionApiKey;

  const response = await axios.post(config.visionApiUrl, body, {
    headers, timeout: 20000, validateStatus: () => true
  });

  const status = response.status;
  const authenticated = status !== 401 && status !== 403;
  res.json({
    ok: authenticated, authenticated, status, provider: config.visionProvider,
    detail: response.data?.ErrorMessage || response.data?.message || response.data?.error || `Provider returned status ${status}`
  });
}));

router.post('/admin/settings/integrations/test-tmdb', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
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

router.post('/admin/settings/integrations/test-plex', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
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

router.post('/admin/settings/integrations/test-books', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
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

router.post('/admin/settings/integrations/test-audio', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
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

router.post('/admin/settings/integrations/test-games', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
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

router.post('/admin/settings/integrations/test-comics', authenticateToken, requireRole('admin'), asyncHandler(async (req, res) => {
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

module.exports = router;
