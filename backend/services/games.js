const axios = require('axios');
const qs = require('querystring');

const GAMES_PRESETS = {
  igdb: {
    preset: 'igdb',
    provider: 'igdb',
    apiUrl: 'https://api.igdb.com/v4/games',
    apiKeyHeader: 'Authorization',
    apiKeyQueryParam: ''
  },
  custom: {
    preset: 'custom',
    provider: 'custom',
    apiUrl: '',
    apiKeyHeader: 'Authorization',
    apiKeyQueryParam: 'api_key'
  }
};

function resolveGamesPreset(preset) {
  const key = String(preset || 'igdb').trim().toLowerCase();
  return GAMES_PRESETS[key] || GAMES_PRESETS.igdb;
}

function mapIgdbGame(item = {}) {
  const releaseYear = item.first_release_date
    ? Number(new Date(item.first_release_date * 1000).getUTCFullYear())
    : null;
  const releaseDate = item.first_release_date
    ? new Date(item.first_release_date * 1000).toISOString().slice(0, 10)
    : null;
  const devCompany = Array.isArray(item.involved_companies)
    ? item.involved_companies
      .map((x) => x?.company?.name)
      .find(Boolean)
    : null;
  return {
    id: String(item.id || ''),
    title: item.name || '',
    year: Number.isFinite(releaseYear) ? releaseYear : null,
    release_date: releaseDate,
    overview: item.summary || null,
    genre: Array.isArray(item.genres)
      ? item.genres.map((x) => x?.name).filter(Boolean).join(', ')
      : null,
    external_url: item.url || null,
    poster_path: item.cover?.url
      ? item.cover.url.replace('//', 'https://').replace('t_thumb', 't_cover_big')
      : null,
    type_details: {
      platform: Array.isArray(item.platforms)
        ? item.platforms.map((x) => x?.name).filter(Boolean).join(', ')
        : null,
      developer: devCompany,
      region: null
    }
  };
}

async function searchGamesByTitle(title, config = {}, limit = 10) {
  const query = String(title || '').trim();
  if (!query) return [];

  const apiUrl = config.gamesApiUrl || GAMES_PRESETS.igdb.apiUrl;
  if (!apiUrl) throw new Error('Games API URL is not configured');

  const provider = String(config.gamesProvider || 'igdb').toLowerCase();
  if (provider === 'igdb') {
    if (!config.gamesClientId) {
      throw new Error('Games Client ID is required for IGDB');
    }
    const bearer = await resolveIgdbBearerToken(config);

    const headers = {
      'Client-ID': config.gamesClientId,
      Authorization: `Bearer ${bearer}`
    };

    const body = `search "${query.replace(/"/g, '')}"; fields name,first_release_date,summary,genres.name,cover.url,involved_companies.company.name,platforms.name,url; limit ${Math.max(1, Math.min(Number(limit) || 10, 20))};`;

    const response = await axios.post(apiUrl, body, {
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

    const rows = Array.isArray(response.data) ? response.data : [];
    return rows.map(mapIgdbGame).filter((item) => item.title);
  }

  const headers = {};
  if (config.gamesApiKey && config.gamesApiKeyHeader) {
    headers[config.gamesApiKeyHeader] = config.gamesApiKey;
  }
  const params = { q: query, limit };
  if (config.gamesApiKey && !config.gamesApiKeyHeader) {
    params[config.gamesApiKeyQueryParam || 'api_key'] = config.gamesApiKey;
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
    id: String(row.id || ''),
    title: row.title || row.name || '',
    year: row.year || null,
    release_date: row.release_date || null,
    overview: row.overview || row.summary || null,
    genre: row.genre || null,
    external_url: row.url || null,
    poster_path: row.poster_path || row.cover || null,
    type_details: {
      platform: row.platform || null,
      developer: row.developer || null,
      region: row.region || null
    }
  })).filter((item) => item.title);
}

const tokenCache = {
  token: null,
  expiresAt: 0
};

async function resolveIgdbBearerToken(config = {}) {
  if (config.gamesApiKey) {
    return String(config.gamesApiKey).replace(/^Bearer\s+/i, '');
  }
  if (!config.gamesClientId || !config.gamesClientSecret) {
    throw new Error('Games Client ID and Client Secret are required for IGDB');
  }
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 30000) {
    return tokenCache.token;
  }
  const tokenUrl = process.env.TWITCH_TOKEN_URL || 'https://id.twitch.tv/oauth2/token';
  const response = await axios.post(
    tokenUrl,
    qs.stringify({
      client_id: config.gamesClientId,
      client_secret: config.gamesClientSecret,
      grant_type: 'client_credentials'
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 20000,
      validateStatus: () => true
    }
  );
  if (response.status >= 400 || !response.data?.access_token) {
    const detail = response.data?.message || response.data?.error || `Token request failed (${response.status})`;
    const err = new Error(detail);
    err.status = response.status;
    throw err;
  }
  tokenCache.token = String(response.data.access_token);
  tokenCache.expiresAt = now + Math.max(60, Number(response.data.expires_in || 3600)) * 1000;
  return tokenCache.token;
}

module.exports = {
  resolveGamesPreset,
  searchGamesByTitle
};
