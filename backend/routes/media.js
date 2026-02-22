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
const { logError, logActivity } = require('../services/audit');
const { uploadBuffer } = require('../services/storage');

const router = express.Router();

const tempDiskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, 'uploads/'),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const tempUpload = multer({ storage: tempDiskStorage, limits: { fileSize: 10 * 1024 * 1024 } });
const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const MEDIA_FORMATS = ['VHS', 'Blu-ray', 'Digital', 'DVD', '4K UHD'];
const SORT_COLUMNS = {
  title: 'title',
  year: 'year',
  format: 'format',
  created_at: 'created_at',
  user_rating: 'user_rating',
  rating: 'rating'
};

function normalizeResolution(value) {
  if (!value || value === 'all') return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '4k') return '4k';
  if (normalized === '1080p') return '1080';
  if (normalized === '720p') return '720';
  if (normalized === 'sd') return 'sd';
  return normalized;
}

function parseCsvLine(line = '') {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

function parseCsv(text = '') {
  const lines = String(text)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((h, idx) => { row[h] = cols[idx] ?? ''; });
    return row;
  });
  return { headers, rows };
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
  return MEDIA_FORMATS.includes(formatValue) ? formatValue : 'Digital';
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

async function enrichImportItemWithTmdb(item, config, cache) {
  if (!config?.tmdbApiKey || !item?.title) return item;

  const cacheKey = item.tmdb_id
    ? `id:${item.tmdb_id}`
    : `q:${String(item.title).toLowerCase()}|${item.year || ''}`;
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
      const results = await searchTmdbMovie(item.title, item.year || undefined, config);
      candidate = results?.[0] || null;
    }
    if (!candidate?.id) {
      cache.set(cacheKey, {});
      return item;
    }

    const details = await fetchTmdbMovieDetails(candidate.id, config);
    const enriched = {
      tmdb_id: candidate.id,
      tmdb_url: details?.tmdb_url || `https://www.themoviedb.org/movie/${candidate.id}`,
      poster_path: details?.poster_path || candidate?.poster_path || null,
      backdrop_path: details?.backdrop_path || candidate?.backdrop_path || null,
      overview: details?.overview || candidate?.overview || null,
      rating: details?.rating ?? candidate?.rating ?? candidate?.vote_average ?? null,
      runtime: details?.runtime || item.runtime || null,
      director: details?.director || item.director || null,
      trailer_url: details?.trailer_url || item.trailer_url || null,
      release_date: details?.release_date || item.release_date || null,
      year: item.year || parseYear(details?.release_date),
      original_title: item.original_title || candidate?.original_title || null
    };
    cache.set(cacheKey, enriched);
    return { ...item, ...enriched, format: item.format || 'Digital' };
  } catch (_error) {
    cache.set(cacheKey, {});
    return item;
  }
}

