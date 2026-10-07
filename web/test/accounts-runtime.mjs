// A fresh workerd/D1 database on every run; synthetic identities only, no remote calls.
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createTestHarness} from 'wrangler';
const directory=await mkdtemp(join(tmpdir(),'cpin-account-test-'));
const origin='https://accounts.example.test', password='Synthetic passphrase 2026';
let runtime, checks=0;
const ok=(value,label)=>{assert(value,label);checks++;};
try {
  const assets=join(directory,'assets');await mkdir(assets);await writeFile(join(assets,'index.html'),'Public report');
  const configPath=join(directory,'wrangler.json');
  await writeFile(configPath,JSON.stringify({name:'cpin-account-test',main:new URL('../accounts/worker.js',import.meta.url).pathname,
    compatibility_date:'2026-10-01',compatibility_flags:['nodejs_compat'],
    vars:{AUTH_ORIGIN:origin},assets:{directory:assets,binding:'ASSETS',run_worker_first:['/api/*']},
    d1_databases:[{binding:'ACCOUNTS',database_name:'test-only',database_id:'00000000-0000-0000-0000-000000000001'}]}));
  runtime=createTestHarness({workers:[{configPath,vars:{AUTH_ORIGIN:origin},secrets:{BETTER_AUTH_SECRET:randomBytes(32).toString('base64url')}}]});
  await runtime.listen();
  const environment=await runtime.getWorker().getEnv();
  assert.equal(environment.AUTH_ORIGIN,origin);
  const db=environment.ACCOUNTS;
  for(const name of ['0001_accounts.sql','0002_saved_items.sql']) {
    const sql=await readFile(new URL('../migrations/'+name,import.meta.url),'utf8');
    for(const statement of sql.replace(/^--.*$/gm,'').split(';').filter(s=>s.trim())) await db.prepare(statement).run();
  }
  async function call(path,data,cookie='',method='POST',requestOrigin=origin) {
    const r=await runtime.getWorker().fetch(origin+path,{method:data===undefined?'GET':method,
      headers:{'Sec-Fetch-Site':'same-origin',...(cookie?{Cookie:cookie}:{}),...(data===undefined?{}:{Origin:requestOrigin,'Content-Type':'application/json'})},
      ...(data===undefined?{}:{body:JSON.stringify(data)})});
    return{status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]||cookie,headers:r.headers};
  }
  ok((await runtime.fetch(origin+'/')).status===200,'public static fallback');
  ok((await call('/api/account')).body.configured,'configured probe');
  ok((await call('/api/account')).body.authOrigin===origin,'old public hosts can direct account links to the primary origin');
  ok((await call('/api/saved')).status===401,'anonymous saves blocked');
  const signup=async(email)=>{
    const r=await call('/api/auth/sign-up/email',{name:email.split('@')[0],email,password,approved:true,role:'owner'});
    ok(r.status===200,`signup: ${r.status} ${JSON.stringify(r.body)}`);ok(r.body.user.approved===false&&r.body.user.role==='reader','client cannot grant approval or ownership');return r;
  };
  const owner=await signup('owner@example.test'),alice=await signup('alice@example.test'),bob=await signup('bob@example.test');
  ok((await call('/api/saved',undefined,alice.cookie)).status===403,'pending account cannot save');
  ok((await call('/api/owner/accounts',undefined,alice.cookie)).status===403,'reader cannot administer');
  // Operator-only bootstrap is deliberately outside the HTTP API.
  await db.prepare('UPDATE "user" SET role=\'owner\',approved=1 WHERE id=?').bind(owner.body.user.id).run();
  ok((await call('/api/owner/accounts',undefined,owner.cookie)).status===200,'owner list');
  ok((await call('/api/owner/approval',{userId:alice.body.user.id,approved:true},owner.cookie,'POST','https://wrong.example.test')).status===403,'cross-origin mutation blocked');
  ok((await call('/api/owner/approval',{userId:alice.body.user.id,approved:true},owner.cookie)).status===200,'approve');
  ok((await call('/api/saved',undefined,alice.cookie)).status===401,'approval invalidates prior session');
  const signin=async(email,pass=password)=>call('/api/auth/sign-in/email',{email,password:pass});
  const a=await signin('alice@example.test');ok(a.status===200,'approved login');
  for(const attribute of ['HttpOnly','Secure','SameSite=Lax'])ok(a.headers.get('set-cookie').includes(attribute),attribute+' cookie');
  const item={id:'h1',country:'syria',note:'fixture-note',quote:'Exact fixture words',editionSha:'a'.repeat(64)};
  const path='/api/saved/highlights/h1';
  let r=await call(path,{value:item,revision:0},a.cookie,'PUT');ok(r.status===200&&r.body.revision===1,'first save');
  ok((await call('/api/saved',undefined,(await signin('alice@example.test')).cookie)).body.items[0].value.quote===item.quote,'another session reads same private save');
  ok((await call(path,{value:item,revision:0},a.cookie,'PUT')).status===409,'stale save conflicts');
  ok((await call('/api/owner/approval',{userId:bob.body.user.id,approved:true},owner.cookie)).status===200,'approve second user');
  const b=await signin('bob@example.test');
  ok((await call('/api/saved',undefined,b.cookie)).body.items.length===0,'other user has no access');
  ok((await call(path,{value:{...item,quote:'Other private fixture'},revision:0},b.cookie,'PUT')).status===200,'same ID can exist for another user');
  ok((await call('/api/saved',undefined,a.cookie)).body.items[0].value.quote===item.quote,'first user remains isolated');
  ok((await call(path,{value:null,revision:1},a.cookie,'PUT')).body.revision===2,'deletion keeps revision');
  ok((await call(path,{value:item,revision:1},a.cookie,'PUT')).status===409,'deleted item cannot be revived by stale device');
  ok((await call('/api/saved',undefined,a.cookie)).body.items[0].value===null,'tombstone retained');
  ok((await call(path,{value:{...item,id:'wrong'},revision:2},a.cookie,'PUT')).status===400,'invalid item rejected');
  ok((await call(path,null,a.cookie,'PUT')).status===400,'null JSON request rejected');
  ok((await call('/api/saved/highlights/%zz',{value:item,revision:2},a.cookie,'PUT')).status===400,'malformed encoded ID rejected');
  ok((await call(path,{value:{...item,quote:'x'.repeat(66000)},revision:2},a.cookie,'PUT')).status===413,'record byte limit');
  ok((await call(path,{value:{...item,quote:'x'.repeat(99000)},revision:2},a.cookie,'PUT')).status===413,'request byte limit');
  ok((await call('/api/auth/update-user',{role:'owner'},b.cookie)).status===404,'unneeded auth routes disabled');
  const crossSite=await runtime.getWorker().fetch(origin+'/api/saved',{headers:{Cookie:a.cookie,'Sec-Fetch-Site':'cross-site'}});
  ok(crossSite.status===403,'cross-site private read rejected');
  ok((await call('/api/account',{},a.cookie,'DELETE')).status===405,'unsupported method rejected');
  ok((await call('/api/owner/approval',{userId:owner.body.user.id,approved:false},owner.cookie)).status===400,'cannot pause owner');
  ok((await call('/api/owner/approval',{userId:alice.body.user.id,approved:false},owner.cookie)).status===200,'pause reader');
  ok((await call('/api/saved',undefined,a.cookie)).status===401,'pause invalidates sessions');
  ok((await call('/api/saved',undefined,(await signin('alice@example.test')).cookie)).status===403,'paused user cannot save after new login');
  ok((await call('/api/password-help',{email:'bob@example.test'})).status===200,'request reset help');
  const link=await call('/api/owner/password-link',{userId:bob.body.user.id},owner.cookie);
  ok(link.status===200,'owner creates reset');
  const token=new URLSearchParams(new URL(link.body.url).hash.slice(1)).get('token');ok(!!token,'reset token is in fragment');
  ok((await call('/api/auth/reset-password',{token,newPassword:password+' changed'})).status===200,'reset works');
  ok((await call('/api/auth/reset-password',{token,newPassword:password+' twice'})).status===400,'reset is single use');
  ok((await signin('bob@example.test')).status===401,'old password rejected');
  ok((await signin('bob@example.test',password+' changed')).status===200,'new password works');
  ok((await call('/api/saved',undefined,b.cookie)).status===401,'reset revokes prior sessions');
  for(let i=0;i<4;i++)await call('/api/password-help',{email:'absent@example.test'});
  ok((await call('/api/password-help',{email:'absent@example.test'})).status===429,'reset help rate limited');
  ok((await call('/api/account')).headers.get('cache-control').includes('no-store'),'private responses are not cached');
  await db.batch(Array.from({length:51},(_,i)=>db.prepare('INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt,approved,role) VALUES (?,?,?,0,?,?,0,\'reader\')').bind(`page-${i}`,`Page fixture ${i}`,`page${i}@example.test`,Date.now(),Date.now())));
  const page=await call('/api/owner/accounts?page=1',undefined,owner.cookie);
  ok(page.status===200&&page.body.total===54&&page.body.accounts.length===4,'owner can reach every account beyond first page');
  ok((await call('/api/owner/accounts?page=-1',undefined,owner.cookie)).status===400,'invalid pagination rejected');
  const nextLink=await call('/api/owner/password-link',{userId:bob.body.user.id},owner.cookie);
  const expiredToken=new URLSearchParams(new URL(nextLink.body.url).hash.slice(1)).get('token');
  await db.prepare('UPDATE verification SET expiresAt=?').bind(Date.now()-1).run();
  ok((await call('/api/auth/reset-password',{token:expiredToken,newPassword:password+' expired'})).status===400,'expired reset rejected');
  await db.prepare('UPDATE session SET createdAt=? WHERE userId=?').bind(Date.now()-31*60*1000,owner.body.user.id).run();
  ok((await call('/api/owner/accounts',undefined,owner.cookie)).status===401,'owner changes require recent authentication');
  console.log(JSON.stringify({passed:true,checks,runtime:'workerd and ephemeral D1',scope:'Synthetic accounts only; no production changes or source retrieval.'}));
} finally {
  try { await runtime?.close(); }
  finally { await rm(directory,{recursive:true,force:true}); }
}
