// A quote as a reader sees it (highlights.js: spacedText). The reader's text index joins text nodes with
// nothing between them; these tests prove that what is shown, copied and exported has one space where a
// line, a table cell or a block ended, and is otherwise the stored text, character for character.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { quoteOf, quoteWithCitation } from "../../prototypes/shared/citation.js";
import { citeContext, copyText, exportMarkdown, locateQuote, makeSelector, SITE_TAGS, spacedText } from "../../prototypes/shared/highlights.js";
import { getAttr, parseHTML } from "../../prototypes/shared/redline-diff.js";

const ROOT = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");

/* ---- a small DOM: just what spacedText walks (the browser's is used on the page) ---- */
class Node {
  get nextSibling() { const k = this.parentNode.childNodes; return k[k.indexOf(this) + 1] || null; }
}
class Text extends Node { constructor(data) { super(); this.nodeType = 3; this.data = data; this.parentNode = null; } }
class Element extends Node {
  constructor(tag, cls) {
    super();
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.childNodes = []; this.parentNode = null;
    const classes = new Set(String(cls || "").split(/\s+/).filter(Boolean));
    this.classList = { contains: (c) => classes.has(c) };
  }
  append(node) { node.parentNode = this; this.childNodes.push(node); return node; }
}
function build(light) {
  if (light.t === 3) return new Text(light.v);
  const el = new Element(light.tag === "#root" ? "div" : light.tag, getAttr(light, "class"));
  for (const k of light.kids) el.append(build(k));
  return el;
}
// The tags the reader adds inside the text and leaves out of its index (reader.js: SKIP_UI).
const SKIP_UI = (el) => SITE_TAGS.some((c) => el.classList.contains(c));
/** A body as the reader indexes it: its text nodes in order, the offset each starts at, and their text run together. */
function indexOf(html) {
  const root = build(parseHTML(html)), nodes = [], starts = [];
  let off = 0;
  (function walk(el) {
    for (const k of el.childNodes) {
      if (k.nodeType === 3) { nodes.push(k); starts.push(off); off += k.data.length; } else if (!SKIP_UI(k)) walk(k);
    }
  })(root);
  return { nodes, starts, text: nodes.map((n) => n.data).join("") };
}
/** The index's own text for a passage (what is stored as `quote`) and the text as it reads (what is stored as `spaced`). */
function passage(ix, from, to) {
  const s = ix.text.indexOf(from), e = ix.text.indexOf(to, s) + to.length;
  assert.ok(s >= 0 && e > s, `the passage is in the text: ${from} … ${to}`);
  return { s, e, quote: ix.text.slice(s, e), spaced: spacedText(ix, s, e, { skip: SKIP_UI }) };
}
/** Nothing but single spaces may be added: taking them out again gives the stored text. */
function onlySpacesAdded(p) {
  let i = 0;
  for (const ch of p.spaced) {
    if (ch === p.quote[i]) i++;
    else assert.equal(ch, " ", `only a space may be added, found ${JSON.stringify(ch)}`);
  }
  assert.equal(i, p.quote.length, "every stored character is there, in order");
}

const NIGERIA = "data/countries/nigeria/notes/country-policy-and-information-note-trafficking-of-women-nigeria-april-2022-accessible-version/5f0cefcd95380363.html";
const TALIBAN = "data/countries/afghanistan/notes/country-policy-and-information-note-fear-of-the-taliban-afghanistan-february-2026-accessible/2c5e35429f512dbf.html";
const series = (path) => JSON.parse(read(`prototypes/data/series/${path}.json`)).versions.find((v) => v.source === "pdf").body;

