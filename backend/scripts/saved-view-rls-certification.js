'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const { Client, Pool } = require('pg');
const { MIGRATIONS, runMigrationsForClient } = require('../db/migrations');
const { provisionRuntimeRole } = require('../db/runtimeRole');
const { brokerCredentials, createScopeBroker, assertScopeBrokerPolicy } = require('../db/scopeBroker');
const { withScopedTransaction } = require('../db/scopedTransaction');

const quote = value => '"' + value.replaceAll('"', '""') + '"';
const checks = [];
let passed = false;
async function check(label, work) {
  try { await work(); } catch (error) { checks.push({ label, pass: false }); throw error; }
  checks.push({ label, pass: true });
  console.log(`PASS ${label}`);
}
async function main() {
  const adminUrl = process.env.RLS_CERT_ADMIN_URL;
  if (!adminUrl) throw new Error('RLS_CERT_ADMIN_URL is required');
  const suffix = crypto.randomBytes(8).toString('hex');
  const database = `collectz_rls_${suffix}`;
  const restore = `${database}_restore`;
  const role = `collectz_rls_app_${suffix}`;
  const password = crypto.randomBytes(32).toString('hex');
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  let owner, runtime, broker;
  const dbUrl = new URL(adminUrl); dbUrl.pathname = '/' + database;
  const runtimeUrl = new URL(dbUrl); runtimeUrl.username = role; runtimeUrl.password = password;
  try {
    await admin.query(`CREATE DATABASE ${quote(database)}`);
    owner = new Client({ connectionString: dbUrl.toString() }); await owner.connect();
    await runMigrationsForClient(owner, { maxVersion: 123 });
    const user = (await owner.query("INSERT INTO users(email,password,name,role) VALUES ($1,$2,'RLS fixture','user') RETURNING id", [`${suffix}@example.invalid`, crypto.randomBytes(32).toString('hex')])).rows[0].id;
    const peer = (await owner.query("INSERT INTO users(email,password,name,role) VALUES ($1,$2,'Peer fixture','user') RETURNING id", [`peer-${suffix}@example.invalid`, crypto.randomBytes(32).toString('hex')])).rows[0].id;
    const spaces = (await owner.query("INSERT INTO spaces(name,slug,created_by) VALUES ('RLS A',$1,$3),('RLS B',$2,$3) RETURNING id", [`a-${suffix}`, `b-${suffix}`, user])).rows.map(r => r.id);
    const libraries = (await owner.query("INSERT INTO libraries(name,space_id,created_by) VALUES ('A',$1,$3),('B',$2,$3),('A2',$1,$3) RETURNING id", [...spaces, user])).rows.map(r => r.id);
    const old = (await owner.query("INSERT INTO saved_library_views(name,media_type,owner_user_id,library_id) VALUES ('legacy','movie',$1,$2) RETURNING id", [user,libraries[0]])).rows[0].id;
    await check('legacy ownership backfill and migration activation', async () => {
      await runMigrationsForClient(owner);
      assert.equal((await owner.query('SELECT space_id FROM saved_library_views WHERE id=$1',[old])).rows[0].space_id,spaces[0]);
      assert.equal((await owner.query("SELECT relrowsecurity FROM pg_class WHERE oid='saved_library_views'::regclass")).rows[0].relrowsecurity,true);
    });
    await provisionRuntimeRole(owner,{roleName:role,password});
    runtime = new Pool({connectionString:runtimeUrl.toString(),max:2});
    broker = createScopeBroker(runtimeUrl.toString());
    await check('startup rejects an overprivileged scope broker',async()=>{
      await assertScopeBrokerPolicy(runtimeUrl.toString());
      const brokerRole=quote(brokerCredentials(role,password).role);
      await owner.query(`GRANT SELECT ON users TO ${brokerRole}`);
      await assert.rejects(assertScopeBrokerPolicy(runtimeUrl.toString()),/privilege check failed/);
      await owner.query(`REVOKE SELECT ON users FROM ${brokerRole}`);
      await assertScopeBrokerPolicy(runtimeUrl.toString());
    });
    const scope = {spaceId:spaces[0],libraryId:libraries[0]};
    async function scoped(selected, actor, work) {
      let tx;
      try {return await withScopedTransaction(runtime,selected,async c=>{
        tx=(await c.query('SELECT pg_backend_pid() AS pid, pg_current_xact_id()::text AS xid')).rows[0];
        await broker.query('SELECT collectz_scope.authorize($1,$2,$3,$4,$5)',[tx.pid,tx.xid,selected.spaceId,selected.libraryId??null,actor]);
        return work(c,tx);
      });} finally {if(tx) await broker.query('SELECT collectz_scope.revoke($1,$2)',[tx.pid,tx.xid]);}
    }
    const insert = "INSERT INTO saved_library_views(name,media_type,owner_user_id,space_id,library_id) VALUES ('new','movie',$1,$2,$3) RETURNING id";
    await check('broker grant remains visible under a non-default session isolation setting',async()=>{
      const c=await runtime.connect();
      try { await c.query('SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL REPEATABLE READ'); }
      finally { c.release(); }
      try { await scoped(scope,user,async client=>{
        assert.equal((await client.query('SHOW transaction_isolation')).rows[0].transaction_isolation,'read committed');
        assert.equal((await client.query('SELECT * FROM saved_library_views')).rowCount,1);
      }); } finally {
        const reset=await runtime.connect();try{await reset.query('SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ COMMITTED');}finally{reset.release();}
      }
    });
    await check('missing scope denies reads and writes',async()=>{
      assert.equal((await runtime.query('SELECT * FROM saved_library_views')).rowCount,0);
      await assert.rejects(runtime.query(insert,[user,...[spaces[0],libraries[0]]]),{code:'42501'});
    });
    await check('runtime cannot mint grants, read grants, or assume broker role',async()=>{
      for(const sql of ['SELECT * FROM collectz_scope.transactions','SELECT * FROM collectz_scope.brokers','SELECT collectz_scope.authorize(1,\'1\',1,NULL,1)',`SET ROLE ${quote(brokerCredentials(role,password).role)}`]) {
        await assert.rejects(runtime.query(sql),{code:'42501'});
      }
    });
    await check('unscoped parent deletion cannot bypass RLS through cascades',async()=>{
      await assert.rejects(runtime.query('DELETE FROM users WHERE id=$1',[user]),{code:'42501'});
      await assert.rejects(runtime.query('DELETE FROM libraries WHERE id=$1',[libraries[0]]),{code:'42501'});
    });
    await check('broker cannot read application rows',async()=>{
      await assert.rejects(broker.query('SELECT * FROM public.users'),{code:'42501'});
    });
    await check('same-scope CRUD works without application SQL predicates',async()=>{
      await scoped(scope,user,async c=>{
        assert.equal((await c.query('SELECT * FROM saved_library_views')).rowCount,1);
        const id=(await c.query(insert,[user,spaces[0],libraries[0]])).rows[0].id;
        assert.equal((await c.query("UPDATE saved_library_views SET name='edited' WHERE id=$1 RETURNING id",[id])).rowCount,1);
        assert.equal((await c.query('DELETE FROM saved_library_views WHERE id=$1 RETURNING id',[id])).rowCount,1);
      });
    });
    await check('sibling workspace library and actor cannot read existing rows',async()=>{
      for(const [selected,actor] of [[{spaceId:spaces[1],libraryId:libraries[1]},user],[{spaceId:spaces[0],libraryId:libraries[2]},user],[scope,peer]]) {
        await scoped(selected,actor,async c=>assert.equal((await c.query('SELECT * FROM saved_library_views')).rowCount,0));
      }
    });
    await check('WITH CHECK denies cross-workspace cross-library and cross-actor inserts',async()=>{
      for(const [actor,space,lib] of [[user,spaces[1],libraries[1]],[user,spaces[0],libraries[2]],[peer,spaces[0],libraries[0]]]) {
        await assert.rejects(scoped(scope,user,c=>c.query(insert,[actor,space,lib])),{code:'42501'});
      }
    });
    await check('ownership fields cannot be mutated even in workspace-wide scope',async()=>{
      for(const [field,value] of [['owner_user_id',peer],['space_id',spaces[1]],['library_id',libraries[2]]]) {
        await assert.rejects(scoped({spaceId:spaces[0]},user,c=>c.query(`UPDATE saved_library_views SET ${field}=$1 WHERE id=$2`,[value,old])),{code:'42501'});
      }
    });
    await check('spoofed or malformed GUCs cannot create unrestricted scope',async()=>{
      const c=await runtime.connect();
      try {await c.query('BEGIN');await c.query("SELECT set_config('collectz.space_id',$1,true),set_config('collectz.library_id','all',true)",[String(spaces[0])]);assert.equal((await c.query('SELECT * FROM saved_library_views')).rowCount,0);await c.query('ROLLBACK');}finally{c.release();}
    });
    await check('grant cannot be replayed from a second connection',async()=>{
      await scoped(scope,user,async c=>{
        assert.equal((await c.query('SELECT * FROM saved_library_views')).rowCount,1);
        assert.equal((await runtime.query('SELECT * FROM saved_library_views')).rowCount,0);
      });
    });
    await check('commit rollback and concurrent scopes remain isolated',async()=>{
      await assert.rejects(scoped(scope,user,async()=>{throw new Error('rollback');}),/rollback/);
      await Promise.all([scoped(scope,user,async c=>assert.equal((await c.query('SELECT * FROM saved_library_views')).rowCount,1)),scoped({spaceId:spaces[1]},user,async c=>assert.equal((await c.query('SELECT * FROM saved_library_views')).rowCount,0))]);
      assert.equal((await runtime.query('SELECT * FROM saved_library_views')).rowCount,0);
    });
    await check('expired authorization fails closed',async()=>{
      await scoped(scope,user,async(c,tx)=>{
        await owner.query("UPDATE collectz_scope.transactions SET expires_at=now()-interval '1 second' WHERE backend_pid=$1 AND transaction_id=$2",[tx.pid,tx.xid]);
        assert.equal((await c.query('SELECT * FROM saved_library_views')).rowCount,0);
      });
    });
    await check('unresolved legacy ownership rolls activation back',async()=>{
      await owner.query('BEGIN');
      try {
        await owner.query('ALTER TABLE saved_library_views DISABLE ROW LEVEL SECURITY');
        await owner.query('DROP TRIGGER saved_view_immutable_owner ON saved_library_views');
        await owner.query('UPDATE saved_library_views SET library_id=NULL,space_id=NULL WHERE id=$1',[old]);
        await assert.rejects(owner.query(MIGRATIONS.find(m=>m.version===124).up),/unresolved workspace ownership/);
      } finally {await owner.query('ROLLBACK');}
      assert.equal((await owner.query('SELECT space_id FROM saved_library_views WHERE id=$1',[old])).rows[0].space_id,spaces[0]);
    });
    await runtime.end();runtime=null;await broker.end();broker=null;await owner.end();owner=null;
    await check('database snapshot restore retains policy and data without active grants',async()=>{
      await admin.query(`CREATE DATABASE ${quote(restore)} TEMPLATE ${quote(database)}`);
      const restoredUrl=new URL(dbUrl);restoredUrl.pathname='/'+restore;
      const restored=new Client({connectionString:restoredUrl.toString()});await restored.connect();
      try {assert.equal((await restored.query('SELECT count(*)::int AS n FROM saved_library_views')).rows[0].n,1);assert.equal((await restored.query("SELECT relrowsecurity FROM pg_class WHERE oid='saved_library_views'::regclass")).rows[0].relrowsecurity,true);assert.equal((await restored.query('SELECT count(*)::int AS n FROM collectz_scope.transactions')).rows[0].n,0);}finally{await restored.end();}
    });
    passed = true;
  } finally {
    if(runtime)await runtime.end();if(broker)await broker.end();if(owner)await owner.end();
    for(const db of [restore,database])await admin.query(`DROP DATABASE IF EXISTS ${quote(db)}`);
    for(const name of [brokerCredentials(role,password).role,role])await admin.query(`DROP ROLE IF EXISTS ${quote(name)}`);
    await admin.end();
  }
}
main().finally(()=>{const output=process.env.RLS_CERT_OUTPUT||require('path').join(__dirname,'../artifacts/saved-view-rls-evidence.json');fs.mkdirSync(require('path').dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({status:passed?'passed':'failed',migration:124,checks},null,2)+'\n');}).catch(error=>{console.error(`RLS certification failed (${error.code||'assertion'}): ${error.message.replace(/postgres(?:ql)?:\/\/\S+/gi,'<redacted>')}`);process.exitCode=1;});
