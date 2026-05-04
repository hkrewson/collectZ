const axios = require('axios');

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_PLUGIN_NAME = 'collectZ';
const DEFAULT_IMPORT_PAGE_SIZE = 100;
const DEFAULT_IMPORT_MAX_PAGES = 20;

function normalizeKavitaBaseUrl(rawUrl = '') {
  const value = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

function buildKavitaWebUrl(baseUrl = '', path = '') {
  const normalizedBase = normalizeKavitaBaseUrl(baseUrl);
  if (!normalizedBase) return '';
  const suffix = String(path || '').trim();
  if (!suffix) return normalizedBase;
  return `${normalizedBase}/${suffix.replace(/^\/+/, '')}`;
}

function buildKavitaApiUrl(baseUrl = '', path = '') {
  const normalizedBase = normalizeKavitaBaseUrl(baseUrl);
  if (!normalizedBase) return '';
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedPath}`;
}

function getKavitaTimeoutMs(config = {}) {
  const parsed = Number(config.kavitaTimeoutMs || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : DEFAULT_TIMEOUT_MS;
}

function getBearerToken(authPayload = {}) {
  return String(authPayload?.token || authPayload?.jwtToken || authPayload?.accessToken || '').trim();
}

async function authenticateKavita(config = {}, options = {}) {
  const baseUrl = normalizeKavitaBaseUrl(config.kavitaBaseUrl);
  const apiKey = String(config.kavitaApiKey || '').trim();
  if (!baseUrl) throw new Error('Kavita base URL is not configured');
  if (!apiKey) throw new Error('Kavita API key is not configured');

  const response = await axios.post(buildKavitaApiUrl(baseUrl, '/api/Plugin/authenticate'), null, {
    params: {
      apiKey,
      pluginName: options.pluginName || DEFAULT_PLUGIN_NAME
    },
    timeout: getKavitaTimeoutMs(config),
    validateStatus: () => true
  });

  if (response.status === 401 || response.status === 403) {
    const error = new Error('Kavita rejected the configured API key');
    error.status = response.status;
    throw error;
  }
  if (response.status < 200 || response.status >= 300) {
    const detail = response.data?.message || response.data?.error || `Kavita authentication returned status ${response.status}`;
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }

  const token = getBearerToken(response.data);
  if (!token) {
    const error = new Error('Kavita authentication did not return a bearer token');
    error.status = 502;
    throw error;
  }

  return {
    status: response.status,
    token,
    user: {
      id: response.data?.id ?? null,
      username: response.data?.username || '',
      kavitaVersion: response.data?.kavitaVersion || ''
    }
  };
}

async function fetchKavitaLibraries(config = {}, token) {
  const baseUrl = normalizeKavitaBaseUrl(config.kavitaBaseUrl);
  const response = await axios.get(buildKavitaApiUrl(baseUrl, '/api/Library/libraries'), {
    headers: { Authorization: `Bearer ${token}` },
    timeout: getKavitaTimeoutMs(config),
    validateStatus: () => true
  });
  if (response.status < 200 || response.status >= 300) {
    const error = new Error(response.data?.message || response.data?.error || `Kavita libraries returned status ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return Array.isArray(response.data) ? response.data : [];
}

