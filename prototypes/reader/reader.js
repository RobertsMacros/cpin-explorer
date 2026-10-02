// CPIN Extractor reader: the latest edition of one note, verbatim from GOV.UK, with saved highlights
// that carry a citation (OSCOLA or tribunal short form), the paragraph number and the sources cited.
//
//   index.html?country=<slug>&note=<note id>[#h=<highlight id> | #<heading id>]
//
// The body is the stored GOV.UK HTML. Rendering only changes presentation: mirrored image sources,
// external links in a new tab, paragraph numbers hung in the margin, tables in a scroller, chunks for
// content-visibility and <mark> elements for saved highlights. The words are never altered.
import { hydrateFlags } from "../shared/dot-flag.js";
import { fetchJson } from "../shared/fetch-json.js";
import {
  capFirst, cleanQuote, escHtml as esc, formatCitation, formatPinpoint, monthLabel, parseNoteTitle, quoteWithCitation,
  STYLE_NAMES,
} from "../shared/citation.js";
import * as H from "../shared/highlights.js";
import {
  analyseBody, describePassage, editionSource, fetchText, latestCapture, parseBody, paths, pickEdition,
} from "../shared/note-source.js";

const $ = (sel, root = document) => root.querySelector(sel);
const params = new URLSearchParams(location.search);
const COUNTRY = params.get("country") || "";
const NOTE = params.get("note") || "";
const TEST = params.has("test");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const coarse = matchMedia("(pointer: coarse)");
const narrow = matchMedia("(max-width: 1199px)");
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const fmtDate = (iso) => { if (!iso) return ""; const d = new Date(iso); return `${String(d.getUTCDate()).padStart(2, "0")} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const fmtDateTime = (iso) => (iso ? `${fmtDate(iso)} · ${new Date(iso).toISOString().slice(11, 16)} UTC` : "");
const ICON = {
  save: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h8v11l-4-3-4 3z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  copy: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.5 10.5h-1v-8h8v1" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  quote: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 9.5c0-3 1.4-4.6 3.4-5M3 9.5h3v3.5H3zM9 9.5c0-3 1.4-4.6 3.4-5M9 9.5h3v3.5H9z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`,
};

/* ================================================================== preferences */

const STYLE_KEY = "cpin-cite-style";
let citeStyle = (() => { try { return localStorage.getItem(STYLE_KEY) === "tribunal" ? "tribunal" : "oscola"; } catch { return "oscola"; } })();
const segHtml = () => `<div class="seg" role="radiogroup" aria-label="Citation style" data-value="${citeStyle}"><span class="seg-thumb" aria-hidden="true"></span>${
  ["oscola", "tribunal"].map((s) => `<button type="button" role="radio" data-style="${s}" aria-checked="${citeStyle === s}">${STYLE_NAMES[s]}</button>`).join("")}</div>`;
function setStyle(style, { persist = true } = {}) {
  if (style !== "oscola" && style !== "tribunal") return;
  citeStyle = style;
  if (persist) { try { localStorage.setItem(STYLE_KEY, style); } catch {} }
  document.querySelectorAll(".seg").forEach((seg) => {
    seg.dataset.value = style;
    seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.style === style)));
  });
  if (popState?.kind === "hl") renderPopCitation();
}
document.addEventListener("click", (e) => { const b = e.target.closest(".seg button[data-style]"); if (b) setStyle(b.dataset.style); });
addEventListener("storage", (e) => { if (e.key === STYLE_KEY && e.newValue) setStyle(e.newValue, { persist: false }); });

/* ================================================================== state */

const S = {
  data: null, country: null, note: null, index: null, edition: null, src: null, month: null,
  root: null, ix: null, text: "", normalized: null,
  anchors: [], sections: [], refs: [], fns: new Map(), headings: [],
  marks: new Map(), checks: new Map(), pending: null, lastCopy: null, ready: false,
};
let readyResolve;
const ready = new Promise((r) => { readyResolve = r; });

/* ================================================================== text index */

// Offsets into the article's textContent, so a highlight can be stored as plain text positions and
// found again regardless of how the DOM is split up by marks.
class TextIndex {
  constructor(root) { this.root = root; this.dirty = true; this.text = root.textContent; }
  ensure() {
    if (!this.dirty) return this;
    const nodes = [], starts = [];
    let off = 0;
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push(n); starts.push(off); off += n.data.length; }
    this.nodes = nodes; this.starts = starts; this.length = off;
    this.pos = new Map(nodes.map((n, i) => [n, i]));
    this.dirty = false;
    return this;
  }
  offsetOf(container, offset) {
    this.ensure();
    if (container.nodeType === Node.TEXT_NODE) {
      const i = this.pos.get(container);
      if (i != null) return this.starts[i] + offset;
    }
    // An element boundary: the start of the first text node at or after it (no long string building).
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT);
    const ref = container.childNodes[offset] || null;
    let t = null;
    if (ref) {
      walker.currentNode = ref;
      t = ref.nodeType === Node.TEXT_NODE ? ref : walker.nextNode();
    } else {
      walker.currentNode = container;
      do { t = walker.nextNode(); } while (t && container.contains(t));
    }
    const i = t ? this.pos.get(t) : null;
    return i == null ? this.length : this.starts[i];
  }
  nodeIndexAt(off) {                       // last node starting at or before off
    let lo = 0, hi = this.starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.starts[mid] <= off) lo = mid; else hi = mid - 1; }
    return lo;
  }
  point(off, isStart) {
    this.ensure();
    let i = this.nodeIndexAt(off);
    // A start exactly at the end of a node belongs to the next one.
    while (isStart && i < this.nodes.length - 1 && off >= this.starts[i] + this.nodes[i].data.length) i++;
    return [this.nodes[i], Math.min(this.nodes[i].data.length, Math.max(0, off - this.starts[i]))];
  }
  range(start, end) {
    const r = document.createRange();
    const [a, ao] = this.point(start, true), [b, bo] = this.point(end, false);
    r.setStart(a, ao); r.setEnd(b, bo);
    return r;
  }
  firstTextAt(el) {
    this.ensure();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.data.trim()) continue;
      return this.starts[this.pos.get(t)] + (t.data.length - t.data.trimStart().length);
    }
    return null;
  }
}
const normalized = () => (S.normalized ??= H.normalizeWithMap(S.text));

/* ================================================================== boot */

boot().catch((error) => { console.error(error); fail("Something went wrong while opening this note.", String(error?.message || error)); });

async function boot() {
  wireChrome();
  if (!/^[a-z0-9-]+$/.test(COUNTRY) || !/^[\w.()-]+$/.test(NOTE)) {
    return fail("That address does not name a note.", "Open a note from the dashboard, or use reader/index.html?country=<country>&note=<note>.");
  }
  const dataP = fetchJson(paths.data);
  const indexP = fetchJson(paths.index(COUNTRY, NOTE));
  const manifestP = fetchJson(paths.manifest).catch(() => ({}));
  S.data = await dataP.catch(() => null);
  S.country = S.data?.countries.find((c) => c.slug === COUNTRY) || null;
  S.note = S.country?.notes.find((n) => n.id === NOTE) || null;
  try { S.index = await indexP; }
  catch {
    if (S.note?.pdf_url) return fail("This note is published as a PDF only.", "There is no HTML edition to read here.", S.note.pdf_url);
    return fail("This note could not be found.", `No note “${NOTE}” is held for ${S.country?.name || COUNTRY}.`);
  }
  S.edition = pickEdition(S.index);
  if (!S.edition) return fail("No editions are held for this note yet.", "");
  S.country ||= { slug: COUNTRY, name: capFirst(COUNTRY.replace(/-/g, " ")), iso_a2: null };
  S.note ||= synthesiseNote(S.index);
  S.src = editionSource(S.edition, { note: S.note, index: S.index });
  S.month = S.note.month || (S.edition.public_updated_at || "").slice(0, 7) || (latestCapture(S.edition)?.captured_at || "").slice(0, 7) || null;
  renderHead();
  const [html, manifest] = await Promise.all([fetchText(paths.body(COUNTRY, NOTE, S.edition.sha256)), manifestP]);
  renderBody(html, manifest || {});
  applyAllHighlights();
  renderToc();
  renderSaved();
  updateCounts();
  S.ready = true;
  document.body.classList.remove("is-loading");
  H.onHighlightsChange(sync);
  readyResolve();
  await document.fonts?.ready;
  if (!findFromQuery()) routeHash({ initial: true });
}

