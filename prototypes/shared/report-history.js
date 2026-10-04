// CPIN Explorer · a report's history, as pure functions (no DOM; Node-testable).
//
// A report (series) is every edition of one note we hold, oldest first, plus GOV.UK's change notes for
// it. The report page puts them on one timeline:
//   - editions: held, readable and comparable (the slider's handles stop on them);
//   - updates:  GOV.UK change notes that belong to no held edition (an edition we never captured, or a
//               report with one edition and a long history). They are dated stops the reader can
//               step through, so every report has a history to walk. Each says why there is no text
//               for it (updateKind): the edition is a PDF only, the update was a removal, or the
//               edition is simply not held.
// Captions quote the Home Office's own "Changes from last version of this note" (verbatim), else the
// GOV.UK change note (verbatim). References to sections and paragraphs in them ("sections 13.4, and
// 16.3 to 16.5", "paragraph 7.3.2") are found here so the page can link them to the text, and so are
// the names of the report's own sections ("Updated country information and assessment").

import { titleMonth } from "./citation.js";

export const DAY = 86400000;
const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const finite = (...xs) => xs.filter(Number.isFinite);

/**
 * An edition's own date, by the note's account: its "valid from" date where it states one, else the month in
 * its title, else none. Never the date GOV.UK gives the note: every note on a country page carries the PAGE's
 * date, which moves whenever any note there changes (China's note on medical treatment, valid from 5 July
 * 2022, showed as published on 1 September 2026). The export gives the note's own date as `published`, says
 * which it is in `published_from`, and keeps the page's date apart as `page_updated`. An export from before
 * that gave the page's date as `published`, so for one of those the date is worked out here instead.
 *   about  { topic, countryName } of the report, to read the month in a title
 * Returns { date (ISO), precision: "day" | "month", from: "valid from" | "title" }, or null.
 */
export function ownDate(v, about = {}) {
  if (!v) return null;
  if ("published_from" in v) {
    return v.published ? { date: v.published, precision: v.published_precision === "month" ? "month" : "day", from: v.published_from } : null;
  }
  if (v.valid_from) return { date: v.valid_from, precision: "day", from: "valid from" };
  const month = titleMonth({ title: v.title, ...about });
  return month ? { date: `${month}-01T00:00:00Z`, precision: "month", from: "title" } : null;
}

/** Where an edition sits on the timeline: its own date; with none, when the Internet Archive first had it,
 *  else the date GOV.UK gave (no later than which it was published), else when this copy first saw it. */
export function editionTime(v, about) {
  return ms(ownDate(v, about)?.date) || ms(v?.captured_at) || ms(v?.date) || ms(v?.published) || ms(v?.first_seen) || 0;
}

/** When an edition took effect: the earliest of its validity, publication and timeline dates. */
export function editionStart(v, about) {
  const xs = finite(ms(v?.valid_from), ms(v?.published), ms(v?.date));
  return xs.length ? Math.min(...xs) : editionTime(v, about);
}

/** When an edition's words were first seen anywhere: the earliest of the Internet Archive's first capture of
 *  them and this site's first copy. An ISO time, or null. Where the Home Office changes a note's words and
 *  keeps its version number and date, this is the only date that tells the two texts apart. */
export const firstSeen = (v) => [v?.captured_at, v?.first_seen].filter(Boolean).sort()[0] || null;

/**
 * The Internet Archive copy an edition can be read at once GOV.UK no longer shows it: its own, else the
 * latest held of the same words (the export lists one copy of a text and names the others under
 * `also_held_as`, so an edition copied from GOV.UK and since replaced has its archive copy there).
 * Returns { archive_url, captured_at } or null.
 */
export function archiveCopy(v) {
  if (v?.archive_url) return { archive_url: v.archive_url, captured_at: v.captured_at || null };
  const held = (v?.also_held_as || []).filter((c) => c.archive_url).sort((a, b) => String(a.captured_at || "").localeCompare(String(b.captured_at || "")));
  return held.length ? { archive_url: held.at(-1).archive_url, captured_at: held.at(-1).captured_at || null } : null;
}

/** When an Internet Archive copy was captured: the timestamp in its address (so a citation's date and link
 *  always agree), else the capture time recorded for the edition. An ISO time, or null. */
