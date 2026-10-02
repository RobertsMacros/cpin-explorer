// CPIN Explorer · the history timeline: a revision slider with gliding handles and a rolling
// ("odometer") date, extracted from the redline prototype so the report page can use it.
//
//   const slider = new HistorySlider(el, { onPaint, onCommit });
//   slider.setStops(stops, { today });     // [{ t, kind: "edition" | "update", label, sub, tip, h }]
//   slider.setMode("read");               // one handle (As at) over every stop
//   slider.setMode("compare");            // two handles (Old, New) over held editions only
//   await slider.glide("b", 4);            // eased, never a snap; resolves when settled
//
// Stops sit at their dates on a piecewise-linear scale (stops dated alike are nudged apart so each
// stays grabbable), so a handle at rest always reads its own stop's date. Styles: timeline.css.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const RMQ = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
export const reducedMotion = () => RMQ.matches;

/* ------------------------------------------------------------------ rolling digits */

class Slot {
  constructor(parent, values) {
    this.values = values;
    this.el = document.createElement("span"); this.el.className = "slot";
    this.col = document.createElement("span"); this.col.className = "col";
    this.col.innerHTML = values.map((v) => `<span>${v === "" ? " " : esc(v)}</span>`).join("");
    this.el.appendChild(this.col); parent.appendChild(this.el);
    this.widths = null; this.i = -1;
  }
  measure() {
    const fs = parseFloat(getComputedStyle(this.el).fontSize) || 16;
    const ws = [...this.col.children].map((c, k) => (this.values[k] === "" ? 0 : c.getBoundingClientRect().width / fs));
    if (ws.some((w) => w > 0)) this.widths = ws;
  }
  set(i) {
    const fresh = !this.widths && (this.measure(), !!this.widths);   // measured only once laid out
    if (i === this.i && !fresh) return;
    this.i = i;
    this.col.style.setProperty("--i", i);
    if (this.widths) this.el.style.width = `${this.widths[i]}em`;
  }
  remeasure() { this.widths = null; const i = this.i; this.i = -1; this.set(Math.max(0, i)); }
}

/** A whole number whose digits roll. */
export class NumberRoller {
  constructor(el, digits) {
    this.el = el; el.classList.add("roller"); this.slots = [];
    for (let k = 0; k < digits; k++) this.slots.push(new Slot(el, ["", ..."0123456789"]));
  }
  set(n, instant) {
    const s = String(Math.max(0, Math.round(n || 0))).padStart(this.slots.length, " ").slice(-this.slots.length);
    this.el.classList.toggle("instant", !!instant || reducedMotion());
    this.slots.forEach((sl, k) => sl.set(s[k] === " " ? 0 : +s[k] + 1));
  }
  remeasure(instant) { if (instant) this.el.classList.add("instant"); this.slots.forEach((s) => s.remeasure()); }
}

/** "15 MAY 2026", rolling digit by digit; a month-only date rolls its day away. */
export class DateRoller {
  constructor(el) {
    this.el = el; el.classList.add("roller");
    const D = "0123456789".split("");
    this.d1 = new Slot(el, ["", "1", "2", "3"]); this.d2 = new Slot(el, ["", ...D]);
    this.sp = new Slot(el, ["", " "]); this.sp.el.classList.add("fixed");
    this.m = new Slot(el, MONTHS);
    this.gap = new Slot(el, [" "]); this.gap.el.classList.add("fixed");     // a flex container drops bare spaces
    this.y = [0, 1, 2, 3].map(() => new Slot(el, D));
  }
  set(t, instant, monthOnly) {
    const d = new Date(t), day = d.getUTCDate(), yr = String(d.getUTCFullYear()).padStart(4, "0");
    this.el.classList.toggle("instant", !!instant || reducedMotion());
    this.d1.set(monthOnly ? 0 : Math.floor(day / 10)); this.d2.set(monthOnly ? 0 : (day % 10) + 1);
    this.sp.set(monthOnly ? 0 : 1); this.m.set(d.getUTCMonth()); this.gap.set(0);
    this.y.forEach((s, k) => s.set(+yr[k]));
  }
  remeasure(instant) { if (instant) this.el.classList.add("instant"); [this.d1, this.d2, this.sp, this.m, this.gap, ...this.y].forEach((s) => s.remeasure()); }
}

/* ------------------------------------------------------------------ the slider */

