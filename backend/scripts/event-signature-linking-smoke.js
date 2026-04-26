'use strict';

const crypto = require('crypto');
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
    const response = await fetch(`${BASE_URL}${path}`, { method, headers, body });
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
    await pool.query('DELETE FROM signature_records WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM event_artifacts WHERE event_id IN (SELECT id FROM events WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM event_purchased_items WHERE event_id IN (SELECT id FROM events WHERE library_id = $1)', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM events WHERE library_id = $1', [libraryId]).catch(() => {});
    await pool.query('DELETE FROM art_items WHERE library_id = $1', [libraryId]).catch(() => {});
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
  const email = `event-signature-linking-smoke-${suffix}@example.com`;
  const password = `Passw0rd!${crypto.randomBytes(6).toString('hex')}`;
  const client = new HttpClient('event-signature-linking-smoke');
  let userId = null;
  let libraryId = null;
  let spaceId = null;

  try {
    userId = await createDirectUser({
      email,
      password,
      name: 'Event Signature Linking Smoke Admin',
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

    const eventResponse = await client.request('/api/events', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: JSON.stringify({
        title: 'Signature Bridge Expo',
        url: 'https://example.com/signature-bridge-expo',
        location: 'Chicago, IL',
        date_start: '2026-04-26',
        notes: 'Smoke event for autograph signature linking'
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    const eventId = Number(eventResponse?.data?.id || 0);
    assert(eventId > 0, `Expected event id, got ${JSON.stringify(eventResponse?.data)}`);

    const artResponse = await client.request('/api/art', {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: JSON.stringify({
        title: 'Bast',
        artist: 'Nigel Sade',
        series: 'Croyance',
        vendor: 'Studio Sade',
        price: 250
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    const artId = Number(artResponse?.data?.id || 0);
    assert(artId > 0, `Expected art id, got ${JSON.stringify(artResponse?.data)}`);

    const artifactResponse = await client.request(`/api/events/${eventId}/artifacts`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 201,
      body: JSON.stringify({
        artifact_type: 'autograph',
        title: 'Nigel Sade autograph',
        description: 'Signed at the booth during the event',
        signer_name: 'Nigel Sade',
        signer_role: 'Artist',
        signed_on: '2026-04-26',
        signed_at: 'Studio Sade booth',
        proof_path: '/uploads/signature-bridge-proof.jpg',
        signature_notes: 'Event-captured autograph evidence'
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    const artifactId = Number(artifactResponse?.data?.id || 0);
    assert(artifactId > 0, `Expected artifact id, got ${JSON.stringify(artifactResponse?.data)}`);
    assert(artifactResponse?.data?.event_artifact_signature?.owner_type === 'event_artifact', 'Expected event autograph signature to be captured as event_artifact');
    assert(!artifactResponse?.data?.linked_signature, 'Expected no object signature link before explicit linking');

    const linkResponse = await client.request(`/api/events/${eventId}/artifacts/${artifactId}/link-signature`, {
      method: 'POST',
      withCsrf: true,
      expectStatus: 200,
      body: JSON.stringify({ owner_type: 'art', owner_id: artId }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert(linkResponse?.data?.signature?.owner_type === 'art', 'Expected linked signature owner_type art');
    assert(Number(linkResponse?.data?.signature?.owner_id || 0) === artId, 'Expected linked signature owner_id to match art id');
    assert(Number(linkResponse?.data?.signature?.signed_event_id || 0) === eventId, 'Expected linked signature to preserve signed_event_id');
    assert(linkResponse?.data?.artifact?.linked_signature?.owner_type === 'art', 'Expected artifact readback to include linked object signature');
    assert(linkResponse?.data?.artifact?.event_artifact_signature?.owner_type === 'event_artifact', 'Expected artifact readback to retain event-captured signature');

    const artDetail = await client.request(`/api/art/${artId}`, { expectStatus: 200 });
    const artSignatures = Array.isArray(artDetail?.data?.signatures) ? artDetail.data.signatures : [];
    const primaryArtSignature = artSignatures.find((signature) => signature.is_primary) || artSignatures[0] || null;
    assert(artDetail?.data?.signed === true, 'Expected Art item to be marked signed after linking');
    assert(primaryArtSignature?.signer_name === 'Nigel Sade', 'Expected Art signature to inherit event autograph signer');
    assert(Number(primaryArtSignature?.signed_event_id || 0) === eventId, 'Expected Art signature to reference source event');

    const signatureRows = await pool.query(
      `SELECT owner_type, owner_id, signer_name, signed_event_id
       FROM signature_records
       WHERE owner_type IN ('event_artifact', 'art')
         AND owner_id IN ($1, $2)
         AND archived_at IS NULL
       ORDER BY owner_type`,
      [artifactId, artId]
    );
    assert(signatureRows.rows.length >= 2, `Expected event_artifact and art signature records, got ${JSON.stringify(signatureRows.rows)}`);

    console.log(JSON.stringify({
      eventId,
      artId,
      artifactId,
      linkedSignatureId: linkResponse.data.signature.id,
      artSigned: artDetail.data.signed,
      signatureOwners: signatureRows.rows.map((row) => row.owner_type)
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
