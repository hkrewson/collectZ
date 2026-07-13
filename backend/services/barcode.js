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

const GAME_PLATFORM_PATTERNS = [
  { label: 'Nintendo Switch 2', pattern: /\bnintendo\s+switch\s+2\b|\bswitch\s+2\b/i },
  { label: 'Nintendo Switch', pattern: /\bnintendo\s+switch\b|\bswitch\b/i },
  { label: 'Nintendo 3DS', pattern: /\bnintendo\s*3ds\b|\b3ds\b/i },
  { label: 'Nintendo DS', pattern: /\bnintendo\s*ds\b|\bnds\b|\bds\b/i },
  { label: 'Nintendo Wii U', pattern: /\bnintendo\s+wii\s+u\b|\bwii\s+u\b/i },
  { label: 'Nintendo Wii', pattern: /\bnintendo\s+wii\b|\bwii\b/i },
  { label: 'Nintendo GameCube', pattern: /\bgame\s*cube\b|\bgamecube\b/i },
  { label: 'Game Boy Advance', pattern: /\bgame\s*boy\s*advance\b|\bgba\b/i },
  { label: 'Game Boy', pattern: /\bgame\s*boy\b|\bgbc?\b/i },
  { label: 'PlayStation 5', pattern: /\bplaystation\s*5\b|\bps5\b/i },
  { label: 'PlayStation 4', pattern: /\bplaystation\s*4\b|\bps4\b/i },
  { label: 'PlayStation 3', pattern: /\bplaystation\s*3\b|\bps3\b/i },
  { label: 'PlayStation 2', pattern: /\bplaystation\s*2\b|\bps2\b/i },
  { label: 'PlayStation', pattern: /\bplaystation\b|\bps1\b|\bpsx\b/i },
  { label: 'PlayStation Vita', pattern: /\bps\s*vita\b|\bplaystation\s*vita\b/i },
  { label: 'Xbox Series X|S', pattern: /\bxbox\s+series\s+[xs]\b|\bxbox\s+series\s+x\|s\b/i },
  { label: 'Xbox One', pattern: /\bxbox\s+one\b/i },
  { label: 'Xbox 360', pattern: /\bxbox\s*360\b/i },
  { label: 'Xbox', pattern: /\bxbox\b/i },
  { label: 'PC', pattern: /\bpc\s+game\b|\bwindows\s+pc\b/i }
];

function compactWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function inferGameMetadata(rawTitle = '', entry = {}, sourceEntry = {}) {
  const source = String(rawTitle || '').trim();
  const categoryText = [
    entry?.category,
    entry?.category_path,
    entry?.categoryPath,
    entry?.department,
    entry?.product_type,
    sourceEntry?.category,
    sourceEntry?.category_path,
    sourceEntry?.department
  ].filter(Boolean).join(' ');
  const evidenceText = [
    source,
    entry?.title,
    entry?.name,
    entry?.product_name,
    entry?.description,
    sourceEntry?.description,
    entry?.brand,
    entry?.manufacturer,
    sourceEntry?.brand,
    sourceEntry?.manufacturer,
    categoryText
  ].filter(Boolean).join(' ');
  const platform = GAME_PLATFORM_PATTERNS.find((candidate) => candidate.pattern.test(evidenceText));
  const categoryMatched = /\b(video\s*games?|games?\s*&\s*consoles|console\s+games?)\b/i.test(categoryText);

  if (!platform && !categoryMatched) {
    return { title: source, platform: null, matched: false };
  }

  let cleaned = source
    .replace(/\((?:[^)]*(?:nintendo|switch|3ds|ds|wii|game\s*boy|gamecube|playstation|ps[1-5]|vita|xbox|pc\s+game)[^)]*)\)/gi, ' ')
    .replace(/\[(?:[^\]]*(?:nintendo|switch|3ds|ds|wii|game\s*boy|gamecube|playstation|ps[1-5]|vita|xbox|pc\s+game)[^\]]*)\]/gi, ' ')
    .replace(/\bfor\s+(?:nintendo\s+)?(?:switch\s+2|switch|3ds|ds|wii\s+u|wii|game\s*cube|gamecube|game\s*boy(?:\s*advance)?|playstation\s*[1-5]?|ps[1-5]|ps\s*vita|xbox(?:\s*(?:series\s+[xs]|one|360))?|pc\s+game)\b.*$/i, ' ')
    .replace(/\s+[-:]\s+(?:nintendo\s+)?(?:switch\s+2|switch|3ds|ds|wii\s+u|wii|game\s*cube|gamecube|game\s*boy(?:\s*advance)?|playstation\s*[1-5]?|ps[1-5]|ps\s*vita|xbox(?:\s*(?:series\s+[xs]|one|360))?|pc\s+game)\b.*$/i, ' ')
    .replace(/\b(pre[- ]?(?:owned|played)|used|new condition|multicolor|video game)\b/gi, ' ')
    .replace(/\s*,\s*(multicolor|standard edition)\b.*$/i, ' ')
    .replace(/\s+-\s*$/g, ' ');

  cleaned = compactWhitespace(cleaned);
  if (/^nintendo\s+\S+/i.test(cleaned) && platform?.label?.startsWith('Nintendo')) {
    cleaned = compactWhitespace(cleaned.replace(/^nintendo\s+/i, ''));
  }

  return {
    title: cleaned || source,
    platform: platform?.label || null,
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

function normalizeTitleVariantKey(value = '') {
  return normalizeBarcodeSearchTitle(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectBarcodeTitleVariants(entry = {}) {
  const variants = [];
  const seen = new Set();
  const add = (title, source = 'item', sourceIndex = null, sourceEntry = null) => {
    const value = String(title || '').trim();
    if (!value) return;
    const key = normalizeTitleVariantKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    variants.push({
      title: value,
      source,
      sourceIndex,
      sourceEntry
    });
  };

  add(entry?.title || entry?.name || entry?.product_name || null, 'item', null, entry);
  if (Array.isArray(entry?.offers)) {
    entry.offers.forEach((offer, index) => {
      add(offer?.title || offer?.name || offer?.product_name || null, 'offer', index, offer);
    });
  }
  if (Array.isArray(entry?.listings)) {
    entry.listings.forEach((listing, index) => {
      add(listing?.title || listing?.name || listing?.product_name || null, 'listing', index, listing);
    });
  }

  return variants;
}

function normalizeBarcodeEntryVariant(entry = {}, variant = {}, variantIndex = 0) {
  const rawTitle = variant.title || entry?.title || entry?.name || entry?.product_name || null;
  const { normalizedTitle, author, format, series } = parseBarcodeTitleMetadata(rawTitle);
  const tvMetadata = inferTvSeasonMetadata(normalizedTitle || rawTitle);
  const sourceEntry = variant.sourceEntry || entry;
  const gameMetadata = inferGameMetadata(tvMetadata.matched ? tvMetadata.title : (normalizedTitle || rawTitle), entry, sourceEntry);
  const searchTitle = normalizeBarcodeSearchTitle(
    gameMetadata.matched ? gameMetadata.title : (tvMetadata.matched ? tvMetadata.title : (normalizedTitle || rawTitle))
  );
  const upc = normalizeDigits(entry?.upc || entry?.barcode || entry?.ean || entry?.gtin || '');
  const inferredIsbn = inferBookBarcodeType(upc);
  const mediaTypeGuess = inferredIsbn || format ? 'book' : (gameMetadata.matched ? 'game' : (tvMetadata.matched ? 'tv_series' : 'movie'));
  const variantSource = variant.source || 'item';
  const variantSourceIndex = variant.sourceIndex;

  return {
    title: rawTitle,
    normalizedTitle: normalizedTitle || rawTitle,
    searchTitle: searchTitle || normalizedTitle || rawTitle,
    description: entry?.description || sourceEntry?.description || entry?.brand || entry?.manufacturer || entry?.publisher || null,
    image: entry?.image || entry?.image_url || entry?.images?.[0] || sourceEntry?.image || sourceEntry?.image_url || null,
    upc: upc || null,
    mediaTypeGuess,
    year: entry?.year || entry?.release_year || sourceEntry?.year || sourceEntry?.release_year || null,
    match_type: variantSource === 'item' ? 'provider_candidate' : 'provider_title_variant',
    titleVariantSource: variantSource,
    title_variant_source: variantSource,
    titleVariantIndex: variantIndex,
    title_variant_index: variantIndex,
    offerIndex: variantSource === 'offer' ? variantSourceIndex : null,
    offer_index: variantSource === 'offer' ? variantSourceIndex : null,
    listingIndex: variantSource === 'listing' ? variantSourceIndex : null,
    listing_index: variantSource === 'listing' ? variantSourceIndex : null,
    alternateTitles: collectBarcodeTitleVariants(entry)
      .map((row) => row.title)
      .filter((title) => normalizeTitleVariantKey(title) !== normalizeTitleVariantKey(rawTitle)),
    alternate_titles: collectBarcodeTitleVariants(entry)
      .map((row) => row.title)
      .filter((title) => normalizeTitleVariantKey(title) !== normalizeTitleVariantKey(rawTitle)),
    typeDetails: {
      author: author || null,
      isbn: inferredIsbn || null,
      format: format || null,
      series: series || null,
      season_number: tvMetadata.seasonNumber || null,
      platform: gameMetadata.platform || null,
      publisher: entry?.publisher || entry?.brand || entry?.manufacturer || sourceEntry?.merchant || null
    },
    raw: {
      ...entry,
      title_variant: {
        source: variantSource,
        source_index: variantSourceIndex,
        variant_index: variantIndex,
        title: rawTitle
      }
    }
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

  return list.flatMap((entry) => {
    const variants = collectBarcodeTitleVariants(entry);
    if (!variants.length) return [normalizeBarcodeEntryVariant(entry, {}, 0)];
    return variants.map((variant, index) => normalizeBarcodeEntryVariant(entry, variant, index));
  });
};

module.exports = { BARCODE_PRESETS, resolveBarcodePreset, normalizeBarcodeMatches };