test("a table: lines of a cell and cells in a row are not run together (Nigeria, trafficking of women, para 7.6.5)", () => {
  const ix = indexOf(read(NIGERIA));
  // One cell, three lines: 1890 rescued in 2017, of whom 447 male and 1443 female.
  const cell = passage(ix, "1890", "1443");
  assert.equal(cell.quote, "18904471443", "as indexed: this is how the highlight is found again, and it is unchanged");
  assert.equal(cell.spaced, "1890 447 1443");
  onlySpacesAdded(cell);
  // The row's heading has three lines too.
  const head = passage(ix, "Rescued victims", "Female");
  assert.equal(head.spaced, "Rescued victims – total Male Female");
  // Across cells GOV.UK's markup already has white space between the tags: nothing is added to it.
  const row = passage(ix, "Cases reported to NAPTIP", "1032");
  assert.equal(row.spaced, row.quote);
  assert.equal(quoteOf(row), "Cases reported to NAPTIP 721 876 1076 - 1032");
  // A saved highlight keeps both; what is shown, copied and exported is the text as it reads.
  const rec = { id: "h1", country: "nigeria", countryName: "Nigeria", note: "n", title: "Country policy and information note: trafficking of women, Nigeria, April 2022 (accessible version)",
    kind: "CPIN", topic: "trafficking of women", version: "6.0", month: "2022-04", para: "7.6.5", url: "https://www.gov.uk/x", sources: [],
    ...makeSelector(ix.text, cell.s, cell.e), spaced: cell.spaced, lead: null };
  assert.equal(quoteOf(rec), "1890 447 1443");
  assert.ok(quoteWithCitation(citeContext(rec), "tribunal").text.startsWith("“1890 447 1443” CPIN Nigeria: Trafficking of women"));
  assert.ok(exportMarkdown([rec]).includes("\n> 1890 447 1443\n"));
  assert.deepEqual(locateQuote(ix.text, rec), { start: cell.s, end: cell.e, how: "position" }, "still found by its indexed text");
  // A highlight saved before `spaced` was recorded has only `quote`, and shows that.
  const { spaced, lead, ...old } = rec;
  assert.equal(quoteOf(old), "18904471443");
});

test("a table read from a PDF: cells with no white space between their tags (France and Zimbabwe)", () => {
  // The text read from a PDF is rebuilt by the extractor (src/cpin/pdftext.py), which writes a row's cells with nothing
  // between their tags. Found here whether or not it still does: what matters is how the cells read.
  const found = (ix, re) => { const m = re.exec(ix.text); assert.ok(m, `in the text: ${re}`); return { quote: m[0], spaced: spacedText(ix, m.index, m.index + m[0].length, { skip: SKIP_UI }) }; };
  const acronyms = found(indexOf(series("france/note--country-safe-third")), /ANSM\s*National Agency for the Safety of Medicines and Health Products/);
  assert.equal(quoteOf(acronyms), "ANSM National Agency for the Safety of Medicines and Health Products");
  onlySpacesAdded(acronyms);
  const zimbabwe = indexOf(series("zimbabwe/note--government-opposition"));
  const row = found(zimbabwe, /ZANU-PF\s*35%\s*17%\s*19%/);
  assert.equal(quoteOf(row), "ZANU-PF 35% 17% 19%");
  assert.ok(!/\s\s/.test(row.spaced), "one space between cells, never two");
  onlySpacesAdded(row);
  // From the end of one row into the next: the rows' own white space is kept, and no second space is added.
  const rows = found(zimbabwe, /19%\s*Police/);
  assert.equal(quoteOf(rows), "19% Police");
  onlySpacesAdded(rows);
  // The same table as the extractor writes it today, fixed here so the case stays tested whatever it does later.
  const tight = indexOf("<table>\n<tbody>\n<tr><td>ZANU-PF</td><td>35%</td><td>17%</td><td>19%</td></tr>\n<tr><td>Police</td><td>29%</td><td>44%</td><td>51%</td></tr>\n</tbody>\n</table>");
  const two = passage(tight, "ZANU-PF", "51%");
  assert.equal(two.quote, "ZANU-PF35%17%19%\nPolice29%44%51%");
  assert.equal(two.spaced, "ZANU-PF 35% 17% 19%\nPolice 29% 44% 51%");
  onlySpacesAdded(two);
});

