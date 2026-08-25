#!/usr/bin/env node

'use strict';

const assert = require('assert');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');
const { runMigrationsForClient, MIGRATIONS } = require('../db/migrations');
const identityPolicies = require('../config/identity-upgrade-policies.json');

const useDatabaseSSL = ['1', 'true'].includes(String(process.env.DATABASE_SSL || '').toLowerCase());
const identityMigrationPattern = /(users?|invites?|user_sessions?|password_reset|email_verification|personal_access|service_account|space_memberships?|library_memberships?|roles?|ownership|owner_user|audit|activity_log|encrypt(?:ion|ed)?|recovery|mfa)/i;
const minimumIdentityFixtureVersion = 118;
const allowedPolicyValues = {
  existingSessions: new Set(['survive', 'revoke']),
  activeScope: new Set(['preserve', 'clear']),
  apiCredentials: new Set(['remainValid', 'revoke'])
};

function resolveIdentityPolicy(migrationVersions) {
  const policy = { ...identityPolicies.defaultPolicy };
  for (const version of migrationVersions) {
    Object.assign(policy, identityPolicies.migrationOverrides?.[String(version)] || {});
  }
  for (const [key, allowed] of Object.entries(allowedPolicyValues)) {
    if (!allowed.has(policy[key])) {
      throw new Error(`Invalid identity upgrade policy ${key}=${policy[key]}`);
    }
  }
  return policy;
}

function baseConnectionString() {
  if (process.env.IDENTITY_CERTIFICATION_ADMIN_URL) return process.env.IDENTITY_CERTIFICATION_ADMIN_URL;
  if (process.env.MIGRATION_REHEARSAL_ADMIN_URL) return process.env.MIGRATION_REHEARSAL_ADMIN_URL;
  if (process.env.DATABASE_URL) {
    const parsed = new URL(process.env.DATABASE_URL);
    parsed.pathname = '/postgres';
    return parsed.toString();
  }
  throw new Error('Identity certification requires IDENTITY_CERTIFICATION_ADMIN_URL, MIGRATION_REHEARSAL_ADMIN_URL, or DATABASE_URL');
}

