// CPIN Explorer · where a note's text comes from: its index.json, the edition to show, the verbatim
// body file and the URL a citation should point at. Edition logic is pure (Node-testable); the fetch
// helpers need a browser (or Node's fetch).
import { fetchJson } from "./fetch-json.js";
import { paraAt, paraDepth, paraNumber, paraRange } from "./citation.js";

/** fetch() + text with quick retries, for flaky networks and busy dev servers. */
export async function fetchText(url, { tries = 3 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      if (attempt >= tries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
}

const firstCapture = (v) => (v.captures || []).reduce((min, c) => (!min || c.captured_at < min ? c.captured_at : min), null);

/** The latest Internet Archive capture of an edition: { captured_at, archive_url } or null. */
export function latestCapture(version) {
  return (version?.captures || []).reduce((best, c) => (!best || c.captured_at > best.captured_at ? c : best), null);
}

/**
 * The edition to read: the live one when GOV.UK still has the note, otherwise the newest edition held
 * (by first capture, then first seen, then position in the list).
 */
export function pickEdition(index) {
  const versions = index?.versions || [];
  if (!versions.length) return null;
  if (index.current_sha256) {
    const live = versions.find((v) => v.sha256 === index.current_sha256);
    if (live) return live;
  }
  const key = (v, i) => [firstCapture(v) || v.public_updated_at || v.first_seen || "", i];
  return versions.map((v, i) => [key(v, i), v])
    .sort(([a], [b]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]))
    .at(-1)[1];
}

/** Where things live, relative to a page in prototypes/<page>/. */
export const paths = {
  data: "../dashboard/data.json",
  manifest: "../../data/images/manifest.json",
  index: (country, note) => `../../data/countries/${country}/notes/${note}/index.json`,
  body: (country, note, sha) => `../../data/countries/${country}/notes/${note}/${String(sha).slice(0, 16)}.html`,
  image: (entry) => `../../data/images/files/${entry.sha256}${entry.ext}`,
  reader: (country, note, hash = "") => `../reader/index.html?country=${encodeURIComponent(country)}&note=${encodeURIComponent(note)}${hash}`,
};

/**
 * How to cite an edition: the GOV.UK URL while it is the live edition, otherwise its newest Internet
 * Archive capture (archived: true). note is the dashboard entry, index the note's index.json.
 */
export function editionSource(edition, { note = {}, index = {} } = {}) {
  const live = edition && edition.source === "live" && index.current_sha256 === edition.sha256 && index.status !== "removed" && index.status !== "archived";
  if (live) {
    const url = note.govuk_url || (index.base_path ? `https://www.gov.uk${index.base_path}` : "");
    if (url) return { url, archived: false, capturedAt: null };
  }
  const cap = latestCapture(edition);
  if (cap) return { url: cap.archive_url, archived: true, capturedAt: cap.captured_at };
  return { url: note.archive_url || note.govuk_url || "", archived: !!note.archive_url, capturedAt: null };
}

const isSafe = (url) => !/^\s*(javascript|data|vbscript):/i.test(url || "");

/**
 * Parse a verbatim body into a detached element, dropping anything executable. The words are not
 * touched; this only guards against markup we would never want to run.
 */
export function parseBody(html, doc = document) {
  const tpl = doc.createElement("template");
  tpl.innerHTML = html;
  const root = tpl.content;
  root.querySelectorAll("script, style, iframe, object, embed, link, meta, base, form").forEach((el) => el.remove());
  for (const el of root.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || ((name === "href" || name === "src" || name === "xlink:href") && !isSafe(attr.value))) el.removeAttribute(attr.name);
    }
  }
  const govspeak = root.querySelector(".govspeak");
  return { fragment: root, root: govspeak || root };
}

/** The plain text a reader anchors highlights against (same as the rendered article's textContent). */
export function bodyText(html, doc = document) {
  const { root } = parseBody(html, doc);
  return root.textContent;
}

/** Load a note's index.json and the body of the edition to read. */
export async function loadNote(country, note) {
  const index = await fetchJson(paths.index(country, note));
  const edition = pickEdition(index);
  if (!edition) return { index, edition: null, html: "" };
  const html = await fetchText(paths.body(country, note, edition.sha256));
  return { index, edition, html };
}

