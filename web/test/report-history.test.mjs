import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alignHeadings, bodyWords, buildTimeline, captionSource, computedSummary, DAY, dwellFor, editionForStop, editionsBetweenNotHeld, findParaRefs,
  headingKey, increasing, isRewrite, keptPercent, leadingNumber, mapThrough, reportUrl, resolveParaRef, REWRITE_THRESHOLD, seriesPath, versionsNotHeld, wordingKept,
} from "../../prototypes/shared/report-history.js";

const ed = (id, version, date, extra = {}) => ({ id, version, date, published: date, valid_from: date, body: "<p>x</p>", govuk_change_notes: [], ...extra });

/* ------------------------------------------------------------------ timeline */

test("every held edition is a stop, oldest first, and the newest is the default", () => {
  const tl = buildTimeline({ versions: [ed("a", "1.0", "2022-01-10T00:00:00Z"), ed("b", "2.0", "2024-03-01T00:00:00Z")], history: [] });
  assert.equal(tl.editions.length, 2);
  assert.deepEqual(tl.stops.map((s) => s.kind), ["edition", "edition"]);
  assert.equal(tl.latest, 1);
  assert.deepEqual(tl.stops.map((s) => s.k), [0, 1]);
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

test("a single-edition report gets its GOV.UK history as dated, playable updates (Sri Lanka)", () => {
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

test("Play lingers longer on longer captions, within bounds", () => {
  assert.equal(dwellFor(0), 2500);
  assert.ok(dwellFor(200) > dwellFor(40));
  assert.equal(dwellFor(10000), 5500);
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
  // Sudan v3.0: in force from July, dated September; GOV.UK's July note about it sits between v2.0 and v3.0 on
  // the timeline but is about v3.0 itself, not an edition in between.
  const own = buildTimeline({ versions: [ed("a", "2.0", "2025-01-16T00:00:00Z"),
    ed("b", "3.0", "2026-09-07T00:00:00Z", { valid_from: "2026-07-01T00:00:00Z", govuk_change_notes: [{ date: "2026-09-07T10:00:00Z", note: "Updated." }] })],
  history: [{ date: "2026-07-23T10:00:00Z", note: "Published an updated version." }] });
  assert.deepEqual(own.stops.map((s) => s.kind), ["edition", "update", "edition"]);
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
