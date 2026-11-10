'use strict';

const { appendScopeSql } = require('../db/scopeContext');
const { setCanonicalFieldControl } = require('./canonicalMediaFieldControls');
const { createExternalMediaIdentityService } = require('./externalMediaIdentities');
const { buildMediaIdentityAliasKey } = require('./mediaIdentityAliases');
const { syncNormalizedMetadataForMedia } = require('./mediaTaxonomy');
const { recordProviderIdentityCompatibilityEvent } = require('./metrics');
const {
  buildPlexCanonicalFields,
  buildPlexCompatibility,
  createPlexAdapterRegistry,
  selectPlexIdentity
} = require('./plexIdentity');
const { createProviderIntegrationBindingService } = require('./providerIntegrationBindings');

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 2147483647) {
    const error = new Error(`${label} is invalid`);
    error.code = 'INVALID_PLEX_IMPORT_IDENTITY';
    throw error;
  }
  return parsed;
}

function createPlexImportIdentityModule({ pool } = {}) {
  if (!pool) throw new TypeError('Plex import identity module requires a pool');
  const adapterRegistry = createPlexAdapterRegistry();
  const identities = createExternalMediaIdentityService({ pool, adapterRegistry });
  const bindings = createProviderIntegrationBindingService({ pool });

  async function open({
    spaceId: spaceIdValue,
    libraryId: libraryIdValue,
    actorId: actorIdValue,
    endpointUrl,
    transactionClient = null
  } = {}) {
    const spaceId = positiveInteger(spaceIdValue, 'Workspace');
    const libraryId = positiveInteger(libraryIdValue, 'Library');
    const actorId = positiveInteger(actorIdValue, 'Actor');
    if (transactionClient && typeof transactionClient.query !== 'function') {
      throw new TypeError('Plex import identity transaction client must provide query()');
    }
    const binding = await bindings.ensurePlexBinding({ spaceId, actorId, endpointUrl }, transactionClient);

    async function scoped(work) {
      if (transactionClient) return work(transactionClient, null);
      return identities.transaction({ spaceId, libraryId, actorId }, ({ client, identities: scopedIdentities }) =>
        work(client, scopedIdentities));
    }

    async function legacyCandidate(client, identityKind, externalId, mediaType) {
      const metadataKey = identityKind === 'guid' ? 'plex_guid' : 'plex_item_key';
      const aliasKey = buildMediaIdentityAliasKey(identityKind === 'guid' ? 'plexGuid' : 'plexItemKey', externalId);
      const params = [externalId, mediaType, metadataKey, aliasKey];
      const scopeClause = appendScopeSql(params, { spaceId, libraryId }, {
        spaceColumn: 'm.space_id',
        libraryColumn: 'm.library_id'
      });
      const result = await client.query(
        `SELECT DISTINCT m.id
           FROM media m
           JOIN media_metadata mm ON mm.media_id = m.id
          WHERE m.media_type = $2
            AND ((mm."key" = $3 AND mm."value" = $1) OR (mm."key" = $4 AND mm."value" = $1))
            ${scopeClause}
          ORDER BY m.id DESC
          LIMIT 2`,
        params
      );
      if (result.rows.length > 1) {
        const error = new Error('Plex identity matches multiple legacy canonical objects');
        error.code = 'EXTERNAL_IDENTITY_CONFLICT';
        error.status = 409;
        throw error;
      }
      recordProviderIdentityCompatibilityEvent(
        'plex',
        identityKind === 'guid' ? 'legacy_read_plex_guid' : 'legacy_read_plex_item',
        result.rows[0] ? 'matched' : 'missed'
      );
      return result.rows[0] || null;
    }

    async function reconcileItem({ plexGuid = null, plexItemKey = null, item } = {}, upsert) {
      if (typeof upsert !== 'function') throw new TypeError('Plex item reconciliation requires an upsert callback');
      const selected = selectPlexIdentity({ plexGuid, plexItemKey });
      const normalized = adapterRegistry.normalizeExternalId('plex', selected.identityKind, selected.externalId);
      const mediaType = String(item?.media_type || '').trim();
      if (!['movie', 'tv_series', 'tv_episode', 'audio'].includes(mediaType)) {
        throw new TypeError('Plex item reconciliation requires a supported canonical media type');
      }
      return scoped(async (client, scopedIdentities) => {
        const reconciliationArgs = {
          connectionId: binding.providerConnectionId,
          identityKind: normalized.identityKind,
          externalId: normalized.normalizedExternalId,
          compatibility: buildPlexCompatibility(normalized.identityKind, normalized.normalizedExternalId),
          canonicalFields: buildPlexCanonicalFields(item)
        };
        const reconcileWork = async ({ resolvedMediaId }) => {
          const legacy = resolvedMediaId
            ? null
            : await legacyCandidate(client, normalized.identityKind, normalized.normalizedExternalId, mediaType);
          const value = await upsert(Object.freeze({
            client,
            identityKind: normalized.identityKind,
            preferredMediaId: resolvedMediaId || legacy?.id || null,
            matchedBy: resolvedMediaId
              ? 'external_identity'
              : (legacy ? `legacy_plex_${normalized.identityKind}` : null)
          }));
          if (value?.adoptProviderTitle === true) {
            await setCanonicalFieldControl(client, {
              spaceId,
              mediaId: value.mediaId,
              fieldPath: 'media.title',
              authority: 'provider',
              providerWriteMode: 'refresh',
              locked: false,
              providerConnectionId: binding.providerConnectionId,
              actorId
            });
          }
          return { mediaId: value?.mediaId, value };
        };
        const reconciled = transactionClient
          ? await identities.reconcile({ ...reconciliationArgs, spaceId, actorId }, reconcileWork, client)
          : await scopedIdentities.reconcile(reconciliationArgs, reconcileWork);
        if (reconciled.value?.type === 'created') {
          await setCanonicalFieldControl(client, {
            spaceId,
            mediaId: reconciled.mediaId,
            fieldPath: 'media.title',
            authority: 'provider',
            providerWriteMode: 'refresh',
            locked: false,
            providerConnectionId: binding.providerConnectionId,
            actorId
          });
        }
        const metadata = await client.query(
          'SELECT genre, director, cast_members AS cast FROM media WHERE id = $1 AND space_id = $2',
          [reconciled.mediaId, spaceId]
        );
        if (metadata.rows[0]) {
          await syncNormalizedMetadataForMedia({
            mediaId: reconciled.mediaId,
            genre: metadata.rows[0].genre,
            director: metadata.rows[0].director,
            cast: metadata.rows[0].cast,
            client
          });
        }
        return reconciled;
      });
    }

    return Object.freeze({ connectionId: binding.providerConnectionId, reconcileItem });
  }

  return Object.freeze({ open });
}

module.exports = { createPlexImportIdentityModule };