export function capturedAt(v) {
  const m = /\/web\/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(v?.archive_url || "");
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : v?.captured_at || null;
}

/**
 * An edition recovered as a PDF from the Internet Archive: GOV.UK no longer lists the file, and the text here is
 * read from the Archive's copy of it. It is two things at once, and is shown as both: "From the PDF" (the text
 * is an extraction, never "Verbatim") and an archived copy (its source is the Archive's address, never GOV.UK's).
 * Only its own archive address counts: a PDF that GOV.UK lists now may have an archive copy of the same words
 * named under `also_held_as`, and is still read from GOV.UK's file.
 */
export const isArchivedPdf = (v) => v?.source === "pdf" && !!v.archive_url;

/**
 * Where an edition can be read, for links and citations: { url, archived, capturedAt, pdf? }.
 *   - read from a PDF (pdf: true): GOV.UK's file for one GOV.UK lists now; for one recovered from the Internet
 *     Archive, the Archive's copy with its capture time (archived: true). Never GOV.UK's address for a file it
 *     no longer lists: that address now leads to a later edition, or nowhere;
 *   - the edition on GOV.UK now: GOV.UK;
 *   - else its Internet Archive copy, where one is held; else the report's GOV.UK address (fallback).
 *   gone  the report is no longer on GOV.UK
 */
export function editionWhere(v, { gone = false, fallback = "" } = {}) {
  if (v?.source === "pdf") {
    return isArchivedPdf(v) ? { url: v.archive_url, archived: true, capturedAt: capturedAt(v), pdf: true }
      : { url: v.pdf_url || "", archived: false, capturedAt: null, pdf: true };
  }
  if (v?.source === "live" && v.current && !gone && v.govuk_url) return { url: v.govuk_url, archived: false, capturedAt: null };
  const copy = archiveCopy(v);
  if (copy) return { url: copy.archive_url, archived: true, capturedAt: capturedAt(copy) };
  return { url: v?.govuk_url || fallback || "", archived: false, capturedAt: null };
}

/** How an edition's text was come by, in a few words for small print: "archived copy" (the Internet Archive's
 *  copy of the web page), "text from the PDF" (an edition read from its PDF), both for a PDF recovered from the
 *  Archive, and nothing for text read from GOV.UK itself. */
export function sourceWords(v) {
  if (v?.source === "wayback") return "archived copy";
  if (v?.source === "pdf") return isArchivedPdf(v) ? "text from the PDF · archived copy" : "text from the PDF";
  return "";
}

/**
 * Lay out a report's history.
 * series: { versions: [...] oldest first, history: [{date, note}] newest first }.
 * Returns { editions, events, stops, latest } where stops are both kinds in date order (an edition
 * before an update on the same instant) and latest is the index of the edition now on GOV.UK (the one
 * the export marks `current`), else of the newest held. They are not always the same: when GOV.UK puts
 * a note back to an earlier text, the edition in force is an earlier one, and a later one is history.
 *
 * A GOV.UK change note belongs to a held edition when that edition lists it, or when it is dated within
 * `window` of the edition taking effect (3 days' grace before) and the edition has no note of its own.
 * A note the export has tied to a PDF-only edition (pdf_url) is never folded into a held edition: it is
 * the publication of a different one.
 */
