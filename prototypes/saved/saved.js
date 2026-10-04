// CPIN Explorer · saved highlights across every note, grouped by country and note, each with its
// citation (OSCOLA or tribunal), the sources it cites, a private note and a staleness check against
// the edition now held. Records live in this browser (localStorage "cpin-highlights-v1").
import { drawDotFlag, hydrateFlags } from "../shared/dot-flag.js";
import { fetchJson } from "../shared/fetch-json.js";
import {
  capFirst, escHtml as esc, formatCitation, formatPinpoint, longDate, monthLabel, quoteOf, quoteWithCitation, sourceOf, STYLE_HINTS, STYLE_LABELS, STYLE_NAMES, titleMonth,
} from "../shared/citation.js";
import * as H from "../shared/highlights.js";
import { analyseBody, describePassage, editionSource, fetchText, latestCapture, parseBody, paths, pickEdition } from "../shared/note-source.js";
import { ukParts } from "../shared/uk-time.js";

const $ = (sel, root = document) => root.querySelector(sel);
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const STYLE_KEY = "cpin-cite-style";
let style = (() => { try { return localStorage.getItem(STYLE_KEY) === "tribunal" ? "tribunal" : "oscola"; } catch { return "oscola"; } })();
let data = null;
const params = new URLSearchParams(location.search);
const TEST = params.get("test") === "export";        // headless checks of Export to Word (see the end)
const testErrors = [];
if (TEST) {
  addEventListener("error", (e) => testErrors.push(String(e.message || e)));
  addEventListener("unhandledrejection", (e) => testErrors.push(String(e.reason?.stack || e.reason)));
  const consoleError = console.error.bind(console);
  console.error = (...args) => { testErrors.push(args.map((a) => String(a?.stack || a)).join(" ")); consoleError(...args); };
}
const checking = new Set();          // "country|note" being checked against the edition now held
let quiet = 0;                       // our own writes: don't re-render on them

const noteInfo = (country, note) => {
  const c = data?.countries.find((x) => x.slug === country);
  return { c, n: c?.notes.find((x) => x.id === note) || null };
};
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/* ------------------------------------------------------------------ render */

function render() {
  const recs = H.loadHighlights();
  const groups = H.groupHighlights(recs);
  const notes = groups.reduce((k, c) => k + c.notes.length, 0);
  $("#hero").innerHTML = `
    <a class="btn back" href="../dashboard/index.html" style="--i:0">← Dashboard</a>
    <p class="eyebrow" style="--i:1">Country notes · your highlights</p>
    <h1 class="hero-title" style="--i:2">Saved</h1>
    <p class="lede" style="--i:3">Passages you have highlighted in the reader, each with a citation ready to paste, the sources it cites and your own notes.</p>
    ${recs.length ? `<div class="sv-stats" style="--i:4">
      <div><span class="numeral">${recs.length}</span><span class="eyebrow">${recs.length === 1 ? "Highlight" : "Highlights"}</span></div>
      <div><span class="numeral">${notes}</span><span class="eyebrow">${notes === 1 ? "Note" : "Notes"}</span></div>
      <div><span class="numeral">${groups.length}</span><span class="eyebrow">${groups.length === 1 ? "Country" : "Countries"}</span></div></div>
      <p class="sv-local" style="--i:5">Kept in this browser only (there are no accounts yet). Download a copy to keep them safe.</p>` : ""}`;
  $("#tools").hidden = !recs.length;
  setStyle(style, { persist: false, rerender: false });
  $("#groups").innerHTML = recs.length ? groups.map(countryHtml).join("") : emptyHtml();
  hydrateFlags($("#groups"));
}

