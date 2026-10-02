// CPIN Explorer · runs redline comparisons off the main thread.
//
//   const engine = new RedlineEngine();
//   engine.init(bodies, images);                       // every edition's verbatim HTML, oldest first
//   const res = await engine.diff(a, b, { priority: true, onProgress });
//   // res: { inlineHtml, sbsHtml, changes, toc, stats, rows } (redline-diff.js summarise())
//
// A module Web Worker (redline-worker.js) parses each body once and caches results; jobs queue with
// priority (the pair on screen first, background warm-ups after). Browsers without module workers run
// the same engine on the main thread.
export const ENGINE_BUILD = "2026-10-02.4";   // bump when redline-diff.js changes (cache-buster)

export class RedlineEngine {
  constructor({ max = 10 } = {}) {
    this.worker = null; this.fallback = null; this.bodies = null; this.images = null;
    this.seq = 0; this.queue = []; this.current = null; this.results = new Map(); this.max = max;
    this.onResult = null;
  }
  key(a, b) { return `${a}:${b}`; }
  cached(a, b) {
    const k = this.key(a, b), r = this.results.get(k);
    if (r) { this.results.delete(k); this.results.set(k, r); }
    return r || null;
  }
  store(a, b, r) {
    this.results.set(this.key(a, b), r);
    while (this.results.size > this.max) this.results.delete(this.results.keys().next().value);
  }
  init(bodies, images) {
    this.bodies = bodies; this.images = images;
    try {
      this.worker = new Worker(new URL(`./redline-worker.js?v=${ENGINE_BUILD}`, import.meta.url), { type: "module" });
      this.worker.onmessage = (e) => this.onMessage(e.data);
      this.worker.onerror = (e) => { e.preventDefault?.(); this.toFallback(); };
      this.worker.postMessage({ type: "init", bodies, images });
    } catch { this.toFallback(); }
  }
  loadFallback() {
    return (this.fallback ||= import(new URL(`./redline-diff.js?v=${ENGINE_BUILD}`, import.meta.url).href));
  }
  toFallback() {
    if (this.worker) { try { this.worker.terminate(); } catch {} this.worker = null; }
    this.loadFallback();
    const cur = this.current;
    this.current = null;
    if (cur) this.queue.unshift(cur);
    this.pump();
  }
  diff(a, b, { priority = false, onProgress = null } = {}) {
    const hit = this.cached(a, b);
    if (hit) return Promise.resolve(hit);
    const k = this.key(a, b);
    const same = this.current?.k === k ? this.current : this.queue.find((j) => j.k === k);
    if (same) {
      if (onProgress) same.listeners.push(onProgress);
      if (priority && same !== this.current) { this.queue.splice(this.queue.indexOf(same), 1); this.queue.unshift(same); }
      return same.promise;
    }
    const job = { id: ++this.seq, a, b, k, listeners: onProgress ? [onProgress] : [] };
    job.promise = new Promise((res, rej) => { job.resolve = res; job.reject = rej; });
    if (priority) this.queue.unshift(job); else this.queue.push(job);
    this.pump();
    return job.promise;
  }
  pump() {
    if (this.current || !this.queue.length) return;
    const job = (this.current = this.queue.shift());
    if (this.worker) { this.worker.postMessage({ type: "diff", id: job.id, a: job.a, b: job.b }); return; }
    this.loadFallback().then((mod) => new Promise((r) => setTimeout(r, 30)).then(() => {
      const t0 = performance.now();
      const res = mod.summarise(mod.diffBodies(this.bodies[job.a], this.bodies[job.b], { images: this.images }));
      res.stats.ms.worker = Math.round(performance.now() - t0);
      this.onMessage({ type: "result", id: job.id, a: job.a, b: job.b, result: res });
    })).catch((err) => this.onMessage({ type: "error", id: job.id, message: String(err) }));
  }
  onMessage(m) {
    const job = this.current;
    if (!job || m.id !== job.id) return;
    if (m.type === "progress") { job.listeners.forEach((fn) => fn(m.phase, m.f)); return; }
    this.current = null;
    if (m.type === "result") { this.store(job.a, job.b, m.result); job.resolve(m.result); this.onResult?.(job.a, job.b, m.result); }
    else job.reject(new Error(m.message));
    this.pump();
  }
}
