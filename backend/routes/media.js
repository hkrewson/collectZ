const express = require('express');
const multer = require('multer');
const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const { validate, mediaCreateSchema, mediaUpdateSchema } = require('../middleware/validate');
const { loadAdminIntegrationConfig } = require('../services/integrations');
const { searchTmdbMovie, fetchTmdbMovieDetails } = require('../services/tmdb');
const { normalizeBarcodeMatches } = require('../services/barcode');
const { extractVisionText, extractTitleCandidates } = require('../services/vision');
const { fetchPlexLibraryItems } = require('../services/plex');
const { searchBooksByTitle } = require('../services/books');
const { searchAudioByTitle } = require('../services/audio');
const { searchGamesByTitle } = require('../services/games');
const { parseCsvText } = require('../services/csv');
const { logError, logActivity } = require('../services/audit');
const { uploadBuffer } = require('../services/storage');
const { resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const { isFeatureEnabled } = require('../services/featureFlags');
const { enforceScopeAccess } = require('../middleware/scopeAccess');

const router = express.Router();

const tempDiskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, 'uploads/'),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const tempUpload = multer({ storage: tempDiskStorage, limits: { fileSize: 10 * 1024 * 1024 } });
const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const MEDIA_FORMATS = ['VHS', 'Blu-ray', 'Digital', 'DVD', '4K UHD', 'Paperback', 'Hardcover', 'Trade'];
const MEDIA_TYPES = ['movie', 'tv_series', 'tv_episode', 'book', 'audio', 'game', 'other'];
const ALLOWED_COVER_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const SYNC_JOB_ALLOWED_FIELDS = new Set([
  'status',
  'scope',
  'progress',
  'summary',
  'error',
  'started_at',
  'finished_at'
]);
const SORT_COLUMNS = {
  title: 'title',
  year: 'year',
  format: 'format',
  created_at: 'created_at',
  user_rating: 'user_rating',
  rating: 'rating'
};

function normalizeMediaType(input, fallback = 'movie') {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'tv' || raw === 'show' || raw === 'series' || raw === 'tv_show' || raw === 'tvseries') return 'tv_series';
  if (raw === 'tv_episode' || raw === 'episode') return 'tv_episode';
  if (raw === 'movie' || raw === 'film') return 'movie';
  if (raw === 'book' || raw === 'books' || raw === 'comic' || raw === 'comics') return 'book';
  if (raw === 'audio' || raw === 'music' || raw === 'album' || raw === 'cd' || raw === 'vinyl' || raw === 'lp') return 'audio';
  if (raw === 'game' || raw === 'games' || raw === 'video_game' || raw === 'videogame') return 'game';
  if (raw === 'other') return 'other';
  return fallback;
}

function mapDeliciousItemTypeToMediaType(itemTypeRaw) {
  const raw = String(itemTypeRaw || '').trim().toLowerCase();
  if (!raw) return 'movie';
  if (raw.includes('movie') || raw.includes('film') || raw.includes('video')) return 'movie';
  if (raw.includes('tv') || raw.includes('show') || raw.includes('series') || raw.includes('episode')) return 'tv_series';
  if (raw.includes('book') || raw.includes('comic') || raw.includes('novel')) return 'book';
  if (raw.includes('music') || raw.includes('audio') || raw.includes('cd') || raw.includes('vinyl') || raw.includes('lp')) return 'audio';
  if (raw.includes('game')) return 'game';
  return null;
}

function validateTypeSpecificFields(mediaType, payload = {}) {
  const effectiveType = normalizeMediaType(mediaType, 'movie');
  const hasSeason = payload.season_number !== undefined && payload.season_number !== null;
  const hasEpisodeNumber = payload.episode_number !== undefined && payload.episode_number !== null;
  const hasEpisodeTitle = payload.episode_title !== undefined && payload.episode_title !== null && String(payload.episode_title).trim() !== '';
  const hasNetwork = payload.network !== undefined && payload.network !== null && String(payload.network).trim() !== '';
  const hasTvFields = hasSeason || hasEpisodeNumber || hasEpisodeTitle || hasNetwork;

  if (!['tv_series', 'tv_episode'].includes(effectiveType) && hasTvFields) {
    return 'TV-specific fields are only valid for TV media types';
  }
  if (effectiveType === 'tv_series' && (hasEpisodeNumber || hasEpisodeTitle)) {
    return 'TV series entries cannot include episode-specific fields';
  }
  return null;
}

function sanitizeTypeDetails(mediaType, rawTypeDetails) {
  if (!rawTypeDetails || typeof rawTypeDetails !== 'object' || Array.isArray(rawTypeDetails)) {
    return null;
  }
  const normalizedType = normalizeMediaType(mediaType || 'movie', 'movie');
  const allowedByType = {
    book: ['author', 'isbn', 'publisher', 'edition'],
    audio: ['artist', 'album', 'track_count'],
    game: ['platform', 'developer', 'region']
  };
  const allowedKeys = allowedByType[normalizedType] || [];
  if (!allowedKeys.length) return null;
  const sanitized = {};
  for (const key of allowedKeys) {
    const value = rawTypeDetails[key];
    if (value === undefined || value === null || value === '') continue;
    if (key === 'track_count') {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) sanitized[key] = Math.round(numeric);
    } else {
      sanitized[key] = String(value).trim();
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function normalizeResolution(value) {
  if (!value || value === 'all') return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '4k') return '4k';
  if (normalized === '1080p') return '1080';
  if (normalized === '720p') return '720';
  if (normalized === 'sd') return 'sd';
  return normalized;
}

function normalizeMediaFormat(formatValue) {
  if (!formatValue) return 'Digital';
  const raw = String(formatValue).trim().toLowerCase();
  if (!raw) return 'Digital';
  if (raw.includes('blu')) return 'Blu-ray';
  if (raw.includes('dvd')) return 'DVD';
  if (raw.includes('vhs')) return 'VHS';
  if (raw.includes('digital') || raw.includes('stream')) return 'Digital';
  if (raw.includes('4k') || raw.includes('uhd')) return '4K UHD';
  if (raw.includes('paperback')) return 'Paperback';
  if (raw.includes('hardcover') || raw.includes('hard cover')) return 'Hardcover';
  if (raw.includes('trade')) return 'Trade';
  return MEDIA_FORMATS.includes(formatValue) ? formatValue : 'Digital';
}

function getRowValue(row, name) {
  if (!row || !name) return '';
  const normalized = String(name).trim().toLowerCase();
  const key = Object.keys(row).find((k) => String(k).trim().toLowerCase() === normalized);
  return key ? row[key] : '';
}

function parseYear(value) {
  if (!value) return null;
  const yearMatch = String(value).match(/\b(18|19|20)\d{2}\b/);
  if (!yearMatch) return null;
  const year = Number(yearMatch[0]);
  return Number.isFinite(year) ? year : null;
}

function parseDateOnly(value) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function normalizeTitleForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickBestTmdbMatch(results = [], title, year) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const targetTitle = normalizeTitleForMatch(title);
  const targetYear = Number.isFinite(Number(year)) ? Number(year) : null;
  let best = null;
  let bestScore = -Infinity;

  for (const row of results) {
    const candidateTitle = normalizeTitleForMatch(
      row.title || row.name || row.original_title || row.original_name || ''
    );
    const candidateYear = parseYear(row.release_date || row.first_air_date || '');
    let score = 0;
    if (targetTitle && candidateTitle) {
      if (candidateTitle === targetTitle) score += 100;
      else if (candidateTitle.startsWith(targetTitle) || targetTitle.startsWith(candidateTitle)) score += 60;
      else if (candidateTitle.includes(targetTitle) || targetTitle.includes(candidateTitle)) score += 35;
    }
    if (targetYear && candidateYear) {
      const delta = Math.abs(candidateYear - targetYear);
      if (delta === 0) score += 30;
      else if (delta <= 1) score += 20;
      else if (delta <= 2) score += 10;
    }
    if (row.vote_count) score += Math.min(10, Number(row.vote_count) / 500);
    if (!best || score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best || results[0];
}

async function enrichImportItemWithTmdb(item, config, cache) {
  if (!config?.tmdbApiKey || !item?.title) return item;
  const normalizedMediaType = normalizeMediaType(item.media_type || 'movie', 'movie');
  if (!['movie', 'tv_series', 'tv_episode'].includes(normalizedMediaType)) {
    return item;
  }
  const tmdbType = normalizedMediaType === 'tv_series' || normalizedMediaType === 'tv_episode' ? 'tv' : 'movie';

  const cacheKey = item.tmdb_id
    ? `${tmdbType}:id:${item.tmdb_id}`
    : `${tmdbType}:q:${String(item.title).toLowerCase()}|${item.year || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return {
      ...item,
      ...cached,
      format: item.format || 'Digital'
    };
  }

  try {
    let candidate = null;
    if (item.tmdb_id) {
      candidate = { id: item.tmdb_id };
    } else {
      const results = await searchTmdbMovie(item.title, item.year || undefined, config, tmdbType);
      candidate = pickBestTmdbMatch(results, item.title, item.year) || null;
    }
    if (!candidate?.id) {
      cache.set(cacheKey, {});
      return item;
    }

    const details = await fetchTmdbMovieDetails(candidate.id, config, tmdbType);
    const enriched = {
      tmdb_id: candidate.id,
      tmdb_media_type: tmdbType,
      tmdb_url: details?.tmdb_url || `https://www.themoviedb.org/${tmdbType}/${candidate.id}`,
      poster_path: details?.poster_path || candidate?.poster_path || null,
      backdrop_path: details?.backdrop_path || candidate?.backdrop_path || null,
      overview: details?.overview || candidate?.overview || null,
      rating: details?.rating ?? candidate?.rating ?? candidate?.vote_average ?? null,
      runtime: details?.runtime || item.runtime || null,
      director: details?.director || item.director || null,
      trailer_url: details?.trailer_url || item.trailer_url || null,
      release_date: details?.release_date || item.release_date || null,
      year: item.year || parseYear(details?.release_date),
      original_title: item.original_title || candidate?.original_title || candidate?.original_name || null
    };
    cache.set(cacheKey, enriched);
    return { ...item, ...enriched, format: item.format || 'Digital' };
  } catch (_error) {
    cache.set(cacheKey, {});
    return item;
  }
}

