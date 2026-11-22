'use strict';

const crypto = require('node:crypto');
const { reconcileProviderMediaType, setCanonicalFieldControl } = require('./canonicalMediaFieldControls');
const { createExternalMediaIdentityService } = require('./externalMediaIdentities');
const { buildOwnedFormatsPayload } = require('./mediaFormats');
const { syncNormalizedMetadataForMedia } = require('./mediaTaxonomy');
const { syncBookOrbitSeriesMemberships } = require('./bookOrbitSeriesMemberships');
const {
  appendProviderSourceObservation,
  buildBookOrbitSourceObservation
} = require('./providerSourceObservations');
const {
  BOOKORBIT_IDENTITY_KIND,
  buildBookOrbitCanonicalFields,
  buildBookOrbitCompatibility,
  createBookOrbitAdapterRegistry
} = require('./bookOrbitIdentity');

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 2147483647) {
    const error = new Error(`${label} is invalid`);
    error.code = 'INVALID_BOOKORBIT_IMPORT_IDENTITY';
    error.status = 400;
    throw error;
  }
  return parsed;
}

function createBookOrbitImportIdentityModule({ pool } = {}) {
  if (!pool) throw new TypeError('BookOrbit import identity module requires a pool');
  const adapterRegistry = createBookOrbitAdapterRegistry();
  const identities = createExternalMediaIdentityService({ pool, adapterRegistry });

  async function open({
    spaceId: spaceIdValue,
    libraryId: libraryIdValue = null,
    actorId: actorIdValue,
    connectionId,
    sourceUrl = null,
    observationBatchId: observationBatchIdValue = null,
    transactionClient = null
  } = {}) {
    const spaceId = positiveInteger(spaceIdValue, 'Workspace');
    const actorId = positiveInteger(actorIdValue, 'Actor');
    const libraryId = libraryIdValue === null || libraryIdValue === undefined
      ? null
      : positiveInteger(libraryIdValue, 'Library');
    if (transactionClient && typeof transactionClient.query !== 'function') {
      throw new TypeError('BookOrbit import identity transaction client must provide query()');
    }
    const observationBatchId = String(observationBatchIdValue || crypto.randomUUID()).trim();
    if (!observationBatchId || observationBatchId.length > 512) {
      throw new TypeError('BookOrbit observation batch id is invalid');
    }

    async function scoped(work) {
      if (transactionClient) return work(transactionClient, null);
      return identities.transaction({ spaceId, libraryId, actorId }, ({ client, identities: scopedIdentities }) =>
        work(client, scopedIdentities));
    }

    async function reconcileItem({ externalId: externalIdValue, item, sourceUrl: itemSourceUrl = null } = {}, upsert) {
      if (typeof upsert !== 'function') throw new TypeError('BookOrbit entry reconciliation requires an upsert callback');
      const normalized = adapterRegistry.normalizeExternalId('bookorbit', BOOKORBIT_IDENTITY_KIND, externalIdValue);
      const mediaType = String(item?.media_type || '').trim();
      if (!['book', 'comic_book'].includes(mediaType)) {
        throw new TypeError('BookOrbit entry reconciliation requires a book or comic canonical type');
      }
      return scoped(async (client, scopedIdentities) => {
        const reconciliationArgs = {
          connectionId,
          identityKind: BOOKORBIT_IDENTITY_KIND,
          externalId: normalized.normalizedExternalId,
          sourceUrl: itemSourceUrl || sourceUrl,
          compatibility: buildBookOrbitCompatibility(normalized.normalizedExternalId),
          canonicalFields: buildBookOrbitCanonicalFields(item)
        };
        const reconcileWork = async ({ resolvedMediaId }) => {
          const providerTypeTransition = resolvedMediaId
            ? await reconcileProviderMediaType(client, {
                spaceId,
                mediaId: resolvedMediaId,
                proposedType: mediaType,
                providerConnectionId: connectionId,
                actorId
              })
            : null;
          const value = await upsert(Object.freeze({
            client,
            preferredMediaId: resolvedMediaId || null,
            matchedBy: resolvedMediaId ? 'external_identity' : null
          }));
          return {
            mediaId: value?.mediaId,
            value: providerTypeTransition?.action === 'refresh'
              ? { ...value, providerTypeTransition }
              : value
          };
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
            providerConnectionId: connectionId,
            actorId
          });
          await setCanonicalFieldControl(client, {
            spaceId,
            mediaId: reconciled.mediaId,
            fieldPath: 'media.media_type',
            authority: 'provider',
            providerWriteMode: 'refresh',
            locked: false,
            providerConnectionId: connectionId,
            actorId
          });
          const formatState = buildOwnedFormatsPayload(mediaType, item?.owned_formats, item?.format);
          if (formatState.ownedFormats.length > 0) {
            await client.query(
              'UPDATE media SET owned_formats = $3::text[] WHERE id = $1 AND space_id = $2',
              [reconciled.mediaId, spaceId, formatState.ownedFormats]
            );
          }
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
        const membershipSync = Array.isArray(item?.bookorbit_series_memberships)
          ? await syncBookOrbitSeriesMemberships(client, {
              spaceId,
              mediaId: reconciled.mediaId,
              providerConnectionId: connectionId,
              actorId,
              memberships: item.bookorbit_series_memberships
            })
          : null;
        const observationInput = buildBookOrbitSourceObservation(item);
        const sourceObservation = await appendProviderSourceObservation(client, {
          spaceId,
          providerConnectionId: connectionId,
          externalIdentityId: reconciled.identity.id,
          actorId,
          sourceKind: observationInput.sourceKind,
          sourceUpdatedAt: observationInput.sourceUpdatedAt,
          batchKey: observationBatchId,
          facts: observationInput.facts
        });
        return {
          ...reconciled,
          value: {
            ...reconciled.value,
            ...(membershipSync ? { bookOrbitSeriesMemberships: membershipSync } : {}),
            providerSourceObservation: sourceObservation
          }
        };
      });
    }

    return Object.freeze({ connectionId, reconcileItem });
  }

  return Object.freeze({ open });
}

module.exports = { createBookOrbitImportIdentityModule };
