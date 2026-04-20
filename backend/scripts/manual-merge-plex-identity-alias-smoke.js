'use strict';

const http = require('http');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { buildMediaIdentityAliasKey } = require('../services/mediaIdentityAliases');
const { encryptSecret } = require('../services/crypto');

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
    const {
      method = 'GET',
      body,
      expectStatus,
      withCsrf = false,
      headers: extraHeaders = {}
    } = options;

    const headers = { Accept: 'application/json', ...extraHeaders };
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

async function seedScopedPlexIntegration({ spaceId, apiUrl, token, sectionIds }) {
  await pool.query(
    `INSERT INTO app_integrations (
       space_id,
       plex_preset,
       plex_provider,
       plex_api_url,
       plex_api_key_encrypted,
       plex_library_sections
     ) VALUES (
       $1, 'plex', 'plex', $2, $3, $4::jsonb
     )`,
    [spaceId, apiUrl, encryptSecret(token), JSON.stringify(sectionIds.map(String))]
  );
}

async function cleanupTemporaryState({ userId, libraryId, spaceId }) {
  if (libraryId) {
    await pool.query('DELETE FROM media_merge_recommendation_feedback WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_repair_history WHERE canonical_media_id IN (SELECT id FROM media WHERE library_id = $1) OR duplicate_media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_metadata WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM media_variants WHERE media_id IN (SELECT id FROM media WHERE library_id = $1)', [libraryId]).catch(() => {});
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

async function startFakePlexServer() {
  const plexGuid = 'plex://movie/duplicate-guid-001';
  const plexRatingKey = '999';
  const token = 'plex-smoke-token';
  const sectionsXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<MediaContainer size="1">',
    '  <Directory key="1" title="Smoke Movies" type="movie" />',
    '</MediaContainer>'
  ].join('');
  const sectionItemsXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<MediaContainer size="1">',
    '  <Video',
    `    ratingKey="${plexRatingKey}"`,
    '    key="/library/metadata/999"',
    '    type="movie"',
    '    title="Plex Alias Synced Movie"',
    '    originalTitle="Plex Alias Synced Movie"',
    '    year="2021"',
    '    duration="5700000"',
    '    summary="Plex alias smoke summary"',
    '    studio="Marvel Studios"',
    '    guid="plex://movie/duplicate-guid-001"',
    '  >',
    '    <Media id="2001" duration="5700000" videoResolution="4k" audioChannels="6" container="mp4">',
    '      <Part id="3001" file="/movies/Plex Alias Synced Movie (2021).mp4" />',
    '    </Media>',
    '  </Video>',
    '</MediaContainer>'
  ].join('');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.searchParams.get('X-Plex-Token') !== token) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('unauthorized');
      return;
    }

    if (url.pathname === '/library/sections') {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(sectionsXml);
      return;
    }

    if (url.pathname === '/library/sections/1/all') {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(sectionItemsXml);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const apiUrl = `http://127.0.0.1:${address.port}`;
  return {
    server,
    apiUrl,
    token,
    plexGuid,
    plexItemKey: `1:${plexRatingKey}`
  };
}

