import test from "node:test";
import assert from "node:assert/strict";
import {createAccountStore} from "../../prototypes/shared/account-state.js";
const user={id:"alice",approved:true};
const item={id:"h1",quote:"Exact source words",country:"syria",note:"note-1"};
function fixture(rows=[]){const db=new Map(rows.map(r=>[`${r.kind}/${r.id}`,structuredClone(r)]));const writes=[];
  const request=async(path,data)=>{
    if(path==="/api/account")return{configured:true,user};
    if(path==="/api/saved")return{items:[...db.values()].map(r=>structuredClone(r))};
    const [,kind,rawId]=path.match(/^\/api\/saved\/([^/]+)\/(.+)$/),id=decodeURIComponent(rawId),key=`${kind}/${id}`,current=db.get(key);
    if((current?.revision||0)!==data.revision)throw Object.assign(new Error("Conflict"),{status:409,current:structuredClone(current)});
    const row={kind,id,value:structuredClone(data.value),revision:(current?.revision||0)+1};db.set(key,row);writes.push(row);return{revision:row.revision};
  };return{db,writes,request};}
test("initial account read does not upload guest items",async()=>{const f=fixture();const s=createAccountStore(f.request);await s.initialise();assert.deepEqual(s.snapshot(),{highlights:[],pins:[],reviews:[]});assert.equal(f.writes.length,0);});
test("approved saves write each item and another device reads them",async()=>{const f=fixture(),a=createAccountStore(f.request);await a.initialise();a.replace("highlights",[item]);assert.equal(await a.flush(),true);const b=createAccountStore(f.request);await b.initialise();assert.deepEqual(b.values("highlights"),[item]);});
test("deletions remain tombstones and stale devices cannot resurrect them",async()=>{const f=fixture([{kind:"highlights",id:item.id,value:item,revision:1}]);const a=createAccountStore(f.request),b=createAccountStore(f.request);await a.initialise();await b.initialise();a.replace("highlights",[]);await a.flush();b.replace("highlights",[{...item,comment:"stale change"}]);assert.equal(await b.flush(),false);assert.equal(f.db.get("highlights/h1").value,null);assert.equal(b.state.conflicts.length,1);});
test("conflicts preserve local edits until explicit remote choice",async()=>{const f=fixture([{kind:"highlights",id:item.id,value:item,revision:1}]);const a=createAccountStore(f.request),b=createAccountStore(f.request);await a.initialise();await b.initialise();a.replace("highlights",[{...item,comment:"A"}]);await a.flush();b.replace("highlights",[{...item,comment:"B"}]);await b.flush();assert.equal(b.values("highlights")[0].comment,"B");b.resolve("highlights/h1",false);await b.flush();assert.equal(b.values("highlights")[0].comment,"A");});
test("explicit local conflict resolution uses latest server revision",async()=>{const f=fixture([{kind:"highlights",id:item.id,value:item,revision:1}]);const a=createAccountStore(f.request),b=createAccountStore(f.request);await a.initialise();await b.initialise();a.replace("highlights",[{...item,comment:"A"}]);await a.flush();b.replace("highlights",[{...item,comment:"B"}]);await b.flush();b.resolve("highlights/h1",true);await b.flush();assert.equal(f.db.get("highlights/h1").value.comment,"B");assert.equal(f.db.get("highlights/h1").revision,3);});
test("pending users cannot write account items",async()=>{const s=createAccountStore(async()=>({configured:true,user:{...user,approved:false}}));await s.initialise();assert.throws(()=>s.replace("highlights",[item]),/Approved/);});
test("network failures retain changes and retry confirms them",async()=>{const f=fixture();let offline=true;const s=createAccountStore(async(path,data)=>{if(data&&offline)throw new Error("Offline");return f.request(path,data);});await s.initialise();s.replace("highlights",[item]);assert.equal(await s.flush(),false);assert.equal(s.hasPending(),true);offline=false;assert.equal(await s.flush(),true);assert.equal(s.hasPending(),false);});
test("an edit while saving is sent after the in-flight revision",async()=>{const f=fixture();let release;let blocked=true;const s=createAccountStore(async(path,data)=>{if(data&&blocked){blocked=false;await new Promise(r=>release=r);}return f.request(path,data);});await s.initialise();s.replace("highlights",[item]);s.replace("highlights",[{...item,comment:"updated while saving"}]);release();await s.flush();assert.equal(f.db.get("highlights/h1").value.comment,"updated while saving");assert.equal(s.hasPending(),false);});
test("failed initial read cannot appear saved, accept writes or export a loaded snapshot",async()=>{const f=fixture([{kind:'highlights',id:item.id,value:item,revision:1}]);let unavailable=true;const s=createAccountStore(async(path,data)=>{if(path==='/api/saved'&&unavailable)throw new Error('Unavailable');return f.request(path,data);});await s.initialise();assert.equal(s.state.loaded,false);assert.equal(s.state.status,'unavailable');assert.throws(()=>s.replace('highlights',[item]),/not loaded/);assert.equal(await s.flush(),false);assert.equal(s.state.status,'unavailable');assert.equal(f.writes.length,0);unavailable=false;await s.refresh();assert.equal(s.state.loaded,true);assert.deepEqual(s.values('highlights'),[item]);});

