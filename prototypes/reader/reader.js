// CPIN Explorer · the report page: one Home Office report (every edition we hold of one note), read
// verbatim. The latest edition is shown clean by default; the history band above it puts every edition
// and GOV.UK update on a timeline (click, drag or step), each captioned with what changed; and the same
// reading area can show a redline between the edition shown and the one before (or any two).
//
// The head is one quiet block (flag, title, one line about the edition shown; "Verbatim" and "Sources" open
// small panels) and everything above the text has a fixed height, so changing edition moves nothing.
// An edition that keeps under a quarter of the earlier wording is a rewrite (REWRITE_THRESHOLD): the caption
// says so, and Show changes offers the two editions side by side, unmarked, before a redline.
//
//   index.html?country=<slug>&series=<key>                         the latest edition, clean
//     &edition=<id>                                               an earlier edition (time travel)
//     &changes=1[&from=<id>][&view=sbs]                           the redline, in place
//     &q=<words>                                                  arrived from search: find in the text
//     #h=<highlight id> | #<heading id>
//   index.html?country=<slug>&note=<note id>                      older links: mapped to their report
//
// The words are never altered. Rendering only changes presentation: mirrored image sources, links that
// open here or in a new tab, paragraph numbers hung in the margin, tables in a scroller, chunks for
// content-visibility, <mark> elements for saved highlights and small tags after cited sources; and the
// reading aids of ../shared/display-format.js (odd spaces evened out, typed enumerators hung, quoted runs ruled).
import { hydrateFlags } from "../shared/dot-flag.js";
import { fetchJson } from "../shared/fetch-json.js";
import {
  capFirst, escHtml as esc, formatCitation, formatPinpoint, pdfPinpoint, quoteOf, quoteWithCitation, STYLE_HINTS, STYLE_LABELS, STYLE_NAMES, STYLES, titleMonth,
} from "../shared/citation.js";
import * as H from "../shared/highlights.js";
import { accountStore } from "../shared/account-state.js";
import * as Reviews from "../shared/source-reviews.js";
import { mountReviewFeedback } from "../shared/review-feedback.js";
import * as Annotations from "../shared/review-annotations.js";
import { analyseBody, describePassage, FOOTNOTE_REF_SELECTOR, parseBody, snapToParaNumber, trimNextParaNumber } from "../shared/note-source.js";
import { decorateLinks, loadLinkStatus, summaryLine } from "../shared/link-status.js";
import { linkToHeldNotes, repairAnchors } from "../shared/internal-links.js";
import { formatDisplay } from "../shared/display-format.js";
import { placePdfFigures } from "../shared/pdf-figures.js";
import {
  alignHeadings, archiveCopy, archiveName, buildTimeline, captionSource, capturedAt, computedSummary, currentPdf, editionForStop, editionsBetweenNotHeld, editionWhere, findParaRefs, findSectionNames, firstSeen,
  headingKey, increasing, isArchivedPdf, isRewrite, keptPercent, leadingNumber, mapThrough, phrasesOf, phrasesShared, reportUrl, resolveParaRef, seriesPath,
  leftGovuk, readOnGovuk, sourceWords, updateKind, versionsNotHeld,
} from "../shared/report-history.js";
import { DateRoller, HistorySlider, NumberRoller } from "../shared/timeline.js";
import { ukDate, ukParts, ukTime } from "../shared/uk-time.js";
import { RedlineEngine } from "../shared/redline-engine.js";
import { DocPositioner, Minimap } from "../shared/minimap.js";
import { linkFacts, mountLinkCards } from "./link-card.js";
import { differsChip, differsPanel } from "./pdf-differences.js";
import { EdgeStrip, sheetSide } from "./phone.js";

// The page's own parts are looked up by id. A heading in a note can carry the same id ("rail", "history"),
// and must never be taken for the page's: it would be overwritten with the page's part.
const inNote = (el) => !!el.closest("#doc .govspeak, #doc .rl");
const $ = (sel, root = document) => {
  const el = root.querySelector(sel);
  return el && root === document && /^#[\w-]+$/.test(sel) && inNote(el) ? [...root.querySelectorAll(sel)].find((x) => !inNote(x)) ?? null : el;
};
const params = new URLSearchParams(location.search);
const COUNTRY = params.get("country") || "";
let SERIES = params.get("series") || "";
const NOTE = params.get("note") || "";
const WANT = {
  edition: params.get("edition") || "", changes: params.get("changes") === "1", from: params.get("from") || "",
  view: params.get("view") === "sbs" ? "sbs" : "inline", q: params.get("q") || "",
};
const TEST = params.has("test");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const coarse = matchMedia("(pointer: coarse)");
const narrow = matchMedia("(max-width: 899px)");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = MONTHS.map((m) => m.slice(0, 3));
const asT = (x) => (typeof x === "number" ? x : Date.parse(x));
// Dates are UK dates (../shared/uk-time.js), like the times of day and like GOV.UK itself: an edition
// published at 00:30 BST belongs to that day, not the day before (which is what UTC would say).
const fmtDate = (x) => { const d = ukParts(asT(x)); return d ? `${d.day} ${MON[d.month]} ${d.year}` : ""; };
const fmtLong = (x) => { const d = ukParts(asT(x)); return d ? `${d.day} ${MONTHS[d.month]} ${d.year}` : ""; };
const fmtMonth = (x) => { const d = ukParts(asT(x)); return d ? `${MON[d.month]} ${d.year}` : ""; };
/** A date with its time of day, on the site's one clock (UK time, BST or GMT): "2 Oct 2026 · 17:11 BST". */
const fmtDateTime = (iso) => {
  if (!iso) return "";
  const [d, m, y] = ukDate(iso).split(" ");
  return y ? `${+d} ${m[0]}${m.slice(1).toLowerCase()} ${y} · ${ukTime(iso)}` : "";
};
const fmtN = (n) => Number(n || 0).toLocaleString("en-GB");
const stopDate = (s) => (s.prec === "month" ? fmtMonth(s.t) : fmtDate(s.t));
const stopDateLong = (s) => { const d = ukParts(s.t); return s.prec === "month" ? (d ? `${MONTHS[d.month]} ${d.year}` : "") : fmtLong(s.t); };
const vLabel = (e) => (e?.version ? `v${e.version}` : "edition");
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : s);
const idle = (fn, timeout = 400) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout }) : setTimeout(fn, 60));
const ICON = {
  save: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h8v11l-4-3-4 3z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  copy: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.5 10.5h-1v-8h8v1" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  quote: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 9.5c0-3 1.4-4.6 3.4-5M3 9.5h3v3.5H3zM9 9.5c0-3 1.4-4.6 3.4-5M9 9.5h3v3.5H9z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`,
};

/* ================================================================== preferences */

const STYLE_KEY = "cpin-cite-style";
let citeStyle = (() => { try { return localStorage.getItem(STYLE_KEY) === "tribunal" ? "tribunal" : "oscola"; } catch { return "oscola"; } })();
/** The style switch: "Full (OSCOLA)" | "Short (tribunal)", each with a tooltip saying what it produces; with
 *  hint, a line under it says the same for the style chosen. */
const segHtml = ({ hint = false } = {}) => `<div class="seg" role="radiogroup" aria-label="Citation style" data-value="${citeStyle}"><span class="seg-thumb" aria-hidden="true"></span>${
  STYLES.map((s) => `<button type="button" role="radio" data-style="${s}" aria-checked="${citeStyle === s}" title="${esc(STYLE_HINTS[s])}">${esc(STYLE_LABELS[s])}</button>`).join("")}</div>${
  hint ? `<p class="seg-hint" data-style-hint>${esc(STYLE_HINTS[citeStyle])}</p>` : ""}`;
function setStyle(style, { persist = true } = {}) {
  if (style !== "oscola" && style !== "tribunal") return;
  citeStyle = style;
  if (persist) { try { localStorage.setItem(STYLE_KEY, style); } catch {} }
  document.querySelectorAll(".seg").forEach((seg) => {
    seg.dataset.value = style;
    seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.style === style)));
  });
  document.querySelectorAll("[data-style-hint]").forEach((p) => { p.textContent = STYLE_HINTS[style]; });
  if (popState?.kind === "hl") renderPopCitation();
}
document.addEventListener("click", (e) => { const b = e.target.closest(".seg button[data-style]"); if (b) setStyle(b.dataset.style); });
addEventListener("storage", (e) => { if (e.key === STYLE_KEY && e.newValue) setStyle(e.newValue, { persist: false }); });

/* ================================================================== state */

const S = {
  data: null, country: null, report: null, series: null, tl: null, E: [], noteIds: new Set(),
  mode: "read", view: WANT.view,               // read: one edition, clean; changes: a redline of two
  pair: null,                                  // { a, b } edition indices shown as a redline
  C: null,                                     // the clean edition: { e, root, A, ix, text, fresh }
  V: null,                                     // what #doc shows: { kind, root, ix, sections, targets }
  redline: null,                               // { a, b, res } painted
  rewrite: null,                               // the pair shown is a rewrite: { a, b, sim, view: notice | pair | redline }
  sources: null,                               // link counts of the edition shown, for the Sources chip
  marks: new Map(), checks: new Map(), pending: null, lastCopy: null, ready: false,
  linkMap: null, links: null, fullSha: new Map(), sums: [], sizes: [],
  cur: -1, hunks: new Map(),
  reviewRecords: [], annotations: [], reviewLocations: new Map(), reviewDirectory: [], sourceCopies: [], directoryUnavailable: false, reviewsLoading: true, reviewsUnavailable: false,
};
const privateReviews = Reviews.createPrivateStore();
let readyResolve;
const ready = new Promise((r) => { readyResolve = r; });
let minimap = null, minimapRoot = null;               // the strip beside the text (see "minimap" below)
let edgeStrip = null;                                 // ... and its cousin down the left edge on phones

/* ================================================================== text index */

// Offsets into the text of the body as published, so a highlight can be stored as plain text positions
// and found again however the DOM is split up by marks. Tags added for display (link status) are skipped.
const SKIP_UI = (el) => H.SITE_TAGS.some((c) => el.classList.contains(c))   // link status, changed links, badges, a picture from the PDF (pdf-figures.js)
  || ((el.classList.contains("pv-pane") || el.classList.contains("sbs-cell")) && !!el.closest(".pv") && getComputedStyle(el).display === "none");   // phones: the edition not on screen
function textWalker(root) {
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT : SKIP_UI(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP),
  });
}
class TextIndex {
  constructor(root) { this.root = root; this.dirty = true; }
  ensure() {
    if (!this.dirty) return this;
    const nodes = [], starts = [], parts = [];
    let off = 0;
    const walker = textWalker(this.root);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push(n); starts.push(off); parts.push(n.data); off += n.data.length; }
    this.nodes = nodes; this.starts = starts; this.length = off; this.text = parts.join("");
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
    const walker = textWalker(this.root);
    const ref = container.nodeType === Node.TEXT_NODE ? container : container.childNodes[offset] || null;
    let t = null;
    if (ref) {
      walker.currentNode = ref;
      t = ref.nodeType === Node.TEXT_NODE && this.pos.has(ref) ? ref : walker.nextNode();
      while (t && !this.pos.has(t)) t = walker.nextNode();       // a point inside a tag of ours (not in the index): the note's next text
    } else {
      walker.currentNode = container;
      do { t = walker.nextNode(); } while (t && container.contains(t));
    }
    const i = t ? this.pos.get(t) : null;
    return i == null ? this.length : this.starts[i];
  }
  nodeIndexAt(off) {
    let lo = 0, hi = this.starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.starts[mid] <= off) lo = mid; else hi = mid - 1; }
    return lo;
  }
  point(off, isStart) {
    this.ensure();
    let i = this.nodeIndexAt(off);
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
    const walker = textWalker(el);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.data.trim() || !this.pos.has(t)) continue;
      return this.starts[this.pos.get(t)] + (t.data.length - t.data.trimStart().length);
    }
    return null;
  }
}
const normalizedClean = () => (S.C.normalized ??= H.normalizeWithMap(S.C.text));
function viewIndex() { if (!S.V.ix) S.V.ix = new TextIndex(S.V.root); return S.V.ix.ensure(); }

/* ================================================================== boot */

boot().catch((error) => { console.error(error); fail("Something went wrong while opening this report.", String(error?.message || error)); });

async function boot() {
  wireChrome();
  setupMinimap();
  if (!/^[a-z0-9-]+$/.test(COUNTRY) || (!SERIES && !NOTE) || (SERIES && !/^[\w:.-]+$/.test(SERIES)) || (NOTE && !/^[\w.()-]+$/.test(NOTE))) {
    return fail("That address does not name a report.", "Open a report from the dashboard, or use reader/index.html?country=<country>&series=<report>.");
  }
  const dataP = fetchJson("../dashboard/data.json").catch(() => null);
  const linksP = loadLinkStatus(COUNTRY);
  const reviewsP = Promise.all([fetchJson("../reviews/published.json").then((data) => {
    if (data.schema !== 1 || !Array.isArray(data.records)) throw new Error("Unrecognised review records");
    S.reviewRecords = data.records.filter((r) => ["ai", "external"].includes(r?.kind));
  }).catch(() => { S.reviewsUnavailable = true; }), fetchJson("../reviews/directory.json").then((data) => {
    if (data.schema !== 1 || !Array.isArray(data.reviews)) throw new Error("Unrecognised review directory");
    S.reviewDirectory = data.reviews;
  }).catch(() => { S.directoryUnavailable = true; }), fetchJson("../reviews/source-copies.json").then((data) => {
    if (data.schema !== 1 || !Array.isArray(data.copies)) throw new Error("Unrecognised source copies");
    S.sourceCopies = data.copies;
  }).catch(() => {}), fetchJson("../reviews/annotations.json").then((data) => {
    if (data.schema !== 1 || !Array.isArray(data.records)) throw new Error("Unrecognised passage reviews");
    S.annotations = data.records.filter((r) => ["ai", "external"].includes(r?.kind));
  }).catch(() => { S.reviewsUnavailable = true; })]).finally(() => {
    S.reviewsLoading = false;
    decorateReviews();
    if (S.ready) updateHead();
    if (popState?.kind === "fn") openFootnote(popState.n, popState.anchor, popState.prefix);
  });
  let seriesP = SERIES ? fetchJson(seriesPath(COUNTRY, SERIES)) : null;
  seriesP?.catch(() => {});
  S.data = await dataP;
  S.country = S.data?.countries?.find((c) => c.slug === COUNTRY)
    || { slug: COUNTRY, name: capFirst(COUNTRY.replace(/-/g, " ")), iso_a2: null, notes: [], reports: [] };
  const noteEntry = NOTE ? S.country.notes?.find((n) => n.id === NOTE) : null;
  if (!SERIES) {
    SERIES = noteEntry?.series || Object.values(S.data?.note_paths || {}).find((x) => x.country === COUNTRY && x.note === NOTE)?.series || "";
    if (!SERIES) {
      if (noteEntry?.pdf_url) return fail("This note is published as a PDF only.", "There is no HTML edition to read here.", noteEntry.pdf_url);
      return fail("This note could not be found.", `No note “${NOTE}” is held for ${S.country.name}.`);
    }
    seriesP = fetchJson(seriesPath(COUNTRY, SERIES));
  }
  S.report = S.country.reports?.find((r) => r.key === SERIES) || null;
  const pdf = S.report?.latest?.pdf_url || noteEntry?.pdf_url || null;
  try { S.series = await seriesP; }
  catch { return fail("This report could not be loaded.", `Its editions are not in the export yet (${seriesPath(COUNTRY, SERIES)}). Run ./cpin export.`, pdf); }
  S.tl = buildTimeline(S.series);
  S.E = S.tl.editions;
  if (!S.E.length) return fail("No HTML edition of this report is held.", "It is published as a PDF only.", pdf);
  S.noteIds = new Set([...S.E.map(noteIdOf), ...S.series.versions.map((v) => v.note), NOTE].filter(Boolean));

  // Which edition to open: an explicit one, else the newest held under an older note's address, else the latest.
  let e = S.tl.latest;
  const byId = WANT.edition ? editionById(WANT.edition) : -1;
  if (byId >= 0) e = byId;
  else if (NOTE) {
    const under = S.E.filter((x) => x.v.note === NOTE);
    if (under.length && !under.some((x) => x.i === S.tl.latest)) e = under.at(-1).i;
  }
  renderHead();
  buildHistory(e);
  if (WANT.changes && S.E.length > 1) {
    S.mode = "changes";
    const from = editionById(WANT.from);
    let b = e, a = from >= 0 && from < b ? from : b - 1;
    if (a < 0) { a = 0; b = 1; }
    showEdition(b, { initial: true, mount: false });                 // highlights and citations need the clean text
    slider.setMode("compare", { a: stopOf(a), b: stopOf(b) });
    slider.place(stopOf(a), stopOf(b));
    await loadPair(a, b, { initial: true });
  } else {
    showEdition(e, { initial: true });
  }
  applyModeUI();
  await document.fonts?.ready;
  S.ready = true;
  document.body.classList.remove("is-loading");
  H.onHighlightsChange(sync);
  readyResolve();
  syncUrl();
  linksP.then((map) => { S.linkMap = map || {}; decorateView(); });
  void reviewsP;
  idle(warmEngine, 300);
  rollers.forEach((r) => r.remeasure(true));
  measureBars();
  slider.cull();
  if (!findFromQuery()) routeHash({ initial: true });
}

function fail(title, detail, pdf) {
  document.body.classList.remove("is-loading");
  const doc = $("#doc");
  doc.removeAttribute("aria-busy");
  doc.innerHTML = `<div class="load-error pop-in"><span class="tag">Report</span><h2>${esc(title)}</h2>${detail ? `<p>${esc(detail)}</p>` : ""}
    <p><a class="btn" href="../dashboard/index.html${COUNTRY ? `#${esc(COUNTRY)}` : ""}">← Back to the dashboard</a>
    ${pdf ? ` <a class="btn btn--primary" href="${esc(pdf)}" target="_blank" rel="noopener">Open the PDF ↗</a>` : ""}</p></div>`;
  $("#toc").innerHTML = "";
  $("#bar").hidden = true;
  readyResolve?.();
}

/* ================================================================== head */

const isLatest = (e) => e === S.tl.latest;
const gone = () => S.series.status === "removed" || S.series.status === "archived";
// The report's current edition, when the Home Office publishes it as a PDF only ({ title, month, pdf_url }).
// The newest edition held as text is then an earlier one, and nothing may call it the latest or current.
const pdfNow = () => currentPdf(S.series);
const pdfMonth = (p) => (p?.month ? `${MONTHS[Number(p.month.slice(5, 7)) - 1]} ${p.month.slice(0, 4)}` : "");
/** What to say about an update that brought no text: the tag, the words for a tooltip, and a short phrase for a facts line. */
function updateWords(stop) {
  const kind = updateKind(stop);
  if (kind === "pdf") return { kind, tag: "PDF only", facts: "published as a PDF only",
    why: "The Home Office published this edition as a PDF only, with no web version, so its text cannot be shown or compared here." };
  if (kind === "removed") return { kind, tag: "Removed", facts: "report removed",
    why: "With this update GOV.UK took the report down. Nothing was published, so there is no edition from it to hold." };
  return { kind, tag: "Not held", facts: "edition not held",
    why: "GOV.UK does not keep earlier editions. This site recovers earlier web pages and PDFs from the Internet Archive, the National Archives and document repositories; no copy of this update is held. (Until late 2021 the notes were published as PDFs only.)" };
}
/** Where an edition can be read, for links and citations: GOV.UK while it is the live edition, else its archived
 *  copy; for an edition read from a PDF, the PDF (the Internet Archive's copy of it, where GOV.UK no longer lists
 *  the file). See report-history.js: editionWhere. */
function editionSource(E) {
  return editionWhere(E.v, { gone: gone(), fallback: S.report?.latest?.govuk_url || "" });
}
/** An edition's archive copy as a saved highlight keeps it: { url, capturedAt }, or null when none is held. */
const copyOf = (v) => { const c = archiveCopy(v); return c ? { url: c.archive_url, capturedAt: capturedAt(c) } : null; };
const shownEdition = () => (S.mode === "changes" && S.pair ? S.pair.b : S.C?.e ?? S.tl.latest);

function renderHead() {
  const c = S.country, s = S.series;
  const topic = capFirst(s.topic || S.report?.topic || s.key);
  document.title = `${topic} · ${c.name} · CPIN Explorer`;
  const back = `../dashboard/index.html#${encodeURIComponent(c.slug)}`;
  $("#brand").href = back;
  const left = leftGovuk(s.left_govuk, fmtDate);                  // when the report was found gone, if this copy saw it go
  // One quiet block: where it is from, what it is, and one line about the edition shown. The rest is on demand:
  // "Verbatim" says exactly where the words come from; "Sources" opens the link check for this edition.
  $("#head").innerHTML = `
    <div class="mh-row" style="--i:0">
      ${c.iso_a2 ? `<canvas class="dotflag dotflag--hero" data-flag="${esc(c.iso_a2)}" data-cols="24" data-reveal data-interactive aria-hidden="true"></canvas>` : ""}
      <div class="mh-id">
        <p class="eyebrow mh-eyebrow"><a class="mh-back" href="${esc(back)}" title="Back to ${esc(c.name)}: all its reports"><span aria-hidden="true">←</span> ${esc(c.name)}</a><span class="mh-kind">${esc(s.kind || "Report")}</span></p>
        <h1 class="report-title">${esc(topic)}</h1>
        <div class="mh-meta">
          ${s.withdrawn_at ? `<p class="meta-line">Withdrawn ${esc(fmtDate(s.withdrawn_at))}</p>` : ""}
          <p class="meta-line" id="metaLine"></p>
          <div class="mh-chips">
            <button type="button" class="chip" id="sourcesChip" data-hpop="sources" aria-expanded="false" aria-controls="hpop" hidden></button>
            <button type="button" class="chip" id="pdfChip" data-hpop="pdf" aria-expanded="false" aria-controls="hpop" hidden></button>
            <button type="button" class="chip" id="verbatimChip" data-hpop="verbatim" aria-expanded="false" aria-controls="hpop">Verbatim</button>
            <button type="button" class="chip" id="reviewsChip" aria-haspopup="dialog" aria-expanded="false" aria-controls="pop" hidden>Reviews</button>
            <div class="hpop" id="hpop" role="dialog" aria-label="About the edition shown" hidden></div>
          </div>
        </div>
      </div>
    </div>${gone() ? `
    <p class="notice notice--gone" style="--i:1"><span class="tag">${s.withdrawn_at ? "Withdrawn" : s.status === "removed" ? "Removed" : "Archived"}</span><span><strong>${s.withdrawn_at ? "Withdrawn guidance" : `No longer on GOV.UK${left ? ` since ${esc(left.when)}` : ""}`}.</strong>
      The Home Office has withdrawn this report${left ? ` (${esc(left.sentence.replace(/^GOV\.UK withdrew it /, "").replace(/\.$/, ""))})` : ""}. ${
        s.versions.every(isArchivedPdf) ? "Every edition here is read from a historical copy of its PDF, with the layout rebuilt"
        : s.versions.some((v) => v.source === "pdf") ? "Every edition here is the text as it was published, or, where marked From the PDF, read from its PDF with the layout rebuilt"
        : "Every edition here is the text as it was published"}; none of it is current guidance.</span></p>` : ""}${pdfNow() ? pdfNotice() : ""}`;
  Promise.all([document.fonts?.ready, ready]).then(() => idle(() => hydrateFlags($("#head")), 300));
}

