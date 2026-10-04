// Reading aids are display only: these tests prove that the detection picks genuine runs, and that a text
// with the aids applied is, character for character, the stored text (so a highlight, a quote and its
// citation taken across them are the Home Office's words).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  closesQuote, enumRuns, findEnumerator, formatDisplay, isLeadIn, markerWidth, ODD_SPACES, opensQuote, quoteRuns,
} from "../../prototypes/shared/display-format.js";
import { cleanQuote, quoteWithCitation } from "../../prototypes/shared/citation.js";
import { locateQuote, makeSelector, normalizeWithMap, snapToWords } from "../../prototypes/shared/highlights.js";
import { getAttr, parseHTML } from "../../prototypes/shared/redline-diff.js";

const ROOT = new URL("../../", import.meta.url);
const UGANDA = "data/countries/uganda/notes/country-policy-and-information-note-sexual-orientation-and-gender-uganda-february-2022-accessible-version/ab2c63f38b37d436.html";
const ugandaHtml = readFileSync(new URL(UGANDA, ROOT), "utf8");

/* ---- a small DOM: just what formatDisplay uses (the browser's is used on the page) ---- */
class Node {
  get nextSibling() { const k = this.parentNode.childNodes; return k[k.indexOf(this) + 1] || null; }
}
class Text extends Node {
  constructor(doc, data) { super(); this.nodeType = 3; this.ownerDocument = doc; this.data = data; this.parentNode = null; }
  splitText(at) {
    const rest = new Text(this.ownerDocument, this.data.slice(at));
    this.data = this.data.slice(0, at);
    const k = this.parentNode.childNodes;
    k.splice(k.indexOf(this) + 1, 0, rest);
    rest.parentNode = this.parentNode;
    return rest;
  }
}
class Element extends Node {
  constructor(doc, tag, cls = "") {
    super();
    this.nodeType = 1; this.ownerDocument = doc; this.tagName = tag.toUpperCase(); this.childNodes = []; this.parentNode = null;
    this.classes = new Set(cls.split(/\s+/).filter(Boolean)); this.props = {};
    this.classList = { contains: (c) => this.classes.has(c), add: (...c) => c.forEach((x) => this.classes.add(x)) };
    this.style = { setProperty: (k, v) => { this.props[k] = v; } };
  }
  get className() { return [...this.classes].join(" "); }
  set className(v) { this.classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c)); }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  detach(node) { if (node.parentNode) { const k = node.parentNode.childNodes; k.splice(k.indexOf(node), 1); } node.parentNode = this; }
  insertBefore(node, ref) { this.detach(node); this.childNodes.splice(this.childNodes.indexOf(ref), 0, node); return node; }
  appendChild(node) { this.detach(node); this.childNodes.push(node); return node; }
}
const doc = { createElement: (tag) => new Element(doc, tag) };
function build(light) {
  if (light.t === 3) return new Text(doc, light.v);
  const el = new Element(doc, light.tag === "#root" ? "div" : light.tag, getAttr(light, "class") || "");
  for (const k of light.kids) el.appendChild(build(k));
  return el;
}
/** A stored body (or a piece of one) as a tree, the way the reader mounts it: the .govspeak element. */
function mount(html) {
  const root = build(parseHTML(html));
  const find = (el) => (el.classes?.has("govspeak") ? el : el.children?.map(find).find(Boolean));
  return find(root) || root;
}
/** The text a reader's selection is measured in: every text node in order (reader.js: TextIndex). */
const textNodes = (el, out = []) => { for (const c of el.childNodes) c.nodeType === 3 ? out.push(c) : textNodes(c, out); return out; };
const textOf = (el) => textNodes(el).map((t) => t.data).join("");
const all = (el, test, out = []) => { for (const c of el.children) { if (test(c)) out.push(c); all(c, test, out); } return out; };
const p = (text, kind = "p") => ({ kind, text });

/* ---------------------------------------------------------------- typed enumerators */

