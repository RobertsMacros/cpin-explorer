// Guide and glossary page. The guide is plain HTML and reads without this script; this draws the
// glossary from ../shared/glossary.js, filters it (rows fold away, nothing jumps), marks a term on
// arrival (#term-<id>, as the reader marks a target), keeps the in-page nav on the part in view, and
// switches the theme. ?q=<text> fills the filter. The pure parts are tested in web/test/guide.test.mjs.
import { GLOSSARY, GROUPS, glossaryEntry, normTerm, searchGlossary } from "../shared/glossary.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** The glossary as it is shown: one block per group, in GROUPS' order, entries in the order written. */
export function glossaryGroups(entries = GLOSSARY, groups = GROUPS) {
  return Object.entries(groups)
    .map(([key, label]) => ({ key, label, entries: entries.filter((e) => e.group === key) }))
    .filter((g) => g.entries.length);
}

/**
 * What a filter leaves: { query, active, ids, shown, total }. Names are searched first, then the
 * explanations (searchGlossary with definitions). A query with no letters or digits leaves everything.
 */
export function filterGlossary(query) {
  const q = String(query ?? "").trim();
  const active = normTerm(q) !== "";
  const ids = new Set((active ? searchGlossary(q, { definitions: true }) : GLOSSARY).map((e) => e.id));
  return { query: q, active, ids, shown: ids.size, total: GLOSSARY.length };
}

/** The count beside the filter: "37 terms", "3 of 37 terms", "No terms match". */
export function countLabel({ active, shown, total }) {
  if (!active) return `${total} ${total === 1 ? "term" : "terms"}`;
  return shown ? `${shown} of ${total} terms` : "No terms match";
}

/** The glossary id a fragment names ("#term-cpin" -> "cpin"), or null if it names no entry. */
export function termFromHash(hash) {
  const m = /^#term-([a-z0-9-]+)$/.exec(String(hash ?? ""));
  return m && glossaryEntry(m[1]) ? m[1] : null;
}

/** The page's address with the filter in it (?q=), everything else kept: a filtered list can be shared. */
export function addressWithFilter(href, query) {
  const url = new URL(href);
  const q = String(query ?? "").trim();
  if (q) url.searchParams.set("q", q); else url.searchParams.delete("q");
  return url.href;
}

const plain = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * The words of `text` that one of the filter's words begins, as [start, end) pairs in order: what to
 * tint in a row that matched. The same rule as the search (a query word starts a word), on the text as
 * written; the whole word is tinted, which reads more calmly than part of one.
 */
