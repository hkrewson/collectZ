'use strict';

const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { ensureUserDefaultScope } = require('../services/libraries');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

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
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(path, options = {}) {
    const { method = 'GET', body, expectStatus, withCsrf = false } = options;
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
      body: body !== undefined ? JSON.stringify(body) : undefined
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

async function createComicRow({ title, series, issueNumber, volume = '1', edition = null, libraryId, spaceId, userId }) {
  const result = await pool.query(
    `INSERT INTO media (
       title, media_type, format, type_details, library_id, space_id, added_by, import_source
     ) VALUES (
       $1, 'comic_book', 'Digital', $2::jsonb, $3, $4, $5, $6
     )
     RETURNING id`,
    [
      title,
      JSON.stringify({
        series,
        issue_number: issueNumber,
        volume,
        edition,
        provider_name: 'manual'
      }),
      libraryId,
      spaceId,
      userId,
      'manual'
    ]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

async function cleanupTemporaryState({ userId, libraryId, spaceId }) {
  if (libraryId) {
    await pool.query('DELETE FROM media_repair_history WHERE canonical_media_id IN (SELECT id FROM media WHERE library_id = $1) OR duplicate_media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_merge_recommendation_feedback WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM collection_items WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_metadata WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_variants WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_genres WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_directors WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_actors WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
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
  const email = `comic-duplicate-candidates-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('comic-duplicate-candidates-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Comic Duplicate Candidate Smoke Admin',
      role: 'admin'
    });

    const scope = await ensureUserDefaultScope(userId);
    libraryId = Number(scope?.libraryId || 0) || null;
    spaceId = Number(scope?.spaceId || 0) || null;
    assert(libraryId && spaceId, 'Expected default scope for comic duplicate candidate smoke admin');

    await client.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { email, password }
    });

    await createComicRow({
      title: 'Alpha Flight #12: ...And One Shall Surely Die',
      series: 'Alpha Flight',
      issueNumber: '12',
      volume: '1',
      edition: 'Issue 12',
      libraryId,
      spaceId,
      userId
    });
    await createComicRow({
      title: 'Alpha Flight #12: ...And One Shall Surely Die',
      series: 'Alpha Flight',
      issueNumber: '12',
      volume: '1',
      edition: 'Issue 12',
      libraryId,
      spaceId,
      userId
    });

    await createComicRow({
      title: 'Uncanny X-Men v1 130',
      series: 'Dark Avengers / Uncanny X-Men: Exodus',
      issueNumber: '1',
      volume: '1',
      edition: 'Issue 1',
      libraryId,
      spaceId,
      userId
    });
    await createComicRow({
      title: 'Uncanny X-Men v1 141',
      series: 'Dark Avengers / Uncanny X-Men: Exodus',
      issueNumber: '1',
      volume: '1',
      edition: 'Issue 1',
      libraryId,
      spaceId,
      userId
    });

    const response = await client.request('/api/media/comics/duplicate-candidates?limit=12', {
      method: 'GET',
      expectStatus: 200
    });

    const items = Array.isArray(response.data?.items) ? response.data.items : [];
    const suppressedItems = Array.isArray(response.data?.suppressed_items) ? response.data.suppressed_items : [];
    const alphaFlight = items.find((item) => item.series === 'Alpha Flight' && String(item.issue_number) === '12');
    const badCluster = suppressedItems.find((item) => item.series === 'Dark Avengers / Uncanny X-Men: Exodus');

    assert(alphaFlight, 'Expected safe Alpha Flight duplicate group to be surfaced');
    assert(badCluster, 'Expected broken Dark Avengers / Uncanny X-Men cluster to be suppressed');
    assert((badCluster.suppression_reasons || []).includes('title_issue_mismatch'), 'Expected bad cluster suppression to record title_issue_mismatch');

    console.log(JSON.stringify({
      candidateGroups: Number(response.data?.summary?.candidate_groups || 0),
      suppressedGroups: Number(response.data?.summary?.suppressed_groups || 0),
      alphaFlightSummary: alphaFlight.summary,
      suppressedReason: badCluster.suppression_reasons[0]
    }, null, 2));
  } finally {
    await cleanupTemporaryState({ userId, libraryId, spaceId });
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
