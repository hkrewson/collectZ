'use strict';

const { appendScopeSql } = require('../db/scopeContext');
const { setCanonicalFieldControl } = require('./canonicalMediaFieldControls');
const { createExternalMediaIdentityService } = require('./externalMediaIdentities');
const { buildOwnedFormatsPayload } = require('./mediaFormats');
const { syncNormalizedMetadataForMedia } = require('./mediaTaxonomy');
const {
  METRON_IDENTITY_KIND,
  buildMetronCanonicalFields,
  buildMetronCompatibility,
  createMetronAdapterRegistry
} = require('./metronIdentity');
const { recordProviderIdentityCompatibilityEvent } = require('./metrics');
const { createProviderIntegrationBindingService } = require('./providerIntegrationBindings');

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 2147483647) {
    const error = new Error(`${label} is invalid`);
    error.code = 'INVALID_METRON_IMPORT_IDENTITY';
    throw error;
  }
  return parsed;
}

function createMetronImportIdentityModule({ pool } = {}) {
  if (!pool) throw new TypeError('Metron import identity module requires a pool');
  const adapterRegistry = createMetronAdapterRegistry();
  const identities = createExternalMediaIdentityService({ pool, adapterRegistry });
  const bindings = createProviderIntegrationBindingService({ pool });

  function normalizeIssueId(value) {
    return adapterRegistry.normalizeExternalId('metron', METRON_IDENTITY_KIND, value).normalizedExternalId;
  }

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
      throw new TypeError('Metron import identity transaction client must provide query()');
    }
    const binding = await bindings.ensureMetronBinding(
      { spaceId, actorId, endpointUrl },
      transactionClient
    );

    async function scoped(work) {
      if (transactionClient) return work(transactionClient, null);
      return identities.transaction({ spaceId, libraryId, actorId }, ({ client, identities: scopedIdentities }) =>
        work(client, scopedIdentities));
    }

    async function knownIssueIds(providerIssueIds = []) {
      const normalizedIds = [...new Set(providerIssueIds.map(normalizeIssueId))];
      if (normalizedIds.length === 0) return new Set();
      return scoped(async (client) => {
        const result = await client.query(
          `SELECT external_id_normalized
             FROM external_media_identities
            WHERE space_id = $1
              AND provider_connection_id = $2
              AND identity_kind = $3
              AND external_id_normalized = ANY($4::text[])
              AND active`,
          [spaceId, binding.providerConnectionId, METRON_IDENTITY_KIND, normalizedIds]
        );
        return new Set(result.rows.map((row) => row.external_id_normalized));
      });
    }

    async function legacyCandidate(client, providerIssueId) {
      const params = [String(providerIssueId).trim()];
      const scopeClause = appendScopeSql(params, { spaceId, libraryId }, {
        spaceColumn: 'm.space_id',
        libraryColumn: 'm.library_id'
      });
      const result = await client.query(
        `SELECT DISTINCT m.id
           FROM media m
           LEFT JOIN media_metadata mm ON mm.media_id = m.id
          WHERE m.media_type = 'comic_book'
            AND (m.import_source = 'metron' OR lower(COALESCE(m.type_details->>'provider_name', '')) = 'metron')
            AND (
              COALESCE(m.type_details->>'provider_issue_id', '') = $1
              OR (mm."key" IN ('provider_issue_id', 'metron_issue_id') AND mm."value" = $1)
            )
            ${scopeClause}
          ORDER BY m.id DESC
          LIMIT 2`,
        params
      );
      if (result.rows.length > 1) {
        const error = new Error('Metron issue identity matches multiple legacy canonical objects');
        error.code = 'EXTERNAL_IDENTITY_CONFLICT';
        error.status = 409;
        throw error;
      }
      recordProviderIdentityCompatibilityEvent(
        'metron',
        'legacy_read_provider_issue',
        result.rows[0] ? 'matched' : 'missed'
      );
      return result.rows[0] || null;
    }

    async function reconcileIssue({ providerIssueId, item, sourceUrl = null } = {}, upsert) {
      if (typeof upsert !== 'function') throw new TypeError('Metron issue reconciliation requires an upsert callback');
      const externalId = String(providerIssueId || '').trim();
      const normalizedExternalId = normalizeIssueId(externalId);
      return scoped(async (client, scopedIdentities) => {
        const reconciliationArgs = {
          connectionId: binding.providerConnectionId,
          identityKind: METRON_IDENTITY_KIND,
          externalId: normalizedExternalId,
          sourceUrl,
          compatibility: buildMetronCompatibility(normalizedExternalId),
          canonicalFields: buildMetronCanonicalFields(item)
        };
        const reconcileWork = async ({ resolvedMediaId }) => {
          const legacy = resolvedMediaId ? null : await legacyCandidate(client, normalizedExternalId);
          const value = await upsert(Object.freeze({
            client,
            preferredMediaId: resolvedMediaId || legacy?.id || null,
            matchedBy: resolvedMediaId ? 'external_identity' : (legacy ? 'legacy_metron_issue' : null)
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
          const formatState = buildOwnedFormatsPayload('comic_book', item?.owned_formats, item?.format);
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

    return Object.freeze({
      connectionId: binding.providerConnectionId,
      normalizeIssueId,
      knownIssueIds,
      reconcileIssue
    });
  }

  return Object.freeze({ open });
}

module.exports = { createMetronImportIdentityModule };
