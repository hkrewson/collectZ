'use strict';

const crypto = require('crypto');
const { Pool } = require('pg');
const { withScopedTransaction } = require('./scopedTransaction');
const { executeTransaction } = require('./transactionExecutor');

const WORKER_ACTIONS = new Set(['claim', 'recover', 'lifecycle']);
const SAFE_WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const SAFE_JOB_TYPE = /^[a-z][a-z0-9_.:-]{1,79}$/;

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
      has_function_privilege('collectz_scope.revoke(integer,text)','EXECUTE') AS can_revoke,
      has_function_privilege('collectz_scope.authorize_worker(integer,text,text,text,text[],integer,integer)','EXECUTE') AS can_authorize_worker,
      has_function_privilege('collectz_scope.revoke_worker(integer,text)','EXECUTE') AS can_revoke_worker
      FROM pg_roles r WHERE rolname=current_user`);
    const facts = result.rows[0];
    const expectedCapabilities = ['can_authorize', 'can_revoke', 'can_authorize_worker', 'can_revoke_worker'];
    if (!facts || expectedCapabilities.some((key) => !facts[key]) ||
        Object.entries(facts).some(([key,value]) => !expectedCapabilities.includes(key) && value)) {
      throw new Error('Database scope broker privilege check failed');
    }
  } finally { await probe.end(); }
}

function normalizeWorkerAuthorization(value = {}) {
  const action = String(value.action || '').trim().toLowerCase();
  const workerId = String(value.workerId || '').trim();
  const jobTypes = [...new Set((value.jobTypes || []).map((entry) => String(entry || '').trim().toLowerCase()))].sort();
  if (!WORKER_ACTIONS.has(action)) throw new TypeError('Durable worker action must be claim, recover, or lifecycle');
  if (!SAFE_WORKER_ID.test(workerId)) throw new TypeError('Durable worker ID is invalid');
  if (jobTypes.length < 1 || jobTypes.length > 16 || jobTypes.some((entry) => !SAFE_JOB_TYPE.test(entry))) {
    throw new TypeError('Durable worker job types are invalid');
  }
  if (action !== 'lifecycle' && (value.spaceId !== undefined || value.libraryId !== undefined)) {
    throw new TypeError('Global durable worker grants cannot include workspace scope');
  }
  if (action === 'lifecycle' && (!Number.isInteger(value.spaceId) || value.spaceId <= 0)) {
    throw new TypeError('Durable worker lifecycle scope requires a workspace');
  }
  if (value.libraryId !== undefined && value.libraryId !== null &&
      (!Number.isInteger(value.libraryId) || value.libraryId <= 0)) {
    throw new TypeError('Durable worker library scope is invalid');
  }
  return {
    action,
    workerId,
    jobTypes,
    spaceId: action === 'lifecycle' ? value.spaceId : null,
    libraryId: action === 'lifecycle' ? (value.libraryId ?? null) : null
  };
}

async function withAuthorizedWorkerTransaction(pool, authorization, work) {
  if (typeof work !== 'function') throw new TypeError('Transaction work must be a function');
  const grant = normalizeWorkerAuthorization(authorization);
  let transaction;
  const run = grant.action === 'lifecycle'
    ? (callback) => withScopedTransaction(pool, { spaceId: grant.spaceId, libraryId: grant.libraryId }, callback)
    : (callback) => executeTransaction(pool, callback);
  try {
    return await run(async (client) => {
      const result = await client.query('SELECT pg_backend_pid() AS pid, pg_current_xact_id()::text AS xid');
      transaction = result.rows[0];
      broker ||= createScopeBroker(process.env.DATABASE_URL, {
        ssl: ['true', '1'].includes(process.env.DATABASE_SSL) ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
        allowExitOnIdle: true
      });
      await broker.query(
        'SELECT collectz_scope.authorize_worker($1,$2,$3,$4,$5,$6,$7)',
        [transaction.pid, transaction.xid, grant.action, grant.workerId, grant.jobTypes, grant.spaceId, grant.libraryId]
      );
      return work(client, Object.freeze({ ...grant, jobTypes: Object.freeze([...grant.jobTypes]) }));
    });
  } catch (error) {
    if (error.code === '42501') {
      error.status = 403;
      error.message = 'Database worker scope access denied';
    } else if (error.code !== 'INVALID_DATABASE_SCOPE') {
      error.expose = false;
    }
    throw error;
  } finally {
    if (transaction && broker) {
      await broker.query('SELECT collectz_scope.revoke_worker($1,$2)', [transaction.pid, transaction.xid]).catch(() => {
        console.error('Database worker scope grant cleanup failed');
      });
    }
  }
}

let broker;
async function withAuthorizedScopeTransaction(pool, scope, actorId, work) {
  if (!Number.isInteger(actorId) || actorId <= 0 || actorId > 2147483647) {
    throw new Error('Authorized workspace actor is required');
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

const withSavedViewTransaction = withAuthorizedScopeTransaction;

module.exports = {
  brokerCredentials,
  createScopeBroker,
  assertScopeBrokerPolicy,
  normalizeWorkerAuthorization,
  withAuthorizedScopeTransaction,
  withAuthorizedWorkerTransaction,
  withSavedViewTransaction
};
