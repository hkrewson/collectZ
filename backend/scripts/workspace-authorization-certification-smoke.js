#!/usr/bin/env node

'use strict';

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db/pool');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class HttpClient {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
  }

  applyCookies(headers) {
    const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const value of values) {
      const pair = String(value).split(';')[0];
      const separator = pair.indexOf('=');
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }

  cookieHeader() {
    return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async request(pathname, { method = 'GET', body, csrf = false, expected } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;
    if (csrf) {
      const tokenResponse = await this.request('/api/auth/csrf-token', { expected: 200 });
      headers['x-csrf-token'] = tokenResponse.data.csrfToken;
      const refreshedCookie = this.cookieHeader();
      if (refreshedCookie) headers.cookie = refreshedCookie;
    }
    const response = await fetch(`${BASE_URL}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    this.applyCookies(response.headers);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (expected !== undefined && response.status !== expected) {
      throw new Error(`[${this.name}] ${method} ${pathname} expected ${expected}, got ${response.status}: ${JSON.stringify(data)}`);
    }
    return { status: response.status, data };
  }
}

async function createUser(email, password, role = 'user') {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, $3, $4, true, NOW()) RETURNING id`,
    [email, passwordHash, `Workspace certification ${role}`, role]
  );
  return Number(result.rows[0].id);
}

async function createScope({ suffix, ownerId, memberId = null, memberRole = 'viewer' }) {
  const space = await pool.query(
    `INSERT INTO spaces (name, slug, created_by, is_personal)
     VALUES ($1, $2, $3, false) RETURNING id`,
    [`Workspace certification ${suffix}`, `workspace-cert-${suffix}`, ownerId]
  );
  const spaceId = Number(space.rows[0].id);
  await pool.query(
    `INSERT INTO space_memberships (space_id, user_id, role, created_by)
     VALUES ($1, $2, 'owner', $2)`,
    [spaceId, ownerId]
  );
  if (memberId) {
    await pool.query(
      `INSERT INTO space_memberships (space_id, user_id, role, created_by)
       VALUES ($1, $2, $3, $4)`,
      [spaceId, memberId, memberRole, ownerId]
    );
  }
  const library = await pool.query(
    `INSERT INTO libraries (space_id, name, created_by)
     VALUES ($1, $2, $3) RETURNING id`,
    [spaceId, `Workspace certification library ${suffix}`, ownerId]
  );
  const libraryId = Number(library.rows[0].id);
  await pool.query(
    `INSERT INTO library_memberships (user_id, library_id, role)
     VALUES ($1, $2, 'owner')`,
    [ownerId, libraryId]
  );
  if (memberId) {
    await pool.query(
      `INSERT INTO library_memberships (user_id, library_id, role)
       VALUES ($1, $2, $3)`,
      [memberId, libraryId, memberRole]
    );
  }
  await pool.query(
    `UPDATE users SET active_space_id = $2, active_library_id = $3
      WHERE id = ANY($1::int[])`,
    [[ownerId, ...(memberId ? [memberId] : [])], spaceId, libraryId]
  );
  return { spaceId, libraryId };
}

async function login(client, email, password) {
  await client.request('/api/auth/login', { method: 'POST', body: { email, password }, expected: 200 });
}

async function main() {
  const suffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const credentials = {
    owner: { email: `workspace-owner-${suffix}@example.invalid`, password: crypto.randomBytes(32).toString('hex') },
    viewer: { email: `workspace-viewer-${suffix}@example.invalid`, password: crypto.randomBytes(32).toString('hex') },
    outsider: { email: `workspace-outsider-${suffix}@example.invalid`, password: crypto.randomBytes(32).toString('hex') }
  };
  const userIds = [];
  const spaceIds = [];
  let mediaId = null;
  let jobId = null;

  try {
    const anonymous = new HttpClient('anonymous');
    await anonymous.request('/api/media', { expected: 401 });

    const ownerId = await createUser(credentials.owner.email, credentials.owner.password);
    const viewerId = await createUser(credentials.viewer.email, credentials.viewer.password, 'viewer');
    const outsiderId = await createUser(credentials.outsider.email, credentials.outsider.password);
    userIds.push(ownerId, viewerId, outsiderId);
    const ownedScope = await createScope({ suffix: `${suffix}-a`, ownerId, memberId: viewerId, memberRole: 'viewer' });
    const outsiderScope = await createScope({ suffix: `${suffix}-b`, ownerId: outsiderId });
    spaceIds.push(ownedScope.spaceId, outsiderScope.spaceId);

    const owner = new HttpClient('owner');
    const viewer = new HttpClient('viewer');
    const outsider = new HttpClient('outsider');
    await login(owner, credentials.owner.email, credentials.owner.password);
    await login(viewer, credentials.viewer.email, credentials.viewer.password);
    await login(outsider, credentials.outsider.email, credentials.outsider.password);

    const created = await owner.request('/api/media', {
      method: 'POST',
      csrf: true,
      expected: 201,
      body: { title: `Workspace certification media ${suffix}`, media_type: 'movie', format: 'Digital' }
    });
    mediaId = Number(created.data?.id || 0);
    assert(mediaId > 0, 'Owner media id was not returned');

    const viewerList = await viewer.request('/api/media', { expected: 200 });
    assert(viewerList.data?.items?.some((item) => Number(item.id) === mediaId), 'Read-only member lost workspace read access');
    const viewerMutation = await viewer.request(`/api/media/${mediaId}`, {
      method: 'PATCH',
      csrf: true,
      body: { notes: 'must not persist' }
    });
    assert([403, 404].includes(viewerMutation.status), `Read-only member mutation returned ${viewerMutation.status}`);

    const outsiderRead = await outsider.request(`/api/media/${mediaId}`);
    assert([403, 404].includes(outsiderRead.status), `Sibling workspace detail read returned ${outsiderRead.status}`);
    const outsiderMutation = await outsider.request(`/api/media/${mediaId}`, {
      method: 'PATCH',
      csrf: true,
      body: { notes: 'cross-workspace tamper' }
    });
    assert([403, 404].includes(outsiderMutation.status), `Sibling workspace identifier mutation returned ${outsiderMutation.status}`);
    const outsiderIntegration = await outsider.request(`/api/spaces/${ownedScope.spaceId}/integrations`);
    assert([403, 404].includes(outsiderIntegration.status), `Sibling workspace provider read returned ${outsiderIntegration.status}`);

    const job = await pool.query(
      `INSERT INTO sync_jobs (job_type, provider, status, created_by, scope, progress)
       VALUES ('workspace_certification', 'fixture', 'queued', $1, $2::jsonb, '{}'::jsonb)
       RETURNING id`,
      [ownerId, JSON.stringify({ spaceId: ownedScope.spaceId, libraryId: ownedScope.libraryId })]
    );
    jobId = Number(job.rows[0].id);
    await owner.request(`/api/media/sync-jobs/${jobId}`, { expected: 200 });
    const outsiderJob = await outsider.request(`/api/media/sync-jobs/${jobId}`);
    assert([403, 404].includes(outsiderJob.status), `Sibling workspace background job read returned ${outsiderJob.status}`);

    console.log(JSON.stringify({
      status: 'passed',
      anonymousDenied: true,
      readOnlyMutationDenied: true,
      siblingWorkspaceReadDenied: true,
      identifierTamperingDenied: true,
      providerScopeDenied: true,
      backgroundJobIsolationDenied: true
    }));
  } finally {
    if (jobId) await pool.query('DELETE FROM sync_jobs WHERE id = $1', [jobId]).catch(() => {});
    if (mediaId) await pool.query('DELETE FROM media WHERE id = $1', [mediaId]).catch(() => {});
    if (spaceIds.length) {
      await pool.query('DELETE FROM app_integrations WHERE space_id = ANY($1::int[])', [spaceIds]).catch(() => {});
      await pool.query('DELETE FROM library_memberships WHERE library_id IN (SELECT id FROM libraries WHERE space_id = ANY($1::int[]))', [spaceIds]).catch(() => {});
      await pool.query('DELETE FROM libraries WHERE space_id = ANY($1::int[])', [spaceIds]).catch(() => {});
      await pool.query('DELETE FROM space_memberships WHERE space_id = ANY($1::int[])', [spaceIds]).catch(() => {});
      await pool.query('DELETE FROM spaces WHERE id = ANY($1::int[])', [spaceIds]).catch(() => {});
    }
    if (userIds.length) await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [userIds]).catch(() => {});
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`Workspace authorization certification smoke failed: ${error.message}`);
  process.exit(1);
});
