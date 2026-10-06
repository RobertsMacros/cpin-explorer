// CPIN Explorer · saved highlights: storage, anchoring and staleness.
//
// A highlight is anchored like a W3C TextQuoteSelector (the exact words plus ~32 characters either
// side) with a text-position fallback, over the plain text of a note body (its textContent). It
// records the edition it was made on (sha256 + version), so when GOV.UK publishes a new edition we
// can tell whether the quoted words are still there.
//
// No login yet: records live in localStorage under "cpin-highlights-v1". Every access is wrapped,
// and an in-memory copy keeps the page working where storage is blocked.
import { cleanQuote, formatCitation, formatPinpoint, formatSources, longDate, quoteOf, sourceOf, STYLE_NAMES } from "./citation.js";

export const STORAGE_KEY = "cpin-highlights-v1";
export const CONTEXT_CHARS = 32;
const CHANGE_EVENT = "cpin-highlights-change";

/* ------------------------------------------------------------------ storage */

let memory = null;                                   // last known list (also the fallback store)
let storageOverride = null;                          // injected in tests
let persistFailed = false;                           // a write failed (quota, blocked): use memory

/** Use a different Storage-like object ({ getItem, setItem }); pass null to restore localStorage. */
export function useStorage(storage) { storageOverride = storage; memory = null; persistFailed = false; }

function storage() {
  if (storageOverride) return storageOverride;
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

const isRecord = (r) => r && typeof r === "object" && typeof r.id === "string" && typeof r.quote === "string";

/** The name an edition read from a PDF goes by. It has no note on GOV.UK to be named after, so it is
 *  "pdf-<edition id>", as the dashboard lists it (the report itself is known by its series key). */
export const pdfNoteId = (edition) => `pdf-${String(edition).slice(0, 16)}`;
// Highlights saved from such an edition before it had a name were stored with an empty note: they were lost
// to the reader on the next visit, and two reports of one country were filed together. They get their name here.
const named = (r) => (r.note || !r.editionSha || sourceOf(r) !== "pdf" ? r : { ...r, note: pdfNoteId(r.editionSha) });

export function loadHighlights() {
  try {
    const s = storage();
    if (s && !persistFailed) {
      const raw = s.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) { memory = list.filter(isRecord).map(named); return memory.slice(); }
    }
  } catch { /* blocked or corrupt: fall back to memory */ }
  return (memory ?? []).slice();
}

/** Save the whole list. Returns true if it reached persistent storage. */
export function saveHighlights(list) {
  memory = list.slice();
  let ok = false;
  try {
    const s = storage();
    if (s) { s.setItem(STORAGE_KEY, JSON.stringify(memory)); ok = true; }
    persistFailed = false;
  } catch { persistFailed = true; }
  try { globalThis.dispatchEvent?.(new CustomEvent(CHANGE_EVENT, { detail: { list: memory.slice() } })); } catch {}
  return ok;
}