test("a <br> in an address: each line is a word apart (Afghanistan, fear of the Taliban, the IAGCI's address)", () => {
  const address = passage(indexOf(read(TALIBAN)), "Independent Advisory Group on Country InformationIndependent Chief", "EC1N 8TE");
  assert.ok(address.quote.includes("Information" + "Independent Chief Inspector of Borders and Immigration" + "3rd Floor" + "28 Kirby Street" + "London" + "EC1N 8TE"));
  assert.equal(address.spaced, "Independent Advisory Group on Country Information Independent Chief Inspector of Borders and Immigration 3rd Floor 28 Kirby Street London EC1N 8TE");
  onlySpacesAdded(address);
  // A line break that already has white space beside it gets no second space.
  const br = indexOf("<p>‘Former members of the security forces and many former<br>\nofficials</p>");
  assert.equal(passage(br, "many", "officials").spaced, "many former\nofficials");
});

test("two paragraphs, and a list", () => {
  const tight = indexOf(`<div class="govspeak"><p>3.1.1 First paragraph.</p><p>3.1.2 Second paragraph.</p><ul><li>one</li><li>two<ul><li>two (a)</li></ul></li><li>three</li></ul><p>After the list.</p></div>`);
  assert.equal(tight.text, "3.1.1 First paragraph.3.1.2 Second paragraph.onetwotwo (a)threeAfter the list.");
  const paras = passage(tight, "First", "Second paragraph.");
  assert.equal(paras.spaced, "First paragraph. 3.1.2 Second paragraph.");
  onlySpacesAdded(paras);
  const list = passage(tight, "Second", "After the list.");
  assert.equal(list.spaced, "Second paragraph. one two two (a) three After the list.");
  onlySpacesAdded(list);
  // As GOV.UK writes them (white space between the tags): the stored text already reads right, and is left alone.
  const loose = indexOf(`<div class="govspeak"><p>3.1.1 First paragraph.</p>\n\n<p>3.1.2 Second paragraph.</p>\n\n<ul>\n  <li>one</li>\n  <li>two</li>\n</ul></div>`);
  const all = passage(loose, "First", "two");
  assert.equal(all.spaced, all.quote);
  assert.equal(quoteOf(all), "First paragraph. 3.1.2 Second paragraph. one two");
  // A heading and the paragraph under it; a cell and the paragraph inside the next one.
  assert.equal(passage(indexOf("<h3>7.6 Prosecutions</h3><p>7.6.1 The law</p>"), "Prosecutions", "7.6.1").spaced, "Prosecutions 7.6.1");
  assert.equal(passage(indexOf("<table><tr><td>Lagos</td><td><p>12</p><p>15</p></td></tr></table>"), "Lagos", "15").spaced, "Lagos 12 15");
});

test("within a line nothing is added: links, emphasis, footnote marks and the hung paragraph number", () => {
  const ix = indexOf(`<p><span class="pnum">9.1.1</span> Under <em>articles</em> 107 and <a href="#x">110</a> of the Constitution<sup><a href="#fn:12">[footnote 12]</a></sup>, the <mark class="hl">Supreme</mark> Leader</p>`);
  const p = passage(ix, "9.1.1", "Leader");
  assert.equal(p.spaced, p.quote);
  assert.equal(p.spaced, "9.1.1 Under articles 107 and 110 of the Constitution[footnote 12], the Supreme Leader");
  // Part of a text node at either end: only the characters asked for.
  const part = passage(indexOf("<table><tr><td>1017<br>197<br>820</td><td>1890<br>447<br>1443</td></tr></table>"), "97", "18");
  assert.equal(part.quote, "9782018");
  assert.equal(part.spaced, "97 820 18");
});

/* ------------------------------------------------------------------ a plain copy (Cmd+C) */

