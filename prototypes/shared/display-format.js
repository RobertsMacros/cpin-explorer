// CPIN Explorer · reading aids for a note's own text. Display only: nothing here adds, drops, changes or
// reorders a character. Existing characters are wrapped in a <span> and blocks are given a class; every
// mark a reader sees beyond that (a rule, an indent) comes from CSS, so the text a reader selects, saves
// or cites is still exactly what GOV.UK published.
//
//   1. Odd spaces. The Home Office's text carries narrow no-break spaces, thin spaces, hair spaces and
//      en spaces pasted in from its sources ("had been surveilling"). They are kept, and shown at the
//      width of an ordinary word space (reader.css: .sp-*).
//   2. Typed enumerators. A run of paragraphs that each begin "(1)", "(a)", "(i)", "1.", "a)", with or
//      without an opening quotation mark, is shown as a list: the enumerator hangs beside its text.
//   3. Quoted runs. After a lead-in ending in a colon, paragraphs that open with a quotation mark, down to
//      the one where the quotation closes, carry a thin rule down the left (the look of <blockquote>).
//
// The detection (pure functions on text) is Node-testable; formatDisplay applies it to a DOM tree.
import { paraNumber } from "./citation.js";

/* ------------------------------------------------------------------ 1. odd spaces */

/** Typed spaces that are not the width of a word space, and the class that evens each out. */
export const ODD_SPACES = { "\u202f": "sp-nn", "\u2009": "sp-th", "\u200a": "sp-hr", "\u2002": "sp-en" };
const ODD_SPACE = /[\u202f\u2009\u200a\u2002]/;

/* ------------------------------------------------------------------ 2. typed enumerators */

