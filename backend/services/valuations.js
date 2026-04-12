const axios = require('axios');
const { normalizeIdentifierSet } = require('./importIdentifiers');
const { recordProviderRequestEvent } = require('./metrics');

const DEFAULT_PRICECHARTING_API_URL = 'https://www.pricecharting.com/api';
const DEFAULT_EBAY_BROWSE_API_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const DEFAULT_EBAY_MARKETPLACE_ID = 'EBAY_US';
const MIN_PRICECHARTING_INTERVAL_MS = 1100;
const priceChartingLimiterCache = new Map();
const eBayAppTokenCache = new Map();

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

function getSerializedPriceChartingLimiter(config = {}) {
  const minIntervalMs = Math.max(
    MIN_PRICECHARTING_INTERVAL_MS,
    normalizePositiveInteger(config.priceChartingRateLimitMs, MIN_PRICECHARTING_INTERVAL_MS)
  );
  const cacheKey = String(minIntervalMs);
  if (!priceChartingLimiterCache.has(cacheKey)) {
    priceChartingLimiterCache.set(cacheKey, createSerializedRateLimiter({ minIntervalMs }));
  }
  return priceChartingLimiterCache.get(cacheKey);
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
      ? 'Dry-run passed. eBay Browse is configured for identifier-first or keyword fallback valuation refreshes, with automated proof still fixture-backed by default.'
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

function deterministicHash(input = '') {
  const source = String(input || '');
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function buildFixtureValuationResult(media = {}, provider = 'pricecharting') {
  const lookup = buildValuationLookupInput(media);
  const seedSource = [
    provider,
    media.id,
    media.title,
    lookup.identifiers.eanUpc,
    lookup.identifiers.isbn,
    lookup.identifiers.asin,
    media.year
  ].filter(Boolean).join('|');
  const hash = deterministicHash(seedSource);
  const mid = Number((((hash % 45000) + 1500) / 100).toFixed(2));
  const low = Number((mid * 0.78).toFixed(2));
  const high = Number((mid * 1.24).toFixed(2));
  return {
    provider,
    matched: true,
    liveNetwork: false,
    fixture: true,
    lookupPlan: {
      mode: lookup.identifierSequence.length > 0 ? 'identifier_first_with_title_fallback' : 'title_fallback_only',
      identifierSequence: lookup.identifierSequence,
      titleCandidates: lookup.titleCandidates,
      year: lookup.year
    },
    valuation: {
      low,
      mid,
      high,
      currency: 'USD',
      source: provider === 'ebay_browse' ? 'eBay Browse (fixture)' : 'PriceCharting (fixture)',
      lastUpdatedAt: new Date().toISOString()
    }
  };
}

function parsePriceValue(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) return null;
  if (Number.isInteger(numeric) && numeric >= 100) return Number((numeric / 100).toFixed(2));
  return Number(numeric.toFixed(2));
}

function extractPriceChartingValuation(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const low = parsePriceValue(
    payload['loose-price']
    ?? payload.loose_price
    ?? payload['ungraded-price']
    ?? payload.ungraded_price
    ?? payload.price
  );
  const mid = parsePriceValue(
    payload['cib-price']
    ?? payload.cib_price
    ?? payload['graded-price']
    ?? payload.graded_price
    ?? low
    ?? payload.price
  );
  const high = parsePriceValue(
    payload['new-price']
    ?? payload.new_price
    ?? payload['graded-price']
    ?? payload.graded_price
    ?? mid
    ?? low
    ?? payload.price
  );
  if (![low, mid, high].some((value) => Number.isFinite(value))) {
    return null;
  }
  return {
    low: Number.isFinite(low) ? low : (Number.isFinite(mid) ? mid : high),
    mid: Number.isFinite(mid) ? mid : (Number.isFinite(low) ? low : high),
    high: Number.isFinite(high) ? high : (Number.isFinite(mid) ? mid : low),
    currency: 'USD',
    source: 'PriceCharting',
    productId: payload.id || payload.product_id || null,
    productName: payload['product-name'] || payload.product_name || payload.name || null,
    consoleName: payload.console_name || payload.console || null
  };
}

function deriveEbayTokenUrl(searchUrl = DEFAULT_EBAY_BROWSE_API_URL) {
  const raw = String(searchUrl || DEFAULT_EBAY_BROWSE_API_URL).trim();
  try {
    const parsed = new URL(raw);
    if (/api\.sandbox\.ebay\.com$/i.test(parsed.hostname)) {
      return 'https://api.sandbox.ebay.com/identity/v1/oauth2/token';
    }
  } catch (_) {
    // Fall through to the production default if the configured URL is malformed.
  }
  return 'https://api.ebay.com/identity/v1/oauth2/token';
}

function buildEbayKeywordCandidate(title = '', year = null) {
  const normalizedTitle = String(title || '').trim();
  if (!normalizedTitle) return '';
  const numericYear = Number.isFinite(Number(year)) ? Number(year) : null;
  return numericYear ? `${normalizedTitle} ${numericYear}` : normalizedTitle;
}

function extractEbayBrowseValuation(payload = {}, { currency = 'USD' } = {}) {
  const summaries = Array.isArray(payload?.itemSummaries)
    ? payload.itemSummaries
    : [];
  const prices = summaries
    .map((summary) => {
      const rawValue = summary?.price?.value;
      const numeric = Number(rawValue);
      return Number.isFinite(numeric) && numeric > 0
        ? {
          value: Number(numeric.toFixed(2)),
          currency: String(summary?.price?.currency || currency || 'USD').trim().toUpperCase() || 'USD',
          itemId: summary?.itemId || null,
          title: summary?.title || null,
          itemWebUrl: summary?.itemWebUrl || null,
          condition: summary?.condition || null
        }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.value - right.value);

  if (prices.length === 0) {
    return null;
  }

  const low = prices[0].value;
  const high = prices[prices.length - 1].value;
  const medianIndex = Math.floor(prices.length / 2);
  const mid = prices.length % 2 === 0
    ? Number((((prices[medianIndex - 1].value + prices[medianIndex].value) / 2)).toFixed(2))
    : prices[medianIndex].value;

  return {
    low,
    mid,
    high,
    currency: prices[medianIndex]?.currency || prices[0]?.currency || String(currency || 'USD').trim().toUpperCase() || 'USD',
    source: 'eBay Browse',
    sampleSize: prices.length,
    sampleTitles: prices.slice(0, 3).map((entry) => entry.title).filter(Boolean),
    itemIds: prices.slice(0, 3).map((entry) => entry.itemId).filter(Boolean)
  };
}

async function getEbayApplicationToken(config = {}, { httpClient = axios, now = () => Date.now() } = {}) {
  if (!config.eBayBrowseEnabled || !config.eBayBrowseClientId || !config.eBayBrowseClientSecret) {
    throw new Error('eBay Browse is not configured');
  }

  const tokenUrl = deriveEbayTokenUrl(config.eBayBrowseApiUrl);
  const cacheKey = `${tokenUrl}|${config.eBayBrowseClientId}`;
  const current = Number(now()) || Date.now();
  const cached = eBayAppTokenCache.get(cacheKey);
  if (cached && cached.token && cached.expiresAt > current + 15000) {
    return cached.token;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'https://api.ebay.com/oauth/api_scope'
  }).toString();
  const basicAuth = Buffer.from(`${config.eBayBrowseClientId}:${config.eBayBrowseClientSecret}`).toString('base64');
  const response = await httpClient.post(tokenUrl, body, {
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    timeout: 10000,
    validateStatus: () => true
  });

  if (response.status >= 500) {
    recordProviderRequestEvent('ebay_browse', 'valuation_refresh', 'provider_error');
    throw new Error(`eBay Browse token service responded with ${response.status}`);
  }
  if (response.status >= 400) {
    recordProviderRequestEvent('ebay_browse', 'valuation_refresh', 'request_rejected');
    throw new Error(`eBay Browse token request was rejected with ${response.status}`);
  }

  const accessToken = String(response?.data?.access_token || '').trim();
  if (!accessToken) {
    recordProviderRequestEvent('ebay_browse', 'valuation_refresh', 'token_missing');
    throw new Error('eBay Browse token service did not return an access token');
  }
  const expiresInSeconds = Math.max(60, Number(response?.data?.expires_in || 7200) || 7200);
  eBayAppTokenCache.set(cacheKey, {
    token: accessToken,
    expiresAt: current + (expiresInSeconds * 1000)
  });
  return accessToken;
}

async function requestEbayBrowseValuation(config = {}, media = {}, { httpClient = axios } = {}) {
  if (!config.eBayBrowseEnabled || !config.eBayBrowseClientId || !config.eBayBrowseClientSecret) {
    throw new Error('eBay Browse is not configured');
  }

  const lookup = buildValuationLookupInput(media);
  const querySequence = [];
  for (const identifier of lookup.identifierSequence) {
    if (identifier.kind === 'ean_upc' || identifier.kind === 'isbn') {
      querySequence.push({ mode: 'gtin', value: identifier.value });
    }
  }
  for (const title of lookup.titleCandidates) {
    querySequence.push({ mode: 'q', value: buildEbayKeywordCandidate(title, lookup.year) });
  }
  if (querySequence.length === 0) {
    throw new Error('No supported valuation lookup identifiers or titles are available for this media item');
  }

  const accessToken = await getEbayApplicationToken(config, { httpClient });
  for (const candidate of querySequence) {
    const params = {
      limit: 10
    };
    if (candidate.mode === 'gtin') params.gtin = candidate.value;
    else params.q = candidate.value;

    const response = await httpClient.get(
      config.eBayBrowseApiUrl || DEFAULT_EBAY_BROWSE_API_URL,
      {
        params,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-EBAY-C-MARKETPLACE-ID': config.eBayBrowseMarketplaceId || DEFAULT_EBAY_MARKETPLACE_ID
        },
        timeout: 10000,
        validateStatus: () => true
      }
    );

    if (response.status === 429) {
      recordProviderRequestEvent('ebay_browse', 'valuation_refresh', 'rate_limited');
      throw new Error('eBay Browse temporarily rejected the valuation lookup due to rate limiting');
    }
    if (response.status >= 500) {
      recordProviderRequestEvent('ebay_browse', 'valuation_refresh', 'provider_error');
      throw new Error(`eBay Browse responded with ${response.status}`);
    }
    if (response.status >= 400) {
      recordProviderRequestEvent('ebay_browse', 'valuation_refresh', 'request_rejected');
      continue;
    }

    const extracted = extractEbayBrowseValuation(response.data);
    if (extracted) {
      recordProviderRequestEvent('ebay_browse', 'valuation_refresh', 'success');
      return {
        provider: 'ebay_browse',
        matched: true,
        liveNetwork: true,
        fixture: false,
        lookupPlan: {
          mode: lookup.identifierSequence.length > 0 ? 'identifier_first_with_keyword_fallback' : 'keyword_fallback_only',
          identifierSequence: lookup.identifierSequence,
          keywordCandidates: lookup.titleCandidates.map((title) => buildEbayKeywordCandidate(title, lookup.year)),
          year: lookup.year,
          matchedBy: candidate.mode
        },
        valuation: {
          low: extracted.low,
          mid: extracted.mid,
          high: extracted.high,
          currency: extracted.currency || 'USD',
          source: extracted.source || 'eBay Browse',
          lastUpdatedAt: new Date().toISOString()
        },
        metadata: {
          sampleSize: extracted.sampleSize,
          itemIds: extracted.itemIds,
          sampleTitles: extracted.sampleTitles
        }
      };
    }
    recordProviderRequestEvent('ebay_browse', 'valuation_refresh', 'no_match');
  }

  return {
    provider: 'ebay_browse',
    matched: false,
    liveNetwork: true,
    fixture: false,
    lookupPlan: {
      mode: lookup.identifierSequence.length > 0 ? 'identifier_first_with_keyword_fallback' : 'keyword_fallback_only',
      identifierSequence: lookup.identifierSequence,
      keywordCandidates: lookup.titleCandidates.map((title) => buildEbayKeywordCandidate(title, lookup.year)),
      year: lookup.year
    },
    valuation: null
  };
}