/** The title an edition was published under (verbatim), for the Verbatim panel. */
function publishedTitle(v) {
  return v.title && !/^[a-z0-9-]+$/.test(v.title) ? v.title : (S.country.notes?.find((n) => n.id === v.note)?.title || v.title || "");
}
/**
 * Exactly where the words of an edition come from: GOV.UK, as this copy read them there (the live edition), the
 * Internet Archive's copy (an archived edition), or the copy taken here before GOV.UK replaced it.
 * short is one line (the chip's tooltip); html the panel's first paragraph.
 */
function verbatimInfo(E) {
  const v = E.v, copy = archiveCopy(v), cap = capturedAt(copy || v);
  if (isArchivedPdf(v)) {
    // Recovered from the Internet Archive as a PDF: GOV.UK no longer lists it. Two things, and both are said: the
    // words are read from a PDF (the layout is rebuilt here), and that PDF is the Archive's copy, not GOV.UK's.
    const when = capturedAt(v) ? `, captured ${fmtDate(capturedAt(v))}` : "";
    const provider = archiveName(v);
    const owner = provider === "National Archives" ? "the National Archives’" : provider === "Internet Archive" ? "the Internet Archive’s" : `${provider}’s`;
    return { pdf: true, archived: true, short: `Text taken from ${owner} copy of the Home Office’s PDF${when}; the layout is rebuilt here`,
      html: `This edition is no longer on GOV.UK, and no web version of it is held. The words below are taken from
        <a href="${esc(v.archive_url)}" target="_blank" rel="noopener">${esc(owner)} copy of the Home Office’s PDF${esc(when)} ↗</a> (the PDF’s own text: nothing is read by OCR).
        The paragraphs, lists, tables and footnotes are rebuilt from its pages by this site, so where exact wording or layout matters, check the PDF.` };
  }
  if (v.source === "pdf") {
    // Published as a PDF only: its words are the PDF's, but the layout is rebuilt here (src/cpin/pdftext.py). Say so plainly.
    const pdf = v.pdf_url ? `<a href="${esc(v.pdf_url)}" target="_blank" rel="noopener">the Home Office’s PDF ↗</a>` : "the Home Office’s PDF";
    return { pdf: true, short: "Text taken from the Home Office’s PDF; the layout is rebuilt here",
      html: `This edition is published as a PDF only. The words below are taken from ${pdf} (its own text: nothing is read by OCR).
        The paragraphs, lists, tables and footnotes are rebuilt from its pages by this site, so where exact wording or layout matters, check the PDF.` };
  }
  const ia = copy ? `<a href="${esc(copy.archive_url)}" target="_blank" rel="noopener">Internet Archive copy${cap ? ` captured ${esc(fmtDate(cap))}` : ""} ↗</a>` : "";
  if (v.source === "wayback") {
    return { short: `Verbatim: the Internet Archive copy${cap ? ` captured ${fmtDate(cap)}` : ""}`,
      html: `The words below are the ${ia || "Internet Archive copy"} of this edition, exactly as GOV.UK published it then. It is no longer on GOV.UK.` };
  }
  if (v.current && !gone()) {
    // Say what is known: when this copy read these words on GOV.UK. Not "as at the last check": the last run may
    // have been a quick one, which compares the country pages' dates and reads no note again (report-history.js).
    const known = readOnGovuk(v, S.data?.last_sync, fmtDateTime);
    return { short: `Verbatim from GOV.UK${known.when ? `, ${known.how} there ${known.when}` : ""}`,
      html: `The words below are exactly as published on ${v.govuk_url ? `<a href="${esc(v.govuk_url)}" target="_blank" rel="noopener">GOV.UK ↗</a>` : "GOV.UK"}${
        known.when ? `, as this copy ${known.how} them there on <b>${esc(known.when)}</b>` : ""}.${known.check ? ` ${esc(known.check)}` : ""}` };
  }
  const seen = v.first_seen ? fmtDate(v.first_seen) : "";
  const left = leftGovuk(v.left_govuk, fmtDate);                  // the day it was found replaced or gone, where that was seen
  return { short: `Verbatim from GOV.UK${seen ? `, copied ${seen}` : ""}; ${left ? left.label.replace(/^A/, "a") : `since ${gone() ? "withdrawn" : "replaced"}`}`,
    html: `The words below are exactly as GOV.UK published this edition, from the copy taken here${seen ? ` on <b>${esc(seen)}</b>` : ""}.
      ${left ? esc(left.sentence) : `GOV.UK has since ${gone() ? "withdrawn the report" : "replaced it with a newer edition"}.`}${ia ? ` An ${ia} holds the same edition.` : ""}` };
}

/** The parts of the head that follow the edition shown. One line, so nothing below it moves. */
function updateHead() {
  const e = shownEdition(), E = S.E[e], v = E.v;
  const src = editionSource(E);
  const pdf = isLatest(e) ? (S.report?.latest?.pdf_url || S.country.notes?.find((n) => n.id === v.note)?.pdf_url) : null;
  // The edition's date is the note's own (its "valid from", else the month in its title), and says which. GOV.UK's
  // date for the note is the country page's, so it is never shown as the edition's (report-history.js: ownDate).
  const dated = E.own ? `${E.own.from === "valid from" ? "Valid from" : "Dated"} ` : "";
  const published = E.own ? (E.own.precision === "month" ? fmtMonth(E.own.date) : fmtDate(E.own.date)) : "";
  // .m-l parts drop out on phones ("v2.0 · 19 Nov 2025 · GOV.UK ↗ · PDF ↗"), so the line still fits on one line.
  const meta = [
    E.version ? `<span><span class="m-l">Version </span><span class="m-s">v</span><b>${esc(E.version)}</b></span>` : "",
    published ? `<span><span class="m-l">${dated}</span>${esc(published)}</span>` : "",
    src.archived ? `<a href="${esc(src.url)}" target="_blank" rel="noopener" title="${esc(archiveName({ archive_url: src.url }))}'s copy of this edition${src.pdf ? "’s PDF" : ""}${src.capturedAt ? `, captured ${esc(fmtDate(src.capturedAt))}` : ""}${src.pdf ? ": the text here is taken from it" : ""}">Archived copy${src.capturedAt ? `<span class="m-l">, ${esc(fmtDate(src.capturedAt))}</span>` : ""} ↗</a>`
      : src.pdf ? (src.url ? `<a href="${esc(src.url)}" target="_blank" rel="noopener" title="This edition is published as a PDF only: the text here is taken from it">PDF ↗</a>` : "")
      : src.url ? `<a href="${esc(src.url)}" target="_blank" rel="noopener">GOV.UK ↗</a>` : "",
    pdf && !src.pdf ? `<a href="${esc(pdf)}" target="_blank" rel="noopener">PDF ↗</a>` : "",
  ].filter(Boolean).join("");
  const line = $("#metaLine");
  if (line.innerHTML !== meta) { line.innerHTML = meta; swapIn(line); }
  // Cut short (a narrow window)? Then the whole line is its tooltip.
  line.title = line.scrollWidth > line.clientWidth + 1
    ? [E.version ? `Version ${E.version}` : "", published ? `${dated}${published}` : "", src.archived ? `Archived copy${src.capturedAt ? `, ${fmtDate(src.capturedAt)}` : ""}` : src.url ? "GOV.UK" : "", pdf ? "PDF" : ""].filter(Boolean).join(" · ")
    : "";
  const how = verbatimInfo(E);
  $("#verbatimChip").title = how.short;
  if ($("#verbatimChip").textContent !== (how.pdf ? "From the PDF" : "Verbatim")) $("#verbatimChip").textContent = how.pdf ? "From the PDF" : "Verbatim";
  showPdfChip(v);
  showSourcesChip();
  const reviewsChip = $("#reviewsChip");
  const t = reviewEdition();
  const reviewCount = Annotations.editionRecords([...S.reviewRecords, ...S.annotations], t).length;
  const countryCount = S.reviewDirectory.filter((r) => r.countries?.includes(COUNTRY)).length;
  reviewsChip.hidden = !reviewCount && !countryCount && !S.reviewsLoading && !S.reviewsUnavailable && !S.directoryUnavailable;
  reviewsChip.textContent = S.reviewsLoading ? "Reviews…" : `Reviews${reviewCount ? ` · ${reviewCount}` : ""}`;
  reviewsChip.onclick = () => openReportReviews(reviewsChip);
  if (hpopKind) renderHeadPop();
}

/* ---- the head's two panels: Verbatim and Sources ----------------------------------------------- */
let hpopKind = "";
/** The current edition is a PDF with no web version: say so above everything, with the PDF, and what the text below is. */
function pdfNotice() {
  const p = pdfNow(), L = S.E[S.tl.latest], month = pdfMonth(p);
  return `
    <p class="notice notice--gone" style="--i:1"><span class="tag">PDF only</span><span><strong>The current edition${month ? ` (${esc(month)})` : ""} is published as a PDF only.</strong>
      <a href="${esc(p.pdf_url)}" target="_blank" rel="noopener">Open the current PDF ↗</a>.
      The text below is the last edition held as text, ${esc(vLabel(L))} of ${esc(stopDate(L))}: it is not the current guidance.</span></p>`;
}
/** "PDF differs": shown for an edition whose PDF really differs from the web text (pdf-differences.js). */
function showPdfChip(v) {
  const chip = $("#pdfChip"), says = differsChip(v.pdf_compare);
  chip.hidden = !says;
  if (!says) { if (hpopKind === "pdf") closeHeadPop(); return; }
  const html = `${esc(says.label)}<span class="chip-v${says.flagged ? " is-dead" : ""}">${fmtN(says.count)}</span>`;
  if (chip.innerHTML !== html) chip.innerHTML = html;
  chip.title = says.title;
}
function renderHeadPop() {
  const box = $("#hpop");
  if (!box || !hpopKind) return;
  box.dataset.kind = hpopKind;
  let html;
  if (hpopKind === "pdf") {
    const cmp = S.E[shownEdition()].v.pdf_compare;
    if (!cmp) return closeHeadPop();
    html = differsPanel(cmp, { esc });
  } else if (hpopKind === "verbatim") {
    const E = S.E[shownEdition()], info = verbatimInfo(E), title = publishedTitle(E.v);
    html = `<p class="hpop-head"><span class="tag tag--outline">${info.pdf ? "From the PDF" : "Verbatim"}</span>${info.archived ? '<span class="tag tag--outline">Archived copy</span>' : ""}<span>${esc(vLabel(E))} · ${esc(stopDate(E))}</span></p>
      <p>${info.html}${info.pdf ? "" : " Nothing is reworded: only the layout is ours."}</p>
      ${title ? `<p class="hpop-kv"><span class="eyebrow">Published as</span><span>${esc(title)}</span></p>` : ""}
      <p class="hpop-note">Select any passage to save it with a citation to this edition.</p>`;
  } else {
    const r = S.sources;
    if (!r) return closeHeadPop();
    const checked = r.counts.total - r.counts.unchecked;
    const bits = (checked ? summaryLine(r) : `${fmtN(r.counts.total)} links · not checked yet`).split(" · ");
    html = `<p class="hpop-head"><span class="tag tag--outline">Sources</span><span>Links cited in ${esc(vLabel(S.E[S.C?.e ?? shownEdition()]))}</span></p>
      <ul class="hpop-counts">${bits.map((b) => `<li${/dead/.test(b) ? ' class="is-dead"' : ""}>${esc(b)}</li>`).join("")}</ul>
      <p class="hpop-note">Each link was checked automatically. Dead and moved links are tagged where they appear in the text, with an archived copy where the Internet Archive has one.</p>
      ${r.dead.length && S.V?.kind === "clean" ? `<p><button class="btn" type="button" data-act="next-dead">Next dead link ↓</button></p>` : ""}`;
  }
  if (box.innerHTML !== html) box.innerHTML = html;
}
function openHeadPop(kind) {
  const box = $("#hpop");
  hpopKind = kind;
  renderHeadPop();
  if (!hpopKind) return;
  document.querySelectorAll(".chip[data-hpop]").forEach((c) => c.setAttribute("aria-expanded", String(c.dataset.hpop === kind)));
  box.hidden = false;
  box.classList.remove("is-in"); void box.offsetWidth; box.classList.add("is-in");
}
function closeHeadPop() {
  if (!hpopKind) return false;
  hpopKind = "";
  document.querySelectorAll(".chip[data-hpop]").forEach((c) => c.setAttribute("aria-expanded", "false"));
  const box = $("#hpop");
  if (box) box.hidden = true;
  return true;
}
document.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip[data-hpop]");
  if (chip) { if (hpopKind === chip.dataset.hpop) closeHeadPop(); else openHeadPop(chip.dataset.hpop); return; }
  const diff = e.target.closest("[data-pdf-diff]");
  if (diff) {                                                     // a difference in the PDF panel: go to its place in the text
    const d = S.E[shownEdition()].v.pdf_compare?.differences?.[+diff.dataset.pdfDiff];
    closeHeadPop();
    if (d?.where?.paragraph) goToRef({ dataset: { ref: d.where.paragraph, kind: "paragraph" } });
    else if (d?.where?.heading) goToRef({ dataset: { sec: d.where.heading, secText: d.where.section || "" } });
    return;
  }
  if (hpopKind && !e.target.closest("#hpop")) closeHeadPop();
});
function swapIn(el) {
  if (reduced.matches || !S.ready) return;
  el.animate([{ opacity: 0, filter: "blur(3px)" }, { opacity: 1, filter: "blur(0)" }], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" });
}

/* ================================================================== history band */

let slider = null, asat = null;
const rollers = [];
const stopOf = (e) => S.E[e].k;

function buildHistory(e) {
  const tl = S.tl, eds = tl.editions.length, ups = tl.events.length;
  // Stops for the slider: labels, dates and tooltips.
  tl.stops.forEach((s) => {
    if (s.kind === "edition") {
      const prev = S.E[s.i - 1];
      s.label = vLabel(s);
      // The same version and month as the edition before it: the words changed and the note's own date did not.
      // What tells them apart is when these words were first seen (not the latest capture, which for the live
      // edition is recent and says nothing about when the change was made).
      const again = prev && prev.version === s.version && fmtMonth(prev.t) === fmtMonth(s.t) && firstSeen(s.v);
      s.sub = again ? `seen ${fmtMonth(firstSeen(s.v))}` : fmtMonth(s.t);
      s.first = s.i === 0;
      s.h = s.i === 0 ? 0.55 : 0.16;
    } else {
      s.label = ""; s.sub = fmtMonth(s.t);
    }
    s.long = stopDateLong(s);
    s.tip = tipOf(s);
  });
  $("#histCount").textContent = `${eds} ${eds === 1 ? "edition" : "editions"} held${ups ? ` · ${ups} more GOV.UK ${ups === 1 ? "update" : "updates"}` : ""}`;
  asat = new DateRoller($("#asat"));
  rollers.push(asat);
  slider = S.slider = new HistorySlider($("#rs"), {
    onPaint: paintHistory,
    onCommit: commitStop,
    labels: { asAt: "As at", old: "Old", new: "New" },
  });
  slider.setStops(tl.stops, { today: Date.now() });
  slider.setMode("read", { b: stopOf(e) });
  slider.place(null, stopOf(e));
  buildChangeLog();
  $("#history").hidden = false;
  $("#histToggle").addEventListener("click", () => setHistoryOpen(document.documentElement.classList.contains("hist-closed")));
  setHistoryOpen(!document.documentElement.classList.contains("hist-closed"), { instant: true });
  // "All editions": the full list, on demand (the timeline and the caption already tell the story).
  $("#clogWrap").hidden = tl.stops.length < 2;
  $("#clogBtn").addEventListener("click", () => setClogOpen($("#clogPanel").hidden));
  $("#clog").addEventListener("click", (ev) => {
    const li = ev.target.closest("li[data-k]");
    if (!li || li.classList.contains("is-off")) return;
    setClogOpen(false);
    pickStop(+li.dataset.k);
  });
  document.addEventListener("click", (ev) => { if (!$("#clogPanel").hidden && !ev.target.closest("#clogWrap")) setClogOpen(false); });
  $("#wc").addEventListener("click", (ev) => { if (ev.target.closest(".wc-more")) setCaptionOpen(!$("#wc").classList.contains("is-open")); });
}
function setClogOpen(open) {
  const panel = $("#clogPanel"), btn = $("#clogBtn");
  if (panel.hidden === !open) return;
  panel.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
  if (!open) return;
  panel.classList.remove("is-in"); void panel.offsetWidth; panel.classList.add("is-in");
  const list = $("#clog"), item = list.querySelector("li.is-new");
  if (item) list.scrollTop = Math.max(0, item.offsetTop - (list.clientHeight - item.offsetHeight) / 2);
}

function setHistoryOpen(open, { instant = false } = {}) {
  const root = document.documentElement;
  root.classList.toggle("hist-closed", !open);
  if (instant) { root.classList.add("hist-instant"); requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("hist-instant"))); }
  $("#histToggle").setAttribute("aria-expanded", String(open));
  $("#histToggle .lbl").textContent = open ? "Hide" : "Show";
  $("#histToggle").title = open ? "Hide the history" : "Show the history";
  $("#histBody").inert = !open;
  if (!open) setClogOpen(false);
  try { localStorage.setItem("cpin-history-open", open ? "1" : "0"); } catch {}
  if (open) requestAnimationFrame(() => slider?.cull());
}

