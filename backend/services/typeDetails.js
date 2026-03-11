const TYPE_DETAILS_ALLOWED_BY_MEDIA_TYPE = {
  movie: ['edition', 'provider_name', 'provider_item_id', 'provider_external_url'],
  tv_series: [],
  tv_episode: [],
  book: [
    'author',
    'isbn',
    'publisher',
    'edition',
    'provider_name',
    'provider_item_id',
    'provider_external_url',
    'calibre_entry_id',
    'calibre_external_url',
    'source_updated_at'
  ],
  audio: ['artist', 'album', 'track_count'],
  game: ['platform', 'developer', 'region', 'provider_name', 'provider_item_id', 'provider_external_url'],
  comic_book: [
    'author',
    'isbn',
    'publisher',
    'edition',
    'series',
    'issue_number',
    'volume',
    'writer',
    'artist',
    'inker',
    'colorist',
    'cover_date',
    'provider_issue_id',
    'provider_name',
    'provider_item_id',
    'provider_external_url',
    'calibre_entry_id',
    'calibre_external_url',
    'source_updated_at'
  ]
};

const TRACK_COUNT_KEY = 'track_count';
const COVER_DATE_KEY = 'cover_date';
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeMediaType(input, fallback = 'movie') {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'tv' || raw === 'show' || raw === 'series' || raw === 'tv_show' || raw === 'tvseries' || raw === 'tv_series' || raw === 'tv-series') return 'tv_series';
  if (raw === 'tv_episode' || raw === 'episode') return 'tv_episode';
  if (raw === 'movie' || raw === 'film') return 'movie';
  if (raw === 'book' || raw === 'books') return 'book';
  if (raw === 'comic' || raw === 'comics' || raw === 'comic_book' || raw === 'comic-book' || raw === 'other') return 'comic_book';
  if (raw === 'audio' || raw === 'music' || raw === 'album' || raw === 'cd' || raw === 'vinyl' || raw === 'lp') return 'audio';
  if (raw === 'game' || raw === 'games' || raw === 'video_game' || raw === 'videogame') return 'game';
  return fallback;
}

function isBlank(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  return false;
}

function normalizeStringValue(value) {
  if (isBlank(value)) return null;
  if (['string', 'number', 'boolean'].includes(typeof value)) {
    const normalized = String(value).trim();
    return normalized || null;
  }
  return null;
}

function normalizeTrackCount(value) {
  if (isBlank(value)) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  if (!Number.isInteger(rounded) || rounded <= 0) return null;
  return rounded;
}

function normalizeCoverDate(value) {
  if (isBlank(value)) return null;
  const normalized = String(value).trim();
  if (!ISO_DATE_RE.test(normalized)) return null;
  return normalized;
}

function normalizeTypeDetails(mediaType, rawTypeDetails, options = {}) {
  const strict = Boolean(options.strict);
  if (rawTypeDetails === undefined || rawTypeDetails === null || rawTypeDetails === '') {
    return { value: null, invalidKeys: [], errors: [] };
  }
  if (typeof rawTypeDetails !== 'object' || Array.isArray(rawTypeDetails)) {
    return {
      value: null,
      invalidKeys: [],
      errors: strict ? [{ key: 'type_details', message: 'type_details must be an object' }] : []
    };
  }

  const normalizedType = normalizeMediaType(mediaType || 'movie', 'movie');
  const allowedKeys = new Set(TYPE_DETAILS_ALLOWED_BY_MEDIA_TYPE[normalizedType] || []);
  if (allowedKeys.size === 0) return { value: null, invalidKeys: [], errors: [] };

  const invalidKeys = [];
  const errors = [];
  const sanitized = {};

  for (const [key, rawValue] of Object.entries(rawTypeDetails)) {
    if (isBlank(rawValue)) continue;
    if (!allowedKeys.has(key)) {
      invalidKeys.push(key);
      continue;
    }

    if (key === TRACK_COUNT_KEY) {
      const normalized = normalizeTrackCount(rawValue);
      if (normalized === null) {
        errors.push({ key, message: 'track_count must be a positive integer' });
        continue;
      }
      sanitized[key] = normalized;
      continue;
    }

    if (key === COVER_DATE_KEY) {
      const normalized = normalizeCoverDate(rawValue);
      if (normalized === null) {
        errors.push({ key, message: 'cover_date must be in YYYY-MM-DD format' });
        continue;
      }
      sanitized[key] = normalized;
      continue;
    }

    const normalized = normalizeStringValue(rawValue);
    if (normalized === null) {
      errors.push({ key, message: `${key} must be a string-compatible value` });
      continue;
    }
    sanitized[key] = normalized;
  }

  return {
    value: Object.keys(sanitized).length > 0 ? sanitized : null,
    invalidKeys,
    errors: strict ? errors : []
  };
}

module.exports = {
  TYPE_DETAILS_ALLOWED_BY_MEDIA_TYPE,
  normalizeTypeDetails
};
