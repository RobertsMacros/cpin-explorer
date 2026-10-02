// CPIN Extractor dashboard: a COBE globe of the countries the Home Office publishes notes on,
// with each country's notes, GOV.UK's own change history and a search over countries and topics.
// Data: data.json, written by `./cpin export` from the scraper's store.
import { createGlobe, feature, geoBounds, geoContains } from "../vendor/globe-deps.js";
import { makeCountryLocator } from "../shared/country-locator.js";
import { hydrateFlags } from "../shared/dot-flag.js";
import { fetchJson } from "../shared/fetch-json.js";
import { focus, project, shortestTurn, unproject } from "../shared/globe-math.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const narrow = matchMedia("(max-width: 900px)");
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const fmtDateTime = (iso) => iso ? `${fmtDate(iso)} · ${new Date(iso).toISOString().slice(11, 16)} UTC` : "—";
const fmtMonth = (ym) => (ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : "");
const daysAgo = (iso) => (Date.now() - Date.parse(iso)) / 864e5;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "S"}`;
const flagCanvas = (c, cols, cls = "", reveal = false, interactive = false) => (c.iso_a2
  ? `<canvas class="dotflag ${cls}" data-flag="${c.iso_a2}" data-cols="${cols}"${reveal ? " data-reveal" : ""}${interactive ? " data-interactive" : ""} aria-hidden="true"></canvas>`
  : "");

const [data, topo] = await Promise.all([fetchJson("data.json"), fetchJson("../vendor/countries-gbr.json")]);
const countries = data.countries;
const bySlug = new Map(countries.map((c) => [c.slug, c]));
const liveNotes = (c) => c.notes.filter((n) => n.status === "live");
const isRecent = (c) => c.updated && daysAgo(c.updated) <= 30;

const countryAt = makeCountryLocator({ topo, data, feature, geoBounds, geoContains });

// --- Globe -----------------------------------------------------------------------------------
const canvas = $("#globe"), wrap = $("#globeWrap"), pinsEl = $("#pins"), panel = $("#panel");
const dpr = Math.min(2, window.devicePixelRatio || 1);    // capped: 4K stays smooth
let size = Math.round(wrap.getBoundingClientRect().width) || 600;
new ResizeObserver(() => { size = Math.round(wrap.getBoundingClientRect().width) || size; }).observe(wrap);

let { phi, theta } = focus([24, 38]);                       // start over Africa and the Middle East
let vPhi = 0, dragging = false, moved = 0, lastX = 0, lastY = 0, lastInteract = 0, flight = null;
let selected = null, hovered = null, query = "", filterKind = "all";
let scopeAll = false, notesShown = 8, countryQuery = "";     // search: scope toggle, note titles shown, country box

const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};
function palette() {
  return isDark()
    ? { dark: 1, diffuse: 1.2, mapBrightness: 6, baseColor: [0.3, 0.33, 0.42], glowColor: [0.1, 0.12, 0.26], markerColor: [0.46, 0.53, 1] }
    : { dark: 0, diffuse: 0.4, mapBrightness: 1.2, baseColor: [1, 1, 1], glowColor: [0.95, 0.96, 1], markerColor: [0.165, 0.235, 0.96] };
}
const SLATE = () => (isDark() ? [0.5, 0.55, 0.7] : [0.42, 0.48, 0.6]);
function markers() {
  const blue = palette().markerColor, slate = SLATE();
  return countries.map((c) => ({
    location: c.marker,
    size: c.slug === selected ? 0.07 : 0.03 + 0.0028 * Math.min(liveNotes(c).length, 12),
    color: c.slug === selected || isRecent(c) ? blue : slate,
  }));
}

// COBE v2 draws one frame per update() and has no loop of its own, so we drive it, and skip
// drawing entirely while the globe is still (a selected country, reduced motion).
const globe = createGlobe(canvas, {
  devicePixelRatio: dpr, width: size, height: size, phi, theta,   // width/height in CSS pixels
  mapSamples: 20000, mapBaseBrightness: 0, markerElevation: 0.012, scale: 1, offset: [0, 0],
  ...palette(), markers: markers(),
});
let drawn = { phi: NaN, theta: NaN, size };
function frame(now) {
  step(now);
  if (phi !== drawn.phi || theta !== drawn.theta || size !== drawn.size) {
    const u = { phi, theta };
    if (size !== drawn.size) { u.width = size; u.height = size; }     // resizing reallocates: only when needed
    globe.update(u);
    drawn = { phi, theta, size };
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
requestAnimationFrame(() => canvas.classList.add("ready"));

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
function step(now) {
  if (flight) {
    const t = Math.min(1, (now - flight.t0) / flight.dur), e = easeInOut(t);
    phi = flight.phi0 + flight.dPhi * e;
    theta = flight.theta0 + flight.dTheta * e;
    if (t >= 1) flight = null;
  } else if (!dragging) {
    if (Math.abs(vPhi) > 1e-4) { phi += vPhi; vPhi *= 0.93; }          // inertia after a drag
    else if (!reduced.matches && !selected && now - lastInteract > 3500) phi += 0.0014;
  }
  placePins();
}
function flyTo(latLon) {
  const target = focus(latLon, { minTheta: -0.55, maxTheta: 0.7 });
  flight = { t0: performance.now(), dur: reduced.matches ? 1 : 1150, phi0: phi, dPhi: shortestTurn(phi, target.phi),
             theta0: theta, dTheta: target.theta - theta };
  vPhi = 0;
}

// Pins: a focusable button on every marker, carrying a COBE-style label tag with a dotted flag.
const pins = countries.map((c) => {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `pin${isRecent(c) ? " is-recent" : ""}`;
  el.dataset.slug = c.slug;
  el.dataset.place = "top";
  el.setAttribute("aria-label", `${c.name}: ${liveNotes(c).length} notes`);
  el.innerHTML = `<span class="tag pin-label">${flagCanvas(c, 8, "dotflag--tag")}<span>${esc(c.name)}</span><b>${liveNotes(c).length}</b></span>`;
  pinsEl.append(el);
  return { c, el, label: el.firstElementChild, behind: null, labelled: false, place: "top",
           count: liveNotes(c).length, recent: isRecent(c), x: 0, y: 0, depth: 0, w: 0, h: 0 };
});
let labelOffset = 19;                     // px from a marker to its label's near edge (CSS: 1.2rem)
function measureLabels() {
  labelOffset = parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.2;
  for (const p of pins) { p.w = p.label.offsetWidth; p.h = p.label.offsetHeight; }
}
document.fonts.ready.then(() => hydrateFlags(pinsEl)).then(measureLabels);
new ResizeObserver(measureLabels).observe(document.documentElement);

function placePins() {
  const view = { phi, theta, elevation: 0.012 };
  for (const p of pins) {
    const r = project(p.c.marker, view);
    p.x = r.x * size; p.y = r.y * size; p.depth = r.depth;
    p.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
    p.el.style.setProperty("--vis", Math.max(0, Math.min(1, r.depth / 0.2)).toFixed(3));
    const behind = r.depth <= 0.03;
    if (behind !== p.behind) {
      p.behind = behind;
      p.el.classList.toggle("is-behind", behind);
      p.el.tabIndex = behind ? -1 : 0;
    }
  }
  layoutLabels();
}

// As many labels as fit: highest priority first (selected, hovered, recently updated, most notes,
// nearest the viewer), each trying its current side first so labels don't flicker, then the others.
const SIDES = ["top", "right", "left", "bottom"];
function labelRect(p, side) {
  const o = labelOffset, { w, h } = p;
  if (side === "top") return [p.x - w / 2, p.y - o - h, w, h];
  if (side === "bottom") return [p.x - w / 2, p.y + o, w, h];
  if (side === "right") return [p.x + o, p.y - h / 2, w, h];
  return [p.x - o - w, p.y - h / 2, w, h];
}
const overlaps = (a, b, pad = 5) =>
  a[0] < b[0] + b[2] + pad && b[0] < a[0] + a[2] + pad && a[1] < b[1] + b[3] + pad && b[1] < a[1] + a[3] + pad;
function layoutLabels() {
  const rank = (p) => (p.c.slug === selected ? 1e4 : 0) + (p.c.slug === hovered ? 5e3 : 0) + (p.recent ? 200 : 0)
    + p.count * 4 + p.depth * 60;
  const candidates = pins.filter((p) => p.w && (p.depth > 0.28 || p.c.slug === selected || p.c.slug === hovered))
    .sort((a, b) => rank(b) - rank(a));
  const placed = [], shown = new Set();
  for (const p of candidates) {
    for (const side of [p.place, ...SIDES.filter((s) => s !== p.place)]) {
      const rect = labelRect(p, side);
      if (rect[1] < -4 || rect[0] < -40 || rect[0] + rect[2] > size + 40) continue;
      if (placed.some((q) => overlaps(q, rect))) continue;
      placed.push(rect);
      shown.add(p);
      if (side !== p.place) { p.place = side; p.el.dataset.place = side; }
      break;
    }
  }
  for (const p of pins) {
    const on = shown.has(p);
    if (on !== p.labelled) { p.labelled = on; p.el.classList.toggle("is-labelled", on); }
  }
}

function hitAt(e) {
  const r = canvas.getBoundingClientRect();
  const latLon = unproject((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, { phi, theta });
  return latLon ? countryAt(latLon) : null;
}
function setHover(slug) {
  if (slug === hovered) return;
  hovered = slug;
  for (const p of pins) p.el.classList.toggle("is-hover", p.c.slug === slug);
  canvas.classList.toggle("over-country", !!slug);
}
let pendingHover = null;
function queueHover(e) {
  if (!pendingHover) requestAnimationFrame(() => { setHover(hitAt(pendingHover)); pendingHover = null; });
  pendingHover = e;
}

canvas.addEventListener("pointerdown", (e) => {
  dragging = true; moved = 0; vPhi = 0; flight = null;
  lastX = e.clientX; lastY = e.clientY; lastInteract = performance.now();
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  canvas.classList.add("dragging");
});
canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return queueHover(e);
  const k = Math.PI / Math.max(size, 1);                 // a full drag across turns it half way round
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
  phi += dx * k;
  theta = Math.max(-0.9, Math.min(0.9, theta + dy * k));
  vPhi = dx * k;
  lastInteract = performance.now();
  setHover(null);
});
canvas.addEventListener("pointerup", (e) => {
  if (!dragging) return;
  dragging = false;
  canvas.classList.remove("dragging");
  if (moved < 6) {                                        // a click, not a drag
    vPhi = 0;
    const slug = hitAt(e);
    if (slug) select(slug);
  }
});
canvas.addEventListener("pointercancel", () => { dragging = false; canvas.classList.remove("dragging"); });
canvas.addEventListener("pointerleave", () => { if (!dragging) setHover(null); });
pinsEl.addEventListener("click", (e) => { const pin = e.target.closest(".pin"); if (pin) select(pin.dataset.slug); });
pinsEl.addEventListener("pointerover", (e) => { const pin = e.target.closest(".pin"); if (pin) setHover(pin.dataset.slug); });
pinsEl.addEventListener("pointerout", (e) => { if (e.target.closest(".pin")) setHover(null); });

// --- Selection and routing -------------------------------------------------------------------
function select(slug, { fly = true, record = true } = {}) {
  if (slug && !bySlug.has(slug)) return;
  selected = slug;
  filterKind = "all";
  scopeAll = false;
  countryQuery = "";
  for (const p of pins) p.el.classList.toggle("is-selected", p.c.slug === slug);
  globe.update({ markers: markers() });
  if (slug && fly) flyTo(bySlug.get(slug).marker);
  if (record) history.replaceState(null, "", slug ? `#${slug}` : location.pathname + location.search);
  render();
  const behavior = reduced.matches ? "auto" : "smooth";
  if (narrow.matches && slug) panel.scrollIntoView({ behavior, block: "start" });
  else window.scrollTo({ top: 0, behavior });
}
addEventListener("hashchange", () => select(location.hash.slice(1) || null, { record: false }));

