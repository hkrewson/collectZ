const axios = require('axios');

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_PLUGIN_NAME = 'collectZ';
const DEFAULT_IMPORT_PAGE_SIZE = 100;
const DEFAULT_IMPORT_MAX_PAGES = 20;
const DEFAULT_IMPORT_MAX_VOLUME_DETAILS = 250;

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

function buildKavitaSeriesWebUrl(baseUrl = '', libraryId = null, seriesId = null) {
  const libId = Number(libraryId || 0) || null;
  const id = Number(seriesId || 0) || null;
  if (!libId || !id) return '';
  return buildKavitaWebUrl(baseUrl, `/library/${libId}/series/${id}`);
}

function buildKavitaSeriesProviderItemId(seriesId = null) {
  const id = Number(seriesId || 0) || null;
  if (!id) return '';
  return `kavita:series:${id}`;
}

function buildKavitaChapterProviderItemId(chapterId = null) {
  const id = Number(chapterId || 0) || null;
  if (!id) return '';
  return `kavita:chapter:${id}`;
}

function normalizeKavitaFormat(rawFormat) {
  const numeric = Number(rawFormat);
  if (Number.isFinite(numeric)) {
    if (numeric === 3) return 'epub';
    if (numeric === 4) return 'pdf';
    if (numeric === 0 || numeric === 1) return 'manga';
  }
  const text = String(rawFormat || '').trim().toLowerCase();
  if (text.includes('epub')) return 'epub';
  if (text.includes('pdf')) return 'pdf';
  if (text.includes('image') || text.includes('archive') || text.includes('manga') || text.includes('comic')) return 'manga';
  return '';
}

function inferKavitaReaderRoute({ format = null, libraryType = '' } = {}) {
  const normalizedFormat = normalizeKavitaFormat(format);
  if (normalizedFormat === 'epub') return 'book';
  if (normalizedFormat === 'pdf') return 'pdf';
  const normalizedLibraryType = normalizeKavitaLibraryType(libraryType);
  if (normalizedLibraryType === 'book') return 'book';
  return 'manga';
}

function buildKavitaReaderWebUrl(baseUrl = '', {
  libraryId = null,
  seriesId = null,
  chapterId = null,
  format = null,
  libraryType = ''
} = {}) {
  const libId = Number(libraryId || 0) || null;
  const sId = Number(seriesId || 0) || null;
  const chId = Number(chapterId || 0) || null;
  if (!libId || !sId || !chId) return '';
  const route = inferKavitaReaderRoute({ format, libraryType });
  return buildKavitaWebUrl(baseUrl, `/library/${libId}/series/${sId}/${route}/${chId}`);
}

function buildKavitaCoverProxyPath(seriesId = null) {
  const id = Number(seriesId || 0) || null;
  if (!id) return '';
  return `/api/media/kavita-cover/${id}`;
}

function buildKavitaCoverImageUrl(baseUrl = '', coverImage = '') {
  const normalizedBase = normalizeKavitaBaseUrl(baseUrl);
  const raw = String(coverImage || '').trim();
  if (!normalizedBase || !raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const base = new URL(normalizedBase);
      if (parsed.origin !== base.origin) return '';
      if (base.pathname !== '/' && !parsed.pathname.startsWith(base.pathname.replace(/\/+$/, ''))) return '';
      return parsed.toString();
    } catch (_) {
      return '';
    }
  }
  return buildKavitaWebUrl(normalizedBase, raw);
}

