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

async function createMediaRow({
  title,
  mediaType,
  year = null,
  posterPath = null,
  originalTitle = null,
  director = null,
  runtime = null,
  upc = null,
  tmdbId = null,
  libraryId,
  spaceId,
  userId,
  importSource = 'manual'
}) {
  const result = await pool.query(
    `INSERT INTO media (
       title, media_type, format, year, poster_path, original_title, director, runtime, upc, tmdb_id, type_details, library_id, space_id, added_by, import_source
     ) VALUES (
       $1, $2, 'Digital', $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb, $10, $11, $12, $13
     )
     RETURNING id`,
    [title, mediaType, year, posterPath, originalTitle, director, runtime, upc, tmdbId, libraryId, spaceId, userId, importSource]
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

async function main() {
  const suffix = Date.now();
  const email = `duplicate-discovery-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('duplicate-discovery-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Duplicate Discovery Smoke Admin',
      role: 'admin'
    });

    const scope = await ensureUserDefaultScope(userId);
    libraryId = Number(scope?.libraryId || 0) || null;
    spaceId = Number(scope?.spaceId || 0) || null;
    assert(libraryId && spaceId, 'Expected default scope for duplicate discovery smoke admin');

    await client.request('/api/auth/login', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: { email, password }
    });

    const mst3kVolumeLeftId = await createMediaRow({
      title: 'Mystery Science Theater 3000: Angel\'s Revenge',
      mediaType: 'movie',
      year: 1999,
      posterPath: '/mst3k-shared-cover.jpg',
      libraryId,
      spaceId,
      userId,
      importSource: 'csv_delicious'
    });
    const mst3kVolumeRightId = await createMediaRow({
      title: 'Mystery Science Theater 3000: The Movie',
      mediaType: 'movie',
      year: 1999,
      posterPath: '/mst3k-shared-cover.jpg',
      libraryId,
      spaceId,
      userId,
      importSource: 'csv_delicious'
    });
    const sctvLeftId = await createMediaRow({
      title: 'SCTV Disc 2 - Southside Fracas & The Sammy Maudlin Show',
      mediaType: 'movie',
      year: 1982,
      posterPath: '/sctv-shared-cover.jpg',
      libraryId,
      spaceId,
      userId,
      importSource: 'csv_delicious'
    });
    const sctvRightId = await createMediaRow({
      title: 'SCTV, Volume 2',
      mediaType: 'movie',
      year: 1982,
      posterPath: '/sctv-shared-cover.jpg',
      libraryId,
      spaceId,
      userId,
      importSource: 'csv_delicious'
    });
    const sctvBestOfId = await createMediaRow({
      title: 'SCTV - Best Of The Early Years',
      mediaType: 'movie',
      year: 1982,
      posterPath: '/sctv-shared-cover.jpg',
      libraryId,
      spaceId,
      userId,
      importSource: 'csv_delicious'
    });
    const gorkhaProtectorId = await createMediaRow({
      title: 'Gorkha Protector',
      mediaType: 'movie',
      year: 2021,
      posterPath: '/movie-conflict-shared-cover.jpg',
      originalTitle: 'Gorkha Protector',
      director: 'Akash Adhikari',
      runtime: 80,
      upc: '0889290029546',
      tmdbId: '747574',
      libraryId,
      spaceId,
      userId,
      importSource: 'csv_delicious'
    });
    const reykjavikId = await createMediaRow({
      title: '101 Reykjavik',
      mediaType: 'movie',
      year: 2000,
      posterPath: '/movie-conflict-shared-cover.jpg',
      originalTitle: '101 Reykjavík',
      director: 'Baltasar Kormákur',
      runtime: 88,
      upc: '0099096120136',
      tmdbId: '10989',
      libraryId,
      spaceId,
      userId,
      importSource: 'csv_delicious'
    });
    const futureShock2021Id = await createMediaRow({
      title: 'Future Shock',
      mediaType: 'movie',
      year: 2021,
      posterPath: '/future-shock-a.jpg',
      originalTitle: 'Future Shock',
      director: 'Jose Luis Mora',
      runtime: 98,
      upc: '0732302616930',
      tmdbId: '878032',
      libraryId,
      spaceId,
      userId,
      importSource: 'csv_delicious'
    });
    const futureShock2003Id = await createMediaRow({
      title: 'Future Shock',
      mediaType: 'movie',
      year: 2003,
      posterPath: '/future-shock-b.jpg',
      originalTitle: 'Future Shock',
      director: 'Oley Sassone',
      runtime: 98,
      upc: '0761450635036',
      tmdbId: '91605',
      libraryId,
      spaceId,
      userId,
      importSource: 'csv_delicious'
    });
    const starQuestAnimeId = await createMediaRow({
      title: 'Star Quest',
      mediaType: 'movie',
      year: 2023,
      posterPath: '/star-quest-a.jpg',
      originalTitle: '王立宇宙軍 オネアミスの翼',
      director: 'Hiroyuki Yamaga',
      runtime: 121,
      upc: '0736991452336',
      tmdbId: '20043',
      libraryId,
      spaceId,
      userId,
      importSource: 'csv_delicious'
    });
    const starQuestTerminalVoyageId = await createMediaRow({
      title: 'Star Quest',
      mediaType: 'movie',
      year: 1994,
      posterPath: '/star-quest-b.jpg',
      originalTitle: 'Terminal Voyage',
      director: 'Rick Jacobson',
      runtime: 79,
      tmdbId: '183013',
      libraryId,
      spaceId,
      userId,
      importSource: 'plex'
    });
    const exactTitleLeftId = await createMediaRow({
      title: 'Exact Title Duplicate',
      mediaType: 'movie',
      year: null,
      posterPath: '/other-cover-a.jpg',
      libraryId,
      spaceId,
      userId,
      importSource: 'manual'
    });
    const exactTitleRightId = await createMediaRow({
      title: 'Exact Title Duplicate',
      mediaType: 'movie',
      year: null,
      posterPath: '/other-cover-b.jpg',
      libraryId,
      spaceId,
      userId,
      importSource: 'csv_generic'
    });
    const creatingRemLezarId = await createMediaRow({
      title: 'Creating Rem Lezar',
      mediaType: 'movie',
      year: 2021,
      posterPath: '/creating-rem-lezar-a.jpg',
      originalTitle: 'Creating Rem Lezar',
      director: 'Scott Zakarin',
      runtime: 48,
      tmdbId: '124532',
      libraryId,
      spaceId,
      userId,
      importSource: 'plex'
    });
    const creatingRemLezarAnniversaryId = await createMediaRow({
      title: 'Creating Rem Lezar 35th Anniversary Edition Blu-ray',
      mediaType: 'movie',
      year: 2023,
      posterPath: '/creating-rem-lezar-b.jpg',
      libraryId,
      spaceId,
      userId,
      importSource: 'csv_delicious'
    });
    const blackPantherPlexId = await createMediaRow({
      title: 'Black Panther',
      mediaType: 'movie',
      year: 2018,
      posterPath: '/black-panther-a.jpg',
      director: 'Ryan Coogler',
      runtime: 135,
      tmdbId: '284054',
      libraryId,
      spaceId,
      userId,
      importSource: 'plex'
    });
    const blackPantherPackagingId = await createMediaRow({
      title: 'BLACK PANTHER US/EC/BD',
      mediaType: 'movie',
      year: 2018,
      posterPath: '/black-panther-b.jpg',
      director: 'Ryan Coogler',
      upc: '0786936856330',
      libraryId,
      spaceId,
      userId,
      importSource: 'csv_delicious'
    });
    const infinityWarPackagingId = await createMediaRow({
      title: 'Avengers Infinity War 4K Ultra HD + Blu Ray + Digital Code',
      mediaType: 'movie',
      year: 2018,
      posterPath: '/infinity-war-a.jpg',
      director: 'Joe Russo, Anthony Russo',
      upc: '0786936858112',
      libraryId,
      spaceId,
      userId,
      importSource: 'csv_delicious'
    });
    const infinityWarPlexId = await createMediaRow({
      title: 'Avengers: Infinity War',
      mediaType: 'movie',
      year: 2018,
      posterPath: '/infinity-war-b.jpg',
      director: 'Joe Russo',
      runtime: 149,
      tmdbId: '299536',
      libraryId,
      spaceId,
      userId,
      importSource: 'plex'
    });

    const response = await client.request(`/api/media/discovery-candidates?limit=12&media_id=${exactTitleLeftId}`, {
      method: 'GET',
      expectStatus: 200
    });

    const items = Array.isArray(response.data?.items) ? response.data.items : [];
    const focusedCandidate = items.find((item) => {
      const left = Number(item?.canonical?.id || 0);
      const right = Number(item?.duplicate?.id || 0);
      return [left, right].includes(exactTitleLeftId) && [left, right].includes(exactTitleRightId);
    });
    const mst3kCandidate = items.find((item) => {
      const left = Number(item?.canonical?.id || 0);
      const right = Number(item?.duplicate?.id || 0);
      return [left, right].includes(mst3kVolumeLeftId) && [left, right].includes(mst3kVolumeRightId);
    });
    const sctvDiscVolumeCandidate = items.find((item) => {
      const left = Number(item?.canonical?.id || 0);
      const right = Number(item?.duplicate?.id || 0);
      return [left, right].includes(sctvLeftId) && [left, right].includes(sctvRightId);
    });
    const sctvVolumeBestOfCandidate = items.find((item) => {
      const left = Number(item?.canonical?.id || 0);
      const right = Number(item?.duplicate?.id || 0);
      return [left, right].includes(sctvRightId) && [left, right].includes(sctvBestOfId);
    });

    const broadResponse = await client.request('/api/media/discovery-candidates?limit=50', {
      method: 'GET',
      expectStatus: 200
    });
    const creatingRemLezarResponse = await client.request(`/api/media/discovery-candidates?limit=12&media_id=${creatingRemLezarId}`, {
      method: 'GET',
      expectStatus: 200
    });
    const blackPantherResponse = await client.request(`/api/media/discovery-candidates?limit=12&media_id=${blackPantherPlexId}`, {
      method: 'GET',
      expectStatus: 200
    });
    const infinityWarResponse = await client.request(`/api/media/discovery-candidates?limit=12&media_id=${infinityWarPackagingId}`, {
      method: 'GET',
      expectStatus: 200
    });
    const broadItems = Array.isArray(broadResponse.data?.items) ? broadResponse.data.items : [];
    const creatingRemLezarItems = Array.isArray(creatingRemLezarResponse.data?.items) ? creatingRemLezarResponse.data.items : [];
    const blackPantherItems = Array.isArray(blackPantherResponse.data?.items) ? blackPantherResponse.data.items : [];
    const infinityWarItems = Array.isArray(infinityWarResponse.data?.items) ? infinityWarResponse.data.items : [];
    const gorkhaConflictCandidate = broadItems.find((item) => {
      const left = Number(item?.canonical?.id || 0);
      const right = Number(item?.duplicate?.id || 0);
      return [left, right].includes(gorkhaProtectorId) && [left, right].includes(reykjavikId);
    });
    const futureShockConflictCandidate = broadItems.find((item) => {
      const left = Number(item?.canonical?.id || 0);
      const right = Number(item?.duplicate?.id || 0);
      return [left, right].includes(futureShock2021Id) && [left, right].includes(futureShock2003Id);
    });
    const starQuestConflictCandidate = broadItems.find((item) => {
      const left = Number(item?.canonical?.id || 0);
      const right = Number(item?.duplicate?.id || 0);
      return [left, right].includes(starQuestAnimeId) && [left, right].includes(starQuestTerminalVoyageId);
    });
    const creatingRemLezarCandidate = creatingRemLezarItems.find((item) => {
      const left = Number(item?.canonical?.id || 0);
      const right = Number(item?.duplicate?.id || 0);
      return [left, right].includes(creatingRemLezarId) && [left, right].includes(creatingRemLezarAnniversaryId);
    });
    const blackPantherCandidate = blackPantherItems.find((item) => {
      const left = Number(item?.canonical?.id || 0);
      const right = Number(item?.duplicate?.id || 0);
      return [left, right].includes(blackPantherPlexId) && [left, right].includes(blackPantherPackagingId);
    });
    const infinityWarCandidate = infinityWarItems.find((item) => {
      const left = Number(item?.canonical?.id || 0);
      const right = Number(item?.duplicate?.id || 0);
      return [left, right].includes(infinityWarPackagingId) && [left, right].includes(infinityWarPlexId);
    });

    assert(response.data?.focus?.id === exactTitleLeftId, 'Expected focused discovery record in response');
    assert(focusedCandidate, 'Expected exact-title discovery candidate for focused record');
    assert(focusedCandidate.signal === 'exact_title', 'Expected focused discovery candidate to use exact_title signal');
    assert(focusedCandidate.summary === 'Matched on exact title', 'Expected focused discovery summary to describe exact title');
    assert(Number(response.data?.summary?.exact_title_candidates || 0) >= 1, 'Expected exact-title candidates in discovery summary');
    assert(!mst3kCandidate, 'Expected franchise-separated MST3K titles with a shared cover path to stay out of discovery candidates');
    assert(!sctvDiscVolumeCandidate, 'Expected SCTV disc-versus-volume titles with a shared cover path to stay out of discovery candidates');
    assert(!sctvVolumeBestOfCandidate, 'Expected SCTV volume-versus-best-of titles with a shared cover path to stay out of discovery candidates');
    assert(!gorkhaConflictCandidate, 'Expected movie shared-cover candidates with conflicting strong identity fields to stay out of discovery');
    assert(!futureShockConflictCandidate, 'Expected exact-title movie candidates with conflicting tmdb, upc, year, and director fields to stay out of discovery');
    assert(!starQuestConflictCandidate, 'Expected exact-title movie candidates with conflicting original title, runtime, year, and director fields to stay out of discovery');
    assert(creatingRemLezarCandidate?.signal === 'normalized_movie_title', 'Expected Creating Rem Lezar anniversary packaging variant to surface through normalized movie title discovery');
    assert(blackPantherCandidate?.signal === 'normalized_movie_title', 'Expected Black Panther packaging variant to surface through normalized movie title discovery');
    assert(infinityWarCandidate?.signal === 'normalized_movie_title', 'Expected Infinity War packaging variant to surface through normalized movie title discovery');

    await client.request('/api/media/merge-recommendations/reject', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: {
        canonical_id: Number(focusedCandidate?.canonical?.id || 0),
        duplicate_id: Number(focusedCandidate?.duplicate?.id || 0),
        reason_code: 'different_title_identity',
        reason: 'Discovery queue smoke rejection'
      }
    });
    const refreshedDiscoveryResponse = await client.request(`/api/media/discovery-candidates?limit=12&media_id=${exactTitleLeftId}`, {
      method: 'GET',
      expectStatus: 200
    });
    const refreshedHistoryResponse = await client.request('/api/media/merge-recommendations/history?limit=12&outcome=rejected', {
      method: 'GET',
      expectStatus: 200
    });
    const refreshedDiscovery = Array.isArray(refreshedDiscoveryResponse.data?.items) ? refreshedDiscoveryResponse.data.items : [];
    const refreshedHistory = Array.isArray(refreshedHistoryResponse.data?.items) ? refreshedHistoryResponse.data.items : [];
    const rejectedDiscoveryCandidate = refreshedDiscovery.find((item) => {
      const left = Number(item?.canonical?.id || 0);
      const right = Number(item?.duplicate?.id || 0);
      return [left, right].includes(exactTitleLeftId) && [left, right].includes(exactTitleRightId);
    });
    const discoveryHistoryEntry = refreshedHistory.find((item) => {
      const left = Number(item?.canonical?.id || 0);
      const right = Number(item?.duplicate?.id || 0);
      return [left, right].includes(exactTitleLeftId) && [left, right].includes(exactTitleRightId);
    });
    assert(!rejectedDiscoveryCandidate, 'Expected rejected discovery candidate to disappear from discovery queue');
    assert(discoveryHistoryEntry?.outcome === 'rejected', 'Expected rejected discovery candidate to appear in suppressed history');

    console.log(JSON.stringify({
      focusedTitle: response.data?.focus?.title || null,
      returnedCandidates: Number(response.data?.summary?.returned_candidates || 0),
      exactTitleCandidates: Number(response.data?.summary?.exact_title_candidates || 0),
      normalizedMovieTitleCandidates: Number(broadResponse.data?.summary?.normalized_movie_title_candidates || 0),
      firstSignal: focusedCandidate.signal,
      firstSummary: focusedCandidate.summary,
      discoveryRejected: true,
      suppressedHistoryOutcome: discoveryHistoryEntry?.outcome || null
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
