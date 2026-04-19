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

async function cleanupTemporaryState({ userId, libraryId, spaceId }) {
  if (libraryId) {
    await pool.query('DELETE FROM media_merge_recommendation_feedback WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_repair_history WHERE canonical_media_id IN (SELECT id FROM media WHERE library_id = $1) OR duplicate_media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_metadata WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_variants WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_genres WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_directors WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_actors WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_seasons WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM collection_items WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
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

async function createMediaRow({ title, mediaType, typeDetails = {}, year = null, tmdbId = null, libraryId, spaceId, userId, importSource = 'manual' }) {
  const result = await pool.query(
    `INSERT INTO media (
       title, media_type, format, year, tmdb_id, type_details, library_id, space_id, added_by, import_source
     ) VALUES (
       $1, $2, 'Digital', $3, $4, $5::jsonb, $6, $7, $8, $9
     )
     RETURNING id`,
    [title, mediaType, year, tmdbId, JSON.stringify(typeDetails || {}), libraryId, spaceId, userId, importSource]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

async function main() {
  const suffix = Date.now();
  const email = `manual-merge-reject-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('manual-merge-recommendation-reject-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Manual Merge Recommendation Reject Smoke Admin',
      role: 'admin'
    });

    const scope = await ensureUserDefaultScope(userId);
    libraryId = Number(scope?.libraryId || 0) || null;
    spaceId = Number(scope?.spaceId || 0) || null;
    assert(libraryId && spaceId, 'Expected default scope for manual merge recommendation smoke admin');

    await client.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { email, password }
    });

    const bookCanonicalId = await createMediaRow({
      title: 'Wool',
      mediaType: 'book',
      year: 2024,
      typeDetails: { isbn: '9780358447849', author: 'Hugh Howey' },
      libraryId,
      spaceId,
      userId,
      importSource: 'csv_generic'
    });
    const bookDuplicateId = await createMediaRow({
      title: 'Wool',
      mediaType: 'book',
      year: 2024,
      typeDetails: { isbn: '9780358447849', author: 'Hugh Howey' },
      libraryId,
      spaceId,
      userId,
      importSource: 'manual'
    });
    const movieCanonicalId = await createMediaRow({
      title: 'The Matrix',
      mediaType: 'movie',
      year: 1999,
      libraryId,
      spaceId,
      userId,
      importSource: 'manual'
    });
    const movieDuplicateId = await createMediaRow({
      title: 'The Matrix',
      mediaType: 'movie',
      year: 1999,
      libraryId,
      spaceId,
      userId,
      importSource: 'csv_generic'
    });

    const response = await client.request('/api/media/merge-recommendations?limit=10', {
      method: 'GET',
      expectStatus: 200
    });

    const items = Array.isArray(response.data?.items) ? response.data.items : [];
    const bookRecommendation = items.find((item) => Number(item?.canonical?.id || 0) === bookCanonicalId && Number(item?.duplicate?.id || 0) === bookDuplicateId);
    const movieRecommendation = items.find((item) => Number(item?.canonical?.id || 0) === movieCanonicalId && Number(item?.duplicate?.id || 0) === movieDuplicateId);

    assert(bookRecommendation, 'Expected book recommendation pair in queue');
    assert(movieRecommendation, 'Expected movie recommendation pair in queue');
    assert(bookRecommendation.confidence === 'high', 'Expected book recommendation to be high confidence');
    assert(bookRecommendation.summary === 'Matched on ISBN', 'Expected book recommendation summary to describe ISBN match');
    assert(movieRecommendation.confidence === 'medium', 'Expected movie recommendation to be medium confidence');
    assert(movieRecommendation.summary === 'Matched on title and year', 'Expected movie recommendation summary to describe title/year match');
    assert(Number(response.data?.summary?.total_candidates || 0) >= 2, 'Expected recommendation summary to count created pairs');

    const rejectResponse = await client.request('/api/media/merge-recommendations/reject?limit=10', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: {
        canonical_id: bookCanonicalId,
        duplicate_id: bookDuplicateId,
        reason_code: 'different_title_identity',
        reason: 'Not a match for operator review'
      }
    });
    assert(rejectResponse.data?.rejected === true, 'Expected reject endpoint to confirm rejection');
    assert(rejectResponse.data?.feedback?.outcome === 'rejected', 'Expected reject feedback outcome');

    const remainingItems = Array.isArray(rejectResponse.data?.recommendations?.items)
      ? rejectResponse.data.recommendations.items
      : [];
    const remainingBookRecommendation = remainingItems.find((item) => Number(item?.canonical?.id || 0) === bookCanonicalId && Number(item?.duplicate?.id || 0) === bookDuplicateId);
    const remainingMovieRecommendation = remainingItems.find((item) => Number(item?.canonical?.id || 0) === movieCanonicalId && Number(item?.duplicate?.id || 0) === movieDuplicateId);
    assert(!remainingBookRecommendation, 'Expected rejected book recommendation to disappear from queue');
    assert(remainingMovieRecommendation, 'Expected unrelated movie recommendation to remain in queue');
    assert(Number(rejectResponse.data?.recommendations?.summary?.total_candidates || 0) === 1, 'Expected recommendation summary to drop after rejection');

    const feedbackRow = await pool.query(
      `SELECT outcome, reason, context->>'reason_code' AS reason_code
         FROM media_merge_recommendation_feedback
        WHERE pair_low_media_id = $1
          AND pair_high_media_id = $2
          AND library_id = $3
        LIMIT 1`,
      [Math.min(bookCanonicalId, bookDuplicateId), Math.max(bookCanonicalId, bookDuplicateId), libraryId]
    );
    assert(feedbackRow.rows.length === 1, 'Expected recommendation feedback row to persist');
    assert(String(feedbackRow.rows[0]?.outcome || '') === 'rejected', 'Expected persisted feedback outcome to be rejected');
    assert(String(feedbackRow.rows[0]?.reason_code || '') === 'different_title_identity', 'Expected persisted recommendation feedback reason code');

    console.log(JSON.stringify({
      beforeTotalCandidates: Number(response.data?.summary?.total_candidates || 0),
      afterTotalCandidates: Number(rejectResponse.data?.recommendations?.summary?.total_candidates || 0),
      rejectedPairRemoved: !remainingBookRecommendation,
      remainingMovieSummary: remainingMovieRecommendation.summary,
      feedbackOutcome: feedbackRow.rows[0]?.outcome || null,
      feedbackReasonCode: feedbackRow.rows[0]?.reason_code || null
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
