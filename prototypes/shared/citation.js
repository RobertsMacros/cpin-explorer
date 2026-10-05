// CPIN Explorer · citations for passages quoted from Home Office country notes.
// Pure functions, no DOM: they run in the browser and in Node (web/test/citation.test.mjs).
//
//   OSCOLA     Home Office, <i>Country Policy and Information Note: Military Service, Iran</i>
//              (version 4.0, August 2026) para 9.1.1 <https://www.gov.uk/…#:~:text=…> accessed 2 October 2026.
//   Tribunal   CPIN Iran: Military service (v4.0, Aug 2026) at [9.1.1]
//
// The quoted words are never changed: footnote markers ("[footnote 12]") are dropped, whitespace is
// collapsed and, where a quote begins at the start of a numbered paragraph, that paragraph's own number
// moves into the pinpoint; nothing else.

import { ukParts } from "./uk-time.js";
import { archiveName } from "./archive-source.js";

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
export const STYLES = ["oscola", "tribunal"];
export const STYLE_NAMES = { oscola: "OSCOLA", tribunal: "Tribunal" };
/** Labels for the style switch, so each explains itself, and what each produces (one line, for a hint). */
export const STYLE_LABELS = { oscola: "Full (OSCOLA)", tribunal: "Short (tribunal)" };
export const STYLE_HINTS = {
  oscola: "The full legal citation: author, title, version and date, paragraph, link and the date you accessed it.",
  tribunal: "The compact reference used in Upper Tribunal and First-tier Tribunal determinations and skeleton arguments.",
};

const MONTH_RE = new RegExp(`(${MONTHS.join("|")})\\s+(\\d{4})`, "i");
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const capFirst = (s) => { const t = String(s ?? ""); return t.charAt(0).toUpperCase() + t.slice(1); };
const collapse = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------------ dates */

/**
 * "2 October 2026". A timestamp (GOV.UK's, an Internet Archive capture, when a highlight was saved) is given
 * as the UK calendar day, on the site's one clock (./uk-time.js): a copy captured at 23:45 UTC on 6 April,
 * British Summer Time, was captured on 7 April, and the page and the citation must say the same day.
 * A Date object (the day a passage is accessed) is the reader's own day.
 */
export function longDate(when = new Date()) {
  if (typeof when === "string") {
    const d = ukParts(when);
    return d ? `${d.day} ${MONTHS[d.month]} ${d.year}` : "";
  }
  return `${when.getDate()} ${MONTHS[when.getMonth()]} ${when.getFullYear()}`;
}

/** "2026-08" or an ISO date or "August 2026" -> { long: "August 2026", short: "Aug 2026" }. */
export function monthLabel(value) {
  if (!value) return null;
  const s = String(value);
  let y, m;
  const iso = /^(\d{4})-(\d{2})/.exec(s);
  if (iso) { y = Number(iso[1]); m = Number(iso[2]) - 1; }
  else {
    const named = MONTH_RE.exec(s);
    if (!named) return null;
    y = Number(named[2]);
    m = MONTHS.findIndex((x) => x.toLowerCase() === named[1].toLowerCase());
  }
  if (!(m >= 0 && m < 12)) return null;
  return { long: `${MONTHS[m]} ${y}`, short: `${MONTHS_SHORT[m]} ${y}` };
}

/* ------------------------------------------------------------------ titles */

const MINOR = new Set(("a an the and but or nor for of in on at to by as from with into onto upon per via " +
  "vs v than").split(" "));

/** Title case for an italicised OSCOLA title: major words capitalised, small words not, acronyms kept. */
export function titleCase(text) {
  let first = true;
  return String(text ?? "").split(/(\s+)/).map((tok) => {
    if (!tok || /^\s+$/.test(tok)) return tok;
    const out = tok.split("-").map((part, i) => {
      const m = /^([^\p{L}\p{N}]*)(\p{L})(.*)$/u.exec(part);
      if (!m) return part;
      const [, lead, ch, tail] = m;
      const lower = (ch + tail).toLowerCase().replace(/[^\p{L}]+$/u, "");
      const keepSmall = !first && i === 0 && !lead.includes("(") && MINOR.has(lower) && ch === ch.toLowerCase();
      return keepSmall ? part : lead + ch.toUpperCase() + tail;
    }).join("-");
    first = /:$/.test(tok);          // a colon starts a new title: "…Note: Military Service"
    return out;
  }).join("");
}

