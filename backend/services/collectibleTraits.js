'use strict';

function cleanString(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasValue(value) {
  return cleanString(value) !== null;
}

function formatDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = cleanString(value);
  return text ? text.slice(0, 10) : null;
}

function formatNumberedValue(number, run) {
  const itemNumber = cleanString(number);
  const runSize = cleanString(run);
  if (itemNumber && runSize) return `#${itemNumber}/${runSize}`;
  if (itemNumber) return `#${itemNumber}`;
  if (runSize) return `Run ${runSize}`;
  return null;
}

function firstSignature(row = {}, signatures = []) {
  const signatureRows = asArray(signatures);
  return signatureRows.find((signature) => signature?.is_primary) || signatureRows[0] || (
    hasValue(row.signer_name) || hasValue(row.signed_by) || hasValue(row.signed_on) || hasValue(row.signed_at)
      ? {
          signer_name: row.signer_name || row.signed_by || null,
          signer_role: row.signer_role || row.signed_role || null,
          signed_on: row.signed_on || null,
          signed_at: row.signed_at || null,
          signed_event_id: row.signed_event_id || null,
          proof_path: row.signature_proof_path || row.signed_proof_path || null,
          notes: row.signature_notes || null
        }
      : null
  );
}

function findCertificateProof(signatures = []) {
  for (const signature of asArray(signatures)) {
    for (const proof of asArray(signature?.proofs)) {
      const text = [
        proof?.proof_type,
        proof?.label,
        proof?.notes,
        proof?.provider
      ].filter(Boolean).join(' ').toLowerCase();
      if (text.includes('coa') || text.includes('certificate') || text.includes('authentic')) {
        return proof;
      }
    }
  }
  return null;
}

function buildSignedTrait(row = {}, signatures = []) {
  const signature = firstSignature(row, signatures);
  if (!signature && row.signed !== true) return null;
  const signer = cleanString(signature?.signer_name);
  const role = cleanString(signature?.signer_role);
  const signedOn = formatDate(signature?.signed_on);
  const signedAt = cleanString(signature?.signed_at);
  return {
    key: 'signed',
    family: 'signed',
    label: 'Signed',
    summary: signer ? `Signed by ${signer}` : 'Signed copy',
    tone: 'brand',
    details: [
      signer ? { label: 'Signer', value: signer } : null,
      role ? { label: 'Role', value: role } : null,
      signedOn ? { label: 'Date', value: signedOn } : null,
      signedAt ? { label: 'Location', value: signedAt } : null,
      signature?.proof_path ? { label: 'Proof', value: 'On file' } : null
    ].filter(Boolean)
  };
}

function buildNumberedTrait(row = {}) {
  const value = formatNumberedValue(row.print_number, row.print_run);
  if (!value) return null;
  return {
    key: 'numbered_limited',
    family: 'numbered',
    label: 'Numbered',
    summary: value,
    tone: 'brand',
    details: [
      hasValue(row.print_number) ? { label: 'Number', value: String(row.print_number) } : null,
      hasValue(row.print_run) ? { label: 'Run', value: String(row.print_run) } : null
    ].filter(Boolean)
  };
}

function buildCertificateTrait(signatures = []) {
  const proof = findCertificateProof(signatures);
  if (!proof) return null;
  return {
    key: 'certificate',
    family: 'certificate',
    label: 'Certificate',
    summary: cleanString(proof.label) || cleanString(proof.proof_type) || 'Certificate on file',
    tone: 'brand',
    details: [
      proof.provider ? { label: 'Issuer', value: proof.provider } : null,
      proof.label ? { label: 'Label', value: proof.label } : null,
      proof.proof_path ? { label: 'Document', value: 'On file' } : null
    ].filter(Boolean)
  };
}

function buildEventAcquiredTrait(row = {}) {
  const eventTitle = cleanString(row.event_title) || (row.event_id ? `Event #${row.event_id}` : null);
  const vendor = cleanString(row.vendor) || cleanString(row.booth_or_vendor);
  const booth = cleanString(row.booth);
  const exclusive = row.exclusive === true;
  if (!eventTitle && !vendor && !booth && !exclusive) return null;
  const context = [eventTitle, vendor, booth ? `Booth ${booth}` : null].filter(Boolean).join(' · ');
  return {
    key: exclusive ? 'event_exclusive' : 'event_acquired',
    family: 'event_acquired',
    label: exclusive ? 'Exclusive' : 'Event acquired',
    summary: context || (exclusive ? 'Exclusive item' : 'Event-acquired item'),
    tone: exclusive ? 'brand' : 'default',
    details: [
      eventTitle ? { label: 'Event', value: eventTitle } : null,
      vendor ? { label: 'Vendor', value: vendor } : null,
      booth ? { label: 'Booth', value: booth } : null,
      exclusive ? { label: 'Exclusive', value: 'Yes' } : null
    ].filter(Boolean)
  };
}

function buildEditionTrait(row = {}) {
  const details = row.type_details && typeof row.type_details === 'object' ? row.type_details : {};
  const values = [
    cleanString(details.edition),
    cleanString(details.printing),
    cleanString(details.region),
    cleanString(details.platform),
    cleanString(row.edition)
  ].filter(Boolean);
  const unique = Array.from(new Set(values));
  if (unique.length === 0) return null;
  return {
    key: 'edition_variant',
    family: 'edition_variant',
    label: 'Edition',
    summary: unique.join(' · '),
    tone: 'default',
    details: unique.map((value, index) => ({ label: index === 0 ? 'Edition' : 'Detail', value }))
  };
}

function buildCollectibleTraits({ row = {}, signatures = null } = {}) {
  const signatureRows = signatures || row.signatures || [];
  const persistedTraits = asArray(row.persisted_collectible_traits || row.persisted_traits)
    .map(normalizePersistedTrait)
    .filter(Boolean);
  const derivedTraits = [
    buildSignedTrait(row, signatureRows),
    buildNumberedTrait(row),
    buildCertificateTrait(signatureRows),
    buildEventAcquiredTrait(row),
    buildEditionTrait(row)
  ].filter(Boolean);
  return mergeCollectibleTraits(persistedTraits, derivedTraits);
}

function normalizePersistedTrait(trait = {}) {
  const key = cleanString(trait.key || trait.trait_key);
  const family = cleanString(trait.family);
  const label = cleanString(trait.label);
  if (!key || !family || !label) return null;
  const details = asArray(trait.details)
    .map((detail) => {
      const detailLabel = cleanString(detail?.label);
      const value = cleanString(detail?.value);
      if (!detailLabel || !value) return null;
      return { label: detailLabel, value };
    })
    .filter(Boolean);
  return {
    key,
    family,
    label,
    summary: cleanString(trait.summary) || label,
    tone: cleanString(trait.tone) || 'default',
    details
  };
}

function mergeCollectibleTraits(primaryTraits = [], fallbackTraits = []) {
  const seen = new Set();
  const merged = [];
  for (const trait of [...asArray(primaryTraits), ...asArray(fallbackTraits)]) {
    const normalized = normalizePersistedTrait(trait);
    if (!normalized || seen.has(normalized.key)) continue;
    seen.add(normalized.key);
    merged.push(normalized);
  }
  return merged;
}

module.exports = {
  buildCollectibleTraits,
  formatNumberedValue,
  mergeCollectibleTraits,
  normalizePersistedTrait
};
