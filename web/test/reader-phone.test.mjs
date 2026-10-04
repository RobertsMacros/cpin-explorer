import assert from "node:assert/strict";
import { test } from "node:test";
import { sheetSide, stripTicks, stripWindow } from "../../prototypes/reader/phone.js";

/* ------------------------------------------------------------------ the edge strip's marker */

// A 100,000px text starting 1,500px down the page, on a 700px strip; an 844px window with 106px of sticky chrome.
const win = (scroll, extra = {}) => stripWindow({ scroll, inset: 106, viewport: 844, docTop: 1500, docHeight: 100000, height: 700, ...extra });

test("the marker covers the share of the text that is on screen, where it is in the text", () => {
  const w = win(51394);                                   // the text from 50,000 to 50,738 is on screen
  assert.ok(Math.abs(w.top - 350) < 0.01 && Math.abs(w.size - 5.166) < 0.01, JSON.stringify(w));
  assert.equal(w.on, true);
});

test("a marker smaller than the minimum grows about the centre of the true window", () => {
  const w = win(51394, { min: 14 });
  assert.equal(w.size, 14);
  assert.ok(Math.abs(w.top + 7 - (350 + 5.166 / 2)) < 0.01, JSON.stringify(w));
});

test("the marker stays inside the strip at both ends of the text", () => {
  const start = win(1394, { min: 14 });                   // the text's first line under the sticky chrome
  assert.equal(start.top, 0);
  const end = win(1500 + 100000 - 844, { min: 14 });      // its last line at the bottom of the window
  assert.equal(end.top + end.size, 700);
  const past = win(200000, { min: 14 });                  // scrolled past the text (the footer)
  assert.deepEqual([past.top, past.size, past.on], [686, 14, false]);
});

test("before the text reaches the screen nothing is on, and as it arrives the marker sits at the top", () => {
  assert.equal(win(0).on, false);                         // the text starts 1,500px down: below an 844px window
  const arriving = win(900, { min: 14 });                 // 244px of it on screen
  assert.deepEqual([arriving.top, arriving.size, arriving.on], [0, 14, true]);
});

test("a short text gives a long marker, never longer than the strip", () => {
  const w = stripWindow({ scroll: 0, inset: 100, viewport: 800, docTop: 100, docHeight: 1400, height: 700, min: 14 });
  assert.deepEqual([w.top, w.size], [0, 350]);
  const all = stripWindow({ scroll: 0, inset: 0, viewport: 800, docTop: 0, docHeight: 600, height: 700, min: 14 });
  assert.deepEqual([all.top, all.size], [0, 700]);
});

test("nothing to show without a text or a strip", () => {
  assert.deepEqual(stripWindow({ scroll: 0, viewport: 800, docTop: 0, docHeight: 0, height: 700 }), { top: 0, size: 0, on: false });
  assert.deepEqual(stripWindow({ scroll: 0, viewport: 800, docTop: 0, docHeight: 900, height: 0 }), { top: 0, size: 0, on: false });
  assert.deepEqual(stripWindow(), { top: 0, size: 0, on: false });
});

/* ------------------------------------------------------------------ its ticks */

test("ticks are scaled to the strip, snapped to device pixels and kept inside it", () => {
  const ticks = stripTicks([0, 25030, 50000, 100000], { docHeight: 100000, height: 700, px: 0.5 });
  assert.deepEqual(ticks, [{ top: 0, on: true }, { top: 175, on: true }, { top: 350, on: true }, { top: 699.5, on: true }]);
  assert.deepEqual(stripTicks([12345], { docHeight: 100000, height: 700, px: 1 }), [{ top: 86, on: true }]);
});

test("a tick too close to the one shown before it is not shown, but keeps its place and its turn", () => {
  const ticks = stripTicks([10000, 10200, 10600, 20000], { docHeight: 100000, height: 700, px: 1, gap: 3 });
  assert.deepEqual(ticks, [{ top: 70, on: true }, { top: 71, on: false }, { top: 74, on: true }, { top: 140, on: true }]);
});

test("no ticks without a text or a strip, and a position that is not a number is never shown", () => {
  assert.deepEqual(stripTicks([10], { docHeight: 0, height: 700 }), []);
  assert.deepEqual(stripTicks([10], { docHeight: 900, height: 0 }), []);
  assert.deepEqual(stripTicks(null, { docHeight: 900, height: 700 }), []);
  assert.deepEqual(stripTicks([NaN, 450], { docHeight: 900, height: 700 }), [{ top: 0, on: false }, { top: 350, on: true }]);
});

/* ------------------------------------------------------------------ where the selection sheet goes */

// An 844px window, 106px of sticky chrome, a sheet that takes 100px.
const side = (top, bottom, extra = {}) => sheetSide({ top, bottom, viewport: 844, inset: 106, size: 100, ...extra });

test("the sheet sits along the bottom while the selection, its handles and the system menu are clear of it", () => {
  assert.equal(side(300, 360), "bottom");
  assert.equal(side(120, 724), "bottom");                 // the end handle stops just short of the sheet
});

test("a selection that ends where the sheet would sit sends it to the top", () => {
  assert.equal(side(600, 740), "top");                    // the end handle would be under the sheet
  assert.equal(side(700, 830), "top");
});

test("near the top of the screen the system menu goes below the selection, and counts", () => {
  assert.equal(side(40, 660), "bottom");                  // no room for the menu above: below, it stops just short of the sheet
  assert.equal(side(40, 700, { was: "top" }), "top");     // below, it would reach the sheet: nowhere is clear, so the sheet stays put
  assert.equal(side(40, 700), "bottom");
});

test("with neither edge clear the sheet stays where it is (the bottom, to begin with)", () => {
  assert.equal(side(230, 760), "bottom");                 // the menu above the selection reaches the top; its end reaches the bottom
  assert.equal(side(230, 760, { was: "top" }), "top");
  assert.equal(side(-400, 1200), "bottom");               // the whole screen is selected
});

test("the sheet only changes edge when the other is clear by a margin, so it does not flap", () => {
  assert.equal(side(500, 715, { was: "top" }), "top");    // clear of the bottom, but only just: it stays
  assert.equal(side(500, 690, { was: "top" }), "bottom");
  assert.equal(side(290, 740, { was: "bottom" }), "bottom");   // the top is clear, but only just: it stays
  assert.equal(side(330, 740, { was: "bottom" }), "top");
});

test("a selection that is off screen, or measurements that are missing, leave the sheet along the bottom", () => {
  assert.equal(side(-900, -500), "bottom");
  assert.equal(side(2000, 2100, { was: "top" }), "bottom");
  assert.equal(sheetSide({ top: NaN, bottom: 10, viewport: 844, size: 100 }), "bottom");
  assert.equal(sheetSide(), "bottom");
});