// --- Panel -----------------------------------------------------------------------------------
let lastView = "";
function render() {
  const view = query.trim() ? "search" : selected ? `country:${selected}` : "overview";
  // While typing, the text hits stay put (dimmed) until the new ones arrive, rather than blinking out.
  const keepText = view === "search" && lastView === "search" ? $("#textHits", panel) : null;
  panel.classList.toggle("no-anim", view === "search" && lastView === "search");
  lastView = view;
  panel.innerHTML = view === "search" ? searchView() : selected ? countryView(bySlug.get(selected)) : overview();
  if (keepText) $("#textHits", panel)?.replaceWith(keepText);
  [...panel.children].forEach((el, i) => el.style.setProperty("--i", i));
  panel.querySelectorAll(".odo").forEach(odometer);
  hydrateFlags(panel);
}

const stat = (n, label) => `<div class="stat"><span class="numeral odo" data-value="${n}">${n}</span><span class="eyebrow">${esc(label)}</span></div>`;
const changeRow = (h) => `<li class="change"><time class="change-date" datetime="${esc(h.date)}">${fmtDate(h.date)}</time>
  <div class="change-body"><button class="country-link linkish" data-slug="${h.country}">${flagCanvas(bySlug.get(h.country), 8, "dotflag--tag")}${esc(h.name)}</button><p>${esc(h.note)}</p></div></li>`;

