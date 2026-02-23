#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const useDatabaseSSL = process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1';
const { runMigrationsForClient, MIGRATIONS } = require('../db/migrations');

function baseConnectionString() {
  if (process.env.MIGRATION_REHEARSAL_ADMIN_URL) return process.env.MIGRATION_REHEARSAL_ADMIN_URL;
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

async function createDatabase(adminClient, dbName, template = null) {
  if (template) {
    await adminClient.query(`CREATE DATABASE ${quoteIdent(dbName)} TEMPLATE ${quoteIdent(template)}`);
    return;
  }
  await adminClient.query(`CREATE DATABASE ${quoteIdent(dbName)}`);
}

async function collectCounts(client) {
  const tables = ['users', 'media', 'invites', 'app_integrations', 'feature_flags'];
  const counts = {};
  for (const table of tables) {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${quoteIdent(table)}`);
    counts[table] = result.rows[0]?.count || 0;
  }
  return counts;
}

async function maxMigrationVersion(client) {
  const result = await client.query('SELECT COALESCE(MAX(version), 0)::int AS version FROM schema_migrations');
  return result.rows[0]?.version || 0;
}

async function verifyCriticalColumns(client) {
  const checks = [
    ['app_integrations', 'plex_api_url'],
    ['app_integrations', 'plex_library_sections'],
    ['invites', 'revoked'],
    ['invites', 'used_by'],
    ['feature_flags', 'created_at'],
    ['feature_flags', 'updated_by']
  ];
  for (const [table, column] of checks) {
    const r = await client.query(
      'SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2',
      [table, column]
    );
    if (r.rows.length === 0) {
      throw new Error(`Missing ${table}.${column}`);
    }
  }
}

async function seedLegacyFixture(client) {
  await client.query(
    `INSERT INTO users (email, password, name, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING`,
    ['rehearsal-admin@example.com', '$2b$10$legacyfixturehashplaceholder', 'Rehearsal Admin', 'admin']
  );

  const userRes = await client.query('SELECT id FROM users WHERE email = $1 LIMIT 1', ['rehearsal-admin@example.com']);
  const userId = userRes.rows[0]?.id;
  if (!userId) throw new Error('Failed to create fixture user');

  await client.query(
    `INSERT INTO app_integrations (id, tmdb_provider, tmdb_api_url, tmdb_api_key_query_param)
     VALUES (1, 'tmdb', 'https://api.themoviedb.org/3/search/movie', 'api_key')
     ON CONFLICT (id) DO NOTHING`
  );

  await client.query(
    `INSERT INTO invites (email, token, used, revoked, expires_at, created_by)
     VALUES ($1, $2, false, false, NOW() + INTERVAL '7 days', $3)
     ON CONFLICT (token) DO NOTHING`,
    ['rehearsal-invite@example.com', 'rehearsal-token-1', userId]
  );

  await client.query(
    `INSERT INTO media (title, year, format, added_by, notes)
     VALUES ($1, $2, $3, $4, $5)`,
    ['The Matrix', 1999, 'Blu-ray', userId, 'Migration rehearsal fixture']
  );
}

async function main() {
  const runId = Date.now().toString(36);
  const legacyDb = `collectz_rehearsal_legacy_${runId}`;
  const snapshotDb = `collectz_rehearsal_snapshot_${runId}`;
  const rollbackDb = `collectz_rehearsal_rollback_${runId}`;

  const baselineVersion = Number.isFinite(Number(process.env.MIGRATION_BASELINE_VERSION))
    ? Number(process.env.MIGRATION_BASELINE_VERSION)
    : Math.max(...MIGRATIONS.map((m) => m.version)) - 1;

  const latestVersion = Math.max(...MIGRATIONS.map((m) => m.version));
  if (baselineVersion <= 0 || baselineVersion >= latestVersion) {
    throw new Error(`MIGRATION_BASELINE_VERSION must be between 1 and ${latestVersion - 1}`);
  }

  const outputPath = process.env.MIGRATION_REHEARSAL_OUTPUT || path.join('artifacts', 'migration-rehearsal-evidence.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const adminUrl = baseConnectionString();
  const admin = await connect(adminUrl);

  const evidence = {
    generatedAt: new Date().toISOString(),
    baselineVersion,
    latestVersion,
    databases: { legacyDb, snapshotDb, rollbackDb },
    preUpgradeCounts: null,
    postUpgradeCounts: null,
    rollbackCounts: null,
    checks: {}
  };

  try {
    await terminateAndDropDatabase(admin, rollbackDb);
    await terminateAndDropDatabase(admin, snapshotDb);
    await terminateAndDropDatabase(admin, legacyDb);

    await createDatabase(admin, legacyDb);

    const legacyClient = await connect(withDb(adminUrl, legacyDb));
    try {
      await runMigrationsForClient(legacyClient, { maxVersion: baselineVersion });
      await seedLegacyFixture(legacyClient);
      evidence.preUpgradeCounts = await collectCounts(legacyClient);
      evidence.checks.preUpgradeVersion = await maxMigrationVersion(legacyClient);
    } finally {
      await legacyClient.end();
    }

    await createDatabase(admin, snapshotDb, legacyDb);

    const upgradeClient = await connect(withDb(adminUrl, legacyDb));
    try {
      await runMigrationsForClient(upgradeClient);
      await verifyCriticalColumns(upgradeClient);
      evidence.postUpgradeCounts = await collectCounts(upgradeClient);
      evidence.checks.postUpgradeVersion = await maxMigrationVersion(upgradeClient);
    } finally {
      await upgradeClient.end();
    }

    await createDatabase(admin, rollbackDb, snapshotDb);
    const rollbackClient = await connect(withDb(adminUrl, rollbackDb));
    try {
      evidence.rollbackCounts = await collectCounts(rollbackClient);
      evidence.checks.rollbackVersion = await maxMigrationVersion(rollbackClient);
    } finally {
      await rollbackClient.end();
    }

    const countsMatch = JSON.stringify(evidence.preUpgradeCounts) === JSON.stringify(evidence.rollbackCounts);
    evidence.checks.rollbackCountsMatchPreUpgrade = countsMatch;
    evidence.checks.rollbackVersionMatchesBaseline = evidence.checks.rollbackVersion === baselineVersion;

    if (!countsMatch) {
      throw new Error('Rollback rehearsal counts do not match pre-upgrade counts');
    }
    if (!evidence.checks.rollbackVersionMatchesBaseline) {
      throw new Error(`Rollback version mismatch: expected ${baselineVersion}, got ${evidence.checks.rollbackVersion}`);
    }

    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(`Migration rehearsal completed. Evidence written to ${outputPath}`);
  } finally {
    try { await terminateAndDropDatabase(admin, rollbackDb); } catch (_) {}
    try { await terminateAndDropDatabase(admin, snapshotDb); } catch (_) {}
    try { await terminateAndDropDatabase(admin, legacyDb); } catch (_) {}
    await admin.end();
  }
}

main().catch((error) => {
  console.error('Migration rehearsal failed:', error.message);
  process.exit(1);
});
