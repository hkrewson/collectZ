#!/usr/bin/env node

'use strict';

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db/pool');
const { withSavedViewTransaction } = require('../db/scopeBroker');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class HttpClient {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
  }

  applyCookies(headers) {
    const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const value of values) {
      const pair = String(value).split(';')[0];
      const separator = pair.indexOf('=');
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }

  cookieHeader() {
    return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async request(pathname, { method = 'GET', body, csrf = false, expected } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;
    if (csrf) {
      const tokenResponse = await this.request('/api/auth/csrf-token', { expected: 200 });
      headers['x-csrf-token'] = tokenResponse.data.csrfToken;
      const refreshedCookie = this.cookieHeader();
      if (refreshedCookie) headers.cookie = refreshedCookie;
    }
    const response = await fetch(`${BASE_URL}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    this.applyCookies(response.headers);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (expected !== undefined && response.status !== expected) {
      throw new Error(`[${this.name}] ${method} ${pathname} expected ${expected}, got ${response.status}`);
    }
    return { status: response.status, data };
  }
}

async function createUser(email, password, role = 'user') {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, role, email_verified, email_verified_at)
     VALUES ($1, $2, $3, $4, true, NOW()) RETURNING id`,
    [email, passwordHash, `Workspace certification ${role}`, role]
  );
  return Number(result.rows[0].id);
}

async function createScope({ suffix, ownerId, memberId = null, memberRole = 'viewer' }) {
  const space = await pool.query(
    `INSERT INTO spaces (name, slug, created_by, is_personal)
     VALUES ($1, $2, $3, false) RETURNING id`,
    [`Workspace certification ${suffix}`, `workspace-cert-${suffix}`, ownerId]
  );
  const spaceId = Number(space.rows[0].id);
  await pool.query(
    `INSERT INTO space_memberships (space_id, user_id, role, created_by)
     VALUES ($1, $2, 'owner', $2)`,
    [spaceId, ownerId]
  );
  if (memberId) {
    await pool.query(
      `INSERT INTO space_memberships (space_id, user_id, role, created_by)
       VALUES ($1, $2, $3, $4)`,
      [spaceId, memberId, memberRole, ownerId]
    );
  }
  const library = await pool.query(
    `INSERT INTO libraries (space_id, name, created_by)
     VALUES ($1, $2, $3) RETURNING id`,
    [spaceId, `Workspace certification library ${suffix}`, ownerId]
  );
  const libraryId = Number(library.rows[0].id);
  await pool.query(
    `INSERT INTO library_memberships (user_id, library_id, role)
     VALUES ($1, $2, 'owner')`,
    [ownerId, libraryId]
  );
  if (memberId) {
    await pool.query(
      `INSERT INTO library_memberships (user_id, library_id, role)
       VALUES ($1, $2, $3)`,
      [memberId, libraryId, memberRole]
    );
  }
  await pool.query(
    `UPDATE users SET active_space_id = $2, active_library_id = $3
      WHERE id = ANY($1::int[])`,
    [[ownerId, ...(memberId ? [memberId] : [])], spaceId, libraryId]
  );
  return { spaceId, libraryId };
}

async function login(client, email, password) {
  await client.request('/api/auth/login', { method: 'POST', body: { email, password }, expected: 200 });
}

async function main() {
  const suffix = crypto.randomBytes(8).toString('hex');
  const fixtures = [], scopes = [];
  try {
    for (const name of ['owner','peer','outsider']) {
      const email = `rls-${name}-${suffix}@example.invalid`;
      const password = crypto.randomBytes(32).toString('hex');
      const id = await createUser(email,password);
      fixtures.push({id,email,password,client:new HttpClient(name)});
    }
    scopes.push(await createScope({suffix:`${suffix}-a`,ownerId:fixtures[0].id,memberId:fixtures[1].id,memberRole:'viewer'}));
    scopes.push(await createScope({suffix:`${suffix}-b`,ownerId:fixtures[2].id}));
    for(const f of fixtures) await login(f.client,f.email,f.password);
    const [owner,peer,outsider]=fixtures.map(f=>f.client);
    await new HttpClient('anonymous').request('/api/libraries/saved-views',{expected:401});
    const created=await owner.request('/api/libraries/saved-views',{method:'POST',csrf:true,expected:201,body:{name:'RLS saved view',media_type:'movie',snapshot:{filters:{media_type:'movie'}}}});
    const id=created.data.view.id;
    assert(Number.isInteger(id),'Saved view id missing');
    const listed=await owner.request('/api/libraries/saved-views',{expected:200});
    assert(listed.data.views.some(v=>v.id===id),'Owner could not read saved view');
    for(const c of [peer,outsider]) {
      const list=await c.request('/api/libraries/saved-views',{expected:200});
      assert(!list.data.views.some(v=>v.id===id),'Foreign saved view leaked');
      await c.request(`/api/libraries/saved-views/${id}`,{method:'PUT',csrf:true,expected:404,body:{name:'must not persist'}});
      await c.request(`/api/libraries/saved-views/${id}`,{method:'DELETE',csrf:true,expected:404});
    }
    await owner.request(`/api/libraries/saved-views/${id}`,{method:'PUT',csrf:true,expected:200,body:{name:'RLS updated view'}});
    const updated=await owner.request('/api/libraries/saved-views',{expected:200});
    assert(updated.data.views.find(v=>v.id===id)?.name==='RLS updated view','Update did not persist');
    const denied=await owner.request('/api/libraries/saved-views',{method:'POST',csrf:true,body:{name:'spoof',media_type:'movie',snapshot:{},space_id:scopes[1].spaceId,library_id:scopes[1].libraryId}});
    assert([400,403].includes(denied.status),'Scope spoof was not rejected');
    await owner.request(`/api/libraries/saved-views/${id}`,{method:'DELETE',csrf:true,expected:204});
    assert((await pool.query('SELECT * FROM saved_library_views')).rowCount===0,'Unscoped runtime read was allowed');
    console.log('PASS: saved-view HTTP CRUD, authentication, actor/workspace isolation and spoof denial');
  } finally {
    for(let i=0;i<fixtures.length;i++) {
      const f=fixtures[i], scope=scopes[i===2?1:0];
      if(scope) await withSavedViewTransaction(pool,scope,f.id,c=>c.query('DELETE FROM saved_library_views WHERE owner_user_id=$1',[f.id]));
    }
    const ids=fixtures.map(f=>f.id), spaceIds=scopes.map(s=>s.spaceId);
    if(ids.length) await pool.query('UPDATE users SET active_space_id=NULL,active_library_id=NULL WHERE id=ANY($1::int[])',[ids]);
    if(spaceIds.length){await pool.query('DELETE FROM libraries WHERE space_id=ANY($1::int[])',[spaceIds]);await pool.query('DELETE FROM spaces WHERE id=ANY($1::int[])',[spaceIds]);}
    if(ids.length) await pool.query('DELETE FROM users WHERE id=ANY($1::int[])',[ids]);
    await pool.end();
  }
}
main().catch(()=>{console.error('FAIL: saved-view HTTP isolation smoke; inspect sanitized server diagnostics');process.exitCode=1;});
