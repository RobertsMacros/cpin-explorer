// Country/report shortcuts are separate from edition-bound highlights. No account sync yet.
export const STORAGE_KEY = "cpin-pins-v1";
const slug = /^[a-z0-9-]+$/;
const series = /^[\w:.-]+$/;
export function pinId(p) {
  if (!p || typeof p.country !== "string" || !slug.test(p.country)) return null;
  if (p.type === "country") return `country:${p.country}`;
  if (p.type === "report" && typeof p.series === "string" && series.test(p.series)) return `report:${p.country}:${p.series}`;
  return null;
}
export function pinHref(p) {
  if (!pinId(p)) return null;
  return p.type === "country" ? `../dashboard/index.html#${p.country}`
    : `../reader/index.html?country=${encodeURIComponent(p.country)}&series=${encodeURIComponent(p.series)}`;
}
const normalise = (list) => {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter(p => {
    const id = pinId(p);
    if (!id || seen.has(id)) return false;
    seen.add(id); return true;
  }).map(p => ({ type:p.type, country:p.country, ...(p.type === "report" ? {series:p.series} : {}),
    countryName:String(p.countryName || p.country), topic:String(p.topic || ""), kind:String(p.kind || ""), createdAt:String(p.createdAt || "") }));
};
export function createPinStore(getStorage = () => globalThis.localStorage) {
  let memory = [], failed = false;
  function load() {
    if (!failed) {
      try {
        const storage = getStorage();
        if (storage) memory = normalise(JSON.parse(storage.getItem(STORAGE_KEY) || "[]"));
      } catch { /* Retain the last readable list when storage is unavailable. */ }
    }
    return memory.map(p => ({...p}));
  }
  function write(list) {
    memory = normalise(list);
    try {
      const storage = getStorage();
      if (!storage) throw new Error("Storage unavailable");
      storage.setItem(STORAGE_KEY, JSON.stringify(memory));
      failed = false; return true;
    } catch { failed = true; return false; }
  }
  return {
    load,
    add(p) {
      const id = pinId(p);
      if (!id) throw new Error("Invalid pin");
      const list = load();
      if (list.some(x => pinId(x) === id)) return { added:false, persisted:!failed };
      return { added:true, persisted:write([...list, {...p, createdAt:new Date().toISOString()}]) };
    },
    remove(id) { return write(load().filter(p => pinId(p) !== id)); },
  };
}
