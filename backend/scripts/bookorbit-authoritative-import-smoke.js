#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');
const { setCanonicalFieldControl } = require('../services/canonicalMediaFieldControls');
const { createScopedSmokeUser } = require('./helpers/scopedSmokeUser');
const mediaRouter = require('../routes/media');

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
      const index = firstPart.indexOf('=');
      if (index > 0) this.cookies.set(firstPart.slice(0, index).trim(), firstPart.slice(index + 1).trim());
    }
  }

  cookieHeader() {
    return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async request(path, { method = 'GET', body, status = 200, csrf = false } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrf) {
      if (!this.csrfToken) await this.fetchCsrf();
      headers['x-csrf-token'] = this.csrfToken;
    }
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    if (path.includes('/import-bookorbit')) headers['x-valuation-refresh-mode'] = 'fixture';
    const response = await fetch(`${BASE_URL}${path}`, { method, headers, body });
    this.applySetCookies(response.headers);
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    assert.equal(response.status, status, `${this.name} ${method} ${path} returned ${response.status}: ${JSON.stringify(data)}`);
    return data;
  }

  async fetchCsrf() {
    const data = await this.request('/api/auth/csrf-token');
    assert.ok(data?.csrfToken, 'BookOrbit smoke did not receive a CSRF token');
    this.csrfToken = data.csrfToken;
  }
}

function randomIsbn13() {
  const stem = `978${String(crypto.randomInt(0, 1000000000)).padStart(9, '0')}`;
  const weighted = [...stem].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${stem}${(10 - (weighted % 10)) % 10}`;
}

function entry({ id, title, isbn, mime = 'application/epub+zip', extension = 'epub', series = null, seriesIndex = null }) {
  return [
    '<entry>',
    `<id>urn:bookorbit:book:${id}</id>`,
    `<title>${title}</title>`,
    '<updated>2026-11-10T20:00:00.000Z</updated>',
    '<author><name>BookOrbit Smoke Author</name></author>',
    `<dc:identifier>urn:isbn:${isbn}</dc:identifier>`,
    ...(series ? [`<link rel="http://opds-spec.org/sort/series" href="/series/${id}" title="${series}${seriesIndex ? ` #${seriesIndex}` : ''}"/>`] : []),
    `<link rel="http://opds-spec.org/acquisition" type="${mime}" href="/download/${id}.${extension}"/>`,
    '</entry>'
  ].join('');
}

async function waitForDurableBookOrbitJob(connectionId) {
  const deadline = Date.now() + 30000;
  let row = null;
  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT id, public_id, status, attempt_count, max_attempts, space_id, library_id,
              provider_connection_id, target_ref, summary, error, lease_owner, lease_expires_at
         FROM sync_jobs
        WHERE job_type = 'bookorbit_sync' AND provider_connection_id = $1
        ORDER BY id DESC LIMIT 1`,
      [connectionId]
    );
    row = result.rows[0] || null;
    if (row && ['succeeded', 'failed', 'cancelled'].includes(row.status)) return row;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for durable BookOrbit job: ${JSON.stringify(row)}`);
}

function feed(entries) {
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/"><id>urn:bookorbit:smoke</id><title>BookOrbit Smoke</title><updated>2026-11-10T20:00:00.000Z</updated>${entries.join('')}</feed>`;
}

async function startBookOrbitServer(instances) {
  const server = http.createServer((req, res) => {
    const key = String(req.url || '').split('/')[1];
    const instance = instances[key];
    if (!instance || req.url !== `/${key}/api/v1/opds`) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    const expected = `Basic ${Buffer.from(`${instance.username}:${instance.password}`).toString('base64')}`;
    if (req.headers.authorization !== expected) {
      res.writeHead(401, { 'content-type': 'application/atom+xml' });
      return res.end(feed([]));
    }
    res.writeHead(200, { 'content-type': 'application/atom+xml; charset=utf-8' });
    return res.end(feed(instance.entries()));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string', 'BookOrbit smoke server did not start');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function scopeContext(client) {
  const scope = await client.request('/api/auth/scope');
  const libraryId = Number(scope?.active_library_id || 0);
  const spaceId = Number(scope?.active_space_id || 0);
  assert.ok(spaceId && libraryId, `BookOrbit smoke scope bootstrap failed: ${JSON.stringify(scope)}`);
  return { spaceId, libraryId };
}

async function retireActor(userId) {
  if (!userId) return;
  await pool.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]).catch(() => {});
  await pool.query('DELETE FROM personal_access_tokens WHERE user_id = $1', [userId]).catch(() => {});
  const passwordHash = await bcrypt.hash(crypto.randomBytes(48).toString('hex'), 12);
  await pool.query(
    `UPDATE users
        SET email = $2, password = $3, name = 'Retired BookOrbit smoke actor', role = 'user',
            active_space_id = NULL, active_library_id = NULL
      WHERE id = $1`,
    [userId, `retired-bookorbit-smoke-${userId}@example.invalid`, passwordHash]
  ).catch(() => {});
}

