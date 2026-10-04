import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  cleanQuote, footnoteNumbers, formatCitation, formatPinpoint, formatSources, italicTitle, longDate, monthLabel,
  paraAt, paraDepth, paraNumber, paraNumbers, paraRange, parseNoteTitle, quoteOf, quoteWithCitation, stripFootnoteMarkers, textFragment,
  titleCase,
} from "../../prototypes/shared/citation.js";
import { describePassage, snapToParaNumber, trimNextParaNumber } from "../../prototypes/shared/note-source.js";
import { exportMarkdown } from "../../prototypes/shared/highlights.js";
import { decodeEntities, getAttr, parseHTML } from "../../prototypes/shared/redline-diff.js";

const ROOT = new URL("../../", import.meta.url);
const data = JSON.parse(readFileSync(new URL("prototypes/dashboard/data.json", ROOT), "utf8"));
const noteOf = (slug, id) => {
  const c = data.countries.find((x) => x.slug === slug);
  return { c, n: c.notes.find((x) => x.id === id) };
};
const MIL = "country-policy-and-information-note-military-service-iran-august-2026-accessible";
const milHtml = readFileSync(new URL(`data/countries/iran/notes/${MIL}/83755408bda958a3.html`, ROOT), "utf8");
const plain = (html) => decodeEntities(html.replace(/<[^>]+>/g, ""));
// A real paragraph: 9.1.1, which cites footnote 12.
const para911Html = milHtml.match(/<p>9\.1\.1 [\s\S]*?<\/p>/)[0];
const para911 = plain(para911Html);
const ACCESSED = new Date(2026, 9, 2);

test("a real paragraph: number, footnote markers and the cited quote", () => {
  assert.match(para911, /^9\.1\.1 Under articles 107 and 110/);
  assert.match(para911, /\[footnote 12\]$/);
  assert.equal(paraNumber(para911), "9.1.1");
  assert.deepEqual(footnoteNumbers(para911), [12]);
  assert.equal(stripFootnoteMarkers(para911).endsWith("Armed Forces."), true);
  assert.equal(cleanQuote(para911, { lead: "9.1.1" }),
    "Under articles 107 and 110 of the Constitution of the Islamic Republic of Iran, the Supreme Leader has ultimate command of the Armed Forces.");
  // Every numbered paragraph in the real note is found, in order.
  const nums = [...milHtml.matchAll(/<p>([^<]*)/g)].map((m) => paraNumber(plain(m[1]), { minDepth: 3 })).filter(Boolean);
  assert.ok(nums.length > 150, `found ${nums.length} numbered paragraphs`);
  assert.equal(nums[0], "1.1.1");
  assert.equal(paraDepth(nums), 3);
});

test("paragraph numbers: depth, look-alikes and ranges", () => {
  assert.equal(paraNumber("3.4.1 Decision makers must:"), "3.4.1");
  assert.equal(paraNumber("  12.10.3\tText"), "12.10.3");
  assert.equal(paraNumber("43.8 million (2025 estimate)", { minDepth: 3 }), null);
  assert.equal(paraNumber("2.1 A short-numbered note"), "2.1");
  assert.equal(paraNumber("Version 4.0, August 2026"), null);
  assert.equal(paraNumber("1999 was a year"), null);
  assert.equal(paraRange("3.4.1", "3.4.3"), "3.4.1–3.4.3");
  assert.equal(paraRange("3.4.1", "3.4.1"), "3.4.1");
  assert.equal(paraRange(null, "3.4.2"), "3.4.2");
  assert.equal(formatPinpoint("3.4.1"), "para 3.4.1");
  assert.equal(formatPinpoint("3.4.1–3.4.3"), "paras 3.4.1–3.4.3");
  assert.equal(formatPinpoint("3.4.1", "tribunal"), "at [3.4.1]");
  assert.equal(formatPinpoint("3.4.1–3.4.3", "tribunal"), "at [3.4.1]–[3.4.3]");
  const anchors = [{ at: 0, heading: "Assessment" }, { at: 10, para: "1.1.1" }, { at: 50, para: "1.1.2" },
    { at: 90, heading: "2. Exclusion" }, { at: 120, para: "2.1.1" }];
  assert.equal(paraAt(anchors, 5), null);
  assert.equal(paraAt(anchors, 10), "1.1.1");
  assert.equal(paraAt(anchors, 70), "1.1.2");
  assert.equal(paraAt(anchors, 100), null);
  assert.equal(paraAt(anchors, 500), "2.1.1");
});

test("footnote markers are stripped with the space before them", () => {
  assert.equal(stripFootnoteMarkers("Farsi[footnote 1] (Persian)"), "Farsi (Persian)");
  assert.equal(stripFootnoteMarkers("of Iran[footnote 4] [footnote 5], published"), "of Iran, published");
  assert.equal(cleanQuote("  8.2.1 On 20 July\n 2014, Ekhtebar[footnote 4] said", { lead: "8.2.1" }), "On 20 July 2014, Ekhtebar said");
  assert.deepEqual(footnoteNumbers("a[footnote 4] b [footnote 5] c[footnote 4]"), [4, 5]);
});

