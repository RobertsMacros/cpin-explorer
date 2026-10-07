import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { activeRecords, applicationChecks, backgroundReviews, badgeHtml, createPrivateStore, forTarget, httpUrl, panelHtml, recordHtml, reportPanelHtml, reportReviews, reviewStatus, sourceCopies } from "../../prototypes/shared/source-reviews.js";

const target = { country: "afghanistan", series: "note:fear-taliban", editionId: "a7c78fef364ac1e2", textSha: "a".repeat(64), footnote: 279,
  paragraph: "16.2.6", section: "Returnees", sourceUrl: "https://example.org/report#page=3" };
const record = (kind, status, changes = {}) => ({ target: { ...target }, kind, status, severity: "minor", author: "A Reviewer", comment: "Checked the scope of this claim.", ...changes });

test("edition AI empty state accounts for directory assessments and unavailable records", () => {
  const review = { applications: [{ kind: "ai", target: { ...target }, summary: "Scoped directory assessment" }] };
  const panel = reportPanelHtml(target, [], [review]);
  assert.match(panel, /Scoped directory assessment/);
  assert.doesNotMatch(panel, /No AI review recorded/);
  assert.match(reportPanelHtml({ ...target, editionId: "other" }, [], [review]), /No AI review recorded/);
  assert.doesNotMatch(reportPanelHtml(target, [], [], { loading: true }), /No AI review recorded/);
  assert.doesNotMatch(reportPanelHtml(target, [], [], { unavailable: true }), /No AI review recorded/);
});

test("later-edition follow-ups stay separate from external findings and citation badges", () => {
  const application = { kind:'ai', target:{...target}, assessment:'superseded', scope:'Old passage only',
    reviewFinding:'Older criticism', summary:'Specific wording removed', author:'AI reviewer', reviewedAt:'2026-10-05' };
  const review = {id:'old', title:'Original review', url:'https://example.org/review', applications:[application]};
  assert.equal(applicationChecks([review], target).length, 1);
  for (const key of ['editionId','textSha','country','series'])
    assert.equal(applicationChecks([review], {...target,[key]:'other'}).length, 0);
  assert.equal(applicationChecks([{...review,applications:[{...application,kind:'manual'}]}],target).length,0);
  const panel = panelHtml(target, [], {countryReviews:[review]});
  assert.match(panel,/Published-review follow-up for this edition/);
  assert.match(panel,/Specific wording removed/);
  assert.match(panel,/do not check every citation/);
  assert.equal(reviewStatus([]).tone,'grey');
  assert.equal(applicationChecks([{...review,applications:{}}],target).length,0);
  const issuePanel=panelHtml(target, [], {countryReviews:[{...review,applications:[{...application,severity:"major",assessment:"supported"}]}]});
  assert.match(issuePanel,/sr-red/);
  assert.match(issuePanel,/AI review/);
  assert.doesNotMatch(issuePanel,/awaiting human review/);
  const escaped = panelHtml(target, [], {countryReviews:[{...review,applications:[{...application,summary:'<script>bad</script>'}]}]});
  assert.ok(!escaped.includes('<script>bad</script>'));
});

test("a matching report copy preserves the original source and never awards a checked tick", async () => {
  const data = JSON.parse(await readFile(new URL('../../prototypes/reviews/source-copies.json', import.meta.url)));
  assert.equal(data.copies.reduce((n, r) => n + r.targets.length, 0), 67);
  const copy = data.copies[0], t = { ...copy.targets[0], paragraph:'1.1.1', section:'Context' };
  assert.equal(sourceCopies(data.copies, t).length, 1);
  for (const change of [{textSha:'f'.repeat(64)}, {editionId:'f'.repeat(16)}, {footnote:9999}, {sourceUrl:'https://example.org/other'}]) {
    assert.equal(sourceCopies(data.copies, { ...t, ...change }).length, 0);
  }
  const html = panelHtml(t, [], { matchingCopies:sourceCopies(data.copies,t) });
  assert.ok(html.includes(t.sourceUrl));
  assert.ok(html.includes(copy.url));
  assert.match(html, /claim has not been assessed/);
  assert.match(html, /sr-grey/);
  assert.equal(sourceCopies([{ ...copy, url:'javascript:alert(1)' }],t).length,0);
});

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

test("all found reviews are accessible as country background without certifying a citation", async () => {
  const directory = JSON.parse(await readFile(new URL("../../prototypes/reviews/directory.json", import.meta.url)));
  const reachable = new Set();
  for (const r of directory.reviews) {
    for (const country of r.countries) {
      const t = { ...target, country };
      for (const found of [...reportReviews(directory.reviews, t), ...backgroundReviews(directory.reviews, t)]) reachable.add(found.id);
    }
  }
  assert.equal(reachable.size, directory.reviews.length);
  const otherEdition = { id: "old", countries: [target.country], kind: "direct-review", reviewedProduct: "uk-cpin", title: "Older review", url: "https://example.org/older", targets: [{ ...target, scope: "whole-report", mapping: "edition-declaration-checked", editionId: "b".repeat(16) }] };
  const exact = { ...otherEdition, id: "exact", targets: [{ ...target, scope: "whole-report", mapping: "edition-declaration-checked" }] };
  assert.deepEqual(backgroundReviews([otherEdition, exact, { ...otherEdition, id: "other-country", countries: ["china"] }], target).map((r) => r.id), ["old"]);
  const panel = panelHtml(target, [], { countryReviews: [otherEdition] });
  assert.match(panel, /Background only/);
  assert.match(panel, /not been established/);
  assert.match(panel, /Older review/);
  assert.match(panel, /sr-grey/);
});

