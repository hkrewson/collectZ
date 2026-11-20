#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');
const { encryptSecret } = require('../services/crypto');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const fakePlexToken = `plex-smoke-${crypto.randomBytes(6).toString('hex')}`;
const fakePlexServerUuid = crypto.randomUUID();
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
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body) && !isFormData) {
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assertSecretFree(value, label = 'payload', rawToken = '') {
  const text = JSON.stringify(value);
  if (rawToken) assert(!text.includes(rawToken), `${label} surfaced raw webhook receiver token`);
  assert(!text.includes(fakePlexToken), `${label} surfaced raw Plex token`);
  assert(!text.includes(fakePlexServerUuid), `${label} surfaced raw server UUID`);
  assert(!/X-Plex-Token=/i.test(text), `${label} surfaced a Plex token query string`);
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

async function createIsolatedScope({ userId, suffix }) {
  const space = await pool.query(
    `INSERT INTO spaces (name, slug, created_by, is_personal)
     VALUES ($1, $2, $3, false)
     RETURNING id`,
    [`Plex Webhook Admin Smoke ${suffix}`, `plex-webhook-admin-${suffix}`, userId]
  );
  const spaceId = Number(space.rows[0]?.id || 0) || null;
  await pool.query(
    `INSERT INTO space_memberships (space_id, user_id, role, created_by)
     VALUES ($1, $2, 'owner', $2)`,
    [spaceId, userId]
  );
  const library = await pool.query(
    `INSERT INTO libraries (space_id, name, created_by)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [spaceId, `Plex Webhook Admin Library ${suffix}`, userId]
  );
  const libraryId = Number(library.rows[0]?.id || 0) || null;
  await pool.query(
    `INSERT INTO library_memberships (user_id, library_id, role)
     VALUES ($1, $2, 'owner')`,
    [userId, libraryId]
  );
  await pool.query(
    'UPDATE users SET active_space_id = $2, active_library_id = $3 WHERE id = $1',
    [userId, spaceId, libraryId]
  );
  return { spaceId, libraryId };
}

async function applyFakePlexSettings({ baseUrl, spaceId }) {
  await pool.query(
    `INSERT INTO app_integrations (
       space_id, plex_preset, plex_provider, plex_api_url, plex_api_key_encrypted,
       plex_library_sections, tmdb_api_key_encrypted, updated_at
     )
     VALUES ($1, 'plex', 'plex', $2, $3, $4::jsonb, NULL, NOW())
     ON CONFLICT (space_id) DO UPDATE SET
       plex_preset = EXCLUDED.plex_preset,
       plex_provider = EXCLUDED.plex_provider,
       plex_api_url = EXCLUDED.plex_api_url,
       plex_api_key_encrypted = EXCLUDED.plex_api_key_encrypted,
       plex_library_sections = EXCLUDED.plex_library_sections,
       tmdb_api_key_encrypted = NULL,
       updated_at = NOW()`,
    [spaceId, baseUrl, encryptSecret(fakePlexToken), JSON.stringify(['1'])]
  );
}

async function cleanupTemporaryState({ userId, spaceId, libraryId }) {
  if (spaceId) await pool.query('DELETE FROM app_integrations WHERE space_id = $1', [spaceId]).catch(() => {});
  if (libraryId) {
    await pool.query('DELETE FROM library_memberships WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM libraries WHERE id = $1', [libraryId]).catch(() => {});
  }
  if (spaceId) {
    await pool.query('DELETE FROM space_memberships WHERE space_id = $1', [spaceId]).catch(() => {});
    await pool.query('DELETE FROM spaces WHERE id = $1', [spaceId]).catch(() => {});
  }
  if (userId) await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
}

async function cleanupWebhookJobs({ ratingKey, userId, spaceId, libraryId }) {
  const key = String(ratingKey || '').trim();
  if (!key) return;
  await withAuthorizedScopeTransaction(pool, { spaceId, libraryId }, userId, (client) => client.query(
    `DELETE FROM sync_jobs
      WHERE provider = 'plex'
        AND job_type IN ('plex_webhook_import_hint', 'plex_webhook_state_hint')
        AND scope->>'ratingKey' = $1`,
    [key]
  )).catch(() => {});
}

async function cleanupImportedMedia(ratingKey, title) {
  const key = String(ratingKey || '').trim();
  const mediaTitle = String(title || '').trim();
  const params = [];
  const clauses = [];
  if (key) {
    params.push(`%:${key}`);
    clauses.push(`id IN (
      SELECT media_id
        FROM media_metadata
       WHERE "key" = 'plex_item_key'
         AND "value" LIKE $${params.length}
    )`);
  }
  if (mediaTitle) {
    params.push(mediaTitle);
    clauses.push(`title = $${params.length}`);
  }
  if (clauses.length === 0) return;
  await pool.query(`DELETE FROM media WHERE ${clauses.join(' OR ')}`, params).catch(() => {});
}

async function startFakePmsServer(ratingKey, title) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    requests.push({
      method: req.method,
      pathname: url.pathname,
      hasToken: url.searchParams.has('X-Plex-Token'),
      tokenMatched: url.searchParams.get('X-Plex-Token') === fakePlexToken
    });

    res.setHeader('Content-Type', 'application/xml');
    if (req.method === 'GET' && url.pathname === '/library/metadata/receiver-admin-token') {
      res.writeHead(404);
      res.end('<MediaContainer size="0"></MediaContainer>');
      return;
    }
    if (req.method !== 'GET' || url.pathname !== `/library/metadata/${encodeURIComponent(ratingKey)}`) {
      res.writeHead(404);
      res.end('<MediaContainer size="0"></MediaContainer>');
      return;
    }
    res.writeHead(200);
    res.end(`<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer size="1">
  <Video ratingKey="${ratingKey}" key="/library/metadata/${ratingKey}" type="movie" title="${title}" year="2026" librarySectionID="1" duration="7200000" viewCount="1" viewedAt="1778256000" userRating="8" originallyAvailableAt="2026-05-08" thumb="https://images.example.invalid/plex-webhook-poster.jpg" />
</MediaContainer>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function waitForProcessedWebhookJob({ ratingKey, userId, spaceId, libraryId }, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const readback = await withAuthorizedScopeTransaction(pool, { spaceId, libraryId }, userId, (client) => client.query(
      `SELECT id, job_type, provider, status, scope, progress, summary, error
         FROM sync_jobs
        WHERE provider = 'plex'
          AND job_type = 'plex_webhook_import_hint'
          AND scope->>'ratingKey' = $1
        ORDER BY updated_at DESC
        LIMIT 1`,
      [ratingKey]
    ));
    last = readback.rows[0] || null;
    if (last && ['succeeded', 'failed'].includes(String(last.status))) return last;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for Plex webhook import auto-processing: ${JSON.stringify(last)}`);
}

async function waitForProcessedStateJob({ ratingKey, event, userId, spaceId, libraryId }, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const readback = await withAuthorizedScopeTransaction(pool, { spaceId, libraryId }, userId, (client) => client.query(
      `SELECT id, job_type, provider, status, scope, progress, summary, error
         FROM sync_jobs
        WHERE provider = 'plex'
          AND job_type = 'plex_webhook_state_hint'
          AND scope->>'ratingKey' = $1
          AND scope->>'event' = $2
        ORDER BY updated_at DESC
        LIMIT 1`,
      [ratingKey, event]
    ));
    last = readback.rows[0] || null;
    if (last && ['succeeded', 'failed'].includes(String(last.status))) return last;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for Plex webhook state processing: ${JSON.stringify(last)}`);
}

function buildPlexWebhookForm(payload, { includeThumb = false } = {}) {
  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  if (includeThumb) form.append('thumb', new Blob([Buffer.from('plex-smoke-thumb')], { type: 'image/jpeg' }), 'thumb.jpg');
  return form;
}

async function main() {
  const suffix = crypto.randomBytes(6).toString('hex');
  const email = `plex-webhook-admin-${suffix}@example.com`;
  const password = `PlexWebhookAdmin-${suffix}!`;
  const ratingKey = `receiver-admin-${suffix}`;
  const importedTitle = `Receiver Admin New Movie ${suffix}`;
  const admin = new HttpClient('plex-webhook-admin-smoke');
  let userId = null;
  let spaceId = null;
  let libraryId = null;
  let rawToken = '';
  let fakePms = null;

  try {
    fakePms = await startFakePmsServer(ratingKey, importedTitle);
    userId = await createDirectUser({ email, password, name: 'Plex Webhook Admin Smoke', role: 'admin' });
    const scope = await createIsolatedScope({ userId, suffix });
    spaceId = scope.spaceId;
    libraryId = scope.libraryId;
    assert(spaceId && libraryId, 'Expected isolated workspace and library for Plex webhook smoke');
    await applyFakePlexSettings({ baseUrl: fakePms.baseUrl, spaceId });
    await admin.fetchCsrfToken();
    await admin.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { email, password }
    });
    admin.csrfToken = '';
    await admin.fetchCsrfToken();

    const integrationEndpoint = `/api/spaces/${spaceId}/integrations`;
    const generated = await admin.request(`${integrationEndpoint}/plex-webhook-receiver-token`, {
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

    const settings = await admin.request(integrationEndpoint, { expectStatus: 200 });
    assert(settings.data?.plexWebhookReceiver?.enabled === true, `Expected settings receiver enabled: ${JSON.stringify(settings.data?.plexWebhookReceiver)}`);
    assert(settings.data?.plexWebhookReceiver?.receiverPath === '/api/plex/webhooks/[token]', 'Expected redacted receiver path template');
    assert(String(settings.data?.plexWebhookReceiver?.receiverPathMasked || '').includes('/api/plex/webhooks/czpw_'), 'Expected masked receiver path for existing receiver');
    assert(String(settings.data?.plexWebhookReceiver?.receiverUrlMasked || '').includes('/api/plex/webhooks/czpw_'), 'Expected masked receiver URL for existing receiver');
    assert(String(settings.data?.plexWebhookReceiver?.tokenFingerprint || '').length >= 8, 'Expected stable token fingerprint readback');
    assert(!JSON.stringify(settings.data?.plexWebhookReceiver || {}).includes(rawToken), 'Settings readback must not include raw token');

    const invalid = new HttpClient('plex-webhook-invalid-smoke');
    await invalid.request('/api/plex/webhooks/czpw_invalid_receiver_token', {
      method: 'POST',
      expectStatus: 401,
      body: { event: 'library.new', Metadata: { ratingKey: '123' } }
    });

    const webhook = new HttpClient('plex-webhook-valid-smoke');
    const malformedForm = new FormData();
    malformedForm.append('payload', 'not-json');
    await webhook.request(`/api/plex/webhooks/${encodeURIComponent(rawToken)}`, {
      method: 'POST',
      expectStatus: 400,
      body: malformedForm
    });
    const rejectedDelivery = await pool.query(
      `SELECT plex_webhook_receiver_last_attempt_status,
              plex_webhook_receiver_last_attempt_error,
              plex_webhook_receiver_last_content_type
         FROM app_integrations
        WHERE space_id = $1`,
      [spaceId]
    );
    assert(rejectedDelivery.rows[0]?.plex_webhook_receiver_last_attempt_status === 'rejected', 'Expected malformed multipart delivery to be recorded as rejected');
    assert(String(rejectedDelivery.rows[0]?.plex_webhook_receiver_last_attempt_error || '').includes('not recognized'), 'Expected rejected delivery diagnostic to explain the unrecognized payload');
    assert(String(rejectedDelivery.rows[0]?.plex_webhook_receiver_last_content_type || '').startsWith('multipart/form-data'), 'Expected rejected multipart content type readback');

    const libraryPayload = {
      event: 'library.new',
      Metadata: {
        ratingKey,
        type: 'movie',
        title: importedTitle,
        librarySectionID: '1',
        thumb: `https://plex.example.invalid/thumb?X-Plex-Token=${fakePlexToken}`,
        Media: [{ Part: [{ file: '/mnt/plex-media/Receiver Admin New Movie.mkv' }] }]
      },
      Server: { title: 'Home Plex', uuid: fakePlexServerUuid }
    };
    const accepted = await webhook.request(`/api/plex/webhooks/${encodeURIComponent(rawToken)}`, {
      method: 'POST',
      expectStatus: 200,
      body: buildPlexWebhookForm(libraryPayload, { includeThumb: true })
    });
    assert(accepted.data?.processingMode === 'webhook_event_enqueue', `Expected webhook event enqueue mode: ${JSON.stringify(accepted.data)}`);
    assert(accepted.data?.event === 'library.new', `Expected library.new event: ${JSON.stringify(accepted.data)}`);
    assert(accepted.data?.supported === true, `Expected supported webhook event: ${JSON.stringify(accepted.data)}`);
    assert(accepted.data?.action === 'sync_new_title_hint', `Expected new-title hint action: ${JSON.stringify(accepted.data)}`);
    assert(accepted.data?.metadataReadbackPath === `/library/metadata/${encodeURIComponent(ratingKey)}`, `Expected metadata readback path: ${JSON.stringify(accepted.data)}`);
    assert(accepted.data?.importEnqueue?.queued === true, `Expected webhook import job enqueue: ${JSON.stringify(accepted.data)}`);
    assert(accepted.data?.importEnqueue?.job?.jobType === 'plex_webhook_import_hint', `Expected webhook import hint job: ${JSON.stringify(accepted.data)}`);
    assert(accepted.data?.importEnqueue?.job?.provider === 'plex', `Expected Plex job provider: ${JSON.stringify(accepted.data)}`);
    assert(accepted.data?.importEnqueue?.job?.ratingKey === ratingKey, `Expected queued job rating key: ${JSON.stringify(accepted.data)}`);
    assert(accepted.data?.importEnqueue?.job?.processingMode === 'queued_import_hint', `Expected queued import hint mode: ${JSON.stringify(accepted.data)}`);
    assertSecretFree(accepted.data, 'accepted webhook response', rawToken);

    const duplicate = await webhook.request(`/api/plex/webhooks/${encodeURIComponent(rawToken)}`, {
      method: 'POST',
      expectStatus: 200,
      body: buildPlexWebhookForm({
        event: 'library.new',
        Metadata: { ratingKey, type: 'movie', title: importedTitle, librarySectionID: '1' }
      })
    });
    assert(duplicate.data?.importEnqueue?.queued === true, `Expected duplicate webhook import hint to remain queued: ${JSON.stringify(duplicate.data)}`);
    assert(duplicate.data?.importEnqueue?.job?.existing === true, `Expected duplicate webhook import hint to reuse existing job: ${JSON.stringify(duplicate.data)}`);

    const watched = await webhook.request(`/api/plex/webhooks/${encodeURIComponent(rawToken)}`, {
      method: 'POST',
      expectStatus: 200,
      body: buildPlexWebhookForm({ event: 'media.scrobble', Metadata: { ratingKey, title: importedTitle } })
    });
    assert(watched.data?.processingMode === 'webhook_event_enqueue', `Expected watched-state event to queue refresh: ${JSON.stringify(watched.data)}`);
    assert(watched.data?.importEnqueue?.queued === true, `Expected watched-state event to enqueue refresh: ${JSON.stringify(watched.data)}`);
    assert(watched.data?.importEnqueue?.job?.jobType === 'plex_webhook_state_hint', `Expected watched-state hint job: ${JSON.stringify(watched.data)}`);

    const rated = await webhook.request(`/api/plex/webhooks/${encodeURIComponent(rawToken)}`, {
      method: 'POST',
      expectStatus: 200,
      body: buildPlexWebhookForm({ event: 'media.rate', Metadata: { ratingKey, title: importedTitle, userRating: 8 } })
    });
    assert(rated.data?.importEnqueue?.queued === true, `Expected rating event to enqueue refresh: ${JSON.stringify(rated.data)}`);

    const dbReadback = await pool.query(
      `SELECT plex_webhook_receiver_last_received_at, plex_webhook_receiver_last_event,
              plex_webhook_receiver_last_attempt_at, plex_webhook_receiver_last_attempt_status,
              plex_webhook_receiver_last_attempt_error, plex_webhook_receiver_last_content_type
         FROM app_integrations
        WHERE space_id = $1`,
      [spaceId]
    );
    assert(dbReadback.rows[0]?.plex_webhook_receiver_last_received_at, 'Expected last received timestamp');
    assert(dbReadback.rows[0]?.plex_webhook_receiver_last_event === 'media.rate', 'Expected last received event readback');
    assert(dbReadback.rows[0]?.plex_webhook_receiver_last_attempt_status === 'accepted', 'Expected accepted delivery status');
    assert(!dbReadback.rows[0]?.plex_webhook_receiver_last_attempt_error, 'Expected accepted delivery without error');
    assert(String(dbReadback.rows[0]?.plex_webhook_receiver_last_content_type || '').startsWith('multipart/form-data'), 'Expected multipart content-type readback');

    const queuedJobs = await withAuthorizedScopeTransaction(pool, { spaceId, libraryId }, userId, (client) => client.query(
      `SELECT id, job_type, provider, status, space_id, library_id, scope, progress, summary
         FROM sync_jobs
        WHERE provider = 'plex'
          AND job_type = 'plex_webhook_import_hint'
          AND scope->>'ratingKey' = $1
        ORDER BY created_at DESC`,
      [ratingKey]
    ));
    assert(queuedJobs.rowCount === 1, `Expected one deduped webhook import hint job, got ${queuedJobs.rowCount}`);
    assert(queuedJobs.rows[0]?.status === 'queued', `Expected queued webhook import hint job: ${JSON.stringify(queuedJobs.rows[0])}`);
    assert(Number(queuedJobs.rows[0]?.space_id) > 0, `Expected relational webhook workspace ownership: ${JSON.stringify(queuedJobs.rows[0])}`);
    assert(Number(queuedJobs.rows[0]?.library_id) > 0, `Expected relational webhook library ownership: ${JSON.stringify(queuedJobs.rows[0])}`);
    assert(Number(queuedJobs.rows[0]?.scope?.spaceId) === Number(queuedJobs.rows[0]?.space_id), `Expected webhook workspace projection parity: ${JSON.stringify(queuedJobs.rows[0])}`);
    assert(Number(queuedJobs.rows[0]?.scope?.libraryId) === Number(queuedJobs.rows[0]?.library_id), `Expected webhook library projection parity: ${JSON.stringify(queuedJobs.rows[0])}`);
    assert(queuedJobs.rows[0]?.scope?.processingMode === 'queued_import_hint', `Expected queued import hint scope: ${JSON.stringify(queuedJobs.rows[0])}`);
    assert(queuedJobs.rows[0]?.summary?.processor === 'active_webhook_event_processor', `Expected active webhook processor claim: ${JSON.stringify(queuedJobs.rows[0])}`);

    const autoStatus = await admin.request('/api/media/plex-webhook-import-hints/auto-processor', {
      expectStatus: 200
    });
    assert(autoStatus.data?.runtime?.enabled === true, `Expected webhook import auto-processor enabled: ${JSON.stringify(autoStatus.data)}`);
    assert(autoStatus.data?.processingMode === 'auto_webhook_event_processing', `Expected auto processor readback: ${JSON.stringify(autoStatus.data)}`);

    const processedJob = await waitForProcessedWebhookJob({ ratingKey, userId, spaceId, libraryId });
    assert(processedJob?.status === 'succeeded', `Expected processed webhook import job to succeed: ${JSON.stringify(processedJob)}`);
    assert(processedJob?.summary?.processingMode === 'single_rating_key_import', `Expected single-rating-key processing mode: ${JSON.stringify(processedJob)}`);
    assert(processedJob?.summary?.imported === 1, `Expected one processed Plex metadata item: ${JSON.stringify(processedJob)}`);
    assert((processedJob?.summary?.created || 0) + (processedJob?.summary?.updated || 0) >= 1, `Expected processed hint to create or update a media row: ${JSON.stringify(processedJob)}`);
    assert(fakePms.requests.some((request) => request.pathname === `/library/metadata/${ratingKey}` && request.tokenMatched), `Expected fake PMS metadata readback with Plex token: ${JSON.stringify(fakePms.requests)}`);
    assertSecretFree(processedJob, 'processed webhook job readback', rawToken);

    const watchedJob = await waitForProcessedStateJob({ ratingKey, event: 'media.scrobble', userId, spaceId, libraryId });
    assert(watchedJob?.status === 'succeeded', `Expected watched-state refresh job to succeed: ${JSON.stringify(watchedJob)}`);
    assert(watchedJob?.summary?.processingMode === 'single_rating_key_watch_state_refresh', `Expected watched-state processing mode: ${JSON.stringify(watchedJob)}`);
    const ratingJob = await waitForProcessedStateJob({ ratingKey, event: 'media.rate', userId, spaceId, libraryId });
    assert(ratingJob?.status === 'succeeded', `Expected rating refresh job to succeed: ${JSON.stringify(ratingJob)}`);
    assert(ratingJob?.summary?.processingMode === 'single_rating_key_rating_refresh', `Expected rating processing mode: ${JSON.stringify(ratingJob)}`);

    const imported = await pool.query(
      `SELECT m.id, m.title, m.import_source, mm.value AS plex_item_key
         FROM media m
         JOIN media_metadata mm ON mm.media_id = m.id
        WHERE mm."key" = 'plex_item_key'
          AND mm."value" = $1
        LIMIT 1`,
      [`1:${ratingKey}`]
    );
    assert(imported.rowCount === 1, `Expected imported media row keyed by Plex item key, got ${imported.rowCount}`);
    assert(imported.rows[0]?.title === importedTitle, `Expected imported title readback: ${JSON.stringify(imported.rows[0])}`);
    assert(imported.rows[0]?.import_source === 'plex', `Expected Plex import source: ${JSON.stringify(imported.rows[0])}`);

    const revoked = await admin.request(`${integrationEndpoint}/plex-webhook-receiver-token`, {
      method: 'DELETE',
      withCsrf: true,
      expectStatus: 200
    });
    assert(revoked.data?.plexWebhookReceiver?.enabled === false, `Expected receiver revoked: ${JSON.stringify(revoked.data)}`);
    await webhook.request(`/api/plex/webhooks/${encodeURIComponent(rawToken)}`, {
      method: 'POST',
      expectStatus: 401,
      body: { event: 'media.rate', Metadata: { ratingKey, userRating: 8 } }
    });

    const evidence = {
      ok: true,
      receiverStatus: {
        enabled: generated.data.plexWebhookReceiver.enabled,
        receiverPath: generated.data.plexWebhookReceiver.receiverPath,
        receiverPathMasked: settings.data.plexWebhookReceiver.receiverPathMasked,
        tokenFingerprintPresent: Boolean(settings.data.plexWebhookReceiver.tokenFingerprint),
        supportedEvents: generated.data.plexWebhookReceiver.supportedEvents,
        observedOnlyEvents: generated.data.plexWebhookReceiver.observedOnlyEvents,
        processingMode: generated.data.plexWebhookReceiver.processingMode
      },
      invalidTokenRejected: true,
      malformedMultipartRejectedAndDiagnosed: true,
      validWebhookAccepted: {
        event: accepted.data.event,
        supported: accepted.data.supported,
        action: accepted.data.action,
        ratingKey: accepted.data.ratingKey,
        metadataReadbackPath: accepted.data.metadataReadbackPath,
        processingMode: accepted.data.processingMode,
        importEnqueue: {
          queued: accepted.data.importEnqueue.queued,
          relationalOwnership: true,
          jobType: accepted.data.importEnqueue.job.jobType,
          provider: accepted.data.importEnqueue.job.provider,
          status: accepted.data.importEnqueue.job.status,
          ratingKey: accepted.data.importEnqueue.job.ratingKey,
          processingMode: accepted.data.importEnqueue.job.processingMode
        }
      },
      duplicateWebhookReusedExistingJob: duplicate.data.importEnqueue.job.existing,
      multipartPayloadAccepted: String(dbReadback.rows[0].plex_webhook_receiver_last_content_type).startsWith('multipart/form-data'),
      watchedStateQueuedAndApplied: watchedJob.status === 'succeeded',
      ratingQueuedAndApplied: ratingJob.status === 'succeeded',
      singleRatingKeyImportProcessed: {
        status: processedJob.status,
        processingMode: processedJob.summary.processingMode,
        imported: processedJob.summary.imported,
        changed: (processedJob.summary.created || 0) + (processedJob.summary.updated || 0),
        metadataReadbackCalled: fakePms.requests.some((request) => request.pathname === `/library/metadata/${ratingKey}` && request.tokenMatched)
      },
      revokeRejectedPreviousToken: true
    };
    assertSecretFree(evidence, 'webhook receiver evidence', rawToken);
    fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
    fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await cleanupImportedMedia(ratingKey, importedTitle);
    await cleanupWebhookJobs({ ratingKey, userId, spaceId, libraryId });
    if (fakePms) await fakePms.close().catch(() => {});
    await cleanupTemporaryState({ userId, spaceId, libraryId });
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