// Afghanistan, fear of the Taliban (February 2026), para 16.1.2: "In 2025, approximately 2.86 million Afghans returned…".
const TALIBAN = "country-policy-and-information-note-fear-of-the-taliban-afghanistan-february-2026-accessible";
const talibanHtml = readFileSync(new URL(`data/countries/afghanistan/notes/${TALIBAN}/2c5e35429f512dbf.html`, ROOT), "utf8");
const para1612 = plain(talibanHtml.match(/<p>16\.1\.2 [\s\S]*?<\/p>/)[0]);

test("a figure that opens a quote is kept: only the paragraph's own number, at its start, moves into the pinpoint", () => {
  const figure = "2.86 million Afghans returned to Afghanistan";
  assert.ok(para1612.includes(figure), "the real paragraph has the figure in running text");
  // Whatever its shape, a number at the start of the words is part of the words.
  assert.equal(cleanQuote(figure), figure);
  assert.equal(cleanQuote("1.86 million and Pakistan for 963,300"), "1.86 million and Pakistan for 963,300");
  assert.equal(cleanQuote(para1612).slice(0, 30), "16.1.2 In 2025, approximately ", "no number is dropped unless the caller says it is the paragraph's own");
  // The paragraph's own number goes only when it is named, whole, at the very start.
  assert.equal(cleanQuote(para1612, { lead: "16.1.2" }).slice(0, 23), "In 2025, approximately ");
  assert.equal(cleanQuote(figure, { lead: "16.1.2" }), figure);
  assert.equal(cleanQuote("16.1.21 In 2025", { lead: "16.1.2" }), "16.1.21 In 2025", "a longer number is not this paragraph's");
  assert.equal(cleanQuote("2.86", { lead: "2.86" }), "2.86", "never the whole quote");
  assert.equal(cleanQuote("2.1.3. Although members", { lead: "2.1.3." }), "Although members", "the number as printed, with its full stop");
  assert.equal(cleanQuote("8.5.3The INSTAT report", { lead: "8.5.3" }), "The INSTAT report", "a number set against the first word");

  // What the reader knows about a selection: where numbered paragraphs start (anchors), so whether a quote opens one.
  const text = `Heading 16.1.1 First. ${para1612} 16.1.3 Third.`;
  const at = text.indexOf("16.1.2"), mid = text.indexOf(figure);
  const A = { text, anchors: [{ at: 0, heading: "Heading" }, { at: 8, para: "16.1.1", lead: "16.1.1" }, { at, para: "16.1.2", lead: "16.1.2" },
    { at: text.indexOf("16.1.3"), para: "16.1.3", lead: "16.1.3" }], sections: [{ at: 0, title: "16. Returnees" }], refs: [], fns: new Map() };
  const whole = describePassage(A, at, at + para1612.length), part = describePassage(A, mid, mid + figure.length);
  assert.deepEqual([whole.para, whole.lead], ["16.1.2", "16.1.2"]);
  assert.deepEqual([part.para, part.lead], ["16.1.2", null], "part-way through the paragraph: nothing to leave out");
  assert.equal(snapToParaNumber(A, at + 3), at, "a selection begun inside the number begins at the number");
  assert.equal(snapToParaNumber(A, mid), mid);
  // A selection dragged into the next paragraph's number ends before it; one that takes any of its words does not.
  const next = text.indexOf("16.1.3"), endOfPara = at + para1612.length;
  assert.equal(trimNextParaNumber(A, at, next + 6), endOfPara, "the whole of the next number");
  assert.equal(trimNextParaNumber(A, at, next + 4), endOfPara, "part of it");
  assert.equal(trimNextParaNumber(A, mid, next + 6), endOfPara, "from the middle of the paragraph");
  assert.equal(trimNextParaNumber(A, at, next + 12), next + 12, "the next paragraph's words are wanted");
  assert.equal(trimNextParaNumber(A, at, endOfPara), endOfPara);
  assert.equal(describePassage(A, at, trimNextParaNumber(A, at, next + 6)).para, "16.1.2", "and the pinpoint is one paragraph, not a range");

  // Every way a quote leaves the site: the copy, the Markdown export, the previews (quoteOf).
  const base = { title: "Country policy and information note: fear of the Taliban, Afghanistan, February 2026 (accessible)", kind: "CPIN",
    topic: "fear of the Taliban", countryName: "Afghanistan", country: "afghanistan", note: TALIBAN, version: "6.0", month: "2026-02", para: "16.1.2",
    url: "https://www.gov.uk/x", accessed: ACCESSED, sources: [] };
  const mine = { ...base, id: "h1", quote: figure, lead: part.lead }, old = { ...base, id: "h2", quote: figure };   // old: saved before `lead` was recorded
  for (const rec of [mine, old]) {
    assert.equal(quoteOf(rec), figure);
    assert.equal(quoteWithCitation(rec, "tribunal").text, `“${figure}” CPIN Afghanistan: Fear of the Taliban (v6.0, Feb 2026, web version) at [16.1.2]`);
    assert.ok(quoteWithCitation(rec).html.startsWith(`<p>“${figure}” Home Office`));
    assert.ok(quoteWithCitation(rec).md.startsWith(`> ${figure}\n`));
    assert.ok(exportMarkdown([rec], { accessed: ACCESSED }).includes(`\n> ${figure}\n`));
  }
  // A whole paragraph still loses its number, with or without the new field.
  for (const rec of [{ ...base, quote: para1612, lead: "16.1.2" }, { ...base, quote: para1612 }]) assert.ok(quoteOf(rec).startsWith("In 2025, approximately 2.86 million Afghans"));
  // An older record whose range begins elsewhere: the first paragraph of the range is the only number that can go.
  assert.equal(quoteOf({ quote: "16.1.3 Third.", para: "16.1.2–16.1.3" }), "16.1.3 Third.");
});