async function requestPriceChartingValuation(config = {}, media = {}, { httpClient = axios } = {}) {
  if (!config.priceChartingEnabled || !config.priceChartingApiKey) {
    throw new Error('PriceCharting is not configured');
  }

  const lookup = buildValuationLookupInput(media);
  const querySequence = [];
  for (const identifier of lookup.identifierSequence) {
    if (identifier.kind === 'ean_upc') {
      querySequence.push({ kind: 'upc', value: identifier.value });
    }
  }
  for (const title of lookup.titleCandidates) {
    querySequence.push({ kind: 'q', value: title });
  }
  if (querySequence.length === 0) {
    throw new Error('No supported valuation lookup identifiers or titles are available for this media item');
  }

  const limiter = getSerializedPriceChartingLimiter(config);
  return limiter.schedule(async () => {
    for (const candidate of querySequence) {
      const params = { t: config.priceChartingApiKey };
      if (candidate.kind === 'upc') params.upc = candidate.value;
      else params.q = candidate.value;

      const response = await httpClient.get(
        `${config.priceChartingApiUrl || DEFAULT_PRICECHARTING_API_URL}/product`,
        {
          params,
          timeout: 10000,
          validateStatus: () => true
        }
      );

      if (response.status === 429) {
        recordProviderRequestEvent('pricecharting', 'valuation_refresh', 'rate_limited');
        throw new Error('PriceCharting temporarily rejected the valuation lookup due to rate limiting');
      }
      if (response.status >= 500) {
        recordProviderRequestEvent('pricecharting', 'valuation_refresh', 'provider_error');
        throw new Error(`PriceCharting responded with ${response.status}`);
      }
      if (response.status >= 400) {
        recordProviderRequestEvent('pricecharting', 'valuation_refresh', 'request_rejected');
        continue;
      }

      const extracted = extractPriceChartingValuation(response.data);
      if (extracted) {
        recordProviderRequestEvent('pricecharting', 'valuation_refresh', 'success');
        return {
          provider: 'pricecharting',
          matched: true,
          liveNetwork: true,
          fixture: false,
          lookupPlan: {
            mode: lookup.identifierSequence.length > 0 ? 'identifier_first_with_title_fallback' : 'title_fallback_only',
            identifierSequence: lookup.identifierSequence,
            titleCandidates: lookup.titleCandidates,
            year: lookup.year,
            matchedBy: candidate.kind
          },
          valuation: {
            low: extracted.low,
            mid: extracted.mid,
            high: extracted.high,
            currency: extracted.currency || 'USD',
            source: extracted.source || 'PriceCharting',
            lastUpdatedAt: new Date().toISOString()
          },
          metadata: {
            productId: extracted.productId,
            productName: extracted.productName,
            consoleName: extracted.consoleName
          }
        };
      }
      recordProviderRequestEvent('pricecharting', 'valuation_refresh', 'no_match');
    }

    return {
      provider: 'pricecharting',
      matched: false,
      liveNetwork: true,
      fixture: false,
      lookupPlan: {
        mode: lookup.identifierSequence.length > 0 ? 'identifier_first_with_title_fallback' : 'title_fallback_only',
        identifierSequence: lookup.identifierSequence,
        titleCandidates: lookup.titleCandidates,
        year: lookup.year
      },
      valuation: null
    };
  });
}