function withDb(connectionString, databaseName) {
  const parsed = new URL(connectionString);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function connect(connectionString) {
  const client = new Client({
    connectionString,
    ssl: useDatabaseSSL ? { rejectUnauthorized: false } : false
  });
  await client.connect();
  return client;
}

async function terminateAndDropDatabase(admin, databaseName) {
  await admin.query(
    `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
      WHERE datname = $1
        AND pid <> pg_backend_pid()`,
    [databaseName]
  );
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(databaseName)}`);
}

async function createDatabase(admin, databaseName, template = null) {
  const templateClause = template ? ` TEMPLATE ${quoteIdent(template)}` : '';
  await admin.query(`CREATE DATABASE ${quoteIdent(databaseName)}${templateClause}`);
}

function randomCredential(prefix = '') {
  return `${prefix}${crypto.randomBytes(32).toString('hex')}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function buildFixtureSecrets() {
  const suffix = crypto.randomBytes(8).toString('hex');
  return {
    primaryEmail: `identity-${suffix}@example.invalid`,
    peerEmail: `identity-peer-${suffix}@example.invalid`,
    inviteEmail: `identity-invite-${suffix}@example.invalid`,
    password: randomCredential('Identity-Cert-'),
    sessionTokens: [randomCredential(), randomCredential()],
    inviteToken: randomCredential(),
    resetToken: randomCredential(),
    verificationToken: randomCredential(),
    personalAccessToken: randomCredential('cz_pat_'),
    serviceAccountKey: randomCredential('cz_sak_'),
    sessionSecret: randomCredential(),
    integrationEncryptionKey: randomCredential()
  };
}

async function seedIdentityFixture(client, secrets) {
  const passwordHash = await bcrypt.hash(secrets.password, 12);
  const primary = await client.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, 'Identity Certification User', 'user', true, NOW())
     RETURNING id`,
    [secrets.primaryEmail, passwordHash]
  );
  const peer = await client.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, 'Identity Certification Peer', 'viewer', true, NOW())
     RETURNING id`,
    [secrets.peerEmail, passwordHash]
  );
  const primaryUserId = primary.rows[0].id;
  const peerUserId = peer.rows[0].id;

  const ownerSpace = await client.query(
    `INSERT INTO spaces (name, slug, description, created_by, is_personal)
     VALUES ('Identity Owner Space', $1, 'Upgrade certification fixture', $2, false)
     RETURNING id`,
    [`identity-owner-${primaryUserId}`, primaryUserId]
  );
  const viewerSpace = await client.query(
    `INSERT INTO spaces (name, slug, description, created_by, is_personal)
     VALUES ('Identity Viewer Space', $1, 'Upgrade certification fixture', $2, false)
     RETURNING id`,
    [`identity-viewer-${primaryUserId}`, peerUserId]
  );
  const ownerSpaceId = ownerSpace.rows[0].id;
  const viewerSpaceId = viewerSpace.rows[0].id;

  await client.query(
    `INSERT INTO space_memberships (space_id, user_id, role, created_by)
     VALUES ($1, $3, 'owner', $3), ($2, $3, 'viewer', $4), ($2, $4, 'owner', $4)`,
    [ownerSpaceId, viewerSpaceId, primaryUserId, peerUserId]
  );

  const ownerLibrary = await client.query(
    `INSERT INTO libraries (space_id, name, description, created_by)
     VALUES ($1, 'Identity Owner Library', 'Upgrade certification fixture', $2)
     RETURNING id`,
    [ownerSpaceId, primaryUserId]
  );
  const viewerLibrary = await client.query(
    `INSERT INTO libraries (space_id, name, description, created_by)
     VALUES ($1, 'Identity Viewer Library', 'Upgrade certification fixture', $2)
     RETURNING id`,
    [viewerSpaceId, peerUserId]
  );
  const ownerLibraryId = ownerLibrary.rows[0].id;
  const viewerLibraryId = viewerLibrary.rows[0].id;
  await client.query(
    `INSERT INTO library_memberships (user_id, library_id, role)
     VALUES ($1, $2, 'owner'), ($1, $3, 'viewer'), ($4, $3, 'owner')`,
    [primaryUserId, ownerLibraryId, viewerLibraryId, peerUserId]
  );
  await client.query(
    `UPDATE users SET active_space_id = $2, active_library_id = $3 WHERE id = $1`,
    [primaryUserId, ownerSpaceId, ownerLibraryId]
  );
  await client.query(
    `UPDATE users SET active_space_id = $2, active_library_id = $3 WHERE id = $1`,
    [peerUserId, viewerSpaceId, viewerLibraryId]
  );

  for (const [index, token] of secrets.sessionTokens.entries()) {
    await client.query(
      `INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
       VALUES ($1, $2, '127.0.0.1', $3, NOW() + INTERVAL '7 days')`,
      [primaryUserId, sha256(token), `identity-certification-session-${index + 1}`]
    );
  }

  await client.query(
    `INSERT INTO invites (email, token_hash, used, revoked, expires_at, created_by, space_id, space_role)
     VALUES ($1, $2, false, false, NOW() + INTERVAL '7 days', $3, $4, 'member')`,
    [secrets.inviteEmail, sha256(secrets.inviteToken), primaryUserId, ownerSpaceId]
  );
  await client.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, used, revoked, expires_at, created_by)
     VALUES ($1, $2, false, false, NOW() + INTERVAL '1 day', $1)`,
    [primaryUserId, sha256(secrets.resetToken)]
  );
  await client.query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, used, revoked, expires_at)
     VALUES ($1, $2, true, false, NOW() + INTERVAL '1 day')`,
    [primaryUserId, sha256(secrets.verificationToken)]
  );
  await client.query(
    `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
     VALUES ($1, 'identity.certification.baseline', 'user', $1, $2::jsonb, '127.0.0.1')`,
    [primaryUserId, JSON.stringify({ fixture: true, scope: 'upgrade_restore' })]
  );
  const pat = await client.query(
    `INSERT INTO personal_access_tokens (user_id, name, token_hash, token_last_four, scopes, expires_at)
     VALUES ($1, 'Identity certification API credential', $2, $3, '["profile:read","libraries:read"]'::jsonb, NOW() + INTERVAL '7 days')
     RETURNING id`,
    [primaryUserId, sha256(secrets.personalAccessToken), secrets.personalAccessToken.slice(-4)]
  );
  const service = await client.query(
    `INSERT INTO service_account_keys
       (owner_user_id, created_by_user_id, name, key_hash, key_last_four, scopes, allowed_prefixes, expires_at)
     VALUES ($1, $1, 'Identity certification service credential', $2, $3,
       '["libraries:read"]'::jsonb, '["/api/libraries"]'::jsonb, NOW() + INTERVAL '7 days')
     RETURNING id`,
    [primaryUserId, sha256(secrets.serviceAccountKey), secrets.serviceAccountKey.slice(-4)]
  );

  return {
    primaryUserId,
    peerUserId,
    ownerSpaceId,
    viewerSpaceId,
    ownerLibraryId,
    viewerLibraryId,
    personalAccessRecordId: pat.rows[0].id,
    serviceAccountRecordId: service.rows[0].id
  };
}

