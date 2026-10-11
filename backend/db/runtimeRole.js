'use strict';

/**
 * Non-owner runtime database role support.
 *
 * The migration/provisioning job connects with the schema-owner credential,
 * applies migrations, then calls provisionRuntimeRole() to create or update a
 * least-privilege login role for the long-lived backend. The backend calls
 * inspectRuntimeRole()/evaluateRuntimeRolePrivileges() at startup and refuses
 * to run with an owner, superuser, or RLS-bypassing credential when the policy
 * is `enforce`.
 *
 * The runtime password is never interpolated into SQL as plaintext: the
 * provisioner sends a SCRAM-SHA-256 verifier computed client-side, which is the
 * same stored form PostgreSQL itself keeps in pg_authid.
 */

const crypto = require('crypto');

const DEFAULT_RUNTIME_ROLE = 'collectz_app';
const ROLE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const RESERVED_ROLE_NAMES = new Set(['postgres', 'public', 'pg_database_owner']);
const MIN_RUNTIME_PASSWORD_LENGTH = 16;
const SCRAM_ITERATIONS = 4096;
const RUNTIME_ROLE_POLICIES = new Set(['enforce', 'warn', 'off']);

function normalizeRuntimeRoleName(value) {
  const name = String(value || DEFAULT_RUNTIME_ROLE).trim();
  if (!ROLE_NAME_PATTERN.test(name)) {
    throw new Error(
      'DB_RUNTIME_USER must be a lowercase PostgreSQL identifier (letters, digits, underscore; max 63 characters).'
    );
  }
  if (RESERVED_ROLE_NAMES.has(name) || name.startsWith('pg_')) {
    throw new Error(`DB_RUNTIME_USER "${name}" is a reserved PostgreSQL role name.`);
  }
  return name;
}

function validateRuntimePassword(value) {
  const password = String(value || '');
  if (password.length < MIN_RUNTIME_PASSWORD_LENGTH) {
    throw new Error(`DB_RUNTIME_PASSWORD must be at least ${MIN_RUNTIME_PASSWORD_LENGTH} characters.`);
  }
  // Restrict to URL-unreserved ASCII: the value is embedded unencoded in
  // Compose connection strings, and ASCII keeps the client-side SCRAM verifier
  // identical to the server's SASLprep normalization.
  if (!/^[A-Za-z0-9._~-]+$/.test(password)) {
    throw new Error('DB_RUNTIME_PASSWORD may contain only letters, digits, and . _ ~ - (use a hex or base64url secret).');
  }
  return password;
}

function buildScramSha256Verifier(password, options = {}) {
  const salt = options.salt || crypto.randomBytes(16);
  const iterations = options.iterations || SCRAM_ITERATIONS;
  const salted = crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256');
  const clientKey = crypto.createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = crypto.createHash('sha256').update(clientKey).digest();
  const serverKey = crypto.createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizeRuntimeRolePolicy(value, fallback = 'warn') {
  const policy = String(value || '').trim().toLowerCase();
  if (!policy) return fallback;
  if (!RUNTIME_ROLE_POLICIES.has(policy)) {
    throw new Error('DATABASE_RUNTIME_ROLE_POLICY must be one of: enforce, warn, off.');
  }
  return policy;
}

/**
 * Create or update the runtime role and its grants. Must be called with a
 * client connected as the schema owner (the migration credential).
 */
async function provisionRuntimeRole(client, options = {}) {
  const roleName = normalizeRuntimeRoleName(options.roleName);
  const password = validateRuntimePassword(options.password);
  const schema = options.schema || 'public';

  const ownerResult = await client.query(
    `SELECT current_user AS owner,
            current_database() AS database,
            r.rolsuper AS owner_is_superuser,
            r.rolcreaterole AS owner_can_create_roles
     FROM pg_roles r
     WHERE r.rolname = current_user`
  );
  const owner = ownerResult.rows[0];
  if (owner.owner === roleName) {
    throw new Error('DB_RUNTIME_USER must differ from the migration/owner role (DB_USER).');
  }

  const existing = await client.query('SELECT oid FROM pg_roles WHERE rolname = $1', [roleName]);
  const created = existing.rowCount === 0;
  if (created && !owner.owner_is_superuser && !owner.owner_can_create_roles) {
    throw new Error(
      `Runtime role "${roleName}" does not exist and the migration role cannot create roles. ` +
      'Create the role out of band or grant CREATEROLE to the migration role.'
    );
  }

  const verifier = buildScramSha256Verifier(password);
  const attributes = ['LOGIN', 'INHERIT', 'NOCREATEDB', 'NOCREATEROLE'];
  if (owner.owner_is_superuser) {
    attributes.push('NOSUPERUSER', 'NOREPLICATION', 'NOBYPASSRLS');
  }
  const role = quoteIdent(roleName);
  const ownerRole = quoteIdent(owner.owner);
  const schemaIdent = quoteIdent(schema);
  const database = quoteIdent(owner.database);

  await client.query('BEGIN');
  try {
    await client.query(
      `${created ? 'CREATE' : 'ALTER'} ROLE ${role} WITH ${attributes.join(' ')} PASSWORD ${quoteLiteral(verifier)}`
    );

    // Remove any membership that would let the runtime role inherit owner rights.
    const memberships = await client.query(
      `SELECT g.rolname AS granted_role
       FROM pg_auth_members m
       JOIN pg_roles g ON g.oid = m.roleid
       JOIN pg_roles u ON u.oid = m.member
       WHERE u.rolname = $1`,
      [roleName]
    );
    for (const row of memberships.rows) {
      await client.query(`REVOKE ${quoteIdent(row.granted_role)} FROM ${role}`);
    }

    await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
    await client.query(`REVOKE CREATE ON DATABASE ${database} FROM ${role}`);
    await client.query(`REVOKE CREATE ON SCHEMA ${schemaIdent} FROM PUBLIC`);
    await client.query(`REVOKE CREATE ON SCHEMA ${schemaIdent} FROM ${role}`);
    await client.query(`GRANT USAGE ON SCHEMA ${schemaIdent} TO ${role}`);

    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${schemaIdent} FROM ${role}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schemaIdent} TO ${role}`);
    await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schemaIdent} FROM ${role}`);
    await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${schemaIdent} TO ${role}`);

    const migrationsTable = await client.query(
      `SELECT to_regclass($1) IS NOT NULL AS present`,
      [`${schema}.schema_migrations`]
    );
    if (migrationsTable.rows[0].present) {
      await client.query(`REVOKE INSERT, UPDATE, DELETE ON ${schemaIdent}.schema_migrations FROM ${role}`);
    }

    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA ${schemaIdent}
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA ${schemaIdent}
       GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${role}`
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(`Runtime role provisioning failed and was rolled back: ${error.message}`);
  }

  return { roleName, owner: owner.owner, database: owner.database, created };
}

