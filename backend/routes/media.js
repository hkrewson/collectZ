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
const {
  searchTmdbMovie,
  fetchTmdbMovieDetails,
  fetchTmdbTvShowSeasonSummary,
  fetchTmdbTvSeasonDetails
} = require('../services/tmdb');
const { normalizeBarcodeMatches } = require('../services/barcode');
const { extractVisionText, extractTitleCandidates } = require('../services/vision');
const { fetchPlexLibraryItems, fetchPlexShowSeasons, fetchPlexSeasonEpisodeStates } = require('../services/plex');
const { searchBooksByTitle, searchBooksByIsbn } = require('../services/books');
const { searchAudioByTitle } = require('../services/audio');
const { searchGamesByTitle } = require('../services/games');
const { searchComicsByTitle, fetchMetronCollectionIssues, fetchMetronIssueDetails, pushMetronCollectionIssue } = require('../services/comics');
const { parseCsvText } = require('../services/csv');
const { mapDeliciousItemTypeToMediaType } = require('../services/importMapping');
const { normalizeDeliciousRow } = require('../services/deliciousNormalize');
const { normalizeIdentifierSet } = require('../services/importIdentifiers');
const { syncNormalizedMetadataForMedia } = require('../services/mediaTaxonomy');
const { normalizeTypeDetails } = require('../services/typeDetails');
const { logError, logActivity } = require('../services/audit');
const { uploadBuffer } = require('../services/storage');
const { resolveScopeContext, appendScopeSql } = require('../db/scopeContext');
const { isFeatureEnabled } = require('../services/featureFlags');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const { ensureUserDefaultLibrary } = require('../services/libraries');

const router = express.Router();

const tempDiskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, 'uploads/'),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const tempUpload = multer({ storage: tempDiskStorage, limits: { fileSize: 10 * 1024 * 1024 } });
const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const MEDIA_FORMATS = ['VHS', 'Blu-ray', 'Digital', 'DVD', '4K UHD', 'Paperback', 'Hardcover', 'Trade'];
const MEDIA_TYPES = ['movie', 'tv_series', 'tv_episode', 'book', 'audio', 'game', 'comic_book'];
const TV_WATCH_STATES = new Set(['unwatched', 'in_progress', 'completed']);
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
const IMPORT_MATCH_MODES = [
  'matched_by_identifier',
  'identifier_no_match_fallback_title',
  'fallback_title_only',
  'identifier_conflict'
];
const IMPORT_ENRICHMENT_STATUSES = [
  'enriched',
  'no_match',
  'not_attempted',
  'not_applicable'
];
const IMPORT_REVIEW_ACTIONS = [
  'accept_suggested',
  'choose_alternate',
  'search_again',
  'skip_keep_manual'
];
const parsePlexRatingKeyFromItemKey = (itemKey) => {
  const raw = String(itemKey || '').trim();
  if (!raw) return null;
  const parts = raw.split(':').map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || '';
  if (/^\d+$/.test(last)) return last;
  const match = raw.match(/\/library\/metadata\/(\d+)/i);
  return match?.[1] || null;
};
const DEBUG_LEVEL = Math.max(0, Math.min(2, Number(process.env.DEBUG || 0) || 0));
const isDebugAt = (level) => DEBUG_LEVEL >= level;

