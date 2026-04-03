'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { request: playwrightRequest } = require('@playwright/test');
const { primeEnvFromRootFile } = require('./env');

primeEnvFromRootFile('.env');

const ARTIFACTS_DIR = path.resolve(__dirname, '..', '..', '..', 'artifacts', 'playwright');
const PLAYWRIGHT_STATE_DIR = path.resolve(__dirname, '..', '..', '..', 'tmp', 'playwright-auth');
const AUTH_STATE_PATH = path.join(PLAYWRIGHT_STATE_DIR, 'admin.json');
const AUTH_CREDENTIALS_PATH = path.join(PLAYWRIGHT_STATE_DIR, 'admin-credentials.json');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const PLAYWRIGHT_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';
const PLAYWRIGHT_E2E_BYPASS_TOKEN = String(process.env.PLAYWRIGHT_E2E_BYPASS_TOKEN || '').trim();

function getPlaywrightBypassHeaders() {
  return PLAYWRIGHT_E2E_BYPASS_TOKEN
    ? { 'x-playwright-e2e-bypass': PLAYWRIGHT_E2E_BYPASS_TOKEN }
    : undefined;
}

async function ensureDirectory(filePath) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
}

async function fetchCsrfToken(requestContext) {
  const response = await requestContext.get('/api/auth/csrf-token');
  if (!response.ok()) {
    throw new Error(`Failed to fetch CSRF token (${response.status()})`);
  }
  const payload = await response.json();
  const token = payload?.csrfToken;
  if (!token) throw new Error('Missing CSRF token from /api/auth/csrf-token');
  return token;
}

async function postWithCsrf(requestContext, pathName, body, expectedStatus = 200) {
  const csrfToken = await fetchCsrfToken(requestContext);
  const response = await requestContext.post(pathName, {
    data: body,
    headers: {
      'x-csrf-token': csrfToken
    }
  });
  if (response.status() !== expectedStatus) {
    const text = await response.text();
    throw new Error(`Expected ${expectedStatus} from ${pathName}, got ${response.status()}: ${text}`);
  }
  return response;
}

async function createDirectAdminUser({ email, password, name }) {
  const script = [
    "const bcrypt=require('bcrypt');",
    "const pool=require('./db/pool');",
    "(async()=>{",
    "const email=process.argv[1];",
    "const password=process.argv[2];",
    "const name=process.argv[3] || 'Playwright Admin';",
    "const hash=await bcrypt.hash(password,12);",
    "const result=await pool.query(`INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, 'admin') RETURNING id, email, name`, [email, hash, name]);",
    "console.log(JSON.stringify(result.rows[0]));",
    "await pool.end();",
    "})().catch((error)=>{console.error(error.stack||error.message||error);process.exit(1);});"
  ].join('');
  const output = execFileSync(
    'docker',
    ['compose', '--env-file', '.env', 'exec', '-T', 'backend', 'node', '-e', script, email, password, name],
    {
      cwd: REPO_ROOT,
      env: process.env,
      encoding: 'utf8'
    }
  );
  return JSON.parse(String(output || '{}').trim() || '{}');
}

async function bootstrapAdminCredentials(requestContext) {
  const adminEmail = process.env.PLAYWRIGHT_ADMIN_EMAIL || process.env.RBAC_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'ci-playwright-admin@example.com';
  const adminPassword = process.env.PLAYWRIGHT_ADMIN_PASSWORD || process.env.RBAC_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'Passw0rd!123';
  const adminName = process.env.PLAYWRIGHT_ADMIN_NAME || 'Playwright Admin';

  const registerResponse = await postWithCsrf(requestContext, '/api/auth/register', {
    email: adminEmail,
    password: adminPassword,
    name: adminName
  }, 200).catch(async (error) => {
    if (!String(error.message).includes('Expected 200')) throw error;
    return null;
  });

  if (registerResponse) {
    return { email: adminEmail, password: adminPassword };
  }

  const loginAttempt = await postWithCsrf(requestContext, '/api/auth/login', {
    email: adminEmail,
    password: adminPassword
  }, 200).catch(async () => null);

  if (loginAttempt) {
    return { email: adminEmail, password: adminPassword };
  }

  const fallbackEmail = `playwright-admin-${Date.now()}@example.com`;
  const fallbackPassword = 'Passw0rd!123';
  await createDirectAdminUser({
    email: fallbackEmail,
    password: fallbackPassword,
    name: adminName
  });
  await postWithCsrf(requestContext, '/api/auth/login', {
    email: fallbackEmail,
    password: fallbackPassword
  }, 200);
  return { email: fallbackEmail, password: fallbackPassword };
}

async function ensureSavedAdminCredentials() {
  if (fs.existsSync(AUTH_CREDENTIALS_PATH)) {
    return JSON.parse(fs.readFileSync(AUTH_CREDENTIALS_PATH, 'utf8'));
  }
  return createFreshAdminCredentials();
}

async function createFreshAdminCredentials() {
  const fallbackEmail = `playwright-admin-${Date.now()}@example.com`;
  const fallbackPassword = 'Passw0rd!123';
  const fallbackName = process.env.PLAYWRIGHT_ADMIN_NAME || 'Playwright Admin';
  await createDirectAdminUser({
    email: fallbackEmail,
    password: fallbackPassword,
    name: fallbackName
  });
  const credentials = { email: fallbackEmail, password: fallbackPassword };
  await fs.promises.writeFile(AUTH_CREDENTIALS_PATH, JSON.stringify(credentials, null, 2));
  return credentials;
}

async function ensureAuthenticatedAdminStorageState(requestContext) {
  await ensureDirectory(AUTH_STATE_PATH);
  if (fs.existsSync(AUTH_STATE_PATH)) {
    const verifyContext = await playwrightRequest.newContext({
      baseURL: PLAYWRIGHT_BASE_URL,
      storageState: AUTH_STATE_PATH,
      extraHTTPHeaders: getPlaywrightBypassHeaders()
    }).catch(() => null);
    if (verifyContext) {
      try {
        const meResponse = await verifyContext.get('/api/auth/me');
        if (meResponse.ok()) {
          const credentials = await ensureSavedAdminCredentials();
          return {
            credentials,
            storageStatePath: AUTH_STATE_PATH,
            credentialsPath: AUTH_CREDENTIALS_PATH
          };
        }
      } finally {
        await verifyContext.dispose();
      }
    }
  }
  const credentials = await bootstrapAdminCredentials(requestContext);
  await requestContext.storageState({ path: AUTH_STATE_PATH });
  await fs.promises.writeFile(AUTH_CREDENTIALS_PATH, JSON.stringify(credentials, null, 2));
  return {
    credentials,
    storageStatePath: AUTH_STATE_PATH,
    credentialsPath: AUTH_CREDENTIALS_PATH
  };
}

async function getCurrentUser(requestContext) {
  const response = await requestContext.get('/api/auth/me');
  if (!response.ok()) {
    throw new Error(`Failed to load authenticated user (${response.status()})`);
  }
  return response.json();
}

module.exports = {
  ARTIFACTS_DIR,
  PLAYWRIGHT_STATE_DIR,
  AUTH_STATE_PATH,
  AUTH_CREDENTIALS_PATH,
  PLAYWRIGHT_E2E_BYPASS_TOKEN,
  getPlaywrightBypassHeaders,
  fetchCsrfToken,
  postWithCsrf,
  ensureAuthenticatedAdminStorageState,
  ensureSavedAdminCredentials,
  createFreshAdminCredentials,
  bootstrapAdminCredentials,
  getCurrentUser
};