function synthesiseNote(index) {
  const title = index.title || NOTE;
  const kind = /^country bulletin/i.test(title) ? "Country bulletin" : /^country information note/i.test(title) ? "Country information note" : "CPIN";
  const p = parseNoteTitle({ title, kind, countryName: S.country?.name });
  return { id: NOTE, title, kind, topic: p.topic, month: null, status: index.status, version: S.edition?.version_banner,
    editions: index.versions?.length || 1, compare_url: null,
    govuk_url: index.status === "live" && index.base_path ? `https://www.gov.uk${index.base_path}` : null, pdf_url: null };
}

function fail(title, detail, pdf) {
  document.body.classList.remove("is-loading");
  const doc = $("#doc");
  doc.removeAttribute("aria-busy");
  doc.innerHTML = `<div class="load-error pop-in"><span class="tag">Reader</span><h2>${esc(title)}</h2>${detail ? `<p>${esc(detail)}</p>` : ""}
    <p><a class="btn" href="../dashboard/index.html${COUNTRY ? `#${esc(COUNTRY)}` : ""}">← Back to the dashboard</a>
    ${pdf ? ` <a class="btn btn--primary" href="${esc(pdf)}" target="_blank" rel="noopener">Open the PDF ↗</a>` : ""}</p></div>`;
  $("#toc").innerHTML = "";
  readyResolve?.();
}

/* ================================================================== head */

function renderHead() {
  const c = S.country, n = S.note, e = S.edition, idx = S.index;
  const gone = !idx.current_sha256 || idx.status === "archived" || idx.status === "removed";
  const parsed = parseNoteTitle({ title: e.title || idx.title, kind: n.kind, topic: n.topic, countryName: c.name });
  const topic = capFirst(n.topic || parsed.topic || idx.title);
  const title = e.title || idx.title || n.title;
  const version = e.version_banner || n.version;
  const month = monthLabel(parsed.month) || monthLabel(n.month);
  const published = e.public_updated_at ? `Published ${fmtDate(e.public_updated_at)}` : month ? `Published ${month.short}` : "";
  const cap = latestCapture(e);
  const successor = gone && n.series ? (c.notes || []).find((x) => x.series === n.series && x.status === "live" && x.id !== n.id) : null;
  document.title = `${topic} · ${c.name} · CPIN Extractor`;

  const meta = [
    version ? `<span>Version <b>${esc(version)}</b></span>` : "",
    published ? `<span>${esc(published)}</span>` : "",
    !gone && n.govuk_url ? `<a href="${esc(n.govuk_url)}" target="_blank" rel="noopener">GOV.UK ↗</a>` : "",
    gone && S.src.url ? `<a href="${esc(S.src.url)}" target="_blank" rel="noopener">Archived copy ↗</a>` : "",
    n.pdf_url ? `<a href="${esc(n.pdf_url)}" target="_blank" rel="noopener">PDF ↗</a>` : "",
  ].filter(Boolean).join("");
  const compare = n.editions > 1 && n.compare_url ? `<a class="btn btn--primary" href="${esc(n.compare_url)}">Compare ${n.editions} editions</a>` : "";
  const checked = e.last_seen || S.data?.last_sync;
  const notice = gone
    ? `<p class="notice notice--gone"><span class="tag">${idx.status === "removed" ? "Removed" : "Archived"}</span><span><strong>No longer on GOV.UK.</strong>
        This is the latest edition held${cap ? `: an <a href="${esc(cap.archive_url)}" target="_blank" rel="noopener">archived copy (Internet Archive, captured ${esc(fmtDate(cap.captured_at))}) ↗</a>` : ""}.
        The text is verbatim from that copy.${successor ? ` A newer edition is on GOV.UK: <a href="${esc(paths.reader(c.slug, successor.id))}">read ${esc(successor.month ? monthLabel(successor.month).long : "the current edition")}${successor.version ? ` (version ${esc(successor.version)})` : ""} →</a>` : ""}</span></p>`
    : `<p class="notice"><span class="tag tag--outline">Verbatim</span><span>Text is verbatim from GOV.UK as at the last check${checked ? ` (${esc(fmtDateTime(checked))})` : ""}.
        Select any passage to save it with a citation.</span></p>`;

  $("#head").innerHTML = `
    <a class="btn back" href="../dashboard/index.html#${esc(c.slug)}" style="--i:0">← ${esc(c.name)}</a>
    <div class="note-hero" style="--i:1">
      ${c.iso_a2 ? `<canvas class="dotflag dotflag--hero" data-flag="${esc(c.iso_a2)}" data-cols="24" data-reveal data-interactive aria-hidden="true"></canvas>` : ""}
      <div><p class="eyebrow">${esc(c.name)} · ${esc(n.kind)}</p>
        <h1 class="note-title">${esc(topic)}</h1>
        <p class="note-verbatim" title="Title as published on GOV.UK">${esc(title)}</p></div>
    </div>
    <div class="note-meta" style="--i:2"><p class="meta-line">${meta}</p>${compare}</div>
    <div style="--i:3">${notice}</div>`;
  // The flag is sampled from its SVG: do that once the note's text is up, not while it is loading.
  Promise.all([document.fonts?.ready, ready]).then(() => (window.requestIdleCallback || setTimeout)(() => hydrateFlags($("#head")), { timeout: 300 }));
}

/* ================================================================== body */

const BLOCKISH = new Set(["UL", "OL", "TABLE", "TBODY", "THEAD", "TFOOT", "TR", "DIV", "SECTION", "BLOCKQUOTE", "FIGURE"]);

function renderBody(html, manifest) {
  const { root } = parseBody(html);
  let gs = root;
  if (gs.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    const d = document.createElement("div");
    d.className = "govspeak";
    d.append(gs);
    gs = d;
  }
  const fnBox = gs.querySelector(".footnotes");     // anchors for the contents (ids only, no text)
  if (fnBox && !fnBox.id) fnBox.id = "footnotes";
  gs.querySelectorAll("h2, h3").forEach((h, i) => { if (!h.id) h.id = `section-${i + 1}`; });
  const A = analyseBody(gs);                     // offsets into the verbatim text, before any presentation
  presentation(gs, manifest, A);
  const doc = $("#doc");
  // Chunk and size the chunks while the body is still detached: if it went in unchunked (or with no
  // size estimates) the first layout would draw the whole note at once.
  const fs = parseFloat(getComputedStyle(doc).fontSize) || 17;
  const width = Math.max(280, doc.clientWidth - parseFloat(getComputedStyle(doc).paddingLeft || 0));
  chunk(gs, { fs, width });
  doc.replaceChildren(gs);
  doc.removeAttribute("aria-busy");
  S.root = gs;
  S.ix = new TextIndex(gs).ensure();
  S.text = S.ix.text;
  if (S.text !== A.text) console.warn("reader: text changed during presentation");
  S.A = A;
  S.anchors = A.anchors; S.sections = A.sections; S.refs = A.refs; S.fns = A.fns;
}

/** Presentation only: images from the mirror, links, paragraph numbers, table scrollers. */
function presentation(gs, manifest, A) {
  for (const img of gs.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    const hit = manifest[src] || manifest[src.replace(/^\/\//, "https://")];
    if (hit) { img.dataset.govuk = src; img.setAttribute("src", paths.image(hit)); }
    img.loading = "lazy";
    img.decoding = "async";
    const done = () => img.classList.add("loaded");
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
  }
  for (const a of gs.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (href.startsWith("#")) continue;
    a.target = "_blank";
    a.rel = "noopener";
    if (!a.closest("sup")) a.classList.add("ext");
  }
  for (const t of gs.querySelectorAll("table")) {
    const w = document.createElement("div");
    w.className = "tbl-scroll";
    t.before(w);
    w.append(t);
  }

  // Paragraph numbers: "3.4.1 Text" -> the number hangs in the margin (same text, one extra span).
  for (const { el: p, num } of A.paras) {
    p.dataset.para = num;
    p.classList.add("np");
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let t = walker.nextNode();
    while (t && !t.data.trim()) t = walker.nextNode();
    if (!t) continue;
    const at = t.data.indexOf(num);
    if (at < 0 || t.data.slice(0, at).trim()) continue;
    if (at > 0) t = t.splitText(at);
    t.splitText(num.length);
    const span = document.createElement("span");
    span.className = "pnum";
    t.replaceWith(span);
    span.append(t);
  }
}

/** Group top-level blocks into chunks (a new one at each h2/h3) for content-visibility:auto, each with
 *  an estimated height so the scrollbar is honest before the chunk is first drawn. */
function chunk(gs, { fs, width }) {
  const kids = [...gs.childNodes];
  let box = null, weight = 0;
  for (const node of kids) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : null;
    const breakHere = el && (/^H[23]$/.test(el.tagName) || el.classList.contains("footnotes") || weight > 2800);
    if (!box || (breakHere && box.childElementCount)) {
      box = document.createElement("div");
      box.className = "cv";
      gs.insertBefore(box, node);
      weight = 0;
    }
    box.append(node);
    if (el) weight += (el.textContent || "").length + el.querySelectorAll("tr, img, li").length * 40;
  }
  const perLine = Math.max(30, width / (fs * 0.5));
  const lineH = fs * 1.7;
  for (const box of gs.children) {
    let h = 0;
    for (const el of box.children) {
      if (/^H[2-6]$/.test(el.tagName)) h += lineH * 1.6 + fs * 2.4;
      else if (el.matches(".footnotes")) h += el.querySelectorAll("li").length * fs * 0.86 * 1.55 * 2.2 + 80;
      else if (el.matches(".tbl-scroll, table")) h += el.querySelectorAll("tr").length * fs * 2.3 + 40;
      else if (el.querySelector("img")) h += 420;
      else {
        const items = el.querySelectorAll("li").length;
        h += Math.ceil((el.textContent || "").trim().length / perLine + items * 0.4) * lineH + fs * 1.05;
      }
    }
    box.style.containIntrinsicSize = `auto ${Math.max(40, Math.round(h))}px`;
  }
}

/** Paragraph, section and footnote sources for a passage [s, e). */
const describe = (s, e) => describePassage(S.A, s, e);

/* ================================================================== contents + scrollspy */

let spy = null, activeSection = -1;
function tocHtml(counts) {
  if (!S.sections.length) return `<p class="eyebrow">On this page</p><p class="rail-empty">This note has no headings.</p>`;
  return `<p class="eyebrow">On this page</p><ol class="toc-list"><span class="toc-ind" aria-hidden="true"></span>${S.sections.map((s, i) =>
    `<li class="l${s.level}"><a href="#${esc(s.id)}" data-sec="${i}"${i === activeSection ? ' class="is-active" aria-current="true"' : ""}><span class="toc-label">${esc(s.title)}</span>${
      counts[i] ? `<span class="cnt" title="${counts[i]} saved">${counts[i]}</span>` : ""}</a></li>`).join("")}</ol>`;
}
function sectionCounts() {
  const counts = [];
  for (const [, chk] of S.checks) {
    if (!chk.match) continue;
    let k = -1;
    for (let i = 0; i < S.sections.length && S.sections[i].at <= chk.match.start; i++) k = i;
    if (k >= 0) counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}
function renderToc() {
  $("#toc").innerHTML = tocHtml(sectionCounts());
  if ($("#sheet").classList.contains("on") && sheetTab === "toc") renderSheet();
  moveIndicator();
  if (!spy) startSpy();
}
// Scrollspy: the section containing the text at the reading line (a quarter of the way down).
function startSpy() {
  spy = true;
  let queued = false;
  const update = () => {
    queued = false;
    const y = headOffset() + (innerHeight - headOffset()) * 0.22;
    const off = offsetAtY(y);
    if (off == null) { setActive(scrollY < 40 ? -1 : activeSection); return; }
    let k = -1;
    for (let i = 0; i < S.sections.length && S.sections[i].at <= off; i++) k = i;
    setActive(k);
  };
  addEventListener("scroll", () => { if (!queued) { queued = true; setTimeout(() => requestAnimationFrame(update), 60); } }, { passive: true });
  update();
}
function setActive(i) {
  if (i === activeSection || i == null) return;
  activeSection = i;
  for (const nav of [$("#toc"), $("#sheetBody")]) {
    nav?.querySelectorAll("a[data-sec]").forEach((a) => {
      const on = Number(a.dataset.sec) === i;
      a.classList.toggle("is-active", on);
      if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
  }
  moveIndicator();
}
function moveIndicator() {
  const toc = $("#toc"), ind = $(".toc-ind", toc), a = $("a.is-active", toc);
  if (!ind) return;
  if (!a) { ind.style.opacity = "0"; return; }
  ind.style.opacity = "1";
  ind.style.height = `${a.offsetHeight}px`;
  ind.style.transform = `translateY(${a.parentElement.offsetTop}px)`;
  // Keep the active entry in view inside the contents column, gliding.
  const top = a.parentElement.offsetTop, bottom = top + a.offsetHeight;
  if (top < toc.scrollTop + 40 || bottom > toc.scrollTop + toc.clientHeight - 40) {
    toc.scrollTo({ top: top - toc.clientHeight / 3, behavior: reduced.matches ? "auto" : "smooth" });
  }
}

/* ================================================================== gliding scroll */

let glide = null;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const headOffset = () => $(".top").getBoundingClientRect().bottom + 18;
const maxScroll = () => document.documentElement.scrollHeight - innerHeight;
const warmed = [];
function warm(node) {
  const box = node?.closest?.(".cv") || node?.parentElement?.closest(".cv");
  if (!box || box.classList.contains("warm")) return;
  box.classList.add("warm");
  warmed.push(box);
  while (warmed.length > 4) warmed.shift().classList.remove("warm");
}
/** Scroll smoothly to a target whose position may move while chunks render: the destination is
 *  re-measured every frame, then settled. Reduced motion: straight there. */
function glideTo(getRect, { block = "start" } = {}) {
  stopGlide();
  const want = () => {
    const r = getRect();
    if (!r) return scrollY;
    const head = headOffset();
    const y = block === "center" ? scrollY + r.top - head - Math.max(0, (innerHeight - head - r.height) / 2.4) : scrollY + r.top - head;
    return Math.max(0, Math.min(maxScroll(), y));
  };
  return new Promise((done) => {
    if (reduced.matches) {
      scrollTo(0, want());
      requestAnimationFrame(() => { scrollTo(0, want()); done(); });
      return;
    }
    const y0 = scrollY, t0 = performance.now();
    const dur = Math.min(950, 300 + Math.sqrt(Math.abs(want() - y0)) * 3);
    const g = { raf: 0, done };
    glide = g;
    const step = (now) => {
      if (glide !== g) return;
      const t = Math.min(1, (now - t0) / dur);
      scrollTo(0, y0 + (want() - y0) * easeInOut(t));
      if (t < 1) { g.raf = requestAnimationFrame(step); return; }
      let n = 0;
      const settle = () => {
        if (glide !== g) return;
        const target = want();
        if (Math.abs(target - scrollY) > 1 && n++ < 8) { scrollTo(0, target); g.raf = requestAnimationFrame(settle); }
        else { glide = null; done(); }
      };
      g.raf = requestAnimationFrame(settle);
    };
    g.raf = requestAnimationFrame(step);
  });
}
function stopGlide() {
  if (!glide) return;
  cancelAnimationFrame(glide.raf);
  const d = glide.done;
  glide = null;
  d();
}
addEventListener("wheel", stopGlide, { passive: true });
addEventListener("touchstart", stopGlide, { passive: true });

function goToElement(el, opts = {}) {
  if (!el) return Promise.resolve();
  warm(el);
  return glideTo(() => el.getBoundingClientRect(), opts);
}

/* ================================================================== highlights in the text */

function wrap(id, s, e, { fresh = false } = {}) {
  const ix = S.ix.ensure();
  const segs = [];
  for (let i = ix.nodeIndexAt(s); i < ix.nodes.length && ix.starts[i] < e; i++) {
    const node = ix.nodes[i], ns = ix.starts[i];
    const a = Math.max(0, s - ns), b = Math.min(node.data.length, e - ns);
    if (b <= a) continue;
    if (!node.data.slice(a, b).trim() && BLOCKISH.has(node.parentNode?.nodeName)) continue;
    segs.push([node, a, b]);
  }
  const marks = [];
  for (const [node, a, b] of segs) {
    let mid = node;
    if (b < mid.data.length) mid.splitText(b);
    if (a > 0) mid = mid.splitText(a);
    const m = document.createElement("mark");
    m.className = `hl${fresh ? " is-new" : ""}`;
    m.dataset.hid = id;
    mid.replaceWith(m);
    m.append(mid);
    marks.push(m);
  }
  if (marks[0]) {
    marks[0].tabIndex = 0;
    marks[0].setAttribute("role", "button");
    marks[0].setAttribute("aria-label", "Saved highlight: show citation");
  }
  S.marks.set(id, marks);
  ix.dirty = true;
  return marks;
}

function unwrap(id) {
  for (const m of S.marks.get(id) || []) {
    const parent = m.parentNode;
    if (!parent) continue;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    m.remove();
    parent.normalize();
  }
  S.marks.delete(id);
  S.ix.dirty = true;
}

/** Anchor a stored highlight in this edition, re-anchoring silently if the words moved. */
function place(rec, { fresh = false } = {}) {
  const res = H.checkHighlight(rec, { sha: S.edition.sha256, version: S.edition.version_banner, text: S.text, normalized: normalized() });
  S.checks.set(rec.id, res);
  if (res.match) wrap(rec.id, res.match.start, res.match.end, { fresh });
  let patch = null;
  if (res.status === "still") {
    const info = describe(res.match.start, res.match.end);
    const cur = { sha: S.edition.sha256, version: S.edition.version_banner || null, title: S.edition.title || S.index.title, month: S.month,
      para: info.para, section: info.section, url: S.src.url, archived: S.src.archived, capturedAt: S.src.capturedAt,
      pos: { start: res.match.start, end: res.match.end } };
    if (rec.check !== "still" || rec.current?.sha !== cur.sha || rec.current?.para !== cur.para) patch = { check: "still", current: cur };
  } else if (res.status === "changed") {
    const orig = S.index.versions.find((v) => v.sha256 === rec.editionSha);
    const cap = latestCapture(orig);
    if (rec.check !== "changed" || rec.current?.sha !== S.edition.sha256) {
      patch = { check: "changed", current: { sha: S.edition.sha256, version: S.edition.version_banner || null },
        archivedCopy: cap ? { url: cap.archive_url, capturedAt: cap.captured_at } : rec.archivedCopy || null };
    }
  } else if (res.status === "current" && rec.check && rec.check !== "current") patch = { check: "current", current: null };
  if (patch) { S.patching = true; H.updateHighlight(rec.id, patch); S.patching = false; }
}

function applyAllHighlights() {
  for (const rec of H.highlightsFor(COUNTRY, NOTE)) place(rec);
}

/** Bring the text in line with storage (another tab, undo, delete). */
function sync() {
  if (!S.ready || S.patching) return;
  const recs = H.highlightsFor(COUNTRY, NOTE);
  const ids = new Set(recs.map((r) => r.id));
  for (const id of [...S.checks.keys()]) {
    if (!ids.has(id)) { unwrap(id); S.checks.delete(id); if (popState?.id === id) closePop(); }
  }
  for (const rec of recs) if (!S.checks.has(rec.id)) place(rec, { fresh: true });
  renderSaved();
  renderToc();
  updateCounts();
  if (F.q) runFind(F.q, { jump: false });
}

const recById = (id) => H.loadHighlights().find((r) => r.id === id) || null;

/* ================================================================== selection -> toolbar */

const tool = $("#seltool");
let pointerIsDown = false, programmatic = false;

function selectionInfo() {
  if (!S.ready) return null;
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0), root = S.root;
  if (!r.intersectsNode(root)) return null;
  const ix = S.ix.ensure();
  let s = root.contains(r.startContainer) ? ix.offsetOf(r.startContainer, r.startOffset) : 0;
  let e = root.contains(r.endContainer) ? ix.offsetOf(r.endContainer, r.endOffset) : ix.length;
  [s, e] = H.snapToWords(S.text, s, e);
  if (e - s < 2 || !S.text.slice(s, e).trim()) return null;
  return { s, e, selector: H.makeSelector(S.text, s, e), ...describe(s, e), range: r };
}

/** The label on a saved passage: its paragraph(s), else its section, else just "Passage". */
const pinTag = (para, section) => (para ? formatPinpoint(para) : section ? truncate(section, 26) : "Passage");
const pinLabel = (info) => (info.para ? formatPinpoint(info.para) : info.section ? info.section : "No paragraph number");

function showTool(info) {
  S.pending = info;
  const touch = coarse.matches;
  tool.innerHTML = `<span class="st-pin" title="${esc(info.section || "")}">${esc(truncate(pinLabel(info), 30))}</span>
    <button type="button" data-act="save">${ICON.save}Save highlight</button>
    <button type="button" data-act="copy-both">${ICON.quote}Copy quote + citation</button>
    <button type="button" data-act="copy-cite">${ICON.copy}Copy citation</button>`;
  const wasHidden = tool.hidden;
  tool.hidden = false;
  tool.classList.toggle("is-touch", touch);
  $("#dock").classList.toggle("is-hidden", touch);
  if (!touch) {
    const rects = [...info.range.getClientRects()].filter((x) => x.width > 1 && x.height > 1);
    const first = rects[0] || info.range.getBoundingClientRect(), last = rects[rects.length - 1] || first;
    const w = tool.offsetWidth, h = tool.offsetHeight, gap = 12;
    const below = first.top - h - gap < headOffset();
    const anchor = below ? last : first;
    const cx = below ? anchor.left + Math.min(anchor.width, 260) / 2 : (first.left + Math.min(first.width, 260) / 2);
    const left = Math.max(10, Math.min(innerWidth - w - 10, cx - w / 2));
    const top = below ? anchor.bottom + gap : anchor.top - h - gap;
    tool.style.left = `${left + scrollX}px`;
    tool.style.top = `${top + scrollY}px`;
    tool.style.setProperty("--ox", `${Math.max(12, Math.min(w - 12, cx - left))}px`);
    tool.classList.toggle("is-below", below);
  } else {
    tool.style.left = tool.style.top = "";
  }
  if (wasHidden) { tool.classList.remove("is-in"); void tool.offsetWidth; tool.classList.add("is-in"); }
}
function hideTool() {
  if (tool.hidden) return;
  tool.hidden = true;
  S.pending = null;
  $("#dock").classList.remove("is-hidden");
}
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function checkSelection() {
  if (programmatic) return;
  const info = selectionInfo();
  if (info) showTool(info); else hideTool();
}
let selTimer = 0;
document.addEventListener("pointerdown", (e) => {
  if (tool.contains(e.target)) { e.preventDefault(); return; }   // keep the selection while clicking the toolbar
  pointerIsDown = true;
  hideTool();
  if (popState && !$("#pop").contains(e.target) && !e.target.closest("mark.hl, .saved-open, sup a")) closePop();
});
document.addEventListener("pointerup", () => { pointerIsDown = false; setTimeout(checkSelection, 0); });
document.addEventListener("keyup", (e) => { if (e.key === "Shift" || e.shiftKey || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a")) checkSelection(); });
document.addEventListener("selectionchange", () => {
  if (programmatic) return;
  clearTimeout(selTimer);
  if (coarse.matches) { selTimer = setTimeout(checkSelection, 280); return; }
  if (!pointerIsDown && !tool.hidden && getSelection().isCollapsed) hideTool();
});
tool.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b || !S.pending) return;
  const info = S.pending;
  if (b.dataset.act === "save") saveHighlight(info);
  else if (b.dataset.act === "copy-both") { copyRich(quoteWithCitation(ctxFromInfo(info), citeStyle, info.sources)).then((ok) => toast(ok ? "Copied quote and citation" : "Your browser blocked the clipboard")); }
  else if (b.dataset.act === "copy-cite") { copyRich(formatCitation(ctxFromInfo(info), citeStyle)).then((ok) => toast(ok ? `Copied ${STYLE_NAMES[citeStyle]} citation` : "Your browser blocked the clipboard")); }
});

function ctxFromInfo(info) {
  return {
    title: S.edition.title || S.index.title, kind: S.note.kind, topic: S.note.topic, countryName: S.country.name,
    version: S.edition.version_banner || null, month: S.month, para: info.para, section: info.section,
    url: S.src.url, archived: S.src.archived, capturedAt: S.src.capturedAt, quote: info.selector.quote, accessed: new Date(),
  };
}

function saveHighlight(info) {
  const sel = info.selector;
  const rec = H.addHighlight({
    country: COUNTRY, countryName: S.country.name, iso: S.country.iso_a2 || null, note: NOTE,
    title: S.edition.title || S.index.title, kind: S.note.kind, topic: S.note.topic,
    version: S.edition.version_banner || null, editionSha: S.edition.sha256, month: S.month,
    url: S.src.url, archived: S.src.archived, capturedAt: S.src.capturedAt,
    quote: sel.quote, prefix: sel.prefix, suffix: sel.suffix, pos: sel.pos,
    para: info.para, section: info.section, sources: info.sources, comment: "", check: "current",
  });
  // addHighlight's change event has already placed it (sync); make sure it shows as new.
  if (!S.marks.has(rec.id)) place(rec, { fresh: true });
  else S.marks.get(rec.id).forEach((m) => m.classList.add("is-new"));
  programmatic = true;
  getSelection().removeAllRanges();
  programmatic = false;
  hideTool();
  bump();
  toast("Highlight saved", { action: "Open", onAction: () => openHighlight(rec.id) });
  return rec;
}

/* ================================================================== clipboard */

async function copyRich({ text, html }) {
  S.lastCopy = { text, html };
  try {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([`<meta charset="utf-8">${html}`], { type: "text/html" }),
      })]);
      return true;
    }
  } catch { /* fall through */ }
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const onCopy = (e) => { e.clipboardData.setData("text/plain", text); e.clipboardData.setData("text/html", html); e.preventDefault(); };
  document.addEventListener("copy", onCopy);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  document.removeEventListener("copy", onCopy);
  return ok;
}

/* ================================================================== popover */

const pop = $("#pop");
let popState = null;      // { kind: "hl" | "fn", id | n, anchor }

function placePop(anchorRect, { scroll = false } = {}) {
  const sheet = innerWidth < 600 || coarse.matches;
  pop.classList.toggle("is-sheet", sheet);
  if (sheet) { pop.style.left = pop.style.top = ""; return; }
  const w = pop.offsetWidth, h = pop.offsetHeight, gap = 10, head = headOffset(), room = innerHeight - 64;
  const r = anchorRect;
  let left, top, glideBy = 0;
  if (r.left > innerWidth * 0.62 && r.left - w - gap > 12) {      // anchored in the right-hand column: open beside it
    left = r.left - w - gap - 4;
    top = Math.max(head, Math.min(r.top, room - h));
  } else {
    left = r.left - 18;
    if (r.bottom + gap + h <= room) top = r.bottom + gap;            // below the passage
    else if (r.top - gap - h >= head) top = r.top - gap - h;         // above it
    else {                                                           // neither: hang it below and glide up to it
      top = r.bottom + gap;
      glideBy = scroll ? Math.max(0, Math.min(top + h - room, r.top - head - 8)) : 0;
      if (!scroll) top = Math.max(head, Math.min(top, room - h));
    }
  }
  left = Math.max(12, Math.min(innerWidth - w - 12, left));
  pop.style.left = `${left + scrollX}px`;
  pop.style.top = `${top + scrollY}px`;
  if (glideBy > 0) {
    const target = scrollY + glideBy;
    glideTo(() => ({ top: target - scrollY + headOffset(), height: 0 }));
  }
}
function showPop(html, anchorRect, opts) {
  const wasHidden = pop.hidden;
  pop.innerHTML = html;
  pop.hidden = false;
  placePop(anchorRect, opts);
  if (wasHidden) { pop.classList.remove("is-in"); void pop.offsetWidth; pop.classList.add("is-in"); }
}
function closePop() {
  if (!popState) return;
  document.querySelectorAll("mark.hl.is-hot, .saved-item.is-hot").forEach((m) => m.classList.remove("is-hot"));
  popState = null;
  pop.hidden = true;
}

function statusHtml(rec) {
  const chk = S.checks.get(rec.id);
  if (chk?.status === "changed" || rec.check === "changed") {
    const to = rec.current?.version || S.edition.version_banner;
    return `<span class="badge badge--changed">Changed since you saved it (v${esc(rec.version || "?")} → v${esc(to || "?")})</span>${
      S.note.compare_url ? ` <a class="badge-link" href="${esc(S.note.compare_url)}">Compare editions →</a>` : ""}`;
  }
  if (chk?.status === "still" || rec.check === "still") return `<span class="badge">Still in v${esc(S.edition.version_banner || rec.current?.version || "")}</span>`;
  if (chk?.status === "unanchored") return `<span class="badge badge--changed">Could not be placed in the text</span>`;
  return "";
}

function citationFor(rec) { return formatCitation(H.citeContext(rec), citeStyle); }

function openHighlight(id, anchorEl, point) {
  const rec = recById(id);
  if (!rec) return;
  const marks = S.marks.get(id) || [];
  const anchor = anchorEl || marks[0] || document.querySelector(`.saved-item[data-hid="${CSS.escape(id)}"]`);
  document.querySelectorAll("mark.hl.is-hot, .saved-item.is-hot").forEach((m) => m.classList.remove("is-hot"));
  marks.forEach((m) => m.classList.add("is-hot"));
  document.querySelectorAll(`.saved-item[data-hid="${CSS.escape(id)}"]`).forEach((x) => x.classList.add("is-hot"));
  popState = { kind: "hl", id };
  const pinned = rec.check === "still" && rec.current ? rec.current.para : rec.para;
  const section = rec.check === "still" && rec.current ? rec.current.section : rec.section;
  const placed = marks.length > 0;
  const sources = rec.sources || [];
  showPop(`
    <div class="pop-head"><span class="tag">${esc(pinTag(pinned, null))}</span><span class="eyebrow" title="${esc(section || "")}">${esc(section || "")}</span>
      <button type="button" class="pop-x" data-act="close" aria-label="Close">×</button></div>
    <div class="pop-body">
      ${placed ? "" : `<p class="saved-quote">“${esc(cleanQuote(rec.quote))}”</p>`}
      ${statusHtml(rec) ? `<div class="pop-status">${statusHtml(rec)}</div>` : ""}
      <div class="rail-style"><span class="eyebrow">Citation</span>${segHtml()}</div>
      <div class="cite" id="popCite">${citationFor(rec).html}</div>
      ${sources.length ? `<details class="sources"${sources.length <= 3 ? " open" : ""}><summary>Sources cited in this passage · ${sources.length}</summary><ol>${sources.map((s) =>
        `<li><b>[${s.n}]</b><span>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.text)}</a>` : esc(s.text)}</span></li>`).join("")}</ol></details>` : ""}
      <div><label class="field-label" for="popComment"><span class="eyebrow">Private note</span><span class="saved-flag" id="popSaved">Saved</span></label>
        <textarea class="comment" id="popComment" placeholder="Only kept in this browser. Why it matters, which issue it goes to…">${esc(rec.comment || "")}</textarea></div>
      <div class="pop-actions">
        <button type="button" class="btn btn--primary" data-act="copy-both">${ICON.quote}Copy quote + citation</button>
        <button type="button" class="btn" data-act="copy-cite">${ICON.copy}Copy citation</button>
        <button type="button" class="btn btn-del" data-act="delete">Delete</button>
      </div>
    </div>`, anchorRect(id, anchor, point), { scroll: !!anchor?.matches?.("mark.hl") });
}
function renderPopCitation(animate = true) {
  if (popState?.kind !== "hl") return;
  const rec = recById(popState.id), box = $("#popCite");
  if (!rec || !box) return;
  box.innerHTML = citationFor(rec).html;
  if (animate) { box.classList.remove("swap"); void box.offsetWidth; box.classList.add("swap"); }
}
/** Where a highlight's popover hangs: under the whole passage when it fits on screen, so the quote
 *  stays readable; otherwise under the line that was clicked. */