const ENUM = /^(\s*)([‘“'"]?\(?)(\d{1,2}|[A-Za-z]{1,6})([.)])(?=\s)/;
const ROMAN = /^(x{0,3})(ix|iv|v?i{0,3})$/;
const ONES = { "": 0, i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9 };
const MAX_JUMP = 4;          // "(1) (2) (5)": an excerpt may skip a few; more than this starts afresh
const MAX_BETWEEN = 12;      // unmarked blocks allowed between two items (an answer, a sub-list) before a list is taken to have ended
/** Hanging indent of a marker n characters wide, in em of the paragraph (reader.css: .en uses the same sums). */
export const markerWidth = (n) => Math.round((n * 0.468 + 0.5) * 1000) / 1000;

/**
 * A typed enumerator at the start of a block's text: "(1)", "‘(a)", "iv.", "2)".
 * Returns { start, end, shape, values: [{ k, v }] } (start..end covers the opening quote mark and the
 * enumerator; a token such as "i" may be a letter or a Roman numeral, so it has two values) or null.
 */
export function findEnumerator(text) {
  const m = ENUM.exec(String(text ?? ""));
  if (!m) return null;
  const [, lead, pre, tok, close] = m;
  const open = pre.endsWith("(");
  if (open && close !== ")") return null;
  const values = [];
  if (/^\d/.test(tok)) {
    if (+tok >= 1) values.push({ k: "n", v: +tok });
  } else {
    const lower = tok === tok.toLowerCase(), upper = tok === tok.toUpperCase();
    if (!lower && !upper) return null;
    const t = tok.toLowerCase(), r = ROMAN.exec(t);
    if (r) values.push({ k: lower ? "r" : "R", v: r[1].length * 10 + ONES[r[2]] });
    if (t.length === 1) values.push({ k: lower ? "a" : "A", v: t.charCodeAt(0) - 96 });
  }
  if (!values.length) return null;
  return { start: lead.length, end: m[0].length, shape: `${open ? "(" : ""}${close}`, values };
}

/**
 * Runs of typed enumerators in a sequence of sibling blocks.
 *   blocks: [{ kind, text }], kind "p" (a plain paragraph), "list" | "soft" (a list, table, figure or quote,
 *           which may sit between two items); any other kind ends every run (headings, numbered paragraphs).
 *   usable(i, enumerator): false when block i's marker cannot be wrapped (its run is then left alone).
 * Returns a sparse array: [i] = { start, end, n, indent } for each item (n: marker width in characters, the
 * same along a run; indent: em before the marker, for a list inside a list). Only genuine runs: at least two
 * items, of one style, counting up, with a consecutive pair among them. Only the items are returned: what
 * sits between two items (an answer, a sub-list) is left exactly as it is.
 */
export function enumRuns(blocks, { usable = () => true } = {}) {
  const out = [];
  const roots = [], stack = [];
  let between = 0;
  const top = () => stack[stack.length - 1];
  const follows = (run, e, exact) => {
    if (run.shape !== e.shape) return null;
    const next = e.values.filter((v) => run.cands.some((c) => c.k === v.k && (exact ? v.v === c.v + 1 : v.v > c.v && v.v - c.v <= MAX_JUMP)));
    return next.length ? next : null;
  };
  const add = (run, i, e, cands, step) => {
    run.parts.push({ i, e }); run.count++; run.cands = cands; run.step ||= step;
    run.n = Math.max(run.n, e.end - e.start);
    run.ok &&= usable(i, e);
  };
  const start = (i, e, parent) => {
    const first = e.values.filter((v) => v.v === 1);
    const run = { shape: e.shape, cands: first.length ? first : e.values, parts: [{ i, e }], count: 1, n: e.end - e.start, step: false, ok: usable(i, e) };
    if (parent) parent.parts.push({ run }); else roots.push(run);
    stack.push(run);
  };
  blocks.forEach((b, i) => {
    if (b.kind !== "p" && b.kind !== "list" && b.kind !== "soft") { stack.length = 0; return; }
    const e = b.kind === "p" ? findEnumerator(b.text) : null;
    if (!e) { if (++between > MAX_BETWEEN) stack.length = 0; return; }
    between = 0;
    for (const exact of [true, false]) {
      for (let d = stack.length - 1; d >= 0; d--) {
        const next = follows(stack[d], e, exact);
        if (next) { stack.length = d + 1; return add(stack[d], i, e, next, exact); }
      }
      if (!exact || !e.values.some((v) => v.v === 1)) continue;
      // A first item that is not the next of any open list. In the style of an open list it starts that
      // list again ("1. 2. 3." … "1. 2."); in another style it opens a list inside the last item ("(a)" under "(1)").
      const firsts = e.values.filter((v) => v.v === 1);
      let d = stack.length - 1;
      while (d >= 0 && !(stack[d].shape === e.shape && stack[d].cands.some((c) => firsts.some((v) => v.k === c.k)))) d--;
      if (d >= 0) stack.length = d;
      if (stack.length) return start(i, e, top());
    }
    stack.length = 0;
    start(i, e, null);
  });

  const place = (run, indent) => {
    const ok = run.ok && run.count >= 2 && run.step;
    for (const p of run.parts) {
      if (p.run) place(p.run, ok ? indent + markerWidth(run.n) : indent);
      else if (ok) out[p.i] = { start: p.e.start, end: p.e.end, n: run.n, indent };
    }
  };
  for (const run of roots) place(run, 0);
  return out;
}

/* ------------------------------------------------------------------ 3. quoted runs */

const CLOSER = { "‘": "’", "“": "”" };
const INVISIBLE_END = /[\s\u200b\u200c\u200d\u200e\u200f\u2060\ufeff]+$/;
const FOOTNOTE_END = /\s*\[footnote\s+\d+\]$/i;
const PINPOINT_END = /\s*[([](?:[^()[\]]|\([^()]*\)){1,100}[)\]]$/;     // "(paragraphs 170 and 171)", "[headnote 22B]"
// "‘Honour’ crimes are …": a word or two in quotation marks, not a quotation ("‘Patients’ hospital stays …" is one).
const QUOTED_TERM = { "‘": /^‘(?:[^\s’]+\s+)?[^\s’]*[^\s’s]’\s+[a-z]/, "“": /^“(?:[^\s”]+\s+)?[^\s”]+”\s+[a-z]/ };
/** The text without what may follow a closing mark: white space, footnote markers and (stops) a final stop or comma. */
function ending(text, stops = true) {
  let t = String(text ?? ""), footnote = false, was;
  do {
    was = t;
    t = t.replace(INVISIBLE_END, "");
    const cut = t.replace(FOOTNOTE_END, "");
    if (cut !== t) { footnote = true; t = cut; }
    if (stops) t = t.replace(/[.,;]$/, "");
  } while (t !== was);
  return { t, footnote };
}

/** The quotation mark a block opens with (‘ or “), or null. A quoted term at the start ("‘Honour’ crimes …") is not one. */
export function opensQuote(text) {
  const t = String(text ?? "").replace(/^[\s\u200b\ufeff]+/, "");
  return QUOTED_TERM[t[0]] && !QUOTED_TERM[t[0]].test(t) ? t[0] : null;
}
/**
 * Does the text end by closing a quotation opened with `mark`? After the closing mark may come footnote
 * markers, a bracketed pinpoint ("(paragraphs 170 and 171)") and a full stop. Where the closing mark was
 * left off, the source's footnote marker at the very end still ends the quotation.
 */
export function closesQuote(text, mark) {
  const { t, footnote } = ending(text);
  if (t.endsWith(CLOSER[mark])) return true;
  const pin = PINPOINT_END.exec(t);
  return pin ? ending(t.slice(0, pin.index)).t.endsWith(CLOSER[mark]) : footnote;
}
/** A lead-in: a paragraph that ends in a colon ("On 19 July 2024 the Washington Blade reported:"). */
export const isLeadIn = (text) => ending(text, false).t.endsWith(":");

/**
 * Quoted runs in a sequence of sibling blocks: [[from, to], …] (block indexes, inclusive).
 *   blocks: [{ kind, text }], kind "p" | "num" (a numbered paragraph: may lead in, never quoted) | "list" | other.
 * A run starts at the paragraph after a lead-in if it opens with ‘ or “, and runs on while each paragraph
 * opens with a quotation mark (a multi-paragraph quotation repeats it) or, inside an open quotation, is a
 * list or a typed list item. It ends at the last block that closes a quotation; with no close, there is no run.
 */
export function quoteRuns(blocks) {
  const runs = [];
  for (let i = 0; i + 1 < blocks.length; i++) {
    const lead = blocks[i];
    if ((lead.kind !== "p" && lead.kind !== "num") || !isLeadIn(lead.text)) continue;
    let open = null, last = -1;
    for (let j = i + 1; j < blocks.length; j++) {
      const b = blocks[j];
      if (b.kind === "p") {
        const mark = opensQuote(b.text);
        if (mark) open ||= mark;                    // an inner quotation carried over a paragraph break keeps the outer mark
        else if (!open || !findEnumerator(b.text)) break;
      } else if (b.kind !== "list" || !open) break;
      if (closesQuote(b.text, open)) { last = j; open = null; }
    }
    if (last > i) { runs.push([i + 1, last]); i = last - 1; }
  }
  return runs;
}

/* ------------------------------------------------------------------ applying it to a DOM tree */

const HEADING = /^H[1-6]$/;
const WRAPPERS = ["cv", "rl", "sbs", "sbs-row", "sbs-cell", "pv-cols", "pv-pane"];   // display boxes around the note's blocks
const UI = ["linkstatus", "lc", "badge", "pn", "pnum"];                             // tags and hung numbers: not the block's own opening words
const has = (el, names) => names.some((c) => el.classList.contains(c));

/** A block's text for detection: its text nodes in order, without display tags and without `skipTag` (redlines). */
function blockText(el, skipTag) {
  let out = "";
  for (const c of el.childNodes) {
    if (c.nodeType === 3) out += c.data;
    else if (c.nodeType === 1 && c.tagName !== skipTag && !has(c, ["linkstatus", "lc", "badge"])) out += blockText(c, skipTag);
  }
  return out;
}
/** The text node a block opens with (its first with anything but white space), unless it sits in a link or a marked change. */
function openingText(el, skipTag) {
  for (const c of el.childNodes) {
    if (c.nodeType === 3) { if (c.data.trim()) return c; continue; }
    if (c.nodeType !== 1 || c.tagName === skipTag || has(c, UI)) continue;
    if (/^(A|INS|DEL|SUP|MARK)$/.test(c.tagName)) { if (blockText(c, skipTag).trim()) return null; continue; }
    const t = openingText(c, skipTag);
    if (t !== undefined) return t;
  }
  return undefined;
}
function kindOf(el, text) {
  const tag = el.tagName;
  if (tag === "P") return paraNumber(text) ? "num" : "p";
  if (tag === "UL" || tag === "OL") return "list";
  if (tag === "TABLE" || tag === "FIGURE" || tag === "BLOCKQUOTE" || el.classList.contains("tbl-scroll")) return "soft";
  return HEADING.test(tag) ? "head" : "other";
}
/** The note's blocks under root in reading order, looking through display wrappers; side: "old" | "new" | null. */
function topBlocks(root, side, out = []) {
  for (const el of root.children) {
    if (el.tagName === "DIV" && has(el, WRAPPERS)) {
      if (side && el.classList.contains("sbs-cell") && !el.classList.contains(side)) continue;
      topBlocks(el, side, out);
    } else if (!el.classList.contains("sbs-head") && !el.classList.contains("pv-switch")) out.push(el);
  }
  return out;
}
function eachElement(root, fn) { for (const el of root.children) { fn(el); eachElement(el, fn); } }

/** Wrap text.slice(start, end) of a text node in <span class>: the same characters, one more element. */
function wrapText(node, start, end, className) {
  if (end < node.data.length) node.splitText(end);
  const t = start > 0 ? node.splitText(start) : node;
  const span = node.ownerDocument.createElement("span");
  span.className = className;
  t.parentNode.insertBefore(span, t);
  span.appendChild(t);
  return span;
}
function wrapOddSpaces(el) {
  let n = 0;
  for (const c of [...el.childNodes]) {
    if (c.nodeType === 1) { if (!has(c, ["linkstatus", "lc", "badge"]) && !/^sp-/.test(c.className || "")) n += wrapOddSpaces(c); continue; }
    if (c.nodeType !== 3) continue;
    for (let t = c, at; t && (at = t.data.search(ODD_SPACE)) >= 0; n++) {
      const span = wrapText(t, at, at + 1, ODD_SPACES[t.data[at]]);
      t = span.nextSibling && span.nextSibling.nodeType === 3 ? span.nextSibling : null;
    }
  }
  return n;
}

function formatSequence(els, skipTag, quotes, counts) {
  // A block deleted in an inline redline is not part of the newer text: it is looked through.
  const live = [], blocks = [];
  for (const el of els) {
    if (skipTag === "DEL" && el.classList.contains("is-removed")) continue;
    const text = blockText(el, skipTag);
    live.push(el); blocks.push({ kind: kindOf(el, text), text });
  }
  const marks = new Map();
  const enums = enumRuns(blocks, { usable: (i, e) => {
    const t = live[i].classList.contains("en") ? null : openingText(live[i], skipTag);      // already hung: leave it
    if (!t) return false;
    const lead = t.data.length - t.data.trimStart().length;
    const want = blocks[i].text.slice(e.start, e.end);
    if (t.data.slice(lead, lead + want.length) !== want) return false;
    marks.set(i, [t, lead, lead + want.length]);
    return true;
  } });
  enums.forEach((x, i) => {
    const el = live[i];
    el.classList.add("en");
    el.style.setProperty("--en-n", String(x.n));
    if (x.indent) el.style.setProperty("--en-in", `${x.indent}em`);
    wrapText(...marks.get(i), "enum");
    counts.enums++;
  });
  if (!quotes) return;
  for (const [from, to] of quoteRuns(blocks)) {
    counts.quotes++;
    const a = els.indexOf(live[from]), z = els.indexOf(live[to]);
    for (let k = a; k <= z; k++) {
      els[k].classList.add("qr");
      if (k === a) els[k].classList.add("qr-a");
      if (k === z) els[k].classList.add("qr-z");
    }
  }
}

/**
 * Apply the reading aids to a note's text under root (an edition, or a redline of two).
 *   sides: [null] for one text; ["old", "new"] for a side-by-side redline (each column is read on its own).
 *   skip: { old: "INS", new: "DEL" } style map of the tag whose words are not that side's (inline redline: DEL).
 * Returns counts { spaces, enums, quotes }.
 */
export function formatDisplay(root, { sides = [null], skip = {} } = {}) {
  const counts = { spaces: wrapOddSpaces(root), enums: 0, quotes: 0 };
  for (const side of sides) {
    const skipTag = skip[side ?? "new"] || null;
    formatSequence(topBlocks(root, side), skipTag, true, counts);
    // Typed lists also occur inside the Home Office's own block quotes.
    eachElement(root, (el) => { if (el.tagName === "BLOCKQUOTE" && (!side || insideSide(el, side))) formatSequence([...el.children], skipTag, false, counts); });
  }
  return counts;
}
function insideSide(el, side) {
  for (let p = el.parentNode; p && p.classList; p = p.parentNode) if (p.classList.contains("sbs-cell")) return p.classList.contains(side);
  return true;
}
