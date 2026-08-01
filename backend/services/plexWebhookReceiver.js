'use strict';

const crypto = require('crypto');
const pool = require('../db/pool');
const { normalizeIntegrationRecord } = require('./integrations');
const { getRequestOrigin } = require('./requestOrigin');

const PLEX_WEBHOOK_RECEIVER_TOKEN_PREFIX = 'czpw_';

function generatePlexWebhookReceiverToken() {
  return `${PLEX_WEBHOOK_RECEIVER_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
}

function hashPlexWebhookReceiverToken(token) {
  const value = String(token || '').trim();
  if (!value) return '';
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqualHash(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function buildPlexWebhookReceiverPath(token = null) {
  const suffix = token ? `/${encodeURIComponent(token)}` : '/[token]';
  return `/api/plex/webhooks${suffix}`;
}

function buildPlexWebhookReceiverUrl(req, token) {
  return `${getRequestOrigin(req)}${buildPlexWebhookReceiverPath(token)}`;
}

function buildPlexWebhookReceiverTokenFingerprint(config) {
  const hash = String(config?.plexWebhookReceiverTokenHash || '').trim();
  return hash ? hash.slice(0, 10) : null;
}

function buildMaskedPlexWebhookReceiverPath(config) {
  const fingerprint = buildPlexWebhookReceiverTokenFingerprint(config);
  return fingerprint ? buildPlexWebhookReceiverPath(`${PLEX_WEBHOOK_RECEIVER_TOKEN_PREFIX}${fingerprint}...`) : null;
}

function shapePlexWebhookReceiverStatus(config, req = null) {
  const maskedPath = buildMaskedPlexWebhookReceiverPath(config);
  return {
    enabled: Boolean(config?.plexWebhookReceiverTokenHash),
    createdAt: config?.plexWebhookReceiverTokenCreatedAt || null,
    lastRotatedAt: config?.plexWebhookReceiverTokenLastRotatedAt || null,
    lastReceivedAt: config?.plexWebhookReceiverLastReceivedAt || null,
    lastEvent: config?.plexWebhookReceiverLastEvent || null,
    delivery: {
      lastAttemptAt: config?.plexWebhookReceiverLastAttemptAt || null,
      status: config?.plexWebhookReceiverLastAttemptStatus || null,
      detail: config?.plexWebhookReceiverLastAttemptError || null,
      contentType: config?.plexWebhookReceiverLastContentType || null
    },
    validation: {
      status: config?.plexWebhookReceiverLastValidationStatus || null,
      detail: config?.plexWebhookReceiverLastValidationMessage || null,
      validatedAt: config?.plexWebhookReceiverLastValidatedAt || null
    },
    tokenFingerprint: buildPlexWebhookReceiverTokenFingerprint(config),
    receiverPath: buildPlexWebhookReceiverPath(),
    receiverPathMasked: maskedPath,
    receiverUrlMasked: req && maskedPath ? `${getRequestOrigin(req)}${maskedPath}` : null,
    receiverUrlTemplate: req ? `${getRequestOrigin(req)}${buildPlexWebhookReceiverPath()}` : null,
    supportedEvents: ['library.new', 'media.scrobble', 'media.rate'],
    observedOnlyEvents: ['media.play', 'media.pause', 'media.resume', 'media.stop', 'playback.started'],
    processingMode: 'active_webhook_event_queue',
    scope: config?.spaceId ? 'workspace' : 'installation',
    spaceId: config?.spaceId || null
  };
}

function validatePlexWebhookReceiverSetup(config, req) {
  if (!config?.plexWebhookReceiverTokenHash) {
    return { status: 'failed', detail: 'No Plex webhook receiver URL has been generated.' };
  }
  const origin = getRequestOrigin(req);
  let hostname = '';
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch (_) {
    return { status: 'warning', detail: 'Receiver exists, but the request origin could not be parsed for Plex reachability.' };
  }
  if (['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.local')) {
    return { status: 'warning', detail: 'Receiver exists, but this URL appears local-only. Plex must be able to reach the same host.' };
  }
  return { status: 'passed', detail: 'Receiver exists and the advertised host appears reachable outside this browser session.' };
}

async function loadConfigForPlexWebhookReceiverToken(token) {
  const rawToken = String(token || '').trim();
  if (!rawToken || !rawToken.startsWith(PLEX_WEBHOOK_RECEIVER_TOKEN_PREFIX)) return null;
  const actualHash = hashPlexWebhookReceiverToken(rawToken);
  const result = await pool.query(
    `SELECT *
       FROM app_integrations
      WHERE plex_webhook_receiver_token_hash = $1
      ORDER BY CASE WHEN space_id IS NULL THEN 1 ELSE 0 END, id ASC
      LIMIT 1`,
    [actualHash]
  );
  const row = result.rows[0] || null;
  if (!row || !safeEqualHash(actualHash, row.plex_webhook_receiver_token_hash)) return null;
  return normalizeIntegrationRecord(row);
}

async function recordPlexWebhookDelivery(config, { status, detail = null, contentType = null, acceptedEvent = null } = {}) {
  if (!config?.integrationId || !config?.plexWebhookReceiverTokenHash) return;
  const accepted = status === 'accepted' && acceptedEvent;
  await pool.query(
    `UPDATE app_integrations
        SET plex_webhook_receiver_last_attempt_at = NOW(),
            plex_webhook_receiver_last_attempt_status = $1,
            plex_webhook_receiver_last_attempt_error = $2,
            plex_webhook_receiver_last_content_type = $3,
            plex_webhook_receiver_last_received_at = CASE WHEN $4::boolean THEN NOW() ELSE plex_webhook_receiver_last_received_at END,
            plex_webhook_receiver_last_event = CASE WHEN $4::boolean THEN $5 ELSE plex_webhook_receiver_last_event END
      WHERE id = $6
        AND plex_webhook_receiver_token_hash = $7`,
    [
      String(status || 'received').slice(0, 20),
      detail ? String(detail).slice(0, 1000) : null,
      contentType ? String(contentType).slice(0, 120) : null,
      Boolean(accepted),
      acceptedEvent || null,
      config.integrationId,
      config.plexWebhookReceiverTokenHash
    ]
  );
}

module.exports = {
  PLEX_WEBHOOK_RECEIVER_TOKEN_PREFIX,
  generatePlexWebhookReceiverToken,
  hashPlexWebhookReceiverToken,
  buildPlexWebhookReceiverPath,
  buildPlexWebhookReceiverUrl,
  shapePlexWebhookReceiverStatus,
  validatePlexWebhookReceiverSetup,
  loadConfigForPlexWebhookReceiverToken,
  recordPlexWebhookDelivery
};