test("a plain copy carries the words and nothing of this site's (Afghanistan, fear of the Taliban, para 1.1.3)", () => {
  // The paragraph as the reader shows it: the note's own words, and the link-status tag the site adds after a moved link.
  const para = read(TALIBAN).match(/<p>1\.1\.3 [\s\S]*?<\/p>/)[0];
  const tag = `<span class="linkstatus linkstatus--moved">Moved <a class="linkstatus-alt" href="https://assets.publishing.service.gov.uk/x">now at assets.publishing.service.gov.uk ↗</a></span>`;
  assert.ok(para.includes("</a>)."), "the link closes just before the paragraph's last bracket");
  const shown = para.replace("</a>).", `</a>${tag}).`);
  const ix = indexOf(shown), e = ix.text.length;
  const copied = copyText(ix, 0, e, { skip: SKIP_UI, lead: "1.1.3" });
  assert.equal(copied, "Decision makers must also consider making an international biometric data-sharing check, when one has not already been undertaken "
    + "(see Biometric data-sharing process (Migration 5 biometric data-sharing process)).");
  assert.ok(!/moved|now at|↗/i.test(copied), "no tag");
  // It is the quote the Copy button gives for the same selection, without the citation.
  const quote = ix.text.slice(0, e);
  assert.equal(copied, quoteOf({ quote, spaced: spacedText(ix, 0, e, { skip: SKIP_UI }), lead: "1.1.3" }));
  assert.ok(quoteWithCitation({ quote, lead: "1.1.3", para: "1.1.3", title: "T", kind: "CPIN", countryName: "Afghanistan" }, "tribunal").text.startsWith(`“${copied}” `));
  // Part of a paragraph, begun at a figure: every character, and no number taken for a paragraph's.
  const fig = indexOf("<p>16.1.2 In 2025, approximately 2.86 million Afghans returned to Afghanistan</p>");
  assert.equal(copyText(fig, fig.text.indexOf("2.86"), fig.text.length, { skip: SKIP_UI }), "2.86 million Afghans returned to Afghanistan");
  // A tag of ours is never looked inside, even for the line break it holds; a picture from the PDF between two
  // paragraphs is a gap like any other block.
  const chip = indexOf(`<p>see the report<span class="lc">Link changed<br>old → new</span>, page 4</p>`);
  assert.equal(copyText(chip, 0, chip.text.length, { skip: SKIP_UI }), "see the report, page 4");
  const fig2 = indexOf(`<p>7.1.2 The map below.</p><figure class="pdf-fig"><img src="x.png"><figcaption><span class="tag">From the PDF</span> page 12</figcaption></figure><p>7.1.3 The same source.</p>`);
  assert.equal(copyText(fig2, 0, fig2.text.length, { skip: SKIP_UI, lead: "7.1.2" }), "The map below. 7.1.3 The same source.");
});

test("the reader fills the clipboard itself, and none of the site's tags can be selected", () => {
  const css = read("prototypes/reader/reader.css"), js = read("prototypes/reader/reader.js");
  const rule = css.split("}").find((r) => /user-select:\s*none/.test(r) && r.includes(".doc .linkstatus"));
  assert.ok(rule, "a rule that makes the tags unselectable");
  for (const c of SITE_TAGS) assert.ok(new RegExp(`\\.doc \\.${c}(?![\\w-])`).test(rule), `.${c} cannot be selected`);
  assert.match(rule, /-webkit-user-select:\s*none/, "Safari's spelling too");
  // The stylesheet is what the reader sees; the guarantee is the copy handler, which uses the same list as the index.
  assert.match(js, /document\.addEventListener\("copy"/);
  assert.match(js, /const SKIP_UI = \(el\) => H\.SITE_TAGS\.some/);
  assert.match(js, /H\.copyText\(ix, s, e, \{ skip: SKIP_UI \}\)/);
});