// Full names for each kind, used only when a title has no "<kind>:" of its own.
export const KIND_NAMES = {
  "CPIN": "Country policy and information note",
  "Country bulletin": "Country bulletin",
  "Country information note": "Country information note",
  "Fact-finding mission": "Report of a fact-finding mission",
  "Country information and guidance (legacy)": "Country information and guidance",
};
// Short labels for the tribunal form ("CPIN Iran: Military service …").
export const KIND_SHORT = {
  "CPIN": "CPIN",
  "Country bulletin": "Country bulletin",
  "Country information note": "CIN",
  "Fact-finding mission": "FFM report",
  "Country information and guidance (legacy)": "CIG",
};

// Names a country's page has gone by, which its older notes still carry (as src/cpin/titles.py: _KNOWN_VARIANTS).
// A citation gives a title as it was published: a note of 2019 says "OPT", and "Palestine" is not added to it.
const EARLIER_NAMES = { Palestine: ["Occupied Palestinian Territories", "Occupied Palestinian Territory", "OPTs", "OPT"] };

/** Names a title may use for the country: "Myanmar (Burma)" -> ["Myanmar (Burma)", "Burma", "Myanmar"]. */
function countryNames(name) {
  const out = new Set();
  if (name) {
    out.add(name);
    for (const earlier of EARLIER_NAMES[name] || []) out.add(earlier);
    const paren = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name);
    if (paren) { out.add(paren[2]); out.add(paren[1]); }
    out.add(name.replace(/^the\s+/i, ""));
  }
  return [...out].filter(Boolean).sort((a, b) => b.length - a.length);
}

/**
 * Split a verbatim GOV.UK title into its parts:
 *   "Country bulletin Iran: security situation, March 2026 (accessible)"
 *     -> { kindName: "Country bulletin", topic: "security situation", country: "Iran", month: "March 2026" }
 * Falls back to the dashboard's kind/topic/country when the title is irregular.
 */
export function parseNoteTitle({ title, kind, topic, countryName } = {}) {
  let t = collapse(title).replace(/\s*\((?:accessible|accesible)(?:\s+version)?\)\s*$/i, "").trim();
  const names = countryNames(countryName);
  const colon = t.indexOf(":");
  let head = colon > 0 ? t.slice(0, colon).trim() : "";
  let rest = colon > 0 ? t.slice(colon + 1).trim() : t;
  let country = null, month = null;

  // A trailing "…, March 2026" is the edition month, unless it belongs to the topic itself
  // ("protests of December 2025 to January 2026").
  const mm = new RegExp(`,?\\s*${MONTH_RE.source}$`, "i").exec(rest);
  const inTopic = mm && !mm[0].startsWith(",") && topic &&
    collapse(topic).toLowerCase().endsWith(`${mm[1]} ${mm[2]}`.toLowerCase());
  if (mm && !inTopic) { month = monthLabel(`${mm[1]} ${mm[2]}`).long; rest = rest.slice(0, mm.index).trim(); }

  for (const n of names) {                                   // "Country bulletin Iran", "…note, Kuwait"
    const m = new RegExp(`[,\\s]+(${escRe(n)})$`, "i").exec(head);
    if (m) { country = m[1]; head = head.slice(0, m.index).trim(); break; }
  }
  for (const n of names) {                                   // "China: modern slavery"
    const m = new RegExp(`^(${escRe(n)}):\\s*`, "i").exec(rest);
    if (m) { country ??= m[1]; rest = rest.slice(m[0].length).trim(); break; }
  }
  for (const n of names) {                                   // "military service, Iran"
    const m = new RegExp(`,\\s*(${escRe(n)})$`, "i").exec(rest);
    if (m) { country = m[1]; rest = rest.slice(0, m.index).trim(); break; }
  }
  // "…gender identity and expression in Namibia", "…humanitarian situation, OPT (Gaza)": the country is already in the topic.
  const countryInTopic = !country && names.some((n) => new RegExp(`\\b${escRe(n)}(?:\\s+\\([^()]*\\))?$`, "i").test(rest));

  if (!head) {                                               // irregular title (a slug, or no colon)
    head = KIND_NAMES[kind] || "";
    if (head && topic) rest = topic;
  }
  return {
    kindName: head,
    topic: rest || topic || "",
    country: country || (countryInTopic ? null : countryName || null),
    month,
  };
}