test("text fragments: whole short quotes, start and end words around footnotes and blocks", () => {
  assert.equal(textFragment("the Supreme Leader"), "#:~:text=the%20Supreme%20Leader");
  assert.equal(textFragment(para911), "#:~:text=9.1.1%20Under%20articles%20107%20and,command%20of%20the%20Armed%20Forces.");
  // Hyphens, commas and ampersands are reserved in text directives.
  assert.equal(textFragment("non-state actors, A & B"), "#:~:text=non%2Dstate%20actors%2C%20A%20%26%20B");
  // A footnote in the middle: the start words come before it, the end words after it.
  const across = "the Iran Data Portal, an online portal which hosts social science data on Iran in both English and Farsi[footnote 1] (Persian), published an English translation";
  assert.equal(textFragment(across), "#:~:text=the%20Iran%20Data%20Portal%2C%20an,(Persian)%2C%20published%20an%20English%20translation");
  // Across paragraphs (a newline in the text), each term stays inside one block.
  assert.equal(textFragment("Decision makers must:\n\n  assess credibility (see the Asylum Instruction"),
    "#:~:text=Decision%20makers%20must%3A,credibility%20(see%20the%20Asylum%20Instruction");
});

test("titles: real GOV.UK titles become italic OSCOLA titles", () => {
  const cases = [
    ["iran", MIL, "Country Policy and Information Note: Military Service, Iran", "August 2026"],
    ["iran", "country-bulletin-iran-security-situation-march-2026-accessible--2", "Country Bulletin: Security Situation, Iran", "March 2026"],
    ["iran", "country-policy-and-information-note-zina-sex-outside-of-marriage-and-adultery-iran-april-2026-accessible",
      "Country Policy and Information Note: ‘Zina’ (Sex Outside of Marriage and Adultery), Iran", "April 2026"],
    ["iran", "country-policy-and-information-note-women-early-and-forced-marriage-iran-may-2022-accessible",
      "Country Policy and Information Note: Women - Early and Forced Marriage, Iran", "June 2025"],
  ];
  for (const [slug, id, italic, month] of cases) {
    const { c, n } = noteOf(slug, id);
    const ctx = { title: n.title, kind: n.kind, topic: n.topic, countryName: c.name };
    assert.equal(italicTitle(ctx), italic, n.title);
    assert.equal(parseNoteTitle(ctx).month, month, n.title);
  }
  // Irregular titles seen on GOV.UK.
  const t = (title, extra = {}) => italicTitle({ kind: "CPIN", ...extra, title });
  assert.equal(t("Country policy and information note, Kuwait: Bidoons, August 2024 (accessible)", { countryName: "Kuwait" }),
    "Country Policy and Information Note: Bidoons, Kuwait");
  assert.equal(t("Country policy and information note: China: modern slavery October 2024 (accessible)", { countryName: "China", topic: "modern slavery" }),
    "Country Policy and Information Note: Modern Slavery, China");
  assert.equal(t("Country policy and information note: Military service, August 2026 (accessible)", { countryName: "Russia" }),
    "Country Policy and Information Note: Military Service, Russia");
  assert.equal(t("Country policy and information note: Rohingya including Rohingya in Bangladesh, Burma, January 2026 (accessible)", { countryName: "Myanmar (Burma)" }),
    "Country Policy and Information Note: Rohingya Including Rohingya in Bangladesh, Burma");
  assert.equal(t("Report of a fact-finding mission, Ethiopia: situation of the Tigrayans, December 2024 (accessible)", { kind: "Fact-finding mission", countryName: "Ethiopia" }),
    "Report of a Fact-Finding Mission: Situation of the Tigrayans, Ethiopia");
  assert.equal(t("country-policy-and-information-note-actors-of-protection-columbia-january-2025-accessible", { countryName: "Colombia", topic: "actors of protection" }),
    "Country Policy and Information Note: Actors of Protection, Colombia");
  const protests = parseNoteTitle({ title: "Country bulletin Iran: protests of December 2025 to January 2026 (accessible)", kind: "Country bulletin",
    topic: "protests of December 2025 to January 2026", countryName: "Iran" });
  assert.equal(protests.topic, "protests of December 2025 to January 2026");
  assert.equal(protests.month, null);
  assert.equal(titleCase("non-Christian religious groups"), "Non-Christian Religious Groups");
  assert.equal(titleCase("Peoples' Democratic Party (HDP)"), "Peoples' Democratic Party (HDP)");
});

