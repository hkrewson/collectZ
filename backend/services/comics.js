const axios = require('axios');

const COMICS_PRESETS = {
  metron: {
    preset: 'metron',
    provider: 'metron',
    apiUrl: 'https://metron.cloud/api/issue/',
    apiKeyHeader: '',
    apiKeyQueryParam: ''
  },
  gcd: {
    preset: 'gcd',
    provider: 'gcd',
    apiUrl: 'https://www.comics.org/api/series/name/',
    apiKeyHeader: '',
    apiKeyQueryParam: ''
  },
  comicvine: {
    preset: 'comicvine',
    provider: 'comicvine',
    apiUrl: 'https://comicvine.gamespot.com/api/search/',
    apiKeyHeader: '',
    apiKeyQueryParam: 'api_key'
  },
  custom: {
    preset: 'custom',
    provider: 'custom',
    apiUrl: '',
    apiKeyHeader: '',
    apiKeyQueryParam: 'api_key'
  }
};

function resolveComicsPreset(preset) {
  const key = String(preset || 'metron').trim().toLowerCase();
  return COMICS_PRESETS[key] || COMICS_PRESETS.metron;
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function buildMetronAuth(config = {}) {
  const password = String(config.comicsApiKey || '').trim();
  if (!password) return null;
  return {
    username: String(config.comicsUsername || process.env.COMICS_USERNAME || '').trim(),
    password
  };
}

function buildMetronCandidateUrls(apiUrl, candidates = []) {
  const base = stripTrailingSlash(apiUrl);
  const roots = [];
  if (base) roots.push(base);
  if (base.includes('/api/issue')) {
    roots.push(base.replace(/\/api\/issue.*$/i, '/api'));
  } else if (base.includes('/api')) {
    roots.push(base.replace(/\/api.*$/i, '/api'));
  }
  const uniqueRoots = [...new Set(roots.filter(Boolean))];
  const urls = [];
  for (const root of uniqueRoots) {
    for (const suffix of candidates) {
      urls.push(`${stripTrailingSlash(root)}${suffix}`);
    }
  }
  return [...new Set(urls)];
}

function buildMetronApiRoot(apiUrl) {
  const base = stripTrailingSlash(apiUrl);
  if (!base) return '';
  if (base.includes('/api/issue')) return base.replace(/\/api\/issue.*$/i, '/api');
  if (base.includes('/api')) return base.replace(/\/api.*$/i, '/api');
  return base;
}

function toYear(value) {
  const match = String(value || '').match(/\b(18|19|20)\d{2}\b/);
  if (!match) return null;
  const year = Number(match[0]);
  return Number.isFinite(year) ? year : null;
}

function toDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  const year = toYear(raw);
  return year ? `${year}-01-01` : null;
}

function mapMetronIssue(issue = {}) {
  const seriesName = issue?.series?.name || issue?.series_name || '';
  const issueNumber = issue?.number || issue?.issue_number || '';
  const issueName = issue?.name || issue?.issue_name || '';
  const titleBase = seriesName || issue?.title || '';
  const title = issueNumber
    ? `${titleBase} #${issueNumber}${issueName ? `: ${issueName}` : ''}`.trim()
    : (issueName || titleBase);
  const coverDate = toDate(issue?.cover_date || issue?.date || issue?.published);

  return {
    id: String(issue?.id || ''),
    title: title || issueName || seriesName || '',
    year: toYear(coverDate || issue?.cover_date || issue?.date || issue?.published),
    release_date: coverDate,
    overview: issue?.desc || issue?.description || null,
    genre: null,
    external_url: issue?.resource_url || (issue?.id ? `https://metron.cloud/issue/${issue.id}` : null),
    poster_path: issue?.image || issue?.cover_image || issue?.cover?.url || null,
    type_details: {
      author: issue?.writer || null,
      publisher: issue?.publisher?.name || issue?.publisher || null,
      edition: issueNumber ? `Issue ${issueNumber}` : null,
      series: seriesName || null,
      issue_number: issueNumber ? String(issueNumber) : null,
      volume: issue?.series?.volume || issue?.volume || null,
      writer: issue?.writer || null,
      artist: issue?.artist || null,
      inker: issue?.inker || null,
      colorist: issue?.colorist || null,
      cover_date: coverDate,
      provider_issue_id: issue?.id ? String(issue.id) : null
    }
  };
}