async function upsertImportedMedia({ userId, item, importSource, scopeContext = null }) {
  const title = String(item.title || '').trim();
  if (!title) {
    return { type: 'invalid', detail: 'Missing title' };
  }
  const normalizedMediaType = normalizeMediaType(item.media_type || 'movie', 'movie');
  const normalizedTmdbType = normalizedMediaType === 'tv_series' || normalizedMediaType === 'tv_episode' ? 'tv' : 'movie';
  const normalizedTypeDetails = sanitizeTypeDetails(normalizedMediaType, item.type_details);
  const dedupLockKey = buildMediaDedupLockKey({ ...item, title }, scopeContext);
  return withDedupLock(dedupLockKey, async () => {
    const year = item.year ?? null;
    const existingParams = [title, year, normalizedMediaType];
    const existingScopeClause = appendScopeSql(existingParams, scopeContext);
    const existing = await pool.query(
      `SELECT id
       FROM media
       WHERE LOWER(TRIM(title)) = LOWER(TRIM($1))
         AND (($2::int IS NOT NULL AND year = $2::int) OR ($2::int IS NULL))
         AND COALESCE(media_type, 'movie') = $3
         ${existingScopeClause}
       ORDER BY created_at DESC
       LIMIT 1`,
      existingParams
    );
    if (existing.rows[0]) {
      const updateParams = [
        normalizedMediaType,
        item.original_title || null,
        item.release_date || null,
        item.year || null,
        item.format || null,
        item.genre || null,
        item.director || null,
        item.rating || null,
        item.user_rating || null,
        item.tmdb_id || null,
        item.tmdb_media_type || normalizedTmdbType,
        item.tmdb_url || null,
        item.poster_path || null,
        item.backdrop_path || null,
        item.overview || null,
        item.trailer_url || null,
        item.runtime || null,
        item.upc || null,
        item.location || null,
        item.notes || null,
        normalizedTypeDetails ? JSON.stringify(normalizedTypeDetails) : null,
        importSource || null,
        existing.rows[0].id
      ];
      const updateScopeClause = appendScopeSql(updateParams, scopeContext);
      await pool.query(
        `UPDATE media SET
           media_type = COALESCE($1, media_type),
           original_title = COALESCE($2, original_title),
           release_date = COALESCE($3, release_date),
           year = COALESCE($4, year),
           format = COALESCE($5, format),
           genre = COALESCE($6, genre),
           director = COALESCE($7, director),
           rating = COALESCE($8, rating),
           user_rating = COALESCE($9, user_rating),
           tmdb_id = COALESCE($10, tmdb_id),
           tmdb_media_type = COALESCE($11, tmdb_media_type),
           tmdb_url = COALESCE($12, tmdb_url),
           poster_path = COALESCE($13, poster_path),
           backdrop_path = COALESCE($14, backdrop_path),
           overview = COALESCE($15, overview),
           trailer_url = COALESCE($16, trailer_url),
           runtime = COALESCE($17, runtime),
           upc = COALESCE($18, upc),
           location = COALESCE($19, location),
           notes = COALESCE($20, notes),
           type_details = COALESCE($21::jsonb, type_details),
           import_source = COALESCE($22, import_source)
         WHERE id = $23${updateScopeClause}`,
        updateParams
      );
      return { type: 'updated' };
    }

    await pool.query(
      `INSERT INTO media (
         title, media_type, original_title, release_date, year, format, genre, director,
         rating, user_rating, tmdb_id, tmdb_media_type, tmdb_url, poster_path, backdrop_path, overview, trailer_url,
         runtime, upc, location, notes, type_details, library_id, space_id, added_by, import_source
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23,$24,$25,$26,$27
       )`,
      [
        title,
        normalizedMediaType,
        item.original_title || null,
        item.release_date || null,
        item.year || null,
        item.format || 'Digital',
        item.genre || null,
        item.director || null,
        item.rating || null,
        item.user_rating || null,
        item.tmdb_id || null,
        item.tmdb_media_type || normalizedTmdbType,
        item.tmdb_url || null,
        item.poster_path || null,
        item.backdrop_path || null,
        item.overview || null,
        item.trailer_url || null,
        item.runtime || null,
        item.upc || null,
        item.location || null,
        item.notes || null,
        normalizedTypeDetails ? JSON.stringify(normalizedTypeDetails) : null,
        item.library_id || scopeContext?.libraryId || null,
        item.space_id || scopeContext?.spaceId || null,
        userId,
        importSource || null
      ]
    );
    return { type: 'created' };
  });
}

const TMDB_IMPORT_MIN_INTERVAL_MS = Math.max(0, Number(process.env.TMDB_IMPORT_MIN_INTERVAL_MS || 50));
const PLEX_JOB_PROGRESS_BATCH_SIZE = Math.max(1, Number(process.env.PLEX_JOB_PROGRESS_BATCH_SIZE || 25));
const CSV_JOB_PROGRESS_BATCH_SIZE = Math.max(1, Number(process.env.CSV_JOB_PROGRESS_BATCH_SIZE || 25));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildTmdbThrottle() {
  let lastAt = 0;
  return async () => {
    if (TMDB_IMPORT_MIN_INTERVAL_MS <= 0) return;
    const now = Date.now();
    const waitMs = (lastAt + TMDB_IMPORT_MIN_INTERVAL_MS) - now;
    if (waitMs > 0) await sleep(waitMs);
    lastAt = Date.now();
  };
}

function parseAsyncFlag(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

async function assertFeatureEnabled(key) {
  const enabled = await isFeatureEnabled(key, true);
  if (enabled) return;
  const error = new Error('This feature is disabled by an administrator');
  error.status = 503;
  error.code = 'feature_disabled';
  throw error;
}

function jobScopePayload(scopeContext, sectionIds = []) {
  return {
    spaceId: scopeContext?.spaceId ?? null,
    libraryId: scopeContext?.libraryId ?? null,
    sectionIds: Array.isArray(sectionIds) ? sectionIds : []
  };
}

function buildDedupScopeKey(scopeContext = null) {
  const space = scopeContext?.spaceId ? `s:${scopeContext.spaceId}` : 's:global';
  const library = scopeContext?.libraryId ? `l:${scopeContext.libraryId}` : 'l:all';
  return `${space}|${library}`;
}

function buildMediaDedupLockKey(item = {}, scopeContext = null) {
  const scope = buildDedupScopeKey(scopeContext);
  const normalizedMediaType = normalizeMediaType(item.media_type || 'movie', 'movie');
  const tmdbType = item.tmdb_media_type || (normalizedMediaType === 'tv_series' || normalizedMediaType === 'tv_episode' ? 'tv' : 'movie');
  if (item.plex_guid) return `media|${scope}|plex_guid|${item.plex_guid}`;
  if (item.plex_rating_key) return `media|${scope}|plex_rating_key|${item.plex_rating_key}`;
  if (item.tmdb_id) return `media|${scope}|tmdb|${tmdbType}|${item.tmdb_id}`;
  const title = normalizeTitleForMatch(item.title || '');
  const year = item.year || 'na';
  return `media|${scope}|title_year_type|${title}|${year}|${normalizedMediaType}`;
}

async function withDedupLock(lockKey, fn) {
  await pool.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
  try {
    return await fn();
  } finally {
    await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
  }
}

async function createSyncJob({ userId, jobType, provider, scope, progress }) {
  const result = await pool.query(
    `INSERT INTO sync_jobs (job_type, provider, status, created_by, scope, progress)
     VALUES ($1, $2, 'queued', $3, $4::jsonb, $5::jsonb)
     RETURNING id, job_type, provider, status, created_by, scope, progress, summary, error,
               started_at, finished_at, created_at, updated_at`,
    [
      jobType,
      provider,
      userId || null,
      JSON.stringify(scope || {}),
      JSON.stringify(progress || {})
    ]
  );
  return result.rows[0];
}

async function updateSyncJob(jobId, patch = {}) {
  const entries = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (!SYNC_JOB_ALLOWED_FIELDS.has(key)) {
      throw new Error(`Invalid sync job update field: ${key}`);
    }
    entries.push([key, value]);
  }
  if (entries.length === 0) return null;
  const sets = [];
  const values = [];
  for (const [key, value] of entries) {
    values.push(value);
    if (['scope', 'progress', 'summary'].includes(key)) {
      sets.push(`${key} = $${values.length}::jsonb`);
    } else {
      sets.push(`${key} = $${values.length}`);
    }
  }
  values.push(jobId);
  const result = await pool.query(
    `UPDATE sync_jobs
     SET ${sets.join(', ')}
     WHERE id = $${values.length}
     RETURNING id, job_type, provider, status, created_by, scope, progress, summary, error,
               started_at, finished_at, created_at, updated_at`,
    values
  );
  return result.rows[0] || null;
}

