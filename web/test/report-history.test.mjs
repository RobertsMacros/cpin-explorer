import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  alignHeadings, archiveCopy, firstSeen, bodyWords, buildTimeline, captionSource, computedSummary, currentPdf, DAY, editionForStop, editionsBetweenNotHeld, editionTime, findParaRefs, findSectionNames, headingKey, headingName, increasing, isRemovalNote, isRewrite, keptPercent, leadingNumber, mapThrough, ownDate, readOnGovuk, reportUrl, resolveParaRef, REWRITE_THRESHOLD, seriesPath, updateKind, versionsNotHeld, wordingKept,
  capturedAt, editionWhere, isArchivedPdf, sourceWords,
} from "../../prototypes/shared/report-history.js";
import { formatCitation, titleMonth } from "../../prototypes/shared/citation.js";

const ed = (id, version, date, extra = {}) => ({ id, version, date, published: date, valid_from: date, body: "<p>x</p>", govuk_change_notes: [], ...extra });

/* ------------------------------------------------------------------ timeline */

test("every held edition is a stop, oldest first, and the newest is the default", () => {
  const tl = buildTimeline({ versions: [ed("a", "1.0", "2022-01-10T00:00:00Z"), ed("b", "2.0", "2024-03-01T00:00:00Z")], history: [] });
  assert.equal(tl.editions.length, 2);
  assert.deepEqual(tl.stops.map((s) => s.kind), ["edition", "edition"]);
  assert.equal(tl.latest, 1);
  assert.deepEqual(tl.stops.map((s) => s.k), [0, 1]);
});

test("an edition answers to every stored copy of its words", () => {
  // The export lists one copy of a text and names the others under also_held_as. A link or a saved highlight
  // made on one of those copies before they were merged must still find the edition.
  const tl = buildTimeline({ versions: [
    ed("a", "1.0", "2022-01-10T00:00:00Z", { also_held_as: [{ id: "a-archived", source: "wayback" }, { id: "a-again", source: "wayback" }] }),
    ed("b", "2.0", "2024-03-01T00:00:00Z"),
  ], history: [] });
  assert.deepEqual(tl.editions[0].ids, ["a", "a-archived", "a-again"]);
  assert.deepEqual(tl.editions[1].ids, ["b"]);
  assert.equal(tl.editions.findIndex((e) => e.ids.includes("a-again")), 0);
});

test("an edition's words were first seen at the earliest of the archive's capture and this site's copy", () => {
  // Iran, Kurds (v5.0): the live text was first captured by the Internet Archive months before this site read it.
  assert.equal(firstSeen({ captured_at: "2025-12-19T23:51:40Z", first_seen: "2026-10-02T12:09:19Z" }), "2025-12-19T23:51:40Z");
  assert.equal(firstSeen({ captured_at: null, first_seen: "2026-10-02T12:09:19Z" }), "2026-10-02T12:09:19Z");
  assert.equal(firstSeen({}), null);
});

test("an edition's archive copy is its own, else the latest held of the same words", () => {
  const own = { archive_url: "https://web.archive.org/web/20240406123856/https://www.gov.uk/x", captured_at: "2024-04-06T12:35:17Z" };
  assert.deepEqual(archiveCopy(own), own);
  // Copied from GOV.UK and since replaced: the archive's copies of the same words are named under also_held_as.
  const replaced = { source: "live", current: false, archive_url: null, also_held_as: [
    { id: "p", source: "wayback", captured_at: "2024-01-02T00:00:00Z", archive_url: "https://web.archive.org/web/20240102000000/https://www.gov.uk/x" },
    { id: "q", source: "wayback", captured_at: "2025-03-04T00:00:00Z", archive_url: "https://web.archive.org/web/20250304000000/https://www.gov.uk/x" },
    { id: "r", source: "live" }] };
  assert.deepEqual(archiveCopy(replaced), { archive_url: "https://web.archive.org/web/20250304000000/https://www.gov.uk/x", captured_at: "2025-03-04T00:00:00Z" });
  assert.equal(archiveCopy({ source: "live", also_held_as: [{ id: "r", source: "live" }] }), null);
  assert.equal(archiveCopy({}), null);
  assert.equal(archiveCopy(undefined), null);
});