function mapMetronCollectionEntry(entry = {}) {
  const issue = entry?.issue || {};
  const mapped = mapMetronIssue(issue);
  return {
    ...mapped,
    type_details: {
      ...(mapped.type_details || {}),
      metron_collection_id: entry?.id ? String(entry.id) : null,
      metron_quantity: Number.isFinite(Number(entry?.quantity)) ? Number(entry.quantity) : null,
      metron_book_format: entry?.book_format || null,
      metron_grade: entry?.grade || null,
      metron_grading_company: entry?.grading_company || null,
      metron_is_read: entry?.is_read === true
    }
  };
}

function pickCreditNames(credits = [], matcher) {
  if (!Array.isArray(credits)) return null;
  const names = credits
    .filter((c) => matcher(String(c?.role || c?.position || '').toLowerCase()))
    .map((c) => String(c?.creator?.name || c?.name || '').trim())
    .filter(Boolean);
  if (!names.length) return null;
  return [...new Set(names)].join(', ');
}

function mapMetronIssueDetail(issue = {}) {
  const base = mapMetronIssue(issue);
  const credits = Array.isArray(issue?.credits) ? issue.credits : [];
  const series = issue?.series || {};
  const issueName = Array.isArray(issue?.name) ? issue.name.filter(Boolean).join(' / ') : String(issue?.name || '').trim();
  const titleBase = String(series?.name || issue?.title || base.title || '').trim();
  const number = String(issue?.number || '').trim();
  const detailTitle = number
    ? `${titleBase} #${number}${issueName ? `: ${issueName}` : ''}`.trim()
    : (issueName || titleBase || base.title);
  return {
    ...base,
    title: detailTitle || base.title,
    overview: issue?.desc || base.overview || null,
    poster_path: issue?.image || base.poster_path || null,
    type_details: {
      ...(base.type_details || {}),
      author: pickCreditNames(credits, (role) => role.includes('writer') || role === 'plotter') || base.type_details?.author || null,
      publisher: issue?.publisher?.name || base.type_details?.publisher || null,
      writer: pickCreditNames(credits, (role) => role.includes('writer') || role === 'plotter') || base.type_details?.writer || null,
      artist: pickCreditNames(credits, (role) => role.includes('artist') || role.includes('penc')) || base.type_details?.artist || null,
      inker: pickCreditNames(credits, (role) => role.includes('inker')) || base.type_details?.inker || null,
      colorist: pickCreditNames(credits, (role) => role.includes('color')) || base.type_details?.colorist || null,
      isbn: issue?.isbn || base.type_details?.isbn || null
    },
    upc: issue?.upc || null
  };
}

function collectArrayPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.objects)) return payload.objects;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function mapGcdSeries(series = {}) {
  const title = String(series?.name || series?.title || '').trim();
  const startYear = toYear(series?.year_began || series?.first_issue_date || series?.start_year);
  const publisher = series?.publisher?.name || series?.publisher || null;
  const externalUrl = series?.resource_uri
    ? `https://www.comics.org${series.resource_uri}`
    : (series?.url || null);

  return {
    id: String(series?.id || series?.series_id || ''),
    title,
    year: startYear,
    release_date: startYear ? `${startYear}-01-01` : null,
    overview: series?.notes || series?.description || null,
    genre: null,
    external_url: externalUrl,
    poster_path: null,
    type_details: {
      author: null,
      publisher,
      edition: null,
      series: title || null,
      issue_number: null,
      volume: series?.volume || null,
      writer: null,
      artist: null,
      inker: null,
      colorist: null,
      cover_date: null
    }
  };
}

function mapComicVineIssue(issue = {}) {
  const volumeName = issue?.volume?.name || '';
  const issueNumber = issue?.issue_number || '';
  const issueName = issue?.name || '';
  const title = issueName
    ? `${volumeName} #${issueNumber}: ${issueName}`.trim()
    : `${volumeName} #${issueNumber}`.trim();
  const coverDate = toDate(issue?.cover_date);
  const image = issue?.image || {};

  return {
    id: String(issue?.id || ''),
    title: title || volumeName || issueName || '',
    year: toYear(coverDate || issue?.date_added),
    release_date: coverDate,
    overview: issue?.deck || issue?.description || null,
    genre: null,
    external_url: issue?.site_detail_url || null,
    poster_path: image?.original_url || image?.super_url || image?.medium_url || image?.small_url || null,
    type_details: {
      author: null,
      publisher: issue?.publisher?.name || null,
      edition: issueNumber ? `Issue ${issueNumber}` : null,
      series: volumeName || null,
      issue_number: issueNumber ? String(issueNumber) : null,
      volume: issue?.volume?.name || null,
      writer: null,
      artist: null,
      inker: null,
      colorist: null,
      cover_date: coverDate
    }
  };
}

