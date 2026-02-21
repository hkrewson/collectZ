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
  const { format, search, page, limit } = req.query;
  const pageNum = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1;
  const limitNum = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Number(limit))) : 50;
  const offset = (pageNum - 1) * limitNum;
  let where = 'WHERE 1=1';
  const params = [];

  if (format && format !== 'all' && MEDIA_FORMATS.includes(format)) {
    params.push(format);
    where += ` AND format = $${params.length}`;
  }

  if (search) {
    params.push(`%${search}%`);
    where += ` AND (title ILIKE $${params.length} OR director ILIKE $${params.length})`;
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
     ORDER BY created_at DESC
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
             notes = COALESCE($13, notes)
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
             runtime, poster_path, backdrop_path, overview, tmdb_id, tmdb_url, notes, added_by
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
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
            req.user.id
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