/** What changed, for a stop: verbatim statement (or GOV.UK note) as a fragment with references linked. */
function statementNode(stop) {
  const box = document.createElement("div");
  box.className = "wc-text";
  if (stop.kind === "update") {
    const p = document.createElement("p");
    p.append(`“${stop.note}”`);
    box.append(p);
  } else {
    const src = captionSource(stop);
    if (!src) { box.classList.add("none"); box.textContent = "No change statement for this edition."; return box; }
    if (src.kind === "home-office") box.append(cleanStatement(src.html || `<p>${esc(src.text)}</p>`));
    else for (const g of src.notes) {
      const p = document.createElement("p");
      p.append(`“${g.note}”`);
      const d = document.createElement("span");
      d.className = "wc-date"; d.textContent = ` · ${fmtDate(g.date)}`;
      p.append(d);
      box.append(p);
    }
  }
  linkRefs(box);
  if (stop.kind === "edition") linkSections(box, stop);
  return box;
}
const STATEMENT_TAGS = new Set(["P", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD", "CAPTION", "ABBR", "A", "STRONG", "EM", "B", "I", "BR", "SUP", "SUB", "SPAN", "BLOCKQUOTE", "CODE", "DIV"]);
const STATEMENT_ATTRS = new Set(["href", "title", "scope", "colspan", "rowspan"]);
/** The Home Office's change statement as published (paragraphs, lists, tables), minus anything executable. */
function cleanStatement(html) {
  const { fragment } = parseBody(html);
  for (const el of [...fragment.querySelectorAll("*")]) {
    if (!STATEMENT_TAGS.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
    for (const a of [...el.attributes]) if (!STATEMENT_ATTRS.has(a.name)) el.removeAttribute(a.name);
    if (el.tagName === "A") { el.target = "_blank"; el.rel = "noopener"; }
  }
  for (const t of fragment.querySelectorAll("table")) {
    const w = document.createElement("div");
    w.className = "wc-tbl";
    w.tabIndex = 0;
    w.setAttribute("role", "region");
    w.setAttribute("aria-label", "Table from the change statement");
    t.before(w); w.append(t);
  }
  return fragment;
}
/** Section and paragraph numbers in a caption become links into the text shown. */
function linkRefs(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const todo = [];
  for (let t = walker.nextNode(); t; t = walker.nextNode()) if (!t.parentElement.closest("a")) { const refs = findParaRefs(t.data); if (refs.length) todo.push([t, refs]); }
  for (const [t, refs] of todo) {
    const frag = document.createDocumentFragment();
    let at = 0;
    for (const r of refs) {
      frag.append(t.data.slice(at, r.start));
      const a = document.createElement("a");
      a.href = "#"; a.className = "ref"; a.dataset.ref = r.num; a.dataset.kind = r.kind;
      a.title = `Go to ${r.kind} ${r.num} in the text`;
      a.textContent = t.data.slice(r.start, r.end);
      frag.append(a);
      at = r.end;
    }
    frag.append(t.data.slice(at));
    t.replaceWith(frag);
  }
}
const headingCache = new WeakMap();
/** The headings of an edition, read from its stored text: [{ text, level }] (worked out once an edition). */
function headingsOf(v) {
  if (!headingCache.has(v)) {
    const out = [], strip = document.createElement("div");
    for (const m of String(v.body || "").matchAll(/<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
      strip.innerHTML = m[2].replace(/<(?!\/?(?:span|em|strong|b|i|abbr|sup|sub)\b)[^>]*>/gi, "");   // inline tags only: no images or scripts are made
      const text = strip.textContent.replace(/\s+/g, " ").trim();
      if (text) out.push({ text, level: +m[1] });
    }
    headingCache.set(v, out);
  }
  return headingCache.get(v);
}
/** The report's own sections named in an edition's change statement become links to them in the text ("country information", "assessment"). */
function linkSections(root, stop) {
  const headings = headingsOf(stop.v);
  if (!headings.length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const todo = [];
  for (let t = walker.nextNode(); t; t = walker.nextNode()) if (!t.parentElement.closest("a")) { const names = findSectionNames(t.data, headings); if (names.length) todo.push([t, names]); }
  for (const [t, names] of todo) {
    const frag = document.createDocumentFragment();
    let at = 0;
    for (const n of names) {
      frag.append(t.data.slice(at, n.start));
      const a = document.createElement("a");
      a.href = "#"; a.className = "ref"; a.dataset.sec = ""; a.dataset.secText = n.heading;
      a.title = `Go to “${n.heading}” in the text`;
      a.textContent = t.data.slice(n.start, n.end);
      frag.append(a);
      at = n.end;
    }
    frag.append(t.data.slice(at));
    t.replaceWith(frag);
  }
}
/** "the earlier wording" phrased for an edition: its rewrite line, or "" when it is not a rewrite. */
function rewriteLine(i) {
  const sim = S.E[i]?.v.similarity_to_previous;
  if (i < 1 || !isRewrite(sim)) return "";
  const missing = versionsNotHeld(S.E[i - 1].version ?? undefined, S.E[i].version).replace(/ not held$/, "");
  return `Rewritten · ${keptPercent(sim)} of the earlier wording kept${editionsBetweenNotHeld(S.tl, i) ? ` · editions in between not held${missing ? ` (${missing})` : ""}` : ""}`;
}
/** The computed line under a caption: short, and secondary. { html, title (the fuller version, on hover), tag, pending } */
function computedHtml(stop) {
  if (stop.kind === "update") {
    const held = stop.inForce == null ? S.E[0] : S.E[stop.inForce];
    const shown = `${vLabel(held)} (${stopDate(held)})`;
    const w = updateWords(stop);
    const below = stop.inForce == null ? `The earliest edition held, ${esc(shown)}, is shown.` : `${esc(shown)} is shown.`;
    return { tag: w.tag, title: w.why,
      html: w.kind === "pdf" ? `<a href="${esc(stop.pdf.url)}" target="_blank" rel="noopener" title="${esc(stop.pdf.title || "The edition published with this update")}">Open the PDF ↗</a> · ${below}` : below };
  }
  const i = stop.i;
  if (i === 0) return { html: S.E.length > 1 ? "Earliest edition held." : "The only edition held.", title: "There is no earlier edition here to compare it with." };
  const c = computedSummary(S.sums[i]);
  const prev = vLabel(S.E[i - 1]);
  const rw = rewriteLine(i);
  const words = c?.changes ? `<span class="ni">+${fmtN(c.ins)}</span> <span class="nd">−${fmtN(c.del)}</span> words` : "";
  if (rw) {
    return { html: `<b class="rw">${esc(rw.slice(0, 9))}</b>${esc(rw.slice(9))}${words ? ` · ${words}` : ""}`, pending: !c,
      title: `Computed from the two texts: five-word phrases that ${vLabel(stop)} shares with ${prev}.` };
  }
  if (!c) return { html: `Comparing with ${esc(prev)}…`, pending: true };
  if (!c.changes) return { html: `No text changes from ${esc(prev)}.` };
  const top = c.secs[0];
  const detail = [
    c.secs.length ? `Most changed: ${c.secs.map((t) => `${t.text} (${t.count})`).join(", ")}` : "",
    c.noteChanges ? `${fmtN(c.noteChanges)} footnote ${c.noteChanges === 1 ? "change" : "changes"}` : "",
    `+${fmtN(c.ins)} −${fmtN(c.del)} words compared with ${prev}`,
  ].filter(Boolean).join(" · ");
  return { title: detail, html: `${words} <span class="wc-note">vs ${esc(prev)}</span>${top
    ? ` · most changed: <a href="#" class="ref" data-sec="${esc(top.id || "")}" data-sec-text="${esc(top.text)}" title="Go to this section">${esc(truncate(top.text, 52))}</a>` : ""}` };
}
function captionNode(stop, calc = computedHtml(stop)) {
  const wrap = document.createElement("div");
  wrap.className = "wc-in";
  const meta = document.createElement("p");
  meta.className = "wc-meta";
  if (stop.kind === "edition") {
    const src = captionSource(stop);
    const gap = rewriteLine(stop.i) ? "" : versionsNotHeld(S.E[stop.i - 1]?.version ?? undefined, stop.version);
    meta.innerHTML = `<span class="tag">What changed</span><span>in <b>${esc(stop.version ? vLabel(stop) : "this edition")}</b></span>${
      src ? `<span class="tag tag--outline" title="${esc(src.kind === "home-office" ? "Verbatim from the note: “Changes from last version of this note”" : "Verbatim GOV.UK change note")}">${esc(src.label)}</span>` : ""}${
      gap ? `<span class="wc-note">${esc(gap)}</span>` : ""}`;
  } else {
    meta.innerHTML = `<span class="tag">GOV.UK update</span><span class="tag tag--outline" title="Verbatim GOV.UK change note">GOV.UK change note</span>`;
  }
  const box = document.createElement("div");
  box.className = "wc-box";
  const more = document.createElement("button");
  more.type = "button"; more.className = "wc-more"; more.textContent = "More"; more.setAttribute("aria-expanded", "false");
  box.append(statementNode(stop), more);
  const line = document.createElement("p");
  line.className = "wc-calc";
  line.innerHTML = `<span class="tag ${calc.tag ? "tag--muted" : "tag--calc"}">${esc(calc.tag || "Computed")}</span><span class="wc-calc-t"${calc.title ? ` title="${esc(calc.title)}"` : ""}>${calc.html}</span>`;
  wrap.append(meta, box, line);
  wrap.dataset.key = `${stop.k}|${calc.html}`;
  return { node: wrap, pending: calc.pending };
}
/** A statement longer than the caption's fixed height is faded out with a "More" button; nothing moves until it is pressed. */
function fitCaption(node = $("#wc .wc-in:not(.out)")) {
  const text = node?.querySelector(".wc-text");
  if (!text || $("#wc").classList.contains("is-open")) return;
  const clipped = text.scrollHeight > text.clientHeight + 2 || [...text.querySelectorAll(".wc-tbl")].some((t) => t.scrollHeight > t.clientHeight + 2);
  node.classList.toggle("is-clipped", clipped);
}
/** Open or close a long caption: its height eases; the rest of the page follows (the reader asked for it). */
function setCaptionOpen(open) {
  const box = $("#wc");
  if (box.classList.contains("is-open") === open) return;
  const h0 = box.offsetHeight;
  box.classList.toggle("is-open", open);
  const h1 = box.offsetHeight;
  box.querySelectorAll(".wc-more").forEach((b) => { b.textContent = open ? "Less" : "More"; b.setAttribute("aria-expanded", String(open)); });
  if (!open) box.querySelectorAll(".wc-text, .wc-tbl").forEach((x) => { x.scrollTop = 0; });
  if (!reduced.matches && Math.abs(h1 - h0) > 1 && document.visibilityState === "visible") {
    box.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: 300, easing: EASE });
  }
}
let wcKey = "", wcStop = -1;
const EASE = "cubic-bezier(.2,.8,.2,1)";
function updateCaption(k, { force = false } = {}) {
  const stop = S.tl.stops[k];
  if (!stop) return;
  const calc = computedHtml(stop);
  if (!force && `${stop.k}|${calc.html}` === wcKey) return;          // called every frame while a handle moves
  const { node, pending } = captionNode(stop, calc);
  const sameStop = wcStop === k;
  wcKey = node.dataset.key; wcStop = k;
  const box = $("#wc");
  if (!sameStop) setCaptionOpen(false);                             // a caption opened with "More" closes when the stop changes
  box.querySelectorAll(".wc-in.out").forEach((x) => x.remove());
  const old = box.querySelector(".wc-in");
  box.append(node);
  fitCaption(node);
  if (box.classList.contains("is-open")) node.querySelector(".wc-more").textContent = "Less";
  if (pending && S.engine) S.engine.diff(stop.i - 1, stop.i).then(() => { if (wcStop === k) updateCaption(k); }).catch(() => {});
  if (!old) return;
  if (reduced.matches || !S.ready) { old.remove(); return; }
  old.classList.add("out");
  node.animate([{ opacity: 0, filter: "blur(4px)" }, { opacity: 1, filter: "blur(0px)" }], { duration: 260, delay: 40, easing: EASE, fill: "backwards" });
  const settle = () => {
    if (!old.isConnected) return;
    const h0 = box.offsetHeight; old.remove(); const h1 = box.offsetHeight;
    if (Math.abs(h1 - h0) > 1 && document.visibilityState === "visible") box.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: 240, easing: EASE });
  };
  old.animate([{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(4px)" }], { duration: 230, easing: EASE, fill: "forwards" }).finished.then(settle, settle);
  setTimeout(settle, 600);
}
function tipOf(s) {
  if (s.kind === "update") return `${stopDate(s)} · GOV.UK update · ${updateWords(s).facts}\n“${truncate(s.note, 140)}”`;
  const i = s.i;
  const kept = (s.v.source === "wayback" || isArchivedPdf(s.v)) && capturedAt(s.v) ? ` · archived ${fmtDate(capturedAt(s.v))}` : "";
  const cap = `${s.v.source === "pdf" ? " · text from the PDF" : ""}${kept}`;
  const size = i === 0 ? (S.E.length > 1 ? " · earliest edition held" : " · only edition held")
    : isRewrite(s.v.similarity_to_previous) ? ` · rewritten, ${keptPercent(s.v.similarity_to_previous)} of the wording kept`
    : S.sizes[i] == null ? " · comparing…" : S.sizes[i] ? ` · ${fmtN(S.sizes[i])} words changed` : " · no text changes";
  const src = captionSource(s);
  const said = src?.kind === "home-office" ? `“${truncate(src.text || "", 140)}” (Home Office)` : src?.notes?.length ? `“${truncate(src.notes[0].note, 140)}” (GOV.UK)` : "No change statement.";
  return `${vLabel(s)} · ${stopDate(s)}${cap}${size}\n${said}`;
}
function buildChangeLog() {
  const items = S.tl.stops.slice().reverse().map((s) => {
    const k = s.k;
    if (s.kind === "update") {
      const w = updateWords(s);
      // The row is a button (it shows the edition then in force), so a PDF's link sits beside it, not inside it.
      return `<li data-k="${k}" class="is-ev${s.pdf ? " has-pdf" : ""}"><button type="button" aria-label="${esc(`GOV.UK update, ${s.long}: ${s.note}. ${capFirst(w.facts)}.`)}"><span class="cl-v" aria-hidden="true">◇</span>
        <span class="cl-m"><span>${esc(stopDate(s))}</span><span class="tag tag--muted" title="${esc(w.why)}">${esc(w.tag)}</span></span><span class="cl-t">${esc(s.note)}</span></button>${
        s.pdf ? `<a class="cl-pdf" href="${esc(s.pdf.url)}" target="_blank" rel="noopener" title="${esc(s.pdf.title || "Open the PDF")}">Open the PDF ↗</a>` : ""}</li>`;
    }
    const src = captionSource(s), gap = versionsNotHeld(S.E[s.i - 1]?.version ?? undefined, s.version);
    const text = src?.kind === "home-office" ? src.text : src?.notes?.[0]?.note || "";
    return `<li data-k="${k}"><button type="button" aria-label="${esc(`${vLabel(s)}, ${s.long}${text ? `: ${text}` : ""}. Show this edition.`)}"><span class="cl-v">${esc(vLabel(s))}</span>
      <span class="cl-m"><span>${esc(stopDate(s))}</span>${src ? `<span class="tag tag--outline">${src.kind === "home-office" ? "Home Office" : "GOV.UK"}</span>` : ""}${
        sourceWords(s.v).split(" · ").filter(Boolean).map((w) => `<span>${esc(w)}</span>`).join("")}${
        s.v.left_govuk ? `<span title="${esc(leftGovuk(s.v.left_govuk, fmtDate).sentence)}">${esc(leftGovuk(s.v.left_govuk, fmtDate).label.replace(/^A/, "a"))}</span>` : ""}${isRewrite(s.v.similarity_to_previous) ? `<span>rewritten, ${esc(keptPercent(s.v.similarity_to_previous))} kept</span>` : `<span class="cl-n" data-i="${s.i}"></span>`}${gap ? `<span>${esc(gap)}</span>` : ""}</span>
      ${text ? `<span class="cl-t">${esc(text)}</span>` : `<span class="cl-t none">No change statement.</span>`}</button></li>`;
  });
  $("#clog").innerHTML = items.join("");
  updateChangeLogSizes();
}
function updateChangeLogSizes() {
  $("#clog").querySelectorAll(".cl-n").forEach((el) => {
    const i = +el.dataset.i;
    el.textContent = i && S.sizes[i] != null ? (S.sizes[i] ? `${fmtN(S.sizes[i])} words changed` : "no text changes") : "";
  });
}
let clogB = -1;
function paintChangeLog(a, b) {
  const list = $("#clog");
  list.querySelectorAll("li").forEach((li) => {
    const k = +li.dataset.k;
    li.classList.toggle("in-range", S.mode === "changes" && k > a && k <= b);
    li.classList.toggle("is-new", k === b);
    li.classList.toggle("is-old", S.mode === "changes" && k === a);
    li.classList.toggle("is-off", S.mode === "changes" && li.classList.contains("is-ev"));
  });
  if (b === clogB) return;
  clogB = b;
  const item = list.querySelector(`li[data-k="${b}"]`);
  if (!item || list.clientHeight === 0) return;
  const top = item.offsetTop, bottom = top + item.offsetHeight;
  if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) {
    list.scrollTo({ top: Math.max(0, top - (list.clientHeight - item.offsetHeight) / 2), behavior: reduced.matches ? "auto" : "smooth" });
  }
}

/** Every frame while a handle moves: the rolling date, the caption, the change log. */
function paintHistory({ a, b, active, t, stop, instant }) {
  if (!stop) return;
  asat.set(t, instant || !S.ready, stop.prec === "month");
  const from = active === "a";
  $("#asatLabel").textContent = from ? "From" : "As at";
  $("#asatLabel").classList.toggle("is-from", from);
  // The caption, change log and spoken summary follow once a stop has been nearest for a moment, so a
  // handle sweeping past several stops (a long drag, a glide across the timeline) does not churn through captions.
  clearTimeout(captionTimer);
  const settle = () => {
    const B = S.tl.stops[b];
    $("#asatSr").textContent = B ? `${S.mode === "changes" && S.tl.stops[a] ? `Comparing ${vLabel(S.tl.stops[a])} with ` : "As at "}${B.label ? `${B.label}, ` : ""}${B.long}.` : "";
    $("#histMini").textContent = B ? `As at ${stopDate(B)}${B.label ? ` · ${B.label}` : ""}` : "";
    updateCaption(from ? a : b);
    paintChangeLog(a, b);
  };
  if (instant || !S.ready || wcKey === "") settle(); else captionTimer = setTimeout(settle, 90);
}
let captionTimer = 0;

/** A handle came to rest on a stop. */
function commitStop({ a, b }) {
  if (S.mode === "read") {
    const e = editionForStop(S.tl.stops[b], S.tl);
    if (!S.C || S.C.e !== e || S.V.kind !== "clean") showEdition(e);
    else afterShow();
  } else {
    const A = S.tl.stops[a], B = S.tl.stops[b];
    if (A?.kind === "edition" && B?.kind === "edition") loadPair(A.i, B.i);
  }
}

/** Pick a stop from the change log: show it (reading) or compare it with the edition before (changes). */
async function pickStop(k) {
  const s = S.tl.stops[k];
  if (S.mode === "read") { await slider.moveTo("b", k, 320); return; }
  if (s.kind !== "edition") return;
  if (s.i === 0) { await slider.glide("b", stopOf(1), 320); await slider.glide("a", k, 320); slider.commit(true); return; }
  const prev = stopOf(s.i - 1);
  if (k > slider.b) { await slider.glide("b", k, 320); await slider.glide("a", prev, 320); }
  else { await slider.glide("a", prev, 320); await slider.glide("b", k, 320); }
  slider.commit(true);
}

/* ================================================================== the clean edition */

const BLOCKISH = new Set(["UL", "OL", "TABLE", "TBODY", "THEAD", "TFOOT", "TR", "DIV", "SECTION", "BLOCKQUOTE", "FIGURE"]);

/** An edition's verbatim body as a detached element, with presentation only (images, links, paragraph numbers). */
function buildBody(e) {
  const E = S.E[e];
  const { root } = parseBody(E.v.body);
  let gs = root;
  if (gs.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    const d = document.createElement("div");
    d.className = "govspeak";
    d.append(gs);
    gs = d;
  }
  const fnBox = gs.querySelector(".footnotes");
  if (fnBox && !fnBox.id) fnBox.id = "footnotes";
  gs.querySelectorAll("h2, h3").forEach((h, i) => { if (!h.id) h.id = `section-${i + 1}`; });
  const A = analyseBody(gs);                     // offsets into the verbatim text, before any presentation
  placePdfFigures(gs, E.v.pdf_figures, S.series.images || {});   // pictures only the PDF has: beside the text, never in it
  internalLinks(gs);
  presentation(gs, A);
  return { gs, A };
}
/** Build an edition's verbatim body, detached, ready to mount. */
function buildClean(e) {
  const { gs, A } = buildBody(e);
  const doc = $("#doc");
  const fs = parseFloat(getComputedStyle(doc).fontSize) || 17;
  const width = Math.max(280, (doc.clientWidth || 700) - parseFloat(getComputedStyle(doc).paddingLeft || 0));
  chunk(gs, { fs, width });
  const ix = new TextIndex(gs).ensure();
  if (ix.text !== A.text) console.warn("reader: text changed during presentation");
  return { e, root: gs, A, ix, text: ix.text, normalized: null, fresh: true, linkCounts: null };
}

function internalLinks(root) {
  repairAnchors(root);
  if (!S.data?.note_paths) return;
  linkToHeldNotes(root, {
    notePaths: S.data.note_paths, countryPaths: S.data.country_paths || {},
    makeNoteUrl: (held, hash) => {
      const latest = held.status === "live";
      return `index.html?country=${encodeURIComponent(held.country)}&series=${encodeURIComponent(held.series).replace(/%3A/gi, ":")}${latest ? "" : `&note=${encodeURIComponent(held.note)}`}${hash || ""}`;
    },
    makeCountryUrl: (slug) => `../dashboard/index.html#${encodeURIComponent(slug)}`,
  });
}

/** Presentation only: images from the mirror, links, paragraph numbers, table scrollers. */
function presentation(gs, A) {
  const images = S.series.images || {};
  for (const img of gs.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    const hit = images[src] || images[src.replace(/^\/\//, "https://")];
    if (hit) { img.dataset.govuk = src; img.setAttribute("src", hit); }
    imgLoad(img);
  }
  for (const a of gs.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (href.startsWith("#") || a.dataset.govukHref) continue;
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
  // Paragraph numbers: "3.4.1 Text" -> the number hangs in the margin, as printed (same text, one extra span).
  for (const { el: p, num, lead } of A.paras) {
    p.dataset.para = num;
    p.classList.add("np");
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let t = walker.nextNode();
    while (t && !t.data.trim()) t = walker.nextNode();
    if (!t) continue;
    const at = t.data.indexOf(lead);
    if (at < 0 || t.data.slice(0, at).trim()) continue;
    if (at > 0) t = t.splitText(at);
    t.splitText(lead.length);
    const span = document.createElement("span");
    span.className = "pnum";
    t.replaceWith(span);
    span.append(t);
  }
  // Odd spaces evened out, typed enumerators hung, quoted runs ruled: classes and spans only, same characters.
  formatDisplay(gs);
}
function imgLoad(img) {
  img.loading = "lazy";
  img.decoding = "async";
  const done = () => img.classList.add("loaded");
  if (img.complete && img.naturalWidth) done();
  img.addEventListener("load", done, { once: true });
  img.addEventListener("error", done, { once: true });
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
  for (const b of gs.children) {
    let h = 0;
    for (const el of b.children) {
      if (/^H[2-6]$/.test(el.tagName)) h += lineH * 1.6 + fs * 2.4;
      else if (el.matches(".footnotes")) h += el.querySelectorAll("li").length * fs * 0.86 * 1.55 * 2.2 + 80;
      else if (el.matches(".tbl-scroll, table")) h += el.querySelectorAll("tr").length * fs * 2.3 + 40;
      else if (el.querySelector("img")) h += 420;
      else {
        const items = el.querySelectorAll("li").length;
        h += Math.ceil((el.textContent || "").trim().length / perLine + items * 0.4) * lineH + fs * 1.05;
      }
    }
    b.style.containIntrinsicSize = `auto ${Math.max(40, Math.round(h))}px`;
  }
}

/**
 * Show edition e clean (time travel when it is not the latest). The reading place is kept: the same
 * paragraph number or heading stays at the same height on screen.
 */
function showEdition(e, { initial = false, mount = true } = {}) {
  closePop(); hideTool();
  const anchor = !initial && mount ? captureAnchor() : null;
  if (!S.C || S.C.e !== e) {
    if (S.C) { for (const id of [...S.marks.keys()]) S.marks.delete(id); S.checks.clear(); }
    S.C = buildClean(e);
  }
  if (!mount) { placeAllIfFresh(); return; }
  mountClean();
  restoreAnchor(anchor);
  if (!initial && !reduced.matches) $("#doc").animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 280, easing: EASE });
}
function placeAllIfFresh() {
  if (!S.C.fresh) return;
  S.C.fresh = false;
  for (const rec of seriesRecords()) place(rec);
}
function mountClean() {
  const doc = $("#doc");
  doc.classList.remove("is-redline", "is-sbs", "is-pair");
  doc.classList.toggle("is-entered", S.ready);          // the lift-in is for arriving; changing edition only crossfades
  $("#reader").classList.remove("is-sbs");
  doc.replaceChildren(S.C.root);
  doc.removeAttribute("aria-busy");
  S.V = { kind: "clean", root: S.C.root, ix: S.C.ix, sections: S.C.A.sections, targets: null };
  S.redline = null; S.rewrite = null;
  fullSha(S.E[S.C.e]);
  placeAllIfFresh();
  decorateView();
  decorateReviews();
  afterShow();
}
/** Everything that follows the text shown: contents, rail, head, bar, notes, find, address. */
function afterShow() {
  $("#reader").classList.toggle("is-notice", S.V?.kind === "notice");
  renderToc();
  renderRail();
  updateCounts();
  updateHead();
  updateBar();
  updateEditionNote();
  if (F.q) runFind(F.q, { jump: false });
  if (S.ready) syncUrl();
  refreshMinimap();
}

/* ---- keeping the reader's place across editions and views -------------------------------------- */
const PARA_EXCLUDE = "table, .footnotes, li, blockquote, .info-notice, .call-to-action, .application-notice, .sbs-cell.old";
/** Text at the start of an element, leaving out deleted words (redline) and display tags. */
function leadText(el, n = 48) {
  let out = "";
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (x) => (x.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT : x.tagName === "DEL" || SKIP_UI(x) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP),
  });
  for (let t = w.nextNode(); t && out.length < n; t = w.nextNode()) out += t.data;
  return out;
}
/** Numbered headings and paragraphs of the text shown, in document order: [{ num, kind, el, text }]. */
function viewTargets() {
  if (S.V.targets) return S.V.targets;
  const out = [];
  for (const el of S.V.root.querySelectorAll("h2, h3, h4, h5, h6, p")) {
    if (el.closest(PARA_EXCLUDE) || el.closest("del")) continue;
    const isH = el.tagName !== "P";
    const lead = leadText(el);
    const num = isH ? leadingNumber(lead, { heading: true }) : el.dataset.para || leadingNumber(lead);
    if (!num && !isH) continue;
    out.push({ num, kind: isH ? "h" : "p", el, text: isH ? el.textContent.replace(/\s+/g, " ").trim().toLowerCase() : "" });
  }
  return (S.V.targets = out);
}
function captureAnchor() {
  if (!S.V?.root?.isConnected) return null;
  const line = headOffset() + 8;
  if (S.V.root.getBoundingClientRect().top > line) return null;      // still reading the head or the history
  const ts = viewTargets();
  if (!ts.length) return null;
  let lo = 0, hi = ts.length - 1, found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid].el.getBoundingClientRect().top <= line) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const t = ts[found];
  return { num: t.num, kind: t.kind, text: t.text, top: t.el.getBoundingClientRect().top };
}
function restoreAnchor(a) {
  if (!a) return;
  const ts = viewTargets();
  const hit = ts.find((t) => t.kind === a.kind && (a.num ? t.num === a.num : t.text === a.text))
    || (a.num ? ts.find((t) => t.num === a.num) : null);
  if (!hit) return;
  warm(hit.el);
  const go = () => scrollTo({ top: Math.max(0, scrollY + hit.el.getBoundingClientRect().top - a.top), behavior: "instant" });
  go();
  requestAnimationFrame(go);
}