async function searchComicsByTitle(title, config = {}, limit = 10) {
  const query = String(title || '').trim();
  if (!query) return [];

  const provider = String(config.comicsProvider || 'metron').trim().toLowerCase();
  const apiUrl = config.comicsApiUrl || resolveComicsPreset(provider).apiUrl;
  if (!apiUrl) throw new Error('Comics API URL is not configured');

  if (provider === 'metron') {
    const auth = config.comicsApiKey
      ? {
          username: String(config.comicsUsername || process.env.COMICS_USERNAME || '').trim(),
          password: String(config.comicsApiKey).trim()
        }
      : undefined;
    const response = await axios.get(apiUrl, {
      params: { series_name: query, limit: Math.max(1, Math.min(Number(limit) || 10, 20)) },
      auth: auth?.password ? auth : undefined,
      timeout: 20000,
      validateStatus: () => true
    });
    if (response.status >= 400) {
      const detail = response.data?.detail || response.data?.message || `Provider returned status ${response.status}`;
      const err = new Error(detail);
      err.status = response.status;
      throw err;
    }
    return collectArrayPayload(response.data).map(mapMetronIssue).filter((item) => item.title);
  }

  if (provider === 'gcd') {
    const url = `${apiUrl.replace(/\/+$/, '')}/${encodeURIComponent(query)}/`;
    const response = await axios.get(url, {
      timeout: 20000,
      validateStatus: () => true
    });
    if (response.status >= 400) {
      const detail = response.data?.detail || response.data?.message || `Provider returned status ${response.status}`;
      const err = new Error(detail);
      err.status = response.status;
      throw err;
    }
    return collectArrayPayload(response.data).slice(0, limit).map(mapGcdSeries).filter((item) => item.title);
  }

  if (provider === 'comicvine') {
    if (!config.comicsApiKey) throw new Error('ComicVine API key is required');
    const response = await axios.get(apiUrl, {
      params: {
        format: 'json',
        resources: 'issue',
        query,
        limit: Math.max(1, Math.min(Number(limit) || 10, 20)),
        [config.comicsApiKeyQueryParam || 'api_key']: config.comicsApiKey
      },
      headers: {
        'User-Agent': process.env.COMICVINE_USER_AGENT || 'CollectZ/2.0 (+https://collect.krewson.org)'
      },
      timeout: 20000,
      validateStatus: () => true
    });
    if (response.status >= 400 || Number(response.data?.status_code) >= 400) {
      const detail = response.data?.error || response.data?.message || `Provider returned status ${response.status}`;
      const err = new Error(detail);
      err.status = response.status;
      throw err;
    }
    const rows = Array.isArray(response.data?.results) ? response.data.results : [];
    return rows.map(mapComicVineIssue).filter((item) => item.title);
  }

  const headers = {};
  if (config.comicsApiKey && config.comicsApiKeyHeader) {
    headers[config.comicsApiKeyHeader] = config.comicsApiKey;
  }
  const params = {
    q: query,
    limit: Math.max(1, Math.min(Number(limit) || 10, 20))
  };
  if (config.comicsApiKey && !config.comicsApiKeyHeader) {
    params[config.comicsApiKeyQueryParam || 'api_key'] = config.comicsApiKey;
  }
  const response = await axios.get(apiUrl, {
    params,
    headers,
    timeout: 20000,
    validateStatus: () => true
  });
  if (response.status >= 400) {
    const detail = response.data?.message || `Provider returned status ${response.status}`;
    const err = new Error(detail);
    err.status = response.status;
    throw err;
  }
  return collectArrayPayload(response.data)
    .slice(0, limit)
    .map((row) => ({
      id: String(row.id || ''),
      title: row.title || row.name || '',
      year: toYear(row.year || row.release_date),
      release_date: toDate(row.release_date),
      overview: row.overview || row.description || null,
      genre: row.genre || null,
      external_url: row.url || null,
      poster_path: row.poster_path || row.cover || null,
      type_details: {
        author: row.author || null,
        publisher: row.publisher || null,
        edition: row.edition || null,
        series: row.series || null,
        issue_number: row.issue_number || null,
        volume: row.volume || null,
        writer: row.writer || null,
        artist: row.artist || null,
        inker: row.inker || null,
        colorist: row.colorist || null,
        cover_date: toDate(row.cover_date)
      }
    }))
    .filter((item) => item.title);
}