/** The edition month a title gives ("…, Iran, August 2026 (accessible)" -> "2026-08"), or null: a month that
 *  belongs to the topic ("protests of December 2025 to January 2026") is not the edition's. */
export function titleMonth(ctx) {
  const named = MONTH_RE.exec(parseNoteTitle(ctx).month || "");
  return named ? `${named[2]}-${String(MONTHS.findIndex((m) => m.toLowerCase() === named[1].toLowerCase()) + 1).padStart(2, "0")}` : null;
}

/** The italic part of an OSCOLA citation: kind + topic + country, in title case. */
export function italicTitle(ctx) {
  const p = parseNoteTitle(ctx);
  const body = [titleCase(p.topic), p.country].filter(Boolean).join(", ");
  return p.kindName ? `${titleCase(p.kindName)}: ${body}` : body;
}

/* ------------------------------------------------------------------ paragraphs */

// A paragraph number as the Home Office prints it: "9.1.1", then a space. Some notes put a full stop after
// it ("9.1.1. Under…") and some lose the space ("9.1.1Under…"): both are still that paragraph's number. The
// second is taken only for a number of three parts or more, which no figure looks like ("4.5G" is not one).
const NUMBER = /^\s*(\d{1,2}(?:\.\d{1,3}){1,4})(\.?)(?=\s|$)/;
const NUMBER_SET_TIGHT = /^\s*(\d{1,2}(?:\.\d{1,3}){2,4})(\.?)(?=[\p{Lu}‘“'"(\[])/u;

const FIGURE_UNIT = /^\s*[%\p{Ll}]/u;                            // what follows a figure, never a paragraph number: "5.2 million", "58.2% had"

/** The number a paragraph opens with, and the characters it is printed as: { num: "9.1.1", lead: "9.1.1." }, or null. */
function paraLead(text, minDepth) {
  const t = String(text ?? ""), m = NUMBER.exec(t) || NUMBER_SET_TIGHT.exec(t);
  if (!m || m[1].split(".").length < minDepth) return null;
  if (m[1].split(".").length === 2 && FIGURE_UNIT.test(t.slice(m[0].length))) return null;   // in a note numbered 1.2: "5.2 million people" is a figure
  return { num: m[1], lead: m[1] + m[2] };
}

/** CPIN paragraph number at the start of a paragraph's text ("9.1.1 Under articles…" -> "9.1.1"). */
export function paraNumber(text, { minDepth = 2 } = {}) {
  return paraLead(text, minDepth)?.num ?? null;
}

/** Sniff whether a note numbers its paragraphs 1.2.3 (most CPINs) or 1.2 (some older notes). */
export function paraDepth(paragraphTexts) {
  let three = 0;
  for (const t of paragraphTexts) if (paraNumber(t, { minDepth: 3 })) three++;
  return three >= 3 ? 3 : 2;
}

// Something like a paragraph number at the start of a paragraph: digits in two or more parts, however they are
// joined ("3.26", "5,2,3", "12.1. 3", "7.4\4", "5.1..8."). A figure with its unit is not one ("58.2% had…",
// "5.2 million people"): a paragraph number is never followed by a lower-case word or a per cent sign.
const NUMBER_LIKE = /^\s*(\d{1,3}(?:[.,\\/]{1,2}\s?\d{1,3}){1,5})(?!\d)[.,]?/;
function numberLike(text) {
  const t = String(text ?? ""), m = NUMBER_LIKE.exec(t);
  if (!m || FIGURE_UNIT.test(t.slice(m[0].length))) return null;
  return { printed: m[1], lead: m[0].trimStart() };
}
/** The paragraph number one step on from (or back from) another: "3.2.5" -> "3.2.6". */
function stepPara(num, by) {
  if (!num) return null;
  const parts = num.split("."), last = Number(parts.pop()) + by;
  return last >= 1 ? [...parts, last].join(".") : null;
}
/** Can what is printed only be a slip for this number? Its digits are the same ("3.26", "5,2,3" and "92.2"
 *  for 3.2.6, 5.2.3 and 9.2.2), or a middle part of the number was left out ("4.11" for 4.1.11). Not the
 *  last part: "3.1" where 3.1.10 is due is the sub-heading's number, or half of "3.1 10". */
function standsFor(printed, num) {
  if (printed.replace(/\D/g, "") === num.replace(/\D/g, "")) return true;
  const got = printed.split(/\D+/).filter(Boolean).join("."), want = num.split(".");
  return want.some((_, i) => i > 0 && i < want.length - 1 && want.filter((__, j) => j !== i).join(".") === got);
}

/**
 * The number each paragraph of a note is cited by, read in order.
 *   blocks  the note's paragraphs and headings in document order: [{ text } | { heading: true }]
 *   depth   how deep the note numbers its paragraphs (paraDepth)
 * Returns one entry per block:
 *   { num, lead }  a numbered paragraph: num is its pinpoint, lead the characters it is printed as
 *   { num: null }  a paragraph that opens with something like a number which cannot be read as its own:
 *                  it has no pinpoint (a citation names the section), and nor has what follows it
 *   null           a heading, or a paragraph with no number: it belongs to the numbered paragraph before it
 * A mistyped number is given as printed when it can only be the number due at its place: the one after the
 * numbered paragraph before it, or the one before the numbered paragraph after it. Anything else that looks
 * like a number (a sub-heading set as a paragraph, "1.2 Exclusion"; a letter quoted with its own numbering)
 * is left without a pinpoint: it is never cited as the paragraph before it.
 */
export function paraNumbers(blocks, depth = 3) {
  const out = blocks.map((b) => (b.heading ? null : paraLead(b.text, depth)));
  let prev = null;                                              // the number last reached under this heading
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].heading) { prev = null; continue; }
    if (out[i]) { prev = out[i].num; continue; }
    const like = numberLike(blocks[i].text);
    if (!like) continue;
    let next = null;
    for (let j = i + 1; j < blocks.length && !blocks[j].heading && !next; j++) next = out[j]?.num ?? null;
    const heads = next?.startsWith(`${like.printed}.`);         // "3.2 Sur place activities", then 3.2.1: a sub-heading
    const due = heads ? null : [stepPara(prev, 1), stepPara(next, -1)].find((n) => n && standsFor(like.printed, n));
    out[i] = due ? { num: like.printed, lead: like.lead } : { num: null };
    if (due) prev = due;
  }
  return out;
}

