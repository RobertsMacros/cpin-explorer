// CPIN Explorer · the minimap: a slim strip at the edge of the reading column that maps the whole text at a
// glance (section ticks, insertions and deletions, saved highlights, find hits, dead sources), with a window
// showing what is on screen. Click or drag it to travel; hover it to see which section is where.
//
//   const mm = new Minimap(host, { doc, collect, insetTop, busy, onSeek, labelRoom, positioner });
//   mm.schedule({ fade: true });      // after anything that changes the text, its marks or the layout
//
// Long notes are laid out lazily (content-visibility: auto), so positions come from each chunk's own box and,
// inside chunks the browser is skipping, are estimated from text offsets: nothing here forces a skipped chunk
// to lay out. layoutMarks() turns document positions into strip rectangles, merging marks of one kind that
// would touch at strip resolution, so a note with hundreds of changes draws a few dozen rectangles on one
// canvas. Positions are read once per build; scrolling only moves the window (one transform per frame).
//
// Display only: the strip is aria-hidden and holds nothing focusable. The contents list and j/k (next change,
// next match) are the keyboard routes to the same places.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ pure layout (unit-tested) */

/**
 * Strip rectangles for marks given in document pixels: [{ kind, y0, y1?, weight? }] -> [{ kind, top, bottom,
 * n, weight, mark }] in strip pixels, snapped to device pixels (`px`). Spans shorter than `minSize` grow about
 * their centre; marks of one kind that overlap or come within `gap` of each other merge into one rectangle that
 * counts them (`n`) and sums their `weight`. Kinds listed in `points` are ticks: one device pixel tall, never
 * grown by merging; a tick within `pointGap` of the one kept before it is dropped (`n` still counts it).
 */
export function layoutMarks(marks, { docHeight, height, px = 1, minSize = 2, gap = 1, points = [], pointGap = 3 } = {}) {
  const out = [];
  if (!(docHeight > 0) || !(height > 0) || !Array.isArray(marks)) return out;
  const k = height / docHeight, isPoint = new Set(points);
  const snap = (v) => Math.round(v / px) * px;
  const groups = new Map();
  for (const m of marks) {
    if (!m || !Number.isFinite(m.y0)) continue;
    const point = isPoint.has(m.kind);
    let top = m.y0 * k;
    let bottom = point ? top + px : (Number.isFinite(m.y1) ? Math.max(m.y0, m.y1) : m.y0) * k;
    if (!point && bottom - top < minSize) { const c = (top + bottom) / 2; top = c - minSize / 2; bottom = c + minSize / 2; }
    const size = Math.min(bottom - top, height);
    const at = clamp(top, 0, height - size);
    top = snap(at);
    bottom = Math.min(snap(height), Math.max(top + px, snap(at + size)));
    if (bottom - top < px) top = bottom - px;
    let list = groups.get(m.kind);
    if (!list) groups.set(m.kind, (list = []));
    list.push({ top, bottom, weight: Number.isFinite(m.weight) ? m.weight : 1, mark: m });
  }
  for (const [kind, list] of groups) {
    const point = isPoint.has(kind);
    list.sort((a, b) => a.top - b.top || b.bottom - a.bottom);
    let cur = null;
    for (const r of list) {
      if (cur && r.top <= (point ? cur.top + pointGap : cur.bottom + gap)) {
        if (!point) cur.bottom = Math.max(cur.bottom, r.bottom);
        cur.n += 1; cur.weight += r.weight;
        continue;
      }
      cur = { kind, top: r.top, bottom: r.bottom, n: 1, weight: r.weight, mark: r.mark };
      out.push(cur);
    }
  }
  return out;
}

/** A y for a text offset, by straight lines between anchors [{ off, y }] sorted by offset; flat beyond the ends. */
export function interpolate(anchors, off) {
  const n = anchors?.length || 0;
  if (!n || !Number.isFinite(off)) return 0;
  if (off <= anchors[0].off) return anchors[0].y;
  if (off >= anchors[n - 1].off) return anchors[n - 1].y;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (anchors[mid].off <= off) lo = mid; else hi = mid; }
  const a = anchors[lo], b = anchors[hi];
  return b.off === a.off ? a.y : a.y + ((b.y - a.y) * (off - a.off)) / (b.off - a.off);
}

