'use strict';

const PROVIDER_ALIASES = new Map([
  ['bookorbit', 'bookorbit'],
  ['calibre', 'cwa'],
  ['cwa', 'cwa'],
  ['cwa_opds', 'cwa'],
  ['kavita', 'kavita'],
  ['metron', 'metron'],
  ['plex', 'plex'],
  ['plex_webhook', 'plex'],
  ['scanner', 'scanner'],
  ['barcode_scanner', 'scanner'],
  ['generic', 'generic'],
  ['csv_generic', 'generic'],
  ['csv_delicious', 'generic'],
  ['csv_calibre', 'generic']
]);

const LEGACY_READ_OPERATIONS = new Set([
  'legacy_read_provider_item',
  'legacy_read_provider_issue',
  'legacy_read_plex_guid',
  'legacy_read_plex_item'
]);
const SUPPORTED_OPERATIONS = new Set([
  ...LEGACY_READ_OPERATIONS,
  'legacy_write',
  'authoritative_projection'
]);
const SUPPORTED_OUTCOMES = new Set([
  'matched',
  'missed',
  'created',
  'updated',
  'written',
  'aligned',
  'conflict'
]);
const MINIMUM_OBSERVATION_HOURS = 7 * 24;
const MINIMUM_SUCCESSFUL_SYNCS = 2;

function normalizeProviderIdentityLabel(provider) {
  return PROVIDER_ALIASES.get(String(provider || '').trim().toLowerCase()) || 'unknown';
}

function nonNegativeNumber(value, label) {
  const normalized = Number(value ?? 0);
  if (!Number.isFinite(normalized) || normalized < 0) throw new TypeError(`${label} must be a non-negative number`);
  return normalized;
}

function normalizeInventory(inventory = {}) {
  return {
    legacyOnly: nonNegativeNumber(inventory.legacyOnly, 'Legacy-only inventory'),
    ambiguous: nonNegativeNumber(inventory.ambiguous, 'Ambiguous inventory'),
    conflicts: nonNegativeNumber(inventory.conflicts, 'Conflict inventory'),
    unboundConnections: nonNegativeNumber(inventory.unboundConnections, 'Unbound connection inventory')
  };
}

function evaluateProviderIdentityCutover({
  provider,
  observationWindowHours,
  completedSuccessfulSyncs,
  samples = [],
  inventory = {}
} = {}) {
  const normalizedProvider = normalizeProviderIdentityLabel(provider);
  if (normalizedProvider === 'unknown') throw new TypeError('Cutover diagnostics require a recognized provider');
  if (!Array.isArray(samples)) throw new TypeError('Cutover diagnostic samples must be an array');

  const windowHours = nonNegativeNumber(observationWindowHours, 'Observation window');
  const successfulSyncs = nonNegativeNumber(completedSuccessfulSyncs, 'Successful sync count');
  const normalizedInventory = normalizeInventory(inventory);
  const activity = {
    legacyReads: 0,
    legacyWrites: 0,
    projectionWritten: 0,
    projectionAligned: 0,
    projectionConflicts: 0
  };

  for (const sample of samples) {
    const sampleProvider = normalizeProviderIdentityLabel(sample?.provider || normalizedProvider);
    if (sampleProvider !== normalizedProvider) continue;
    const operation = String(sample?.operation || '').trim().toLowerCase();
    const outcome = String(sample?.outcome || '').trim().toLowerCase();
    if (!SUPPORTED_OPERATIONS.has(operation)) throw new TypeError(`Unsupported cutover diagnostic operation ${operation || '(empty)'}`);
    if (!SUPPORTED_OUTCOMES.has(outcome)) throw new TypeError(`Unsupported cutover diagnostic outcome ${outcome || '(empty)'}`);
    const increase = nonNegativeNumber(sample?.increase, 'Metric increase');
    if (LEGACY_READ_OPERATIONS.has(operation)) activity.legacyReads += increase;
    if (operation === 'legacy_write') activity.legacyWrites += increase;
    if (operation === 'authoritative_projection' && outcome === 'written') activity.projectionWritten += increase;
    if (operation === 'authoritative_projection' && outcome === 'aligned') activity.projectionAligned += increase;
    if (operation === 'authoritative_projection' && outcome === 'conflict') activity.projectionConflicts += increase;
  }

  const blockers = [];
  if (windowHours < MINIMUM_OBSERVATION_HOURS) blockers.push('observation_window_short');
  if (successfulSyncs < MINIMUM_SUCCESSFUL_SYNCS) blockers.push('successful_sync_evidence_insufficient');
  if (activity.legacyReads > 0) blockers.push('legacy_reads_observed');
  if (activity.legacyWrites > 0) blockers.push('legacy_writes_observed');
  if (activity.projectionConflicts > 0) blockers.push('projection_conflicts_observed');
  if (activity.projectionWritten + activity.projectionAligned === 0) blockers.push('authoritative_projection_unobserved');
  if (activity.projectionAligned === 0) blockers.push('repeat_alignment_unobserved');
  if (normalizedInventory.legacyOnly > 0) blockers.push('legacy_only_inventory_remaining');
  if (normalizedInventory.ambiguous > 0) blockers.push('ambiguous_inventory_remaining');
  if (normalizedInventory.conflicts > 0) blockers.push('inventory_conflicts_remaining');
  if (normalizedInventory.unboundConnections > 0) blockers.push('provider_connections_unbound');

  return {
    provider: normalizedProvider,
    ready: blockers.length === 0,
    blockers,
    evidence: {
      observationWindowHours: windowHours,
      completedSuccessfulSyncs: successfulSyncs,
      minimumObservationHours: MINIMUM_OBSERVATION_HOURS,
      minimumSuccessfulSyncs: MINIMUM_SUCCESSFUL_SYNCS,
      activity,
      inventory: normalizedInventory
    }
  };
}

module.exports = {
  MINIMUM_OBSERVATION_HOURS,
  MINIMUM_SUCCESSFUL_SYNCS,
  normalizeProviderIdentityLabel,
  evaluateProviderIdentityCutover
};
