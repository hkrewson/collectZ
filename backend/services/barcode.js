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

  const byMatch = working.match(/\s+by\s+(.+)$/i);
  if (byMatch) {
    author = String(byMatch[1] || '').trim();
    working = working.slice(0, byMatch.index).trim();
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
    const upc = normalizeDigits(entry?.upc || entry?.barcode || entry?.ean || entry?.gtin || '');
    const inferredIsbn = inferBookBarcodeType(upc);
    const mediaTypeGuess = inferredIsbn || format ? 'book' : 'movie';

    return {
      title: rawTitle,
      normalizedTitle: normalizedTitle || rawTitle,
      description: entry?.description || entry?.brand || entry?.manufacturer || null,
      image: entry?.image || entry?.image_url || entry?.images?.[0] || null,
      upc: upc || null,
      mediaTypeGuess,
      year: entry?.year || entry?.release_year || null,
      typeDetails: {
        author: author || null,
        isbn: inferredIsbn || null,
        format: format || null,
        series: series || null,
        publisher: entry?.brand || entry?.manufacturer || null
      },
      raw: entry
    };
  });
};

module.exports = { BARCODE_PRESETS, resolveBarcodePreset, normalizeBarcodeMatches };