async function main() {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const email = `bookorbit-import-${suffix}@example.com`;
  const password = `Orbit!${crypto.randomBytes(18).toString('base64url')}`;
  const one = { username: `one-${suffix}`, password: crypto.randomBytes(24).toString('base64url') };
  const two = { username: `two-${suffix}`, password: crypto.randomBytes(24).toString('base64url') };
  let firstIsbn = randomIsbn13();
  let firstMime = 'application/epub+zip';
  let firstExtension = 'epub';
  const secondIsbn = randomIsbn13();
  const comicIsbn = randomIsbn13();
  const duplicateTitleIsbn = randomIsbn13();
  one.entries = () => [
    entry({ id: 42, title: 'BookOrbit Instance One', isbn: firstIsbn, mime: firstMime, extension: firstExtension, series: 'Orbit Saga', seriesIndex: '2' }),
    entry({ id: 43, title: 'BookOrbit Instance One Comic', isbn: comicIsbn, mime: 'application/vnd.comicbook+zip', extension: 'cbz', series: 'Orbit Saga', seriesIndex: '3' }),
    entry({ id: 44, title: 'BookOrbit Alternate Edition', isbn: firstIsbn }),
    entry({ id: 45, title: 'BookOrbit Audiobook', isbn: randomIsbn13(), mime: 'audio/mp4', extension: 'm4b' }),
    entry({ id: 46, title: 'BookOrbit Instance One Comic', isbn: duplicateTitleIsbn, mime: 'application/vnd.comicbook+zip', extension: 'cbz' })
  ];
  two.entries = () => [entry({ id: 42, title: 'BookOrbit Instance Two', isbn: secondIsbn })];
  const client = new HttpClient('bookorbit-authoritative-import-smoke');
  let userId = null;
  let fake = null;

  try {
    fake = await startBookOrbitServer({ one, two });
    userId = await createScopedSmokeUser({
      pool,
      email,
      password,
      name: 'BookOrbit Authoritative Import Smoke',
      role: 'user',
      slugPrefix: 'bookorbit-import-smoke'
    });
    await client.request('/api/auth/login', {
      method: 'POST',
      csrf: true,
      body: JSON.stringify({ email, password })
    });
    await client.fetchCsrf();
    const { spaceId, libraryId } = await scopeContext(client);

    const createConnection = async (key, instance) => {
      const response = await client.request(`/api/spaces/${spaceId}/integrations/bookorbit-connections`, {
        method: 'POST',
        status: 201,
        csrf: true,
        body: JSON.stringify({
          name: `BookOrbit ${key}`,
          baseUrl: fake.baseUrl,
          settings: { catalogPath: `/${key}/api/v1/opds`, timeoutMs: 5000, maxPages: 5 },
          credentials: { username: instance.username, password: instance.password }
        })
      });
      assert.equal(response?.connection?.providerType, 'bookorbit');
      assert.equal(response?.connection?.credentialsConfigured, true);
      assert.equal(JSON.stringify(response).includes(instance.password), false);
      assert.equal(JSON.stringify(response).includes(instance.username), false);
      return response.connection.id;
    };

    const firstConnectionId = await createConnection('one', one);
    const secondConnectionId = await createConnection('two', two);
    const scheduledTarget = await client.request(`/api/spaces/${spaceId}/integrations/bookorbit-connections/${firstConnectionId}/sync-target`, {
      method: 'PUT',
      csrf: true,
      body: JSON.stringify({ libraryId, enabled: true, intervalMinutes: 360 })
    });
    assert.equal(scheduledTarget.target.enabled, true);
    assert.equal(scheduledTarget.target.libraryId, libraryId);
    const rescheduledTarget = await client.request(`/api/spaces/${spaceId}/integrations/bookorbit-connections/${firstConnectionId}/sync-target`, {
      method: 'PUT',
      csrf: true,
      body: JSON.stringify({ libraryId, enabled: true, intervalMinutes: 720 })
    });
    assert.equal(rescheduledTarget.target.id, scheduledTarget.target.id);
    assert.equal(rescheduledTarget.target.intervalMinutes, 720);
    const restoredTarget = await client.request(`/api/spaces/${spaceId}/integrations/bookorbit-connections/${firstConnectionId}/sync-target`, {
      method: 'PUT',
      csrf: true,
      body: JSON.stringify({ libraryId, enabled: true, intervalMinutes: 360 })
    });
    assert.equal(restoredTarget.target.id, scheduledTarget.target.id);
    const syncTargets = await client.request(`/api/spaces/${spaceId}/integrations/bookorbit-connections/${firstConnectionId}/sync-targets`);
    assert.equal(syncTargets.targets.length, 1);
    const listed = await client.request(`/api/spaces/${spaceId}/integrations/bookorbit-connections`);
    assert.equal(listed.connections.length, 2);
    assert.equal(JSON.stringify(listed).includes(one.password), false);
    assert.equal(JSON.stringify(listed).includes(two.username), false);
    const importChoices = await client.request('/api/media/bookorbit-connections');
    assert.equal(importChoices.connections.length, 2);
    assert.deepEqual(Object.keys(importChoices.connections[0]).sort(), ['displayName', 'id']);
    assert.equal(JSON.stringify(importChoices).includes(fake.baseUrl), false);
    assert.equal(JSON.stringify(importChoices).includes(one.username), false);

    const tested = await client.request(`/api/spaces/${spaceId}/integrations/bookorbit-connections/${firstConnectionId}/test`, {
      method: 'POST',
      csrf: true
    });
    assert.equal(tested.ok, true);
    assert.equal(tested.publications, 5);

    const rotatedPassword = crypto.randomBytes(24).toString('base64url');
    const rotated = await client.request(`/api/spaces/${spaceId}/integrations/bookorbit-connections/${firstConnectionId}/credentials`, {
      method: 'PUT',
      csrf: true,
      body: JSON.stringify({ credentials: { username: one.username, password: rotatedPassword } })
    });
    assert.equal(rotated.credentialsConfigured, true);
    assert.equal(JSON.stringify(rotated).includes(rotatedPassword), false);
    one.password = rotatedPassword;
    const retested = await client.request(`/api/spaces/${spaceId}/integrations/bookorbit-connections/${firstConnectionId}/test`, {
      method: 'POST',
      csrf: true
    });
    assert.equal(retested.ok, true);

    const disabled = await client.request(`/api/spaces/${spaceId}/integrations/bookorbit-connections/${firstConnectionId}/status`, {
      method: 'PUT',
      csrf: true,
      body: JSON.stringify({ status: 'disabled' })
    });
    assert.equal(disabled.connection.status, 'disabled');
    const refused = await client.request(`/api/spaces/${spaceId}/integrations/bookorbit-connections/${firstConnectionId}/test`, {
      method: 'POST',
      status: 409,
      csrf: true
    });
    assert.equal(refused.code, 'PROVIDER_CONNECTION_INACTIVE');
    const reactivated = await client.request(`/api/spaces/${spaceId}/integrations/bookorbit-connections/${firstConnectionId}/status`, {
      method: 'PUT',
      csrf: true,
      body: JSON.stringify({ status: 'active' })
    });
    assert.equal(reactivated.connection.status, 'active');

    const importConnection = (connectionId) => client.request('/api/media/import-bookorbit?sync=1', {
      method: 'POST',
      csrf: true,
      body: JSON.stringify({ connectionId })
    });
    const firstImport = await importConnection(firstConnectionId);
    assert.equal(firstImport.summary.created, 4);
    assert.equal(firstImport.summary.skipped_invalid, 1);
    assert.equal(firstImport.summary.errors.length, 0);
    assert.equal(firstImport.summary.completedWithErrors, false);
    assert.equal(firstImport.summary.completedWithSkips, true);
    assert.equal(firstImport.summary.skippedCount, 1);
    assert.ok(firstImport.summary.matchModes.strong_identifier_conflict_guarded >= 1);
    assert.equal(firstImport.summary.duplicateTitleReviewRows, 2);
    assert.ok(firstImport.summary.diagnosticsFlagged >= 3);
    const duplicateTitleRows = firstImport.auditRows
      .filter((row) => Array.isArray(row.review_reasons) && row.review_reasons.length > 0);
    assert.equal(duplicateTitleRows.length, 2);
    assert.deepEqual(
      duplicateTitleRows.map((row) => row.provider_item_id).sort(),
      ['urn:bookorbit:book:43', 'urn:bookorbit:book:46']
    );
    const audioAudit = firstImport.auditRows.find((row) => row.title === 'BookOrbit Audiobook');
    assert.equal(audioAudit?.status, 'skipped_invalid');
    assert.match(audioAudit?.detail || '', /audio acquisitions are not supported/i);
    const firstMediaId = await withAuthorizedScopeTransaction(pool, { spaceId, libraryId }, userId, async (db) => {
      const identity = await db.query(
        `SELECT media_id FROM external_media_identities
          WHERE space_id = $1 AND provider_connection_id = $2
            AND identity_kind = 'book' AND external_id_normalized = 'urn:bookorbit:book:42' AND active`,
        [spaceId, firstConnectionId]
      );
      const mediaId = Number(identity.rows[0]?.media_id || 0);
      assert.ok(mediaId, 'BookOrbit smoke could not resolve the first canonical row');
      await db.query('UPDATE media SET title = $3 WHERE id = $1 AND space_id = $2', [mediaId, spaceId, 'Manual BookOrbit Title']);
      await setCanonicalFieldControl(db, {
        spaceId,
        mediaId,
        fieldPath: 'media.title',
        authority: 'manual',
        providerWriteMode: 'preserve',
        locked: true,
        providerConnectionId: null,
        actorId: userId
      });
      return mediaId;
    });
    const originalIsbn = firstIsbn;
    firstIsbn = randomIsbn13();
    const repeated = await importConnection(firstConnectionId);
    assert.equal(repeated.summary.created, 0);
    assert.equal(repeated.summary.updated, 4);
    assert.equal(repeated.summary.skipped_invalid, 1);
    assert.equal(repeated.summary.matchModes.matched_by_provider_identity, 4);
    firstMime = 'application/vnd.comicbook+zip';
    firstExtension = 'cbz';
    const typeTransition = await importConnection(firstConnectionId);
    assert.equal(typeTransition.summary.created, 0);
    assert.equal(typeTransition.summary.updated, 4);
    assert.equal(typeTransition.summary.errors.length, 0);
    const transitionedAudit = typeTransition.auditRows.find((row) => row.provider_item_id === 'urn:bookorbit:book:42');
    assert.equal(transitionedAudit?.provider_type_transition?.action, 'refresh');
    assert.equal(transitionedAudit?.provider_type_transition?.from, 'book');
    assert.equal(transitionedAudit?.provider_type_transition?.to, 'comic_book');
    const scheduled = await mediaRouter.runBookOrbitSyncSchedulerOnce({ spaceId });
    assert.equal(scheduled.targetCount, 1);
    assert.equal(scheduled.jobsQueued, 1);
    const durableJob = await waitForDurableBookOrbitJob(firstConnectionId);
    assert.equal(durableJob.status, 'succeeded');
    assert.equal(durableJob.attempt_count, 1);
    assert.equal(durableJob.max_attempts, 3);
    assert.equal(durableJob.space_id, spaceId);
    assert.equal(durableJob.library_id, libraryId);
    assert.equal(durableJob.provider_connection_id, firstConnectionId);
    assert.equal(durableJob.summary?.comicSeriesRows, 2);
    assert.equal(durableJob.summary?.comicSeriesOrderedRows, 2);
    assert.equal(durableJob.lease_owner, null);
    assert.equal(durableJob.lease_expires_at, null);
    assert.equal(JSON.stringify(durableJob.target_ref).includes(one.password), false);
    await withAuthorizedScopeTransaction(pool, { spaceId, libraryId }, userId, (db) => db.query(
      'UPDATE provider_sync_targets SET last_enqueued_at = NULL WHERE space_id = $1 AND provider_connection_id = $2',
      [spaceId, firstConnectionId]
    ));
    const duplicateCadence = await mediaRouter.runBookOrbitSyncSchedulerOnce({ spaceId });
    assert.equal(duplicateCadence.jobsQueued, 0);
    assert.equal(duplicateCadence.jobsReused, 1);
    await withAuthorizedScopeTransaction(pool, { spaceId, libraryId }, userId, async (db) => {
      await setCanonicalFieldControl(db, {
        spaceId,
        mediaId: firstMediaId,
        fieldPath: 'media.media_type',
        authority: 'manual',
        providerWriteMode: 'preserve',
        locked: true,
        providerConnectionId: null,
        actorId: userId
      });
    });
    firstMime = 'application/epub+zip';
    firstExtension = 'epub';
    const reviewRequired = await importConnection(firstConnectionId);
    assert.equal(reviewRequired.summary.created, 0);
    assert.equal(reviewRequired.summary.updated, 3);
    assert.equal(reviewRequired.summary.skipped_invalid, 2);
    assert.equal(reviewRequired.summary.errors.length, 0);
    assert.equal(reviewRequired.summary.typeTransitionReviewRows, 1);
    const reviewAudit = reviewRequired.auditRows.find((row) => row.provider_item_id === 'urn:bookorbit:book:42');
    assert.equal(reviewAudit?.status, 'review_required');
    assert.equal(reviewAudit?.audit_outcome, 'type_transition_review');
    assert.equal(reviewAudit?.current_media_type, 'comic_book');
    assert.equal(reviewAudit?.proposed_media_type, 'book');
    assert.equal(reviewAudit?.transition_reason, 'locked');
    const secondImport = await importConnection(secondConnectionId);
    assert.equal(secondImport.summary.created, 1);

    const { identityRows, sameIsbnRows, mediaRows } = await withAuthorizedScopeTransaction(pool, { spaceId, libraryId }, userId, async (db) => {
      const scopedIdentityRows = await db.query(
        `SELECT provider_connection_id, media_id, external_id_normalized
           FROM external_media_identities
          WHERE space_id = $1 AND identity_kind = 'book'
            AND external_id_normalized = 'urn:bookorbit:book:42' AND active
          ORDER BY provider_connection_id`,
        [spaceId]
      );
      const scopedMediaRows = await db.query(
        `SELECT id, title, media_type, type_details
           FROM media
          WHERE space_id = $1 AND library_id = $2
            AND import_source = 'bookorbit'
          ORDER BY id`,
        [spaceId, libraryId]
      );
      const scopedSameIsbnRows = await db.query(
        `SELECT external_id_normalized, media_id
           FROM external_media_identities
          WHERE space_id = $1 AND provider_connection_id = $2 AND active
            AND external_id_normalized IN ('urn:bookorbit:book:42', 'urn:bookorbit:book:44')
          ORDER BY external_id_normalized`,
        [spaceId, firstConnectionId]
      );
      return { identityRows: scopedIdentityRows, sameIsbnRows: scopedSameIsbnRows, mediaRows: scopedMediaRows };
    });
    assert.equal(identityRows.rowCount, 2);
    assert.notEqual(identityRows.rows[0].provider_connection_id, identityRows.rows[1].provider_connection_id);
    assert.notEqual(Number(identityRows.rows[0].media_id), Number(identityRows.rows[1].media_id));

    assert.equal(sameIsbnRows.rowCount, 2);
    assert.notEqual(Number(sameIsbnRows.rows[0].media_id), Number(sameIsbnRows.rows[1].media_id));

    assert.equal(mediaRows.rowCount, 5);
    const firstBook = mediaRows.rows.find((row) => Number(row.id) === firstMediaId);
    const comic = mediaRows.rows.find((row) => row.type_details?.provider_item_id === 'urn:bookorbit:book:43');
    assert.equal(firstBook?.type_details?.provider_item_id, 'urn:bookorbit:book:42');
    assert.equal(firstBook?.media_type, 'comic_book');
    assert.equal(firstBook?.type_details?.isbn, firstIsbn);
    assert.notEqual(firstBook?.type_details?.isbn, originalIsbn);
    assert.equal(firstBook?.title, 'Manual BookOrbit Title');
    assert.equal(firstBook?.type_details?.series, 'Orbit Saga');
    assert.equal(firstBook?.type_details?.series_index, '2');
    assert.equal(firstBook?.type_details?.issue_number || null, null);
    assert.equal(comic?.type_details?.provider_item_id, 'urn:bookorbit:book:43');
    assert.equal(mediaRows.rows.some((row) => row.type_details?.provider_item_id === 'urn:bookorbit:book:45'), false);

    console.log(JSON.stringify({
      passed: true,
      connections: listed.connections.length,
      firstCreated: firstImport.summary.created,
      repeatUpdated: repeated.summary.updated,
      typeTransition: 'book-to-comic-same-canonical',
      durableScheduledSync: 'one-leased-attempt',
      stableRelationalSyncTarget: true,
      scheduledCadenceDeduplicated: true,
      comicSeriesOrderingPreserved: true,
      lockedTypeTransition: 'review-required-existing-preserved',
      secondCreated: secondImport.summary.created,
      canonicalRows: mediaRows.rowCount,
      sameIsbnDistinctProviderRows: sameIsbnRows.rowCount,
      unsupportedAudio: 'skipped',
      duplicateTitleReviewRows: 2,
      overlappingIdentityRows: identityRows.rowCount,
      credentialReadback: 'redacted',
      lifecycle: 'disabled-refused-reactivated',
      lockedTitle: 'preserved'
    }));
  } finally {
    if (fake?.server) await new Promise((resolve) => fake.server.close(resolve));
    await retireActor(userId);
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
