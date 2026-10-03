// CPIN Explorer dashboard: a COBE globe of the countries the Home Office publishes notes on,
// with each country's reports, GOV.UK's own change history and the site's one search: countries,
// report titles and the full text of the reports.
// Data: data.json, written by `./cpin export` from the scraper's store.
import { createGlobe, feature, geoBounds, geoContains } from "../vendor/globe-deps.js";
import { makeCountryLocator } from "../shared/country-locator.js";
import { hydrateFlags, sampleFlag } from "../shared/dot-flag.js";
import { fetchJson } from "../shared/fetch-json.js";
import { excerptHtml, loadIndex, readerHref, searchPassages } from "../shared/fulltext-search.js";
import { focus, project, shortestTurn, unproject } from "../shared/globe-math.js";
import { topicGroups, topicLabel } from "../shared/topic-groups.js";
import { ukDate, ukDateTime } from "../shared/uk-time.js";
import { createCountryGlow, createHoverIntent } from "./country-glow.js";
import { MOUSE, TOUCH, dotRadius, pickCountry } from "./pick.js";
import { checkSummary, compareWithGovuk, isFresh, syncStatus } from "./sync-status.js";
import { buildGroups, groupReports, matchCountries, matchReports, norm, parseQuery, rowNote } from "./search-query.js";