function anchorRect(id, anchor, point) {
  const marks = S.marks.get(id) || [];
  if (!marks.length || !anchor?.matches?.("mark.hl")) return rectNear(anchor, point);
  const rects = marks.flatMap((m) => [...m.getClientRects()]).filter((r) => r.width && r.height);
  if (!rects.length) return rectNear(anchor, point);
  const top = Math.min(...rects.map((r) => r.top)), bottom = Math.max(...rects.map((r) => r.bottom));
  if (bottom - top > innerHeight * 0.45) return rectNear(anchor, point);
  const left = point ? Math.max(rects[0].left, point.x - 60) : rects[0].left;
  return new DOMRect(left, top, 1, bottom - top);
}
/** The line box of an anchor nearest a click point (multi-line marks), else its first rect. */
function rectNear(el, point) {
  const rects = el ? [...el.getClientRects()].filter((r) => r.width || r.height) : [];
  if (!rects.length) return new DOMRect(innerWidth / 2 - 180, innerHeight / 4, 360, 0);   // hidden anchor: mid-screen
  if (point && rects.length > 1) {
    return rects.reduce((best, r) => (Math.abs(r.top + r.height / 2 - point.y) < Math.abs(best.top + best.height / 2 - point.y) ? r : best));
  }
  return rects[0];
}