/* ================================================================== changes (redline) */

function ensureEngine() {
  if (S.engine) return S.engine;
  const engine = S.engine = new RedlineEngine();
  engine.onResult = (a, b, r) => {
    if (b !== a + 1) return;
    S.sizes[b] = r.stats.ins + r.stats.del;
    S.sums[b] = { stats: r.stats, toc: r.toc.map(({ text, count, st, level, id }) => ({ text, count, st, level, id })) };
    updateBars();
    if (wcStop === S.E[b].k) updateCaption(wcStop, { force: true });
  };
  engine.init(S.E.map((x) => x.v.body), S.series.images || {});
  return engine;
}
/** In the background: each edition against the one before (sizes the bars, readies the captions). */
function warmEngine() {
  if (S.E.length < 2) return;
  const engine = ensureEngine();
  for (let i = S.E.length - 1; i >= 1; i--) engine.diff(i - 1, i).catch(() => {});
}
function updateBars() {
  const known = S.sizes.filter(Number.isFinite), max = Math.max(1, ...known);
  for (const E of S.E) {
    if (E.i === 0) continue;
    E.h = S.sizes[E.i] == null ? 0.16 : Math.max(0.04, Math.sqrt(S.sizes[E.i] / max));
    E.tip = tipOf(E);
  }
  slider.refresh();
  updateChangeLogSizes();
}

let pairTok = 0, pairDone = Promise.resolve();
/** Show the redline between editions a and b (computed in the worker; cached pairs return at once). */
function loadPair(a, b, { initial = false } = {}) {
  const tok = ++pairTok;
  const run = (async () => {
    closePop(); hideTool();
    S.pair = { a, b };
    // A rewrite keeps so little wording that a redline marks almost everything: say so, and offer the two
    // editions side by side instead (the reader's choice is remembered for the session).
    const sim = pairSimilarity(a, b);
    S.rewrite = isRewrite(sim) ? { a, b, sim, view: rewriteChoice || "notice" } : null;
    updateHead(); updateBar();
    if (S.rewrite && S.rewrite.view !== "redline") {
      setBusy(false);
      const anchor = initial || S.V?.kind === "notice" ? null : captureAnchor();
      if (S.rewrite.view === "pair") paintPair(a, b); else paintRewriteNotice(a, b);
      restoreAnchor(anchor);
      if (!initial && !reduced.matches) $("#doc").animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 280, easing: EASE });
      return;
    }
    const engine = ensureEngine();
    let res = engine.cached(a, b);
    if (!res) {
      setBusy(true, 0, "Comparing");
      try {
        res = await engine.diff(a, b, { priority: true, onProgress: (phase, f) => { if (tok === pairTok) setBusy(true, f, phase); } });
      } catch (err) {
        if (tok === pairTok) { setBusy(false); toast(`The comparison failed: ${err?.message || err}`); }
        return;
      }
      if (tok !== pairTok) return;
      setBusy(false);
    }
    if (S.mode !== "changes") return;
    const anchor = initial || S.V?.kind === "notice" ? null : captureAnchor();
    paintRedline(a, b, res);
    restoreAnchor(anchor);
    if (!initial && !reduced.matches) $("#doc").animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 280, easing: EASE });
  })();
  pairDone = run;
  return run;
}
function setBusy(on, f = 0, phase = "") {
  $("#bar").classList.toggle("is-busy", on);
  $("#doc").classList.toggle("is-busy", on);
  $("#busyBar").style.setProperty("--f", on ? Math.max(0.04, Math.min(1, f)).toFixed(3) : 1);
  if (on) $("#pos").textContent = `${phase || "Comparing"}… ${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
}
const effectiveView = () => (narrow.matches ? "inline" : S.view);
function sbsHead(a, b) {
  const A = S.E[a], B = S.E[b];
  const lab = (E) => `<b>${esc(vLabel(E))}</b> · ${esc(stopDate(E))}${E.v.source === "wayback" || isArchivedPdf(E.v) ? " · archived copy" : ""}`;
  return `<div class="sbs-head"><span><span class="tag tag--outline">Old</span>${lab(A)}</span><span><span class="tag">New</span>${lab(B)}</span></div>`;
}
function paintRedline(a, b, res) {
  const doc = $("#doc"), view = effectiveView();
  const wrap = document.createElement("div");
  wrap.className = `rl rl--${view}`;
  wrap.innerHTML = view === "sbs" ? `<div class="sbs">${sbsHead(a, b)}${res.sbsHtml}</div>` : res.inlineHtml;
  repairAnchors(wrap);
  internalLinks(wrap);
  wrap.querySelectorAll("img").forEach(imgLoad);
  formatDisplay(wrap, view === "sbs" ? { sides: ["old", "new"] } : { skip: { new: "DEL" } });   // inline: read as the newer text
  doc.classList.add("is-redline");
  doc.classList.remove("is-pair");
  doc.classList.toggle("is-sbs", view === "sbs");
  $("#reader").classList.toggle("is-sbs", view === "sbs");
  doc.replaceChildren(wrap);
  doc.removeAttribute("aria-busy");
  S.redline = { a, b, res };
  const sections = [];
  for (const s of res.toc) {
    if (s.level > 3) continue;
    sections.push({ id: s.id, title: s.text, level: s.level, st: s.st, count: s.count,
      el: s.st === "del" ? null : wrap.querySelector(`#${CSS.escape(s.id)}`), at: null });
  }
  S.V = { kind: "redline", root: wrap, ix: null, sections, targets: null };
  S.hunks = new Map();
  for (const el of wrap.querySelectorAll("[data-chg]")) {
    const k = +el.dataset.chg;
    if (!S.hunks.has(k)) S.hunks.set(k, []);
    S.hunks.get(k).push(el);
  }
  if (S.cur >= res.stats.changes) S.cur = -1;
  renderStats(res.stats);
  decorateView();
  afterShow();
  markCurrent(false);
}
/* ---- rewrites: a notice, then the two editions side by side (unmarked) or the redline anyway ------------------ */
const REWRITE_VIEW_KEY = "cpin-rewrite-view";
let rewriteChoice = (() => { try { const v = sessionStorage.getItem(REWRITE_VIEW_KEY); return v === "pair" || v === "redline" ? v : null; } catch { return null; } })();
const pairSims = new Map();
/** How much of edition a's wording edition b keeps: the export's figure for consecutive editions, else computed here. */
function pairSimilarity(a, b) {
  const known = S.E[b].v.similarity_to_previous;
  if (b === a + 1 && typeof known === "number") return known;
  const k = `${a}:${b}`;
  if (!pairSims.has(k)) pairSims.set(k, phrasesShared(editionPhrases(a), editionPhrases(b)));
  return pairSims.get(k);
}
// An edition's phrases are worked out once and the last few kept (each Set is a few megabytes), so
// moving one handle across several editions re-reads only the edition that changed.
const phraseSets = new Map();
function editionPhrases(i) {
  let set = phraseSets.get(i);
  if (set) phraseSets.delete(i);                         // re-inserted below: most recently used last
  else set = phrasesOf(S.E[i].v.body);
  phraseSets.set(i, set);
  while (phraseSets.size > 4) phraseSets.delete(phraseSets.keys().next().value);
  return set;
}
function chooseRewriteView(view) {
  rewriteChoice = view;
  try { sessionStorage.setItem(REWRITE_VIEW_KEY, view); } catch {}
  if (S.mode === "changes" && S.pair) loadPair(S.pair.a, S.pair.b);
}
const edName = (E) => (E.version ? `v${E.version}` : `the ${stopDate(E)} edition`);
function paintRewriteNotice(a, b) {
  const doc = $("#doc"), A = S.E[a], B = S.E[b], rw = S.rewrite;
  const between = b === a + 1 && editionsBetweenNotHeld(S.tl, b);
  const wrap = document.createElement("div");
  wrap.className = "rw-notice";
  wrap.innerHTML = `<span class="tag tag--outline">Rewrite</span>
    <p class="rw-title">${esc(B.version ? edName(B) : capFirst(edName(B)))} is a rewrite of ${esc(edName(A))} (${esc(keptPercent(rw.sim))} of the wording kept), so a redline would mark almost everything.</p>
    <p class="rw-sub">${esc(stopDate(A))} → ${esc(stopDate(B))}${between ? " · editions in between not held" : ""}</p>
    <div class="rw-actions">
      <button class="btn btn--primary" type="button" data-act="rw-pair">Read them side by side</button>
      <button class="btn" type="button" data-act="rw-redline">Show the redline anyway</button>
    </div>
    <p class="rw-foot"><span class="tag tag--calc">Computed</span><span>From the two texts: the share of five-word phrases they have in common. Your choice is kept for this visit.</span></p>`;
  doc.classList.remove("is-redline", "is-sbs", "is-pair");
  $("#reader").classList.remove("is-sbs");
  doc.replaceChildren(wrap);
  doc.removeAttribute("aria-busy");
  S.redline = null; S.hunks = new Map(); S.cur = -1;
  S.V = { kind: "notice", root: wrap, ix: null, sections: [], targets: null };
  afterShow();
  markCurrent(false);
}

let pairShow = "new";                                 // phones: which edition of a side-by-side pair is on screen
/**
 * Two editions side by side, clean: no marks. The newer one scrolls with the page; the older sits in a pane
 * beside it that follows. Where the two share a heading the sections meet at the top of the screen, and
 * between shared headings the pane moves in proportion, so both always show text. Phones show one edition
 * at a time, with a switch that keeps the reader in the same section.
 */
function paintPair(a, b) {
  const doc = $("#doc"), A = S.E[a], B = S.E[b];
  const oldGs = buildBody(a).gs, newGs = buildBody(b).gs;
  // The older edition's ids are prefixed so the two texts' anchors and footnotes stay apart.
  oldGs.querySelectorAll("[id]").forEach((el) => { el.id = `old-${el.id}`; });
  oldGs.querySelectorAll('a[href^="#"]').forEach((el) => el.setAttribute("href", `#old-${el.getAttribute("href").slice(1)}`));
  const fs = parseFloat(getComputedStyle(doc).fontSize) || 17;
  const width = Math.max(280, Math.min(66 * fs * 0.5, (($("#reader .center").clientWidth || 1200) - 32) / 2 - 64));
  chunk(oldGs, { fs, width });
  chunk(newGs, { fs, width });
  // Headings the two share, in order. Each starts a chunk, whose top is where the heading sits.
  const heads = (gs) => [...gs.querySelectorAll(":scope > .cv > h2:first-child, :scope > .cv > h3:first-child")].map((el) => ({ box: el.parentElement, key: headingKey(el.textContent) }));
  const oh = heads(oldGs), nh = heads(newGs);
  const links = alignHeadings(oh.map((h) => h.key), nh.map((h) => h.key)).map(([i, j]) => ({ o: oh[i].box, n: nh[j].box }));
  const wrap = document.createElement("div");
  wrap.className = "rl pv";
  wrap.dataset.show = pairShow;
  const lab = (E) => `<b>${esc(vLabel(E))}</b> · ${esc(stopDate(E))}${E.v.source === "wayback" || isArchivedPdf(E.v) ? " · archived copy" : ""}`;
  wrap.innerHTML = `<div class="sbs">
    <div class="sbs-head"><span><span class="tag tag--outline">Old</span>${lab(A)}</span><span><span class="tag">New</span>${lab(B)}</span></div>
    <div class="pv-switch" role="radiogroup" aria-label="Which edition to read">
      <button type="button" role="radio" data-show="old" aria-checked="${pairShow === "old"}"><span class="tag tag--outline">Old</span><b>${esc(vLabel(A))}</b><span>${esc(fmtMonth(A.t))}</span></button>
      <button type="button" role="radio" data-show="new" aria-checked="${pairShow === "new"}"><span class="tag">New</span><b>${esc(vLabel(B))}</b><span>${esc(fmtMonth(B.t))}</span></button></div>
    <div class="pv-cols"><div class="pv-pane"><div class="sbs-cell old"></div></div><div class="sbs-cell new"></div></div></div>`;
  const pane = wrap.querySelector(".pv-pane"), oldCell = wrap.querySelector(".sbs-cell.old"), newCell = wrap.querySelector(".sbs-cell.new");
  oldCell.append(oldGs);
  newCell.append(newGs);
  doc.classList.remove("is-redline");
  doc.classList.add("is-sbs", "is-pair");
  $("#reader").classList.add("is-sbs");
  doc.replaceChildren(wrap);
  doc.removeAttribute("aria-busy");
  S.redline = null; S.hunks = new Map(); S.cur = -1;
  const sections = [...newCell.querySelectorAll("h2, h3")].filter((h) => h.id)
    .map((h) => ({ id: h.id, title: h.textContent.replace(/\s+/g, " ").trim(), level: +h.tagName[1], st: null, count: 0, el: h, at: null }));
  S.V = { kind: "pair", root: wrap, ix: null, sections, targets: null, pair: { pane, oldCell, newCell, links } };
  // A much shorter newer edition would drag the older pane past at many times the page's speed: give the page
  // room to scroll (blank below the newer text), so the pane never moves at more than about three times it.
  newCell.style.minHeight = `${Math.round(oldCell.offsetHeight / 3)}px`;
  pairWatch ||= new ResizeObserver(() => queuePairSync());
  pairWatch.disconnect();
  pairWatch.observe(oldCell); pairWatch.observe(newCell);
  decorateView();
  afterShow();
  markCurrent(false);
  syncPair();
}
let pairWatch = null, pairQueued = false;
const pairOf = () => (S.V?.kind === "pair" && S.V.pair?.pane.isConnected ? S.V.pair : null);
const pairLinked = (P) => getComputedStyle(P.pane).position === "sticky";      // side by side (not phones)
/** Where each shared heading sits: [down the newer text, down the older text], from the start to the end of both. */
function pairPoints(P) {
  const nb = P.newCell.getBoundingClientRect(), ob = P.oldCell.getBoundingClientRect(), view = P.pane.clientHeight;
  const pts = [[0, 0]];
  for (const l of P.links) pts.push([l.n.getBoundingClientRect().top - nb.top, l.o.getBoundingClientRect().top - ob.top]);
  pts.push([Math.max(0, nb.height - view), Math.max(0, ob.height - view)]);
  return increasing(pts);
}
/** The older pane follows the page: called on scroll and whenever either text changes height. */
function syncPair() {
  pairQueued = false;
  const P = pairOf();
  if (!P || !pairLinked(P)) return;
  const y = P.pane.getBoundingClientRect().top - P.newCell.getBoundingClientRect().top;       // how far into the newer text the top of the pane is
  const to = Math.round(mapThrough(pairPoints(P), y));
  if (Math.abs(P.pane.scrollTop - to) >= 1) P.pane.scrollTop = to;
}
function queuePairSync() {
  if (pairQueued || !pairOf()) return;
  pairQueued = true;
  requestAnimationFrame(syncPair);
}
addEventListener("scroll", queuePairSync, { passive: true });
addEventListener("resize", queuePairSync);
const inOldPane = (node) => { const P = pairOf(); return !!P && !!node && P.pane.contains(node) && pairLinked(P); };
/** For gliding to a place in the older pane: the rectangle the page would have to bring to the top for the pane
 *  (which follows the page) to show it. */
function oldPaneRect(getRect) {
  const P = pairOf(), r = getRect();
  if (!P || !r) return r;
  const back = increasing(pairPoints(P).map(([n, o]) => [o, n]));
  const o = Math.max(0, r.top - P.oldCell.getBoundingClientRect().top - 28);                   // a little below the pane's top
  const stick = parseFloat(getComputedStyle(P.pane).top) || 0;
  const pageY = P.newCell.getBoundingClientRect().top + scrollY + mapThrough(back, o) - stick;
  return { top: pageY - scrollY + headOffset(), height: 0 };
}
/** Phones: swap the edition on screen, keeping the reader in the same section (through the shared headings). */
function setPairShow(side) {
  const P = pairOf();
  if (!P || side === pairShow) return;
  const wrap = S.V.root, line = headOffset() + 8;
  const [fromCell, toCell] = side === "old" ? [P.newCell, P.oldCell] : [P.oldCell, P.newCell];
  const [fromKey, toKey] = side === "old" ? ["n", "o"] : ["o", "n"];
  const tops = (cell, key) => { const t = cell.getBoundingClientRect(); return [0, ...P.links.map((l) => l[key].getBoundingClientRect().top - t.top), t.height]; };
  const linked = pairLinked(P);
  const y = line - fromCell.getBoundingClientRect().top, from = linked ? null : tops(fromCell, fromKey);
  pairShow = side;
  wrap.dataset.show = side;
  wrap.querySelectorAll(".pv-switch button").forEach((x) => x.setAttribute("aria-checked", String(x.dataset.show === side)));
  S.V.ix = null; S.V.targets = null; F.foldedFor = null;
  for (const s of S.V.sections) s.at = null;
  if (from && y > 0) {
    const to = tops(toCell, toKey);
    const at = mapThrough(increasing(from.map((x, i) => [x, to[i]])), y);
    scrollTo({ top: Math.max(0, scrollY + toCell.getBoundingClientRect().top + at - line), behavior: "instant" });
  }
  if (F.q) runFind(F.q, { jump: false });
  refreshMinimap();
}