async function getSyncJob(jobId, reqUser) {
  const params = [jobId];
  let where = 'WHERE id = $1';
  if (reqUser?.role !== 'admin') {
    params.push(reqUser?.id || null);
    where += ` AND created_by = $${params.length}`;
  }
  const result = await pool.query(
    `SELECT id, job_type, provider, status, created_by, scope, progress, summary, error,
            started_at, finished_at, created_at, updated_at
     FROM sync_jobs
     ${where}
     LIMIT 1`,
    params
  );
  return result.rows[0] || null;
}

async function runPlexImport({ req, config, sectionIds = [], scopeContext = null, onProgress = null }) {
  const summary = { created: 0, updated: 0, skipped: 0, errors: [], enrichmentErrors: [] };
  let tmdbPosterEnriched = 0;
  let tmdbPosterLookupMisses = 0;
  let variantsCreated = 0;
  let variantsUpdated = 0;
  let items = [];
  const tmdbEnrichmentCache = new Map();
  const throttleTmdb = buildTmdbThrottle();
  const updateProgress = async (progress) => {
    if (typeof onProgress !== 'function') return;
    await onProgress(progress);
  };
  const upsertMediaMetadata = async (mediaId, key, value) => {
    if (!value) return;
    await pool.query(
      `INSERT INTO media_metadata (media_id, "key", "value")
       VALUES ($1::int, $2::varchar, $3::text)
       ON CONFLICT (media_id, "key")
       DO UPDATE SET "value" = EXCLUDED."value"`,
      [mediaId, key, String(value)]
    );
  };
  const upsertMediaVariant = async (mediaId, variant) => {
    if (!variant) return;
    const payload = [
      mediaId,
      variant.source || 'plex',
      variant.source_item_key || null,
      variant.source_media_id || null,
      variant.source_part_id || null,
      variant.edition || null,
      variant.file_path || null,
      variant.container || null,
      variant.video_codec || null,
      variant.audio_codec || null,
      variant.resolution || null,
      variant.video_width || null,
      variant.video_height || null,
      variant.audio_channels || null,
      variant.duration_ms || null,
      variant.runtime_minutes || null,
      variant.raw_json ? JSON.stringify(variant.raw_json) : null
    ];

    const byPart = variant.source_part_id
      ? await pool.query(
        `UPDATE media_variants
         SET media_id = $1, source_item_key = $3, source_media_id = $4, source_part_id = $5,
             edition = $6, file_path = $7, container = $8, video_codec = $9, audio_codec = $10,
             resolution = $11, video_width = $12, video_height = $13, audio_channels = $14,
             duration_ms = $15, runtime_minutes = $16, raw_json = $17::jsonb
         WHERE source = $2
           AND source_part_id = $5
         RETURNING id`,
        payload
      )
      : { rows: [] };
    if (byPart.rows.length > 0) {
      variantsUpdated += 1;
      return;
    }

    const byItem = variant.source_item_key
      ? await pool.query(
        `UPDATE media_variants
         SET media_id = $1, source_item_key = $3, source_media_id = $4, source_part_id = $5,
             edition = $6, file_path = $7, container = $8, video_codec = $9, audio_codec = $10,
             resolution = $11, video_width = $12, video_height = $13, audio_channels = $14,
             duration_ms = $15, runtime_minutes = $16, raw_json = $17::jsonb
         WHERE source = $2
           AND source_item_key = $3
         RETURNING id`,
        payload
      )
      : { rows: [] };
    if (byItem.rows.length > 0) {
      variantsUpdated += 1;
      return;
    }

    await pool.query(
      `INSERT INTO media_variants (
         media_id, source, source_item_key, source_media_id, source_part_id,
         edition, file_path, container, video_codec, audio_codec, resolution,
         video_width, video_height, audio_channels, duration_ms, runtime_minutes, raw_json
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb
       )`,
      payload
    );
    variantsCreated += 1;
  };

  items = await fetchPlexLibraryItems(config, sectionIds);
  await updateProgress({
    total: items.length,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errorCount: 0
  });

  for (let idx = 0; idx < items.length; idx += 1) {
    const item = items[idx];
    const media = { ...item.normalized };
    if (!media.title) {
      summary.skipped += 1;
      continue;
    }

    if (!media.poster_path && config.tmdbApiKey) {
      const tmdbType = media.tmdb_media_type === 'tv' ? 'tv' : 'movie';
      const cacheKey = media.tmdb_id
        ? `${tmdbType}:id:${media.tmdb_id}`
        : `${tmdbType}:q:${String(media.title || '').toLowerCase()}|${media.year || ''}`;
      let cached = tmdbEnrichmentCache.get(cacheKey);
      if (cached === undefined) {
        cached = null;
        try {
          await throttleTmdb();
          if (media.tmdb_id) {
            const details = await fetchTmdbMovieDetails(media.tmdb_id, config, tmdbType);
            cached = {
              tmdb_id: media.tmdb_id,
              tmdb_url: details?.tmdb_url || `https://www.themoviedb.org/${tmdbType}/${media.tmdb_id}`,
              poster_path: details?.poster_path || null,
              backdrop_path: details?.backdrop_path || null
            };
          } else if (media.title) {
            const results = await searchTmdbMovie(media.title, media.year || undefined, config, tmdbType);
            const best = pickBestTmdbMatch(results, media.title, media.year);
            if (best) {
              cached = {
                tmdb_id: best.id || null,
                tmdb_url: best.id ? `https://www.themoviedb.org/${tmdbType}/${best.id}` : null,
                poster_path: best.poster_path || null,
                backdrop_path: best.backdrop_path || null
              };
            }
          }
        } catch (error) {
          cached = null;
          summary.enrichmentErrors.push({
            title: media.title,
            type: 'tmdb_poster_enrichment',
            detail: error.message || 'TMDB enrichment failed'
          });
          logError('Plex import TMDB poster enrichment failed', error);
        }
        tmdbEnrichmentCache.set(cacheKey, cached);
      }

      if (cached?.poster_path) {
        media.poster_path = cached.poster_path;
        media.backdrop_path = cached.backdrop_path || media.backdrop_path || cached.poster_path;
        media.tmdb_id = media.tmdb_id || cached.tmdb_id || null;
        media.tmdb_url = media.tmdb_url || cached.tmdb_url || (media.tmdb_id ? `https://www.themoviedb.org/${tmdbType}/${media.tmdb_id}` : null);
        tmdbPosterEnriched += 1;
      } else {
        tmdbPosterLookupMisses += 1;
      }
    }

    try {
      const plexGuid = media.plex_guid || null;
      const plexItemKey = media.plex_rating_key ? `${item.sectionId}:${media.plex_rating_key}` : null;
      const dedupKey = buildMediaDedupLockKey({
        ...media,
        plex_rating_key: plexItemKey
      }, scopeContext);
      await withDedupLock(dedupKey, async () => {
        let existing = null;

        if (plexGuid) {
        const byPlexGuidParams = [plexGuid];
        const byPlexGuidScopeClause = appendScopeSql(byPlexGuidParams, scopeContext, {
          spaceColumn: 'm.space_id',
          libraryColumn: 'm.library_id'
        });
        const byPlexGuid = await pool.query(
          `SELECT m.id
           FROM media m
           JOIN media_metadata mm ON mm.media_id = m.id
           WHERE mm."key" = 'plex_guid'
             AND mm."value" = $1
             ${byPlexGuidScopeClause}
           ORDER BY m.created_at DESC
           LIMIT 1`,
          byPlexGuidParams
        );
          existing = byPlexGuid.rows[0] || null;
        }

        if (!existing && plexItemKey) {
        const byPlexItemKeyParams = [plexItemKey];
        const byPlexItemKeyScopeClause = appendScopeSql(byPlexItemKeyParams, scopeContext, {
          spaceColumn: 'm.space_id',
          libraryColumn: 'm.library_id'
        });
        const byPlexItemKey = await pool.query(
          `SELECT m.id
           FROM media m
           JOIN media_metadata mm ON mm.media_id = m.id
           WHERE mm."key" = 'plex_item_key'
             AND mm."value" = $1
             ${byPlexItemKeyScopeClause}
           ORDER BY m.created_at DESC
           LIMIT 1`,
          byPlexItemKeyParams
        );
          existing = byPlexItemKey.rows[0] || null;
        }

        if (!existing && media.tmdb_id) {
        const byTmdbParams = [media.tmdb_id, media.tmdb_media_type || 'movie'];
        const byTmdbScopeClause = appendScopeSql(byTmdbParams, scopeContext);
        const byTmdb = await pool.query(
          `SELECT id
           FROM media
           WHERE tmdb_id = $1
             AND COALESCE(tmdb_media_type, 'movie') = COALESCE($2, COALESCE(tmdb_media_type, 'movie'))
             ${byTmdbScopeClause}
           LIMIT 1`,
          byTmdbParams
        );
          existing = byTmdb.rows[0] || null;
        }

        if (!existing) {
        const byTitleYearParams = [media.title, media.year || null];
        const byTitleYearScopeClause = appendScopeSql(byTitleYearParams, scopeContext);
        const byTitleYear = await pool.query(
          `SELECT id
           FROM media
           WHERE LOWER(TRIM(title)) = LOWER(TRIM($1))
             AND (
               ($2::int IS NOT NULL AND year = $2::int)
               OR ($2::int IS NULL)
             )
             ${byTitleYearScopeClause}
           ORDER BY created_at DESC
           LIMIT 1`,
          byTitleYearParams
        );
          existing = byTitleYear.rows[0] || null;
        }

        if (existing) {
        const updateParams = [
          media.original_title,
          media.release_date,
          media.year,
          media.format,
          media.director,
          media.rating,
          media.runtime,
          media.poster_path,
          media.backdrop_path,
          media.overview,
          media.tmdb_id,
          media.tmdb_media_type || 'movie',
          media.tmdb_url,
          normalizeMediaType(media.media_type || 'movie', 'movie'),
          media.network,
          `Imported from Plex section ${item.sectionId}`,
          existing.id
        ];
        const updateScopeClause = appendScopeSql(updateParams, scopeContext);
        await pool.query(
          `UPDATE media SET
             original_title = COALESCE($1, original_title),
             release_date = COALESCE($2, release_date),
             year = COALESCE($3, year),
             format = COALESCE($4, format),
             director = COALESCE($5, director),
             rating = COALESCE($6, rating),
             runtime = COALESCE($7, runtime),
             poster_path = COALESCE($8, poster_path),
             backdrop_path = COALESCE($9, backdrop_path),
             overview = COALESCE($10, overview),
             tmdb_id = COALESCE($11, tmdb_id),
             tmdb_media_type = COALESCE($12, tmdb_media_type),
             tmdb_url = COALESCE($13, tmdb_url),
             media_type = COALESCE($14, media_type),
             network = COALESCE($15, network),
             notes = COALESCE($16, notes),
             import_source = 'plex'
           WHERE id = $17${updateScopeClause}`,
          updateParams
        );
        await upsertMediaMetadata(existing.id, 'plex_guid', plexGuid);
        await upsertMediaMetadata(existing.id, 'plex_item_key', plexItemKey);
        await upsertMediaMetadata(existing.id, 'plex_section_id', item.sectionId);
        await upsertMediaVariant(existing.id, item.variant);
          summary.updated += 1;
        } else {
        const inserted = await pool.query(
          `INSERT INTO media (
             title, original_title, release_date, year, format, director, rating,
             runtime, poster_path, backdrop_path, overview, tmdb_id, tmdb_media_type, tmdb_url, media_type, network, notes,
             library_id, space_id, added_by, import_source
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
           )
           RETURNING id`,
          [
            media.title,
            media.original_title,
            media.release_date,
            media.year,
            media.format || 'Digital',
            media.director,
            media.rating,
            media.runtime,
            media.poster_path,
            media.backdrop_path,
            media.overview,
            media.tmdb_id,
            media.tmdb_media_type || 'movie',
            media.tmdb_url,
            normalizeMediaType(media.media_type || 'movie', 'movie'),
            media.network,
            `Imported from Plex section ${item.sectionId}`,
            scopeContext.libraryId || null,
            scopeContext.spaceId || null,
            req.user.id,
            'plex'
          ]
        );
          const insertedId = inserted.rows[0]?.id;
          if (insertedId) {
          await upsertMediaMetadata(insertedId, 'plex_guid', plexGuid);
          await upsertMediaMetadata(insertedId, 'plex_item_key', plexItemKey);
          await upsertMediaMetadata(insertedId, 'plex_section_id', item.sectionId);
          await upsertMediaVariant(insertedId, item.variant);
          }
          summary.created += 1;
        }
      });
    } catch (error) {
      summary.errors.push({ title: media.title, detail: error.message });
    }

    const processed = idx + 1;
    if (processed === items.length || processed % PLEX_JOB_PROGRESS_BATCH_SIZE === 0) {
      await updateProgress({
        total: items.length,
        processed,
        created: summary.created,
        updated: summary.updated,
        skipped: summary.skipped,
        errorCount: summary.errors.length
      });
    }
  }

  return {
    imported: items.length,
    summary,
    tmdbPosterEnriched,
    tmdbPosterLookupMisses,
    variantsCreated,
    variantsUpdated
  };
}

