// Picking a country on the globe: the dots are the targets, borders only the fallback.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MOUSE, TOUCH, dotRadius, pickCountry, pickDot, reachOf } from "../../prototypes/dashboard/pick.js";

const dot = (slug, x, y, r = 8, visible = true) => ({ slug, x, y, r, visible });

test("the dot's drawn radius follows COBE's marker size, the canvas and the zoom", () => {
  assert.equal(dotRadius(0.04, 900), 9);                 // size × canvas ÷ 4
  assert.equal(dotRadius(0.04, 900, 2), 18);             // zoomed in: twice as large on screen
  assert.equal(dotRadius(0.064, 888), 0.064 * 888 / 4);
});

test("the whole dot and a margin around it is the target: centre, rim and just outside the rim", () => {
  const albania = dot("albania", 500, 400, 12.2);        // a dot larger than the country under it
  assert.equal(pickDot([albania], 500, 400), "albania", "centre");
  assert.equal(pickDot([albania], 500 + 12, 400), "albania", "on the rim");
  assert.equal(pickDot([albania], 500, 400 - 21), "albania", "just outside the rim, within the 10 px margin");
  assert.equal(pickDot([albania], 500 + 23, 400), null, "beyond the margin");
  assert.equal(reachOf(12.2), 22.2);
});

test("a small dot still has a comfortable target: at least 18 px for a mouse, 22 px (44 across) for a finger", () => {
  const chad = dot("chad", 100, 100, 6.9);
  assert.equal(reachOf(6.9), 18);
  assert.equal(pickDot([chad], 117, 100, MOUSE), "chad");
  assert.equal(pickDot([chad], 119, 100, MOUSE), null);
  assert.equal(pickDot([chad], 121, 100, TOUCH), "chad", "a fingertip reaches further");
  assert.equal(pickDot([chad], 123, 100, TOUCH), null);
  assert.ok(reachOf(0, TOUCH) * 2 >= 44);
});

test("in a cluster the nearest centre wins, whichever dot is larger or listed first", () => {
  // The Levant at the default zoom: Lebanon, Syria and Palestine within a few px of each other.
  const cluster = [dot("syria", 568, 458, 14), dot("lebanon", 552, 462, 8), dot("palestine", 550, 476, 8), dot("iraq", 596, 470, 12)];
  assert.equal(pickDot(cluster, 553, 461), "lebanon");
  assert.equal(pickDot(cluster, 549, 478), "palestine");
  assert.equal(pickDot(cluster, 566, 457), "syria");
  assert.equal(pickDot(cluster, 559, 460), "lebanon", "between Syria and Lebanon, a little nearer Lebanon's centre");
  assert.equal(pickDot([...cluster].reverse(), 559, 460), "lebanon", "order does not matter");
  assert.equal(pickDot(cluster, 561, 460), "syria", "a little nearer Syria's");
  assert.equal(pickDot(cluster, 551, 468), "lebanon", "between Lebanon and Palestine: whichever centre is nearer");
  assert.equal(pickDot(cluster, 551, 470), "palestine");
});

test("a dot on the far side of the globe, or off the canvas, is not a target", () => {
  const hidden = dot("brazil", 300, 300, 10, false);
  assert.equal(pickDot([hidden], 300, 300), null);
  assert.equal(pickDot([hidden, dot("ghana", 310, 300, 8)], 300, 300), "ghana");
});

test("a dot in reach beats the border of the larger neighbour under it; with no dot in reach the border decides", () => {
  const dots = [dot("gambia", 200, 300, 7.6), dot("kuwait", 640, 420, 7.6)];
  const border = (slug) => () => slug;
  // The Gambia's dot sits on Senegal (no notes: the border test says nothing) and Kuwait's by Iraq.
  assert.equal(pickCountry(dots, 205, 296, MOUSE, border(null)), "gambia");
  assert.equal(pickCountry(dots, 648, 428, MOUSE, border("iraq")), "kuwait", "Iraq's border is under the pointer, but Kuwait's dot is in reach");
  assert.equal(pickCountry(dots, 700, 380, MOUSE, border("iraq")), "iraq", "well inside Iraq, away from any dot");
  assert.equal(pickCountry(dots, 900, 900, MOUSE, border(null)), null, "open sea");
  let asked = 0;
  pickCountry(dots, 200, 300, MOUSE, () => { asked++; return "senegal"; });
  assert.equal(asked, 0, "the border is not even consulted when a dot is hit");
});

test("thresholds are screen pixels: zooming in grows the dot's own target, never shrinks the margin", () => {
  const size = 0.03, canvas = 900;
  const at = (zoom) => reachOf(dotRadius(size, canvas, zoom));
  assert.equal(at(1), 18);                               // 6.75 px dot: the minimum applies
  assert.equal(at(3), 6.75 * 3 + 10);                    // 20.25 px dot + margin
  assert.ok(at(3) > at(1));
});
