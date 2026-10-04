// The pure parts of the full-text search module (the index itself is Pagefind's and runs in the browser).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { excerptHtml, passageFilters, passageFromPdf, readerHref } from "../../prototypes/shared/fulltext-search.js";
import { indexRecord } from "../build-search.mjs";

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

test("a passage of text read from a PDF is known as one, in the index and on the page", () => {
  const record = { url: "prototypes/reader/index.html?country=gambia&note=pdf-979e781e8b353ef0#assessment", content: "Assessment\n2.1.1 …", language: "en",
    meta: { title: "Sexual orientation and gender identity", country: "Gambia", slug: "gambia", note: "pdf-979e781e8b353ef0", kind: "CPIN", section: "Assessment", anchor: "assessment", level: "2", type: "text" },
    filters: { country: ["Gambia"], kind: ["CPIN"], type: ["text"] } };
  // The index keeps only what Pagefind takes, and the flag would be lost with the rest: it is carried into the meta, as a string.
  assert.equal(indexRecord({ ...record, text_from_pdf: true }).meta.text_from_pdf, "true");
  assert.equal(indexRecord({ ...record, meta: { ...record.meta, text_from_pdf: true } }).meta.text_from_pdf, "true", "wherever the record carries it");
  assert.deepEqual(Object.keys(indexRecord({ ...record, text_from_pdf: true })), ["url", "content", "language", "meta", "filters"]);
  assert.ok(!("text_from_pdf" in indexRecord(record).meta), "a web note's passages are not marked");
  assert.ok(!("text_from_pdf" in indexRecord({ ...record, text_from_pdf: false }).meta));
  assert.deepEqual(indexRecord(record).meta, record.meta);
  assert.ok(Object.values(indexRecord({ ...record, text_from_pdf: true }).meta).every((v) => typeof v === "string"), "Pagefind's meta values are strings");
  // On the page: by the index's flag, or (an index built before the flag) by the dashboard's entry for the note.
  assert.equal(passageFromPdf(indexRecord({ ...record, text_from_pdf: true }).meta), true);
  assert.equal(passageFromPdf(record.meta), false);
  const data = JSON.parse(readFileSync(new URL("../../prototypes/dashboard/data.json", import.meta.url), "utf8"));
  const gambia = data.countries.find((c) => c.slug === "gambia"), iran = data.countries.find((c) => c.slug === "iran");
  assert.ok(gambia.notes.some((n) => n.id === record.meta.note && n.text_from_pdf), "Gambia's only report is read from its PDF");
  assert.equal(passageFromPdf(record.meta, gambia), true);
  assert.equal(passageFromPdf({ slug: "iran", note: iran.notes[0].id }, iran), false);
  assert.equal(passageFromPdf(null), false);
  // The page's wording does not call such a passage word for word, and it marks it.
  const app = readFileSync(new URL("../../prototypes/dashboard/app.js", import.meta.url), "utf8");
  assert.ok(!/live reports, word for word as stored\./.test(app), "not said of every passage");
  assert.match(app, /word for word as stored, except those marked From the PDF/);
  assert.equal((app.match(/\$\{fromPdfTag\(m\)\}/g) || []).length, 2, "the search's passages and the passages view both mark them");
});
