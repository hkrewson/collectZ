'use strict';

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { postWithCsrf, patchWithCsrf, getCurrentUser } = require('./auth');

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'session_token';
const PLAYWRIGHT_COMPOSE_ENV_FILE = String(process.env.PLAYWRIGHT_COMPOSE_ENV_FILE || '.env').trim() || '.env';
const PLAYWRIGHT_COMPOSE_PROJECT = String(process.env.PLAYWRIGHT_COMPOSE_PROJECT || '').trim();
const PLAYWRIGHT_DOCKER_COMPOSE_BIN = String(process.env.PLAYWRIGHT_DOCKER_COMPOSE_BIN || 'docker').trim() || 'docker';

async function createSupportRequest(requestContext, { subject, message }) {
  const response = await postWithCsrf(requestContext, '/api/support/requests', { subject, message }, 201);
  return response.json();
}

async function sendSupportReply(requestContext, requestId, body) {
  const response = await postWithCsrf(requestContext, `/api/support/requests/${requestId}/messages`, { body }, 201);
  return response.json();
}

async function saveSupportTriage(requestContext, requestId, payload) {
  const response = await patchWithCsrf(requestContext, `/api/support/requests/${requestId}/triage`, payload, 200);
  return response.json();
}

async function createSupportCaptureFixture(requestContext, suffix) {
  const subject = `Capture flow ${suffix}`;
  const created = await createSupportRequest(requestContext, {
    subject,
    message: 'Need help capturing a stable support workspace screenshot.'
  });
  const requestId = Number(created?.request?.id || 0);
  if (!requestId) {
    throw new Error('Support capture fixture did not return a request id');
  }

  await sendSupportReply(
    requestContext,
    requestId,
    'Added one more reply so the support conversation screenshot has realistic thread content.'
  );

  await saveSupportTriage(requestContext, requestId, {
    classification: 'bug',
    tracking_status: 'investigating',
    repo_issue_number: 123,
    repo_issue_url: '',
    resolved_in_version: '',
    internal_notes: 'Capture fixture: seeded for Playwright docs screenshots.'
  });

  return {
    requestId,
    requestKey: created?.request?.request_key || `SUP-${String(requestId).padStart(6, '0')}`,
    subject
  };
}

async function updateSupportAccess(requestContext, requestId, nextStatus) {
  const response = await patchWithCsrf(requestContext, `/api/support/requests/${requestId}/access`, {
    support_access_status: nextStatus
  }, 200);
  return response.json();
}

async function createLibraryInActiveScope(requestContext, name) {
  const response = await postWithCsrf(requestContext, '/api/libraries', { name }, 201);
  return response.json();
}

async function createApprovedSupportRequestFixture(requestContext, suffix) {
  const created = await createSupportRequest(requestContext, {
    subject: `Approved support flow ${suffix}`,
    message: 'Need an approved support request so browser coverage can exercise Help Admin session controls.'
  });
  const requestId = Number(created?.request?.id || 0);
  if (!requestId) {
    throw new Error('Approved support fixture did not return a request id');
  }
  const approved = await updateSupportAccess(requestContext, requestId, 'approved');
  return {
    requestId,
    request: approved?.request || created?.request || null
  };
}

function getSessionTokenForRequestContext(requestContext) {
  const cookieJar = requestContext?.__collectzCookieJar;
  if (!(cookieJar instanceof Map)) {
    throw new Error('Authenticated request context is missing the patched cookie jar');
  }
  return String(cookieJar.get(SESSION_COOKIE_NAME) || '').trim() || null;
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
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

function runBackendNodeScript(script, args = []) {
  const composeCommand = buildComposeCommand('backend', ['node', '-e', script, ...args]);
  return execFileSync(composeCommand.binary, composeCommand.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

async function updateSupportSessionStateForRequestContext(requestContext, updates = {}) {
  const sessionToken = getSessionTokenForRequestContext(requestContext);
  if (!sessionToken) {
    throw new Error('Authenticated request context does not have a support-session token to mutate');
  }
  const keys = Object.keys(updates);
  if (keys.length === 0) return;
  const tokenHash = hashSessionToken(sessionToken);
  const script = [
    "const pool=require('./db/pool');",
    "(async()=>{",
    'const tokenHash=process.argv[1];',
    'const updates=JSON.parse(process.argv[2]);',
    'const keys=Object.keys(updates);',
    "if(keys.length===0){await pool.end();return;}",
    'const assignments=[];',
    'const values=[];',
    'for(const key of keys){assignments.push(`${key} = $${values.length + 1}`);values.push(updates[key]);}',
    'values.push(tokenHash);',
    "await pool.query(`UPDATE user_sessions SET ${assignments.join(', ')} WHERE token_hash = $${values.length}`, values);",
    'await pool.end();',
    "})().catch((error)=>{console.error(error.stack||error.message||error);process.exit(1);});"
  ].join('');
  runBackendNodeScript(script, [tokenHash, JSON.stringify(updates)]);
}

async function createDetachedLibraryForCurrentUser(requestContext, suffix) {
  const user = await getCurrentUser(requestContext);
  const userId = Number(user?.id || 0) || null;
  if (!userId) {
    throw new Error('Detached support-library fixture could not resolve the current user');
  }
  const script = [
    "const pool=require('./db/pool');",
    "(async()=>{",
    'const suffix=process.argv[1];',
    'const userId=Number(process.argv[2]);',
    "const detachedSpace=await pool.query(`INSERT INTO spaces (name, slug, created_by, is_personal) VALUES ($1, $2, $3, false) RETURNING id, name, slug`, [`Playwright Detached Support Space ${suffix}`, `playwright-detached-support-space-${suffix}`, userId]);",
    'const detachedSpaceId=Number(detachedSpace.rows[0]?.id||0)||null;',
    "const detachedLibrary=await pool.query(`INSERT INTO libraries (name, created_by, space_id) VALUES ($1, $2, $3) RETURNING id, name, space_id`, [`Detached Support Library ${suffix}`, userId, detachedSpaceId]);",
    'console.log(JSON.stringify(detachedLibrary.rows[0]||null));',
    'await pool.end();',
    "})().catch((error)=>{console.error(error.stack||error.message||error);process.exit(1);});"
  ].join('');
  const output = runBackendNodeScript(script, [String(suffix), String(userId)]);
  return output ? JSON.parse(output) : null;
}

module.exports = {
  createSupportCaptureFixture,
  createApprovedSupportRequestFixture,
  createLibraryInActiveScope,
  createDetachedLibraryForCurrentUser,
  updateSupportSessionStateForRequestContext
};
