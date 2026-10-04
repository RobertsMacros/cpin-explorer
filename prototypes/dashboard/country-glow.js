// The hovered or selected country lit up in its flag's colours: a grid of dots across the country,
// each coloured from the matching point of the flag. A country too small on screen for its flag to
// read (Kuwait, Lebanon) gets a fine outline as well; a large one does not need it. Drawn on a canvas
// laid over the COBE globe (COBE itself only draws land as uniform dots, with no borders).
//
// Calm by design: a country lights up only once the pointer has rested on it (createHoverIntent),
// and one country hands over to the next with a timed, eased crossfade (fadeAt), never a swap.
// Zoomed in, there is room for more: every country in view shows its flag (ambientLevel), and the
// one pointed at is simply the brightest.
import { RADIUS, project, toVector } from "../shared/globe-math.js";

const FLAG_COLS = 48, FLAG_ROWS = 36;

/* ------------------------------------------------------------------ timing (pure) */

export const FADE_IN_MS = 360, FADE_OUT_MS = 380;
/** Smooth both ways (ease-in-out sine): no sudden start, no sudden stop. */
export const easeFade = (t) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));
/** Opacity of a fade at time `now` (ms): eased from `from` to `to`, starting at `t0`, over `dur` ms. */
export function fadeAt({ from, to, t0, dur }, now) {
  if (!(dur > 0) || now >= t0 + dur) return to;
  if (now <= t0) return from;
  return from + (to - from) * easeFade((now - t0) / dur);
}
/** A fade from wherever a layer is now towards `to`; a part-faded layer takes proportionally less time. */
export function retarget(fade, to, now, full) {
  const from = fade ? fadeAt(fade, now) : 0;
  return { from, to, t0: now, dur: full * Math.max(0.35, Math.abs(to - from)) };
}

/**
 * Hover intent: report a country only once the pointer has rested on it.
 *   point(slug, x, y)  the pointer is over `slug` (or nothing: null) at x, y
 *   leave()            the pointer has gone (off the globe)
 *   now(slug)          commit at once (a click, keyboard focus)
 * `onChange(slug)` fires once the pointer has stayed on one country for `delay` ms without travelling
 * more than `slop` px, so sweeping across the globe lights nothing. The country already lit stays lit
 * until the pointer has been off it for `leaveDelay` ms (crossing a strait or a border does not blink
 * it off), and hands straight over if another country is settled on first.
 */
export function createHoverIntent({ onChange, delay = 60, leaveDelay = 180, slop = 9, onCandidate = null,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) }) {
  let current = null, candidate = null, restTimer = null, leaveTimer = null, ax = 0, ay = 0;
  const stop = (id) => { if (id != null) clearTimer(id); return null; };
  const commit = (slug) => {
    restTimer = stop(restTimer); leaveTimer = stop(leaveTimer); candidate = null;
    if (slug !== current) { current = slug; onChange(slug); }
  };
  const away = () => {
    if (current === null || leaveTimer != null) return;
    let waited = false;
    const dark = () => {
      leaveTimer = null;
      // The pointer is settling on another country: give that one rest more, so the two hand over
      // directly instead of going dark for an instant in between.
      if (restTimer != null && !waited) { waited = true; leaveTimer = setTimer(dark, delay); return; }
      if (current !== null) { current = null; onChange(null); }
    };
    leaveTimer = setTimer(dark, leaveDelay);
  };
  return {
    point(slug, x, y) {
      slug ??= null;
      if (slug === current) { restTimer = stop(restTimer); leaveTimer = stop(leaveTimer); candidate = null; return; }
      away();
      if (slug === null) { restTimer = stop(restTimer); candidate = null; return; }
      const hasXY = x != null && y != null;
      const resting = slug === candidate && restTimer != null && !(hasXY && Math.hypot(x - ax, y - ay) > slop);
      if (resting) return;                                        // let the timer run
      if (slug !== candidate) onCandidate?.(slug);
      candidate = slug;
      if (hasXY) { ax = x; ay = y; }
      restTimer = stop(restTimer);
      restTimer = setTimer(() => { restTimer = null; commit(slug); }, delay);
    },
    leave() { restTimer = stop(restTimer); candidate = null; away(); },
    now(slug) { commit(slug ?? null); },
    get current() { return current; },
  };
}

