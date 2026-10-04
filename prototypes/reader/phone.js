// CPIN Explorer · the report page on a phone: two things a small touch screen needs that a wide one does not.
//
//   EdgeStrip   the minimap's quiet cousin (../shared/minimap.js is the strip beside the text on wide screens):
//               a hairline down the left edge of the screen, in the text's own margin, with a tick where each
//               main section starts and a marker for the part of the report on screen. Greys only. Display
//               only: aria-hidden, nothing to press (the contents list is the way to travel).
//   sheetSide   which edge of the screen the selection sheet takes, so that it never sits on the selection,
//               its handles or the system's own menu.
//
//   const strip = new EdgeStrip(host, { doc, collect, positioner, insetTop, observe });
//   strip.schedule();                 // after anything that changes the text shown or its layout
//
// The strip reads positions once per build (debounced, in idle time) through the minimap's DocPositioner, so
// chunks the browser is skipping are never made to lay out; scrolling then writes at most one transform per
// frame, from cached numbers. stripWindow(), stripTicks() and sheetSide() are pure (web/test/reader-phone.test.mjs).
import { DocPositioner } from "../shared/minimap.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ pure (unit-tested) */

/**
 * The marker: the part of the strip that stands for what is on screen. `scroll` is the page's scroll position,
 * `inset` the sticky chrome covering the top of the window, `viewport` the window's height, `docTop` and
 * `docHeight` the text's place in the page and `height` the strip's. Returns { top, size, on } in strip pixels:
 * at least `min` tall (a small marker is centred on the true window) and always inside the strip; `on` says
 * whether any of the text is on screen.
 */
export function stripWindow({ scroll, inset = 0, viewport, docTop, docHeight, height, min = 0 } = {}) {
  if (!(docHeight > 0) || !(height > 0)) return { top: 0, size: 0, on: false };
  const k = height / docHeight;
  const a = clamp(scroll + inset - docTop, 0, docHeight) * k, b = clamp(scroll + viewport - docTop, 0, docHeight) * k;
  const size = Math.min(height, Math.max(min, b - a));
  return { top: clamp((a + b) / 2 - size / 2, 0, height - size), size, on: b > a };
}

/**
 * Ticks for positions `ys` (document pixels, in order down the text): [{ top, on }] in strip pixels, snapped to
 * device pixels (`px`) and kept inside the strip. A tick within `gap` of the one shown before it is not shown
 * (`on: false`) but keeps its own place, so it can ease in if the text grows and they part.
 */
export function stripTicks(ys, { docHeight, height, px = 1, gap = 3 } = {}) {
  if (!(docHeight > 0) || !(height > 0) || !Array.isArray(ys)) return [];
  const k = height / docHeight;
  let last = -Infinity;
  return ys.map((y) => {
    if (!Number.isFinite(y)) return { top: 0, on: false };
    const top = Math.round(clamp(y * k, 0, height - px) / px) * px;
    const on = top - last > gap;
    if (on) last = top;
    return { top, on };
  });
}

/**
 * Which edge of the screen the selection sheet takes on a touch screen: "bottom", unless it would sit on the
 * end of the selection, on a selection handle or on the system's own menu (which a page cannot move or
 * remove); then "top", under the sticky header, if that is clear. With neither clear it stays where it is.
 * All in viewport pixels:
 *   top, bottom   the selection                     viewport   the window's height
 *   inset         the sticky header and bar         size       the sheet's height, with its margin
 *   handle        what a selection handle takes beyond the selection (above its start, below its end)
 *   menu          what the system's menu takes: above the selection when it fits on screen, else below it
 *   was           the edge the sheet has now: it changes edge only when the other is clear by `slack` more
 */
export function sheetSide({ top, bottom, viewport, inset = 0, size, handle = 20, menu = 60, was = null, slack = 24 } = {}) {
  const stay = was === "top" ? "top" : "bottom";
  if (![top, bottom, viewport, size].every(Number.isFinite) || bottom < 0 || top > viewport) return "bottom";   // nothing selected on screen
  const above = top - handle - menu >= 0;
  const lo = top - handle - (above ? menu : 0), hi = bottom + handle + (above ? 0 : menu);
  const bottomClear = hi + (stay === "top" ? slack : 0) <= viewport - size;
  const topClear = lo - (stay === "bottom" ? slack : 0) >= inset + size;
  return bottomClear ? "bottom" : topClear ? "top" : stay;
}

/* ------------------------------------------------------------------ the strip */

const MIN_MARKER = 14;                           // px: the marker never shrinks to nothing on a long report
const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 300 }) : setTimeout(fn, 30));