let commentTimer = 0;
pop.addEventListener("input", (e) => {
  if (e.target.id !== "popComment" || popState?.kind !== "hl") return;
  const id = popState.id, value = e.target.value;
  clearTimeout(commentTimer);
  commentTimer = setTimeout(() => {
    S.patching = true; H.updateHighlight(id, { comment: value }); S.patching = false;
    renderSaved();
    const f = $("#popSaved"); if (f) { f.classList.add("on"); setTimeout(() => f.classList.remove("on"), 1200); }
  }, 350);
});
pop.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const act = b.dataset.act;
  if (act === "close") return closePop();
  if (popState?.kind === "fn") {
    const n = popState.n;
    if (act === "goto-fn") { closePop(); return goToFootnote(n); }
    if (act === "copy-fn") { const f = S.fns.get(n); copyRich({ text: `[${n}] ${f.text}`, html: `[${n}] ${f.url ? `<a href="${esc(f.url)}">${esc(f.text)}</a>` : esc(f.text)}` }).then((ok) => toast(ok ? "Copied source" : "Your browser blocked the clipboard")); }
    return;
  }
  const rec = recById(popState?.id);
  if (!rec) return;
  if (act === "copy-both") copyRich(quoteWithCitation(H.citeContext(rec), citeStyle, rec.sources)).then((ok) => toast(ok ? "Copied quote and citation" : "Your browser blocked the clipboard"));
  if (act === "copy-cite") copyRich(citationFor(rec)).then((ok) => toast(ok ? `Copied ${STYLE_NAMES[citeStyle]} citation` : "Your browser blocked the clipboard"));
  if (act === "delete") deleteHighlight(rec.id);
});

