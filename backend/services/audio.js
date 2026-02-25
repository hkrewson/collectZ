const axios = require('axios');

const AUDIO_PRESETS = {
  discogs: {
    preset: 'discogs',
    provider: 'discogs',
    apiUrl: 'https://api.discogs.com/database/search',
    apiKeyHeader: 'Authorization',
    apiKeyQueryParam: 'token'
  },
  theaudiodb: {
    preset: 'discogs',
    provider: 'discogs',
    apiUrl: 'https://api.discogs.com/database/search',
    apiKeyHeader: 'Authorization',
    apiKeyQueryParam: 'token'
  },
  custom: {
    preset: 'custom',
    provider: 'custom',
    apiUrl: '',
    apiKeyHeader: '',
    apiKeyQueryParam: 'api_key'
  }
};

function resolveAudioPreset(preset) {
  const key = String(preset || 'discogs').trim().toLowerCase();
  return AUDIO_PRESETS[key] || AUDIO_PRESETS.discogs;
}

function normalizeYearValue(value) {
  const parsed = Number(String(value || '').slice(0, 4));
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 1000 || parsed > 2100) return null;
  return parsed;
}

function normalizeDateValue(dateValue, yearValue) {
  const value = String(dateValue || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const year = normalizeYearValue(yearValue);
  return year ? `${year}-01-01` : null;
}

function normalizeExternalUrl(uri, resourceUrl) {
  const rawUri = String(uri || '').trim();
  const rawResource = String(resourceUrl || '').trim();
  if (rawUri.startsWith('http://') || rawUri.startsWith('https://')) return rawUri;
  if (rawUri.startsWith('/')) return `https://www.discogs.com${rawUri}`;
  if (rawResource.startsWith('http://') || rawResource.startsWith('https://')) return rawResource;
  return null;
}

function mapDiscogsResult(item = {}) {
  const year = normalizeYearValue(item.year);
  const rawTitle = String(item.title || '').trim();
  const titleParts = rawTitle.split(/\s+-\s+/);
  const artistGuess = titleParts.length > 1 ? titleParts[0] : '';
  const albumGuess = titleParts.length > 1 ? titleParts.slice(1).join(' - ') : rawTitle;
  const genres = Array.isArray(item.genre) ? item.genre : [];
  const styles = Array.isArray(item.style) ? item.style : [];
  return {
    id: String(item.id || ''),
    title: albumGuess || rawTitle,
    year,
    release_date: year ? `${year}-01-01` : null,
    overview: null,
    genre: [...genres, ...styles].filter(Boolean).join(', ') || null,
    external_url: normalizeExternalUrl(item.uri, item.resource_url),
    poster_path: item.cover_image || null,
    type_details: {
      artist: artistGuess || null,
      album: albumGuess || rawTitle || null,
      track_count: null
    }
  };
}

async function searchAudioByTitle(title, config = {}, limit = 10, artist = '') {
  const query = String(title || '').trim();
  if (!query) return [];

  const apiUrl = config.audioApiUrl || AUDIO_PRESETS.discogs.apiUrl;
  if (!apiUrl) throw new Error('Audio API URL is not configured');

  const isDiscogs = (config.audioProvider || '').toLowerCase() === 'discogs';
  if (isDiscogs) {
    if (!config.audioApiKey) throw new Error('Discogs personal access token is required');
    const normalizedTitle = query.replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
    const normalizedArtist = String(artist || '').trim().replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
    const params = {
      type: 'release',
      q: query,
      release_title: normalizedTitle || query,
      per_page: Math.max(1, Math.min(Number(limit) || 10, 20)),
      token: config.audioApiKey
    };
    if (normalizedArtist) {
      params.artist = normalizedArtist;
      params.q = `${normalizedArtist} ${normalizedTitle || query}`.trim();
    }
    const headers = {
      'User-Agent': process.env.DISCOGS_USER_AGENT || 'CollectZ/2.0 (+https://collect.krewson.org)',
      Authorization: `Discogs token=${config.audioApiKey}`
    };
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
    const rows = Array.isArray(response.data?.results) ? response.data.results : [];
    return rows.map(mapDiscogsResult).filter((item) => item.title);
  }

  const headers = {};
  if (config.audioApiKey && config.audioApiKeyHeader) {
    headers[config.audioApiKeyHeader] = config.audioApiKey;
  }
  const params = { q: query, limit };
  if (config.audioApiKey && !config.audioApiKeyHeader) {
    params[config.audioApiKeyQueryParam || 'api_key'] = config.audioApiKey;
  }

  const response = await axios.get(apiUrl, {
    params,
    headers,
    timeout: 20000,
    validateStatus: () => true
  });
  if (response.status >= 400) {
    const err = new Error(`Provider returned status ${response.status}`);
    err.status = response.status;
    throw err;
  }

  const rows = Array.isArray(response.data?.results)
    ? response.data.results
    : (Array.isArray(response.data) ? response.data : []);

  return rows.slice(0, limit).map((row) => ({
    id: String(row.id || row.idAlbum || ''),
    title: row.title || row.strAlbum || row.name || '',
    year: normalizeYearValue(row.year),
    release_date: normalizeDateValue(row.release_date, row.year),
    overview: row.overview || row.description || null,
    genre: row.genre || null,
    external_url: row.url || null,
    poster_path: row.poster_path || row.image || null,
    type_details: {
      artist: row.artist || row.strArtist || null,
      album: row.album || row.strAlbum || row.title || null,
      track_count: row.track_count || row.intTotalTracks || null
    }
  })).filter((item) => item.title);
}

module.exports = {
  resolveAudioPreset,
  searchAudioByTitle
};
