'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProviderAdapterRegistry, identityNormalizers } = require('../services/providerAdapterRegistry');
const { publicConnection } = require('../services/providerConnections');
const {
  createExternalMediaIdentityService,
  publicIdentity,
  reassignMediaIdentitiesForMerge,
  restoreMediaIdentitiesFromMerge
} = require('../services/externalMediaIdentities');
const {
  normalizeCompatibilityProjection,
  compareProjection
} = require('../services/providerIdentityCompatibility');
const {
  extractLegacyClaims,
  createProviderIdentityBackfillPlanner
} = require('../services/providerIdentityBackfillPlanner');

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

test('external identity service exposes one authorized transaction composition boundary', async () => {
  const registry = createProviderAdapterRegistry({ fixture: adapter() });
  const service = createExternalMediaIdentityService({
    pool: { connect: async () => { throw new Error('must not acquire'); } },
    adapterRegistry: registry
  });
  assert.equal(typeof service.transaction, 'function');
  await assert.rejects(
    service.transaction({ spaceId: 0, actorId: 9 }, async () => {}),
    (error) => error.code === 'INVALID_EXTERNAL_IDENTITY_INPUT'
  );
});

test('compatibility projection accepts only exact authoritative identity values', () => {
  assert.deepEqual(normalizeCompatibilityProjection({
    typeDetails: { provider_name: 'fixture', provider_item_id: 'book:42' },
    metadata: { provider_item_id: 'book:42' }
  }, 'book:42'), {
    typeDetails: { provider_name: 'fixture', provider_item_id: 'book:42' },
    metadata: { provider_item_id: 'book:42' }
  });
  assert.throws(() => normalizeCompatibilityProjection({
    typeDetails: { provider_item_id: 'book:other' }
  }, 'book:42'), /project the authoritative external id exactly/);
  assert.throws(() => normalizeCompatibilityProjection({
    typeDetails: { title: 'not-an-identity-field' }
  }, 'book:42'), /is not supported/);
});

test('compatibility comparison fills missing fields and reports conflicting legacy values', () => {
  const comparison = compareProjection(
    { provider_name: 'fixture', provider_item_id: 'book:old' },
    {},
    {
      typeDetails: { provider_name: 'fixture', provider_item_id: 'book:42' },
      metadata: { provider_item_id: 'book:42' }
    }
  );
  assert.deepEqual(comparison.aligned, [{ storage: 'type_details', key: 'provider_name' }]);
  assert.deepEqual(comparison.missingMetadata, { provider_item_id: 'book:42' });
  assert.deepEqual(comparison.conflicts.map(({ storage, key }) => ({ storage, key })), [
    { storage: 'type_details', key: 'provider_item_id' }
  ]);
});

test('legacy identity extraction rejects conflicting values and preserves provider-specific kinds', () => {
  const conflict = extractLegacyClaims({
    id: 10,
    space_id: 7,
    type_details: { provider_name: 'cwa_opds', provider_item_id: 'book:42', calibre_entry_id: 'book:99' }
  });
  assert.equal(conflict.claims.length, 0);
  assert.equal(conflict.diagnostics[0].code, 'legacy_identity_values_conflict');

  const kavita = extractLegacyClaims({
    id: 11,
    space_id: 7,
    type_details: {
      provider_name: 'kavita',
      provider_item_id: 'kavita:chapter:42',
      provider_issue_id: 'kavita:chapter:42',
      kavita_chapter_provider_item_id: 'kavita:chapter:42',
      kavita_series_provider_item_id: 'kavita:series:4'
    }
  });
  assert.equal(kavita.claims[0].providerType, 'kavita');
  assert.equal(kavita.claims[0].identityKind, 'chapter');
  assert.equal(kavita.claims[0].externalId, 'kavita:chapter:42');
});

