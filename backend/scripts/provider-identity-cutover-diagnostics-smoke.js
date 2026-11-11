#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const {
  evaluateProviderIdentityCutover,
  normalizeProviderIdentityLabel
} = require('../services/providerIdentityCompatibilityDiagnostics');

const emptyInventory = {
  legacyOnly: 0,
  ambiguous: 0,
  conflicts: 0,
  unboundConnections: 0
};

const ready = evaluateProviderIdentityCutover({
  provider: 'cwa_opds',
  observationWindowHours: 168,
  completedSuccessfulSyncs: 2,
  samples: [
    { operation: 'authoritative_projection', outcome: 'written', increase: 3 },
    { operation: 'authoritative_projection', outcome: 'aligned', increase: 7 }
  ],
  inventory: emptyInventory
});
assert.equal(ready.provider, 'cwa');
assert.equal(ready.ready, true);
assert.deepEqual(ready.blockers, []);

const blocked = evaluateProviderIdentityCutover({
  provider: 'plex_webhook',
  observationWindowHours: 24,
  completedSuccessfulSyncs: 1,
  samples: [
    { operation: 'legacy_read_plex_guid', outcome: 'missed', increase: 2 },
    { operation: 'legacy_write', outcome: 'updated', increase: 1 },
    { operation: 'authoritative_projection', outcome: 'conflict', increase: 1 }
  ],
  inventory: { ...emptyInventory, legacyOnly: 4, ambiguous: 1 }
});
assert.equal(blocked.provider, 'plex');
assert.equal(blocked.ready, false);
assert.deepEqual(blocked.blockers, [
  'observation_window_short',
  'successful_sync_evidence_insufficient',
  'legacy_reads_observed',
  'legacy_writes_observed',
  'projection_conflicts_observed',
  'authoritative_projection_unobserved',
  'repeat_alignment_unobserved',
  'legacy_only_inventory_remaining',
  'ambiguous_inventory_remaining'
]);
assert.equal(normalizeProviderIdentityLabel('barcode_scanner'), 'scanner');
assert.equal(normalizeProviderIdentityLabel('csv_generic'), 'generic');

const serialized = JSON.stringify({ ready, blocked });
assert.equal(serialized.includes('token'), false);
assert.equal(serialized.includes('endpoint'), false);
assert.equal(serialized.includes('externalId'), false);

console.log(JSON.stringify({
  passed: true,
  readyProvider: ready.provider,
  blockedProvider: blocked.provider,
  blockedReasons: blocked.blockers
}, null, 2));
