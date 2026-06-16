'use strict';

const SDCC_BLOG_PROVIDER = 'sdcc_blog';
const SDCC_BLOG_EXCLUSIVES_URL = 'https://sdccblog.com/exclusives/';
const SDCC_BLOG_HOST = 'sdccblog.com';
const SDCC_BLOG_USER_AGENT = 'collectZ/SDCC-exclusives-intake (+https://github.com/hkrewson/collectz)';

function trimString(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value = '') {
  return trimString(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;|&mdash;/g, '-');
}

function stripTags(value = '') {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]*>/g, ' '));
}

function normalizeSourceUrl(value) {
  const raw = trimString(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw, SDCC_BLOG_EXCLUSIVES_URL);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (!parsed.hostname.endsWith(SDCC_BLOG_HOST)) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

function providerKeyForUrl(url) {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    return `${parsed.hostname}${parsed.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch (_) {
    return normalized.toLowerCase();
  }
}

function extractBooth(text = '') {
  const match = String(text || '').match(/\bbooth\s*#?\s*([A-Z0-9-]+)/i);
  return match ? `#${match[1].replace(/^#/, '')}` : null;
}

function cleanTitleForVendor(title = '') {
  return trimString(title)
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\bSan Diego Comic-Con\b/ig, '')
    .replace(/\bSDCC\b/ig, '')
    .replace(/\bComic-Con\b/ig, '')
    .replace(/\b20\d{2}\b/g, '')
    .replace(/\bExclusives?\b/ig, '')
    .replace(/\bUpdate\b.*$/ig, '')
    .replace(/[|:-]+$/g, '')
    .trim();
}

function inferVendor(title = '') {
  const cleaned = cleanTitleForVendor(title);
  if (!cleaned) return null;
  const split = cleaned.split(/\s+(?:at|from|by)\s+/i)[0];
  return trimString(split).slice(0, 255) || null;
}

function extractUpdatedAt(text = '') {
  const match = String(text || '').match(/\b(?:update|updated)\s+([A-Z][a-z]+)\s+(\d{1,2})\b/i);
  if (!match) return null;
  return `${match[1]} ${match[2]}`;
}

function uniqueByProviderKey(items = []) {
  const seen = new Set();
  const results = [];
  for (const item of items) {
    const key = item.provider_key || providerKeyForUrl(item.source_url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push({ ...item, provider_key: key });
  }
  return results;
}

function extractArticleCandidatesFromIndex(html = '') {
  const source = String(html || '');
  const candidates = [];
  const articleRegex = /<article\b[\s\S]*?<\/article>/gi;
  let articleMatch;
  while ((articleMatch = articleRegex.exec(source))) {
    const articleHtml = articleMatch[0];
    const titleLink = articleHtml.match(/<h[1-6][^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
      || articleHtml.match(/<a[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*bookmark[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)
      || articleHtml.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!titleLink) continue;
    const sourceUrl = normalizeSourceUrl(titleLink[1]);
    const title = stripTags(titleLink[2]);
    if (!sourceUrl || !title || !/exclusive/i.test(title)) continue;
    const articleText = stripTags(articleHtml);
    candidates.push({
      provider: SDCC_BLOG_PROVIDER,
      provider_key: providerKeyForUrl(sourceUrl),
      source_url: sourceUrl,
      source_title: title,
      source_updated_label: extractUpdatedAt(title) || extractUpdatedAt(articleText),
      vendor: inferVendor(title),
      booth: extractBooth(articleText),
      metadata: {
        source: 'index',
        attribution: 'SDCC Blog',
        discovered_from: SDCC_BLOG_EXCLUSIVES_URL
      }
    });
  }

  if (candidates.length > 0) return uniqueByProviderKey(candidates);

  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(source))) {
    const sourceUrl = normalizeSourceUrl(linkMatch[1]);
    const title = stripTags(linkMatch[2]);
    if (!sourceUrl || !title || !/exclusive/i.test(title)) continue;
    candidates.push({
      provider: SDCC_BLOG_PROVIDER,
      provider_key: providerKeyForUrl(sourceUrl),
      source_url: sourceUrl,
      source_title: title,
      source_updated_label: extractUpdatedAt(title),
      vendor: inferVendor(title),
      booth: null,
      metadata: {
        source: 'index-link',
        attribution: 'SDCC Blog',
        discovered_from: SDCC_BLOG_EXCLUSIVES_URL
      }
    });
  }
  return uniqueByProviderKey(candidates);
}

function extractArticleMetadata(html = '', sourceUrl = '') {
  const source = String(html || '');
  const ogTitle = source.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || source.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const h1 = source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const titleTag = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const sourceTitle = stripTags(ogTitle?.[1] || h1?.[1] || titleTag?.[1] || sourceUrl);
  const text = stripTags(source);
  return {
    provider: SDCC_BLOG_PROVIDER,
    provider_key: providerKeyForUrl(sourceUrl),
    source_url: normalizeSourceUrl(sourceUrl),
    source_title: sourceTitle,
    source_updated_label: extractUpdatedAt(sourceTitle) || extractUpdatedAt(text),
    vendor: inferVendor(sourceTitle),
    booth: extractBooth(text),
    metadata: {
      source: 'url',
      attribution: 'SDCC Blog'
    }
  };
}

async function fetchSdccBlogText(url, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== 'function') {
    const error = new Error('Fetch is not available in this runtime.');
    error.code = 'fetch_unavailable';
    throw error;
  }
  const response = await fetchImpl(url, {
    headers: {
      'accept': 'text/html,application/xhtml+xml',
      'user-agent': SDCC_BLOG_USER_AGENT
    }
  });
  if (!response.ok) {
    const error = new Error(`SDCC Blog returned HTTP ${response.status}.`);
    error.code = 'source_fetch_failed';
    error.status = response.status;
    throw error;
  }
  return response.text();
}

async function fetchSdccBlogIndex(fetchImpl = global.fetch) {
  const html = await fetchSdccBlogText(SDCC_BLOG_EXCLUSIVES_URL, fetchImpl);
  return extractArticleCandidatesFromIndex(html);
}

async function fetchSdccBlogArticle(url, fetchImpl = global.fetch) {
  const normalizedUrl = normalizeSourceUrl(url);
  if (!normalizedUrl) {
    const error = new Error('Only SDCC Blog article URLs are supported.');
    error.code = 'invalid_source_url';
    error.status = 400;
    throw error;
  }
  const html = await fetchSdccBlogText(normalizedUrl, fetchImpl);
  return extractArticleMetadata(html, normalizedUrl);
}

module.exports = {
  SDCC_BLOG_PROVIDER,
  SDCC_BLOG_EXCLUSIVES_URL,
  SDCC_BLOG_HOST,
  extractArticleCandidatesFromIndex,
  extractArticleMetadata,
  fetchSdccBlogArticle,
  fetchSdccBlogIndex,
  inferVendor,
  normalizeSourceUrl,
  providerKeyForUrl
};
