'use strict';

const { getExpectedMigrationVersion } = require('./migrations');
const { inspectRuntimeRole, evaluateRuntimeRolePrivileges } = require('./runtimeRole');
const { getProductEdition } = require('../config/productEdition');

const CERTIFICATION_MODE = 'migration_built_runtime_authority';
const AUTHORITY_SOURCE = 'append_only_migration_chain';

async function certifyMigrationBuiltRuntime(client, options = {}) {
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
  const emptyDatabaseBeforeMigrate = options.emptyDatabaseBeforeMigrate === true;
  const migrationsMode = String(options.migrationsMode || '').trim().toLowerCase();

  const checks = [
    {
      id: 'empty_database_observed_before_migrate',
      pass: emptyDatabaseBeforeMigrate
    },
    {
      id: 'runtime_uses_external_migration_mode',
      pass: migrationsMode === 'external',
      actual: migrationsMode || 'unset'
    },
    {
      id: 'migration_chain_reaches_expected_version',
      pass: appliedMigrationVersion === expectedMigrationVersion,
      expected: expectedMigrationVersion,
      actual: appliedMigrationVersion
    },
    {
      id: 'migration_chain_contains_every_version',
      pass: everyMigrationApplied,
      expected: expectedMigrationVersion,
      actual: versions.length
    },
    {
      id: 'required_bootstrap_rows_present',
      pass: Number(bootstrap.feature_flags) === 8
        && Number(bootstrap.collectible_categories) === 8
        && Number(bootstrap.app_integrations) === 1
        && Number(bootstrap.app_settings) === 1,
      counts: bootstrap
    },
    {
      id: 'runtime_credential_is_non_owner',
      pass: runtimeEvaluation.ok,
      violations: runtimeEvaluation.violations
    }
  ];

  return {
    generatedAt: new Date().toISOString(),
    status: checks.every((check) => check.pass) ? 'passed' : 'failed',
    certificationMode: CERTIFICATION_MODE,
    authority: {
      source: AUTHORITY_SOURCE,
      databaseOrigin: 'empty_database',
      expectedMigrationVersion,
      appliedMigrationVersion,
      appliedMigrationCount: versions.length,
      everyMigrationApplied
    },
    runtime: {
      role: 'ephemeral_or_runtime_credential_redacted',
      nonOwner: runtimeEvaluation.ok,
      migrationsMode,
      edition: getProductEdition()
    },
    bootstrap: {
      featureFlags: Number(bootstrap.feature_flags),
      collectibleCategories: Number(bootstrap.collectible_categories),
      appIntegrations: Number(bootstrap.app_integrations),
      appSettings: Number(bootstrap.app_settings)
    },
    checks
  };
}

module.exports = {
  CERTIFICATION_MODE,
  AUTHORITY_SOURCE,
  certifyMigrationBuiltRuntime
};
