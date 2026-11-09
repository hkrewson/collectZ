'use strict';

const crypto = require('node:crypto');

const LEGACY_IDENTITY_KEYS = new Set([
  'provider_item_id',
  'provider_issue_id',
  'calibre_entry_id',
  'metron_issue_id',
  'plex_guid',
  'plex_item_key',
  'kavita_series_provider_item_id',
  'kavita_chapter_provider_item_id'
]);

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function field(row, storage, key) {
  const source = storage === 'metadata'
    ? (row.metadata || {})
    : (row.typeDetails || row.type_details || {});
  return text(source[key]);
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function rowContext(row) {
  return {
    mediaId: Number(row.mediaId ?? row.id),
    spaceId: Number(row.spaceId ?? row.space_id),
    libraryId: row.libraryId ?? row.library_id ?? null,
    providerName: text(row.providerName ?? row.provider_name ?? field(row, 'typeDetails', 'provider_name'))?.toLowerCase() || null,
    importSource: text(row.importSource ?? row.import_source)?.toLowerCase() || null
  };
}

function claimFromValues(context, providerType, identityKind, evidence) {
  const populated = evidence
    .map(({ storage, key }) => ({ storage, key, value: field(context.row, storage, key) }))
    .filter(({ value }) => value);
  const values = [...new Set(populated.map(({ value }) => value))];
  if (values.length === 0) {
    return { diagnostic: diagnostic(context, 'legacy_identity_missing', { providerType, identityKind }) };
  }
  if (values.length > 1) {
    return {
      diagnostic: diagnostic(context, 'legacy_identity_values_conflict', {
        providerType,
        identityKind,
        evidenceKeys: populated.map(({ storage, key }) => `${storage}.${key}`)
      })
    };
  }
  return {
    claim: {
      mediaId: context.mediaId,
      spaceId: context.spaceId,
      libraryId: context.libraryId,
      providerType,
      identityKind,
      externalId: values[0],
      externalIdFingerprint: fingerprint(values[0]),
      evidenceKeys: populated.map(({ storage, key }) => `${storage}.${key}`)
    }
  };
}

function diagnostic(context, code, details = {}) {
  return {
    code,
    mediaId: context.mediaId,
    spaceId: context.spaceId,
    libraryId: context.libraryId,
    ...details
  };
}

function hasLegacyIdentityFields(row) {
  const typeDetails = row.typeDetails || row.type_details || {};
  const metadata = row.metadata || {};
  return [...Object.keys(typeDetails), ...Object.keys(metadata)]
    .some((key) => LEGACY_IDENTITY_KEYS.has(key) && (text(typeDetails[key]) || text(metadata[key])));
}

function extractLegacyClaims(row) {
  const base = rowContext(row);
  const context = { ...base, row };
  const claims = [];
  const diagnostics = [];
  const add = (result) => {
    if (result.claim) claims.push(result.claim);
    if (result.diagnostic) diagnostics.push(result.diagnostic);
  };

  if (context.providerName === 'cwa_opds') {
    add(claimFromValues(context, 'cwa', 'book', [
      { storage: 'typeDetails', key: 'provider_item_id' },
      { storage: 'typeDetails', key: 'calibre_entry_id' },
      { storage: 'metadata', key: 'provider_item_id' },
      { storage: 'metadata', key: 'calibre_entry_id' }
    ]));
  } else if (context.providerName === 'kavita') {
    const chapterEvidence = [
      { storage: 'typeDetails', key: 'kavita_chapter_provider_item_id' },
      { storage: 'typeDetails', key: 'provider_issue_id' }
    ];
    const hasChapter = chapterEvidence.some(({ storage, key }) => field(row, storage, key));
    add(claimFromValues(context, 'kavita', hasChapter ? 'chapter' : 'series', hasChapter
      ? [...chapterEvidence, { storage: 'typeDetails', key: 'provider_item_id' }]
      : [
          { storage: 'typeDetails', key: 'kavita_series_provider_item_id' },
          { storage: 'typeDetails', key: 'provider_item_id' }
        ]));
  } else if (context.providerName === 'metron' || context.importSource === 'metron') {
    add(claimFromValues(context, 'metron', 'issue', [
      { storage: 'typeDetails', key: 'provider_issue_id' },
      { storage: 'metadata', key: 'provider_issue_id' },
      { storage: 'metadata', key: 'metron_issue_id' }
    ]));
  } else if (context.providerName === 'plex' || context.importSource === 'plex') {
    for (const [identityKind, key] of [['guid', 'plex_guid'], ['item', 'plex_item_key']]) {
      const value = field(row, 'metadata', key);
      if (value) add(claimFromValues(context, 'plex', identityKind, [{ storage: 'metadata', key }]));
    }
    if (claims.length === 0) diagnostics.push(diagnostic(context, 'legacy_identity_missing', { providerType: 'plex' }));
  } else if (hasLegacyIdentityFields(row)) {
    diagnostics.push(diagnostic(context, 'legacy_provider_unrecognized', {
      providerName: context.providerName,
      importSource: context.importSource
    }));
  }

  return { claims, diagnostics };
}

function valueOf(row, camel, snake) {
  return row[camel] ?? row[snake];
}

function createProviderIdentityBackfillPlanner({ adapterRegistry } = {}) {
  if (!adapterRegistry || typeof adapterRegistry.normalizeExternalId !== 'function') {
    throw new TypeError('Provider identity backfill planner requires an adapter registry');
  }

  function plan({ mediaRows = [], connections = [], existingIdentities = [] } = {}) {
    const diagnostics = [];
    const normalizedClaims = [];

    for (const row of mediaRows) {
      const extracted = extractLegacyClaims(row);
      diagnostics.push(...extracted.diagnostics);
      for (const claim of extracted.claims) {
        const matching = connections.filter((connection) =>
          Number(valueOf(connection, 'spaceId', 'space_id')) === claim.spaceId &&
          text(valueOf(connection, 'providerType', 'provider_type'))?.toLowerCase() === claim.providerType);
        const active = matching.filter((connection) => text(connection.status)?.toLowerCase() === 'active');
        if (active.length === 0) {
          diagnostics.push({
            ...claim,
            externalId: undefined,
            code: matching.length > 0 ? 'provider_connection_inactive' : 'provider_connection_missing'
          });
          continue;
        }
        if (active.length > 1) {
          diagnostics.push({
            ...claim,
            externalId: undefined,
            code: 'provider_connection_ambiguous',
            connectionIds: active.map((connection) => connection.id).sort()
          });
          continue;
        }
        let normalized;
        try {
          normalized = adapterRegistry.normalizeExternalId(claim.providerType, claim.identityKind, claim.externalId);
        } catch (error) {
          diagnostics.push({
            ...claim,
            externalId: undefined,
            code: error.code === 'PROVIDER_ADAPTER_NOT_REGISTERED'
              ? 'provider_adapter_unavailable'
              : 'legacy_identity_invalid'
          });
          continue;
        }
        normalizedClaims.push({
          ...claim,
          providerConnectionId: active[0].id,
          normalizedExternalId: normalized.normalizedExternalId
        });
      }
    }

    const grouped = new Map();
    for (const claim of normalizedClaims) {
      const key = [claim.spaceId, claim.providerConnectionId, claim.identityKind, claim.normalizedExternalId].join('\u0000');
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(claim);
    }

    const actions = [];
    const aligned = [];
    for (const claims of grouped.values()) {
      const mediaIds = [...new Set(claims.map(({ mediaId }) => mediaId))];
      if (mediaIds.length > 1) {
        for (const claim of claims) {
          diagnostics.push({ ...claim, externalId: undefined, normalizedExternalId: undefined,
            code: 'external_identity_multiple_candidates', candidateMediaIds: mediaIds.sort((a, b) => a - b) });
        }
        continue;
      }
      const claim = claims[0];
      const sameKey = existingIdentities.filter((identity) =>
        valueOf(identity, 'providerConnectionId', 'provider_connection_id') === claim.providerConnectionId &&
        text(valueOf(identity, 'identityKind', 'identity_kind')) === claim.identityKind &&
        text(valueOf(identity, 'normalizedExternalId', 'external_id_normalized')) === claim.normalizedExternalId &&
        valueOf(identity, 'active', 'active') !== false);
      if (sameKey.length > 0) {
        if (sameKey.every((identity) => Number(valueOf(identity, 'mediaId', 'media_id')) === claim.mediaId)) {
          aligned.push({ ...claim, externalId: undefined });
        } else {
          diagnostics.push({ ...claim, externalId: undefined, normalizedExternalId: undefined,
            code: 'external_identity_target_conflict' });
        }
        continue;
      }
      const incompatible = existingIdentities.some((identity) =>
        valueOf(identity, 'providerConnectionId', 'provider_connection_id') === claim.providerConnectionId &&
        text(valueOf(identity, 'identityKind', 'identity_kind')) === claim.identityKind &&
        Number(valueOf(identity, 'mediaId', 'media_id')) === claim.mediaId &&
        valueOf(identity, 'active', 'active') !== false &&
        text(valueOf(identity, 'normalizedExternalId', 'external_id_normalized')) !== claim.normalizedExternalId);
      if (incompatible) {
        diagnostics.push({ ...claim, externalId: undefined, normalizedExternalId: undefined,
          code: 'canonical_identity_conflict' });
        continue;
      }
      actions.push(claim);
    }

    const diagnosticCounts = {};
    for (const item of diagnostics) diagnosticCounts[item.code] = (diagnosticCounts[item.code] || 0) + 1;
    return {
      actions,
      aligned,
      diagnostics,
      summary: {
        scannedRows: mediaRows.length,
        eligible: actions.length,
        aligned: aligned.length,
        reviewRequired: diagnostics.length,
        diagnosticCounts
      }
    };
  }

  async function planWorkspace(client, spaceIdValue) {
    if (!client || typeof client.query !== 'function') {
      throw new TypeError('Provider identity backfill planning requires an authorized transaction client');
    }
    const spaceId = Number(spaceIdValue);
    if (!Number.isInteger(spaceId) || spaceId <= 0) {
      throw new TypeError('Provider identity backfill workspace is invalid');
    }
    const keys = [...LEGACY_IDENTITY_KEYS];
    const mediaResult = await client.query(
      `WITH legacy_metadata AS (
         SELECT mm.media_id, jsonb_object_agg(mm."key", mm."value") AS metadata
           FROM media_metadata mm
           JOIN media scoped_media ON scoped_media.id = mm.media_id AND scoped_media.space_id = $1
          WHERE mm."key" = ANY($2::varchar[])
          GROUP BY mm.media_id
       )
       SELECT m.id, m.space_id, m.library_id, m.import_source, m.type_details,
              COALESCE(lm.metadata, '{}'::jsonb) AS metadata
         FROM media m
         LEFT JOIN legacy_metadata lm ON lm.media_id = m.id
        WHERE m.space_id = $1
          AND (
            COALESCE(m.type_details, '{}'::jsonb) ?| $2::text[]
            OR lm.metadata IS NOT NULL
          )
        ORDER BY m.id`,
      [spaceId, keys]
    );
    const connectionResult = await client.query(
      `SELECT id, space_id, provider_type, status
         FROM provider_connections
        WHERE space_id = $1
        ORDER BY provider_type, id`,
      [spaceId]
    );
    const identityResult = await client.query(
      `SELECT provider_connection_id, identity_kind, external_id_normalized, media_id, active
         FROM external_media_identities
        WHERE space_id = $1 AND active
        ORDER BY provider_connection_id, identity_kind, external_id_normalized`,
      [spaceId]
    );
    return plan({
      mediaRows: mediaResult.rows,
      connections: connectionResult.rows,
      existingIdentities: identityResult.rows
    });
  }

  return Object.freeze({ plan, planWorkspace });
}

module.exports = {
  LEGACY_IDENTITY_KEYS,
  extractLegacyClaims,
  createProviderIdentityBackfillPlanner
};