function buildImportMatchCounters() {
  return IMPORT_MATCH_MODES.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function incrementImportMatchCounter(counters, mode) {
  if (!counters || !mode || !Object.prototype.hasOwnProperty.call(counters, mode)) return;
  counters[mode] += 1;
}

function buildImportEnrichmentCounters() {
  return IMPORT_ENRICHMENT_STATUSES.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function incrementImportEnrichmentCounter(counters, status) {
  if (!counters || !status || !Object.prototype.hasOwnProperty.call(counters, status)) return;
  counters[status] += 1;
}

function deriveImportConfidenceScore({ matchMode, matchedBy, enrichmentStatus }) {
  let score = 70;
  if (matchMode === 'matched_by_identifier') score += 25;
  if (matchMode === 'identifier_conflict') score -= 35;
  if (matchMode === 'identifier_no_match_fallback_title') score -= 15;
  if (matchMode === 'fallback_title_only') score -= 20;

  if (matchedBy === 'title_year_media_type') score -= 10;
  if (String(matchedBy || '').startsWith('provider_')) score += 8;

  if (enrichmentStatus === 'enriched') score += 8;
  if (enrichmentStatus === 'no_match') score -= 12;
  if (enrichmentStatus === 'not_attempted') score -= 6;

  return Math.max(0, Math.min(100, score));
}

function shouldQueueImportReview({ matchMode, enrichmentStatus, confidenceScore }) {
  if (matchMode === 'identifier_conflict') return true;
  if (matchMode === 'fallback_title_only') return true;
  if (matchMode === 'identifier_no_match_fallback_title') return true;
  if (enrichmentStatus === 'no_match' && confidenceScore < 70) return true;
  return confidenceScore < 55;
}

function normalizeMediaType(input, fallback = 'movie') {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (
    raw === 'tv'
    || raw === 'show'
    || raw === 'series'
    || raw === 'tv_show'
    || raw === 'tvseries'
    || raw === 'tv_series'
    || raw === 'tv-series'
  ) return 'tv_series';
  if (raw === 'tv_episode' || raw === 'episode') return 'tv_episode';
  if (raw === 'movie' || raw === 'film') return 'movie';
  if (raw === 'book' || raw === 'books') return 'book';
  if (raw === 'comic' || raw === 'comics' || raw === 'comic_book' || raw === 'comic-book') return 'comic_book';
  if (raw === 'audio' || raw === 'music' || raw === 'album' || raw === 'cd' || raw === 'vinyl' || raw === 'lp') return 'audio';
  if (raw === 'game' || raw === 'games' || raw === 'video_game' || raw === 'videogame') return 'game';
  if (raw === 'other') return 'comic_book';
  return fallback;
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

function stripIncompatibleTypeSpecificFields(mediaType, payload = {}) {
  const effectiveType = normalizeMediaType(mediaType, 'movie');
  const cleaned = { ...payload };
  if (!['tv_series', 'tv_episode'].includes(effectiveType)) {
    delete cleaned.season_number;
    delete cleaned.episode_number;
    delete cleaned.episode_title;
    delete cleaned.network;
    return cleaned;
  }
  if (effectiveType === 'tv_series') {
    delete cleaned.episode_number;
    delete cleaned.episode_title;
  }
  return cleaned;
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

function parseCalibreDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }
  return parseDateOnly(raw);
}

function normalizeCalibreRows(rows = []) {
  return rows.map((row) => {
    const value = (name) => getRowValue(row, name);
    const tags = String(value('tags') || '').toLowerCase();
    const formats = String(value('formats') || '').toLowerCase();
    const isComic = tags.includes('comic') || tags.includes('manga') || formats.includes('cbz') || formats.includes('cbr');
    const year = parseYear(value('pubdate') || value('date') || value('year'));
    const format = isComic ? 'Digital' : (normalizeMediaFormat(value('format')) || 'Digital');
    const series = value('series');
    const seriesIndex = value('series_index') || value('series index') || value('index');

    return {
      title: value('title'),
      media_type: isComic ? 'comic_book' : 'book',
      original_title: value('original_title') || '',
      release_date: parseCalibreDate(value('pubdate') || value('date')),
      year: year ? String(year) : '',
      format,
      genre: value('tags') || value('genre') || '',
      director: '',
      rating: value('rating') || '',
      user_rating: '',
      runtime: '',
      upc: value('ean') || value('upc') || '',
      signed_by: '',
      signed_role: '',
      signed_on: '',
      signed_at: '',
      location: '',
      notes: value('comments') || '',
      author: value('authors') || value('author') || '',
      isbn: value('isbn') || value('isbn13') || '',
      publisher: value('publisher') || '',
      edition: value('edition') || '',
      series,
      issue_number: seriesIndex
    };
  });
}

function normalizeSignedRole(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (['author', 'producer', 'cast'].includes(normalized)) return normalized;
  return null;
}

function normalizeTitleForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeComicIssueToken(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .replace(/^#\s*/, '')
    .replace(/^(issue|no\.?)\s*/i, '')
    .trim()
    .toLowerCase();
}

function detectBoxedSetCandidate(title = '', notes = '') {
  const sourceTitle = String(title || '').trim();
  if (!sourceTitle) {
    return { isCandidate: false, expectedItemCount: null, containedTitles: [] };
  }
  const haystack = `${sourceTitle} ${String(notes || '')}`.toLowerCase();
  const countMatch = haystack.match(/\b(\d{1,3})\s*[- ]?(movie|movies|film|films|disc|discs|dvd|blu[-\s]?ray)\b/i);
  const expectedItemCount = countMatch ? Number(countMatch[1]) : null;
  const unit = String(countMatch?.[2] || '').toLowerCase();
  const hasCollectionKeyword = /\b(collection|set|pack|bundle|marathon|favorites?|anthology|trilogy)\b/i.test(haystack);
  const isMovieUnit = ['movie', 'movies', 'film', 'films'].includes(unit);
  const isDiscUnit = ['disc', 'discs', 'dvd', 'blu-ray', 'blu ray'].includes(unit);

  const containedTitles = [];
  const includesMatch = String(notes || '').match(/includes?\s*:\s*(.+)$/i);
  if (includesMatch?.[1]) {
    includesMatch[1]
      .split(/[|/;,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((value) => containedTitles.push(value));
  }

  const isLikelyCollection = Number.isFinite(expectedItemCount)
    && expectedItemCount > 1
    && (
      isMovieUnit
      || (isDiscUnit && hasCollectionKeyword)
      || hasCollectionKeyword
    );

  return {
    isCandidate: isLikelyCollection,
    expectedItemCount: Number.isFinite(expectedItemCount) ? expectedItemCount : null,
    containedTitles
  };
}

function extractComicIssueTokenFromTitle(title) {
  const value = String(title || '').trim();
  if (!value) return '';
  const hashMatch = value.match(/#\s*([A-Za-z0-9.-]+)/);
  if (hashMatch?.[1]) return normalizeComicIssueToken(hashMatch[1]);
  const issueMatch = value.match(/\b(?:issue|no\.?)\s*([A-Za-z0-9.-]+)/i);
  if (issueMatch?.[1]) return normalizeComicIssueToken(issueMatch[1]);
  return '';
}

function getComicIssueTokenFromCandidate(row = {}) {
  const issueFromDetails = normalizeComicIssueToken(row?.type_details?.issue_number || '');
  if (issueFromDetails) return issueFromDetails;
  return extractComicIssueTokenFromTitle(row?.title || row?.name || '');
}

function getComicIssueTokenFromItem(item = {}) {
  const issueFromDetails = normalizeComicIssueToken(item?.type_details?.issue_number || '');
  if (issueFromDetails) return issueFromDetails;
  return extractComicIssueTokenFromTitle(item?.title || '');
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

function pickBestProviderMatch(results = [], title, year, options = {}) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const targetTitle = normalizeTitleForMatch(title);
  const targetYear = Number.isFinite(Number(year)) ? Number(year) : null;
  const mediaType = normalizeMediaType(options.mediaType || '', 'movie');
  const targetComicIssue = mediaType === 'comic_book'
    ? normalizeComicIssueToken(options.comicIssueNumber || '')
    : '';
  let best = null;
  let bestScore = -Infinity;

  for (const row of results) {
    const candidateTitle = normalizeTitleForMatch(row.title || row.name || '');
    const candidateYear = parseYear(row.release_date || row.year || '');
    let score = 0;
    if (targetTitle && candidateTitle) {
      if (candidateTitle === targetTitle) score += 100;
      else if (candidateTitle.startsWith(targetTitle) || targetTitle.startsWith(candidateTitle)) score += 60;
      else if (candidateTitle.includes(targetTitle) || targetTitle.includes(candidateTitle)) score += 35;
    }
    if (targetYear && candidateYear) {
      const delta = Math.abs(candidateYear - targetYear);
      if (delta === 0) score += 20;
      else if (delta <= 1) score += 10;
      else if (delta <= 2) score += 5;
    }
    if (mediaType === 'comic_book' && targetComicIssue) {
      const candidateIssue = getComicIssueTokenFromCandidate(row);
      if (candidateIssue && candidateIssue === targetComicIssue) score += 120;
      else if (candidateIssue && candidateIssue !== targetComicIssue) score -= 240;
    }
    if (!best || score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best || results[0];
}

async function enrichImportItemByMediaType(item, config, cache) {
  const normalizedMediaType = normalizeMediaType(item.media_type || 'movie', 'movie');
  if (!item?.title) return item;
  if (!['book', 'audio', 'game', 'comic_book'].includes(normalizedMediaType)) return item;
  if (normalizedMediaType === 'comic_book') {
    const inferredIssue = getComicIssueTokenFromItem(item);
    if (inferredIssue) {
      item = {
        ...item,
        type_details: {
          ...(item.type_details || {}),
          issue_number: item?.type_details?.issue_number || inferredIssue
        }
      };
    }
  }

  const identifiers = resolveImportIdentifiers(item, item.identifiers || {});
  const cacheKey = `${normalizedMediaType}:q:${String(item.title).toLowerCase()}|${item.year || ''}|${identifiers.isbn || ''}|${identifiers.eanUpc || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return {
      ...item,
      ...cached,
      type_details: { ...(item.type_details || {}), ...(cached.type_details || {}) }
    };
  }

  try {
    let results = [];
    if (normalizedMediaType === 'book') {
      if (identifiers.isbn) {
        results = await searchBooksByIsbn(identifiers.isbn, config, 8);
      }
      if (!results.length) {
        results = await searchBooksByTitle(
          item.title,
          config,
          8,
          item.type_details?.author || item.director || ''
        );
      }
    } else if (normalizedMediaType === 'comic_book') {
      results = await searchComicsByTitle(item.title, config, 8);
    } else if (normalizedMediaType === 'audio') {
      if (identifiers.eanUpc && config.barcodeApiUrl && config.barcodeApiKey) {
        const lookup = await axios.get(config.barcodeApiUrl, {
          params: { [config.barcodeQueryParam || 'upc']: identifiers.eanUpc },
          headers: config.barcodeApiKeyHeader ? { [config.barcodeApiKeyHeader]: config.barcodeApiKey } : {},
          timeout: 20000
        });
        const matches = normalizeBarcodeMatches(lookup.data);
        if (matches.length) {
          results = matches
            .filter((m) => m?.title)
            .map((m) => ({
              title: m.title,
              year: parseYear(m.release_date || ''),
              release_date: m.release_date || null,
              overview: m.description || null,
              genre: null,
              external_url: null,
              poster_path: m.image || null,
              type_details: {
                artist: item.type_details?.artist || null,
                album: m.title,
                track_count: null
              }
            }));
        }
      }
      if (!results.length) {
      results = await searchAudioByTitle(
        item.title,
        config,
        8,
        item.type_details?.artist || item.director || ''
      );
      }
    } else {
      if (identifiers.eanUpc && config.barcodeApiUrl && config.barcodeApiKey) {
        const lookup = await axios.get(config.barcodeApiUrl, {
          params: { [config.barcodeQueryParam || 'upc']: identifiers.eanUpc },
          headers: config.barcodeApiKeyHeader ? { [config.barcodeApiKeyHeader]: config.barcodeApiKey } : {},
          timeout: 20000
        });
        const matches = normalizeBarcodeMatches(lookup.data);
        if (matches.length) {
          const titleCandidate = matches[0]?.title || '';
          if (titleCandidate) {
            results = await searchGamesByTitle(titleCandidate, config, 8);
          }
        }
      }
      if (!results.length) {
      results = await searchGamesByTitle(item.title, config, 8);
      }
    }
    const best = pickBestProviderMatch(results, item.title, item.year, {
      mediaType: normalizedMediaType,
      comicIssueNumber: normalizedMediaType === 'comic_book' ? item?.type_details?.issue_number : ''
    }) || null;
    if (!best) {
      cache.set(cacheKey, {});
      return item;
    }

    const bestTypeDetails = best.type_details || {};
    const incomingTypeDetails = item.type_details || {};
    const enriched = {
      year: item.year || best.year || parseYear(best.release_date) || null,
      release_date: item.release_date || best.release_date || null,
      overview: item.overview || best.overview || null,
      genre: item.genre || best.genre || null,
      poster_path: item.poster_path || best.poster_path || null,
      tmdb_url: item.tmdb_url || best.external_url || null,
      type_details: {
        ...incomingTypeDetails,
        author: incomingTypeDetails.author || bestTypeDetails.author || null,
        isbn: incomingTypeDetails.isbn || bestTypeDetails.isbn || null,
        publisher: incomingTypeDetails.publisher || bestTypeDetails.publisher || null,
        edition: incomingTypeDetails.edition || bestTypeDetails.edition || null,
        series: incomingTypeDetails.series || bestTypeDetails.series || null,
        issue_number: incomingTypeDetails.issue_number || bestTypeDetails.issue_number || null,
        provider_issue_id: incomingTypeDetails.provider_issue_id || bestTypeDetails.provider_issue_id || best.id || null,
        volume: incomingTypeDetails.volume || bestTypeDetails.volume || null,
        writer: incomingTypeDetails.writer || bestTypeDetails.writer || null,
        artist: incomingTypeDetails.artist || bestTypeDetails.artist || null,
        album: incomingTypeDetails.album || bestTypeDetails.album || null,
        track_count: incomingTypeDetails.track_count || bestTypeDetails.track_count || null,
        platform: incomingTypeDetails.platform || bestTypeDetails.platform || null,
        developer: incomingTypeDetails.developer || bestTypeDetails.developer || null,
        region: incomingTypeDetails.region || bestTypeDetails.region || null,
        inker: incomingTypeDetails.inker || bestTypeDetails.inker || null,
        colorist: incomingTypeDetails.colorist || bestTypeDetails.colorist || null,
        cover_date: incomingTypeDetails.cover_date || bestTypeDetails.cover_date || null
      }
    };

    cache.set(cacheKey, enriched);
    return {
      ...item,
      ...enriched,
      type_details: { ...(item.type_details || {}), ...(enriched.type_details || {}) }
    };
  } catch (_error) {
    cache.set(cacheKey, {});
    return item;
  }
}

async function enrichImportItemWithTmdb(item, config, cache, options = {}) {
  const lookupTitle = String(options.lookupTitle || item?.title || '').trim();
  if (!config?.tmdbApiKey || !lookupTitle) return item;
  const normalizedMediaType = normalizeMediaType(item.media_type || 'movie', 'movie');
  if (!['movie', 'tv_series', 'tv_episode'].includes(normalizedMediaType)) {
    return item;
  }
  const tmdbType = normalizedMediaType === 'tv_series' || normalizedMediaType === 'tv_episode' ? 'tv' : 'movie';

  const cacheKey = item.tmdb_id
    ? `${tmdbType}:id:${item.tmdb_id}`
    : `${tmdbType}:q:${String(lookupTitle).toLowerCase()}|${item.year || ''}`;
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
      const results = await searchTmdbMovie(lookupTitle, item.year || undefined, config, tmdbType);
      candidate = pickBestTmdbMatch(results, lookupTitle, item.year) || null;
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
      cast: details?.cast || item.cast || null,
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

function hasEnrichmentDelta(before, after) {
  const fields = [
    'tmdb_id', 'tmdb_url', 'poster_path', 'backdrop_path', 'overview',
    'director', 'cast', 'genre', 'rating', 'runtime', 'trailer_url', 'release_date', 'year'
  ];
  for (const key of fields) {
    const prev = before?.[key];
    const next = after?.[key];
    if ((prev === null || prev === undefined || prev === '') && (next !== null && next !== undefined && next !== '')) {
      return true;
    }
  }
  return false;
}

function pickBestBarcodeMatch(matches = [], sourceTitle = '') {
  if (!Array.isArray(matches) || !matches.length) return null;
  const target = normalizeTitleForMatch(sourceTitle);
  if (!target) return matches[0];
  let best = null;
  let bestScore = -1;
  for (const match of matches) {
    const title = normalizeTitleForMatch(match?.title || '');
    if (!title) continue;
    let score = 0;
    if (title === target) score = 100;
    else if (title.includes(target) || target.includes(title)) score = 60;
    if (score > bestScore) {
      best = match;
      bestScore = score;
    }
  }
  return best || matches[0];
}

async function enrichMovieFromBarcode(item, config, cache, identifiers = {}) {
  const normalizedType = normalizeMediaType(item.media_type || 'movie', 'movie');
  if (normalizedType !== 'movie') return { item, attempted: false, barcodeTitleHint: '' };
  const eanUpc = String(identifiers.eanUpc || identifiers.ean_upc || item.upc || '').trim();
  if (!eanUpc) return { item, attempted: false, barcodeTitleHint: '' };
  if (!config?.barcodeApiUrl || !config?.barcodeApiKey) return { item, attempted: false, barcodeTitleHint: '' };

  const cacheKey = `movie:barcode:${eanUpc}`;
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey) || {};
    return {
      item: {
        ...item,
        overview: item.overview || cached.overview || null,
        poster_path: item.poster_path || cached.poster_path || null,
        upc: item.upc || eanUpc
      },
      attempted: true,
      barcodeTitleHint: cached.titleHint || ''
    };
  }

  try {
    const barcodeResponse = await axios.get(config.barcodeApiUrl, {
      params: { [config.barcodeQueryParam || 'upc']: eanUpc },
      headers: config.barcodeApiKeyHeader ? { [config.barcodeApiKeyHeader]: config.barcodeApiKey } : {},
      timeout: 20000,
      validateStatus: () => true
    });
    if (barcodeResponse.status >= 400) {
      cache.set(cacheKey, {});
      return { item, attempted: true, barcodeTitleHint: '' };
    }
    const matches = normalizeBarcodeMatches(barcodeResponse.data);
    const best = pickBestBarcodeMatch(matches, item.title);
    if (!best) {
      cache.set(cacheKey, {});
      return { item, attempted: true, barcodeTitleHint: '' };
    }
    const cached = {
      titleHint: best.title || '',
      overview: best.description || null,
      poster_path: best.image || null
    };
    cache.set(cacheKey, cached);
    return {
      item: {
        ...item,
        overview: item.overview || cached.overview || null,
        poster_path: item.poster_path || cached.poster_path || null,
        upc: item.upc || eanUpc
      },
      attempted: true,
      barcodeTitleHint: cached.titleHint
    };
  } catch (_error) {
    cache.set(cacheKey, {});
    return { item, attempted: true, barcodeTitleHint: '' };
  }
}

async function runImportEnrichmentPipeline(item, config, caches, identifiers = {}) {
  const normalizedType = normalizeMediaType(item.media_type || 'movie', 'movie');
  let working = { ...item };
  let attempted = false;
  let enriched = false;

  if (['book', 'audio', 'game', 'comic_book'].includes(normalizedType)) {
    attempted = true;
    const before = { ...working };
    working = await enrichImportItemByMediaType({ ...working, identifiers }, config, caches.providerCache);
    enriched = enriched || hasEnrichmentDelta(before, working);
  }

  if (normalizedType === 'movie') {
    const beforeBarcode = { ...working };
    const barcode = await enrichMovieFromBarcode(working, config, caches.providerCache, identifiers);
    if (barcode.attempted) attempted = true;
    working = barcode.item;
    enriched = enriched || hasEnrichmentDelta(beforeBarcode, working);

    const beforeTmdbHint = { ...working };
    if (barcode.barcodeTitleHint && normalizeTitleForMatch(barcode.barcodeTitleHint) !== normalizeTitleForMatch(working.title)) {
      working = await enrichImportItemWithTmdb(working, config, caches.tmdbCache, { lookupTitle: barcode.barcodeTitleHint });
      attempted = true;
      enriched = enriched || hasEnrichmentDelta(beforeTmdbHint, working);
    }
  }

  if (['movie', 'tv_series', 'tv_episode'].includes(normalizedType)) {
    const beforeTmdb = { ...working };
    working = await enrichImportItemWithTmdb(working, config, caches.tmdbCache);
    attempted = true;
    enriched = enriched || hasEnrichmentDelta(beforeTmdb, working);
  }

  const enrichmentStatus = attempted ? (enriched ? 'enriched' : 'no_match') : 'not_applicable';
  return { item: working, enrichmentStatus };
}

function resolveImportIdentifiers(item = {}, inputIdentifiers = {}) {
  return normalizeIdentifierSet({
    isbn: inputIdentifiers.isbn || item.type_details?.isbn || '',
    ean_upc: inputIdentifiers.eanUpc || inputIdentifiers.ean_upc || item.upc || '',
    asin: inputIdentifiers.asin || inputIdentifiers.amazon_item_id || item.amazon_item_id || ''
  });
}

async function findExistingByIdentifier({ identifierType, identifierValue, normalizedMediaType, scopeContext = null }) {
  if (!identifierValue) return { row: null, conflict: false };
  const params = [normalizedMediaType, identifierValue];
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'm.space_id',
    libraryColumn: 'm.library_id'
  });
  let condition = '';
  if (identifierType === 'isbn') {
    condition = `(COALESCE(m.type_details->>'isbn', '') = $2 OR (mm."key" = 'isbn' AND mm."value" = $2))`;
  } else if (identifierType === 'ean_upc') {
    condition = `(COALESCE(m.upc, '') = $2 OR (mm."key" IN ('ean', 'ean_upc', 'upc') AND mm."value" = $2))`;
  } else if (identifierType === 'asin') {
    condition = `(mm."key" = 'amazon_item_id' AND mm."value" = $2)`;
  } else {
    return { row: null, conflict: false };
  }

  const result = await pool.query(
    `SELECT DISTINCT m.id
     FROM media m
     LEFT JOIN media_metadata mm ON mm.media_id = m.id
     WHERE COALESCE(m.media_type, 'movie') = $1
       AND ${condition}
       ${scopeClause}
     ORDER BY m.id DESC
     LIMIT 2`,
    params
  );
  return {
    row: result.rows[0] || null,
    conflict: result.rows.length > 1
  };
}

async function findExistingByProviderIds({ item, normalizedMediaType, normalizedTmdbType, scopeContext = null }) {
  if (normalizedMediaType === 'comic_book') {
    const providerIssueId = String(
      item?.type_details?.provider_issue_id || item?.provider_issue_id || ''
    ).trim();
    if (providerIssueId) {
      const params = [providerIssueId, normalizedMediaType];
      const scopeClause = appendScopeSql(params, scopeContext, {
        spaceColumn: 'm.space_id',
        libraryColumn: 'm.library_id'
      });
      const byProviderIssueId = await pool.query(
        `SELECT DISTINCT m.id
         FROM media m
         LEFT JOIN media_metadata mm ON mm.media_id = m.id
         WHERE COALESCE(m.media_type, 'movie') = $2
           AND (
             COALESCE(m.type_details->>'provider_issue_id', '') = $1
             OR (mm."key" = 'metron_issue_id' AND mm."value" = $1)
           )
           ${scopeClause}
         ORDER BY m.id DESC
         LIMIT 1`,
        params
      );
      if (byProviderIssueId.rows[0]) {
        return { row: byProviderIssueId.rows[0], matchedBy: 'provider_issue_id' };
      }
    }
  }

  if (item.tmdb_id) {
    const params = [item.tmdb_id, normalizedTmdbType, normalizedMediaType];
    const scopeClause = appendScopeSql(params, scopeContext);
    const byTmdb = await pool.query(
      `SELECT id
       FROM media
       WHERE tmdb_id = $1
         AND COALESCE(tmdb_media_type, 'movie') = $2
         AND COALESCE(media_type, 'movie') = $3
         ${scopeClause}
       ORDER BY id DESC
       LIMIT 1`,
      params
    );
    if (byTmdb.rows[0]) return { row: byTmdb.rows[0], matchedBy: 'provider_tmdb' };
  }

  const plexGuid = item.plex_guid || null;
  if (plexGuid) {
    const params = [plexGuid];
    const scopeClause = appendScopeSql(params, scopeContext, {
      spaceColumn: 'm.space_id',
      libraryColumn: 'm.library_id'
    });
    const byPlexGuid = await pool.query(
      `SELECT m.id
       FROM media m
       JOIN media_metadata mm ON mm.media_id = m.id
       WHERE mm."key" = 'plex_guid'
         AND mm."value" = $1
         ${scopeClause}
       ORDER BY m.id DESC
       LIMIT 1`,
      params
    );
    if (byPlexGuid.rows[0]) return { row: byPlexGuid.rows[0], matchedBy: 'provider_plex_guid' };
  }

  const plexRatingKey = item.plex_rating_key || null;
  if (plexRatingKey) {
    const params = [plexRatingKey];
    const scopeClause = appendScopeSql(params, scopeContext, {
      spaceColumn: 'm.space_id',
      libraryColumn: 'm.library_id'
    });
    const byPlexRatingKey = await pool.query(
      `SELECT m.id
       FROM media m
       JOIN media_metadata mm ON mm.media_id = m.id
       WHERE mm."key" = 'plex_item_key'
         AND mm."value" = $1
         ${scopeClause}
       ORDER BY m.id DESC
       LIMIT 1`,
      params
    );
    if (byPlexRatingKey.rows[0]) return { row: byPlexRatingKey.rows[0], matchedBy: 'provider_plex_item_key' };
  }

  return { row: null, matchedBy: null };
}

async function upsertImportedMedia({ userId, item, importSource, scopeContext = null, identifiers = null }) {
  const title = String(item.title || '').trim();
  if (!title) {
    return { type: 'invalid', detail: 'Missing title' };
  }
  const normalizedMediaType = normalizeMediaType(item.media_type || 'movie', 'movie');
  const normalizedTmdbType = normalizedMediaType === 'tv_series' || normalizedMediaType === 'tv_episode' ? 'tv' : 'movie';
  const normalizedTypeDetailsResult = normalizeTypeDetails(normalizedMediaType, item.type_details, { strict: true });
  if ((normalizedTypeDetailsResult.invalidKeys || []).length > 0) {
    throw new Error(`Invalid type_details key(s) for ${normalizedMediaType}: ${normalizedTypeDetailsResult.invalidKeys.join(', ')}`);
  }
  if ((normalizedTypeDetailsResult.errors || []).length > 0) {
    throw new Error(`Invalid type_details values for ${normalizedMediaType}: ${normalizedTypeDetailsResult.errors.map((entry) => `${entry.key}: ${entry.message}`).join('; ')}`);
  }
  const normalizedTypeDetails = normalizedTypeDetailsResult.value;
  const baseIdentifiers = resolveImportIdentifiers(item, identifiers || {});
  const resolvedIdentifiers = normalizedMediaType === 'comic_book'
    ? {
        isbn: '',
        eanUpc: '',
        asin: ''
      }
    : baseIdentifiers;
  const identifierAttempted = Boolean(resolvedIdentifiers.isbn || resolvedIdentifiers.eanUpc || resolvedIdentifiers.asin);
  const dedupLockKey = buildMediaDedupLockKey({ ...item, title, ...resolvedIdentifiers }, scopeContext);
  return withDedupLock(dedupLockKey, async () => {
    let existingRow = null;
    let matchMode = identifierAttempted ? 'identifier_no_match_fallback_title' : 'fallback_title_only';
    let matchedBy = 'title_year_media_type';
    let identifierConflict = false;

    if (resolvedIdentifiers.isbn) {
      const byIsbn = await findExistingByIdentifier({
        identifierType: 'isbn',
        identifierValue: resolvedIdentifiers.isbn,
        normalizedMediaType,
        scopeContext
      });
      if (byIsbn.row) {
        existingRow = byIsbn.row;
        matchedBy = 'identifier_isbn';
        identifierConflict = byIsbn.conflict;
        matchMode = byIsbn.conflict ? 'identifier_conflict' : 'matched_by_identifier';
      }
    }

    if (!existingRow && resolvedIdentifiers.eanUpc) {
      const byEan = await findExistingByIdentifier({
        identifierType: 'ean_upc',
        identifierValue: resolvedIdentifiers.eanUpc,
        normalizedMediaType,
        scopeContext
      });
      if (byEan.row) {
        existingRow = byEan.row;
        matchedBy = 'identifier_ean_upc';
        identifierConflict = byEan.conflict;
        matchMode = byEan.conflict ? 'identifier_conflict' : 'matched_by_identifier';
      }
    }

    if (!existingRow && resolvedIdentifiers.asin) {
      const byAsin = await findExistingByIdentifier({
        identifierType: 'asin',
        identifierValue: resolvedIdentifiers.asin,
        normalizedMediaType,
        scopeContext
      });
      if (byAsin.row) {
        existingRow = byAsin.row;
        matchedBy = 'identifier_asin';
        identifierConflict = byAsin.conflict;
        matchMode = byAsin.conflict ? 'identifier_conflict' : 'matched_by_identifier';
      }
    }

    if (!existingRow) {
      const providerMatch = await findExistingByProviderIds({
        item,
        normalizedMediaType,
        normalizedTmdbType,
        scopeContext
      });
      if (providerMatch.row) {
        existingRow = providerMatch.row;
        matchedBy = providerMatch.matchedBy || 'provider';
      }
    }

    if (!existingRow) {
      const comicProviderIssueId = normalizedMediaType === 'comic_book'
        ? String(normalizedTypeDetails?.provider_issue_id || '').trim()
        : '';
      const shouldSkipTitleFallback = normalizedMediaType === 'comic_book' && Boolean(comicProviderIssueId);
      if (!shouldSkipTitleFallback) {
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
        existingRow = existing.rows[0] || null;
      }
    }

    if (existingRow) {
      const updateParams = [
        normalizedMediaType,
        item.original_title || null,
        item.release_date || null,
        item.year || null,
        item.format || null,
        item.genre || null,
        item.director || null,
        item.cast || null,
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
        item.signed_by || null,
        item.signed_role || null,
        item.signed_on || null,
        item.signed_at || null,
        item.signed_proof_path || null,
        item.location || null,
        item.notes || null,
        normalizedTypeDetails ? JSON.stringify(normalizedTypeDetails) : null,
        importSource || null,
        existingRow.id
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
           cast_members = COALESCE($8, cast_members),
           rating = COALESCE($9, rating),
           user_rating = COALESCE($10, user_rating),
           tmdb_id = COALESCE($11, tmdb_id),
           tmdb_media_type = COALESCE($12, tmdb_media_type),
           tmdb_url = COALESCE($13, tmdb_url),
           poster_path = COALESCE($14, poster_path),
           backdrop_path = COALESCE($15, backdrop_path),
           overview = COALESCE($16, overview),
           trailer_url = COALESCE($17, trailer_url),
           runtime = COALESCE($18, runtime),
           upc = COALESCE($19, upc),
           signed_by = COALESCE($20, signed_by),
           signed_role = COALESCE($21, signed_role),
           signed_on = COALESCE($22, signed_on),
           signed_at = COALESCE($23, signed_at),
           signed_proof_path = COALESCE($24, signed_proof_path),
           location = COALESCE($25, location),
           notes = COALESCE($26, notes),
           type_details = COALESCE($27::jsonb, type_details),
           import_source = COALESCE($28, import_source)
         WHERE id = $29${updateScopeClause}
         RETURNING id, genre, director, cast_members AS cast`,
        updateParams
      );
      const refreshed = await pool.query('SELECT id, genre, director, cast_members AS cast FROM media WHERE id = $1', [existingRow.id]);
      const updatedRow = refreshed.rows[0] || { id: existingRow.id, genre: item.genre || null, director: item.director || null, cast: item.cast || null };
      await syncNormalizedMetadataForMedia({
        mediaId: updatedRow.id,
        genre: updatedRow.genre,
        director: updatedRow.director,
        cast: updatedRow.cast
      });
      return {
        type: 'updated',
        mediaId: existingRow.id,
        matchMode,
        matchedBy,
        identifiers: resolvedIdentifiers,
        identifierConflict
      };
    }

    const inserted = await pool.query(
      `INSERT INTO media (
         title, media_type, original_title, release_date, year, format, genre, director, cast_members,
         rating, user_rating, tmdb_id, tmdb_media_type, tmdb_url, poster_path, backdrop_path, overview, trailer_url,
         runtime, upc, signed_by, signed_role, signed_on, signed_at, signed_proof_path, location, notes, type_details, library_id, space_id, added_by, import_source
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28::jsonb,$29,$30,$31,$32
       )
       RETURNING id, genre, director, cast_members AS cast`,
      [
        title,
        normalizedMediaType,
        item.original_title || null,
        item.release_date || null,
        item.year || null,
        item.format || 'Digital',
        item.genre || null,
        item.director || null,
        item.cast || null,
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
        item.signed_by || null,
        item.signed_role || null,
        item.signed_on || null,
        item.signed_at || null,
        item.signed_proof_path || null,
        item.location || null,
        item.notes || null,
        normalizedTypeDetails ? JSON.stringify(normalizedTypeDetails) : null,
        item.library_id || scopeContext?.libraryId || null,
        item.space_id || scopeContext?.spaceId || null,
        userId,
        importSource || null
      ]
    );
    const insertedRow = inserted.rows[0] || null;
    if (insertedRow?.id) {
      await syncNormalizedMetadataForMedia({
        mediaId: insertedRow.id,
        genre: insertedRow.genre,
        director: insertedRow.director,
        cast: insertedRow.cast
      });
    }
    return {
      type: 'created',
      mediaId: insertedRow?.id || null,
      matchMode,
      matchedBy,
      identifiers: resolvedIdentifiers,
      identifierConflict
    };
  });
}

async function upsertMediaMetadataEntry(mediaId, key, value) {
  if (!mediaId || !key || value === undefined || value === null || value === '') return;
  await pool.query(
    `INSERT INTO media_metadata (media_id, "key", "value")
     VALUES ($1::int, $2::varchar, $3::text)
     ON CONFLICT (media_id, "key")
     DO UPDATE SET "value" = EXCLUDED."value"`,
    [mediaId, String(key), String(value)]
  );
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
  if (item.isbn) return `media|${scope}|isbn|${item.isbn}|${normalizedMediaType}`;
  if (item.eanUpc || item.ean_upc) return `media|${scope}|ean_upc|${item.eanUpc || item.ean_upc}|${normalizedMediaType}`;
  if (item.asin) return `media|${scope}|asin|${item.asin}|${normalizedMediaType}`;
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

async function enqueueImportMatchReview({
  userId,
  scopeContext,
  jobId = null,
  importSource = null,
  provider = null,
  rowNumber = null,
  sourceTitle = null,
  mediaType = null,
  matchMode = null,
  matchedBy = null,
  enrichmentStatus = null,
  proposedMediaId = null,
  confidenceScore = null,
  sourcePayload = null,
  collectionId = null
}) {
  const params = [
    jobId || null,
    importSource || null,
    provider || null,
    Number.isFinite(Number(rowNumber)) ? Number(rowNumber) : null,
    sourceTitle || null,
    normalizeMediaType(mediaType || 'movie', 'movie'),
    Number.isFinite(Number(confidenceScore)) ? Number(confidenceScore) : null,
    matchMode || null,
    matchedBy || null,
    enrichmentStatus || null,
    proposedMediaId || null,
    sourcePayload ? JSON.stringify(sourcePayload) : null,
    collectionId || null,
    scopeContext?.libraryId || null,
    scopeContext?.spaceId || null,
    userId || null
  ];
  const result = await pool.query(
    `INSERT INTO import_match_reviews (
       job_id, import_source, provider, row_number, source_title, media_type,
       confidence_score, match_mode, matched_by, enrichment_status, proposed_media_id,
       source_payload, collection_id, library_id, space_id, created_by
     )
     VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16
     )
     RETURNING id`,
    params
  );
  return result.rows[0] || null;
}

async function ensureImportCollection({
  userId,
  scopeContext,
  importSource = null,
  mediaType = null,
  sourceTitle = '',
  expectedItemCount = null,
  metadata = null
}) {
  const normalizedSourceTitle = String(sourceTitle || '').trim();
  if (!normalizedSourceTitle) return { id: null, created: false };
  const params = [
    normalizedSourceTitle,
    importSource || null,
    normalizeMediaType(mediaType || 'movie', 'movie'),
    scopeContext?.libraryId || null,
    scopeContext?.spaceId || null
  ];
  const existing = await pool.query(
    `SELECT id
     FROM collections
     WHERE lower(trim(source_title)) = lower(trim($1))
       AND COALESCE(import_source, '') = COALESCE($2, '')
       AND COALESCE(media_type, '') = COALESCE($3, '')
       AND COALESCE(library_id, 0) = COALESCE($4, 0)
       AND COALESCE(space_id, 0) = COALESCE($5, 0)
     ORDER BY id DESC
     LIMIT 1`,
    params
  );
  if (existing.rows[0]?.id) return { id: existing.rows[0].id, created: false };

  const created = await pool.query(
    `INSERT INTO collections (
       name, media_type, source_title, import_source, expected_item_count, metadata,
       library_id, space_id, created_by
     )
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
     RETURNING id`,
    [
      normalizedSourceTitle,
      normalizeMediaType(mediaType || 'movie', 'movie'),
      normalizedSourceTitle,
      importSource || null,
      Number.isFinite(Number(expectedItemCount)) ? Number(expectedItemCount) : null,
      metadata ? JSON.stringify(metadata) : null,
      scopeContext?.libraryId || null,
      scopeContext?.spaceId || null,
      userId || null
    ]
  );
  return { id: created.rows[0]?.id || null, created: true };
}

async function addCollectionItem({
  collectionId,
  mediaId = null,
  containedTitle = null,
  position = null,
  confidenceScore = null,
  sourcePayload = null
}) {
  if (!collectionId) return null;
  const existing = await pool.query(
    `SELECT id
     FROM collection_items
     WHERE collection_id = $1
       AND COALESCE(media_id, 0) = COALESCE($2, 0)
       AND COALESCE(contained_title, '') = COALESCE($3, '')
     ORDER BY id DESC
     LIMIT 1`,
    [collectionId, mediaId || null, containedTitle || null]
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;
  const inserted = await pool.query(
    `INSERT INTO collection_items (
       collection_id, media_id, contained_title, position, confidence_score, source_payload
     )
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)
     RETURNING id`,
    [
      collectionId,
      mediaId || null,
      containedTitle || null,
      Number.isFinite(Number(position)) ? Number(position) : null,
      Number.isFinite(Number(confidenceScore)) ? Number(confidenceScore) : null,
      sourcePayload ? JSON.stringify(sourcePayload) : null
    ]
  );
  return inserted.rows[0]?.id || null;
}

async function loadMediaForImportReview(mediaId, scopeContext = null) {
  const params = [mediaId];
  const scopeClause = appendScopeSql(params, scopeContext);
  const mediaResult = await pool.query(
    `SELECT
       id, title, media_type, original_title, release_date, year, format, genre, director,
       cast_members AS cast, rating, user_rating, tmdb_id, tmdb_media_type, tmdb_url,
       poster_path, backdrop_path, overview, trailer_url, runtime, upc, type_details,
       import_source
     FROM media
     WHERE id = $1
     ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!mediaResult.rows[0]) return null;

  const metaResult = await pool.query(
    `SELECT "key", "value"
     FROM media_metadata
     WHERE media_id = $1
       AND "key" IN ('isbn', 'ean', 'ean_upc', 'upc', 'amazon_item_id')`,
    [mediaId]
  );
  const metadata = {};
  for (const row of metaResult.rows) {
    metadata[row.key] = row.value;
  }
  return { media: mediaResult.rows[0], metadata };
}

async function applyImportReviewEnrichment({ mediaId, scopeContext = null }) {
  const loaded = await loadMediaForImportReview(mediaId, scopeContext);
  if (!loaded?.media) return { applied: false, reason: 'media_not_found' };
  const { media, metadata } = loaded;

  const identifiers = resolveImportIdentifiers(media, {
    isbn: metadata.isbn || media?.type_details?.isbn || '',
    ean_upc: metadata.ean_upc || metadata.ean || metadata.upc || media.upc || '',
    asin: metadata.amazon_item_id || ''
  });
  const config = await loadAdminIntegrationConfig();
  const caches = { tmdbCache: new Map(), providerCache: new Map() };
  const enrichmentResult = await runImportEnrichmentPipeline(
    { ...media, identifiers },
    config,
    caches,
    identifiers
  );
  const enriched = enrichmentResult.item || media;
  const normalizedType = normalizeMediaType(media.media_type || 'movie', 'movie');
  const normalizedTypeDetailsResult = normalizeTypeDetails(normalizedType, enriched.type_details, { strict: true });
  if ((normalizedTypeDetailsResult.invalidKeys || []).length > 0) {
    throw new Error(`Invalid type_details key(s) for ${normalizedType}: ${normalizedTypeDetailsResult.invalidKeys.join(', ')}`);
  }
  if ((normalizedTypeDetailsResult.errors || []).length > 0) {
    throw new Error(`Invalid type_details values for ${normalizedType}: ${normalizedTypeDetailsResult.errors.map((entry) => `${entry.key}: ${entry.message}`).join('; ')}`);
  }
  const normalizedTypeDetails = normalizedTypeDetailsResult.value;

  await pool.query(
    `UPDATE media SET
       original_title = COALESCE($1, original_title),
       release_date = COALESCE($2, release_date),
       year = COALESCE($3, year),
       genre = COALESCE($4, genre),
       director = COALESCE($5, director),
       cast_members = COALESCE($6, cast_members),
       rating = COALESCE($7, rating),
       user_rating = COALESCE($8, user_rating),
       tmdb_id = COALESCE($9, tmdb_id),
       tmdb_media_type = COALESCE($10, tmdb_media_type),
       tmdb_url = COALESCE($11, tmdb_url),
       poster_path = COALESCE($12, poster_path),
       backdrop_path = COALESCE($13, backdrop_path),
       overview = COALESCE($14, overview),
       trailer_url = COALESCE($15, trailer_url),
       runtime = COALESCE($16, runtime),
       upc = COALESCE($17, upc),
       type_details = COALESCE($18::jsonb, type_details)
     WHERE id = $19`,
    [
      enriched.original_title || null,
      enriched.release_date || null,
      enriched.year || null,
      enriched.genre || null,
      enriched.director || null,
      enriched.cast || null,
      enriched.rating || null,
      enriched.user_rating || null,
      enriched.tmdb_id || null,
      enriched.tmdb_media_type || null,
      enriched.tmdb_url || null,
      enriched.poster_path || null,
      enriched.backdrop_path || null,
      enriched.overview || null,
      enriched.trailer_url || null,
      enriched.runtime || null,
      enriched.upc || null,
      normalizedTypeDetails ? JSON.stringify(normalizedTypeDetails) : null,
      mediaId
    ]
  );

  await syncNormalizedMetadataForMedia({
    mediaId,
    genre: enriched.genre || null,
    director: enriched.director || null,
    cast: enriched.cast || null
  });

  return {
    applied: true,
    enrichmentStatus: enrichmentResult.enrichmentStatus
  };
}

async function runPlexImport({ req, config, sectionIds = [], scopeContext = null, onProgress = null }) {
  const summary = { created: 0, updated: 0, skipped: 0, errors: [], enrichmentErrors: [] };
  let tmdbPosterEnriched = 0;
  let tmdbPosterLookupMisses = 0;
  let variantsCreated = 0;
  let variantsUpdated = 0;
  let seasonsCreated = 0;
  let seasonsUpdated = 0;
  const processedShowSeasonKeys = new Set();
  let items = [];
  const tmdbEnrichmentCache = new Map();
  const providerEnrichmentCache = new Map();
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
  const upsertMediaSeason = async (mediaId, mediaRow, variant) => {
    if (!mediaId || !mediaRow || mediaRow.media_type !== 'tv_series') return;
    const fromVariant = Number(variant?.season_number);
    const fromMedia = Number(mediaRow?.season_number);
    let seasonNumber = Number.isInteger(fromVariant) && fromVariant > 0 ? fromVariant : null;
    if (!seasonNumber && Number.isInteger(fromMedia) && fromMedia > 0) seasonNumber = fromMedia;
    if (!seasonNumber && variant?.source_item_key) {
      const keyMatch = String(variant.source_item_key).match(/:season:(\d+)/i);
      if (keyMatch?.[1]) seasonNumber = Number(keyMatch[1]);
    }
    if (!seasonNumber && variant?.edition) {
      const editionMatch = String(variant.edition).match(/season\s*(\d+)/i);
      if (editionMatch?.[1]) seasonNumber = Number(editionMatch[1]);
    }
    if (!Number.isInteger(seasonNumber) || seasonNumber <= 0) return;

    const updated = await pool.query(
      `UPDATE media_seasons
       SET source = $3
       WHERE media_id = $1
         AND season_number = $2
       RETURNING id`,
      [mediaId, seasonNumber, variant?.source || 'plex']
    );
    if (updated.rows.length > 0) {
      seasonsUpdated += 1;
      return;
    }
    await pool.query(
      `INSERT INTO media_seasons (media_id, season_number, source)
       VALUES ($1, $2, $3)
       ON CONFLICT (media_id, season_number) DO NOTHING`,
      [mediaId, seasonNumber, variant?.source || 'plex']
    );
    seasonsCreated += 1;
  };
  const upsertPlexShowSeasons = async (mediaId, sectionId, plexRatingKey) => {
    if (!mediaId || !sectionId || !plexRatingKey) return;
    const dedupeKey = `${sectionId}:${plexRatingKey}`;
    if (processedShowSeasonKeys.has(dedupeKey)) return;
    processedShowSeasonKeys.add(dedupeKey);
    let seasons = [];
    try {
      seasons = await fetchPlexShowSeasons(config, plexRatingKey);
    } catch (error) {
      summary.enrichmentErrors.push({
        title: `show:${plexRatingKey}`,
        type: 'plex_season_fetch',
        detail: error.message || 'Plex season fetch failed'
      });
      return;
    }
    for (const season of seasons) {
      const seasonNumber = Number(season?.season_number);
      if (!Number.isInteger(seasonNumber) || seasonNumber <= 0) continue;
      const availableEpisodes = Number.isInteger(Number(season?.available_episodes))
        ? Number(season.available_episodes)
        : null;
      const watchedEpisodes = Number.isInteger(Number(season?.watched_episodes))
        ? Number(season.watched_episodes)
        : 0;
      let watchState = 'unwatched';
      if (availableEpisodes !== null && watchedEpisodes >= availableEpisodes && availableEpisodes > 0) {
        watchState = 'completed';
      } else if (watchedEpisodes > 0) {
        watchState = 'in_progress';
      }
      const updated = await pool.query(
        `UPDATE media_seasons
         SET source = 'plex',
             available_episodes = COALESCE($3, available_episodes),
             watch_state = $4,
             is_complete = CASE
               WHEN expected_episodes IS NOT NULL
                AND expected_episodes > 0
                AND COALESCE($3, available_episodes) IS NOT NULL
                AND COALESCE($3, available_episodes) >= expected_episodes
                 THEN TRUE
               ELSE is_complete
             END
         WHERE media_id = $1
           AND season_number = $2
         RETURNING id`,
        [mediaId, seasonNumber, availableEpisodes, watchState]
      );
      if (updated.rows.length > 0) {
        seasonsUpdated += 1;
        continue;
      }
      await pool.query(
        `INSERT INTO media_seasons (media_id, season_number, source, available_episodes, watch_state, is_complete)
         VALUES ($1, $2, 'plex', $3, $4, FALSE)
         ON CONFLICT (media_id, season_number) DO NOTHING`,
        [
          mediaId,
          seasonNumber,
          availableEpisodes,
          watchState
        ]
      );
      seasonsCreated += 1;
    }
  };
  const tmdbSeasonSummaryCache = new Map();
  const hydrateTmdbSeasonExpectedCounts = async (mediaId, tmdbId) => {
    if (!mediaId || !tmdbId || !config.tmdbApiKey) return;
    const cacheKey = String(tmdbId);
    let summaries = tmdbSeasonSummaryCache.get(cacheKey);
    if (summaries === undefined) {
      try {
        await throttleTmdb();
        summaries = await fetchTmdbTvShowSeasonSummary(tmdbId, config);
      } catch (error) {
        summaries = [];
        summary.enrichmentErrors.push({
          title: `tmdb:${tmdbId}`,
          type: 'tmdb_season_summary_fetch',
          detail: error.message || 'TMDB season summary fetch failed'
        });
      }
      tmdbSeasonSummaryCache.set(cacheKey, summaries);
    }
    if (!Array.isArray(summaries) || summaries.length === 0) return;
    for (const season of summaries) {
      if (!Number.isInteger(season?.season_number) || season.season_number <= 0) continue;
      if (!Number.isInteger(season?.episode_count) || season.episode_count <= 0) continue;
      await pool.query(
        `UPDATE media_seasons
         SET expected_episodes = $3,
             is_complete = CASE
               WHEN available_episodes IS NOT NULL AND $3 IS NOT NULL AND $3 > 0 AND available_episodes >= $3 THEN TRUE
               ELSE FALSE
             END
         WHERE media_id = $1
           AND season_number = $2
           AND (expected_episodes IS DISTINCT FROM $3)`,
        [mediaId, season.season_number, season.episode_count]
      );
    }
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
    let media = { ...item.normalized };
    if (!media.title) {
      summary.skipped += 1;
      continue;
    }

    media = await enrichImportItemByMediaType(media, config, providerEnrichmentCache);

    const mediaType = normalizeMediaType(media.media_type || item.normalized.media_type || 'movie', 'movie');
    const canUseTmdb = mediaType === 'movie' || mediaType === 'tv_series' || mediaType === 'tv_episode';
    if (config.tmdbApiKey && canUseTmdb && (!media.poster_path || !media.cast || !media.director)) {
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
              backdrop_path: details?.backdrop_path || null,
              director: details?.director || null,
              cast: details?.cast || null
            };
          } else if (media.title) {
            const results = await searchTmdbMovie(media.title, media.year || undefined, config, tmdbType);
            const best = pickBestTmdbMatch(results, media.title, media.year);
            if (best) {
              let details = null;
              try {
                if (best.id) {
                  details = await fetchTmdbMovieDetails(best.id, config, tmdbType);
                }
              } catch (_) {
                details = null;
              }
              cached = {
                tmdb_id: best.id || null,
                tmdb_url: details?.tmdb_url || (best.id ? `https://www.themoviedb.org/${tmdbType}/${best.id}` : null),
                poster_path: details?.poster_path || best.poster_path || null,
                backdrop_path: details?.backdrop_path || best.backdrop_path || null,
                director: details?.director || null,
                cast: details?.cast || null
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

      if (cached) {
        media.poster_path = media.poster_path || cached.poster_path || null;
        media.backdrop_path = media.backdrop_path || cached.backdrop_path || media.poster_path || null;
        media.tmdb_id = media.tmdb_id || cached.tmdb_id || null;
        media.tmdb_url = media.tmdb_url || cached.tmdb_url || (media.tmdb_id ? `https://www.themoviedb.org/${tmdbType}/${media.tmdb_id}` : null);
        media.director = media.director || cached.director || null;
        media.cast = media.cast || cached.cast || null;
      }
      if (cached?.poster_path) {
        tmdbPosterEnriched += 1;
      } else {
        tmdbPosterLookupMisses += 1;
      }
    }

    try {
      const plexGuid = media.plex_guid || null;
      const rawPlexRatingKey = media.plex_rating_key || item.raw?.ratingKey || item.raw?.key || null;
      const plexRatingKey = parsePlexRatingKeyFromItemKey(rawPlexRatingKey);
      const rawPlexItemKey = rawPlexRatingKey ? `${item.sectionId}:${rawPlexRatingKey}` : null;
      const plexItemKey = plexRatingKey ? `${item.sectionId}:${plexRatingKey}` : rawPlexItemKey;
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

        if (!existing && (plexItemKey || rawPlexItemKey)) {
        const byPlexItemKeyCandidates = [...new Set([plexItemKey, rawPlexItemKey].filter(Boolean))];
        const byPlexItemKeyParams = [byPlexItemKeyCandidates];
        const byPlexItemKeyScopeClause = appendScopeSql(byPlexItemKeyParams, scopeContext, {
          spaceColumn: 'm.space_id',
          libraryColumn: 'm.library_id'
        });
        const byPlexItemKey = await pool.query(
          `SELECT m.id
           FROM media m
           JOIN media_metadata mm ON mm.media_id = m.id
           WHERE mm."key" = 'plex_item_key'
             AND mm."value" = ANY($1::text[])
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
          media.cast,
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
             cast_members = COALESCE($6, cast_members),
             rating = COALESCE($7, rating),
             runtime = COALESCE($8, runtime),
             poster_path = COALESCE($9, poster_path),
             backdrop_path = COALESCE($10, backdrop_path),
             overview = COALESCE($11, overview),
             tmdb_id = COALESCE($12, tmdb_id),
             tmdb_media_type = COALESCE($13, tmdb_media_type),
             tmdb_url = COALESCE($14, tmdb_url),
             media_type = COALESCE($15, media_type),
             network = COALESCE($16, network),
             notes = COALESCE($17, notes),
             import_source = 'plex'
           WHERE id = $18${updateScopeClause}
           RETURNING id, genre, director, cast_members AS cast`,
          updateParams
        );
        const refreshed = await pool.query('SELECT id, genre, director, cast_members AS cast FROM media WHERE id = $1', [existing.id]);
        const updatedRow = refreshed.rows[0] || { id: existing.id, genre: null, director: media.director || null, cast: media.cast || null };
        await syncNormalizedMetadataForMedia({
          mediaId: updatedRow.id,
          genre: updatedRow.genre,
          director: updatedRow.director,
          cast: updatedRow.cast
        });
        await upsertMediaMetadata(existing.id, 'plex_guid', plexGuid);
        await upsertMediaMetadata(existing.id, 'plex_item_key', plexItemKey);
        await upsertMediaMetadata(existing.id, 'plex_section_id', item.sectionId);
        await upsertMediaVariant(existing.id, item.variant);
        await upsertMediaSeason(existing.id, media, item.variant);
        await upsertPlexShowSeasons(existing.id, item.sectionId, plexRatingKey);
        await hydrateTmdbSeasonExpectedCounts(existing.id, media.tmdb_id);
          summary.updated += 1;
        } else {
        const inserted = await pool.query(
          `INSERT INTO media (
             title, original_title, release_date, year, format, director, cast_members, rating,
             runtime, poster_path, backdrop_path, overview, tmdb_id, tmdb_media_type, tmdb_url, media_type, network, notes,
             library_id, space_id, added_by, import_source
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
           )
           RETURNING id, genre, director, cast_members AS cast`,
          [
            media.title,
            media.original_title,
            media.release_date,
            media.year,
            media.format || 'Digital',
            media.director,
            media.cast,
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
          const insertedRow = inserted.rows[0] || null;
          const insertedId = insertedRow?.id;
          if (insertedId) {
          await syncNormalizedMetadataForMedia({
            mediaId: insertedId,
            genre: insertedRow.genre,
            director: insertedRow.director,
            cast: insertedRow.cast
          });
          await upsertMediaMetadata(insertedId, 'plex_guid', plexGuid);
          await upsertMediaMetadata(insertedId, 'plex_item_key', plexItemKey);
          await upsertMediaMetadata(insertedId, 'plex_section_id', item.sectionId);
          await upsertMediaVariant(insertedId, item.variant);
          await upsertMediaSeason(insertedId, media, item.variant);
          await upsertPlexShowSeasons(insertedId, item.sectionId, plexRatingKey);
          await hydrateTmdbSeasonExpectedCounts(insertedId, media.tmdb_id);
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
    variantsUpdated,
    seasonsCreated,
    seasonsUpdated
  };
}

async function runMetronImport({ req, config, scopeContext = null, onProgress = null }) {
  const summary = { created: 0, updated: 0, skipped: 0, skipped_existing: 0, errors: [] };
  const detailCache = new Map();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const fetchDetailWithRetry = async (providerIssueId) => {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await fetchMetronIssueDetails(config, providerIssueId);
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await sleep(300 * (attempt + 1));
        }
      }
    }
    throw lastError || new Error('Metron detail lookup failed');
  };
  const updateProgress = async (progress) => {
    if (typeof onProgress !== 'function') return;
    await onProgress(progress);
  };

  const { issues, endpoint } = await fetchMetronCollectionIssues(config, { limit: 2500 });
  const incomingProviderIssueIds = [...new Set(
    issues
      .map((issue) => String(issue?.type_details?.provider_issue_id || issue?.id || '').trim())
      .filter(Boolean)
  )];
  const existingProviderIssueIds = new Set();
  if (incomingProviderIssueIds.length > 0) {
    const existingParams = [incomingProviderIssueIds];
    const existingScopeClause = appendScopeSql(existingParams, scopeContext, {
      spaceColumn: 'm.space_id',
      libraryColumn: 'm.library_id'
    });
    const existing = await pool.query(
      `SELECT DISTINCT COALESCE(m.type_details->>'provider_issue_id', '') AS provider_issue_id
       FROM media m
       WHERE m.media_type = 'comic_book'
         AND COALESCE(m.type_details->>'provider_issue_id', '') = ANY($1::text[])
         ${existingScopeClause}`,
      existingParams
    );
    for (const row of existing.rows || []) {
      const value = String(row?.provider_issue_id || '').trim();
      if (value) existingProviderIssueIds.add(value);
    }
  }
  const pendingIssues = issues.filter((issue) => {
    const providerIssueId = String(issue?.type_details?.provider_issue_id || issue?.id || '').trim();
    if (!providerIssueId) return true;
    return !existingProviderIssueIds.has(providerIssueId);
  });
  summary.skipped_existing = issues.length - pendingIssues.length;

  await updateProgress({
    total: pendingIssues.length,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: summary.skipped_existing,
    errorCount: 0
  });

  for (let idx = 0; idx < pendingIssues.length; idx += 1) {
    const issue = pendingIssues[idx];
    if (!issue?.title) {
      summary.skipped += 1;
      continue;
    }
    try {
      let mergedIssue = issue;
      const providerIssueId = String(issue?.type_details?.provider_issue_id || issue?.id || '').trim();
      if (providerIssueId) {
        if (!detailCache.has(providerIssueId)) {
          try {
            const detailed = await fetchDetailWithRetry(providerIssueId);
            detailCache.set(providerIssueId, detailed);
          } catch (_detailError) {
            detailCache.set(providerIssueId, null);
          }
        }
        const detailed = detailCache.get(providerIssueId);
        if (detailed) {
          mergedIssue = {
            ...issue,
            ...detailed,
            type_details: {
              ...(issue.type_details || {}),
              ...(detailed.type_details || {}),
              provider_issue_id: providerIssueId
            },
            tmdb_url: detailed.external_url || issue.external_url || null,
            poster_path: detailed.poster_path || issue.poster_path || null,
            overview: detailed.overview || issue.overview || null,
            upc: detailed.upc || issue.upc || null
          };
        }
      }

      const prepared = {
        title: mergedIssue.title,
        media_type: 'comic_book',
        year: mergedIssue.year || null,
        release_date: mergedIssue.release_date || null,
        format: 'Digital',
        overview: mergedIssue.overview || null,
        tmdb_url: mergedIssue.external_url || null,
        poster_path: mergedIssue.poster_path || null,
        upc: mergedIssue.upc || null,
        type_details: {
          ...(mergedIssue.type_details || {}),
          provider_issue_id: providerIssueId || null
        },
        library_id: scopeContext?.libraryId || null,
        space_id: scopeContext?.spaceId || null
      };
      const result = await upsertImportedMedia({
        userId: req.user.id,
        item: prepared,
        importSource: 'metron',
        scopeContext
      });
      if (result.type === 'created') summary.created += 1;
      else if (result.type === 'updated') summary.updated += 1;
      else summary.skipped += 1;
      if (result.mediaId && issue.id) {
        await upsertMediaMetadataEntry(result.mediaId, 'metron_issue_id', issue.id);
      }
    } catch (error) {
      summary.errors.push({ title: issue.title, detail: error.message || 'Metron import failed' });
    }

    const processed = idx + 1;
    if (processed === pendingIssues.length || processed % CSV_JOB_PROGRESS_BATCH_SIZE === 0) {
      await updateProgress({
        total: pendingIssues.length,
        processed,
        created: summary.created,
        updated: summary.updated,
        skipped: summary.skipped + summary.skipped_existing,
        errorCount: summary.errors.length
      });
    }
  }

  return {
    imported: pendingIssues.length,
    totalAvailable: issues.length,
    summary,
    collectionEndpoint: endpoint
  };
}

async function maybePushComicToMetron({ req, mediaRow }) {
  if (!mediaRow || mediaRow.media_type !== 'comic_book') return;
  const config = await loadAdminIntegrationConfig();
  if (String(config.comicsProvider || '').toLowerCase() !== 'metron') return;
  if (!config.comicsApiKey || !config.comicsApiUrl) return;

  const details = mediaRow.type_details && typeof mediaRow.type_details === 'object'
    ? mediaRow.type_details
    : {};
  let issueId = details.provider_issue_id || null;
  if (!issueId) {
    try {
      const matches = await searchComicsByTitle(String(mediaRow.title || '').trim(), config, 6);
      const best = pickBestProviderMatch(matches, mediaRow.title, mediaRow.year);
      issueId = best?.id || null;
    } catch (_error) {
      issueId = null;
    }
  }
  if (!issueId) return;

  try {
    await pushMetronCollectionIssue(config, issueId);
    await logActivity(req, 'media.metron.push.success', 'media', mediaRow.id, {
      issueId: String(issueId),
      title: mediaRow.title
    });
  } catch (error) {
    await logActivity(req, 'media.metron.push.failed', 'media', mediaRow.id, {
      issueId: String(issueId),
      title: mediaRow.title,
      detail: error.message || 'Metron push failed'
    });
  }
}

async function runGenericCsvImport({
  rows,
  userId,
  scopeContext,
  onProgress = null,
  importSource = 'csv_generic',
  reviewContext = null
}) {
  const summary = {
    created: 0,
    updated: 0,
    skipped_invalid: 0,
    reviewQueued: 0,
    collectionsDetected: 0,
    collectionsCreated: 0,
    collectionItemsSeeded: 0,
    errors: [],
    matchModes: buildImportMatchCounters(),
    enrichment: buildImportEnrichmentCounters()
  };
  const auditRows = [];
  const config = await loadAdminIntegrationConfig();
  const caches = { tmdbCache: new Map(), providerCache: new Map() };
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
      cast: value('cast') || value('actors') || value('actor'),
      rating: value('rating') ? Number(value('rating')) : null,
      user_rating: value('user_rating') ? Number(value('user_rating')) : null,
      runtime: value('runtime') ? Number(value('runtime')) : null,
      upc: value('upc'),
      signed_by: value('signed_by') || value('signed by'),
      signed_role: normalizeSignedRole(value('signed_role') || value('signed role')),
      signed_on: parseDateOnly(value('signed_on') || value('signed on')),
      signed_at: value('signed_at') || value('signed at'),
      location: value('location'),
      notes: value('notes'),
      type_details: {
        author: value('author'),
        isbn: value('isbn') || value('isbn13'),
        publisher: value('publisher'),
        edition: value('edition'),
        series: value('series'),
        issue_number: value('issue_number') || value('issue number'),
        volume: value('volume'),
        artist: value('artist'),
        album: value('album'),
        track_count: value('track_count'),
        platform: value('platform'),
        developer: value('developer'),
        region: value('region')
      }
    };
    let collectionId = null;
    const boxedSet = detectBoxedSetCandidate(mapped.title, mapped.notes);
    if (boxedSet.isCandidate) {
      summary.collectionsDetected += 1;
      const collection = await ensureImportCollection({
        userId,
        scopeContext,
        importSource,
        mediaType: mapped.media_type || 'movie',
        sourceTitle: mapped.title,
        expectedItemCount: boxedSet.expectedItemCount,
        metadata: {
          detectedBy: 'title_pattern',
          rowNumber: idx + 2
        }
      });
      collectionId = collection.id;
      if (collectionId) {
        if (collection.created) summary.collectionsCreated += 1;
        if (boxedSet.containedTitles.length > 0) {
          for (let ci = 0; ci < boxedSet.containedTitles.length; ci += 1) {
            const containedTitle = boxedSet.containedTitles[ci];
            const itemId = await addCollectionItem({
              collectionId,
              containedTitle,
              position: ci + 1,
              confidenceScore: 40,
              sourcePayload: { source: 'import_parse' }
            });
            if (itemId) summary.collectionItemsSeeded += 1;
          }
        }
      }
    }
    const rowIdentifiers = normalizeIdentifierSet({
      isbn: value('isbn') || value('isbn13'),
      ean_upc: value('ean') || value('upc') || value('ean_upc'),
      asin: value('asin') || value('amazon_item_id') || value('amazon_link') || value('amazon link')
    });
    try {
      const enrichmentResult = await runImportEnrichmentPipeline(
        { ...mapped, identifiers: rowIdentifiers },
        config,
        caches,
        rowIdentifiers
      );
      const enriched = enrichmentResult.item;
      incrementImportEnrichmentCounter(summary.enrichment, enrichmentResult.enrichmentStatus);
      const result = await upsertImportedMedia({
        userId,
        item: enriched,
        importSource,
        scopeContext,
        identifiers: rowIdentifiers
      });
      if (result.mediaId) {
        await upsertMediaMetadataEntry(result.mediaId, 'isbn', rowIdentifiers.isbn);
        await upsertMediaMetadataEntry(result.mediaId, 'ean', rowIdentifiers.eanUpc);
        await upsertMediaMetadataEntry(result.mediaId, 'ean_upc', rowIdentifiers.eanUpc);
        await upsertMediaMetadataEntry(result.mediaId, 'amazon_item_id', rowIdentifiers.asin);
        if (collectionId) {
          const itemId = await addCollectionItem({
            collectionId,
            mediaId: result.mediaId,
            containedTitle: mapped.title || null,
            sourcePayload: { source: 'import_upsert' }
          });
          if (itemId) summary.collectionItemsSeeded += 1;
        }
      }
      incrementImportMatchCounter(summary.matchModes, result.matchMode);
      const confidenceScore = deriveImportConfidenceScore({
        matchMode: result.matchMode,
        matchedBy: result.matchedBy,
        enrichmentStatus: enrichmentResult.enrichmentStatus
      });
      const reviewNeeded = shouldQueueImportReview({
        matchMode: result.matchMode,
        enrichmentStatus: enrichmentResult.enrichmentStatus,
        confidenceScore
      });
      if (reviewNeeded && isDebugAt(2)) {
        await enqueueImportMatchReview({
          userId,
          scopeContext,
          jobId: reviewContext?.jobId || null,
          importSource,
          provider: reviewContext?.provider || 'csv_generic',
          rowNumber: idx + 2,
          sourceTitle: mapped.title || '',
          mediaType: mapped.media_type || 'movie',
          matchMode: result.matchMode || null,
          matchedBy: result.matchedBy || null,
          enrichmentStatus: enrichmentResult.enrichmentStatus,
          proposedMediaId: result.mediaId || null,
          confidenceScore,
          sourcePayload: {
            identifiers: rowIdentifiers,
            status: result.type
          },
          collectionId
        });
        summary.reviewQueued += 1;
      }
      if (result.type === 'created') {
        summary.created += 1;
        auditRows.push({
          row: idx + 2,
          title: mapped.title || '',
          status: 'created',
          detail: '',
          match_mode: result.matchMode || null,
          matched_by: result.matchedBy || null,
          enrichment_status: enrichmentResult.enrichmentStatus,
          confidence_score: confidenceScore,
          review_queued: reviewNeeded,
          isbn: rowIdentifiers.isbn || '',
          ean_upc: rowIdentifiers.eanUpc || '',
          asin: rowIdentifiers.asin || ''
        });
      } else if (result.type === 'updated') {
        summary.updated += 1;
        auditRows.push({
          row: idx + 2,
          title: mapped.title || '',
          status: 'updated',
          detail: '',
          match_mode: result.matchMode || null,
          matched_by: result.matchedBy || null,
          enrichment_status: enrichmentResult.enrichmentStatus,
          confidence_score: confidenceScore,
          review_queued: reviewNeeded,
          isbn: rowIdentifiers.isbn || '',
          ean_upc: rowIdentifiers.eanUpc || '',
          asin: rowIdentifiers.asin || ''
        });
      } else {
        summary.skipped_invalid += 1;
        auditRows.push({
          row: idx + 2,
          title: mapped.title || '',
          status: 'skipped_invalid',
          detail: result.detail || 'Invalid row',
          match_mode: result.matchMode || null,
          matched_by: result.matchedBy || null,
          enrichment_status: enrichmentResult.enrichmentStatus,
          confidence_score: confidenceScore,
          review_queued: reviewNeeded,
          isbn: rowIdentifiers.isbn || '',
          ean_upc: rowIdentifiers.eanUpc || '',
          asin: rowIdentifiers.asin || ''
        });
      }
    } catch (error) {
      summary.errors.push({ row: idx + 2, detail: error.message });
      auditRows.push({
        row: idx + 2,
        title: mapped.title || '',
        status: 'error',
        detail: error.message,
        enrichment_status: 'not_attempted'
      });
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

async function runDeliciousCsvImport({
  rows,
  userId,
  scopeContext,
  onProgress = null,
  reviewContext = null
}) {
  const summary = {
    created: 0,
    updated: 0,
    skipped_non_movie: 0,
    skipped_invalid: 0,
    reviewQueued: 0,
    collectionsDetected: 0,
    collectionsCreated: 0,
    collectionItemsSeeded: 0,
    errors: [],
    matchModes: buildImportMatchCounters(),
    enrichment: buildImportEnrichmentCounters()
  };
  const auditRows = [];
  const config = await loadAdminIntegrationConfig();
  const caches = { tmdbCache: new Map(), providerCache: new Map() };
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
    const normalizedRow = normalizeDeliciousRow(row);
    const itemType = String(normalizedRow.itemType || '').trim().toLowerCase();
    const mappedMediaType = mapDeliciousItemTypeToMediaType(itemType);
    if (!mappedMediaType) {
      summary.skipped_non_movie += 1;
      auditRows.push({
        row: idx + 2,
        title: normalizedRow.rawTitle,
        status: 'skipped_non_movie',
        detail: `unmapped item type: ${itemType || 'unknown'}`,
        enrichment_status: 'not_applicable'
      });
    } else {
      const title = normalizedRow.normalizedTitle;
      if (!title) {
        summary.skipped_invalid += 1;
        auditRows.push({
          row: idx + 2,
          title: '',
          status: 'skipped_invalid',
          detail: 'Missing title',
          match_mode: null,
          matched_by: null,
          enrichment_status: 'not_attempted',
          isbn: '',
          ean_upc: '',
          asin: ''
        });
      } else {
        const sourceNotes = [normalizedRow.notesRaw];
        if (normalizedRow.edition) sourceNotes.push(`Edition: ${normalizedRow.edition}`);
        if (normalizedRow.normalizedPlatform) sourceNotes.push(`Platform: ${normalizedRow.normalizedPlatform}`);
        const mapped = {
          title,
          media_type: mappedMediaType,
          original_title: normalizedRow.rawTitle && normalizedRow.rawTitle !== title ? normalizedRow.rawTitle : null,
          year: parseYear(normalizedRow.releaseDateRaw) || parseYear(normalizedRow.creationDateRaw),
          release_date: parseDateOnly(normalizedRow.releaseDateRaw),
          format: normalizeMediaFormat(normalizedRow.formatRaw),
          genre: null,
          director: normalizedRow.creator || null,
          user_rating: normalizedRow.ratingRaw ? Number(normalizedRow.ratingRaw) : null,
          upc: normalizedRow.ean || null,
          signed_by: normalizedRow.signedBy || null,
          signed_role: normalizeSignedRole(normalizedRow.signedRole) || null,
          signed_on: parseDateOnly(normalizedRow.signedOnRaw),
          signed_at: normalizedRow.signedAt || null,
          notes: sourceNotes.filter(Boolean).join(' | ') || null,
          type_details: {
            author: normalizedRow.creator || null,
            isbn: normalizedRow.isbn || null,
            edition: normalizedRow.edition || null,
            artist: normalizedRow.creator || null,
            album: title,
            platform: normalizedRow.normalizedPlatform || null
          }
        };
        let collectionId = null;
        const boxedSet = detectBoxedSetCandidate(title, mapped.notes);
        if (boxedSet.isCandidate) {
          summary.collectionsDetected += 1;
          const collection = await ensureImportCollection({
            userId,
            scopeContext,
            importSource: 'csv_delicious',
            mediaType: mapped.media_type || 'movie',
            sourceTitle: title,
            expectedItemCount: boxedSet.expectedItemCount,
            metadata: {
              detectedBy: 'title_pattern',
              rowNumber: idx + 2,
              itemType: itemType || null
            }
          });
          collectionId = collection.id;
          if (collectionId) {
            if (collection.created) summary.collectionsCreated += 1;
            if (boxedSet.containedTitles.length > 0) {
              for (let ci = 0; ci < boxedSet.containedTitles.length; ci += 1) {
                const itemId = await addCollectionItem({
                  collectionId,
                  containedTitle: boxedSet.containedTitles[ci],
                  position: ci + 1,
                  confidenceScore: 40,
                  sourcePayload: { source: 'import_parse' }
                });
                if (itemId) summary.collectionItemsSeeded += 1;
              }
            }
          }
        }
        const rowIdentifiers = normalizeIdentifierSet({
          isbn: normalizedRow.isbn || '',
          ean_upc: normalizedRow.ean || '',
          asin: normalizedRow.amazonItemId || ''
        });

        try {
          const enrichmentResult = await runImportEnrichmentPipeline(
            { ...mapped, identifiers: rowIdentifiers },
            config,
            caches,
            rowIdentifiers
          );
          const enriched = enrichmentResult.item;
          incrementImportEnrichmentCounter(summary.enrichment, enrichmentResult.enrichmentStatus);
          const result = await upsertImportedMedia({
            userId,
            item: enriched,
            importSource: 'csv_delicious',
            scopeContext,
            identifiers: rowIdentifiers
          });
          incrementImportMatchCounter(summary.matchModes, result.matchMode);
          const confidenceScore = deriveImportConfidenceScore({
            matchMode: result.matchMode,
            matchedBy: result.matchedBy,
            enrichmentStatus: enrichmentResult.enrichmentStatus
          });
          const reviewNeeded = shouldQueueImportReview({
            matchMode: result.matchMode,
            enrichmentStatus: enrichmentResult.enrichmentStatus,
            confidenceScore
          });
          if (reviewNeeded && isDebugAt(2)) {
            await enqueueImportMatchReview({
              userId,
              scopeContext,
              jobId: reviewContext?.jobId || null,
              importSource: 'csv_delicious',
              provider: reviewContext?.provider || 'csv_delicious',
              rowNumber: idx + 2,
              sourceTitle: title,
              mediaType: mapped.media_type || 'movie',
              matchMode: result.matchMode || null,
              matchedBy: result.matchedBy || null,
              enrichmentStatus: enrichmentResult.enrichmentStatus,
              proposedMediaId: result.mediaId || null,
              confidenceScore,
              sourcePayload: {
                identifiers: rowIdentifiers,
                itemType: itemType || null,
                status: result.type
              },
              collectionId
            });
            summary.reviewQueued += 1;
          }
          if (result.mediaId) {
            await upsertMediaMetadataEntry(result.mediaId, 'amazon_item_id', normalizedRow.amazonItemId);
            await upsertMediaMetadataEntry(result.mediaId, 'ean', normalizedRow.ean);
            await upsertMediaMetadataEntry(result.mediaId, 'ean_upc', normalizedRow.ean);
            await upsertMediaMetadataEntry(result.mediaId, 'isbn', normalizedRow.isbn);
            await upsertMediaMetadataEntry(result.mediaId, 'source_creator', normalizedRow.creator);
            await upsertMediaMetadataEntry(result.mediaId, 'source_edition', normalizedRow.edition);
            await upsertMediaMetadataEntry(result.mediaId, 'source_format', normalizedRow.formatRaw);
            await upsertMediaMetadataEntry(result.mediaId, 'normalized_platform', normalizedRow.normalizedPlatform);
            if (collectionId) {
              const itemId = await addCollectionItem({
                collectionId,
                mediaId: result.mediaId,
                containedTitle: title,
                sourcePayload: { source: 'import_upsert' }
              });
              if (itemId) summary.collectionItemsSeeded += 1;
            }
          }
          if (result.type === 'created') {
            summary.created += 1;
            auditRows.push({
              row: idx + 2,
              title,
              status: 'created',
              detail: '',
              match_mode: result.matchMode || null,
              matched_by: result.matchedBy || null,
              enrichment_status: enrichmentResult.enrichmentStatus,
              confidence_score: confidenceScore,
              review_queued: reviewNeeded,
              isbn: rowIdentifiers.isbn || '',
              ean_upc: rowIdentifiers.eanUpc || '',
              asin: rowIdentifiers.asin || ''
            });
          } else if (result.type === 'updated') {
            summary.updated += 1;
            auditRows.push({
              row: idx + 2,
              title,
              status: 'updated',
              detail: '',
              match_mode: result.matchMode || null,
              matched_by: result.matchedBy || null,
              enrichment_status: enrichmentResult.enrichmentStatus,
              confidence_score: confidenceScore,
              review_queued: reviewNeeded,
              isbn: rowIdentifiers.isbn || '',
              ean_upc: rowIdentifiers.eanUpc || '',
              asin: rowIdentifiers.asin || ''
            });
          } else {
            summary.skipped_invalid += 1;
            auditRows.push({
              row: idx + 2,
              title,
              status: 'skipped_invalid',
              detail: result.detail || 'Invalid row',
              match_mode: result.matchMode || null,
              matched_by: result.matchedBy || null,
              enrichment_status: enrichmentResult.enrichmentStatus,
              confidence_score: confidenceScore,
              review_queued: reviewNeeded,
              isbn: rowIdentifiers.isbn || '',
              ean_upc: rowIdentifiers.eanUpc || '',
              asin: rowIdentifiers.asin || ''
            });
          }
        } catch (error) {
          summary.errors.push({ row: idx + 2, detail: error.message });
          auditRows.push({
            row: idx + 2,
            title,
            status: 'error',
            detail: error.message,
            enrichment_status: 'not_attempted'
          });
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
  const normalizedMetadataReadEnabled = await isFeatureEnabled('metadata_normalized_read_enabled', true);
  const {
    format, search, page, limit,
    sortBy, sortDir,
    media_type,
    director, genre, cast, resolution,
    yearMin, yearMax,
    ratingMin, ratingMax,
    userRatingMin, userRatingMax
  } = req.query;
  const pageNum = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1;
  const mediaTypeFilter = String(media_type || '').toLowerCase();
  const maxLimit = mediaTypeFilter === 'comic_book' ? 5000 : 200;
  const limitNum = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(maxLimit, Number(limit))) : 50;
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
    if (normalizedMetadataReadEnabled) {
      where += ` AND (
        to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(original_title,'') || ' ' || coalesce(notes,'')) @@ plainto_tsquery('simple', $${tsqIdx})
        OR title ILIKE $${likeIdx}
        OR original_title ILIKE $${likeIdx}
        OR EXISTS (
          SELECT 1
          FROM media_directors md
          JOIN directors d ON d.id = md.director_id
          WHERE md.media_id = media.id
            AND d.name ILIKE $${likeIdx}
        )
        OR EXISTS (
          SELECT 1
          FROM media_genres mg
          JOIN genres g ON g.id = mg.genre_id
          WHERE mg.media_id = media.id
            AND g.name ILIKE $${likeIdx}
        )
        OR EXISTS (
          SELECT 1
          FROM media_actors ma
          JOIN actors a ON a.id = ma.actor_id
          WHERE ma.media_id = media.id
            AND a.name ILIKE $${likeIdx}
        )
        OR notes ILIKE $${likeIdx}
        OR COALESCE(type_details->>'series', '') ILIKE $${likeIdx}
        OR COALESCE(type_details->>'writer', '') ILIKE $${likeIdx}
        OR COALESCE(type_details->>'artist', '') ILIKE $${likeIdx}
      )`;
    } else {
      where += ` AND (
        to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(original_title,'') || ' ' || coalesce(director,'') || ' ' || coalesce(cast_members,'') || ' ' || coalesce(genre,'') || ' ' || coalesce(notes,'')) @@ plainto_tsquery('simple', $${tsqIdx})
        OR title ILIKE $${likeIdx}
        OR original_title ILIKE $${likeIdx}
        OR director ILIKE $${likeIdx}
        OR cast_members ILIKE $${likeIdx}
        OR genre ILIKE $${likeIdx}
        OR EXISTS (
          SELECT 1
          FROM media_directors md
          JOIN directors d ON d.id = md.director_id
          WHERE md.media_id = media.id
            AND d.name ILIKE $${likeIdx}
        )
        OR EXISTS (
          SELECT 1
          FROM media_genres mg
          JOIN genres g ON g.id = mg.genre_id
          WHERE mg.media_id = media.id
            AND g.name ILIKE $${likeIdx}
        )
        OR EXISTS (
          SELECT 1
          FROM media_actors ma
          JOIN actors a ON a.id = ma.actor_id
          WHERE ma.media_id = media.id
            AND a.name ILIKE $${likeIdx}
        )
        OR notes ILIKE $${likeIdx}
        OR COALESCE(type_details->>'series', '') ILIKE $${likeIdx}
        OR COALESCE(type_details->>'writer', '') ILIKE $${likeIdx}
        OR COALESCE(type_details->>'artist', '') ILIKE $${likeIdx}
      )`;
    }
  }

  if (director) {
    params.push(`%${director}%`);
    if (normalizedMetadataReadEnabled) {
      where += ` AND EXISTS (
        SELECT 1
        FROM media_directors md
        JOIN directors d ON d.id = md.director_id
        WHERE md.media_id = media.id
          AND d.name ILIKE $${params.length}
      )`;
    } else {
      where += ` AND (
        director ILIKE $${params.length}
        OR EXISTS (
          SELECT 1
          FROM media_directors md
          JOIN directors d ON d.id = md.director_id
          WHERE md.media_id = media.id
            AND d.name ILIKE $${params.length}
        )
      )`;
    }
  }

  if (genre) {
    params.push(`%${genre}%`);
    if (normalizedMetadataReadEnabled) {
      where += ` AND EXISTS (
        SELECT 1
        FROM media_genres mg
        JOIN genres g ON g.id = mg.genre_id
        WHERE mg.media_id = media.id
          AND g.name ILIKE $${params.length}
      )`;
    } else {
      where += ` AND (
        genre ILIKE $${params.length}
        OR EXISTS (
          SELECT 1
          FROM media_genres mg
          JOIN genres g ON g.id = mg.genre_id
          WHERE mg.media_id = media.id
            AND g.name ILIKE $${params.length}
        )
      )`;
    }
  }

  if (cast) {
    params.push(`%${cast}%`);
    if (normalizedMetadataReadEnabled) {
      where += ` AND EXISTS (
        SELECT 1
        FROM media_actors ma
        JOIN actors a ON a.id = ma.actor_id
        WHERE ma.media_id = media.id
          AND a.name ILIKE $${params.length}
      )`;
    } else {
      where += ` AND (
        cast_members ILIKE $${params.length}
        OR EXISTS (
          SELECT 1
          FROM media_actors ma
          JOIN actors a ON a.id = ma.actor_id
          WHERE ma.media_id = media.id
            AND a.name ILIKE $${params.length}
        )
      )`;
    }
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
    `SELECT media.*,
            COALESCE(season_stats.season_count, 0) AS tv_season_count,
            COALESCE(season_stats.completed_count, 0) AS tv_completed_season_count,
            CASE
              WHEN media.media_type = 'tv_series'
               AND COALESCE(season_stats.season_count, 0) > 0
               AND COALESCE(season_stats.season_count, 0) = COALESCE(season_stats.completed_count, 0)
                THEN TRUE
              ELSE FALSE
            END AS tv_all_seasons_completed
     FROM media
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS season_count,
              COUNT(*) FILTER (WHERE ms.is_complete = TRUE OR ms.watch_state = 'completed')::int AS completed_count
       FROM media_seasons ms
       WHERE ms.media_id = media.id
     ) season_stats ON TRUE
     ${where}
     ORDER BY ${sortExpression}
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );
  const normalizedItems = result.rows.map((row) => ({
    ...row,
    cast: row.cast || row.cast_members || null
  }));
  const totalPages = total > 0 ? Math.ceil(total / limitNum) : 1;
  res.json({
    items: normalizedItems,
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
    `SELECT id, media_type FROM media WHERE id = $1${mediaScopeClause}`,
    mediaScopeParams
  );
  const media = mediaResult.rows[0];
  if (!media) {
    return res.status(404).json({ error: 'Media item not found' });
  }
  if (media.media_type === 'tv_series') {
    const seasonsResult = await pool.query(
      `SELECT id, media_id, source, season_number, expected_episodes, available_episodes,
              is_complete, watch_state, watchlist, last_watched_at, created_at, updated_at
       FROM media_seasons
       WHERE media_id = $1
       ORDER BY season_number ASC`,
      [mediaId]
    );
    const rows = seasonsResult.rows.map((row) => ({
      id: row.id,
      media_id: row.media_id,
      source: row.source,
      source_item_key: `season:${row.season_number}`,
      edition: `Season ${row.season_number}`,
      season_number: row.season_number,
      expected_episodes: row.expected_episodes,
      available_episodes: row.available_episodes,
      is_complete: row.is_complete,
      watch_state: row.watch_state,
      watchlist: row.watchlist,
      last_watched_at: row.last_watched_at,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
    return res.json(rows);
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

router.get('/:id/tv-seasons', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return res.status(400).json({ error: 'Invalid media id' });
  }
  const mediaParams = [mediaId];
  const mediaScopeClause = appendScopeSql(mediaParams, scopeContext);
  const mediaResult = await pool.query(
    `SELECT id, media_type FROM media WHERE id = $1${mediaScopeClause}`,
    mediaParams
  );
  const media = mediaResult.rows[0];
  if (!media) return res.status(404).json({ error: 'Media item not found' });
  if (media.media_type !== 'tv_series') {
    return res.status(400).json({ error: 'TV seasons are only available for TV series' });
  }
  const seasonsResult = await pool.query(
    `SELECT id, media_id, season_number, expected_episodes, available_episodes, is_complete,
            watch_state, watchlist, last_watched_at, source, created_at, updated_at
     FROM media_seasons
     WHERE media_id = $1
     ORDER BY season_number ASC`,
    [mediaId]
  );
  res.json({ mediaId, seasons: seasonsResult.rows });
}));

router.get('/:id/tv-seasons/:seasonNumber', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  const seasonNumber = Number(req.params.seasonNumber);
  if (!Number.isFinite(mediaId) || mediaId <= 0 || !Number.isInteger(seasonNumber) || seasonNumber <= 0) {
    return res.status(400).json({ error: 'Invalid media id or season number' });
  }
  const mediaParams = [mediaId];
  const mediaScopeClause = appendScopeSql(mediaParams, scopeContext);
  const mediaResult = await pool.query(
    `SELECT id, media_type, tmdb_id
     FROM media
     WHERE id = $1${mediaScopeClause}`,
    mediaParams
  );
  const media = mediaResult.rows[0];
  if (!media) return res.status(404).json({ error: 'Media item not found' });
  if (media.media_type !== 'tv_series') {
    return res.status(400).json({ error: 'TV season details are only available for TV series' });
  }
  const seasonResult = await pool.query(
    `SELECT id, media_id, season_number, expected_episodes, available_episodes, is_complete,
            watch_state, watchlist, last_watched_at, source, created_at, updated_at
     FROM media_seasons
     WHERE media_id = $1
       AND season_number = $2`,
    [mediaId, seasonNumber]
  );
  const season = seasonResult.rows[0];
  if (!season) {
    return res.status(404).json({ error: 'Season not found for media item' });
  }
  if (Number(season.expected_episodes) === 0) {
    const normalized = await pool.query(
      `UPDATE media_seasons
       SET expected_episodes = NULL
       WHERE media_id = $1
         AND season_number = $2
       RETURNING id, media_id, season_number, expected_episodes, available_episodes, is_complete,
                 watch_state, watchlist, last_watched_at, source, created_at, updated_at`,
      [mediaId, seasonNumber]
    );
    if (normalized.rows[0]) {
      Object.assign(season, normalized.rows[0]);
    }
  }

  const plexMetaResult = await pool.query(
    `SELECT "value"
     FROM media_metadata
     WHERE media_id = $1
       AND "key" = 'plex_item_key'
     LIMIT 1`,
    [mediaId]
  );
  const plexItemKey = plexMetaResult.rows[0]?.value || null;
  const plexRatingKey = parsePlexRatingKeyFromItemKey(plexItemKey);

  let tmdb = null;
  let plexEpisodeState = { watchedEpisodeNumbers: [], availableEpisodeNumbers: [] };
  const needsIntegrationConfig = Boolean(media.tmdb_id) || Boolean(plexRatingKey);
  const config = needsIntegrationConfig ? await loadAdminIntegrationConfig() : null;
  if (media.tmdb_id && config) {
    try {
      tmdb = await fetchTmdbTvSeasonDetails(media.tmdb_id, seasonNumber, config);
      const expected = Number(tmdb?.episode_count);
      if (Number.isInteger(expected) && expected > 0 && season.expected_episodes !== expected) {
        const updated = await pool.query(
          `UPDATE media_seasons
           SET expected_episodes = $3
           WHERE media_id = $1
             AND season_number = $2
           RETURNING id, media_id, season_number, expected_episodes, available_episodes, is_complete,
                     watch_state, watchlist, last_watched_at, source, created_at, updated_at`,
          [mediaId, seasonNumber, expected]
        );
        if (updated.rows[0]) {
          res.json({ mediaId, season: updated.rows[0], tmdb });
          return;
        }
      }
    } catch (_error) {
      tmdb = null;
    }
  }
  if (plexRatingKey && config?.plexApiUrl && config?.plexApiKey) {
    try {
      plexEpisodeState = await fetchPlexSeasonEpisodeStates(config, plexRatingKey, seasonNumber);
    } catch (_error) {
      plexEpisodeState = { watchedEpisodeNumbers: [], availableEpisodeNumbers: [] };
    }
  }
  if (tmdb && Array.isArray(tmdb.episodes)) {
    const watched = new Set(plexEpisodeState.watchedEpisodeNumbers || []);
    const available = new Set(plexEpisodeState.availableEpisodeNumbers || []);
    tmdb.episodes = tmdb.episodes.map((episode) => ({
      ...episode,
      watched: watched.has(Number(episode.episode_number)),
      in_library: available.has(Number(episode.episode_number))
    }));
  }

  const hasAllEpisodes = Number.isFinite(Number(season?.available_episodes))
    && Number.isFinite(Number(season?.expected_episodes))
    ? Number(season.available_episodes) >= Number(season.expected_episodes)
    : null;

  res.json({
    mediaId,
    season,
    tmdb,
    plex: {
      ratingKey: plexRatingKey,
      watchedEpisodeNumbers: plexEpisodeState.watchedEpisodeNumbers,
      availableEpisodeNumbers: plexEpisodeState.availableEpisodeNumbers
    },
    derived: {
      hasAllEpisodes
    }
  });
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
  if (seasons.length > 0) {
    await pool.query(
      `DELETE FROM media_seasons
       WHERE media_id = $1
         AND source = $2
         AND season_number <> ALL($3::int[])`,
      [mediaId, source, seasons]
    );
  } else {
    await pool.query(
      `DELETE FROM media_seasons
       WHERE media_id = $1
         AND source = $2`,
      [mediaId, source]
    );
  }

  for (const season of seasons) {
    await pool.query(
      `INSERT INTO media_seasons (media_id, season_number, source)
       VALUES ($1, $2, $3)
       ON CONFLICT (media_id, season_number)
       DO UPDATE SET source = EXCLUDED.source`,
      [mediaId, season, source]
    );
  }

  await logActivity(req, 'media.tv_seasons.update', 'media', mediaId, {
    seasons
  });

  res.json({ ok: true, mediaId, seasons });
}));

router.patch('/:id/tv-seasons/:seasonNumber', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  const seasonNumber = Number(req.params.seasonNumber);
  if (!Number.isFinite(mediaId) || mediaId <= 0 || !Number.isInteger(seasonNumber) || seasonNumber <= 0) {
    return res.status(400).json({ error: 'Invalid media id or season number' });
  }

  const mediaParams = [mediaId];
  const mediaScopeClause = appendScopeSql(mediaParams, scopeContext);
  const mediaResult = await pool.query(
    `SELECT id, media_type FROM media WHERE id = $1${mediaScopeClause}`,
    mediaParams
  );
  const media = mediaResult.rows[0];
  if (!media) return res.status(404).json({ error: 'Media item not found' });
  if (media.media_type !== 'tv_series') {
    return res.status(400).json({ error: 'TV seasons can only be updated for TV series' });
  }

  const raw = req.body || {};
  const updates = {};
  if (raw.expected_episodes !== undefined) {
    const val = raw.expected_episodes === null || raw.expected_episodes === '' ? null : Number(raw.expected_episodes);
    if (val !== null && (!Number.isInteger(val) || val < 0)) {
      return res.status(400).json({ error: 'expected_episodes must be a non-negative integer or null' });
    }
    updates.expected_episodes = val;
  }
  if (raw.available_episodes !== undefined) {
    const val = raw.available_episodes === null || raw.available_episodes === '' ? null : Number(raw.available_episodes);
    if (val !== null && (!Number.isInteger(val) || val < 0)) {
      return res.status(400).json({ error: 'available_episodes must be a non-negative integer or null' });
    }
    updates.available_episodes = val;
  }
  if (raw.is_complete !== undefined) {
    updates.is_complete = Boolean(raw.is_complete);
  }
  if (raw.watchlist !== undefined) {
    updates.watchlist = Boolean(raw.watchlist);
  }
  if (raw.watch_state !== undefined) {
    const state = String(raw.watch_state || '').trim().toLowerCase();
    if (!TV_WATCH_STATES.has(state)) {
      return res.status(400).json({ error: 'watch_state must be one of unwatched, in_progress, completed' });
    }
    updates.watch_state = state;
  }
  if (raw.last_watched_at !== undefined) {
    if (raw.last_watched_at === null || raw.last_watched_at === '') {
      updates.last_watched_at = null;
    } else {
      const parsed = new Date(raw.last_watched_at);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'last_watched_at must be a valid date or null' });
      }
      updates.last_watched_at = parsed.toISOString();
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No season fields provided for update' });
  }

  const existing = await pool.query(
    `SELECT id FROM media_seasons WHERE media_id = $1 AND season_number = $2`,
    [mediaId, seasonNumber]
  );
  if (existing.rows.length === 0) {
    await pool.query(
      `INSERT INTO media_seasons (media_id, season_number, source)
       VALUES ($1, $2, $3)`,
      [mediaId, seasonNumber, 'manual_tv_season']
    );
  }

  const setParts = [];
  const values = [];
  Object.entries(updates).forEach(([key, value], idx) => {
    setParts.push(`${key} = $${idx + 1}`);
    values.push(value);
  });
  values.push(mediaId, seasonNumber);
  const updated = await pool.query(
    `UPDATE media_seasons
     SET ${setParts.join(', ')}
     WHERE media_id = $${values.length - 1}
       AND season_number = $${values.length}
     RETURNING id, media_id, season_number, expected_episodes, available_episodes,
               is_complete, watch_state, watchlist, last_watched_at, source, created_at, updated_at`,
    values
  );

  await logActivity(req, 'media.tv_season.update', 'media', mediaId, {
    season_number: seasonNumber,
    updates
  });

  res.json({ ok: true, mediaId, season: updated.rows[0] });
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

router.post('/enrich/comic/search', asyncHandler(async (req, res) => {
  const { title } = req.body || {};
  if (!String(title || '').trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const config = await loadAdminIntegrationConfig();
  const matches = await searchComicsByTitle(String(title).trim(), config, 10);
  res.json({ provider: config.comicsProvider || 'metron', matches });
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

async function resolveEditableMediaForUser({ req, mediaId, scopeContext }) {
  const unrestrictedParams = [mediaId];
  const unrestrictedScopeClause = appendScopeSql(unrestrictedParams, scopeContext);
  const unrestricted = await pool.query(
    `SELECT id, signed_proof_path
     FROM media
     WHERE id = $1${unrestrictedScopeClause}
     LIMIT 1`,
    unrestrictedParams
  );
  if (unrestricted.rows.length === 0) {
    return { status: 404, row: null };
  }

  const editableParams = [mediaId];
  let ownerClause = '';
  if (req.user.role !== 'admin') {
    editableParams.push(req.user.id);
    ownerClause = ` AND added_by = $${editableParams.length}`;
  }
  const editableScopeClause = appendScopeSql(editableParams, scopeContext);
  const editable = await pool.query(
    `SELECT id, signed_proof_path
     FROM media
     WHERE id = $1${ownerClause}${editableScopeClause}
     LIMIT 1`,
    editableParams
  );
  if (editable.rows.length === 0) {
    return { status: 403, row: null };
  }
  return { status: 200, row: editable.rows[0] };
}

router.post('/:id/upload-signing-proof', memoryUpload.single('proof'), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return res.status(400).json({ error: 'Invalid media id' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  if (!ALLOWED_COVER_MIME_TYPES.has(String(req.file.mimetype || '').toLowerCase())) {
    return res.status(400).json({ error: 'Unsupported file type. Allowed: JPEG, PNG, WEBP, GIF.' });
  }

  const access = await resolveEditableMediaForUser({ req, mediaId, scopeContext });
  if (access.status === 404) return res.status(404).json({ error: 'Media item not found' });
  if (access.status === 403) return res.status(403).json({ error: 'Not authorized to edit this media item' });

  const previousPath = access.row?.signed_proof_path || null;
  const stored = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
  const updated = await pool.query(
    `UPDATE media
     SET signed_proof_path = $1
     WHERE id = $2
     RETURNING id, signed_proof_path`,
    [stored.url, mediaId]
  );
  await logActivity(
    req,
    previousPath ? 'media.signing_proof.replace' : 'media.signing_proof.upload',
    'media',
    mediaId,
    { previousPath, nextPath: stored.url, provider: stored.provider }
  );
  res.json({
    id: updated.rows[0].id,
    signed_proof_path: updated.rows[0].signed_proof_path,
    provider: stored.provider
  });
}));

router.delete('/:id/signing-proof', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const mediaId = Number(req.params.id);
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return res.status(400).json({ error: 'Invalid media id' });
  }

  const access = await resolveEditableMediaForUser({ req, mediaId, scopeContext });
  if (access.status === 404) return res.status(404).json({ error: 'Media item not found' });
  if (access.status === 403) return res.status(403).json({ error: 'Not authorized to edit this media item' });

  const previousPath = access.row?.signed_proof_path || null;
  if (!previousPath) {
    return res.json({ ok: true, removed: false });
  }
  await pool.query(
    `UPDATE media
     SET signed_proof_path = NULL
     WHERE id = $1`,
    [mediaId]
  );
  await logActivity(req, 'media.signing_proof.remove', 'media', mediaId, { previousPath });
  res.json({ ok: true, removed: true });
}));

// ── CSV import ────────────────────────────────────────────────────────────────

router.get('/import/template-csv', asyncHandler(async (_req, res) => {
  const template = [
    'title,media_type,year,format,director,cast,genre,rating,user_rating,runtime,upc,isbn,ean_upc,asin,signed_by,signed_role,signed_on,signed_at,signed_proof_path,location,notes',
    '"The Matrix","movie",1999,"Blu-ray","Lana Wachowski, Lilly Wachowski","Keanu Reeves, Laurence Fishburne","Science Fiction",8.7,4.5,136,085391163545,,,,,,,,"Living Room","Example row"',
    '"Wool","book",2012,"Paperback","Hugh Howey","Science Fiction",,4.5,,,9781476735402,,,Hugh Howey,author,2024-06-12,"Salt Lake City","Identifier-first matching example"'
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
          onProgress: async (progress) => updateSyncJob(job.id, { progress }),
          reviewContext: { jobId: job.id, provider: 'csv_generic' }
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
            errorCount: result.summary.errors.length,
            matchModes: result.summary.matchModes,
            enrichment: result.summary.enrichment,
            reviewQueued: result.summary.reviewQueued,
            collectionsDetected: result.summary.collectionsDetected || 0,
            collectionsCreated: result.summary.collectionsCreated || 0,
            collectionItemsSeeded: result.summary.collectionItemsSeeded || 0,
            auditRows: result.auditRows
          },
          finished_at: new Date()
        });
        await logActivity(auditReq, 'media.import.csv', 'media', null, {
          rows: result.rows,
          created: result.summary.created,
          updated: result.summary.updated,
          skipped_invalid: result.summary.skipped_invalid,
          errorCount: result.summary.errors.length,
          matchModes: result.summary.matchModes,
          enrichment: result.summary.enrichment,
          reviewQueued: result.summary.reviewQueued,
          collectionsDetected: result.summary.collectionsDetected || 0,
          collectionsCreated: result.summary.collectionsCreated || 0,
          collectionItemsSeeded: result.summary.collectionItemsSeeded || 0,
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
    scopeContext,
    reviewContext: { provider: 'csv_generic' }
  });
  await logActivity(req, 'media.import.csv', 'media', null, {
    rows: result.rows,
    created: result.summary.created,
    updated: result.summary.updated,
    skipped_invalid: result.summary.skipped_invalid,
    errorCount: result.summary.errors.length,
    matchModes: result.summary.matchModes,
    enrichment: result.summary.enrichment,
    reviewQueued: result.summary.reviewQueued,
    collectionsDetected: result.summary.collectionsDetected || 0,
    collectionsCreated: result.summary.collectionsCreated || 0,
    collectionItemsSeeded: result.summary.collectionItemsSeeded || 0
  });
  res.json({ ok: true, rows: result.rows, summary: result.summary, auditRows: result.auditRows });
}));

router.post('/import-csv/calibre', tempUpload.single('file'), asyncHandler(async (req, res) => {
  await assertFeatureEnabled('import_csv_enabled');
  const scopeContext = resolveScopeContext(req);
  if (!req.file) {
    return res.status(400).json({ error: 'Calibre CSV file is required (multipart field: file)' });
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
  const mappedRows = normalizeCalibreRows(rows);
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
      provider: 'csv_calibre',
      scope: jobScopePayload(scopeContext),
      progress: {
        total: mappedRows.length,
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
          rows: mappedRows,
          userId: req.user.id,
          scopeContext,
          onProgress: async (progress) => updateSyncJob(job.id, { progress }),
          importSource: 'csv_calibre',
          reviewContext: { jobId: job.id, provider: 'csv_calibre' }
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
            errorCount: result.summary.errors.length,
            matchModes: result.summary.matchModes,
            enrichment: result.summary.enrichment,
            reviewQueued: result.summary.reviewQueued,
            collectionsDetected: result.summary.collectionsDetected || 0,
            collectionsCreated: result.summary.collectionsCreated || 0,
            collectionItemsSeeded: result.summary.collectionItemsSeeded || 0,
            auditRows: result.auditRows
          },
          finished_at: new Date()
        });
        await logActivity(auditReq, 'media.import.calibre', 'media', null, {
          rows: result.rows,
          created: result.summary.created,
          updated: result.summary.updated,
          skipped_invalid: result.summary.skipped_invalid,
          errorCount: result.summary.errors.length,
          matchModes: result.summary.matchModes,
          enrichment: result.summary.enrichment,
          reviewQueued: result.summary.reviewQueued,
          collectionsDetected: result.summary.collectionsDetected || 0,
          collectionsCreated: result.summary.collectionsCreated || 0,
          collectionItemsSeeded: result.summary.collectionItemsSeeded || 0,
          jobId: job.id
        });
      } catch (error) {
        await updateSyncJob(job.id, {
          status: 'failed',
          error: error.message || 'Calibre import failed',
          finished_at: new Date()
        });
        await logActivity(auditReq, 'media.import.calibre.failed', 'media', null, {
          detail: error.message || 'Calibre import failed',
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
    rows: mappedRows,
    userId: req.user.id,
    scopeContext,
    importSource: 'csv_calibre',
    reviewContext: { provider: 'csv_calibre' }
  });
  await logActivity(req, 'media.import.calibre', 'media', null, {
    rows: result.rows,
    created: result.summary.created,
    updated: result.summary.updated,
    skipped_invalid: result.summary.skipped_invalid,
    errorCount: result.summary.errors.length,
    matchModes: result.summary.matchModes,
    enrichment: result.summary.enrichment,
    reviewQueued: result.summary.reviewQueued,
    collectionsDetected: result.summary.collectionsDetected || 0,
    collectionsCreated: result.summary.collectionsCreated || 0,
    collectionItemsSeeded: result.summary.collectionItemsSeeded || 0
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
          onProgress: async (progress) => updateSyncJob(job.id, { progress }),
          reviewContext: { jobId: job.id, provider: 'csv_delicious' }
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
            errorCount: result.summary.errors.length,
            matchModes: result.summary.matchModes,
            enrichment: result.summary.enrichment,
            reviewQueued: result.summary.reviewQueued,
            collectionsDetected: result.summary.collectionsDetected || 0,
            collectionsCreated: result.summary.collectionsCreated || 0,
            collectionItemsSeeded: result.summary.collectionItemsSeeded || 0,
            auditRows: result.auditRows
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
          matchModes: result.summary.matchModes,
          enrichment: result.summary.enrichment,
          reviewQueued: result.summary.reviewQueued,
          collectionsDetected: result.summary.collectionsDetected || 0,
          collectionsCreated: result.summary.collectionsCreated || 0,
          collectionItemsSeeded: result.summary.collectionItemsSeeded || 0,
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
    scopeContext,
    reviewContext: { provider: 'csv_delicious' }
  });
  await logActivity(req, 'media.import.csv.delicious', 'media', null, {
    rows: result.rows,
    created: result.summary.created,
    updated: result.summary.updated,
    skipped_non_movie: result.summary.skipped_non_movie,
    skipped_invalid: result.summary.skipped_invalid,
    errorCount: result.summary.errors.length,
    matchModes: result.summary.matchModes,
    enrichment: result.summary.enrichment,
    reviewQueued: result.summary.reviewQueued,
    collectionsDetected: result.summary.collectionsDetected || 0,
    collectionsCreated: result.summary.collectionsCreated || 0,
    collectionItemsSeeded: result.summary.collectionItemsSeeded || 0
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
  const ensuredLibraryId = scopeContext?.libraryId || await ensureUserDefaultLibrary(req.user.id);
  const effectiveScopeContext = {
    ...scopeContext,
    libraryId: ensuredLibraryId || null
  };
  if (!effectiveScopeContext.libraryId) {
    return res.status(400).json({ error: 'Active library is required before Plex import' });
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
      scope: jobScopePayload(effectiveScopeContext, sectionIds),
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
          scopeContext: effectiveScopeContext,
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
            seasonsCreated: result.seasonsCreated,
            seasonsUpdated: result.seasonsUpdated,
            enrichmentErrors: result.summary.enrichmentErrors || [],
            errorsSample: (result.summary.errors || []).slice(0, 50)
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
          seasonsCreated: result.seasonsCreated,
          seasonsUpdated: result.seasonsUpdated,
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
      scopeContext: effectiveScopeContext
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
      seasonsCreated: result.seasonsCreated,
      seasonsUpdated: result.seasonsUpdated,
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

router.post('/import-comics', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const useAsync = parseAsyncFlag(req.query?.async) || parseAsyncFlag(req.body?.async);
  const config = await loadAdminIntegrationConfig();
  if (String(config.comicsProvider || '').toLowerCase() !== 'metron') {
    return res.status(400).json({ error: 'Comics provider must be set to Metron for collection import' });
  }
  if (!config.comicsApiUrl) {
    return res.status(400).json({ error: 'Metron API URL is not configured' });
  }
  if (!config.comicsApiKey) {
    return res.status(400).json({ error: 'Metron password/token is not configured' });
  }

  if (useAsync) {
    const job = await createSyncJob({
      userId: req.user.id,
      jobType: 'import',
      provider: 'metron',
      scope: jobScopePayload(scopeContext),
      progress: { total: 0, processed: 0, created: 0, updated: 0, skipped: 0, errorCount: 0 }
    });

    process.nextTick(async () => {
      const auditReq = { ...req, user: req.user };
      try {
        await updateSyncJob(job.id, { status: 'running', started_at: new Date() });
        const result = await runMetronImport({
          req: auditReq,
          config,
          scopeContext,
          onProgress: async (progress) => updateSyncJob(job.id, { progress })
        });
        await updateSyncJob(job.id, {
          status: 'succeeded',
          finished_at: new Date(),
          summary: {
            imported: result.imported,
            totalAvailable: result.totalAvailable || result.imported,
            skipped_existing: result.summary.skipped_existing || 0,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped: result.summary.skipped,
            errorCount: result.summary.errors.length,
            collectionEndpoint: result.collectionEndpoint
          },
          progress: {
            total: result.totalAvailable || result.imported,
            processed: result.totalAvailable || result.imported,
            created: result.summary.created,
            updated: result.summary.updated,
            skipped: (result.summary.skipped || 0) + (result.summary.skipped_existing || 0),
            errorCount: result.summary.errors.length
          }
        });
        await logActivity(auditReq, 'media.import.metron', 'media', null, {
          imported: result.imported,
          totalAvailable: result.totalAvailable || result.imported,
          skipped_existing: result.summary.skipped_existing || 0,
          created: result.summary.created,
          updated: result.summary.updated,
          skipped: result.summary.skipped,
          errorCount: result.summary.errors.length,
          collectionEndpoint: result.collectionEndpoint,
          jobId: job.id
        });
      } catch (error) {
        logError('Metron import failed', error);
        await updateSyncJob(job.id, {
          status: 'failed',
          finished_at: new Date(),
          error: error.message || 'Metron import failed'
        });
        await logActivity(auditReq, 'media.import.metron.failed', 'media', null, {
          detail: error.message || 'Metron import failed',
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
    const result = await runMetronImport({ req, config, scopeContext });
    await logActivity(req, 'media.import.metron', 'media', null, {
      imported: result.imported,
      totalAvailable: result.totalAvailable || result.imported,
      skipped_existing: result.summary.skipped_existing || 0,
      created: result.summary.created,
      updated: result.summary.updated,
      skipped: result.summary.skipped,
      errorCount: result.summary.errors.length,
      collectionEndpoint: result.collectionEndpoint
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    logError('Metron import failed', error);
    await logActivity(req, 'media.import.metron.failed', 'media', null, {
      detail: error.message || 'Metron import failed'
    });
    return res.status(502).json({ error: error.message || 'Metron import failed' });
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

router.get('/import-reviews/unresolved-count', asyncHandler(async (req, res) => {
  if (!isDebugAt(2)) {
    return res.status(404).json({ error: 'Import review is disabled' });
  }
  const scopeContext = resolveScopeContext(req);
  const params = ['pending'];
  let where = 'WHERE status = $1';
  if (req.user.role !== 'admin') {
    params.push(req.user.id);
    where += ` AND created_by = $${params.length}`;
  }
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'space_id',
    libraryColumn: 'library_id'
  });
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM import_match_reviews
     ${where}
     ${scopeClause}`,
    params
  );
  res.json({ count: result.rows[0]?.count || 0 });
}));

router.get('/collections', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const pageRaw = Number(req.query?.page);
  const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
  const search = String(req.query?.search || '').trim();
  const mediaType = req.query?.media_type ? normalizeMediaType(req.query.media_type, '') : '';

  const params = [];
  let where = 'WHERE 1=1';
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (c.name ILIKE $${params.length} OR COALESCE(c.source_title, '') ILIKE $${params.length})`;
  }
  if (mediaType) {
    params.push(mediaType);
    where += ` AND COALESCE(c.media_type, '') = $${params.length}`;
  }
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'c.space_id',
    libraryColumn: 'c.library_id'
  });
  const whereWithScope = `${where} ${scopeClause}`;
  const offset = (page - 1) * limit;

  const count = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM collections c
     ${whereWithScope}`,
    params
  );
  params.push(limit);
  params.push(offset);
  const rows = await pool.query(
    `SELECT
       c.id, c.name, c.media_type, c.source_title, c.import_source, c.expected_item_count,
       c.library_id, c.space_id, c.created_by, c.created_at, c.updated_at,
       COUNT(ci.id)::int AS item_count,
       COUNT(ci.id) FILTER (WHERE ci.media_id IS NOT NULL)::int AS linked_item_count
     FROM collections c
     LEFT JOIN collection_items ci ON ci.collection_id = c.id
     ${whereWithScope}
     GROUP BY c.id
     ORDER BY c.created_at DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );
  const total = count.rows[0]?.total || 0;
  res.json({
    items: rows.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  });
}));

router.get('/collections/:id', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const collectionId = Number(req.params.id);
  if (!Number.isFinite(collectionId) || collectionId <= 0) {
    return res.status(400).json({ error: 'Invalid collection id' });
  }
  const params = [collectionId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'c.space_id',
    libraryColumn: 'c.library_id'
  });
  const collection = await pool.query(
    `SELECT
       c.id, c.name, c.media_type, c.source_title, c.import_source, c.expected_item_count, c.metadata,
       c.library_id, c.space_id, c.created_by, c.created_at, c.updated_at
     FROM collections c
     WHERE c.id = $1
     ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!collection.rows[0]) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  const items = await pool.query(
    `SELECT
       ci.id, ci.collection_id, ci.media_id, ci.contained_title, ci.position, ci.confidence_score,
       ci.resolution_status, ci.source_payload, ci.created_at, ci.updated_at,
       m.title AS media_title, m.media_type AS media_type, m.poster_path AS media_poster_path, m.year AS media_year
     FROM collection_items ci
     LEFT JOIN media m ON m.id = ci.media_id
     WHERE ci.collection_id = $1
     ORDER BY COALESCE(ci.position, 999999), ci.id ASC`,
    [collectionId]
  );

  res.json({
    collection: collection.rows[0],
    items: items.rows
  });
}));

router.patch('/collections/:id', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const collectionId = Number(req.params.id);
  if (!Number.isFinite(collectionId) || collectionId <= 0) {
    return res.status(400).json({ error: 'Invalid collection id' });
  }
  const allowed = ['name', 'expected_item_count', 'source_title', 'metadata'];
  const fields = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(fields).length) {
    return res.status(400).json({ error: 'No valid collection fields provided' });
  }
  const updates = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'metadata') {
      values.push(value && typeof value === 'object' ? JSON.stringify(value) : null);
      updates.push(`${key} = $${values.length}::jsonb`);
      continue;
    }
    if (key === 'expected_item_count') {
      const parsed = Number(value);
      values.push(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
      updates.push(`${key} = $${values.length}`);
      continue;
    }
    values.push(value ? String(value).trim() : null);
    updates.push(`${key} = $${values.length}`);
  }
  values.push(collectionId);
  const scopeClause = appendScopeSql(values, scopeContext, {
    spaceColumn: 'space_id',
    libraryColumn: 'library_id'
  });
  const result = await pool.query(
    `UPDATE collections
     SET ${updates.join(', ')}
     WHERE id = $${values.length}
     ${scopeClause}
     RETURNING *`,
    values
  );
  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Collection not found' });
  }
  await logActivity(req, 'media.collection.update', 'collection', collectionId, {
    fields: Object.keys(fields)
  });
  res.json(result.rows[0]);
}));