function renderStats(st) {
  rIns.set(st.ins, !S.ready); rDel.set(st.del, !S.ready); rChg.set(st.changes, !S.ready);
  $("#chgWord").textContent = st.changes === 1 ? "change" : "changes";
  $("#statsSr").textContent = `${st.ins} words inserted, ${st.del} words deleted, ${st.changes} ${st.changes === 1 ? "change" : "changes"}.`;
}
function markCurrent(pulse) {
  const n = S.redline?.res.stats.changes || 0;
  $("#doc").querySelectorAll(".chg.is-current").forEach((x) => { if (+x.dataset.chg !== S.cur) x.classList.remove("is-current", "pulse"); });
  const els = S.cur > -1 ? S.hunks.get(S.cur) || [] : [];
  els.forEach((x) => x.classList.add("is-current"));
  $("#pos").textContent = S.cur > -1 ? `Change ${S.cur + 1} of ${fmtN(n)}` : n ? `${fmtN(n)} to review` : "No changes";
  $("#prevBtn").disabled = S.cur <= 0;
  $("#nextBtn").disabled = n === 0 || S.cur >= n - 1;
  document.querySelectorAll(".chg-list button.is-current").forEach((x) => x.classList.remove("is-current"));
  document.querySelectorAll(`.chg-list button[data-k="${S.cur}"]`).forEach((x) => {
    x.classList.add("is-current");
    const list = x.closest(".rail, .sheet-body");
    if (list && list.scrollHeight > list.clientHeight) {
      const r = x.getBoundingClientRect(), lr = list.getBoundingClientRect();
      if (r.top < lr.top + 40 || r.bottom > lr.bottom - 40) list.scrollBy({ top: r.top - lr.top - lr.height / 3, behavior: reduced.matches ? "auto" : "smooth" });
    }
  });
  if (pulse && els.length && !reduced.matches) {
    els.forEach((x) => { x.classList.remove("pulse"); void x.offsetWidth; x.classList.add("pulse"); });
  }
}
function goToChange(k) {
  const n = S.redline?.res.stats.changes || 0;
  if (!n) return;
  S.cur = Math.max(0, Math.min(n - 1, k));
  const els = S.hunks.get(S.cur) || [];
  markCurrent(false);
  if (!els.length) return;
  goToElement(els[0], { block: "center" }).then(() => markCurrent(true));
}

/** Show changes / Hide changes. */
async function setMode(mode, { pair = null } = {}) {
  if (mode === S.mode || (mode === "changes" && S.E.length < 2)) return;
  if (mode === "changes") {
    S.mode = "changes";
    let b = pair?.b ?? editionForStop(S.tl.stops[slider.b], S.tl), a = pair?.a ?? b - 1;
    if (a < 0) { a = 0; b = 1; toast("This is the earliest edition held: comparing it with the next one."); }
    applyModeUI();
    slider.setMode("compare", { a: stopOf(a), b: slider.b });
    slider.active = "b";
    if (slider.b !== stopOf(b)) await slider.glide("b", stopOf(b), 320);
    slider.lastPair = `${slider.a}:${slider.b}`;
    slider.syncAria(); slider.cull();
    await loadPair(a, b);
  } else {
    S.mode = "read";
    pairTok++; setBusy(false);
    const e = S.pair?.b ?? editionForStop(S.tl.stops[slider.b], S.tl);
    S.pair = null;
    applyModeUI();
    slider.setMode("read", { b: stopOf(e) });
    slider.lastPair = `${slider.a}:${slider.b}`;
    slider.cull();
    const anchor = captureAnchor();
    if (!S.C || S.C.e !== e) S.C = buildClean(e);
    mountClean();
    restoreAnchor(anchor);
    if (!reduced.matches) $("#doc").animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 280, easing: EASE });
  }
}
function applyModeUI() {
  const on = S.mode === "changes";
  const btn = $("#changesBtn");
  btn.setAttribute("aria-checked", String(on));
  $("#changesLbl").textContent = on ? "Hide changes" : "Show changes";
  btn.disabled = S.E.length < 2;
  btn.title = S.E.length < 2 ? "Only one edition is held, so there is nothing to compare yet" : on ? "Back to reading the edition, clean (c)" : "Mark what changed from the edition before (c)";
  $("#bar").classList.toggle("is-changes", on);
  document.body.classList.toggle("mode-changes", on);
  const vs = $("#vseg"), view = effectiveView();
  vs.dataset.value = view;
  vs.querySelectorAll("button").forEach((b) => { b.setAttribute("aria-checked", String(b.dataset.view === view)); b.disabled = b.dataset.view === "sbs" && narrow.matches; });
  $("#dockLbl").textContent = on ? "Changes" : "Saved";
  $("#sheetTabSaved").textContent = on ? "Changes" : "Saved";
  $("#rail").setAttribute("aria-label", on ? "Changes between the two editions" : "Saved from this report");
}
function setView(view) {
  if (view === S.view && effectiveView() === view) return;
  S.view = view;
  applyModeUI();
  if (S.mode === "changes" && S.redline) {
    const anchor = captureAnchor();
    paintRedline(S.redline.a, S.redline.b, S.redline.res);
    restoreAnchor(anchor);
  }
  syncUrl();
}

/** Back to the default view: the latest edition, clean. */
async function readLatest() {
  if (S.mode === "changes") await setMode("read");
  const k = stopOf(S.tl.latest);
  if (slider.b !== k) { slider.active = "b"; await slider.glide("b", k, 420); slider.commit(true); }
  else if (!S.C || S.C.e !== S.tl.latest) showEdition(S.tl.latest);
}

/* ================================================================== the bar and the edition note */

function updateBar() {
  const chip = $("#edChip");
  // Not the guidance in force (an earlier edition, a report GOV.UK no longer lists, or a current edition held
  // only as a PDF): the page turns from blue to grey, so it cannot be mistaken for the current text at a
  // glance (reader.css: [data-outdated]). Comparing two editions, it follows the later one.
  document.documentElement.toggleAttribute("data-outdated", !isLatest(shownEdition()) || gone() || pdfNow());
  let html;
  if (S.mode === "changes" && S.pair) {
    const A = S.E[S.pair.a], B = S.E[S.pair.b];
    const arrow = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 8h10M9.5 4.5 13 8l-3.5 3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    html = `<span class="tag tag--outline ver" title="${esc(stopDateLong(A))}">${esc(vLabel(A))}</span>${arrow}<span class="tag ver" title="${esc(stopDateLong(B))}">${esc(vLabel(B))}</span><span class="ed-when">${esc(stopDate(A))} → ${esc(stopDate(B))}</span><span class="sr-only">Changes from ${esc(vLabel(A))} to ${esc(vLabel(B))}</span>`;
  } else {
    // Which edition is being read. With the head's line this is all that says so: no note above the text, so the
    // text keeps its place from one edition to the next.
    const e = shownEdition(), E = S.E[e], stop = S.tl.stops[slider.b];
    const archived = sourceWords(E.v) ? ` · ${sourceWords(E.v)}` : "";       // "archived copy", "text from the PDF", or both
    const w = stop?.kind === "update" ? updateWords(stop) : null;
    // With a PDF-only current edition the newest text held is still an earlier edition: never "Latest".
    const top = isLatest(e) && !pdfNow();
    html = w
      ? `<span class="tag tag--muted" title="${esc(`GOV.UK update of ${stopDateLong(stop)}. ${w.why}`)}">${esc(w.tag)}</span><span class="ed-when">${esc(stopDate(stop))} update · showing</span><b>${esc(vLabel(E))}</b><span class="ed-when">${esc(stopDate(E))}${archived}</span>`
      : `<span class="tag ${top ? "" : "tag--muted"}"${top ? "" : ` title="${gone() ? "Not the last edition held" : isLatest(e) ? "The current edition is a PDF only; this is the last edition held as text" : "Not the current guidance"}"`}>${top ? (gone() ? "Last edition" : "Latest") : isLatest(e) ? `<span class="tag-x">Last edition held as text · not current guidance</span><span class="tag-s">Not current</span>` : `<span class="tag-x">${e > S.tl.latest ? "Edition since withdrawn" : "Earlier edition"} · ${gone() ? "not the last edition" : "not current guidance"}</span><span class="tag-s">${gone() ? "Not the last" : "Not current"}</span>`}</span>${
        E.version ? `<b>${esc(vLabel(E))}</b><span class="ed-when">${esc(stopDate(E))}${archived}</span>` : `<b class="ed-date">${esc(stopDate(E))}</b>${archived ? `<span class="ed-when">${archived.slice(3)}</span>` : ""}`}`;
  }
  if (chip.innerHTML !== html) chip.innerHTML = html;
  // The one way back: on the latest edition, read clean, there is nowhere to go back to.
  const home = isLatest(shownEdition());                           // comparing into the latest: "Hide changes" is the way back
  const mini = $("#latestMini");
  mini.hidden = home;
  const last = gone() || !!pdfNow();
  mini.querySelector(".lm-long").textContent = last ? "Last edition" : "Latest guidance";
  mini.querySelector(".lm-short").textContent = last ? "Last" : "Latest";
  mini.title = last ? "Back to the last edition held, without changes marked" : "Back to the latest guidance, without changes marked";
  $("#bar").classList.toggle("no-redline", S.mode === "changes" && !!S.rewrite && S.rewrite.view !== "redline");
}
/** Above the text. Reading: nothing (the bar says which edition is shown and offers the way back), so the text
 *  keeps its place from one edition to the next. Changes: one fixed line, the legend or what a rewrite is shown as. */
function updateEditionNote() {
  const box = $("#editionNote");
  let html = "";
  if (S.mode === "changes" && S.pair) {
    const A = S.E[S.pair.a], B = S.E[S.pair.b], rw = S.rewrite;
    const kept = rw ? `${keptPercent(rw.sim)} of the wording kept` : "";
    if (rw?.view === "pair") {
      html = `<span class="tag tag--outline">Rewrite</span><span class="en-t">${esc(vLabel(A))} and ${esc(vLabel(B))} side by side, unmarked · ${esc(kept)}</span><button class="linklike" type="button" data-act="rw-redline">Show the redline anyway</button>`;
    } else if (rw?.view === "notice") {
      html = "";                                                    // the notice itself is the whole page
    } else {
      html = `<span class="tag tag--outline">Changes</span><span class="en-t"><ins>Inserted</ins> words are underlined, <del>deleted</del> words struck through; bars in the margin mark changed paragraphs${
        S.pair.b - S.pair.a > 1 ? ` · spans ${S.pair.b - S.pair.a} editions` : ""}</span>${rw ? `<button class="linklike" type="button" data-act="rw-pair">Read side by side instead</button>` : ""}`;
    }
  }
  if (!html) { box.hidden = true; box.innerHTML = ""; return; }
  if (box.innerHTML !== html) {
    box.innerHTML = html;
    const t = box.querySelector(".en-t");
    if (t) t.title = t.textContent;
    if (S.ready) swapIn(box);
  }
  box.hidden = false;
}

/* ================================================================== link status and sources */

function decorateView() {
  if (!S.linkMap) return;
  for (const root of new Set([S.C?.root, S.V?.root])) {
    if (!root || root.dataset.linksDone) continue;
    root.dataset.linksDone = "1";
    const result = decorateLinks(root, S.linkMap);
    if (root === S.C?.root) { S.C.linkCounts = result; S.C.ix.dirty = true; }
    if (root === S.V?.root && S.V.ix) S.V.ix.dirty = true;
  }
  showSources(S.C?.linkCounts || null);
  minimap?.schedule();                                   // dead sources
}
/** The Sources chip: one fact (how many dead links, else how many links); the rest opens on demand. */
function showSources(result) {
  const chip = $("#sourcesChip");
  S.sources = result && result.counts.total ? result : null;
  if (!S.sources) { chip.hidden = true; if (hpopKind === "sources") closeHeadPop(); return; }
  const c = result.counts, checked = c.total - c.unchecked;
  const fact = !checked ? "not checked yet" : c.dead ? `${fmtN(c.dead)} dead ${c.dead === 1 ? "link" : "links"}` : `${fmtN(c.total)} ${c.total === 1 ? "link" : "links"}`;
  const html = `Sources<span class="chip-v${checked && c.dead ? " is-dead" : ""}">${esc(fact)}</span>`;
  if (chip.innerHTML !== html) chip.innerHTML = html;
  chip.title = checked ? summaryLine(result) : `${fmtN(c.total)} links · not checked yet`;
  showSourcesChip();
  if (hpopKind === "sources") renderHeadPop();
}
/** The counts are of the edition last read clean: the chip shows only while the head is about that edition. */
function showSourcesChip() {
  const chip = $("#sourcesChip");
  if (!chip) return;
  const on = !!S.sources && S.C?.e === shownEdition();
  chip.hidden = !on;
  if (!on && hpopKind === "sources") closeHeadPop();
}
let deadIx = -1;
function nextDead() {
  const dead = S.C?.linkCounts?.dead || [];
  if (!dead.length || S.V.kind !== "clean") return;
  closeHeadPop();
  deadIx = (deadIx + 1) % dead.length;
  const a = dead[deadIx].anchor;
  goToElement(a, { block: "center" }).then(() => flash([a.closest("p, li, td") || a]));
}

/* ================================================================== where a link in the text leads */

/** What the card by a link says (link-card.js), from what the page already knows; null for none. */
function describeLink(a) {
  if (a.closest("sup, .linkstatus, .lc, .pdf-fig, .footnotes .reversefootnote, [role='doc-backlink']")) return null;   // footnote marks have their own panel
  const raw = a.getAttribute("href") || "";
  if (raw.startsWith("#")) {
    let id = raw.slice(1);
    try { id = decodeURIComponent(id); } catch {}
    const el = id ? S.V?.root.querySelector(`#${CSS.escape(id)}`) : null;
    if (!el) return null;
    const heading = /^H[1-6]$/.test(el.tagName) ? el.textContent.replace(/\s+/g, " ").trim() : null;
    return linkFacts({ link: { href: raw }, target: { heading, text: heading ? "" : leadText(el.closest("p, li, td, th, dd") || el, 150) } });
  }
  if (a.dataset.govukHref) {                                    // opens here: a report, or a country's reports
    const u = new URL(a.href), slug = u.pathname.includes("/dashboard/") ? decodeURIComponent(u.hash.slice(1)) : u.searchParams.get("country");
    const country = S.data?.countries?.find((c) => c.slug === slug);
    if (!country) return null;
    const key = u.searchParams.get("series");
    return linkFacts({ link: { href: a.href, govukHref: a.dataset.govukHref }, held: { country, report: key ? country.reports?.find((r) => r.key === key) || null : null } });
  }
  if (!/^https?:/i.test(a.href)) return null;
  const url = a.href.split("#")[0];
  return linkFacts({ link: { href: a.href }, status: S.linkMap?.[url] ?? S.linkMap?.[url.replace(/^https:/, "http:")] ?? null });
}
mountLinkCards({ scope: $("#doc"), describe: describeLink, topInset: () => headOffset() });

/* ================================================================== references in captions */

function goToRef(a) {
  let els = [];
  const label = a.dataset.ref ? `${capFirst(a.dataset.kind)} ${a.dataset.ref}` : `“${a.dataset.secText}”`;
  if (a.dataset.ref) {
    const ts = viewTargets();
    const r = resolveParaRef(a.dataset.ref, a.dataset.kind, ts);
    if (r) els = r.members.map((i) => ts[i].el);
  } else {
    const id = a.dataset.sec;
    let el = id ? S.V.root.querySelector(`#${CSS.escape(id)}`) : null;
    if (!el && a.dataset.secText) {
      const want = a.dataset.secText.replace(/\s+/g, " ").trim().toLowerCase();
      el = [...S.V.root.querySelectorAll("h2, h3, h4")].find((h) => h.textContent.replace(/\s+/g, " ").trim().toLowerCase() === want) || null;
    }
    if (el) els = [el];
  }
  if (!els.length) { toast(`${label} is not in the text shown.`); return; }
  goToElement(els[0], { block: "start" }).then(() => flash(els));
}
function flash(els) {
  els.forEach((x) => { warm(x); x.classList.remove("ref-flash"); void x.offsetWidth; x.classList.add("ref-flash"); });
  setTimeout(() => els.forEach((x) => x.classList.remove("ref-flash")), 2600);
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("a.ref");
  if (!a) return;
  e.preventDefault();
  goToRef(a);
});

/* ================================================================== contents + scrollspy */