/** Sort anchors by offset and make y never go back up (a chunk measured out of step cannot fold the map). */
export function monotonic(anchors) {
  const out = anchors.filter((a) => Number.isFinite(a.off) && Number.isFinite(a.y)).sort((a, b) => a.off - b.off || a.y - b.y);
  for (let i = 1; i < out.length; i++) if (out[i].y < out[i - 1].y) out[i] = { ...out[i], y: out[i - 1].y };
  return out;
}

/** Index of the last item whose y is at or above `y` (items sorted by y), or -1 above the first. */
export function sectionIndex(items, y) {
  let lo = 0, hi = (items?.length || 0) - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].y <= y) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/**
 * Labels that fit beside the strip without overlapping: items [{ y, rank? }] in strip pixels, each `size` tall
 * and centred on its y (kept inside 0..height). Lower ranks are placed first (main sections before
 * subsections), then top to bottom. Returns the kept items, top to bottom, each with `at`, its centre.
 */
export function cullLabels(items, { size, gap = 2, height = Infinity } = {}) {
  if (!(size > 0) || !items?.length) return [];
  const half = size / 2, step = size + gap;
  const order = items.map((it) => ({ it, at: clamp(it.y, half, Math.max(half, height - half)) }))
    .sort((a, b) => (a.it.rank ?? 0) - (b.it.rank ?? 0) || a.at - b.at);
  const kept = [];
  for (const c of order) if (kept.every((x) => Math.abs(x.at - c.at) >= step)) kept.push(c);
  return kept.sort((a, b) => a.at - b.at).map((c) => ({ ...c.it, at: c.at }));
}

/* ------------------------------------------------------------------ positions in a lazily laid-out text */

const rendered = (el) => (typeof el.checkVisibility === "function" ? el.checkVisibility({ contentVisibilityAuto: true }) : true);

/**
 * Where things are in `doc`, in pixels from its top, measured once. The text is split into chunks (`chunks`)
 * that the browser may skip while off screen. A chunk's own box is always laid out, so it is read directly;
 * inside a rendered chunk elements are read directly too; inside a skipped one they are placed by their text
 * offset (`offsetOf(el)`, offsets in the same index as `length`) between the chunks' tops. Chunks matching
 * `stacked` hold blocks one below the other (they add an anchor per block when rendered); other chunks (a
 * side-by-side row) hold `column`s next to each other, and are placed by the offset within the column.
 */
