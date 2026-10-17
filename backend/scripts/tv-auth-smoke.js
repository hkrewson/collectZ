'use strict';
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { ensureUserDefaultScope } = require('../services/libraries');
const { createMobileAuthSession, TV_AUTH_SCOPES, getRequiredMobileScopesForRequest } = require('../services/mobileAuthTokens');
const { projectRow } = require('../services/tvPresentation');
const BASE = process.env.BASE_URL || 'http://localhost:3001';
let checks = 0;
async function request(path, { body, token, cookie, csrf, status = 200, method } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  const response = await fetch(BASE + path, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
  assert.equal(response.status, status, `${path}: HTTP ${response.status}, expected ${status}`); checks++;
  const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = null; } return { data, response };
}
async function main() {
  assert.equal(getRequiredMobileScopesForRequest({originalUrl:'/api/media/import-plex',method:'POST'}),null);
  assert.equal(getRequiredMobileScopesForRequest({originalUrl:'/api/media/12/merge-details',method:'GET'}),null);
  assert.deepEqual(projectRow({id:1,title:'Safe',source_payload:{token:'hidden'},poster_path:'https://example.test/x?token=hidden'},'media'), {id:1,title:'Safe',artwork_path:'/api/mobile/tv/artwork/media/1'}); checks+=3;
  const suffix=crypto.randomBytes(8).toString('hex'); const password=crypto.randomBytes(24).toString('base64url');
  const user=(await pool.query("INSERT INTO users(email,password,name,role,email_verified) VALUES($1,$2,'TV test','user',true) RETURNING id,email", [`tv-${suffix}@example.invalid`,await bcrypt.hash(password,10)])).rows[0];
  const other=(await pool.query("INSERT INTO users(email,password,name,role,email_verified) VALUES($1,$2,'Other test','user',true) RETURNING id", [`tv-other-${suffix}@example.invalid`,await bcrypt.hash(password,10)])).rows[0];
  const scope=await ensureUserDefaultScope(user.id); await ensureUserDefaultScope(other.id);
  // Core may share a default installation library; create a distinct private library for isolation proof.
  const foreign=(await pool.query("INSERT INTO libraries(name,space_id,created_by) VALUES('Private TV fixture',$1,$2) RETURNING id",[scope.spaceId,other.id])).rows[0];
  const media=(await pool.query("INSERT INTO media(title,media_type,space_id,library_id) VALUES('TV fixture','movie',$1,$2) RETURNING id",[scope.spaceId,scope.libraryId])).rows[0];
  const hidden=(await pool.query("INSERT INTO media(title,media_type,space_id,library_id) VALUES('Private hidden fixture','movie',$1,$2) RETURNING id",[scope.spaceId,foreign.id])).rows[0];
  const collection=(await pool.query("INSERT INTO collections(name,space_id,library_id) VALUES('TV collection',$1,$2) RETURNING id",[scope.spaceId,scope.libraryId])).rows[0];
  await pool.query('INSERT INTO collection_items(collection_id,media_id) VALUES($1,$2)',[collection.id,hidden.id]);
  const capabilities=await request('/api/mobile/tv/capabilities'); assert.equal(capabilities.data.supported,true);
  const login=await request('/api/auth/login',{body:{email:user.email,password}});
  const cookie=login.response.headers.getSetCookie().map(v=>v.split(';')[0]).filter(v=>!v.startsWith('csrf_token=')).join('; ');
  const csrfResponse=await request('/api/auth/csrf-token'); const csrf=csrfResponse.data.csrfToken;
  const cookies=cookie+'; '+csrfResponse.response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  const start=(await request('/api/mobile/auth/device/start',{body:{device_name:'Test TV'},status:201})).data;
  let poll=await request('/api/mobile/auth/device/token',{body:{device_code:start.device_code},status:400}); assert.equal(poll.data.error,'authorization_pending');
  poll=await request('/api/mobile/auth/device/token',{body:{device_code:start.device_code},status:400}); assert.equal(poll.data.error,'slow_down');
  await request('/api/mobile/auth/device/decision',{body:{user_code:start.user_code,decision:'approve'},cookie:cookie,status:403});
  await request('/api/mobile/auth/device/decision',{body:{user_code:start.user_code,decision:'approve'},cookie:cookies,csrf});
  await request('/api/mobile/auth/device/decision',{body:{user_code:start.user_code,decision:'approve'},cookie:cookies,csrf,status:400});
  await pool.query('UPDATE tv_device_authorizations SET next_poll_at=NOW()');
  const hash=crypto.createHash('sha256').update(start.device_code).digest('hex');
  const stored=(await pool.query('SELECT * FROM tv_device_authorizations WHERE device_hash=$1',[hash])).rows[0];
  assert(!JSON.stringify(stored).includes(start.device_code)); checks++;
  const attempts=await Promise.all([0,1].map(()=>fetch(BASE+'/api/mobile/auth/device/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_code:start.device_code})})));
  assert.deepEqual(attempts.map(r=>r.status).sort(),[200,400]); checks++;
  const pair=await attempts.find(r=>r.status===200).json(); const token=pair.accessToken;
  assert.deepEqual(pair.scope,TV_AUTH_SCOPES); checks++;
  await request('/api/libraries',{token});
  const page=await request(`/api/media?library_id=${scope.libraryId}`,{token}); assert(page.data.items.some(item=>item.id===media.id)); assert(!page.data.items.some(item=>item.id===hidden.id));
  await request('/api/media',{token,status:403});
  await request(`/api/media?library_id=${foreign.id}`,{token,status:403});
  await request(`/api/media/${hidden.id}?library_id=${scope.libraryId}`,{token,status:404});
  const members=await request(`/api/media/collections/${collection.id}?library_id=${scope.libraryId}`,{token});
  assert(!JSON.stringify(members.data).includes('Private hidden fixture')); assert(!members.data.items[0].media_id); checks++;
  await request(`/api/media/${media.id}?library_id=${scope.libraryId}`,{token,body:{title:'write denied'},method:'PATCH',status:403});
  await request('/api/capture-items',{token,status:403});
  await request(`/api/mobile/tv/artwork/media/${hidden.id}?library_id=${scope.libraryId}`,{token,status:404});
  await pool.query("UPDATE feature_flags SET enabled=true WHERE key='collectibles_enabled'");
  const art=(await pool.query("INSERT INTO art_items(title,artist,library_id,space_id) VALUES('TV art','Fixture artist',$1,$2) RETURNING id",[scope.libraryId,scope.spaceId])).rows[0];
  const artPage=await request(`/api/art?library_id=${scope.libraryId}`,{token});
  assert(artPage.data.items.some(item=>item.native_art_id===art.id)); checks++;
  await request(`/api/collectibles?library_id=${scope.libraryId}`,{token});
  for (const type of ['tv_series','tv_episode','book','audio','game','comic_book']) {
    await pool.query('INSERT INTO media(title,media_type,library_id,space_id) VALUES($1,$2,$3,$4)',[`TV ${type}`,type,scope.libraryId,scope.spaceId]);
    const filtered=await request(`/api/media?library_id=${scope.libraryId}&media_type=${type}`,{token});
    assert(filtered.data.items.length>0 && filtered.data.items.every(item=>item.media_type===type)); checks++;
  }
  await pool.query("UPDATE users SET role='admin' WHERE id=$1",[user.id]);
  await request(`/api/media?library_id=${foreign.id}`,{token,status:403});
  await pool.query("UPDATE users SET role='user' WHERE id=$1",[user.id]);
  const scanner=await createMobileAuthSession({userId:user.id}); await request(`/api/media?library_id=${scope.libraryId}`,{token:scanner.accessToken,status:403});
  const refreshed=(await request('/api/mobile/auth/refresh',{body:{refreshToken:pair.refreshToken}})).data;
  await request('/api/mobile/auth/refresh',{body:{refreshToken:pair.refreshToken},status:401});
  await request('/api/libraries',{token,status:401});
  await request('/api/mobile/auth/logout',{token:refreshed.accessToken,body:{refreshToken:refreshed.refreshToken}});
  await request('/api/libraries',{token:refreshed.accessToken,status:401});
  for (const decision of ['deny','expire']) {
    const code=(await request('/api/mobile/auth/device/start',{body:{},status:201})).data;
    if(decision==='deny') await request('/api/mobile/auth/device/decision',{body:{user_code:code.user_code,decision:'deny'},cookie:cookies,csrf});
    else await pool.query("UPDATE tv_device_authorizations SET expires_at=NOW()-INTERVAL '1 second' WHERE device_hash=$1",[crypto.createHash('sha256').update(code.device_code).digest('hex')]);
    const result=await request('/api/mobile/auth/device/token',{body:{device_code:code.device_code},status:400});
    assert.equal(result.data.error,decision==='deny'?'access_denied':'expired_token');
  }
  const readPair=await createMobileAuthSession({userId:user.id,scopes:TV_AUTH_SCOPES});
  await pool.query('UPDATE space_memberships SET suspended_at=NOW() WHERE space_id=$1 AND user_id=$2',[scope.spaceId,user.id]);
  await request(`/api/media?library_id=${scope.libraryId}`,{token:readPair.accessToken,status:403});
  const list=await request('/api/libraries',{token:readPair.accessToken}); assert.equal(list.data.libraries.length,0); checks++;
  console.log(`TV authorization and isolation: ${checks} checks passed (ephemeral fixture database).`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>pool.end());
