const axios = require('axios');

const TMDB_PRESETS = {
  tmdb: {
    provider: 'tmdb',
    apiUrl: 'https://api.themoviedb.org/3/search/movie',
    apiKeyHeader: '',
    apiKeyQueryParam: 'api_key'
  },
  custom: {
    provider: 'custom',
    apiUrl: '',
    apiKeyHeader: '',
    apiKeyQueryParam: 'api_key'
  }
};

const resolveTmdbPreset = (presetName) =>
  TMDB_PRESETS[presetName] || TMDB_PRESETS.tmdb;

const tmdbBaseUrlFromSearchUrl = (searchUrl) => {
  try {
    const parsed = new URL(searchUrl || 'https://api.themoviedb.org/3/search/movie');
    parsed.pathname = '/3';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch (_) {
    return 'https://api.themoviedb.org/3';
  }
};

const resolveTmdbSearchUrl = (mediaType, integrationConfig = null) => {
  const configured = integrationConfig?.tmdbApiUrl || 'https://api.themoviedb.org/3/search/movie';
  const base = configured.replace(/\/search\/(movie|tv).*$/i, '');
  const target = mediaType === 'tv' ? 'tv' : 'movie';
  return `${base}/search/${target}`;
};

const toTmdbResultShape = (item, mediaType) => {
  if (!item) return item;
  if (mediaType !== 'tv') {
    return { ...item, tmdb_media_type: 'movie' };
  }
  return {
    ...item,
    title: item.name || item.title || '',
    original_title: item.original_name || item.original_title || '',
    release_date: item.first_air_date || item.release_date || '',
    tmdb_media_type: 'tv'
  };
};

const searchTmdbMovie = async (title, year, integrationConfig = null, mediaType = 'movie') => {
  if (!title) return [];

  const normalizedType = mediaType === 'tv' ? 'tv' : 'movie';
  const apiUrl = resolveTmdbSearchUrl(normalizedType, integrationConfig);
  const apiKey = integrationConfig?.tmdbApiKey || process.env.TMDB_API_KEY || '';
  const apiKeyQueryParam = integrationConfig?.tmdbApiKeyQueryParam || 'api_key';
  const apiKeyHeader = integrationConfig?.tmdbApiKeyHeader || '';

  if (!apiKey) {
    throw Object.assign(new Error('TMDB API key is not configured'), { status: 400 });
  }

  const params = { query: title };
  if (year) {
    if (normalizedType === 'tv') params.first_air_date_year = year;
    else params.year = year;
  }
  const headers = {};
  if (apiKeyHeader) headers[apiKeyHeader] = apiKey;
  else params[apiKeyQueryParam] = apiKey;

  const response = await axios.get(apiUrl, { params, headers });
  return (response.data?.results || []).map((r) => toTmdbResultShape(r, normalizedType));
};

const fetchTmdbMovieDetails = async (movieId, integrationConfig = null, mediaType = 'movie') => {
  if (!movieId) return {};
  const normalizedType = mediaType === 'tv' ? 'tv' : 'movie';

  const apiKey = integrationConfig?.tmdbApiKey || process.env.TMDB_API_KEY || '';
  const apiKeyQueryParam = integrationConfig?.tmdbApiKeyQueryParam || 'api_key';
  const apiKeyHeader = integrationConfig?.tmdbApiKeyHeader || '';
  const apiBaseUrl = tmdbBaseUrlFromSearchUrl(integrationConfig?.tmdbApiUrl);

  if (!apiKey) {
    throw Object.assign(new Error('TMDB API key is not configured'), { status: 400 });
  }

  const params = { append_to_response: 'credits,videos' };
  const headers = {};
  if (apiKeyHeader) headers[apiKeyHeader] = apiKey;
  else params[apiKeyQueryParam] = apiKey;

  const response = await axios.get(`${apiBaseUrl}/${normalizedType}/${movieId}`, { params, headers });
  const details = response.data || {};
  const crew = Array.isArray(details.credits?.crew) ? details.credits.crew : [];
  const director =
    crew.find((p) => p.job === 'Director')?.name ||
    crew.find((p) => p.department === 'Directing')?.name ||
    '';

  const videos = Array.isArray(details.videos?.results) ? details.videos.results : [];
  const trailer =
    videos.find((v) => v.type === 'Trailer' && v.site === 'YouTube' && v.official) ||
    videos.find((v) => v.type === 'Trailer' && v.site === 'YouTube') ||
    videos.find((v) => v.site === 'YouTube') ||
    null;
  const trailerUrl = trailer?.key ? `https://www.youtube.com/watch?v=${trailer.key}` : '';

  return {
    director,
    runtime: details.runtime || details.episode_run_time?.[0] || null,
    trailer_url: trailerUrl,
    tmdb_url: `https://www.themoviedb.org/${normalizedType}/${movieId}`,
    tmdb_media_type: normalizedType,
    release_date: details.release_date || details.first_air_date || null,
    rating: details.vote_average || null,
    overview: details.overview || null,
    poster_path: details.poster_path || null,
    backdrop_path: details.backdrop_path || null
  };
};

module.exports = {
  TMDB_PRESETS,
  resolveTmdbPreset,
  searchTmdbMovie,
  fetchTmdbMovieDetails
};