async function fetchKavitaSeriesSample(config = {}, token, libraryId = null, limit = 5) {
  const baseUrl = normalizeKavitaBaseUrl(config.kavitaBaseUrl);
  const pageSize = Math.max(1, Math.min(Number(limit || 5), 20));

  const response = await axios.post(buildKavitaApiUrl(baseUrl, '/api/Series/all-v2'), {
    statements: [],
    combination: 0,
    limitTo: pageSize
  }, {
    params: { PageNumber: 1, PageSize: pageSize },
    headers: { Authorization: `Bearer ${token}` },
    timeout: getKavitaTimeoutMs(config),
    validateStatus: () => true
  });
  if (response.status < 200 || response.status >= 300) {
    const error = new Error(response.data?.message || response.data?.error || `Kavita series returned status ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return Array.isArray(response.data) ? response.data : [];
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function normalizeKavitaDate(raw) {
  const value = String(raw || '').trim();
  if (!value) return { year: null, release_date: null };
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { year: Number(iso[1]), release_date: `${iso[1]}-${iso[2]}-${iso[3]}` };
  const yearOnly = value.match(/\b(18|19|20)\d{2}\b/);
  if (!yearOnly) return { year: null, release_date: null };
  return { year: Number(yearOnly[0]), release_date: `${yearOnly[0]}-01-01` };
}

function normalizeKavitaLibraryType(rawType) {
  if (rawType === undefined || rawType === null || rawType === '') return '';
  const numeric = Number(rawType);
  if (Number.isFinite(numeric)) {
    if (numeric === 0) return 'manga';
    if (numeric === 1) return 'comic';
    if (numeric === 2) return 'book';
  }
  return String(rawType || '').trim().toLowerCase();
}

function detectKavitaMediaType(series = {}, library = {}) {
  const libraryType = normalizeKavitaLibraryType(library.type ?? series.libraryType);
  if (libraryType === 'book') return 'book';
  if (libraryType === 'comic' || libraryType === 'manga') return 'comic_book';

  const haystack = [
    library.name,
    libraryType,
    series.libraryName,
    series.format,
    series.name,
    series.localizedName
  ].map((value) => String(value || '').toLowerCase()).join(' ');

  if (/\b(comic|comics|manga|graphic novel|graphic novels)\b/.test(haystack)) return 'comic_book';
  return 'book';
}

function normalizeKavitaSeries(series = {}, library = {}, config = {}) {
  const id = series.id ?? series.seriesId ?? null;
  const title = firstString(series.localizedName, series.name, series.originalName, series.sortName);
  if (!id || !title) return null;

  const mediaType = detectKavitaMediaType(series, library);
  const sourceUpdatedAt = firstString(series.lastChapterAdded, series.lastFolderScanned, series.created, library.lastScanned);
  const publishedDate = firstString(series.releaseDate, series.published, series.publicationDate);
  const date = normalizeKavitaDate(publishedDate);
  const libraryId = series.libraryId ?? library.id ?? null;
  const libraryName = firstString(series.libraryName, library.name);
  const libraryType = normalizeKavitaLibraryType(library.type ?? series.libraryType);
  const providerItemId = `kavita:series:${id}`;
  const openUrl = buildKavitaWebUrl(config.kavitaBaseUrl, `/library/${libraryId || ''}/series/${id}`);
  const summary = firstString(series.summary, series.localizedSummary, series.description);
  const coverImage = firstString(series.coverImage, series.coverImageLocked ? '' : series.cover);
  const coverUrl = coverImage ? buildKavitaWebUrl(config.kavitaBaseUrl, coverImage) : null;
  const seriesName = firstString(series.name, title);
  const localizedName = firstString(series.localizedName, title);
  const originalName = firstString(series.originalName);
  const sortName = firstString(series.sortName);
  const kavitaFormat = firstString(series.format);
  const kavitaPages = firstString(series.pages);

  return {
    title,
    media_type: mediaType,
    year: date.year,
    release_date: date.release_date,
    format: 'Digital',
    overview: summary || null,
    external_url: openUrl || null,
    poster_path: coverUrl,
    type_details: {
      author: firstString(series.writer, series.author, series.authors) || null,
      publisher: firstString(series.publisher) || null,
      isbn: null,
      edition: null,
      series: mediaType === 'comic_book' ? title : firstString(series.seriesName) || null,
      issue_number: null,
      volume: firstString(series.volume) || null,
      provider_name: 'kavita',
      provider_item_id: providerItemId,
      provider_external_url: openUrl || null,
      provider_download_url: null,
      kavita_library_id: libraryId ?? null,
      kavita_library_name: libraryName || null,
      kavita_library_type: libraryType || null,
      kavita_series_id: id,
      kavita_series_name: seriesName || null,
      kavita_localized_name: localizedName || null,
      kavita_original_name: originalName || null,
      kavita_sort_name: sortName || null,
      kavita_format: kavitaFormat || null,
      kavita_pages: kavitaPages || null,
      kavita_cover_image: coverImage || null,
      source_updated_at: sourceUpdatedAt || null
    }
  };
}

async function fetchKavitaImportItems(config = {}, options = {}) {
  const auth = await authenticateKavita(config, options);
  const libraries = await fetchKavitaLibraries(config, auth.token);
  const librariesById = new Map(libraries.map((library) => [Number(library.id), library]));
  const pageSize = Math.max(1, Math.min(Number(options.pageSize || DEFAULT_IMPORT_PAGE_SIZE), 500));
  const maxPages = Math.max(1, Math.min(Number(options.maxPages || DEFAULT_IMPORT_MAX_PAGES), 100));
  const rows = [];
  const seen = new Set();
  let page = 0;
  let hasMore = false;

  while (page < maxPages) {
    page += 1;
    const response = await axios.post(buildKavitaApiUrl(config.kavitaBaseUrl, '/api/Series/all-v2'), {
      statements: [],
      combination: 0,
      limitTo: pageSize
    }, {
      params: { PageNumber: page, PageSize: pageSize },
      headers: { Authorization: `Bearer ${auth.token}` },
      timeout: getKavitaTimeoutMs(config),
      validateStatus: () => true
    });
    if (response.status < 200 || response.status >= 300) {
      const error = new Error(response.data?.message || response.data?.error || `Kavita series import returned status ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const seriesRows = Array.isArray(response.data) ? response.data : [];
    for (const series of seriesRows) {
      const library = librariesById.get(Number(series.libraryId)) || {};
      const normalized = normalizeKavitaSeries(series, library, config);
      const rowId = String(normalized?.type_details?.provider_item_id || '').trim();
      if (normalized && (!rowId || !seen.has(rowId))) {
        rows.push(normalized);
        if (rowId) seen.add(rowId);
      }
    }

    if (seriesRows.length < pageSize) {
      hasMore = false;
      break;
    }
    hasMore = page >= maxPages;
  }

  return {
    rows,
    pagesFetched: page,
    pageSize,
    libraryCount: libraries.length,
    endpoint: buildKavitaApiUrl(config.kavitaBaseUrl, '/api/Series/all-v2'),
    hasMore
  };
}

async function testKavitaConnection(config = {}, options = {}) {
  const auth = await authenticateKavita(config, options);
  const libraries = await fetchKavitaLibraries(config, auth.token);
  const firstLibraryId = libraries[0]?.id ?? null;
  const series = await fetchKavitaSeriesSample(config, auth.token, firstLibraryId, options.seriesLimit || 5).catch((error) => {
    error.seriesReadFailed = true;
    throw error;
  });

  return {
    ok: true,
    authenticated: true,
    status: 200,
    provider: 'kavita',
    detail: `Connected. Found ${libraries.length} library/libraries and sampled ${series.length} series.`,
    user: auth.user,
    libraryCount: libraries.length,
    libraries: libraries.slice(0, 10).map((library) => ({
      id: library.id ?? null,
      name: library.name || '',
      type: library.type ?? null,
      lastScanned: library.lastScanned || null
    })),
    seriesSample: series.slice(0, 10).map((item) => ({
      id: item.id ?? null,
      libraryId: item.libraryId ?? null,
      libraryName: item.libraryName || '',
      name: item.localizedName || item.name || item.originalName || '',
      sortName: item.sortName || '',
      format: item.format ?? null,
      pages: item.pages ?? null,
      openUrl: item.id ? buildKavitaWebUrl(config.kavitaBaseUrl, `/library/${item.libraryId || firstLibraryId}/series/${item.id}`) : ''
    })),
    openUrl: buildKavitaWebUrl(config.kavitaBaseUrl)
  };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  normalizeKavitaBaseUrl,
  buildKavitaWebUrl,
  authenticateKavita,
  fetchKavitaLibraries,
  fetchKavitaSeriesSample,
  fetchKavitaImportItems,
  normalizeKavitaSeries,
  normalizeKavitaLibraryType,
  testKavitaConnection
};