test("dates", () => {
  assert.equal(longDate(ACCESSED), "2 October 2026");
  // A timestamp is the UK calendar day, as everywhere else on the site: 23:03 UTC in August is past midnight in the UK.
  assert.equal(longDate("2026-08-25T23:03:57Z"), "26 August 2026");
  assert.equal(longDate("2026-08-25T22:59:00Z"), "25 August 2026");
  assert.equal(longDate("2026-01-15T23:30:00Z"), "15 January 2026", "in winter UK time is UTC");
  assert.equal(longDate("not a date"), "");
  assert.deepEqual(monthLabel("2026-08"), { long: "August 2026", short: "Aug 2026" });
  assert.deepEqual(monthLabel("2026-08-26T14:14:12Z"), { long: "August 2026", short: "Aug 2026" });
  assert.equal(monthLabel(null), null);
});

test("OSCOLA and tribunal citations for a real paragraph", () => {
  const { c, n } = noteOf("iran", MIL);
  const ctx = { title: n.title, kind: n.kind, topic: n.topic, countryName: c.name, version: n.version, month: n.month,
    para: "9.1.1", url: n.govuk_url, quote: para911, accessed: ACCESSED };
  const url = "https://www.gov.uk/government/publications/iran-country-policy-and-information-notes/country-policy-and-information-note-military-service-iran-august-2026-accessible#:~:text=9.1.1%20Under%20articles%20107%20and,command%20of%20the%20Armed%20Forces.";
  const o = formatCitation(ctx, "oscola");
  assert.equal(o.text, `Home Office, Country Policy and Information Note: Military Service, Iran (version 4.0, August 2026, web version) para 9.1.1 <${url}> accessed 2 October 2026.`);
  assert.equal(o.url, url);
  assert.match(o.html, /^Home Office, <i>Country Policy and Information Note: Military Service, Iran<\/i> \(version 4\.0, August 2026, web version\) para 9\.1\.1 &lt;<a href="/);
  assert.match(o.md, /^Home Office, \*Country Policy and Information Note: Military Service, Iran\* /);
  const t = formatCitation(ctx, "tribunal");
  assert.equal(t.text, "CPIN Iran: Military service (v4.0, Aug 2026, web version) at [9.1.1]");
  assert.match(t.html, /^<a href="https:\/\/www\.gov\.uk\/.+#:~:text=.+">CPIN Iran: Military service<\/a> \(v4\.0, Aug 2026, web version\) at \[9\.1\.1\]$/);
  // Ranges, sections, bulletins and archived copies.
  assert.match(formatCitation({ ...ctx, para: "9.1.1–9.1.3" }).text, / paras 9\.1\.1–9\.1\.3 </);
  assert.equal(formatCitation({ ...ctx, para: null, section: "Executive summary" }, "tribunal").text,
    "CPIN Iran: Military service (v4.0, Aug 2026, web version), ‘Executive summary’");
  const b = noteOf("iran", "country-bulletin-iran-security-situation-march-2026-accessible--2");
  assert.equal(formatCitation({ title: b.n.title, kind: b.n.kind, topic: b.n.topic, countryName: "Iran", month: b.n.month, para: "1.2.3" }, "tribunal").text,
    "Country bulletin Iran: Security situation (Mar 2026, web version) at [1.2.3]");
  const arch = formatCitation({ ...ctx, version: "3.0", title: "Country policy and information note: military service, Iran, November 2022 (accessible)",
    archived: true, capturedAt: "2026-08-25T23:03:57Z", url: "https://web.archive.org/web/20260825230357/https://www.gov.uk/x" });
  assert.match(arch.text, /\(version 3\.0, November 2022, web version\) para 9\.1\.1 \(archived copy, Internet Archive, captured 26 August 2026\) <https:\/\/web\.archive\.org\/web\/20260825230357\/https:\/\/www\.gov\.uk\/x#:~:text=/);
  // Sri Lanka, Tamil separatism: captured 6 April 2024 at 23:45 UTC, which is 7 April in the UK. The page says 7 April
  // (its dates are UK dates), and so does the citation: one clock.
  const lanka = formatCitation({ ...ctx, archived: true, capturedAt: "2024-04-06T23:45:15Z", url: "https://web.archive.org/web/20240406234515/https://www.gov.uk/y" });
  assert.match(lanka.text, /\(archived copy, Internet Archive, captured 7 April 2024\)/);
  assert.match(formatCitation({ ...ctx, archived: true, capturedAt: "2024-04-06T23:45:15Z" }, "tribunal").text, /captured 7 April 2024\)$/);
});

test("quote + citation and sources for the clipboard", () => {
  const { c, n } = noteOf("iran", MIL);
  const fn12 = plain(milHtml.match(/<li id="fn:12">([\s\S]*?)<\/li>/)[1]).replace(/↩\s*$/, "").trim();
  const sources = [{ n: 12, text: fn12, url: "https://example.org/fn12" }];
  const ctx = { title: n.title, kind: n.kind, topic: n.topic, countryName: c.name, version: n.version, month: n.month,
    para: "9.1.1", url: n.govuk_url, quote: para911, accessed: ACCESSED };
  const out = quoteWithCitation(ctx, "tribunal", sources);
  assert.equal(out.text.split("\n")[0],
    "“Under articles 107 and 110 of the Constitution of the Islamic Republic of Iran, the Supreme Leader has ultimate command of the Armed Forces.” CPIN Iran: Military service (v4.0, Aug 2026, web version) at [9.1.1]");
  assert.match(out.text, /\n\nSources cited in this passage:\n\[12\] /);
  assert.ok(!out.text.includes("[footnote"), "no footnote markers in the quote");
  assert.match(out.html, /^<p>“Under articles 107/);
  assert.match(out.html, /<p>Sources cited in this passage:<\/p><p>\[12\] <a href="https:\/\/example\.org\/fn12">/);
  assert.deepEqual(formatSources([]), { text: "", html: "", md: "" });
});


test("a citation says which publication it is from, and the PDF's paragraph number where it differs", async () => {
  const { pdfPinpoint, sourceOf, formatCitation: cite } = await import("../../prototypes/shared/citation.js");
  const ctx = { title: "Country policy and information note: national service and illegal exit, Eritrea, December 2025 (accessible)", kind: "CPIN",
    topic: "national service and illegal exit", countryName: "Eritrea", version: "2.0", month: "2025-12", para: "18.4.1", url: "https://www.gov.uk/x", accessed: ACCESSED };
  // The web version is the default, and is named.
  assert.match(cite(ctx).text, /\(version 2\.0, December 2025, web version\) para 18\.4\.1 </);
  assert.equal(cite(ctx, "tribunal").text, "CPIN Eritrea: National service and illegal exit (v2.0, Dec 2025, web version) at [18.4.1]");
  // Where the PDF numbers the paragraph differently, the citation gives both.
  const numbering = { same: 400, different: { "18.4.1": "18.3.1", "18.4.2": "18.3.2" }, pdf_unnumbered: ["2.1.1"] };
  assert.equal(pdfPinpoint("18.4.1", numbering), "18.3.1");
  assert.equal(pdfPinpoint("18.4.1–18.4.2", numbering), "18.3.1–18.3.2");
  assert.equal(pdfPinpoint("18.4.2–18.5.1", numbering), "18.3.2–18.5.1", "one end differs");
  assert.equal(pdfPinpoint("9.1.1", numbering), null, "numbered the same: nothing to add");
  assert.equal(pdfPinpoint("2.1.1", numbering), "", "the PDF does not number it");
  assert.equal(pdfPinpoint("18.4.1", null), null);
  // A number the web version uses twice could be either paragraph, and a PDF number only one reader found is
  // not known: no PDF number is given for either, nor for a range that touches one.
  const unsure = { ...numbering, different: { ...numbering.different, "12.2.5": "14.2.5", "8.2.5": "8.2.6" }, repeated: ["12.2.5"], unconfirmed: ["8.2.5"] };
  assert.equal(pdfPinpoint("12.2.5", unsure), null, "a repeated web number");
  assert.equal(pdfPinpoint("8.2.5", unsure), null, "a PDF number the second reader did not find");
  assert.equal(pdfPinpoint("18.4.1–12.2.5", unsure), null, "a range with one uncertain end");
  assert.equal(pdfPinpoint("18.4.1", unsure), "18.3.1", "the rest are as before");
  assert.match(cite({ ...ctx, pdfPara: "18.3.1" }).text, / para 18\.4\.1 \(para 18\.3\.1 in the PDF version\) </);
  assert.match(cite({ ...ctx, pdfPara: "18.3.1" }, "tribunal").text, / at \[18\.4\.1\] \(PDF version: \[18\.3\.1\]\)$/);
  assert.match(cite({ ...ctx, para: "2.1.1", pdfPara: "" }).text, / para 2\.1\.1 \(not numbered in the PDF version\) </);
  // A passage read from the PDF (an edition with no web version) is cited as the PDF, with the PDF's own numbers.
  const pdf = { ...ctx, source: "pdf", url: "https://assets.publishing.service.gov.uk/media/abc/ERI_CPIN.pdf", pdfPara: "18.3.1" };
  assert.match(cite(pdf).text, /\(version 2\.0, December 2025, PDF version\) para 18\.4\.1 </);
  assert.equal(sourceOf({ url: "https://assets.publishing.service.gov.uk/media/abc/ERI_CPIN.pdf" }), "pdf", "a highlight saved before the source was recorded");
  assert.equal(sourceOf({ url: "https://www.gov.uk/x" }), "web");
  // An edition recovered as a PDF from the Internet Archive is both: the PDF version, and an archived copy, with
  // the Archive's address as its source (GOV.UK's own address for the file leads elsewhere by now).
  const archive = "https://web.archive.org/web/20190726161037/https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/784644/OPTs_v2.0_March_2019.pdf";
  const old = { title: "Country policy and information note: security and humanitarian situation, OPT (Gaza), March 2019", kind: "CPIN",
    topic: "security and humanitarian situation, OPT (Gaza)", countryName: "Palestine", version: "2.0", month: "2019-03", para: "2.3.1",
    source: "pdf", archived: true, capturedAt: "2019-07-26T16:10:37Z", url: archive, accessed: ACCESSED };
  const full = cite(old).text;
  assert.match(full, /\(version 2\.0, March 2019, PDF version\) para 2\.3\.1 \(archived copy, Internet Archive, captured 26 July 2019\) <https:\/\/web\.archive\.org\/web\/20190726161037\//);
  assert.doesNotMatch(full, /web version/);
  assert.match(cite(old, "tribunal").text, /\(v2\.0, Mar 2019, PDF version\) at \[2\.3\.1\] \(archived copy, Internet Archive, captured 26 July 2019\)$/);
  assert.equal(sourceOf({ url: archive }), "pdf", "and so is a highlight saved from one, by its address");
  // The title is given as it was published: a note of 2019 names the OPT, and "Palestine" is not added to it.
  assert.match(full, /^Home Office, Country Policy and Information Note: Security and Humanitarian Situation, OPT \(Gaza\) \(version 2\.0/);
  const background = cite({ ...old, title: "Country policy and information note: background information, including actors of protection, and internal relocation, OPT, December 2018",
    topic: "background information, including actors of protection, and internal relocation", version: "1.0", month: "2018-12" }).text;
  assert.match(background, /Internal Relocation, OPT \(version 1\.0, December 2018, PDF version\)/);
  const renamed = cite({ ...old, title: "Country policy and information note: humanitarian situation in Gaza, Occupied Palestinian Territories, November 2024",
    topic: "humanitarian situation in Gaza", version: "4.0", month: "2024-11" }).text;
  assert.match(renamed, /Note: Humanitarian Situation in Gaza, Occupied Palestinian Territories \(version 4\.0, November 2024, PDF version\)/);
});

/* ------------------------------------------------------------------ paragraph numbers, read in their place */

// A stored body as the reader reads it for numbering (note-source.js: analyseBody): its own paragraphs (not those
// inside tables, lists, quotations or the footnotes) and its headings, in order.
function blocksOf(html) {
  const out = [], text = (n) => (n.t === 3 ? n.v : n.kids.map(text).join(""));
  (function walk(n, inside) {
    if (n.t !== 1) return;
    const cls = (getAttr(n, "class") || "").split(/\s+/);
    const shut = inside || ["table", "li", "blockquote"].includes(n.tag) || ["footnotes", "info-notice", "call-to-action", "application-notice"].some((c) => cls.includes(c));
    if (/^h[2-4]$/.test(n.tag) || cls.includes("footnotes")) out.push({ heading: true, text: text(n) });
    else if (n.tag === "p" && !shut) out.push({ text: text(n) });
    for (const k of n.kids) walk(k, shut);
  })(parseHTML(html), false);
  return out;
}
/** Every paragraph of a stored body with the number it is cited by, and the anchors the reader makes of them. */
function numbered(path) {
  const blocks = blocksOf(readFileSync(new URL(path, ROOT), "utf8"));
  const numbers = paraNumbers(blocks, paraDepth(blocks.filter((b) => !b.heading).map((b) => b.text)));
  const anchors = [];
  let at = 0;
  blocks.forEach((b, i) => {
    const n = numbers[i];
    if (b.heading) anchors.push({ at, heading: b.text.trim() }); else if (n) anchors.push({ at, para: n.num, lead: n.lead });
    b.at = at; b.n = n;
    at += b.text.length + 2;
  });
  const find = (start) => blocks.find((b) => !b.heading && b.text.trimStart().startsWith(start));
  return { blocks, anchors, find };
}

test("a paragraph with a mistyped number is cited by its number as printed, never as the paragraph before it", () => {
  // Turkey, Kurds (October 2023): after 3.2.5 the web version numbers the next paragraph "3.26".
  const kurds = numbered("data/countries/turkey/notes/country-policy-and-information-note-kurds-turkey-october-2023-accessible/08ef06fe79d27013.html");
  const p326 = kurds.find("3.26 For further guidance on assessing risk");
  assert.ok(p326 && kurds.find("3.2.5 "), "the paragraphs are in the stored text");
  assert.deepEqual(p326.n, { num: "3.26", lead: "3.26" });
  assert.equal(paraAt(kurds.anchors, p326.at + 20), "3.26", "a quote from it is cited para 3.26, not 3.2.5");
  assert.equal(formatCitation({ title: "Country policy and information note: Kurds, Turkey, October 2023 (accessible)", kind: "CPIN", topic: "Kurds", countryName: "Turkey",
    version: "5.0", month: "2023-10", para: paraAt(kurds.anchors, p326.at + 20) }, "tribunal").text, "CPIN Turkey: Kurds (v5.0, Oct 2023, web version) at [3.26]");
  // Brazil, organised criminal groups (March 2025): "7.13" after 7.1.2, and "4.11" after 4.1.10 (a part left out).
  const ocg = numbered("data/countries/brazil/notes/country-policy-and-information-note-organised-criminal-groups-brazil-march-2025-accessible/56312b793559e81f.html");
  assert.deepEqual(ocg.find("7.13 The map below").n, { num: "7.13", lead: "7.13" });
  assert.equal(paraAt(ocg.anchors, ocg.find("7.13 The map below").at + 10), "7.13");
  assert.deepEqual(ocg.find("4.11 For further guidance").n, { num: "4.11", lead: "4.11" });
  // The same note sets a sub-heading as a paragraph ("11.1 Recruitment: general"): no number of its own, and no pinpoint.
  assert.deepEqual(ocg.find("11.1 Recruitment: general").n, { num: null });
  assert.equal(paraAt(ocg.anchors, ocg.find("11.1 Recruitment: general").at + 3), null);
  assert.equal(ocg.find("11.1.1 ").n.num, "11.1.1", "the paragraph under it is its own");
  // A quote of the whole mistyped paragraph leaves its number out, as for any other.
  assert.ok(quoteOf({ quote: p326.text, lead: p326.n.lead, para: "3.26" }).startsWith("For further guidance on assessing risk"));
});

test("paragraph numbers as the Home Office prints them: a full stop after, no space after, and what is not one", () => {
  // Kuwait, Bidoons (August 2024) numbers every paragraph "1.1.1." with a full stop: each is still its own paragraph.
  const kuwait = numbered("data/countries/kuwait/notes/country-policy-and-information-note-kuwait-bidoons-august-2024-accessible/5e37e1ae4f4605fc.html");
  assert.deepEqual(kuwait.find("1.1.2. Decision makers").n, { num: "1.1.2", lead: "1.1.2." });
  assert.ok(kuwait.blocks.filter((b) => b.n?.num).length > 150, "the note's paragraphs are numbered");
  assert.equal(paraNumber("2.1.3. Although members of SC and ST form a PSG"), "2.1.3");
  assert.equal(quoteOf({ quote: "2.1.3. Although members", lead: "2.1.3.", para: "2.1.3" }), "Although members");
  // The number set tight against the first word (29 paragraphs in the editions now on GOV.UK).
  assert.equal(paraNumber("8.5.3The INSTAT report, Men and Women in Albania, 2022", { minDepth: 3 }), "8.5.3");
  assert.equal(paraNumber("7.3.6.On 1 September 2023 the ‘Administrative Measures", { minDepth: 3 }), "7.3.6");
  assert.equal(paraNumber("4.5G networks cover", { minDepth: 2 }), null, "two parts set tight could be a figure: not taken");
  // A note numbered 1.2 (or not numbered at all): a paragraph that opens with a figure and its unit is not paragraph "5.2".
  assert.equal(paraNumber("5.2 million people were displaced"), null);
  assert.equal(paraNumber("43.8% of households"), null);
  assert.equal(paraNumber("2.1 A short-numbered note"), "2.1");
  assert.deepEqual(paraNumbers([{ text: "2.1 The law provides" }, { text: "5.2 million people were displaced" }, { text: "2.2 The same source" }], 2).map((n) => n?.num ?? null), ["2.1", null, "2.2"]);
  assert.equal(paraNumber("8.5.3the report"), null);
  // In their place: what fits is given as printed; what could be something else has no pinpoint; a figure is just text.
  const read = (...texts) => paraNumbers(texts.map((t) => (t === "#" ? { heading: true } : { text: t })), 3).map((n) => (n ? n.num : n));
  assert.deepEqual(read("3.2.5 Text", "3.26 For further guidance", "3.2.7 Text"), ["3.2.5", "3.26", "3.2.7"]);
  assert.deepEqual(read("5.2.2 Text", "5,2,3 In its 2017 survey"), ["5.2.2", "5,2,3"]);
  assert.deepEqual(read("#", "12.3. 2 The OCHA noted:", "12.3.3 Text"), [null, "12.3. 2", "12.3.3"], "by the paragraph after it, when it opens a section");
  assert.deepEqual(read("9.2.1 Text", "92.2 The CIA WFB noted:", "9.2.3 Text"), ["9.2.1", "92.2", "9.2.3"]);
  assert.deepEqual(read("4.1.8 Text", "4.9 The state offers support", "4.1.10 Text"), ["4.1.8", "4.9", "4.1.10"]);
  assert.deepEqual(read("7.1.2 Text", "7.13 The map below", "7.14 The same source", "7.1.5 Text"), ["7.1.2", "7.13", "7.14", "7.1.5"], "two slips in a row");
  // (read() shows a paragraph without a pinpoint and an unnumbered one alike, as null: the next lines tell them apart.)
  assert.deepEqual(paraNumbers([{ text: "1.1.4 Text" }, { text: "1.2 Exclusion" }, { text: "1.2.1 Decision makers must" }], 3)[1], { num: null }, "a sub-heading set as a paragraph");
  assert.equal(paraNumbers([{ text: "2.3.1 The survey found:" }, { text: "58.2% had experienced psychological violence" }], 3)[1], null, "a figure: an unnumbered paragraph");
  assert.deepEqual(paraNumbers([{ text: "3.1.1 Text" }, { text: "3.2 Sur place activities" }, { text: "3.2.1 Text" }], 3)[1], { num: null }, "not taken for 3.1.2 with a part left out");
  assert.deepEqual(paraNumbers([{ text: "3.1.9 Text" }, { text: "3.1 10 There is a shortage" }, { text: "3.1.11 Text" }], 3)[1], { num: null });
  assert.deepEqual(paraNumbers([{ heading: true }, { text: "1.1 The definition of Tabligh" }, { text: "1.2 The first thing to point out" }], 3).slice(1), [{ num: null }, { num: null }],
    "a letter quoted with its own numbering is not the note's");
  assert.deepEqual(read("2.3.1 The survey found:", "58.2% had experienced psychological violence", "23.7% had experienced physical violence", "2.3.2 Text"),
    ["2.3.1", null, null, "2.3.2"], "figures: unnumbered paragraphs of 2.3.1, as before");
  assert.deepEqual(read("16.1.1 Text", "2.86 million Afghans returned", "71.2 million people", "16.1.2 Text"), ["16.1.1", null, null, "16.1.2"]);
  assert.deepEqual(read("7.1.2 Text", "71.3 million people were displaced"), ["7.1.2", null], "a figure whose digits happen to be the next number's is still a figure");
  assert.deepEqual(read("5.1.2 The law says:", "1. In the course of duty", "2020 saw a rise", "28 December 2018"), ["5.1.2", null, null, null]);
  // What a citation does with each: the paragraph's own number, or the section when there is none to give.
  const anchors = [{ at: 0, heading: "1. Assessment" }, { at: 10, para: "1.1.4", lead: "1.1.4" }, { at: 50, para: null, lead: undefined }, { at: 70, para: "1.2.1", lead: "1.2.1" }];
  assert.deepEqual([paraAt(anchors, 40), paraAt(anchors, 55), paraAt(anchors, 60), paraAt(anchors, 75)], ["1.1.4", null, null, "1.2.1"]);
  const A = { text: "x".repeat(100), anchors, sections: [{ at: 0, title: "1. Assessment" }], refs: [], fns: new Map() };
  assert.deepEqual(describePassage(A, 52, 60), { para: null, section: "1. Assessment", sources: [], lead: null, twice: false });
  assert.equal(formatCitation({ title: "T", kind: "CPIN", topic: "critics of the military regime", countryName: "Burma", version: "5.0", ...describePassage(A, 52, 60) }, "tribunal").text,
    "CPIN Burma: Critics of the military regime (v5.0, web version), ‘1. Assessment’");
});

test("a paragraph number the note uses twice is cited with its section", async () => {
  const { usedTwice } = await import("../../prototypes/shared/citation.js");
  // Iran, Kurds and Kurdish political groups (v5.0): section 14's paragraphs are printed 12.2.3 onwards again.
  const twice = usedTwice(["12.2.4", "12.2.5", "14.1.1", "12.2.5", "12.2.9"]);
  assert.deepEqual([...twice], ["12.2.5"]);
  const text = "x".repeat(200);
  const A = { text, twice, refs: [], fns: new Map(),
    anchors: [{ at: 0, heading: "12. Komala" }, { at: 10, para: "12.2.4", lead: "12.2.4" }, { at: 30, para: "12.2.5", lead: "12.2.5" },
      { at: 100, heading: "14. State treatment" }, { at: 110, para: "14.1.1", lead: "14.1.1" }, { at: 130, para: "12.2.5", lead: "12.2.5" }, { at: 160, para: "12.2.9", lead: "12.2.9" }],
    sections: [{ at: 0, title: "12. Komala" }, { at: 100, title: "14. State treatment" }] };
  const first = describePassage(A, 35, 45), second = describePassage(A, 135, 145), once = describePassage(A, 165, 175), across = describePassage(A, 115, 145);
  assert.deepEqual([first.para, first.twice, first.section], ["12.2.5", true, "12. Komala"]);
  assert.deepEqual([second.para, second.twice, second.section], ["12.2.5", true, "14. State treatment"]);
  assert.deepEqual([once.para, once.twice], ["12.2.9", false]);
  assert.equal(across.twice, true, "a range that ends on one");
  const ctx = { title: "T", kind: "CPIN", topic: "Kurds and Kurdish political groups", countryName: "Iran", version: "5.0", month: "2025-10", accessed: ACCESSED };
  const cite = (d, style) => formatCitation({ ...ctx, para: d.para, section: d.section, paraTwice: d.twice }, style).text;
  assert.equal(cite(second, "tribunal"), "CPIN Iran: Kurds and Kurdish political groups (v5.0, Oct 2025, web version) at [12.2.5] (under ‘14. State treatment’)");
  assert.equal(cite(first, "tribunal"), "CPIN Iran: Kurds and Kurdish political groups (v5.0, Oct 2025, web version) at [12.2.5] (under ‘12. Komala’)");
  assert.match(cite(second, "oscola"), / para 12\.2\.5 \(under ‘14\. State treatment’\) accessed /);
  assert.equal(cite(once, "tribunal"), "CPIN Iran: Kurds and Kurdish political groups (v5.0, Oct 2025, web version) at [12.2.9]", "a number used once: as before");
  // A record saved before this was known carries no flag, and is cited as it was.
  assert.equal(formatCitation({ ...ctx, para: "12.2.5", section: "14. State treatment" }, "tribunal").text, "CPIN Iran: Kurds and Kurdish political groups (v5.0, Oct 2025, web version) at [12.2.5]");
});
