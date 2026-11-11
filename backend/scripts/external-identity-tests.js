'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProviderAdapterRegistry, identityNormalizers } = require('../services/providerAdapterRegistry');
const { publicConnection } = require('../services/providerConnections');
const {
  CWA_INTEGRATION_KEY,
  METRON_INTEGRATION_KEY,
  PLEX_INTEGRATION_KEY,
  createProviderIntegrationBindingService
} = require('../services/providerIntegrationBindings');
const {
  buildMetronCanonicalFields,
  buildMetronCompatibility,
  createMetronAdapterRegistry
} = require('../services/metronIdentity');
const {
  buildCwaCanonicalFields,
  buildCwaCompatibility,
  createCwaAdapterRegistry
} = require('../services/cwaIdentity');
const {
  buildPlexCanonicalFields,
  buildPlexCompatibility,
  createPlexAdapterRegistry,
  selectPlexIdentity
} = require('../services/plexIdentity');
const {
  MINIMUM_OBSERVATION_HOURS,
  evaluateProviderIdentityCutover,
  normalizeProviderIdentityLabel
} = require('../services/providerIdentityCompatibilityDiagnostics');
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
const {
  createProviderIdentityBackfill,
  publicClaim,
  publicDiagnostic
} = require('../services/providerIdentityBackfill');
const {
  normalizeControl,
  decideProviderFieldUpdate
} = require('../services/canonicalMediaFieldControls');
const {
  recordProviderIdentityCompatibilityEvent,
  getMetricCounterValue
} = require('../services/metrics');

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

test('Metron integration binding creates one stable connection through the caller transaction', async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}] };
      if (sql.includes('FROM provider_integration_bindings b')) return { rows: [] };
      if (sql.includes('INSERT INTO provider_connections')) {
        return { rows: [{ id: 'connection-1', provider_type: params[1], status: 'active', endpoint_url: params[3] }] };
      }
      if (sql.includes('INSERT INTO provider_integration_bindings')) {
        return { rows: [{ space_id: params[0], integration_key: params[1], provider_connection_id: params[2] }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const service = createProviderIntegrationBindingService({ pool: {} });
  const binding = await service.ensureMetronBinding({
    spaceId: 7,
    actorId: 9,
    endpointUrl: 'https://metron.example/api/'
  }, client);
  assert.deepEqual(binding, {
    spaceId: 7,
    integrationKey: METRON_INTEGRATION_KEY,
    providerConnectionId: 'connection-1',
    providerType: 'metron',
    status: 'active',
    endpointUrl: 'https://metron.example/api'
  });
  assert.equal(queries.length, 4);
});

test('Metron integration binding preserves lifecycle decisions instead of silently reactivating', async () => {
  const service = createProviderIntegrationBindingService({ pool: {} });
  const client = {
    async query(sql) {
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}] };
      return { rows: [{
        space_id: 7,
        integration_key: METRON_INTEGRATION_KEY,
        provider_connection_id: 'connection-1',
        provider_type: 'metron',
        status: 'disabled',
        endpoint_url: 'https://metron.example/api'
      }] };
    }
  };
  await assert.rejects(
    service.ensureMetronBinding({ spaceId: 7, actorId: 9, endpointUrl: 'https://metron.example/api' }, client),
    (error) => error.code === 'PROVIDER_CONNECTION_INACTIVE' && error.status === 409
  );
});

