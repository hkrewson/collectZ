const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

const DEFAULT_TIMEOUT_MS = 20000;
const MAX_PAGES_DEFAULT = 20;

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeDate(raw) {
  const value = String(raw || '').trim();
  if (!value) return { year: null, release_date: null };
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { year: Number(iso[1]), release_date: `${iso[1]}-${iso[2]}-${iso[3]}` };
  const yearOnly = value.match(/\b(18|19|20)\d{2}\b/);
  if (!yearOnly) return { year: null, release_date: null };
  return { year: Number(yearOnly[0]), release_date: `${yearOnly[0]}-01-01` };
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function normalizeIsbn(raw) {
  const text = String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (text.length === 10 || text.length === 13) return text;
  const match = String(raw || '').match(/\b(?:97[89][\d-]{10,}|[\dXx-]{10,})\b/);
  if (!match) return '';
  return String(match[0]).replace(/[^0-9Xx]/g, '').toUpperCase();
}

function extractBestLink(entry) {
  const links = toArray(entry.link);
  const relScore = (link) => {
    const rel = String(link?.['@_rel'] || '').toLowerCase();
    if (rel.includes('acquisition')) return 4;
    if (rel === 'alternate') return 3;
    if (rel === 'http://opds-spec.org/image' || rel === 'http://opds-spec.org/image/thumbnail') return 1;
    return 0;
  };
  const sorted = links
    .filter((link) => String(link?.['@_href'] || '').trim())
    .sort((a, b) => relScore(b) - relScore(a));
  return sorted[0]?.['@_href'] || '';
}

function extractImageLink(entry) {
  const links = toArray(entry.link);
  const image = links.find((link) => String(link?.['@_rel'] || '').toLowerCase().includes('/image'));
  return String(image?.['@_href'] || '').trim();
}

function detectComicEntry(entry) {
  const categories = toArray(entry.category)
    .map((c) => String(c?.['@_term'] || c?.['@_label'] || c || '').toLowerCase())
    .filter(Boolean);
  const links = toArray(entry.link)
    .map((link) => `${String(link?.['@_type'] || '').toLowerCase()} ${String(link?.['@_href'] || '').toLowerCase()}`)
    .join(' ');
  const categoryHint = categories.some((c) => c.includes('comic') || c.includes('manga') || c.includes('graphic'));
  const linkHint = /(\.cbz|\.cbr|application\/x-cbr|application\/x-cbz|comic)/.test(links);
  return categoryHint || linkHint;
}

function normalizeOpdsEntry(entry = {}, baseUrl = '') {
  const title = firstString(entry.title, entry['dc:title']);
  if (!title) return null;

  const author = toArray(entry.author)
    .map((a) => firstString(a?.name, a))
    .filter(Boolean)
    .join(', ');

  const identifier = firstString(entry.identifier, entry['dc:identifier'], entry.id);
  const isbn = normalizeIsbn(identifier);
  const published = firstString(entry.published, entry.issued, entry.updated, entry['dc:date']);
  const normalizedDate = normalizeDate(published);
  const sourceUpdatedAt = firstString(entry.updated, entry.published, entry.issued, entry['dc:date']);
  const linkRaw = extractBestLink(entry);
  const imageRaw = extractImageLink(entry);

  const externalUrl = (() => {
    if (!linkRaw) return '';
    try {
      return new URL(linkRaw, baseUrl).toString();
    } catch (_) {
      return linkRaw;
    }
  })();

  const imageUrl = (() => {
    if (!imageRaw) return '';
    try {
      return new URL(imageRaw, baseUrl).toString();
    } catch (_) {
      return imageRaw;
    }
  })();

  const summary = firstString(entry.summary?.['#text'], entry.summary, entry.content?.['#text'], entry.content, entry.description);
  const publisher = firstString(entry.publisher, entry['dc:publisher']);
  const mediaType = detectComicEntry(entry) ? 'comic_book' : 'book';

  return {
    title,
    media_type: mediaType,
    year: normalizedDate.year || null,
    release_date: normalizedDate.release_date || null,
    format: 'Digital',
    overview: summary || null,
    tmdb_url: externalUrl || null,
    external_url: externalUrl || null,
    poster_path: imageUrl || null,
    type_details: {
      author: author || null,
      publisher: publisher || null,
      isbn: isbn || null,
      edition: null,
      provider_name: 'cwa_opds',
      provider_item_id: identifier || null,
      provider_external_url: externalUrl || null,
      calibre_entry_id: identifier || null,
      calibre_external_url: externalUrl || null,
      source_updated_at: sourceUpdatedAt || null
    }
  };
}

function extractNextLink(feed = {}, currentUrl = '') {
  const links = toArray(feed.link);
  const next = links.find((link) => String(link?.['@_rel'] || '').toLowerCase() === 'next');
  const href = String(next?.['@_href'] || '').trim();
  if (!href) return '';
  try {
    return new URL(href, currentUrl).toString();
  } catch (_) {
    return href;
  }
}

async function fetchCwaOpdsItems(config = {}, options = {}) {
  const startUrl = String(config.cwaOpdsUrl || '').trim();
  if (!startUrl) throw new Error('CWA OPDS URL is not configured');

  const timeoutMs = Math.max(1000, Number(config.cwaTimeoutMs || DEFAULT_TIMEOUT_MS));
  const maxPages = Math.max(1, Math.min(Number(options.maxPages || MAX_PAGES_DEFAULT), 100));

  const headers = {
    Accept: 'application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.1',
    'User-Agent': 'collectZ-cwa-opds/1.0'
  };

  const auth = {};
  const username = String(config.cwaUsername || '').trim();
  const password = String(config.cwaPassword || '').trim();
  if (username || password) {
    auth.username = username;
    auth.password = password;
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: true,
    trimValues: true
  });

  const rows = [];
  let pageUrl = startUrl;
  let page = 0;

  while (pageUrl && page < maxPages) {
    page += 1;
    const response = await axios.get(pageUrl, {
      timeout: timeoutMs,
      headers,
      ...(auth.username || auth.password ? { auth } : {}),
      responseType: 'text'
    });

    const parsed = parser.parse(response.data || '');
    const feed = parsed?.feed || parsed?.Feed || parsed || {};
    const entries = toArray(feed.entry);

    for (const entry of entries) {
      const normalized = normalizeOpdsEntry(entry, pageUrl);
      if (normalized) rows.push(normalized);
    }

    pageUrl = extractNextLink(feed, pageUrl);
  }

  return {
    rows,
    pagesFetched: page,
    endpoint: startUrl,
    hasMore: Boolean(pageUrl)
  };
}

module.exports = {
  fetchCwaOpdsItems
};