/* ------------------------------------------------------------------ structure of a body (DOM) */

const PARA_EXCLUDE = "table, .footnotes, li, blockquote, .info-notice, .call-to-action, .application-notice";

/**
 * Text offsets of a body's structure: numbered paragraphs, headings, footnote references and footnote
 * texts. Offsets are into root.textContent, so they hold however the DOM is later split up (marks,
 * hanging paragraph numbers). Works on detached trees (template content, DOMParser documents).
 */
export function analyseBody(root) {
  const doc = root.ownerDocument || document;
  const starts = new Map(), parts = [];
  let off = 0;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { starts.set(n, off); parts.push(n.data); off += n.data.length; }
  const text = parts.join("");
  const firstTextAt = (el) => {
    const w = doc.createTreeWalker(el, 4);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      if (t.data.trim()) return starts.get(t) + (t.data.length - t.data.trimStart().length);
    }
    return null;
  };
  const ps = [...root.querySelectorAll("p")].filter((p) => !p.closest(PARA_EXCLUDE));
  const depth = paraDepth(ps.map((p) => p.textContent));
  const paras = [];
  for (const p of ps) { const num = paraNumber(p.textContent, { minDepth: depth }); if (num) paras.push({ el: p, num }); }
  const paraOf = new Map(paras.map((x) => [x.el, x.num]));
  const anchors = [], sections = [];
  for (const el of root.querySelectorAll("h2, h3, h4, p, .footnotes")) {
    const isPara = el.tagName === "P";
    if (isPara && !paraOf.has(el)) continue;
    const at = firstTextAt(el);
    if (at == null) continue;
    if (isPara) { anchors.push({ at, para: paraOf.get(el) }); continue; }
    const fn = el.matches(".footnotes");
    const title = fn ? "Footnotes" : el.textContent.replace(/\s+/g, " ").trim();
    anchors.push({ at, heading: title });
    if (el.tagName !== "H4") sections.push({ at, title, id: el.id || (fn ? "footnotes" : ""), level: el.tagName === "H3" ? 3 : 2, el });
  }
  anchors.sort((a, b) => a.at - b.at);
  sections.sort((a, b) => a.at - b.at);
  const refs = [...root.querySelectorAll('a[role="doc-noteref"], sup a.footnote[href^="#fn"]')].map((a) => ({
    a, n: Number((a.getAttribute("href") || "").match(/(\d+)\s*$/)?.[1] || a.textContent.match(/\d+/)?.[0]),
    at: firstTextAt(a), len: a.textContent.trim().length,
  })).filter((r) => r.n && r.at != null).sort((x, y) => x.at - y.at);
  const fns = new Map();
  for (const li of root.querySelectorAll('.footnotes li[id], li[id^="fn"]')) {
    const n = Number(li.id.match(/(\d+)$/)?.[1]);
    if (!n || fns.has(n)) continue;
    const clone = li.cloneNode(true);
    clone.querySelectorAll('[role="doc-backlink"], .reversefootnote').forEach((x) => x.remove());
    const link = clone.querySelector("a[href^='http']");
    fns.set(n, { n, text: clone.textContent.replace(/\s+/g, " ").trim(), url: link?.getAttribute("href") || null, html: clone.innerHTML.trim() });
  }
  return { text, depth, paras, anchors, sections, refs, fns };
}

/** Paragraph (or range), section and the footnote sources a passage [s, e) cites, including footnotes
 *  that follow it directly ("…Armed Forces.[footnote 12]"). */
export function describePassage(a, s, e) {
  const para = paraRange(paraAt(a.anchors, s), paraAt(a.anchors, Math.max(s, e - 1)));
  let section = null;
  for (const x of a.sections) { if (x.at > s) break; section = x.title; }
  const ns = [];
  let end = e;
  for (const r of a.refs) {
    if (r.at < s) continue;
    if (r.at < end) { if (!ns.includes(r.n)) ns.push(r.n); continue; }
    if (a.text.slice(end, r.at).trim()) break;
    if (!ns.includes(r.n)) ns.push(r.n);
    end = r.at + r.len;
  }
  const sources = ns.map((n) => { const f = a.fns.get(n); return { n, text: f?.text || `Footnote ${n}`, url: f?.url || null }; });
  return { para, section, sources };
}