async function upsertImportedMedia({ userId, item, importSource }) {
  const title = String(item.title || '').trim();
  if (!title) {
    return { type: 'invalid', detail: 'Missing title' };
  }
  const year = item.year ?? null;
  const existing = await pool.query(
    `SELECT id
     FROM media
     WHERE LOWER(TRIM(title)) = LOWER(TRIM($1))
       AND (($2::int IS NOT NULL AND year = $2::int) OR ($2::int IS NULL))
     ORDER BY created_at DESC
     LIMIT 1`,
    [title, year]
  );
  if (existing.rows[0]) {
    await pool.query(
      `UPDATE media SET
         original_title = COALESCE($1, original_title),
         release_date = COALESCE($2, release_date),
         year = COALESCE($3, year),
         format = COALESCE($4, format),
         genre = COALESCE($5, genre),
         director = COALESCE($6, director),
         rating = COALESCE($7, rating),
         user_rating = COALESCE($8, user_rating),
         tmdb_id = COALESCE($9, tmdb_id),
         tmdb_url = COALESCE($10, tmdb_url),
         poster_path = COALESCE($11, poster_path),
         backdrop_path = COALESCE($12, backdrop_path),
         overview = COALESCE($13, overview),
         trailer_url = COALESCE($14, trailer_url),
         runtime = COALESCE($15, runtime),
         upc = COALESCE($16, upc),
         location = COALESCE($17, location),
         notes = COALESCE($18, notes),
         import_source = COALESCE($19, import_source)
       WHERE id = $20`,
      [
        item.original_title || null,
        item.release_date || null,
        item.year || null,
        item.format || null,
        item.genre || null,
        item.director || null,
        item.rating || null,
        item.user_rating || null,
        item.tmdb_id || null,
        item.tmdb_url || null,
        item.poster_path || null,
        item.backdrop_path || null,
        item.overview || null,
        item.trailer_url || null,
        item.runtime || null,
        item.upc || null,
        item.location || null,
        item.notes || null,
        importSource || null,
        existing.rows[0].id
      ]
    );
    return { type: 'updated' };
  }

  await pool.query(
    `INSERT INTO media (
       title, original_title, release_date, year, format, genre, director,
       rating, user_rating, tmdb_id, tmdb_url, poster_path, backdrop_path, overview, trailer_url,
       runtime, upc, location, notes, added_by, import_source
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
     )`,
    [
      title,
      item.original_title || null,
      item.release_date || null,
      item.year || null,
      item.format || 'Digital',
      item.genre || null,
      item.director || null,
      item.rating || null,
      item.user_rating || null,
      item.tmdb_id || null,
      item.tmdb_url || null,
      item.poster_path || null,
      item.backdrop_path || null,
      item.overview || null,
      item.trailer_url || null,
      item.runtime || null,
      item.upc || null,
      item.location || null,
      item.notes || null,
      userId,
      importSource || null
    ]
  );
  return { type: 'created' };
}

// All routes require auth
router.use(authenticateToken);

