'use strict';

const bcrypt = require('bcrypt');
const pool = require('../db/pool');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

class HttpClient {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
    this.csrfToken = '';
  }

  applySetCookies(headers) {
    const raw = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [];
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
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  async request(path, options = {}) {
    const {
      method = 'GET',
      body,
      expectStatus,
      withCsrf = false,
      headers: extraHeaders = {}
    } = options;

    const headers = {
      Accept: 'application/json',
      ...extraHeaders
    };

    if (withCsrf) {
      if (!this.csrfToken) await this.fetchCsrfToken();
      headers['x-csrf-token'] = this.csrfToken;
    }

    const cookieHeader = this.cookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body
    });

    this.applySetCookies(response.headers);
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (expectStatus !== undefined && response.status !== expectStatus) {
      throw new Error(
        `[${this.name}] ${method} ${path} expected ${expectStatus}, got ${response.status}. Body: ${JSON.stringify(parsed)}`
      );
    }

    return { status: response.status, data: parsed, headers: response.headers };
  }

  async fetchCsrfToken() {
    const response = await this.request('/api/auth/csrf-token', { expectStatus: 200 });
    const token = response?.data?.csrfToken;
    if (!token) throw new Error(`[${this.name}] Missing CSRF token`);
    this.csrfToken = token;
    return token;
  }
}

async function createDirectUser({ email, password, name, role = 'user' }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, $3, $4, true, NOW())
     RETURNING id`,
    [email, passwordHash, name, role]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

async function cleanupTemporaryState({ userId, libraryId, spaceId }) {
  if (libraryId) {
    await pool.query('DELETE FROM media WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM library_memberships WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM libraries WHERE id = $1', [libraryId]).catch(() => {});
  }
  if (spaceId) {
    await pool.query('DELETE FROM app_integrations WHERE space_id = $1', [spaceId]).catch(() => {});
    await pool.query('DELETE FROM space_memberships WHERE space_id = $1', [spaceId]).catch(() => {});
    await pool.query('DELETE FROM spaces WHERE id = $1', [spaceId]).catch(() => {});
  }
  if (userId) {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
  }
}

async function main() {
  const suffix = Date.now();
  const email = `import-normalization-review-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('normalization-review-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Import Normalization Review Smoke User'
    });

    await client.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ email, password }),
      headers: { 'Content-Type': 'application/json' }
    });
    await client.fetchCsrfToken();

    const scope = await client.request('/api/auth/scope', { expectStatus: 200 });
    libraryId = Number(scope?.data?.active_library_id || 0) || null;
    spaceId = Number(scope?.data?.active_space_id || 0) || null;
    if (!libraryId || !spaceId) {
      throw new Error(`Scope bootstrap failed: ${JSON.stringify(scope?.data)}`);
    }

    await pool.query(
      `INSERT INTO app_integrations (space_id, comics_preset, comics_provider, comics_api_url)
       VALUES ($1, 'metron', 'metron', 'http://frontend:3000/api/health')
       ON CONFLICT (space_id)
       DO UPDATE SET
         comics_preset = EXCLUDED.comics_preset,
         comics_provider = EXCLUDED.comics_provider,
         comics_api_url = EXCLUDED.comics_api_url`,
      [spaceId]
    );

    await pool.query(
      `INSERT INTO media (
         title, media_type, format, type_details, library_id, space_id, added_by, import_source
       ) VALUES (
         $1, 'comic_book', 'Digital', $2::jsonb, $3, $4, $5, 'manual_seed'
       )`,
      [
        'Alpha Flight #10',
        JSON.stringify({
          series: 'Alpha Flight',
          issue_number: '10',
          volume: '1'
        }),
        libraryId,
        spaceId,
        userId
      ]
    );

    const csv = [
      'title,media_type,format,series,issue_number',
      '"Alpha Flight #10","comic_book","Digital","Alpha Flight","10"'
    ].join('\n');

    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'normalization-review-smoke.csv');

    const importResponse = await client.request('/api/media/import-csv?sync=1', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: form,
      headers: {
        'x-valuation-refresh-mode': 'fixture'
      }
    });

    const summary = importResponse?.data?.summary || {};
    const auditRows = Array.isArray(importResponse?.data?.auditRows) ? importResponse.data.auditRows : [];
    const firstAuditRow = auditRows[0] || null;

    if (Number(summary.created || 0) !== 1) {
      throw new Error(`Expected one created row, got summary=${JSON.stringify(summary)}`);
    }
    if (Number(summary.updated || 0) !== 0) {
      throw new Error(`Expected no updated rows, got summary=${JSON.stringify(summary)}`);
    }
    if (Number(summary.normalizationReviewCandidates || 0) !== 1) {
      throw new Error(`Expected one normalization review candidate in summary, got summary=${JSON.stringify(summary)}`);
    }
    if (firstAuditRow?.match_mode !== 'normalization_review_medium') {
      throw new Error(`Expected normalization_review_medium, got audit=${JSON.stringify(firstAuditRow)}`);
    }
    if (firstAuditRow?.matched_by !== 'normalization_series_issue') {
      throw new Error(`Expected normalization_series_issue, got audit=${JSON.stringify(firstAuditRow)}`);
    }
    if (Number(firstAuditRow?.normalization_review_candidate_count || 0) !== 1) {
      throw new Error(`Expected one review candidate on audit row, got audit=${JSON.stringify(firstAuditRow)}`);
    }

    const candidates = Array.isArray(firstAuditRow?.normalization_review_candidates)
      ? firstAuditRow.normalization_review_candidates
      : [];
    if (Number(candidates[0]?.media_id || 0) <= 0) {
      throw new Error(`Expected review candidate media id, got candidates=${JSON.stringify(candidates)}`);
    }

    const mediaCount = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM media
       WHERE library_id = $1
         AND media_type = 'comic_book'`,
      [libraryId]
    );
    const count = Number(mediaCount.rows[0]?.count || 0);
    if (count !== 2) {
      throw new Error(`Expected two comic rows in scoped library after medium-confidence import, found ${count}`);
    }

    console.log('Import normalization review smoke passed');
    console.log(JSON.stringify({
      created: summary.created,
      updated: summary.updated,
      normalizationReviewCandidates: summary.normalizationReviewCandidates,
      match_mode: firstAuditRow.match_mode,
      matched_by: firstAuditRow.matched_by,
      normalization_review_candidate_count: firstAuditRow.normalization_review_candidate_count,
      libraryComicCount: count
    }, null, 2));
  } finally {
    await cleanupTemporaryState({ userId, libraryId, spaceId });
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
