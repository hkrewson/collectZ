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

const resolveTmdbMultiSearchUrl = (integrationConfig = null) => {
  const configured = integrationConfig?.tmdbApiUrl || 'https://api.themoviedb.org/3/search/movie';
  const base = configured.replace(/\/search\/(movie|tv|multi).*$/i, '');
  return `${base}/search/multi`;
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

const searchTmdbMulti = async (title, year, integrationConfig = null) => {
  if (!title) return [];
  const apiUrl = resolveTmdbMultiSearchUrl(integrationConfig);
  const apiKey = integrationConfig?.tmdbApiKey || process.env.TMDB_API_KEY || '';
  const apiKeyQueryParam = integrationConfig?.tmdbApiKeyQueryParam || 'api_key';
  const apiKeyHeader = integrationConfig?.tmdbApiKeyHeader || '';
  if (!apiKey) {
    throw Object.assign(new Error('TMDB API key is not configured'), { status: 400 });
  }
  const params = { query: title };
  if (year) params.year = year;
  const headers = {};
  if (apiKeyHeader) headers[apiKeyHeader] = apiKey;
  else params[apiKeyQueryParam] = apiKey;
  const response = await axios.get(apiUrl, { params, headers });
  const rows = Array.isArray(response.data?.results) ? response.data.results : [];
  return rows
    .filter((r) => r?.media_type === 'movie' || r?.media_type === 'tv')
    .map((r) => normalizeTmdbSearchResult(r, r?.media_type === 'tv' ? 'tv' : 'movie'));
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
  const castList = Array.isArray(details.credits?.cast) ? details.credits.cast : [];
  const director =
    crew.find((p) => p.job === 'Director')?.name ||
    crew.find((p) => p.department === 'Directing')?.name ||
    '';
  const cast = castList
    .slice(0, 8)
    .map((p) => String(p?.name || '').trim())
    .filter(Boolean)
    .join(', ');

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
    cast: cast || null,
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

const fetchTmdbTvShowSeasonSummary = async (tvId, integrationConfig = null) => {
  if (!tvId) return [];
  const apiKey = integrationConfig?.tmdbApiKey || process.env.TMDB_API_KEY || '';
  const apiKeyQueryParam = integrationConfig?.tmdbApiKeyQueryParam || 'api_key';
  const apiKeyHeader = integrationConfig?.tmdbApiKeyHeader || '';
  const apiBaseUrl = tmdbBaseUrlFromSearchUrl(integrationConfig?.tmdbApiUrl);
  if (!apiKey) {
    throw Object.assign(new Error('TMDB API key is not configured'), { status: 400 });
  }
  const params = {};
  const headers = {};
  if (apiKeyHeader) headers[apiKeyHeader] = apiKey;
  else params[apiKeyQueryParam] = apiKey;
  const response = await axios.get(`${apiBaseUrl}/tv/${tvId}`, { params, headers });
  const seasons = Array.isArray(response.data?.seasons) ? response.data.seasons : [];
  return seasons
    .map((season) => {
      const rawEpisodeCount = season?.episode_count;
      const parsedEpisodeCount = rawEpisodeCount === null || rawEpisodeCount === undefined || rawEpisodeCount === ''
        ? null
        : Number(rawEpisodeCount);
      return {
        season_number: Number(season?.season_number),
        name: season?.name || null,
        air_date: season?.air_date || null,
        overview: season?.overview || null,
        poster_path: season?.poster_path || null,
        episode_count: Number.isInteger(parsedEpisodeCount) && parsedEpisodeCount >= 0 ? parsedEpisodeCount : null
      };
    })
    .filter((season) => Number.isInteger(season.season_number) && season.season_number > 0);
};

const fetchTmdbTvSeasonDetails = async (tvId, seasonNumber, integrationConfig = null) => {
  if (!tvId || !seasonNumber) return {};
  const apiKey = integrationConfig?.tmdbApiKey || process.env.TMDB_API_KEY || '';
  const apiKeyQueryParam = integrationConfig?.tmdbApiKeyQueryParam || 'api_key';
  const apiKeyHeader = integrationConfig?.tmdbApiKeyHeader || '';
  const apiBaseUrl = tmdbBaseUrlFromSearchUrl(integrationConfig?.tmdbApiUrl);
  if (!apiKey) {
    throw Object.assign(new Error('TMDB API key is not configured'), { status: 400 });
  }
  const params = {};
  const headers = {};
  if (apiKeyHeader) headers[apiKeyHeader] = apiKey;
  else params[apiKeyQueryParam] = apiKey;
  const response = await axios.get(`${apiBaseUrl}/tv/${tvId}/season/${seasonNumber}`, { params, headers });
  const details = response.data || {};
  const episodes = Array.isArray(details.episodes) ? details.episodes : [];
  const rawEpisodeCount = details?.episode_count;
  const parsedEpisodeCount = rawEpisodeCount === null || rawEpisodeCount === undefined || rawEpisodeCount === ''
    ? null
    : Number(rawEpisodeCount);
  return {
    id: details.id || null,
    season_number: Number.isFinite(Number(details.season_number)) ? Number(details.season_number) : null,
    name: details.name || null,
    overview: details.overview || null,
    air_date: details.air_date || null,
    poster_path: details.poster_path || null,
    episode_count: Number.isInteger(parsedEpisodeCount) && parsedEpisodeCount >= 0 ? parsedEpisodeCount : null,
    episodes: episodes
      .map((episode) => ({
        id: episode?.id || null,
        episode_number: Number.isFinite(Number(episode?.episode_number)) ? Number(episode.episode_number) : null,
        name: episode?.name || null,
        air_date: episode?.air_date || null,
        runtime: Number.isFinite(Number(episode?.runtime)) ? Number(episode.runtime) : null,
        overview: episode?.overview || null,
        still_path: episode?.still_path || null,
        vote_average: Number.isFinite(Number(episode?.vote_average)) ? Number(episode.vote_average) : null
      }))
      .filter((episode) => Number.isInteger(episode.episode_number) && episode.episode_number > 0)
      .sort((a, b) => a.episode_number - b.episode_number)
  };
};

module.exports = {
  TMDB_PRESETS,
  TMDB_GENRE_MAP,
  resolveTmdbPreset,
  normalizeTmdbSearchResult,
  searchTmdbMovie,
  searchTmdbMulti,
  fetchTmdbMovieDetails,
  fetchTmdbTvShowSeasonSummary,
  fetchTmdbTvSeasonDetails
};