function overview() {
  const t = data.totals;
  return `
    <p class="eyebrow">Home Office · GOV.UK</p>
    <h1 class="hero-title">Country notes</h1>
    <p class="lede">Every country policy and information note, mirrored word for word from GOV.UK and checked daily, with earlier editions kept so changes can be compared.</p>
    <div class="stats">${stat(t.countries, "Countries")}${stat(t.notes, "Notes")}${stat(t.pdfs, "PDF editions")}${stat(t.archived_editions, "Archived editions")}</div>
    <p class="meta-line"><span>LAST CHECKED ${fmtDateTime(data.last_sync)}</span><a href="${esc(data.source)}" target="_blank" rel="noopener">SOURCE: GOV.UK ↗</a></p>
    <section class="section" style="margin-top:2.4rem">
      <div class="section-head"><h2 class="eyebrow">All countries</h2><span class="eyebrow">${countries.length}</span></div>
      <div class="country-index">${countries.map((c) => `<button class="country-row" data-slug="${c.slug}">
        <i class="fresh${isRecent(c) ? "" : " stale"}" title="${isRecent(c) ? "Updated in the last 30 days" : ""}"></i>
        ${flagCanvas(c, 8, "dotflag--row")}<span class="name">${esc(c.name)}</span><span class="count">${liveNotes(c).length}</span></button>`).join("")}</div>
    </section>
    <section class="section">
      <div class="section-head"><h2 class="eyebrow">Recent changes</h2><span class="eyebrow">As published on GOV.UK</span></div>
      <ol class="changes">${data.recent_changes.slice(0, 14).map(changeRow).join("")}</ol>
    </section>`;
}

