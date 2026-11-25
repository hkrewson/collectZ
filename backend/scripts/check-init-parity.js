#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const { runMigrationsForClient, getExpectedMigrationVersion } = require('../db/migrations');

const useDatabaseSSL = process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1';

function baseConnectionString() {
  if (process.env.MIGRATION_AUTHORITY_ADMIN_URL) return process.env.MIGRATION_AUTHORITY_ADMIN_URL;
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
  const relations = await client.query(
    `SELECT n.nspname AS schema_name,
            c.relname AS relation_name,
            CASE c.relkind
              WHEN 'r' THEN 'table'
              WHEN 'p' THEN 'partitioned_table'
              WHEN 'v' THEN 'view'
              WHEN 'm' THEN 'materialized_view'
              WHEN 'S' THEN 'sequence'
              WHEN 'f' THEN 'foreign_table'
              ELSE c.relkind::text
            END AS relation_kind
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'collectz_scope')
       AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
     ORDER BY n.nspname, c.relname`
  );

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

  const constraints = await client.query(
    `SELECT n.nspname AS schema_name,
            c.relname AS table_name,
            con.conname AS constraint_name,
            con.contype AS constraint_type,
            con.condeferrable AS deferrable,
            con.condeferred AS initially_deferred,
            con.convalidated AS validated,
            pg_get_constraintdef(con.oid, true) AS definition
     FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'collectz_scope')
     ORDER BY n.nspname, c.relname, con.conname`
  );

  const triggers = await client.query(
    `SELECT n.nspname AS schema_name,
            c.relname AS table_name,
            t.tgname AS trigger_name,
            pg_get_triggerdef(t.oid, true) AS definition
     FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'collectz_scope')
       AND NOT t.tgisinternal
     ORDER BY n.nspname, c.relname, t.tgname`
  );

  const functions = await client.query(
    `SELECT n.nspname AS schema_name,
            p.proname AS function_name,
            pg_get_function_identity_arguments(p.oid) AS identity_arguments,
            pg_get_functiondef(p.oid) AS definition
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'collectz_scope')
       AND p.prokind IN ('f', 'p')
     ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)`
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

  const bootstrapRows = await client.query(
    `SELECT 'app_integrations' AS source, id::text AS key, '' AS value
     FROM app_integrations
     UNION ALL
     SELECT 'app_settings', id::text, ''
     FROM app_settings
     UNION ALL
     SELECT 'collectible_categories', key, concat_ws(':', label, sort_order::text)
     FROM collectible_categories
     ORDER BY source, key`
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
      'external_media_identity_events',
      'canonical_media_field_controls',
      'provider_integration_bindings',
      'provider_sync_targets',
      'provider_series_records',
      'provider_source_observations',
      'provider_observation_field_reviews',
      'provider_observation_apply_events',
      'media_series_memberships',
      'media_review_decisions',
      'media_merge_recommendation_feedback',
      'event_exclusive_sources',
      'object_relationships',
      'sync_jobs'
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
    relations: relations.rows,
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
    constraints: constraints.rows.map((r) => ({
      schema: r.schema_name,
      table: r.table_name,
      name: r.constraint_name,
      type: r.constraint_type,
      deferrable: r.deferrable,
      initiallyDeferred: r.initially_deferred,
      validated: r.validated,
      definition: normalizeSql(r.definition)
    })),
    triggers: triggers.rows.map((r) => ({
      schema: r.schema_name,
      table: r.table_name,
      name: r.trigger_name,
      definition: normalizeSql(r.definition)
    })),
    functions: functions.rows.map((r) => ({
      schema: r.schema_name,
      name: r.function_name,
      arguments: normalizeSql(r.identity_arguments),
      definition: normalizeSql(r.definition)
    })),
    scopeSecurity: scopeSecurity.rows.map(r => ({ ...r, definition: normalizeSql(r.definition) })),
    migrations: migrationRows.rows,
    featureFlags: featureFlags.rows,
    bootstrapRows: bootstrapRows.rows
  };
}

function fingerprintCounts(fingerprint) {
  return Object.fromEntries(
    Object.entries(fingerprint).map(([key, rows]) => [key, Array.isArray(rows) ? rows.length : 0])
  );
}

async function main() {
  const runId = Date.now().toString(36);
  const authorityDb = `collectz_migration_authority_${runId}`;
  const outputPath = process.env.MIGRATION_AUTHORITY_OUTPUT
    || process.env.INIT_PARITY_OUTPUT
    || path.join('artifacts', 'init-parity-evidence.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const adminUrl = baseConnectionString();
  const retiredInitSqlPath = path.resolve(__dirname, '../../init.sql');

  const admin = await connect(adminUrl);
  try {
    await terminateAndDropDatabase(admin, authorityDb);
    await createDatabase(admin, authorityDb);

    const migrationClient = await connect(withDb(adminUrl, authorityDb));
    try {
      await runMigrationsForClient(migrationClient);
    } finally {
      await migrationClient.end();
    }

    const verifyClient = await connect(withDb(adminUrl, authorityDb));
    let fingerprint;
    try {
      fingerprint = await schemaFingerprint(verifyClient);
    } finally {
      await verifyClient.end();
    }

    const expectedMigrationVersion = getExpectedMigrationVersion();
    const appliedMigrationVersion = fingerprint.migrations.reduce(
      (max, migration) => Math.max(max, Number(migration.version || 0)),
      0
    );
    const appliedVersions = fingerprint.migrations.map(({ version }) => Number(version));
    const expectedVersions = Array.from({ length: expectedMigrationVersion }, (_, index) => index + 1);
    const counts = fingerprintCounts(fingerprint);
    const inventoryCategories = [
      'relations',
      'columns',
      'indexes',
      'constraints',
      'triggers',
      'functions',
      'scopeSecurity',
      'migrations',
      'featureFlags',
      'bootstrapRows'
    ];
    const authorityChecks = [
      {
        id: 'migration_chain_reaches_expected_version',
        pass: appliedMigrationVersion === expectedMigrationVersion,
        expected: expectedMigrationVersion,
        actual: appliedMigrationVersion
      },
      {
        id: 'migration_chain_contains_every_version',
        pass: JSON.stringify(appliedVersions) === JSON.stringify(expectedVersions),
        expectedCount: expectedVersions.length,
        actualCount: appliedVersions.length
      },
      {
        id: 'migration_authority_inventory_is_complete',
        pass: inventoryCategories.every((category) => Number(counts[category]) > 0),
        categories: inventoryCategories,
        counts
      },
      {
        id: 'migration_authority_bootstrap_state_is_present',
        pass: fingerprint.featureFlags.length === 8 && fingerprint.bootstrapRows.length === 10,
        featureFlagCount: fingerprint.featureFlags.length,
        bootstrapRowCount: fingerprint.bootstrapRows.length
      },
      {
        id: 'hand_maintained_init_sql_is_retired',
        pass: !fs.existsSync(retiredInitSqlPath),
        retiredPath: 'init.sql'
      }
    ];
    const failedAuthorityChecks = authorityChecks.filter((check) => !check.pass);
    const evidence = {
      generatedAt: new Date().toISOString(),
      status: failedAuthorityChecks.length === 0 ? 'passed' : 'failed',
      certificationMode: 'migration_chain_authority_after_init_sql_retirement',
      authority: {
        source: 'append_only_migration_chain',
        database: authorityDb,
        expectedMigrationVersion,
        appliedMigrationVersion,
        fingerprintCounts: counts
      },
      reference: {
        source: 'init.sql',
        status: 'retired',
        present: fs.existsSync(retiredInitSqlPath)
      },
      authorityChecks
    };

    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

    if (failedAuthorityChecks.length > 0) {
      console.error('Migration-chain fresh-install authority check failed');
      for (const check of failedAuthorityChecks) console.error(`- ${check.id}`);
      process.exit(1);
    }

    console.log(`Migration-chain authority passed after init.sql retirement. Evidence written to ${outputPath}`);
  } finally {
    try { await terminateAndDropDatabase(admin, authorityDb); } catch (_) {}
    await admin.end();
  }
}

main().catch((error) => {
  console.error('Migration-chain fresh-install authority check failed:', error.message);
  process.exit(1);
});