let spy = null, activeSection = -1;
function tocHtml() {
  const secs = S.V?.sections || [];
  const head = S.V?.kind === "redline" ? `<p class="eyebrow">Contents · changes per section</p>`
    : S.V?.kind === "pair" && S.pair ? `<p class="eyebrow">Contents · ${esc(vLabel(S.E[S.pair.b]))}</p>` : `<p class="eyebrow">On this page</p>`;
  if (S.V?.kind === "notice") return `${head}<p class="rail-empty">Choose how to compare the two editions.</p>`;   // phones' sheet; hidden beside the notice
  if (!secs.length) return `${head}<p class="rail-empty">This edition has no headings.</p>`;
  const counts = S.V.kind === "clean" ? sectionCounts() : secs.map((s) => s.count);
  return `${head}<ol class="toc-list"><span class="toc-ind" aria-hidden="true"></span>${secs.map((s, i) => {
    const cnt = counts[i] ? `<span class="cnt" title="${counts[i]} ${S.V.kind === "clean" ? "saved" : counts[i] === 1 ? "change" : "changes"}">${counts[i]}</span>` : "";
    if (s.st === "del") return `<li class="l${s.level}"><a class="rm-sec" aria-disabled="true" title="Removed in this edition"><span class="toc-label">${esc(s.title)}</span>${cnt}</a></li>`;
    return `<li class="l${s.level}"><a href="#${esc(s.id)}" data-sec="${i}"${i === activeSection ? ' class="is-active" aria-current="true"' : ""}><span class="toc-label">${esc(s.title)}</span>${cnt}</a></li>`;
  }).join("")}</ol>`;
}
function sectionCounts() {
  const counts = [];
  const secs = S.V.sections;
  for (const [, chk] of S.checks) {
    if (!chk.match) continue;
    let k = -1;
    for (let i = 0; i < secs.length && secs[i].at <= chk.match.start; i++) k = i;
    if (k >= 0) counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}
function renderToc() {
  activeSection = -1;
  $("#toc").innerHTML = tocHtml();
  if ($("#sheet").classList.contains("on") && sheetTab === "toc") renderSheet();
  moveIndicator();
  if (!spy) startSpy(); else spyUpdate();
}
/** Section offsets for the spy (redline sections are measured lazily). */
function sectionAt(off) {
  const secs = S.V.sections;
  if (S.V.kind !== "clean" && secs.some((s) => s.at == null)) {
    const ix = viewIndex();
    for (const s of secs) s.at = s.el ? ix.firstTextAt(s.el) ?? Infinity : Infinity;
  }
  let k = -1;
  for (let i = 0; i < secs.length; i++) if (secs[i].at <= off) k = i;
  return k;
}
let spyUpdate = () => {};
function startSpy() {
  spy = true;
  let queued = false;
  spyUpdate = () => {
    queued = false;
    if (!S.V) return;
    const y = headOffset() + (innerHeight - headOffset()) * 0.22;
    const off = offsetAtY(y);
    if (off == null) { setActive(scrollY < 40 ? -1 : activeSection); return; }
    setActive(sectionAt(off));
  };
  addEventListener("scroll", () => { if (!queued) { queued = true; setTimeout(() => requestAnimationFrame(spyUpdate), 60); } }, { passive: true });
  spyUpdate();
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
  const box = a.getBoundingClientRect(), list = ind.parentElement.getBoundingClientRect();   // exact: offsetTop and offsetHeight are whole pixels, the entry is not
  ind.style.height = `${box.height}px`;
  ind.style.transform = `translateY(${box.top - list.top}px)`;
  const top = a.parentElement.offsetTop, bottom = top + a.offsetHeight;
  if (top < toc.scrollTop + 40 || bottom > toc.scrollTop + toc.clientHeight - 40) {
    toc.scrollTo({ top: top - toc.clientHeight / 3, behavior: reduced.matches ? "auto" : "smooth" });
  }
}

/* ================================================================== gliding scroll */

let glide = null;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Height of what stays stuck above the text: the header, the bar, and (side by side) the column heads or the switch. */
const headOffset = () => $("#top").offsetHeight + ($("#bar").hidden ? 0 : $("#bar").offsetHeight) + columnHeadHeight() + 18;
function columnHeadHeight() {
  const V = S.V;
  if (!V || (V.kind !== "pair" && V.kind !== "redline")) return 0;
  V.heads ??= [...V.root.querySelectorAll(".sbs-head, .pv-switch")];
  return V.heads.reduce((h, el) => h + el.offsetHeight, 0);
}
const maxScroll = () => document.documentElement.scrollHeight - innerHeight;
const warmed = [];
function warm(node) {
  const box = node?.closest?.(".cv, .sbs-row") || node?.parentElement?.closest(".cv, .sbs-row");
  if (!box || box.classList.contains("warm")) return;
  box.classList.add("warm");
  warmed.push(box);
  while (warmed.length > 6) warmed.shift().classList.remove("warm");
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
  if (inOldPane(el)) return glideTo(() => oldPaneRect(() => el.getBoundingClientRect()));
  return glideTo(() => el.getBoundingClientRect(), opts);
}

/* ================================================================== highlights in the text */

// A highlight belongs to an edition when it was made on any stored copy of that edition's words (E.ids).
const sameEdition = (rec, E) => !!rec.editionSha && E.ids.includes(String(rec.editionSha).slice(0, 16));
const editionById = (id) => S.E.findIndex((x) => x.ids.includes(id));
/** The note an edition's highlights are filed under: its GOV.UK note, or for an edition read from a PDF (which has
 *  none) the name the dashboard lists it by, "pdf-<edition id>". */
const noteIdOf = (E) => E.v.note || (E.v.source === "pdf" ? H.pdfNoteId(E.id) : NOTE);
const seriesRecords = () => H.loadHighlights().filter((r) => r.country === COUNTRY && (r.series === SERIES || S.noteIds.has(r.note)));
/** The full sha256 of an edition (as the saved page knows it), from its note's index; the short id until then. */
function fullSha(E) {
  if (S.fullSha.has(E.id)) return S.fullSha.get(E.id);
  S.fullSha.set(E.id, E.id);
  if (!E.v.note) return E.id;                              // read from a PDF: no note, so no index to ask
  fetchJson(`../../data/countries/${COUNTRY}/notes/${E.v.note}/index.json`).then((idx) => {
    for (const v of idx.versions || []) if (v.sha256) S.fullSha.set(v.sha256.slice(0, 16), v.sha256);
  }).catch(() => {});
  return E.id;
}

function wrap(id, s, e, { fresh = false } = {}) {
  const ix = S.C.ix.ensure();
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
  S.C.ix.dirty = true;
}

/**
 * Anchor a stored highlight in the edition shown. On the latest edition, a highlight made on an older
 * one is re-anchored silently if its words are still there, or flagged as changed (and the record
 * updated, as before). On an earlier edition nothing is written back: highlights are shown where their
 * words occur, and the others are listed as not in this edition.
 */
function place(rec, { fresh = false } = {}) {
  const E = S.E[S.C.e], latest = isLatest(S.C.e);
  const sha = sameEdition(rec, E) ? rec.editionSha : fullSha(E);
  const res = H.checkHighlight(rec, { sha, version: E.version, text: S.C.text, normalized: normalizedClean() });
  if (!latest && res.status === "changed") res.status = "absent";
  S.checks.set(rec.id, res);
  const missing = stillMissing(rec, res.match);
  if (res.match) wrap(rec.id, res.match.start, res.match.end, { fresh });
  if (missing) { S.patching = true; H.updateHighlight(rec.id, missing); S.patching = false; }
  if (!latest) return;
  let patch = null;
  if (res.status === "still") {
    const info = describe(res.match.start, res.match.end), src = editionSource(E);
    const selector = H.makeSelector(S.C.text, res.match.start, res.match.end);
    const cur = { sha: fullSha(E), current: !gone() && !pdfNow(), note: noteIdOf(E), version: E.version || null, title: E.v.title, month: monthOf(E), para: info.para, section: info.section, paraTwice: !!info.twice,
      prefix: selector.prefix, suffix: selector.suffix, quote: selector.quote, sources: info.sources, spaced: spacedAt(res.match.start, res.match.end), lead: info.lead,
      url: src.url, archived: src.archived, capturedAt: src.capturedAt, ...publicationOf(E, src, info.para), pos: { start: res.match.start, end: res.match.end } };
    const orig = S.E.find((x) => sameEdition(rec, x));
    patch = { check: "still", current: cur, archivedCopy: copyOf(orig?.v) || rec.archivedCopy || null };
  } else if (res.status === "changed") {
    const orig = S.E.find((x) => sameEdition(rec, x));
    if (rec.check !== "changed" || String(rec.current?.sha || "").slice(0, 16) !== E.id) {
      patch = { check: "changed", current: { sha: fullSha(E), version: E.version || null },
        archivedCopy: copyOf(orig?.v) || rec.archivedCopy || null };
    }
  } else if (res.status === "current" && rec.check && rec.check !== "current") patch = { check: "current", current: null };
  if (patch) { S.patching = true; H.updateHighlight(rec.id, patch); S.patching = false; }
}
/**
 * What a highlight saved by an earlier version of this page lacks, and can be given now: the report it belongs to
 * (`series`), and, where its words sit in the text shown exactly as saved, how they read (`spaced`) and which
 * paragraph number they open with (`lead`). Returns what to add to the record, or null. Its `quote` and position
 * are not touched.
 */
function stillMissing(rec, match) {
  const add = rec.series ? {} : { series: SERIES };
  if (match && rec.lead === undefined && S.C.text.slice(match.start, match.end) === rec.quote) {
    const spaced = spacedAt(match.start, match.end);
    if (spaced !== rec.quote) add.spaced = spaced;
    const info = describe(match.start, match.end);
    add.lead = info.lead;
    if (info.twice && info.para === rec.para) add.paraTwice = true;
  }
  return Object.keys(add).length ? add : null;
}
/** The month an edition is cited by: the month in its title, else of its own date (its "valid from"). Never the
 *  date GOV.UK gives the note, which is the country page's: a bulletin with no month in its title, valid from
 *  4 February 2026, was cited "August 2026". */
const monthOf = (E) => titleMonth({ title: E.v.title, topic: S.series.topic, countryName: S.country.name }) || E.own?.date.slice(0, 7) || null;
const describe = (s, e) => describePassage(S.C.A, s, e);
/** The words of [s, e) as a reader sees them: a space where a line, a table cell or a block ends (the index has none). */
const spacedAt = (s, e) => H.spacedText(S.C.ix.ensure(), s, e, { skip: SKIP_UI });

/** Bring the text in line with storage (another tab, undo, delete). */
function sync() {
  if (!S.ready || S.patching || !S.C) return;
  const recs = seriesRecords();
  const ids = new Set(recs.map((r) => r.id));
  for (const id of [...S.checks.keys()]) {
    if (!ids.has(id)) { unwrap(id); S.checks.delete(id); if (popState?.id === id) closePop(); }
  }
  for (const rec of recs) if (!S.checks.has(rec.id)) place(rec, { fresh: true });
  renderRail();
  if (S.V?.kind === "clean") renderToc();
  updateCounts();
  if (F.q && S.V?.kind === "clean") runFind(F.q, { jump: false });
  minimap?.schedule();                                   // saved highlights
}
const recById = (id) => H.loadHighlights().find((r) => r.id === id) || null;

/* ================================================================== selection -> toolbar */

const tool = $("#seltool");
let pointerIsDown = false, programmatic = false;
// Edge's Windows selection menu occupies the space immediately above a selection. Keep the
// Explorer actions clear of it; other desktop browsers retain the contextual placement.
const windowsEdge = /Windows NT/i.test(navigator.userAgent) && /Edg\//.test(navigator.userAgent);
// The tool eases out before it goes: toolGoing is "hide" while it does, or "move" while the touch sheet changes
// edge. On a touch screen the dock comes back only once the sheet has gone (see the note on taps below).
const TOOL_OUT = 180, DOCK_BACK = 420;
let toolGoing = null, toolTimer = 0, dockTimer = 0;
const toolOpen = () => !tool.hidden && toolGoing !== "hide";

function selectionInfo() {
  if (!S.ready || S.V?.kind !== "clean") return null;
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0), root = S.C.root;
  if (!r.intersectsNode(root)) return null;
  const ix = S.C.ix.ensure();
  let s = root.contains(r.startContainer) ? ix.offsetOf(r.startContainer, r.startOffset) : 0;
  let e = root.contains(r.endContainer) ? ix.offsetOf(r.endContainer, r.endOffset) : ix.length;
  [s, e] = H.snapToWords(S.C.text, s, e);
  s = snapToParaNumber(S.C.A, s);
  e = trimNextParaNumber(S.C.A, s, e);
  if (e - s < 2 || !S.C.text.slice(s, e).trim()) return null;
  return { s, e, selector: H.makeSelector(S.C.text, s, e), spaced: spacedAt(s, e), ...describe(s, e), range: r };
}
const pinTag = (para, section) => (para ? formatPinpoint(para) : section ? truncate(section, 26) : "Passage");
const pinLabel = (info) => (info.para ? formatPinpoint(info.para) : info.section ? info.section : "No paragraph number");

function showTool(info) {
  S.pending = info;
  const touch = coarse.matches;
  const E = S.E[S.C.e];
  tool.innerHTML = `<span class="st-pin" title="${esc(info.section || "")}">${esc(truncate(pinLabel(info), 30))}${isLatest(S.C.e) ? "" : ` · ${esc(vLabel(E))}`}</span>
    <button type="button" data-act="save">${ICON.save}Save highlight</button>
    <button type="button" data-act="copy-both">${ICON.quote}Copy quote + citation</button>
    <button type="button" data-act="copy-cite">${ICON.copy}Copy citation</button>`;
  const shown = !tool.hidden && !toolGoing;
  clearTimeout(toolTimer); clearTimeout(dockTimer);
  toolGoing = null;
  tool.hidden = false;
  tool.classList.remove("is-out");
  tool.classList.toggle("is-touch", touch);
  tool.classList.toggle("is-windows-edge", !touch && windowsEdge);
  $("#dock").classList.toggle("is-hidden", touch);
  if (!touch) {
    tool.classList.remove("is-top");
    const rects = [...info.range.getClientRects()].filter((x) => x.width > 1 && x.height > 1);
    const first = rects[0] || info.range.getBoundingClientRect(), last = rects[rects.length - 1] || first;
    const w = tool.offsetWidth, h = tool.offsetHeight, gap = 12;
    if (windowsEdge) {
      tool.classList.remove("is-below");
      tool.style.left = `${Math.max(10, (innerWidth - w) / 2)}px`;
      tool.style.top = "";
      tool.style.setProperty("--ox", "50%");
      if (!shown) { tool.classList.remove("is-in"); void tool.offsetWidth; tool.classList.add("is-in"); }
      return;
    }
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
    placeSheet(shown);
  }
  if (!shown) { tool.classList.remove("is-in"); void tool.offsetWidth; tool.classList.add("is-in"); }
}
/**
 * Touch: the sheet takes the edge of the screen that is clear of the selection, its handles and the system's own
 * menu (sheetSide, ./phone.js): the bottom, else the top under the sticky bar. Showing at the other edge, it
 * eases out there and in here.
 */
function placeSheet(shown = toolOpen() && !toolGoing) {
  if (!S.pending || !tool.classList.contains("is-touch")) return;
  const was = tool.classList.contains("is-top") ? "top" : "bottom", inset = headOffset() - 18;
  tool.classList.remove("is-top");                       // measured along the bottom, where its gap holds the safe-area inset
  const box = tool.getBoundingClientRect(), r = S.pending.range.getBoundingClientRect();
  tool.classList.toggle("is-top", was === "top");
  tool.style.setProperty("--tool-top", `${inset}px`);
  const side = sheetSide({ top: r.top, bottom: r.bottom, viewport: innerHeight, inset, size: innerHeight - box.top + 8, was });
  if (side === was) return;
  const flip = () => { toolGoing = null; tool.classList.remove("is-out"); tool.classList.toggle("is-top", side === "top"); void tool.offsetWidth; tool.classList.add("is-in"); };
  if (!shown) { tool.classList.toggle("is-top", side === "top"); return; }
  toolGoing = "move";
  tool.classList.remove("is-in");
  tool.classList.add("is-out");
  toolTimer = setTimeout(flip, reduced.matches ? 0 : TOOL_OUT);
}
function hideTool() {
  S.pending = null;
  if (tool.hidden || toolGoing === "hide") return;
  clearTimeout(toolTimer);
  toolGoing = "hide";
  tool.classList.remove("is-in");
  tool.classList.add("is-out");
  toolTimer = setTimeout(() => { toolGoing = null; tool.hidden = true; tool.classList.remove("is-out", "is-top"); }, reduced.matches ? 0 : TOOL_OUT);
  if (!tool.classList.contains("is-touch")) return;
  clearTimeout(dockTimer);
  dockTimer = setTimeout(() => { if (!$("#sheet").classList.contains("on")) $("#dock").classList.remove("is-hidden"); }, DOCK_BACK);
}
/** Put the selection and its tool away. */
function dropSelection() {
  programmatic = true;
  getSelection().removeAllRanges();
  programmatic = false;
  clearTimeout(selTimer);
  hideTool();
}
function checkSelection() {
  if (programmatic) return;
  const info = selectionInfo();
  if (info) showTool(info); else hideTool();
}
// A mouse press puts the tool out of the way at once (it is back on release if words are still selected). A
// finger changes nothing on the way down or up. iOS decides whether a tap is a click by watching what the page
// does with it: if something to press appears before the click is sent (this tool coming back for a selection
// the tap had not yet dropped, the dock returning), the tap counts as a "hover" and the click never comes, which
// left links dead while words were selected. So on a touch screen the tool follows the selection, and a click
// outside it puts both away (below).
let selTimer = 0, downInTool = false, tap = null, tapTimer = 0, followed = null, lastScroll = 0;
document.addEventListener("pointerdown", (e) => {
  downInTool = tool.contains(e.target);
  if (downInTool) { e.preventDefault(); return; }
  pointerIsDown = true;
  tap = null;
  if (e.pointerType === "mouse") hideTool();
  else if (toolOpen() && e.isPrimary && e.timeStamp - lastScroll > 250) tap = { el: e.target.closest("a[href], mark.hl"), x: e.clientX, y: e.clientY, t: e.timeStamp };
  if (popState && !$("#pop").contains(e.target) && !e.target.closest("mark.hl, .saved-open, sup a, .review-marker, #reviewsChip")) closePop();
});
document.addEventListener("pointerup", (e) => {
  pointerIsDown = false;
  if (!coarse.matches || e.pointerType === "mouse") setTimeout(checkSelection, 0);     // a finger's selection is heard of from selectionchange
  // A tap on a link (or a saved highlight) while the sheet was showing: should no click follow, it is followed anyway.
  const el = tap?.el;
  if (el && e.timeStamp - tap.t < 700 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 12) {
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { if (el.isConnected) { followed = { el, t: performance.now() }; el.click(); } }, 450);
  }
  tap = null;
});
document.addEventListener("pointercancel", () => { pointerIsDown = false; tap = null; });
addEventListener("blur", () => { pointerIsDown = false; tap = null; });
// A click outside the tool while words are selected does what it would have done (a link is followed, a saved
// highlight opens), and the selection and the tool are put away, not left behind. (A mouse click on plain text
// has dropped the selection already; a click on a link has not.)
document.addEventListener("click", (e) => {
  const el = e.target.closest?.("a[href], mark.hl");
  if (e.isTrusted) {
    clearTimeout(tapTimer);
    if (followed && el === followed.el && performance.now() - followed.t < 1000) { e.preventDefault(); e.stopImmediatePropagation(); return; }   // a late click: already followed
  }
  if (tool.contains(e.target)) return;
  if ((toolOpen() && tool.classList.contains("is-touch")) || (el?.matches("a") && !getSelection().isCollapsed)) dropSelection();
}, true);
document.addEventListener("keyup", (e) => { if (e.key === "Shift" || e.shiftKey || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a")) checkSelection(); });
document.addEventListener("selectionchange", () => {
  if (programmatic) return;
  clearTimeout(selTimer);
  if (coarse.matches) {
    // A touch screen: the sheet comes as soon as there is a selection (the finger may still be down), keeps up as
    // the handles are dragged, and goes when the selection does. After a tap on one of its own buttons it waits
    // for the click (iOS drops the selection first).
    const gone = getSelection().isCollapsed;
    selTimer = setTimeout(checkSelection, gone ? (downInTool ? 280 : 80) : toolOpen() ? 240 : 60);
    return;
  }
  // Selection updates can be queued after pointerup, including in Edge. Follow the
  // selection itself once the drag has finished, also for keyboard selections.
  if (!pointerIsDown) selTimer = setTimeout(checkSelection, 60);
});
// The page scrolled under the sheet: once it rests, the sheet checks it is still clear of the selection. (A tap
// that stops a scroll is not a tap on what it lands on.)
let sheetRest = 0;
addEventListener("scroll", () => {
  if (!S.pending || !tool.classList.contains("is-touch")) return;
  lastScroll = performance.now();
  clearTimeout(tapTimer); clearTimeout(sheetRest);
  sheetRest = setTimeout(() => placeSheet(), 180);
}, { passive: true });
tool.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b || !S.pending) return;
  const info = S.pending;
  if (b.dataset.act === "save") saveHighlight(info);
  else if (b.dataset.act === "copy-both") copyRich(quoteWithCitation(ctxFromInfo(info), citeStyle, info.sources)).then((ok) => toast(ok ? "Copied quote and citation" : "Your browser blocked the clipboard"));
  else if (b.dataset.act === "copy-cite") copyRich(formatCitation(ctxFromInfo(info), citeStyle)).then((ok) => toast(ok ? `Copied ${STYLE_NAMES[citeStyle]} citation` : "Your browser blocked the clipboard"));
});

/** Citations always cite the edition shown: its version, month and where it can be read. */
function ctxFromInfo(info) {
  const E = S.E[S.C.e], src = editionSource(E);
  return {
    title: E.v.title, kind: S.series.kind, topic: S.series.topic, countryName: S.country.name,
    version: E.version || null, month: monthOf(E), para: info.para, section: info.section, paraTwice: info.twice,
    url: src.url, archived: src.archived, capturedAt: src.capturedAt, quote: info.selector.quote, spaced: info.spaced, lead: info.lead, accessed: new Date(),
    ...publicationOf(E, src, info.para),
  };
}
/** Which publication a passage is cited from (the web version unless the edition is read from its PDF), and
 *  the PDF's number for the paragraph where the two are numbered differently. */
function publicationOf(E, src, para) {
  return src.pdf ? { source: "pdf" } : { source: "web", pdfPara: pdfPinpoint(para, E.v.pdf_compare?.numbering) ?? undefined };
}
function saveHighlight(info) {
  const sel = info.selector, E = S.E[S.C.e], src = editionSource(E);
  const rec = H.addHighlight({
    country: COUNTRY, countryName: S.country.name, iso: S.country.iso_a2 || null, note: noteIdOf(E), series: SERIES,
    title: E.v.title, kind: S.series.kind, topic: S.series.topic,
    version: E.version || null, editionSha: fullSha(E), month: monthOf(E),
    url: src.url, archived: src.archived, capturedAt: src.capturedAt, ...publicationOf(E, src, info.para),
    quote: sel.quote, prefix: sel.prefix, suffix: sel.suffix, pos: sel.pos,
    // `quote` is the text as indexed: how the highlight is found again. What is shown, copied and exported is `spaced`,
    // the same words with a space where a line, a table cell or a block ended (kept only where it differs), less
    // `lead`, the paragraph number the quote opens with when it begins a numbered paragraph (it is the pinpoint).
    ...(info.spaced !== sel.quote ? { spaced: info.spaced } : {}), lead: info.lead,
    para: info.para, section: info.section, ...(info.twice ? { paraTwice: true } : {}), sources: info.sources, comment: "", check: "current",
  });
  S.noteIds.add(rec.note);
  if (!S.marks.has(rec.id)) place(rec, { fresh: true });
  else S.marks.get(rec.id).forEach((m) => m.classList.add("is-new"));
  dropSelection();
  bump();
  toast(`Highlight saved${isLatest(S.C.e) ? "" : ` (from ${vLabel(E)})`}`, { action: "Open", onAction: () => openHighlight(rec.id) });
  return rec;
}

/* ================================================================== clipboard */

// A plain copy (Cmd+C, or Copy from the browser's menu) of words selected in the text gives those words and
// nothing of ours: the quote the Copy buttons give, without a citation (none was asked for). The tags this site
// adds inside the text cannot be selected (reader.css), but that is only what the reader sees, and Safari copies
// unselectable text all the same: so the clipboard is filled here, from the text index, which never holds them.
let richCopy = false;                                     // copyRich's own fallback is filling the clipboard
function plainCopy() {
  const sel = getSelection(), root = S.V?.root;
  if (!S.ready || !root?.isConnected || !sel.rangeCount || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (!r.intersectsNode(root)) return null;               // a citation in the rail, the head: the browser's own copy
  const info = selectionInfo();                           // reading an edition: the same words the selection's tool would quote
  if (info) return quoteOf({ quote: info.selector.quote, spaced: info.spaced, lead: info.lead });
  const ix = viewIndex();                                 // a redline, two editions side by side, or less than a word
  const s = root.contains(r.startContainer) ? ix.offsetOf(r.startContainer, r.startOffset) : 0;
  const e = root.contains(r.endContainer) ? ix.offsetOf(r.endContainer, r.endOffset) : ix.length;
  return H.copyText(ix, s, e, { skip: SKIP_UI });
}
document.addEventListener("copy", (e) => {
  if (richCopy || e.target?.closest?.("input, textarea, [contenteditable]")) return;
  const text = plainCopy();
  if (text == null) return;
  S.lastPlain = text;
  e.clipboardData.setData("text/plain", text);
  e.preventDefault();
});

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
  richCopy = true;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  richCopy = false;
  document.removeEventListener("copy", onCopy);
  return ok;
}

