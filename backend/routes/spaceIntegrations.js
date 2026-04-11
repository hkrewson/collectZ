const express = require('express');
const axios = require('axios');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken, requireSessionAuth } = require('../middleware/auth');
const { deriveCwaBaseUrl, loadIntegrationConfigRow, loadScopedIntegrationConfig } = require('../services/integrations');
const { encryptSecret } = require('../services/crypto');
const { buildIntegrationResponse } = require('../services/integrationResponse');
const { resolveBarcodePreset } = require('../services/barcode');
const { resolveTmdbPreset, searchTmdbMovie } = require('../services/tmdb');
const { resolvePlexPreset, fetchPlexSections } = require('../services/plex');
const { resolveBooksPreset, searchBooksByTitle } = require('../services/books');
const { resolveAudioPreset, searchAudioByTitle } = require('../services/audio');
const { resolveGamesPreset, searchGamesByTitle } = require('../services/games');
const { resolveComicsPreset, searchComicsByTitle, fetchMetronCollectionIssues } = require('../services/comics');
const { logActivity, logError } = require('../services/audit');
const {
  getAccessibleSpaceForUser,
  getSpaceMembershipForUser,
  isGlobalAdmin,
  canManageSpaceMemberships
} = require('../services/spaces');

const router = express.Router();

const SPACE_READ_ONLY_FIELDS = [
  'logExportBackend',
  'logExportHost',
  'logExportPort',
  'logExportHostLabel',
  'logExportService',
  'logExportDebug'
];

