'use strict';

const { appendScopeSql } = require('../db/scopeContext');
const { setCanonicalFieldControl } = require('./canonicalMediaFieldControls');
const {
  CWA_IDENTITY_KIND,
  buildCwaCanonicalFields,
  buildCwaCompatibility,
  createCwaAdapterRegistry
} = require('./cwaIdentity');
const { createExternalMediaIdentityService } = require('./externalMediaIdentities');
const { buildOwnedFormatsPayload } = require('./mediaFormats');
const { syncNormalizedMetadataForMedia } = require('./mediaTaxonomy');
const { recordProviderIdentityCompatibilityEvent } = require('./metrics');
const { createProviderIntegrationBindingService } = require('./providerIntegrationBindings');

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 2147483647) {
    const error = new Error(`${label} is invalid`);
    error.code = 'INVALID_CWA_IMPORT_IDENTITY';
    throw error;
  }
  return parsed;
}

function createCwaImportIdentityModule({ pool } = {}) {
  if (!pool) throw new TypeError('CWA import identity module requires a pool');
  const adapterRegistry = createCwaAdapterRegistry();
  const identities = createExternalMediaIdentityService({ pool, adapterRegistry });
  const bindings = createProviderIntegrationBindingService({ pool });

  async function open({
    spaceId: spaceIdValue,
    libraryId: libraryIdValue = null,
    actorId: actorIdValue,
    endpointUrl,
    transactionClient = null
  } = {}) {
    const spaceId = positiveInteger(spaceIdValue, 'Workspace');
    const actorId = positiveInteger(actorIdValue, 'Actor');
    const libraryId = libraryIdValue === null || libraryIdValue === undefined
      ? null
      : positiveInteger(libraryIdValue, 'Library');
    if (transactionClient && typeof transactionClient.query !== 'function') {
      throw new TypeError('CWA import identity transaction client must provide query()');
    }
    const binding = await bindings.ensureCwaBinding(
      { spaceId, actorId, endpointUrl },
      transactionClient
    );

    async function scoped(work) {
      if (transactionClient) return work(transactionClient, null);
      return identities.transaction({ spaceId, libraryId, actorId }, ({ client, identities: scopedIdentities }) =>
        work(client, scopedIdentities));
    }

    async function legacyCandidate(client, externalId, mediaType) {
      const params = [externalId, mediaType];
      const scopeClause = appendScopeSql(params, { spaceId, libraryId }, {
        spaceColumn: 'm.space_id',
        libraryColumn: 'm.library_id'
      });
      const result = await client.query(
        `SELECT DISTINCT m.id
           FROM media m
           LEFT JOIN media_metadata mm ON mm.media_id = m.id
          WHERE m.media_type = $2
            AND (m.import_source = 'cwa_opds' OR lower(COALESCE(m.type_details->>'provider_name', '')) = 'cwa_opds')
            AND (
              COALESCE(m.type_details->>'provider_item_id', '') = $1
              OR COALESCE(m.type_details->>'calibre_entry_id', '') = $1
              OR (mm."key" IN ('provider_item_id', 'calibre_entry_id') AND mm."value" = $1)
            )
            ${scopeClause}
          ORDER BY m.id DESC
          LIMIT 2`,
        params
      );
      if (result.rows.length > 1) {
        const error = new Error('CWA entry identity matches multiple legacy canonical objects');
        error.code = 'EXTERNAL_IDENTITY_CONFLICT';
        error.status = 409;
        throw error;
      }
      recordProviderIdentityCompatibilityEvent('cwa', 'legacy_read_provider_item', result.rows[0] ? 'matched' : 'missed');
      return result.rows[0] || null;
    }

    async function reconcileItem({ externalId: externalIdValue, item, sourceUrl = null } = {}, upsert) {
      if (typeof upsert !== 'function') throw new TypeError('CWA entry reconciliation requires an upsert callback');
      const normalized = adapterRegistry.normalizeExternalId('cwa', CWA_IDENTITY_KIND, externalIdValue);
      const externalId = normalized.normalizedExternalId;
      const mediaType = String(item?.media_type || '').trim();
      if (!['book', 'comic_book'].includes(mediaType)) {
        throw new TypeError('CWA entry reconciliation requires a book or comic canonical type');
      }
      return scoped(async (client, scopedIdentities) => {
        const reconciliationArgs = {
          connectionId: binding.providerConnectionId,
          identityKind: CWA_IDENTITY_KIND,
          externalId,
          sourceUrl,
          compatibility: buildCwaCompatibility(externalId),
          canonicalFields: buildCwaCanonicalFields(item)
        };
        const reconcileWork = async ({ resolvedMediaId }) => {
          const legacy = resolvedMediaId ? null : await legacyCandidate(client, externalId, mediaType);
          const value = await upsert(Object.freeze({
            client,
            preferredMediaId: resolvedMediaId || legacy?.id || null,
            matchedBy: resolvedMediaId ? 'external_identity' : (legacy ? 'legacy_cwa_entry' : null)
          }));
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
        return reconciled;
      });
    }

    return Object.freeze({ connectionId: binding.providerConnectionId, reconcileItem });
  }

  return Object.freeze({ open });
}

module.exports = { createCwaImportIdentityModule };
