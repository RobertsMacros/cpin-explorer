import assert from "node:assert/strict";
import { test } from "node:test";
import { cullLabels, interpolate, layoutMarks, monotonic, sectionIndex } from "../../prototypes/shared/minimap.js";

const opts = (extra = {}) => ({ docHeight: 10000, height: 1000, ...extra });   // 10 document px per strip px
const only = (rects, kind) => rects.filter((r) => r.kind === kind);

/* ------------------------------------------------------------------ layoutMarks */

test("marks are scaled from document to strip pixels and kept apart when they do not touch", () => {
  const rects = layoutMarks([{ kind: "ins", y0: 1000, y1: 1500 }, { kind: "ins", y0: 5000, y1: 5300 }], opts());
  assert.deepEqual(rects.map((r) => [r.top, r.bottom, r.n]), [[100, 150, 1], [500, 530, 1]]);
});

test("marks of one kind that overlap or touch at strip resolution merge, counting and weighing what they hold", () => {
  const rects = layoutMarks([
    { kind: "del", y0: 1000, y1: 1200, weight: 4 },
    { kind: "del", y0: 1150, y1: 1400, weight: 6 },      // overlaps
    { kind: "del", y0: 1405, y1: 1500, weight: 1 },      // within the 1px gap
    { kind: "del", y0: 2000, y1: 2100 },                 // clear of them
  ], opts());
  assert.deepEqual(rects.map((r) => [r.top, r.bottom, r.n, r.weight]), [[100, 150, 3, 11], [200, 210, 1, 1]]);
});

test("different kinds never merge with each other (they are drawn in different lanes)", () => {
  const rects = layoutMarks([{ kind: "ins", y0: 1000, y1: 1500 }, { kind: "del", y0: 1000, y1: 1500 }], opts());
  assert.equal(only(rects, "ins").length, 1);
  assert.equal(only(rects, "del").length, 1);
});

test("a short mark grows to the minimum size about its centre, and stays inside the strip at either end", () => {
  const [mid] = layoutMarks([{ kind: "find", y0: 5000, y1: 5001 }], opts({ minSize: 4 }));
  assert.deepEqual([mid.top, mid.bottom], [498, 502]);
  const [first] = layoutMarks([{ kind: "find", y0: 0 }], opts({ minSize: 4 }));
  assert.deepEqual([first.top, first.bottom], [0, 4]);
  const [last] = layoutMarks([{ kind: "find", y0: 10000 }], opts({ minSize: 4 }));
  assert.deepEqual([last.top, last.bottom], [996, 1000]);
  const [beyond] = layoutMarks([{ kind: "find", y0: 12000, y1: 13000 }], opts({ minSize: 4 }));
  assert.ok(beyond.top >= 0 && beyond.bottom <= 1000 && beyond.bottom - beyond.top >= 4);
});

test("edges snap to device pixels", () => {
  const [r] = layoutMarks([{ kind: "ins", y0: 1013, y1: 1527 }], opts({ px: 0.5 }));
  assert.equal(r.top * 2, Math.round(r.top * 2));
  assert.equal(r.bottom * 2, Math.round(r.bottom * 2));
  assert.deepEqual([r.top, r.bottom], [101.5, 152.5]);
});

test("section ticks never grow, and a tick too close to the one before is dropped (but counted)", () => {
  const rects = layoutMarks([
    { kind: "h2", y0: 1000, label: "One" }, { kind: "h2", y0: 1020, label: "Two" }, { kind: "h2", y0: 1050, label: "Three" },
  ], opts({ points: ["h2"], pointGap: 3 }));
  assert.deepEqual(rects.map((r) => [r.top, r.bottom, r.n, r.mark.label]), [[100, 101, 2, "One"], [105, 106, 1, "Three"]]);
});