export class EdgeStrip {
  /**
   * host: an empty element in the text's left margin (CSS in reader.css). Options, as the minimap's:
   *   doc         the element mapped (the article holding the text)
   *   collect     (pos) => [y, ...]: where the ticks go, in document pixels, from pos.yOf(el)
   *   positioner  (doc) => a DocPositioner for the text shown
   *   insetTop    () => pixels of sticky chrome covering the top of the window
   *   observe     more elements whose size moves the text (a ResizeObserver rebuilds after they change)
   */
  constructor(host, opts) {
    this.host = host;
    this.o = { insetTop: () => 0, observe: [], collect: () => [], positioner: (doc) => new DocPositioner(doc), ...opts };
    this.doc = opts.doc;
    host.classList.add("is-empty");
    host.setAttribute("aria-hidden", "true");
    host.innerHTML = `<div class="edge-stick"><div class="edge-rail"><i class="edge-track"></i><div class="edge-ticks"></div><i class="edge-view"></i></div></div>`;
    this.rail = host.querySelector(".edge-rail"); this.ticks = host.querySelector(".edge-ticks"); this.view = host.querySelector(".edge-view");
    this.h = 0; this.docH = 0; this.docTop = 0; this.inset = 0; this.vh = 0; this.px = 1; this.at = ""; this.on = false;
    this.timer = 0; this.raf = 0; this.settle = 0;

    // Scroll: only the marker moves, once per frame, from cached numbers.
    addEventListener("scroll", () => { if (this.h && !this.raf) this.raf = requestAnimationFrame(() => this.paint()); }, { passive: true });
    addEventListener("resize", () => this.schedule(), { passive: true });
    // The text lays out lazily and things above it open and close: follow its real size, debounced.
    const ro = new ResizeObserver(() => this.schedule());
    for (const el of [this.doc, this.rail, ...this.o.observe]) if (el) ro.observe(el);
  }

  /** Rebuild soon (debounced, in idle time). */
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => idle(() => this.build()), 140);
  }

  window() {
    return stripWindow({ scroll: scrollY, inset: this.inset, viewport: this.vh, docTop: this.docTop, docHeight: this.docH, height: this.h, min: MIN_MARKER });
  }

  build() {
    const h = this.host.offsetParent !== null && this.doc?.isConnected ? this.rail.clientHeight : 0;
    if (!h) { this.h = 0; return; }                // not shown at this width
    this.builds = (this.builds || 0) + 1;
    const before = this.h ? this.window() : null;
    let pos = null, ys = [];
    try {
      pos = this.o.positioner(this.doc);
      ys = this.o.collect(pos) || [];
    } catch (err) { console.warn("edge strip:", err); }
    this.h = h; this.inset = this.o.insetTop(); this.vh = innerHeight;
    this.docTop = pos?.top ?? 0; this.docH = pos?.height ?? 0;
    this.host.classList.toggle("is-empty", !(this.docH > this.vh * 1.2));       // a short text needs no map
    // One element per tick, kept from build to build, so a tick glides to its new place when the text settles
    // (a new one is put in place first and shown a frame later, so it eases in).
    this.px = 1 / clamp(devicePixelRatio || 1, 1, 3);
    const ticks = stripTicks(ys, { docHeight: this.docH, height: h, px: this.px });
    const kept = this.ticks.childElementCount;
    while (this.ticks.childElementCount < ticks.length) this.ticks.append(document.createElement("i"));
    const show = () => [...this.ticks.children].forEach((el, i) => el.classList.toggle("on", !!ticks[i]?.on));
    [...this.ticks.children].forEach((el, i) => { if (ticks[i]) el.style.transform = `translate3d(0, ${ticks[i].top}px, 0)`; });
    if (ticks.length > kept) requestAnimationFrame(show); else show();
    // The marker eases to where the new measurements put it, then follows the scroll directly again.
    const now = this.window();
    if (before && (Math.abs(now.top - before.top) > 0.5 || Math.abs(now.size - before.size) > 0.5)) {
      this.host.classList.add("is-settling");
      clearTimeout(this.settle);
      this.settle = setTimeout(() => this.host.classList.remove("is-settling"), 320);
    }
    this.paint();
  }

  /** The marker: at most once a frame while scrolling. Reads nothing from layout, and writes only when the marker
   *  has moved by a device pixel (on a long report that is every few frames). */
  paint() {
    this.raf = 0;
    if (!this.h) return;
    const w = this.window();
    const at = `translate3d(0, ${(Math.round(w.top / this.px) * this.px).toFixed(2)}px, 0) scaleY(${w.size.toFixed(1)})`;
    if (at !== this.at) { this.view.style.transform = at; this.at = at; }
    if (w.on !== this.on) { this.view.classList.toggle("on", w.on); this.on = w.on; }
  }
}
