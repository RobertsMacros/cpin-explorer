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

/* ---- Reworked lists. Fixtures distilled from real edition pairs (named in each test). */

const ul = (s) => wrap(`<ul>${s}</ul>`);
/** The inline element for one row (a leaf <li> or <p>), found by a phrase in it. */
const leafWith = (html, phrase, tag = "li") => {
  const k = html.indexOf(phrase);
  assert.ok(k >= 0, `"${phrase}" rendered`);
  const s = html.lastIndexOf(`<${tag} `, k), e = html.indexOf(`</${tag}>`, k);
  return html.slice(s, e + tag.length + 3);
};
const count = (s, re) => (s.match(re) || []).length;
/** The side-by-side row holding a phrase (rows can span lines when the source text does). */
const sbsRowWith = (html, phrase) => html.split('<div class="sbs-row').find((x) => x.includes(phrase));

test("a list item that gains or loses its <p> keeps its changed words in one item (Honduras, gangs v1 → v2)", () => {
  // Archived captures wrap each item in <p>; the live page does not.
  const wayback = ul(`<li>\n<p>have not complied with a gang’s rules or demands and/or</p>\n</li><li>\n<p>other item</p>\n</li>`);
  const live = ul(`<li>Someone who has not complied with a group’s rules or demands, or otherwise openly opposes the gang</li><li>other item</li>`);
  let r = diffBodies(wayback, live);
  assert.equal(r.stats.changes, 1);
  let li = leafWith(r.inlineHtml, "complied");
  assert.equal(count(li, /<p[\s>]/g), 0, `no paragraph breaks inside the item: ${li}`);
  assert.match(li, /<del>have<\/del>/);
  assert.match(li, /<ins>Someone who has<\/ins> not complied with a <del>gang’s<\/del> <ins>group’s<\/ins> rules or demands/);
  // The other way round: the new item's own single <p> holds every word, deleted ones included.
  r = diffBodies(live, wayback);
  li = leafWith(r.inlineHtml, "complied");
  assert.equal(count(li, /<p[\s>]/g), 1, li);
  assert.match(li, /^<li[^>]*>\s*<p>[\s\S]*<\/p>\s*<\/li>$/, `one paragraph around the whole item: ${li}`);
});

test("a link in a list item that lost its <p> stays one link, and a changed target is still flagged (Turkey, Kurds v4 → v5)", () => {
  const a = ul(`<li>\n<p><a href="https://example.org/a">‘Report title’</a>, 1 May 2023</p>\n</li>`);
  const b = ul(`<li><a href="https://example.org/a">Report title</a>, 1 May 2023. Accessed: 2 June 2024</li>`);
  const li = leafWith(diffBodies(a, b).inlineHtml, "Report title");
  assert.equal(count(li, /<a /g), 1, li);
  assert.equal(count(li, /<p[\s>]/g), 0, li);
  const moved = diffBodies(ul(`<li><p><a href="https://example.org/old">Report</a></p></li>`), ul(`<li><a href="https://example.org/new">Report</a></li>`));
  assert.equal(moved.changes.length, 1);
  assert.equal(moved.changes[0].label, "List item: link target changed");
});

test("items removed from a flattened sub-list stay in the one list, without empty bullets (Sri Lanka, Tamil separatism v8 → v9)", () => {
  const a = ul(`<li>Treatment of Tamils\n<ul><li>Treatment of Tamils generally</li><li>Discrimination and harassment</li><li>Land repatriation</li></ul></li><li>Media</li>`);
  const b = ul(`<li>Treatment of Tamils</li><li>Treatment of Tamils generally</li><li>Land repatriation</li><li>Media</li>`);
  const r = diffBodies(a, b);
  assert.equal(r.stats.changes, 1);
  assert.equal(r.changes[0].label, "List item removed");
  const html = r.inlineHtml;
  assert.equal(count(html, /<ul[\s>]/g), 1, `one list, not torn apart: ${html}`);
  assert.equal(count(html, /<li[^>]*>\s*<ul/g), 0, "no empty bullet holding a nested list");
  assert.match(html, /<li class="chg is-removed"[^>]*><del>Discrimination and harassment<\/del>/);
});

test("old items removed between new sub-items do not tear the new nested list (Namibia, sexual orientation v2 → v3)", () => {
  const a = ul(`<li>statements made by government figures</li><li>how the law is applied</li><li>government policies that assist or discriminate</li><li>access to public services</li>`);
  const b = ul(`<li>State attitudes and treatment, incl.\n<ul><li>statements made by government figures</li><li>government policies that assist or discriminate</li><li>access to justice</li></ul></li><li>Access to services</li>`);
  const html = diffBodies(a, b).inlineHtml;
  assert.equal(count(html, /<ul[\s>]/g), 2, `the new list and its one sub-list: ${html}`);
  assert.equal(count(html, /<\/ul>\s*<ul/g), 0);
  assert.match(html, /<ul><li[^>]*>statements made by government figures<\/li>\s*<li class="chg is-removed"[^>]*><del>how the law is applied<\/del>/);
});

test("sub-items removed when an item is folded into one line are shown inside that item (Afghanistan, children v4 → v5)", () => {
  const a = ul(`<li>\n<p>Socio-economic rights</p>\n<ul><li>Access to education</li><li>Access to healthcare</li></ul></li><li>Documentation</li>`);
  const b = ul(`<li>Socio-economic rights (education, healthcare)</li><li>Documentation</li>`);
  const html = diffBodies(a, b).inlineHtml;
  assert.equal(count(html, /<li[^>]*>\s*<ul/g), 0, `no empty bullet: ${html}`);
  assert.match(html, /<li class="chg is-mod"[^>]*>Socio-economic rights <ins>\(education, healthcare\)<\/ins>\s*<ul><li class="chg is-removed"[^>]*><del>Access to education<\/del>[\s\S]*?<\/ul><\/li>\s*<li[^>]*>Documentation<\/li>/);
});

