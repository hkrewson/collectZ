#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { encryptSecret } = require('../services/crypto');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const fakePlexToken = `plex-smoke-${crypto.randomBytes(6).toString('hex')}`;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
            plex_webhook_receiver_last_event,
            plex_preset,
            plex_provider,
            plex_api_url,
            plex_api_key_encrypted,
            plex_library_sections,
            tmdb_api_key_encrypted
       FROM app_integrations
      WHERE id = 1`
  );
  return result.rows[0] || null;
}

async function applyFakePlexSettings(baseUrl) {
  await pool.query(
    `INSERT INTO app_integrations (
       id, plex_preset, plex_provider, plex_api_url, plex_api_key_encrypted,
       plex_library_sections, tmdb_api_key_encrypted, updated_at
     )
     VALUES (1, 'plex', 'plex', $1, $2, $3::jsonb, NULL, NOW())
     ON CONFLICT (id) DO UPDATE SET
       plex_preset = EXCLUDED.plex_preset,
       plex_provider = EXCLUDED.plex_provider,
       plex_api_url = EXCLUDED.plex_api_url,
       plex_api_key_encrypted = EXCLUDED.plex_api_key_encrypted,
       plex_library_sections = EXCLUDED.plex_library_sections,
       tmdb_api_key_encrypted = NULL,
       updated_at = NOW()`,
    [baseUrl, encryptSecret(fakePlexToken), JSON.stringify(['1'])]
  );
}

async function restorePlexWebhookSettings(snapshot) {
  if (!snapshot) {
    await pool.query(
      `UPDATE app_integrations
          SET plex_webhook_receiver_token_hash = NULL,
              plex_webhook_receiver_token_created_at = NULL,
              plex_webhook_receiver_token_last_rotated_at = NULL,
              plex_webhook_receiver_last_received_at = NULL,
              plex_webhook_receiver_last_event = NULL,
              plex_preset = 'plex',
              plex_provider = 'plex',
              plex_api_url = NULL,
              plex_api_key_encrypted = NULL,
              plex_library_sections = '[]'::jsonb,
              tmdb_api_key_encrypted = NULL
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
            plex_webhook_receiver_last_event = $5,
            plex_preset = $6,
            plex_provider = $7,
            plex_api_url = $8,
            plex_api_key_encrypted = $9,
            plex_library_sections = $10::jsonb,
            tmdb_api_key_encrypted = $11
      WHERE id = 1`,
    [
      snapshot.plex_webhook_receiver_token_hash,
      snapshot.plex_webhook_receiver_token_created_at,
      snapshot.plex_webhook_receiver_token_last_rotated_at,
      snapshot.plex_webhook_receiver_last_received_at,
      snapshot.plex_webhook_receiver_last_event,
      snapshot.plex_preset,
      snapshot.plex_provider,
      snapshot.plex_api_url,
      snapshot.plex_api_key_encrypted,
      JSON.stringify(snapshot.plex_library_sections || []),
      snapshot.tmdb_api_key_encrypted
    ]
  ).catch(() => {});
}

async function cleanupUser(userId) {
  if (!Number.isFinite(Number(userId)) || Number(userId) <= 0) return;
  await pool.query('DELETE FROM users WHERE id = $1', [Number(userId)]).catch(() => {});
}

async function cleanupWebhookJobs(ratingKey) {
  const key = String(ratingKey || '').trim();
  if (!key) return;
  await pool.query(
    `DELETE FROM sync_jobs
      WHERE provider = 'plex'
        AND job_type = 'plex_webhook_import_hint'
        AND scope->>'ratingKey' = $1`,
    [key]
  ).catch(() => {});
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
  <Video ratingKey="${ratingKey}" key="/library/metadata/${ratingKey}" type="movie" title="${title}" year="2026" librarySectionID="1" duration="7200000" originallyAvailableAt="2026-05-08" thumb="https://images.example.invalid/plex-webhook-poster.jpg" />
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

async function waitForProcessedWebhookJob(ratingKey, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const readback = await pool.query(
      `SELECT id, job_type, provider, status, scope, progress, summary, error
         FROM sync_jobs
        WHERE provider = 'plex'
          AND job_type = 'plex_webhook_import_hint'
          AND scope->>'ratingKey' = $1
        ORDER BY updated_at DESC
        LIMIT 1`,
      [ratingKey]
    );
    last = readback.rows[0] || null;
    if (last && ['succeeded', 'failed'].includes(String(last.status))) return last;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for Plex webhook import auto-processing: ${JSON.stringify(last)}`);
}

