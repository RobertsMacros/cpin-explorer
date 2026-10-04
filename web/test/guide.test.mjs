import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GLOSSARY, GROUPS, glossaryEntry } from "../../prototypes/shared/glossary.js";
import {
  addressWithFilter, countLabel, entryHtml, esc, filterGlossary, glossaryGroups, groupHtml, matchSpans, termFromHash,
} from "../../prototypes/guide/guide.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("../../prototypes/guide/index.html");

/* ------------------------------------------------------------------ the glossary as shown */

test("the glossary is shown in its groups, in order, every entry once", () => {
  const groups = glossaryGroups();
  assert.deepEqual(groups.map((g) => g.key), Object.keys(GROUPS));
  assert.deepEqual(groups.map((g) => g.label), Object.values(GROUPS));
  assert.deepEqual(groups.flatMap((g) => g.entries.map((e) => e.id)).sort(), GLOSSARY.map((e) => e.id).sort());
  for (const g of groups) assert.ok(g.entries.every((e) => e.group === g.key));
  // within a group, the order written
  const notes = GLOSSARY.filter((e) => e.group === "notes").map((e) => e.id);
  assert.deepEqual(groups[0].entries.map((e) => e.id), notes);
});

test("a group with no entries is not drawn", () => {
  const groups = glossaryGroups([{ id: "a", term: "A", group: "law", def: "x" }], { notes: "The notes", law: "Asylum law" });
  assert.deepEqual(groups.map((g) => g.key), ["law"]);
});

test("an entry is drawn with its anchor, its term, what it stands for and its explanation", () => {
  const html = entryHtml(glossaryEntry("cpin"));
  assert.match(html, /<li class="gl-row" id="term-cpin" data-id="cpin">/);
  assert.match(html, /<a href="#term-cpin"><dfn>CPIN<\/dfn><\/a>/);
  assert.match(html, /<p class="gl-full">Country Policy and Information Note<\/p>/);
  assert.ok(html.includes(`<p class="gl-def">${esc(glossaryEntry("cpin").def)}</p>`));
  // no `full`: no empty line for it; other names (aka) are searched, not shown
  const plain = entryHtml(glossaryEntry("assessment"));
  assert.ok(!plain.includes("gl-full"));
  assert.ok(!plain.includes("analysis"));
});

test("text from the glossary is escaped", () => {
  const html = entryHtml({ id: "x", term: "A <b> & \"C\"", full: "<i>", def: "1 < 2 & 'so'" });
  assert.ok(html.includes("A &lt;b&gt; &amp; &quot;C&quot;"));
  assert.ok(html.includes('<p class="gl-full">&lt;i&gt;</p>'));
  assert.ok(html.includes("1 &lt; 2 &amp; &#39;so&#39;"));
  const group = groupHtml({ key: "law", label: "Law & <order>", entries: [] });
  assert.ok(group.includes("Law &amp; &lt;order&gt;") && group.includes('id="group-law"'));
});

test("a group shows its heading, its count and its entries", () => {
  const g = glossaryGroups()[0];
  const html = groupHtml(g);
  assert.match(html, new RegExp(`<h3 class="eyebrow" id="group-notes-h">${GROUPS.notes}</h3>`));
  assert.ok(html.includes(`<span class="eyebrow gl-group-n">${g.entries.length}</span>`));
  assert.equal((html.match(/class="gl-row"/g) || []).length, g.entries.length);
});

/* ------------------------------------------------------------------ the filter */

test("no filter leaves every term; a filter looks in names, then in explanations", () => {
  const all = filterGlossary("");
  assert.equal(all.active, false);
  assert.equal(all.shown, GLOSSARY.length);
  assert.equal(all.total, GLOSSARY.length);

  const cpin = filterGlossary("  cpin ");
  assert.equal(cpin.query, "cpin");
  assert.ok(cpin.active && cpin.ids.has("cpin"));
  assert.ok(cpin.shown < GLOSSARY.length);

  assert.ok(filterGlossary("oscola").ids.has("citation-styles"));               // what it stands for
  assert.ok(filterGlossary("wayback").ids.has("archived-copy"));                // another word for it
  assert.deepEqual([...filterGlossary("treaty").ids], ["refugee-convention"]);  // only in an explanation
});

test("a filter of punctuation only is no filter, and a miss leaves nothing", () => {
  assert.equal(filterGlossary(" ?! ").active, false);
  assert.equal(filterGlossary(" ?! ").shown, GLOSSARY.length);
  const none = filterGlossary("zzzz");
  assert.ok(none.active);
  assert.equal(none.shown, 0);
});

test("the count says how many are shown", () => {
  assert.equal(countLabel(filterGlossary("")), `${GLOSSARY.length} terms`);
  assert.equal(countLabel({ active: false, shown: 1, total: 1 }), "1 term");
  assert.equal(countLabel({ active: true, shown: 3, total: 37 }), "3 of 37 terms");
  assert.equal(countLabel({ active: true, shown: 1, total: 37 }), "1 of 37 terms");
  assert.equal(countLabel(filterGlossary("zzzz")), "No terms match");
});

test("the words tinted in a matching row are whole words that a filter word begins", () => {
  const spans = (text, q) => matchSpans(text, q).map(([a, b]) => text.slice(a, b));
  assert.deepEqual(spans("Archived copy from the Internet Archive’s Wayback Machine", "archive"), ["Archived", "Archive"]);
  assert.deepEqual(spans("Internal relocation, or relocating", "internal reloc"), ["Internal", "relocation", "relocating"]);
  assert.deepEqual(spans("The treaty that defines who is a refugee", "TREATY"), ["treaty"]);
  assert.deepEqual(spans("Café society", "cafe"), ["Café"]);
  assert.deepEqual(spans("a disarchived thing", "archive"), [], "the middle of a word is not a match");
  assert.deepEqual(matchSpans("anything", ""), []);
  assert.deepEqual(matchSpans("", "x"), []);
});