function deleteHighlight(id) {
  closePop();
  const removed = H.removeHighlight(id);      // the change event unwraps it (sync)
  if (!removed) return;
  toast("Highlight deleted", { action: "Undo", onAction: () => H.restoreHighlight(removed) });
}

/* --- footnotes ----------------------------------------------------------------------------- */
function openFootnote(n, anchor) {
  const f = S.fns.get(n);
  if (!f) return goToFootnote(n);
  popState = { kind: "fn", n };
  showPop(`
    <div class="pop-head"><span class="tag tag--outline">Footnote ${n}</span><button type="button" class="pop-x" data-act="close" aria-label="Close">×</button></div>
    <div class="pop-body"><div class="pop-fn">${sanitizeFootnote(f.html)}</div>
      <div class="pop-actions"><button type="button" class="btn" data-act="goto-fn">Go to footnote ↓</button><button type="button" class="btn" data-act="copy-fn">${ICON.copy}Copy source</button></div></div>`,
  anchor.getBoundingClientRect());
}
function sanitizeFootnote(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  t.content.querySelectorAll("a[href]").forEach((a) => { if (!a.getAttribute("href").startsWith("#")) { a.target = "_blank"; a.rel = "noopener"; } });
  return t.innerHTML;
}
function goToFootnote(n) {
  const li = document.getElementById(`fn:${n}`);
  if (!li) return;
  goToElement(li, { block: "center" }).then(() => {
    li.classList.add("is-target");
    setTimeout(() => li.classList.remove("is-target"), 2200);
  });
}