function normalizeRows(rows) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    value instanceof Date ? value.toISOString() : value
  ])));
}

async function buildIdentityManifest(client, ids, fingerprintKey, policy) {
  const fingerprint = (value) => crypto.createHmac('sha256', fingerprintKey).update(String(value)).digest('hex');
  const users = await client.query(
    `SELECT id, email, role, email_verified, active_space_id, active_library_id
       FROM users WHERE id = ANY($1::int[]) ORDER BY id`,
    [[ids.primaryUserId, ids.peerUserId]]
  );
  const sessions = await client.query(
    `SELECT id, user_id, token_hash, expires_at FROM user_sessions
      WHERE user_id = $1 ORDER BY id`,
    [ids.primaryUserId]
  );
  const spaceMemberships = await client.query(
    `SELECT space_id, user_id, role, suspended_at FROM space_memberships
      WHERE user_id = ANY($1::int[]) ORDER BY space_id, user_id`,
    [[ids.primaryUserId, ids.peerUserId]]
  );
  const libraryMemberships = await client.query(
    `SELECT library_id, user_id, role FROM library_memberships
      WHERE user_id = ANY($1::int[]) ORDER BY library_id, user_id`,
    [[ids.primaryUserId, ids.peerUserId]]
  );
  const lifecycle = await client.query(
    `SELECT 'invite' AS kind, id, created_by AS user_id, space_id, used, revoked, token_hash FROM invites WHERE created_by = $1
     UNION ALL
     SELECT 'reset', id, user_id, NULL, used, revoked, token_hash FROM password_reset_tokens WHERE user_id = $1
     UNION ALL
     SELECT 'verification', id, user_id, NULL, used, revoked, token_hash FROM email_verification_tokens WHERE user_id = $1
     ORDER BY kind, id`,
    [ids.primaryUserId]
  );
  const audit = await client.query(
    `SELECT id, user_id, action, entity_type, entity_id, details
       FROM activity_log WHERE action = 'identity.certification.baseline' ORDER BY id`
  );
  const pat = await client.query(
    `SELECT id, user_id, token_hash, scopes, revoked_at, expires_at
       FROM personal_access_tokens WHERE id = $1`,
    [ids.personalAccessRecordId]
  );
  const service = await client.query(
    `SELECT id, owner_user_id, created_by_user_id, key_hash, scopes, allowed_prefixes, revoked_at, expires_at
       FROM service_account_keys WHERE id = $1`,
    [ids.serviceAccountRecordId]
  );

  return {
    schemaVersion: 1,
    policy,
    features: { mfaRecovery: 'notImplemented', encryptedIdentityMaterial: 'notImplemented' },
    users: normalizeRows(users.rows).map(({ email, ...row }) => ({
      ...row,
      emailFingerprint: fingerprint(email)
    })),
    spaceMemberships: normalizeRows(spaceMemberships.rows),
    libraryMemberships: normalizeRows(libraryMemberships.rows),
    sessions: normalizeRows(sessions.rows).map(({ token_hash: storedHash, ...row }) => ({
      ...row,
      storedCredentialFingerprint: fingerprint(storedHash)
    })),
    lifecycle: normalizeRows(lifecycle.rows).map(({ token_hash: storedHash, ...row }) => ({
      ...row,
      storedCredentialFingerprint: fingerprint(storedHash)
    })),
    audit: normalizeRows(audit.rows),
    apiCredentials: {
      personal: normalizeRows(pat.rows).map(({ token_hash: storedHash, ...row }) => ({
        ...row,
        storedCredentialFingerprint: fingerprint(storedHash)
      })),
      service: normalizeRows(service.rows).map(({ key_hash: storedHash, ...row }) => ({
        ...row,
        storedCredentialFingerprint: fingerprint(storedHash)
      }))
    }
  };
}