/* ------------------------------------------------------------------ addresses */

test("#term-<id> names a glossary entry, or nothing", () => {
  assert.equal(termFromHash("#term-cpin"), "cpin");
  assert.equal(termFromHash("#term-article-15c"), "article-15c");
  assert.equal(termFromHash("#term-no-such-term"), null);
  assert.equal(termFromHash("#glossary"), null);
  assert.equal(termFromHash("#term-"), null);
  assert.equal(termFromHash(""), null);
  assert.equal(termFromHash(undefined), null);
});

test("the filter is kept in the address (?q=), with the rest of it untouched", () => {
  const base = "http://localhost:8781/prototypes/guide/index.html";
  assert.equal(addressWithFilter(base, "cpin"), `${base}?q=cpin`);
  assert.equal(addressWithFilter(`${base}?q=old#glossary`, " internal relocation "), `${base}?q=internal+relocation#glossary`);
  assert.equal(addressWithFilter(`${base}?q=old#term-cpin`, ""), `${base}#term-cpin`);
  assert.equal(addressWithFilter(`${base}?x=1&q=old`, ""), `${base}?x=1`);
  assert.equal(new URL(addressWithFilter(base, "15(c) & more")).searchParams.get("q"), "15(c) & more");
});

/* ------------------------------------------------------------------ the page itself */

test("the page spells out CPIN in plain HTML, with the two anchors the footer links to", () => {
  assert.ok(page.includes("stands for Country Policy and Information Note"));
  assert.match(page, /<section[^>]* id="guide"/);
  assert.match(page, /<section[^>]* id="glossary"/);
  assert.match(page, /not Home Office text, and they are not legal advice/);
  assert.match(page, /<noscript>/);
});

test("every glossary link in the guide goes to an entry that exists", () => {
  const ids = [...page.matchAll(/href="#term-([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 10, "the guide links its terms to the glossary");
  for (const id of ids) assert.ok(glossaryEntry(id), `#term-${id} is not in the glossary`);
  assert.ok(ids.includes("cpin"));
});

test("every in-page link goes to something on the page, and ids are unique", () => {
  const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "duplicate id");
  const have = new Set(ids);
  for (const [, target] of page.matchAll(/href="#([^"]+)"/g)) {
    if (target.startsWith("term-")) continue;                       // drawn by guide.js, checked above
    assert.ok(have.has(target), `#${target} has no target`);
  }
  // the nav lists every section of the guide, in order
  const sections = [...page.matchAll(/<section class="gd-sec" id="([^"]+)"/g)].map((m) => m[1]);
  const nav = page.slice(page.indexOf("<nav"), page.indexOf("</nav>"));
  const linked = [...nav.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]).filter((id) => id !== "guide" && id !== "glossary");
  assert.deepEqual(linked, sections);
});

test("each section of the guide is short: a heading and two to four sentences", () => {
  const sections = page.split('<section class="gd-sec"').slice(1);
  assert.ok(sections.length >= 9);
  for (const s of sections) {
    const id = /id="([^"]+)"/.exec(s)[1];
    const text = /<h3[^>]*>[^<]+<\/h3>\s*<p>([\s\S]*?)<\/p>/.exec(s)?.[1];
    assert.ok(text, `${id}: no paragraph`);
    const plain = text.replace(/<[^>]+>/g, "").replace(/GOV\.UK/g, "GOVUK");
    const sentences = plain.split(/[.!?](?=\s|$)/).filter((x) => x.trim()).length;
    assert.ok(sentences >= 2 && sentences <= 4, `${id}: ${sentences} sentences`);
  }
});

test("the examples it links to are reports the site holds", () => {
  const data = JSON.parse(read("../../prototypes/dashboard/data.json"));
  const links = [...page.matchAll(/href="\.\.\/reader\/index\.html\?([^"]+)"/g)].map((m) => new URLSearchParams(m[1].replace(/&amp;/g, "&")));
  assert.ok(links.length >= 1);
  for (const p of links) {
    const country = data.countries.find((c) => c.slug === p.get("country"));
    assert.ok(country, `no country ${p.get("country")}`);
    const report = (country.reports || []).find((r) => r.key === p.get("series"));
    assert.ok(report?.read_url, `no report ${p.get("series")} in ${p.get("country")}: change the example in prototypes/guide/index.html`);
    if (p.get("changes") === "1") assert.ok(report.editions > 1, "a comparison needs two editions");
  }
});

test("header, footer and branding are the site's own, and the examples are not screenshots", () => {
  assert.ok(page.includes('<link rel="icon" type="image/svg+xml" href="../../assets/cpin-explorer/favicon.svg">'));
  assert.ok(page.includes('<use href="../../assets/cpin-explorer/mark.svg#mark"/>'));
  assert.ok(page.includes('<span class="brand-name"><b>CPIN</b>EXPLORER</span>'));
  for (const marker of ["<!--brand-rm-->", "<!--/brand-rm-->", "<!--brand-foot-->", "<!--/brand-foot-->"]) assert.ok(page.includes(marker), marker);
  assert.ok(page.includes("rm-mark-ink.png") && page.includes("rm-mark-light.png"));
  assert.ok(page.includes('<script type="module" src="../shared/report-bug.js"></script>'));
  assert.ok(page.indexOf("guide.css") < page.indexOf("../shared/brand.css"), "brand.css loads after the page's stylesheet");
  assert.ok(!/<img[^>]+screenshots\//.test(page), "screenshots are not deployed");
  assert.ok(!/https?:\/\/[^"']*(cdn|unpkg|jsdelivr|googleapis)/.test(page), "no CDN");
});
