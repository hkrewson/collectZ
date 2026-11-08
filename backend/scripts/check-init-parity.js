#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const { runMigrationsForClient } = require('../db/migrations');

const useDatabaseSSL = process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1';

function baseConnectionString() {
  if (process.env.INIT_PARITY_ADMIN_URL) return process.env.INIT_PARITY_ADMIN_URL;
  if (process.env.DATABASE_URL) {
    const parsed = new URL(process.env.DATABASE_URL);
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

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function normalizeSql(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();
}

async function connect(connectionString) {
  const client = new Client({
    connectionString,
    ssl: useDatabaseSSL ? { rejectUnauthorized: false } : false
  });
  await client.connect();
  return client;
}

async function terminateAndDropDatabase(adminClient, dbName) {
  await adminClient.query(
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = $1
       AND pid <> pg_backend_pid()`,
    [dbName]
  );
  await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdent(dbName)}`);
}

async function createDatabase(adminClient, dbName) {
  await adminClient.query(`CREATE DATABASE ${quoteIdent(dbName)}`);
}

async function schemaFingerprint(client) {
  const columns = await client.query(
    `SELECT table_name, column_name, ordinal_position, data_type, udt_name, is_nullable,
            COALESCE(column_default, '') AS column_default
     FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position`
  );

  const indexes = await client.query(
    `SELECT tablename, indexname, indexdef
     FROM pg_indexes
     WHERE schemaname = 'public'
     ORDER BY tablename, indexname`
  );

  const triggers = await client.query(
    `SELECT event_object_table AS table_name, trigger_name
     FROM information_schema.triggers
     WHERE trigger_schema = 'public'
     ORDER BY event_object_table, trigger_name`
  );

  const migrationRows = await client.query(
    `SELECT version, description
     FROM schema_migrations
     ORDER BY version`
  );

  const featureFlags = await client.query(
    `SELECT key, enabled, description
     FROM feature_flags
     ORDER BY key`
  );

  const scopeSecurity = await client.query(`
    SELECT 'table' AS kind, n.nspname || '.' || c.relname AS name,
      c.relrowsecurity::text || ':' || c.relforcerowsecurity::text AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='collectz_scope' OR (n.nspname='public' AND c.relname IN (
      'saved_library_views',
      'provider_connections',
      'provider_connection_credentials',
      'external_media_identities',
      'external_media_identity_events'
    ))
    UNION ALL
    SELECT 'policy', schemaname || '.' || tablename || '.' || policyname,
      concat_ws(':', permissive, roles::text, cmd, qual, with_check)
    FROM pg_policies WHERE schemaname IN ('public','collectz_scope')
    UNION ALL
    SELECT 'function', n.nspname || '.' || p.proname, pg_get_functiondef(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='collectz_scope'
    ORDER BY kind, name`);

  return {
    columns: columns.rows.map((r) => ({
      table: r.table_name,
      column: r.column_name,
      dataType: r.data_type,
      udt: r.udt_name,
      nullable: r.is_nullable,
      default: normalizeSql(r.column_default)
    })),
    indexes: indexes.rows.map((r) => ({
      table: r.tablename,
      name: r.indexname,
      def: normalizeSql(r.indexdef)
    })),
    triggers: triggers.rows.map((r) => ({
      table: r.table_name,
      name: r.trigger_name
    })),
    scopeSecurity: scopeSecurity.rows.map(r => ({ ...r, definition: normalizeSql(r.definition) })),
    migrations: migrationRows.rows,
    featureFlags: featureFlags.rows
  };
}

function diffRows(label, left = [], right = []) {
  const leftSet = new Set(left.map((row) => JSON.stringify(row)));
  const rightSet = new Set(right.map((row) => JSON.stringify(row)));
  const onlyLeft = [...leftSet].filter((v) => !rightSet.has(v)).map((v) => JSON.parse(v));
  const onlyRight = [...rightSet].filter((v) => !leftSet.has(v)).map((v) => JSON.parse(v));
  return {
    label,
    onlyInitSql: onlyLeft,
    onlyMigrations: onlyRight,
    matches: onlyLeft.length === 0 && onlyRight.length === 0
  };
}

async function main() {
  const runId = Date.now().toString(36);
  const initDb = `collectz_init_parity_init_${runId}`;
  const migDb = `collectz_init_parity_mig_${runId}`;
  const outputPath = process.env.INIT_PARITY_OUTPUT || path.join('artifacts', 'init-parity-evidence.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const adminUrl = baseConnectionString();
  const initSqlPath = process.env.INIT_SQL_PATH
    ? path.resolve(process.env.INIT_SQL_PATH)
    : path.resolve(__dirname, '../../init.sql');
  const initSql = fs.readFileSync(initSqlPath, 'utf8');

  const admin = await connect(adminUrl);
  try {
    await terminateAndDropDatabase(admin, initDb);
    await terminateAndDropDatabase(admin, migDb);

    await createDatabase(admin, initDb);
    await createDatabase(admin, migDb);

    const initClient = await connect(withDb(adminUrl, initDb));
    try {
      await initClient.query(initSql);
    } finally {
      await initClient.end();
    }

    const migClient = await connect(withDb(adminUrl, migDb));
    try {
      await runMigrationsForClient(migClient);
    } finally {
      await migClient.end();
    }

    const initVerify = await connect(withDb(adminUrl, initDb));
    const migVerify = await connect(withDb(adminUrl, migDb));
    let initFp;
    let migFp;
    try {
      initFp = await schemaFingerprint(initVerify);
      migFp = await schemaFingerprint(migVerify);
    } finally {
      await initVerify.end();
      await migVerify.end();
    }

    const diffs = [
      diffRows('columns', initFp.columns, migFp.columns),
      diffRows('indexes', initFp.indexes, migFp.indexes),
      diffRows('triggers', initFp.triggers, migFp.triggers),
      diffRows('scope_security', initFp.scopeSecurity, migFp.scopeSecurity),
      diffRows('migrations', initFp.migrations, migFp.migrations),
      diffRows('feature_flags', initFp.featureFlags, migFp.featureFlags)
    ];

    const mismatches = diffs.filter((d) => !d.matches);
    const evidence = {
      generatedAt: new Date().toISOString(),
      initSqlPath,
      initDb,
      migDb,
      checks: diffs,
      mismatchCount: mismatches.length
    };

    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

    if (mismatches.length > 0) {
      console.error('init.sql parity check failed: schema drift detected');
      for (const mismatch of mismatches) {
        console.error(`- ${mismatch.label}: init-only=${mismatch.onlyInitSql.length}, migration-only=${mismatch.onlyMigrations.length}`);
      }
      process.exit(1);
    }

    console.log(`init.sql parity check passed. Evidence written to ${outputPath}`);
  } finally {
    try { await terminateAndDropDatabase(admin, initDb); } catch (_) {}
    try { await terminateAndDropDatabase(admin, migDb); } catch (_) {}
    await admin.end();
  }
}

main().catch((error) => {
  console.error('init.sql parity check failed:', error.message);
  process.exit(1);
});