test("an edition recovered as a PDF from the Internet Archive is both: from the PDF, and an archived copy", () => {
  // Palestine, security and humanitarian situation in Gaza, March 2019: GOV.UK lists the file no longer, and its own
  // address for it now leads to a later edition. The Archive's copy is the source, with the time in its address.
  const archive = "https://web.archive.org/web/20190726161037/https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/784644/OPTs_v2.0_March_2019.pdf";
  const recovered = { source: "pdf", listed: false, current: false, govuk_url: null, archive_url: archive, pdf_url: archive, captured_at: "2019-07-26T16:10:37Z" };
  assert.equal(isArchivedPdf(recovered), true);
  assert.deepEqual(editionWhere(recovered, { gone: false, fallback: "https://www.gov.uk/report" }),
    { url: archive, archived: true, capturedAt: "2019-07-26T16:10:37Z", pdf: true });
  assert.equal(sourceWords(recovered), "text from the PDF · archived copy");
  assert.equal(capturedAt({ archive_url: archive, captured_at: "2019-07-26T16:10:39Z" }), "2019-07-26T16:10:37Z", "the time in the address, so date and link agree");
  assert.equal(capturedAt({ captured_at: "2019-07-26T16:10:39Z" }), "2019-07-26T16:10:39Z");
  assert.equal(capturedAt({}), null);
  // A PDF GOV.UK lists now is read from GOV.UK's file, even where the Archive holds a copy of the same words.
  const pdfUrl = "https://assets.publishing.service.gov.uk/media/6abf/PSE_CPIN.pdf";
  const listed = { source: "pdf", listed: true, current: true, pdf_url: pdfUrl, archive_url: null,
    also_held_as: [{ id: "c", source: "pdf", captured_at: "2026-10-02T11:03:33Z", archive_url: "https://web.archive.org/web/20261002110333/" + pdfUrl }] };
  assert.equal(isArchivedPdf(listed), false);
  assert.deepEqual(editionWhere(listed), { url: pdfUrl, archived: false, capturedAt: null, pdf: true });
  assert.equal(sourceWords(listed), "text from the PDF");
  // Web versions, as before: GOV.UK while it is the edition there, else the archive copy, else the report's address.
  const live = { source: "live", current: true, govuk_url: "https://www.gov.uk/note" };
  assert.deepEqual(editionWhere(live), { url: "https://www.gov.uk/note", archived: false, capturedAt: null });
  assert.equal(sourceWords(live), "");
  const web = { source: "wayback", archive_url: "https://web.archive.org/web/20240406123856/https://www.gov.uk/x", captured_at: "2024-04-06T12:38:56Z" };
  assert.deepEqual(editionWhere(web), { url: web.archive_url, archived: true, capturedAt: "2024-04-06T12:38:56Z" });
  assert.equal(sourceWords(web), "archived copy");
  assert.deepEqual(editionWhere({ ...live, archive_url: web.archive_url }, { gone: true }), { url: web.archive_url, archived: true, capturedAt: "2024-04-06T12:38:56Z" },
    "a report no longer on GOV.UK is read at its archive copy");
  assert.deepEqual(editionWhere({ source: "live", current: false }, { fallback: "https://www.gov.uk/report" }), { url: "https://www.gov.uk/report", archived: false, capturedAt: null });
});

test("the latest is the edition now on GOV.UK, which is not always the last in date order", () => {
  // GOV.UK put the note back to its earlier text: v1.0 is in force again, and v2.0 is history.
  const reverted = buildTimeline({ versions: [ed("a", "1.0", "2022-01-10T00:00:00Z", { current: true }), ed("b", "2.0", "2024-03-01T00:00:00Z", { current: false })], history: [] });
  assert.equal(reverted.latest, 0);
  assert.deepEqual(reverted.stops.map((s) => s.id), ["a", "b"], "the timeline stays in date order");
  assert.equal(editionForStop(null, reverted), 0, "the default view is the edition in force");
  // The usual case, and a report no longer on GOV.UK (nothing is current): the last edition held.
  assert.equal(buildTimeline({ versions: [ed("a", "1.0", "2022-01-10T00:00:00Z", { current: false }), ed("b", "2.0", "2024-03-01T00:00:00Z", { current: true })], history: [] }).latest, 1);
  assert.equal(buildTimeline({ versions: [ed("a", "1.0", "2022-01-10T00:00:00Z", { current: false }), ed("b", "2.0", "2024-03-01T00:00:00Z", { current: false })], history: [] }).latest, 1);
  // An edition with no text here (a PDF only) is not a stop, so it cannot be the latest shown.
  assert.equal(buildTimeline({ versions: [ed("a", "1.0", "2022-01-10T00:00:00Z"), { id: "pdf", version: "2.0", date: "2023-01-01T00:00:00Z", current: true }], history: [] }).latest, 0);
});

test("editions without a body are not held", () => {
  const tl = buildTimeline({ versions: [ed("a", "1.0", "2022-01-10T00:00:00Z"), { id: "pdf", version: "2.0", date: "2023-01-01T00:00:00Z" }], history: [] });
  assert.equal(tl.editions.length, 1);
});

test("GOV.UK change notes an edition lists are not repeated as separate updates", () => {
  const note = { date: "2025-01-17T09:10:19Z", note: "Published 'Country policy and information note: actors of protection'." };
  const tl = buildTimeline({
    versions: [ed("a", "1.0", "2025-01-11T00:00:00Z", { govuk_change_notes: [note] }), ed("b", "1.0", "2025-01-11T00:00:00Z", { govuk_change_notes: [note] })],
    history: [note],
  });
  assert.equal(tl.events.length, 0);
});