// The page places itself (globe at the top, or the chosen country's panel); the browser's own
// restore would land after that, part-way down the previous page.
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
// Up to 900px the page is one column and scrolls as a page; wider, it is an app shell: the page stays
// put and the panel is its own scrolling column (dashboard.css).
const narrow = matchMedia("(max-width: 900px)");
const smooth = () => (reduced.matches ? "auto" : "smooth");
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
// Dates are UK dates (../shared/uk-time.js), like the times beside them and like GOV.UK itself: an
// update published at 00:30 BST belongs to that day, not to the day before (which is what UTC would say).
const fmtDate = (iso) => (iso ? ukDate(iso) : "—");
const fmtMonth = (ym) => (ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : "");
const daysAgo = (iso) => (Date.now() - Date.parse(iso)) / 864e5;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "S"}`;
const num = (n) => Number(n || 0).toLocaleString("en-GB");
const count = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const split = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
const flagCanvas = (c, cols, cls = "", reveal = false, interactive = false) => (c?.iso_a2
  ? `<canvas class="dotflag ${cls}" data-flag="${c.iso_a2}" data-cols="${cols}"${reveal ? " data-reveal" : ""}${interactive ? " data-interactive" : ""} aria-hidden="true"></canvas>`
  : "");

const [data, topo] = await Promise.all([fetchJson("data.json"), fetchJson("../vendor/countries-gbr.json")]);
const countries = data.countries;
const bySlug = new Map(countries.map((c) => [c.slug, c]));
const liveNotes = (c) => c.notes.filter((n) => n.status === "live");
const isRecent = (c) => c.updated && daysAgo(c.updated) <= 30;
const ALL_KINDS = [...new Set(countries.flatMap((c) => (c.reports || []).map((r) => r.kind)))];
const parse = (text) => parseQuery(text, { countries, kinds: ALL_KINDS });
const GROUPS = buildGroups(countries, topicGroups);         // every subject, with all its reports (search list headings)

const countryAt = makeCountryLocator({ topo, data, feature, geoBounds, geoContains });

// --- Globe -----------------------------------------------------------------------------------
const canvas = $("#globe"), overlay = $("#globeGlow"), wrap = $("#globeWrap"), pinsEl = $("#pins"), panel = $("#panel");
let size = Math.round(wrap.getBoundingClientRect().width) || 600;
// Capped: Retina and 4K stay smooth (COBE fixes its pixel ratio when it is made, so a globe that
// starts large gets fewer pixels per point; the canvas stays under about 2200px either way).
const dpr = Math.max(1, Math.min(1.5, window.devicePixelRatio || 1, 2200 / size));
// The globe follows its box (the window resizing, the shell's columns): redrawn at the new size, so it stays crisp.
new ResizeObserver(() => { size = Math.round(wrap.getBoundingClientRect().width) || size; }).observe(wrap);

let { phi, theta } = focus([24, 38]);                       // start over Africa and the Middle East
let zoom = 1, zoomTarget = 1;
const MIN_ZOOM = 1, MAX_ZOOM = 3.2;
const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
let vPhi = 0, dragging = false, moved = 0, lastX = 0, lastY = 0, lastInteract = 0, flight = null;
let selected = null, hovered = null, filterKind = "all";
// Search: the header box's text, which view of it is open ("" = results as you type, "passages" =
// every passage, with filters), how many report results are listed, and the country view's own box.
let query = "", view = "", notesShown = 8, countryQuery = "";
const pass = { countries: new Set(), kinds: new Set() };     // filters of the passages view (country slugs, kind labels)

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
const markerSize = (c) => (c.slug === selected ? 0.07 : 0.03 + 0.0028 * Math.min(liveNotes(c).length, 12));
function markers() {
  const blue = palette().markerColor, slate = SLATE();
  return countries.map((c) => ({
    location: c.marker,
    size: markerSize(c),
    color: c.slug === selected || isRecent(c) ? blue : slate,
  }));
}

// COBE v2 draws one frame per update() and has no loop of its own, so we drive it, and skip
// drawing entirely while nothing moves (a selected country, reduced motion).
const globe = createGlobe(canvas, {
  devicePixelRatio: dpr, width: size, height: size, phi, theta,   // width/height in CSS pixels
  mapSamples: 16000, mapBaseBrightness: 0, markerElevation: 0.012, scale: zoom, offset: [0, 0],
  ...palette(), markers: markers(),
});

// The hovered (or selected) country lit up in its flag's colours, with its outline.
const isoToSlug = new Map(countries.map((c) => [c.iso_n3, c.slug]));
const shapes = new Map();
for (const f of feature(topo, topo.objects.countries).features) {
  const slug = data.feature_aliases?.[f.properties.name]?.slug ?? isoToSlug.get(f.id);
  if (slug) { if (!shapes.has(slug)) shapes.set(slug, []); shapes.get(slug).push(f); }
}
const glow = createCountryGlow({ canvas: overlay, shapes, codeOf: (slug) => bySlug.get(slug)?.iso_a2,
  sampleFlag, geoBounds, isDark, reducedMotion: () => reduced.matches });

let drawn = { phi: NaN, theta: NaN, size, zoom: NaN };
// Changes for COBE wait for the next frame and go in one update(): each update() draws the globe, so a
// separate one (new markers on a click, say) would draw it twice in a frame.
let pinsDirty = true, markersDirty = false, paletteDirty = false;
function frame(now) {
  step(now);
  const viewChanged = phi !== drawn.phi || theta !== drawn.theta || size !== drawn.size || zoom !== drawn.zoom;
  if (viewChanged || markersDirty || paletteDirty) {
    const u = { phi, theta, scale: zoom };
    if (size !== drawn.size) { u.width = size; u.height = size; }     // resizing reallocates: only when needed
    if (markersDirty || paletteDirty) u.markers = markers();
    if (paletteDirty) Object.assign(u, palette());
    markersDirty = paletteDirty = false;
    globe.update(u);
  }
  if (viewChanged || pinsDirty) { placePins(); pinsDirty = false; } // labels only move when the globe does
  glow.draw({ phi, theta, scale: zoom }, size, dpr, viewChanged);
  drawn = { phi, theta, size, zoom };
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
requestAnimationFrame(() => canvas.classList.add("ready"));

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
function step(now) {
  if (flight) {
    const t = Math.min(1, Math.max(0, (now - flight.t0) / flight.dur)), e = easeInOut(t);
    phi = flight.phi0 + flight.dPhi * e;
    theta = flight.theta0 + flight.dTheta * e;
    if (t >= 1) flight = null;
  } else if (!dragging) {
    if (Math.abs(vPhi) > 1e-4) { phi += vPhi; vPhi *= 0.93; }          // inertia after a drag
    else if (!reduced.matches && !selected && !hovered && now - lastInteract > 3500) phi += 0.0014 / zoom;
  }
  if (Math.abs(zoomTarget - zoom) > 0.0005) zoom += (zoomTarget - zoom) * (reduced.matches ? 1 : 0.16);
  else zoom = zoomTarget;
}
function flyTo(latLon) {
  const target = focus(latLon, { minTheta: -0.9, maxTheta: 1.0 });
  flight = { t0: performance.now(), dur: reduced.matches ? 1 : 1150, phi0: phi, dPhi: shortestTurn(phi, target.phi),
             theta0: theta, dTheta: target.theta - theta };
  vPhi = 0;
}

// Pins: a focusable button on every marker (for the keyboard and screen readers), carrying a label
// with a dotted flag. The pointer does not use them: hitAt() below picks the dot.
const pins = countries.map((c) => {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `pin${isRecent(c) ? " is-recent" : ""}`;
  el.dataset.slug = c.slug;
  el.dataset.place = "top";
  el.setAttribute("aria-label", `${c.name}: ${c.reports?.length ?? liveNotes(c).length} reports`);
  el.innerHTML = `<span class="tag pin-label">${flagCanvas(c, 8, "dotflag--tag")}<span>${esc(c.name)}</span><b>${c.reports?.filter((r) => r.status === "live").length ?? liveNotes(c).length}</b></span>`;
  pinsEl.append(el);
  return { c, slug: c.slug, el, label: el.firstElementChild, behind: null, visible: false, labelled: false, place: "top",
           count: liveNotes(c).length, recent: isRecent(c), x: 0, y: 0, r: 0, ring: 0, depth: 0, w: 0, h: 0 };
});
let labelOffset = 19;                     // px from a marker to its label's near edge (CSS: 1.2rem)
function measureLabels() {
  labelOffset = parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.2;
  for (const p of pins) { p.w = p.label.offsetWidth; p.h = p.label.offsetHeight; }
  pinsDirty = true;
}
document.fonts.ready.then(() => hydrateFlags(pinsEl)).then(measureLabels);
new ResizeObserver(measureLabels).observe(document.documentElement);

function placePins() {
  const view = { phi, theta, scale: zoom, elevation: 0.012 };
  for (const p of pins) {
    const r = project(p.c.marker, view);
    p.x = r.x * size; p.y = r.y * size; p.depth = r.depth;
    p.r = dotRadius(markerSize(p.c), size, zoom);                  // the dot as COBE draws it, in px
    const ring = Math.round(p.r + 3);                              // the hover ring hugs the dot
    if (ring !== p.ring) { p.ring = ring; p.el.style.setProperty("--ring", `${ring}px`); }
    const offCanvas = p.x < -20 || p.y < -20 || p.x > size + 20 || p.y > size + 20;   // zoomed past the edge
    p.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
    p.el.style.setProperty("--vis", offCanvas ? "0" : Math.max(0, Math.min(1, r.depth / 0.2)).toFixed(3));
    const behind = r.depth <= 0.03 || offCanvas;
    p.visible = !behind;
    if (behind !== p.behind) {
      p.behind = behind;
      p.el.classList.toggle("is-behind", behind);
      p.el.tabIndex = behind ? -1 : 0;
    }
  }
  layoutLabels();
}

// As many labels as fit (up to a cap that grows with zoom): highest priority first (selected,
// hovered, recently updated, most notes, nearest the viewer), each trying its current side first so
// labels don't flicker, then the others.
const SIDES = ["top", "right", "left", "bottom"];
function labelRect(p, side) {
  const o = Math.max(labelOffset, p.r + 8), { w, h } = p;
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
  const cap = Math.round(20 * zoom);
  const candidates = pins.filter((p) => p.w && !p.behind && (p.depth > 0.28 || p.c.slug === selected || p.c.slug === hovered))
    .sort((a, b) => rank(b) - rank(a));
  const placed = [], shown = new Set();
  for (const p of candidates) {
    if (shown.size >= cap && p.c.slug !== selected && p.c.slug !== hovered) break;
    for (const side of [p.place, ...SIDES.filter((s) => s !== p.place)]) {
      const rect = labelRect(p, side);
      if (rect[1] < -4 || rect[1] + rect[3] > size + 4 || rect[0] < -40 || rect[0] + rect[2] > size + 40) continue;
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

// Which country the pointer is on. The dots are the targets (pick.js): the whole dot plus a margin,
// the nearest one where several are close, in screen pixels so it holds at any zoom; a fingertip
// gets a larger margin. Only with no dot in reach does the border under the pointer decide.
function hitAt(e) {
  const box = canvas.getBoundingClientRect();
  const k = size / (box.width || size);                        // the canvas eases in slightly small: layout px
  const x = (e.clientX - box.left) * k, y = (e.clientY - box.top) * k;
  const reach = e.pointerType === "touch" || e.pointerType === "pen" ? TOUCH : MOUSE;
  return pickCountry(pins, x, y, reach, () => {
    const latLon = unproject(x / size, y / size, { phi, theta, scale: zoom });
    return latLon ? countryAt(latLon) : null;
  });
}
// Hover is calm: a country lights up once the pointer has rested on it, and one hands over to the
// next with a crossfade (country-glow.js). The cursor shows at once that there is something to click.
function setHover(slug) {
  if (slug === hovered) return;
  hovered = slug;
  for (const p of pins) p.el.classList.toggle("is-hover", p.c.slug === slug);
  glow.set(hovered || selected);
  pinsDirty = true;
}
const hover = createHoverIntent({ onChange: setHover, onCandidate: (slug) => glow.warm(slug) });
let pendingHover = null;
function queueHover(e) {
  if (!pendingHover) {
    requestAnimationFrame(() => {
      const ev = pendingHover;
      pendingHover = null;
      if (dragging || !ev) return;
      const slug = hitAt(ev);
      canvas.classList.toggle("over-country", !!slug);
      hover.point(slug, ev.clientX, ev.clientY);
    });
  }
  pendingHover = e;
}

// Pointer: drag to turn (with inertia), click to select, pinch to zoom; wheel and buttons zoom too.
const pointers = new Map();
let pinch = null, wasPinch = false;
canvas.addEventListener("pointerdown", (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zoomTarget };
    wasPinch = true; dragging = false;
    return;
  }
  wasPinch = false;
  dragging = true; moved = 0; vPhi = 0; flight = null;
  lastX = e.clientX; lastY = e.clientY; lastInteract = performance.now();
  canvas.classList.add("dragging");
});
canvas.addEventListener("pointermove", (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    zoomTarget = clampZoom((pinch.z * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d);
    return;
  }
  if (!dragging) return queueHover(e);
  const k = Math.PI / Math.max(size, 1) / zoom;          // a full drag across turns it half way round
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
  phi += dx * k;
  theta = Math.max(-1.2, Math.min(1.2, theta + dy * k));
  vPhi = dx * k;
  lastInteract = performance.now();
  if (moved >= 6) hover.now(null);                        // turning the globe: nothing is being pointed at
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!dragging) return;
  dragging = false;
  canvas.classList.remove("dragging");
  if (moved < 6 && !wasPinch && e.type === "pointerup") {   // a click or tap, not a drag
    vPhi = 0;
    const slug = hitAt(e);
    if (slug) {
      if (e.pointerType === "mouse") hover.now(slug);        // a click answers at once: no waiting for the pointer to rest
      openCountry(slug);                                     // leaves any search: the country is what was asked for
    }
  }
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", () => { if (!dragging) { hover.leave(); canvas.classList.remove("over-country"); } });
wrap.addEventListener("wheel", (e) => {
  e.preventDefault();
  zoomTarget = clampZoom(zoomTarget * Math.exp(-e.deltaY * 0.0016));
  lastInteract = performance.now();
}, { passive: false });
$("#zoomCtl")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-zoom]");
  if (!b) return;
  if (b.dataset.zoom === "in") zoomTarget = clampZoom(zoomTarget * 1.45);
  else if (b.dataset.zoom === "out") zoomTarget = clampZoom(zoomTarget / 1.45);
  else { zoomTarget = 1; if (selected) flyTo(bySlug.get(selected).marker); }
  lastInteract = performance.now();
});
// The pins themselves answer the keyboard (Enter or Space on a focused pin is a click).
pinsEl.addEventListener("click", (e) => { const pin = e.target.closest(".pin"); if (pin) openCountry(pin.dataset.slug); });
pinsEl.addEventListener("focusin", (e) => { const pin = e.target.closest(".pin"); if (pin?.matches(":focus-visible")) hover.now(pin.dataset.slug); });
pinsEl.addEventListener("focusout", (e) => { if (e.target.closest(".pin") && hovered === e.target.closest(".pin").dataset.slug) hover.now(null); });

// --- Selection and routing -------------------------------------------------------------------
// The address carries the place: #<country> for the country open, ?q= for a search, and for the
// passages view &view=passages with its filters (&country=<slug>,… &kind=<kind>,…), so Back and a
// shared link both work. Anything else in the query string (?debug) is left alone.
function urlState() {
  const p = new URLSearchParams(location.search), text = p.get("q") || "";
  return { q: text, view: text.trim() && p.get("view") === "passages" ? "passages" : "",
    countries: split(p.get("country")).filter((s) => bySlug.has(s)), kinds: split(p.get("kind")) };
}
function syncUrl({ push = false } = {}) {
  const p = new URLSearchParams(location.search);
  for (const key of ["q", "view", "country", "kind"]) p.delete(key);
  if (query.trim()) {
    p.set("q", query.trim());
    if (view === "passages") {
      p.set("view", "passages");
      if (pass.countries.size) p.set("country", [...pass.countries].join(","));
      if (pass.kinds.size) p.set("kind", [...pass.kinds].join(","));
    }
  }
  const qs = p.toString().replace(/%2C/g, ",").replace(/=(?=&|$)/g, "");
  const url = `${location.pathname}${qs ? `?${qs}` : ""}${selected ? `#${selected}` : ""}`;
  if (url === location.pathname + location.search + location.hash) return;
  // The passages view remembers that it was pushed (closePassages then goes Back rather than adding history).
  // The address is a convenience. A browser may refuse to update it (Safari allows 100 changes in 30
  // seconds, which fast typing can reach); that must never stop the search itself.
  try {
    if (push) history.pushState({ cpin: view || "search" }, "", url);
    else history.replaceState(view === "passages" ? history.state : null, "", url);
  } catch {}
}

// The panel is filled a moment after a click, not in it: the first frames of the flight go first.
let renderTicket = 0;
function renderSoon(then) {
  const ticket = ++renderTicket;
  requestAnimationFrame(() => setTimeout(() => {
    if (ticket !== renderTicket) return;                   // something else has drawn the panel since
    render();
    then?.();
  }));
}
/** The panel back at its top: in the shell the panel scrolls, on one column the page does. */
function scrollPanelTop() {
  if (!narrow.matches) panel.scrollTo({ top: 0, behavior: smooth() });
  else if (selected) panel.scrollIntoView({ behavior: smooth(), block: "start" });
  else window.scrollTo({ top: 0, behavior: smooth() });
}
/** Bring one report's card into view in the open country, and mark it for a moment. */
function showReport(key) {
  let card = panel.querySelector(`.note[data-card="${CSS.escape(key)}"]`);
  if (!card && filterKind !== "all") {                      // filtered out: show every kind again
    filterKind = "all";
    panel.querySelectorAll(".filter").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === "all")));
    const notes = $(".notes", panel);
    if (notes) notes.innerHTML = notesList(bySlug.get(selected));
    card = panel.querySelector(`.note[data-card="${CSS.escape(key)}"]`);
  }
  if (!card) return scrollPanelTop();
  card.closest("details")?.setAttribute("open", "");
  card.scrollIntoView({ behavior: smooth(), block: "center" });
  card.classList.remove("is-target");
  void card.offsetWidth;
  card.classList.add("is-target");
}

function select(slug, { fly = true, record = true, report = null } = {}) {
  if (slug && !bySlug.has(slug)) return;
  selected = slug;
  filterKind = "all";
  countryQuery = "";
  for (const p of pins) p.el.classList.toggle("is-selected", p.c.slug === slug);
  markersDirty = true;
  glow.set(hovered || slug);                               // lights at once (it fades in; no waiting)
  pinsDirty = true;
  try { slug ? localStorage.setItem("cpin-last-country", slug) : localStorage.removeItem("cpin-last-country"); } catch {}
  if (slug && fly) flyTo(bySlug.get(slug).marker);
  if (record) syncUrl();
  renderSoon(() => (report ? showReport(report) : scrollPanelTop()));
}
/** Back, Forward, or an edited address: take the search and the country from it. */
function applyUrl() {
  const s = urlState(), slug = bySlug.has(location.hash.slice(1)) ? location.hash.slice(1) : null;
  query = s.q; q.value = s.q; view = s.view; notesShown = 8;
  pass.countries = new Set(s.countries); pass.kinds = new Set(s.kinds);
  if (slug !== selected) select(slug, { record: false });
  else render();
}
addEventListener("popstate", applyUrl);

// --- Panel -----------------------------------------------------------------------------------
let lastView = "";
function render() {
  renderTicket++;
  const v = query.trim() ? (view === "passages" ? "passages" : "search") : selected ? `country:${selected}` : "overview";
  if (v === "passages" && lastView === "passages" && $("#pList", panel)) {   // typing in the passages view: keep the frame
    paintPassagesHead();
    runPassages();
    return;
  }
  // While typing, the text hits stay put (dimmed) until the new ones arrive, rather than blinking out.
  const keepText = v === "search" && lastView === "search" ? $("#textHits", panel) : null;
  panel.classList.toggle("no-anim", v === "search" && lastView === "search");
  lastView = v;
  panel.innerHTML = v === "search" ? searchView() : v === "passages" ? passagesView()
    : selected ? countryView(bySlug.get(selected)) : overview();
  if (keepText) $("#textHits", panel)?.replaceWith(keepText);
  [...panel.children].forEach((el, i) => el.style.setProperty("--i", i));
  panel.querySelectorAll(".odo").forEach(odometer);
  hydrateFlags(panel, { lazy: true });                     // drawn as they come into view, a few a frame
  if (v === "search") runTextSearch();
  if (v === "passages") { paintPassagesHead(); runPassages({ debounce: 0 }); }
  if (selected && v === `country:${selected}` && countryQuery.trim()) runCountrySearch();   // back in a country with its box filled
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
    <p class="meta-line"><span>COPY FETCHED ${ukDateTime(data.last_sync)}</span><a href="${esc(data.source)}" target="_blank" rel="noopener">SOURCE: GOV.UK ↗</a></p>
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

const TOPIC_FILLER = new Set(["a", "an", "and", "or", "the", "of", "in", "on", "for", "to", "with", "including", "issues", "provision", "treatment"]);
const topicWords = (key) => new Set(key.split(":").pop().split("-").filter((w) => w && !TOPIC_FILLER.has(w)));
/** The report a GOV.UK change note is about, if its words make that clear. */
function reportForNote(c, note) {
  const words = new Set(note.toLowerCase().match(/[a-z0-9]+/g) || []);
  let best = null, bestScore = 0;
  for (const r of c.reports || []) {
    const t = topicWords(r.key);
    if (!t.size) continue;
    const score = [...t].filter((w) => words.has(w)).length / t.size;
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return bestScore >= 0.6 ? best : null;
}

/** When a report's latest edition was published, and its version: "15 MAY 2026 · V6.0". */
function reportWhen(r) {
  const L = r.latest || {};
  const published = L.published ? (L.published_precision === "month" ? fmtMonth(L.published.slice(0, 7)) : fmtDate(L.published)) : "";
  return [published, L.version ? `V${esc(L.version)}` : ""].filter(Boolean).join(" · ");
}
function reportCard(r, i) {
  const gone = r.status !== "live";
  const L = r.latest || {};
  const status = r.status === "removed" ? `<span class="tag tag--muted">Removed from GOV.UK</span>`
    : r.status === "archived" ? `<span class="tag tag--muted">Archived copy only</span>` : "";
  const editions = r.editions > 1 ? `${r.editions} EDITIONS ON RECORD · SINCE ${fmtDate(r.earliest)}` : "1 EDITION ON RECORD";
  const change = r.latest_change ? `<p class="note-change"><span class="eyebrow">What changed${r.latest_change.version ? ` in v${esc(r.latest_change.version)}` : ""}</span> “${esc(r.latest_change.statement)}”${r.latest_change.has_table ? ' <span class="note-more">+ a table in the report</span>' : ""}</p>` : "";
  const primary = r.read_url
    ? `<a class="btn btn--primary" href="${esc(r.read_url)}">${gone ? "Read the last edition" : "Read the latest guidance"}</a>`
    : L.pdf_url ? `<a class="btn btn--primary" href="${esc(L.pdf_url)}" target="_blank" rel="noopener">Open the PDF ↗</a>` : "";
  return `<article class="note${gone ? " is-gone" : ""}" data-card="${esc(r.key)}" style="--i:${i}">
    <div class="note-top"><span class="tag ${gone ? "tag--muted" : "tag--outline"}">${esc(r.kind)}</span>
      <span class="note-when">${reportWhen(r)}</span>${r.pdf_only ? `<span class="tag tag--muted">PDF only</span>` : ""}${status}</div>
    <h3 class="note-title">${esc(r.topic)}</h3>
    ${change}
    <div class="note-meta">${editions}${r.history_count ? ` · ${plural(r.history_count, "GOV.UK UPDATE")}` : ""}</div>
    <div class="note-actions">
      ${primary}
      ${r.read_url ? `<a class="btn" href="${esc(r.read_url)}#history">History${r.editions > 1 ? " & changes" : ""}</a>` : ""}
      ${L.govuk_url && !r.pdf_only ? `<a class="btn" href="${esc(L.govuk_url)}" target="_blank" rel="noopener">GOV.UK ↗</a>` : ""}
      ${L.pdf_url && r.read_url ? `<a class="btn" href="${esc(L.pdf_url)}" target="_blank" rel="noopener">PDF ↗</a>` : ""}
      ${gone && L.archive_url ? `<a class="btn" href="${esc(L.archive_url)}" target="_blank" rel="noopener">Archived copy ↗</a>` : ""}
    </div></article>`;
}
function notesList(c) {
  const reports = (c.reports || []).filter((r) => filterKind === "all" || r.kind === filterKind);
  const live = reports.filter((r) => r.status === "live"), gone = reports.filter((r) => r.status !== "live");
  return (live.map(reportCard).join("") || `<p class="empty">No current reports of this kind.</p>`)
    + (gone.length ? `<details class="gone-reports"><summary class="eyebrow">No longer on GOV.UK · ${gone.length}</summary>
        <div class="notes">${gone.map((r, i) => reportCard(r, i)).join("")}</div></details>` : "");
}
function countryView(c) {
  const reports = c.reports || [];
  const live = reports.filter((r) => r.status === "live");
  const archived = c.notes.reduce((sum, n) => sum + n.archived_editions, 0);
  const kinds = [...new Set(reports.map((r) => r.kind))];
  const tally = (k) => (k === "all" ? reports.length : reports.filter((r) => r.kind === k).length);
  const filters = kinds.length > 1
    ? `<div class="filters" role="group" aria-label="Filter notes by kind">${["all", ...kinds].map((k) =>
        `<button class="filter" data-kind="${esc(k)}" aria-pressed="${filterKind === k}">${k === "all" ? "All" : esc(k)} ${tally(k)}</button>`).join("")}</div>`
    : `<div style="height:1.4rem"></div>`;
  return `
    <button class="btn back" data-action="back">← All countries</button>
    <div class="country-head">
      ${flagCanvas(c, 24, "dotflag--hero", true, true)}
      <div><p class="eyebrow">Country</p><h1 class="country-title">${esc(c.name)}</h1></div>
    </div>
    <p class="meta-line"><span>UPDATED ${fmtDate(c.updated)}</span><span>${plural(live.length, "REPORT")}</span>
      ${archived ? `<span>${plural(archived, "ARCHIVED EDITION")}</span>` : ""}
      <a href="${esc(c.govuk_url)}" target="_blank" rel="noopener">GOV.UK PAGE ↗</a></p>
    ${c.caveat ? `<p class="caveat">${esc(c.caveat)}</p>` : ""}
    ${countrySearchHtml(c)}
    ${filters}
    <div class="notes">${notesList(c)}</div>
    <section class="section" style="margin-top:2.6rem">
      <div class="section-head"><h2 class="eyebrow">Updates to ${esc(possessive(c.name))} page on GOV.UK</h2><span class="eyebrow">All reports · verbatim</span></div>
      <p class="source-note" style="margin-top:0">GOV.UK keeps one change log for the whole country page. Where an entry clearly concerns one report, it links to it.</p>
      <ol class="history">${c.history.map((h) => { const r = reportForNote(c, h.note); return `<li><time datetime="${esc(h.date)}">${fmtDate(h.date)}</time><p>${esc(h.note)}</p>${r?.read_url ? `<a class="history-link" href="${esc(r.read_url)}#history">${esc(r.topic)} →</a>` : ""}</li>`; }).join("")}</ol>
    </section>`;
}

/* --- Search ----------------------------------------------------------------------------------
   One box, three kinds of answer, in this order: countries, reports (by title; the same topic in
   many countries is one group) and passages from the full text of the reports (Pagefind, through
   ../shared/fulltext-search.js). The words are read forgivingly (search-query.js): "country report",
   "CPIN" and "notes" mean any report, a country's name picks the country, and when no title matches
   the passages are the answer, so a search never comes to a dead end. */
const possessive = (name) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);
const EXAMPLES = ["Iran", "internal relocation", "actors of protection", "fact-finding mission", "military service", "Kurdish"];
/** Mark the query's words in a title (whole words from their start, as the matching does). */
function highlight(text, parsed) {
  const words = [...parsed.terms, ...parsed.soft].flatMap((term) => term.alts.flatMap((alt) => alt.split(" ")))
    .flatMap((w) => [w, w.replace(/ies$/, "y"), w.length > 3 ? w.replace(/s$/, "") : w]).filter((w) => w.length > 1);   // the forms the matching accepts
  if (!words.length) return esc(text);
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${[...new Set(words)].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "giu");
  let out = "", last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index + m[1].length;
    out += `${esc(text.slice(last, at))}<mark>${esc(m[2])}</mark>`;
    last = at + m[2].length;
  }
  return out + esc(text.slice(last));
}
// A compact row has no room for "Country information and guidance (legacy)": a short word, the full kind in the tooltip.
const KIND_SHORT = [[/fact.finding/i, "FACT-FINDING"], [/bulletin/i, "BULLETIN"], [/information note/i, "INFO NOTE"], [/guidance/i, "LEGACY"]];
const kindShort = (kind) => (kind === "CPIN" ? "" : KIND_SHORT.find(([re]) => re.test(kind))?.[1] ?? kind.toUpperCase());
const goneTag = (r) => (r.status === "live" ? "" : r.status === "removed" ? "REMOVED" : "ARCHIVED");
/** One report as a result on its own: its title, then country, kind and date. */
const reportHit = ({ c, r }, parsed, { country = true } = {}) => `<button class="hit${r.status === "live" ? "" : " is-gone"}" ${country ? `data-slug="${c.slug}" ` : ""}data-report="${esc(r.key)}">
  <span class="hit-text">${highlight(r.topic, parsed)}</span>
  <small>${[country ? esc(c.name.toUpperCase()) : "", esc(r.kind.toUpperCase()), reportWhen(r), goneTag(r)].filter(Boolean).join(" · ")}</small></button>`;
/** A subject and its reports: the heading once (the same whatever was typed: its counts are the whole
    group's), then each matching report as a compact row, then one quiet control for the rest of the
    group. Which topics belong together is the reviewed table in ../shared/topic-groups.js. A row says
    quietly how its own title differs from the heading ("Somalia · Mogadishu") or, when it was the
    report's own wording that matched, that wording ("Russia · Critics and opponents of the government"). */
const WIDE_NOTE = 24;                     // a row note longer than this needs the full width of the list
const noteOf = ({ r, qualifier }, label, parsed) => (parsed ? rowNote(parsed, { label, qualifier, own: topicLabel(r.topic) }) : qualifier);
function groupRow(row, label, parsed, hidden = false) {
  const { c, r } = row, note = noteOf(row, label, parsed);
  const when = [esc(kindShort(r.kind)), r.status === "live" ? reportWhen(r) : reportWhen(r).split(" · ")[0], goneTag(r)].filter(Boolean).join(" · ");
  return `<button class="rhit${r.status === "live" ? "" : " is-gone"}" data-slug="${c.slug}" data-report="${esc(r.key)}"${hidden ? " hidden" : ""} title="${esc(`${c.name}: ${r.topic} (${r.kind}${r.status === "live" ? "" : `, ${goneTag(r).toLowerCase()}`})`)}">
    ${flagCanvas(c, 8, "dotflag--row")}<span class="rhit-name">${esc(c.name)}${note ? `<i class="rhit-q"> · ${parsed ? highlight(note, parsed) : esc(note)}</i>` : ""}</span>
    <span class="rhit-when">${when}</span></button>`;
}
function reportGroup(g, parsed) {
  // Two columns while every row is short ("Somalia · Mogadishu"); one report per line once any row has more to say.
  const wide = g.rows.some((row) => noteOf(row, g.label, parsed).length > WIDE_NOTE) || g.rest.some((row) => row.qualifier.length > WIDE_NOTE);
  return `<section class="rgroup">
  <h3 class="rgroup-head"><span class="rgroup-topic">${highlight(g.label, parsed)}</span><span class="rgroup-n">${count(g.countries, "country", "countries")}${g.reports !== g.countries ? ` · ${count(g.reports, "report")}` : ""}</span></h3>
  <div class="rgroup-list${wide ? " rgroup-list--wide" : ""}">${g.rows.map((row) => groupRow(row, g.label, parsed)).join("")}${g.rest.map((row) => groupRow(row, g.label, null, true)).join("")}</div>
  ${g.rest.length ? `<button class="rgroup-all" type="button" data-action="group-all">Show all ${num(g.reports)} in this group</button>` : ""}</section>`;
}

let titleMatches = 0;                    // countries + reports matched by the search view as last drawn
function searchView() {
  const text = query.trim(), parsed = parse(text);
  const cs = matchCountries(parsed, countries);
  let hits = matchReports(parsed, countries, { groupsOf: topicGroups }), elsewhere = false;
  if (!hits.length && parsed.countries.length) {             // not in that country: the same title anywhere
    hits = matchReports(parsed, countries, { anyCountry: true, groupsOf: topicGroups });
    elsewhere = hits.length > 0;
  }
  // Each report sits under its subject's heading; only a subject with one report in all the data stands alone.
  const entries = groupReports(hits, GROUPS, { groupsOf: topicGroups, parsed });
  titleMatches = cs.length + hits.length;
  const named = parsed.countries.map((slug) => bySlug.get(slug).name).join(" or ");
  const hint = parsed.generic && parsed.matchAll && !parsed.countries.length
    ? `<p class="search-hint">Every report here is a country report: a country policy and information note (CPIN) or one of its relatives. ${parsed.kinds ? "These are the ones of that kind" : `All ${num(hits.length)} are below, by topic`}; add a country or a topic to narrow them, such as “Iran” or “internal relocation”.</p>` : "";
  const countryGroup = cs.length ? `<div class="results-group"><div class="section-head"><h2 class="eyebrow">Countries</h2><span class="eyebrow">${cs.length}</span></div>
      ${cs.map((c) => `<button class="hit" data-slug="${c.slug}">${flagCanvas(c, 8, "dotflag--row")}<span>${highlight(c.name, parsed)}</span><small>${plural((c.reports || []).filter((r) => r.status === "live").length, "REPORT")} · UPDATED ${fmtDate(c.updated)}</small></button>`).join("")}</div>` : "";
  const more = entries.length > notesShown
    ? `<button class="more" type="button" data-action="more-notes">Show all ${num(hits.length)} reports</button>` : "";
  const reportsGroup = hits.length ? `<div class="results-group"><div class="section-head"><h2 class="eyebrow">Reports</h2><span class="eyebrow">${num(hits.length)}</span></div>
      ${elsewhere ? `<p class="empty">No report for ${esc(named)} has that title. The same topic in other countries:</p>` : ""}
      ${entries.slice(0, notesShown).map((e) => (e.rows ? reportGroup(e, parsed) : reportHit(e, parsed))).join("")}${more}</div>` : "";
  const none = !titleMatches ? `<p class="empty no-titles">No country or report title matches “${esc(text)}”. ${parsed.text ? "Looking inside the text of the reports instead." : ""}</p>` : "";
  return `
    <p class="eyebrow">Search</p>
    <h1 class="hero-title">“${esc(text)}”</h1>
    ${hint}${none}${countryGroup}${reportsGroup}
    <div class="results-group text-hits" id="textHits">${textGroupHtml()}</div>
    <p class="source-note">Countries and reports match names and titles. Passages come from every section of the live reports, word for word as stored.</p>`;
}

/* The passages: a Pagefind index of every section of the live notes, built by `npm run search-index`
   into ../search/pagefind/ and loaded the first time a search box is used. */
function textHitHtml(h, text, { country = true, i = 0 } = {}) {
  const m = h.meta, c = bySlug.get(m.slug) || { name: m.country, iso_a2: m.iso_a2 };
  return `<a class="thit" href="${esc(readerHref(m, text))}" data-hover="${esc(m.slug)}" style="--i:${i}">
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
  hydrateFlags(el, { lazy: true });
}
const noIndexHtml = `<p class="empty">The text of the reports can’t be searched right now: the index didn’t load. Check your connection and try again.</p>`;   // developers: `npm run search-index` in web/ builds it
const nothingHtml = (text) => `<div class="nomatch"><span class="tag">No matches</span>
  <h2>Nothing matches “${esc(text)}”.</h2>
  <p>Not a country, not a report title, and not in the text of any report. Check the spelling or try fewer words.</p>
  <div class="examples"><span class="eyebrow">Try</span>${EXAMPLES.map((x) => `<button type="button" class="tag tag--outline" data-example="${esc(x)}">${esc(x)}</button>`).join("")}</div>
  <button type="button" class="btn" data-action="clear-search">Browse all countries</button></div>`;

