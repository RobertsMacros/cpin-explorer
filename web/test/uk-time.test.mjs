import assert from "node:assert/strict";
import { test } from "node:test";
import { ukDate, ukDateTime, ukParts, ukTime } from "../../prototypes/shared/uk-time.js";

test("summer: UK time is an hour ahead of UTC and says BST", () => {
  assert.equal(ukDateTime("2026-10-02T16:11:59Z"), "02 OCT 2026 · 17:11 BST");
  assert.equal(ukTime("2026-10-03T07:24:00Z"), "08:24 BST");
});

test("winter: UK time is UTC and says GMT", () => {
  assert.equal(ukDateTime("2026-12-01T09:05:00Z"), "01 DEC 2026 · 09:05 GMT");
});

test("the day is the UK day, not the UTC day", () => {
  assert.equal(ukDate("2026-07-31T23:30:00Z"), "01 AUG 2026");
  assert.equal(ukDateTime("2026-07-31T23:30:00Z"), "01 AUG 2026 · 00:30 BST");
});

test("accepts a Date; a bad value gives a dash, not 'Invalid Date'", () => {
  assert.equal(ukTime(new Date("2026-01-15T12:00:00Z")), "12:00 GMT");
  assert.equal(ukDateTime("not a date"), "—");
});

test("ukParts gives the UK calendar date as numbers", () => {
  assert.deepEqual(ukParts("2026-07-31T23:30:00Z"), { day: 1, month: 7, year: 2026 });     // already 1 August in the UK
  assert.deepEqual(ukParts("2025-11-19"), { day: 19, month: 10, year: 2025 });             // a date with no time keeps its day
  assert.deepEqual(ukParts(Date.UTC(2026, 0, 15, 12)), { day: 15, month: 0, year: 2026 });
  assert.equal(ukParts("nonsense"), null);
});
