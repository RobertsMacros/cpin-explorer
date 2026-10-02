/* CPIN Explorer · redline worker (module worker).
   Holds the edition bodies of one series, parses each body once, and answers
   { type: 'diff', id, a, b } with the rendered redline for that pair. Results are cached per pair.
   Progress is posted while a comparison runs so the page can show a light progress state. */
// The page passes ?v=<build> so a changed engine is never served from a stale module cache.
const ENGINE = import('../shared/redline-diff.js' + (self.location.search || ''));
let diffBodies, prepareBody, summarise;

let bodies = [], images = {}, prepared = [], shared = {};
const cache = new Map(), CACHE_MAX = 12;

function prep(i) {
  if (!prepared[i]) prepared[i] = prepareBody(bodies[i], shared);
  return prepared[i];
}

const ready = ENGINE.then(mod => ({ diffBodies, prepareBody, summarise } = mod));
self.onmessage = (e) => { ready.then(() => handle(e), err => self.postMessage({ type: 'error', id: (e.data || {}).id, message: 'Could not load the diff engine: ' + err })); };
function handle(e) {
  const m = e.data || {};
  if (m.type === 'init') {
    bodies = m.bodies || []; images = m.images || {}; prepared = []; shared = {}; cache.clear();
    return;
  }
  if (m.type !== 'diff') return;
  const key = m.a + ':' + m.b;
  try {
    let out = cache.get(key);
    if (!out) {
      let last = 0;
      const progress = (phase, f) => {
        const t = performance.now();
        if (t - last < 60 && f < 1) return;
        last = t;
        self.postMessage({ type: 'progress', id: m.id, phase, f });
      };
      const t0 = performance.now();
      progress('Parsing', 0.02);
      const A = prep(m.a);
      progress('Parsing', 0.5);
      const B = prep(m.b);
      const res = diffBodies(A, B, { images, onProgress: progress });
      out = summarise(res);
      out.stats.ms.worker = Math.round(performance.now() - t0);
      cache.set(key, out);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    }
    self.postMessage({ type: 'result', id: m.id, a: m.a, b: m.b, result: out });
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String((err && err.stack) || err) });
  }
}