router.post('/collections/:id/items', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const collectionId = Number(req.params.id);
  if (!Number.isFinite(collectionId) || collectionId <= 0) {
    return res.status(400).json({ error: 'Invalid collection id' });
  }
  const collectionParams = [collectionId];
  const scopeClause = appendScopeSql(collectionParams, scopeContext, {
    spaceColumn: 'space_id',
    libraryColumn: 'library_id'
  });
  const collection = await pool.query(
    `SELECT id FROM collections WHERE id = $1 ${scopeClause} LIMIT 1`,
    collectionParams
  );
  if (!collection.rows[0]) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  const containedTitle = req.body?.contained_title ? String(req.body.contained_title).trim() : null;
  const mediaId = Number(req.body?.media_id);
  const position = Number(req.body?.position);
  if (!containedTitle && !Number.isFinite(mediaId)) {
    return res.status(400).json({ error: 'contained_title or media_id is required' });
  }

  const item = await pool.query(
    `INSERT INTO collection_items (collection_id, media_id, contained_title, position, source_payload)
     VALUES ($1,$2,$3,$4,$5::jsonb)
     RETURNING *`,
    [
      collectionId,
      Number.isFinite(mediaId) ? mediaId : null,
      containedTitle,
      Number.isFinite(position) ? position : null,
      JSON.stringify({ source: 'manual_edit' })
    ]
  );
  await logActivity(req, 'media.collection.item.add', 'collection', collectionId, {
    itemId: item.rows[0]?.id || null,
    media_id: Number.isFinite(mediaId) ? mediaId : null,
    contained_title: containedTitle || null
  });
  res.status(201).json(item.rows[0]);
}));

