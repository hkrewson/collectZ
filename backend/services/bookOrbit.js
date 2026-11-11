'use strict';

const { fetchOpdsCatalog, normalizeOpdsPublication } = require('./opdsTransport');
const { parseHttpUrl } = require('./outboundUrlPolicy');

const BOOKORBIT_ENTRY_ID = /^urn:bookorbit:book:\d+$/i;
const BOOKORBIT_ALL_BOOKS_ID = 'urn:bookorbit:all';

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
  buildBookOrbitEndpoint,
  normalizeBookOrbitEntry,
  prepareBookOrbitImportRows,
  fetchBookOrbitOpdsItems
};
