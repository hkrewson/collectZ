const BARCODE_PRESETS = {
  upcitemdb: {
    preset: 'upcitemdb',
    provider: 'upcitemdb',
    apiUrl: 'https://api.upcitemdb.com/prod/trial/lookup',
    apiKeyHeader: 'x-api-key',
    queryParam: 'upc'
  },
  barcodelookup: {
    preset: 'barcodelookup',
    provider: 'barcodelookup',
    apiUrl: 'https://api.barcodelookup.com/v3/products',
    apiKeyHeader: 'Authorization',
    queryParam: 'barcode'
  }
};

const resolveBarcodePreset = (presetName) =>
  BARCODE_PRESETS[presetName] || BARCODE_PRESETS.upcitemdb;

function normalizeDigits(value) {
  return String(value || '').replace(/\D+/g, '').trim();
}

function inferBookBarcodeType(upc = '') {
  const digits = normalizeDigits(upc);
  if (digits.length === 13 && (digits.startsWith('978') || digits.startsWith('979'))) return digits;
  return '';
}

const NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
};

function inferTvSeasonMetadata(rawTitle = '') {
  const source = String(rawTitle || '').trim();
  if (!source) return { title: '', seasonNumber: null, matched: false };

  const seasonMatch = source.match(/\bseason\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  if (!seasonMatch) {
    return { title: source, seasonNumber: null, matched: false };
  }

  const token = String(seasonMatch[1] || '').trim().toLowerCase();
  const numericSeason = /^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token];
  const cleaned = source
    .replace(/\b(?:the\s+)?complete\s+season\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, ' ')
    .replace(/\bseason\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, ' ')
    .replace(/\bseries\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s*[:-]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title: cleaned || source,
    seasonNumber: Number.isFinite(numericSeason) ? numericSeason : null,
    matched: true
  };
}

function parseBarcodeTitleMetadata(rawTitle = '') {
  const source = String(rawTitle || '').trim();
  if (!source) {
    return {
      normalizedTitle: '',
      author: '',
      format: '',
      series: ''
    };
  }

  let working = source;
  let format = '';
  let author = '';
  let series = '';

  const trailingFormatMatch = working.match(/\((Paperback|Hardcover|Trade|Digital)\)\s*$/i);
  if (trailingFormatMatch) {
    format = trailingFormatMatch[1];
    working = working.slice(0, trailingFormatMatch.index).trim();
  }

  const explicitAuthorSuffixMatch = working.match(/\s+-\s+by\s+(.+)$/i);
  if (explicitAuthorSuffixMatch) {
    author = String(explicitAuthorSuffixMatch[1] || '').trim();
    working = working.slice(0, explicitAuthorSuffixMatch.index).trim();
  } else {
    const byMatch = working.match(/^(.*)\s+by\s+(.+)$/i);
    if (byMatch) {
      working = String(byMatch[1] || '').trim();
      author = String(byMatch[2] || '').trim();
    }
  }

  const seriesMatch = working.match(/\s+-\s+\(([^)]+)\)\s*$/);
  if (seriesMatch) {
    series = String(seriesMatch[1] || '').trim();
    working = working.slice(0, seriesMatch.index).trim();
  }

  return {
    normalizedTitle: working.trim(),
    author,
    format,
    series
  };
}

function normalizeBarcodeSearchTitle(rawTitle = '') {
  let value = String(rawTitle || '').trim();
  if (!value) return '';

  value = value
    .replace(/\[(LP|EP|CD|DVD|BLU-RAY|VINYL)\]/gi, ' ')
    .replace(/\((LP|EP|CD|DVD|BLU-RAY|VINYL)\)/gi, ' ')
    .replace(/\((?=[^)]*(BLU[- ]?RAY|DVD|4K UHD|UHD|DIGITAL|ULTRAVIOLET|UV))[^)]*\)/gi, ' ')
    .replace(/\b(DELUXE EDITION|COLLECTOR'S EDITION|SPECIAL EDITION)\b/gi, ' ')
    .replace(/\s+-\s+(VINYL|LP|EP|CD|DVD|BLU-RAY)\b/gi, ' ')
    .replace(/\b(VINYL|LP|EP|CD|DVD|BLU-RAY)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return value;
}

/**
 * Normalize barcode API responses from different providers into a
 * consistent shape: [{ title, description, image, raw }]
 */
const normalizeBarcodeMatches = (payload) => {
  const list =
    payload?.items ||
    payload?.products ||
    payload?.results ||
    payload?.data ||
    [];

  if (!Array.isArray(list)) return [];

  return list.map((entry) => {
    const rawTitle = entry?.title || entry?.name || entry?.product_name || null;
    const { normalizedTitle, author, format, series } = parseBarcodeTitleMetadata(rawTitle);
    const tvMetadata = inferTvSeasonMetadata(normalizedTitle || rawTitle);
    const searchTitle = normalizeBarcodeSearchTitle(tvMetadata.matched ? tvMetadata.title : (normalizedTitle || rawTitle));
    const upc = normalizeDigits(entry?.upc || entry?.barcode || entry?.ean || entry?.gtin || '');
    const inferredIsbn = inferBookBarcodeType(upc);
    const mediaTypeGuess = inferredIsbn || format ? 'book' : (tvMetadata.matched ? 'tv_series' : 'movie');

    return {
      title: rawTitle,
      normalizedTitle: normalizedTitle || rawTitle,
      searchTitle: searchTitle || normalizedTitle || rawTitle,
      description: entry?.description || entry?.brand || entry?.manufacturer || entry?.publisher || null,
      image: entry?.image || entry?.image_url || entry?.images?.[0] || null,
      upc: upc || null,
      mediaTypeGuess,
      year: entry?.year || entry?.release_year || null,
      typeDetails: {
        author: author || null,
        isbn: inferredIsbn || null,
        format: format || null,
        series: series || null,
        season_number: tvMetadata.seasonNumber || null,
        publisher: entry?.publisher || entry?.brand || entry?.manufacturer || null
      },
      raw: entry
    };
  });
};

module.exports = { BARCODE_PRESETS, resolveBarcodePreset, normalizeBarcodeMatches };