function buildSecretFreeEvidenceManifest(manifest) {
  const evidenceManifest = structuredClone(manifest);
  evidenceManifest.users = evidenceManifest.users.map(({ emailFingerprint, ...row }) => ({
    ...row,
    emailIdentityPresent: Boolean(emailFingerprint)
  }));
  evidenceManifest.sessions = evidenceManifest.sessions.map(({ storedCredentialFingerprint, ...row }) => ({
    ...row,
    storedCredentialPresent: Boolean(storedCredentialFingerprint)
  }));
  evidenceManifest.lifecycle = evidenceManifest.lifecycle.map(({ storedCredentialFingerprint, ...row }) => ({
    ...row,
    storedCredentialPresent: Boolean(storedCredentialFingerprint)
  }));
  evidenceManifest.apiCredentials.personal = evidenceManifest.apiCredentials.personal.map(
    ({ storedCredentialFingerprint, ...row }) => ({
      ...row,
      storedCredentialPresent: Boolean(storedCredentialFingerprint)
    })
  );
  evidenceManifest.apiCredentials.service = evidenceManifest.apiCredentials.service.map(
    ({ storedCredentialFingerprint, ...row }) => ({
      ...row,
      storedCredentialPresent: Boolean(storedCredentialFingerprint)
    })
  );
  return evidenceManifest;
}

function assertManifestMatchesPolicy(actual, expected, policy, phase) {
  const normalizedActual = structuredClone(actual);
  const normalizedExpected = structuredClone(expected);
  if (policy.existingSessions === 'revoke') {
    assert.strictEqual(normalizedActual.sessions.length, 0, `${phase}: existing sessions were not revoked`);
    normalizedExpected.sessions = [];
  }
  if (policy.activeScope === 'clear') {
    for (const user of normalizedActual.users) {
      assert.strictEqual(user.active_space_id, null, `${phase}: active workspace was not cleared`);
      assert.strictEqual(user.active_library_id, null, `${phase}: active library was not cleared`);
    }
    for (const user of normalizedExpected.users) {
      user.active_space_id = null;
      user.active_library_id = null;
    }
  }
  if (policy.apiCredentials === 'revoke') {
    for (const kind of ['personal', 'service']) {
      for (const record of normalizedActual.apiCredentials[kind]) {
        assert.ok(record.revoked_at, `${phase}: ${kind} API credential was not revoked`);
        record.revoked_at = null;
      }
    }
  }
  assert.deepStrictEqual(normalizedActual, normalizedExpected, `${phase}: identity manifest differs from policy`);
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function redactText(value, secrets) {
  let result = String(value || '');
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join('[REDACTED]');
  }
  return result.replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi, 'postgresql://[REDACTED]@');
}

async function startCertificationServer(databaseUrl, secrets) {
  const port = await getFreePort();
  const knownSecrets = Object.values(secrets).flat().filter((value) => typeof value === 'string');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DB_PASSWORD: '',
      DATABASE_SSL: useDatabaseSSL ? 'true' : 'false',
      PORT: String(port),
      NODE_ENV: 'test',
      APP_EDITION: 'platform',
      SESSION_SECRET: secrets.sessionSecret,
      INTEGRATION_ENCRYPTION_KEY: secrets.integrationEncryptionKey,
      SESSION_COOKIE_SECURE: 'false',
      IDENTITY_UPGRADE_CERTIFICATION: 'true',
      IDENTITY_CERTIFICATION_SKIP_STARTUP_MIGRATIONS: 'true',
      ALLOWED_ORIGINS: `http://127.0.0.1:${port}`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-12000); });
  child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-12000); });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Certification server exited before readiness: ${redactText(output, knownSecrets)}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return { child, baseUrl, knownSecrets, output: () => output };
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  child.kill('SIGTERM');
  throw new Error(`Certification server readiness timed out: ${redactText(output, knownSecrets)}`);
}

