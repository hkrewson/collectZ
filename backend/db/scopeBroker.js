'use strict';

const crypto = require('crypto');
const { Pool } = require('pg');
const { withScopedTransaction } = require('./scopedTransaction');

function brokerCredentials(runtimeRole, runtimePassword) {
  if (!runtimeRole || !runtimePassword) throw new Error('Runtime database credential is required for scoped access');
  return {
    role: `${runtimeRole.slice(0, 45)}_scope_${crypto.createHash('sha256').update(runtimeRole).digest('hex').slice(0, 8)}`,
    // Independent login secret, never sent in SQL: provisioning stores SCRAM only.
    password: crypto.createHmac('sha256', runtimePassword).update(`collectz/scope-broker/v1:${runtimeRole}`).digest('hex')
  };
}

function createScopeBroker(runtimeUrl, options = {}) {
  const url = new URL(runtimeUrl);
  const credential = brokerCredentials(decodeURIComponent(url.username), decodeURIComponent(url.password));
  url.username = credential.role;
  url.password = credential.password;
  return new Pool({ ...options, connectionString: url.toString(), max: 2 });
}

async function assertScopeBrokerPolicy(runtimeUrl, options = {}) {
  const probe = createScopeBroker(runtimeUrl, options);
  try {
    const result = await probe.query(`SELECT r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
      EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS memberships,
      has_database_privilege(current_database(),'CREATE') AS database_create,
      has_schema_privilege('collectz_scope','CREATE') AS schema_create,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('public','collectz_scope') AND c.relkind IN ('r','p')
          AND has_table_privilege(c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) AS table_access,
      has_function_privilege('collectz_scope.authorize(integer,text,integer,integer,integer)','EXECUTE') AS can_authorize,
      has_function_privilege('collectz_scope.revoke(integer,text)','EXECUTE') AS can_revoke
      FROM pg_roles r WHERE rolname=current_user`);
    const facts = result.rows[0];
    if (!facts || !facts.can_authorize || !facts.can_revoke ||
        Object.entries(facts).some(([key,value]) => !['can_authorize','can_revoke'].includes(key) && value)) {
      throw new Error('Database scope broker privilege check failed');
    }
  } finally { await probe.end(); }
}

let broker;
async function withSavedViewTransaction(pool, scope, actorId, work) {
  if (!Number.isInteger(actorId) || actorId <= 0 || actorId > 2147483647) {
    throw new Error('Authorized saved-view actor is required');
  }
  // Do not acquire runtime connections until scope validation has passed.
  let transaction;
  try {
    return await withScopedTransaction(pool, scope, async client => {
      const result = await client.query('SELECT pg_backend_pid() AS pid, pg_current_xact_id()::text AS xid');
      transaction = result.rows[0];
      broker ||= createScopeBroker(process.env.DATABASE_URL, {
        ssl: ['true', '1'].includes(process.env.DATABASE_SSL) ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
        allowExitOnIdle: true
      });
      await broker.query('SELECT collectz_scope.authorize($1, $2, $3, $4, $5)',
        [transaction.pid, transaction.xid, scope.spaceId, scope.libraryId ?? null, actorId]);
      return work(client);
    });
  } catch (error) {
    if (error.code === '42501') {
      error.status = 403;
      error.message = 'Database scope access denied';
    } else if (error.code !== 'INVALID_DATABASE_SCOPE') {
      error.expose = false;
    }
    throw error;
  } finally {
    if (transaction && broker) {
      // A failed cleanup cannot broaden access: grants bind full xid, server
      // incarnation, runtime role, and PID and expire after five minutes.
      await broker.query('SELECT collectz_scope.revoke($1, $2)', [transaction.pid, transaction.xid]).catch(() => {
        console.error('Database scope grant cleanup failed');
      });
    }
  }
}

module.exports = { brokerCredentials, createScopeBroker, assertScopeBrokerPolicy, withSavedViewTransaction };
