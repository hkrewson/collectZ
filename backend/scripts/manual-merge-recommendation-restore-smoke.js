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

async function createMediaRow({ title, mediaType, year = null, libraryId, spaceId, userId, importSource = 'manual' }) {
  const result = await pool.query(
    `INSERT INTO media (
       title, media_type, format, year, library_id, space_id, added_by, import_source
     ) VALUES (
       $1, $2, 'Digital', $3, $4, $5, $6, $7
     )
     RETURNING id`,
    [title, mediaType, year, libraryId, spaceId, userId, importSource]
  );
  return Number(result.rows[0]?.id || 0) || null;
}

async function main() {
  const suffix = Date.now();
  const email = `manual-merge-restore-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('manual-merge-recommendation-restore-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Manual Merge Recommendation Restore Smoke Admin',
      role: 'admin'
    });

    const scope = await ensureUserDefaultScope(userId);
    libraryId = Number(scope?.libraryId || 0) || null;
    spaceId = Number(scope?.spaceId || 0) || null;
    assert(libraryId && spaceId, 'Expected default scope for restore smoke admin');

    await client.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { email, password }
    });

    const canonicalId = await createMediaRow({
      title: 'The Matrix',
      mediaType: 'movie',
      year: 1999,
      libraryId,
      spaceId,
      userId,
      importSource: 'manual'
    });
    const duplicateId = await createMediaRow({
      title: 'The Matrix',
      mediaType: 'movie',
      year: 1999,
      libraryId,
      spaceId,
      userId,
      importSource: 'csv_generic'
    });

    const rejectResponse = await client.request('/api/media/merge-recommendations/reject?limit=12', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: {
        canonical_id: canonicalId,
        duplicate_id: duplicateId,
        reason_code: 'other',
        reason: 'Suppressed for restore smoke'
      }
    });
    assert(rejectResponse.data?.rejected === true, 'Expected reject endpoint to confirm rejection');

    const historyResponse = await client.request('/api/media/merge-recommendations/history?limit=12&outcome=rejected', {
      method: 'GET',
      expectStatus: 200
    });
    const historyItems = Array.isArray(historyResponse.data?.items) ? historyResponse.data.items : [];
    const historyItem = historyItems.find((item) => Number(item?.canonical?.id || 0) === canonicalId && Number(item?.duplicate?.id || 0) === duplicateId);
    assert(historyItem?.feedback_id, 'Expected suppressed history to include the rejected pair');

    const restoreResponse = await client.request('/api/media/merge-recommendations/restore?limit=12&history_limit=12&outcome=rejected', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: {
        feedback_id: Number(historyItem.feedback_id)
      }
    });
    assert(restoreResponse.data?.restored === true, 'Expected restore endpoint to confirm restore');

    const restoredRecommendation = (restoreResponse.data?.recommendations?.items || []).find((item) => (
      Number(item?.canonical?.id || 0) === canonicalId
      && Number(item?.duplicate?.id || 0) === duplicateId
    ));
    assert(restoredRecommendation, 'Expected restored pair to return to the recommendation queue');

    const remainingHistory = Array.isArray(restoreResponse.data?.history?.items) ? restoreResponse.data.history.items : [];
    const restoredHistoryItem = remainingHistory.find((item) => Number(item?.feedback_id || 0) === Number(historyItem.feedback_id || 0));
    assert(!restoredHistoryItem, 'Expected restored pair to disappear from suppressed history');

    const feedbackRow = await pool.query(
      `SELECT id
         FROM media_merge_recommendation_feedback
        WHERE pair_low_media_id = $1
          AND pair_high_media_id = $2
          AND library_id = $3`,
      [Math.min(canonicalId, duplicateId), Math.max(canonicalId, duplicateId), libraryId]
    );
    assert(feedbackRow.rows.length === 0, 'Expected restore to remove persisted suppression feedback');

    console.log(JSON.stringify({
      historyCountBeforeRestore: Number(historyResponse.data?.summary?.returned_items || 0),
      restored: restoreResponse.data?.restored === true,
      recommendationReturned: Boolean(restoredRecommendation),
      removedFromHistory: !restoredHistoryItem
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