// What the header box asks of the text: the words that carry meaning, in the countries and kinds named.
const TEXT_LIMIT = 6;
let textRes = { key: "", text: "", status: "idle", hits: [], total: 0 };
function textQuery() {
  const p = parse(query);
  const names = p.countries.map((slug) => bySlug.get(slug).name), kinds = p.kinds ? [...p.kinds] : [];
  return { parsed: p, text: p.text, countries: names, kinds, key: `${p.text}|${names.join(",")}|${kinds.join(",")}` };
}
function textGroupHtml() {
  const t = textQuery(), fresh = textRes.key === t.key;
  const where = t.countries.length ? ` in ${t.countries.join(" and ")}` : "";
  const head = (n) => `<div class="section-head"><h2 class="eyebrow">Passages in the text</h2><span class="eyebrow">${n}</span></div>`;
  if (!t.text) {
    return titleMatches ? `${head("")}<p class="empty">Add a topic or a word to search inside the text of the reports.</p>`
      : `<p class="empty">Type a country, a topic or any words from the text of a report.</p>`;
  }
  if (t.text.length < 2) return `${head("")}<p class="empty">Type two or more letters to search inside the reports.</p>`;
  if (textRes.status === "missing" || textRes.status === "error") return head("") + noIndexHtml;
  if (!fresh) return `${head("…")}<p class="empty searching">Searching the text${esc(where)}…</p>`;
  if (!textRes.hits.length) {
    return titleMatches ? `${head(0)}<p class="empty">No passages${esc(where)} contain “${esc(t.text)}”.</p>` : nothingHtml(query.trim());
  }
  return `${head(num(textRes.total))}<div class="thits">${textRes.hits.map((h, i) => textHitHtml(h, textRes.text, { i })).join("")}</div>
    <button class="all-results" type="button" data-action="all-passages">All ${count(textRes.total, "passage")}${esc(where)} →</button>`;
}
async function runTextSearch() {
  const t = textQuery();
  const box = () => $("#textHits", panel);
  if (t.text.length < 2) { if (box()) { box().classList.remove("is-busy"); swapContent(box(), textGroupHtml()); } return; }
  if (textRes.key === t.key && textRes.status === "done") { if (box()) { box().classList.remove("is-busy"); swapContent(box(), textGroupHtml()); } return; }
  box()?.classList.add("is-busy");
  try {
    const res = await searchPassages(t.text, { countries: t.countries, kinds: t.kinds, debounce: 150 });
    if (!res || t.key !== textQuery().key) return;                     // superseded by a later keystroke
    const hits = await Promise.all(res.results.slice(0, TEXT_LIMIT).map((r) => r.data()));
    if (t.key !== textQuery().key) return;
    textRes = { key: t.key, text: t.text, status: "done", hits, total: res.total };
  } catch (error) {
    const missing = String(error?.message) === "no index";
    textRes = { key: t.key, text: t.text, status: missing ? "missing" : "error", hits: [], total: 0 };
    if (!missing) console.warn(error);
  }
  if (!box()) return;
  box().classList.remove("is-busy");
  box().classList.add("is-fresh");
  swapContent(box(), textGroupHtml());
}