/* ------------------------------------------------------------------ flags when zoomed in (pure) */

/** The zoom at which the flags of the countries in view begin to show, the zoom by which they are fully on, and how strong "on" is. */
// The owner may tune these: these three numbers are the feel of "flags on when zoomed". Zoom runs from 1 (the whole
// globe) to 3.2 (closest). FLAGS_STRENGTH is 0..1: at 1 every flag in view is as bright as the country
// under the pointer; lower keeps the pointed-at country standing out.
export const FLAGS_FROM_ZOOM = 1.5, FLAGS_FULL_ZOOM = 2.2, FLAGS_STRENGTH = 0.9;
/**
 * How strongly every country in view is lit by its flag (0 = not at all, 1 = as strongly as the
 * country pointed at), from the zoom alone: 1 is the whole globe, about 3 is as close as it goes.
 * Eased, so the flags come up with the zoom rather than switching on.
 */
export function ambientLevel(zoom) {
  const t = Math.min(1, Math.max(0, (zoom - FLAGS_FROM_ZOOM) / (FLAGS_FULL_ZOOM - FLAGS_FROM_ZOOM)));
  return FLAGS_STRENGTH * t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ the outline (pure) */

/** A country narrower than this on screen (px) is outlined in full; wider than OUTLINE_GONE_PX, not at all. */
export const OUTLINE_FULL_PX = 18, OUTLINE_GONE_PX = 40;
/**
 * How strongly a country's outline is drawn (0..1), from its size on screen in px. Eased between the
 * two sizes, so zooming in on a small country lets its outline melt away rather than switch off.
 */
export function outlineLevel(px) {
  const t = Math.min(1, Math.max(0, (px - OUTLINE_FULL_PX) / (OUTLINE_GONE_PX - OUTLINE_FULL_PX)));
  return 1 - t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ the dot grid (pure) */

/**
 * Grid points inside one polygon: rings ([lon, lat] arrays: outline first, then holes) scanned row by
 * row, each row's crossings found once and the points between them kept (even-odd rule). The same
 * grid a point-in-polygon test of every point would give, in a fraction of the time (Russia: about
 * 1 ms, against 200 ms with a spherical test per point, which is what made the first click lag).
 * bounds: [[west, south], [east, north]] of the polygon. Returns [{lat, lon}].
 */
export function gridInPolygon(rings, [[w, s], [e, n]], spacing) {
  const wraps = w > e;                                         // crosses the antimeridian: work in 0..360
  const X = (lon) => (wraps && lon < 0 ? lon + 360 : lon);
  const width = wraps ? e + 360 - w : e - w;
  const out = [];
  const xs = [];
  for (let lat = s + spacing / 2; lat < n; lat += spacing) {
    xs.length = 0;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const yi = ring[i][1], yj = ring[j][1];
        if (yi > lat === yj > lat) continue;
        const xi = X(ring[i][0]), xj = X(ring[j][0]);
        xs.push(xi + ((lat - yi) * (xj - xi)) / (yj - yi));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const lonStep = spacing / Math.max(0.3, Math.cos((lat * Math.PI) / 180));
    let k = 0;                                                 // crossings to the west of the point
    for (let x = lonStep / 2; x < width; x += lonStep) {
      const lon = w + x;
      while (k < xs.length && xs[k] <= lon) k++;
      if (k % 2 === 1) out.push({ lat, lon: lon > 180 ? lon - 360 : lon });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ the glow */

const UNLIT = { from: 0, to: 0, t0: 0, dur: 0 };

export function createCountryGlow({ canvas, shapes, codeOf, sampleFlag, geoBounds, isDark,
  reducedMotion = () => false, now = () => performance.now() }) {
  const ctx = canvas.getContext("2d");
  const lands = new Map();                 // slug -> { polygons: [{ coordinates, bounds, width, height }], extent }
  const cache = new Map();                 // slug -> Promise<{ dots, rings, extent }>
  // Every country still visible. Each has two lights: `fade`, the country pointed at or open, and
  // `amb`, one of the countries in view when zoomed in (worth `level`). It shows at the stronger.
  const layers = new Map();                // slug -> { data, batches, fade, amb }
  let target = null, inView = new Set(), level = 0, dirty = true, stroke = null, wasFading = false, blank = true;

  /** A country's landmasses with their bounds, and the width on the globe of its largest, in degrees of arc. */
  function land(slug) {
    if (!lands.has(slug)) {
      const features = shapes.get(slug) ?? [];
      let extent = 0;
      const polygons = features.flatMap((f) => (f.geometry.type === "MultiPolygon" ? f.geometry.coordinates
        : f.geometry.type === "Polygon" ? [f.geometry.coordinates] : [])).map((coordinates) => {
        const bounds = geoBounds({ type: "Polygon", coordinates });
        const [[w, s], [e, n]] = bounds;
        const width = w > e ? e + 360 - w : e - w, height = n - s;
        extent = Math.max(extent, height, width * Math.cos(((s + n) / 2) * (Math.PI / 180)));
        return { coordinates, bounds, width, height };
      });
      lands.set(slug, { features, polygons, extent });
    }
    return lands.get(slug);
  }

  async function build(slug) {
    const { features, polygons, extent } = land(slug);
    if (!features.length) return null;
    const [[W, S], [E, N]] = geoBounds({ type: "FeatureCollection", features });
    const fullWidth = W > E ? E + 360 - W : E - W;
    const flag = await sampleFlag(codeOf(slug), FLAG_COLS, FLAG_ROWS).catch(() => null);
    const dots = [];
    let slice = now();
    // Each landmass separately, spaced for its own size: mainland France gets a fine grid even though
    // France's shape also spans French Guiana and Réunion.
    for (const { coordinates, bounds, width, height } of polygons) {
      const spacing = Math.max(0.22, Math.min(1.6, Math.max(width, height) / 30));
      if (width < spacing && height < spacing) continue;                  // specks: the outline shows them
      for (const { lat, lon } of gridInPolygon(coordinates, bounds, spacing)) {
        // Colour from the flag, mapped over the whole country's extent.
        let gx = lon - W; if (gx < 0) gx += 360;
        const u = Math.min(FLAG_COLS - 1, Math.max(0, Math.floor((gx / fullWidth) * FLAG_COLS)));
        const v = Math.min(FLAG_ROWS - 1, Math.max(0, Math.floor(((N - lat) / (N - S)) * FLAG_ROWS)));
        dots.push({ v: toVector([lat, lon]), rgb: flag?.[v * FLAG_COLS + u] ?? null, spacing });
      }
      if (now() - slice > 6) { await new Promise((r) => setTimeout(r)); slice = now(); }   // never hold a frame up
    }
    return { dots, rings: polygons.flatMap((p) => p.coordinates), extent };
  }

  function colour(rgb, dark) {
    if (!rgb) return dark ? "rgb(120 130 150)" : "rgb(150 160 175)";
    const l = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    if (!dark && l > 0.9) return "rgb(214 219 227)";               // white stripes still read on white
    if (dark && l < 0.08) return "rgb(70 76 92)";
    return `rgb(${rgb[0] | 0} ${rgb[1] | 0} ${rgb[2] | 0})`;
  }
  /** Dots grouped by colour, so a frame is a handful of fills rather than one per dot. */
  function batch(data) {
    const dark = isDark(), by = new Map();
    for (const d of data.dots) {
      const c = colour(d.rgb, dark);
      if (!by.has(c)) by.set(c, []);
      by.get(c).push(d);
    }
    return [...by];
  }
  const fadeMs = (full) => (reducedMotion() ? 0 : full);
  const wanted = (slug) => slug === target || inView.has(slug);

  // Zoomed in, every country in view is wanted at once (thirty of them): built together, with their
  // flags read, they held the page up for several frames. So they are built one at a time, in the
  // order asked, with a breath between; each lights as it is ready. The country pointed at or open
  // never waits its turn.
  const waiting = [];                      // [{ slug, resolve }]
  const awaited = new Set();               // countries whose layer is waiting for its dots
  let working = false;
  async function work() {
    working = true;
    while (waiting.length) {
      const job = waiting.shift(), built = build(job.slug);
      job.resolve(built);
      await built.catch(() => null);
      await new Promise((r) => setTimeout(r));
    }
    working = false;
  }
  /** A country's dots, built once: at once if `urgent`, else in its turn. */
  function dotsOf(slug, urgent) {
    if (!cache.has(slug)) {
      if (urgent) cache.set(slug, build(slug));
      else { cache.set(slug, new Promise((resolve) => waiting.push({ slug, resolve }))); if (!working) work(); }
    } else if (urgent) {
      const i = waiting.findIndex((job) => job.slug === slug);
      if (i >= 0) waiting.splice(i, 1)[0].resolve(build(slug));   // it was waiting its turn: now
    }
    return cache.get(slug);
  }
  /** A layer for this country as soon as its dots are built, if it is still wanted by then: its lights fade in from that moment. */
  function ensure(slug, urgent = false) {
    if (layers.has(slug)) return;
    const built = dotsOf(slug, urgent);
    if (awaited.has(slug)) return;
    awaited.add(slug);
    built.then((data) => {
      awaited.delete(slug);
      canvas.dataset.dots = data?.dots.length ?? 0;               // visible to automated checks
      if (!data || layers.has(slug) || !wanted(slug)) return;
      const t = now(), lit = () => retarget(null, 1, t, fadeMs(FADE_IN_MS));
      layers.set(slug, { data, batches: batch(data), fade: slug === target ? lit() : UNLIT, amb: inView.has(slug) ? lit() : UNLIT });
      dirty = true;
    }).catch((e) => { awaited.delete(slug); canvas.dataset.error = String(e?.message || e); });
  }

  return {
    /**
     * Show this country (or none). The one showing fades out as the new one fades in; a country
     * whose dots are not built yet starts its fade when they are.
     */
    set(slug) {
      slug ??= null;
      if (slug === target) return;
      target = slug;
      const t = now();
      for (const [key, layer] of layers) {
        if (key !== slug && layer.fade.to !== 0) layer.fade = retarget(layer.fade, 0, t, fadeMs(FADE_OUT_MS));
      }
      dirty = true;
      if (!slug) return;
      const showing = layers.get(slug);
      if (showing) showing.fade = retarget(showing.fade, 1, t, fadeMs(FADE_IN_MS));
      else ensure(slug, true);
    },
    /**
     * Zoomed in: light every country in `slugs` (a Set: those in view) at `strength` (ambientLevel).
     * One coming into view fades in, one leaving fades out; the strength itself follows the zoom.
     */
    ambient(slugs, strength) {
      if (strength !== level) { level = strength; dirty = true; }
      inView = slugs;
      const t = now();
      for (const [key, layer] of layers) {
        const to = slugs.has(key) ? 1 : 0;
        if (layer.amb.to !== to) { layer.amb = retarget(layer.amb, to, t, fadeMs(to ? FADE_IN_MS : FADE_OUT_MS)); dirty = true; }
      }
      for (const slug of slugs) ensure(slug);
    },
    /** Build a country's dots ahead of time (the pointer is heading for it). */
    warm(slug) { if (slug && shapes.has(slug)) dotsOf(slug, true); },
    /** The width on the globe of a country's largest landmass, in degrees of arc (0 if it has no shape). */
    extent(slug) { return land(slug).extent; },
    get active() { return layers.size > 0; },
    /** Opacity of each country showing, for automated checks. */
    get levels() {
      const t = now();
      return Object.fromEntries([...layers].map(([k, l]) => [k, +Math.max(fadeAt(l.fade, t), level * fadeAt(l.amb, t)).toFixed(3)]));
    },
    /** Redraw for the current view; returns true while still fading. */
    draw(view, cssSize, dpr, viewChanged) {
      const t = now();
      let fading = false;
      for (const { fade, amb } of layers.values()) if (t < fade.t0 + fade.dur || t < amb.t0 + amb.dur) fading = true;
      if (!viewChanged && !fading && !dirty && !wasFading) return false;   // one more frame after a fade: its end state
      dirty = false; wasFading = fading;
      if (blank && !layers.size) return false;                    // nothing lit, nothing to wipe: the turning globe alone costs nothing here
      if (canvas.width !== Math.round(cssSize * dpr)) { canvas.width = canvas.height = Math.round(cssSize * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssSize, cssSize);
      const scale = view.scale || 1, radiusPx = RADIUS * (cssSize / 2) * scale;   // globe radius on screen
      // globe-math's project(), unrolled: with every country in view lit this runs for thousands of dots a frame.
      const cp = Math.cos(view.phi), sp = Math.sin(view.phi), ct = Math.cos(view.theta), st = Math.sin(view.theta), mid = cssSize / 2;
      for (const [slug, layer] of layers) {
        const pointed = fadeAt(layer.fade, t), seen = fadeAt(layer.amb, t), alpha = Math.max(pointed, level * seen);
        if (alpha < 0.004) {
          if (layer.fade.to === 0 && layer.amb.to === 0 && pointed < 0.004 && seen < 0.004) layers.delete(slug);
          continue;
        }
        for (const [fill, dots] of layer.batches) {
          ctx.fillStyle = fill;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          const rim = [];
          for (const d of dots) {
            const [vx, vy, vz] = d.v;
            const depth = -sp * ct * vx + st * vy + cp * ct * vz;
            if (depth <= 0.02) continue;
            const x = mid + (cp * vx + sp * vz) * radiusPx, y = mid - (sp * st * vx + ct * vy - cp * st * vz) * radiusPx;
            const r = Math.max(0.9, ((d.spacing * Math.PI) / 180) * radiusPx * 0.36);
            if (x < -r || y < -r || x > cssSize + r || y > cssSize + r) continue;   // zoomed past the edge
            if (depth < 0.25) { rim.push(x, y, r, depth * 4); continue; }   // near the horizon: fainter
            ctx.moveTo(x + r, y);
            ctx.arc(x, y, r, 0, Math.PI * 2);
          }
          ctx.fill();
          for (let i = 0; i < rim.length; i += 4) {
            ctx.globalAlpha = alpha * rim[i + 3];
            ctx.beginPath();
            ctx.arc(rim[i], rim[i + 1], rim[i + 2], 0, Math.PI * 2);
            ctx.fill();
          }
        }
        // The outline, for a country too small on screen for its flag to read.
        const outline = outlineLevel(((layer.data.extent * Math.PI) / 180) * radiusPx);
        if (outline < 0.01) continue;
        ctx.globalAlpha = alpha * 0.85 * outline;
        ctx.strokeStyle = stroke ??= getComputedStyle(document.documentElement).getPropertyValue("--blue").trim() || "#2a3cf5";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const ring of layer.data.rings) {
          let prev = null;
          for (const [lon, lat] of ring) {
            const p = project([lat, lon], view);
            if (prev && p.depth > 0 && prev.depth > 0) {
              ctx.moveTo(prev.x * cssSize, prev.y * cssSize);
              ctx.lineTo(p.x * cssSize, p.y * cssSize);
            }
            prev = p;
          }
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      blank = !layers.size;
      return fading;
    },
    /** The theme changed: recolour. */
    refresh() {
      stroke = null;
      for (const layer of layers.values()) layer.batches = batch(layer.data);
      dirty = true;
    },
  };
}
