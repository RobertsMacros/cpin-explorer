// Account content stays in memory on the device and is written to the server per item.
// Browser-only saves are never uploaded merely because someone signs in.
export const SAVED_KEYS = {
  "cpin-highlights-v1": "highlights", "cpin-pins-v1": "pins", "cpin-source-reviews-v1": "reviews",
};
const idOf = (kind, value) => kind === "pins" ? (value.type === "country" ? `country:${value.country}` : `report:${value.country}:${value.series}`) : value.id;
export async function api(path, data, method = "POST") {
  const response = await fetch(path, { method: data === undefined ? "GET" : method, credentials: "same-origin",
    cache: "no-store", headers: data === undefined ? {} : { "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(path === "/api/account" ? 2500 : 10000) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message || "The account service could not complete this request."), { status: response.status, current: result.current });
  return result;
}

export function createAccountStore(request = api, changed = () => {}) {
  const rows = new Map(), pending = new Map(); let running = null, sequence = 0;
  const state = { configured: false, user: null, loaded: false, status: "loading", error: "", conflicts: [] };
  function notify() { state.conflicts = [...pending].filter(([,p]) => p.conflict).map(([key,p]) => ({key,kind:p.kind,id:p.id})); changed(state); }
  function values(kind) { return [...rows.values()].filter(r=>r.kind===kind && r.value!==null).map(r=>r.value); }
  function replace(kind, list) {
    if (!state.user?.approved) throw new Error("Approved account required.");
    if (!state.loaded) throw new Error("Account saves have not loaded. Retry before making changes.");
    const next = new Map(list.map(value=>[idOf(kind,value),value]));
    const old = new Map(values(kind).map(value=>[idOf(kind,value),value]));
    for (const id of new Set([...old.keys(),...next.keys()])) {
      const value = next.get(id) ?? null;
      if (JSON.stringify(value) === JSON.stringify(old.get(id) ?? null)) continue;
      const key=`${kind}/${id}`, prior=rows.get(key);
      const existing=pending.get(key);
      rows.set(key,{kind,id,value,revision:prior?.revision || 0});
      pending.set(key,{kind,id,value,generation:++sequence, ...(existing?.conflict ? {conflict:existing.conflict} : {})});
    }
    state.status=pending.size ? "saving" : "saved"; notify(); void flush();
  }
  async function flush() {
    if (!state.loaded) return false;
    if (running) return running;
    running=(async()=>{
      while ([...pending.values()].some(p=>!p.conflict)) {
        const [key,item] = [...pending].find(([,p])=>!p.conflict);
        try {
          const result=await request(`/api/saved/${item.kind}/${encodeURIComponent(item.id)}`, {value:item.value,revision:rows.get(key)?.revision || 0}, "PUT");
          rows.get(key).revision=result.revision;
          if (pending.get(key)?.generation===item.generation) pending.delete(key);
        } catch(e) {
          if (e.status===409 && e.current) pending.get(key).conflict=e.current;
          state.error=e.message; state.status="error"; notify(); return false;
        }
      }
      state.status=pending.size ? "conflict" : "saved"; state.error=""; notify(); return !pending.size;
    })();
    try { return await running; } finally { running=null; }
  }
  async function refresh() {
    if (pending.size || running) return;
    try {
      const result=await request("/api/saved"); rows.clear();
      for (const row of result.items) rows.set(`${row.kind}/${row.id}`,row);
      state.loaded=true; state.status="saved"; state.error=""; notify();
    } catch(e) {state.status="error";state.error=e.message;notify();throw e;}
  }
  async function initialise() {
    try {
      const result=await request("/api/account"); Object.assign(state,result);
      state.status=result.user?.approved ? "loading" : result.user ? "pending" : "signed-out";
      if (result.user?.approved) await refresh(); else notify();
    } catch(e) { state.status="unavailable"; state.error=e.message; notify(); }
    return state;
  }
  function resolve(key, keepLocal) {
    const item=pending.get(key); if (!item?.conflict) return;
    const current=item.conflict; rows.get(key).revision=current.revision;
    if (keepLocal) delete item.conflict;
    else { rows.get(key).value=current.value; pending.delete(key); }
    state.error=""; notify(); void flush();
  }
  return {state,initialise,refresh,flush,replace,values,resolve,
    hasPending:()=>pending.size>0,
    snapshot:()=>Object.fromEntries(Object.values(SAVED_KEYS).map(kind=>[kind,values(kind)])),
    storage:{getItem:key=>JSON.stringify(values(SAVED_KEYS[key])),setItem:(key,value)=>replace(SAVED_KEYS[key],JSON.parse(value))},
  };
}

const browser = typeof window !== "undefined";
export const accountStore=createAccountStore(api, state=>{
  if(browser) dispatchEvent(new CustomEvent("cpin-account-change",{detail:state}));
});
export const accountReady=browser ? accountStore.initialise() : Promise.resolve(accountStore.state);
const guestMemory=new Map();
export function savedStorage() {
  if (accountStore.state.user) {
    if (!accountStore.state.user.approved || !accountStore.state.loaded) return {
      getItem:()=>"[]",setItem:()=>{throw new Error("Account saving unavailable.");},
    };
    return accountStore.storage;
  }
  try {
    if (globalThis.localStorage?.getItem("cpin-browser-saving") !== "no") return globalThis.localStorage;
  } catch {}
  return {getItem:key=>guestMemory.get(key)||"[]",setItem:(key,value)=>guestMemory.set(key,value)};
}
if(browser) {
  addEventListener("focus",()=>{if(accountStore.state.user?.approved) void accountStore.refresh().catch(e=>{accountStore.state.error=e.message;});});
  addEventListener("beforeunload",e=>{if(accountStore.hasPending()){e.preventDefault();e.returnValue="";}});
}