/* --- clicks in the text -------------------------------------------------------------------- */
$("#doc").addEventListener("click", (e) => {
  const ref = e.target.closest('a[role="doc-noteref"], sup a.footnote');
  if (ref) {
    e.preventDefault();
    const n = Number((ref.getAttribute("href") || "").match(/(\d+)\s*$/)?.[1]);
    if (n) openFootnote(n, ref);
    return;
  }
  const back = e.target.closest('a[role="doc-backlink"], a.reversefootnote');
  if (back) {
    e.preventDefault();
    const target = document.getElementById(back.getAttribute("href").slice(1));
    if (target) goToElement(target, { block: "center" });
    return;
  }
  const internal = e.target.closest('a[href^="#"]');
  if (internal) {
    const target = document.getElementById(decodeURIComponent(internal.getAttribute("href").slice(1)));
    if (target) { e.preventDefault(); history.replaceState(null, "", `#${target.id}`); goToElement(target); }
    return;
  }
  const mark = e.target.closest("mark.hl");
  if (mark && getSelection().isCollapsed && !e.target.closest("a")) {
    const inner = e.target.closest("mark.hl");
    openHighlight(inner.dataset.hid, inner, { x: e.clientX, y: e.clientY });
  }
});
$("#doc").addEventListener("keydown", (e) => {
  const mark = e.target.closest?.("mark.hl");
  if (mark && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openHighlight(mark.dataset.hid, mark); }
});
// Hovering a saved passage lights up its card, and the other way round.
$("#doc").addEventListener("pointerover", (e) => {
  const m = e.target.closest("mark.hl");
  document.querySelectorAll(".saved-item.is-lit").forEach((x) => x.classList.remove("is-lit"));
  if (m) document.querySelectorAll(`.saved-item[data-hid="${CSS.escape(m.dataset.hid)}"]`).forEach((x) => x.classList.add("is-lit"));
});

/* ================================================================== saved list (rail + sheet) */