export function buildTimeline(series, { window = 45 * DAY } = {}) {
  const versions = (series?.versions || []).filter((v) => v && typeof v.body === "string");
  const about = { topic: series?.topic, countryName: series?.country_name };
  const editions = versions.map((v, i) => {
    const own = ownDate(v, about);
    return {
      // ids: every stored copy of this edition's words. The export lists one copy of a text and keeps the
      // others under `also_held_as`; a link or a saved highlight made on one of those still means this edition.
      kind: "edition", i, id: v.id, ids: [v.id, ...(v.also_held_as || []).map((c) => c.id)].filter(Boolean), v, version: v.version || null, own,
      t: editionTime(v, about), start: editionStart(v, about),
      prec: own?.precision === "month" ? "month" : "day",
      notes: (v.govuk_change_notes || []).filter((g) => g && g.note).map((g) => ({ date: g.date, note: g.note })),
    };
  });
  // The editions are in the order they were published. A date that would put one before its predecessor (a
  // note that misstates its own "valid from") does not move it: it sits at its predecessor's date.
  editions.forEach((e, i) => { if (i && e.t < editions[i - 1].t) e.t = editions[i - 1].t; });
  const listed = new Set(editions.flatMap((e) => e.notes.map((g) => `${g.date}|${g.note}`)));
  const listedDay = new Set(editions.flatMap((e) => e.notes.map((g) => `${String(g.date).slice(0, 10)}|${g.note}`)));
  const events = [];
  const history = (series?.history || []).filter((h) => h && h.note && Number.isFinite(ms(h.date)))
    .slice().sort((a, b) => ms(a.date) - ms(b.date));
  for (const h of history) {
    if (listed.has(`${h.date}|${h.note}`) || listedDay.has(`${String(h.date).slice(0, 10)}|${h.note}`)) continue;
    const d = ms(h.date);
    let host = null;
    for (const e of editions) if (e.start <= d + 3 * DAY) host = e;
    if (!h.pdf_url && host && d - host.start <= window && !host.notes.length) { host.notes.push({ date: h.date, note: h.note }); continue; }
    events.push({ kind: "update", t: d, date: h.date, note: h.note, inForce: host ? host.i : null, prec: "day",
      pdf: h.pdf_url ? { url: h.pdf_url, title: h.pdf_title || "" } : null });
  }
  const stops = [...editions, ...events].sort((a, b) => a.t - b.t || (a.kind === b.kind ? 0 : a.kind === "edition" ? -1 : 1));
  stops.forEach((s, k) => { s.k = k; });
  return { editions, events, stops, latest: latestEdition(editions) };
}

/** Which edition is "the latest": the one on GOV.UK now when one is (the last so marked), else the last held. */
function latestEdition(editions) {
  for (let i = editions.length - 1; i >= 0; i--) if (editions[i].v.current) return i;
  return editions.length - 1;
}

/** The held edition to show for a stop: itself, the edition in force on an update's date, else the earliest. */
/** The report's current edition when it is published as a PDF only ({ title, month, pdf_url, … }), else null. */
export function currentPdf(series) {
  return series?.current_pdf_only ? (series.pdf_editions || []).find((p) => p.current) || null : null;
}

const REMOVED = /\b(removed|withdrawn)\b/i;
const SOMETHING_NEW = /\b(add(?:ed|s|ing)?|publish(?:ed|es|ing)?|updat(?:ed|es|e|ing)|replac(?:ed|es|e|ing|ement)|new|revis(?:ed|ion)|version\s+\d|accessible)\b/i;
/**
 * Does a GOV.UK change note record a removal and nothing else? Then no edition was published by it
 * and there is nothing to hold. Only when the note says so itself: it speaks of something removed or
 * withdrawn and of nothing added, published, updated or replaced ("Removed X and added Y" is not one).
 */
export function isRemovalNote(note) {
  const t = String(note || "");
  return REMOVED.test(t) && !SOMETHING_NEW.test(t);
}
/** Why an update has no text of its own: "pdf" (that edition is a PDF only, which we link), "removed", or "not-held". */
export function updateKind(stop) {
  return stop?.pdf ? "pdf" : isRemovalNote(stop?.note) ? "removed" : "not-held";
}

export function editionForStop(stop, timeline) {
  if (!stop) return timeline.latest;
  if (stop.kind === "edition") return stop.i;
  return stop.inForce ?? 0;
}

/* ------------------------------------------------------------------ versions not held */

export const parseVer = (t) => { const m = /^(\d+)(?:\.(\d+))?/.exec(String(t || "")); return m ? { major: +m[1], minor: +(m[2] || 0) } : null; };

/** "v3.0 not held" when the previous held edition is not the version immediately before this one. */
export function versionsNotHeld(prev, cur) {
  const c = parseVer(cur);
  if (!c) return "";
  if (prev === undefined) return c.major > 1 || c.minor > 0 ? "earlier editions not held" : "";
  const p = parseVer(prev);
  if (!p) return "";
  const miss = [];
  if (c.major === p.major) for (let n = p.minor + 1; n < c.minor; n++) miss.push(`v${c.major}.${n}`);
  else if (c.major > p.major) for (let m = p.major + 1; m < c.major; m++) miss.push(`v${m}.0`);
  if (!miss.length) return "";
  return `${miss.length > 3 ? `${miss[0]}–${miss[miss.length - 1]}` : miss.join(", ")} not held`;
}