test("a 300-change document stays light: changes in runs become a handful of rectangles", () => {
  // Changes come in runs (a rewritten section is many changed paragraphs one after another).
  const marks = [];
  let y = 8000;
  for (let i = 0; i < 300; i++) {
    y += i % 25 ? 17 + (i % 3) * 20 : 6000;                           // paragraph margins; a new run every 25 changes
    const h = 150 + (i % 5) * 110;
    marks.push({ kind: "ins", y0: y, y1: y + h, weight: 5 }, { kind: "del", y0: y, y1: y + h, weight: 3 });
    y += h;
  }
  const rects = layoutMarks(marks, { docHeight: 222000, height: 914, px: 0.5 });
  assert.ok(rects.length <= 24, `${rects.length} rectangles`);         // one per run in each lane
  assert.equal(only(rects, "ins").reduce((n, r) => n + r.n, 0), 300);
  assert.equal(only(rects, "del").reduce((w, r) => w + r.weight, 0), 900);
  for (const r of rects) assert.ok(r.top >= 0 && r.bottom <= 914 && r.bottom > r.top);
});

test("however marks are spread, a lane never holds more rectangles than the strip has room for", () => {
  const marks = Array.from({ length: 3000 }, (_, i) => ({ kind: "find", y0: i * 74 }));      // evenly, the worst case
  const rects = layoutMarks(marks, { docHeight: 222000, height: 914, px: 0.5, minSize: 2, gap: 1 });
  assert.ok(rects.length <= Math.ceil(914 / 3) + 1, `${rects.length} rectangles`);
  assert.equal(rects.reduce((n, r) => n + r.n, 0), 3000);
});

test("nothing to lay out without a height, and bad marks are ignored", () => {
  assert.deepEqual(layoutMarks([{ kind: "ins", y0: 10 }], { docHeight: 0, height: 900 }), []);
  assert.deepEqual(layoutMarks([{ kind: "ins", y0: 10 }], { docHeight: 900, height: 0 }), []);
  assert.deepEqual(layoutMarks(null, opts()), []);
  assert.equal(layoutMarks([null, { kind: "ins", y0: NaN }, { kind: "ins", y0: 100 }], opts()).length, 1);
});

/* ------------------------------------------------------------------ text offsets to positions */

test("offsets are placed by straight lines between anchors, flat beyond the ends", () => {
  const anchors = [{ off: 0, y: 0 }, { off: 100, y: 1000 }, { off: 300, y: 1500 }];
  assert.equal(interpolate(anchors, 50), 500);
  assert.equal(interpolate(anchors, 200), 1250);
  assert.equal(interpolate(anchors, -5), 0);
  assert.equal(interpolate(anchors, 900), 1500);
  assert.equal(interpolate([], 10), 0);
  assert.equal(interpolate([{ off: 10, y: 5 }, { off: 10, y: 9 }], 10), 5);
});

test("anchors are sorted by offset and can never fold the map back up", () => {
  const out = monotonic([{ off: 200, y: 900 }, { off: 0, y: 0 }, { off: 100, y: 1000 }, { off: 50, y: NaN }]);
  assert.deepEqual(out, [{ off: 0, y: 0 }, { off: 100, y: 1000 }, { off: 200, y: 1000 }]);
});

test("the section at a position is the last one starting at or above it", () => {
  const secs = [{ y: 100 }, { y: 400 }, { y: 900 }];
  assert.equal(sectionIndex(secs, 50), -1);
  assert.equal(sectionIndex(secs, 100), 0);
  assert.equal(sectionIndex(secs, 899), 1);
  assert.equal(sectionIndex(secs, 5000), 2);
  assert.equal(sectionIndex([], 10), -1);
});

/* ------------------------------------------------------------------ labels */

test("labels that would overlap are dropped, main sections first, and kept inside the strip", () => {
  const kept = cullLabels([
    { y: 2, rank: 0, name: "Executive summary" },
    { y: 10, rank: 1, name: "About the assessment" },     // too close to the first
    { y: 40, rank: 1, name: "1. Material facts" },
    { y: 52, rank: 0, name: "Country information" },      // beats the subsection 12px above it
    { y: 998, rank: 0, name: "Footnotes" },
  ], { size: 16, gap: 2, height: 1000 });
  assert.deepEqual(kept.map((k) => [k.name, k.at]), [["Executive summary", 8], ["Country information", 52], ["Footnotes", 992]]);
  assert.deepEqual(cullLabels([], { size: 16 }), []);
});