async function main() {
  const suffix = Date.now();
  const email = `manual-merge-plex-alias-${suffix}@example.com`;
  const password = 'Passw0rd!123';
  const client = new HttpClient('manual-merge-plex-identity-alias-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;
  let fakePlex = null;

  try {
    fakePlex = await startFakePlexServer();
    userId = await createDirectUser({
      email,
      password,
      name: 'Manual Merge Plex Identity Alias Smoke Admin',
      role: 'admin'
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
    if (!spaceId && libraryId) {
      const scopedLibrary = Array.isArray(scope?.data?.libraries)
        ? scope.data.libraries.find((entry) => Number(entry?.id || 0) === libraryId) || null
        : null;
      spaceId = Number(scopedLibrary?.space_id || 0) || null;
    }
    if (!spaceId && libraryId) {
      const libraryRow = await pool.query('SELECT space_id FROM libraries WHERE id = $1', [libraryId]);
      spaceId = Number(libraryRow.rows[0]?.space_id || 0) || null;
    }
    assert(libraryId && spaceId, `Scope bootstrap failed: ${JSON.stringify(scope?.data)}`);

    await seedScopedPlexIntegration({
      spaceId,
      apiUrl: fakePlex.apiUrl,
      token: fakePlex.token,
      sectionIds: ['1']
    });

    const canonicalInsert = await pool.query(
      `INSERT INTO media (
         title, media_type, format, year, type_details, library_id, space_id, added_by, import_source
       ) VALUES (
         $1, 'movie', 'Blu-ray', 2021, '{}'::jsonb, $2, $3, $4, 'manual_seed'
       )
       RETURNING id`,
      ['Plex Alias Canonical Movie', libraryId, spaceId, userId]
    );
    const canonicalId = Number(canonicalInsert.rows[0]?.id || 0) || null;

    const duplicateInsert = await pool.query(
      `INSERT INTO media (
         title, media_type, format, year, type_details, library_id, space_id, added_by, import_source
       ) VALUES (
         $1, 'movie', 'Digital', 2021, '{}'::jsonb, $2, $3, $4, 'manual_seed'
       )
       RETURNING id`,
      ['Plex Alias Duplicate Movie', libraryId, spaceId, userId]
    );
    const duplicateId = Number(duplicateInsert.rows[0]?.id || 0) || null;
    assert(canonicalId && duplicateId, 'Expected seeded canonical and duplicate movie ids');

    await pool.query(
      `INSERT INTO media_metadata (media_id, "key", "value")
       VALUES
         ($1, 'plex_guid', $2),
         ($1, 'plex_item_key', $3)`,
      [duplicateId, fakePlex.plexGuid, fakePlex.plexItemKey]
    );

    const preview = await client.request('/api/media/merge-preview', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({
        canonical_id: canonicalId,
        duplicate_id: duplicateId
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(preview?.data?.allowed === true, 'Expected manual merge preview to allow Plex alias smoke pair');

    const applyResponse = await client.request('/api/media/merge-apply', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({
        canonical_id: canonicalId,
        duplicate_id: duplicateId
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(applyResponse?.data?.applied === true, 'Expected manual merge apply to succeed');

    const plexGuidAliasKey = buildMediaIdentityAliasKey('plexGuid', fakePlex.plexGuid);
    const plexItemAliasKey = buildMediaIdentityAliasKey('plexItemKey', fakePlex.plexItemKey);
    const aliasRows = await pool.query(
      `SELECT "key", "value"
       FROM media_metadata
       WHERE media_id = $1
         AND "key" = ANY($2::text[])`,
      [canonicalId, [plexGuidAliasKey, plexItemAliasKey]]
    );
    assert(aliasRows.rows.length === 2, 'Expected canonical row to retain duplicate Plex identity aliases');

    const importResponse = await client.request('/api/media/import-plex?sync=1', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ sectionIds: ['1'] }),
      headers: { 'Content-Type': 'application/json' }
    });

    const summary = importResponse?.data?.summary || {};
    assert(Number(summary.created || 0) === 0, `Expected no created rows after alias-preserved Plex reimport, got ${JSON.stringify(summary)}`);
    assert(Number(summary.updated || 0) === 1, `Expected one updated row after alias-preserved Plex reimport, got ${JSON.stringify(summary)}`);

    const mediaCount = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM media
       WHERE library_id = $1
         AND media_type = 'movie'`,
      [libraryId]
    );
    const canonicalRow = await pool.query(
      `SELECT import_source, notes, runtime, network
       FROM media
       WHERE id = $1`,
      [canonicalId]
    );
    const plexMetadataRows = await pool.query(
      `SELECT "key", "value"
       FROM media_metadata
       WHERE media_id = $1
         AND "key" IN ('plex_guid', 'plex_item_key')`,
      [canonicalId]
    );
    const count = Number(mediaCount.rows[0]?.count || 0);
    assert(count === 1, `Expected one movie row after alias-preserved Plex reimport, found ${count}`);
    assert(String(canonicalRow.rows[0]?.import_source || '') === 'plex', 'Expected canonical row import_source to update to plex');
    assert(String(canonicalRow.rows[0]?.notes || '') === 'Imported from Plex section 1', 'Expected canonical row notes to reflect Plex sync');
    assert(Number(canonicalRow.rows[0]?.runtime || 0) === 95, 'Expected canonical row runtime to update from Plex sync');
    assert(String(canonicalRow.rows[0]?.network || '') === 'Marvel Studios', 'Expected canonical row network to update from Plex sync');
    assert(plexMetadataRows.rows.length === 2, 'Expected canonical row to store live Plex metadata after alias-preserved sync');

    console.log(JSON.stringify({
      applied: Boolean(applyResponse?.data?.applied),
      aliasStored: aliasRows.rows.length === 2,
      created: Number(summary.created || 0),
      updated: Number(summary.updated || 0),
      imported: Number(importResponse?.data?.imported || 0),
      matchedBy: 'provider_plex_guid_or_item_key',
      canonicalImportSource: canonicalRow.rows[0]?.import_source || null,
      canonicalRuntime: Number(canonicalRow.rows[0]?.runtime || 0) || null,
      scopedMovieCount: count
    }, null, 2));
  } finally {
    if (fakePlex?.server) {
      await new Promise((resolve) => fakePlex.server.close(() => resolve()));
    }
    await cleanupTemporaryState({ userId, libraryId, spaceId });
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