test("a change note dated just after an edition took effect belongs to it (Afghanistan v6.0)", () => {
  // v6.0: valid from 24 Feb 2026, GOV.UK date 15 May 2026, no change notes of its own.
  const v6 = ed("f", "6.0", "2026-05-15T13:10:54Z", { valid_from: "2026-02-24T00:00:00Z" });
  const tl = buildTimeline({ versions: [ed("e", "5.0", "2025-08-05T00:00:00Z"), v6],
    history: [{ date: "2026-02-26T15:48:09Z", note: "Updated to version 6.0." }] });
  assert.equal(tl.events.length, 0);
  assert.deepEqual(tl.editions[1].notes, [{ date: "2026-02-26T15:48:09Z", note: "Updated to version 6.0." }]);
});

test("a single-edition report gets its GOV.UK history as dated updates to step through (Sri Lanka)", () => {
  const history = [
    { date: "2025-09-02T12:59:22Z", note: "Published the note, August 2025." },
    { date: "2023-04-14T15:34:54Z", note: "The guidance has been updated in section 5.4." },
    { date: "2022-09-22T08:17:34Z", note: "Updated the note on Tamil separatism." },
  ];
  const tl = buildTimeline({ versions: [ed("z", "9.0", "2025-09-02T12:59:22Z", { valid_from: "2025-08-21T00:00:00Z", govuk_change_notes: [history[0]] })], history });
  assert.deepEqual(tl.stops.map((s) => s.kind), ["update", "update", "edition"]);
  assert.deepEqual(tl.events.map((e) => e.date.slice(0, 10)), ["2022-09-22", "2023-04-14"]);
  assert.equal(tl.events[0].inForce, null);                       // before anything held
  assert.equal(editionForStop(tl.events[0], tl), 0);              // so the earliest held edition is shown
  assert.equal(editionForStop(tl.stops[2], tl), 0);
});

test("an update after a held edition points at the edition then in force", () => {
  const tl = buildTimeline({
    versions: [ed("a", "1.0", "2020-01-01T00:00:00Z", { govuk_change_notes: [{ date: "2020-01-02T00:00:00Z", note: "Published." }] }), ed("b", "3.0", "2024-01-01T00:00:00Z")],
    history: [{ date: "2022-06-01T00:00:00Z", note: "Version 2.0 published." }],
  });
  assert.equal(tl.events.length, 1);
  assert.equal(tl.events[0].inForce, 0);
  assert.deepEqual(tl.stops.map((s) => s.kind), ["edition", "update", "edition"]);
});

test("an edition and an update on the same instant: the edition comes first", () => {
  const tl = buildTimeline({
    versions: [ed("a", "1.0", "2020-01-01T00:00:00Z", { govuk_change_notes: [{ date: "2019-01-01T00:00:00Z", note: "Old." }] })],
    history: [{ date: "2020-01-01T00:00:00Z", note: "Something else entirely, a year later than its own note." }],
  });
  // Within the window but the edition already has a note of its own: a separate update.
  assert.deepEqual(tl.stops.map((s) => s.kind), ["edition", "update"]);
});

test("versions missing between two held editions are named", () => {
  assert.equal(versionsNotHeld("4.0", "6.0"), "v5.0 not held");
  assert.equal(versionsNotHeld("1.0", "1.3"), "v1.1, v1.2 not held");
  assert.equal(versionsNotHeld("1.0", "6.0"), "v2.0–v5.0 not held");
  assert.equal(versionsNotHeld("4.0", "4.0"), "");
  assert.equal(versionsNotHeld(undefined, "2.0"), "earlier editions not held");
  assert.equal(versionsNotHeld(undefined, "1.0"), "");
  assert.equal(versionsNotHeld("x", "2.0"), "");
});

/* ------------------------------------------------------------------ captions */

test("the Home Office's statement comes first, then GOV.UK's change notes", () => {
  const withStatement = { v: { change_statement: "Updated COI.", change_statement_html: "<p>Updated COI.</p>" }, notes: [{ date: "2024-01-01", note: "x" }] };
  assert.equal(captionSource(withStatement).kind, "home-office");
  assert.equal(captionSource(withStatement).html, "<p>Updated COI.</p>");
  assert.equal(captionSource({ v: {}, notes: [{ date: "2024-01-01", note: "Published." }] }).kind, "govuk");
  assert.equal(captionSource({ v: {}, notes: [] }), null);
});

test("the computed line ranks sections by changes and leaves back matter out", () => {
  const sum = {
    stats: { changes: 9, ins: 120, del: 30, noteChanges: 2 },
    toc: [
      { text: "Assessment", level: 2, count: 2, st: "eq", id: "assessment" },
      { text: "Westernisation", level: 3, count: 5, st: "mod", id: "west" },
      { text: "Removed section", level: 3, count: 4, st: "del", id: "gone" },
      { text: "Bibliography", level: 2, count: 9, st: "mod", id: "bib" },
      { text: "Sources cited", level: 3, count: 7, st: "mod", id: "src" },
    ],
  };
  const c = computedSummary(sum);
  assert.deepEqual(c.secs.map((s) => s.text), ["Westernisation", "Assessment"]);
  assert.equal(c.secs[0].id, "west");
  assert.equal(c.ins, 120);
  assert.equal(c.noteChanges, 2);
  assert.equal(computedSummary(null), null);
});

