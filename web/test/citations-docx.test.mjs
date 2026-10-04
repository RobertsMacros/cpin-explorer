// "Export to Word" (prototypes/shared/citations-docx.js): builds both .docx files from highlights made
// from real passages (data/countries/…), opens the zip and checks what Word will read.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import * as docx from "../../prototypes/vendor/docx.js";
import {
  bookmarkNamer, buildCitationsDocx, docxFileName, FONT_FILES, FONTS, highlightHeading, htmlRuns,
} from "../../prototypes/shared/citations-docx.js";
import { formatCitation, quoteOf } from "../../prototypes/shared/citation.js";
import { citeContext } from "../../prototypes/shared/highlights.js";
import { docxAssets, readBytes, sampleHighlights, textOf } from "../build-docx.mjs";
import { readFileSync } from "node:fs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ACCESSED = new Date(2026, 9, 2);

/** The entries of a zip (stored or deflated), from its central directory. */
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  assert.ok(eocd >= 0, "a zip file");
  const files = new Map();
  for (let i = 0, p = buf.readUInt32LE(eocd + 16); i < buf.readUInt16LE(eocd + 10); i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extra + comment;
  }
  return files;
}
const xml = (files, name) => files.get(name)?.toString("utf8") ?? "";
const unescapeXml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
/** The document's text as Word shows it: every <w:t>, in order. */
const docText = (x) => unescapeXml([...x.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(""));
const all = (x, re) => [...x.matchAll(re)].map((m) => unescapeXml(m[1]));
/** Text of each paragraph with a given style. */
const styled = (x, style) => [...x.matchAll(/<w:p>(?:(?!<\/w:p>).)*?<\/w:p>/gs)].map((m) => m[0])
  .filter((p) => p.includes(`<w:pStyle w:val="${style}"/>`)).map(docText);

const highlights = await sampleHighlights();
const assets = docxAssets();
const build = async (mode, extra = {}) => unzip(await buildCitationsDocx(docx, highlights, { mode, style: "oscola", accessed: ACCESSED, ...assets, output: "nodebuffer", ...extra }));
const full = await build("full");
const cites = await build("citations");

test("the samples quote real passages, word for word", () => {
  assert.equal(highlights.length, 4);
  assert.deepEqual([...new Set(highlights.map((r) => r.countryName))].sort(), ["Afghanistan", "Iran"]);
  for (const r of highlights) {
    const body = textOf(readBytes(join(ROOT, "data/countries", r.country, "notes", r.note, `${r.editionSha.slice(0, 16)}.html`)).toString("utf8"));
    assert.equal(body.slice(r.pos.start, r.pos.end), r.quote, `${r.note} para ${r.para}`);
  }
  const p911 = highlights.find((r) => r.para === "9.1.1");
  assert.match(p911.quote, /^Under articles 107 and 110 of the Constitution of the Islamic Republic of Iran, the Supreme Leader has ultimate command of the Armed Forces\.\[footnote 12\]$/);
  assert.deepEqual(p911.sources.map((s) => s.n), [12]);
  assert.equal(highlights.find((r) => r.para === "2.4.5").check, "changed");
});

test("full export: quotes, citations with real links, sources, notes and the staleness warning", () => {
  const doc = xml(full, "word/document.xml"), rels = xml(full, "word/_rels/document.xml.rels");
  const text = docText(doc);
  for (const r of highlights) {
    assert.ok(text.includes(`“${quoteOf(r)}”`), `quote ${r.para}`);
    const c = formatCitation(citeContext(r, { accessed: ACCESSED }), "oscola");
    assert.ok(text.includes(c.text), `citation ${r.para}: ${c.text}`);
    const id = new RegExp(`Id="([^"]+)"[^>]*Target="${c.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" TargetMode="External"`).exec(rels)?.[1];
    assert.ok(id && doc.includes(`<w:hyperlink w:history="1" r:id="${id}">`), `the citation URL is a hyperlink: ${c.url}`);
  }
  // OSCOLA's italic title is italic in Word, and the URL is a hyperlink run.
  assert.ok(/<w:i\/>(?:(?!<\/w:r>).)*Country Policy and Information Note: Military Service, Iran<\/w:t>/s.test(doc), "italic OSCOLA title");
  assert.ok(text.includes("Iran Data Portal, The Constitution … (pages 23), 2/3 December 1979, amended 28 July"));
  assert.ok(rels.includes("https://irandataportal.syr.edu/wp-content/uploads/constitution-english-1368.pdf"));
  assert.ok(text.includes("Supreme Leader commands the armed forces"), "private note");
  assert.ok(text.includes("Changed since saved"));
  assert.ok(text.includes("v6.0 → v7.0: these words are not in the edition now on GOV.UK. The citation points to the archived copy of v6.0."));
  assert.ok(text.includes("CPIN Explorer") && text.includes(`Saved citations · 2 October 2026`) && text.includes("OSCOLA citations"));
  assert.ok(doc.includes('name="CPIN Explorer"') && !doc.includes('name="Roberts Macros"'), "the header carries CPIN Explorer's mark, not the RM mark");
  assert.ok(!doc.includes("<a:srcRect "), "the product mark is square: nothing to crop");
  assert.ok([...full.keys()].filter((k) => /^word\/media\/.+\.png$/.test(k)).length >= 2, "both marks are embedded");
  const footer = xml(full, "word/footer1.xml");
  assert.ok(footer.includes('name="Roberts Macros"'), "the RM mark sits in the footer, beside the source credit");
  assert.ok(!/no macro/i.test(docText(footer) + docText(doc)), "no slogan");
  assert.ok(docText(footer).includes("Sources: Home Office, GOV.UK. Contains public sector information licensed under the Open Government Licence v3.0. CPIN Explorer is an independent mirror, not affiliated with or endorsed by the Home Office."));
  assert.match(footer, /PAGE/);
  assert.match(footer, /NUMPAGES/);
  assert.ok(/<w:pgSz w:w="11906" w:h="16838"/.test(doc), "A4");
  assert.match(xml(full, "word/styles.xml"), /<w:lang w:val="en-GB"\/>/, "British English");
});

test("structure: Heading 1 country, 2 note, 3 highlight; a bookmark on each; contents linked to them", () => {
  const doc = xml(full, "word/document.xml");
  assert.deepEqual(styled(doc, "Heading1"), ["Afghanistan", "Iran"]);
  assert.deepEqual(styled(doc, "Heading2"), ["Humanitarian situation", "Illegal exit", "Military service"]);
  assert.deepEqual(styled(doc, "Heading3").map((t) => t.replace(/\u00a0/g, "")),
    ["Para 8.4.2 — 8. Humanitarian situation", "Para 2.4.5 — 2.4 Risk", "Para 4.2.1 — 4. Risk", "Para 9.1.1 — 9. Armed forces structure"]);
  assert.equal(highlightHeading(highlights[0]).text, "Para 9.1.1 — 9. Armed forces structure");
  const styles = xml(full, "word/styles.xml");
  for (const [id, level] of [["Heading1", 0], ["Heading2", 1], ["Heading3", 2]]) {
    assert.match(styles, new RegExp(`w:styleId="${id}">(?:(?!</w:style>).)*<w:outlineLvl w:val="${level}"/>`, "s"), `${id} outline level`);
  }
  const marks = all(doc, /<w:bookmarkStart [^>]*w:name="([^"]+)"/g);
  assert.deepEqual(marks, ["Contents", "Afghanistan", "Afghanistan_humanitarian_situation", "Afghanistan_para_8_4_2_humanitarian_situ",
    "Iran", "Iran_illegal_exit", "Iran_para_2_4_5_illegal_exit", "Iran_military_service", "Iran_para_4_2_1_military_service", "Iran_para_9_1_1_military_service"]);
  assert.equal(all(doc, /<w:bookmarkEnd w:id="(\d+)"/g).length, marks.length);
  for (const name of marks) assert.match(name, /^[A-Za-z][A-Za-z0-9_]{0,39}$/, "a name Word accepts");
  // The contents is a TOC field (Word can rebuild it) whose cached entries already link to every heading.
  assert.ok(doc.includes('<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/>'), "a Table of Contents block");
  assert.ok(doc.includes('<w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o &quot;1-3&quot; \\h \\z \\u \\n </w:instrText>'), "a TOC field");
  assert.equal(all(doc, /w:fldCharType="(begin|separate|end)"/g).join(" ").match(/begin separate end/g)?.length, 1);
  const toc = [1, 2, 3].flatMap((n) => styled(doc, `TOC${n}`).map((t) => [n, t]));
  assert.equal(toc.length, 2 + 3 + 4);
  const anchors = all(doc, /<w:hyperlink w:history="1" w:anchor="([^"]+)"/g);
  assert.deepEqual(new Set(anchors), new Set(marks), "every bookmark is linked, every link has a bookmark");
  assert.equal(anchors.filter((a) => a === "Contents").length, 2, "each country links back to the contents");
  assert.doesNotMatch(xml(full, "word/settings.xml"), /updateFields/, "nothing to update on opening");
});

