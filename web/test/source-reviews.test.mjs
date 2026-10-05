import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { activeRecords, badgeHtml, createPrivateStore, forTarget, httpUrl, panelHtml, reportReviews, reviewStatus } from "../../prototypes/shared/source-reviews.js";

const target = { country: "afghanistan", series: "note:fear-taliban", editionId: "a7c78fef364ac1e2", textSha: "a".repeat(64), footnote: 279,
  paragraph: "16.2.6", section: "Returnees", sourceUrl: "https://example.org/report#page=3" };
const record = (kind, status, changes = {}) => ({ target: { ...target }, kind, status, author: "A Reviewer", comment: "Checked the scope of this claim.", ...changes });

test("whole-report reviews are edition-bound context and never source flags", () => {
  const r = { kind: "direct-review", reviewedProduct: "uk-cpin", title: "Named review", url: "https://example.org/review.pdf",
    targets: [{ ...target, scope: "whole-report", mapping: "edition-declaration-checked" }] };
  assert.equal(reportReviews([r], target).length, 1);
  assert.equal(reportReviews([r], { ...target, editionId: "c".repeat(16) }).length, 0);
  assert.equal(reportReviews([r], { ...target, textSha: "c".repeat(64) }).length, 0);
  assert.equal(reportReviews([{ ...r, reviewedProduct: "easo-coi" }], target).length, 0);
  assert.match(panelHtml(target, [], { editionReviews: [r] }), /not been independently assessed/);
  assert.equal(reviewStatus([]).tone, "grey");
});

test("findings attach to the exact edition, paragraph, section and source use", () => {
  const r = record("external", "issue");
  assert.equal(forTarget([r], { ...target, sourceUrl: "https://example.org/report#page=8" }).length, 1);
  for (const [key, value] of Object.entries({ editionId: "b".repeat(16), textSha: "b".repeat(64), paragraph: "16.2.7", section: "Annex", sourceUrl: "https://example.org/other", footnote: 280 })) {
    assert.equal(forTarget([r], { ...target, [key]: value }).length, 0, key);
  }
  assert.equal(forTarget([r], { ...target, section: "" }).length, 0);
});

test("AI alone never awards a green tick, and a local check cannot hide an independent finding", () => {
  assert.equal(reviewStatus([record("ai", "no-issue")]).tone, "grey");
  assert.equal(reviewStatus([record("ai", "possible-issue")]).tone, "yellow");
  assert.equal(reviewStatus([record("manual", "checked")]).tone, "green");
  assert.equal(reviewStatus([record("manual", "checked", { author: "" })]).tone, "grey");
  assert.equal(reviewStatus([record("manual", "checked"), record("external", "issue")]).tone, "red");
  assert.equal(reviewStatus([record("manual", "checked"), record("ai", "possible-issue")]).tone, "yellow");
});

test("manual edits preserve history and only the latest decision is active", () => {
  const storage = new Map();
  const store = createPrivateStore(() => ({ getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) }));
  assert.equal(store.save(target, { status: "issue", author: "Jo", comment: "Different population." }).persisted, true);
  store.save(target, { status: "checked", author: "Jo", comment: "Checked the narrower population.", excerpt: "Source passage." });
  const journal = store.load();
  assert.equal(journal.length, 2);
  assert.equal(activeRecords(journal).length, 1);
  assert.equal(reviewStatus(journal).tone, "green");
  assert.match(panelHtml(target, journal), /Previous human entries \(1\)/);
  assert.match(panelHtml(target, journal), /Source passage · pasted by reviewer/);
});

test("failed browser persistence keeps the entry in this session and reports the failure", () => {
  const store = createPrivateStore(() => ({ getItem: () => "[]", setItem: () => { throw new Error("quota"); } }));
  assert.equal(store.save(target, { status: "note", author: "Jo", comment: "Follow up." }).persisted, false);
  assert.equal(store.load().length, 1);
  assert.throws(() => store.save({ ...target, section: "" }, { status: "note", author: "Jo", comment: "x" }), /anchored/);
  assert.throws(() => store.save(target, { status: "checked", author: "", comment: "x" }), /name/);
});

test("review text and links cannot inject active content; public evidence requires a rights decision", () => {
  const malicious = record("external", "issue", { comment: '<img src=x onerror="alert(1)">', publication: { url: "javascript:alert(1)", title: "Bad" },
    evidence: { quote: "Hidden copyrighted text", url: "https://example.org/a", publicDisplayApproved: false } });
  const s = panelHtml(target, [malicious]);
  assert.ok(s.includes("&lt;img"));
  assert.ok(!s.includes('href="javascript:'));
  assert.ok(!s.includes("Hidden copyrighted text"));
  malicious.evidence = { quote: "Approved passage", title: "Published source", url: "https://example.org/a", publicDisplayApproved: true, rightsBasis: "permission" };
  assert.match(panelHtml(target, [malicious]), /Approved passage/);
  assert.equal(httpUrl("data:text/html,x"), "");
  assert.match(badgeHtml([record("external", "issue")]), /Issue identified by a reviewer/);
});

test("published pilot is an external finding with the original edition and source anchored", async () => {
  const data = JSON.parse(await readFile(new URL("../../prototypes/reviews/published.json", import.meta.url)));
  assert.equal(data.schema, 1);
  assert.equal(data.records[0].kind, "external");
  assert.equal(data.records[0].target.editionId, "a7c78fef364ac1e2");
  assert.match(data.records[0].summary, /internal consistency/);
  assert.match(data.coverage, /No automatic AI checks/);
});
