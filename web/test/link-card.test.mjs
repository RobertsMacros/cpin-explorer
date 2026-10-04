// The card by a link in a report's text: what it says about where the link leads.
import assert from "node:assert/strict";
import { test } from "node:test";
import { linkFacts, shortAddress } from "../../prototypes/reader/link-card.js";

test("a source that works: its site, its address, and when it was checked", () => {
  const f = linkFacts({ link: { href: "https://www.hrw.org/report/2025/03/01/some-long-report-title" }, status: { status: "ok", code: 200, checked_at: "2026-10-02T16:26:47Z" } });
  assert.equal(f.kind, "source");
  assert.equal(f.title, "hrw.org");
  assert.equal(f.tag, "Works");
  assert.equal(f.tone, "ok");
  assert.equal(f.lines[0], "hrw.org/report/2025/03/01/some-long-report-title");
  assert.match(f.lines[1], /^Works · checked 2 Oct 2026$/);
  assert.deepEqual(f.more, []);
});

test("a dead source says so, with its archived copy if there is one", () => {
  const f = linkFacts({ link: { href: "http://example.org/gone" }, status: { status: "broken", code: 404, checked_at: "2026-10-02T10:00:00Z", archived_url: "https://web.archive.org/web/2024/http://example.org/gone", archived_at: "2024-05-06T00:00:00Z" } });
  assert.equal(f.tag, "Dead");
  assert.equal(f.tone, "dead");
  assert.match(f.lines[1], /No longer available · HTTP 404 · checked 2 Oct 2026/);
  assert.deepEqual(f.more, [{ label: "Archived copy, 6 May 2024 ↗", href: "https://web.archive.org/web/2024/http://example.org/gone" }]);
});

test("a source that moved points to where it is now; one never checked claims nothing", () => {
  const moved = linkFacts({ link: { href: "https://old.example.org/a" }, status: { status: "moved", code: 301, final_url: "https://www.new.example.org/b", checked_at: "2026-10-02T10:00:00Z" } });
  assert.equal(moved.tag, "Moved");
  assert.equal(moved.tone, "warn");
  assert.deepEqual(moved.more, [{ label: "Now at new.example.org ↗", href: "https://www.new.example.org/b" }]);
  const unknown = linkFacts({ link: { href: "https://example.org/x" }, status: null });
  assert.equal(unknown.tag, "");
  assert.deepEqual(unknown.lines, ["example.org/x", "Not checked yet"]);
});

test("a link to a report held here names the report, not an address", () => {
  const country = { name: "Iran", reports: [{}, {}, {}] };
  const report = { topic: "military service", kind: "CPIN", status: "live", latest: { version: "7.0", published: "2026-05-15T00:00:00Z", published_precision: "day" } };
  const f = linkFacts({ link: { href: "http://x/reader/index.html?country=iran&series=note:military-service", govukHref: "https://www.gov.uk/government/publications/iran" }, held: { country, report } });
  assert.equal(f.kind, "report");
  assert.equal(f.eyebrow, "Opens here");
  assert.equal(f.title, "Military service");
  assert.deepEqual(f.lines, ["Iran · CPIN", "v7.0 · 15 May 2026"]);
  assert.deepEqual(f.more, [{ label: "On GOV.UK ↗", href: "https://www.gov.uk/government/publications/iran" }]);
  const old = linkFacts({ link: { href: "x" }, held: { country, report: { ...report, status: "archived" } } });
  assert.equal(old.tag, "No longer on GOV.UK");
  const page = linkFacts({ link: { href: "x" }, held: { country, report: null } });
  assert.equal(page.kind, "country");
  assert.equal(page.title, "Iran");
  assert.deepEqual(page.lines, ["3 reports held"]);
});

test("a link within the page says where it lands", () => {
  const head = linkFacts({ link: { href: "#protection" }, target: { heading: "2. Protection", text: "" } });
  assert.deepEqual([head.kind, head.eyebrow, head.title, head.lines], ["in-page", "In this report", "2. Protection", []]);
  const para = linkFacts({ link: { href: "#p12" }, target: { heading: null, text: "The security forces are generally…" } });
  assert.equal(para.title, "Further down this report");
  assert.deepEqual(para.lines, ["The security forces are generally…"]);
});

test("a long address keeps its site and its end", () => {
  const url = "https://www.example.org/reports/2024/annual/human-rights/country/chapters/detention-conditions-final.pdf?download=1";
  const s = shortAddress(url, 58);
  assert.equal(s.length, 58);
  assert.ok(s.startsWith("example.org/reports/"));
  assert.ok(s.endsWith("-final.pdf?download=1"));
  assert.ok(s.includes("…"));
  assert.equal(shortAddress("https://example.org/a/"), "example.org/a");
  assert.equal(shortAddress("not a url"), "not a url");
});
