'use strict';

const axios = require('axios');
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { parseHttpUrl } = require('./outboundUrlPolicy');

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_PAGES = 20;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const COMIC_MIME_TYPES = new Set([
  'application/x-cbz',
  'application/x-cbr',
  'application/vnd.comicbook+zip',
  'application/vnd.comicbook-rar'
]);

function opdsError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) {
    error.diagnostics = Object.freeze({
      causeCode: String(cause?.code || '').slice(0, 80) || null,
      status: Number(cause?.response?.status || 0) || null
    });
  }
  return error;
}

function toArray(value) {
  if (value === null || value === undefined || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return String(value['#text'] ?? '').trim();
  return String(value).trim();
}

function firstText(...values) {
  for (const value of values) {
    const text = textValue(value);
    if (text) return text;
  }
  return '';
}

function safeHttpUrl(rawUrl, baseUrl = '', expectedOrigin = '') {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim(), baseUrl || undefined);
  } catch {
    throw opdsError('OPDS_UNSAFE_URL', 'OPDS feed contains an invalid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw opdsError('OPDS_UNSAFE_URL', 'OPDS feed URL must use HTTP without embedded credentials');
  }
  parsed.hash = '';
  if (expectedOrigin && parsed.origin !== expectedOrigin) {
    throw opdsError('OPDS_UNSAFE_URL', 'OPDS feed traversal cannot leave the configured provider origin');
  }
  return parsed.toString();
}

function linkRecords(entry = {}) {
  return toArray(entry.link)
    .map((link) => ({
      rel: String(link?.['@_rel'] || '').trim().toLowerCase(),
      type: String(link?.['@_type'] || '').trim().toLowerCase(),
      href: String(link?.['@_href'] || '').trim(),
      title: String(link?.['@_title'] || '').trim()
    }))
    .filter((link) => link.href);
}

function isAcquisitionLink(link) {
  return link.rel.includes('acquisition') || /application\/(?:epub\+zip|pdf|x-cbz|x-cbr|vnd\.comicbook\+zip|vnd\.comicbook-rar|zip|octet-stream)/.test(link.type);
}

function hasAcquisitionLink(entry = {}) {
  return linkRecords(entry).some(isAcquisitionLink);
}

function navigationLinks(entry = {}) {
  return linkRecords(entry).filter((link) => {
    const catalogType = link.type.includes('application/atom+xml') || link.type.includes('application/opds+json');
    return link.rel.includes('subsection') || link.rel.includes('collection') || catalogType;
  });
}

function normalizeIsbn(rawValues = []) {
  for (const raw of rawValues) {
    const candidate = String(raw || '').replace(/^urn:isbn:/i, '');
    const compact = candidate.replace(/[^0-9Xx]/g, '').toUpperCase();
    if (compact.length === 10 || compact.length === 13) return compact;
  }
  return '';
}