export class DocPositioner {
  constructor(doc, { chunks = ".cv, .sbs-row", stacked = ".cv", column = ".sbs-cell", offsetOf = () => null, length = null } = {}) {
    this.doc = doc; this.chunkSel = chunks; this.stackedSel = stacked; this.columnSel = column; this.offsetOf = offsetOf; this.length = length;
    const box = doc.getBoundingClientRect();
    this.view = box.top;                         // the doc's top in the viewport, while measuring
    this.top = box.top + scrollY;                // ... and in the page
    this.height = box.height;
    this.info = new Map();                       // chunks are measured when first needed
    this.anchors = null;                         // ... and the offset map only when an offset is placed
  }
  chunk(c) {
    let inf = this.info.get(c);
    if (inf) return inf;
    const b = c.getBoundingClientRect(), first = c.firstElementChild;
    inf = { top: b.top - this.view, bottom: b.bottom - this.view, stacked: c.matches(this.stackedSel), skipped: first ? !rendered(first) : false };
    this.info.set(c, inf);
    return inf;
  }
  /** Text offset -> y anchors: every chunk's top, and every block's top inside rendered stacked chunks. */
  map() {
    if (this.anchors) return this.anchors;
    const anchors = [{ off: 0, y: 0 }];
    for (const c of this.doc.querySelectorAll(this.chunkSel)) {
      const inf = this.chunk(c), off = this.offsetOf(c);
      if (off != null) anchors.push({ off, y: inf.top });
      if (inf.stacked && !inf.skipped) {
        for (const child of c.children) {
          const o = this.offsetOf(child);
          if (o != null) anchors.push({ off: o, y: child.getBoundingClientRect().top - this.view });
        }
      }
    }
    if (Number.isFinite(this.length)) anchors.push({ off: this.length, y: this.height });
    return (this.anchors = monotonic(anchors));
  }
  /** y for a text offset. */
  yAt(off) { return interpolate(this.map(), off); }
  /** [top, bottom] of an element. */
  yOf(el) {
    const chunk = el.closest(this.chunkSel);
    const inf = chunk && this.doc.contains(chunk) ? this.chunk(chunk) : null;
    if (!inf) return this.rect(el);
    if (chunk === el) return [inf.top, inf.bottom];
    if (!inf.skipped) return this.rect(el);
    const fit = ([a, b]) => [clamp(a, inf.top, inf.bottom), clamp(b, inf.top, inf.bottom)];
    const off = this.offsetOf(el);
    const len = el.textContent.length;
    if (inf.stacked) {
      if (off == null) return [inf.top, inf.top];
      return fit([this.yAt(off), this.yAt(off + len)]);
    }
    // A skipped side-by-side row: as far down its column as the element's text is through the column's.
    const col = el.closest(this.columnSel);
    const colOff = col && chunk.contains(col) ? this.offsetOf(col) : null;
    const colLen = col ? col.textContent.length : 0;
    if (off == null || colOff == null || !colLen) return [inf.top, inf.bottom];
    const h = inf.bottom - inf.top;
    return fit([inf.top + h * clamp((off - colOff) / colLen, 0, 1), inf.top + h * clamp((off - colOff + len) / colLen, 0, 1)]);
  }
  rect(el) {
    const b = el.getBoundingClientRect();
    return [b.top - this.view, b.bottom - this.view];
  }
}

/* ------------------------------------------------------------------ the strip */

// Kinds of mark, in drawing order. Colours come from CSS (--mm-*), so dark mode and the theme switch just work.
const ORDER = ["h3", "dead", "mod", "del", "ins", "h2", "hl", "find", "find-cur"];
const COLOURS = { tick: "--mm-tick", ins: "--mm-ins", del: "--mm-del", mod: "--mm-mod", hl: "--mm-hl", find: "--mm-find", cur: "--mm-cur", dead: "--mm-dead", bg: "--bg" };
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 300 }) : setTimeout(fn, 30));

export class Minimap {
  /**
   * host: an empty element placed beside the text (CSS in minimap.css). Options:
   *   doc         the element mapped (the article holding the text)
   *   collect     (pos) => ({ sections: [{ y, label, level, count? }], marks: [{ kind, y0, y1?, weight? }] }),
   *               positions in document pixels, from pos.yOf(el) / pos.yAt(offset)
   *   positioner  (doc) => a DocPositioner for the text shown
   *   insetTop    () => pixels of sticky chrome covering the top of the window
   *   busy        () => true while rebuilding would cost frames (something else is animating): the strip dims and waits
   *   onSeek      () => called when the strip starts to move the page (stop other scroll animations)
   *   labelRoom   (stripRect) => pixels free to the right of the strip (section labels when there is room)
   *   observe     more elements whose size moves the text (a ResizeObserver rebuilds after they change)
   */
  constructor(host, opts) {
    this.host = host;
    this.o = { insetTop: () => 0, busy: () => false, onSeek: () => {}, labelRoom: null, observe: [], collect: () => ({}),
      positioner: (doc) => new DocPositioner(doc), ...opts };
    this.doc = opts.doc;
    host.classList.add("minimap", "is-empty");
    host.setAttribute("aria-hidden", "true");
    host.innerHTML = `<div class="mm-stick"><div class="mm-track"></div><canvas class="mm-canvas"></canvas>
      <div class="mm-view"></div><div class="mm-hover"></div><ol class="mm-labels"></ol>
      <div class="mm-tip"><span class="tag"><span class="mm-tip-t"></span><span class="mm-tip-n"></span></span></div><i class="mm-probe"></i></div>`;
    const q = (s) => host.querySelector(s);
    this.stick = q(".mm-stick"); this.track = q(".mm-track"); this.canvas = q(".mm-canvas"); this.view = q(".mm-view");
    this.hoverLine = q(".mm-hover"); this.tip = q(".mm-tip"); this.tipT = q(".mm-tip-t"); this.tipN = q(".mm-tip-n");
    this.labels = q(".mm-labels"); this.probe = q(".mm-probe");
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)");
    this.h = 0; this.w = 0; this.docH = 0; this.docTop = 0; this.inset = 0; this.vh = innerHeight;
    this.sections = []; this.marks = []; this.kept = []; this.viewT = 0; this.viewB = 0; this.viewH = -1; this.viewOn = false; this.onLabel = -1;
    this.timer = 0; this.fade = false; this.dirty = true; this.anim = null; this.drag = null; this.tipFor = -2;

