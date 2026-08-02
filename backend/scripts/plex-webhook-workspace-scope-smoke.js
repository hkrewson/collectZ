#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

class HttpClient {
  constructor() {
    this.cookies = new Map();
    this.csrfToken = '';
  }

  applyCookies(headers) {
    const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const value of values) {
      const pair = String(value).split(';')[0] || '';
      const split = pair.indexOf('=');
      if (split > 0) this.cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
  }

  async request(path, { method = 'GET', body, withCsrf = false, expectStatus = 200 } = {}) {
    if (withCsrf && !this.csrfToken) {
      const csrf = await this.request('/api/auth/csrf-token');
      this.csrfToken = csrf.data?.csrfToken || '';
    }
    const headers = { Accept: 'application/json' };
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    if (withCsrf) headers['x-csrf-token'] = this.csrfToken;
    if (this.cookies.size > 0) headers.Cookie = Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined || isForm ? body : JSON.stringify(body)
    });
    this.applyCookies(response.headers);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (response.status !== expectStatus) {
      throw new Error(`${method} ${path} expected ${expectStatus}, got ${response.status}: ${JSON.stringify(data)}`);
    }
    return { status: response.status, data };
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const suffix = crypto.randomBytes(6).toString('hex');
  const email = `plex-workspace-scope-${suffix}@example.com`;
  const password = `PlexWorkspace-${suffix}!`;
  const client = new HttpClient();
  let userId = null;
  let spaceId = null;
  let libraryId = null;
  let rawToken = '';
  let displayToken = '';

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await pool.query(
      `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
       VALUES ($1, $2, 'Plex Workspace Scope Smoke', 'admin', true, NOW())
       RETURNING id`,
      [email, passwordHash]
    );
    userId = Number(user.rows[0].id);
    const space = await pool.query(
      `INSERT INTO spaces (name, slug, created_by)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [`Plex Workspace Scope ${suffix}`, `plex-workspace-scope-${suffix}`, userId]
    );
    spaceId = Number(space.rows[0].id);
    await pool.query(
      `INSERT INTO space_memberships (space_id, user_id, role, created_by)
       VALUES ($1, $2, 'owner', $2)`,
      [spaceId, userId]
    );
    const library = await pool.query(
      `INSERT INTO libraries (space_id, name, created_by)
       VALUES ($1, 'Plex Workspace Scope Library', $2)
       RETURNING id`,
      [spaceId, userId]
    );
    libraryId = Number(library.rows[0].id);
    await pool.query(
      `INSERT INTO library_memberships (user_id, library_id, role)
       VALUES ($1, $2, 'owner')`,
      [userId, libraryId]
    );
    await pool.query(
      `UPDATE users SET active_space_id = $2, active_library_id = $3 WHERE id = $1`,
      [userId, spaceId, libraryId]
    );

    await client.request('/api/auth/csrf-token');
    await client.request('/api/auth/login', { method: 'POST', body: { email, password }, withCsrf: true });
    client.csrfToken = '';

    const generatedDisplay = await client.request(`/api/spaces/${spaceId}/integrations/plex-now-playing-display-token`, {
      method: 'POST',
      body: {},
      withCsrf: true
    });
    displayToken = String(generatedDisplay.data?.token || '');
    assert(displayToken.startsWith('cznp_'), 'Workspace display generation did not return a one-time token');
    assert(generatedDisplay.data?.plexNowPlayingDisplayToken?.enabled === true, 'Workspace display token was not enabled');

    const displayPreferences = await client.request(`/api/spaces/${spaceId}/integrations/plex-now-playing-display-preferences`, {
      method: 'PUT',
      body: { preferences: { layoutMode: 'poster_only', textScale: 'large', showContext: false } },
      withCsrf: true
    });
    assert(displayPreferences.data?.plexNowPlayingDisplayPreferences?.layoutMode === 'poster_only', 'Workspace display preferences were not saved');

    const generated = await client.request(`/api/spaces/${spaceId}/integrations/plex-webhook-receiver-token`, {
      method: 'POST',
      body: {},
      withCsrf: true
    });
    rawToken = String(generated.data?.token || '');
    assert(rawToken.startsWith('czpw_'), 'Workspace receiver generation did not return a one-time token');
    assert(generated.data?.plexWebhookReceiver?.scope === 'workspace', 'Generated receiver was not workspace-scoped');
    assert(Number(generated.data?.plexWebhookReceiver?.spaceId || 0) === spaceId, 'Generated receiver returned the wrong workspace');

    const reloaded = await client.request(`/api/spaces/${spaceId}/integrations`);
    assert(reloaded.data?.plexWebhookReceiver?.enabled === true, 'Workspace receiver did not survive GET reload');
    assert(reloaded.data?.plexWebhookReceiver?.scope === 'workspace', 'Reloaded receiver lost workspace scope');
    assert(Number(reloaded.data?.plexWebhookReceiver?.spaceId || 0) === spaceId, 'Reloaded receiver returned the wrong workspace');
    assert(!JSON.stringify(reloaded.data).includes(rawToken), 'Workspace integration reload exposed the raw receiver token');
    assert(reloaded.data?.plexNowPlayingDisplayToken?.enabled === true, 'Workspace display token did not survive GET reload');
    assert(reloaded.data?.plexNowPlayingDisplayPreferences?.layoutMode === 'poster_only', 'Workspace display preferences did not survive GET reload');
    assert(!JSON.stringify(reloaded.data).includes(displayToken), 'Workspace integration reload exposed the raw display token');

    const globalAutomationBefore = await pool.query(
      `SELECT plex_reconciliation_sync_enabled,
              plex_reconciliation_sync_interval_minutes,
              plex_reconciliation_sync_limit,
              plex_readback_refresh_enabled,
              plex_readback_refresh_interval_minutes,
              plex_readback_refresh_max_items,
              plex_rating_writeback_enabled,
              plex_watch_state_writeback_enabled
         FROM app_integrations
        WHERE id = 1`
    );
    const saved = await client.request(`/api/spaces/${spaceId}/integrations`, {
      method: 'PUT',
      body: {
        plexApiUrl: 'http://plex.workspace.invalid:32400',
        plexApiKey: `workspace-plex-${suffix}`,
        plexReconciliationSyncSettings: { enabled: true, intervalMinutes: 180, limit: 250 },
        plexReadbackRefreshSettings: { enabled: true, intervalMinutes: 30, maxItems: 125 },
        plexWritebackSettings: { ratingEnabled: true, watchStateEnabled: false }
      },
      withCsrf: true
    });
    assert(saved.data?.plexWebhookReceiver?.enabled === true, 'Workspace Save cleared the receiver state');
    assert(Number(saved.data?.plexWebhookReceiver?.spaceId || 0) === spaceId, 'Workspace Save returned the wrong receiver scope');
    assert(saved.data?.plexNowPlayingDisplayToken?.enabled === true, 'Workspace Save cleared the display token state');
    assert(saved.data?.plexReconciliationSyncSettings?.enabled === true, 'Workspace Save did not retain reconciliation enablement');
    assert(saved.data?.plexReconciliationSyncSettings?.intervalMinutes === 180, 'Workspace Save did not retain reconciliation cadence');
    assert(
      saved.data?.plexReadbackRefreshSettings?.enabled === true,
      `Workspace Save did not retain readback enablement: ${JSON.stringify(saved.data?.plexReadbackRefreshSettings || null)}`
    );
    assert(saved.data?.plexReadbackRefreshSettings?.maxItems === 125, 'Workspace Save did not retain readback batch size');
    assert(saved.data?.plexWritebackSettings?.ratingEnabled === true, 'Workspace Save did not retain rating writeback');
    assert(saved.data?.plexWritebackSettings?.watchStateEnabled === false, 'Workspace Save changed watched-state writeback unexpectedly');

    const persistedAutomation = await pool.query(
      `SELECT plex_reconciliation_sync_enabled,
              plex_reconciliation_sync_interval_minutes,
              plex_reconciliation_sync_limit,
              plex_readback_refresh_enabled,
              plex_readback_refresh_interval_minutes,
              plex_readback_refresh_max_items,
              plex_rating_writeback_enabled,
              plex_watch_state_writeback_enabled
         FROM app_integrations
        WHERE space_id = $1`,
      [spaceId]
    );
    assert(persistedAutomation.rows[0]?.plex_reconciliation_sync_enabled === true, 'Reconciliation enablement was not persisted on the workspace row');
    assert(Number(persistedAutomation.rows[0]?.plex_reconciliation_sync_interval_minutes) === 180, 'Reconciliation cadence was not persisted on the workspace row');
    assert(Number(persistedAutomation.rows[0]?.plex_reconciliation_sync_limit) === 250, 'Reconciliation limit was not persisted on the workspace row');
    assert(persistedAutomation.rows[0]?.plex_readback_refresh_enabled === true, 'Readback enablement was not persisted on the workspace row');
    assert(Number(persistedAutomation.rows[0]?.plex_readback_refresh_interval_minutes) === 30, 'Readback cadence was not persisted on the workspace row');
    assert(Number(persistedAutomation.rows[0]?.plex_readback_refresh_max_items) === 125, 'Readback batch size was not persisted on the workspace row');
    assert(persistedAutomation.rows[0]?.plex_rating_writeback_enabled === true, 'Rating writeback was not persisted on the workspace row');
    assert(persistedAutomation.rows[0]?.plex_watch_state_writeback_enabled === false, 'Watched-state writeback was not persisted on the workspace row');

    const globalAutomationAfter = await pool.query(
      `SELECT plex_reconciliation_sync_enabled,
              plex_reconciliation_sync_interval_minutes,
              plex_reconciliation_sync_limit,
              plex_readback_refresh_enabled,
              plex_readback_refresh_interval_minutes,
              plex_readback_refresh_max_items,
              plex_rating_writeback_enabled,
              plex_watch_state_writeback_enabled
         FROM app_integrations
        WHERE id = 1`
    );
    assert(
      JSON.stringify(globalAutomationAfter.rows[0] || null) === JSON.stringify(globalAutomationBefore.rows[0] || null),
      'Workspace integration save changed installation-level Plex automation settings'
    );

    const reconciliationRuntime = await client.request('/api/media/plex-reconciliation-sync/scheduler');
    assert(reconciliationRuntime.data?.runtime?.enabled === true, 'Reconciliation runtime did not discover the enabled workspace row');
    assert(reconciliationRuntime.data?.runtime?.source === 'workspace', 'Reconciliation runtime did not report workspace ownership');
    const readbackRuntime = await client.request('/api/media/plex-watch-state/refresh-scheduler');
    assert(readbackRuntime.data?.runtime?.enabled === true, 'Readback runtime did not discover the enabled workspace row');
    assert(readbackRuntime.data?.runtime?.source === 'workspace', 'Readback runtime did not report workspace ownership');

    const form = new FormData();
    form.append('payload', JSON.stringify({
      event: 'media.play',
      Metadata: { ratingKey: `workspace-scope-${suffix}`, type: 'movie', title: 'Workspace Scope Probe' }
    }));
    const webhookClient = new HttpClient();
    const delivery = await webhookClient.request(`/api/plex/webhooks/${encodeURIComponent(rawToken)}`, {
      method: 'POST',
      body: form
    });
    assert(delivery.data?.accepted === true, 'Workspace receiver did not accept a valid Plex event');
    assert(delivery.data?.importEnqueue?.queued === false, 'Observed-only workspace probe unexpectedly queued an import');

    const rows = await pool.query(
      `SELECT id, space_id, plex_webhook_receiver_last_event
         FROM app_integrations
        WHERE plex_webhook_receiver_token_hash IS NOT NULL`,
    );
    const scoped = rows.rows.find((row) => Number(row.space_id || 0) === spaceId);
    assert(scoped, 'Receiver token was not persisted on the workspace integration row');
    assert(scoped.plex_webhook_receiver_last_event === 'media.play', 'Delivery diagnostics were not written to the workspace row');

    const actionableForm = new FormData();
    actionableForm.append('payload', JSON.stringify({
      event: 'media.rate',
      Metadata: { ratingKey: `workspace-scope-action-${suffix}`, type: 'movie', title: 'Workspace Scope Action Probe' }
    }));
    const actionable = await webhookClient.request(`/api/plex/webhooks/${encodeURIComponent(rawToken)}`, {
      method: 'POST',
      body: actionableForm
    });
    assert(actionable.data?.importEnqueue?.queued === true, 'Actionable workspace webhook did not queue a job');
    const queued = await pool.query(
      `SELECT scope
         FROM sync_jobs
        WHERE provider = 'plex'
          AND scope->>'ratingKey' = $1
        ORDER BY id DESC
        LIMIT 1`,
      [`workspace-scope-action-${suffix}`]
    );
    assert(Number(queued.rows[0]?.scope?.spaceId || 0) === spaceId, 'Queued webhook job lost its workspace id');
    assert(Number(queued.rows[0]?.scope?.libraryId || 0) === libraryId, 'Queued webhook job lost its workspace library id');

    const displayState = await pool.query(
      `SELECT plex_now_playing_display_token_hash, plex_now_playing_display_preferences
         FROM app_integrations
        WHERE space_id = $1`,
      [spaceId]
    );
    assert(Boolean(displayState.rows[0]?.plex_now_playing_display_token_hash), 'Display token was not stored on the workspace row');
    assert(displayState.rows[0]?.plex_now_playing_display_preferences?.layoutMode === 'poster_only', 'Display preferences were not stored on the workspace row');

    await client.request(`/api/spaces/${spaceId}/integrations/plex-now-playing-display-token`, {
      method: 'DELETE',
      withCsrf: true
    });

    await client.request(`/api/spaces/${spaceId}/integrations/plex-webhook-receiver-token`, {
      method: 'DELETE',
      withCsrf: true
    });

    console.log(JSON.stringify({
      ok: true,
      scope: 'workspace',
      generated: true,
      reloadPreserved: true,
      savePreserved: true,
      automationPersistedOnWorkspace: true,
      installationAutomationUnchanged: true,
      schedulerRuntimeResolvedFromWorkspace: true,
      deliveryRecordedOnWorkspace: true,
      queuedJobScopedToWorkspaceLibrary: true,
      nowPlayingDisplayScopedToWorkspace: true,
      revoked: true
    }, null, 2));
  } finally {
    if (spaceId) await pool.query("DELETE FROM sync_jobs WHERE provider = 'plex' AND scope->>'spaceId' = $1", [String(spaceId)]).catch(() => {});
    if (spaceId) await pool.query('DELETE FROM app_integrations WHERE space_id = $1', [spaceId]).catch(() => {});
    if (libraryId) await pool.query('DELETE FROM library_memberships WHERE library_id = $1', [libraryId]).catch(() => {});
    if (libraryId) await pool.query('DELETE FROM libraries WHERE id = $1', [libraryId]).catch(() => {});
    if (spaceId) await pool.query('DELETE FROM space_memberships WHERE space_id = $1', [spaceId]).catch(() => {});
    if (spaceId) await pool.query('DELETE FROM spaces WHERE id = $1', [spaceId]).catch(() => {});
    if (userId) await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
