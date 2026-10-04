import assert from "node:assert/strict";
import { test } from "node:test";
import { describe, summaryLine } from "../../prototypes/shared/link-status.js";

test("descriptions say where a link leads and what was found", () => {
  assert.equal(describe("https://www.hrw.org/report", { status: "ok", checked_at: "2026-10-02T12:00:00Z" }),
    "hrw.org · Works · checked 2 Oct 2026");
  assert.equal(describe("https://old.example/a", { status: "moved", final_url: "https://new.example/a" }),
    "old.example · Works, but now redirects elsewhere · now at new.example");
  assert.equal(describe("https://gone.example/a", { status: "broken", code: 404 }),
    "gone.example · No longer available · HTTP 404");
  assert.equal(describe("https://x.example/a", undefined), "x.example · not checked yet");
});

test("summary line only mentions what is there", () => {
  assert.equal(summaryLine({ counts: { total: 312, ok: 291, moved: 9, dead: 8, archived: 6, unverified: 4, unchecked: 0 } }),
    "312 links · 291 work · 9 moved · 8 dead (6 archived) · 4 can't verify");
  assert.equal(summaryLine({ counts: { total: 3, ok: 3, moved: 0, dead: 0, archived: 0, unverified: 0, unchecked: 0 } }),
    "3 links · 3 work");
});

test("a check is dated by the UK day, like every other date on the site", () => {
  // 23:30 UTC on 2 July is 00:30 on 3 July in the UK (BST); in winter the two days are the same.
  assert.equal(describe("https://www.hrw.org/x", { status: "ok", checked_at: "2026-07-02T23:30:00Z" }), "hrw.org · Works · checked 3 Jul 2026");
  assert.equal(describe("https://www.hrw.org/x", { status: "ok", checked_at: "2026-12-02T23:30:00Z" }), "hrw.org · Works · checked 2 Dec 2026");
});
