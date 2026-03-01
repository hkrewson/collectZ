const PLATFORM_ALIASES = {
  'nintendo wii': 'Nintendo Wii',
  wii: 'Nintendo Wii',
  'nintendo switch': 'Nintendo Switch',
  switch: 'Nintendo Switch',
  'wii u': 'Nintendo Wii U',
  'nintendo ds': 'Nintendo DS',
  'nintendo 3ds': 'Nintendo 3DS',
  gamecube: 'Nintendo GameCube',
  'nintendo gamecube': 'Nintendo GameCube',
  playstation: 'PlayStation',
  'playstation 2': 'PlayStation 2',
  ps2: 'PlayStation 2',
  'playstation 3': 'PlayStation 3',
  ps3: 'PlayStation 3',
  'playstation 4': 'PlayStation 4',
  ps4: 'PlayStation 4',
  'playstation 5': 'PlayStation 5',
  ps5: 'PlayStation 5',
  psp: 'PlayStation Portable',
  vita: 'PlayStation Vita',
  xbox: 'Xbox',
  'xbox 360': 'Xbox 360',
  'xbox one': 'Xbox One',
  'xbox series x': 'Xbox Series X',
  'xbox series s': 'Xbox Series S',
  dreamcast: 'Sega Dreamcast',
  saturn: 'Sega Saturn',
  'sega genesis': 'Sega Genesis',
  genesis: 'Sega Genesis',
  pc: 'PC',
  windows: 'PC',
  steam: 'PC'
};

const PLATFORM_KEYS = Object.keys(PLATFORM_ALIASES).sort((a, b) => b.length - a.length);
const DASH_SUFFIX_REGEX = /\s*[-–—]\s*([A-Za-z0-9 +./-]{2,40})\s*$/;
const PAREN_SUFFIX_REGEX = /\s*\(([A-Za-z0-9 +./-]{2,40})\)\s*$/;

function getRowValue(row, name) {
  if (!row || !name) return '';
  const normalized = String(name).trim().toLowerCase();
  const key = Object.keys(row).find((k) => String(k).trim().toLowerCase() === normalized);
  return key ? row[key] : '';
}

function canonicalizePlatform(value) {
  if (!value) return '';
  const normalized = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9 +.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return PLATFORM_ALIASES[normalized] || '';
}

function extractPlatformFromTitle(rawTitle) {
  const title = String(rawTitle || '').trim();
  if (!title) return { platform: '', title };

  const dashMatch = title.match(DASH_SUFFIX_REGEX);
  if (dashMatch?.[1]) {
    const platform = canonicalizePlatform(dashMatch[1]);
    if (platform) {
      return {
        platform,
        title: title.slice(0, dashMatch.index).trim().replace(/[-–—:]\s*$/, '')
      };
    }
  }

  const parenMatch = title.match(PAREN_SUFFIX_REGEX);
  if (parenMatch?.[1]) {
    const platform = canonicalizePlatform(parenMatch[1]);
    if (platform) {
      return {
        platform,
        title: title.slice(0, parenMatch.index).trim()
      };
    }
  }

  return { platform: '', title };
}

function extractAmazonItemId(link) {
  const value = String(link || '').trim();
  if (!value) return '';
  const patterns = [
    /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/gp\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\b([A-Z0-9]{10})\b/i
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1].toUpperCase();
  }
  return '';
}

function normalizeDigits(value) {
  const cleaned = String(value || '').replace(/\D+/g, '');
  return cleaned || '';
}

function normalizeDeliciousRow(row) {
  const rawTitle = String(getRowValue(row, 'title') || '').trim();
  const platformFromColumn = canonicalizePlatform(getRowValue(row, 'platform'));
  const platformFromTitle = extractPlatformFromTitle(rawTitle);
  const normalizedPlatform = platformFromColumn || platformFromTitle.platform || '';
  const normalizedTitle = platformFromTitle.title || rawTitle;

  return {
    itemType: String(getRowValue(row, 'item type') || '').trim(),
    rawTitle,
    normalizedTitle,
    normalizedPlatform,
    amazonItemId: extractAmazonItemId(getRowValue(row, 'amazon link')),
    ean: normalizeDigits(getRowValue(row, 'ean')),
    isbn: normalizeDigits(getRowValue(row, 'isbn')),
    creator: String(getRowValue(row, 'creator') || '').trim(),
    edition: String(getRowValue(row, 'edition') || '').trim(),
    formatRaw: String(getRowValue(row, 'format') || '').trim(),
    signedBy: String(getRowValue(row, 'signed by') || '').trim(),
    signedRole: String(getRowValue(row, 'signed role') || '').trim(),
    signedOnRaw: getRowValue(row, 'signed on'),
    signedAt: String(getRowValue(row, 'signed at') || '').trim(),
    releaseDateRaw: getRowValue(row, 'release date'),
    creationDateRaw: getRowValue(row, 'creation date'),
    ratingRaw: getRowValue(row, 'rating'),
    notesRaw: String(getRowValue(row, 'notes') || '').trim()
  };
}

module.exports = {
  normalizeDeliciousRow
};
