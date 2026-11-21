#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const { certifyMigrationBuiltRuntime } = require('../db/migrationAuthority');

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

async function main() {
  const outputPath = path.resolve(
    process.env.RUNTIME_MIGRATION_AUTHORITY_OUTPUT
      || path.join('artifacts', 'runtime-migration-authority-evidence.json')
  );
  const client = await pool.connect();
  let evidence;
  try {
    evidence = await certifyMigrationBuiltRuntime(client, {
      emptyDatabaseBeforeMigrate: parseBoolean(process.env.RUNTIME_AUTHORITY_EMPTY_DATABASE_PROOF),
      migrationsMode: process.env.DATABASE_MIGRATIONS_MODE
    });
  } finally {
    client.release();
    await pool.end();
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });
  const failed = evidence.checks.filter((check) => !check.pass);
  console.log(
    `Runtime migration authority ${evidence.status}: `
    + `${evidence.checks.length - failed.length}/${evidence.checks.length} checks through migration `
    + `${evidence.authority.appliedMigrationVersion}. Evidence written to ${outputPath}`
  );
  if (failed.length > 0) {
    for (const check of failed) console.error(`  FAIL ${check.id}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Runtime migration authority failed: ${error.message}`);
  process.exit(1);
});
