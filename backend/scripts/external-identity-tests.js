'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProviderAdapterRegistry, identityNormalizers } = require('../services/providerAdapterRegistry');
const { publicConnection } = require('../services/providerConnections');
const { publicIdentity } = require('../services/externalMediaIdentities');

function adapter() {
  return {
    validateSettings(settings) {
      if (!['safe', 'fast'].includes(settings.mode)) throw new Error('mode is invalid');
      return { mode: settings.mode };
    },
    validateCredentials(credentials) {
      if (typeof credentials.token !== 'string' || credentials.token.length < 8) throw new Error('token is invalid');
      return { token: credentials.token };
    },
    normalizeExternalId(kind, raw, normalizers) {
      if (kind === 'book') return normalizers.numeric(raw);
      if (kind === 'slug') return normalizers.caseInsensitive(raw);
      if (kind === 'uri') return normalizers.uri(raw);
      return normalizers.exact(raw);
    }
  };
}

test('provider adapters own settings, credentials, and identity normalization', () => {
  const registry = createProviderAdapterRegistry({ fixture: adapter() });
  assert.deepEqual(registry.validateSettings('FIXTURE', { mode: 'safe', ignored: true }), {
    providerType: 'fixture', settings: { mode: 'safe' }
  });
  assert.throws(() => registry.validateSettings('fixture', { mode: 'unknown' }), /mode is invalid/);
  assert.deepEqual(registry.validateCredentials('fixture', { token: '12345678' }).credentials, { token: '12345678' });
  assert.throws(() => registry.validateCredentials('fixture', { token: 'short' }), /token is invalid/);
  assert.equal(registry.normalizeExternalId('fixture', 'book', ' 00042 ').normalizedExternalId, '42');
  assert.equal(registry.normalizeExternalId('fixture', 'slug', ' Mixed-Case ').normalizedExternalId, 'mixed-case');
  assert.equal(registry.normalizeExternalId('fixture', 'record', ' Mixed-Case ').normalizedExternalId, 'Mixed-Case');
});

test('URI identity normalization preserves provider semantics while removing unsafe variation', () => {
  assert.equal(identityNormalizers.uri(' URN:BookOrbit:book:42 '), 'urn:bookorbit:book:42');
  assert.equal(identityNormalizers.uri('HTTPS://Example.COM:443/books/42#fragment'), 'https://example.com/books/42');
  assert.throws(() => identityNormalizers.uri('https://user:pass@example.com/book/42'), /without credentials/);
});

test('public provider connection projection never includes credential storage fields', () => {
  const projected = publicConnection({
    id: 'connection', space_id: 7, provider_type: 'fixture', display_name: 'Fixture',
    endpoint_url: 'https://example.com', status: 'active', settings: { mode: 'safe' },
    secret_payload_encrypted: 'must-not-leak', credential_reference: 'must-not-leak'
  });
  assert.equal(projected.id, 'connection');
  assert.equal(projected.secret_payload_encrypted, undefined);
  assert.equal(projected.credential_reference, undefined);
});

test('public external identity projection preserves raw identity and omits comparison internals', () => {
  const projected = publicIdentity({
    id: 'identity', space_id: 7, provider_connection_id: 'connection', identity_kind: 'book',
    external_id_raw: '00042', external_id_normalized: '42', media_id: 9, active: true
  });
  assert.equal(projected.externalId, '00042');
  assert.equal(projected.external_id_normalized, undefined);
});