/** The numbered paragraph that governs a text offset: the last one starting at or before it, unless a
 *  heading intervenes or a paragraph whose number cannot be read (para: null).
 *  anchors: [{ at, para } | { at, heading }] sorted by offset. */
export function paraAt(anchors, offset) {
  let found = null;
  for (const a of anchors) {
    if (a.at > offset) break;
    found = a.heading ? null : a.para;
  }
  return found;
}

/** "9.1.1" + "9.1.3" -> "9.1.1–9.1.3"; equal or missing ends collapse. */
export function paraRange(from, to) {
  if (!from && !to) return null;
  if (!from || !to || from === to) return from || to;
  return `${from}–${to}`;
}

export const splitRange = (para) => String(para).split(/\s*[–—-]\s*/).filter(Boolean);

/** Pinpoint for a paragraph or range: OSCOLA "para 9.1.1" / "paras 9.1.1–9.1.3"; tribunal "at [9.1.1]". */
export function formatPinpoint(para, style = "oscola") {
  if (!para) return "";
  const [a, b] = splitRange(para);
  if (style === "tribunal") return b ? `at [${a}]–[${b}]` : `at [${a}]`;
  return b ? `paras ${a}–${b}` : `para ${a}`;
}

/* ------------------------------------------------------------------ which publication */