test("enumerators: what counts as one", () => {
  assert.deepEqual(findEnumerator("‘(1) Although there is legislation"), { start: 0, end: 4, shape: "()", values: [{ k: "n", v: 1 }] });
  assert.deepEqual(findEnumerator("  (b) text").values, [{ k: "a", v: 2 }]);
  assert.deepEqual(findEnumerator("(i) text").values, [{ k: "r", v: 1 }, { k: "a", v: 9 }]);    // a letter or a Roman numeral
  assert.deepEqual(findEnumerator("xiv. text").values, [{ k: "r", v: 14 }]);
  assert.equal(findEnumerator("2) text").shape, ")");
  assert.equal(findEnumerator("“(a) text").end, 4);
  // Not enumerators: a year, a paragraph number, a decimal, an unclosed bracket, prose.
  for (const t of ["(2019) the court held", "3.1.10 In the country guidance case", "5.1 million people", "(a. text", "The (1) first", "e.g. this", "(1)no space", "(ab) text", "100. text"]) {
    assert.equal(findEnumerator(t), null, t);
  }
});

test("enumerators: only genuine runs are hung", () => {
  const items = (texts, opts) => enumRuns(texts.map((t) => (typeof t === "string" ? p(t) : t)), opts).map((x, i) => [i, x.n, x.indent]).filter(Boolean);
  // The tribunal's holdings in Uganda 3.1.10: ‘(1) … ‘(5), then a closing paragraph.
  assert.deepEqual(items([p("3.1.10 … held that:", "num"), "‘(1) Although", "‘(2) Although", "‘(3) Although", "‘(4) Although", "‘(5) A number", "‘In general, therefore", p("3.1.11 However", "num")]),
    [[1, 4, 0], [2, 4, 0], [3, 4, 0], [4, 4, 0], [5, 4, 0]]);
  // A lone marker, a repeat, a list that does not count up, question/answer letters and years are left alone.
  for (const texts of [["(1) only one", "plain"], ["(a) one", "(a) again", "(c) third"], ["(3) three", "(2) two"], ["Q) Are you aware", "A) No", "Q) And then", "A) Yes"], ["(2019) one", "(2020) two"], ["i. first", "iv. fourth"]]) {
    assert.deepEqual(items(texts), [], texts.join(" | "));
  }
  // An excerpt may start late and skip a little, as long as it counts up somewhere.
  assert.deepEqual(items(["‘(15) a", "(16) b", "(18) c"]), [[0, 5, 0], [1, 5, 0], [2, 5, 0]]);
  // Letters run through "i" without it being taken for a Roman one.
  assert.equal(items(["g) a", "h) b", "i) c", "j) d"]).length, 4);
});

test("enumerators: lists inside lists, what sits between items, and restarts", () => {
  const items = (blocks, opts) => enumRuns(blocks.map((t) => (typeof t === "string" ? p(t) : t)), opts).map((x, i) => [i, x.indent]).filter(Boolean);
  // A list inside a list sits beside the outer item's text.
  assert.deepEqual(items(["1. one", "2. two", "a) first", "b) second", "3. three"]), [[0, 0], [1, 0], [2, markerWidth(2)], [3, markerWidth(2)], [4, 0]]);
  // What sits between two items (an answer, a sub-list, a table) does not end the list, and is itself left alone.
  assert.deepEqual(items(["(a) one", p("", "list"), "(b) two", "more of two", "and more", "(c) three", "the note goes on"]), [[0, 0], [2, 0], [5, 0]]);
  assert.deepEqual(items(["1. A question?", "An answer.", "More of the answer.", "A third paragraph.", "2. Another question?", "Its answer."]), [[0, 0], [4, 0]]);
  // A lone "(a)" under an item is not a list of its own, and does not break the list around it.
  assert.deepEqual(items(["1. one", "(a) a lone sub-item", "2. two"]), [[0, 0], [2, 0]]);
  // A second list in the same style starts again at the same depth.
  assert.deepEqual(items(["1. a", "2. b", "then", "1. c", "2. d"]), [[0, 0], [1, 0], [3, 0], [4, 0]]);
  // A heading or a numbered paragraph ends a list; so does a long stretch without an item.
  assert.deepEqual(items(["(a) one", p("2.1.1 Text", "num"), "(b) two"]), []);
  assert.deepEqual(items(["(a) one", ...Array.from({ length: 13 }, () => "plain"), "(b) two"]), []);
  // A run whose marker cannot be wrapped (it sits in a link, or is a marked change) is left alone as a whole.
  assert.deepEqual(items(["(a) one", "(b) two"], { usable: (i) => i === 0 }), []);
});