/* The passages view ("All N passages"): every passage for the search, gathered by report, with Kind
   and Country filters as compact menus and more loaded as the panel scrolls. It lives in the panel
   (the address gains &view=passages and the filters), where the separate search page used to be. */
const PAGE = 20;                                  // passages whose text is fetched at a time
const PER_NOTE = 3;                               // passages shown per report before "more in this report"
let P = null, passRun = 0;
const passText = () => parse(query).text || norm(query);
const passNames = () => [...pass.countries].map((slug) => bySlug.get(slug).name);
const opt = (facet, value, name, extra = "") => `<li><label class="opt"><input type="checkbox" data-facet="${facet}" value="${esc(value)}">
  <span class="opt-box" aria-hidden="true"></span>${extra}<span class="opt-name" title="${esc(name)}">${esc(name)}</span><span class="opt-count numeral"></span></label></li>`;
function passagesView() {
  const kinds = [...new Set([...ALL_KINDS, ...pass.kinds])];
  const withText = countries.filter((c) => c.notes.some((n) => n.status === "live" && !n.pdf_only));
  return `
    <button class="btn back" data-action="back-passages">← Back</button>
    <p class="eyebrow">Passages in the text</p>
    <h1 class="hero-title" id="pTitle"></h1>
    <p class="psummary" id="pSummary"></p>
    <div class="pfilters" id="pFilters">
      <details class="pmenu" data-menu="kind"><summary class="btn pmenu-btn">Kind<span class="numeral pmenu-n"></span></summary>
        <div class="pmenu-pop"><ul class="pmenu-list">${kinds.map((k) => opt("kind", k, k)).join("")}</ul></div></details>
      <details class="pmenu" data-menu="country"><summary class="btn pmenu-btn">Country<span class="numeral pmenu-n"></span></summary>
        <div class="pmenu-pop"><label class="pmenu-find"><input type="search" id="pCountryFind" placeholder="Filter ${withText.length} countries" autocomplete="off" spellcheck="false" aria-label="Filter the list of countries"></label>
          <ul class="pmenu-list pmenu-countries">${withText.map((c) => opt("country", c.slug, c.name, flagCanvas(c, 8, "dotflag--row"))).join("")}</ul></div></details>
      <div class="pchips" id="pChips"></div>
    </div>
    <div class="presults" id="pResults"><div class="plist" id="pList"></div>
      <div class="pfoot" id="pMore" hidden><span class="pshowing" id="pShowing"></span><button type="button" class="btn" data-action="load-more" id="pLoadMore">Load more</button></div></div>`;
}
function paintPassagesHead() {
  const title = $("#pTitle", panel);
  if (title) title.textContent = `“${passText()}”`;
  paintFacets();
}
function paintFacets() {
  const counts = P?.counts || { country: {}, kind: {} };
  for (const input of panel.querySelectorAll("input[data-facet]")) {
    const isCountry = input.dataset.facet === "country";
    const set = isCountry ? pass.countries : pass.kinds;
    const n = (isCountry ? counts.country : counts.kind)[isCountry ? bySlug.get(input.value)?.name : input.value];
    input.checked = set.has(input.value);
    const label = input.closest(".opt");
    $(".opt-count", label).textContent = n == null ? "" : num(n);
    label.classList.toggle("is-zero", (n === 0 || (P && n == null)) && !input.checked);
  }
  for (const menu of panel.querySelectorAll(".pmenu")) {
    const n = (menu.dataset.menu === "country" ? pass.countries : pass.kinds).size;
    $(".pmenu-n", menu).textContent = n || "";
    menu.classList.toggle("is-on", n > 0);
  }
  const box = $("#pChips", panel);
  if (!box) return;
  const chips = [
    ...[...pass.countries].map((s) => { const c = bySlug.get(s); return `<button type="button" class="tag pchip" data-remove-country="${esc(s)}" aria-label="Remove filter: ${esc(c.name)}">${flagCanvas(c, 8, "dotflag--tag")}${esc(c.name)}<span aria-hidden="true">×</span></button>`; }),
    ...[...pass.kinds].map((k) => `<button type="button" class="tag pchip" data-remove-kind="${esc(k)}" aria-label="Remove filter: ${esc(k)}">${esc(k)}<span aria-hidden="true">×</span></button>`),
  ];
  const html = chips.length ? `${chips.join("")}<button type="button" class="pclear" data-clear="all">Clear filters</button>` : "";
  if (box.dataset.key !== html) { box.dataset.key = html; box.innerHTML = html; hydrateFlags(box); }
}
async function runPassages({ debounce = 150 } = {}) {
  const run = ++passRun, text = passText();
  const results = $("#pResults", panel);
  results?.classList.add("is-busy");
  let res;
  try {
    res = await searchPassages(text, { countries: passNames(), kinds: [...pass.kinds], debounce, facets: true });
  } catch (error) {
    if (run !== passRun || !$("#pList", panel)) return;
    if (String(error?.message) !== "no index") console.warn(error);
    P = null;
    results.classList.remove("is-busy");
    $("#pSummary", panel).textContent = "";
    $("#pList", panel).innerHTML = noIndexHtml;
    $("#pMore", panel).hidden = true;
    return;
  }
  if (!res || run !== passRun || !$("#pList", panel)) return;        // superseded, or the view has gone
  P = { text, results: res.results, total: res.total, counts: res.counts, loaded: 0, groups: new Map(), loading: false };
  const inCountries = pass.countries.size || Object.values(res.counts.country).filter((n) => n > 0).length;
  $("#pSummary", panel).innerHTML = res.total
    ? `<span><b class="numeral">${num(res.total)}</b> ${res.total === 1 ? "passage" : "passages"}</span><i aria-hidden="true">·</i><span><b class="numeral">${num(inCountries)}</b> ${inCountries === 1 ? "country" : "countries"}</span>`
    : "No passages";
  paintFacets();
  const list = $("#pList", panel);
  list.innerHTML = "";
  if (!res.total) {
    const filtered = pass.countries.size || pass.kinds.size;
    list.innerHTML = `<div class="nomatch"><span class="tag">No passages</span>
      <h2>Nothing in the text matches “${esc(text)}”${filtered ? " with these filters" : ""}.</h2>
      <p>${filtered ? `<button type="button" class="btn" data-clear="all">Search every country and kind</button> ` : ""}Try fewer or different words, or check the spelling. The text is matched on whole words and their endings (relocate, relocation); put a phrase in “quotes” to match it exactly.</p></div>`;
  }
  await loadMorePassages();
  if (run === passRun) results.classList.remove("is-busy");
}
function passageGroupEl(m, i) {
  const c = bySlug.get(m.slug) || { name: m.country, iso_a2: m.iso_a2 };
  const el = document.createElement("article");
  el.className = "pnote";
  el.style.setProperty("--i", String(i));
  const when = [fmtMonth(m.month), m.version ? `V${esc(m.version)}` : ""].filter(Boolean).join(" · ");
  el.innerHTML = `
    <div class="pnote-top"><span class="tag tag--outline">${flagCanvas(c, 8, "dotflag--tag")}${esc(c.name)}</span>
      <span class="pnote-kind">${esc(m.kind)}</span>${when ? `<span class="pnote-when">${when}</span>` : ""}</div>
    <h2 class="pnote-title"><a class="pnote-open" href="${esc(readerHref({ ...m, anchor: "" }, P.text))}" data-hover="${esc(m.slug)}">${esc(m.title)}</a></h2>
    <ol class="phits"></ol>
    <button class="pmore-in" type="button" data-action="more-in-note" hidden></button>`;
  return el;
}
async function loadMorePassages() {
  if (!P || P.loading || P.loaded >= P.results.length) return paintMore();
  P.loading = true;
  const p = P, slice = p.results.slice(p.loaded, p.loaded + PAGE);
  let items;
  try { items = await Promise.all(slice.map((x) => x.data())); }
  catch (error) {                                              // a dropped connection: say so; "Load more" tries again
    console.warn(error);
    if (P === p && $("#pMore", panel)) {
      paintMore();
      $("#pMore", panel).hidden = false;
      $("#pLoadMore", panel).hidden = false;
      $("#pShowing", panel).textContent = "Couldn’t load these passages. Check your connection and try again.";
    }
    return;
  }
  finally { p.loading = false; }
  const list = $("#pList", panel);
  if (P !== p || !list) return;
  p.loaded += slice.length;
  let fresh = 0;
  for (const d of items) {
    const m = d.meta, key = `${m.slug}/${m.note}`;
    let g = p.groups.get(key);
    if (!g) {
      g = { el: passageGroupEl(m, fresh++), hits: 0, expanded: false };
      p.groups.set(key, g);
      list.append(g.el);
    }
    const li = document.createElement("li");
    li.innerHTML = `<a class="phit" href="${esc(readerHref(m, p.text))}" data-hover="${esc(m.slug)}"><span class="phit-section">${esc(m.section || "Opening text")}</span><span class="phit-excerpt">${excerptHtml(d.excerpt)}</span></a>`;
    g.hits++;
    if (g.hits > PER_NOTE && !g.expanded) li.hidden = true;
    $(".phits", g.el).append(li);
    const extra = g.hits - PER_NOTE, btn = $(".pmore-in", g.el);
    if (extra > 0 && !g.expanded) { btn.hidden = false; btn.textContent = `${count(extra, "more passage")} in this report`; }
  }
  hydrateFlags(list, { lazy: true });
  paintMore();
  requestAnimationFrame(() => { if (P === p && moreIsNear()) loadMorePassages(); });   // a short list: keep filling
}
function paintMore() {
  const more = $("#pMore", panel);
  if (!P || !more) return;
  const done = P.loaded >= P.results.length;
  more.hidden = !P.total;
  $("#pShowing", panel).textContent = done
    ? `${count(P.groups.size, "report")} · all ${count(P.total, "passage")} shown`
    : `${count(P.groups.size, "report")} · ${num(P.loaded)} of ${count(P.total, "passage")}`;
  $("#pLoadMore", panel).hidden = done;
}
// More passages load as the end of the list nears: of the panel in the shell, of the page on one column.
function moreIsNear() {
  const more = $("#pMore", panel);
  if (!more || more.hidden) return false;
  const edge = narrow.matches ? innerHeight : panel.getBoundingClientRect().bottom;
  return more.getBoundingClientRect().top < edge + 700;
}
const onScroll = () => { if (view === "passages" && P && !P.loading && P.loaded < P.results.length && moreIsNear()) loadMorePassages(); };
panel.addEventListener("scroll", onScroll, { passive: true });
addEventListener("scroll", onScroll, { passive: true });
/** Show the rest of a report's passages, the list gliding open. */
function expandGroup(el, btn) {
  const g = P && [...P.groups.values()].find((x) => x.el === el);
  if (g) g.expanded = true;
  const list = $(".phits", el), from = list.offsetHeight;
  list.querySelectorAll("li[hidden]").forEach((li) => { li.hidden = false; li.classList.add("is-new"); });
  btn.hidden = true;
  const to = list.offsetHeight;
  if (!reduced.matches) list.animate([{ height: `${from}px`, overflow: "hidden" }, { height: `${to}px`, overflow: "hidden" }], { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)" });
  list.querySelector("li.is-new .phit")?.focus({ preventScroll: true });
}
function passFiltersChanged() {
  syncUrl();
  paintFacets();
  runPassages({ debounce: 0 });
}
/** Open the passages view for the search as it stands (pushed, so Back returns to where this was opened). */
function openPassages({ countries: slugs = [], kinds = [] } = {}) {
  view = "passages";
  pass.countries = new Set(slugs);
  pass.kinds = new Set(kinds);
  syncUrl({ push: true });
  render();
  scrollPanelTop();
}
function closePassages() {
  if (history.state?.cpin === "passages") return history.back();      // opened from here: Back undoes it
  view = "";
  pass.countries.clear(); pass.kinds.clear();
  syncUrl();
  render();
}
function closeMenus(except = null) {
  for (const menu of panel.querySelectorAll(".pmenu[open]")) if (menu !== except) menu.open = false;
}
panel.addEventListener("toggle", (e) => { if (e.target.matches?.(".pmenu") && e.target.open) closeMenus(e.target); }, true);
addEventListener("pointerdown", (e) => { if (!e.target.closest?.(".pmenu")) closeMenus(); });

// Country view: one box for that country's reports: their titles, and the text inside them.
let countryRes = { key: "", status: "idle", hits: [], total: 0 };
function countryTextQuery() {
  const p = parse(countryQuery), kinds = p.kinds ? [...p.kinds] : [];
  return { parsed: p, text: p.text, kinds, key: `${selected}|${p.text}|${kinds.join(",")}` };
}
function countrySearchHtml(c) {
  return `<div class="csearch">
    <label class="csearch-box"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.4 10.4 14 14" stroke="currentColor" stroke-width="1.4"/></svg>
      <input id="cq" type="search" value="${esc(countryQuery)}" placeholder="Search ${esc(possessive(c.name))} reports" aria-label="Search the titles and text of ${esc(possessive(c.name))} reports" autocomplete="off" spellcheck="false">
      <span class="csearch-count numeral" id="cqCount" aria-live="polite"></span></label>
    <div class="csearch-results" id="cqHits"></div></div>`;
}
function countryResultsHtml() {
  const c = bySlug.get(selected), raw = countryQuery.trim();
  if (!raw) return "";
  const t = countryTextQuery(), fresh = countryRes.key === t.key && countryRes.status !== "idle";
  const titles = matchReports(t.parsed, countries, { only: selected, groupsOf: topicGroups });
  const head = (label, n) => `<div class="section-head"><h2 class="eyebrow">${label}</h2><span class="eyebrow">${n}</span></div>`;
  const titlesHtml = titles.length ? `<div class="results-group">${head("Reports", titles.length)}${titles.map((x) => reportHit(x, t.parsed, { country: false })).join("")}</div>` : "";
  let textHtml = "";
  if (t.text.length >= 2) {
    if (fresh && countryRes.status !== "done") textHtml = noIndexHtml;
    else if (!fresh) textHtml = `${head("Passages in the text", "…")}<p class="empty searching">Searching ${esc(possessive(c.name))} reports…</p>`;
    else if (countryRes.hits.length) {
      textHtml = `${head("Passages in the text", num(countryRes.total))}<div class="thits">${countryRes.hits.map((h, i) => textHitHtml(h, t.text, { country: false, i })).join("")}</div>
        <button class="all-results" type="button" data-action="all-passages-country">All ${count(countryRes.total, "passage")} in ${esc(c.name)} →</button>`;
    } else if (titles.length) textHtml = `${head("Passages in the text", 0)}<p class="empty">No passages in ${esc(possessive(c.name))} reports contain “${esc(t.text)}”.</p>`;
  }
  const nothing = !titles.length && (t.text.length < 2 || (fresh && countryRes.status === "done" && !countryRes.hits.length));
  if (nothing) {
    return `<p class="empty">Nothing in ${esc(possessive(c.name))} reports matches “${esc(raw)}”.</p>
      <button class="all-results" type="button" data-action="search-everywhere">Search every country for “${esc(raw)}” →</button>`;
  }
  return titlesHtml + (textHtml ? `<div class="results-group">${textHtml}</div>` : "");
}
function paintCountrySearch() {
  const box = $("#cqHits", panel);
  if (!box) return;
  const t = countryTextQuery(), fresh = countryRes.key === t.key && countryRes.status === "done";
  const titles = countryQuery.trim() ? matchReports(t.parsed, countries, { only: selected, groupsOf: topicGroups }).length : 0;
  $("#cqCount", panel).textContent = countryQuery.trim() && (titles || fresh) ? num(titles + (fresh ? countryRes.total : 0)) : "";
  swapContent(box, countryResultsHtml());
}
async function runCountrySearch() {
  const c = bySlug.get(selected), t = countryTextQuery();
  const box = $("#cqHits", panel);
  if (!c || !box) return;
  if (t.text.length < 2) { countryRes = { key: t.key, status: "idle", hits: [], total: 0 }; box.classList.remove("is-busy"); return paintCountrySearch(); }
  paintCountrySearch();                                        // titles at once; the passages follow
  box.classList.add("is-busy");
  try {
    const res = await searchPassages(t.text, { countries: [c.name], kinds: t.kinds, debounce: 150 });
    if (!res || t.key !== countryTextQuery().key) return;
    const hits = await Promise.all(res.results.slice(0, 5).map((r) => r.data()));
    if (t.key !== countryTextQuery().key) return;
    countryRes = { key: t.key, status: "done", hits, total: res.total };
  } catch (error) {
    countryRes = { key: t.key, status: "error", hits: [], total: 0 };
  }
  box.classList.remove("is-busy");
  paintCountrySearch();
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

/** "Show all N in this group": the rest of a subject's reports glide open under the ones that matched. */
function expandReportGroup(group, btn) {
  const list = $(".rgroup-list", group), from = group.offsetHeight;
  list.querySelectorAll(".rhit[hidden]").forEach((row) => { row.hidden = false; row.classList.add("is-new"); });
  btn.hidden = true;
  const to = group.offsetHeight;
  if (!reduced.matches) group.animate([{ height: `${from}px`, overflow: "hidden" }, { height: `${to}px`, overflow: "hidden" }], { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)" });
  list.querySelector(".rhit.is-new")?.focus({ preventScroll: true });
}

/** Leave the search for a country (and, from a report result, for that report's card in it). */
function openCountry(slug, report = null) {
  if (query) { query = ""; view = ""; q.value = ""; }
  select(slug, { report });
}
function setQuery(text) {
  query = text; q.value = text; view = ""; notesShown = 8;
  syncUrl();
  render();
  scrollPanelTop();
}
panel.addEventListener("click", (e) => {
  const t = e.target.closest("[data-action],[data-kind],[data-slug],[data-report],[data-example],[data-clear],[data-remove-country],[data-remove-kind]");
  if (!t) return;
  const action = t.dataset.action;
  if (action === "back") return select(null);
  if (action === "more-notes") { notesShown = Infinity; render(); return; }
  if (action === "group-all") return expandReportGroup(t.closest(".rgroup"), t);
  if (action === "clear-search") return setQuery("");
  if (action === "all-passages") { const tq = textQuery(); return openPassages({ countries: tq.parsed.countries, kinds: tq.kinds }); }
  if (action === "all-passages-country") {
    const tq = countryTextQuery();
    query = countryQuery.trim(); q.value = query;
    return openPassages({ countries: [selected], kinds: tq.kinds });
  }
  if (action === "search-everywhere") return setQuery(countryQuery.trim());
  if (action === "back-passages") return closePassages();
  if (action === "load-more") return loadMorePassages();
  if (action === "more-in-note") return expandGroup(t.closest(".pnote"), t);
  if (t.dataset.example) return setQuery(t.dataset.example);
  if (t.dataset.removeCountry || t.dataset.removeKind || t.dataset.clear) {
    if (t.dataset.removeCountry) pass.countries.delete(t.dataset.removeCountry);
    if (t.dataset.removeKind) pass.kinds.delete(t.dataset.removeKind);
    if (t.dataset.clear) { pass.countries.clear(); pass.kinds.clear(); }
    return passFiltersChanged();
  }
  if (t.dataset.kind) {
    filterKind = t.dataset.kind;
    panel.querySelectorAll(".filter").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === filterKind)));
    $(".notes", panel).innerHTML = notesList(bySlug.get(selected));
    return;
  }
  if (t.dataset.slug) return openCountry(t.dataset.slug, t.dataset.report || null);
  if (t.dataset.report) showReport(t.dataset.report);          // a title result in the country's own box
});
panel.addEventListener("change", (e) => {
  const input = e.target.closest?.("input[data-facet]");
  if (!input) return;
  const set = input.dataset.facet === "country" ? pass.countries : pass.kinds;
  if (input.checked) set.add(input.value); else set.delete(input.value);
  passFiltersChanged();
});
// Pointing at a result in the panel lights its country on the globe, with the same calm as the globe itself.
panel.addEventListener("pointerover", (e) => { const t = e.target.closest("[data-slug],[data-hover]"); if (t) hover.point(t.dataset.slug || t.dataset.hover); });
panel.addEventListener("pointerout", (e) => { if (e.target.closest("[data-slug],[data-hover]")) hover.leave(); });
// The country view's search box, and the passages view's country filter.
panel.addEventListener("focusin", (e) => { if (e.target.id === "cq") loadIndex(); });
panel.addEventListener("input", (e) => {
  if (e.target.id === "cq") { countryQuery = e.target.value; runCountrySearch(); }
  if (e.target.id === "pCountryFind") {
    const needle = norm(e.target.value);
    for (const li of panel.querySelectorAll(".pmenu-countries li")) li.hidden = !!needle && !norm(li.textContent).includes(needle);
  }
});
const RESULT_ITEMS = ".hit, .rhit, .rgroup-all, .thit, .phit, .pnote-open, .more, .all-results, .pmore-in";
const focusItem = (el) => { el.focus({ preventScroll: true }); el.scrollIntoView({ block: "nearest", behavior: smooth() }); };
panel.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && e.target.closest(".pmenu[open]")) { const menu = e.target.closest(".pmenu"); menu.open = false; $("summary", menu).focus(); return; }
  if (e.target.id === "cq") {
    const first = $("#cqHits .hit, #cqHits .thit", panel);
    if (e.key === "Escape" && e.target.value) { e.preventDefault(); e.target.value = ""; countryQuery = ""; runCountrySearch(); }
    if (e.key === "Enter" && first) first.click();
    if (e.key === "ArrowDown" && first) { e.preventDefault(); focusItem(first); }
    return;
  }
  // Arrow keys move through results.
  const items = [...panel.querySelectorAll(RESULT_ITEMS)].filter((el) => el.offsetParent !== null);
  const i = items.indexOf(document.activeElement);
  if (i < 0 || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
  e.preventDefault();
  const next = items[i + (e.key === "ArrowDown" ? 1 : -1)];
  if (next) focusItem(next);
  else if (e.key === "ArrowUp") (document.activeElement.closest(".csearch") ? $("#cq", panel) : q).focus();
  if (e.key === "ArrowDown" && i >= items.length - 4) onScroll();
});

