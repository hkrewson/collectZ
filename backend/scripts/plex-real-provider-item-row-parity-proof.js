'use strict';

const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const {
  fetchPlexMediaProviders,
  extractPlexProviderItemListingCandidates,
  fetchPlexProviderItemRows
} = require('../services/plex');
const {
  loadAdminIntegrationConfig,
  loadIntegrationConfigRow,
  normalizeIntegrationRecord
} = require('../services/integrations');

const repoRootCandidate = path.resolve(__dirname, '..', '..');
const repoRoot = repoRootCandidate !== path.parse(repoRootCandidate).root && fs.existsSync(path.join(repoRootCandidate, 'backend'))
  ? repoRootCandidate
  : path.resolve(__dirname, '..');
const evidencePath = path.join(repoRoot, 'artifacts', 'plex-provider-item-row-parity', 'plex-real-provider-item-row-parity-proof.json');

function writeEvidence(payload) {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(payload, null, 2));
}

function sanitizeDetail(value) {
  return String(value || '')
    .replace(/X-Plex-Token=[^&\s"]+/gi, 'X-Plex-Token=[redacted]')
    .replace(/\b(?:10|127|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\b/g, '[redacted-host]')
    .replace(/https?:\/\/[^\s"]+/gi, '[redacted-url]')
    .slice(0, 300);
}

function assertSecretFree(payload) {
  const serialized = JSON.stringify(payload);
  const forbidden = [
    /X-Plex-Token=/i,
    /\/private\/media/i,
    /\b(?:10|127|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
    /machineIdentifier/i,
    /plexApiKey/i,
    /plex_api_key/i,
    /file_path/i,
    /"file"/i
  ];
  const matched = forbidden.find((pattern) => pattern.test(serialized));
  if (matched) {
    throw new Error(`Real Plex provider item-row evidence contains forbidden secret-adjacent data: ${matched}`);
  }
}

async function loadFirstConfiguredPlexConfig() {
  const explicitSpaceId = Number(process.env.PLEX_PROOF_SPACE_ID || 0) || null;
  if (explicitSpaceId) {
    const row = await loadIntegrationConfigRow(explicitSpaceId, { allowFallback: false });
    const config = normalizeIntegrationRecord(row || null);
    return {
      scope: `space:${explicitSpaceId}`,
      configured: Boolean(config.plexApiUrl && config.plexApiKey),
      config
    };
  }

  const adminConfig = await loadAdminIntegrationConfig();
  if (adminConfig.plexApiUrl && adminConfig.plexApiKey) {
    return {
      scope: 'admin',
      configured: true,
      config: adminConfig
    };
  }

  const scoped = await pool.query(
    `SELECT *
       FROM app_integrations
      WHERE space_id IS NOT NULL
        AND COALESCE(plex_api_url, '') <> ''
        AND plex_api_key_encrypted IS NOT NULL
      ORDER BY id ASC
      LIMIT 1`
  );
  if (scoped.rows[0]) {
    const config = normalizeIntegrationRecord(scoped.rows[0]);
    return {
      scope: `space:${scoped.rows[0].space_id}`,
      configured: Boolean(config.plexApiUrl && config.plexApiKey),
      config
    };
  }

  return {
    scope: explicitSpaceId ? `space:${explicitSpaceId}` : 'admin',
    configured: false,
    config: adminConfig
  };
}

function summarizeCoverage(items) {
  const rows = Array.isArray(items) ? items : [];
  const has = (predicate) => rows.filter(predicate).length;
  return {
    rowCount: rows.length,
    mediaTypes: [...new Set(rows.map((item) => item.normalized?.media_type).filter(Boolean))].sort(),
    rowsWithPlexRatingKey: has((item) => Boolean(item.normalized?.plex_rating_key || item.raw?.ratingKey)),
    rowsWithPlexGuid: has((item) => Boolean(item.normalized?.plex_guid || item.raw?.guid)),
    rowsWithTmdbId: has((item) => Boolean(item.normalized?.tmdb_id)),
    rowsWithPosterKey: has((item) => Boolean(item.raw?.thumb || item.raw?.art)),
    rowsWithVariantResolution: has((item) => Boolean(item.variant?.video_height || item.variant?.resolution)),
    rowsWithWatchState: has((item) => item.raw?.viewCount !== undefined || item.raw?.viewedAt !== undefined || item.raw?.lastViewedAt !== undefined || item.raw?.viewOffset !== undefined),
    rowsWithUserRating: has((item) => item.raw?.userRating !== undefined),
    rowsWithSeasonCounts: has((item) => item.raw?.leafCount !== undefined || item.raw?.viewedLeafCount !== undefined),
    sampleRows: rows.slice(0, 5).map((item) => ({
      candidateType: item.candidateType || null,
      mediaType: item.normalized?.media_type || null,
      hasTitle: Boolean(item.normalized?.title),
      hasPlexRatingKey: Boolean(item.normalized?.plex_rating_key || item.raw?.ratingKey),
      hasPlexGuid: Boolean(item.normalized?.plex_guid || item.raw?.guid),
      hasTmdbId: Boolean(item.normalized?.tmdb_id),
      hasPosterKey: Boolean(item.raw?.thumb || item.raw?.art),
      hasVariantResolution: Boolean(item.variant?.video_height || item.variant?.resolution),
      hasWatchState: item.raw?.viewCount !== undefined || item.raw?.viewedAt !== undefined || item.raw?.lastViewedAt !== undefined || item.raw?.viewOffset !== undefined,
      hasUserRating: item.raw?.userRating !== undefined,
      hasSeasonCounts: item.raw?.leafCount !== undefined || item.raw?.viewedLeafCount !== undefined
    }))
  };
}

function buildParityDecision(summary) {
  const hasRows = summary.rowCount > 0;
  const hasStrongIdentity = summary.rowsWithPlexRatingKey > 0 && (summary.rowsWithPlexGuid > 0 || summary.rowsWithTmdbId > 0);
  const hasArtwork = summary.rowsWithPosterKey > 0;
  const hasVariants = summary.rowsWithVariantResolution > 0;
  const hasWatchOrRating = summary.rowsWithWatchState > 0 || summary.rowsWithUserRating > 0;
  return {
    realServerRowsReturned: hasRows,
    candidateRowsHaveStrongIdentity: hasStrongIdentity,
    candidateRowsHaveArtworkKeys: hasArtwork,
    candidateRowsHaveVariantResolution: hasVariants,
    candidateRowsHaveWatchOrRatingState: hasWatchOrRating,
    importMigrationReady: false,
    decision: hasRows
      ? 'real_provider_candidate_rows_returned_but_import_behavior_remains_legacy_until_full_field_parity_and_repeat_sync_safety_are_proven'
      : 'real_provider_candidate_rows_not_available_so_legacy_import_remains_current'
  };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const selected = await loadFirstConfiguredPlexConfig();

  try {
    if (!selected.configured) {
      const evidence = {
        generatedAt,
        provider: 'plex',
        mode: 'real-pms',
        processingMode: 'provider_item_row_parity_proof',
        ok: true,
        status: 'skipped',
        configured: false,
        scope: selected.scope,
        readOnly: true,
        importMutation: false,
        plexWriteback: false,
        detail: 'No saved Plex API URL and token were available in the running stack.',
        assertions: [
          'real PMS provider item-row proof did not run because no saved Plex settings were configured',
          'no Plex token, provider URL, private IP, machine identifier, or media file path was written'
        ]
      };
      assertSecretFree(evidence);
      writeEvidence(evidence);
      console.log(JSON.stringify(evidence, null, 2));
      return;
    }

    const providers = await fetchPlexMediaProviders(selected.config);
    const candidates = extractPlexProviderItemListingCandidates(providers);
    const limitedCandidates = candidates.slice(0, 3).map((candidate) => ({
      providerKey: candidate.providerKey || null,
      featureKey: candidate.featureKey || null,
      key: candidate.key,
      type: candidate.type || null,
      content: candidate.content === true
    }));
    const readback = await fetchPlexProviderItemRows(selected.config, limitedCandidates, { maxCandidates: 3, containerSize: 5 });
    const summary = summarizeCoverage(readback.items);
    const parity = buildParityDecision(summary);
    const evidence = {
      generatedAt,
      provider: 'plex',
      mode: 'real-pms',
      processingMode: 'provider_item_row_parity_proof',
      ok: true,
      status: 'passed',
      configured: true,
      reachable: true,
      scope: selected.scope,
      readOnly: true,
      importMutation: false,
      plexWriteback: false,
      providerDiscovery: {
        path: '/media/providers',
        providerCount: providers.length,
        candidateCount: candidates.length
      },
      probedCandidates: limitedCandidates,
      readbacks: readback.readbacks.map((entry) => ({
        key: entry.key,
        providerKey: entry.providerKey || null,
        featureKey: entry.featureKey || null,
        type: entry.type || null,
        ok: entry.ok === true,
        status: entry.status,
        rowCount: entry.rowCount || 0,
        detail: entry.ok ? undefined : sanitizeDetail(entry.detail)
      })),
      fieldCoverage: summary,
      parityDecision: parity,
      nextProofNeeded: [
        'Compare real provider item rows against legacy import rows for the same libraries.',
        'Prove repeat-sync duplicate safety before using provider-advertised keys for import.',
        'Prove TV season and episode leaf parity before replacing legacy TV import paths.'
      ],
      assertions: [
        'real saved Plex settings reached PMS /media/providers',
        'provider-advertised candidate keys were probed read-only with small container limits',
        'evidence contains only sanitized field-coverage counts and boolean samples',
        'no Plex token, provider URL, private IP, machine identifier, or media file path was written',
        'legacy import behavior was not changed'
      ]
    };
    assertSecretFree(evidence);
    writeEvidence(evidence);
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch(async (error) => {
  const evidence = {
    generatedAt: new Date().toISOString(),
    provider: 'plex',
    mode: 'real-pms',
    processingMode: 'provider_item_row_parity_proof',
    ok: false,
    status: 'failed',
    readOnly: true,
    importMutation: false,
    plexWriteback: false,
    detail: sanitizeDetail(error?.message || error)
  };
  try {
    assertSecretFree(evidence);
    writeEvidence(evidence);
  } catch (_) {}
  await pool.end().catch(() => {});
  console.error(error.stack || error.message);
  process.exit(1);
});