/* ------------------------------------------------------------------ captions */

/** What an edition says changed: the Home Office's own statement, else its GOV.UK change notes. */
export function captionSource(edition) {
  const v = edition?.v || {};
  if (v.change_statement_html || v.change_statement) {
    return { kind: "home-office", label: "Home Office", html: v.change_statement_html || null, text: v.change_statement || "" };
  }
  if (edition?.notes?.length) return { kind: "govuk", label: "GOV.UK change note", notes: edition.notes };
  return null;
}

/* ------------------------------------------------------------------ rewrites */

/**
 * Below this share of the earlier edition's wording kept, an edition counts as a rewrite: the history
 * caption says so, and Show changes offers the two texts side by side before a redline that would mark
 * almost everything. (Of 209 consecutive pairs held, 120 keep 90% or more and 68 keep under 25%.)
 */
export const REWRITE_THRESHOLD = 0.25;

/** True when a similarity (0..1, from the export or wordingKept) marks a rewrite. */
export const isRewrite = (sim) => typeof sim === "number" && Number.isFinite(sim) && sim < REWRITE_THRESHOLD;

/** "about 5%", "less than 1%": a similarity as words. */
export function keptPercent(sim) {
  const p = Math.round(sim * 100);
  return sim > 0 && p < 1 ? "less than 1%" : `about ${p}%`;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", hellip: "…" };
const TAGS = /<(script|style)\b[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->|<[^>]*>/gi;
/** The words of a body's text, lower-cased, punctuation stripped: as the export's body_words (src/cpin/export.py). */
export function bodyWords(body) {
  const text = String(body || "").replace(TAGS, " ").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " "; }
    return namedEntity(e, m);
  });
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}
// Named entities must decode as the export's html.unescape does, or the two measures drift apart
// ("caf&eacute;" is one word, "&pound;5" is "5"). A browser knows every entity, so it is asked (once per
// name); without a DOM (the tests), the common ones in the table above.
const entityCache = new Map();
let entityBox = null;
function namedEntity(name, raw) {
  if (Object.hasOwn(ENTITIES, name)) return ENTITIES[name];
  if (typeof document === "undefined") return ENTITIES[name.toLowerCase()] ?? raw;
  if (!entityCache.has(name)) {
    entityBox ??= document.createElement("textarea");
    entityBox.innerHTML = `&${name};`;
    entityCache.set(name, entityBox.value);
  }
  return entityCache.get(name);
}
/**
 * How much of one edition's wording another keeps: five-word phrases in common ÷ phrases in the larger
 * edition (the export's similarity_to_previous, for pairs that are not consecutive).
 */
export function wordingKept(bodyA, bodyB, n = 5) {
  return phrasesShared(phrasesOf(bodyA, n), phrasesOf(bodyB, n));
}
/** Every run of n consecutive words of a body, as a Set (a text shorter than n words is one phrase).
 *  The costly half of wordingKept: keep the Set to compare one edition with several others. */
export function phrasesOf(body, n = 5) {
  const w = bodyWords(body), out = new Set();
  if (w.length < n) { if (w.length) out.add(w.join(" ")); return out; }
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}
/** Phrases in common ÷ phrases in the larger of two phrasesOf() Sets, to 3 decimals (1 when both are empty). */
export function phrasesShared(A, B) {
  const larger = Math.max(A.size, B.size);
  if (!larger) return 1;
  let common = 0;
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  for (const p of small) if (big.has(p)) common++;
  return Math.round((common / larger) * 1000) / 1000;
}

/**
 * Whether editions came between edition i and the one held before it: its version number skips
 * (v3.0 -> v7.0), or GOV.UK published updates in between whose editions are not held. (An update dated
 * after edition i took effect is about edition i itself, wherever it falls on the timeline.)
 */
