#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { Client } = require('pg');

const { runMigrationsForClient } = require('../db/migrations');
const { brokerCredentials } = require('../db/scopeBroker');
const { provisionRuntimeRole } = require('../db/runtimeRole');
const { certifyMigrationBuiltRuntime } = require('../db/migrationAuthority');

const ssl = ['true', '1'].includes(process.env.DATABASE_SSL)
  ? { rejectUnauthorized: false }
  : false;

function adminConnectionString() {
  const explicit = process.env.CONTROL_PLANE_AUTHORITY_ADMIN_URL
    || process.env.MIGRATION_REHEARSAL_ADMIN_URL
    || process.env.DATABASE_MIGRATION_URL;
  if (explicit) return explicit;
  const base = process.env.DATABASE_URL;
  if (base) {
    const parsed = new URL(base);
    parsed.pathname = '/postgres';
    return parsed.toString();
  }
  return 'postgresql://postgres:postgres@localhost:5432/postgres';
}

function withDb(connectionString, databaseName) {
  const parsed = new URL(connectionString);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function withCredentials(connectionString, user, password) {
  const parsed = new URL(connectionString);
  parsed.username = encodeURIComponent(user);
  parsed.password = encodeURIComponent(password);
  return parsed.toString();
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function connect(connectionString) {
  const client = new Client({ connectionString, ssl });
  await client.connect();
  return client;
}

async function dropDatabase(admin, databaseName) {
  await admin.query(
    `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
      WHERE datname = $1
        AND pid <> pg_backend_pid()`,
    [databaseName]
  );
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(databaseName)}`);
}

async function reservePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  if (!Number.isInteger(port)) throw new Error('Could not reserve a certification port');
  return port;
}

function waitForExit(child) {
  return new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const exited = waitForExit(child);
  child.kill('SIGTERM');
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 5000));
  if (await Promise.race([exited, timeout])) return;
  child.kill('SIGKILL');
  await exited;
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 60000;
  let lastStatus = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Platform backend exited before health check (${child.exitCode})`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      lastStatus = response.status;
      if (response.ok) return response.json();
    } catch (_) {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Platform backend did not become healthy (last status ${lastStatus || 'unavailable'})`);
}

async function main() {
  const suffix = crypto.randomBytes(6).toString('hex');
  const databaseName = `collectz_control_plane_authority_${suffix}`;
  const runtimeRole = `collectz_control_plane_app_${suffix}`;
  const runtimePassword = crypto.randomBytes(32).toString('hex');
  const brokerRole = brokerCredentials(runtimeRole, runtimePassword).role;
  const outputPath = path.resolve(
    process.env.CONTROL_PLANE_AUTHORITY_OUTPUT
      || path.join('artifacts', 'control-plane-runtime-authority-evidence.json')
  );
  const adminUrl = adminConnectionString();
  const admin = await connect(adminUrl);
  let owner = null;
  let runtime = null;
  let server = null;
  let failure = null;
  let phase = 'create_database';
  const evidence = {
    generatedAt: new Date().toISOString(),
    status: 'failed',
    certificationMode: 'migration_built_control_plane_runtime_authority',
    authority: null,
    runtime: {
      edition: 'platform',
      role: 'ephemeral_or_runtime_credential_redacted',
      migrationsMode: 'external',
      executionBoundary: 'canonical_backend_container_unpublished_port'
    },
    checks: []
  };
  const record = (id, pass, detail = undefined) => {
    evidence.checks.push(detail === undefined ? { id, pass } : { id, pass, detail });
  };

  try {
    await dropDatabase(admin, databaseName);
    await admin.query(`CREATE DATABASE ${quoteIdent(databaseName)}`);
    owner = await connect(withDb(adminUrl, databaseName));
    const empty = await owner.query(
      `SELECT NOT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'schema_migrations'
       ) AS empty_before_migrate`
    );
    const emptyBeforeMigrate = empty.rows[0]?.empty_before_migrate === true;
    record('empty_database_observed_before_migrate', emptyBeforeMigrate);
    if (!emptyBeforeMigrate) throw new Error('Scratch database was not empty before migration');

    phase = 'migrate_and_provision';
    await runMigrationsForClient(owner);
    await provisionRuntimeRole(owner, { roleName: runtimeRole, password: runtimePassword });
    const runtimeUrl = withCredentials(withDb(adminUrl, databaseName), runtimeRole, runtimePassword);
    runtime = await connect(runtimeUrl);
    evidence.authority = await certifyMigrationBuiltRuntime(runtime, {
      emptyDatabaseBeforeMigrate: true,
      migrationsMode: 'external'
    });
    record(
      'migration_authority_passed',
      evidence.authority.status === 'passed'
        && evidence.authority.checks.every((check) => check.pass === true),
      { migrationVersion: evidence.authority.authority.appliedMigrationVersion }
    );
    await runtime.end();
    runtime = null;
    await owner.end();
    owner = null;

    phase = 'platform_backend_startup';
    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const childEnv = {
      ...process.env,
      APP_EDITION: 'platform',
      PORT: String(port),
      DATABASE_URL: runtimeUrl,
      DATABASE_MIGRATIONS_MODE: 'external',
      DATABASE_RUNTIME_ROLE_POLICY: 'enforce',
      NODE_ENV: 'production',
      SESSION_COOKIE_SECURE: 'true',
      TRUST_PROXY: '1'
    };
    server = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
      cwd: path.resolve(__dirname, '..'),
      env: childEnv,
      stdio: ['ignore', 'inherit', 'inherit']
    });
    const health = await waitForHealth(baseUrl, server);
    record('platform_backend_started_healthy', health?.status === 'ok');

    const authConfigResponse = await fetch(`${baseUrl}/api/auth/config`);
    const authConfig = await authConfigResponse.json();
    record(
      'platform_edition_contract_loaded',
      authConfigResponse.ok
        && authConfig?.product_edition === 'platform'
        && authConfig?.edition_contract?.workspace_surface === true
        && authConfig?.edition_contract?.library_model === 'multi_workspace_platform'
    );

    phase = 'platform_boundary_smoke';
    const smoke = spawnSync(
      process.execPath,
      [path.resolve(__dirname, 'platform-edition-boundary-smoke.js')],
      {
        cwd: path.resolve(__dirname, '..'),
        env: { ...childEnv, BASE_URL: baseUrl },
        encoding: 'utf8',
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024
      }
    );
    if (smoke.stdout) process.stdout.write(smoke.stdout);
    if (smoke.stderr) process.stderr.write(smoke.stderr);
    record('platform_boundary_smoke_passed', smoke.status === 0);
    if (smoke.status !== 0) throw new Error('Platform boundary smoke failed');

    evidence.status = evidence.checks.every((check) => check.pass) ? 'passed' : 'failed';
  } catch (error) {
    failure = error;
    evidence.failedPhase = phase;
  } finally {
    await stopChild(server).catch(() => {});
    if (runtime) await runtime.end().catch(() => {});
    if (owner) await owner.end().catch(() => {});
    await dropDatabase(admin, databaseName).catch(() => {});
    for (const role of [brokerRole, runtimeRole]) {
      await admin.query(`DROP ROLE IF EXISTS ${quoteIdent(role)}`).catch(() => {});
    }
    await admin.end();
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });
  const passed = evidence.checks.filter((check) => check.pass).length;
  console.log(
    `Control-plane runtime authority ${evidence.status}: ${passed}/${evidence.checks.length} checks. `
    + `Evidence written to ${outputPath}`
  );
  if (failure || evidence.status !== 'passed') {
    throw new Error(`Control-plane runtime authority failed during ${evidence.failedPhase || 'validation'}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
