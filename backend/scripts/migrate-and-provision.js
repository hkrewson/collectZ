#!/usr/bin/env node
'use strict';

/**
 * One-shot migration and runtime-role provisioning job.
 *
 * Runs with the schema-owner credential (DATABASE_MIGRATION_URL, falling back
 * to DATABASE_URL), applies pending migrations, provisions the non-owner
 * runtime role, then connects as that role to prove it can reach the schema
 * and passes the runtime privilege guard. Exits non-zero on any failure so the
 * backend (which depends on successful completion) never starts against an
 * un-migrated schema or an unverified runtime credential.
 *
 * Environment:
 *   DATABASE_MIGRATION_URL   owner connection string (preferred)
 *   DATABASE_URL             fallback owner connection string
 *   DATABASE_SSL             true/1 to enable TLS (rejectUnauthorized=false)
 *   DB_RUNTIME_USER          runtime role name (default collectz_app)
 *   DB_RUNTIME_PASSWORD      runtime role password (required unless
 *                            DB_RUNTIME_PROVISION=false)
 *   DB_RUNTIME_PROVISION     set false to skip provisioning (migrations only)
 */

const { Client } = require('pg');
const { runMigrationsForClient, assertSchemaCurrent } = require('../db/migrations');
const {
  normalizeRuntimeRoleName,
  validateRuntimePassword,
  provisionRuntimeRole,
  assertRuntimeRolePolicy
} = require('../db/runtimeRole');

const useDatabaseSSL = process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1';
const ssl = useDatabaseSSL ? { rejectUnauthorized: false } : false;

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase().trim());
}

function buildRuntimeConnectionString(ownerUrl, roleName, password) {
  const parsed = new URL(ownerUrl);
  parsed.username = encodeURIComponent(roleName);
  parsed.password = encodeURIComponent(password);
  return parsed.toString();
}

async function main() {
  const ownerUrl = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (!ownerUrl) {
    throw new Error('DATABASE_MIGRATION_URL (or DATABASE_URL) is required for the migration job.');
  }
  const provision = parseBoolean(process.env.DB_RUNTIME_PROVISION, true);
  const roleName = normalizeRuntimeRoleName(process.env.DB_RUNTIME_USER);
  const password = provision ? validateRuntimePassword(process.env.DB_RUNTIME_PASSWORD) : null;

  const owner = new Client({ connectionString: ownerUrl, ssl });
  await owner.connect();
  try {
    await runMigrationsForClient(owner);
    if (provision) {
      const result = await provisionRuntimeRole(owner, { roleName, password });
      console.log(
        `Runtime role "${result.roleName}" ${result.created ? 'created' : 'updated'} ` +
        `(owner "${result.owner}", database "${result.database}").`
      );
    } else {
      console.warn('DB_RUNTIME_PROVISION=false: skipped runtime role provisioning.');
    }
  } finally {
    await owner.end();
  }

  if (!provision) return;

  const runtime = new Client({ connectionString: buildRuntimeConnectionString(ownerUrl, roleName, password), ssl });
  await runtime.connect();
  try {
    await assertSchemaCurrent(runtime);
    await assertRuntimeRolePolicy(runtime, { policy: 'enforce' });
  } finally {
    await runtime.end();
  }
  console.log('Migration and runtime role provisioning completed.');
}

main().catch((error) => {
  console.error(`Migration job failed: ${error.message}`);
  process.exit(1);
});