const easeOut = (t) => 1 - (1 - t) ** 3;

export class HistorySlider {
  /**
   * onPaint({ a, b, active, t, stop }): every frame while a handle moves (a, b: the stops nearest the
   *   handles; t: the date under the active handle). onCommit({ a, b, user }): a handle came to rest on
   *   a new stop. onUser(): the reader grabbed the slider (stop Play).
   */
  constructor(el, { onPaint = () => {}, onCommit = () => {}, onUser = () => {}, labels = {} } = {}) {
    this.el = el; this.onPaint = onPaint; this.onCommit = onCommit; this.onUser = onUser;
    this.labels = { asAt: "As at", old: "Old", new: "New", ...labels };
    this.stops = []; this.mode = "read";
    this.a = -1; this.b = 0; this.xa = 0; this.xb = 0; this.active = "b";
    this.anims = { a: 0, b: 0 }; this.gen = { a: 0, b: 0 }; this.lastPair = "";
    el.classList.add("rs");
    el.innerHTML = `<div class="rs-inner"><div class="rs-plot"></div><div class="rs-range" aria-hidden="true"></div>
      <div class="rs-base" aria-hidden="true"></div><div class="rs-nodes" aria-hidden="true"></div>
      <div class="rs-handle old" role="slider" tabindex="-1" aria-label="Compare from (old edition)"><span class="flag tag tag--outline">${esc(this.labels.old)}</span><span class="knob"></span></div>
      <div class="rs-handle new" role="slider" tabindex="0" aria-label="Edition shown"><span class="flag tag">${esc(this.labels.asAt)}</span><span class="knob"></span></div></div>`;
    this.inner = el.querySelector(".rs-inner");
    this.hOld = el.querySelector(".rs-handle.old");
    this.hNew = el.querySelector(".rs-handle.new");
    this.wire();
    el.dataset.mode = this.mode;
  }

  /* ---- layout ---- */
  setStops(stops, { today = Date.now() } = {}) {
    this.stops = stops;
    const N = stops.length;
    if (!N) return;
    const yr = (t) => new Date(t).getUTCFullYear();
    this.axis = { start: Date.UTC(yr(stops[0].t), 0, 1), end: Date.UTC(Math.max(yr(stops[N - 1].t), yr(today)), 11, 31), today };
    const span = this.axis.end - this.axis.start || 1;
    stops.forEach((s) => { s.x = (s.t - this.axis.start) / span; });
    const gap = N > 1 ? Math.min(0.045, 0.9 / (N - 1)) : 0;
    for (let i = 1; i < N; i++) stops[i].x = Math.max(stops[i].x, stops[i - 1].x + gap);
    if (stops[N - 1].x > 1) {
      stops[N - 1].x = 1;
      for (let i = N - 2; i >= 0; i--) stops[i].x = Math.min(stops[i].x, stops[i + 1].x - gap);
    }
    if (N === 1) stops[0].x = Math.min(stops[0].x, 0.92);
    this.build();
  }
  span() { return this.axis.end - this.axis.start; }
  tOf(x) {
    const S = this.stops, f = S[0], l = S[S.length - 1];
    if (x <= f.x) return f.t + (x - f.x) * this.span();
    if (x >= l.x) return l.t + (x - l.x) * this.span();
    for (let i = 0; i < S.length - 1; i++) {
      const p = S[i], q = S[i + 1];
      if (x <= q.x) return q.x === p.x ? q.t : p.t + ((q.t - p.t) * (x - p.x)) / (q.x - p.x);
    }
    return l.t;
  }
  xOf(t) {
    const S = this.stops, f = S[0], l = S[S.length - 1];
    if (t <= f.t) return f.x + (t - f.t) / this.span();
    if (t >= l.t) return l.x + (t - l.t) / this.span();
    for (let i = 0; i < S.length - 1; i++) {
      const p = S[i], q = S[i + 1];
      if (t <= q.t) return q.t === p.t ? p.x : p.x + ((q.x - p.x) * (t - p.t)) / (q.t - p.t);
    }
    return l.x;
  }
  build() {
    const S = this.stops, A = this.axis;
    let plot = "";
    for (let y = new Date(A.start).getUTCFullYear(); y <= new Date(A.end).getUTCFullYear(); y++) {
      const x = this.xOf(Date.UTC(y, 0, 1));
      if (x >= -0.001 && x <= 1.001) plot += `<div class="rs-year" style="left:${x * 100}%"><span>${y}</span></div>`;
    }
    const xt = this.xOf(A.today);
    if (xt >= 0 && xt <= 1.001) plot += `<div class="rs-year rs-today" style="left:${xt * 100}%"><span>Today</span></div>`;
    S.forEach((s, i) => {
      const edge = s.x < 0.15 ? " edge-l" : s.x > 0.85 ? " edge-r" : "";
      plot += s.kind === "edition"
        ? `<button type="button" class="rs-bar${s.first ? " first" : ""}${edge}" data-i="${i}" tabindex="-1" aria-hidden="true" style="left:${s.x * 100}%;--h:${(s.h ?? 0.16).toFixed(3)}" data-tip="${esc(s.tip || "")}"></button>`
        : `<button type="button" class="rs-ev${edge}" data-i="${i}" tabindex="-1" aria-hidden="true" style="left:${s.x * 100}%" data-tip="${esc(s.tip || "")}"></button>`;
    });
    this.inner.querySelector(".rs-plot").innerHTML = plot;
    this.inner.querySelector(".rs-nodes").innerHTML = S.map((s, i) =>
      `<span class="rs-node${s.kind === "edition" ? "" : " is-ev"}" data-i="${i}" style="left:${s.x * 100}%"></span><span class="rs-label${s.kind === "edition" ? "" : " is-ev"}" data-i="${i}" style="left:${s.x * 100}%">${s.label ? `<b>${esc(s.label)}</b>` : ""}<span class="d">${esc(s.sub || "")}</span></span>`).join("");
    this.el.classList.toggle("is-single", S.length < 2);
  }
  /** Bar heights (0..1) and tooltips after background comparisons finish; bars ease to their height. */
  refresh() {
    this.inner.querySelectorAll(".rs-bar, .rs-ev").forEach((b) => {
      const s = this.stops[+b.dataset.i];
      if (!s) return;
      if (s.kind === "edition") b.style.setProperty("--h", (s.h ?? 0.16).toFixed(3));
      b.dataset.tip = s.tip || "";
    });
  }

