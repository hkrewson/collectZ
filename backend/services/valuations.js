const { normalizeIdentifierSet } = require('./importIdentifiers');

const DEFAULT_PRICECHARTING_API_URL = 'https://www.pricecharting.com/api';
const DEFAULT_EBAY_BROWSE_API_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const DEFAULT_EBAY_MARKETPLACE_ID = 'EBAY_US';
const MIN_PRICECHARTING_INTERVAL_MS = 1100;

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.round(numeric);
}

function buildPriceChartingRateLimitPolicy(config = {}) {
  return {
    provider: 'pricecharting',
    queueMode: 'serialized',
    concurrency: 1,
    minIntervalMs: Math.max(
      MIN_PRICECHARTING_INTERVAL_MS,
      normalizePositiveInteger(config.priceChartingRateLimitMs, MIN_PRICECHARTING_INTERVAL_MS)
    ),
    automatedTesting: 'fixture_only',
    liveSmoke: 'manual_only'
  };
}

function createSerializedRateLimiter({ minIntervalMs = MIN_PRICECHARTING_INTERVAL_MS, now = () => Date.now(), sleep } = {}) {
  const wait = typeof sleep === 'function'
    ? sleep
    : (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
  let nextAllowedAt = 0;
  let tail = Promise.resolve();

  return {
    schedule(task) {
      if (typeof task !== 'function') {
        throw new TypeError('task must be a function');
      }
      const run = async () => {
        const current = Number(now()) || 0;
        const waitMs = Math.max(0, nextAllowedAt - current);
        if (waitMs > 0) {
          await wait(waitMs);
        }
        const startedAt = Number(now()) || current;
        nextAllowedAt = startedAt + Math.max(MIN_PRICECHARTING_INTERVAL_MS, normalizePositiveInteger(minIntervalMs, MIN_PRICECHARTING_INTERVAL_MS));
        return task();
      };

      const next = tail.then(run, run);
      tail = next.catch(() => {});
      return next;
    },
    getState() {
      return {
        minIntervalMs: Math.max(MIN_PRICECHARTING_INTERVAL_MS, normalizePositiveInteger(minIntervalMs, MIN_PRICECHARTING_INTERVAL_MS)),
        nextAllowedAt
      };
    }
  };
}

function buildValuationLookupInput(media = {}) {
  const typeDetails = media?.type_details && typeof media.type_details === 'object'
    ? media.type_details
    : {};
  const identifiers = normalizeIdentifierSet({
    isbn: typeDetails.isbn || typeDetails.isbn13 || media.isbn || '',
    ean_upc: typeDetails.ean || typeDetails.ean_upc || media.upc || '',
    asin: typeDetails.asin || typeDetails.amazon_item_id || typeDetails.amazonLink || ''
  });

  const titleCandidates = [];
  const pushTitle = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    if (!titleCandidates.includes(normalized)) titleCandidates.push(normalized);
  };

  pushTitle(media.title);
  pushTitle(media.original_title);
  pushTitle(typeDetails.series);
  pushTitle(typeDetails.issue_title);

  const identifierSequence = [];
  if (identifiers.eanUpc) identifierSequence.push({ kind: 'ean_upc', value: identifiers.eanUpc });
  if (identifiers.isbn) identifierSequence.push({ kind: 'isbn', value: identifiers.isbn });
  if (identifiers.asin) identifierSequence.push({ kind: 'asin', value: identifiers.asin });

  return {
    mediaType: String(media.media_type || 'movie').trim() || 'movie',
    year: Number.isFinite(Number(media.year)) ? Number(media.year) : null,
    identifiers,
    identifierSequence,
    titleCandidates
  };
}

function buildPriceChartingDryRun(config = {}, media = {}) {
  const lookup = buildValuationLookupInput(media);
  const policy = buildPriceChartingRateLimitPolicy(config);
  const configured = Boolean(config.priceChartingEnabled && config.priceChartingApiKey);

  return {
    provider: 'pricecharting',
    ok: configured,
    authenticated: configured,
    status: configured ? 200 : 400,
    detail: configured
      ? 'Dry-run passed. Live provider traffic is intentionally disabled for automated testing; queued requests would run identifier-first behind the serialized PriceCharting rate limiter.'
      : 'Enable PriceCharting and provide an API key to allow queued valuation lookups.',
    liveNetwork: false,
    lookupPlan: {
      mode: lookup.identifierSequence.length > 0 ? 'identifier_first_with_title_fallback' : 'title_fallback_only',
      identifierSequence: lookup.identifierSequence,
      titleCandidates: lookup.titleCandidates,
      year: lookup.year
    },
    rateLimitPolicy: policy
  };
}

function buildEbayBrowseDryRun(config = {}, media = {}) {
  const lookup = buildValuationLookupInput(media);
  const configured = Boolean(config.eBayBrowseEnabled && config.eBayBrowseClientId && config.eBayBrowseClientSecret);

  return {
    provider: 'ebay_browse',
    ok: configured,
    authenticated: configured,
    status: configured ? 200 : 400,
    detail: configured
      ? 'Dry-run passed. eBay Browse is configured and ready for identifier-first or keyword fallback valuation lookups once the provider execution slice is enabled.'
      : 'Enable eBay Browse and provide both client credentials to allow valuation fallback lookups.',
    liveNetwork: false,
    lookupPlan: {
      mode: lookup.identifierSequence.length > 0 ? 'identifier_first_with_keyword_fallback' : 'keyword_fallback_only',
      identifierSequence: lookup.identifierSequence,
      keywordCandidates: lookup.titleCandidates,
      year: lookup.year,
      marketplaceId: config.eBayBrowseMarketplaceId || DEFAULT_EBAY_MARKETPLACE_ID
    }
  };
}

function formatValuationDisplay(value, currency = 'USD') {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: String(currency || 'USD').trim().toUpperCase() || 'USD',
      maximumFractionDigits: 2
    }).format(numeric);
  } catch (_) {
    return `${String(currency || 'USD').trim().toUpperCase() || 'USD'} ${numeric.toFixed(2)}`;
  }
}

module.exports = {
  DEFAULT_PRICECHARTING_API_URL,
  DEFAULT_EBAY_BROWSE_API_URL,
  DEFAULT_EBAY_MARKETPLACE_ID,
  MIN_PRICECHARTING_INTERVAL_MS,
  normalizePositiveInteger,
  buildPriceChartingRateLimitPolicy,
  createSerializedRateLimiter,
  buildValuationLookupInput,
  buildPriceChartingDryRun,
  buildEbayBrowseDryRun,
  formatValuationDisplay
};