function countryHtml(g, i) {
  const c = data?.countries.find((x) => x.slug === g.country);
  const iso = c?.iso_a2 || g.notes[0]?.items[0]?.iso;
  const count = g.notes.reduce((k, n) => k + n.items.length, 0);
  return `<section class="sv-country" id="c-${esc(g.country)}" style="--i:${i}">
    <header class="sv-country-head">
      ${iso ? `<canvas class="dotflag" data-flag="${esc(iso)}" data-cols="24" data-reveal aria-hidden="true"></canvas>` : ""}
      <div><p class="eyebrow">Country</p><h2 class="sv-country-name">${esc(g.countryName)}</h2></div>
      <span class="tag tag--outline">${count} saved</span>
    </header>
    ${g.notes.map((n) => noteHtml(g, n)).join("")}
  </section>`;
}

function noteHtml(g, group) {
  const { n } = noteInfo(g.country, group.note);
  const first = group.items[0];
  const kind = n?.kind || first.kind || "Note";
  const version = n?.version || first.version;
  const month = monthLabel(n?.month || first.month);
  const gone = n && n.status !== "live";
  const when = [month?.short?.toUpperCase(), version ? `V${version}` : ""].filter(Boolean).join(" · ");
  return `<article class="sv-note" data-note="${esc(group.note)}">
    <div class="sv-note-head">
      <div class="sv-note-top"><span class="tag ${gone ? "tag--muted" : "tag--outline"}">${esc(kind)}</span><span class="sv-note-when">${esc(when)}</span>
        ${gone ? `<span class="tag tag--muted">${n.status === "removed" ? "Removed from GOV.UK" : "Archived copy only"}</span>` : ""}</div>
      <h3 class="sv-note-title">${esc(capFirst(group.topic || n?.topic || group.title))}</h3>
      <p class="note-verbatim">${esc(n?.title || group.title)}</p>
      <div class="sv-note-links">
        <a class="btn" href="${esc(paths.report(first))}">${gone ? "Read the last edition" : "Read the latest guidance"} →</a>
        ${n?.compare_url && n.editions > 1 ? `<a class="btn" href="${esc(n.compare_url)}">Show changes across ${n.editions} editions</a>` : ""}
      </div>
    </div>
    <ol class="sv-items">${group.items.map((r) => itemHtml(r, g.country)).join("")}</ol>
  </article>`;
}

function statusHtml(r) {
  if (checking.has(`${r.country}|${r.note}`) && r.check !== "changed" && r.check !== "still") return `<span class="badge badge--checking">Checking the latest edition…</span>`;
  if (r.check === "changed") {
    const { n } = noteInfo(r.country, r.note);
    return `<span class="badge badge--changed">Changed since you saved it (v${esc(r.version || "?")} → v${esc(r.current?.version || "?")})</span>${
      n?.compare_url ? ` <a class="badge-link" href="${esc(n.compare_url)}">Show what changed →</a>` : ""}`;
  }
  if (r.check === "still" && r.current?.version) return `<span class="badge">Still in v${esc(r.current.version)}</span>`;
  return "";
}

