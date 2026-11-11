'use strict';

const { fetchOpdsCatalog, normalizeOpdsPublication } = require('./opdsTransport');

function normalizeDate(raw) {
  const value = String(raw || '').trim();
  if (!value) return { year: null, release_date: null };
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { year: Number(iso[1]), release_date: `${iso[1]}-${iso[2]}-${iso[3]}` };
  const yearOnly = value.match(/\b(18|19|20)\d{2}\b/);
  if (!yearOnly) return { year: null, release_date: null };
  return { year: Number(yearOnly[0]), release_date: `${yearOnly[0]}-01-01` };
}

function parseComicTitleMetadata(rawTitle = '') {
  const title = String(rawTitle || '').trim();
  if (!title) return { series: null, issue_number: null, volume: null };

  const hashMatch = title.match(/^(.+?)\s+#\s*([A-Za-z0-9.-]+)(?:\s*(?::|-|–)\s*.*)?$/);
  if (hashMatch) {
    return {
      series: String(hashMatch[1] || '').trim() || null,
      issue_number: String(hashMatch[2] || '').trim() || null,
      volume: null
    };
  }

  const volIssueMatch = title.match(/^(.+?)\s+v(?:ol(?:ume)?)?\s*([0-9]+)\s+([A-Za-z0-9.-]+)(?:\s*:.*)?$/i);
  if (volIssueMatch) {
    return {
      series: String(volIssueMatch[1] || '').trim() || null,
      volume: String(volIssueMatch[2] || '').trim() || null,
      issue_number: String(volIssueMatch[3] || '').trim() || null
    };
  }

  return { series: null, issue_number: null, volume: null };
}

function normalizeOpdsEntry(entry = {}, baseUrl = '') {
  const publication = normalizeOpdsPublication(entry, baseUrl, { fallbackBrowseToAcquisition: true });
  if (!publication) return null;
  const identifier = publication.identifiers[0] || publication.entryId;
  const normalizedDate = normalizeDate(publication.publishedAt || publication.updatedAt);
  const parsedComic = publication.isComic
    ? parseComicTitleMetadata(publication.title)
    : { series: null, issue_number: null, volume: null };

  return {
    title: publication.title,
    media_type: publication.isComic ? 'comic_book' : 'book',
    year: normalizedDate.year,
    release_date: normalizedDate.release_date,
    format: 'Digital',
    overview: publication.summary || null,
    tmdb_url: null,
    external_url: publication.browseUrl || publication.downloadUrl || null,
    poster_path: publication.coverUrl || null,
    type_details: {
      author: publication.authors.join(', ') || null,
      publisher: publication.publisher || null,
      isbn: publication.isbn || null,
      edition: null,
      series: parsedComic.series,
      issue_number: parsedComic.issue_number,
      volume: parsedComic.volume,
      provider_name: 'cwa_opds',
      provider_item_id: identifier || null,
      provider_external_url: publication.browseUrl || null,
      provider_download_url: publication.downloadUrl || null,
      calibre_entry_id: identifier || null,
      calibre_external_url: publication.browseUrl || null,
      calibre_download_url: publication.downloadUrl || null,
      source_updated_at: publication.updatedAt || publication.publishedAt || null
    }
  };
}

async function fetchCwaOpdsItems(config = {}, options = {}) {
  const startUrl = String(config.cwaOpdsUrl || '').trim();
  if (!startUrl) throw new Error('CWA OPDS URL is not configured');
  return fetchOpdsCatalog({
    endpointUrl: startUrl,
    username: config.cwaUsername,
    password: config.cwaPassword,
    timeoutMs: config.cwaTimeoutMs,
    userAgent: 'collectZ-cwa-opds/1.0',
    normalizeEntry: normalizeOpdsEntry
  }, options);
}

module.exports = {
  fetchCwaOpdsItems,
  parseComicTitleMetadata,
  normalizeOpdsEntry
};