/* ---------------------------------------------------------------- quoted runs */

test("quotations: opening, closing and lead-ins", () => {
  assert.equal(opensQuote("‘On 3rd August 2022"), "‘");
  assert.equal(opensQuote("“In some areas"), "“");
  assert.equal(opensQuote("‘Patients’ hospital stays vary"), "‘", "a possessive is not the end of a quoted term");
  assert.equal(opensQuote("‘Honour’ crimes are widespread"), null);
  assert.equal(opensQuote("“Westernised” lifestyles"), null);
  assert.equal(opensQuote("On 3rd August"), null);
  assert.equal(closesQuote("through a directive by the police …’[footnote 207]", "‘"), true);
  assert.equal(closesQuote("persecution of homosexuality in Uganda.’ (paragraphs 170 and 171)", "‘"), true);
  assert.equal(closesQuote("risk.’ (paragraph 98 (3) to (5)).", "‘"), true);
  assert.equal(closesQuote("children to the police.”’[footnote 78] [footnote 79]", "‘"), true);
  assert.equal(closesQuote("the name to be “undesirable and un-registrable.”\u202f", "‘"), false, "an inner quotation closing is not the end");
  assert.equal(closesQuote("appropriate healthcare.[footnote 103]", "‘"), true, "the source's footnote ends a quotation whose closing mark was left off");
  assert.equal(closesQuote("in Latin America.", "‘"), false);
  assert.equal(isLeadIn("18.1.2 On 31 October 2022, CIVICUS reported:"), true);
  assert.equal(isLeadIn("The report stated:[footnote 4] "), true);
  assert.equal(isLeadIn("The report stated that many did."), false);
});

test("quotations: a run starts after a lead-in and ends where the quotation closes", () => {
  const b = (kind, text) => ({ kind, text });
  // 18.1.2: two paragraphs, the first not closed.
  assert.deepEqual(quoteRuns([b("num", "18.1.2 CIVICUS reported:"), b("p", "‘On 3rd August … “un-registrable.”"), b("p", "‘Before the suspension … police …’[footnote 207]"), b("num", "18.1.3 Others observed:")]), [[1, 2]]);
  // An inner quotation carried over a paragraph break (Uganda 11.1.4).
  assert.deepEqual(quoteRuns([b("num", "11.1.4 The BBC reported:"), b("p", "‘In the weeks before … the activist said."), b("p", "“In some areas … to the police.”’[footnote 78]")]), [[1, 2]]);
  // Two quotations one after the other; a list inside an open quotation; typed list items inside one.
  assert.deepEqual(quoteRuns([b("num", "1.1.1 It said:"), b("p", "‘One.’[footnote 1]"), b("p", "‘Two.’[footnote 2]"), b("p", "Our own words.")]), [[1, 2]]);
  assert.deepEqual(quoteRuns([b("num", "1.1.1 It said:"), b("p", "‘The law covers:"), b("list", "‘theft ‘fraud’[footnote 3]"), b("num", "1.1.2 Next")]), [[1, 2]]);
  assert.deepEqual(quoteRuns([b("num", "1.1.1 It held:"), b("p", "‘(1) First."), b("p", "(2) Second.’ (paragraph 4)")]), [[1, 2]]);
  // Left plain: no lead-in; never closed; closed only after the note's own words resume; a list with no open quotation.
  assert.deepEqual(quoteRuns([b("num", "1.1.1 It said that"), b("p", "‘One.’[footnote 1]")]), []);
  assert.deepEqual(quoteRuns([b("num", "1.1.1 It said:"), b("p", "‘One."), b("p", "‘Two."), b("num", "1.1.2 Next")]), []);
  assert.deepEqual(quoteRuns([b("num", "1.1.1 It said:"), b("p", "‘One."), b("p", "Our own words, ending with a quoted ‘word’")]), []);
  assert.deepEqual(quoteRuns([b("num", "1.1.1 Consider:"), b("list", "‘a’ ‘b’")]), []);
  // A quotation that closes, then one that does not: the run stops at the close.
  assert.deepEqual(quoteRuns([b("p", "It said:"), b("p", "‘One.’"), b("p", "‘Two, never closed."), b("head", "2. Next")]), [[1, 1]]);
});