function noteCard(n, i) {
  const gone = n.status !== "live";
  const status = n.status === "removed" ? `<span class="tag tag--muted">Removed from GOV.UK</span>`
    : n.status === "archived" ? `<span class="tag tag--muted">Archived copy only</span>` : "";
  const when = [n.month ? fmtMonth(n.month) : fmtDate(n.updated), n.version ? `V${esc(n.version)}` : ""].filter(Boolean).join(" · ");
  const editions = n.editions > 1 ? `${n.editions} EDITIONS ON RECORD · EARLIEST ${n.earliest ? fmtDate(n.earliest) : "—"}` : "1 EDITION ON RECORD";
  return `<article class="note${gone ? " is-gone" : ""}" style="--i:${i}" title="${esc(n.title)}">
    <div class="note-top"><span class="tag ${gone ? "tag--muted" : "tag--outline"}">${esc(n.kind)}</span>
      <span class="note-when">${when}</span>${n.pdf_only ? `<span class="tag tag--muted">PDF only</span>` : ""}${status}</div>
    <h3 class="note-title">${esc(n.topic || n.title)}</h3>
    ${n.latest_change ? `<p class="note-change"><span class="eyebrow">What changed${n.latest_change.version ? ` in v${esc(n.latest_change.version)}` : ""}</span> “${esc(n.latest_change.statement)}”</p>` : ""}
    <div class="note-meta">${editions}</div>
    <div class="note-actions">
      ${n.pdf_only ? "" : `<a class="btn btn--primary" href="../reader/index.html?country=${esc(currentSlug)}&note=${encodeURIComponent(n.id)}">Read</a>`}
      ${n.govuk_url && !n.pdf_only ? `<a class="btn" href="${esc(n.govuk_url)}" target="_blank" rel="noopener">GOV.UK ↗</a>` : ""}
      ${n.pdf_url ? `<a class="btn" href="${esc(n.pdf_url)}" target="_blank" rel="noopener">PDF ↗</a>` : ""}
      ${gone && n.archive_url ? `<a class="btn" href="${esc(n.archive_url)}" target="_blank" rel="noopener">Archived copy ↗</a>` : ""}
      ${n.compare_url ? `<a class="btn" href="${esc(n.compare_url)}">Compare ${n.editions} editions</a>` : ""}
    </div></article>`;
}
let currentSlug = null;
function notesList(c) {
  currentSlug = c.slug;
  const shown = c.notes.filter((n) => filterKind === "all" || n.kind === filterKind);
  return shown.map(noteCard).join("") || `<p class="empty">No notes of this kind.</p>`;
}
function countryView(c) {
  const live = liveNotes(c);
  const archived = c.notes.reduce((sum, n) => sum + n.archived_editions, 0);
  const kinds = [...new Set(c.notes.map((n) => n.kind))];
  const count = (k) => (k === "all" ? c.notes.length : c.notes.filter((n) => n.kind === k).length);
  const filters = kinds.length > 1
    ? `<div class="filters" role="group" aria-label="Filter notes by kind">${["all", ...kinds].map((k) =>
        `<button class="filter" data-kind="${esc(k)}" aria-pressed="${filterKind === k}">${k === "all" ? "All" : esc(k)} ${count(k)}</button>`).join("")}</div>`
    : `<div style="height:1.4rem"></div>`;
  return `
    <button class="btn back" data-action="back">← All countries</button>
    <div class="country-head">
      ${flagCanvas(c, 24, "dotflag--hero", true, true)}
      <div><p class="eyebrow">Country</p><h1 class="country-title">${esc(c.name)}</h1></div>
    </div>
    <p class="meta-line"><span>UPDATED ${fmtDate(c.updated)}</span><span>${plural(live.length, "NOTE")}</span>
      ${archived ? `<span>${plural(archived, "ARCHIVED EDITION")}</span>` : ""}
      <a href="${esc(c.govuk_url)}" target="_blank" rel="noopener">GOV.UK PAGE ↗</a></p>
    ${c.caveat ? `<p class="caveat">${esc(c.caveat)}</p>` : ""}
    ${countrySearchHtml(c)}
    ${filters}
    <div class="notes">${notesList(c)}</div>
    <section class="section" style="margin-top:2.6rem">
      <div class="section-head"><h2 class="eyebrow">Change history</h2><span class="eyebrow">As published on GOV.UK</span></div>
      <ol class="history">${c.history.map((h) => `<li><time datetime="${esc(h.date)}">${fmtDate(h.date)}</time><p>${esc(h.note)}</p></li>`).join("")}</ol>
    </section>`;
}

