// The pure parts of the full-text search module (the index itself is Pagefind's and runs in the browser).
import assert from "node:assert/strict";
import { test } from "node:test";
import { excerptHtml, passageFilters, readerHref } from "../../prototypes/shared/fulltext-search.js";

test("an excerpt keeps only its <mark>s; everything else is text", () => {
  assert.equal(excerptHtml("sufficient <mark>protection</mark> to persons"), "sufficient <mark>protection</mark> to persons");
  assert.equal(excerptHtml("a <b>bold</b> <mark>hit</mark><script>alert(1)</script>"), "a bold <mark>hit</mark>alert(1)");
  assert.equal(excerptHtml("5 &lt; 6 &amp; <mark>R&amp;D</mark>"), "5 &lt; 6 &amp; <mark>R&amp;D</mark>", "entities are not double-escaped");
  assert.equal(excerptHtml("<mark>x</mark><img src=x onerror=alert(1)>"), "<mark>x</mark>");
  assert.equal(excerptHtml("<mark><i>nested</i></mark> ‘honour’"), "<mark>nested</mark> ‘honour’");
  assert.equal(excerptHtml(null), "");
});

test("a passage opens the report page at its section, with the words carried to find-in-report", () => {
  const meta = { slug: "afghanistan", note: "fear-of-the-taliban-2026", anchor: "executive-summary" };
  assert.equal(readerHref(meta, "internal relocation"),
    "../reader/index.html?country=afghanistan&note=fear-of-the-taliban-2026&q=internal%20relocation#executive-summary");
  assert.equal(readerHref({ ...meta, anchor: "" }, ""), "../reader/index.html?country=afghanistan&note=fear-of-the-taliban-2026");
  assert.equal(readerHref({ slug: "sri-lanka", note: "a&b", anchor: "s 1" }, "\"x y\""),
    "../reader/index.html?country=sri-lanka&note=a%26b&q=%22x%20y%22#s%201");
});

test("filters: passages only, with the chosen countries and kinds", () => {
  assert.deepEqual(passageFilters(), { type: "text" });
  assert.deepEqual(passageFilters({ countries: ["Iran"] }), { type: "text", country: "Iran" });
  assert.deepEqual(passageFilters({ countries: ["Iran", "Iraq"], kinds: ["CPIN", "Country bulletin"] }),
    { type: "text", country: { any: ["Iran", "Iraq"] }, kind: { any: ["CPIN", "Country bulletin"] } });
});