function orderedRecords() {
  const at = (r) => S.checks.get(r.id)?.match?.start ?? r.pos?.start ?? 0;
  return H.highlightsFor(COUNTRY, NOTE).sort((a, b) => at(a) - at(b));
}
function savedHtml() {
  const recs = orderedRecords();
  const items = recs.map((r, i) => {
    const pin = r.check === "still" && r.current ? r.current.para : r.para;
    const changed = r.check === "changed";
    return `<li class="saved-item${changed ? " is-changed" : ""}" data-hid="${esc(r.id)}" style="--i:${i}">
      <button type="button" class="saved-open" data-hid="${esc(r.id)}">
        <span class="saved-top"><span class="tag ${changed ? "tag--muted" : "tag--outline"}">${esc(pinTag(pin, r.check === "still" && r.current ? r.current.section : r.section))}</span></span>
        <span class="saved-quote">“${esc(cleanQuote(r.quote))}”</span>
        ${r.comment ? `<span class="saved-comment">${esc(r.comment)}</span>` : ""}
      </button>
      ${statusHtml(r) ? `<span class="saved-status">${statusHtml(r)}</span>` : ""}</li>`;
  }).join("");
  return `<div class="rail-head"><h2 class="eyebrow">Saved from this note</h2><span class="numeral">${recs.length}</span></div>
    <div class="rail-style"><span class="eyebrow">Citation style</span>${segHtml()}</div>
    ${recs.length ? `<ul class="saved-list">${items}</ul>` : `<p class="rail-empty"><b>Nothing saved yet.</b> Select any passage in the note, then choose <b>Save highlight</b>.
      Each saved passage keeps its paragraph number, the sources it cites and a citation ready to paste.</p>`}
    <p class="rail-foot"><a href="../saved/index.html">All saved highlights →</a></p>`;
}
function renderSaved() {
  $("#rail").innerHTML = savedHtml();
  if ($("#sheet").classList.contains("on") && sheetTab === "saved") renderSheet();
  if (popState?.kind === "hl") {
    document.querySelectorAll(`.saved-item[data-hid="${CSS.escape(popState.id)}"]`).forEach((x) => x.classList.add("is-hot"));
  }
}
document.addEventListener("click", (e) => {
  const open = e.target.closest(".saved-open");
  if (!open) return;
  const id = open.dataset.hid;
  if ($("#sheet").contains(open)) closeSheet();
  if (S.marks.get(id)?.length) goToHighlight(id, { open: true });
  else openHighlight(id, open.closest(".saved-item"));
});

async function goToHighlight(id, { open = false } = {}) {
  const marks = S.marks.get(id);
  if (!marks?.length) { if (open) openHighlight(id); return; }
  closePop();
  await goToElement(marks[0], { block: open ? "start" : "center" });   // room below for the popover
  marks.forEach((m) => { m.classList.remove("is-flash", "is-new"); void m.offsetWidth; m.classList.add("is-flash"); });
  if (open) openHighlight(id, marks[0]);
}

function updateCounts() {
  const all = H.loadHighlights().length, here = H.highlightsFor(COUNTRY, NOTE).length;
  $("#savedCount").textContent = all;
  $("#dockCount").textContent = here;
}
function bump() {
  updateCounts();
  const el = $("#savedCount");
  el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
}

/* ================================================================== find in note */

const F = { q: "", hits: [], ranges: [], cur: -1, folded: null };
const findInput = $("#find");
const hasHighlightApi = typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight === "function";
const fold = (s) => {
  const out = [];
  for (const ch of s) {
    for (const unit of ch.length === 1 ? [ch] : ch) {            // keep UTF-16 length identical
      const l = unit.toLowerCase();
      const c = l.length === 1 ? l : unit;
      out.push(c === "‘" || c === "’" || c === "′" ? "'" : c === "“" || c === "”" || c === "″" ? '"' : c);
    }
  }
  return out.join("");
};
function foldedText() {
  if (!F.folded) { const { norm, map } = normalized(); F.folded = { norm: fold(norm), map }; }
  return F.folded;
}
/** Text offset at a viewport y (caret hit-testing across the reading column), or null outside the note. */
function offsetAtY(y) {
  if (!S.root) return null;
  const doc = S.root.getBoundingClientRect();
  if (y < doc.top || y > doc.bottom) return null;
  for (const x of [doc.left + 24, doc.left + doc.width * 0.3, doc.left + doc.width * 0.6]) {
    let node = null, off = 0;
    if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); node = r?.startContainer; off = r?.startOffset || 0; }
    else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); node = p?.offsetNode; off = p?.offset || 0; }
    if (node && S.root.contains(node)) return S.ix.offsetOf(node, off);
  }
  return null;
}
const offsetAtViewportTop = () => offsetAtY(headOffset() + 4) ?? 0;
function runFind(q, { jump = true } = {}) {
  F.q = q;
  const nq = fold(H.normWs(q));
  clearFindMarks();
  if (!S.ready || nq.length < 2) { F.hits = []; F.ranges = []; F.cur = -1; updateFindUI(); return; }
  const { norm, map } = foldedText();
  const hits = [];
  for (let i = norm.indexOf(nq); i >= 0 && hits.length < 5000; i = norm.indexOf(nq, i + nq.length)) hits.push([map[i], map[i + nq.length - 1] + 1]);
  F.hits = hits;
  const ix = S.ix.ensure();
  F.ranges = hits.map(([a, b]) => ix.range(a, b));
  if (hasHighlightApi) CSS.highlights.set("cpin-find", new Highlight(...F.ranges));
  if (!hits.length) { F.cur = -1; updateFindUI(); return; }
  const top = offsetAtViewportTop();
  let k = hits.findIndex(([a]) => a >= top);
  if (k < 0) k = 0;
  goFind(k, { scroll: jump });
}
function clearFindMarks() {
  if (hasHighlightApi) { CSS.highlights.delete("cpin-find"); CSS.highlights.delete("cpin-find-current"); }
}
function goFind(k, { scroll = true } = {}) {
  if (!F.ranges.length) return;
  F.cur = (k + F.ranges.length) % F.ranges.length;
  const range = F.ranges[F.cur];
  if (hasHighlightApi) CSS.highlights.set("cpin-find-current", new Highlight(range));
  else { programmatic = true; const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); setTimeout(() => { programmatic = false; }, 0); }
  updateFindUI();
  if (!scroll) return;
  warm(range.startContainer.parentElement);
  const r = range.getBoundingClientRect();
  if (!r.height || r.top < headOffset() || r.bottom > innerHeight - 60) glideTo(() => range.getBoundingClientRect(), { block: "center" });
}
function stepFind(dir) {
  if (findInput.value !== F.q) return runFind(findInput.value);
  if (F.hits.length) goFind(F.cur + dir);
}
function updateFindUI() {
  const count = $("#findCount"), n = F.hits.length, on = H.normWs(F.q).length >= 2;
  count.classList.toggle("on", on);
  count.classList.toggle("none", on && !n);
  count.textContent = on ? (n ? `${F.cur + 1}/${n}${n >= 5000 ? "+" : ""}` : "0") : "";
  $("#findPrev").disabled = $("#findNext").disabled = !n;
}
let findTimer = 0;
findInput.addEventListener("input", () => { clearTimeout(findTimer); findTimer = setTimeout(() => runFind(findInput.value), 140); });
findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); clearTimeout(findTimer); stepFind(e.shiftKey ? -1 : 1); }
  if (e.key === "Escape") { findInput.value = ""; runFind(""); findInput.blur(); }
});
$("#findPrev").addEventListener("click", () => stepFind(-1));
$("#findNext").addEventListener("click", () => stepFind(1));

/* --- ?q=<query>: opened from a search result. Fill find-in-note with the query and glide to its first
   match at or after the section in the address (#heading-id). Search matches words, not phrases, so if
   the whole query is not in the note, the longest run of its words that is (soonest after that point)
   is used instead: "internal relocation Kabul" -> "internal relocation". */