async function fetchKavitaCoverImage(config = {}, token, coverImage = '') {
  const imageUrl = buildKavitaCoverImageUrl(config.kavitaBaseUrl, coverImage);
  if (!imageUrl) {
    const error = new Error('Kavita cover image path is not available');
    error.status = 404;
    throw error;
  }
  const response = await axios.get(imageUrl, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'arraybuffer',
    timeout: getKavitaTimeoutMs(config),
    validateStatus: () => true
  });
  if (response.status < 200 || response.status >= 300) {
    const error = new Error(`Kavita cover image returned status ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return {
    body: Buffer.from(response.data || []),
    contentType: String(response.headers?.['content-type'] || 'image/jpeg').split(';')[0].trim() || 'image/jpeg'
  };
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

async function fetchKavitaSeriesVolumes(config = {}, token, seriesId) {
  const baseUrl = normalizeKavitaBaseUrl(config.kavitaBaseUrl);
  const id = Number(seriesId || 0) || null;
  if (!id) return [];
  const response = await axios.get(buildKavitaApiUrl(baseUrl, '/api/Series/volumes'), {
    params: { seriesId: id },
    headers: { Authorization: `Bearer ${token}` },
    timeout: getKavitaTimeoutMs(config),
    validateStatus: () => true
  });
  if (response.status < 200 || response.status >= 300) {
    const error = new Error(response.data?.message || response.data?.error || `Kavita volumes returned status ${response.status}`);
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

function normalizeKavitaNumberToken(raw) {
  if (raw === undefined || raw === null || raw === '') return '';
  const text = String(raw).trim();
  if (!text) return '';
  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    if (Number.isInteger(numeric)) return String(numeric);
    return String(numeric).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }
  return text;
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

function isKavitaComicLibraryType(rawType) {
  const libraryType = normalizeKavitaLibraryType(rawType);
  return libraryType === 'comic' || libraryType === 'manga';
}

function normalizeKavitaVolumeNumber(volume = {}) {
  const min = normalizeKavitaNumberToken(volume.minNumber);
  const max = normalizeKavitaNumberToken(volume.maxNumber);
  if (min && max && min !== max) return `${min}-${max}`;
  return min || max || normalizeKavitaNumberToken(volume.number) || firstString(volume.name);
}

function normalizeKavitaChapterNumber(chapter = {}) {
  const range = firstString(chapter.range);
  if (range) return range;
  const min = normalizeKavitaNumberToken(chapter.minNumber);
  const max = normalizeKavitaNumberToken(chapter.maxNumber);
  if (min && max && min !== max) return `${min}-${max}`;
  return min || max || normalizeKavitaNumberToken(chapter.number);
}

function sortKavitaVolumes(volumes = []) {
  return [...volumes].sort((left, right) => {
    const leftNumber = Number(left?.minNumber ?? left?.number ?? 0);
    const rightNumber = Number(right?.minNumber ?? right?.number ?? 0);
    return (Number.isFinite(leftNumber) ? leftNumber : 0) - (Number.isFinite(rightNumber) ? rightNumber : 0)
      || String(left?.name || '').localeCompare(String(right?.name || ''))
      || Number(left?.id || 0) - Number(right?.id || 0);
  });
}

function sortKavitaChapters(chapters = []) {
  return [...chapters].sort((left, right) => {
    const leftOrder = Number(left?.sortOrder ?? left?.minNumber ?? left?.number ?? 0);
    const rightOrder = Number(right?.sortOrder ?? right?.minNumber ?? right?.number ?? 0);
    return (Number.isFinite(leftOrder) ? leftOrder : 0) - (Number.isFinite(rightOrder) ? rightOrder : 0)
      || Number(left?.id || 0) - Number(right?.id || 0);
  });
}

function summarizeKavitaVolumeDetails(volumes = []) {
  const sortedVolumes = sortKavitaVolumes(Array.isArray(volumes) ? volumes : []);
  const chapters = sortedVolumes.flatMap((volume) => sortKavitaChapters(Array.isArray(volume?.chapters) ? volume.chapters : [])
    .map((chapter) => ({ ...chapter, __volume: volume })));
  const firstChapter = chapters.find((chapter) => !chapter.isSpecial) || chapters[0] || null;
  const firstVolume = firstChapter?.__volume || sortedVolumes[0] || null;
  const volumeNumbers = Array.from(new Set(sortedVolumes
    .map((volume) => normalizeKavitaVolumeNumber(volume))
    .filter(Boolean)));
  const chapterTitles = Array.from(new Set(chapters
    .map((chapter) => firstString(chapter.titleName, chapter.title))
    .filter(Boolean)));
  const firstChapterDate = normalizeKavitaDate(firstString(firstChapter?.releaseDate, firstChapter?.createdUtc, firstChapter?.created));
  const firstChapterNumber = firstChapter ? normalizeKavitaChapterNumber(firstChapter) : '';
  const firstVolumeNumber = firstVolume ? normalizeKavitaVolumeNumber(firstVolume) : '';
  const firstChapterPages = firstString(firstChapter?.pages) || '';
  const totalChapterPages = chapters.reduce((sum, chapter) => {
    const pages = Number(chapter?.pages || 0);
    return sum + (Number.isFinite(pages) && pages > 0 ? pages : 0);
  }, 0);

  return {
    volumeCount: sortedVolumes.length,
    chapterCount: chapters.length,
    volumeNumbers: volumeNumbers.slice(0, 20).join(', '),
    firstVolumeNumber,
    firstChapterId: firstChapter?.id ?? null,
    firstChapterNumber,
    firstChapterTitle: firstString(firstChapter?.titleName, firstChapter?.title),
    firstChapterReleaseDate: firstChapterDate.release_date,
    firstChapterPages,
    chapterTitles: chapterTitles.slice(0, 20).join(' | '),
    totalChapterPages: totalChapterPages || null
  };
}

function applyKavitaVolumeDetails(normalized = null, volumes = [], { status = 'loaded', config = {} } = {}) {
  if (!normalized?.type_details) return normalized;
  const summary = summarizeKavitaVolumeDetails(volumes);
  const details = normalized.type_details;
  const readerUrl = summary.firstChapterId
    ? buildKavitaReaderWebUrl(config.kavitaBaseUrl, {
      libraryId: details.kavita_library_id,
      seriesId: details.kavita_series_id,
      chapterId: summary.firstChapterId,
      format: details.kavita_format,
      libraryType: details.kavita_library_type
    })
    : '';
  const seriesUrl = firstString(details.kavita_series_url, details.provider_external_url);
  const nextDetails = {
    ...details,
    kavita_series_url: seriesUrl || null,
    kavita_launch_url: readerUrl || seriesUrl || null,
    kavita_launch_label: readerUrl ? 'Read in Kavita' : (seriesUrl ? 'Open in Kavita' : null),
    kavita_launch_target: readerUrl ? 'first_chapter_reader' : (seriesUrl ? 'series_detail' : null),
    kavita_volume_detail_status: status,
    kavita_volume_count: summary.volumeCount || null,
    kavita_chapter_count: summary.chapterCount || null,
    kavita_volume_numbers: summary.volumeNumbers || null,
    kavita_first_volume_number: summary.firstVolumeNumber || null,
    kavita_first_chapter_id: summary.firstChapterId ?? null,
    kavita_first_chapter_number: summary.firstChapterNumber || null,
    kavita_first_chapter_title: summary.firstChapterTitle || null,
    kavita_first_chapter_release_date: summary.firstChapterReleaseDate || null,
    kavita_first_chapter_pages: summary.firstChapterPages || null,
    kavita_chapter_titles: summary.chapterTitles || null,
    kavita_chapter_pages_total: summary.totalChapterPages || null
  };

  if (normalized.media_type === 'comic_book') {
    nextDetails.volume = details.volume || summary.firstVolumeNumber || null;
    nextDetails.issue_number = details.issue_number || summary.firstChapterNumber || null;
    nextDetails.cover_date = details.cover_date || summary.firstChapterReleaseDate || null;
  }

  return {
    ...normalized,
    type_details: nextDetails
  };
}

function buildKavitaChapterIssueTitle(seriesTitle = '', chapter = {}, chapterNumber = '') {
  const chapterTitle = firstString(chapter.titleName, chapter.title);
  if (chapterTitle) return chapterTitle;
  const parentTitle = firstString(seriesTitle, 'Kavita issue');
  if (chapterNumber) return `${parentTitle} #${chapterNumber}`;
  return parentTitle;
}

function hasKavitaChapterDisplayMetadata(chapter = {}) {
  return Boolean(
    normalizeKavitaChapterNumber(chapter)
    || firstString(chapter.titleName, chapter.title)
    || firstString(chapter.releaseDate, chapter.createdUtc, chapter.created)
    || firstString(chapter.pages)
  );
}

function normalizeKavitaChapterIssueRows(normalized = null, volumes = [], config = {}) {
  if (!normalized || normalized.media_type !== 'comic_book' || !normalized.type_details) {
    return { rows: [], skippedBooks: 1, skippedSpecials: 0, skippedMissingIds: 0, skippedSparseMetadata: 0 };
  }

  const details = normalized.type_details;
  if (!isKavitaComicLibraryType(details.kavita_library_type)) {
    return { rows: [], skippedBooks: 1, skippedSpecials: 0, skippedMissingIds: 0, skippedSparseMetadata: 0 };
  }

  const parentSeriesId = Number(details.kavita_series_id || 0) || null;
  const parentProviderItemId = buildKavitaSeriesProviderItemId(parentSeriesId);
  const sortedVolumes = sortKavitaVolumes(Array.isArray(volumes) ? volumes : []);
  const rows = [];
  let skippedSpecials = 0;
  let skippedMissingIds = 0;
  let skippedSparseMetadata = 0;

  for (const volume of sortedVolumes) {
    const volumeId = Number(volume?.id || 0) || null;
    const volumeNumber = normalizeKavitaVolumeNumber(volume);
    const chapters = sortKavitaChapters(Array.isArray(volume?.chapters) ? volume.chapters : []);
    for (const chapter of chapters) {
      if (chapter?.isSpecial) {
        skippedSpecials += 1;
        continue;
      }
      const chapterId = Number(chapter?.id || 0) || null;
      const chapterProviderItemId = buildKavitaChapterProviderItemId(chapterId);
      if (!chapterProviderItemId) {
        skippedMissingIds += 1;
        continue;
      }
      if (!hasKavitaChapterDisplayMetadata(chapter)) {
        skippedSparseMetadata += 1;
        continue;
      }

      const chapterNumber = normalizeKavitaChapterNumber(chapter);
      const chapterDate = normalizeKavitaDate(firstString(chapter.releaseDate, chapter.createdUtc, chapter.created));
      const chapterTitle = buildKavitaChapterIssueTitle(normalized.title, chapter, chapterNumber);
      const launchUrl = buildKavitaReaderWebUrl(config.kavitaBaseUrl, {
        libraryId: details.kavita_library_id,
        seriesId: parentSeriesId,
        chapterId,
        format: details.kavita_format,
        libraryType: details.kavita_library_type
      });
      const chapterPages = firstString(chapter.pages);

      rows.push({
        title: chapterTitle,
        media_type: 'comic_book',
        year: chapterDate.year || normalized.year || null,
        release_date: chapterDate.release_date || normalized.release_date || null,
        format: 'Digital',
        overview: normalized.overview || null,
        external_url: launchUrl || details.kavita_series_url || details.provider_external_url || null,
        poster_path: normalized.poster_path || null,
        type_details: {
          ...details,
          series: firstString(details.series, details.kavita_series_name, normalized.title) || null,
          issue_number: chapterNumber || null,
          volume: volumeNumber || null,
          cover_date: chapterDate.release_date || null,
          provider_name: 'kavita',
          provider_item_id: chapterProviderItemId,
          provider_issue_id: chapterProviderItemId,
          provider_external_url: launchUrl || null,
          provider_download_url: null,
          kavita_launch_url: launchUrl || null,
          kavita_launch_label: launchUrl ? 'Read in Kavita' : null,
          kavita_launch_target: launchUrl ? 'chapter_reader' : null,
          kavita_chapter_fanout: 'true',
          kavita_chapter_id: chapterId,
          kavita_volume_id: volumeId,
          kavita_chapter_number: chapterNumber || null,
          kavita_chapter_title: firstString(chapter.titleName, chapter.title) || null,
          kavita_chapter_release_date: chapterDate.release_date || null,
          kavita_chapter_pages: chapterPages || null,
          kavita_parent_provider_item_id: parentProviderItemId || null,
          kavita_series_provider_item_id: parentProviderItemId || null,
          kavita_chapter_provider_item_id: chapterProviderItemId
        }
      });
    }
  }

  return { rows, skippedBooks: 0, skippedSpecials, skippedMissingIds, skippedSparseMetadata };
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
  const providerItemId = buildKavitaSeriesProviderItemId(id);
  const openUrl = buildKavitaSeriesWebUrl(config.kavitaBaseUrl, libraryId, id);
  const summary = firstString(series.summary, series.localizedSummary, series.description);
  const coverImage = firstString(series.coverImage, series.coverImageLocked ? '' : series.cover);
  const coverUrl = buildKavitaCoverImageUrl(config.kavitaBaseUrl, coverImage);
  const coverProxyUrl = buildKavitaCoverProxyPath(id);
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
    poster_path: coverProxyUrl || coverUrl || null,
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
      kavita_series_url: openUrl || null,
      kavita_launch_url: openUrl || null,
      kavita_launch_label: openUrl ? 'Open in Kavita' : null,
      kavita_launch_target: openUrl ? 'series_detail' : null,
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
      kavita_cover_url: coverUrl || null,
      kavita_cover_proxy_url: coverProxyUrl || null,
      kavita_cover_source: coverProxyUrl ? 'collectz_proxy' : (coverUrl ? 'kavita_direct' : 'missing'),
      kavita_cover_status: coverProxyUrl ? 'proxied' : (coverUrl ? 'direct' : 'missing'),
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
  const includeVolumeDetails = options.includeVolumeDetails !== false;
  const includeChapterFanout = Boolean(options.includeChapterFanout);
  const maxVolumeDetails = Math.max(0, Math.min(Number(options.maxVolumeDetails ?? DEFAULT_IMPORT_MAX_VOLUME_DETAILS), 1000));
  const rows = [];
  const seen = new Set();
  let page = 0;
  let hasMore = false;
  let volumeDetailsFetched = 0;
  let volumeDetailsAttempted = 0;
  let volumeDetailsUnavailable = 0;
  let volumeDetailsSkipped = 0;
  let chapterFanoutRows = 0;
  let chapterFanoutSkippedBooks = 0;
  let chapterFanoutSkippedSpecials = 0;
  let chapterFanoutSkippedMissingIds = 0;
  let chapterFanoutSkippedSparseMetadata = 0;

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
      let normalized = normalizeKavitaSeries(series, library, config);
      let volumes = [];
      let volumeDetailsLoaded = false;
      if (normalized && includeVolumeDetails) {
        if (volumeDetailsAttempted < maxVolumeDetails) {
          volumeDetailsAttempted += 1;
          try {
            volumes = await fetchKavitaSeriesVolumes(config, auth.token, series.id ?? series.seriesId);
            normalized = applyKavitaVolumeDetails(normalized, volumes, { config });
            volumeDetailsFetched += 1;
            volumeDetailsLoaded = true;
          } catch (_) {
            normalized = applyKavitaVolumeDetails(normalized, [], { status: 'unavailable', config });
            volumeDetailsUnavailable += 1;
          }
        } else {
          normalized = applyKavitaVolumeDetails(normalized, [], { status: 'skipped_max_detail_limit', config });
          volumeDetailsSkipped += 1;
        }
      }
      const rowId = String(normalized?.type_details?.provider_item_id || '').trim();
      if (normalized && (!rowId || !seen.has(rowId))) {
        rows.push(normalized);
        if (rowId) seen.add(rowId);
      }
      if (normalized && includeChapterFanout) {
        const fanout = volumeDetailsLoaded
          ? normalizeKavitaChapterIssueRows(normalized, volumes, config)
          : { rows: [], skippedBooks: normalized.media_type !== 'comic_book' ? 1 : 0, skippedSpecials: 0, skippedMissingIds: 0, skippedSparseMetadata: 0 };
        chapterFanoutSkippedBooks += fanout.skippedBooks;
        chapterFanoutSkippedSpecials += fanout.skippedSpecials;
        chapterFanoutSkippedMissingIds += fanout.skippedMissingIds;
        chapterFanoutSkippedSparseMetadata += fanout.skippedSparseMetadata;
        for (const fanoutRow of fanout.rows) {
          const fanoutRowId = String(fanoutRow?.type_details?.provider_item_id || '').trim();
          if (fanoutRowId && seen.has(fanoutRowId)) continue;
          rows.push(fanoutRow);
          if (fanoutRowId) seen.add(fanoutRowId);
          chapterFanoutRows += 1;
        }
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
    volumeDetailsAttempted,
    volumeDetailsFetched,
    volumeDetailsUnavailable,
    volumeDetailsSkipped,
    chapterFanoutEnabled: includeChapterFanout,
    chapterFanoutRows,
    chapterFanoutSkippedBooks,
    chapterFanoutSkippedSpecials,
    chapterFanoutSkippedMissingIds,
    chapterFanoutSkippedSparseMetadata,
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
  buildKavitaSeriesWebUrl,
  buildKavitaSeriesProviderItemId,
  buildKavitaChapterProviderItemId,
  buildKavitaReaderWebUrl,
  buildKavitaCoverProxyPath,
  buildKavitaCoverImageUrl,
  fetchKavitaCoverImage,
  authenticateKavita,
  fetchKavitaLibraries,
  fetchKavitaSeriesSample,
  fetchKavitaSeriesVolumes,
  fetchKavitaImportItems,
  normalizeKavitaSeries,
  normalizeKavitaLibraryType,
  isKavitaComicLibraryType,
  summarizeKavitaVolumeDetails,
  applyKavitaVolumeDetails,
  normalizeKavitaChapterIssueRows,
  testKavitaConnection
};
