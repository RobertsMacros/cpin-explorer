import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { diffBodies, parseHTML, prepareBody, seqDiff } from "../../prototypes/shared/redline-diff.js";

const wrap = (inner) => `<div class="govspeak">\n${inner}\n</div>`;
const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

const BODY = wrap(`
<div role="note" aria-label="Information" class="application-notice info-notice"><p>Version 2.0, May 2024</p></div>
<h2 id="assessment">Assessment</h2>
<p>2.1.1 The <a rel="external" href="https://example.org/report">annual report</a> describes sporadic incidents in the northern districts.<sup id="fnref:1"><a href="#fn:1" class="footnote" rel="footnote" role="doc-noteref">[footnote 1]</a></sup></p>
<ul>
  <li>the person’s stated connection to the group</li>
  <li>the length of time spent in the region</li>
  <li>any previous contact with the authorities</li>
</ul>
<table>
  <thead><tr><th scope="col">Year</th><th scope="col">Incidents</th></tr></thead>
  <tbody>
    <tr><td>2022</td><td>41</td></tr>
    <tr><td>2023</td><td>37</td></tr>
  </tbody>
</table>
<h2 id="country-information">Country information</h2>
<p>3.1.1 The population is estimated at 4.2 million.</p>
<div class="footnotes" role="doc-endnotes"><ol>
  <li id="fn:1"><p>Example Monitoring Group, <a rel="external" href="https://example.org/report">Annual review</a>, 2024 <a href="#fnref:1" class="reversefootnote" role="doc-backlink">↩</a></p></li>
</ol></div>`);

test("identical bodies produce no changes", () => {
  const r = diffBodies(BODY, BODY);
  assert.equal(r.stats.changes, 0);
  assert.equal(r.stats.ins, 0);
  assert.equal(r.stats.del, 0);
  assert.ok(r.rows.every((x) => x.st === "eq"));
  assert.ok(!/<ins>|<del>/.test(r.inlineHtml), "no redline marks");
  // Verbatim: the rendered text equals the source text.
  assert.equal(plain(r.inlineHtml), plain(BODY.replace(/<div role="note"[\s\S]*?<\/div>/, (m) => m)));
});

test("a word inserted and a word deleted mid-paragraph keep the link and the footnote reference", () => {
  const b = BODY.replace("describes sporadic incidents", "describes frequent incidents").replace("in the northern districts", "in the northern and western districts");
  const r = diffBodies(BODY, b);
  assert.equal(r.stats.changes, 1);
  assert.equal(r.stats.ins, 3);   // "frequent", "and", "western"
  assert.equal(r.stats.del, 1);   // "sporadic"
  const c = r.changes[0];
  assert.equal(c.type, "mod");
  assert.equal(c.label, "Paragraph 2.1.1 changed");
  assert.equal(c.sec, "assessment");
  const p = r.inlineHtml.match(/<p[^>]*data-chg="0"[^>]*>[\s\S]*?<\/p>/)[0];
  assert.match(p, /<del>sporadic<\/del>/);
  assert.match(p, /<ins>frequent<\/ins>/);
  assert.match(p, /<ins>and western<\/ins>/);
  assert.match(p, /<a rel="external noopener" href="https:\/\/example\.org\/report" target="_blank">annual report<\/a>/);
  assert.match(p, /<sup id="fnref:1"><a href="#fn:1" class="footnote" rel="footnote" role="doc-noteref">\[footnote 1\]<\/a><\/sup>/);
  // Side by side: the old cell shows only the deletion, the new cell only the insertions.
  const row = r.sbsHtml.split("\n").find((l) => l.includes('data-chg="0"'));
  const [oldCell, newCell] = row.split('<div class="sbs-cell new">');
  assert.match(oldCell, /<del>sporadic<\/del>/);
  assert.ok(!oldCell.includes("<ins>"));
  assert.match(newCell, /<ins>frequent<\/ins>/);
  assert.ok(!newCell.includes("<del>"));
});

