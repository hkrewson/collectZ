export const FORMAT_DEFINITIONS = {
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

export function getOwnedFormatFamily(mediaType = 'movie') {
  return FORMAT_FAMILY_BY_MEDIA_TYPE[String(mediaType || 'movie').trim()] || 'movie';
}

export function getOwnedFormatOptions(mediaType = 'movie') {
  return FORMAT_DEFINITIONS[getOwnedFormatFamily(mediaType)] || FORMAT_DEFINITIONS.movie;
}

function normalizeOwnedFormatToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ');
}

export function normalizeOwnedFormatValue(mediaType = 'movie', value) {
  const family = getOwnedFormatFamily(mediaType);
  const normalized = normalizeOwnedFormatToken(value);
  if (!normalized) return null;
  const direct = getOwnedFormatOptions(family).find((entry) => entry.value === normalized.replace(/\s+/g, '_'));
  if (direct) return direct.value;
  const aliased = LEGACY_ALIASES[normalized] || null;
  if (!aliased) return null;
  return getOwnedFormatOptions(family).some((entry) => entry.value === aliased) ? aliased : null;
}

export function normalizeOwnedFormats(mediaType = 'movie', values = null, fallbackFormat = null) {
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

export function sortOwnedFormats(mediaType = 'movie', values = []) {
  const options = getOwnedFormatOptions(mediaType).map((entry) => entry.value);
  const order = new Map(options.map((value, index) => [value, index]));
  return [...normalizeOwnedFormats(mediaType, values)].sort((left, right) => {
    const leftIndex = order.has(left) ? order.get(left) : Number.MAX_SAFE_INTEGER;
    const rightIndex = order.has(right) ? order.get(right) : Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}

export function getOwnedFormatLabel(mediaType = 'movie', value) {
  const normalized = normalizeOwnedFormatValue(mediaType, value);
  if (!normalized) return null;
  return getOwnedFormatOptions(mediaType).find((entry) => entry.value === normalized)?.label || null;
}

export function getOwnedFormatLabels(mediaType = 'movie', values = []) {
  return sortOwnedFormats(mediaType, values)
    .map((value) => getOwnedFormatLabel(mediaType, value))
    .filter(Boolean);
}