  /* ---- which stops each handle may rest on ---- */
  ok(which, i) {
    const s = this.stops[i];
    if (!s) return false;
    if (this.mode === "read") return which === "b";
    return s.kind === "edition";
  }
  range(which) {
    const N = this.stops.length;
    if (this.mode === "read") return [0, N - 1];
    return which === "a" ? [0, this.b - 1] : [this.a + 1, N - 1];
  }
  nearest(which, x) {
    const [lo, hi] = this.range(which);
    let best = -1, bd = Infinity;
    for (let i = lo; i <= hi; i++) {
      if (!this.ok(which, i)) continue;
      const d = Math.abs(this.stops[i].x - x);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  step(which, from, dir) {
    const [lo, hi] = this.range(which);
    for (let i = from + dir; i >= lo && i <= hi; i += dir) if (this.ok(which, i)) return i;
    return from;
  }

  /* ---- state ---- */
  setMode(mode, { a = null, b = null } = {}) {
    this.mode = mode;
    this.el.dataset.mode = mode;
    this.hNew.querySelector(".flag").textContent = mode === "read" ? this.labels.asAt : this.labels.new;
    this.hNew.setAttribute("aria-label", mode === "read" ? "Edition shown (as at)" : "New edition (compare to)");
    this.hOld.tabIndex = mode === "read" ? -1 : 0;
    this.hOld.setAttribute("aria-hidden", String(mode === "read"));
    if (b != null) { this.b = b; this.xb = this.stops[b].x; }
    if (mode === "compare" && a != null) { this.a = a; this.xa = this.stops[a].x; }
    if (mode === "read") { this.a = -1; this.xa = this.stops[0]?.x ?? 0; }
    this.active = "b";
    this.paint(this.a, this.b, true);
    this.syncAria();
  }
  /** Jump without animation (first paint, deep links). */
  place(a, b) {
    if (b != null) { this.b = b; this.xb = this.stops[b].x; }
    if (a != null && this.mode === "compare") { this.a = a; this.xa = this.stops[a].x; }
    this.lastPair = `${this.a}:${this.b}`;
    this.paint(this.a, this.b, true);
    this.syncAria();
    this.cull();
  }
  paint(ia, ib, instant = false) {
    const xa = this.mode === "read" ? (this.stops[0]?.x ?? 0) : this.xa;
    this.inner.style.setProperty("--xa", xa);
    this.inner.style.setProperty("--xb", this.xb);
    const activeX = this.active === "a" ? this.xa : this.xb;
    const near = this.stops[this.active === "a" ? ia : ib];
    const lo = this.mode === "read" ? -1 : ia;
    this.inner.querySelectorAll(".rs-bar, .rs-ev, .rs-node, .rs-label").forEach((el) => {
      const i = +el.dataset.i;
      el.classList.toggle("in-range", i > lo && i <= ib);
      el.classList.toggle("is-base", this.mode === "compare" && i === ia);
      el.classList.toggle("is-cur", i === ib);
    });
    this.onPaint({ a: ia, b: ib, active: this.active, t: this.tOf(activeX), stop: near, instant });
  }
  syncAria() {
    const S = this.stops, A = S[this.a], B = S[this.b];
    const text = (s) => (s ? `${s.label ? `${s.label}, ` : ""}${s.long || s.sub || ""}` : "");
    const editions = S.filter((s) => s.kind === "edition").length;
    this.hNew.setAttribute("aria-valuemin", "1");
    this.hNew.setAttribute("aria-valuemax", String(this.mode === "read" ? S.length : editions));
    this.hNew.setAttribute("aria-valuenow", String(this.b + 1));
    this.hNew.setAttribute("aria-valuetext", text(B));
    if (A) { this.hOld.setAttribute("aria-valuenow", String(this.a + 1)); this.hOld.setAttribute("aria-valuetext", text(A)); }
  }
  glide(which, idx, dur = 260) {
    return new Promise((res) => {
      cancelAnimationFrame(this.anims[which]);
      const key = which === "a" ? "xa" : "xb", from = this[key], to = this.stops[idx].x;
      this[which] = idx;
      if (reducedMotion() || Math.abs(to - from) < 1e-6 || dur === 0) { this[key] = to; this.paint(this.a, this.b); res(); return; }
      const t0 = performance.now(), gen = ++this.gen[which];
      let done = false;
      const finish = () => {
        if (done || this.gen[which] !== gen) return;
        done = true; cancelAnimationFrame(this.anims[which]);
        this[key] = to; this.paint(this.a, this.b); res();
      };
      const frame = (now) => {
        if (done || this.gen[which] !== gen) return;
        const p = Math.min(1, (now - t0) / dur);
        this[key] = from + (to - from) * easeOut(p);
        this.paint(this.a, this.b);
        if (p < 1) this.anims[which] = requestAnimationFrame(frame); else finish();
      };
      this.anims[which] = requestAnimationFrame(frame);
      setTimeout(finish, dur + 150);          // background tabs pause rAF: always settle
    });
  }
  commit(user = false) {
    this.syncAria(); this.cull();
    const pair = `${this.a}:${this.b}`;
    if (pair === this.lastPair) return;
    this.lastPair = pair;
    this.onCommit({ a: this.a, b: this.b, user });
  }
  async moveTo(which, idx, dur = 260, user = true) {
    this.active = which;
    const [lo, hi] = this.range(which);
    idx = Math.max(lo, Math.min(hi, idx));
    if (!this.ok(which, idx)) idx = this.nearest(which, this.stops[idx].x);
    if (idx < 0) return;
    await this.glide(which, idx, dur);
    this.commit(user);
  }

  /* ---- input ---- */
  trackX(clientX) { const r = this.inner.getBoundingClientRect(); return Math.max(0, Math.min(1, (clientX - r.left) / r.width)); }
  startDrag(which, e) {
    this.onUser();
    const el = which === "a" ? this.hOld : this.hNew, key = which === "a" ? "xa" : "xb";
    cancelAnimationFrame(this.anims[which]); this.gen[which]++;
    this.active = which; el.focus({ preventScroll: true });
    el.setPointerCapture(e.pointerId); el.classList.add("is-dragging"); this.el.classList.add("is-dragging");
    const r = el.getBoundingClientRect(), offset = e.clientX - (r.left + r.width / 2);
    const [lo, hi] = this.range(which);
    const xs = [];
    for (let i = lo; i <= hi; i++) if (this.ok(which, i)) xs.push(this.stops[i].x);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const move = (ev) => {
      this[key] = Math.max(minX, Math.min(maxX, this.trackX(ev.clientX - offset)));
      const n = this.nearest(which, this[key]);
      this.paint(which === "a" ? n : this.a, which === "b" ? n : this.b);
    };
    const up = () => {
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      el.classList.remove("is-dragging"); this.el.classList.remove("is-dragging");
      this.moveTo(which, this.nearest(which, this[key]), 260);
    };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    e.preventDefault();
  }
  key(which, e) {
    const cur = which === "a" ? this.a : this.b;
    let idx = null;
    const [lo, hi] = this.range(which);
    if (["ArrowLeft", "ArrowDown", "PageDown"].includes(e.key)) idx = this.step(which, cur, -1);
    else if (["ArrowRight", "ArrowUp", "PageUp"].includes(e.key)) idx = this.step(which, cur, 1);
    else if (e.key === "Home") idx = this.step(which, lo - 1, 1);
    else if (e.key === "End") idx = this.step(which, hi + 1, -1);
    if (idx === null) return;
    e.preventDefault(); this.onUser(); this.moveTo(which, idx, 260);
  }
  wire() {
    this.hOld.addEventListener("pointerdown", (e) => { if (e.button === 0 && this.mode === "compare") { e.stopPropagation(); this.startDrag("a", e); } });
    this.hNew.addEventListener("pointerdown", (e) => { if (e.button === 0) { e.stopPropagation(); this.startDrag("b", e); } });
    this.hOld.addEventListener("keydown", (e) => this.key("a", e));
    this.hNew.addEventListener("keydown", (e) => this.key("b", e));
    this.hOld.addEventListener("focus", () => { if (this.mode === "compare") { this.active = "a"; this.paint(this.a, this.b); } });
    this.hNew.addEventListener("focus", () => { this.active = "b"; this.paint(this.a, this.b); });
    this.hOld.addEventListener("blur", () => { if (this.active === "a") { this.active = "b"; this.paint(this.a, this.b); } });
    this.inner.addEventListener("click", (e) => {
      if (e.target.closest(".rs-handle") || !this.stops.length) return;
      this.onUser();
      const x = this.trackX(e.clientX), hit = e.target.closest("[data-i]");
      let i = hit ? +hit.dataset.i : -1;
      if (this.mode === "read") { this.moveTo("b", i >= 0 ? i : this.nearest("b", x), 300); return; }
      if (i < 0 || this.stops[i].kind !== "edition") {
        let best = -1, bd = Infinity;
        this.stops.forEach((s, k) => { if (s.kind === "edition" && Math.abs(s.x - x) < bd) { bd = Math.abs(s.x - x); best = k; } });
        i = best;
      }
      let which;
      if (i <= this.a) which = "a"; else if (i >= this.b) which = "b";
      else which = Math.abs(this.stops[i].x - this.xa) < Math.abs(this.stops[i].x - this.xb) ? "a" : "b";
      if ((which === "a" && i >= this.b) || (which === "b" && i <= this.a)) return;
      this.moveTo(which, i, 300);
    });
    // Hovering a label or node shows its bar's tooltip.
    const tip = (e, on) => {
      const t = e.target.closest(".rs-label, .rs-node");
      if (!t) return;
      this.inner.querySelector(`.rs-bar[data-i="${t.dataset.i}"], .rs-ev[data-i="${t.dataset.i}"]`)?.classList.toggle("tip", on);
    };
    this.inner.addEventListener("pointerover", (e) => tip(e, true));
    this.inner.addEventListener("pointerout", (e) => tip(e, false));
    addEventListener("resize", () => requestAnimationFrame(() => this.cull()));
  }
  /** Labels that would print on top of each other: keep the handles' stops, then editions, then any that fit. */
  cull() {
    const labels = [...this.inner.querySelectorAll(".rs-label")];
    if (!labels.length) return;
    const rects = labels.map((l) => { l.classList.remove("crowded"); return l.getBoundingClientRect(); });
    const rank = (l) => { const i = +l.dataset.i; return i === this.b || i === this.a ? 0 : l.classList.contains("is-ev") ? 2 : 1; };
    const order = labels.map((l, k) => k).sort((x, y) => rank(labels[x]) - rank(labels[y]) || y - x);
    const kept = [];
    for (const k of order) {
      const r = rects[k];
      if (kept.some((q) => r.left < q.right + 6 && r.right > q.left - 6)) labels[k].classList.add("crowded");
      else kept.push(r);
    }
  }
}