/* ================================================================== popover */

const pop = $("#pop");
let popState = null;

function placePop(anchorRect, { scroll = false } = {}) {
  const sheet = innerWidth < 600 || coarse.matches;
  pop.classList.toggle("is-sheet", sheet);
  if (sheet) { pop.style.left = pop.style.top = ""; return; }
  const w = pop.offsetWidth, h = pop.offsetHeight, gap = 10, head = headOffset(), room = innerHeight - 64;
  const r = anchorRect;
  let left, top, glideBy = 0;
  if (r.left > innerWidth * 0.62 && r.left - w - gap > 12) {
    left = r.left - w - gap - 4;
    top = Math.max(head, Math.min(r.top, room - h));
  } else {
    left = r.left - 18;
    if (r.bottom + gap + h <= room) top = r.bottom + gap;
    else if (r.top - gap - h >= head) top = r.top - gap - h;
    else {
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
  void mountReviewFeedback(pop, [...S.reviewRecords, ...S.annotations, ...Reviews.applicationChecks(S.reviewDirectory, reviewEdition())]);
  pop.hidden = false;
  placePop(anchorRect, opts);
  if (wasHidden) { pop.classList.remove("is-in"); void pop.offsetWidth; pop.classList.add("is-in"); }
  if (popState?.kind === "reviews") {
    $("#reviewsChip").setAttribute("aria-expanded", String(popState.anchor === $("#reviewsChip")));
    pop.querySelector('[data-act="close"]')?.focus({ preventScroll: true });
  }
}
function closePop() {
  if (!popState) return;
  const reviewAnchor = popState.kind === "reviews" ? popState.anchor : null;
  document.querySelectorAll("mark.hl.is-hot, .saved-item.is-hot").forEach((m) => m.classList.remove("is-hot"));
  popState = null;
  pop.hidden = true;
  $("#reviewsChip")?.setAttribute("aria-expanded", "false");
  reviewAnchor?.focus({ preventScroll: true });
}

function statusHtml(rec) {
  const chk = S.checks.get(rec.id);
  const latest = S.E[S.tl.latest];
  if (chk?.status === "absent") return `<span class="badge badge--changed">Not in this edition (${esc(vLabel(S.E[S.C.e]))})</span>`;
  if (chk?.status === "changed" || (rec.check === "changed" && isLatest(S.C?.e))) {
    const to = rec.current?.version || latest.version;
    const orig = S.E.find((x) => sameEdition(rec, x));
    return `<span class="badge badge--changed">Changed since you saved it (v${esc(rec.version || "?")} → v${esc(to || "?")})</span>${
      orig && orig.i !== S.tl.latest ? ` <button type="button" class="badge-link linklike" data-act="compare" data-from="${orig.i}">Show the changes →</button>` : ""}`;
  }
  if (chk?.status === "still") return `<span class="badge">${isLatest(S.C.e) && H.stillCurrent(rec) ? esc(H.stillLine(rec)) : `Also in ${esc(vLabel(S.E[S.C.e]))}`}</span>`;
  if (chk?.status === "unanchored") return `<span class="badge badge--changed">Could not be placed in the text</span>`;
  if (chk?.status === "current" && !isLatest(S.C?.e)) return `<span class="badge">Saved from ${esc(vLabel(S.E[S.C.e]))}</span>`;
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
  const pinned = rec.para;
  const section = rec.section;
  const placed = marks.length > 0;
  const sources = rec.sources || [];
  showPop(`
    <div class="pop-head"><span class="tag">${esc(pinTag(pinned, null))}</span><span class="eyebrow" title="${esc(section || "")}">${esc(section || "")}</span>
      <button type="button" class="pop-x" data-act="close" aria-label="Close">×</button></div>
    <div class="pop-body">
      ${placed ? "" : `<p class="saved-quote">“${esc(quoteOf(rec))}”</p>`}
      ${statusHtml(rec) ? `<div class="pop-status">${statusHtml(rec)}</div>` : ""}
      <div class="rail-style"><span class="eyebrow">Citation</span>${segHtml()}</div>
      <div class="cite" id="popCite">${citationFor(rec).html}</div>
      ${sources.length ? `<details class="sources"${sources.length <= 3 ? " open" : ""}><summary>Sources cited in this passage · ${sources.length}</summary><ol>${sources.map((s) =>
        `<li><b>[${s.n}]</b><span>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.text)}</a>` : esc(s.text)}</span></li>`).join("")}</ol></details>` : ""}
      <div><label class="field-label" for="popComment"><span class="eyebrow">Private note</span><span class="saved-flag" id="popSaved">Saved</span></label>
        <textarea class="comment" id="popComment" placeholder="${accountStore.state.user?.approved ? "Private to your account." : "Only kept in this browser."} Why it matters, which issue it goes to…">${esc(rec.comment || "")}</textarea></div>
      <div class="pop-actions">
        <button type="button" class="btn btn--primary" data-act="copy-both">${ICON.quote}Copy quote + citation</button>
        <button type="button" class="btn" data-act="copy-cite">${ICON.copy}Copy citation</button>
        ${H.stillCurrent(rec) && rec.current.current === true && isLatest(S.C.e) ? '<button type="button" class="btn" data-act="cite-current">Cite the current edition instead</button>' : ""}
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
function rectNear(el, point) {
  const rects = el ? [...el.getClientRects()].filter((r) => r.width || r.height) : [];
  if (!rects.length) return new DOMRect(innerWidth / 2 - 180, innerHeight / 4, 360, 0);
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
    renderRail();
    const f = $("#popSaved"); if (f) { f.classList.add("on"); setTimeout(() => f.classList.remove("on"), 1200); }
  }, 350);
});
pop.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const act = b.dataset.act;
  if (act === "close") return closePop();
  if (act === "edition-reviews") return openReportReviews($("#reviewsChip"));
  if (popState?.kind === "fn") {
    const n = popState.n;
    if (act === "goto-fn") { const prefix = popState.prefix; closePop(); return goToFootnote(n, prefix); }
    if (act === "copy-fn") { const f = S.C.A.fns.get(n); copyRich({ text: `[${n}] ${f.text}`, html: `[${n}] ${f.url ? `<a href="${esc(f.url)}">${esc(f.text)}</a>` : esc(f.text)}` }).then((ok) => toast(ok ? "Copied source" : "Your browser blocked the clipboard")); }
    return;
  }
  const rec = recById(popState?.id);
  if (!rec) return;
  if (act === "copy-both") copyRich(quoteWithCitation(H.citeContext(rec), citeStyle, rec.sources)).then((ok) => toast(ok ? "Copied quote and citation" : "Your browser blocked the clipboard"));
  if (act === "copy-cite") copyRich(citationFor(rec)).then((ok) => toast(ok ? `Copied ${STYLE_NAMES[citeStyle]} citation` : "Your browser blocked the clipboard"));
  if (act === "cite-current" && isLatest(S.C.e)) {
    const patch = H.citeCurrent(rec);
    if (patch) { unwrap(rec.id); S.checks.delete(rec.id); H.updateHighlight(rec.id, patch); openHighlight(rec.id); toast("Citation changed to the current edition"); }
  }
  if (act === "delete") deleteHighlight(rec.id);
});
/** "Show the changes →" on a highlight whose words changed: the redline from its edition to the latest. */
document.addEventListener("click", (e) => {
  const b = e.target.closest('[data-act="compare"][data-from]');
  if (!b) return;
  closePop(); closeSheet();
  const from = +b.dataset.from, to = S.tl.latest;                // the latest is not always the last (GOV.UK went back to an earlier text): the pair is in date order
  setMode("changes", { pair: { a: Math.min(from, to), b: Math.max(from, to) } });
});
function deleteHighlight(id) {
  closePop();
  const removed = H.removeHighlight(id);
  if (!removed) return;
  toast("Highlight deleted", { action: "Undo", onAction: () => H.restoreHighlight(removed) });
}

/* --- footnotes ----------------------------------------------------------------------------- */
function reviewEdition() {
  const E = S.E[shownEdition()];
  return { country: COUNTRY, series: SERIES, editionId: E?.id, textSha: E?.v.text_sha256 };
}
function decorateReviews() {
  if (!S.C || S.V?.kind !== "clean") return;
  S.reviewLocations = Annotations.decorateAnnotations(S.C.root, S.C.A, reviewEdition(), [...S.reviewRecords, ...S.annotations]);
  S.C.ix.dirty = true;
}
function openReportReviews(anchor) {
  const target = reviewEdition(), records = Annotations.editionRecords([...S.reviewRecords, ...S.annotations], target);
  popState = { kind: "reviews", anchor };
  showPop(`<div class="pop-head"><span class="tag tag--outline">Edition reviews</span><button type="button" class="pop-x" data-act="close" aria-label="Close">×</button></div><div class="pop-body">${Reviews.reportPanelHtml(target, records, S.reviewDirectory, { loading: S.reviewsLoading, unavailable: S.reviewsUnavailable || S.directoryUnavailable })}</div>`, anchor.getBoundingClientRect());
}
function openPassageReviews(anchor) {
  const ids = new Set(anchor.dataset.reviewIds.split(" "));
  const records = Annotations.editionRecords([...S.reviewRecords, ...S.annotations], reviewEdition()).filter((r) => ids.has(r.id));
  popState = { kind: "reviews", anchor };
  showPop(`<div class="pop-head"><span class="tag tag--outline">Passage reviews</span><button type="button" class="pop-x" data-act="close" aria-label="Close">×</button></div><div class="pop-body">${Reviews.reportPanelHtml(reviewEdition(), records, [], { passage: true })}<button type="button" class="btn" data-act="edition-reviews">All edition reviews</button></div>`, anchor.getBoundingClientRect());
}
function openFootnote(n, anchor, prefix = "") {
  const f = S.C?.A.fns.get(n);
  if (!f || S.V.kind !== "clean") return goToFootnote(n, prefix);
  const ref = S.C.A.refs.find((r) => r.a === anchor);
  const ambiguous = S.C.root.querySelectorAll(`[id="fn:${n}"]`).length > 1;
  const context = ref && !ambiguous ? describePassage(S.C.A, ref.at, ref.at + 1) : {};
  const edition = S.E[S.C.e];
  const template = document.createElement("template");
  template.innerHTML = f.html;
  const urls = [...new Set([...template.content.querySelectorAll("a[href]")].map((a) => Reviews.httpUrl(a.getAttribute("href"))).filter(Boolean))];
  const records = [...S.reviewRecords, ...privateReviews.load()];
  const annotations = Annotations.editionRecords(S.annotations, reviewEdition()).filter((r) => (S.reviewLocations.get(r.id) || [])
    .some((c) => (c.type === "footnote" && (c.el === anchor || c.el.contains(anchor)))
      || (!ambiguous && c.type === "link" && c.footnote === n)));
  const targets = (urls.length ? urls : [""]).map((sourceUrl) => ({ country: COUNTRY, series: SERIES, editionId: edition.id,
    textSha: edition.v.text_sha256, footnote: n, paragraph: context.para || "", section: context.section || "", sourceUrl }));
  popState = { kind: "fn", n, anchor, prefix, targets };
  const footnoteHtml = sanitizeFootnote(f.html);
  template.innerHTML = footnoteHtml;
  for (const a of template.content.querySelectorAll("a[href]")) {
    const target = targets.find((t) => t.sourceUrl === Reviews.httpUrl(a.getAttribute("href")));
    if (target) a.insertAdjacentHTML("afterend", Reviews.badgeHtml([...Reviews.forTarget(records, target), ...annotations.filter((r) => Annotations.anchorsFor(r, reviewEdition()).some((x) => !x.sourceUrl || x.sourceUrl.split("#")[0] === target.sourceUrl.split("#")[0]))]));
  }
  const panels = targets.map((target, i) => Reviews.panelHtml(target, [...Reviews.forTarget(records, target), ...(i === 0 ? annotations : [])],
    { publicUnavailable: S.reviewsUnavailable, publicLoading: S.reviewsLoading,
      editionReviews: [], countryReviews: [],
      matchingCopies: Reviews.sourceCopies(S.sourceCopies, target),
      directoryUnavailable: i === 0 && S.directoryUnavailable })).join("");
  showPop(`
    <div class="pop-head"><span class="tag tag--outline">Footnote ${n}</span><button type="button" class="pop-x" data-act="close" aria-label="Close">×</button></div>
    <div class="pop-body"><div class="pop-fn">${template.innerHTML}</div>
      <div class="source-reviews"><p class="eyebrow">Reviews &amp; evidence</p>${panels}</div>
      <button type="button" class="btn" data-act="edition-reviews">All edition reviews</button>
      <div class="pop-actions"><button type="button" class="btn" data-act="goto-fn">Go to footnote ↓</button><button type="button" class="btn" data-act="copy-fn">${ICON.copy}Copy source</button></div></div>`,
  anchor.getBoundingClientRect());
}
pop.addEventListener("submit", (e) => {
  const form = e.target.closest(".sr-form");
  if (!form || popState?.kind !== "fn") return;
  e.preventDefault();
  const target = popState.targets.find((t) => t.sourceUrl === form.dataset.reviewSource);
  const result = form.querySelector(".sr-form-result");
  try {
    const values = Object.fromEntries(new FormData(form));
    const saved = privateReviews.save(target, values);
    const { n, anchor, prefix } = popState;
    openFootnote(n, anchor, prefix);
    toast(accountStore.state.user?.approved ? "Saving private review to your account…" : saved.persisted ? "Private review saved in this browser" : "Browser storage unavailable: review kept for this session only");
  } catch (error) { result.textContent = error.message; }
});
function sanitizeFootnote(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  t.content.querySelectorAll("a[href]").forEach((a) => { if (!a.getAttribute("href").startsWith("#")) { a.target = "_blank"; a.rel = "noopener"; } });
  return t.innerHTML;
}
function goToFootnote(n, prefix = "") {
  const li = S.V.root.querySelector(`[id="${prefix}fn:${n}"]`) || document.getElementById(`${prefix}fn:${n}`);
  if (!li) return;
  goToElement(li, { block: "center" }).then(() => {
    li.classList.add("is-target");
    setTimeout(() => li.classList.remove("is-target"), 2200);
  });
}

/* --- clicks in the text -------------------------------------------------------------------- */
$("#doc").addEventListener("click", (e) => {
  const reviewMarker = e.target.closest(".review-marker");
  if (reviewMarker) { e.preventDefault(); openPassageReviews(reviewMarker); return; }
  const ref = e.target.closest(FOOTNOTE_REF_SELECTOR);
  if (ref) {
    e.preventDefault();
    const href = ref.getAttribute("href") || "";
    const n = Number(href.match(/(\d+)\s*$/)?.[1]);
    if (n) openFootnote(n, ref, href.startsWith("#old-") ? "old-" : "");
    return;
  }
  const back = e.target.closest('a[role="doc-backlink"], a.reversefootnote');
  if (back) {
    e.preventDefault();
    const target = S.V.root.querySelector(`[id="${CSS.escape(back.getAttribute("href").slice(1))}"]`);
    if (target) goToElement(target, { block: "center" });
    return;
  }
  const internal = e.target.closest('a[href^="#"]');
  if (internal) {
    let id = internal.getAttribute("href").slice(1);
    try { id = decodeURIComponent(id); } catch {}
    const target = S.V.root.querySelector(`[id="${CSS.escape(id)}"]`);
    if (target) { e.preventDefault(); history.replaceState(null, "", `${location.pathname}${location.search}#${id}`); goToElement(target); }
    return;
  }
  const mark = e.target.closest("mark.hl");
  if (mark && getSelection().isCollapsed && !e.target.closest("a")) openHighlight(mark.dataset.hid, mark, { x: e.clientX, y: e.clientY });
});
$("#doc").addEventListener("keydown", (e) => {
  const mark = e.target.closest?.("mark.hl");
  if (mark && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openHighlight(mark.dataset.hid, mark); }
});
$("#doc").addEventListener("pointerover", (e) => {
  const m = e.target.closest("mark.hl");
  document.querySelectorAll(".saved-item.is-lit").forEach((x) => x.classList.remove("is-lit"));
  if (m) document.querySelectorAll(`.saved-item[data-hid="${CSS.escape(m.dataset.hid)}"]`).forEach((x) => x.classList.add("is-lit"));
});

/* ================================================================== the rail: saved passages, or the list of changes */

function orderedRecords() {
  const at = (r) => S.checks.get(r.id)?.match?.start ?? r.pos?.start ?? 0;
  return seriesRecords().sort((a, b) => at(a) - at(b));
}
function savedHtml() {
  const recs = orderedRecords();
  const items = recs.map((r, i) => {
    const pin = r.para;
    const chk = S.checks.get(r.id)?.status;
    const off = chk === "absent" || (chk === "changed") || (r.check === "changed" && isLatest(S.C?.e));
    const from = !sameEdition(r, S.E[S.C?.e ?? S.tl.latest]) && r.version ? ` · from v${r.version}` : "";
    return `<li class="saved-item${off ? " is-changed" : ""}" data-hid="${esc(r.id)}" style="--i:${i}">
      <button type="button" class="saved-open" data-hid="${esc(r.id)}">
        <span class="saved-top"><span class="tag ${off ? "tag--muted" : "tag--outline"}">${esc(pinTag(pin, r.section))}</span><span class="saved-when">${esc(from.slice(3))}</span></span>
        <span class="saved-quote">“${esc(quoteOf(r))}”</span>
        ${r.comment ? `<span class="saved-comment">${esc(r.comment)}</span>` : ""}
      </button>
      ${statusHtml(r) ? `<span class="saved-status">${statusHtml(r)}</span>` : ""}</li>`;
  }).join("");
  return `<div class="rail-head"><h2 class="eyebrow">Saved from this report</h2><span class="numeral">${recs.length}</span></div>
    <div class="rail-style"><span class="eyebrow">Citation style</span>${segHtml({ hint: true })}</div>
    ${recs.length ? `<ul class="saved-list">${items}</ul>` : `<p class="rail-empty"><b>Nothing saved yet.</b> Select any passage, then choose <b>Save highlight</b>.
      Each saved passage keeps its paragraph number, the sources it cites and a citation to the edition you read it in, ready to paste.</p>`}
    <p class="rail-foot"><a href="../saved/index.html">All saved highlights →</a></p>`;
}
function changesHtml() {
  const r = S.redline;
  if (!r && S.rewrite) {                                            // phones' sheet; hidden beside the notice
    return `<div class="rail-head"><h2 class="eyebrow">Changes · ${esc(vLabel(S.E[S.rewrite.a]))} → ${esc(vLabel(S.E[S.rewrite.b]))}</h2></div>
      <p class="rail-empty"><b>A rewrite.</b> ${esc(capFirst(keptPercent(S.rewrite.sim)))} of the wording is kept, so there is no list of changes.</p>`;
  }
  if (!r) return `<div class="rail-head"><h2 class="eyebrow">Changes</h2></div><p class="rail-empty">Comparing…</p>`;
  const secText = new Map(r.res.toc.map((s) => [s.id, s.text]));
  const items = r.res.changes.map((c) => `<li><button type="button" data-k="${c.i}"${c.i === S.cur ? ' class="is-current"' : ""}>
      <span class="cl-k numeral">${c.i + 1}</span><span class="cl-l">${esc(c.label || "Change")}</span>
      <span class="cl-s">${esc(c.notes ? "Footnotes" : secText.get(c.sec) || "")}${c.ins || c.del ? ` · <span class="ni">+${fmtN(c.ins)}</span> <span class="nd">−${fmtN(c.del)}</span>` : ""}</span></button></li>`).join("");
  return `<div class="rail-head"><h2 class="eyebrow">Changes · ${esc(vLabel(S.E[r.a]))} → ${esc(vLabel(S.E[r.b]))}</h2><span class="numeral">${fmtN(r.res.stats.changes)}</span></div>
    <p class="rail-legend"><ins>inserted</ins> <del>deleted</del> <span>j / k to step</span></p>
    ${r.res.changes.length ? `<ol class="chg-list">${items}</ol>` : `<p class="rail-empty">No text changes between these editions.</p>`}
    <p class="rail-foot">Saved highlights show when changes are hidden.</p>`;
}
function renderRail() {
  $("#rail").innerHTML = S.mode === "changes" ? changesHtml() : savedHtml();
  if ($("#sheet").classList.contains("on") && sheetTab === "saved") renderSheet();
  if (popState?.kind === "hl") document.querySelectorAll(`.saved-item[data-hid="${CSS.escape(popState.id)}"]`).forEach((x) => x.classList.add("is-hot"));
}
document.addEventListener("click", (e) => {
  const open = e.target.closest(".saved-open");
  if (open) {
    const id = open.dataset.hid;
    if ($("#sheet").contains(open)) closeSheet();
    if (S.marks.get(id)?.length) goToHighlight(id, { open: true });
    else openHighlight(id, open.closest(".saved-item"));
    return;
  }
  const chg = e.target.closest(".chg-list button[data-k]");
  if (chg) { if ($("#sheet").contains(chg)) closeSheet(); goToChange(+chg.dataset.k); }
});
async function goToHighlight(id, { open = false } = {}) {
  const marks = S.marks.get(id);
  if (!marks?.length) { if (open) openHighlight(id); return; }
  closePop();
  await goToElement(marks[0], { block: open ? "start" : "center" });
  marks.forEach((m) => { m.classList.remove("is-flash", "is-new"); void m.offsetWidth; m.classList.add("is-flash"); });
  if (open) openHighlight(id, marks[0]);
}
function updateCounts() {
  const all = H.loadHighlights().length, here = seriesRecords().length;
  $("#savedCount").textContent = all;
  $("#dockCount").textContent = S.mode !== "changes" ? here : S.redline ? fmtN(S.redline.res.stats.changes || 0) : S.rewrite ? "–" : "0";
}
function bump() {
  updateCounts();
  const el = $("#savedCount");
  el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
}

