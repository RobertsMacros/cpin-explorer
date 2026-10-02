// Flags as dot matrices, after COBE's dotted globe: each flag (flag-icons SVG, 4:3) is sampled on a
// grid and every sample becomes a round dot of that colour.
//
//   <canvas class="dotflag" data-flag="ir" data-cols="12"></canvas>   then   hydrateFlags(root)
//
// Near-white dots get a faint fill so white stripes still read on a white page (and near-black
// ones a faint lift in dark mode). data-reveal makes the dots pop in one by one.
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

const luminance = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}

export async function drawDotFlag(canvas, code, { cols = 12, reveal = false } = {}) {
  const rows = Math.round((cols * 3) / 4);
  const dots = await sample(code, cols, rows);
  const box = canvas.getBoundingClientRect();
  const cssW = box.width || canvas.clientWidth || cols * 2, cssH = (cssW * rows) / cols;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const pitch = cssW / cols, radius = pitch * 0.4, dark = isDark();
  const fill = (rgb) => {
    const l = luminance(rgb);
    if (!dark && l > 0.9) return "rgb(226 230 236)";        // white stripe: a pale dot, still a dot
    if (dark && l < 0.08) return "rgb(52 58 72)";           // black stripe in dark mode
    return `rgb(${rgb.map(Math.round).join(" ")})`;
  };
  const drawAll = (progress) => {
    ctx.clearRect(0, 0, cssW, cssH);
    dots.forEach((rgb, i) => {
      if (!rgb) return;
      const c = i % cols, r = Math.floor(i / cols);
      // Reveal sweeps diagonally; each dot grows from nothing with a soft overshoot.
      const t = reveal ? Math.min(1, Math.max(0, progress * 1.6 - ((c + r) / (cols + rows)) * 0.6)) : 1;
      if (t <= 0) return;
      const ease = 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
      ctx.beginPath();
      ctx.arc((c + 0.5) * pitch, (r + 0.5) * pitch, radius * Math.max(0, ease), 0, Math.PI * 2);
      ctx.fillStyle = fill(rgb);
      ctx.fill();
    });
  };
  if (!reveal || matchMedia("(prefers-reduced-motion: reduce)").matches) return drawAll(1);
  const start = performance.now(), duration = 700;
  await new Promise((done) => {
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      drawAll(p);
      if (p < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
}

/** Render every <canvas class="dotflag"> under root that has not been drawn yet. */
export function hydrateFlags(root = document, { force = false } = {}) {
  return Promise.all([...root.querySelectorAll("canvas.dotflag")].map((canvas) => {
    if (canvas.dataset.drawn && !force) return null;
    canvas.dataset.drawn = "1";
    return drawDotFlag(canvas, canvas.dataset.flag, {
      cols: Number(canvas.dataset.cols) || 12,
      reveal: canvas.hasAttribute("data-reveal") && !force,
    }).catch((e) => { canvas.dataset.error = String(e?.message || e); canvas.classList.add("dotflag--failed"); });
  }));
}
