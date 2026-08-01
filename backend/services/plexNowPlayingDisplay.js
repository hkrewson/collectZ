const crypto = require('crypto');
const pool = require('../db/pool');
const { normalizeIntegrationRecord } = require('./integrations');

const NOW_PLAYING_DISPLAY_TOKEN_PREFIX = 'cznp_';
const NOW_PLAYING_TEXT_SCALES = new Set(['compact', 'standard', 'large']);
const NOW_PLAYING_LAYOUT_MODES = new Set(['standard', 'poster_only']);
const DEFAULT_NOW_PLAYING_DISPLAY_PREFERENCES = Object.freeze({
  layoutMode: 'standard',
  showPoster: true,
  showBackdrop: true,
  showContext: true,
  showPlayer: true,
  showProgress: true,
  showUpdatedAt: true,
  showPausedSessions: true,
  showSessionList: true,
  textScale: 'standard'
});

function normalizeNowPlayingDisplayPreferences(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const normalized = { ...DEFAULT_NOW_PLAYING_DISPLAY_PREFERENCES };
  const layoutMode = String(raw.layoutMode || '').trim().toLowerCase();
  if (NOW_PLAYING_LAYOUT_MODES.has(layoutMode)) normalized.layoutMode = layoutMode;
  for (const key of ['showPoster', 'showBackdrop', 'showContext', 'showPlayer', 'showProgress', 'showUpdatedAt', 'showPausedSessions', 'showSessionList']) {
    if (raw[key] !== undefined) normalized[key] = Boolean(raw[key]);
  }
  const textScale = String(raw.textScale || '').trim().toLowerCase();
  if (NOW_PLAYING_TEXT_SCALES.has(textScale)) normalized.textScale = textScale;
  return normalized;
}

function generateNowPlayingDisplayToken() {
  return `${NOW_PLAYING_DISPLAY_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
}

function hashNowPlayingDisplayToken(token) {
  const value = String(token || '').trim();
  if (!value) return '';
  return crypto.createHash('sha256').update(value).digest('hex');
}

function shapeNowPlayingDisplayTokenStatus(config) {
  return {
    enabled: Boolean(config?.plexNowPlayingDisplayTokenHash),
    createdAt: config?.plexNowPlayingDisplayTokenCreatedAt || null,
    lastUsedAt: config?.plexNowPlayingDisplayTokenLastUsedAt || null
  };
}

async function loadConfigForNowPlayingDisplayToken(token, { touch = false } = {}) {
  const rawToken = String(token || '').trim();
  if (!rawToken || !rawToken.startsWith(NOW_PLAYING_DISPLAY_TOKEN_PREFIX)) return null;
  const tokenHash = hashNowPlayingDisplayToken(rawToken);
  const result = await pool.query(
    `SELECT *
       FROM app_integrations
      WHERE plex_now_playing_display_token_hash = $1
      ORDER BY CASE WHEN space_id IS NOT NULL THEN 0 ELSE 1 END, id ASC
      LIMIT 1`,
    [tokenHash]
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  if (touch) {
    await pool.query(
      `UPDATE app_integrations
          SET plex_now_playing_display_token_last_used_at = NOW()
        WHERE id = $1
          AND plex_now_playing_display_token_hash = $2`,
      [row.id, tokenHash]
    ).catch(() => {});
  }
  return normalizeIntegrationRecord(row);
}

module.exports = {
  normalizeNowPlayingDisplayPreferences,
  generateNowPlayingDisplayToken,
  hashNowPlayingDisplayToken,
  shapeNowPlayingDisplayTokenStatus,
  loadConfigForNowPlayingDisplayToken
};