async function runGenericCsvImport({ rows, userId, scopeContext, onProgress = null }) {
  const summary = { created: 0, updated: 0, skipped_invalid: 0, errors: [] };
  const auditRows = [];
  const config = await loadAdminIntegrationConfig();
  const tmdbCache = new Map();
  const updateProgress = async (progress) => {
    if (typeof onProgress !== 'function') return;
    await onProgress(progress);
  };

  await updateProgress({
    total: rows.length,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errorCount: 0
  });

  for (let idx = 0; idx < rows.length; idx += 1) {
    const row = rows[idx];
    const value = (name) => getRowValue(row, name);
    const mappedMediaType = normalizeMediaType(
      value('media_type') || value('media type') || value('type') || value('item type') || 'movie',
      'movie'
    );
    const mapped = {
      title: value('title'),
      media_type: mappedMediaType,
      original_title: value('original_title') || '',
      release_date: parseDateOnly(value('release_date')),
      year: parseYear(value('year') || value('release_date')),
      format: normalizeMediaFormat(value('format')),
      genre: value('genre'),
      director: value('director'),
      rating: value('rating') ? Number(value('rating')) : null,
      user_rating: value('user_rating') ? Number(value('user_rating')) : null,
      runtime: value('runtime') ? Number(value('runtime')) : null,
      upc: value('upc'),
      location: value('location'),
      notes: value('notes'),
      type_details: {
        author: value('author'),
        isbn: value('isbn') || value('isbn13'),
        publisher: value('publisher'),
        edition: value('edition'),
        artist: value('artist'),
        album: value('album'),
        track_count: value('track_count'),
        platform: value('platform'),
        developer: value('developer'),
        region: value('region')
      }
    };
    try {
      const enriched = await enrichImportItemWithTmdb(mapped, config, tmdbCache);
      const result = await upsertImportedMedia({
        userId,
        item: enriched,
        importSource: 'csv_generic',
        scopeContext
      });
      if (result.type === 'created') {
        summary.created += 1;
        auditRows.push({ row: idx + 2, title: mapped.title || '', status: 'created', detail: '' });
      } else if (result.type === 'updated') {
        summary.updated += 1;
        auditRows.push({ row: idx + 2, title: mapped.title || '', status: 'updated', detail: '' });
      } else {
        summary.skipped_invalid += 1;
        auditRows.push({ row: idx + 2, title: mapped.title || '', status: 'skipped_invalid', detail: result.detail || 'Invalid row' });
      }
    } catch (error) {
      summary.errors.push({ row: idx + 2, detail: error.message });
      auditRows.push({ row: idx + 2, title: mapped.title || '', status: 'error', detail: error.message });
    }

    const processed = idx + 1;
    if (processed === rows.length || processed % CSV_JOB_PROGRESS_BATCH_SIZE === 0) {
      await updateProgress({
        total: rows.length,
        processed,
        created: summary.created,
        updated: summary.updated,
        skipped: summary.skipped_invalid,
        errorCount: summary.errors.length
      });
    }
  }

  return { rows: rows.length, summary, auditRows };
}