router.patch('/collections/:id/items/:itemId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const collectionId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  if (!Number.isFinite(collectionId) || collectionId <= 0 || !Number.isFinite(itemId) || itemId <= 0) {
    return res.status(400).json({ error: 'Invalid collection item id' });
  }
  const allowed = ['contained_title', 'position', 'media_id', 'resolution_status'];
  const fields = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(fields).length) {
    return res.status(400).json({ error: 'No valid collection item fields provided' });
  }
  const collectionParams = [collectionId];
  const scopeClause = appendScopeSql(collectionParams, scopeContext, {
    spaceColumn: 'space_id',
    libraryColumn: 'library_id'
  });
  const collection = await pool.query(
    `SELECT id FROM collections WHERE id = $1 ${scopeClause} LIMIT 1`,
    collectionParams
  );
  if (!collection.rows[0]) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  const updates = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'position' || key === 'media_id') {
      const parsed = Number(value);
      values.push(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
      updates.push(`${key} = $${values.length}`);
      continue;
    }
    if (key === 'resolution_status') {
      const normalized = ['pending', 'resolved', 'skipped'].includes(String(value || '').toLowerCase())
        ? String(value).toLowerCase()
        : 'pending';
      values.push(normalized);
      updates.push(`${key} = $${values.length}`);
      continue;
    }
    values.push(value ? String(value).trim() : null);
    updates.push(`${key} = $${values.length}`);
  }
  values.push(collectionId);
  values.push(itemId);
  const result = await pool.query(
    `UPDATE collection_items
     SET ${updates.join(', ')}
     WHERE collection_id = $${values.length - 1}
       AND id = $${values.length}
     RETURNING *`,
    values
  );
  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Collection item not found' });
  }
  await logActivity(req, 'media.collection.item.update', 'collection', collectionId, {
    itemId,
    fields: Object.keys(fields)
  });
  res.json(result.rows[0]);
}));