/* ---------------------------------------------------------------- display only: the same characters */

test("the Uganda report with the aids applied is the stored text, character for character", () => {
  const gs = mount(ugandaHtml), stored = textOf(mount(ugandaHtml));
  const counts = formatDisplay(gs);
  assert.equal(textOf(gs), stored);
  assert.deepEqual(counts, { spaces: (stored.match(/[\u202f\u2009\u200a\u2002]/g) || []).length, enums: 5, quotes: 72 });
  // Each span holds exactly the characters it stands for.
  const spans = all(gs, (el) => el.tagName === "SPAN" && /^(sp-|enum$)/.test(el.className));
  for (const s of spans) {
    const t = textOf(s);
    if (s.className === "enum") assert.match(t, /^[‘“]?\(?[0-9a-z]+[.)]$/i);
    else assert.equal(ODD_SPACES[t], s.className);
  }
  assert.equal(spans.filter((s) => s.className === "sp-nn").length, (stored.match(/\u202f/g) || []).length, "every narrow no-break space is kept and wrapped once");
  // 3.1.10: the five holdings hang; the lead-in does not; the run of quoted paragraphs is ruled from the first to the close.
  const paras = all(gs, (el) => el.tagName === "P");
  const at = paras.findIndex((el) => textOf(el).startsWith("3.1.10"));
  assert.deepEqual(paras.slice(at, at + 8).map((el) => [...el.classes].sort().join(" ")),
    ["", "en qr qr-a", "en qr", "en qr", "en qr", "en qr", "qr qr-z", ""]);
  assert.deepEqual(all(paras[at + 1], (el) => el.className === "enum").map(textOf), ["‘(1)"]);
  assert.equal(paras[at + 1].props["--en-n"], "4");
  // The executive summary's short paragraphs are the Home Office's own: nothing is added to them.
  const first = paras.slice(0, 10);
  assert.ok(first.every((el) => el.classes.size === 0 && el.children.length === 0));
  assert.equal(textOf(first[4]), "LGBT+ people form a particular social group.");
});