/* ------------------------------------------------------------------ section and paragraph references */

test("references in Home Office change statements are found number by number", () => {
  const s = "Additional country information relating to non-practising Muslims and ‘Westernisation’ (sections 13.4, and 16.3 to 16.5). Minor changes to the assessment.";
  const refs = findParaRefs(s);
  assert.deepEqual(refs.map((r) => r.num), ["13.4", "16.3", "16.5"]);
  assert.ok(refs.every((r) => r.kind === "section"));
  assert.deepEqual(refs.map((r) => s.slice(r.start, r.end)), ["13.4", "16.3", "16.5"]);
});

test("paragraph references, single sections and stray numbers", () => {
  assert.deepEqual(findParaRefs("Added paragraphs 7.3.2 and 7.3.3.").map((r) => [r.num, r.kind]), [["7.3.2", "paragraph"], ["7.3.3", "paragraph"]]);
  assert.deepEqual(findParaRefs("Inclusion of AH (Sufficiency of Protection) at paragraph 2.1.2.").map((r) => r.num), ["2.1.2"]);
  assert.deepEqual(findParaRefs("Updated sections 1.4 and 6 in the note on human trafficking.").map((r) => r.num), ["1.4", "6"]);
  assert.deepEqual(findParaRefs("The guidance has been updated in section 5.4 to reflect the fact that").map((r) => r.num), ["5.4"]);
  assert.deepEqual(findParaRefs("See para. 3.1.4 and §2.2").map((r) => r.num), ["3.1.4", "2.2"]);
  assert.deepEqual(findParaRefs("Version 6.0, February 2026. “15c” generally met in 2025."), []);
  assert.deepEqual(findParaRefs("Crosssections 4.1 are not references"), []);
});

test("leading numbers of paragraphs and headings", () => {
  assert.equal(leadingNumber("13.4.1 The Taliban…"), "13.4.1");
  assert.equal(leadingNumber("  2.1 Text"), "2.1");
  assert.equal(leadingNumber("13. Westernisation"), null);
  assert.equal(leadingNumber("13. Westernisation", { heading: true }), "13");
  assert.equal(leadingNumber("13.4 Non-practicing Muslims", { heading: true }), "13.4");
  assert.equal(leadingNumber("Executive summary", { heading: true }), null);
  assert.equal(leadingNumber("2024 was a year"), null);
});

const targets = [
  { num: "13", kind: "h" }, { num: "13.3", kind: "h" }, { num: "13.3.1", kind: "p" },
  { num: "13.4", kind: "h" }, { num: "13.4.1", kind: "p" }, { num: "13.4.2", kind: "p" },
  { num: "13.5", kind: "h" }, { num: "13.5.1", kind: "p" },
  { num: "7.3.2", kind: "p" }, { num: "16.3.1", kind: "p" }, { num: "16.3.2", kind: "p" }, { num: "16.4.1", kind: "p" },
];

test("a section reference goes to its heading and covers its paragraphs", () => {
  const r = resolveParaRef("13.4", "section", targets);
  assert.equal(r.index, 3);
  assert.deepEqual(r.members, [3, 4, 5]);
});

test("a section without a heading goes to its first paragraph", () => {
  const r = resolveParaRef("16.3", "section", targets);
  assert.equal(r.index, 9);
  assert.deepEqual(r.members, [9, 10]);
});

test("a paragraph reference goes to the paragraph", () => {
  assert.deepEqual(resolveParaRef("7.3.2", "paragraph", targets), { index: 8, members: [8] });
  assert.equal(resolveParaRef("9.9", "section", targets), null);
  assert.equal(resolveParaRef("13.4", "section", []), null);
});

/* ------------------------------------------------------------------ addresses */

test("report addresses keep the series readable and add only what differs from the default", () => {
  assert.equal(reportUrl({ country: "colombia", series: "note:actors-protection" }), "index.html?country=colombia&series=note:actors-protection");
  assert.equal(reportUrl({ country: "afghanistan", series: "note:fear-taliban", edition: "52ed2020075a8bae", changes: true, view: "sbs", from: "4edf63b96befb378", q: "internal relocation" }, "#h=abc"),
    "index.html?country=afghanistan&series=note:fear-taliban&edition=52ed2020075a8bae&changes=1&from=4edf63b96befb378&view=sbs&q=internal%20relocation#h=abc");
  assert.equal(reportUrl({ country: "x", series: "s", view: "sbs" }), "index.html?country=x&series=s");
  assert.equal(seriesPath("sudan", "note:security-situation"), "../data/series/sudan/note--security-situation.json");
});

