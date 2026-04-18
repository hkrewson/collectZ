'use strict';

const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { ensureUserDefaultScope } = require('../services/libraries');
const { runRepairBookComicDuplicates } = require('./repair-book-comic-duplicates');

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

async function main() {
  const suffix = Date.now();
  const email = `repair-duplicates-multi-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('repair-duplicates-multi-revert-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;
  let canonicalId = null;
  let duplicateOneId = null;
  let duplicateTwoId = null;

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Repair Duplicates Multi Revert Smoke User'
    });

    const scope = await ensureUserDefaultScope(userId);
    libraryId = Number(scope?.libraryId || 0) || null;
    spaceId = Number(scope?.spaceId || 0) || null;
    if (!libraryId || !spaceId) {
      throw new Error(`Missing default scope for temp user ${userId}`);
    }

    await client.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ email, password }),
      headers: { 'Content-Type': 'application/json' }
    });
    await client.fetchCsrfToken();

    const canonical = await pool.query(
      `INSERT INTO media (
         title, media_type, format, type_details, library_id, space_id, added_by, import_source
       ) VALUES (
         $1, 'comic_book', 'Digital', $2::jsonb, $3, $4, $5, 'metron_sync'
       )
       RETURNING id`,
      [
        'Alpha Flight #11: Set-Up / Unleash the Beast!',
        JSON.stringify({
          series: 'Alpha Flight',
          issue_number: '11',
          volume: '1',
          cover_date: '1984-06-01',
          publisher: 'Marvel',
          provider_issue_id: '37018',
          provider_name: 'metron'
        }),
        libraryId,
        spaceId,
        userId
      ]
    );
    canonicalId = Number(canonical.rows[0]?.id || 0) || null;

    const duplicateOne = await pool.query(
      `INSERT INTO media (
         title, media_type, format, type_details, library_id, space_id, added_by, import_source
       ) VALUES (
         $1, 'comic_book', 'Digital', $2::jsonb, $3, $4, $5, 'metron_sync'
       )
       RETURNING id`,
      [
        'Alpha Flight #11: Set-Up / Unleash the Beast!',
        JSON.stringify({
          series: 'Alpha Flight',
          issue_number: '11',
          volume: '1',
          cover_date: '1984-06-01',
          publisher: 'Marvel',
          provider_issue_id: '37018',
          provider_name: 'metron'
        }),
        libraryId,
        spaceId,
        userId
      ]
    );
    duplicateOneId = Number(duplicateOne.rows[0]?.id || 0) || null;

    const duplicateTwo = await pool.query(
      `INSERT INTO media (
         title, media_type, format, type_details, library_id, space_id, added_by, import_source
       ) VALUES (
         $1, 'comic_book', 'Digital', $2::jsonb, $3, $4, $5, 'metron_sync'
       )
       RETURNING id`,
      [
        'Alpha Flight #11: Set-Up / Unleash the Beast!',
        JSON.stringify({
          series: 'Alpha Flight',
          issue_number: '11',
          volume: '1',
          cover_date: '1984-06-01',
          publisher: 'Marvel',
          provider_issue_id: '37018',
          provider_name: 'metron'
        }),
        libraryId,
        spaceId,
        userId
      ]
    );
    duplicateTwoId = Number(duplicateTwo.rows[0]?.id || 0) || null;

    const firstAttach = await runRepairBookComicDuplicates({
      ids: [canonicalId, duplicateOneId],
      canonicalId,
      apply: true
    });
    if (firstAttach.attached !== 1) {
      throw new Error(`Expected first duplicate attach to succeed, got ${JSON.stringify(firstAttach)}`);
    }

    const secondAttach = await runRepairBookComicDuplicates({
      ids: [canonicalId, duplicateTwoId],
      canonicalId,
      apply: true
    });
    if (secondAttach.attached !== 1) {
      throw new Error(`Expected second duplicate attach to succeed, got ${JSON.stringify(secondAttach)}`);
    }

    const beforeRevertDetails = await client.request(
      `/api/media/${canonicalId}/merge-details`,
      { expectStatus: 200 }
    );
    const beforeSummary = beforeRevertDetails?.data?.summary || {};
    const beforeEntries = Array.isArray(beforeRevertDetails?.data?.entries) ? beforeRevertDetails.data.entries : [];
    if (Number(beforeSummary.active_merge_count || 0) !== 2) {
      throw new Error(`Expected two active merge events before revert, got ${JSON.stringify(beforeSummary)}`);
    }
    if (Number(beforeSummary.source_count || 0) !== 3) {
      throw new Error(`Expected three supporting sources before revert, got ${JSON.stringify(beforeSummary)}`);
    }
    if (beforeEntries.length !== 2) {
      throw new Error(`Expected two merge-detail entries before revert, got ${JSON.stringify(beforeEntries)}`);
    }

    const reverted = await runRepairBookComicDuplicates({
      ids: [canonicalId, duplicateOneId],
      canonicalId,
      revert: true
    });
    if (reverted.reverted !== 1) {
      throw new Error(`Expected one reverted duplicate attach, got ${JSON.stringify(reverted)}`);
    }

    const afterRevertDetails = await client.request(
      `/api/media/${canonicalId}/merge-details`,
      { expectStatus: 200 }
    );
    const afterSummary = afterRevertDetails?.data?.summary || {};
    const afterEntries = Array.isArray(afterRevertDetails?.data?.entries) ? afterRevertDetails.data.entries : [];
    if (Number(afterSummary.active_merge_count || 0) !== 1) {
      throw new Error(`Expected one active merge event after partial revert, got ${JSON.stringify(afterSummary)}`);
    }
    if (Number(afterSummary.source_count || 0) !== 2) {
      throw new Error(`Expected two supporting sources after partial revert, got ${JSON.stringify(afterSummary)}`);
    }
    if (afterEntries.length !== 1 || Number(afterEntries[0]?.technical_details?.duplicate_id || 0) !== duplicateTwoId) {
      throw new Error(`Expected only the second duplicate to remain attached after revert, got ${JSON.stringify(afterEntries)}`);
    }

    const mediaRows = await pool.query(
      `SELECT id, media_type, type_details
       FROM media
       WHERE id = ANY($1::int[])
       ORDER BY id ASC`,
      [[canonicalId, duplicateOneId, duplicateTwoId]]
    );
    const mediaIds = new Set((mediaRows.rows || []).map((row) => Number(row.id)));
    if (!mediaIds.has(canonicalId) || !mediaIds.has(duplicateOneId) || mediaIds.has(duplicateTwoId)) {
      throw new Error(`Expected canonical and reverted duplicate to exist, with second duplicate still attached, got ${JSON.stringify(mediaRows.rows)}`);
    }

    const revertedRow = mediaRows.rows.find((row) => Number(row.id) === duplicateOneId) || null;
    if (String(revertedRow?.media_type || '') !== 'comic_book') {
      throw new Error(`Expected reverted duplicate to restore as comic_book, got ${JSON.stringify(revertedRow)}`);
    }

    const historyRows = await pool.query(
      `SELECT duplicate_media_id, applied_at, reverted_at
       FROM media_repair_history
       WHERE canonical_media_id = $1
         AND duplicate_media_id = ANY($2::int[])
         AND repair_type = 'duplicate_attach'
       ORDER BY duplicate_media_id ASC`,
      [canonicalId, [duplicateOneId, duplicateTwoId]]
    );
    const historyByDuplicateId = new Map((historyRows.rows || []).map((row) => [Number(row.duplicate_media_id), row]));
    if (!String(historyByDuplicateId.get(duplicateOneId)?.reverted_at || '').trim()) {
      throw new Error(`Expected reverted history marker for first duplicate, got ${JSON.stringify(historyRows.rows)}`);
    }
    if (String(historyByDuplicateId.get(duplicateTwoId)?.reverted_at || '').trim()) {
      throw new Error(`Expected second duplicate history to remain active, got ${JSON.stringify(historyRows.rows)}`);
    }

    console.log('Repair book/comic multi-revert smoke passed');
    console.log(JSON.stringify({
      canonicalId,
      revertedDuplicateId: duplicateOneId,
      remainingDuplicateId: duplicateTwoId,
      beforeActiveMergeCount: beforeSummary.active_merge_count,
      afterActiveMergeCount: afterSummary.active_merge_count,
      beforeSourceCount: beforeSummary.source_count,
      afterSourceCount: afterSummary.source_count,
      remainingMergeDetailDuplicateId: afterEntries[0]?.technical_details?.duplicate_id || null,
      revertedHistoryRecorded: Boolean(historyByDuplicateId.get(duplicateOneId)?.reverted_at),
      remainingHistoryStillActive: !historyByDuplicateId.get(duplicateTwoId)?.reverted_at
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