/* ================================================================== find in the text */

const F = { q: "", hits: [], ranges: [], cur: -1, folded: null, foldedFor: null };
const findInput = $("#find");
const hasHighlightApi = typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight === "function";
const fold = (s) => {
  const out = [];
  for (const ch of s) {
    for (const unit of ch.length === 1 ? [ch] : ch) {
      const l = unit.toLowerCase();
      const c = l.length === 1 ? l : unit;
      out.push(c === "‘" || c === "’" || c === "′" ? "'" : c === "“" || c === "”" || c === "″" ? '"' : c);
    }
  }
  return out.join("");
};
function foldedText() {
  if (F.foldedFor !== S.V.root) {
    const { norm, map } = S.V.kind === "clean" ? normalizedClean() : H.normalizeWithMap(viewIndex().text);
    F.folded = { norm: fold(norm), map }; F.foldedFor = S.V.root;
  }
  return F.folded;
}
/** Text offset at a viewport y (caret hit-testing across the reading column), or null outside the text. */
function offsetAtY(y) {
  if (!S.V?.root) return null;
  const doc = (S.V.pair?.newCell || S.V.root).getBoundingClientRect();     // side by side: the contents follow the newer edition
  if (y < doc.top || y > doc.bottom) return null;
  for (const x of [doc.left + 24, doc.left + doc.width * 0.3, doc.left + doc.width * 0.6]) {
    let node = null, off = 0;
    if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); node = r?.startContainer; off = r?.startOffset || 0; }
    else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); node = p?.offsetNode; off = p?.offset || 0; }
    if (node && S.V.root.contains(node)) return viewIndex().offsetOf(node, off);
  }
  return null;
}
const offsetAtViewportTop = () => offsetAtY(headOffset() + 4) ?? 0;
function runFind(q, { jump = true } = {}) {
  F.q = q;
  const nq = fold(H.normWs(q));
  clearFindMarks();
  if (!S.ready && !S.V || nq.length < 2 || !S.V) { F.hits = []; F.ranges = []; F.cur = -1; updateFindUI(); return; }
  const { norm, map } = foldedText();
  const hits = [];
  for (let i = norm.indexOf(nq); i >= 0 && hits.length < 5000; i = norm.indexOf(nq, i + nq.length)) hits.push([map[i], map[i + nq.length - 1] + 1]);
  F.hits = hits;
  const ix = viewIndex();
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
  if (r.height && r.top >= headOffset() && r.bottom <= innerHeight - 60) return;
  if (inOldPane(range.startContainer)) glideTo(() => oldPaneRect(() => range.getBoundingClientRect()));
  else glideTo(() => range.getBoundingClientRect(), { block: "center" });
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
  minimap?.schedule();                                   // matches, and which is current
}
let findTimer = 0;
findInput.addEventListener("input", () => { S.qDropped = true; clearTimeout(findTimer); findTimer = setTimeout(() => runFind(findInput.value), 140); });
findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); clearTimeout(findTimer); stepFind(e.shiftKey ? -1 : 1); }
  if (e.key === "Escape") { findInput.value = ""; runFind(""); findInput.blur(); setFindOpen(false); }
});
$("#findPrev").addEventListener("click", () => stepFind(-1));
$("#findNext").addEventListener("click", () => stepFind(1));
function setFindOpen(open) {
  $("#top").classList.toggle("find-open", open);
  $("#findToggle").setAttribute("aria-expanded", String(open));
  if (open) requestAnimationFrame(() => findInput.focus({ preventScroll: true }));
}

/* --- ?q=<query>: opened from a search result. Fill find-in-text with the query and glide to its first
   match at or after the section in the address (#heading-id). Search matches words, not phrases, so if
   the whole query is not in the text, the longest run of its words that is (soonest after that point)
   is used instead: "internal relocation Kabul" -> "internal relocation". */
const QUERY_STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "are", "was", "not", "but"]);
function findFromQuery() {
  const q = H.normWs(WANT.q.replace(/^\s*"(.+)"\s*$/, "$1"));
  const id = decodeURIComponent(location.hash.slice(1));
  if (q.length < 2 || id.startsWith("h=") || !S.V) return false;
  const el = id ? S.V.root.querySelector(`[id="${CSS.escape(id)}"]`) : null;
  const from = el ? (viewIndex().firstTextAt(el) ?? 0) : 0;
  const { norm, map } = foldedText();
  const nextAt = (term) => {
    const t = fold(term);
    for (let i = norm.indexOf(t); i >= 0; i = norm.indexOf(t, i + 1)) if (map[i] >= from) return map[i];
    return norm.includes(t) ? Infinity : -1;
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
  if (narrow.matches) setFindOpen(true);
  runFind(term, { jump: false });
  if (!F.hits.length) { if (el) goToElement(el); return true; }
  const k = F.hits.findIndex(([a]) => a >= from);
  goFind(k < 0 ? 0 : k);
  return true;
}

/* ================================================================== address */

function syncUrl() {
  if (!S.series) return;
  const b = S.mode === "changes" && S.pair ? S.pair.b : shownEdition();
  const url = reportUrl({
    country: COUNTRY, series: SERIES,
    edition: isLatest(b) ? null : S.E[b].id,
    changes: S.mode === "changes",
    from: S.mode === "changes" && S.pair && S.pair.a !== S.pair.b - 1 ? S.E[S.pair.a].id : null,
    view: S.view,
    q: WANT.q && !S.qDropped ? WANT.q : null,
  }, location.hash);
  const here = location.pathname.split("/").pop() + location.search + location.hash;
  if (url !== here) history.replaceState(null, "", url);
}

function routeHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h || !S.ready) return;
  const m = /^h=(.+)$/.exec(h);
  if (m) {
    const id = m[1];
    if (S.marks.get(id)?.length || S.mode !== "read") return goToHighlight(id, { open: true });
    // Not in the edition shown: open the edition it was saved from, if held.
    const rec = recById(id), E = rec && S.E.find((x) => sameEdition(rec, x));
    if (E && E.i !== S.C?.e) {
      slider.place(null, E.k);
      showEdition(E.i);
      return goToHighlight(id, { open: true });
    }
    return goToHighlight(id, { open: true });
  }
  const el = S.V?.root.querySelector(`[id="${CSS.escape(h)}"]`);
  if (el) goToElement(el);
}

/* ================================================================== chrome: theme, keys, sheet, progress */

let sheetTab = "toc";
function renderSheet() {
  const body = $("#sheetBody");
  body.innerHTML = sheetTab === "toc" ? `<nav class="toc">${tocHtml()}</nav>` : `<div class="rail">${S.mode === "changes" ? changesHtml() : savedHtml()}</div>`;
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
const rIns = new NumberRoller($("#rIns"), 6), rDel = new NumberRoller($("#rDel"), 6), rChg = new NumberRoller($("#rChg"), 4);
rollers.push(rIns, rDel, rChg);
function measureBars() {
  const root = document.documentElement.style;
  root.setProperty("--stick-top", `${$("#top").offsetHeight}px`);
  root.setProperty("--bar-h", `${$("#bar").hidden ? 0 : $("#bar").offsetHeight}px`);
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
    if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); if (narrow.matches) setFindOpen(true); findInput.focus(); findInput.select(); return; }
    const plain = !typing && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (plain && (e.key === "j" || e.key === "k")) {
      if (F.hits.length) { e.preventDefault(); goFind(F.cur + (e.key === "j" ? 1 : -1)); return; }
      if (S.mode === "changes") { e.preventDefault(); goToChange(e.key === "j" ? S.cur + 1 : Math.max(0, S.cur - 1)); return; }
    }
    if (plain && e.key === "c" && !e.target.closest?.(".rs-handle")) { e.preventDefault(); setMode(S.mode === "changes" ? "read" : "changes"); return; }
    if (e.key === "Escape") {
      if (closeHeadPop()) return;
      if (!$("#clogPanel").hidden) { setClogOpen(false); $("#clogBtn").focus(); return; }
      if (popState) closePop();
      else if (toolOpen()) dropSelection();
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
  document.addEventListener("click", (e) => {
    const a = e.target.closest(".toc a[data-sec]");
    if (!a) return;
    e.preventDefault();
    const s = S.V.sections[Number(a.dataset.sec)];
    if (!s?.el) return;
    if ($("#sheet").contains(a)) closeSheet();
    history.replaceState(null, "", `${location.pathname}${location.search}#${s.id}`);
    goToElement(s.el);
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "next-dead") nextDead();
    if (b.dataset.act === "rw-pair") { closeSheet(); chooseRewriteView("pair"); }
    if (b.dataset.act === "rw-redline") { closeSheet(); chooseRewriteView("redline"); }
  });
  $("#doc").addEventListener("click", (e) => { const b = e.target.closest(".pv-switch button[data-show]"); if (b) setPairShow(b.dataset.show); });
  $("#latestMini").addEventListener("click", () => readLatest());
  $("#changesBtn").addEventListener("click", () => setMode(S.mode === "changes" ? "read" : "changes"));
  $("#vseg").addEventListener("click", (e) => { const b = e.target.closest("button[data-view]"); if (b && !b.disabled) setView(b.dataset.view); });
  $("#prevBtn").addEventListener("click", () => goToChange(Math.max(0, S.cur - 1)));
  $("#nextBtn").addEventListener("click", () => goToChange(S.cur + 1));
  $("#findToggle").addEventListener("click", () => setFindOpen(!$("#top").classList.contains("find-open")));
  narrow.addEventListener("change", () => { applyModeUI(); if (S.mode === "changes" && S.redline) paintRedline(S.redline.a, S.redline.b, S.redline.res); });

  const bar = $("#progress");
  let ticking = false;
  addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const p = Math.max(0, Math.min(1, scrollY / Math.max(1, maxScroll())));
      bar.style.transform = `scaleX(${p.toFixed(4)})`;
      $("#bar").classList.toggle("is-stuck", $("#bar").getBoundingClientRect().top <= $("#top").offsetHeight + 0.5);
    });
  }, { passive: true });
  // (The touch sheet stays through a resize: Safari's toolbar sliding away is one. It only checks which edge is clear.)
  // A popover is put away when the window's width changes (its place no longer holds), not when only its
  // height does: on a phone that is Safari's toolbar sliding away under a finger.
  let lastWidth = innerWidth;
  addEventListener("resize", () => {
    if (popState && innerWidth !== lastWidth) closePop();
    lastWidth = innerWidth;
    if (tool.classList.contains("is-touch")) placeSheet(); else hideTool();
    moveIndicator(); rollers.forEach((r) => r.remeasure(true));
  });
  addEventListener("hashchange", () => routeHash());
  new ResizeObserver(measureBars).observe($("#top"));
  new ResizeObserver(measureBars).observe($("#bar"));
  measureBars();
}

/* ================================================================== minimap */

// The strip beside the text (../shared/minimap.js): section ticks; with changes shown, insertions and deletions;
// otherwise saved highlights and dead sources; find matches in either. Rebuilt (debounced) whenever the text
// shown, its marks or its layout change. (`minimap` is declared with the state.)
const DEAD_LINKS = 'a[data-link-status="broken"], a[data-link-status="server-error"], a[data-link-status="unreachable"]';
function setupMinimap() {
  const host = $("#minimap");
  if (!host) return;
  const where = {                                         // what both strips are told about the text
    doc: $("#doc"),
    observe: [$("#head"), $("#history"), $("#editionNote")],
    insetTop: () => $("#top").offsetHeight + ($("#bar").hidden ? 0 : $("#bar").offsetHeight),
    positioner: (doc) => {
      if (!S.V?.root?.isConnected) return new DocPositioner(doc);
      const ix = viewIndex(), P = pairOf();
      if (P && pairLinked(P)) {                           // side by side: the strip follows the newer edition (the page's scroll)
        return new DocPositioner(doc, { chunks: ".sbs-cell.new .cv", offsetOf: (el) => (P.pane.contains(el) ? null : ix.firstTextAt(el)), length: ix.length });
      }
      return new DocPositioner(doc, { offsetOf: (el) => ix.firstTextAt(el), length: ix.length });
    },
  };
  minimap = new Minimap(host, {
    ...where,
    onSeek: () => stopGlide(),
    labelRoom: (strip) => {
      const reader = $("#reader"), rail = $("#rail").getBoundingClientRect();
      const edge = rail.width ? rail.left - 12 : reader.getBoundingClientRect().right - parseFloat(getComputedStyle(reader).paddingRight || 0);
      return edge - strip.right;
    },
    collect: minimapMarks,
  });
  // Phones: its quiet cousin down the left edge of the screen (./phone.js), from the same positions.
  if ($("#edge")) edgeStrip = new EdgeStrip($("#edge"), { ...where, collect: edgeTicks });
}
/** Rebuild after the text shown changed; ease the new marks in when it is a different text. */
function refreshMinimap() {
  const fresh = S.V?.root !== minimapRoot;
  minimapRoot = S.V?.root || null;
  minimap?.schedule({ fade: fresh && S.ready });
  edgeStrip?.schedule();
}
/** The edge strip's ticks: where each main section starts (the highest level of heading the text has). */
function edgeTicks(pos) {
  const V = S.V;
  if (!V?.root?.isConnected || (V.pair && !pairLinked(V.pair) && pairShow === "old")) return [];   // phones, the older of a pair: the sections are the newer one's
  const secs = V.sections.filter((s) => s.el?.isConnected);
  const level = Math.min(...secs.map((s) => s.level));
  return secs.filter((s) => s.level === level).map((s) => pos.yOf(s.el)[0]);
}
function minimapMarks(pos) {
  const V = S.V;
  if (!V?.root?.isConnected) return {};
  const marks = [], sections = [];
  const redline = V.kind === "redline" && S.redline ? S.redline : null;
  for (const s of V.sections) {
    if (!s.el?.isConnected || s.level > 3) continue;
    const [y] = pos.yOf(s.el);
    sections.push({ y, label: s.title, level: s.level, count: redline ? s.count : 0 });
    marks.push({ kind: s.level === 2 ? "h2" : "h3", y0: y });
  }
  if (redline) {
    // One mark per change, from its first block to its last, in the lane of what it does: deleted words
    // (left, red), inserted words (right, blue); a reworded passage has both.
    for (const [k, els] of S.hunks) {
      if (!els.length) continue;
      const c = redline.res.changes[k];
      const y0 = pos.yOf(els[0])[0], y1 = pos.yOf(els[els.length - 1])[1];
      const added = els.every((e) => e.classList.contains("is-added")), removed = els.every((e) => e.classList.contains("is-removed"));
      const ins = added || (c ? c.ins > 0 : !removed), del = removed || (c ? c.del > 0 : !added);
      if (ins) marks.push({ kind: "ins", y0, y1, weight: c?.ins || 1 });
      if (del) marks.push({ kind: "del", y0, y1, weight: c?.del || 1 });
      if (!ins && !del) marks.push({ kind: "mod", y0, y1 });
    }
  } else {
    if (V.kind === "clean") for (const [, chk] of S.checks) if (chk.match) marks.push({ kind: "hl", y0: pos.yAt(chk.match.start), y1: pos.yAt(chk.match.end) });
    for (const a of (V.pair?.newCell || V.root).querySelectorAll(DEAD_LINKS)) { const [y0, y1] = pos.yOf(a); marks.push({ kind: "dead", y0, y1 }); }
  }
  const from = V.pair && pairLinked(V.pair) ? viewIndex().firstTextAt(V.pair.newCell) ?? 0 : 0;   // matches in the older pane have no place on the strip
  if (F.foldedFor === V.root) F.hits.forEach(([a, b], i) => { if (a >= from) marks.push({ kind: i === F.cur ? "find-cur" : "find", y0: pos.yAt(a), y1: pos.yAt(b) }); });
  return { sections, marks, changes: !!redline };
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
    for (let k = 0; k <= nth; k++) { i = S.C.text.indexOf(text, i + 1); if (i < 0) return null; }
    return [i, i + text.length];
  };
  window.cpinReader = {
    ready,
    offsetsOf,
    select(text, nth = 0) {
      const o = offsetsOf(text, nth);
      if (!o) return null;
      const r = S.C.ix.range(o[0], o[1]);
      warm(r.startContainer.parentElement);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      checkSelection();
      const p = S.pending;
      return p && { s: p.s, e: p.e, quote: p.selector.quote, spaced: p.spaced, lead: p.lead, para: p.para, section: p.section, sources: p.sources, toolVisible: !tool.hidden };
    },
    pending: () => S.pending && { quote: S.pending.selector.quote, spaced: S.pending.spaced, lead: S.pending.lead, para: S.pending.para, section: S.pending.section, sources: S.pending.sources },
    save: () => (S.pending ? saveHighlight(S.pending) : null),
    async copy(kind = "both") {
      const info = S.pending;
      if (!info) return null;
      const payload = kind === "both" ? quoteWithCitation(ctxFromInfo(info), citeStyle, info.sources) : formatCitation(ctxFromInfo(info), citeStyle);
      const ok = await copyRich(payload);
      return { ok, ...S.lastCopy };
    },
    cite: () => S.pending && formatCitation(ctxFromInfo(S.pending), citeStyle).text,
    lastCopy: () => S.lastCopy,
    lastPlain: () => S.lastPlain ?? null,
    open: (id) => openHighlight(id),
    goTo: (id) => goToHighlight(id, { open: true }),
    find: (q) => { findInput.value = q; runFind(q); return { hits: F.hits.length, cur: F.cur }; },
    step: (d) => { goFind(F.cur + d); return F.cur; },
    style: (s) => setStyle(s),
    highlights: () => seriesRecords(),
    checks: () => Object.fromEntries([...S.checks].map(([id, c]) => [id, c.status])),
    marks: (id) => (S.marks.get(id) || []).map((m) => m.textContent).join(""),
    state: () => ({
      mode: S.mode, view: S.view, edition: S.C?.e, editionId: S.C && S.E[S.C.e].id, version: S.C && S.E[S.C.e].version,
      latest: S.tl.latest, stop: slider.b, from: slider.a, pair: S.pair, stops: S.tl.stops.length, editions: S.E.length,
      sections: S.V?.sections.length, view_kind: S.V?.kind, changes: S.redline?.res.stats.changes ?? null,
      caption: $("#wc .wc-in:not(.out)")?.innerText, asat: $("#asat").getAttribute("aria-label") || $("#histMini").textContent,
      url: location.search, links: S.C?.linkCounts?.counts || null, textLength: S.C?.text.length,
      rewrite: S.rewrite && { a: S.rewrite.a, b: S.rewrite.b, sim: S.rewrite.sim, view: S.rewrite.view },
      note: $("#editionNote").hidden ? null : $("#editionNote").innerText, meta: $("#metaLine")?.innerText, chip: $("#edChip")?.innerText,
      verbatim: $("#verbatimChip")?.title, sources: $("#sourcesChip")?.hidden ? null : $("#sourcesChip")?.innerText,
    }),
    rewriteView: (v) => chooseRewriteView(v),
    forgetRewriteView: () => { rewriteChoice = null; try { sessionStorage.removeItem(REWRITE_VIEW_KEY); } catch {} },
    pairShow: (side) => setPairShow(side),
    headPop: (kind) => (kind ? openHeadPop(kind) : closeHeadPop()),
    allEditions: (open) => setClogOpen(open),
    captionOpen: (open) => setCaptionOpen(open),
    setMode: (m, pair) => setMode(m, pair ? { pair } : {}),
    setView: (v) => setView(v),
    moveTo: (k) => slider.moveTo("b", k, 0),
    pick: (k) => pickStop(k),
    latest: () => readLatest(),
    ref: (num, kind = "section") => { const a = document.createElement("a"); a.dataset.ref = num; a.dataset.kind = kind; goToRef(a); },
    refs: () => [...document.querySelectorAll("#wc .wc-in:not(.out) a.ref")].map((a) => a.textContent),
    clickRef: (n = 0) => document.querySelectorAll("#wc .wc-in:not(.out) a.ref")[n]?.click(),
    setLinks: (map) => { S.linkMap = map; if (S.V?.root) delete S.V.root.dataset.linksDone; decorateView(); return S.C?.linkCounts?.counts; },
    pairDone: () => pairDone,
    textAt: (s, e) => S.C.text.slice(s, e),
    minimap: () => minimap && {
      height: minimap.h, docHeight: Math.round(minimap.docH), marks: minimap.marks.length, drawn: minimap.drawn,
      sections: minimap.sections.length, labels: minimap.kept.length, cost: Math.round((minimap.cost || 0) * 10) / 10,
      view: [Math.round(minimap.viewT), Math.round(minimap.viewB)], classes: $("#minimap").className, dirty: minimap.dirty, builds: minimap.builds,
    },
    edge: () => edgeStrip && {
      height: edgeStrip.h, docHeight: Math.round(edgeStrip.docH), builds: edgeStrip.builds || 0, classes: $("#edge").className,
      ticks: [...edgeStrip.ticks.children].filter((t) => t.classList.contains("on")).length, view: edgeStrip.h ? edgeStrip.window() : null,
    },
  };
}