// ── List / search ─────────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (req, res) => {
  const {
    format, search, page, limit,
    sortBy, sortDir,
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
  const sortExpression = safeSortBy === 'title'
    ? `regexp_replace(lower(coalesce(title, '')), '^(the|an|a)\\s+', '', 'i') ${safeSortDir}, lower(title) ${safeSortDir}`
    : `${safeSortBy} ${safeSortDir} NULLS LAST`;

  if (format && format !== 'all' && MEDIA_FORMATS.includes(format)) {
    params.push(format);
    where += ` AND format = $${params.length}`;
  }

  if (search) {
    params.push(`%${search}%`);
    where += ` AND (title ILIKE $${params.length} OR director ILIKE $${params.length} OR genre ILIKE $${params.length})`;
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
  const mediaId = Number(req.params.id);
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return res.status(400).json({ error: 'Invalid media id' });
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

// ── TMDB search ───────────────────────────────────────────────────────────────

router.post('/search-tmdb', asyncHandler(async (req, res) => {
  const { title, year } = req.body;
  if (!title?.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const config = await loadAdminIntegrationConfig();
  const results = await searchTmdbMovie(title, year, config);
  res.json(results);
}));

router.get('/tmdb/:id/details', asyncHandler(async (req, res) => {
  const movieId = Number(req.params.id);
  if (!Number.isFinite(movieId) || movieId <= 0) {
    return res.status(400).json({ error: 'Valid numeric TMDB id is required' });
  }
  const config = await loadAdminIntegrationConfig();
  const details = await fetchTmdbMovieDetails(movieId, config);
  res.json(details);
}));

// ── UPC lookup ────────────────────────────────────────────────────────────────

router.post('/lookup-upc', asyncHandler(async (req, res) => {
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
  const stored = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
  res.json({ path: stored.url, provider: stored.provider });
}));

// ── CSV import ────────────────────────────────────────────────────────────────

router.get('/import/template-csv', asyncHandler(async (_req, res) => {
  const template = [
    'title,year,format,director,genre,rating,user_rating,runtime,upc,location,notes',
    '"The Matrix",1999,"Blu-ray","Lana Wachowski, Lilly Wachowski","Science Fiction",8.7,4.5,136,085391163545,"Living Room","Example row"'
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="collectz-template.csv"');
  res.send(template);
}));

router.post('/import-csv', tempUpload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'CSV file is required (multipart field: file)' });
  }
  let text = '';
  try {
    text = await fs.promises.readFile(req.file.path, 'utf8');
  } finally {
    await fs.promises.unlink(req.file.path).catch(() => {});
  }

  const { headers, rows } = parseCsv(text);
  if (headers.length === 0) {
    return res.status(400).json({ error: 'CSV is empty' });
  }
  const canonical = headers.map((h) => String(h).trim().toLowerCase());
  if (!canonical.includes('title')) {
    return res.status(400).json({ error: 'CSV must include a title column' });
  }

  const summary = { created: 0, updated: 0, skipped_invalid: 0, errors: [] };
  const auditRows = [];
  const config = await loadAdminIntegrationConfig();
  const tmdbCache = new Map();
  for (let idx = 0; idx < rows.length; idx += 1) {
    const row = rows[idx];
    const value = (name) => {
      const key = Object.keys(row).find((k) => String(k).trim().toLowerCase() === name);
      return key ? row[key] : '';
    };
    const mapped = {
      title: value('title'),
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
      notes: value('notes')
    };
    try {
      const enriched = await enrichImportItemWithTmdb(mapped, config, tmdbCache);
      const result = await upsertImportedMedia({
        userId: req.user.id,
        item: enriched,
        importSource: 'csv_generic'
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
  }

  await logActivity(req, 'media.import.csv', 'media', null, {
    created: summary.created,
    updated: summary.updated,
    skipped_invalid: summary.skipped_invalid,
    errorCount: summary.errors.length
  });

  res.json({ ok: true, rows: rows.length, summary, auditRows });
}));

router.post('/import-csv/delicious', tempUpload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Delicious CSV file is required (multipart field: file)' });
  }
  let text = '';
  try {
    text = await fs.promises.readFile(req.file.path, 'utf8');
  } finally {
    await fs.promises.unlink(req.file.path).catch(() => {});
  }

  const { rows } = parseCsv(text);
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

  for (let idx = 0; idx < rows.length; idx += 1) {
    const row = rows[idx];
    const value = (name) => {
      const key = Object.keys(row).find((k) => String(k).trim().toLowerCase() === name);
      return key ? row[key] : '';
    };
    const itemType = String(value('item type') || '').trim().toLowerCase();
    if (itemType && itemType !== 'movie') {
      summary.skipped_non_movie += 1;
      auditRows.push({
        row: idx + 2,
        title: String(value('title') || '').trim(),
        status: 'skipped_non_movie',
        detail: `item type: ${itemType || 'unknown'}`
      });
      continue;
    }

    const title = String(value('title') || '').trim();
    if (!title) {
      summary.skipped_invalid += 1;
      auditRows.push({ row: idx + 2, title: '', status: 'skipped_invalid', detail: 'Missing title' });
      continue;
    }

    const mapped = {
      title,
      year: parseYear(value('release date')) || parseYear(value('creation date')),
      release_date: parseDateOnly(value('release date')),
      format: normalizeMediaFormat(value('format')),
      genre: value('genres'),
      director: value('creator'),
      user_rating: value('rating') ? Number(value('rating')) : null,
      upc: value('ean') || value('isbn'),
      notes: [value('notes'), value('edition'), value('platform')].filter(Boolean).join(' | ')
    };

    try {
      const enriched = await enrichImportItemWithTmdb(mapped, config, tmdbCache);
      const result = await upsertImportedMedia({
        userId: req.user.id,
        item: enriched,
        importSource: 'csv_delicious'
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

  await logActivity(req, 'media.import.csv.delicious', 'media', null, {
    created: summary.created,
    updated: summary.updated,
    skipped_non_movie: summary.skipped_non_movie,
    skipped_invalid: summary.skipped_invalid,
    errorCount: summary.errors.length
  });

  res.json({ ok: true, rows: rows.length, summary, auditRows });
}));

// ── Plex import (admin only) ─────────────────────────────────────────────────

router.post('/import-plex', asyncHandler(async (req, res) => {
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

  const summary = { created: 0, updated: 0, skipped: 0, errors: [] };
  let tmdbPosterEnriched = 0;
  let tmdbPosterLookupMisses = 0;
  let variantsCreated = 0;
  let variantsUpdated = 0;
  let items = [];
  const tmdbEnrichmentCache = new Map();
  const upsertMediaMetadata = async (mediaId, key, value) => {
    if (!value) return;
    await pool.query(
      `INSERT INTO media_metadata (media_id, "key", "value")
       SELECT $1::int, $2::varchar, $3::text
       WHERE NOT EXISTS (
         SELECT 1
         FROM media_metadata
         WHERE media_id = $1::int
           AND "key" = $2::varchar
           AND "value" = $3::text
       )`,
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
  try {
    items = await fetchPlexLibraryItems(config, sectionIds);
  } catch (error) {
    logError('Plex import fetch failed', error);
    await logActivity(req, 'media.import.plex.failed', 'media', null, {
      sectionIds,
      detail: error.message || 'Plex import fetch failed'
    });
    return res.status(502).json({ error: error.message || 'Plex import fetch failed' });
  }

  for (const item of items) {
    const media = { ...item.normalized };
    if (!media.title) {
      summary.skipped += 1;
      continue;
    }

    if (!media.poster_path && config.tmdbApiKey) {
      const cacheKey = media.tmdb_id
        ? `id:${media.tmdb_id}`
        : `q:${String(media.title || '').toLowerCase()}|${media.year || ''}`;
      let cached = tmdbEnrichmentCache.get(cacheKey);
      if (cached === undefined) {
        cached = null;
        try {
          if (media.tmdb_id) {
            const details = await fetchTmdbMovieDetails(media.tmdb_id, config);
            cached = {
              tmdb_id: media.tmdb_id,
              tmdb_url: details?.tmdb_url || `https://www.themoviedb.org/movie/${media.tmdb_id}`,
              poster_path: details?.poster_path || null,
              backdrop_path: details?.backdrop_path || null
            };
          } else if (media.title) {
            const results = await searchTmdbMovie(media.title, media.year || undefined, config);
            const best = results[0];
            if (best) {
              cached = {
                tmdb_id: best.id || null,
                tmdb_url: best.id ? `https://www.themoviedb.org/movie/${best.id}` : null,
                poster_path: best.poster_path || null,
                backdrop_path: best.backdrop_path || null
              };
            }
          }
        } catch (error) {
          cached = null;
          logError('Plex import TMDB poster enrichment failed', error);
        }
        tmdbEnrichmentCache.set(cacheKey, cached);
      }

      if (cached?.poster_path) {
        media.poster_path = cached.poster_path;
        media.backdrop_path = cached.backdrop_path || media.backdrop_path || cached.poster_path;
        media.tmdb_id = media.tmdb_id || cached.tmdb_id || null;
        media.tmdb_url = media.tmdb_url || cached.tmdb_url || (media.tmdb_id ? `https://www.themoviedb.org/movie/${media.tmdb_id}` : null);
        tmdbPosterEnriched += 1;
      } else {
        tmdbPosterLookupMisses += 1;
      }
    }

    try {
      let existing = null;

      const plexGuid = media.plex_guid || null;
      const plexItemKey = media.plex_rating_key ? `${item.sectionId}:${media.plex_rating_key}` : null;

      if (plexGuid) {
        const byPlexGuid = await pool.query(
          `SELECT m.id
           FROM media m
           JOIN media_metadata mm ON mm.media_id = m.id
           WHERE mm."key" = 'plex_guid'
             AND mm."value" = $1
           ORDER BY m.created_at DESC
           LIMIT 1`,
          [plexGuid]
        );
        existing = byPlexGuid.rows[0] || null;
      }

      if (!existing && plexItemKey) {
        const byPlexItemKey = await pool.query(
          `SELECT m.id
           FROM media m
           JOIN media_metadata mm ON mm.media_id = m.id
           WHERE mm."key" = 'plex_item_key'
             AND mm."value" = $1
           ORDER BY m.created_at DESC
           LIMIT 1`,
          [plexItemKey]
        );
        existing = byPlexItemKey.rows[0] || null;
      }

      if (!existing && media.tmdb_id) {
        const byTmdb = await pool.query('SELECT id FROM media WHERE tmdb_id = $1 LIMIT 1', [media.tmdb_id]);
        existing = byTmdb.rows[0] || null;
      }

      if (!existing) {
        const byTitleYear = await pool.query(
          `SELECT id
           FROM media
           WHERE LOWER(TRIM(title)) = LOWER(TRIM($1))
             AND (
               ($2::int IS NOT NULL AND year = $2::int)
               OR ($2::int IS NULL)
             )
           ORDER BY created_at DESC
           LIMIT 1`,
          [media.title, media.year || null]
        );
        existing = byTitleYear.rows[0] || null;
      }

      if (existing) {
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
             tmdb_url = COALESCE($12, tmdb_url),
             notes = COALESCE($13, notes),
             import_source = 'plex'
           WHERE id = $14`,
          [
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
            media.tmdb_url,
            `Imported from Plex section ${item.sectionId}`,
            existing.id
          ]
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
             runtime, poster_path, backdrop_path, overview, tmdb_id, tmdb_url, notes, added_by, import_source
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
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
            media.tmdb_url,
            `Imported from Plex section ${item.sectionId}`,
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
    } catch (error) {
      summary.errors.push({ title: media.title, detail: error.message });
    }
  }

  await logActivity(req, 'media.import.plex', 'media', null, {
    sectionIds,
    imported: items.length,
    created: summary.created,
    updated: summary.updated,
    skipped: summary.skipped,
    errorCount: summary.errors.length,
    tmdbPosterEnriched,
    tmdbPosterLookupMisses,
    variantsCreated,
    variantsUpdated
  });

  res.json({
    ok: true,
    imported: items.length,
    summary,
    tmdbPosterEnriched,
    tmdbPosterLookupMisses,
    variantsCreated,
    variantsUpdated
  });
}));

// ── Create ────────────────────────────────────────────────────────────────────

router.post('/', validate(mediaCreateSchema), asyncHandler(async (req, res) => {
  const {
    title, original_title, release_date, year, format, genre, director, rating,
    user_rating, tmdb_id, tmdb_url, poster_path, backdrop_path, overview,
    trailer_url, runtime, upc, location, notes, import_source
  } = req.body;

  const result = await pool.query(
    `INSERT INTO media (
       title, original_title, release_date, year, format, genre, director, rating,
       user_rating, tmdb_id, tmdb_url, poster_path, backdrop_path, overview,
       trailer_url, runtime, upc, location, notes, added_by, import_source
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
     ) RETURNING *`,
    [
      title, original_title || null, release_date || null, year || null, format || null,
      genre || null, director || null, rating || null, user_rating || null,
      tmdb_id || null, tmdb_url || null, poster_path || null, backdrop_path || null,
      overview || null, trailer_url || null, runtime || null, upc || null,
      location || null, notes || null, req.user.id, import_source || 'manual'
    ]
  );
  res.status(201).json(result.rows[0]);
}));

// ── Update ─────────────────────────────────────────────────────────────────────
// Ownership enforcement: users may only edit their own media; admins are unrestricted.

router.patch('/:id', validate(mediaUpdateSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Check the item exists and enforce ownership for non-admins
  const existing = await pool.query('SELECT id, added_by FROM media WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    return res.status(404).json({ error: 'Media item not found' });
  }
  if (req.user.role !== 'admin' && existing.rows[0].added_by !== req.user.id) {
    return res.status(403).json({ error: 'You do not have permission to edit this item' });
  }

  const ALLOWED_FIELDS = [
    'title', 'original_title', 'release_date', 'year', 'format', 'genre', 'director',
    'rating', 'user_rating', 'tmdb_id', 'tmdb_url', 'poster_path', 'backdrop_path',
    'overview', 'trailer_url', 'runtime', 'upc', 'location', 'notes'
  ];

  const fields = Object.fromEntries(
    Object.entries(req.body).filter(([key]) => ALLOWED_FIELDS.includes(key))
  );
  const keys = Object.keys(fields);
  const values = Object.values(fields);

  const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');
  const result = await pool.query(
    `UPDATE media SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
    [...values, id]
  );
  res.json(result.rows[0]);
}));

// ── Delete ────────────────────────────────────────────────────────────────────
// Ownership enforcement: users may only delete their own media; admins are unrestricted.

router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = await pool.query('SELECT id, added_by FROM media WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    return res.status(404).json({ error: 'Media item not found' });
  }
  if (req.user.role !== 'admin' && existing.rows[0].added_by !== req.user.id) {
    return res.status(403).json({ error: 'You do not have permission to delete this item' });
  }

  await pool.query('DELETE FROM media WHERE id = $1', [id]);
  res.json({ message: 'Media deleted' });
}));

module.exports = router;