test("AI alone never awards a green tick, and a local check cannot hide an independent finding", () => {
  assert.equal(reviewStatus([record("ai", "no-issue")]).tone, "grey");
  assert.equal(reviewStatus([record("ai", "possible-issue")]).tone, "yellow");
  assert.equal(reviewStatus([record("manual", "checked")]).tone, "green");
  assert.equal(reviewStatus([record("manual", "checked", { author: "" })]).tone, "grey");
  assert.equal(reviewStatus([record("manual", "checked"), record("external", "issue", { severity: "major" })]).tone, "red");
  assert.equal(reviewStatus([record("manual", "checked"), record("ai", "possible-issue")]).tone, "yellow");
});

test("flag colour describes severity regardless of reviewer, with major findings taking priority", () => {
  for (const kind of ["ai", "external", "manual"]) {
    const status = kind === "ai" ? "possible-issue" : "issue";
    assert.equal(reviewStatus([record(kind, status, { severity: "major" })]).tone, "red");
    assert.equal(reviewStatus([record(kind, status, { severity: "minor" })]).tone, "yellow");
  }
  assert.match(reviewStatus([record("ai", "possible-issue", { severity: "major" })]).label, /AI review/);
  assert.equal(reviewStatus([record("external", "issue"), record("ai", "possible-issue", { severity: "major" })]).tone, "red");
  assert.deepEqual(reviewStatus([record("manual", "checked"), record("external", "issue", { severity: undefined })]),
    { tone: "grey", symbol: "⚑", label: "Issue recorded · severity not assigned" });
});

test("manual review severity survives save/reload, and an unclassified issue must be assigned", () => {
  const storage = new Map();
  const access = () => ({ getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) });
  const store = createPrivateStore(access);
  for (const severity of ["major", "minor"]) {
    store.save(target, { status: `${severity}-issue`, author: "Jo", comment: "Checked the impact." });
    const latest = createPrivateStore(access).load().at(-1);
    assert.equal(latest.status, "issue");
    assert.equal(latest.severity, severity);
    assert.match(panelHtml(target, [latest]), new RegExp(`value="${severity}-issue" selected`));
  }
  assert.equal(reviewStatus(store.load()).tone, "yellow");
  assert.throws(() => store.save(target, { status: "issue", author: "Jo", comment: "Unchecked impact." }), /minor or major/);
});

test("manual edits preserve history and only the latest decision is active", () => {
  const storage = new Map();
  const store = createPrivateStore(() => ({ getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) }));
  assert.equal(store.save(target, { status: "issue", severity: "major", author: "Jo", comment: "Different population." }).persisted, true);
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
  assert.match(badgeHtml([record("external", "issue")]), /Minor error/);
});

test("long attributed comments collapse with safe page links and separately labelled reply extracts", () => {
  const r = record("external", "context", { collapsible: true, summary: '<img src=x> Reviewer comment',
    summaryDetail: '<script>bad()</script>', response: 'Accepted for an update', responseIsExcerpt: true,
    reviewPages: [{page: 18, url: 'https://example.org/review.pdf#page=18'}, {page: 19, url: 'javascript:bad()'}] });
  const s = recordHtml(r);
  assert.match(s, /^<details class="sr-record sr-comment"><summary>&lt;img/);
  assert.match(s, /Home Office response · extract/);
  assert.match(s, /no independent factual verdict/);
  assert.match(s, /review.pdf#page=18/);
  assert.ok(!s.includes('href="javascript:'));
  assert.ok(!s.includes('<script>'));
  assert.equal(reviewStatus([r]).tone, 'grey');
  assert.equal(reviewStatus([r]).symbol, '○');
});

test("published pilot is an external finding with the original edition and source anchored", async () => {
  const data = JSON.parse(await readFile(new URL("../../prototypes/reviews/published.json", import.meta.url)));
  assert.equal(data.schema, 1);
  assert.equal(data.records[0].kind, "external");
  assert.equal(data.records[0].target.editionId, "a7c78fef364ac1e2");
  assert.match(data.records[0].summary, /internal consistency/);
  assert.match(data.coverage, /No exhaustive contradiction analysis or human sign-off/);
});

test("new Syria wording checks retain exact current edition identity and source page evidence without human approval", async () => {
  const data = JSON.parse(await readFile(new URL('../../prototypes/reviews/published.json',import.meta.url)));
  const checks=data.records.filter(r=>r.promptVersion==='source-evidence-review-2');
  assert.equal(checks.length,5);
  for(const r of checks){
    const filename=r.target.series.replaceAll(':','--');
    const series=JSON.parse(await readFile(new URL(`../../prototypes/data/series/syria/${filename}.json`,import.meta.url)));
    assert.ok(series.versions.some(v=>v.current && v.id===r.target.editionId && v.text_sha256===r.target.textSha));
    assert.equal(forTarget([r],r.target).length,1);
    assert.equal(reviewStatus([r]).tone,'grey');
    assert.match(panelHtml(r.target,[r]),/Source checked/);
    assert.match(r.sourceLocation,/Printed page \d+; physical PDF page \d+/);
    assert.equal(r.sourceSha256,'06eb2789cfee794517a59c6269862aa925e9ba23b917e8dfe4ed8cfe32317c36');
  }
});
