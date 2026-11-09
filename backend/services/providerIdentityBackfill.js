'use strict';

const MODES = new Set(['plan', 'apply']);

function publicClaim(claim = {}) {
  return {
    mediaId: claim.mediaId,
    spaceId: claim.spaceId,
    libraryId: claim.libraryId ?? null,
    providerType: claim.providerType,
    identityKind: claim.identityKind,
    providerConnectionId: claim.providerConnectionId,
    externalIdFingerprint: claim.externalIdFingerprint,
    evidenceKeys: Array.isArray(claim.evidenceKeys) ? [...claim.evidenceKeys] : []
  };
}

function publicDiagnostic(item = {}) {
  const projected = {
    code: item.code,
    mediaId: item.mediaId,
    spaceId: item.spaceId,
    libraryId: item.libraryId ?? null,
    providerType: item.providerType ?? null,
    identityKind: item.identityKind ?? null,
    providerConnectionId: item.providerConnectionId ?? null,
    externalIdFingerprint: item.externalIdFingerprint ?? null,
    evidenceKeys: Array.isArray(item.evidenceKeys) ? [...item.evidenceKeys] : []
  };
  if (Array.isArray(item.connectionIds)) projected.connectionIds = [...item.connectionIds];
  if (Array.isArray(item.candidateMediaIds)) projected.candidateMediaIds = [...item.candidateMediaIds];
  if (item.providerName !== undefined) projected.providerName = item.providerName;
  if (item.importSource !== undefined) projected.importSource = item.importSource;
  return projected;
}

function createProviderIdentityBackfill({ identityService, planner } = {}) {
  if (!identityService || typeof identityService.transaction !== 'function') {
    throw new TypeError('Provider identity backfill requires an external identity service');
  }
  if (!planner || typeof planner.planWorkspace !== 'function') {
    throw new TypeError('Provider identity backfill requires a planner');
  }

  async function run({ spaceId, actorId, mode = 'plan' } = {}) {
    const normalizedMode = String(mode || '').trim().toLowerCase();
    if (!MODES.has(normalizedMode)) throw new TypeError('Provider identity backfill mode must be plan or apply');

    return identityService.transaction({ spaceId, actorId }, async ({ client, identities }) => {
      const plan = await planner.planWorkspace(client, spaceId);
      const applied = [];
      if (normalizedMode === 'apply') {
        for (const action of plan.actions) {
          await identities.attach({
            connectionId: action.providerConnectionId,
            identityKind: action.identityKind,
            externalId: action.externalId,
            mediaId: action.mediaId
          });
          applied.push(publicClaim(action));
        }
      }

      return {
        mode: normalizedMode,
        summary: {
          ...plan.summary,
          planned: plan.actions.length,
          applied: applied.length
        },
        candidates: plan.actions.map(publicClaim),
        applied,
        aligned: plan.aligned.map(publicClaim),
        diagnostics: plan.diagnostics.map(publicDiagnostic)
      };
    });
  }

  return Object.freeze({ run });
}

module.exports = {
  createProviderIdentityBackfill,
  publicClaim,
  publicDiagnostic
};