export function editionsBetweenNotHeld(timeline, i) {
  const cur = timeline?.editions?.[i], prev = timeline?.editions?.[i - 1];
  if (!cur || !prev) return false;
  if (versionsNotHeld(prev.version ?? undefined, cur.version)) return true;
  return timeline.stops.some((s) => s.kind === "update" && s.k > prev.k && s.k < cur.k && s.inForce !== cur.i);
}

/** A heading's words, for matching it across editions: lower-cased, its number and punctuation dropped
 *  ("9. Judiciary" and "8.2 Judiciary:" are the same heading). */
export function headingKey(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim()
    .replace(/^(?:\d{1,3}(?:\.\d{1,3})*\.?|[a-z]\))\s+/, "")
    .replace(/[^\p{L}\p{N} ]+/gu, "").replace(/ +/g, " ").trim();
}

/**
 * The headings two editions share, in order, so their sections can be lined up side by side: the longest
 * sequence of equal keys that keeps both orders. Returns [[oldIndex, newIndex], …]; empty keys never match.
 */
export function alignHeadings(oldKeys, newKeys) {
  const n = oldKeys.length, m = newKeys.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  const eq = (i, j) => !!oldKeys[i] && oldKeys[i] === newKeys[j];
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = eq(i, j) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (eq(i, j)) { pairs.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return pairs;
}

/**
 * Linked scrolling for two editions side by side. points are [x, y] pairs: where each shared heading sits in
 * one text and in the other. increasing() keeps those that go forward in both; mapThrough() carries a position
 * in the first text to the second, in proportion between the points either side of it.
 */
export function increasing(points) {
  const out = [];
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const last = out[out.length - 1];
    if (!last || (x >= last[0] && y >= last[1])) out.push([x, y]);
  }
  return out;
}
export function mapThrough(points, x) {
  if (!points.length) return 0;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    if (x <= x1) return x1 === x0 ? y1 : y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
  }
  return points[points.length - 1][1];
}

const BACK_MATTER = /^\s*(bibliography|sources (cited|consulted)|version control|terms of reference|research methodology|annex|feedback)/i;

const PLAIN_HEADINGS = new Set(["general", "overview", "introduction", "contents", "summary", "other", "others", "sources", "annex", "background", "note", "notes", "update", "updates"]);
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A heading's name as a statement would say it: without its number, spaces tidied. */
export const headingName = (text) => String(text || "").replace(/\s+/g, " ").trim().replace(/^\d{1,3}(?:\.\d{1,3})*\.?\s+/, "");
/**
 * The report's own sections named in a change statement, so the page can link them:
 * "Updated country information and assessment" names "Country information" and "Assessment".
 *   headings  [{ text, level }] of the edition the statement belongs to, in document order
 * Returns [{ start, end, heading }] (heading: the heading's full text), in order, never overlapping.
 * Only a heading's whole name counts, as whole words, in any case (a final "s" may come or go on the
 * last word); the longest name wins where two overlap; of two headings with one name, the higher
 * level, then the earlier. Back matter (bibliography, version control) and names too plain to mean a
 * section ("General", "Overview") are never linked.
 */