const highlight = (text, words) => words.reduce((out, w) =>
  out.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"), "<mark>$1</mark>"), esc(text));
function searchView() {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const match = (s) => words.every((w) => s.toLowerCase().includes(w));
  const scope = textScope();
  const cs = countries.filter((c) => match(c.name));
  const ns = countries.filter((c) => !scope || c.slug === scope)
    .flatMap((c) => c.notes.filter((n) => n.status === "live" && match(`${n.topic} ${n.kind} ${c.name}`)).map((n) => ({ c, n })));
  const more = ns.length > notesShown
    ? `<button class="more" type="button" data-action="more-notes">Show all ${ns.length} note titles</button>` : "";
  return `
    <p class="eyebrow">Search</p>
    <h1 class="hero-title">“${esc(query.trim())}”</h1>
    ${scopeHtml()}
    <div class="results-group"><div class="section-head"><h2 class="eyebrow">Countries</h2><span class="eyebrow">${cs.length}</span></div>
      ${cs.map((c) => `<button class="hit" data-slug="${c.slug}">${flagCanvas(c, 8, "dotflag--row")}<span>${highlight(c.name, words)}</span><small>${plural(liveNotes(c).length, "NOTE")} · UPDATED ${fmtDate(c.updated)}</small></button>`).join("") || `<p class="empty">No countries match.</p>`}</div>
    <div class="results-group"><div class="section-head"><h2 class="eyebrow">Notes</h2><span class="eyebrow">${ns.length}</span></div>
      ${ns.slice(0, notesShown).map(({ c, n }) => `<button class="hit" data-slug="${c.slug}"><span class="hit-text">${highlight(n.topic || n.title, words)}</span><small>${esc(c.name.toUpperCase())} · ${esc(n.kind.toUpperCase())}${n.month ? ` · ${fmtMonth(n.month)}` : ""}</small></button>`).join("") || `<p class="empty">No note titles match.</p>`}${more}</div>
    <div class="results-group text-hits" id="textHits">${textGroupHtml()}</div>
    <p class="source-note">Countries and Notes match names and titles. In the text searches every section of the live notes, word for word as stored.</p>`;
}

/* --- Full-text search: a Pagefind index of every section of the live notes, built by
   `npm run search-index` into ../search/pagefind/ and loaded the first time a search box is used. -- */
let pagefindP = null;
function loadPagefind() {
  pagefindP ??= import("../search/pagefind/pagefind.js")
    .then(async (pf) => { await pf.options({ excerptLength: 22 }); await pf.init(); return pf; })
    .catch((error) => { console.warn("Full-text index not available:", error); return null; });
  return pagefindP;
}
/** Pagefind excerpts: text with <mark>s around the matched words. Rebuilt, so only the marks survive. */
function excerptHtml(html) {
  const t = document.createElement("template");
  t.innerHTML = html || "";
  return [...t.content.childNodes].map((n) => (n.nodeName === "MARK" ? `<mark>${esc(n.textContent)}</mark>` : esc(n.textContent))).join("");
}
const readerHref = (m, q) => `../reader/index.html?country=${encodeURIComponent(m.slug)}&note=${encodeURIComponent(m.note)}`
  + `${q ? `&q=${encodeURIComponent(q)}` : ""}${m.anchor ? `#${encodeURIComponent(m.anchor)}` : ""}`;
const searchHref = (q, slug) => `../search/index.html?q=${encodeURIComponent(q)}${slug ? `&country=${encodeURIComponent(slug)}` : ""}`;
const possessive = (name) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);
function textHitHtml(h, q, { country = true, i = 0 } = {}) {
  const m = h.meta, c = bySlug.get(m.slug) || { name: m.country, iso_a2: m.iso_a2 };
  return `<a class="thit" href="${esc(readerHref(m, q))}" data-hover="${esc(m.slug)}" style="--i:${i}">
    <span class="thit-top">${country ? `<span class="tag tag--outline">${flagCanvas(c, 8, "dotflag--tag")}${esc(c.name)}</span>` : ""}<span class="thit-topic">${esc(m.title)}</span></span>
    ${m.section ? `<span class="thit-section">${esc(m.section)}</span>` : ""}
    <span class="thit-excerpt">${excerptHtml(h.excerpt)}</span></a>`;
}
/** Swap a box's contents, gliding its height from old to new (no jump in what follows it). */
function swapContent(el, html) {
  const from = el.offsetHeight;
  el.innerHTML = html;
  const to = el.offsetHeight;
  if (!reduced.matches && Math.abs(from - to) > 1) {
    el.animate([{ height: `${from}px`, overflow: "hidden" }, { height: `${to}px`, overflow: "hidden" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
  hydrateFlags(el);
}

// ⌘K search: "In the text", scoped to the selected country unless "Everywhere" is chosen.
const TEXT_LIMIT = 6;
let textRes = { key: "", q: "", status: "idle", hits: [], total: 0 };
const textScope = () => (selected && !scopeAll ? selected : null);
const textKey = () => `${textScope() || "*"}|${query.trim()}`;
function scopeHtml() {
  if (!selected) return "";
  const c = bySlug.get(selected);
  return `<div class="scope" role="radiogroup" aria-label="Where to search">
    <button type="button" role="radio" data-scope="country" aria-checked="${!scopeAll}">${flagCanvas(c, 8, "dotflag--tag")}In ${esc(c.name)}</button>
    <button type="button" role="radio" data-scope="all" aria-checked="${scopeAll}">Everywhere</button></div>`;
}
function textGroupHtml() {
  const q = query.trim(), scope = textScope(), fresh = textRes.key === textKey();
  const where = scope ? ` in ${bySlug.get(scope).name}` : "";
  let body;
  if (q.length < 2) body = `<p class="empty">Type two or more letters to search inside the notes.</p>`;
  else if (textRes.status === "missing" || textRes.status === "error") body = `<p class="empty">The full-text index is not available here. Build it with <code>npm run search-index</code> in <code>web/</code>.</p>`;
  else if (!fresh) body = `<p class="empty searching">Searching the text${esc(where)}…</p>`;
  else if (!textRes.hits.length) body = `<p class="empty">No passages${esc(where)} contain “${esc(q)}”.</p>`;
  else body = `<div class="thits">${textRes.hits.map((h, i) => textHitHtml(h, textRes.q, { i })).join("")}</div>`;
  const all = fresh && textRes.total > 0 ? `<a class="all-results" href="${esc(searchHref(q, scope))}">All ${textRes.total} results${esc(where)} →</a>` : "";
  return `<div class="section-head"><h2 class="eyebrow">In the text</h2><span class="eyebrow">${fresh && textRes.status === "done" ? textRes.total : "…"}</span></div>${body}${all}`;
}
async function runTextSearch() {
  const q = query.trim(), key = textKey(), scope = textScope();
  if (q.length < 2) { const box = $("#textHits", panel); if (box) swapContent(box, textGroupHtml()); return; }
  $("#textHits", panel)?.classList.add("is-busy");
  const pf = await loadPagefind();
  if (key !== textKey()) return;
  try {
    if (!pf) throw new Error("no index");
    const filters = { type: "text", ...(scope ? { country: bySlug.get(scope).name } : {}) };
    const res = await pf.debouncedSearch(q, { filters }, 150);
    if (!res || key !== textKey()) return;                       // superseded by a later keystroke
    const hits = await Promise.all(res.results.slice(0, TEXT_LIMIT).map((r) => r.data()));
    if (key !== textKey()) return;
    textRes = { key, q, status: "done", hits, total: res.results.length };
  } catch (error) {
    textRes = { key, q, status: pf ? "error" : "missing", hits: [], total: 0 };
    if (pf) console.warn(error);
  }
  const box = $("#textHits", panel);
  if (!box) return;
  box.classList.remove("is-busy");
  box.classList.add("is-fresh");
  swapContent(box, textGroupHtml());
}

// Country view: a box that searches the text of that country's notes, with hits inline.
let countryRes = { key: "", status: "idle", hits: [], total: 0 };
const countryKey = () => `${selected}|${countryQuery.trim()}`;
function countrySearchHtml(c) {
  return `<div class="csearch">
    <label class="csearch-box"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.4 10.4 14 14" stroke="currentColor" stroke-width="1.4"/></svg>
      <input id="cq" type="search" value="${esc(countryQuery)}" placeholder="Search ${esc(possessive(c.name))} notes" aria-label="Search the text of ${esc(possessive(c.name))} notes" autocomplete="off" spellcheck="false">
      <span class="csearch-count numeral" id="cqCount" aria-live="polite"></span></label>
    <div class="csearch-results" id="cqHits"></div></div>`;
}
function countryResultsHtml() {
  const c = bySlug.get(selected), q = countryQuery.trim();
  if (q.length < 2 || countryRes.key !== countryKey()) return "";
  if (countryRes.status !== "done") return `<p class="empty">The full-text index is not available here. Build it with <code>npm run search-index</code> in <code>web/</code>.</p>`;
  if (!countryRes.hits.length) return `<p class="empty">No passages in ${esc(possessive(c.name))} notes contain “${esc(q)}”.</p>`;
  return `<div class="thits">${countryRes.hits.map((h, i) => textHitHtml(h, q, { country: false, i })).join("")}</div>
    <a class="all-results" href="${esc(searchHref(q, selected))}">All ${countryRes.total} results in ${esc(c.name)} →</a>`;
}
async function runCountrySearch() {
  const c = bySlug.get(selected), q = countryQuery.trim(), key = countryKey();
  const box = $("#cqHits", panel);
  if (!c || !box) return;
  if (q.length < 2) {
    countryRes = { key, status: "idle", hits: [], total: 0 };
    $("#cqCount", panel).textContent = "";
    return swapContent(box, "");
  }
  box.classList.add("is-busy");
  const pf = await loadPagefind();
  try {
    if (!pf) throw new Error("no index");
    const res = await pf.debouncedSearch(q, { filters: { type: "text", country: c.name } }, 150);
    if (!res || key !== countryKey()) return;
    const hits = await Promise.all(res.results.slice(0, 5).map((r) => r.data()));
    if (key !== countryKey()) return;
    countryRes = { key, status: "done", hits, total: res.results.length };
  } catch (error) {
    countryRes = { key, status: "error", hits: [], total: 0 };
  }
  box.classList.remove("is-busy");
  $("#cqCount", panel).textContent = countryRes.status === "done" ? countryRes.total : "";
  swapContent(box, countryResultsHtml());
}

function odometer(el) {
  const value = String(el.dataset.value);
  el.setAttribute("aria-label", value);
  el.innerHTML = [...value].map((ch, k) => (/\d/.test(ch)
    ? `<span class="odo-d" aria-hidden="true"><span class="odo-strip" style="--k:${k}">${[..."0123456789"].map((d) => `<span>${d}</span>`).join("")}</span></span>`
    : `<span aria-hidden="true">${ch}</span>`)).join("");
  const digits = value.replace(/\D/g, "");
  requestAnimationFrame(() => requestAnimationFrame(() =>
    el.querySelectorAll(".odo-strip").forEach((strip, i) => { strip.style.transform = `translateY(-${Number(digits[i]) * 10}%)`; })));
}

panel.addEventListener("click", (e) => {
  const t = e.target.closest("[data-action],[data-kind],[data-slug],[data-scope]");
  if (!t) return;
  if (t.dataset.action === "back") return select(null);
  if (t.dataset.action === "more-notes") { notesShown = Infinity; render(); return; }
  if (t.dataset.scope) {
    scopeAll = t.dataset.scope === "all";
    render();
    runTextSearch();
    q.focus({ preventScroll: true });
    return;
  }
  if (t.dataset.kind) {
    filterKind = t.dataset.kind;
    panel.querySelectorAll(".filter").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === filterKind)));
    $(".notes", panel).innerHTML = notesList(bySlug.get(selected));
    return;
  }
  if (t.dataset.slug) {
    if (query) { query = ""; $("#q").value = ""; }
    select(t.dataset.slug);
  }
});
panel.addEventListener("pointerover", (e) => { const t = e.target.closest("[data-slug],[data-hover]"); if (t) setHover(t.dataset.slug || t.dataset.hover); });
panel.addEventListener("pointerout", (e) => { if (e.target.closest("[data-slug],[data-hover]")) setHover(null); });
// The country view's text search box.
panel.addEventListener("focusin", (e) => { if (e.target.id === "cq") loadPagefind(); });
panel.addEventListener("input", (e) => { if (e.target.id === "cq") { countryQuery = e.target.value; runCountrySearch(); } });
panel.addEventListener("keydown", (e) => {
  if (e.target.id === "cq") {
    if (e.key === "Escape" && e.target.value) { e.preventDefault(); e.target.value = ""; countryQuery = ""; runCountrySearch(); }
    if (e.key === "Enter") { const first = $("#cqHits .thit", panel); if (first) location.href = first.href; }
    if (e.key === "ArrowDown") { const first = $("#cqHits .thit", panel); if (first) { e.preventDefault(); first.focus(); } }
    return;
  }
  // Arrow keys move through search results.
  const items = [...panel.querySelectorAll(".hit, .thit, .more, .all-results")];
  const i = items.indexOf(document.activeElement);
  if (i < 0 || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
  e.preventDefault();
  const next = items[i + (e.key === "ArrowDown" ? 1 : -1)];
  if (next) { next.focus({ preventScroll: true }); next.scrollIntoView({ block: "nearest", behavior: reduced.matches ? "auto" : "smooth" }); }
  else if (e.key === "ArrowUp") (document.activeElement.closest(".csearch") ? $("#cq", panel) : q).focus();
});

// --- Search, theme, header -------------------------------------------------------------------
const q = $("#q");
q.addEventListener("focus", loadPagefind, { once: true });
q.addEventListener("input", () => { query = q.value; notesShown = 8; render(); runTextSearch(); });
q.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { q.value = ""; query = ""; render(); q.blur(); }
  if (e.key === "Enter") {
    const first = panel.querySelector(".hit[data-slug]");
    if (first) { const slug = first.dataset.slug; q.value = ""; query = ""; select(slug); }
  }
  if (e.key === "ArrowDown" && query.trim()) {
    const first = panel.querySelector(".hit, .thit");
    if (first) { e.preventDefault(); first.focus({ preventScroll: true }); first.scrollIntoView({ block: "nearest", behavior: reduced.matches ? "auto" : "smooth" }); }
  }
});
addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
    e.preventDefault(); q.focus(); q.select();
  }
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
  globe.update({ ...palette(), markers: markers() });
  hydrateFlags(document, { force: true });
}
themeBtn.addEventListener("click", () => applyTheme(MODES[(MODES.indexOf(currentMode()) + 1) % MODES.length]));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (currentMode() === "auto") applyTheme("auto"); });
themeBtn.textContent = currentMode().toUpperCase();

// ?debug exposes internals for automated checks.
if (new URLSearchParams(location.search).has("debug")) {
  window.cpin = { countryAt, select, focusOn: (slug) => ({ ...focus(bySlug.get(slug).marker) }), state: () => ({ phi, theta, selected, size }) };
}

$("#sync").textContent = `CHECKED ${fmtDateTime(data.last_sync)}`;
try {                                    // highlights are saved in this browser by the reader
  const saved = JSON.parse(localStorage.getItem("cpin-highlights-v1") || "[]");
  if (saved.length) $("#savedCount").textContent = saved.length;
} catch {}
const initial = location.hash.slice(1);
if (bySlug.has(initial)) select(initial, { record: false });
else render();
