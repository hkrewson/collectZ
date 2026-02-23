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

const TMDB_GENRE_MAP = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction',
  10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western'
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

const normalizeTmdbSearchResult = (item, mediaType) => {
  if (!item) return item;
  const normalizedType = mediaType === 'tv' ? 'tv' : 'movie';
  const title = normalizedType === 'tv'
    ? (item.name || item.title || '')
    : (item.title || item.name || '');
  const originalTitle = normalizedType === 'tv'
    ? (item.original_name || item.original_title || '')
    : (item.original_title || item.original_name || '');
  const releaseDate = normalizedType === 'tv'
    ? (item.first_air_date || item.release_date || '')
    : (item.release_date || item.first_air_date || '');
  const releaseYear = releaseDate ? Number(String(releaseDate).slice(0, 4)) : null;
  const genreIds = Array.isArray(item.genre_ids) ? item.genre_ids : [];
  const genreNames = genreIds
    .map((id) => TMDB_GENRE_MAP[Number(id)])
    .filter(Boolean);

  return {
    ...item,
    title,
    original_title: originalTitle,
    release_date: releaseDate,
    release_year: Number.isFinite(releaseYear) ? releaseYear : null,
    rating: item.vote_average ?? null,
    genre_ids: genreIds,
    genre_names: genreNames,
    tmdb_media_type: normalizedType
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
  return (response.data?.results || []).map((r) => normalizeTmdbSearchResult(r, normalizedType));
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

  const releaseDate = details.release_date || details.first_air_date || null;
  const releaseYear = releaseDate ? Number(String(releaseDate).slice(0, 4)) : null;
  return {
    title: normalizedType === 'tv' ? (details.name || details.title || null) : (details.title || details.name || null),
    original_title: normalizedType === 'tv'
      ? (details.original_name || details.original_title || null)
      : (details.original_title || details.original_name || null),
    director,
    runtime: details.runtime || details.episode_run_time?.[0] || null,
    trailer_url: trailerUrl,
    tmdb_url: `https://www.themoviedb.org/${normalizedType}/${movieId}`,
    tmdb_media_type: normalizedType,
    release_date: releaseDate,
    release_year: Number.isFinite(releaseYear) ? releaseYear : null,
    rating: details.vote_average || null,
    genre_names: Array.isArray(details.genres) ? details.genres.map((g) => g?.name).filter(Boolean) : [],
    overview: details.overview || null,
    poster_path: details.poster_path || null,
    backdrop_path: details.backdrop_path || null
  };
};

module.exports = {
  TMDB_PRESETS,
  TMDB_GENRE_MAP,
  resolveTmdbPreset,
  normalizeTmdbSearchResult,
  searchTmdbMovie,
  fetchTmdbMovieDetails
};
