'use strict';

const { createProviderAdapterRegistry } = require('./providerAdapterRegistry');
const {
  buildDigitalLibraryCanonicalFields,
  buildDigitalLibraryCompatibility
} = require('./digitalLibraryIdentityPayload');

const BOOKORBIT_IDENTITY_KIND = 'book';

const bookOrbitAdapter = Object.freeze({
  validateSettings(settings) {
    const catalogPath = String(settings?.catalogPath || '/api/v1/opds').trim();
    if (!catalogPath.startsWith('/') || catalogPath.length > 512) {
      throw new TypeError('BookOrbit catalog path is invalid');
    }
    const timeoutMs = Number(settings?.timeoutMs ?? 20000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
      throw new TypeError('BookOrbit timeout is invalid');
    }
    const maxPages = Number(settings?.maxPages ?? 100);
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) {
      throw new TypeError('BookOrbit page limit is invalid');
    }
    return { catalogPath, timeoutMs, maxPages };
  },
  validateCredentials(credentials) {
    const username = String(credentials?.username || '').trim();
    const password = String(credentials?.password || '');
    if (!username || username.length > 255) throw new TypeError('BookOrbit OPDS username is invalid');
    if (!password || password.length > 2048) throw new TypeError('BookOrbit OPDS password is invalid');
    return { username, password };
  },
  normalizeExternalId(kind, raw, normalizers) {
    if (kind !== BOOKORBIT_IDENTITY_KIND) throw new TypeError(`BookOrbit identity kind ${kind} is not supported`);
    const value = normalizers.exact(raw);
    if (!/^urn:bookorbit:book:\d+$/i.test(value)) throw new TypeError('BookOrbit identity must use its Atom entry id');
    return value;
  }
});

function buildBookOrbitCanonicalFields(item = {}) {
  return buildDigitalLibraryCanonicalFields(item, {
    mediaKeys: ['title', 'release_date', 'year', 'format', 'overview', 'poster_path'],
    typeDetailKeys: [
      'author', 'isbn', 'publisher', 'series', 'series_index',
      'provider_download_url', 'provider_series_url', 'source_updated_at'
    ]
  });
}

function buildBookOrbitCompatibility(externalId) {
  return buildDigitalLibraryCompatibility({ providerName: 'bookorbit', externalId });
}

function createBookOrbitAdapterRegistry() {
  return createProviderAdapterRegistry({ bookorbit: bookOrbitAdapter });
}

module.exports = {
  BOOKORBIT_IDENTITY_KIND,
  bookOrbitAdapter,
  buildBookOrbitCanonicalFields,
  buildBookOrbitCompatibility,
  createBookOrbitAdapterRegistry
};