// The Home Office publishes each edition twice, as a web page and as a PDF, and the two are not always the
// same text or numbered alike (docs/methods/pdf-and-web.md). A citation says which it is taken from. The web
// version is the default: it is the text this site holds word for word.
export const SOURCE_NAMES = { web: "web version", pdf: "PDF version" };

/** "pdf" for a passage read from the PDF (an edition with no web version), else "web". */
export function sourceOf(ctx) {
  if (ctx?.source === "pdf" || ctx?.source === "web") return ctx.source;
  return /\.pdf(?:[?#]|$)/i.test(ctx?.url || "") ? "pdf" : "web";       // a highlight saved before the source was recorded
}

/**
 * A web paragraph (or range) as the PDF of the same edition numbers it.
 *   numbering  the comparison's map for the edition: { different: { web number: PDF number }, pdf_unnumbered: [web numbers],
 *              repeated: [web numbers used more than once], unconfirmed: [web numbers a second reader did not settle] }
 * Returns null when it is numbered the same (or nothing is known for certain), "" when the PDF does not number
 * it, else the PDF's number or range.
 */
export function pdfPinpoint(para, numbering) {
  if (!para || !numbering) return null;
  const parts = splitRange(para);
  // A number the web version uses twice, or a PDF number a second reader did not find: nothing is known for
  // certain about the PDF's number, so none is given.
  const unsure = [...(numbering.repeated || []), ...(numbering.unconfirmed || [])];
  if (parts.some((p) => unsure.includes(p))) return null;
  const there = parts.map((p) => (Object.hasOwn(numbering.different || {}, p) ? numbering.different[p] : (numbering.pdf_unnumbered || []).includes(p) ? "" : p));
  if (there.every((p, i) => p === parts[i])) return null;
  return there.some((p) => p === "") ? "" : paraRange(there[0], there[1]);
}

/** What follows a pinpoint where the PDF numbers the passage differently: " (para 18.3.1 in the PDF version)". */
function pdfNote(ctx, style) {
  if (sourceOf(ctx) !== "web" || ctx.pdfPara == null || !ctx.para) return "";
  if (ctx.pdfPara === "") return ` (not numbered in the ${SOURCE_NAMES.pdf})`;
  return style === "tribunal" ? ` (${SOURCE_NAMES.pdf}: ${formatPinpoint(ctx.pdfPara, "tribunal").replace(/^at /, "")})`
    : ` (${formatPinpoint(ctx.pdfPara, "oscola")} in the ${SOURCE_NAMES.pdf})`;
}

/** The paragraph numbers a note uses for more than one paragraph (a section numbered like an earlier one, as
 *  where section 14's paragraphs are printed 12.2.3 to 12.2.8 again). A pinpoint to one of these does not say
 *  which paragraph is meant. numbers: every numbered paragraph's number, in order. */
export function usedTwice(numbers) {
  const seen = new Set(), twice = new Set();
  for (const n of numbers) (seen.has(n) ? twice : seen).add(n);
  return twice;
}

/** What follows a pinpoint whose number the note uses for more than one paragraph: " (under ‘14. State
 *  treatment’)". The number alone would not say which paragraph is meant. */
const underNote = (ctx) => (ctx.paraTwice && ctx.para && ctx.section ? ` (under ‘${ctx.section}’)` : "");

/* ------------------------------------------------------------------ quotes */

export const FOOTNOTE_MARKER = /\s*\[footnote\s+\d+\]/gi;

/** Remove GOV.UK footnote markers ("[footnote 12]") and the space before them. */
export function stripFootnoteMarkers(text) {
  return String(text ?? "").replace(FOOTNOTE_MARKER, "");
}

/**
 * The quote as it is cited: footnote markers out, the paragraph's own number dropped, and every run of white
 * space made one ordinary space. The words are the Home Office's, unchanged. Its space characters are not
 * kept: the text carries narrow, thin and no-break spaces pasted in from its sources, which jam words
 * together in Word, so a quote that is shown, copied or exported has ordinary spaces (the owner's decision).
 *   lead  the number the paragraph opens with, as printed, when the quote begins at the very start of that
 *         paragraph (it moves into the pinpoint). Nothing else is ever dropped from the start: a quote that
 *         begins part-way through a paragraph with a figure ("2.86 million Afghans returned") keeps it.
 */
export function cleanQuote(text, { lead = null } = {}) {
  const q = collapse(stripFootnoteMarkers(text));
  const number = collapse(lead);
  if (!number || !q.startsWith(number)) return q;
  const rest = q.slice(number.length);
  return !rest || /^[\d.,]/.test(rest) ? q : rest.trimStart();       // only the whole number, and never the whole quote
}

/**
 * The quote of a passage (a saved highlight, or the context of a citation) as it is shown, copied and exported.
 *   spaced  the words as a reader sees them, with a space where a line, a table cell or a block ended
 *           (highlights.js: spacedText); a highlight saved before that was recorded has only `quote`
 *   lead    the paragraph number the quote opens with (null when it begins part-way through a paragraph).
 *           Before that was recorded: the passage's own paragraph number, when the quote opens with exactly it.
 */
export function quoteOf(passage) {
  const text = passage?.spaced ?? passage?.quote;
  if (passage?.lead !== undefined) return cleanQuote(text, { lead: passage.lead });
  const first = splitRange(passage?.para || "")[0];
  return cleanQuote(text, { lead: first && new RegExp(`^\\s*${escRe(first)}\\s`).test(String(text ?? "")) ? first : null });
}

/** Footnote numbers referenced inside a passage ("[footnote 12]" -> 12), in order, without repeats. */
export function footnoteNumbers(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(/\[footnote\s+(\d+)\]/gi)) {
    const n = Number(m[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/* ------------------------------------------------------------------ links */

const encFragment = (s) => encodeURIComponent(s).replace(/-/g, "%2D");

/**
 * A text fragment (#:~:text=start,end) that makes the browser scroll to and highlight the quote.
 * Each term must sit inside one block and between footnote markers, so the start words come from
 * the first stretch of text and the end words from the last. Short quotes are matched whole.
 */
export function textFragment(raw, { words = 5, whole = 10 } = {}) {
  const segs = String(raw ?? "").split(/\[footnote\s+\d+\]|\n/i).map(collapse).filter(Boolean);
  if (!segs.length) return "";
  const first = segs[0].split(" "), last = segs[segs.length - 1].split(" ");
  if (segs.length === 1 && first.length <= whole) return `#:~:text=${encFragment(segs[0])}`;
  const start = first.slice(0, words).join(" ");
  const end = last.slice(-words).join(" ");
  return `#:~:text=${encFragment(start)},${encFragment(end)}`;
}

/** The note's URL with a text fragment for the quote (any existing #fragment is replaced). */
export function citationUrl(base, quote) {
  if (!base) return "";
  return String(base).replace(/#.*$/, "") + (quote ? textFragment(quote) : "");
}

/* ------------------------------------------------------------------ citations */

/** The month a citation gives its edition: the month in the title, else the context's own (`month`).
 *  { long: "August 2026", short: "Aug 2026" } or null. */
export function citedMonth(ctx, parsed = parseNoteTitle(ctx)) {
  return monthLabel(parsed.month) || monthLabel(ctx.month);
}

/**
 * ctx: { title, kind, topic, countryName, version, month, para, section, url, quote, spaced, lead,
 *        archived, capturedAt, accessed }
 * Returns { text, html, md, url }.
 */
export function formatCitation(ctx, style = "oscola") {
  const p = parseNoteTitle(ctx);
  const month = citedMonth(ctx, p);
  const url = citationUrl(ctx.url, ctx.quote);
  const archivedNote = ctx.archived
    ? `archived copy, ${archiveName({ archive_url: ctx.url })}${ctx.capturedAt ? `, captured ${longDate(ctx.capturedAt)}` : ""}`
    : "";

  if (style === "tribunal") {
    const kindShort = KIND_SHORT[ctx.kind] || (p.kindName ? capFirst(p.kindName) : "");
    const country = p.country || ctx.countryName || "";
    const name = `${[kindShort, country].filter(Boolean).join(" ")}: ${capFirst(p.topic)}`;
    const when = [ctx.version ? `v${ctx.version}` : null, month?.short, SOURCE_NAMES[sourceOf(ctx)]].filter(Boolean).join(", ");
    const pin = ctx.para ? ` ${formatPinpoint(ctx.para, "tribunal")}${underNote(ctx)}${pdfNote(ctx, "tribunal")}` : ctx.section ? `, ‘${ctx.section}’` : "";
    const tail = `${when ? ` (${when})` : ""}${pin}${archivedNote ? ` (${archivedNote})` : ""}`;
    return {
      text: name + tail,
      html: (url ? `<a href="${escHtml(url)}">${escHtml(name)}</a>` : escHtml(name)) + escHtml(tail),
      md: `${name}${tail}${url ? ` <${url}>` : ""}`,
      url,
    };
  }

  const italic = italicTitle(ctx);
  const when = [ctx.version ? `version ${ctx.version}` : null, month?.long, SOURCE_NAMES[sourceOf(ctx)]].filter(Boolean).join(", ");
  const pin = ctx.para ? formatPinpoint(ctx.para, "oscola") + underNote(ctx) + pdfNote(ctx, "oscola") : ctx.section ? `section ‘${ctx.section}’` : "";
  const mid = `${when ? ` (${when})` : ""}${pin ? ` ${pin}` : ""}${archivedNote ? ` (${archivedNote})` : ""}`;
  const accessed = longDate(ctx.accessed || new Date());
  const link = url ? ` <${url}>` : "";
  const end = ` accessed ${accessed}.`;
  return {
    text: `Home Office, ${italic}${mid}${link}${end}`,
    html: `Home Office, <i>${escHtml(italic)}</i>${escHtml(mid)}${url ? ` &lt;<a href="${escHtml(url)}">${escHtml(url)}</a>&gt;` : ""}${escHtml(end)}`,
    md: `Home Office, *${italic}*${mid}${link}${end}`,
    url,
  };
}

/** "Sources cited in this passage:" followed by "[n] footnote text" lines. sources: [{ n, text, url }]. */
export function formatSources(sources = []) {
  if (!sources?.length) return { text: "", html: "", md: "" };
  const head = "Sources cited in this passage:";
  return {
    text: `${head}\n${sources.map((s) => `[${s.n}] ${collapse(s.text)}`).join("\n")}`,
    html: `<p>${head}</p>${sources.map((s) => `<p>[${s.n}] ${s.url
      ? `<a href="${escHtml(s.url)}">${escHtml(collapse(s.text))}</a>` : escHtml(collapse(s.text))}</p>`).join("")}`,
    md: `${head}\n\n${sources.map((s) => `- [${s.n}] ${collapse(s.text)}${s.url ? ` <${s.url}>` : ""}`).join("\n")}`,
  };
}

/** What "Copy quote + citation" puts on the clipboard: “quote” citation, then the sources it cites. */
export function quoteWithCitation(ctx, style = "oscola", sources = []) {
  const q = quoteOf(ctx);
  const c = formatCitation(ctx, style);
  const s = formatSources(sources);
  return {
    text: `“${q}” ${c.text}${s.text ? `\n\n${s.text}` : ""}`,
    html: `<p>“${escHtml(q)}” ${c.html}</p>${s.html}`,
    md: `> ${q}\n\n${c.md}${s.md ? `\n\n${s.md}` : ""}`,
    url: c.url,
  };
}
