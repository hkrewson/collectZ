const axios = require('axios');

const PLEX_PRESETS = {
  plex: {
    provider: 'plex',
    apiUrl: '',
    apiKeyQueryParam: 'X-Plex-Token'
  },
  custom: {
    provider: 'custom',
    apiUrl: '',
    apiKeyQueryParam: 'X-Plex-Token'
  }
};

const resolvePlexPreset = (presetName = 'plex') =>
  PLEX_PRESETS[presetName] || PLEX_PRESETS.plex;

const parseAttributes = (raw) => {
  const out = {};
  const re = /([A-Za-z0-9_:-]+)=("([^"]*)"|'([^']*)')/g;
  let match = re.exec(raw);
  while (match) {
    out[match[1]] = match[3] ?? match[4] ?? '';
    match = re.exec(raw);
  }
  return out;
};

const parsePlexDirectories = (xml) => {
  if (!xml) return [];
  if (typeof xml === 'object') {
    const dirs = xml?.MediaContainer?.Directory;
    if (Array.isArray(dirs)) return dirs;
    if (dirs && typeof dirs === 'object') return [dirs];
    return [];
  }
  const source = Buffer.isBuffer(xml) ? xml.toString('utf8') : String(xml);
  const dirs = [];
  const re = /<Directory\b([^>]*?)\/?>/gi;
  let match = re.exec(source);
  while (match) {
    dirs.push(parseAttributes(match[1]));
    match = re.exec(source);
  }
  return dirs;
};

const parsePlexVideos = (xml) => {
  if (!xml) return [];
  if (typeof xml === 'object') {
    const metadata = xml?.MediaContainer?.Metadata;
    if (Array.isArray(metadata)) return metadata;
    if (metadata && typeof metadata === 'object') return [metadata];
    const videos = xml?.MediaContainer?.Video;
    if (Array.isArray(videos)) return videos;
    if (videos && typeof videos === 'object') return [videos];
    return [];
  }
  const source = Buffer.isBuffer(xml) ? xml.toString('utf8') : String(xml);
  const videos = [];
  // Plex XML payloads can use either <Video ...> or <Metadata ...>.
  const re = /<(?:Video|Metadata)\b([^>]*?)>/gi;
  let match = re.exec(source);
  while (match) {
    videos.push(parseAttributes(match[1]));
    match = re.exec(source);
  }
  return videos;
};

const parsePlexDirectoriesInSection = (xml) => {
  if (!xml) return [];
  if (typeof xml === 'object') {
    const dirs = xml?.MediaContainer?.Directory;
    if (Array.isArray(dirs)) return dirs;
    if (dirs && typeof dirs === 'object') return [dirs];
    return [];
  }
  const source = Buffer.isBuffer(xml) ? xml.toString('utf8') : String(xml);
  const entries = [];
  const re = /<Directory\b([^>]*?)\/?>/gi;
  let match = re.exec(source);
  while (match) {
    entries.push(parseAttributes(match[1]));
    match = re.exec(source);
  }
  return entries;
};

const parseTmdbIdFromGuid = (guidRaw) => {
  if (!guidRaw) return null;
  const guid = String(guidRaw);
  const match = guid.match(/tmdb:\/\/(\d+)/i);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
};

const normalizePlexItem = (item) => {
  const rawType = String(item.type || '').toLowerCase();
  const isTv = rawType === 'show' || rawType === 'episode';
  const isAudio = rawType === 'artist' || rawType === 'album' || rawType === 'track';
  const seriesTitle = item.grandparentTitle || item.parentTitle || item.title || item.originalTitle || null;
  const seriesRatingKey = item.grandparentRatingKey || item.parentRatingKey || item.ratingKey || null;
  const audioTitle = rawType === 'track'
    ? (item.parentTitle || item.grandparentTitle || item.title || item.originalTitle || null)
    : (item.title || item.originalTitle || null);
  const audioArtist = item.grandparentTitle || item.parentTitle || item.artist || item.title || null;
  const audioAlbum = rawType === 'track'
    ? (item.parentTitle || item.title || null)
    : (rawType === 'album' ? (item.title || null) : null);
  const year = item.year ? Number(item.year) : null;
  const runtime = item.duration ? Math.round(Number(item.duration) / 60000) : null;
  const tmdbId = parseTmdbIdFromGuid(item.guid);
  const thumb = item.thumb || item.art || null;
  const posterPath = thumb && String(thumb).startsWith('http') ? thumb : null;
  return {
    title: isAudio ? audioTitle : (isTv ? seriesTitle : (item.title || item.originalTitle || null)),
    media_type: isAudio ? 'audio' : (isTv ? 'tv_series' : 'movie'),
    original_title: item.originalTitle || null,
    year: Number.isFinite(year) ? year : null,
    release_date: item.originallyAvailableAt || null,
    runtime: Number.isFinite(runtime) ? runtime : null,
    overview: item.summary || null,
    director: item.director || null,
    network: item.studio || null,
    season_number: item.parentIndex ? Number(item.parentIndex) : null,
    rating: item.rating ? Number(item.rating) : null,
    poster_path: posterPath,
    backdrop_path: posterPath,
    tmdb_id: tmdbId,
    tmdb_url: !isAudio && tmdbId ? `https://www.themoviedb.org/${isTv ? 'tv' : 'movie'}/${tmdbId}` : null,
    tmdb_media_type: isAudio ? null : (isTv ? 'tv' : 'movie'),
    format: 'Digital',
    type_details: isAudio ? {
      artist: audioArtist,
      album: audioAlbum
    } : undefined,
    plex_guid: item.guid ? String(item.guid) : null,
    plex_rating_key: seriesRatingKey ? String(seriesRatingKey) : null
  };
};

