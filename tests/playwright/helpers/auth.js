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
const PLAYWRIGHT_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const PLAYWRIGHT_E2E_BYPASS_TOKEN = String(process.env.PLAYWRIGHT_E2E_BYPASS_TOKEN || '').trim();
const PLAYWRIGHT_E2E_BYPASS_COOKIE = 'playwright_e2e_bypass';
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'session_token';
const PLAYWRIGHT_COMPOSE_ENV_FILE = String(process.env.PLAYWRIGHT_COMPOSE_ENV_FILE || '.env').trim() || '.env';
const PLAYWRIGHT_COMPOSE_PROJECT = String(process.env.PLAYWRIGHT_COMPOSE_PROJECT || '').trim();
const PLAYWRIGHT_DOCKER_COMPOSE_BIN = String(process.env.PLAYWRIGHT_DOCKER_COMPOSE_BIN || 'docker').trim() || 'docker';
const FRESH_CREDENTIALS_CACHE = new Map();

function getPlaywrightBypassHeaders() {
  return PLAYWRIGHT_E2E_BYPASS_TOKEN
    ? { 'x-playwright-e2e-bypass': PLAYWRIGHT_E2E_BYPASS_TOKEN }
    : undefined;
}

function buildComposeCommand(service, commandArgs) {
  const binary = PLAYWRIGHT_DOCKER_COMPOSE_BIN;
  const args = [];
  if (binary === 'docker') {
    args.push('compose');
  }
  if (PLAYWRIGHT_COMPOSE_PROJECT) {
    args.push('-p', PLAYWRIGHT_COMPOSE_PROJECT);
  }
  args.push('--env-file', PLAYWRIGHT_COMPOSE_ENV_FILE, 'exec', '-T', service, ...commandArgs);
  return { binary, args };
}

function getPlaywrightBypassToken() {
  return PLAYWRIGHT_E2E_BYPASS_TOKEN;
}

function buildPlaywrightBypassCookie() {
  if (!PLAYWRIGHT_E2E_BYPASS_TOKEN) return null;
  return {
    name: PLAYWRIGHT_E2E_BYPASS_COOKIE,
    value: PLAYWRIGHT_E2E_BYPASS_TOKEN,
    url: PLAYWRIGHT_BASE_URL,
    sameSite: 'Lax'
  };
}

function buildPlaywrightBypassStorageCookie() {
  if (!PLAYWRIGHT_E2E_BYPASS_TOKEN) return null;
  const parsed = new URL(PLAYWRIGHT_BASE_URL);
  return {
    name: PLAYWRIGHT_E2E_BYPASS_COOKIE,
    value: PLAYWRIGHT_E2E_BYPASS_TOKEN,
    domain: parsed.hostname,
    path: parsed.pathname || '/',
    expires: -1,
    httpOnly: false,
    secure: parsed.protocol === 'https:',
    sameSite: 'Lax'
  };
}

async function addPlaywrightBypassCookie(target) {
  const cookie = buildPlaywrightBypassCookie();
  if (!cookie || typeof target?.addCookies !== 'function') return;
  await target.addCookies([cookie]);
}

async function addSessionCookie(target, value) {
  if (!value || typeof target?.addCookies !== 'function') return;
  const parsed = new URL(PLAYWRIGHT_BASE_URL);
  await target.addCookies([{
    name: SESSION_COOKIE_NAME,
    value,
    url: PLAYWRIGHT_BASE_URL,
    sameSite: 'Lax',
    secure: parsed.protocol === 'https:'
  }]);
}