// --- Search box, theme, header ---------------------------------------------------------------
const q = $("#q");
q.addEventListener("focus", () => loadIndex(), { once: true });
q.addEventListener("input", () => {
  const starting = !query.trim() && q.value.trim();
  query = q.value; notesShown = 8;
  if (!query.trim()) view = "";
  syncUrl();
  render();
  // One column (a phone): the results are below the globe, so bring them up under the header as the search starts.
  if (starting && narrow.matches && panel.getBoundingClientRect().top > innerHeight * 0.45) panel.scrollIntoView({ behavior: smooth(), block: "start" });
});
q.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { setQuery(""); q.blur(); }
  if (e.key === "Enter") panel.querySelector(".hit, .rhit, .thit, .phit")?.click();
  if (e.key === "ArrowDown" && query.trim()) {
    const first = [...panel.querySelectorAll(RESULT_ITEMS)].find((el) => el.offsetParent !== null);
    if (first) { e.preventDefault(); focusItem(first); }
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
  // Switch instantly (no colour transitions on hundreds of elements), then redraw the dotted flags
  // a few at a time: what is on screen first, the globe's labels just after.
  const root = document.documentElement;
  root.classList.add("theme-switching");
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
  paletteDirty = true;
  glow.refresh();
  setTimeout(() => hydrateFlags(panel, { force: true, lazy: true }), 30);
  setTimeout(() => hydrateFlags(pinsEl, { force: true }), 260);
}
themeBtn.addEventListener("click", () => applyTheme(MODES[(MODES.indexOf(currentMode()) + 1) % MODES.length]));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (currentMode() === "auto") applyTheme("auto"); });
themeBtn.textContent = currentMode().toUpperCase();

