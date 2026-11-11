'use strict';

const { fetchOpdsCatalog, normalizeOpdsPublication } = require('./opdsTransport');
const { parseHttpUrl } = require('./outboundUrlPolicy');

const BOOKORBIT_ENTRY_ID = /^urn:bookorbit:book:\d+$/i;

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
  return {
    title: publication.title,
    media_type: publication.isComic ? 'comic_book' : 'book',
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
    }
  };
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
  return fetchOpdsCatalog({
    endpointUrl: config.endpointUrl,
    username: config.username,
    password: config.password,
    timeoutMs: config.timeoutMs,
    userAgent: 'collectZ-bookorbit-opds/1.0',
    normalizeEntry: normalizeBookOrbitEntry
  }, options);
}

module.exports = {
  BOOKORBIT_ENTRY_ID,
  buildBookOrbitEndpoint,
  normalizeBookOrbitEntry,
  fetchBookOrbitOpdsItems
};