function seriesRecord(links, baseUrl) {
  const link = links.find((candidate) => candidate.rel.includes('sort/series'));
  if (!link) return { name: null, index: null, url: null };
  const title = String(link.title || '').trim();
  const match = title.match(/^(.*?)\s+#\s*([0-9]+(?:\.[0-9]+)?)$/);
  return {
    name: (match ? match[1] : title) || null,
    index: match ? match[2] : null,
    url: safeHttpUrl(link.href, baseUrl) || null
  };
}

function normalizeOpdsPublication(entry = {}, baseUrl = '', { fallbackBrowseToAcquisition = false } = {}) {
  const title = firstText(entry.title);
  if (!title) return null;
  const links = linkRecords(entry);
  const acquisition = links.find(isAcquisitionLink) || null;
  const alternate = links.find((link) => link.rel === 'alternate' && !isAcquisitionLink(link)) || null;
  const image = links.find((link) => link.rel === 'http://opds-spec.org/image')
    || links.find((link) => link.rel.includes('/image'))
    || null;
  const identifiers = toArray(entry.identifier ?? entry['dc:identifier'])
    .map(textValue)
    .filter(Boolean);
  const categories = toArray(entry.category)
    .map((category) => String(category?.['@_term'] || category?.['@_label'] || textValue(category)).trim())
    .filter(Boolean);
  const acquisitionType = String(acquisition?.type || '').toLowerCase();
  const acquisitionHref = String(acquisition?.href || '').toLowerCase();
  const isComic = COMIC_MIME_TYPES.has(acquisitionType)
    || /\.(?:cbz|cbr)(?:$|[?#])/.test(acquisitionHref)
    || categories.some((category) => /comic|manga|graphic/i.test(category));
  const authors = toArray(entry.author)
    .map((author) => firstText(author?.name, author))
    .filter(Boolean);
  const browseSource = alternate || (fallbackBrowseToAcquisition ? acquisition : null);
  return Object.freeze({
    entryId: firstText(entry.id),
    identifiers: Object.freeze(identifiers),
    isbn: normalizeIsbn(identifiers),
    title,
    authors: Object.freeze(authors),
    summary: firstText(entry.summary, entry.content, entry.description),
    publisher: firstText(entry.publisher, entry['dc:publisher']),
    language: firstText(entry.language, entry['dc:language']),
    publishedAt: firstText(entry.published, entry.issued, entry.date, entry['dc:date']),
    updatedAt: firstText(entry.updated),
    browseUrl: browseSource ? safeHttpUrl(browseSource.href, baseUrl) : null,
    downloadUrl: acquisition ? safeHttpUrl(acquisition.href, baseUrl) : null,
    coverUrl: image ? safeHttpUrl(image.href, baseUrl) : null,
    acquisitionType: acquisitionType || null,
    isComic,
    series: Object.freeze(seriesRecord(links, baseUrl))
  });
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  const parsed = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
  return parsed;
}

function parseFeed(xml) {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw opdsError('OPDS_MALFORMED_FEED', 'OPDS response is not valid XML');
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: true,
    trimValues: true
  });
  let parsed;
  try {
    parsed = parser.parse(xml);
  } catch (error) {
    throw opdsError('OPDS_MALFORMED_FEED', 'OPDS response is not valid XML', error);
  }
  const feed = parsed?.feed || parsed?.Feed;
  if (!feed || typeof feed !== 'object') {
    throw opdsError('OPDS_MALFORMED_FEED', 'OPDS response does not contain an Atom feed');
  }
  return feed;
}

async function fetchOpdsCatalog(config = {}, options = {}) {
  const endpoint = parseHttpUrl(config.endpointUrl);
  if (!endpoint) throw opdsError('OPDS_ENDPOINT_INVALID', 'OPDS endpoint must be an HTTP URL without credentials');
  const normalizeEntry = config.normalizeEntry;
  if (typeof normalizeEntry !== 'function') throw new TypeError('OPDS transport requires an entry normalizer');
  const selectNavigationLinks = typeof config.selectNavigationLinks === 'function'
    ? config.selectNavigationLinks
    : ({ navigationEntries }) => navigationEntries.flatMap(({ links }) => links);
  const timeoutMs = boundedInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 120000, 'OPDS timeout');
  const maxPages = boundedInteger(options.maxPages, DEFAULT_MAX_PAGES, 1, 100, 'OPDS page limit');
  const maxResponseBytes = boundedInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 1024, 16 * 1024 * 1024, 'OPDS response limit');
  const maxTotalBytes = boundedInteger(
    options.maxTotalBytes,
    Math.max(DEFAULT_MAX_TOTAL_BYTES, maxResponseBytes),
    maxResponseBytes,
    64 * 1024 * 1024,
    'OPDS traversal limit'
  );
  const httpClient = options.httpClient || axios;
  const username = String(config.username || '').trim();
  const password = String(config.password || '');
  const auth = username || password ? { username, password } : null;
  const origin = endpoint.origin;
  const startUrl = endpoint.toString();
  const queue = [{ url: startUrl, ancestors: [] }];
  const pending = new Set([startUrl]);
  const visited = new Set();
  const seenEntryIds = new Set();
  const rows = [];
  let pagesFetched = 0;
  let totalBytes = 0;
  let subsectionDiscovered = 0;
  let navigationEntriesSkipped = 0;

  const enqueue = (href, page) => {
    const url = safeHttpUrl(href, page.url, origin);
    if (page.ancestors.includes(url) || url === page.url) {
      throw opdsError('OPDS_PAGINATION_CYCLE', 'OPDS feed traversal contains a cycle');
    }
    if (visited.has(url) || pending.has(url)) return;
    pending.add(url);
    queue.push({ url, ancestors: [...page.ancestors, page.url] });
  };

  while (queue.length > 0) {
    if (pagesFetched >= maxPages) {
      throw opdsError('OPDS_PAGE_LIMIT_EXCEEDED', 'OPDS feed exceeded the configured page limit');
    }
    const page = queue.shift();
    pending.delete(page.url);
    visited.add(page.url);
    let response;
    try {
      response = await httpClient.get(page.url, {
        timeout: timeoutMs,
        headers: {
          Accept: 'application/atom+xml,application/xml,text/xml;q=0.9',
          'User-Agent': String(config.userAgent || 'collectZ-opds/1.0')
        },
        ...(auth ? { auth } : {}),
        responseType: 'text',
        maxContentLength: maxResponseBytes,
        maxBodyLength: maxResponseBytes,
        maxRedirects: 0,
        transitional: { clarifyTimeoutError: true }
      });
    } catch (error) {
      if (error?.code === 'ETIMEDOUT' || error?.code === 'ECONNABORTED') {
        throw opdsError('OPDS_REQUEST_TIMEOUT', 'OPDS provider did not respond before the configured timeout', error);
      }
      if (Number(error?.response?.status) === 401 || Number(error?.response?.status) === 403) {
        throw opdsError('OPDS_AUTHENTICATION_FAILED', 'OPDS provider rejected the configured credentials', error);
      }
      if (Number(error?.response?.status) >= 300 && Number(error?.response?.status) < 400) {
        throw opdsError('OPDS_REDIRECT_REJECTED', 'OPDS endpoint must be configured with its final URL', error);
      }
      if (error?.code === 'ERR_BAD_RESPONSE' || error?.code === 'ERR_FR_MAX_BODY_LENGTH_EXCEEDED') {
        throw opdsError('OPDS_RESPONSE_TOO_LARGE', 'OPDS response exceeded the configured size limit', error);
      }
      throw opdsError('OPDS_REQUEST_FAILED', 'OPDS provider request failed', error);
    }
    const contentType = String(response?.headers?.['content-type'] || '').toLowerCase();
    if (contentType && !/(?:atom|opds|xml)/.test(contentType)) {
      throw opdsError('OPDS_RESPONSE_TYPE_INVALID', 'OPDS provider returned a non-XML response');
    }
    const body = typeof response?.data === 'string' ? response.data : String(response?.data || '');
    const bodyBytes = Buffer.byteLength(body, 'utf8');
    if (bodyBytes > maxResponseBytes) throw opdsError('OPDS_RESPONSE_TOO_LARGE', 'OPDS response exceeded the configured size limit');
    totalBytes += bodyBytes;
    if (totalBytes > maxTotalBytes) throw opdsError('OPDS_TRAVERSAL_TOO_LARGE', 'OPDS traversal exceeded the configured total size limit');
    const feed = parseFeed(body);
    pagesFetched += 1;

    const navigationEntries = [];
    for (const entry of toArray(feed.entry)) {
      if (hasAcquisitionLink(entry)) {
        const normalized = normalizeEntry(entry, page.url);
        if (!normalized) continue;
        const entryId = String(normalized?.type_details?.provider_item_id || '').trim();
        if (!entryId) throw opdsError('OPDS_ENTRY_ID_MISSING', 'OPDS publication entry is missing its provider identity');
        if (seenEntryIds.has(entryId)) continue;
        seenEntryIds.add(entryId);
        rows.push(Object.freeze(normalized));
      } else {
        navigationEntriesSkipped += 1;
        const links = navigationLinks(entry);
        subsectionDiscovered += links.length;
        navigationEntries.push(Object.freeze({ entry, links: Object.freeze(links) }));
      }
    }
    const selectedNavigationLinks = selectNavigationLinks(Object.freeze({
      navigationEntries: Object.freeze(navigationEntries),
      pageUrl: page.url,
      startUrl
    }));
    if (!Array.isArray(selectedNavigationLinks)) {
      throw new TypeError('OPDS navigation selector must return an array');
    }
    for (const link of selectedNavigationLinks) enqueue(link.href, page);
    const next = linkRecords(feed).find((link) => link.rel === 'next');
    if (next) enqueue(next.href, page);
  }

  return Object.freeze({
    rows: Object.freeze(rows),
    pagesFetched,
    endpoint: startUrl,
    hasMore: false,
    subsectionDiscovered,
    navigationEntriesSkipped,
    totalBytes
  });
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_MAX_TOTAL_BYTES,
  COMIC_MIME_TYPES,
  normalizeOpdsPublication,
  fetchOpdsCatalog
};