// ?debug exposes internals for automated checks.
if (new URLSearchParams(location.search).has("debug")) {
  window.cpin = {
    countryAt, select, focusOn: (slug) => ({ ...focus(bySlug.get(slug).marker) }),
    state: () => ({ phi, theta, selected, hovered, size, zoom, query, view }),
    /** Turn the globe to face a country without selecting it. */
    face: (slug) => { const t = focus(bySlug.get(slug).marker, { minTheta: -0.9, maxTheta: 1.0 }); flight = null; vPhi = 0; phi = t.phi; theta = t.theta; lastInteract = performance.now(); },
    /** Each dot on the page: centre (client px), drawn radius, whether it faces the viewer. */
    dots: () => { const b = canvas.getBoundingClientRect(); return pins.map((p) => ({ slug: p.slug, x: b.left + p.x, y: b.top + p.y, r: p.r, visible: p.visible })); },
    pick: (clientX, clientY, pointerType = "mouse") => hitAt({ clientX, clientY, pointerType }),
    glow: () => glow.levels,
  };
}

// --- How current is this copy? -----------------------------------------------------------------
// The scraper fetches GOV.UK once a day. On each visit the page also asks GOV.UK directly (its content
// API lets any web page read it) whether any country page has been updated since: once, quietly, when
// the browser is idle, reusing an answer younger than half an hour. Nothing is changed here; the
// daily sync picks updates up. The header says which it is, in one clock (UK time): checked and
// nothing newer, GOV.UK has newer updates, or simply when our copy was fetched. sync-status.js has
// the words; the dot beside them is still.
const GOVUK_LIST = "https://www.gov.uk/api/content/government/collections/country-policy-and-information-notes";
const CHECK_KEY = "cpin-live-check";
const syncEl = $("#sync"), syncLine = $("#syncLine"), checkBtn = $("#checkBtn"), checkPop = $("#checkPop");
let liveCheck = null, checkFailed = false;
function paintSync() {
  const st = syncStatus({ fetchedAt: data.last_sync, check: liveCheck });
  for (const el of [syncEl, syncLine]) {
    if (!el) continue;
    el.title = st.title;
    el.dataset.state = st.state;
    const text = $(".sync-words", el);
    if (text.textContent === st.text) continue;
    if (reduced.matches || text.dataset.set !== "1") { text.textContent = st.text; text.dataset.set = "1"; continue; }
    text.classList.add("is-changing");                     // the words change in a short crossfade, in a reserved width
    setTimeout(() => { text.textContent = st.text; text.classList.remove("is-changing"); }, 180);
  }
}
function storedCheck() {
  try { const c = JSON.parse(sessionStorage.getItem(CHECK_KEY) || "null"); return isFresh(c, Date.now()) ? c : null; } catch { return null; }
}
/** Ask GOV.UK (or reuse a recent answer). Never throws and never shows an error by itself. */
async function runCheck({ fresh = false } = {}) {
  const stored = fresh ? null : storedCheck();
  if (stored) { liveCheck = stored; checkFailed = false; paintSync(); return; }
  try {
    const live = await fetchJson(GOVUK_LIST, { tries: fresh ? 2 : 1 });   // one polite request; no hammering
    const docs = live?.links?.documents;
    if (!Array.isArray(docs) || !docs.length) throw new Error("GOV.UK listed no country pages");   // not an answer: never "accurate"
    liveCheck = compareWithGovuk(countries, docs, Date.now());
    checkFailed = false;
    try { sessionStorage.setItem(CHECK_KEY, JSON.stringify(liveCheck)); } catch {}
  } catch {
    checkFailed = true;                                    // the header goes on saying when the copy was fetched
    if (liveCheck && !isFresh(liveCheck, Date.now())) liveCheck = null;
  }
  paintSync();
}
function showCheck() {
  const check = checkFailed ? null : liveCheck;
  const words = checkSummary({ fetchedAt: data.last_sync, check });
  const list = check?.newer.length ? `<ul>${check.newer.map((d) => `<li>${d.slug ? `<button class="country-link linkish" data-slug="${d.slug}">${esc(d.name)}</button>` : esc(d.title)}
      <span>${d.gone ? "no longer listed on GOV.UK" : `updated ${fmtDate(d.updated)}`}</span> <a href="https://www.gov.uk${esc(d.base_path)}" target="_blank" rel="noopener">GOV.UK ↗</a></li>`).join("")}</ul>` : "";
  checkPop.innerHTML = `<p class="eyebrow">${esc(words.heading)}</p><p>${esc(words.body)}</p>${list}${words.foot ? `<p class="source-note">${esc(words.foot)}</p>` : ""}`;
  checkPop.hidden = false;
}
checkBtn?.addEventListener("click", async () => {            // the button always asks afresh
  checkBtn.disabled = true;
  checkBtn.textContent = "CHECKING…";
  await runCheck({ fresh: true });
  showCheck();
  checkBtn.disabled = false;
  checkBtn.textContent = "CHECK FOR CHANGES";
});
// The status itself opens the same pop-up (with the list of newer updates, if any), asking first if nothing is known yet.
for (const el of [syncEl, syncLine]) {
  el?.addEventListener("click", async () => {
    if (!checkPop.hidden) { checkPop.hidden = true; return; }
    if (!liveCheck) await runCheck({ fresh: true });
    showCheck();
  });
}
checkPop?.addEventListener("click", (e) => {
  const t = e.target.closest("[data-slug]");
  if (t) { checkPop.hidden = true; openCountry(t.dataset.slug); }
});
addEventListener("pointerdown", (e) => {
  if (checkPop && !checkPop.hidden && !e.target.closest("#checkPop, #checkBtn, #sync, #syncLine")) checkPop.hidden = true;
});
addEventListener("keydown", (e) => { if (e.key === "Escape" && checkPop && !checkPop.hidden) checkPop.hidden = true; });
paintSync();
(window.requestIdleCallback || ((fn) => setTimeout(fn, 1200)))(() => runCheck(), { timeout: 4000 });
try {                                    // highlights are saved in this browser by the reader
  const saved = JSON.parse(localStorage.getItem("cpin-highlights-v1") || "[]");
  if (saved.length) $("#savedCount").textContent = saved.length;
} catch {}

