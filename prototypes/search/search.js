// CPIN Extractor search: the full text of every live note, section by section, filtered by country
// and kind. The index is Pagefind's, built by `cd web && npm run search-index` into ./pagefind/ and run
// in the browser: the page only fetches the index chunks a query needs. Results open in the reader at
// the matching section, with the query carried over to its find-in-note (&q=).
//
//   index.html?q=<query>&country=<slug>[,<slug>…]&kind=<kind>[,<kind>…]
import { hydrateFlags } from "../shared/dot-flag.js";
import { fetchJson } from "../shared/fetch-json.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const fmtMonth = (ym) => (ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : "");
const fmtDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${d.toISOString().slice(11, 16)} UTC`;
};
const num = (n) => Number(n || 0).toLocaleString("en-GB");
const plural = (n, word, many = `${word}s`) => `${num(n)} ${n === 1 ? word : many}`;
const split = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
const flag = (iso, cls) => (iso ? `<canvas class="dotflag ${cls}" data-flag="${esc(iso)}" data-cols="8" aria-hidden="true"></canvas>` : "");
const PAGE = 20;                                  // results whose text is fetched per page
const PER_NOTE = 3;                               // sections shown per note before "more in this note"
const EXAMPLES = ["internal relocation Kabul", "female genital mutilation", "Kurdish", "blood feud", "\"sufficiency of protection\"", "military service"];

/* ------------------------------------------------------------------ data and state */

const data = await fetchJson("../dashboard/data.json");
const countries = data.countries.filter((c) => c.notes.some((n) => n.status === "live" && !n.pdf_only))
  .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
const bySlug = new Map(countries.map((c) => [c.slug, c]));
const kindTally = new Map();
for (const c of countries) for (const n of c.notes) if (n.status === "live" && !n.pdf_only) kindTally.set(n.kind, (kindTally.get(n.kind) || 0) + 1);
// Kinds as data.json labels them, replaced by the index's own labels once it loads (they can drift
// apart if the dashboard data is re-exported without rebuilding the index).
let kinds = [...kindTally.keys()].sort((a, b) => kindTally.get(b) - kindTally.get(a));
const liveNotes = [...kindTally.values()].reduce((a, b) => a + b, 0);

const params = new URLSearchParams(location.search);
const state = {
  q: params.get("q") || "",
  countries: new Set(split(params.get("country")).filter((s) => bySlug.has(s))),
  kinds: new Set(split(params.get("kind"))),
};

let pagefindP = null;
// Filter counts come back empty until Pagefind has loaded its filter chunks, so load them up front.
const loadPagefind = () => (pagefindP ??= import("./pagefind/pagefind.js")
  .then(async (pf) => { await pf.options({ excerptLength: 34 }); await pf.init(); await pf.filters(); return pf; })
  .catch((error) => { console.warn("Full-text index not available:", error); return null; }));

function pfFilters({ countries: cs, kinds: ks }) {
  const f = {};
  if (cs.size) f.country = { any: [...cs].map((s) => bySlug.get(s).name) };
  if (ks.size) f.kind = { any: [...ks] };
  return f;
}

/** Pagefind excerpts: text with <mark>s around matched words. Rebuilt, so only the marks survive. */
function excerptHtml(html) {
  const t = document.createElement("template");
  t.innerHTML = html || "";
  return [...t.content.childNodes].map((n) => (n.nodeName === "MARK" ? `<mark>${esc(n.textContent)}</mark>` : esc(n.textContent))).join("");
}
const readerHref = (m, q) => `../reader/index.html?country=${encodeURIComponent(m.slug)}&note=${encodeURIComponent(m.note)}`
  + `${q ? `&q=${encodeURIComponent(q)}` : ""}${m.anchor ? `#${encodeURIComponent(m.anchor)}` : ""}`;

function syncUrl() {
  const p = new URLSearchParams();
  if (state.q.trim()) p.set("q", state.q.trim());
  if (state.countries.size) p.set("country", [...state.countries].join(","));
  if (state.kinds.size) p.set("kind", [...state.kinds].join(","));
  const qs = p.toString().replace(/%2C/g, ",");
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  document.title = state.q.trim() ? `“${state.q.trim()}” · Search · CPIN Extractor` : "Search · CPIN Extractor";
}

/* ------------------------------------------------------------------ searching */

let run = 0, R = null, loading = false, totals = null;
let counts = { country: {}, kind: {} };
const resultsEl = $("#results"), heroEl = $("#hero"), q = $("#q");

async function search({ debounce = true } = {}) {
  const id = ++run, text = state.q.trim();
  syncUrl();
  renderChips();
  if (text.length < 2) {
    R = null;
    counts = totals || { country: {}, kind: {} };
    updateFacets();
    renderIdle();
    return;
  }
  resultsEl.classList.add("is-busy");
  const pf = await loadPagefind();
  if (id !== run) return;
  if (!pf) return renderMissing();
  let main, forCountries, forKinds;
  try {
    const filters = pfFilters(state);
    main = debounce ? await pf.debouncedSearch(text, { filters }, 150) : await pf.search(text, { filters });
    if (!main || id !== run) return;                                 // a later keystroke took over
    // Each facet is counted with the other facet's filter applied, so its numbers say what ticking adds.
    [forCountries, forKinds] = await Promise.all([
      state.countries.size ? pf.search(text, { filters: pfFilters({ ...state, countries: new Set() }) }) : main,
      state.kinds.size ? pf.search(text, { filters: pfFilters({ ...state, kinds: new Set() }) }) : main,
    ]);
  } catch (error) {
    console.error(error);
    return renderMissing("The search could not run.");
  }
  if (id !== run) return;
  counts = { country: forCountries.filters?.country || {}, kind: forKinds.filters?.kind || {} };
  const types = main.filters?.type || {};
  R = {
    id, q: text, results: main.results, loaded: 0, groups: new Map(),
    sections: types.text || 0, titles: types.title || 0,
    countries: Object.values(main.filters?.country || {}).filter((n) => n > 0).length,
  };
  updateFacets();
  renderQueryHero();
  renderList();
  await loadMore();
  if (id === run) resultsEl.classList.remove("is-busy");
}

async function loadMore() {
  if (!R || loading || R.loaded >= R.results.length) return updateMore();
  loading = true;
  const r = R, slice = r.results.slice(r.loaded, r.loaded + PAGE);
  let items;
  try { items = await Promise.all(slice.map((x) => x.data())); }
  finally { loading = false; }
  if (R !== r) return;
  r.loaded += slice.length;
  const list = $("#list");
  let fresh = 0;
  for (const d of items) {
    const m = d.meta, key = `${m.slug}/${m.note}`;
    let g = r.groups.get(key);
    if (!g) {
      g = { m, el: groupEl(m, fresh++), hits: 0, expanded: false };
      r.groups.set(key, g);
      list.append(g.el);
    }
    if (m.type === "title") { $(".sr-title-match", g.el).hidden = false; continue; }
    const li = document.createElement("li");
    li.innerHTML = `<a class="sr-hit" href="${esc(readerHref(m, r.q))}">${m.section ? `<span class="sr-section">${esc(m.section)}</span>` : `<span class="sr-section">Opening text</span>`}<span class="sr-excerpt">${excerptHtml(d.excerpt)}</span></a>`;
    g.hits++;
    if (g.hits > PER_NOTE && !g.expanded) li.hidden = true;
    $(".sr-hits", g.el).append(li);
    const more = g.hits - PER_NOTE;
    const btn = $(".sr-more-in", g.el);
    if (more > 0 && !g.expanded) { btn.hidden = false; btn.textContent = `${plural(more, "more section")} in this note`; }
  }
  hydrateFlags(list);
  updateMore();
  // A short page: keep filling while the end of the list is on screen.
  requestAnimationFrame(() => { if (R === r && sentinelNear()) loadMore(); });
}

function groupEl(m, i) {
  const c = bySlug.get(m.slug) || { name: m.country, iso_a2: m.iso_a2 };
  const el = document.createElement("article");
  el.className = "sr-note";
  el.style.setProperty("--i", String(i));
  const when = [fmtMonth(m.month), m.version ? `V${esc(m.version)}` : ""].filter(Boolean).join(" · ");
  el.innerHTML = `
    <div class="sr-note-top"><span class="tag tag--outline">${flag(c.iso_a2, "dotflag--tag")}${esc(c.name)}</span>
      <span class="sr-kind">${esc(m.kind)}</span>${when ? `<span class="sr-when">${when}</span>` : ""}
      <span class="tag sr-title-match" hidden>Title match</span></div>
    <h2 class="sr-note-title"><a class="sr-open" href="${esc(readerHref({ ...m, anchor: "" }, R.q))}">${esc(m.title)}</a></h2>
    <ol class="sr-hits"></ol>
    <button class="sr-more-in" type="button" hidden></button>`;
  return el;
}

/* ------------------------------------------------------------------ rendering */

function renderIdle() {
  resultsEl.classList.remove("is-busy");
  if (heroEl.dataset.mode === "idle") return renderAbout();
  heroEl.dataset.mode = "idle";
  heroEl.innerHTML = `
    <p class="eyebrow" style="--i:0">Search</p>
    <h1 class="hero-title" style="--i:1">Search the notes</h1>
    <p class="lede" style="--i:2">Every section of the ${num(liveNotes)} live notes, word for word as published on GOV.UK. Results open in the reader at the passage.
      Put a phrase in “quotes” to match it exactly.</p>
    <div class="sr-examples" style="--i:3"><span class="eyebrow">Try</span>${EXAMPLES.map((x) => `<button type="button" class="tag tag--outline" data-example="${esc(x)}">${esc(x)}</button>`).join("")}</div>
    <div class="sr-chips" id="chips" style="--i:4"></div>`;
  renderAbout();
  renderChips();
}

/** While nothing is typed: what the index holds, and the keys. */
function renderAbout() {
  if (R || state.q.trim().length >= 2) return;
  const t = totals?.type || {};
  const nCountries = totals ? Object.values(totals.country).filter((n) => n > 0).length : null;
  const stat = (n, label) => `<div class="sr-stat"><span class="numeral">${n == null ? "—" : num(n)}</span><span class="eyebrow">${label}</span></div>`;
  resultsEl.innerHTML = `<div class="sr-about pop-in">
    <div class="sr-stats">${stat(t.text, "Sections indexed")}${stat(t.title, "Notes")}${stat(nCountries, "Countries")}</div>
    <p class="sr-about-note">Built from the stored text of each live note’s current edition: the body, section by section, without footnotes, bibliographies or version control. Rebuild with <code>npm run search-index</code> after an export.</p>
    <p class="sr-keys"><span><kbd>/</kbd> search</span><span><kbd>↑</kbd><kbd>↓</kbd> move through results</span><span><kbd>Enter</kbd> open at the passage</span></p></div>`;
}

function renderQueryHero() {
  if (heroEl.dataset.mode !== "query") {
    heroEl.dataset.mode = "query";
    heroEl.innerHTML = `<p class="eyebrow" style="--i:0">Search</p><h1 class="hero-title sr-q" style="--i:1"></h1>
      <p class="sr-summary" style="--i:2"></p><div class="sr-chips" id="chips" style="--i:3"></div>`;
  }
  $(".sr-q", heroEl).textContent = `“${R.q}”`;
  $(".sr-summary", heroEl).innerHTML = R.results.length
    ? [`<span><b class="numeral">${num(R.sections)}</b> ${R.sections === 1 ? "section" : "sections"}</span>`,
       R.titles ? `<span><b class="numeral">${num(R.titles)}</b> note ${R.titles === 1 ? "title" : "titles"}</span>` : "",
       `<span><b class="numeral">${num(R.countries)}</b> ${R.countries === 1 ? "country" : "countries"}</span>`].filter(Boolean).join(`<i aria-hidden="true">·</i>`)
    : `No matches`;
  renderChips();
}

function renderChips() {
  const box = $("#chips");
  if (!box) return;
  const chips = [
    ...[...state.countries].map((s) => { const c = bySlug.get(s); return `<button type="button" class="tag sr-chip" data-remove-country="${esc(s)}" aria-label="Remove filter: ${esc(c.name)}">${flag(c.iso_a2, "dotflag--tag")}${esc(c.name)}<span aria-hidden="true">×</span></button>`; }),
    ...[...state.kinds].map((k) => `<button type="button" class="tag sr-chip" data-remove-kind="${esc(k)}" aria-label="Remove filter: ${esc(k)}">${esc(k)}<span aria-hidden="true">×</span></button>`),
  ];
  box.innerHTML = chips.length ? `${chips.join("")}<button type="button" class="sr-clear" data-clear="all">Clear filters</button>` : "";
  hydrateFlags(box);
}

function renderList() {
  if (!R.results.length) {
    const filtered = state.countries.size || state.kinds.size;
    resultsEl.innerHTML = `<div class="sr-empty pop-in"><span class="tag">No matches</span>
      <h2>Nothing in the text matches “${esc(R.q)}”${filtered ? " with these filters" : ""}.</h2>
      <p>${filtered ? `<button type="button" class="btn" data-clear="all">Search every country and kind</button> ` : ""}Try fewer or different words, or check the spelling. Search matches whole words and their endings (relocate, relocation).</p></div>`;
    return;
  }
  resultsEl.innerHTML = `<div class="sr-list" id="list"></div>
    <div class="sr-foot" id="more"><span class="sr-showing" id="showing"></span><button type="button" class="btn" id="loadMore">Load more</button></div>`;
  observer.observe($("#more"));
}

function updateMore() {
  const more = $("#more");
  if (!R || !more) return;
  const done = R.loaded >= R.results.length;
  $("#showing").textContent = done
    ? `${plural(R.groups.size, "note")} · all ${plural(R.results.length, "match", "matches")} shown`
    : `${plural(R.groups.size, "note")} · ${num(R.loaded)} of ${plural(R.results.length, "match", "matches")}`;
  $("#loadMore").hidden = done;
}
const sentinelNear = () => { const m = $("#more"); return m && m.getBoundingClientRect().top < innerHeight + 600; };
const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: "0px 0px 700px 0px" });

function renderMissing(message) {
  resultsEl.classList.remove("is-busy");
  resultsEl.innerHTML = `<div class="sr-empty pop-in"><span class="tag">Index</span><h2>${esc(message || "The full-text index has not been built.")}</h2>
    <p>Build it from the store with <code>cd web &amp;&amp; npm run search-index</code>, then reload this page.</p></div>`;
}

/* ------------------------------------------------------------------ facets */

const opt = (facet, value, name, extra = "") => `<li><label class="opt"><input type="checkbox" data-facet="${facet}" value="${esc(value)}">
  <span class="opt-box" aria-hidden="true"></span>${extra}<span class="opt-name" title="${esc(name)}">${esc(name)}</span><span class="opt-count numeral"></span></label></li>`;
const kindItems = () => [...new Set([...kinds, ...state.kinds])].map((k) => opt("kind", k, k)).join("");
function renderFacets() {
  $("#facetsIn").innerHTML = `
    <section class="facet">
      <div class="facet-head"><h2 class="eyebrow">Kind</h2><button type="button" class="facet-clear" data-clear="kind">Clear</button></div>
      <ul class="facet-list" id="kindList">${kindItems()}</ul>
    </section>
    <section class="facet">
      <div class="facet-head"><h2 class="eyebrow">Country</h2><button type="button" class="facet-clear" data-clear="country">Clear</button></div>
      <label class="facet-find"><input type="search" id="countryFind" placeholder="Filter ${countries.length} countries" autocomplete="off" spellcheck="false" aria-label="Filter the list of countries"></label>
      <ul class="facet-list facet-countries">${countries.map((c) => opt("country", c.slug, c.name, flag(c.iso_a2, "dotflag--row"))).join("")}</ul>
    </section>`;
  hydrateFlags($("#facetsIn"));
}

function updateFacets() {
  for (const input of document.querySelectorAll("input[data-facet]")) {
    const isCountry = input.dataset.facet === "country";
    const set = isCountry ? state.countries : state.kinds;
    const key = isCountry ? bySlug.get(input.value).name : input.value;
    const n = (isCountry ? counts.country : counts.kind)[key];
    input.checked = set.has(input.value);
    const label = input.closest(".opt");
    $(".opt-count", label).textContent = n == null ? "" : num(n);
    label.classList.toggle("is-zero", n === 0 && !input.checked);
  }
  for (const facet of ["kind", "country"]) {
    const set = facet === "country" ? state.countries : state.kinds;
    $(`.facet-clear[data-clear="${facet}"]`).classList.toggle("on", set.size > 0);
  }
  const active = state.countries.size + state.kinds.size;
  $("#filterCount").textContent = active ? active : "";
}

$("#facetsIn").addEventListener("change", (e) => {
  const input = e.target.closest("input[data-facet]");
  if (!input) return;
  const set = input.dataset.facet === "country" ? state.countries : state.kinds;
  if (input.checked) set.add(input.value); else set.delete(input.value);
  filtersChanged();
});
$("#facetsIn").addEventListener("input", (e) => {
  if (e.target.id !== "countryFind") return;
  const needle = e.target.value.trim().toLowerCase();
  for (const li of document.querySelectorAll(".facet-countries li")) {
    li.hidden = !!needle && !li.textContent.toLowerCase().includes(needle);
  }
});
function filtersChanged() {
  updateFacets();
  const top = resultsEl.getBoundingClientRect().top;
  if (top < 0) scrollBy({ top: top - 90, behavior: reduced.matches ? "auto" : "smooth" });
  search({ debounce: false });
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-clear],[data-remove-country],[data-remove-kind],[data-example],.sr-more-in,#loadMore,#filterToggle");
  if (!t) return;
  if (t.id === "loadMore") return loadMore();
  if (t.id === "filterToggle") {
    const open = !$(".sr-side").classList.contains("is-open");
    $(".sr-side").classList.toggle("is-open", open);
    t.setAttribute("aria-expanded", String(open));
    return;
  }
  if (t.dataset.example) { q.value = state.q = t.dataset.example; return search({ debounce: false }); }
  if (t.classList.contains("sr-more-in")) return expandGroup(t.closest(".sr-note"), t);
  if (t.dataset.removeCountry) state.countries.delete(t.dataset.removeCountry);
  if (t.dataset.removeKind) state.kinds.delete(t.dataset.removeKind);
  if (t.dataset.clear === "country" || t.dataset.clear === "all") state.countries.clear();
  if (t.dataset.clear === "kind" || t.dataset.clear === "all") state.kinds.clear();
  filtersChanged();
});

/** Show the rest of a note's sections, the list gliding open. */
function expandGroup(el, btn) {
  const g = R && [...R.groups.values()].find((x) => x.el === el);
  if (g) g.expanded = true;
  const list = $(".sr-hits", el), from = list.offsetHeight;
  list.querySelectorAll("li[hidden]").forEach((li) => { li.hidden = false; li.classList.add("is-new"); });
  btn.hidden = true;
  const to = list.offsetHeight;
  if (!reduced.matches) list.animate([{ height: `${from}px`, overflow: "hidden" }, { height: `${to}px`, overflow: "hidden" }], { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)" });
  list.querySelector("li.is-new .sr-hit")?.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ keyboard and header */

$("#form").addEventListener("submit", (e) => { e.preventDefault(); state.q = q.value; search({ debounce: false }); });
q.addEventListener("input", () => { state.q = q.value; search(); });
q.addEventListener("keydown", (e) => { if (e.key === "Escape" && q.value) { e.preventDefault(); q.value = state.q = ""; search(); } });

const focusables = () => [...resultsEl.querySelectorAll(".sr-open, .sr-hit")].filter((a) => a.offsetParent !== null);
function focusItem(el) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest", behavior: reduced.matches ? "auto" : "smooth" });
}
addEventListener("keydown", (e) => {
  const el = document.activeElement;
  const typing = (/^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName) && el.type !== "checkbox") || el?.isContentEditable;
  if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey)) {
    e.preventDefault(); q.focus(); q.select(); return;
  }
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const items = focusables();
  if (el === q) { if (e.key === "ArrowDown" && items.length) { e.preventDefault(); focusItem(items[0]); } return; }
  const i = items.indexOf(el);
  if (i < 0) return;
  e.preventDefault();
  if (e.key === "ArrowUp" && i === 0) { q.focus(); return; }
  const next = items[i + (e.key === "ArrowDown" ? 1 : -1)];
  if (next) focusItem(next);
  if (e.key === "ArrowDown" && i >= items.length - 4) loadMore();
});

const themeBtn = $("#theme");
const MODES = ["auto", "light", "dark"];
const currentMode = () => document.documentElement.dataset.theme || "auto";
function applyTheme(mode) {
  if (mode === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  try { localStorage.setItem("cpin-theme", mode); } catch {}
  themeBtn.textContent = mode.toUpperCase();
  themeBtn.setAttribute("aria-label", `Colour theme: ${mode}. Click to change.`);
  hydrateFlags(document, { force: true });
}
themeBtn.addEventListener("click", () => applyTheme(MODES[(MODES.indexOf(currentMode()) + 1) % MODES.length]));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (currentMode() === "auto") hydrateFlags(document, { force: true }); });
themeBtn.textContent = currentMode().toUpperCase();
$("#sync").textContent = `CHECKED ${fmtDateTime(data.last_sync)}`;
try {
  const saved = JSON.parse(localStorage.getItem("cpin-highlights-v1") || "[]");
  if (saved.length) $("#savedCount").textContent = saved.length;
} catch {}

/* ------------------------------------------------------------------ start */

q.value = state.q;
renderFacets();
if (state.q.trim().length >= 2) search({ debounce: false }); else { renderIdle(); updateFacets(); }
// Index-wide counts for the filters while nothing is typed.
loadPagefind().then(async (pf) => {
  if (!pf) { if (!state.q.trim()) renderMissing(); return; }
  const all = await pf.filters();
  totals = { country: all.country || {}, kind: all.kind || {}, type: all.type || {} };
  const indexKinds = Object.keys(totals.kind).sort((a, b) => totals.kind[b] - totals.kind[a]);
  if (indexKinds.length && indexKinds.join("|") !== kinds.join("|")) {
    kinds = indexKinds;
    $("#kindList").innerHTML = kindItems();
    updateFacets();
  }
  if (!R && state.q.trim().length < 2) { counts = totals; updateFacets(); renderAbout(); }
});
if (!state.q) q.focus({ preventScroll: true });

// ?test exposes state for automated checks.
if (params.has("test")) window.cpinSearch = { state: () => ({ ...state, countries: [...state.countries], kinds: [...state.kinds], results: R?.results.length ?? null, loaded: R?.loaded ?? 0, sections: R?.sections, titles: R?.titles, countriesHit: R?.countries, groups: R ? [...R.groups.keys()] : [], counts }) };
