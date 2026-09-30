'use strict';

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db/pool');
const {
  loadWorkspaceValuationIntegrationConfig,
  loadWorkspaceOcrIntegrationConfig
} = require('../services/integrations');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class HttpClient {
  constructor() {
    this.cookies = new Map();
    this.csrfToken = '';
  }

  applySetCookies(headers) {
    const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const line of values) {
      const pair = String(line || '').split(';')[0] || '';
      const separator = pair.indexOf('=');
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }

  async request(path, { method = 'GET', body, withCsrf = false, expectStatus = 200 } = {}) {
    if (withCsrf && !this.csrfToken) {
      const csrf = await this.request('/api/auth/csrf-token');
      this.csrfToken = csrf.data?.csrfToken || '';
    }
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (withCsrf) headers['x-csrf-token'] = this.csrfToken;
    if (this.cookies.size) {
      headers.Cookie = [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
    }
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    this.applySetCookies(response.headers);
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (response.status !== expectStatus) {
      throw new Error(`${method} ${path} expected ${expectStatus}, got ${response.status}: ${JSON.stringify(data)}`);
    }
    return { data, status: response.status };
  }
}

async function main() {
  const suffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const email = `workspace-provider-ownership-${suffix}@example.test`;
  const password = `WorkspaceProvider-${suffix}`;
  const secrets = {
    priceA: `price-a-${suffix}`,
    ebayA: `ebay-a-${suffix}`,
    visionA: `vision-a-${suffix}`,
    priceB: `price-b-${suffix}`,
    ebayB: `ebay-b-${suffix}`,
    visionB: `vision-b-${suffix}`
  };
  let userId = null;
  const spaceIds = [];

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const userResult = await pool.query(
      `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
       VALUES ($1, $2, 'Workspace Provider Ownership Smoke', 'admin', true, NOW())
       RETURNING id`,
      [email, passwordHash]
    );
    userId = Number(userResult.rows[0]?.id || 0);
    assert(userId > 0, 'Expected smoke user');

    for (const label of ['a', 'b']) {
      const spaceResult = await pool.query(
        `INSERT INTO spaces (name, slug, created_by, is_personal)
         VALUES ($1, $2, $3, false)
         RETURNING id`,
        [`Workspace Provider ${label.toUpperCase()} ${suffix}`, `workspace-provider-${label}-${suffix}`, userId]
      );
      const spaceId = Number(spaceResult.rows[0]?.id || 0);
      spaceIds.push(spaceId);
      await pool.query(
        `INSERT INTO space_memberships (space_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [spaceId, userId]
      );
    }

    const client = new HttpClient();
    await client.request('/api/auth/login', {
      method: 'POST',
      body: { email, password }
    });

    const writeWorkspace = async (spaceId, key) => client.request(`/api/spaces/${spaceId}/integrations`, {
      method: 'PUT',
      withCsrf: true,
      body: {
        visionEnabled: true,
        visionPreset: 'ocrspace',
        visionApiKey: secrets[`vision${key}`],
        priceChartingEnabled: true,
        priceChartingApiKey: secrets[`price${key}`],
        priceChartingRateLimitMs: 1100,
        eBayBrowseEnabled: true,
        eBayBrowseClientId: `client-${key.toLowerCase()}-${suffix}`,
        eBayBrowseClientSecret: secrets[`ebay${key}`],
        eBayBrowseMarketplaceId: 'EBAY_US'
      }
    });

    const writeA = await writeWorkspace(spaceIds[0], 'A');
    await writeWorkspace(spaceIds[1], 'B');
    const readA = await client.request(`/api/spaces/${spaceIds[0]}/integrations`);
    const serializedReadA = JSON.stringify(readA.data);

    for (const rawSecret of Object.values(secrets)) {
      assert(!serializedReadA.includes(rawSecret), 'Workspace integration readback exposed a raw provider secret');
    }
    assert(writeA.data?.valuationProviders?.pricecharting?.credentialSource === 'workspace', 'PriceCharting readback did not identify workspace credential ownership');
    assert(writeA.data?.valuationProviders?.ebayBrowse?.credentialSource === 'workspace', 'eBay readback did not identify workspace credential ownership');
    assert(writeA.data?.visionApiKeySet === true, 'OCR readback did not report its workspace key as configured');
    assert(readA.data?.integrationScope?.sections?.vision?.effective_source === 'workspace', 'OCR source metadata was not workspace-owned');
    assert(readA.data?.integrationScope?.sections?.pricecharting?.effective_source === 'workspace', 'PriceCharting source metadata was not workspace-owned');
    assert(readA.data?.integrationScope?.sections?.ebay?.effective_source === 'workspace', 'eBay source metadata was not workspace-owned');

    const [valuationA, valuationB, ocrA, ocrB] = await Promise.all([
      loadWorkspaceValuationIntegrationConfig(spaceIds[0]),
      loadWorkspaceValuationIntegrationConfig(spaceIds[1]),
      loadWorkspaceOcrIntegrationConfig(spaceIds[0]),
      loadWorkspaceOcrIntegrationConfig(spaceIds[1])
    ]);
    assert(valuationA.priceChartingApiKey === secrets.priceA, 'Workspace A PriceCharting key did not resolve from workspace A');
    assert(valuationA.eBayBrowseClientSecret === secrets.ebayA, 'Workspace A eBay secret did not resolve from workspace A');
    assert(valuationB.priceChartingApiKey === secrets.priceB, 'Workspace B PriceCharting key did not resolve from workspace B');
    assert(valuationB.eBayBrowseClientSecret === secrets.ebayB, 'Workspace B eBay secret did not resolve from workspace B');
    assert(ocrA.visionApiKey === secrets.visionA, 'Workspace A OCR key did not resolve from workspace A');
    assert(ocrB.visionApiKey === secrets.visionB, 'Workspace B OCR key did not resolve from workspace B');
    assert(valuationA.priceChartingApiKey !== valuationB.priceChartingApiKey, 'PriceCharting credentials crossed workspace boundaries');
    assert(ocrA.visionApiKey !== ocrB.visionApiKey, 'OCR credentials crossed workspace boundaries');

    console.log('Workspace integration ownership smoke passed');
  } finally {
    if (spaceIds.length) {
      await pool.query('DELETE FROM app_integrations WHERE space_id = ANY($1::int[])', [spaceIds]).catch(() => {});
      await pool.query('DELETE FROM space_memberships WHERE space_id = ANY($1::int[])', [spaceIds]).catch(() => {});
      await pool.query('DELETE FROM spaces WHERE id = ANY($1::int[])', [spaceIds]).catch(() => {});
    }
    if (userId) await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error('Workspace integration ownership smoke failed:', error?.message || error);
  process.exitCode = 1;
});
