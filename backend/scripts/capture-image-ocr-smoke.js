'use strict';

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db/pool');
const { loadWorkspaceOcrIntegrationConfig } = require('../services/integrations');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const FIXTURE_TEXT = 'Back cover OCR ISBN 0-553-57239-3 UPC 0076783005990';
const GLOBAL_DECOY_TEXT = 'Global OCR ISBN 978-0-13-110362-7';
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
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
      this.cookies.set(firstPart.slice(0, idx).trim(), firstPart.slice(idx + 1).trim());
    }
  }

  cookieHeader() {
    return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async request(path, options = {}) {
    const { method = 'GET', body, form, expectStatus, withCsrf = false } = options;
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (withCsrf) {
      await this.fetchCsrfToken();
      headers['x-csrf-token'] = this.csrfToken;
    }
    const cookieHeader = this.cookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: form || (body !== undefined ? JSON.stringify(body) : undefined)
    });
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
    return { status: response.status, data };
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
  const spaceResult = await pool.query(
    `INSERT INTO spaces (name, slug, created_by, is_personal)
     VALUES ($1, $2, $3, false)
     RETURNING id`,
    [`Capture Image OCR ${suffix}`, `capture-image-ocr-${suffix}`, userId]
  );
  const spaceId = Number(spaceResult.rows[0]?.id || 0);
  await pool.query(
    `INSERT INTO space_memberships (space_id, user_id, role, created_by)
     VALUES ($1, $2, 'owner', $2)`,
    [spaceId, userId]
  );
  const libraryResult = await pool.query(
    `INSERT INTO libraries (space_id, name, created_by)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [spaceId, `Capture Image OCR Library ${suffix}`, userId]
  );
  const libraryId = Number(libraryResult.rows[0]?.id || 0);
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

async function cleanupIsolatedScope(scope) {
  if (!scope?.spaceId) return;
  await pool.query('DELETE FROM app_integrations WHERE space_id = $1', [scope.spaceId]).catch(() => {});
  await pool.query('DELETE FROM library_memberships WHERE library_id = $1', [scope.libraryId]).catch(() => {});
  await pool.query('DELETE FROM libraries WHERE id = $1', [scope.libraryId]).catch(() => {});
  await pool.query('DELETE FROM space_memberships WHERE space_id = $1', [scope.spaceId]).catch(() => {});
  await pool.query('DELETE FROM spaces WHERE id = $1', [scope.spaceId]).catch(() => {});
}

async function snapshotVisionConfig(spaceId) {
  const result = await pool.query(
    `SELECT id, space_id, vision_enabled, vision_preset, vision_provider, vision_api_url, vision_api_key_header
       FROM app_integrations
      WHERE space_id = $1
      LIMIT 1`,
    [spaceId]
  );
  return result.rows[0] || null;
}

async function snapshotGlobalVisionConfig() {
  const result = await pool.query(
    `SELECT id, vision_enabled, vision_preset, vision_provider, vision_api_url, vision_api_key_header
       FROM app_integrations
      WHERE id = 1
      LIMIT 1`
  );
  return result.rows[0] || null;
}

async function restoreVisionConfig(snapshot, spaceId) {
  if (!snapshot) {
    await pool.query('DELETE FROM app_integrations WHERE space_id = $1', [spaceId]);
    return;
  }
  await pool.query(
    `INSERT INTO app_integrations (id, space_id, vision_enabled, vision_preset, vision_provider, vision_api_url, vision_api_key_header)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (space_id) DO UPDATE SET
       vision_enabled = EXCLUDED.vision_enabled,
       vision_preset = EXCLUDED.vision_preset,
       vision_provider = EXCLUDED.vision_provider,
       vision_api_url = EXCLUDED.vision_api_url,
       vision_api_key_header = EXCLUDED.vision_api_key_header`,
    [
      snapshot.id,
      spaceId,
      Boolean(snapshot?.vision_enabled),
      snapshot?.vision_preset || 'ocrspace',
      snapshot?.vision_provider || null,
      snapshot?.vision_api_url || null,
      snapshot?.vision_api_key_header || null
    ]
  );
}

async function restoreGlobalVisionConfig(snapshot) {
  await pool.query(
    `INSERT INTO app_integrations (id, vision_enabled, vision_preset, vision_provider, vision_api_url, vision_api_key_header)
     VALUES (1, $1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       vision_enabled = EXCLUDED.vision_enabled,
       vision_preset = EXCLUDED.vision_preset,
       vision_provider = EXCLUDED.vision_provider,
       vision_api_url = EXCLUDED.vision_api_url,
       vision_api_key_header = EXCLUDED.vision_api_key_header`,
    [
      Boolean(snapshot?.vision_enabled),
      snapshot?.vision_preset || 'ocrspace',
      snapshot?.vision_provider || null,
      snapshot?.vision_api_url || null,
      snapshot?.vision_api_key_header || null
    ]
  );
}

async function configureFixtureVision(spaceId) {
  await pool.query(
    `INSERT INTO app_integrations (space_id, vision_enabled, vision_preset, vision_provider, vision_api_url, vision_api_key_header)
     VALUES ($1, true, 'fixture', 'fixture', $2, NULL)
     ON CONFLICT (space_id) DO UPDATE SET
       vision_enabled = EXCLUDED.vision_enabled,
       vision_preset = EXCLUDED.vision_preset,
       vision_provider = EXCLUDED.vision_provider,
       vision_api_url = EXCLUDED.vision_api_url,
       vision_api_key_header = EXCLUDED.vision_api_key_header`,
    [spaceId, FIXTURE_TEXT]
  );
}

async function configureGlobalFixtureVision() {
  await pool.query(
    `INSERT INTO app_integrations (id, vision_enabled, vision_preset, vision_provider, vision_api_url, vision_api_key_header)
     VALUES (1, true, 'fixture', 'fixture', $1, NULL)
     ON CONFLICT (id) DO UPDATE SET
       vision_enabled = EXCLUDED.vision_enabled,
       vision_preset = EXCLUDED.vision_preset,
       vision_provider = EXCLUDED.vision_provider,
       vision_api_url = EXCLUDED.vision_api_url,
       vision_api_key_header = EXCLUDED.vision_api_key_header`,
    [GLOBAL_DECOY_TEXT]
  );
}

async function main() {
  const suffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const email = `capture-image-ocr-${suffix}@example.test`;
  const password = `CaptureImageOcr-${suffix}`;
  const userId = await createDirectUser({ email, password, name: 'Capture Image OCR Smoke Admin' });
  let scope = null;
  let snapshot = null;
  let globalSnapshot = null;
  let captureId = null;

  try {
    assert(userId, 'Expected smoke user id');
    scope = await createIsolatedScope({ userId, suffix });
    assert(scope?.libraryId && scope?.spaceId, 'Expected isolated workspace scope');
    const legacyConfigSpace = await pool.query('SELECT space_id FROM app_integrations WHERE id = 1');
    assert(
      Number(legacyConfigSpace.rows[0]?.space_id || 0) !== Number(scope.spaceId),
      'OCR smoke workspace must be distinct from the legacy id=1 integration row'
    );
    snapshot = await snapshotVisionConfig(scope.spaceId);
    globalSnapshot = await snapshotGlobalVisionConfig();
    await configureFixtureVision(scope.spaceId);
    await configureGlobalFixtureVision();
    const workspaceOcr = await loadWorkspaceOcrIntegrationConfig(scope.spaceId);
    assert(workspaceOcr.visionProvider === 'fixture', 'Workspace fixture OCR provider did not resolve before the API request');
    assert(
      workspaceOcr.visionApiUrl === FIXTURE_TEXT,
      `Workspace fixture OCR payload did not resolve before the API request; received ${JSON.stringify(workspaceOcr.visionApiUrl)}`
    );

    const client = new HttpClient('capture-image-ocr');
    await client.request('/api/auth/login', {
      method: 'POST',
      body: { email, password },
      expectStatus: 200
    });

    const form = new FormData();
    form.append('title', `Capture Image OCR Smoke ${suffix}`);
    form.append('object_type', 'book');
    form.append('client_capture_id', `capture-image-ocr-${suffix}`);
    form.append('client_source', 'capture-image-ocr-smoke');
    form.append('image', new Blob([PNG_1X1], { type: 'image/png' }), `capture-image-ocr-${suffix}.png`);
    const upload = await client.request('/api/capture-items/upload-image', {
      method: 'POST',
      withCsrf: true,
      form,
      expectStatus: 201
    });
    captureId = Number(upload.data?.item?.id || 0);
    assert(captureId > 0, 'Expected capture id');
    assert(Number(upload.data?.item?.space_id || 0) === Number(scope.spaceId), 'Capture upload did not retain its workspace');
    assert(String(upload.data?.item?.image_path || '').startsWith('/uploads/'), 'Expected local upload path');

    const ocr = await client.request(`/api/capture-items/${captureId}/ocr-image`, {
      method: 'POST',
      withCsrf: true,
      body: {},
      expectStatus: 200
    });
    assert(ocr.data?.ocr?.provider === 'fixture', 'Expected fixture OCR provider');
    assert(Number(ocr.data?.ocr?.text_length || 0) > 0, 'Expected OCR text length');
    assert(
      ocr.data?.candidates?.some((candidate) => candidate.barcode === '9780553572391'),
      `Expected ISBN candidate; received ${JSON.stringify(ocr.data?.candidates || [])}`
    );
    assert(!ocr.data?.candidates?.some((candidate) => candidate.barcode === '9780131103627'), 'Installation OCR fallback leaked into workspace execution');
    await pool.query('UPDATE app_integrations SET vision_enabled = false WHERE space_id = $1', [scope.spaceId]);
    const disabledOcr = await client.request(`/api/capture-items/${captureId}/ocr-image`, {
      method: 'POST',
      withCsrf: true,
      body: {},
      expectStatus: 409
    });
    assert(disabledOcr.data?.code === 'vision_not_enabled' || /not enabled/i.test(String(disabledOcr.data?.error || '')), 'Disabled workspace OCR did not fail closed while installation OCR remained enabled');
    console.log('Capture image OCR smoke passed');
  } finally {
    if (captureId) await pool.query('DELETE FROM capture_items WHERE id = $1', [captureId]).catch(() => {});
    if (scope?.spaceId) await restoreVisionConfig(snapshot, scope.spaceId).catch(() => {});
    await restoreGlobalVisionConfig(globalSnapshot).catch(() => {});
    await cleanupIsolatedScope(scope);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
