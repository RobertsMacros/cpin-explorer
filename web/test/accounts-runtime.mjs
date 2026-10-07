// A fresh workerd/D1 database on every run; synthetic identities only, no remote calls.
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createTestHarness} from 'wrangler';
import {aiReviewCatalogue,reviewFingerprint} from '../../prototypes/shared/review-feedback-core.js';
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
  for(const name of ['0001_accounts.sql','0002_saved_items.sql','0003_review_feedback.sql']) {
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
  const catalogue=JSON.parse(await readFile(new URL('../../prototypes/reviews/annotations.json',import.meta.url),'utf8')).records;
  const published=JSON.parse(await readFile(new URL('../../prototypes/reviews/published.json',import.meta.url),'utf8'));
  const reviewDirectory=JSON.parse(await readFile(new URL('../../prototypes/reviews/directory.json',import.meta.url),'utf8'));
  const ai=aiReviewCatalogue(catalogue,published.records,reviewDirectory.reviews), reviewed=ai[0], peer=ai[1];
  const reviewSha=await reviewFingerprint(reviewed), peerSha=await reviewFingerprint(peer);
  const feedbackPath='/api/review-feedback/'+reviewed.id;
  const feedback={recordSha:reviewSha,vote:'approve',reason:'other',note:'Synthetic feedback fixture only.',revision:0};
  const feedbackRead='/api/review-feedback?ids='+reviewed.id;
  ok((await call(feedbackRead)).body.records[0].approvals===0,'public empty feedback is a loaded zero');
  ok((await call(feedbackPath,feedback,'','PUT')).status===401,'anonymous feedback blocked');
  ok((await call('/api/owner/recheck-queue',undefined,b.cookie)).status===403,'reader cannot see shared disagreement notes');
  ok((await call(feedbackPath,{...feedback,recordSha:'a'.repeat(64)},a.cookie,'PUT')).status===409,'approval cannot attach to changed review bytes');
  ok((await call('/api/review-feedback/'+catalogue.find(r=>r.kind==='external').id,feedback,a.cookie,'PUT')).status===404,'human reviewer cannot be overwritten or voted on as AI');
  ok((await call(feedbackPath,{...feedback,note:'x'.repeat(2001)},a.cookie,'PUT')).status===400,'feedback note bounded');
  ok((await call(feedbackPath,{...feedback,reason:'invented'},a.cookie,'PUT')).status===400,'reason validated');
  r=await call(feedbackPath,feedback,a.cookie,'PUT');ok(r.status===200&&r.body.approvals===1&&r.body.mine.revision===1,'human approval persisted');
  ok((await call(feedbackPath,feedback,a.cookie,'PUT')).status===409,'stale feedback conflicts');
  ok((await db.prepare('SELECT COUNT(*) AS n FROM review_feedback_events').first()).n===1,'conflicting vote has no extra audit event');
  ok((await call('/api/owner/recheck-queue',undefined,owner.cookie)).body.total===0,'approval does not queue an AI recheck');
  await call('/api/review-feedback/'+peer.id,{...feedback,recordSha:peerSha},b.cookie,'PUT');
  r=await call(feedbackPath,{...feedback,vote:'disagree',reason:'scope',note:'Synthetic dispute: verify the exact edition.',revision:1},a.cookie,'PUT');
  ok(r.status===200&&r.body.approvals===0&&r.body.disagreements===1&&r.body.recheck==='queued','disagreement atomically replaces approval and enqueues');
  const publicFeedback=(await call(feedbackRead)).body.records[0];
  ok(publicFeedback.mine===null&&!JSON.stringify(publicFeedback).includes('Synthetic dispute'),'public counters exclude private-to-review-process notes and identity');
  ok((await call('/api/saved',undefined,a.cookie)).body.items.every(i=>i.kind!=='feedback'),'shared feedback never enters private saved-items export');
  let task=(await call('/api/owner/recheck-queue',undefined,owner.cookie)).body.tasks[0];
  ok(task.review.id===reviewed.id&&task.feedback[0].note.includes('Synthetic dispute'),'owner/AI receives the scoped disagreement');
  ok(!task.peers.some(p=>p.id===peer.id),'human-approved peer protected from wider AI recheck');
  ok(task.peers.length===ai.length-2,'unconfirmed peer pool includes low-ranked reviews as leads');
  const output=t=>({recordId:t.recordId,recordSha:t.recordSha,planSha:t.planSha,outcome:'unresolved',explanation:'Synthetic test only: source evidence has not been independently reread.',evidenceLinks:[],peerChecks:[]});
  await call('/api/review-feedback/'+peer.id,{...feedback,recordSha:peerSha,vote:null,revision:1},b.cookie,'PUT');
  ok((await call('/api/owner/recheck-result',output(task),owner.cookie)).status===409,'concurrent peer approval/retraction invalidates a stale plan');
  task=(await call('/api/owner/recheck-queue',undefined,owner.cookie)).body.tasks[0];
  ok(task.peers.some(p=>p.id===peer.id),'retracted approval returns peer to unconfirmed pool');
  ok((await call('/api/owner/recheck-result',{...output(task),outcome:'correction-supported'},owner.cookie)).status===400,'confirmed correction requires source evidence');
  const actualPeer=task.peers[0];
  const result={...output(task),peerChecks:[{recordId:actualPeer.id,recordSha:actualPeer.recordSha,outcome:'unresolved',explanation:'Synthetic fixture: insufficient exact source evidence for this peer.',evidenceLinks:[]}]};
  r=await call('/api/owner/recheck-result',result,owner.cookie);ok(r.status===200&&r.body.result.peersChecked===1,'separate scoped AI result and actual peer coverage retained');
  ok(r.body.result.peerChecks[0].targets[0].editionId===(actualPeer.review.targets||[actualPeer.review.target])[0].editionId,'peer result links to its checked exact edition');
  ok((await call('/api/owner/recheck-queue',undefined,owner.cookie)).body.total===0,'completed recheck leaves active queue');
  ok((await call(feedbackRead)).body.records[0].result.peersChecked===1,'public recheck output separate from original review');
  ok((await call('/api/owner/recheck-result',result,owner.cookie)).status===409,'completed output cannot overwrite immutable result');
  await call(feedbackPath,{...feedback,vote:'disagree',revision:2,note:'Synthetic renewed disagreement.'},a.cookie,'PUT');
  r=await call(feedbackRead);
  ok(r.body.records[0].recheck==='queued'&&r.body.records[0].result.peersChecked===1,'new disagreement reopens queue and preserves previous AI result');
  const renewed=(await call('/api/owner/recheck-queue',undefined,owner.cookie)).body.tasks[0];
  const correction={...output(renewed),outcome:'correction-supported',failurePattern:'Synthetic regional/denominator confusion only.',evidenceLinks:['https://fixture.example.test/source#page=3'],peerChecks:[]};
  ok((await call('/api/owner/recheck-result',{...correction,evidenceLinks:['javascript:alert(1)']},owner.cookie)).status===400,'unsafe evidence link rejected');
  ok((await call('/api/owner/recheck-result',correction,owner.cookie)).status===200,'supported correction records its evidence and explicit recurring-error pattern');
  ok((await db.prepare('SELECT COUNT(*) AS n FROM review_recheck_results').first()).n===2,'successive AI results retained without overwriting first');
  ok((await call(feedbackRead)).body.records[0].result.failurePattern===correction.failurePattern,'separate recurring-error explanation available to readers');
  await call(feedbackPath,{...feedback,vote:null,revision:3},a.cookie,'PUT');
  ok((await call('/api/owner/recheck-queue',undefined,owner.cookie)).body.total===0,'withdrawn sole disagreement is not an active task');
  ok((await call(feedbackPath,{...feedback,vote:'disagree',revision:3},a.cookie,'PUT')).status===409,'clear keeps a tombstone against stale devices');
  await call(feedbackPath,{...feedback,revision:4},a.cookie,'PUT');
  await db.prepare('UPDATE account_limits SET count=60 WHERE key=?').bind('review-feedback:'+alice.body.user.id).run();
  ok((await call(feedbackPath,{...feedback,revision:5},a.cookie,'PUT')).status===429,'approved feedback writes rate limited');
  ok((await call('/api/owner/approval',{userId:owner.body.user.id,approved:false},owner.cookie)).status===400,'cannot pause owner');
  ok((await call('/api/owner/approval',{userId:alice.body.user.id,approved:false},owner.cookie)).status===200,'pause reader');
  ok((await call('/api/saved',undefined,a.cookie)).status===401,'pause invalidates sessions');
  ok((await call('/api/saved',undefined,(await signin('alice@example.test')).cookie)).status===403,'paused user cannot save after new login');
  ok((await call(feedbackRead)).body.records[0].approvals===0,'paused account no longer counts as a human approval');
  ok((await call(feedbackPath,{...feedback,revision:5},(await signin('alice@example.test')).cookie,'PUT')).status===403,'paused account cannot submit feedback');
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