test("fonts: Geist, Geist SemiBold and Geist Pixel Square embedded, one font-table entry per family", () => {
  for (const files of [full, cites]) {
    const styles = xml(files, "word/styles.xml"), doc = xml(files, "word/document.xml");
    assert.match(styles, /<w:rFonts w:ascii="Geist" w:cs="Geist" w:eastAsia="Geist" w:hAnsi="Geist"\/>/);
    assert.ok(doc.includes(`w:ascii="${FONTS.pixel}"`) && styles.includes(`w:ascii="${FONTS.strong}"`));
    assert.match(xml(files, "word/settings.xml"), /<w:embedTrueTypeFonts\/>/);
    const table = xml(files, "word/fontTable.xml");
    assert.deepEqual(all(table, /<w:font w:name="([^"]+)"/g), ["Geist", "Geist SemiBold", "Geist Pixel Square"]);
    assert.match(table, /<w:font w:name="Geist">.*<w:embedRegular r:id="rId1" w:fontKey="\{[0-9A-F-]{36}\}"\/><w:embedItalic r:id="rId2"/);
    assert.match(xml(files, "[Content_Types].xml"), /Extension="odttf"/);
    // Undo Word's obfuscation (XOR of the first 32 bytes with the reversed GUID key): the original fonts come back.
    const rels = xml(files, "word/_rels/fontTable.xml.rels");
    for (const [i, f] of FONT_FILES.entries()) {
      const target = new RegExp(`Id="rId${i + 1}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
      const odttf = files.get(`word/${target}`);
      assert.ok(odttf?.length, `word/${target}`);
      const key = new RegExp(`r:id="rId${i + 1}" w:fontKey="\\{([^}]+)\\}"`).exec(table)[1].replace(/-/g, "");
      const bytes = Buffer.from(key.match(/../g).map((h) => parseInt(h, 16)).reverse());
      const plain = Buffer.from(odttf);
      for (let b = 0; b < 32; b++) plain[b] ^= bytes[b % 16];
      assert.deepEqual(plain, assets.fonts[f.file], `${f.file} round-trips`);
      assert.equal(plain.readUInt32BE(0), 0x00010000, "TrueType");
    }
  }
});

test("citations only: the same look, a numbered list grouped by country and note, linked contents", () => {
  const doc = xml(cites, "word/document.xml");
  const text = docText(doc);
  assert.ok(text.includes("CPIN Explorer") && text.includes("Citations · 2 October 2026"));
  assert.ok(doc.includes('name="CPIN Explorer"'), "CPIN Explorer's mark in the header");
  assert.ok(xml(cites, "word/footer1.xml").includes('name="Roberts Macros"'), "the RM mark in the footer");
  assert.deepEqual(styled(doc, "Heading1"), ["Afghanistan", "Iran"]);
  assert.deepEqual(styled(doc, "Heading2"), ["Humanitarian situation", "Illegal exit", "Military service"]);
  assert.deepEqual(styled(doc, "Heading3"), []);
  const listed = styled(doc, "CpinListCitation");
  const order = ["8.4.2", "2.4.5", "4.2.1", "9.1.1"].map((p) => highlights.find((r) => r.para === p));
  assert.deepEqual(listed, order.map((r) => formatCitation(citeContext(r, { accessed: ACCESSED }), "oscola").text));
  assert.equal((doc.match(/<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="(\d+)"\/><\/w:numPr>/g) || []).length, 4);
  assert.equal(new Set(all(doc, /<w:numId w:val="(\d+)"\/>/g)).size, 1, "one list, numbered 1–4 across the groups");
  assert.match(xml(cites, "word/numbering.xml"), /<w:numFmt w:val="decimal"\/>/);
  for (const r of highlights) assert.ok(!text.includes(quoteOf(r)), "no quotes");
  assert.ok(styled(doc, "CpinLabel").some((t) => t.includes("Para 2.4.5") && t.includes("Changed since saved")));
  assert.ok(doc.includes(' TOC \\o &quot;1-2&quot; \\h'), "a TOC field, two levels");
  const anchors = new Set(all(doc, /<w:hyperlink w:history="1" w:anchor="([^"]+)"/g));
  const marks = new Set(all(doc, /<w:bookmarkStart [^>]*w:name="([^"]+)"/g));
  for (const a of ["Afghanistan", "Iran", "Iran_illegal_exit", "Iran_military_service", "Contents"]) assert.ok(anchors.has(a) && marks.has(a), a);
  assert.ok(docText(xml(cites, "word/footer1.xml")).includes("Open Government Licence v3.0"));
});

test("without the fonts it still builds, in Office fonts", async () => {
  const files = await build("full", { fonts: null });
  assert.ok(![...files.keys()].some((k) => k.startsWith("word/fonts/")));
  assert.match(xml(files, "word/styles.xml"), /w:ascii="Aptos"/);
  assert.ok(docText(xml(files, "word/document.xml")).includes("Military service"));
});

test("helpers: file names, bookmark names, citation runs", () => {
  assert.equal(docxFileName("full", ACCESSED), "CPIN Explorer citations 2026-10-02.docx");
  assert.equal(docxFileName("citations", ACCESSED), "CPIN Explorer citations only 2026-10-02.docx");
  const name = bookmarkNamer();
  assert.equal(name("Côte d’Ivoire"), "Cote_d_Ivoire");
  assert.equal(name("Côte d’Ivoire"), "Cote_d_Ivoire_2");
  assert.equal(name("9.1.1"), "X_9_1_1");
  assert.equal(name("a".repeat(60)).length, 40);
  assert.equal(name("a".repeat(60)), `${"a".repeat(38)}_2`);
  const c = formatCitation(citeContext(highlights[0], { accessed: ACCESSED }), "oscola");
  const runs = htmlRuns(c.html);
  assert.equal(runs.map((r) => r.text).join(""), c.text);
  assert.deepEqual(runs.filter((r) => r.italic).map((r) => r.text), ["Country Policy and Information Note: Military Service, Iran"]);
  assert.deepEqual(runs.filter((r) => r.href).map((r) => r.href), [c.url]);
  const t = formatCitation(citeContext(highlights[0], { accessed: ACCESSED }), "tribunal");
  assert.deepEqual(htmlRuns(t.html).map((r) => [r.text, !!r.href]), [["CPIN Iran: Military service", true], [" (v4.0, Aug 2026, web version) at [9.1.1]", false]]);
});

/* ------------------------------------------------------------------ what a quote is, and where it is from */

const dashboard = JSON.parse(readFileSync(join(ROOT, "prototypes/dashboard/data.json"), "utf8"));
/** A highlight as the reader saves it from an edition read from a PDF (one of the dashboard's "pdf-…" notes). */
const pdfHighlight = (id, slug, topic, extra = {}) => {
  const c = dashboard.countries.find((x) => x.slug === slug), n = c.notes.find((x) => x.text_from_pdf && x.topic === topic);
  return { id, country: slug, countryName: c.name, iso: c.iso_a2, note: n.id, series: n.series, title: n.title, kind: n.kind, topic: n.topic, version: n.version, month: n.month,
    editionSha: n.pdf_sha256.slice(0, 16), url: n.pdf_url, source: "pdf", archived: false, quote: `Words read from the PDF on ${topic}.`, lead: null, para: "2.4.1",
    section: "2. Assessment", pos: { start: 10, end: 60 }, sources: [], comment: "", check: "current", createdAt: "2026-10-04T08:00:00Z", ...extra };
};
const VERBATIM = "Quotes are verbatim from the Home Office notes on GOV.UK; each link opens the note at the quoted words.";

test("a quote in the Word file is the words as they read: a figure kept, lines of a table apart", async () => {
  const web = highlights.find((r) => r.para === "9.1.1");
  const figure = { ...web, id: "hf", quote: "2.86 million Afghans returned to Afghanistan", lead: null, para: "16.1.2", sources: [] };
  const old = { ...figure, id: "ho", lead: undefined, para: "16.1.3" };                          // saved before `lead` was recorded
  const table = { ...web, id: "ht", quote: "18904471443", spaced: "1890 447 1443", lead: null, para: "7.6.5", sources: [] };
  const whole = { ...web, id: "hw", quote: "16.1.2     In 2025, approximately 2.86 million", lead: "16.1.2", para: "16.1.2", sources: [] };
  const files = unzip(await buildCitationsDocx(docx, [figure, old, table, whole], { mode: "full", accessed: ACCESSED, ...assets, output: "nodebuffer" }));
  const quotes = styled(xml(files, "word/document.xml"), "CpinQuote");
  assert.deepEqual(quotes.sort(), ["“1890 447 1443”", "“2.86 million Afghans returned to Afghanistan”", "“2.86 million Afghans returned to Afghanistan”", "“In 2025, approximately 2.86 million”"]);
});

test("quotes read from a PDF are marked, and the header calls only the others verbatim", async () => {
  const text = (files) => docText(xml(files, "word/document.xml"));
  // Web notes only: as before.
  assert.ok(text(full).includes(VERBATIM));
  assert.ok(!text(full).includes("From the PDF"));
  // A mixed set: the header says which are not verbatim, and each of those carries the mark on its card.
  const zim = [pdfHighlight("hz1", "zimbabwe", "opposition to the government"), pdfHighlight("hz2", "zimbabwe", "medical treatment and healthcare")];
  const mixedFiles = await build("full"), mixedSet = [...highlights, ...zim];
  const mixed = unzip(await buildCitationsDocx(docx, mixedSet, { mode: "full", accessed: ACCESSED, ...assets, output: "nodebuffer" }));
  const t = text(mixed);
  assert.ok(!t.includes(VERBATIM), "the plain claim is not made of a mixed set");
  assert.ok(t.includes("Quotes are verbatim from the Home Office notes on GOV.UK, except the 2 marked “From the PDF”: those are this site’s reading of a note published as a PDF only, so check the PDF where exact wording matters."));
  assert.equal((t.match(/From the PDF/g) || []).length, 1 + 2, "once in the header, once on each of the two cards");
  assert.ok(t.includes("The Home Office publishes this edition as a PDF only."));
  assert.ok(t.includes("“Words read from the PDF on opposition to the government.”") && t.includes("(version 5.0, September 2021, PDF version) para 2.4.1"));
  assert.ok(text(mixedFiles).includes(VERBATIM), "and the web-only export is unchanged by it");
  // Two reports of one country, each read from a PDF: two notes, each under its own title, linked to its own PDF.
  const doc = xml(mixed, "word/document.xml");
  assert.deepEqual(styled(doc, "Heading2"), ["Humanitarian situation", "Illegal exit", "Military service", "Medical treatment and healthcare", "Opposition to the government"]);
  assert.ok(styled(doc, "CpinVerbatim").includes(zim[0].title) && styled(doc, "CpinVerbatim").includes(zim[1].title));
  assert.ok(styled(doc, "CpinMeta").some((m) => m.includes("Version 5.0") && m.includes(zim[0].url)));
  assert.ok(styled(doc, "CpinMeta").some((m) => m.includes("Version 2.0") && m.includes(zim[1].url)));
  // One PDF quote among web ones, and PDF quotes only: the wording stays true.
  const one = text(unzip(await buildCitationsDocx(docx, [...highlights, zim[0]], { mode: "full", accessed: ACCESSED, ...assets, output: "nodebuffer" })));
  assert.ok(one.includes("except the one marked “From the PDF”: that is this site’s reading"));
  const only = text(unzip(await buildCitationsDocx(docx, zim, { mode: "full", accessed: ACCESSED, ...assets, output: "nodebuffer" })));
  assert.ok(only.includes("Quotes are this site’s reading of notes the Home Office publishes as a PDF only (marked “From the PDF”)") && !only.includes("verbatim"));
  // Citations only: no quotes, so no claim about them; the PDF citations are marked and the link line is true.
  const list = unzip(await buildCitationsDocx(docx, mixedSet, { mode: "citations", accessed: ACCESSED, ...assets, output: "nodebuffer" }));
  assert.ok(text(list).includes("a link to a PDF (marked “From the PDF”) opens the PDF."));
  assert.equal(styled(xml(list, "word/document.xml"), "CpinLabel").filter((l) => l.includes("From the PDF")).length, 2);
  assert.ok(docText(xml(cites, "word/document.xml")).includes("Each link opens the note at the quoted words."));
});

test("a note's heading gives the edition its highlights cite, not the one on GOV.UK the day of the export", () => {
  // The illegal exit passage was saved from v6.0 (May 2022) and has changed since; the dashboard knows v7.0.
  const saved = highlights.find((r) => r.para === "2.4.5"), today = assets.noteInfo(saved.country, saved.note);
  assert.equal(saved.version, "6.0");
  assert.notEqual(today.version, saved.version, "the dashboard has moved on from the edition quoted");
  const doc = xml(full, "word/document.xml");
  const meta = styled(doc, "CpinMeta").find((m) => m.includes("illegal-exit"));
  assert.match(meta, /^Version 6\.0 /);
  assert.ok(!meta.startsWith(`Version ${today.version}`), "today's version is not passed off as the highlight's");
  assert.ok(docText(doc).includes("May 2022 · v6.0"));
  assert.ok(styled(doc, "CpinVerbatim").includes(saved.title), "and the title is the one that edition was published under");
  // The card under it still says what has happened since.
  assert.ok(docText(doc).includes("v6.0 → v7.0: these words are not in the edition now on GOV.UK."));
  // Citations only: the same edition line.
  assert.ok(styled(xml(cites, "word/document.xml"), "CpinMeta").some((m) => m.includes("May 2022 · v6.0")));
});

test("highlights from two editions of one note: the heading names both", async () => {
  const a = highlights.find((r) => r.para === "2.4.5");                                       // v6.0, May 2022
  const b = { ...a, id: "hb", version: "7.0", month: "2026-08", title: a.title.replace("May 2022", "August 2026"), check: "current", current: null, archivedCopy: null, para: "2.4.6", pos: { start: a.pos.start + 900, end: a.pos.end + 900 } };
  const files = unzip(await buildCitationsDocx(docx, [a, b], { mode: "full", accessed: ACCESSED, ...assets, output: "nodebuffer" }));
  const doc = xml(files, "word/document.xml");
  assert.ok(docText(doc).includes("May 2022 · v6.0  /  Aug 2026 · v7.0"));
  assert.ok(styled(doc, "CpinMeta").some((m) => m.startsWith("Versions 6.0 and 7.0")));
});