router.delete('/collections/:id/items/:itemId', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const collectionId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  if (!Number.isFinite(collectionId) || collectionId <= 0 || !Number.isFinite(itemId) || itemId <= 0) {
    return res.status(400).json({ error: 'Invalid collection item id' });
  }
  const collectionParams = [collectionId];
  const scopeClause = appendScopeSql(collectionParams, scopeContext, {
    spaceColumn: 'space_id',
    libraryColumn: 'library_id'
  });
  const collection = await pool.query(
    `SELECT id FROM collections WHERE id = $1 ${scopeClause} LIMIT 1`,
    collectionParams
  );
  if (!collection.rows[0]) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  const deleted = await pool.query(
    `DELETE FROM collection_items
     WHERE collection_id = $1
       AND id = $2
     RETURNING id`,
    [collectionId, itemId]
  );
  if (!deleted.rows[0]) {
    return res.status(404).json({ error: 'Collection item not found' });
  }
  await logActivity(req, 'media.collection.item.delete', 'collection', collectionId, {
    itemId
  });
  res.json({ ok: true });
}));

router.post('/collections/:id/convert-to-individual', asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const collectionId = Number(req.params.id);
  if (!Number.isFinite(collectionId) || collectionId <= 0) {
    return res.status(400).json({ error: 'Invalid collection id' });
  }
  const params = [collectionId];
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'space_id',
    libraryColumn: 'library_id'
  });
  const collection = await pool.query(
    `SELECT id, name
     FROM collections
     WHERE id = $1
     ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!collection.rows[0]) {
    return res.status(404).json({ error: 'Collection not found' });
  }
  const items = await pool.query(
    `SELECT id FROM collection_items WHERE collection_id = $1`,
    [collectionId]
  );
  await pool.query(`DELETE FROM collection_items WHERE collection_id = $1`, [collectionId]);
  await pool.query(`DELETE FROM collections WHERE id = $1`, [collectionId]);
  await logActivity(req, 'media.collection.convert_to_individual', 'collection', collectionId, {
    itemCount: items.rows.length,
    name: collection.rows[0].name || null
  });
  res.json({ ok: true, removed_items: items.rows.length });
}));

router.get('/import-reviews', asyncHandler(async (req, res) => {
  if (!isDebugAt(2)) {
    return res.status(404).json({ error: 'Import review is disabled' });
  }
  const scopeContext = resolveScopeContext(req);
  const pageRaw = Number(req.query?.page);
  const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
  const status = String(req.query?.status || 'pending').trim().toLowerCase();
  const search = String(req.query?.search || '').trim();

  const params = [status];
  let where = 'WHERE imr.status = $1';
  if (req.user.role !== 'admin') {
    params.push(req.user.id);
    where += ` AND imr.created_by = $${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`);
    where += ` AND COALESCE(imr.source_title, '') ILIKE $${params.length}`;
  }
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'imr.space_id',
    libraryColumn: 'imr.library_id'
  });
  const whereWithScope = `${where} ${scopeClause}`;
  const offset = (page - 1) * limit;

  const countQuery = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM import_match_reviews imr
     ${whereWithScope}`,
    params
  );
  params.push(limit);
  params.push(offset);
  const rowsQuery = await pool.query(
    `SELECT
       imr.id, imr.job_id, imr.import_source, imr.provider, imr.row_number, imr.source_title, imr.media_type,
       imr.status, imr.confidence_score, imr.match_mode, imr.matched_by, imr.enrichment_status,
       imr.collection_id, c.name AS collection_name,
       imr.proposed_media_id, proposed.title AS proposed_media_title,
       imr.resolved_media_id, resolved.title AS resolved_media_title,
       imr.resolution_action, imr.resolution_note, imr.source_payload,
       imr.library_id, imr.space_id, imr.created_by, imr.resolved_by, imr.resolved_at,
       imr.created_at, imr.updated_at
     FROM import_match_reviews imr
     LEFT JOIN collections c ON c.id = imr.collection_id
     LEFT JOIN media proposed ON proposed.id = imr.proposed_media_id
     LEFT JOIN media resolved ON resolved.id = imr.resolved_media_id
     ${whereWithScope}
     ORDER BY imr.created_at DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );
  const total = countQuery.rows[0]?.total || 0;
  res.json({
    items: rowsQuery.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  });
}));

router.patch('/import-reviews/:id', asyncHandler(async (req, res) => {
  if (!isDebugAt(2)) {
    return res.status(404).json({ error: 'Import review is disabled' });
  }
  const scopeContext = resolveScopeContext(req);
  const reviewId = Number(req.params.id);
  if (!Number.isFinite(reviewId) || reviewId <= 0) {
    return res.status(400).json({ error: 'Invalid review id' });
  }
  const action = String(req.body?.action || '').trim().toLowerCase();
  if (!IMPORT_REVIEW_ACTIONS.includes(action)) {
    return res.status(400).json({ error: 'Invalid review action' });
  }
  const resolvedMediaIdRaw = Number(req.body?.resolved_media_id);
  const resolvedMediaId = Number.isFinite(resolvedMediaIdRaw) ? resolvedMediaIdRaw : null;
  const note = req.body?.note ? String(req.body.note).slice(0, 1000) : null;

  const params = [reviewId];
  let where = 'WHERE id = $1';
  if (req.user.role !== 'admin') {
    params.push(req.user.id);
    where += ` AND created_by = $${params.length}`;
  }
  const scopeClause = appendScopeSql(params, scopeContext, {
    spaceColumn: 'space_id',
    libraryColumn: 'library_id'
  });
  const existing = await pool.query(
    `SELECT id, status, source_title, proposed_media_id, collection_id
     FROM import_match_reviews
     ${where}
     ${scopeClause}
     LIMIT 1`,
    params
  );
  if (!existing.rows[0]) {
    return res.status(404).json({ error: 'Import review not found' });
  }
  const status = action === 'skip_keep_manual' ? 'skipped' : 'resolved';
  const resolutionMediaId = action === 'choose_alternate'
    ? resolvedMediaId
    : (existing.rows[0].proposed_media_id || resolvedMediaId || null);
  if (action !== 'skip_keep_manual' && !resolutionMediaId) {
    return res.status(400).json({ error: 'Resolved media id is required for this action' });
  }
  if (resolutionMediaId) {
    const mediaParams = [resolutionMediaId];
    const mediaScopeClause = appendScopeSql(mediaParams, scopeContext);
    const mediaCheck = await pool.query(
      `SELECT id
       FROM media
       WHERE id = $1
       ${mediaScopeClause}
       LIMIT 1`,
      mediaParams
    );
    if (!mediaCheck.rows[0]) {
      return res.status(404).json({ error: 'Resolved media item not found in scope' });
    }
  }

  const updated = await pool.query(
    `UPDATE import_match_reviews
     SET status = $1,
         resolution_action = $2,
         resolution_note = $3,
         resolved_media_id = $4,
         resolved_by = $5,
         resolved_at = CURRENT_TIMESTAMP
     WHERE id = $6
     RETURNING *`,
    [status, action, note, resolutionMediaId, req.user.id, reviewId]
  );

  let enrichmentApplied = false;
  let enrichmentStatus = null;
  if (action !== 'skip_keep_manual' && resolutionMediaId) {
    const enrichment = await applyImportReviewEnrichment({
      mediaId: resolutionMediaId,
      scopeContext
    });
    enrichmentApplied = Boolean(enrichment?.applied);
    enrichmentStatus = enrichment?.enrichmentStatus || null;
  }

  await logActivity(req, 'media.import.review.resolve', 'import_match_review', reviewId, {
    action,
    status,
    resolved_media_id: resolutionMediaId,
    source_title: existing.rows[0].source_title || null,
    collection_id: existing.rows[0].collection_id || null,
    enrichment_applied: enrichmentApplied,
    enrichment_status: enrichmentStatus
  });
  res.json({
    ...updated.rows[0],
    enrichment_applied: enrichmentApplied,
    enrichment_status: enrichmentStatus
  });
}));

// ── Create ────────────────────────────────────────────────────────────────────

router.post('/', validate(mediaCreateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const {
    title, media_type, original_title, release_date, year, format, genre, director, rating,
    cast,
    user_rating, tmdb_id, tmdb_media_type, tmdb_url, poster_path, backdrop_path, overview,
    trailer_url, runtime, upc, signed_by, signed_role, signed_on, signed_at, signed_proof_path, location, notes, import_source,
    season_number, episode_number, episode_title, network, type_details, library_id
    , space_id
  } = req.body;
  const normalizedMediaType = normalizeMediaType(media_type || 'movie', 'movie');
  const normalizedTypeDetailsResult = normalizeTypeDetails(normalizedMediaType, type_details, { strict: true });
  if ((normalizedTypeDetailsResult.invalidKeys || []).length > 0) {
    return res.status(400).json({
      error: `Invalid type_details key(s) for ${normalizedMediaType}: ${normalizedTypeDetailsResult.invalidKeys.join(', ')}`
    });
  }
  if ((normalizedTypeDetailsResult.errors || []).length > 0) {
    return res.status(400).json({
      error: `Invalid type_details values for ${normalizedMediaType}`,
      details: normalizedTypeDetailsResult.errors
    });
  }
  const normalizedTypeDetails = normalizedTypeDetailsResult.value;
  const fieldValidationError = validateTypeSpecificFields(normalizedMediaType, req.body);
  if (fieldValidationError) {
    return res.status(400).json({ error: fieldValidationError });
  }

  const result = await pool.query(
    `INSERT INTO media (
       title, media_type, original_title, release_date, year, format, genre, director, cast_members, rating,
       user_rating, tmdb_id, tmdb_media_type, tmdb_url, poster_path, backdrop_path, overview,
       trailer_url, runtime, upc, signed_by, signed_role, signed_on, signed_at, signed_proof_path, location, notes, season_number, episode_number, episode_title, network,
       type_details, library_id, space_id, added_by, import_source
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32::jsonb,$33,$34,$35,$36
     ) RETURNING *, cast_members AS cast`,
    [
      title, normalizedMediaType, original_title || null, release_date || null, year || null, format || null,
      genre || null, director || null, cast || null, rating || null, user_rating || null,
      tmdb_id || null, tmdb_media_type || null, tmdb_url || null, poster_path || null, backdrop_path || null,
      overview || null, trailer_url || null, runtime || null, upc || null, signed_by || null,
      signed_role || null, signed_on || null, signed_at || null, signed_proof_path || null, location || null, notes || null,
      season_number || null, episode_number || null, episode_title || null, network || null,
      normalizedTypeDetails ? JSON.stringify(normalizedTypeDetails) : null,
      library_id || scopeContext.libraryId || null,
      space_id || scopeContext.spaceId || null,
      req.user.id, import_source || 'manual'
    ]
  );
  const created = result.rows[0];
  await syncNormalizedMetadataForMedia({
    mediaId: created.id,
    genre: created.genre,
    director: created.director,
    cast: created.cast || created.cast_members
  });
  await maybePushComicToMetron({ req, mediaRow: created });
  res.status(201).json(created);
}));

// ── Update ─────────────────────────────────────────────────────────────────────
// Ownership enforcement: users may only edit their own media; admins are unrestricted.

router.patch('/:id', validate(mediaUpdateSchema), asyncHandler(async (req, res) => {
  const scopeContext = resolveScopeContext(req);
  const { id } = req.params;

  const ALLOWED_FIELDS = [
    'title', 'media_type', 'original_title', 'release_date', 'year', 'format', 'genre', 'director', 'cast',
    'rating', 'user_rating', 'tmdb_id', 'tmdb_media_type', 'tmdb_url', 'poster_path', 'backdrop_path',
    'overview', 'trailer_url', 'runtime', 'upc', 'signed_by', 'signed_role', 'signed_on', 'signed_at', 'signed_proof_path', 'location', 'notes', 'season_number',
    'episode_number', 'episode_title', 'network', 'type_details', 'library_id', 'space_id'
  ];

  let fields = Object.fromEntries(
    Object.entries(req.body).filter(([key]) => ALLOWED_FIELDS.includes(key))
  );
  if (Object.prototype.hasOwnProperty.call(fields, 'cast')) {
    fields.cast_members = fields.cast;
    delete fields.cast;
  }
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'No valid fields provided for update' });
  }

  const touchesTypeSpecific = ['season_number', 'episode_number', 'episode_title', 'network']
    .some((key) => Object.prototype.hasOwnProperty.call(fields, key));
  let effectiveMediaType = null;
  if (fields.media_type) {
    effectiveMediaType = normalizeMediaType(fields.media_type, 'movie');
    fields.media_type = effectiveMediaType;
  } else if (touchesTypeSpecific || Object.prototype.hasOwnProperty.call(fields, 'type_details')) {
    const mediaTypeParams = [id];
    const mediaTypeScopeClause = appendScopeSql(mediaTypeParams, scopeContext);
    const currentTypeResult = await pool.query(
      `SELECT media_type FROM media WHERE id = $1${mediaTypeScopeClause} LIMIT 1`,
      mediaTypeParams
    );
    effectiveMediaType = normalizeMediaType(currentTypeResult.rows[0]?.media_type || 'movie', 'movie');
  }
  fields = stripIncompatibleTypeSpecificFields(effectiveMediaType || 'movie', fields);
  const fieldValidationError = validateTypeSpecificFields(effectiveMediaType || 'movie', fields);
  if (fieldValidationError) {
    return res.status(400).json({ error: fieldValidationError });
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'type_details')) {
    const detailType = effectiveMediaType || 'movie';
    const normalizedTypeDetailsResult = normalizeTypeDetails(detailType, fields.type_details, { strict: true });
    if ((normalizedTypeDetailsResult.invalidKeys || []).length > 0) {
      return res.status(400).json({
        error: `Invalid type_details key(s) for ${detailType}: ${normalizedTypeDetailsResult.invalidKeys.join(', ')}`
      });
    }
    if ((normalizedTypeDetailsResult.errors || []).length > 0) {
      return res.status(400).json({
        error: `Invalid type_details values for ${detailType}`,
        details: normalizedTypeDetailsResult.errors
      });
    }
    fields.type_details = normalizedTypeDetailsResult.value;
  }

  const keys = Object.keys(fields);
  if (keys.length === 0) {
    return res.status(400).json({ error: 'No valid fields provided for update' });
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
     RETURNING *, cast_members AS cast`,
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
  const updated = result.rows[0];
  await syncNormalizedMetadataForMedia({
    mediaId: updated.id,
    genre: updated.genre,
    director: updated.director,
    cast: updated.cast || updated.cast_members
  });
  res.json(updated);
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
