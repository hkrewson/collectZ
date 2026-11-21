'use strict';

const { getExpectedMigrationVersion } = require('./migrations');
const { inspectRuntimeRole, evaluateRuntimeRolePrivileges } = require('./runtimeRole');
const { getProductEdition } = require('../config/productEdition');

const CERTIFICATION_MODE = 'migration_built_runtime_authority';
const RESTORED_CERTIFICATION_MODE = 'restored_migration_built_runtime_authority';
const AUTHORITY_SOURCE = 'append_only_migration_chain';

async function collectRuntimeAuthorityFacts(client) {
  const expectedMigrationVersion = getExpectedMigrationVersion();
  const migrationResult = await client.query(
    'SELECT version FROM schema_migrations ORDER BY version'
  );
  const versions = migrationResult.rows.map((row) => Number(row.version));
  const appliedMigrationVersion = versions.length > 0 ? versions[versions.length - 1] : 0;
  const expectedVersions = Array.from({ length: expectedMigrationVersion }, (_value, index) => index + 1);
  const everyMigrationApplied = versions.length === expectedVersions.length
    && versions.every((version, index) => version === expectedVersions[index]);

  const bootstrapResult = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM feature_flags) AS feature_flags,
       (SELECT COUNT(*)::int FROM collectible_categories) AS collectible_categories,
       (SELECT COUNT(*)::int FROM app_integrations) AS app_integrations,
       (SELECT COUNT(*)::int FROM app_settings) AS app_settings`
  );
  const bootstrap = bootstrapResult.rows[0];
  const runtimeFacts = await inspectRuntimeRole(client);
  const runtimeEvaluation = evaluateRuntimeRolePrivileges(runtimeFacts);

  return {
    expectedMigrationVersion,
    versions,
    appliedMigrationVersion,
    everyMigrationApplied,
    bootstrap,
    runtimeEvaluation
  };
}

function commonChecks(facts, migrationsMode) {
  return [
    {
      id: 'runtime_uses_external_migration_mode',
      pass: migrationsMode === 'external',
      actual: migrationsMode || 'unset'
    },
    {
      id: 'migration_chain_reaches_expected_version',
      pass: facts.appliedMigrationVersion === facts.expectedMigrationVersion,
      expected: facts.expectedMigrationVersion,
      actual: facts.appliedMigrationVersion
    },
    {
      id: 'migration_chain_contains_every_version',
      pass: facts.everyMigrationApplied,
      expected: facts.expectedMigrationVersion,
      actual: facts.versions.length
    },
    {
      id: 'required_bootstrap_rows_present',
      pass: Number(facts.bootstrap.feature_flags) === 8
        && Number(facts.bootstrap.collectible_categories) === 8
        && Number(facts.bootstrap.app_integrations) === 1
        && Number(facts.bootstrap.app_settings) === 1,
      counts: facts.bootstrap
    },
    {
      id: 'runtime_credential_is_non_owner',
      pass: facts.runtimeEvaluation.ok,
      violations: facts.runtimeEvaluation.violations
    }
  ];
}

function bootstrapEvidence(bootstrap) {
  return {
    featureFlags: Number(bootstrap.feature_flags),
    collectibleCategories: Number(bootstrap.collectible_categories),
    appIntegrations: Number(bootstrap.app_integrations),
    appSettings: Number(bootstrap.app_settings)
  };
}

async function certifyMigrationBuiltRuntime(client, options = {}) {
  const facts = await collectRuntimeAuthorityFacts(client);
  const emptyDatabaseBeforeMigrate = options.emptyDatabaseBeforeMigrate === true;
  const migrationsMode = String(options.migrationsMode || '').trim().toLowerCase();

  const checks = [
    {
      id: 'empty_database_observed_before_migrate',
      pass: emptyDatabaseBeforeMigrate
    },
    ...commonChecks(facts, migrationsMode)
  ];

  return {
    generatedAt: new Date().toISOString(),
    status: checks.every((check) => check.pass) ? 'passed' : 'failed',
    certificationMode: CERTIFICATION_MODE,
    authority: {
      source: AUTHORITY_SOURCE,
      databaseOrigin: 'empty_database',
      expectedMigrationVersion: facts.expectedMigrationVersion,
      appliedMigrationVersion: facts.appliedMigrationVersion,
      appliedMigrationCount: facts.versions.length,
      everyMigrationApplied: facts.everyMigrationApplied
    },
    runtime: {
      role: 'ephemeral_or_runtime_credential_redacted',
      nonOwner: facts.runtimeEvaluation.ok,
      migrationsMode,
      edition: getProductEdition()
    },
    bootstrap: bootstrapEvidence(facts.bootstrap),
    checks
  };
}

async function certifyRestoredMigrationBuiltRuntime(client, options = {}) {
  const facts = await collectRuntimeAuthorityFacts(client);
  const migrationsMode = String(options.migrationsMode || '').trim().toLowerCase();
  const restoreMethod = String(options.restoreMethod || '').trim().toLowerCase();
  const sourceDatabaseOrigin = String(options.sourceDatabaseOrigin || '').trim().toLowerCase();
  const restoredFromMigrationBuiltSnapshot = options.restoredFromMigrationBuiltSnapshot === true;

  const checks = [
    {
      id: 'restore_observed_from_migration_built_snapshot',
      pass: restoredFromMigrationBuiltSnapshot
    },
    {
      id: 'restore_uses_database_native_snapshot',
      pass: restoreMethod === 'postgresql_template_snapshot',
      actual: restoreMethod || 'unset'
    },
    {
      id: 'source_database_origin_was_empty_database',
      pass: sourceDatabaseOrigin === 'empty_database',
      actual: sourceDatabaseOrigin || 'unset'
    },
    ...commonChecks(facts, migrationsMode)
  ];

  return {
    generatedAt: new Date().toISOString(),
    status: checks.every((check) => check.pass) ? 'passed' : 'failed',
    certificationMode: RESTORED_CERTIFICATION_MODE,
    authority: {
      source: AUTHORITY_SOURCE,
      databaseOrigin: 'restored_migration_built_snapshot',
      sourceDatabaseOrigin,
      restoreMethod,
      expectedMigrationVersion: facts.expectedMigrationVersion,
      appliedMigrationVersion: facts.appliedMigrationVersion,
      appliedMigrationCount: facts.versions.length,
      everyMigrationApplied: facts.everyMigrationApplied
    },
    runtime: {
      role: 'ephemeral_or_runtime_credential_redacted',
      nonOwner: facts.runtimeEvaluation.ok,
      migrationsMode,
      edition: getProductEdition()
    },
    bootstrap: bootstrapEvidence(facts.bootstrap),
    checks
  };
}

module.exports = {
  CERTIFICATION_MODE,
  RESTORED_CERTIFICATION_MODE,
  AUTHORITY_SOURCE,
  certifyMigrationBuiltRuntime,
  certifyRestoredMigrationBuiltRuntime
};
