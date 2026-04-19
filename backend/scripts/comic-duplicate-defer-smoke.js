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
    return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
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

async function createComicRow({ title, series, issueNumber, volume, year, libraryId, spaceId, userId, importSource }) {
  const typeDetails = {
    series,
    issue_number: issueNumber,
    volume
  };
  const result = await pool.query(
    `INSERT INTO media (
       title, media_type, format, year, type_details, library_id, space_id, added_by, import_source
     ) VALUES (
       $1, 'comic_book', 'Digital', $2, $3::jsonb, $4, $5, $6, $7
     )
     RETURNING id`,
    [title, year, JSON.stringify(typeDetails), libraryId, spaceId, userId, importSource]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

async function main() {
  const suffix = Date.now();
  const email = `comic-duplicate-defer-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('comic-duplicate-defer-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Comic Duplicate Defer Smoke Admin',
      role: 'admin'
    });

    const scope = await ensureUserDefaultScope(userId);
    libraryId = Number(scope?.libraryId || 0) || null;
    spaceId = Number(scope?.spaceId || 0) || null;
    assert(libraryId && spaceId, 'Expected default scope for comic duplicate defer smoke admin');

    await client.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { email, password }
    });

    const canonicalId = await createComicRow({
      title: 'Alpha Flight #24: The Dreamqueen Cometh!',
      series: 'Alpha Flight',
      issueNumber: '24',
      volume: '1',
      year: 1985,
      libraryId,
      spaceId,
      userId,
      importSource: 'manual'
    });
    const firstDuplicateId = await createComicRow({
      title: 'Alpha Flight #24: The Dreamqueen Cometh!',
      series: 'Alpha Flight',
      issueNumber: '24',
      volume: '1',
      year: 1985,
      libraryId,
      spaceId,
      userId,
      importSource: 'csv_generic'
    });
    const secondDuplicateId = await createComicRow({
      title: 'Alpha Flight #24: The Dreamqueen Cometh!',
      series: 'Alpha Flight',
      issueNumber: '24',
      volume: '1',
      year: 1985,
      libraryId,
      spaceId,
      userId,
      importSource: 'metron'
    });

    const beforeRecommendations = await client.request('/api/media/merge-recommendations?limit=12', {
      method: 'GET',
      expectStatus: 200
    });
    const beforeRecommendationItems = Array.isArray(beforeRecommendations.data?.items) ? beforeRecommendations.data.items : [];
    const deferredPairBefore = beforeRecommendationItems.find((item) => Number(item?.canonical?.id || 0) === canonicalId && Number(item?.duplicate?.id || 0) === firstDuplicateId);
    assert(deferredPairBefore, 'Expected comic pair to appear in the recommendation queue before deferral');

    const beforeCandidates = await client.request('/api/media/comics/duplicate-candidates?limit=12&search=Alpha%20Flight', {
      method: 'GET',
      expectStatus: 200
    });
    const candidateGroups = Array.isArray(beforeCandidates.data?.items) ? beforeCandidates.data.items : [];
    const alphaFlightGroupBefore = candidateGroups.find((group) => String(group?.series || '') === 'Alpha Flight' && String(group?.issue_number || '') === '24');
    assert(alphaFlightGroupBefore, 'Expected Alpha Flight duplicate group before deferral');
    assert(Array.isArray(alphaFlightGroupBefore.duplicates) && alphaFlightGroupBefore.duplicates.length === 2, 'Expected Alpha Flight duplicate group to expose two duplicates before deferral');

    const deferResponse = await client.request('/api/media/merge-recommendations/defer?limit=12', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: {
        canonical_id: canonicalId,
        duplicate_id: firstDuplicateId,
        reason_code: 'other',
        reason: 'Deferred from comic issue workflow'
      }
    });
    assert(deferResponse.data?.deferred === true, 'Expected defer endpoint to confirm deferral');
    assert(deferResponse.data?.feedback?.outcome === 'deferred', 'Expected defer feedback outcome');

    const remainingRecommendationItems = Array.isArray(deferResponse.data?.recommendations?.items)
      ? deferResponse.data.recommendations.items
      : [];
    const deferredPairAfter = remainingRecommendationItems.find((item) => Number(item?.canonical?.id || 0) === canonicalId && Number(item?.duplicate?.id || 0) === firstDuplicateId);
    const remainingPairAfter = remainingRecommendationItems.find((item) => Number(item?.canonical?.id || 0) === canonicalId && Number(item?.duplicate?.id || 0) === secondDuplicateId);
    assert(!deferredPairAfter, 'Expected deferred comic pair to disappear from the recommendation queue');
    assert(remainingPairAfter, 'Expected the remaining comic pair to stay in the recommendation queue');

    const afterCandidates = await client.request('/api/media/comics/duplicate-candidates?limit=12&search=Alpha%20Flight', {
      method: 'GET',
      expectStatus: 200
    });
    const afterCandidateGroups = Array.isArray(afterCandidates.data?.items) ? afterCandidates.data.items : [];
    const alphaFlightGroupAfter = afterCandidateGroups.find((group) => String(group?.series || '') === 'Alpha Flight' && String(group?.issue_number || '') === '24');
    assert(alphaFlightGroupAfter, 'Expected Alpha Flight duplicate group to remain after deferral');
    assert(Array.isArray(alphaFlightGroupAfter.duplicates) && alphaFlightGroupAfter.duplicates.length === 1, 'Expected deferred comic pair to be removed from the surfaced issue cluster');
    assert(Number(alphaFlightGroupAfter.duplicates[0]?.id || 0) === secondDuplicateId, 'Expected only the non-deferred duplicate to remain in the issue cluster');

    const feedbackRow = await pool.query(
      `SELECT outcome, reason, context->>'reason_code' AS reason_code
         FROM media_merge_recommendation_feedback
        WHERE pair_low_media_id = $1
          AND pair_high_media_id = $2
          AND library_id = $3
        LIMIT 1`,
      [Math.min(canonicalId, firstDuplicateId), Math.max(canonicalId, firstDuplicateId), libraryId]
    );
    assert(feedbackRow.rows.length === 1, 'Expected deferred recommendation feedback row to persist');
    assert(String(feedbackRow.rows[0]?.outcome || '') === 'deferred', 'Expected persisted feedback outcome to be deferred');

    console.log(JSON.stringify({
      beforeDuplicateCount: Number(alphaFlightGroupBefore.duplicates.length || 0),
      afterDuplicateCount: Number(alphaFlightGroupAfter.duplicates.length || 0),
      deferredPairRemovedFromRecommendations: !deferredPairAfter,
      deferredPairRemovedFromComicCandidates: Number(alphaFlightGroupAfter.duplicates.length || 0) === 1,
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