/**
 * Read the privilege facts for the currently connected role. Safe to call with
 * any credential; returns booleans and counts only.
 */
async function inspectRuntimeRole(client, options = {}) {
  const schema = options.schema || 'public';
  const result = await client.query(
    `SELECT current_user AS role_name,
            r.rolsuper AS is_superuser,
            r.rolcreaterole AS can_create_roles,
            r.rolcreatedb AS can_create_databases,
            r.rolreplication AS has_replication,
            r.rolbypassrls AS bypasses_rls,
            has_database_privilege(current_database(), 'CREATE') AS can_create_in_database,
            has_schema_privilege($1, 'CREATE') AS can_create_in_schema,
            (SELECT count(*)::int
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                AND n.nspname NOT LIKE 'pg_toast%'
                AND n.nspname NOT LIKE 'pg_temp%'
                AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
                AND pg_has_role(current_user, c.relowner, 'USAGE')) AS owned_relation_count,
            (SELECT count(*)::int
               FROM pg_auth_members m
               JOIN pg_roles g ON g.oid = m.roleid
              WHERE m.member = r.oid
                AND (g.rolsuper OR g.rolbypassrls OR g.rolcreaterole OR g.rolcreatedb
                     OR g.rolname IN ('pg_write_all_data', 'pg_read_all_data', 'pg_database_owner'))) AS privileged_membership_count
     FROM pg_roles r
     WHERE r.rolname = current_user`,
    [schema]
  );
  return result.rows[0];
}

function evaluateRuntimeRolePrivileges(facts) {
  const violations = [];
  if (!facts) {
    return { ok: false, violations: ['connected role could not be inspected'] };
  }
  if (facts.is_superuser) violations.push('role is a superuser');
  if (facts.bypasses_rls) violations.push('role has BYPASSRLS');
  if (facts.can_create_roles) violations.push('role has CREATEROLE');
  if (facts.can_create_databases) violations.push('role has CREATEDB');
  if (facts.has_replication) violations.push('role has REPLICATION');
  if (facts.can_create_in_database) violations.push('role can create schemas in the database');
  if (facts.can_create_in_schema) violations.push('role can create objects in the application schema');
  if (Number(facts.owned_relation_count) > 0) {
    violations.push(`role owns or inherits ownership of ${Number(facts.owned_relation_count)} application relation(s)`);
  }
  if (Number(facts.privileged_membership_count) > 0) {
    violations.push('role is a member of a privileged role');
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Startup guard: inspect the connected role and apply the configured policy.
 * Returns the evaluation; throws under `enforce` when violations exist.
 */
async function assertRuntimeRolePolicy(client, options = {}) {
  const policy = normalizeRuntimeRolePolicy(options.policy, 'warn');
  const log = options.logger || console;
  if (policy === 'off') {
    return { policy, ok: null, violations: [], skipped: true };
  }
  const facts = await inspectRuntimeRole(client, options);
  const evaluation = evaluateRuntimeRolePrivileges(facts);
  const summary = { policy, role: facts && facts.role_name, ...evaluation };
  if (evaluation.ok) {
    log.log(`Database runtime role check passed for "${summary.role}" (policy=${policy}).`);
    return summary;
  }
  const message =
    `Database runtime role "${summary.role}" is over-privileged: ${evaluation.violations.join('; ')}. ` +
    'Connect the backend with the provisioned non-owner runtime role (DB_RUNTIME_USER/DB_RUNTIME_PASSWORD).';
  if (policy === 'enforce') {
    throw new Error(message);
  }
  log.warn(`WARNING: ${message}`);
  return summary;
}

module.exports = {
  DEFAULT_RUNTIME_ROLE,
  MIN_RUNTIME_PASSWORD_LENGTH,
  normalizeRuntimeRoleName,
  validateRuntimePassword,
  buildScramSha256Verifier,
  normalizeRuntimeRolePolicy,
  provisionRuntimeRole,
  inspectRuntimeRole,
  evaluateRuntimeRolePrivileges,
  assertRuntimeRolePolicy
};