async function main() {
  const suffix = crypto.randomBytes(6).toString('hex');
  const email = `plex-webhook-admin-${suffix}@example.com`;
  const password = `PlexWebhookAdmin-${suffix}!`;
  const ratingKey = `receiver-admin-${suffix}`;
  const importedTitle = `Receiver Admin New Movie ${suffix}`;
  const admin = new HttpClient('plex-webhook-admin-smoke');
  const snapshot = await snapshotPlexWebhookSettings();
  let userId = null;
  let rawToken = '';
  let fakePms = null;

  try {
    fakePms = await startFakePmsServer(ratingKey, importedTitle);
    await applyFakePlexSettings(fakePms.baseUrl);
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
          ratingKey,
          type: 'movie',
          title: importedTitle,
          librarySectionID: '1',
          thumb: 'https://plex.example.invalid/thumb?X-Plex-Token=receiver-admin-token',
          Media: [{ Part: [{ file: '/mnt/plex-media/Receiver Admin New Movie.mkv' }] }]
        },
        Server: { title: 'Home Plex', uuid: 'server-uuid-secret' }
      }
    });
    assert(accepted.data?.processingMode === 'import_enqueue_hint', `Expected import enqueue mode: ${JSON.stringify(accepted.data)}`);
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
      body: {
        event: 'library.new',
        Metadata: { ratingKey, type: 'movie', title: importedTitle, librarySectionID: '1' }
      }
    });
    assert(duplicate.data?.importEnqueue?.queued === true, `Expected duplicate webhook import hint to remain queued: ${JSON.stringify(duplicate.data)}`);
    assert(duplicate.data?.importEnqueue?.job?.existing === true, `Expected duplicate webhook import hint to reuse existing job: ${JSON.stringify(duplicate.data)}`);

    const watched = await webhook.request(`/api/plex/webhooks/${encodeURIComponent(rawToken)}`, {
      method: 'POST',
      expectStatus: 200,
      body: { event: 'media.scrobble', Metadata: { ratingKey, title: importedTitle } }
    });
    assert(watched.data?.processingMode === 'read_only', `Expected watched-state event to stay read-only: ${JSON.stringify(watched.data)}`);
    assert(watched.data?.importEnqueue?.queued === false, `Expected watched-state event not to enqueue import: ${JSON.stringify(watched.data)}`);

    const dbReadback = await pool.query(
      `SELECT plex_webhook_receiver_last_received_at, plex_webhook_receiver_last_event
         FROM app_integrations
        WHERE id = 1`
    );
    assert(dbReadback.rows[0]?.plex_webhook_receiver_last_received_at, 'Expected last received timestamp');
    assert(dbReadback.rows[0]?.plex_webhook_receiver_last_event === 'media.scrobble', 'Expected last received event readback');

    const queuedJobs = await pool.query(
      `SELECT id, job_type, provider, status, scope, progress, summary
         FROM sync_jobs
        WHERE provider = 'plex'
          AND job_type = 'plex_webhook_import_hint'
          AND scope->>'ratingKey' = $1
        ORDER BY created_at DESC`,
      [ratingKey]
    );
    assert(queuedJobs.rowCount === 1, `Expected one deduped webhook import hint job, got ${queuedJobs.rowCount}`);
    assert(queuedJobs.rows[0]?.status === 'queued', `Expected queued webhook import hint job: ${JSON.stringify(queuedJobs.rows[0])}`);
    assert(queuedJobs.rows[0]?.scope?.processingMode === 'queued_import_hint', `Expected queued import hint scope: ${JSON.stringify(queuedJobs.rows[0])}`);
    assert(queuedJobs.rows[0]?.summary?.processor === 'pending_future_slice', `Expected no silent processor claim: ${JSON.stringify(queuedJobs.rows[0])}`);

    const autoStatus = await admin.request('/api/media/plex-webhook-import-hints/auto-processor', {
      expectStatus: 200
    });
    assert(autoStatus.data?.runtime?.enabled === true, `Expected webhook import auto-processor enabled: ${JSON.stringify(autoStatus.data)}`);
    assert(autoStatus.data?.processingMode === 'auto_single_rating_key_import', `Expected auto processor readback: ${JSON.stringify(autoStatus.data)}`);

    const processedJob = await waitForProcessedWebhookJob(ratingKey);
    assert(processedJob?.status === 'succeeded', `Expected processed webhook import job to succeed: ${JSON.stringify(processedJob)}`);
    assert(processedJob?.summary?.processingMode === 'single_rating_key_import', `Expected single-rating-key processing mode: ${JSON.stringify(processedJob)}`);
    assert(processedJob?.summary?.imported === 1, `Expected one processed Plex metadata item: ${JSON.stringify(processedJob)}`);
    assert((processedJob?.summary?.created || 0) + (processedJob?.summary?.updated || 0) >= 1, `Expected processed hint to create or update a media row: ${JSON.stringify(processedJob)}`);
    assert(fakePms.requests.some((request) => request.pathname === `/library/metadata/${ratingKey}` && request.tokenMatched), `Expected fake PMS metadata readback with Plex token: ${JSON.stringify(fakePms.requests)}`);
    assertSecretFree(processedJob, 'processed webhook job readback', rawToken);

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

    const revoked = await admin.request('/api/admin/settings/integrations/plex-webhook-receiver-token', {
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
        metadataReadbackPath: accepted.data.metadataReadbackPath,
        processingMode: accepted.data.processingMode,
        importEnqueue: {
          queued: accepted.data.importEnqueue.queued,
          jobType: accepted.data.importEnqueue.job.jobType,
          provider: accepted.data.importEnqueue.job.provider,
          status: accepted.data.importEnqueue.job.status,
          ratingKey: accepted.data.importEnqueue.job.ratingKey,
          processingMode: accepted.data.importEnqueue.job.processingMode
        }
      },
      duplicateWebhookReusedExistingJob: duplicate.data.importEnqueue.job.existing,
      watchedStateStayedReadOnly: watched.data.importEnqueue.queued === false,
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
    await cleanupWebhookJobs(ratingKey);
    if (fakePms) await fakePms.close().catch(() => {});
    await restorePlexWebhookSettings(snapshot);
    await cleanupUser(userId);
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
