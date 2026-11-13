'use strict';

const { fetchOpdsCatalog, normalizeOpdsPublication } = require('./opdsTransport');
const { parseHttpUrl } = require('./outboundUrlPolicy');

const BOOKORBIT_ENTRY_ID = /^urn:bookorbit:book:\d+$/i;
const BOOKORBIT_ALL_BOOKS_ID = 'urn:bookorbit:all';
const BOOKORBIT_NATIVE_PROVIDER_KEYS = Object.freeze([
  'google', 'goodreads', 'amazon', 'hardcover', 'openLibrary', 'itunes',
  'audible', 'librofm', 'kobo', 'comicvine', 'ranobedb', 'lubimyczytac', 'aladin'
]);

function atomText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return String(value['#text'] ?? '').trim();
  return String(value).trim();
}

function selectBookOrbitNavigationLinks({ navigationEntries }) {
  const allBooks = navigationEntries.find(({ entry }) => atomText(entry?.id).toLowerCase() === BOOKORBIT_ALL_BOOKS_ID);
  return allBooks
    ? allBooks.links
    : navigationEntries.flatMap(({ links }) => links);
}

function normalizeDate(raw) {
  const value = String(raw || '').trim();
  if (!value) return { year: null, releaseDate: null };
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { year: Number(iso[1]), releaseDate: `${iso[1]}-${iso[2]}-${iso[3]}` };
  return { year: null, releaseDate: null };
}

function normalizeBookOrbitEntry(entry = {}, baseUrl = '') {
  const publication = normalizeOpdsPublication(entry, baseUrl);
  if (!publication) return null;
  const externalId = String(publication.entryId || '').trim();
  if (!BOOKORBIT_ENTRY_ID.test(externalId)) {
    const error = new Error('BookOrbit publication entry has an invalid Atom id');
    error.code = 'BOOKORBIT_ENTRY_ID_INVALID';
    throw error;
  }
  const published = normalizeDate(publication.publishedAt);
  const isUnsupportedAudio = String(publication.acquisitionType || '').toLowerCase().startsWith('audio/');
  return {
    title: publication.title,
    media_type: isUnsupportedAudio ? 'audio' : (publication.isComic ? 'comic_book' : 'book'),
    year: published.year,
    release_date: published.releaseDate,
    format: 'Digital',
    overview: publication.summary || null,
    tmdb_url: null,
    external_url: null,
    poster_path: publication.coverUrl || null,
    type_details: {
      author: publication.authors.join(', ') || null,
      publisher: publication.publisher || null,
      isbn: publication.isbn || null,
      edition: null,
      series: publication.series.name,
      series_index: publication.series.index,
      provider_name: 'bookorbit',
      provider_item_id: externalId,
      provider_external_url: null,
      provider_download_url: publication.downloadUrl || null,
      provider_series_url: publication.series.url,
      source_updated_at: publication.updatedAt || null
    },
    ...(isUnsupportedAudio
      ? { import_validation_error: 'BookOrbit audio acquisitions are not supported by this import yet' }
      : {})
  };
}

function prepareBookOrbitImportRows(rows = []) {
  const values = Array.isArray(rows) ? rows : [];
  const titleCounts = new Map();
  for (const row of values) {
    if (row?.import_validation_error) continue;
    const titleKey = String(row?.title || '').trim().toLowerCase();
    if (!titleKey) continue;
    titleCounts.set(titleKey, (titleCounts.get(titleKey) || 0) + 1);
  }
  return values.map((row) => {
    const titleKey = String(row?.title || '').trim().toLowerCase();
    const duplicateCount = titleCounts.get(titleKey) || 0;
    if (duplicateCount < 2) return row;
    return {
      ...row,
      import_review_reasons: [
        `BookOrbit exposes ${duplicateCount} distinct provider records with this visible title`
      ]
    };
  });
}

function buildBookOrbitEndpoint(baseUrl, catalogPath = '/api/v1/opds') {
  const endpoint = parseHttpUrl(baseUrl);
  if (!endpoint) {
    const error = new Error('BookOrbit server URL must use HTTP without embedded credentials');
    error.code = 'BOOKORBIT_ENDPOINT_INVALID';
    error.status = 400;
    throw error;
  }
  const path = String(catalogPath || '').trim();
  if (!path.startsWith('/') || path.length > 512) {
    const error = new Error('BookOrbit catalog path is invalid');
    error.code = 'BOOKORBIT_ENDPOINT_INVALID';
    error.status = 400;
    throw error;
  }
  return new URL(path, `${endpoint.origin}/`).toString();
}