test("a highlight, a quote and its citation taken across the aids are the stored words", () => {
  const stored = textOf(mount(ugandaHtml));
  const gs = mount(ugandaHtml);
  formatDisplay(gs);
  const nodes = textNodes(gs);
  const starts = []; nodes.reduce((off, t, i) => { starts[i] = off; return off + t.data.length; }, 0);
  /** What a selection from offset s to e holds: the characters of the text nodes it covers (as the reader reads them). */
  const selected = (s, e) => nodes.map((t, i) => t.data.slice(Math.max(0, s - starts[i]), Math.max(0, e - starts[i]))).join("");
  const ctx = (quote) => ({ title: "Country policy and information note: sexual orientation and gender, Uganda, March 2025 (accessible version)",
    kind: "CPIN", topic: "sexual orientation and gender", countryName: "Uganda", version: "6.0", month: "2025-03", para: "18.1.2",
    url: "https://www.gov.uk/government/publications/uganda-country-policy-and-information-notes", quote, accessed: new Date(2026, 9, 3) });
  const cases = {
    // Narrow no-break spaces (18.1.2); from inside a quoted run to the note's own words after it; across hung enumerators (3.1.10).
    spaces: ["SMUG discovered in June 2022", "through a directive by the police"],
    quote: ["Police officers have since launched", "18.1.3 Svenson and others 2024 observed"],
    enums: ["held that:", "(3) Although a number of articles"],
  };
  for (const [name, [from, to]] of Object.entries(cases)) {
    const a = stored.indexOf(from), z = stored.indexOf(to, a) + to.length;
    assert.ok(a >= 0 && z > a, name);
    const [s, e] = snapToWords(stored, a, z);
    assert.equal(selected(s, e), stored.slice(s, e), `${name}: the selection is the stored text`);
    const sel = makeSelector(textOf(gs), s, e);
    assert.equal(sel.quote, stored.slice(s, e), `${name}: the saved quote`);
    assert.deepEqual(locateQuote(textOf(gs), sel, { normalized: normalizeWithMap(textOf(gs)) }), { start: s, end: e, how: "position" }, `${name}: it is found again`);
    assert.deepEqual(quoteWithCitation(ctx(sel.quote), "oscola"), quoteWithCitation(ctx(stored.slice(s, e)), "oscola"), `${name}: quote and citation`);
  }
  // The copied quote has the Home Office's words with ordinary spaces: its narrow no-break spaces jam words together in Word.
  const a = stored.indexOf("SMUG discovered in June 2022"), z = stored.indexOf("[footnote 207]", a) + 14;
  const copied = quoteWithCitation(ctx(makeSelector(textOf(gs), a, z).quote), "oscola").text;
  assert.ok(copied.startsWith("“SMUG discovered in June 2022 that the NGO bureau had been surveilling their office through a directive by the police …’” Home Office"), copied.slice(0, 140));
  assert.equal(cleanQuote("a\u00a0b\u202fc\u2009d  e\n\tf"), "a b c d e f", "shown, copied or exported: every kind of space reads as an ordinary one");
});

test("a redline is read as the newer text: deleted words and deleted blocks do not break a run", () => {
  const html = `<div class="rl rl--inline"><div class="cv">
    <p class="np"><span class="pn">2.1.1</span> The court held<del>, in 2019</del>:</p>
    <p>‘(1) First holding.</p>
    <p class="chg is-removed"><del>‘(2) A holding since removed.</del></p>
    <p class="chg is-mod">‘(2) Second <del>holdng</del><ins>holding</ins>.’<sup><a href="#fn:1">[footnote 1]</a></sup></p></div>
    <div class="cv"><p class="np"><span class="pn">2.1.2</span> Next.</p></div></div>`;
  const root = mount(html), before = textOf(root);
  formatDisplay(root, { skip: { new: "DEL" } });
  assert.equal(textOf(root), before);
  const ps = all(root, (el) => el.tagName === "P");
  assert.deepEqual(ps.map((el) => [...el.classes].filter((c) => /^(qr|en)/.test(c)).sort().join(" ")), ["", "en qr qr-a", "qr", "en qr qr-z", ""]);
  // Side by side, each column is read on its own.
  const sbs = mount(`<div class="rl rl--sbs"><div class="sbs">
    <div class="sbs-row"><div class="sbs-cell old"><p>It said:</p></div><div class="sbs-cell new"><p>It said that things changed.</p></div></div>
    <div class="sbs-row"><div class="sbs-cell old"><p>‘Old words.’</p></div><div class="sbs-cell new"><p>‘New words.’</p></div></div></div></div>`);
  formatDisplay(sbs, { sides: ["old", "new"] });
  assert.deepEqual(all(sbs, (el) => el.tagName === "P").map((el) => el.classes.has("qr")), [false, false, true, false]);
});
