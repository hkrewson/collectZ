#!/usr/bin/env node
'use strict';

/**
 * Runtime role certification (3.24.14).
 *
 * Builds an isolated scratch database, migrates it to the previous release
 * boundary as the owner (a legacy install), seeds a row, then runs the same
 * migrate + provision path the one-shot Compose job uses. It then proves with
 * raw SQL that the runtime role can perform application DML but none of the
 * prohibited owner operations, that future migration-created tables inherit
 * runtime grants, and that the startup guard rejects over-privileged roles.
 *
 * Uses an ephemeral, randomly named runtime role and password; both are
 * removed afterwards and the password is never written to evidence.
 *
 * Environment:
 *   RUNTIME_ROLE_CERT_ADMIN_URL  superuser/owner URL to the maintenance DB
 *                                (falls back to MIGRATION_REHEARSAL_ADMIN_URL,
 *                                then DATABASE_MIGRATION_URL/DATABASE_URL with
 *                                path /postgres)
 *   RUNTIME_ROLE_CERT_OUTPUT     evidence path
 *                                (default artifacts/runtime-role-certification-evidence.json)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const { runMigrationsForClient, getExpectedMigrationVersion, assertSchemaCurrent } = require('../db/migrations');
const {
  provisionRuntimeRole,
  inspectRuntimeRole,
  evaluateRuntimeRolePrivileges,
  assertRuntimeRolePolicy,
  buildScramSha256Verifier
} = require('../db/runtimeRole');

const useDatabaseSSL = process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1';
const ssl = useDatabaseSSL ? { rejectUnauthorized: false } : false;
const quietLogger = { log() {}, warn() {} };

function adminConnectionString() {
  const explicit = process.env.RUNTIME_ROLE_CERT_ADMIN_URL || process.env.MIGRATION_REHEARSAL_ADMIN_URL;
  if (explicit) return explicit;
  const base = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
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

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function connect(connectionString) {
  const client = new Client({ connectionString, ssl });
  await client.connect();
  return client;
}

async function dropDatabase(admin, dbName) {
  await admin.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [dbName]
  );
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(dbName)}`);
}

async function expectDenied(client, label, sql) {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('ROLLBACK');
    return { label, expected: 'denied', outcome: 'allowed', pass: false };
  } catch (error) {
    await client.query('ROLLBACK');
    const denied = error.code === '42501' || /permission denied|must be owner|must be superuser|must have/i.test(error.message);
    return { label, expected: 'denied', outcome: denied ? 'denied' : `error:${error.code || 'unknown'}`, pass: denied };
  }
}

async function expectAllowed(client, label, statements) {
  await client.query('BEGIN');
  try {
    for (const sql of statements) {
      await client.query(sql);
    }
    await client.query('ROLLBACK');
    return { label, expected: 'allowed', outcome: 'allowed', pass: true };
  } catch (error) {
    await client.query('ROLLBACK');
    return { label, expected: 'allowed', outcome: `error:${error.code || 'unknown'}`, pass: false };
  }
}

async function main() {
  const adminUrl = adminConnectionString();
  const suffix = `${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
  const dbName = `collectz_runtime_role_cert_${suffix}`;
  const roleName = `collectz_app_cert_${suffix}`;
  const probeRole = `collectz_probe_cert_${suffix}`;
  const runtimePassword = crypto.randomBytes(24).toString('hex');
  const latest = getExpectedMigrationVersion();
  const legacyBaseline = latest - 1;
  const outputPath = path.resolve(
    __dirname,
    '..',
    process.env.RUNTIME_ROLE_CERT_OUTPUT || 'artifacts/runtime-role-certification-evidence.json'
  );

  const evidence = {
    generated_at: new Date().toISOString(),
    certification: 'runtime-role',
    latest_migration: latest,
    legacy_baseline: legacyBaseline,
    runtime_role: 'ephemeral (redacted)',
    checks: [],
    status: 'failed'
  };
  const record = (label, pass, detail = undefined) => {
    evidence.checks.push(detail === undefined ? { label, pass } : { label, pass, detail });
  };

  const admin = await connect(adminUrl);
  let owner = null;
  let runtime = null;
  try {
    await dropDatabase(admin, dbName);
    await admin.query(`CREATE DATABASE ${quoteIdent(dbName)}`);
    const ownerUrl = withDb(adminUrl, dbName);

    // 1. Legacy install: owner-created schema at the previous release boundary with data.
    owner = await connect(ownerUrl);
    await runMigrationsForClient(owner, { maxVersion: legacyBaseline });
    await owner.query(
      `INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, 'user')`,
      [`runtime-role-cert-${suffix}@example.invalid`, 'not-a-real-hash', 'Runtime Role Cert']
    );
    record('legacy baseline migrated with seeded row', true, { baseline: legacyBaseline });

    // 2. One-shot job path: migrate to latest, provision twice (idempotency).
    await runMigrationsForClient(owner);
    const first = await provisionRuntimeRole(owner, { roleName, password: runtimePassword });
    const second = await provisionRuntimeRole(owner, { roleName, password: runtimePassword });
    record('runtime role created then updated idempotently', first.created === true && second.created === false);

    // 3. Runtime credential connects, sees current schema and legacy data, passes guard.
    runtime = await connect(withCredentials(ownerUrl, roleName, runtimePassword));
    await assertSchemaCurrent(runtime);
    record('runtime role verifies schema current', true, { version: latest });
    const seeded = await runtime.query('SELECT COUNT(*)::int AS count FROM users WHERE email = $1', [
      `runtime-role-cert-${suffix}@example.invalid`
    ]);
    record('runtime role reads legacy data', seeded.rows[0].count === 1);
    const guard = await assertRuntimeRolePolicy(runtime, { policy: 'enforce', logger: quietLogger });
    record('runtime role passes enforce guard', guard.ok === true, { violations: guard.violations });

    // 4. Allowed DML.
    const allowed = [
      await expectAllowed(runtime, 'select/insert/update/delete application rows', [
        `INSERT INTO users (email, password, name, role) VALUES ('dml-${suffix}@example.invalid', 'x', 'DML', 'user')`,
        `UPDATE users SET name = 'DML updated' WHERE email = 'dml-${suffix}@example.invalid'`,
        `DELETE FROM users WHERE email = 'dml-${suffix}@example.invalid'`
      ]),
      await expectAllowed(runtime, 'sequence nextval', [`SELECT nextval(pg_get_serial_sequence('users', 'id'))`]),
      await expectAllowed(runtime, 'read schema_migrations', ['SELECT MAX(version) FROM schema_migrations']),
      await expectAllowed(runtime, 'transaction advisory lock', [`SELECT pg_advisory_xact_lock(hashtextextended('cert', 0))`])
    ];

    // 5. Prohibited owner operations.
    const denied = [
      await expectDenied(runtime, 'create table', 'CREATE TABLE public.runtime_role_cert_probe (id int)'),
      await expectDenied(runtime, 'alter table', 'ALTER TABLE users ADD COLUMN runtime_role_cert_probe int'),
      await expectDenied(runtime, 'drop table', 'DROP TABLE media'),
      await expectDenied(runtime, 'truncate table', 'TRUNCATE media'),
      await expectDenied(runtime, 'create index', 'CREATE INDEX runtime_role_cert_idx ON users (name)'),
      await expectDenied(runtime, 'disable triggers', 'ALTER TABLE users DISABLE TRIGGER ALL'),
      await expectDenied(runtime, 'create function in schema', 'CREATE FUNCTION public.runtime_role_cert_fn() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$'),
      await expectDenied(runtime, 'insert schema_migrations', `INSERT INTO schema_migrations (version, description) VALUES (999999, 'cert')`),
      await expectDenied(runtime, 'update schema_migrations', `UPDATE schema_migrations SET description = 'cert'`),
      await expectDenied(runtime, 'delete schema_migrations', 'DELETE FROM schema_migrations'),
      await expectDenied(runtime, 'create schema', 'CREATE SCHEMA runtime_role_cert'),
      await expectDenied(runtime, 'create role', 'CREATE ROLE runtime_role_cert_probe'),
      await expectDenied(runtime, 'grant self bypassrls', `ALTER ROLE ${quoteIdent(roleName)} BYPASSRLS`),
      await expectDenied(runtime, 'assume owner role', `SET ROLE ${quoteIdent(first.owner)}`)
    ];
    try {
      await runtime.query(`CREATE DATABASE ${quoteIdent(`${dbName}_probe`)}`);
      denied.push({ label: 'create database', expected: 'denied', outcome: 'allowed', pass: false });
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(`${dbName}_probe`)}`);
    } catch (error) {
      denied.push({ label: 'create database', expected: 'denied', outcome: 'denied', pass: error.code === '42501' });
    }
    for (const check of [...allowed, ...denied]) {
      evidence.checks.push(check);
    }

    // 6. Future migration-created tables inherit runtime grants via default privileges.
    await owner.query('CREATE TABLE runtime_role_cert_future (id SERIAL PRIMARY KEY, note TEXT)');
    const inherited = await expectAllowed(runtime, 'future table inherits DML grants', [
      `INSERT INTO runtime_role_cert_future (note) VALUES ('ok')`,
      'SELECT * FROM runtime_role_cert_future'
    ]);
    evidence.checks.push(inherited);
    evidence.checks.push(await expectDenied(runtime, 'future table not droppable', 'DROP TABLE runtime_role_cert_future'));
    await owner.query('DROP TABLE runtime_role_cert_future');

    // 7. Guard rejects over-privileged credentials.
    const ownerFacts = evaluateRuntimeRolePrivileges(await inspectRuntimeRole(owner));
    record('guard rejects owner credential', ownerFacts.ok === false, { violations: ownerFacts.violations });
    let enforceThrew = false;
    try {
      await assertRuntimeRolePolicy(owner, { policy: 'enforce', logger: quietLogger });
    } catch (_error) {
      enforceThrew = true;
    }
    record('enforce policy throws for owner credential', enforceThrew);

    const probePassword = crypto.randomBytes(24).toString('hex');
    await admin.query(`CREATE ROLE ${quoteIdent(probeRole)} LOGIN PASSWORD '${buildScramSha256Verifier(probePassword)}'`);
    await owner.query(`GRANT ${quoteIdent(first.owner)} TO ${quoteIdent(probeRole)}`);
    const memberClient = await connect(withCredentials(ownerUrl, probeRole, probePassword));
    try {
      const memberFacts = evaluateRuntimeRolePrivileges(await inspectRuntimeRole(memberClient));
      record('guard rejects member of owner role', memberFacts.ok === false, { violations: memberFacts.violations });
    } finally {
      await memberClient.end();
    }

    // 8. Re-provisioning strips a stray owner membership from the runtime role.
    await owner.query(`GRANT ${quoteIdent(first.owner)} TO ${quoteIdent(roleName)}`);
    const tainted = evaluateRuntimeRolePrivileges(await inspectRuntimeRole(runtime));
    await provisionRuntimeRole(owner, { roleName, password: runtimePassword });
    const repaired = evaluateRuntimeRolePrivileges(await inspectRuntimeRole(runtime));
    record('re-provisioning removes owner membership', tainted.ok === false && repaired.ok === true);

    evidence.status = evidence.checks.every((check) => check.pass) ? 'passed' : 'failed';
  } finally {
    if (runtime) await runtime.end().catch(() => {});
    if (owner) await owner.end().catch(() => {});
    await dropDatabase(admin, dbName).catch(() => {});
    for (const role of [roleName, probeRole]) {
      const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
      if (exists.rowCount > 0) {
        await admin.query(`DROP ROLE ${quoteIdent(role)}`).catch((error) => {
          console.warn(`Could not drop certification role: ${error.message}`);
        });
      }
    }
    await admin.end();
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  const failed = evidence.checks.filter((check) => !check.pass);
  console.log(
    `Runtime role certification ${evidence.status}: ${evidence.checks.length - failed.length}/${evidence.checks.length} checks. ` +
    `Evidence written to ${outputPath}`
  );
  if (failed.length > 0) {
    for (const check of failed) {
      console.error(`  FAIL ${check.label}: ${check.outcome || JSON.stringify(check.detail || {})}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Runtime role certification failed: ${error.message}`);
  process.exit(1);
});