async function stopCertificationServer(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  server.child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);
  if (server.child.exitCode === null) server.child.kill('SIGKILL');
}

async function requestJson(baseUrl, pathname, options = {}, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const payload = await response.json().catch(() => ({}));
  assert.strictEqual(response.status, expectedStatus, `${options.method || 'GET'} ${pathname} returned ${response.status}`);
  return { response, payload };
}

function sessionCookie(token) {
  return `session_token=${token}`;
}

async function certifyApiBehavior(databaseUrl, secrets, ids, policy) {
  const server = await startCertificationServer(databaseUrl, secrets);
  try {
    const sessionResults = [];
    for (const token of secrets.sessionTokens) {
      const response = await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: { cookie: sessionCookie(token) }
      });
      if (policy.existingSessions === 'survive') {
        assert.strictEqual(response.status, 200, 'An expected surviving session was rejected');
        const payload = await response.json();
        sessionResults.push(payload.id === ids.primaryUserId);
      } else {
        assert.strictEqual(response.status, 401, 'An expected revoked session remained valid');
      }
    }
    if (policy.existingSessions === 'survive') {
      assert.deepStrictEqual(sessionResults, [true, true], 'Both pre-upgrade sessions must remain valid');
    }

    const login = await requestJson(server.baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: secrets.primaryEmail, password: secrets.password })
    });
    assert.strictEqual(login.payload.user.id, ids.primaryUserId, 'Password login resolved a different identity');
    assert.strictEqual(login.payload.user.email_verified, true, 'Verified-email state was not preserved');
    const loginSessionCookie = login.response.headers.getSetCookie()
      .map((value) => value.split(';')[0])
      .find((value) => value.startsWith('session_token='));
    assert.ok(loginSessionCookie, 'Password login did not issue a session cookie');

    const { payload: scope } = await requestJson(server.baseUrl, '/api/auth/scope', {
      headers: { cookie: loginSessionCookie }
    });
    if (policy.activeScope === 'preserve') {
      assert.strictEqual(scope.active_space_id, ids.ownerSpaceId, 'Active workspace changed');
      assert.strictEqual(scope.active_library_id, ids.ownerLibraryId, 'Active library changed');
    } else {
      assert.ok(scope.active_space_id, 'Cleared active scope did not resolve an accessible fallback workspace');
      assert.ok(scope.active_library_id, 'Cleared active scope did not resolve an accessible fallback library');
    }
    const roles = new Map(scope.spaces.map((space) => [Number(space.id), space.membership_role]));
    assert.strictEqual(roles.get(ids.ownerSpaceId), 'owner', 'Owner workspace role changed');
    assert.strictEqual(roles.get(ids.viewerSpaceId), 'viewer', 'Viewer workspace role changed');

    const { payload: spaces } = await requestJson(server.baseUrl, '/api/spaces', {
      headers: { cookie: loginSessionCookie }
    });
    assert.deepStrictEqual(
      spaces.spaces.map((space) => Number(space.id)).sort((a, b) => a - b),
      [ids.ownerSpaceId, ids.viewerSpaceId].sort((a, b) => a - b),
      'Workspace reachability changed'
    );

    if (policy.apiCredentials === 'remainValid') {
      const { payload: personal } = await requestJson(server.baseUrl, '/api/auth/me', {
        headers: { authorization: `Bearer ${secrets.personalAccessToken}` }
      });
      assert.strictEqual(personal.id, ids.primaryUserId, 'Personal API credential resolved a different identity');

      const { payload: service } = await requestJson(server.baseUrl, '/api/libraries', {
        headers: { authorization: `Bearer ${secrets.serviceAccountKey}` }
      });
      assert.ok(service.libraries.some((library) => Number(library.id) === ids.ownerLibraryId), 'Service credential lost library access');
    } else {
      await requestJson(server.baseUrl, '/api/auth/me', {
        headers: { authorization: `Bearer ${secrets.personalAccessToken}` }
      }, 401);
      await requestJson(server.baseUrl, '/api/libraries', {
        headers: { authorization: `Bearer ${secrets.serviceAccountKey}` }
      }, 401);
    }

    return {
      passwordLogin: 'passed',
      verifiedEmail: 'preserved',
      concurrentSessions: { expected: policy.existingSessions, observedValid: sessionResults.length },
      activeScope: policy.activeScope === 'preserve' ? 'preserved' : 'cleared_and_recovered',
      workspaceRoles: 'preserved',
      personalApiCredential: policy.apiCredentials === 'remainValid' ? 'valid' : 'revoked',
      serviceApiCredential: policy.apiCredentials === 'remainValid' ? 'valid' : 'revoked'
    };
  } finally {
    await stopCertificationServer(server);
  }
}

