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
