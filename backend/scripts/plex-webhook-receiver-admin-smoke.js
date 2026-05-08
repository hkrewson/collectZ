#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ARTIFACT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'artifacts',
  'plex-webhooks',
  'plex-webhook-receiver-admin-smoke.json'
);

class HttpClient {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
    this.csrfToken = '';
  }

  applySetCookies(headers) {
    const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const cookieLine of raw) {
      const firstPart = String(cookieLine).split(';')[0] || '';
      const idx = firstPart.indexOf('=');
      if (idx <= 0) continue;
      const key = firstPart.slice(0, idx).trim();
      const value = firstPart.slice(idx + 1).trim();
      if (key) this.cookies.set(key, value);
    }
  }

  cookieHeader() {
    return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async request(path, options = {}) {
    const { method = 'GET', body, expectStatus, withCsrf = false, headers: extraHeaders = {} } = options;
    const headers = { Accept: 'application/json', ...extraHeaders };
    let requestBody = body;
    if (body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      requestBody = JSON.stringify(body);
    }
    if (withCsrf) {
      if (!this.csrfToken) await this.fetchCsrfToken();
      headers['x-csrf-token'] = this.csrfToken;
    }
    const cookieHeader = this.cookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;

    const response = await fetch(`${BASE_URL}${path}`, { method, headers, body: requestBody });
    this.applySetCookies(response.headers);
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (expectStatus !== undefined && response.status !== expectStatus) {
      throw new Error(`[${this.name}] ${method} ${path} expected ${expectStatus}, got ${response.status}. Body: ${JSON.stringify(data)}`);
    }
    return { status: response.status, data, headers: response.headers };
  }

  async fetchCsrfToken() {
    const response = await this.request('/api/auth/csrf-token', { expectStatus: 200 });
    const token = response?.data?.csrfToken;
    if (!token) throw new Error(`[${this.name}] Missing CSRF token`);
    this.csrfToken = token;
    return token;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSecretFree(value, label = 'payload', rawToken = '') {
  const text = JSON.stringify(value);
  if (rawToken) assert(!text.includes(rawToken), `${label} surfaced raw webhook receiver token`);
  assert(!/X-Plex-Token=/i.test(text), `${label} surfaced a Plex token query string`);
  assert(!/receiver-admin-token/i.test(text), `${label} surfaced fixture token text`);
  assert(!/server-uuid-secret/i.test(text), `${label} surfaced raw server UUID`);
  assert(!/\/mnt\/plex-media/i.test(text), `${label} surfaced raw media file path`);
}

async function createDirectUser({ email, password, name, role = 'admin' }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, $3, $4, true, NOW())
     RETURNING id`,
    [email, passwordHash, name, role]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

async function snapshotPlexWebhookSettings() {
  const result = await pool.query(
    `SELECT plex_webhook_receiver_token_hash,
            plex_webhook_receiver_token_created_at,
            plex_webhook_receiver_token_last_rotated_at,
            plex_webhook_receiver_last_received_at,
            plex_webhook_receiver_last_event
       FROM app_integrations
      WHERE id = 1`
  );
  return result.rows[0] || null;
}

async function restorePlexWebhookSettings(snapshot) {
  if (!snapshot) {
    await pool.query(
      `UPDATE app_integrations
          SET plex_webhook_receiver_token_hash = NULL,
              plex_webhook_receiver_token_created_at = NULL,
              plex_webhook_receiver_token_last_rotated_at = NULL,
              plex_webhook_receiver_last_received_at = NULL,
              plex_webhook_receiver_last_event = NULL
        WHERE id = 1`
    ).catch(() => {});
    return;
  }
  await pool.query(
    `UPDATE app_integrations
        SET plex_webhook_receiver_token_hash = $1,
            plex_webhook_receiver_token_created_at = $2,
            plex_webhook_receiver_token_last_rotated_at = $3,
            plex_webhook_receiver_last_received_at = $4,
            plex_webhook_receiver_last_event = $5
      WHERE id = 1`,
    [
      snapshot.plex_webhook_receiver_token_hash,
      snapshot.plex_webhook_receiver_token_created_at,
      snapshot.plex_webhook_receiver_token_last_rotated_at,
      snapshot.plex_webhook_receiver_last_received_at,
      snapshot.plex_webhook_receiver_last_event
    ]
  ).catch(() => {});
}

async function cleanupUser(userId) {
  if (!Number.isFinite(Number(userId)) || Number(userId) <= 0) return;
  await pool.query('DELETE FROM users WHERE id = $1', [Number(userId)]).catch(() => {});
}

async function main() {
  const suffix = crypto.randomBytes(6).toString('hex');
  const email = `plex-webhook-admin-${suffix}@example.com`;
  const password = `PlexWebhookAdmin-${suffix}!`;
  const admin = new HttpClient('plex-webhook-admin-smoke');
  const snapshot = await snapshotPlexWebhookSettings();
  let userId = null;
  let rawToken = '';

  try {
    userId = await createDirectUser({ email, password, name: 'Plex Webhook Admin Smoke', role: 'admin' });
    await admin.fetchCsrfToken();
    await admin.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { email, password }
    });
    admin.csrfToken = '';
    await admin.fetchCsrfToken();

    const generated = await admin.request('/api/admin/settings/integrations/plex-webhook-receiver-token', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200
    });
    rawToken = String(generated.data?.token || '');
    assert(rawToken.startsWith('czpw_'), 'Expected generated webhook receiver token prefix');
    assert(String(generated.data?.webhookPath || '').includes(rawToken), 'Expected one-time webhook path with token');
    assert(String(generated.data?.webhookUrl || '').includes(rawToken), 'Expected one-time webhook URL with token');
    assert(generated.data?.plexWebhookReceiver?.enabled === true, `Expected receiver enabled readback: ${JSON.stringify(generated.data)}`);
    assert(!JSON.stringify(generated.data?.plexWebhookReceiver || {}).includes(rawToken), 'Status readback must not include raw token');

    const settings = await admin.request('/api/admin/settings/integrations', { expectStatus: 200 });
    assert(settings.data?.plexWebhookReceiver?.enabled === true, `Expected settings receiver enabled: ${JSON.stringify(settings.data?.plexWebhookReceiver)}`);
    assert(settings.data?.plexWebhookReceiver?.receiverPath === '/api/plex/webhooks/[token]', 'Expected redacted receiver path template');
    assert(!JSON.stringify(settings.data?.plexWebhookReceiver || {}).includes(rawToken), 'Settings readback must not include raw token');

    const invalid = new HttpClient('plex-webhook-invalid-smoke');
    await invalid.request('/api/plex/webhooks/czpw_invalid_receiver_token', {
      method: 'POST',
      expectStatus: 401,
      body: { event: 'library.new', Metadata: { ratingKey: '123' } }
    });

    const webhook = new HttpClient('plex-webhook-valid-smoke');
    const accepted = await webhook.request(`/api/plex/webhooks/${encodeURIComponent(rawToken)}`, {
      method: 'POST',
      expectStatus: 200,
      body: {
        event: 'library.new',
        Metadata: {
          ratingKey: '12345',
          type: 'movie',
          title: 'Receiver Admin New Movie',
          thumb: 'https://plex.example.invalid/thumb?X-Plex-Token=receiver-admin-token',
          Media: [{ Part: [{ file: '/mnt/plex-media/Receiver Admin New Movie.mkv' }] }]
        },
        Server: { title: 'Home Plex', uuid: 'server-uuid-secret' }
      }
    });
    assert(accepted.data?.processingMode === 'contract_only', `Expected contract-only mode: ${JSON.stringify(accepted.data)}`);
    assert(accepted.data?.event === 'library.new', `Expected library.new event: ${JSON.stringify(accepted.data)}`);
    assert(accepted.data?.supported === true, `Expected supported webhook event: ${JSON.stringify(accepted.data)}`);
    assert(accepted.data?.action === 'sync_new_title_hint', `Expected new-title hint action: ${JSON.stringify(accepted.data)}`);
    assert(accepted.data?.metadataReadbackPath === '/library/metadata/12345', `Expected metadata readback path: ${JSON.stringify(accepted.data)}`);
    assertSecretFree(accepted.data, 'accepted webhook response', rawToken);

    const dbReadback = await pool.query(
      `SELECT plex_webhook_receiver_last_received_at, plex_webhook_receiver_last_event
         FROM app_integrations
        WHERE id = 1`
    );
    assert(dbReadback.rows[0]?.plex_webhook_receiver_last_received_at, 'Expected last received timestamp');
    assert(dbReadback.rows[0]?.plex_webhook_receiver_last_event === 'library.new', 'Expected last received event readback');

    const revoked = await admin.request('/api/admin/settings/integrations/plex-webhook-receiver-token', {
      method: 'DELETE',
      withCsrf: true,
      expectStatus: 200
    });
    assert(revoked.data?.plexWebhookReceiver?.enabled === false, `Expected receiver revoked: ${JSON.stringify(revoked.data)}`);
    await webhook.request(`/api/plex/webhooks/${encodeURIComponent(rawToken)}`, {
      method: 'POST',
      expectStatus: 401,
      body: { event: 'media.rate', Metadata: { ratingKey: '12345', userRating: 8 } }
    });

    const evidence = {
      ok: true,
      receiverStatus: {
        enabled: generated.data.plexWebhookReceiver.enabled,
        receiverPath: generated.data.plexWebhookReceiver.receiverPath,
        supportedEvents: generated.data.plexWebhookReceiver.supportedEvents,
        observedOnlyEvents: generated.data.plexWebhookReceiver.observedOnlyEvents,
        processingMode: generated.data.plexWebhookReceiver.processingMode
      },
      invalidTokenRejected: true,
      validWebhookAccepted: {
        event: accepted.data.event,
        supported: accepted.data.supported,
        action: accepted.data.action,
        ratingKey: accepted.data.ratingKey,
        metadataReadbackPath: accepted.data.metadataReadbackPath
      },
      revokeRejectedPreviousToken: true
    };
    assertSecretFree(evidence, 'webhook receiver evidence', rawToken);
    fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
    fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await restorePlexWebhookSettings(snapshot);
    await cleanupUser(userId);
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