async function ensurePlaywrightBypassStorageState(storageStatePath) {
  const cookie = buildPlaywrightBypassStorageCookie();
  if (!cookie) return;

  let parsed;
  try {
    parsed = JSON.parse(await fs.promises.readFile(storageStatePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  const cookies = Array.isArray(parsed.cookies) ? parsed.cookies : [];
  const filtered = cookies.filter((entry) => entry?.name !== PLAYWRIGHT_E2E_BYPASS_COOKIE);
  filtered.push(cookie);
  parsed.cookies = filtered;
  await fs.promises.writeFile(storageStatePath, JSON.stringify(parsed, null, 2));
}

async function ensureDirectory(filePath) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
}

function parseSetCookieHeader(headerValue) {
  const firstSegment = String(headerValue || '').split(';')[0] || '';
  const equalsIndex = firstSegment.indexOf('=');
  if (equalsIndex <= 0) return null;
  const name = firstSegment.slice(0, equalsIndex).trim();
  const value = firstSegment.slice(equalsIndex + 1).trim();
  if (!name) return null;
  return { name, value };
}

function buildCookieHeader(cookieJar) {
  if (!(cookieJar instanceof Map) || cookieJar.size === 0) return '';
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function updateCookieJarFromResponse(cookieJar, response) {
  if (!(cookieJar instanceof Map) || !response || typeof response.headersArray !== 'function') return;
  for (const header of response.headersArray()) {
    if (String(header?.name || '').toLowerCase() !== 'set-cookie') continue;
    const parsed = parseSetCookieHeader(header?.value || '');
    if (!parsed) continue;
    if (!parsed.value || parsed.value.toLowerCase() === 'deleted') {
      cookieJar.delete(parsed.name);
      continue;
    }
    cookieJar.set(parsed.name, parsed.value);
  }
}

function seedCookieJar(cookieJar, cookies) {
  if (!(cookieJar instanceof Map) || !Array.isArray(cookies)) return;
  for (const cookie of cookies) {
    const name = String(cookie?.name || '').trim();
    const value = String(cookie?.value || '').trim();
    if (!name || !value) continue;
    cookieJar.set(name, value);
  }
}

function patchRequestContextCookieJar(requestContext) {
  if (!requestContext || requestContext.__collectzCookieJarPatched) return requestContext;
  const cookieJar = new Map();
  const methods = ['get', 'post', 'patch', 'put', 'delete', 'head', 'fetch'];
  for (const methodName of methods) {
    if (typeof requestContext[methodName] !== 'function') continue;
    const original = requestContext[methodName].bind(requestContext);
    requestContext[methodName] = async (url, options = {}) => {
      const nextOptions = { ...options };
      const existingHeaders = { ...(options?.headers || {}) };
      const hasCookieHeader = Object.keys(existingHeaders).some((key) => key.toLowerCase() === 'cookie');
      const cookieHeader = buildCookieHeader(cookieJar);
      if (!hasCookieHeader && cookieHeader) {
        existingHeaders.Cookie = cookieHeader;
      }
      nextOptions.headers = existingHeaders;
      const response = await original(url, nextOptions);
      updateCookieJarFromResponse(cookieJar, response);
      return response;
    };
  }
  requestContext.__collectzCookieJarPatched = true;
  requestContext.__collectzCookieJar = cookieJar;
  return requestContext;
}

async function fetchCsrfToken(requestContext) {
  const response = await requestContext.get('/api/auth/csrf-token', {
    headers: getPlaywrightBypassHeaders()
  });
  if (!response.ok()) {
    throw new Error(`Failed to fetch CSRF token (${response.status()})`);
  }
  const payload = await response.json();
  const token = payload?.csrfToken;
  if (!token) throw new Error('Missing CSRF token from /api/auth/csrf-token');
  return token;
}

async function requestWithCsrf(requestContext, method, pathName, body, expectedStatus = 200) {
  const csrfToken = await fetchCsrfToken(requestContext);
  const response = await requestContext.fetch(pathName, {
    method,
    ...(body !== undefined ? { data: body } : {}),
    headers: {
      ...(getPlaywrightBypassHeaders() || {}),
      'x-csrf-token': csrfToken
    }
  });
  const allowedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  if (!allowedStatuses.includes(response.status())) {
    const text = await response.text();
    throw new Error(`Expected ${allowedStatuses.join(' or ')} from ${pathName}, got ${response.status()}: ${text}`);
  }
  return response;
}

async function postWithCsrf(requestContext, pathName, body, expectedStatus = 200) {
  return requestWithCsrf(requestContext, 'POST', pathName, body, expectedStatus);
}

async function patchWithCsrf(requestContext, pathName, body, expectedStatus = 200) {
  return requestWithCsrf(requestContext, 'PATCH', pathName, body, expectedStatus);
}

async function createDirectUser({ email, password, name, role = 'admin' }) {
  const script = [
    "const bcrypt=require('bcrypt');",
    "const pool=require('./db/pool');",
    "const { ensureUserDefaultScope } = require('./services/libraries');",
    "(async()=>{",
    "const email=process.argv[1];",
    "const password=process.argv[2];",
    "const name=process.argv[3] || 'Playwright Admin';",
    "const role=process.argv[4] || 'admin';",
    "const hash=await bcrypt.hash(password,12);",
    "const result=await pool.query(`INSERT INTO users (email, password, name, role, email_verified, email_verified_at) VALUES ($1, $2, $3, $4, true, NOW()) RETURNING id, email, name, role`, [email, hash, name, role]);",
    "await ensureUserDefaultScope(result.rows[0].id);",
    "console.log(JSON.stringify(result.rows[0]));",
    "await pool.end();",
    "})().catch((error)=>{console.error(error.stack||error.message||error);process.exit(1);});"
  ].join('');
  const composeCommand = buildComposeCommand('backend', ['node', '-e', script, email, password, name, role]);
  const output = execFileSync(
    composeCommand.binary,
    composeCommand.args,
    {
      cwd: REPO_ROOT,
      env: process.env,
      encoding: 'utf8'
    }
  );
  return JSON.parse(String(output || '{}').trim() || '{}');
}

async function createDirectSpace({ name, slug, description = '', ownerUserId, createdBy = null }) {
  const script = [
    "const pool=require('./db/pool');",
    "const { ensureUserDefaultScope } = require('./services/libraries');",
    "(async()=>{",
    "const name=process.argv[1];",
    "const slug=process.argv[2];",
    "const description=process.argv[3] || null;",
    "const ownerUserId=Number(process.argv[4] || 0) || null;",
    "const createdBy=Number(process.argv[5] || 0) || ownerUserId;",
    "const result=await pool.query(`INSERT INTO spaces (name, slug, description, created_by, is_personal) VALUES ($1, $2, $3, $4, false) RETURNING id, name, slug`, [name, slug, description, createdBy]);",
    "const space=result.rows[0];",
    "if(ownerUserId){await pool.query(`INSERT INTO space_memberships (space_id, user_id, role, created_by) VALUES ($1, $2, 'owner', $3) ON CONFLICT (space_id, user_id) DO UPDATE SET role='owner', suspended_at=NULL, updated_at=NOW()`, [space.id, ownerUserId, createdBy]);await ensureUserDefaultScope(ownerUserId,{preferredSpaceId:space.id});}",
    "console.log(JSON.stringify(space));",
    "await pool.end();",
    "})().catch((error)=>{console.error(error.stack||error.message||error);process.exit(1);});"
  ].join('');
  const composeCommand = buildComposeCommand('backend', ['node', '-e', script, name, slug, description || '', String(ownerUserId || ''), String(createdBy || '')]);
  const output = execFileSync(
    composeCommand.binary,
    composeCommand.args,
    {
      cwd: REPO_ROOT,
      env: process.env,
      encoding: 'utf8'
    }
  );
  return JSON.parse(String(output || '{}').trim() || '{}');
}

async function addDirectSpaceMembership({ spaceId, userId, role = 'member', createdBy = null, makeActive = true }) {
  const script = [
    "const pool=require('./db/pool');",
    "const { ensureUserDefaultScope } = require('./services/libraries');",
    "(async()=>{",
    "const spaceId=Number(process.argv[1] || 0);",
    "const userId=Number(process.argv[2] || 0);",
    "const role=process.argv[3] || 'member';",
    "const createdBy=Number(process.argv[4] || 0) || userId;",
    "const makeActive=process.argv[5] === 'true';",
    "if(!spaceId||!userId) throw new Error('spaceId and userId are required');",
    "await pool.query(`INSERT INTO space_memberships (space_id, user_id, role, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT (space_id, user_id) DO UPDATE SET role=EXCLUDED.role, suspended_at=NULL, updated_at=NOW()`, [spaceId, userId, role, createdBy]);",
    "if(makeActive){await ensureUserDefaultScope(userId,{preferredSpaceId:spaceId});}",
    "console.log(JSON.stringify({space_id:spaceId,user_id:userId,role}));",
    "await pool.end();",
    "})().catch((error)=>{console.error(error.stack||error.message||error);process.exit(1);});"
  ].join('');
  const composeCommand = buildComposeCommand('backend', ['node', '-e', script, String(spaceId || ''), String(userId || ''), role, String(createdBy || ''), makeActive ? 'true' : 'false']);
  const output = execFileSync(
    composeCommand.binary,
    composeCommand.args,
    {
      cwd: REPO_ROOT,
      env: process.env,
      encoding: 'utf8'
    }
  );
  return JSON.parse(String(output || '{}').trim() || '{}');
}

async function createRequestContextFromStorageState(storageStatePath) {
  const requestContext = patchRequestContextCookieJar(await playwrightRequest.newContext({
    baseURL: PLAYWRIGHT_BASE_URL,
    storageState: storageStatePath,
    extraHTTPHeaders: getPlaywrightBypassHeaders()
  }));
  if (fs.existsSync(storageStatePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
      seedCookieJar(requestContext.__collectzCookieJar, parsed.cookies);
    } catch (error) {
      // Ignore unreadable storage state here; downstream requests will fail normally.
    }
  }
  return requestContext;
}

async function bootstrapAdminCredentials(requestContext) {
  const configuredEmail = String(process.env.PLAYWRIGHT_ADMIN_EMAIL || process.env.RBAC_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '').trim();
  const configuredPassword = String(process.env.PLAYWRIGHT_ADMIN_PASSWORD || process.env.RBAC_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '').trim();
  const adminName = process.env.PLAYWRIGHT_ADMIN_NAME || 'Playwright Admin';
  const defaultCredentials = {
    email: configuredEmail || 'ci-playwright-admin@example.com',
    password: configuredPassword || 'Passw0rd!123'
  };
  const candidateCredentials = [];
  const seenCandidates = new Set();

  const pushCandidateCredentials = (credentials) => {
    const email = String(credentials?.email || '').trim();
    const password = String(credentials?.password || '').trim();
    if (!email || !password) return;
    const key = `${email.toLowerCase()}::${password}`;
    if (seenCandidates.has(key)) return;
    seenCandidates.add(key);
    candidateCredentials.push({ email, password });
  };

  pushCandidateCredentials({
    email: configuredEmail,
    password: configuredPassword
  });

  if (fs.existsSync(AUTH_CREDENTIALS_PATH)) {
    try {
      pushCandidateCredentials(JSON.parse(fs.readFileSync(AUTH_CREDENTIALS_PATH, 'utf8')));
    } catch (error) {
      // Ignore unreadable local auth state and continue with the normal bootstrap ladder.
    }
  }

  const tryAdminLogin = async (credentials) => {
    const loginAttempt = await postWithCsrf(requestContext, '/api/auth/login', {
      email: credentials.email,
      password: credentials.password
    }, 200).catch(async () => null);
    return loginAttempt ? credentials : null;
  };

  for (const credentials of candidateCredentials) {
    const authenticatedCredentials = await tryAdminLogin(credentials);
    if (authenticatedCredentials) {
      return authenticatedCredentials;
    }
  }

  const registerResponse = await postWithCsrf(requestContext, '/api/auth/register', {
    email: defaultCredentials.email,
    password: defaultCredentials.password,
    name: adminName
  }, [200, 201, 202]).catch(async (error) => {
    if (!String(error.message).includes('Expected 200 or 201 or 202')) throw error;
    return null;
  });

  if (registerResponse?.status() === 200) {
    return defaultCredentials;
  }
  if (!registerResponse) {
    const defaultLoginAttempt = await tryAdminLogin(defaultCredentials);
    if (defaultLoginAttempt) {
      return defaultLoginAttempt;
    }
  }

  const fallbackEmail = `playwright-admin-${Date.now()}@example.com`;
  const fallbackPassword = 'Passw0rd!123';
  await createDirectUser({
    email: fallbackEmail,
    password: fallbackPassword,
    name: adminName,
    role: 'admin'
  });
  await postWithCsrf(requestContext, '/api/auth/login', {
    email: fallbackEmail,
    password: fallbackPassword
  }, 200);
  return { email: fallbackEmail, password: fallbackPassword };
}

async function ensureSavedAdminCredentials() {
  const configuredEmail = String(process.env.PLAYWRIGHT_ADMIN_EMAIL || process.env.RBAC_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '').trim();
  const configuredPassword = String(process.env.PLAYWRIGHT_ADMIN_PASSWORD || process.env.RBAC_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '').trim();
  if (configuredEmail && configuredPassword) {
    const configuredCredentials = {
      email: configuredEmail,
      password: configuredPassword
    };
    await ensureDirectory(AUTH_CREDENTIALS_PATH);
    await fs.promises.writeFile(AUTH_CREDENTIALS_PATH, JSON.stringify(configuredCredentials, null, 2));
    return configuredCredentials;
  }
  if (fs.existsSync(AUTH_CREDENTIALS_PATH)) {
    return JSON.parse(fs.readFileSync(AUTH_CREDENTIALS_PATH, 'utf8'));
  }
  return createFreshAdminCredentials();
}

async function createFreshAdminCredentials() {
  const fallbackEmail = `playwright-admin-${Date.now()}@example.com`;
  const fallbackPassword = 'Passw0rd!123';
  const fallbackName = process.env.PLAYWRIGHT_ADMIN_NAME || 'Playwright Admin';
  await createDirectUser({
    email: fallbackEmail,
    password: fallbackPassword,
    name: fallbackName,
    role: 'admin'
  });
  const credentials = { email: fallbackEmail, password: fallbackPassword };
  await fs.promises.writeFile(AUTH_CREDENTIALS_PATH, JSON.stringify(credentials, null, 2));
  return credentials;
}

async function createFreshUserCredentials() {
  let role = 'user';
  let fallbackName = 'Playwright User';
  let noCache = false;
  if (arguments[0] && typeof arguments[0] === 'object') {
    role = String(arguments[0].role || 'user');
    fallbackName = String(arguments[0].name || (role === 'support_admin' ? 'Playwright Support Admin' : 'Playwright User'));
    noCache = Boolean(arguments[0].noCache);
  } else if (typeof arguments[0] === 'string' && arguments[0]) {
    role = String(arguments[0]);
    fallbackName = role === 'support_admin' ? 'Playwright Support Admin' : 'Playwright User';
  }
  const cachedCredentials = noCache ? null : FRESH_CREDENTIALS_CACHE.get(role);
  if (cachedCredentials) {
    return { ...cachedCredentials };
  }
  const roleSlug = role.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const fallbackEmail = `playwright-${roleSlug}-${Date.now()}@example.com`;
  const fallbackPassword = 'Passw0rd!123';
  await createDirectUser({
    email: fallbackEmail,
    password: fallbackPassword,
    name: fallbackName,
    role
  });
  const createdCredentials = { email: fallbackEmail, password: fallbackPassword, name: fallbackName, role };
  if (!noCache) FRESH_CREDENTIALS_CACHE.set(role, createdCredentials);
  return { ...createdCredentials };
}

async function createAuthenticatedRequestContext(credentials) {
  const requestContext = patchRequestContextCookieJar(await playwrightRequest.newContext({
    baseURL: PLAYWRIGHT_BASE_URL,
    extraHTTPHeaders: getPlaywrightBypassHeaders()
  }));
  await postWithCsrf(requestContext, '/api/auth/login', {
    email: credentials.email,
    password: credentials.password
  }, 200);
  return requestContext;
}

async function ensureAuthenticatedAdminStorageState(requestContext) {
  patchRequestContextCookieJar(requestContext);
  await ensureDirectory(AUTH_STATE_PATH);
  if (fs.existsSync(AUTH_STATE_PATH)) {
    await ensurePlaywrightBypassStorageState(AUTH_STATE_PATH);
    const verifyContext = await playwrightRequest.newContext({
      baseURL: PLAYWRIGHT_BASE_URL,
      storageState: AUTH_STATE_PATH,
      extraHTTPHeaders: getPlaywrightBypassHeaders()
    }).then(patchRequestContextCookieJar).catch(() => null);
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
      } catch (error) {
        // Local Playwright request contexts can intermittently fail loopback
        // verification in this desktop environment after container restarts.
        // When that happens but we still have saved storage state and
        // credentials, trust the existing authenticated state instead of
        // re-bootstrapping through another flaky loopback request context.
        const credentials = await ensureSavedAdminCredentials();
        return {
          credentials,
          storageStatePath: AUTH_STATE_PATH,
          credentialsPath: AUTH_CREDENTIALS_PATH
        };
      } finally {
        await verifyContext.dispose();
      }
    }
  }
  const credentials = await bootstrapAdminCredentials(requestContext);
  await requestContext.storageState({ path: AUTH_STATE_PATH });
  await ensurePlaywrightBypassStorageState(AUTH_STATE_PATH);
  await fs.promises.writeFile(AUTH_CREDENTIALS_PATH, JSON.stringify(credentials, null, 2));
  return {
    credentials,
    storageStatePath: AUTH_STATE_PATH,
    credentialsPath: AUTH_CREDENTIALS_PATH
  };
}

async function getCurrentUser(requestContext) {
  const response = await requestContext.get('/api/auth/me', {
    headers: getPlaywrightBypassHeaders()
  });
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
  PLAYWRIGHT_BASE_URL,
  PLAYWRIGHT_E2E_BYPASS_TOKEN,
  PLAYWRIGHT_E2E_BYPASS_COOKIE,
  SESSION_COOKIE_NAME,
  getPlaywrightBypassToken,
  getPlaywrightBypassHeaders,
  addPlaywrightBypassCookie,
  addSessionCookie,
  fetchCsrfToken,
  requestWithCsrf,
  postWithCsrf,
  patchWithCsrf,
  ensureAuthenticatedAdminStorageState,
  ensureSavedAdminCredentials,
  createFreshAdminCredentials,
  createFreshUserCredentials,
  createDirectUser,
  createDirectSpace,
  addDirectSpaceMembership,
  createAuthenticatedRequestContext,
  createRequestContextFromStorageState,
  bootstrapAdminCredentials,
  getCurrentUser
};
