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

const searchTmdbMovie = async (title, year, integrationConfig = null) => {
  if (!title) return [];

  const apiUrl = integrationConfig?.tmdbApiUrl || 'https://api.themoviedb.org/3/search/movie';
  const apiKey = integrationConfig?.tmdbApiKey || process.env.TMDB_API_KEY || '';
  const apiKeyQueryParam = integrationConfig?.tmdbApiKeyQueryParam || 'api_key';
  const apiKeyHeader = integrationConfig?.tmdbApiKeyHeader || '';

  if (!apiKey) {
    throw Object.assign(new Error('TMDB API key is not configured'), { status: 400 });
  }

  const params = { query: title, year: year || undefined };
  const headers = {};
  if (apiKeyHeader) headers[apiKeyHeader] = apiKey;
  else params[apiKeyQueryParam] = apiKey;

  const response = await axios.get(apiUrl, { params, headers });
  return response.data?.results || [];
};

const fetchTmdbMovieDetails = async (movieId, integrationConfig = null) => {
  if (!movieId) return {};

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

  const response = await axios.get(`${apiBaseUrl}/movie/${movieId}`, { params, headers });
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
    runtime: details.runtime || null,
    trailer_url: trailerUrl,
    tmdb_url: `https://www.themoviedb.org/movie/${movieId}`
  };
};

module.exports = {
  TMDB_PRESETS,
  resolveTmdbPreset,
  searchTmdbMovie,
  fetchTmdbMovieDetails
};
