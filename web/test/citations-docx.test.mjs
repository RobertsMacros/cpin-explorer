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
import { cleanQuote, formatCitation } from "../../prototypes/shared/citation.js";
import { citeContext } from "../../prototypes/shared/highlights.js";
import { docxAssets, readBytes, sampleHighlights, textOf } from "../build-docx.mjs";

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
    assert.ok(text.includes(`“${cleanQuote(r.quote)}”`), `quote ${r.para}`);
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
  assert.ok(doc.includes('<a:srcRect l="22000" t="21500" r="22500" b="38000"/>'), "the RM mark, cropped");
  assert.ok([...full.keys()].some((k) => /^word\/media\/.+\.png$/.test(k)));
  const footer = xml(full, "word/footer1.xml");
  assert.ok(docText(footer).includes("Source: Home Office, GOV.UK. Contains public sector information licensed under the Open Government Licence v3.0. CPIN Explorer is an independent mirror, not affiliated with or endorsed by the Home Office."));
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
  assert.ok(doc.includes("<a:srcRect "), "the RM mark");
  assert.deepEqual(styled(doc, "Heading1"), ["Afghanistan", "Iran"]);
  assert.deepEqual(styled(doc, "Heading2"), ["Humanitarian situation", "Illegal exit", "Military service"]);
  assert.deepEqual(styled(doc, "Heading3"), []);
  const listed = styled(doc, "CpinListCitation");
  const order = ["8.4.2", "2.4.5", "4.2.1", "9.1.1"].map((p) => highlights.find((r) => r.para === p));
  assert.deepEqual(listed, order.map((r) => formatCitation(citeContext(r, { accessed: ACCESSED }), "oscola").text));
  assert.equal((doc.match(/<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="(\d+)"\/><\/w:numPr>/g) || []).length, 4);
  assert.equal(new Set(all(doc, /<w:numId w:val="(\d+)"\/>/g)).size, 1, "one list, numbered 1–4 across the groups");
  assert.match(xml(cites, "word/numbering.xml"), /<w:numFmt w:val="decimal"\/>/);
  for (const r of highlights) assert.ok(!text.includes(cleanQuote(r.quote)), "no quotes");
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
  assert.deepEqual(htmlRuns(t.html).map((r) => [r.text, !!r.href]), [["CPIN Iran: Military service", true], [" (v4.0, Aug 2026) at [9.1.1]", false]]);
});