async function runDeliciousCsvImport({ rows, userId, scopeContext, onProgress = null }) {
  const summary = {
    created: 0,
    updated: 0,
    skipped_non_movie: 0,
    skipped_invalid: 0,
    errors: []
  };
  const auditRows = [];
  const config = await loadAdminIntegrationConfig();
  const tmdbCache = new Map();
  const updateProgress = async (progress) => {
    if (typeof onProgress !== 'function') return;
    await onProgress(progress);
  };

  await updateProgress({
    total: rows.length,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errorCount: 0
  });

  for (let idx = 0; idx < rows.length; idx += 1) {
    const row = rows[idx];
    const value = (name) => getRowValue(row, name);
    const itemType = String(value('item type') || '').trim().toLowerCase();
    const mappedMediaType = mapDeliciousItemTypeToMediaType(itemType);
    if (!mappedMediaType) {
      summary.skipped_non_movie += 1;
      auditRows.push({
        row: idx + 2,
        title: String(value('title') || '').trim(),
        status: 'skipped_non_movie',
        detail: `unmapped item type: ${itemType || 'unknown'}`
      });
    } else {
      const title = String(value('title') || '').trim();
      if (!title) {
        summary.skipped_invalid += 1;
        auditRows.push({ row: idx + 2, title: '', status: 'skipped_invalid', detail: 'Missing title' });
      } else {
        const mapped = {
          title,
          media_type: mappedMediaType,
          year: parseYear(value('release date')) || parseYear(value('creation date')),
          release_date: parseDateOnly(value('release date')),
          format: normalizeMediaFormat(value('format')),
          genre: value('genres'),
          director: value('creator'),
          user_rating: value('rating') ? Number(value('rating')) : null,
          upc: value('ean') || value('isbn'),
          notes: [value('notes'), value('edition'), value('platform')].filter(Boolean).join(' | '),
          type_details: {
            author: value('creator'),
            isbn: value('isbn') || value('ean'),
            publisher: value('publisher'),
            edition: value('edition'),
            artist: value('creator'),
            album: value('title'),
            platform: value('platform'),
            developer: value('publisher'),
            region: value('region')
          }
        };

        try {
          const enriched = await enrichImportItemWithTmdb(mapped, config, tmdbCache);
          const result = await upsertImportedMedia({
            userId,
            item: enriched,
            importSource: 'csv_delicious',
            scopeContext
          });
          if (result.type === 'created') {
            summary.created += 1;
            auditRows.push({ row: idx + 2, title, status: 'created', detail: '' });
          } else if (result.type === 'updated') {
            summary.updated += 1;
            auditRows.push({ row: idx + 2, title, status: 'updated', detail: '' });
          } else {
            summary.skipped_invalid += 1;
            auditRows.push({ row: idx + 2, title, status: 'skipped_invalid', detail: result.detail || 'Invalid row' });
          }
        } catch (error) {
          summary.errors.push({ row: idx + 2, detail: error.message });
          auditRows.push({ row: idx + 2, title, status: 'error', detail: error.message });
        }
      }
    }

    const processed = idx + 1;
    if (processed === rows.length || processed % CSV_JOB_PROGRESS_BATCH_SIZE === 0) {
      await updateProgress({
        total: rows.length,
        processed,
        created: summary.created,
        updated: summary.updated,
        skipped: summary.skipped_invalid + summary.skipped_non_movie,
        errorCount: summary.errors.length
      });
    }
  }

  return { rows: rows.length, summary, auditRows };
}

// All routes require auth
router.use(authenticateToken);
router.use(enforceScopeAccess({ allowedHintRoles: ['admin'] }));

// ── List / search ─────────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const {
    format, search, page, limit,
    sortBy, sortDir,
    media_type,
    director, genre, resolution,
    yearMin, yearMax,
    ratingMin, ratingMax,
    userRatingMin, userRatingMax
  } = req.query;
  const pageNum = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1;
  const limitNum = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Number(limit))) : 50;
  const offset = (pageNum - 1) * limitNum;
  let where = 'WHERE 1=1';
  const params = [];
  const safeSortBy = SORT_COLUMNS[String(sortBy || '').toLowerCase()] || 'title';
  const safeSortDir = String(sortDir || '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const normalizedSearch = typeof search === 'string' ? search.trim() : '';
  const sortExpression = safeSortBy === 'title'
    ? `regexp_replace(lower(coalesce(title, '')), '^(the|an|a)\\s+', '', 'i') ${safeSortDir}, lower(title) ${safeSortDir}`
    : `${safeSortBy} ${safeSortDir} NULLS LAST, lower(title) ASC`;

  if (format && format !== 'all' && MEDIA_FORMATS.includes(format)) {
    params.push(format);
    where += ` AND format = $${params.length}`;
  }

  if (media_type === 'tv') {
    where += ` AND media_type IN ('tv_series', 'tv_episode')`;
  } else if (media_type && media_type !== 'all' && MEDIA_TYPES.includes(String(media_type))) {
    params.push(media_type);
    where += ` AND media_type = $${params.length}`;
  }

  if (normalizedSearch) {
    params.push(normalizedSearch);
    const tsqIdx = params.length;
    params.push(`%${normalizedSearch}%`);
    const likeIdx = params.length;
    where += ` AND (
      to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(original_title,'') || ' ' || coalesce(director,'') || ' ' || coalesce(genre,'') || ' ' || coalesce(notes,'')) @@ plainto_tsquery('simple', $${tsqIdx})
      OR title ILIKE $${likeIdx}
      OR original_title ILIKE $${likeIdx}
      OR director ILIKE $${likeIdx}
      OR genre ILIKE $${likeIdx}
      OR notes ILIKE $${likeIdx}
    )`;
  }

  if (director) {
    params.push(`%${director}%`);
    where += ` AND director ILIKE $${params.length}`;
  }

  if (genre) {
    params.push(`%${genre}%`);
    where += ` AND genre ILIKE $${params.length}`;
  }

  if (Number.isFinite(Number(yearMin))) {
    params.push(Number(yearMin));
    where += ` AND year >= $${params.length}`;
  }

  if (Number.isFinite(Number(yearMax))) {
    params.push(Number(yearMax));
    where += ` AND year <= $${params.length}`;
  }

  if (Number.isFinite(Number(ratingMin))) {
    params.push(Number(ratingMin));
    where += ` AND rating >= $${params.length}`;
  }

  if (Number.isFinite(Number(ratingMax))) {
    params.push(Number(ratingMax));
    where += ` AND rating <= $${params.length}`;
  }

  if (Number.isFinite(Number(userRatingMin))) {
    params.push(Number(userRatingMin));
    where += ` AND user_rating >= $${params.length}`;
  }

  if (Number.isFinite(Number(userRatingMax))) {
    params.push(Number(userRatingMax));
    where += ` AND user_rating <= $${params.length}`;
  }

  const normalizedResolution = normalizeResolution(resolution);
  if (normalizedResolution) {
    params.push(normalizedResolution);
    const idx = params.length;
    where += ` AND EXISTS (
      SELECT 1
      FROM media_variants mv
      WHERE mv.media_id = media.id
        AND (
          ($${idx} = '4k' AND (mv.resolution ILIKE '%4k%' OR mv.video_height >= 2000))
          OR ($${idx} = '1080' AND (mv.resolution ILIKE '%1080%' OR (mv.video_height >= 1000 AND mv.video_height < 2000)))
          OR ($${idx} = '720' AND (mv.resolution ILIKE '%720%' OR (mv.video_height >= 700 AND mv.video_height < 1000)))
          OR ($${idx} = 'sd' AND (mv.resolution ILIKE '%sd%' OR (mv.video_height > 0 AND mv.video_height < 700)))
          OR (mv.resolution ILIKE '%' || $${idx} || '%')
        )
    )`;
  }

  where += appendScopeSql(params, scopeContext);

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM media ${where}`,
    params
  );
  const total = countResult.rows[0]?.total || 0;

  params.push(limitNum);
  params.push(offset);
  const result = await pool.query(
    `SELECT * FROM media
     ${where}
     ORDER BY ${sortExpression}
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );
  const totalPages = total > 0 ? Math.ceil(total / limitNum) : 1;
  res.json({
    items: result.rows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
      hasMore: pageNum < totalPages
    }
  });
}));

router.get('/:id/variants', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return res.status(400).json({ error: 'Invalid media id' });
  }
  const mediaScopeParams = [mediaId];
  const mediaScopeClause = appendScopeSql(mediaScopeParams, scopeContext);
  const mediaResult = await pool.query(
    `SELECT id FROM media WHERE id = $1${mediaScopeClause}`,
    mediaScopeParams
  );
  if (mediaResult.rows.length === 0) {
    return res.status(404).json({ error: 'Media item not found' });
  }
  const result = await pool.query(
    `SELECT id, media_id, source, source_item_key, source_media_id, source_part_id,
            edition, file_path, container, video_codec, audio_codec, resolution,
            video_width, video_height, audio_channels, duration_ms, runtime_minutes,
            created_at, updated_at
     FROM media_variants
     WHERE media_id = $1
     ORDER BY created_at DESC`,
    [mediaId]
  );
  res.json(result.rows);
}));