    // Scroll: only the window moves, once per frame, from cached numbers.
    this.rafView = 0;
    addEventListener("scroll", () => { if (!this.rafView) this.rafView = requestAnimationFrame(() => this.paintView()); }, { passive: true });
    addEventListener("resize", () => { this.vh = innerHeight; this.schedule(); }, { passive: true });
    // The text lays out lazily and things above it open and close: follow its real size, debounced.
    const ro = new ResizeObserver(() => this.schedule());
    for (const el of [this.doc, this.stick, ...this.o.observe]) if (el) ro.observe(el);
    // Theme: colours are read from CSS when drawing.
    new MutationObserver(() => this.redraw()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.redraw());
    // Another way of scrolling takes over from a glide in progress.
    const cancel = () => { if (!this.drag) this.stopAnim(); };
    addEventListener("wheel", cancel, { passive: true });
    addEventListener("touchstart", (e) => { if (!this.stick.contains(e.target)) cancel(); }, { passive: true });
    addEventListener("keydown", cancel);
    this.wirePointer();
  }

  /** Rebuild soon (debounced, in idle time). `fade`: the marks are for a different text, so ease them in. */
  schedule({ fade = false } = {}) {
    this.fade ||= fade;
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => idle(() => this.build()), 140);
  }

  visible() { return this.host.offsetParent !== null && this.stick.clientHeight > 0; }

  build() {
    if (!this.visible() || !this.doc?.isConnected) return;
    if (this.o.busy()) { this.host.classList.add("is-stale"); return; }        // rebuilt once it is free
    if (this.drag || this.anim) { this.schedule(); return; }                    // not while it is moving the page
    this.dirty = false;
    this.builds = (this.builds || 0) + 1;
    const t0 = performance.now();
    this.h = this.stick.clientHeight; this.w = this.stick.clientWidth;
    this.geom = { l: this.track.offsetLeft, r: this.track.offsetLeft + this.track.offsetWidth };
    this.inset = this.o.insetTop(); this.vh = innerHeight;
    let data = {};
    let pos = null;
    try {
      pos = this.o.positioner(this.doc);
      data = this.o.collect(pos) || {};
    } catch (err) { console.warn("minimap:", err); }
    this.docTop = pos?.top ?? 0; this.docH = pos?.height ?? 0;
    this.maxScroll = document.documentElement.scrollHeight - innerHeight;
    this.sections = (data.sections || []).filter((s) => Number.isFinite(s.y)).sort((a, b) => a.y - b.y);
    this.marks = data.marks || [];
    this.host.classList.toggle("is-empty", !(this.docH > this.vh * 1.2));       // a short text needs no map
    this.host.classList.toggle("is-changes", !!data.changes);
    this.host.classList.remove("is-stale");
    this.draw();
    this.placeLabels();
    this.tipFor = -2;
    this.paintView();
    if (this.fade && !this.reduced.matches) {
      this.canvas.animate([{ opacity: 0.15 }, { opacity: 1 }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
      if (this.kept.length) this.labels.animate([{ opacity: 0, filter: "blur(3px)" }, { opacity: 1, filter: "blur(0)" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
    this.fade = false;
    this.cost = performance.now() - t0;
  }

  /** Colours changed (theme): draw again from what was collected. */
  redraw() { if (this.h) requestAnimationFrame(() => this.draw()); }

  palette() {
    const out = {};
    for (const [k, v] of Object.entries(COLOURS)) { this.probe.style.color = `var(${v})`; out[k] = getComputedStyle(this.probe).color; }
    return out;
  }

  draw() {
    const dpr = clamp(devicePixelRatio || 1, 1, 3), w = this.w, h = this.h, c = this.canvas;
    if (!w || !h) return;
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!this.docH) return;
    const px = 1 / dpr, col = this.palette();
    const { l, r } = this.geom;
    const L = l + 1, R = r - 1, mid = (L + R) / 2;                // inside the track's hairline border
    const rects = layoutMarks(this.marks, { docHeight: this.docH, height: h, px, minSize: 2, gap: 1, points: ["h2", "h3"], pointGap: 3 });
    this.drawn = rects.reduce((o, m) => { o[m.kind] = (o[m.kind] || 0) + 1; return o; }, {});
    // Lanes: [left, right, colour, alpha]. Main section ticks are drawn over the changes (cut through them in
    // page colour, then a faint hairline), and also tick the left edge outside the track, like a ruler.
    const lanes = {
      h2: [L, R, "tick", 0.5], h3: [L, L + (R - L) * 0.45, "tick", 0.35],
      dead: [L, L + 2, "dead", 0.75],
      mod: [L + 1.5, R - 1.5, "mod", 0.45],
      del: [L + 1.5, mid - 0.5, "del", 0], ins: [mid + 0.5, R - 1.5, "ins", 0],
      hl: [l - 4, l - 1, "hl", 1],
      find: [r + 1, r + 4, "find", 0.8], "find-cur": [r + 1, r + 5, "cur", 1],
    };
    const fill = (kind, lane, alpha) => {
      ctx.fillStyle = col[lane[2]];
      for (const m of rects) {
        if (m.kind !== kind) continue;
        // Changes grow stronger where several merge; single ones stay readable.
        ctx.globalAlpha = alpha ?? (lane[3] || Math.min(1, 0.62 + 0.13 * (m.n - 1)));
        const top = kind === "find-cur" ? Math.min(m.top, h - 3) : m.top;
        const height = kind === "find-cur" ? Math.max(3, m.bottom - m.top) : m.bottom - m.top;
        ctx.fillRect(lane[0], top, lane[1] - lane[0], height);
      }
    };
    for (const kind of ORDER) {
      if (!lanes[kind]) continue;
      if (kind === "h2") { fill(kind, [L, R, "bg"], 1); fill(kind, [l - 3, l, "tick"], 0.75); }
      fill(kind, lanes[kind]);
    }
    ctx.globalAlpha = 1;
  }

  /** Wide screens: main section names beside the strip, where they fall. */
  placeLabels() {
    const room = this.o.labelRoom && this.h ? this.o.labelRoom(this.stick.getBoundingClientRect()) : 0;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const on = room >= rem * 9 && this.sections.length > 1 && this.docH > 0;
    this.host.classList.toggle("has-labels", on);
    this.kept = [];
    this.onLabel = -1;
    if (!on) { this.labels.replaceChildren(); return; }
    this.labels.style.width = `${Math.min(room - rem * 1.2, rem * 18)}px`;
    const size = rem * 1.15;
    const items = this.sections.map((s, i) => ({ y: (s.y / this.docH) * this.h, rank: s.level === 2 ? 0 : 1, i, s }))
      .filter((x) => x.s.level <= 3 && x.s.label);
    this.kept = cullLabels(items, { size, gap: rem * 0.2, height: this.h });
    const frag = document.createDocumentFragment();
    for (const k of this.kept) {
      const li = document.createElement("li");
      li.className = `mm-label l${k.s.level}`;
      li.dataset.i = k.i;
      li.style.transform = `translateY(${(k.at - size / 2).toFixed(1)}px)`;
      li.style.setProperty("--tick", `${(k.y - k.at + size / 2).toFixed(1)}px`);
      const t = document.createElement("span");
      t.className = "mm-label-t";
      t.textContent = k.s.label;
      li.append(t);
      if (k.s.count) { const n = document.createElement("span"); n.className = "mm-label-n"; n.textContent = k.s.count; li.append(n); }
      frag.append(li);
    }
    this.labels.replaceChildren(frag);
  }

  /** The window: what part of the text is on screen. Every frame while scrolling; reads nothing from layout. */
  paintView() {
    this.rafView = 0;
    if (!this.docH || !this.h) return;
    const y = this.anim ? this.anim.y : scrollY;
    const top = (y + this.inset - this.docTop) / this.docH, bot = (y + this.vh - this.docTop) / this.docH;
    const t = clamp(top, 0, 1) * this.h, b = clamp(bot, 0, 1) * this.h;
    this.viewT = t; this.viewB = b;
    const on = b - t > 0.5;
    if (on !== this.viewOn) { this.view.classList.toggle("on", on); this.viewOn = on; }
    const hh = Math.max(4, b - t);
    const ty = Math.min(t, this.h - hh);
    this.view.style.transform = `translate3d(0, ${ty.toFixed(2)}px, 0)`;
    if (Math.abs(hh - this.viewH) > 0.25) { this.view.style.height = `${hh.toFixed(2)}px`; this.viewH = hh; }
    if (this.kept.length) {
      const docY = y + this.inset - this.docTop + (this.vh - this.inset) * 0.22;
      const i = sectionIndex(this.sections, docY);
      let on = -1;
      for (const k of this.kept) { if (k.i <= i) on = k.i; else break; }
      if (on !== this.onLabel) {
        this.labels.querySelector(".is-on")?.classList.remove("is-on");
        if (on >= 0) this.labels.querySelector(`[data-i="${on}"]`)?.classList.add("is-on");
        this.onLabel = on;
      }
    }
  }

  /* ---- travel ------------------------------------------------------------------------------------ */

  /** The text's box now: chunks drawn since the last build change its height, so travel re-reads it (once per
   *  pointer event or glide, not per frame). */
  measure() {
    const b = this.doc.getBoundingClientRect();
    if (b.height > 0) { this.docTop = b.top + scrollY; this.docH = b.height; }
    this.maxScroll = document.documentElement.scrollHeight - innerHeight;
  }
  /** Page scroll that puts the point `frac` of the way down the text in the middle of the visible text (or a
   *  document y near its top, for a section). */
  scrollFor(frac, align = "center") {
    const vis = this.vh - this.inset;
    const docY = align === "center" ? clamp(frac, 0, 1) * this.docH : frac;
    const y = this.docTop + docY - this.inset - (align === "center" ? vis / 2 : 16);
    return clamp(y, 0, Math.max(0, this.maxScroll));
  }
  /** Travel to `frac` of the way down the text: a short eased glide, or following a drag closely; straight
   *  there with reduced motion. A glide re-aims at its end if the text changed height on the way. */
  seek(frac, mode, align = "center") {
    const target = this.scrollFor(frac, align);
    if (this.reduced.matches) { this.stopAnim(); scrollTo(0, target); return; }
    const now = performance.now();
    if (mode === "follow" && this.anim?.mode === "follow") { this.anim.to = target; this.anim.frac = frac; return; }
    const from = this.anim?.y ?? scrollY;
    if (this.anim) cancelAnimationFrame(this.anim.raf);
    this.anim = mode === "follow"
      ? { mode, y: from, to: target, t: now, frac, align }
      : { mode, y: from, from, to: target, t0: now, frac, align, dur: Math.min(820, 260 + Math.sqrt(Math.abs(target - from)) * 2.2) };
    this.anim.raf = requestAnimationFrame((t) => this.tick(t));
  }
  tick(now) {
    const a = this.anim;
    if (!a) return;
    a.raf = 0;
    if (a.mode === "glide") {
      const p = Math.min(1, (now - a.t0) / a.dur);
      a.y = a.from + (a.to - a.from) * easeInOut(p);
      scrollTo(0, a.y);
      if (p >= 1) {
        this.measure();
        const to = this.scrollFor(a.frac, a.align);
        if (Math.abs(to - a.y) > 1.5) Object.assign(a, { mode: "follow", to, t: now });   // settle, gently
        else { this.anim = null; this.paintView(); return; }
      }
    } else {
      // Ease toward the pointer: frame-rate independent, quick enough to feel attached, never a jump.
      const dt = Math.min(64, now - a.t); a.t = now;
      const d = a.to - a.y;
      if (Math.abs(d) < 0.5) { a.y = a.to; scrollTo(0, a.y); if (!this.drag) { this.anim = null; this.paintView(); return; } }
      else { a.y += d * (1 - Math.pow(0.7, dt / 16.7)); scrollTo(0, a.y); }
    }
    this.paintView();
    a.raf = requestAnimationFrame((t) => this.tick(t));
  }
  stopAnim() {
    if (!this.anim) return;
    cancelAnimationFrame(this.anim.raf);
    this.anim = null;
  }

  wirePointer() {
    const s = this.stick;
    const local = (e) => e.clientY - s.getBoundingClientRect().top;
    s.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.docH) return;
      e.preventDefault();
      const label = e.target.closest(".mm-label");
      this.o.onSeek();
      if (label) {
        const sec = this.sections[+label.dataset.i];
        if (sec) { this.measure(); this.seek(sec.y, "glide", "top"); }
        return;
      }
      const y = local(e);
      try { s.setPointerCapture(e.pointerId); } catch {}
      // Grabbing the window keeps hold of it where it was taken; elsewhere, glide there.
      const inside = y >= this.viewT - 4 && y <= this.viewB + 4;
      this.drag = { id: e.pointerId, grab: inside ? y - (this.viewT + this.viewB) / 2 : 0 };
      this.host.classList.add("is-drag");
      this.measure();
      if (!inside) this.seek(this.fracAt(y), "glide");
    });
    s.addEventListener("pointermove", (e) => {
      const y = local(e);
      if (this.drag && e.pointerId === this.drag.id) { this.measure(); this.seek(this.fracAt(y - this.drag.grab), "follow"); }
      this.hover(e.target.closest(".mm-label") ? null : y);
    });
    const end = (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.drag = null;
      this.host.classList.remove("is-drag");
      try { s.releasePointerCapture(e.pointerId); } catch {}
      const b = s.getBoundingClientRect();                   // let go outside the strip: no hover left behind
      if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) this.hover(null);
    };
    s.addEventListener("pointerup", end);
    s.addEventListener("pointercancel", end);
    s.addEventListener("pointerleave", () => { if (!this.drag) this.hover(null); });
  }
  fracAt(stripY) { return clamp(stripY / (this.h || 1), 0, 1); }
  docAt(stripY) { return this.fracAt(stripY) * this.docH; }

  /** Hover: a hairline at the pointer and the name of the section there. */
  hover(y) {
    if (y == null || !this.docH) {
      this.host.classList.remove("is-hover");
      this.tipFor = -2;
      return;
    }
    const yy = clamp(y, 0, this.h);
    this.host.classList.add("is-hover");
    this.hoverLine.style.transform = `translate3d(0, ${yy.toFixed(1)}px, 0)`;
    const i = sectionIndex(this.sections, this.docAt(yy));
    if (i !== this.tipFor) {
      const sec = this.sections[i];
      this.tipFor = i;
      this.host.classList.toggle("has-tip", !!sec);          // above the first heading: just the hairline
      this.tipT.textContent = sec ? sec.label : "";
      this.tipN.textContent = sec?.count ? `${sec.count} ${sec.count === 1 ? "change" : "changes"}` : "";
    }
    this.tip.style.transform = `translate3d(0, ${clamp(yy, 12, this.h - 12).toFixed(1)}px, 0) translateY(-50%)`;
  }
}