const QUERY_STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "are", "was", "not", "but"]);
function findFromQuery() {
  const q = H.normWs((params.get("q") || "").replace(/^\s*"(.+)"\s*$/, "$1"));
  const id = decodeURIComponent(location.hash.slice(1));
  if (q.length < 2 || id.startsWith("h=")) return false;                // a saved highlight's link wins
  const el = id ? document.getElementById(id) : null;
  const from = el && S.root.contains(el) ? (S.ix.firstTextAt(el) ?? 0) : 0;
  const { norm, map } = foldedText();
  const nextAt = (term) => {                                            // first match at or after `from`
    const t = fold(term);
    for (let i = norm.indexOf(t); i >= 0; i = norm.indexOf(t, i + 1)) if (map[i] >= from) return map[i];
    return norm.includes(t) ? Infinity : -1;                            // only earlier in the note
  };
  const words = q.split(" ").slice(0, 8);
  let term = null;
  for (const anywhere of [false, true]) {
    for (let len = words.length; len >= 1 && !term; len--) {
      let best = null;
      for (let i = 0; i + len <= words.length; i++) {
        const t = words.slice(i, i + len).join(" ");
        if (len === 1 && (t.length < 3 || QUERY_STOP.has(t.toLowerCase()))) continue;
        const at = nextAt(t);
        if (at >= 0 && (anywhere || at !== Infinity) && (!best || at < best[1])) best = [t, at];
      }
      term = best?.[0] || null;
    }
    if (term) break;
  }
  term ||= q;
  findInput.value = term;
  runFind(term, { jump: false });
  if (!F.hits.length) { if (el && S.root.contains(el)) goToElement(el); return true; }
  const k = F.hits.findIndex(([a]) => a >= from);
  goFind(k < 0 ? 0 : k);
  return true;
}

/* ================================================================== chrome: theme, keys, sheet, progress */

let sheetTab = "toc";
function renderSheet() {
  const body = $("#sheetBody");
  body.innerHTML = sheetTab === "toc" ? `<nav class="toc">${tocHtml(sectionCounts())}</nav>` : `<div class="rail">${savedHtml()}</div>`;
  $("#sheet").querySelectorAll(".sheet-tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === sheetTab)));
}
function openSheet(tab) {
  sheetTab = tab;
  renderSheet();
  const sheet = $("#sheet"), bd = $("#sheetBackdrop");
  bd.hidden = false;
  sheet.removeAttribute("inert");
  sheet.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => { bd.classList.add("on"); sheet.classList.add("on"); });
  $("#dock").classList.add("is-hidden");
}
function closeSheet() {
  const sheet = $("#sheet"), bd = $("#sheetBackdrop");
  if (!sheet.classList.contains("on")) return;
  sheet.classList.remove("on");
  bd.classList.remove("on");
  sheet.setAttribute("inert", "");
  sheet.setAttribute("aria-hidden", "true");
  setTimeout(() => { if (!sheet.classList.contains("on")) bd.hidden = true; }, 520);
  $("#dock").classList.remove("is-hidden");
}

function wireChrome() {
  const themeBtn = $("#theme");
  const MODES = ["auto", "light", "dark"];
  const current = () => document.documentElement.dataset.theme || "auto";
  const apply = (mode) => {
    if (mode === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = mode;
    try { localStorage.setItem("cpin-theme", mode); } catch {}
    themeBtn.textContent = mode.toUpperCase();
    themeBtn.setAttribute("aria-label", `Colour theme: ${mode}. Click to change.`);
    hydrateFlags(document, { force: true });
  };
  themeBtn.textContent = current().toUpperCase();
  themeBtn.addEventListener("click", () => apply(MODES[(MODES.indexOf(current()) + 1) % MODES.length]));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (current() === "auto") hydrateFlags(document, { force: true }); });

  addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); findInput.focus(); findInput.select(); return; }
    if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "j" || e.key === "k") && F.hits.length) { e.preventDefault(); goFind(F.cur + (e.key === "j" ? 1 : -1)); return; }
    if (e.key === "Escape") {
      if (popState) closePop();
      else if (!tool.hidden) { hideTool(); getSelection().removeAllRanges(); }
      else closeSheet();
    }
    if (["PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End", " "].includes(e.key) && !typing) stopGlide();
  });

  $("#dock").addEventListener("click", (e) => { const b = e.target.closest("[data-sheet]"); if (b) openSheet(b.dataset.sheet); });
  $("#sheetClose").addEventListener("click", closeSheet);
  $("#sheetBackdrop").addEventListener("click", closeSheet);
  $("#sheet").addEventListener("click", (e) => {
    const tab = e.target.closest(".sheet-tab");
    if (tab) { sheetTab = tab.dataset.tab; renderSheet(); }
  });
  // Contents links (column and sheet) glide to their heading.
  document.addEventListener("click", (e) => {
    const a = e.target.closest(".toc a[data-sec]");
    if (!a) return;
    e.preventDefault();
    const s = S.sections[Number(a.dataset.sec)];
    if (!s) return;
    if ($("#sheet").contains(a)) closeSheet();
    history.replaceState(null, "", `#${s.id}`);
    goToElement(s.el);
  });

  const bar = $("#progress");
  let ticking = false;
  addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const p = Math.max(0, Math.min(1, scrollY / Math.max(1, maxScroll())));
      bar.style.transform = `scaleX(${p.toFixed(4)})`;
    });
  }, { passive: true });
  addEventListener("resize", () => { if (popState) closePop(); hideTool(); moveIndicator(); });
  addEventListener("hashchange", () => routeHash());
}

function routeHash({ initial = false } = {}) {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h || !S.ready) return;
  const m = /^h=(.+)$/.exec(h);
  if (m) return goToHighlight(m[1], { open: true });
  const el = document.getElementById(h);
  if (el && S.root.contains(el)) goToElement(el, initial ? {} : {});
}

/* ================================================================== toasts */

function toast(message, { action, onAction, ms = 3800 } = {}) {
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action)}</button>` : ""}`;
  const remove = () => { el.classList.add("out"); setTimeout(() => el.remove(), 300); };
  if (action) el.querySelector("button").addEventListener("click", () => { onAction?.(); remove(); });
  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(remove, ms);
}

/* ================================================================== test hook (?test) */

if (TEST) {
  const offsetsOf = (text, nth = 0) => {
    let i = -1;
    for (let k = 0; k <= nth; k++) { i = S.text.indexOf(text, i + 1); if (i < 0) return null; }
    return [i, i + text.length];
  };
  window.cpinReader = {
    ready,
    offsetsOf,
    select(text, nth = 0) {
      const o = offsetsOf(text, nth);
      if (!o) return null;
      const r = S.ix.range(o[0], o[1]);
      warm(r.startContainer.parentElement);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      checkSelection();
      const p = S.pending;
      return p && { s: p.s, e: p.e, quote: p.selector.quote, para: p.para, section: p.section, sources: p.sources, toolVisible: !tool.hidden };
    },
    pending: () => S.pending && { quote: S.pending.selector.quote, para: S.pending.para, section: S.pending.section, sources: S.pending.sources },
    save: () => (S.pending ? saveHighlight(S.pending) : null),
    async copy(kind = "both") {
      const info = S.pending;
      if (!info) return null;
      const payload = kind === "both" ? quoteWithCitation(ctxFromInfo(info), citeStyle, info.sources) : formatCitation(ctxFromInfo(info), citeStyle);
      const ok = await copyRich(payload);
      return { ok, ...S.lastCopy };
    },
    lastCopy: () => S.lastCopy,
    open: (id) => openHighlight(id),
    goTo: (id) => goToHighlight(id, { open: true }),
    find: (q) => { findInput.value = q; runFind(q); return { hits: F.hits.length, cur: F.cur }; },
    step: (d) => { goFind(F.cur + d); return F.cur; },
    style: (s) => setStyle(s),
    highlights: () => H.highlightsFor(COUNTRY, NOTE),
    checks: () => Object.fromEntries([...S.checks].map(([id, c]) => [id, c.status])),
    marks: (id) => (S.marks.get(id) || []).map((m) => m.textContent).join(""),
    state: () => ({ edition: S.edition.sha256, version: S.edition.version_banner, src: S.src, month: S.month, sections: S.sections.length, refs: S.refs.length, paras: S.anchors.filter((a) => a.para).length, textLength: S.text.length }),
    textAt: (s, e) => S.text.slice(s, e),
  };
}