router.put('/:id/tv-seasons', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return res.status(400).json({ error: 'Invalid media id' });
  }

  const rawSeasons = Array.isArray(req.body?.seasons) ? req.body.seasons : [];
  const seasons = [...new Set(
    rawSeasons
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0 && value <= 999)
  )].sort((a, b) => a - b);

  const mediaParams = [mediaId];
  const mediaScopeClause = appendScopeSql(mediaParams, scopeContext);
  const mediaResult = await pool.query(
    `SELECT id, media_type FROM media WHERE id = $1${mediaScopeClause}`,
    mediaParams
  );
  const media = mediaResult.rows[0];
  if (!media) {
    return res.status(404).json({ error: 'Media item not found' });
  }
  if (media.media_type !== 'tv_series') {
    return res.status(400).json({ error: 'TV seasons can only be set for TV series' });
  }

  const source = 'manual_tv_season';
  const expectedKeys = seasons.map((season) => `${source}:${mediaId}:${season}`);

  if (expectedKeys.length > 0) {
    await pool.query(
      `DELETE FROM media_variants
       WHERE media_id = $1
         AND source = $2
         AND source_item_key IS NOT NULL
         AND source_item_key <> ALL($3::text[])`,
      [mediaId, source, expectedKeys]
    );
  } else {
    await pool.query(
      `DELETE FROM media_variants
       WHERE media_id = $1
         AND source = $2`,
      [mediaId, source]
    );
  }

  for (const season of seasons) {
    const sourceItemKey = `${source}:${mediaId}:${season}`;
    const existing = await pool.query(
      `UPDATE media_variants
       SET edition = $1, raw_json = $2::jsonb, media_id = $3
       WHERE source = $4
         AND source_item_key = $5
       RETURNING id`,
      [`Season ${season}`, JSON.stringify({ season_number: season }), mediaId, source, sourceItemKey]
    );
    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO media_variants (
           media_id, source, source_item_key, edition, raw_json
         ) VALUES (
           $1, $2, $3, $4, $5::jsonb
         )`,
        [mediaId, source, sourceItemKey, `Season ${season}`, JSON.stringify({ season_number: season })]
      );
    }
  }

  await logActivity(req, 'media.tv_seasons.update', 'media', mediaId, {
    seasons
  });

  res.json({ ok: true, mediaId, seasons });
}));

// ── TMDB search ───────────────────────────────────────────────────────────────

router.post('/search-tmdb', asyncHandler(async (req, res) => {
  await assertFeatureEnabled('tmdb_search_enabled');
  const { title, year, mediaType } = req.body;
  if (!title?.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const config = await loadAdminIntegrationConfig();
  const normalizedType = mediaType === 'tv' ? 'tv' : 'movie';
  const results = await searchTmdbMovie(title, year, config, normalizedType);
  res.json(results);
}));

router.get('/tmdb/:id/details', asyncHandler(async (req, res) => {
  await assertFeatureEnabled('tmdb_search_enabled');
  const movieId = Number(req.params.id);
  if (!Number.isFinite(movieId) || movieId <= 0) {
    return res.status(400).json({ error: 'Valid numeric TMDB id is required' });
  }
  const config = await loadAdminIntegrationConfig();
  const normalizedType = req.query.mediaType === 'tv' ? 'tv' : 'movie';
  const details = await fetchTmdbMovieDetails(movieId, config, normalizedType);
  res.json(details);
}));

router.post('/enrich/book/search', asyncHandler(async (req, res) => {
  const { title, author } = req.body || {};
  if (!String(title || '').trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const config = await loadAdminIntegrationConfig();
  const matches = await searchBooksByTitle(String(title).trim(), config, 10, String(author || '').trim());
  res.json({ provider: config.booksProvider || 'googlebooks', matches });
}));

router.post('/enrich/audio/search', asyncHandler(async (req, res) => {
  const { title, artist } = req.body || {};
  if (!String(title || '').trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const config = await loadAdminIntegrationConfig();
  const matches = await searchAudioByTitle(String(title).trim(), config, 10, String(artist || '').trim());
  res.json({ provider: config.audioProvider || 'discogs', matches });
}));

router.post('/enrich/game/search', asyncHandler(async (req, res) => {
  const { title } = req.body || {};
  if (!String(title || '').trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const config = await loadAdminIntegrationConfig();
  const matches = await searchGamesByTitle(String(title).trim(), config, 10);
  res.json({ provider: config.gamesProvider || 'igdb', matches });
}));

// ── UPC lookup ────────────────────────────────────────────────────────────────

router.post('/lookup-upc', asyncHandler(async (req, res) => {
  await assertFeatureEnabled('lookup_upc_enabled');
  const { upc } = req.body;
  if (!upc || !String(upc).trim()) {
    return res.status(400).json({ error: 'UPC is required' });
  }

  const config = await loadAdminIntegrationConfig();
  const { barcodeProvider, barcodeApiUrl, barcodeQueryParam, barcodeApiKey, barcodeApiKeyHeader } = config;

  if (!barcodeApiUrl) {
    return res.status(400).json({ error: 'Barcode API URL is not configured', provider: barcodeProvider });
  }

  const headers = {};
  if (barcodeApiKey) headers[barcodeApiKeyHeader] = barcodeApiKey;

  const barcodeResponse = await axios.get(barcodeApiUrl, {
    params: { [barcodeQueryParam]: String(upc).trim() },
    headers,
    timeout: 15000
  });

  const barcodeMatches = normalizeBarcodeMatches(barcodeResponse.data);
  const enrichedMatches = [];

  for (const match of barcodeMatches.slice(0, 6)) {
    let tmdb = null;
    if (match.title) {
      try {
        const tmdbResults = await searchTmdbMovie(match.title, undefined, config);
        tmdb = tmdbResults[0] || null;
      } catch (_) {
        // TMDB enrichment failure is non-fatal
      }
    }
    enrichedMatches.push({ ...match, tmdb });
  }

  res.json({ provider: barcodeProvider, upc: String(upc).trim(), matches: enrichedMatches });
}));

// ── Cover recognition ─────────────────────────────────────────────────────────

router.post('/recognize-cover', tempUpload.single('cover'), asyncHandler(async (req, res) => {
  await assertFeatureEnabled('recognize_cover_enabled');
  if (!req.file) {
    return res.status(400).json({ error: 'Cover image file is required' });
  }

  try {
    const config = await loadAdminIntegrationConfig();
    const { visionProvider, visionApiUrl, visionApiKey, visionApiKeyHeader } = config;

    if (!visionApiUrl) {
      return res.status(400).json({ error: 'Vision API URL is not configured', provider: visionProvider });
    }
    if (visionProvider === 'ocrspace' && !visionApiKey) {
      return res.status(400).json({ error: 'Vision API key is required for ocrspace', provider: visionProvider });
    }

    const body = new FormData();
    body.append('file', fs.createReadStream(req.file.path));
    body.append('language', 'eng');
    body.append('isOverlayRequired', 'false');

    const headers = { ...body.getHeaders() };
    if (visionApiKey) headers[visionApiKeyHeader] = visionApiKey;

    const visionResponse = await axios.post(visionApiUrl, body, { headers, timeout: 25000 });
    const extractedText = extractVisionText(visionResponse.data);
    const titleCandidates = extractTitleCandidates(extractedText);
    const tmdbMatches = [];
    const seenTmdbIds = new Set();

    for (const candidate of titleCandidates.slice(0, 6)) {
      try {
        const results = await searchTmdbMovie(candidate, undefined, config);
        if (results[0] && !seenTmdbIds.has(results[0].id)) {
          seenTmdbIds.add(results[0].id);
          tmdbMatches.push(results[0]);
        }
      } catch (_) {
        // Non-fatal
      }
    }

    res.json({ provider: visionProvider, extractedText: extractedText.slice(0, 2000), titleCandidates, tmdbMatches });
  } finally {
    if (req.file?.path) {
      fs.promises.unlink(req.file.path).catch(() => {});
    }
  }
}));

// ── Cover upload ──────────────────────────────────────────────────────────────

router.post('/upload-cover', memoryUpload.single('cover'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  if (!ALLOWED_COVER_MIME_TYPES.has(String(req.file.mimetype || '').toLowerCase())) {
    return res.status(400).json({ error: 'Unsupported file type. Allowed: JPEG, PNG, WEBP, GIF.' });
  }
  const stored = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
  res.json({ path: stored.url, provider: stored.provider });
}));

// ── CSV import ────────────────────────────────────────────────────────────────

router.get('/import/template-csv', asyncHandler(async (_req, res) => {
  const template = [
    'title,media_type,year,format,director,genre,rating,user_rating,runtime,upc,location,notes',
    '"The Matrix","movie",1999,"Blu-ray","Lana Wachowski, Lilly Wachowski","Science Fiction",8.7,4.5,136,085391163545,"Living Room","Example row"'
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="collectz-template.csv"');
  res.send(template);
}));

router.post('/import-csv', tempUpload.single('file'), asyncHandler(async (req, res) => {
  await assertFeatureEnabled('import_csv_enabled');
  const scopeContext = resolveScopeContext(req);
  if (!req.file) {
    return res.status(400).json({ error: 'CSV file is required (multipart field: file)' });
  }
  let text = '';
  try {
    text = await fs.promises.readFile(req.file.path, 'utf8');
  } finally {
    await fs.promises.unlink(req.file.path).catch(() => {});
  }

  let parsed;
  try {
    parsed = parseCsvText(text);
  } catch (error) {
    return res.status(400).json({ error: `Invalid CSV format: ${error.message}` });
  }
  const { headers, rows } = parsed;
  if (headers.length === 0) {
    return res.status(400).json({ error: 'CSV is empty' });
  }
  const canonical = headers.map((h) => String(h).trim().toLowerCase());
  if (!canonical.includes('title')) {
    return res.status(400).json({ error: 'CSV must include a title column' });
  }
  const asyncMode = parseAsyncFlag(req.query?.async) || parseAsyncFlag(req.body?.async);
  const auditReq = {
    user: req.user,
    headers: req.headers,
    ip: req.ip,
    socket: req.socket
  };

  if (asyncMode) {
    const job = await createSyncJob({
      userId: req.user.id,
      jobType: 'media_import',
      provider: 'csv_generic',
      scope: jobScopePayload(scopeContext),
      progress: {
        total: rows.length,
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errorCount: 0
      }
    });

    setImmediate(async () => {
      try {
        await updateSyncJob(job.id, { status: 'running', started_at: new Date() });
        const result = await runGenericCsvImport({
          rows,
          userId: req.user.id,
          scopeContext,
          onProgress: async (progress) => updateSyncJob(job.id, { progress })
        });
        await updateSyncJob(job.id, {
          status: 'succeeded',
          progress: {
            total: result.rows,
            processed: result.rows,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped: result.summary.skipped_invalid,
            errorCount: result.summary.errors.length
          },
          summary: {
            rows: result.rows,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped_invalid: result.summary.skipped_invalid,
            errorCount: result.summary.errors.length
          },
          finished_at: new Date()
        });
        await logActivity(auditReq, 'media.import.csv', 'media', null, {
          rows: result.rows,
          created: result.summary.created,
          updated: result.summary.updated,
          skipped_invalid: result.summary.skipped_invalid,
          errorCount: result.summary.errors.length,
          jobId: job.id
        });
      } catch (error) {
        await updateSyncJob(job.id, {
          status: 'failed',
          error: error.message || 'CSV import failed',
          finished_at: new Date()
        });
        await logActivity(auditReq, 'media.import.csv.failed', 'media', null, {
          detail: error.message || 'CSV import failed',
          jobId: job.id
        });
      }
    });

    return res.status(202).json({
      ok: true,
      queued: true,
      job: {
        id: job.id,
        status: job.status,
        provider: job.provider,
        progress: job.progress
      }
    });
  }

  const result = await runGenericCsvImport({
    rows,
    userId: req.user.id,
    scopeContext
  });
  await logActivity(req, 'media.import.csv', 'media', null, {
    rows: result.rows,
    created: result.summary.created,
    updated: result.summary.updated,
    skipped_invalid: result.summary.skipped_invalid,
    errorCount: result.summary.errors.length
  });
  res.json({ ok: true, rows: result.rows, summary: result.summary, auditRows: result.auditRows });
}));

router.post('/import-csv/delicious', tempUpload.single('file'), asyncHandler(async (req, res) => {
  await assertFeatureEnabled('import_csv_enabled');
  const scopeContext = resolveScopeContext(req);
  if (!req.file) {
    return res.status(400).json({ error: 'Delicious CSV file is required (multipart field: file)' });
  }
  let text = '';
  try {
    text = await fs.promises.readFile(req.file.path, 'utf8');
  } finally {
    await fs.promises.unlink(req.file.path).catch(() => {});
  }

  let parsed;
  try {
    parsed = parseCsvText(text);
  } catch (error) {
    return res.status(400).json({ error: `Invalid CSV format: ${error.message}` });
  }
  const { rows } = parsed;
  const asyncMode = parseAsyncFlag(req.query?.async) || parseAsyncFlag(req.body?.async);
  const auditReq = {
    user: req.user,
    headers: req.headers,
    ip: req.ip,
    socket: req.socket
  };

  if (asyncMode) {
    const job = await createSyncJob({
      userId: req.user.id,
      jobType: 'media_import',
      provider: 'csv_delicious',
      scope: jobScopePayload(scopeContext),
      progress: {
        total: rows.length,
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errorCount: 0
      }
    });

    setImmediate(async () => {
      try {
        await updateSyncJob(job.id, { status: 'running', started_at: new Date() });
        const result = await runDeliciousCsvImport({
          rows,
          userId: req.user.id,
          scopeContext,
          onProgress: async (progress) => updateSyncJob(job.id, { progress })
        });
        await updateSyncJob(job.id, {
          status: 'succeeded',
          progress: {
            total: result.rows,
            processed: result.rows,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped: result.summary.skipped_invalid + result.summary.skipped_non_movie,
            errorCount: result.summary.errors.length
          },
          summary: {
            rows: result.rows,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped_non_movie: result.summary.skipped_non_movie,
            skipped_invalid: result.summary.skipped_invalid,
            errorCount: result.summary.errors.length
          },
          finished_at: new Date()
        });
        await logActivity(auditReq, 'media.import.csv.delicious', 'media', null, {
          rows: result.rows,
          created: result.summary.created,
          updated: result.summary.updated,
          skipped_non_movie: result.summary.skipped_non_movie,
          skipped_invalid: result.summary.skipped_invalid,
          errorCount: result.summary.errors.length,
          jobId: job.id
        });
      } catch (error) {
        await updateSyncJob(job.id, {
          status: 'failed',
          error: error.message || 'Delicious CSV import failed',
          finished_at: new Date()
        });
        await logActivity(auditReq, 'media.import.csv.delicious.failed', 'media', null, {
          detail: error.message || 'Delicious CSV import failed',
          jobId: job.id
        });
      }
    });

    return res.status(202).json({
      ok: true,
      queued: true,
      job: {
        id: job.id,
        status: job.status,
        provider: job.provider,
        progress: job.progress
      }
    });
  }

  const result = await runDeliciousCsvImport({
    rows,
    userId: req.user.id,
    scopeContext
  });
  await logActivity(req, 'media.import.csv.delicious', 'media', null, {
    rows: result.rows,
    created: result.summary.created,
    updated: result.summary.updated,
    skipped_non_movie: result.summary.skipped_non_movie,
    skipped_invalid: result.summary.skipped_invalid,
    errorCount: result.summary.errors.length
  });
  res.json({ ok: true, rows: result.rows, summary: result.summary, auditRows: result.auditRows });
}));

// ── Plex import (admin only) ─────────────────────────────────────────────────

router.post('/import-plex', asyncHandler(async (req, res) => {
  await assertFeatureEnabled('import_plex_enabled');
  const scopeContext = resolveScopeContext(req);
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can import from Plex' });
  }

  const sectionIds = Array.isArray(req.body?.sectionIds) ? req.body.sectionIds : [];
  const config = await loadAdminIntegrationConfig();
  if (!config.plexApiUrl) {
    return res.status(400).json({ error: 'Plex API URL is not configured' });
  }
  if (!config.plexApiKey) {
    return res.status(400).json({ error: 'Plex API key is not configured' });
  }
  const asyncMode = parseAsyncFlag(req.query?.async) || parseAsyncFlag(req.body?.async);
  const auditReq = {
    user: req.user,
    headers: req.headers,
    ip: req.ip,
    socket: req.socket
  };

  if (asyncMode) {
    const job = await createSyncJob({
      userId: req.user.id,
      jobType: 'media_import',
      provider: 'plex',
      scope: jobScopePayload(scopeContext, sectionIds),
      progress: {
        total: 0,
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errorCount: 0
      }
    });

    setImmediate(async () => {
      try {
        await updateSyncJob(job.id, {
          status: 'running',
          started_at: new Date()
        });
        const result = await runPlexImport({
          req: auditReq,
          config,
          sectionIds,
          scopeContext,
          onProgress: async (progress) => {
            await updateSyncJob(job.id, { progress });
          }
        });

        await updateSyncJob(job.id, {
          status: 'succeeded',
          summary: {
            imported: result.imported,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped: result.summary.skipped,
            errorCount: result.summary.errors.length,
            tmdbPosterEnriched: result.tmdbPosterEnriched,
            tmdbPosterLookupMisses: result.tmdbPosterLookupMisses,
            variantsCreated: result.variantsCreated,
            variantsUpdated: result.variantsUpdated,
            enrichmentErrors: result.summary.enrichmentErrors || []
          },
          progress: {
            total: result.imported,
            processed: result.imported,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped: result.summary.skipped,
            errorCount: result.summary.errors.length
          },
          finished_at: new Date()
        });

        await logActivity(auditReq, 'media.import.plex', 'media', null, {
          sectionIds,
          imported: result.imported,
          created: result.summary.created,
          updated: result.summary.updated,
          skipped: result.summary.skipped,
          errorCount: result.summary.errors.length,
          tmdbPosterEnriched: result.tmdbPosterEnriched,
          tmdbPosterLookupMisses: result.tmdbPosterLookupMisses,
          variantsCreated: result.variantsCreated,
          variantsUpdated: result.variantsUpdated,
          enrichmentErrorCount: (result.summary.enrichmentErrors || []).length,
          jobId: job.id
        });
      } catch (error) {
        logError('Plex async import failed', error);
        await updateSyncJob(job.id, {
          status: 'failed',
          error: error.message || 'Plex import failed',
          finished_at: new Date()
        });
        await logActivity(auditReq, 'media.import.plex.failed', 'media', null, {
          sectionIds,
          detail: error.message || 'Plex import failed',
          jobId: job.id
        });
      }
    });

    return res.status(202).json({
      ok: true,
      queued: true,
      job: {
        id: job.id,
        status: job.status,
        provider: job.provider,
        progress: job.progress
      }
    });
  }

  try {
    const result = await runPlexImport({
      req,
      config,
      sectionIds,
      scopeContext
    });

    await logActivity(req, 'media.import.plex', 'media', null, {
      sectionIds,
      imported: result.imported,
      created: result.summary.created,
      updated: result.summary.updated,
      skipped: result.summary.skipped,
      errorCount: result.summary.errors.length,
      tmdbPosterEnriched: result.tmdbPosterEnriched,
      tmdbPosterLookupMisses: result.tmdbPosterLookupMisses,
      variantsCreated: result.variantsCreated,
      variantsUpdated: result.variantsUpdated,
      enrichmentErrorCount: (result.summary.enrichmentErrors || []).length
    });

    return res.json({ ok: true, ...result });
  } catch (error) {
    logError('Plex import fetch failed', error);
    await logActivity(req, 'media.import.plex.failed', 'media', null, {
      sectionIds,
      detail: error.message || 'Plex import failed'
    });
    return res.status(502).json({ error: error.message || 'Plex import failed' });
  }
}));

router.get('/sync-jobs', asyncHandler(async (req, res) => {
  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
  const params = [limit];
  let where = '';
  if (req.user.role !== 'admin') {
    params.push(req.user.id);
    where = `WHERE created_by = $${params.length}`;
  } else if (Number.isFinite(Number(req.query?.created_by))) {
    params.push(Number(req.query.created_by));
    where = `WHERE created_by = $${params.length}`;
  }

  const result = await pool.query(
    `SELECT id, job_type, provider, status, created_by, scope, progress, summary, error,
            started_at, finished_at, created_at, updated_at
     FROM sync_jobs
     ${where}
     ORDER BY created_at DESC
     LIMIT $1`,
    params
  );
  res.json(result.rows);
}));

router.get('/sync-jobs/:id', asyncHandler(async (req, res) => {
  const jobId = Number(req.params.id);
  if (!Number.isFinite(jobId) || jobId <= 0) {
    return res.status(400).json({ error: 'Invalid job id' });
  }
  const job = await getSyncJob(jobId, req.user);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
}));

// ── Create ────────────────────────────────────────────────────────────────────

router.post('/', validate(mediaCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const {
    title, media_type, original_title, release_date, year, format, genre, director, rating,
    user_rating, tmdb_id, tmdb_media_type, tmdb_url, poster_path, backdrop_path, overview,
    trailer_url, runtime, upc, location, notes, import_source,
    season_number, episode_number, episode_title, network, type_details, library_id
    , space_id
  } = req.body;
  const normalizedMediaType = normalizeMediaType(media_type || 'movie', 'movie');
  const normalizedTypeDetails = sanitizeTypeDetails(normalizedMediaType, type_details);
  const fieldValidationError = validateTypeSpecificFields(normalizedMediaType, req.body);
  if (fieldValidationError) {
    return res.status(400).json({ error: fieldValidationError });
  }

  const result = await pool.query(
    `INSERT INTO media (
       title, media_type, original_title, release_date, year, format, genre, director, rating,
       user_rating, tmdb_id, tmdb_media_type, tmdb_url, poster_path, backdrop_path, overview,
       trailer_url, runtime, upc, location, notes, season_number, episode_number, episode_title, network,
       type_details, library_id, space_id, added_by, import_source
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb,$27,$28,$29,$30
     ) RETURNING *`,
    [
      title, normalizedMediaType, original_title || null, release_date || null, year || null, format || null,
      genre || null, director || null, rating || null, user_rating || null,
      tmdb_id || null, tmdb_media_type || null, tmdb_url || null, poster_path || null, backdrop_path || null,
      overview || null, trailer_url || null, runtime || null, upc || null,
      location || null, notes || null, season_number || null, episode_number || null,
      episode_title || null, network || null, normalizedTypeDetails ? JSON.stringify(normalizedTypeDetails) : null,
      library_id || scopeContext.libraryId || null,
      space_id || scopeContext.spaceId || null,
      req.user.id, import_source || 'manual'
    ]
  );
  res.status(201).json(result.rows[0]);
}));

// ── Update ─────────────────────────────────────────────────────────────────────
// Ownership enforcement: users may only edit their own media; admins are unrestricted.

router.patch('/:id', validate(mediaUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const { id } = req.params;

  const ALLOWED_FIELDS = [
    'title', 'media_type', 'original_title', 'release_date', 'year', 'format', 'genre', 'director',
    'rating', 'user_rating', 'tmdb_id', 'tmdb_media_type', 'tmdb_url', 'poster_path', 'backdrop_path',
    'overview', 'trailer_url', 'runtime', 'upc', 'location', 'notes', 'season_number',
    'episode_number', 'episode_title', 'network', 'type_details', 'library_id', 'space_id'
  ];

  const fields = Object.fromEntries(
    Object.entries(req.body).filter(([key]) => ALLOWED_FIELDS.includes(key))
  );
  const keys = Object.keys(fields);
  if (keys.length === 0) {
    return res.status(400).json({ error: 'No valid fields provided for update' });
  }

  const touchesTypeSpecific = ['season_number', 'episode_number', 'episode_title', 'network']
    .some((key) => Object.prototype.hasOwnProperty.call(fields, key));
  let effectiveMediaType = null;
  if (fields.media_type) {
    effectiveMediaType = normalizeMediaType(fields.media_type, 'movie');
    fields.media_type = effectiveMediaType;
  } else if (touchesTypeSpecific) {
    const mediaTypeParams = [id];
    const mediaTypeScopeClause = appendScopeSql(mediaTypeParams, scopeContext);
    const currentTypeResult = await pool.query(
      `SELECT media_type FROM media WHERE id = $1${mediaTypeScopeClause} LIMIT 1`,
      mediaTypeParams
    );
    effectiveMediaType = normalizeMediaType(currentTypeResult.rows[0]?.media_type || 'movie', 'movie');
  }
  const fieldValidationError = validateTypeSpecificFields(effectiveMediaType || 'movie', fields);
  if (fieldValidationError) {
    return res.status(400).json({ error: fieldValidationError });
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'type_details')) {
    const detailType = effectiveMediaType || 'movie';
    fields.type_details = sanitizeTypeDetails(detailType, fields.type_details);
  }

  const normalizedValues = keys.map((key) => fields[key]);

  const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');
  const updateParams = [...normalizedValues, id];
  let ownerClause = '';
  if (req.user.role !== 'admin') {
    updateParams.push(req.user.id);
    ownerClause = ` AND added_by = $${updateParams.length}`;
  }
  const updateScopeClause = appendScopeSql(updateParams, scopeContext);
  const result = await pool.query(
    `UPDATE media
     SET ${setClause}
     WHERE id = $${keys.length + 1}${ownerClause}${updateScopeClause}
     RETURNING *`,
    updateParams
  );
  if (result.rows.length === 0) {
    const existsParams = [id];
    const existsScopeClause = appendScopeSql(existsParams, scopeContext);
    const exists = await pool.query(`SELECT id FROM media WHERE id = $1${existsScopeClause}`, existsParams);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'Media item not found' });
    }
    return res.status(403).json({ error: 'You do not have permission to edit this item' });
  }
  res.json(result.rows[0]);
}));

// ── Delete ────────────────────────────────────────────────────────────────────
// Ownership enforcement: users may only delete their own media; admins are unrestricted.

router.delete('/:id', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const { id } = req.params;

  const existingParams = [id];
  const existingScopeClause = appendScopeSql(existingParams, scopeContext);
  const existing = await pool.query(`SELECT id, added_by FROM media WHERE id = $1${existingScopeClause}`, existingParams);
  if (existing.rows.length === 0) {
    return res.status(404).json({ error: 'Media item not found' });
  }
  if (req.user.role !== 'admin' && existing.rows[0].added_by !== req.user.id) {
    return res.status(403).json({ error: 'You do not have permission to delete this item' });
  }

  const deleteParams = [id];
  const deleteScopeClause = appendScopeSql(deleteParams, scopeContext);
  await pool.query(`DELETE FROM media WHERE id = $1${deleteScopeClause}`, deleteParams);
  res.json({ message: 'Media deleted' });
}));

module.exports = router;