async function fetchMetronCollectionIssues(config = {}, options = {}) {
  const apiUrl = config.comicsApiUrl || resolveComicsPreset('metron').apiUrl;
  if (!apiUrl) throw new Error('Comics API URL is not configured');
  const auth = buildMetronAuth(config);
  if (!auth?.password) throw new Error('Metron password/token is not configured');

  const limit = Math.max(1, Math.min(Number(options.limit) || 500, 5000));
  const maxPages = Math.max(1, Math.min(Number(options.maxPages) || 100, 500));
  const candidateUrls = buildMetronCandidateUrls(apiUrl, [
    '/collection/',
    '/collection/issue/',
    '/collection/issues/',
  ]);
  let lastError = null;
  for (const url of candidateUrls) {
    try {
      const collected = [];
      let pageUrl = url;
      let page = 0;

      while (pageUrl && page < maxPages && collected.length < limit) {
        page += 1;
        const response = await axios.get(pageUrl, {
          auth,
          params: pageUrl === url ? { limit: Math.min(limit, 500) } : undefined,
          timeout: 25000,
          validateStatus: () => true
        });
        if (response.status === 404 || response.status === 405) {
          if (page === 1) {
            pageUrl = null;
            break;
          }
          const detail = response.data?.detail || response.data?.message || `Provider returned status ${response.status}`;
          const err = new Error(detail);
          err.status = response.status;
          throw err;
        }
        if (response.status >= 400) {
          const detail = response.data?.detail || response.data?.message || `Provider returned status ${response.status}`;
          const err = new Error(detail);
          err.status = response.status;
          throw err;
        }

        const pageRows = collectArrayPayload(response.data).map((row) => {
          if (row && typeof row === 'object' && row.issue && typeof row.issue === 'object') {
            return mapMetronCollectionEntry(row);
          }
          return mapMetronIssue(row);
        }).filter((item) => item.title);

        collected.push(...pageRows);
        pageUrl = typeof response.data?.next === 'string' && response.data.next.trim()
          ? String(response.data.next).trim()
          : null;
      }

      const rows = collected.slice(0, limit);
      if (rows.length > 0) {
        return { issues: rows, endpoint: url };
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  throw new Error('Unable to locate a Metron collection endpoint');
}

async function fetchMetronIssueDetails(config = {}, issueId) {
  const normalizedIssueId = String(issueId || '').trim();
  if (!normalizedIssueId) throw new Error('Metron issue id is required');
  const apiRoot = buildMetronApiRoot(config.comicsApiUrl || resolveComicsPreset('metron').apiUrl);
  if (!apiRoot) throw new Error('Comics API URL is not configured');
  const auth = buildMetronAuth(config);
  if (!auth?.password) throw new Error('Metron password/token is not configured');
  const detailUrl = `${stripTrailingSlash(apiRoot)}/issue/${encodeURIComponent(normalizedIssueId)}/`;
  const response = await axios.get(detailUrl, {
    auth,
    timeout: 25000,
    validateStatus: () => true
  });
  if (response.status >= 400) {
    const detail = response.data?.detail || response.data?.message || `Provider returned status ${response.status}`;
    const err = new Error(detail);
    err.status = response.status;
    throw err;
  }
  return mapMetronIssueDetail(response.data || {});
}

async function pushMetronCollectionIssue(config = {}, issueId) {
  const normalizedIssueId = String(issueId || '').trim();
  if (!normalizedIssueId) throw new Error('Metron issue id is required');
  const apiUrl = config.comicsApiUrl || resolveComicsPreset('metron').apiUrl;
  if (!apiUrl) throw new Error('Comics API URL is not configured');
  const auth = buildMetronAuth(config);
  if (!auth?.password) throw new Error('Metron password/token is not configured');

  const candidateUrls = buildMetronCandidateUrls(apiUrl, [
    '/collection/issue/',
    '/collection/issues/'
  ]);
  const payloads = [
    { issue: normalizedIssueId },
    { issue_id: normalizedIssueId },
    { id: normalizedIssueId }
  ];
  let lastError = null;

  for (const url of candidateUrls) {
    for (const body of payloads) {
      try {
        const response = await axios.post(url, body, {
          auth,
          headers: { 'Content-Type': 'application/json' },
          timeout: 20000,
          validateStatus: () => true
        });
        if (response.status === 404 || response.status === 405 || response.status === 422) continue;
        if (response.status >= 400) {
          const detail = response.data?.detail || response.data?.message || `Provider returned status ${response.status}`;
          const err = new Error(detail);
          err.status = response.status;
          throw err;
        }
        return {
          ok: true,
          status: response.status,
          endpoint: url
        };
      } catch (error) {
        lastError = error;
      }
    }
  }

  if (lastError) throw lastError;
  throw new Error('Unable to locate a Metron collection write endpoint');
}

module.exports = {
  resolveComicsPreset,
  searchComicsByTitle,
  fetchMetronCollectionIssues,
  fetchMetronIssueDetails,
  pushMetronCollectionIssue
};