test("an item whose text moves into a sub-list is one changed item, not a deletion plus additions (Iran, Christian converts v1 → v2)", () => {
  const a = ul(`<li>House Churches * Numbers * Types * Locations</li><li>Right to education and employment</li>`);
  const b = ul(`<li>House Churches\n<ul><li>Numbers</li><li>Types</li><li>Locations</li></ul></li><li>Right to education and employment</li>`);
  const r = diffBodies(a, b);
  assert.equal(r.stats.changes, 1, JSON.stringify(r.changes));
  assert.equal(r.changes[0].label, "List item changed");
  assert.equal(r.stats.ins + r.stats.del, 0, "no words added or removed, only the asterisks");
  const html = r.inlineHtml;
  for (const w of ["Numbers", "Types", "Locations"]) {
    assert.equal(count(html, new RegExp(w, "g")), 1, `${w} shown once`);
    assert.ok(!new RegExp(`<(ins|del)>[^<]*${w}`).test(html), `${w} is not marked`);
  }
  assert.match(html, /House Churches <del>\*<\/del><\/div>\s*<ul><li[^>]*>Numbers <del>\*<\/del><\/li>/);
  // Side by side: one row, the old item on the left and the new item with its sub-list on the right.
  const row = sbsRowWith(r.sbsHtml, "House Churches");
  assert.ok(row.includes("Locations</li></ul></li></ul></div></div>"), row);
  assert.equal(count(row, /<div class="sbs-cell/g), 2);
  // The worker parses each edition once and reuses it: the same redline, however often it is compared.
  const shared = {}, A = prepareBody(a, shared), B = prepareBody(b, shared);
  for (let k = 0; k < 2; k++) assert.equal(diffBodies(A, B).inlineHtml, r.inlineHtml);
  assert.equal(diffBodies(A, B).sbsHtml, r.sbsHtml);
});

test("splitting, merging and re-paragraphing items moves no words (gains <p>s, split, merge)", () => {
  const one = `<li>The first sentence about the matter. The second sentence follows here.</li><li>other item</li>`;
  const twoP = `<li>\n<p>The first sentence about the matter.</p>\n<p>The second sentence follows here.</p>\n</li><li>other item</li>`;
  for (const [x, y] of [[one, twoP], [twoP, one]]) {
    const r = diffBodies(ul(x), ul(y));
    assert.equal(r.stats.changes, 0, JSON.stringify(r.changes));
  }
  const joined = `<li>alpha one two three, and beta four five six</li><li>gamma</li>`;
  const split = `<li>alpha one two three</li><li>beta four five six</li><li>gamma</li>`;
  let r = diffBodies(ul(joined), ul(split));
  assert.equal(r.stats.changes, 1);
  assert.deepEqual([r.stats.ins, r.stats.del], [0, 1]);   // "and"
  assert.equal(count(r.inlineHtml, /beta/g), 1, "the moved words appear once");
  r = diffBodies(ul(split), ul(joined));
  assert.equal(r.stats.changes, 1);
  assert.deepEqual([r.stats.ins, r.stats.del], [1, 0]);
  assert.equal(count(r.inlineHtml, /beta/g), 1);
  assert.match(r.inlineHtml, /<li class="chg is-mod"[^>]*>alpha one two three<ins>, and<\/ins> beta four five six<\/li>/);
});

test("side by side, a nested item has one bullet, not an empty bullet for its parent", () => {
  const a = ul(`<li>Head\n<ul><li>one</li><li>two</li></ul></li>`);
  const b = ul(`<li>Head\n<ul><li>one</li><li>two changed</li></ul></li>`);
  const row = sbsRowWith(diffBodies(a, b).sbsHtml, "changed");
  assert.match(row, /<ul><li style="list-style-type:none"><ul><li>two <ins>changed<\/ins><\/li><\/ul><\/li><\/ul>/);
});

test("real pairs: reworked lists render without broken items or torn lists", () => {
  const load = (p) => JSON.parse(readFileSync(new URL(`../../prototypes/data/series/${p}.json`, import.meta.url), "utf8")).versions.filter((v) => typeof v.body === "string");
  const torn = (s) => count(s.replace(/<div class="cv"[^>]*>|<\/div>\n?/g, ""), /<\/(ul|ol)>\s*<(ul|ol)[\s>]/g);
  for (const [p, i] of [["honduras/note--gangs", 1], ["sri-lanka/note--separatism-tamil", 2]]) {
    const V = load(p), r = diffBodies(V[i - 1].body, V[i].body);
    // Every changed list item has exactly as many paragraphs as the new edition's item.
    for (const row of r.rows.filter((x) => x.st === "mod" && x.b?.tag === "li" && !x.grp)) {
      const li = leafWith(r.inlineHtml, ` data-r="${row.i}"`).split(/<[uo]l[\s>]/)[0];   // its own text, not a nested list
      assert.equal(count(li, /<p[\s>]/g), row.b.kids.filter((k) => k.t === 1 && k.tag === "p").length, `${p}: ${li.slice(0, 300)}`);
    }
    assert.ok(torn(r.inlineHtml) <= torn(V[i].body), `${p}: lists torn apart (${torn(r.inlineHtml)})`);
  }
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