test("timeline gaps: DAY is a day", () => { assert.equal(DAY, 24 * 3600 * 1000); });

/* ------------------------------------------------------------------ rewrites */

test("words for the rewrite measure ignore markup, case and punctuation (as the export does)", () => {
  // The same example as tests/test_export.py, so the browser and the export agree.
  assert.deepEqual(bodyWords("<p>The <b>State</b> is “willing”&nbsp;and able.</p><!-- x --><td>A</td><td>B</td>"),
    ["the", "state", "is", "willing", "and", "able", "a", "b"]);
  assert.deepEqual(bodyWords("<p>R&amp;D &#8217;n&#x2019; 2.0</p>"), ["r", "d", "n", "2", "0"]);
});

test("wording kept is five-word phrases in common over the larger edition", () => {
  const ten = "<p>one two three four five six seven eight nine ten</p>";
  assert.equal(wordingKept(ten, "<p>One two three four five, six seven eight nine ten.</p>"), 1);
  assert.equal(wordingKept(ten, "<p>one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen</p>"), 0.5);
  assert.equal(wordingKept(ten, "<p>an entirely different text about other things</p>"), 0);
  assert.equal(wordingKept("", ""), 1);
});

test("an edition is a rewrite below the threshold, worded as a rounded share", () => {
  assert.equal(REWRITE_THRESHOLD, 0.25);
  assert.equal(isRewrite(0.047), true);
  assert.equal(isRewrite(0.25), false);
  assert.equal(isRewrite(null), false);
  assert.equal(isRewrite(undefined), false);
  assert.equal(keptPercent(0.047), "about 5%");
  assert.equal(keptPercent(0.004), "less than 1%");
  assert.equal(keptPercent(0), "about 0%");
});

test("editions in between are not held when the version skips or GOV.UK updates fall between", () => {
  const skip = buildTimeline({ versions: [ed("a", "3.0", "2019-01-01T00:00:00Z"), ed("b", "7.0", "2024-01-01T00:00:00Z")], history: [] });
  assert.equal(editionsBetweenNotHeld(skip, 1), true);
  const next = buildTimeline({ versions: [ed("a", "1.0", "2020-11-11T00:00:00Z"), ed("b", "2.0", "2025-11-19T00:00:00Z")], history: [] });
  assert.equal(editionsBetweenNotHeld(next, 1), false);
  assert.equal(editionsBetweenNotHeld(next, 0), false);
  const updates = buildTimeline({ versions: [ed("a", "1.0", "2020-11-11T00:00:00Z"), ed("b", "2.0", "2025-11-19T00:00:00Z")],
    history: [{ date: "2023-03-01T10:00:00Z", note: "Updated the note." }] });
  assert.equal(editionsBetweenNotHeld(updates, 1), true);
  // Sudan v3.0: valid from July, on a page GOV.UK dated September. It sits at its own date, so GOV.UK's July note
  // about it follows it on the timeline (with v3.0 in force): it is about v3.0 itself, not an edition in between.
  const own = buildTimeline({ versions: [ed("a", "2.0", "2025-01-16T00:00:00Z"),
    ed("b", "3.0", "2026-09-07T00:00:00Z", { valid_from: "2026-07-01T00:00:00Z", govuk_change_notes: [{ date: "2026-09-07T10:00:00Z", note: "Updated." }] })],
  history: [{ date: "2026-07-23T10:00:00Z", note: "Published an updated version." }] });
  assert.deepEqual(own.stops.map((s) => s.kind), ["edition", "edition", "update"]);
  assert.equal(own.events[0].inForce, 1);
  assert.equal(editionsBetweenNotHeld(own, 1), false);
});

test("headings match across editions whatever their numbering, and sections line up in order", () => {
  assert.equal(headingKey("9. Judiciary"), "judiciary");
  assert.equal(headingKey("  8.2  Judiciary: "), "judiciary");
  assert.equal(headingKey("Annex A: sources"), "annex a sources");
  const oldKeys = ["preface", "assessment", "country information", "judiciary", "police", "bibliography"].map(headingKey);
  const newKeys = ["Executive summary", "Assessment", "1. Police", "2. Judiciary", "", "Bibliography"].map(headingKey);
  // Police and judiciary swapped places: only one of them can stay in order; the rest line up.
  const pairs = alignHeadings(oldKeys, newKeys);
  const matched = pairs.map(([i, j]) => { assert.equal(oldKeys[i], newKeys[j]); return oldKeys[i]; });
  assert.equal(matched.length, 3);
  assert.deepEqual([matched[0], matched[2]], ["assessment", "bibliography"]);
  assert.ok(["police", "judiciary"].includes(matched[1]));
  for (let k = 1; k < pairs.length; k++) assert.ok(pairs[k][0] > pairs[k - 1][0] && pairs[k][1] > pairs[k - 1][1]);
  assert.deepEqual(alignHeadings(["", "a"], ["", "b"]), []);
  assert.deepEqual(alignHeadings([], ["a"]), []);
});

