const axios = require('axios');

const BOOKS_PRESETS = {
  googlebooks: {
    preset: 'googlebooks',
    provider: 'googlebooks',
    apiUrl: 'https://www.googleapis.com/books/v1/volumes',
    apiKeyHeader: '',
    apiKeyQueryParam: 'key'
  },
  custom: {
    preset: 'custom',
    provider: 'custom',
    apiUrl: '',
    apiKeyHeader: '',
    apiKeyQueryParam: 'key'
  }
};

function resolveBooksPreset(preset) {
  const key = String(preset || 'googlebooks').trim().toLowerCase();
  return BOOKS_PRESETS[key] || BOOKS_PRESETS.googlebooks;
}

function mapGoogleBooksItem(item = {}) {
  const info = item.volumeInfo || {};
  const imageLinks = info.imageLinks || {};
  const normalizedPublished = normalizePublishedDate(info.publishedDate);
  return {
    id: String(item.id || ''),
    title: info.title || '',
    year: normalizedPublished.year,
    release_date: normalizedPublished.release_date,
    overview: info.description || null,
    genre: Array.isArray(info.categories) ? info.categories.join(', ') : null,
    external_url: info.infoLink || null,
    poster_path: imageLinks.thumbnail || imageLinks.smallThumbnail || null,
    type_details: {
      author: Array.isArray(info.authors) ? info.authors.join(', ') : null,
      publisher: info.publisher || null,
      isbn: Array.isArray(info.industryIdentifiers)
        ? (info.industryIdentifiers.find((x) => x.type === 'ISBN_13')?.identifier
          || info.industryIdentifiers.find((x) => x.type === 'ISBN_10')?.identifier
          || null)
        : null,
      edition: null
    }
  };
}

function normalizePublishedDate(raw) {
  const value = String(raw || '').trim();
  if (!value) return { year: null, release_date: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    return { year: Number.isFinite(year) ? year : null, release_date: value };
  }
  if (/^\d{4}-\d{2}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    return { year: Number.isFinite(year) ? year : null, release_date: `${value}-01` };
  }
  if (/^\d{4}$/.test(value)) {
    const year = Number(value);
    return { year: Number.isFinite(year) ? year : null, release_date: `${value}-01-01` };
  }
  const yearMatch = value.match(/\b(18|19|20)\d{2}\b/);
  if (!yearMatch) return { year: null, release_date: null };
  const year = Number(yearMatch[0]);
  return { year: Number.isFinite(year) ? year : null, release_date: `${yearMatch[0]}-01-01` };
}

async function searchBooksByTitle(title, config = {}, limit = 10, author = '') {
  const query = String(title || '').trim();
  if (!query) return [];
  const authorQuery = String(author || '').trim();

  const apiUrl = config.booksApiUrl || BOOKS_PRESETS.googlebooks.apiUrl;
  if (!apiUrl) throw new Error('Books API URL is not configured');

  const headers = {};
  if (config.booksApiKey && config.booksApiKeyHeader) {
    headers[config.booksApiKeyHeader] = config.booksApiKey;
  }

  const qParts = [`intitle:${query}`];
  if (authorQuery) qParts.push(`inauthor:${authorQuery}`);
  const params = {
    q: qParts.join('+'),
    maxResults: Math.max(1, Math.min(Number(limit) || 10, 20))
  };

  if (config.booksApiKey && !config.booksApiKeyHeader) {
    params[config.booksApiKeyQueryParam || 'key'] = config.booksApiKey;
  }

  const response = await axios.get(apiUrl, {
    params,
    headers,
    timeout: 20000,
    validateStatus: () => true
  });

  if (response.status >= 400) {
    const detail = response.data?.error?.message
      || response.data?.message
      || `Provider returned status ${response.status}`;
    const err = new Error(detail);
    err.status = response.status;
    throw err;
  }

  const items = Array.isArray(response.data?.items) ? response.data.items : [];
  return items.map(mapGoogleBooksItem).filter((item) => item.title);
}

async function searchBooksByIsbn(isbn, config = {}, limit = 10) {
  const query = String(isbn || '').trim();
  if (!query) return [];

  const apiUrl = config.booksApiUrl || BOOKS_PRESETS.googlebooks.apiUrl;
  if (!apiUrl) throw new Error('Books API URL is not configured');

  const headers = {};
  if (config.booksApiKey && config.booksApiKeyHeader) {
    headers[config.booksApiKeyHeader] = config.booksApiKey;
  }

  const params = {
    q: `isbn:${query}`,
    maxResults: Math.max(1, Math.min(Number(limit) || 10, 20))
  };

  if (config.booksApiKey && !config.booksApiKeyHeader) {
    params[config.booksApiKeyQueryParam || 'key'] = config.booksApiKey;
  }

  const response = await axios.get(apiUrl, {
    params,
    headers,
    timeout: 20000,
    validateStatus: () => true
  });

  if (response.status >= 400) {
    const detail = response.data?.error?.message
      || response.data?.message
      || `Provider returned status ${response.status}`;
    const err = new Error(detail);
    err.status = response.status;
    throw err;
  }

  const items = Array.isArray(response.data?.items) ? response.data.items : [];
  return items.map(mapGoogleBooksItem).filter((item) => item.title);
}

module.exports = {
  resolveBooksPreset,
  searchBooksByTitle,
  searchBooksByIsbn
};