function parseSpaceId(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

async function requireManageableSpace(client, req, spaceId) {
  if (req.user?.role === 'admin' && Number(req.user?.supportSpaceId || 0) === Number(spaceId || 0)) {
    return { id: Number(spaceId), actor_membership_role: 'admin' };
  }

  const space = await getAccessibleSpaceForUser(client, {
    userId: req.user.id,
    role: req.user.role,
    spaceId
  });
  if (!space) return null;

  const membership = isGlobalAdmin(req.user.role)
    ? null
    : await getSpaceMembershipForUser(client, { userId: req.user.id, spaceId });
  const actorMembershipRole = membership?.role || space.membership_role || null;
  if (!canManageSpaceMemberships({ userRole: req.user.role, membershipRole: actorMembershipRole })) {
    return false;
  }

  return {
    ...space,
    actor_membership_role: actorMembershipRole
  };
}

function buildSpaceIntegrationPayload(config) {
  return buildIntegrationResponse(config);
}

function resolveNextSpaceIntegrationState(body = {}, existing = null) {
  const {
    barcodePreset, barcodeProvider, barcodeApiUrl,
    barcodeApiKey, clearBarcodeApiKey,
    tmdbPreset, tmdbProvider, tmdbApiUrl,
    tmdbApiKey, clearTmdbApiKey,
    plexPreset, plexProvider, plexApiUrl, plexLibrarySections,
    plexApiKey, clearPlexApiKey,
    booksPreset, booksProvider, booksApiUrl,
    booksApiKey, clearBooksApiKey,
    audioPreset, audioProvider, audioApiUrl,
    audioApiKey, clearAudioApiKey,
    gamesPreset, gamesProvider, gamesApiUrl, gamesClientId,
    gamesApiKey, clearGamesApiKey, gamesClientSecret, clearGamesClientSecret,
    comicsPreset, comicsProvider, comicsApiUrl, comicsUsername,
    comicsApiKey, clearComicsApiKey,
    cwaOpdsUrl, cwaUsername, cwaPassword, clearCwaPassword
  } = body;

  const pick = (incoming, existingValue, fallback) =>
    incoming !== undefined ? incoming : (existingValue ?? fallback);

  const selectedBarcodePreset = resolveBarcodePreset(barcodePreset || existing?.barcode_preset || 'upcitemdb');
  const selectedTmdbPreset = resolveTmdbPreset(tmdbPreset || existing?.tmdb_preset || 'tmdb');
  const selectedPlexPreset = resolvePlexPreset(plexPreset || existing?.plex_preset || 'plex');
  const selectedBooksPreset = resolveBooksPreset(booksPreset || existing?.books_preset || 'googlebooks');
  const selectedAudioPreset = resolveAudioPreset(audioPreset || existing?.audio_preset || 'discogs');
  const selectedGamesPreset = resolveGamesPreset(gamesPreset || existing?.games_preset || 'igdb');
  const selectedComicsPreset = resolveComicsPreset(comicsPreset || existing?.comics_preset || 'metron');

  const finalBarcodeApiKey = clearBarcodeApiKey
    ? null
    : (barcodeApiKey ? encryptSecret(barcodeApiKey) : existing?.barcode_api_key_encrypted || null);
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
  const finalGamesClientSecret = clearGamesClientSecret
    ? null
    : (gamesClientSecret ? encryptSecret(gamesClientSecret) : existing?.games_client_secret_encrypted || null);
  const finalComicsApiKey = clearComicsApiKey
    ? null
    : (comicsApiKey ? encryptSecret(comicsApiKey) : existing?.comics_api_key_encrypted || null);
  const finalCwaPassword = clearCwaPassword
    ? null
    : (cwaPassword ? encryptSecret(cwaPassword) : existing?.cwa_password_encrypted || null);

  const resolvedCwaOpdsUrl = pick(cwaOpdsUrl, existing?.cwa_opds_url, '');
  const resolvedCwaBaseUrl = deriveCwaBaseUrl(resolvedCwaOpdsUrl);

  return {
    barcode_preset: pick(barcodePreset, existing?.barcode_preset, 'upcitemdb'),
    barcode_provider: pick(barcodeProvider, existing?.barcode_provider, selectedBarcodePreset.provider),
    barcode_api_url: pick(barcodeApiUrl, existing?.barcode_api_url, selectedBarcodePreset.apiUrl),
    barcode_api_key_encrypted: finalBarcodeApiKey,
    barcode_api_key_header: selectedBarcodePreset.apiKeyHeader,
    barcode_query_param: selectedBarcodePreset.queryParam,
    tmdb_preset: pick(tmdbPreset, existing?.tmdb_preset, 'tmdb'),
    tmdb_provider: pick(tmdbProvider, existing?.tmdb_provider, selectedTmdbPreset.provider),
    tmdb_api_url: pick(tmdbApiUrl, existing?.tmdb_api_url, selectedTmdbPreset.apiUrl),
    tmdb_api_key_encrypted: finalTmdbApiKey,
    tmdb_api_key_header: selectedTmdbPreset.apiKeyHeader,
    tmdb_api_key_query_param: selectedTmdbPreset.apiKeyQueryParam,
    plex_preset: pick(plexPreset, existing?.plex_preset, 'plex'),
    plex_provider: pick(plexProvider, existing?.plex_provider, selectedPlexPreset.provider),
    plex_api_url: pick(plexApiUrl, existing?.plex_api_url, selectedPlexPreset.apiUrl),
    plex_server_name: existing?.plex_server_name || '',
    plex_api_key_encrypted: finalPlexApiKey,
    plex_api_key_query_param: selectedPlexPreset.apiKeyQueryParam,
    plex_library_sections: Array.isArray(plexLibrarySections) ? plexLibrarySections : (existing?.plex_library_sections || []),
    books_preset: pick(booksPreset, existing?.books_preset, 'googlebooks'),
    books_provider: pick(booksProvider, existing?.books_provider, selectedBooksPreset.provider),
    books_api_url: pick(booksApiUrl, existing?.books_api_url, selectedBooksPreset.apiUrl),
    books_api_key_encrypted: finalBooksApiKey,
    books_api_key_header: selectedBooksPreset.apiKeyHeader,
    books_api_key_query_param: selectedBooksPreset.apiKeyQueryParam,
    audio_preset: pick(audioPreset, existing?.audio_preset, 'discogs'),
    audio_provider: pick(audioProvider, existing?.audio_provider, selectedAudioPreset.provider),
    audio_api_url: pick(audioApiUrl, existing?.audio_api_url, selectedAudioPreset.apiUrl),
    audio_api_key_encrypted: finalAudioApiKey,
    audio_api_key_header: selectedAudioPreset.apiKeyHeader,
    audio_api_key_query_param: selectedAudioPreset.apiKeyQueryParam,
    games_preset: pick(gamesPreset, existing?.games_preset, 'igdb'),
    games_provider: pick(gamesProvider, existing?.games_provider, selectedGamesPreset.provider),
    games_api_url: pick(gamesApiUrl, existing?.games_api_url, selectedGamesPreset.apiUrl),
    games_api_key_encrypted: finalGamesApiKey,
    games_api_key_header: selectedGamesPreset.apiKeyHeader,
    games_api_key_query_param: selectedGamesPreset.apiKeyQueryParam,
    games_client_id: pick(gamesClientId, existing?.games_client_id, ''),
    games_client_secret_encrypted: finalGamesClientSecret,
    comics_preset: pick(comicsPreset, existing?.comics_preset, 'metron'),
    comics_provider: pick(comicsProvider, existing?.comics_provider, selectedComicsPreset.provider),
    comics_api_url: pick(comicsApiUrl, existing?.comics_api_url, selectedComicsPreset.apiUrl),
    comics_api_key_encrypted: finalComicsApiKey,
    comics_api_key_header: selectedComicsPreset.apiKeyHeader,
    comics_api_key_query_param: selectedComicsPreset.apiKeyQueryParam,
    comics_username: pick(comicsUsername, existing?.comics_username, ''),
    cwa_opds_url: resolvedCwaOpdsUrl,
    cwa_base_url: resolvedCwaBaseUrl,
    cwa_username: pick(cwaUsername, existing?.cwa_username, ''),
    cwa_password_encrypted: finalCwaPassword,
    cwa_timeout_ms: 20000,
    keyUpdates: {
      barcode: Boolean(barcodeApiKey),
      tmdb: Boolean(tmdbApiKey),
      plex: Boolean(plexApiKey),
      books: Boolean(booksApiKey),
      audio: Boolean(audioApiKey),
      games: Boolean(gamesApiKey),
      gamesClientSecret: Boolean(gamesClientSecret),
      comics: Boolean(comicsApiKey),
      cwaPassword: Boolean(cwaPassword)
    },
    keyClears: {
      barcode: Boolean(clearBarcodeApiKey),
      tmdb: Boolean(clearTmdbApiKey),
      plex: Boolean(clearPlexApiKey),
      books: Boolean(clearBooksApiKey),
      audio: Boolean(clearAudioApiKey),
      games: Boolean(clearGamesApiKey),
      gamesClientSecret: Boolean(clearGamesClientSecret),
      comics: Boolean(clearComicsApiKey),
      cwaPassword: Boolean(clearCwaPassword)
    }
  };
}

async function upsertSpaceIntegrationState(client, spaceId, nextState) {
  const result = await client.query(
    `INSERT INTO app_integrations (
       space_id,
       barcode_preset, barcode_provider, barcode_api_url, barcode_api_key_encrypted,
       barcode_api_key_header, barcode_query_param,
       tmdb_preset, tmdb_provider, tmdb_api_url, tmdb_api_key_encrypted, tmdb_api_key_header, tmdb_api_key_query_param,
       plex_preset, plex_provider, plex_api_url, plex_server_name, plex_api_key_encrypted, plex_api_key_query_param, plex_library_sections,
       books_preset, books_provider, books_api_url, books_api_key_encrypted, books_api_key_header, books_api_key_query_param,
       audio_preset, audio_provider, audio_api_url, audio_api_key_encrypted, audio_api_key_header, audio_api_key_query_param,
       games_preset, games_provider, games_api_url, games_api_key_encrypted, games_api_key_header, games_api_key_query_param, games_client_id, games_client_secret_encrypted,
       comics_preset, comics_provider, comics_api_url, comics_api_key_encrypted, comics_api_key_header, comics_api_key_query_param, comics_username,
       cwa_opds_url, cwa_base_url, cwa_username, cwa_password_encrypted, cwa_timeout_ms
     ) VALUES (
       $1,
       $2,$3,$4,$5,$6,$7,
       $8,$9,$10,$11,$12,$13,
       $14,$15,$16,$17,$18,$19,$20::jsonb,
       $21,$22,$23,$24,$25,$26,
       $27,$28,$29,$30,$31,$32,
       $33,$34,$35,$36,$37,$38,$39,$40,
       $41,$42,$43,$44,$45,$46,$47,
       $48,$49,$50,$51,$52
     )
     ON CONFLICT (space_id) DO UPDATE SET
       barcode_preset = EXCLUDED.barcode_preset,
       barcode_provider = EXCLUDED.barcode_provider,
       barcode_api_url = EXCLUDED.barcode_api_url,
       barcode_api_key_encrypted = EXCLUDED.barcode_api_key_encrypted,
       barcode_api_key_header = EXCLUDED.barcode_api_key_header,
       barcode_query_param = EXCLUDED.barcode_query_param,
       tmdb_preset = EXCLUDED.tmdb_preset,
       tmdb_provider = EXCLUDED.tmdb_provider,
       tmdb_api_url = EXCLUDED.tmdb_api_url,
       tmdb_api_key_encrypted = EXCLUDED.tmdb_api_key_encrypted,
       tmdb_api_key_header = EXCLUDED.tmdb_api_key_header,
       tmdb_api_key_query_param = EXCLUDED.tmdb_api_key_query_param,
       plex_preset = EXCLUDED.plex_preset,
       plex_provider = EXCLUDED.plex_provider,
       plex_api_url = EXCLUDED.plex_api_url,
       plex_server_name = EXCLUDED.plex_server_name,
       plex_api_key_encrypted = EXCLUDED.plex_api_key_encrypted,
       plex_api_key_query_param = EXCLUDED.plex_api_key_query_param,
       plex_library_sections = EXCLUDED.plex_library_sections,
       books_preset = EXCLUDED.books_preset,
       books_provider = EXCLUDED.books_provider,
       books_api_url = EXCLUDED.books_api_url,
       books_api_key_encrypted = EXCLUDED.books_api_key_encrypted,
       books_api_key_header = EXCLUDED.books_api_key_header,
       books_api_key_query_param = EXCLUDED.books_api_key_query_param,
       audio_preset = EXCLUDED.audio_preset,
       audio_provider = EXCLUDED.audio_provider,
       audio_api_url = EXCLUDED.audio_api_url,
       audio_api_key_encrypted = EXCLUDED.audio_api_key_encrypted,
       audio_api_key_header = EXCLUDED.audio_api_key_header,
       audio_api_key_query_param = EXCLUDED.audio_api_key_query_param,
       games_preset = EXCLUDED.games_preset,
       games_provider = EXCLUDED.games_provider,
       games_api_url = EXCLUDED.games_api_url,
       games_api_key_encrypted = EXCLUDED.games_api_key_encrypted,
       games_api_key_header = EXCLUDED.games_api_key_header,
       games_api_key_query_param = EXCLUDED.games_api_key_query_param,
       games_client_id = EXCLUDED.games_client_id,
       games_client_secret_encrypted = EXCLUDED.games_client_secret_encrypted,
       comics_preset = EXCLUDED.comics_preset,
       comics_provider = EXCLUDED.comics_provider,
       comics_api_url = EXCLUDED.comics_api_url,
       comics_api_key_encrypted = EXCLUDED.comics_api_key_encrypted,
       comics_api_key_header = EXCLUDED.comics_api_key_header,
       comics_api_key_query_param = EXCLUDED.comics_api_key_query_param,
       comics_username = EXCLUDED.comics_username,
       cwa_opds_url = EXCLUDED.cwa_opds_url,
       cwa_base_url = EXCLUDED.cwa_base_url,
       cwa_username = EXCLUDED.cwa_username,
       cwa_password_encrypted = EXCLUDED.cwa_password_encrypted,
       cwa_timeout_ms = EXCLUDED.cwa_timeout_ms
     RETURNING *`,
    [
      spaceId,
      nextState.barcode_preset,
      nextState.barcode_provider,
      nextState.barcode_api_url,
      nextState.barcode_api_key_encrypted,
      nextState.barcode_api_key_header,
      nextState.barcode_query_param,
      nextState.tmdb_preset,
      nextState.tmdb_provider,
      nextState.tmdb_api_url,
      nextState.tmdb_api_key_encrypted,
      nextState.tmdb_api_key_header,
      nextState.tmdb_api_key_query_param,
      nextState.plex_preset,
      nextState.plex_provider,
      nextState.plex_api_url,
      nextState.plex_server_name,
      nextState.plex_api_key_encrypted,
      nextState.plex_api_key_query_param,
      JSON.stringify(Array.isArray(nextState.plex_library_sections) ? nextState.plex_library_sections : []),
      nextState.books_preset,
      nextState.books_provider,
      nextState.books_api_url,
      nextState.books_api_key_encrypted,
      nextState.books_api_key_header,
      nextState.books_api_key_query_param,
      nextState.audio_preset,
      nextState.audio_provider,
      nextState.audio_api_url,
      nextState.audio_api_key_encrypted,
      nextState.audio_api_key_header,
      nextState.audio_api_key_query_param,
      nextState.games_preset,
      nextState.games_provider,
      nextState.games_api_url,
      nextState.games_api_key_encrypted,
      nextState.games_api_key_header,
      nextState.games_api_key_query_param,
      nextState.games_client_id,
      nextState.games_client_secret_encrypted,
      nextState.comics_preset,
      nextState.comics_provider,
      nextState.comics_api_url,
      nextState.comics_api_key_encrypted,
      nextState.comics_api_key_header,
      nextState.comics_api_key_query_param,
      nextState.comics_username,
      nextState.cwa_opds_url,
      nextState.cwa_base_url,
      nextState.cwa_username,
      nextState.cwa_password_encrypted,
      nextState.cwa_timeout_ms
    ]
  );
  return result.rows[0] || null;
}

router.get('/spaces/:spaceId/integrations', authenticateToken, requireSessionAuth, asyncHandler(async (req, res) => {
  const spaceId = parseSpaceId(req.params.spaceId);
  if (!spaceId) return res.status(400).json({ error: 'Invalid space id' });

  const client = await pool.connect();
  try {
    const space = await requireManageableSpace(client, req, spaceId);
    if (!space) return res.status(404).json({ error: 'Space not found' });
    if (space === false) return res.status(403).json({ error: 'Space management denied' });

    const config = await loadScopedIntegrationConfig(spaceId);
    res.json(buildSpaceIntegrationPayload(config));
  } finally {
    client.release();
  }
}));

router.put('/spaces/:spaceId/integrations', authenticateToken, requireSessionAuth, asyncHandler(async (req, res) => {
  const spaceId = parseSpaceId(req.params.spaceId);
  if (!spaceId) return res.status(400).json({ error: 'Invalid space id' });
  if (SPACE_READ_ONLY_FIELDS.some((field) => req.body?.[field] !== undefined)) {
    return res.status(400).json({ error: 'Logs and metrics remain global-only integrations' });
  }

  const client = await pool.connect();
  try {
    const space = await requireManageableSpace(client, req, spaceId);
    if (!space) return res.status(404).json({ error: 'Space not found' });
    if (space === false) return res.status(403).json({ error: 'Space management denied' });

    const inheritedRow = await loadIntegrationConfigRow(spaceId, { allowFallback: false });
    const nextState = resolveNextSpaceIntegrationState(req.body || {}, inheritedRow || null);
    const persisted = await upsertSpaceIntegrationState(client, spaceId, nextState);
    const config = await loadScopedIntegrationConfig(spaceId);

    await logActivity(req, 'space.settings.integrations.update', 'app_integrations', persisted?.id || null, {
      spaceId,
      barcodePreset: config.barcodePreset,
      tmdbPreset: config.tmdbPreset,
      plexPreset: config.plexPreset,
      booksPreset: config.booksPreset,
      audioPreset: config.audioPreset,
      gamesPreset: config.gamesPreset,
      comicsPreset: config.comicsPreset,
      cwaEnabled: Boolean(config.cwaOpdsUrl),
      keyUpdates: nextState.keyUpdates,
      keyClears: nextState.keyClears
    });

    res.json(buildSpaceIntegrationPayload(config));
  } finally {
    client.release();
  }
}));

async function runManagedIntegrationTest(req, res, { section, handler }) {
  const spaceId = parseSpaceId(req.params.spaceId);
  if (!spaceId) return res.status(400).json({ error: 'Invalid space id' });

  const client = await pool.connect();
  try {
    const space = await requireManageableSpace(client, req, spaceId);
    if (!space) return res.status(404).json({ error: 'Space not found' });
    if (space === false) return res.status(403).json({ error: 'Space management denied' });
    const config = await loadScopedIntegrationConfig(spaceId);
    return handler(config);
  } finally {
    client.release();
  }
}

router.post('/spaces/:spaceId/integrations/test-barcode', authenticateToken, requireSessionAuth, asyncHandler(async (req, res) => runManagedIntegrationTest(req, res, {
  section: 'barcode',
  handler: async (config) => {
    const testUpc = String(req.body?.upc || '012569828708').trim();
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
    return res.json({ ok: authenticated, authenticated, status, provider: config.barcodeProvider, detail: response.data?.message || response.data?.error || `Provider returned status ${status}` });
  }
})));

router.post('/spaces/:spaceId/integrations/test-tmdb', authenticateToken, requireSessionAuth, asyncHandler(async (req, res) => runManagedIntegrationTest(req, res, {
  section: 'tmdb',
  handler: async (config) => {
    try {
      const results = await searchTmdbMovie(String(req.body?.title || 'The Matrix').trim(), req.body?.year || '1999', config);
      return res.json({ ok: true, authenticated: true, status: 200, provider: config.tmdbProvider || 'tmdb', detail: `Received ${results.length} result(s)`, resultCount: results.length });
    } catch (error) {
      logError('Test TMDB integration (space)', error);
      const status = error.response?.status || 502;
      return res.json({ ok: false, authenticated: status !== 401 && status !== 403, status, provider: config.tmdbProvider || 'tmdb', detail: error.response?.data?.status_message || error.response?.data?.message || error.message });
    }
  }
})));

router.post('/spaces/:spaceId/integrations/test-plex', authenticateToken, requireSessionAuth, asyncHandler(async (req, res) => runManagedIntegrationTest(req, res, {
  section: 'plex',
  handler: async (config) => {
    if (!config.plexApiUrl) return res.status(400).json({ ok: false, authenticated: false, detail: 'Plex API URL is not configured' });
    if (!config.plexApiKey) return res.status(400).json({ ok: false, authenticated: false, detail: 'Plex API key is not configured' });
    try {
      const sections = await fetchPlexSections(config);
      const movieSections = sections.filter((s) => s.type === 'movie');
      const byType = sections.reduce((acc, s) => {
        const key = s.type || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      return res.json({ ok: true, authenticated: true, status: 200, provider: config.plexProvider || 'plex', detail: `Connected. Found ${movieSections.length} movie section(s) (${sections.length} total). Types: ${JSON.stringify(byType)}`, sections, movieSections });
    } catch (error) {
      logError('Test Plex integration (space)', error);
      const status = error.response?.status || 502;
      return res.json({ ok: false, authenticated: status !== 401 && status !== 403, status, provider: config.plexProvider || 'plex', detail: error.message });
    }
  }
})));

router.post('/spaces/:spaceId/integrations/test-books', authenticateToken, requireSessionAuth, asyncHandler(async (req, res) => runManagedIntegrationTest(req, res, {
  section: 'books',
  handler: async (config) => {
    if (!config.booksApiUrl) return res.status(400).json({ ok: false, authenticated: false, detail: 'Books API URL is not configured' });
    try {
      const results = await searchBooksByTitle(String(req.body?.title || 'Dust').trim(), config, 5, String(req.body?.author || 'Hugh Howey').trim());
      return res.json({ ok: true, authenticated: true, status: 200, provider: config.booksProvider || 'googlebooks', detail: `Received ${results.length} result(s)`, resultCount: results.length });
    } catch (error) {
      logError('Test books integration (space)', error);
      const status = error.status || error.response?.status || 502;
      return res.json({ ok: false, authenticated: status !== 401 && status !== 403, status, provider: config.booksProvider || 'googlebooks', detail: error.message });
    }
  }
})));

router.post('/spaces/:spaceId/integrations/test-audio', authenticateToken, requireSessionAuth, asyncHandler(async (req, res) => runManagedIntegrationTest(req, res, {
  section: 'audio',
  handler: async (config) => {
    if (!config.audioApiUrl) return res.status(400).json({ ok: false, authenticated: false, detail: 'Audio API URL is not configured' });
    try {
      const results = await searchAudioByTitle(String(req.body?.title || 'Kind of Blue').trim(), config, 5, String(req.body?.artist || 'Miles Davis').trim());
      return res.json({ ok: true, authenticated: true, status: 200, provider: config.audioProvider || 'discogs', detail: `Received ${results.length} result(s)`, resultCount: results.length });
    } catch (error) {
      logError('Test audio integration (space)', error);
      const status = error.status || error.response?.status || 502;
      return res.json({ ok: false, authenticated: status !== 401 && status !== 403, status, provider: config.audioProvider || 'discogs', detail: error.message });
    }
  }
})));

router.post('/spaces/:spaceId/integrations/test-games', authenticateToken, requireSessionAuth, asyncHandler(async (req, res) => runManagedIntegrationTest(req, res, {
  section: 'games',
  handler: async (config) => {
    if (!config.gamesApiUrl) return res.status(400).json({ ok: false, authenticated: false, detail: 'Games API URL is not configured' });
    try {
      const results = await searchGamesByTitle(String(req.body?.title || 'Halo').trim(), config, 5);
      return res.json({ ok: true, authenticated: true, status: 200, provider: config.gamesProvider || 'igdb', detail: `Received ${results.length} result(s)`, resultCount: results.length });
    } catch (error) {
      logError('Test games integration (space)', error);
      const status = error.status || error.response?.status || 502;
      return res.json({ ok: false, authenticated: status !== 401 && status !== 403, status, provider: config.gamesProvider || 'igdb', detail: error.message });
    }
  }
})));

router.post('/spaces/:spaceId/integrations/test-comics', authenticateToken, requireSessionAuth, asyncHandler(async (req, res) => runManagedIntegrationTest(req, res, {
  section: 'comics',
  handler: async (config) => {
    if (!config.comicsApiUrl) return res.status(400).json({ ok: false, authenticated: false, detail: 'Comics API URL is not configured' });
    try {
      const results = await searchComicsByTitle(String(req.body?.title || 'Batman').trim(), config, 5);
      let collectionCount = null;
      if (String(config.comicsProvider || '').toLowerCase() === 'metron') {
        try {
          const collection = await fetchMetronCollectionIssues(config, { limit: 250 });
          collectionCount = collection.issues.length;
        } catch (_collectionError) {
          collectionCount = null;
        }
      }
      return res.json({ ok: true, authenticated: true, status: 200, provider: config.comicsProvider || 'metron', detail: collectionCount === null ? `Received ${results.length} result(s)` : `Received ${results.length} result(s), collection access ok (${collectionCount} issue(s) sampled)`, resultCount: results.length, collectionCount });
    } catch (error) {
      logError('Test comics integration (space)', error);
      const status = error.status || error.response?.status || 502;
      return res.json({ ok: false, authenticated: status !== 401 && status !== 403, status, provider: config.comicsProvider || 'metron', detail: error.message });
    }
  }
})));

router.post('/spaces/:spaceId/integrations/test-cwa', authenticateToken, requireSessionAuth, asyncHandler(async (req, res) => runManagedIntegrationTest(req, res, {
  section: 'cwa',
  handler: async () => res.status(410).json({ ok: false, authenticated: false, status: 410, provider: 'cwa_opds', detail: 'CWA OPDS integration testing is deferred and currently disabled.' })
})));

module.exports = router;