test("added and removed paragraphs", () => {
  const added = BODY.replace("<h2 id=\"country-information\">", "<p>2.2.1 Relocation is generally reasonable.</p>\n<h2 id=\"country-information\">");
  let r = diffBodies(BODY, added);
  assert.equal(r.stats.changes, 1);
  assert.equal(r.changes[0].type, "add");
  assert.equal(r.stats.ins, 4);
  assert.match(r.inlineHtml, /<p class="chg is-added np"[^>]* data-chg="0"[^>]*><span class="pn"><ins>2\.2\.1<\/ins><\/span> <ins>Relocation is generally reasonable\.<\/ins><span class="badge tag tag--ins">Added<\/span><\/p>/);
  r = diffBodies(added, BODY);
  assert.equal(r.stats.changes, 1);
  assert.equal(r.changes[0].type, "del");
  assert.equal(r.stats.del, 4);
  assert.match(r.inlineHtml, /class="chg is-removed np"/);
  assert.match(r.inlineHtml, /<span class="pn"><del>2\.2\.1<\/del><\/span> <del>Relocation is generally reasonable\.<\/del>/);
});

test("a list item removed stays inside its list", () => {
  const b = BODY.replace("  <li>the length of time spent in the region</li>\n", "");
  const r = diffBodies(BODY, b);
  assert.equal(r.stats.changes, 1);
  assert.equal(r.changes[0].type, "del");
  assert.equal(r.changes[0].label, "List item removed");
  const ul = r.inlineHtml.match(/<ul>[\s\S]*?<\/ul>/)[0];
  assert.equal((ul.match(/<li/g) || []).length, 3, "removed item is shown in place");
  assert.match(ul, /<li class="chg is-removed"[^>]* data-chg="0"[^>]*><del>the length of time spent in the region<\/del>/);
});

test("a table cell changed is a modified row with cell structure intact", () => {
  const b = BODY.replace("<td>37</td>", "<td>39</td>");
  const r = diffBodies(BODY, b);
  assert.equal(r.stats.changes, 1);
  assert.equal(r.changes[0].type, "mod");
  assert.equal(r.changes[0].label, "Table row changed");
  const tr = r.inlineHtml.match(/<tr class="chg is-mod"[^>]*>[\s\S]*?<\/tr>/)[0];
  assert.match(tr, /<td>2023<\/td><td><del>37<\/del><ins>39<\/ins><\/td>/);
  assert.match(r.inlineHtml, /<div class="tbl-scroll"[^>]*><table>/);
});

test("wayback vs live markup noise (ids, classes, attributes, whitespace, list <p>, number spans) is not a change", () => {
  const wayback = `<div class="gem-c-govspeak-html-publication"><div data-module="govspeak" class="gem-c-govspeak govuk-govspeak">
<div class="govspeak">
<h2 id="assessment-2"><span class="number">2. </span>Assessment</h2>
<p>2.1.1   The <a href="https://example.org/report" class="govuk-link">annual report</a> describes
sporadic incidents in the northern districts.<sup id="fnref:7" role="doc-noteref"><a href="#fn:7" class="govuk-link" rel="footnote">[footnote 7]</a></sup></p>
<ul><li><p>the person’s stated connection to the group</p></li></ul>
<figure class="image embedded"><div class="img"><img src="https://assets.publishing.service.gov.uk/government/uploads/system/uploads/image_data/file/1/map.png" alt="Map"></div></figure>
</div></div></div>`;
  const live = `<div class="govspeak">
<h2 id="assessment">Assessment</h2>
<p>2.1.1 The <a rel="external" href="https://example.org/report">annual report</a> describes sporadic incidents in the northern districts.<sup id="fnref:1"><a href="#fn:1" class="footnote" rel="footnote" role="doc-noteref">[footnote 1]</a></sup></p>
<ul>
  <li>the person's stated connection to the group</li>
</ul>
<figure class="image embedded"><div class="img"><img src="https://assets.publishing.service.gov.uk/media/abc123/map.png" alt=""></div></figure>
</div>`;
  const r = diffBodies(wayback, live);
  assert.equal(r.stats.changes, 0, JSON.stringify(r.changes));
  assert.equal(r.stats.ins + r.stats.del, 0);
});