test('CWA integration binding creates one stable OPDS connection through the caller transaction', async () => {
  const client = {
    async query(sql, params) {
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}] };
      if (sql.includes('FROM provider_integration_bindings b')) return { rows: [] };
      if (sql.includes('INSERT INTO provider_connections')) {
        return { rows: [{ id: 'cwa-connection', provider_type: params[1], status: 'active', endpoint_url: params[3] }] };
      }
      if (sql.includes('INSERT INTO provider_integration_bindings')) {
        return { rows: [{ space_id: params[0], integration_key: params[1], provider_connection_id: params[2] }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const binding = await createProviderIntegrationBindingService({ pool: {} }).ensureCwaBinding({
    spaceId: 7,
    actorId: 9,
    endpointUrl: 'https://cwa.example/opds/'
  }, client);
  assert.deepEqual(binding, {
    spaceId: 7,
    integrationKey: CWA_INTEGRATION_KEY,
    providerConnectionId: 'cwa-connection',
    providerType: 'cwa',
    status: 'active',
    endpointUrl: 'https://cwa.example/opds'
  });
});

test('Plex integration binding creates one stable server connection through the caller transaction', async () => {
  const client = {
    async query(sql, params) {
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}] };
      if (sql.includes('FROM provider_integration_bindings b')) return { rows: [] };
      if (sql.includes('INSERT INTO provider_connections')) {
        return { rows: [{ id: 'plex-connection', provider_type: params[1], status: 'active', endpoint_url: params[3] }] };
      }
      if (sql.includes('INSERT INTO provider_integration_bindings')) {
        return { rows: [{ space_id: params[0], integration_key: params[1], provider_connection_id: params[2] }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const binding = await createProviderIntegrationBindingService({ pool: {} }).ensurePlexBinding({
    spaceId: 7,
    actorId: 9,
    endpointUrl: 'https://plex.example:32400/'
  }, client);
  assert.deepEqual(binding, {
    spaceId: 7,
    integrationKey: PLEX_INTEGRATION_KEY,
    providerConnectionId: 'plex-connection',
    providerType: 'plex',
    status: 'active',
    endpointUrl: 'https://plex.example:32400'
  });
});

test('Metron adapter owns numeric issue identity and bounded canonical projections', () => {
  const registry = createMetronAdapterRegistry();
  assert.equal(registry.normalizeExternalId('metron', 'issue', '00042').normalizedExternalId, '42');
  assert.throws(() => registry.normalizeExternalId('metron', 'issue', 'issue-42'), /digits only/);
  assert.deepEqual(buildMetronCompatibility('42'), {
    typeDetails: { provider_name: 'metron', provider_issue_id: '42' },
    metadata: { provider_issue_id: '42', metron_issue_id: '42' }
  });
  const canonical = buildMetronCanonicalFields({
    title: 'Alpha Flight #11',
    year: 1984,
    upc: '012345678905',
    type_details: { series: 'Alpha Flight', issue_number: '11', provider_issue_id: '42' }
  });
  assert.deepEqual(canonical, {
    'media.title': 'Alpha Flight #11',
    'media.year': 1984,
    'media.upc': '012345678905',
    'type_details.series': 'Alpha Flight',
    'type_details.issue_number': '11'
  });
  assert.equal(Object.values(canonical).includes('42'), false);
});

test('CWA adapter preserves exact OPDS entry identity and bounded canonical projections', () => {
  const registry = createCwaAdapterRegistry();
  assert.equal(registry.normalizeExternalId('cwa', 'book', ' urn:uuid:Book-42 ').normalizedExternalId, 'urn:uuid:Book-42');
  assert.deepEqual(buildCwaCompatibility('urn:uuid:Book-42'), {
    typeDetails: {
      provider_name: 'cwa_opds',
      provider_item_id: 'urn:uuid:Book-42',
      calibre_entry_id: 'urn:uuid:Book-42'
    },
    metadata: {
      provider_item_id: 'urn:uuid:Book-42',
      calibre_entry_id: 'urn:uuid:Book-42'
    }
  });
  assert.deepEqual(buildCwaCanonicalFields({
    title: 'Example Book',
    media_type: 'book',
    year: 2026,
    type_details: { author: 'Example Author', isbn: '9781234567890', provider_item_id: 'urn:uuid:Book-42' }
  }), {
    'media.title': 'Example Book',
    'media.year': 2026,
    'type_details.author': 'Example Author',
    'type_details.isbn': '9781234567890'
  });
});

test('Plex adapter prefers GUID identity and keeps compatibility projections identity-exact', () => {
  const registry = createPlexAdapterRegistry();
  assert.deepEqual(selectPlexIdentity({ plexGuid: ' plex://movie/42 ', plexItemKey: '1:42' }), {
    identityKind: 'guid', externalId: 'plex://movie/42'
  });
  assert.deepEqual(selectPlexIdentity({ plexItemKey: '1:42' }), {
    identityKind: 'item', externalId: '1:42'
  });
  assert.equal(registry.normalizeExternalId('plex', 'guid', ' plex://movie/42 ').normalizedExternalId, 'plex://movie/42');
  assert.deepEqual(buildPlexCompatibility('guid', 'plex://movie/42'), {
    metadata: { plex_guid: 'plex://movie/42' }
  });
  assert.deepEqual(buildPlexCompatibility('item', '1:42'), {
    metadata: { plex_item_key: '1:42' }
  });
  assert.deepEqual(buildPlexCanonicalFields({
    title: 'Example Album',
    media_type: 'audio',
    year: 2026,
    plex_guid: 'plex://album/42',
    type_details: { artist: 'Example Artist', album: 'Example Album', track_count: 12 }
  }), {
    'media.title': 'Example Album',
    'media.year': 2026,
    'type_details.artist': 'Example Artist',
    'type_details.album': 'Example Album',
    'type_details.track_count': 12
  });
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

test('provider identity compatibility telemetry is bounded and contains no external ids', () => {
  recordProviderIdentityCompatibilityEvent('metron', 'legacy_read_provider_issue', 'matched');
  recordProviderIdentityCompatibilityEvent('untrusted-provider:book:42', 'legacy_write', 'created');
  assert.equal(getMetricCounterValue('providerIdentityCompatibility', {
    provider: 'metron', operation: 'legacy_read_provider_issue', outcome: 'matched'
  }), 1);
  assert.equal(getMetricCounterValue('providerIdentityCompatibility', {
    provider: 'unknown', operation: 'legacy_write', outcome: 'created'
  }), 1);
  recordProviderIdentityCompatibilityEvent('csv_generic', 'legacy_write', 'updated');
  recordProviderIdentityCompatibilityEvent('barcode_scanner', 'legacy_read_provider_item', 'missed');
  assert.equal(getMetricCounterValue('providerIdentityCompatibility', {
    provider: 'generic', operation: 'legacy_write', outcome: 'updated'
  }), 1);
  assert.equal(getMetricCounterValue('providerIdentityCompatibility', {
    provider: 'scanner', operation: 'legacy_read_provider_item', outcome: 'missed'
  }), 1);
});

test('provider identity cutover diagnostics require durable quiet-window, repeat-sync, and inventory evidence', () => {
  assert.equal(MINIMUM_OBSERVATION_HOURS, 168);
  assert.equal(normalizeProviderIdentityLabel('plex_webhook'), 'plex');
  const ready = evaluateProviderIdentityCutover({
    provider: 'metron',
    observationWindowHours: 168,
    completedSuccessfulSyncs: 2,
    samples: [
      { operation: 'authoritative_projection', outcome: 'written', increase: 4 },
      { operation: 'authoritative_projection', outcome: 'aligned', increase: 8 }
    ],
    inventory: { legacyOnly: 0, ambiguous: 0, conflicts: 0, unboundConnections: 0 }
  });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.blockers, []);

  const blocked = evaluateProviderIdentityCutover({
    provider: 'plex',
    observationWindowHours: 167,
    completedSuccessfulSyncs: 1,
    samples: [
      { operation: 'legacy_read_plex_guid', outcome: 'missed', increase: 3 },
      { operation: 'authoritative_projection', outcome: 'conflict', increase: 1 }
    ],
    inventory: { legacyOnly: 2, ambiguous: 1, conflicts: 0, unboundConnections: 0 }
  });
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.blockers, [
    'observation_window_short',
    'successful_sync_evidence_insufficient',
    'legacy_reads_observed',
    'projection_conflicts_observed',
    'authoritative_projection_unobserved',
    'repeat_alignment_unobserved',
    'legacy_only_inventory_remaining',
    'ambiguous_inventory_remaining'
  ]);
});

test('canonical field precedence preserves uncontrolled, manual, reviewed, and locked values by default', () => {
  assert.deepEqual(decideProviderFieldUpdate({
    currentValue: null,
    proposedValue: 'Provider value',
    providerConnectionId: 'provider-a'
  }), { action: 'fill', reason: 'canonical_value_missing' });
  assert.deepEqual(decideProviderFieldUpdate({
    currentValue: 'Existing value',
    proposedValue: 'Provider value',
    providerConnectionId: 'provider-a'
  }), { action: 'skip', reason: 'uncontrolled_existing_value' });
  assert.equal(decideProviderFieldUpdate({
    currentValue: 'Manual value',
    proposedValue: 'Provider value',
    providerConnectionId: 'provider-a',
    control: { authority: 'manual', provider_write_mode: 'preserve', locked: false }
  }).reason, 'manual_preserved');
  assert.equal(decideProviderFieldUpdate({
    currentValue: 'Locked value',
    proposedValue: 'Provider value',
    providerConnectionId: 'provider-a',
    control: { authority: 'provider', provider_write_mode: 'preserve', locked: true,
      source_provider_connection_id: 'provider-a' }
  }).reason, 'locked');
  assert.equal(decideProviderFieldUpdate({
    currentValue: 'Reviewed value',
    proposedValue: 'Provider refresh',
    providerConnectionId: 'provider-a',
    control: { authority: 'reviewed', provider_write_mode: 'refresh', locked: false,
      source_provider_connection_id: 'provider-a' }
  }).action, 'refresh');
});

test('canonical field controls require explicit compatible provider refresh authority', () => {
  assert.deepEqual(normalizeControl({
    authority: 'reviewed',
    providerWriteMode: 'refresh',
    providerConnectionId: 'provider-a'
  }), {
    authority: 'reviewed',
    providerWriteMode: 'refresh',
    locked: false,
    providerConnectionId: 'provider-a'
  });
  assert.throws(() => normalizeControl({
    authority: 'manual',
    providerWriteMode: 'refresh',
    providerConnectionId: 'provider-a'
  }), /requires an unlocked provider or reviewed authority/);
  assert.throws(() => normalizeControl({
    authority: 'reviewed',
    providerWriteMode: 'refresh',
    providerConnectionId: 'provider-a',
    locked: true
  }), /requires an unlocked provider or reviewed authority/);
  assert.equal(decideProviderFieldUpdate({
    currentValue: 'Provider A value',
    proposedValue: 'Provider B value',
    providerConnectionId: 'provider-b',
    control: { authority: 'provider', provider_write_mode: 'refresh', locked: false,
      source_provider_connection_id: 'provider-a' }
  }).reason, 'different_provider_preserved');
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

function backfillAction(overrides = {}) {
  return {
    mediaId: 10,
    spaceId: 7,
    libraryId: 3,
    providerType: 'cwa',
    identityKind: 'book',
    providerConnectionId: 'cwa-a',
    externalId: 'book:42',
    normalizedExternalId: 'book:42',
    externalIdFingerprint: 'fingerprint-42',
    evidenceKeys: ['typeDetails.provider_item_id'],
    ...overrides
  };
}

function backfillHarness(plans) {
  const attached = [];
  let transactions = 0;
  let planIndex = 0;
  const identityService = {
    async transaction(scope, work) {
      transactions += 1;
      assert.deepEqual(scope, { spaceId: 7, actorId: 9 });
      return work({
        client: { query: async () => { throw new Error('planner owns queries'); } },
        identities: {
          async attach(input) {
            attached.push(input);
            if (input.externalId === 'fail') throw new Error('attach failed');
            return { id: 'identity' };
          }
        }
      });
    }
  };
  const planner = {
    async planWorkspace(_client, spaceId) {
      assert.equal(spaceId, 7);
      return plans[Math.min(planIndex++, plans.length - 1)];
    }
  };
  return {
    backfill: createProviderIdentityBackfill({ identityService, planner }),
    attached,
    transactionCount: () => transactions
  };
}

test('backfill plan is transaction-scoped and redacts raw identity values', async () => {
  const action = backfillAction();
  const diagnostic = { ...action, code: 'external_identity_target_conflict', normalizedExternalId: 'book:42' };
  const harness = backfillHarness([{
    actions: [action],
    aligned: [],
    diagnostics: [diagnostic],
    summary: { scannedRows: 1, eligible: 1, aligned: 0, reviewRequired: 1, diagnosticCounts: { external_identity_target_conflict: 1 } }
  }]);
  const result = await harness.backfill.run({ spaceId: 7, actorId: 9 });
  assert.equal(result.mode, 'plan');
  assert.equal(result.summary.planned, 1);
  assert.equal(result.summary.applied, 0);
  assert.equal(harness.attached.length, 0);
  assert.equal(harness.transactionCount(), 1);
  assert.equal(JSON.stringify(result).includes('book:42'), false);
  assert.deepEqual(result.candidates[0], publicClaim(action));
  assert.deepEqual(result.diagnostics[0], publicDiagnostic(diagnostic));
});

test('backfill apply attaches every eligible identity atomically and reruns idempotently', async () => {
  const action = backfillAction();
  const harness = backfillHarness([{
    actions: [action], aligned: [], diagnostics: [],
    summary: { scannedRows: 1, eligible: 1, aligned: 0, reviewRequired: 0, diagnosticCounts: {} }
  }, {
    actions: [], aligned: [action], diagnostics: [],
    summary: { scannedRows: 1, eligible: 0, aligned: 1, reviewRequired: 0, diagnosticCounts: {} }
  }]);
  const first = await harness.backfill.run({ spaceId: 7, actorId: 9, mode: 'apply' });
  assert.equal(first.summary.applied, 1);
  assert.deepEqual(harness.attached[0], {
    connectionId: 'cwa-a', identityKind: 'book', externalId: 'book:42', mediaId: 10
  });
  assert.equal(JSON.stringify(first).includes('book:42'), false);

  const second = await harness.backfill.run({ spaceId: 7, actorId: 9, mode: 'apply' });
  assert.equal(second.summary.applied, 0);
  assert.equal(second.summary.aligned, 1);
  assert.equal(harness.attached.length, 1);
  assert.equal(harness.transactionCount(), 2);
});

test('backfill apply propagates attachment conflicts so the transaction can roll back', async () => {
  const harness = backfillHarness([{
    actions: [backfillAction({ externalId: 'fail' })], aligned: [], diagnostics: [],
    summary: { scannedRows: 1, eligible: 1, aligned: 0, reviewRequired: 0, diagnosticCounts: {} }
  }]);
  await assert.rejects(
    harness.backfill.run({ spaceId: 7, actorId: 9, mode: 'apply' }),
    /attach failed/
  );
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
