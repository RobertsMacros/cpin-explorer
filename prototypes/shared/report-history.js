// CPIN Explorer · a report's history, as pure functions (no DOM; Node-testable).
//
// A report (series) is every edition of one note we hold, oldest first, plus GOV.UK's change notes for
// it. The report page puts them on one timeline:
//   - editions: held, readable and comparable (the slider's handles stop on them);
//   - updates:  GOV.UK change notes that belong to no held edition (an edition we never captured, or a
//               report with one edition and a long history). They are dated stops that Play steps
//               through, so every report has a playable history.
// Captions quote the Home Office's own "Changes from last version of this note" (verbatim), else the
// GOV.UK change note (verbatim). References to sections and paragraphs in them ("sections 13.4, and
// 16.3 to 16.5", "paragraph 7.3.2") are found here so the page can link them to the text.

export const DAY = 86400000;
const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const finite = (...xs) => xs.filter(Number.isFinite);

/** Where an edition sits on the timeline: its GOV.UK date, else publication, validity, first seen. */
export function editionTime(v) {
  return ms(v?.date) || ms(v?.published) || ms(v?.valid_from) || ms(v?.first_seen) || 0;
}

/** When an edition took effect: the earliest of its validity, publication and timeline dates. */
export function editionStart(v) {
  const xs = finite(ms(v?.valid_from), ms(v?.published), ms(v?.date));
  return xs.length ? Math.min(...xs) : editionTime(v);
}

/**
 * Lay out a report's history.
 * series: { versions: [...] oldest first, history: [{date, note}] newest first }.
 * Returns { editions, events, stops, latest } where stops are both kinds in date order (an edition
 * before an update on the same instant) and latest is the index of the newest held edition.
 *
 * A GOV.UK change note belongs to a held edition when that edition lists it, or when it is dated within
 * `window` of the edition taking effect (3 days' grace before) and the edition has no note of its own.
 */
export function buildTimeline(series, { window = 45 * DAY } = {}) {
  const versions = (series?.versions || []).filter((v) => v && typeof v.body === "string");
  const editions = versions.map((v, i) => ({
    kind: "edition", i, id: v.id, v, version: v.version || null,
    t: editionTime(v), start: editionStart(v),
    prec: v.published && v.published_precision === "month" ? "month" : "day",
    notes: (v.govuk_change_notes || []).filter((g) => g && g.note).map((g) => ({ date: g.date, note: g.note })),
  }));
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
    if (host && d - host.start <= window && !host.notes.length) { host.notes.push({ date: h.date, note: h.note }); continue; }
    events.push({ kind: "update", t: d, date: h.date, note: h.note, inForce: host ? host.i : null, prec: "day" });
  }
  const stops = [...editions, ...events].sort((a, b) => a.t - b.t || (a.kind === b.kind ? 0 : a.kind === "edition" ? -1 : 1));
  stops.forEach((s, k) => { s.k = k; });
  return { editions, events, stops, latest: editions.length - 1 };
}

/** The held edition to show for a stop: itself, the edition in force on an update's date, else the earliest. */
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

/** How long Play lingers on a caption so it can be read: about 2.5 to 5.5 seconds. */
export function dwellFor(chars) {
  return Math.max(2500, Math.min(5500, 1400 + ((chars || 24) + 40) * 13));
}

const BACK_MATTER = /^\s*(bibliography|sources (cited|consulted)|version control|terms of reference|research methodology|annex|feedback)/i;

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

/** The exported file holding every edition of a report, relative to a page in prototypes/<page>/. */
export const seriesPath = (country, key) => `../data/series/${country}/${String(key).replace(/:/g, "--")}.json`;