test("footnote renumbering alone is not a change, and images use the mirror at render time only", () => {
  const a = wrap(`<p>Text.<sup id="fnref:3"><a href="#fn:3" role="doc-noteref">[footnote 3]</a></sup></p><figure><img src="https://assets.publishing.service.gov.uk/media/x/chart.svg" alt=""></figure>`);
  const b = a.replace(/fn:3|fnref:3/g, (m) => m.replace("3", "4")).replace("[footnote 3]", "[footnote 4]");
  const images = { "https://assets.publishing.service.gov.uk/media/x/chart.svg": "../../data/images/files/abc.svg" };
  const r = diffBodies(a, b, { images });
  assert.equal(r.stats.changes, 0);
  assert.match(r.inlineHtml, /\[footnote 4\]/);
  assert.match(r.inlineHtml, /<img src="\.\.\/\.\.\/data\/images\/files\/abc\.svg" data-govuk-src="https:\/\/assets\.publishing\.service\.gov\.uk\/media\/x\/chart\.svg"/);
  assert.match(r.sbsHtml, /\[footnote 3\]/, "the old column keeps its own footnote number");
});

test("contents and per-section counts follow the new edition's headings", () => {
  const b = BODY.replace("4.2 million", "4.6 million").replace("describes sporadic", "describes frequent");
  const r = diffBodies(BODY, b);
  assert.deepEqual(r.toc.map((s) => [s.id, s.level, s.count]), [["assessment", 2, 1], ["country-information", 2, 1]]);
});

test("seqDiff aligns sequences and falls back to anchors on large inputs", () => {
  const ops = seqDiff([1, 2, 3, 4], [1, 3, 4, 5]);
  assert.deepEqual(ops.map((o) => o[0]), ["eq", "del", "eq", "eq", "ins"]);
  const n = 3000, a = Array.from({ length: n }, (_, i) => i), b = a.filter((x) => x % 97 !== 0).concat([-1, -2]);
  const big = seqDiff(a, b);
  assert.equal(big.filter((o) => o[0] === "eq").length, b.length - 2);
});

test("parser handles void elements, entities and implied closes", () => {
  const root = parseHTML('<p>a &amp; b<br>c<p>d</p><ul><li>x<li>y</ul>');
  assert.equal(root.kids.length, 3);
  assert.equal(root.kids[0].kids[0].v, "a & b");
  assert.equal(root.kids[2].kids.length, 2);
  const blocks = prepareBody('<div class="govspeak"><ul><li>one</li><li><p>two</p><ul><li>three</li></ul></li></ul></div>').blocks;
  assert.deepEqual(blocks.map((b) => b.plain), ["one", "two", "three"]);
});

test("a real pair from the Afghanistan 'fear of the Taliban' series completes and finds changes", () => {
  const url = new URL("../../prototypes/data/series/afghanistan/note--fear-taliban.json", import.meta.url);
  const series = JSON.parse(readFileSync(url, "utf8"));
  const v = series.versions, a = v[v.length - 2], b = v[v.length - 1];
  const t0 = performance.now();
  const r = diffBodies(a.body, b.body, { images: series.images });
  const ms = performance.now() - t0;
  assert.ok(r.stats.changes > 20, `changes: ${r.stats.changes}`);
  assert.ok(r.stats.ins > 1000 && r.stats.del > 1000);
  assert.ok(r.toc.length > 10 && r.toc.some((s) => s.count > 0));
  assert.ok(r.inlineHtml.includes('data-chg="0"'));
  assert.ok(r.inlineHtml.includes("../../data/images/files/"), "mirrored images substituted");
  assert.ok(ms < 20000, `took ${ms} ms`);
  // The same edition against itself (a wayback capture vs the next capture of the same text) has no changes.
  const same = v.findIndex((x, i) => i > 0 && x.version === v[i - 1].version && x.text_sha256 === v[i - 1].text_sha256);
  if (same > 0) assert.equal(diffBodies(v[same - 1].body, v[same].body, { render: false }).stats.changes, 0);
  // Never alters the source: bodies are untouched strings.
  assert.equal(typeof a.body, "string");
});