export function findSectionNames(text, headings) {
  const str = String(text || ""), byName = new Map();
  for (const h of headings || []) {
    const name = headingName(h.text), key = name.toLowerCase();
    const words = key.split(" ").filter(Boolean);
    if (!words.length || name.length < 4 || BACK_MATTER.test(name) || (words.length === 1 && PLAIN_HEADINGS.has(key))) continue;
    const had = byName.get(key);
    if (!had || (h.level || 9) < (had.level || 9)) byName.set(key, { words, level: h.level, heading: String(h.text).replace(/\s+/g, " ").trim() });
  }
  const found = [];
  for (const { words, heading } of byName.values()) {
    const last = words.at(-1).replace(/s$/, "");
    const body = [...words.slice(0, -1).map(reEscape), `${reEscape(last)}s?`].join("[\\s\\u00a0]+").replace(/['’]/g, "['’]");
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
    for (const m of str.matchAll(re)) found.push({ start: m.index, end: m.index + m[0].length, heading });
  }
  found.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const kept = [];
  for (const f of found) if (!kept.some((k) => f.start < k.end && k.start < f.end)) kept.push(f);
  return kept.sort((a, b) => a.start - b.start);
}

/**
 * The computed line under a caption, from a diff summary { stats, toc }: the sections of the new
 * edition with most changes (back matter such as the bibliography is left out of the ranking) and the
 * word totals.
 */
export function computedSummary(sum, { max = 3 } = {}) {
  if (!sum?.stats) return null;
  const st = sum.stats;
  let back = false;
  const secs = (sum.toc || []).map((t, k) => {
    if (t.level <= 2) back = BACK_MATTER.test(t.text || "");
    return { ...t, k, back };
  }).filter((t) => t.count > 0 && t.st !== "del" && !t.back)
    .sort((x, y) => y.count - x.count || x.k - y.k)
    .slice(0, max)
    .map(({ text, count, id, level }) => ({ text, count, id: id || null, level }));
  return { changes: st.changes || 0, ins: st.ins || 0, del: st.del || 0, noteChanges: st.noteChanges || 0, secs };
}

/* ------------------------------------------------------------------ section and paragraph references */

const NUM = String.raw`\d{1,3}(?:\.\d{1,3}){0,4}(?![\d\p{L}])`;
const SEP = String.raw`(?:\s*,\s*(?:and\s+|&\s*)?|\s+and\s+|\s*&\s*|\s+to\s+|\s*[–—-]\s*)`;
const REF_RE = new RegExp(String.raw`(?<![\p{L}\p{N}])(sections?|paragraphs?|paras?\.?|§§?)\s*(${NUM}(?:${SEP}${NUM})*)`, "giu");
const NUM_RE = new RegExp(NUM, "gu");

/**
 * Section and paragraph numbers referred to in a sentence. Each number is returned separately with its
 * offsets in `text`: "sections 13.4, and 16.3 to 16.5" -> 13.4, 16.3, 16.5 (kind "section");
 * "paragraphs 7.3.2 and 7.3.3" -> 7.3.2, 7.3.3 (kind "paragraph").
 */
export function findParaRefs(text) {
  const out = [];
  const s = String(text || "");
  REF_RE.lastIndex = 0;
  for (let m = REF_RE.exec(s); m; m = REF_RE.exec(s)) {
    const kind = /^(para|§)/i.test(m[1]) ? "paragraph" : "section";
    const listAt = m.index + m[0].length - m[2].length;
    NUM_RE.lastIndex = 0;
    for (let n = NUM_RE.exec(m[2]); n; n = NUM_RE.exec(m[2])) {
      out.push({ start: listAt + n.index, end: listAt + n.index + n[0].length, num: n[0], kind });
    }
  }
  return out;
}

/** The number a paragraph ("13.4.1 Text") or heading ("13.4 Title", "13. Title") starts with, or null. */
export function leadingNumber(text, { heading = false } = {}) {
  const t = String(text || "").replace(/^[\s ]+/, "");
  const m = heading ? /^(\d{1,3}(?:\.\d{1,3})*)\.?(?=[\s ]|$)/.exec(t) : /^(\d{1,3}(?:\.\d{1,3})+)(?=[\s ]|$)/.exec(t);
  return m ? m[1] : null;
}

/**
 * Where a reference points, among the numbered headings and paragraphs of the text shown
 * (targets: [{ num, kind: "h" | "p" }] in document order). A section goes to its heading, else the
 * first paragraph numbered within it ("13.4" -> 13.4.1); a paragraph to itself. members are the
 * targets inside the reference (13.4, 13.4.1, 13.4.2 …), at most `cap`, for highlighting.
 * Returns { index, members } or null.
 */
export function resolveParaRef(num, kind, targets, { cap = 40 } = {}) {
  if (!num || !targets?.length) return null;
  const prefix = `${num}.`;
  const find = (pred) => targets.findIndex(pred);
  const exactH = find((t) => t.kind === "h" && t.num === num);
  const exactP = find((t) => t.kind === "p" && t.num === num);
  const firstH = find((t) => t.kind === "h" && t.num?.startsWith(prefix));
  const firstP = find((t) => t.kind === "p" && t.num?.startsWith(prefix));
  const earliest = (...xs) => { const ok = xs.filter((i) => i >= 0); return ok.length ? Math.min(...ok) : -1; };
  const index = kind === "paragraph"
    ? (exactP >= 0 ? exactP : exactH >= 0 ? exactH : earliest(firstP, firstH))
    : (exactH >= 0 ? exactH : earliest(exactP, firstH, firstP));
  if (index < 0) return null;
  const members = [];
  for (let i = index; i < targets.length && members.length < cap; i++) {
    const n = targets[i].num;
    if (n === num || n?.startsWith(prefix)) members.push(i);
    else if (i > index && targets[i].kind === "h" && !n?.startsWith(prefix)) {
      // A heading outside the section ends it (unnumbered sub-headings are skipped above).
      if (n) break;
    }
  }
  if (!members.includes(index)) members.unshift(index);
  return { index, members };
}

/* ------------------------------------------------------------------ addresses */

const enc = (s) => encodeURIComponent(s).replace(/%3A/gi, ":");

/** The report page's address. Only what differs from the default view (the latest edition, clean) is added. */
export function reportUrl({ country, series, edition = null, changes = false, view = null, from = null, q = null } = {}, hash = "") {
  let url = `index.html?country=${enc(country)}&series=${enc(series)}`;
  if (edition) url += `&edition=${enc(edition)}`;
  if (changes) url += "&changes=1";
  if (changes && from) url += `&from=${enc(from)}`;
  if (changes && view === "sbs") url += "&view=sbs";
  if (q) url += `&q=${encodeURIComponent(q)}`;
  return url + (hash || "");
}

/**
 * When an edition stopped being the one on GOV.UK, as this copy saw it happen: the export's `left_govuk`,
 * { at, last_seen, how }. `at` is the check that first found it replaced or gone and `last_seen` the last
 * check that read it there, so the change fell between the two. Only an edition that was live while this
 * site was watching has one; an Internet Archive copy has its capture dates instead.
 *   fmt(iso)  how a date is written
 * Returns null, or { how: "replaced" | "withdrawn", when, label, sentence }:
 *   label     "Archived 14 Oct 2026"
 *   sentence  "GOV.UK replaced it with a newer edition between 13 Oct 2026 (last seen there) and 14 Oct 2026 (found replaced)."
 */
export function leftGovuk(left, fmt) {
  if (!left?.at) return null;
  const withdrawn = left.how === "withdrawn";
  const when = fmt(left.at), seen = left.last_seen ? fmt(left.last_seen) : "";
  const found = withdrawn ? "found gone" : "found replaced";
  const span = seen && seen !== when ? `between ${seen} (last seen there) and ${when} (${found})` : `by ${when} (${found})`;
  return { how: withdrawn ? "withdrawn" : "replaced", when, label: `Archived ${when}`,
    sentence: `GOV.UK ${withdrawn ? "withdrew it" : "replaced it with a newer edition"} ${span}.` };
}

/**
 * What is known of when the words of the edition now on GOV.UK were read there, as this copy saw it: the sync
 * that first read this text (`first_seen`) and, where the export gives it, the last sync that read it again
 * (`last_seen`). The time of the site's last check is not one of them. A check compares the dates GOV.UK gives
 * each country page and does not read every note again each time, so it is reported as a check, never as the
 * moment these words were confirmed.
 *   lastCheck  when the site last ran a check of any kind (data.json: last_sync)
 *   fmt(iso)   how a date and time is written
 * Returns { how, when, check }: how the words were read ("last read" | "read" | ""), when, and a sentence
 * about the last check ("" when its time is not known).
 */
export function readOnGovuk(v, lastCheck, fmt) {
  const at = v?.last_seen || v?.first_seen || null;
  return {
    how: v?.last_seen ? "last read" : v?.first_seen ? "read" : "",
    when: at ? fmt(at) : "",
    check: lastCheck ? `GOV.UK was last checked for changes on ${fmt(lastCheck)}. A check compares the dates GOV.UK gives each country page: it does not read every note again each time.` : "",
  };
}

/** The exported file holding every edition of a report, relative to a page in prototypes/<page>/. */
export const seriesPath = (country, key) => `../data/series/${country}/${String(key).replace(/:/g, "--")}.json`;