const extractEditionFromPath = (filePath) => {
  if (!filePath) return null;
  const raw = String(filePath);
  const match = raw.match(/\{edition-([^}]+)\}/i);
  if (match?.[1]) return match[1];
  return null;
};

const normalizePlexVariant = (item, sectionId) => {
  const rawType = String(item.type || '').toLowerCase();
  const media = Array.isArray(item.Media) ? item.Media[0] : item.Media;
  const part = media?.Part && Array.isArray(media.Part) ? media.Part[0] : media?.Part;
  const seasonNumber = item.parentIndex ? Number(item.parentIndex) : null;
  const tvSeriesKey = item.grandparentRatingKey || item.parentRatingKey || item.ratingKey || null;
  const sourceItemKey = rawType === 'episode' && tvSeriesKey && Number.isInteger(seasonNumber)
    ? `${sectionId}:show:${tvSeriesKey}:season:${seasonNumber}`
    : (item.ratingKey ? `${sectionId}:${item.ratingKey}` : null);
  const sourcePartId = part?.id ? String(part.id) : null;
  const sourceMediaId = media?.id ? String(media.id) : null;
  const filePath = part?.file || null;
  const derivedEdition = Number.isInteger(seasonNumber) && seasonNumber > 0
    ? `Season ${seasonNumber}`
    : null;
  return {
    source: 'plex',
    source_item_key: sourceItemKey,
    source_media_id: sourceMediaId,
    source_part_id: rawType === 'episode' ? null : sourcePartId,
    edition: derivedEdition || extractEditionFromPath(filePath),
    file_path: filePath,
    container: media?.container || part?.container || null,
    video_codec: media?.videoCodec || null,
    audio_codec: media?.audioCodec || null,
    resolution: media?.videoResolution || (media?.width && media?.height ? `${media.width}x${media.height}` : null),
    video_width: media?.width ? Number(media.width) : null,
    video_height: media?.height ? Number(media.height) : null,
    audio_channels: media?.audioChannels ? Number(media.audioChannels) : null,
    duration_ms: media?.duration ? Number(media.duration) : null,
    runtime_minutes: media?.duration ? Math.round(Number(media.duration) / 60000) : null,
    raw_json: media ? { ratingKey: item.ratingKey || null, media, part } : null
  };
};

const plexRequest = async (config, path, params = {}) => {
  const urlBase = String(config.plexApiUrl || '').replace(/\/+$/, '');
  const queryParam = config.plexApiKeyQueryParam || 'X-Plex-Token';
  const reqParams = { ...params, [queryParam]: config.plexApiKey };
  return axios.get(`${urlBase}${path}`, {
    params: reqParams,
    headers: {
      Accept: 'application/json'
    },
    timeout: 25000,
    validateStatus: () => true
  });
};

const fetchPlexSections = async (config) => {
  const response = await plexRequest(config, '/library/sections');
  if (response.status >= 400) {
    const message = typeof response.data === 'string'
      ? response.data.slice(0, 200)
      : response.data?.error || response.statusText;
    throw new Error(`Plex sections request failed (${response.status}): ${message}`);
  }
  const directories = parsePlexDirectories(response.data);
  return directories.map((d) => ({
      id: d.key,
      title: d.title || `Section ${d.key}`,
      type: String(d.type || '').trim().toLowerCase() || 'unknown'
    }));
};

const fetchPlexLibraryItems = async (config, sectionIds = []) => {
  const sections = sectionIds.length > 0 ? sectionIds : (config.plexLibrarySections || []);
  const uniqueSections = [...new Set(sections.map(String).filter(Boolean))];
  let sectionTypeMap = new Map();
  try {
    const discovered = await fetchPlexSections(config);
    sectionTypeMap = new Map(
      discovered.map((section) => [String(section.id), String(section.type || '').toLowerCase()])
    );
  } catch (_error) {
    sectionTypeMap = new Map();
  }
  const items = [];

  for (const sectionId of uniqueSections) {
    const sectionType = sectionTypeMap.get(String(sectionId)) || '';
    const response = await plexRequest(config, `/library/sections/${sectionId}/all`);
    if (response.status >= 400) {
      const message = typeof response.data === 'string'
        ? response.data.slice(0, 200)
        : response.data?.error || response.statusText;
      throw new Error(`Plex section ${sectionId} failed (${response.status}): ${message}`);
    }
    const videos = parsePlexVideos(response.data);
    const directories = parsePlexDirectoriesInSection(response.data);
    const candidates = [...videos, ...directories]
      .filter((entry) => entry.title || entry.originalTitle)
      .filter((entry) => {
        const type = String(entry.type || '').toLowerCase();
        if (sectionType === 'show') {
          return type === 'show' || type === 'episode' || type === 'season';
        }
        if (sectionType === 'movie') {
          return !type || type === 'movie' || type === 'video' || type === 'clip';
        }
        if (sectionType === 'artist') {
          return type === 'artist' || type === 'album' || type === 'track';
        }
        return !type || type === 'movie' || type === 'video' || type === 'show' || type === 'episode';
      });

    for (const video of candidates) {
      items.push({
        sectionId: String(sectionId),
        raw: video,
        normalized: normalizePlexItem(video),
        variant: normalizePlexVariant(video, String(sectionId))
      });
    }
  }
  return items;
};

module.exports = {
  resolvePlexPreset,
  fetchPlexSections,
  fetchPlexLibraryItems,
  normalizePlexItem,
  normalizePlexVariant
};