test("linked scrolling goes through the shared headings and moves in proportion between them", () => {
  // Shared headings at 1000/400 and 3000/2400; the texts end (less a screen) at 5000 and 2600.
  const pts = increasing([[0, 0], [1000, 400], [3000, 2400], [2500, 9999], [5000, 2600]]);
  assert.deepEqual(pts, [[0, 0], [1000, 400], [3000, 2400], [5000, 2600]]);       // one that goes backwards is dropped
  assert.equal(mapThrough(pts, -50), 0);
  assert.equal(mapThrough(pts, 500), 200);
  assert.equal(mapThrough(pts, 1000), 400);
  assert.equal(mapThrough(pts, 2000), 1400);
  assert.equal(mapThrough(pts, 4000), 2500);
  assert.equal(mapThrough(pts, 99999), 2600);
  // The way back (which page position shows a given place in the other text) is the same map, flipped.
  const back = increasing(pts.map(([x, y]) => [y, x]));
  assert.equal(mapThrough(back, 1400), 2000);
  assert.equal(mapThrough([], 10), 0);
});

test("an update says why it has no text: a PDF only, a removal, or simply not held", () => {
  const series = { current_pdf_only: true, pdf_editions: [{ title: "Humanitarian situation, September 2026", month: "2026-09", pdf_url: "https://assets/x.pdf", current: true }],
    versions: [{ id: "a", body: "<p>x</p>", version: "4.0", published: "2024-11-13T00:00:00Z", date: "2024-11-13T00:00:00Z" }],
    history: [
      { date: "2026-10-02T09:02:41Z", note: "Information about the humanitarian situation in Gaza has been updated to version 5.0.", pdf_url: "https://assets/x.pdf", pdf_title: "Humanitarian situation, September 2026" },
      { date: "2023-10-31T13:15:26Z", note: "Information about the humanitarian situation in Gaza has been removed as it no longer accurately reflects the current situation." },
      { date: "2022-07-26T14:43:12Z", note: "The humanitarian situation in Gaza version 3.0 added." },
    ] };
  const tl = buildTimeline(series);
  assert.deepEqual(tl.stops.map((s) => (s.kind === "edition" ? "edition" : updateKind(s))), ["not-held", "removed", "edition", "pdf"]);
  assert.deepEqual(tl.stops.at(-1).pdf, { url: "https://assets/x.pdf", title: "Humanitarian situation, September 2026" });
  assert.equal(currentPdf(series).month, "2026-09");
  assert.equal(currentPdf({ current_pdf_only: false, pdf_editions: [{ current: false }] }), null);
  assert.equal(currentPdf({}), null);
});

test("a note tied to a PDF-only edition is never folded into the edition held, however close in date", () => {
  const v = { id: "a", body: "<p>x</p>", version: "3.0", published: "2022-05-01T00:00:00Z", date: "2022-05-01T00:00:00Z" };
  const plain = buildTimeline({ versions: [v], history: [{ date: "2022-05-10T00:00:00Z", note: "Updated." }] });
  assert.equal(plain.events.length, 0, "an ordinary note within the window is the held edition's own");
  const pdf = buildTimeline({ versions: [v], history: [{ date: "2022-05-10T00:00:00Z", note: "Updated (pdf).", pdf_url: "https://assets/y.pdf" }] });
  assert.equal(pdf.events.length, 1);
  assert.equal(updateKind(pdf.events[0]), "pdf");
});

test("a removal is only what the note itself calls one", () => {
  for (const note of [
    "Information about the humanitarian situation in Gaza has been removed as it no longer accurately reflects the current situation.",
    "Removed the following country policy and information notes: ‘Women fearing domestic violence’ and ‘Illegal drugs’.",
    "The note has been withdrawn.",
  ]) assert.equal(isRemovalNote(note), true, note);
  for (const note of [
    "Removed the 2019 note and added a new version.",
    "Published the country bulletin. This replaces the country policy and information note, which has been removed.",
    "Updated to remove section 4.",
    "Version 3.0 added.",
    "Accessible version added; PDF removed.",
    "",
  ]) assert.equal(isRemovalNote(note), false, note);
});

test("sections named in a change statement are found, and only whole names", () => {
  const headings = [
    { text: "Executive summary", level: 2 }, { text: "Assessment", level: 2 }, { text: "About the assessment", level: 3 },
    { text: "1. Points to note", level: 3 }, { text: "Country information", level: 2 }, { text: "About the country information", level: 3 },
    { text: "3. Legal framework", level: 3 }, { text: "General", level: 3 }, { text: "Bibliography", level: 2 }, { text: "Version control and feedback", level: 2 },
  ];
  const text = "Updated country information and assessment. After 21 September 2025, ‘Occupied Palestinian Territories (OPTs)’ changed to ‘Palestine’ and points to note updated.";
  const found = findSectionNames(text, headings);
  assert.deepEqual(found.map((f) => [text.slice(f.start, f.end), f.heading]), [
    ["country information", "Country information"], ["assessment", "Assessment"], ["points to note", "1. Points to note"]]);
  const names = (t) => findSectionNames(t, headings).map((f) => f.heading);
  assert.deepEqual(names("Reassessment of the risk; assessments unchanged"), ["Assessment"], "whole words only; a plural is the same name");
  assert.deepEqual(names("Updated the legal frameworks and Executive Summary"), ["3. Legal framework", "Executive summary"]);
  assert.deepEqual(names("General tidying and an updated bibliography; version control and feedback moved"), [], "plain words and back matter are never linked");
  assert.deepEqual(names("About the country information: clarified"), ["About the country information"], "the longest name wins where two overlap");
  assert.deepEqual(findSectionNames("Updated assessment", []), []);
  assert.deepEqual(findSectionNames("", headings), []);
});