async function refreshMediaValuation(media = {}, config = {}, { mode = 'live', httpClient = axios } = {}) {
  if (String(mode || 'live').trim().toLowerCase() === 'fixture') {
    const provider = config.priceChartingEnabled
      ? 'pricecharting'
      : (config.eBayBrowseEnabled ? 'ebay_browse' : 'pricecharting');
    return buildFixtureValuationResult(media, provider);
  }

  if (config.priceChartingEnabled && config.priceChartingApiKey) {
    const outcome = await requestPriceChartingValuation(config, media, { httpClient });
    if (outcome?.matched || !(config.eBayBrowseEnabled && config.eBayBrowseClientId && config.eBayBrowseClientSecret)) {
      return outcome;
    }
    return requestEbayBrowseValuation(config, media, { httpClient });
  }
  if (config.eBayBrowseEnabled && config.eBayBrowseClientId && config.eBayBrowseClientSecret) {
    return requestEbayBrowseValuation(config, media, { httpClient });
  }
  throw new Error('No valuation provider is configured for execution');
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
  getSerializedPriceChartingLimiter,
  buildFixtureValuationResult,
  extractPriceChartingValuation,
  deriveEbayTokenUrl,
  buildEbayKeywordCandidate,
  extractEbayBrowseValuation,
  getEbayApplicationToken,
  requestPriceChartingValuation,
  requestEbayBrowseValuation,
  refreshMediaValuation,
  formatValuationDisplay
};