function assertSecretFreeEvidence(serialized, secrets) {
  const forbiddenValues = Object.values(secrets).flat().filter((value) => typeof value === 'string' && value.length > 0);
  for (const forbidden of forbiddenValues) {
    assert.ok(!serialized.includes(forbidden), 'Evidence retained a runtime-generated fixture secret');
  }
  assert.ok(!/postgres(?:ql)?:\/\/[^\s"@]+:[^\s"@]+@/i.test(serialized), 'Evidence retained a credential-bearing database URL');
  assert.ok(!/"(?:rawPassword|rawToken|rawKey|recoveryValue|command)"\s*:/i.test(serialized), 'Evidence retained a prohibited secret-bearing field');
  assert.ok(!/"(?:emailFingerprint|storedCredentialFingerprint)"\s*:/i.test(serialized), 'Evidence retained an in-memory identity fingerprint');
  assert.ok(!/[a-f0-9]{64}/i.test(serialized), 'Evidence retained a high-entropy fingerprint');
}

async function main() {
  const latestVersion = Math.max(...MIGRATIONS.map((migration) => migration.version));
  const baselineVersion = Number.isFinite(Number(process.env.IDENTITY_CERTIFICATION_BASELINE_VERSION))
    ? Number(process.env.IDENTITY_CERTIFICATION_BASELINE_VERSION)
    : Number(identityPolicies.certifiedThroughVersion);
  if (baselineVersion < minimumIdentityFixtureVersion || baselineVersion > latestVersion) {
    throw new Error(`IDENTITY_CERTIFICATION_BASELINE_VERSION must be between ${minimumIdentityFixtureVersion} and ${latestVersion}`);
  }

  const pendingMigrations = MIGRATIONS.filter((migration) => migration.version > baselineVersion);
  const identityMigrations = pendingMigrations.filter((migration) => identityMigrationPattern.test(`${migration.description}\n${migration.up}`));
  const selectedPolicy = resolveIdentityPolicy(pendingMigrations.map((migration) => migration.version));
  const mode = String(process.env.IDENTITY_CERTIFICATION_MODE || 'auto').toLowerCase();
  const outputPath = process.env.IDENTITY_CERTIFICATION_OUTPUT || path.join('artifacts', 'identity-upgrade-certification-evidence.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  if (pendingMigrations.length === 0 || (mode !== 'force' && identityMigrations.length === 0)) {
    const evidence = {
      generatedAt: new Date().toISOString(),
      status: 'not_required',
      baselineVersion,
      latestVersion,
      evaluatedMigrationVersions: pendingMigrations.map((migration) => migration.version),
      reason: pendingMigrations.length === 0
        ? 'The migration chain has no versions newer than the maintained certified-through marker.'
        : 'No identity-sensitive migration matched the maintained certification selector.'
    };
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    assertSecretFreeEvidence(serialized, {});
    fs.writeFileSync(outputPath, serialized, 'utf8');
    console.log(`Identity upgrade certification not required. Evidence written to ${outputPath}`);
    return;
  }

  const runId = `${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const legacyDb = `collectz_identity_legacy_${runId}`;
  const snapshotDb = `collectz_identity_snapshot_${runId}`;
  const rollbackDb = `collectz_identity_rollback_${runId}`;
  const adminUrl = baseConnectionString();
  const admin = await connect(adminUrl);
  const secrets = buildFixtureSecrets();
  const fingerprintKey = crypto.randomBytes(32);
  const evidence = {
    generatedAt: new Date().toISOString(),
    status: 'running',
    manifestSchemaVersion: 1,
    baselineVersion,
    latestVersion,
    certifiedMigrationVersions: pendingMigrations.map((migration) => migration.version),
    selectorMatches: identityMigrations.map((migration) => ({ version: migration.version, description: migration.description })),
    fixturePolicy: { source: 'runtime_generated_synthetic', productionDataUsed: false },
    manifest: null,
    phases: {}
  };
  let baselineManifest = null;

  try {
    for (const databaseName of [rollbackDb, snapshotDb, legacyDb]) {
      await terminateAndDropDatabase(admin, databaseName);
    }
    await createDatabase(admin, legacyDb);

    const baselineClient = await connect(withDb(adminUrl, legacyDb));
    let ids;
    try {
      await runMigrationsForClient(baselineClient, { maxVersion: baselineVersion });
      ids = await seedIdentityFixture(baselineClient, secrets);
      baselineManifest = await buildIdentityManifest(baselineClient, ids, fingerprintKey, selectedPolicy);
      evidence.manifest = buildSecretFreeEvidenceManifest(baselineManifest);
    } finally {
      await baselineClient.end();
    }
    await createDatabase(admin, snapshotDb, legacyDb);

    evidence.phases.baseline = await certifyApiBehavior(withDb(adminUrl, legacyDb), secrets, ids, identityPolicies.defaultPolicy);
    await terminateAndDropDatabase(admin, legacyDb);
    await createDatabase(admin, legacyDb, snapshotDb);

    const upgradeClient = await connect(withDb(adminUrl, legacyDb));
    try {
      await runMigrationsForClient(upgradeClient);
      const upgradedManifest = await buildIdentityManifest(upgradeClient, ids, fingerprintKey, selectedPolicy);
      assertManifestMatchesPolicy(upgradedManifest, baselineManifest, selectedPolicy, 'upgrade');
    } finally {
      await upgradeClient.end();
    }
    evidence.phases.upgrade = await certifyApiBehavior(withDb(adminUrl, legacyDb), secrets, ids, selectedPolicy);

    await createDatabase(admin, rollbackDb, snapshotDb);
    const rollbackClient = await connect(withDb(adminUrl, rollbackDb));
    try {
      const rollbackManifest = await buildIdentityManifest(rollbackClient, ids, fingerprintKey, selectedPolicy);
      assert.deepStrictEqual(rollbackManifest, baselineManifest, 'Identity manifest changed after restore');
    } finally {
      await rollbackClient.end();
    }
    evidence.phases.restore = await certifyApiBehavior(withDb(adminUrl, rollbackDb), secrets, ids, identityPolicies.defaultPolicy);

    evidence.status = 'passed';
    evidence.identityContinuity = {
      emailIdentity: 'certified_in_memory',
      storedCredentials: 'certified_in_memory',
      fingerprintsRetained: false
    };
    evidence.evidenceHygiene = { runtimeSecretsRetained: false, credentialBearingCommandsRetained: false };
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    assertSecretFreeEvidence(serialized, secrets);
    fs.writeFileSync(outputPath, serialized, 'utf8');
    console.log(`Identity upgrade certification passed. Evidence written to ${outputPath}`);
  } finally {
    for (const databaseName of [rollbackDb, snapshotDb, legacyDb]) {
      try { await terminateAndDropDatabase(admin, databaseName); } catch (_) {}
    }
    await admin.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Identity upgrade certification failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  assertSecretFreeEvidence,
  assertManifestMatchesPolicy,
  identityMigrationPattern,
  resolveIdentityPolicy
};
