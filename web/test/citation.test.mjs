import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  cleanQuote, footnoteNumbers, formatCitation, formatPinpoint, formatSources, italicTitle, longDate, monthLabel,
  paraAt, paraDepth, paraNumber, paraRange, parseNoteTitle, quoteWithCitation, stripFootnoteMarkers, textFragment,
  titleCase,
} from "../../prototypes/shared/citation.js";
import { decodeEntities } from "../../prototypes/shared/redline-diff.js";

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
  assert.equal(cleanQuote(para911),
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
  assert.equal(cleanQuote("  8.2.1 On 20 July\n 2014, Ekhtebar[footnote 4] said"), "On 20 July 2014, Ekhtebar said");
  assert.deepEqual(footnoteNumbers("a[footnote 4] b [footnote 5] c[footnote 4]"), [4, 5]);
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
  assert.equal(longDate("2026-08-25T23:03:57Z"), "25 August 2026");
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
  assert.equal(o.text, `Home Office, Country Policy and Information Note: Military Service, Iran (version 4.0, August 2026) para 9.1.1 <${url}> accessed 2 October 2026.`);
  assert.equal(o.url, url);
  assert.match(o.html, /^Home Office, <i>Country Policy and Information Note: Military Service, Iran<\/i> \(version 4\.0, August 2026\) para 9\.1\.1 &lt;<a href="/);
  assert.match(o.md, /^Home Office, \*Country Policy and Information Note: Military Service, Iran\* /);
  const t = formatCitation(ctx, "tribunal");
  assert.equal(t.text, "CPIN Iran: Military service (v4.0, Aug 2026) at [9.1.1]");
  assert.match(t.html, /^<a href="https:\/\/www\.gov\.uk\/.+#:~:text=.+">CPIN Iran: Military service<\/a> \(v4\.0, Aug 2026\) at \[9\.1\.1\]$/);
  // Ranges, sections, bulletins and archived copies.
  assert.match(formatCitation({ ...ctx, para: "9.1.1–9.1.3" }).text, / paras 9\.1\.1–9\.1\.3 </);
  assert.equal(formatCitation({ ...ctx, para: null, section: "Executive summary" }, "tribunal").text,
    "CPIN Iran: Military service (v4.0, Aug 2026), ‘Executive summary’");
  const b = noteOf("iran", "country-bulletin-iran-security-situation-march-2026-accessible--2");
  assert.equal(formatCitation({ title: b.n.title, kind: b.n.kind, topic: b.n.topic, countryName: "Iran", month: b.n.month, para: "1.2.3" }, "tribunal").text,
    "Country bulletin Iran: Security situation (Mar 2026) at [1.2.3]");
  const arch = formatCitation({ ...ctx, version: "3.0", title: "Country policy and information note: military service, Iran, November 2022 (accessible)",
    archived: true, capturedAt: "2026-08-25T23:03:57Z", url: "https://web.archive.org/web/20260825230357/https://www.gov.uk/x" });
  assert.match(arch.text, /\(version 3\.0, November 2022\) para 9\.1\.1 \(archived copy, Internet Archive, captured 25 August 2026\) <https:\/\/web\.archive\.org\/web\/20260825230357\/https:\/\/www\.gov\.uk\/x#:~:text=/);
});

test("quote + citation and sources for the clipboard", () => {
  const { c, n } = noteOf("iran", MIL);
  const fn12 = plain(milHtml.match(/<li id="fn:12">([\s\S]*?)<\/li>/)[1]).replace(/↩\s*$/, "").trim();
  const sources = [{ n: 12, text: fn12, url: "https://example.org/fn12" }];
  const ctx = { title: n.title, kind: n.kind, topic: n.topic, countryName: c.name, version: n.version, month: n.month,
    para: "9.1.1", url: n.govuk_url, quote: para911, accessed: ACCESSED };
  const out = quoteWithCitation(ctx, "tribunal", sources);
  assert.equal(out.text.split("\n")[0],
    "“Under articles 107 and 110 of the Constitution of the Islamic Republic of Iran, the Supreme Leader has ultimate command of the Armed Forces.” CPIN Iran: Military service (v4.0, Aug 2026) at [9.1.1]");
  assert.match(out.text, /\n\nSources cited in this passage:\n\[12\] /);
  assert.ok(!out.text.includes("[footnote"), "no footnote markers in the quote");
  assert.match(out.html, /^<p>“Under articles 107/);
  assert.match(out.html, /<p>Sources cited in this passage:<\/p><p>\[12\] <a href="https:\/\/example\.org\/fn12">/);
  assert.deepEqual(formatSources([]), { text: "", html: "", md: "" });
});