function bookOrbitBookId(value) {
  const match = String(value || '').trim().match(/^urn:bookorbit:book:(\d+)$/i);
  const id = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function buildBookOrbitNativeBookEndpoint(baseUrl, bookIdValue) {
  const endpoint = parseHttpUrl(baseUrl);
  const bookId = Number(bookIdValue);
  if (!endpoint || !Number.isSafeInteger(bookId) || bookId <= 0) {
    const error = new Error('BookOrbit native book endpoint is invalid');
    error.code = 'BOOKORBIT_NATIVE_ENDPOINT_INVALID';
    throw error;
  }
  return new URL(`/api/v1/books/${bookId}`, `${endpoint.origin}/`).toString();
}

function boundedText(value, maxLength = 512) {
  const normalized = String(value ?? '').trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function joinedText(value) {
  if (!Array.isArray(value)) return null;
  const entries = value.map((entry) => boundedText(entry, 255)).filter(Boolean);
  return entries.length > 0 ? entries.join(', ') : null;
}

function normalizeBookOrbitProviderIds(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(BOOKORBIT_NATIVE_PROVIDER_KEYS.map((key) => {
    const externalId = boundedText(source[key], 512);
    return [key, externalId];
  }).filter(([, externalId]) => externalId));
}

function mergeBookOrbitNativeDetail(row = {}, detail = {}) {
  const expectedId = bookOrbitBookId(row?.type_details?.provider_item_id);
  const detailId = Number(detail?.id || 0);
  if (!expectedId || !Number.isSafeInteger(detailId) || detailId !== expectedId) {
    const error = new Error('BookOrbit native response did not match the OPDS publication identity');
    error.code = 'BOOKORBIT_NATIVE_IDENTITY_MISMATCH';
    throw error;
  }
  const memberships = Array.isArray(detail.seriesMemberships)
    ? detail.seriesMemberships
      .map((membership) => ({
        name: boundedText(membership?.seriesName),
        index: boundedText(membership?.seriesIndex, 80),
        order: Number(membership?.displayOrder || 0)
      }))
      .filter((membership) => membership.name)
      .sort((left, right) => left.order - right.order)
    : [];
  const primarySeries = memberships[0] || null;
  const providerIds = normalizeBookOrbitProviderIds(detail.providerIds);
  const comic = detail.comicMetadata && typeof detail.comicMetadata === 'object'
    ? detail.comicMetadata
    : {};
  const providerFields = Object.fromEntries(Object.entries(providerIds).map(([key, externalId]) => [
    `bookorbit_${key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}_id`,
    externalId
  ]));
  return {
    ...row,
    type_details: {
      ...(row.type_details || {}),
      series: primarySeries?.name || boundedText(detail.seriesName) || row?.type_details?.series || null,
      series_index: primarySeries?.index || boundedText(detail.seriesIndex, 80) || row?.type_details?.series_index || null,
      issue_number: boundedText(comic.issueNumber, 80) || row?.type_details?.issue_number || null,
      volume: boundedText(comic.volumeName) || row?.type_details?.volume || null,
      artist: joinedText(comic.pencillers) || row?.type_details?.artist || null,
      inker: joinedText(comic.inkers) || row?.type_details?.inker || null,
      colorist: joinedText(comic.colorists) || row?.type_details?.colorist || null,
      bookorbit_letterer: joinedText(comic.letterers),
      bookorbit_cover_artist: joinedText(comic.coverArtists),
      bookorbit_characters: joinedText(comic.characters),
      bookorbit_teams: joinedText(comic.teams),
      bookorbit_locations: joinedText(comic.locations),
      bookorbit_story_arcs: joinedText(comic.storyArcs),
      bookorbit_book_id: String(detailId),
      bookorbit_native_metadata: 'available',
      ...providerFields,
      source_updated_at: boundedText(detail.updatedAt, 80) || row?.type_details?.source_updated_at || null
    }
  };
}

async function fetchBookOrbitNativeBookDetail(config = {}, bookIdValue) {
  const apiKey = String(config.apiKey || '').trim();
  if (!apiKey || apiKey.length > 4096) {
    const error = new Error('BookOrbit native API key is not configured');
    error.code = 'BOOKORBIT_NATIVE_NOT_CONFIGURED';
    throw error;
  }
  const endpointUrl = buildBookOrbitNativeBookEndpoint(config.baseUrl || config.endpointUrl, bookIdValue);
  const timeoutMs = Math.max(1000, Math.min(120000, Number(config.timeoutMs || 20000)));
  let response;
  try {
    response = await fetch(endpointUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'collectZ-bookorbit-native/1.0',
        'X-Api-Key': apiKey
      },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (cause) {
    const error = new Error('BookOrbit native metadata request failed');
    error.code = 'BOOKORBIT_NATIVE_UNAVAILABLE';
    error.cause = cause;
    throw error;
  }
  if (response.status === 401 || response.status === 403) {
    const error = new Error('BookOrbit native API authentication failed');
    error.code = 'BOOKORBIT_NATIVE_AUTHENTICATION_FAILED';
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`BookOrbit native metadata request returned HTTP ${response.status}`);
    error.code = 'BOOKORBIT_NATIVE_UNAVAILABLE';
    throw error;
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > 2 * 1024 * 1024) {
    const error = new Error('BookOrbit native metadata response exceeded the safety limit');
    error.code = 'BOOKORBIT_NATIVE_RESPONSE_TOO_LARGE';
    throw error;
  }
  const body = await response.text();
  if (Buffer.byteLength(body) > 2 * 1024 * 1024) {
    const error = new Error('BookOrbit native metadata response exceeded the safety limit');
    error.code = 'BOOKORBIT_NATIVE_RESPONSE_TOO_LARGE';
    throw error;
  }
  try {
    const detail = JSON.parse(body);
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) throw new TypeError('invalid payload');
    return detail;
  } catch (cause) {
    const error = new Error('BookOrbit native metadata response was invalid');
    error.code = 'BOOKORBIT_NATIVE_RESPONSE_INVALID';
    error.cause = cause;
    throw error;
  }
}

async function enrichBookOrbitRowsWithNativeMetadata(rows = [], config = {}, options = {}) {
  const values = Array.isArray(rows) ? rows : [];
  const apiKey = String(config.apiKey || '').trim();
  const result = {
    rows: [...values],
    configured: Boolean(apiKey),
    attempted: 0,
    enriched: 0,
    fallback: 0,
    providerIdentifierRows: 0
  };
  if (!apiKey || values.length === 0) return result;
  const concurrency = Math.max(1, Math.min(8, Number(options.concurrency || 4)));
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      const row = values[index];
      const bookId = bookOrbitBookId(row?.type_details?.provider_item_id);
      if (!bookId || row?.import_validation_error) continue;
      result.attempted += 1;
      try {
        const detail = await fetchBookOrbitNativeBookDetail(config, bookId);
        result.rows[index] = mergeBookOrbitNativeDetail(row, detail);
        result.enriched += 1;
        if (Object.keys(normalizeBookOrbitProviderIds(detail.providerIds)).length > 0) {
          result.providerIdentifierRows += 1;
        }
      } catch {
        result.fallback += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return result;
}

async function fetchBookOrbitOpdsItems(config = {}, options = {}) {
  try {
    return await fetchOpdsCatalog({
      endpointUrl: config.endpointUrl,
      username: config.username,
      password: config.password,
      timeoutMs: config.timeoutMs,
      userAgent: 'collectZ-bookorbit-opds/1.0',
      normalizeEntry: normalizeBookOrbitEntry,
      selectNavigationLinks: selectBookOrbitNavigationLinks
    }, options);
  } catch (error) {
    if (error?.code === 'OPDS_PAGE_LIMIT_EXCEEDED') {
      error.message = 'BookOrbit catalog needs more pages than this connection allows. Increase Maximum pages under Integrations.';
    }
    throw error;
  }
}

module.exports = {
  BOOKORBIT_ENTRY_ID,
  BOOKORBIT_ALL_BOOKS_ID,
  BOOKORBIT_NATIVE_PROVIDER_KEYS,
  buildBookOrbitEndpoint,
  buildBookOrbitNativeBookEndpoint,
  bookOrbitBookId,
  normalizeBookOrbitEntry,
  normalizeBookOrbitProviderIds,
  mergeBookOrbitNativeDetail,
  prepareBookOrbitImportRows,
  fetchBookOrbitOpdsItems,
  fetchBookOrbitNativeBookDetail,
  enrichBookOrbitRowsWithNativeMetadata
};