export function matchSpans(text, query) {
  const words = normTerm(query).split(" ").filter(Boolean);
  const spans = [];
  if (!words.length) return spans;
  for (const m of String(text ?? "").matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = plain(m[0]);
    if (words.some((w) => word.startsWith(w))) spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

/** One entry: the term (a link to itself, so its address can be copied), what it stands for, the explanation. */
export function entryHtml(e) {
  const id = esc(e.id);
  return `<li class="gl-row" id="term-${id}" data-id="${id}"><div class="gl-row-in"><div class="gl-entry">
    <div class="gl-name"><h4 class="gl-term"><a href="#term-${id}"><dfn>${esc(e.term)}</dfn></a></h4>${e.full ? `<p class="gl-full">${esc(e.full)}</p>` : ""}</div>
    <p class="gl-def">${esc(e.def)}</p></div></div></li>`;
}

export function groupHtml(g) {
  const key = esc(g.key);
  return `<section class="gl-group" id="group-${key}" aria-labelledby="group-${key}-h"><div class="gl-group-in">
    <div class="gl-group-head"><h3 class="eyebrow" id="group-${key}-h">${esc(g.label)}</h3><span class="eyebrow gl-group-n">${g.entries.length}</span></div>
    <ul class="gl-list">${g.entries.map(entryHtml).join("")}</ul></div></section>`;
}

/* ------------------------------------------------------------------------------------------ the page */

function boot() {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const behavior = () => (reduced.matches ? "auto" : "smooth");

  /* ---- theme (as the other pages: AUTO, LIGHT, DARK, remembered) ---- */
  const themeBtn = $("#theme");
  if (themeBtn) {
    const MODES = ["auto", "light", "dark"];
    const mode = () => root.dataset.theme || "auto";
    const label = (m) => { themeBtn.textContent = m.toUpperCase(); themeBtn.setAttribute("aria-label", `Colour theme: ${m}. Click to change.`); };
    label(mode());
    themeBtn.addEventListener("click", () => {
      const m = MODES[(MODES.indexOf(mode()) + 1) % MODES.length];
      root.classList.add("theme-switching");                 // the colours change in one frame, not as a wave of transitions
      if (m === "auto") delete root.dataset.theme; else root.dataset.theme = m;
      try { localStorage.setItem("cpin-theme", m); } catch {}
      label(m);
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
    });
  }

  /* ---- the glossary ---- */
  const glossary = $("#glossary"), groupsEl = $("#glGroups"), tools = $("#glTools");
  const input = $("#glFilter"), findBox = input.closest(".gl-find"), count = $("#glCount"), empty = $("#glEmpty");
  const groups = glossaryGroups();
  groupsEl.innerHTML = groups.map(groupHtml).join("");
  $("#navGroups").innerHTML = groups.map((g) => `<li><a href="#group-${esc(g.key)}">${esc(g.label)}</a></li>`).join("");
  tools.hidden = false;
  const rows = $$(".gl-row", groupsEl);
  const groupEls = $$(".gl-group", groupsEl).map((el) => ({ el, rows: $$(".gl-row", el), n: $(".gl-group-n", el) }));
  let filter = filterGlossary("");

  /** Tint the words that matched, without touching the text (CSS Custom Highlight API, where there is one). */
  function paintMarks() {
    if (!globalThis.CSS?.highlights || typeof Highlight === "undefined") return;
    CSS.highlights.delete("guide-filter");
    if (!filter.active || !filter.shown) return;
    const ranges = [];
    for (const row of rows) {
      if (!filter.ids.has(row.dataset.id)) continue;
      for (const el of $$("dfn, .gl-full, .gl-def", row)) {
        const node = el.firstChild;
        if (node?.nodeType !== Node.TEXT_NODE) continue;
        for (const [a, b] of matchSpans(node.data, filter.query)) {
          const r = new Range();
          r.setStart(node, a); r.setEnd(node, b);
          ranges.push(r);
        }
      }
    }
    if (ranges.length) CSS.highlights.set("guide-filter", new Highlight(...ranges));
  }

  /**
   * Show the terms a query leaves. Rows and groups that drop out fold away (CSS); with `instant` nothing
   * animates (first paint, or clearing the filter on the way to a term it had hidden).
   */
  function applyFilter(query, { instant = false, address = true } = {}) {
    filter = filterGlossary(query);
    if (instant) glossary.classList.add("gl-instant");
    for (const row of rows) {
      const off = !filter.ids.has(row.dataset.id);
      row.classList.toggle("is-off", off);
      row.inert = off;
    }
    for (const g of groupEls) {
      const left = g.rows.filter((r) => !r.classList.contains("is-off"));
      g.rows.forEach((r) => r.classList.toggle("is-last", r === left.at(-1)));
      g.el.classList.toggle("is-off", !left.length);
      g.el.inert = !left.length;
      g.n.textContent = filter.active && left.length ? `${left.length} of ${g.rows.length}` : String(g.rows.length);
      $(`#navGroups a[href="#${g.el.id}"]`)?.classList.toggle("is-off", !left.length);
    }
    const none = filter.active && !filter.shown;
    count.textContent = countLabel(filter);
    count.classList.toggle("is-none", none);
    findBox.classList.toggle("has-text", input.value !== "");
    if (none) {
      $("#glEmptyQ").textContent = filter.query;
      $("#glEmptySearch").href = `../dashboard/index.html?q=${encodeURIComponent(filter.query)}`;
    }
    empty.classList.toggle("is-on", none);
    empty.inert = !none;
    empty.setAttribute("aria-hidden", String(!none));
    paintMarks();
    if (address) { try { history.replaceState(history.state, "", addressWithFilter(location.href, filter.query)); } catch {} }
    if (instant) requestAnimationFrame(() => requestAnimationFrame(() => glossary.classList.remove("gl-instant")));
    clearTimeout(applyFilter.settle);
    applyFilter.settle = setTimeout(spy, instant ? 0 : 600);      // the list has finished folding: the nav marker may have moved
  }
  const clearFilter = (opts) => { input.value = ""; applyFilter("", opts); };

  /** Typing while further down the list: glide back to where the list starts, under the filter. */
  function keepResultsInView() {
    const gap = groupsEl.getBoundingClientRect().top - tools.getBoundingClientRect().bottom;
    if (gap < -1) scrollBy({ top: gap, behavior: behavior() });
  }
  function focusFilter() {
    input.focus({ preventScroll: true });
    input.select();
    const r = tools.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) glossary.scrollIntoView({ block: "start", behavior: behavior() });
  }
  input.addEventListener("input", () => { applyFilter(input.value); keepResultsInView(); });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (input.value) { e.preventDefault(); clearFilter(); } else input.blur();
  });
  $("#glClear").addEventListener("click", () => { clearFilter(); input.focus({ preventScroll: true }); });
  $("#glEmptyClear").addEventListener("click", () => { clearFilter(); input.focus({ preventScroll: true }); });
  addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); focusFilter(); }
  });

  /* ---- arriving at a term: glide to it, then mark it for a moment ---- */
  function whenScrollSettles(done) {
    let last = scrollY, still = 0;
    const t0 = performance.now();
    const tick = () => {
      if (scrollY === last) still += 1; else { still = 0; last = scrollY; }
      if (still >= 6 || performance.now() - t0 > 2500) return done();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  let flashTimer = 0;
  function goToTerm(id) {
    const row = document.getElementById(`term-${id}`);
    if (!row) return;
    if (row.classList.contains("is-off")) clearFilter({ instant: true });     // the filter had hidden it
    rows.forEach((r) => r.classList.remove("is-target"));
    row.scrollIntoView({ block: "center", behavior: behavior() });
    $("a", row)?.focus({ preventScroll: true });
    whenScrollSettles(() => {
      void row.offsetWidth;
      row.classList.add("is-target");
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => row.classList.remove("is-target"), 2700);
    });
  }
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.("a[href^='#']");
    if (!a) return;
    const id = termFromHash(a.hash);
    if (id) {
      e.preventDefault();
      if (location.hash !== a.hash) { try { history.pushState(null, "", a.hash); } catch {} }
      return goToTerm(id);
    }
    // A group the filter has folded away: bring everything back first, so the link has somewhere to go.
    if (document.getElementById(a.hash.slice(1))?.classList.contains("is-off")) clearFilter({ instant: true });
  });
  addEventListener("hashchange", () => { const id = termFromHash(location.hash); if (id) goToTerm(id); });

  /* ---- in-page nav: the link for the part on screen, and a marker that glides to it ---- */
  const navList = $("#navList"), marker = $("#navInd"), nav = $("#pageNav");
  const targets = $$("a[href^='#']", nav).map((a) => ({ a, el: document.getElementById(a.hash.slice(1)), part: $("a", a.closest(".gd-nav-part")) })).filter((t) => t.el);
  const glossaryTarget = targets.find((t) => t.el === glossary);
  let margins = new WeakMap(), active = null, queued = false;
  const marginOf = (el) => { if (!margins.has(el)) margins.set(el, parseFloat(getComputedStyle(el).scrollMarginTop) || 0); return margins.get(el); };
  const isBar = () => getComputedStyle(navList).display === "flex";      // narrow screens: two tabs

  function placeMarker() {
    if (!active) return;
    const r = active.getBoundingClientRect(), base = navList.getBoundingClientRect();
    marker.style.setProperty("--y", `${r.top - base.top}px`);
    marker.style.setProperty("--h", `${r.height}px`);
    marker.style.setProperty("--x", `${r.left - base.left}px`);
    marker.style.setProperty("--w", `${r.width}px`);
    marker.classList.add("is-on");
  }
  function spy() {
    queued = false;
    // The line a section's top crosses to become "the one on screen": where an anchor lands, and a little more.
    const line = (parseFloat(getComputedStyle(root).scrollPaddingTop) || 0) + 12;
    const live = targets.filter((t) => !t.el.classList.contains("is-off"));
    let cur = live[0];
    for (const t of live) if (t.el.getBoundingClientRect().top - marginOf(t.el) <= line) cur = t;
    if (filter.active && glossary.contains(cur.el)) cur = glossaryTarget;                                   // a filtered list is short: just "Glossary"
    else if (innerHeight + scrollY >= root.scrollHeight - 2) cur = live.at(-1);                            // the end of the page
    const link = isBar() ? cur.part : cur.a;
    if (link !== active) {
      active?.classList.remove("is-active");
      active?.removeAttribute("aria-current");
      link.classList.add("is-active");
      link.setAttribute("aria-current", "location");
      active = link;
      if (!isBar() && nav.scrollHeight > nav.clientHeight) {             // a short window: keep the link in view inside the rail
        const top = link.offsetTop - nav.clientHeight / 2;
        nav.scrollTo({ top, behavior: behavior() });
      }
    }
    placeMarker();
  }
  const queueSpy = () => { if (!queued) { queued = true; requestAnimationFrame(spy); } };
  addEventListener("scroll", queueSpy, { passive: true });
  addEventListener("resize", () => { margins = new WeakMap(); queueSpy(); });
  document.fonts?.ready.then(queueSpy);

  /* ---- first paint: ?q= fills the filter; #term-<id> is glided to and marked ---- */
  const q0 = new URLSearchParams(location.search).get("q") || "";
  input.value = q0;
  applyFilter(q0, { instant: true, address: false });
  const arrive = () => {
    const id = termFromHash(location.hash);
    if (id) goToTerm(id);
    else if (filter.active && !location.hash) glossary.scrollIntoView({ block: "start", behavior: behavior() });
    queueSpy();
  };
  if (document.readyState === "complete") arrive(); else addEventListener("load", arrive, { once: true });
  root.dataset.guide = "ready";
}

if (typeof document !== "undefined") boot();
