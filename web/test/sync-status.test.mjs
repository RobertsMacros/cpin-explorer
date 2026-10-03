// "Accurate as of": the comparison with GOV.UK and the words shown, in UK time.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHECK_TTL_MS, checkSummary, compareWithGovuk, isFresh, syncStatus } from "../../prototypes/dashboard/sync-status.js";

const ours = [
  { slug: "iran", name: "Iran", govuk_url: "https://www.gov.uk/government/publications/iran-country-policy-and-information-notes", updated: "2026-09-30T10:00:00Z" },
  { slug: "iraq", name: "Iraq", govuk_url: "https://www.gov.uk/government/publications/iraq-country-policy-and-information-notes", updated: "2026-07-24T09:15:20Z" },
];
const doc = (name, when) => ({ base_path: `/government/publications/${name}-country-policy-and-information-notes`, title: `${name}: country policy and information notes`, public_updated_at: when });
const FETCHED = "2026-10-02T16:11:59Z", CHECKED = "2026-10-03T07:24:10Z";

test("nothing newer on GOV.UK: every page's update date matches our copy (to within a minute)", () => {
  const check = compareWithGovuk(ours, [doc("iran", "2026-09-30T10:00:00Z"), doc("iraq", "2026-07-24T09:15:55Z")], CHECKED);
  assert.deepEqual(check, { at: "2026-10-03T07:24:10.000Z", pages: 2, newer: [] });
  const status = syncStatus({ fetchedAt: FETCHED, check });
  assert.equal(status.state, "accurate");
  assert.equal(status.text, "ACCURATE AS OF 03 OCT 2026 · 08:24 BST", "the time of the check, in UK time");
  assert.equal(status.title, "Checked against GOV.UK's update dates at 08:24 BST: nothing newer. Our copy was fetched 02 OCT 2026 · 17:11 BST.");
  assert.deepEqual(checkSummary({ fetchedAt: FETCHED, check }), {
    heading: "Up to date", body: "GOV.UK’s last-updated dates for all 2 country pages match our copy.",
    foot: "Checked 08:24 BST. Our copy was fetched 02 OCT 2026 · 17:11 BST.",
  });
});

test("GOV.UK has newer updates: the pages updated since our copy, and any page we do not hold", () => {
  const check = compareWithGovuk(ours, [doc("iran", "2026-10-03T06:30:00Z"), doc("iraq", "2026-07-24T09:15:20Z"), doc("oman", "2026-10-01T12:00:00Z")], CHECKED);
  assert.equal(check.pages, 3);
  assert.deepEqual(check.newer.map((n) => [n.slug, n.name, n.updated]), [
    ["iran", "Iran", "2026-10-03T06:30:00Z"], [null, "oman: country policy and information notes", "2026-10-01T12:00:00Z"],
  ]);
  const status = syncStatus({ fetchedAt: FETCHED, check });
  assert.deepEqual([status.state, status.text], ["newer", "GOV.UK HAS 2 NEWER UPDATES"]);
  assert.match(status.title, /Our copy was fetched 02 OCT 2026 · 17:11 BST; the next sync will mirror them\.$/);
  const one = compareWithGovuk(ours, [doc("iran", "2026-10-03T06:30:00Z"), doc("iraq", "2026-07-24T09:15:20Z")], CHECKED);
  assert.equal(syncStatus({ fetchedAt: FETCHED, check: one }).text, "GOV.UK HAS 1 NEWER UPDATE");
  assert.equal(checkSummary({ fetchedAt: FETCHED, check: one }).heading, "GOV.UK has 1 NEWER UPDATE");
  assert.match(checkSummary({ fetchedAt: FETCHED, check: one }).foot, /^The next daily sync will mirror it\. Checked 08:24 BST\./);
});

test("not checked yet, or GOV.UK unreachable: say when our copy was fetched, and claim nothing more", () => {
  const status = syncStatus({ fetchedAt: FETCHED, check: null });
  assert.deepEqual([status.state, status.text], ["fetched", "COPY FETCHED 02 OCT 2026 · 17:11 BST"]);
  assert.ok(!/accurate/i.test(status.text + status.title));
  assert.equal(checkSummary({ fetchedAt: FETCHED, check: null }).heading, "Couldn’t reach GOV.UK");
});

test("one clock: winter times say GMT, and the three states never differ by more than a few characters in width", () => {
  const winter = compareWithGovuk(ours, [doc("iran", "2026-09-30T10:00:00Z"), doc("iraq", "2026-07-24T09:15:20Z")], "2026-12-01T09:05:00Z");
  assert.equal(syncStatus({ fetchedAt: "2026-11-30T16:11:00Z", check: winter }).text, "ACCURATE AS OF 01 DEC 2026 · 09:05 GMT");
  assert.equal(syncStatus({ fetchedAt: "2026-11-30T16:11:00Z", check: null }).text, "COPY FETCHED 30 NOV 2026 · 16:11 GMT");
  const longest = Math.max(...[null, winter, { at: CHECKED, pages: 47, newer: Array(47).fill({}) }].map((check) => syncStatus({ fetchedAt: FETCHED, check }).text.length));
  assert.ok(longest <= 38, `the header reserves 38 characters; the longest is ${longest}`);
});

test("a check is reused for half an hour, then asked again", () => {
  const check = compareWithGovuk(ours, [], CHECKED), t = Date.parse(CHECKED);
  assert.equal(CHECK_TTL_MS, 30 * 60_000);
  assert.ok(isFresh(check, t + 29 * 60_000));
  assert.ok(!isFresh(check, t + 31 * 60_000));
  assert.ok(!isFresh(check, t - 5_000), "not from the future (a wrong clock)");
  assert.ok(!isFresh(null, t) && !isFresh({ at: "nonsense", newer: [] }, t) && !isFresh({ at: CHECKED }, t), "nothing stored, or something unreadable");
});

test("a page we hold that GOV.UK no longer lists counts as a change", () => {
  const ours = [
    { slug: "iran", name: "Iran", govuk_url: "https://www.gov.uk/government/publications/iran-country-policy-and-information-notes", updated: "2026-08-26T10:00:00Z" },
    { slug: "kenya", name: "Kenya", govuk_url: "https://www.gov.uk/government/publications/kenya-country-policy-and-information-notes", updated: "2026-05-01T10:00:00Z" },
  ];
  const docs = [{ base_path: "/government/publications/iran-country-policy-and-information-notes", title: "Iran", public_updated_at: "2026-08-26T10:00:00Z" }];
  const check = compareWithGovuk(ours, docs, "2026-10-03T07:24:10Z");
  assert.deepEqual(check.newer.map((n) => [n.slug, n.gone, n.updated]), [["kenya", true, null]]);
  assert.equal(syncStatus({ fetchedAt: "2026-10-02T16:11:59Z", check }).state, "newer");
  assert.match(checkSummary({ fetchedAt: "2026-10-02T16:11:59Z", check }).body, /^This page has changed on GOV\.UK/);
});
