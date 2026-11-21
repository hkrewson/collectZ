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
const { brokerCredentials } = require('../db/scopeBroker');
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

const EXPECTED_RUNTIME_SCOPE_FUNCTIONS = [
  'allows(integer, integer, integer)',
  'allows_library(integer, integer)',
  'allows_workspace(integer)',
  'worker_allows_global(text, text)',
  'worker_allows_ingest(integer, integer, text)',
  'worker_allows_lifecycle(integer, integer, text, text)',
  'worker_allows_lifecycle_scope(integer, integer, text)'
];
const EXPECTED_BROKER_SCOPE_FUNCTIONS = [
  'authorize(integer, text, integer, integer, integer)',
  'authorize_worker(integer, text, text, text, text[], integer, integer)',
  'revoke(integer, text)',
  'revoke_worker(integer, text)'
];
const EXPECTED_DEFAULT_PRIVILEGES = [
  'sequence:SELECT',
  'sequence:UPDATE',
  'sequence:USAGE',
  'table:DELETE',
  'table:INSERT',
  'table:SELECT',
  'table:UPDATE'
];

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

async function collectProvisioningInventory(client, { ownerRole, runtimeRole, brokerRole }) {
  const roleResult = await client.query(
    `SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreaterole,
            rolcreatedb, rolreplication, rolbypassrls
       FROM pg_roles
      WHERE rolname = ANY($1::text[])
      ORDER BY rolname`,
    [[runtimeRole, brokerRole]]
  );
  const roleByName = new Map(roleResult.rows.map((row) => [row.rolname, row]));
  const sanitizeRole = (name) => {
    const row = roleByName.get(name);
    return row ? {
      login: row.rolcanlogin,
      inherit: row.rolinherit,
      superuser: row.rolsuper,
      createRole: row.rolcreaterole,
      createDatabase: row.rolcreatedb,
      replication: row.rolreplication,
      bypassRls: row.rolbypassrls
    } : null;
  };

  const memberships = await client.query(
    `SELECT member.rolname AS member_role, granted.rolname AS granted_role
       FROM pg_auth_members membership
       JOIN pg_roles member ON member.oid = membership.member
       JOIN pg_roles granted ON granted.oid = membership.roleid
      WHERE member.rolname = ANY($1::text[])`,
    [[runtimeRole, brokerRole]]
  );

  const databaseAccess = await client.query(
    `SELECT has_database_privilege($1, current_database(), 'CONNECT') AS runtime_connect,
            has_database_privilege($1, current_database(), 'CREATE') AS runtime_create,
            has_database_privilege($2, current_database(), 'CONNECT') AS broker_connect,
            has_database_privilege($2, current_database(), 'CREATE') AS broker_create`,
    [runtimeRole, brokerRole]
  );

  const schemaAccess = await client.query(
    `SELECT has_schema_privilege($1, 'public', 'USAGE') AS runtime_public_usage,
            has_schema_privilege($1, 'public', 'CREATE') AS runtime_public_create,
            has_schema_privilege($1, 'collectz_scope', 'USAGE') AS runtime_scope_usage,
            has_schema_privilege($1, 'collectz_scope', 'CREATE') AS runtime_scope_create,
            has_schema_privilege($2, 'public', 'USAGE') AS broker_public_usage,
            has_schema_privilege($2, 'public', 'CREATE') AS broker_public_create,
            has_schema_privilege($2, 'collectz_scope', 'USAGE') AS broker_scope_usage,
            has_schema_privilege($2, 'collectz_scope', 'CREATE') AS broker_scope_create,
            EXISTS (
              SELECT 1
                FROM pg_namespace n
                CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) acl
               WHERE n.nspname = 'public'
                 AND acl.grantee = 0
                 AND acl.privilege_type = 'CREATE'
            ) AS public_public_create`,
    [runtimeRole, brokerRole]
  );

  const relationAccess = await client.query(
    `SELECT COUNT(*)::int AS table_count,
            COUNT(*) FILTER (WHERE has_table_privilege($1, format('%I.%I', n.nspname, c.relname), 'SELECT'))::int AS runtime_select,
            COUNT(*) FILTER (WHERE has_table_privilege($1, format('%I.%I', n.nspname, c.relname), 'INSERT'))::int AS runtime_insert,
            COUNT(*) FILTER (WHERE has_table_privilege($1, format('%I.%I', n.nspname, c.relname), 'UPDATE'))::int AS runtime_update,
            COUNT(*) FILTER (WHERE has_table_privilege($1, format('%I.%I', n.nspname, c.relname), 'DELETE'))::int AS runtime_delete,
            COUNT(*) FILTER (WHERE has_table_privilege($2, format('%I.%I', n.nspname, c.relname), 'SELECT,INSERT,UPDATE,DELETE'))::int AS broker_any_dml
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`,
    [runtimeRole, brokerRole]
  );
  const migrationTableAccess = await client.query(
    `SELECT has_table_privilege($1, 'public.schema_migrations', 'SELECT') AS select,
            has_table_privilege($1, 'public.schema_migrations', 'INSERT') AS insert,
            has_table_privilege($1, 'public.schema_migrations', 'UPDATE') AS update,
            has_table_privilege($1, 'public.schema_migrations', 'DELETE') AS delete`,
    [runtimeRole]
  );

  const sequenceAccess = await client.query(
    `SELECT COUNT(*)::int AS sequence_count,
            COUNT(*) FILTER (WHERE has_sequence_privilege($1, format('%I.%I', n.nspname, c.relname), 'USAGE'))::int AS runtime_usage,
            COUNT(*) FILTER (WHERE has_sequence_privilege($1, format('%I.%I', n.nspname, c.relname), 'SELECT'))::int AS runtime_select,
            COUNT(*) FILTER (WHERE has_sequence_privilege($1, format('%I.%I', n.nspname, c.relname), 'UPDATE'))::int AS runtime_update,
            COUNT(*) FILTER (WHERE has_sequence_privilege($2, format('%I.%I', n.nspname, c.relname), 'USAGE,SELECT,UPDATE'))::int AS broker_any
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'S'`,
    [runtimeRole, brokerRole]
  );

  const functionAccess = await client.query(
    `SELECT grantee.rolname,
            p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS signature
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
       JOIN pg_roles grantee ON grantee.oid = acl.grantee
      WHERE n.nspname = 'collectz_scope'
        AND grantee.rolname = ANY($1::text[])
        AND acl.privilege_type = 'EXECUTE'
      ORDER BY grantee.rolname, signature`,
    [[runtimeRole, brokerRole]]
  );
  const publicScopeFunctionAccess = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
      WHERE n.nspname = 'collectz_scope'
        AND acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'`
  );

  const defaultPrivileges = await client.query(
    `SELECT CASE defaults.defaclobjtype WHEN 'r' THEN 'table' WHEN 'S' THEN 'sequence' ELSE defaults.defaclobjtype::text END AS object_type,
            acl.privilege_type
       FROM pg_default_acl defaults
       JOIN pg_roles owner ON owner.oid = defaults.defaclrole
       JOIN pg_namespace n ON n.oid = defaults.defaclnamespace
       CROSS JOIN LATERAL aclexplode(defaults.defaclacl) acl
       JOIN pg_roles grantee ON grantee.oid = acl.grantee
      WHERE owner.rolname = $1
        AND n.nspname = 'public'
        AND grantee.rolname = $2
      ORDER BY object_type, acl.privilege_type`,
    [ownerRole, runtimeRole]
  );
  const brokerMapping = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM collectz_scope.brokers
      WHERE broker_role = $1 AND runtime_role = $2`,
    [brokerRole, runtimeRole]
  );

  const functionsFor = (role) => functionAccess.rows
    .filter((row) => row.rolname === role)
    .map((row) => row.signature);

  return {
    contractVersion: 1,
    principals: {
      runtime: sanitizeRole(runtimeRole),
      broker: sanitizeRole(brokerRole),
      memberships: memberships.rows.length
    },
    database: databaseAccess.rows[0],
    schemas: schemaAccess.rows[0],
    tables: {
      ...relationAccess.rows[0],
      schemaMigrations: migrationTableAccess.rows[0]
    },
    sequences: sequenceAccess.rows[0],
    functions: {
      runtime: functionsFor(runtimeRole),
      broker: functionsFor(brokerRole),
      publicExecuteCount: publicScopeFunctionAccess.rows[0].count
    },
    defaultPrivileges: defaultPrivileges.rows.map((row) => `${row.object_type}:${row.privilege_type}`),
    brokerMappingCount: brokerMapping.rows[0].count
  };
}

function evaluateProvisioningInventory(inventory) {
  const problems = [];
  const expectedRuntime = {
    login: true, inherit: true, superuser: false, createRole: false,
    createDatabase: false, replication: false, bypassRls: false
  };
  const expectedBroker = { ...expectedRuntime, inherit: false };
  if (JSON.stringify(inventory.principals.runtime) !== JSON.stringify(expectedRuntime)) problems.push('runtime_role_attributes');
  if (JSON.stringify(inventory.principals.broker) !== JSON.stringify(expectedBroker)) problems.push('broker_role_attributes');
  if (Number(inventory.principals.memberships) !== 0) problems.push('role_memberships');
  if (!inventory.database.runtime_connect || inventory.database.runtime_create || !inventory.database.broker_connect || inventory.database.broker_create) problems.push('database_privileges');
  if (!inventory.schemas.runtime_public_usage || inventory.schemas.runtime_public_create
      || !inventory.schemas.runtime_scope_usage || inventory.schemas.runtime_scope_create
      || !inventory.schemas.broker_public_usage || inventory.schemas.broker_public_create
      || !inventory.schemas.broker_scope_usage || inventory.schemas.broker_scope_create
      || inventory.schemas.public_public_create) problems.push('schema_privileges');
  const appTableCount = Number(inventory.tables.table_count) - 1;
  if (Number(inventory.tables.runtime_select) !== Number(inventory.tables.table_count)
      || Number(inventory.tables.runtime_insert) !== appTableCount
      || Number(inventory.tables.runtime_update) !== appTableCount
      || Number(inventory.tables.runtime_delete) !== appTableCount
      || Number(inventory.tables.broker_any_dml) !== 0
      || JSON.stringify(inventory.tables.schemaMigrations) !== JSON.stringify({ select: true, insert: false, update: false, delete: false })) problems.push('table_privileges');
  if (Number(inventory.sequences.runtime_usage) !== Number(inventory.sequences.sequence_count)
      || Number(inventory.sequences.runtime_select) !== Number(inventory.sequences.sequence_count)
      || Number(inventory.sequences.runtime_update) !== Number(inventory.sequences.sequence_count)
      || Number(inventory.sequences.broker_any) !== 0) problems.push('sequence_privileges');
  if (JSON.stringify(inventory.functions.runtime) !== JSON.stringify(EXPECTED_RUNTIME_SCOPE_FUNCTIONS)
      || JSON.stringify(inventory.functions.broker) !== JSON.stringify(EXPECTED_BROKER_SCOPE_FUNCTIONS)
      || Number(inventory.functions.publicExecuteCount) !== 0) problems.push('function_privileges');
  if (JSON.stringify(inventory.defaultPrivileges) !== JSON.stringify(EXPECTED_DEFAULT_PRIVILEGES)) problems.push('default_privileges');
  if (Number(inventory.brokerMappingCount) !== 1) problems.push('broker_mapping');
  return { pass: problems.length === 0, problems };
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
    provisioning_inventory: null,
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
    const brokerRole = brokerCredentials(roleName, runtimePassword).role;
    evidence.provisioning_inventory = await collectProvisioningInventory(owner, {
      ownerRole: first.owner,
      runtimeRole: roleName,
      brokerRole
    });
    const provisioningContract = evaluateProvisioningInventory(evidence.provisioning_inventory);
    record('provisioning inventory matches exact least-privilege contract', provisioningContract.pass, {
      contractVersion: evidence.provisioning_inventory.contractVersion,
      problems: provisioningContract.problems
    });

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
    for (const role of [brokerCredentials(roleName, runtimePassword).role, roleName, probeRole]) {
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