function itemHtml(r) {
  const now = r.check === "still" && r.current ? r.current : r;
  const sources = r.sources || [];
  return `<li class="sv-item${r.check === "changed" ? " is-changed" : ""}" id="h-${esc(r.id)}" data-hid="${esc(r.id)}">
    <div class="sv-item-top"><span class="tag">${esc(now.para ? formatPinpoint(now.para) : "Passage")}</span>
      ${now.section ? `<span class="eyebrow" title="Section">${esc(now.section)}</span>` : ""}
      <span class="sv-status">${statusHtml(r)}</span>
      <time class="saved-when" datetime="${esc(r.createdAt || "")}">Saved ${esc(r.createdAt ? longDate(r.createdAt) : "")}</time></div>
    <blockquote class="sv-quote">“${esc(quoteOf(r))}”</blockquote>
    <div class="cite">${formatCitation(H.citeContext(r), style).html}</div>
    ${sources.length ? `<details class="sources"${sources.length <= 3 ? " open" : ""}><summary>Sources cited in this passage · ${sources.length}</summary><ol>${sources.map((s) =>
      `<li><b>[${s.n}]</b><span>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.text)}</a>` : esc(s.text)}</span></li>`).join("")}</ol></details>` : ""}
    <div class="sv-note-field"><label class="field-label" for="c-${esc(r.id)}"><span class="eyebrow">Private note</span><span class="saved-flag">Saved</span></label>
      <textarea class="comment" id="c-${esc(r.id)}" data-hid="${esc(r.id)}" placeholder="Only kept in this browser.">${esc(r.comment || "")}</textarea></div>
    <div class="sv-actions">
      <button type="button" class="btn btn--primary" data-act="copy-both">Copy quote + citation</button>
      <button type="button" class="btn" data-act="copy-cite">Copy citation</button>
      <a class="btn" href="${esc(paths.report(r, `#h=${encodeURIComponent(r.id)}`))}">Open in reader →</a>
      <button type="button" class="btn btn-del" data-act="delete">Delete</button>
    </div>
  </li>`;
}

function emptyHtml() {
  const recent = (data?.countries || []).flatMap((c) => c.notes.filter((n) => n.status === "live" && !n.pdf_only).map((n) => ({ c, n })))
    .sort((a, b) => String(b.n.updated).localeCompare(String(a.n.updated)) || String(b.n.month).localeCompare(String(a.n.month))).slice(0, 6);
  return `<div class="sv-empty">
    <div style="--i:0"><p class="eyebrow">Nothing saved yet</p></div>
    <ol class="sv-steps" style="--i:1">
      <li><span class="numeral">1</span><p><b>Open a note in the reader.</b> Every edition is shown verbatim, as published on GOV.UK.</p></li>
      <li><span class="numeral">2</span><p><b>Select a passage.</b> A bar appears with its paragraph number.</p></li>
      <li><span class="numeral">3</span><p><b>Choose Save highlight.</b> It is kept here with a citation, full (OSCOLA) or short (tribunal), a link that jumps to the words on GOV.UK, and the sources the passage cites.</p></li>
    </ol>
    <div class="sv-demo" style="--i:2" aria-hidden="true"><span class="st-pin">PARA 9.1.1</span><span>Save highlight</span><span>Copy quote + citation</span><span>Copy citation</span></div>
    ${recent.length ? `<section class="sv-start" style="--i:3"><h2 class="eyebrow">Start with a recent note</h2><ul>${recent.map(({ c, n }) =>
      `<li><a class="row" href="${esc(paths.reader(c.slug, n.id))}">${c.iso_a2 ? `<canvas class="dotflag dotflag--row" data-flag="${esc(c.iso_a2)}" data-cols="8" aria-hidden="true"></canvas>` : ""}<span>${esc(c.name)}: ${esc(capFirst(n.topic || n.title))}</span><small>${esc(n.kind)}</small></a></li>`).join("")}</ul></section>` : ""}
  </div>`;
}

/* ------------------------------------------------------------------ style */

function setStyle(next, { persist = true, rerender = true } = {}) {
  style = next === "tribunal" ? "tribunal" : "oscola";
  if (persist) { try { localStorage.setItem(STYLE_KEY, style); } catch {} }
  document.querySelectorAll(".seg").forEach((seg) => {
    seg.dataset.value = style;
    seg.querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-checked", String(b.dataset.style === style));
      b.textContent = STYLE_LABELS[b.dataset.style] || b.textContent;          // "Full (OSCOLA)" | "Short (tribunal)", as in the reader
      b.title = STYLE_HINTS[b.dataset.style] || "";
    });
  });
  document.querySelectorAll("[data-style-hint]").forEach((p) => { p.textContent = STYLE_HINTS[style]; });   // what the chosen style produces
  if (!rerender) return;
  const recs = new Map(H.loadHighlights().map((r) => [r.id, r]));
  document.querySelectorAll(".sv-item").forEach((li) => {
    const r = recs.get(li.dataset.hid);
    const box = $(".cite", li);
    if (!r || !box) return;
    box.innerHTML = formatCitation(H.citeContext(r), style).html;
    if (!reduced.matches) { box.classList.remove("swap"); void box.offsetWidth; box.classList.add("swap"); }
  });
}
document.addEventListener("click", (e) => { const b = e.target.closest(".seg button[data-style]"); if (b) setStyle(b.dataset.style); });
addEventListener("storage", (e) => { if (e.key === STYLE_KEY && e.newValue) setStyle(e.newValue, { persist: false }); });

/* ------------------------------------------------------------------ actions */

async function copyRich({ text, html }) {
  window.__cpinLastCopy = { text, html };
  try {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([`<meta charset="utf-8">${html}`], { type: "text/html" }),
      })]);
      return true;
    }
  } catch {}
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const onCopy = (e) => { e.clipboardData.setData("text/plain", text); e.clipboardData.setData("text/html", html); e.preventDefault(); };
  document.addEventListener("copy", onCopy);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch {}
  document.removeEventListener("copy", onCopy);
  return ok;
}
const copied = (ok, what) => toast(ok ? `Copied ${what}` : "Your browser blocked the clipboard");

$("#groups").addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const li = b.closest(".sv-item");
  const r = H.loadHighlights().find((x) => x.id === li?.dataset.hid);
  if (!r) return;
  if (b.dataset.act === "copy-both") copyRich(quoteWithCitation(H.citeContext(r), style, r.sources)).then((ok) => copied(ok, "quote and citation"));
  if (b.dataset.act === "copy-cite") copyRich(formatCitation(H.citeContext(r), style)).then((ok) => copied(ok, `${STYLE_NAMES[style]} citation`));
  if (b.dataset.act === "delete") {
    li.classList.add("leaving");
    setTimeout(() => {
      quiet++;
      const removed = H.removeHighlight(r.id);
      quiet--;
      render();
      if (removed) toast("Highlight deleted", { action: "Undo", onAction: () => { quiet++; H.restoreHighlight(removed); quiet--; render(); } });
    }, reduced.matches ? 0 : 260);
  }
});

let commentTimers = new Map();
$("#groups").addEventListener("input", (e) => {
  const ta = e.target.closest("textarea.comment");
  if (!ta) return;
  const id = ta.dataset.hid;
  clearTimeout(commentTimers.get(id));
  commentTimers.set(id, setTimeout(() => {
    quiet++;
    H.updateHighlight(id, { comment: ta.value });
    quiet--;
    const flag = ta.parentElement.querySelector(".saved-flag");
    flag?.classList.add("on");
    setTimeout(() => flag?.classList.remove("on"), 1200);
  }, 350));
});

$("#copyAll").addEventListener("click", () => {
  const recs = H.groupHighlights(H.loadHighlights()).flatMap((c) => c.notes.flatMap((n) => n.items));
  const cites = recs.map((r) => formatCitation(H.citeContext(r), style));
  copyRich({ text: cites.map((c) => c.text).join("\n"), html: `<ol>${cites.map((c) => `<li>${c.html}</li>`).join("")}</ol>` })
    .then((ok) => copied(ok, `${plural(cites.length, "citation")} (${STYLE_NAMES[style]})`));
});
function download(name, type, body) {
  const blob = body instanceof Blob ? body : new Blob([body], { type });
  if (TEST) { (window.__cpinDownloads ||= []).push({ name, type, blob }); return; }   // ?test: keep it for the check below
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/** Today's date for a file name, on the site's one clock (UK time): "2026-10-04". */
const stamp = () => { const d = ukParts(new Date()); return `${d.year}-${String(d.month + 1).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`; };
$("#dlMd").addEventListener("click", () => download(`cpin-highlights-${stamp()}.md`, "text/markdown;charset=utf-8", H.exportMarkdown(H.loadHighlights(), { style })));
$("#dlJson").addEventListener("click", () => download(`cpin-highlights-${stamp()}.json`, "application/json", H.exportJson(H.loadHighlights())));

/* ------------------------------------------------------------------ export to Word */

// The docx library (prototypes/vendor/docx.js, ~450 KB), the builder and the fonts Word embeds are
// fetched on the first export only, so the page itself stays light.
let wordKit = null;
const fetchBytes = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};
const canvasPng = (canvas) => new Promise((resolve, reject) => canvas.toBlob((blob) =>
  blob ? blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject) : reject(new Error("canvas.toBlob failed")), "image/png"));

function loadWordKit() {
  wordKit ??= (async () => {
    const [docx, builder] = await Promise.all([import("../vendor/docx.js"), import("../shared/citations-docx.js")]);
    const fonts = Object.fromEntries(await Promise.all(builder.fontFilesFor().map(async (f) =>
      [f.file, await fetchBytes(`../vendor/fonts/${f.file}`).catch((e) => { console.warn("Word export: font not loaded, falling back to Office fonts", e); return null; })])));
    const logo = await productMark().catch((e) => { console.warn("Word export: no CPIN Explorer mark", e); return null; });
    const rm = await fetchBytes("../../assets/roberts-macros/derived/rm-mark-ink.png").catch((e) => { console.warn("Word export: no RM mark", e); return null; });
    return { docx, builder, fonts, logo, rm };
  })().catch((error) => { wordKit = null; throw error; });
  return wordKit;
}

/** CPIN Explorer's mark (the dotted globe) at 192 × 192 for the document header; the file is 512 × 512. */
async function productMark() {
  const bitmap = await createImageBitmap(new Blob([await fetchBytes("../../assets/cpin-explorer/mark-512.png")], { type: "image/png" }));
  const canvas = document.createElement("canvas");
  canvas.width = 192; canvas.height = 192;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvasPng(canvas);
}

/** Each country's dotted flag as a PNG, drawn for paper: white dots keep the light theme's pale fill. */
async function flagPngs(records) {
  const out = {};
  for (const slug of new Set(records.map((r) => r.country))) {
    const iso = data?.countries.find((c) => c.slug === slug)?.iso_a2 || records.find((r) => r.country === slug && r.iso)?.iso;
    if (!iso) continue;
    try {
      const canvas = document.createElement("canvas");
      canvas.dataset.flagWidth = "96";
      await drawDotFlag(canvas, iso, { cols: 24 });
      const ctx = canvas.getContext("2d");
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 3] && img.data[i] > 235 && img.data[i + 1] > 235 && img.data[i + 2] > 235) img.data.set([226, 230, 236], i);
      }
      ctx.putImageData(img, 0, 0);
      out[slug] = { data: await canvasPng(canvas), width: canvas.width, height: canvas.height };
    } catch (e) { console.warn("Word export: no flag for", slug, e); }
  }
  return out;
}

let exporting = false;
async function exportWord(mode) {
  const recs = H.loadHighlights();
  if (!recs.length || exporting) return;
  exporting = true;
  const btn = $("#dlDocx");
  btn.setAttribute("aria-busy", "true");
  btn.firstChild.textContent = "Preparing Word file… ";
  try {
    const kit = await loadWordKit();
    const now = new Date();
    const blob = await kit.builder.buildCitationsDocx(kit.docx, recs, {
      mode, style, accessed: now, fonts: kit.fonts, logo: kit.logo, rm: kit.rm, flags: await flagPngs(recs),
      noteInfo: (country, note) => noteInfo(country, note).n, output: "blob",
    });
    const name = kit.builder.docxFileName(mode, now);
    download(name, kit.builder.DOCX_MIME, blob);
    toast(`Downloaded ${name}`);
  } catch (error) {
    console.error("Word export failed", error);
    toast("Couldn’t make the Word file. Try again, or download .md instead.");
  } finally {
    exporting = false;
    btn.removeAttribute("aria-busy");
    btn.firstChild.textContent = "Export to Word ";
  }
}

(function wordMenu() {
  const btn = $("#dlDocx"), menu = $("#docxMenu");
  const items = () => [...menu.querySelectorAll("[role=menuitem]")];
  let closing = 0;
  const open = () => {
    clearTimeout(closing);
    menu.classList.remove("out");
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    items()[0].focus();
  };
  const close = ({ focus = false } = {}) => {
    if (menu.hidden) return;
    btn.setAttribute("aria-expanded", "false");
    menu.classList.add("out");
    closing = setTimeout(() => { menu.hidden = true; menu.classList.remove("out"); }, reduced.matches ? 0 : 170);
    if (focus) btn.focus();
  };
  btn.addEventListener("click", () => (btn.getAttribute("aria-expanded") === "true" ? close() : open()));
  menu.addEventListener("click", (e) => {
    const item = e.target.closest("[data-docx]");
    if (!item) return;
    close({ focus: true });
    exportWord(item.dataset.docx);
  });
  menu.addEventListener("keydown", (e) => {
    const list = items(), i = list.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); list[(i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length].focus(); }
    else if (e.key === "Home" || e.key === "End") { e.preventDefault(); list[e.key === "Home" ? 0 : list.length - 1].focus(); }
    else if (e.key === "Escape") { e.preventDefault(); close({ focus: true }); }
    else if (e.key === "Tab") close();
  });
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".sv-export")) close(); });
})();

/* ------------------------------------------------------------------ staleness */

/** For each note with highlights made on an older edition, check the words against the edition held now. */
async function checkAll() {
  const byNote = new Map();
  for (const r of H.loadHighlights()) {
    const k = `${r.country}|${r.note}`;
    if (!byNote.has(k)) byNote.set(k, []);
    byNote.get(k).push(r);
  }
  await Promise.all([...byNote].map(([k, recs]) => checkNote(k, recs).catch((e) => console.warn("check failed", k, e))));
}
async function checkNote(key, recs) {
  const [country, note] = key.split("|");
  if (!note || recs.every((r) => sourceOf(r) === "pdf")) return;   // read from a PDF: there is no note to check here (the reader checks it against the report's editions)
  const index = await fetchJson(paths.index(country, note));
  const edition = pickEdition(index);
  if (!edition) return;
  const stale = recs.filter((r) => r.editionSha !== edition.sha256 && !(r.current?.sha === edition.sha256 && (r.check === "still" || r.check === "changed")));
  if (!stale.length) return;
  checking.add(key);
  refreshStatus(recs);
  const html = await fetchText(paths.body(country, note, edition.sha256));
  const { root } = parseBody(html);
  const A = analyseBody(root);
  const normalized = H.normalizeWithMap(A.text);
  const { n } = noteInfo(country, note);
  const src = editionSource(edition, { note: n || {}, index });
  quiet++;
  for (const r of stale) {
    const res = H.checkHighlight(r, { sha: edition.sha256, version: edition.version_banner, text: A.text, normalized });
    if (res.status === "still") {
      const info = describePassage(A, res.match.start, res.match.end);
      H.updateHighlight(r.id, { check: "still", current: { sha: edition.sha256, version: edition.version_banner || null, title: edition.title || index.title,
        // the month in the edition's own title, else the dashboard's for the note: never GOV.UK's date for it, which is the country page's
        month: titleMonth({ title: edition.title || index.title, topic: n?.topic, countryName: noteInfo(country, note).c?.name }) || n?.month || null,
        para: info.para, section: info.section, ...(info.twice ? { paraTwice: true } : {}),
        url: src.url, archived: src.archived, capturedAt: src.capturedAt, pos: { start: res.match.start, end: res.match.end } } });
    } else if (res.status === "changed") {
      const cap = latestCapture(index.versions.find((v) => v.sha256 === r.editionSha));
      H.updateHighlight(r.id, { check: "changed", current: { sha: edition.sha256, version: edition.version_banner || null },
        archivedCopy: cap ? { url: cap.archive_url, capturedAt: cap.captured_at } : r.archivedCopy || null });
    }
  }
  quiet--;
  checking.delete(key);
  const fresh = H.loadHighlights().filter((r) => `${r.country}|${r.note}` === key);
  refreshStatus(fresh, { full: true });
}
/** Update status badges (and, after a check, pinpoints and citations) in place, without re-rendering. */
function refreshStatus(recs, { full = false } = {}) {
  for (const r of recs) {
    const li = document.getElementById(`h-${r.id}`);
    if (!li) continue;
    if (full) {
      const next = document.createElement("template");
      next.innerHTML = itemHtml(r).trim();
      const el = next.content.firstElementChild;
      const ta = $("textarea", li);
      if (ta && document.activeElement === ta) { $(".sv-status", li).innerHTML = statusHtml(r); continue; }
      el.classList.add("pop-in");
      li.replaceWith(el);
    } else $(".sv-status", li).innerHTML = statusHtml(r);
  }
}

/* ------------------------------------------------------------------ toasts, theme, boot */

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

(function theme() {
  const btn = $("#theme"), MODES = ["auto", "light", "dark"];
  const current = () => document.documentElement.dataset.theme || "auto";
  btn.textContent = current().toUpperCase();
  btn.addEventListener("click", () => {
    const mode = MODES[(MODES.indexOf(current()) + 1) % MODES.length];
    if (mode === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = mode;
    try { localStorage.setItem("cpin-theme", mode); } catch {}
    btn.textContent = mode.toUpperCase();
    hydrateFlags(document, { force: true });
  });
})();

function focusHash() {
  const m = /^#h-(.+)$/.exec(location.hash);
  const li = m && document.getElementById(`h-${decodeURIComponent(m[1])}`);
  if (!li) return;
  li.classList.add("is-target");
  li.scrollIntoView({ block: "center", behavior: reduced.matches ? "auto" : "smooth" });
}

/* ------------------------------------------------------------------ ?test=export (headless checks) */

// ?test=export&seed=samples/sample-highlights.json loads sample highlights into memory (this browser's
// saved highlights are not touched), then exports both Word files through the menu and writes what it
// got into <output id="exportTest">: name, size and whether each is a zip, plus a data: URL.

async function seedForTest() {
  const seed = params.get("seed");
  if (!seed || !/^samples\/[\w.-]+\.json$/.test(seed)) return;
  const memory = new Map();
  H.useStorage({ getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)) });
  H.saveHighlights((await fetchJson(seed)).highlights || []);
}

async function exportTest() {
  const out = document.createElement("output");
  out.id = "exportTest";
  out.hidden = true;
  document.body.append(out);
  const report = { highlights: H.loadHighlights().length, files: [] };
  try {
    for (const mode of ["full", "citations"]) {
      while (exporting) await new Promise((r) => setTimeout(r, 50));
      const before = window.__cpinDownloads?.length || 0;
      $("#dlDocx").click();
      $(`#docxMenu [data-docx="${mode}"]`).click();
      for (let t = 0; (window.__cpinDownloads?.length || 0) === before; t++) {
        if (t > 300) throw new Error(`no file from ${mode}`);
        await new Promise((r) => setTimeout(r, 100));
      }
      const { name, type, blob } = window.__cpinDownloads.at(-1);
      const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
      const dataUrl = await new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.readAsDataURL(blob); });
      report.files.push({ mode, name, type, size: blob.size, zip: head[0] === 0x50 && head[1] === 0x4b, dataUrl });
    }
  } catch (error) { report.error = String(error?.stack || error); }
  report.errors = testErrors;
  out.textContent = JSON.stringify(report);
  document.documentElement.dataset.exportTest = report.error || testErrors.length ? "failed" : "done";
  scrollTo(0, 0);
  $("#dlDocx").click();                                     // leave the menu open for a screenshot
  $("#dlDocx").blur();
}

async function boot() {
  if (TEST) await seedForTest().catch((e) => console.error("test seed failed", e));
  data = await fetchJson(paths.data).catch(() => null);
  render();
  focusHash();
  H.onHighlightsChange(() => { if (!quiet) render(); });
  await checkAll();
  window.__cpinSavedReady = true;
  if (TEST) await exportTest();
}
boot();