test("of two headings with one name the higher level wins; numbers are not part of a name", () => {
  const found = findSectionNames("Protection updated", [{ text: "5.2 Protection", level: 4 }, { text: "2. Protection", level: 3 }]);
  assert.deepEqual(found.map((f) => f.heading), ["2. Protection"]);
  assert.equal(headingName("  12.3   Freedom of  movement "), "Freedom of movement");
  assert.equal(headingName("Assessment"), "Assessment");
});


// --- when an edition left GOV.UK, where this copy saw it go ---
test("an edition replaced or withdrawn on our watch says when, and between which two checks", async () => {
  const { leftGovuk } = await import("../../prototypes/shared/report-history.js");
  const fmt = (iso) => iso.slice(0, 10);
  assert.equal(leftGovuk(null, fmt), null);
  assert.equal(leftGovuk({ at: null }, fmt), null, "an archive copy has no such date");
  const replaced = leftGovuk({ at: "2026-10-14T06:17:00Z", last_seen: "2026-10-13T06:17:00Z", how: "replaced" }, fmt);
  assert.deepEqual([replaced.how, replaced.when, replaced.label], ["replaced", "2026-10-14", "Archived 2026-10-14"]);
  assert.equal(replaced.sentence, "GOV.UK replaced it with a newer edition between 2026-10-13 (last seen there) and 2026-10-14 (found replaced).");
  const gone = leftGovuk({ at: "2026-10-14T06:17:00Z", last_seen: "2026-10-14T01:00:00Z", how: "withdrawn" }, fmt);
  assert.equal(gone.sentence, "GOV.UK withdrew it by 2026-10-14 (found gone).", "seen and found gone on one day: no window to give");
  assert.equal(leftGovuk({ at: "2026-10-14T06:17:00Z", how: "withdrawn" }, fmt).label, "Archived 2026-10-14");
});

/* ------------------------------------------------------------------ an edition's own date */

const seriesFile = (path) => JSON.parse(readFileSync(new URL(`../../prototypes/data/series/${path}.json`, import.meta.url), "utf8"));
test("an edition is dated by the note itself, never by GOV.UK's date for the country page", () => {
  // China, medical treatment and healthcare: valid from 5 July 2022. GOV.UK dates it 1 September 2026, the day the
  // country PAGE last changed. (Asserted as a property of the edition: the stored dates may move with the export.)
  const china = seriesFile("china/note--healthcare-medical"), about = { topic: china.topic, countryName: china.country_name };
  const live = china.versions.find((v) => v.current);
  assert.equal(live.valid_from, "2022-07-05T00:00:00Z");
  assert.deepEqual(ownDate(live, about), { date: "2022-07-05T00:00:00Z", precision: "day", from: "valid from" });
  const tl = buildTimeline(china), E = tl.editions[tl.latest];
  assert.deepEqual([E.own.date, E.prec, new Date(E.t).toISOString()], ["2022-07-05T00:00:00Z", "day", "2022-07-05T00:00:00.000Z"]);
  assert.ok(tl.editions.every((e, i) => !i || e.t >= tl.editions[i - 1].t), "the editions keep their order");
  // The export as it was (the page's date given as `published`) and as it is being changed (the note's own date as
  // `published`, `published_from` saying which, the page's date apart as `page_updated`): the same answer from both.
  const base = { id: "x", body: "<p>x</p>", title: "Country policy and information note: medical treatment and healthcare, China, July 2022 (accessible)", valid_from: "2022-07-05T00:00:00Z" };
  const before = { ...base, published: "2026-09-01T14:41:42Z", published_precision: "day", date: "2026-09-01T14:41:42Z", captured_at: "2025-11-16T15:56:51Z" };
  const after = { ...base, published: "2022-07-05T00:00:00Z", published_precision: "day", published_from: "valid from", page_updated: "2026-09-01T14:41:42Z", date: "2022-07-05T00:00:00Z" };
  for (const v of [before, after]) {
    assert.deepEqual(ownDate(v, about), { date: "2022-07-05T00:00:00Z", precision: "day", from: "valid from" });
    assert.equal(editionTime(v, about), Date.parse("2022-07-05T00:00:00Z"));
  }
  // No "valid from": the month in the title, to the month; neither: no date of its own, and it sits where it was first captured.
  const titled = { ...base, valid_from: null, published: "2026-09-01T14:41:42Z", date: "2026-09-01T14:41:42Z" };
  assert.deepEqual(ownDate(titled, about), { date: "2022-07-01T00:00:00Z", precision: "month", from: "title" });
  assert.deepEqual(ownDate({ ...titled, published: "2022-07-01T00:00:00Z", published_precision: "month", published_from: "title" }, about), { date: "2022-07-01T00:00:00Z", precision: "month", from: "title" });
  assert.equal(buildTimeline({ topic: about.topic, country_name: "China", versions: [titled], history: [] }).editions[0].prec, "month");
  const bare = { id: "y", body: "<p>x</p>", title: "country-bulletin-untitled", valid_from: null, published: "2026-08-26T14:14:12Z", date: "2026-08-26T14:14:12Z", captured_at: "2026-04-29T08:44:01Z", first_seen: "2026-10-02T12:09:19Z" };
  assert.equal(ownDate(bare), null);
  assert.equal(ownDate({ ...bare, published: null, published_precision: null, published_from: null, page_updated: "2026-08-26T14:14:12Z", date: "2026-04-29T08:44:01Z" }), null);
  assert.equal(editionTime(bare), Date.parse("2026-04-29T08:44:01Z"));
  // A note that misstates its own date does not jump the queue: the editions stay in the order they were published.
  const odd = buildTimeline({ versions: [ed("a", "1.0", "2024-03-01T00:00:00Z"), ed("b", "2.0", "2023-01-01T00:00:00Z")], history: [] });
  assert.deepEqual(odd.stops.map((s) => s.id), ["a", "b"]);
});

