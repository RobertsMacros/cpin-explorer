// What a report's page says about its PDF (prototypes/reader/pdf-differences.js): the chip and its panel.
import assert from "node:assert/strict";
import { test } from "node:test";
import { differsChip, differsPanel, placeOf, renumbered, sideOf } from "../../prototypes/reader/pdf-differences.js";
import { escHtml as esc } from "../../prototypes/shared/citation.js";

const where = { heading: "state-protection", paragraph: "4.3.4", section: "Assessment", page: 11 };
const cmp = {
  pdf_url: "https://assets.publishing.service.gov.uk/media/abc/IRQ_CPIN.pdf", flagged: true,
  wording: { differences: 2, web_words: 20, pdf_words: 263, share: 0.0051, passages: 1 },
  drafts: ["footnote count differs: web 111, PDF 124"],
  numbering: { same: 300, different: { "4.3.2": "4.3.1", "4.3.3": "4.3.2" }, pdf_unnumbered: ["9.9.9"], web_unnumbered: 0 },
  differences: [
    { kind: "text", web: "", pdf: "4.3.4 Sources suggest that the rise of <honour> crimes in the KRI is attributable to the failure of the authorities.", web_words: 0, pdf_words: 244, where, size: "passage" },
    { kind: "text", web: "absence of cogent evidence", pdf: "absence of very strong cogent evidence", web_words: 4, pdf_words: 6, where: { section: "Assessment", paragraph: null, page: 7 }, size: "passage" }],
  not_listed: 0,
};

test("the chip appears only where the PDF really differs, and says how", () => {
  assert.equal(differsChip(null), null);
  assert.equal(differsChip({ wording: { differences: 0 }, numbering: { different: {}, pdf_unnumbered: [] }, drafts: [] }), null, "the same text: nothing to say");
  const chip = differsChip(cmp);
  assert.deepEqual([chip.label, chip.count, chip.flagged], ["PDF differs", 2, true]);
  assert.equal(chip.title, "The PDF of this edition differs from the web version in 2 places: 20 words only here, 263 words only in the PDF");
  const numbers = differsChip({ wording: { differences: 0 }, numbering: { different: { "1.1.2": "1.1.1" }, pdf_unnumbered: [] }, drafts: [] });
  assert.deepEqual([numbers.label, numbers.count, numbers.flagged], ["PDF numbered differently", 1, false]);
  assert.equal(renumbered(cmp), 3);
});

test("each difference says where it is and which side has the words", () => {
  assert.equal(placeOf(cmp.differences[0]), "Assessment · para 4.3.4 · PDF page 11");
  assert.equal(sideOf(cmp.differences[0]), "244 words only in the PDF");
  assert.equal(sideOf(cmp.differences[1]), "worded differently");
  assert.equal(sideOf({ web_words: 1, pdf_words: 0 }), "1 word only here");
});

test("the panel lists the differences, links the PDF at their page, and escapes the note's words", () => {
  const html = differsPanel(cmp, { esc });
  assert.match(html, /The PDF differs in <b>2 places<\/b>: 20 words only here, 263 words only in the PDF\./);
  assert.match(html, /Signs of different drafts<\/span><span>footnote count differs: web 111, PDF 124</);
  assert.match(html, /3 paragraphs are numbered differently in the PDF/);
  assert.equal((html.match(/data-pdf-diff="/g) || []).length, 2);
  assert.ok(html.includes("rise of &lt;honour&gt; crimes") && !html.includes("<honour>"));
  assert.ok(html.includes('href="https://assets.publishing.service.gov.uk/media/abc/IRQ_CPIN.pdf#page=11"'));
  const many = { ...cmp, wording: { ...cmp.wording, differences: 30 }, differences: Array.from({ length: 30 }, () => cmp.differences[1]) };
  assert.match(differsPanel(many, { esc }), /And 22 smaller differences\./);
});

test("the panel says when the web version uses a paragraph number twice", () => {
  const esc = (x) => String(x);
  const cmp = { pdf_url: "https://assets.example/x.pdf", wording: { differences: 0, web_words: 0, pdf_words: 0 }, differences: [],
    numbering: { different: { "12.2.9": "14.2.9" }, pdf_unnumbered: [], repeated: ["12.2.3", "12.2.4"] } };
  assert.match(differsPanel(cmp, { esc }), /uses 2 paragraph numbers more than once\. A citation to one of those gives the number as printed here and no PDF number/);
  assert.doesNotMatch(differsPanel({ ...cmp, numbering: { different: { "12.2.9": "14.2.9" } } }, { esc }), /more than once/);
  assert.match(differsPanel({ ...cmp, numbering: { ...cmp.numbering, repeated: ["12.2.3"] } }, { esc }), /uses 1 paragraph number more than once/);
});