export function newId() {
  try { if (globalThis.crypto?.randomUUID) return `h${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 11)}`; } catch {}
  return `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function addHighlight(record) {
  const rec = { id: newId(), comment: "", sources: [], createdAt: new Date().toISOString(), ...record };
  const list = loadHighlights();
  list.push(rec);
  saveHighlights(list);
  return rec;
}

export function updateHighlight(id, patch) {
  const list = loadHighlights();
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch, updatedAt: new Date().toISOString() };
  saveHighlights(list);
  return list[i];
}

/** Delete one; returns the removed record (and its index) so it can be restored with restoreHighlight. */
export function removeHighlight(id) {
  const list = loadHighlights();
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const [rec] = list.splice(i, 1);
  saveHighlights(list);
  return { rec, index: i };
}

export function restoreHighlight({ rec, index }) {
  const list = loadHighlights().filter((r) => r.id !== rec.id);
  list.splice(Math.min(index ?? list.length, list.length), 0, rec);
  saveHighlights(list);
  return rec;
}

export const highlightsFor = (country, note) =>
  loadHighlights().filter((r) => r.country === country && r.note === note);

/** Calls back with the fresh list when highlights change here or in another tab. Returns an unsubscribe. */
export function onHighlightsChange(callback) {
  const local = () => callback(loadHighlights());
  const other = (e) => { if (e.key === null || e.key === STORAGE_KEY) { memory = null; callback(loadHighlights()); } };
  globalThis.addEventListener?.(CHANGE_EVENT, local);
  globalThis.addEventListener?.("storage", other);
  return () => { globalThis.removeEventListener?.(CHANGE_EVENT, local); globalThis.removeEventListener?.("storage", other); };
}

/* ------------------------------------------------------------------ text anchoring */

export const normWs = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** Collapse whitespace runs to one space, keeping a map from each normalised index to its raw index. */
export function normalizeWithMap(text) {
  const src = String(text ?? "");
  const out = [], map = [];
  let inWs = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (/\s/.test(c)) {
      if (!inWs && out.length) { out.push(" "); map.push(i); }
      inWs = true;
    } else { out.push(c); map.push(i); inWs = false; }
  }
  if (out[out.length - 1] === " ") { out.pop(); map.pop(); }
  map.push(src.length);
  return { norm: out.join(""), map };
}

const WORD = /[\p{L}\p{N}’'_-]/u;

/** Widen [start, end) to whole words and trim surrounding whitespace. */
export function snapToWords(text, start, end) {
  let s = Math.max(0, Math.min(start, end)), e = Math.min(text.length, Math.max(start, end));
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  if (s >= e) return [s, s];
  while (s > 0 && WORD.test(text[s - 1]) && WORD.test(text[s])) s--;
  while (e < text.length && WORD.test(text[e]) && WORD.test(text[e - 1])) e++;
  return [s, e];
}

/** A TextQuoteSelector plus TextPositionSelector for text.slice(start, end). */
export function makeSelector(text, start, end, n = CONTEXT_CHARS) {
  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - n), start),
    suffix: text.slice(end, end + n),
    pos: { start, end },
  };
}

/* ---- the words as a reader sees them ---- */

// Tags this site adds inside a note's text: link status, changed-link chips, badges, pictures from the PDF.
// They are not the note's words. The reader's text index leaves them out, they cannot be selected
// (reader.css), and nothing shown, copied or exported as a quote ever carries them.
export const SITE_TAGS = ["linkstatus", "lc", "badge", "pdf-fig", "review-marker"];

// A highlight is anchored in the text of the body with nothing between its text nodes, so two lines of
// a table cell ("1890<br>447") or two cells with no white space between their tags run together there
// ("1890447"). That text is how a highlight is found again, and it is not to change. What is shown,
// copied or exported is this instead: the same characters, with one space wherever a line ended.
const ENDS_LINE = new Set(("ADDRESS ARTICLE ASIDE BLOCKQUOTE CAPTION DD DETAILS DIV DL DT FIGCAPTION FIGURE FOOTER H1 H2 H3 H4 H5 H6 "
  + "HEADER HR LI OL P PRE SECTION SUMMARY TABLE TBODY TD TFOOT TH THEAD TR UL").split(" "));
const endsLine = (el) => ENDS_LINE.has(String(el.tagName).toUpperCase());
/** The next node in document order that is not inside n. */
const after = (n) => { for (; n && n.parentNode; n = n.parentNode) if (n.nextSibling) return n.nextSibling; return null; };

/** Does a line end between two text nodes (a before b): a <br>, or the edge of a block or a table cell? */
function lineBetween(a, b, skip) {
  const above = new Set();
  for (let p = b.parentNode; p; p = p.parentNode) above.add(p);
  for (let p = a.parentNode; p && !above.has(p); p = p.parentNode) if (endsLine(p)) return true;      // a's block or cell ends before b
  for (let n = after(a); n && n !== b;) {
    const el = n.nodeType === 1 && !skip(n);
    if (el && (String(n.tagName).toUpperCase() === "BR" || endsLine(n))) return true;                // a line break, or a block or cell opening
    n = (el && n.childNodes[0]) || after(n);
  }
  return false;
}

/**
 * The text [start, end) of an index as a reader sees it: exactly its characters, plus ONE space wherever a
 * <br>, a table cell or a block boundary falls inside it and the text has no white space there already.
 * Nothing else is added and nothing is dropped.
 *   index  { nodes, starts }: the text nodes of the body in order, and the offset each starts at
 *   skip   elements whose contents are not the note's (tags the site adds): never looked inside
 */
export function spacedText({ nodes, starts }, start, end, { skip = () => false } = {}) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= start) lo = mid; else hi = mid - 1; }
  let out = "", prev = null;
  for (let i = lo; i < nodes.length && starts[i] < end; i++) {
    const piece = nodes[i].data.slice(Math.max(0, start - starts[i]), Math.max(0, end - starts[i]));
    if (!piece) continue;
    if (prev && !/\s$/.test(out) && !/^\s/.test(piece) && lineBetween(prev, nodes[i], skip)) out += " ";
    out += piece;
    prev = nodes[i];
  }
  return out;
}

/**
 * What a plain copy (Cmd+C) of [start, end) puts on the clipboard: the words as they read, cleaned as a quote
 * is (citation.js: cleanQuote), and nothing of this site's. lead: the paragraph number the passage opens with.
 */
export function copyText(index, start, end, { skip, lead = null } = {}) {
  return cleanQuote(spacedText(index, start, end, { skip }), { lead });
}

function commonSuffixLen(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function commonPrefixLen(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}
function allIndexes(hay, needle, cap = 500) {
  const out = [];
  if (!needle) return out;
  for (let i = hay.indexOf(needle); i >= 0 && out.length < cap; i = hay.indexOf(needle, i + 1)) out.push(i);
  return out;
}
function best(candidates, score) {
  let top = null, topScore = -Infinity;
  for (const c of candidates) { const s = score(c); if (s > topScore) { top = c; topScore = s; } }
  return top;
}

/**
 * Find a selector in text. Tries, in order: the stored position (if the words there still match),
 * the exact words (best prefix/suffix agreement, then nearest the old position), and the words with
 * whitespace normalised. Returns { start, end, how: "position" | "exact" | "normalised" } or null.
 */
export function locateQuote(text, sel, { normalized = null } = {}) {
  const quote = sel?.quote ?? sel?.exact;
  if (!text || !quote) return null;
  const pos = sel.pos;
  if (pos && text.slice(pos.start, pos.end) === quote) return { start: pos.start, end: pos.end, how: "position" };

  const prefix = sel.prefix || "", suffix = sel.suffix || "";
  const hint = pos?.start ?? 0;
  const exact = allIndexes(text, quote);
  if (exact.length) {
    const i = exact.length === 1 ? exact[0] : best(exact, (i) =>
      commonSuffixLen(text.slice(Math.max(0, i - prefix.length), i), prefix) +
      commonPrefixLen(text.slice(i + quote.length, i + quote.length + suffix.length), suffix) -
      Math.abs(i - hint) / 1e7);
    return { start: i, end: i + quote.length, how: "exact" };
  }

  const nq = normWs(quote);
  if (!nq) return null;
  const { norm, map } = normalized || normalizeWithMap(text);
  const hits = allIndexes(norm, nq);
  if (!hits.length) return null;
  const np = normWs(prefix), ns = normWs(suffix);
  const i = hits.length === 1 ? hits[0] : best(hits, (i) =>
    commonSuffixLen(norm.slice(Math.max(0, i - np.length - 1), i).trimEnd(), np) +
    commonPrefixLen(norm.slice(i + nq.length, i + nq.length + ns.length + 1).trimStart(), ns) -
    Math.abs(map[i] - hint) / 1e7);
  return { start: map[i], end: map[i + nq.length - 1] + 1, how: "normalised" };
}

/**
 * Compare a highlight with the edition now on record.
 *   current  made on this edition           (match: where it sits)
 *   still    a newer edition, words unchanged (match: where they sit there) -> said beside the highlight; its citation stays
 *   changed  a newer edition, words gone     (from/to versions for "Changed since you saved it")
 */
export function checkHighlight(rec, { sha, version, text, normalized = null }) {
  const from = rec.version || null, to = version || null;
  const match = text ? locateQuote(text, rec, { normalized }) : null;
  if (!sha || rec.editionSha === sha) return { status: match ? "current" : "unanchored", match, from, to };
  return match ? { status: "still", match, from, to } : { status: "changed", match: null, from, to };
}

/* ------------------------------------------------------------------ citations and export */

/**
 * The citation context for a record: always the edition it was saved from (the record's own title, version,
 * month, paragraph, section and source). A lawyer cites what they read: a newer edition that still has the
 * words is said beside the highlight (stillLine), never cited in its place, until they choose to
 * (citeCurrent). Once that edition is no longer the one on GOV.UK the address is its archived copy, where
 * one is held (`archivedCopy`, kept by the reader and the saved page); else the address it was saved with.
 */
export function citeContext(rec, { accessed = new Date() } = {}) {
  const old = rec.check !== "current" && rec.archivedCopy?.url ? rec.archivedCopy : null;
  return {
    title: rec.title, kind: rec.kind, topic: rec.topic, countryName: rec.countryName,
    version: rec.version, month: rec.month, para: rec.para, section: rec.section, paraTwice: rec.paraTwice,
    url: old?.url || rec.url, archived: old ? true : rec.archived,
    capturedAt: old ? old.capturedAt : rec.capturedAt, accessed,
    quote: rec.quote, spaced: rec.spaced, lead: rec.lead,                                   // the words, as read, and the paragraph number they open with (citation.js: quoteOf)
    source: rec.source, pdfPara: rec.pdfPara,                                               // web or PDF; the PDF's number where it differs
  };
}

/** Are the words of a highlight from an older edition still in the current one (as last checked)? */
export const stillCurrent = (rec) => rec.check === "still" && !!rec.current && rec.current.current !== false;

/**
 * What to say beside such a highlight: "Still in the current edition (v7.0, para 9.1.1)", with the paragraph
 * the words have there, which may not be the one cited. "" for any other record.
 *   word  "current", or "last" for a report no longer on GOV.UK
 */
export function stillLine(rec, { word = "current" } = {}) {
  if (!stillCurrent(rec)) return "";
  const c = rec.current;
  const where = [c.version ? `v${c.version}` : "", c.para ? formatPinpoint(c.para) : ""].filter(Boolean).join(", ");
  return `Still in the ${word} edition${where ? ` (${where})` : ""}`;
}

/**
 * "Cite the current edition instead": what to write to a record so that it becomes a highlight of the current
 * edition, where its words still are (`current`, as the last check left it). Only ever applied when the reader
 * asks for it. Returns the patch for updateHighlight, or null where there is nothing to move to.
 */
export function citeCurrent(rec) {
  if (!stillCurrent(rec) || !rec.current.sha) return null;
  const c = rec.current;
  const has = (k) => c[k] !== undefined;
  return {
    editionSha: c.sha, version: c.version ?? null, month: c.month || rec.month, title: c.title || rec.title,
    para: c.para ?? null, section: c.section ?? null, paraTwice: !!c.paraTwice,
    url: c.url || rec.url, archived: !!c.archived, capturedAt: c.capturedAt ?? null,
    source: c.source || sourceOf(rec), pdfPara: c.pdfPara,
    ...(c.pos ? { pos: c.pos } : {}),
    // where the check kept them: the note that edition is filed under, the words either side, and how the quote reads there
    ...(c.note ? { note: c.note } : {}), ...(has("prefix") ? { prefix: c.prefix, suffix: c.suffix } : {}),
    ...(has("lead") ? { lead: c.lead } : {}), ...(has("spaced") ? { spaced: c.spaced } : {}),
    ...(has("quote") ? { quote: c.quote } : {}), ...(has("sources") ? { sources: c.sources } : {}),
    check: "current", current: null, archivedCopy: null,
  };
}

/** Group records by country, then note, ordered by country name, note title and position in the text. */
export function groupHighlights(records) {
  const countries = new Map();
  for (const r of records) {
    if (!countries.has(r.country)) countries.set(r.country, { country: r.country, countryName: r.countryName || r.country, notes: new Map() });
    const c = countries.get(r.country);
    if (!c.notes.has(r.note)) c.notes.set(r.note, { note: r.note, title: r.title, topic: r.topic, kind: r.kind, items: [] });
    c.notes.get(r.note).items.push(r);
  }
  return [...countries.values()]
    .sort((a, b) => a.countryName.localeCompare(b.countryName, "en-GB"))
    .map((c) => ({
      ...c,
      notes: [...c.notes.values()]
        .sort((a, b) => String(a.topic || a.title).localeCompare(String(b.topic || b.title), "en-GB"))
        .map((n) => ({ ...n, items: n.items.slice().sort((a, b) => (a.pos?.start ?? 0) - (b.pos?.start ?? 0)) })),
    }));
}

const staleLine = (r) => r.check === "changed" ? `Changed since you saved it (v${r.version || "?"} → v${r.current?.version || r.checkedVersion || "?"})`
  : stillLine(r);

/** Markdown export of every highlight, grouped by country and note. */
export function exportMarkdown(records, { style = "oscola", accessed = new Date() } = {}) {
  const out = [`# Saved highlights`, ``, `CPIN Explorer · exported ${longDate(accessed)} · ${STYLE_NAMES[style] || style} citations`, ``];
  for (const c of groupHighlights(records)) {
    out.push(`## ${c.countryName}`, ``);
    for (const n of c.notes) {
      out.push(`### ${n.title}`, ``);
      for (const r of n.items) {
        out.push(`> ${quoteOf(r)}`, ``, formatCitation(citeContext(r, { accessed }), style).md, ``);
        const s = formatSources(r.sources);
        if (s.md) out.push(s.md, ``);
        const stale = staleLine(r);
        if (stale) out.push(`_${stale}_`, ``);
        if (r.comment) out.push(`Note: ${normWs(r.comment)}`, ``);
      }
    }
  }
  out.push(`---`, ``, `Sources: Home Office, GOV.UK. Contains public sector information licensed under the Open Government Licence v3.0.`, ``);
  return out.join("\n");
}

export function exportJson(records) {
  return JSON.stringify({ format: STORAGE_KEY, exported_at: new Date().toISOString(), highlights: records }, null, 2);
}

export { staleLine };