test("a citation's month is the month in the title, else the note's own date: never the page's", () => {
  // Iran, protests of December 2025 to January 2026: no edition month in the title (those months are the topic), valid
  // from 4 February 2026, on a page GOV.UK dated 26 August 2026. It was cited "(August 2026, web version)".
  const iran = seriesFile("iran/bulletin--2025-2026-december-january-protests"), about = { topic: iran.topic, countryName: iran.country_name };
  const v = iran.versions.find((x) => x.current);
  assert.equal(v.valid_from, "2026-02-04T00:00:00Z");
  assert.equal(titleMonth({ title: v.title, ...about }), null);
  const E = buildTimeline(iran).editions.at(-1);
  const month = titleMonth({ title: v.title, ...about }) || E.own?.date.slice(0, 7) || null;         // reader.js: monthOf
  assert.equal(month, "2026-02");
  const ctx = { title: v.title, kind: iran.kind, topic: iran.topic, countryName: iran.country_name, version: v.version, month, para: "1.1.1" };
  assert.equal(formatCitation(ctx, "tribunal").text, "Country bulletin Iran: Protests of December 2025 to January 2026 (Feb 2026, web version) at [1.1.1]");
  assert.match(formatCitation({ ...ctx, accessed: new Date(2026, 9, 4) }).text, /\(February 2026, web version\) para 1\.1\.1 accessed 4 October 2026\.$/);
  // A title with its month is cited by that month, whatever the dates say.
  assert.equal(titleMonth({ title: "Country policy and information note: Kurds, Turkey, July 2025 (accessible)", topic: "Kurds", countryName: "Turkey" }), "2025-07");
  assert.equal(titleMonth({ title: "Country bulletin Iran: security situation, March 2026 (accessible)", topic: "security situation", countryName: "Iran" }), "2026-03");
  assert.equal(titleMonth({ title: null }), null);
});

test("the live edition's words: when they were read on GOV.UK, not the time of the last check of any kind", () => {
  const fmt = (iso) => iso.slice(0, 16).replace("T", " ");
  // Only when this copy first read the text is known: say that, and report the check as a check.
  const first = readOnGovuk({ first_seen: "2026-10-02T12:09:19Z" }, "2026-10-02T16:11:59Z", fmt);
  assert.deepEqual([first.how, first.when], ["read", "2026-10-02 12:09"]);
  assert.equal(first.check, "GOV.UK was last checked for changes on 2026-10-02 16:11. A check compares the dates GOV.UK gives each country page: it does not read every note again each time.");
  assert.ok(!first.when.includes("16:11"), "the last check's time is never given as when the words were read");
  // Where the export says when the note was last read live, that is the better answer.
  const last = readOnGovuk({ first_seen: "2026-10-02T12:09:19Z", last_seen: "2026-10-09T03:00:00Z" }, "2026-10-10T16:00:00Z", fmt);
  assert.deepEqual([last.how, last.when], ["last read", "2026-10-09 03:00"]);
  // Nothing known: nothing claimed.
  assert.deepEqual(readOnGovuk({}, null, fmt), { how: "", when: "", check: "" });
  assert.deepEqual(readOnGovuk(null, undefined, fmt), { how: "", when: "", check: "" });
});