test('backfill planner only emits actions for one exact active provider connection', () => {
  const exactAdapter = {
    validateSettings: (value) => value,
    validateCredentials: (value) => value,
    normalizeExternalId: (_kind, raw, normalizers) => normalizers.exact(raw)
  };
  const registry = createProviderAdapterRegistry({ cwa: exactAdapter });
  const planner = createProviderIdentityBackfillPlanner({ adapterRegistry: registry });
  const row = {
    id: 10,
    space_id: 7,
    type_details: { provider_name: 'cwa_opds', provider_item_id: 'book:42', calibre_entry_id: 'book:42' }
  };

  const missing = planner.plan({ mediaRows: [row] });
  assert.equal(missing.summary.eligible, 0);
  assert.equal(missing.diagnostics[0].code, 'provider_connection_missing');
  assert.equal(missing.diagnostics[0].externalId, undefined);

  const ambiguous = planner.plan({
    mediaRows: [row],
    connections: [
      { id: 'cwa-a', space_id: 7, provider_type: 'cwa', status: 'active' },
      { id: 'cwa-b', space_id: 7, provider_type: 'cwa', status: 'active' }
    ]
  });
  assert.equal(ambiguous.diagnostics[0].code, 'provider_connection_ambiguous');

  const eligible = planner.plan({
    mediaRows: [row],
    connections: [{ id: 'cwa-a', space_id: 7, provider_type: 'cwa', status: 'active' }]
  });
  assert.equal(eligible.summary.eligible, 1);
  assert.equal(eligible.actions[0].providerConnectionId, 'cwa-a');
  assert.equal(eligible.actions[0].identityKind, 'book');
});

test('backfill planner reports duplicate candidates, target conflicts, and idempotent alignment', () => {
  const exactAdapter = {
    validateSettings: (value) => value,
    validateCredentials: (value) => value,
    normalizeExternalId: (_kind, raw, normalizers) => normalizers.exact(raw)
  };
  const planner = createProviderIdentityBackfillPlanner({
    adapterRegistry: createProviderAdapterRegistry({ metron: exactAdapter })
  });
  const connection = { id: 'metron-a', space_id: 7, provider_type: 'metron', status: 'active' };
  const mediaRow = (id, externalId = '42') => ({
    id,
    space_id: 7,
    import_source: 'metron',
    type_details: { provider_issue_id: externalId },
    metadata: { metron_issue_id: externalId }
  });

  const duplicate = planner.plan({ mediaRows: [mediaRow(10), mediaRow(11)], connections: [connection] });
  assert.equal(duplicate.summary.eligible, 0);
  assert.deepEqual(duplicate.diagnostics.map(({ code }) => code), [
    'external_identity_multiple_candidates',
    'external_identity_multiple_candidates'
  ]);

  const aligned = planner.plan({
    mediaRows: [mediaRow(10)],
    connections: [connection],
    existingIdentities: [{
      provider_connection_id: 'metron-a', identity_kind: 'issue', external_id_normalized: '42', media_id: 10, active: true
    }]
  });
  assert.equal(aligned.summary.aligned, 1);
  assert.equal(aligned.summary.eligible, 0);

  const conflict = planner.plan({
    mediaRows: [mediaRow(10)],
    connections: [connection],
    existingIdentities: [{
      provider_connection_id: 'metron-a', identity_kind: 'issue', external_id_normalized: '42', media_id: 99, active: true
    }]
  });
  assert.equal(conflict.diagnostics[0].code, 'external_identity_target_conflict');
});

test('backfill planner loads legacy evidence through one authorized workspace client', async () => {
  const exactAdapter = {
    validateSettings: (value) => value,
    validateCredentials: (value) => value,
    normalizeExternalId: (_kind, raw, normalizers) => normalizers.exact(raw)
  };
  const planner = createProviderIdentityBackfillPlanner({
    adapterRegistry: createProviderAdapterRegistry({ cwa: exactAdapter })
  });
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM media m')) return { rows: [{
        id: 10,
        space_id: 7,
        library_id: 3,
        type_details: { provider_name: 'cwa_opds', provider_item_id: 'book:42', calibre_entry_id: 'book:42' },
        metadata: {}
      }] };
      if (sql.includes('FROM provider_connections')) return { rows: [{
        id: 'cwa-a', space_id: 7, provider_type: 'cwa', status: 'active'
      }] };
      if (sql.includes('FROM external_media_identities')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const result = await planner.planWorkspace(client, 7);
  assert.equal(result.summary.eligible, 1);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(({ params }) => params[0] === 7));
});

