'use strict';

const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const { fetchPlexNowPlayingSessions } = require('../services/plex');
const {
  loadAdminIntegrationConfig,
  loadIntegrationConfigRow,
  normalizeIntegrationRecord
} = require('../services/integrations');

const repoRootCandidate = path.resolve(__dirname, '..', '..');
const repoRoot = repoRootCandidate !== path.parse(repoRootCandidate).root && fs.existsSync(path.join(repoRootCandidate, 'backend'))
  ? repoRootCandidate
  : path.resolve(__dirname, '..');
const evidencePath = path.join(repoRoot, 'artifacts', 'plex-now-playing', 'plex-real-now-playing-runtime-proof.json');

function writeEvidence(payload) {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(payload, null, 2));
}

function assertSecretFree(payload) {
  const serialized = JSON.stringify(payload);
  const forbidden = [
    /X-Plex-Token=/i,
    /\/private\/media/i,
    /\b(?:10|127|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
    /machineIdentifier/i,
    /plexApiKey/i,
    /plex_api_key/i
  ];
  const matched = forbidden.find((pattern) => pattern.test(serialized));
  if (matched) {
    throw new Error(`Real Plex now-playing evidence contains forbidden secret-adjacent data: ${matched}`);
  }
}

function sanitizeDetail(value) {
  return String(value || '')
    .replace(/X-Plex-Token=[^&\s"]+/gi, 'X-Plex-Token=[redacted]')
    .replace(/\b(?:10|127|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\b/g, '[redacted-host]')
    .replace(/https?:\/\/[^\s"]+/gi, '[redacted-url]')
    .slice(0, 300);
}

function summarizeSessions(sessions) {
  const playerStates = [...new Set(sessions.map((session) => session.player?.state).filter(Boolean))].sort();
  const types = [...new Set(sessions.map((session) => session.type).filter(Boolean))].sort();
  return {
    sessionCount: sessions.length,
    types,
    playerStates,
    sessionsWithMetadataKey: sessions.filter((session) => Boolean(session.metadataKey)).length,
    sessionsWithThumbKey: sessions.filter((session) => Boolean(session.thumbKey)).length,
    sessionsWithArtKey: sessions.filter((session) => Boolean(session.artKey)).length,
    sessionsWithProgress: sessions.filter((session) => Number.isFinite(session.progressPercent)).length,
    sessionsWithQueueItem: sessions.filter((session) => Boolean(session.hasQueueItem)).length,
    sampleSessions: sessions.slice(0, 5).map((session) => ({
      title: session.title,
      type: session.type,
      grandparentTitle: session.grandparentTitle,
      parentTitle: session.parentTitle,
      year: session.year,
      progressPercent: session.progressPercent,
      hasMetadataKey: Boolean(session.metadataKey),
      hasThumbKey: Boolean(session.thumbKey),
      hasArtKey: Boolean(session.artKey),
      hasQueueItem: Boolean(session.hasQueueItem),
      playerState: session.player?.state || null,
      playerPlatform: session.player?.platform || null
    }))
  };
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

async function main() {
  const startedAt = new Date().toISOString();
  const selected = await loadFirstConfiguredPlexConfig();

  try {
    if (!selected.configured) {
      const evidence = {
        generatedAt: startedAt,
        mode: 'real-pms',
        ok: true,
        status: 'skipped',
        scope: selected.scope,
        path: '/status/sessions',
        configured: false,
        detail: 'No saved Plex API URL and token were available in the running stack.',
        assertions: [
          'real PMS proof did not run because no saved Plex settings were configured',
          'no Plex token, provider URL, player IP, machine identifier, or media file path was written'
        ]
      };
      assertSecretFree(evidence);
      writeEvidence(evidence);
      console.log(JSON.stringify(evidence, null, 2));
      return;
    }

    const sessions = await fetchPlexNowPlayingSessions(selected.config);
    const summary = summarizeSessions(sessions);
    const evidence = {
      generatedAt: startedAt,
      mode: 'real-pms',
      ok: true,
      status: 'passed',
      scope: selected.scope,
      path: '/status/sessions',
      configured: true,
      reachable: true,
      ...summary,
      viewerReadiness: {
        canShowCurrentTitle: sessions.length > 0,
        canShowProgress: summary.sessionsWithProgress > 0,
        canUsePlexRelativePosterKey: summary.sessionsWithThumbKey > 0 || summary.sessionsWithArtKey > 0,
        canInferQueuePresence: summary.sessionsWithQueueItem > 0,
        note: sessions.length
          ? 'Real PMS returned active sessions. Poster keys are represented only as Plex-relative keys for a future authenticated proxy.'
          : 'Real PMS was reachable but no active sessions were present during this proof run.'
      },
      assertions: [
        'real saved Plex settings reached PMS /status/sessions',
        'evidence contains only sanitized session shape and field-coverage counts',
        'no Plex token, provider URL, player IP, machine identifier, or media file path was written',
        'existing Plex import paths were not called'
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
    mode: 'real-pms',
    ok: false,
    status: 'failed',
    path: '/status/sessions',
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
