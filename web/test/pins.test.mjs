import { test } from "node:test";
import assert from "node:assert/strict";
import { createPinStore, pinId, pinHref, STORAGE_KEY } from "../../prototypes/shared/pins.js";
const country = {type:"country", country:"afghanistan", countryName:"Afghanistan"};
const report = {...country, type:"report", series:"note:taliban", topic:"Taliban"};
function memoryStorage() {
  const items = new Map();
  return {getItem:k=>items.get(k)??null, setItem:(k,v)=>items.set(k,v)};
}
test("pins persist independently and deduplicate stable report identities", () => {
  const storage=memoryStorage(), store=createPinStore(()=>storage);
  assert.equal(store.add(country).persisted,true);
  store.add(report);
  assert.equal(store.add({...report, topic:"New title", edition:"new-edition"}).added,false);
  const reopened=createPinStore(()=>storage);
  assert.equal(reopened.load().length,2);
  reopened.remove(pinId(country));
  assert.deepEqual(reopened.load().map(pinId),[pinId(report)]);
  assert.match(pinHref(report),/series=note%3Ataliban$/);
  assert.equal(pinHref(country),"../dashboard/index.html#afghanistan");
});
test("pins survive a blocked write for this session and report failure honestly", () => {
  const storage=memoryStorage(); let blocked=false;
  const store=createPinStore(()=>({getItem:storage.getItem,setItem:(k,v)=>{if(blocked)throw new Error("quota");storage.setItem(k,v);}}));
  store.add(country); blocked=true;
  assert.equal(store.add(report).persisted,false);
  assert.equal(store.load().length,2);
  assert.equal(store.add(report).persisted,false);
  store.remove(pinId(country));
  assert.deepEqual(store.load().map(pinId),[pinId(report)]);
  blocked=false; store.add({...country,country:"iran"});
  assert.equal(createPinStore(()=>storage).load().length,2);
});
test("a mutation reads pins written by another tab, without dropping unknown catalogue entries", () => {
  const storage=memoryStorage(), a=createPinStore(()=>storage), b=createPinStore(()=>storage);
  a.add(country); b.load(); a.add({...report, country:"former-country"}); b.add({...country,country:"iran"});
  assert.equal(a.load().length,3);
});
test("invalid stored identities cannot supply arbitrary navigation URLs", () => {
  const storage=memoryStorage();
  storage.setItem(STORAGE_KEY,JSON.stringify([null,{...country,country:"javascript:alert(1)"},country,country,{...report,series:"../evil"}]));
  assert.equal(createPinStore(()=>storage).load().length,1);
  assert.equal(pinHref({...report,series:"../../x"}),null);
  assert.equal(pinId({type:"other",country:"iran"}),null);
});
