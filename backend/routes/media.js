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
const { logError } = require('../services/audit');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, 'uploads/'),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const MEDIA_FORMATS = ['VHS', 'Blu-ray', 'Digital', 'DVD', '4K UHD'];

// All routes require auth
router.use(authenticateToken);

// ── List / search ─────────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (req, res) => {
  const { format, search } = req.query;
  let query = 'SELECT * FROM media WHERE 1=1';
  const params = [];

  if (format && format !== 'all' && MEDIA_FORMATS.includes(format)) {
    params.push(format);
    query += ` AND format = $${params.length}`;
  }

  if (search) {
    params.push(`%${search}%`);
    query += ` AND (title ILIKE $${params.length} OR director ILIKE $${params.length})`;
  }

  query += ' ORDER BY created_at DESC';

  const result = await pool.query(query, params);
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

router.post('/recognize-cover', upload.single('cover'), asyncHandler(async (req, res) => {
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

router.post('/upload-cover', upload.single('cover'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ path: `/uploads/${req.file.filename}` });
}));

// ── Create ────────────────────────────────────────────────────────────────────

router.post('/', validate(mediaCreateSchema), asyncHandler(async (req, res) => {
  const {
    title, original_title, release_date, year, format, genre, director, rating,
    user_rating, tmdb_id, tmdb_url, poster_path, backdrop_path, overview,
    trailer_url, runtime, upc, location, notes
  } = req.body;

  const result = await pool.query(
    `INSERT INTO media (
       title, original_title, release_date, year, format, genre, director, rating,
       user_rating, tmdb_id, tmdb_url, poster_path, backdrop_path, overview,
       trailer_url, runtime, upc, location, notes, added_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
     ) RETURNING *`,
    [
      title, original_title || null, release_date || null, year || null, format || null,
      genre || null, director || null, rating || null, user_rating || null,
      tmdb_id || null, tmdb_url || null, poster_path || null, backdrop_path || null,
      overview || null, trailer_url || null, runtime || null, upc || null,
      location || null, notes || null, req.user.id
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
