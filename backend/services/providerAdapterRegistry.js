'use strict';

function normalizeProviderType(value) {
  const providerType = String(value || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,79}$/.test(providerType)) {
    const error = new Error('Provider type is invalid');
    error.code = 'INVALID_PROVIDER_TYPE';
    throw error;
  }
  return providerType;
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error(`${label} must be an object`);
    error.code = 'INVALID_PROVIDER_CONFIGURATION';
    throw error;
  }
  return value;
}

function normalizedText(raw) {
  const value = String(raw ?? '').trim();
  if (!value || value.length > 2048) {
    const error = new Error('External identity value is invalid');
    error.code = 'INVALID_EXTERNAL_IDENTITY';
    throw error;
  }
  return value;
}

const identityNormalizers = Object.freeze({
  exact(raw) {
    return normalizedText(raw);
  },
  caseInsensitive(raw) {
    return normalizedText(raw).toLocaleLowerCase('en-US');
  },
  numeric(raw) {
    const value = normalizedText(raw);
    if (!/^\d+$/.test(value)) {
      const error = new Error('Numeric external identity must contain digits only');
      error.code = 'INVALID_EXTERNAL_IDENTITY';
      throw error;
    }
    return BigInt(value).toString(10);
  },
  uri(raw) {
    const value = normalizedText(raw);
    if (/^urn:/i.test(value)) {
      const parts = value.split(':');
      if (parts.length < 3 || !parts[1]) {
        const error = new Error('URN external identity is invalid');
        error.code = 'INVALID_EXTERNAL_IDENTITY';
        throw error;
      }
      return ['urn', parts[1].toLocaleLowerCase('en-US'), ...parts.slice(2)].join(':');
    }
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      const error = new Error('URI external identity is invalid');
      error.code = 'INVALID_EXTERNAL_IDENTITY';
      throw error;
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      const error = new Error('URI external identity must be an HTTP URL without credentials or a URN');
      error.code = 'INVALID_EXTERNAL_IDENTITY';
      throw error;
    }
    parsed.hash = '';
    return parsed.toString();
  }
});

function createProviderAdapterRegistry(initialAdapters = {}) {
  const adapters = new Map();

  function register(providerTypeValue, adapter) {
    const providerType = normalizeProviderType(providerTypeValue);
    if (!adapter || typeof adapter.validateSettings !== 'function' ||
        typeof adapter.validateCredentials !== 'function' ||
        typeof adapter.normalizeExternalId !== 'function') {
      throw new TypeError('Provider adapter must validate settings and credentials and normalize external identities');
    }
    adapters.set(providerType, Object.freeze({ ...adapter }));
    return providerType;
  }

  function get(providerTypeValue) {
    const providerType = normalizeProviderType(providerTypeValue);
    const adapter = adapters.get(providerType);
    if (!adapter) {
      const error = new Error(`Provider adapter is not registered for ${providerType}`);
      error.code = 'PROVIDER_ADAPTER_NOT_REGISTERED';
      throw error;
    }
    return { providerType, adapter };
  }

  function validateSettings(providerTypeValue, settings = {}) {
    const { providerType, adapter } = get(providerTypeValue);
    const normalized = adapter.validateSettings(plainObject(settings, 'Provider settings'));
    return { providerType, settings: plainObject(normalized, 'Validated provider settings') };
  }

  function validateCredentials(providerTypeValue, credentials = {}) {
    const { providerType, adapter } = get(providerTypeValue);
    const normalized = adapter.validateCredentials(plainObject(credentials, 'Provider credentials'));
    return { providerType, credentials: plainObject(normalized, 'Validated provider credentials') };
  }

  function normalizeExternalId(providerTypeValue, identityKind, rawExternalId) {
    const { providerType, adapter } = get(providerTypeValue);
    const kind = String(identityKind || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_.:-]{0,79}$/.test(kind)) {
      const error = new Error('External identity kind is invalid');
      error.code = 'INVALID_EXTERNAL_IDENTITY_KIND';
      throw error;
    }
    const raw = normalizedText(rawExternalId);
    const normalized = normalizedText(adapter.normalizeExternalId(kind, raw, identityNormalizers));
    return { providerType, identityKind: kind, rawExternalId: raw, normalizedExternalId: normalized };
  }

  for (const [providerType, adapter] of Object.entries(initialAdapters)) register(providerType, adapter);
  return Object.freeze({ register, get, validateSettings, validateCredentials, normalizeExternalId });
}

module.exports = { createProviderAdapterRegistry, identityNormalizers, normalizeProviderType };