// Opening: a search carried in the address (?q=, and links to the old search page land here), else
// keep your place: reopen the country you were last looking at (the logo and back links come here).
{
  const s = urlState();
  query = s.q; q.value = s.q; view = s.view;
  pass.countries = new Set(s.countries); pass.kinds = new Set(s.kinds);
  if (s.q) loadIndex();
  let initial = location.hash.slice(1);
  if (!bySlug.has(initial) && !s.q) { try { initial = localStorage.getItem("cpin-last-country") || ""; } catch { initial = ""; } }
  if (bySlug.has(initial)) select(initial, { record: !location.hash });
  else render();
  // On a phone the results sit below the globe: a link that carries a search lands on them, as typing
  // does. They load a moment later and make the page taller, so hold the place until they have, or
  // until the reader touches the page.
  if (s.q && narrow.matches) {
    const land = () => panel.scrollIntoView({ block: "start" });
    const watch = new ResizeObserver(land);
    const inputs = ["touchstart", "wheel", "pointerdown", "keydown"];
    const stop = () => { watch.disconnect(); inputs.forEach((ev) => removeEventListener(ev, stop)); };
    land();
    watch.observe(panel);
    inputs.forEach((ev) => addEventListener(ev, stop, { passive: true }));
    setTimeout(stop, 5000);
  }
}
