'use strict';

const FORMAT_DEFINITIONS = {
  book: [
    { value: 'digital', label: 'Digital' },
    { value: 'paperback', label: 'Paperback' },
    { value: 'trade_paperback', label: 'Trade Paperback' },
    { value: 'hardcover', label: 'Hardcover' }
  ],
  comic_book: [
    { value: 'digital', label: 'Digital' },
    { value: 'paper', label: 'Paper' }
  ],
  game: [
    { value: 'digital', label: 'Digital' },
    { value: 'disc', label: 'Disc' },
    { value: 'card', label: 'Card' },
    { value: 'cartridge', label: 'Cartridge' }
  ],
  movie: [
    { value: 'vhs', label: 'VHS' },
    { value: 'beta', label: 'Beta' },
    { value: 'laserdisc', label: 'Laserdisc' },
    { value: 'dvd', label: 'DVD' },
    { value: 'bluray', label: 'Blu-ray' },
    { value: 'uhd', label: '4K UHD' },
    { value: 'digital', label: 'Digital' }
  ],
  tv: [
    { value: 'vhs', label: 'VHS' },
    { value: 'dvd', label: 'DVD' },
    { value: 'bluray', label: 'Blu-ray' },
    { value: 'uhd', label: '4K UHD' },
    { value: 'digital', label: 'Digital' }
  ],
  audio: [
    { value: 'four_track', label: '4 Track' },
    { value: 'eight_track', label: '8 Track' },
    { value: 'cassette', label: 'Cassette' },
    { value: 'vhs', label: 'VHS' },
    { value: 'vinyl', label: 'Vinyl' },
    { value: 'cd', label: 'CD' },
    { value: 'digital', label: 'Digital' }
  ]
};

const FORMAT_FAMILY_BY_MEDIA_TYPE = {
  movie: 'movie',
  tv_series: 'tv',
  tv_episode: 'tv',
  book: 'book',
  comic_book: 'comic_book',
  game: 'game',
  audio: 'audio'
};

const PRIMARY_FORMAT_PRIORITY = {
  book: ['hardcover', 'trade_paperback', 'paperback', 'digital'],
  comic_book: ['paper', 'digital'],
  game: ['cartridge', 'disc', 'card', 'digital'],
  movie: ['uhd', 'bluray', 'dvd', 'laserdisc', 'beta', 'vhs', 'digital'],
  tv: ['uhd', 'bluray', 'dvd', 'vhs', 'digital'],
  audio: ['digital', 'cd', 'vinyl', 'cassette', 'eight_track', 'four_track', 'vhs']
};

const LEGACY_ALIASES = {
  bluray: 'bluray',
  'blu-ray': 'bluray',
  'blu ray': 'bluray',
  dvd: 'dvd',
  vhs: 'vhs',
  digital: 'digital',
  stream: 'digital',
  streaming: 'digital',
  uhd: 'uhd',
  '4k': 'uhd',
  '4k uhd': 'uhd',
  paperback: 'paperback',
  hardcover: 'hardcover',
  'hard cover': 'hardcover',
  trade: 'trade_paperback',
  'trade paperback': 'trade_paperback',
  paper: 'paper',
  disc: 'disc',
  card: 'card',
  cartridge: 'cartridge',
  beta: 'beta',
  laserdisc: 'laserdisc',
  '4 track': 'four_track',
  'four track': 'four_track',
  '8 track': 'eight_track',
  'eight track': 'eight_track',
  cassette: 'cassette',
  vinyl: 'vinyl',
  cd: 'cd'
};

const ALL_OWNED_FORMAT_VALUES = Array.from(
  new Set(
    Object.values(FORMAT_DEFINITIONS)
      .flat()
      .map((entry) => entry.value)
  )
);

const ALL_DISPLAY_FORMAT_LABELS = Array.from(
  new Set(
    Object.values(FORMAT_DEFINITIONS)
      .flat()
      .map((entry) => entry.label)
  )
);

function getOwnedFormatFamily(mediaType = 'movie') {
  return FORMAT_FAMILY_BY_MEDIA_TYPE[String(mediaType || 'movie').trim()] || 'movie';
}

function getOwnedFormatOptions(mediaType = 'movie') {
  return FORMAT_DEFINITIONS[getOwnedFormatFamily(mediaType)] || FORMAT_DEFINITIONS.movie;
}

function normalizeOwnedFormatToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeOwnedFormatValue(mediaType = 'movie', value) {
  const family = getOwnedFormatFamily(mediaType);
  const normalized = normalizeOwnedFormatToken(value);
  if (!normalized) return null;
  const direct = getOwnedFormatOptions(family).find((entry) => entry.value === normalized.replace(/\s+/g, '_'));
  if (direct) return direct.value;
  const aliased = LEGACY_ALIASES[normalized] || null;
  if (!aliased) return null;
  return getOwnedFormatOptions(family).some((entry) => entry.value === aliased) ? aliased : null;
}

function normalizeOwnedFormats(mediaType = 'movie', values = null, fallbackFormat = null) {
  const inputValues = Array.isArray(values)
    ? values
    : (values === null || values === undefined || values === ''
      ? []
      : [values]);
  const normalized = [];

  for (const rawValue of inputValues) {
    const next = normalizeOwnedFormatValue(mediaType, rawValue);
    if (next && !normalized.includes(next)) normalized.push(next);
  }

  if (normalized.length === 0 && fallbackFormat) {
    const fallback = normalizeOwnedFormatValue(mediaType, fallbackFormat);
    if (fallback) normalized.push(fallback);
  }

  return normalized;
}

function sortOwnedFormats(mediaType = 'movie', values = []) {
  const options = getOwnedFormatOptions(mediaType).map((entry) => entry.value);
  const order = new Map(options.map((value, index) => [value, index]));
  return [...normalizeOwnedFormats(mediaType, values)].sort((left, right) => {
    const leftIndex = order.has(left) ? order.get(left) : Number.MAX_SAFE_INTEGER;
    const rightIndex = order.has(right) ? order.get(right) : Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}

function getOwnedFormatLabel(mediaType = 'movie', value) {
  const normalized = normalizeOwnedFormatValue(mediaType, value);
  if (!normalized) return null;
  return getOwnedFormatOptions(mediaType).find((entry) => entry.value === normalized)?.label || null;
}

function derivePrimaryFormat(mediaType = 'movie', ownedFormats = null, fallbackFormat = null) {
  const family = getOwnedFormatFamily(mediaType);
  const normalized = normalizeOwnedFormats(family, ownedFormats, fallbackFormat);
  if (normalized.length === 0) return null;
  const priority = PRIMARY_FORMAT_PRIORITY[family] || [];
  const primary = priority.find((value) => normalized.includes(value)) || normalized[0];
  return getOwnedFormatLabel(family, primary);
}

function buildOwnedFormatsPayload(mediaType = 'movie', ownedFormats = null, fallbackFormat = null) {
  const normalized = sortOwnedFormats(mediaType, normalizeOwnedFormats(mediaType, ownedFormats, fallbackFormat));
  const derivedFallback = ALL_DISPLAY_FORMAT_LABELS.includes(String(fallbackFormat || '').trim())
    ? String(fallbackFormat).trim()
    : null;
  return {
    ownedFormats: normalized,
    format: derivePrimaryFormat(mediaType, normalized, fallbackFormat) || derivedFallback
  };
}

function buildMergedOwnedFormatsPayload(
  mediaType = 'movie',
  canonicalOwnedFormats = null,
  canonicalFormat = null,
  duplicateOwnedFormats = null,
  duplicateFormat = null
) {
  const canonicalNormalized = normalizeOwnedFormats(mediaType, canonicalOwnedFormats, canonicalFormat);
  const duplicateNormalized = normalizeOwnedFormats(mediaType, duplicateOwnedFormats, duplicateFormat);
  const merged = sortOwnedFormats(mediaType, [...canonicalNormalized, ...duplicateNormalized]);
  return buildOwnedFormatsPayload(mediaType, merged, canonicalFormat || duplicateFormat || null);
}

module.exports = {
  ALL_DISPLAY_FORMAT_LABELS,
  ALL_OWNED_FORMAT_VALUES,
  FORMAT_DEFINITIONS,
  getOwnedFormatFamily,
  getOwnedFormatOptions,
  getOwnedFormatLabel,
  normalizeOwnedFormatValue,
  normalizeOwnedFormats,
  sortOwnedFormats,
  derivePrimaryFormat,
  buildOwnedFormatsPayload,
  buildMergedOwnedFormatsPayload
};
