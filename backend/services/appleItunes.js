const crypto = require('crypto');
const appMeta = require('../app-meta.json');

const PROVIDER = 'apple_itunes';
const SEARCH_URL = 'https://itunes.apple.com/search';
const LOOKUP_URL = 'https://itunes.apple.com/lookup';
const SUPPORTED_MEDIA = new Set([
  'movie',
  'tvShow',
  'music',
  'musicVideo',
  'audiobook',
  'ebook',
  'podcast',
  'shortFilm',
  'software',
  'all'
]);

function trimString(value) {
  return String(value || '').trim();
}

function normalizeCountry(value) {
  const country = trimString(value || 'US').toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : 'US';
}

function normalizeLimit(value) {
  const parsed = Number(value || 25);
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(50, Math.max(1, Math.floor(parsed)));
}

function normalizeMediaList(value) {
  const rawValues = Array.isArray(value) ? value : [value || 'movie'];
  const media = rawValues
    .flatMap((entry) => String(entry || '').split(','))
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => SUPPORTED_MEDIA.has(entry));

  if (media.includes('all')) return ['all'];
  return Array.from(new Set(media.length ? media : ['movie']));
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') ?? null;
}

function normalizeArtworkUrl(value) {
  const url = trimString(value);
  if (!url) return null;
  return url.replace(/\/100x100bb\./, '/600x600bb.').replace(/\/100x100-75\./, '/600x600-75.');
}

function normalizeYear(value) {
  const match = trimString(value).match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

function normalizePrice(result) {
  const value = firstValue(result.trackPrice, result.collectionPrice, result.price);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function inferObjectType(result, requestedMedia = '') {
  const media = trimString(requestedMedia || result.mediaType || result.wrapperType);
  const kind = trimString(result.kind).toLowerCase();
  const genre = trimString(result.primaryGenreName).toLowerCase();

  if (media === 'ebook' || kind === 'book') return 'book';
  if (media === 'tvShow' || kind.includes('tv-')) return 'tv_series';
  if (media === 'audiobook' || media === 'podcast' || media === 'music' || kind === 'song' || kind.includes('podcast')) return 'audio';
  if (media === 'software' && genre.includes('game')) return 'game';
  if (media === 'movie' || media === 'shortFilm' || media === 'musicVideo' || kind.includes('movie') || kind.includes('film')) return 'movie';
  return 'other';
}

function providerKeyForResult(result) {
  const key = firstValue(result.trackId, result.collectionId, result.artistId, result.trackViewUrl, result.collectionViewUrl, result.artistViewUrl);
  return key === null ? null : String(key);
}

function candidateId(providerKey, result) {
  if (providerKey) return `${PROVIDER}:${providerKey}`;
  const digest = crypto
    .createHash('sha1')
    .update(JSON.stringify(result || {}))
    .digest('hex')
    .slice(0, 16);
  return `${PROVIDER}:raw:${digest}`;
}

function normalizeAppleItunesResult(result, options = {}) {
  if (!result || typeof result !== 'object') return null;
  const providerKey = providerKeyForResult(result);
  const title = firstValue(result.trackName, result.collectionName, result.artistName);
  if (!title) return null;

  const storeUrl = firstValue(result.trackViewUrl, result.collectionViewUrl, result.artistViewUrl);
  const media = trimString(options.media || result.mediaType || result.wrapperType || '');
  const kind = trimString(result.kind || result.wrapperType || '');
  const subtitleParts = [
    result.artistName && result.artistName !== title ? result.artistName : null,
    result.collectionName && result.collectionName !== title ? result.collectionName : null,
    result.primaryGenreName
  ].filter(Boolean);

  return {
    id: candidateId(providerKey, result),
    provider: PROVIDER,
    provider_key: providerKey,
    title: String(title),
    subtitle: subtitleParts.slice(0, 2).join(' · ') || null,
    object_type: inferObjectType(result, options.media),
    media: media || null,
    kind: kind || null,
    year: normalizeYear(result.releaseDate),
    price: normalizePrice(result),
    currency: result.currency || null,
    artwork_url: normalizeArtworkUrl(firstValue(result.artworkUrl100, result.artworkUrl60)),
    store_url: storeUrl || null,
    raw_result: result
  };
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const unique = [];
  for (const candidate of candidates) {
    const key = candidate.provider_key || candidate.store_url || `${candidate.title}:${candidate.media}:${candidate.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

async function fetchAppleSearch({ term, media = ['movie'], country = 'US', limit = 25, fetchImpl = global.fetch } = {}) {
  const normalizedTerm = trimString(term);
  if (!normalizedTerm) return [];
  if (typeof fetchImpl !== 'function') throw new Error('Apple/iTunes search is unavailable in this runtime.');

  const mediaList = normalizeMediaList(media);
  const normalizedCountry = normalizeCountry(country);
  const normalizedLimit = normalizeLimit(limit);
  const requests = mediaList.map(async (mediaType) => {
    const url = new URL(process.env.APPLE_ITUNES_SEARCH_URL || SEARCH_URL);
    url.searchParams.set('term', normalizedTerm);
    url.searchParams.set('media', mediaType);
    url.searchParams.set('country', normalizedCountry);
    url.searchParams.set('limit', String(normalizedLimit));
    url.searchParams.set('explicit', 'No');

    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': appMeta.userAgent || 'collectZ'
      },
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(8000)
        : undefined
    });
    if (!response.ok) {
      throw new Error(`Apple/iTunes search failed with HTTP ${response.status}.`);
    }
    const payload = await response.json();
    const results = Array.isArray(payload?.results) ? payload.results : [];
    return results.map((result) => normalizeAppleItunesResult(result, { media: mediaType })).filter(Boolean);
  });

  const settled = await Promise.all(requests);
  return dedupeCandidates(settled.flat()).slice(0, normalizedLimit);
}

async function fetchAppleLookup({ providerKey, country = 'US', fetchImpl = global.fetch } = {}) {
  const normalizedProviderKey = trimString(providerKey);
  if (!normalizedProviderKey || !/^\d+$/.test(normalizedProviderKey)) return null;
  if (typeof fetchImpl !== 'function') throw new Error('Apple/iTunes lookup is unavailable in this runtime.');

  const url = new URL(process.env.APPLE_ITUNES_LOOKUP_URL || LOOKUP_URL);
  url.searchParams.set('id', normalizedProviderKey);
  url.searchParams.set('country', normalizeCountry(country));
  url.searchParams.set('explicit', 'No');

  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': appMeta.userAgent || 'collectZ'
    },
    signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(8000)
      : undefined
  });
  if (!response.ok) {
    throw new Error(`Apple/iTunes lookup failed with HTTP ${response.status}.`);
  }
  const payload = await response.json();
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const matches = dedupeCandidates(results.map((result) => normalizeAppleItunesResult(result)).filter(Boolean));
  return matches.find((candidate) => String(candidate.provider_key) === normalizedProviderKey) || matches[0] || null;
}

module.exports = {
  PROVIDER,
  SUPPORTED_MEDIA,
  normalizeCountry,
  normalizeLimit,
  normalizeMediaList,
  normalizeAppleItunesResult,
  dedupeCandidates,
  fetchAppleSearch,
  fetchAppleLookup
};
