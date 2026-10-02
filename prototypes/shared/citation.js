// CPIN Explorer · citations for passages quoted from Home Office country notes.
// Pure functions, no DOM: they run in the browser and in Node (web/test/citation.test.mjs).
//
//   OSCOLA     Home Office, <i>Country Policy and Information Note: Military Service, Iran</i>
//              (version 4.0, August 2026) para 9.1.1 <https://www.gov.uk/…#:~:text=…> accessed 2 October 2026.
//   Tribunal   CPIN Iran: Military service (v4.0, Aug 2026) at [9.1.1]
//
// The quoted words are never changed: footnote markers ("[footnote 12]") are dropped, whitespace is
// collapsed and a leading paragraph number moves into the pinpoint; nothing else.

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
export const STYLES = ["oscola", "tribunal"];
export const STYLE_NAMES = { oscola: "OSCOLA", tribunal: "Tribunal" };

const MONTH_RE = new RegExp(`(${MONTHS.join("|")})\\s+(\\d{4})`, "i");
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const capFirst = (s) => { const t = String(s ?? ""); return t.charAt(0).toUpperCase() + t.slice(1); };
const collapse = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------------ dates */

/** "2 October 2026". ISO strings are read in UTC (GOV.UK and capture timestamps); Date objects locally. */
export function longDate(when = new Date()) {
  if (typeof when === "string") {
    const d = new Date(when);
    if (Number.isNaN(+d)) return "";
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
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

/** Names a title may use for the country: "Myanmar (Burma)" -> ["Myanmar (Burma)", "Burma", "Myanmar"]. */
function countryNames(name) {
  const out = new Set();
  if (name) {
    out.add(name);
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
  // "…gender identity and expression in Namibia": the country is already in the topic.
  const countryInTopic = !country && names.some((n) => new RegExp(`\\b${escRe(n)}$`, "i").test(rest));

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

/** The italic part of an OSCOLA citation: kind + topic + country, in title case. */
export function italicTitle(ctx) {
  const p = parseNoteTitle(ctx);
  const body = [titleCase(p.topic), p.country].filter(Boolean).join(", ");
  return p.kindName ? `${titleCase(p.kindName)}: ${body}` : body;
}

/* ------------------------------------------------------------------ paragraphs */

/** CPIN paragraph number at the start of a paragraph's text ("9.1.1 Under articles…" -> "9.1.1"). */
export function paraNumber(text, { minDepth = 2 } = {}) {
  const m = /^\s*(\d{1,2}(?:\.\d{1,3}){1,4})(?=\s|$)/.exec(String(text ?? ""));
  if (!m) return null;
  return m[1].split(".").length >= minDepth ? m[1] : null;
}

/** Sniff whether a note numbers its paragraphs 1.2.3 (most CPINs) or 1.2 (some older notes). */
export function paraDepth(paragraphTexts) {
  let three = 0;
  for (const t of paragraphTexts) if (paraNumber(t, { minDepth: 3 })) three++;
  return three >= 3 ? 3 : 2;
}

/** The numbered paragraph that governs a text offset: the last one starting at or before it, unless a
 *  heading intervenes. anchors: [{ at, para } | { at, heading }] sorted by offset. */
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

const splitRange = (para) => String(para).split(/\s*[–—-]\s*/).filter(Boolean);

/** Pinpoint for a paragraph or range: OSCOLA "para 9.1.1" / "paras 9.1.1–9.1.3"; tribunal "at [9.1.1]". */
export function formatPinpoint(para, style = "oscola") {
  if (!para) return "";
  const [a, b] = splitRange(para);
  if (style === "tribunal") return b ? `at [${a}]–[${b}]` : `at [${a}]`;
  return b ? `paras ${a}–${b}` : `para ${a}`;
}

/* ------------------------------------------------------------------ quotes */

export const FOOTNOTE_MARKER = /\s*\[footnote\s+\d+\]/gi;

/** Remove GOV.UK footnote markers ("[footnote 12]") and the space before them. */
export function stripFootnoteMarkers(text) {
  return String(text ?? "").replace(FOOTNOTE_MARKER, "");
}

/** The quote as it is cited: markers out, whitespace collapsed, a leading paragraph number dropped. */
export function cleanQuote(text, { dropPara = true } = {}) {
  let q = collapse(stripFootnoteMarkers(text));
  if (dropPara) q = q.replace(/^\d{1,2}(?:\.\d{1,3}){1,4}\s+(?=\S)/, "");
  return q;
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

/**
 * ctx: { title, kind, topic, countryName, version, month, para, section, url, quote,
 *        archived, capturedAt, accessed }
 * Returns { text, html, md, url }.
 */
export function formatCitation(ctx, style = "oscola") {
  const p = parseNoteTitle(ctx);
  const month = monthLabel(p.month) || monthLabel(ctx.month);
  const url = citationUrl(ctx.url, ctx.quote);
  const archivedNote = ctx.archived
    ? `archived copy, Internet Archive${ctx.capturedAt ? `, captured ${longDate(ctx.capturedAt)}` : ""}`
    : "";

  if (style === "tribunal") {
    const kindShort = KIND_SHORT[ctx.kind] || (p.kindName ? capFirst(p.kindName) : "");
    const country = p.country || ctx.countryName || "";
    const name = `${[kindShort, country].filter(Boolean).join(" ")}: ${capFirst(p.topic)}`;
    const when = [ctx.version ? `v${ctx.version}` : null, month?.short].filter(Boolean).join(", ");
    const pin = ctx.para ? ` ${formatPinpoint(ctx.para, "tribunal")}` : ctx.section ? `, ‘${ctx.section}’` : "";
    const tail = `${when ? ` (${when})` : ""}${pin}${archivedNote ? ` (${archivedNote})` : ""}`;
    return {
      text: name + tail,
      html: (url ? `<a href="${escHtml(url)}">${escHtml(name)}</a>` : escHtml(name)) + escHtml(tail),
      md: `${name}${tail}${url ? ` <${url}>` : ""}`,
      url,
    };
  }

  const italic = italicTitle(ctx);
  const when = [ctx.version ? `version ${ctx.version}` : null, month?.long].filter(Boolean).join(", ");
  const pin = ctx.para ? formatPinpoint(ctx.para, "oscola") : ctx.section ? `section ‘${ctx.section}’` : "";
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
  const q = cleanQuote(ctx.quote);
  const c = formatCitation(ctx, style);
  const s = formatSources(sources);
  return {
    text: `“${q}” ${c.text}${s.text ? `\n\n${s.text}` : ""}`,
    html: `<p>“${escHtml(q)}” ${c.html}</p>${s.html}`,
    md: `> ${q}\n\n${c.md}${s.md ? `\n\n${s.md}` : ""}`,
    url: c.url,
  };
}