test("sign-in reinitialises a previously signed-out account and loads existing saves",async()=>{
  let signedIn=false;const f=fixture([{kind:"highlights",id:item.id,value:item,revision:1}]);
  const s=createAccountStore((path,data)=>path==="/api/account"&&!signedIn ? {configured:true,user:null} : f.request(path,data));
  await s.initialise();assert.equal(s.state.status,"signed-out");
  signedIn=true;await s.initialise();assert.equal(s.state.status,"saved");assert.deepEqual(s.values("highlights"),[item]);assert.equal(f.writes.length,0);
});

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
test("a refresh cannot replace an edit that finishes saving during its read",async()=>{
  const f=fixture([{kind:"highlights",id:item.id,value:item,revision:1}]),read=deferred();let delay=false;
  const s=createAccountStore((path,data)=>path==="/api/saved"&&delay?read.promise:f.request(path,data));
  await s.initialise();delay=true;const refresh=s.refresh();
  s.replace("highlights",[{...item,quote:"New saved text"}]);await s.flush();
  read.resolve({items:[{kind:"highlights",id:item.id,value:item,revision:1}]});await refresh;
  assert.equal(s.values("highlights")[0].quote,"New saved text");assert.equal(s.state.status,"saved");assert.equal(s.hasPending(),false);
  s.replace("highlights",[{...item,quote:"Next edit"}]);assert.equal(await s.flush(),true);
  assert.equal(f.db.get("highlights/h1").revision,3);
});
test("overlapping refreshes apply only the newest request even when replies reverse",async()=>{
  const f=fixture(),a=deferred(),b=deferred();let reads=[];
  const s=createAccountStore((path,data)=>path==="/api/saved"&&reads.length?reads.shift().promise:f.request(path,data));
  await s.initialise();reads=[a,b];const first=s.refresh(),second=s.refresh();
  b.resolve({items:[{kind:"highlights",id:item.id,value:{...item,quote:"Newer remote edit"},revision:2}]});await second;
  a.resolve({items:[{kind:"highlights",id:item.id,value:item,revision:1}]});await first;
  assert.equal(s.values("highlights")[0].quote,"Newer remote edit");assert.equal(s.state.error,"");
});
test("an obsolete refresh failure cannot turn a successful newer save into an error",async()=>{
  const f=fixture(),read=deferred();let delay=false;
  const s=createAccountStore((path,data)=>path==="/api/saved"&&delay?read.promise:f.request(path,data));
  await s.initialise();delay=true;const old=s.refresh();s.replace("highlights",[item]);await s.flush();
  read.reject(new Error("Old read timed out"));await old;
  assert.equal(s.state.status,"saved");assert.equal(s.state.error,"");assert.deepEqual(s.values("highlights"),[item]);
});
test("account reinitialisation invalidates the previous session's refresh",async()=>{
  const f=fixture(),read=deferred();let delay=false,approved=true;
  const s=createAccountStore((path,data)=>path==="/api/account"?{configured:true,user:{...user,approved}}:path==="/api/saved"&&delay?read.promise:f.request(path,data));
  await s.initialise();delay=true;const old=s.refresh();approved=false;await s.initialise();
  read.resolve({items:[{kind:"highlights",id:item.id,value:item,revision:1}]});await old;
  assert.equal(s.state.status,"pending");assert.deepEqual(s.values("highlights"),[]);assert.throws(()=>s.replace("highlights",[item]),/Approved/);
});
