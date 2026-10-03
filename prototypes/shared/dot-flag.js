// Flags as dot matrices, after COBE's dotted globe: each flag (flag-icons SVG, 4:3) is sampled on a
// grid and every sample becomes a round dot of that colour.
//
//   <canvas class="dotflag" data-flag="ir" data-cols="12"></canvas>   then   hydrateFlags(root)
//
// Near-white dots get a faint fill so white stripes still read on a white page (and near-black
// ones a faint lift in dark mode). data-reveal makes the dots pop in one by one; data-interactive
// makes them scatter away from the pointer and spring back.
import { fetchJson } from "./fetch-json.js";

const FLAGS = new URL("../vendor/flags/flags.json", import.meta.url);   // { code: svg source }
let sources = null;
const images = new Map();
const samples = new Map();

function loadFlag(code) {
  sources ??= fetchJson(FLAGS).catch((error) => { sources = null; images.clear(); throw error; });
  if (!images.has(code)) {
    images.set(code, sources.then((all) => new Promise((resolve, reject) => {
      if (!all[code]) return reject(new Error(`no flag for ${code}`));
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`flag ${code} did not decode`));
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(all[code])}`;
    })));
  }
  return images.get(code);
}

/** Average colour of each grid cell, sampled at 4× so stripes and emblems blend sensibly. */
async function sample(code, cols, rows) {
  const key = `${code}:${cols}x${rows}`;
  if (!samples.has(key)) {
    samples.set(key, loadFlag(code).then((img) => {
      const k = 4, w = cols * k, h = rows * k;
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data;
      const dots = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let R = 0, G = 0, B = 0, A = 0;
          for (let y = r * k; y < (r + 1) * k; y++) {
            for (let x = c * k; x < (c + 1) * k; x++) {
              const i = (y * w + x) * 4, a = px[i + 3] / 255;
              R += px[i] * a; G += px[i + 1] * a; B += px[i + 2] * a; A += a;
            }
          }
          dots.push(A < k * k * 0.4 ? null : [R / A, G / A, B / A]);   // mostly transparent: no dot
        }
      }
      return dots;
    }));
  }
  return samples.get(key);
}

/** A flag's colours on a cols×rows grid ([r, g, b] or null where transparent), for other drawings. */
export const sampleFlag = (code, cols, rows) => sample(code, cols, rows);

const luminance = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}

export async function drawDotFlag(canvas, code, { cols = 12, reveal = false, interactive = false } = {}) {
  const rows = Math.round((cols * 3) / 4);
  const samples = await sample(code, cols, rows);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The flag's own size is measured once; interactive flags then get a margin to scatter into,
  // added outside the layout box so nothing around them moves.
  if (!canvas.dataset.flagWidth) {
    canvas.dataset.flagWidth = canvas.getBoundingClientRect().width || canvas.clientWidth || cols * 2;
  }
  const flagW = Number(canvas.dataset.flagWidth), flagH = (flagW * rows) / cols;
  const pad = interactive && !reduced ? Math.round(flagW * 0.22) : 0;
  if (pad) Object.assign(canvas.style, { width: `${flagW + 2 * pad}px`, margin: `-${pad}px` });
  const W = flagW + 2 * pad, H = flagH + 2 * pad;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pitch = flagW / cols, radius = pitch * 0.4, dark = isDark();
  const fill = (rgb) => {
    const l = luminance(rgb);
    if (!dark && l > 0.9) return "rgb(226 230 236)";        // white stripe: a pale dot, still a dot
    if (dark && l < 0.08) return "rgb(52 58 72)";           // black stripe in dark mode
    return `rgb(${rgb.map(Math.round).join(" ")})`;
  };
  const dots = [];
  samples.forEach((rgb, i) => {
    if (!rgb) return;
    const c = i % cols, r = Math.floor(i / cols);
    dots.push({ x: pad + (c + 0.5) * pitch, y: pad + (r + 0.5) * pitch, c, r, color: fill(rgb), ox: 0, oy: 0, vx: 0, vy: 0 });
  });
  const draw = (scaleOf = () => 1) => {
    ctx.clearRect(0, 0, W, H);
    for (const d of dots) {
      const s = scaleOf(d);
      if (s <= 0) continue;
      ctx.beginPath();
      ctx.arc(d.x + d.ox, d.y + d.oy, radius * s, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
    }
  };
  if (reveal && !reduced) {
    // Reveal sweeps diagonally; each dot grows from nothing with a soft overshoot.
    const start = performance.now(), duration = 700;
    await new Promise((done) => {
      const step = (now) => {
        const p = Math.min(1, (now - start) / duration);
        draw((d) => {
          const t = Math.min(1, Math.max(0, p * 1.6 - ((d.c + d.r) / (cols + rows)) * 0.6));
          return t <= 0 ? 0 : Math.max(0, 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2);
        });
        if (p < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
  } else {
    draw();
  }
  if (pad) attachScatter(canvas, { dots, draw, pitch, flagW });
}

// Dots flee the pointer and spring back (slightly underdamped, so they overshoot and settle) when it
// leaves; entering the flag sends a ripple out from that point. The loop runs only while dots move.
const K = 190;                                              // spring stiffness

// Tunable (prototypes/flags/ has sliders). strength scales the push and the ripple; reach is the
// radius of influence as a share of the flag's width (the ripple dies away over about twice that);
// bounce 0 = no overshoot, 1 = very springy.
// 3 Oct 2026, owner: first "stronger, with less reach" (1.2 / 0.14 / 0.6), then on seeing it "increase
// strength, reduce reach again, increase bounce": a sharp, very local push with a lively spring-back.
export const DEFAULT_SCATTER = { strength: 1.7, reach: 0.09, bounce: 0.8 };
// The key carries a version: a value saved under earlier defaults or an earlier model must not silently
// keep the old feel ("cpin-flag-scatter", 2 Oct 2026: 0.8 / 0.22 / 0.6; "-v2": 1.2 / 0.14 / 0.6).
export const SCATTER_KEY = "cpin-flag-scatter-v3";
const OLD_SCATTER_KEYS = ["cpin-flag-scatter", "cpin-flag-scatter-v2"];
const SCATTER_RANGE = { strength: [0, 3], reach: [0.02, 0.4], bounce: [0, 1] };

/** The saved settings (this version's key only), clamped to the sliders' ranges; older keys are dropped. */
export function loadScatterSettings(storage) {
  const settings = { ...DEFAULT_SCATTER };
  try {
    for (const key of OLD_SCATTER_KEYS) storage?.removeItem(key);
    const saved = JSON.parse(storage?.getItem(SCATTER_KEY) || "{}");
    for (const [name, [lo, hi]] of Object.entries(SCATTER_RANGE)) {
      const v = Number(saved?.[name]);
      if (saved?.[name] != null && Number.isFinite(v)) settings[name] = Math.min(hi, Math.max(lo, v));
    }
  } catch {}
  return settings;
}
const storage = () => { try { return globalThis.localStorage; } catch { return null; } };
export const scatterSettings = loadScatterSettings(storage());
export function setScatterSettings(next) {
  Object.assign(scatterSettings, next);
  try { storage()?.setItem(SCATTER_KEY, JSON.stringify(scatterSettings)); } catch {}
}

/** Advance every dot by dt seconds. state: { dots, mouse, ripple, flagW, pitch }. Returns total speed. */
export function scatterStep(state, dt, now) {
  const { strength, bounce } = scatterSettings;
  const reach = state.flagW * scatterSettings.reach;
  const C = 2 * (1 - 0.8 * bounce) * Math.sqrt(K);          // damping from the bounce setting
  // The push no longer shrinks with the reach: a small reach still shoves the nearest dots well clear.
  const shove = (0.3 * reach + 0.055 * state.flagW) * strength;
  let energy = 0;
  for (const d of state.dots) {
    let tx = 0, ty = 0;
    if (state.mouse) {
      const dx = d.x - state.mouse.x, dy = d.y - state.mouse.y, dist = Math.hypot(dx, dy) || 0.001;
      if (dist < reach) {
        const push = (1 - dist / reach) ** 2 * shove;
        tx = (dx / dist) * push; ty = (dy / dist) * push;
      }
    }
    if (state.ripple) {
      const age = (now - state.ripple.t0) / 1000;
      const dx = d.x - state.ripple.x, dy = d.y - state.ripple.y, dist = Math.hypot(dx, dy) || 0.001;
      const front = age * state.flagW * 1.5;
      // A ring that travels out and dies away with distance (within about twice the reach) and with time.
      const wave = Math.exp(-((dist - front) ** 2) / (2 * (state.pitch * 1.4) ** 2))
        * Math.exp(-dist / (reach * 2.2)) * Math.exp(-age * 2.4) * 2.2;
      tx += (dx / dist) * wave * state.pitch * strength; ty += (dy / dist) * wave * state.pitch * strength;
      if (age > 1.1) state.ripple = null;
    }
    d.vx += (K * (tx - d.ox) - C * d.vx) * dt;
    d.vy += (K * (ty - d.oy) - C * d.vy) * dt;
    d.ox += d.vx * dt; d.oy += d.vy * dt;
    energy += Math.abs(d.vx) + Math.abs(d.vy);
  }
  return energy;
}

function attachScatter(canvas, geometry) {
  if (canvas._scatter) { Object.assign(canvas._scatter, geometry); return; }   // redrawn (e.g. theme change)
  const st = canvas._scatter = { ...geometry, mouse: null, ripple: null, running: false, last: 0 };
  const local = (e) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  const kick = () => {
    if (st.running) return;
    st.running = true;
    st.last = performance.now();
    requestAnimationFrame(tick);
  };
  canvas.addEventListener("pointerenter", (e) => { st.mouse = local(e); st.ripple = { ...st.mouse, t0: performance.now() }; kick(); });
  canvas.addEventListener("pointermove", (e) => { st.mouse = local(e); kick(); });
  canvas.addEventListener("pointerleave", () => { st.mouse = null; kick(); });
  function tick(now) {
    const dt = Math.min(0.033, (now - st.last) / 1000);
    st.last = now;
    const energy = scatterStep(st, dt, now);
    st.draw();
    if (st.ripple || energy > 0.6) requestAnimationFrame(tick);
    else st.running = false;
  }
}

function hydrateOne(canvas, force) {
  canvas.dataset.drawn = "1";
  return drawDotFlag(canvas, canvas.dataset.flag, {
    cols: Number(canvas.dataset.cols) || 12,
    reveal: canvas.hasAttribute("data-reveal") && !force,
    interactive: canvas.hasAttribute("data-interactive"),
  }).catch((e) => { canvas.dataset.error = String(e?.message || e); canvas.classList.add("dotflag--failed"); });
}

// Lazy hydration: a flag is drawn when it comes into view, a few per frame, so a long list of them
// (every country, a page of search results) never holds up whatever else is moving.
const FRAME_BUDGET_MS = 3;
const queue = new Set();
let pumping = false, observer = null;
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
async function pump() {
  pumping = true;
  await nextFrame();
  let t0 = performance.now();
  while (queue.size) {
    const canvas = queue.values().next().value;
    queue.delete(canvas);
    if (!canvas.isConnected) continue;
    const force = canvas.dataset.force === "1";
    delete canvas.dataset.force;
    const drawn = hydrateOne(canvas, force);
    if (force || !canvas.hasAttribute("data-reveal")) await drawn;      // a reveal animates on its own
    if (performance.now() - t0 > FRAME_BUDGET_MS) { await nextFrame(); t0 = performance.now(); }
  }
  pumping = false;
}
function lazyObserver() {
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      queue.add(entry.target);
    }
    if (queue.size && !pumping) pump();
  }, { rootMargin: "120px" });
  return observer;
}

/**
 * Render every <canvas class="dotflag"> under root that has not been drawn yet.
 * lazy: draw each flag only once it is on screen, spreading the drawing over frames.
 * force: draw again (a theme change).
 */
export function hydrateFlags(root = document, { force = false, lazy = false } = {}) {
  const canvases = [...root.querySelectorAll("canvas.dotflag")].filter((canvas) => force || !canvas.dataset.drawn);
  if (lazy && typeof IntersectionObserver === "function") {
    const io = lazyObserver();
    for (const canvas of canvases) {
      if (force) {
        if (!canvas.dataset.drawn) continue;      // still waiting to come into view: drawn in the new colours then
        canvas.dataset.force = "1";
      }
      io.unobserve(canvas);
      io.observe(canvas);
    }
    return Promise.resolve();
  }
  return Promise.all(canvases.map((canvas) => hydrateOne(canvas, force)));
}