test('backfill planner fails closed on unavailable adapters and incompatible canonical identities', () => {
  const row = {
    id: 10,
    space_id: 7,
    type_details: { provider_name: 'cwa_opds', provider_item_id: 'book:42', calibre_entry_id: 'book:42' }
  };
  const connection = { id: 'cwa-a', space_id: 7, provider_type: 'cwa', status: 'active' };
  const unavailable = createProviderIdentityBackfillPlanner({
    adapterRegistry: createProviderAdapterRegistry()
  }).plan({ mediaRows: [row], connections: [connection] });
  assert.equal(unavailable.diagnostics[0].code, 'provider_adapter_unavailable');

  const exactAdapter = {
    validateSettings: (value) => value,
    validateCredentials: (value) => value,
    normalizeExternalId: (_kind, raw, normalizers) => normalizers.exact(raw)
  };
  const incompatible = createProviderIdentityBackfillPlanner({
    adapterRegistry: createProviderAdapterRegistry({ cwa: exactAdapter })
  }).plan({
    mediaRows: [row],
    connections: [connection],
    existingIdentities: [{
      provider_connection_id: 'cwa-a', identity_kind: 'book', external_id_normalized: 'book:99', media_id: 10, active: true
    }]
  });
  assert.equal(incompatible.diagnostics[0].code, 'canonical_identity_conflict');
});

function mergeIdentityClient(initialMediaId = 41) {
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    space_id: 7,
    provider_connection_id: '22222222-2222-4222-8222-222222222222',
    identity_kind: 'book',
    external_id_raw: 'book:42',
    media_id: initialMediaId,
    active: true
  };
  const events = [];
  return {
    row,
    events,
    async query(sql, params) {
      if (sql.includes('SELECT * FROM external_media_identities')) {
        const selectedIds = Array.isArray(params[1]) ? params[1] : null;
        const matchesId = !selectedIds || selectedIds.includes(row.id);
        const matchesMedia = selectedIds ? true : Number(params[1]) === Number(row.media_id);
        return { rows: matchesId && matchesMedia ? [{ ...row }] : [] };
      }
      if (sql.includes('UPDATE external_media_identities')) {
        if (Number(row.media_id) !== Number(params[4])) return { rows: [] };
        row.media_id = Number(params[2]);
        return { rows: [{ ...row }] };
      }
      if (sql.includes('INSERT INTO external_media_identity_events')) {
        events.push({ params: [...params], details: JSON.parse(params[6]) });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

test('merge reassignment and revert reuse one transaction client and retain explicit lifecycle reasons', async () => {
  const client = mergeIdentityClient(41);
  const reassigned = await reassignMediaIdentitiesForMerge(client, {
    spaceId: 7,
    actorId: 9,
    fromMediaId: 41,
    toMediaId: 52
  });
  assert.equal(reassigned.length, 1);
  assert.equal(client.row.media_id, 52);
  assert.equal(client.events[0].details.reason, 'canonical_merge');

  const restored = await restoreMediaIdentitiesFromMerge(client, {
    spaceId: 7,
    actorId: 9,
    identityIds: [client.row.id],
    fromMediaId: 52,
    toMediaId: 41
  });
  assert.equal(restored.length, 1);
  assert.equal(client.row.media_id, 41);
  assert.equal(client.events[1].details.reason, 'canonical_merge_revert');
});

test('merge revert refuses to move an identity that changed targets after the merge', async () => {
  const client = mergeIdentityClient(99);
  await assert.rejects(
    restoreMediaIdentitiesFromMerge(client, {
      spaceId: 7,
      actorId: 9,
      identityIds: [client.row.id],
      fromMediaId: 52,
      toMediaId: 41
    }),
    (error) => error.code === 'EXTERNAL_IDENTITY_CONFLICT'
  );
  assert.equal(client.row.media_id, 99);
  assert.equal(client.events.length, 0);
});
