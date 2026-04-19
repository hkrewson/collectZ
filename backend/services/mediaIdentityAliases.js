'use strict';

const { normalizeDigits } = require('./bookComicNormalization');

const MEDIA_IDENTITY_ALIAS_PREFIXES = Object.freeze({
  providerItemId: 'identity_alias:provider_item_id:',
  calibreEntryId: 'identity_alias:calibre_entry_id:',
  providerIssueId: 'identity_alias:provider_issue_id:',
  plexGuid: 'identity_alias:plex_guid:',
  plexItemKey: 'identity_alias:plex_item_key:',
  isbn: 'identity_alias:isbn:',
  eanUpc: 'identity_alias:ean_upc:',
  amazonItemId: 'identity_alias:amazon_item_id:'
});

function normalizeIdentityAliasValue(kind, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (kind === 'isbn' || kind === 'eanUpc') {
    return normalizeDigits(raw);
  }
  return raw;
}

function buildMediaIdentityAliasKey(kind, value) {
  const prefix = MEDIA_IDENTITY_ALIAS_PREFIXES[kind] || '';
  const normalizedValue = normalizeIdentityAliasValue(kind, value);
  if (!prefix || !normalizedValue) return '';
  return `${prefix}${normalizedValue}`;
}

function appendAliasEntry(entries, seen, kind, value) {
  const normalizedValue = normalizeIdentityAliasValue(kind, value);
  const key = buildMediaIdentityAliasKey(kind, normalizedValue);
  if (!key || !normalizedValue || seen.has(key)) return;
  seen.add(key);
  entries.push({ key, value: normalizedValue });
}

function buildMediaIdentityAliasEntries({ mediaRow = null, snapshot = null } = {}) {
  const row = mediaRow && typeof mediaRow === 'object' ? mediaRow : {};
  const typeDetails = row.type_details && typeof row.type_details === 'object' ? row.type_details : {};
  const snapshotMetadata = Array.isArray(snapshot?.media_metadata) ? snapshot.media_metadata : [];
  const metadataByKey = new Map();
  for (const entry of snapshotMetadata) {
    const key = String(entry?.key || '').trim();
    if (!key || metadataByKey.has(key)) continue;
    metadataByKey.set(key, String(entry?.value || '').trim());
  }

  const entries = [];
  const seen = new Set();
  appendAliasEntry(entries, seen, 'providerItemId', typeDetails.provider_item_id || metadataByKey.get('provider_item_id'));
  appendAliasEntry(entries, seen, 'calibreEntryId', typeDetails.calibre_entry_id || metadataByKey.get('calibre_entry_id'));
  appendAliasEntry(entries, seen, 'providerIssueId', typeDetails.provider_issue_id || metadataByKey.get('metron_issue_id'));
  appendAliasEntry(entries, seen, 'plexGuid', metadataByKey.get('plex_guid'));
  appendAliasEntry(entries, seen, 'plexItemKey', metadataByKey.get('plex_item_key'));
  appendAliasEntry(entries, seen, 'isbn', typeDetails.isbn || metadataByKey.get('isbn'));
  appendAliasEntry(entries, seen, 'eanUpc', row.upc || metadataByKey.get('ean_upc') || metadataByKey.get('ean') || metadataByKey.get('upc'));
  appendAliasEntry(entries, seen, 'amazonItemId', metadataByKey.get('amazon_item_id'));
  return entries;
}

module.exports = {
  MEDIA_IDENTITY_ALIAS_PREFIXES,
  normalizeIdentityAliasValue,
  buildMediaIdentityAliasKey,
  buildMediaIdentityAliasEntries
};
